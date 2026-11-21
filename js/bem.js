// Panel method (BEM) for linear wave–body interaction in deep water: added mass A(ω), radiation damping B(ω)
// and wave exciting forces X(ω, β), the same low-order method as WAMIT (constant-potential flat panels,
// collocation at centroids). References:
//  [WAMIT] Lee & Newman, WAMIT User Manual v7.5, ch. 15 (integral equations 15.11, 15.20–15.23; Green function 15.14,
//          log singularity 15.19; Haskind relations; irregular-frequency removal 15.42–15.43)
//  [N85]   Newman (1985) Algorithms for the free-surface Green function, J. Eng. Math. 19, 57–67
//  [AS]    Abramowitz & Stegun, Handbook of Mathematical Functions §9.1 (Bessel), §12.1 (Struve)
// Conventions (as WAMIT): time dependence Re{φ e^{iωt}}; unit normal n points OUT of the fluid (into the body);
// generalized normals n_4..6 = r × n about the reference point; radiation potentials φ_j satisfy ∂φ_j/∂n = n_j;
// A_ij − (i/ω) B_ij = ρ ∫ n_i φ_j dS;  incident wave η = Re{e^{iωt} e^{−iK(x cosβ + y sinβ)}} (unit amplitude),
// φ_0 = (ig/ω) e^{Kz} e^{−iK(x cosβ + y sinβ)};  exciting force (Haskind) X_i = −iωρ ∫ (n_i φ_0 − φ_i ∂φ_0/∂n) dS.

const EULER_GAMMA = 0.5772156649015329;

// ------------------------------------------------------------------ Bessel J0, J1, Y0, Y1 and Struve H0, H1
// Ascending series below x = 12 (A&S 9.1.10–9.1.13, 12.1.3), Hankel/Struve asymptotic expansions above
// (A&S 9.2.5–9.2.10, 12.1.31). Absolute accuracy ≈ 1e-9 or better over the range used here (test/validate-bem.mjs).
const XS = 12;
function besselSeries(x) {
  const q = x * x / 4;
  let j0 = 0, j1 = 0, y0s = 0, y1s = 0, t0 = 1, t1 = 1, H = 0;   // t0 = (−q)^k/(k!)², t1 = (−q)^k/(k!(k+1)!)
  let psi1 = -EULER_GAMMA, psi2 = 1 - EULER_GAMMA;                 // ψ(k+1), ψ(k+2)
  for (let k = 0; k < 80; k++) {
    j0 += t0; j1 += t1;
    if (k > 0) y0s -= H * t0;                                      // Σ (−1)^{k+1} H_k q^k/(k!)²
    y1s += (psi1 + psi2) * t1;
    if (Math.abs(t0) < 1e-17 * Math.max(1, Math.abs(j0)) && k > 2) break;
    t0 *= -q / ((k + 1) * (k + 1)); t1 *= -q / ((k + 1) * (k + 2));
    H += 1 / (k + 1); psi1 += 1 / (k + 1); psi2 += 1 / (k + 2);
  }
  j1 *= x / 2;
  const L = Math.log(x / 2);
  const Y0 = (2 / Math.PI) * ((L + EULER_GAMMA) * j0 + y0s);
  const Y1reg = L * j1 - (x / 4) * y1s;                            // (π/2)Y1 + 1/x  (regular part)
  return { J0: j0, J1: j1, Y0, Y1: (2 / Math.PI) * (Y1reg - 1 / x), Y1reg };
}
function besselAsym(x) {
  const out = {};
  for (const nu of [0, 1]) {
    const mu = 4 * nu * nu, z8 = 8 * x;
    let P = 1, Q = 0, term = 1;
    for (let k = 1; k < 40; k++) {
      const nt = term * (mu - (2 * k - 1) ** 2) / (k * z8);
      if (Math.abs(nt) > Math.abs(term)) break;
      term = nt;
      if (k % 2) Q += (k % 4 === 1 ? 1 : -1) * term; else P += (k % 4 === 2 ? -1 : 1) * term;
      if (Math.abs(term) < 1e-17) break;
    }
    const chi = x - (nu / 2 + 0.25) * Math.PI, s = Math.sqrt(2 / (Math.PI * x));
    out['J' + nu] = s * (P * Math.cos(chi) - Q * Math.sin(chi));
    out['Y' + nu] = s * (P * Math.sin(chi) + Q * Math.cos(chi));
  }
  out.Y1reg = Math.PI / 2 * out.Y1 + 1 / x;
  return out;
}
export function bessel(x) { return x < XS ? besselSeries(x) : besselAsym(x); }

// Struve functions H0, H1. The H − Y asymptotic series is only good to ~1e-6 at x = 12 (its smallest term is
// Γ(x/2 + ½)²/π (x/2)^{−x−1}), so the ascending series is used up to x = 20, where both are good to ~1e-9.
const XS_STRUVE = 20;
export function struve(x) {
  if (x < XS_STRUVE) {
    const h = x / 2, q = h * h;
    let H0 = 0, H1 = 0;
    let g1 = Math.sqrt(Math.PI) / 2;                 // Γ(k + 3/2)
    let t0 = h / (g1 * g1), t1 = q / (g1 * g1 * 1.5);  // k = 0 terms: h/Γ(3/2)², h²/(Γ(3/2)Γ(5/2))
    for (let k = 0; k < 120; k++) {
      H0 += t0; H1 += t1;
      if (Math.abs(t0) < 1e-17 && Math.abs(t1) < 1e-17 && k > 2) break;
      const a = k + 1.5, b = k + 2.5;                 // Γ(k+5/2) = a Γ(k+3/2), Γ(k+7/2) = b Γ(k+5/2)
      t0 *= -q / (a * a); t1 *= -q / (a * b);
    }
    return { H0, H1 };
  }
  // H_ν − Y_ν ~ (1/π) Σ Γ(k+½)(x/2)^{ν−2k−1}/Γ(ν+½−k)
  const B = besselAsym(x);
  let s0 = 0, s1 = 0, g = Math.sqrt(Math.PI), prev0 = Infinity, prev1 = Infinity;   // g = Γ(k+½)
  for (let k = 0; k < 30; k++) {
    const gg = g * g / Math.PI * (k % 2 ? -1 : 1);       // Γ(k+½)/Γ(½−k)
    const a0 = gg * Math.pow(x / 2, -2 * k - 1), a1 = gg / (0.5 - k) * Math.pow(x / 2, -2 * k);
    if (Math.abs(a0) < prev0) { s0 += a0; prev0 = Math.abs(a0); }
    if (Math.abs(a1) < prev1) { s1 += a1; prev1 = Math.abs(a1); }
    g *= k + 0.5;
  }
  return { H0: B.Y0 + s0 / Math.PI, H1: B.Y1 + s1 / Math.PI };
}

// ------------------------------------------------------------------ deep-water wave Green function
// F(X, Y) = PV ∫₀^∞ e^{−Yt} J0(Xt)/(t − 1) dt, X = K R ≥ 0, Y = −K(z + ζ) ≥ 0. Closed form [N85]:
//   F  = −(π/2) e^{−Y}[H0(X) + Y0(X)] − ∫₀^Y e^{t−Y} (X² + t²)^{−½} dt
//   F_Y = −(X² + Y²)^{−½} − F
//   F_X = −e^{−Y} + (π/2) e^{−Y}[H1(X) + Y1(X)] + X ∫₀^Y e^{t−Y} (X² + t²)^{−3/2} dt
// The t-integrals are split at t* = min(Y, 1): below it t = X sinh u removes the peak at t = 0 (width X); above it a
// geometric composite Gauss–Legendre rule in s = Y − t follows the e^{−s} weight. The 1/X terms of F_X are
// cancelled analytically so that small X stays accurate.
const GL8 = [[-0.9602898564975363, 0.1012285362903763], [-0.7966664774136267, 0.2223810344533745],
  [-0.5255324099163290, 0.3137066458778873], [-0.1834346424956498, 0.3626837833783620],
  [0.1834346424956498, 0.3626837833783620], [0.5255324099163290, 0.3137066458778873],
  [0.7966664774136267, 0.2223810344533745], [0.9602898564975363, 0.1012285362903763]];
function glPanel(a, b, f) { const h = (b - a) / 2, c = (a + b) / 2; let s = 0; for (const [x, w] of GL8) s += w * f(c + h * x); return s * h; }
export function waveF(X, Y) {
  if (X < 1e-12) X = 1e-12;
  const eY = Math.exp(-Y);
  const B = bessel(X), Sv = struve(X);
  // part 1: t ∈ [0, t*], t = X sinh u
  const ts = Math.min(Y, 1), Us = Math.asinh(ts / X);
  let I1a = 0, J3 = 0;   // I1a = ∫ e^{t} dt/√(X²+t²) ;  J3 = ∫ (e^{t} − 1)/(X cosh²u) du  (both ×e^{−Y} later)
  if (Us > 0) {
    const nP = Math.max(1, Math.ceil(Us / 1.5));   // more panels when the u-range is long (very small X)
    for (let p = 0; p < nP; p++) {
      const a = Us * p / nP, b = Us * (p + 1) / nP;
      I1a += glPanel(a, b, (u) => Math.exp(X * Math.sinh(u)));
      J3 += glPanel(a, b, (u) => { const sh = Math.sinh(u), t = X * sh, ch = Math.cosh(u); return (t > 1e-8 ? Math.expm1(t) / t : 1 + t / 2) * sh / (ch * ch); });
    }
  }
  // part 2: t ∈ [t*, Y] with s = Y − t ∈ [0, Y − t*]
  let I1b = 0, I3b = 0;
  const L = Math.min(Y - ts, 40);
  if (L > 0) {
    let a = 0, w = 0.5;
    while (a < L) {
      const b = Math.min(L, a + w);
      I1b += glPanel(a, b, (s) => Math.exp(-s) / Math.sqrt(X * X + (Y - s) ** 2));
      I3b += glPanel(a, b, (s) => { const r2 = X * X + (Y - s) ** 2; return Math.exp(-s) / (r2 * Math.sqrt(r2)); });
      a = b; w *= 2;
    }
  }
  const I1 = eY * I1a + I1b;
  const F = -Math.PI / 2 * eY * (Sv.H0 + B.Y0) - I1;
  const r = Math.sqrt(X * X + Y * Y);
  const FY = -1 / r - F;
  // F_X: (π/2)Y1 = Y1reg − 1/X ; e^{−Y}·tanh(U*)/X − e^{−Y}/X = −e^{−Y} X/(ρ*(ρ* + t*))
  const rs = Math.sqrt(X * X + ts * ts);
  const FX = -eY + eY * (Math.PI / 2 * Sv.H1 + B.Y1reg) - eY * X / (rs * (rs + ts)) + eY * J3 + X * I3b;
  return { F, FX, FY, J0: B.J0, J1: B.J1 };
}

// ------------------------------------------------------------------ panels
// soupQ: wetted-surface triangles (CCW seen from the fluid, i.e. normals out of the body), waterline at z = 0, z ≤ 0 —
// the whole wetted surface, or only the part with x ≥ x0 and/or y ≥ y0 when sym.x / sym.y is set (the rest is generated
// by mirroring). lidQ: optional triangles on the interior waterplane (z = 0) for irregular-frequency removal, same part.
// ref: reference point for the rotational modes; it must lie on the symmetry planes. Panels are stored with the WAMIT
// normal (into the body), so the vertex order is reversed.
export function buildPanels(soupQ, ref = [0, 0, 0], lidQ = null, sym = {}) {
  const mirrors = [[false, false]];
  if (sym.x) mirrors.push([true, false]);
  if (sym.y) mirrors.push([false, true]);
  if (sym.x && sym.y) mirrors.push([true, true]);
  const x0 = sym.x0 || 0, y0 = sym.y0 || 0;
  const Nqb = soupQ.length / 9, Nql = lidQ ? lidQ.length / 9 : 0, Nq = Nqb + Nql, nm = mirrors.length, N = nm * Nq;
  const base = lidQ ? Float64Array.from([...soupQ, ...lidQ]) : soupQ;
  const P = { N, Nq, Nqb, Nql, nm, mirrors, sym: { x: !!sym.x, y: !!sym.y, x0, y0 }, ref: ref.slice(),
    v: new Float64Array(N * 9), c: new Float64Array(N * 3), n: new Float64Array(N * 3), area: new Float64Array(N), size: new Float64Array(N), gn: new Float64Array(N * 6), q: new Float64Array(N * 9) };
  for (let b = 0; b < nm; b++) {
    const [mx, my] = mirrors[b];
    const tf = (x, y, z) => [mx ? 2 * x0 - x : x, my ? 2 * y0 - y : y, z];
    const flip = mx !== my;   // a single reflection reverses the orientation
    for (let t = 0; t < Nq; t++) {
      const i = b * Nq + t, o = t * 9;
      let A = tf(base[o], base[o + 1], base[o + 2]), Bv = tf(base[o + 3], base[o + 4], base[o + 5]), C = tf(base[o + 6], base[o + 7], base[o + 8]);
      if (flip) [Bv, C] = [C, Bv];
      const a = A, bb = C, c = Bv;   // reversed: WAMIT normal into the body
      P.v.set([...a, ...bb, ...c], i * 9);
      const u = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
      const L = Math.hypot(nx, ny, nz) || 1e-300;
      P.area[i] = L / 2;
      P.n[i * 3] = nx / L; P.n[i * 3 + 1] = ny / L; P.n[i * 3 + 2] = nz / L;
      for (let k = 0; k < 3; k++) P.c[i * 3 + k] = (a[k] + bb[k] + c[k]) / 3;
      P.size[i] = Math.max(Math.hypot(...u), Math.hypot(...w), Math.hypot(bb[0] - c[0], bb[1] - c[1], bb[2] - c[2]));
      // 3-point interior Gauss rule (degree 2): barycentric (2/3, 1/6, 1/6)
      const V = [a, bb, c];
      for (let p = 0; p < 3; p++) for (let k = 0; k < 3; k++) P.q[i * 9 + p * 3 + k] = (4 * V[p][k] + V[(p + 1) % 3][k] + V[(p + 2) % 3][k]) / 6;
      if (t >= Nqb) continue;   // lid panels: no generalized normals
      const r = [P.c[i * 3] - ref[0], P.c[i * 3 + 1] - ref[1], P.c[i * 3 + 2] - ref[2]], n = [P.n[i * 3], P.n[i * 3 + 1], P.n[i * 3 + 2]];
      P.gn.set([n[0], n[1], n[2], r[1] * n[2] - r[2] * n[1], r[2] * n[0] - r[0] * n[2], r[0] * n[1] - r[1] * n[0]], i * 6);
    }
  }
  return P;
}

// Exact integrals over flat triangle j of the Rankine source and normal dipole at field point (px, py, pz):
//   S = ∫ 1/r dA,   D = ∫ ∂/∂n_ξ (1/r) dA = ∫ n·(x − ξ)/r³ dA  (= minus the solid angle signed by the vertex order)
// [Wilton et al. 1984; van Oosterom & Strackee 1983]. Far away (r > 4 × size) the centroid rule is used.
export function rankineTri(P, j, px, py, pz, out) {
  const o = j * 9, v = P.v;
  const cx = P.c[j * 3] - px, cy = P.c[j * 3 + 1] - py, cz = P.c[j * 3 + 2] - pz;
  const rc2 = cx * cx + cy * cy + cz * cz, s = P.size[j];
  const nx = P.n[j * 3], ny = P.n[j * 3 + 1], nz = P.n[j * 3 + 2];
  const fr = P.farRatio ?? 4;
  if (rc2 > fr * fr * 16 * s * s) {          // far: centroid rule (relative error ≲ (s/r)²/12)
    const rc = Math.sqrt(rc2), A = P.area[j];
    out[0] = A / rc; out[1] = -A * (nx * cx + ny * cy + nz * cz) / (rc2 * rc);
    return;
  }
  if (rc2 > 16 * s * s) {                    // intermediate: 3-point rule (degree 2)
    const A3 = P.area[j] / 3, q = P.q, o3 = j * 9;
    let S = 0, D = 0;
    for (let k = 0; k < 3; k++) {
      const dx = q[o3 + k * 3] - px, dy = q[o3 + k * 3 + 1] - py, dz = q[o3 + k * 3 + 2] - pz, r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2);
      S += A3 / r; D -= A3 * (nx * dx + ny * dy + nz * dz) / (r2 * r);
    }
    out[0] = S; out[1] = D;
    return;
  }
  const ax = v[o] - px, ay = v[o + 1] - py, az = v[o + 2] - pz;
  const bx = v[o + 3] - px, by = v[o + 4] - py, bz = v[o + 5] - pz;
  const qx = v[o + 6] - px, qy = v[o + 7] - py, qz = v[o + 8] - pz;
  const ra = Math.sqrt(ax * ax + ay * ay + az * az), rb = Math.sqrt(bx * bx + by * by + bz * bz), rq = Math.sqrt(qx * qx + qy * qy + qz * qz);
  const trip = ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
  const den = ra * rb * rq + (ax * bx + ay * by + az * bz) * rq + (ax * qx + ay * qy + az * qz) * rb + (bx * qx + by * qy + bz * qz) * ra;
  const h = -(ax * nx + ay * ny + az * nz);           // height of P above the plane along n
  // signed solid angle (sign of the vertex order seen from P); in the panel's own plane the principal value is 0
  const omega = Math.abs(h) <= 1e-12 * s ? 0 : 2 * Math.atan2(trip, den);
  // edges a→b, b→q, q→a
  let S = 0;
  const E = [[ax, ay, az, ra, bx, by, bz, rb], [bx, by, bz, rb, qx, qy, qz, rq], [qx, qy, qz, rq, ax, ay, az, ra]];
  for (const [x0, y0, z0, r0, x1, y1, z1, r1] of E) {
    const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0, d = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (d < 1e-300) continue;
    // outward in-plane edge normal m = t × n ; q = (V0 − P)·m
    const mx = (ey * nz - ez * ny) / d, my = (ez * nx - ex * nz) / d, mz = (ex * ny - ey * nx) / d;
    const qd = x0 * mx + y0 * my + z0 * mz;
    const sr = r0 + r1;
    if (Math.abs(qd) > 1e-14 * (d + sr) && sr - d > 1e-300) S += qd * Math.log((sr + d) / (sr - d));
  }
  S -= Math.abs(h) * Math.abs(omega);
  out[0] = S; out[1] = -omega;
}

// ------------------------------------------------------------------ dense complex LU (partial pivoting), in place
// a: { re, im } Float64Array N×N row-major; rhs: array of { re, im } Float64Array N (overwritten with solutions)
export function luSolveComplex(N, re, im, rhs) {
  const piv = new Int32Array(N);
  for (let c = 0; c < N; c++) {
    let p = c, best = re[c * N + c] ** 2 + im[c * N + c] ** 2;
    for (let r = c + 1; r < N; r++) { const m = re[r * N + c] ** 2 + im[r * N + c] ** 2; if (m > best) { best = m; p = r; } }
    piv[c] = p;
    if (p !== c) {
      for (let k = 0; k < N; k++) {
        let t = re[c * N + k]; re[c * N + k] = re[p * N + k]; re[p * N + k] = t;
        t = im[c * N + k]; im[c * N + k] = im[p * N + k]; im[p * N + k] = t;
      }
      for (const b of rhs) { let t = b.re[c]; b.re[c] = b.re[p]; b.re[p] = t; t = b.im[c]; b.im[c] = b.im[p]; b.im[p] = t; }
    }
    const dr = re[c * N + c], di = im[c * N + c], dd = dr * dr + di * di;
    if (dd === 0) continue;
    const ir = dr / dd, ii = -di / dd;                  // 1/pivot
    const rowC = c * N;
    for (let r = c + 1; r < N; r++) {
      const o = r * N;
      const ar = re[o + c], ai = im[o + c];
      if (ar === 0 && ai === 0) continue;
      const fr = ar * ir - ai * ii, fi = ar * ii + ai * ir;   // factor = a[r][c] / a[c][c]
      re[o + c] = fr; im[o + c] = fi;
      for (let k = c + 1; k < N; k++) {
        const br = re[rowC + k], bi = im[rowC + k];
        re[o + k] -= fr * br - fi * bi; im[o + k] -= fr * bi + fi * br;
      }
      for (const b of rhs) { const br = b.re[c], bi = b.im[c]; b.re[r] -= fr * br - fi * bi; b.im[r] -= fr * bi + fi * br; }
    }
  }
  for (const b of rhs) {
    for (let r = N - 1; r >= 0; r--) {
      let sr = b.re[r], si = b.im[r];
      const o = r * N;
      for (let k = r + 1; k < N; k++) { const ar = re[o + k], ai = im[o + k]; sr -= ar * b.re[k] - ai * b.im[k]; si -= ar * b.im[k] + ai * b.re[k]; }
      const dr = re[o + r], di = im[o + r], dd = dr * dr + di * di || 1e-300;
      b.re[r] = (sr * dr + si * di) / dd; b.im[r] = (si * dr - sr * di) / dd;
    }
  }
}

// ------------------------------------------------------------------ GMRES (restarted, complex), for large panel counts
// Solves A x = b with A given as split re/im row-major arrays. Unpreconditioned: the integral equation is of the second
// kind (diagonal ±2π, ±4π), so a few dozen iterations reach 1e-8 except close to an irregular frequency. Returns the
// iteration count, or −1 if it did not converge (the caller then falls back to LU).
export function gmresComplex(N, re, im, bRe, bIm, xRe, xIm, { tol = 1e-8, restart = 60, maxIt = 400 } = {}) {
  const m = restart;
  const Vr = Array.from({ length: m + 1 }, () => new Float64Array(N)), Vi = Array.from({ length: m + 1 }, () => new Float64Array(N));
  const Hr = new Float64Array((m + 1) * m), Hi = new Float64Array((m + 1) * m);
  const cs = new Float64Array(m), snr = new Float64Array(m), sni = new Float64Array(m), gr = new Float64Array(m + 1), gi = new Float64Array(m + 1);
  const wr = new Float64Array(N), wi = new Float64Array(N);
  const matvec = (xr, xi, yr, yi) => {
    for (let r = 0; r < N; r++) {
      const o = r * N; let sr = 0, si = 0;
      for (let k = 0; k < N; k++) { const ar = re[o + k], ai = im[o + k], vr = xr[k], vi = xi[k]; sr += ar * vr - ai * vi; si += ar * vi + ai * vr; }
      yr[r] = sr; yi[r] = si;
    }
  };
  let bn = 0; for (let k = 0; k < N; k++) bn += bRe[k] * bRe[k] + bIm[k] * bIm[k];
  bn = Math.sqrt(bn) || 1;
  let it = 0;
  for (let outer = 0; outer * m < maxIt; outer++) {
    matvec(xRe, xIm, wr, wi);
    let beta = 0;
    for (let k = 0; k < N; k++) { wr[k] = bRe[k] - wr[k]; wi[k] = bIm[k] - wi[k]; beta += wr[k] * wr[k] + wi[k] * wi[k]; }
    beta = Math.sqrt(beta);
    if (beta / bn < tol) return it;
    for (let k = 0; k < N; k++) { Vr[0][k] = wr[k] / beta; Vi[0][k] = wi[k] / beta; }
    gr.fill(0); gi.fill(0); gr[0] = beta;
    let j = 0;
    for (; j < m; j++) {
      it++;
      matvec(Vr[j], Vi[j], wr, wi);
      // modified Gram–Schmidt: h_ij = <v_i, w> (conjugate-linear in v_i)
      for (let i = 0; i <= j; i++) {
        let hr = 0, hi = 0; const vr = Vr[i], vi = Vi[i];
        for (let k = 0; k < N; k++) { hr += vr[k] * wr[k] + vi[k] * wi[k]; hi += vr[k] * wi[k] - vi[k] * wr[k]; }
        Hr[i * m + j] = hr; Hi[i * m + j] = hi;
        for (let k = 0; k < N; k++) { wr[k] -= hr * vr[k] - hi * vi[k]; wi[k] -= hr * vi[k] + hi * vr[k]; }
      }
      let hn = 0; for (let k = 0; k < N; k++) hn += wr[k] * wr[k] + wi[k] * wi[k];
      hn = Math.sqrt(hn);
      Hr[(j + 1) * m + j] = hn; Hi[(j + 1) * m + j] = 0;
      if (hn > 0) for (let k = 0; k < N; k++) { Vr[j + 1][k] = wr[k] / hn; Vi[j + 1][k] = wi[k] / hn; }
      // apply the previous Givens rotations to column j: [c, s; −conj(s), c]
      for (let i = 0; i < j; i++) {
        const ar = Hr[i * m + j], ai = Hi[i * m + j], br = Hr[(i + 1) * m + j], bi = Hi[(i + 1) * m + j];
        Hr[i * m + j] = cs[i] * ar + (snr[i] * br - sni[i] * bi); Hi[i * m + j] = cs[i] * ai + (snr[i] * bi + sni[i] * br);
        Hr[(i + 1) * m + j] = -(snr[i] * ar + sni[i] * ai) + cs[i] * br; Hi[(i + 1) * m + j] = -(snr[i] * ai - sni[i] * ar) + cs[i] * bi;
      }
      // new rotation zeroing H[j+1][j]
      const ar = Hr[j * m + j], ai = Hi[j * m + j], b = Hr[(j + 1) * m + j];
      const an = Math.hypot(ar, ai), den = Math.hypot(an, b);
      if (den === 0) { cs[j] = 1; snr[j] = 0; sni[j] = 0; }
      else if (an === 0) { cs[j] = 0; snr[j] = 1; sni[j] = 0; }
      else { cs[j] = an / den; const ph_r = ar / an, ph_i = ai / an; snr[j] = ph_r * b / den; sni[j] = ph_i * b / den; }   // s = (a/|a|) b / den
      Hr[j * m + j] = cs[j] * ar + (snr[j] * b); Hi[j * m + j] = cs[j] * ai + (sni[j] * b);
      Hr[(j + 1) * m + j] = 0;
      const g0r = gr[j], g0i = gi[j];
      gr[j] = cs[j] * g0r; gi[j] = cs[j] * g0i;
      gr[j + 1] = -(snr[j] * g0r + sni[j] * g0i); gi[j + 1] = -(snr[j] * g0i - sni[j] * g0r);
      if (Math.hypot(gr[j + 1], gi[j + 1]) / bn < tol) { j++; break; }
    }
    // back substitution H y = g, then x += V y
    const yr = new Float64Array(j), yi = new Float64Array(j);
    for (let i = j - 1; i >= 0; i--) {
      let sr = gr[i], si = gi[i];
      for (let k = i + 1; k < j; k++) { const hr = Hr[i * m + k], hi = Hi[i * m + k]; sr -= hr * yr[k] - hi * yi[k]; si -= hr * yi[k] + hi * yr[k]; }
      const dr = Hr[i * m + i], di = Hi[i * m + i], dd = dr * dr + di * di || 1e-300;
      yr[i] = (sr * dr + si * di) / dd; yi[i] = (si * dr - sr * di) / dd;
    }
    for (let i = 0; i < j; i++) { const vr = Vr[i], vi = Vi[i], a = yr[i], b2 = yi[i]; for (let k = 0; k < N; k++) { xRe[k] += a * vr[k] - b2 * vi[k]; xIm[k] += a * vi[k] + b2 * vr[k]; } }
    if (Math.hypot(gr[j], gi[j]) / bn < tol) {
      // confirm with the true residual
      matvec(xRe, xIm, wr, wi);
      let r2 = 0; for (let k = 0; k < N; k++) r2 += (bRe[k] - wr[k]) ** 2 + (bIm[k] - wi[k]) ** 2;
      if (Math.sqrt(r2) / bn < 10 * tol) return it;
    }
  }
  return -1;
}

// ------------------------------------------------------------------ solver
// Symmetry: P.nm mirror blocks (identity, then the x = x0 / y = y0 / both mirror images of the first Nq panels), each
// block holding Nqb body + Nql lid panels. Only the first Nq = Nqb + Nql panels are collocation points. A solution of
// parity (sx, sy) satisfies φ(mirror_m p) = s_m φ(p), so the N×N system folds into one Nq×Nq system per parity class
// (up to 4) — 16× less memory and 64× less LU work for a body symmetric about both vertical planes.
// Mode parities about a reference point on both symmetry planes:
const MODE_PARITY = [[-1, 1], [1, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];   // surge, sway, heave, roll, pitch, yaw
export function parityClasses(P) {
  const classes = new Map();
  for (let m = 0; m < 6; m++) {
    const signs = P.mirrors.map(([mx, my]) => (mx ? MODE_PARITY[m][0] : 1) * (my ? MODE_PARITY[m][1] : 1));
    const k = signs.join(',');
    if (!classes.has(k)) classes.set(k, { signs, modes: [] });
    classes.get(k).modes.push(m);
  }
  return [...classes.values()];
}
const isLidPanel = (P, J) => (J % P.Nq) >= P.Nqb;

// Frequency-independent Rankine parts, folded per parity class: R[c] (Nq × Nq) holds, for body columns,
// Σ_b s_b (D[1/r] + D[1/r']) and, for lid columns, Σ_b s_b (S[1/r] + S[1/r']); Snp[m] (Nq) = Σ_J (S[1/r] + S[1/r'])·n_m.
// With limits = true the zero- and infinite-frequency added mass are computed too (A0, Ainf, 6×6).
export function rankineSetup(P, { limits = false, rho = 1000, onProgress = () => {} } = {}) {
  const N = P.N, Nq = P.Nq, nm = P.nm, cls = parityClasses(P), nc = cls.length;
  const R = cls.map(() => new Float64Array(Nq * Nq)), Rm = limits ? cls.map(() => new Float64Array(Nq * Nq)) : null;
  const Snp = Array.from({ length: 6 }, () => new Float64Array(Nq)), Snm = limits ? Array.from({ length: 6 }, () => new Float64Array(Nq)) : null;
  const o1 = [0, 0], o2 = [0, 0], sg = cls.map((c) => c.signs);
  for (let i = 0; i < Nq; i++) {
    const px = P.c[i * 3], py = P.c[i * 3 + 1], pz = P.c[i * 3 + 2], row = i * Nq;
    for (let b = 0; b < nm; b++) for (let j = 0; j < Nq; j++) {
      const J = b * Nq + j;
      rankineTri(P, J, px, py, pz, o1);
      rankineTri(P, J, px, py, -pz, o2);     // image 1/r' = 1/|x' − ξ|
      const lid = j >= P.Nqb;
      const v = lid ? o1[0] + o2[0] : o1[1] + o2[1];
      for (let c = 0; c < nc; c++) R[c][row + j] += sg[c][b] * v;
      if (lid) continue;
      if (limits) { const vm = o1[1] - o2[1]; for (let c = 0; c < nc; c++) Rm[c][row + j] += sg[c][b] * vm; }
      const sp = o1[0] + o2[0], sm = o1[0] - o2[0];
      for (let m = 0; m < 6; m++) { const g = P.gn[J * 6 + m]; if (g) { Snp[m][i] += sp * g; if (limits) Snm[m][i] += sm * g; } }
    }
    if ((i & 15) === 0) onProgress(i / Nq);
  }
  const out = { cls, R, Snp };
  if (limits) { out.A0 = limitSolve(P, cls, R, Snp, rho); out.Ainf = limitSolve(P, cls, Rm, Snm, rho); }
  return out;
}
// Added mass in the zero-frequency (∂φ/∂z = 0 on z = 0) or infinite-frequency (φ = 0) limit. Lid panels play no part.
function limitSolve(P, cls, Rf, Sn, rho) {
  const Nq = P.Nq, Nb = P.Nqb, phiQ = new Array(6);
  for (let c = 0; c < cls.length; c++) {
    const re = new Float64Array(Nb * Nb);
    for (let i = 0; i < Nb; i++) { for (let j = 0; j < Nb; j++) re[i * Nb + j] = Rf[c][i * Nq + j]; re[i * Nb + i] += 2 * Math.PI; }
    const rhs = cls[c].modes.map((m) => ({ re: Float64Array.from(Sn[m].subarray(0, Nb)), im: new Float64Array(Nb) }));
    luSolveComplex(Nb, re, new Float64Array(Nb * Nb), rhs);
    cls[c].modes.forEach((m, k) => { const r = new Float64Array(Nq), z = new Float64Array(Nq); r.set(rhs[k].re); phiQ[m] = { re: r, im: z }; });
  }
  return forceMatrix(P, expandPhi(P, phiQ), rho).re;
}

// expand collocation-point potentials (per mode, length Nq) to every panel using the mode's parity
function expandPhi(P, phiQ) {
  return phiQ.map((f, m) => {
    const re = new Float64Array(P.N), im = new Float64Array(P.N);
    P.mirrors.forEach(([mx, my], b) => {
      const s = (mx ? MODE_PARITY[m][0] : 1) * (my ? MODE_PARITY[m][1] : 1);
      for (let j = 0; j < P.Nq; j++) { re[b * P.Nq + j] = s * f.re[j]; im[b * P.Nq + j] = s * f.im[j]; }
    });
    return { re, im };
  });
}

// ρ ∫ n_k φ_m dS for the six radiation potentials → { re: A, im: −B/ω } (6×6)
function forceMatrix(P, phi, rho) {
  const re = Array.from({ length: 6 }, () => new Array(6).fill(0)), im = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let J = 0; J < P.N; J++) {
    if (isLidPanel(P, J)) continue;
    const A = P.area[J] * rho;
    for (let k = 0; k < 6; k++) {
      const g = P.gn[J * 6 + k] * A;
      if (!g) continue;
      for (let m = 0; m < 6; m++) { re[k][m] += g * phi[m].re[J]; im[k][m] += g * phi[m].im[J]; }
    }
  }
  return { re, im };
}

// wave part of ∫_panel J G dξ and ∫_panel J ∂G/∂n_ξ dξ at field point p (1- or 3-point rule) → out [Sr, Si, Dr, Di]
// The 3-point rule is used near the panel and, at any distance, once the wave phase changes by more than 0.3 rad
// across it (K·size > 0.3): at λ/7 panels the centroid alone misses a phase change of about 1 rad, which on the large
// flat bottom of a 40 m barge turned the high-frequency heave damping negative (WAMIT and Capytaine: positive).
function wavePart(P, J, px, py, pz, K, out) {
  const c = P.c, q = P.q, n = P.n;
  const dx0 = c[J * 3] - px, dy0 = c[J * 3 + 1] - py, dz0 = c[J * 3 + 2] - pz, s = P.size[J];
  const near = K * s > 0.3 || dx0 * dx0 + dy0 * dy0 + dz0 * dz0 < 16 * s * s;
  const nq = near ? 3 : 1, wq = P.area[J] / nq;
  const nx = n[J * 3], ny = n[J * 3 + 1], nz = n[J * 3 + 2];
  let Sr = 0, Si = 0, Dr = 0, Di = 0;
  for (let p = 0; p < nq; p++) {
    const qx = near ? q[J * 9 + p * 3] : c[J * 3], qy = near ? q[J * 9 + p * 3 + 1] : c[J * 3 + 1], qz = near ? q[J * 9 + p * 3 + 2] : c[J * 3 + 2];
    const hx = px - qx, hy = py - qy, Rh = Math.sqrt(hx * hx + hy * hy);
    const X = K * Rh, Y = Math.max(0, -K * (pz + qz));
    const f = waveF(X, Y), eY = Math.exp(-Y);
    Sr += 2 * K * f.F; Si += -2 * Math.PI * K * eY * f.J0;
    const ne = Rh > 1e-12 ? (nx * hx + ny * hy) / Rh : 0;          // n · e_h, e_h = (x − ξ)_h / R
    Dr += 2 * K * K * (-f.FX * ne - f.FY * nz);
    Di += -2 * Math.PI * K * K * eY * (f.J1 * ne + f.J0 * nz);
  }
  out[0] = Sr * wq; out[1] = Si * wq; out[2] = Dr * wq; out[3] = Di * wq;
}

// Radiation problem at frequency ω (deep water): radiation potentials φ_m on all panels and A(ω), B(ω) (6×6).
// With lid panels the extended boundary integral equations remove the irregular frequencies [WAMIT 15.42–15.43]:
//   x ∈ S_b:   2πφ + ∫_Sb φ ∂G/∂n + ∫_Si φ' ∂G/∂n = ∫_Sb φ_n G
//   x ∈ S_i:  −4πφ' + ∫_Sb φ ∂G/∂n + ∫_Si φ' ∂G/∂n = ∫_Sb φ_n G
// The lid normal points down (−z), so on the lid ∂G/∂n_ξ = −∂G/∂ζ = −K G (free-surface condition). Checked against
// WAMIT (IRR = 1) through the first heave and surge irregular frequencies of a floating hemisphere.
// ws: optional workspace from bemWorkspace(P, R) (reused between frequencies to avoid reallocating).
export function bemWorkspace(P, R) {
  const Nq = P.Nq;
  return { re: R.cls.map(() => new Float64Array(Nq * Nq)), im: R.cls.map(() => new Float64Array(Nq * Nq)) };
}
export function solveRadiation(P, R, w, { rho = 1000, g = 9.80665, ws = null, solver = 'auto' } = {}) {
  const N = P.N, Nq = P.Nq, nm = P.nm, Nqb = P.Nqb, K = w * w / g, cls = R.cls, nc = cls.length;
  ws = ws || bemWorkspace(P, R);
  const sg = cls.map((c) => c.signs);
  for (let c = 0; c < nc; c++) {
    const re = ws.re[c], im = ws.im[c], Rc = R.R[c];
    re.set(Rc); im.fill(0);
    for (let i = 0; i < Nq; i++) { const o = i * Nq; for (let j = Nqb; j < Nq; j++) re[o + j] *= -K; re[o + i] += i < Nqb ? 2 * Math.PI : -4 * Math.PI; }
  }
  const rhs = Array.from({ length: 6 }, (_, m) => ({ re: Float64Array.from(R.Snp[m]), im: new Float64Array(Nq) }));
  const c3 = P.c, o = [0, 0, 0, 0];
  for (let i = 0; i < Nq; i++) {
    const px = c3[i * 3], py = c3[i * 3 + 1], pz = c3[i * 3 + 2], row = i * Nq;
    for (let b = 0; b < nm; b++) for (let j = 0; j < Nq; j++) {
      const J = b * Nq + j;
      wavePart(P, J, px, py, pz, K, o);
      let vr, vi;
      if (j < Nqb) {
        vr = o[2]; vi = o[3];
        for (let m = 0; m < 6; m++) { const gm = P.gn[J * 6 + m]; if (gm) { rhs[m].re[i] += o[0] * gm; rhs[m].im[i] += o[1] * gm; } }
      } else { vr = -K * o[0]; vi = -K * o[1]; }
      for (let c = 0; c < nc; c++) { const s = sg[c][b]; ws.re[c][row + j] += s * vr; ws.im[c][row + j] += s * vi; }
    }
  }
  const phiQ = new Array(6);
  let iters = 0;
  for (let c = 0; c < nc; c++) {
    const b = cls[c].modes.map((m) => rhs[m]);
    if ((solver === 'auto' && Nq > 600) || solver === 'gmres') {
      // GMRES needs the matrix intact for every right-hand side
      const sol = [];
      let ok = true;
      for (const r of b) {
        const xr = new Float64Array(Nq), xi = new Float64Array(Nq);
        const n = gmresComplex(Nq, ws.re[c], ws.im[c], r.re, r.im, xr, xi);
        if (n < 0) { ok = false; break; }
        iters += n; sol.push({ re: xr, im: xi });
      }
      if (ok) { cls[c].modes.forEach((m, k) => { phiQ[m] = sol[k]; }); continue; }
    }
    luSolveComplex(Nq, ws.re[c], ws.im[c], b);
    cls[c].modes.forEach((m, k) => { phiQ[m] = b[k]; });
  }
  const phi = expandPhi(P, phiQ);
  const F = forceMatrix(P, phi, rho);
  return { phi, A: F.re, B: F.im.map((r) => r.map((v) => -w * v)), iters };
}

// Exciting force (Haskind relation) for heading β (deg) from the radiation potentials, per unit wave amplitude, in the
// e^{+iωt} convention with the incident wave η = Re{e^{iωt} e^{−iK(x cosβ + y sinβ)}} (phase zero at the origin).
export function haskindX(P, phi, w, betaDeg, { rho = 1000, g = 9.80665 } = {}) {
  const K = w * w / g, cb = Math.cos(betaDeg * Math.PI / 180), sb = Math.sin(betaDeg * Math.PI / 180);
  const X = Array.from({ length: 6 }, () => [0, 0]);
  for (let j = 0; j < P.N; j++) {
    if (isLidPanel(P, j)) continue;
    const x = P.c[j * 3], y = P.c[j * 3 + 1], z = P.c[j * 3 + 2], A = P.area[j];
    const amp = g / w * Math.exp(K * z), ph = -K * (x * cb + y * sb);
    const p0r = -amp * Math.sin(ph), p0i = amp * Math.cos(ph);           // φ0 = i (g/ω) e^{Kz} e^{iph}
    const nx = P.n[j * 3], ny = P.n[j * 3 + 1], nz = P.n[j * 3 + 2];
    const dr = K * nz, di = -K * (cb * nx + sb * ny);                    // ∂φ0/∂n = φ0 (K n_z − iK(cosβ n_x + sinβ n_y))
    const dnr = p0r * dr - p0i * di, dni = p0r * di + p0i * dr;
    for (let k = 0; k < 6; k++) {
      const gk = P.gn[j * 6 + k];
      const fr = phi[k].re[j], fi = phi[k].im[j];
      const tr = gk * p0r - (fr * dnr - fi * dni), ti = gk * p0i - (fr * dni + fi * dnr);
      // −iωρ (tr + i ti) A = ωρA (ti − i tr)
      X[k][0] += w * rho * A * ti; X[k][1] -= w * rho * A * tr;
    }
  }
  return X;
}

// Rigid-body transfer of coefficients from reference point O to G, with r = O − G (both in the same axes).
// Motions: ξ_O = T ξ_G with T = [[I, −[r]×], [0, I]]; then A_G = Tᵀ A_O T, B_G = Tᵀ B_O T, X_G = Tᵀ X_O.
export function transferToG(A, B, Xs, r) {
  const T = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => (i === j ? 1 : 0)));
  const [x, y, z] = r;
  T[0][4] = z; T[0][5] = -y; T[1][3] = -z; T[1][5] = x; T[2][3] = y; T[2][4] = -x;
  const mm = (P, Q) => P.map((row, i) => Q[0].map((_, j) => row.reduce((s, _, k) => s + P[i][k] * Q[k][j], 0)));
  const Tt = T[0].map((_, j) => T.map((row) => row[j]));
  const tx = (X) => X.map((_, i) => [0, 1].map((c) => X.reduce((s, x, j) => s + T[j][i] * x[c], 0)));
  return { A: mm(Tt, mm(A, T)), B: mm(Tt, mm(B, T)), X: Xs.map(tx) };
}
