# Float Sim

Browser-based hydrostatics and stability tool for CAD bodies. Runs entirely locally; all libraries are in `vendor/`.

```bash
./serve.sh          # then open http://localhost:8765
```

`serve.sh` runs `tools/serve.py` (Python standard library only). If that Python also has [Capytaine](https://github.com/capytaine/capytaine) (`pip install capytaine`, or point `FLOATSIM_PYTHON` at a Python that has it), the RAO stage's **Solve with Capytaine** button works too; see below.

## Workspace

The page is laid out like a CAD / FEA tool: a menu bar, stage tabs, a setup pane on the left (property grid), the 3D view with its view toolbar and an animation toolbar, a results pane on the right and a status bar.

- **Stages:** **1 · Float** (start here: upload a model, mass, CoG, inertia, water, free float, hydrostatics and GZ), **2 · Waves** (regular or irregular seas, wave direction, drift, tracked points, motions) and **3 · RAO** (panel-method sweep and plots). Each tab shows its status (Stable, running, solved…).
- **Tools menu:** add-ons that change the wave runs and RAOs — **Mooring**, **Wind**, **Viscous drag & heave plates** — open in the setup pane and stay on until turned off; and the **Drop / rise test**, a separate mode that pauses Waves and RAO while the body is placed.
- **Units:** metric throughout (m, kg, s, N). An STL file has no units, so for an STL a *STL drawn in* menu (mm, cm, m) gives the file's units.
- **Axes:** a global XYZ triad in the corner of the view turns with the camera, and the reference csys's xyz axes are drawn at its origin and turn with the body. The **wave direction** (and the wind direction) is measured from **global +X**; **RAO headings** and the **mooring line direction** are measured from the **reference csys +x**.
- **Progress:** anything you wait on (loading a model, the panel-method solve in the background workers, the quick panel-method sweep before the first wave run or drop test, statistics runs, the sea-state table) opens a progress window over the view: what is running, a bar with the percentage (a moving bar when the amount of work is unknown), the current step, the time elapsed and, for statistics runs, the time left. **Cancel** stops RAO solves and statistics runs; for the quick sweep it becomes **Skip: use the estimates**. **Hide** keeps the run going and moves the progress to the status bar (click it to bring the window back). The stage tabs show the percentage too (e.g. *RAO · solving 54 %*).
- The previous dark, single-column layout is tagged **`classic-ui`** in git (`git checkout classic-ui` to run it).

## What it does

- **Imports STEP / IGES / BREP** files (via `occt-import-js`, OpenCascade compiled to WASM) and **STL**. STEP, IGES and BREP files carry their own units, so the body keeps its real size; lengths are shown and entered in metres. STL files have no units, so for an STL the *STL drawn in* menu sets the units the file was drawn in and rescales it.
- **Reference coordinate system (CAD csys):** by default the file's own origin and axes. Choose *Custom* to enter the reference csys of your CAD model: its origin in the file's coordinates, and its axes either as rotation angles (about the file's fixed X, Y, Z axes, or about the turning axes X, Y′, Z″) or as x and z axis directions. The model is moved into this csys when it loads, so everything entered or reported in body coordinates is in it: the CoG, the moments of inertia, tracked points, heave plates, the fairlead, the target waterline and the RAOs. The info box lists the resulting axes in file coordinates, to check against the CAD. Switching between angles and directions keeps the same axes. Numbers you have typed stay as typed when the csys changes, so they are read in the new one; the default (centroid) CoG stays where it is on the body. Loading a different model starts in its file csys again; reloading the same file (another mesh quality) keeps it.
- **Inputs:** mass, CoG (x, y, z in the reference csys), fresh (1000 kg/m³), salt (1025 kg/m³) or custom water, and an initial roll/pitch/yaw.
- **Moments of inertia:** computed from the geometry for uniform density, or entered as a custom tensor in kg·m², in the reference csys axes, **taken at the CoG or at the reference csys origin** (CAD mass-property reports give both). Values taken at the origin are moved to the CoG with the parallel-axis theorem, using the mass and CoG entered. The info box shows the tensor's diagonal about G and about the origin. There's a sign option for CAD tools that report products of inertia as +∫xy dm. Custom values are checked for positive-definiteness and the triangle inequality, and are used by the hydrostatic periods, both simulators and the RAOs.
- **Static float solve:** for the chosen attitude, finds the waterline where buoyancy = weight, then shows
  - the waterline outline, **G** (CoG), **B** (centre of buoyancy) and the weight/buoyancy force arrows
  - **M<sub>T</sub>, M<sub>L</sub>** (roll and pitch metacentres): BM = I<sub>waterplane</sub> / V
  - draft, freeboard, displaced volume, reserve buoyancy, immersion rate
  - KB, KG, BM, **GM** (roll, pitch, and the weakest waterplane axis), righting moment per degree, approximate heave/roll/pitch periods
  - a plain-language stability verdict, and a warning if the attitude is not at rest (B not under G). The small-angle words come from GM about the weakest waterplane axis. The range words come from the GZ curves over all heel directions (every 15°, then refined around the worst), because the range can depend on the direction even when the waterplane has no weakest axis (a square or hexagonal waterplane): where GZ peaks, and where the range ends: at the vanishing angle or, for a mesh with openings, the downflooding angle, whichever comes first, in the direction in which the least steady heeling moment ends the range (the smallest largest arm of the buoyancy–weight couple before it ends; with fixed trim the arm counts the trimming moment that the fixed trim holds). A long hull that capsizes or floods sooner when inclined about its long, stiff axis, nearer pitch, needs metres of righting arm to get there, so the earliest end over every direction is a note, not the end of the range. With free trim, an angle where the trim followed from upright stops being an equilibrium (a fold: the body turns to another trim, and GZ jumps) is called out as such. "Self-righting" appears only when GZ stays positive to 180° in every direction. The range is called small when it ends before 30°, since the IMO intact stability code asks for a righting arm of at least 0.2 m at 30° or more (2008 IS Code, MSC.267(85), Part A 2.2.2), and an early peak, before 25° (A 2.2.3), is noted. An opening under water at rest gives the verdict "Opening under water".
- **GZ righting-arm curve** (0–180°, about roll, pitch or the weakest waterplane axis) with max GZ, the angle where it peaks, the angle of vanishing stability, the downflooding angle of a mesh with openings (the curve past it is faded), and for an unstable start the angle where GZ turns positive again. It is at **fixed trim** by default: the body heels without re-trimming. **Free trim** re-trims the body at every heel angle to a stable trim with no trimming moment, following the local energy minimum from the previous angle's trim, which is lower and safer for hulls that are not symmetric fore and aft. Where the trim found is an energy maximum, the stable trims within ±90° on either side are found and the lower one is kept; where there is none (a compact body heeled far over), the panel says so. The curves are computed in a pool of Web Workers, and the Waves-stage verdict uses the same trim setting.
- **Free-float simulation:** a 6-DOF rigid body with damping, released from the chosen attitude so it settles into a stable floating attitude. For example, a 1 m cube at half draft, released upright, comes to rest corner-down with a body diagonal vertical: the lowest potential energy over all attitudes. Edge-down is only neutral. **Settle (fast)** runs the simulation until the body is slow and B is under G for a full second, finishes with a static equilibrium solve, and copies the attitude back.
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
  - **Run in waves** animates it in 3D. The water surface is shaded by height (crests lighter, troughs darker), carries faint grid lines fixed in the world that ride on the waves, and reflects a soft sky, so the wave motion is easy to follow. **Run statistics** simulates 20 min in a Web Worker and reports significant and maximum roll, pitch and heave, green water on deck and capsize. A verdict compares maximum roll against the GZ range of stability, at the GZ panel's trim setting, e.g. "SS3: max roll 7.73° of 109° range (GZ at fixed trim): safe".
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
  - **Solve with Capytaine** (next to Solve RAOs): the same panel mesh, lid and symmetry solved by [Capytaine](https://github.com/capytaine/capytaine) (Ancellin & Dias 2019, direct formulation, deep water) on this computer instead of Float Sim's own solver. Everything after the solve (RAOs, reference point, sea states, exports, simulators) is unchanged, and the info box and export headers name the solver. It needs Float Sim served by `./serve.sh` from a Python with Capytaine; otherwise the button is off and the Solver section says why. The page meshes the hull, sends it to `tools/serve.py` (127.0.0.1 only; requests need an `X-Float-Sim` header, so other web pages cannot use it), which runs `tools/capytaine_solve.py` one frequency per process, as many processes as the cores and free memory allow, with progress and Cancel. On the same mesh the two solvers agree within 0.5 % for translations and 2.1 % for rotations (`test/validate-capytaine.mjs`).
  - **Froude–Krylov + estimates** remains available as a fast option: the same 6-DOF model with estimated added mass and damping and Froude–Krylov excitation on the mean wetted surface (Faltinsen 1990; Journée & Massie 2001).
  - Plots: amplitude (m/m, deg/m or deg per degree of wave slope), phase, and a heading × frequency heatmap.
  - Also reports the response in the current sea state, computed from the sweep and cached.
  - **Reference point** (RAO setup): the motions are reported at the **reference csys origin** (default) or at the CoG G. The solve is about G; at the origin O the translations are ξ<sub>O</sub> = ξ<sub>G</sub> + θ × (O − G), and the phases are measured from the wave at O (× e<sup>ik·(O − G)</sup>). Rotations are the same at every point. The axes are the reference csys as the body floats (z up, x along the reference +x; for a tilted start attitude, z stays vertical). The plots, the sea-state response, the wave-following table and both exports use the chosen point. The Waves stage still reports the motions of G.
  - **Export CSV** gives amplitudes and phases per heading and frequency at the reference point (`rao_at_ref_origin.csv` or `rao_at_G.csv`). **Export raw CSV** gives complex RAOs (re/im) and excitation forces per DOF (forces and moments about the reference point), plus the panel-method A(ω) and B(ω) (diagonal and the surge–pitch and sway–roll couplings). The header comments give the reference csys, the point's offset from G, and the mass and restoring matrices (about G).
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

- **Tracked points (Waves stage):** points on the body, such as an antenna, GPS, solar panel or IMU. Click **Pick on model** and then the model, or type coordinates in the reference csys. An optional clearance counts the point as underwater until it stands that far clear of the surface.
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
- The mesh should be closed (watertight) and consistently oriented. On import (in a worker), vertices within 10⁻⁷ of the body's size are welded, faces wound against their neighbours are re-oriented, and a shell that is inside out is turned, with any shell inside it that was turned with it (a hollow body exported inside out); parts that touch face to face are oriented each on its own. The model panel says when this happened. It also reports open edges and overlapping shells (shells whose surfaces cross, or a solid inside a solid), whose shared volume is counted twice. For an open hull, the volume treats the openings as closed by flat lids at the top, and the hydrostatics hold only while every opening stays above the waterline: the verdict says when an opening is under water, and the GZ curves end where one goes under. A void (an inner shell wound inwards) counts as flooded for buoyancy below the waterline.
- GZ curves are at fixed trim unless **Free trim** is ticked, and they are for the positive heel direction about the chosen axis. The verdict checks every heel direction (both senses about the weakest axis when the body is unstable).
- Coordinates: Z is up. Roll is about X, pitch about Y, yaw about Z, applied in the order X → Y → Z (extrinsic).

## Validation suite

[docs/validation-map.md](docs/validation-map.md) (also as `docs/validation-map.html`, linked from Help › Method notes) maps every core part of Float Sim to its evidence: machine-checked proofs of the formulas it implements (Lean 4 + Mathlib, `proofs/`), tests of the code against those formulas, and independent references. The tables below give the details.

`test/models/` holds 8 exact B-rep STEP bodies (boxes, a cube, a square log, a V-prism, true cylinders upright and on their side, and a box moved and rotated off the origin). They are written by `test/make_models.py`, a standard-library STEP writer that also checks each shell is closed and consistently oriented. `expected.json` has 14 cases with closed-form answers and citations: Rawson & Tupper, Barrass & Derrett, Biran, and Erdős et al., Am. J. Phys. 60 (1992).

| Run | What it exercises | Result (2026-11-21) |
|---|---|---|
| `cd proofs && lake build` | Lean 4 + Mathlib proofs. The code's own formulas: `massProperties` and `submerged` transcribed (the reference point does not matter for a closed mesh, the clipped surface plus a lid is closed, the lid adds nothing, the waterplane sums do not depend on the fan point), the transcribed `submerged` on a box at any draft, and one tetrahedron's determinant equal to its Lebesgue volume. Reference values and other identities: hydrostatic closed forms (Archimedes, KB and waterplane integrals, box and V-section BM), upright stability limits of the cube and the cylinder, Huygens–Steiner, rotations and the reference csys, reading roll, pitch and yaw back from a rotation (`toEulerDeg`, including gimbal lock), motions and loads at a point, the wave phase shift ([docs/validation-map.md](docs/validation-map.md)). Needs elan; `lake exe cache get` fetches Mathlib (about 7 GB) | builds, no `sorry` |
| `node test/validate-proofs.mjs` | Float Sim's hydrostatics on 8 STEP models, and the hand-derived references in `expected.json`, against the proved closed forms evaluated exactly (`proofs/expected.json`, written by `lake exe expected`); `mat3.toEulerDeg` against its proofs (angles read back over 20,000 rotations, rebuilt at gimbal lock); `submerged` on the proofs' own box at 2,000 random sizes, positions and drafts; `massProperties` from reference points far from the body | 20/20 |
| `python3 test/validate.py` | Python port of the hydrostatic solver on the same geometry | 126/126 |
| `python3 test/simcheck.py` | Python port of the calm-water free-float simulator (box list, square log at 45°, cube released upright to corner-down) | 3/3 |
| `node test/validate-node.mjs [fine\|normal\|coarse]` | **Real pipeline** under Node: OpenCascade STEP import, the JS solvers and simulators, hydrostatics + stability read-outs and verdicts + GZ (fixed and free trim) + mesh checks + rest attitudes (`test/validate-stability.js`, 228 checks) + waves + literature benchmarks + drop test; at fine also the small-body checks (mooring, drag, wind, tracked points) and the reference csys checks | 591/591 fine, 494/494 normal and coarse |
| http://localhost:8765/test/validate.html | Same checks, in the browser | 591/591 (fine) and 494/494 (normal, coarse) in headless Chromium |
| `node test/validate-bem.mjs [quick]` | Panel method: special functions, meshing of 10 STEP bodies, Lamb's slender spheroid, A, B and X against WAMIT (2 bodies) and Capytaine (6 buoys), GMRES vs LU, RAO peaks, Kramer sphere decay through the drop test; then meshed as the app does: moonpool lids, Hulme's exact hemisphere (ka 0–10), the OC3-Hywind spar (WAMIT) and the ITI barge (Capytaine) ([docs/bem-validation.md](docs/bem-validation.md)) | 35/35 |
| `node test/e2e-browser.mjs [shotDir]` | Drives the app UI in Chromium: import, inputs, settle, cube demo, sea-state run and statistics, regular-wave run and statistics, wave drift on/off, restart and camera follow, the workspace (metric only, stage tabs, Tools menu panes, view presets and the axes triad), global wave direction (a 90° yaw turns beam seas into head seas), the progress window (model loading, RAO solve, statistics runs, Hide and status-bar restore, Cancel), panel-method added mass and damping in the simulations, RAO sweep with the panel method (Hz, progress, CSV and raw CSV with A(ω) and B(ω), tab reload, cancel, Froude–Krylov option), sea-state table from the panel-method RAOs; small-body options on the cylinder buoy (point picked by clicking the model, drag and heave plate, mooring, wind, live run, statistics, RAOs with the wave-following table, sea-state table with linearised drag); custom inertia, drop and rise tests from the Tools menu (orientation, max submersion depth, max rise rate, runs table, tool locking, Exit drop test) with panel-method coefficients; the reference csys (custom origin and axes, the default CoG staying on the body, model size and GM in the new axes, inertia taken at the origin, typed CoG kept, angles ↔ directions, RAOs and CSVs at the reference origin vs G, reset for a new model); Solve with Capytaine (button off with the reason when the server has no Capytaine; otherwise both buttons locked while it runs, the same RAOs as the built-in solver on the same mesh, the solver named in the info and raw CSV); stability (the verdict's range from the GZ curve, fixed and free trim, the Weakest axis, an STL with a flipped face repaired on import, an open-deck STL (the range ends at the downflooding angle), an STL with an opening under water, two crossing boxes reported as overlapping, Settle ending with a static equilibrium solve, the cube coming to rest corner-down), console errors | 144/144 |
| `FLOATSIM_PYTHON=… node test/validate-capytaine.mjs` | Solve with Capytaine: the helper's API guards (other pages, malformed cases), Capytaine vs Float Sim's solver on the same panel mesh for three hulls (symmetry planes through G, off G, none), and cancelling part-way. Skips if that Python has no Capytaine | 7/7 |
| `node test/rao-compare/floatsim_rao.mjs …`, `python test/rao-compare/capytaine_rao.py`, `python test/rao-compare/plot.py` | RAO comparison: the 12 test models through Float Sim's panel method, and through Capytaine on its own (its own analytic meshes, hydrostatics and RAOs), 0.01–1 Hz, headings 0–180° every 10° ([docs/rao-compare/](docs/rao-compare/README.md); full report [docs/rao-solver-review.md](docs/rao-solver-review.md), also as HTML, `docs/rao-solver-review.html`) | away from resonances within 4.3 % of peak; natural frequencies within 1.1 % |
| `node test/trade-study-node.mjs` | Regenerates the RAO trade study, [docs/rao-trade-study.md](docs/rao-trade-study.md) | — |

**Stability checks** (`test/validate-stability.js`, 138 checks, run at every mesh quality by `validate-node.mjs` and `validate.html`; prisms and boxes generated in the test, plus the STEP spheres):

| Check | Reference | Tolerance |
| --- | --- | --- |
| GZ of a box, a catamaran, a tender box and a V-section at 0–180°; loll angle, vanishing angle and maximum | an exact cross-section code written in the test (polygon clipping, no Float Sim code); wall-sided loll angle | 10⁻⁹ m; 10⁻⁶° |
| Weakest waterplane axis and GM about it on yawed boxes; a box with GM_T and GM_L positive and GM_min negative; an off-centre waterplane; freeboard, righting moment per degree | second moments of a rectangle | 10⁻¹² |
| The verdict: no "self-righting" unless GZ stays positive to 180°, the IMO 25° criterion, the same verdict at any yaw, no "loll" for GM > 0 | IMO 2008 IS Code A 2.2.3 | exact wording |
| Mesh checks and repair: flipped faces, inside-out shells, open hulls at any height above the file origin, an edge used three times, overlapping shells, a void, the STEP spheres' pole triangles | directed-edge balance | exact counts; 10⁻¹² |
| Neutral buoyancy; the static rest attitude after Settle; free trim (no trimming moment, least energy, dE/dφ = W·GZ·cos(trim), the reviewer's scow numbers) | wall-sided list; potential energy | 10⁻⁶°; 10⁻⁹ m |
| The cube's lowest-energy attitude over all orientations at s.g. ½, 0.3, 0.25 (global minimisation) | corner-down closed form (Irwin–Hall) | 10⁻⁹ m |

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

**Reference csys checks** (`test/validate-refcsys.js`, 39 checks, run with the fine quality by `validate-node.mjs` and `validate.html`; exact box and cylinder geometry generated in the test):

| Check | Reference | Result |
|---|---|---|
| Axes from rotations about fixed axes (X, Y, Z) and turning axes (X, Y′, Z″); axis directions; angles recovered from the axes (incl. Y = ±90°); orthonormal, right-handed | hand-derived axes | ≤ 1e-15 |
| Y-up CAD export of a 2 × 1 × 0.8 m box moved into a z-up csys at the keel centre: draft, GM<sub>T</sub>, GM<sub>L</sub> | KB = T/2, BM = B²/12T | ≤ 1e-9 |
| Solid box inertia about its corner (moments and products); values taken at the origin moved to G | Huygens–Steiner; I = m(b² + c²)/3, I<sub>xy</sub> = −mab/4 | ≤ 1e-10 |
| RAOs at a point 1.5 m from G of a Ø0.6 m buoy (oblique regular wave): heave and surge amplitude and phase from the wave at the point | time-domain WaveSim | 1.5 % and 1.3°; 1.8 % of the terms and 1.0° |
| Same point: relative height \|ξ₃ − 1\|; forces about the point back to G; power Σ F·ξ* | tracking.pointTransfer; bem.transferToG; invariance | ≤ 1e-12 |
| A box exported in a general CAD csys (origin 12.5 m away, turned 30°, −50°, 70°), CoG and inertia entered as CAD reports them: RAOs at the reference origin | the same body given directly in the csys | ≤ 1.3e-9 |

### RAO solver review and Capytaine comparison

[docs/rao-solver-review.md](docs/rao-solver-review.md) brings together the literature review, the panel method, its coefficient validation and the RAO comparison with Capytaine run on its own for all 12 test models, with every plot. The same report as a web page, `docs/rao-solver-review.html`, opens from the app (Help › Method notes, and the RAO stage's notes on the panel method and on Solve with Capytaine). Regenerate it after editing the Markdown with `python3 tools/md_to_html.py docs/rao-solver-review.md`.

### RAO trade study

[docs/rao-trade-study.md](docs/rao-trade-study.md) (written before the panel method) compares the tool's RAOs with two literature benchmarks across modelling variants: tool defaults, with and without the diffraction correction, calibrated constant coefficients, and exact frequency-dependent coefficients. It lists every frequency point and summarises where the method can be trusted and which defaults it justified.

At A = 2 cm the near-resonance roll differs from the linear RAO by about 5 %. That's the genuine moving-waterline nonlinearity, and it shrinks to about 1 % at A = 2 mm, so the comparison is made in the linear limit.

`validate.html` and `validate-node.mjs` share `test/validate-core.js`. The e2e test needs Playwright (`npm install && npx playwright install chromium`; on Linux also `sudo npx playwright install-deps chromium`). `test/validate-bem.mjs` needs only Node; `test/capytaine_ref.py` (regenerates the Capytaine references), `test/validate-capytaine.mjs` and `test/rao-compare/` need `pip install capytaine` (the plots also need matplotlib). Regenerate the models with `python3 test/make_models.py`.

Worst-case error on curved bodies, from faceting (planar bodies match to about 1e-9): Fine 0.026 %, Normal 0.22 %, Coarse 1.8 %.
