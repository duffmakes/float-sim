// Web Worker: the import repair (prepareMesh in js/loader.js: welding, re-orientation, shells, nesting and overlap
// tests) off the main thread, so a large multi-part file never freezes the page while it is checked.
// Message: { parts: [Float64Array buffer, …] }. Reply: { tris (buffer), openPts (buffer), report, flipped } or { error }.
import { prepareMesh } from './loader.js';

self.onmessage = (e) => {
  try {
    const r = prepareMesh(e.data.parts.map((b) => new Float64Array(b)));
    const tris = r.tris, openPts = r.report.openPts;
    self.postMessage({ tris: tris.buffer, openPts: openPts.buffer, report: { ...r.report, openPts: null }, flipped: r.flipped }, [tris.buffer, openPts.buffer]);
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};
