// Sea-state / spectrum / Froude–Krylov / RAO validation, run by validate-core.js.
import { mat3, transformTris, solveWaterline, hydrostatics, inertiaAbout, massProperties, submerged } from '../js/physics.js';
import { pmSpectrum, jonswapSpectrum, spectrumFn, spectralMoments, WaveField, SEA_STATES, pmFullyDevelopedTp } from '../js/waves.js';
import { refineTris, indexMesh, waveForces, linearModel, defaultHydroCoeffs, raoAt, spectralResponse } from '../js/hydro.js';
import { WaveSim, seriesStats } from '../js/sim.js';
import { hemisphereStudy, sparStudy } from './trade-study.js';
import { bodyFrameVolQ } from '../js/hydro.js';

// Build the floating barge exactly as the app does (rel geometry about G, hydrostatics, linear model).
export function setupBody(tris, c, { maxEdge = 0.25, maxEdgeTD = 0.6, zeta = null } = {}) {
  const R = mat3.fromEulerDeg(...c.euler);
  const rel = transformTris(tris, R, c.cog);
  const sol = solveWaterline(rel, c.mass / c.rho);
  const H = hydrostatics(rel, sol.zw, c.mass, c.rho);
  const mp = massProperties(tris);
  const IGb = inertiaAbout(mp, c.mass, c.cog);
  const IGw = mat3.mul(R, mat3.mul(IGb, mat3.transpose(R)));
  const coeffs = defaultHydroCoeffs(H, c.mass, IGw, c.rho);
  if (zeta) coeffs.zeta = zeta;
  const relFine = refineTris(rel, maxEdge);
  const model = linearModel(relFine, hydrostatics(relFine, sol.zw, c.mass, c.rho), c.mass, IGw, c.rho, coeffs);
  // body-frame welded hull for the time-domain sim (relative to G, unrotated)
  const bodyFine = refineTris(transformTris(tris, mat3.identity(), c.cog), maxEdgeTD);
  const hull = indexMesh(bodyFine, 1e-7);
  return { R, rel, relFine, H, IGb, IGw, coeffs, model, hull, zw: sol.zw };
}

// Least-squares fit of x(t) ≈ a cos ωt + b sin ωt + c over t ≥ t0; returns amplitude √(a²+b²).
export function fitAmplitude(t, x, w, t0) {
  // removes a linear trend first (a free body with no restoring, e.g. sway, may drift slowly)
  { let n = 0, st = 0, sx = 0, stt = 0, stx = 0; for (let i = 0; i < t.length; i++) if (t[i] >= t0) { n++; st += t[i]; sx += x[i]; stt += t[i] * t[i]; stx += t[i] * x[i]; }
    const b = (n * stx - st * sx) / (n * stt - st * st || 1), a0 = (sx - b * st) / n; x = x.map((v, i) => v - a0 - b * t[i]); }
  let Scc = 0, Sss = 0, Scs = 0, Sc = 0, Ss = 0, S1 = 0, Sxc = 0, Sxs = 0, Sx = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] < t0) continue;
    const c = Math.cos(w * t[i]), s = Math.sin(w * t[i]);
    Scc += c * c; Sss += s * s; Scs += c * s; Sc += c; Ss += s; S1 += 1; Sxc += x[i] * c; Sxs += x[i] * s; Sx += x[i];
  }
  // solve 3×3 normal equations
  const M = [[Scc, Scs, Sc], [Scs, Sss, Ss], [Sc, Ss, S1]], r = [Sxc, Sxs, Sx];
  const inv = mat3.inverse(M.flat());
  const sol = mat3.apply(inv, r);
  return Math.hypot(sol[0], sol[1]);
}

export async function runWaveValidation({ exp, getTris, chkFactory }) {
  const out = [];
  const W = exp.wave;
  const box = exp.cases.find((c) => c.id === 'box_fresh');

  // 1 — spectra
  {
    const { rows, chk } = chkFactory();
    for (const s of W.spectra) {
      const S = spectrumFn(s.type, s.Hs, s.Tp, s.gamma);
      const wp = 2 * Math.PI / s.Tp;
      const mom = spectralMoments(S, 0.05 * wp, 40 * wp, 200000);
      chk(`${s.id} m0 = Hs²/16`, mom.m0, s.m0, s.tol);
      chk(`${s.id} T1`, mom.T1, s.T1, s.id === 'pm' ? 2e-3 : 0.015);
      chk(`${s.id} Tz`, mom.Tz, s.Tz, s.id === 'pm' ? 2e-3 : 0.015);
      // peak location
      let best = 0, bw = 0;
      for (let w = 0.5 * wp; w < 2 * wp; w += wp * 1e-4) { const v = S(w); if (v > best) { best = v; bw = w; } }
      chk(`${s.id} peak at ωp`, bw, wp, 1e-3);
    }
    let maxDiff = 0;
    for (let w = 0.2; w < 4; w += 0.01) maxDiff = Math.max(maxDiff, Math.abs(jonswapSpectrum(w, 2, 8, 1) - pmSpectrum(w, 2, 8)));
    chk('JONSWAP(γ=1) ≡ PM', maxDiff, 0, 0, 1e-15);
    // fully developed sea: integrate the original one-parameter PM spectrum S = αg²ω⁻⁵exp(−β(g/(Uω))⁴), α=0.0081, β=0.74
    for (const U of [5, 15]) {
      const g = 9.80665, Sfd = (w) => 0.0081 * g * g * w ** -5 * Math.exp(-0.74 * (g / (U * w)) ** 4);
      const m = spectralMoments(Sfd, 0.02, 20, 200000);
      let bw = 0, best = 0; for (let w = 0.05; w < 5; w += 1e-4) { const v = Sfd(w); if (v > best) { best = v; bw = w; } }
      chk(`fully developed U=${U} m/s: Tp from Hs`, pmFullyDevelopedTp(m.Hm0), 2 * Math.PI / bw, 0.003);
    }
    chk('SS3 table Hs, Tp', SEA_STATES[3].Hs + SEA_STATES[3].Tp, 0.88 + 7.5, 0, 1e-12);
    chk('SS5 table Hs, Tp', SEA_STATES[5].Hs + SEA_STATES[5].Tp, 3.25 + 9.7, 0, 1e-12);
    out.push({ id: 'wave_spectra', title: 'Pierson–Moskowitz and JONSWAP spectra (Hs 2 m, Tp 8 s)', ref: W.spectra.map((s) => s.ref).join('; ') + '; Pierson & Moskowitz (1964) α = 0.0081, β = 0.74; NATO STANAG 4194 table', rows });
  }

  // 2 — synthesized irregular sea
  {
    const { rows, chk } = chkFactory();
    const ss = SEA_STATES[4];
    const f = WaveField.fromSpectrum({ type: 'jonswap', Hs: ss.Hs, Tp: ss.Tp, gamma: 3.3, heading: 90, N: 120, seed: 7 });
    chk('component variance Σa²/2 vs Hs²/16', f.meta.m0, ss.Hs * ss.Hs / 16, 0.03);
    let s2 = 0, n = 0;
    for (let t = 0; t < 3 * 3600; t += 0.37) { const e = f.eta(3.1, -1.7, t); s2 += e * e; n++; }
    chk('η record variance (3 h) vs Σa²/2', s2 / n, f.meta.m0, 0.05);
    out.push({ id: 'wave_record', title: 'Random-phase JONSWAP sea, SS4 (Hs 1.88 m, Tp 8.8 s)', ref: 'linear superposition: Var[η] = Σaᵢ²/2 = m0', rows });
  }

  const tris = await getTris(box.file);

  // 3 — calm-water pressure integration reproduces Archimedes for every hydrostatic case
  {
    const { rows, chk } = chkFactory();
    for (const c of exp.cases) {
      if (c.expect.status === 'sinks') continue;
      const t = await getTris(c.file);
      const R = mat3.fromEulerDeg(...c.euler);
      const rel = transformTris(t, R, c.cog);
      const sol = solveWaterline(rel, c.mass / c.rho);
      const sub = submerged(rel, sol.zw);
      const m = indexMesh(rel.map((v, i) => (i % 3 === 2 ? v - sol.zw : v)), 1e-7);
      const wf = waveForces(m.verts, m.idx, WaveField.calm(), 0, c.rho, [0, 0, -sol.zw]);
      const Fb = c.rho * 9.80665 * sub.V;
      const Mexp = [sub.B[1] * Fb, -sub.B[0] * Fb];
      chk(`${c.id} Fz = ρgV`, wf.F[2], Fb, 1e-9);
      chk(`${c.id} moment = (B−G)×F`, Math.hypot(wf.M[0] - Mexp[0], wf.M[1] - Mexp[1]), 0, 0, 1e-6 * Fb);
    }
    out.push({ id: 'wave_calm_archimedes', title: 'Pressure integration in calm water vs Archimedes (all hydrostatic cases)', ref: 'F = −∮p n dA with p = −ρgz gives ρgV acting through B', rows });
  }

  // 4 — Froude–Krylov heave force on the box, closed form
  const body = setupBody(tris, box, { maxEdge: 0.1 });
  {
    const { rows, chk } = chkFactory();
    for (const p of W.box_fk.points) {
      const { F } = raoAt(body.model, p.w, p.beta);
      chk(`|F3| β=${p.beta}° ω=${p.w}`, Math.hypot(...F[2]), p.F3, 0.005, 1e-3 * W.box_fk.points[0].F3);
    }
    out.push({ id: 'wave_fk_box', title: 'Froude–Krylov heave excitation on the 4×2 m box, draft 0.4 m', ref: W.box_fk.ref, rows });
  }

  // 5 — RAO limits, natural frequency and symmetry
  {
    const { rows, chk } = chkFactory();
    const lw = 0.08;
    let r = raoAt(body.model, lw, 90);
    const k = lw * lw / 9.80665;
    chk('long waves: heave RAO → 1', Math.hypot(...r.xi[2]), 1, 0.01);
    chk('long waves, beam: roll / wave slope → 1', Math.hypot(...r.xi[3]) / k, 1, 0.01);
    chk('beam seas: pitch ≈ 0', Math.hypot(...r.xi[4]) / k, 0, 0, 1e-6);
    r = raoAt(body.model, lw, 180);
    chk('long waves, head: pitch / wave slope → 1', Math.hypot(...r.xi[4]) / k, 1, 0.01);
    chk('head seas: roll ≈ 0', Math.hypot(...r.xi[3]) / k, 0, 0, 1e-6);
    // undamped heave peak at ω_n = √(C33/(m+A33))
    const und = setupBody(tris, box, { maxEdge: 0.1, zeta: [0, 0, 0, 0, 0, 0] });
    chk('default A33 = elliptic-disk value', und.coeffs.A[2], W.box_heave_wn.A33, 1e-6);
    let best = 0, bw = 0;
    for (let w = 2.0; w < 4.0; w += 1e-4) { const a = Math.hypot(...raoAt(und.model, w, 180).xi[2]); if (a > best) { best = a; bw = w; } }
    chk('undamped heave peak at ω_n', bw, W.box_heave_wn.wn, 0.002);
    out.push({ id: 'wave_rao_limits', title: 'Linear RAOs of the box barge: long-wave limits, resonance, symmetry', ref: 'linear seakeeping (Faltinsen ch. 3, Journée & Massie ch. 6); ' + W.box_heave_wn.ref, rows });
  }

  // 6 — frequency domain vs nonlinear time domain in small regular waves
  {
    const { rows, chk } = chkFactory();
    // Small amplitude so the nonlinear time-domain solver is in its linear limit. Near the roll resonance
    // (ω_n4 = 3.23 rad/s) a 2 cm wave already drives ~3° of roll and the exact moving-waterline (nonlinear
    // Froude–Krylov) terms shift the peak by ~5 %; at 2 mm the two solvers agree to ~1 %.
    const A = 0.002;
    for (const [beta, w] of [[90, 1.5], [90, 3.0], [180, 2.0]]) {
      const lin = raoAt(body.model, w, beta);
      const field = WaveField.regular(A, w, beta);
      const T = 2 * Math.PI / w;
      const wnMax = Math.max(...body.model.wn);
      const sim = new WaveSim({
        hull: body.hull, mass: box.mass, inertiaG: body.IGb, rho: box.rho, R0: body.R, z0: -body.zw,
        field, A: body.coeffs.A, Bd: body.model.Bd, dt: Math.min(T, 2 * Math.PI / wnMax) / 300, ramp: 3 * T,
      });
      sim.advance(40 * T, 1e9);
      const t0 = sim.t - 15 * T;
      const heave = fitAmplitude(sim.rec.t, sim.rec.heave, w, t0) / A;
      chk(`β=${beta}° ω=${w}: heave TD vs FD`, heave, Math.hypot(...lin.xi[2]), 0.03);
      const j = beta === 90 ? 3 : 4, name = beta === 90 ? 'roll' : 'pitch';
      const rot = fitAmplitude(sim.rec.t, sim.rec[name], w, t0) * Math.PI / 180 / A;
      chk(`β=${beta}° ω=${w}: ${name} TD vs FD`, rot, Math.hypot(...lin.xi[j]), 0.03);
    }
    out.push({ id: 'wave_td_vs_fd', title: 'Time-domain (nonlinear Froude–Krylov) vs frequency-domain RAOs, small regular waves (A = 2 mm)', ref: 'consistency of the two solvers in the linear limit', rows });
  }

  // 7 — irregular sea: time-domain statistics vs spectral prediction
  {
    const { rows, chk } = chkFactory();
    const ss = SEA_STATES[3], beta = 90;
    const field = WaveField.fromSpectrum({ type: 'jonswap', Hs: ss.Hs, Tp: ss.Tp, gamma: 3.3, heading: beta, N: 50, seed: 3 });
    const S = spectrumFn('jonswap', ss.Hs, ss.Tp, 3.3);
    const wnMax = Math.max(...body.model.wn);
    const sim = new WaveSim({
      hull: body.hull, mass: box.mass, inertiaG: body.IGb, rho: box.rho, R0: body.R, z0: -body.zw,
      field, A: body.coeffs.A, Bd: body.model.Bd, dt: Math.min(2 * Math.PI / field.maxOmega, 2 * Math.PI / wnMax) / 60, ramp: 30,
    });
    sim.advance(20 * 60 + 30, 1e9);
    for (const [name, j] of [['heave', 2], ['roll', 3]]) {
      const td = seriesStats(sim.rec.t, sim.rec[name], 30);
      const sp = spectralResponse(body.model, S, beta, j, field.meta.wMin, field.meta.wMax, 600);
      chk(`SS3 beam: ${name} σ, time domain vs spectral`, td.sd, sp.sigma, 0.12);
    }
    out.push({ id: 'wave_spectral_vs_td', title: 'Irregular sea SS3 (JONSWAP), beam: 20 min simulation vs |RAO|²·S', ref: 'S_R = |RAO|² S;  σ² = m0 (random-phase sampling variance → ~10 % tolerance)', rows, meta: `${sim.rec.t.length.toLocaleString()} steps, dt ${(sim.dt * 1000).toFixed(1)} ms, ${(body.hull.idx.length / 3).toLocaleString()} hull panels` });
  }

  // 8 — literature benchmarks (RAO trade study): Hulme hemisphere heave, MacCamy–Fuchs spar sway
  {
    const { rows, chk } = chkFactory();
    const hs = hemisphereStudy(await getTris(W.lit_hemisphere.file, 'fine'), W.lit_hemisphere);
    for (const r of hs.rows.filter((r) => r.ka <= 0.6)) chk(`hemisphere ka=${r.ka}: |X3| FK+corr. vs Haskind`, r.X_dc, r.Xexact, 0.01);
    for (const r of hs.rows.filter((r) => r.ka <= 0.7)) chk(`hemisphere ka=${r.ka}: RAO (Hulme A,B + corr.) vs exact`, r.hulmeAB_dc, r.exact, 0.03);
    for (const r of hs.rows.filter((r) => r.ka <= 0.1)) chk(`hemisphere ka=${r.ka}: RAO tool defaults vs exact`, r.default, r.exact, 0.05);
    out.push({ id: 'lit_hemisphere', title: 'Floating hemisphere, heave: Float Sim vs Hulme (1982) exact potential flow', ref: W.lit_hemisphere.ref + ' · full table: docs/rao-trade-study.md', rows, meta: `${hs.panels.toLocaleString()} panels; tool default A33 = ${hs.defaults.A33_norm.toFixed(2)} ρV` });
  }
  {
    const { rows, chk } = chkFactory();
    const ss = sparStudy(await getTris(W.lit_spar.file, 'fine'), W.lit_spar);
    for (const r of ss.rows.filter((r) => r.ka <= 0.1)) chk(`spar ka=${r.ka}: Froude–Krylov alone = ½ MF force (C_m 1 vs 2)`, r.F_fk / r.exactF, 0.5, 0.03);
    for (const r of ss.rows.filter((r) => r.ka <= 0.7)) chk(`spar ka=${r.ka}: sway force FK+corr. vs MacCamy–Fuchs`, r.F_dc, r.exactF, 0.05);
    for (const r of ss.rows.filter((r) => r.ka <= 0.7)) chk(`spar ka=${r.ka}: sway RAO FK+corr. vs reference`, r.rao_dc, r.exact, 0.05);
    chk('spar default A22 = ρπa²T (C_a = 1)', ss.defaults.A22, ss.defaults.A22_exact, 0.01);
    out.push({ id: 'lit_spar', title: 'Deep-draft spar, sway: Float Sim vs MacCamy & Fuchs (1954)', ref: W.lit_spar.ref + ' · full table: docs/rao-trade-study.md', rows, meta: `${ss.panels.toLocaleString()} panels` });
  }

  // 9 — time domain vs frequency domain with the diffraction correction switched on
  {
    const { rows, chk } = chkFactory();
    const c = W.lit_hemisphere, A = 0.002;
    const tr = await getTris(c.file, 'normal');
    const b = setupBody(tr, { ...c }, { maxEdge: 0.08, maxEdgeTD: 0.25 });
    const modes = [true, true, true];
    const model = linearModel(b.relFine, hydrostatics(b.relFine, b.zw, c.mass, c.rho), c.mass, b.IGw, c.rho, b.coeffs, { diffraction: modes });
    const volQ = bodyFrameVolQ(refineTris(b.rel, 0.25), b.zw, b.H.B, b.R);
    for (const w of [1.4, 2.2]) {
      const lin = raoAt(model, w, 90), T = 2 * Math.PI / w;
      const sim = new WaveSim({ hull: b.hull, mass: c.mass, inertiaG: b.IGb, rho: c.rho, R0: b.R, z0: -b.zw, field: WaveField.regular(A, w, 90),
        A: b.coeffs.A, Bd: model.Bd, dt: Math.min(T, 2 * Math.PI / Math.max(...model.wn)) / 200, ramp: 3 * T, volQ, diffModes: modes });
      sim.advance(40 * T, 1e9);
      const t0 = sim.t - 15 * T;
      chk(`ω=${w}: heave TD vs FD (correction on)`, fitAmplitude(sim.rec.t, sim.rec.heave, w, t0) / A, Math.hypot(...lin.xi[2]), 0.03);
    }
    out.push({ id: 'wave_td_vs_fd_diffraction', title: 'Time domain vs RAO with the long-wave diffraction correction (sphere, A = 2 mm)', ref: 'both solvers use A_jj × volume-averaged incident acceleration', rows });
  }
  return out;
}
