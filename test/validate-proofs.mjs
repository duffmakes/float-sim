// Float Sim against the proved closed forms (proofs/, Lean 4 + Mathlib).
//   node test/validate-proofs.mjs
// proofs/expected.json is written by `lake exe expected` in proofs/: the hydrostatic formulas proved in
// proofs/Proofs/Hydrostatics.lean and the stability criteria of proofs/Proofs/Stability.lean, evaluated exactly for
// the test models. This test checks
//   1. the hand-derived references in test/models/expected.json (which validate-node.mjs and validate.py use)
//      agree with the proved values, and
//   2. Float Sim's own hydrostatics (js/physics.js), run on the STEP files as the app imports them, agree with them,
//   3. mat3.toEulerDeg reads back the angles of a rotation, and rebuilds it at gimbal lock, as proofs/Proofs/Euler.lean
//      proves for its formulas,
//   4. js/physics.js `submerged`, run on the 12-triangle box of proofs/Proofs/MeshBox.lean (same triangles, same order)
//      at random sizes, positions and drafts, returns what `box_submerged` proves the transcribed algorithm returns,
//   5. `massProperties` gives the same volume, centroid and inertia from any reference point on the closed STEP models
//      (proofs/Proofs/Mesh.lean `massProperties_*_indep`).
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const J = (...p) => path.join(here, ...p);
globalThis.occtimportjs = createRequire(import.meta.url)('../vendor/occt-import-js.js');
const Ph = await import('../js/physics.js');
const { readCad, concat } = await import('../js/loader.js');

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); };
const proved = JSON.parse(await readFile(J('..', 'proofs', 'expected.json'), 'utf8')).cases;
const ref = JSON.parse(await readFile(J('models', 'expected.json'), 'utf8')).cases;
const val = (q) => q.num / q.den;
const KEYS = ['draft', 'KB', 'BMt', 'BMl', 'GMt', 'GMl'];

console.log('— test/models/expected.json against the proved values');
for (const [id, p] of Object.entries(proved)) {
  const r = ref.find((c) => c.id === id);
  if (!r) { check(`${id}: present in test/models/expected.json`, false); continue; }
  const keys = KEYS.filter((k) => k in r.expect);
  const worst = Math.max(...keys.map((k) => Math.abs(r.expect[k] - val(p[k])) / Math.max(1, Math.abs(val(p[k])))));
  const st = 'stable' in p ? r.expect.stable === p.stable : true;
  check(`${id}: ${keys.join(', ')}${'stable' in p ? ', stable' : ''}`, worst < 1e-12 && st, `largest difference ${worst.toExponential(1)}`);
}

console.log('\n— Float Sim (js/physics.js) on the STEP files against the proved values');
const stepCache = new Map();
const step = async (f) => {
  if (!stepCache.has(f)) stepCache.set(f, concat(await readCad(new Uint8Array(await readFile(J('models', f))), 'step', 'fine', J('..', 'vendor') + '/')).map((v) => v * 0.001));
  return stepCache.get(f);
};
for (const [id, p] of Object.entries(proved)) {
  const c = ref.find((q) => q.id === id);
  const tris = await step(c.file);
  const rel = Ph.transformTris(tris, Ph.mat3.fromEulerDeg(...c.euler), c.cog);
  const { zw } = Ph.solveWaterline(rel, c.mass / c.rho);
  const H = Ph.hydrostatics(rel, zw, c.mass, c.rho);
  const got = { draft: H.draft, KB: H.B[2] - H.zmin, BMt: H.BMt, BMl: H.BMl, GMt: H.GMt, GMl: H.GMl };
  // flat-sided bodies are exact up to round-off; cylinders carry the STEP tessellation's faceting
  const tol = c.curved ? 5e-4 : 1e-6;
  const errs = KEYS.map((k) => [k, Math.abs(got[k] - val(p[k])) / Math.max(0.05, Math.abs(val(p[k])))]);
  const [wk, we] = errs.reduce((m, e) => (e[1] > m[1] ? e : m));
  // stable: GM about the weakest waterplane axis (the app's test); these bodies are symmetric, so it is min(GM_T, GM_L)
  const st = 'stable' in p ? (H.GMmin > 0) === p.stable : true;
  check(`${id}: draft ${got.draft.toFixed(4)} m, GM_T ${got.GMt.toFixed(4)} m (proved ${val(p.GMt).toFixed(4)})${'stable' in p ? `, ${p.stable ? 'stable' : 'unstable'} upright` : ''}`,
    we <= tol && st, `worst ${wk}: relative error ${we.toExponential(1)} (limit ${tol.toExponential(0)})`);
}

console.log('\n— mat3.toEulerDeg (js/physics.js) against proofs/Proofs/Euler.lean');
{
  // toEuler_main: inside ±90° pitch the angles read back are the angles the rotation was built from
  let seed = 12345;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let worst = 0;
  for (let i = 0; i < 20000; i++) {
    const r = -179.999 + 359.998 * rnd(), p = -89.9 + 179.8 * rnd(), y = -179.999 + 359.998 * rnd();
    const e = Ph.mat3.toEulerDeg(Ph.mat3.fromEulerDeg(r, p, y));
    worst = Math.max(worst, Math.abs(e[0] - r), Math.abs(e[1] - p), Math.abs(e[2] - y));
  }
  check('20,000 random rotations, pitch within ±89.9°: roll, pitch and yaw read back (toEuler_main)', worst < 1e-9, `largest error ${worst.toExponential(1)}°`);
  // near and at ±90°: the angles rebuild the same rotation (toEuler_lock_up/down; the 1e-9 lock band is not proved)
  const diff = (A, B) => Math.max(...A.map((v, k) => Math.abs(v - B[k])));
  let wOut = 0, wBand = 0;
  for (const p of [89.9, 89.919, 89.99, 89.9999, 89.999999, 90 - 1e-7, 90 - 1e-8, 90 - 1e-9, 90, -89.95, -90 + 1e-7, -90]) {
    for (let i = 0; i < 200; i++) {
      const R = Ph.mat3.fromEulerDeg(-180 + 360 * rnd(), p, -180 + 360 * rnd());
      const d = diff(R, Ph.mat3.fromEulerDeg(...Ph.mat3.toEulerDeg(R)));
      if (Math.abs(Math.cos(p * Math.PI / 180)) > 1e-9 || Math.abs(p) === 90) wOut = Math.max(wOut, d); else wBand = Math.max(wBand, d);
    }
  }
  check('pitch 89.9° … 90° and −90°: the angles read back rebuild the rotation (toEuler_lock_up/down; lock band ≤ cos pitch)',
    wOut < 1e-14 && wBand <= 1e-9, `largest entry error ${wOut.toExponential(1)} outside the lock band, ${wBand.toExponential(1)} inside`);
}

console.log('\n— js/physics.js submerged on the box of proofs/Proofs/MeshBox.lean against box_submerged');
{
  // the Lean box, triangle for triangle (boxMesh): keel, deck, side y0, side y1, end x0, end x1
  const boxMesh = (x0, x1, y0, y1, zb, zt) => {
    const P = (x, y, z) => [x, y, z];
    const p000 = P(x0, y0, zb), p100 = P(x1, y0, zb), p110 = P(x1, y1, zb), p010 = P(x0, y1, zb);
    const p001 = P(x0, y0, zt), p101 = P(x1, y0, zt), p111 = P(x1, y1, zt), p011 = P(x0, y1, zt);
    return new Float64Array([p000, p010, p110, p000, p110, p100, p001, p101, p111, p001, p111, p011, p000, p100, p101, p000, p101, p001,
      p010, p011, p111, p010, p111, p110, p000, p001, p011, p000, p011, p010, p100, p110, p111, p100, p111, p101].flat());
  };
  let seed = 777;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let worst = 0, n = 0;
  for (let i = 0; i < 2000; i++) {
    const x0 = -50 + 100 * rnd(), y0 = -50 + 100 * rnd(), L = 0.01 + 40 * rnd(), B = 0.01 + 20 * rnd(), D = 0.01 + 10 * rnd();
    const zb0 = -20 + 40 * rnd(), zw = zb0 + D * (0.001 + 0.998 * rnd());   // water plane strictly between keel and deck
    const t = boxMesh(x0, x0 + L, y0, y0 + B, zb0, zb0 + D);
    const s = Ph.submerged(t, zw), T = zw - zb0;
    const want = { V: L * B * T, Bx: x0 + L / 2, By: y0 + B / 2, Bz: zw - T / 2, A: L * B, cx: x0 + L / 2, cy: y0 + B / 2, Ixx: L * B ** 3 / 12, Iyy: B * L ** 3 / 12, Ixy: 0 };
    const got = { V: s.V, Bx: s.B[0], By: s.B[1], Bz: s.B[2], A: s.wp.area, cx: s.wp.cx, cy: s.wp.cy, Ixx: s.wp.Ixx, Iyy: s.wp.Iyy, Ixy: s.wp.Ixy };
    // errors are measured against the size of the sums the code forms (moments about G, the origin here, before the
    // shift to the waterplane centroid): a small waterplane far from G loses digits to that shift, which is floating
    // point, not the algorithm (the proof is exact)
    const cx = x0 + L / 2, cy = y0 + B / 2, r2 = cx * cx + cy * cy + L * L + B * B, r = Math.sqrt(r2);
    const scale = { V: L * B * (T + Math.abs(zw) + Math.hypot(cx, cy)), Bx: r, By: r, Bz: r + Math.abs(zw), A: L * B + r2, cx: r, cy: r, Ixx: L * B * r2, Iyy: L * B * r2, Ixy: L * B * r2 };
    for (const k of Object.keys(want)) worst = Math.max(worst, Math.abs(got[k] - want[k]) / scale[k]);
    n++;
  }
  check(`${n} random boxes (L 0.01–40 m, any position, any draft): V, B, waterplane area, centroid and I_xx, I_yy, I_xy as box_submerged proves`,
    worst < 1e-10, `largest error ${worst.toExponential(1)} relative to the sums' size`);
}

console.log('\n— js/physics.js massProperties against proofs/Proofs/Mesh.lean massProperties_*_indep');
{
  let seed = 4242;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let worst = 0;
  for (const f of ['box_4x2x1.step', 'cube_1m.step', 'v_prism.step', 'box_moved.step', 'hcyl_log.step', 'sphere_r1.step']) {
    const t = await step(f);
    const ref = Ph.massProperties(t, [0, 0, 0]);
    const size = Math.cbrt(Math.abs(ref.volume));
    for (let i = 0; i < 5; i++) {
      const q = [0, 1, 2].map(() => (-20 + 40 * rnd()) * size);
      const m = Ph.massProperties(t, q);
      worst = Math.max(worst, Math.abs(m.volume - ref.volume) / Math.abs(ref.volume),
        ...m.centroid.map((c, k) => Math.abs(c - ref.centroid[k]) / size),
        ...m.inertia.map((c, k) => Math.abs(c - ref.inertia[k]) / (Math.abs(ref.volume) * size * size)));
    }
  }
  check('6 closed STEP models, 5 reference points up to 20 body sizes away each: same volume, centroid and inertia', worst < 1e-9, `largest relative difference ${worst.toExponential(1)}`);
}

console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
