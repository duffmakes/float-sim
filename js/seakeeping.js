// Sea-state simulation, spectral stability estimates and RAO sweeps (UI glue).
import { mat3, transformTris, solveWaterline, hydrostatics, gzCurve, gzSummary, quatToMat3 } from './physics.js';
import { SEA_STATES, spectrumFn, pmSpectrum, jonswapSpectrum, dnvGamma, WaveField, G, regularAmplitude, waveNumber } from './waves.js';
import {
  refineTris, indexMesh, waveForces, linearModel, defaultHydroCoeffs, raoSweepAsync, raoAt, spectralResponse, spectralFromSweep,
  diffractionCheck, waterplaneExtent, bodyFrameVolQ, DOF, bemSweep, raoAtBem, bemNatural, bemExtraDamping, bemCoeffsAt,
} from './hydro.js';
import { runBem } from './bemrun.js';
import { WaveSim, seriesStats } from './sim.js';
import { lineChart, heatmap, SERIES, rampColor } from './charts.js';

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
  $('ssHead').oninput = () => { $('ssHeadN').value = $('ssHead').value; onInputs(); };
  $('ssHeadN').onchange = () => { $('ssHead').value = $('ssHeadN').value; onInputs(); };
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
    return { mode: 'regular', H, T, heightKind, A, heading: parseFloat($('ssHeadN').value) || 0, active: H > 0 && T > 0, T0: T,
      label: `Regular H ${f(2 * A)} m, T ${f(T)} s` };
  };
  const spectrumSea = () => {
    const Hs = Math.max(0, parseFloat($('ssHs').value) || 0), Tp = Math.max(0, parseFloat($('ssTp').value) || 0);
    let gamma = Math.min(7, Math.max(1, parseFloat($('ssGamma').value) || 3.3));
    if ($('ssDnvGamma').checked && Hs > 0) { gamma = dnvGamma(Hs, Tp); $('ssGamma').value = +gamma.toFixed(2); }
    return { type: K.specType, Hs, Tp, gamma, heading: parseFloat($('ssHeadN').value) || 0,
      N: Math.max(5, Math.min(300, parseInt($('ssN').value) || 50)), seed: parseInt($('ssSeed').value) || 1, spread: Math.max(0, parseFloat($('ssSpread').value) || 0),
      mode: 'spectrum', active: Hs > 0 && Tp > 0, T0: Tp, label: `SS${ssSel.value}` };
  };

  // ------------------------------------------------------------ body preparation (seakeeping frame)
  // The model is yawed so its +X axis lies along world X; β is then relative to the model's +X.
  function prepare() {
    const st = api.getState();
    if (!st || st.H.status === 'sinks') return null;
    const key = JSON.stringify([st.model.name, st.model.tris.length, st.m, st.G, st.rho, api.getEuler(), api.inertiaKey(), $('raoFmax').value,
      ['hA11', 'hA22', 'hA33', 'hA44', 'hA55', 'hZ3', 'hZ4', 'hZ5'].map((i) => $(i).value), $('hDiffH').checked, $('hDiffV').checked]);
    if (K.prep && K.prep.key === key) return K.prep;
    const R = st.R, yaw = Math.atan2(R[3], R[0]);
    const Rsk = mat3.mul(mat3.rotZ(-yaw), R);
    const rel = transformTris(st.model.tris, Rsk, st.G);
    const sol = solveWaterline(rel, st.m / st.rho);
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
    const gz = gzSummary(gzCurve(rel, H.V, 'x'));
    const offset = Math.hypot(...H.offset);
    K.prep = { key, Rsk, rel, H, IGb, IGw, coeffs, model, diffModes, zw: sol.zw, size, gz, vanish: gz.unstable ? 0 : (gz.vanish ?? 180), offset, st, hulls: {} };
    return K.prep;
  }
  // ------------------------------------------------------------ panel-method (BEM) coefficients
  // Panel-method results depend only on the floating body: geometry, mass, CoG, water and attitude.
  const bodyKey = (st) => JSON.stringify([st.model.name, st.model.tris.length, st.m, st.G, st.rho, api.getEuler()]);
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
    const run = runBem({ rel: P.rel, zw: P.zw, rho: st.rho, omegas, fidelity: 'coarse', waveRefine: false, onProgress: (q) => onText(q.text) });
    const bem = await run.promise;
    K.simBem = { key, bem, source: 'a quick coarse panel-method sweep' };
    return K.simBem;
  }
  // a sweep can stand in for the quick one only if it spans the heave, roll and pitch natural frequencies
  const coversNatural = (P, bem) => bemNatural(P.model, bem).every((n, j) => j < 2 || j > 4 || !(n.w > 0) || n.inRange);
  // The linear model the simulators use (and the linear predictions they are compared with): the estimate model,
  // or the same with panel-method added mass and damping when those are on and available for this body.
  function simModel(P, s = null) {
    const sb = $('hBemSim').checked && K.simBem && K.simBem.key === bodyKey(P.st) ? K.simBem : null;
    if (!sb) return { model: P.model, A: P.coeffs.A, Bd: P.model.Bd, source: 'estimates' };
    const T0 = s && s.active && s.T0 > 0 ? s.T0 : 0, ckey = JSON.stringify([T0, extraZeta()]);
    if (P.simCache && P.simCache.sb === sb && P.simCache.ckey === ckey) return P.simCache.out;
    const bem = sb.bem, nat = bemNatural(P.model, bem), ext = bemExtraDamping(P.model, nat, extraZeta());
    const clamp = (w) => Math.max(bem.omegas[0], Math.min(bem.omegas[bem.omegas.length - 1], w));
    const wWave = T0 ? 2 * Math.PI / T0 : (nat[2].w || bem.omegas[0]);
    const A = [], Bd = [], wn = [];
    for (let j = 0; j < 6; j++) {
      const c = bemCoeffsAt(bem, clamp(nat[j].w > 0 ? nat[j].w : wWave));
      A.push(c.A[j][j]); Bd.push(c.B[j][j] + ext[j]); wn.push(nat[j].w);
    }
    const out = { model: { ...P.model, Am: A, Bd, wn }, A, Bd, source: sb.source, nat };
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
  const dtFor = (P, field) => Math.min(2 * Math.PI / Math.max(field.maxOmega || 1, ...P.model.wn) / 60, 0.05);
  const fieldFor = () => WaveField.fromParams(sea());
  // linear steady-state amplitude of DOF j in a regular wave (m, or deg for rotations)
  const regularLinear = (P, s, j) => { const x = raoAt(simModel(P, s).model, 2 * Math.PI / s.T, s.heading).xi[j]; return Math.hypot(x[0], x[1]) * s.A * (j >= 3 ? 180 / Math.PI : 1); };

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
      notes.push(`Linear steady-state prediction at β = ${s.heading}°: heave ±${f(regularLinear(P, s, 2))} m, roll ±${f(regularLinear(P, s, 3))}°, pitch ±${f(regularLinear(P, s, 4))}°.`);
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
    catch (err) { $('waveInfo').innerHTML = `<span class="warn">Panel-method coefficients failed (${err.message}); using the estimates.</span>`; }
    finally { K.starting = false; }
    const P = prepare(); if (!P) return;
    api.stopCalmSim();
    const s = sea();
    const field = fieldFor();
    const hull = hullFor(P, field);
    const sm = simModel(P, s);
    K.sim = new WaveSim({
      hull, mass: P.st.m, inertiaG: P.IGb, rho: P.st.rho, R0: P.Rsk, z0: -P.zw, field,
      A: sm.A, Bd: sm.Bd, dt: dtFor(P, field), ramp: s.T0 > 0 ? Math.min(2 * s.T0, 20) : 0, vanishDeg: P.vanish || 180,
      volQ: hull.volQ, diffModes: P.diffModes, drift: driftParams(s),
    });
    K.simNote = simSourceNote(sm);
    K.field = field; K.hull = hull; K.running = true;
    K.runSea = s; K.runLin = s.mode === 'regular' && s.active ? [2, 3, 4].map((j) => regularLinear(P, s, j)) : null;
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
    $('waveRun').textContent = '▶ Run in waves'; $('waveRestart').disabled = true;
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
    const now = performance.now();
    if (now - K.lastChart > 250) {
      K.lastChart = now;
      const r = sim.rec, n = r.t.length, tmin = sim.t - 60;
      let i0 = 0; while (i0 < n && r.t[i0] < tmin) i0++;
      drawHistories({ t: r.t.slice(i0), roll: r.roll.slice(i0), pitch: r.pitch.slice(i0), heave: r.heave.slice(i0), eta: r.eta.slice(i0) });
      const rs = seriesStats(r.t, r.roll, sim.ramp), ps = seriesStats(r.t, r.pitch, sim.ramp);
      const ramping = sim.t < sim.ramp;
      $('waveInfo').innerHTML = `t = <b>${f(sim.t, 4)} s</b>${ramping ? ' (waves ramping up)' : ''} · roll <b>${f(r.roll[n - 1], 3)}°</b> · pitch <b>${f(r.pitch[n - 1], 3)}°</b><br>
        so far: roll σ ${f(rs.sd)}°, max ${f(sim.stats.maxRoll)}° · pitch max ${f(sim.stats.maxPitch)}° · green-water events ${sim.stats.greenWater}<br>
        ${K.runLin ? `linear steady state: heave ±${f(K.runLin[0])} m, roll ±${f(K.runLin[1])}°, pitch ±${f(K.runLin[2])}° (${K.runSea.label}, β ${K.runSea.heading}°)<br>` : ''}${driftLine(sim)}
        ${sim.stats.capsized ? `<br><span class="bad">✕ Capsized at t = ${f(sim.stats.capsizeT)} s</span>` : ''}
        <br><span class="hint">${(K.hull.idx.length / 3).toLocaleString()} panels · ${field.n} wave components · dt ${f(sim.dt * 1000)} ms · ${K.simNote}</span>`;
    }
  }

  function driftLine(sim) {
    const dist = Math.hypot(sim.p[0], sim.p[1]);
    if (!sim.drift || !sim.drift.on) return `wave drift off: held on station by a soft spring (period ${f(sim.drift ? sim.drift.holdPeriod : 0)} s) · offset ${f(dist)} m`;
    const r = sim.rec, n = r.t.length, i0 = Math.max(0, n - Math.round(30 / sim.dt));
    const dt = n > 1 ? r.t[n - 1] - r.t[i0] : 0;
    const vx = dt > 0 ? (r.x[n - 1] - r.x[i0]) / dt : 0, vy = dt > 0 ? (r.y[n - 1] - r.y[i0]) / dt : 0;
    const u = sim.dr.uNow || [0, 0];
    const far = dist > 10 * K.prep.st.model.diag;
    return `drift ${f(Math.hypot(vx, vy))} m/s toward ${f(((Math.atan2(vy, vx) * 180 / Math.PI) + 360) % 360)}° (last 30 s) · Stokes drift over the draft ${f(Math.hypot(...u))} m/s · distance ${f(dist)} m
      ${far ? `<br><span class="warn">The body has drifted ${f(dist / K.prep.st.model.diag, 2)} body lengths. Use ↺ Restart run to start again from the original position.</span>` : ''}`;
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
  function verdict({ ssLabel, maxRoll, vanish, capsized, greenFrac }) {
    const range = vanish > 0 ? vanish : 0;
    let level, word;
    if (capsized || range === 0) { level = 'bad'; word = capsized ? 'capsized' : 'unstable at rest'; }
    else if (maxRoll >= 0.8 * range) { level = 'bad'; word = 'dangerous'; }
    else if (maxRoll >= 0.5 * range || greenFrac > 0.05) { level = 'warn'; word = 'marginal'; }
    else { level = 'good'; word = 'safe'; }
    const icon = { good: '✓', warn: '!', bad: '✕' }[level];
    return { level, word, icon, text: `${ssLabel}: max roll ${f(maxRoll)}° of ${range >= 180 ? '180° (self-righting)' : `${f(range)}° range`}: ${word}` };
  }
  function setSeaVerdict(v, extra = '') {
    $('seaVerdict').className = `verdict ${v.level === 'warn' ? 'warn' : v.level}`;
    $('seaVerdict').innerHTML = `<b>${v.icon} ${v.word[0].toUpperCase() + v.word.slice(1)}</b>${v.text}${extra}`;
  }

  // ------------------------------------------------------------ statistics run (worker)
  $('waveStats').onclick = async () => {
    if (K.locked) return;
    if (!sea().active) { $('waveInfo').textContent = 'Calm water: nothing to simulate.'; return; }
    $('waveStats').disabled = true;
    try { await ensureSimBem((t) => { $('waveInfo').innerHTML = t; }); }
    catch (err) { $('waveInfo').innerHTML = `<span class="warn">Panel-method coefficients failed (${err.message}); using the estimates.</span>`; }
    $('waveStats').disabled = false;
    const P = prepare(); if (!P) return;
    const s = sea();
    const sm = simModel(P, s);
    stopRun();
    const reg = s.mode === 'regular';
    const field = fieldFor(), hull = hullFor(P, field), dt = dtFor(P, field), duration = (reg ? 5 : 20) * 60, ramp = Math.min(2 * s.T0, 20);
    if (K.worker) K.worker.terminate();
    K.worker = new Worker(new URL('./seaworker.js', import.meta.url), { type: 'module' });
    $('waveStats').disabled = true;
    const t0 = performance.now();
    K.worker.onmessage = (e) => {
      if (e.data.progress !== undefined) { $('waveInfo').innerHTML = `Simulating ${duration / 60} min of ${s.label}… <b>${Math.round(e.data.progress * 100)}%</b>`; return; }
      $('waveStats').disabled = false;
      const { stats, series } = e.data;
      K.stats = { stats, series, sea: s };
      showTab('tabSea');
      drawHistories(series);
      if (reg) return showRegularStats(P, s, stats, hull, field, t0);
      const S = spectrumFn(s.type, s.Hs, s.Tp, s.gamma);
      const spec = (j) => spectralResponse(sm.model, S, s.heading, j, field.meta.wMin, field.meta.wMax, 300, 20 * 60);
      const sr = spec(3), sp = spec(4), sh = spec(2);
      const greenFrac = stats.steps ? stats.greenSteps / stats.steps : 0;
      const v = verdict({ ssLabel: s.label, maxRoll: stats.maxRoll, vanish: P.vanish, capsized: stats.capsized, greenFrac });
      setSeaVerdict(v, ` <span class="hint">(20 min time-domain run, β = ${s.heading}°)</span>`);
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
      The two columns should agree within ~10 % for moderate motions; larger gaps indicate nonlinearity (large roll, deck immersion).</span>`;
      $('waveInfo').innerHTML = `Statistics complete: ${v.text}.`;
    };
    K.worker.postMessage({
      verts: hull.verts.buffer.slice(0), idx: hull.idx.buffer.slice(0), mass: P.st.m, IGb: P.IGb, rho: P.st.rho, R0: P.Rsk, z0: -P.zw,
      fieldParams: { ...s }, A: sm.A, Bd: sm.Bd, dt, duration, ramp, vanishDeg: P.vanish || 180,
      volQ: hull.volQ ? hull.volQ.slice() : null, diffModes: P.diffModes, drift: driftParams(s),
    });
  };

  const driftRow = (st) => (!st.drift ? '—' : st.drift.on
    ? `${f(st.drift.speed)} m/s toward ${f(st.drift.dir)}°, ${f(st.drift.dist)} m in the run`
    : `off (held on station; max offset ${f(st.drift.maxOffset)} m)`);
  function showRegularStats(P, s, stats, hull, field, t0) {
    const greenFrac = stats.steps ? stats.greenSteps / stats.steps : 0;
    const v = verdict({ ssLabel: s.label, maxRoll: stats.maxRoll, vanish: P.vanish, capsized: stats.capsized, greenFrac });
    setSeaVerdict(v, ` <span class="hint">(5 min regular-wave run, β = ${s.heading}°)</span>`);
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
  $('ssSweep').onclick = () => {
    if (K.locked) return;
    const P = prepare(); if (!P) return;
    const s = sea();
    const sm = simModel(P, s);
    const bemOk = K.rao && K.rao.bem && K.rao.bodyKey === bodyKey(P.st) && !K.rao.stale;
    const bemPts = bemOk ? bemSweep(P.model, K.rao.bem, [s.heading], bemExtraDamping(P.model, bemNatural(P.model, K.rao.bem), extraZeta()))[0].points : null;
    let usedBem = 0, usedEst = 0;
    const rows = SEA_STATES.filter((x) => x.Hs > 0).map((x) => {
      const gamma = $('ssDnvGamma').checked ? dnvGamma(x.Hs, x.Tp) : s.gamma;
      const S = spectrumFn(s.type, x.Hs, x.Tp, gamma);
      const wp = 2 * Math.PI / x.Tp;
      const m0 = x.Hs * x.Hs / 16;
      const viaBem = bemPts && spectralFromSweep(bemPts, S, 2, 3 * 3600, m0).coverage >= 0.9;
      if (viaBem) usedBem++; else usedEst++;
      const r = (j) => (viaBem ? spectralFromSweep(bemPts, S, j, 3 * 3600, m0)
        : spectralResponse(sm.model, S, s.heading, j, 0.4 * wp, Math.max(4 * wp, ...sm.model.wn.map((w) => 1.5 * w)), 300, 3 * 3600));
      const roll = r(3), pitch = r(4), heave = r(2);
      const v = verdict({ ssLabel: `SS${x.ss}`, maxRoll: roll.mpm, vanish: P.vanish, capsized: false, greenFrac: 0 });
      const d = diffractionCheck(P.size, wp);
      return `<tr><td>SS${x.ss}${viaBem ? '' : (bemPts ? ' <span class="hint" title="outside the panel-method frequency range: linear estimate model">†</span>' : '')}</td><td>${x.Hs}</td><td>${x.Tp}${x.tpDerived ? '*' : ''}</td><td>${f(heave.sig)}</td><td>${f(roll.sig)}</td><td>${f(roll.mpm)}</td><td>${f(pitch.sig)}</td>
        <td><span class="badge ${v.level}">${v.icon} ${v.word}</span>${d.ok ? '' : ` <span class="badge warn" title="body is ${f(d.ratio, 2)} of the peak wavelength; diffraction not modelled">! D/λ ${f(d.ratio, 2)}</span>`}</td></tr>`;
    });
    $('ssTable').innerHTML = `<table class="ss-table"><tr><th>SS</th><th>Hs m</th><th>Tp s</th><th>heave sig m</th><th>roll sig °</th><th>roll max 3 h °</th><th>pitch sig °</th><th>verdict</th></tr>${rows.join('')}</table>
      <span class="hint">Linear spectral estimate at β = ${s.heading}° (${s.type === 'pm' ? 'PM' : 'JONSWAP'}) from ${usedBem && !usedEst ? 'the panel-method RAOs (section 8)' : usedBem ? `the panel-method RAOs where the sweep covers the sea (rows marked † use the ${sm.source === 'estimates' ? 'estimate' : 'simulator'} model; widen the RAO frequency range to include them)` : `the ${sm.source === 'estimates' ? 'Froude–Krylov estimate' : 'simulator (panel-method coefficients at the natural frequencies)'} model${bemPts ? '' : '; run Compute RAOs with the panel method for frequency-dependent coefficients'}`}: significant single amplitude 2√m₀ and most-probable max in 3 h, compared with the roll range of stability (${P.vanish >= 180 ? '> 180°' : f(P.vanish) + '°'}). Large predicted rolls are where the linear estimate is least reliable, so confirm those with a time-domain run. * SS1 period from the fully developed Pierson–Moskowitz relation. <b>! D/λ</b> marks sea states whose waves are short relative to the body (D/λ > 0.2), where Froude–Krylov loads are approximate.</span>`;
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
  const progress = (frac, text) => {
    $('raoProgWrap').classList.toggle('hidden', frac === null);
    if (frac === null) return;
    $('raoProgBar').style.width = `${Math.round(frac * 100)}%`;
    $('raoProgText').textContent = text;
    $('raoLoadingText').textContent = text;
  };
  const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  let raoBusy = false;
  const bemOn = () => $('raoMethod').value === 'bem';
  const syncMethod = () => { for (const id of ['bemFid', 'bemIrrWrap', 'bemHint']) $(id).closest(id === 'bemFid' ? 'label' : '*').classList.toggle('hidden', !bemOn()); };
  $('raoMethod').onchange = syncMethod; syncMethod();
  $('raoCancel').onclick = () => { if (K.bemRun) K.bemRun.cancel(); };
  $('raoRun').onclick = async () => {
    if (raoBusy || K.locked) return;
    const [f0, f1] = raoRange();
    const n = Math.max(5, Math.min(400, parseInt($('raoN').value) || 80));
    const heads = parseHeadings($('raoHead').value);
    if (!heads.length) { $('raoInfo').textContent = 'Enter at least one heading.'; return; }
    raoBusy = true; $('raoRun').disabled = true; $('raoCsv').disabled = true; $('raoRaw').disabled = true;
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
      if (!bemOn()) {
        const sweep = await raoSweepAsync(P.model, omegas, heads, (p) => progress(p, `Computing RAOs… ${Math.round(p * 100)} % (${heads.length} headings × ${n} frequencies)`));
        K.rao = { freqs, omegas, heads, sweep, P, resp: new Map(), method: 'fk', bodyKey: bodyKey(P.st) };
        const wn = P.model.wn;
        $('raoInfo').innerHTML = `Froude–Krylov + estimates: ${heads.length} headings × ${n} frequencies in ${f((performance.now() - t0) / 1000)} s · ${P.model.quads.length.toLocaleString()} wetted panels.<br>
          Natural frequencies: heave ${f(wn[2] / TWO_PI)} Hz, roll ${f(wn[3] / TWO_PI)} Hz, pitch ${f(wn[4] / TWO_PI)} Hz.
          Diffraction correction: ${P.diffModes[0] ? 'surge/sway on' : 'surge/sway off'}, ${P.diffModes[2] ? 'heave on' : 'heave off'}.`;
      } else {
        const fid = $('bemFid').value, irr = $('bemIrr').checked, key = bodyKey(P.st);
        const bkey = JSON.stringify([key, f0, f1, n, fid, irr, heads]);
        let bem = K.rao && K.rao.bemKey === bkey ? K.rao.bem : null;
        if (!bem) {
          $('raoCancel').classList.remove('hidden');
          K.bemRun = runBem({ rel: P.rel, zw: P.zw, rho: P.st.rho, omegas, headings: heads, fidelity: fid, irr, onProgress: (q) => progress(q.frac, q.text) });
          try { bem = await K.bemRun.promise; } finally { K.bemRun = null; $('raoCancel').classList.add('hidden'); }
        }
        const nat = bemNatural(P.model, bem), Bextra = bemExtraDamping(P.model, nat, extraZeta());
        const sweep = bemSweep(P.model, bem, heads, Bextra);
        K.rao = { freqs, omegas, heads, sweep, P, resp: new Map(), method: 'bem', bem, bemKey: bkey, bodyKey: key, nat, Bextra };
        if ($('hBemSim').checked && coversNatural(P, bem) && !(K.simBem && K.simBem.key === key && K.simBem.bem === bem)) K.simBem = { key, bem, source: 'the panel-method RAO sweep' };
        const I = bem.info, z = extraZeta();
        const natTxt = [['heave', 2], ['roll', 3], ['pitch', 4]].map(([nm, j]) => nat[j].w > 0
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
        $('raoInfo').innerHTML = `Panel method: ${heads.length} headings × ${n} frequencies in ${f((performance.now() - t0) / 1000)} s · ${I.panels.toLocaleString()} panels${I.lidPanels ? ` + ${I.lidPanels.toLocaleString()} lid` : ''} (${I.sym.x && I.sym.y ? 'two symmetry planes' : I.sym.x || I.sym.y ? 'one symmetry plane' : 'no symmetry'}, panel size ${f(I.h)} m, mean quality ${f(I.quality.qMean, 2)}) on ${I.workers} worker${I.workers > 1 ? 's' : ''}.<br>
          Natural frequencies (with frequency-dependent added mass): ${natTxt}.
          ${I.note ? `<br><span class="hint">${I.note}</span>` : ''}
          ${irr && !I.lidPanels ? '<br><span class="warn">⚠ The irregular-frequency lid could not be built for this waterplane, so the results may show spurious spikes at the hull\'s irregular frequencies.</span>' : ''}
          ${negB.length ? `<br><span class="warn">⚠ Radiation damping came out negative (${negB.map(([nm]) => nm).join(', ')}) from ${f(wNeg / TWO_PI)} Hz up. That is not physical: the panels are too coarse for those wavelengths, so use a finer fidelity or a lower top frequency.</span>` : ''}
          ${low.length ? `<br><span class="warn">⚠ ${low.join(', ')} resonance has under 2 % of critical damping. That is what potential flow gives, but viscous effects make real peaks lower: add extra ζ in section 7 → Wave &amp; hydrodynamic settings if you know it.</span>` : ''}`;
      }
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
      raoBusy = false; $('raoRun').disabled = false; progress(null);
    }
  };
  $('raoDof').onchange = () => drawRaoAsync(); $('raoNorm').onchange = () => drawRaoAsync();

  // RAO tab: show a loading overlay, let it paint, then draw (charts) and fill the sea-state response table.
  async function drawRaoAsync() {
    if (!K.rao) { $('raoEmpty').classList.remove('hidden'); $('raoLoading').classList.add('hidden'); return; }
    $('raoEmpty').classList.add('hidden');
    $('raoLoadingText').textContent = 'Rendering RAO plots…';
    $('raoLoading').classList.remove('hidden');
    await nextPaint();
    try { drawRao(); await drawResponse(); } finally { $('raoLoading').classList.add('hidden'); }
  }
  function drawRao() {
    if (!K.rao || $('tabRao').classList.contains('hidden')) return;
    const { freqs, heads, sweep, P } = K.rao;
    const j = +$('raoDof').value, rot = j >= 3, slope = $('raoNorm').value === 'slope';
    const val = (p) => (rot ? (slope ? p.perSlope[j] : p.degPerM[j]) : p.amp[j]);
    const unit = rot ? (slope ? 'deg/deg' : 'deg/m') : 'm/m';
    const color = (i) => (heads.length === 1 ? SERIES[0] : rampColor(i / (heads.length - 1)));
    const series = sweep.map((h, i) => ({ name: `β ${h.beta}°`, color: color(i), x: freqs, y: h.points.map(val) }));
    const wnj = K.rao.nat ? K.rao.nat[j].w : P.model.wn[j];
    const vl = wnj > 0 ? [{ x: wnj / TWO_PI, label: `${DOF[j]} fn` }] : [];
    const rampLegend = heads.length > 5 ? { label: 'heading', from: `β ${heads[0]}°`, to: `β ${heads[heads.length - 1]}°`, color: (t) => rampColor(t) } : null;
    lineChart($('raoCv'), { series, xLabel: 'f (Hz)', yLabel: `${DOF[j]} RAO (${unit})`, vlines: vl, height: 180, rampLegend });
    // phase is meaningless where the response vanishes (e.g. roll in head seas), so mask it there
    const ampMax = Math.max(1e-30, ...sweep.flatMap((h) => h.points.map((p) => p.amp[j])));
    lineChart($('raoPh'), { series: sweep.map((h, i) => ({ name: `β ${h.beta}°`, color: color(i), x: freqs, y: h.points.map((p) => (p.amp[j] > 1e-4 * ampMax ? p.phase[j] : NaN)) })),
      xLabel: 'f (Hz)', yLabel: 'phase (deg)', yMin: -180, yMax: 180, height: 130, legend: false });
    heatmap($('raoHeat'), { rows: heads, cols: freqs, values: sweep.map((h) => h.points.map(val)), rowLabel: 'β (deg)', colLabel: 'f (Hz)', valueLabel: `${DOF[j]} (${unit})`, height: 150 });
  }
  // Response in the current sea state, from the computed sweep (cached). Falls back to re-solving on a
  // dedicated grid only when the sweep misses a large part of the wave energy.
  async function drawResponse() {
    const { heads, sweep, P, resp } = K.rao;
    const j = +$('raoDof').value, rot = j >= 3, s = sea();
    if (!s.active) { $('raoResp').innerHTML = ''; return; }
    if (s.mode === 'regular') {
      const amp = (b) => {
        if (!K.rao.bem) return regularLinear(P, { ...s, heading: b }, j);
        const r = raoAtBem(P.model, K.rao.bem, TWO_PI / s.T, b, K.rao.Bextra);
        return r ? Math.hypot(...r.xi[j]) * s.A * (rot ? 180 / Math.PI : 1) : NaN;
      };
      const rows = heads.map((b) => `<tr><td>β ${b}°</td><td>${Number.isFinite(amp(b)) ? `${f(amp(b))} ${rot ? '°' : 'm'}` : 'period outside the sweep'}</td></tr>`);
      $('raoResp').innerHTML = `<b>${DOF[j]} in a regular wave (${s.label}):</b><table><tr><td></td><td>steady amplitude, |RAO| × A</td></tr>${rows.join('')}</table>`;
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
          r = { ...spectralResponse(P.model, S, heads[i], j, 0.4 * wp, Math.max(4 * wp, P.model.wn[j] * 1.5 || 0), 200, 3 * 3600), coverage: 1 };
        }
        resp.set(key, r);
      }
      rows.push(`<tr><td>β ${heads[i]}°</td><td>${f(r.sig)} ${rot ? '°' : 'm'}</td><td>${f(r.mpm)} ${rot ? '°' : 'm'}</td></tr>`);
    }
    $('raoResp').innerHTML = `<b>${DOF[j]} in SS${ssSel.value} (Hs ${s.Hs} m, Tp ${s.Tp} s):</b><table><tr><td></td><td>significant (2σ)</td><td>most-probable max, 3 h</td></tr>${rows.join('')}</table>
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
    for (const h of K.rao.sweep) for (const p of h.points) lines.push([h.beta, p.f, p.w, p.T, p.lambda, ...p.degPerM, ...p.perSlope.slice(3), ...p.phase].map(num6).join(','));
    download('rao.csv', lines.join('\n'));
  };
  // Raw export: complex RAOs and excitation per DOF, plus the linear model's matrices as comment lines.
  $('raoRaw').onclick = () => {
    if (!K.rao) return;
    const { P } = K.rao, M = P.model, st = P.st;
    const mat = (name, A) => A.map((row, i) => `# ${name}[${i + 1},:] = ${row.map(num6).join(' ')}`);
    const hdr = [
      '# Float Sim raw RAO export',
      `# model: ${st.model.name}; mass ${num6(st.m)} kg; water density ${st.rho} kg/m^3; g 9.80665 m/s^2; deep water; zero forward speed`,
      '# axes: about the CoG G, world axes with the model +X along world X (yaw removed); z up; roll about x, pitch about y',
      '# wave: eta = A cos(k(x cos beta + y sin beta) - omega t), phase measured at G; complex amplitudes use exp(+i omega t), per unit wave amplitude A',
      '# units: translations m/m, rotations rad/m; excitation forces N/m, moments N*m/m',
      ...(K.rao.bem ? [
        `# hydrodynamics: panel method (deep water), ${K.rao.bem.info.panels} panels + ${K.rao.bem.info.lidPanels} lid, panel size ${num6(K.rao.bem.info.h)} m; excitation from the Haskind relation`,
        `# natural frequencies (rad/s, uncoupled, with A(omega)): ${K.rao.nat.map((n) => num6(n.w)).join(' ')}`,
        `# extra viscous damping (diagonal; N*s/m, N*m*s/rad): ${K.rao.Bextra.map(num6).join(' ')}`,
        '# columns A_ij, B_ij: frequency-dependent added mass and radiation damping about G (diagonal and the surge-pitch, sway-roll couplings)',
      ] : [
        `# hydrodynamics: Froude-Krylov with estimated added mass and damping; diffraction correction (surge, sway, heave): ${M.diffraction.join(', ')}`,
        `# natural frequencies (rad/s, uncoupled): ${M.wn.map(num6).join(' ')}`,
        `# added mass A (diagonal; kg, kg*m^2): ${M.Am.map(num6).join(' ')}`,
        `# linear damping B (diagonal; N*s/m, N*m*s/rad): ${M.Bd.map(num6).join(' ')}`,
      ]),
      ...mat('mass matrix M', M.Mm), ...mat('restoring matrix C', M.Cm),
    ];
    const cols = ['beta_deg', 'f_Hz', 'omega_rad_s', 'k_rad_per_m', 'wavelength_m'];
    for (const d of DOF) cols.push(`${d}_xi_re`, `${d}_xi_im`, `${d}_xi_abs`, `${d}_xi_phase_deg`, `${d}_F_re`, `${d}_F_im`);
    const AB = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [0, 4], [1, 3]];
    if (K.rao.bem) for (const [i, j] of AB) cols.push(`A${i + 1}${j + 1}`); if (K.rao.bem) for (const [i, j] of AB) cols.push(`B${i + 1}${j + 1}`);
    const lines = [...hdr, cols.join(',')];
    for (const h of K.rao.sweep) for (const p of h.points) {
      const row = [h.beta, p.f, p.w, p.k, p.lambda];
      for (let j = 0; j < 6; j++) row.push(p.xi[j][0], p.xi[j][1], p.amp[j], p.phase[j], p.F[j][0], p.F[j][1]);
      if (K.rao.bem) { for (const [i, j] of AB) row.push(p.A[i][j]); for (const [i, j] of AB) row.push(p.B[i][j]); }
      lines.push(row.map(num6).join(','));
    }
    download('rao_raw.csv', lines.join('\n'));
  };

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
  }

  applySS();
  return {
    frame,
    onModelChange() {
      stopRun(); K.prep = null; K.stats = null; onInputs();
      if (K.rao && !K.rao.stale && !raoBusy) {
        K.rao.stale = true;
        $('raoInfo').insertAdjacentHTML('afterbegin', '<span class="warn">⚠ Inputs changed since these RAOs were computed. Click Compute RAOs to update them.</span><br>');
      }
    },
    showTab,
    // drop/rise test placement locks the wave and RAO tools (they assume the body floats at rest)
    setLocked(on) {
      K.locked = on;
      if (on) stopRun();
      for (const id of ['waveRun', 'waveStats', 'ssSweep', 'raoRun']) { $(id).disabled = on; $(id).title = on ? 'Reset the drop-test position (section 9) first' : ''; }
      for (const n of document.querySelectorAll('.lock-note')) n.classList.toggle('hidden', !on);
    },
    clearRao() { K.rao = null; $('raoCsv').disabled = true; $('raoRaw').disabled = true; },
    // panel-method coefficients for the drop test: { A[6], Bd[6], source } at the natural frequencies, or null
    ensureSimBem,
    simCoeffs() { const P = prepare(); if (!P) return null; const sm = simModel(P, null); return sm.source === 'estimates' ? null : sm; },
    get running() { return K.running; },
  };
}
