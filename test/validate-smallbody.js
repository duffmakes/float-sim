// Small-body options validation (mooring, viscous drag & heave plates, wind, tracked points, wave following),
// run by validate-core.js. Geometry is generated here (exact cylinders), so the results do not depend on the STEP
// mesh quality.
//  [FAL]  Faltinsen (1990) §8.2: inextensible catenary x = l − h(1 + 2a/h)^½ + a·acosh(1 + h/a), a = T_H/w (eq. 8.12),
//         horizontal stiffness dT_H/dx = w[acosh(1 + h/a) − 2(1 + 2a/h)^−½]^−1 (eq. 8.17)
//  [DNV]  DNV-RP-C205 §2.3: wind profile and Frøya spectrum (variance in closed form via the Beta function)
//  [BOR]  Borgman (1967): stochastic linearisation of quadratic drag, B = ½ρC_dA√(8/π)σ_u
//  [RICE] Rice (1944): mean rate of crossings of a level by a Gaussian process
import { mat3, transformTris, solveWaterline, hydrostatics, massProperties, inertiaAbout, quatToMat3 } from '../js/physics.js';
import { refineTris, indexMesh, linearModel, defaultHydroCoeffs, meanWettedTris, raoAt, spectralResponse, fkExcitation } from '../js/hydro.js';
import { WaveField, spectrumFn } from '../js/waves.js';
import { WaveSim } from '../js/sim.js';
import { catenary, quasiStaticForce, mooringLoads, mooringStiffness, mooringOffset, anchorLayout, LumpedLine, LINE_PRESETS, submergedWeight } from '../js/mooring.js';
import { dragGeometry, plateAddedMass, dragElements, dragLinear, linearizeDrag, dragLoads } from '../js/drag.js';
import { froyaSpectrum, froyaVariance, WindField, windAt, windLoads } from '../js/wind.js';
import { pointRegular, pointSpectral, followErrors, followCutoff, normCdf } from '../js/tracking.js';
import { fitAmplitude } from './validate-waves.js';

const G = 9.80665;

// closed vertical cylinder, radius R, height H, base at z = 0 (outward, counter-clockwise triangles), with rows on
// the side and rings on the caps so the triangles are well shaped (no long slivers to subdivide)
export function cylinderTris(R, H, n = 32, dz = 0.1, rings = 3) {
  const t = [], nz = Math.max(1, Math.ceil(H / dz));
  const P = (i, r, z) => { const a = 2 * Math.PI * i / n; return [r * Math.cos(a), r * Math.sin(a), z]; };
  for (let i = 0; i < n; i++) for (let k = 0; k < nz; k++) {
    const z0 = H * k / nz, z1 = H * (k + 1) / nz, a = P(i, R, z0), b = P(i + 1, R, z0), c = P(i + 1, R, z1), d = P(i, R, z1);
    t.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  for (const [z, up] of [[H, true], [0, false]]) {
    for (let k = 0; k < rings; k++) {
      const r0 = R * k / rings, r1 = R * (k + 1) / rings;
      for (let i = 0; i < n; i++) {
        const a = P(i, r0, z), b = P(i + 1, r0, z), c = P(i + 1, r1, z), d = P(i, r1, z);
        const quad = k === 0 ? [[a, c, d]] : [[a, c, d], [a, b, c]];
        for (const [p, q, w] of quad) up ? t.push(...p, ...w, ...q) : t.push(...p, ...q, ...w);
      }
    }
  }
  return new Float64Array(t);
}
// floating body set up as the app does (upright, G on the axis)
function setup(tris, { mass, cog, rho = 1025, edge = 0.1, edgeTD = 0.15, zeta = null, extraV = 0 }) {
  const R = mat3.identity(), rel = transformTris(tris, R, cog);
  const sol = solveWaterline(rel, (mass + extraV / G) / rho), H = hydrostatics(rel, sol.zw, mass, rho);
  const IGb = inertiaAbout(massProperties(tris), mass, cog);
  const coeffs = defaultHydroCoeffs(H, mass, IGb, rho);
  if (zeta) coeffs.zeta = zeta;
  const relFine = refineTris(rel, edge);
  const model = linearModel(relFine, hydrostatics(relFine, sol.zw, mass, rho), mass, IGb, rho, coeffs, { diffraction: [true, true, false] });
  const hull = indexMesh(refineTris(transformTris(tris, mat3.identity(), cog), edgeTD), 1e-7);
  return { R, rel, H, IGb, coeffs, model, hull, zw: sol.zw, wet: meanWettedTris(refineTris(rel, edge / 2), sol.zw), rho, mass };
}
// period from upward zero crossings of x − mean over t ≥ t0
function crossingPeriod(t, x, t0) {
  let n = 0, s = 0; for (let i = 0; i < t.length; i++) if (t[i] >= t0) { s += x[i]; n++; }
  const m = s / n, ups = [];
  for (let i = 1; i < t.length; i++) if (t[i] >= t0 && x[i - 1] - m < 0 && x[i] - m >= 0) ups.push(t[i - 1] + (t[i] - t[i - 1]) * (m - x[i - 1]) / (x[i] - x[i - 1]));
  return ups.length > 2 ? (ups[ups.length - 1] - ups[0]) / (ups.length - 1) : NaN;
}

export async function runSmallBodyValidation({ chkFactory }) {
  const out = [];
  const rho = 1025;

  // 1 — catenary statics and the lumped-mass line at rest
  {
    const { rows, chk } = chkFactory();
    const w = 150, h = 50, l = 300, EA = 1e14;   // EA → ∞: inextensible
    for (const a of [20, 150, 400]) {
      const x = l - h * Math.sqrt(1 + 2 * a / h) + a * Math.acosh(1 + h / a);
      const s = catenary(x, h, l, w, EA);
      chk(`touchdown catenary a = ${a} m: T_H = a·w (Faltinsen 8.12)`, s.H, a * w, 1e-6);
      chk(`touchdown catenary a = ${a} m: V = w·(suspended length)`, s.V, w * h * Math.sqrt(1 + 2 * a / h), 1e-6);
      const kF = w / (Math.acosh(1 + h / a) - 2 / Math.sqrt(1 + 2 * a / h)), dx = 1e-3;
      chk(`a = ${a} m: horizontal stiffness dT_H/dx (Faltinsen 8.17)`, (catenary(x + dx, h, l, w, EA).H - catenary(x - dx, h, l, w, EA).H) / (2 * dx), kF, 1e-4);
    }
    {
      // fully suspended (anchor lifted): inextensible parametric catenary from H and V_A
      const H = 2000, VA = 500, L = 80, w2 = 100;
      const X = (H / w2) * (Math.asinh((VA + w2 * L) / H) - Math.asinh(VA / H)), Z = (H / w2) * (Math.cosh(Math.asinh((VA + w2 * L) / H)) - Math.cosh(Math.asinh(VA / H)));
      const s = catenary(X, Z, L, w2, 1e14);
      chk('suspended catenary: H', s.H, H, 1e-6); chk('suspended catenary: anchor uplift V_A', s.VA, VA, 1e-5);
    }
    chk('weightless elastic tether: T = EA(d − L)/L', Math.hypot(catenary(3, 4, 4.9, 0, 1e5).H, catenary(3, 4, 4.9, 0, 1e5).V), 1e5 * 0.1 / 4.9, 1e-12);
    chk('slack limit: H = 0 when the excess lies on the seabed (X < L − h)', catenary(5, 20, 40, 20, 1e9).H, 0, 0, 1e-12);
    // lumped-mass line relaxed at rest vs the catenary
    for (const [name, P, L, R] of [['10 mm chain, touchdown', LINE_PRESETS.chain10, 40, 30], ['12 mm nylon, taut', LINE_PRESETS.nylon12, 30, 25]]) {
      const cfg = { depth: 20, L, ...P, Can: 1, lines: [{ anchor: [R, 0] }] }, Fw = [0, 0, -0.5];
      const q = quasiStaticForce(cfg, [R, 0], Fw, rho);
      const ln = new LumpedLine({ cfg, anchor: [R, 0], rho, fairleadWorld: Fw, nSeg: 32 });
      ln.relax(Fw, 60);
      let F = [0, 0, 0]; for (let i = 0; i < 20; i++) { const f = ln.advance(0.05, Fw, [0, 0, 0], 0); F = F.map((v, k) => v + f[k] / 20); }
      chk(`lumped-mass line (32 segments) at rest, ${name}: H vs catenary`, -F[0], -q.F[0], 0.01);
      chk(`lumped-mass line (32 segments) at rest, ${name}: V vs catenary`, -F[2], -q.F[2], 0.01);
    }
    out.push({ id: 'mooring_statics', title: 'Mooring statics: elastic catenary vs Faltinsen closed forms; lumped-mass line at rest', ref: 'Faltinsen (1990) eq. 8.12, 8.17; Jonkman (2007) §4.2.3', rows });
  }

  // 2 — mooring stiffness matrix and equilibrium
  {
    const { rows, chk } = chkFactory();
    const cfg = { depth: 20, L: 40, ...LINE_PRESETS.chain10, Can: 1, lines: anchorLayout(3, 30, 0, [0, 0]) };
    const Fw = [0, 0, -0.6], Gw = [0, 0, 0.3];
    const S = mooringStiffness(cfg, rho, Fw, Gw);
    // generalized load for a small body displacement q = [x, y, z, θx, θy, θz] (fairlead r moves by δx + θ × r)
    const r0 = [Fw[0] - Gw[0], Fw[1] - Gw[1], Fw[2] - Gw[2]];
    const gen = (q) => {
      const R = mat3.mul(mat3.rotZ(q[5]), mat3.mul(mat3.rotY(q[4]), mat3.rotX(q[3]))), r = mat3.apply(R, r0);
      const G2 = [Gw[0] + q[0], Gw[1] + q[1], Gw[2] + q[2]];
      const L = mooringLoads(cfg, rho, [G2[0] + r[0], G2[1] + r[1], G2[2] + r[2]], G2);
      return [...L.F, ...L.M];
    };
    for (const [j, lab, d] of [[0, 'surge', 1e-3], [2, 'heave', 1e-3], [3, 'roll', 1e-5], [4, 'pitch', 1e-5]]) {
      const qp = [0, 0, 0, 0, 0, 0], qm = [0, 0, 0, 0, 0, 0]; qp[j] = d; qm[j] = -d;
      const gp = gen(qp), gm = gen(qm);
      const col = gp.map((v, i) => -(v - gm[i]) / (2 * d));
      const big = Math.max(...col.map(Math.abs));
      const i = col.findIndex((v) => Math.abs(v) === big);
      chk(`6×6 stiffness K[${i}][${j}] (${lab} column, largest term) vs finite differences`, S.K[i][j], col[i], 2e-3);
    }
    // spread mooring under a small steady force: offset ≈ F/K_h; and the equilibrium balances the force
    const Fx = 20, eq = mooringOffset(cfg, rho, Fw, Gw, [Fx, 0]);
    chk('spread mooring (3 lines), 20 N steady force: residual horizontal force', Math.hypot(eq.F[0] + Fx, eq.F[1]), 0, 0, 1e-6 * Fx);
    chk('spread mooring, 20 N: offset vs linear F/K₁₁', eq.offset[0], Fx / S.Kf[0][0], 0.05);
    // single line: it pulls the body toward its anchor until slack (zero horizontal tension)
    const one = { ...cfg, lines: anchorLayout(1, 30, 0, [0, 0]) }, e1 = mooringOffset(one, rho, Fw, Gw, [0, 0]);
    chk('single line without load: equilibrium at the slack limit (H = 0)', Math.hypot(e1.F[0], e1.F[1]), 0, 0, 1e-3);
    out.push({ id: 'mooring_stiffness', title: 'Mooring: 6×6 stiffness about G (with geometric stiffness) and static equilibrium', ref: 'finite differences of the catenary loads; Newton equilibrium', rows });
  }

  // 3 — moored body in the time domain: heave on a taut tether, surge on a spread chain mooring
  {
    const { rows, chk } = chkFactory();
    const tris = cylinderTris(0.3, 2.0), mass = rho * Math.PI * 0.09 * 1.0, cog = [0, 0, 0.5];
    // taut weightless-ish tether at the keel (Dyneema, slightly buoyant → straight elastic rope), pretension from extra buoyancy
    const tP = { ...LINE_PRESETS.dyneema8, EA: 2e4 };
    const depth = 10, Ltether = 8.9;   // the keel sits ~1 m below the surface: ~5 cm stretch, so it stays taut
    // pretension: solve the floating draft with the tether's pull (as the app does)
    let zw = solveWaterline(transformTris(tris, mat3.identity(), cog), mass / rho).zw, V = 0;
    const tcfg = { depth, L: Ltether, ...tP, Can: 1, lines: [{ anchor: [0, 0] }] };
    for (let it = 0; it < 200; it++) { const ld = mooringLoads(tcfg, rho, [0, 0, -0.5 - zw], [0, 0, -zw]); V = -ld.F[2]; zw = 0.5 * zw + 0.5 * solveWaterline(transformTris(tris, mat3.identity(), cog), (mass + V / G) / rho).zw; }
    const b = setup(tris, { mass, cog, extraV: V, zeta: [0, 0, 0.0, 0.0, 0.0, 0] });
    const Kt = mooringStiffness(tcfg, rho, [0, 0, -0.5 - b.zw], [0, 0, -b.zw]).K;
    const wn = Math.sqrt((b.model.Cm[2][2] + Kt[2][2]) / (mass + b.coeffs.A[2]));
    for (const model of ['quasi', 'dynamic']) {
      const sim = new WaveSim({ hull: b.hull, mass, inertiaG: b.IGb, rho, R0: b.R, z0: -b.zw + 0.01, field: WaveField.calm(), A: b.coeffs.A, Bd: [0, 0, 0, 0, 0, 0],
        dt: 2 * Math.PI / wn / 200, mooring: { cfg: tcfg, model, fairlead: [0, 0, -0.5], nSeg: 8 } });
      sim.advance(12 * 2 * Math.PI / wn, 1e9);
      chk(`taut tether (EA/L = ${(tP.EA / Ltether).toFixed(0)} N/m), ${model}: heave period vs 2π√((m + A₃₃)/(C₃₃ + K₃₃))`, crossingPeriod(sim.rec.t, sim.rec.heave, 0), 2 * Math.PI / wn, 0.02);
    }
    // spread chain mooring: surge period with the linear stiffness of three catenaries
    const ccfg = { depth: 20, L: 40, ...LINE_PRESETS.chain6, Can: 1, lines: anchorLayout(3, 33, 0, [0, 0]) };
    // fairlead at G, so surge does not couple to pitch through the lever arm
    let zc = solveWaterline(transformTris(tris, mat3.identity(), cog), mass / rho).zw, Vc = 0;
    for (let it = 0; it < 200; it++) { const ld = mooringLoads(ccfg, rho, [0, 0, -zc], [0, 0, -zc]); Vc = -ld.F[2]; zc = 0.5 * zc + 0.5 * solveWaterline(transformTris(tris, mat3.identity(), cog), (mass + Vc / G) / rho).zw; }
    const bc = setup(tris, { mass, cog, extraV: Vc, zeta: [0, 0, 0.15, 0.08, 0.08, 0] });
    const Kc = mooringStiffness(ccfg, rho, [0, 0, -bc.zw], [0, 0, -bc.zw]).K;
    const wS = Math.sqrt(Kc[0][0] / (mass + bc.coeffs.A[0]));
    const sim = new WaveSim({ hull: bc.hull, mass, inertiaG: bc.IGb, rho, R0: bc.R, z0: -bc.zw, field: WaveField.calm(), A: bc.coeffs.A, Bd: [0, 0, bc.model.Bd[2], bc.model.Bd[3], bc.model.Bd[4], 0],
      dt: 0.01, p0: [0.1, 0], mooring: { cfg: ccfg, model: 'quasi', fairlead: [0, 0, 0] } });
    sim.advance(6 * 2 * Math.PI / wS, 1e9);
    chk(`spread chain mooring (3 × 6 mm chain), quasi-static: surge period vs 2π√((m + A₁₁)/K₁₁) = ${(2 * Math.PI / wS).toFixed(1)} s`, crossingPeriod(sim.rec.t, sim.rec.x, 0), 2 * Math.PI / wS, 0.03);
    out.push({ id: 'mooring_dynamics', title: 'Moored cylinder buoy (Ø0.6 m, draft 1 m): time domain vs linear stiffness', ref: 'natural periods of the linearised system', rows });
  }

  // 4 — viscous drag: tow force, quadratic decay, stochastic and regular linearisation vs the time domain
  //     (CoG 0.4 m above the keel, GM ≈ 0.22 m, so the buoy stays upright in the irregular sea)
  {
    const { rows, chk } = chkFactory();
    const tris = cylinderTris(0.3, 2.0), mass = rho * Math.PI * 0.09 * 1.2, cog = [0, 0, 0.4];
    const b = setup(tris, { mass, cog, zeta: [0, 0, 0, 0, 0, 0] });
    const geo = dragGeometry(b.wet, [1.2, 1.2, 0.82]);
    chk('lateral projected area = D × draft', geo.A[0], 0.6 * 1.2, 0.01);
    chk('area from below = πR²', geo.A[2], Math.PI * 0.09, 0.01);
    const tow = dragLoads({ geo, plates: [] }, mat3.identity(), [0, 0, 0], [1.5, 0, 0], [0, 0, 0], WaveField.calm(), 0, rho);
    chk('tow at 1.5 m/s in still water: F = ½ρC_dAU²', -tow.F[0], 0.5 * rho * 1.2 * geo.A[0] * 1.5 * 1.5, 1e-9);
    // quadratic heave decay: Δ(1/X) per cycle = (8/3)·½ρC_dA/(m + A₃₃)
    {
      const sim = new WaveSim({ hull: b.hull, mass, inertiaG: b.IGb, rho, R0: b.R, z0: -b.zw + 0.15, field: WaveField.calm(), A: b.coeffs.A, Bd: [0, 0, 0, 0, 0, 0],
        dt: 0.002, drag: { geo, plates: [] } });
      sim.advance(30, 1e9);
      // displacement from equilibrium: the record is relative to the start, 15 cm above it
      const r = sim.rec, dz = r.heave.map((h) => h + 0.15), pk = [];
      for (let i = 1; i < r.t.length - 1; i++) if (dz[i] > dz[i - 1] && dz[i] >= dz[i + 1] && dz[i] > 1e-4) pk.push(dz[i]);
      const n = Math.min(pk.length, 8), slope = (1 / pk[n - 1] - 1 / pk[0]) / (n - 1);
      chk('free heave decay with quadratic drag only: slope of 1/X per cycle vs (8/3)β', slope, (8 / 3) * 0.5 * rho * 0.82 * geo.A[2] / (mass + b.coeffs.A[2]), 0.03);
    }
    // heave plate under the keel: irregular sea near heave resonance, time domain vs stochastic linearisation
    const plates = [{ r: [0, 0, -0.7], D: 0.9, Cd: 1.5 }], Ap = plateAddedMass(plates, rho);   // 0.3 m below the keel
    chk('disc added mass ρD³/3', Ap[2], rho * 0.729 / 3, 1e-12);
    const D = { geo, plates }, A = b.coeffs.A.map((v, j) => v + Ap[j]);
    const wn = Math.sqrt(b.model.Cm[2][2] / (mass + A[2]));
    const els = dragElements(D, rho, b.zw);
    const base = { ...b.model, Bd: [0, 0, 0, 0, 0, 0] };
    const Fc = new Map(), Fof = (w, beta) => { const k = `${w.toPrecision(12)},${beta}`; if (!Fc.has(k)) Fc.set(k, fkExcitation(base, w, beta)); return Fc.get(k); };
    const solve = (beta) => (w, Beq) => raoAt(base, w, beta, { A: Ap, terms: (ww) => dragLinear(els, Beq, ww, beta, b.zw, rho) }, Fof(w, beta)).xi;
    {
      const sea = { type: 'jonswap', Hs: 0.5, Tp: 2 * Math.PI / wn, gamma: 3.3, heading: 0, N: 80, seed: 3 };
      const S = spectrumFn('jonswap', sea.Hs, sea.Tp, 3.3), wp = 2 * Math.PI / sea.Tp;
      const omegas = Array.from({ length: 240 }, (_, i) => 0.4 * wp + 3.6 * wp * i / 239);
      const lin = linearizeDrag(els, { kind: 'spectrum', S, omegas }, 0, solve(0), b.zw);
      const ex = { A: Ap, terms: (w) => dragLinear(els, lin.Beq, w, 0, b.zw, rho) };
      const sr = spectralResponse(base, S, 0, 2, 0.4 * wp, 4 * wp, 400, 1200, ex);
      const field = WaveField.fromSpectrum(sea);
      const sim = new WaveSim({ hull: b.hull, mass, inertiaG: b.IGb, rho, R0: b.R, z0: -b.zw, field, A, Bd: [0, 0, 0, 0, 0, 0],
        dt: Math.min(0.02, 2 * Math.PI / field.maxOmega / 40), ramp: 20, drag: D, drift: { on: false, holdPeriod: 120 }, volQ: null,
        points: [{ name: 'low antenna', r: [0, 0.2, b.zw + 0.15], clearance: 0.0 }] });
      sim.advance(1220, 1e9);
      const t0 = 20, hz = sim.rec.heave.filter((_, i) => sim.rec.t[i] >= t0), mz = hz.reduce((s, v) => s + v, 0) / hz.length;
      const sdz = Math.sqrt(hz.reduce((s, v) => s + (v - mz) ** 2, 0) / hz.length);
      chk('heave plate, JONSWAP at heave resonance (Hs 0.5 m): heave σ time domain vs linearised drag', sdz, sr.sigma, 0.1);
      chk('linearised drag changes the response (σ with drag < σ undamped plate-free check)', sr.sigma < spectralResponse(base, S, 0, 2, 0.4 * wp, 4 * wp, 400, 1200, { A: Ap }).sigma ? 1 : 0, 1, 0, 0);
      // tracked point in the same run: time above water and going under, vs the Gaussian / Rice estimates
      const rows2 = omegas.map((w) => ({ w, xi: raoAt(base, w, 0, ex).xi }));
      // in this steep resonant sea the nonlinear wetted surface shifts the mean slightly, so only σ is compared here;
      // the Gaussian time-above-water and Rice estimates are checked in a near-linear sea in section 6
      const pr = sim.tracker.summary(sim.t)[0], pl = pointSpectral(rows2, S, 0, [0, 0.2, b.zw + 0.15], b.zw, 0.15);
      chk('tracked point: σ of height above water, time domain vs linear (with linearised drag)', pr.sdH, pl.sdH, 0.1);
    }
    // regular wave at resonance: Lorentz-linearised amplitude vs the time-domain steady state
    {
      const A0 = 0.02, w = wn, T = 2 * Math.PI / w;
      const lin = linearizeDrag(els, { kind: 'regular', A: A0, w }, 0, solve(0), b.zw);
      const xi = raoAt(base, w, 0, { A: Ap, terms: (ww) => dragLinear(els, lin.Beq, ww, 0, b.zw, rho) }).xi;
      const sim = new WaveSim({ hull: b.hull, mass, inertiaG: b.IGb, rho, R0: b.R, z0: -b.zw, field: WaveField.regular(A0, w, 0), A, Bd: [0, 0, 0, 0, 0, 0],
        dt: T / 200, ramp: 3 * T, drag: D, drift: { on: false, holdPeriod: 120 } });
      sim.advance(40 * T, 1e9);
      chk('heave plate, regular wave at resonance (A = 2 cm): TD amplitude vs Lorentz linearisation', fitAmplitude(sim.rec.t, sim.rec.heave, w, sim.t - 10 * T), A0 * Math.hypot(...xi[2]), 0.05);
    }
    out.push({ id: 'viscous_drag', title: 'Viscous drag & heave plate on a Ø0.6 m cylinder buoy: tow force, quadratic decay, linearisation vs time domain', ref: 'Morison drag; Borgman (1967) √(8/π)σ; Lorentz 8/(3π); Rice (1944)', rows });
  }

  // 5 — wind: profile, Frøya spectrum, windage, static heel and drift
  {
    const { rows, chk } = chkFactory();
    chk('profile U(10 m) = U₁₀', windAt(12, 10), 12, 1e-12);
    chk('profile U(2 m) = U₁₀(0.2)^0.12', windAt(12, 2), 12 * Math.pow(0.2, 0.12), 1e-12);
    let num = 0; const fs = []; for (let i = 0; i <= 200000; i++) fs.push(Math.exp(Math.log(1e-7) + (Math.log(1e5) - Math.log(1e-7)) * i / 200000));
    for (let i = 1; i < fs.length; i++) num += 0.5 * (froyaSpectrum(fs[i], 10, 10) + froyaSpectrum(fs[i - 1], 10, 10)) * (fs[i] - fs[i - 1]);
    chk('Frøya spectrum variance: closed form (Beta function) vs numerical, U₁₀ = 10 m/s, z = 10 m', froyaVariance(10, 10), num, 0.002);
    chk('Frøya turbulence intensity at 10 m ≈ 10 % (σ_u/U)', Math.sqrt(froyaVariance(10, 10)) / 10, 0.103, 0.03);
    const wf = new WindField({ U10: 10, dirDeg: 0, gusts: true, zRef: 10, N: 400, fLo: 1e-4, fHi: 2, seed: 5 });
    chk('synthesised gusts: σ vs the spectrum over the same band', wf.sigma, Math.sqrt(froyaVariance(10, 10)), 0.05);
    // windage on a box face-on, uniform wind (α = 0): F = ½ρC_dAU², moment arm = half the dry height
    {
      const box = []; const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
      const f4 = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]];
      for (const q of f4) for (const tri of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) for (const k of tri) box.push(v[k][0] - 0.5, v[k][1] - 0.5, v[k][2] - 0.4);
      const m = indexMesh(new Float64Array(box), 1e-9);
      const wind = new WindField({ U10: 10, dirDeg: 0, alpha: 0 });
      const wl = windLoads(m.verts, m.idx, null, wind, 0, [0, 0, 0], [0, 0, 0], [0, 0, 0], 1.1);
      chk('windage, 1 m box with 0.6 m dry, face-on uniform wind: F = ½ρC_dAU²', wl.F[0], 0.5 * 1.225 * 1.1 * 0.6 * 100, 1e-9);
      chk('windage moment about a point at the waterline = F × 0.3 m', wl.M[1], 0.3 * wl.F[0], 1e-9);
    }
    // static heel and free wind drift of the cylinder buoy with a mast-like top (tall cylinder: 0.8 m dry)
    {
      const tris = cylinderTris(0.3, 2.0), mass = rho * Math.PI * 0.09 * 1.2, cog = [0, 0, 0.5];
      // no linear surge/sway damping, so the drift speed is set by the quadratic drag alone
      const b = setup(tris, { mass, cog, zeta: [0, 0, 0.2, 0.2, 0.2, 0.1] });
      const params = { U10: 6, dirDeg: 90, gusts: false, alpha: 0 };
      const mk = (drift) => new WaveSim({ hull: b.hull, mass, inertiaG: b.IGb, rho, R0: b.R, z0: -b.zw, field: WaveField.calm(), A: b.coeffs.A, Bd: b.model.Bd,
        dt: 0.01, ramp: 10, drift, wind: { params, Cd: 1.0, rhoA: 1.225 } });
      const sim = mk({ on: false, holdPeriod: 120 });
      sim.advance(80, 1e9);
      const restM = windLoads(b.hull.verts.map((x, i) => (i % 3 === 2 ? x - b.zw : x)), b.hull.idx, null, new WindField(params), 0, [0, 0, -b.zw], [0, 0, 0], [0, 0, 0], 1.0);
      const heelLin = restM.M[0] / b.model.Cm[3][3] * 180 / Math.PI;
      const n = sim.rec.roll.length, mean = sim.rec.roll.slice(n - 2000).reduce((s, v) => s + v, 0) / 2000;
      chk(`steady wind 6 m/s on a 0.8 m freeboard: mean heel (${heelLin.toFixed(2)}°), time domain vs linear M/C₄₄`, mean, heelLin, 0.05);
      // free drift (wave drift on, calm water): ½ρ_aC_aA_a(U − v)² = ½ρ_wC_wA_w v²  (drift drag C_d 1, width × draft)
      const sd = mk({ on: true, Cd: 1.0 });
      sd.advance(400, 1e9);
      const r = sd.rec, k = r.t.length - 1, i0 = r.t.findIndex((t) => t > 300), v = (r.y[k] - r.y[i0]) / (r.t[k] - r.t[i0]);
      const Aa = 0.6 * (2.0 - 1.2), Aw = 0.6 * 1.2, vExp = 6 / (1 + Math.sqrt(rho * Aw / (1.225 * Aa)));
      chk('free wind drift in calm water: speed vs drag balance', v, vExp, 0.03);
    }
    out.push({ id: 'wind', title: 'Wind: profile, Frøya gust spectrum, windage, static heel and drift', ref: 'DNV-RP-C205 §2.3 (power law α = 0.12, Frøya eq. 2.21); Hoerner drag', rows });
  }

  // 6 — tracked points (regular waves) and wave-following quality
  {
    const { rows, chk } = chkFactory();
    // CoG 0.4 m above the keel (GM ≈ 0.22 m); no linear surge/sway damping, so in long waves the free body can follow
    const tris = cylinderTris(0.3, 2.0), mass = rho * Math.PI * 0.09 * 1.2, cog = [0, 0, 0.4];
    const b = setup(tris, { mass, cog, zeta: [0, 0, 0.15, 0.08, 0.08, 0.05] });
    const A0 = 0.02, w = 2.0, T = 2 * Math.PI / w;
    const pts = [{ name: 'mast top', r: [0.1, 0, 1.5], clearance: 0 }, { name: 'near waterline', r: [0, 0.3, b.zw + 0.005], clearance: 0 }];
    const sim = new WaveSim({ hull: b.hull, mass, inertiaG: b.IGb, rho, R0: b.R, z0: -b.zw, field: WaveField.regular(A0, w, 0), A: b.coeffs.A, Bd: b.model.Bd,
      dt: T / 200, ramp: 3 * T, drift: { on: false, holdPeriod: 120 }, volQ: null, diffModes: [false, false, false], points: pts });
    // record the mast-top acceleration (surge direction) by differentiating its position twice
    const xs = [], ts = [];
    const r0 = pts[0].r;
    for (let i = 0; i < 40 * 200; i++) {
      sim.step(sim.dt, true);
      const R = quatToMat3(sim.q);
      xs.push(sim.p[0] + R[0] * r0[0] + R[1] * r0[1] + R[2] * r0[2]); ts.push(sim.t);
    }
    const acc = []; for (let i = 1; i < xs.length - 1; i++) acc.push((xs[i + 1] - 2 * xs[i] + xs[i - 1]) / (sim.dt * sim.dt));
    const model = { ...b.model, diffraction: [false, false, false] };
    const xi = raoAt(model, w, 0).xi;
    const pr = pointRegular(xi, w, 0, [0.1, 0, 1.5], b.zw, 0, A0);
    chk('mast-top surge acceleration amplitude: time domain vs RAO (ω²|ξ₁ + θ_y z|·A)', fitAmplitude(ts.slice(1, -1), acc, w, sim.t - 10 * T), pr.accAmp[0], 0.03);
    const sum = sim.tracker.summary(sim.t);
    const p2 = pointRegular(xi, w, 0, [0, 0.3, b.zw + 0.005], b.zw, 0.005, A0);
    chk('point 5 mm above the waterline in a 2 cm wave: time above water vs acos(−h₀/R)/π', sum[1].fracAbove, p2.fracAbove, 0, 0.03);
    chk('normal CDF Φ(1) (A&S 26.2.17)', normCdf(1), 0.8413447, 1e-6);
    // near-linear irregular sea (Hs 15 cm, beam): time above water and how often a point goes under, vs the Gaussian
    // relative-motion estimate Φ(h₀/σ) and Rice's crossing rate
    {
      const sea = { type: 'jonswap', Hs: 0.15, Tp: 3.0, gamma: 3.3, heading: 90, N: 80, seed: 11 };
      const S = spectrumFn('jonswap', sea.Hs, sea.Tp, 3.3), wp = 2 * Math.PI / sea.Tp;
      const rp = [0.15, 0, b.zw + 0.04];
      const sim2 = new WaveSim({ hull: b.hull, mass, inertiaG: b.IGb, rho, R0: b.R, z0: -b.zw, field: WaveField.fromSpectrum(sea), A: b.coeffs.A, Bd: b.model.Bd,
        dt: 0.02, ramp: 20, drift: { on: false, holdPeriod: 120 }, volQ: null, diffModes: [false, false, false], points: [{ name: 'low point', r: rp, clearance: 0 }] });
      sim2.advance(920, 1e9);
      const ws = Array.from({ length: 300 }, (_, i) => 0.4 * wp + 3.6 * wp * i / 299);
      const lin = pointSpectral(ws.map((w) => ({ w, xi: raoAt(model, w, 90).xi })), S, 90, rp, b.zw, 0.04);
      const q = sim2.tracker.summary(sim2.t)[0];
      chk(`point 4 cm above water, Hs 0.15 m: σ of height above water vs linear (${lin.sdH.toFixed(3)} m)`, q.sdH, lin.sdH, 0.05);
      chk('point 4 cm above water: time above water vs Φ(h₀/σ)', q.fracAbove, lin.fracAbove, 0, 0.02);
      chk('point 4 cm above water: times it goes under per hour vs Rice', q.dunksPerHour, lin.dunksPerHour, 0.1);
    }
    // ideal follower in long waves: a small free-floating buoy (diffraction correction on for surge/sway)
    for (const beta of [0, 45]) {
      // ω well below the roll/pitch natural frequency (≈ 0.6 rad/s) so the tilt can follow too
      const wl = 0.05, p = { w: wl, k: wl * wl / G, xi: raoAt(b.model, wl, beta).xi };
      const e = followErrors(p, beta);
      chk(`long waves (ω ${wl} rad/s, β ${beta}°): heave error`, e.heave, 0, 0, 0.01);
      chk(`long waves (β ${beta}°): tilt error (relative to the slope)`, e.tilt, 0, 0, 0.02);
      chk(`long waves (β ${beta}°): horizontal error`, e.horiz, 0, 0, 0.02);
    }
    // cutoff detection on a synthetic transfer function H = 1/(1 − r² + 2iζr)
    {
      const zeta = 0.1, tol = 0.05, err = (r) => Math.hypot(r * r, 2 * zeta * r) / Math.hypot(1 - r * r, 2 * zeta * r);
      let lo = 0, hi = 0.9; for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (err(m) > tol) hi = m; else lo = m; }
      const fsx = Array.from({ length: 2001 }, (_, i) => i * 0.9 / 2000);
      chk('wave-following cutoff: interpolated crossing vs bisection', followCutoff(fsx, fsx.map(err), tol).f, lo, 1e-3);
    }
    out.push({ id: 'points_following', title: 'Tracked points and wave-following quality (Ø0.6 m cylinder buoy)', ref: 'rigid-body kinematics; RAO relative motion; ideal follower: heave 1, tilt = slope, surface-particle orbit', rows });
  }
  return out;
}
void submergedWeight;
