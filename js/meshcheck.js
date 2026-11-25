// Mesh checks and repair for imported triangle soups (9 numbers per triangle, outward counter-clockwise winding).
//
// Watertight and consistently oriented means: after welding vertices that lie within `tol`, every directed edge
// p→q is matched by as many q→p (directed-edge balance). This accepts closed B-rep tessellations with degenerate
// pole triangles and rejects faces whose winding disagrees with their neighbours, which an undirected count misses.
//
// repairMesh re-orients faces by propagation across shared edges (each shell takes the winding of most of its faces),
// then turns a whole shell inside out only when its volume is negative and it is not inside another shell (a negative
// shell inside another one is a void). It also reports open edges, shells, voids and overlapping shells.

// ---------------------------------------------------------------- welding
export function weld(tris, tol) {
  const n = tris.length / 3;
  const vid = new Int32Array(n);
  const ids = new Map(); let next = 0;
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(tris[i * 3] / tol)},${Math.round(tris[i * 3 + 1] / tol)},${Math.round(tris[i * 3 + 2] / tol)}`;
    let v = ids.get(k);
    if (v === undefined) { v = next++; ids.set(k, v); }
    vid[i] = v;
  }
  return { vid, nVerts: next };
}

const EKEY = 4294967296;
// edge table: key(min,max) → { f: uses min→max, b: uses max→min, t: triangles using it }
function edgeTable(vid, nTri, skip) {
  const E = new Map();
  for (let t = 0; t < nTri; t++) {
    if (skip[t]) continue;
    for (let k = 0; k < 3; k++) {
      const p = vid[t * 3 + k], q = vid[t * 3 + (k + 1) % 3];
      const key = p < q ? p * EKEY + q : q * EKEY + p;
      let e = E.get(key);
      if (!e) { e = { f: 0, b: 0, t: [] }; E.set(key, e); }
      if (p < q) e.f++; else e.b++;
      e.t.push(t);
    }
  }
  return E;
}
// does triangle t traverse edge (lo, hi) as lo→hi?
function forward(vid, t, lo, hi) {
  for (let k = 0; k < 3; k++) if (vid[t * 3 + k] === lo && vid[t * 3 + (k + 1) % 3] === hi) return true;
  return false;
}

// ---------------------------------------------------------------- checks
// open: edges whose total use is odd (an edge on a hole is used once); misoriented: edges used an even number of
// times but not as often in each direction (neighbouring faces wound the same way). Closed and consistently oriented
// ⇔ open = misoriented = 0. Degenerate triangles (two corners welded together) are left out of the edge count.
export function meshCheck(tris, tol) {
  const nTri = tris.length / 9;
  const { vid } = weld(tris, tol);
  const skip = new Uint8Array(nTri);
  let degenerate = 0;
  for (let t = 0; t < nTri; t++) {
    const a = vid[t * 3], b = vid[t * 3 + 1], c = vid[t * 3 + 2];
    if (a === b || b === c || c === a) { skip[t] = 1; degenerate++; }
  }
  const E = edgeTable(vid, nTri, skip);
  let open = 0, misoriented = 0, nonManifold = 0;
  for (const e of E.values()) {
    const n = e.f + e.b;
    if (n % 2 === 1) open++;
    else if (e.f !== e.b) misoriented++;
    if (n > 2) nonManifold++;
  }
  return { triangles: nTri, degenerate, edges: E.size, open, misoriented, nonManifold, vid, skip, E };
}

// ---------------------------------------------------------------- volume about a reference point
// Signed volume and its first moments, from tetrahedra with apex p. For a closed, consistently oriented surface the
// result does not depend on p (proofs/Proofs/Mesh.lean, `vol_apex_indep`). For a surface whose only openings are flat
// and level at the top, p on that level makes the missing lids contribute nothing, so the result is the volume
// enclosed with the openings closed by flat lids.
export function signedVolume(tris, p, list = null) {
  let V = 0, mx = 0, my = 0, mz = 0;
  const n = list ? list.length : tris.length / 9;
  for (let j = 0; j < n; j++) {
    const i = (list ? list[j] : j) * 9;
    const ax = tris[i] - p[0], ay = tris[i + 1] - p[1], az = tris[i + 2] - p[2];
    const bx = tris[i + 3] - p[0], by = tris[i + 4] - p[1], bz = tris[i + 5] - p[2];
    const cx = tris[i + 6] - p[0], cy = tris[i + 7] - p[1], cz = tris[i + 8] - p[2];
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    V += det; mx += det * (ax + bx + cx); my += det * (ay + by + cy); mz += det * (az + bz + cz);
  }
  return { V: V / 6, m: [mx / 24, my / 24, mz / 24] };
}

// Top-centre of the bounding box: the reference point for open hulls (opening at the deck level).
export function topCentre(tris) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z > z1) z1 = z;
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2, z1];
}

// Generalised winding number of point q with respect to the listed triangles (Van Oosterom & Strackee 1983 solid
// angle): 1 inside a closed outward-oriented shell, 0 outside, −1 inside an inward-oriented one.
export function windingNumber(tris, list, q) {
  let w = 0;
  for (const t of list) {
    const i = t * 9;
    const ax = tris[i] - q[0], ay = tris[i + 1] - q[1], az = tris[i + 2] - q[2];
    const bx = tris[i + 3] - q[0], by = tris[i + 4] - q[1], bz = tris[i + 5] - q[2];
    const cx = tris[i + 6] - q[0], cy = tris[i + 7] - q[1], cz = tris[i + 8] - q[2];
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (ax * cx + ay * cy + az * cz) * lb + (bx * cx + by * cy + bz * cz) * la;
    w += 2 * Math.atan2(det, den);
  }
  return w / (4 * Math.PI);
}

// ---------------------------------------------------------------- repair
// Returns { tris (a new soup), flipped, report }. report: { triangles, degenerate, open, misoriented (after repair),
// misorientedBefore, nonOrientable, shells, closedShells, voids, overlaps, inverted (whole shells turned) }.
export function repairMesh(src, tol) {
  const tris = Float64Array.from(src);
  const nTri = tris.length / 9;
  const chk = meshCheck(tris, tol);
  const { vid, skip, E } = chk;

  // shells: triangles joined through any shared edge (union-find)
  const parent = new Int32Array(nTri); for (let t = 0; t < nTri; t++) parent[t] = t;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const e of E.values()) for (let k = 1; k < e.t.length; k++) { const a = find(e.t[0]), b = find(e.t[k]); if (a !== b) parent[a] = b; }

  // orientation by propagation across manifold edges (used by exactly two triangles)
  const adj = new Map();   // triangle → [[neighbour, sameDirection]]
  const link = (a, b, same) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push([b, same]); };
  for (const [key, e] of E) {
    if (e.t.length !== 2) continue;
    const lo = Math.floor(key / EKEY), hi = key - lo * EKEY;
    const [a, b] = e.t;
    const same = forward(vid, a, lo, hi) === forward(vid, b, lo, hi);
    link(a, b, same); link(b, a, same);
  }
  const flip = new Int8Array(nTri).fill(-1);
  let nonOrientable = 0;
  for (let s = 0; s < nTri; s++) {
    if (skip[s] || flip[s] !== -1) continue;
    const comp = [s]; flip[s] = 0;
    for (let h = 0; h < comp.length; h++) {
      const t = comp[h];
      for (const [u, same] of adj.get(t) || []) {
        const want = same ? 1 - flip[t] : flip[t];
        if (flip[u] === -1) { flip[u] = want; comp.push(u); } else if (flip[u] !== want) nonOrientable++;
      }
    }
    // keep the winding most of the component's faces already have
    let nf = 0; for (const t of comp) nf += flip[t];
    if (2 * nf > comp.length) for (const t of comp) flip[t] = 1 - flip[t];
  }
  const swap = (t) => { const i = t * 9; for (let k = 0; k < 3; k++) { const x = tris[i + 3 + k]; tris[i + 3 + k] = tris[i + 6 + k]; tris[i + 6 + k] = x; } };
  let flipped = 0;
  for (let t = 0; t < nTri; t++) if (flip[t] === 1) { swap(t); flipped++; }

  // shells after re-orientation: volume (top-centre reference), closedness, nesting
  const groups = new Map();
  for (let t = 0; t < nTri; t++) { if (skip[t]) continue; const r = find(t); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(t); }
  const shells = [...groups.values()].map((list) => ({ list, closed: true, V: 0, sign: 0 }));
  const after = flipped ? meshCheck(tris, tol) : chk;
  const shellOf = new Int32Array(nTri).fill(-1);
  shells.forEach((s, k) => { for (const t of s.list) shellOf[t] = k; });
  for (const e of after.E.values()) if ((e.f + e.b) % 2 === 1 || e.f !== e.b) shells[shellOf[e.t[0]]].closed = false;
  const ref = topCentre(tris);
  for (const s of shells) { s.V = signedVolume(tris, ref, s.list).V; }
  const big = Math.max(1e-300, ...shells.map((s) => Math.abs(s.V)));
  // sample points: centroids of a few spread-out faces
  const samples = (s) => {
    const out = [], n = s.list.length, m = Math.min(8, n);
    for (let j = 0; j < m; j++) {
      const i = s.list[Math.floor((j + 0.5) * n / m)] * 9;
      out.push([(tris[i] + tris[i + 3] + tris[i + 6]) / 3, (tris[i + 1] + tris[i + 4] + tris[i + 7]) / 3, (tris[i + 2] + tris[i + 5] + tris[i + 8]) / 3]);
    }
    return out;
  };
  let voids = 0, overlaps = 0, inverted = 0, nestChecked = shells.length <= 64;
  for (const [k, s] of shells.entries()) {
    if (Math.abs(s.V) < 1e-9 * big) continue;
    // how many other closed shells contain this one (all samples inside), or cut it (some inside, some outside)
    let inside = 0, cut = false;
    if (nestChecked && shells.length > 1) {
      const pts = samples(s);
      for (const [j, o] of shells.entries()) {
        if (j === k || !o.closed || Math.abs(o.V) < 1e-9 * big) continue;
        const ins = pts.map((q) => Math.abs(windingNumber(tris, o.list, q)) > 0.5);
        const nIn = ins.filter(Boolean).length;
        if (nIn === pts.length) inside++;
        else if (nIn > 0) cut = true;
      }
    }
    s.depth = inside; s.cut = cut;
    if (s.V < 0 && inside % 2 === 0) { for (const t of s.list) swap(t); s.V = -s.V; inverted++; flipped += s.list.length; }
    else if (s.V < 0) voids++;
    else if (inside % 2 === 1 || cut) overlaps++;
  }
  // turning a whole shell inside out swaps both directions of all its edges, so the balance found above still holds
  const fin = after;
  return {
    tris, flipped,
    report: {
      triangles: nTri, degenerate: chk.degenerate, open: fin.open, misoriented: fin.misoriented,
      misorientedBefore: chk.misoriented, nonOrientable, nonManifold: fin.nonManifold,
      shells: shells.length, closedShells: shells.filter((s) => s.closed).length,
      voids, overlaps, inverted, nestChecked, flipped,
    },
  };
}
