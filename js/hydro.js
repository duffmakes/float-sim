// Wave loads (Froude–Krylov) and linear frequency-domain seakeeping (RAOs).
// References: Faltinsen (1990) Sea Loads on Ships and Offshore Structures, ch. 2–3;
//             Journée & Massie (2001) Offshore Hydromechanics, ch. 6–7 (hydrostatic restoring matrix, RAOs).
import { submerged, G0 } from './physics.js';
import { G as Gw, waveNumber } from './waves.js';

// ---------------------------------------------------------------- mesh utilities
// Split triangles (midpoint subdivision) until every edge ≤ maxEdge, or the triangle budget is hit.
export function refineTris(tris, maxEdge, budget = 60000) {
  let cur = Array.from(tris);
  const h2 = maxEdge * maxEdge;
  for (let pass = 0; pass < 12; pass++) {
    const out = [];
    let split = false;
    for (let i = 0; i < cur.length; i += 9) {
      const a = cur.slice(i, i + 3), b = cur.slice(i + 3, i + 6), c = cur.slice(i + 6, i + 9);
      const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
      const remaining = (cur.length - i) / 9 - 1;
      if (Math.max(d2(a, b), d2(b, c), d2(c, a)) > h2 && out.length / 9 + 4 + remaining <= budget) {
        const m = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
        const ab = m(a, b), bc = m(b, c), ca = m(c, a);
        out.push(...a, ...ab, ...ca, ...ab, ...b, ...bc, ...ca, ...bc, ...c, ...ab, ...bc, ...ca);
        split = true;
      } else out.push(...a, ...b, ...c);
    }
    cur = out;
    if (!split || cur.length / 9 > budget) break;
  }
  return new Float64Array(cur);
}

// Weld a triangle soup into unique vertices + index triples (so per-vertex wave sums are done once).
export function indexMesh(tris, tol) {
  const map = new Map(), verts = [], idx = new Uint32Array(tris.length / 3);
  for (let i = 0; i < tris.length; i += 3) {
    const key = `${Math.round(tris[i] / tol)},${Math.round(tris[i + 1] / tol)},${Math.round(tris[i + 2] / tol)}`;
    let v = map.get(key);
    if (v === undefined) { v = verts.length / 3; map.set(key, v); verts.push(tris[i], tris[i + 1], tris[i + 2]); }
    idx[i / 3] = v;
  }
  return { verts: new Float64Array(verts), idx };
}

// ---------------------------------------------------------------- time-domain wave loads
// Integrates the Wheeler-stretched Froude–Krylov pressure over the part of the hull below the
// instantaneous wave surface. world: Float64Array of vertex positions (world frame, indexed by idx).
// Pressure is evaluated at mesh vertices and is exactly zero where the hull cuts the surface, then
// interpolated linearly across each wetted sub-triangle, so the hydrostatic part (linear in z) and its
// moment are integrated exactly. Returns force, moment about point G, and the waterline segments.
export function waveForces(world, idx, field, t, rho, Gp, opts = {}) {
  const nv = world.length / 3;
  const eta = opts.etaBuf && opts.etaBuf.length === nv ? opts.etaBuf : new Float64Array(nv);
  const pres = opts.pBuf && opts.pBuf.length === nv ? opts.pBuf : new Float64Array(nv);
  for (let v = 0; v < nv; v++) {
    const x = world[v * 3], y = world[v * 3 + 1], z = world[v * 3 + 2];
    const e = field.n ? field.eta(x, y, t) : 0;
    eta[v] = e;
    pres[v] = z < e ? (field.n ? field.pressureAfterEta(z, e, rho) : -rho * G0 * z) : 0;
  }
  let Fx = 0, Fy = 0, Fz = 0, Mx = 0, My = 0, Mz = 0, wet = 0;
  const segs = opts.segments ? [] : null;
  const P = new Float64Array(12), Pp = new Float64Array(4);
  const [gx, gy, gz] = Gp;
  for (let t3 = 0; t3 < idx.length; t3 += 3) {
    const vi = [idx[t3], idx[t3 + 1], idx[t3 + 2]];
    const d = vi.map((v) => world[v * 3 + 2] - eta[v]);
    const nIn = (d[0] < 0) + (d[1] < 0) + (d[2] < 0);
    if (nIn === 0) continue;
    let n = 0, en = -1, ex = -1;
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3, va = vi[a], vb = vi[b];
      if (d[a] < 0) { P[n * 3] = world[va * 3]; P[n * 3 + 1] = world[va * 3 + 1]; P[n * 3 + 2] = world[va * 3 + 2]; Pp[n] = pres[va]; n++; }
      if ((d[a] < 0) !== (d[b] < 0)) {
        const s = d[a] / (d[a] - d[b]);
        for (let k = 0; k < 3; k++) P[n * 3 + k] = world[va * 3 + k] + s * (world[vb * 3 + k] - world[va * 3 + k]);
        Pp[n] = 0;
        if (d[a] < 0) ex = n; else en = n;
        n++;
      }
    }
    for (let k = 1; k + 1 < n; k++) {
      const ax = P[0] - gx, ay = P[1] - gy, az = P[2] - gz;
      const bx = P[k * 3] - gx, by = P[k * 3 + 1] - gy, bz = P[k * 3 + 2] - gz;
      const cx = P[k * 3 + 3] - gx, cy = P[k * 3 + 4] - gy, cz = P[k * 3 + 5] - gz;
      // vector area S = ½ (b−a)×(c−a)  (outward for CCW winding)
      const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
      const Sx = 0.5 * (uy * wz - uz * wy), Sy = 0.5 * (uz * wx - ux * wz), Sz = 0.5 * (ux * wy - uy * wx);
      const pa = Pp[0], pb = Pp[k], pc = Pp[k + 1], ps = pa + pb + pc;
      // F = −∫p n dA = −(Σp/3) S
      Fx -= ps / 3 * Sx; Fy -= ps / 3 * Sy; Fz -= ps / 3 * Sz;
      // ∫ p r dA = (A/12)(Σ pᵢ rᵢ + Σp Σr) ; moment = −(∫ p r dA)/A × S
      const qx = (pa * ax + pb * bx + pc * cx + ps * (ax + bx + cx)) / 12;
      const qy = (pa * ay + pb * by + pc * cy + ps * (ay + by + cy)) / 12;
      const qz = (pa * az + pb * bz + pc * cz + ps * (az + bz + cz)) / 12;
      Mx -= qy * Sz - qz * Sy; My -= qz * Sx - qx * Sz; Mz -= qx * Sy - qy * Sx;
      wet += Math.hypot(Sx, Sy, Sz);
    }
    if (segs && en >= 0 && ex >= 0) segs.push(P[en * 3], P[en * 3 + 1], P[en * 3 + 2], P[ex * 3], P[ex * 3 + 1], P[ex * 3 + 2]);
  }
  return { F: [Fx, Fy, Fz], M: [Mx, My, Mz], wetArea: wet, segs, eta };
}

// ---------------------------------------------------------------- linear frequency-domain model
const C = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
  div: (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; },
  abs: (a) => Math.hypot(a[0], a[1]),
};

// Solve the complex n×n system A x = b by Gaussian elimination with partial pivoting.
export function complexSolve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row.map((z) => z.slice()), b[i].slice()]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (C.abs(M[r][c]) > C.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (C.abs(M[c][c]) < 1e-300) continue;
    for (let r = c + 1; r < n; r++) {
      const f = C.div(M[r][c], M[c][c]);
      for (let k = c; k <= n; k++) M[r][k] = C.sub(M[r][k], C.mul(f, M[c][k]));
    }
  }
  const x = new Array(n).fill(0).map(() => [0, 0]);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s = C.sub(s, C.mul(M[r][k], x[k]));
    x[r] = C.abs(M[r][r]) < 1e-300 ? [0, 0] : C.div(s, M[r][r]);
  }
  return x;
}

// Mean wetted surface (clipped below the still waterline) as a list of sub-triangles with
// 3 edge-midpoint quadrature points (exact for quadratics), relative to G, waterline at z = 0.
function meanWettedSurface(rel, zw) {
  const quads = [];
  for (let i = 0; i < rel.length; i += 9) {
    const z = [rel[i + 2] - zw, rel[i + 5] - zw, rel[i + 8] - zw];
    if (z[0] >= 0 && z[1] >= 0 && z[2] >= 0) continue;
    const pts = [];
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3;
      const A = [rel[i + a * 3], rel[i + a * 3 + 1], rel[i + a * 3 + 2]];
      const B = [rel[i + b * 3], rel[i + b * 3 + 1], rel[i + b * 3 + 2]];
      if (z[a] < 0) pts.push(A);
      if ((z[a] < 0) !== (z[b] < 0)) { const s = z[a] / (z[a] - z[b]); pts.push(A.map((v, k) => v + s * (B[k] - v))); }
    }
    for (let k = 1; k + 1 < pts.length; k++) {
      const a = pts[0], b = pts[k], c = pts[k + 1];
      const u = b.map((v, j) => v - a[j]), w = c.map((v, j) => v - a[j]);
      const S = [0.5 * (u[1] * w[2] - u[2] * w[1]), 0.5 * (u[2] * w[0] - u[0] * w[2]), 0.5 * (u[0] * w[1] - u[1] * w[0])];
      const mids = [[a, b], [b, c], [c, a]].map(([p, q]) => p.map((v, j) => (v + q[j]) / 2));
      quads.push({ S, mids });
    }
  }
  return quads;
}

// Default added-mass / damping estimates (editable). Labelled as estimates in the UI.
//  A33: 2-D semicircle, ρπB²/8 per unit length (Lewis/strip theory, high-frequency limit)
//  A22: 2-D flat plate of depth 2T, ρπT²/2 per unit length;  A11: 5 % of mass
//  A44: fraction of dry roll inertia (typ. 0.1–0.3);  A55 = A33·L²/12;  A66 = A22·L²/12
//  Damping: fraction of critical per mode, typical magnitudes for an unappended body at zero speed.
export function defaultHydroCoeffs(H, mass, IG, rho) {
  const ext = waterplaneExtent(H.segs);
  const L = Math.max(ext[0], 1e-6), B = Math.max(ext[1], 1e-6), T = Math.max(H.draft, 1e-6);
  const A33 = rho * Math.PI * B * B / 8 * L;
  const A22 = rho * Math.PI * T * T / 2 * L;
  return {
    A: [0.05 * mass, A22, A33, 0.2 * IG[0], A33 * L * L / 12, A22 * L * L / 12],
    zeta: [0.05, 0.05, 0.15, 0.08, 0.15, 0.05],
    L, B, T,
  };
}

export function waterplaneExtent(segs) {
  if (!segs || !segs.length) return [0, 0];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < segs.length; i += 2) { x0 = Math.min(x0, segs[i]); x1 = Math.max(x1, segs[i]); y0 = Math.min(y0, segs[i + 1]); y1 = Math.max(y1, segs[i + 1]); }
  return [x1 - x0, y1 - y0];
}

// Build the 6-DOF linear model about G (world axes, equilibrium attitude).
// rel: hull rotated to the floating attitude, relative to G (G = origin); H: hydrostatics(rel, zw, …);
// IG: 3×3 inertia about G in world axes; coeffs: { A: [6], zeta: [6] }.
export function linearModel(rel, H, mass, IG, rho, coeffs, opts = {}) {
  const g = G0, zw = H.zw;
  const wp = H.wp;                                   // area, centroid, centroidal I's (x,y about G vertical)
  const Ax = wp.area * wp.cx, Ay = wp.area * wp.cy;  // first moments ∫x dA, ∫y dA
  const Iyy0 = wp.Ixx + wp.area * wp.cy * wp.cy;     // ∫ y² dA about G's vertical
  const Ixx0 = wp.Iyy + wp.area * wp.cx * wp.cx;     // ∫ x² dA
  const Ixy0 = wp.Ixy + wp.area * wp.cx * wp.cy;     // ∫ xy dA
  const V = H.V, zB = H.B[2];
  // hydrostatic restoring matrix about G [Journée & Massie eq. 6.x; Faltinsen §3.2]
  const Cm = Array.from({ length: 6 }, () => new Array(6).fill(0));
  Cm[2][2] = rho * g * wp.area;
  Cm[2][3] = Cm[3][2] = rho * g * Ay;
  Cm[2][4] = Cm[4][2] = -rho * g * Ax;
  Cm[3][3] = rho * g * (Iyy0 + V * zB);              // zG = 0 (origin at G)
  Cm[4][4] = rho * g * (Ixx0 + V * zB);
  Cm[3][4] = Cm[4][3] = -rho * g * Ixy0;
  // ∫ (zw) terms: the waterplane is at height zw above G, so shift the first moments' heave coupling
  // (heave of the waterplane centroid is about G's vertical; no correction needed for these terms)
  const Mm = Array.from({ length: 6 }, () => new Array(6).fill(0));
  Mm[0][0] = Mm[1][1] = Mm[2][2] = mass;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Mm[3 + r][3 + c] = IG[r * 3 + c];
  const Am = coeffs.A, zeta = coeffs.zeta;
  // natural frequencies (uncoupled) and damping from fraction of critical
  const wn = [0, 1, 2, 3, 4, 5].map((i) => Cm[i][i] > 0 ? Math.sqrt(Cm[i][i] / (Mm[i][i] + Am[i])) : 0);
  const wRef = wn[2] || wn[3] || 1;
  const Bd = [0, 1, 2, 3, 4, 5].map((i) => 2 * zeta[i] * (Mm[i][i] + Am[i]) * (wn[i] > 0 ? wn[i] : wRef));
  const quads = meanWettedSurface(rel, zw);
  return { Cm, Mm, Am, Bd, wn, quads, zw, rho, V, depth: opts.depth ?? Infinity };
}

// Complex Froude–Krylov excitation per unit wave amplitude, η = Re{e^{iωt} e^{−i k·x}}.
// F_j = −∫ p̂ n_j dS, p̂ = ρg e^{k z'} e^{−ik(x cosβ + y sinβ)}, z' = depth below still water; moments about G.
export function fkExcitation(model, w, headingDeg) {
  const k = waveNumber(w, model.depth);
  const cb = Math.cos(headingDeg * Math.PI / 180), sb = Math.sin(headingDeg * Math.PI / 180);
  const F = new Array(6).fill(0).map(() => [0, 0]);
  const rg = model.rho * G0;
  for (const { S, mids } of model.quads) {
    for (const r of mids) {
      const amp = rg * Math.exp(k * (r[2] - model.zw)) / 3;
      const ph = -k * (r[0] * cb + r[1] * sb);
      const p = [amp * Math.cos(ph), amp * Math.sin(ph)];
      const n6 = [S[0], S[1], S[2], r[1] * S[2] - r[2] * S[1], r[2] * S[0] - r[0] * S[2], r[0] * S[1] - r[1] * S[0]];
      for (let j = 0; j < 6; j++) { F[j][0] -= p[0] * n6[j]; F[j][1] -= p[1] * n6[j]; }
    }
  }
  return { F, k };
}

// Response amplitude operators at one frequency/heading. Returns complex ξ per unit wave amplitude.
export function raoAt(model, w, headingDeg) {
  const { F, k } = fkExcitation(model, w, headingDeg);
  const A = Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (_, c) => {
    const re = -w * w * (model.Mm[r][c] + (r === c ? model.Am[r] : 0)) + model.Cm[r][c];
    const im = r === c ? w * model.Bd[r] : 0;
    return [re, im];
  }));
  const xi = complexSolve(A, F);
  return { xi, F, k };
}

// Sweep frequencies × headings. Rotations reported in deg per metre of wave amplitude and
// deg per deg of wave slope (|ξ|/(kA)).
export const DOF = ['surge', 'sway', 'heave', 'roll', 'pitch', 'yaw'];
export function raoSweep(model, omegas, headings) {
  return headings.map((beta) => ({
    beta,
    points: omegas.map((w) => {
      const { xi, k } = raoAt(model, w, beta);
      const amp = xi.map((z) => C.abs(z));
      const phase = xi.map((z) => Math.atan2(z[1], z[0]) * 180 / Math.PI);
      return {
        w, k, T: 2 * Math.PI / w, lambda: 2 * Math.PI / k,
        amp,                                                    // m/m, rad/m
        degPerM: amp.map((a, j) => (j >= 3 ? a * 180 / Math.PI : a)),
        perSlope: amp.map((a, j) => (j >= 3 ? a / k : a)),      // rotations: deg/deg
        phase,
      };
    }),
  }));
}

// Linear spectral response: S_R(ω) = |RAO(ω)|² S(ω) (long-crested, zero speed).
// Significant single amplitude = 2√m0; most probable max in duration D (s) ≈ √(2 m0 ln N), N = D/Tz.
export function spectralResponse(model, S, headingDeg, dof, wMin, wMax, n = 400, duration = 3 * 3600) {
  let m0 = 0, m2 = 0;
  const dw = (wMax - wMin) / n;
  for (let i = 0; i <= n; i++) {
    const w = wMin + i * dw;
    const { xi } = raoAt(model, w, headingDeg);
    const r = C.abs(xi[dof]);
    const sr = r * r * S(w) * (i === 0 || i === n ? 0.5 : 1) * dw;
    m0 += sr; m2 += sr * w * w;
  }
  const Tz = m2 > 0 ? 2 * Math.PI * Math.sqrt(m0 / m2) : Infinity;
  const N = isFinite(Tz) ? Math.max(1, duration / Tz) : 1;
  const k = dof >= 3 ? 180 / Math.PI : 1;
  return { m0, sigma: Math.sqrt(m0) * k, sig: 2 * Math.sqrt(m0) * k, mpm: Math.sqrt(2 * m0 * Math.log(N)) * k, Tz };
}

// Froude–Krylov validity: diffraction matters once the body is large relative to the wavelength
// (MacCamy–Fuchs: D/λ > 0.2).
export function diffractionCheck(sizeD, wMax) {
  const lam = 2 * Math.PI * Gw / (wMax * wMax);
  return { ratio: sizeD / lam, ok: sizeD / lam <= 0.2, lambda: lam };
}
