// Reference coordinate system: the CAD model's own csys, given by its origin and axes in the file's coordinates.
// Float Sim works in this csys. The mesh is moved into it when it is loaded, so the CoG, the inertia, tracked points,
// heave plates, the fairlead and the RAO reference point are all entered and reported in it. The default is the
// file's own origin and axes, which leaves the model as it is.
import { mat3 } from './physics.js';

const D2R = Math.PI / 180;
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

// def: { mode: 'file' | 'custom', origin: [x, y, z] (m, file coordinates), axes: 'angles' | 'dirs',
//        angles: [about X, about Y, about Z] (deg), order: 'fixed' | 'moving', xDir: [3], zDir: [3] }
//   angles, 'fixed':  rotate about the file's fixed X, then Y, then Z axes:   R = Rz(c) Ry(b) Rx(a)
//   angles, 'moving': rotate about X, then the rotated Y′, then the rotated Z″: R = Rx(a) Ry(b) Rz(c)
//   dirs:             the ref x and z axis directions in file coordinates (z is kept, x is made perpendicular to it)
// Returns { O, R, identity, warn }. R is row-major and its columns are the ref x, y, z axes in file coordinates, so
// p_file = O + R p_ref and p_ref = Rᵀ (p_file − O).
export function refFrame(def) {
  const I = mat3.identity();
  if (!def || def.mode !== 'custom') return { O: [0, 0, 0], R: I, identity: true, warn: null };
  const O = [0, 1, 2].map((i) => fin(def.origin && def.origin[i]));
  let R = I, warn = null;
  if (def.axes === 'dirs') {
    const x = [0, 1, 2].map((i) => fin(def.xDir && def.xDir[i])), z = [0, 1, 2].map((i) => fin(def.zDir && def.zDir[i]));
    const nx = norm(x), nz = norm(z);
    if (!(nx > 0 && nz > 0)) warn = 'An axis direction is zero, so the file axes are used.';
    else {
      const zu = z.map((v) => v / nz), xu0 = x.map((v) => v / nx), c = dot(xu0, zu);
      if (Math.abs(c) > 1 - 1e-9) warn = 'The x and z directions are parallel, so the file axes are used.';
      else {
        const xo = xu0.map((v, i) => v - c * zu[i]), n = norm(xo), xu = xo.map((v) => v / n), yu = cross(zu, xu);
        R = [xu[0], yu[0], zu[0], xu[1], yu[1], zu[1], xu[2], yu[2], zu[2]];
        const off = Math.abs(90 - Math.acos(Math.max(-1, Math.min(1, c))) / D2R);
        if (off > 0.05) warn = `The x and z directions are ${off.toFixed(2)}° from perpendicular, so x was turned to be perpendicular to z.`;
      }
    }
  } else {
    const [a, b, c] = [0, 1, 2].map((i) => fin(def.angles && def.angles[i]) * D2R);
    const Rx = mat3.rotX(a), Ry = mat3.rotY(b), Rz = mat3.rotZ(c);
    R = def.order === 'moving' ? mat3.mul(Rx, mat3.mul(Ry, Rz)) : mat3.mul(Rz, mat3.mul(Ry, Rx));
  }
  // round-off below 1e-15 (cos 90° = 6e-17) is cleaned so a quarter turn gives exact axes
  R = R.map((v) => (Math.abs(v) < 1e-15 ? 0 : v));
  const identity = O.every((v) => v === 0) && R.every((v, i) => v === I[i]);
  return { O, R, identity, warn };
}

// Rotation angles (deg) that give the axes R in the chosen order: the inverse of refFrame's angles.
//   fixed:  R = Rz(c) Ry(b) Rx(a) is the roll–pitch–yaw form of mat3.fromEulerDeg;
//   moving: R = Rx(a) Ry(b) Rz(c), so Rᵀ = Rz(−c) Ry(−b) Rx(−a) is that form with the angles negated.
export function anglesFor(R, order = 'fixed') {
  return order === 'moving' ? mat3.toEulerDeg(mat3.transpose(R)).map((v) => -v) : mat3.toEulerDeg(R);
}

// Mesh (flat x, y, z triangle soup, metres, file coordinates) into the ref csys.
export function toRefTris(tris, F) {
  if (F.identity) return tris;
  const { O, R } = F, out = new Float64Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i] - O[0], y = tris[i + 1] - O[1], z = tris[i + 2] - O[2];
    out[i] = R[0] * x + R[3] * y + R[6] * z;
    out[i + 1] = R[1] * x + R[4] * y + R[7] * z;
    out[i + 2] = R[2] * x + R[5] * y + R[8] * z;
  }
  return out;
}
export function toRefPoint(p, F) {
  const x = p[0] - F.O[0], y = p[1] - F.O[1], z = p[2] - F.O[2], R = F.R;
  return [R[0] * x + R[3] * y + R[6] * z, R[1] * x + R[4] * y + R[7] * z, R[2] * x + R[5] * y + R[8] * z];
}
export function fromRefPoint(p, F) {
  const q = mat3.apply(F.R, p);
  return [q[0] + F.O[0], q[1] + F.O[1], q[2] + F.O[2]];
}
export const sameFrame = (a, b) => !!a && !!b && a.O.every((v, i) => v === b.O[i]) && a.R.every((v, i) => v === b.R[i]);

// Parallel-axis (Huygens–Steiner) theorem for the inertia tensor (convention I_xy = −∫xy dm), in the same axes:
// about a point O, I_O = I_G + m(|r|²E − r rᵀ) with r = G − O.
function shiftInertia(I, m, r, sign) {
  const [x, y, z] = r, r2 = x * x + y * y + z * z;
  const S = [r2 - x * x, -x * y, -x * z, -x * y, r2 - y * y, -y * z, -x * z, -y * z, r2 - z * z];
  return I.map((v, i) => v + sign * m * S[i]);
}
export const inertiaAboutPoint = (IG, m, r) => shiftInertia(IG, m, r, 1);   // I_G → I_O, r = G − O
export const inertiaToG = (IO, m, r) => shiftInertia(IO, m, r, -1);        // I_O → I_G, r = G − O

// ---------------------------------------------------------------- RAOs at a reference point
// The RAOs are solved about G in the equilibrium axes, with the phase measured at G (η = Re{e^{iωt} e^{−ik·x}},
// x relative to G). For a point O of the body, d = O − G in the same axes:
//   translations ξ_O = ξ_G + θ × d (rigid body, small rotations); rotations are the same at every point;
//   phase measured at O: the wave there is e^{−ik·d} times the wave at G, so every RAO is multiplied by e^{+ik·d},
//   with k·d = k(d_x cos β + d_y sin β).
const cmul = (z, c, s) => [z[0] * c - z[1] * s, z[0] * s + z[1] * c];
export function raoAtPoint(xi, k, betaDeg, d, phaseAtPoint = true) {
  const [dx, dy, dz] = d, [tx, ty, tz] = [xi[3], xi[4], xi[5]];
  // θ × d = (θ_y d_z − θ_z d_y, θ_z d_x − θ_x d_z, θ_x d_y − θ_y d_x)
  const out = [
    [xi[0][0] + ty[0] * dz - tz[0] * dy, xi[0][1] + ty[1] * dz - tz[1] * dy],
    [xi[1][0] + tz[0] * dx - tx[0] * dz, xi[1][1] + tz[1] * dx - tx[1] * dz],
    [xi[2][0] + tx[0] * dy - ty[0] * dx, xi[2][1] + tx[1] * dy - ty[1] * dx],
    tx.slice(), ty.slice(), tz.slice(),
  ];
  if (!phaseAtPoint) return out;
  const b = betaDeg * D2R, ph = k * (dx * Math.cos(b) + dy * Math.sin(b)), c = Math.cos(ph), s = Math.sin(ph);
  return out.map((z) => cmul(z, c, s));
}
// Exciting forces and moments about O (phase at O) from those about G: F_O = F, M_O = M_G − d × F.
export function forcesAtPoint(F, k, betaDeg, d, phaseAtPoint = true) {
  const [dx, dy, dz] = d, [fx, fy, fz] = [F[0], F[1], F[2]];
  const out = [
    F[0].slice(), F[1].slice(), F[2].slice(),
    [F[3][0] - (dy * fz[0] - dz * fy[0]), F[3][1] - (dy * fz[1] - dz * fy[1])],
    [F[4][0] - (dz * fx[0] - dx * fz[0]), F[4][1] - (dz * fx[1] - dx * fz[1])],
    [F[5][0] - (dx * fy[0] - dy * fx[0]), F[5][1] - (dx * fy[1] - dy * fx[1])],
  ];
  if (!phaseAtPoint) return out;
  const b = betaDeg * D2R, ph = k * (dx * Math.cos(b) + dy * Math.sin(b)), c = Math.cos(ph), s = Math.sin(ph);
  return out.map((z) => cmul(z, c, s));
}
// A whole sweep (the shape raoSweepAsync and bemSweep return) moved to the point O, d = O − G.
export function sweepAtPoint(sweep, d) {
  return sweep.map((h) => ({
    beta: h.beta,
    points: h.points.map((p) => {
      const xi = raoAtPoint(p.xi, p.k, h.beta, d), amp = xi.map((z) => Math.hypot(z[0], z[1]));
      return {
        ...p, xi, F: p.F ? forcesAtPoint(p.F, p.k, h.beta, d) : p.F, amp,
        degPerM: amp.map((a, j) => (j >= 3 ? a * 180 / Math.PI : a)),
        perSlope: amp.map((a, j) => (j >= 3 ? a / p.k : a)),
        phase: xi.map((z) => Math.atan2(z[1], z[0]) * 180 / Math.PI),
      };
    }),
  }));
}
