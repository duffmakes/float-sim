# Round 1 findings: hydrostatics and upright stability

Reviewer's worktree: `agent-a51e23ca7410a9d2a` at `88d2beb` (same code as main). All scratch scripts named below are in
`/tmp/claude-1000/-home-duff/48618e0f-0ee9-49bc-adc3-91132dfff2c1/scratchpad/` (called `$S` below). No file of the
project was changed. Mutations were made in copies of the code (`$S/mut/<id>/`), never in the worktree.

## Summary

I checked the hydrostatic core (`submerged`, `solveWaterline`, `hydrostatics`, `gzCurve`, `gzSummary`, `openEdgeCount`,
`stabilityVerdict`), the calm-water settling simulator, STEP/STL import as it affects hydrostatics, what the app shows
(driven in Chromium on my own server, port 8790), the tests that back these, and the Lean proofs. The numerical core
is very good: against my own independent 2D polygon code, GZ for a box past bilge emergence and deck-edge immersion,
a V-section and a round-bilge section agree to 1e-12 m from 5° to 175°; list, trim and combined equilibria come out
exact; STEP units (mm, m, inch) and bodies from 50 µm to 400 m are handled. The problems are around that core: the
plain-language verdict calls bodies "strongly self-righting" that capsize at 18° (and the canonical test box, which
vanishes at 90°); a mesh with mis-oriented faces is reported "watertight" and gives wrong hydrostatics (negative BM)
with no warning; the validation map claims a cube-settling test that does not exist, and the README describes the cube's
resting attitude wrongly; the Lean proofs back the textbook reference values, not the formulas the code implements;
and most of the stability read-outs (verdict, weakest axis, max GZ, vanishing angle, loll, pitch GZ, watertight check)
have no test, so 18 of 28 planted mutations survive every Node suite (15 of them are real faults, not near-equivalent). Confidence: high in the hydrostatic numbers for
closed, consistently oriented meshes; low in the verdict text and the open/oriented-mesh handling.

## Findings

### R1-01 The stability verdict calls bodies "strongly self-righting" from GM/beam alone, contradicting the GZ curve on the same page
- Severity: major
- Kind: code bug
- Claim challenged: `js/physics.js:332-340` (`stabilityVerdict`): GM/beam ≥ 0.2 → "Very stiff: large GM. Strongly self-righting, with a quick, snappy roll period."; GM/beam < 0.02 → "Marginal / neutral … will loll or drift in attitude". Used by `js/app.js:588-590` with `GMmin` and the axis-aligned waterplane extent. The same page uses "self-righting" to mean a vanishing angle above 180° (`js/app.js:698`).
- Evidence: blind first. The 4 × 2 × 1 m test box (T 0.4, KG 0.5) on its side (90°) has B directly under G by symmetry, so GZ(90°) = 0 and the angle of vanishing stability (AVS) is exactly 90°, not > 180°. A catamaran (two 4 × 0.5 × 0.5 m pontoons at y = ±0.75 m, a 4 × 2 × 0.1 m deck at 1.5 m, 1500 kg, KG 1.0 m): my independent 2D code (`$S/ref_cat.py`, polygon clipping, no Float Sim code) gives max GZ 0.107 m at 10° and AVS 18.2°. App (`node $S/app_probe.mjs basic`):
  ```
  STEP box 4x2x1, 3200 kg, KG 0.5
  verdict  : Stable | Very stiff: large GM. Strongly self-righting, with a quick, snappy roll period.
  gzInfo   : … Max GZ 0.323 m at 40° … | Angle of vanishing stability: 90°
  catamaran with raised deck, 1500 kg, KG 1.0
  verdict  : Stable | Very stiff: large GM. Strongly self-righting, with a quick, snappy roll period.
  gzInfo   : … Max GZ 0.107 m at 10° … | Angle of vanishing stability: 18.2°
  ```
  The verdict also depends on heading, because `waterplaneExtent` (`js/app.js:641-647`) takes axis-aligned extents: the same box, same GM_min 0.533 m, is "Very stiff" at yaw 0°, "Stable" at yaw 20° and 45° (beam used 2.000, 3.247, 4.243 m). At ship scale the low end is wrong the other way: `stabilityVerdict(0.5, 32)` (a 32 m beam ship with GM 0.5 m, over three times the IMO minimum GM₀ ≥ 0.15 m, 2008 IS Code Part A 2.2.4) returns "Marginal / neutral … will loll or drift in attitude"; a body with GM > 0 does not loll (loll needs GM < 0).
- Why it matters: the verdict is the headline a user reads. A catamaran with a high deck load that capsizes past 18° is described as strongly self-righting; nothing in the verdict looks at range or GZ.
- What would resolve it: base the large-angle words on the GZ curve (AVS, max GZ, area), keep GM/beam for the initial-stiffness words only, measure beam across the weakest axis (not axis-aligned), and drop "self-righting" unless AVS > 180°. Add Node tests of `stabilityVerdict` and of the verdict shown for these two bodies.

### R1-02 Inconsistently oriented meshes are reported "Watertight: yes" and give wrong hydrostatics with no warning
- Severity: major
- Kind: code bug
- Claim challenged: `js/physics.js:311-329` (`openEdgeCount` counts undirected edges only); `js/loader.js:20-25` (fixes only a whole part whose total volume is negative); `js/app.js:276-280` (the only mesh warnings); README "The mesh should be closed (watertight). The model panel reports open edges." The test-model generator does check orientation ("every edge must be used exactly twice, once in each direction", `test/stepgen.py:218-246`), the app does not.
- Evidence: blind: flipping the two triangles of one 4 × 1 m side of the 4 × 2 × 1 box removes 2 × (4·1·1/3) = 2.667 m³ from the enclosed volume (8 → 5.333 m³) and leaves every edge shared by two triangles. `node $S/badmesh.mjs` and the app with `$S/stl/box_flipped_side.stl`:
  ```
  one side face (+y) flipped (2 tris)  enclosed V 5.3333  open edges 0  draft 0.6000  Awp 4.0000  GMt -0.5847
  modelInfo: … Enclosed volume 5.3333 m³ | … | Watertight yes
  verdict  : Unstable | … B is 0.375 m horizontally from G …
     Draft 0.6 m, Waterplane area 4 m², BMT = Ixx/V (roll): -0.347 m, GMT (roll): -0.585 m
  ```
  True values: draft 0.4 m, A_wp 8 m², BM_T 0.833 m, GM_T 0.533 m, stable, at rest. A negative BM is impossible for any real body, yet it is displayed without comment. One flipped triangle gives draft 0.530 m and GM_T 0.210 m; a flipped bottom face makes a floating box "sink".
- Why it matters: mis-oriented facets are a common STL export defect. The user gets wrong draft, GM and verdict, with the model panel saying the mesh is watertight.
- What would resolve it: count directed edges (each p→q must be matched by one q→p) and report "inconsistently oriented faces"; optionally re-orient by propagation across shared edges before computing; flag BM < 0 or waterplane area < 0 as a mesh error. Add a test with a flipped face.

### R1-03 The validation map claims a cube-settling test that does not exist
- Severity: major
- Kind: validation gap
- Claim challenged: `docs/validation-map.md:22`: "Free-float equilibrium … Implemented: … cube and square log settling corner-down (`validate-node`)". The case title in `test/make_models.py:105` says corner-down is "the attitude the simulator settles into".
- Evidence: `cube_corner_s050` in `test/models/expected.json` has no `sim` block. Only `box_list` and `square_log_45` run the simulator (`test/validate-core.js:125-148`; `grep -n '"sim"' test/models/expected.json`). The only cube-settling check is e2e section 5 (`test/e2e-browser.mjs:116-129`), which checks only that the cube leaves upright and ends with GM_T, GM_L > 0, not which attitude. Mutation M16 (zero initial kick, so the upright cube balances forever) passes all 361 `validate-node` checks. I ran the settling myself (`node $S/run_settle.mjs cube`): the cube does settle corner-down (body axes all at 54.74° to the vertical) at s.g. 0.25, 0.3, 0.5 and 0.7, so the behaviour is plausible, but it is untested.
- Why it matters: the map is the project's statement of evidence; this row's "Implemented" claim for the cube does not hold.
- What would resolve it: add a `sim` block to `cube_corner_s050` (start upright, expect body diagonal vertical within a stated tolerance), or correct the map.

### R1-04 README and the GZ panel describe the cube's resting attitude wrongly
- Severity: minor
- Kind: documentation
- Claim challenged: `README.md:35`: "a 1 m cube at half draft rolls onto an edge". `js/app.js:697`: "It heels over until GZ turns positive, at about 45°" (the `loll` of `gzSummary`, `js/physics.js:296`: "i.e. where an unstable body comes to rest"). `test/e2e-browser.mjs:116`: "rolls to 45°, neutral about the edge axis".
- Evidence: from closed forms independent of the code (the cube's corner-down BG = 0.40625/√3 from `make_models.py`, edge-down BG = √2/6): the potential zG − zB is 0.25 face-down, 0.235702 edge-down, 0.234549 corner-down. Edge-down has GM_L = BM_L − BG = √2/6 − √2/6 = 0 exactly (neutral), so it is not a resting attitude; corner-down is lower and has GM 0.0361 m > 0. Float Sim agrees (`node $S/run_settle.mjs cube`): "edge-down zG-zB 0.235702 GMt 0.23570 GMl 0.00000; corner-down zG-zB 0.234549 GMmin 0.03608". The app's Settle takes the cube to roll 45°, pitch 35.26°, i.e. corner-down, while the GZ panel said it comes to rest at about 45° roll (`node $S/app_probe.mjs cube`). The 45° is a fixed-trim GZ zero (R1-11), not a 3D rest attitude.
- Why it matters: the user is told the wrong resting attitude.
- What would resolve it: fix README:35 and the e2e comment; word the loll line as "GZ (fixed trim, this axis) turns positive at about X°", or find the loll angle with free trim.

### R1-05 After Settle, the app says "It started at rest in this attitude, so there was nothing to move" when the body moved
- Severity: minor
- Kind: code bug
- Claim challenged: `js/app.js:794` sets `simFromRest` when B is under G, which is also true at an unstable equilibrium; `js/app.js:834` then prints the message whenever the sim settles.
- Evidence: cube demo, released upright (unstable, B under G), Settle (fast) (`node $S/app_probe.mjs cube`):
  ```
  after Settle (fast): roll, pitch, yaw = 45, 35.26, 7.79 | simInfo: … Settled — this is a stable resting attitude. |
  It started at rest in this attitude, so there was nothing to move. Tilt it under Start attitude to watch it right itself.
  ```
- Why it matters: it contradicts what the user just watched, on the app's own demo.
- What would resolve it: set `simFromRest` only if the start was at rest and stable (GM_min > 0), or compare the final and start attitudes.

### R1-06 The Lean proofs back the textbook reference values, not the formulas the code implements
- Severity: major
- Kind: proof–code mismatch
- Claim challenged: `docs/validation-map.md:7` ("Proven: the formula or identity the code implements is a machine-checked theorem"), `:19-20`, and `:44-50`, whose "Code it backs" column lists `solveWaterline`, `submerged` (waterplane moments) and `hydrostatics`. Also `proofs/Proofs/Hydrostatics.lean:14`.
- Evidence: the code computes V and B as signed tetrahedra from a point on the waterplane over the clipped triangles (`js/physics.js:184-192`), the waterplane area, centroid and second moments by Green's theorem over the cut edges (`:193-217`, e.g. Ixx = (1/12) Σ (y0² + y0y1 + y1²)(x0y1 − x1y0)), and the waterline by safeguarded Newton (`:223-243`). None of these appears in any Lean file. What is proved:
  - `rect_second_moment`: ∫ L y² dy = LB³/12;
  - `box_KB` and `vsection_KB`: one-dimensional centroid integrals;
  - `box_BM`, `vsection_BM`, `boxDraft_floats`, `box_fresh_*`: field algebra on closed forms;
  - `cube_stable_iff`, `cyl_stable_iff`: the sign of a closed-form GM.

  These are the expected values in `test/models/expected.json`, re-derived. They would stay true whatever `submerged` did. Mutations that break the code's Green's-theorem formulas (M08 Ixy, M14 waterplane centroid) pass `validate-proofs` 18/18. `proofs/Proofs/Expected.lean:244-251` also emits V-prism BM_L = L²/(6T) and GM_L, which no theorem derives (only BM_T, `vsection_BM`). `#print axioms` on the theorems shows only propext, Classical.choice and Quot.sound (reproduced), so the proofs themselves are sound.
- Why it matters: "Proven" reads as "the code's formula is proved"; here it means "the test oracle is proved". The code is backed by tests, not proofs. The 8 `validate-proofs` models all have waterplanes symmetric about G, so the centroid shift and Ixy terms of the code go unexercised (M13, M14).
- What would resolve it: either reword the rows ("the reference values are proved; the code is tested against them") and empty the "Code it backs" column for these theorems, or prove the identities the code uses: divergence-theorem volume and moments for a closed oriented triangulated surface cut by a plane, and Green's-theorem polygon area, first and second moments (both are finite sums and suit Lean).

### R1-07 "GM about weakest axis … @ angle" gives the angle 90° away from the weakest axis
- Severity: minor
- Kind: code bug
- Claim challenged: `js/physics.js:258` `axisMinDeg = 0.5·atan2(−2Ixy, Ixx − Iyy)`, shown at `js/app.js:631` as "GM about weakest axis: … @ X°".
- Evidence: blind: with I(θ) = Ixx cos²θ + Iyy sin²θ − Ixy sin 2θ for the axis at angle θ from x (Ixx = ∫y² dA, Iyy = ∫x² dA, Ixy = ∫xy dA), I is smallest at 2θ = atan2(Ixy, −(Ixx − Iyy)/2). The code's expression is the direction of the maximum. Box 4 m along x (the weakest axis is x, 0°):
  ```
  yaw 0  Imin 2.6667 axisMinDeg -90.000      (app shows "0.533 m @ 90°")
  yaw 30 Imin 2.6667 axisMinDeg -60.000      (weakest axis at +30°)
  yaw 90 Imin 2.6667 axisMinDeg -0.000       (weakest axis at 90°)
  ```
  The reported angle is always the weakest axis + 90°, which is the horizontal direction the body heels toward, not the axis. GM_min itself is right.
- Why it matters: a user deciding where to put ballast or which way the body tips reads an axis that is perpendicular to the true one.
- What would resolve it: report the axis (add 90°), or relabel as "heels toward"; add a test on a yawed box (no test reads `axisMinDeg` or `GMmin` today; mutations M03, M04 survive).

### R1-08 Most stability read-outs have no test; the Node "stable" oracle is weaker than the app's verdict
- Severity: minor
- Kind: validation gap
- Claim challenged: `docs/validation-map.md:20` "Verdicts for 5 bodies against the proved criteria (`validate-proofs`)" and `:21` GZ row.
- Evidence: `grep -rn "stabilityVerdict\|gzSummary\|openEdgeCount\|GMmin\|axisMinDeg\|freeboard" test/` finds none of them. `validate-proofs` checks `(H.GMt > 0) === p.stable` (`test/validate-proofs.mjs:56`) and `validate-core` checks `H.GMt > 0 && H.GMl > 0` (`test/validate-core.js:53`). Neither is the app's verdict, which uses GM_min (`js/app.js:590`). For a body whose waterplane has Ixy ≠ 0, GM_T and GM_L can both be positive while GM_min < 0 (box 4 × 2 × 2 yawed 45°, T 0.4, KG 1.2: GM_T = GM_L = 1.083 m, GM_min = −0.167 m), so the oracle would call an unstable body stable. All test models are axis-aligned, so the oracle never meets this case. Survivors of the full `validate-node fine` and `validate-proofs` (table below) include:
  - the verdict threshold (M05), GM_min using I_max (M03) and the weakest-axis sign (M04);
  - the "unstable" test (M06), the vanishing-angle interpolation (M07) and the max-GZ search (M26);
  - the pitch-GZ sign (M12), BM about the wrong axis (M13) and the waterplane centroid (M14);
  - freeboard (M20), righting moment per degree (M22), the watertight check (M17) and the STL flip (M18).

  The Python ports (`validate.py`, `simcheck.py`, `verify_physics.py`) are line-for-line ports of the same algorithm, so they cannot catch a JS mutation and are not independent evidence.
- Why it matters: these are values a user reads (verdict, max GZ, AVS, loll angle, weakest axis, watertight). Regressions in them would ship silently.
- What would resolve it: Node tests for `stabilityVerdict`, `gzSummary` (box AVS 90°, max 0.3232 m at 40°; catamaran AVS 18.2°), pitch GZ (box 5°, 10°: 0.265484, 0.535731 m, wall-sided), GM_min and the axis on a yawed box, an off-centre waterplane (BM must use the centroidal axis), and open or flipped meshes. Use GM_min > 0 as the "stable" oracle.

### R1-09 Settle (fast) stops while the body is still swinging when the mesh is large
- Severity: minor
- Kind: code bug
- Claim challenged: `js/app.js:816-845`: "settled" is tested once per frame as t > 1 s and |v|/diag + |ω| < 2e-4, with `budget = floor(4e6/triangles)` steps per frame; the attitude is then copied back as "a stable resting attitude".
- Evidence: the same loop in Node (`node $S/falsesettle.mjs`, `node $S/tender.mjs`; the triangle count only sets the frame size). Box released at 20°, equilibrium 0°: with 12 triangles, error 0.000°; with the frame size of a 20,000–400,000-triangle mesh, it stops 0.04–0.25° off, still oscillating (max |roll − eq| over the next 20 s equals that error). A tender box (GM_T 0.01 m, wall-sided list −7.0017°): 12 triangles gives −7.0017°; at the frame size of 100,000 triangles it stops at −6.9406° (ζ 0.25) and at −6.6255° (ζ 0.05), off by 0.38° (5 %). The tests use a stricter criterion (1e-6, `test/validate-core.js:141`) on 12-triangle boxes, so they never meet this. Confirmed in the app (`node $S/app_probe.mjs sphere`). For `test/models/sphere_r1.step` (51,066 triangles, 2094.4 kg, CoG (0, 0.05, 0.7)), the blind rest attitude has G under the centre: roll = −atan(0.05/0.3) = −9.4623°. Settle (fast) at ζ 0.05 stops at roll −9.35° and says "Settled — this is a stable resting attitude". The verdict refreshed from that attitude then says "This attitude is not at rest: B is 5.96e-4 m horizontally from G … The body will rotate — run the simulation". At ζ 0.25 it stops at −9.47°.
- Why it matters: CAD hulls at Fine quality have 10⁴–10⁶ triangles. The list or trim copied back is off by tenths of a degree, which is large for small-list problems.
- What would resolve it: use the test's criterion (1e-6), require it over several consecutive checks or a fixed simulated time, or finish with a static equilibrium solve (Newton on B–G offset), which converges to 1e-15 here.

### R1-10 Open meshes: inconsistent volumes on one screen, and an open hull drawn high above the origin is turned inside out
- Severity: minor
- Kind: code bug
- Claim challenged: `js/app.js:239-245`, `:278` ("volumes may be approximate"), `:441` (submerged % from the enclosed volume), `:226` (default mass), `:728-730` (target "Submerged %" uses `mp.volume`); `js/loader.js:20-25`.
- Evidence: a hull without a deck is a common STL. Its hydrostatics are exact while the opening is above water, because the tetrahedra start on the waterplane. But `massProperties` takes them from the file origin, so the enclosed volume depends on where the origin is. Box 4 × 2 × 1 without deck, keel at z = 0 (`$S/stl/box_nodeck.stl`, app):
  ```
  Enclosed volume 5.3333 m³ | Watertight 4 open edges | Mesh is not fully closed; volumes may be approximate.
  massInfo : Average density 600 kg/m³ · floats with 60% of its volume submerged
     Submerged fraction: 40 %    Draft 0.4 m    GMT 0.533 m      (3200 kg, KG 0.5: all correct)
  ```
  Two different "% submerged" figures appear on one screen, and the default mass and the "Submerged %" target use the wrong volume. With the keel 3 m above the file origin, the enclosed volume comes out negative, `soupFromIndexed` flips every triangle, and a floating body is reported as sinking (`node $S/stlflip.mjs`):
  ```
  keel at z=3 m: enclosed V 2.667  whole mesh flipped by import: true  -> status sinks, draft 1.000 (true 0.4)
  ```
  An open end at the waterline (end face missing) gives draft 0.48 m and GM_T 0.457 m against 0.4 and 0.533 m, behind only the "approximate" warning.
- Why it matters: open hull surfaces are the usual export from hull-design tools.
- What would resolve it: take total volume and centroid from `submerged(tris, zmax)` (the same reference trick), so they do not depend on the origin; decide the flip from a closed or consistently oriented test, not from the sign of an origin-dependent volume; say plainly that results are valid only while every opening stays above the waterline.

### R1-11 GZ curves are at fixed trim; the panel does not say so, and on an asymmetric hull the difference is large
- Severity: minor
- Kind: documentation
- Claim challenged: `js/physics.js:278-293`; `js/app.js:693` ("Heeling in roll from the current attitude…"). The limitation is stated only in `README.md:144`.
- Evidence: a scow (box 4 × 2 × 1 with the forward half's bottom rising to 0.8 m at the bow, draft 0.45 m, KG 0.55 m, G over B; `node $S/freetrim.mjs`). Free trim is my own search for the trim with B_x = 0 at each heel, using Float Sim's clipping (verified in the first "Checked and found sound" item):
  ```
  30°  fixed-trim GZ 0.3239   free-trim GZ 0.2902 at trim -4.24°
  40°  fixed-trim GZ 0.3531   free-trim GZ 0.2994 at trim -7.27°
  80°  fixed-trim GZ 0.1001   free-trim GZ 0.0386
  90°  fixed-trim GZ 0.0083   free-trim GZ -0.0378       fixed-trim AVS 90.9° (free trim about 85°)
  ```
  Fixed trim gives max GZ 18 % high and AVS about 6° high. The free-trim energy can never exceed the fixed-trim energy (min over trim ≤ value at fixed trim), so fixed trim errs on the unsafe side. Practice varies: [PRS technical report 72](https://prs.pl/wp-content/uploads/2024/05/tr_no_72.pdf) notes level keel for intact ships, and common software defaults to free trim ([navaltoolbox tutorial](https://navaltoolbox.github.io/navaltoolbox-lib/tutorials/stability.html)).
- Why it matters: the Waves-stage verdict ("max roll … of 109° range: safe") uses this range.
- What would resolve it: state "fixed trim" in the GZ panel, or offer free trim.

### R1-12 The GZ panel misses an instability whose loll angle is below 5°
- Severity: minor
- Kind: code bug
- Claim challenged: `js/physics.js:308`: `unstable: curve[1].gz <= 0`, sampled only at 5°.
- Evidence: STEP box, KG 1.0353 m, so GM_T −0.002 m and a wall-sided loll angle of 3.97° (`node $S/app_probe.mjs tender`):
  ```
  verdict  : Unstable | … the body will roll/flip to a different floating attitude.
  gzInfo   : … Max GZ 0.031 m at 25° … | Angle of vanishing stability: 36.8°
  ```
  The GZ panel reports no instability, so the two panels disagree. Mutation M06 (test on curve[2]) survives all suites. The panels also disagree whenever the weakest axis is not world x or y. Box 4 × 2 × 2 yawed 45°, T 0.4, KG 1.2: GM_min −0.167 m, so the verdict is "Unstable", while GZ about world x is +0.095 m at 5° and +0.194 m at 10°. The GZ panel heels only about x or y.
- Why it matters: two panels, two conclusions. The GZ panel also hides the loll angle.
- What would resolve it: take the sign of GM (or GZ at 0.5°) for "unstable", and find the loll angle by root-finding near 0. Offer heeling about the weakest axis, or say on the panel when GM_min is below the GM of the axis shown.

### R1-13 The settling test tolerances are far looser than the simulator's accuracy
- Severity: minor
- Kind: validation gap
- Claim challenged: `test/make_models.py:84,120`: `tol_deg=0.15` (box_list) and `0.3` (square_log_45).
- Evidence: the simulator reaches −5.319973° against −5.319994° (2e-5°) and 44.999982° against 45° (`$S/base-fine.txt`). Equilibrium is where buoyancy torque vanishes, so damping and integrator error do not bias it. Mutation M27 (a 1 mm bias in the sim's buoyancy lever, which moves the list by 0.001/0.533 rad = 0.11°) passes every check. A 2 mm bias (M24) is caught.
- Why it matters: a millimetre-scale lever bug in the simulator would pass.
- What would resolve it: 1e-3° is still about 50× the achieved error.

### R1-14 The watertight check flags the project's own closed STEP sphere as "not fully closed"
- Severity: minor
- Kind: code bug
- Claim challenged: `js/physics.js:311-329` counts an edge as open when it is "not shared by exactly two triangles"; `js/app.js:278` then warns "Mesh is not fully closed; volumes may be approximate."
- Evidence: `test/models/sphere_r1.step` and `kramer_sphere.step` give "2 open edges" at every mesh quality (`node $S/openedges.mjs`). With exact vertex keys, every directed edge is matched by its reverse (0 unmatched), so the surface is closed and consistently oriented. The two flagged edges are at the poles, each shared by 4 triangles: two pairs of opposite orientation, where the importer leaves degenerate pole triangles (`node $S/openedges2.mjs`). The app shows the warning for this valid solid (`app_probe.mjs sphere`: "Watertight 2 open edges | Mesh is not fully closed; volumes may be approximate."). Cylinders and boxes are not flagged.
- Why it matters: a false warning on a clean B-rep solid teaches users to ignore it, and R1-02 shows the check also misses real defects.
- What would resolve it: test directed-edge balance (each p→q matched by a q→p), which accepts this mesh and rejects R1-02's.

## Questions for the defender

- Q1 Which source supports the cube's corner-down rest at s.g. ½ (`make_models.py:105`) and the s.g. range where it holds? Erdős, Schibler & Herndon Part 1 (Am. J. Phys. 60, 335) treats prisms; the cube is in Part 2 (Am. J. Phys. 60, 345–356, 1992), and Gilbert, Amer. Math. Monthly 98 (1991) 201–216, also treats it. I could not read either (paywalled). The simulator also goes corner-down at s.g. 0.25 and 0.3; is that right?
- Q2 Where do the verdict thresholds (GM/beam 0.02, 0.06, 0.2) come from? I found no source.
- Q3 Overlapping shells inside one STL (e.g. a cabin shell intersecting the hull) are double-counted with no hint; the hint (`js/app.js:279`) appears only for multi-solid STEP. Intended?
- Q4 `solveWaterline` returns 'sinks' when mass = ρ·V_total exactly (neutral buoyancy), and the verdict then says "Weight exceeds buoyancy". Intended?
- Q5 The STEP sphere's fine mesh has degenerate pole triangles (R1-14). Do they affect anything beyond the open-edge count, e.g. the panel-method meshing in later rounds?

## Checked and found sound

- GZ against an independent exact 2D reference: my own Sutherland–Hodgman clip and bisection, shares no code, `$S/ref2d.py`, `$S/gz_compare.mjs`. Box 4 × 2 × 1 (T 0.4, KG 0.5) at 5–175°, covering bilge emergence (21.8°), deck-edge immersion (31.0°), 90° (GZ = 0) and inverted: worst |error| 2.6e-16 m. V-section (30° half-angle, T 0.6, KG 0.35) at 5–90°: 4.4e-12 m. Round bilge (r 0.3 m, 8000 facets, T ≈ 0.4) at 5–90°: 1.2e-12 m. Wall-sided formula reproduced up to 20°.
- A 3D case with no prismatic shortcut (`$S/sphere.mjs`): `sphere_r1.step` (fine, 51,066 triangles), G 0.3 m below the centre, at 25 %, 50 % and 80 % immersion, roll and pitch, 10–170°. Blind GZ = 0.3 sin φ exactly (M at the centre). Worst error 3e-5 m (faceting).
- Target float plane in the app (`app_probe.mjs target`). Box: ref z 0.3 gives 2400 kg; 25 % submerged gives 2000 kg at draft 0.25 m. Heeled 10° with draft 0.3 m gives 1052.6 kg, and the CoG shift (0, −0.34, 0.06) is R^T(0, −0.3485, 0). My 2D code gives 1052.57 kg and B_y −0.3485 m.
- Pitch GZ, box 5° and 10°: 0.265484 and 0.535731 m, equal to the wall-sided formula (6 digits).
- Calm-water equilibria (`$S/run_settle.mjs list`). List from a 50 mm CoG offset: −5.3200° (wall-sided −5.31999°). Trim from a 100 mm LCG offset: +1.8871° (wall-sided +1.88706°). List and trim together: settles where the static B–G offset is 4.6e-16 m.
- Square log beyond s.g. ½ (the Erdős et al. Part 1 regime of tilted, asymmetric rests). My 2D code (`$S/ref_log.py`) reproduces the literature thresholds: upright stable below 0.2113, 45° stable above 9/32 = 0.28125. In between it gives rests at 13.6749° (s 0.22), 26.5651° = atan ½ (s 0.25) and 33.6901° (s 0.27). Float Sim's simulator, released at 3° (`$S/log_settle.mjs`), settles at 13.6747/13.6749°, 26.5650/26.5651°, 33.6899/33.6901° and 45.0000° (test loop / app loop).
- `proofs/expected.json` is reproducible: running the built `expected` binary in a scratch directory writes a byte-identical file.
- Scale and borderline bodies (`$S/scale.mjs`): s.g. 0.99999 and 1e-5 boxes, a 1 mm cube and a 50 µm cube (s.g. 0.15), and a 400 × 60 × 30 m barge 5 km from the origin. Draft, GM and GZ(5°) match the closed forms to 8 significant figures.
- STEP units: the box written in mm, in m (`SI_UNIT($,.METRE.)`) and in inches (`CONVERSION_BASED_UNIT` 25.4 mm) imports as 4.000000 × 2.000000 × 1.000000 m, 8.000000 m³ (`$S/units.mjs`).
- Baselines reproduced: `validate-node fine` 361/361 (250 s), `validate-proofs` 18/18, `validate.py` 126/126, `simcheck.py` 2/2, `verify_physics.py` all pass. Lean: `#print axioms` on all Hydrostatics and Stability theorems shows only the three standard axioms.
- Formulas read against the literature: tetrahedral volume and centroid from a waterplane point; Green's theorem for area, ∫x dA, ∫x² dA, ∫y² dA and ∫xy dA; second moments shifted to the waterplane centroid; BM = I/V; GM = KB + BM − KG; TPC = ρA/100; GM_min from the principal waterplane moments. The cube criterion 6s² − 6s + 1 > 0 and the cylinder criterion r/H > √(2s(1 − s)) re-derived by hand.
- App read-outs for the STEP box agree with the closed forms: draft 0.4, KB 0.2, BM_T 0.833, BM_L 3.333, GM_T 0.533, GM_L 3.033, 80 kg/cm, B at (2, 0, 0.2).

## Mutation testing

Each mutation was applied to a fresh copy of the code (`$S/mut/<id>`, driver `$S/mutate.mjs`, list `$S/mutations.json`). "core" = the 132 hydrostatic, GZ and settling checks of `validate-core.js`; "full" = `node test/validate-node.mjs fine` (361 checks, all modules); "proofs" = `node test/validate-proofs.mjs`. e2e was not run on the mutants unless stated.

| Mutation (file:line, change) | Caught by | Survived? |
| --- | --- | --- |
| M01 physics.js:160, a vertex on the waterline counts as submerged (`z < 0` → `z <= 0`) | none (equivalent except for vertices exactly on the plane) | survived |
| M02 physics.js:253, BM_L uses Ixx | core (box, hcyl, v_prism BM_L), proofs | caught |
| M03 physics.js:261, GM_min uses I_max | none: full, proofs and e2e (122/122) all pass | survived |
| M04 physics.js:258, weakest-axis angle sign (−2Ixy → +2Ixy) | none | survived |
| M05 physics.js:335, verdict "Unstable" only for GM < −0.1 m | e2e ("cube s.g. ½ upright → Unstable" fails); no Node test | survived Node, caught by e2e |
| M06 physics.js:308, `unstable` tested on curve[2] (10°) | none | survived |
| M07 physics.js:299, zero-crossing interpolation uses b.gz | none | survived |
| M08 physics.js:200, Ixy Green's-theorem factor 2 dropped on x0·y0 | full: `wave_rao_limits` (roll/pitch symmetry zeros) and `refcsys_pipeline`; not by any hydrostatic check | caught (indirectly) |
| M09 physics.js:274, TPC halved | core (box kg/cm) | caught |
| M10 physics.js:228, 'sinks' only if target > total | none (boundary) | survived |
| M11 physics.js:234, waterline volume tolerance 1e-10 → 1e-4 | core (v_prism, 7 checks), proofs | caught |
| M12 physics.js:289, pitch GZ sign flipped | none (no pitch GZ test) | survived |
| M13 physics.js:252, BM_T about G's axis, not the waterplane centroid (Ixx + A·c_y²) | none (all test waterplanes are centred on G) | survived |
| M14 physics.js:209, waterplane centroid doubled (6A → 3A) | none | survived |
| M15 physics.js:140, parallel-axis term sign (−ddᵀ → +ddᵀ) | full: `refcsys_inertia` | caught |
| M16 sim.js:15, zero initial kick (an unstable upright cube balances forever) | none in Node; e2e section 5 "cube leaves the unstable upright attitude" should catch it (not run) | survived Node |
| M17 physics.js:327, only edges used once count as open | none | survived |
| M18 loader.js:21, inverted parts never flipped | none (no STL or inverted-mesh test) | survived |
| M19 physics.js:198, Iyy cross term doubled | core (BM_L of boxes and cubes), proofs | caught |
| M20 physics.js:265, freeboard measured from zmin | none | survived |
| M21 physics.js:287, heeled waterline solved for 1.001 × displacement | core (box GZ 5–20°); the circular log cannot see it (GZ = GM sin φ at any volume) | caught |
| M22 physics.js:272, righting moment per degree of roll uses GM_L | none | survived |
| M23 sim.js:44, pitch torque scaled 1.02 (equilibrium unchanged; changes pitch dynamics only) | none (near-equivalent for the static result) | survived |
| M24 sim.js:40, buoyancy lever +2 mm in y | core (box_list and square_log sim roll) | caught |
| M25 physics.js:119, centroid 1 % off (det·s/24 → /23.76) | full: `refcsys_yup` (centroid height); the hydrostatic cases give the CoG explicitly | caught (indirectly) |
| M26 physics.js:302, max-GZ search skips 5° | none | survived |
| M27 sim.js:40, buoyancy lever +1 mm in y (shifts box_list list by 0.11°) | none (sim tolerance 0.15°) | survived |
| M28 physics.js:259, GM_T + 0.5 mm | core (12 GM_T checks), proofs | caught |

Totals: 28 mutations. 10 caught by the Node suites, two of them (M08, M25) only through wave or reference-csys checks. 18 survive every Node suite. Of those, M01, M10 and M23 are near-equivalent. M05 is caught by e2e; M03 survives e2e as well. e2e was run as `E2E_SKIP_VALIDATE=1 node test/e2e-browser.mjs` against my own server on each mutant copy (ports 8791 and 8792, stopped afterwards): M05 120 pass, 1 fail (`$S/e2e-M05.txt`); M03 122/122 (`$S/e2e-M03.txt`).
