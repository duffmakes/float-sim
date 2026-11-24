import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { STLLoader } from '../vendor/STLLoader.js';
import {
  mat3, transformTris, solveWaterline, hydrostatics, gzCurve, gzSummary, massProperties,
  inertiaAbout, bbox, openEdgeCount, stabilityVerdict, mat3ToQuat, quatToMat3, G0,
} from './physics.js';
import { FloatSim } from './sim.js';
import { readCad, soupFromIndexed, concat } from './loader.js';
import { initSeakeeping } from './seakeeping.js';
import { initDropTest } from './droptest.js';
import { initExtras } from './extras.js';
import { initUI } from './ui.js';
import { initProgress, startTask, nextPaint } from './progress.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ state
let sea = null;   // seakeeping module, initialised after the scene is built
let drop = null;  // drop / rise test module
let extras = null;  // small-body options (tracked points, drag, mooring, wind)
let ui = null;      // workspace chrome (stages, menus, status bar)
const S = {
  model: null,        // { name, raw: Float64Array (file units), tris (m), geo, mp, diag, open }
  rho: 1000,
  sim: null, simRunning: false, settling: false,
  preview: null,      // target-plane preview state
  target: null,
  gzAxis: 'x',
  last: null,         // last static analysis
};

// ------------------------------------------------------------------ three.js scene
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
// classic CAD viewport: grey at the top fading to white (screen-space background; the water materials are unchanged)
scene.background = (() => {
  const c = document.createElement('canvas'); c.width = 2; c.height = 512;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
  [[0, '#9aa2ad'], [0.45, '#cdd2d8'], [0.8, '#f4f5f7'], [1, '#ffffff']].forEach(([t, col]) => gr.addColorStop(t, col));
  g.fillStyle = gr; g.fillRect(0, 0, 2, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 1e6);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x1a2638, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(3, -4, 6);
scene.add(sun);

const body = new THREE.Group();        // origin = CoG, rotation = attitude
scene.add(body);
const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc9a46a, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide });
let bodyMesh = null, bodyEdges = null;
const bodyLocal = new THREE.Group();   // model coordinates inside the body (offset by −G like the mesh): markers
body.add(bodyLocal);

const waterMat = new THREE.MeshPhysicalMaterial({
  color: 0x1a6fb5, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0,
  side: THREE.DoubleSide, depthWrite: false,
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), waterMat);
water.renderOrder = 2;
scene.add(water);
const waterDepth = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({
  color: 0x0a3a66, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.BackSide }));
scene.add(waterDepth);
const grid = new THREE.GridHelper(1, 20, 0x3a6a99, 0x24476b);
grid.rotation.x = Math.PI / 2;
grid.material.transparent = true; grid.material.opacity = 0.35;
scene.add(grid);

function marker(color) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color, depthTest: false }));
  m.renderOrder = 10; scene.add(m); return m;
}
const mG = marker(0xff5a5a), mB = marker(0x4aa8ff), mMt = marker(0x47e08a), mMl = marker(0xe0c547);
const lineMat = (c, dashed) => dashed
  ? new THREE.LineDashedMaterial({ color: c, dashSize: 1, gapSize: 1, depthTest: false, transparent: true })
  : new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true });
const vertLine = new THREE.Line(new THREE.BufferGeometry(), lineMat(0x47e08a, true)); vertLine.renderOrder = 9; scene.add(vertLine);
const gLine = new THREE.Line(new THREE.BufferGeometry(), lineMat(0xff5a5a, true)); gLine.renderOrder = 9; scene.add(gLine);
const wlLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff })); wlLines.renderOrder = 8; scene.add(wlLines);
const arrW = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1, 0xff5a5a);
const arrB = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 1, 0x4aa8ff);
for (const a of [arrW, arrB]) { a.line.material.depthTest = false; a.cone.material.depthTest = false; a.renderOrder = 9; scene.add(a); }

// model axes at the CoG: they turn with the body (the body group's frame is the model's own axes)
const axesGroup = new THREE.Group(); body.add(axesGroup);
const AXES = [['x', [1, 0, 0], 0xd32f2f], ['y', [0, 1, 0], 0x2e9e44], ['z', [0, 0, 1], 0x1e5fd6]];
const axisArrows = AXES.map(([, d, c]) => {
  const a = new THREE.ArrowHelper(new THREE.Vector3(...d), new THREE.Vector3(), 1, c);
  for (const m of [a.line.material, a.cone.material]) { m.depthTest = false; m.transparent = true; }
  a.renderOrder = 12; axesGroup.add(a); return a;
});
let axisLen = 1;

const labelBox = $('labels');
const labels = {};
for (const k of ['G', 'B', 'Mᴛ', 'Mʟ']) { const d = document.createElement('div'); d.textContent = k; labelBox.appendChild(d); labels[k] = d; }
const labelTargets = { G: mG, B: mB, 'Mᴛ': mMt, 'Mʟ': mMl };
const axisLabels = AXES.map(([n]) => { const d = document.createElement('div'); d.className = `ax ${n}`; d.textContent = n; labelBox.appendChild(d); return d; });

// global axes triad (corner of the view): drawn each frame from the camera orientation
const triad = $('triad');
const TRIAD = [['X', [1, 0, 0], '#d32f2f', '#b71c1c'], ['Y', [0, 1, 0], '#2e9e44', '#1b6e2e'], ['Z', [0, 0, 1], '#1e5fd6', '#163f99']];
const SVGNS = 'http://www.w3.org/2000/svg';
const triadAxes = TRIAD.map(([n, , col, ink]) => {
  const g = document.createElementNS(SVGNS, 'g');
  const line = document.createElementNS(SVGNS, 'line'); line.setAttribute('stroke', col); line.setAttribute('stroke-width', '2.4'); line.setAttribute('stroke-linecap', 'round');
  const head = document.createElementNS(SVGNS, 'polygon'); head.setAttribute('fill', col);
  const txt = document.createElementNS(SVGNS, 'text');
  for (const [k, v] of [['fill', ink], ['font-size', '12'], ['font-weight', '700'], ['stroke', '#fff'], ['stroke-width', '3'], ['paint-order', 'stroke'], ['text-anchor', 'middle'], ['dominant-baseline', 'central'], ['font-family', 'Segoe UI, Noto Sans, sans-serif']]) txt.setAttribute(k, v);
  txt.textContent = n;
  g.append(line, head, txt); triad.appendChild(g);
  return { g, line, head, txt };
});
const triadDot = document.createElementNS(SVGNS, 'circle'); triadDot.setAttribute('r', '3'); triadDot.setAttribute('fill', '#6b7380'); triad.appendChild(triadDot);
const qInv = new THREE.Quaternion(), vAx = new THREE.Vector3();
function drawTriad() {
  const cx = 42, cy = 50, Lt = 30;
  qInv.copy(camera.quaternion).invert();
  const parts = TRIAD.map(([, d], i) => { vAx.set(...d).applyQuaternion(qInv); return { i, x: vAx.x, y: vAx.y, z: vAx.z }; });
  parts.sort((a, b) => a.z - b.z);   // far axes first
  for (const p of parts) {
    const A = triadAxes[p.i], ex = cx + Lt * p.x, ey = cy - Lt * p.y, l2 = Math.hypot(p.x, p.y);
    A.line.setAttribute('x1', cx); A.line.setAttribute('y1', cy); A.line.setAttribute('x2', ex); A.line.setAttribute('y2', ey);
    if (l2 > 0.15) {
      const ux = p.x / l2, uy = -p.y / l2, bx = ex - 8 * ux, by = ey - 8 * uy;
      A.head.setAttribute('points', `${ex + 2 * ux},${ey + 2 * uy} ${bx - 4 * uy},${by + 4 * ux} ${bx + 4 * uy},${by - 4 * ux}`);
      A.txt.setAttribute('x', ex + 9 * ux); A.txt.setAttribute('y', ey + 9 * uy);
    } else { A.head.setAttribute('points', ''); A.txt.setAttribute('x', ex + 8); A.txt.setAttribute('y', ey - 8); }
    triad.insertBefore(A.g, triadDot);
  }
}

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
new ResizeObserver(resize).observe(canvas.parentElement);

// ------------------------------------------------------------------ units & formatting
// Metric throughout: lengths are entered and shown in metres. STEP/IGES/BREP carry their own size; an STL has no
// units, so the "STL drawn in" menu (shown only for STL models) gives the file's units.
const unitScale = () => 1;
const unitName = () => 'm';
const stlScale = () => parseFloat($('stlUnits').value) || 0.001;
const fmt = (x, d = 3) => {
  if (!isFinite(x)) return '—';
  if (Math.abs(x) < 1e-9) x = 0;  // hide floating-point round-off (e.g. -1.7e-14)
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return x.toExponential(d - 1);
  return x.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
};
const L = (m, d = 3) => `${fmt(m / unitScale(), d)} ${unitName()}`;
const vecL = (v) => `(${v.map((c) => fmt(c / unitScale(), 2)).join(', ')})`;
const kg = (x) => `${fmt(x, x < 10 ? 3 : 1)} kg`;
const N = (x) => Math.abs(x) >= 1e4 ? `${fmt(x / 1000, 2)} kN` : `${fmt(x, 1)} N`;
const Nm = (x) => Math.abs(x) >= 1e4 ? `${fmt(x / 1000, 2)} kN·m` : `${fmt(x, 2)} N·m`;
const vol = (m3) => m3 < 1 ? `${fmt(m3 * 1000, 3)} L` : `${fmt(m3, 4)} m³`;

// ------------------------------------------------------------------ model loading
async function loadFile(file) {
  const mb = file.size / 1048576;
  const task = startTask({ title: `Loading ${file.name}`, detail: `Reading the file (${mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} kB`})…`, scrim: true });
  try {
    await nextPaint();
    const buf = new Uint8Array(await file.arrayBuffer());
    const ext = file.name.split('.').pop().toLowerCase();
    let parts;
    if (ext === 'stl') {
      task.update({ detail: 'Reading the STL triangles…' }); await nextPaint();
      const geo = new STLLoader().parse(buf.buffer);
      parts = [soupFromIndexed(geo.attributes.position.array, null)];
    } else {
      task.update({ detail: `OpenCascade is importing the ${ext.toUpperCase()} file and meshing its surfaces (${$('quality').value} mesh). Large assemblies can take a while…` });
      await nextPaint();
      parts = await readCad(buf, ext, $('quality').value);
      S.lastCad = file;
    }
    task.update({ detail: `Building the model: volume, centroid, inertia and the watertight check (${parts.length} bod${parts.length > 1 ? 'ies' : 'y'})…` });
    await nextPaint();
    // STEP/IGES/BREP carry their own units and the importer normalises them to millimetres, so their size is known.
    // STL has no units: the "STL drawn in" menu gives the file's units.
    setModel(file.name, concat(parts), parts.length, { rawScale: ext === 'stl' ? null : 0.001 });
  } catch (e) {
    console.error(e);
    alert(e.message || String(e));
  } finally { task.done(); }
}

function setModel(name, raw, nParts = 1, opts = {}) {
  S.model = { name, raw, nParts, rawScale: opts.rawScale ?? null };
  unitsHint();
  stopSim(); S.sim = null; S.preview = null; hideBanner();
  $('simInfo').textContent = '';
  if (!opts.keepAttitude) setEuler([0, 0, 0]);   // a new body starts upright
  $('inMode').value = 'auto'; $('inCustom').classList.add('hidden');   // custom inertia belonged to the old body
  IN_IDS.forEach((id, k) => { $(id).value = k < 3 ? '' : 0; });
  rescaleModel(opts.keepCog);
  if (!opts.keepCog) {
    const c = S.model.mp.centroid;
    setCog(c);
  }
  if (opts.mass) $('mass').value = opts.mass;
  else if (!opts.keepMass) {
    // default: half-submerged in the chosen water
    $('mass').value = +(S.model.mp.volume * S.rho * 0.4).toPrecision(4);
  }
  frameCamera();
  if (ui) ui.onModel(name, { stl: S.model.rawScale == null });
  if (extras) extras.onNewModel();
  update();
  if (drop) drop.onNewModel();
}

function rescaleModel() {
  const M = S.model; if (!M) return;
  const k = M.rawScale ?? stlScale();
  M.tris = M.raw.map((v) => v * k);
  M.mp = massProperties(M.tris);
  const bb = bbox(M.tris);
  M.bb = bb;
  M.size = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
  M.diag = Math.hypot(...M.size);
  M.open = openEdgeCount(M.tris, M.diag * 1e-7);

  // three.js mesh (non-indexed soup)
  if (bodyMesh) { body.remove(bodyMesh); bodyMesh.geometry.dispose(); }
  if (bodyEdges) { body.remove(bodyEdges); bodyEdges.geometry.dispose(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M.tris), 3));
  geo.computeVertexNormals();
  bodyMesh = new THREE.Mesh(geo, bodyMat);
  bodyEdges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: 0x5b4a2e }));
  bodyEdges.visible = $('showEdges').checked;
  body.add(bodyMesh, bodyEdges);

  const d = M.diag;
  axisLen = d * 0.22;
  for (const a of axisArrows) a.setLength(axisLen, axisLen * 0.16, axisLen * 0.07);
  water.scale.set(d * 12, d * 12, 1);
  waterDepth.scale.set(d * 12, d * 12, d * 2); waterDepth.position.set(0, 0, -d - d * 0.002);
  grid.scale.set(d * 12, 1, d * 12); grid.position.z = -2 * d;
  for (const m of [mG, mB, mMt, mMl]) m.scale.setScalar(d * 0.012);
  mMl.scale.setScalar(d * 0.009);
  vertLine.material.dashSize = gLine.material.dashSize = d * 0.015;
  vertLine.material.gapSize = gLine.material.gapSize = d * 0.01;

  const vNeg = M.mp.volume <= 0;
  $('modelInfo').innerHTML = `
    <table>
      <tr><td>File</td><td>${M.name}${M.nParts > 1 ? ` (${M.nParts} bodies)` : ''}</td></tr>
      <tr><td>Triangles</td><td>${(M.tris.length / 9).toLocaleString()}</td></tr>
      <tr><td>Size X×Y×Z</td><td>${M.size.map((s) => fmt(s, 3)).join(' × ')} m</td></tr>
      <tr><td>Enclosed volume</td><td>${vol(M.mp.volume)}</td></tr>
      <tr><td>Centroid</td><td>${vecL(M.mp.centroid)}</td></tr>
      <tr><td>Watertight</td><td>${M.open === 0 ? '<span class="good">yes</span>' : `<span class="warn">${M.open.toLocaleString()} open edges</span>`}</td></tr>
    </table>
    ${M.open > 0 ? '<div class="warn">Mesh is not fully closed; volumes may be approximate.</div>' : ''}
    ${M.nParts > 1 ? '<div class="hint">Multiple bodies are treated as one rigid object. Overlapping bodies double-count volume.</div>' : ''}
    ${vNeg ? '<div class="bad">Volume is not positive — the geometry is not a closed solid.</div>' : ''}`;
}

function frameCamera() {
  const d = S.model.diag;
  camera.position.set(d * 1.3, -d * 1.6, d * 0.9);
  controls.target.set(0, 0, 0);
  camera.near = d / 1000; camera.far = d * 200; camera.updateProjectionMatrix();
  controls.update();
}
// standard views about the current orbit target (Front looks along +Y, Right along −X, Top down −Z)
const VIEW_DIRS = { iso: [1.3, -1.6, 0.9], front: [0, -1, 0], right: [1, 0, 0], top: [0, -0.002, 1] };
function setView(v) {
  if (!S.model) return;
  const d = S.model.diag, dist = Math.hypot(1.3, 1.6, 0.9) * d;
  const dir = v === 'fit' ? camera.position.clone().sub(controls.target) : new THREE.Vector3(...VIEW_DIRS[v]);
  if (dir.lengthSq() < 1e-12) dir.set(...VIEW_DIRS.iso);
  camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(dist));
  controls.update();
}
$('showEdges').onchange = (e) => { if (bodyEdges) bodyEdges.visible = e.target.checked; };
$('showAxes').onchange = (e) => { axesGroup.visible = e.target.checked; };

// ------------------------------------------------------------------ inputs
const getCogM = () => ['cgx', 'cgy', 'cgz'].map((id) => (parseFloat($(id).value) || 0) * unitScale());
// round-off below a nanometre (e.g. a centroid of −1.2e-17 m) shows as 0
function setCog(cm) { ['cgx', 'cgy', 'cgz'].forEach((id, i) => { const v = cm[i] / unitScale(); $(id).value = Math.abs(v) < 1e-9 ? 0 : +v.toPrecision(6); }); }
const getMass = () => Math.max(0, parseFloat($('mass').value) || 0);
const getEuler = () => ['rollN', 'pitchN', 'yawN'].map((id) => parseFloat($(id).value) || 0);
function setEuler(e) {
  ['roll', 'pitch', 'yaw'].forEach((id, i) => {
    let v = +e[i].toFixed(2);
    $(id + 'N').value = v; $(id).value = v;
  });
}
const getR = () => mat3.fromEulerDeg(...getEuler());

for (const id of ['roll', 'pitch', 'yaw']) {
  $(id).addEventListener('input', () => { $(id + 'N').value = $(id).value; onAttitude(); });
  $(id + 'N').addEventListener('change', () => { $(id).value = $(id + 'N').value; onAttitude(); });
}
function onAttitude() { stopSim(); S.sim = null; S.preview = null; update(); }
$('resetOri').onclick = () => { setEuler([0, 0, 0]); onAttitude(); };
const quarter = (axisR) => {
  const R = mat3.mul(axisR, getR());
  setEuler(mat3.toEulerDeg(R)); onAttitude();
};
$('quarterX').onclick = () => quarter(mat3.rotX(Math.PI / 2));
$('quarterY').onclick = () => quarter(mat3.rotY(Math.PI / 2));

for (const id of ['mass', 'cgx', 'cgy', 'cgz']) $(id).addEventListener('change', () => { stopSim(); S.sim = null; S.preview = null; update(); });
// An STL has no units: the menu gives the file's units and rescales the model (the CoG numbers keep their place).
function unitsHint() {
  const stl = S.model && S.model.rawScale == null;
  $('unitsHint').textContent = stl ? 'STL files carry no units: pick the units the file was drawn in. Everything else is in metres.' : '';
}
$('stlUnits').addEventListener('change', () => {
  if (!S.model || S.model.rawScale != null) return;
  rescaleModel(); frameCamera(); update();
});
$('useCentroid').onclick = () => { if (S.model) { setCog(S.model.mp.centroid); onAttitude(); } };
$('quality').addEventListener('change', async () => {
  const f = S.lastCad; if (!f || !S.model || S.model.name !== f.name) return;
  const keep = { mass: $('mass').value, cog: ['cgx', 'cgy', 'cgz'].map((id) => $(id).value) };
  await loadFile(f);
  $('mass').value = keep.mass; ['cgx', 'cgy', 'cgz'].forEach((id, i) => { $(id).value = keep.cog[i]; });
  update();
});
$('file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; });
$('demo').addEventListener('change', (e) => { if (e.target.value) loadDemo(e.target.value); e.target.value = ''; });

$('water').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('water').children) x.classList.toggle('on', x === b);
  const custom = b.dataset.rho === 'custom';
  $('rhoWrap').classList.toggle('hidden', !custom);
  if (!custom) $('rho').value = b.dataset.rho;
  S.rho = parseFloat($('rho').value) || 1000;
  onAttitude();
});
$('rho').addEventListener('change', () => { S.rho = Math.max(1, parseFloat($('rho').value) || 1000); onAttitude(); });
$('showWater').onchange = (e) => { water.visible = waterDepth.visible = e.target.checked; };
$('showMl').onchange = () => update();
$('gzAxis').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('gzAxis').children) x.classList.toggle('on', x === b);
  S.gzAxis = b.dataset.axis; scheduleGZ();
});

// ------------------------------------------------------------------ static analysis
function relGeometry(R) {
  const G = getCogM();
  return { G, rel: transformTris(S.model.tris, R, G) };
}

function update() {
  if (!S.model) return;
  const R = getR();
  const { G, rel } = relGeometry(R);
  const m = getMass(), rho = S.rho;
  const Vneed = m / rho;
  const sol = solveWaterline(rel, Vneed);
  const H = hydrostatics(rel, sol.zw, m, rho);
  H.status = sol.status;
  S.last = { R, G, rel, H, m, rho, Vneed };

  const mi = $('massInfo');
  const avgRho = m / S.model.mp.volume;
  mi.innerHTML = `Average density <b>${fmt(avgRho, 1)} kg/m³</b> · ${avgRho > rho
    ? '<span class="bad">denser than water — it will sink</span>'
    : `floats with <b>${fmt(100 * Vneed / S.model.mp.volume, 1)}%</b> of its volume submerged`}${avgRho <= rho && Vneed < 0.01 * S.model.mp.volume
    ? `<br><span class="warn">⚠ Under 1 % submerged: the body barely touches the water. Check the mass and the model units (size ${S.model.size.map((x) => fmt(x / unitScale(), 3)).join(' × ')} ${unitName()}).</span>` : ''}`;

  if (!S.preview && !S.simRunning && !(sea && sea.running) && !(drop && drop.placed)) placeStatic(R, H);
  renderStats(H, S.preview ? 'preview' : 'static');
  scheduleGZ();
  $('simApply').disabled = !S.sim;
  if (sea) sea.onModelChange();
  if (drop) drop.onModelChange();
  renderInertiaInfo();
  document.querySelectorAll('.unitLabel').forEach((e) => { e.textContent = unitName(); });
  if (extras) extras.drawMarkers();
  if (ui) ui.onUpdate({ rho: S.rho });
}

// world = rel + (0,0,-zw)  (water surface at z = 0)
function placeStatic(R, H) {
  const off = [0, 0, -H.zw];
  setBodyPose(R, off);
  drawMarkers(off, H);
}

function setBodyPose(R, pos) {
  const G = getCogM();
  bodyMesh.position.set(-G[0], -G[1], -G[2]);
  bodyEdges.position.copy(bodyMesh.position);
  bodyLocal.position.copy(bodyMesh.position);
  const m4 = new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);
  body.quaternion.setFromRotationMatrix(m4);
  body.position.set(...pos);
}

const v3 = (a, off) => new THREE.Vector3(a[0] + off[0], a[1] + off[1], a[2] + off[2]);
function drawMarkers(off, H) {
  const d = S.model.diag;
  const G = v3([0, 0, 0], off), B = v3(H.B, off);
  mG.position.copy(G); mB.position.copy(B);
  const showM = H.V > 0 && H.wp.area > 0;
  mMt.visible = showM && Math.abs(H.BMt) < d * 20;
  mMl.visible = showM && $('showMl').checked && Math.abs(H.BMl) < d * 20;
  mMt.position.copy(v3(H.Mt, off)); mMl.position.copy(v3(H.Ml, off));
  labels['Mᴛ'].style.display = mMt.visible ? '' : 'none';
  labels['Mʟ'].style.display = mMl.visible ? '' : 'none';

  // vertical through B up to M, and through G
  const top = Math.max(mMt.visible ? mMt.position.z : B.z, G.z) + d * 0.1;
  vertLine.geometry.setFromPoints([new THREE.Vector3(B.x, B.y, B.z - d * 0.05), new THREE.Vector3(B.x, B.y, top)]);
  vertLine.computeLineDistances();
  gLine.geometry.setFromPoints([new THREE.Vector3(G.x, G.y, G.z - d * 0.25), new THREE.Vector3(G.x, G.y, G.z + d * 0.25)]);
  gLine.computeLineDistances();

  const len = d * 0.22;
  arrW.position.copy(G); arrW.setLength(len, len * 0.25, len * 0.15);
  arrB.visible = H.V > 0;
  if (arrB.visible) { arrB.position.copy(B); const lb = len * Math.max(0.3, Math.min(1.5, H.buoyancy / Math.max(1e-9, H.weight))); arrB.setLength(lb, len * 0.25, len * 0.15); }

  // waterline (the water surface is always world z = 0)
  const s = H.segs || [], z = d * 0.0008;
  const pts = new Float32Array((s.length / 4) * 6);
  for (let i = 0, j = 0; i < s.length; i += 4, j += 6) {
    pts[j] = s[i] + off[0]; pts[j + 1] = s[i + 1] + off[1]; pts[j + 2] = z;
    pts[j + 3] = s[i + 2] + off[0]; pts[j + 4] = s[i + 3] + off[1]; pts[j + 5] = z;
  }
  wlLines.geometry.dispose();
  wlLines.geometry = new THREE.BufferGeometry();
  wlLines.geometry.setAttribute('position', new THREE.BufferAttribute(pts, 3));
}

// ------------------------------------------------------------------ inertia (computed or user-entered)
const autoInertiaG = () => inertiaAbout(S.model.mp, getMass(), getCogM());
const IN_IDS = ['inXX', 'inYY', 'inZZ', 'inXY', 'inXZ', 'inYZ'];
// Body-frame inertia tensor about the CoG (kg·m², model axes). Custom values: tensor convention I_xy = −∫xy dm,
// or +∫xy dm when the "products of inertia" box is ticked (then negated into the tensor).
function customInertia() {
  const v = IN_IDS.map((id) => parseFloat($(id).value));
  if (![0, 1, 2].every((i) => Number.isFinite(v[i]))) return null;
  const sg = $('inProdSign').checked ? -1 : 1;
  const [xx, yy, zz] = v, [xy, xz, yz] = v.slice(3).map((x) => sg * (Number.isFinite(x) ? x : 0));
  return [xx, xy, xz, xy, yy, yz, xz, yz, zz];
}
function inertiaCheck(I) {
  const [a, b, c] = [I[0], I[4], I[8]];
  const m2 = a * I[4] - I[1] * I[3];
  const det = I[0] * (I[4] * I[8] - I[5] * I[7]) - I[1] * (I[3] * I[8] - I[5] * I[6]) + I[2] * (I[3] * I[7] - I[4] * I[6]);
  if (!(a > 0 && m2 > 0 && det > 0)) return 'not positive-definite (check the products of inertia and their sign)';
  const tol = 1e-9 * (a + b + c);
  if (a + b < c - tol || a + c < b - tol || b + c < a - tol) return 'violates the triangle inequality (each moment must be ≤ the sum of the other two)';
  return null;
}
function inertiaG() {
  if (!S.model) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if ($('inMode').value === 'custom') { const I = customInertia(); if (I && !inertiaCheck(I)) return I; }
  return autoInertiaG();
}
function renderInertiaInfo() {
  if (!S.model) return;
  const custom = $('inMode').value === 'custom';
  const I = inertiaG(), m = Math.max(getMass(), 1e-12);
  const bad = custom ? (customInertia() ? inertiaCheck(customInertia()) : 'enter at least Ixx, Iyy and Izz') : null;
  const kg = [0, 4, 8].map((i) => Math.sqrt(Math.max(I[i], 0) / m));
  $('inInfo').innerHTML = `${custom ? (bad ? `<span class="bad">Custom inertia ${bad}. Using the computed values instead.</span>` : '<span class="good">Using custom inertia.</span>') : 'Computed for uniform density.'}
    I<sub>xx</sub>, I<sub>yy</sub>, I<sub>zz</sub> = <b>${[0, 4, 8].map((i) => fmt(I[i], 4)).join(', ')}</b> kg·m² ·
    radii of gyration ${kg.map((k) => L(k)).join(', ')}`;
  for (const [k, id] of IN_IDS.entries()) {
    const auto = autoInertiaG(), idx = [0, 4, 8, 1, 2, 5][k];
    $(id).placeholder = (k < 3 ? auto[idx] : ($('inProdSign').checked ? -1 : 1) * auto[idx]).toPrecision(4);
  }
}
$('inMode').addEventListener('change', () => {
  const custom = $('inMode').value === 'custom';
  $('inCustom').classList.toggle('hidden', !custom);
  if (custom && S.model && !customInertia()) {
    // prefill with the computed tensor so the user only edits what they know
    const I = autoInertiaG(), sg = $('inProdSign').checked ? -1 : 1;
    [I[0], I[4], I[8], sg * I[1], sg * I[2], sg * I[5]].forEach((v, k) => { $(IN_IDS[k]).value = +v.toPrecision(6); });
  }
  onAttitude();
});
for (const id of [...IN_IDS, 'inProdSign']) $(id).addEventListener('change', () => onAttitude());

function renderStats(H, mode) {
  const { R, m, rho } = S.last;
  const beam = Math.min(...waterplaneExtent(H));
  const verdict = H.status === 'sinks' ? { level: 'bad', text: 'Weight exceeds buoyancy of the fully submerged body. It sinks — no float plane exists.' }
    : stabilityVerdict(H.wp.area > 0 ? H.GMmin : NaN, beam);
  const offMag = Math.hypot(...H.offset);
  const balanced = offMag < S.model.diag * 1e-4;
  const Iw = mat3.mul(R, mat3.mul(inertiaG(), mat3.transpose(R)));
  const Troll = H.GMt > 0 ? 2 * Math.PI * Math.sqrt(Iw[0] / (rho * G0 * H.V * H.GMt)) : NaN;
  const Tpitch = H.GMl > 0 ? 2 * Math.PI * Math.sqrt(Iw[4] / (rho * G0 * H.V * H.GMl)) : NaN;
  const Theave = H.wp.area > 0 ? 2 * Math.PI * Math.sqrt(m / (rho * G0 * H.wp.area)) : NaN;
  const RT = mat3.transpose(R), G = S.last.G;
  const toModel = (p) => { const q = mat3.apply(RT, p); return [q[0] + G[0], q[1] + G[1], q[2] + G[2]]; };

  $('verdict').className = `verdict ${verdict.level}`;
  $('verdict').innerHTML = `<b>${{ good: 'Stable', ok: 'Stable (tender)', warn: 'Marginal', bad: H.status === 'sinks' ? 'Sinks' : 'Unstable', na: '—' }[verdict.level]}${mode === 'preview' ? ' · target plane preview' : ''}</b>${verdict.text}
    ${!balanced && H.status !== 'sinks' && mode !== 'preview' ? `<div style="margin-top:6px;color:var(--warn)">This attitude is not at rest: B is ${L(offMag)} horizontally from G, giving an unbalanced moment of ${Nm(H.buoyancy * offMag)}. The body will rotate — run the simulation to find its resting attitude.</div>` : ''}`;

  const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
  const grp = (k) => `<tr class="grp"><td colspan="2">${k}</td></tr>`;
  $('stats').innerHTML = H.status === 'sinks' ? [
    row('Weight', N(m * G0)),
    row('Max buoyancy (fully submerged)', N(rho * G0 * H.total)),
    row('Max mass that floats', kg(rho * H.total)),
  ].join('') : [
    grp('Float plane'),
    row('Displaced volume', vol(H.V)),
    row('Submerged fraction', `${fmt(100 * H.V / H.total, 2)} %`),
    row('Draft (lowest point → waterline)', L(H.draft)),
    row('Freeboard (waterline → highest point)', L(H.freeboard)),
    row('Waterline above CoG', L(H.zw)),
    row('Waterplane area', `${fmt(H.wp.area, 4)} m²`),
    row('Immersion rate', `${fmt(H.tpc / 100, 3)} kg / cm`),
    row('Reserve buoyancy', kg(rho * (H.total - H.V))),
    grp('Centres (model frame)'),
    row('G — CoG', vecL(toModel([0, 0, 0]))),
    row('B — centre of buoyancy', vecL(toModel(H.B))),
    row('M<sub>T</sub> — roll metacentre', vecL(toModel(H.Mt))),
    grp('Stability'),
    row('KB (keel → B)', L(H.B[2] - H.zmin)),
    row('KG (keel → G)', L(-H.zmin)),
    row('BM<sub>T</sub> = I<sub>xx</sub>/V (roll)', L(H.BMt)),
    row('BM<sub>L</sub> = I<sub>yy</sub>/V (pitch)', L(H.BMl)),
    row('<b>GM<sub>T</sub></b> (roll)', `<b class="${H.GMt > 0 ? '' : 'bad'}">${L(H.GMt)}</b>`),
    row('<b>GM<sub>L</sub></b> (pitch)', `<b>${L(H.GMl)}</b>`),
    row('GM about weakest axis', `${L(H.GMmin)} @ ${fmt(Math.abs(H.axisMinDeg) < 1e-6 ? 0 : H.axisMinDeg, 1)}°`),
    row('Righting moment / degree roll', Nm(H.rightingPerDegT)),
    row('Righting moment / degree pitch', Nm(H.rightingPerDegL)),
    grp('Natural periods (approx.)'),
    row('Heave', isFinite(Theave) ? `${fmt(Theave, 2)} s` : '—'),
    row('Roll', isFinite(Troll) ? `${fmt(Troll, 2)} s` : '—'),
    row('Pitch', isFinite(Tpitch) ? `${fmt(Tpitch, 2)} s` : '—'),
  ].join('');
}

function waterplaneExtent(H) {
  const s = H.segs || [];
  if (!s.length) return [0, 0];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < s.length; i += 2) { x0 = Math.min(x0, s[i]); x1 = Math.max(x1, s[i]); y0 = Math.min(y0, s[i + 1]); y1 = Math.max(y1, s[i + 1]); }
  return [x1 - x0, y1 - y0];
}

// ------------------------------------------------------------------ GZ curve
let gzTimer = null;
function scheduleGZ() { clearTimeout(gzTimer); gzTimer = setTimeout(drawGZ, 120); }
function drawGZ() {
  const cv = $('gz'), ctx = cv.getContext('2d');
  const dpr = Math.min(devicePixelRatio, 2);
  const W = cv.clientWidth || 360, Hh = 170;
  cv.width = W * dpr; cv.height = Hh * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, Hh);
  if (!S.last || S.last.H.status === 'sinks' || S.last.H.wp.area <= 0) { $('gzInfo').textContent = ''; return; }
  const { rel, H } = S.preview ? S.preview : S.last;
  const V = H.V;
  const curve = gzCurve(rel, V, S.gzAxis, Array.from({ length: 37 }, (_, i) => i * 5));
  const sum = gzSummary(curve);
  const GM = S.gzAxis === 'x' ? H.GMt : H.GMl;
  const k = 1 / unitScale();
  const vals = curve.map((p) => p.gz * k);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi - lo < 1e-12) hi = lo + 1;
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const x0 = 46, x1 = W - 10, y0 = 10, y1 = Hh - 24;
  const X = (deg) => x0 + (x1 - x0) * deg / 180, Y = (v) => y1 - (y1 - y0) * (v - lo) / (hi - lo);
  ctx.font = '10px "Segoe UI", "Noto Sans", sans-serif'; ctx.fillStyle = '#444'; ctx.strokeStyle = '#e3e3e3'; ctx.lineWidth = 1;
  for (let d = 0; d <= 180; d += 30) {
    ctx.beginPath(); ctx.moveTo(X(d), y0); ctx.lineTo(X(d), y1); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillText(`${d}°`, X(d), Hh - 8);
  }
  ctx.textAlign = 'right';
  for (const v of [lo + pad, 0, hi - pad]) ctx.fillText(fmt(v, 2), x0 - 4, Y(v) + 3);
  ctx.strokeStyle = '#7a7a7a'; ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(x1, Y(0)); ctx.stroke();
  // GM tangent at origin: GZ ≈ GM·φ
  ctx.setLineDash([4, 4]); ctx.strokeStyle = '#1baf7a';
  const phiT = 57.3; ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(phiT), Y(GM * k)); ctx.stroke();
  ctx.setLineDash([]);
  // curve
  ctx.strokeStyle = '#2a78d6'; ctx.lineWidth = 2; ctx.beginPath();
  curve.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(p.deg), Y(p.gz * k)));
  ctx.stroke();
  if (sum.max > 0) { ctx.fillStyle = '#2a78d6'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(sum.maxDeg), Y(sum.max * k), 4, 0, 7); ctx.fill(); ctx.stroke(); }
  ctx.save(); ctx.translate(11, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillStyle = '#444';
  ctx.fillText(`GZ (${unitName()})`, 0, 0); ctx.restore();

  const axisName = S.gzAxis === 'x' ? 'roll' : 'pitch';
  const sunk = curve.some((p) => p.status !== 'floats');
  $('gzInfo').innerHTML = `Heeling in ${axisName} from the current attitude (positive GZ = righting, dashed line = GM tangent).<br>
    Max GZ <b>${L(sum.max)}</b> at <b>${sum.maxDeg}°</b>
    → peak righting moment <b>${Nm(S.last.rho * G0 * V * Math.max(0, sum.max))}</b><br>
    ${sum.unstable
      ? `<span class="bad">GZ is negative straight away: this attitude is unstable.</span>${sum.loll !== null ? ` It heels over until GZ turns positive, at about <b>${fmt(sum.loll, 1)}°</b>.` : ''}`
      : `Angle of vanishing stability: <b>${sum.vanish !== null ? fmt(sum.vanish, 1) + '°' : '> 180° (self-righting)'}</b>`}
    ${sunk ? '<br><span class="warn">Note: the body is fully submerged at some heel angles.</span>' : ''}`;
}

// ------------------------------------------------------------------ target float plane → mass
$('tMode').addEventListener('change', () => {
  const m = $('tMode').value;
  $('tLabel').textContent = { draft: `Draft (${unitName()})`, modelZ: `Model Z (${unitName()})`, frac: 'Submerged %' }[m];
});
$('tCalc').onclick = () => computeTarget(false);
$('tPreview').onclick = () => computeTarget(true);
$('tApply').onclick = () => {
  if (!S.target) return;
  $('mass').value = +S.target.mass.toPrecision(6);
  S.preview = null; hideBanner(); update();
};

function computeTarget(preview) {
  if (!S.model) return;
  stopSim();
  const R = getR();
  const { G, rel } = relGeometry(R);
  const [zmin, zmax] = [Math.min(...zr(rel)), Math.max(...zr(rel))];
  const mode = $('tMode').value, val = parseFloat($('tVal').value) || 0;
  let zw;
  if (mode === 'draft') zw = zmin + val * unitScale();
  else if (mode === 'modelZ') {
    // horizontal plane through model point (Gx, Gy, Z) in the current attitude
    const p = [0, 0, val * unitScale() - G[2]];
    zw = mat3.apply(R, p)[2];
  } else {
    const total = S.model.mp.volume;
    zw = solveWaterline(rel, total * Math.min(100, Math.max(0, val)) / 100).zw;
  }
  zw = Math.min(zmax, Math.max(zmin, zw));
  const H = hydrostatics(rel, zw, 1, S.rho);
  const mass = S.rho * H.V;
  const Hm = hydrostatics(rel, zw, mass, S.rho);
  S.target = { mass, H: Hm };
  const RT = mat3.transpose(R);
  const dModel = mat3.apply(RT, [Hm.B[0], Hm.B[1], 0]);
  const vertModel = mat3.apply(RT, [0, 0, 1]);
  const offMag = Math.hypot(Hm.B[0], Hm.B[1]);
  const newG = G.map((g, i) => g + dModel[i]);
  $('tOut').innerHTML = `
    <table>
      <tr><td>Required mass</td><td><b>${kg(mass)}</b></td></tr>
      <tr><td>Displaced volume</td><td>${vol(Hm.V)}</td></tr>
      <tr><td>Draft</td><td>${L(Hm.draft)}</td></tr>
      <tr><td>Submerged</td><td>${fmt(100 * Hm.V / Hm.total, 2)} %</td></tr>
      <tr><td>B (model frame)</td><td>${vecL(mat3.apply(RT, Hm.B).map((c, i) => c + G[i]))}</td></tr>
      <tr><td>GM<sub>T</sub> / GM<sub>L</sub> (current CoG)</td><td>${L(Hm.GMt)} / ${L(Hm.GMl)}</td></tr>
    </table>
    ${offMag < S.model.diag * 1e-4
      ? '<div class="good">The CoG is already on the vertical through B — this attitude is an equilibrium.</div>'
      : `<div class="warn">To float at this attitude, the CoG must lie on the vertical through B. Keeping the current CoG height, move it to
         <b>${vecL(newG)}</b> (shift ${vecL(dModel)}). The vertical line runs along model direction (${vertModel.map((c) => fmt(c, 3)).join(', ')}).</div>`}
    ${mass <= 0 ? '<div class="bad">Plane is below the body.</div>' : ''}`;
  $('tApply').disabled = false;

  if (preview) {
    S.preview = { rel, H: Hm };
    placeStatic(R, Hm);
    renderStats(Hm, 'preview');
    showBanner(`Previewing target float plane — needs ${kg(mass)}`, 'Exit preview', () => { S.preview = null; hideBanner(); update(); });
    scheduleGZ();
  }
}
function zr(rel) { let lo = Infinity, hi = -Infinity; for (let i = 2; i < rel.length; i += 3) { lo = Math.min(lo, rel[i]); hi = Math.max(hi, rel[i]); } return [lo, hi]; }

function showBanner(text, btn, fn) {
  const b = $('banner'); b.innerHTML = ''; b.append(text);
  if (btn) { const x = document.createElement('button'); x.textContent = btn; x.onclick = fn; b.append(x); }
  b.classList.remove('hidden');
}
function hideBanner() { $('banner').classList.add('hidden'); }

// ------------------------------------------------------------------ simulation
function makeSim() {
  const R = getR();
  const G = getCogM();
  const m = getMass();
  const bodyTris = transformTris(S.model.tris, mat3.identity(), G);
  const st = S.last.H;
  return new FloatSim({
    bodyTris, mass: m, inertiaG: inertiaG(), rho: S.rho,
    q0: mat3ToQuat(R), z0: -st.zw, zeta: parseFloat($('zeta').value),
    awpRef: Math.max(st.wp.area, 1e-6),
  });
}
function startSim() {
  if (!S.model || getMass() <= 0) return;
  S.preview = null; hideBanner();
  if (!S.sim) {
    S.sim = makeSim();
    const H = S.last.H;
    S.simFromRest = H.status !== 'sinks' && Math.hypot(...H.offset) < S.model.diag * 1e-4;
  }
  S.simRunning = true; $('simRun').textContent = '❚❚ Pause';
}
function stopSim() {
  S.simRunning = false; S.settling = false;
  $('simRun').textContent = '▶ Simulate';
  if (S.sim) $('simApply').disabled = false;
}
$('simRun').onclick = () => (S.simRunning ? stopSim() : startSim());
$('simReset').onclick = () => { stopSim(); S.sim = null; $('simInfo').textContent = ''; update(); };
$('simSettle').onclick = () => { startSim(); S.settling = true; };
$('simApply').onclick = () => {
  if (!S.sim) return;
  const R = quatToMat3(S.sim.q);
  stopSim(); S.sim = null;
  setEuler(mat3.toEulerDeg(R)); update();
};
$('zeta').oninput = (e) => { $('zetaV').textContent = e.target.value; if (S.sim) S.sim.zeta = parseFloat(e.target.value); };
$('speed').oninput = (e) => { $('speedV').textContent = `${e.target.value}×`; };

function simFrame(dtReal) {
  const sim = S.sim;
  const triCount = sim.b.length / 9;
  const budget = Math.max(1, Math.floor(4e6 / Math.max(1, triCount)));    // keep each frame affordable
  const span = S.settling ? budget * sim.dt : dtReal * parseFloat($('speed').value);
  const steps = Math.min(budget, Math.ceil(span / sim.dt));
  sim.advance(steps * sim.dt, steps);
  const R = quatToMat3(sim.q);
  setBodyPose(R, sim.p);
  // analysis of current instantaneous state (relative to G)
  const rel = transformTris(sim.b, R);
  const H = hydrostatics(rel, -sim.p[2], getMass(), S.rho);
  drawMarkers(sim.p, H);
  const e = mat3.toEulerDeg(R);
  const ke = Math.hypot(...sim.v) / S.model.diag + Math.hypot(...sim.w);
  const settled = sim.t > 1 && ke < 2e-4;
  $('simInfo').innerHTML = `t = <b>${fmt(sim.t, 2)} s</b> · roll <b>${fmt(e[0], 1)}°</b> pitch <b>${fmt(e[1], 1)}°</b> yaw <b>${fmt(e[2], 1)}°</b><br>
    draft <b>${L(H.draft)}</b> · GM<sub>T</sub> <b>${L(H.GMt)}</b> · B–G offset <b>${L(Math.hypot(...H.offset))}</b>
    ${settled ? '<br><span class="good">Settled — this is a stable resting attitude.</span>' : ''}
    ${settled && S.simFromRest ? '<br><span class="hint">It started at rest in this attitude, so there was nothing to move. Tilt it under Start attitude to watch it right itself.</span>' : ''}`;
  if (S.settling && !settled && sim.t > 900) {
    stopSim(); $('simInfo').innerHTML += '<br><span class="warn">Did not settle within 900 s of simulated time — try more damping.</span>';
  }
  if (settled && S.settling) {
    stopSim();
    const Rs = quatToMat3(S.sim.q); S.sim = null;
    setEuler(mat3.toEulerDeg(Rs)); update();
  }
}

// ------------------------------------------------------------------ demos
function loadDemo(kind) {
  let geo, mass, name;
  if (kind === 'box') {
    geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0, 0.5); mass = 500; name = '1 m cube (demo)';
  } else if (kind === 'log') {
    geo = new THREE.CylinderGeometry(0.2, 0.2, 3, 48, 1); geo.rotateZ(Math.PI / 2); geo.translate(0, 0, 0.2); mass = 70; name = 'Log Ø0.4×3 m (demo)';
  } else {
    // hard-chine barge: cross-section in (y, z), extruded along x with raked ends
    const sh = new THREE.Shape();
    sh.moveTo(-0.45, 0); sh.lineTo(0.45, 0); sh.lineTo(0.8, 0.25); sh.lineTo(0.8, 0.8); sh.lineTo(-0.8, 0.8); sh.lineTo(-0.8, 0.25); sh.closePath();
    geo = new THREE.ExtrudeGeometry(sh, { depth: 4, bevelEnabled: false });
    // (x, y, z) → (z, x, y): extrusion along model X, Z up (cyclic permutation keeps winding)
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, z - 2, x, y); }
    mass = 1500; name = 'Barge hull 4×1.6×0.8 m (demo)';
  }
  const g2 = geo.index ? geo.toNonIndexed() : geo;
  setModel(name, soupFromIndexed(g2.attributes.position.array, null), 1, { mass, rawScale: 1 });
  if (kind === 'hull') { const c = S.model.mp.centroid; setCog([c[0], c[1], 0.3]); update(); }
}

// ------------------------------------------------------------------ render loop
let lastT = performance.now();
const tmp = new THREE.Vector3(), tmpW = new THREE.Vector3();
function frame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
  if (S.simRunning && S.sim) simFrame(dt);
  if (sea && sea.running) sea.frame(dt);
  if (drop && drop.running) drop.frame(dt);
  controls.update();
  renderer.render(scene, camera);
  const r = canvas.getBoundingClientRect();
  const showLabels = $('showLabels').checked;
  const place = (el, world) => {
    tmp.copy(world).project(camera);
    if (tmp.z > 1) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.left = `${(tmp.x * 0.5 + 0.5) * r.width}px`;
    el.style.top = `${(-tmp.y * 0.5 + 0.5) * r.height}px`;
  };
  // world positions: during a wave run the scene is turned to the global frame (see setFrameYaw)
  for (const [k, obj] of Object.entries(labelTargets)) {
    const el = labels[k];
    if (!S.model || !obj.visible || !showLabels) { el.style.display = 'none'; continue; }
    place(el, obj.getWorldPosition(tmpW));
  }
  AXES.forEach(([, d], i) => {
    const el = axisLabels[i];
    if (!S.model || !axesGroup.visible || !showLabels) { el.style.display = 'none'; return; }
    place(el, body.localToWorld(tmpW.set(...d).multiplyScalar(axisLen * 1.12)));
  });
  drawTriad();
  requestAnimationFrame(frame);
}
resize();
$('tMode').dispatchEvent(new Event('change'));
// ------------------------------------------------------------------ picking a point on the model (one click)
// cb(pointInModelCoordinates_m | null). A drag (orbiting) is not a click; Esc cancels.
const raycaster = new THREE.Raycaster();
let pickCb = null, downAt = null;
function pick(cb) { pickCb = cb; canvas.style.cursor = 'crosshair'; }
function endPick(p) { const cb = pickCb; pickCb = null; canvas.style.cursor = ''; if (cb) cb(p); }
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!pickCb || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || !bodyMesh) return;
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = raycaster.intersectObject(bodyMesh, false)[0];
  if (!hit) return;   // keep waiting for a click on the body
  endPick(bodyMesh.worldToLocal(hit.point.clone()).toArray());
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' && pickCb) endPick(null); });

// ------------------------------------------------------------------ workspace chrome
initProgress();
ui = initUI({
  setView,
  onStage: () => {},
  clearDropRuns: () => { if (drop) drop.clearRuns(); },
});

// ------------------------------------------------------------------ seakeeping (waves, RAOs)
const staticOverlays = [mB, mMt, mMl, arrW, arrB, vertLine, gLine, wlLines];
extras = initExtras({
  THREE, scene, bodyLocal, unitScale, unitName, pick,
  getState: () => (S.model && S.last ? { model: S.model, ...S.last } : null),
  setBanner: (t) => (t ? showBanner(t, 'Cancel', () => endPick(null)) : hideBanner()),
  onChange: () => { if (sea) sea.onExtrasChange(); },
});
sea = initSeakeeping({
  THREE, scene, renderer, water, waterDepth, mG, extras,
  getState: () => (S.model && S.last ? { model: S.model, ...S.last } : null),
  getEuler, setBodyPose, getInertiaBody: () => inertiaG(), inertiaKey: () => JSON.stringify(inertiaG()),
  stopCalmSim: () => { stopSim(); S.sim = null; S.preview = null; hideBanner(); },
  setStaticOverlays: (on) => { for (const o of staticOverlays) o.visible = on; },
  refresh: () => update(),
  onTabShown: (id) => { if (id === 'tabDrop' && drop) drop.onTab(); },
  // Wave runs are computed with the model's yaw removed (its +x along the run's x axis). Turning the scene by the
  // yaw shows them in the global frame, so the wave direction (entered from global +X) reads as it should.
  setFrameYaw: (a) => { scene.rotation.z = a; scene.updateMatrixWorld(); },
  // keep the camera on the body while it drifts in waves (pan camera and orbit target together); x, y in the run frame
  follow: (x, y, z = null) => {
    const a = scene.rotation.z, c = Math.cos(a), s = Math.sin(a);
    const dx = c * x - s * y - controls.target.x, dy = s * x + c * y - controls.target.y, dz = z === null ? 0 : z - controls.target.z;
    controls.target.x += dx; controls.target.y += dy; controls.target.z += dz;
    camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
  },
  recenter: () => frameCamera(),
  viewCenter: () => {
    const a = -scene.rotation.z, c = Math.cos(a), s = Math.sin(a), tx = controls.target.x, ty = controls.target.y;
    return [c * tx - s * ty, s * tx + c * ty];
  },
});
drop = initDropTest({
  THREE, scene, mG, mB,
  getState: () => (S.model && S.last ? { model: S.model, ...S.last } : null),
  getInertiaBody: () => inertiaG(), setBodyPose, unitScale, unitName, diag: () => S.model.diag,
  stopCalmSim: () => { stopSim(); S.sim = null; S.preview = null; hideBanner(); },
  setStaticOverlays: (on) => { for (const o of staticOverlays) o.visible = on; },
  setLocked: (on) => { sea.setLocked(on); for (const id of ['simRun', 'simSettle']) $(id).disabled = on; ui.setLocked(on); },
  getEuler,
  showTab: (id) => sea.showTab(id),
  simCoeffs: () => sea.simCoeffs(),
  ensureSimBem: (cb) => sea.ensureSimBem(cb),
  refresh: () => update(),
  recenter: () => frameCamera(),
  follow: (x, y, z) => {
    const dx = x - controls.target.x, dy = y - controls.target.y, dz = z - controls.target.z;
    controls.target.x += dx; controls.target.y += dy; controls.target.z += dz;
    camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
  },
});
loadDemo('hull');
requestAnimationFrame(frame);
