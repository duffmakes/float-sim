"""Python port of js/physics.js (submerged / solve / hydrostatics / GZ) for offline cross-checks.
Same algorithm, line for line, so it shows whether the method gives the textbook answers."""
import math


def mat_mul(a, b):
    return [sum(a[i * 3 + k] * b[k * 3 + j] for k in range(3)) for i in range(3) for j in range(3)]


def rotX(a): c, s = math.cos(a), math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]
def rotY(a): c, s = math.cos(a), math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]
def rotZ(a): c, s = math.cos(a), math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]


def from_euler_deg(r, p, y):
    d = math.pi / 180
    return mat_mul(rotZ(y * d), mat_mul(rotY(p * d), rotX(r * d)))


def transform(tris, R, origin=(0, 0, 0)):
    o = []
    for i in range(0, len(tris), 3):
        x, y, z = tris[i] - origin[0], tris[i + 1] - origin[1], tris[i + 2] - origin[2]
        o += [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z]
    return o


def volume(t):
    V = 0
    for i in range(0, len(t), 9):
        ax, ay, az, bx, by, bz, qx, qy, qz = t[i:i + 9]
        V += (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6
    return V


def submerged(tris, zw):
    V = mx = my = mz = 0
    A = Ax = Ay = Ixx = Iyy = Ixy = 0
    for i in range(0, len(tris), 9):
        zs = [tris[i + 2] - zw, tris[i + 5] - zw, tris[i + 8] - zw]
        inside = [z < 0 for z in zs]
        nIn = sum(inside)
        if nIn == 0:
            continue
        P = []; en = ex = None
        if nIn == 3:
            P = [(tris[i + 3 * k], tris[i + 3 * k + 1], zs[k]) for k in range(3)]
        else:
            for a in range(3):
                b = (a + 1) % 3
                ia, ib = i + a * 3, i + b * 3
                za, zb = zs[a], zs[b]
                if inside[a]:
                    P.append((tris[ia], tris[ia + 1], za))
                if inside[a] != inside[b]:
                    t = za / (za - zb)
                    x = tris[ia] + t * (tris[ib] - tris[ia]); y = tris[ia + 1] + t * (tris[ib + 1] - tris[ia + 1])
                    P.append((x, y, 0))
                    if inside[a]: ex = (x, y)
                    else: en = (x, y)
        for k in range(1, len(P) - 1):
            (ax, ay, az), (bx, by, bz), (cx, cy, cz) = P[0], P[k], P[k + 1]
            det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
            V += det; mx += det * (ax + bx + cx); my += det * (ay + by + cy); mz += det * (az + bz + cz)
        if en and ex:
            (x0, y0), (x1, y1) = en, ex
            c = x0 * y1 - x1 * y0
            A += c; Ax += (x0 + x1) * c; Ay += (y0 + y1) * c
            Iyy += (x0 * x0 + x0 * x1 + x1 * x1) * c
            Ixx += (y0 * y0 + y0 * y1 + y1 * y1) * c
            Ixy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c
    V /= 6
    B = (mx / (24 * V), my / (24 * V), mz / (24 * V) + zw) if V > 1e-15 else (0, 0, zw)
    A /= 2
    if abs(A) < 1e-15:
        return dict(V=V, B=B, A=0, Ixx=0, Iyy=0)
    cxw, cyw = Ax / (6 * A), Ay / (6 * A)
    return dict(V=V, B=B, A=A, Ixx=Ixx / 12 - A * cyw ** 2, Iyy=Iyy / 12 - A * cxw ** 2)


def solve(tris, target):
    zs = tris[2::3]; lo, hi = min(zs), max(zs)
    total = volume(tris)
    if target >= total:
        return hi, 'sinks'
    for _ in range(100):
        m = (lo + hi) / 2
        if submerged(tris, m)['V'] < target: lo = m
        else: hi = m
    return (lo + hi) / 2, 'floats'


def hydrostatics(rel, zw):
    s = submerged(rel, zw)
    zmin = min(rel[2::3])
    V, B = s['V'], s['B']
    BMt, BMl = s['Ixx'] / V, s['Iyy'] / V
    return dict(V=V, B=B, Awp=s['A'], draft=zw - zmin, KB=B[2] - zmin, BMt=BMt, BMl=BMl,
                GMt=B[2] + BMt, GMl=B[2] + BMl, offset=math.hypot(B[0], B[1]))


def gz(rel, V, axis, deg):
    R = rotX(math.radians(deg)) if axis == 'x' else rotY(math.radians(deg))
    t = transform(rel, R)
    zw, _ = solve(t, V)
    B = submerged(t, zw)['B']
    return -B[1] if axis == 'x' else B[0]
