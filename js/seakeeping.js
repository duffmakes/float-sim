// Sea-state simulation, spectral stability estimates and RAO sweeps (UI glue).
import { mat3, transformTris, solveWaterline, hydrostatics, gzAnalysis, gmAbout, quatToMat3 } from './physics.js';
import { SEA_STATES, spectrumFn, pmSpectrum, jonswapSpectrum, dnvGamma, WaveField, G, regularAmplitude, waveNumber } from './waves.js';
import {
  refineTris, indexMesh, waveForces, linearModel, defaultHydroCoeffs, raoSweepAsync, raoAt, spectralResponse, spectralFromSweep, fkExcitation, spectralResponseMulti,
  diffractionCheck, waterplaneExtent, bodyFrameVolQ, DOF, bemSweep, raoAtBem, bemNatural, bemExtraDamping, bemCoeffsAt,
} from './hydro.js';
import { runBem } from './bemrun.js';
import { runCapytaine, capytaineStatus } from './capytaine.js';
import { WaveSim, seriesStats } from './sim.js';
import { lineChart, heatmap, SERIES, rampColor } from './charts.js';
import { startTask } from './progress.js';
import { meanWettedTris } from './hydro.js';
import { dragGeometry, plateAddedMass, dragElements, dragLinear, linearizeDrag } from './drag.js';
import { anchorLayout, mooringLoads, mooringStiffness, mooringOffset, submergedWeight, quasiStaticForce, catenaryShape } from './mooring.js';
import { windLoads, windageCentroid, froyaVariance, RHO_AIR, windAt } from './wind.js';
import { pointSpectral, pointRegular, followErrors, followCutoff } from './tracking.js';
import { sweepAtPoint, raoAtPoint } from './refcsys.js';

const $ = (id) => document.getElementById(id);
const f = (x, d = 3) => (Number.isFinite(x) ? (+x.toPrecision(d)).toLocaleString() : '—');

export function initSeakeeping(api) {
  const { THREE } = api;
  const K = { prep: null, sim: null, running: false, worker: null, stats: null, rao: null, lastChart: 0, specType: 'jonswap', waveMode: 'spectrum', simBem: null, bemRun: null };

  // ------------------------------------------------------------ wave surface mesh
  // Water that shows the waves: crests lighter and troughs darker (scaled to the sea's amplitude, so the waves visibly
  // build up during the ramp), faint grid lines fixed in the world that ride up and down on the surface, and a soft sky
  // reflection so the slopes catch the light.
  const waveUniforms = {
    uAmp: { value: 1 }, uGrid: { value: 1 },
    uTrough: { value: new THREE.Color(0x0a3157) }, uCrest: { value: new THREE.Color(0x4a9ad0) },
  };
  function skyEnvMap() {
    // gradient sky (world z up): bright zenith, pale horizon, dark below, prefiltered for a slightly rough surface
    const geo = new THREE.SphereGeometry(1, 48, 24), pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    const zen = new THREE.Color(0x86acd2), hor = new THREE.Color(0xbcd0e4), low = new THREE.Color(0x0d1420), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z >= 0) c.copy(hor).lerp(zen, Math.sqrt(z)); else c.copy(hor).lerp(low, Math.min(1, -4 * z));
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const sky = new THREE.Scene();
    sky.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const pmrem = new THREE.PMREMGenerator(api.renderer), tex = pmrem.fromScene(sky, 0.02).texture;
    pmrem.dispose(); geo.dispose();
    return tex;
  }
  const waveMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transparent: true, opacity: 0.82, roughness: 0.22, metalness: 0,
    side: THREE.DoubleSide, depthWrite: false, envMap: skyEnvMap(), envMapIntensity: 0.7,
  });
  waveMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, waveUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaveW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWaveW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaveW;\nuniform float uAmp, uGrid;\nuniform vec3 uTrough, uCrest;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float s = clamp(vWaveW.z / uAmp, -1.0, 1.0);                       // −1 trough … +1 crest
        diffuseColor.rgb = mix(uTrough, uCrest, smoothstep(-1.0, 1.0, s));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.92, 1.0), 0.35 * smoothstep(0.7, 1.0, s));   // pale crest tops
        vec2 g = vWaveW.xy / uGrid, fw = max(fwidth(g), vec2(1e-6));
        vec2 d = abs(fract(g - 0.5) - 0.5) / fw;                             // distance to the nearest line, in pixels
        float line = 1.0 - min(min(d.x, d.y), 1.0);
        line *= 1.0 - smoothstep(0.12, 0.35, max(fw.x, fw.y));             // fade where the lines get too dense to read
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.9, 1.0), 0.3 * line);
      }`);
  };
  const N_SEG = 96;
  const waveMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, N_SEG, N_SEG), waveMat);
  waveMesh.visible = false; waveMesh.renderOrder = 2;
  api.scene.add(waveMesh);
  let waveSize = 0;
  function sizeWaveMesh(size) {
    // grid lines about 20 across the patch, at a round spacing (1, 2 or 5 × 10ⁿ m) so they sit at round world coordinates
    const step = size / 20, p = 10 ** Math.floor(Math.log10(step)), m = step / p;
    waveUniforms.uGrid.value = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
    if (Math.abs(size - waveSize) < 1e-9) return;
    waveSize = size;
    waveMesh.geometry.dispose();
    waveMesh.geometry = new THREE.PlaneGeometry(size, size, N_SEG, N_SEG);
  }
  function updateWaveMesh(field, t, cx, cy) {
    const pos = waveMesh.geometry.attributes.position;
    waveMesh.position.set(cx, cy, 0);
    for (let i = 0; i < pos.count; i++) pos.setZ(i, field.eta(pos.getX(i) + cx, pos.getY(i) + cy, t));
    pos.needsUpdate = true;
    waveMesh.geometry.computeVertexNormals();
  }
  const wl3 = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }));
  wl3.renderOrder = 8; wl3.visible = false; api.scene.add(wl3);

  // ------------------------------------------------------------ inputs
  const ssSel = $('ssSel');
  ssSel.innerHTML = SEA_STATES.map((s) => `<option value="${s.ss}">SS${s.ss} · ${s.name} (Hs ${s.Hs} m${s.Tp ? `, Tp ${s.Tp} s` : ''})</option>`).join('');
  ssSel.value = '3';
  const applySS = () => {
    const s = SEA_STATES[+ssSel.value];
    $('ssHs').value = s.Hs; $('ssTp').value = s.Tp || '';
    $('ssInfo').innerHTML = s.ss === 0 ? 'Calm: no waves.'
      : `Hs range ${s.HsRange[0]}–${s.HsRange[1]} m · ${s.TpRange ? `Tp range ${s.TpRange[0]}–${s.TpRange[1]} s` : `<span class="warn">no Tp tabulated for SS0–1: ${s.Tp} s from the fully developed Pierson–Moskowitz relation</span>`} · wind ${s.wind}`;
    onInputs();
  };
  ssSel.onchange = applySS;
  for (const id of ['ssHs', 'ssTp', 'ssGamma', 'ssN', 'ssSeed', 'ssSpread']) $(id).addEventListener('change', onInputs);
  $('ssDnvGamma').onchange = onInputs;
  for (const id of ['rgH', 'rgT', 'rgKind']) $(id).addEventListener('change', onInputs);
  $('waveMode').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of $('waveMode').children) x.classList.toggle('on', x === b);
    K.waveMode = b.dataset.mode;
    const reg = K.waveMode === 'regular';
    $('regInputs').classList.toggle('hidden', !reg); $('specInputs').classList.toggle('hidden', reg); $('specAdv').classList.toggle('hidden', reg);
    $('waveStats').textContent = reg ? 'Run statistics (5 min)' : 'Run statistics (20 min)';
    $('specTitle').textContent = reg ? 'Regular wave' : 'Wave spectrum';
    if (K.running) stopRun();
    K.stats = null; onInputs();
  });
  $('specType').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of $('specType').children) x.classList.toggle('on', x === b);
    K.specType = b.dataset.type; onInputs();
  });
  // wave direction: degrees from global +X, kept in 0–360
  $('ssHeadN').onchange = () => {
    const v = parseFloat($('ssHeadN').value);
    if (Number.isFinite(v) && (v < 0 || v >= 360)) $('ssHeadN').value = +(((v % 360) + 360) % 360).toFixed(6);
    onInputs();
  };
  // the runs use the model's frame with its yaw removed: direction relative to the model = global direction − yaw
  const yawDeg = () => { const st = api.getState(); return st ? Math.atan2(st.R[3], st.R[0]) * 180 / Math.PI : 0; };
  const waveDir = () => { const v = parseFloat($('ssHeadN').value) || 0; return ((v % 360) + 360) % 360; };
  const relHeading = (dir) => +(((dir - yawDeg()) % 360 + 360) % 360).toFixed(9);
  for (const id of ['hA11', 'hA22', 'hA33', 'hA44', 'hA55', 'hZ3', 'hZ4', 'hZ5', 'hDiffH', 'hDiffV', 'hBemSim', 'hX3', 'hX4', 'hX5']) $(id).addEventListener('change', () => { K.prep = null; onInputs(); });
  $('hReset').onclick = () => { for (const id of ['hA11', 'hA22', 'hA33', 'hA55']) $(id).value = ''; $('hA44').value = 0.2; $('hZ3').value = 0.15; $('hZ4').value = 0.08; $('hZ5').value = 0.15; $('hDiffH').checked = true; $('hDiffV').checked = false; K.prep = null; onInputs(); };
  // wave drift settings (apply to the next run; restart a running one so the change shows straight away)
  const driftParams = (s) => ($('driftOn').checked
    ? { on: true, Cd: Math.max(0, parseFloat($('driftCd').value) || 0) }
    : { on: false, holdPeriod: Math.max(60, 10 * (s.T0 || 6)) });
  for (const id of ['driftOn', 'driftCd']) $(id).addEventListener('change', () => { $('driftCd').disabled = !$('driftOn').checked; if (K.running) { stopRun(); startRun(); } });
  $('waveRestart').onclick = () => { if (K.running) { stopRun(); startRun(); } };
  $('waveFollow').onchange = () => { if (!$('waveFollow').checked) return; if (K.sim) api.follow(K.sim.p[0], K.sim.p[1]); };
  $('waveSpeed').oninput = (e) => { $('waveSpeedV').textContent = `${e.target.value}×`; };

  // Current wave inputs. Common fields: mode, heading, active (waves present), T0 (characteristic period),
  // label (for verdicts). Regular mode adds H, T, heightKind, A; spectrum mode adds type, Hs, Tp, gamma, N, seed, spread.
  const sea = () => (K.waveMode === 'regular' ? regularSea() : spectrumSea());
  const regularSea = () => {
    const H = Math.max(0, parseFloat($('rgH').value) || 0), T = Math.max(0, parseFloat($('rgT').value) || 0), heightKind = $('rgKind').value;
    const A = regularAmplitude(H, heightKind);
    const dir = waveDir();
    return { mode: 'regular', H, T, heightKind, A, dir, heading: relHeading(dir), active: H > 0 && T > 0, T0: T,
      label: `Regular H ${f(2 * A)} m, T ${f(T)} s` };
  };
  const spectrumSea = () => {
    const Hs = Math.max(0, parseFloat($('ssHs').value) || 0), Tp = Math.max(0, parseFloat($('ssTp').value) || 0);
    let gamma = Math.min(7, Math.max(1, parseFloat($('ssGamma').value) || 3.3));
    if ($('ssDnvGamma').checked && Hs > 0) { gamma = dnvGamma(Hs, Tp); $('ssGamma').value = +gamma.toFixed(2); }
    const dir = waveDir();
    return { type: K.specType, Hs, Tp, gamma, dir, heading: relHeading(dir),
      N: Math.max(5, Math.min(300, parseInt($('ssN').value) || 50)), seed: parseInt($('ssSeed').value) || 1, spread: Math.max(0, parseFloat($('ssSpread').value) || 0),
      mode: 'spectrum', active: Hs > 0 && Tp > 0, T0: Tp, label: `SS${ssSel.value}` };
  };

  // ------------------------------------------------------------ body preparation (seakeeping frame)
  // The model is yawed so its +X axis lies along world X; β is then relative to the model's +X.
  function prepare() {
    const st = api.getState();
    if (!st || st.H.status === 'sinks') return null;
    const moorCfg = api.extras.config().moor;
    const key = JSON.stringify([st.model.name, st.model.tris.length, st.m, st.G, api.refKey(), st.rho, api.getEuler(), api.inertiaKey(), $('raoFmax').value,
      ['hA11', 'hA22', 'hA33', 'hA44', 'hA55', 'hZ3', 'hZ4', 'hZ5'].map((i) => $(i).value), $('hDiffH').checked, $('hDiffV').checked, moorCfg, !!(api.gzFreeTrim && api.gzFreeTrim())]);
    if (K.prep && K.prep.key === key) return K.prep;
    const R = st.R, yaw = Math.atan2(R[3], R[0]);
    const Rsk = mat3.mul(mat3.rotZ(-yaw), R);
    const rel = transformTris(st.model.tris, Rsk, st.G);
    let sol = solveWaterline(rel, st.m / st.rho);
    const zwFree = sol.zw;
    // moored: the lines' vertical pull adds to the weight the body floats (fixed attitude); iterate on the fairlead height
    const toEq = (p) => mat3.apply(Rsk, [p[0] - st.G[0], p[1] - st.G[1], p[2] - st.G[2]]);
    let moorBase = null;
    if (moorCfg) {
      const fEq = toEq(moorCfg.f), fBody = [moorCfg.f[0] - st.G[0], moorCfg.f[1] - st.G[1], moorCfg.f[2] - st.G[2]];
      const cfg = { depth: moorCfg.depth, L: moorCfg.L, ...moorCfg.line, lines: anchorLayout(moorCfg.n, moorCfg.R, moorCfg.dir, [fEq[0], fEq[1]]) };
      let Vline = 0, eq0 = [0, 0];
      for (let it = 0; it < 30; it++) {
        const Fw = [fEq[0], fEq[1], fEq[2] - sol.zw];
        if (Fw[2] <= -cfg.depth) break;
        // at the horizontal equilibrium of the lines (no wind here; extrasFor adds it)
        const ld = mooringOffset(cfg, st.rho, Fw, [0, 0, -sol.zw], [0, 0]);
        eq0 = ld.offset;
        const Vn = Math.max(0, -ld.F[2]);
        const s2 = solveWaterline(rel, (st.m + Vn / G) / st.rho);
        const done = Math.abs(s2.zw - sol.zw) < 1e-9 * st.model.diag && Math.abs(Vn - Vline) < 1e-9 * (1 + Vn);
        sol = s2; Vline = Vn;
        if (done) break;
      }
      moorBase = { cfg, fEq, fBody, model: moorCfg.model, nSeg: moorCfg.nSeg, Vline, zwFree, eq0, w: submergedWeight(cfg.m, cfg.rhoM, st.rho) };
    }
    const H = hydrostatics(rel, sol.zw, st.m, st.rho);
    const IGb = api.getInertiaBody();
    const IGw = mat3.mul(Rsk, mat3.mul(IGb, mat3.transpose(Rsk)));
    const coeffs = defaultHydroCoeffs(H, st.m, IGw, st.rho);
    // user overrides
    const num = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
    for (const [id, j] of [['hA11', 0], ['hA22', 1], ['hA33', 2]]) { if (num(id) !== null) coeffs.A[j] = num(id); else $(id).placeholder = coeffs.A[j].toPrecision(4); }
    if (num('hA55') !== null) coeffs.A[4] = num('hA55'); else $('hA55').placeholder = coeffs.A[4].toPrecision(4);
    coeffs.A[3] = (num('hA44') ?? 0.2) * IGw[0];
    coeffs.zeta[2] = num('hZ3') ?? 0.15; coeffs.zeta[3] = num('hZ4') ?? 0.08; coeffs.zeta[4] = num('hZ5') ?? 0.15;
    const size = Math.max(...waterplaneExtent(H.segs), 1e-6);
    // frequency-domain mesh: resolve the shortest RAO wavelength by ~10 panels
    const wMaxRao = 2 * Math.PI * Math.max(parseFloat($('raoFmax').value) || 0.65, 0.16);
    const lamMin = 2 * Math.PI * G / (wMaxRao * wMaxRao);
    const relFine = refineTris(rel, Math.max(Math.min(lamMin / 10, size / 15), st.model.diag / 200), 40000);
    const diffModes = [$('hDiffH').checked, $('hDiffH').checked, $('hDiffV').checked];
    const model = linearModel(relFine, hydrostatics(relFine, sol.zw, st.m, st.rho), st.m, IGw, st.rho, coeffs, { diffraction: diffModes });
    // roll range of stability (GZ about the run's x axis), at the trim setting of the GZ panel
    const freeTrim = !!(api.gzFreeTrim && api.gzFreeTrim());
    const gz = gzAnalysis(rel, H.V, 'x', { GM: gmAbout(H, 'x'), freeTrim }).summary;
    const offset = Math.hypot(...H.offset);
    K.prep = { key, Rsk, rel, H, IGb, IGw, coeffs, model, diffModes, zw: sol.zw, size, gz, vanish: gz.unstable ? 0 : (gz.vanish ?? 180), trim: freeTrim ? 'free trim' : 'fixed trim', offset, st, hulls: {}, moorBase, toEq };
    return K.prep;
  }

  // ------------------------------------------------------------ small-body extras for the prepared body and sea
  // Points, drag geometry, heave plates, mooring (stiffness at the mean position under the steady wind) and wind.
  // Cached per body, sea heading and options.
  function extrasFor(P, s) {
    const ex = api.extras.config(s.heading);
    const key = JSON.stringify([ex, s.heading]);
    if (P.exCache && P.exCache.key === key) return P.exCache.out;
    const st = P.st, rho = st.rho;
    const toBody = (p) => [p[0] - st.G[0], p[1] - st.G[1], p[2] - st.G[2]];
    const out = { points: [], drag: null, plateA: null, moor: null, wind: null, any: false };
    out.points = ex.points.map((q) => {
      const rEq = P.toEq(q.p);
      return { name: q.name, r: toBody(q.p), rEq, clearance: q.clearance, h0: rEq[2] - P.zw - q.clearance };
    });
    // coarse indexed copy of the floating hull (world, still water) for the steady wind loads
    const restWorld = () => {
      if (!P.restHull) {
        const m = indexMesh(refineTris(P.rel, P.st.model.diag / 25, 8000), P.st.model.diag * 1e-7);
        for (let i = 2; i < m.verts.length; i += 3) m.verts[i] -= P.zw;
        P.restHull = m;
      }
      return P.restHull;
    };
    if (ex.drag) {
      const wet = meanWettedTris(refineTris(P.rel, P.size / 30, 30000), P.zw);
      const geo = dragGeometry(wet, ex.drag.Cd);
      const plates = ex.drag.plates.map((pl) => ({ r: P.toEq(pl.c), D: pl.D, Cd: pl.Cd }));
      out.drag = { geo, plates, els: dragElements({ geo, plates }, rho, P.zw) };
      if (plates.length) out.plateA = plateAddedMass(plates, rho);
    }
    let windRest = null;
    if (ex.wind && ex.wind.U10 > 0) {
      const hm = restWorld(), d = ex.wind.dir * Math.PI / 180;
      const zRef = Math.max(0.1, windageCentroid(hm.verts, hm.idx, Math.cos(d), Math.sin(d)));
      const params = { U10: ex.wind.U10, dirDeg: ex.wind.dir, gusts: ex.wind.gusts, seed: ex.wind.seed, zRef };
      windRest = windLoads(hm.verts, hm.idx, null, { U10: ex.wind.U10, ex: Math.cos(d), ey: Math.sin(d), gust: () => 0, speed: (z) => windAt(ex.wind.U10, z) }, 0, [0, 0, -P.zw], [0, 0, 0], [0, 0, 0], ex.wind.Cd);
      out.wind = { params, Cd: ex.wind.Cd, rhoA: RHO_AIR, rest: windRest, zRef, sigma: ex.wind.gusts ? Math.sqrt(froyaVariance(ex.wind.U10, zRef)) : 0, U: windAt(ex.wind.U10, zRef) };
    }
    if (P.moorBase) {
      const mb = P.moorBase, Fw = [mb.fEq[0], mb.fEq[1], mb.fEq[2] - P.zw], Gw = [0, 0, -P.zw];
      // mean position: horizontal equilibrium of the lines (and the steady wind); the runs start there
      const offs = mooringOffset(mb.cfg, rho, Fw, Gw, windRest ? [windRest.F[0], windRest.F[1]] : [0, 0]);
      const rest = offs;
      // stiffness frequency for the time step: the linear stiffness, or EA/L if a line can go taut
      const kLin = Math.max(...[0, 1, 2].map((j) => Math.abs(offs.Kf[j][j])));
      const tautish = mb.cfg.lines.some((ln) => Math.hypot(ln.anchor[0] - Fw[0], ln.anchor[1] - Fw[1], mb.cfg.depth + Fw[2]) > 0.8 * mb.cfg.L);
      const kMax = Math.max(kLin, tautish ? mb.cfg.EA / mb.cfg.L * mb.cfg.lines.length : 0);
      out.moor = { ...mb, rest, K: offs.K, offset: offs.offset, under: offs, kMax, tautish };
    }
    out.any = !!(out.points.length || out.drag || out.moor || out.wind);
    P.exCache = { key, out };
    return out;
  }
  // WaveSim options for the extras
  function simExtras(X) {
    return {
      drag: X.drag ? { geo: X.drag.geo, plates: X.drag.plates } : null,
      wind: X.wind ? { params: X.wind.params, Cd: X.wind.Cd, rhoA: X.wind.rhoA } : null,
      mooring: X.moor ? { cfg: X.moor.cfg, model: X.moor.model, fairlead: X.moor.fBody, nSeg: X.moor.nSeg } : null,
      points: X.points.map((q) => ({ name: q.name, r: q.r, clearance: q.clearance })),
    };
  }
  // Extra linear terms for the frequency-domain solvers (see hydro.addExtra): mooring stiffness, plate added mass and
  // the drag linearised for sea s at heading beta. base: { kind: 'fk', model } or { kind: 'bem', model, bem, Bextra }.
  function linExtra(P, s, beta, base) {
    const X = extrasFor(P, s);
    const Km = X.moor ? X.moor.K : null, Ap = X.plateA;
    if (!X.drag || !X.drag.els.length || !s.active) return Km || Ap ? { K: Km, A: Ap, terms: null } : null;
    const ck = JSON.stringify([s, beta, base.kind]);
    P.linCache = P.linCache && P.linCache.base === base && P.linCache.X === X ? P.linCache : { base, X, map: new Map() };
    if (P.linCache.map.has(ck)) return P.linCache.map.get(ck);
    const els = X.drag.els, rho = P.st.rho, zw = P.zw;
    // the wave excitation does not depend on the drag: compute it once per frequency (the iteration re-solves often)
    const Fc = new Map();
    const Fof = (w) => { const kw = w.toPrecision(12); if (!Fc.has(kw)) Fc.set(kw, fkExcitation(base.model, w, beta)); return Fc.get(kw); };
    const solve = (w, Beq) => {
      const extra = { K: Km, A: Ap, terms: (ww) => dragLinear(els, Beq, ww, beta, zw, rho) };
      const r = base.kind === 'bem' ? raoAtBem(base.model, base.bem, w, beta, base.Bextra, extra) : raoAt(base.model, w, beta, extra, Fof(w));
      return r ? r.xi : null;
    };
    let out;
    if (s.mode === 'regular') {
      // amplitude-dependent: linearise at each frequency for the regular wave's amplitude
      const per = new Map();
      const Bat = (w) => { const kw = w.toPrecision(12); if (!per.has(kw)) per.set(kw, linearizeDrag(els, { kind: 'regular', A: s.A, w }, beta, solve, zw).Beq); return per.get(kw); };
      const at = linearizeDrag(els, { kind: 'regular', A: s.A, w: 2 * Math.PI / s.T }, beta, solve, zw);
      out = { K: Km, A: Ap, terms: (w) => dragLinear(els, Bat(w), w, beta, zw, rho), lin: at, els };
    } else {
      const S = spectrumFn(s.type, s.Hs, s.Tp, s.gamma), wp = 2 * Math.PI / s.Tp;
      let omegas;
      if (base.kind === 'bem') omegas = base.bem.omegas.filter((w) => w >= 0.3 * wp && w <= 5 * wp);
      if (!omegas || omegas.length < 8) omegas = Array.from({ length: 160 }, (_, i) => 0.3 * wp + (5 * wp - 0.3 * wp) * i / 159);
      const sv = (w, Beq) => solve(w, Beq) || [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
      const lin = linearizeDrag(els, { kind: 'spectrum', S, omegas }, beta, sv, zw);
      out = { K: Km, A: Ap, terms: (w) => dragLinear(els, lin.Beq, w, beta, zw, rho), lin, els };
    }
    P.linCache.map.set(ck, out);
    return out;
  }
  // ------------------------------------------------------------ panel-method (BEM) coefficients
  // Panel-method results depend only on the floating body: geometry, mass, CoG, water and attitude.
  // (a mooring line's pull changes the floating draft, so its statics are part of the key)
  const bodyKey = (st) => {
    const mc = api.extras.config().moor;
    return JSON.stringify([st.model.name, st.model.tris.length, st.m, st.G, api.refKey(), st.rho, api.getEuler(), mc ? [mc.depth, mc.L, mc.R, mc.n, mc.dir, mc.f, mc.line.m, mc.line.rhoM, mc.line.EA] : null]);
  };
  const num0 = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) && v > 0 ? v : 0; };
  const extraZeta = () => [0, 0, num0('hX3'), num0('hX4'), num0('hX5'), 0];
  // Added mass and damping for the time-domain simulators from the panel method, at each mode's natural frequency.
  // Taken from the last panel-method RAO sweep of this body, or a quick coarse sweep around the natural frequencies.
  async function ensureSimBem(onText = () => {}) {
    if (!$('hBemSim').checked) return null;
    const st = api.getState(); if (!st || st.H.status === 'sinks') return null;
    const key = bodyKey(st);
    if (K.simBem && K.simBem.key === key) return K.simBem;
    const P = prepare(); if (!P) return null;
    if (K.rao && K.rao.bem && K.rao.bodyKey === key && coversNatural(P, K.rao.bem)) { K.simBem = { key, bem: K.rao.bem, source: 'the panel-method RAO sweep' }; return K.simBem; }
    const wn = [2, 3, 4].map((j) => P.model.wn[j]).filter((w) => w > 0);
    // the estimates put the natural frequencies within ~30 % of the panel-method values
    const lo = 0.5 * Math.min(...(wn.length ? wn : [1])), hi = 1.8 * Math.max(...(wn.length ? wn : [1]));
    const omegas = Array.from({ length: 12 }, (_, i) => lo * Math.pow(hi / lo, i / 11));
    onText('Computing panel-method added mass and damping (coarse mesh, 12 frequencies)…');
    let run = null;
    const task = startTask({
      title: 'Preparing the simulation', frac: 0,
      detail: 'Panel-method added mass and damping for this body (coarse mesh, 12 frequencies). Needed once per body.',
      cancelLabel: 'Skip: use the estimates', onCancel: () => { if (run) run.cancel(); },
    });
    try {
      run = runBem({ rel: P.rel, zw: P.zw, rho: st.rho, omegas, fidelity: 'coarse', waveRefine: false, onProgress: (q) => { onText(q.text); task.update({ frac: q.frac, detail: q.text }); } });
      const bem = await run.promise;
      K.simBem = { key, bem, source: 'a quick coarse panel-method sweep' };
      return K.simBem;
    } finally { task.done(); }
  }
  // message when the quick panel-method sweep fails or the user skips it: the run carries on with the estimates
  const simBemNote = (err) => (err && err.cancelled
    ? '<span class="warn">Panel method skipped: using the added-mass and damping estimates.</span>'
    : `<span class="warn">Panel-method coefficients failed (${err.message}); using the estimates.</span>`);
  // a sweep can stand in for the quick one only if it spans the heave, roll and pitch natural frequencies
  const coversNatural = (P, bem) => bemNatural(P.model, bem).every((n, j) => j < 2 || j > 4 || !(n.w > 0) || n.inRange);
  // The linear model the simulators use (and the linear predictions they are compared with): the estimate model,
  // or the same with panel-method added mass and damping when those are on and available for this body.
  function simModel(P, s = null) {
    const X = extrasFor(P, s || sea());
    const Ap = X.plateA || [0, 0, 0, 0, 0, 0], Km = X.moor ? X.moor.K : null;
    // natural frequencies with the mooring stiffness and plate added mass
    const wnWith = (Am) => [0, 1, 2, 3, 4, 5].map((j) => { const c = P.model.Cm[j][j] + (Km ? Km[j][j] : 0); return c > 1e-9 * P.model.Mm[j][j] ? Math.sqrt(c / (P.model.Mm[j][j] + Am[j] + Ap[j])) : 0; });
    const sb = $('hBemSim').checked && K.simBem && K.simBem.key === bodyKey(P.st) ? K.simBem : null;
    if (!sb) return { model: { ...P.model, wn: wnWith(P.model.Am) }, A: P.coeffs.A.map((a, j) => a + Ap[j]), Bd: P.model.Bd, source: 'estimates' };
    const T0 = s && s.active && s.T0 > 0 ? s.T0 : 0, ckey = JSON.stringify([T0, extraZeta(), X === P.exCache?.out ? P.exCache.key : '']);
    if (P.simCache && P.simCache.sb === sb && P.simCache.ckey === ckey) return P.simCache.out;
    const bem = sb.bem, nat = bemNatural(P.model, bem, { K: Km, A: X.plateA }), ext = bemExtraDamping(P.model, nat, extraZeta());
    const clamp = (w) => Math.max(bem.omegas[0], Math.min(bem.omegas[bem.omegas.length - 1], w));
    const wWave = T0 ? 2 * Math.PI / T0 : (nat[2].w || bem.omegas[0]);
    const A = [], Bd = [], wn = [];
    for (let j = 0; j < 6; j++) {
      const c = bemCoeffsAt(bem, clamp(nat[j].w > 0 ? nat[j].w : wWave));
      A.push(c.A[j][j]); Bd.push(c.B[j][j] + ext[j]); wn.push(nat[j].w);
    }
    // the time domain takes the plate added mass on top; the frequency-domain model gets it through linExtra
    const out = { model: { ...P.model, Am: A, Bd, wn }, A: A.map((a, j) => a + Ap[j]), Bd, source: sb.source, nat };
    P.simCache = { sb, ckey, out };
    return out;
  }
  const simSourceNote = (sm) => (sm.source === 'estimates' ? 'added mass &amp; damping: estimates' : `added mass &amp; damping: panel method (from ${sm.source})`);

  // time-domain hull: panels ~ λ_min/9 of the current sea, capped for speed
  function hullFor(P, field) {
    const lam = Math.min(field.minWavelength, P.size * 4);
    const h = Math.max(lam / 9, P.st.model.diag / 60);
    const key = h.toPrecision(3);
    if (!P.hulls[key]) {
      const hull = indexMesh(refineTris(transformTris(P.st.model.tris, mat3.identity(), P.st.G), h, 6000), P.st.model.diag * 1e-7);
      // volume quadrature of the mean submerged volume (body frame) for the diffraction correction
      hull.volQ = P.diffModes.some(Boolean) ? bodyFrameVolQ(refineTris(P.rel, h, 3000), P.zw, P.H.B, P.Rsk) : null;
      P.hulls[key] = hull;
    }
    return P.hulls[key];
  }
  const dtFor = (P, field, sm = null) => {
    const X = P.exCache ? P.exCache.out : null;
    // mooring stiffness and plate added mass shift the natural frequencies (otherwise as before: the estimates' ω_n)
    const wn = sm && X && (X.moor || X.plateA) ? sm.model.wn.concat(P.model.wn) : P.model.wn;
    let dt = Math.min(2 * Math.PI / Math.max(field.maxOmega || 1, ...wn) / 60, 0.05);
    // a mooring line that can go taut needs its axial stiffness on the body resolved (and snap loads)
    if (X && X.moor && X.moor.kMax > 0) {
      const mA = P.st.m + Math.min(...(sm ? sm.A : P.coeffs.A).slice(0, 3));
      dt = Math.min(dt, 2 * Math.PI / Math.sqrt(X.moor.kMax / mA) / 40);
    }
    return Math.max(dt, 2e-4);
  };
  const fieldFor = () => WaveField.fromParams(sea());
  // linear steady-state amplitude of DOF j in a regular wave (m, or deg for rotations)
  const regularLinear = (P, s, j) => {
    const sm = simModel(P, s), x = raoAt(sm.model, 2 * Math.PI / s.T, s.heading, linExtra(P, s, s.heading, { kind: 'fk', model: sm.model })).xi[j];
    return Math.hypot(x[0], x[1]) * s.A * (j >= 3 ? 180 / Math.PI : 1);
  };

  // ------------------------------------------------------------ spectrum chart + warnings
  function drawRegular(P, s) {
    if (!s.active) { lineChart($('specCv'), { series: [] }); $('specInfo').innerHTML = 'Enter a wave height and period above zero.'; $('rgInfo').innerHTML = ''; return; }
    const w = 2 * Math.PI / s.T, k = waveNumber(w), lam = 2 * Math.PI / k, Hw = 2 * s.A, steep = Hw / lam;
    // incident elevation at G over three periods
    const xs = Array.from({ length: 241 }, (_, i) => i * 3 * s.T / 240);
    lineChart($('specCv'), { series: [{ name: 'wave η at G', color: SERIES[2], x: xs, y: xs.map((t) => s.A * Math.cos(-w * t)) }], xLabel: 't (s)', yLabel: 'η (m)', height: 160, legend: false });
    const notes = [];
    if (steep > 1 / 7) notes.push(`<span class="bad">✕ Steepness H/λ = ${f(steep, 2)} exceeds the breaking limit of about 1/7. A wave this steep cannot exist, so the linear results are not physical.</span>`);
    else if (steep > 1 / 20) notes.push(`<span class="warn">⚠ Steepness H/λ = ${f(steep, 2)} is above about 1/20, where linear (Airy) theory starts to under-predict crests.</span>`);
    if (P) {
      const wn = simModel(P, s).model.wn;
      for (const [n, j] of [['Heave', 2], ['Roll', 3], ['Pitch', 4]]) {
        if (wn[j] > 0 && Math.abs(w / wn[j] - 1) < 0.15) notes.push(`<span class="warn">⚠ The wave period is within 15 % of the ${n.toLowerCase()} natural period (${f(2 * Math.PI / wn[j])} s): resonant ${n.toLowerCase()}.</span>`);
      }
      const d = diffractionCheck(P.size, w);
      if (!d.ok) notes.push(`<span class="warn">⚠ Body ${f(P.size)} m is large relative to the wavelength ${f(lam)} m (D/λ = ${f(d.ratio, 2)} > 0.2): Froude–Krylov loads are approximate.</span>`);
      if (P.offset > P.st.model.diag * 1e-3) notes.push(`<span class="warn">⚠ The current orientation is not at rest (B is ${f(P.offset)} m from under G). Settle the body first.</span>`);
      notes.push(`Linear steady-state prediction at direction ${s.dir}°: heave ±${f(regularLinear(P, s, 2))} m, roll ±${f(regularLinear(P, s, 3))}°, pitch ±${f(regularLinear(P, s, 4))}°.`);
    }
    const desc = `Crest-to-trough ${f(Hw)} m (amplitude ${f(s.A)} m) · T ${f(s.T)} s (f ${f(1 / s.T)} Hz, ω ${f(w)} rad/s) · wavelength ${f(lam)} m · celerity ${f(lam / s.T)} m/s`;
    $('rgInfo').innerHTML = s.heightKind === 'Hs' ? `Hs ${f(s.H)} m ⇒ ${desc}. Same energy as an irregular sea of this Hs; individual waves of that sea would vary around it.` : desc;
    $('specInfo').innerHTML = `${desc}<br>${notes.join('<br>')}`;
  }
  function drawSpectrum() {
    const P = prepare(); const s = sea();
    if (s.mode === 'regular') return drawRegular(P, s);
    if (!(s.Hs > 0 && s.Tp > 0)) { lineChart($('specCv'), { series: [] }); $('specInfo').innerHTML = 'Calm water: no spectrum.'; return; }
    const wp = 2 * Math.PI / s.Tp;
    const wn = P ? simModel(P, s).model.wn : [];
    const wTop = Math.max(4 * wp, ...(wn.filter((w) => w > 0).map((w) => w * 1.25)));
    const xs = Array.from({ length: 300 }, (_, i) => (i + 1) * wTop / 300);
    const series = [
      { name: 'Pierson–Moskowitz', color: SERIES[0], x: xs, y: xs.map((w) => pmSpectrum(w, s.Hs, s.Tp)), width: s.type === 'pm' ? 2.5 : 1.5 },
      { name: `JONSWAP γ=${f(s.gamma, 2)}`, color: SERIES[1], x: xs, y: xs.map((w) => jonswapSpectrum(w, s.Hs, s.Tp, s.gamma)), width: s.type === 'jonswap' ? 2.5 : 1.5 },
    ];
    const vlines = [];
    if (P) [['heave', 2], ['roll', 3], ['pitch', 4]].forEach(([n, j], r) => { if (wn[j] > 0) vlines.push({ x: wn[j], label: `${n} ωn`, row: r }); });
    lineChart($('specCv'), { series, xLabel: 'ω (rad/s)', yLabel: 'S(ω) m²·s', vlines, height: 160 });
    const S = spectrumFn(s.type, s.Hs, s.Tp, s.gamma), Speak = Math.max(...xs.map(S));
    const notes = [];
    if (P) {
      for (const [n, j] of [['Heave', 2], ['Roll', 3], ['Pitch', 4]]) {
        if (wn[j] > 0 && S(wn[j]) >= 0.5 * Speak) notes.push(`<span class="warn">⚠ ${n} natural frequency (${f(wn[j])} rad/s, T ${f(2 * Math.PI / wn[j])} s) sits inside the spectrum's half-power band, so resonant ${n.toLowerCase()} is likely.</span>`);
      }
      const d = diffractionCheck(P.size, wp);
      notes.push(d.ok ? `Froude–Krylov validity: body ${f(P.size)} m vs peak wavelength ${f(d.lambda)} m (D/λ = ${f(d.ratio, 2)} ≤ 0.2) <span class="good">OK</span>.`
        : `<span class="warn">⚠ Body ${f(P.size)} m is large relative to the peak wavelength ${f(d.lambda)} m (D/λ = ${f(d.ratio, 2)} > 0.2): diffraction matters, so the Froude–Krylov results are approximate.</span>`);
      if (P.offset > P.st.model.diag * 1e-3) notes.push(`<span class="warn">⚠ The current orientation is not at rest (B is ${f(P.offset)} m from under G). Settle the body first for meaningful seakeeping results.</span>`);
    }
    $('specInfo').innerHTML = `Peak ωp = ${f(wp)} rad/s · peak wavelength ${f(2 * Math.PI * G / wp / wp)} m · ${s.type === 'pm' ? 'Pierson–Moskowitz' : `JONSWAP γ = ${f(s.gamma, 2)}`}<br>${notes.join('<br>')}`;
  }

  // ------------------------------------------------------------ real-time run in waves
  async function startRun() {
    if (K.starting) return;
    K.starting = true;
    try { await ensureSimBem((t) => { $('waveInfo').innerHTML = t; }); }
    catch (err) { $('waveInfo').innerHTML = simBemNote(err); }
    finally { K.starting = false; }
    const startTaskBox = startTask({ title: 'Starting the wave run', detail: 'Preparing the wetted hull panels and the wave field…' });
    try { await nextPaint(); } catch { /* no paint available */ }
    const P = prepare(); if (!P) { startTaskBox.done(); return; }
    api.stopCalmSim();
    const s = sea();
    const field = fieldFor();
    let hull, sm, X;
    try {
      hull = hullFor(P, field);
      sm = simModel(P, s);
      X = extrasFor(P, s);
      K.sim = new WaveSim({
        hull, mass: P.st.m, inertiaG: P.IGb, rho: P.st.rho, R0: P.Rsk, z0: -P.zw, field,
        A: sm.A, Bd: sm.Bd, dt: dtFor(P, field, sm), ramp: rampFor(s, X), vanishDeg: P.vanish || 180,
        volQ: hull.volQ, diffModes: P.diffModes, drift: driftParams(s), ...simExtras(X), p0: X.moor ? X.moor.offset : null,
      });
    } finally { startTaskBox.done(); }
    K.runX = X;
    // show the run in the global frame: the run frame is the model's frame with its yaw removed
    K.yawDeg = Math.atan2(P.st.R[3], P.st.R[0]) * 180 / Math.PI;
    if (api.setFrameYaw) api.setFrameYaw(K.yawDeg * Math.PI / 180);
    K.simNote = simSourceNote(sm);
    K.field = field; K.hull = hull; K.running = true;
    K.runSea = s; K.runLin = s.mode === 'regular' && s.active ? [2, 3, 4].map((j) => regularLinear(P, s, j)) : null;
    K.ptLin = s.active ? pointLinear(P, s, sm) : null;
    // the patch spans a couple of (peak) wavelengths, so the waves read as waves rather than a tilting plane
    const lam = s.active && s.T0 > 0 ? 2 * Math.PI / waveNumber(2 * Math.PI / s.T0) : 0;
    sizeWaveMesh(lam ? Math.max(P.st.model.diag * 8, Math.min((s.mode === 'regular' ? 2 : 1.5) * lam, P.st.model.diag * 40)) : P.st.model.diag * 8);
    // colour scale: the regular amplitude, or 2σ = Hs/2 of the spectrum
    waveUniforms.uAmp.value = Math.max(1e-6, field.meta?.A ?? (field.meta?.m0 > 0 ? 2 * Math.sqrt(field.meta.m0) : 1));
    waveMesh.visible = true; api.water.visible = false; api.waterDepth.visible = false;
    api.setStaticOverlays(false); wl3.visible = true;
    $('waveRun').textContent = '❚❚ Stop'; $('waveRestart').disabled = false;
    showTab('tabSea');
  }
  function stopRun() {
    if (!K.running) return;
    K.running = false;
    drawRestMooring();
    $('waveRun').textContent = '▶ Run in waves'; $('waveRestart').disabled = true;
    if (api.setFrameYaw) api.setFrameYaw(0);
    waveMesh.visible = false; wl3.visible = false;
    api.water.visible = api.waterDepth.visible = $('showWater').checked;
    api.setStaticOverlays(true);
    api.refresh();
    api.recenter();
  }
  $('waveRun').onclick = () => { if (K.locked) return; K.running ? stopRun() : startRun(); };

  function frame(dtReal) {
    if (!K.running || !K.sim) return;
    const sim = K.sim, field = K.field;
    const cost = (K.hull.verts.length / 3) * Math.max(1, field.n);
    const budget = Math.max(1, Math.floor(3e6 / cost));
    const span = dtReal * parseFloat($('waveSpeed').value);
    sim.advance(span, Math.min(budget, Math.ceil(span / sim.dt)));
    const R = quatToMat3(sim.q);
    api.setBodyPose(R, sim.p);
    if ($('waveFollow').checked) api.follow(sim.p[0], sim.p[1]);
    const vc = api.viewCenter();   // the wave patch stays under the camera's view, wherever the body goes
    updateWaveMesh(field, sim.t, vc[0], vc[1]);
    // instantaneous wetted waterline
    const wf = waveForces(sim.world, K.hull.idx, field, sim.t, sim.rho, sim.p, { segments: true });
    const segs = wf.segs;
    wl3.geometry.dispose(); wl3.geometry = new THREE.BufferGeometry();
    wl3.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3));
    api.mG.position.set(...sim.p);
    if (sim.moored) drawRunMooring(sim);
    const now = performance.now();
    if (now - K.lastChart > 250) {
      K.lastChart = now;
      const r = sim.rec, n = r.t.length, tmin = sim.t - 60;
      let i0 = 0; while (i0 < n && r.t[i0] < tmin) i0++;
      drawHistories({ t: r.t.slice(i0), roll: r.roll.slice(i0), pitch: r.pitch.slice(i0), heave: r.heave.slice(i0), eta: r.eta.slice(i0) });
      drawExtraHistories(sim, i0);
      const rs = seriesStats(r.t, r.roll, sim.ramp), ps = seriesStats(r.t, r.pitch, sim.ramp);
      const ramping = sim.t < sim.ramp;
      $('waveInfo').innerHTML = `t = <b>${f(sim.t, 4)} s</b>${ramping ? ' (waves ramping up)' : ''} · roll <b>${f(r.roll[n - 1], 3)}°</b> · pitch <b>${f(r.pitch[n - 1], 3)}°</b><br>
        so far: roll σ ${f(rs.sd)}°, max ${f(sim.stats.maxRoll)}° · pitch max ${f(sim.stats.maxPitch)}° · green-water events ${sim.stats.greenWater}<br>
        ${K.runLin ? `linear steady state: heave ±${f(K.runLin[0])} m, roll ±${f(K.runLin[1])}°, pitch ±${f(K.runLin[2])}° (${K.runSea.label}, direction ${f(K.runSea.dir)}°)<br>` : ''}${driftLine(sim)}${extrasLine(sim)}
        ${sim.stats.capsized ? `<br><span class="bad">✕ Capsized at t = ${f(sim.stats.capsizeT)} s</span>` : ''}
        <br><span class="hint">${(K.hull.idx.length / 3).toLocaleString()} panels · ${field.n} wave components · dt ${f(sim.dt * 1000)} ms · ${K.simNote}</span>`;
    }
  }

  function driftLine(sim) {
    const dist = Math.hypot(sim.p[0] - sim.p0[0], sim.p[1] - sim.p0[1]);
    if (sim.moored && (!sim.drift || !sim.drift.on)) return `moored (wave drift off) · offset ${f(dist)} m`;
    if (!sim.drift || !sim.drift.on) return `wave drift off: held on station by a soft spring (period ${f(sim.drift ? sim.drift.holdPeriod : 0)} s) · offset ${f(dist)} m`;
    const r = sim.rec, n = r.t.length, i0 = Math.max(0, n - Math.round(30 / sim.dt));
    const dt = n > 1 ? r.t[n - 1] - r.t[i0] : 0;
    const vx = dt > 0 ? (r.x[n - 1] - r.x[i0]) / dt : 0, vy = dt > 0 ? (r.y[n - 1] - r.y[i0]) / dt : 0;
    const u = sim.dr.uNow || [0, 0];
    const far = !sim.moored && dist > 10 * K.prep.st.model.diag;
    return `drift ${f(Math.hypot(vx, vy))} m/s toward ${f(((Math.atan2(vy, vx) * 180 / Math.PI) + (K.yawDeg || 0) + 720) % 360)}° from global +X (last 30 s) · Stokes drift over the draft ${f(Math.hypot(...u))} m/s · distance ${f(dist)} m
      ${far ? `<br><span class="warn">The body has drifted ${f(dist / K.prep.st.model.diag, 2)} body lengths. Use ↺ Restart run to start again from the original position.</span>` : ''}`;
  }
  // ramp: two wave periods (≤ 20 s); with wind only, 10 s so the body is not hit by a sudden gust
  const rampFor = (s, X) => (s.active && s.T0 > 0 ? Math.min(2 * s.T0, 20) : (X && X.wind ? 10 : 0));
  // linear (RAO-based) statistics of the tracked points for sea s, from the simulator's linear model with the extras
  function pointLinear(P, s, sm) {
    const X = extrasFor(P, s);
    if (!X.points.length || !s.active) return null;
    const ex = linExtra(P, s, s.heading, { kind: 'fk', model: sm.model });
    if (s.mode === 'regular') {
      const w = 2 * Math.PI / s.T, xi = raoAt(sm.model, w, s.heading, ex).xi;
      return X.points.map((q) => pointRegular(xi, w, s.heading, q.rEq, P.zw, q.h0, s.A));
    }
    const S = spectrumFn(s.type, s.Hs, s.Tp, s.gamma), wp = 2 * Math.PI / s.Tp;
    const rows = Array.from({ length: 200 }, (_, i) => { const w = 0.3 * wp + 4.7 * wp * i / 199; return { w, xi: raoAt(sm.model, w, s.heading, ex).xi }; });
    return X.points.map((q) => pointSpectral(rows, S, s.heading, q.rEq, P.zw, q.h0));
  }
  // mooring lines in 3D: at rest (static view, which keeps the model's yaw and free-floating draft) and during runs
  function drawRestMooring() {
    const P = K.prep && K.prep.moorBase ? K.prep : null;
    if (!P || K.running) { if (!P) api.extras.setLines(null); return; }
    const mb = P.moorBase, yaw = Math.atan2(P.st.R[3], P.st.R[0]), c = Math.cos(yaw), sn = Math.sin(yaw);
    const rot = (x, y) => [c * x - sn * y, sn * x + c * y];
    const cfg = { ...mb.cfg, lines: mb.cfg.lines.map((ln) => ({ anchor: rot(...ln.anchor) })) };
    const fxy = rot(mb.fEq[0], mb.fEq[1]);
    api.extras.drawRestLines({ cfg, fairleadWorld: [fxy[0], fxy[1], mb.fEq[2] - mb.zwFree], rho: P.st.rho, w: mb.w });
  }
  function drawRunMooring(sim) {
    const m = sim.moor;
    if (m.model === 'dynamic') { api.extras.setLines(m.lines.map((L) => Array.from(L.r)), m.cfg.lines.map((ln) => [ln.anchor[0], ln.anchor[1], -m.cfg.depth])); return; }
    const w = submergedWeight(m.cfg.m, m.cfg.rhoM, sim.rho);
    const polys = m.cfg.lines.map((ln) => {
      const q = quasiStaticForce(m.cfg, ln.anchor, m.Fw, sim.rho), out = [];
      for (const [x, z] of catenaryShape(q.sol, q.XF, q.ZF, m.cfg.L, w, m.cfg.EA, 30)) out.push(ln.anchor[0] + q.ex * x, ln.anchor[1] + q.ey * x, -m.cfg.depth + z);
      return out;
    });
    api.extras.setLines(polys, m.cfg.lines.map((ln) => [ln.anchor[0], ln.anchor[1], -m.cfg.depth]));
  }
  // live text for the extras during a run
  function extrasLine(sim) {
    const out = [];
    if (sim.moored) {
      const m = sim.moor;
      out.push(`mooring: tension ${m.T.map((T) => `${f(T)} N`).join(', ')}${sim.t > sim.ramp ? ` · max so far ${f(m.st.maxT)} N, slack events ${m.st.slackEvents}` : ''} · ${m.model === 'dynamic' ? 'dynamic line' : 'quasi-static catenary'}`);
    }
    if (sim.wind && sim.lastWind) out.push(`wind: ${f(sim.wind.field.speed(K.runX?.wind?.zRef ?? 1, sim.t))} m/s at ${f(K.runX?.wind?.zRef ?? 1, 2)} m · force ${f(Math.hypot(sim.lastWind.F[0], sim.lastWind.F[1]))} N`);
    if (sim.tracker) {
      const sum = sim.tracker.summary(sim.t);
      sim.tracker.pts.forEach((q, i) => {
        const h = sim.tracker.rec.h[i][sim.tracker.rec.h[i].length - 1];
        out.push(`${q.name}: ${f(h)} m above water${sim.t > sim.ramp ? ` · above ${f(100 * sum[i].fracAbove, 3)} % of the time so far` : ''}`);
      });
    }
    return out.length ? `<br>${out.join('<br>')}` : '';
  }
  function drawExtraHistories(sim, i0) {
    if ($('tabSea').classList.contains('hidden')) return;
    const r = sim.rec;
    if (sim.tracker) {
      $('ptCharts').classList.remove('hidden');
      const t = r.t.slice(i0);
      lineChart($('ptCv'), { series: sim.tracker.pts.map((q, i) => ({ name: q.name, color: SERIES[i], x: t, y: sim.tracker.rec.h[i].slice(i0) })), xLabel: 't (s)', yLabel: 'above water (m)', height: 140 });
    } else $('ptCharts').classList.add('hidden');
    if (sim.moored) {
      $('moorCharts').classList.remove('hidden');
      lineChart($('moorTcv'), { series: [{ name: 'max line tension', color: SERIES[1], x: r.t.slice(i0), y: r.tension.slice(i0) }], xLabel: 't (s)', yLabel: 'tension (N)', height: 130, legend: false });
      drawWatch(r.x, r.y, sim.moor.cfg);
    } else $('moorCharts').classList.add('hidden');
  }
  // top view: the body's track as offsets from where the run started (the mean position), with a short stub pointing
  // toward each anchor (anchors are usually far outside the watch circle)
  function drawWatch(xs, ys, cfg) {
    const step = Math.max(1, Math.ceil(xs.length / 3000)), x0 = xs[0], y0 = ys[0];
    const x = [], y = [];
    for (let i = 0; i < xs.length; i += step) { x.push(xs[i] - x0); y.push(ys[i] - y0); }
    const R = Math.max(0.05, ...x.map((v, i) => Math.hypot(v, y[i])));
    const series = [{ name: 'body track', color: SERIES[0], x, y }];
    cfg.lines.forEach((ln, i) => {
      const dx = ln.anchor[0] - x0, dy = ln.anchor[1] - y0, d = Math.hypot(dx, dy) || 1, k = Math.min(d, 0.6 * R) / d;
      series.push({ name: i ? '' : `toward anchor${cfg.lines.length > 1 ? 's' : ''}`, color: SERIES[1], x: [0, dx * k], y: [0, dy * k], width: 1 });
    });
    lineChart($('moorXY'), { series, xLabel: 'Δx from the start (m)', yLabel: 'Δy (m)', height: 200, aspect: 'equal' });
  }

  function drawHistories(r) {
    if ($('tabSea').classList.contains('hidden')) return;
    lineChart($('thRot'), { series: [
      { name: 'roll', color: SERIES[0], x: r.t, y: r.roll },
      { name: 'pitch', color: SERIES[1], x: r.t, y: r.pitch },
    ], xLabel: 't (s)', yLabel: 'angle (deg)', height: 140 });
    lineChart($('thLin'), { series: [
      { name: 'wave η at G', color: SERIES[2], x: r.t, y: r.eta },
      { name: 'heave', color: SERIES[3], x: r.t, y: r.heave },
    ], xLabel: 't (s)', yLabel: 'elevation (m)', height: 140 });
  }

  // ------------------------------------------------------------ stability verdict
  function verdict({ ssLabel, maxRoll, vanish, capsized, greenFrac, trim = 'fixed trim' }) {
    const range = vanish > 0 ? vanish : 0;
    let level, word;
    if (capsized || range === 0) { level = 'bad'; word = capsized ? 'capsized' : 'unstable at rest'; }
    else if (maxRoll >= 0.8 * range) { level = 'bad'; word = 'dangerous'; }
    else if (maxRoll >= 0.5 * range || greenFrac > 0.05) { level = 'warn'; word = 'marginal'; }
    else { level = 'good'; word = 'safe'; }
    const icon = { good: '✓', warn: '!', bad: '✕' }[level];
    return { level, word, icon, text: `${ssLabel}: max roll ${f(maxRoll)}° of ${range >= 180 ? `180° (self-righting, GZ at ${trim})` : `${f(range)}° range (GZ at ${trim})`}: ${word}` };
  }
  function setSeaVerdict(v, extra = '') {
    $('seaVerdict').className = `verdict ${v.level === 'warn' ? 'warn' : v.level}`;
    $('seaVerdict').innerHTML = `<b>${v.icon} ${v.word[0].toUpperCase() + v.word.slice(1)}</b>${v.text}${extra}`;
  }

  // ------------------------------------------------------------ statistics run (worker)
  $('waveStats').onclick = async () => {
    if (K.locked) return;
    const windOn = !!api.extras.config().wind;
    if (!sea().active && !windOn) { $('waveInfo').textContent = 'Calm water: nothing to simulate.'; return; }
    $('waveStats').disabled = true;
    try { await ensureSimBem((t) => { $('waveInfo').innerHTML = t; }); }
    catch (err) { $('waveInfo').innerHTML = simBemNote(err); }
    $('waveStats').disabled = false;
    const P = prepare(); if (!P) return;
    const s = sea();
    const sm = simModel(P, s);
    stopRun();
    const reg = s.mode === 'regular';
    const X = extrasFor(P, s);
    const field = fieldFor(), hull = hullFor(P, field), dt = dtFor(P, field, sm), duration = (reg ? 5 : 20) * 60, ramp = rampFor(s, X);
    const ptLin = s.active ? pointLinear(P, s, sm) : null;
    if (K.worker) K.worker.terminate();
    K.worker = new Worker(new URL('./seaworker.js', import.meta.url), { type: 'module' });
    $('waveStats').disabled = true;
    const t0 = performance.now();
    const worker = K.worker;
    const statsTask = startTask({
      title: `Running statistics: ${duration / 60} min of ${s.label}`, frac: 0, eta: true,
      detail: `Time-domain simulation in a background worker (${(hull.idx.length / 3).toLocaleString()} panels, dt ${f(dt * 1000)} ms).`,
      onCancel: () => {
        worker.terminate(); if (K.worker === worker) K.worker = null;
        statsTask.done(); $('waveStats').disabled = false;
        $('waveInfo').innerHTML = '<span class="warn">Statistics run cancelled.</span>';
      },
    });
    K.worker.onerror = (e) => {
      statsTask.done(); $('waveStats').disabled = false;
      $('waveInfo').innerHTML = `<span class="bad">Statistics run failed: ${e.message || 'worker error'}</span>`;
    };
    K.worker.onmessage = (e) => {
      if (e.data.progress !== undefined) {
        const p = e.data.progress;
        $('waveInfo').innerHTML = `Running statistics: simulating ${duration / 60} min of ${s.label}… <b>${Math.round(p * 100)}%</b>`;
        statsTask.update({ frac: p, detail: `Simulated ${f(p * duration / 60, 3)} of ${duration / 60} min of ${s.label} in a background worker.` });
        return;
      }
      statsTask.done();
      $('waveStats').disabled = false;
      const { stats, series } = e.data;
      K.stats = { stats, series, sea: s, X, ptLin };
      showTab('tabSea');
      drawHistories(series);
      if (reg) { showRegularStats(P, s, stats, hull, field, t0); showExtrasStats(stats, series, X, ptLin, s); return; }
      if (!s.active) {   // wind only, calm water
        setSeaVerdict({ level: stats.capsized ? 'bad' : 'good', word: stats.capsized ? 'capsized' : 'wind only', icon: stats.capsized ? '✕' : '✓', text: `calm water, wind ${f(X.wind?.params.U10 ?? 0)} m/s: max roll ${f(stats.maxRoll)}°, max pitch ${f(stats.maxPitch)}°` }, ' <span class="hint">(20 min time-domain run)</span>');
        $('seaStats').innerHTML = `<table><tr><td>Roll mean / σ / max</td><td>${f(stats.roll.mean)}° / ${f(stats.roll.sd)}° / ${f(stats.maxRoll)}°</td></tr><tr><td>Pitch mean / σ / max</td><td>${f(stats.pitch.mean)}° / ${f(stats.pitch.sd)}° / ${f(stats.maxPitch)}°</td></tr><tr><td>Mean drift</td><td>${driftRow(stats)}</td></tr></table><span class="hint">Simulated ${f(stats.simulated, 4)} s in ${f((performance.now() - t0) / 1000)} s · dt ${f(stats.dt * 1000)} ms.</span>`;
        showExtrasStats(stats, series, X, ptLin, s);
        $('waveInfo').innerHTML = 'Statistics complete (wind only).';
        return;
      }
      const S = spectrumFn(s.type, s.Hs, s.Tp, s.gamma);
      const exFK = linExtra(P, s, s.heading, { kind: 'fk', model: sm.model });
      const spm = spectralResponseMulti(sm.model, S, s.heading, [2, 3, 4], field.meta.wMin, field.meta.wMax, 300, 20 * 60, exFK);
      const sr = spm[3], sp = spm[4], sh = spm[2];
      const greenFrac = stats.steps ? stats.greenSteps / stats.steps : 0;
      const v = verdict({ ssLabel: s.label, maxRoll: stats.maxRoll, vanish: P.vanish, capsized: stats.capsized, greenFrac, trim: P.trim });
      setSeaVerdict(v, ` <span class="hint">(20 min time-domain run, direction ${s.dir}°)</span>`);
      const row = (k, td, spv, u) => `<tr><td>${k}</td><td>${f(td)} ${u}</td><td>${f(spv)} ${u}</td></tr>`;
      $('seaStats').innerHTML = `<table>
        <tr><td></td><td><b>Time domain</b></td><td><b>Spectral (linear)</b></td></tr>
        ${row('Roll σ', stats.roll.sd, sr.sigma, '°')}
        ${row('Roll significant amplitude (2σ)', stats.roll.sig, sr.sig, '°')}
        ${row('Roll max / most-probable max (20 min)', stats.maxRoll, sr.mpm, '°')}
        ${row('Pitch σ', stats.pitch.sd, sp.sigma, '°')}
        ${row('Heave σ', stats.heave.sd, sh.sigma, 'm')}
        <tr><td>Wave Hs from record (4σ)</td><td>${f(4 * stats.eta.sd)} m</td><td>${f(s.Hs)} m</td></tr>
        <tr><td>Mean drift</td><td colspan="2">${driftRow(stats)}</td></tr>
        <tr><td>Green water on deck</td><td colspan="2">${stats.greenWater} events, ${f(100 * greenFrac, 2)} % of the time</td></tr>
        <tr><td>Capsize</td><td colspan="2">${stats.capsized ? `<span class="bad">✕ yes, at t = ${f(stats.capsizeT)} s</span>` : '<span class="good">✓ no</span>'}</td></tr>
      </table><span class="hint">Simulated ${f(stats.simulated, 4)} s in ${f((performance.now() - t0) / 1000)} s · ${(hull.idx.length / 3).toLocaleString()} panels · ${field.n} components · dt ${f(stats.dt * 1000)} ms · ${simSourceNote(sm)}.
      The two columns should agree within ~10 % for moderate motions; larger gaps indicate nonlinearity (large roll, deck immersion)${X.drag ? '; the spectral column uses the equivalent linear drag' : ''}${X.wind ? '; wind is in the time domain only' : ''}.</span>`;
      showExtrasStats(stats, series, X, ptLin, s);
      $('waveInfo').innerHTML = `Statistics complete: ${v.text}.`;
    };
    K.worker.postMessage({
      verts: hull.verts.buffer.slice(0), idx: hull.idx.buffer.slice(0), mass: P.st.m, IGb: P.IGb, rho: P.st.rho, R0: P.Rsk, z0: -P.zw,
      fieldParams: { ...s }, A: sm.A, Bd: sm.Bd, dt, duration, ramp, vanishDeg: P.vanish || 180,
      volQ: hull.volQ ? hull.volQ.slice() : null, diffModes: P.diffModes, drift: driftParams(s), ...simExtras(X), p0: X.moor ? X.moor.offset : null,
    });
  };

  // Tables and charts for the tracked points, the mooring and the wind after a statistics run.
  function showExtrasStats(stats, series, X, ptLin, s) {
    const cell = (v, u = '', d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${f(v, d)}${u}`);
    if (stats.points && stats.points.length) {
      $('ptCharts').classList.remove('hidden');
      lineChart($('ptCv'), { series: stats.points.map((q, i) => ({ name: q.name, color: SERIES[i], x: series.t, y: series.ph[i] })), xLabel: 't (s)', yLabel: 'above water (m)', height: 150 });
      const reg = s.mode === 'regular';
      const rows = stats.points.map((q, i) => {
        const L = ptLin ? ptLin[i] : null;
        return `<tr class="h"><td colspan="3"><b>${q.name}</b>${q.clearance ? ` (clearance ${f(q.clearance)} m)` : ''}</td></tr>
          <tr><td>Time above water</td><td>${cell(100 * q.fracAbove, ' %')}</td><td>${L ? cell(100 * L.fracAbove, ' %') : '—'}</td></tr>
          <tr><td>Height above water: mean / σ</td><td>${cell(q.meanH, ' m')} / ${cell(q.sdH, ' m')}</td><td>${L && !reg ? `${cell(X.points[i].h0, ' m')} / ${cell(L.sdH, ' m')}` : L && reg ? `amp. ${cell(L.amp, ' m')}` : '—'}</td></tr>
          <tr><td>Goes under: per hour / count</td><td>${cell(q.dunksPerHour, '', 3)} / ${q.dunks}</td><td>${L && !reg ? cell(L.dunksPerHour, '', 3) : '—'}</td></tr>
          <tr><td>Longest underwater / above water</td><td>${cell(q.longestUnder, ' s')} / ${cell(q.longestAbove, ' s')}</td><td>${L && !reg && L.meanUnder !== null ? `mean under ${cell(L.meanUnder, ' s')}` : '—'}</td></tr>
          <tr><td>Acceleration RMS x / y / z (body axes)</td><td>${q.accRms.map((a) => cell(a, '', 3)).join(' / ')} m/s²</td><td>${L && !reg ? `${L.accRms.map((a) => cell(a, '', 3)).join(' / ')} m/s²` : L && reg ? `amp. ${L.accAmp.map((a) => cell(a, '', 3)).join(' / ')}` : '—'}</td></tr>
          <tr><td>Acceleration max |a|</td><td>${cell(q.accMag, ' m/s²')} (${cell(q.accMag / 9.80665, ' g', 2)})</td><td></td></tr>`;
      });
      $('ptStats').innerHTML = `<table class="grid"><tr class="h"><td></td><td>Time domain</td><td>Linear (RAO)</td></tr>${rows.join('')}</table>
        <span class="hint">Height above the local incident wave surface (the body's own diffracted and radiated waves are not included), minus the clearance. Accelerations exclude gravity; an accelerometer reads these plus 1 g. Linear column: from the RAOs (Gaussian relative motion; Rice's rate for going under)${reg ? ', regular wave' : ''}. The linear acceleration axes are the floating (equilibrium) axes.</span>`;
    } else $('ptCharts').classList.add('hidden');
    if (stats.mooring) {
      const m = stats.mooring;
      $('moorCharts').classList.remove('hidden');
      lineChart($('moorTcv'), { series: [{ name: 'max line tension', color: SERIES[1], x: series.t, y: series.tension }], xLabel: 't (s)', yLabel: 'tension (N)', height: 130, legend: false });
      drawWatch(series.x, series.y, X.moor.cfg);
      const Ts = Math.max(...m.Tstatic);
      $('moorStats').innerHTML = `<table class="grid">
        <tr><td>Static tension (at rest)</td><td>${m.Tstatic.map((T) => `${f(T)} N`).join(', ')}</td></tr>
        <tr><td>Max / min fairlead tension</td><td>${f(m.maxT)} N / ${f(m.minT)} N${Ts > 0 ? ` (max ${f(m.maxT / Ts, 3)} × static)` : ''}</td></tr>
        <tr><td>Slack events (below 10 % of static)</td><td>${m.slackEvents}${m.slackEvents ? ' <span class="warn">snap loads likely</span>' : ''}</td></tr>
        <tr><td>Max anchor tension / uplift</td><td>${f(m.maxAnchorT)} N / ${f(m.maxUplift)} N${m.maxUplift > 0.01 * Math.max(1, m.maxAnchorT) ? ' <span class="warn">the anchor is lifted</span>' : ''}</td></tr>
        <tr><td>Watch circle: max / mean offset</td><td>${f(m.maxOffset)} m / ${f(m.meanOffset)} m</td></tr>
      </table><span class="hint">${X.moor.model === 'dynamic' ? `Dynamic lumped-mass line (${X.moor.nSeg} segments): tension peaks are resolved within each step.` : 'Quasi-static catenary: no line dynamics, so snap loads are not captured; use the dynamic model for those.'} Slack criterion as DNV-RP-H103 (dynamic load below −90 % of static). Offsets from the rest position.</span>`;
    } else $('moorCharts').classList.add('hidden');
    if (stats.wind) {
      const w = stats.wind;
      $('seaStats').insertAdjacentHTML('beforeend', `<div class="info">Wind: mean force ${f(Math.hypot(w.meanF[0], w.meanF[1]))} N toward ${f(((Math.atan2(w.meanF[1], w.meanF[0]) * 180 / Math.PI) + 360) % 360)}°, max ${f(w.maxF)} N · mean roll ${f(stats.roll.mean)}°, mean pitch ${f(stats.pitch.mean)}°.</div>`);
    }
  }

  const driftRow = (st) => (!st.drift ? '—' : st.drift.on
    ? `${f(st.drift.speed)} m/s toward ${f((((st.drift.dir + yawDeg()) % 360) + 360) % 360)}° from global +X, ${f(st.drift.dist)} m in the run`
    : `off (held on station; max offset ${f(st.drift.maxOffset)} m)`);
  function showRegularStats(P, s, stats, hull, field, t0) {
    const greenFrac = stats.steps ? stats.greenSteps / stats.steps : 0;
    const v = verdict({ ssLabel: s.label, maxRoll: stats.maxRoll, vanish: P.vanish, capsized: stats.capsized, greenFrac, trim: P.trim });
    setSeaVerdict(v, ` <span class="hint">(5 min regular-wave run, direction ${s.dir}°)</span>`);
    const st = stats.steady || {};
    const row = (k, td, lin, u) => `<tr><td>${k}</td><td>${f(td)} ${u}</td><td>${f(lin)} ${u}</td><td>${lin > 1e-9 && td !== undefined ? `${(Math.round(1000 * (td / lin - 1)) / 10 || 0).toFixed(1)} %` : '—'}</td></tr>`;
    $('seaStats').innerHTML = `<table>
      <tr><td>Steady-state amplitude</td><td><b>Time domain</b></td><td><b>Linear RAO × A</b></td><td><b>diff.</b></td></tr>
      ${row('Wave at G (input amplitude)', st.eta, s.A, 'm')}
      ${row('Heave', st.heave, regularLinear(P, s, 2), 'm')}
      ${row('Roll', st.roll, regularLinear(P, s, 3), '°')}
      ${row('Pitch', st.pitch, regularLinear(P, s, 4), '°')}
      <tr><td>Max roll / pitch (whole run)</td><td colspan="3">${f(stats.maxRoll)}° / ${f(stats.maxPitch)}°</td></tr>
      <tr><td>Mean drift</td><td colspan="3">${driftRow(stats)}</td></tr>
      <tr><td>Green water on deck</td><td colspan="3">${stats.greenWater} events, ${f(100 * greenFrac, 2)} % of the time</td></tr>
      <tr><td>Capsize</td><td colspan="3">${stats.capsized ? `<span class="bad">✕ yes, at t = ${f(stats.capsizeT)} s</span>` : '<span class="good">✓ no</span>'}</td></tr>
    </table><span class="hint">Steady state is half the peak-to-peak over the last half of the run. Simulated ${f(stats.simulated, 4)} s in ${f((performance.now() - t0) / 1000)} s · ${(hull.idx.length / 3).toLocaleString()} panels · dt ${f(stats.dt * 1000)} ms.
    The wave-at-G row is measured at the moving CoG, so it differs slightly from the input when the body drifts or heaves. Close agreement in the motion rows means the response is linear; large gaps point to nonlinearity (large roll, deck immersion, steep waves).</span>`;
    $('waveInfo').innerHTML = `Statistics complete: ${v.text}.`;
  }

  // ------------------------------------------------------------ sea-state sweep (spectral)
  function ssSweepNow() {
    if (K.locked) return;
    const P = prepare(); if (!P) return;
    const s = sea();
    const sm = simModel(P, s);
    const bemOk = K.rao && K.rao.bem && K.rao.bodyKey === bodyKey(P.st) && !K.rao.stale;
    const X = extrasFor(P, s);
    const Kx = X.moor || X.plateA ? { K: X.moor ? X.moor.K : null, A: X.plateA } : null;
    const bemBase = bemOk ? { kind: 'bem', model: P.model, bem: K.rao.bem, Bextra: bemExtraDamping(P.model, bemNatural(P.model, K.rao.bem, Kx), extraZeta()) } : null;
    // without drag the sweep is the same for every sea state; with drag it is linearised for each row's sea
    const bemPtsFor = (sx) => (bemBase ? bemSweep(P.model, K.rao.bem, [s.heading], bemBase.Bextra, (b) => linExtra(P, sx, b, bemBase))[0].points : null);
    const bemPts0 = X.drag ? null : bemPtsFor(s);
    let usedBem = 0, usedEst = 0;
    const rows = SEA_STATES.filter((x) => x.Hs > 0).map((x) => {
      const gamma = $('ssDnvGamma').checked ? dnvGamma(x.Hs, x.Tp) : s.gamma;
      const S = spectrumFn(s.type, x.Hs, x.Tp, gamma);
      const wp = 2 * Math.PI / x.Tp;
      const m0 = x.Hs * x.Hs / 16;
      const sx = { ...s, mode: 'spectrum', Hs: x.Hs, Tp: x.Tp, gamma, active: true, T0: x.Tp, label: `SS${x.ss}` };
      const bemPts = X.drag ? bemPtsFor(sx) : bemPts0;
      const viaBem = bemPts && spectralFromSweep(bemPts, S, 2, 3 * 3600, m0).coverage >= 0.9;
      if (viaBem) usedBem++; else usedEst++;
      const exFK = viaBem ? null : linExtra(P, sx, s.heading, { kind: 'fk', model: sm.model });
      const spm = viaBem ? null : spectralResponseMulti(sm.model, S, s.heading, [2, 3, 4], 0.4 * wp, Math.max(4 * wp, ...sm.model.wn.filter((w, j) => j >= 2 && j <= 4).map((w) => 1.5 * w)), 300, 3 * 3600, exFK);
      const r = (j) => (viaBem ? spectralFromSweep(bemPts, S, j, 3 * 3600, m0) : spm[j]);
      const roll = r(3), pitch = r(4), heave = r(2);
      const v = verdict({ ssLabel: `SS${x.ss}`, maxRoll: roll.mpm, vanish: P.vanish, capsized: false, greenFrac: 0, trim: P.trim });
      const d = diffractionCheck(P.size, wp);
      return `<tr><td>SS${x.ss}${viaBem ? '' : (bemBase ? ' <span class="hint" title="outside the panel-method frequency range: linear estimate model">†</span>' : '')}</td><td>${x.Hs}</td><td>${x.Tp}${x.tpDerived ? '*' : ''}</td><td>${f(heave.sig)}</td><td>${f(roll.sig)}</td><td>${f(roll.mpm)}</td><td>${f(pitch.sig)}</td>
        <td><span class="badge ${v.level}">${v.icon} ${v.word}</span>${d.ok ? '' : ` <span class="badge warn" title="body is ${f(d.ratio, 2)} of the peak wavelength; diffraction not modelled">! D/λ ${f(d.ratio, 2)}</span>`}</td></tr>`;
    });
    $('ssTable').innerHTML = `<table class="ss-table"><tr><th>SS</th><th>Hs m</th><th>Tp s</th><th>heave sig m</th><th>roll sig °</th><th>roll max 3 h °</th><th>pitch sig °</th><th>verdict</th></tr>${rows.join('')}</table>
      <span class="hint">Linear spectral estimate at direction ${s.dir}° (${s.type === 'pm' ? 'PM' : 'JONSWAP'}) from ${usedBem && !usedEst ? 'the panel-method RAOs (RAO stage)' : usedBem ? `the panel-method RAOs where the sweep covers the sea (rows marked † use the ${sm.source === 'estimates' ? 'estimate' : 'simulator'} model; widen the RAO frequency range to include them)` : `the ${sm.source === 'estimates' ? 'Froude–Krylov estimate' : 'simulator (panel-method coefficients at the natural frequencies)'} model${bemBase ? '' : '; run Compute RAOs with the panel method for frequency-dependent coefficients'}`}: significant single amplitude 2√m₀ and most-probable max in 3 h, compared with the roll range of stability (${P.vanish >= 180 ? '> 180°' : f(P.vanish) + '°'}, GZ at ${P.trim}).${X.drag ? ' Viscous drag: linearised for each row\'s sea state.' : ''}${X.moor ? ' Mooring: linear catenary stiffness at the mean position.' : ''} Large predicted rolls are where the linear estimate is least reliable, so confirm those with a time-domain run. * SS1 period from the fully developed Pierson–Moskowitz relation. <b>! D/λ</b> marks sea states whose waves are short relative to the body (D/λ > 0.2), where Froude–Krylov loads are approximate.</span>`;
  }
  $('ssSweep').onclick = async () => {
    if (K.locked) return;
    const task = startTask({ title: 'Computing the sea-state table', detail: 'Linear spectral estimates for sea states 1–5 at the chosen wave direction…' });
    try { await nextPaint(); ssSweepNow(); } finally { task.done(); }
  };

  // ------------------------------------------------------------ RAO sweep
  function parseHeadings(txt) {
    txt = txt.trim();
    const m = txt.match(/^(-?[\d.]+)\s*:\s*([\d.]+)\s*:\s*(-?[\d.]+)$/);
    if (m) { const [a, st, b] = m.slice(1).map(Number); const out = []; for (let v = a; v <= b + 1e-9 && out.length < 73; v += st || 1) out.push(+v.toFixed(6)); return out; }
    return txt.split(/[,\s]+/).map(Number).filter(Number.isFinite).slice(0, 73);
  }
  const TWO_PI = 2 * Math.PI;
  const raoRange = () => {
    const f0 = Math.max(0.001, parseFloat($('raoFmin').value) || 0.03), f1 = Math.max(f0 * 1.01, parseFloat($('raoFmax').value) || 0.65);
    $('raoRange').textContent = `= ω ${f(TWO_PI * f0)}–${f(TWO_PI * f1)} rad/s · wave periods ${f(1 / f1)}–${f(1 / f0)} s · deep-water wavelengths ${f(G / (TWO_PI * f1 * f1))}–${f(G / (TWO_PI * f0 * f0))} m`;
    return [f0, f1];
  };
  for (const id of ['raoFmin', 'raoFmax']) $(id).addEventListener('input', raoRange);
  raoRange();
  // RAO progress: the bar in the RAO setup pane, the overlay on the plots and the progress window over the view
  let raoTask = null, raoTitle = '';
  const progress = (frac, text) => {
    $('raoProgWrap').classList.toggle('hidden', frac === null);
    if (frac === null) { if (raoTask) { raoTask.done(); raoTask = null; } return; }
    const pct = Math.round(frac * 100);
    $('raoProgBar').style.width = `${pct}%`;
    $('raoProgText').textContent = `${pct} %`;
    $('raoProgDetail').textContent = text;
    $('raoLoadingText').textContent = text;
    if (!raoTask) {
      raoTask = startTask({
        title: raoTitle || (bemOn() ? 'Solving RAOs: panel method' : 'Computing RAOs: Froude–Krylov'), frac,
        detail: text, onCancel: () => { if (K.bemRun) K.bemRun.cancel(); },
      });
    }
    raoTask.update({ frac, detail: text, onCancel: K.bemRun ? () => { if (K.bemRun) K.bemRun.cancel(); } : null });
  };
  const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  let raoBusy = false;
  const bemOn = () => $('raoMethod').value === 'bem';
  const syncMethod = () => { for (const id of ['bemFid', 'bemIrrWrap', 'bemHint']) $(id).closest(id === 'bemFid' ? 'label' : '*').classList.toggle('hidden', !bemOn()); };
  $('raoMethod').onchange = syncMethod; syncMethod();
  $('raoCancel').onclick = () => { if (K.bemRun) K.bemRun.cancel(); };
  // "Solve with Capytaine": only when Float Sim is served by tools/serve.py in a Python that has Capytaine
  const capy = { available: false, version: '', reason: '' };
  const syncCapyBtn = () => {
    const b = $('raoCapy');
    b.disabled = raoBusy || K.locked || !capy.available;
    b.title = K.locked ? 'Exit the drop / rise test (or reset its position) first'
      : capy.available ? `Solve the panel-method mesh with Capytaine ${capy.version} on this computer (uses the Panels and Irregular-frequency settings above)` : capy.reason;
  };
  const checkCapy = async () => {
    const st = await capytaineStatus();
    Object.assign(capy, { available: !!st.available, version: st.version || '', reason: st.reason || '' });
    $('capyStatus').innerHTML = capy.available
      ? `<span class="good">Capytaine ${capy.version} found on this computer</span> (${st.cores} cores): <b>Solve with Capytaine</b> solves the same panel mesh with it instead of Float Sim's own solver.`
      : `<b>Solve with Capytaine</b> is off. ${capy.reason}`;
    syncCapyBtn();
  };
  checkCapy();
  $('raoRun').onclick = () => solveRao(false);
  $('raoCapy').onclick = () => { if (capy.available) solveRao(true); };
  async function solveRao(useCapy) {
    if (raoBusy || K.locked) return;
    const [f0, f1] = raoRange();
    const n = Math.max(5, Math.min(400, parseInt($('raoN').value) || 80));
    const heads = parseHeadings($('raoHead').value);
    if (!heads.length) { $('raoInfo').textContent = 'Enter at least one heading.'; return; }
    raoBusy = true; $('raoRun').disabled = true; syncCapyBtn(); $('raoCsv').disabled = true; $('raoRaw').disabled = true;
    raoTitle = useCapy ? `Solving RAOs: Capytaine ${capy.version}` : '';
    showTab('tabRao', { skipDraw: true });
    $('raoLoading').classList.remove('hidden'); $('raoEmpty').classList.add('hidden');
    try {
      progress(0, 'Preparing the hydrodynamic mesh…');
      await nextPaint();
      const t0 = performance.now();
      K.prep = null;  // the RAO frequency range sets the mesh resolution
      const P = prepare();
      if (!P) throw new Error('No floating body to analyse (the model sinks or none is loaded).');
      const freqs = Array.from({ length: n }, (_, i) => f0 + (f1 - f0) * i / (n - 1));
      const omegas = freqs.map((x) => TWO_PI * x);
      const sNow = sea(), X = extrasFor(P, sNow);
      if (!bemOn() && !useCapy) {
        const base = { kind: 'fk', model: P.model };
        const extraFor = (b) => linExtra(P, sNow, b, base);
        const sweep = await raoSweepAsync(P.model, omegas, heads, (p) => progress(p, `Computing RAOs… ${Math.round(p * 100)} % (${heads.length} headings × ${n} frequencies)`), extraFor);
        K.rao = { freqs, omegas, heads, sweep, P, resp: new Map(), method: 'fk', bodyKey: bodyKey(P.st), extraFor, X, seaLin: sNow, dRef: P.toEq([0, 0, 0]) };
        const wn = wnExtras(P, X, P.model.Am);
        K.rao.wn = wn;
        $('raoInfo').innerHTML = `Froude–Krylov + estimates: ${heads.length} headings × ${n} frequencies in ${f((performance.now() - t0) / 1000)} s · ${P.model.quads.length.toLocaleString()} wetted panels.<br>
          Natural frequencies: heave ${f(wn[2] / TWO_PI)} Hz, roll ${f(wn[3] / TWO_PI)} Hz, pitch ${f(wn[4] / TWO_PI)} Hz.
          Diffraction correction: ${P.diffModes[0] ? 'surge/sway on' : 'surge/sway off'}, ${P.diffModes[2] ? 'heave on' : 'heave off'}.${extrasRaoNote(X, sNow, wn)}`;
      } else {
        const fid = $('bemFid').value, irr = $('bemIrr').checked, key = bodyKey(P.st);
        const bkey = JSON.stringify([key, f0, f1, n, fid, irr, heads, useCapy ? 'capytaine' : 'floatsim']);
        let bem = K.rao && K.rao.bemKey === bkey ? K.rao.bem : null;
        if (!bem) {
          $('raoCancel').classList.remove('hidden');
          K.bemRun = (useCapy ? runCapytaine : runBem)({ rel: P.rel, zw: P.zw, rho: P.st.rho, omegas, headings: heads, fidelity: fid, irr, onProgress: (q) => progress(q.frac, q.text) });
          try { bem = await K.bemRun.promise; } finally { K.bemRun = null; $('raoCancel').classList.add('hidden'); }
        }
        const Kx = X.moor || X.plateA ? { K: X.moor ? X.moor.K : null, A: X.plateA } : null;
        const nat = bemNatural(P.model, bem, Kx), Bextra = bemExtraDamping(P.model, nat, extraZeta());
        const base = { kind: 'bem', model: P.model, bem, Bextra };
        const extraFor = (b) => linExtra(P, sNow, b, base);
        const sweep = bemSweep(P.model, bem, heads, Bextra, extraFor);
        K.rao = { freqs, omegas, heads, sweep, P, resp: new Map(), method: 'bem', bem, bemKey: bkey, bodyKey: key, nat, Bextra, extraFor, X, seaLin: sNow, dRef: P.toEq([0, 0, 0]) };
        const I = bem.info, z = extraZeta(), capyRun = I.solver === 'capytaine';
        if ($('hBemSim').checked && coversNatural(P, bem) && !(K.simBem && K.simBem.key === key && K.simBem.bem === bem)) K.simBem = { key, bem, source: capyRun ? 'the Capytaine RAO sweep' : 'the panel-method RAO sweep' };
        const natTxt = (X.moor ? [['surge', 0], ['sway', 1], ['heave', 2], ['roll', 3], ['pitch', 4], ['yaw', 5]] : [['heave', 2], ['roll', 3], ['pitch', 4]]).map(([nm, j]) => nat[j].w > 0
          ? `${nm} ${f(nat[j].w / TWO_PI)} Hz (T ${f(TWO_PI / nat[j].w)} s, radiation damping ζ ${f(100 * nat[j].zeta, 2)} %${z[j] ? ` + ${f(100 * z[j], 2)} % extra` : ''})${nat[j].inRange ? '' : ' <span class="warn">outside the sweep</span>'}` : '').filter(Boolean).join(', ');
        const low = [['heave', 2], ['roll', 3], ['pitch', 4]].filter(([, j]) => nat[j].w > 0 && nat[j].inRange && nat[j].zeta + z[j] < 0.02).map(([nm]) => nm);
        // radiation damping is radiated wave energy, so B_jj < 0 means the panels are too coarse at that frequency.
        // Scale by the largest translational or rotational damping: a term that is zero by symmetry (yaw of a buoy)
        // is round-off around zero, not a negative result.
        const DOF = ['surge', 'sway', 'heave', 'roll', 'pitch', 'yaw'];
        const bScale = [0, 3].map((o) => Math.max(...bem.B.flatMap((b) => [0, 1, 2].map((i) => Math.abs(b[o + i][o + i])))));
        const negB = DOF.map((nm, j) => {
          const pk = bScale[j < 3 ? 0 : 1];
          const k = bem.B.findIndex((b) => b[j][j] < -0.01 * pk);
          return pk > 0 && k >= 0 ? [nm, bem.omegas[k]] : null;
        }).filter(Boolean);
        const wNeg = negB.length ? Math.min(...negB.map(([, w]) => w)) : 0;
        $('raoInfo').innerHTML = `${capyRun ? `Capytaine ${I.version} on this computer (direct formulation, Float Sim's panel mesh)` : 'Panel method'}: ${heads.length} headings × ${n} frequencies in ${f((performance.now() - t0) / 1000)} s · ${I.panels.toLocaleString()} panels${I.lidPanels ? ` + ${I.lidPanels.toLocaleString()} lid` : ''} (${I.sym.x && I.sym.y ? 'two symmetry planes' : I.sym.x || I.sym.y ? 'one symmetry plane' : 'no symmetry'}, panel size ${f(I.h)} m, mean quality ${f(I.quality.qMean, 2)}) on ${I.workers} worker${capyRun ? ' process' : ''}${I.workers > 1 ? (capyRun ? 'es' : 's') : ''}.<br>
          Natural frequencies (with frequency-dependent added mass): ${natTxt}.
          ${I.note ? `<br><span class="hint">${I.note}</span>` : ''}
          ${irr && !I.lidPanels ? '<br><span class="warn">⚠ The irregular-frequency lid could not be built for this waterplane, so the results may show spurious spikes at the hull\'s irregular frequencies.</span>' : ''}
          ${negB.length ? `<br><span class="warn">⚠ Radiation damping came out negative (${negB.map(([nm]) => nm).join(', ')}) from ${f(wNeg / TWO_PI)} Hz up. That is not physical: the panels are too coarse for those wavelengths, so use a finer fidelity or a lower top frequency.</span>` : ''}
          ${low.length && !X.drag ? `<br><span class="warn">⚠ ${low.join(', ')} resonance has under 2 % of critical damping. That is what potential flow gives, but viscous effects make real peaks lower: add extra ζ in Waves → Hydrodynamics &amp; wave detail, or viscous drag (Tools menu).</span>` : ''}${extrasRaoNote(X, sNow, nat.map((q) => q.w))}`;
      }
      $('raoInfo').insertAdjacentHTML('beforeend', `<br>${refNote()}`);
      $('raoCsv').disabled = false; $('raoRaw').disabled = false;
      progress(1, 'Rendering plots…');
      await nextPaint();
      await drawRaoAsync();
    } catch (err) {
      if (!err.cancelled) console.error(err);
      $('raoInfo').innerHTML = err.cancelled ? '<span class="warn">Cancelled.</span>' : `<span class="bad">${err.message || err}</span>`;
      $('raoLoading').classList.add('hidden');
      if (!K.rao) $('raoEmpty').classList.remove('hidden');
    } finally {
      raoBusy = false; $('raoRun').disabled = false; progress(null); raoTitle = ''; syncCapyBtn();
    }
  }
  $('raoDof').onchange = () => drawRaoAsync(); $('raoNorm').onchange = () => drawRaoAsync();
  // ------------------------------------------------------------ RAO reference point
  // The RAOs are solved about G (equilibrium axes, phase at G). The charts, tables and exports show them at the
  // chosen reference point: the ref csys origin (the model's (0, 0, 0)) or G. dRef = origin − G in the solve's axes.
  const atRef = () => $('raoRef').value === 'ref';
  const refD = () => (atRef() && K.rao && K.rao.dRef ? K.rao.dRef : null);
  function refSweep() {
    const key = $('raoRef').value;
    if (!K.rao.view || K.rao.viewKey !== key) { K.rao.view = refD() ? sweepAtPoint(K.rao.sweep, K.rao.dRef) : K.rao.sweep; K.rao.viewKey = key; }
    return K.rao.view;
  }
  const refXi = (xi, k, beta) => (refD() ? raoAtPoint(xi, k, beta, K.rao.dRef) : xi);
  const v3 = (v) => `(${v.map((c) => f(Math.abs(c) < 1e-9 ? 0 : c, 4)).join(', ')})`;
  function refNote() {
    if (!K.rao) return '';
    const d = K.rao.dRef;
    return atRef()
      ? `Motions at the ref csys origin${api.refCustom() ? '' : ' (the file origin)'}, ${v3(d)} m from G in the RAO axes; phases from the wave at that point.`
      : 'Motions at the CoG G; phases from the wave at G.';
  }
  $('raoRef').onchange = () => {
    $('raoRefSum').textContent = atRef() ? 'ref csys origin' : 'CoG (G)';
    if (!K.rao) return;
    K.rao.resp.clear();
    const info = $('raoInfo'), last = info.innerHTML.lastIndexOf('<br>');
    if (last >= 0 && /Motions at the/.test(info.innerHTML.slice(last))) info.innerHTML = `${info.innerHTML.slice(0, last)}<br>${refNote()}`;
    drawRaoAsync();
  };
  $('followTol').onchange = () => drawFollow();
  // natural frequencies of the estimate model with the mooring stiffness and plate added mass
  function wnExtras(P, X, Am) {
    const Km = X.moor ? X.moor.K : null, Ap = X.plateA || [0, 0, 0, 0, 0, 0];
    return [0, 1, 2, 3, 4, 5].map((j) => { const c = P.model.Cm[j][j] + (Km ? Km[j][j] : 0); return c > 1e-9 * P.model.Mm[j][j] ? Math.sqrt(c / (P.model.Mm[j][j] + Am[j] + Ap[j])) : 0; });
  }
  function extrasRaoNote(X, s, wn) {
    const out = [];
    if (X.moor) out.push(`mooring stiffness from the catenary at the mean position${X.wind ? ' under the steady wind' : ''} (moored surge ${wn[0] > 0 ? `T ${f(TWO_PI / wn[0])} s` : '—'}, sway ${wn[1] > 0 ? `T ${f(TWO_PI / wn[1])} s` : '—'})`);
    if (X.plateA) out.push(`${X.drag.plates.length} heave plate${X.drag.plates.length > 1 ? 's' : ''} (added mass ${f(X.plateA[2])} kg)`);
    if (X.drag) out.push(s.active ? `viscous drag linearised for ${s.label} at each heading` : '<span class="warn">viscous drag is on, but the sea set in Waves is calm, so the RAOs have no drag damping (it is linearised for a sea state)</span>');
    if (X.wind) out.push('wind is not in the RAOs (a mean load and slow gusts): see the wave runs');
    return out.length ? `<br>Small-body options: ${out.join('; ')}.` : '';
  }
  // Wave-following quality: how closely heave, tilt and horizontal motion follow the wave (complex error, so phase lag
  // counts), and the frequency up to which each stays within the tolerance.
  function drawFollow() {
    if (!K.rao || $('tabRao').classList.contains('hidden')) return;
    const { freqs, heads } = K.rao, sweep = refSweep(), tol = Math.max(0.001, (parseFloat($('followTol').value) || 5) / 100);
    const errs = sweep.map((h) => h.points.map((p) => followErrors(p, h.beta)));
    const j = +$('raoDof').value, kind = j === 2 ? 'heave' : (j === 3 || j === 4) ? 'tilt' : j === 5 ? 'heave' : 'horiz';
    const color = (i) => (heads.length === 1 ? SERIES[0] : rampColor(i / (heads.length - 1)));
    lineChart($('followCv'), {
      series: errs.map((e, i) => ({ name: `β ${heads[i]}°`, color: color(i), x: freqs, y: e.map((q) => 100 * q[kind]) })),
      hlines: [{ y: 100 * tol, label: `tolerance ${f(100 * tol)} %` }],
      xLabel: 'f (Hz)', yLabel: `${{ heave: 'heave', tilt: 'tilt', horiz: 'horizontal' }[kind]} error (%)`, height: 140, yMin: 0, yMax: Math.max(4 * 100 * tol, 1),
      rampLegend: heads.length > 5 ? { label: 'heading', from: `β ${heads[0]}°`, to: `β ${heads[heads.length - 1]}°`, color: (t) => rampColor(t) } : null,
    });
    const desc = (c) => (c.status === 'never' ? '<span class="warn">exceeds at f min</span>' : c.status === 'within' ? `within up to ${f(c.f)} Hz (whole sweep)` : `${f(c.f)} Hz · T ${f(1 / c.f)} s · λ ${f(G / (TWO_PI * c.f * c.f))} m`);
    const rows = heads.map((b, i) => {
      const e = errs[i], cut = (k) => followCutoff(freqs, e.map((q) => q[k]), tol);
      return `<tr><td>β ${b}°</td><td>${desc(cut('heave'))}</td><td>${desc(cut('tilt'))}</td><td>${desc(cut('horiz'))}</td></tr>`;
    });
    $('followInfo').innerHTML = `<table class="grid"><tr class="h"><td></td><td>heave</td><td>tilt (slope)</td><td>horizontal</td></tr>${rows.join('')}</table>
      <span class="hint">At the RAO reference point (${atRef() ? 'the ref csys origin' : 'G'}). Follows the waves within ${f(100 * tol)} % up to the frequency shown, i.e. for waves longer than that period. Error = |RAO − ideal| with phase, where an ideal follower heaves with the surface (1 m/m), tilts with the slope (z axis normal to the surface) and moves sideways with the surface water (deep water). Heave matters for displacement buoys, tilt for pitch-roll (directional) buoys, horizontal for GPS buoys. The chart shows the error for the RAO selected above (heave/yaw → heave, roll/pitch → tilt, surge/sway → horizontal).</span>`;
  }

  // RAO tab: show a loading overlay, let it paint, then draw (charts) and fill the sea-state response table.
  async function drawRaoAsync() {
    if (!K.rao) { $('raoEmpty').classList.remove('hidden'); $('raoLoading').classList.add('hidden'); return; }
    $('raoEmpty').classList.add('hidden');
    $('raoLoadingText').textContent = 'Rendering RAO plots…';
    $('raoLoading').classList.remove('hidden');
    await nextPaint();
    try { drawRao(); drawFollow(); await drawResponse(); } finally { $('raoLoading').classList.add('hidden'); }
  }
  function drawRao() {
    if (!K.rao || $('tabRao').classList.contains('hidden')) return;
    const { freqs, heads, P } = K.rao, sweep = refSweep();
    const j = +$('raoDof').value, rot = j >= 3, slope = $('raoNorm').value === 'slope';
    const val = (p) => (rot ? (slope ? p.perSlope[j] : p.degPerM[j]) : p.amp[j]);
    const unit = rot ? (slope ? 'deg/deg' : 'deg/m') : 'm/m';
    const color = (i) => (heads.length === 1 ? SERIES[0] : rampColor(i / (heads.length - 1)));
    const series = sweep.map((h, i) => ({ name: `β ${h.beta}°`, color: color(i), x: freqs, y: h.points.map(val) }));
    const wnj = K.rao.nat ? K.rao.nat[j].w : (K.rao.wn || P.model.wn)[j];
    const vl = wnj > 0 ? [{ x: wnj / TWO_PI, label: `${DOF[j]} fn` }] : [];
    const rampLegend = heads.length > 5 ? { label: 'heading', from: `β ${heads[0]}°`, to: `β ${heads[heads.length - 1]}°`, color: (t) => rampColor(t) } : null;
    lineChart($('raoCv'), { series, xLabel: 'f (Hz)', yLabel: `${DOF[j]} RAO${j < 3 ? (atRef() ? ' at the ref origin' : ' at G') : ''} (${unit})`, vlines: vl, height: 180, rampLegend });
    // phase is meaningless where the response vanishes (e.g. roll in head seas), so mask it there
    const ampMax = Math.max(1e-30, ...sweep.flatMap((h) => h.points.map((p) => p.amp[j])));
    lineChart($('raoPh'), { series: sweep.map((h, i) => ({ name: `β ${h.beta}°`, color: color(i), x: freqs, y: h.points.map((p) => (p.amp[j] > 1e-4 * ampMax ? p.phase[j] : NaN)) })),
      xLabel: 'f (Hz)', yLabel: 'phase (deg)', yMin: -180, yMax: 180, height: 130, legend: false });
    heatmap($('raoHeat'), { rows: heads, cols: freqs, values: sweep.map((h) => h.points.map(val)), rowLabel: 'β (deg)', colLabel: 'f (Hz)', valueLabel: `${DOF[j]} (${unit})`, height: 150 });
  }
  // Response in the current sea state, from the computed sweep (cached). Falls back to re-solving on a
  // dedicated grid only when the sweep misses a large part of the wave energy.
  async function drawResponse() {
    const { heads, P, resp } = K.rao, sweep = refSweep();
    const j = +$('raoDof').value, rot = j >= 3, s = sea();
    if (!s.active) { $('raoResp').innerHTML = ''; return; }
    if (s.mode === 'regular') {
      const amp = (b) => {
        if (!K.rao.bem) { const r = raoAt(P.model, TWO_PI / s.T, b, K.rao.extraFor ? K.rao.extraFor(b) : null); return Math.hypot(...refXi(r.xi, r.k, b)[j]) * s.A * (rot ? 180 / Math.PI : 1); }
        const r = raoAtBem(P.model, K.rao.bem, TWO_PI / s.T, b, K.rao.Bextra, K.rao.extraFor ? K.rao.extraFor(b) : null);
        return r ? Math.hypot(...refXi(r.xi, r.k, b)[j]) * s.A * (rot ? 180 / Math.PI : 1) : NaN;
      };
      const rows = heads.map((b) => `<tr><td>β ${b}°</td><td>${Number.isFinite(amp(b)) ? `${f(amp(b))} ${rot ? '°' : 'm'}` : 'period outside the sweep'}</td></tr>`);
      $('raoResp').innerHTML = `<b>${DOF[j]}${j < 3 ? (atRef() ? ' of the ref origin' : ' of G') : ''} in a regular wave (${s.label}):</b><table><tr><td></td><td>steady amplitude, |RAO| × A</td></tr>${rows.join('')}</table>`;
      return;
    }
    const S = spectrumFn(s.type, s.Hs, s.Tp, s.gamma), wp = TWO_PI / s.Tp;
    const m0Wave = s.Hs * s.Hs / 16;
    const rows = [];
    let fallback = false;
    for (let i = 0; i < heads.length; i++) {
      const key = JSON.stringify([s, j, heads[i]]);
      let r = resp.get(key);
      if (!r) {
        r = spectralFromSweep(sweep[i].points, S, j, 3 * 3600, m0Wave);
        if (r.coverage < 0.9 && K.rao.bem) fallback = 'bem';
        else if (r.coverage < 0.9) {
          fallback = true;
          $('raoLoadingText').textContent = `Sweep range covers ${Math.round(r.coverage * 100)} % of the sea's energy; re-solving on a full grid… (${i + 1}/${heads.length})`;
          await nextPaint();
          r = { ...spectralResponse(P.model, S, heads[i], j, 0.4 * wp, Math.max(4 * wp, P.model.wn[j] * 1.5 || 0), 200, 3 * 3600, K.rao.extraFor ? K.rao.extraFor(heads[i]) : null, (xi, k) => refXi(xi, k, heads[i])), coverage: 1 };
        }
        resp.set(key, r);
      }
      rows.push(`<tr><td>β ${heads[i]}°</td><td>${f(r.sig)} ${rot ? '°' : 'm'}</td><td>${f(r.mpm)} ${rot ? '°' : 'm'}</td></tr>`);
    }
    $('raoResp').innerHTML = `<b>${DOF[j]}${j < 3 ? (atRef() ? ' of the ref origin' : ' of G') : ''} in SS${ssSel.value} (Hs ${s.Hs} m, Tp ${s.Tp} s):</b><table><tr><td></td><td>significant (2σ)</td><td>most-probable max, 3 h</td></tr>${rows.join('')}</table>
      ${fallback === 'bem' ? '<span class="warn">The RAO frequency range covers less than 90 % of this sea\'s energy, so these values are low. Widen the range and compute again.</span>' : fallback ? '<span class="hint">The RAO frequency range did not cover this sea state, so these were computed on a separate full grid.</span>' : ''}`;
  }
  const download = (name, text) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const num6 = (v) => +(+v).toPrecision(8);
  $('raoCsv').onclick = () => {
    if (!K.rao) return;
    const head = ['beta_deg', 'f_Hz', 'omega_rad_s', 'period_s', 'wavelength_m', ...DOF.map((d, j) => (j < 3 ? `${d}_m_per_m` : `${d}_deg_per_m`)), ...DOF.slice(3).map((d) => `${d}_deg_per_deg_slope`), ...DOF.map((d) => `${d}_phase_deg`)];
    const lines = [head.join(',')];
    for (const h of refSweep()) for (const p of h.points) lines.push([h.beta, p.f, p.w, p.T, p.lambda, ...p.degPerM, ...p.perSlope.slice(3), ...p.phase].map(num6).join(','));
    download(atRef() ? 'rao_at_ref_origin.csv' : 'rao_at_G.csv', lines.join('\n'));
  };
  // Raw export: complex RAOs and excitation per DOF, plus the linear model's matrices as comment lines.
  $('raoRaw').onclick = () => {
    if (!K.rao) return;
    const { P } = K.rao, M = P.model, st = P.st;
    const mat = (name, A) => A.map((row, i) => `# ${name}[${i + 1},:] = ${row.map(num6).join(' ')}`);
    const hdr = [
      '# Float Sim raw RAO export',
      `# model: ${st.model.name}; mass ${num6(st.m)} kg; water density ${st.rho} kg/m^3; g 9.80665 m/s^2; deep water; zero forward speed`,
      `# reference csys: ${api.refCustom() ? 'custom (entered from CAD); the model coordinates are in it' : 'the file\'s own origin and axes'}; CoG G at ${P.st.G.map(num6).join(' ')} m in it`,
      '# axes: the reference csys as the body floats (equilibrium attitude, yaw removed): z up, x along the ref +x, roll about x, pitch about y; beta from the ref +x',
      atRef() ? `# motions xi: of the ref csys origin O, at ${K.rao.dRef.map(num6).join(' ')} m from G in these axes (xi_O = xi_G + theta x (O - G)); forces F and moments about O`
        : '# motions xi: of the CoG G; forces F and moments about G',
      `# wave: eta = A cos(k(x cos beta + y sin beta) - omega t), phase measured at ${atRef() ? 'O' : 'G'}; complex amplitudes use exp(+i omega t), per unit wave amplitude A`,
      '# units: translations m/m, rotations rad/m; excitation forces N/m, moments N*m/m',
      ...(K.rao.bem ? [
        K.rao.bem.info.solver === 'capytaine'
          ? `# hydrodynamics: Capytaine ${K.rao.bem.info.version} (direct formulation, deep water) on Float Sim's panel mesh, ${K.rao.bem.info.panels} panels + ${K.rao.bem.info.lidPanels} lid, panel size ${num6(K.rao.bem.info.h)} m; excitation = Froude–Krylov + diffraction`
          : `# hydrodynamics: panel method (deep water), ${K.rao.bem.info.panels} panels + ${K.rao.bem.info.lidPanels} lid, panel size ${num6(K.rao.bem.info.h)} m; excitation from the Haskind relation`,
        `# natural frequencies (rad/s, uncoupled, with A(omega)): ${K.rao.nat.map((n) => num6(n.w)).join(' ')}`,
        `# extra viscous damping (diagonal; N*s/m, N*m*s/rad): ${K.rao.Bextra.map(num6).join(' ')}`,
        '# columns A_ij, B_ij: frequency-dependent added mass and radiation damping about G (diagonal and the surge-pitch, sway-roll couplings)',
      ] : [
        `# hydrodynamics: Froude-Krylov with estimated added mass and damping; diffraction correction (surge, sway, heave): ${M.diffraction.join(', ')}`,
        `# natural frequencies (rad/s, uncoupled): ${M.wn.map(num6).join(' ')}`,
        `# added mass A (diagonal; kg, kg*m^2): ${M.Am.map(num6).join(' ')}`,
        `# linear damping B (diagonal; N*s/m, N*m*s/rad): ${M.Bd.map(num6).join(' ')}`,
      ]),
      '# matrices below: about G in these axes',
      ...mat('mass matrix M', M.Mm), ...mat('restoring matrix C', M.Cm),
      ...(K.rao.X && K.rao.X.moor ? mat('mooring stiffness K (added to C)', K.rao.X.moor.K) : []),
      ...(K.rao.X && K.rao.X.plateA ? [`# heave-plate added mass (diagonal, added to A): ${K.rao.X.plateA.map(num6).join(' ')}`] : []),
      ...(K.rao.X && K.rao.X.drag ? [`# viscous drag linearised for ${K.rao.seaLin.label} (equivalent linear damping per heading; xi and F include it)`] : []),
    ];
    const cols = ['beta_deg', 'f_Hz', 'omega_rad_s', 'k_rad_per_m', 'wavelength_m'];
    for (const d of DOF) cols.push(`${d}_xi_re`, `${d}_xi_im`, `${d}_xi_abs`, `${d}_xi_phase_deg`, `${d}_F_re`, `${d}_F_im`);
    const AB = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [0, 4], [1, 3]];
    if (K.rao.bem) for (const [i, j] of AB) cols.push(`A${i + 1}${j + 1}`); if (K.rao.bem) for (const [i, j] of AB) cols.push(`B${i + 1}${j + 1}`);
    const lines = [...hdr, cols.join(',')];
    for (const h of refSweep()) for (const p of h.points) {
      const row = [h.beta, p.f, p.w, p.k, p.lambda];
      for (let j = 0; j < 6; j++) row.push(p.xi[j][0], p.xi[j][1], p.amp[j], p.phase[j], p.F[j][0], p.F[j][1]);
      if (K.rao.bem) { for (const [i, j] of AB) row.push(p.A[i][j]); for (const [i, j] of AB) row.push(p.B[i][j]); }
      lines.push(row.map(num6).join(','));
    }
    download(atRef() ? 'rao_raw_at_ref_origin.csv' : 'rao_raw_at_G.csv', lines.join('\n'));
  };

  // ------------------------------------------------------------ info boxes for sections 11–13
  function updateExtrasInfo() {
    const cfg = api.extras.config();
    const P = cfg.drag || cfg.moor || cfg.wind ? prepare() : null;
    if (!P) { for (const id of ['dragInfo', 'moorInfo', 'windInfo']) api.extras.setInfo(id, ''); drawRestMooring(); return; }
    const s = sea(), X = extrasFor(P, s), st = P.st, Lu = (m) => `${f(m)} m`;
    // static heel from the mean line pull and wind (linear: C_rot δθ = M)
    const Kt = P.model.Cm.map((row, i) => row.map((v, j) => v + (X.moor ? X.moor.K[i][j] : 0)));
    const Mrest = [0, 0, 0];
    if (X.moor) for (let k = 0; k < 3; k++) Mrest[k] += X.moor.under.M[k];
    if (X.wind) for (let k = 0; k < 3; k++) Mrest[k] += X.wind.rest.M[k];
    const det = Kt[3][3] * Kt[4][4] - Kt[3][4] * Kt[4][3];
    const heel = det > 0 ? [(Kt[4][4] * Mrest[0] - Kt[3][4] * Mrest[1]) / det, (-Kt[4][3] * Mrest[0] + Kt[3][3] * Mrest[1]) / det].map((x) => x * 180 / Math.PI) : [NaN, NaN];
    const heelTxt = `roll ${f(heel[0])}°, pitch ${f(heel[1])}°`;
    if (X.drag) {
      const g = X.drag.geo, sm = simModel(P, s);
      let zTxt = '';
      if (s.active) {
        const ex = linExtra(P, s, s.heading, { kind: 'fk', model: sm.model });
        if (ex && ex.lin) {
          // equivalent damping ratio of each mode from the linearised drag (diagonal), at the natural frequency
          const wn = sm.model.wn, Ap = X.plateA || [0, 0, 0, 0, 0, 0];
          const Bt = [0, 0, 0, 0, 0, 0];
          ex.els.forEach((e, i) => { for (let j = 0; j < 6; j++) Bt[j] += ex.lin.Beq[i] * e.gf[j] * e.gv[j]; });
          const z = [2, 3, 4].map((j) => (wn[j] > 0 ? Bt[j] / (2 * (P.model.Mm[j][j] + sm.A[j]) * wn[j]) : NaN));
          zTxt = `<br>Equivalent linear damping in ${s.label} (direction ${s.dir}°): heave ζ ${f(100 * z[0], 2)} %, roll ζ ${f(100 * z[1], 2)} %, pitch ζ ${f(100 * z[2], 2)} % of critical.`;
        }
      }
      api.extras.setInfo('dragInfo', `Projected areas: X ${f(g.A[0])} m², Y ${f(g.A[1])} m², from below ${f(g.A[2])} m².${X.plateA ? ` Heave plates: added mass ${f(X.plateA[2])} kg (body ${f(st.m)} kg).` : ''}${zTxt}`);
    } else api.extras.setInfo('dragInfo', '');
    if (X.moor) {
      const mb = X.moor, rs = mb.rest.sols, w = mb.w;
      const lines = rs.map((q, i) => `line ${i + 1}: ${q.sol.regime === 'touchdown' ? `${f(q.sol.LB)} m on the seabed` : q.sol.regime === 'slack' ? 'slack (hangs straight down, the rest lies on the seabed)' : q.sol.regime === 'taut' ? 'fully suspended (lifts off the anchor)' : (q.T > 0 ? 'taut' : 'slack')}, tension ${f(q.T)} N (H ${f(q.sol.H)}, V ${f(q.sol.V)})${q.sol.VA > 0 ? ' <span class="warn">anchor uplift</span>' : ''}`);
      const k = mb.rest.Kf, dz = mb.zwFree - P.zw;
      const off = Math.hypot(...mb.offset);
      api.extras.setInfo('moorInfo', `At the mean position${off > 1e-6 ? ` (${Lu(off)} from where the anchors were laid out, toward ${f(((Math.atan2(mb.offset[1], mb.offset[0]) * 180 / Math.PI) + 360) % 360)}°)` : ''}: ${lines.join('; ')}.<br>
        Submerged line weight ${f(w)} N/m. Line pull ${f(mb.Vline)} N down: the body floats ${Lu(Math.abs(dz))} ${dz < 0 ? 'deeper' : 'higher'} than free (draft used by the wave and RAO tools).<br>
        Linear stiffness at the fairlead: horizontal ${f(k[0][0])} / ${f(k[1][1])} N/m, vertical ${f(k[2][2])} N/m${k[0][0] < 1e-6 && k[1][1] < 1e-6 ? ' (slack: the body is free to wander until a line lifts)' : ''}.${mb.under.converged ? '' : ' <span class="warn">No equilibrium found: the lines cannot hold the steady load.</span>'}
        Static heel from the line pull${X.wind ? ' and wind' : ''} (linear): ${heelTxt}.
        ${mb.tautish ? '<br><span class="warn">A line is close to taut: expect snap loads in waves (dynamic model) and a stiff, fast response (smaller time step).</span>' : ''}`);
    } else api.extras.setInfo('moorInfo', '');
    if (X.wind) {
      const wr = X.wind.rest, Fh = Math.hypot(wr.F[0], wr.F[1]);
      // free-drift estimate: wind drag balanced by water drag on the lateral area (drag coefficient from section 11 or the wave-drift C_d)
      const d = X.wind.params.dirDeg * Math.PI / 180;
      const Aw = X.drag ? Math.abs(Math.cos(d)) * X.drag.geo.A[0] * X.drag.geo.Cd[0] + Math.abs(Math.sin(d)) * X.drag.geo.A[1] * X.drag.geo.Cd[1] : null;
      const vDrift = Aw ? Math.sqrt(Fh / (0.5 * st.rho * Aw)) : null;
      api.extras.setInfo('windInfo', `Steady wind at rest: ${f(Fh)} N on ${f(wr.area)} m² of projected area (windage centre ${f(X.wind.zRef, 2)} m up, wind there ${f(X.wind.U)} m/s${X.wind.sigma ? `, gusts σ ${f(X.wind.sigma, 2)} m/s` : ''}).<br>
        Heeling moment about G ${f(Math.hypot(wr.M[0], wr.M[1]))} N·m: static heel (linear) ${heelTxt}${X.moor ? ' with the mooring' : ''}.
        ${vDrift ? `<br>Free wind drift ≈ ${f(vDrift)} m/s (wind drag = water drag on the side area; plus the wave drift)` : X.moor ? '' : '<br><span class="hint">Turn on viscous drag (Tools › Viscous drag &amp; heave plates) for a free wind-drift estimate.</span>'}`);
    } else api.extras.setInfo('windInfo', '');
    drawRestMooring();
  }
  let infoQueued = false;
  const queueInfo = () => { if (infoQueued) return; infoQueued = true; requestAnimationFrame(() => { infoQueued = false; try { updateExtrasInfo(); } catch (e) { console.error(e); } }); };

  // ------------------------------------------------------------ tabs
  function showTab(id, { skipDraw = false } = {}) {
    for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === id);
    for (const t of ['tabHydro', 'tabSea', 'tabRao', 'tabDrop']) $(t).classList.toggle('hidden', t !== id);
    if (id === 'tabSea') { drawSpectrum(); if (K.stats && !K.running) drawHistories(K.stats.series); }
    if (id === 'tabRao' && !skipDraw) drawRaoAsync();
    if (api.onTabShown) api.onTabShown(id);
  }
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

  function onInputs() {
    if (!$('tabSea').classList.contains('hidden')) drawSpectrum();
    if (!$('tabRao').classList.contains('hidden') && K.rao) { K.rao.resp.clear(); drawRaoAsync(); }
    queueInfo();
  }

  applySS();
  return {
    frame,
    onModelChange() {
      stopRun(); K.prep = null; K.stats = null; onInputs();
      $('ptCharts').classList.add('hidden'); $('moorCharts').classList.add('hidden');
      if (K.rao && !K.rao.stale && !raoBusy) {
        K.rao.stale = true;
        $('raoInfo').insertAdjacentHTML('afterbegin', '<span class="warn">⚠ Inputs changed since these RAOs were computed. Click Compute RAOs to update them.</span><br>');
      }
    },
    showTab,
    // a small-body option changed: the prepared body (mooring draft), the simulator model and the RAOs depend on them
    onExtrasChange() {
      if (K.running) { stopRun(); }
      K.prep = null; K.stats = null; onInputs();
      if (K.rao && !K.rao.stale && !raoBusy) {
        K.rao.stale = true;
        $('raoInfo').insertAdjacentHTML('afterbegin', '<span class="warn">⚠ Small-body options changed since these RAOs were computed. Click Compute RAOs to update them.</span><br>');
      }
    },
    // drop/rise test placement locks the wave and RAO tools (they assume the body floats at rest)
    setLocked(on) {
      K.locked = on;
      if (on) stopRun();
      for (const id of ['waveRun', 'waveStats', 'ssSweep', 'raoRun']) { $(id).disabled = on; $(id).title = on ? 'Exit the drop / rise test (or reset its position) first' : ''; }
      syncCapyBtn();
      for (const n of document.querySelectorAll('.lock-note')) n.classList.toggle('hidden', !on);
    },
    clearRao() { K.rao = null; $('raoCsv').disabled = true; $('raoRaw').disabled = true; },
    // panel-method coefficients for the drop test: { A[6], Bd[6], source } at the natural frequencies, or null
    ensureSimBem,
    simCoeffs() { const P = prepare(); if (!P) return null; const sm = simModel(P, null); return sm.source === 'estimates' ? null : sm; },
    get running() { return K.running; },
  };
}
