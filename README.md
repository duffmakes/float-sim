# Float Sim

Browser-based hydrostatics and stability tool for CAD bodies. Runs entirely locally; all libraries are in `vendor/`.

```bash
./serve.sh          # then open http://localhost:8765
```

## Workspace

The page is laid out like a CAD / FEA tool: a menu bar, stage tabs, a setup pane on the left (property grid), the 3D view with its view toolbar and an animation toolbar, a results pane on the right and a status bar.

- **Stages:** **1 · Float** (start here: upload a model, mass, CoG, inertia, water, free float, hydrostatics and GZ), **2 · Waves** (regular or irregular seas, wave direction, drift, tracked points, motions) and **3 · RAO** (panel-method sweep and plots). Each tab shows its status (Stable, running, solved…).
- **Tools menu:** add-ons that change the wave runs and RAOs — **Mooring**, **Wind**, **Viscous drag & heave plates** — open in the setup pane and stay on until turned off; and the **Drop / rise test**, a separate mode that pauses Waves and RAO while the body is placed.
- **Units:** metric throughout (m, kg, s, N). An STL file has no units, so for an STL a *STL drawn in* menu (mm, cm, m) gives the file's units.
- **Axes:** a global XYZ triad in the corner of the view turns with the camera, and the model's own xyz axes are drawn at the CoG and turn with the body. The **wave direction** (and the wind direction) is measured from **global +X**; **RAO headings** and the **mooring line direction** are measured from the **model's +x**.
- **Progress:** anything you wait on (loading a model, the panel-method solve in the background workers, the quick panel-method sweep before the first wave run or drop test, statistics runs, the sea-state table) opens a progress window over the view: what is running, a bar with the percentage (a moving bar when the amount of work is unknown), the current step, the time elapsed and, for statistics runs, the time left. **Cancel** stops RAO solves and statistics runs; for the quick sweep it becomes **Skip: use the estimates**. **Hide** keeps the run going and moves the progress to the status bar (click it to bring the window back). The stage tabs show the percentage too (e.g. *RAO · solving 54 %*).
- The previous dark, single-column layout is tagged **`classic-ui`** in git (`git checkout classic-ui` to run it).

## What it does

- **Imports STEP / IGES / BREP** files (via `occt-import-js`, OpenCascade compiled to WASM) and **STL**. STEP, IGES and BREP files carry their own units, so the body keeps its real size; lengths are shown and entered in metres. STL files have no units, so for an STL the *STL drawn in* menu sets the units the file was drawn in and rescales it.
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
- **Wave drift** (Waves stage › Drift, on by default):
  - **On:** the body is carried by the Stokes drift current, averaged over its draft: u = Σ ω k a² e^{2kz} (Stokes 1847). It is also pushed by the mean drift force of the waves it reflects, F = ½ρga²R² per unit width (Longuet-Higgins 1977), with R from Ursell's (1947) barrier solution at the body's draft. Quadratic drag ½ρC<sub>d</sub>A|v−u|(v−u) on the speed relative to the current sets the drift speed; C<sub>d</sub> is editable (default 1).
  - The slowly varying horizontal force from the Froude–Krylov pressure integration is not physical without diffraction, so it is low-pass filtered out whenever the drift model is active. On a 4×2 m box this filter was the difference between 0.39 m/s of spurious drift and the expected 0.09 m/s.
  - **Off:** a very soft, critically damped horizontal spring (natural period ≥ 60 s and ≥ 10 wave periods) holds the body on station. Wave-frequency surge and sway are unchanged.
  - The live run shows drift speed, direction and distance. **Camera follows the body** can be switched off, and **↺ Restart run** starts again from the original position (suggested once the body has drifted more than 10 body lengths). Statistics runs report the mean drift.
- **Regular waves** (Waves stage › Type › Regular): a single Airy wave from your own height, period and direction, not tied to any spectrum or sea state.
  - Height can mean the crest-to-trough height H (amplitude H/2) or a significant height Hs with the same energy (amplitude Hs/2√2, since a sinusoid has σ = A/√2).
  - Reports wavelength, celerity and steepness H/λ (warns above 1/20 and at the 1/7 breaking limit), and warns when the period is within 15 % of a natural period.
  - Shows the linear steady-state heave, roll and pitch (|RAO| × A) during the 3D run. **Run statistics** simulates 5 min and compares the measured steady-state amplitudes against that prediction.
- **Time-domain stability in waves:**
  - Loads are Wheeler-stretched Froude–Krylov pressure integrated over the *instantaneous* wetted hull (nonlinear in body motion and wave elevation), plus gravity, estimated added mass and linear damping per mode.
  - **Run in waves** animates it in 3D. The water surface is shaded by height (crests lighter, troughs darker), carries faint grid lines fixed in the world that ride on the waves, and reflects a soft sky, so the wave motion is easy to follow. **Run statistics** simulates 20 min in a Web Worker and reports significant and maximum roll, pitch and heave, green water on deck and capsize. A verdict compares maximum roll against the GZ range of stability, e.g. "SS3: max roll 7.73° of 109° range: safe".
- **Sea-state table:** a linear spectral estimate (|RAO|²·S) for SS1–5 at the chosen wave direction: significant amplitudes, most-probable 3-hour maximum roll, and a verdict. Sea states whose waves are short relative to the body (D/λ > 0.2) are flagged.
- **RAOs:**
  - Enter a frequency range **in Hz** (the equivalent rad/s, periods and wavelengths are shown) and a list or range of incident headings (e.g. `0:15:180`). A progress bar shows the sweep, and the RAO tab shows a loading indicator while plots render.
  - **Panel method (default).** A low-order boundary-element (BEM) solver, the same formulation as WAMIT's low-order method, solves the linear radiation and diffraction problem on the wetted hull. It gives frequency-dependent added mass A(ω), radiation damping B(ω) and wave exciting forces X(ω, β) with all couplings. The 6-DOF RAOs follow from [−ω²(M + A) + iω(B + B<sub>extra</sub>) + C] ξ = X. Details:
    - deep-water free-surface Green function (Newman 1985), exact flat-panel Rankine integrals, and exciting forces from the Haskind relation
    - irregular frequencies removed with an interior waterplane lid (extended boundary integral equations, WAMIT ch. 15), moonpools included
    - mirror symmetry about one or two vertical planes used automatically (up to 16× less memory, 64× less solve time)
    - GMRES for large meshes, dense LU otherwise
  - The CAD or STL tessellation is **remeshed** into near-equilateral panels (isotropic remeshing, Botsch & Kobbelt 2004). Sharp edges and the waterline are kept exactly, panels are refined where the surface is curved, and the panel size is never coarser than 1/7 of the shortest wavelength. **Panels:** Coarse ~400, Standard ~1,000, Fine ~2,500 or Very fine ~6,000.
  - Runs on a pool of Web Workers sized to the CPU and memory, with progress, an ETA and **Cancel**. The page stays usable. A Standard sweep takes seconds to a few minutes; Very fine on a non-symmetric hull can take 10–20 min.
  - Reports the natural frequencies with frequency-dependent added mass and the radiation damping ratio at each. Warns when a resonance has under 2 % of critical damping, since potential flow gives almost no roll damping and real peaks are lower. **Extra ζ** (viscous damping) can be added in Waves › Hydrodynamics & wave detail. Also warns if the irregular-frequency lid could not be built, or if any radiation damping comes out negative (panels too coarse for the top frequencies).
  - Validated against WAMIT, Capytaine, Hulme's exact floating-hemisphere solution, Lamb's exact spheroid added mass and the Kramer et al. (2021) sphere decay test: within 2 % for surge, sway and heave and 5 % for rotations and couplings on buoy shapes. Also checked on two offshore-wind platforms: the OC3-Hywind spar against WAMIT, and the 40 m ITI barge, with and without its moonpool, against Capytaine ([docs/bem-validation.md](docs/bem-validation.md)).
  - **Froude–Krylov + estimates** remains available as a fast option: the same 6-DOF model with estimated added mass and damping and Froude–Krylov excitation on the mean wetted surface (Faltinsen 1990; Journée & Massie 2001).
  - Plots: amplitude (m/m, deg/m or deg per degree of wave slope), phase, and a heading × frequency heatmap.
  - Also reports the response in the current sea state, computed from the sweep and cached.
  - **Export CSV** gives amplitudes and phases per heading and frequency. **Export raw CSV** gives complex RAOs (re/im) and excitation forces per DOF, plus the panel-method A(ω) and B(ω) (diagonal and the surge–pitch and sway–roll couplings). The mass and restoring matrices are in the header comments.
- **Added mass and damping in the simulations.** With *Panel-method added mass & damping in the simulations* on (Waves › Hydrodynamics & wave detail, default), the wave runs and the drop test take A and B from the panel method at each mode's natural frequency (surge, sway and yaw at the wave frequency). They come from the last panel-method RAO sweep of the body, or from a quick coarse sweep (a few seconds) the first time.
- **Long-wave diffraction correction** (G.I. Taylor, Froude–Krylov option and time domain): Froude–Krylov alone captures only ρ∫a dV (C_m = 1). The correction adds A<sub>jj</sub> × the incident acceleration averaged over the submerged volume, computed with an exact cone quadrature. It is applied identically in the RAO solver and the time-domain simulator. Defaults are on for surge and sway, off for heave, as justified by the trade study below.
- **Added-mass estimates** (used without the panel method; editable): heave uses a floating elliptic disk of the waterplane's area and aspect ratio, (2/3)πρab²/E(e) (Lamb §373). Surge and sway use whichever strip direction suits the body's proportions. A spar gets ρπa²T (C<sub>a</sub> = 1) and a ship-like hull gets ρπT²L/2.

## Drop / rise test

The drop / rise test (Tools menu) releases the body from a chosen CoG height, above or below the still-water surface, at an initial orientation set in the drop-test pane (shared with Float's start attitude), with an optional initial vertical speed. You can watch it fall in, plunge and recover, or rise from depth, break the surface and settle. It's deliberately simple:
- gravity, water buoyancy at B, and air buoyancy at the dry-volume centroid
- quadratic drag ½ρC<sub>d</sub>A⊥|v|v on the CoG velocity, with A⊥ the hull's projected area normal to the motion, and water/air blended by the submerged fraction. Water and air C<sub>d</sub> are editable, with presets from Hoerner, *Fluid-Dynamic Drag*.
- added mass and rotational water damping: the floating values (panel method or estimates), scaled by submergence relative to the float position (zero in air, full at the float draft and below)
- linear wave-making damping while the body pierces the surface: the panel-method radiation damping at the heave natural frequency. Against the Kramer et al. (2021) floating-sphere decay test this gives a damped period of 0.755 s (measured 0.76 s) and a decay rate within 3 % of WAMIT's.

The **Drop test** tab plots CoG height, vertical speed and attitude, and reports water-entry speed, **max submersion depth** (lowest point of the body below the still water), **max rise rate** (largest upward CoG speed), deepest CoG, surface breach, overshoot and settle time. A runs table lists every release so heights and orientations can be compared. While the body is placed, the sea-state, statistics, sea-state table, RAO and calm-simulate tools are locked until **Reset position** or **Exit drop test**. No slamming pressures, splash or air-cavity effects are modelled.

## Small-body options (tracked points and the Tools add-ons)

For buoys, gliders and other small bodies. Mooring, drag and wind are off by default, and tracked points are empty until you add one. When on, each option is used by the wave runs, the statistics, the RAOs and the sea-state table.

- **Tracked points (Waves stage):** points on the body, such as an antenna, GPS, solar panel or IMU. Click **Pick on model** and then the model, or type model coordinates. An optional clearance counts the point as underwater until it stands that far clear of the surface.
  - Wave runs show each point's height above the local water surface live.
  - **Run statistics** reports the time above water, how often it goes under (per hour), the longest underwater and above-water stretches, and accelerations in the body axes (RMS and max, without gravity).
  - A linear column comes from the RAOs. The relative motion is Gaussian, so the time above water is Φ(h₀/σ), and Rice's crossing rate gives how often the point goes under.
- **Wave-following quality (RAO tab):** for wave-measuring buoys. For each heading it gives the frequency up to which the body follows the waves within a tolerance (5 % by default), with the matching period and wavelength:
  - **heave**, for displacement buoys: |ξ₃ − 1|;
  - **tilt**, for pitch-roll buoys: the error against the surface slope, so the z axis stays normal to the surface;
  - **horizontal**, for GPS buoys: the error against the orbit of a surface particle.

  The errors are complex, so a phase lag counts.
- **Viscous drag & heave plates (Tools menu):**
  - **Hull drag:** quadratic drag ½ρC<sub>d</sub>A|u|u along each axis of the floating body, on the body's speed relative to the wave orbital flow. A is the submerged area projected along that axis. Rotations get drag from the same coefficients on the wetted panels; a body of revolution spinning about its axis gets none. Hoerner presets are provided.
  - **Heave plates:** thin discs with added mass ρD³/3, rotational added inertia ρD⁵/90, an inertia force from the wave acceleration and their own drag, all normal to the plate. When the body tilts, the plate's force tilts with it; its slow sideways part is filtered out with the Froude–Krylov mean force (see Wave drift), because without the matching second-order terms it is not a reliable drift force. On a rolling, moored buoy it otherwise reached ten times the actual wave-drift force.
  - **Time domain vs RAOs:** wave runs use the full quadratic drag. The RAOs and the sea-state table use the equivalent linear damping for the sea state set in Waves: stochastic linearisation ½ρC<sub>d</sub>A√(8/π)σ<sub>u</sub> for a spectrum (Borgman 1967), or 8/(3π)·U for a regular wave. The relative velocity depends on the motion, so this is iterated. The info box shows the resulting damping ratio of each mode.
- **Mooring (Tools menu):** 1–4 lines sharing one fairlead, anchored on the seabed and spread evenly in direction. Presets are provided for chain, wire and synthetic ropes. Two line models:
  - **Quasi-static:** an elastic catenary with seabed contact (Jonkman 2007; no seabed friction), solved at every step.
  - **Dynamic:** a lumped-mass line in the style of MoorDyn (Hall & Goupee 2015). Segments take tension only, with strain-rate damping, Morison drag in the wave flow, normal added mass and a seabed spring. Explicit sub-steps resolve the axial wave speed, so a slack line going taut shows its snap load.

  The lines' pull is included in the floating draft. The body starts where the lines (and the steady wind) balance; a single line pulls it toward its anchor until slack. The RAOs use the catenary's 6×6 linear stiffness at that position, including the geometric stiffness of the tension at the fairlead lever arm.

  Statistics report the max and min fairlead tension, slack events (below 10 % of the static tension, the DNV-RP-H103 slack criterion), anchor tension and uplift, and the watch circle, with a tension chart and a top view.
- **Wind (Tools menu):**
  - **Wind field:** the mean wind U₁₀ follows the power law U(z) = U₁₀(z/10)^0.12 over open sea. Gusts come from the Frøya (NPD) spectrum of DNV-RP-C205 §2.3, taken as coherent over the body.
  - **Loads:** every panel above the instantaneous water surface takes ½ρ<sub>air</sub>C<sub>d</sub>A⊥|u|u, with u the wind relative to the panel. That gives the steady heel, the wind drift and the gust response, and includes aerodynamic damping.
  - **Info box:** the steady force, the heeling moment, the linear static heel, the gust σ, and a free-drift estimate.
  - **Wave drift off:** the mean push is held on station like the wave drift. With wave drift on, or moored, the body moves.

  Wind is not in the RAOs: it is a mean load plus slow gusts.

## Method

The body is triangulated and each triangle is clipped to the part below the waterplane. Tetrahedra are taken from a point *on* the waterplane, so the waterplane "cap" adds nothing and the clipped surface gives the exact submerged volume and B. The cut edges form the waterplane boundary, and Green's theorem on them gives area, centroid and second moments (I<sub>xx</sub>, I<sub>yy</sub>, I<sub>xy</sub>). The waterline is solved by safeguarded Newton (dV/dz = waterplane area). `test/verify_physics.py` is a direct Python port of the core routine, checked against closed-form results (cube, box barge upright and heeled, half-submerged cylinder).

## Assumptions and limits

- Rigid body. The inertia assumes **uniform density**. The calm-water periods in the Hydrostatics tab ignore added mass, so they are indicative only. The RAO tab reports natural frequencies with added mass.
- **Waves:**
  - Linear (first-order) potential flow: zero forward speed, **deep water** (depth more than half the longest wavelength), no breaking waves, no second-order or viscous loads. Potential flow under-damps roll, so add extra ζ for viscous damping where it matters.
  - The panel method resolves the hull's flat panels, not the true curved surface: a Standard mesh loses about 0.1–0.5 % of the displaced volume on curved hulls, and slender needle-like tips are not resolved. Use Fine or Very fine to check convergence.
  - The time-domain simulators use the nonlinear Froude–Krylov loads with **constant** panel-method (or estimated) added mass and damping, not a convolution of the frequency-dependent coefficients (Cummins equation). Results are best near the natural frequencies.
  - The Froude–Krylov option is reliable only when the body is small relative to the wavelength (D/λ ≤ 0.2). The app flags it when this isn't the case.
  - A free-floating body drifts downwave. With no mooring or viscous drag, the drift speed is indicative only.
- STANAG values are open-ocean North Atlantic typicals.
- **Small-body options:**
  - Tracked points see the incident wave only, without the body's own diffracted or radiated waves.
  - The drag coefficients and the heave-plate C<sub>d</sub> are inputs. Oscillating plates often show higher C<sub>d</sub> at small amplitudes than in steady flow, so use test data where you have it.
  - Heave-plate added mass is the infinite-fluid disc value. Its heave–roll coupling is neglected for plates off the vertical through G.
  - The mooring has no seabed friction. The waves acting on the lines are deep-water waves, and the water depth only places the anchors. The 6×6 linear stiffness is for small motions about the mean position.
  - Wind gusts are taken as coherent over the body. The power law is not used below 0.1 m above the water.
- The mesh should be closed (watertight). The model panel reports open edges. Overlapping bodies in an assembly double-count volume.
- GZ curves are at fixed trim (the body isn't allowed to re-trim as it heels).
- Coordinates: Z is up. Roll is about X, pitch about Y, yaw about Z, applied in the order X → Y → Z (extrinsic).

## Validation suite

`test/models/` holds 8 exact B-rep STEP bodies (boxes, a cube, a square log, a V-prism, true cylinders upright and on their side, and a box moved and rotated off the origin). They are written by `test/make_models.py`, a standard-library STEP writer that also checks each shell is closed and consistently oriented. `expected.json` has 14 cases with closed-form answers and citations: Rawson & Tupper, Barrass & Derrett, Biran, and Erdős et al., Am. J. Phys. 60 (1992).

| Run | What it exercises | Result (2026-11-21) |
|---|---|---|
| `python3 test/validate.py` | Python port of the hydrostatic solver on the same geometry | 126/126 |
| `python3 test/simcheck.py` | Python port of the calm-water free-float simulator | 2/2 |
| `node test/validate-node.mjs [fine\|normal\|coarse]` | **Real pipeline** under Node: OpenCascade STEP import, the JS solvers and simulators, hydrostatics + waves + literature benchmarks + drop test; at fine also the small-body checks (mooring, drag, wind, tracked points) | 322/322 fine, 264/264 normal and coarse |
| http://localhost:8765/test/validate.html | Same checks, in the browser | 322/322 (fine) and 264/264 (normal, coarse) in headless Chromium |
| `node test/validate-bem.mjs [quick]` | Panel method: special functions, meshing of 10 STEP bodies, Lamb's slender spheroid, A, B and X against WAMIT (2 bodies) and Capytaine (6 buoys), GMRES vs LU, RAO peaks, Kramer sphere decay through the drop test; then meshed as the app does: moonpool lids, Hulme's exact hemisphere (ka 0–10), the OC3-Hywind spar (WAMIT) and the ITI barge (Capytaine) ([docs/bem-validation.md](docs/bem-validation.md)) | 35/35 |
| `node test/e2e-browser.mjs [shotDir]` | Drives the app UI in Chromium: import, inputs, settle, cube demo, sea-state run and statistics, regular-wave run and statistics, wave drift on/off, restart and camera follow, the workspace (metric only, stage tabs, Tools menu panes, view presets and the axes triad), global wave direction (a 90° yaw turns beam seas into head seas), panel-method added mass and damping in the simulations, RAO sweep with the panel method (Hz, progress, CSV and raw CSV with A(ω) and B(ω), tab reload, cancel, Froude–Krylov option), sea-state table from the panel-method RAOs; small-body options on the cylinder buoy (point picked by clicking the model, drag and heave plate, mooring, wind, live run, statistics, RAOs with the wave-following table, sea-state table with linearised drag); custom inertia, drop and rise tests from the Tools menu (orientation, max submersion depth, max rise rate, runs table, tool locking, Exit drop test) with panel-method coefficients, console errors | 97/97 |
| `node test/trade-study-node.mjs` | Regenerates the RAO trade study, [docs/rao-trade-study.md](docs/rao-trade-study.md) | — |

**Wave and seakeeping checks** (`test/validate-waves.js`, values from `test/make_models.py`):

| Check | Reference | Result |
|---|---|---|
| PM moments: m0 = Hs²/16, T1 = 0.7718·Tp, Tz = 0.7104·Tp (exact Γ-function forms) | DNV-RP-C205 | ≤ 0.04 % |
| JONSWAP γ = 3.3: m0, T1, Tz vs the DNV regressions; γ = 1 reduces exactly to PM | DNV-RP-C205, Hasselmann 1973 | ≤ 0.5 % |
| Fully developed PM: Tp(Hs) vs the integrated one-parameter spectrum (α = 0.0081, β = 0.74) | Pierson & Moskowitz 1964 | ≤ 0.08 % |
| Synthesized sea: variance = Σa²/2 = Hs²/16 | linear theory | ≤ 1 % |
| Wave drift: I₁, K₁ vs A&S tables; Ursell R² limits; Stokes drift; simulated drift speed vs the steady drag balance (2 waves); station keeping with drift off; sway amplitude unchanged by the filter | Stokes 1847, Ursell 1947, Longuet-Higgins 1977, A&S §9.8 | ≤ 8 % (speed) |
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
| Panel method: A(ω), B(ω), X(ω) of a hemisphere, an ellipsoid and six buoys (cylinder, sphere, discus, cube, log, spar), max error relative to each coefficient's peak | WAMIT v7 (WEC-Sim examples); Capytaine 3.0 | ≤ 1.6 % translational, ≤ 4.7 % rotational/couplings |
| Panel method: lateral added mass of a c/a = 12 prolate spheroid | Lamb 1932 §373 | 0.2 % |
| Panel method: floating-hemisphere heave added mass and damping, ka = 0 … 10, deep water | Hulme 1982 (exact) | ≤ 0.26 % |
| Panel method: OC3-Hywind spar (draft 120 m), A, B, X for ω 0.35–2 rad/s at Standard; at Very fine | WAMIT (OpenFAST r-test), Kh ≥ π | ≤ 4.0 %; ≤ 1.1 % |
| Panel method: ITI barge hull 40 × 40 m, draft 4 m, ω 0.3–2 rad/s, incl. high-frequency heave and pitch damping | Capytaine 3.0 (direct, 1 m panels) | ≤ 1.0 % translational, ≤ 2.5 % rotational |
| Floating sphere heave decay (D 0.3 m): A33, B33, damped period, decay rate | Kramer et al. 2021 (measured; WAMIT LPF0) | ≤ 2.5 % |

**Small-body checks** (`test/validate-smallbody.js`, 58 checks, run with the fine quality by `validate-node.mjs` and `validate.html`; exact cylinder geometry generated in the test):

| Check | Reference | Result |
|---|---|---|
| Touchdown catenary: T_H, V and horizontal stiffness at a = 20, 150, 400 m | Faltinsen (1990) eq. 8.12, 8.17 | ≤ 1e-6 |
| Fully suspended catenary (H, anchor uplift); elastic tether; slack limit H = 0 | parametric catenary; Hooke | ≤ 1e-5 |
| Lumped-mass line at rest (32 segments) vs catenary: 10 mm chain touchdown, taut nylon | Jonkman (2007) catenary | ≤ 0.03 % |
| 6×6 mooring stiffness about G (surge, heave, roll, pitch columns, with geometric stiffness) | finite differences of the line loads | ≤ 1e-5 |
| Spread mooring under 20 N: equilibrium residual; offset vs F/K₁₁ | Newton equilibrium; linear stiffness | 1e-6 N; 1 % |
| Taut tether heave period, quasi-static and dynamic line; 3-line chain mooring surge period (16.7 s) | 2π√((m + A)/(C + K)) | ≤ 0.01 % |
| Tow force; free heave decay with quadratic drag, Δ(1/X) per cycle = (8/3)·½ρC_dA/(m + A₃₃) | Morison drag; energy balance | exact; 0.03 % |
| Heave plate at heave resonance: JONSWAP Hs 0.5 m heave σ; regular A = 2 cm amplitude | stochastic (Borgman 1967) and Lorentz linearisation | 9 %; 0.7 % |
| Frøya spectrum variance (closed form vs numerical); synthesised gust σ; σ_u/U ≈ 10 % at 10 m | DNV-RP-C205 §2.3 | 0.01 %; 3.5 % |
| Windage on a box face-on (force and moment); steady heel at 6 m/s; free wind-drift speed | ½ρC_dAU²; M/C₄₄; drag balance | exact; 2 %; 0.4 % |
| Tracked points: mast-top acceleration in a regular wave; time above water (regular, and Hs 0.15 m irregular); σ of height above water; times under per hour | RAO kinematics; acos(−h₀/R)/π; Φ(h₀/σ); Rice (1944) | 0.6 %; 0.7 / 1.2 percentage points; 1 %; 9 % |
| Ideal wave follower in long waves (ω 0.05 rad/s, β 0° and 45°): heave, tilt, horizontal error | ξ₃ = 1, θ = slope, surface-particle orbit | 0.55 %, 0.5 %, 0.02 % |

### RAO trade study

[docs/rao-trade-study.md](docs/rao-trade-study.md) (written before the panel method) compares the tool's RAOs with two literature benchmarks across modelling variants: tool defaults, with and without the diffraction correction, calibrated constant coefficients, and exact frequency-dependent coefficients. It lists every frequency point and summarises where the method can be trusted and which defaults it justified.

At A = 2 cm the near-resonance roll differs from the linear RAO by about 5 %. That's the genuine moving-waterline nonlinearity, and it shrinks to about 1 % at A = 2 mm, so the comparison is made in the linear limit.

`validate.html` and `validate-node.mjs` share `test/validate-core.js`. The e2e test needs Playwright (`npm install && npx playwright install chromium`; on Linux also `sudo npx playwright install-deps chromium`). `test/validate-bem.mjs` needs only Node; `test/capytaine_ref.py` (regenerates the Capytaine references) needs `pip install capytaine`. Regenerate the models with `python3 test/make_models.py`.

Worst-case error on curved bodies, from faceting (planar bodies match to about 1e-9): Fine 0.026 %, Normal 0.22 %, Coarse 1.8 %.
