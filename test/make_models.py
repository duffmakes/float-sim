"""Generate the validation STEP bodies (test/models/*.step) and their closed-form expected
hydrostatics (test/models/expected.json).   Run:  python3 test/make_models.py

All expected values come from textbook formulas, not from the tool:
  [RT]  Rawson & Tupper, Basic Ship Theory, 5th ed., Vol. 1, ch. 4 (hydrostatics, BM = I/V, wall-sided formula)
  [BD]  Barrass & Derrett, Ship Stability for Masters and Mates, 7th ed. (box-shaped vessels, TPC, KB = T/2, BM = B²/12T)
  [BI]  Biran & López-Pulido, Ship Hydrostatics and Stability, 2nd ed., ch. 2–3 (metacentre, circular & V sections)
  [ESH] Erdős, Schibler & Herndon, "Floating equilibrium of symmetrical objects and the breaking of symmetry",
        Am. J. Phys. 60, 335 (1992): an upright cube / square log is unstable for 0.2113 < s < 0.7887,
        and a square log with s = 1/2 floats corner-down at 45°.
  [ARC] Archimedes' principle: displaced volume V = m / ρ.
Units: geometry is written in millimetres; expected values below are SI (m, kg, m³, m²).
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from stepgen import StepWriter, box, prism_x, transform, Cylinder, Sphere, check_topology  # noqa: E402
import literature as LIT  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'models')
os.makedirs(OUT, exist_ok=True)

FRESH, SALT = 1000.0, 1025.0
MM = 1000.0


def mm(solid):
    """scale an SI solid to millimetres for writing"""
    if isinstance(solid, Cylinder):
        return Cylinder([c * MM for c in solid.base], solid.axis, solid.ref, solid.r * MM, solid.h * MM)
    if isinstance(solid, Sphere):
        return Sphere([c * MM for c in solid.c], solid.r * MM, solid.axis, solid.ref)
    return transform(solid, [[MM, 0, 0], [0, MM, 0], [0, 0, MM]], [0, 0, 0])


solids, cases = {}, []


def wall_sided_gz(GM, BM, deg):
    """[RT] wall-sided formula  GZ = sinφ (GM + ½ BM tan²φ)"""
    p = math.radians(deg)
    return math.sin(p) * (GM + 0.5 * BM * math.tan(p) ** 2)


# ---------------------------------------------------------------- 1. box barge, fresh & salt
L, B, D = 4.0, 2.0, 1.0
solids['box_4x2x1'] = box(L, B, D, (0, -B / 2, 0))
KG, m = 0.5, 3200.0
for rho, tag in ((FRESH, 'fresh'), (SALT, 'salt')):
    T = m / (rho * L * B)                     # [ARC]
    KB, BMt, BMl = T / 2, B ** 2 / (12 * T), L ** 2 / (12 * T)   # [BD]
    c = dict(id=f'box_{tag}', file='box_4x2x1.step', curved=False,
             title=f'Box barge 4×2×1 m, 3200 kg, KG 0.5 m, {tag} water',
             ref='[ARC] T = m/(ρLB); [BD] KB = T/2, BM_T = B²/12T, BM_L = L²/12T, TPC = ρ·Awp/100',
             rho=rho, mass=m, cog=[L / 2, 0, KG], euler=[0, 0, 0],
             expect=dict(status='floats', V=m / rho, draft=T, Awp=L * B, KB=KB, BMt=BMt, BMl=BMl,
                         GMt=KB + BMt - KG, GMl=KB + BMl - KG, offset=0.0, kg_per_cm=rho * L * B / 100,
                         B_model=[L / 2, 0, KB]))
    if tag == 'fresh':
        # wall-sided formula holds until the deck edge immerses (tanφ < 2f/B = 0.6) or the bilge
        # emerges (tanφ < 2T/B = 0.4) → valid to ~21.8°
        c['gz'] = dict(axis='x', ref='[RT] wall-sided formula', points=[[d, wall_sided_gz(KB + BMt - KG, BMt, d)] for d in (5, 10, 15, 20)])
        c['target'] = dict(mode='draft', value=0.25, mass=rho * L * B * 0.25, ref='[ARC] m = ρ·L·B·T')
    cases.append(c)

# ---------------------------------------------------------------- 2. box barge with off-centre CoG → list
T = m / (FRESH * L * B); KB, BMt = T / 2, B ** 2 / (12 * T); GM = KB + BMt - KG
GGp = 0.05
lo, hi = 0.0, 0.5                     # solve tanφ (GM + ½BM tan²φ) = GG'   [RT]
for _ in range(200):
    t = (lo + hi) / 2
    (lo, hi) = (t, hi) if t * (GM + 0.5 * BMt * t * t) < GGp else (lo, t)
phi = math.degrees(math.atan(lo))
cases.append(dict(
    id='box_list', file='box_4x2x1.step', curved=False,
    title=f'Box barge with CoG 50 mm off centreline → list {phi:.3f}°',
    ref="[RT] wall-sided: tanφ·(GM + ½·BM·tan²φ) = GG'",
    rho=FRESH, mass=m, cog=[L / 2, GGp, KG], euler=[-phi, 0, 0],
    expect=dict(status='floats', V=m / FRESH, offset=0.0),
    sim=dict(start_euler=[0, 0, 0], expect_roll=-phi, tol_deg=0.15)))

# ---------------------------------------------------------------- 3. cube at three specific gravities
solids['cube_1m'] = box(1, 1, 1, (-0.5, -0.5, 0))
for s in (0.15, 0.5, 0.85):
    T = s; KB, BM = T / 2, 1 / (12 * T); GM = KB + BM - 0.5
    cases.append(dict(
        id=f'cube_s{int(s * 100):03d}', file='cube_1m.step', curved=False,
        title=f'1 m cube, s.g. {s} (upright {"stable" if GM > 0 else "UNSTABLE"})',
        ref='[ESH] upright cube stable only for s < 0.2113 or s > 0.7887; [BD] GM = T/2 + 1/(12T) − ½',
        rho=FRESH, mass=1000 * s, cog=[0, 0, 0.5], euler=[0, 0, 0],
        expect=dict(status='floats', draft=T, KB=KB, BMt=BM, BMl=BM, GMt=GM, GMl=GM, stable=GM > 0)))

# ---------------------------------------------------------------- 3b. cube corner-down (body diagonal vertical), s.g. ½
# The waterplane is the regular-hexagon mid-section (side a = √2/2): A = (3√3/2)a², I = (5√3/16)a⁴.
# BG = E|S − 3/2| / √3 with S ~ Irwin–Hall(3)  →  0.40625/√3.
a_hex = math.sqrt(2) / 2
BMc = (5 * math.sqrt(3) / 16) * a_hex ** 4 / 0.5
BGc = 0.40625 / math.sqrt(3)
cases.append(dict(
    id='cube_corner_s050', file='cube_1m.step', curved=False,
    title='1 m cube, s.g. ½, corner-down (body diagonal vertical): the attitude the simulator settles into',
    ref='hexagonal mid-section: draft = √3/2, Awp = 3√3/4, BM = (5√3/16)a⁴/V; BG from Irwin–Hall(3) mean deviation',
    rho=FRESH, mass=500.0, cog=[0, 0, 0.5], euler=[45, math.degrees(math.atan(1 / math.sqrt(2))), 0],
    expect=dict(status='floats', draft=math.sqrt(3) / 2, Awp=3 * math.sqrt(3) / 4, offset=0.0,
                BMt=BMc, BMl=BMc, GMt=BMc - BGc, GMl=BMc - BGc, stable=True)))

# ---------------------------------------------------------------- 4. square log, s = ½, corner-down at 45°
solids['square_log_3x1x1'] = box(3, 1, 1, (0, -0.5, 0))
h = math.sqrt(2) / 2
cases.append(dict(
    id='square_log_45', file='square_log_3x1x1.step', curved=False,
    title='Square log 3×1×1 m, s.g. ½, rolled 45° (corner down)',
    ref='[ESH] s = ½ square log rests corner-down; triangle section: draft = √2/2, GM = w³/(12A) − h/3 = √2/6',
    rho=FRESH, mass=1500.0, cog=[1.5, 0, 0.5], euler=[45, 0, 0],
    expect=dict(status='floats', draft=h, offset=0.0, BMt=(2 * h) ** 3 / 12 / 0.5, GMt=(2 * h) ** 3 / 12 / 0.5 - h / 3, stable=True),
    sim=dict(start_euler=[20, 0, 0], expect_roll=45.0, tol_deg=0.3)))

# ---------------------------------------------------------------- 5. vertical cylinders (spar stability)
for name, r, H in (('vcyl_tall', 0.25, 1.0), ('vcyl_squat', 0.5, 0.4)):
    solids[name] = Cylinder([0, 0, 0], [0, 0, 1], [1, 0, 0], r, H)
    s = 0.5
    T = s * H; KB, BM = T / 2, r * r / (4 * T); GM = KB + BM - H / 2
    crit = math.sqrt(2 * s * (1 - s))
    cases.append(dict(
        id=name, file=f'{name}.step', curved=True,
        title=f'Upright cylinder r={r} H={H} m, s.g. ½ (r/H={r / H:.2f} {">" if r / H > crit else "<"} {crit:.3f} → {"stable" if GM > 0 else "UNSTABLE"})',
        ref='[BI] circular waterplane I = πr⁴/4 ⇒ BM = r²/4T; upright stable iff r/H > √(2s(1−s))',
        rho=FRESH, mass=FRESH * math.pi * r * r * H * s, cog=[0, 0, H / 2], euler=[0, 0, 0],
        expect=dict(status='floats', draft=T, Awp=math.pi * r * r, KB=KB, BMt=BM, BMl=BM, GMt=GM, GMl=GM, stable=GM > 0)))

# ---------------------------------------------------------------- 6. horizontal cylinder (log) with ballast
r, Lc = 0.2, 3.0
solids['hcyl_log'] = Cylinder([0, 0, r], [1, 0, 0], [0, 1, 0], r, Lc)
Vt = math.pi * r * r * Lc
zG = r - 0.05                                 # CoG 50 mm below the axis
th = math.pi                                  # half-full: segment angle π
Bdepth = 4 * r / (3 * math.pi)
# 25 % full: segment area (r²/2)(θ − sinθ) = 0.25·πr²
lo, hi = 0.0, 2 * math.pi
for _ in range(200):
    t = (lo + hi) / 2
    (lo, hi) = (t, hi) if (t - math.sin(t)) < 0.5 * math.pi else (lo, t)
T25 = r * (1 - math.cos(lo / 2))
cases.append(dict(
    id='hcyl_log', file='hcyl_log.step', curved=True,
    title='Log Ø0.4×3 m half-submerged, CoG 50 mm below axis',
    ref='[BI] circular section: M is at the axis for every heel ⇒ GM = axis − G and GZ = GM·sinφ exactly; B = 4r/3π below axis',
    rho=FRESH, mass=FRESH * Vt / 2, cog=[Lc / 2, 0, zG], euler=[0, 0, 0],
    expect=dict(status='floats', draft=r, Awp=2 * r * Lc, KB=r - Bdepth, BMt=Bdepth, GMt=r - zG,
                BMl=(2 * r * Lc ** 3 / 12) / (Vt / 2), stable=True),
    gz=dict(axis='x', ref='[BI] GZ = GM·sinφ', points=[[d, (r - zG) * math.sin(math.radians(d))] for d in (10, 30, 60, 90, 135)]),
    target=dict(mode='frac', value=25.0, mass=0.25 * FRESH * Vt, draft=T25,
                ref='segment area (r²/2)(θ − sinθ) = ¼πr²  ⇒  T = r(1 − cos θ/2)')))

# ---------------------------------------------------------------- 7. V-section (triangular prism, apex down)
a = math.radians(30); Lv = 3.0; Tv = 0.6; zGv = 0.35
solids['v_prism'] = prism_x([(0, 0), (math.tan(a), 1.0), (-math.tan(a), 1.0)], Lv)
Vv = Tv * Tv * math.tan(a) * Lv
cases.append(dict(
    id='v_prism', file='v_prism.step', curved=False,
    title='V-section prism, 30° half-angle, 3 m long, draft 0.6 m',
    ref='[BI] triangle section: A = T²tanα, KB = 2T/3, b = 2T·tanα, BM = Lb³/12V = (2/3)·T·tan²α',
    rho=FRESH, mass=FRESH * Vv, cog=[Lv / 2, 0, zGv], euler=[0, 0, 0],
    expect=dict(status='floats', V=Vv, draft=Tv, Awp=2 * Tv * math.tan(a) * Lv, KB=2 * Tv / 3,
                BMt=2 * Tv * math.tan(a) ** 2 / 3, GMt=2 * Tv / 3 + 2 * Tv * math.tan(a) ** 2 / 3 - zGv,
                BMl=(2 * Tv * math.tan(a) * Lv ** 3 / 12) / Vv)))

# ---------------------------------------------------------------- 8. moved/rotated box (frame handling)
yaw = math.radians(30)
Rz = [[math.cos(yaw), -math.sin(yaw), 0], [math.sin(yaw), math.cos(yaw), 0], [0, 0, 1]]
tr = [1.5, -0.7, 0.25]
solids['box_moved'] = transform(solids['box_4x2x1'], Rz, tr)
mv = lambda p: [sum(Rz[i][k] * p[k] for k in range(3)) + tr[i] for i in range(3)]
T = m / (FRESH * L * B)
cases.append(dict(
    id='box_moved', file='box_moved.step', curved=False,
    title='Box barge 4×2×1 m, placed off-origin and yawed 30° in the CAD file (yaw −30° to realign)',
    ref='same closed form as box_fresh; checks model ↔ water frame transforms',
    rho=FRESH, mass=m, cog=mv([L / 2, 0, KG]), euler=[0, 0, -30],
    expect=dict(status='floats', draft=T, KB=T / 2, BMt=B ** 2 / (12 * T), BMl=L ** 2 / (12 * T),
                GMt=T / 2 + B ** 2 / (12 * T) - KG, B_model=mv([L / 2, 0, T / 2]))))

# ---------------------------------------------------------------- 9. too heavy → sinks
cases.append(dict(
    id='box_sinks', file='box_4x2x1.step', curved=False,
    title='Box barge 9000 kg (> ρV = 8000 kg) → sinks',
    ref='[ARC] floats only if m < ρ·V_total',
    rho=FRESH, mass=9000.0, cog=[L / 2, 0, KG], euler=[0, 0, 0],
    expect=dict(status='sinks')))

# ---------------------------------------------------------------- wave / seakeeping closed forms
# Spectra [DNV-RP-C205 §3.5.5]. For two-parameter PM the moments are exact:
#   m_n = Hs²/16 · (5/4)^(n/4) · ωp^n · Γ(1 − n/4)  ⇒  T1/Tp = 1/((5/4)^¼ Γ(¾)),  Tz/Tp = 1/√((5/4)^½ Γ(½))
# JONSWAP period ratios from the DNV regressions (eq. 3.5.5.4), normalisation A_γ = 1 − 0.287 ln γ (≈ 1 % accurate).
Hs_t, Tp_t = 2.0, 8.0
gam = 3.3
wave = dict(
    spectra=[
        dict(id='pm', type='pm', Hs=Hs_t, Tp=Tp_t, gamma=1, m0=Hs_t ** 2 / 16, tol=1e-3,
             T1=Tp_t / ((1.25 ** 0.25) * math.gamma(0.75)), Tz=Tp_t / math.sqrt(1.25 ** 0.5 * math.gamma(0.5)),
             ref='PM exact moments: T1 = 0.7718·Tp, Tz = 0.7104·Tp'),
        dict(id='jonswap', type='jonswap', Hs=Hs_t, Tp=Tp_t, gamma=gam, m0=Hs_t ** 2 / 16, tol=0.02,
             T1=Tp_t * (0.7303 + 0.04936 * gam - 0.006556 * gam ** 2 + 0.0002361 * gam ** 3),
             Tz=Tp_t * (0.6673 + 0.05037 * gam - 0.006230 * gam ** 2 + 0.0003341 * gam ** 3),
             ref='DNV-RP-C205 eq. 3.5.5.4 regressions; m0 = Hs²/16 to ~1 % with A_γ'),
    ],
)
# Froude–Krylov heave force on a wall-sided box (only the flat bottom has n_z ≠ 0) [Faltinsen §3]:
#   |F3| / A = ρ g e^{−kT} L B · |sinc(k_x L/2)| · |sinc(k_y B/2)|,  deep water k = ω²/g
Lb, Bb, Tb, rho_b = 4.0, 2.0, 0.4, FRESH
g = 9.80665
sinc = lambda x: 1.0 if abs(x) < 1e-12 else math.sin(x) / x
fk = []
for beta in (180.0, 90.0, 135.0):
    for w in (0.6, 1.2, 2.0, 3.0):
        k = w * w / g
        kx, ky = k * math.cos(math.radians(beta)), k * math.sin(math.radians(beta))
        fk.append(dict(beta=beta, w=w, F3=rho_b * g * math.exp(-k * Tb) * Lb * Bb * abs(sinc(kx * Lb / 2)) * abs(sinc(ky * Bb / 2))))
wave['box_fk'] = dict(case='box_fresh', ref='|F3|/A = ρg e^(−kT) L B |sinc(kₓL/2) sinc(k_y B/2)| (Faltinsen §3)', points=fk)
# Undamped heave natural frequency with the default added mass: floating elliptic disk of the waterplane's
# area and aspect ratio, A33 = (2/3)πρ a b² / E(e)  (Lamb §373). E(e) by series for the check value.
def ellipE(e, n=4000):
    return sum(math.sqrt(1 - (e * math.sin(t)) ** 2) for t in ((i + 0.5) * (math.pi / 2) / n for i in range(n))) * (math.pi / 2) / n
_r = Bb / Lb
_a = math.sqrt(Lb * Bb / (math.pi * _r)); _b = _a * _r
A33 = (2 / 3) * math.pi * rho_b * _a * _b * _b / ellipE(math.sqrt(1 - _r * _r))
wave['box_heave_wn'] = dict(case='box_fresh', A33=A33, wn=math.sqrt(rho_b * g * Lb * Bb / (3200.0 + A33)),
                            ref='ω_n = √(C33/(m + A33)), C33 = ρg·Awp, A33 = floating elliptic disk (2/3)πρab²/E(e) of equal area')

# ---------------------------------------------------------------- literature RAO benchmarks (trade study)
# (1) Floating hemisphere, heave: exact linear potential theory from Hulme (1982) + Haskind.
#     A sphere floating half-submerged has the same wetted geometry as a hemisphere.
a_h = 1.0
solids['sphere_r1'] = Sphere([0, 0, a_h], a_h, axis=(1, 0, 0), ref=(0, 1, 0))
V_h = 2 / 3 * math.pi * a_h ** 3
hemi = []
for ka, a33, b33 in LIT.HULME:
    rao, xnorm = LIT.hemisphere_heave(ka, a33, b33, a_h)
    hemi.append(dict(ka=ka, w=math.sqrt(9.80665 * ka / a_h), a33=a33, b33=b33, rao=rao, X_norm=xnorm))
# equivalent constant damping ratio at the heave natural frequency (for the "calibrated" trade-study variant)
wave['lit_hemisphere'] = dict(
    file='sphere_r1.step', a=a_h, rho=FRESH, mass=FRESH * V_h, cog=[0, 0, a_h - 0.3], euler=[0, 0, 0],
    a33_zero=LIT.HULME_A33_ZERO, points=hemi,
    ref='Hulme (1982) J. Fluid Mech. 121; exciting force from the Haskind relation |X3|² = 2ρg³B33/ω³ (Newman 1962)')
# (2) Deep-draft spar, sway: MacCamy & Fuchs (1954) diffraction force integrated over the draft,
#     freely floating with strip-theory added mass Ca = 1.
a_s, T_s, H_s = 0.5, 6.0, 12.0
solids['spar'] = Cylinder([0, 0, 0], [0, 0, 1], [1, 0, 0], a_s, H_s)
spar = []
for ka in (0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1.0):
    F, rao = LIT.spar_sway(ka, a_s, T_s)
    spar.append(dict(ka=ka, w=math.sqrt(9.80665 * ka / a_s), F=F, rao=rao, Cm_eff=F / (FRESH * math.pi * a_s ** 2 * 9.80665 * (ka / a_s) * (1 - math.exp(-ka / a_s * T_s)) / (ka / a_s))))
wave['lit_spar'] = dict(
    file='spar.step', a=a_s, T=T_s, rho=FRESH, mass=FRESH * math.pi * a_s ** 2 * T_s, cog=[0, 0, 1.0], euler=[0, 0, 0],
    points=spar, A22_exact=FRESH * math.pi * a_s ** 2 * T_s,
    ref='MacCamy & Fuchs (1954) diffraction force, deep water, integrated over the draft; sway RAO with Ca = 1')

# ---------------------------------------------------------------- write
if __name__ == '__main__':
    w = StepWriter()
    for name, sol in solids.items():
        p = os.path.join(OUT, f'{name}.step')
        w.write(p, mm(sol), name)
        ok, msg = check_topology(p)
        print(f"{'OK ' if ok else 'BAD'} {name}.step  {msg}")
        if not ok:
            sys.exit(1)
    with open(os.path.join(OUT, 'expected.json'), 'w') as fh:
        json.dump(dict(units_in_file='mm', g=9.80665, cases=cases, wave=wave), fh, indent=1)
    print(f"wrote {len(cases)} cases → test/models/expected.json")
