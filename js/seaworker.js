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
    drag: c.drag || null, wind: c.wind || null, mooring: c.mooring || null, points: c.points || null, p0: c.p0 || null,
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
      let maxOffset = 0; for (let i = 0; i <= n; i++) maxOffset = Math.max(maxOffset, Math.hypot(r.x[i] - sim.p0[0], r.y[i] - sim.p0[1]));
      return { on: c.drift.on, speed: T > 0 ? Math.hypot(dx, dy) / T : 0, dir: ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360, dist: Math.hypot(dx, dy), maxOffset };
    })(),
    ...sim.stats, simulated: sim.t - c.ramp, dt: c.dt,
    points: sim.tracker ? sim.tracker.summary(sim.t) : null,
    mooring: sim.moored ? { ...sim.moor.st, inSlack: undefined, Tstatic: sim.moor.Tstatic, meanOffset: sim.moor.st.n ? sim.moor.st.sumOffset / sim.moor.st.n : 0, model: sim.moor.model } : null,
    wind: sim.windStats ? { meanF: sim.windStats.sF.map((x) => x / Math.max(1, sim.windStats.n)), maxF: sim.windStats.maxF } : null,
  };
  // down-sample for plotting (≤ 4000 points); tension keeps the peak of each bin so snap loads stay visible
  const k = Math.max(1, Math.ceil(r.t.length / 4000));
  const pick = (a) => a.filter((_, i) => i % k === 0);
  const peak = (a) => { const o = []; for (let i = 0; i < a.length; i += k) { let m = -Infinity; for (let j = i; j < Math.min(a.length, i + k); j++) m = Math.max(m, a[j]); o.push(m); } return o; };
  self.postMessage({ done: true, stats: st, series: {
    t: pick(r.t), roll: pick(r.roll), pitch: pick(r.pitch), heave: pick(r.heave), eta: pick(r.eta), x: pick(r.x), y: pick(r.y),
    tension: r.tension ? peak(r.tension) : null, ph: sim.tracker ? sim.tracker.rec.h.map(pick) : null,
  } });
};
