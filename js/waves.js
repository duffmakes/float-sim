// Ocean wave spectra, sea-state table and linear irregular wave fields. Pure math, no rendering.
//
// References
//  [DNV]  DNV-RP-C205 Environmental Conditions and Environmental Loads, §3.5.5 (PM / JONSWAP forms, A_γ, γ(Tp/√Hs))
//  [HAS]  Hasselmann et al. (1973), Measurements of wind-wave growth and swell decay during JONSWAP
//  [PM]   Pierson & Moskowitz (1964), J. Geophys. Res. 69(24)
//  [NATO] NATO STANAG 4194 sea state numeral table, open-ocean North Atlantic (Lee & Bales), as reproduced in
//         USNA EN400 Principles of Ship Performance, ch. 8, Table 8.1
//  [FAL]  Faltinsen (1990), Sea Loads on Ships and Offshore Structures, ch. 2 (linear wave theory, Wheeler stretching)

export const G = 9.80665;

// Hs in metres (table means; ranges from the ft table converted), Tp = most probable modal period.
// Fully developed Pierson–Moskowitz sea [PM]: Hs = 0.209 U²/g and ωp = 0.877 g/U (U = wind at 19.5 m)
//  ⇒ Tp = 2π U / (0.877 g),  U = √(Hs g / 0.209). Used where the NATO table gives no period (SS0–1).
export function pmFullyDevelopedTp(Hs) {
  if (!(Hs > 0)) return 0;
  const U = Math.sqrt(Hs * G / 0.209);
  return 2 * Math.PI * U / (0.877 * G);
}

export const SEA_STATES = [
  { ss: 0, name: 'Calm (glassy)', Hs: 0, HsRange: [0, 0], Tp: 0, TpRange: null, wind: '0 kt' },
  { ss: 1, name: 'Calm (rippled)', Hs: 0.05, HsRange: [0, 0.1], Tp: +pmFullyDevelopedTp(0.05).toFixed(2), TpRange: null, tpDerived: true, wind: '0–6 kt' },
  { ss: 2, name: 'Smooth', Hs: 0.3, HsRange: [0.1, 0.5], Tp: 7.5, TpRange: [3.3, 12.8], wind: '7–10 kt' },
  { ss: 3, name: 'Slight', Hs: 0.88, HsRange: [0.5, 1.25], Tp: 7.5, TpRange: [5.0, 14.8], wind: '11–16 kt' },
  { ss: 4, name: 'Moderate', Hs: 1.88, HsRange: [1.25, 2.5], Tp: 8.8, TpRange: [6.1, 15.2], wind: '17–21 kt' },
  { ss: 5, name: 'Rough', Hs: 3.25, HsRange: [2.5, 4.0], Tp: 9.7, TpRange: [8.3, 15.5], wind: '22–27 kt' },
];

// Two-parameter Pierson–Moskowitz [DNV eq. 3.5.5.1]:  S(ω) = 5/16 · Hs² ωp⁴ ω⁻⁵ exp(−5/4 (ωp/ω)⁴)
export function pmSpectrum(w, Hs, Tp) {
  if (w <= 0 || Hs <= 0 || Tp <= 0) return 0;
  const wp = 2 * Math.PI / Tp;
  return (5 / 16) * Hs * Hs * wp ** 4 * w ** -5 * Math.exp(-1.25 * (wp / w) ** 4);
}

// JONSWAP [HAS; DNV eq. 3.5.5.3]:  S_J = A_γ S_PM γ^exp(−(ω−ωp)²/(2σ²ωp²)),  A_γ = 1 − 0.287 ln γ
export function jonswapSpectrum(w, Hs, Tp, gamma = 3.3) {
  const spm = pmSpectrum(w, Hs, Tp);
  if (spm === 0) return 0;
  const wp = 2 * Math.PI / Tp;
  const sigma = w <= wp ? 0.07 : 0.09;
  const r = Math.exp(-((w - wp) ** 2) / (2 * sigma * sigma * wp * wp));
  return (1 - 0.287 * Math.log(gamma)) * spm * gamma ** r;
}

// DNV recommended peak-enhancement factor from Tp/√Hs [DNV §3.5.5.5]
export function dnvGamma(Hs, Tp) {
  if (Hs <= 0) return 1;
  const r = Tp / Math.sqrt(Hs);
  if (r <= 3.6) return 5;
  if (r >= 5) return 1;
  return Math.exp(5.75 - 1.15 * r);
}

export function spectrumFn(type, Hs, Tp, gamma) {
  return type === 'jonswap' ? (w) => jonswapSpectrum(w, Hs, Tp, gamma) : (w) => pmSpectrum(w, Hs, Tp);
}

// Spectral moments by trapezoid integration on a fine grid.
export function spectralMoments(S, wmin, wmax, n = 20000) {
  let m0 = 0, m1 = 0, m2 = 0;
  const dw = (wmax - wmin) / n;
  for (let i = 0; i <= n; i++) {
    const w = wmin + i * dw, s = S(w) * (i === 0 || i === n ? 0.5 : 1) * dw;
    m0 += s; m1 += s * w; m2 += s * w * w;
  }
  return { m0, m1, m2, Hm0: 4 * Math.sqrt(m0), T1: 2 * Math.PI * m0 / m1, Tz: 2 * Math.PI * Math.sqrt(m0 / m2) };
}

// deep-water or finite-depth dispersion: ω² = g k tanh(k h)
export function waveNumber(w, depth = Infinity) {
  const k0 = w * w / G;
  if (!isFinite(depth)) return k0;
  let k = k0 / Math.sqrt(Math.tanh(k0 * depth)) || k0;
  for (let i = 0; i < 50; i++) {
    const t = Math.tanh(k * depth), f = G * k * t - w * w;
    const df = G * t + G * k * depth * (1 - t * t);
    const kn = k - f / df;
    if (Math.abs(kn - k) < 1e-12 * k) { k = kn; break; }
    k = kn;
  }
  return k;
}

// Small deterministic PRNG (mulberry32) so a seed reproduces the same sea.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Amplitude of a regular wave from a crest-to-trough height ('H') or an energy-equivalent significant height ('Hs').
export function regularAmplitude(H, heightKind = 'H') { return heightKind === 'Hs' ? H / (2 * Math.SQRT2) : H / 2; }

// Linear superposition of long- or short-crested components.
// headingDeg: direction the waves travel TOWARD, measured from world +x (counter-clockwise).
//   180° = waves travelling toward −x (head seas for a body whose bow points +x), 90° = beam seas, 0° = following.
export class WaveField {
  constructor(components, depth = Infinity) {
    this.depth = depth;
    this.n = components.length;
    this.a = new Float64Array(this.n); this.w = new Float64Array(this.n); this.k = new Float64Array(this.n);
    this.kx = new Float64Array(this.n); this.ky = new Float64Array(this.n); this.phi = new Float64Array(this.n);
    components.forEach((c, i) => {
      const k = c.k ?? waveNumber(c.w, depth);
      this.a[i] = c.a; this.w[i] = c.w; this.k[i] = k; this.phi[i] = c.phi || 0;
      const d = (c.dir ?? 0) * Math.PI / 180;
      this.kx[i] = k * Math.cos(d); this.ky[i] = k * Math.sin(d);
    });
    this.cosBuf = new Float64Array(this.n);
    this.scale = 1;   // 0→1 ramp used by the simulator to start from calm water
  }

  static calm() { return new WaveField([]); }

  static regular(A, w, headingDeg, depth = Infinity, phase = 0) {
    return new WaveField([{ a: A, w, dir: headingDeg, phi: phase }], depth);
  }

  // Regular (monochromatic Airy) wave from user values, independent of any spectrum.
  //   heightKind 'H'  : H is the crest-to-trough height, so amplitude A = H/2.
  //   heightKind 'Hs' : H is a significant wave height Hs = 4σ of the record; a sinusoid has σ = A/√2,
  //                     so A = Hs/(2√2) and the crest-to-trough height is Hs/√2 (same energy as an irregular sea of that Hs).
  static regularFrom({ H, T, heading = 90, heightKind = 'H', depth = Infinity }) {
    if (!(H > 0) || !(T > 0)) return WaveField.calm();
    const A = regularAmplitude(H, heightKind), w = 2 * Math.PI / T;
    const f = WaveField.regular(A, w, heading, depth);
    const k = f.k[0];
    f.meta = { mode: 'regular', H, T, heightKind, heading, A, Hwave: 2 * A, w, k, lambda: 2 * Math.PI / k, steepness: 2 * A * k / (2 * Math.PI), wMin: w, wMax: w, m0: A * A / 2 };
    return f;
  }

  // One entry point for the UI and the worker: { mode: 'regular', H, T, … } or spectrum parameters.
  static fromParams(p) { return p.mode === 'regular' ? WaveField.regularFrom(p) : WaveField.fromSpectrum(p); }

  // Random-phase discretisation of a spectrum. Frequencies are randomised within equal-width bins
  // (avoids the record repeating after 2π/Δω); amplitude aᵢ = √(2 S(ωᵢ) Δω).
  // spread > 0: cos^(2s) directional spreading, one random direction per component.
  static fromSpectrum({ type = 'pm', Hs, Tp, gamma = 3.3, heading = 90, N = 60, seed = 1, spread = 0, depth = Infinity, wLo = 0.4, wHi = 4.0 }) {
    if (!(Hs > 0) || !(Tp > 0)) return WaveField.calm();
    const S = spectrumFn(type, Hs, Tp, gamma);
    const wp = 2 * Math.PI / Tp, w0 = wLo * wp, w1 = wHi * wp, dw = (w1 - w0) / N;
    const rand = rng(seed);
    const comps = [];
    for (let i = 0; i < N; i++) {
      const w = w0 + (i + rand()) * dw;
      let dir = heading;
      if (spread > 0) {
        // rejection-sample θ ∈ (−π/2, π/2) from cos^(2s) θ
        for (;;) {
          const th = (rand() - 0.5) * Math.PI;
          if (rand() <= Math.cos(th) ** (2 * spread)) { dir = heading + th * 180 / Math.PI; break; }
        }
      }
      comps.push({ a: Math.sqrt(2 * S(w) * dw), w, dir, phi: rand() * 2 * Math.PI });
    }
    const f = new WaveField(comps, depth);
    f.meta = { type, Hs, Tp, gamma, heading, N, seed, spread, wMin: w0, wMax: w1, m0: comps.reduce((s, c) => s + c.a * c.a / 2, 0) };
    return f;
  }

  get maxOmega() { let m = 0; for (let i = 0; i < this.n; i++) m = Math.max(m, this.w[i]); return m; }
  get minWavelength() { let k = 0; for (let i = 0; i < this.n; i++) k = Math.max(k, this.k[i]); return k > 0 ? 2 * Math.PI / k : Infinity; }

  // η(x,y,t). Also leaves cos(ψᵢ) in this.cosBuf for an immediate pressure() at the same (x,y,t).
  eta(x, y, t) {
    let e = 0;
    const { a, w, kx, ky, phi, cosBuf } = this;
    for (let i = 0; i < this.n; i++) {
      const c = Math.cos(kx[i] * x + ky[i] * y - w[i] * t + phi[i]);
      cosBuf[i] = c; e += a[i] * c;
    }
    return e * this.scale;
  }

  // Incident fluid acceleration at (x, y, z) below still water (z ≤ 0): −∇p_dyn/ρ for p_dyn = ρg a e^{kz} cos ψ.
  //   a_x = g a kₓ e^{kz} sin ψ,  a_y = g a k_y e^{kz} sin ψ,  a_z = −g a k e^{kz} cos ψ
  accel(x, y, z, t) {
    let ax = 0, ay = 0, az = 0;
    const zc = Math.min(0, z);
    for (let i = 0; i < this.n; i++) {
      const psi = this.kx[i] * x + this.ky[i] * y - this.w[i] * t + this.phi[i];
      const e = G * this.a[i] * Math.exp(this.k[i] * zc), sn = Math.sin(psi);
      ax += e * this.kx[i] * sn; ay += e * this.ky[i] * sn; az -= e * this.k[i] * Math.cos(psi);
    }
    return [ax * this.scale, ay * this.scale, az * this.scale];
  }

  // Wheeler-stretched linear Froude–Krylov pressure at depth z below a surface of elevation e = η(x,y,t)
  // (call eta() first at the same x,y,t):  p = ρg[ −z + Σ aᵢ e^{kᵢ(z−η)} cos ψᵢ ].  Vanishes exactly at z = η.
  pressureAfterEta(z, e, rho) {
    let s = 0;
    const zs = z - e;
    const { a, k, cosBuf } = this;
    for (let i = 0; i < this.n; i++) s += a[i] * Math.exp(k[i] * zs) * cosBuf[i];
    return rho * G * (s * this.scale - z);
  }
}
