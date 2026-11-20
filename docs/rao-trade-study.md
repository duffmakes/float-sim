# RAO trade study: Float Sim vs literature

Generated 2026-11-20 by `node test/trade-study-node.mjs` (mesh quality: fine). Both bodies are STEP files in `test/models/`, imported with OpenCascade exactly as the app does.

## Findings

1. **Hydrostatics and wave forces are right where the method applies.** With exact added mass and damping, the hemisphere heave RAO is within 2.8 % of Hulme's exact solution up to ka = 0.7, and the heave exciting force with the diffraction correction is within 0.9 % of the Haskind value up to ka = 0.6.
2. **Froude–Krylov alone misses half the horizontal wave force on slender bodies.** On the spar it is 50 % low in long waves (C_m = 1 instead of 2). The long-wave diffraction correction (added mass × volume-averaged incident acceleration) brings the sway force and RAO within 4.6 % of MacCamy–Fuchs up to ka = 0.7. **It is on by default for surge and sway.**
3. **For heave the correction is a long-wave fix.** It is excellent at small ka (defaults: within 2.2 % up to ka = 0.3), but with a constant added mass it overcorrects towards resonance (-69.6 % at ka = 1). Froude–Krylov alone overpredicts the heave force by up to 41 % instead. **The heave correction is off by default; enable it when A33 is known.**
4. **The default added-mass and damping estimates dominate the error near resonance.** With tool defaults (disk A33 = 0.64 ρV, ζ = 0.15), the hemisphere heave RAO is -25.7 % at the exact resonance (ka = 1). The peak is shifted because real added mass and damping vary with frequency. Entering known values (e.g. from a BEM code, model tests or published coefficients) in *Wave & hydrodynamic settings* reduces it to -15.3 % ("calibrated constants"). The remainder matches the exciting-force error at that frequency (-15.3 % at ka = 1), which is the limit of the long-wave force model.
5. **Trust region.** Results degrade once the body is no longer small relative to the wavelength (ka ≳ 0.7 here, i.e. D/λ ≳ 0.2). That is the same threshold at which the app shows its diffraction warning. Roll RAOs are not benchmarked here: real roll damping is dominated by viscous effects that linear potential theory (and this tool) only approximate with the ζ input.

## 1. Floating hemisphere, heave (radius 1 m)

**Reference:** Hulme (1982), *J. Fluid Mech.* 121, 443–463: exact linear potential-flow heave added mass a₃₃ = A₃₃/ρV and damping b₃₃ = B₃₃/ρVω versus ka (table from [LHEEA/Hulme_Heaving_Sphere](https://github.com/LHEEA/Hulme_Heaving_Sphere)). The exciting force follows from the Haskind relation |X₃|² = 2ρg³B₃₃/ω³, and the RAO from |X₃| / |C₃₃ − ω²(m + A₃₃) + iωB₃₃|. The sphere floats half-submerged, so its wetted surface is the hemisphere.

Tool default heave added mass: A₃₃ = 1333 kg = **0.64 ρV** (floating elliptic disk), against Hulme's 0.83 ρV (ka→0) to 0.39 ρV (ka≈1.8). 51,066 panels.

### Heave RAO (m/m)

| ka | ω rad/s | f Hz | **Hulme exact** | Tool defaults: FK only, disk A33, ζ = 0.15 | Tool defaults + heave diffraction correction | Calibrated constants (Hulme A33, B33 at ka = 1) + diffraction corr. | Hulme A33(ω), B33(ω), Froude–Krylov excitation | Hulme A33(ω), B33(ω), FK + diffraction correction |
|---|---|---|---|---|---|---|---|---|
| 0.05 | 0.700 | 0.111 | **1.000** | 1.020 (2.0 %) | 0.998 (-0.2 %) | 1.000 (-0.0 %) | 1.031 (3.1 %) | 1.001 (0.1 %) |
| 0.1 | 0.990 | 0.158 | **1.002** | 1.043 (4.0 %) | 0.997 (-0.5 %) | 1.001 (-0.1 %) | 1.067 (6.5 %) | 1.004 (0.1 %) |
| 0.2 | 1.400 | 0.223 | **1.011** | 1.097 (8.6 %) | 0.999 (-1.2 %) | 1.007 (-0.3 %) | 1.144 (13.2 %) | 1.016 (0.5 %) |
| 0.3 | 1.715 | 0.273 | **1.028** | 1.169 (13.7 %) | 1.006 (-2.2 %) | 1.021 (-0.7 %) | 1.229 (19.6 %) | 1.037 (0.8 %) |
| 0.4 | 1.981 | 0.315 | **1.058** | 1.261 (19.2 %) | 1.019 (-3.7 %) | 1.045 (-1.2 %) | 1.325 (25.2 %) | 1.067 (0.9 %) |
| 0.5 | 2.214 | 0.352 | **1.107** | 1.380 (24.7 %) | 1.039 (-6.2 %) | 1.084 (-2.1 %) | 1.440 (30.1 %) | 1.112 (0.4 %) |
| 0.6 | 2.426 | 0.386 | **1.184** | 1.527 (29.1 %) | 1.059 (-10.6 %) | 1.143 (-3.4 %) | 1.587 (34.1 %) | 1.175 (-0.7 %) |
| 0.7 | 2.620 | 0.417 | **1.301** | 1.684 (29.4 %) | 1.060 (-18.6 %) | 1.235 (-5.1 %) | 1.784 (37.1 %) | 1.265 (-2.8 %) |
| 0.8 | 2.801 | 0.446 | **1.476** | 1.774 (20.2 %) | 0.996 (-32.5 %) | 1.372 (-7.0 %) | 2.055 (39.2 %) | 1.390 (-5.8 %) |
| 0.9 | 2.971 | 0.473 | **1.707** | 1.679 (-1.7 %) | 0.820 (-52.0 %) | 1.544 (-9.6 %) | 2.397 (40.4 %) | 1.537 (-10.0 %) |
| 1 | 3.132 | 0.498 | **1.884** | 1.399 (-25.7 %) | 0.573 (-69.6 %) | 1.597 (-15.3 %) | 2.650 (40.6 %) | 1.597 (-15.3 %) |
| 1.2 | 3.430 | 0.546 | **1.306** | 0.815 (-37.6 %) | 0.189 (-85.5 %) | 0.788 (-39.7 %) | 1.805 (38.2 %) | 0.924 (-29.3 %) |
| 1.4 | 3.705 | 0.590 | **0.676** | 0.473 (-30.0 %) | 0.010 (-98.5 %) | 0.269 (-60.1 %) | 0.893 (32.2 %) | 0.354 (-47.6 %) |
| 1.6 | 3.961 | 0.630 | **0.391** | 0.287 (-26.7 %) | 0.067 (-82.8 %) | 0.072 (-81.5 %) | 0.480 (22.7 %) | 0.120 (-69.5 %) |
| 1.8 | 4.201 | 0.669 | **0.250** | 0.178 (-28.8 %) | 0.099 (-60.3 %) | 0.012 (-95.2 %) | 0.276 (10.1 %) | 0.015 (-94.0 %) |
| 2 | 4.429 | 0.705 | **0.172** | 0.111 (-35.3 %) | 0.109 (-36.5 %) | 0.050 (-70.8 %) | 0.163 (-5.2 %) | 0.034 (-80.2 %) |
| 2.5 | 4.951 | 0.788 | **0.080** | 0.029 (-64.0 %) | 0.094 (17.0 %) | 0.069 (-14.3 %) | 0.039 (-51.6 %) | 0.064 (-19.5 %) |
| 3 | 5.424 | 0.863 | **0.044** | 0.000 (-99.0 %) | 0.062 (42.1 %) | 0.052 (19.3 %) | 0.001 (-98.8 %) | 0.052 (18.0 %) |

### Heave exciting force |X₃| / (ρgπa²)

| ka | **Haskind exact** | Froude–Krylov | FK + diffraction correction |
|---|---|---|---|
| 0.05 | **0.938** | 0.967 (3.1 %) | 0.938 (0.0 %) |
| 0.1 | **0.878** | 0.934 (6.4 %) | 0.879 (0.1 %) |
| 0.2 | **0.770** | 0.872 (13.2 %) | 0.774 (0.5 %) |
| 0.3 | **0.678** | 0.811 (19.5 %) | 0.684 (0.8 %) |
| 0.4 | **0.602** | 0.753 (25.2 %) | 0.607 (0.9 %) |
| 0.5 | **0.537** | 0.698 (30.0 %) | 0.539 (0.4 %) |
| 0.6 | **0.481** | 0.645 (34.0 %) | 0.477 (-0.8 %) |
| 0.7 | **0.433** | 0.594 (37.1 %) | 0.421 (-2.8 %) |
| 0.8 | **0.392** | 0.546 (39.2 %) | 0.369 (-5.9 %) |
| 0.9 | **0.356** | 0.500 (40.4 %) | 0.321 (-10.0 %) |
| 1 | **0.325** | 0.457 (40.6 %) | 0.275 (-15.3 %) |
| 1.2 | **0.272** | 0.376 (38.2 %) | 0.193 (-29.2 %) |
| 1.4 | **0.231** | 0.305 (32.2 %) | 0.121 (-47.5 %) |
| 1.6 | **0.197** | 0.242 (22.7 %) | 0.060 (-69.4 %) |
| 1.8 | **0.170** | 0.187 (10.1 %) | 0.010 (-94.0 %) |
| 2 | **0.148** | 0.140 (-5.2 %) | 0.029 (-80.2 %) |
| 2.5 | **0.107** | 0.052 (-51.6 %) | 0.086 (-19.4 %) |
| 3 | **0.080** | 0.001 (-98.8 %) | 0.094 (18.0 %) |

## 2. Deep-draft spar, sway (radius 0.5 m, draft 6 m)

**Reference:** MacCamy & Fuchs (1954) diffraction theory, dF/dz = (4ρgA/k)·e^{kz}/|H₁′(ka)|, integrated over the draft (deep water), with a freely floating sway RAO F/(ω²(m + A₂₂)) using the 2-D added mass A₂₂ = ρπa²T (C_a = 1). Bessel functions are checked against Abramowitz & Stegun table 9.1.

Tool default sway added mass: 4713 kg (exact strip value 4712 kg). 59,999 panels.

| ka | f Hz | **MF force kN/m** | FK force | FK + diffraction corr. | **reference RAO** | FK RAO | FK + corr. RAO |
|---|---|---|---|---|---|---|---|
| 0.05 | 0.158 | **6.973** | 3.474 (-50.2 %) | 6.947 (-0.4 %) | **0.754** | 0.376 (-50.2 %) | 0.752 (-0.4 %) |
| 0.1 | 0.223 | **10.868** | 5.375 (-50.5 %) | 10.746 (-1.1 %) | **0.588** | 0.291 (-50.5 %) | 0.581 (-1.1 %) |
| 0.2 | 0.315 | **14.340** | 6.968 (-51.4 %) | 13.910 (-3.0 %) | **0.388** | 0.188 (-51.4 %) | 0.376 (-3.0 %) |
| 0.3 | 0.386 | **15.465** | 7.408 (-52.1 %) | 14.751 (-4.6 %) | **0.279** | 0.134 (-52.1 %) | 0.266 (-4.6 %) |
| 0.5 | 0.498 | **15.409** | 7.454 (-51.6 %) | 14.716 (-4.5 %) | **0.167** | 0.081 (-51.6 %) | 0.159 (-4.5 %) |
| 0.7 | 0.590 | **13.846** | 7.272 (-47.5 %) | 14.169 (2.3 %) | **0.107** | 0.056 (-47.5 %) | 0.109 (2.3 %) |
| 1 | 0.705 | **10.564** | 6.897 (-34.7 %) | 13.075 (23.8 %) | **0.057** | 0.037 (-34.7 %) | 0.071 (23.8 %) |
