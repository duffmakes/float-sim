// RAO comparison, Float Sim side: the test STEP models through Float Sim's own panel method, the way the app runs it
// (STEP read with OpenCascade, Standard fidelity with panels refined for the top frequency, irregular-frequency lid,
// symmetry found from the wetted surface, RAOs about G with the wave phase at G, no extra damping).
//   node test/rao-compare/floatsim_rao.mjs props                 mass properties, waterline and restoring for every case
//   node test/rao-compare/floatsim_rao.mjs run <id> [k n]        panel-method sweep, frequencies k, k + n, k + 2n, …
//   node test/rao-compare/floatsim_rao.mjs merge <id> [n]        joins the n parts and solves the RAOs
// Writes test/rao-compare/results/floatsim/. Cases, frequencies and headings: test/rao-compare/cases.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const J = (...p) => path.join(here, ...p);
globalThis.occtimportjs = createRequire(import.meta.url)('../../vendor/occt-import-js.js');
const Ph = await import('../../js/physics.js');
const Hy = await import('../../js/hydro.js');
const M = await import('../../js/bemmesh.js');
const B = await import('../../js/bem.js');
const { readCad, concat } = await import('../../js/loader.js');
const { panelSize, headingGrid } = await import('../../js/bemrun.js');

const CFG = JSON.parse(await readFile(J('cases.json'), 'utf8'));
const OUT = J('results', 'floatsim');
await mkdir(OUT, { recursive: true });
const { rho, g } = CFG;
const freqs = Array.from({ length: CFG.nFreq }, (_, i) => CFG.fMin + (CFG.fMax - CFG.fMin) * i / (CFG.nFreq - 1));
const omegas = freqs.map((f) => 2 * Math.PI * f);
const DOFS = ['surge', 'sway', 'heave', 'roll', 'pitch', 'yaw'];

// The floating body as the app's seakeeping stage sees it: hull relative to G in the equilibrium axes (attitude with
// its yaw removed), still waterline zw above G, mass, inertia about G in those axes, restoring matrix about G.
async function body(c) {
  const tris = concat(await readCad(new Uint8Array(await readFile(J('..', 'models', c.file))), 'step', 'fine', J('..', '..', 'vendor') + '/')).map((v) => v * 0.001);
  const R = Ph.mat3.fromEulerDeg(...c.euler), yaw = Math.atan2(R[3], R[0]);
  const Rsk = Ph.mat3.mul(Ph.mat3.rotZ(-yaw), R);
  const rel = Ph.transformTris(tris, Rsk, c.cog);
  const sol = Ph.solveWaterline(rel, c.mass / rho);
  const H = Ph.hydrostatics(rel, sol.zw, c.mass, rho, g);
  const IGb = Ph.inertiaAbout(Ph.massProperties(tris), c.mass, c.cog);
  const IG = Ph.mat3.mul(Rsk, Ph.mat3.mul(IGb, Ph.mat3.transpose(Rsk)));
  const model = Hy.linearModel(rel, H, c.mass, IG, rho, Hy.defaultHydroCoeffs(H, c.mass, IG, rho));
  return { tris, rel, zw: sol.zw, H, IG, model, Rsk };
}
const caseOf = (id) => { const c = CFG.cases.find((q) => q.id === id); if (!c) throw new Error(`no case ${id}`); return c; };

const mode = process.argv[2];
if (mode === 'props') {
  const out = {};
  for (const c of CFG.cases) {
    const b = await body(c);
    out[c.id] = { zw: b.zw, V: b.H.V, B: b.H.B, Awp: b.H.wp.area, IG: b.IG, C: b.model.Cm, M: b.model.Mm, Rsk: b.Rsk };
    console.log(`${c.id}: zw ${b.zw.toFixed(4)} m above G, V ${b.H.V.toFixed(5)} m³, C33 ${b.model.Cm[2][2].toFixed(1)}, C44 ${b.model.Cm[3][3].toFixed(2)}, C55 ${b.model.Cm[4][4].toFixed(2)}`);
  }
  await writeFile(J('results', 'props.json'), JSON.stringify(out, null, 1));
} else if (mode === 'run') {
  const c = caseOf(process.argv[3]), k = +(process.argv[4] ?? 0), n = +(process.argv[5] ?? 1);
  const b = await body(c);
  const t0 = performance.now();
  const size = panelSize(b.rel, b.zw, 'standard', Math.max(...omegas), g, true);
  let opts = { h: size.h, irr: true }, mesh = M.prepareBemMesh(b.rel, b.zw, opts);
  for (let q = 0; q < 3 && mesh.panels > 1.1 * size.maxPanels; q++) { opts = { ...opts, h: opts.h * Math.sqrt(mesh.panels / size.maxPanels) }; mesh = M.prepareBemMesh(b.rel, b.zw, opts); }
  const ref = [mesh.sym.x0, mesh.sym.y0, -b.zw], toG = [mesh.sym.x0, mesh.sym.y0, 0];
  const P = B.buildPanels(mesh.bodyQ, ref, mesh.lidQ, mesh.sym);
  const R = B.rankineSetup(P, { rho });
  const ws = B.bemWorkspace(P, R);
  const heads = headingGrid(CFG.headings);
  const tSetup = performance.now();
  const part = { k, n, idx: [], A: [], B: [], X: [] };
  for (let i = k; i < omegas.length; i += n) {
    const w = omegas[i], r = B.solveRadiation(P, R, w, { rho, g, ws });
    let A = r.A, Bm = r.B, X = heads.map((h) => B.haskindX(P, r.phi, w, h, { rho, g }));
    if (toG.some(Boolean)) ({ A, B: Bm, X } = B.transferToG(A, Bm, X, toG));
    part.idx.push(i); part.A.push(A); part.B.push(Bm); part.X.push(X);
  }
  part.headings = heads;
  part.mesh = { panels: mesh.panels, lidPanels: mesh.lidPanels, sym: mesh.sym, h: mesh.h, Nq: P.Nq, classes: R.cls.length, quality: mesh.quality.qMean, note: size.note };
  part.ms = { setup: tSetup - t0, solve: performance.now() - tSetup };
  await writeFile(J('results', 'floatsim', `${c.id}.part${k}.json`), JSON.stringify(part));
  console.log(`${c.id} part ${k}/${n}: ${part.idx.length} frequencies, ${mesh.panels} panels + ${mesh.lidPanels} lid, setup ${(part.ms.setup / 1000).toFixed(1)} s, solve ${(part.ms.solve / 1000).toFixed(1)} s`);
} else if (mode === 'merge') {
  const c = caseOf(process.argv[3]), n = +(process.argv[4] ?? 1);
  const b = await body(c);
  const bem = { omegas, headings: null, A: [], B: [], X: [] };
  let mesh = null, msSolve = 0;
  for (let k = 0; k < n; k++) {
    const p = JSON.parse(await readFile(J('results', 'floatsim', `${c.id}.part${k}.json`), 'utf8'));
    bem.headings = p.headings; mesh = p.mesh; msSolve += p.ms.solve;
    p.idx.forEach((i, q) => { bem.A[i] = p.A[q]; bem.B[i] = p.B[q]; bem.X[i] = p.X[q]; });
  }
  if (bem.A.some((a) => !a) || bem.A.length !== omegas.length) throw new Error('missing frequencies');
  const sweep = Hy.bemSweep(b.model, bem, CFG.headings);
  const hi = CFG.headings.map((h) => bem.headings.indexOf(h));
  const res = {
    solver: 'Float Sim panel method (Standard fidelity)', id: c.id, title: c.title, freqs, headings: CFG.headings, dofs: DOFS,
    units: 'translations m/m, rotations deg/m; phase deg, exp(+i w t), relative to the wave at G',
    amp: sweep.map((h) => h.points.map((p) => p.degPerM)),
    phase: sweep.map((h) => h.points.map((p) => p.phase)),
    A: bem.A, B: bem.B, X: bem.X.map((xk) => hi.map((i) => xk[i])),
    M: b.model.Mm, C: b.model.Cm, zw: b.zw, IG: b.IG, mesh, cpuSeconds: msSolve / 1000,
  };
  await writeFile(J('results', 'floatsim', `${c.id}.json`), JSON.stringify(res));
  console.log(`${c.id}: merged ${n} parts, ${mesh.panels} panels + ${mesh.lidPanels} lid, ${(msSolve / 1000).toFixed(0)} s of solve time`);
} else {
  console.log('usage: floatsim_rao.mjs props | run <id> [k n] | merge <id> [n]');
}
