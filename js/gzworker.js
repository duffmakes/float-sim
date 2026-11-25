// Web Worker: GZ curves (fixed or free trim) off the main thread, so changing the attitude, mass or CoG never stalls
// the page. Message: { id, rel (Float64Array buffer, relative to G), V, jobs: [{ key, axis, GM, freeTrim }] }.
// Reply: { id, out: [{ key, curve, summary }] }.
import { gzAnalysis } from './physics.js';

self.onmessage = (e) => {
  const { id, rel, V, jobs } = e.data;
  const tris = new Float64Array(rel);
  try {
    const out = jobs.map((j) => {
      const a = gzAnalysis(tris, V, j.axis, { GM: j.GM, freeTrim: j.freeTrim });
      return { key: j.key, curve: a.curve, summary: a.summary };
    });
    self.postMessage({ id, out });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
