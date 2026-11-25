// Mesh checks and repair for imported triangle soups (9 numbers per triangle, outward counter-clockwise winding).
//
// Watertight and consistently oriented means: after welding vertices that lie within `tol` of each other, every
// directed edge p→q is matched by as many q→p (directed-edge balance). This accepts closed B-rep tessellations with
// degenerate pole triangles and rejects faces whose winding disagrees with their neighbours, which an undirected count
// misses.
//
// repairMesh re-orients faces by propagation across shared edges (each orientation component takes the winding of
// most of its faces). It then splits the mesh into shells: each orientation component that is closed on its own is a
// shell, and the components that are not closed on their own form one shell per edge-connected piece. A shell is turned
// inside out when its volume is negative and it is not inside another shell (a negative shell inside another one is a
// void), and a shell inside a turned shell is turned with it when its winding was opposite to that shell's (a hollow
// body exported inside out). Shells whose surfaces cross, or a positive shell inside another positive one, are reported
// as overlaps (their shared volume is counted twice). The boundary points of the openings (edges used by one triangle)
// are returned, so the hydrostatics can tell when an opening goes under water.

// ---------------------------------------------------------------- welding
// Vertices within distance tol of an earlier vertex take its id. A spatial hash on cells of size tol is searched in the
// vertex's own cell and its 26 neighbours, so two copies a hair apart on either side of a cell boundary are joined.
// Returns { vid (per corner), nVerts, pos (the coordinates of each id: those of its first vertex) }.
export function weld(tris, tol) {
  const n = tris.length / 3;
  const vid = new Int32Array(n);
  const inv = 1 / tol, tol2 = tol * tol;
  const cells = new Map();
  let pos = new Float64Array(Math.max(24, Math.min(n, 1 << 16) * 3)), next = 0;
  const hash = (i, j, k) => Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791);
  const look = (h, x, y, z) => {
    const b = cells.get(h);
    if (b === undefined) return -1;
    if (typeof b === 'number') {
      const dx = pos[b * 3] - x, dy = pos[b * 3 + 1] - y, dz = pos[b * 3 + 2] - z;
      return dx * dx + dy * dy + dz * dz <= tol2 ? b : -1;
    }
    for (const id of b) {
      const dx = pos[id * 3] - x, dy = pos[id * 3 + 1] - y, dz = pos[id * 3 + 2] - z;
      if (dx * dx + dy * dy + dz * dz <= tol2) return id;
    }
    return -1;
  };
  for (let i = 0; i < n; i++) {
    const x = tris[i * 3], y = tris[i * 3 + 1], z = tris[i * 3 + 2];
    const ci = Math.floor(x * inv), cj = Math.floor(y * inv), ck = Math.floor(z * inv);
    const h0 = hash(ci, cj, ck);
    let v = look(h0, x, y, z);
    for (let d = 0; v < 0 && d < 27; d++) {
      if (d === 13) continue;   // the own cell, already searched
      v = look(hash(ci + (d % 3) - 1, cj + (Math.floor(d / 3) % 3) - 1, ck + Math.floor(d / 9) - 1), x, y, z);
    }
    if (v < 0) {
      v = next++;
      if (v * 3 + 3 > pos.length) { const p = new Float64Array(pos.length * 2); p.set(pos); pos = p; }
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
      const b = cells.get(h0);
      if (b === undefined) cells.set(h0, v); else if (typeof b === 'number') cells.set(h0, [b, v]); else b.push(v);
    }
    vid[i] = v;
  }
  return { vid, nVerts: next, pos: pos.subarray(0, next * 3) };
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
  const { vid, pos } = weld(tris, tol);
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
  return { triangles: nTri, degenerate, edges: E.size, open, misoriented, nonManifold, vid, pos, skip, E };
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

// ---------------------------------------------------------------- crossing surfaces
// Does the segment p→q pass through triangle t? 2: through its interior (the surfaces cross); 1: through its edge or
// corner (decided by a probe); 0: no, or it only touches the triangle's plane (coplanar faces and segments that end on
// the plane are contact, not overlap). epsD: distance tolerance.
function segTri(tris, t, p, q, epsD) {
  const i = t * 9;
  const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
  const ux = tris[i + 3] - ax, uy = tris[i + 4] - ay, uz = tris[i + 5] - az;
  const vx = tris[i + 6] - ax, vy = tris[i + 7] - ay, vz = tris[i + 8] - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const nn = Math.hypot(nx, ny, nz);
  if (!(nn > 0)) return 0;
  const dp = (nx * (p[0] - ax) + ny * (p[1] - ay) + nz * (p[2] - az)) / nn;
  const dq = (nx * (q[0] - ax) + ny * (q[1] - ay) + nz * (q[2] - az)) / nn;
  if (Math.abs(dp) <= epsD || Math.abs(dq) <= epsD || (dp > 0) === (dq > 0)) return 0;
  const s = dp / (dp - dq);
  const x = p[0] + s * (q[0] - p[0]) - ax, y = p[1] + s * (q[1] - p[1]) - ay, z = p[2] + s * (q[2] - p[2]) - az;
  // barycentric coordinates of the crossing point in the triangle's plane
  const d00 = ux * ux + uy * uy + uz * uz, d01 = ux * vx + uy * vy + uz * vz, d11 = vx * vx + vy * vy + vz * vz;
  const d20 = x * ux + y * uy + z * uz, d21 = x * vx + y * vy + z * vz, den = d00 * d11 - d01 * d01;
  const b1 = (d11 * d20 - d01 * d21) / den, b2 = (d00 * d21 - d01 * d20) / den, b0 = 1 - b1 - b2;
  const m = Math.min(b0, b1, b2), e = 1e-9;
  return m > e ? 2 : m >= -e ? 1 : 0;
}

// ---------------------------------------------------------------- repair
// Returns { tris (a new soup), flipped, report }. report: { triangles, degenerate, open, misoriented (after repair),
// misorientedBefore, nonOrientable, nonManifold, shells, closedShells, voids, overlaps, inverted (whole shells
// turned), nestChecked, flipped, openPts (Float64Array of the corners of edges used by one triangle, x, y, z each) }.
// opts.budget: the most elementary operations the nesting and crossing tests may take (then nestChecked is false).
export function repairMesh(src, tol, opts = {}) {
  const budget = opts.budget ?? 4e8;
  const tris = Float64Array.from(src);
  const nTri = tris.length / 9;
  const chk = meshCheck(tris, tol);
  const { vid, skip, E } = chk;

  // edge-connected pieces: triangles joined through any shared edge (union-find)
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
  // Two parts touching face to face, triangulated differently: at an edge of the contact, four triangles meet, two of
  // them in the same half-plane (one contact face of each part) and the other two on either side of that plane. Each
  // contact patch (triangles joined through edges used twice) is linked to the face on a fixed side of its plane (the
  // patch with the smaller number to the side its first triangle's normal points away from), the same at every edge, so
  // each part is closed again and is oriented on its own.
  {
    const pp = new Int32Array(nTri); for (let t = 0; t < nTri; t++) pp[t] = t;
    const pf = (x) => { while (pp[x] !== x) { pp[x] = pp[pp[x]]; x = pp[x]; } return x; };
    for (const e of E.values()) if (e.t.length === 2) { const a = pf(e.t[0]), b = pf(e.t[1]); if (a !== b) pp[Math.max(a, b)] = Math.min(a, b); }
    const corner = (t, k) => [tris[t * 9 + k * 3], tris[t * 9 + k * 3 + 1], tris[t * 9 + k * 3 + 2]];
    const nrm = (t) => { const a = corner(t, 0), b = corner(t, 1), c = corner(t, 2); const u = b.map((v, j) => v - a[j]), w = c.map((v, j) => v - a[j]); const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const l = Math.hypot(...n) || 1; return n.map((v) => v / l); };
    const patchN = new Map();
    for (const [key, e] of E) {
      if (e.t.length !== 4) continue;
      const lo = Math.floor(key / EKEY), hi = key - lo * EKEY;
      const p0 = chk.pos.subarray(lo * 3, lo * 3 + 3), p1 = chk.pos.subarray(hi * 3, hi * 3 + 3);
      const ed = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], el = Math.hypot(...ed) || 1;
      const dir = e.t.map((t) => {   // unit direction from the edge to the triangle's third corner, across the edge
        let k = 0; while (k < 3 && (vid[t * 3 + k] === lo || vid[t * 3 + k] === hi)) k++;
        const r = corner(t, Math.min(k, 2)).map((v, j) => v - p0[j]), s = (r[0] * ed[0] + r[1] * ed[1] + r[2] * ed[2]) / (el * el);
        const d = r.map((v, j) => v - s * ed[j]), l = Math.hypot(...d) || 1;
        return d.map((v) => v / l);
      });
      const ties = [];
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (dir[i][0] * dir[j][0] + dir[i][1] * dir[j][1] + dir[i][2] * dir[j][2] > 1 - 1e-9) ties.push([i, j]);
      if (ties.length !== 1) continue;
      let [i, j] = ties[0];
      const others = [0, 1, 2, 3].filter((k) => k !== i && k !== j);
      if (pf(e.t[i]) === pf(e.t[j])) continue;
      if (pf(e.t[j]) < pf(e.t[i])) [i, j] = [j, i];
      const pid = pf(e.t[i]);
      if (!patchN.has(pid)) patchN.set(pid, nrm(pid));
      const n = patchN.get(pid);
      const side = others.map((k) => dir[k][0] * n[0] + dir[k][1] * n[1] + dir[k][2] * n[2]);
      if (!(side[0] * side[1] < 0)) continue;
      const [neg, pos] = side[0] < 0 ? others : [others[1], others[0]];
      for (const [x, y] of [[i, neg], [j, pos]]) {
        const a = e.t[x], b = e.t[y], same = forward(vid, a, lo, hi) === forward(vid, b, lo, hi);
        link(a, b, same); link(b, a, same);
      }
    }
  }
  const flip = new Int8Array(nTri).fill(-1);
  const compOf = new Int32Array(nTri).fill(-1);
  let nonOrientable = 0, nComp = 0;
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
    for (const t of comp) compOf[t] = nComp;
    nComp++;
  }
  const swap = (t) => { const i = t * 9; for (let k = 0; k < 3; k++) { const x = tris[i + 3 + k]; tris[i + 3 + k] = tris[i + 6 + k]; tris[i + 6 + k] = x; } };
  let flipped = 0;
  for (let t = 0; t < nTri; t++) if (flip[t] === 1) { swap(t); flipped++; }
  const after = flipped ? meshCheck(tris, tol) : chk;
  const aV = after.vid, EW = after.E;

  // is every edge balanced counting only the triangles of one group? (per-group forward/backward uses)
  const balancedBy = (groupOf, nGroups) => {
    const ok = new Uint8Array(nGroups).fill(1);
    for (const [key, e] of EW) {
      const lo = Math.floor(key / EKEY), hi = key - lo * EKEY;
      if (e.t.length === 2 && groupOf[e.t[0]] === groupOf[e.t[1]]) { if (e.f !== e.b) ok[groupOf[e.t[0]]] = 0; continue; }
      const cnt = new Map();
      for (const t of e.t) { const g = groupOf[t]; cnt.set(g, (cnt.get(g) || 0) + (forward(aV, t, lo, hi) ? 1 : -1)); }
      for (const [g, c] of cnt) if (c !== 0) ok[g] = 0;
    }
    return ok;
  };
  // shells: an orientation component closed on its own is a shell; the other components of one edge-connected piece
  // together form one shell
  const compClosed = balancedBy(compOf, nComp);
  const shellOf = new Int32Array(nTri).fill(-1);
  const openShellOfPiece = new Map();
  const compShell = new Int32Array(nComp).fill(-1);
  let nShell = 0;
  for (let t = 0; t < nTri; t++) {
    if (skip[t]) continue;
    const c = compOf[t];
    if (compShell[c] < 0) {
      if (compClosed[c]) compShell[c] = nShell++;
      else { const r = find(t); if (!openShellOfPiece.has(r)) openShellOfPiece.set(r, nShell++); compShell[c] = openShellOfPiece.get(r); }
    }
    shellOf[t] = compShell[c];
  }
  const closedArr = balancedBy(shellOf, nShell);
  const shells = Array.from({ length: nShell }, (_, k) => ({ list: [], closed: !!closedArr[k], V: 0, edges: [], lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }));
  for (let t = 0; t < nTri; t++) {
    if (shellOf[t] < 0) continue;
    const s = shells[shellOf[t]];
    s.list.push(t);
    for (let k = 0; k < 9; k++) { const v = tris[t * 9 + k], a = k % 3; if (v < s.lo[a]) s.lo[a] = v; if (v > s.hi[a]) s.hi[a] = v; }
  }
  const P = after.pos;
  const openIds = new Set();
  for (const [key, e] of EW) {
    const lo = Math.floor(key / EKEY), hi = key - lo * EKEY;
    const s0 = shellOf[e.t[0]];
    shells[s0].edges.push(lo, hi);
    for (let k = 1; k < e.t.length; k++) { const s = shellOf[e.t[k]]; if (s !== s0 && !e.t.slice(1, k).some((t) => shellOf[t] === s)) shells[s].edges.push(lo, hi); }
  }
  for (const [key, e] of after.E) if (e.f + e.b === 1) { const lo = Math.floor(key / EKEY); openIds.add(lo); openIds.add(key - lo * EKEY); }
  const openPts = new Float64Array(openIds.size * 3);
  { let k = 0; for (const id of openIds) { openPts[k++] = P[id * 3]; openPts[k++] = P[id * 3 + 1]; openPts[k++] = P[id * 3 + 2]; } }
  const ref = topCentre(tris);
  for (const s of shells) s.V = signedVolume(tris, ref, s.list).V;
  const big = Math.max(1e-300, ...shells.map((s) => Math.abs(s.V)));
  const solid = (s) => Math.abs(s.V) >= 1e-9 * big;
  const diag = Math.hypot(...[0, 1, 2].map((a) => Math.max(...shells.map((s) => s.hi[a])) - Math.min(...shells.map((s) => s.lo[a])))) || 1;
  const epsD = Math.max(tol, 1e-12 * diag);
  const boxIn = (a, b) => [0, 1, 2].every((k) => a.lo[k] >= b.lo[k] - epsD && a.hi[k] <= b.hi[k] + epsD);
  const boxMeet = (a, b) => [0, 1, 2].every((k) => a.lo[k] <= b.hi[k] + epsD && a.hi[k] >= b.lo[k] - epsD);

  // nesting and crossing, with bounding boxes first; `work` counts elementary operations against the budget
  let work = 0, nestChecked = true;
  const n = shells.length;
  const crosses = new Uint8Array(n), inside = Array.from({ length: n }, () => []);
  // sample points just inside shell s: centroids of spread-out faces moved a little against the outward normal
  const samples = (s) => {
    const out = [], m = Math.min(8, s.list.length), sg = s.V < 0 ? -1 : 1;
    for (let j = 0; j < m; j++) {
      const i = s.list[Math.floor((j + 0.5) * s.list.length / m)] * 9;
      const ux = tris[i + 3] - tris[i], uy = tris[i + 4] - tris[i + 1], uz = tris[i + 5] - tris[i + 2];
      const vx = tris[i + 6] - tris[i], vy = tris[i + 7] - tris[i + 1], vz = tris[i + 8] - tris[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nn = Math.hypot(nx, ny, nz);
      if (!(nn > 0)) continue;
      const e = 1e-4 * Math.sqrt(nn / 2) / nn * sg;   // 1e-4 of the face's size, inwards
      out.push([(tris[i] + tris[i + 3] + tris[i + 6]) / 3 - e * nx, (tris[i + 1] + tris[i + 4] + tris[i + 7]) / 3 - e * ny, (tris[i + 2] + tris[i + 5] + tris[i + 8]) / 3 - e * nz]);
    }
    return out;
  };
  // does an edge of shell a pass into shell b? (b closed)
  const edgesInto = (a, b) => {
    const lo = [0, 1, 2].map((k) => Math.max(a.lo[k], b.lo[k]) - epsD), hi = [0, 1, 2].map((k) => Math.min(a.hi[k], b.hi[k]) + epsD);
    const inBox = (x, y, z, X, Y, Z) => Math.max(x, X) >= lo[0] && Math.min(x, X) <= hi[0] && Math.max(y, Y) >= lo[1] && Math.min(y, Y) <= hi[1] && Math.max(z, Z) >= lo[2] && Math.min(z, Z) <= hi[2];
    const tl = b.list.filter((t) => { const i = t * 9; return inBox(Math.min(tris[i], tris[i + 3], tris[i + 6]), Math.min(tris[i + 1], tris[i + 4], tris[i + 7]), Math.min(tris[i + 2], tris[i + 5], tris[i + 8]), Math.max(tris[i], tris[i + 3], tris[i + 6]), Math.max(tris[i + 1], tris[i + 4], tris[i + 7]), Math.max(tris[i + 2], tris[i + 5], tris[i + 8])); });
    const el = [];
    for (let k = 0; k < a.edges.length; k += 2) {
      const p = a.edges[k] * 3, q = a.edges[k + 1] * 3;
      if (inBox(P[p], P[p + 1], P[p + 2], P[q], P[q + 1], P[q + 2])) el.push(p, q);
    }
    work += (b.list.length + a.edges.length / 2);
    if (!tl.length || !el.length) return false;
    // uniform grid over the overlap box for b's triangles
    const nc = Math.max(1, Math.min(64, Math.round(Math.cbrt(tl.length))));
    const sz = [0, 1, 2].map((k) => Math.max(hi[k] - lo[k], 1e-300) / nc);
    const cell = (v, k) => Math.max(0, Math.min(nc - 1, Math.floor((v - lo[k]) / sz[k])));
    const grid = new Map();
    for (const t of tl) {
      const i = t * 9;
      const c0 = [0, 1, 2].map((k) => cell(Math.min(tris[i + k], tris[i + 3 + k], tris[i + 6 + k]), k));
      const c1 = [0, 1, 2].map((k) => cell(Math.max(tris[i + k], tris[i + 3 + k], tris[i + 6 + k]), k));
      for (let x = c0[0]; x <= c1[0]; x++) for (let y = c0[1]; y <= c1[1]; y++) for (let z = c0[2]; z <= c1[2]; z++) {
        const key = (x * nc + y) * nc + z; let g = grid.get(key); if (!g) grid.set(key, g = []); g.push(t);
      }
    }
    const stamp = new Map();
    const sgB = b.V < 0 ? -1 : 1;
    for (let k = 0; k < el.length; k += 2) {
      const p = [P[el[k]], P[el[k] + 1], P[el[k] + 2]], q = [P[el[k + 1]], P[el[k + 1] + 1], P[el[k + 1] + 2]];
      const c0 = [0, 1, 2].map((j) => cell(Math.min(p[j], q[j]), j)), c1 = [0, 1, 2].map((j) => cell(Math.max(p[j], q[j]), j));
      for (let x = c0[0]; x <= c1[0]; x++) for (let y = c0[1]; y <= c1[1]; y++) for (let z = c0[2]; z <= c1[2]; z++) {
        const g = grid.get((x * nc + y) * nc + z); if (!g) continue;
        for (const t of g) {
          if (stamp.get(t) === k) continue;
          stamp.set(t, k); work++;
          const r = segTri(tris, t, p, q, epsD);
          if (r === 2) return true;
          if (r === 1) {
            // through an edge or corner of b: probe a point just past the crossing, on the side b's inside is on
            const i = t * 9;
            const ux = tris[i + 3] - tris[i], uy = tris[i + 4] - tris[i + 1], uz = tris[i + 5] - tris[i + 2];
            const vx = tris[i + 6] - tris[i], vy = tris[i + 7] - tris[i + 1], vz = tris[i + 8] - tris[i + 2];
            const nx = (uy * vz - uz * vy) * sgB, ny = (uz * vx - ux * vz) * sgB, nz = (ux * vy - uy * vx) * sgB;
            const dp = nx * (p[0] - tris[i]) + ny * (p[1] - tris[i + 1]) + nz * (p[2] - tris[i + 2]);
            const dq = nx * (q[0] - tris[i]) + ny * (q[1] - tris[i + 1]) + nz * (q[2] - tris[i + 2]);
            const s = dp / (dp - dq), endIn = dp < 0 ? p : q, len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
            const x0 = p.map((v, j) => v + s * (q[j] - v));
            const step = 1e-3 * Math.min(len * (dp < 0 ? s : 1 - s), Math.sqrt(Math.hypot(nx, ny, nz) / 2));
            const d = endIn.map((v, j) => (v - x0[j]) / (Math.hypot(endIn[0] - x0[0], endIn[1] - x0[1], endIn[2] - x0[2]) || 1));
            work += b.list.length;
            if (Math.abs(windingNumber(tris, b.list, x0.map((v, j) => v + step * d[j]))) > 0.5) return true;
          }
        }
      }
      if (work > budget) return false;
    }
    return false;
  };
  for (let a = 0; a < n && nestChecked; a++) {
    if (!solid(shells[a])) continue;
    for (let b = a + 1; b < n && nestChecked; b++) {
      const A = shells[a], B = shells[b];
      if (!solid(B) || !boxMeet(A, B)) continue;
      if ((B.closed && edgesInto(A, B)) || (A.closed && edgesInto(B, A))) { crosses[a] = crosses[b] = 1; continue; }
      if (work > budget) { nestChecked = false; break; }
      // no crossing: a shell is inside another or outside it; most samples decide
      for (const [X, Y, x, y] of [[A, B, a, b], [B, A, b, a]]) {
        if (!Y.closed || !boxIn(X, Y)) continue;
        const pts = samples(X);
        work += pts.length * Y.list.length;
        const nIn = pts.filter((q) => Math.abs(windingNumber(tris, Y.list, q)) > 0.5).length;
        if (2 * nIn > pts.length) inside[x].push(y);
      }
      if (work > budget) nestChecked = false;
    }
  }

  // turn inside-out shells, from the outermost in (depth = number of closed shells containing it; parent = the deepest)
  let voids = 0, overlaps = 0, inverted = 0;
  const order = shells.map((_, k) => k).sort((p, q) => inside[p].length - inside[q].length);
  const turned = new Uint8Array(n), V0 = shells.map((s) => s.V);
  for (const k of order) {
    const s = shells[k];
    if (!solid(s)) continue;
    const depth = inside[k].length;
    const par = depth ? inside[k].reduce((m, j) => (inside[j].length > inside[m].length ? j : m)) : -1;
    const turn = par >= 0 && turned[par] && Math.sign(V0[k]) !== Math.sign(V0[par]) ? true : s.V < 0 && depth % 2 === 0;
    if (turn) { for (const t of s.list) swap(t); s.V = -s.V; turned[k] = 1; inverted++; flipped += s.list.length; }
    if (s.V < 0) voids++;
    else if (depth % 2 === 1 || crosses[k]) overlaps++;
  }
  // turning a whole shell inside out swaps both directions of all its edges, so the balance found above still holds
  const fin = after;
  return {
    tris, flipped,
    report: {
      triangles: nTri, degenerate: chk.degenerate, open: fin.open, misoriented: fin.misoriented,
      misorientedBefore: chk.misoriented, nonOrientable, nonManifold: fin.nonManifold,
      shells: n, closedShells: shells.filter((s) => s.closed).length,
      voids, overlaps, inverted, nestChecked, flipped, openPts,
    },
  };
}
