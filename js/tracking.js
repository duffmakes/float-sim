// Tracked points on the body (antenna, GPS, solar panel, IMU …) and wave-following quality from the RAOs.
// Pure math, no rendering.
//
//  • Time domain: the point's height above the local incident wave surface h(t) = z_p − η(x_p, y_p, t) − clearance,
//    time above water, the longest underwater stretch, and accelerations (rigid body: a_p = a_G + α×r + ω×(ω×r)),
//    reported in the body (model) axes, without gravity (an accelerometer would read a − g).
//  • Linear estimate from the RAOs: the relative motion h = ξ₃ + θ_x y − θ_y x − η_p is Gaussian with σ² = ∫|H|²S dω,
//    so P(above) = Φ(h₀/σ) and, by Rice (1944), the point goes under ν = (1/2π)√(m₂/m₀)·exp(−h₀²/2m₀) times per second.
//    Regular waves: h = h₀ + R cos(ωt + φ), so the fraction above water is acos(−h₀/R)/π.
// The incident wave ignores the body's own diffracted and radiated waves (the same assumption as the simulator's loads).

export class PointTracker {
  constructor(points, rampT) {
    this.pts = points.map((p) => ({
      ...p, n: 0, above: 0, tAbove: 0, tTotal: 0, wasAbove: null, stretchStart: null, longestUnder: 0, longestAbove: 0, aboveStart: null,
      dunks: 0, sumH: 0, sumH2: 0, minH: Infinity, maxH: -Infinity,
      sa: [0, 0, 0], sa2: [0, 0, 0], amax: [0, 0, 0], amag: 0, sav: 0, sav2: 0,
    }));
    this.ramp = rampT;
    this.rec = { t: [], h: points.map(() => []) };
  }
  // R: world ← body, p, v, w: G state (world), aG, alpha: accelerations (world), field: waves, t: time
  update(R, p, w, aG, alpha, field, t, dt, record) {
    const on = t >= this.ramp;
    if (record) this.rec.t.push(t);
    for (let i = 0; i < this.pts.length; i++) {
      const q = this.pts[i], r = q.r;
      const rw = [R[0] * r[0] + R[1] * r[1] + R[2] * r[2], R[3] * r[0] + R[4] * r[1] + R[5] * r[2], R[6] * r[0] + R[7] * r[1] + R[8] * r[2]];
      const x = p[0] + rw[0], y = p[1] + rw[1], z = p[2] + rw[2];
      const h = z - (field && field.n ? field.eta(x, y, t) : 0) - (q.clearance || 0);
      if (record) this.rec.h[i].push(h);
      if (!on) continue;
      // a_p = a_G + α × r + ω × (ω × r)
      const wr = [w[1] * rw[2] - w[2] * rw[1], w[2] * rw[0] - w[0] * rw[2], w[0] * rw[1] - w[1] * rw[0]];
      const a = [
        aG[0] + alpha[1] * rw[2] - alpha[2] * rw[1] + w[1] * wr[2] - w[2] * wr[1],
        aG[1] + alpha[2] * rw[0] - alpha[0] * rw[2] + w[2] * wr[0] - w[0] * wr[2],
        aG[2] + alpha[0] * rw[1] - alpha[1] * rw[0] + w[0] * wr[1] - w[1] * wr[0],
      ];
      const ab = [R[0] * a[0] + R[3] * a[1] + R[6] * a[2], R[1] * a[0] + R[4] * a[1] + R[7] * a[2], R[2] * a[0] + R[5] * a[1] + R[8] * a[2]];
      q.n++;
      for (let k = 0; k < 3; k++) { q.sa[k] += ab[k]; q.sa2[k] += ab[k] * ab[k]; q.amax[k] = Math.max(q.amax[k], Math.abs(ab[k])); }
      q.sav += a[2]; q.sav2 += a[2] * a[2];
      q.amag = Math.max(q.amag, Math.hypot(...a));
      q.sumH += h; q.sumH2 += h * h; q.minH = Math.min(q.minH, h); q.maxH = Math.max(q.maxH, h);
      q.tTotal += dt;
      const above = h > 0;
      if (above) q.tAbove += dt;
      if (q.wasAbove === null) { q.wasAbove = above; if (above) q.aboveStart = t; else q.stretchStart = t; continue; }
      if (above !== q.wasAbove) {
        if (above) { q.longestUnder = Math.max(q.longestUnder, t - q.stretchStart); q.aboveStart = t; }
        else { q.dunks++; q.longestAbove = Math.max(q.longestAbove, t - q.aboveStart); q.stretchStart = t; }
        q.wasAbove = above;
      }
    }
  }
  summary(tEnd) {
    return this.pts.map((q) => {
      // close the stretch that is still running at the end of the record
      const lu = q.wasAbove === false ? Math.max(q.longestUnder, tEnd - q.stretchStart) : q.longestUnder;
      const la = q.wasAbove === true ? Math.max(q.longestAbove, tEnd - q.aboveStart) : q.longestAbove;
      const n = Math.max(1, q.n), mean = q.sumH / n;
      const rms = q.sa.map((s, k) => Math.sqrt(Math.max(0, q.sa2[k] / n - (s / n) ** 2)));
      return {
        name: q.name, clearance: q.clearance || 0, fracAbove: q.tTotal > 0 ? q.tAbove / q.tTotal : 0, longestUnder: lu, longestAbove: la,
        dunks: q.dunks, dunksPerHour: q.tTotal > 0 ? q.dunks * 3600 / q.tTotal : 0, meanH: mean, sdH: Math.sqrt(Math.max(0, q.sumH2 / n - mean * mean)),
        minH: q.minH, maxH: q.maxH, accRms: rms, accMax: q.amax, accMag: q.amag,
        accVertRms: Math.sqrt(Math.max(0, q.sav2 / n - (q.sav / n) ** 2)), duration: q.tTotal,
      };
    });
  }
}

// standard normal CDF (Abramowitz & Stegun 26.2.17, |ε| < 7.5e-8)
export function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

// Complex transfer functions of a point (equilibrium frame relative to G, r = [x, y, z]; still water at z = zw):
// relative height h, and acceleration [x, y, z] (equilibrium axes), per unit wave amplitude, from the RAO ξ (6 complex).
export function pointTransfer(xi, w, betaDeg, r, zw) {
  const k = w * w / 9.80665, b = betaDeg * Math.PI / 180, ph = -k * (r[0] * Math.cos(b) + r[1] * Math.sin(b));
  const eta = [Math.cos(ph), Math.sin(ph)];
  // displacement d = ξ_t + θ × r
  const th = [xi[3], xi[4], xi[5]];
  const crossC = (j) => {
    // (θ × r)_j with complex θ, real r
    const [a, c] = j === 0 ? [1, 2] : j === 1 ? [2, 0] : [0, 1];
    return [th[a][0] * r[c] - th[c][0] * r[a], th[a][1] * r[c] - th[c][1] * r[a]];
  };
  const d = [0, 1, 2].map((j) => { const c = crossC(j); return [xi[j][0] + c[0], xi[j][1] + c[1]]; });
  const h = [d[2][0] - eta[0], d[2][1] - eta[1]];
  const acc = d.map((z) => [-w * w * z[0], -w * w * z[1]]);
  return { h, acc, d };
}

// Linear statistics of a point in a spectrum: rows = [{ w, xi }] on a grid, S(w), heading, h0 = mean height above
// still water minus the clearance.
export function pointSpectral(rows, S, betaDeg, r, zw, h0) {
  let m0 = 0, m2 = 0, ma = [0, 0, 0], prev = null;
  for (let i = 0; i < rows.length; i++) {
    const { w, xi } = rows[i], tr = pointTransfer(xi, w, betaDeg, r, zw), s = S(w);
    const cur = { h: (tr.h[0] ** 2 + tr.h[1] ** 2) * s, a: tr.acc.map((z) => (z[0] ** 2 + z[1] ** 2) * s), w };
    if (prev) {
      const dw = w - prev.w;
      m0 += 0.5 * (cur.h + prev.h) * dw; m2 += 0.5 * (cur.h * w * w + prev.h * prev.w * prev.w) * dw;
      for (let k = 0; k < 3; k++) ma[k] += 0.5 * (cur.a[k] + prev.a[k]) * dw;
    }
    prev = cur;
  }
  const sd = Math.sqrt(Math.max(0, m0));
  const fracAbove = sd > 0 ? normCdf(h0 / sd) : (h0 > 0 ? 1 : 0);
  const nu = sd > 0 && m2 > 0 ? (1 / (2 * Math.PI)) * Math.sqrt(m2 / m0) * Math.exp(-h0 * h0 / (2 * m0)) : 0;
  return { sdH: sd, fracAbove, dunksPerHour: nu * 3600, meanUnder: nu > 0 ? (1 - fracAbove) / nu : null, accRms: ma.map((x) => Math.sqrt(Math.max(0, x))) };
}
// Regular wave of amplitude A: relative motion amplitude R and fraction of time above water.
export function pointRegular(xi, w, betaDeg, r, zw, h0, A) {
  const tr = pointTransfer(xi, w, betaDeg, r, zw), R = A * Math.hypot(...tr.h);
  const fracAbove = R <= Math.abs(h0) ? (h0 > 0 ? 1 : 0) : Math.acos(Math.max(-1, Math.min(1, -h0 / R))) / Math.PI;
  return { amp: R, fracAbove, accAmp: tr.acc.map((z) => A * Math.hypot(...z)) };
}

// ------------------------------------------------------------------ wave-following quality (from an RAO sweep)
// Ideal wave follower (deep water, η = e^{iωt} e^{−ik·x} at G): heave ξ₃ = 1; tilt along the surface,
// θ_x = ∂η/∂y = −ik sinβ, θ_y = −∂η/∂x = ik cosβ (so the body z axis stays normal to the surface); horizontal
// displacement of a surface particle ξ₁ = −i cosβ, ξ₂ = −i sinβ.
// Errors (complex, so phase lag counts): heave |ξ₃ − 1|, tilt |θ − θ_ideal| / k (relative to the slope amplitude),
// horizontal |ξ_h − ξ_h,ideal|.
export function followErrors(p, betaDeg) {
  const b = betaDeg * Math.PI / 180, cb = Math.cos(b), sb = Math.sin(b), k = p.k, xi = p.xi;
  const heave = Math.hypot(xi[2][0] - 1, xi[2][1]);
  // θ_x ideal = (0, −k sb), θ_y ideal = (0, k cb)
  const tilt = Math.hypot(xi[3][0], xi[3][1] + k * sb, xi[4][0], xi[4][1] - k * cb) / k;
  const horiz = Math.hypot(xi[0][0], xi[0][1] + cb, xi[1][0], xi[1][1] + sb);
  return { heave, tilt, horiz };
}
// Highest frequency up to which the error stays within tol, starting from the lowest frequency of the sweep
// (linear interpolation of the crossing). Returns { f, status: 'within' (never exceeds), 'cut', 'never' (exceeds
// at the lowest frequency) }.
export function followCutoff(freqs, err, tol) {
  if (!(err[0] <= tol)) return { f: null, status: 'never' };
  for (let i = 1; i < err.length; i++) {
    if (!(err[i] <= tol)) {
      const t = (tol - err[i - 1]) / ((err[i] - err[i - 1]) || 1e-30);
      return { f: freqs[i - 1] + Math.max(0, Math.min(1, t)) * (freqs[i] - freqs[i - 1]), status: 'cut' };
    }
  }
  return { f: freqs[freqs.length - 1], status: 'within' };
}
