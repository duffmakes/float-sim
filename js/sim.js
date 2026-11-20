// Rigid-body free-float simulation: weight at G, buoyancy at B, linear + angular damping.
import { submerged, transformTris, quatToMat3, mat3, G0 } from './physics.js';

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
