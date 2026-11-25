// Web Worker: GZ curves (fixed or free trim) off the main thread, so changing the attitude, mass or CoG never stalls
// the page. The app keeps a pool of these. Messages:
//   { type: 'geom', gid, rel (Float64Array buffer, relative to G), open (buffer of opening points or null), V }
//   { type: 'job', id, axis, GM, freeTrim, refineMax, open (false: leave the openings out), wantCurve }
//   →  reply { id, curve (or null), summary }
import { gzAnalysis } from './physics.js';

let G = null;
self.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'geom') { G = { gid: d.gid, rel: new Float64Array(d.rel), open: d.open ? new Float64Array(d.open) : null, V: d.V }; return; }
  try {
    const a = gzAnalysis(G.rel, G.V, d.axis, { GM: d.GM, freeTrim: d.freeTrim, open: d.open === false ? null : G.open, refineMax: d.refineMax !== false });
    self.postMessage({ id: d.id, curve: d.wantCurve ? a.curve : null, summary: a.summary });
  } catch (err) {
    self.postMessage({ id: d.id, error: String(err && err.message || err) });
  }
};
