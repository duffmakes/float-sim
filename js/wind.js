// Wind on the above-water part of the body: mean profile, gust spectrum and windage loads. Pure math, no rendering.
//
// References
//  [DNV]  DNV-RP-C205 Environmental Conditions and Environmental Loads (2010), §2.3: power-law profile
//         U(z) = U₁₀ (z/10)^α with α ≈ 0.12 over open sea with waves (Table 2-1 range 0.11–0.14), and the Frøya (NPD)
//         spectrum of the longitudinal gusts for a 1-hour mean U₀ at 10 m (eq. 2.21, Andersen & Løvseth):
//           S(f) = 320 (U₀/10)² (z/10)^0.45 / (1 + f̃ⁿ)^(5/(3n)),  f̃ = 172 f (z/10)^(2/3) (U₀/10)^(−0.75),  n = 0.468
//         S in m²/s (per Hz).
//  [HOE]  Hoerner (1965) Fluid-Dynamic Drag: bluff-body drag coefficients on the projected area.
// Windage: every dry panel (above the instantaneous wave surface) takes ½ρ_a C_d a⊥ |u_r| u_r, with a⊥ its area
// projected normal to the wind relative to the panel (front and back faces count half each, so the sum is the
// projected area) and u_r the wind at the panel's height minus the panel's velocity (this includes aerodynamic
// damping). Gusts are taken as fully coherent over the body, which is small compared with the gust length scales.

import { rng } from './waves.js';

export const RHO_AIR = 1.225;
export const PROFILE_ALPHA = 0.12;
export const Z_FLOOR = 0.1;   // the power law is not used below 0.1 m above the still-water level

export const windAt = (U10, z, alpha = PROFILE_ALPHA) => U10 * Math.pow(Math.max(z, Z_FLOOR) / 10, alpha);

export function froyaSpectrum(f, U10, z) {
  if (!(f > 0) || !(U10 > 0)) return 0;
  const n = 0.468, zz = Math.max(z, Z_FLOOR) / 10, ft = 172 * f * Math.pow(zz, 2 / 3) * Math.pow(U10 / 10, -0.75);
  return 320 * (U10 / 10) ** 2 * Math.pow(zz, 0.45) / Math.pow(1 + Math.pow(ft, n), 5 / (3 * n));
}
// Variance of the Frøya spectrum in closed form: ∫(1 + x^n)^(−p) dx = B(1/n, p − 1/n)/n with x = f̃, p = 5/(3n).
export function froyaVariance(U10, z) {
  const n = 0.468, p = 5 / (3 * n), zz = Math.max(z, Z_FLOOR) / 10;
  const lgam = (x) => {   // Lanczos log-gamma
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015;
    for (const ci of c) s += ci / ++y;
    return -t + Math.log(2.5066282746310005 * s / x);
  };
  const B = Math.exp(lgam(1 / n) + lgam(p - 1 / n) - lgam(p));
  const scale = 172 * Math.pow(zz, 2 / 3) * Math.pow(U10 / 10, -0.75);   // f̃ = scale·f
  return 320 * (U10 / 10) ** 2 * Math.pow(zz, 0.45) * (B / n) / scale;
}

// Wind: steady mean profile plus optional gusts (random-phase sum over the Frøya spectrum at height zRef).
// dirDeg: direction the wind blows TOWARD, from model +X counter-clockwise (same convention as the wave heading β).
export class WindField {
  constructor({ U10 = 0, dirDeg = 90, gusts = false, seed = 7, zRef = 1, N = 120, fLo = 1 / 1200, fHi = 0.5, alpha = PROFILE_ALPHA }) {
    this.U10 = U10; this.alpha = alpha; this.dir = dirDeg;
    const d = dirDeg * Math.PI / 180;
    this.ex = Math.cos(d); this.ey = Math.sin(d);
    this.a = []; this.w = []; this.phi = [];
    this.scale = 1;
    if (gusts && U10 > 0) {
      // log-spaced bins; amplitude √(2 S(f) Δf) at a random frequency inside each bin
      const r = rng(seed), l0 = Math.log(fLo), l1 = Math.log(fHi);
      for (let i = 0; i < N; i++) {
        const fa = Math.exp(l0 + (l1 - l0) * i / N), fb = Math.exp(l0 + (l1 - l0) * (i + 1) / N), f = fa + r() * (fb - fa);
        this.a.push(Math.sqrt(2 * froyaSpectrum(f, U10, zRef) * (fb - fa))); this.w.push(2 * Math.PI * f); this.phi.push(2 * Math.PI * r());
      }
    }
    this.zRef = zRef;
    this.sigma = Math.sqrt(this.a.reduce((s, x) => s + x * x / 2, 0));
  }
  gust(t) { let u = 0; for (let i = 0; i < this.a.length; i++) u += this.a[i] * Math.cos(this.w[i] * t + this.phi[i]); return u; }
  // wind speed along the wind direction at height z (still-water level z = 0)
  speed(z, t, g = null) { return this.scale * (windAt(this.U10, z, this.alpha) + (g === null ? this.gust(t) : g)); }
}

// Windage loads about G (world). world: vertex positions (indexed by idx), eta: wave elevation per vertex (or null for
// still water), Gp: G (world), v, w: body velocity and angular velocity (world). Returns { F, M, area } with area the
// projected dry area normal to the (relative) wind.
export function windLoads(world, idx, eta, wind, t, Gp, v, w, Cd, rhoA = RHO_AIR) {
  let Fx = 0, Fy = 0, Fz = 0, Mx = 0, My = 0, Mz = 0, area = 0;
  if (!(wind.U10 > 0)) return { F: [0, 0, 0], M: [0, 0, 0], area: 0 };
  const g = wind.gust(t);
  const P = new Float64Array(12), vi = new Int32Array(3), d = new Float64Array(3);
  for (let t3 = 0; t3 < idx.length; t3 += 3) {
    vi[0] = idx[t3]; vi[1] = idx[t3 + 1]; vi[2] = idx[t3 + 2];
    for (let a = 0; a < 3; a++) d[a] = world[vi[a] * 3 + 2] - (eta ? eta[vi[a]] : 0);
    if (!(d[0] > 0) && !(d[1] > 0) && !(d[2] > 0)) continue;
    // dry part of the triangle (d > 0)
    let n = 0;
    for (let a = 0; a < 3; a++) {
      const b = a === 2 ? 0 : a + 1, va = vi[a] * 3, vb = vi[b] * 3;
      if (d[a] > 0) { P[n * 3] = world[va]; P[n * 3 + 1] = world[va + 1]; P[n * 3 + 2] = world[va + 2]; n++; }
      if ((d[a] > 0) !== (d[b] > 0)) {
        const s = d[a] / (d[a] - d[b]);
        P[n * 3] = world[va] + s * (world[vb] - world[va]); P[n * 3 + 1] = world[va + 1] + s * (world[vb + 1] - world[va + 1]); P[n * 3 + 2] = world[va + 2] + s * (world[vb + 2] - world[va + 2]);
        n++;
      }
    }
    for (let k = 1; k + 1 < n; k++) {
      const ax = P[0], ay = P[1], az = P[2], bx = P[k * 3], by = P[k * 3 + 1], bz = P[k * 3 + 2], cx = P[k * 3 + 3], cy = P[k * 3 + 4], cz = P[k * 3 + 5];
      const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
      const Sx = 0.5 * (uy * wz - uz * wy), Sy = 0.5 * (uz * wx - ux * wz), Sz = 0.5 * (ux * wy - uy * wx);
      const ox = (ax + bx + cx) / 3, oy = (ay + by + cy) / 3, oz = (az + bz + cz) / 3;
      const rx = ox - Gp[0], ry = oy - Gp[1], rz = oz - Gp[2];
      // panel velocity and relative wind
      const pvx = v[0] + w[1] * rz - w[2] * ry, pvy = v[1] + w[2] * rx - w[0] * rz, pvz = v[2] + w[0] * ry - w[1] * rx;
      const U = wind.speed(oz, t, g);
      const urx = U * wind.ex - pvx, ury = U * wind.ey - pvy, urz = -pvz, sp = Math.hypot(urx, ury, urz);
      if (!(sp > 0)) continue;
      const ap = 0.5 * Math.abs(Sx * urx + Sy * ury + Sz * urz) / sp;
      const q = 0.5 * rhoA * Cd * ap * sp;
      const fx = q * urx, fy = q * ury, fz = q * urz;
      Fx += fx; Fy += fy; Fz += fz;
      Mx += ry * fz - rz * fy; My += rz * fx - rx * fz; Mz += rx * fy - ry * fx;
      area += ap;
    }
  }
  return { F: [Fx, Fy, Fz], M: [Mx, My, Mz], area };
}

// Area-weighted mean height of the dry projected area seen by a wind along (ex, ey) (for the gust spectrum's height).
export function windageCentroid(world, idx, ex, ey) {
  let A = 0, Az = 0;
  for (let t3 = 0; t3 < idx.length; t3 += 3) {
    const a = idx[t3] * 3, b = idx[t3 + 1] * 3, c = idx[t3 + 2] * 3;
    const za = world[a + 2], zb = world[b + 2], zc = world[c + 2];
    if (za <= 0 && zb <= 0 && zc <= 0) continue;
    const ux = world[b] - world[a], uy = world[b + 1] - world[a + 1], uz = zb - za, wx = world[c] - world[a], wy = world[c + 1] - world[a + 1], wz = zc - za;
    const Sx = 0.5 * (uy * wz - uz * wy), Sy = 0.5 * (uz * wx - ux * wz);
    const frac = [za, zb, zc].filter((z) => z > 0).length / 3;
    const ap = 0.5 * Math.abs(Sx * ex + Sy * ey) * frac;
    A += ap; Az += ap * Math.max(0, (za + zb + zc) / 3);
  }
  return A > 0 ? Az / A : 0;
}
