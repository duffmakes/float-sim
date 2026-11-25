// Stability read-outs, mesh checks and the rest attitude (review round 1), run by validate-core.js.
// Geometry is generated here (prisms and boxes), so the results do not depend on the STEP mesh quality, except for the
// closed STEP sphere, which is read through OpenCascade as the app reads it.
//
// References that do not use Float Sim's code:
//  [2D]  an exact cross-section code written here (Sutherland–Hodgman clip of the section polygons at the waterline,
//        bisection on the waterline, centroid by the shoelace formula): GZ of a prism heeled about its length
//  [RT]  Rawson & Tupper, Basic Ship Theory, ch. 4: wall-sided formula GZ = sinφ(GM + ½BM tan²φ), loll angle
//        tanφ = √(−2GM/BM)
//  [IH]  the cube corner-down: the submerged part is {x ∈ [0,1]³ : x₁ + x₂ + x₃ ≤ t}, so draft and centre of buoyancy
//        follow from the Irwin–Hall distribution of a sum of three uniform variables
//  [IMO] 2008 IS Code (MSC.267(85)) Part A 2.2.2: GZ of at least 0.2 m at 30° or more; A 2.2.3: the maximum GZ
//        should occur at a heel of at least 25°
//  [SYM] the corner-down cube heeled towards an edge-down attitude: there B is under G by symmetry, so GZ vanishes at
//        the angle between a body diagonal and the edge-down vertical, atan(1/√2) = 35.2644°
import {
  mat3, transformTris, solveWaterline, hydrostatics, massProperties, submerged, gzAnalysis, gzAt, gzSummary, gmAbout,
  stabilityVerdict, restAttitude, verdictRange,
} from '../js/physics.js';
import { meshCheck, repairMesh, weld } from '../js/meshcheck.js';
import { soupFromIndexed, prepareMesh } from '../js/loader.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- geometry
// prism along x from x0 to x1 with a convex section polygon [(y, z) …] given counter-clockwise; outward winding
export function prism(section, x0, x1) {
  const out = [], n = section.length;
  for (let i = 0; i < n; i++) {
    const [ya, za] = section[i], [yb, zb] = section[(i + 1) % n];
    out.push(x0, ya, za, x1, yb, zb, x1, ya, za, x0, ya, za, x0, yb, zb, x1, yb, zb);
  }
  for (let i = 1; i + 1 < n; i++) {
    out.push(x0, ...section[0], x0, ...section[i + 1], x0, ...section[i]);
    out.push(x1, ...section[0], x1, ...section[i], x1, ...section[i + 1]);
  }
  return new Float64Array(out);
}
const rect = (y0, y1, z0, z1) => [[y0, z0], [y1, z0], [y1, z1], [y0, z1]];
// rotation by a (rad) about the horizontal unit axis (ux, uy, 0), Rodrigues' formula
const rotH = (ux, uy, a) => { const c = Math.cos(a), s = Math.sin(a), k = 1 - c; return [c + k * ux * ux, k * ux * uy, s * uy, k * ux * uy, c + k * uy * uy, -s * ux, -s * uy, s * ux, c]; };
export const boxTris = (L, B, D, x0 = 0, y0 = -B / 2, z0 = 0) => prism(rect(y0, y0 + B, z0, z0 + D), x0, x0 + L);
const flipTris = (t, pred = () => true) => {
  const o = Float64Array.from(t);
  for (let i = 0; i < o.length; i += 9) if (pred(o, i)) for (let k = 0; k < 3; k++) { const s = o[i + 3 + k]; o[i + 3 + k] = o[i + 6 + k]; o[i + 6 + k] = s; }
  return o;
};
const dropTris = (t, pred) => { const o = []; for (let i = 0; i < t.length; i += 9) if (!pred(t, i)) for (let k = 0; k < 9; k++) o.push(t[i + k]); return new Float64Array(o); };
const onPlane = (k, v) => (t, i) => [0, 1, 2].every((j) => Math.abs(t[i + j * 3 + k] - v) < 1e-12);

// ---------------------------------------------------------------- [2D] independent section code
// polygons: [[(y, z) …] …] counter-clockwise; G = (yG, zG); A0 = immersed section area. Heel φ about x, as Float Sim's
// rotX: (y, z) − G ↦ (c·y − s·z, s·y + c·z). Returns { gz, by, bz } with B relative to G.
function clipBelow(poly, h) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ina = a[1] <= h, inb = b[1] <= h;
    if (ina) out.push(a);
    if (ina !== inb) { const t = (h - a[1]) / (b[1] - a[1]); out.push([a[0] + t * (b[0] - a[0]), h]); }
  }
  return out;
}
function areaCentroid(polys) {
  let A = 0, Sy = 0, Sz = 0;
  for (const p of polys) for (let i = 0; i < p.length; i++) {
    const [y0, z0] = p[i], [y1, z1] = p[(i + 1) % p.length], c = y0 * z1 - y1 * z0;
    A += c / 2; Sy += (y0 + y1) * c / 6; Sz += (z0 + z1) * c / 6;
  }
  return { A, y: A ? Sy / A : 0, z: A ? Sz / A : 0 };
}
export function gz2d(polygons, G, A0, phiDeg) {
  const c = Math.cos(phiDeg * DEG), s = Math.sin(phiDeg * DEG);
  const rot = polygons.map((p) => p.map(([y, z]) => [c * (y - G[0]) - s * (z - G[1]), s * (y - G[0]) + c * (z - G[1])]));
  let lo = Infinity, hi = -Infinity; for (const p of rot) for (const q of p) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); }
  for (let it = 0; it < 200; it++) { const h = (lo + hi) / 2; areaCentroid(rot.map((p) => clipBelow(p, h))).A < A0 ? lo = h : hi = h; }
  const b = areaCentroid(rot.map((p) => clipBelow(p, (lo + hi) / 2)));
  return { gz: -b.y, by: b.y, bz: b.z };
}
// root and maximum of the [2D] curve by bisection and golden section (no Float Sim code)
function root2d(f, a, b) { let fa = f(a); for (let i = 0; i < 100; i++) { const m = (a + b) / 2, fm = f(m); if (fm * fa > 0) { a = m; fa = fm; } else b = m; } return (a + b) / 2; }
function max2d(f, a, b) { const r = (Math.sqrt(5) - 1) / 2; let c = b - r * (b - a), d = a + r * (b - a); for (let i = 0; i < 100; i++) { if (f(c) > f(d)) { b = d; d = c; c = b - r * (b - a); } else { a = c; c = d; d = a + r * (b - a); } } return (a + b) / 2; }
// [2D] how far the lowest of the points pts (y, z) is below the waterline of the heeled section (positive: under water)
function depth2d(polygons, G, A0, pts, phiDeg) {
  const c = Math.cos(phiDeg * DEG), s = Math.sin(phiDeg * DEG), rot = ([y, z]) => [c * (y - G[0]) - s * (z - G[1]), s * (y - G[0]) + c * (z - G[1])];
  const rp = polygons.map((p) => p.map(rot));
  let lo = Infinity, hi = -Infinity; for (const p of rp) for (const q of p) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); }
  for (let it = 0; it < 200; it++) { const h = (lo + hi) / 2; areaCentroid(rp.map((p) => clipBelow(p, h))).A < A0 ? lo = h : hi = h; }
  return (lo + hi) / 2 - Math.min(...pts.map((q) => rot(q)[1]));
}

// set up a body as the app does: G at the origin, waterline for the displacement
function floating(tris, G, mass, rho = 1000, euler = [0, 0, 0]) {
  const rel = transformTris(tris, mat3.fromEulerDeg(...euler), G);
  const sol = solveWaterline(rel, mass / rho);
  const H = hydrostatics(rel, sol.zw, mass, rho);
  return { rel, sol, H };
}

export async function runStabilityValidation({ chkFactory, getTris = null }) {
  const out = [];

  // 1 — GZ curves and their summaries against the [2D] section code
  {
    const { rows, chk } = chkFactory();
    const cases = [
      // name, 3D tris, section polygons, G (x, y, z), mass
      ['box 4×2×1 m, T 0.4, KG 0.5', boxTris(4, 2, 1), [rect(-1, 1, 0, 1)], [2, 0, 0.5], 3200],
      ['catamaran: two 4×0.5×0.5 m hulls at y ±0.75, deck 4×2×0.1 m at 1.5 m, KG 1.0', new Float64Array([...boxTris(4, 0.5, 0.5, 0, 0.5), ...boxTris(4, 0.5, 0.5, 0, -1.0), ...boxTris(4, 2, 0.1, 0, -1, 1.5)]),
        [rect(0.5, 1, 0, 0.5), rect(-1, -0.5, 0, 0.5), rect(-1, 1, 1.5, 1.6)], [2, 0, 1.0], 1500],
      ['tender box, KG 1.0353 (GM_T < 0, loll below 5°)', boxTris(4, 2, 1), [rect(-1, 1, 0, 1)], [2, 0, 1.0353], 3200],
      ['V-section, 30° half-angle, T 0.6, KG 0.35', prism([[0, 0], [Math.tan(30 * DEG), 1], [-Math.tan(30 * DEG), 1]], 0, 3),
        [[[0, 0], [Math.tan(30 * DEG), 1], [-Math.tan(30 * DEG), 1]]], [1.5, 0, 0.35], 1000 * 0.36 * Math.tan(30 * DEG) * 3],
    ];
    for (const [name, tris, polys, G, mass] of cases) {
      const L = name.startsWith('V') ? 3 : 4;
      const { rel, H } = floating(tris, G, mass);
      const a = gzAnalysis(rel, H.V, 'x', { GM: gmAbout(H, 'x') });
      const f = (deg) => gz2d(polys, [G[1], G[2]], mass / 1000 / L, deg).gz;
      let worst = 0;
      for (const p of a.curve) worst = Math.max(worst, Math.abs(p.gz - f(p.deg)));
      chk(`${name}: GZ at 0–180° every 5° vs [2D], largest difference (m)`, worst, 0, 0, 1e-9);
      // [2D] summary: sign changes on a 0.5° grid, then bisection; maximum by golden section inside the range
      const grid = Array.from({ length: 361 }, (_, i) => i * 0.5), g = grid.map((d) => (d === 0 ? 0 : f(d)));
      const unstable = f(0.01) < 0;
      let i = 1; if (unstable) while (i < grid.length && g[i] <= 0) i++;
      const loll = unstable ? root2d(f, i > 1 ? grid[i - 1] : 0.01, grid[i]) : null;
      let j = i + 1; while (j < grid.length && !(g[j - 1] > 0 && g[j] <= 0)) j++;
      const vanish = j < grid.length ? root2d(f, grid[j - 1], grid[j]) : null;
      let k = 1; for (let q = 1; q < j && q < grid.length; q++) if (grid[q] >= (loll ?? 0) && g[q] > g[k]) k = q;
      const maxDeg = max2d(f, grid[Math.max(0, k - 1)], grid[Math.min(grid.length - 1, k + 1)]);
      chk(`${name}: unstable flag`, a.summary.unstable, unstable);
      if (loll !== null) chk(`${name}: loll angle (°) vs [2D]`, a.summary.loll, loll, 0, 1e-6);
      chk(`${name}: angle of vanishing stability (°) vs [2D]`, a.summary.vanish ?? -1, vanish ?? -1, 0, 1e-6);
      chk(`${name}: max GZ (m) vs [2D]`, a.summary.max, f(maxDeg), 0, 1e-9);
      chk(`${name}: angle of max GZ (°) vs [2D]`, a.summary.maxDeg, maxDeg, 0, 0.01);
    }
    // closed forms
    {
      const { rel, H } = floating(boxTris(4, 2, 1), [2, 0, 1.0353], 3200);
      chk('tender box: loll angle = atan √(−2GM/BM) (wall-sided [RT])', gzAnalysis(rel, H.V, 'x', { GM: H.GMt }).summary.loll, Math.atan(Math.sqrt(-2 * H.GMt / H.BMt)) / DEG, 0, 1e-6);
      const b = floating(boxTris(4, 2, 1), [2, 0, 0.5], 3200);
      chk('box: angle of vanishing stability = 90° exactly (B under G on its side, by symmetry)', gzAnalysis(b.rel, b.H.V, 'x', { GM: b.H.GMt }).summary.vanish, 90, 0, 1e-6);
      // pitch GZ: wall-sided until the ends emerge or immerse
      const pc = gzAnalysis(b.rel, b.H.V, 'y', { GM: b.H.GMl, angles: [0, 5, 10] }).curve;
      for (const p of pc.slice(1)) chk(`box pitch GZ ${p.deg}° = sinφ(GM_L + ½BM_L tan²φ) [RT]`, p.gz, Math.sin(p.deg * DEG) * (b.H.GMl + 0.5 * b.H.BMl * Math.tan(p.deg * DEG) ** 2), 0, 1e-9);
      // a heel axis at 180° from x is the same axis heeled the other way: GZ(φ) about −x = −GZ(−φ)… = GZ about x for a symmetric box
      const m = gzAnalysis(b.rel, b.H.V, 180, { GM: b.H.GMt, angles: [0, 15, 40] }).curve, x = gzAnalysis(b.rel, b.H.V, 'x', { angles: [0, 15, 40] }).curve;
      chk('box: GZ about the axis at 180° equals GZ about x (symmetric section)', Math.max(...m.map((p, i) => Math.abs(p.gz - x[i].gz))), 0, 0, 1e-12);
    }
    // gzSummary on sampled curves alone (no refinement): the maximum at the first angle, interpolated crossings
    {
      const c = [[0, 0], [5, 0.1], [10, 0.05], [15, -0.05], [20, -0.1]].map(([deg, gz]) => ({ deg, gz }));
      const sm = gzSummary(c);
      chk('sampled curve: max GZ at the first angle (5°, 0.1 m)', sm.maxDeg === 5 && sm.max === 0.1, true);
      chk('sampled curve: vanishing angle interpolated between 10° and 15° (12.5°)', sm.vanish, 12.5, 0, 1e-12);
      const u = gzSummary([[0, 0], [5, -0.1], [10, 0.1], [15, 0.2]].map(([deg, gz]) => ({ deg, gz })));
      chk('sampled curve, negative at 5°: unstable, loll interpolated at 7.5°', u.unstable === true && Math.abs(u.loll - 7.5) < 1e-12, true);
      chk('…GM < 0 passed in marks it unstable even when the first sample is positive', gzSummary(c, { GM: -0.01 }).unstable, true);
    }
    out.push({ id: 'gz_summary', title: 'GZ curves, loll angle, vanishing angle and maximum against an independent section code', ref: '[2D] exact section clipping written in the test; [RT] wall-sided formula', rows });
  }

  // 2 — weakest waterplane axis, GM about it, an off-centre waterplane and the other read-outs
  {
    const { rows, chk } = chkFactory();
    const box = boxTris(4, 2, 1);
    for (const yaw of [0, 30, 90, -45, 135]) {
      const { H } = floating(box, [2, 0, 0.5], 3200, 1000, [0, 0, yaw]);
      const want = ((yaw + 90) % 180 + 180) % 180 - 90;   // the box's long axis, in (−90°, 90°]
      chk(`box yawed ${yaw}°: weakest axis along the box (°)`, H.axisMinDeg, want === -90 ? 90 : want, 0, 1e-9);
      chk(`box yawed ${yaw}°: GM about the weakest axis = KB + B²/(12T) − KG`, H.GMmin, 0.2 + 4 / 4.8 - 0.5, 0, 1e-12);
      chk(`box yawed ${yaw}°: gmAbout(weakest axis) = GM_min`, gmAbout(H, H.axisMinDeg), H.GMmin, 0, 1e-12);
    }
    {
      // GM_T and GM_L both positive, GM_min negative: the "stable" test must use GM_min
      const { rel, H } = floating(boxTris(4, 2, 2), [2, 0, 1.2], 3200, 1000, [0, 0, 45]);
      chk('box 4×2×2 yawed 45°, T 0.4, KG 1.2: GM_T = GM_L = KB + (I_long + I_short)/(2V) − KG', H.GMt, 0.2 + (4 * 8 / 12 + 2 * 64 / 12) / 2 / 3.2 - 1.2, 0, 1e-12);
      chk('…GM_min = KB + B²/(12T) − KG < 0', H.GMmin, 0.2 + 4 / 4.8 - 1.2, 0, 1e-12);
      chk('…stable oracle GM_min > 0 says unstable', H.GMmin > 0, false);
      chk('…verdict: Unstable', stabilityVerdict(H.GMmin, { scale: 5 }).level, 'bad');
      const s = gzAnalysis(rel, H.V, H.axisMinDeg, { GM: H.GMmin }).summary;
      chk('…GZ about the weakest axis: unstable', s.unstable, true);
      chk('…GZ about the weakest axis is negative at 5°', gzAt(rel, H.V, H.axisMinDeg, 5).gz < 0, true);
    }
    {
      // off-centre waterplane: G moved 0.3 m sideways (not at rest; the read-outs are about the waterplane centroid)
      const { H } = floating(box, [2, 0.3, 0.5], 3200);
      chk('box, G 0.3 m off the centreline: waterplane centroid y = −0.3 m (relative to G)', H.wp.cy, -0.3, 0, 1e-12);
      chk('…waterplane centroid x = 0', H.wp.cx, 0, 0, 1e-12);
      chk('…BM_T about the waterplane centroid = B²/(12T)', H.BMt, 4 / 4.8, 0, 1e-12);
      chk('…BM_L = L²/(12T)', H.BMl, 16 / 4.8, 0, 1e-12);
      chk('…I_xy about the centroid = 0', H.wp.Ixy, 0, 0, 1e-12);
    }
    {
      const { H } = floating(box, [2, 0, 0.5], 3200);
      chk('box: draft 0.4 m', H.draft, 0.4, 0, 1e-12);
      chk('box: freeboard = depth − draft = 0.6 m', H.freeboard, 0.6, 0, 1e-12);
      chk('box: righting moment per degree of roll = ρgV·GM_T·sin 1°', H.rightingPerDegT, 1000 * 9.80665 * 3.2 * (0.2 + 4 / 4.8 - 0.5) * Math.sin(DEG), 1e-12);
      chk('box: righting moment per degree of pitch = ρgV·GM_L·sin 1°', H.rightingPerDegL, 1000 * 9.80665 * 3.2 * (0.2 + 16 / 4.8 - 0.5) * Math.sin(DEG), 1e-12);
      chk('box: immersion 80 kg/cm', H.tpc / 100, 80, 1e-12);
      chk('box: no mesh fault flagged', H.wpBad, false);
    }
    out.push({ id: 'stability_readouts', title: 'Weakest waterplane axis and GM_min (yawed boxes), off-centre waterplane, freeboard, righting moment per degree', ref: 'second moment of a rectangle; I(θ) = I_xx cos²θ + I_yy sin²θ − 2I_xy sinθ cosθ', rows });
  }

  // 3 — the plain-language verdict
  {
    const { rows, chk } = chkFactory();
    // the verdict's range as the app works it out (verdictRange, the function the app calls, with the GZ analyses run here)
    const range = (rel, H, { freeTrim = false, open = null } = {}) => verdictRange(H, async (jobs) => jobs.map((j) => gzAnalysis(rel, H.V, j.axis, { GM: j.GM, freeTrim, open: j.open === false ? null : open, refineMax: j.refineMax }).summary), { scale: 5 });
    const texts = [];
    for (const yaw of [0, 20, 45]) {
      const { rel, H } = floating(boxTris(4, 2, 1), [2, 0, 0.5], 3200, 1000, [0, 0, yaw]);
      const v = stabilityVerdict(H.GMmin, { range: await range(rel, H), scale: 4.6 });
      texts.push(v.level + v.text);
      if (yaw === 0) {
        chk('box: verdict level good (Stable)', v.level, 'good');
        chk('box (vanishes at 90°): not called self-righting', /self-righting/.test(v.text), false);
        chk('box: the verdict gives the vanishing angle 90°, about the weakest axis (where the least heeling moment ends the range)', /vanishes at 90°/.test(v.text) && /the weakest axis, the direction in which the least heeling moment ends the range/.test(v.text), true);
      }
    }
    chk('box at yaw 0°, 20°, 45°: the same verdict', texts.every((t) => t === texts[0]), true);
    {
      const cat = new Float64Array([...boxTris(4, 0.5, 0.5, 0, 0.5), ...boxTris(4, 0.5, 0.5, 0, -1.0), ...boxTris(4, 2, 0.1, 0, -1, 1.5)]);
      const { rel, H } = floating(cat, [2, 0, 1.0], 1500);
      const r = await range(rel, H), v = stabilityVerdict(H.GMmin, { range: r, scale: 4.6 });
      chk('catamaran (max GZ at 9.3°, gone at 18.2°): level ok (small range), not good', v.level, 'ok');
      chk('catamaran: the range ends before 30°, citing IS Code A 2.2.2', /30°/.test(v.text) && /A 2\.2\.2/.test(v.text), true);
      chk('catamaran: the early peak is noted, citing the 25° criterion (A 2.2.3)', /peaks early/.test(v.text) && /25°/.test(v.text) && /A 2\.2\.3/.test(v.text), true);
      chk('catamaran: not called self-righting', /self-righting/.test(v.text), false);
    }
    {
      // R1-18: a raft peaks early (20°) but keeps a 92° range: Stable with a note, not "small range"
      const { rel, H } = floating(boxTris(4, 4, 0.5, 0, -2, 0), [2, 0, 0.2], 3200);
      const r = await range(rel, H), v = stabilityVerdict(H.GMmin, { range: r, scale: 5.7 });
      chk('raft 4×4×0.5 m, T 0.2 m, KG 0.2 m: range ends past 30° (°)', r.end > 90, true);
      chk('raft: level good, not "small range"', v.level === 'good' && !/range is small/.test(v.text), true);
      chk('raft: the early peak (before 25°) is noted', /peaks early/.test(v.text), true);
    }
    {
      // R1-17: the corner-down cube has a hexagonal waterplane (I_xx = I_yy, no weakest axis), yet its range depends on
      // the heel direction; the worst direction ends at the edge-down attitude [SYM], at any yaw
      const cube = boxTris(1, 1, 1, -0.5, -0.5, -0.5), d = [1, 1, 1].map((x) => x / Math.sqrt(3)), a = Math.acos(d[2]);
      const k = [d[1] / Math.hypot(d[0], d[1]), -d[0] / Math.hypot(d[0], d[1])], C = Math.cos(a), S = Math.sin(a), K = 1 - C;
      const Rc = [C + K * k[0] * k[0], K * k[0] * k[1], S * k[1], K * k[0] * k[1], C + K * k[1] * k[1], -S * k[0], -S * k[1], S * k[0], C];
      const exact = Math.atan(1 / Math.SQRT2) / DEG;
      for (const yaw of [0, 13.3]) {
        const rel = transformTris(cube, mat3.mul(mat3.rotZ(yaw * DEG), Rc)), H = hydrostatics(rel, solveWaterline(rel, 0.5).zw, 500, 1000);
        const r = await range(rel, H), v = stabilityVerdict(H.GMmin, { range: r, scale: 1.7 });
        const onlyWeakest = Math.min(...[0, 180].map((o) => gzAnalysis(rel, H.V, H.axisMinDeg + o, { GM: H.GMmin }).summary.end ?? 180));
        // the arm is stationary about the edge direction, which the refinement finds to its last grid, 0.007°; the
        // vanishing angle has a corner there (0.8° per degree of direction), so the range is within 0.01° of [SYM]
        chk(`corner-down cube, yaw ${yaw}°: range = atan(1/√2) = 35.2644° [SYM] (°)`, r.end, exact, 0, 0.01);
        chk(`…the weakest axis alone (set by round-off) gives a longer range, ${onlyWeakest.toFixed(1)}°`, onlyWeakest > exact + 1, true);
        chk(`…the verdict gives 35.3° and names the direction`, /vanishes at 35\.3°/.test(v.text) && /axis at -?[0-9.]+° from x/.test(v.text), true);
      }
    }
    {
      // R1-15: an open deck. About x the deck edge goes under at the angle the [2D] code gives; the verdict's range ends
      // at the worst direction's downflooding angle, before the closed hull's vanishing angle
      const open = prepareMesh([dropTris(boxTris(4, 2, 1), onPlane(2, 1))]);
      const { rel, H } = floating(open.tris, [2, 0, 0.5], 3200);
      const relOpen = transformTris(open.report.openPts, mat3.identity(), [2, 0, 0.5]);
      const fx = gzAnalysis(rel, H.V, 'x', { GM: H.GMt, open: relOpen }).summary;
      const f2 = (deg) => depth2d([rect(-1, 1, 0, 1)], [0, 0.5], 0.8, [[-1, 1], [1, 1]], deg);
      chk('open-deck box, heeled about x: downflooding angle vs [2D] (°)', fx.flood, root2d(f2, 20, 40), 0, 1e-6);
      chk('…the range ends there, before the closed hull\'s vanishing angle', fx.end === fx.flood && fx.flood < (fx.vanish ?? 180), true);
      chk('…the maximum is taken inside the range', fx.maxDeg <= fx.flood, true);
      const r = await range(rel, H, { open: relOpen }), v = stabilityVerdict(H.GMmin, { range: r, scale: 4.6 });
      chk('open-deck box: the verdict\'s range ends at a downflooding angle, the worst direction\'s (°)', r.flood !== null && r.end === r.flood && r.end <= fx.flood + 1e-9, true);
      chk('…and says that an opening goes under water', /opening goes under water/.test(v.text), true);
      const end = prepareMesh([dropTris(boxTris(4, 2, 1), onPlane(0, 0))]);
      const e = floating(end.tris, [2, 0, 0.5], 3200), eOpen = transformTris(end.report.openPts, mat3.identity(), [2, 0, 0.5]);
      const fe = gzAnalysis(e.rel, e.H.V, 'x', { GM: e.H.GMt, open: eOpen }).summary;
      chk('box with an end face missing: the opening is under water upright (downflooding angle 0°)', fe.flood, 0, 0, 0);
      chk('…verdict: bad, an opening under water', stabilityVerdict(e.H.GMmin, { range: fe, scale: 4.6 }).level === 'bad' && /opening/.test(stabilityVerdict(e.H.GMmin, { range: fe, scale: 4.6 }).text), true);
    }
    {
      // R1-28: an open-deck barge 40 × 8 × 6 m at T 2 m, KG 3 m. In roll the deck edge goes under at atan(1.125) =
      // 48.3665° (with the bilge out, the immersed section is a triangle); inclined nearer pitch it floods at 12.2°, but
      // there the righting arm is metres. The range is taken where the least heeling moment ends it, near roll
      const m = prepareMesh([dropTris(boxTris(40, 8, 6, 0, -4, 0), onPlane(2, 6))]);
      const { rel, H } = floating(m.tris, [20, 0, 3], 640000), op = transformTris(m.report.openPts, mat3.identity(), [20, 0, 3]);
      const fx = gzAnalysis(rel, H.V, 'x', { GM: H.GMt, open: op }).summary;
      chk('open-deck barge 40×8×6 m: roll downflooding angle = atan(1.125) (°)', fx.flood, Math.atan(1.125) / DEG, 0, 1e-6);
      chk('…in roll the largest arm before it is GZ at the downflooding angle vs [2D] (m)', fx.arm, gz2d([rect(-4, 4, 0, 6)], [0, 3], 16, Math.atan(1.125) / DEG).gz, 0, 1e-7);
      const r = await range(rel, H, { open: op }), v = stabilityVerdict(H.GMmin, { range: r, scale: 41 });
      chk('…the verdict\'s range ends at a downflooding angle past 30°, not later than roll\'s (°)', r.flood !== null && r.end === r.flood && r.end > 30 && r.end <= fx.flood + 1e-9, true);
      chk('…it takes no larger arm to get there than in roll (to the 0.1 % that counts as the same)', r.arm <= fx.arm * (1 + 1e-3), true);
      chk('…level Stable, and the earlier flooding nearer pitch (under 13°) is a note', v.level === 'good' && r.earliest !== null && r.earliest.flood && r.earliest.end < 13 && /larger heeling moment/.test(v.text), true);
      // R1-32: with fixed trim the arm counts the trimming moment the fixed trim holds. 1.09° off roll (where the arm
      // about the heel axis alone was least) the deck corner floods at 44.7°, but holding that attitude takes a trimming
      // arm of about 0.85 m; counting it, the least moment is within 0.1° of roll (the trimming arm adds to the arm only
      // at second order, while the downflooding angle falls at first order). Directions whose arm is within 0.1 % of the
      // least count as the same moment, and the soonest end of those is taken (R1-36), so the range ends within 0.25° of
      // roll's, and not later
      const sk = gzAnalysis(rel, H.V, 1.09, { GM: gmAbout(H, 1.09), open: op }).summary;
      chk('…1.09° off roll the arm counting the trimming moment is over 1.1 m (the arm about the heel axis alone, 0.72 m)', sk.arm > 1.1 && sk.max < 0.73, true);
      chk('…the verdict\'s direction is within 0.1° of roll (°)', Math.abs(r.az) < 0.1, true);
      chk('…and its range ends within 0.25° of atan(1.125), not later (°)', r.end > Math.atan(1.125) / DEG - 0.25 && r.end <= Math.atan(1.125) / DEG + 1e-9, true);
    }
    {
      // R1-29: the open box at T 0.95 m floods in roll at atan(0.05) = 2.862°, before the first 5° sample: its maximum is
      // still found, inside the range
      const m = prepareMesh([dropTris(boxTris(4, 2, 1), onPlane(2, 1))]);
      const { rel, H } = floating(m.tris, [2, 0, 0.5], 7600), op = transformTris(m.report.openPts, mat3.identity(), [2, 0, 0.5]);
      const fx = gzAnalysis(rel, H.V, 'x', { GM: H.GMt, open: op }).summary;
      chk('open box, freeboard 0.05 m: roll downflooding angle = atan(0.05) (°)', fx.flood, Math.atan(0.05) / DEG, 0, 1e-6);
      chk('…the largest arm before it is GZ at the downflooding angle (the range ends before the first sample) vs [2D] (m)', fx.arm, gz2d([rect(-1, 1, 0, 1)], [0, 0.5], 1.9, Math.atan(0.05) / DEG).gz, 0, 1e-7);
      chk('…the maximum lies inside the range and is positive', fx.max > 0 && fx.maxDeg > 0 && fx.maxDeg <= fx.flood, true);
      chk('…the verdict does not say it peaks at 0°', /peaks at 0°/.test(stabilityVerdict(H.GMmin, { range: await range(rel, H, { open: op }), scale: 4.6 }).text), false);
    }
    {
      // R1-31: the 30° small-range threshold, on a catamaran whose range ends between 25° and 30° [2D]
      const w = 0.5, sp = 0.75, cat = new Float64Array([...boxTris(4, w, 0.5, 0, sp), ...boxTris(4, w, 0.5, 0, -sp - w), ...boxTris(4, 2 * (sp + w), 0.1, 0, -sp - w, 1.5)]);
      const { rel, H } = floating(cat, [2, 0, 0.9], 1500), polys = [rect(sp, sp + w, 0, 0.5), rect(-sp - w, -sp, 0, 0.5), rect(-sp - w, sp + w, 1.5, 1.6)];
      const r = await range(rel, H), want = root2d((d) => gz2d(polys, [0, 0.9], 0.375, d).gz, 20, 35);
      chk('catamaran, hulls at ±0.75 m, KG 0.9 m: range ends at 26.78° vs [2D] (°)', r.end, want, 0, 1e-6);
      chk('…level ok (the range ends before 30°)', stabilityVerdict(H.GMmin, { range: r, scale: 4.8 }).level, 'ok');
      // the 25° early-peak note, on a square box whose righting arm peaks between 20° and 25° [2D]
      const b = floating(boxTris(4, 4, 0.7, 0, -2, 0), [2, 0, 0.3], 4000), rb = await range(b.rel, b.H);
      const f = (d) => gz2d([rect(-2, 2, 0, 0.7)], [0, 0.3], 1, d).gz;
      const rx = gzAnalysis(b.rel, b.H.V, 'x', { GM: b.H.GMt }).summary;
      chk('square box 4×4×0.7 m, T 0.25 m, KG 0.3 m: the roll peak at 22.90° vs [2D] (°)', rx.maxDeg, max2d(f, 15, 30), 0, 0.01);
      const vb = stabilityVerdict(b.H.GMmin, { range: rx, scale: 5.7 });
      chk('…with that range, level good, with the early-peak note', vb.level === 'good' && /peaks early/.test(vb.text), true);
      chk('…the verdict\'s range (the diagonal, where the least moment ends it) also peaks before 25°, and is noted', rb.maxDeg < 25 && /peaks early/.test(stabilityVerdict(b.H.GMmin, { range: rb, scale: 5.7 }).text), true);
    }
    chk('GM 0.5 m on a 32 m ship (no range yet): stable, and never "loll"', stabilityVerdict(0.5, { scale: 200 }).level === 'good' && !/loll/.test(stabilityVerdict(0.5, { scale: 200 }).text), true);
    chk('GM −0.1 m: Unstable', stabilityVerdict(-0.1, { scale: 5 }).level, 'bad');
    chk('GM = 0 to round-off (1e-16 m): Neutral', stabilityVerdict(1e-16, { scale: 1 }).level, 'warn');
    chk('no waterplane: n/a', stabilityVerdict(NaN).level, 'na');
    chk('free trim is named when the range came from it', /free trim/.test(stabilityVerdict(0.2, { range: { vanish: 70, end: 70, flood: null, maxDeg: 40, max: 0.3 }, scale: 1, freeTrim: true }).text), true);
    {
      // the tender box (loll 3.93°): Unstable, with the loll angle
      const { rel, H } = floating(boxTris(4, 2, 1), [2, 0, 1.0353], 3200);
      const v = stabilityVerdict(H.GMmin, { range: await range(rel, H), scale: 4.6 });
      chk('tender box (GM_T −0.002 m): Unstable', v.level, 'bad');
      chk('tender box: the verdict gives the loll angle 3.9°', /about 3\.9°/.test(v.text), true);
    }
    {
      // R1-18: the edge-down cube is exactly neutral (GM_min = 0 up to round-off of either sign); the GZ summary about the
      // weakest axis must not change with yaw
      const cube = boxTris(1, 1, 1, -0.5, -0.5, -0.5), sums = [];
      for (const yaw of [0, 10, 33]) {
        const rel = transformTris(cube, mat3.mul(mat3.rotZ(yaw * DEG), mat3.rotX(Math.PI / 4))), H = hydrostatics(rel, solveWaterline(rel, 0.5).zw, 500, 1000);
        const sm = gzAnalysis(rel, H.V, H.axisMinDeg, { GM: H.GMmin }).summary;
        sums.push([sm.neutral, sm.unstable, sm.loll?.toFixed(6), sm.vanish?.toFixed(6)].join());
        if (yaw === 0) chk('edge-down cube: GZ summary about the weakest axis is neutral (|GM| within the round-off band)', sm.neutral, true);
      }
      chk('edge-down cube at yaw 0°, 10°, 33°: the same GZ summary (GM_min +3e-17, −2e-16, +3e-17)', sums.every((x) => x === sums[0]), true);
    }
    {
      // R1-25: the self-righting boundary on a body at rest whose range ends between 90° and 180°: the 4×2×1 m box with
      // KG 0.3 m. In roll the [2D] code on the 2 m section gives the vanishing angle; pitch vanishes sooner, at 99.9° on
      // the 4 m section, but takes over twice the arm to get there, so it is a note (review R1-34)
      const { rel, H } = floating(boxTris(4, 2, 1), [2, 0, 0.3], 3200);
      const r = await range(rel, H), v = stabilityVerdict(H.GMmin, { range: r, scale: 4.6 });
      const f = (deg) => gz2d([rect(-2, 2, 0, 1)], [0, 0.3], 1.6, deg).gz;
      const roll2d = root2d((d) => gz2d([rect(-1, 1, 0, 1)], [0, 0.3], 0.8, d).gz, 100, 130);
      chk('box, KG 0.3 m: roll vanishes at 112.32° vs [2D] (°)', gzAnalysis(rel, H.V, 'x', { GM: H.GMt }).summary.vanish, roll2d, 0, 1e-6);
      chk('…the verdict\'s range is roll\'s, to 0.01° (directions within 0.1 % of roll\'s arm end up to 0.002° sooner) (°)', r.end, roll2d, 0, 0.01);
      chk('…pitch vanishes sooner, 99.89° vs [2D] (°)', gzAnalysis(rel, H.V, 'y', { GM: H.GML }).summary.vanish, root2d(f, 95, 110), 0, 1e-6);
      chk('…verdict: Stable, vanishes at 112.3°, not self-righting, with pitch\'s 99.9° as a note', v.level === 'good' && /vanishes at 112\.3°/.test(v.text) && !/self-righting/.test(v.text) && /range ends sooner, at 99\.9°/.test(v.text), true);
    }
    {
      // R1-34: a closed 20 × 5 × 2.5 m hull at T 1 m, KG 1.5 m vanishes at 78.55° in roll [2D]. Pitched with free trim
      // (free roll) it loses roll stability once the stern's bilge is out and rolls over near 14°, but only after a
      // righting arm of 3.8 m. With free trim the verdict's range is roll's, and the near-pitch roll-over is a fold: GZ
      // jumps there from well above zero, at the angle where the trim followed from upright is lost, not halfway between
      // two samples (12.5°)
      const { rel, H } = floating(boxTris(20, 5, 2.5), [10, 0, 1.5], 100000);
      const want = root2d((d) => gz2d([rect(-2.5, 2.5, 0, 2.5)], [0, 1.5], 5, d).gz, 60, 90);
      const r = await range(rel, H, { freeTrim: true }), v = stabilityVerdict(H.GMmin, { range: r, scale: 21, freeTrim: true });
      chk('hull 20×5×2.5 m, T 1 m, KG 1.5 m, free trim: the verdict\'s range = roll\'s 78.55° vs [2D], to 0.01° (°)', r.end, want, 0, 0.01);
      // with free trim nothing holds the trim, so the arm is flat near roll (0.03 % more at 1.7° off): the tie of R1-36
      // takes a direction up to about 2° off roll whose range ends 0.005° sooner
      chk('…within 2° of roll, level good', Math.abs(((r.az + 90) % 180 + 180) % 180 - 90) < 2 && v.level === 'good', true);
      chk('…roll\'s own range, free trim, vs [2D] (°)', gzAnalysis(rel, H.V, 'x', { GM: H.GMt, freeTrim: true }).summary.vanish, want, 0, 1e-6);
      const p = gzAnalysis(rel, H.V, 87.78, { GM: gmAbout(H, 87.78), freeTrim: true }).summary;
      chk('…about the axis at 87.78° (free trim): the range ends at a fold between 13° and 15.5°, not at 12.5°', p.fold && p.vanish > 13 && p.vanish < 15.5, true);
      chk('…the verdict on that range says the free trim stops being an equilibrium there, not that GZ vanishes', /stops being an equilibrium/.test(stabilityVerdict(gmAbout(H, 87.78), { range: p, scale: 21, freeTrim: true }).text) && !/vanishes at/.test(stabilityVerdict(gmAbout(H, 87.78), { range: p, scale: 21, freeTrim: true }).text), true);
      const pf = await range(rel, H);
      chk('…fixed trim: the same range, 78.55° (°)', pf.end, want, 0, 1e-6);
      // R1-38: heeled about y (pitch) with free roll it rolls over within the 10°–15° step: the 15° sample follows the
      // body there (the trim found in 0.5° sub-steps, past 90° of roll, GZ negative), and the range ends at the fold,
      // below 15° (continuations in 0.25°, 0.05° and 0.01° steps lose the trim at 14.1°, 14.9° and 13.1°), not at a sample
      const y = gzAnalysis(rel, H.V, 90, { GM: gmAbout(H, 90), freeTrim: true }), y15 = y.curve.find((q) => q.deg === 15);
      chk('…heeled about y with free trim, the 15° sample has rolled over (trim past 90°, GZ < 0, a stable trim)', Math.abs(y15.trim) > Math.PI / 2 && y15.gz < 0 && !y15.trimUnstable, true);
      chk('…and the range ends at a fold between 13° and 15°, short of the 15° sample', y.summary.fold && y.summary.vanish > 13 && y.summary.vanish < 15 - 1e-6, true);
    }
    {
      // R1-37, Q6: the free-trim zero band. A 10 × 2 × 1 m pontoon (T 0.5 m, KG 0.5 m) heeled about y with free roll
      // rolls onto its side; at 90° of roll a heel about y is a yaw, and GZ is zero up to what the trim solve leaves. The
      // range ends where the trim reaches 90°, against a continuation in 0.002° steps
      const { rel, H } = floating(boxTris(10, 2, 1), [5, 0, 0.5], 10000);
      const s = gzAnalysis(rel, H.V, 90, { GM: gmAbout(H, 90), freeTrim: true }).summary;
      let t = gzAt(rel, H.V, 90, 10, { freeTrim: true }).trim, d = 12, prev = null;
      for (; d <= 13.5; d += 0.002) { const q = gzAt(rel, H.V, 90, d, { freeTrim: true, trim0: t }); if (prev && prev.gz > 1e-3 && q.gz < 1e-4) break; t = q.trim; prev = q; }
      chk('pontoon 10×2×1 m heeled about y, free trim: the range ends where it lies on its side, vs a 0.002° continuation (°)', s.vanish, d - 0.001, 0, 0.003);
      chk('…GZ runs down to zero there (not a fold)', s.fold, false);
      // a tangency is not a stretch: the corner-down cube heeled about the axis at 90° with free trim reaches the
      // edge-down equilibrium at asin(1/3), where GZ only touches zero
      const cube = transformTris(boxTris(1, 1, 1, -0.5, -0.5, -0.5), mat3.fromEulerDeg(45, Math.atan(1 / Math.SQRT2) / DEG, 0));
      const Hc = hydrostatics(cube, solveWaterline(cube, 0.5).zw, 500, 1000);
      chk('corner-down cube heeled about 90° with free trim: vanishes at the edge-down attitude, asin(1/3) = 19.4712° (°)', gzAnalysis(cube, Hc.V, 90, { GM: gmAbout(Hc, 90), freeTrim: true }).summary.vanish, Math.asin(1 / 3) / DEG, 0, 1e-4);
    }
    if (getTris) {
      // R1-25: the STEP sphere with G 0.3 m below and 0.05 m beside its centre: GZ = 0.3 sin φ + 0.05 cos φ in the worse
      // sense, which vanishes at 180° − atan(0.05/0.3) = 170.5377°. It is not self-righting
      const t = await getTris('sphere_r1.step'), mp = massProperties(t);
      const { rel, H } = floating(t, [mp.centroid[0], mp.centroid[1] + 0.05, mp.centroid[2] - 0.3], 1000 * mp.volume / 2);
      // every heel direction whose range ends takes the same largest arm, |CG| (B is under the centre), to the faceting
      // (0.09 %): arms within 0.1 % count as the same moment, and of those the range that ends soonest is taken (R1-36)
      const r = await range(rel, H), v = stabilityVerdict(H.GMmin, { range: r, scale: 3.5 });
      chk('STEP sphere, G 0.3 m low and 0.05 m off the centre: the verdict\'s range = 180° − atan(0.05/0.3) (°)', r.end, 180 - Math.atan(0.05 / 0.3) / DEG, 0, 0.01);
      chk('…verdict: not self-righting, and no "larger heeling moment" note', !/self-righting/.test(v.text) && !/larger heeling moment/.test(v.text), true);
    }
    if (getTris) {
      // R1-31: the 0.1° tolerance at 180°: G 3 mm off the centre gives 180° − atan(0.003/0.3) = 179.427°, not
      // self-righting
      const t = await getTris('sphere_r1.step'), mp = massProperties(t);
      const { rel, H } = floating(t, [mp.centroid[0], mp.centroid[1] + 0.003, mp.centroid[2] - 0.3], 1000 * mp.volume / 2);
      const r = await range(rel, H);
      chk('STEP sphere, G 0.3 m low and 3 mm off the centre: the verdict\'s range = 180° − atan(0.01) = 179.43° (°)', r.end, 180 - Math.atan(0.01) / DEG, 0, 0.01);
      chk('…the verdict: not self-righting', /self-righting/.test(stabilityVerdict(H.GMmin, { range: r, scale: 3.5 }).text), false);
    }
    if (getTris) {
      // R1-18: the classic self-righting body, a sphere with G 0.3 m below its centre (GZ = 0.3 sin φ > 0 on (0°, 180°));
      // faceting moves the zero at 180° by thousandths of a degree, which must not cost the "self-righting" words
      const t = await getTris('sphere_r1.step'), mp = massProperties(t);
      const { rel, H } = floating(t, [mp.centroid[0], mp.centroid[1], mp.centroid[2] - 0.3], 1000 * mp.volume / 2);
      const both = [0, 180].map((o) => gzAnalysis(rel, H.V, o, { GM: gmAbout(H, o) }).summary);
      chk('STEP sphere, G 0.3 m below the centre: GZ about x positive to 180° in both senses (vanish none)', both.every((x) => x.vanish === null), true);
      const v = stabilityVerdict(H.GMmin, { range: await range(rel, H), scale: 3.5 });
      chk('…verdict: self-righting', /self-righting/.test(v.text) && !/vanishes/.test(v.text), true);
    }
    out.push({ id: 'stability_verdict', title: 'Stability verdict: small-angle words from GM_min, range words from the GZ curves over all heel directions, downflooding', ref: '[IMO] 2008 IS Code A 2.2.2 (GZ ≥ 0.2 m at ≥ 30°) and A 2.2.3 (max GZ at ≥ 25°); [SYM]; [2D]', rows });
  }

  // 4 — mesh checks, repair and origin-independent volume
  {
    const { rows, chk } = chkFactory();
    const box = boxTris(4, 2, 1), tol = 4.6e-7;
    const hyd = (t, G = [2, 0, 0.5]) => floating(t, G, 3200).H;
    const c0 = meshCheck(box, tol);
    chk('closed box: 0 open, 0 wound the wrong way', c0.open + c0.misoriented, 0, 0, 0);
    const side = flipTris(box, onPlane(1, 1));
    chk('one side face flipped: 4 edges wound the same way on both sides', meshCheck(side, tol).misoriented, 4, 0, 0);
    for (const [name, t] of [['one side face flipped', side], ['one triangle flipped', flipTris(box, (() => { let d = false; return (o, i) => (!d && onPlane(1, 1)(o, i) ? (d = true) : false); })())],
      ['bottom face flipped', flipTris(box, onPlane(2, 0))], ['every face flipped', flipTris(box)]]) {
      const r = repairMesh(t, tol), H = hyd(r.tris);
      chk(`${name}: repaired (0 wound the wrong way afterwards)`, r.report.misoriented, 0, 0, 0);
      chk(`${name}: after repair draft 0.4 m`, H.draft, 0.4, 0, 1e-12);
      chk(`${name}: after repair GM_T 0.5333 m`, H.GMt, 0.2 + 4 / 4.8 - 0.5, 0, 1e-12);
    }
    {
      const H = hyd(side);
      chk('unrepaired flipped side: the waterplane fault is flagged (negative BM)', H.wpBad, true);
    }
    // open deck: the volume is taken from the top centre, so it does not depend on the file origin
    for (const dz of [0, 3, -7]) {
      const t = transformTris(dropTris(box, onPlane(2, 1)), mat3.identity(), [0, 0, -dz]);
      const r = prepareMesh([soupFromIndexed(flipTris(t), null)]);
      const mp = massProperties(r.tris);
      chk(`deckless box with the keel at z = ${dz} m, every face flipped in the file: 4 open edges`, r.report.open, 4, 0, 0);
      chk(`…enclosed volume 8 m³ (origin-independent)`, mp.volume, 8, 0, 1e-12);
      chk(`…floats at draft 0.4 m`, hyd(r.tris, [2, 0, dz + 0.5]).draft, 0.4, 0, 1e-12);
    }
    {
      // soupFromIndexed (STEP/STL import) turns a whole inverted part
      const inv = soupFromIndexed(flipTris(transformTris(box, mat3.identity(), [0, 0, -5])), null);
      chk('import: an inverted closed box 5 m above the origin gets volume +8 m³', massProperties(inv).volume, 8, 0, 1e-12);
    }
    {
      // an edge used by three triangles is not closed
      const fin = new Float64Array([...box, 0, -1, 0, 4, -1, 0, 2, -3, 0.5]);
      const c = meshCheck(fin, tol);
      chk('a fin sharing one edge with the box: that edge counts as open (3 uses)', c.open >= 1, true);
    }
    {
      // a duplicate of one triangle, wound the other way: its three edges are used 3 times each and no edge once
      const dup = new Float64Array([...box, box[0], box[1], box[2], box[6], box[7], box[8], box[3], box[4], box[5]]);
      chk('closed box plus a reversed copy of one triangle: 3 edges used 3 times count as open', meshCheck(dup, tol).open, 3, 0, 0);
    }
    {
      // degenerate triangles (two corners welded) are left out; directed-edge balance accepts the closed surface
      const deg = new Float64Array([...box, 0, -1, 0, 0, -1, 0, 4, -1, 0]);
      chk('closed box plus a degenerate triangle on one of its edges: 0 open, 0 wound wrong', meshCheck(deg, tol).open + meshCheck(deg, tol).misoriented, 0, 0, 0);
    }
    {
      // Q3: overlapping shells and a void
      const cube = boxTris(1, 1, 1, 1.5, -0.5, 0.5);
      const ov = repairMesh(new Float64Array([...box, ...cube]), tol).report;
      chk('box + a cube that overlaps it: 2 shells, an overlap reported', ov.shells === 2 && ov.overlaps >= 1 && ov.voids === 0, true);
      const v = repairMesh(new Float64Array([...box, ...flipTris(boxTris(1, 0.5, 0.5, 1.5, -0.25, 0.25))]), tol);
      chk('box with an inward-wound inner shell: 1 void, no overlap, nothing turned', v.report.voids === 1 && v.report.overlaps === 0 && v.report.inverted === 0, true);
      chk('…volume 8 − 0.25 m³', massProperties(v.tris).volume, 7.75, 0, 1e-12);
      const lone = repairMesh(new Float64Array([...box, ...flipTris(boxTris(1, 1, 1, 6, 0, 0))]), tol);
      chk('box and a separate inverted cube: the cube is turned (volume 9 m³)', massProperties(lone.tris).volume, 9, 0, 1e-12);
    }
    {
      // R1-16: parts that touch along shared edges, one of them inside out, in one soup
      const lower = boxTris(4, 2, 1);
      for (const [h, want] of [[1, 16], [0.5, 12]]) {
        // the contact faces are triangulated differently (prism() splits the top and bottom along opposite diagonals)
        const r = repairMesh(new Float64Array([...lower, ...flipTris(boxTris(4, 2, h, 0, -1, 1))]), tol);
        chk(`stacked boxes 4×2×1 + 4×2×${h}, the upper one inside out: volume ${want} m³`, massProperties(r.tris).volume, want, 0, 1e-12);
        chk('…2 shells, the upper one turned, no overlap or void reported', r.report.shells === 2 && r.report.inverted === 1 && r.report.overlaps === 0 && r.report.voids === 0, true);
      }
      // the contact triangles identical (the upper box is the lower one mirrored about z = 1, so it is inside out): each
      // contact triangle is its own patch, joined to a fixed side of its plane, in either order of the parts in the file
      const mir = Float64Array.from(lower); for (let i = 2; i < mir.length; i += 3) mir[i] = 2 - mir[i];
      for (const [name, t] of [['lower first', [...lower, ...mir]], ['upper first', [...mir, ...lower]]]) {
        const r = repairMesh(new Float64Array(t), tol);
        chk(`stacked boxes with identical contact triangles, the upper one inside out (${name}): volume 16 m³, closed`, Math.abs(massProperties(r.tris).volume - 16) < 1e-12 && r.report.open === 0 && r.report.misoriented === 0, true);
      }
      {
        // the same with the triangles in a shuffled order, so the file order says nothing about which part a triangle is in
        const t = new Float64Array([...lower, ...flipTris(boxTris(4, 2, 0.5, 0, -1, 1))]), n = t.length / 9;
        for (const sd of [0, 1, 2]) {
          const q = Array.from({ length: n }, (_, i) => i);   // Fisher–Yates with a fixed seed per order
          let seed = 12345 + 777 * sd; for (let i = n - 1; i > 0; i--) { seed = (seed * 1103515245 + 12345) % 2147483648; const j = seed % (i + 1); [q[i], q[j]] = [q[j], q[i]]; }
          const o = new Float64Array(t.length);
          q.forEach((src, i) => o.set(t.subarray(src * 9, src * 9 + 9), i * 9));
          chk(`stacked boxes 4×2×1 + 4×2×0.5, upper inside out, triangles shuffled (order ${sd + 1}): volume 12 m³`, massProperties(repairMesh(o, tol).tris).volume, 12, 0, 1e-12);
        }
      }
      const edge = repairMesh(new Float64Array([...lower, ...flipTris(boxTris(4, 2, 1, 0, 1, 1))]), tol);
      chk('two boxes sharing one edge, the second inside out: volume 16 m³', massProperties(edge.tris).volume, 16, 0, 1e-12);
      // a hollow body (void 1.5 m³) turned inside out as a whole, next to a raft, through repairMesh alone (no whole-file
      // flip first): the hollow body and its void are both turned back
      const outer = boxTris(4, 2, 1, 0, -1, -3), inner = flipTris(boxTris(3, 1, 0.5, 0.5, -0.5, -2.75)), raft = boxTris(10, 10, 1, -5, -5, 0);
      const hb = repairMesh(new Float64Array([...raft, ...flipTris(new Float64Array([...outer, ...inner]))]), tol);
      chk('raft + hollow box inside out: volume 100 + 8 − 1.5 = 106.5 m³', massProperties(hb.tris).volume, 106.5, 0, 1e-12);
      chk('…1 void, no overlap', hb.report.voids === 1 && hb.report.overlaps === 0, true);
      const core = boxTris(1, 0.5, 0.2, 1.5, -0.25, -2.6);
      const nest = repairMesh(flipTris(new Float64Array([...outer, ...inner, ...core])), tol);
      chk('box / void / solid core inside the void, all inside out: volume 8 − 1.5 + 0.1 = 6.6 m³', massProperties(nest.tris).volume, 6.6, 0, 1e-12);
    }
    {
      // R1-19: shells whose surfaces cross are overlaps; shells that only touch are not
      const A = boxTris(4, 1, 1, -2, -0.5, 0), B = transformTris(A, mat3.rotZ(Math.PI / 2));
      chk('two 4×1×1 m boxes crossing at right angles (no face centroid of either inside the other): overlap reported', repairMesh(new Float64Array([...A, ...B]), tol).report.overlaps, 2, 0, 0);
      const C = boxTris(2, 2, 1, -1, -1, 0), D = boxTris(1, 1, 1, 0.5, 0.5, 0.5);
      chk('a box and a cube poking out of one corner: overlap reported', repairMesh(new Float64Array([...C, ...D]), tol).report.overlaps, 2, 0, 0);
      chk('stacked boxes that only touch: no overlap', repairMesh(new Float64Array([...boxTris(4, 2, 1), ...boxTris(4, 2, 1, 0, -1, 1)]), tol).report.overlaps, 0, 0, 0);
    }
    {
      // R1-26: parts that share an edge but not a whole face: a deckhouse 4 × 1 × 1 m flush with the side of a 4 × 2 × 1 m
      // hull (one edge used by four triangles). Union 12 m³, whichever part is inside out, in either file order, and
      // whichever of the hull's triangles comes first
      const hull = boxTris(4, 2, 1), house = boxTris(4, 1, 1, 0, 0, 1);
      const cases = [['both outward', hull, house], ['deckhouse inside out', hull, flipTris(house)], ['hull inside out', flipTris(hull), house]];
      for (const [name, a, b] of cases) for (const [ord, t] of [['hull first', [...a, ...b]], ['deckhouse first', [...b, ...a]]]) {
        const r = repairMesh(new Float64Array(t), tol);
        chk(`hull + flush deckhouse, ${name}, ${ord}: volume 12 m³, closed, no overlap`, Math.abs(massProperties(r.tris).volume - 12) < 1e-12 && r.report.open + r.report.misoriented === 0 && r.report.overlaps === 0, true);
      }
      let rot = true;
      for (let k = 0; k < 12; k++) {
        const h = new Float64Array([...hull.slice(k * 9), ...hull.slice(0, k * 9)]);
        if (Math.abs(massProperties(repairMesh(new Float64Array([...h, ...house]), tol).tris).volume - 12) > 1e-12) rot = false;
      }
      chk('…with each of the hull\'s 12 triangles first: 12 m³', rot, true);
      chk('…through the STL import path: 12 m³', massProperties(prepareMesh([soupFromIndexed(Float32Array.from([...hull, ...flipTris(house)]), null)]).tris).volume, 12, 0, 1e-6);
      // R1-35: a conforming contact, the hull's deck split at y = 0 under the deckhouse (its end faces fanned to take the
      // split's vertex), so the contact faces are the same triangles: at the deckhouse's base edges the two side faces
      // are on opposite sides of the contact plane. Each part outward or inside out, both file orders, the first part's
      // triangles rotated 12 ways
      const Vx = (x, y, z) => [x, y, z], split = [];
      for (const [a, b, c, d] of [[Vx(0, -1, 0), Vx(0, 1, 0), Vx(4, 1, 0), Vx(4, -1, 0)], [Vx(0, -1, 1), Vx(4, -1, 1), Vx(4, 0, 1), Vx(0, 0, 1)], [Vx(0, 0, 1), Vx(4, 0, 1), Vx(4, 1, 1), Vx(0, 1, 1)],
        [Vx(0, -1, 0), Vx(4, -1, 0), Vx(4, -1, 1), Vx(0, -1, 1)], [Vx(0, 1, 0), Vx(0, 1, 1), Vx(4, 1, 1), Vx(4, 1, 0)]]) split.push(...a, ...b, ...c, ...a, ...c, ...d);
      for (const [x, sg] of [[0, -1], [4, 1]]) {
        const ring = [Vx(x, -1, 0), Vx(x, 1, 0), Vx(x, 1, 1), Vx(x, 0, 1), Vx(x, -1, 1)], r = sg > 0 ? ring : ring.slice().reverse();
        for (let i = 1; i + 1 < r.length; i++) split.push(...r[0], ...r[i], ...r[i + 1]);
      }
      const sb = new Float64Array(split), rotT = (t, k) => new Float64Array([...t.slice(k * 9), ...t.slice(0, k * 9)]);
      let bad = 0, n = 0;
      for (const [a, b] of [[sb, house], [flipTris(sb), house], [sb, flipTris(house)]]) for (const ord of [0, 1]) for (let k = 0; k < 12; k++) {
        const r = repairMesh(new Float64Array(ord ? [...rotT(b, k), ...a] : [...rotT(a, k), ...b]), tol); n++;
        if (Math.abs(massProperties(r.tris).volume - 12) > 1e-12 || r.report.overlaps) bad++;
      }
      chk(`conforming hull (deck split under the deckhouse) + deckhouse, ${n} variants: all 12 m³, no overlap`, bad, 0, 0, 0);
    }
    {
      // R1-33: an end slab 1 × 2 × 1 m inside the 4 × 2 × 1 m hull, sharing its end face (the same triangles, wound the
      // same way). The two parts are separated at the shared face, so the overlap is found (the sum, 10 m³, is counted)
      const hull = boxTris(4, 2, 1), slab = boxTris(1, 2, 1, 3);
      let ok = true;
      for (const t of [[...hull, ...slab], [...slab, ...hull]]) for (let k = 0; k < 12; k++) {
        const h = new Float64Array([...t.slice(k * 9), ...t.slice(0, k * 9)]), r = repairMesh(h, tol);
        if (!(r.report.shells === 2 && r.report.closedShells === 2 && r.report.overlaps === 2 && Math.abs(massProperties(r.tris).volume - 10) < 1e-12)) ok = false;
      }
      chk('end slab inside the hull sharing its end face, both file orders × 12 rotations: 2 closed shells, overlap reported', ok, true);
      // R1-38: a block fitted into a corner of the hull (x 3..4, y 0..1, full height): four of its faces on the hull's planes
      const blk = boxTris(1, 1, 1, 3, 0, 0);
      chk('block fitted into a corner of the hull, both file orders: overlap reported', [[...hull, ...blk], [...blk, ...hull]].every((t) => repairMesh(new Float64Array(t), tol).report.overlaps === 2), true);
    }
    {
      // R1-27: blocks that only touch the hull (on its deck, under its bottom) are not overlaps; a coplanar overlap is
      const hull = boxTris(4, 2, 1);
      let touch = 0;
      for (const [x, y, w, d] of [[1, -0.5, 2, 1], [0.123, -0.777, 1.234, 0.987], [0, -1, 4, 2], [2, -0.5, 2, 1]]) for (const z of [1, -1]) {
        const blk = boxTris(w, d, 1, x, y, z);
        for (const t of [[...hull, ...blk], [...blk, ...hull]]) touch += repairMesh(new Float64Array(t), tol).report.overlaps;
      }
      chk('blocks standing on the deck or hanging under the bottom, 8 placements × 2 file orders: no overlap reported', touch, 0, 0, 0);
      chk('two 4×2×1 m blocks overlapping 1 m along their length (the same section, faces coplanar): overlap reported', repairMesh(new Float64Array([...hull, ...boxTris(4, 2, 1, 3)]), tol).report.overlaps, 2, 0, 0);
    }
    {
      // review Q1: when the work budget runs out, a negative shell that may be a void is not turned into a solid
      const r = repairMesh(new Float64Array([...boxTris(4, 2, 1), ...flipTris(boxTris(1, 0.5, 0.5, 1.5, -0.25, 0.25))]), tol, { budget: 1 });
      chk('box with an inward inner shell, overlap check stopped by a tiny budget: inner shell left as a void (volume 7.75 m³)', !r.report.nestChecked && Math.abs(massProperties(r.tris).volume - 7.75) < 1e-12, true);
      // R1-35: a pair that was tested before the budget ran out counts. An L-section hull and an inside-out block in its
      // notch (inside the hull's bounding box, outside the hull): with the budget one short of the whole check (found by
      // bisection), the pair is tested, the check is still marked incomplete, and the block is turned (12 + 0.25 m³)
      const L = prism([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], 0, 4), blk = flipTris(boxTris(1, 0.5, 0.5, 1.5, 1.25, 1.25));
      const soup = new Float64Array([...L, ...blk]);
      let lo = 0, hi = 1e7;   // smallest budget for which the check completes
      while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (repairMesh(soup, tol, { budget: m }).report.nestChecked) hi = m; else lo = m; }
      const rb = repairMesh(soup, tol, { budget: hi - 1 });
      chk('L-section hull + inside-out block in its notch, budget one short: check incomplete, block turned (12.25 m³)', !rb.report.nestChecked && Math.abs(massProperties(rb.tris).volume - 12.25) < 1e-12, true);
    }
    {
      // R1-21: welding by distance. Copies of a vertex 2e-13 m apart on either side of a cell boundary are one vertex
      const w = 1e-6;
      for (const [name, x] of [['a cell boundary', Math.round(4 / w) * w], ['the old rounding boundary', Math.round(4 / w) * w + w / 2]]) {
        const b = Float64Array.from(boxTris(4, 2, 1));
        let k = 0; for (let i = 0; i < b.length; i += 3) if (Math.abs(b[i] - 4) < 1e-9) b[i] = x + (k++ % 2 ? 1e-13 : -1e-13);
        const c = meshCheck(b, w);
        chk(`box whose end vertices straddle ${name} (copies 2e-13 m apart): closed, 0 open, 0 wound wrong`, c.open + c.misoriented, 0, 0, 0);
        chk('…welds to the box\'s 8 corners', weld(b, w).nVerts, 8, 0, 0);
      }
      const far = weld(new Float64Array([0, 0, 0, 1.5e-6, 0, 0, 0, 0, 0]), 1e-6);
      chk('two points 1.5 tol apart are not joined; exact copies are', far.vid[0] === far.vid[2] && far.vid[0] !== far.vid[1], true);
    }
    if (getTris) {
      // the closed STEP spheres: degenerate pole triangles must not be reported as open
      for (const f of ['sphere_r1.step', 'kramer_sphere.step']) {
        const t = await getTris(f);
        const b = massProperties(t), diag = 2 * Math.cbrt(3 * Math.abs(b.volume) / (4 * Math.PI)) * Math.sqrt(3);
        const c = meshCheck(t, diag * 1e-7);
        chk(`${f}: closed and consistently oriented (0 open, 0 wound wrong; ${c.degenerate} degenerate triangles left out)`, c.open + c.misoriented, 0, 0, 0);
      }
    }
    out.push({ id: 'mesh_check', title: 'Mesh checks: directed-edge balance, repair of flipped faces, open hulls, overlapping shells and voids', ref: 'a closed oriented surface uses every directed edge as often as its reverse', rows });
  }

  // 5 — neutral buoyancy, the static rest attitude and free trim
  {
    const { rows, chk } = chkFactory();
    const box = boxTris(4, 2, 1);
    {
      const rel = transformTris(box, mat3.identity(), [2, 0, 0.5]);
      const s = solveWaterline(rel, 8);
      chk('mass = ρ·V_total exactly: status sinks with neutral flag (no float plane)', s.status === 'sinks' && s.neutral === true, true);
      chk('mass 1.000001·ρV: sinks, not neutral', solveWaterline(rel, 8.000008).neutral, false);
      chk('mass 0.999999·ρV: floats', solveWaterline(rel, 7.999992).status, 'floats');
    }
    {
      // rest attitude from a start 0.3° off the wall-sided list of the box with its CoG 50 mm off the centreline
      const T = 0.4, KB = 0.2, BM = 4 / (12 * T), GM = KB + BM - 0.5;
      let lo = 0, hi = 0.5; for (let i = 0; i < 200; i++) { const t = (lo + hi) / 2; t * (GM + 0.5 * BM * t * t) < 0.05 ? lo = t : hi = t; }
      const phi = Math.atan(lo) / DEG;
      const body = transformTris(box, mat3.identity(), [2, 0.05, 0.5]);
      const r = restAttitude(body, 3.2, mat3.fromEulerDeg(-phi + 0.3, 0.2, 10));
      const e = mat3.toEulerDeg(r.R);
      chk('rest attitude (Newton on B under G): converged', r.converged, true);
      // the list is about the box's own x axis: roll in the yawed frame; read it from the body's up vector
      const up = r.R.slice(6, 9);
      chk('rest attitude: list = wall-sided −5.31999° [RT]', Math.atan2(up[1], up[2]) / DEG, -phi, 0, 1e-6);
      chk('rest attitude: no trim', Math.asin(-up[0]) / DEG, 0, 0, 1e-6);
      chk('rest attitude: yaw nearly unchanged (10°; turning about world axes moves it only at second order)', e[2], 10, 0, 0.01);
    }
    {
      // free trim: a box is symmetric fore and aft, so free trim = fixed trim and the trim stays 0
      const { rel, H } = floating(box, [2, 0, 0.5], 3200);
      const fx = gzAnalysis(rel, H.V, 'x', { GM: H.GMt }), fr = gzAnalysis(rel, H.V, 'x', { GM: H.GMt, freeTrim: true });
      chk('box: free-trim GZ = fixed-trim GZ (symmetric fore and aft), largest difference (m)', Math.max(...fr.curve.map((p, i) => Math.abs(p.gz - fx.curve[i].gz))), 0, 0, 1e-9);
      chk('box: free trim stays 0', Math.max(...fr.curve.map((p) => Math.abs(p.trim))), 0, 0, 1e-9);
    }
    {
      // a scow: the forward half's bottom rises to 0.8 m at the bow. Free trim must (1) leave no trimming moment,
      // (2) be the trim of least potential energy, (3) satisfy dE/dφ = W·GZ·cos(trim) (envelope theorem; the heel
      // axis is tilted by the trim), and (4) reproduce the reviewer's independent free-trim search
      const sec = [[0, 0], [2, 0], [4, 0.8], [4, 1], [0, 1]];   // (x, z), extruded along y
      const p = prism(sec, -1, 1), scow = new Float64Array(p.length);
      for (let i = 0; i < p.length; i += 3) { scow[i] = p[i + 1]; scow[i + 1] = -p[i]; scow[i + 2] = p[i + 2]; }
      const sub = submerged(scow, 0.45), G = [sub.B[0], 0, 0.55], mass = 1000 * sub.V;
      const { rel, H } = floating(scow, G, mass);
      const fr = gzAnalysis(rel, H.V, 'x', { GM: H.GMt, freeTrim: true });
      const fx = gzAnalysis(rel, H.V, 'x', { GM: H.GMt });
      chk('scow: free trim leaves no trimming moment (largest |B·u|, m)', Math.max(...fr.curve.map((q) => Math.abs(q.along ?? 0))), 0, 0, 1e-9);
      const U = (deg, trim) => {   // potential energy per unit weight: zG − zB = −B_z (G at the origin)
        const R = mat3.mul(mat3.rotY(trim), mat3.rotX(deg * DEG));   // as gzAt: heel about x, then trim about y
        const t = transformTris(rel, R), s = solveWaterline(t, H.V);
        return -s.sub.B[2];
      };
      let minOk = true, envWorst = 0;
      for (const q of fr.curve.filter((c) => c.deg >= 10 && c.deg <= 80 && c.deg % 10 === 0)) {
        const e0 = U(q.deg, q.trim);
        if (!(U(q.deg, q.trim + 0.01) > e0 && U(q.deg, q.trim - 0.01) > e0)) minOk = false;
        const h = 1e-3, E = (d) => { const r = gzAt(rel, H.V, 'x', d, { freeTrim: true, trim0: q.trim }); return U(d, r.trim); };
        envWorst = Math.max(envWorst, Math.abs((E(q.deg + h) - E(q.deg - h)) / (2 * h * DEG) - q.gz * Math.cos(q.trim)));
      }
      chk('scow: free trim is the trim of least potential energy at 10°–80°', minOk, true);
      chk('scow: dE/dφ = GZ·cos(trim) per unit weight at 10°–80° (largest difference, m)', envWorst, 0, 0, 1e-6);
      const at = (c, d) => c.curve.find((q) => q.deg === d);
      chk('scow 30°: free-trim GZ 0.2902 m at trim −4.24° (reviewer\'s search, 4 digits)', +at(fr, 30).gz.toFixed(4) === 0.2902 && +(at(fr, 30).trim / DEG).toFixed(2) === -4.24, true);
      chk('scow 40°: free-trim GZ 0.2994 m at trim −7.27°', +at(fr, 40).gz.toFixed(4) === 0.2994 && +(at(fr, 40).trim / DEG).toFixed(2) === -7.27, true);
      chk('scow: fixed trim overstates the max GZ (0.3536 against 0.3040 m)', fx.summary.max > fr.summary.max, true);
      chk('scow: fixed trim overstates the vanishing angle (90.9° against 85.0°)', fx.summary.vanish > fr.summary.vanish, true);
    }
    {
      // free trim must take the trim of least energy, not the symmetric one: the corner-down cube heeled about an axis
      // of symmetry has B level with G at trim 0 by symmetry, but that trim is an energy maximum
      const cube = boxTris(1, 1, 1, -0.5, -0.5, -0.5), d = [1, 1, 1].map((x) => x / Math.sqrt(3)), a = Math.acos(d[2]);
      const k = [d[1] / Math.hypot(d[0], d[1]), -d[0] / Math.hypot(d[0], d[1])], C = Math.cos(a), S = Math.sin(a), K = 1 - C;
      const rel = transformTris(cube, [C + K * k[0] * k[0], K * k[0] * k[1], S * k[1], K * k[0] * k[1], C + K * k[1] * k[1], -S * k[0], -S * k[1], S * k[0], C]);
      const H = hydrostatics(rel, solveWaterline(rel, 0.5).zw, 500, 1000), az = H.axisMinDeg + 90;   // an axis of symmetry
      const [ux, uy] = [Math.cos(az * DEG), Math.sin(az * DEG)];
      const U = (deg, trim) => { const R = mat3.mul(rotH(-uy, ux, trim), rotH(ux, uy, deg * DEG)); return -solveWaterline(transformTris(rel, R), H.V).sub.B[2]; };
      let ok = true, lower = 0;
      for (const deg of [10, 15, 20]) {
        const r = gzAt(rel, H.V, az, deg, { freeTrim: true });
        const e = U(deg, r.trim);
        if (!(U(deg, r.trim + 0.01) > e && U(deg, r.trim - 0.01) > e)) ok = false;
        if (e < U(deg, 0) - 1e-9) lower++;
      }
      chk('corner-down cube heeled 10°, 15°, 20° about an axis of symmetry: free trim is a local energy minimum', ok, true);
      chk('…below the energy of the symmetric trim 0 at all three angles', lower, 3, 0, 0);
    }
    {
      // R1-31: of the two stable trims on either side of an unstable one, the one of less energy is kept. The corner-down
      // cube with G moved 0.02 m along the trim axis and 0.002 m along the heel axis, heeled 20° about an axis of
      // symmetry: the trim at −2.7° is unstable, the stable ones at about −32.3° and +37.2° differ in energy by 2.3×10⁻³
      // per unit weight. Started at the unstable trim, gzAt must take the lower
      const cube = boxTris(1, 1, 1, -0.5, -0.5, -0.5), d = [1, 1, 1].map((x) => x / Math.sqrt(3)), a = Math.acos(d[2]);
      const k = [d[1] / Math.hypot(d[0], d[1]), -d[0] / Math.hypot(d[0], d[1])], C = Math.cos(a), S = Math.sin(a), K = 1 - C;
      const base = transformTris(cube, [C + K * k[0] * k[0], K * k[0] * k[1], S * k[1], K * k[0] * k[1], C + K * k[1] * k[1], -S * k[0], -S * k[1], S * k[0], C]);
      const az = hydrostatics(base, solveWaterline(base, 0.5).zw, 500, 1000).axisMinDeg + 90, [ux, uy] = [Math.cos(az * DEG), Math.sin(az * DEG)];
      const rel = transformTris(base, mat3.identity(), [-uy * 0.02 + ux * 0.002, ux * 0.02 + uy * 0.002, 0]);
      const ev = (t) => { const s0 = solveWaterline(transformTris(rel, mat3.mul(rotH(-uy, ux, t), rotH(ux, uy, 20 * DEG))), 0.5).sub.B; return { along: s0[0] * ux + s0[1] * uy, U: -s0[2] }; };
      const bis = (lo, hi) => { let flo = ev(lo).along; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2, fm = ev(m).along; if (fm * flo > 0) { lo = m; flo = fm; } else hi = m; } return (lo + hi) / 2; };
      const tu = bis(-0.15, 0.05), tm = bis(-0.8, -0.4), tp = bis(0.5, 0.75), want = ev(tm).U < ev(tp).U ? tm : tp;
      chk('…the two stable trims differ in energy (per unit weight)', Math.abs(ev(tm).U - ev(tp).U) > 1e-3, true);
      const r = gzAt(rel, 0.5, az, 20, { freeTrim: true, trim0: tu });
      chk('offset cube heeled 20° about an axis of symmetry, started at the unstable trim: the stable trim of less energy (rad)', r.trim, want, 0, 1e-6);
    }
    if (getTris) {
      // R1-30: a sphere with G 0.3 m low, heeled past 85°, has no stable trim within ±90° (every trim lowers G): free trim
      // flags it, keeps the curve (for a sphere the trim does not change GZ), and does the search once per curve
      const t = await getTris('sphere_r1.step'), mp = massProperties(t);
      const rel = transformTris(t, mat3.identity(), [mp.centroid[0], mp.centroid[1], mp.centroid[2] - 0.3]), V = mp.volume / 2;
      const fr = gzAnalysis(rel, V, 'x', { freeTrim: true }), fx = gzAnalysis(rel, V, 'x');
      chk('STEP sphere, G 0.3 m low: free trim flags the heel angles with no stable trim (from 85° on)', fr.curve.filter((p) => p.trimUnstable).length > 0 && fr.curve.every((p) => !p.trimUnstable || p.deg >= 80), true);
      chk('…and its GZ equals fixed trim\'s (largest difference, m)', Math.max(...fr.curve.map((p, i) => Math.abs(p.gz - fx.curve[i].gz))), 0, 0, 1e-6);
    }
    out.push({ id: 'rest_and_trim', title: 'Neutral buoyancy, static rest attitude (Newton), free-trim GZ (no trimming moment, least energy, envelope theorem)', ref: '[RT] wall-sided list; potential energy U = W(z_G − z_B)', rows });
  }

  // 6 — the cube's resting attitude by global energy minimisation (review question Q1)
  {
    const { rows, chk } = chkFactory();
    const cube = transformTris(boxTris(1, 1, 1, 0, 0, 0), mat3.identity(), [0.5, 0.5, 0.5]);   // G at the centre
    const Rup = ([x, y, z]) => {   // a rotation whose world vertical is the body direction (x, y, z)
      const s = Math.hypot(x, y); if (s < 1e-15) return z > 0 ? mat3.identity() : mat3.rotX(Math.PI);
      const k = [y / s, -x / s], a = Math.atan2(s, z), C = Math.cos(a), S = Math.sin(a), K = 1 - C;
      return [C + K * k[0] * k[0], K * k[0] * k[1], S * k[1], K * k[0] * k[1], C + K * k[1] * k[1], -S * k[0], -S * k[1], S * k[0], C];
    };
    const sph = (t, p) => [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)];
    const U = (u, sg) => -solveWaterline(transformTris(cube, Rup(u)), sg).sub.B[2];
    const nm = (f, x0) => {   // Nelder–Mead in the two angles of the vertical
      let P = [x0, [x0[0] + 0.3, x0[1]], [x0[0], x0[1] + 0.3]].map((p) => ({ p, f: f(p) }));
      for (let it = 0; it < 4000; it++) {
        P.sort((a, b) => a.f - b.f);
        if (P[2].f - P[0].f < 1e-15 && it > 50) break;
        const c = [(P[0].p[0] + P[1].p[0]) / 2, (P[0].p[1] + P[1].p[1]) / 2], ref = (t) => [c[0] + t * (P[2].p[0] - c[0]), c[1] + t * (P[2].p[1] - c[1])];
        const r = { p: ref(-1) }; r.f = f(r.p);
        if (r.f < P[0].f) { const e = { p: ref(-2) }; e.f = f(e.p); P[2] = e.f < r.f ? e : r; } else if (r.f < P[1].f) P[2] = r;
        else { const k = { p: ref(0.5) }; k.f = f(k.p); if (k.f < P[2].f) P[2] = k; else for (const i of [1, 2]) { P[i].p = [(P[0].p[0] + P[i].p[0]) / 2, (P[0].p[1] + P[i].p[1]) / 2]; P[i].f = f(P[i].p); } }
      }
      return P.sort((a, b) => a.f - b.f)[0];
    };
    // [IH] corner-down: F(t) = P(S ≤ t), M(t) = E[S; S ≤ t] for S a sum of three U(0, 1)
    const F = (t) => (t <= 1 ? t ** 3 / 6 : (t ** 3 - 3 * (t - 1) ** 3) / 6);
    const M = (t) => (t <= 1 ? t ** 4 / 8 : 1 / 8 + ((-(t ** 4) / 2 + 2 * t ** 3 - 1.5 * t * t) - (-0.5 + 2 - 1.5)) / 2);
    for (const sg of [0.5, 0.3, 0.25]) {
      let lo = 0, hi = 2; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; F(m) < sg ? lo = m : hi = m; }
      const corner = (1.5 - M(lo) / F(lo)) / Math.sqrt(3), face = 0.5 - sg / 2, edge = (1 - 2 * Math.sqrt(2 * sg) / 3) / Math.SQRT2;
      let best = null;
      for (let i = 0; i < 40; i++) {
        const z = 1 - (i + 0.5) / 40, r = nm((q) => U(sph(q[0], q[1]), sg), [Math.acos(z), i * Math.PI * (3 - Math.sqrt(5))]);
        if (!best || r.f < best.f) best = r;
      }
      const u = sph(...best.p);
      const off = Math.acos(Math.min(1, (Math.abs(u[0]) + Math.abs(u[1]) + Math.abs(u[2])) / Math.sqrt(3))) / DEG;
      chk(`s.g. ${sg}: global minimum of z_G − z_B over all attitudes (40 starts) = corner-down closed form [IH]`, best.f, corner, 0, 1e-9);
      chk(`s.g. ${sg}: …lower than edge-down (${edge.toFixed(6)}) and face-down (${face.toFixed(6)})`, best.f < edge && edge < face, true);
      chk(`s.g. ${sg}: …at the minimum the vertical is a body diagonal (°)`, off, 0, 0, 1e-3);
      if (sg === 0.5) {
        chk('s.g. ½: Float Sim at edge-down gives z_G − z_B = √2/6', U([0, Math.SQRT1_2, Math.SQRT1_2], 0.5), Math.SQRT2 / 6, 0, 1e-12);
        chk('s.g. ½: Float Sim at face-down gives ¼', U([0, 0, 1], 0.5), 0.25, 0, 1e-12);
      }
    }
    out.push({ id: 'cube_rest', title: 'Cube rest attitude: global minimisation of the potential energy over all orientations, s.g. ½, 0.3, 0.25', ref: '[IH] Irwin–Hall closed form of the corner-down cube; edge- and face-down closed forms', rows });
  }
  return out;
}
