// Reference coordinate system validation (the CAD csys the model, CoG, inertia and RAOs are given in), run by
// validate-core.js. Geometry is generated here (exact boxes and cylinders), so it does not depend on the mesh quality.
//  [A]  axis conventions: hand-derived axes for fixed-axis (X, Y, Z) and moving-axis (X, Y′, Z″) rotations
//  [B]  a Y-up CAD export moved into a z-up reference csys: closed-form box hydrostatics (KB = T/2, BM = B²/12T)
//  [C]  parallel-axis (Huygens–Steiner) theorem: closed-form inertia of a solid box about its corner
//  [D]  RAOs at a reference point: time-domain motion of the point vs ξ_O = (ξ_G + θ × d) e^{ik·d}; the relative
//       height of tracking.pointTransfer; the rigid-body transfer of bem.transferToG; power invariance F·ξ*
//  [E]  full pipeline: a body exported in a general CAD csys gives the same RAOs at the reference point
import { mat3, transformTris, solveWaterline, hydrostatics, massProperties, inertiaAbout, quatToMat3 } from '../js/physics.js';
import { refineTris, indexMesh, linearModel, defaultHydroCoeffs, raoAt, fkExcitation } from '../js/hydro.js';
import { WaveField } from '../js/waves.js';
import { WaveSim } from '../js/sim.js';
import { transferToG } from '../js/bem.js';
import { pointTransfer } from '../js/tracking.js';
import { refFrame, anglesFor, toRefTris, toRefPoint, fromRefPoint, inertiaAboutPoint, inertiaToG, raoAtPoint, forcesAtPoint, sweepAtPoint } from '../js/refcsys.js';
import { cylinderTris } from './validate-smallbody.js';

const G = 9.80665;

// closed box [x0, x0 + a] × [y0, y0 + b] × [z0, z0 + c], n × n quads per face (outward, counter-clockwise)
export function boxTris(a, b, c, n = 6, x0 = -a / 2, y0 = -b / 2, z0 = 0) {
  const t = [];
  const face = (P, U, V) => {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const p = (u, v) => [0, 1, 2].map((k) => P[k] + U[k] * u / n + V[k] * v / n);
      const p00 = p(i, j), p10 = p(i + 1, j), p11 = p(i + 1, j + 1), p01 = p(i, j + 1);
      t.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
    }
  };
  const x1 = x0 + a, y1 = y0 + b, z1 = z0 + c;
  face([x0, y0, z1], [a, 0, 0], [0, b, 0]); face([x0, y0, z0], [0, b, 0], [a, 0, 0]);
  face([x1, y0, z0], [0, b, 0], [0, 0, c]); face([x0, y0, z0], [0, 0, c], [0, b, 0]);
  face([x0, y1, z0], [0, 0, c], [a, 0, 0]); face([x0, y0, z0], [a, 0, 0], [0, 0, c]);
  return new Float64Array(t);
}
// a body exported from CAD in another csys: p_file = O + R p_ref
const exportTris = (tris, F) => { const o = new Float64Array(tris.length); for (let i = 0; i < tris.length; i += 3) { const q = fromRefPoint([tris[i], tris[i + 1], tris[i + 2]], F); o[i] = q[0]; o[i + 1] = q[1]; o[i + 2] = q[2]; } return o; };
const col = (R, j) => [R[j], R[3 + j], R[6 + j]];
const maxAbs = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
// complex amplitude X of x(t) ≈ Re{X e^{iωt}} (least squares on cos, sin and a mean, after a linear trend)
function fitComplex(t, x, w, t0) {
  const idx = t.map((v, i) => i).filter((i) => t[i] >= t0);
  let n = 0, st = 0, sx = 0, stt = 0, stx = 0;
  for (const i of idx) { n++; st += t[i]; sx += x[i]; stt += t[i] * t[i]; stx += t[i] * x[i]; }
  const b1 = (n * stx - st * sx) / (n * stt - st * st || 1), a0 = (sx - b1 * st) / n;
  let Scc = 0, Sss = 0, Scs = 0, Sxc = 0, Sxs = 0;
  for (const i of idx) { const c = Math.cos(w * t[i]), s = Math.sin(w * t[i]), y = x[i] - a0 - b1 * t[i]; Scc += c * c; Sss += s * s; Scs += c * s; Sxc += y * c; Sxs += y * s; }
  const det = Scc * Sss - Scs * Scs, a = (Sxc * Sss - Sxs * Scs) / det, b = (Sxs * Scc - Sxc * Scs) / det;
  return [a, -b];   // a cos ωt + b sin ωt = Re{(a − ib) e^{iωt}}
}
const cdiv = (p, q) => { const d = q[0] * q[0] + q[1] * q[1]; return [(p[0] * q[0] + p[1] * q[1]) / d, (p[1] * q[0] - p[0] * q[1]) / d]; };
const phaseDeg = (z) => Math.atan2(z[1], z[0]) * 180 / Math.PI;
const wrap = (a) => ((a + 540) % 360) - 180;
// the app's frequency-domain pipeline for a body given in the reference csys (upright start attitude)
function linBody(trisRef, { mass, cog, IG, rho = 1025, edge = 0.08, zeta = null, diffraction = [true, true, false] }) {
  const rel = transformTris(trisRef, mat3.identity(), cog);
  const sol = solveWaterline(rel, mass / rho), H = hydrostatics(rel, sol.zw, mass, rho);
  const coeffs = defaultHydroCoeffs(H, mass, IG, rho);
  if (zeta) coeffs.zeta = zeta;
  const relFine = refineTris(rel, edge);
  const model = linearModel(relFine, hydrostatics(relFine, sol.zw, mass, rho), mass, IG, rho, coeffs, { diffraction });
  return { rel, H, coeffs, model, zw: sol.zw };
}

export async function runRefCsysValidation({ chkFactory }) {
  const out = [];
  const rho = 1025;

  // A — axis conventions
  {
    const { rows, chk } = chkFactory();
    const fixed = refFrame({ mode: 'custom', origin: [0, 0, 0], axes: 'angles', angles: [90, 0, 90], order: 'fixed' }).R;
    const moving = refFrame({ mode: 'custom', origin: [0, 0, 0], axes: 'angles', angles: [90, 0, 90], order: 'moving' }).R;
    // fixed axes: X 90° → (x, z, −y); then about the file Z 90° → x′ = (0,1,0), y′ = (0,0,1), z′ = (1,0,0)
    chk('fixed-axis rotation X 90°, Z 90°: ref axes vs hand-derived (0,1,0), (0,0,1), (1,0,0)', maxAbs([...col(fixed, 0), ...col(fixed, 1), ...col(fixed, 2)], [0, 1, 0, 0, 0, 1, 1, 0, 0]), 0, 0, 1e-15);
    // moving axes: X 90°, then about the new z′ = (0,−1,0) by 90° → x′ = (0,0,1), y′ = (−1,0,0), z′ = (0,−1,0)
    chk('moving-axis rotation X 90°, Z″ 90°: ref axes vs hand-derived (0,0,1), (−1,0,0), (0,−1,0)', maxAbs([...col(moving, 0), ...col(moving, 1), ...col(moving, 2)], [0, 0, 1, -1, 0, 0, 0, -1, 0]), 0, 0, 1e-15);
    // axis directions reproduce a general rotation; the frame is right-handed and orthonormal
    const Fa = refFrame({ mode: 'custom', origin: [1.5, -2, 0.25], axes: 'angles', angles: [30, -50, 70], order: 'moving' });
    const Fd = refFrame({ mode: 'custom', origin: [1.5, -2, 0.25], axes: 'dirs', xDir: col(Fa.R, 0).map((v) => 3 * v), zDir: col(Fa.R, 2).map((v) => 0.5 * v) });
    chk('axis directions (scaled) give the same frame as the rotation angles', maxAbs(Fd.R, Fa.R), 0, 0, 1e-14);
    const RtR = mat3.mul(mat3.transpose(Fa.R), Fa.R);
    chk('ref axes orthonormal: |RᵀR − I|', maxAbs(RtR, mat3.identity()), 0, 0, 1e-14);
    const R = Fa.R, det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
    chk('ref axes right-handed: det R', det, 1, 1e-14);
    const p = [0.3, -1.7, 2.2];
    chk('point to the ref csys and back', maxAbs(fromRefPoint(toRefPoint(p, Fa), Fa), p), 0, 0, 1e-14);
    chk('file origin in the ref csys = −Rᵀ O', maxAbs(toRefPoint([0, 0, 0], Fa), mat3.apply(mat3.transpose(Fa.R), Fa.O).map((v) => -v)), 0, 0, 1e-14);
    // directions 2° from perpendicular: z kept exactly, x made perpendicular, and a warning
    const Fw = refFrame({ mode: 'custom', origin: [0, 0, 0], axes: 'dirs', xDir: [1, 0, Math.tan(2 * Math.PI / 180)], zDir: [0, 0, 1] });
    chk('non-perpendicular directions: z kept, x made perpendicular, warning given', maxAbs([...col(Fw.R, 0), ...col(Fw.R, 2)], [1, 0, 0, 0, 0, 1]) + (Fw.warn ? 0 : 1), 0, 0, 1e-15);
    chk('file mode is the identity', refFrame({ mode: 'file' }).identity ? 1 : 0, 1);
    // switching between angles and directions keeps the frame: angles back from the axes, both orders, and at the
    // gimbal lock (rotation about Y of 90°)
    let worst = 0;
    for (const order of ['fixed', 'moving']) for (const ang of [[30, -50, 70], [-120, 35, 160], [25, 90, -40], [10, -90, 55]]) {
      const R1 = refFrame({ mode: 'custom', axes: 'angles', angles: ang, order }).R;
      const R2 = refFrame({ mode: 'custom', axes: 'angles', angles: anglesFor(R1, order), order }).R;
      worst = Math.max(worst, maxAbs(R1, R2));
    }
    chk('angles recovered from the axes give the same axes (fixed and moving order, incl. Y = ±90°)', worst, 0, 0, 1e-12);
    out.push({ id: 'refcsys_axes', title: 'Reference csys: axis conventions', ref: 'hand-derived axes for fixed-axis X→Y→Z and moving-axis X→Y′→Z″ rotations', rows });
  }

  // B — a Y-up CAD export (file y up, origin elsewhere) moved into a z-up reference csys at the keel centre
  {
    const { rows, chk } = chkFactory();
    const Lb = 2, Bb = 1, Hb = 0.8, T = 0.3, KG = 0.35, mass = rho * Lb * Bb * T;
    const design = boxTris(Lb, Bb, Hb, 6);
    const F = refFrame({ mode: 'custom', origin: [3.0, -0.2, 1.5], axes: 'dirs', xDir: [1, 0, 0], zDir: [0, 1, 0] });
    const Fang = refFrame({ mode: 'custom', origin: [3.0, -0.2, 1.5], axes: 'angles', angles: [-90, 0, 0], order: 'fixed' });
    chk('Y-up csys: axis directions vs rotation −90° about X', maxAbs(F.R, Fang.R), 0, 0, 1e-15);
    const file = exportTris(design, F);
    const ref = toRefTris(file, F);
    chk('file mesh moved into the ref csys matches the design mesh', maxAbs(ref, design), 0, 0, 1e-12);
    const mp = massProperties(ref);
    chk('volume L×B×H', mp.volume, Lb * Bb * Hb, 1e-12);
    chk('centroid height above the keel = H/2', mp.centroid[2], Hb / 2, 1e-12);
    const cog = [0, 0, KG], rel = transformTris(ref, mat3.identity(), cog);
    const sol = solveWaterline(rel, mass / rho), H = hydrostatics(rel, sol.zw, mass, rho);
    chk('draft = m/(ρLB)', H.draft, T, 1e-9);
    chk('GM_T = KB + B²/(12T) − KG', H.GMt, T / 2 + Bb * Bb / (12 * T) - KG, 1e-9);
    chk('GM_L = KB + L²/(12T) − KG', H.GMl, T / 2 + Lb * Lb / (12 * T) - KG, 1e-9);
    // the same file read without the reference csys floats on its side (y up is not z up): a different body
    const raw = transformTris(file, mat3.identity(), fromRefPoint(cog, F)), Hraw = hydrostatics(raw, solveWaterline(raw, mass / rho).zw, mass, rho);
    chk('without the reference csys the Y-up file floats differently (draft ≠ T)', Math.abs(Hraw.draft - T) > 0.05 ? 1 : 0, 1);
    out.push({ id: 'refcsys_yup', title: 'Reference csys: Y-up CAD export of a 2 × 1 × 0.8 m box, z-up csys at the keel centre', ref: 'closed-form box hydrostatics: KB = T/2, BM_T = B²/12T, BM_L = L²/12T', rows });
  }

  // C — inertia taken at the reference origin (parallel-axis theorem)
  {
    const { rows, chk } = chkFactory();
    const a = 2, b = 1, c = 0.8, m = 900;
    const corner = boxTris(a, b, c, 4, 0, 0, 0);   // origin at a corner
    const mp = massProperties(corner);
    const IG = inertiaAbout(mp, m, mp.centroid), IO = inertiaAboutPoint(IG, m, mp.centroid);
    // solid box about its corner: I_xx = m(b² + c²)/3, I_xy = −∫xy dm = −m a b/4
    chk('box about its corner: I_xx = m(b² + c²)/3', IO[0], m * (b * b + c * c) / 3, 1e-10);
    chk('box about its corner: I_yy = m(a² + c²)/3', IO[4], m * (a * a + c * c) / 3, 1e-10);
    chk('box about its corner: I_zz = m(a² + b²)/3', IO[8], m * (a * a + b * b) / 3, 1e-10);
    chk('box about its corner: I_xy = −m a b/4', IO[1], -m * a * b / 4, 1e-10);
    chk('box about its corner: I_xz = −m a c/4', IO[2], -m * a * c / 4, 1e-10);
    chk('box about its corner: I_yz = −m b c/4', IO[5], -m * b * c / 4, 1e-10);
    chk('parallel axis agrees with the geometry integral about the corner', maxAbs(IO, inertiaAbout(mp, m, [0, 0, 0])), 0, 0, 1e-9 * IO[8]);
    // CAD values taken at the origin, with a CoG that is not the centroid (non-uniform mass), back to G
    const IGc = [310, -12, 7, -12, 420, -5, 7, -5, 515], Gc = [0.4, -0.15, 0.62];
    const [x, y, z] = Gc, IOc = [IGc[0] + m * (y * y + z * z), IGc[1] - m * x * y, IGc[2] - m * x * z, IGc[3] - m * x * y, IGc[4] + m * (x * x + z * z), IGc[5] - m * y * z, IGc[6] - m * x * z, IGc[7] - m * y * z, IGc[8] + m * (x * x + y * y)];
    chk('values taken at the origin moved to G (Steiner written out)', maxAbs(inertiaToG(IOc, m, Gc), IGc), 0, 0, 1e-10);
    out.push({ id: 'refcsys_inertia', title: 'Reference csys: moments of inertia taken at its origin', ref: 'Huygens–Steiner theorem; solid box about a corner (I = m(b² + c²)/3, I_xy = −mab/4)', rows });
  }

  // D — RAOs at a reference point: kinematics, phase and forces
  {
    const { rows, chk } = chkFactory();
    // Ø0.6 m cylinder buoy, draft 1.2 m, CoG 0.4 m above the keel (as the small-body suite)
    const tris = cylinderTris(0.3, 2.0), mass = rho * Math.PI * 0.09 * 1.2, cog = [0, 0, 0.4];
    const IG = inertiaAbout(massProperties(tris), mass, cog);
    // the time domain has no long-wave diffraction correction, so the linear model leaves it out too
    const b = linBody(tris, { mass, cog, IG, edge: 0.1, zeta: [0, 0, 0.15, 0.08, 0.08, 0.05], diffraction: [false, false, false] });
    // a reference point well off the body (a CAD csys origin need not be on it): 1.2 m ahead, 0.8 m to starboard,
    // 0.5 m below G; oblique waves so both k·d components count
    const d = [1.2, -0.8, -0.5], beta = 30, A0 = 0.02, w = 2.0, T = 2 * Math.PI / w, k = w * w / G;
    const xiG = raoAt(b.model, w, beta).xi, xiO = raoAtPoint(xiG, k, beta, d);
    const hull = indexMesh(refineTris(transformTris(tris, mat3.identity(), cog), 0.15), 1e-7);
    const sim = new WaveSim({ hull, mass, inertiaG: IG, rho, R0: mat3.identity(), z0: -b.zw, field: WaveField.regular(A0, w, beta), A: b.coeffs.A, Bd: b.model.Bd,
      dt: T / 200, ramp: 3 * T, drift: { on: false, holdPeriod: 120 }, volQ: null, diffModes: [false, false, false] });
    const ts = [], zs = [], xs = [], es = [];
    for (let i = 0; i < 40 * 200; i++) {
      sim.step(sim.dt, true);
      const R = quatToMat3(sim.q), pO = mat3.apply(R, d);
      ts.push(sim.t); xs.push(sim.p[0] + pO[0]); zs.push(sim.p[2] + pO[2]);
      es.push(sim.field.eta(d[0], d[1], sim.t));
    }
    const t0 = sim.t - 15 * T, E = fitComplex(ts, es, w, t0);
    const Zo = cdiv(fitComplex(ts, zs, w, t0), E), Xo = cdiv(fitComplex(ts, xs, w, t0), E);
    chk(`time domain: wave at the point has amplitude A (${A0} m)`, Math.hypot(...E), A0, 0.005);
    // the point's motion adds terms of similar size (here partly cancelling), so the time domain's ~1.5 % per DOF
    // agreement is taken relative to the sum of the terms' sizes
    const m = (z) => Math.hypot(...z), [tx, ty, tz] = [m(xiG[3]), m(xiG[4]), m(xiG[5])];
    const sc3 = m(xiG[2]) + tx * Math.abs(d[1]) + ty * Math.abs(d[0]), sc1 = m(xiG[0]) + ty * Math.abs(d[2]) + tz * Math.abs(d[1]);
    chk('heave of the reference point: time domain vs |(ξ₃ + θ_x d_y − θ_y d_x) e^{ik·d}| (3 % of the terms)', Math.hypot(...Zo), Math.hypot(...xiO[2]), 0, 0.03 * sc3);
    chk('heave of the reference point: phase from the wave at the point (deg), time domain vs RAO', wrap(phaseDeg(Zo) - phaseDeg(xiO[2])), 0, 0, 2);
    chk('surge of the reference point: time domain vs |(ξ₁ + θ_y d_z − θ_z d_y) e^{ik·d}| (3 % of the terms)', Math.hypot(...Xo), Math.hypot(...xiO[0]), 0, 0.03 * sc1);
    chk('surge of the reference point: phase (deg), time domain vs RAO', wrap(phaseDeg(Xo) - phaseDeg(xiO[0])), 0, 0, 2);
    // the phase shift matters here: without it the heave phase would be off by k·d
    chk(`phase shift k·d at the point (${(k * (d[0] * Math.cos(Math.PI / 6) + d[1] * 0.5) * 180 / Math.PI).toFixed(1)}°) is resolved: phase at G would miss by more than 10°`,
      Math.abs(wrap(phaseDeg(Zo) - phaseDeg(raoAtPoint(xiG, k, beta, d, false)[2]))) > 10 ? 1 : 0, 1);
    // relative height of the point (tracking.pointTransfer, validated against the time domain): |ξ₃,O − 1| = |h|
    const tr = pointTransfer(xiG, w, beta, d, b.zw);
    chk('relative height |ξ₃(O) − 1| (phase at O) vs tracking.pointTransfer |h|', Math.hypot(xiO[2][0] - 1, xiO[2][1]), Math.hypot(...tr.h), 1e-12);
    // forces about O: the rigid-body transfer of the panel method takes them back to G
    const Fg = fkExcitation(b.model, w, beta).F, Fo0 = forcesAtPoint(Fg, k, beta, d, false);
    const back = transferToG(Array.from({ length: 6 }, () => new Array(6).fill(0)), Array.from({ length: 6 }, () => new Array(6).fill(0)), [Fo0], d).X[0];
    chk('forces and moments about O, back to G with bem.transferToG', maxAbs(back.flat(), Fg.flat()), 0, 0, 1e-9 * Math.hypot(...Fg[2]));
    // power is the same about any point: Σ F_j ξ_j* (with the same phase reference)
    const Fo = forcesAtPoint(Fg, k, beta, d), pw = (F, X) => F.reduce((s, f, j) => [s[0] + f[0] * X[j][0] + f[1] * X[j][1], s[1] + f[1] * X[j][0] - f[0] * X[j][1]], [0, 0]);
    const pG = pw(Fg, xiG), pO = pw(Fo, xiO);
    chk('power Σ F·ξ* about O equals about G', Math.hypot(pO[0] - pG[0], pO[1] - pG[1]), 0, 0, 1e-9 * Math.hypot(...pG));
    // a sweep moved to the point: amplitudes and the slope normalisation
    const sw = sweepAtPoint([{ beta, points: [{ w, k, xi: xiG, F: Fg }] }], d)[0].points[0];
    chk('sweep at the point: |ξ₃| and roll per slope |θ_x|/k', Math.abs(sw.amp[2] - Math.hypot(...xiO[2])) + Math.abs(sw.perSlope[3] - Math.hypot(...xiG[3]) / k), 0, 0, 1e-14);
    out.push({ id: 'refcsys_rao', title: 'Reference csys: RAOs at the ref origin (Ø0.6 m buoy, point 1.2 m ahead, 0.8 m to starboard, 0.5 m below G)', ref: 'rigid-body kinematics ξ_O = ξ_G + θ × d with the phase at O; time-domain WaveSim; bem.transferToG; power invariance', rows });
  }

  // E — full pipeline: the same body exported in a general CAD csys, CoG and inertia (taken at the origin) as CAD
  // reports them in that csys, gives the same RAOs at the reference point
  {
    const { rows, chk } = chkFactory();
    const design = boxTris(2, 1, 0.8, 6);
    const mass = rho * 2 * 1 * 0.3, cog = [0.08, 0.04, 0.33];
    const IGd = [95, -3, 4, -3, 240, 2, 4, 2, 300];
    const ref = linBody(design, { mass, cog, IG: IGd });
    const F = refFrame({ mode: 'custom', origin: [12.5, -3.25, 4.0], axes: 'angles', angles: [30, -50, 70], order: 'moving' });
    const file = exportTris(design, F);
    // what a user enters: the frame, the CoG and the inertia at the origin, all in the reference csys
    const IOcad = inertiaAboutPoint(IGd, mass, cog);
    const got = linBody(toRefTris(file, F), { mass, cog, IG: inertiaToG(IOcad, mass, cog) });
    let worst = 0, worstPh = 0;
    for (const beta of [0, 45, 120]) for (const w of [0.8, 2.2, 3.5]) {
      const k = w * w / G, a = raoAtPoint(raoAt(ref.model, w, beta).xi, k, beta, cog.map((v) => -v)), bq = raoAtPoint(raoAt(got.model, w, beta).xi, k, beta, cog.map((v) => -v));
      for (let j = 0; j < 6; j++) {
        const s = Math.max(1e-12, ...a.map((z) => Math.hypot(...z)).slice(j < 3 ? 0 : 3, j < 3 ? 3 : 6));
        worst = Math.max(worst, Math.hypot(a[j][0] - bq[j][0], a[j][1] - bq[j][1]) / s);
        if (Math.hypot(...a[j]) > 1e-3 * s) worstPh = Math.max(worstPh, Math.abs(wrap(phaseDeg(a[j]) - phaseDeg(bq[j]))));
      }
    }
    // (round-off, and the waterline solve's tolerance, at the 1e-9 level)
    chk('largest RAO difference at the ref origin, 6 DOF × 3 headings × 3 frequencies (relative)', worst, 0, 0, 1e-7);
    chk('largest phase difference (deg)', worstPh, 0, 0, 1e-5);
    chk('restoring C₄₄ the same', got.model.Cm[3][3], ref.model.Cm[3][3], 1e-10);
    out.push({ id: 'refcsys_pipeline', title: 'Reference csys: a box exported in a general CAD csys (origin (12.5, −3.25, 4) m, rotated 30°, −50°, 70°)', ref: 'invariance: same RAOs at the reference point as the body given directly in the reference csys', rows });
  }
  return out;
}
