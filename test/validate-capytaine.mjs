// "Solve with Capytaine": the local helper (tools/serve.py + tools/capytaine_solve.py) against Float Sim's own panel
// method on the same panel mesh, as the page sends it (js/capytaine.js), plus the helper's API guards.
//   FLOATSIM_PYTHON=/path/to/python node test/validate-capytaine.mjs
// Starts the helper on a spare port with that Python (default python3). Skips, and exits 0, if it has no Capytaine.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const J = (...p) => path.join(here, ...p);
globalThis.occtimportjs = createRequire(import.meta.url)('../vendor/occt-import-js.js');
const Ph = await import('../js/physics.js');
const M = await import('../js/bemmesh.js');
const B = await import('../js/bem.js');
const { readCad, concat } = await import('../js/loader.js');
const { panelSize } = await import('../js/bemrun.js');

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); };
const pct = (x) => `${(100 * x).toFixed(2)} %`;
const PY = process.env.FLOATSIM_PYTHON || 'python3', PORT = 8799, URL0 = `http://127.0.0.1:${PORT}/api/capytaine`;
const HDR = { 'X-Float-Sim': '1' };

const srv = spawn(PY, [J('..', 'tools', 'serve.py'), '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
let srvOut = ''; srv.stdout.on('data', (d) => { srvOut += d; }); srv.stderr.on('data', (d) => { srvOut += d; });
const stop = () => { try { srv.kill(); } catch { /* gone */ } };
process.on('exit', stop);
let status = null;
for (let i = 0; i < 50 && !status; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try { status = await (await fetch(`${URL0}/status`, { headers: HDR })).json(); } catch { /* not up yet */ }
}
if (!status) { console.log(`FAIL  helper did not start (${PY})\n${srvOut}`); process.exit(1); }
if (!status.available) { console.log(`SKIP  ${status.reason}`); stop(); process.exit(0); }
console.log(`— Capytaine ${status.version} through the helper (${status.python}, ${status.cores} cores)`);

// API guards
{
  const r1 = await fetch(`${URL0}/status`);
  check('API refuses a request without the X-Float-Sim header (403)', r1.status === 403);
  const r2 = await fetch(`${URL0}/solve`, { method: 'POST', headers: { ...HDR, 'Content-Type': 'application/json' }, body: JSON.stringify({ bodyQ: [1, 2, 3] }) });
  check('API refuses a malformed case (400) with a message', r2.status === 400 && /Bad case/.test((await r2.json()).error));
  const r3 = await fetch(`http://127.0.0.1:${PORT}/index.html`);
  check('the helper also serves the app', r3.ok && /Float Sim/.test(await r3.text()));
}

const step = async (f) => concat(await readCad(new Uint8Array(await readFile(J('models', f))), 'step', 'fine', J('..', 'vendor') + '/')).map((v) => v * 0.001);
async function solveCapy(body) {
  const job = await (await fetch(`${URL0}/solve`, { method: 'POST', headers: { ...HDR, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  for (;;) {
    await new Promise((r) => setTimeout(r, 300));
    const rep = await (await fetch(`${URL0}/jobs/${job.id}`, { headers: HDR })).json();
    if (rep.state === 'done') return { ...rep.result, workers: job.workers };
    if (rep.state === 'error' || rep.state === 'cancelled') throw new Error(rep.error || rep.state);
  }
}

// Same mesh, both solvers. Cases: two symmetry planes through G; symmetry planes off G (x0, y0 ≠ 0: tests the
// helper's shift and the phase correction); no symmetry (box yawed 30° in the file).
const cases = [
  ['cylinder buoy, two planes through G', 'buoy_cyl.step', 242.45, [0, 0, 0.23], [1.5, 3.5, 6], 'coarse'],
  ['box, CoG off both planes (x0 = −0.1, y0 = −0.05 m)', 'box_4x2x1.step', 3200, [2.1, 0.05, 0.5], [1.5, 3, 5], 'standard'],
  ['box yawed 30° in the file, no symmetry', 'box_moved.step', 3200, [3.2320508075688776, 0.3, 0.75], [1.5, 3, 5], 'standard'],
];
const heads = [0, 30, 90, 150];
for (const [label, file, mass, cog, omegas, fid] of cases) {
  const tris = await step(file);
  const rel = Ph.transformTris(tris, Ph.mat3.identity(), cog), zw = Ph.solveWaterline(rel, mass / 1000).zw;
  const size = panelSize(rel, zw, fid, Math.max(...omegas), 9.80665, true);
  const mesh = M.prepareBemMesh(rel, zw, { h: size.h, irr: true });
  const ref = [mesh.sym.x0, mesh.sym.y0, -zw], toG = [mesh.sym.x0, mesh.sym.y0, 0];
  // Float Sim, as bemworker.js
  const P = B.buildPanels(mesh.bodyQ, ref, mesh.lidQ, mesh.sym), R = B.rankineSetup(P, { rho: 1000 }), ws = B.bemWorkspace(P, R);
  const fs = omegas.map((w) => {
    const r = B.solveRadiation(P, R, w, { rho: 1000, ws });
    return B.transferToG(r.A, r.B, heads.map((h) => B.haskindX(P, r.phi, w, h, { rho: 1000 })), toG);
  });
  // Capytaine, as js/capytaine.js
  const t0 = performance.now();
  const cr = await solveCapy({ bodyQ: Array.from(mesh.bodyQ), lidQ: mesh.lidQ ? Array.from(mesh.lidQ) : null, sym: mesh.sym, ref, omegas, headings: heads, rho: 1000, g: 9.80665 });
  const cp = omegas.map((_, k) => B.transferToG(cr.A[k], cr.B[k], cr.X[k], toG));
  const sec = (performance.now() - t0) / 1000;
  // errors relative to each coefficient's peak over the frequencies (as docs/bem-validation.md)
  const famErr = (get, idx) => {
    let worst = ['', 0];
    const peakAll = Math.max(...idx.flatMap(([i, j]) => omegas.map((_, k) => Math.abs(get(cp[k], i, j)))));
    for (const [i, j] of idx) {
      const pk = Math.max(...omegas.map((_, k) => Math.abs(get(cp[k], i, j))));
      if (pk < 0.02 * peakAll) continue;
      const e = Math.max(...omegas.map((_, k) => Math.abs(get(fs[k], i, j) - get(cp[k], i, j)))) / pk;
      if (e > worst[1]) worst = [`${i + 1}${j + 1}`, e];
    }
    return worst;
  };
  const tr = [[0, 0], [1, 1], [2, 2]], ro = [[3, 3], [4, 4], [5, 5], [0, 4], [1, 3]];
  const eA = [famErr((c, i, j) => c.A[i][j], tr), famErr((c, i, j) => c.A[i][j], ro)];
  const eB = [famErr((c, i, j) => c.B[i][j], tr), famErr((c, i, j) => c.B[i][j], ro)];
  let eX = [0, 0], ph = 0;
  for (let h = 0; h < heads.length; h++) for (let i = 0; i < 6; i++) {
    const pk = Math.max(...omegas.map((_, k) => Math.hypot(...cp[k].X[h][i])));
    const fam = Math.max(...omegas.flatMap((_, k) => [0, 1, 2].map((q) => Math.hypot(...cp[k].X[h][(i < 3 ? 0 : 3) + q]))));
    if (pk < 0.02 * fam) continue;
    for (let k = 0; k < omegas.length; k++) {
      const a = fs[k].X[h][i], b = cp[k].X[h][i];
      eX[i < 3 ? 0 : 1] = Math.max(eX[i < 3 ? 0 : 1], Math.hypot(a[0] - b[0], a[1] - b[1]) / pk);
      if (Math.hypot(...b) > 0.2 * pk) ph = Math.max(ph, Math.abs(Math.atan2(a[1] * b[0] - a[0] * b[1], a[0] * b[0] + a[1] * b[1])) * 180 / Math.PI);
    }
  }
  const ok = Math.max(eA[0][1], eB[0][1], eX[0]) < 0.03 && Math.max(eA[1][1], eB[1][1], eX[1]) < 0.06 && ph < 3;
  check(`${label}, ${fid}: ${mesh.panels} + ${mesh.lidPanels} lid panels, ${omegas.length} frequencies × ${heads.length} headings on ${cr.workers} processes (${sec.toFixed(0)} s)`, ok,
    `A ${eA[0][0]} ${pct(eA[0][1])} / ${eA[1][0]} ${pct(eA[1][1])}, B ${eB[0][0]} ${pct(eB[0][1])} / ${eB[1][0]} ${pct(eB[1][1])}, X ${pct(eX[0])} / ${pct(eX[1])} (translational / rotational, of peak), phase ≤ ${ph.toFixed(2)}°`);
}

// cancel: a longer job stops and reports cancelled
{
  const tris = await step('box_4x2x1.step'), rel = Ph.transformTris(tris, Ph.mat3.identity(), [2, 0, 0.5]), zw = Ph.solveWaterline(rel, 3.2).zw;
  const mesh = M.prepareBemMesh(rel, zw, { h: panelSize(rel, zw, 'standard', 6, 9.80665, true).h, irr: true });
  const body = { bodyQ: Array.from(mesh.bodyQ), lidQ: Array.from(mesh.lidQ), sym: mesh.sym, ref: [0, 0, -zw], omegas: Array.from({ length: 200 }, (_, i) => 0.5 + 0.03 * i), headings: [0], rho: 1000, g: 9.80665 };
  const job = await (await fetch(`${URL0}/solve`, { method: 'POST', headers: { ...HDR, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  for (let i = 0; i < 300; i++) {      // wait until it is solving, then cancel part-way
    await new Promise((r) => setTimeout(r, 200));
    const q = await (await fetch(`${URL0}/jobs/${job.id}`, { headers: HDR })).json();
    if (q.done >= 1) break;
  }
  const c = await (await fetch(`${URL0}/jobs/${job.id}/cancel`, { method: 'POST', headers: HDR })).json();
  await new Promise((r) => setTimeout(r, 500));
  const rep = await (await fetch(`${URL0}/jobs/${job.id}`, { headers: HDR })).json();
  check('a solve can be cancelled part-way', c.state === 'cancelled' && rep.state === 'cancelled' && rep.done > 0 && rep.done < rep.total, `${rep.done}/${rep.total} frequencies done when cancelled`);
}

stop();
console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
