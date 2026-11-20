// Web Worker: long irregular-sea time-domain run (keeps the UI responsive).
import { WaveField } from './waves.js';
import { WaveSim, seriesStats } from './sim.js';

self.onmessage = (e) => {
  const c = e.data;
  const field = WaveField.fromParams(c.fieldParams);
  const sim = new WaveSim({
    hull: { verts: new Float64Array(c.verts), idx: new Uint32Array(c.idx) }, mass: c.mass, inertiaG: c.IGb, rho: c.rho,
    R0: c.R0, z0: c.z0, field, A: c.A, Bd: c.Bd, dt: c.dt, ramp: c.ramp, vanishDeg: c.vanishDeg,
    volQ: c.volQ ? new Float64Array(c.volQ) : null, diffModes: c.diffModes, drift: c.drift || null,
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
    // regular waves: steady-state single amplitude, half the peak-to-peak over the last half of the run
    steady: c.fieldParams.mode === 'regular' ? Object.fromEntries(['roll', 'pitch', 'heave', 'eta'].map((key) => {
      const tEnd = r.t[r.t.length - 1], t0 = Math.max(c.ramp, tEnd - c.duration / 2);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < r.t.length; i++) if (r.t[i] >= t0) { lo = Math.min(lo, r[key][i]); hi = Math.max(hi, r[key][i]); }
      return [key, (hi - lo) / 2];
    })) : null,
    drift: (() => {
      if (!c.drift) return null;
      const i0 = Math.max(0, r.t.findIndex((t) => t >= c.ramp)), n = r.t.length - 1, T = r.t[n] - r.t[i0];
      const dx = r.x[n] - r.x[i0], dy = r.y[n] - r.y[i0];
      let maxOffset = 0; for (let i = 0; i <= n; i++) maxOffset = Math.max(maxOffset, Math.hypot(r.x[i], r.y[i]));
      return { on: c.drift.on, speed: T > 0 ? Math.hypot(dx, dy) / T : 0, dir: ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360, dist: Math.hypot(dx, dy), maxOffset };
    })(),
    ...sim.stats, simulated: sim.t - c.ramp, dt: c.dt,
  };
  // down-sample for plotting (≤ 4000 points)
  const k = Math.max(1, Math.ceil(r.t.length / 4000));
  const pick = (a) => a.filter((_, i) => i % k === 0);
  self.postMessage({ done: true, stats: st, series: { t: pick(r.t), roll: pick(r.roll), pitch: pick(r.pitch), heave: pick(r.heave), eta: pick(r.eta) } });
};
