# Panel method (BEM): method and validation

Float Sim computes RAOs with a low-order panel method: the same formulation as WAMIT's low-order method. This note describes the method and how it was checked, and states where it can be trusted. Everything here is reproduced by `node test/validate-bem.mjs`.

## Why

A deep dive into the original Froude–Krylov model, which uses *estimated* added mass and damping, found it unreliable for small buoys:

- **Damping:** a fixed 15 % of critical heave damping is several times too high for a cylinder buoy, so its heave RAO peak was far too low.
- **Pitch:** the discus-like ellipsoid's pitch natural period was 46 % too long.
- **Decay:** the Kramer floating sphere's heave decay ran twice as fast as measured.

These errors come from the coefficients, not from the hydrostatics or the incident-wave pressure, so they need a radiation–diffraction solver to fix.

## Method

| Part | What it does | Reference |
|---|---|---|
| Boundary integral equation | Direct (potential) formulation with constant-strength flat triangular panels and collocation at centroids: 2πφ + ∫φ ∂G/∂n = ∫ φ<sub>n</sub> G | WAMIT User Manual v7.5, ch. 15 |
| Green function | Deep water. The Rankine parts 1/r + 1/r′ are integrated exactly over each panel; the wave part uses Newman's closed form in Struve and Bessel functions, integrated over each panel with 3 points near it and wherever the wave phase changes by more than 0.3 rad across the panel (K·size > 0.3), otherwise at its centroid | Newman (1985), J. Eng. Math. 19; Abramowitz & Stegun §9, §12 |
| Irregular frequencies | An interior waterplane "lid" with the extended integral equations (−4πφ′ on the lid) | WAMIT eq. 15.42–15.43 |
| Outputs | A(ω), B(ω) from ρ∫n<sub>i</sub>φ<sub>j</sub>; exciting forces X(ω, β) from the Haskind relation; 6-DOF RAO from [−ω²(M + A) + iω(B + B<sub>extra</sub>) + C] ξ = X about G | Newman (1962) |
| Symmetry | Mirror symmetry about one or two vertical planes is detected from the wetted surface (exact degree-5 moments). The system folds into one block per parity class: up to 16× less memory and 64× less solve work | |
| Linear solve | GMRES (restarted, unpreconditioned; the equation is of the second kind) above 600 unknowns, dense LU below it or as a fallback | Saad & Schultz (1986) |
| Meshing | Isotropic remeshing of the CAD/STL wetted surface: split > 4/3 h, collapse < 4/5 h, valence and Delaunay flips, tangential relaxation, projection onto the original surface. Sharp edges (> 35°), the waterline and symmetry cuts are kept as feature curves. Panels are refined to 2πR/20 where the radius of curvature is R, no finer than h/2. The lid is built from the waterline loops (holes such as a moonpool supported, including one that crosses a symmetry plane) and remeshed the same way | Botsch & Kobbelt (2004) |
| Parallelism | One Web Worker meshes; every worker builds its own frequency-independent Rankine matrices and solves frequencies from a queue. The worker count depends on CPU cores and a memory budget | |

The deep-water assumption holds when the depth is more than half the longest wavelength. Forward speed, second-order loads and viscous loads are not modelled. Viscous damping can be added as **extra ζ** in section 7.

## References used for validation

- **WAMIT v7** low-order runs with irregular-frequency removal, from the WEC-Sim BEMIO examples (Apache-2.0), extracted by `test/wamit_extract.py` into `test/models/wamit/`:
  - a hemisphere r = 5 m in 50 m water, compared only where Kh ≥ π (deep water)
  - an ellipsoid 9 × 3.6 m in deep water
  - the "cyl" buoy, in 3 m water, so it is used only to check the Capytaine setup
- **Capytaine 3.0** (Ancellin & Dias 2019), an open-source BEM validated against WAMIT, run by `test/capytaine_ref.py` on analytic meshes of six buoy-like bodies in deep water. Each reference is run on two meshes (h and 2h). The difference between them is recorded as the reference's own uncertainty.
- **Lamb (1932) §373:** exact added mass of a prolate spheroid.
- **Kramer et al. (2021)**, *Energies* 14, 269: heave decay of a 0.3 m floating sphere, with measured damped period T<sub>e0</sub> = 0.76 s and WAMIT coefficients at the damped natural frequency (Table A2).
- **Hulme (1982)**, *J. Fluid Mech.* 121, 443–463: the exact heave added mass and damping of a floating hemisphere in deep water, ka = 0 to 10 (`test/models/hulme/`, as tabulated in the LHEEA `Hulme_Heaving_Sphere` repository).
- **OpenFAST regression-test WAMIT runs** ([OpenFAST/r-test](https://github.com/OpenFAST/r-test), Apache-2.0): the OC3-Hywind spar (Jonkman 2010), 320 m depth, compared where Kh ≥ π. The ITI Energy barge run from the same folder was checked but not adopted; see below.

### Setting up Capytaine: direct, not indirect

Capytaine on the WAMIT "cyl" run (3 m depth) agrees to 0.1–1.4 % on A and B and to 0.5 % on |X| (phase ≤ 0.6°), except where a coefficient is near zero.

Capytaine's **default indirect (source) formulation**, however, over-predicts the lateral added mass of slender bodies. On a half-immersed prolate spheroid with c/a = 12, on one identical 2,628-panel mesh:

| Solver | A11 vs Lamb's exact value |
|---|---|
| Capytaine, indirect (default) | **+3.05 %** |
| Capytaine, direct | −0.25 % |
| Float Sim (direct) | −0.23 % |

The references therefore use the direct formulation. With the indirect one, the spar's surge added mass looked 4.2 % off, and that error was entirely the reference's.

## Results

Error is the largest |Float Sim − reference| over the frequency range, divided by the largest |reference|, for each coefficient. Coefficients that are zero by symmetry are skipped (yaw of an axisymmetric body, sway force in head seas).

- **Float Sim meshes:** "Standard" fidelity (~1,000 panels on a flat-sided hull, more on curved ones), made from the **fine STEP tessellation** through the remesher, as in the app.
- **Limits:** 2 % for surge, sway, heave and X1–X3; 5 % for the rotational and coupling terms. Sharp-edged bodies converge slowly in rotation with constant panels, and the references themselves spread by up to 4 % (cube) and 11 % (discus roll damping) between their two meshes.

| Body | Reference | Panels | Frequencies | Translational, worst | Rotational / coupling, worst | Reference's own spread (h vs 2h), largest |
|---|---|---|---|---|---|---|
| Hemisphere r 5 m | WAMIT, 50 m depth (Kh ≥ π only) | 1,224 | 28 | B33 0.78 % | B55 0.41 % | — |
| Ellipsoid 9 × 3.6 m, draft 1.8 m | WAMIT, deep | 1,148 | 50 | B33 1.58 % | B55 2.67 % | — |
| Cylinder buoy a 0.35, draft 0.63 m | Capytaine | 2,956 | 12 | B33 0.50 % | B44 0.38 % | B33 1.1 % |
| Kramer sphere D 0.3 m | Capytaine | 1,232 | 12 | B22 1.01 % | B15 1.43 % | B44 2.8 % |
| Discus cylinder r 0.5, draft 0.2 m | Capytaine | 1,220 | 12 | B33 0.90 % | B15 4.44 % | B44 10.9 % |
| Cube 1 m, draft 0.85 m | Capytaine | 1,108 | 11 | A33 0.78 % | A24 3.74 % | A44 3.7 % |
| Log Ø0.4 × 3 m, half immersed | Capytaine | 4,768 | 11 | B11 0.83 % | A15 1.49 % | B33 6.2 % |
| Spar a 0.5, draft 6 m | Capytaine | 4,412 | 11 | X3 0.35 % | B44 0.26 % | B33 3.6 % |

Infinite-frequency added mass against WAMIT: hemisphere A∞33 −0.26 %, A∞11 −0.14 %; ellipsoid A∞33 −0.56 %, A∞11 +1.89 %.

The largest differences are in the rotational and coupling terms of the two sharp-edged bodies (cube, discus). There the references themselves move by 4–11 % between their two meshes, so these differences are within the references' uncertainty.

### Known models: exact solution, offshore wind platforms, moonpool

Meshed as the app does: `panelSize` at Standard fidelity, so panels shrink to λ/7 at the top frequency.

| Body | Reference | Panels + lid | Result |
|---|---|---|---|
| Floating hemisphere, ka = 0 … 10 | Hulme (1982), exact | 2,160 + 1,184 | a33 within 0.26 % at every ka (0.16 % of peak), b33 0.20 % of peak; a33(∞) −0.17 % vs ½. This covers the long waves the 50 m-deep WAMIT run cannot |
| OC3-Hywind spar, draft 120 m, ω 0.35–2 rad/s | WAMIT (OpenFAST r-test), 320 m depth | 2,060 + 20 | added mass ≤ 2.1 %, damping ≤ 4.0 % (B22 near 1.3 rad/s), X ≤ 2.2 %. At Very fine (7,564 panels) every coefficient is within 1.1 %, so the Standard differences are panel resolution, not a disagreement |
| ITI barge hull 40 × 40 m, draft 4 m, ω 0.3–2 rad/s | Capytaine, direct, 1 m panels + lid | 1,328 + 872 | translational ≤ 1.0 %, rotational and coupling ≤ 2.5 % |
| ITI barge with its 10 × 10 m moonpool | Capytaine, same set-up | 1,300 + 868 | the moonpool piston mode (1.10 rad/s) and first sloshing mode (1.80 rad/s) fall at the same frequencies in both codes; elsewhere within about 1 % |

**The ITI barge WAMIT run was not adopted.** Its heave and pitch coefficients agree with both Float Sim and Capytaine on a plain 40 × 40 × 4 m box: B33 and B55 within 1–3 %. Its surge added mass, however, sits about 200 m³·ρ (≈ 205 t in sea water) above both at every frequency, and A∞11 is 29 % higher. The folder has no geometry or `.out` file, and its hydrostatics file is hand-rounded: it pairs the full 40 × 40 m waterplane (no moonpool) with the displaced volume of the hull with the moonpool. So the run's surge model can't be reproduced. Float Sim and Capytaine agree on the box to 1 %.

**Not used:** the OC4 DeepCwind semi-submersible WAMIT run in the same folder includes the 1.6 m pontoons and cross braces (its waterplane area is 7.6 m² larger than the columns', from three braces cut at 38°), which needs CAD booleans to rebuild. The Kramer sphere's measured time series are published as MDPI supplementary files, which block automated downloads; the drop test is checked against the paper's measured period and the WAMIT decay rate instead.

#### Two fixes found by these checks

1. **High-frequency damping of large flat hulls.** On the barge, the heave and pitch damping fell away above 1.5 rad/s and went **negative** above 1.8 rad/s (B33 = −466 at 2 rad/s, where WAMIT gives 254 and Capytaine 283). Radiation damping is radiated wave energy, so it cannot be negative. The panels were fine enough (λ/7): the cause was the wave part of the Green function being taken at the centroid of each distant panel, which misses the wave phase change of about 1 rad across a λ/7 panel. On a large flat bottom those errors add up instead of cancelling. Integrating with 3 points once K·size > 0.3 fixes it at the same panel size:

   | Barge, Standard | B33 at 1.5 / 1.8 / 2.0 rad/s | B55 at 2.0 rad/s | Max error vs WAMIT, B33 / B55 |
   |---|---|---|---|
   | centroid rule (before) | 1,315 / −5 / −466 | −5,921 | 11.6 % / 6.0 % |
   | 3 points where K·size > 0.3 (now) | 1,429 / 522 / 252 | 12,072 | 1.5 % / 2.6 % |
   | Capytaine, 1 m panels | 1,456 / 545 / 283 | 12,881 | |
   | WAMIT | 1,481 / 538 / 254 | 12,724 | |

   Results for the other bodies moved by at most 0.05 percentage points, because their errors come from elsewhere. The app now also warns if any diagonal damping comes out negative, which would mean the panels are too coarse for the top frequencies.
2. **Moonpool lids on symmetric hulls.** With a symmetry plane, the lid is built for one half or quarter of the waterplane. A moonpool that crossed the plane became a cut-open hole that touched the cut, the triangulation failed, and the hull silently got **no lid**, so irregular frequencies were not removed. A moonpool on the centreline is the usual case. The lid now falls back to triangulating the whole waterplane and cutting it at the symmetry planes, like the hull. The app warns if a lid still cannot be built.

### Meshing

The remeshed wetted surface plus its lid encloses the displaced volume, and the lid covers the waterplane. Both are compared with the exact hydrostatics of the CAD mesh. Triangle quality is q = 4√3·area / Σ edge² (1 for an equilateral triangle).

| STEP body | Panels + lid | Quality min / mean | Displaced volume | Lid vs waterplane area | Symmetry | Time |
|---|---|---|---|---|---|---|
| sphere_r1 (s.g. ½) | 1,256 + 600 | 0.74 / 0.964 | −0.46 % | −0.16 % | 2 planes | 0.4 s |
| buoy_cyl | 2,668 + 344 | 0.77 / 0.968 | −0.12 % | −0.16 % | 2 planes | 0.5 s |
| kramer_sphere | 1,232 + 564 | 0.71 / 0.960 | −0.47 % | −0.12 % | 2 planes | 0.3 s |
| cube_1m (s.g. 0.85) | 1,108 + 264 | 0.69 / 0.956 | 0.00 % | 0.00 % | 2 planes | 0.02 s |
| box_4x2x1 | 1,396 + 776 | 0.78 / 0.951 | 0.00 % | 0.00 % | 2 planes | 0.03 s |
| hcyl_log | 4,768 + 748 | 0.60 / 0.956 | −0.36 % | 0.00 % | 2 planes | 4.3 s |
| v_prism | 1,132 + 580 | 0.74 / 0.951 | 0.00 % | 0.00 % | 2 planes | 0.03 s |
| vcyl_squat | 1,244 + 636 | 0.74 / 0.952 | −0.10 % | −0.15 % | 2 planes | 0.06 s |
| spar | 4,400 + 64 | 0.75 / 0.961 | −0.51 % | −0.64 % | 2 planes | 3.7 s |
| box_moved (yawed 30° in the file) | 1,408 + 796 | 0.71 / 0.971 | 0.00 % | 0.00 % | none: its planes are at 30° (the app removes the yaw first) | 0.2 s |

The volume deficits on curved hulls are chordal faceting: flat panels whose vertices lie on the surface cut inside it. Before remeshing, OpenCascade's tessellation of the cylinders was long slivers (aspect ratio over 100), which a constant-panel method handles poorly.

### RAOs

A full RAO comparison with Capytaine run on its own, covering all 12 test models over 0.01–1 Hz and headings 0–180°, is in [rao-compare/README.md](rao-compare/README.md). Away from resonances the two agree within 4.3 % of peak, and natural frequencies agree within 1.2 %.

The same equations of motion for the cylinder buoy, solved with Float Sim's coefficients and with Capytaine's (heading 0°, no extra damping):

| Quantity | Float Sim | With Capytaine's A, B, X | Difference |
|---|---|---|---|
| Heave natural frequency | 3.432 rad/s | 3.434 rad/s | −0.03 % |
| Heave RAO peak | 10.51 m/m at 3.42 rad/s | 10.58 m/m at 3.44 rad/s | −0.7 % |
| Pitch RAO peak | 4,775 °/m at 2.51 rad/s | 4,853 °/m at 2.51 rad/s | −1.6 % |

These are potential-flow peaks. The heave peak of 10.5 m/m and the pitch peak of thousands of degrees per metre come from radiation damping of only a few percent of critical; a real buoy is limited by viscous damping and nonlinearity. GMRES and LU solutions agree to 1×10⁻⁶.

### Kramer et al. (2021) sphere decay

The drop test uses the panel-method added mass and damping at the heave natural frequency. These come from a quick coarse sweep, the same path the app takes the first time.

| Quantity | Before (estimates) | Panel method | Kramer et al. |
|---|---|---|---|
| A33 at ω<sub>n</sub> | 4.49 kg (floating-disk estimate) | 3.01 kg (+1.5 %) | 2.97 kg (WAMIT) |
| B33 at ω<sub>n</sub> | ζ = 0.15 fixed | 13.81 N·s/m (−1.0 %) | 13.95 N·s/m (WAMIT) |
| Linear damped period | — | 0.761 s (+0.1 %) | 0.76 s (measured) |
| Drop test from H<sub>0</sub> = 0.1D: damped period | 0.720 s | 0.755 s (−0.6 %) | 0.76 s (measured) |
| Drop test: decay rate | 1.43 1/s | 0.678 1/s (−2.4 %) | 0.695 1/s (WAMIT LPF0) |

The drop test previously scaled the floating added mass by the submerged fraction. A body floating half-submerged therefore got half its added mass at its float position, which shortened the period. It now scales relative to the float position: zero in air, the full floating value at the float draft and below.

### Before and after on buoys

The same equations of motion (mass, inertia and restoring from the CAD mesh) solved with three sets of hydrodynamic coefficients: the old estimates (Froude–Krylov excitation with the long-wave diffraction correction in surge and sway), the panel method, and Capytaine's coefficients. Heading 0°, no extra damping.

| Body | Quantity | Estimates (before) | Panel method | Capytaine coefficients |
|---|---|---|---|---|
| Cylinder buoy a 0.35, T 0.63 m | heave T<sub>n</sub> | 1.770 s | 1.831 s | 1.830 s |
|  | pitch T<sub>n</sub> | 2.433 s | 2.545 s | 2.545 s |
|  | heave damping at T<sub>n</sub> | ζ 15.0 % | ζ 1.6 % | ζ 1.6 % |
|  | heave RAO peak | 1.57 m/m | 10.75 m/m | 10.73 m/m |
| Kramer sphere D 0.3 m | heave T<sub>n</sub> | 0.812 s | 0.757 s | 0.757 s |
|  | pitch T<sub>n</sub> | 1.316 s | 1.127 s | 1.127 s |
|  | heave damping at T<sub>n</sub> | ζ 15.0 % | ζ 8.3 % | ζ 8.3 % |
|  | heave RAO peak | 1.77 m/m | 1.89 m/m | 1.90 m/m |
| Discus cylinder r 0.5, T 0.2 m | heave T<sub>n</sub> | 1.288 s | 1.331 s | 1.329 s |
|  | pitch T<sub>n</sub> | 1.764 s | 1.500 s | 1.497 s |
|  | heave damping at T<sub>n</sub> | ζ 15.0 % | ζ 8.4 % | ζ 8.5 % |
|  | heave RAO peak | 1.84 m/m | 1.74 m/m | 1.73 m/m |

The estimates got the natural periods wrong by 3–18 % and the heave damping by up to 9×. The panel method matches Capytaine to within 0.2 % on the periods and 1 % on the RAO peaks. (T<sub>n</sub> is the uncoupled natural period with frequency-dependent added mass.)

## Performance

On a 16-core desktop, in Node (one thread) and in the browser (8 workers). The per-frequency times were measured with the centroid rule for distant panels. With the 3-point rule above K·size = 0.3 (see the fixes above), the validation cases, which run up to the λ/7 frequency, take 1.4–1.9× longer. The app's 80-frequency browser sweep below went from 33.8 s to 34.3 s.

| Case | Panels + lid | Unknowns per class × classes | Time per frequency (one thread) | Memory per worker |
|---|---|---|---|---|
| Discus, Standard | 1,220 + 644 | 466 × 4 | 1.0 s | 5 MB |
| Kramer sphere, Standard | 1,232 + 572 | 451 × 4 | 1.2 s | 5 MB |
| Cylinder buoy, Standard | 2,956 + 288 | 811 × 4 | 4.1 s | 16 MB |
| Spar, Standard | 4,412 + 52 | 1,116 × 4 | 10 s | 30 MB |
| Box, no symmetry (yawed in the file), Standard | 1,408 + 796 | 2,204 × 1 | 4.0–4.6 s | 117 MB |

- **Browser, 8 workers:** 24 frequencies on the 4 × 2 m box at Standard (1,380 + 784 panels) take 10 s, and 80 frequencies about 30 s.
- **Quick coarse sweep** used for the simulators: 12 frequencies, about 1–2 s.
- **Large hulls:** unknowns per symmetry class are capped at about 4,000 (≈ 400 MB per worker); the app coarsens the mesh and says so if a fidelity level would exceed that.
- **Where the time goes:** the wave part of the Green function (a Struve/Bessel evaluation plus two short quadratures per panel pair) dominates. Above K·size = 0.3 it is evaluated at 3 points per panel, so the upper part of a sweep costs 2–3× more per frequency than the lower part; a Standard sweep up to the λ/7 frequency takes about 1.5–1.9× as long as with the centroid rule. A tabulated Green function would be the next speed-up.

## Limits

- **Deep water only.** The app solves the deep-water problem; finite-depth results differ once the depth is below about half the wavelength.
- **Flat panels:** a Standard mesh loses 0.1–0.5 % of the displaced volume on curved hulls (chordal faceting). Thin, sharp tips, such as the needle end of a slender spheroid, are not resolved, so the tiny axial added mass there is off by tens of percent. Check convergence with Fine or Very fine.
- **Sharp-edged bodies** (boxes, discs) converge slowly in the rotational modes: 2–5 % at Standard.
- **Moonpools** have piston and sloshing resonances that potential flow leaves undamped, so the coefficients and RAOs spike there. In reality the peaks are limited by viscous losses at the moonpool edges.
- **Potential flow has almost no roll damping**, so roll RAO peaks of buoys and barges are far higher than reality without extra ζ. The app warns when a resonance has under 2 % of critical damping.
- **Time domain:** the simulators use constant coefficients at the natural frequencies, not a Cummins convolution, so wave-frequency responses away from resonance carry the frequency-dependence error of A and B there.
