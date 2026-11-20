"""Line-for-line port of js/sim.js (FloatSim) and the inertia routine, run on the dynamic cases in
expected.json: release the body and check that it settles at the textbook attitude.
    python3 test/simcheck.py"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import pyhydro as H  # noqa: E402
from make_models import solids  # noqa: E402


def mm3(a, b): return H.mat_mul(a, b)
def tr(a): return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]
def app(m, v): return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]


def inv(m):
    a, b, c, d, e, f, g, h, i = m
    A, B_, C = e * i - f * h, -(d * i - f * g), d * h - e * g
    k = 1 / (a * A + b * B_ + c * C)
    return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B_ * k, (a * i - c * g) * k, -(a * f - c * d) * k,
            C * k, -(a * h - b * g) * k, (a * e - b * d) * k]


def mass_props(t):
    V = cx = cy = cz = 0; C = [0] * 9
    for i in range(0, len(t), 9):
        a, b, q = t[i:i + 3], t[i + 3:i + 6], t[i + 6:i + 9]
        det = a[0] * (b[1] * q[2] - b[2] * q[1]) - a[1] * (b[0] * q[2] - b[2] * q[0]) + a[2] * (b[0] * q[1] - b[1] * q[0])
        V += det / 6
        s = [a[k] + b[k] + q[k] for k in range(3)]
        cx += det * s[0] / 24; cy += det * s[1] / 24; cz += det * s[2] / 24
        for r in range(3):
            for c in range(3):
                C[r * 3 + c] += det / 120 * (a[r] * a[c] + b[r] * b[c] + q[r] * q[c] + s[r] * s[c])
    cen = [cx / V, cy / V, cz / V]
    for r in range(3):
        for c in range(3):
            C[r * 3 + c] -= V * cen[r] * cen[c]
    trc = C[0] + C[4] + C[8]
    return V, cen, [(trc if k % 4 == 0 else 0) - C[k] for k in range(9)]


def inertia_about(V, cen, I, mass, p):
    k = mass / V; d = [cen[i] - p[i] for i in range(3)]; d2 = sum(x * x for x in d)
    return [k * I[r * 3 + c] + mass * ((d2 if r == c else 0) - d[r] * d[c]) for r in range(3) for c in range(3)]


def quat_to_mat(q):
    x, y, z, w = q
    return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z),
            2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]


def mat_to_quat(m):  # trace > 0 branch suffices for the start attitudes used here
    s = 0.5 / math.sqrt(m[0] + m[4] + m[8] + 1)
    return [(m[7] - m[5]) * s, (m[2] - m[6]) * s, (m[3] - m[1]) * s, 0.25 / s]


def euler_deg(m):
    return [math.degrees(math.atan2(m[7], m[8])), math.degrees(math.asin(-m[6])), math.degrees(math.atan2(m[3], m[0]))]


class FloatSim:
    def __init__(self, b, mass, Ib, rho, q0, z0, zeta, awp, g=9.80665):
        self.b, self.m, self.Ib, self.rho, self.g = b, mass, Ib, rho, g
        self.q, self.p, self.v, self.w, self.t, self.zeta = list(q0), [0, 0, z0], [0, 0, 0], [2e-3, 1e-3, 0], 0, zeta  # same kick as sim.js
        self.wn = math.sqrt(rho * g * awp / mass)
        Imin = min(Ib[0], Ib[4], Ib[8])
        wr = math.sqrt(rho * g * awp * awp / Imin)
        self.dt = min(0.02, 1 / (30 * max(self.wn, wr, 1e-3)))

    def step(self, dt):
        R = quat_to_mat(self.q)
        world = H.transform(self.b, R)
        world = [world[i] + self.p[i % 3] for i in range(len(world))]
        s = H.submerged(world, 0)
        Fb = self.rho * self.g * s['V']
        d = 2 * self.zeta * self.wn
        F = [-d * self.m * self.v[0], -d * self.m * self.v[1], Fb - self.m * self.g - d * self.m * self.v[2]]
        r = [s['B'][k] - self.p[k] for k in range(3)]
        Iw = mm3(R, mm3(self.Ib, tr(R)))
        Iww = app(Iw, self.w)
        tau = [r[1] * Fb, -r[0] * Fb, 0] if s['V'] > 0 else [0, 0, 0]
        tau = [tau[k] - d * Iww[k] for k in range(3)]
        w = self.w
        gyro = [w[1] * Iww[2] - w[2] * Iww[1], w[2] * Iww[0] - w[0] * Iww[2], w[0] * Iww[1] - w[1] * Iww[0]]
        alpha = app(inv(Iw), [tau[k] - gyro[k] for k in range(3)])
        for k in range(3):
            self.v[k] += F[k] / self.m * dt; self.p[k] += self.v[k] * dt; self.w[k] += alpha[k] * dt
        qx, qy, qz, qw = self.q; wx, wy, wz = self.w; h = 0.5 * dt
        q = [qx + h * (wx * qw + wy * qz - wz * qy), qy + h * (-wx * qz + wy * qw + wz * qx),
             qz + h * (wx * qy - wy * qx + wz * qw), qw + h * (-wx * qx - wy * qy - wz * qz)]
        n = math.sqrt(sum(c * c for c in q)); self.q = [c / n for c in q]
        self.t += dt
        if s['A'] > 0:
            self.wn = math.sqrt(self.rho * self.g * s['A'] / self.m)


exp = json.load(open(os.path.join(os.path.dirname(__file__), 'models', 'expected.json')))
fails = 0
for c in exp['cases']:
    if 'sim' not in c:
        continue
    tris = solids[c['file'][:-5]].tris()
    G, m, rho = c['cog'], c['mass'], c['rho']
    V, cen, I = mass_props(tris)
    Ib = inertia_about(V, cen, I, m, G)
    R0 = H.from_euler_deg(*c['sim']['start_euler'])
    rel0 = H.transform(tris, R0, G)
    zw, _ = H.solve(rel0, m / rho)
    awp = H.submerged(rel0, zw)['A']
    sim = FloatSim(H.transform(tris, [1, 0, 0, 0, 1, 0, 0, 0, 1], G), m, Ib, rho, mat_to_quat(R0), -zw, 0.5, awp)
    settled = None
    while sim.t < 120:
        for _ in range(100):
            sim.step(sim.dt)
        if sim.t > 2 and math.hypot(*sim.v) / 4 + math.hypot(*sim.w) < 1e-6:
            settled = sim.t; break
    e = euler_deg(quat_to_mat(sim.q))
    ok = settled is not None and abs(e[0] - c['sim']['expect_roll']) <= c['sim']['tol_deg'] and abs(e[1]) <= c['sim']['tol_deg']
    fails += not ok
    print(f"{'PASS' if ok else 'FAIL'}  {c['id']}: released at roll {c['sim']['start_euler'][0]}°, settled at t={settled and round(settled, 1)} s, "
          f"roll {e[0]:.3f}° pitch {e[1]:.3f}°  (expected roll {c['sim']['expect_roll']:.3f}°, dt={sim.dt * 1000:.2f} ms)")
sys.exit(1 if fails else 0)
