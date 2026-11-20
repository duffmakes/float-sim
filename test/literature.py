"""Literature reference data for the RAO trade study (standard library only).

[HUL]  Hulme, A. (1982) "The wave forces acting on a floating hemisphere undergoing forced periodic
       oscillations", J. Fluid Mech. 121, 443-463. Heave added mass a33 = A33/(ρV) and damping
       b33 = B33/(ρVω), V = 2/3 π a³, versus ka. Values as tabulated in
       github.com/LHEEA/Hulme_Heaving_Sphere/comparison/HulmeResult.dat.
[HAS]  Haskind relation (Newman 1962), axisymmetric body, deep water: |X3|² = 2 ρ g³ B33 / ω³.
[MF]   MacCamy & Fuchs (1954), "Wave forces on piles: a diffraction theory", BEB Tech. Memo 69:
       horizontal force per unit depth on a vertical cylinder dF/dz = (4ρgA/k) e^{kz} / |H1'(ka)|.
"""
import math

HULME = [  # ka, a33, b33
    (0.05, 0.8764, 0.1036), (0.1, 0.8627, 0.1816), (0.2, 0.7938, 0.2793), (0.3, 0.7157, 0.3254),
    (0.4, 0.6452, 0.3410), (0.5, 0.5861, 0.3391), (0.6, 0.5381, 0.3271), (0.7, 0.4999, 0.3098),
    (0.8, 0.4698, 0.2899), (0.9, 0.4464, 0.2691), (1.0, 0.4284, 0.2484), (1.2, 0.4047, 0.2096),
    (1.4, 0.3924, 0.1756), (1.6, 0.3871, 0.1469), (1.8, 0.3864, 0.1229), (2.0, 0.3884, 0.1031),
    (2.5, 0.3988, 0.0674), (3.0, 0.4111, 0.0452),
]
HULME_A33_ZERO = 0.8310


def hemisphere_heave(ka, a33, b33, a=1.0):
    """Exact linear heave RAO and exciting force of a freely floating hemisphere (mass = ρV)."""
    V = 2 / 3 * math.pi * a ** 3
    k = ka / a
    X_over_rhog = math.sqrt(2 * V * b33 / k)              # |X3| / (ρg), from [HAS] with B33 = b33 ρ V ω, ω² = gk
    re = 3 / (2 * a) - k * (1 + a33)                      # [C33 − ω²(m + A33)] / (ρ g V)
    im = k * b33                                          # ω B33 / (ρ g V)
    return X_over_rhog / (V * math.hypot(re, im)), X_over_rhog / (math.pi * a * a)   # RAO, |X3|/(ρgπa²)


# ---- Bessel functions by power series (adequate for x ≤ 8), checked against tabulated values below
EULER = 0.5772156649015329


def J(n, x, terms=60):
    return sum((-1) ** m / (math.factorial(m) * math.factorial(m + n)) * (x / 2) ** (2 * m + n) for m in range(terms))


def Y0(x, terms=60):
    s = sum((-1) ** (m + 1) * sum(1 / j for j in range(1, m + 1)) * (x * x / 4) ** m / math.factorial(m) ** 2 for m in range(1, terms))
    return 2 / math.pi * ((math.log(x / 2) + EULER) * J(0, x) + s)


def Y1_accurate(x):
    # Y1 = (2/π) J1 ln(x/2) − 2/(πx) − (1/π) Σ (−1)^m [ψ(m+1)+ψ(m+2)] (x/2)^{2m+1}/(m!(m+1)!)
    psi = lambda n: -EULER + sum(1 / j for j in range(1, n))       # ψ(n) for integer n ≥ 1
    s = sum((-1) ** m * (psi(m + 1) + psi(m + 2)) * (x / 2) ** (2 * m + 1) / (math.factorial(m) * math.factorial(m + 1)) for m in range(60))
    return 2 / math.pi * J(1, x) * math.log(x / 2) - 2 / (math.pi * x) - s / math.pi


def mf_coefficient(ka):
    """1/|H1'(ka)| with J1' = J0 − J1/x, Y1' = Y0 − Y1/x"""
    j1p = J(0, ka) - J(1, ka) / ka
    y1p = Y0(ka) - Y1_accurate(ka) / ka
    return 1 / math.hypot(j1p, y1p)


def spar_sway(ka, a, T, rho=1000.0, g=9.80665):
    """Deep-draft vertical cylinder in deep water. Returns (|F2|/A per unit wave amplitude from [MF] integrated
    over the draft, strip-theory sway RAO of the freely floating spar with Ca = 1)."""
    k = ka / a
    F = 4 * rho * g * mf_coefficient(ka) * (1 - math.exp(-k * T)) / (k * k)
    m = rho * math.pi * a * a * T
    w2 = g * k
    return F, F / (w2 * (m + m))


if __name__ == '__main__':
    # tabulated values (Abramowitz & Stegun table 9.1): J0(1)=0.7651976866, J1(1)=0.4400505857, Y0(1)=0.0882569642, Y1(1)=-0.7812128213
    for name, got, want in [('J0(1)', J(0, 1), 0.7651976866), ('J1(1)', J(1, 1), 0.4400505857), ('Y0(1)', Y0(1), 0.0882569642),
                            ('Y1(1)', Y1_accurate(1), -0.7812128213), ('J1(2.5)', J(1, 2.5), 0.4970941025), ('Y1(2.5)', Y1_accurate(2.5), 0.1459181380)]:
        print(f"{name:8} {got:+.10f}  table {want:+.10f}  {'OK' if abs(got - want) < 1e-8 else 'BAD'}")
    print('MF small-ka check (→ Cm = 2):', [round(mf_coefficient(x) / (math.pi * x * x / 2), 4) for x in (0.01, 0.05)])
    print('hemisphere long-wave RAO (→ 1):', round(hemisphere_heave(0.05, 0.8764, 0.1036)[0], 4))
