// Runs a panel-method (BEM) frequency sweep on a pool of Web Workers (bemworker.js): mesh once, set up the
// frequency-independent matrices in every worker, then hand out frequencies as workers become free.
import { wettedSurface, soupArea, symmetryOf } from './bemmesh.js';

export const FIDELITY = {
  // panel counts for a flat-sided hull; curved hulls get up to ~3× more (panels ≤ 2πR/20 where the radius is R)
  coarse: { panels: 400, label: 'Coarse (~400 panels)' },
  standard: { panels: 1000, label: 'Standard (~1,000 panels)' },
  fine: { panels: 2500, label: 'Fine (~2,500 panels)' },
  vfine: { panels: 6000, label: 'Very fine (~6,000 panels)' },
};
// Unknowns per symmetry class are capped so one worker's matrices stay near 400 MB and a frequency takes well under
// a minute: about 3,200 body panels without symmetry, twice that with one symmetry plane, four times with two.
const MAX_BODY_PER_CLASS = 3200;

// Panel size for a fidelity level: the target panel count over the wetted surface, and never coarser than 1/7 of
// the shortest wavelength in the sweep (low-order panels need ~6–8 per wavelength), within the cap above.
export function panelSize(rel, zw, fidelity, wMax, g = 9.80665, waveRefine = true) {
  const wet = wettedSurface(rel, zw).wet, area = soupArea(wet);
  const nm = (symmetryOf(wet, 0).sym ? 2 : 1) * (symmetryOf(wet, 1).sym ? 2 : 1);
  const maxPanels = MAX_BODY_PER_CLASS * nm;
  const n = (FIDELITY[fidelity] || FIDELITY.standard).panels;
  const hCap = Math.sqrt(area / (0.433 * maxPanels));
  let h = Math.max(Math.sqrt(area / (0.433 * n)), hCap);
  const lamMin = 2 * Math.PI * g / (wMax * wMax), hWave = lamMin / 7;
  let note = h > Math.sqrt(area / (0.433 * n)) * 1.001 ? `Panel count limited to about ${maxPanels.toLocaleString()} for this hull (${nm === 1 ? 'no' : nm === 2 ? 'one' : 'two'} symmetry plane${nm === 2 ? '' : 's'}) to keep memory and run time manageable.` : '';
  if (waveRefine && hWave < h) {
    if (hWave < hCap) { h = hCap; note = `The shortest wave (${lamMin.toPrecision(3)} m) needs panels smaller than ${hWave.toPrecision(2)} m; limited to about ${maxPanels.toLocaleString()} panels, so results near the top of the frequency range are under-resolved.`; }
    else { h = hWave; note = `Panels refined to ${h.toPrecision(2)} m for the shortest wave (${lamMin.toPrecision(3)} m).`; }
  }
  return { h, area, note, lamMin, maxPanels };
}

// Workers that fit a memory budget: each holds the folded Rankine matrices and one complex workspace,
// 3 × classes × Nq² doubles.
export function workerPlan(Nq, classes, nFreq) {
  const per = 3 * classes * Nq * Nq * 8 + 2e7;
  const dm = typeof navigator !== 'undefined' && navigator.deviceMemory ? navigator.deviceMemory : 8;
  const budget = Math.min(3e9, 0.35 * dm * 1e9);
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  const n = Math.max(1, Math.min(Math.max(1, cores - 1), 8, nFreq, Math.floor(budget / per)));
  return { workers: n, bytesPerWorker: per };
}

// Heading grid for the exciting forces: every 5°, plus any requested heading off the grid. Exciting forces at other
// headings are interpolated from it (see bemCoeffsAt in hydro.js).
export function headingGrid(extra = []) {
  const s = new Set(); for (let b = 0; b < 360; b += 5) s.add(b);
  for (const b of extra) s.add(((+b % 360) + 360) % 360);
  return [...s].sort((a, b) => a - b);
}

// rel: hull relative to G in the seakeeping frame; zw: still waterline height above G. Returns a handle
// { promise, cancel() }. onProgress({ frac, phase, text, eta }) is called as the run proceeds.
// waveRefine = false skips the panel-size limit from the shortest wavelength (the quick natural-frequency sweep).
export function runBem({ rel, zw, rho, g = 9.80665, omegas, headings = [], fidelity = 'standard', irr = true, waveRefine = true, onProgress = () => {} }) {
  const workers = [];
  let cancelled = false, rejectRun = null;
  const cancel = () => { cancelled = true; for (const w of workers) w.terminate(); if (rejectRun) rejectRun(Object.assign(new Error('Cancelled'), { cancelled: true })); };
  const spawn = () => { const w = new Worker(new URL('./bemworker.js', import.meta.url), { type: 'module' }); workers.push(w); return w; };
  const ask = (w, msg, transfer = [], onMsg = null) => new Promise((resolve, reject) => {
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'error') reject(new Error(`Panel method: ${d.message}`));
      else if (d.type === 'progress') { if (onMsg) onMsg(d); }
      else resolve(d);
    };
    w.onerror = (e) => reject(new Error(`Panel-method worker failed: ${e.message || e}`));
    w.postMessage(msg, transfer);
  });
  const promise = new Promise((resolve, reject) => {
    rejectRun = reject;
    (async () => {
      const t0 = performance.now();
      const wMax = Math.max(...omegas);
      const size = panelSize(rel, zw, fidelity, wMax, g, waveRefine);
      onProgress({ frac: 0.01, phase: 'mesh', text: 'Meshing the wetted surface for the panel method…' });
      const w0 = spawn();
      const { mesh } = await ask(w0, { type: 'mesh', rel: Float64Array.from(rel), zw, opts: { h: size.h, irr }, maxPanels: size.maxPanels });
      if (mesh.h > size.h * 1.001 && !size.note) size.note = `Panel count limited to about ${size.maxPanels.toLocaleString()} for this hull to keep memory and run time manageable.`;
      if (cancelled) return;
      const tMesh = performance.now() - t0;
      const nm = (mesh.sym.x ? 2 : 1) * (mesh.sym.y ? 2 : 1), classes = nm;
      const Nq = (mesh.bodyQ.length + (mesh.lidQ ? mesh.lidQ.length : 0)) / 9;
      const plan = workerPlan(Nq, classes, omegas.length);
      while (workers.length < plan.workers) spawn();
      const symTxt = mesh.sym.x && mesh.sym.y ? 'two symmetry planes' : mesh.sym.x || mesh.sym.y ? 'one symmetry plane' : 'no symmetry';
      const meshTxt = `${mesh.panels.toLocaleString()} panels${mesh.lidPanels ? ` + ${mesh.lidPanels.toLocaleString()} lid` : ''}, ${symTxt}`;
      // set up every worker (in parallel)
      const ref = [mesh.sym.x0, mesh.sym.y0, -zw], toG = [mesh.sym.x0, mesh.sym.y0, 0];
      const setupFrac = new Array(workers.length).fill(0);
      onProgress({ frac: 0.04, phase: 'setup', text: `Setting up ${meshTxt} on ${workers.length} worker${workers.length > 1 ? 's' : ''}…` });
      const setups = await Promise.all(workers.map((w, i) => ask(w, { type: 'setup', bodyQ: mesh.bodyQ, lidQ: mesh.lidQ, sym: mesh.sym, ref, toG, rho, g }, [], (d) => {
        setupFrac[i] = d.f;
        onProgress({ frac: 0.04 + 0.08 * Math.min(...setupFrac), phase: 'setup', text: `Setting up ${meshTxt}… ${Math.round(100 * Math.min(...setupFrac))} %` });
      })));
      if (cancelled) return;
      const tSetup = performance.now();
      // sweep
      const heads = headingGrid(headings);
      const out = { omegas: omegas.slice(), headings: heads, A: new Array(omegas.length), B: new Array(omegas.length), X: new Array(omegas.length) };
      let next = 0, done = 0, iters = 0;
      const order = omegas.map((_, k) => k);
      const report = () => {
        const el = (performance.now() - tSetup) / 1000;
        const eta = done ? el / done * (omegas.length - done) : null;
        const fmt = (s) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);
        onProgress({ frac: 0.12 + 0.88 * done / omegas.length, phase: 'solve', eta,
          text: `Panel method: ${done}/${omegas.length} frequencies · ${meshTxt} · ${workers.length} worker${workers.length > 1 ? 's' : ''}${eta !== null ? ` · about ${fmt(eta)} left` : ''}` });
      };
      report();
      await new Promise((res, rej) => {
        const feed = (w) => {
          if (cancelled) return;
          if (next >= order.length) { if (done === omegas.length) res(); return; }
          const k = order[next++];
          ask(w, { type: 'solve', k, w: omegas[k], headings: heads }).then((r) => {
            out.A[r.k] = r.A; out.B[r.k] = r.B; out.X[r.k] = r.X; iters += r.iters;
            done++; report();
            if (done === omegas.length) res(); else feed(w);
          }, rej);
        };
        workers.forEach(feed);
      });
      for (const w of workers) w.terminate();
      out.info = {
        panels: mesh.panels, lidPanels: mesh.lidPanels, sym: mesh.sym, h: mesh.h, quality: mesh.quality, Nq, classes,
        wettedArea: mesh.wettedArea, panelArea: mesh.panelArea, workers: workers.length, fidelity, irr, note: size.note,
        ms: { mesh: tMesh, setup: tSetup - t0 - tMesh, solve: performance.now() - tSetup, total: performance.now() - t0 },
        setupMs: setups.map((s) => s.ms), iters,
      };
      resolve(out);
    })().catch((err) => { for (const w of workers) w.terminate(); reject(err); });
  });
  return { promise, cancel };
}
