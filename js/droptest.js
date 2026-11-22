// Drop / rise test UI: release the body from a chosen height above or below the surface and watch it
// fall in, plunge and recover, or rise from depth, break the surface and settle. Independent of the RAO
// and sea-state tools, which are locked while the body is placed away from its float position.
import { mat3, transformTris, solveWaterline, submerged, quatToMat3, mat3ToQuat } from './physics.js';
import { defaultHydroCoeffs } from './hydro.js';
import { DropSim } from './sim.js';
import { lineChart, SERIES } from './charts.js';

const $ = (id) => document.getElementById(id);
const f = (x, d = 3) => (Number.isFinite(x) ? (Math.abs(x) < 1e-9 ? 0 : +x.toPrecision(d)).toLocaleString() : '—');

// Typical drag coefficients (Hoerner, Fluid-Dynamic Drag, 1965; subcritical Reynolds numbers)
const PRESETS = { sphere: 0.47, cube: 1.05, cylSide: 1.2, plate: 1.28, cylAxial: 0.82, streamlined: 0.04 };

export function initDropTest(api) {
  const { THREE } = api;
  const D = { placed: false, running: false, sim: null, start: null, lastChart: 0, done: false };

  const wl = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }));
  wl.renderOrder = 8; wl.visible = false; api.scene.add(wl);

  const units = () => ({ k: api.unitScale(), name: api.unitName() });
  const Lm = (m) => `${f(m / units().k, 4)} ${units().name}`;

  // ------------------------------------------------------------ inputs
  $('dzPreset').onchange = (e) => {
    const v = PRESETS[e.target.value];
    if (v !== undefined) { $('dzCdW').value = v; $('dzCdA').value = v; }
  };
  for (const id of ['dzCdW', 'dzCdA']) $(id).addEventListener('input', () => { $('dzPreset').value = 'custom'; });
  $('dzSpeed').oninput = (e) => { $('dzSpeedV').textContent = `${e.target.value}×`; };
  $('dzUseEq').onclick = () => { const eq = equilibrium(); if (eq) { $('dzH').value = +(eq.zG / units().k).toPrecision(6); describeStart(); } };
  $('dzH').addEventListener('input', describeStart);

  // CoG height above still water when floating at rest in the current attitude
  function equilibrium() {
    const st = api.getState(); if (!st || st.H.status === 'sinks') return st ? { zG: NaN, sinks: true, st } : null;
    return { zG: -st.H.zw, st };
  }
  function geometryAt(zG) {
    const st = api.getState();
    const rel = st.rel;   // rotated hull relative to G
    let lo = Infinity, hi = -Infinity; for (let i = 2; i < rel.length; i += 3) { lo = Math.min(lo, rel[i]); hi = Math.max(hi, rel[i]); }
    return { bottom: zG + lo, top: zG + hi };
  }
  function describeStart() {
    const st = api.getState(); if (!st) return;
    const zG = (parseFloat($('dzH').value) || 0) * units().k;
    const eq = equilibrium(), g = geometryAt(zG);
    const where = g.bottom >= 0 ? '<b>entirely in air</b>: it falls under gravity with air drag'
      : g.top <= 0 ? '<b>fully submerged</b>: it rises (or sinks) under net buoyancy with water drag'
        : 'partly submerged';
    $('dzWhere').innerHTML = `Start: body ${where}. Lowest point ${Lm(g.bottom)}, highest ${Lm(g.top)} relative to the surface.
      ${eq && Number.isFinite(eq.zG) ? `Floating at rest the CoG sits at ${Lm(eq.zG)}.` : '<span class="bad">The body is denser than water and will sink.</span>'}`;
  }

  // ------------------------------------------------------------ place / reset / lock
  function place() {
    const st = api.getState(); if (!st) return;
    stop();
    api.stopCalmSim();
    const zG = (parseFloat($('dzH').value) || 0) * units().k;
    D.placed = true; D.done = false; D.sim = null;
    D.start = { zG, R: st.R };
    api.setLocked(true);
    api.setStaticOverlays(false);
    showPose(st.R, [0, 0, zG]);
    api.follow(0, 0, zG);
    $('dzRun').disabled = false; $('dzReset').disabled = false;
    $('dzInfo').innerHTML = `Placed with the CoG at ${Lm(zG)}. Press <b>Release</b> to start. The RAO and sea-state tools are locked until you reset the position.`;
    api.showTab('tabDrop');
    drawCharts(); renderStats();
  }
  function reset() {
    stop();
    D.placed = false; D.sim = null; D.done = false;
    wl.visible = false; api.mB.visible = true;
    api.setLocked(false);
    api.setStaticOverlays(true);
    api.refresh(); api.recenter();
    $('dzRun').disabled = true; $('dzReset').disabled = true; $('dzRun').textContent = '▶ Release';
    $('dzInfo').textContent = 'Position reset to the floating equilibrium.';
  }
  $('dzPlace').onclick = place;
  $('dzReset').onclick = reset;

  function showPose(R, p) {
    api.setBodyPose(R, p);
    api.mG.position.set(...p);
    // centre of buoyancy and waterline at this pose
    const st = api.getState();
    const world = transformTris(st.rel, mat3.mul(R, mat3.transpose(st.R)), [0, 0, 0], p);
    const s = submerged(world, 0, true);
    api.mB.visible = s.V > 0;
    if (s.V > 0) api.mB.position.set(...s.B);
    const pts = new Float32Array((s.segs.length / 4) * 6);
    for (let i = 0, j = 0; i < s.segs.length; i += 4, j += 6) { pts[j] = s.segs[i]; pts[j + 1] = s.segs[i + 1]; pts[j + 2] = 1e-4; pts[j + 3] = s.segs[i + 2]; pts[j + 4] = s.segs[i + 3]; pts[j + 5] = 1e-4; }
    wl.geometry.dispose(); wl.geometry = new THREE.BufferGeometry();
    wl.geometry.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    wl.visible = s.segs.length > 0;
  }

  // ------------------------------------------------------------ run
  function makeSim() {
    const st = api.getState();
    const G = st.G, m = st.m;
    const bodyTris = transformTris(st.model.tris, mat3.identity(), G);
    // added mass & reference frequency from the floating hydrostatics (heave natural frequency)
    const IG = api.getInertiaBody();
    let A = [0, 0, 0], wRef = 1, B33 = null, Brot = null;
    D.coeffNote = 'estimates';
    if (st.H.status !== 'sinks' && st.H.wp.area > 0) {
      const IGw = mat3.mul(st.R, mat3.mul(IG, mat3.transpose(st.R)));
      const c = defaultHydroCoeffs(st.H, m, IGw, st.rho);
      A = c.A.slice(0, 3);
      // panel-method added mass and radiation damping at the natural frequencies (section 7 switch), if available
      const pm = api.simCoeffs ? api.simCoeffs() : null;
      if (pm) { A = pm.A.slice(0, 3); B33 = pm.Bd[2]; Brot = pm.Bd.slice(3, 6); D.coeffNote = `panel method (from ${pm.source})`; }
      wRef = Math.sqrt(st.rho * 9.80665 * st.H.wp.area / (m + A[2]));
    }
    return new DropSim({
      bodyTris, mass: m, inertiaG: IG, rhoW: st.rho, rhoA: Math.max(0, parseFloat($('dzRhoA').value) || 1.225),
      CdW: Math.max(0, parseFloat($('dzCdW').value) || 0), CdA: Math.max(0, parseFloat($('dzCdA').value) || 0),
      q0: mat3ToQuat(D.start.R), z0: D.start.zG, vz0: parseFloat($('dzV0').value) || 0, addedMass: A, wRef,
      zetaRot: 0.1, zetaHeave: 0.15, B33, Brot,
    });
  }
  async function start() {
    if (D.starting) return;
    if (!D.placed) place();
    if (!D.sim || D.done) {
      if (api.ensureSimBem) {
        D.starting = true;
        try { await api.ensureSimBem((t) => { $('dzInfo').innerHTML = t; }); }
        catch (err) { $('dzInfo').innerHTML = err && err.cancelled ? '<span class="warn">Panel method skipped: using the added-mass and damping estimates.</span>' : `<span class="warn">Panel-method coefficients failed (${err.message}); using the estimates.</span>`; }
        finally { D.starting = false; }
      }
      D.sim = makeSim(); D.done = false;
    }
    D.running = true; $('dzRun').textContent = '❚❚ Pause';
  }
  function stop() { D.running = false; $('dzRun').textContent = D.sim && !D.done ? '▶ Resume' : '▶ Release'; }
  $('dzRun').onclick = () => (D.running ? stop() : start());

  function frame(dtReal) {
    if (!D.running || !D.sim) return;
    const sim = D.sim;
    const span = dtReal * parseFloat($('dzSpeed').value);
    const budget = Math.max(20, Math.floor(3e6 / Math.max(1, sim.b.length / 9)));
    sim.advance(span, budget);
    const R = quatToMat3(sim.q);
    showPose(R, sim.p);
    api.follow(sim.p[0], sim.p[1], sim.p[2]);
    const st = api.getState();
    const phase = sim.last.f === 0 ? 'in air' : sim.last.f >= 0.999 ? 'fully submerged' : 'at the surface';
    const sinks = st.H.status === 'sinks' && sim.last.f >= 0.999 && sim.v[2] < 0 && sim.t > 5;
    if (sim.settled()) { D.done = true; stop(); $('dzRun').textContent = '▶ Release again'; }
    if (sinks || sim.t > sim.maxTime) { D.done = true; stop(); }
    if (D.done && !sim.logged) { sim.logged = true; logRun(sim, sinks); }
    const now = performance.now();
    if (now - D.lastChart > 200 || D.done) {
      D.lastChart = now;
      $('dzInfo').innerHTML = `t = <b>${f(sim.t, 4)} s</b> · ${phase} · CoG height <b>${Lm(sim.p[2])}</b> · vertical speed <b>${f(sim.v[2])} m/s</b> · submerged ${f(100 * sim.last.f, 3)} %
        ${D.done ? (sinks ? '<br><span class="bad">✕ The body is denser than water and keeps sinking.</span>' : sim.settled() ? `<br><span class="good">✓ Settled at the surface after ${f(sim.t)} s.</span>` : '<br><span class="warn">Stopped after the time limit.</span>') : ''}`;
      drawCharts(); renderStats(sinks);
    }
  }

  // ------------------------------------------------------------ results
  function drawCharts() {
    if ($('tabDrop').classList.contains('hidden')) return;
    const r = D.sim ? D.sim.rec : { t: [], z: [], vz: [], roll: [], pitch: [] };
    const eq = equilibrium(), k = units().k;
    const zU = r.z.map((z) => z / k);
    const ref = (val) => r.t.map(() => val);
    lineChart($('dzCvZ'), { series: [
      { name: 'CoG height', color: SERIES[0], x: r.t, y: zU },
      { name: 'water surface', color: '#6b7380', x: r.t, y: ref(0), width: 1, dash: [4, 3] },
      ...(eq && Number.isFinite(eq.zG) ? [{ name: 'float height', color: SERIES[2], x: r.t, y: ref(eq.zG / k), width: 1, dash: [2, 3] }] : []),
    ], xLabel: 't (s)', yLabel: `height (${units().name})`, height: 160 });
    lineChart($('dzCvV'), { series: [{ name: 'vertical speed', color: SERIES[1], x: r.t, y: r.vz }], xLabel: 't (s)', yLabel: 'speed (m/s)', height: 120, legend: false });
    lineChart($('dzCvA'), { series: [
      { name: 'roll', color: SERIES[0], x: r.t, y: r.roll },
      { name: 'pitch', color: SERIES[1], x: r.t, y: r.pitch },
    ], xLabel: 't (s)', yLabel: 'angle (deg)', height: 120 });
  }
  function renderStats(sinks = false) {
    const sim = D.sim, eq = equilibrium();
    if (!sim) { $('dzStats').innerHTML = ''; $('dropVerdict').innerHTML = D.placed ? '<b>Placed</b>Press Release to start the test.' : '<b>Not placed</b>Set a start height and orientation, then press Place at start.'; $('dropVerdict').className = 'verdict'; return; }
    const s = sim.st, startAir = s.startFrac === 0, startSub = s.startFrac >= 0.999;
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    const depth = Number.isFinite(s.minBottom) ? Math.max(0, -s.minBottom) : 0;
    const rows = [
      row('Start', `${startAir ? 'in air' : startSub ? 'fully submerged' : 'at the surface'}, CoG at ${Lm(D.start.zG)}`),
      row('<b>Max submersion depth</b>', `<b>${Lm(depth)}</b> (lowest point below the still water)`),
      row('<b>Max rise rate</b>', `<b>${f(s.maxRise)} m/s</b> (largest upward speed of the CoG)`),
      startAir ? row('Water entry speed', s.entrySpeed !== null ? `${f(s.entrySpeed)} m/s (drag-free fall of the lowest point from ${Lm(geometryAt(D.start.zG).bottom)}: √(2gh) = ${f(Math.sqrt(Math.max(0, (parseFloat($('dzV0').value) || 0) ** 2 + 2 * 9.80665 * Math.max(0, geometryAt(D.start.zG).bottom))))} m/s)` : 'not yet') : '',
      row('Deepest CoG position', `${Lm(s.minZ)}${eq && Number.isFinite(eq.zG) ? ` (${Lm(s.minZ - eq.zG)} relative to the float height)` : ''}`),
      row('Went fully under water', s.fullySubmerged ? 'yes' : 'no'),
      s.breachT !== null ? row('Broke the surface at', `${f(s.breachT)} s; rose to ${Lm(s.maxZafterBreach)}${eq && Number.isFinite(eq.zG) ? ` (${Lm(s.maxZafterBreach - eq.zG)} above the float height)` : ''}`) : '',
      row('Maximum speed', `${f(s.terminal)} m/s`),
      sim.settled() ? row('Settled', `after ${f(sim.t)} s at ${Lm(sim.p[2])}${eq && Number.isFinite(eq.zG) ? ` (static float height ${Lm(eq.zG)})` : ''}`) : '',
    ].join('');
    $('dzStats').innerHTML = `<table>${rows}</table><span class="hint">Simple model: quadratic drag on the CoG velocity using the hull's projected area, water/air blended by the submerged fraction, added mass and rotational damping scaled by submergence, linear wave-making damping while surface-piercing. No slamming pressures, splash or cavity effects. Added mass &amp; wave damping: ${D.coeffNote || 'estimates'}.</span>`;
    const v = $('dropVerdict');
    if (sinks) { v.className = 'verdict bad'; v.innerHTML = '<b>✕ Sinks</b>The body is denser than water.'; }
    else if (sim.settled()) { v.className = 'verdict good'; v.innerHTML = `<b>✓ Stabilized</b>Settled at the surface after ${f(sim.t)} s${s.fullySubmerged ? `, after going fully under water${startAir ? ` (plunged to ${Lm(s.minZ)})` : ''}` : ''}.`; }
    else { v.className = 'verdict'; v.innerHTML = `<b>Running</b>t = ${f(sim.t, 4)} s`; }
  }

  // ------------------------------------------------------------ runs table (repeat drops with other heights / attitudes)
  D.runs = [];
  function logRun(sim, sinks) {
    const e = api.getEuler ? api.getEuler() : [0, 0, 0], s = sim.st;
    D.runs.push({
      n: D.runs.length + 1, zG: D.start.zG, euler: e, depth: Number.isFinite(s.minBottom) ? Math.max(0, -s.minBottom) : 0,
      rise: s.maxRise, entry: s.entrySpeed, result: sinks ? 'sinks' : sim.settled() ? `settled ${f(sim.t)} s` : 'time limit',
    });
    renderRuns();
  }
  function renderRuns() {
    if (!D.runs.length) { $('dzRuns').innerHTML = '<span class="hint">Each finished release is listed here, so you can change the height or orientation and compare.</span>'; return; }
    const deg = (v) => `${+(+v).toFixed(1)}`;
    $('dzRuns').innerHTML = `<table class="runs"><tr><th>Run</th><th>Start</th><th>Roll, pitch, yaw °</th><th>Max depth</th><th>Max rise</th><th>Result</th></tr>${D.runs.map((r, i) => `
      <tr class="${i === D.runs.length - 1 ? 'last' : ''}"><td>${r.n}</td><td>${Lm(r.zG)}</td><td>${r.euler.map(deg).join(', ')}</td><td>${Lm(r.depth)}</td><td>${f(r.rise)} m/s</td><td>${r.result}</td></tr>`).join('')}</table>`;
  }
  renderRuns();

  return {
    frame,
    clearRuns() { D.runs = []; renderRuns(); },
    get placed() { return D.placed; },
    get running() { return D.running; },
    onTab() { drawCharts(); renderStats(); },
    onModelChange() {
      describeStart();
      if (D.placed && !D.running) { const st = api.getState(); if (st) { D.start.R = st.R; D.sim = null; showPose(st.R, [0, 0, D.start.zG]); renderStats(); } }
    },
    onNewModel() { if (D.placed) reset(); const eq = equilibrium(); if (eq && Number.isFinite(eq.zG)) $('dzH').value = +((eq.zG + api.diag()) / units().k).toPrecision(4); describeStart(); },
  };
}
