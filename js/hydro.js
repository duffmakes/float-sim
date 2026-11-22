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

// Volume quadrature of the submerged region (relative to G, waterline at zw) for volume averages such as
// the incident-fluid acceleration. Cone construction: each wetted triangle forms a tetrahedron with an apex P0
// on the waterplane (the waterplane cap then contributes nothing, exactly as in submerged()); along each
// cone ∫ f dV = 6·vol·∫₀¹ f(P0 + s(c − P0)) s² ds, done with 4-point Gauss–Legendre in s. Signed volumes make
// this exact for any closed hull, not only star-shaped ones. Returns [x, y, z, w] rows with Σw = V.
const GL4 = [[0.0694318442029737, 0.1739274225687269], [0.3300094782075719, 0.3260725774312731],
  [0.6699905217924281, 0.3260725774312731], [0.9305681557970263, 0.1739274225687269]];
export function volumeQuadrature(rel, zw, apexXY = [0, 0]) {
  const P0 = [apexXY[0], apexXY[1], zw], out = [];
  for (const { tri } of meanWettedTris(rel, zw)) {
    const [a, b, c] = tri;
    const u = a.map((v, i) => v - P0[i]), v = b.map((x, i) => x - P0[i]), w = c.map((x, i) => x - P0[i]);
    const vol = (u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0])) / 6;
    if (vol === 0) continue;
    const cen = [0, 1, 2].map((i) => (a[i] + b[i] + c[i]) / 3);
    for (const [sq, wq] of GL4) out.push(P0[0] + sq * (cen[0] - P0[0]), P0[1] + sq * (cen[1] - P0[1]), P0[2] + sq * (cen[2] - P0[2]), 3 * vol * wq * sq * sq);
  }
  return new Float64Array(out);
}
// Volume quadrature for the time-domain sim: computed in the floating (equilibrium) frame, then rotated
// back into the body frame (relative to G) so it can move with the body. R0: world ← body attitude.
export function bodyFrameVolQ(rel, zw, B, R0) {
  const q = volumeQuadrature(rel, zw, [B[0], B[1]]);
  for (let o = 0; o < q.length; o += 4) {
    const x = q[o], y = q[o + 1], z = q[o + 2];
    q[o] = R0[0] * x + R0[3] * y + R0[6] * z; q[o + 1] = R0[1] * x + R0[4] * y + R0[7] * z; q[o + 2] = R0[2] * x + R0[5] * y + R0[8] * z;
  }
  return q;
}

export function meanWettedTris(rel, zw) {
  const out = [];
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
    for (let k = 1; k + 1 < pts.length; k++) out.push({ tri: [pts[0], pts[k], pts[k + 1]] });
  }
  return out;
}

// Default added-mass / damping estimates (editable). Labelled as estimates in the UI.
// Strip theory, choosing for each mode the strip direction that suits the body's proportions
// (the smaller estimate wins: long horizontal strips for ship-like bodies, vertical strips for columns):
//  A33 = floating elliptic disk of the waterplane's area and aspect ratio (see diskHeaveAddedMass)
//  A22 = min( ρπT²L/2 [horizontal strips: flat plate of depth 2T],  ρπ(L/2)²T [vertical strips: ellipse ⟂ motion] )
//  A11 = the same with L and B swapped;  A44 = 0.2·I44;  A55 = A33·L²/12;  A66 = A22·L²/12
//  Damping: fraction of critical per mode, typical magnitudes for an unappended body at zero speed.
// Complete elliptic integral of the second kind E(e) (modulus e), by the arithmetic–geometric mean.
export function ellipticE(e) {
  let a = 1, b = Math.sqrt(1 - e * e), c = e, sum = 0.5 * c * c, p = 0.5;
  for (let i = 0; i < 40 && Math.abs(c) > 1e-16; i++) {
    const an = (a + b) / 2; c = (a - b) / 2; b = Math.sqrt(a * b); a = an; p *= 2; sum += p * c * c;
  }
  return Math.PI / (2 * a) * (1 - sum);
}

// Heave added mass of the waterplane as a floating elliptic disk (half the infinite-fluid value of a disk
// moving broadside, Lamb §373 / Newman Marine Hydrodynamics §4.13): A = (2/3)πρ a b² / E(e), a ≥ b semi-axes.
// The ellipse has the waterplane's aspect ratio and area, so a circle gives (4/3)ρr³ and a slender
// waterplane approaches the 2-D strip value ρπB²/8 per unit length.
export function diskHeaveAddedMass(area, L, B, rho) {
  const ratio = Math.min(L, B) / Math.max(L, B);
  const a = Math.sqrt(area / (Math.PI * ratio)), b = a * ratio;
  return (2 / 3) * Math.PI * rho * a * b * b / ellipticE(Math.sqrt(1 - ratio * ratio));
}

export function defaultHydroCoeffs(H, mass, IG, rho) {
  const ext = waterplaneExtent(H.segs);
  const L = Math.max(ext[0], 1e-6), B = Math.max(ext[1], 1e-6), T = Math.max(H.draft, 1e-6);
  const A33 = diskHeaveAddedMass(Math.abs(H.wp.area) || L * B, L, B, rho);
  const A22 = Math.min(rho * Math.PI * T * T / 2 * L, rho * Math.PI * (L / 2) ** 2 * T);
  const A11 = Math.min(rho * Math.PI * T * T / 2 * B, rho * Math.PI * (B / 2) ** 2 * T);
  return {
    A: [A11, A22, A33, 0.2 * IG[0], A33 * L * L / 12, A22 * L * L / 12],
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
  const Bd = coeffs.Bd ? coeffs.Bd.slice() : [0, 1, 2, 3, 4, 5].map((i) => 2 * zeta[i] * (Mm[i][i] + Am[i]) * (wn[i] > 0 ? wn[i] : wRef));
  const quads = meanWettedSurface(rel, zw);
  // flatten quadrature points for a fast excitation loop: per point (x, y, z', n1..n6 · weight)
  const nq = quads.length * 3, qp = new Float64Array(nq * 9);
  let o = 0;
  for (const { S, mids } of quads) for (const r of mids) {
    qp[o++] = r[0]; qp[o++] = r[1]; qp[o++] = r[2] - zw;
    qp[o++] = S[0] / 3; qp[o++] = S[1] / 3; qp[o++] = S[2] / 3;
    qp[o++] = (r[1] * S[2] - r[2] * S[1]) / 3; qp[o++] = (r[2] * S[0] - r[0] * S[2]) / 3; qp[o++] = (r[0] * S[1] - r[1] * S[0]) / 3;
  }
  const vq = volumeQuadrature(rel, zw, [H.B[0], H.B[1]]);
  // diffraction: per-mode [surge, sway, heave] long-wave correction flags (a single boolean sets all three)
  const d = opts.diffraction, diffraction = Array.isArray(d) ? d.map(Boolean) : [!!d, !!d, !!d];
  return { Cm, Mm, Am, Bd, wn, quads, qp, vq, zw, rho, V, B: H.B.slice(), diffraction, depth: opts.depth ?? Infinity };
}

// Complex wave excitation per unit wave amplitude, η = Re{e^{iωt} e^{−i k·x}}.
// Froude–Krylov: F_j = −∫ p̂ n_j dS over the mean wetted surface, p̂ = ρg e^{k z'} e^{−ik(x cosβ + y sinβ)},
// moments about G. Optional long-wave diffraction correction (G.I. Taylor 1928; Newman, Marine Hydrodynamics
// §4.18): add A_jj × the incident-fluid acceleration averaged over the submerged volume, for surge, sway and
// heave. Froude–Krylov alone is ρ∫a dV (C_m = 1); the correction restores C_m = 1 + C_a.
export function fkExcitation(model, w, headingDeg) {
  const k = waveNumber(w, model.depth);
  const cb = Math.cos(headingDeg * Math.PI / 180), sb = Math.sin(headingDeg * Math.PI / 180);
  const kx = k * cb, ky = k * sb, rg = model.rho * G0, qp = model.qp;
  const Fr = [0, 0, 0, 0, 0, 0], Fi = [0, 0, 0, 0, 0, 0];
  for (let o = 0; o < qp.length; o += 9) {
    const amp = rg * Math.exp(k * qp[o + 2]);
    const ph = -(kx * qp[o] + ky * qp[o + 1]);
    const pr = amp * Math.cos(ph), pi = amp * Math.sin(ph);
    for (let j = 0; j < 6; j++) { const n = qp[o + 3 + j]; Fr[j] -= pr * n; Fi[j] -= pi * n; }
  }
  if (model.diffraction.some(Boolean)) {
    // A_jj × volume-averaged incident acceleration:  ∫_V a dV with a = (i g kₓ, i g k_y, −g k) e^{kz} e^{−ik·x}
    const vq = model.vq;
    let sr = 0, si = 0, cr = 0, ci = 0;
    for (let o = 0; o < vq.length; o += 4) {
      const e = vq[o + 3] * Math.exp(k * Math.min(0, vq[o + 2] - model.zw)), ph = -(kx * vq[o] + ky * vq[o + 1]);
      const c = Math.cos(ph), s = Math.sin(ph);
      sr += e * c; si += e * s;
    }
    cr = sr; ci = si;   // ∫ e^{kz} e^{iph} dV
    const g = G0, V = model.V;
    // a_x: i g kₓ (cr + i ci) = g kₓ (−ci + i cr) ; a_z: −g k (cr + i ci)
    const acc = [[-g * kx * ci, g * kx * cr], [-g * ky * ci, g * ky * cr], [-g * k * cr, -g * k * ci]];
    for (let j = 0; j < 3; j++) if (model.diffraction[j]) { Fr[j] += model.Am[j] / V * acc[j][0]; Fi[j] += model.Am[j] / V * acc[j][1]; }
  }
  return { F: Fr.map((r, j) => [r, Fi[j]]), k };
}

// Extra linear terms on top of the hydrodynamic model (small-body options), all about G in equilibrium axes:
//   extra = { K: 6×6 mooring stiffness | null, A: 6 diagonal added mass (heave plates) | null,
//             terms: (w) → { B: 6×6, X: 6 complex } linearised drag damping and its excitation | null }
// Applied identically by raoAt (estimates) and raoAtBem (panel method).
function addExtra(M, rhs, w, extra) {
  if (!extra) return;
  if (extra.K) for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) M[r][c][0] += extra.K[r][c];
  if (extra.A) for (let r = 0; r < 6; r++) M[r][r][0] -= w * w * extra.A[r];
  if (extra.terms) {
    const t = extra.terms(w);
    for (let r = 0; r < 6; r++) { for (let c = 0; c < 6; c++) M[r][c][1] += w * t.B[r][c]; rhs[r] = [rhs[r][0] + t.X[r][0], rhs[r][1] + t.X[r][1]]; }
  }
}

// Response amplitude operators at one frequency/heading. Returns complex ξ per unit wave amplitude.
// Fpre: a precomputed fkExcitation(model, w, headingDeg) (it does not depend on the extras), to skip recomputing it.
export function raoAt(model, w, headingDeg, extra = null, Fpre = null) {
  const { F, k } = Fpre || fkExcitation(model, w, headingDeg);
  const A = Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (_, c) => {
    const re = -w * w * (model.Mm[r][c] + (r === c ? model.Am[r] : 0)) + model.Cm[r][c];
    const im = r === c ? w * model.Bd[r] : 0;
    return [re, im];
  }));
  const rhs = F.map((z) => z.slice());
  addExtra(A, rhs, w, extra);
  const xi = complexSolve(A, rhs);
  return { xi, F: rhs, k };
}

// Sweep frequencies × headings. Rotations reported in deg per metre of wave amplitude and
// deg per deg of wave slope (|ξ|/(kA)).
export const DOF = ['surge', 'sway', 'heave', 'roll', 'pitch', 'yaw'];
export function raoSweep(model, omegas, headings, extraFor = null) {
  return headings.map((beta) => ({
    beta,
    points: omegas.map((w) => {
      const { xi, k } = raoAt(model, w, beta, extraFor ? extraFor(beta) : null);
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

// Same as raoSweep, but yields to the event loop every ~25 ms and reports progress (0–1).
export async function raoSweepAsync(model, omegas, headings, onProgress = () => {}, extraFor = null) {
  const total = omegas.length * headings.length;
  let done = 0, last = performance.now();
  const out = [];
  for (const beta of headings) {
    const points = [];
    const extra = extraFor ? extraFor(beta) : null;
    for (const w of omegas) {
      const { xi, F, k } = raoAt(model, w, beta, extra);
      const amp = xi.map((z) => C.abs(z));
      points.push({
        w, k, f: w / (2 * Math.PI), T: 2 * Math.PI / w, lambda: 2 * Math.PI / k, xi, F, amp,
        degPerM: amp.map((a, j) => (j >= 3 ? a * 180 / Math.PI : a)),
        perSlope: amp.map((a, j) => (j >= 3 ? a / k : a)),
        phase: xi.map((z) => Math.atan2(z[1], z[0]) * 180 / Math.PI),
      });
      done++;
      if (performance.now() - last > 25) { onProgress(done / total); await new Promise((r) => setTimeout(r, 0)); last = performance.now(); }
    }
    out.push({ beta, points });
  }
  onProgress(1);
  return out;
}

// Spectral response from an already computed RAO sweep (no re-solving): trapezoid over the sweep grid,
// |RAO|² S on [max(wLo, ω₀), min(wHi, ω_N)]. Returns null if the grid misses most of the energy.
export function spectralFromSweep(points, S, dof, duration = 3 * 3600, m0Wave = null) {
  let m0 = 0, m2 = 0, e = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dw = b.w - a.w;
    const fa = a.amp[dof] ** 2 * S(a.w), fb = b.amp[dof] ** 2 * S(b.w);
    m0 += 0.5 * (fa + fb) * dw; m2 += 0.5 * (fa * a.w * a.w + fb * b.w * b.w) * dw; e += 0.5 * (S(a.w) + S(b.w)) * dw;
  }
  const coverage = m0Wave ? e / m0Wave : 1;
  const Tz = m2 > 0 ? 2 * Math.PI * Math.sqrt(m0 / m2) : Infinity;
  const N = isFinite(Tz) ? Math.max(1, duration / Tz) : 1;
  const k = dof >= 3 ? 180 / Math.PI : 1;
  return { m0, sigma: Math.sqrt(m0) * k, sig: 2 * Math.sqrt(m0) * k, mpm: Math.sqrt(2 * m0 * Math.log(N)) * k, Tz, coverage };
}

// Linear spectral response: S_R(ω) = |RAO(ω)|² S(ω) (long-crested, zero speed).
// Significant single amplitude = 2√m0; most probable max in duration D (s) ≈ √(2 m0 ln N), N = D/Tz.
export function spectralResponse(model, S, headingDeg, dof, wMin, wMax, n = 400, duration = 3 * 3600, extra = null) {
  let m0 = 0, m2 = 0;
  const dw = (wMax - wMin) / n;
  for (let i = 0; i <= n; i++) {
    const w = wMin + i * dw;
    const { xi } = raoAt(model, w, headingDeg, extra);
    const r = C.abs(xi[dof]);
    const sr = r * r * S(w) * (i === 0 || i === n ? 0.5 : 1) * dw;
    m0 += sr; m2 += sr * w * w;
  }
  const Tz = m2 > 0 ? 2 * Math.PI * Math.sqrt(m0 / m2) : Infinity;
  const N = isFinite(Tz) ? Math.max(1, duration / Tz) : 1;
  const k = dof >= 3 ? 180 / Math.PI : 1;
  return { m0, sigma: Math.sqrt(m0) * k, sig: 2 * Math.sqrt(m0) * k, mpm: Math.sqrt(2 * m0 * Math.log(N)) * k, Tz };
}

// Several DOFs from one sweep (one solve per frequency): { [dof]: result as spectralResponse }.
export function spectralResponseMulti(model, S, headingDeg, dofs, wMin, wMax, n = 400, duration = 3 * 3600, extra = null) {
  const acc = dofs.map(() => ({ m0: 0, m2: 0 }));
  const dw = (wMax - wMin) / n;
  for (let i = 0; i <= n; i++) {
    const w = wMin + i * dw, { xi } = raoAt(model, w, headingDeg, extra), sw = S(w) * (i === 0 || i === n ? 0.5 : 1) * dw;
    dofs.forEach((j, q) => { const r2 = xi[j][0] ** 2 + xi[j][1] ** 2; acc[q].m0 += r2 * sw; acc[q].m2 += r2 * sw * w * w; });
  }
  const out = {};
  dofs.forEach((j, q) => {
    const { m0, m2 } = acc[q], Tz = m2 > 0 ? 2 * Math.PI * Math.sqrt(m0 / m2) : Infinity, N = isFinite(Tz) ? Math.max(1, duration / Tz) : 1, k = j >= 3 ? 180 / Math.PI : 1;
    out[j] = { m0, sigma: Math.sqrt(m0) * k, sig: 2 * Math.sqrt(m0) * k, mpm: Math.sqrt(2 * m0 * Math.log(N)) * k, Tz };
  });
  return out;
}

// Froude–Krylov validity: diffraction matters once the body is large relative to the wavelength
// (MacCamy–Fuchs: D/λ > 0.2).
export function diffractionCheck(sizeD, wMax) {
  const lam = 2 * Math.PI * Gw / (wMax * wMax);
  return { ratio: sizeD / lam, ok: sizeD / lam <= 0.2, lambda: lam };
}

// ---------------------------------------------------------------- panel-method (BEM) frequency-domain model
// bem: result of runBem (bemrun.js): { omegas, headings, A[k] 6×6, B[k] 6×6, X[k][h] 6×[re, im] } about G in the
// seakeeping frame. Coefficients between computed frequencies are interpolated linearly, exciting forces also
// linearly in heading (5° grid). Returns null outside the computed frequency range.
export function bemCoeffsAt(bem, w, headingDeg = null) {
  const ws = bem.omegas, n = ws.length;
  if (!(w >= ws[0] * (1 - 1e-9) && w <= ws[n - 1] * (1 + 1e-9))) return null;
  let k = 0; while (k < n - 2 && ws[k + 1] < w) k++;
  const t = n === 1 ? 0 : Math.max(0, Math.min(1, (w - ws[k]) / (ws[k + 1] - ws[k])));
  const k1 = Math.min(k + 1, n - 1);
  const lerpM = (M) => M[k].map((row, i) => row.map((v, j) => v + t * (M[k1][i][j] - v)));
  const out = { A: lerpM(bem.A), B: lerpM(bem.B) };
  if (headingDeg !== null) {
    const hs = bem.headings, b = ((headingDeg % 360) + 360) % 360;
    let i = hs.length - 1; for (let q = 0; q < hs.length; q++) if (hs[q] <= b + 1e-9) i = q;
    const i1 = (i + 1) % hs.length, span = ((hs[i1] - hs[i]) + 360) % 360 || 360, s = Math.abs(b - hs[i]) < 1e-9 ? 0 : ((b - hs[i] + 360) % 360) / span;
    const Xw = (kk) => bem.X[kk][i].map((z, j) => [z[0] + s * (bem.X[kk][i1][j][0] - z[0]), z[1] + s * (bem.X[kk][i1][j][1] - z[1])]);
    const xa = Xw(k), xb = Xw(k1);
    out.X = xa.map((z, j) => [z[0] + t * (xb[j][0] - z[0]), z[1] + t * (xb[j][1] - z[1])]);
  }
  return out;
}

// Uncoupled natural frequencies with the panel-method added mass: ω = √(C_jj / (M_jj + A_jj(ω))) (fixed point).
// Also returns the radiation damping ratio there. Modes without restoring (surge, sway, yaw) get ω = 0.
// extra: as raoAt (mooring stiffness K and plate added mass A shift the natural frequencies; surge, sway and yaw get
// one when moored).
export function bemNatural(model, bem, extra = null) {
  const res = [];
  for (let j = 0; j < 6; j++) {
    const C = model.Cm[j][j] + (extra && extra.K ? extra.K[j][j] : 0), Ax = extra && extra.A ? extra.A[j] : 0;
    if (!(C > 1e-9 * (model.Mm[j][j] || 1))) { res.push({ w: 0, A: null, B: null, zeta: null, inRange: true }); continue; }
    let w = Math.sqrt(C / (model.Mm[j][j] + Ax + (bem.A[0][j][j] || 0))), inRange = true;
    for (let it = 0; it < 60; it++) {
      const wc = Math.max(bem.omegas[0], Math.min(bem.omegas[bem.omegas.length - 1], w));
      const A = bemCoeffsAt(bem, wc).A[j][j] + Ax;
      const wn = Math.sqrt(C / Math.max(1e-12, model.Mm[j][j] + A));
      if (Math.abs(wn - w) < 1e-10 * w) { w = wn; break; }
      w = 0.5 * (w + wn);
    }
    if (w < bem.omegas[0] || w > bem.omegas[bem.omegas.length - 1]) inRange = false;
    const c = bemCoeffsAt(bem, Math.max(bem.omegas[0], Math.min(bem.omegas[bem.omegas.length - 1], w)));
    const A = c.A[j][j] + Ax, B = c.B[j][j];
    res.push({ w, A, B, zeta: B / (2 * (model.Mm[j][j] + A) * w), inRange });
  }
  return res;
}

// Additional (viscous) damping, fraction of critical at the BEM natural frequency, for the modes with restoring.
export function bemExtraDamping(model, nat, zetaExtra = [0, 0, 0, 0, 0, 0]) {
  return nat.map((n, j) => (n.w > 0 && zetaExtra[j] ? 2 * zetaExtra[j] * (model.Mm[j][j] + n.A) * n.w : 0));
}

// RAO from the panel-method coefficients: [−ω²(M + A(ω)) + iω(B(ω) + B_extra) + C] ξ = X(ω, β).
export function raoAtBem(model, bem, w, headingDeg, Bextra = null, extra = null) {
  const c = bemCoeffsAt(bem, w, headingDeg);
  if (!c) return null;
  const M = Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (_, q) => [
    -w * w * (model.Mm[r][q] + c.A[r][q]) + model.Cm[r][q],
    w * (c.B[r][q] + (r === q && Bextra ? Bextra[r] : 0)),
  ]));
  const rhs = c.X.map((z) => z.slice());
  addExtra(M, rhs, w, extra);
  return { xi: complexSolve(M, rhs), F: rhs, k: w * w / G0, A: c.A, B: c.B };
}

// Sweep in the same shape as raoSweepAsync, on the panel-method frequency grid. extraFor(beta) → extra (raoAt).
export function bemSweep(model, bem, headings, Bextra = null, extraFor = null) {
  return headings.map((beta) => ({
    beta,
    points: bem.omegas.map((w) => {
      const { xi, F, k, A, B } = raoAtBem(model, bem, w, beta, Bextra, extraFor ? extraFor(beta) : null);
      const amp = xi.map((z) => C.abs(z));
      return {
        w, k, f: w / (2 * Math.PI), T: 2 * Math.PI / w, lambda: 2 * Math.PI / k, xi, F, amp, A, B,
        degPerM: amp.map((a, j) => (j >= 3 ? a * 180 / Math.PI : a)),
        perSlope: amp.map((a, j) => (j >= 3 ? a / k : a)),
        phase: xi.map((z) => Math.atan2(z[1], z[0]) * 180 / Math.PI),
      };
    }),
  }));
}
