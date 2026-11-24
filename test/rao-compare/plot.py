"""RAO comparison plots and summary: Float Sim's panel method vs Capytaine run on its own.

    ~/venvs/bem/bin/python test/rao-compare/plot.py

Reads results/floatsim/<id>.json and results/capytaine/<id>.json (written by floatsim_rao.mjs and capytaine_rao.py).
Writes docs/rao-compare/<id>.png for every model (six rows, surge … yaw; columns Float Sim | Capytaine | difference;
one line per heading 0–180°), docs/rao-compare/summary.csv, docs/rao-compare/natural.csv and results/summary.json.

How the two are compared:
- Plotted RAOs: each solver's own A(ω), B(ω), X(ω, β), M and C, interpolated with cubic splines in ω between the
  100 solved frequencies and solved on a 0.00025 Hz grid, so resonance peaks narrower than the 0.01 Hz solve grid are
  drawn in full. At the solved frequencies this reproduces each solver's own RAOs (checked below).
- Difference: (Float Sim − Capytaine) / peak at the solved frequencies, where peak is Capytaine's largest |RAO| of
  that motion over all frequencies and headings (the measure docs/bem-validation.md uses for coefficients). Scored
  away from the resonances: frequencies within 3 % of either solver's coupled natural frequencies are left
  out, because there a 1 % shift of an almost undamped peak is a large difference at a fixed frequency. The
  resonances are compared separately: natural frequency, radiation damping and peak height.
- Motions that are zero by symmetry (peak under 0.1 % of the largest translation or rotation) are not scored.
- The Haskind energy relation is checked for both solvers as an arbiter where they differ.
"""
import csv, json, math, os

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import colors as mcolors

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'docs', 'rao-compare')
CFG = json.load(open(os.path.join(HERE, 'cases.json')))
DOFS = ['Surge', 'Sway', 'Heave', 'Roll', 'Pitch', 'Yaw']
UNITS = ['m/m'] * 3 + ['°/m'] * 3
ZONE = 0.03                       # resonance zone half-width, relative
FINE = np.linspace(CFG['fMin'], CFG['fMax'], 3961)
INK, INK2, GRID, BAND = '#1f2328', '#59636e', '#d8dee4', '#eef1f4'
plt.rcParams.update({'font.size': 8, 'axes.edgecolor': GRID, 'axes.labelcolor': INK2, 'xtick.color': INK2, 'ytick.color': INK2,
                     'axes.titlecolor': INK, 'axes.titlesize': 8.5, 'axes.grid': True, 'grid.color': GRID, 'grid.linewidth': 0.5,
                     'axes.spines.top': False, 'axes.spines.right': False, 'savefig.facecolor': 'white'})
BLUES = plt.get_cmap('Blues')
HEAD_COL = lambda i, n: BLUES(0.30 + 0.70 * i / max(1, n - 1))   # 0° light → 180° dark: one hue, in order


def load(kind, cid):
    return json.load(open(os.path.join(HERE, 'results', kind, f'{cid}.json')))


def coeffs(res):
    f = np.array(res['freqs'])
    A, B = np.array(res['A']), np.array(res['B'])                       # frequency × 6 × 6
    X = np.array(res['X']); X = X[..., 0] + 1j * X[..., 1]               # frequency × heading × 6
    return f, A, B, X, np.array(res['M']), np.array(res['C'])


def rao_on(res, fq):
    """|RAO| (heading × frequency × dof; m/m, °/m) from the solver's own coefficients, cubic splines in ω between the
    solved points (exact at them; linear interpolation would overshoot below 0.02 Hz, where the horizontal wave force
    grows as ω²)"""
    from scipy.interpolate import CubicSpline
    f, A, B, X, M, C = coeffs(res)
    sA, sB, sX = CubicSpline(f, A, axis=0), CubicSpline(f, B, axis=0), CubicSpline(f, X, axis=0)
    a_, b_, x_ = sA(fq), sB(fq), sX(fq)
    out = np.zeros((X.shape[1], len(fq), 6))
    for q, fv in enumerate(fq):
        w = 2 * math.pi * fv
        Hm = -w * w * (M + a_[q]) + 1j * w * b_[q] + C                  # exp(+i w t)
        out[:, q, :] = np.abs(np.linalg.solve(Hm, x_[q].T).T)
    out[..., 3:] *= 180 / math.pi
    return out


def natural(res):
    """Coupled natural frequencies (Hz) and radiation damping ratios: C v = ω² (M + A(ω)) v over all six motions (so
    the surge–pitch and sway–roll added-mass couplings move them, as in the RAOs), solved by fixed point on ω for each
    mode with restoring. Each mode is named after the heave, roll or pitch motion with the most of its kinetic energy."""
    from scipy.linalg import eig
    f, A, B, X, M, C = coeffs(res)
    w = 2 * math.pi * f

    def at(Mat, wv):
        wv = min(max(wv, w[0]), w[-1])
        k = min(max(np.searchsorted(w, wv) - 1, 0), len(w) - 2)
        t = (wv - w[k]) / (w[k + 1] - w[k])
        return Mat[k] + t * (Mat[k + 1] - Mat[k])

    def modes(wv):
        lam, V = eig(C, M + at(A, wv))
        lam = lam.real
        keep = sorted((i for i in range(6) if np.isfinite(lam[i]) and lam[i] > 1e-9 * (abs(C).max() / M.max())), key=lambda i: lam[i])
        return [(lam[i], V[:, i].real) for i in keep]

    out, used = {}, set()
    for k in range(len(modes(w[0]))):
        wn = math.sqrt(modes(w[0])[k][0])
        for _ in range(300):
            mk = modes(wn)
            wn2 = math.sqrt(mk[k][0])
            if abs(wn2 - wn) < 1e-12 * wn:
                break
            wn = 0.5 * (wn + wn2)
        lam, v = modes(wn)[k]
        Aw, Bw = at(A, wn), at(B, wn)
        zeta = float(v @ Bw @ v / (2 * wn * (v @ (M + Aw) @ v)))
        e = {j: v[j] ** 2 * (M[j, j] + Aw[j, j]) for j in (2, 3, 4)}
        name = next(DOFS[j] for j in sorted(e, key=lambda j: -e[j]) if DOFS[j] not in used)
        used.add(name)
        out[name] = {'f': wn / (2 * math.pi), 'zeta': zeta, 'C': float(C[DOFS.index(name), DOFS.index(name)]), 'inRange': bool(w[0] <= wn <= w[-1])}
    return out


def energy(res):
    """Haskind energy relation, deep water: B_jj = ω³/(4πρg³) ∫ |X_j(β)|² dβ over 0–360°, every body here being
    unchanged by a half turn about the vertical through G (|X(β + 180°)| = |X(β)|), so twice the 0–180° integral.
    Returns, per motion, the largest |B_jj − that| over the frequencies divided by the peak of B_jj (None if B_jj ≈ 0)."""
    rho, g = CFG['rho'], CFG['g']
    hs = np.radians(res['headings'])
    f, A, B, X, M, C = coeffs(res)
    w = 2 * math.pi * f
    out = []
    for j in range(6):
        Bjj = B[:, j, j]
        H = w ** 3 / (4 * math.pi * rho * g ** 3) * 2 * np.trapezoid(np.abs(X[:, :, j]) ** 2, hs, axis=1)
        pk = np.abs(Bjj).max()
        fam = max(np.abs(B[:, i, i]).max() for i in ((0, 1, 2) if j < 3 else (3, 4, 5)))
        out.append(float(np.abs(Bjj - H).max() / pk) if pk > 0.02 * fam else None)
    return out


def compare(fs, cp):
    f = np.array(fs['freqs'])
    a, b = np.array(fs['amp']), np.array(cp['amp'])                     # heading × frequency × dof, as each solver gave them
    for res, amp in ((fs, a), (cp, b)):                                  # the interpolated solve reproduces each solver's RAOs
        chk = rao_on(res, f)
        assert np.abs(chk - amp).max() <= 1e-6 * max(1.0, amp.max()), (res['id'], res['solver'], np.abs(chk - amp).max())
    nat = {'floatsim': natural(fs), 'capytaine': natural(cp)}
    zones = [n['f'] for d in nat.values() for n in d.values() if n['inRange']]
    away = np.array([all(abs(fv / z - 1) > ZONE for z in zones) for fv in f])
    af, bf = rao_on(fs, FINE), rao_on(cp, FINE)
    peak = b.max(axis=(0, 1))
    fam = [max(peak[:3]), max(peak[3:])]
    rows = []
    for j, d in enumerate(DOFS):
        diff = (a[:, :, j] - b[:, :, j]) / peak[j] if peak[j] > 0 else np.zeros_like(a[:, :, j])
        ihf, ikf = np.unravel_index(np.argmax(af[:, :, j]), af[:, :, j].shape)
        ihc, ikc = np.unravel_index(np.argmax(bf[:, :, j]), bf[:, :, j].shape)
        rows.append({
            'dof': d, 'unit': UNITS[j], 'scored': bool(peak[j] >= 1e-3 * fam[0 if j < 3 else 1]),
            'max_diff_away': float(np.abs(diff[:, away]).max()), 'p95_diff': float(np.percentile(np.abs(diff), 95)),
            'max_diff_all': float(np.abs(diff).max()),
            'peak_floatsim': float(af[ihf, ikf, j]), 'f_peak_floatsim': float(FINE[ikf]), 'heading_peak_floatsim': fs['headings'][ihf],
            'peak_capytaine': float(bf[ihc, ikc, j]), 'f_peak_capytaine': float(FINE[ikc]), 'heading_peak_capytaine': cp['headings'][ihc],
            'diff': diff,
        })
    return rows, nat, zones, af, bf, away


def plot(cid, title, fs, cp, rows, nat, zones, af, bf):
    f = np.array(fs['freqs']); heads = fs['headings']; n = len(heads)
    fig, axs = plt.subplots(6, 3, figsize=(11, 13.5), sharex=True, gridspec_kw={'width_ratios': [1, 1, 0.8], 'hspace': 0.38, 'wspace': 0.22})
    sc = [r for r in rows if r['scored']]
    worst = max(sc, key=lambda r: r['max_diff_away'])
    nt = []
    for d in ('Heave', 'Roll', 'Pitch'):
        a, b = nat['floatsim'].get(d), nat['capytaine'].get(d)
        if a and b and a['inRange']:
            nt.append(f'{d.lower()} {a["f"]:.3f} / {b["f"]:.3f} Hz')
    fig.suptitle(f'{title}\nAway from resonances (grey bands) the largest difference is {100 * worst["max_diff_away"]:.1f} % of peak ({worst["dof"].lower()}).'
                 + (f'\nNatural frequencies, Float Sim / Capytaine: {", ".join(nt)}.' if nt else ''),
                 x=0.06, ha='left', fontsize=10, color=INK, y=0.995)
    for j, r in enumerate(rows):
        top = max(af[:, :, j].max(), bf[:, :, j].max()) * 1.08 or 1
        for c, (amp, name) in enumerate(((af, 'Float Sim panel method'), (bf, f'Capytaine {cp["solver"].split()[1]}'))):
            ax = axs[j, c]
            for i in range(n):
                ax.plot(FINE, amp[i, :, j], color=HEAD_COL(i, n), lw=0.9)
            ax.set_ylim(0, top)
            pk = r['peak_floatsim'] if c == 0 else r['peak_capytaine']
            ax.set_title(f'{name} · {r["dof"].lower()} ({r["unit"]}) · peak {pk:.3g}', loc='left')
        ax = axs[j, 2]
        if r['scored']:
            lim = max(2.0, min(30.0, 140 * r['max_diff_away']))
            for z in zones:
                ax.axvspan(z * (1 - ZONE), z * (1 + ZONE), color=BAND, lw=0, zorder=0)
            for i in range(n):
                ax.plot(f, 100 * r['diff'][i], color=HEAD_COL(i, n), lw=0.9)
            ax.axhline(0, color=INK2, lw=0.6)
            ax.set_ylim(-lim, lim)
            off = r['max_diff_all'] > lim / 100
            ax.set_title(f'difference (% of peak) · max {100 * r["max_diff_away"]:.1f} %', loc='left')
            if off:
                ax.text(0.99, 0.95, 'off scale at a resonance', ha='right', va='top', color=INK2, fontsize=7, transform=ax.transAxes,
                        bbox=dict(boxstyle='square,pad=0.15', fc='white', ec='none', alpha=0.85))
        else:
            ax.text(0.5, 0.5, 'zero by symmetry\n(not scored)', ha='center', va='center', color=INK2, transform=ax.transAxes)
            ax.set_yticks([]); ax.set_title('difference', loc='left')
    for c in range(3):
        axs[-1, c].set_xlabel('wave frequency (Hz)')
        axs[-1, c].set_xlim(0, 1)
    sm = plt.cm.ScalarMappable(cmap=mcolors.ListedColormap([HEAD_COL(i, n) for i in range(n)]), norm=mcolors.Normalize(-5, 185))
    cb = fig.colorbar(sm, ax=axs, orientation='horizontal', fraction=0.015, pad=0.035, aspect=60, ticks=heads[::3])
    cb.set_label('wave heading β (°, 0 = waves travelling along +x)', color=INK2)
    cb.outline.set_visible(False)
    fig.savefig(os.path.join(OUT, f'{cid}.png'), dpi=110, bbox_inches='tight')
    plt.close(fig)


def main():
    os.makedirs(OUT, exist_ok=True)
    summary, naturals = [], []
    for c in CFG['cases']:
        cid = c['id']
        try:
            fs, cp = load('floatsim', cid), load('capytaine', cid)
        except FileNotFoundError as e:
            print(f'{cid}: missing {e.filename}')
            continue
        rows, nat, zones, af, bf, away = compare(fs, cp)
        efs, ecp = energy(fs), energy(cp)
        plot(cid, c['title'], fs, cp, rows, nat, zones, af, bf)
        for j, r in enumerate(rows):
            summary.append({'id': cid, 'title': c['title'], **{k: v for k, v in r.items() if k != 'diff'},
                            'energy_floatsim': efs[j], 'energy_capytaine': ecp[j],
                            'fs_panels': fs['mesh']['panels'], 'fs_lid': fs['mesh']['lidPanels'],
                            'cp_panels': cp['mesh']['panels'], 'cp_lid': cp['mesh']['lidPanels'], 'freqs_scored': int(away.sum())})
        for d in ('Heave', 'Roll', 'Pitch'):
            a, b = nat['floatsim'].get(d), nat['capytaine'].get(d)
            if a and b:
                naturals.append({'id': cid, 'mode': d, 'f_floatsim': a['f'], 'f_capytaine': b['f'], 'zeta_floatsim': a['zeta'], 'zeta_capytaine': b['zeta'],
                                 'C_floatsim': a['C'], 'C_capytaine': b['C'], 'in_range': a['inRange'] or b['inRange']})
        print(f'{cid:17s} ' + '  '.join(f'{r["dof"][:5]} {100 * r["max_diff_away"]:5.2f}%' if r['scored'] else f'{r["dof"][:5]}   —  ' for r in rows)
              + f'   ({int(away.sum())}/{len(away)} frequencies away from resonance)')
        print(f'{"":17s} peaks FS/CP: ' + '  '.join(f'{r["dof"][:5]} {r["peak_floatsim"]:.4g}@{r["f_peak_floatsim"]:.3f}/{r["peak_capytaine"]:.4g}@{r["f_peak_capytaine"]:.3f}' for r in rows if r['scored']))
        print(f'{"":17s} natural FS/CP: ' + '  '.join(f'{d} {nat["floatsim"][d]["f"]:.4f}/{nat["capytaine"][d]["f"]:.4f} Hz ζ {100 * nat["floatsim"][d]["zeta"]:.2f}/{100 * nat["capytaine"][d]["zeta"]:.2f} %' for d in ('Heave', 'Roll', 'Pitch') if d in nat['floatsim'] and d in nat['capytaine']))
        print(f'{"":17s} energy relation FS/CP: ' + '  '.join(f'{d[:5]} {"—" if x is None else f"{100 * x:.1f}%"}/{"—" if y is None else f"{100 * y:.1f}%"}' for d, x, y in zip(DOFS, efs, ecp)))
    json.dump({'rows': summary, 'natural': naturals}, open(os.path.join(HERE, 'results', 'summary.json'), 'w'), indent=1)
    keys = ['id', 'dof', 'unit', 'scored', 'max_diff_away', 'p95_diff', 'peak_floatsim', 'f_peak_floatsim', 'peak_capytaine', 'f_peak_capytaine',
            'energy_floatsim', 'energy_capytaine', 'fs_panels', 'fs_lid', 'cp_panels', 'cp_lid', 'freqs_scored']
    with open(os.path.join(OUT, 'summary.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=keys, extrasaction='ignore')
        w.writeheader()
        for r in summary:
            w.writerow({k: (round(v, 6) if isinstance(v, float) else v) for k, v in r.items() if k in keys})
    with open(os.path.join(OUT, 'natural.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(naturals[0].keys()))
        w.writeheader()
        for r in naturals:
            w.writerow({k: (round(v, 6) if isinstance(v, float) else v) for k, v in r.items()})


if __name__ == '__main__':
    main()
