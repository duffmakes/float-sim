"""Extract WAMIT reference coefficients (added mass, damping, exciting force) into compact JSON.

Source runs: WEC-Sim BEMIO examples (https://github.com/WEC-Sim/WEC-Sim, examples/BEMIO/WAMIT, Apache-2.0),
WAMIT v7 low-order panel method with irregular-frequency removal (IRR=1).  WAMIT numeric outputs are
non-dimensional with L = 1 m:  A_ij = Ā ρ,  B_ij = B̄ ρ ω,  X_i = X̄ ρ g (per unit wave amplitude), with the
moments (i ≥ 4) about the body origin.  Usage:  python3 -I test/wamit_extract.py <dir with name.1 .3 .hst .out> <name> <wmax> <out.json>

Runs published without the .out file (OpenFAST r-test HydroData, https://github.com/OpenFAST/r-test, Apache-2.0) take the
water depth, gravity and a source note on the command line instead:
    python3 -I test/wamit_extract.py <dir> <name> <wmax> <out.json> <depth m | inf> <g> "<source>"
"""
import json, math, os, re, sys

src, name, wmax, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
KEEP = [(1, 1), (1, 5), (5, 1), (5, 5), (2, 2), (2, 4), (4, 2), (4, 4), (3, 3), (6, 6)]
A, B, X = {}, {}, {}
A0, Ainf = {}, {}
for line in open(f'{src}/{name}.1'):
    p = line.split()
    if len(p) < 4 or not re.match(r'^-?\d', p[0]): continue
    per, i, j, a = float(p[0]), int(p[1]), int(p[2]), float(p[3])
    if (i, j) not in KEEP: continue
    if per == -1: A0[f'{i}{j}'] = a; continue
    if per == 0: Ainf[f'{i}{j}'] = a; continue
    w = round(2 * math.pi / per, 6)
    A.setdefault(w, {})[f'{i}{j}'] = a
    B.setdefault(w, {})[f'{i}{j}'] = float(p[4]) * w        # B̄ is B/(ρω)
for line in open(f'{src}/{name}.3'):
    p = line.split()
    if len(p) < 7 or not re.match(r'^-?\d', p[0]): continue
    per, beta, i = float(p[0]), float(p[1]), int(p[2])
    if beta != 0: continue
    w = round(2 * math.pi / per, 6)
    X.setdefault(w, {})[str(i)] = [float(p[5]), float(p[6])]
source = f'WAMIT v7 (low order, IRR=1) via WEC-Sim BEMIO example "{name}" (github.com/WEC-Sim/WEC-Sim, Apache-2.0)'
if os.path.exists(f'{src}/{name}.out'):
    txt = open(f'{src}/{name}.out', errors='replace').read()
    grab = lambda pat: [float(v) for v in re.search(pat, txt).groups()]
    vol = grab(r'Volumes \(VOLX,VOLY,VOLZ\):\s+(\S+)\s+(\S+)\s+(\S+)')
    cob = grab(r'Center of Buoyancy \(Xb,Yb,Zb\):\s+(\S+)\s+(\S+)\s+(\S+)')
    depth = re.search(r'Water depth:\s+(\S+)', txt).group(1)
    grav = float(re.search(r'Gravity:\s+(\S+)', txt).group(1))
    panels = int(re.search(r'Total panels:\s+(\d+)', txt).group(1))
else:   # no .out: depth, gravity and source from the command line; volume and panel count unknown
    depth, grav, source = sys.argv[5], float(sys.argv[6]), sys.argv[7]
    depth = 'infinite' if depth == 'inf' else depth
    vol, cob, panels = [None, None, None], None, None
hst = {}
for line in open(f'{src}/{name}.hst'):
    p = line.split()
    if len(p) == 3 and p[0].isdigit(): hst[f'{p[0]}{p[1]}'] = float(p[2])
ws = sorted(w for w in A if w <= wmax and w in X)
# thin to at most ~60 frequencies, always keeping the ends
step = max(1, len(ws) // 60)
ws = ws[::step] + ([ws[-1]] if ws[-1] not in ws[::step] else [])
data = {
    'source': source,
    'note': 'non-dimensional, L = 1 m: A = Abar*rho, B = Bbar*rho (already multiplied by omega), X = Xbar*rho*g per metre of wave amplitude; moments about the body origin; heading 0 deg (waves travelling +x)',
    'g': grav, 'depth': None if depth == 'infinite' else float(depth), 'panels': panels,
    'volume': vol[2], 'cob': cob, 'C': {k: v for k, v in hst.items() if abs(v) > 1e-6},
    'A0': A0, 'Ainf': Ainf,
    'w': ws, 'A': [A[w] for w in ws], 'B': [B[w] for w in ws], 'X': [X[w] for w in ws],
}
json.dump(data, open(out, 'w'), separators=(',', ':'))
print(name, len(ws), 'frequencies', ws[0], '…', ws[-1], 'V', vol[2], 'CoB', cob, 'depth', depth)
