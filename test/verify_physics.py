"""Line-for-line Python port of js/physics.js `submerged` / `massProperties`, checked against
closed-form hydrostatics. Run:  python3 test/verify_physics.py"""
import math


def box(lx, ly, lz, cx=0, cy=0, cz=0):
    x0, x1, y0, y1, z0, z1 = cx - lx / 2, cx + lx / 2, cy - ly / 2, cy + ly / 2, cz - lz / 2, cz + lz / 2
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    return [c for t in f for i in t for c in v[i]]


def cylinder_x(r, length, n=400):
    """axis along x, centred at origin"""
    out = []
    h = length / 2
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        p0 = (r * math.cos(a0), r * math.sin(a0)); p1 = (r * math.cos(a1), r * math.sin(a1))
        A0, A1, B0, B1 = (-h, *p0), (-h, *p1), (h, *p0), (h, *p1)
        out += [*A0, *A1, *B1, *A0, *B1, *B0]
        out += [-h, 0, 0, *A1, *A0]
        out += [h, 0, 0, *B0, *B1]
    return out


def rot(tris, R):
    o = []
    for i in range(0, len(tris), 3):
        x, y, z = tris[i:i + 3]
        o += [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z]
    return o


def rotX(a):
    c, s = math.cos(a), math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]


def mass_props_volume(t):
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
    B = (mx / (24 * V), my / (24 * V), mz / (24 * V) + zw)
    A /= 2
    cxw, cyw = Ax / (6 * A), Ay / (6 * A)
    return dict(V=V, B=B, A=A, cx=cxw, cy=cyw, Ixx=Ixx / 12 - A * cyw ** 2, Iyy=Iyy / 12 - A * cxw ** 2, Ixy=Ixy / 24 - A * cxw * cyw)


def solve(tris, target):
    zs = tris[2::3]; lo, hi = min(zs), max(zs)
    for _ in range(200):
        m = (lo + hi) / 2
        if submerged(tris, m)['V'] < target: lo = m
        else: hi = m
    return (lo + hi) / 2


def close(a, b, tol=1e-6, label=''):
    ok = abs(a - b) <= tol * max(1, abs(b))
    print(f"  {'OK ' if ok else 'FAIL'} {label}: got {a:.6g}, expected {b:.6g}")
    return ok


ok = True
print('1) 1 m cube, CoG at centre, 500 kg in fresh water')
cube = box(1, 1, 1)  # centred on G
ok &= close(mass_props_volume(cube), 1.0, label='volume')
zw = solve(cube, 0.5)
s = submerged(cube, zw)
ok &= close(zw, 0.0, 1e-9, 'waterline at G (draft 0.5)')
ok &= close(s['B'][2], -0.25, label='B z')
ok &= close(s['A'], 1.0, label='waterplane area')
ok &= close(s['Ixx'], 1 / 12, label='Ixx')
BM = s['Ixx'] / s['V']
ok &= close(BM, 1 / 6, label='BM = B^2/12T')
ok &= close(s['B'][2] + BM, -0.25 + 1 / 6, label='GM (unstable, -0.0833)')

print('2) Barge 4 x 1.6 x 0.8, draft 0.3, G 0.5 above keel')
barge = box(4, 1.6, 0.8, 0, 0, 0.4 - 0.5)
zw = solve(barge, 4 * 1.6 * 0.3)
s = submerged(barge, zw)
ok &= close(zw + 0.5, 0.3, 1e-9, 'draft')
ok &= close(s['Ixx'], 4 * 1.6 ** 3 / 12, label='Ixx (roll)')
ok &= close(s['Iyy'], 1.6 * 4 ** 3 / 12, label='Iyy (pitch)')
ok &= close(s['Ixy'], 0, 1e-9, label='Ixy')
GMt = s['B'][2] + s['Ixx'] / s['V']
ok &= close(GMt, 0.15 + 1.6 ** 2 / (12 * 0.3) - 0.5, label='GM_T')

print('3) Same barge heeled 10 deg: B shifts toward the low side (righting)')
h = rot(barge, rotX(math.radians(10)))
zw = solve(h, 4 * 1.6 * 0.3)
s = submerged(h, zw)
GZ = -s['B'][1]
print(f"  GZ(10deg) = {GZ:.4f} m  (GM*sin10 = {GMt * math.sin(math.radians(10)):.4f})")
ok &= GZ > 0 and abs(GZ - GMt * math.sin(math.radians(10))) < 0.02

print('4) Cylinder r=0.2 L=3, half submerged')
cyl = cylinder_x(0.2, 3)
Vt = mass_props_volume(cyl)
zw = solve(cyl, Vt / 2)
s = submerged(cyl, zw)
ok &= close(zw, 0, 1e-6, 'waterline through axis')
ok &= close(s['B'][2], -4 * 0.2 / (3 * math.pi), 1e-3, 'B z = -4r/3pi')
ok &= close(s['A'], 3 * 0.4, 1e-4, 'waterplane area')
ok &= close(s['Ixx'] / s['V'], (3 * 0.4 ** 3 / 12) / (math.pi * 0.04 * 3 / 2), 1e-3, 'BM_T')
# metacentre of a circular section is at the axis: KB + BM = r
ok &= close(s['B'][2] + s['Ixx'] / s['V'], 0.0, 1e-3, 'M_T on cylinder axis')

print('\nALL PASSED' if ok else '\nSOME CHECKS FAILED')
