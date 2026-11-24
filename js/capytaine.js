// "Solve with Capytaine": the panel-method sweep of bemrun.js with the radiation–diffraction solve done by Capytaine
// (Ancellin & Dias 2019) on this computer instead of Float Sim's own solver. The page meshes the wetted surface as
// usual (same mesh, lid and symmetry as the built-in solver), sends it to the local helper that serve.sh starts
// (tools/serve.py, tools/capytaine_solve.py), follows its progress and brings back A(ω), B(ω) and X(ω, β) in the
// shape runBem returns, so the RAOs, sea states, exports and simulators use them unchanged.
import { panelSize, headingGrid } from './bemrun.js';
import { transferToG } from './bem.js';

const API = 'api/capytaine';
const HDR = { 'X-Float-Sim': '1' };
const NOT_SERVED = 'Capytaine needs Float Sim started with ./serve.sh in a Python that has Capytaine (pip install capytaine). This page is served by something else, so the button is off.';

// { available, version, cores, reason } — never throws
export async function capytaineStatus(timeoutMs = 4000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetch(`${API}/status`, { headers: HDR, cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return { available: false, reason: NOT_SERVED };
    const s = await r.json();
    return s && typeof s.available === 'boolean' ? s : { available: false, reason: NOT_SERVED };
  } catch {
    return { available: false, reason: NOT_SERVED };
  } finally { if (timer) clearTimeout(timer); }
}

async function api(path, body = null) {
  let r;
  try {
    r = await fetch(`${API}/${path}`, body === null ? { headers: HDR, cache: 'no-store' }
      : { method: 'POST', headers: { ...HDR, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Capytaine: lost contact with the Float Sim server on this computer (was serve.sh stopped?).');
  }
  let d = null;
  try { d = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(`Capytaine: ${(d && d.error) || `the helper answered ${r.status}`}`);
  return d;
}

const fmtT = (s) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);

// Same arguments and result as runBem (bemrun.js), plus info.solver = 'capytaine' and info.version.
export function runCapytaine({ rel, zw, rho, g = 9.80665, omegas, headings = [], fidelity = 'standard', irr = true, waveRefine = true, onProgress = () => {} }) {
  let cancelled = false, jobId = null, worker = null, rejectRun = null;
  const cancel = () => {
    cancelled = true;
    if (worker) worker.terminate();
    if (jobId) api(`jobs/${jobId}/cancel`, {}).catch(() => {});
    if (rejectRun) rejectRun(Object.assign(new Error('Cancelled'), { cancelled: true }));
  };
  const promise = new Promise((resolve, reject) => {
    rejectRun = reject;
    (async () => {
      const t0 = performance.now();
      const status = await capytaineStatus();
      if (!status.available) throw new Error(`Capytaine is not available: ${status.reason}`);
      // mesh exactly as the built-in solver does (bemrun.js)
      const size = panelSize(rel, zw, fidelity, Math.max(...omegas), g, waveRefine);
      onProgress({ frac: 0.01, phase: 'mesh', text: 'Meshing the wetted surface for Capytaine…' });
      worker = new Worker(new URL('./bemworker.js', import.meta.url), { type: 'module' });
      const mesh = await new Promise((res, rej) => {
        worker.onmessage = (e) => (e.data.type === 'error' ? rej(new Error(`Panel mesh: ${e.data.message}`)) : res(e.data.mesh));
        worker.onerror = (e) => rej(new Error(`Panel-mesh worker failed: ${e.message || e}`));
        worker.postMessage({ type: 'mesh', rel: Float64Array.from(rel), zw, opts: { h: size.h, irr }, maxPanels: size.maxPanels });
      });
      worker.terminate(); worker = null;
      if (cancelled) return;
      if (mesh.h > size.h * 1.001 && !size.note) size.note = `Panel count limited to about ${size.maxPanels.toLocaleString()} for this hull to keep memory and run time manageable.`;
      const tMesh = performance.now() - t0;
      const ref = [mesh.sym.x0, mesh.sym.y0, -zw], toG = [mesh.sym.x0, mesh.sym.y0, 0];
      const heads = headingGrid(headings);
      const symTxt = mesh.sym.x && mesh.sym.y ? 'two symmetry planes' : mesh.sym.x || mesh.sym.y ? 'one symmetry plane' : 'no symmetry';
      const meshTxt = `${mesh.panels.toLocaleString()} panels${mesh.lidPanels ? ` + ${mesh.lidPanels.toLocaleString()} lid` : ''}, ${symTxt}`;
      onProgress({ frac: 0.03, phase: 'setup', text: `Sending ${meshTxt} to Capytaine ${status.version}…` });
      const job = await api('solve', { bodyQ: Array.from(mesh.bodyQ), lidQ: mesh.lidQ ? Array.from(mesh.lidQ) : null, sym: mesh.sym, ref, omegas, headings: heads, rho, g });
      jobId = job.id;
      if (cancelled) { api(`jobs/${jobId}/cancel`, {}).catch(() => {}); return; }
      const wTxt = `${job.workers} worker process${job.workers > 1 ? 'es' : ''}`;
      let rep, tRun = null;
      for (;;) {
        await new Promise((r) => setTimeout(r, 400));
        if (cancelled) return;
        rep = await api(`jobs/${jobId}`);
        if (rep.state === 'error') throw new Error(`Capytaine: ${rep.error}`);
        if (rep.state === 'cancelled') throw Object.assign(new Error('Cancelled'), { cancelled: true });
        if (rep.state === 'starting') { onProgress({ frac: 0.04, phase: 'setup', text: `Starting Capytaine ${status.version} on ${wTxt}…` }); continue; }
        if (tRun === null) tRun = rep.elapsed;
        const el = rep.elapsed - tRun, eta = rep.done ? el / rep.done * (rep.total - rep.done) : null;
        onProgress({ frac: 0.05 + 0.95 * rep.done / rep.total, phase: 'solve', eta,
          text: `Capytaine ${status.version}: ${rep.done}/${rep.total} frequencies · ${meshTxt} · ${wTxt}${eta !== null && rep.done < rep.total ? ` · about ${fmtT(eta)} left` : ''}` });
        if (rep.state === 'done') break;
      }
      const R = rep.result, out = { omegas: omegas.slice(), headings: heads, A: [], B: [], X: [] };
      for (let k = 0; k < omegas.length; k++) {
        let A = R.A[k], B = R.B[k], X = R.X[k];
        if (toG.some(Boolean)) ({ A, B, X } = transferToG(A, B, X, toG));
        out.A.push(A); out.B.push(B); out.X.push(X);
      }
      const tEnd = performance.now();
      out.info = {
        solver: 'capytaine', version: status.version, panels: mesh.panels, lidPanels: mesh.lidPanels, sym: mesh.sym, h: mesh.h,
        quality: mesh.quality, wettedArea: mesh.wettedArea, panelArea: mesh.panelArea, workers: job.workers, fidelity, irr, note: size.note,
        ms: { mesh: tMesh, solve: tEnd - t0 - tMesh, total: tEnd - t0 },
      };
      resolve(out);
    })().catch((err) => { if (worker) worker.terminate(); reject(err); });
  });
  return { promise, cancel };
}
