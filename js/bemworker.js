// Web Worker for the panel method (bem.js). One worker builds the panel mesh; every worker then sets up its own
// frequency-independent Rankine matrices for that mesh and solves frequencies on request, so a sweep runs in
// parallel without blocking the page.
//   { type: 'mesh', rel, zw, opts }                       → { type: 'mesh', mesh }
//   { type: 'setup', bodyQ, lidQ, sym, ref, toG, rho, g } → { type: 'progress', phase: 'setup', f } … { type: 'ready', … }
//   { type: 'solve', k, w, headings }                     → { type: 'result', k, w, A, B, X, iters, ms }
import { prepareBemMesh } from './bemmesh.js';
import { buildPanels, rankineSetup, bemWorkspace, solveRadiation, haskindX, transferToG } from './bem.js';

let P = null, R = null, ws = null, cfg = null;
self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'mesh') {
      // curvature refinement can add panels; above the cap, coarsen and mesh again
      const rel = new Float64Array(m.rel);
      let opts = { ...m.opts }, mesh = prepareBemMesh(rel, m.zw, opts);
      for (let k = 0; k < 3 && m.maxPanels && mesh.panels > 1.1 * m.maxPanels; k++) {
        opts = { ...opts, h: opts.h * Math.sqrt(mesh.panels / m.maxPanels) };
        mesh = prepareBemMesh(rel, m.zw, opts);
      }
      const transfer = [mesh.bodyQ.buffer]; if (mesh.lidQ) transfer.push(mesh.lidQ.buffer);
      self.postMessage({ type: 'mesh', mesh }, transfer);
    } else if (m.type === 'setup') {
      cfg = m;
      P = buildPanels(new Float64Array(m.bodyQ), m.ref, m.lidQ ? new Float64Array(m.lidQ) : null, m.sym);
      const t0 = performance.now();
      let last = 0;
      R = rankineSetup(P, { rho: m.rho, onProgress: (f) => { const t = performance.now(); if (t - last > 200) { last = t; self.postMessage({ type: 'progress', phase: 'setup', f }); } } });
      ws = bemWorkspace(P, R);
      self.postMessage({ type: 'ready', N: P.N, Nq: P.Nq, classes: R.cls.length, ms: performance.now() - t0 });
    } else if (m.type === 'solve') {
      const t0 = performance.now();
      const r = solveRadiation(P, R, m.w, { rho: cfg.rho, g: cfg.g, ws });
      const X = m.headings.map((b) => haskindX(P, r.phi, m.w, b, { rho: cfg.rho, g: cfg.g }));
      let A = r.A, B = r.B, Xs = X;
      if (cfg.toG && cfg.toG.some(Boolean)) ({ A, B, X: Xs } = transferToG(A, B, X, cfg.toG));
      self.postMessage({ type: 'result', k: m.k, w: m.w, A, B, X: Xs, iters: r.iters, ms: performance.now() - t0 });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err), stack: err.stack });
  }
};
