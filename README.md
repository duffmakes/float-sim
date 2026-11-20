# Float Sim

Browser-based hydrostatics and stability tool for CAD bodies. Runs entirely locally; all libraries are in `vendor/`.

```bash
./serve.sh          # then open http://localhost:8765
```

## What it does

- **Imports STEP / IGES / BREP** files (via `occt-import-js`, OpenCascade compiled to WASM) and **STL**. The STEP geometry is converted to millimetres; pick other units for STL.
- **Inputs:** mass, CoG (x, y, z in model coordinates), fresh (1000 kg/m³), salt (1025 kg/m³) or custom water, and an initial roll/pitch/yaw.
- **Moments of inertia:** computed from the geometry for uniform density, or entered as a custom tensor (kg·m² about the CoG, model axes). There's a sign option for CAD tools that report products of inertia as +∫xy dm. Custom values are checked for positive-definiteness and the triangle inequality, and are used by the hydrostatic periods, both simulators and the RAOs.
- **Static float solve:** for the chosen attitude, finds the waterline where buoyancy = weight, then shows
  - the waterline outline, **G** (CoG), **B** (centre of buoyancy) and the weight/buoyancy force arrows
  - **M<sub>T</sub>, M<sub>L</sub>** (roll and pitch metacentres): BM = I<sub>waterplane</sub> / V
  - draft, freeboard, displaced volume, reserve buoyancy, immersion rate
  - KB, KG, BM, **GM** (roll, pitch, and the weakest waterplane axis), righting moment per degree, approximate heave/roll/pitch periods
  - a plain-language stability verdict, and a warning if the attitude is not at rest (B not under G)
- **GZ righting-arm curve** (0–180°, roll or pitch) with max GZ, the angle where it peaks, and the angle of vanishing stability.
- **Free-float simulation:** a 6-DOF rigid body with damping, released from the chosen attitude so it settles into a stable floating attitude (for example, a 1 m cube at half draft rolls onto an edge). **Settle (fast)** runs it to rest and copies the attitude back.
- **Target float plane → mass:** give a draft, a waterline height in model Z, or a submerged-volume %, and get the mass needed for it. It also tells you where the CoG has to be for that attitude to be in equilibrium. **Preview plane** draws it.

## Sea states, wave spectra and RAOs

- **Sea state 0–5** from the NATO STANAG 4194 open-ocean North Atlantic table (Lee & Bales; as reproduced in USNA EN400 ch. 8, Table 8.1): Hs 0 / 0.05 / 0.3 / 0.88 / 1.88 / 3.25 m with most-probable modal periods Tp 7.5 / 7.5 / 8.8 / 9.7 s for SS2–5. The table gives no period for SS0–1, so SS1 uses the fully developed Pierson–Moskowitz relation (Tp ≈ 1.12 s). Hs and Tp stay editable.
- **Spectra** (DNV-RP-C205 §3.5.5):
  - Two-parameter Pierson–Moskowitz.
  - JONSWAP (Hasselmann et al. 1973), with γ, σ = 0.07/0.09 and A<sub>γ</sub> = 1 − 0.287 ln γ, plus the DNV γ(Tp/√Hs) option.
  - The spectrum plot marks the body's natural heave, roll and pitch frequencies and warns when one falls inside the spectral peak.
- **Irregular sea:** random-phase superposition (seeded), long-crested or cos<sup>2s</sup> short-crested.
- **Regular waves** (the *Regular waves* switch in section 7): a single Airy wave from your own height, period and heading, not tied to any spectrum or sea state.
  - Height can mean the crest-to-trough height H (amplitude H/2) or a significant height Hs with the same energy (amplitude Hs/2√2, since a sinusoid has σ = A/√2).
  - Reports wavelength, celerity and steepness H/λ (warns above 1/20 and at the 1/7 breaking limit), and warns when the period is within 15 % of a natural period.
  - Shows the linear steady-state heave, roll and pitch (|RAO| × A) during the 3D run. **Run statistics** simulates 5 min and compares the measured steady-state amplitudes against that prediction.
- **Time-domain stability in waves:**
  - Loads are Wheeler-stretched Froude–Krylov pressure integrated over the *instantaneous* wetted hull (nonlinear in body motion and wave elevation), plus gravity, estimated added mass and linear damping per mode.
  - **Run in waves** animates it in 3D. **Run statistics** simulates 20 min in a Web Worker and reports significant and maximum roll, pitch and heave, green water on deck and capsize. A verdict compares maximum roll against the GZ range of stability, e.g. "SS3: max roll 7.73° of 109° range: safe".
- **Sea-state table:** a linear spectral estimate (|RAO|²·S) for SS1–5 at the chosen heading: significant amplitudes, most-probable 3-hour maximum roll, and a verdict. Sea states whose waves are short relative to the body (D/λ > 0.2) are flagged.
- **RAOs:**
  - Enter a frequency range **in Hz** (the equivalent rad/s, periods and wavelengths are shown) and a list or range of incident headings (e.g. `0:15:180`). A progress bar shows the sweep, and the RAO tab shows a loading indicator while plots render.
  - The 6-DOF linear frequency-domain model about G is solved at every (ω, β): hydrostatic restoring matrix, mass and inertia, estimated added mass and damping, and Froude–Krylov excitation on the mean wetted surface (Faltinsen 1990; Journée & Massie 2001).
  - Plots: amplitude (m/m, deg/m or deg per degree of wave slope), phase, and a heading × frequency heatmap.
  - Also reports the response in the current sea state, computed from the sweep and cached.
  - **Export CSV** gives amplitudes and phases per heading and frequency. **Export raw CSV** gives complex RAOs (re/im), excitation forces per DOF, and the model's mass, added-mass, damping and restoring matrices as header comments.
- **Long-wave diffraction correction** (G.I. Taylor): Froude–Krylov alone captures only ρ∫a dV (C_m = 1). The correction adds A<sub>jj</sub> × the incident acceleration averaged over the submerged volume, computed with an exact cone quadrature. It is applied identically in the RAO solver and the time-domain simulator. Defaults are on for surge and sway, off for heave, as justified by the trade study below.
- **Added-mass defaults** (editable): heave uses a floating elliptic disk of the waterplane's area and aspect ratio, (2/3)πρab²/E(e) (Lamb §373). Surge and sway use whichever strip direction suits the body's proportions. A spar gets ρπa²T (C<sub>a</sub> = 1) and a ship-like hull gets ρπT²L/2.

## Drop / rise test

Section 9 releases the body from a chosen CoG height, above or below the still-water surface, at the current orientation, with an optional initial vertical speed. You can watch it fall in, plunge and recover, or rise from depth, break the surface and settle. It's deliberately simple:
- gravity, water buoyancy at B, and air buoyancy at the dry-volume centroid
- quadratic drag ½ρC<sub>d</sub>A⊥|v|v on the CoG velocity, with A⊥ the hull's projected area normal to the motion, and water/air blended by the submerged fraction. Water and air C<sub>d</sub> are editable, with presets from Hoerner, *Fluid-Dynamic Drag*.
- added mass and rotational water damping scaled by submergence
- linear wave-making damping while the body pierces the surface

The **Drop test** tab plots CoG height, vertical speed and attitude, and reports water-entry speed, deepest plunge, surface breach, overshoot and settle time. While the body is placed, the sea-state, statistics, sea-state table, RAO and calm-simulate tools are locked until **Reset position**. No slamming pressures, splash or air-cavity effects are modelled.

## Method

The body is triangulated and each triangle is clipped to the part below the waterplane. Tetrahedra are taken from a point *on* the waterplane, so the waterplane "cap" adds nothing and the clipped surface gives the exact submerged volume and B. The cut edges form the waterplane boundary, and Green's theorem on them gives area, centroid and second moments (I<sub>xx</sub>, I<sub>yy</sub>, I<sub>xy</sub>). The waterline is solved by safeguarded Newton (dV/dz = waterplane area). `test/verify_physics.py` is a direct Python port of the core routine, checked against closed-form results (cube, box barge upright and heeled, half-submerged cylinder).

## Assumptions and limits

- Rigid body. The inertia assumes **uniform density**. The calm-water periods in the Hydrostatics tab ignore added mass, so they are indicative only. The seakeeping model includes estimated added mass.
- **Waves:**
  - Linear incident waves with Froude–Krylov loads plus an optional long-wave diffraction correction: **no full diffraction/radiation (BEM) solution**.
  - Added mass and damping are editable, frequency-independent *estimates*. Near resonance these estimates dominate the error, so enter known values where you have them (see the trade study).
  - Results are reliable when the body is small relative to the wavelength (D/λ ≤ 0.2). The app flags it when this isn't the case.
  - Zero forward speed, deep water, no breaking waves.
  - A free-floating body drifts downwave. With no mooring or viscous drag, the drift speed is indicative only.
- STANAG values are open-ocean North Atlantic typicals.
- The mesh should be closed (watertight). The model panel reports open edges. Overlapping bodies in an assembly double-count volume.
- GZ curves are at fixed trim (the body isn't allowed to re-trim as it heels).
- Coordinates: Z is up. Roll is about X, pitch about Y, yaw about Z, applied in the order X → Y → Z (extrinsic).

## Validation suite

`test/models/` holds 8 exact B-rep STEP bodies (boxes, a cube, a square log, a V-prism, true cylinders upright and on their side, and a box moved and rotated off the origin). They are written by `test/make_models.py`, a standard-library STEP writer that also checks each shell is closed and consistently oriented. `expected.json` has 14 cases with closed-form answers and citations: Rawson & Tupper, Barrass & Derrett, Biran, and Erdős et al., Am. J. Phys. 60 (1992).

| Run | What it exercises | Result (2026-11-20) |
|---|---|---|
| `python3 test/validate.py` | Python port of the hydrostatic solver on the same geometry | 126/126 |
| `python3 test/simcheck.py` | Python port of the calm-water free-float simulator | 2/2 |
| `node test/validate-node.mjs [fine\|normal\|coarse]` | **Real pipeline** under Node: OpenCascade STEP import, the JS solvers and simulators, hydrostatics + waves + literature benchmarks + drop test | 252/252 |
| http://localhost:8765/test/validate.html | Same checks, in the browser | 252/252 in headless Chromium, all three qualities |
| `node test/e2e-browser.mjs [shotDir]` | Drives the app UI in Chromium: import, inputs, settle, cube demo, sea-state run and statistics, regular-wave run and statistics, RAO sweep (Hz, progress, CSV and raw CSV, tab reload), custom inertia, drop and rise tests with tool locking, console errors | 53/53 |
| `node test/trade-study-node.mjs` | Regenerates the RAO trade study, [docs/rao-trade-study.md](docs/rao-trade-study.md) | — |

**Wave and seakeeping checks** (`test/validate-waves.js`, values from `test/make_models.py`):

| Check | Reference | Result |
|---|---|---|
| PM moments: m0 = Hs²/16, T1 = 0.7718·Tp, Tz = 0.7104·Tp (exact Γ-function forms) | DNV-RP-C205 | ≤ 0.04 % |
| JONSWAP γ = 3.3: m0, T1, Tz vs the DNV regressions; γ = 1 reduces exactly to PM | DNV-RP-C205, Hasselmann 1973 | ≤ 0.5 % |
| Fully developed PM: Tp(Hs) vs the integrated one-parameter spectrum (α = 0.0081, β = 0.74) | Pierson & Moskowitz 1964 | ≤ 0.08 % |
| Synthesized sea: variance = Σa²/2 = Hs²/16 | linear theory | ≤ 1 % |
| Regular wave from user inputs: crest-to-trough = H, period = T, wavelength gT²/2π along the heading; Hs input gives 4σ = Hs | Airy wave theory | ≤ 1e-6 |
| Calm-water pressure integration = ρgV through B, all 13 floating cases | Archimedes | round-off |
| Froude–Krylov heave force on a box, 3 headings × 4 frequencies | closed form, Faltinsen §3 | 1e-9 |
| Long-wave limits: heave RAO → 1, roll/pitch per slope → 1; symmetry zeros | linear seakeeping | ≤ 0.06 % |
| Undamped heave resonance at √(C33/(m + A33)) | 1-DOF oscillator | 0.001 % |
| Nonlinear time domain vs linear RAO, small regular waves (A = 2 mm) | solver consistency | ≤ 1.3 % |
| 20 min irregular SS3 beam sea: σ time domain vs \|RAO\|²·S | spectral theory | heave 1.7 %, roll 7.2 % |
| Floating hemisphere heave exciting force (FK + correction) vs Haskind, ka ≤ 0.6 | Hulme 1982 | ≤ 0.9 % |
| Floating hemisphere heave RAO with Hulme A₃₃(ω), B₃₃(ω), ka ≤ 0.7 | Hulme 1982 | ≤ 2.8 % |
| Deep-draft spar sway force and RAO (FK + correction), ka ≤ 0.7; FK alone = ½ (C_m 1 vs 2) | MacCamy & Fuchs 1954 | ≤ 4.6 % |
| Time domain vs RAO with the diffraction correction on (sphere, 2 mm waves) | solver consistency | ≤ 0.5 % |
| Drop test: drag-free fall, terminal speed in air and water (sphere C<sub>d</sub> 0.47), initial underwater acceleration with added mass ½ρV, settling at the static float height | Newton drag; Hoerner 1965; Lamb §92 | ≤ 1 % |

### RAO trade study

[docs/rao-trade-study.md](docs/rao-trade-study.md) compares the tool's RAOs with two literature benchmarks across modelling variants: tool defaults, with and without the diffraction correction, calibrated constant coefficients, and exact frequency-dependent coefficients. It lists every frequency point and summarises where the method can be trusted and which defaults it justified.

At A = 2 cm the near-resonance roll differs from the linear RAO by about 5 %. That's the genuine moving-waterline nonlinearity, and it shrinks to about 1 % at A = 2 mm, so the comparison is made in the linear limit.

`validate.html` and `validate-node.mjs` share `test/validate-core.js`. The e2e test needs Playwright (`npm i playwright && npx playwright install chromium`). Regenerate the models with `python3 test/make_models.py`.

Worst-case error on curved bodies, from faceting (planar bodies match to about 1e-9): Fine 0.026 %, Normal 0.22 %, Coarse 1.8 %.
