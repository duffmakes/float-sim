// Web Worker: long irregular-sea time-domain run (keeps the UI responsive).
import { WaveField } from './waves.js';
import { WaveSim, seriesStats } from './sim.js';

self.onmessage = (e) => {
  const c = e.data;
  const field = WaveField.fromSpectrum(c.fieldParams);
  const sim = new WaveSim({
    hull: { verts: new Float64Array(c.verts), idx: new Uint32Array(c.idx) }, mass: c.mass, inertiaG: c.IGb, rho: c.rho,
    R0: c.R0, z0: c.z0, field, A: c.A, Bd: c.Bd, dt: c.dt, ramp: c.ramp, vanishDeg: c.vanishDeg,
    volQ: c.volQ ? new Float64Array(c.volQ) : null, diffModes: c.diffModes,
  });
  const total = c.ramp + c.duration;
  const chunk = Math.max(50, Math.round(2 / c.dt));
  let lastPost = 0;
  while (sim.t < total) {
    sim.advance(Math.min(chunk * c.dt, total - sim.t), chunk);
    if (sim.t - lastPost > total / 50) { lastPost = sim.t; self.postMessage({ progress: sim.t / total }); }
    if (sim.stats.capsized && sim.t > sim.stats.capsizeT + 5) break;   // nothing more to learn after a capsize
  }
  const r = sim.rec;
  const st = {
    roll: seriesStats(r.t, r.roll, c.ramp), pitch: seriesStats(r.t, r.pitch, c.ramp),
    heave: seriesStats(r.t, r.heave, c.ramp), eta: seriesStats(r.t, r.eta, c.ramp),
    ...sim.stats, simulated: sim.t - c.ramp, dt: c.dt,
  };
  // down-sample for plotting (≤ 4000 points)
  const k = Math.max(1, Math.ceil(r.t.length / 4000));
  const pick = (a) => a.filter((_, i) => i % k === 0);
  self.postMessage({ done: true, stats: st, series: { t: pick(r.t), roll: pick(r.roll), pitch: pick(r.pitch), heave: pick(r.heave), eta: pick(r.eta) } });
};
