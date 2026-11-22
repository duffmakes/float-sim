// UI for the small-body options (sections 10–13): tracked points, viscous drag & heave plates, mooring, wind.
// Holds the inputs, draws the markers and mooring lines in 3D, and hands the seakeeping module a plain config
// (model coordinates in metres). All four options are off / empty by default.
import { LINE_PRESETS, catenaryShape, quasiStaticForce } from './mooring.js';
import { DRAG_PRESETS } from './drag.js';
import { SERIES } from './charts.js';

const $ = (id) => document.getElementById(id);
const num = (id, def = 0) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : def; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function initExtras(api) {
  const { THREE } = api;
  const E = { points: [], plates: [], picking: null, lineObjs: [] };
  const us = () => api.unitScale(), un = () => api.unitName();
  const toDisp = (m) => +(m / us()).toPrecision(6);

  // ------------------------------------------------------------ 3D: markers attached to the body (model coordinates)
  const local = api.bodyLocal;   // group in the body frame, offset so model coordinates can be used directly
  const markers = new THREE.Group(); local.add(markers);
  const sphere = new THREE.SphereGeometry(1, 16, 12);
  // a point keeps its colour everywhere: the 3D marker and its line in the charts take the same categorical slot
  const PT_COLORS = SERIES.slice(0, 6).map((h) => parseInt(h.slice(1), 16));
  const LINE_COLOR = parseInt(SERIES[1].slice(1), 16);   // the mooring line: same orange as its tension chart
  const mooringGroup = new THREE.Group(); api.scene.add(mooringGroup);
  function drawMarkers() {
    for (const c of [...markers.children]) { markers.remove(c); if (c.geometry && c.geometry !== sphere) c.geometry.dispose(); }
    const st = api.getState(); if (!st) return;
    // a new model with mooring on: put the fairlead at its keel point once its state exists
    if ($('moorOn').checked && !E.fairleadSet) { const k = keelPoint(); $('mfX').value = toDisp(k[0]); $('mfY').value = toDisp(k[1]); $('mfZ').value = toDisp(k[2]); E.fairleadSet = true; }
    const d = st.model.diag, rad = d * 0.012;
    E.points.forEach((p, i) => {
      const m = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: PT_COLORS[i % PT_COLORS.length], depthTest: false }));
      m.renderOrder = 11; m.scale.setScalar(rad); m.position.set(...p.p.map((v) => v * us())); markers.add(m);
    });
    if ($('dragOn').checked) for (const pl of E.plates) {
      const D = pl.D * us();
      if (!(D > 0)) continue;
      const g = new THREE.CylinderGeometry(D / 2, D / 2, Math.max(D * 0.02, d * 0.004), 40);
      g.rotateX(Math.PI / 2);   // axis along z
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8fa3bf, metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide }));
      m.position.set(...pl.c.map((v) => v * us()));
      // horizontal when floating: normal along the equilibrium vertical, i.e. Rᵀ ẑ in model axes
      const R = st.R, n = new THREE.Vector3(R[6], R[7], R[8]);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.normalize());
      markers.add(m);
    }
    if ($('moorOn').checked) {
      const f = fairleadModel();
      const m = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: LINE_COLOR, depthTest: false }));
      m.renderOrder = 11; m.scale.setScalar(rad * 0.9); m.position.set(...f); markers.add(m);
    }
  }
  // mooring lines (world): polylines from each anchor to the fairlead, with an anchor marker
  function setLines(polys, anchors) {
    for (const c of [...mooringGroup.children]) { mooringGroup.remove(c); if (c.geometry) c.geometry.dispose(); }
    if (!polys) return;
    const st = api.getState(), d = st ? st.model.diag : 1;
    for (const pts of polys) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: LINE_COLOR })); l.renderOrder = 9; mooringGroup.add(l);
    }
    for (const a of anchors || []) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(d * 0.06, d * 0.06, d * 0.03), new THREE.MeshBasicMaterial({ color: LINE_COLOR }));
      m.position.set(a[0], a[1], a[2] + d * 0.015); mooringGroup.add(m);
    }
  }
  // static picture at rest: P0 = { anchors: [[x, y, z]], fairleadWorld, cfg, rho }
  function drawRestLines(P0) {
    if (!P0) { setLines(null); return; }
    const polys = P0.cfg.lines.map((ln) => {
      const q = quasiStaticForce(P0.cfg, ln.anchor, P0.fairleadWorld, P0.rho);
      const sh = catenaryShape(q.sol, q.XF, q.ZF, P0.cfg.L, P0.w, P0.cfg.EA, 40);
      const out = [];
      for (const [x, z] of sh) out.push(ln.anchor[0] + q.ex * x, ln.anchor[1] + q.ey * x, -P0.cfg.depth + z);
      return out;
    });
    setLines(polys, P0.cfg.lines.map((ln) => [ln.anchor[0], ln.anchor[1], -P0.cfg.depth]));
  }

  // ------------------------------------------------------------ picking on the model
  function startPick(label, cb) {
    E.picking = cb;
    api.setBanner(`Click a point on the model for ${label} (Esc to cancel).`);
    api.pick((p) => { E.picking = null; api.setBanner(null); if (p) cb(p); });
  }

  // ------------------------------------------------------------ section 10: tracked points
  function renderPoints() {
    const u = esc(un());
    $('ptList').innerHTML = E.points.length ? E.points.map((p, i) => `
      <div class="ptrow" data-i="${i}">
        <div class="row"><label>Name <input data-k="name" type="text" value="${esc(p.name)}"></label>
          <label><span>Clearance (${u})</span> <input data-k="clear" type="number" step="any" min="0" value="${toDispPt(p.clearance)}"></label>
          <button class="ghost ptdel" title="Remove this point">✕</button></div>
        <div class="row three"><label>X <input data-k="0" type="number" step="any" value="${p.p[0]}"></label>
          <label>Y <input data-k="1" type="number" step="any" value="${p.p[1]}"></label>
          <label>Z <input data-k="2" type="number" step="any" value="${p.p[2]}"></label></div>
      </div>`).join('') : '<p class="hint">No points yet.</p>';
    drawMarkers();
  }
  const toDispPt = (v) => +(+v).toPrecision(6);
  // stored in display units (like the CoG inputs); converted to metres in config()
  $('ptList').addEventListener('change', (e) => {
    const row = e.target.closest('.ptrow'); if (!row) return;
    const p = E.points[+row.dataset.i], k = e.target.dataset.k;
    if (k === 'name') p.name = e.target.value || `P${+row.dataset.i + 1}`;
    else if (k === 'clear') p.clearance = Math.max(0, parseFloat(e.target.value) || 0);
    else p.p[+k] = parseFloat(e.target.value) || 0;
    drawMarkers(); api.onChange();
  });
  $('ptList').addEventListener('click', (e) => {
    if (!e.target.classList.contains('ptdel')) return;
    E.points.splice(+e.target.closest('.ptrow').dataset.i, 1); renderPoints(); api.onChange();
  });
  const addPoint = (pm) => {
    if (E.points.length >= 6) { $('ptInfo').innerHTML = '<span class="warn">Up to 6 points.</span>'; return; }
    E.points.push({ name: `P${E.points.length + 1}`, p: pm.map(toDisp), clearance: 0 });
    renderPoints(); api.onChange();
  };
  $('ptPick').onclick = () => startPick('the tracked point', addPoint);
  $('ptAdd').onclick = () => { const st = api.getState(); if (st) addPoint(st.G); };

  // ------------------------------------------------------------ section 11: drag & heave plates
  $('dragPreset').innerHTML = '<option value="">Custom</option>' + Object.entries(DRAG_PRESETS).map(([k, v]) => `<option value="${k}">${v.label}: ${v.Cd.join(' / ')}</option>`).join('');
  $('dragPreset').onchange = () => { const p = DRAG_PRESETS[$('dragPreset').value]; if (p) { ['dragCx', 'dragCy', 'dragCz'].forEach((id, i) => { $(id).value = p.Cd[i]; }); api.onChange(); } };
  for (const id of ['dragCx', 'dragCy', 'dragCz']) $(id).addEventListener('change', () => { $('dragPreset').value = ''; api.onChange(); });
  function renderPlates() {
    const u = esc(un());
    $('plList').innerHTML = E.plates.map((p, i) => `
      <div class="ptrow" data-i="${i}">
        <div class="row"><label><span>Diameter (${u})</span> <input data-k="D" type="number" step="any" min="0" value="${p.D}"></label>
          <label><span>C<sub>d</sub></span> <input data-k="Cd" type="number" step="any" min="0" value="${p.Cd}"></label>
          <button class="ghost pldel" title="Remove this plate">✕</button></div>
        <div class="row three"><label>X <input data-k="0" type="number" step="any" value="${p.c[0]}"></label>
          <label>Y <input data-k="1" type="number" step="any" value="${p.c[1]}"></label>
          <label>Z <input data-k="2" type="number" step="any" value="${p.c[2]}"></label></div>
      </div>`).join('');
    drawMarkers();
  }
  $('plList').addEventListener('change', (e) => {
    const row = e.target.closest('.ptrow'); if (!row) return;
    const p = E.plates[+row.dataset.i], k = e.target.dataset.k;
    if (k === 'D' || k === 'Cd') p[k] = Math.max(0, parseFloat(e.target.value) || 0); else p.c[+k] = parseFloat(e.target.value) || 0;
    drawMarkers(); api.onChange();
  });
  $('plList').addEventListener('click', (e) => { if (!e.target.classList.contains('pldel')) return; E.plates.splice(+e.target.closest('.ptrow').dataset.i, 1); renderPlates(); api.onChange(); });
  $('plAdd').onclick = () => {
    const st = api.getState(); if (!st || E.plates.length >= 4) return;
    // default: under the keel on the model's vertical through the CoG, as wide as the body
    const bb = st.model.bb, D = Math.max(st.model.size[0], st.model.size[1]);
    E.plates.push({ c: [st.G[0], st.G[1], bb.min[2] - 0.1 * st.model.size[2]].map(toDisp), D: toDisp(D * 1.5), Cd: 1.2 });
    renderPlates(); api.onChange();
  };
  $('dragOn').onchange = () => { $('dragBox').classList.toggle('dim', !$('dragOn').checked); drawMarkers(); api.onChange(); };

  // ------------------------------------------------------------ section 12: mooring
  $('moorPreset').innerHTML = Object.entries(LINE_PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('') + '<option value="">Custom</option>';
  const applyLinePreset = () => {
    const p = LINE_PRESETS[$('moorPreset').value]; if (!p) return;
    $('mlM').value = p.m; $('mlRhoM').value = p.rhoM; $('mlEA').value = p.EA; $('mlD').value = +(p.d * 1000).toPrecision(4); $('mlCdn').value = p.Cdn; $('mlCdt').value = p.Cdt;
  };
  $('moorPreset').onchange = () => { applyLinePreset(); api.onChange(); };
  applyLinePreset();
  for (const id of ['mlM', 'mlRhoM', 'mlEA', 'mlD', 'mlCdn', 'mlCdt', 'mlCa']) $(id).addEventListener('change', () => { $('moorPreset').value = ''; api.onChange(); });
  for (const id of ['moorDepth', 'moorL', 'moorR', 'moorN', 'moorDir', 'moorModel', 'moorSeg', 'mfX', 'mfY', 'mfZ']) $(id).addEventListener('change', () => { drawMarkers(); api.onChange(); });
  $('moorModel').addEventListener('change', () => { $('moorSegWrap').classList.toggle('hidden', $('moorModel').value !== 'dynamic'); });
  const keelPoint = () => { const st = api.getState(); return st ? [st.G[0], st.G[1], st.model.bb.min[2]] : [0, 0, 0]; };
  const setFairlead = (pm) => { $('mfX').value = toDisp(pm[0]); $('mfY').value = toDisp(pm[1]); $('mfZ').value = toDisp(pm[2]); drawMarkers(); api.onChange(); };
  const fairleadModel = () => [num('mfX'), num('mfY'), num('mfZ')].map((v) => v * us());
  $('mfPick').onclick = () => startPick('the fairlead (where the line attaches)', setFairlead);
  $('mfKeel').onclick = () => setFairlead(keelPoint());
  $('moorOn').onchange = () => {
    $('moorBox').classList.toggle('dim', !$('moorOn').checked);
    if ($('moorOn').checked && !E.fairleadSet) { setFairlead(keelPoint()); E.fairleadSet = true; }
    if (!$('moorOn').checked) setLines(null);
    drawMarkers(); api.onChange();
  };

  // ------------------------------------------------------------ section 13: wind
  $('windOn').onchange = () => { $('windBox').classList.toggle('dim', !$('windOn').checked); api.onChange(); };
  for (const id of ['windU', 'windDir', 'windCd', 'windGust', 'windSame']) $(id).addEventListener('change', () => { $('windDir').disabled = $('windSame').checked; api.onChange(); });
  $('windDir').disabled = $('windSame').checked;

  // ------------------------------------------------------------ config for the seakeeping module (metres, model axes)
  function config(waveHeading = 90) {
    const k = us();
    const cfg = {
      points: E.points.map((p) => ({ name: p.name, p: p.p.map((v) => v * k), clearance: (p.clearance || 0) * k })),
      drag: null, moor: null, wind: null,
    };
    if ($('dragOn').checked) {
      cfg.drag = { Cd: ['dragCx', 'dragCy', 'dragCz'].map((id) => Math.max(0, num(id, 0))), plates: E.plates.filter((p) => p.D > 0).map((p) => ({ c: p.c.map((v) => v * k), D: p.D * k, Cd: p.Cd })) };
    }
    if ($('moorOn').checked) {
      cfg.moor = {
        depth: Math.max(0.1, num('moorDepth', 20)), L: Math.max(0.1, num('moorL', 40)), R: Math.max(0, num('moorR', 0)), n: Math.max(1, Math.min(4, Math.round(num('moorN', 1)))),
        dir: num('moorDir', 0), f: fairleadModel(), model: $('moorModel').value, nSeg: Math.max(4, Math.min(60, Math.round(num('moorSeg', 16)))),
        line: { m: Math.max(1e-6, num('mlM', 1)), rhoM: Math.max(1, num('mlRhoM', 7850)), EA: Math.max(1, num('mlEA', 1e6)), d: Math.max(1e-5, num('mlD', 10) / 1000), Cdn: Math.max(0, num('mlCdn', 1.2)), Cdt: Math.max(0, num('mlCdt', 0.01)), Can: Math.max(0, num('mlCa', 1)) },
      };
    }
    if ($('windOn').checked) {
      cfg.wind = { U10: Math.max(0, num('windU', 0)), dir: $('windSame').checked ? waveHeading : num('windDir', 90), Cd: Math.max(0, num('windCd', 1)), gusts: $('windGust').checked, seed: Math.round(num('windSeed', 7)) };
    }
    return cfg;
  }

  return {
    config,
    drawMarkers, drawRestLines, setLines,
    setInfo(id, html) { $(id).innerHTML = html; },
    // a new model: points and plates belonged to the old one
    onNewModel() { E.points = []; E.plates = []; E.fairleadSet = false; renderPoints(); renderPlates(); setLines(null); },
    onUnits(prev, now) {
      const c = (v) => +(v * prev / now).toPrecision(6);
      for (const p of E.points) { p.p = p.p.map(c); p.clearance = c(p.clearance || 0); }
      for (const p of E.plates) { p.c = p.c.map(c); p.D = c(p.D); }
      for (const id of ['mfX', 'mfY', 'mfZ']) $(id).value = c(num(id));
      renderPoints(); renderPlates();
    },
    pointCount: () => E.points.length,
    pointNames: () => E.points.map((p) => p.name),
    colors: PT_COLORS,
  };
}
