# Float Sim validation map

24 November 2026

Every core part of Float Sim, and the evidence that it is right. Each part is checked at up to three levels:

- **Proven:** the formula or identity the code implements is a machine-checked theorem (Lean 4 + Mathlib, in `proofs/`). No step is taken on trust, but a proof covers the mathematics, not the JavaScript.
- **Implemented:** a test runs Float Sim's own code and checks it against that formula, identity or exact answer.
- **Confirmed:** Float Sim's results agree with an independent reference: a published exact solution, another code (WAMIT, Capytaine), a measurement, or a conservation law.

A dash marks a level that is not covered. The gaps are listed after the tables.

## Overview

| Core part | Proven | Implemented | Confirmed |
| --- | --- | --- | --- |
| Geometry import (STEP, STL, units) | — | 8 exact B-rep STEP bodies through OpenCascade, as the app imports them (`validate-node`); shells checked closed and oriented (`make_models.py`) | Closed-form volumes; faceting error by mesh quality: Fine 0.026 %, Normal 0.22 %, Coarse 1.8 % |
| Mass properties and inertia | Huygens–Steiner for any set of masses; the shifts to and from G undo each other; a symmetric tensor stays symmetric when moved; a shift never lowers a moment (`Inertia`) | Solid box about its corner (`validate-refcsys`); Python port of the mass-property routine (`verify_physics.py`) | I = m(b² + c²)/3, I<sub>xy</sub> = −mab/4 |
| Hydrostatics (waterline, displacement, KB, BM, GM) | Draft from Archimedes; KB and the waterplane second moment from their integrals; box and V-section BM; the test boxes' GM (`Hydrostatics`) | Float Sim on 8 STEP models against the proved values, 16 checks (`validate-proofs`); 14 cases against closed forms (`validate-node`); Python port, 126 checks (`validate.py`) | Rawson & Tupper, Barrass & Derrett, Biran |
| Upright stability | Cube stable only for s.g. < ½ − √3/6 or > ½ + √3/6; cylinder only for r/H > √(2s(1 − s)) (`Stability`) | Verdicts for 5 bodies against the proved criteria (`validate-proofs`) | Erdős et al., Am. J. Phys. 60 (1992) |
| Righting arm (GZ) curves | — | Wall-sided formula and circular sections (`validate-node`) | Rawson & Tupper (wall-sided GZ) |
| Free-float equilibrium (calm water) | — | List from an off-centre CoG, cube and square log settling corner-down (`validate-node`); Python port of the simulator (`simcheck.py`) | Wall-sided list angle; Erdős et al. |
| Reference csys and frames | The elementary rotations, as entered in `js/physics.js`, are rotations; both angle orders are rotations; the turning-axes transpose identity that `anglesFor` uses; points survive the round trip into the csys and back; distances are kept (`Frames`); `toEulerDeg` reads back exactly the angles a rotation was built from while pitch is inside ±90°, and at ±90° returns angles that rebuild the same rotation (`Euler`) | Axes, orthonormality, det 1, round trips, angles recovered, a Y-up export, a general CAD csys (`validate-refcsys`, 39 checks); angle read-back over 20,000 rotations and at gimbal lock (`validate-proofs`); browser test section 10 | A box in a general csys gives the same RAOs as the box given directly (≤ 1.3×10⁻⁹) |
| Motions and loads at a point | Power is the same at O and G for ξ<sub>O</sub> = ξ<sub>G</sub> + θ × d, M<sub>O</sub> = M<sub>G</sub> − d × F, also for complex amplitudes; the `transferToG` matrix is exactly that transfer; energy is unchanged by A ↦ TᵀAT (`PointTransfer`); the phase factor e<sup>ik·d</sup> (`WavePhase`) | Power invariance, transferToG, point motion (`validate-refcsys`) | Time-domain motion of a point: 1.5 % and 1.3° |
| Waves and spectra | — | PM and JONSWAP moments, synthesis variance, regular waves from inputs, wave drift (`validate-waves`) | DNV-RP-C205; Hasselmann 1973; Stokes 1847; Longuet-Higgins 1977 |
| Froude–Krylov loads and the long-wave correction | — | Box heave force against the closed form, 10⁻⁹ (`validate-waves`) | Faltinsen §3; MacCamy–Fuchs (spar, ≤ 4.6 %); Hulme/Haskind (hemisphere, ≤ 0.9 %); trade study |
| Panel method: added mass, damping, wave forces | — | Bessel and Struve functions against SciPy (10⁻⁸); GMRES against LU; meshing of 10 bodies (`validate-bem`) | WAMIT (≤ 1.6 % translational, ≤ 4.7 % rotational), Capytaine, Hulme exact (≤ 0.26 %), Lamb exact (0.2 %), Kramer et al. measured decay; Haskind energy relation within 3 % on 12 bodies |
| RAOs and natural frequencies | — | Long-wave limits, undamped resonance at √(C/(m + A)) (`validate-waves`) | Capytaine run on its own, 12 models: within 4.3 % of peak away from resonances, natural frequencies within 1.2 % (`rao-compare`); Hulme heave RAO |
| Time-domain wave simulation | — | Small regular waves against the linear RAO, ≤ 1.3 %; 20 min irregular sea statistics (`validate-waves`) | Spectral theory: heave 1.7 %, roll 7.2 % |
| Drop and rise test | — | Fall in air and water, added mass at entry, settling (`validate-drop`) | Kramer et al. (2021) measured period, −0.6 %; Hoerner drag |
| Mooring | — | Catenary closed forms, lumped-mass line at rest, 6 × 6 stiffness by finite differences (`validate-smallbody`) | Faltinsen eq. 8.12, 8.17; Jonkman 2007 |
| Viscous drag and heave plates | — | Quadratic-drag decay per cycle; heave-plate response (`validate-smallbody`) | Morison; Lorentz linearisation; Borgman 1967 |
| Wind | — | Frøya spectrum variance, windage force and moment, steady heel (`validate-smallbody`) | DNV-RP-C205 §2.3 |
| Tracked points and wave following | — | Point acceleration, time above water, ideal follower (`validate-smallbody`) | RAO kinematics; Rice 1944 |
| Solve with Capytaine (local helper) | — | Same mesh as the built-in solver: within 0.5 % translational, 2.1 % rotational; API guards; cancel (`validate-capytaine`); browser test section 11 | Capytaine itself |
| User interface and workflow | — | 128 browser checks, every stage and tool (`e2e-browser`) | — |

## Proven: the theorems

All proofs build with `lake build` in `proofs/` and use only Lean's three standard axioms (propext, Classical.choice, Quot.sound). There is no `sorry`. `lake exe expected` evaluates the proved formulas exactly for the test models and writes `proofs/expected.json`, which `test/validate-proofs.mjs` compares Float Sim with.

| File | Theorem | What it proves | Code it backs | Test that checks the code |
| --- | --- | --- | --- | --- |
| Hydrostatics | `boxDraft_floats` | At draft m/(ρLB) the displaced mass equals the body's mass | `solveWaterline` | `validate-proofs` |
| Hydrostatics | `rect_second_moment` | ∫ L y² dy over the beam = L·B³/12 | `submerged` (waterplane moments) | `validate-proofs` |
| Hydrostatics | `box_KB`, `box_BM` | KB = T/2 from the centroid integral; BM = B²/(12T) | `hydrostatics` | `validate-proofs` |
| Hydrostatics | `vsection_KB`, `vsection_BM` | V-section: KB = 2T/3; BM = (2/3)·T·tan²α | `hydrostatics` | `validate-proofs` (v_prism) |
| Hydrostatics | `box_fresh_draft`, `box_fresh_GM` | The 4 × 2 m test box: T = 2/5 m, GM<sub>T</sub> = 8/15 m, GM<sub>L</sub> = 91/30 m | `hydrostatics` | `validate-proofs` |
| Stability | `cube_stable_iff` | Upright cube stable ⇔ s < ½ − √3/6 or s > ½ + √3/6 | `hydrostatics` (GM sign) | `validate-proofs` (3 cubes) |
| Stability | `cyl_stable_iff` | Upright cylinder stable ⇔ r/H > √(2s(1 − s)) | `hydrostatics` (GM sign) | `validate-proofs` (2 cylinders) |
| Inertia | `steiner` | I<sub>O</sub> = I<sub>G</sub> + m(\|r\|²E − r rᵀ), r = G − O, for any set of masses with centre G | `inertiaAboutPoint`, `inertiaToG` (js/refcsys.js) | `validate-refcsys` |
| Inertia | `shift_round_trip`, `shift_symm`, `shift_diag_nonneg` | The two shifts undo each other; the shift is symmetric; it never lowers a moment | same | `validate-refcsys` |
| Inertia | `shifted_symm` | A symmetric tensor stays symmetric when moved to the point or back to G | same | `validate-refcsys` |
| Frames | `Rx_orth` … `Rz_det` | `rotX`, `rotY`, `rotZ` (entered as in js/physics.js) are rotations | `mat3.rotX/rotY/rotZ` | `validate-refcsys` |
| Frames | `fixedXYZ_orth`, `movingXYZ_orth`, `…_det` | Both angle orders of `refFrame` give rotations | `refFrame` | `validate-refcsys` |
| Frames | `movingXYZ_transpose` | (Rx(a)Ry(b)Rz(c))ᵀ = Rz(−c)Ry(−b)Rx(−a), the identity `anglesFor` uses | `anglesFor` | `validate-refcsys` |
| Frames | `ref_round_trip`, `ref_round_trip'`, `ref_preserves_dot` | Into the csys and back changes nothing; lengths and angles are kept | `toRefTris`, `toRefPoint`, `fromRefPoint` | `validate-refcsys` |
| Euler | `hypot78_eq` | The branch test hypot(m₇, m₈) equals \|cos pitch\| | `mat3.toEulerDeg` (branch test) | `validate-proofs` |
| Euler | `toEuler_main` | For roll and yaw in (−180°, 180°] and pitch strictly inside ±90°, [atan2(m₇, m₈), atan2(−m₆, hypot(m₇, m₈)), atan2(m₃, m₀)] returns exactly the angles of Rz(yaw)·Ry(pitch)·Rx(roll) | `mat3.toEulerDeg` (main branch) | `validate-proofs` (20,000 rotations, 4×10⁻¹⁴°); `validate-refcsys` |
| Euler | `lock_branch_taken`, `toEuler_lock_up`, `toEuler_lock_down` | At pitch ±90° the branch test is 0; only roll ∓ yaw is defined, and the gimbal-lock branch [atan2(−m₅, m₄), ±90°, 0] rebuilds exactly the same rotation | `mat3.toEulerDeg` (gimbal-lock branch) | `validate-proofs`; `validate-refcsys` (Y = ±90°) |
| PointTransfer | `power_invariant`, `complex_power_invariant` | F·ξ̄ + M·θ̄ is the same at O and G | `raoAtPoint`, `forcesAtPoint` | `validate-refcsys` (≤ 10⁻¹²) |
| PointTransfer | `T_mulVec` | `transferToG`'s matrix, entry by entry from js/bem.js, maps (ξ, θ) to (ξ + θ × r, θ) | `transferToG` | `validate-refcsys` |
| PointTransfer | `quadratic_transfer` | (Tv)ᵀA(Tv) = vᵀ(TᵀAT)v | `transferToG` | `validate-refcsys` |
| WavePhase | `wave_shift`, `rao_at_point` | The wave at G + d is the wave at G times e<sup>−ik·d</sup>, so an RAO re-referenced to O gains e<sup>+ik·d</sup> | `raoAtPoint` | `validate-refcsys` |

**Taken as given or not covered:**

- The second moment of a circle, πr⁴/4, is a standard result that is not proved here. π cancels in the cylinder's BM.
- `Math.atan2(y, x)` is modelled as the argument of x + iy in (−π, π], which is its value whenever (x, y) ≠ (0, 0).
- Proofs are about exact real numbers. Floating-point round-off in the JavaScript is checked by the tests, not by the proofs.
- Within 6×10⁻⁸° of ±90° (0 < cos pitch ≤ 10⁻⁹), `toEulerDeg` takes the gimbal-lock branch and reports pitch as exactly ±90°. The proof does not cover that band. There the rebuilt rotation differs by at most cos pitch ≤ 10⁻⁹ in its entries (measured 1.7×10⁻¹⁰).
- The proof found an inaccuracy that is now fixed. `toEulerDeg` used asin(−m₆) and switched to the gimbal-lock formula 0.081° from ±90°, where angles were off by up to 0.08°. It now reads pitch with atan2(−m₆, hypot(m₇, m₈)), and away from that tiny band every rotation rebuilds to rounding error (10⁻¹⁵).

## Gaps and next proofs

- **Good next proofs:** the wall-sided GZ formula, GZ = sin φ (GM + ½ BM tan²φ); the catenary equations of the mooring model; the exact Pierson–Moskowitz spectrum moments (Γ-function integrals); the circle's second moment.
- **Not practical to prove:** the panel method (free-surface Green function, Haskind relation, convergence), the time-domain integrators, drag linearisation and floating-point round-off. These rest on comparisons with exact solutions, other codes and measurements, and on conservation laws.
- **Not covered at all:** STL import and mesh repair have no test of their own, and the user interface has no independent reference.

## How to run

| Command | What it runs | Result (2026-11-24) |
| --- | --- | --- |
| `cd proofs && lake build` | Checks every proof | 8 files, no errors |
| `cd proofs && lake exe expected` | Writes `proofs/expected.json` | 8 test models |
| `node test/validate-proofs.mjs` | Float Sim's hydrostatics, `test/models/expected.json` and `mat3.toEulerDeg` against the proved values and theorems | 18/18 |
| `node test/validate-node.mjs [fine\|normal\|coarse]` | Hydrostatics, stability, GZ, waves, simulators, drop test; at fine also small-body and reference-csys checks | 361/361 fine, 264/264 normal and coarse |
| `node test/validate-bem.mjs` | Panel method | 35/35 |
| `FLOATSIM_PYTHON=… node test/validate-capytaine.mjs` | Solve with Capytaine helper | 7/7 |
| `node test/e2e-browser.mjs` | The app in Chromium | 128/128 |
| `python3 test/validate.py`, `python3 test/simcheck.py`, `python3 test/verify_physics.py` | Python ports of the hydrostatic solver, the simulator and the mass-property routine | 126/126, 2/2, all pass |
| `test/rao-compare/` scripts | RAOs against Capytaine run on its own | [rao-solver-review.md](rao-solver-review.md) |

Lean needs elan (`curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh`). `lake exe cache get` in `proofs/` then downloads Mathlib's prebuilt files, about 7 GB.
