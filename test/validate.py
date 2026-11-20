"""Run every case in test/models/expected.json through the Python port of the float solver,
using the same solids the STEP files were written from, and compare with the closed-form answers.
    python3 test/validate.py
(The browser harness test/validate.html runs the real JS + STEP-import pipeline on the .step files.)"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import pyhydro as H  # noqa: E402
from make_models import solids  # noqa: E402
from stepgen import Cylinder  # noqa: E402

exp = json.load(open(os.path.join(os.path.dirname(__file__), 'models', 'expected.json')))
REL_FLAT, REL_CURVED = 1e-6, 2e-4   # curved: 720-facet Python tessellation
fails, total = 0, 0


def check(label, got, want, rel, absfloor=1e-6):
    global fails, total
    total += 1
    if isinstance(want, bool) or isinstance(want, str):
        ok = got == want
        txt = f"{got}"
        wtxt = f"{want}"
    else:
        err = abs(got - want)
        ok = err <= max(rel * abs(want), absfloor)
        txt, wtxt = f"{got:.6f}", f"{want:.6f}"
    if not ok:
        fails += 1
    print(f"   {'PASS' if ok else 'FAIL'}  {label:<12} {txt:>14}   expected {wtxt:>12}")


file_to_solid = {f"{k}.step": v for k, v in solids.items()}
for c in exp['cases']:
    print(f"\n■ {c['id']}: {c['title']}\n   ref: {c['ref']}")
    S = file_to_solid[c['file']]
    tris = S.tris(720) if isinstance(S, Cylinder) else S.tris()
    rel_tol = REL_CURVED if c['curved'] else REL_FLAT
    R = H.from_euler_deg(*c['euler'])
    G = c['cog']
    rel = H.transform(tris, R, G)
    V = c['mass'] / c['rho']
    zw, status = H.solve(rel, V)
    e = c['expect']
    check('status', status, e['status'], 0)
    if status == 'sinks':
        continue
    h = H.hydrostatics(rel, zw)
    for k in ('V', 'draft', 'Awp', 'KB', 'BMt', 'BMl', 'GMt', 'GMl'):
        if k in e:
            check(k, h[k], e[k], rel_tol)
    if 'offset' in e:
        check('B–G offset', h['offset'], 0.0, 0, 2e-5 if c['curved'] else 1e-6)
    if 'stable' in e:
        check('stable', h['GMt'] > 0 and h['GMl'] > 0, e['stable'], 0)
    if 'kg_per_cm' in e:
        check('kg/cm', c['rho'] * h['Awp'] / 100, e['kg_per_cm'], rel_tol)
    if 'B_model' in e:
        RT = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]
        b = h['B']
        bm = [RT[i * 3] * b[0] + RT[i * 3 + 1] * b[1] + RT[i * 3 + 2] * b[2] + G[i] for i in range(3)]
        for i, ax in enumerate('xyz'):
            check(f'B_model.{ax}', bm[i], e['B_model'][i], rel_tol)
    if 'gz' in c:
        for deg, want in c['gz']['points']:
            check(f'GZ({deg}°)', H.gz(rel, h['V'], c['gz']['axis'], deg), want, max(rel_tol, 1e-5), 2e-5)
    if 'target' in c:
        t = c['target']
        if t['mode'] == 'draft':
            zt = min(rel[2::3]) + t['value']
        else:
            zt, _ = H.solve(rel, H.volume(rel) * t['value'] / 100)
        ht = H.hydrostatics(rel, zt)
        check('target mass', c['rho'] * ht['V'], t['mass'], rel_tol)
        if 'draft' in t:
            check('target T', ht['draft'], t['draft'], rel_tol)

print(f"\n{total - fails}/{total} checks passed")
sys.exit(1 if fails else 0)
