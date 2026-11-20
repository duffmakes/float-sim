// Rigid-body free-float simulation: weight at G, buoyancy at B, linear + angular damping.
import { submerged, transformTris, quatToMat3, mat3ToQuat, mat3, G0 } from './physics.js';
import { waveForces } from './hydro.js';

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
  constructor({ hull, mass, inertiaG, rho, R0, z0, field, A, Bd, dt, ramp = 0, vanishDeg = 180, g = G0, volQ = null, diffModes = [true, true, true] }) {
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
    this.rec = { t: [], heave: [], roll: [], pitch: [], yaw: [], eta: [], wet: [] };
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
    }
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
