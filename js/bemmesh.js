// Panel meshes for the panel method (bem.js): the wetted surface of a floating hull from any CAD / STL triangulation,
// remeshed to near-equilateral triangles of a chosen size h, plus the interior waterplane ("lid") used to remove the
// irregular frequencies. CAD tessellations are tuned for drawing (long slivers on cylinders, fans at poles), which a
// constant-panel method handles badly; remeshing gives panels whose collocation points represent the surface evenly.
//
// Isotropic remeshing after Botsch & Kobbelt (2004), "A remeshing approach to multiresolution modeling", SGP:
//   split edges > 4/3 h, collapse edges < 4/5 h, flip edges toward valence 6 (4 on the boundary), tangential
//   relaxation, and projection back onto the original surface. Feature curves (dihedral angle > 35°, the waterline,
//   symmetry-plane cuts and any open edges) are kept: their vertices slide along the original curve, and corners
//   (where curves meet or turn sharply) stay fixed, so the waterline stays exactly on z = 0.

const EPS = 1e-12;
const triArea = (s, i) => { const ux = s[i + 3] - s[i], uy = s[i + 4] - s[i + 1], uz = s[i + 5] - s[i + 2], wx = s[i + 6] - s[i], wy = s[i + 7] - s[i + 1], wz = s[i + 8] - s[i + 2]; return 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx); };
export function soupArea(s) { let a = 0; for (let i = 0; i < s.length; i += 9) a += triArea(s, i); return a; }

// Keep the part of a triangle soup with coordinate[axis] ≥ val (axis 0/1/2); with below = true keep ≤ val instead.
// Cut vertices are placed exactly on the plane.
// Vertices within tol of the plane are moved onto it first, so near-coincident cut points never appear.
export function clipSoup(soup, axis, val, below = false, tol = 0) {
  const out = [];
  const sgn = below ? -1 : 1;
  for (let i = 0; i < soup.length; i += 9) {
    const P = [0, 1, 2].map((k) => [soup[i + k * 3], soup[i + k * 3 + 1], soup[i + k * 3 + 2]]);
    for (const p of P) if (Math.abs(p[axis] - val) <= tol) p[axis] = val;
    const d = P.map((p) => sgn * (p[axis] - val));
    if (d[0] >= 0 && d[1] >= 0 && d[2] >= 0) { out.push(...P[0], ...P[1], ...P[2]); continue; }
    if (d[0] <= 0 && d[1] <= 0 && d[2] <= 0) continue;
    const poly = [];
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3;
      if (d[a] >= 0) poly.push(d[a] === 0 ? P[a].map((v, k) => (k === axis ? val : v)) : P[a]);
      if ((d[a] > 0 && d[b] < 0) || (d[a] < 0 && d[b] > 0)) {
        const t = d[a] / (d[a] - d[b]);
        const q = P[a].map((v, k) => v + t * (P[b][k] - v)); q[axis] = val; poly.push(q);
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) out.push(...poly[0], ...poly[k], ...poly[k + 1]);
  }
  return new Float64Array(out);
}

// Dunavant (1985) 7-point rule, degree 5: [weight, barycentric coordinates]
const D7a = 0.059715871789770, D7b = 0.470142064105115, D7c = 0.797426985353087, D7d = 0.101286507323456;
const DUNAVANT7 = [[0.225, 1 / 3, 1 / 3, 1 / 3],
  [0.132394152788506, D7a, D7b, D7b], [0.132394152788506, D7b, D7a, D7b], [0.132394152788506, D7b, D7b, D7a],
  [0.125939180544827, D7c, D7d, D7d], [0.125939180544827, D7d, D7c, D7d], [0.125939180544827, D7d, D7d, D7c]];

// Mirror-symmetry test of a surface about x = x0 (axis 0) or y = y0 (axis 1): the odd moments of area and of the
// normal components must vanish. x0 is the area centroid. Returns { sym, x0, err } (err relative, ~1e-16 for exact).
export function symmetryOf(soup, axis) {
  let A = 0, c = 0;
  for (let i = 0; i < soup.length; i += 9) { const a = triArea(soup, i); A += a; c += a * (soup[i + axis] + soup[i + 3 + axis] + soup[i + 6 + axis]) / 3; }
  if (!(A > 0)) return { sym: false, x0: 0, err: Infinity };
  const x0 = c / A, other = 1 - axis;
  let L = 0; for (let i = 0; i < soup.length; i++) L = Math.max(L, Math.abs(soup[i]));
  const mom = new Array(12).fill(0);
  for (let i = 0; i < soup.length; i += 9) {
    const a = triArea(soup, i);
    if (!a) continue;
    const ux = soup[i + 3] - soup[i], uy = soup[i + 4] - soup[i + 1], uz = soup[i + 5] - soup[i + 2], wx = soup[i + 6] - soup[i], wy = soup[i + 7] - soup[i + 1], wz = soup[i + 8] - soup[i + 2];
    const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx].map((v) => v / (2 * a));
    for (const [w0, b0, b1, b2] of DUNAVANT7) {   // degree-5 rule: the cubic moments are exact on any triangulation
      const q = (k) => b0 * soup[i + k] + b1 * soup[i + 3 + k] + b2 * soup[i + 6 + k];
      const u = (q(axis) - x0) / L, v = q(other) / L, z = q(2) / L, w = a * w0;
      const f = [u, u * u * u, u * v, u * z, u * v * v, u * z * z, u * v * z, n[axis], n[axis] * v * v, n[axis] * z, n[other] * u, n[2] * u];
      for (let k = 0; k < f.length; k++) mom[k] += w * f[k];
    }
  }
  const err = Math.max(...mom.map(Math.abs)) / (A / (L * L));
  return { sym: err < 1e-3, x0, err };
}

// ------------------------------------------------------------------ closest points (Ericson 2005, §5.1.2 and §5.1.5)
function closestOnTri(px, py, pz, t, o, out) {
  const ax = t[o], ay = t[o + 1], az = t[o + 2], bx = t[o + 3], by = t[o + 4], bz = t[o + 5], cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = ax + v * abx; out[1] = ay + v * aby; out[2] = az + v * abz; return; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); out[0] = ax + w * acx; out[1] = ay + w * acy; out[2] = az + w * acz; return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); out[0] = bx + w * (cx - bx); out[1] = by + w * (cy - by); out[2] = bz + w * (cz - bz); return; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
}
function closestOnPt(px, py, pz, s, o, out) { out[0] = s[o]; out[1] = s[o + 1]; out[2] = s[o + 2]; }
function closestOnSeg(px, py, pz, s, o, out) {
  const ax = s[o], ay = s[o + 1], az = s[o + 2], dx = s[o + 3] - ax, dy = s[o + 4] - ay, dz = s[o + 5] - az;
  const L2 = dx * dx + dy * dy + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  out[0] = ax + t * dx; out[1] = ay + t * dy; out[2] = az + t * dz;
}

// Uniform grid of primitives (points: 3 numbers, segments: 6, triangles: 9) for nearest-point queries near the surface.
// Cells are hashed to int32 (collisions only add candidates); a visit stamp per primitive avoids per-query allocation.
const cellKey = (i, j, k) => ((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) | 0;
class NearestGrid {
  constructor(data, stride, cell) {
    this.d = data; this.s = stride; this.c = cell; this.m = new Map();
    this.stamp = new Int32Array(Math.ceil(data.length / stride)); this.qid = 0;
    const np = stride / 3;
    for (let o = 0; o < data.length; o += stride) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let v = 0; v < np; v++) { const x = data[o + v * 3], y = data[o + v * 3 + 1], z = data[o + v * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      const i0 = Math.floor(x0 / cell), i1 = Math.floor(x1 / cell), j0 = Math.floor(y0 / cell), j1 = Math.floor(y1 / cell), k0 = Math.floor(z0 / cell), k1 = Math.floor(z1 / cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
        const key = cellKey(i, j, k); let b = this.m.get(key); if (!b) this.m.set(key, (b = [])); b.push(o);
      }
    }
  }
  // nearest point among the primitives accepted by filter(o) (optional); out = [x, y, z]. Returns the primitive's
  // offset in data, or −1. Searches cubic shells of cells outward until no unsearched cell can hold a nearer point.
  nearest(px, py, pz, out, filter = null) {
    const c = this.c, st = this.s, fn = st === 9 ? closestOnTri : st === 6 ? closestOnSeg : closestOnPt, q = this.q3 || (this.q3 = [0, 0, 0]);
    const ci = Math.floor(px / c), cj = Math.floor(py / c), ck = Math.floor(pz / c);
    const qid = ++this.qid, stamp = this.stamp, d = this.d, m = this.m;
    let best = Infinity, found = -1;
    const visit = (i, j, k) => {
      const b = m.get(cellKey(i, j, k));
      if (!b) return;
      for (let n = 0; n < b.length; n++) {
        const o = b[n], pi = o / st;
        if (stamp[pi] === qid) continue;
        stamp[pi] = qid;
        if (filter && !filter(o)) continue;
        fn(px, py, pz, d, o, q);
        const d2 = (q[0] - px) * (q[0] - px) + (q[1] - py) * (q[1] - py) + (q[2] - pz) * (q[2] - pz);
        if (d2 < best) { best = d2; out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; found = o; }
      }
    };
    for (let r = 0; r < 100000; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        const edge = i === ci - r || i === ci + r || j === cj - r || j === cj + r;
        if (edge) for (let k = ck - r; k <= ck + r; k++) visit(i, j, k);
        else { visit(i, j, ck - r); if (r) visit(i, j, ck + r); }
      }
      // every point within r·c of p has been searched
      if (found >= 0 && Math.sqrt(best) <= r * c) return found;
      if (r > 8 && !m.size) break;
      if (r * c > 1e3 * (Math.abs(px) + Math.abs(py) + Math.abs(pz) + c) && r > 64) break;
    }
    return found;
  }
}

// Longest-edge bisection until every edge ≤ h (only used to make the projection references finer; it does not change
// the geometry). With stride 4 each vertex carries a scalar (x, y, z, s) that is interpolated linearly.
function bisectToSize(tris, h, budget = 400000, stride = 3) {
  let cur = Array.from(tris);
  const h2 = h * h, tw = 3 * stride;
  for (let pass = 0; pass < 40; pass++) {
    const out = []; let split = false;
    for (let i = 0; i < cur.length; i += tw) {
      const V = [0, 1, 2].map((k) => cur.slice(i + k * stride, i + (k + 1) * stride));
      const L = [0, 1, 2].map((k) => { const a = V[k], b = V[(k + 1) % 3]; return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; });
      const k = L[0] >= L[1] && L[0] >= L[2] ? 0 : L[1] >= L[2] ? 1 : 2;
      if (L[k] > h2 && out.length / tw + (cur.length - i) / tw + 1 <= budget) {
        const a = V[k], b = V[(k + 1) % 3], c = V[(k + 2) % 3], m = a.map((v, j) => (v + b[j]) / 2);
        out.push(...a, ...m, ...c, ...m, ...b, ...c); split = true;
      } else out.push(...V[0], ...V[1], ...V[2]);
    }
    cur = out;
    if (!split) break;
  }
  return new Float64Array(cur);
}

// ------------------------------------------------------------------ remeshing
// soup: triangles (consistently oriented). h: target edge length. Options:
//   featureDeg  dihedral angle above which an edge is a feature (default 35°)
//   cornerDeg   turn angle of a feature curve above which its vertex is a fixed corner (default 40°)
//   fixedBoundary  keep every boundary vertex where it is and never split boundary edges (lid meshes)
//   planeZ      the surface is the plane z = planeZ (lid meshes; projection is exact)
//   iterations  remeshing passes (default 8)
//   curvSegments  curvature-adaptive size: at most 2πR / curvSegments where the surface has radius of curvature R
//               (estimated from the facet angles of the input), never below h/2; 0 = uniform size h
// Returns { soup, stats }.
export function remesh(soup, h, { featureDeg = 35, cornerDeg = 40, fixedBoundary = false, planeZ = null, iterations = 8, curvSegments = 0 } = {}) {
  let L = 0; for (let i = 0; i < soup.length; i++) L = Math.max(L, Math.abs(soup[i]));
  const weld = 1e-9 * Math.max(L, h);
  // ---- weld into vertices + triangles
  const X = [], Y = [], Z = [], T = [];
  {
    const map = new Map();
    const vid = (x, y, z) => {
      const k = `${Math.round(x / weld)},${Math.round(y / weld)},${Math.round(z / weld)}`;
      let v = map.get(k); if (v === undefined) { v = X.length; map.set(k, v); X.push(x); Y.push(y); Z.push(z); }
      return v;
    };
    for (let i = 0; i < soup.length; i += 9) {
      if (triArea(soup, i) <= EPS * L * L) continue;
      const a = vid(soup[i], soup[i + 1], soup[i + 2]), b = vid(soup[i + 3], soup[i + 4], soup[i + 5]), c = vid(soup[i + 6], soup[i + 7], soup[i + 8]);
      if (a !== b && b !== c && a !== c) T.push(a, b, c);
    }
  }
  const nt0 = T.length / 3;
  const alive = []; for (let t = 0; t < nt0; t++) alive.push(1);
  const vt = X.map(() => new Set());
  for (let t = 0; t < nt0; t++) for (let k = 0; k < 3; k++) vt[T[t * 3 + k]].add(t);
  const vAlive = X.map(() => 1);
  const eKey = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
  const triNormal = (t, out) => {
    const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
    const ux = X[b] - X[a], uy = Y[b] - Y[a], uz = Z[b] - Z[a], wx = X[c] - X[a], wy = Y[c] - Y[a], wz = Z[c] - Z[a];
    out[0] = uy * wz - uz * wy; out[1] = uz * wx - ux * wz; out[2] = ux * wy - uy * wx;
    return Math.hypot(out[0], out[1], out[2]);
  };
  const edgeTris = (a, b) => { const r = []; for (const t of vt[a]) if (alive[t] && (T[t * 3] === b || T[t * 3 + 1] === b || T[t * 3 + 2] === b)) r.push(t); return r; };
  const nbrs = (v) => { const s = new Set(); for (const t of vt[v]) if (alive[t]) for (let k = 0; k < 3; k++) { const w = T[t * 3 + k]; if (w !== v) s.add(w); } return s; };
  const len = (a, b) => Math.hypot(X[a] - X[b], Y[a] - Y[b], Z[a] - Z[b]);

  // ---- features: boundary / non-manifold / sharp edges → curves; corners
  const feat = new Map();   // edge key → curve id
  const featEdges = [];
  {
    const em = new Map();
    for (let t = 0; t < nt0; t++) for (let k = 0; k < 3; k++) { const a = T[t * 3 + k], b = T[t * 3 + (k + 1) % 3], e = eKey(a, b); let r = em.get(e); if (!r) em.set(e, (r = [a, b])); r.push(t); }
    const cosF = Math.cos(featureDeg * Math.PI / 180), n1 = [0, 0, 0], n2 = [0, 0, 0];
    for (const [e, r] of em) {
      const ts = r.slice(2);
      let isF = ts.length !== 2;
      if (!isF) {
        const l1 = triNormal(ts[0], n1), l2 = triNormal(ts[1], n2);
        if (l1 > EPS * L * L && l2 > EPS * L * L && (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]) < cosF * l1 * l2) isF = true;
      }
      if (isF) { feat.set(e, -1); featEdges.push(r[0], r[1]); }
    }
  }
  // ---- size field: h, reduced where the surface is curved (κ ≈ normal turn / centroid distance across smooth edges)
  let sizeCells = null, sizeCell = 0;
  if (curvSegments > 0) {
    const nv0 = X.length, kap = new Float64Array(nv0), cen = (t) => { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2]; return [(X[a] + X[b] + X[c]) / 3, (Y[a] + Y[b] + Y[c]) / 3, (Z[a] + Z[b] + Z[c]) / 3]; };
    const n1 = [0, 0, 0], n2 = [0, 0, 0], adj = Array.from({ length: nv0 }, () => []);
    const em = new Map();
    for (let t = 0; t < nt0; t++) for (let k = 0; k < 3; k++) { const a = T[t * 3 + k], b = T[t * 3 + (k + 1) % 3], e = eKey(a, b); let r = em.get(e); if (!r) em.set(e, (r = [a, b])); r.push(t); }
    for (const [e, r] of em) {
      adj[r[0]].push(r[1]); adj[r[1]].push(r[0]);
      if (r.length !== 4 || feat.has(e)) continue;
      const l1 = triNormal(r[2], n1), l2 = triNormal(r[3], n2);
      if (!(l1 > 0 && l2 > 0)) continue;
      const th = Math.acos(Math.max(-1, Math.min(1, (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]) / (l1 * l2))));
      const c1 = cen(r[2]), c2 = cen(r[3]), d = Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]);
      if (d > 0) { const k = th / d; kap[r[0]] = Math.max(kap[r[0]], k); kap[r[1]] = Math.max(kap[r[1]], k); }
    }
    const sz = new Float64Array(nv0);
    for (let v = 0; v < nv0; v++) sz[v] = Math.max(h / 2, Math.min(h, kap[v] > 0 ? 2 * Math.PI / (curvSegments * kap[v]) : h));
    // gradation: the size may grow by at most half the distance between neighbours
    for (let pass = 0; pass < 20; pass++) {
      let ch = false;
      for (let v = 0; v < nv0; v++) for (const w of adj[v]) { const lim = sz[w] + 0.5 * len(v, w); if (sz[v] > lim) { sz[v] = lim; ch = true; } }
      if (!ch) break;
    }
    // size samples everywhere on the surface (≤ 2h apart), so every lookup is local
    const st = [];
    for (let t = 0; t < nt0; t++) for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; st.push(X[v], Y[v], Z[v], sz[v]); }
    // per-cell minimum of the size samples (cells of h/2): the size field is smooth, so this is an O(1) lookup
    sizeCell = h / 2;
    const fine = bisectToSize(st, sizeCell, 4000000, 4);
    sizeCells = new Map();
    for (let i = 0; i < fine.length; i += 4) {
      const key = cellKey(Math.floor(fine[i] / sizeCell), Math.floor(fine[i + 1] / sizeCell), Math.floor(fine[i + 2] / sizeCell));
      const cur = sizeCells.get(key); if (cur === undefined || fine[i + 3] < cur) sizeCells.set(key, fine[i + 3]);
    }
  }
  const vtype = X.map(() => 0);   // 0 free, 1 on a feature curve, 2 corner (fixed)
  const vfe = X.map(() => []);
  for (let i = 0; i < featEdges.length; i += 2) { vfe[featEdges[i]].push(featEdges[i + 1]); vfe[featEdges[i + 1]].push(featEdges[i]); }
  const isBoundaryV = X.map(() => 0);
  {
    const em = new Map();
    for (let t = 0; t < nt0; t++) for (let k = 0; k < 3; k++) { const e = eKey(T[t * 3 + k], T[t * 3 + (k + 1) % 3]); em.set(e, (em.get(e) || 0) + 1); }
    for (const [e, c] of em) if (c === 1) { isBoundaryV[Math.floor(e / 4194304)] = 1; isBoundaryV[e % 4194304] = 1; }
  }
  const cosC = Math.cos(cornerDeg * Math.PI / 180);
  for (let v = 0; v < X.length; v++) {
    const f = vfe[v];
    if (!f.length) continue;
    if (f.length !== 2 || (fixedBoundary && isBoundaryV[v])) { vtype[v] = 2; continue; }
    const [a, b] = f;
    const ux = X[v] - X[a], uy = Y[v] - Y[a], uz = Z[v] - Z[a], wx = X[b] - X[v], wy = Y[b] - Y[v], wz = Z[b] - Z[v];
    const c = (ux * wx + uy * wy + uz * wz) / (Math.hypot(ux, uy, uz) * Math.hypot(wx, wy, wz) || 1);
    vtype[v] = c < cosC ? 2 : 1;
  }
  // curve ids: chains of feature edges between corners (closed loops get one id)
  const refSegs = [], refSegId = [];
  {
    let id = 0;
    const done = new Set();
    const walk = (start, next) => {
      let prev = start, cur = next;
      const e0 = eKey(start, next);
      if (done.has(e0)) return;
      done.add(e0); feat.set(e0, id); refSegs.push(X[start], Y[start], Z[start], X[next], Y[next], Z[next]); refSegId.push(id);
      while (vtype[cur] === 1) {
        const [a, b] = vfe[cur]; const nx = a === prev ? b : a;
        const e = eKey(cur, nx);
        if (done.has(e)) break;
        done.add(e); feat.set(e, id); refSegs.push(X[cur], Y[cur], Z[cur], X[nx], Y[nx], Z[nx]); refSegId.push(id);
        prev = cur; cur = nx;
      }
      id++;
    };
    for (let v = 0; v < X.length; v++) if (vtype[v] === 2) for (const w of vfe[v]) walk(v, w);
    for (let v = 0; v < X.length; v++) if (vtype[v] === 1) for (const w of vfe[v]) walk(v, w);   // loops with no corner
  }
  const vcurve = X.map((_, v) => (vtype[v] === 1 ? feat.get(eKey(v, vfe[v][0])) : -1));
  // ---- projection references (the original surface and feature curves)
  const refSoup = planeZ === null ? bisectToSize(soup, 2 * h) : null;
  const surfGrid = refSoup ? new NearestGrid(refSoup, 9, 2 * h) : null;
  const segArr = new Float64Array(refSegs);
  const segIdAt = new Map(); for (let i = 0; i < refSegId.length; i++) segIdAt.set(i * 6, refSegId[i]);
  const curveGrid = refSegs.length ? new NearestGrid(segArr, 6, 2 * h) : null;
  const tmp = [0, 0, 0];
  const projectSurf = (v) => {
    if (planeZ !== null) { Z[v] = planeZ; return; }
    if (surfGrid.nearest(X[v], Y[v], Z[v], tmp) >= 0) { X[v] = tmp[0]; Y[v] = tmp[1]; Z[v] = tmp[2]; }
  };
  const projectCurve = (v, id) => {
    if (curveGrid && curveGrid.nearest(X[v], Y[v], Z[v], tmp, (o) => segIdAt.get(o) === id) >= 0) { X[v] = tmp[0]; Y[v] = tmp[1]; Z[v] = tmp[2]; }
  };
  const vsz = [];
  const sizeAt = (v) => {
    if (!sizeCells) return h;
    const i = Math.floor(X[v] / sizeCell), j = Math.floor(Y[v] / sizeCell), k = Math.floor(Z[v] / sizeCell);
    let s = sizeCells.get(cellKey(i, j, k));
    if (s !== undefined) return s;
    s = h; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const t = sizeCells.get(cellKey(i + a, j + b, k + c)); if (t !== undefined && t < s) s = t; }
    return s;
  };
  for (let v = 0; v < X.length; v++) vsz.push(sizeAt(v));
  const addVertex = (x, y, z, type, curve, bnd) => { X.push(x); Y.push(y); Z.push(z); vt.push(new Set()); vAlive.push(1); vtype.push(type); vcurve.push(curve); isBoundaryV.push(bnd); vsz.push(h); return X.length - 1; };
  const addTri = (a, b, c) => { T.push(a, b, c); alive.push(1); const t = alive.length - 1; vt[a].add(t); vt[b].add(t); vt[c].add(t); return t; };
  const killTri = (t) => { alive[t] = 0; for (let k = 0; k < 3; k++) vt[T[t * 3 + k]].delete(t); };
  const allEdges = () => {
    const s = new Map();
    for (let t = 0; t < alive.length; t++) if (alive[t]) for (let k = 0; k < 3; k++) { const a = T[t * 3 + k], b = T[t * 3 + (k + 1) % 3], e = eKey(a, b); if (!s.has(e)) s.set(e, [a, b]); }
    return [...s.values()];
  };
  const hiE = (a, b) => (2 / 3) * (vsz[a] + vsz[b]), loE = (a, b) => (2 / 5) * (vsz[a] + vsz[b]);   // 4/3 and 4/5 of the mean size

  // ---- operations
  function splitLong() {
    let any = true, guard = 0;
    while (any && guard++ < 40) {
      any = false;
      const edges = allEdges().filter(([a, b]) => len(a, b) > hiE(a, b)).sort((p, q) => len(q[0], q[1]) - len(p[0], p[1]));
      for (const [a, b] of edges) {
        if (!vAlive[a] || !vAlive[b] || len(a, b) <= hiE(a, b)) continue;
        const ts = edgeTris(a, b);
        if (!ts.length) continue;
        const e = eKey(a, b), isF = feat.has(e), bnd = ts.length === 1;
        if (fixedBoundary && bnd) continue;
        const m = addVertex((X[a] + X[b]) / 2, (Y[a] + Y[b]) / 2, (Z[a] + Z[b]) / 2, isF ? 1 : 0, isF ? feat.get(e) : -1, bnd ? 1 : 0);
        for (const t of ts) {
          const v = [T[t * 3], T[t * 3 + 1], T[t * 3 + 2]];
          const ia = v.indexOf(a), ib = v.indexOf(b), c = v[3 - ia - ib];
          killTri(t);
          if ((ia + 1) % 3 === ib) { addTri(a, m, c); addTri(m, b, c); } else { addTri(b, m, c); addTri(m, a, c); }
        }
        if (isF) { const id = feat.get(e); feat.delete(e); feat.set(eKey(a, m), id); feat.set(eKey(m, b), id); projectCurve(m, id); } else projectSurf(m);
        vsz[m] = 0.5 * (vsz[a] + vsz[b]);   // refreshed from the size field after relaxation
        any = true;
      }
    }
  }
  const n0 = [0, 0, 0], n1 = [0, 0, 0];
  function tryCollapse(a, b) {   // remove a, keep b
    if (vtype[a] === 2) return false;
    const e = eKey(a, b), isF = feat.has(e);
    if (vtype[a] === 1 && !(isF && feat.get(e) === vcurve[a])) return false;
    if (vtype[a] === 0 && isBoundaryV[a]) return false;
    if (!isF && vtype[a] >= 1 && vtype[b] >= 1) return false;
    const ts = edgeTris(a, b);
    if (!ts.length) return false;
    if (fixedBoundary && isBoundaryV[a]) return false;
    const na = nbrs(a), nb = nbrs(b);
    let common = 0; for (const w of na) if (nb.has(w)) common++;
    if (common !== ts.length) return false;
    for (const w of na) if (w !== b && len(b, w) > hiE(b, w)) return false;
    // no folded or degenerate triangles. CAD input is often all slivers, so a collapse is only refused when it makes
    // a triangle degenerate that was not already, or turns one over; later passes improve the shapes.
    for (const t of vt[a]) {
      if (ts.includes(t)) continue;
      const l0 = triNormal(t, n0);
      const k = [T[t * 3], T[t * 3 + 1], T[t * 3 + 2]].indexOf(a);
      T[t * 3 + k] = b; const l1 = triNormal(t, n1); T[t * 3 + k] = a;
      let emax = 0; for (let q = 0; q < 3; q++) { const p = T[t * 3 + q] === a ? b : T[t * 3 + q], r = T[t * 3 + (q + 1) % 3] === a ? b : T[t * 3 + (q + 1) % 3]; emax = Math.max(emax, len(p, r)); }
      if (l1 < 1e-6 * emax * emax && l1 < l0) return false;
      if (l0 > 1e-6 * emax * emax && (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) < 0.2 * l0 * l1) return false;
    }
    // apply: feature edges at a move to b
    for (const w of na) { const ea = eKey(a, w); if (feat.has(ea)) { const id = feat.get(ea); feat.delete(ea); if (w !== b) feat.set(eKey(b, w), id); } }
    for (const t of [...vt[a]]) {
      if (ts.includes(t)) { killTri(t); continue; }
      const k = [T[t * 3], T[t * 3 + 1], T[t * 3 + 2]].indexOf(a);
      T[t * 3 + k] = b; vt[a].delete(t); vt[b].add(t);
    }
    vAlive[a] = 0;
    if (isBoundaryV[a]) isBoundaryV[b] = 1;
    return true;
  }
  function collapseShort() {
    for (let sweep = 0; sweep < 20; sweep++) {
      let n = 0;
      const edges = allEdges().filter(([a, b]) => len(a, b) < loE(a, b)).sort((p, q) => len(p[0], p[1]) - len(q[0], q[1]));
      for (const [a, b] of edges) {
        if (!vAlive[a] || !vAlive[b] || len(a, b) >= loE(a, b) || !edgeTris(a, b).length) continue;
        if (tryCollapse(a, b) || tryCollapse(b, a)) n++;
      }
      if (!n) break;
    }
  }
  function valence(v) { return vt[v].size + (isBoundaryV[v] ? 1 : 0); }
  const target = (v) => (isBoundaryV[v] ? 4 : 6);
  // mode 'valence': flip toward valence 6/4; mode 'delaunay': flip when the two opposite angles sum to more than π
  // (maximises the smallest angle; used at the end and essential on lids, whose boundary vertices are fixed)
  const angleAt = (p, q, r) => { const ux = X[q] - X[p], uy = Y[q] - Y[p], uz = Z[q] - Z[p], wx = X[r] - X[p], wy = Y[r] - Y[p], wz = Z[r] - Z[p]; return Math.acos(Math.max(-1, Math.min(1, (ux * wx + uy * wy + uz * wz) / (Math.hypot(ux, uy, uz) * Math.hypot(wx, wy, wz) || 1)))); };
  function flipEdges(mode = 'valence') {
    let flips = 0;
    for (const [a, b] of allEdges()) {
      if (!vAlive[a] || !vAlive[b] || feat.has(eKey(a, b))) continue;
      const ts = edgeTris(a, b);
      if (ts.length !== 2) continue;
      const [t1, t2] = ts;
      const v1 = [T[t1 * 3], T[t1 * 3 + 1], T[t1 * 3 + 2]], v2 = [T[t2 * 3], T[t2 * 3 + 1], T[t2 * 3 + 2]];
      // orient so that t1 = (a, b, c) and t2 = (b, a, d)
      let A = a, B = b;
      if ((v1.indexOf(a) + 1) % 3 !== v1.indexOf(b)) { A = b; B = a; }
      const tA = (v1.indexOf(A) + 1) % 3 === v1.indexOf(B) ? v1 : v2, tB = tA === v1 ? v2 : v1;
      const c = tA[3 - tA.indexOf(A) - tA.indexOf(B)], d = tB[3 - tB.indexOf(A) - tB.indexOf(B)];
      if (c === d || nbrs(c).has(d)) continue;
      if (mode === 'valence') {
        const before = (valence(A) - target(A)) ** 2 + (valence(B) - target(B)) ** 2 + (valence(c) - target(c)) ** 2 + (valence(d) - target(d)) ** 2;
        const after = (valence(A) - 1 - target(A)) ** 2 + (valence(B) - 1 - target(B)) ** 2 + (valence(c) + 1 - target(c)) ** 2 + (valence(d) + 1 - target(d)) ** 2;
        if (after >= before) continue;
      } else if (angleAt(c, A, B) + angleAt(d, A, B) <= Math.PI + 1e-9) continue;
      // geometry: the quad must be nearly planar and the new triangles must not fold
      const la = triNormal(tA === v1 ? t1 : t2, n0), lb = triNormal(tA === v1 ? t2 : t1, n1);
      if ((n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) < Math.cos(30 * Math.PI / 180) * la * lb) continue;
      const avg = [n0[0] / la + n1[0] / lb, n0[1] / la + n1[1] / lb, n0[2] / la + n1[2] / lb];
      const ok = [[A, d, c], [d, B, c]].every(([p, q, r]) => {
        const ux = X[q] - X[p], uy = Y[q] - Y[p], uz = Z[q] - Z[p], wx = X[r] - X[p], wy = Y[r] - Y[p], wz = Z[r] - Z[p];
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz);
        return l > 1e-6 * h * h && (nx * avg[0] + ny * avg[1] + nz * avg[2]) > 0.8 * l * Math.hypot(...avg);
      });
      if (!ok) continue;
      killTri(t1); killTri(t2); addTri(A, d, c); addTri(d, B, c); flips++;
    }
    return flips;
  }
  function relax() {
    const vn = [0, 0, 0], nn = [0, 0, 0];
    for (let v = 0; v < X.length; v++) {
      if (!vAlive[v] || vtype[v] === 2 || (fixedBoundary && isBoundaryV[v]) || !vt[v].size) continue;
      const ox = X[v], oy = Y[v], oz = Z[v];
      const before = [...vt[v]].map((t) => { triNormal(t, nn); return nn.slice(); });
      if (vtype[v] === 1) {
        const w = [...nbrs(v)].filter((u) => feat.has(eKey(u, v)));
        if (w.length !== 2) continue;
        X[v] = (X[w[0]] + X[w[1]]) / 2; Y[v] = (Y[w[0]] + Y[w[1]]) / 2; Z[v] = (Z[w[0]] + Z[w[1]]) / 2;
        projectCurve(v, vcurve[v]);
      } else {
        // area-weighted centroid of the 1-ring, moved in the tangent plane only
        let sx = 0, sy = 0, sz = 0, sw = 0; vn[0] = vn[1] = vn[2] = 0;
        for (const t of vt[v]) {
          const l = triNormal(t, nn); vn[0] += nn[0]; vn[1] += nn[1]; vn[2] += nn[2];
          const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
          sx += l * (X[a] + X[b] + X[c]) / 3; sy += l * (Y[a] + Y[b] + Y[c]) / 3; sz += l * (Z[a] + Z[b] + Z[c]) / 3; sw += l;
        }
        if (!(sw > 0)) continue;
        const ln = Math.hypot(...vn) || 1, nx = vn[0] / ln, ny = vn[1] / ln, nz = vn[2] / ln;
        let dx = sx / sw - ox, dy = sy / sw - oy, dz = sz / sw - oz;
        const dn = dx * nx + dy * ny + dz * nz; dx -= dn * nx; dy -= dn * ny; dz -= dn * nz;
        X[v] = ox + dx; Y[v] = oy + dy; Z[v] = oz + dz;
        projectSurf(v);
      }
      // revert if any incident triangle flipped or collapsed
      let k = 0, bad = false;
      for (const t of vt[v]) { const l = triNormal(t, nn), b = before[k++], lb = Math.hypot(...b); if (l < 1e-8 * h * h || (nn[0] * b[0] + nn[1] * b[1] + nn[2] * b[2]) < 0.3 * l * lb) { bad = true; break; } }
      if (bad) { X[v] = ox; Y[v] = oy; Z[v] = oz; } else if (sizeCells) vsz[v] = sizeAt(v);
    }
  }
  collapseShort();
  for (let it = 0; it < iterations; it++) { splitLong(); collapseShort(); flipEdges(); relax(); }
  for (let k = 0; k < 10 && flipEdges('delaunay'); k++);
  relax();
  for (let k = 0; k < 10 && flipEdges('delaunay'); k++);
  // ---- output
  const out = [];
  for (let t = 0; t < alive.length; t++) if (alive[t]) for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; out.push(X[v], Y[v], Z[v]); }
  const res = new Float64Array(out);
  return { soup: res, stats: meshQuality(res) };
}

// Triangle quality: q = 4√3·A / Σ edge² (1 for an equilateral triangle), minimum angle, edge lengths.
export function meshQuality(s) {
  let qMin = Infinity, qSum = 0, angMin = 180, eMin = Infinity, eMax = 0, eSum = 0, n = 0;
  for (let i = 0; i < s.length; i += 9) {
    const P = [[s[i], s[i + 1], s[i + 2]], [s[i + 3], s[i + 4], s[i + 5]], [s[i + 6], s[i + 7], s[i + 8]]];
    const e = [0, 1, 2].map((k) => Math.hypot(...P[(k + 1) % 3].map((v, j) => v - P[k][j])));
    const A = triArea(s, i), q = 4 * Math.sqrt(3) * A / (e[0] ** 2 + e[1] ** 2 + e[2] ** 2 || 1);
    qMin = Math.min(qMin, q); qSum += q; n++;
    for (let k = 0; k < 3; k++) {
      const a = e[k], b = e[(k + 1) % 3], c = e[(k + 2) % 3];   // angle opposite c
      angMin = Math.min(angMin, Math.acos(Math.max(-1, Math.min(1, (a * a + b * b - c * c) / (2 * a * b || 1)))) * 180 / Math.PI);
      eMin = Math.min(eMin, e[k]); eMax = Math.max(eMax, e[k]); eSum += e[k];
    }
  }
  return { tris: n, qMin, qMean: qSum / Math.max(n, 1), minAngle: angMin, edgeMin: eMin, edgeMax: eMax, edgeMean: eSum / Math.max(3 * n, 1) };
}

// ------------------------------------------------------------------ interior waterplane (lid)
// Closed waterline loops of a wetted-surface soup (its boundary edges on z = 0). Outer loops come out
// counter-clockwise seen from above, holes (a moonpool) clockwise.
export function waterlineLoops(soup, tol) {
  const key = (x, y) => `${Math.round(x / tol)},${Math.round(y / tol)}`;
  const cnt = new Map(), pts = new Map();
  for (let i = 0; i < soup.length; i += 9) for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3;
    if (Math.abs(soup[i + a * 3 + 2]) > tol || Math.abs(soup[i + b * 3 + 2]) > tol) continue;
    const ka = key(soup[i + a * 3], soup[i + a * 3 + 1]), kb = key(soup[i + b * 3], soup[i + b * 3 + 1]);
    if (ka === kb) continue;
    pts.set(ka, [soup[i + a * 3], soup[i + a * 3 + 1]]); pts.set(kb, [soup[i + b * 3], soup[i + b * 3 + 1]]);
    // interior waterplane edges are shared by two triangles; boundary ones appear once (a → b on the hull)
    const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const r = cnt.get(e); if (r) r.n++; else cnt.set(e, { n: 1, from: kb, to: ka });   // hull a → b runs clockwise from above
  }
  const next = new Map();
  for (const r of cnt.values()) if (r.n === 1) next.set(r.from, r.to);
  const loops = [], seen = new Set();
  for (const k0 of next.keys()) {
    if (seen.has(k0)) continue;
    const loop = []; let k = k0;
    while (k !== undefined && !seen.has(k)) { seen.add(k); loop.push(pts.get(k)); k = next.get(k); }
    if (k === k0 && loop.length >= 3) loops.push(loop);
  }
  return loops;
}
const polyArea = (L) => L.reduce((s, p, i) => { const q = L[(i + 1) % L.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

// Sutherland–Hodgman clip of a polygon to coordinate[axis] ≥ val.
function clipPoly(L, axis, val) {
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const P = L[i], Q = L[(i + 1) % L.length], dp = P[axis] - val, dq = Q[axis] - val;
    if (dp >= 0) out.push(P);
    if ((dp >= 0) !== (dq >= 0) && dp !== dq) { const t = dp / (dp - dq); const R = [P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]; R[axis] = val; out.push(R); }
  }
  // drop repeated points
  return out.filter((p, i) => { const q = out[(i + 1) % out.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-12; });
}
// subdivide edges longer than h
function resample(L, h) {
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const P = L[i], Q = L[(i + 1) % L.length], n = Math.max(1, Math.ceil(Math.hypot(Q[0] - P[0], Q[1] - P[1]) / h));
    for (let k = 0; k < n; k++) out.push([P[0] + (Q[0] - P[0]) * k / n, P[1] + (Q[1] - P[1]) * k / n]);
  }
  return out;
}
// Ear-clipping triangulation of a polygon with holes (holes joined to the outer loop by bridges, Eberly 2008).
function triangulate(outer, holes) {
  let poly = outer.slice();
  const segX = (a, b, c, d) => {   // proper intersection of segments ab and cd
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (const H of [...holes].sort((p, q) => Math.max(...q.map((v) => v[0])) - Math.max(...p.map((v) => v[0])))) {
    const hi = H.reduce((m, p, i) => (p[0] > H[m][0] ? i : m), 0), M = H[hi];
    let best = -1, bd = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const P = poly[i], d = Math.hypot(P[0] - M[0], P[1] - M[1]);
      if (d >= bd) continue;
      let vis = true;
      for (const L of [poly, ...holes]) for (let j = 0; j < L.length && vis; j++) { const A = L[j], B = L[(j + 1) % L.length]; if (A !== P && B !== P && A !== M && B !== M && segX(M, P, A, B)) vis = false; }
      if (vis) { bd = d; best = i; }
    }
    if (best < 0) return null;
    const ring = [...H.slice(hi), ...H.slice(0, hi), M];
    poly = [...poly.slice(0, best + 1), ...ring, poly[best], ...poly.slice(best + 1)];
  }
  // tolerances relative to the polygon size: boundaries along straight hull sides are collinear only to round-off
  let ext = 0; for (const p of poly) ext = Math.max(ext, Math.abs(p[0]), Math.abs(p[1]));
  for (const p of poly) ext = Math.max(ext, Math.abs(p[0] - poly[0][0]), Math.abs(p[1] - poly[0][1]));
  const eps = 1e-10 * ext * ext;
  const tris = [], idx = poly.map((_, i) => i);
  let guard = 0;
  while (idx.length > 3 && guard++ < 200000) {
    let clipped = false;
    for (let t = 0; t < idx.length; t++) {
      const ia = idx[(t + idx.length - 1) % idx.length], ib = idx[t], ic = idx[(t + 1) % idx.length];
      const A = poly[ia], B = poly[ib], C = poly[ic];
      const cr = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (cr <= eps) continue;   // reflex or (near-)collinear tip
      let blocked = false;
      for (const id of idx) {
        if (id === ia || id === ib || id === ic) continue;
        const p = poly[id];
        if ((p[0] === A[0] && p[1] === A[1]) || (p[0] === B[0] && p[1] === B[1]) || (p[0] === C[0] && p[1] === C[1])) continue;   // bridge duplicates
        const d1 = (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]);
        const d2 = (C[0] - B[0]) * (p[1] - B[1]) - (C[1] - B[1]) * (p[0] - B[0]);
        const d3 = (A[0] - C[0]) * (p[1] - C[1]) - (A[1] - C[1]) * (p[0] - C[0]);
        // strictly inside, or on the new diagonal C→A (which would make the remaining polygon touch itself)
        if (d1 > eps && d2 > eps && d3 > -eps) { blocked = true; break; }
      }
      if (blocked) continue;
      tris.push(A[0], A[1], 0, B[0], B[1], 0, C[0], C[1], 0);
      idx.splice(t, 1); clipped = true; break;
    }
    if (!clipped) return null;
  }
  if (idx.length === 3) { const [a, b, c] = idx.map((i) => poly[i]); tris.push(a[0], a[1], 0, b[0], b[1], 0, c[0], c[1], 0); }
  return new Float64Array(tris);
}
// Waterplane polygons (outer loops counter-clockwise, holes clockwise) → triangles, or null if ear clipping fails.
function triangulateLoops(L) {
  const outers = L.filter((l) => polyArea(l) > 0), holes = L.filter((l) => polyArea(l) < 0);
  const parts = [];
  for (const o of outers) {
    const inside = holes.filter((hl) => pointInPoly(hl[0], o));
    const t = triangulate(o, inside);
    if (!t) return null;
    parts.push(t);
  }
  if (!parts.length) return null;
  const soup = new Float64Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { soup.set(p, o); o += p.length; }
  return soup;
}
// Lid from the full waterline loops; with symmetry, only the part with x ≥ x0 and/or y ≥ y0. Triangles face +z.
export function buildLid(loops, h, sym = {}) {
  let L = loops.map((l) => l.slice());
  if (sym.x) L = L.map((l) => clipPoly(l, 0, sym.x0)).filter((l) => l.length >= 3);
  if (sym.y) L = L.map((l) => clipPoly(l, 1, sym.y0)).filter((l) => l.length >= 3);
  L = L.map((l) => resample(l, h)).filter((l) => Math.abs(polyArea(l)) > 1e-12);
  let soup = triangulateLoops(L);
  if (soup) return remesh(soup, h, { fixedBoundary: true, planeZ: 0, iterations: 6 }).soup;
  if (!sym.x && !sym.y) return null;
  // A moonpool that crosses a symmetry plane can't be clipped loop by loop: its clipped part touches the cut, so it is
  // neither a hole nor part of the outline. Triangulate the whole waterplane instead and cut it like the hull.
  soup = triangulateLoops(loops.map((l) => resample(l, h)).filter((l) => Math.abs(polyArea(l)) > 1e-12));
  if (!soup) return null;
  let ext = 0; for (const l of loops) for (const p of l) ext = Math.max(ext, Math.abs(p[0]), Math.abs(p[1]));
  if (sym.x) soup = clipSoup(soup, 0, sym.x0, false, 1e-9 * ext);
  if (sym.y) soup = clipSoup(soup, 1, sym.y0, false, 1e-9 * ext);
  return soup.length ? remesh(soup, h, { planeZ: 0, iterations: 6 }).soup : null;
}
function pointInPoly(p, L) {
  let c = false;
  for (let i = 0, j = L.length - 1; i < L.length; j = i++) {
    const a = L[i], b = L[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

// mirror images of a symmetric part (x = x0 and/or y = y0), orientation kept
export function mirrorSoup(q, sym) {
  const parts = [q];
  const mir = (s, ax, v) => { const o = new Float64Array(s.length); for (let i = 0; i < s.length; i += 9) for (const [d, src] of [[0, 0], [3, 6], [6, 3]]) { for (let k = 0; k < 3; k++) o[i + d + k] = s[i + src + k]; o[i + d + ax] = 2 * v - o[i + d + ax]; } return o; };
  if (sym.x) parts.push(...parts.map((p) => mir(p, 0, sym.x0)));
  if (sym.y) parts.push(...parts.map((p) => mir(p, 1, sym.y0)));
  const out = new Float64Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ------------------------------------------------------------------ the BEM mesh of a floating hull
// rel: hull triangles relative to G (outward normals), still waterline at z = zw. h: panel size (body), hLid: lid
// panel size (default h). Returns the soups and metadata buildPanels needs, in BEM coordinates (z measured from the
// waterline, x and y as in rel).
// snapTol: CAD vertices this close to the waterline are moved onto it (default 1e-9 of the body size), so a vertex ring
// a hair's breadth from the waterline does not leave a band of micro-slivers.
export function wettedSurface(rel, zw, snapTol = 0) {
  let L = 0; for (let i = 0; i < rel.length; i++) L = Math.max(L, Math.abs(rel[i]));
  const tol = Math.max(1e-9 * L, snapTol);
  const s = new Float64Array(rel.length);
  for (let i = 0; i < rel.length; i += 3) {
    s[i] = rel[i]; s[i + 1] = rel[i + 1]; s[i + 2] = rel[i + 2] - zw;
    if (Math.abs(s[i + 2]) < tol) s[i + 2] = 0;
  }
  const wet = clipSoup(s, 2, 0, true);
  // drop slivers and faces lying in the waterplane itself (not wetted)
  const out = [];
  for (let i = 0; i < wet.length; i += 9) {
    if (triArea(wet, i) <= 1e-12 * L * L) continue;
    if (wet[i + 2] === 0 && wet[i + 5] === 0 && wet[i + 8] === 0) continue;
    for (let k = 0; k < 9; k++) out.push(wet[i + k]);
  }
  return { wet: new Float64Array(out), L };
}
export function prepareBemMesh(rel, zw, { h, hLid = null, irr = true, symmetry = true, curvSegments = 20 } = {}) {
  if (!h) h = Math.sqrt(soupArea(wettedSurface(rel, zw).wet) / (0.433 * 800));
  const { wet, L } = wettedSurface(rel, zw, 1e-3 * h);
  const wettedArea = soupArea(wet);
  const sx = symmetry ? symmetryOf(wet, 0) : { sym: false, x0: 0, err: NaN }, sy = symmetry ? symmetryOf(wet, 1) : { sym: false, x0: 0, err: NaN };
  // a symmetry plane through G (within CAD tessellation noise) is placed exactly on G, so no moment transfer is needed
  const snap = (v) => (Math.abs(v) < 1e-5 * L ? 0 : v);
  const sym = { x: sx.sym, y: sy.sym, x0: sx.sym ? snap(sx.x0) : 0, y0: sy.sym ? snap(sy.x0) : 0 };
  let part = wet;
  if (sym.x) part = clipSoup(part, 0, sym.x0, false, 1e-6 * L);
  if (sym.y) part = clipSoup(part, 1, sym.y0, false, 1e-6 * L);
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const body = remesh(part, h, { curvSegments });
  const bodyQ = body.soup;
  let lidQ = null;
  if (irr) {
    const loops = waterlineLoops(mirrorSoup(bodyQ, sym), 1e-7 * L);
    if (loops.length) lidQ = buildLid(loops, hLid || h, sym);
  }
  const mult = (sym.x ? 2 : 1) * (sym.y ? 2 : 1);
  return {
    bodyQ, lidQ, sym, h, wettedArea, panelArea: soupArea(bodyQ) * mult,
    panels: (bodyQ.length / 9) * mult, lidPanels: lidQ ? (lidQ.length / 9) * mult : 0,
    symErr: [sx.err, sy.err], quality: body.stats, ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0,
  };
}
