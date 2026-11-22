// Viscous (quadratic) drag on the hull and on heave plates, and its equivalent linearisation for the RAOs.
// Pure math, no rendering.
//
// Model (Morison-type drag per axis, as a 6-DOF "buoy" in OrcaFlex or the quadratic drag of WEC-Sim):
//  • translation: F_j = ½ρ C_d,j A_j |u_r,j| u_r,j along each equilibrium axis j (x, y, z attached to the body),
//    u_r = incident orbital velocity at the centroid c_j of the projected area A_j minus the body velocity at G;
//    A_x, A_y = submerged projected areas (½Σ|S_x|, front and back counted once), A_z = downward-facing projected area
//  • rotation: M_j = −½ρ K_j |ω_j| ω_j with K_j = Σ C_d,face f |v_n|³ dA over the wetted surface, v_n = (e_j × r)·n the
//    panel's normal velocity per unit rate (zero for a body of revolution spinning about its axis)
//  • heave plates (thin discs, not part of the panel mesh): added mass ρD³/3 normal to the plate (disc broadside,
//    infinite fluid: Lamb §106, Newman Marine Hydrodynamics §4.13), rotational added inertia ρD⁵/90 about a diameter,
//    inertia force A·a_fluid,n (no Froude–Krylov force on a thin plate) and drag ½ρC_d(πD²/4)|u_rn|u_rn on the plate's
//    normal velocity relative to the water
// Equivalent linearisation (RAOs, sea-state table): ½ρC_dA|u|u ≈ B u with
//    B = ½ρC_dA·√(8/π)·σ_u   (irregular sea; Borgman 1967, Gaussian relative velocity)
//    B = ½ρC_dA·(8/(3π))·U   (regular wave of relative-velocity amplitude U; Lorentz energy equivalence)
// iterated with the response, because the relative velocity depends on the motion.

// Hoerner (Fluid-Dynamic Drag, 1965) presets per equilibrium axis [x, y, z]
export const DRAG_PRESETS = {
  vcyl: { label: 'Vertical cylinder / spar buoy', Cd: [1.2, 1.2, 0.82] },
  hcyl: { label: 'Horizontal cylinder along X (glider, log)', Cd: [0.82, 1.2, 1.2] },
  sphere: { label: 'Sphere', Cd: [0.47, 0.47, 0.47] },
  box: { label: 'Box / cube', Cd: [1.05, 1.05, 1.05] },
  disc: { label: 'Flat disc buoy', Cd: [1.0, 1.0, 1.17] },
  streamX: { label: 'Streamlined along X (glider hull)', Cd: [0.1, 1.2, 1.2] },
};

// Drag geometry from the mean wetted surface: tris = list of { tri: [a, b, c] } relative to G in the equilibrium
// (seakeeping) frame, waterline at z = zw. Cd = [Cd_x, Cd_y, Cd_z].
export function dragGeometry(wetTris, Cd) {
  const A = [0, 0, 0], cs = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], K = [0, 0, 0];
  for (const { tri: [a, b, c] } of wetTris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const S = [0.5 * (u[1] * v[2] - u[2] * v[1]), 0.5 * (u[2] * v[0] - u[0] * v[2]), 0.5 * (u[0] * v[1] - u[1] * v[0])];
    const area = Math.hypot(...S);
    if (!(area > 0)) continue;
    const r = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const wts = [0.5 * Math.abs(S[0]), 0.5 * Math.abs(S[1]), S[2] < 0 ? -S[2] : 0];
    for (let j = 0; j < 3; j++) { A[j] += wts[j]; for (let k = 0; k < 3; k++) cs[j][k] += wts[j] * r[k]; }
    const n = S.map((x) => x / area);
    // per-face drag weight: lateral faces count half (front and back), downward faces in full
    const cdf = Cd[0] * 0.5 * n[0] * n[0] + Cd[1] * 0.5 * n[1] * n[1] + (n[2] < 0 ? Cd[2] * n[2] * n[2] : 0);
    // v_n for unit rotation about axis j: (e_j × r)·n = (r × n)_j
    const rn = [r[1] * n[2] - r[2] * n[1], r[2] * n[0] - r[0] * n[2], r[0] * n[1] - r[1] * n[0]];
    for (let j = 0; j < 3; j++) K[j] += cdf * Math.abs(rn[j]) ** 3 * area;
  }
  const c = cs.map((s, j) => (A[j] > 0 ? s.map((x) => x / A[j]) : [0, 0, 0]));
  return { A, c, K, Cd: Cd.slice() };
}

// Heave plates: { r: [x, y, z] equilibrium frame relative to G, D (m), Cd }. Plate added mass on the diagonal
// (heave, and roll/pitch by the parallel-axis rule plus the disc's own rotational added inertia); the heave–roll
// coupling of a plate off the vertical through G is neglected.
export function plateAddedMass(plates, rho) {
  const A = [0, 0, 0, 0, 0, 0];
  for (const p of plates) {
    const Ap = rho * p.D ** 3 / 3, Ar = rho * p.D ** 5 / 90;
    A[2] += Ap; A[3] += Ap * p.r[1] * p.r[1] + Ar; A[4] += Ap * p.r[0] * p.r[0] + Ar;
  }
  return A;
}
export const plateArea = (p) => Math.PI * p.D * p.D / 4;
// drag moment integral of a disc rotating about a diameter: ∫|x|³ dA = 8a⁵/15 (a = D/2)
export const plateRotK = (p) => 8 * (p.D / 2) ** 5 / 15;

// ------------------------------------------------------------------ time domain
// Hull + plate drag loads about G (world axes). E: world ← equilibrium-attached axes (R·R0ᵀ, row-major), p: G (world),
// v, w: body velocity and angular velocity (world), field: wave field, t: time, uc: [ux, uy] extra current (Stokes drift).
// acc: { aG, alpha } the body's accelerations (world) from the previous step. The simulator carries a plate's added
// mass in world heave (implicitly, for stability); when the plate tilts, its added-mass reaction acts along the plate
// normal instead, so the difference −A_p[(a·n)n − a_z ẑ] is applied here. Without it the wave-inertia force A_p a_f,n
// (along the tilted normal) would leave an unbalanced horizontal component.
// Also returns Fplate, the plates' share of F (the simulator filters its slow horizontal part like the Froude–Krylov one).
export function dragLoads(D, E, p, v, w, field, t, rho, uc = null, acc = null) {
  const F = [0, 0, 0], M = [0, 0, 0], Fplate = [0, 0, 0];
  const col = (j) => [E[j], E[3 + j], E[6 + j]];
  const toW = (r) => [E[0] * r[0] + E[1] * r[1] + E[2] * r[2], E[3] * r[0] + E[4] * r[1] + E[5] * r[2], E[6] * r[0] + E[7] * r[1] + E[8] * r[2]];
  const add = (rw, f) => { F[0] += f[0]; F[1] += f[1]; F[2] += f[2]; M[0] += rw[1] * f[2] - rw[2] * f[1]; M[1] += rw[2] * f[0] - rw[0] * f[2]; M[2] += rw[0] * f[1] - rw[1] * f[0]; };
  const g = D.geo;
  if (g) {
    for (let j = 0; j < 3; j++) {
      if (!(g.A[j] > 0) || !(g.Cd[j] > 0)) continue;
      const rw = toW(g.c[j]), e = col(j);
      const u = field && field.n ? field.velocity(p[0] + rw[0], p[1] + rw[1], p[2] + rw[2], t) : [0, 0, 0];
      if (uc) { u[0] += uc[0]; u[1] += uc[1]; }
      const ur = (u[0] - v[0]) * e[0] + (u[1] - v[1]) * e[1] + (u[2] - v[2]) * e[2];
      const fj = 0.5 * rho * g.Cd[j] * g.A[j] * Math.abs(ur) * ur;
      add(rw, [fj * e[0], fj * e[1], fj * e[2]]);
    }
    // rotational drag on the body's angular velocity (equilibrium-attached axes)
    const wE = [E[0] * w[0] + E[3] * w[1] + E[6] * w[2], E[1] * w[0] + E[4] * w[1] + E[7] * w[2], E[2] * w[0] + E[5] * w[1] + E[8] * w[2]];
    const mE = wE.map((x, j) => -0.5 * rho * g.K[j] * Math.abs(x) * x);
    const mW = toW(mE);
    M[0] += mW[0]; M[1] += mW[1]; M[2] += mW[2];
  }
  for (const pl of D.plates || []) {
    const rw = toW(pl.r), n = col(2);
    const pp = [p[0] + rw[0], p[1] + rw[1], p[2] + rw[2]];
    const vp = [v[0] + w[1] * rw[2] - w[2] * rw[1], v[1] + w[2] * rw[0] - w[0] * rw[2], v[2] + w[0] * rw[1] - w[1] * rw[0]];
    let un = 0, an = 0;
    if (field && field.n) {
      const u = field.velocity(pp[0], pp[1], pp[2], t), a = field.accel(pp[0], pp[1], pp[2], t);
      un = u[0] * n[0] + u[1] * n[1] + u[2] * n[2]; an = a[0] * n[0] + a[1] * n[1] + a[2] * n[2];
    }
    const urn = un - (vp[0] * n[0] + vp[1] * n[1] + vp[2] * n[2]);
    const Ap = rho * pl.D ** 3 / 3;
    const fn = Ap * an + 0.5 * rho * pl.Cd * plateArea(pl) * Math.abs(urn) * urn;
    const F0 = F.slice();
    add(rw, [fn * n[0], fn * n[1], fn * n[2]]);
    if (acc) {
      // plate acceleration a = a_G + α × r + ω × (ω × r); reaction along n instead of along world z
      const { aG, alpha } = acc, wr = [w[1] * rw[2] - w[2] * rw[1], w[2] * rw[0] - w[0] * rw[2], w[0] * rw[1] - w[1] * rw[0]];
      const a = [aG[0] + alpha[1] * rw[2] - alpha[2] * rw[1] + w[1] * wr[2] - w[2] * wr[1],
        aG[1] + alpha[2] * rw[0] - alpha[0] * rw[2] + w[2] * wr[0] - w[0] * wr[2],
        aG[2] + alpha[0] * rw[1] - alpha[1] * rw[0] + w[0] * wr[1] - w[1] * wr[0]];
      const abn = a[0] * n[0] + a[1] * n[1] + a[2] * n[2];
      add(rw, [-Ap * abn * n[0], -Ap * abn * n[1], -Ap * (abn * n[2] - a[2])]);
    }
    for (let k = 0; k < 3; k++) Fplate[k] += F[k] - F0[k];
    // the disc's own rotation about its diameters
    const wE = [E[0] * w[0] + E[3] * w[1] + E[6] * w[2], E[1] * w[0] + E[4] * w[1] + E[7] * w[2]];
    const k = 0.5 * rho * pl.Cd * plateRotK(pl);
    const mW = toW([-k * Math.abs(wE[0]) * wE[0], -k * Math.abs(wE[1]) * wE[1], 0]);
    M[0] += mW[0]; M[1] += mW[1]; M[2] += mW[2];
  }
  return { F, M, Fplate };
}

// ------------------------------------------------------------------ frequency domain (equivalent linearisation)
// Complex incident orbital velocity per unit wave amplitude at r (equilibrium frame relative to G, free surface at
// z = zw), deep water, η = e^{iωt} e^{−ik(x cosβ + y sinβ)}:  u = ω e^{k(z − zw)} e^{−ik·x} (cosβ, sinβ, i).
export function fluidVelocityC(w, betaDeg, r, zw) {
  const k = w * w / 9.80665, b = betaDeg * Math.PI / 180, cb = Math.cos(b), sb = Math.sin(b);
  const amp = w * Math.exp(k * Math.min(0, r[2] - zw)), ph = -k * (r[0] * cb + r[1] * sb);
  const re = amp * Math.cos(ph), im = amp * Math.sin(ph);
  return [[re * cb, im * cb], [re * sb, im * sb], [-im, re]];
}

// Drag "elements": each turns a relative velocity (one component of a point's velocity) into a linear damper.
//   { g: 6-vector of the generalized direction (force at point r along e: [e; r × e]), kind, coef = ½ρC_dA,
//     vel(w, beta, xi) → complex relative velocity, fluid(w, beta) → complex fluid velocity component }
export function dragElements(D, rho, zw) {
  const els = [];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const g = D.geo;
  if (g) {
    for (let j = 0; j < 3; j++) {
      if (!(g.A[j] > 0) || !(g.Cd[j] > 0)) continue;
      const e = [0, 0, 0]; e[j] = 1;
      // body velocity at G (as the time domain): only the translational DOF j
      const gv = [0, 0, 0, 0, 0, 0]; gv[j] = 1;
      els.push({ kind: `hull ${'xyz'[j]}`, coef: 0.5 * rho * g.Cd[j] * g.A[j], gf: [...e, ...cross(g.c[j], e)], gv, at: g.c[j], comp: j });
    }
    for (let j = 0; j < 3; j++) {
      if (!(g.K[j] > 0)) continue;
      const gv = [0, 0, 0, 0, 0, 0]; gv[3 + j] = 1;
      els.push({ kind: `hull r${'xyz'[j]}`, coef: 0.5 * rho * g.K[j], gf: gv.slice(), gv, at: null, comp: null });
    }
  }
  for (const pl of D.plates || []) {
    const n = [0, 0, 1], rn = cross(pl.r, n), gp = [...n, ...rn];
    els.push({ kind: 'plate', coef: 0.5 * rho * pl.Cd * plateArea(pl), gf: gp, gv: gp, at: pl.r, comp: 2, plate: pl });
    for (const j of [0, 1]) {
      const gv = [0, 0, 0, 0, 0, 0]; gv[3 + j] = 1;
      els.push({ kind: 'plate rot', coef: 0.5 * rho * pl.Cd * plateRotK(pl), gf: gv.slice(), gv, at: null, comp: null });
    }
  }
  return els;
}

const cAdd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const cScale = (a, s) => [a[0] * s, a[1] * s];
// relative velocity of element e: fluid − gvᵀ (iω ξ)
function relVel(e, w, beta, xi, zw) {
  let vr = [0, 0], vi = [0, 0];
  for (let j = 0; j < 6; j++) if (e.gv[j]) vi = cAdd(vi, cScale(xi[j], e.gv[j]));
  const vb = [-w * vi[1], w * vi[0]];   // iω × vi
  if (e.at) { const u = fluidVelocityC(w, beta, e.at, zw)[e.comp]; vr = u; }
  return [vr[0] - vb[0], vr[1] - vb[1]];
}
// Linear damping matrix and excitation (per unit wave amplitude) of the elements with equivalent coefficients Beq.
// Heave plates also add their inertia excitation A_p·iω·u_n.
export function dragLinear(els, Beq, w, beta, zw, rho) {
  const B = Array.from({ length: 6 }, () => new Array(6).fill(0)), X = Array.from({ length: 6 }, () => [0, 0]);
  els.forEach((e, i) => {
    const b = Beq[i] || 0;
    for (let r = 0; r < 6; r++) if (e.gf[r]) for (let c = 0; c < 6; c++) if (e.gv[c]) B[r][c] += b * e.gf[r] * e.gv[c];
    if (e.at) {
      const u = fluidVelocityC(w, beta, e.at, zw)[e.comp];
      let f = cScale(u, b);
      if (e.plate) { const Ap = rho * e.plate.D ** 3 / 3; f = cAdd(f, [-w * Ap * u[1], w * Ap * u[0]]); }
      for (let r = 0; r < 6; r++) if (e.gf[r]) X[r] = cAdd(X[r], cScale(f, e.gf[r]));
    }
  });
  return { B, X };
}

// Equivalent linear coefficients for a sea state. solve(w, Beq) → ξ (6 complex) at frequency w for heading beta.
//   sea: { kind: 'spectrum', S(w), omegas (integration grid) } or { kind: 'regular', A, w }
// Returns per-element Beq (and the relative-velocity σ or amplitude), iterating to a fixed point.
export function linearizeDrag(els, sea, beta, solve, zw, { iters = 100, tol = 1e-5 } = {}) {
  const K8 = Math.sqrt(8 / Math.PI), K3 = 8 / (3 * Math.PI), Kf = sea.kind === 'regular' ? K3 : K8;
  // start from the damping the incident flow alone would give (relative velocity = wave orbital velocity): starting
  // from zero would put an undamped resonance at an infinite response
  let uWave;
  if (sea.kind === 'regular') uWave = sea.A * sea.w;
  else {
    let m = 0; const ws = sea.omegas;
    for (let q = 1; q < ws.length; q++) m += 0.5 * (ws[q] ** 2 * sea.S(ws[q]) + ws[q - 1] ** 2 * sea.S(ws[q - 1])) * (ws[q] - ws[q - 1]);
    uWave = Math.sqrt(Math.max(0, m));
  }
  let Beq = els.map((e) => e.coef * Kf * uWave);
  let stat = els.map(() => 0), it = 0, converged = !els.length;
  const measure = (B) => {
    if (sea.kind === 'regular') {
      const xi = solve(sea.w, B);
      return els.map((e) => sea.A * Math.hypot(...relVel(e, sea.w, beta, xi, zw)));
    }
    const m0 = els.map(() => 0), ws = sea.omegas;
    let prev = null;
    for (let q = 0; q < ws.length; q++) {
      const xi = solve(ws[q], B), S = sea.S(ws[q]);
      const cur = els.map((e) => { const r = relVel(e, ws[q], beta, xi, zw); return (r[0] * r[0] + r[1] * r[1]) * S; });
      if (prev) { const dw = ws[q] - ws[q - 1]; for (let i = 0; i < els.length; i++) m0[i] += 0.5 * (prev[i] + cur[i]) * dw; }
      prev = cur;
    }
    return m0.map((x) => Math.sqrt(Math.max(0, x)));
  };
  for (; it < iters && els.length; it++) {
    stat = measure(Beq);
    const next = els.map((e, i) => e.coef * Kf * stat[i]);
    const change = Math.max(0, ...next.map((b, i) => Math.abs(b - Beq[i]) / Math.max(1e-300, b, Beq[i])));
    if (change < tol) { Beq = next; converged = true; break; }
    // the damping and the response depend on each other (B larger → response smaller): relax in log space
    // (geometric mean), which recovers quickly from a start that is orders of magnitude off
    Beq = next.map((b, i) => (b > 0 && Beq[i] > 0 ? Math.sqrt(b * Beq[i]) : b));
  }
  return { Beq, stat, iters: it, converged };
}
