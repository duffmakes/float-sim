// Buoyancy / hydrostatics math. Pure functions, no rendering dependencies.
// Geometry is a "triangle soup": Float64Array, 9 numbers (3 xyz vertices) per triangle,
// outward-facing counter-clockwise winding, SI metres. Z is up, the water surface is the plane z = zw.

import { meshCheck } from './meshcheck.js';

export const G0 = 9.80665;

// ---------- small vector / matrix helpers (3x3 row-major arrays) ----------
export const mat3 = {
  identity: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
  mul(a, b) {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return r;
  },
  transpose: (a) => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]],
  apply: (m, v) => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ],
  rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; },
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; },
  rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; },
  // Extrinsic X (roll), then Y (pitch), then Z (yaw):  R = Rz * Ry * Rx
  fromEulerDeg(roll, pitch, yaw) {
    const d = Math.PI / 180;
    return mat3.mul(mat3.rotZ(yaw * d), mat3.mul(mat3.rotY(pitch * d), mat3.rotX(roll * d)));
  },
  // Inverse of fromEulerDeg: roll and yaw in (−180°, 180°], pitch in [−90°, 90°]. Pitch comes from
  // atan2(−m6, |cos pitch|), exact at every angle (asin(−m6) loses accuracy near ±90°). At gimbal lock
  // (|cos pitch| ≤ 1e-9, pitch within 6e-8° of ±90°) only roll ∓ yaw is defined: it is returned as roll with
  // yaw 0, which rebuilds the same rotation. Proved in proofs/Proofs/Euler.lean.
  toEulerDeg(m) {
    const d = 180 / Math.PI;
    const cp = Math.hypot(m[7], m[8]);
    if (cp > 1e-9) {
      return [Math.atan2(m[7], m[8]) * d, Math.atan2(-m[6], cp) * d, Math.atan2(m[3], m[0]) * d];
    }
    return [Math.atan2(-m[5], m[4]) * d, (-m[6] > 0 ? 90 : -90), 0];
  },
  inverse(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    const k = 1 / det;
    return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
            B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
            C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
  },
};

export function quatToMat3(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

export function mat3ToQuat(m) {
  const tr = m[0] + m[4] + m[8];
  let x, y, z, w;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s; x = (m[7] - m[5]) * s; y = (m[2] - m[6]) * s; z = (m[3] - m[1]) * s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);
    w = (m[7] - m[5]) / s; x = 0.25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]);
    w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = 0.25 * s; z = (m[5] + m[7]) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]);
    w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = 0.25 * s;
  }
  return [x, y, z, w];
}

// out[i] = R * (src[i] - origin) + offset
export function transformTris(src, R, origin = [0, 0, 0], offset = [0, 0, 0], out = null) {
  out = out || new Float64Array(src.length);
  const [ox, oy, oz] = origin, [tx, ty, tz] = offset;
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i] - ox, y = src[i + 1] - oy, z = src[i + 2] - oz;
    out[i] = R[0] * x + R[1] * y + R[2] * z + tx;
    out[i + 1] = R[3] * x + R[4] * y + R[5] * z + ty;
    out[i + 2] = R[6] * x + R[7] * y + R[8] * z + tz;
  }
  return out;
}

export function zRange(tris) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 2; i < tris.length; i += 3) { const z = tris[i]; if (z < lo) lo = z; if (z > hi) hi = z; }
  return [lo, hi];
}

export function bbox(tris) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3)
    for (let k = 0; k < 3; k++) { const v = tris[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  return { min: mn, max: mx };
}

// ---------- whole-body mass properties (uniform density = 1) ----------
// Returns volume, centroid and inertia tensor about the centroid (per unit density), from tetrahedra with apex at the
// reference point `ref`. For a closed, consistently oriented mesh the result does not depend on `ref`
// (proofs/Proofs/Mesh.lean). The default, the top centre of the bounding box, also gives the right answer for a hull
// that is open only at a flat deck level: the missing deck lies in the apex plane and contributes nothing.
export function massProperties(tris, ref = null) {
  let p = ref;
  if (!p) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < tris.length; i += 3) {
      const x = tris[i], y = tris[i + 1], z = tris[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z > z1) z1 = z;
    }
    p = tris.length ? [(x0 + x1) / 2, (y0 + y1) / 2, z1] : [0, 0, 0];
  }
  let V = 0, cx = 0, cy = 0, cz = 0;
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0]; // covariance ∫ x xᵀ dV about the reference point
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i] - p[0], ay = tris[i + 1] - p[1], az = tris[i + 2] - p[2];
    const bx = tris[i + 3] - p[0], by = tris[i + 4] - p[1], bz = tris[i + 5] - p[2];
    const qx = tris[i + 6] - p[0], qy = tris[i + 7] - p[1], qz = tris[i + 8] - p[2];
    const det = ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
    V += det / 6;
    const sx = ax + bx + qx, sy = ay + by + qy, sz = az + bz + qz;
    cx += det * sx / 24; cy += det * sy / 24; cz += det * sz / 24;
    const v = [[ax, ay, az], [bx, by, bz], [qx, qy, qz]], s = [sx, sy, sz];
    const k = det / 120;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
      C[r * 3 + c] += k * (v[0][r] * v[0][c] + v[1][r] * v[1][c] + v[2][r] * v[2][c] + s[r] * s[c]);
  }
  const cen = V !== 0 ? [cx / V, cy / V, cz / V] : [0, 0, 0];   // relative to the reference point
  // shift covariance to centroid, then I = tr(C)·Id − C
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] -= V * cen[r] * cen[c];
  const tr = C[0] + C[4] + C[8];
  const I = C.map((x, idx) => (idx % 4 === 0 ? tr : 0) - x);
  return { volume: V, centroid: V !== 0 ? [cen[0] + p[0], cen[1] + p[1], cen[2] + p[2]] : [0, 0, 0], inertia: I };
}

// Inertia tensor of a body of given mass about point p (uniform density assumed).
export function inertiaAbout(mp, mass, p) {
  const k = mass / mp.volume;
  const d = [mp.centroid[0] - p[0], mp.centroid[1] - p[1], mp.centroid[2] - p[2]];
  const d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const I = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    I[r * 3 + c] = k * mp.inertia[r * 3 + c] + mass * ((r === c ? d2 : 0) - d[r] * d[c]);
  return I;
}

// ---------- submerged volume & waterplane ----------
// Clips every triangle against z < zw. Using a reference point on the waterplane makes the
// (unmeshed) waterplane cap contribute nothing to volume and its moments, so the clipped
// surface alone gives exact submerged volume V and centre of buoyancy B.
// The cut edges form the waterplane boundary; Green's theorem on them gives area/moments.
// If wantSegments, returns the waterline segments (for drawing).
export function submerged(tris, zw, wantSegments = false) {
  let V = 0, mx = 0, my = 0, mz = 0;
  let A = 0, Ax = 0, Ay = 0, Ixx = 0, Iyy = 0, Ixy = 0;
  const segs = wantSegments ? [] : null;
  const P = new Float64Array(15); // up to 4 clipped vertices (relative to (0,0,zw)) ×3
  const inside = [false, false, false];
  let enX = 0, enY = 0, exX = 0, exY = 0, hasEn = false, hasEx = false;

  for (let i = 0; i < tris.length; i += 9) {
    const z0 = tris[i + 2] - zw, z1 = tris[i + 5] - zw, z2 = tris[i + 8] - zw;
    inside[0] = z0 < 0; inside[1] = z1 < 0; inside[2] = z2 < 0;
    const nIn = inside[0] + inside[1] + inside[2];
    if (nIn === 0) continue;
    let n = 0;
    hasEn = hasEx = false;
    if (nIn === 3) {
      for (let k = 0; k < 9; k++) P[k] = tris[i + k];
      P[2] = z0; P[5] = z1; P[8] = z2;
      n = 3;
    } else {
      for (let a = 0; a < 3; a++) {
        const b = (a + 1) % 3;
        const ia = i + a * 3, ib = i + b * 3;
        const za = tris[ia + 2] - zw, zb = tris[ib + 2] - zw;
        if (inside[a]) { P[n * 3] = tris[ia]; P[n * 3 + 1] = tris[ia + 1]; P[n * 3 + 2] = za; n++; }
        if (inside[a] !== inside[b]) {
          const t = za / (za - zb);
          const x = tris[ia] + t * (tris[ib] - tris[ia]);
          const y = tris[ia + 1] + t * (tris[ib + 1] - tris[ia + 1]);
          P[n * 3] = x; P[n * 3 + 1] = y; P[n * 3 + 2] = 0; n++;
          if (inside[a]) { exX = x; exY = y; hasEx = true; } else { enX = x; enY = y; hasEn = true; }
        }
      }
    }
    // fan-triangulate polygon; tetrahedra with apex at (0,0,zw)
    for (let k = 1; k + 1 < n; k++) {
      const ax = P[0], ay = P[1], az = P[2];
      const bx = P[k * 3], by = P[k * 3 + 1], bz = P[k * 3 + 2];
      const cx = P[k * 3 + 3], cy = P[k * 3 + 4], cz = P[k * 3 + 5];
      const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
      V += det;
      mx += det * (ax + bx + cx); my += det * (ay + by + cy); mz += det * (az + bz + cz);
    }
    // waterplane boundary edge; the cap traverses it enter -> exit (CCW seen from above)
    if (hasEn && hasEx) {
      const x0 = enX, y0 = enY, x1 = exX, y1 = exY;
      const c = x0 * y1 - x1 * y0;
      A += c; Ax += (x0 + x1) * c; Ay += (y0 + y1) * c;
      Iyy += (x0 * x0 + x0 * x1 + x1 * x1) * c;
      Ixx += (y0 * y0 + y0 * y1 + y1 * y1) * c;
      Ixy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c;
      if (segs) segs.push(x0, y0, x1, y1);
    }
  }
  V /= 6;
  const B = V > 1e-15 ? [mx / (24 * V), my / (24 * V), mz / (24 * V) + zw] : [0, 0, zw];
  A /= 2;
  let wp = { area: 0, cx: 0, cy: 0, Ixx: 0, Iyy: 0, Ixy: 0 };
  if (Math.abs(A) > 1e-15) {
    const cxw = Ax / (6 * A), cyw = Ay / (6 * A);
    // second moments about the waterplane centroid (∫y² dA, ∫x² dA, ∫xy dA)
    wp = {
      area: A, cx: cxw, cy: cyw,
      Ixx: Ixx / 12 - A * cyw * cyw,
      Iyy: Iyy / 12 - A * cxw * cxw,
      Ixy: Ixy / 24 - A * cxw * cyw,
    };
  }
  return { V, B, wp, segs };
}

// Find the waterline height zw so the submerged volume equals targetV.
// Safeguarded Newton (dV/dz = waterplane area) with bisection fallback.
export function solveWaterline(tris, targetV, range = null) {
  const [lo0, hi0] = range || zRange(tris);
  let lo = lo0, hi = hi0;
  const total = submerged(tris, hi + 1e-9 * (hi - lo + 1)).V;
  if (targetV <= 0) return { zw: lo, sub: submerged(tris, lo), status: 'empty' };
  // neutral: the weight equals the buoyancy of the whole body (to round-off), so it hangs fully submerged
  const neutral = Math.abs(targetV - total) <= 1e-9 * total;
  if (targetV >= total || neutral) return { zw: hi, sub: submerged(tris, hi + 1e-9), status: 'sinks', neutral, total };
  let z = lo + (hi - lo) * (targetV / total);
  let sub;
  for (let it = 0; it < 80; it++) {
    sub = submerged(tris, z);
    const f = sub.V - targetV;
    if (Math.abs(f) <= 1e-10 * total) break;
    if (f > 0) hi = z; else lo = z;
    const a = Math.abs(sub.wp.area);
    let zn = a > 1e-12 ? z - f / a : NaN;
    if (!(zn > lo && zn < hi)) zn = 0.5 * (lo + hi);
    if (hi - lo < 1e-12 * (hi0 - lo0 + 1e-9)) { z = zn; sub = submerged(tris, z); break; }
    z = zn;
  }
  return { zw: z, sub, status: 'floats', total };
}

// Hydrostatic analysis of a body in a fixed attitude.
// relTris: body geometry already rotated, expressed relative to G (so G = origin).
export function hydrostatics(relTris, zw, mass, rho, g = G0) {
  const sub = submerged(relTris, zw, true);
  const { V, B, wp } = sub;
  const [zmin, zmax] = zRange(relTris);
  const total = submerged(relTris, zmax + 1e-9).V;
  const BMt = V > 0 ? wp.Ixx / V : 0;   // roll about the world X axis
  const BMl = V > 0 ? wp.Iyy / V : 0;   // pitch about the world Y axis
  // principal (min/max) second moments of waterplane
  const avg = (wp.Ixx + wp.Iyy) / 2, dif = (wp.Ixx - wp.Iyy) / 2;
  const rad = Math.sqrt(dif * dif + wp.Ixy * wp.Ixy);
  const Imin = avg - rad, Imax = avg + rad;
  // The second moment about the waterplane axis at angle θ from world x is I(θ) = avg + dif·cos 2θ − Ixy·sin 2θ,
  // smallest where (cos 2θ, sin 2θ) points along (−dif, Ixy). axisMinDeg is that axis, in (−90°, 90°]: the body
  // heels about it most easily.
  const axisMinDeg = 0.5 * Math.atan2(wp.Ixy, -dif) * 180 / Math.PI;
  const GMt = B[2] + BMt;  // G at z = 0  ⇒  GM = KB + BM − KG = zB + BM − zG
  const GMl = B[2] + BMl;
  const GMmin = B[2] + (V > 0 ? Imin / V : 0);
  const W = mass * g;
  return {
    V, B, wp, segs: sub.segs, zw, zmin, zmax, total,
    draft: zw - zmin, freeboard: zmax - zw,
    BMt, BMl, GMt, GMl, GMmin, Imin, Imax, axisMinDeg,
    Mt: [B[0], B[1], B[2] + BMt], Ml: [B[0], B[1], B[2] + BMl],
    buoyancy: rho * g * V, weight: W,
    // horizontal offset of B relative to G -> unbalanced moment in this attitude
    offset: [B[0], B[1]],
    moment: [rho * g * V * B[1], -rho * g * V * B[0]], // torque about world x, y (N·m)
    rightingPerDegT: rho * g * V * GMt * Math.sin(Math.PI / 180),
    rightingPerDegL: rho * g * V * GMl * Math.sin(Math.PI / 180),
    tpc: rho * Math.abs(wp.area), // kg per metre of immersion
    // a real body has a positive waterplane area and positive second moments; anything else is a mesh fault
    // (faces wound the wrong way that the import could not repair)
    wpBad: V > 0 && wp.area !== 0 && (wp.area < 0 || wp.Ixx < 0 || wp.Iyy < 0 || Imin < -1e-12 * Math.abs(Imax)),
  };
}

// ---------- righting arm (GZ) ----------
// Heel axis: 'x' (roll), 'y' (pitch) or a horizontal direction given in degrees from world x (e.g. the weakest
// waterplane axis, H.axisMinDeg). Returns its unit vector (ux, uy); multiples of 90° are exact.
export function heelAxis(axis) {
  if (axis === 'x') return [1, 0];
  if (axis === 'y') return [0, 1];
  const d = ((+axis % 360) + 360) % 360;
  if (d % 90 === 0) return [[1, 0], [0, 1], [-1, 0], [0, -1]][d / 90];
  return [Math.cos(d * Math.PI / 180), Math.sin(d * Math.PI / 180)];
}
// Rotation by angle a (rad) about the horizontal unit axis (ux, uy, 0), Rodrigues' formula. For (1, 0) and (0, 1)
// it is exactly mat3.rotX and mat3.rotY.
export function rotAboutHorizontal(ux, uy, a) {
  const c = Math.cos(a), s = Math.sin(a), k = 1 - c;
  return [c + k * ux * ux, k * ux * uy, s * uy,
    k * ux * uy, c + k * uy * uy, -s * ux,
    -s * uy, s * ux, c];
}
// GM about the horizontal axis through the waterplane centroid parallel to `axis`: KB + I(axis)/V − KG.
export function gmAbout(H, axis) {
  const [ux, uy] = heelAxis(axis);
  const I = H.wp.Ixx * ux * ux + H.wp.Iyy * uy * uy - 2 * H.wp.Ixy * ux * uy;
  return H.B[2] + (H.V > 0 ? I / H.V : 0);
}
const sizeOf = (tris) => { const b = bbox(tris); return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 1; };

// Righting arm at one heel angle. The body (relTris: rotated, relative to G) is heeled by `deg` about the horizontal
// axis u through G. Fixed trim: nothing else turns. Free trim: the heeled body is then turned about the horizontal
// world axis w = z × u (trim, applied after the heel) to the trim of least potential energy, where B is level with G
// along u (no trimming moment) and a small extra trim is resisted; the waterline is solved for the displacement at
// every trial. GZ = B_x·u_y − B_y·u_x, the arm of the buoyancy–weight couple about u (positive = righting).
// opts: { freeTrim, trim0 (rad, start guess), scale, buf, open (points of the mesh's openings, relative to G like
// relTris) }. With opts.open the result also has `open`: how far the lowest opening point is below the waterline
// (positive: an opening is under water).
export function gzAt(relTris, targetV, axis, deg, opts = {}) {
  const [ux, uy] = heelAxis(axis);
  const buf = opts.buf || new Float64Array(relTris.length);
  const Rh = rotAboutHorizontal(ux, uy, deg * Math.PI / 180);
  const op = opts.open && opts.open.length ? opts.open : null;
  const ev = (trim) => {
    const R = trim ? mat3.mul(rotAboutHorizontal(-uy, ux, trim), Rh) : Rh;
    transformTris(relTris, R, [0, 0, 0], [0, 0, 0], buf);
    const s = solveWaterline(buf, targetV);
    const B = s.sub.B;
    let open = null;
    if (op) { let z = Infinity; for (let i = 0; i < op.length; i += 3) { const v = R[6] * op[i] + R[7] * op[i + 1] + R[8] * op[i + 2]; if (v < z) z = v; } open = s.zw - z; }
    return { trim, status: s.status, along: B[0] * ux + B[1] * uy, gz: B[0] * uy - B[1] * ux, bz: B[2], open };
  };
  const out = (r) => ({ deg, gz: r.gz, status: r.status, trim: r.trim, along: r.along, open: r.open });
  if (!opts.freeTrim) { const r = ev(0); return { deg, gz: r.gz, status: r.status, trim: 0, open: r.open }; }
  const tol = 1e-11 * (opts.scale || sizeOf(relTris));
  // Root of along(trim) from a start guess: secant, and once the root is bracketed, Illinois regula falsi (never
  // leaves the bracket). Returns the best point and the slope sign of along there (+1: the trim is stable).
  const root = (a, b) => {
    let lo = null, hi = null, side = 0, best = Math.abs(b.along) < Math.abs(a.along) ? b : a;
    const bracket = (p, q) => { if (p.along * q.along < 0) { lo = p.along < 0 ? p : q; hi = p.along < 0 ? q : p; } };
    bracket(a, b);
    for (let it = 0; it < 60 && Math.abs(best.along) > tol; it++) {
      let t;
      if (lo && hi) t = (lo.trim * hi.along - hi.trim * lo.along) / (hi.along - lo.along);
      else {
        const d = b.along - a.along;
        t = d !== 0 ? b.trim - b.along * (b.trim - a.trim) / d : b.trim + 0.05;
        t = b.trim + Math.max(-0.25, Math.min(0.25, t - b.trim));   // at most ~14° per secant step
      }
      if (!(Math.abs(t) < Math.PI)) break;
      const c = ev(t);
      if (c.status !== 'floats') break;
      if (Math.abs(c.along) < Math.abs(best.along)) best = c;
      if (lo && hi) {
        if (c.along < 0) { lo = c; if (side === -1) hi = { ...hi, along: hi.along / 2 }; side = -1; }
        else { hi = c; if (side === 1) lo = { ...lo, along: lo.along / 2 }; side = 1; }
        if (Math.abs(hi.trim - lo.trim) < 1e-15) break;
      } else { a = b; b = c; bracket(a, b); }
    }
    return best;
  };
  let a = ev(opts.trim0 || 0);
  if (a.status !== 'floats') return out(a);
  let best = Math.abs(a.along) <= tol ? a : root(a, ev(a.trim + (a.along > 0 ? -1 : 1) * 2e-3));
  if (best.status !== 'floats') return out(best);
  // The trimming moment about w is −W·along, so along is dU/d(trim) up to a positive factor (U: potential energy):
  // a root where along falls through zero is a maximum of U, an unstable trim (for example the symmetric trim of a
  // body heeled about an axis of symmetry that is not its natural one). Then go down to the stable roots on either
  // side, within ±90° of trim in 0.1 rad steps, and keep the one of least energy (U per unit weight = z_G − z_B =
  // −B_z). If there is none, the unstable trim is kept and flagged (trimUnstable): a compact body heeled far enough
  // has no stable trim near upright at all (review R1-30). opts.noScan: only flag it, without the search (gzCurve
  // passes it once a search has found nothing, so the cost is paid once per curve, not at every angle).
  const h = 1e-4, up = ev(best.trim + h);
  let trimUnstable = false;
  if (up.status === 'floats' && up.along < best.along - tol) {
    trimUnstable = true;
    const found = [];
    if (!opts.noScan) {
      for (const dir of [1, -1]) {
        let p = best, q = null;
        for (let k = 1; k <= 16; k++) {
          const t = best.trim + dir * k * 0.1;   // 5.7° steps, to ±91.7°
          if (!(Math.abs(t) < Math.PI)) break;
          const c = ev(t);
          if (c.status !== 'floats') break;
          if (dir > 0 ? c.along > 0 : c.along < 0) { q = c; break; }
          p = c;
        }
        if (q) { const r = root(p, q); if (r.status === 'floats') found.push(r); }
      }
    }
    if (found.length) { best = found.reduce((m, r) => (-r.bz < -m.bz ? r : m)); trimUnstable = false; }
  }
  return { ...out(best), trimUnstable };
}

// GZ curve: heel the body about a horizontal axis through G (see gzAt). Default angles 0–180° every 5°.
// opts: { freeTrim, open } (free-trim heels continue from the previous angle's trim).
export function gzCurve(relTris, targetV, axis = 'x', angles = null, opts = {}) {
  angles = angles || Array.from({ length: 37 }, (_, i) => i * 5);
  const o = { ...opts, buf: opts.buf || new Float64Array(relTris.length), scale: opts.scale || sizeOf(relTris) };
  const out = [];
  let trim = opts.trim0 || 0, noScan = false;
  for (const deg of angles) {
    const r = gzAt(relTris, targetV, axis, deg, { ...o, trim0: trim, noScan });
    trim = r.trim;
    noScan = !!r.trimUnstable;   // the search found no stable trim: do not repeat it at the next angles
    out.push(r);
  }
  return out;
}

// Summary of a GZ curve. curve[0] is the start attitude (GZ ≈ 0, its sign is round-off).
//   unstable: GM about the heel axis is negative (opts.GM, below −1e-9 of opts.scale, the verdict's round-off band),
//             or, without it or when GM is zero to round-off (neutral), GZ ≤ 0 at the first angle.
//   loll:     for an unstable start, where GZ turns positive again (fixed or free trim, about this axis).
//   vanish:   where GZ turns from positive to negative (angle of vanishing stability); null: positive to the end. A
//             curve to 180° that crosses within 0.1° of 180° counts as positive to the end: GZ(180°) is zero for an
//             upright-symmetric body and faceting moves that zero by a few thousandths of a degree.
//   flood:    opts.flood, the angle where an opening goes under water (downflooding angle), or null.
//   end:      where the range of stability ends: the vanishing or the downflooding angle, whichever comes first.
//   max, maxDeg: largest GZ within the range of positive stability (up to `end`), and its angle.
// With opts.at(deg) → GZ, crossings are found by regula falsi to 1e-9° and the maximum by golden section (unless
// opts.refineMax is false); without it they are interpolated between the samples.
export function gzSummary(curve, opts = {}) {
  const { GM = null, at = null, scale = 0, flood = null, refineMax = true } = opts;
  const n = curve.length;
  const neutral = GM !== null && Math.abs(GM) <= 1e-9 * scale;
  const unstable = GM !== null && !neutral ? GM < 0 : n > 1 && curve[1].gz <= 0;
  const root = (a, b) => {     // a.gz and b.gz have opposite signs (or one is 0)
    if (!at) return a.deg + (b.deg - a.deg) * a.gz / (a.gz - b.gz);
    let x0 = a.deg, f0 = a.gz, x1 = b.deg, f1 = b.gz, side = 0, c = x0;
    if (f0 === 0) return x0;
    if (f1 === 0) return x1;
    for (let it = 0; it < 80; it++) {
      const cn = (x0 * f1 - x1 * f0) / (f1 - f0);
      if (Math.abs(cn - c) < 1e-9 && it > 0) return cn;
      c = cn;
      const fc = at(c);
      if (fc === 0) return c;
      if (fc * f1 > 0) { x1 = c; f1 = fc; if (side === -1) f0 /= 2; side = -1; }
      else { x0 = c; f0 = fc; if (side === 1) f1 /= 2; side = 1; }
      if (Math.abs(x1 - x0) < 1e-9) return c;
    }
    return c;
  };
  // a point just off the start with the given sign of GZ (for a crossing below the first sampled angle)
  const nearStart = (sign) => {
    if (!at || n < 2) return null;
    for (let d = curve[1].deg / 2; d > curve[1].deg * 1e-7; d /= 2) { const g = at(d); if (g * sign > 0) return { deg: d, gz: g }; }
    return null;
  };
  let loll = null, vanish = null, from = 1;
  if (unstable && n > 1) {
    let i = 1; while (i < n && curve[i].gz <= 0) i++;
    if (i < n) {
      const neg = i > 1 ? curve[i - 1] : nearStart(-1);
      if (neg) loll = root(neg, curve[i]);
      from = i;
    } else from = n;
  } else if (n > 1 && curve[1].gz <= 0) {
    const pos = nearStart(1);
    if (pos) vanish = root(pos, curve[1]);
  }
  if (vanish === null) {
    for (let i = Math.max(2, from + 1); i < n; i++) if (curve[i - 1].gz > 0 && curve[i].gz <= 0) { vanish = root(curve[i - 1], curve[i]); break; }
  }
  if (vanish !== null && n > 1 && curve[n - 1].deg >= 180 && vanish > 179.9) vanish = null;
  const end = flood !== null && flood < (vanish ?? Infinity) ? flood : vanish;
  // the maximum within the range of positive stability (from the start, or from the loll angle, to its end)
  const lo = unstable ? (loll ?? Infinity) : 0, hi = end ?? Infinity;
  let max = -Infinity, maxDeg = 0, mi = -1;
  for (let i = 1; i < n; i++) if (curve[i].deg >= lo && curve[i].deg <= hi && curve[i].gz > max) { max = curve[i].gz; maxDeg = curve[i].deg; mi = i; }
  if (mi < 0 && flood === null) for (let i = 1; i < n; i++) if (curve[i].gz > max) { max = curve[i].gz; maxDeg = curve[i].deg; mi = i; }   // no sample in the range
  if (mi < 0 && flood !== null && hi > lo && n > 1) {
    // the range ends (an opening goes under) before the first sample past its start (review R1-29): the maximum on
    // [lo, end] by golden section on the curve, or without it the sampled curve interpolated to the end
    const g = (x) => (at ? at(x) : (() => { let k = 1; while (k < n - 1 && curve[k].deg < x) k++; const a = curve[k - 1], b = curve[k]; return a.gz + (b.gz - a.gz) * (x - a.deg) / (b.deg - a.deg); })());
    if (at && refineMax) {
      const r = (Math.sqrt(5) - 1) / 2;
      let a = lo, b = hi, c = b - r * (b - a), d = a + r * (b - a), fc = g(c), fd = g(d);
      while (b - a > 1e-5) {
        if (fc > fd) { b = d; d = c; fd = fc; c = b - r * (b - a); fc = g(c); }
        else { a = c; c = d; fc = fd; d = a + r * (b - a); fd = g(d); }
      }
      const x = (a + b) / 2, fx = g(x), fe = g(hi);
      [max, maxDeg] = fe >= fx ? [fe, hi] : [fx, x];
    } else { max = g(hi); maxDeg = hi; }
  }
  if (at && refineMax && mi > 0 && mi < n - 1 && max > 0) {
    // golden-section search between the neighbouring samples (kept inside the range)
    let a = Math.max(curve[mi - 1].deg, Math.min(lo, curve[mi].deg)), b = Math.min(curve[mi + 1].deg, Math.max(hi, curve[mi].deg));
    const r = (Math.sqrt(5) - 1) / 2;
    let c = b - r * (b - a), d = a + r * (b - a), fc = at(c), fd = at(d);
    while (b - a > 1e-5) {
      if (fc > fd) { b = d; d = c; fd = fc; c = b - r * (b - a); fc = at(c); }
      else { a = c; c = d; fc = fd; d = a + r * (b - a); fd = at(d); }
    }
    const x = (a + b) / 2, fx = at(x);
    if (fx > max) { max = fx; maxDeg = x; }
  }
  // the righting arm at the downflooding angle (with the maximum before it, the arm a heeling moment must overcome to
  // flood the body; worstHeelRange compares directions by it)
  let gzFlood = null;
  if (flood !== null && n > 1) {
    if (at) gzFlood = flood > 0 ? at(flood) : 0;
    else { let k = 1; while (k < n - 1 && curve[k].deg < flood) k++; const a = curve[k - 1], b = curve[k]; gzFlood = a.gz + (b.gz - a.gz) * (flood - a.deg) / ((b.deg - a.deg) || 1); }
  }
  return { max, maxDeg, vanish, loll, unstable, neutral, flood, end, gzFlood };
}

// GZ curve and its summary in one call, with the summary's crossings and maximum refined on the curve itself.
// opts: { freeTrim, GM (about this axis, for the unstable test), angles, open (opening points relative to G, as
// relTris), refineMax }. With openings, the angle where the first one goes under water (downflooding angle) is found
// by regula falsi to 1e-9° and ends the range of stability; it is 0 when an opening is under water at the start.
export function gzAnalysis(relTris, targetV, axis = 'x', opts = {}) {
  const angles = opts.angles || Array.from({ length: 37 }, (_, i) => i * 5);
  const scale = sizeOf(relTris);
  const o = { freeTrim: !!opts.freeTrim, buf: new Float64Array(relTris.length), scale, open: opts.open || null };
  const curve = gzCurve(relTris, targetV, axis, angles, o);
  const near = (deg) => curve.reduce((m, p) => (Math.abs(p.deg - deg) < Math.abs(m.deg - deg) ? p : m));
  const ev = (deg) => { const nb = near(deg); return gzAt(relTris, targetV, axis, deg, { ...o, trim0: nb.trim, noScan: !!nb.trimUnstable }); };
  const at = (deg) => ev(deg).gz;
  let flood = null;
  if (o.open && o.open.length) {
    const tol = 1e-9 * scale, wet = (p) => p.status === 'floats' && p.open > tol;
    const i = curve.findIndex(wet);
    if (i === 0) flood = curve[0].deg;
    else if (i > 0) {
      // regula falsi on the depth of the lowest opening point below the waterline
      let x0 = curve[i - 1].deg, f0 = curve[i - 1].open - tol, x1 = curve[i].deg, f1 = curve[i].open - tol, c = x1;
      for (let it = 0; it < 80 && x1 - x0 > 1e-9; it++) {
        c = (x0 * f1 - x1 * f0) / (f1 - f0);
        if (!(c > x0 && c < x1)) c = (x0 + x1) / 2;
        const fc = ev(c).open - tol;
        if (fc > 0) { x1 = c; f1 = fc; f0 /= 2; } else { x0 = c; f0 = fc; f1 /= 2; }
      }
      flood = x1;
    }
  }
  return { curve, summary: gzSummary(curve, { GM: opts.GM ?? null, at, scale, flood, refineMax: opts.refineMax !== false }), freeTrim: o.freeTrim };
}

// The worst heel direction. Large-angle stability depends on the direction of heel even when the waterplane's
// principal moments are equal (a square or hexagonal waterplane has no weakest axis, yet its range of stability varies
// with direction), so the range is taken over every direction, not only about the weakest waterplane axis.
// evalDirs(list of heel-axis angles in degrees from x) → Promise of gzSummary results, in order. The directions are the
// weakest axis az0 and every `step` degrees round from it (both heel senses); each objective's best direction is then
// refined `rounds` times on a grid a third as wide each time. Two objectives:
//   capsize: the earliest vanishing angle over every direction;
//   flood:   for a mesh with openings, the direction that floods with the least heeling moment: the smallest largest
//            righting arm before the downflooding angle (the arm a steady heeling moment must overcome to get there;
//            the weight is the same in every direction), among the directions that flood before they capsize.
// The range ends at the earlier of the two angles. Ties go to the direction found first, so the weakest axis wins a
// tie. Returns the summary of the deciding direction with { az (degrees from x, in (−180°, 180°]), weakest (az is the
// weakest axis or its reverse), dirs (directions tried), end, byFlood (the range ends at that direction's downflooding
// angle), floodAny ({ az, flood }: the earliest downflooding angle over every direction tried, or null) }.
export async function worstHeelRange(evalDirs, az0, { step = 15, rounds = 7 } = {}) {
  const keys = {
    capsize: (s) => s.vanish ?? Infinity,
    flood: (s) => (s.flood != null && s.flood <= (s.vanish ?? Infinity) ? Math.max(0, isFinite(s.max) ? s.max : 0, s.gzFlood ?? 0) : Infinity),
  };
  let floodAny = null, tried = 0;
  const seen = (az, s) => { if (s.flood != null && (!floodAny || s.flood < floodAny.flood - 1e-9)) floodAny = { az, flood: s.flood }; };
  const dirs = Array.from({ length: Math.round(360 / step) }, (_, k) => az0 + k * step);
  const sums = await evalDirs(dirs);
  tried += dirs.length;
  dirs.forEach((az, k) => seen(az, sums[k]));
  // refine only when the objective differs between directions (not, say, a box whose range is 90° every way)
  const differ = (a, b) => (isFinite(a) || isFinite(b)) && !(Math.abs(a - b) <= 1e-6);
  const best = {};
  for (const [name, key] of Object.entries(keys)) {
    let b = { az: dirs[0], s: sums[0], k: key(sums[0]) }, spread = false;
    for (let k = 1; k < dirs.length; k++) {
      const kk = key(sums[k]);
      if (differ(kk, key(sums[0]))) spread = true;
      if (kk < b.k - 1e-6 * Math.max(1, Math.abs(b.k))) b = { az: dirs[k], s: sums[k], k: kk };
    }
    for (let r = 0, w = step; spread && r < rounds && isFinite(b.k); r++, w /= 3) {
      const list = [-2, -1, 1, 2].map((j) => b.az + j * w / 3);
      const ss = await evalDirs(list);
      tried += list.length;
      for (let k = 0; k < list.length; k++) { seen(list[k], ss[k]); const kk = key(ss[k]); if (kk < b.k - 1e-6 * Math.max(1, Math.abs(b.k))) b = { az: list[k], s: ss[k], k: kk }; }
    }
    best[name] = b;
  }
  const vC = best.capsize.s.vanish ?? Infinity, fF = isFinite(best.flood.k) ? best.flood.s.flood : Infinity;
  const byFlood = fF < vC;
  const w = byFlood ? best.flood : best.capsize;
  const end = Math.min(vC, fF);
  const norm = (a) => { const x = ((a % 360) + 540) % 360 - 180 || 0; return x === -180 ? 180 : x; };
  const rel = (((w.az - az0) % 180) + 180) % 180;
  return {
    ...w.s, az: norm(w.az), weakest: rel < 1e-9 || 180 - rel < 1e-9, dirs: tried, end: isFinite(end) ? end : null, byFlood,
    floodAny: floodAny ? { az: norm(floodAny.az), flood: floodAny.flood } : null,
  };
}

// The range of stability the verdict reports (stabilityVerdict's opts.range), from GZ analyses run by
// run(jobs) → Promise of gzSummary results; a job is { axis, GM, open (use the mesh's openings), refineMax }.
// For a stable body (GM_min above the round-off band of opts.scale): worstHeelRange over every direction, the deciding
// direction run again with its maximum refined. An open hull that floods early when inclined about its long, stiff axis
// (nearer pitch) needs a large heeling moment to get there, so that flooding does not end the range (review R1-28: the
// IS Code's downflooding angle is "an angle of heel", MSC.267(85) A 2.2.1, footnote 5); it is reported as a note
// (floodAny) when it comes earlier. opts.sweep false (no workers in the app): only the weakest axis, both senses.
// For an unstable or neutral body: the worse sense about the weakest axis (its loll angle).
export async function verdictRange(H, run, { scale = 1, sweep = true } = {}) {
  const worse = (a, b) => {
    if (a.unstable) return (b.loll ?? Infinity) < (a.loll ?? Infinity) ? b : a;
    const va = a.end ?? Infinity, vb = b.end ?? Infinity;
    if (va !== vb) return vb < va ? b : a;
    return b.maxDeg < a.maxDeg ? b : a;
  };
  if (!(H.GMmin > 1e-9 * scale) || !sweep) {
    const [a, b] = await run([0, 180].map((o) => ({ axis: H.axisMinDeg + o, GM: H.GMmin, open: true, refineMax: true })));
    return worse(a, b);
  }
  const w = await worstHeelRange((azs) => run(azs.map((az) => ({ axis: az, GM: gmAbout(H, az), open: true, refineMax: false }))), H.axisMinDeg);
  const [full] = await run([{ axis: w.az, GM: gmAbout(H, w.az), open: w.byFlood, refineMax: true }]);
  const floodAny = w.floodAny && w.floodAny.flood < (full.end ?? Infinity) - 1e-6 ? w.floodAny : null;
  return { ...full, az: w.az, weakest: w.weakest, dirs: w.dirs, floodAny };
}

// ---------- static equilibrium (rest attitude) ----------
// Turn the body about horizontal world axes through G until B is directly under G at the displacement targetV:
// Newton on the two tilt angles with a finite-difference Jacobian and a backtracking step. Yaw is left alone (it does
// not change the hydrostatics). bodyTris: relative to G in the body frame; R0: start attitude (world ← body).
// Returns { R, offset (B–G horizontal distance, m), converged, iterations }.
export function restAttitude(bodyTris, targetV, R0, { tol = 1e-9, maxIter = 40, maxTurn = 0.1 } = {}) {
  const buf = new Float64Array(bodyTris.length);
  const size = sizeOf(bodyTris);
  const res = (R) => {
    transformTris(bodyTris, R, [0, 0, 0], [0, 0, 0], buf);
    const s = solveWaterline(buf, targetV);
    return s.status === 'floats' ? [s.sub.B[0], s.sub.B[1]] : null;
  };
  let R = R0, r = res(R0), it = 0;
  if (!r) return { R: R0, offset: NaN, converged: false, iterations: 0 };
  const h = 1e-5;
  for (; it < maxIter; it++) {
    const nr = Math.hypot(r[0], r[1]);
    if (nr <= tol * size) return { R, offset: nr, converged: true, iterations: it };
    const rx = res(mat3.mul(mat3.rotX(h), R)), ry = res(mat3.mul(mat3.rotY(h), R));
    if (!rx || !ry) break;
    const J = [(rx[0] - r[0]) / h, (ry[0] - r[0]) / h, (rx[1] - r[1]) / h, (ry[1] - r[1]) / h];
    const det = J[0] * J[3] - J[1] * J[2];
    if (!(Math.abs(det) > 0)) break;
    let a = -(J[3] * r[0] - J[1] * r[1]) / det, b = -(-J[2] * r[0] + J[0] * r[1]) / det;
    const m = Math.hypot(a, b);
    if (m > maxTurn) { a *= maxTurn / m; b *= maxTurn / m; }
    let step = 1, Rn = null, rn = null;
    for (let k = 0; k < 12; k++, step /= 2) {
      const Rt = mat3.mul(mat3.rotY(b * step), mat3.mul(mat3.rotX(a * step), R));
      const rt = res(Rt);
      if (rt && Math.hypot(rt[0], rt[1]) < nr) { Rn = Rt; rn = rt; break; }
    }
    if (!rn) break;
    R = Rn; r = rn;
  }
  const off = Math.hypot(r[0], r[1]);
  return { R, offset: off, converged: off <= tol * size, iterations: it };
}

// Edges that are open or wound against their neighbour (0 = closed and consistently oriented); see js/meshcheck.js.
export function openEdgeCount(tris, tol) { const c = meshCheck(tris, tol); return c.open + c.misoriented; }

// ---------- plain-language stability verdict ----------
// GM: metacentric height about the weakest waterplane axis (GM_min). opts.range: the GZ summary that sets the range
// of stability, or null while it is being computed: for a stable body the worst heel direction (worstHeelRange, with
// az, weakest and dirs), otherwise the worse sense about the weakest axis. opts.scale: body size (m), sets the round-off
// band in which GM counts as zero. opts.freeTrim: which GZ the range came from.
// Small-angle words come from GM alone. Large-angle words come from the GZ curve: "self-righting" only when GZ stays
// positive to 180°; the range ends at the vanishing angle or, for a mesh with openings, where an opening goes under
// water (downflooding angle), whichever comes first. Two IMO intact stability criteria (2008 IS Code, MSC.267(85)) that
// are angles, so they hold at any size, are checked: the range is called small when it ends before 30°, where Part A
// 2.2.2 asks for a righting arm of at least 0.2 m; and an early peak, before 25° (A 2.2.3), is noted.
export function stabilityVerdict(GM, opts = {}) {
  const { range = null, scale = 1, freeTrim = false } = opts;
  const trim = freeTrim ? 'free trim' : 'fixed trim';
  const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '').replace(/^-0$/, '0');
  if (!isFinite(GM)) return { level: 'na', text: 'No waterplane — body is fully submerged or out of the water.' };
  if (GM < -1e-9 * scale) {
    return {
      level: 'bad',
      text: `Unstable: the metacentre is below the CoG about the weakest waterplane axis, so any small disturbance grows and the body turns to a different floating attitude.${range && range.loll !== null
        ? ` About that axis the righting arm (${trim}) turns positive again at about ${f1(range.loll)}°; the 3D resting attitude can differ, so use Settle to find it.` : ' Use Settle to find where it comes to rest.'}`,
    };
  }
  if (GM <= 1e-9 * scale) return { level: 'warn', text: 'Neutral: GM about the weakest waterplane axis is zero (to round-off), so there is no righting stiffness about it at small angles and the attitude can drift.' };
  if (!range) return { level: 'good', text: 'Stable at small angles: the metacentre is above the CoG about every horizontal axis. The range of stability is being worked out from the GZ curves.' };
  const about = range.dirs
    ? (range.weakest ? 'About the weakest axis, the worst of all heel directions' : `About the axis at ${f1(range.az)}° from x, the worst of all heel directions`)
    : 'About the weakest axis';
  const end = range.end !== undefined ? range.end : range.vanish;
  const flooded = range.flood !== null && range.flood !== undefined && end === range.flood;
  const fa = range.floodAny;
  const peak = (range.max > 0 && range.maxDeg < 25 ? ` The righting arm peaks early, at ${f1(range.maxDeg)}°: the IMO intact stability code asks for the peak at 25° or more (2008 IS Code A 2.2.3).` : '')
    + (fa ? ` Inclined about the axis at ${f1(fa.az)}° from x, an opening goes under water sooner, at ${f1(fa.flood)}°, but it takes a larger heeling moment to get there, so the range ends where it floods with the least.` : '');
  if (end === null) return { level: 'good', text: `Stable and self-righting: the metacentre is above the CoG about every horizontal axis, and the righting arm (${trim}) stays positive all the way to 180°${range.dirs ? ' in every heel direction' : ' about the weakest axis'}.${peak}` };
  if (flooded && end <= 0) return { level: 'bad', text: 'An opening in the mesh is under water at this attitude, so water comes in: these hydrostatics treat the body as closed and do not apply.' };
  const ends = flooded ? `an opening goes under water at ${f1(end)}° (the downflooding angle), where the range of stability ends` : `vanishes at ${f1(end)}°`;
  if (end < 30) {
    return {
      level: 'ok',
      text: `Stable at small angles, but the range is small. ${about} (${trim}), the righting arm peaks at ${f1(range.maxDeg)}° and ${ends}, so a heel past ${f1(end)}° ${flooded ? 'floods' : 'capsizes'} it. The IMO intact stability code asks for a righting arm of at least 0.2 m at 30° or more (2008 IS Code A 2.2.2), which a range ending before 30° cannot give.${peak}`,
    };
  }
  return { level: 'good', text: `Stable: the metacentre is above the CoG about every horizontal axis. ${about} (${trim}), the righting arm peaks at ${f1(range.maxDeg)}° and ${ends}; ${flooded ? 'past that, water comes in and these hydrostatics no longer apply' : 'heeled past that, the body capsizes'}.${peak}` };
}
