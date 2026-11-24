// Float Sim against the proved closed forms (proofs/, Lean 4 + Mathlib).
//   node test/validate-proofs.mjs
// proofs/expected.json is written by `lake exe expected` in proofs/: the hydrostatic formulas proved in
// proofs/Proofs/Hydrostatics.lean and the stability criteria of proofs/Proofs/Stability.lean, evaluated exactly for
// the test models. This test checks
//   1. the hand-derived references in test/models/expected.json (which validate-node.mjs and validate.py use)
//      agree with the proved values, and
//   2. Float Sim's own hydrostatics (js/physics.js), run on the STEP files as the app imports them, agree with them,
//   3. mat3.toEulerDeg reads back the angles of a rotation, and rebuilds it at gimbal lock, as proofs/Proofs/Euler.lean
//      proves for its formulas.
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
  const st = 'stable' in p ? (H.GMt > 0) === p.stable : true;
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

console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
