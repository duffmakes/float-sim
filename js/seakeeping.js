// Sea-state simulation, spectral stability estimates and RAO sweeps (UI glue).
import { mat3, transformTris, solveWaterline, hydrostatics, inertiaAbout, gzCurve, gzSummary, quatToMat3 } from './physics.js';
import { SEA_STATES, spectrumFn, pmSpectrum, jonswapSpectrum, dnvGamma, WaveField, G } from './waves.js';
import {
  refineTris, indexMesh, waveForces, linearModel, defaultHydroCoeffs, raoSweep, spectralResponse,
  diffractionCheck, waterplaneExtent, DOF,
} from './hydro.js';
import { WaveSim, seriesStats } from './sim.js';
import { lineChart, heatmap, SERIES, rampColor } from './charts.js';

const $ = (id) => document.getElementById(id);
const f = (x, d = 3) => (Number.isFinite(x) ? (+x.toPrecision(d)).toLocaleString() : '—');

export function initSeakeeping(api) {
  const { THREE } = api;
  const K = { prep: null, sim: null, running: false, worker: null, stats: null, rao: null, lastChart: 0, specType: 'jonswap' };

  // ------------------------------------------------------------ wave surface mesh
  const waveMat = api.water.material.clone();
  waveMat.opacity = 0.7;
  const N_SEG = 96;
  const waveMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, N_SEG, N_SEG), waveMat);
  waveMesh.visible = false; waveMesh.renderOrder = 2;
  api.scene.add(waveMesh);
  let waveSize = 0;
  function sizeWaveMesh(size) {
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
  $('specType').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of $('specType').children) x.classList.toggle('on', x === b);
    K.specType = b.dataset.type; onInputs();
  });
  $('ssHead').oninput = () => { $('ssHeadN').value = $('ssHead').value; onInputs(); };
  $('ssHeadN').onchange = () => { $('ssHead').value = $('ssHeadN').value; onInputs(); };
  for (const id of ['hA33', 'hA44', 'hA55', 'hZ3', 'hZ4', 'hZ5']) $(id).addEventListener('change', () => { K.prep = null; onInputs(); });
  $('hReset').onclick = () => { K.coeffOverride = false; $('hA33').value = ''; $('hA55').value = ''; $('hA44').value = 0.2; $('hZ3').value = 0.15; $('hZ4').value = 0.08; $('hZ5').value = 0.15; K.prep = null; onInputs(); };
  $('waveSpeed').oninput = (e) => { $('waveSpeedV').textContent = `${e.target.value}×`; };

  const sea = () => {
    const Hs = Math.max(0, parseFloat($('ssHs').value) || 0), Tp = Math.max(0, parseFloat($('ssTp').value) || 0);
    let gamma = Math.min(7, Math.max(1, parseFloat($('ssGamma').value) || 3.3));
    if ($('ssDnvGamma').checked && Hs > 0) { gamma = dnvGamma(Hs, Tp); $('ssGamma').value = +gamma.toFixed(2); }
    return { type: K.specType, Hs, Tp, gamma, heading: parseFloat($('ssHeadN').value) || 0,
      N: Math.max(5, Math.min(300, parseInt($('ssN').value) || 50)), seed: parseInt($('ssSeed').value) || 1, spread: Math.max(0, parseFloat($('ssSpread').value) || 0) };
  };

  // ------------------------------------------------------------ body preparation (seakeeping frame)
  // The model is yawed so its +X axis lies along world X; β is then relative to the model's +X.
  function prepare() {
    const st = api.getState();
    if (!st || st.H.status === 'sinks') return null;
    const key = JSON.stringify([st.model.name, st.model.tris.length, st.m, st.G, st.rho, api.getEuler(), ['hA33', 'hA44', 'hA55', 'hZ3', 'hZ4', 'hZ5'].map((i) => $(i).value)]);
    if (K.prep && K.prep.key === key) return K.prep;
    const R = st.R, yaw = Math.atan2(R[3], R[0]);
    const Rsk = mat3.mul(mat3.rotZ(-yaw), R);
    const rel = transformTris(st.model.tris, Rsk, st.G);
    const sol = solveWaterline(rel, st.m / st.rho);
    const H = hydrostatics(rel, sol.zw, st.m, st.rho);
    const IGb = inertiaAbout(st.model.mp, st.m, st.G);
    const IGw = mat3.mul(Rsk, mat3.mul(IGb, mat3.transpose(Rsk)));
    const coeffs = defaultHydroCoeffs(H, st.m, IGw, st.rho);
    // user overrides
    const num = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
    if (num('hA33') !== null) coeffs.A[2] = num('hA33'); else $('hA33').placeholder = coeffs.A[2].toPrecision(4);
    if (num('hA55') !== null) coeffs.A[4] = num('hA55'); else $('hA55').placeholder = coeffs.A[4].toPrecision(4);
    coeffs.A[3] = (num('hA44') ?? 0.2) * IGw[0];
    coeffs.zeta[2] = num('hZ3') ?? 0.15; coeffs.zeta[3] = num('hZ4') ?? 0.08; coeffs.zeta[4] = num('hZ5') ?? 0.15;
    const size = Math.max(...waterplaneExtent(H.segs), 1e-6);
    // frequency-domain mesh: resolve the shortest RAO wavelength by ~10 panels
    const wMaxRao = Math.max(parseFloat($('raoWmax').value) || 4, 1);
    const lamMin = 2 * Math.PI * G / (wMaxRao * wMaxRao);
    const relFine = refineTris(rel, Math.max(Math.min(lamMin / 10, size / 15), st.model.diag / 200), 40000);
    const model = linearModel(relFine, hydrostatics(relFine, sol.zw, st.m, st.rho), st.m, IGw, st.rho, coeffs);
    const gz = gzSummary(gzCurve(rel, H.V, 'x'));
    const offset = Math.hypot(...H.offset);
    K.prep = { key, Rsk, rel, H, IGb, IGw, coeffs, model, zw: sol.zw, size, gz, vanish: gz.unstable ? 0 : (gz.vanish ?? 180), offset, st, hulls: {} };
    return K.prep;
  }
  // time-domain hull: panels ~ λ_min/9 of the current sea, capped for speed
  function hullFor(P, field) {
    const lam = Math.min(field.minWavelength, P.size * 4);
    const h = Math.max(lam / 9, P.st.model.diag / 60);
    const key = h.toPrecision(3);
    if (!P.hulls[key]) P.hulls[key] = indexMesh(refineTris(transformTris(P.st.model.tris, mat3.identity(), P.st.G), h, 6000), P.st.model.diag * 1e-7);
    return P.hulls[key];
  }
  const dtFor = (P, field) => Math.min(2 * Math.PI / Math.max(field.maxOmega || 1, ...P.model.wn) / 60, 0.05);
  const fieldFor = (P) => { const s = sea(); return WaveField.fromSpectrum({ ...s }); };

  // ------------------------------------------------------------ spectrum chart + warnings
  function drawSpectrum() {
    const P = prepare(); const s = sea();
    if (!(s.Hs > 0 && s.Tp > 0)) { lineChart($('specCv'), { series: [] }); $('specInfo').innerHTML = 'Calm water: no spectrum.'; return; }
    const wp = 2 * Math.PI / s.Tp;
    const wn = P ? P.model.wn : [];
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
  function startRun() {
    const P = prepare(); if (!P) return;
    api.stopCalmSim();
    const field = fieldFor(P);
    const hull = hullFor(P, field);
    const s = sea();
    K.sim = new WaveSim({
      hull, mass: P.st.m, inertiaG: P.IGb, rho: P.st.rho, R0: P.Rsk, z0: -P.zw, field,
      A: P.coeffs.A, Bd: P.model.Bd, dt: dtFor(P, field), ramp: s.Tp > 0 ? Math.min(2 * s.Tp, 20) : 0, vanishDeg: P.vanish || 180,
    });
    K.field = field; K.hull = hull; K.running = true;
    sizeWaveMesh(P.st.model.diag * 8);
    waveMesh.visible = true; api.water.visible = false; api.waterDepth.visible = false;
    api.setStaticOverlays(false); wl3.visible = true;
    $('waveRun').textContent = '❚❚ Stop';
    showTab('tabSea');
  }
  function stopRun() {
    if (!K.running) return;
    K.running = false;
    $('waveRun').textContent = '▶ Run in waves';
    waveMesh.visible = false; wl3.visible = false;
    api.water.visible = api.waterDepth.visible = $('showWater').checked;
    api.setStaticOverlays(true);
    api.refresh();
    api.recenter();
  }
  $('waveRun').onclick = () => (K.running ? stopRun() : startRun());

  function frame(dtReal) {
    if (!K.running || !K.sim) return;
    const sim = K.sim, field = K.field;
    const cost = (K.hull.verts.length / 3) * Math.max(1, field.n);
    const budget = Math.max(1, Math.floor(3e6 / cost));
    const span = dtReal * parseFloat($('waveSpeed').value);
    sim.advance(span, Math.min(budget, Math.ceil(span / sim.dt)));
    const R = quatToMat3(sim.q);
    api.setBodyPose(R, sim.p);
    api.follow(sim.p[0], sim.p[1]);
    updateWaveMesh(field, sim.t, sim.p[0], sim.p[1]);
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
        drift ${f(Math.hypot(sim.p[0], sim.p[1]))} m (free-floating, no mooring or viscous drag, so the drift speed is indicative only; the camera follows)
        ${sim.stats.capsized ? `<br><span class="bad">✕ Capsized at t = ${f(sim.stats.capsizeT)} s</span>` : ''}
        <br><span class="hint">${(K.hull.idx.length / 3).toLocaleString()} panels · ${field.n} wave components · dt ${f(sim.dt * 1000)} ms</span>`;
    }
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
  $('waveStats').onclick = () => {
    const P = prepare(); if (!P) return;
    const s = sea();
    if (!(s.Hs > 0)) { $('waveInfo').textContent = 'Calm water: nothing to simulate.'; return; }
    stopRun();
    const field = fieldFor(P), hull = hullFor(P, field), dt = dtFor(P, field), duration = 20 * 60, ramp = Math.min(2 * s.Tp, 20);
    if (K.worker) K.worker.terminate();
    K.worker = new Worker(new URL('./seaworker.js', import.meta.url), { type: 'module' });
    $('waveStats').disabled = true;
    const t0 = performance.now();
    K.worker.onmessage = (e) => {
      if (e.data.progress !== undefined) { $('waveInfo').innerHTML = `Simulating 20 min of SS${ssSel.value}… <b>${Math.round(e.data.progress * 100)}%</b>`; return; }
      $('waveStats').disabled = false;
      const { stats, series } = e.data;
      K.stats = { stats, series, sea: s };
      showTab('tabSea');
      drawHistories(series);
      const S = spectrumFn(s.type, s.Hs, s.Tp, s.gamma);
      const spec = (j) => spectralResponse(P.model, S, s.heading, j, field.meta.wMin, field.meta.wMax, 300, 20 * 60);
      const sr = spec(3), sp = spec(4), sh = spec(2);
      const greenFrac = stats.steps ? stats.greenSteps / stats.steps : 0;
      const v = verdict({ ssLabel: `SS${ssSel.value}`, maxRoll: stats.maxRoll, vanish: P.vanish, capsized: stats.capsized, greenFrac });
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
        <tr><td>Green water on deck</td><td colspan="2">${stats.greenWater} events, ${f(100 * greenFrac, 2)} % of the time</td></tr>
        <tr><td>Capsize</td><td colspan="2">${stats.capsized ? `<span class="bad">✕ yes, at t = ${f(stats.capsizeT)} s</span>` : '<span class="good">✓ no</span>'}</td></tr>
      </table><span class="hint">Simulated ${f(stats.simulated, 4)} s in ${f((performance.now() - t0) / 1000)} s · ${(hull.idx.length / 3).toLocaleString()} panels · ${field.n} components · dt ${f(stats.dt * 1000)} ms.
      The two columns should agree within ~10 % for moderate motions; larger gaps indicate nonlinearity (large roll, deck immersion).</span>`;
      $('waveInfo').innerHTML = `Statistics complete: ${v.text}.`;
    };
    K.worker.postMessage({
      verts: hull.verts.buffer.slice(0), idx: hull.idx.buffer.slice(0), mass: P.st.m, IGb: P.IGb, rho: P.st.rho, R0: P.Rsk, z0: -P.zw,
      fieldParams: { ...s }, A: P.coeffs.A, Bd: P.model.Bd, dt, duration, ramp, vanishDeg: P.vanish || 180,
    });
  };

  // ------------------------------------------------------------ sea-state sweep (spectral)
  $('ssSweep').onclick = () => {
    const P = prepare(); if (!P) return;
    const s = sea();
    const rows = SEA_STATES.filter((x) => x.Hs > 0).map((x) => {
      const gamma = $('ssDnvGamma').checked ? dnvGamma(x.Hs, x.Tp) : s.gamma;
      const S = spectrumFn(s.type, x.Hs, x.Tp, gamma);
      const wp = 2 * Math.PI / x.Tp;
      const r = (j) => spectralResponse(P.model, S, s.heading, j, 0.4 * wp, Math.max(4 * wp, ...P.model.wn.map((w) => 1.5 * w)), 300, 3 * 3600);
      const roll = r(3), pitch = r(4), heave = r(2);
      const v = verdict({ ssLabel: `SS${x.ss}`, maxRoll: roll.mpm, vanish: P.vanish, capsized: false, greenFrac: 0 });
      const d = diffractionCheck(P.size, wp);
      return `<tr><td>SS${x.ss}</td><td>${x.Hs}</td><td>${x.Tp}${x.tpDerived ? '*' : ''}</td><td>${f(heave.sig)}</td><td>${f(roll.sig)}</td><td>${f(roll.mpm)}</td><td>${f(pitch.sig)}</td>
        <td><span class="badge ${v.level}">${v.icon} ${v.word}</span>${d.ok ? '' : ` <span class="badge warn" title="body is ${f(d.ratio, 2)} of the peak wavelength; diffraction not modelled">! D/λ ${f(d.ratio, 2)}</span>`}</td></tr>`;
    });
    $('ssTable').innerHTML = `<table class="ss-table"><tr><th>SS</th><th>Hs m</th><th>Tp s</th><th>heave sig m</th><th>roll sig °</th><th>roll max 3 h °</th><th>pitch sig °</th><th>verdict</th></tr>${rows.join('')}</table>
      <span class="hint">Linear spectral estimate at β = ${s.heading}° (${s.type === 'pm' ? 'PM' : 'JONSWAP'}): significant single amplitude 2√m₀ and most-probable max in 3 h, compared with the roll range of stability (${P.vanish >= 180 ? '> 180°' : f(P.vanish) + '°'}). Large predicted rolls are where the linear estimate is least reliable, so confirm those with a time-domain run. * SS1 period from the fully developed Pierson–Moskowitz relation. <b>! D/λ</b> marks sea states whose waves are short relative to the body (D/λ > 0.2), where Froude–Krylov loads are approximate.</span>`;
  };

  // ------------------------------------------------------------ RAO sweep
  function parseHeadings(txt) {
    txt = txt.trim();
    const m = txt.match(/^(-?[\d.]+)\s*:\s*([\d.]+)\s*:\s*(-?[\d.]+)$/);
    if (m) { const [a, st, b] = m.slice(1).map(Number); const out = []; for (let v = a; v <= b + 1e-9 && out.length < 73; v += st || 1) out.push(+v.toFixed(6)); return out; }
    return txt.split(/[,\s]+/).map(Number).filter(Number.isFinite).slice(0, 73);
  }
  $('raoRun').onclick = () => {
    K.prep = null;  // RAO ω-range sets the mesh resolution
    const P = prepare(); if (!P) return;
    const w0 = Math.max(0.01, parseFloat($('raoWmin').value) || 0.2), w1 = Math.max(w0 * 1.01, parseFloat($('raoWmax').value) || 4);
    const n = Math.max(5, Math.min(400, parseInt($('raoN').value) || 80));
    const omegas = Array.from({ length: n }, (_, i) => w0 + (w1 - w0) * i / (n - 1));
    const heads = parseHeadings($('raoHead').value);
    if (!heads.length) { $('raoInfo').textContent = 'Enter at least one heading.'; return; }
    const t0 = performance.now();
    K.rao = { omegas, heads, sweep: raoSweep(P.model, omegas, heads), P };
    $('raoCsv').disabled = false;
    $('raoInfo').innerHTML = `${heads.length} headings × ${n} frequencies in ${f((performance.now() - t0) / 1000)} s · ${P.model.quads.length.toLocaleString()} wetted panels.
      Natural frequencies: heave ${f(P.model.wn[2])}, roll ${f(P.model.wn[3])}, pitch ${f(P.model.wn[4])} rad/s.`;
    showTab('tabRao');
  };
  $('raoDof').onchange = drawRao; $('raoNorm').onchange = drawRao;
  function drawRao() {
    if (!K.rao || $('tabRao').classList.contains('hidden')) return;
    const { omegas, heads, sweep, P } = K.rao;
    const j = +$('raoDof').value, rot = j >= 3, slope = $('raoNorm').value === 'slope';
    const val = (p) => (rot ? (slope ? p.perSlope[j] : p.degPerM[j]) : p.amp[j]);
    const unit = rot ? (slope ? 'deg/deg' : 'deg/m') : 'm/m';
    const color = (i) => (heads.length === 1 ? SERIES[0] : rampColor(i / (heads.length - 1)));
    const series = sweep.map((h, i) => ({ name: `β ${h.beta}°`, color: color(i), x: omegas, y: h.points.map(val) }));
    const vl = P.model.wn[j] > 0 ? [{ x: P.model.wn[j], label: `${DOF[j]} ωn` }] : [];
    lineChart($('raoCv'), { series, xLabel: 'ω (rad/s)', yLabel: `${DOF[j]} RAO (${unit})`, vlines: vl, height: 180 });
    // phase is meaningless where the response vanishes (e.g. roll in head seas), so mask it there
    const ampMax = Math.max(1e-30, ...sweep.flatMap((h) => h.points.map((p) => p.amp[j])));
    lineChart($('raoPh'), { series: sweep.map((h, i) => ({ name: `β ${h.beta}°`, color: color(i), x: omegas, y: h.points.map((p) => (p.amp[j] > 1e-4 * ampMax ? p.phase[j] : NaN)) })),
      xLabel: 'ω (rad/s)', yLabel: 'phase (deg)', yMin: -180, yMax: 180, height: 130, legend: false });
    heatmap($('raoHeat'), { rows: heads, cols: omegas, values: sweep.map((h) => h.points.map(val)), rowLabel: 'β (deg)', colLabel: 'ω (rad/s)', valueLabel: `${DOF[j]} (${unit})`, height: 150 });
    // response in the current sea state
    const s = sea();
    if (s.Hs > 0) {
      const S = spectrumFn(s.type, s.Hs, s.Tp, s.gamma), wp = 2 * Math.PI / s.Tp;
      const rows = heads.map((b) => { const r = spectralResponse(P.model, S, b, j, 0.4 * wp, Math.max(4 * wp, P.model.wn[j] * 1.5 || 0), 300, 3 * 3600); return `<tr><td>β ${b}°</td><td>${f(r.sig)} ${rot ? '°' : 'm'}</td><td>${f(r.mpm)} ${rot ? '°' : 'm'}</td></tr>`; });
      $('raoResp').innerHTML = `<b>${DOF[j]} in SS${ssSel.value} (Hs ${s.Hs} m, Tp ${s.Tp} s):</b><table><tr><td></td><td>significant (2σ)</td><td>most-probable max, 3 h</td></tr>${rows.join('')}</table>`;
    } else $('raoResp').innerHTML = '';
  }
  $('raoCsv').onclick = () => {
    if (!K.rao) return;
    const head = ['beta_deg', 'omega_rad_s', 'period_s', 'wavelength_m', ...DOF.map((d, j) => (j < 3 ? `${d}_m_per_m` : `${d}_deg_per_m`)), ...DOF.slice(3).map((d) => `${d}_deg_per_deg_slope`), ...DOF.map((d) => `${d}_phase_deg`)];
    const lines = [head.join(',')];
    for (const h of K.rao.sweep) for (const p of h.points) lines.push([h.beta, p.w, p.T, p.lambda, ...p.degPerM, ...p.perSlope.slice(3), ...p.phase].map((v) => +(+v).toPrecision(6)).join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'rao.csv'; a.click(); URL.revokeObjectURL(a.href);
  };

  // ------------------------------------------------------------ tabs
  function showTab(id) {
    for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === id);
    for (const t of ['tabHydro', 'tabSea', 'tabRao']) $(t).classList.toggle('hidden', t !== id);
    if (id === 'tabSea') { drawSpectrum(); if (K.stats && !K.running) drawHistories(K.stats.series); }
    if (id === 'tabRao') drawRao();
  }
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

  function onInputs() {
    if (!$('tabSea').classList.contains('hidden')) drawSpectrum();
    if (!$('tabRao').classList.contains('hidden')) drawRao();
  }

  applySS();
  return {
    frame,
    onModelChange() { stopRun(); K.prep = null; K.stats = null; onInputs(); },
    get running() { return K.running; },
  };
}
