// Buoyancy / hydrostatics math. Pure functions, no rendering dependencies.
// Geometry is a "triangle soup": Float64Array, 9 numbers (3 xyz vertices) per triangle,
// outward-facing counter-clockwise winding, SI metres. Z is up, the water surface is the plane z = zw.

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
  toEulerDeg(m) {
    const d = 180 / Math.PI;
    const sp = -m[6];
    if (Math.abs(sp) < 0.999999) {
      return [Math.atan2(m[7], m[8]) * d, Math.asin(sp) * d, Math.atan2(m[3], m[0]) * d];
    }
    // gimbal lock
    return [Math.atan2(-m[5], m[4]) * d, (sp > 0 ? 90 : -90), 0];
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
// Returns volume, centroid and inertia tensor about the centroid (per unit density).
export function massProperties(tris) {
  let V = 0, cx = 0, cy = 0, cz = 0;
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0]; // covariance ∫ x xᵀ dV about origin
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
    const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
    const qx = tris[i + 6], qy = tris[i + 7], qz = tris[i + 8];
    const det = ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
    V += det / 6;
    const sx = ax + bx + qx, sy = ay + by + qy, sz = az + bz + qz;
    cx += det * sx / 24; cy += det * sy / 24; cz += det * sz / 24;
    const v = [[ax, ay, az], [bx, by, bz], [qx, qy, qz]], s = [sx, sy, sz];
    const k = det / 120;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
      C[r * 3 + c] += k * (v[0][r] * v[0][c] + v[1][r] * v[1][c] + v[2][r] * v[2][c] + s[r] * s[c]);
  }
  const cen = V !== 0 ? [cx / V, cy / V, cz / V] : [0, 0, 0];
  // shift covariance to centroid, then I = tr(C)·Id − C
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] -= V * cen[r] * cen[c];
  const tr = C[0] + C[4] + C[8];
  const I = C.map((x, idx) => (idx % 4 === 0 ? tr : 0) - x);
  return { volume: V, centroid: cen, inertia: I };
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
  if (targetV >= total) return { zw: hi, sub: submerged(tris, hi + 1e-9), status: 'sinks', total };
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
  const axisMinDeg = 0.5 * Math.atan2(-2 * wp.Ixy, wp.Ixx - wp.Iyy) * 180 / Math.PI;
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
  };
}

// Righting-arm (GZ) curve at fixed trim: heel the body about a horizontal world axis through G.
// axis: 'x' (roll) or 'y' (pitch). Positive GZ = righting.
export function gzCurve(relTris, targetV, axis = 'x', angles = null) {
  angles = angles || Array.from({ length: 37 }, (_, i) => i * 5);
  const buf = new Float64Array(relTris.length);
  const out = [];
  for (const deg of angles) {
    const R = axis === 'x' ? mat3.rotX(deg * Math.PI / 180) : mat3.rotY(deg * Math.PI / 180);
    transformTris(relTris, R, [0, 0, 0], [0, 0, 0], buf);
    const s = solveWaterline(buf, targetV);
    const B = s.sub.B;
    const gz = axis === 'x' ? -B[1] : B[0];
    out.push({ deg, gz, status: s.status });
  }
  return out;
}

// curve[0] is the start attitude (GZ ≈ 0, sign is round-off), so crossings are searched from curve[1] on.
// unstable: GZ negative right away. loll: first − → + crossing, i.e. where an unstable body comes to rest.
export function gzSummary(curve) {
  let max = -Infinity, maxDeg = 0, vanish = null, loll = null;
  const cross = (a, b) => a.deg + (b.deg - a.deg) * a.gz / (a.gz - b.gz);
  for (let i = 1; i < curve.length; i++) {
    const p = curve[i];
    if (p.gz > max) { max = p.gz; maxDeg = p.deg; }
    if (i < 2) continue;
    const a = curve[i - 1];
    if (vanish === null && a.gz > 0 && p.gz <= 0) vanish = cross(a, p);
    if (loll === null && a.gz < 0 && p.gz >= 0) loll = cross(a, p);
  }
  return { max, maxDeg, vanish, loll, unstable: curve.length > 1 && curve[1].gz <= 0 };
}

// Open-edge check (is the mesh watertight?). Quantizes vertex positions and counts edges
// not shared by exactly two triangles.
export function openEdgeCount(tris, tol) {
  const key = (i) => `${Math.round(tris[i] / tol)},${Math.round(tris[i + 1] / tol)},${Math.round(tris[i + 2] / tol)}`;
  const ids = new Map(); let next = 0;
  const vid = (i) => { const k = key(i); let v = ids.get(k); if (v === undefined) { v = next++; ids.set(k, v); } return v; };
  const edges = new Map();
  for (let i = 0; i < tris.length; i += 9) {
    const a = vid(i), b = vid(i + 3), c = vid(i + 6);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (p === q) continue;
      const k = p < q ? p * 4294967296 + q : q * 4294967296 + p;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) if (n !== 2) open++;
  return open;
}

// Plain-language stability verdict.
export function stabilityVerdict(GM, beam) {
  if (!isFinite(GM)) return { level: 'na', text: 'No waterplane — body is fully submerged or out of the water.' };
  const r = beam > 0 ? GM / beam : 0;
  if (GM < 0) return { level: 'bad', text: 'Unstable: the metacentre is below the CoG. Any small disturbance grows and the body will roll/flip to a different floating attitude.' };
  if (r < 0.02) return { level: 'warn', text: 'Marginal / neutral: GM is very small. The body has almost no initial righting stiffness and will loll or drift in attitude.' };
  if (r < 0.06) return { level: 'ok', text: 'Stable but tender: positive GM with a slow, gentle roll. Sensitive to off-centre loads.' };
  if (r < 0.2) return { level: 'good', text: 'Stable: healthy positive GM. Comfortable righting response.' };
  return { level: 'good', text: 'Very stiff: large GM. Strongly self-righting, with a quick, snappy roll period.' };
}
