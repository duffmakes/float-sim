// Mooring lines: quasi-static elastic catenary and a dynamic lumped-mass line. Pure math, no rendering.
//
// References
//  [JON]  Jonkman (2007), Dynamics Modeling and Loads Analysis of an Offshore Floating Wind Turbine, NREL/TP-500-41958,
//         §4.2.3: elastic catenary with seabed contact (also MAP++, Masciola et al. 2013). Seabed friction is not modelled.
//  [PG]   Peyrot & Goulois (1979), initial guess for the catenary iteration (as used in [JON] and MAP++).
//  [FAL]  Faltinsen (1990), Sea Loads on Ships and Offshore Structures, §8.2: inextensible catenary, eq. 8.12–8.17.
//  [HALL] Hall & Goupee (2015), Validation of a lumped-mass mooring line model with DeepCwind semisubmersible model test
//         data, Ocean Engineering 104 (MoorDyn): node masses, axial stiffness and strain-rate damping, Morison drag with
//         normal and tangential coefficients, normal added mass, seabed as a spring-damper.
//  [DNV]  DNV-OS-E301 / Orcina line-type guidance: studless chain mass ≈ 19.9 D² t/m and EA ≈ 0.854·10⁸ D² kN (D in m),
//         volume-equivalent diameter 1.8 D. Rope values below are typical; check the manufacturer's data.

const G = 9.80665;

// Line presets: m = mass per length in air (kg/m), rhoM = material density (kg/m³, for buoyancy), EA (N),
// d = volume-equivalent hydrodynamic diameter (m, for drag and added mass), Cdn / Cdt normal / tangential drag.
export const LINE_PRESETS = {
  chain10: { label: 'Studless chain 10 mm', m: 1.99, rhoM: 7850, EA: 8.54e6, d: 0.018, Cdn: 1.6, Cdt: 0.8 },
  chain6: { label: 'Studless chain 6 mm', m: 0.72, rhoM: 7850, EA: 3.07e6, d: 0.0108, Cdn: 1.6, Cdt: 0.8 },
  chain16: { label: 'Studless chain 16 mm', m: 5.09, rhoM: 7850, EA: 2.19e7, d: 0.0288, Cdn: 1.6, Cdt: 0.8 },
  wire6: { label: 'Steel wire rope 6 mm', m: 0.15, rhoM: 7850, EA: 1.6e6, d: 0.006, Cdn: 1.2, Cdt: 0.01 },
  poly12: { label: 'Polyester rope 12 mm', m: 0.11, rhoM: 1380, EA: 5.0e5, d: 0.012, Cdn: 1.2, Cdt: 0.01 },
  nylon12: { label: 'Nylon rope 12 mm', m: 0.09, rhoM: 1140, EA: 1.5e5, d: 0.012, Cdn: 1.2, Cdt: 0.01 },
  dyneema8: { label: 'Dyneema (HMPE) rope 8 mm', m: 0.04, rhoM: 975, EA: 1.5e6, d: 0.008, Cdn: 1.2, Cdt: 0.01 },
};

// Submerged weight per length (N/m) from mass per length and material density.
export const submergedWeight = (m, rhoM, rho) => m * G * (1 - rho / rhoM);

// ------------------------------------------------------------------ quasi-static elastic catenary [JON]
// Line from an anchor on the seabed to a fairlead XF metres away horizontally and ZF metres above the anchor.
// L unstretched length (m), w submerged weight per length (N/m), EA axial stiffness (N). No seabed friction.
// Returns the fairlead tension components H (horizontal, toward the anchor) and V (vertical, downward pull on the
// fairlead), the anchor loads HA, VA, the length resting on the seabed LB and the regime:
//   'taut' (no seabed contact), 'touchdown' (part of the line on the seabed), 'slack' (H = 0: the line hangs
//   vertically from the fairlead and the rest lies on the seabed), 'straight' (weightless or buoyant line, as an
//   elastic straight rope, zero tension when slack).
function catXZ(H, V, L, w, EA) {
  // fairlead span for given (H, V): [JON] eq. 4.13–4.16 (C_B = 0)
  const r = V / H;
  if (V >= w * L) {
    const ra = (V - w * L) / H;
    return [(H / w) * (Math.asinh(r) - Math.asinh(ra)) + H * L / EA,
      (H / w) * (Math.sqrt(1 + r * r) - Math.sqrt(1 + ra * ra)) + (V * L - 0.5 * w * L * L) / EA];
  }
  const LB = L - V / w;
  return [LB + (H / w) * Math.asinh(r) + H * L / EA, (H / w) * (Math.sqrt(1 + r * r) - 1) + V * V / (2 * EA * w)];
}

export function catenary(XF, ZF, L, w, EA, guess = null) {
  XF = Math.max(0, XF);
  const dist = Math.hypot(XF, ZF);
  if (!(w * L > 1e-12 * EA) || !(ZF > 1e-9)) {
    // weightless/buoyant line, or a fairlead at the seabed: straight elastic rope
    const T = dist > L ? EA * (dist - L) / L : 0;
    return { H: dist > 0 ? T * XF / dist : 0, V: dist > 0 ? T * ZF / dist : 0, HA: dist > 0 ? T * XF / dist : 0, VA: dist > 0 ? T * ZF / dist : 0, LB: 0, regime: 'straight', ok: true };
  }
  // slack: with H = 0 the line hangs straight down over ZF (stretching under its own weight); if the rest of it can
  // lie on the seabed between the anchor and the point under the fairlead, nothing pulls sideways
  const Vh = -EA + Math.sqrt(EA * EA + 2 * EA * w * ZF);   // ZF = V/w + V²/(2EAw)
  if (Vh / w <= L && XF <= L - Vh / w) return { H: 0, V: Vh, HA: 0, VA: 0, LB: L - Vh / w, regime: 'slack', ok: true };
  let H, V;
  if (guess && guess.H > 0 && Number.isFinite(guess.V)) ({ H, V } = guess);
  else {
    // Peyrot & Goulois initial guess [PG]
    let lam;
    if (XF === 0) lam = 1e6;
    else if (dist >= L) lam = 0.2;
    else lam = Math.sqrt(3 * ((L * L - ZF * ZF) / (XF * XF) - 1));
    H = Math.max(Math.abs(w * XF / (2 * lam)), 1e-6 * w * L);
    V = (w / 2) * (ZF / Math.tanh(lam) + L);
  }
  const scale = Math.max(XF, ZF, 1e-9);
  let ok = false;
  for (let it = 0; it < 100; it++) {
    const [x, z] = catXZ(H, V, L, w, EA);
    const fx = x - XF, fz = z - ZF;
    if (Math.abs(fx) < 1e-10 * scale && Math.abs(fz) < 1e-10 * scale) { ok = true; break; }
    // numerical Jacobian (central differences)
    const dh = 1e-6 * Math.max(H, 1e-3 * w * L), dv = 1e-6 * Math.max(Math.abs(V), 1e-3 * w * L);
    const [xh1, zh1] = catXZ(H + dh, V, L, w, EA), [xh0, zh0] = catXZ(Math.max(H - dh, 1e-12), V, L, w, EA);
    const [xv1, zv1] = catXZ(H, V + dv, L, w, EA), [xv0, zv0] = catXZ(H, V - dv, L, w, EA);
    const hL = H + dh - Math.max(H - dh, 1e-12);
    const J11 = (xh1 - xh0) / hL, J21 = (zh1 - zh0) / hL, J12 = (xv1 - xv0) / (2 * dv), J22 = (zv1 - zv0) / (2 * dv);
    const det = J11 * J22 - J12 * J21;
    if (!(Math.abs(det) > 0)) break;
    let sH = -(J22 * fx - J12 * fz) / det, sV = -(-J21 * fx + J11 * fz) / det;
    // keep H positive and the step modest (the catenary functions are steep near H = 0)
    let a = 1;
    while (H + a * sH <= 0.02 * H && a > 1e-6) a *= 0.5;
    const cap = 0.5 * (Math.abs(V) + w * L);
    if (Math.abs(a * sV) > cap) a *= cap / Math.abs(a * sV);
    H += a * sH; V += a * sV;
  }
  const LB = V < w * L ? L - V / w : 0;
  return { H, V, HA: H, VA: Math.max(0, V - w * L), LB, regime: LB > 0 ? 'touchdown' : 'taut', ok };
}

// Points along the line in its vertical plane, from the anchor (s = 0) to the fairlead: [x, z] relative to the anchor.
export function catenaryShape(sol, XF, ZF, L, w, EA, n = 40) {
  const pts = [];
  if (sol.regime === 'straight') {
    const dist = Math.hypot(XF, ZF);
    if (dist >= L) { for (let i = 0; i <= n; i++) pts.push([XF * i / n, ZF * i / n]); return pts; }
    // slack weightless rope: draw it sagging onto the seabed (indicative only)
    const sag = Math.sqrt(Math.max(0, L * L - dist * dist)) / 2;
    for (let i = 0; i <= n; i++) { const t = i / n; pts.push([XF * t, Math.max(0, ZF * t - sag * 4 * t * (1 - t))]); }
    return pts;
  }
  const { H, V } = sol;
  if (sol.regime === 'slack') {
    const hang = V / w;
    // seabed part (shown straight up to the point under the fairlead, the excess is piled there), then vertical
    pts.push([0, 0], [XF, 0]);
    for (let i = 1; i <= n; i++) { const s = hang * i / n; pts.push([XF, s + w * s * s / (2 * EA)]); }
    return pts;
  }
  const VA = Math.max(0, V - w * L), LB = sol.LB;
  if (LB > 0) {
    pts.push([0, 0], [LB, 0]);
    const Ls = L - LB;
    for (let i = 1; i <= n; i++) {
      const s = Ls * i / n, q = w * s / H;
      pts.push([LB + (H / w) * Math.asinh(q) + H * s / EA, (H / w) * (Math.sqrt(1 + q * q) - 1) + w * s * s / (2 * EA)]);
    }
    return pts;
  }
  for (let i = 0; i <= n; i++) {
    const s = L * i / n, qa = VA / H, q = (VA + w * s) / H;
    pts.push([(H / w) * (Math.asinh(q) - Math.asinh(qa)) + H * s / EA,
      (H / w) * (Math.sqrt(1 + q * q) - Math.sqrt(1 + qa * qa)) + (VA * s + 0.5 * w * s * s) / EA]);
  }
  return pts;
}

// ------------------------------------------------------------------ a mooring system (lines sharing one fairlead)
// cfg: { depth (anchor depth below still water, m), lines: [{ anchor: [x, y] world (m) }], fairlead: [x, y, z] body frame
// relative to G, L, m, rhoM, EA, d, Cdn, Cdt, Can, nSeg, model: 'quasi' | 'dynamic' }, rho
export function lineProps(cfg, rho) {
  const w = submergedWeight(cfg.m, cfg.rhoM, rho);
  return { w, L: cfg.L, EA: cfg.EA };
}

// Force on the body from one quasi-static line with the fairlead at world point F (z up, still water z = 0).
export function quasiStaticForce(cfg, anchor, F, rho, guess = null) {
  const { w, L, EA } = lineProps(cfg, rho);
  const dx = F[0] - anchor[0], dy = F[1] - anchor[1], XF = Math.hypot(dx, dy), ZF = F[2] + cfg.depth;
  const sol = catenary(XF, ZF, L, w, EA, guess);
  const ex = XF > 1e-12 ? dx / XF : 0, ey = XF > 1e-12 ? dy / XF : 0;
  return { F: [-sol.H * ex, -sol.H * ey, -sol.V], T: Math.hypot(sol.H, sol.V), sol, XF, ZF, ex, ey };
}

// Total line force on the body (world) and its moment about G for a fairlead at world point Fw, G at world Gw.
export function mooringLoads(cfg, rho, Fw, Gw, guesses = null) {
  const F = [0, 0, 0], sols = [];
  cfg.lines.forEach((ln, i) => {
    const r = quasiStaticForce(cfg, ln.anchor, Fw, rho, guesses ? guesses[i] : null);
    for (let k = 0; k < 3; k++) F[k] += r.F[k];
    sols.push(r);
  });
  const r = [Fw[0] - Gw[0], Fw[1] - Gw[1], Fw[2] - Gw[2]];
  return { F, M: [r[1] * F[2] - r[2] * F[1], r[2] * F[0] - r[0] * F[2], r[0] * F[1] - r[1] * F[0]], sols };
}

// 6×6 linear mooring stiffness about G (equilibrium world axes), for small displacements of the body: translations
// and small rotations θ (fairlead moves by δx + θ × r). K_f = −∂F/∂x_f by central differences of the catenary;
//   K = [[K_f, −K_f[r×]], [[r×]K_f, −[r×]K_f[r×] − [F×][r×]]]
// where the last term is the geometric stiffness of the line tension acting at the lever arm r (G → fairlead).
export function mooringStiffness(cfg, rho, Fw, Gw) {
  const h = 1e-4 * Math.max(1, cfg.depth * 0.01);
  const base = mooringLoads(cfg, rho, Fw, Gw);
  const Kf = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let j = 0; j < 3; j++) {
    const p = Fw.slice(), m = Fw.slice(); p[j] += h; m[j] -= h;
    const Fp = mooringLoads(cfg, rho, p, Gw).F, Fm = mooringLoads(cfg, rho, m, Gw).F;
    for (let i = 0; i < 3; i++) Kf[i][j] = -(Fp[i] - Fm[i]) / (2 * h);
  }
  const r = [Fw[0] - Gw[0], Fw[1] - Gw[1], Fw[2] - Gw[2]];
  const cross = (a) => [[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]];
  const mm = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
  const R = cross(r), Fx = cross(base.F);
  const KfR = mm(Kf, R), RKf = mm(R, Kf), RKfR = mm(RKf, R), FR = mm(Fx, R);
  const K = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    K[i][j] = Kf[i][j];
    K[i][3 + j] = -KfR[i][j];
    K[3 + i][j] = RKf[i][j];
    K[3 + i][3 + j] = -RKfR[i][j] - FR[i][j];
  }
  return { K, Kf, F: base.F, M: base.M, sols: base.sols };
}

// Horizontal static equilibrium of the fairlead under a steady external horizontal force Fext (world, N) on the
// body: solves F_line,h(x) + Fext = 0 for the horizontal offset of the body (damped Newton with the catenary
// stiffness and a backtracking line search; where every line is slack the stiffness is zero, so steps are capped).
// A single line with nothing pushing ends at the slack limit (zero horizontal tension). Returns the offset [dx, dy]
// and the loads and stiffness there. Vertical and rotational equilibrium are not re-solved.
export function mooringOffset(cfg, rho, Fw0, Gw0, Fext = [0, 0]) {
  let dx = 0, dy = 0;
  const at = (x, y) => mooringStiffness(cfg, rho, [Fw0[0] + x, Fw0[1] + y, Fw0[2]], [Gw0[0] + x, Gw0[1] + y, Gw0[2]]);
  const resid = (s) => [s.F[0] + Fext[0], s.F[1] + Fext[1]];
  let s = at(0, 0), r = resid(s);
  const scaleF = 1 + Math.hypot(...Fext) + cfg.lines.length * Math.max(...s.sols.map((q) => q.T), 0);
  const cap = 0.25 * Math.max(cfg.depth, 0.1 * cfg.L);
  for (let it = 0; it < 200; it++) {
    const rn = Math.hypot(...r);
    if (rn < 1e-7 * scaleF) return { offset: [dx, dy], ...s, converged: true };
    let a = s.Kf[0][0], b = s.Kf[0][1], c = s.Kf[1][0], d = s.Kf[1][1];
    const kmin = 1e-3 * rn / cap;   // a zero-stiffness (slack) direction takes a capped step along the residual
    a = Math.max(a, kmin); d = Math.max(d, kmin);
    const det = a * d - b * c;
    let sx = det > 0 ? (d * r[0] - b * r[1]) / det : r[0] / kmin, sy = det > 0 ? (-c * r[0] + a * r[1]) / det : r[1] / kmin;
    const len = Math.hypot(sx, sy); if (len > cap) { sx *= cap / len; sy *= cap / len; }
    // backtrack until the residual does not grow (in a slack region it stays flat until a line lifts)
    let lam = 1, sn, rr;
    for (let k = 0; k < 20; k++) {
      sn = at(dx + lam * sx, dy + lam * sy); rr = resid(sn);
      if (Math.hypot(...rr) <= rn * (1 + 1e-12)) break;
      lam *= 0.5;
    }
    dx += lam * sx; dy += lam * sy; s = sn; r = rr;
  }
  return { offset: [dx, dy], ...s, converged: Math.hypot(...r) < 1e-4 * scaleF };
}

// Anchors for n lines spread evenly in azimuth, the first along dirDeg (from model +X), at horizontal radius R from
// the fairlead's rest position (world xy).
export function anchorLayout(n, R, dirDeg, F0) {
  return Array.from({ length: n }, (_, i) => {
    const a = (dirDeg + 360 * i / n) * Math.PI / 180;
    return { anchor: [F0[0] + R * Math.cos(a), F0[1] + R * Math.sin(a)] };
  });
}

// ------------------------------------------------------------------ dynamic lumped-mass line [HALL]
// N segments between the anchor (node 0, fixed on the seabed) and the fairlead (node N, moved with the body).
// Internal nodes carry the segment mass, normal added mass, submerged weight, Morison drag (normal and tangential,
// relative to the wave orbital velocity), and seabed contact. Segments take tension only (EA·strain, zero when
// slack), with strain-rate damping. Explicit sub-stepping resolves the axial wave speed √(EA/m).
export class LumpedLine {
  constructor({ cfg, anchor, rho, fairleadWorld, field = null, nSeg = 16 }) {
    this.cfg = cfg; this.rho = rho; this.field = field;
    const N = this.N = Math.max(2, Math.round(nSeg));
    this.ell = cfg.L / N;
    this.w = submergedWeight(cfg.m, cfg.rhoM, rho);
    this.zBed = -cfg.depth;
    this.anchor = [anchor[0], anchor[1], this.zBed];
    this.r = new Float64Array(3 * (N + 1)); this.v = new Float64Array(3 * (N + 1));
    this.uf = new Float64Array(3 * (N + 1));
    // initial shape: the quasi-static catenary at equal unstretched arc length
    const q = quasiStaticForce(cfg, anchor, fairleadWorld, rho);
    this.placeOnCatenary(q, fairleadWorld);
    // explicit sub-step: dt = α ℓ/c (c = √(EA/m) the axial wave speed). With strain-rate damping ζ of critical per
    // segment, the alternating (highest) axial mode of the chain of nodes is stable for ζ·α < 0.25 (symplectic Euler);
    // α = 0.3, ζ = 0.5 gives 0.15. The damping only acts on fast axial vibration; slow motions are unaffected.
    const c = Math.sqrt(cfg.EA / cfg.m);
    this.dtMax = 0.3 * this.ell / c;
    this.BA = 0.5 * 2 * Math.sqrt(cfg.EA * cfg.m) * this.ell;   // N·s (force = BA · strain rate)
    this.kBed = 3e6; this.cBed = 3e5;   // seabed stiffness (Pa/m) and damping (Pa·s/m) per contact area d·ℓ (MoorDyn defaults)
    this.Ffair = [0, 0, 0]; this.Tfair = 0; this.Tanchor = 0; this.minT = Infinity; this.maxT = 0; this.slack = false;
    this.segT = new Float64Array(N);
  }

  placeOnCatenary(q, Fw) {
    const { N } = this, cfg = this.cfg, { w, L, EA } = lineProps(cfg, this.rho);
    const sol = q.sol, ex = q.ex, ey = q.ey, A = this.anchor;
    // arc-length parametrisation of the catenary (unstretched s from the anchor)
    const at = (s) => {
      if (sol.regime === 'straight' || !(sol.H > 0)) {
        if (sol.regime === 'slack') {
          const hang = sol.V / w, LB = L - hang;
          if (s <= LB) { const f = Math.min(1, s / Math.max(LB, 1e-9)); return [q.XF * f, 0]; }
          const u = s - LB; return [q.XF, u + w * u * u / (2 * EA)];
        }
        const f = s / L; return [q.XF * f, q.ZF * f];
      }
      if (sol.LB > 0) {
        if (s <= sol.LB) return [s * (1 + sol.H / EA), 0];
        const u = s - sol.LB, k = w * u / sol.H;
        return [sol.LB + (sol.H / w) * Math.asinh(k) + sol.H * u / EA, (sol.H / w) * (Math.sqrt(1 + k * k) - 1) + w * u * u / (2 * EA)];
      }
      const VA = sol.V - w * L, qa = VA / sol.H, k = (VA + w * s) / sol.H;
      return [(sol.H / w) * (Math.asinh(k) - Math.asinh(qa)) + sol.H * s / EA,
        (sol.H / w) * (Math.sqrt(1 + k * k) - Math.sqrt(1 + qa * qa)) + (VA * s + 0.5 * w * s * s) / EA];
    };
    for (let i = 0; i <= N; i++) {
      const [x, z] = at(L * i / N);
      this.r[3 * i] = A[0] + ex * x; this.r[3 * i + 1] = A[1] + ey * x; this.r[3 * i + 2] = A[2] + z;
    }
    // exact end points
    this.r.set(A, 0); this.r.set(Fw, 3 * N);
    this.v.fill(0);
  }

  // Fluid velocity at the nodes (refreshed once per body step: it varies on the wave time scale).
  updateFluid(t) {
    const f = this.field;
    if (!f || !f.n) { this.uf.fill(0); return; }
    for (let i = 1; i < this.N; i++) {
      const u = f.velocity(this.r[3 * i], this.r[3 * i + 1], this.r[3 * i + 2], t);
      this.uf[3 * i] = u[0]; this.uf[3 * i + 1] = u[1]; this.uf[3 * i + 2] = u[2];
    }
  }

  // Advance the line over a body step of length dt while the fairlead moves from Fw0 at velocity vF (linear in time).
  // Returns the force on the body (time-averaged over the step) and records tension extremes.
  advance(dt, Fw0, vF, t, extraDamp = 0) {
    const n = Math.max(1, Math.ceil(dt / this.dtMax)), h = dt / n;
    const N = this.N, r = this.r, v = this.v, cfg = this.cfg, ell = this.ell, rho = this.rho;
    const mNode = cfg.m * ell, Anorm = cfg.Can * rho * Math.PI * cfg.d * cfg.d / 4 * ell;
    const wNode = this.w * ell, dragN = 0.5 * rho * cfg.Cdn * cfg.d * ell, dragT = 0.5 * rho * cfg.Cdt * Math.PI * cfg.d * ell;
    const bedA = cfg.d * ell, EA = cfg.EA, BA = this.BA;
    this.updateFluid(t);
    const T = this.segT, ux = new Float64Array(3 * N);   // unit vectors node i → i+1
    const F = new Float64Array(3 * (N + 1));
    const Favg = [0, 0, 0];
    let Tmin = Infinity, Tmax = 0;
    for (let s = 0; s < n; s++) {
      const tau = (s + 1) * h;
      // fairlead node follows the body
      r[3 * N] = Fw0[0] + vF[0] * tau; r[3 * N + 1] = Fw0[1] + vF[1] * tau; r[3 * N + 2] = Fw0[2] + vF[2] * tau;
      v[3 * N] = vF[0]; v[3 * N + 1] = vF[1]; v[3 * N + 2] = vF[2];
      // segment tensions (tension only) with strain-rate damping
      for (let j = 0; j < N; j++) {
        const a = 3 * j, b = 3 * (j + 1);
        const dx = r[b] - r[a], dy = r[b + 1] - r[a + 1], dz = r[b + 2] - r[a + 2];
        const l = Math.hypot(dx, dy, dz) || 1e-12;
        const e0 = dx / l, e1 = dy / l, e2 = dz / l;
        ux[a] = e0; ux[a + 1] = e1; ux[a + 2] = e2;
        const strain = (l - ell) / ell;
        let Tj = 0;
        if (strain > 0) {
          const ldot = (v[b] - v[a]) * e0 + (v[b + 1] - v[a + 1]) * e1 + (v[b + 2] - v[a + 2]) * e2;
          Tj = Math.max(0, EA * strain + BA * ldot / ell);
        }
        T[j] = Tj;
      }
      F.fill(0);
      for (let i = 1; i < N; i++) {
        const o = 3 * i, a = 3 * (i - 1);
        // tension from both neighbouring segments
        F[o] += T[i] * ux[o] - T[i - 1] * ux[a];
        F[o + 1] += T[i] * ux[o + 1] - T[i - 1] * ux[a + 1];
        F[o + 2] += T[i] * ux[o + 2] - T[i - 1] * ux[a + 2] - wNode;
        // local tangent (average of the two segment directions)
        let q0 = ux[a] + ux[o], q1 = ux[a + 1] + ux[o + 1], q2 = ux[a + 2] + ux[o + 2];
        const ql = Math.hypot(q0, q1, q2) || 1; q0 /= ql; q1 /= ql; q2 /= ql;
        // Morison drag on the velocity relative to the water
        const rx = this.uf[o] - v[o], ry = this.uf[o + 1] - v[o + 1], rz = this.uf[o + 2] - v[o + 2];
        const vt = rx * q0 + ry * q1 + rz * q2, nx = rx - vt * q0, ny = ry - vt * q1, nz = rz - vt * q2, vn = Math.hypot(nx, ny, nz);
        F[o] += dragN * vn * nx + dragT * Math.abs(vt) * vt * q0;
        F[o + 1] += dragN * vn * ny + dragT * Math.abs(vt) * vt * q1;
        F[o + 2] += dragN * vn * nz + dragT * Math.abs(vt) * vt * q2;
        if (extraDamp > 0) { F[o] -= extraDamp * mNode * v[o]; F[o + 1] -= extraDamp * mNode * v[o + 1]; F[o + 2] -= extraDamp * mNode * v[o + 2]; }
        // seabed contact
        const pen = this.zBed - r[o + 2];
        if (pen > 0) F[o + 2] += (this.kBed * pen - this.cBed * v[o + 2]) * bedA;
        // M⁻¹ with normal added mass:  M = m I + A_n (I − q qᵀ)  ⇒  M⁻¹ = (I − q qᵀ)/(m + A_n) + q qᵀ/m
        const fq = F[o] * q0 + F[o + 1] * q1 + F[o + 2] * q2, inN = 1 / (mNode + Anorm), inT = 1 / mNode;
        const ax = (F[o] - fq * q0) * inN + fq * q0 * inT, ay = (F[o + 1] - fq * q1) * inN + fq * q1 * inT, az = (F[o + 2] - fq * q2) * inN + fq * q2 * inT;
        v[o] += ax * h; v[o + 1] += ay * h; v[o + 2] += az * h;
      }
      for (let i = 1; i < N; i++) { const o = 3 * i; r[o] += v[o] * h; r[o + 1] += v[o + 1] * h; r[o + 2] += v[o + 2] * h; }
      // force on the body: the last segment pulls the fairlead toward the line, plus the half-segment weight
      const a = 3 * (N - 1), TN = T[N - 1];
      Favg[0] -= TN * ux[a]; Favg[1] -= TN * ux[a + 1]; Favg[2] -= TN * ux[a + 2] + 0.5 * wNode;
      Tmin = Math.min(Tmin, TN); Tmax = Math.max(Tmax, TN);
    }
    for (let k = 0; k < 3; k++) Favg[k] /= n;
    this.Ffair = Favg; this.Tfair = Math.hypot(...Favg); this.Tanchor = T[0];
    this.stepMinT = Tmin; this.stepMaxT = Tmax;
    return Favg;
  }

  // Let the line come to rest with the fairlead held at Fw (artificial damping), to remove the start-up transient.
  relax(Fw, seconds = 20) {
    // in still water: the runs ramp the waves up from calm
    const f = this.field; this.field = null;
    const steps = Math.ceil(seconds / 0.05);
    for (let i = 0; i < steps; i++) this.advance(0.05, Fw, [0, 0, 0], 0, 2.0);
    this.field = f;
  }

  points() { return this.r; }
}
