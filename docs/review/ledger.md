# Independent review ledger

An independent reviewer agent (`.claude/agents/floatsim-reviewer.md`, Claude Fable 5.2) reviews one core part of
Float Sim per round, in the order of the [validation map](../validation-map.md). It reads the code, runs models in
the app and in Node, compares with the literature, audits the tests (including mutation testing) and the Lean
proofs, and files evidence-backed findings. The defender (the agent that wrote the code) answers each finding by
defending it with evidence, conceding and fixing it, or clarifying the documentation. The reviewer must reproduce
any evidence before closing a finding; after three exchanges an open finding goes to the owner with both
positions. The owner approves each round's findings before fixes are made, and each round's fixes ship as one PR.

| Round | Scope | Status | Findings | PR |
| --- | --- | --- | --- | --- |
| 1 | Hydrostatics and upright stability: waterline, displacement, KB, BM, GM, GZ curves, free-float equilibrium | the owner approved the agreed fixes (2026-11-25) and added two items: Lean proofs of the code's own formulas, volume included, and an optional free-trim GZ. All fixes are made on branch `review/round-1-hydrostatics`; the reviewer's re-run is next (on Claude Opus 5.5: no Fable 5.2 credits left) | 14 findings, 5 questions ([report](round-1-findings.md)) | opens after the re-run |
| 2 | Panel-method coefficients | not started | | |
| 3 | RAOs and the Capytaine comparison | not started | | |
| 4 | Time-domain simulation and the drop test | not started | | |
| 5 | Small-body tools: mooring, drag, wind, tracked points | not started | | |
| 6 | Reference csys and frames | not started | | |
| 7 | User interface and workflow | not started | | |

Each finding's status is one of: open, defended (reviewer agreed), conceded (fixed in the round's PR), clarified
(documentation changed), escalated (owner decides), withdrawn.

## Round 1: hydrostatics and upright stability

Reviewer's report: [round-1-findings.md](round-1-findings.md) (14 findings, 5 questions, 28 planted mutations of which
18 survived every Node suite). The defender reproduced R1-02, R1-03, R1-07 and R1-14 independently before answering.

| ID | Severity | Finding | Defender's answer | Proposed resolution | Status |
| --- | --- | --- | --- | --- | --- |
| R1-01 | major | Verdict says "strongly self-righting" from GM/beam alone (box with vanishing angle 90°, catamaran with 18°); beam is axis-aligned, so the verdict changes with yaw; "will loll" for GM 0.5 m on a 32 m beam | Concede. The thresholds (Q2) are heuristics with no source, and the verdict never looks at the GZ curve | Initial-stiffness wording from GM only (no beam ratio, or beam across the weakest axis), large-angle wording from the GZ curve (vanishing angle, max GZ); "self-righting" only when the vanishing angle exceeds 180°; never "loll" for GM > 0; tests for both bodies | open: fix agreed by the reviewer |
| R1-02 | major | Mis-oriented faces pass as "watertight" and give wrong hydrostatics (reproduced: draft 0.6 m, GM_T −0.585 m instead of 0.4 m and 0.533 m) | Concede | Directed-edge check: report inconsistently oriented faces, re-orient by propagation across shared edges where possible, flag BM < 0 or waterplane area ≤ 0 as a mesh error; flipped-face tests | open: fix agreed by the reviewer |
| R1-03 | major | The map claims a cube-settling test that does not exist (reproduced: only box_list and square_log_45 run the simulator) | Concede | Add a settling check for the cube released upright (expect the body diagonal vertical, tight tolerance) and keep the map's claim only once it passes | open: fix agreed by the reviewer |
| R1-04 | minor | README and the GZ panel give the cube's resting attitude wrongly (edge-down is neutral; corner-down is the rest) | Concede | Fix README and the e2e comment; word the loll line as a fixed-trim result | open: fix agreed by the reviewer |
| R1-05 | minor | After Settle the app says "nothing to move" when the cube just rolled corner-down | Concede | Set the flag only when the start attitude was stable and the attitude did not change | open: fix agreed by the reviewer |
| R1-06 | major | The hydrostatics and stability proofs back the reference values, not the code's formulas (signed tetrahedra, Green's-theorem waterplane moments, Newton waterline) | Concede for the Hydrostatics and Stability rows. Clarify: the Frames, Euler and PointTransfer theorems do model the code (rotation matrices, the `transferToG` matrix and `toEulerDeg` are transcribed entry by entry), so the criticism does not extend to them | Reword those two rows: "Proven: the exact answers the tests check against", and rename the column for them; owner's choice whether to also prove the code's formulas (polygon area and moments by Green's theorem are within reach; the polyhedral volume and centroid of a cut triangulated surface are a larger proof) | open: rewording agreed by the reviewer |
| R1-07 | minor | "GM about weakest axis @ angle" is 90° off (reproduced: box along x shows 90°, weakest axis 0°) | Concede | Report the axis angle (add 90°, normalised to ±90°) and test on yawed boxes | open: fix agreed by the reviewer |
| R1-08 | minor | Most stability read-outs untested; the "stable" oracle (GM_T, GM_L > 0) is weaker than the app's (GM_min > 0); 15 real mutations survive | Concede | Tests for the verdict, gzSummary (box: vanishing 90°, max GZ 0.3232 m at 40°; catamaran: vanishing 18.2°), pitch GZ, GM_min and its axis on yawed and off-centre waterplanes, freeboard, righting moment per degree, open and flipped meshes; GM_min > 0 as the oracle; re-run the reviewer's mutations to confirm they are caught | open: fix agreed by the reviewer |
| R1-09 | minor | Settle (fast) stops while large meshes still swing (sphere: −9.35° against −9.46°) | Concede | Stricter criterion held over several checks, then a final static equilibrium solve | open: fix agreed by the reviewer |
| R1-10 | minor | Open meshes: origin-dependent enclosed volume, contradictory submerged fractions, a whole open hull flipped inside out | Concede | Total volume and centroid from the clipped closed volume (origin-independent); orientation decided by the directed-edge test, not the volume sign; state that results hold while openings stay above water | open: fix agreed by the reviewer |
| R1-11 | minor | GZ curves are at fixed trim without saying so; on an asymmetric hull the error is unsafe-side | Clarify, and offer a feature | Label the panel "fixed trim"; free-trim GZ as an option is the owner's call (it changes run time) | open: labelling agreed by the reviewer (also on the Waves-stage range verdict) |
| R1-12 | minor | GZ panel misses instability with a loll angle below 5°; heels about world x even when the weakest axis is elsewhere | Concede | Instability from the sign of GM_min; root-find the loll angle; heel about the weakest axis or say when GM_min is below the shown axis's GM | open: fix agreed by the reviewer |
| R1-13 | minor | Settling tolerances (0.15°, 0.3°) far looser than the simulator's accuracy (2×10⁻⁵°) | Concede | Tighten to 1×10⁻³° | open: fix agreed by the reviewer |
| R1-14 | minor | The closed STEP sphere is reported "not fully closed" (reproduced: 2 open edges at the poles, degenerate triangles) | Concede | Drop degenerate triangles before the edge check and use the directed-edge balance test (shared with R1-02) | open: fix agreed by the reviewer |

Answers to the reviewer's questions:

- **Q1 (source for the cube's corner-down rest at s.g. ½):** none verified. The claim came from the simulator and from GM_min > 0 at that attitude. The defender cannot check Erdős et al. Part 2 either. Proposed: an independent global energy minimisation over all orientations (not only face-, edge- and corner-down) as the reference, and cite the literature only once read.
- **Q2 (verdict thresholds 0.02, 0.06, 0.2 of beam):** heuristics with no source. Handled under R1-01.
- **Q3 (overlapping shells in one STL counted twice):** not intended to be silent. Proposed: count the closed shells in an STL and warn when there is more than one or when shells overlap, as the STEP import does for several solids.
- **Q4 (exact neutral buoyancy reported as "sinks: weight exceeds buoyancy"):** the wording is wrong at equality. Proposed: report "neutrally buoyant: fully submerged, no float plane" when the mass equals the displaced mass of the whole body within round-off.
- **Q5 (degenerate pole triangles in the panel-method mesh):** outside round 1; carried to round 2. The sphere's panel-method results match Hulme's exact solution and Capytaine, so no effect is visible so far.

### Reviewer's reply

Nothing is fixed yet. A finding moves to closed only after I re-run my evidence and mutations against the fix PR. "Open: fix agreed" means I accept the proposed fix as sufficient and will close the finding once I reproduce it.

| Finding | Status | Reason / what I will re-run |
| --- | --- | --- |
| R1-01 verdict "strongly self-righting" | Open: fix agreed | Re-run `app_probe.mjs basic` (box: AVS 90°, not "self-righting"; catamaran: AVS 18.2°). Check yaw 0/20/45° give the same verdict. Check `stabilityVerdict(0.5, 32)` no longer says "loll". Also run M05. |
| R1-02 mis-oriented mesh "watertight" | Open: fix agreed | Re-run `badmesh.mjs` and `stl/box_flipped_side.stl` in the app: expect a warning, or re-orientation giving draft 0.4 and GM_T 0.533. Check no negative BM is shown. Also run M17 and M18. |
| R1-03 cube-settling claim untested | Open: fix agreed | The new test must fail with M16 (zero kick). The map claim stays only once the test passes. |
| R1-04 cube rest attitude in README/GZ panel | Open: fix agreed | Check the text. |
| R1-05 "started at rest" after the cube moved | Open: fix agreed | Re-run `app_probe.mjs cube`. |
| R1-06 proofs back references, not code | Open: rewording agreed | Agree with the split as far as round 1 goes: the Hydrostatics and Stability rows should say "Proven: the exact answers the tests check against". The Frames, Euler and PointTransfer rows are outside round 1; I have not checked them and will judge them in the round that covers them. Proving the code's own formulas is the owner's call. With the rewording, this finding closes as a documentation fix. |
| R1-07 weakest-axis angle 90° off | Open: fix agreed | Re-run the yaw 0/30/90° box: expect 0°, 30°, 90°. Also run M04. |
| R1-08 untested read-outs; weak oracle | Open: fix agreed | Re-run all 15 real survivors (M03–M07, M12–M14, M16–M18, M20, M22, M26, M27) against the fixed suite. Each must be caught by a Node test, not only by e2e. Check the yawed-box counter-example fails the new oracle. |
| R1-09 Settle stops while swinging | Open: fix agreed | Re-run `falsesettle.mjs` and `tender.mjs` at the frame sizes of 10⁵–4·10⁵ triangles. Re-run the app sphere case: expect −9.462° ± 0.01° at ζ 0.05, and no "not at rest" warning after Settle. |
| R1-10 open meshes | Open: fix agreed | Re-run `stlflip.mjs` (keel at z = 3 must float at 0.4 m) and `box_nodeck.stl` (one consistent % submerged). |
| R1-11 fixed-trim GZ unlabelled | Open: labelling closes it | Labelling closes it from my side if the "fixed trim" label is also on the Waves-stage range verdict ("max roll … of X° range"), which uses the same AVS. The unsafe-side gap on asymmetric hulls is then disclosed; whether to add free trim is the owner's call. |
| R1-12 instability with loll < 5° missed | Open: fix agreed | Re-run `app_probe.mjs tender` (KG 1.0353: the GZ panel must report instability and a loll angle near 3.97°) and the yawed 4 × 2 × 2 box. Also run M06. |
| R1-13 loose sim tolerances | Open: fix agreed | M27 (1 mm lever) must then fail. |
| R1-14 sphere flagged open | Open: fix agreed | Re-run `openedges.mjs`: 0 open for both spheres at all qualities, and R1-02's flipped box still rejected. |

#### Questions

- Q1: Acceptable, with two conditions.
  - The minimisation must be global: multi-start over orientations, not one descent from upright.
  - Its result must be checked against the code-independent closed forms: zG − zB = 0.25 face-down, 0.235702 edge-down, 0.234549 corner-down at s.g. ½.

  It reuses Float Sim's `submerged`. Round 1 verified `submerged` independently, so I accept it as the reference here. Please also say what it gives at s.g. 0.25 and 0.3, where the simulator also goes corner-down.
- Q2: Noted; covered by R1-01.
- Q3: The proposed warning is acceptable. Please add a test with two overlapping shells.
- Q4: The proposed wording is acceptable.
- Q5: Carried to round 2.

### Fixes made (for the reviewer's re-run)

The owner approved every fix the reviewer agreed to, and asked for two more things. First, Lean proofs of the code's
own formulas, including the volume, not only of the reference values (R1-06). Second, an optional free-trim GZ (R1-11).
Both are done. The reviewer's mutations were re-planted in the fixed code (`M03`–`M27`, the same faults at their new
places); every one of the 15 real survivors now fails a Node test. Results: `validate-node` 501/501 fine and
404/404 normal and coarse; `validate-proofs` 20/20; `lake build` 11 files with only the standard axioms;
`e2e-browser` 134/134; Python ports 126/126, 3/3 and all pass.

| ID | What changed | Where to check |
| --- | --- | --- |
| R1-01 | `stabilityVerdict(GM_min, {range, scale, freeTrim})`: the small-angle words come from GM about the weakest waterplane axis only; the beam ratio and the "tender / stiff / loll" words are gone. The range words come from the GZ curve about the weakest axis, in both heel directions (the worse one is used). "Self-righting" appears only when GZ stays positive to 180°. Level "Stable (small range)" when the maximum GZ comes before 25° (IMO 2008 IS Code, MSC.267(85), A 2.2.3, an angle, so it holds at any size). Never "loll" for GM > 0. The GZ curves run in a Web Worker (`js/gzworker.js`); until they arrive the verdict says the range is being worked out | `js/physics.js` `stabilityVerdict`, `js/app.js` `verdictFor`; `test/validate-stability.js` `stability_verdict` (box: vanishes at 90°, not self-righting; yaw 0°, 20°, 45° the same text; catamaran: small range, the 25° criterion; GM 0.5 m on a 32 m ship: no "loll") |
| R1-02 | New `js/meshcheck.js`: `meshCheck` welds the vertices and counts open edges (odd use) and misoriented edges (even use, unequal directions); degenerate triangles are left out. `repairMesh` (called on every import through `prepareMesh`) re-orients faces by propagation across shared edges, each shell keeping the winding of most of its faces, then turns a shell inside out only if its volume is negative and it lies inside no other shell. The model panel reports re-oriented faces, open edges, shells, voids and overlaps. `hydrostatics` sets `wpBad` (negative waterplane area or second moment), and the verdict then reads "Mesh error" | `validate-stability` `mesh_check` (one side, one triangle, the bottom, every face flipped: draft 0.4 m, GM_T 0.5333 m); `e2e-browser` 2d (an STL with a flipped side face, imported in the app) |
| R1-03 | `cube_corner_s050` has a `sim` block: released upright, it must end with a body diagonal vertical within 10⁻³°. The map claims the cube settling only now that the test exists | `test/make_models.py`, `test/validate-core.js` (`expect_up: 'diagonal'`); M16 (no kick) now fails it |
| R1-04 | README: released upright, the cube comes to rest corner-down; edge-down is neutral. The GZ panel words the loll line as "GZ (fixed trim, this axis) turns positive again at about X° … the 3D resting attitude can differ: use Settle"; the e2e comment is fixed | `README.md`, `js/app.js` `drawGZChart`, `test/e2e-browser.mjs` section 5 |
| R1-05 | "It started at rest … nothing to move" now needs the start to be a stable rest (B under G and GM_min > 0) and the body to end within 0.01° of where it started | `js/app.js` `startSim`/`simFrame`; `e2e-browser` 5 (cube after Settle: no such claim) and 2 (barge: the claim stays) |
| R1-06 | Rewording: the validation map now has two kinds of "Proven", *the code's formula* and *the reference values*, with a Kind column in the theorem table; the Hydrostatics and Stability theorems are marked as reference values. New proofs of the code's own formulas: `Proofs/Mesh.lean` (`massProperties` and `submerged` transcribed; reference-point independence of volume, first and second moments; the clipped surface plus a lid over the cut segments is closed; the lid adds nothing from the apex on the plane; the waterplane sums do not depend on the fan point; directed-edge balance implies closedness), `Proofs/MeshBox.lean` (the transcribed algorithm on a box of any size, position and draft returns the exact V, B, waterplane area, centroid and second moments), `Proofs/Tetra.lean` (one tetrahedron's determinant is its Lebesgue volume). Still taken as given: a closed mesh is a union of tetrahedra (the divergence theorem for polyhedra) | `docs/validation-map.md`; `cd proofs && lake build`; `validate-proofs` (the JavaScript on the Lean box, 2,000 random cases; `massProperties` from reference points up to 20 body sizes away) |
| R1-07 | `axisMinDeg = ½·atan2(I_xy, −(I_xx − I_yy)/2)`, the weakest axis itself, in (−90°, 90°]. Shown as "GM about weakest axis: X (axis at θ° from x)" | `validate-stability` `stability_readouts` (yaw 0°, 30°, 90°, −45°, 135°); M04 fails it |
| R1-08 | New `test/validate-stability.js` (138 checks, run by `validate-node` at every quality). The stable oracle is GM_min > 0 in `validate-core` and `validate-proofs`; the yawed 4 × 2 × 2 box (GM_T = GM_L = 1.083 m, GM_min −0.167 m) is in the tests | all 15 real survivors re-planted: each fails a Node test (list in the next paragraph) |
| R1-09 | Settle stops only when the body is slow (\|v\|/size + \|ω\| < 10⁻⁵ s⁻¹) and B is within 10⁻⁴ of the size from under G, held for 1 s of simulated time, checked every 0.25 s of simulated time (not once per frame); it then finishes with a static equilibrium solve (`restAttitude`: Newton on the two tilts, B under G to 10⁻⁹ of the size) and keeps that attitude if it is within 1° of the simulated one. The attitude is copied back to 10⁻⁴° (it was rounded to 0.01°) | the sphere in the app: −9.4622° at ζ 0.25 and 0.05 (blind −9.4623°, the faceted sphere), no "not at rest" warning; `validate-stability` `rest_and_trim` (wall-sided list to 10⁻⁶°) |
| R1-10 | `massProperties(tris, ref)` takes its tetrahedra from a reference point, by default the top centre of the bounding box, so the volume does not depend on the file origin and a hull open only at its deck gets its enclosed volume; the import's inside-out test uses that volume. One volume is used everywhere on screen. The model panel says the hydrostatics hold only while every opening stays above the waterline | `validate-stability` `mesh_check` (deckless box with the keel at z = 0, 3 and −7 m, every face flipped in the file: 4 open edges, 8 m³, draft 0.4 m) |
| R1-11 | The GZ panel and the Waves-stage verdict name the trim ("…of 90° range (GZ at fixed trim)"). New: a **Free trim** toggle (off by default). At every heel angle the body is then also turned about the horizontal axis at right angles to the heel axis, applied after the heel, until B is level with G along the heel axis, at the same displacement. The Waves-stage range follows the toggle | `js/physics.js` `gzAt`; `validate-stability` `rest_and_trim` (box: free = fixed; scow: no trimming moment, least energy, dE/dφ = W·GZ·cos(trim) to 5×10⁻¹⁰ m, and your numbers: 0.2902 m at −4.24°, 0.2994 m at −7.27°) |
| R1-12 | `gzSummary(curve, {GM, at})`: unstable from the sign of GM about the heel axis; loll and vanishing angles by regula falsi on the curve (to 10⁻⁹°), the maximum by golden section, inside the range of positive stability. The GZ panel can heel about the weakest axis (**Weakest**), and says when GM_min is below the shown axis's GM | `validate-stability` `gz_summary` (tender box: loll 3.93017°, the wall-sided value; yawed box about the weakest axis: unstable) |
| R1-13 | Settling tolerances 10⁻³° (box list, square log at 45°, cube corner-down) | M27 (1 mm lever) fails box_list, square_log_45 and cube_corner_s050 |
| R1-14 | Directed-edge balance with degenerate triangles left out | `validate-stability` `mesh_check`: `sphere_r1.step` and `kramer_sphere.step` closed at every quality (2 degenerate pole triangles each) |

Re-planted mutations (the fixed code's equivalent of each), and the Node test that now catches it: M03 GM_min from
I_max, M04 axis sign, M05 verdict threshold, M06 unstable test, M07 crossing refinement, M12 pitch-GZ sign, M13 BM
about G's axis and M14 doubled centroid (also `validate-proofs`), M17 an edge used three times, M18 inverted parts never
flipped, M20 freeboard, M22 righting moment per degree, M26 the maximum skipping 5° (`validate-stability`); M16 no
kick and M27 1 mm lever (`validate-node` sims). Three more planted on the new code: reversed propagation choice and
"turn every negative shell" are caught; a reversed trim axis is equivalent (the solver finds the opposite trim, same GZ).

Answers carried out:

- **Q1:** a global minimisation of z_G − z_B over all attitudes (Nelder–Mead from 40 starting verticals spread over the
  sphere, on Float Sim's `submerged`) finds corner-down at s.g. ½, 0.3 and 0.25: 0.234548547, 0.338726466 and
  0.370218744, equal to the Irwin–Hall closed form to 10⁻¹¹, with the vertical along a body diagonal within 10⁻⁵°.
  Edge-down (0.235702, 0.341958, 0.373773) and face-down (0.25, 0.35, 0.375) are higher. At s.g. ½ the search also
  finds a tilted local minimum (0.235182). The literature is still not read (Erdős et al. Part 2 and Gilbert 1991 are
  paywalled), so nothing cites it. `validate-stability` `cube_rest`.
- **Q3:** `repairMesh` counts shells and tests up to 8 points of each against the other closed shells (generalised
  winding number). A positive shell inside or cutting another is reported as an overlap whose volume is counted
  twice; a negative one inside is a void. Tested with a box and an overlapping cube, and with a box and an inner void.
  Voids count as flooded for buoyancy below the waterline; the model panel and README say so.
- **Q4:** `solveWaterline` flags `neutral` when the mass equals ρ·V_total within 10⁻⁹. The verdict then reads
  "Neutrally buoyant … hangs fully submerged with no float plane".

