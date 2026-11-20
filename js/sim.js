// Rigid-body free-float simulation: weight at G, buoyancy at B, linear + angular damping.
import { submerged, transformTris, quatToMat3, mat3ToQuat, mat3, G0 } from './physics.js';
import { waveForces } from './hydro.js';
import { ursellR2, stokesDriftMean } from './waves.js';

export class FloatSim {
  // bodyTris: geometry relative to G in the body (model) frame, metres.
  // inertiaG: 3x3 inertia about G in body frame. q0: initial orientation quaternion [x,y,z,w].
  // kick: small initial angular velocity (rad/s). A real release is never perfectly still; without it a body
  // placed exactly on an unstable equilibrium (e.g. an upright cube at s.g. ½) would balance there forever.
  constructor({ bodyTris, mass, inertiaG, rho, q0, z0, zeta = 0.25, awpRef = 1, g = G0, kick = [2e-3, 1e-3, 0] }) {
    this.b = bodyTris;
    this.buf = new Float64Array(bodyTris.length);
    this.m = mass; this.Ib = inertiaG; this.rho = rho; this.g = g;
    this.q = q0.slice(); this.p = [0, 0, z0]; this.v = [0, 0, 0]; this.w = kick.slice();
    this.t = 0;
    this.zeta = zeta;
    // natural heave frequency sets damping & the step size
    const wn = Math.sqrt(rho * g * Math.max(awpRef, 1e-9) / mass);
    const Imin = Math.max(1e-12, Math.min(inertiaG[0], inertiaG[4], inertiaG[8]));
    // crude upper bound on rotational stiffness: ρ g ∫ r² dA ~ ρ g Awp · L²
    const L2 = Math.max(awpRef, 1e-9);
    const wr = Math.sqrt(rho * g * awpRef * L2 / Imin);
    this.wn = wn;
    this.dt = Math.min(0.02, 1 / (30 * Math.max(wn, wr, 1e-3)));
    this.last = null;
  }

  step(dt) {
    const R = quatToMat3(this.q);
    transformTris(this.b, R, [0, 0, 0], this.p, this.buf);
    const s = submerged(this.buf, 0);
    const Fb = this.rho * this.g * s.V;
    const d = 2 * this.zeta * this.wn;
    const F = [-d * this.m * this.v[0], -d * this.m * this.v[1], Fb - this.m * this.g - d * this.m * this.v[2]];
    const r = [s.B[0] - this.p[0], s.B[1] - this.p[1], s.B[2] - this.p[2]];
    // torque of buoyancy about G:  r × (0,0,Fb)
    const Iw = mat3.mul(R, mat3.mul(this.Ib, mat3.transpose(R)));
    const Iww = mat3.apply(Iw, this.w);
    const tau = s.V > 0 ? [r[1] * Fb, -r[0] * Fb, 0] : [0, 0, 0];
    for (let k = 0; k < 3; k++) tau[k] -= d * Iww[k];
    // Euler: I ω̇ = τ − ω × Iω
    const gyro = [this.w[1] * Iww[2] - this.w[2] * Iww[1], this.w[2] * Iww[0] - this.w[0] * Iww[2], this.w[0] * Iww[1] - this.w[1] * Iww[0]];
    const alpha = mat3.apply(mat3.inverse(Iw), [tau[0] - gyro[0], tau[1] - gyro[1], tau[2] - gyro[2]]);
    for (let k = 0; k < 3; k++) {
      this.v[k] += F[k] / this.m * dt; this.p[k] += this.v[k] * dt;
      this.w[k] += alpha[k] * dt;
    }
    // q̇ = ½ (ω,0) ⊗ q
    const [qx, qy, qz, qw] = this.q, [wx, wy, wz] = this.w, h = 0.5 * dt;
    this.q = [
      qx + h * (wx * qw + wy * qz - wz * qy),
      qy + h * (-wx * qz + wy * qw + wz * qx),
      qz + h * (wx * qy - wy * qx + wz * qw),
      qw + h * (-wx * qx - wy * qy - wz * qz),
    ];
    const n = Math.hypot(...this.q); this.q = this.q.map((c) => c / n);
    this.t += dt;
    this.last = s;
    if (s.wp.area > 0) this.wn = Math.sqrt(this.rho * this.g * s.wp.area / this.m);
  }

  // advance by simulated time `span`, but do at most maxSteps steps (returns time actually advanced)
  advance(span, maxSteps) {
    const n = Math.min(maxSteps, Math.max(1, Math.round(span / this.dt)));
    for (let i = 0; i < n; i++) this.step(this.dt);
    return n * this.dt;
  }

  kinetic() {
    return Math.hypot(...this.v) + Math.hypot(...this.w);
  }
}

// ------------------------------------------------------------------------------------------------
// Rigid body in waves: nonlinear Froude–Krylov pressure on the instantaneous wetted hull (hydro.js),
// gravity, added mass and linear damping per mode (estimates from hydro.defaultHydroCoeffs).
// hull: { verts, idx } welded mesh relative to G in the body frame.  R0: equilibrium attitude (world←body).
// A, Bd: 6-vectors in equilibrium world axes (surge, sway, heave, roll, pitch, yaw).
export class WaveSim {
  // volQ: optional [x,y,z,w] volume quadrature of the mean submerged volume (body frame, relative to G; see
  // hydro.volumeQuadrature). When given, adds A_jj × volume-averaged incident acceleration (long-wave
  // diffraction correction, as in hydro.fkExcitation) to surge, sway and heave.
  // drift: null (free-floating, first-order Froude–Krylov only, as before) or
  //   { on: true, Cd }      wave drift: Stokes-drift current + reflection mean drift force, quadratic drag on the
  //                          horizontal velocity relative to the drift current (see waves.js for the references)
  //   { on: false, holdPeriod }  no drift: a soft horizontal spring (natural period holdPeriod, critically damped)
  //                          keeps the body on station without touching wave-frequency surge and sway
  constructor({ hull, mass, inertiaG, rho, R0, z0, field, A, Bd, dt, ramp = 0, vanishDeg = 180, g = G0, volQ = null, diffModes = [true, true, true], drift = null }) {
    this.hull = hull; this.m = mass; this.rho = rho; this.g = g; this.field = field;
    this.world = new Float64Array(hull.verts.length);
    this.etaBuf = new Float64Array(hull.verts.length / 3); this.pBuf = new Float64Array(hull.verts.length / 3);
    this.R0 = R0; this.q = mat3ToQuat(R0); this.p = [0, 0, z0]; this.v = [0, 0, 0]; this.w = [0, 0, 0];
    this.A = A; this.Bd = Bd; this.dt = dt; this.t = 0; this.ramp = ramp; this.vanishDeg = vanishDeg;
    this.volQ = volQ; this.diffModes = diffModes;
    if (volQ) { let V = 0; for (let o = 3; o < volQ.length; o += 4) V += volQ[o]; this.volQV = V; }
    const R0t = mat3.transpose(R0);
    const diag = (a, b, c) => [a, 0, 0, 0, b, 0, 0, 0, c];
    // rotational added inertia / damping are attached to the body (given in equilibrium world axes)
    this.IbDry = inertiaG;
    this.IbAdd = mat3.mul(R0t, mat3.mul(diag(A[3], A[4], A[5]), R0));
    this.BbRot = mat3.mul(R0t, mat3.mul(diag(Bd[3], Bd[4], Bd[5]), R0));
    // "deck" vertices: the top 3 % of the hull height in the equilibrium attitude (green-water detection)
    const vz = [];
    for (let i = 0; i < hull.verts.length; i += 3) vz.push(R0[6] * hull.verts[i] + R0[7] * hull.verts[i + 1] + R0[8] * hull.verts[i + 2]);
    const zmax = Math.max(...vz), zmin = Math.min(...vz), h = zmax - zmin;
    this.deck = vz.map((z, i) => (z >= zmax - 0.03 * h ? i : -1)).filter((i) => i >= 0);
    this.rec = { t: [], heave: [], roll: [], pitch: [], yaw: [], eta: [], wet: [], x: [], y: [] };
    this.drift = drift;
    if (drift) {
      const f = field;
      this.dr = { ux: 0, uy: 0, Fx: 0, Fy: 0, d: 0, widths: new Float64Array(36), next: 0, comps: [], lp1: [0, 0], lp2: [0, 0] };
      let sa = 0, saw = 0;
      for (let i = 0; i < f.n; i++) {
        const k = f.k[i];
        this.dr.comps.push({ w: f.w[i], k, a: f.a[i], ex: f.kx[i] / k, ey: f.ky[i] / k });
        sa += f.a[i] ** 2; saw += f.a[i] ** 2 * f.w[i];
      }
      // low-pass time constant (each of two cascaded stages): 2 × the energy-mean wave period
      this.dr.tau = drift.tau ?? (saw > 0 ? 2 * 2 * Math.PI * sa / saw : 10);
      // equilibrium submerged geometry: draft below the mean surface and waterline-level widths (every 10°)
      const V = hull.verts, xs = [], ys = [];
      let zmin = 0;
      for (let i = 0; i < V.length; i += 3) {
        const z = R0[6] * V[i] + R0[7] * V[i + 1] + R0[8] * V[i + 2] + z0;
        if (z < 0) { xs.push(R0[0] * V[i] + R0[1] * V[i + 1] + R0[2] * V[i + 2]); ys.push(R0[3] * V[i] + R0[4] * V[i + 1] + R0[5] * V[i + 2]); zmin = Math.min(zmin, z); }
      }
      this.dr.d = -zmin;
      for (let j = 0; j < 36; j++) {
        const th = j * Math.PI / 18, px = -Math.sin(th), py = Math.cos(th);   // perpendicular to direction θ
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < xs.length; i++) { const v = xs[i] * px + ys[i] * py; if (v < lo) lo = v; if (v > hi) hi = v; }
        this.dr.widths[j] = xs.length ? hi - lo : 0;
      }
    }
    this.stats = { greenWater: 0, greenSteps: 0, steps: 0, capsized: false, capsizeT: null, maxRoll: 0, maxPitch: 0 };
    this.last = null;
  }

  relEuler(R) { return mat3.toEulerDeg(mat3.mul(R, mat3.transpose(this.R0))); }

  step(dt, record = true) {
    const R = quatToMat3(this.q);
    const { verts, idx } = this.hull;
    for (let i = 0; i < verts.length; i += 3) {
      const x = verts[i], y = verts[i + 1], z = verts[i + 2];
      this.world[i] = R[0] * x + R[1] * y + R[2] * z + this.p[0];
      this.world[i + 1] = R[3] * x + R[4] * y + R[5] * z + this.p[1];
      this.world[i + 2] = R[6] * x + R[7] * y + R[8] * z + this.p[2];
    }
    this.field.scale = this.ramp > 0 ? Math.min(1, this.t / this.ramp) : 1;
    const wf = waveForces(this.world, idx, this.field, this.t, this.rho, this.p, { etaBuf: this.etaBuf, pBuf: this.pBuf, segments: !record });
    const { A, Bd, m } = this;
    const F = [wf.F[0] - Bd[0] * this.v[0], wf.F[1] - Bd[1] * this.v[1], wf.F[2] - m * this.g - Bd[2] * this.v[2]];
    if (this.drift) this.driftForces(F, wf.F, dt);
    if (this.volQ && this.field.n) {
      const q = this.volQ, sum = [0, 0, 0];
      for (let o = 0; o < q.length; o += 4) {
        const x = q[o], y = q[o + 1], z = q[o + 2];
        const acc = this.field.accel(R[0] * x + R[1] * y + R[2] * z + this.p[0], R[3] * x + R[4] * y + R[5] * z + this.p[1], R[6] * x + R[7] * y + R[8] * z + this.p[2], this.t);
        sum[0] += q[o + 3] * acc[0]; sum[1] += q[o + 3] * acc[1]; sum[2] += q[o + 3] * acc[2];
      }
      for (let k = 0; k < 3; k++) if (this.diffModes[k]) F[k] += A[k] / this.volQV * sum[k];
    }
    const IwDry = mat3.mul(R, mat3.mul(this.IbDry, mat3.transpose(R)));
    const Iw = mat3.mul(R, mat3.mul(this.IbDry.map((v, i) => v + this.IbAdd[i]), mat3.transpose(R)));
    const Bw = mat3.mul(R, mat3.mul(this.BbRot, mat3.transpose(R)));
    const Iww = mat3.apply(IwDry, this.w), Bww = mat3.apply(Bw, this.w);
    const gyro = [this.w[1] * Iww[2] - this.w[2] * Iww[1], this.w[2] * Iww[0] - this.w[0] * Iww[2], this.w[0] * Iww[1] - this.w[1] * Iww[0]];
    const alpha = mat3.apply(mat3.inverse(Iw), [wf.M[0] - Bww[0] - gyro[0], wf.M[1] - Bww[1] - gyro[1], wf.M[2] - Bww[2] - gyro[2]]);
    for (let k = 0; k < 3; k++) {
      this.v[k] += F[k] / (m + A[k]) * dt; this.p[k] += this.v[k] * dt;
      this.w[k] += alpha[k] * dt;
    }
    const [qx, qy, qz, qw] = this.q, [wx, wy, wz] = this.w, h = 0.5 * dt;
    const q = [qx + h * (wx * qw + wy * qz - wz * qy), qy + h * (-wx * qz + wy * qw + wz * qx),
      qz + h * (wx * qy - wy * qx + wz * qw), qw + h * (-wx * qx - wy * qy - wz * qz)];
    const n = Math.hypot(...q); this.q = q.map((c) => c / n);
    this.t += dt;
    this.last = wf;

    // bookkeeping
    const e = this.relEuler(R);
    const st = this.stats;
    st.steps++;
    if (this.t > this.ramp) {
      st.maxRoll = Math.max(st.maxRoll, Math.abs(e[0])); st.maxPitch = Math.max(st.maxPitch, Math.abs(e[1]));
      let green = false;
      for (const v of this.deck) if (this.world[v * 3 + 2] < this.etaBuf[v]) { green = true; break; }
      if (green) { st.greenSteps++; if (!this.wasGreen) st.greenWater++; }
      this.wasGreen = green;
      const tilt = Math.acos(Math.max(-1, Math.min(1, mat3.mul(R, mat3.transpose(this.R0))[8]))) * 180 / Math.PI;
      if (!st.capsized && (tilt > Math.min(90, this.vanishDeg))) { st.capsized = true; st.capsizeT = this.t; }
    }
    if (record) {
      const r = this.rec;
      r.t.push(this.t); r.heave.push(this.p[2] - this.z0ref()); r.roll.push(e[0]); r.pitch.push(e[1]); r.yaw.push(e[2]);
      r.eta.push(this.field.n ? this.field.eta(this.p[0], this.p[1], this.t) : 0); r.wet.push(wf.wetArea);
      r.x.push(this.p[0]); r.y.push(this.p[1]);
    }
  }

  // Drift current and mean drift force for the current yaw (refreshed every 0.25 s; geometry from equilibrium).
  updateDrift(yaw) {
    const dr = this.dr;
    let ux = 0, uy = 0, Fx = 0, Fy = 0;
    for (const c of dr.comps) {
      const us = stokesDriftMean(c.w, c.k, c.a, dr.d);
      ux += us * c.ex; uy += us * c.ey;
      const Fm = 0.5 * this.rho * this.g * c.a * c.a * ursellR2(c.k * dr.d) * this.widthAt(Math.atan2(c.ey, c.ex) - yaw);
      Fx += Fm * c.ex; Fy += Fm * c.ey;
    }
    Object.assign(dr, { ux, uy, Fx, Fy });
  }
  // waterline width across direction theta (equilibrium axes), interpolated from the 10° table
  widthAt(theta) {
    const w = this.dr.widths, u = ((theta / (Math.PI / 18)) % 36 + 36) % 36, j = Math.floor(u), fr = u - j;
    return w[j] * (1 - fr) + w[(j + 1) % 36] * fr;
  }
  driftForces(F, Ffk, dt) {
    const D = this.drift, dr = this.dr;
    // The pressure integration over the instantaneous wetted hull also yields a slowly varying horizontal force.
    // With Froude–Krylov loads only (no diffracted or radiated waves) that mean force is not physical, so it is
    // removed with two cascaded low-pass stages; the oscillating wave-frequency force passes untouched (< 1 % leak).
    const al = Math.min(1, dt / dr.tau);
    for (let k = 0; k < 2; k++) {
      dr.lp1[k] += al * (Ffk[k] - dr.lp1[k]);
      dr.lp2[k] += al * (dr.lp1[k] - dr.lp2[k]);
      F[k] -= dr.lp2[k];
    }
    const m0 = this.m + this.A[0], m1 = this.m + this.A[1];
    if (!D.on) {
      // station keeping: x'' + 2ω_h x' + ω_h² x = 0 on the horizontal position, ω_h = 2π / holdPeriod
      const wh = 2 * Math.PI / (D.holdPeriod || 120);
      F[0] -= m0 * (wh * wh * this.p[0] + 2 * wh * this.v[0]);
      F[1] -= m1 * (wh * wh * this.p[1] + 2 * wh * this.v[1]);
      dr.uNow = [0, 0];
      return;
    }
    if (this.t >= dr.next) {
      const R = quatToMat3(this.q), Rr = mat3.mul(R, mat3.transpose(this.R0));
      this.updateDrift(Math.atan2(Rr[3], Rr[0])); dr.next = this.t + 0.25;
    }
    const s2 = this.field.scale * this.field.scale;   // second-order: scales with amplitude²
    const ux = dr.ux * s2, uy = dr.uy * s2;
    dr.uNow = [ux, uy];
    // linear surge/sway damping acts on the velocity relative to the drift current (not on riding the current)
    F[0] += this.Bd[0] * ux; F[1] += this.Bd[1] * uy;
    const rx = this.v[0] - ux, ry = this.v[1] - uy, sp = Math.hypot(rx, ry);
    if (sp > 0) {
      const R = quatToMat3(this.q), Rr = mat3.mul(R, mat3.transpose(this.R0));
      const area = this.widthAt(Math.atan2(ry, rx) - Math.atan2(Rr[3], Rr[0])) * dr.d;   // submerged projected area ≈ width × draft
      const q = 0.5 * this.rho * (D.Cd ?? 1) * area * sp;
      F[0] -= q * rx; F[1] -= q * ry;
    }
    F[0] += dr.Fx * s2; F[1] += dr.Fy * s2;
  }
  // Steady drift speed of the model (closed form check): solve B(v−u) + ½ρC_dA|v−u|(v−u) = F along the wave direction.
  steadyDrift(dirRad) {
    const dr = this.dr; this.updateDrift(0);
    const u = dr.ux * Math.cos(dirRad) + dr.uy * Math.sin(dirRad), F = dr.Fx * Math.cos(dirRad) + dr.Fy * Math.sin(dirRad);
    const B = Math.abs(Math.cos(dirRad)) > 0.7 ? this.Bd[0] : this.Bd[1];
    const c = 0.5 * this.rho * (this.drift.Cd ?? 1) * this.widthAt(dirRad) * dr.d;
    const vr = c > 0 ? (-B + Math.sqrt(B * B + 4 * c * F)) / (2 * c) : F / B;
    return { u, F, vRel: vr, v: u + vr };
  }

  z0ref() { if (this.z0 === undefined) this.z0 = this.p[2]; return this.z0; }

  advance(span, maxSteps, record = true) {
    this.z0ref();
    const n = Math.min(maxSteps, Math.max(1, Math.round(span / this.dt)));
    for (let i = 0; i < n; i++) this.step(this.dt, record);
    return n * this.dt;
  }
}

// Statistics of a recorded series after the ramp: std, significant single amplitude (2σ), max |x|.
export function seriesStats(t, x, tStart = 0) {
  let n = 0, s = 0, s2 = 0, mx = 0;
  for (let i = 0; i < t.length; i++) if (t[i] >= tStart) { n++; s += x[i]; s2 += x[i] * x[i]; }
  const mean = n ? s / n : 0;
  for (let i = 0; i < t.length; i++) if (t[i] >= tStart) mx = Math.max(mx, Math.abs(x[i] - mean));
  const sd = n ? Math.sqrt(Math.max(0, s2 / n - mean * mean)) : 0;
  return { mean, sd, sig: 2 * sd, max: mx, n };
}

// ------------------------------------------------------------------------------------------------
// Drop / rise test in calm water: a body released from any height (above, at or below the surface).
// Deliberately simple engineering model:
//  • gravity; water buoyancy ρw g V_sub at B; air buoyancy ρa g V_dry at the dry-volume centroid
//  • quadratic drag  F = −½ ρ_eff C_eff A⊥ |v| v  on the CoG velocity, where A⊥ is the hull's projected area
//    normal to the motion (½ Σ|n·v̂| dA) and ρ_eff C_eff blends water and air by the submerged fraction f
//  • added mass f·A (translations) and rotational water damping f·2ζω_ref·I (from the hydrostatic estimates)
//  • while the body pierces the surface (0 < f < 1): linear heave damping 2ζ_h(m + A_z)ω_ref, standing in for
//    wave-making (radiation) damping, which a fully submerged or airborne body does not have
// bodyTris: hull relative to G in the body frame (m). inertiaG: body-frame inertia about G.
export class DropSim {
  constructor({ bodyTris, mass, inertiaG, rhoW, rhoA = 1.225, CdW = 1.0, CdA = 1.0, q0, z0, vz0 = 0,
    addedMass = [0, 0, 0], zetaRot = 0.1, zetaHeave = 0.15, wRef = 1, g = G0, maxTime = 600 }) {
    this.b = bodyTris; this.buf = new Float64Array(bodyTris.length);
    this.m = mass; this.Ib = inertiaG; this.rhoW = rhoW; this.rhoA = rhoA; this.CdW = CdW; this.CdA = CdA; this.g = g;
    this.q = q0.slice(); this.p = [0, 0, z0]; this.v = [0, 0, vz0]; this.w = [0, 0, 0]; this.t = 0;
    this.Aadd = addedMass; this.zetaRot = zetaRot; this.zetaHeave = zetaHeave; this.wRef = wRef; this.maxTime = maxTime; this.still = 0;
    // body-frame area vectors (projected area) and volume / centroid
    const n = bodyTris.length / 9;
    this.S = new Float64Array(n * 3);
    let V = 0, cx = 0, cy = 0, cz = 0, ext = 0;
    for (let i = 0, k = 0; i < bodyTris.length; i += 9, k += 3) {
      const ax = bodyTris[i], ay = bodyTris[i + 1], az = bodyTris[i + 2];
      const ux = bodyTris[i + 3] - ax, uy = bodyTris[i + 4] - ay, uz = bodyTris[i + 5] - az;
      const wx = bodyTris[i + 6] - ax, wy = bodyTris[i + 7] - ay, wz = bodyTris[i + 8] - az;
      this.S[k] = 0.5 * (uy * wz - uz * wy); this.S[k + 1] = 0.5 * (uz * wx - ux * wz); this.S[k + 2] = 0.5 * (ux * wy - uy * wx);
      const det = ax * (bodyTris[i + 4] * bodyTris[i + 8] - bodyTris[i + 5] * bodyTris[i + 7]) - ay * (bodyTris[i + 3] * bodyTris[i + 8] - bodyTris[i + 5] * bodyTris[i + 6]) + az * (bodyTris[i + 3] * bodyTris[i + 7] - bodyTris[i + 4] * bodyTris[i + 6]);
      V += det / 6;
      cx += det * (ax + bodyTris[i + 3] + bodyTris[i + 6]) / 24; cy += det * (ay + bodyTris[i + 4] + bodyTris[i + 7]) / 24; cz += det * (az + bodyTris[i + 5] + bodyTris[i + 8]) / 24;
      for (let j = 0; j < 9; j++) ext = Math.max(ext, Math.abs(bodyTris[i + j]));
    }
    this.C = [cx / V, cy / V, cz / V]; this.size = ext;
    // full volume measured exactly as the submerged volume is (clip method), so a fully submerged body has
    // f = 1 even on a slightly open CAD mesh
    let zmax = -Infinity; for (let i = 2; i < bodyTris.length; i += 3) zmax = Math.max(zmax, bodyTris[i]);
    this.V = submerged(bodyTris, zmax + 1e-6 * (ext + 1)).V || V;
    // step: resolve the heave/rotation period, and never move more than ~1 % of the body size per step
    const Imin = Math.max(1e-12, Math.min(inertiaG[0], inertiaG[4], inertiaG[8]));
    const wr = Math.sqrt(rhoW * g * Math.max(V, 1e-12) * ext / Imin);
    this.dtBase = Math.min(0.01, 1 / (40 * Math.max(wRef, wr, 1e-3)));
    this.rec = { t: [], z: [], vz: [], roll: [], pitch: [], frac: [] };
    this.st = { contactT: null, entrySpeed: null, minZ: z0, maxFrac: 0, fullySubmerged: false, breachT: null, maxZafterBreach: -Infinity, startFrac: null, done: null, terminal: 0 };
  }

  projectedArea(dirWorld, R) {
    // v̂ in body axes
    const d = [R[0] * dirWorld[0] + R[3] * dirWorld[1] + R[6] * dirWorld[2], R[1] * dirWorld[0] + R[4] * dirWorld[1] + R[7] * dirWorld[2], R[2] * dirWorld[0] + R[5] * dirWorld[1] + R[8] * dirWorld[2]];
    let a = 0;
    for (let k = 0; k < this.S.length; k += 3) a += Math.abs(this.S[k] * d[0] + this.S[k + 1] * d[1] + this.S[k + 2] * d[2]);
    return 0.5 * a;
  }

  step(dt) {
    const R = quatToMat3(this.q);
    transformTris(this.b, R, [0, 0, 0], this.p, this.buf);
    const s = submerged(this.buf, 0);
    const Vs = Math.max(0, Math.min(this.V, s.V)), f = Vs / this.V, Vd = this.V - Vs;
    const { m, g, rhoW, rhoA } = this;
    const Fbw = rhoW * g * Vs, Fba = rhoA * g * Vd;
    // dry-volume centroid (world): (V·C − Vs·B)/Vd
    const Cw = mat3.apply(R, this.C).map((c, i) => c + this.p[i]);
    const Cdry = Vd > 1e-12 * this.V ? Cw.map((c, i) => (this.V * c - Vs * (s.B[i])) / Vd) : Cw;
    // drag on the CoG velocity
    const speed = Math.hypot(...this.v);
    const F = [0, 0, Fbw + Fba - m * g];
    let Ap = 0;
    if (speed > 1e-9) {
      Ap = this.projectedArea(this.v.map((c) => c / speed), R);
      const rc = f * rhoW * this.CdW + (1 - f) * rhoA * this.CdA;
      for (let k = 0; k < 3; k++) F[k] -= 0.5 * rc * Ap * speed * this.v[k];
    }
    const piercing = s.wp.area > 1e-9 * this.size * this.size;
    this.piercing = piercing;
    if (piercing) F[2] -= 2 * this.zetaHeave * (m + this.Aadd[2]) * this.wRef * this.v[2];
    // torques about G: buoyancy (water + air) and rotational water damping
    const rB = [s.B[0] - this.p[0], s.B[1] - this.p[1], s.B[2] - this.p[2]], rA = [Cdry[0] - this.p[0], Cdry[1] - this.p[1]];
    const tau = [rB[1] * Fbw + rA[1] * Fba, -rB[0] * Fbw - rA[0] * Fba, 0];
    const Iw = mat3.mul(R, mat3.mul(this.Ib, mat3.transpose(R)));
    const Iww = mat3.apply(Iw, this.w);
    const dRot = f * 2 * this.zetaRot * this.wRef;
    for (let k = 0; k < 3; k++) tau[k] -= dRot * Iww[k];
    const gyro = [this.w[1] * Iww[2] - this.w[2] * Iww[1], this.w[2] * Iww[0] - this.w[0] * Iww[2], this.w[0] * Iww[1] - this.w[1] * Iww[0]];
    const alpha = mat3.apply(mat3.inverse(Iw), [tau[0] - gyro[0], tau[1] - gyro[1], tau[2] - gyro[2]]);
    for (let k = 0; k < 3; k++) {
      this.v[k] += F[k] / (m + f * this.Aadd[k]) * dt; this.p[k] += this.v[k] * dt;
      this.w[k] += alpha[k] * dt;
    }
    const [qx, qy, qz, qw] = this.q, [wx, wy, wz] = this.w, h = 0.5 * dt;
    const q = [qx + h * (wx * qw + wy * qz - wz * qy), qy + h * (-wx * qz + wy * qw + wz * qx), qz + h * (wx * qy - wy * qx + wz * qw), qw + h * (-wx * qx - wy * qy - wz * qz)];
    const nq = Math.hypot(...q); this.q = q.map((c) => c / nq);
    this.t += dt;
    this.last = { s, f, Ap, speed };
    // ---- events & statistics
    const st = this.st;
    if (st.startFrac === null) st.startFrac = f;
    if (st.contactT === null && st.startFrac === 0 && f > 0) { st.contactT = this.t; st.entrySpeed = -this.v[2]; }
    st.minZ = Math.min(st.minZ, this.p[2]);
    st.maxFrac = Math.max(st.maxFrac, f);
    if (f > 0.999) st.fullySubmerged = true;
    if (st.fullySubmerged && st.breachT === null && f < 0.999 && this.v[2] > 0) st.breachT = this.t;
    if (st.breachT !== null) st.maxZafterBreach = Math.max(st.maxZafterBreach, this.p[2]);
    st.terminal = Math.max(st.terminal, speed);
    // stillness must last ~2 natural periods (a bounce passes through zero velocity at every turning point)
    const quiet = this.piercing && Math.hypot(...this.v) < 1e-3 * Math.max(1, this.size) && Math.hypot(...this.w) < 1e-3;
    this.still = quiet ? this.still + dt : 0;
  }

  advance(span, maxSteps) {
    let done = 0, n = 0;
    while (done < span && n < maxSteps) {
      const speed = Math.hypot(...this.v);
      const dt = Math.min(this.dtBase, 0.01 * this.size / Math.max(speed, 1e-9), span - done + 1e-12);
      this.step(dt); done += dt; n++;
      if (n % 4 === 0 || n === 1) {
        const r = this.rec, e = mat3.toEulerDeg(quatToMat3(this.q));
        r.t.push(this.t); r.z.push(this.p[2]); r.vz.push(this.v[2]); r.roll.push(e[0]); r.pitch.push(e[1]); r.frac.push(this.last.f);
      }
    }
    return done;
  }

  // settled: floating (partly submerged) and essentially still for a while
  settled() {
    return this.t > 1 && this.still > Math.max(1, 4 * Math.PI / Math.max(this.wRef, 1e-3));
  }
}
