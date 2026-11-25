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
| 1 | Hydrostatics and upright stability: waterline, displacement, KB, BM, GM, GZ curves, free-float equilibrium | the owner approved the agreed fixes (2026-11-25) and added two items: Lean proofs of the code's own formulas, volume included, and an optional free-trim GZ. The reviewer's re-run (on Claude Opus 5.5: no Fable 5.2 credits left) closed all 14 and filed R1-15 … R1-22; the owner asked for those to be fixed in this round too, and they are, with R1-D1 found by the defender, on branch `review/round-1-hydrostatics`. The reviewer's check closed all but R1-16 and filed R1-26 … R1-31 (two major: side effects of the fixes), now fixed too; the reviewer's check of those is next | 14 findings, 5 questions ([report](round-1-findings.md)); re-run: 14 closed, 11 new ([report](round-1-rerun.md)); check: 11 closed, 6 new ([report](round-1-check.md)) | opens after the reviewer's check |
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


### Re-run (reviewer, on Claude Opus 5.5)

Report: [round-1-rerun.md](round-1-rerun.md). All 14 findings and Q1, Q3 and Q4 are closed. The reviewer filed eight
new findings on the code the fixes added (R1-15 … R1-22, all minor), and the owner asked for them to be fixed in round
1's PR (2026-11-25). The mutation run, finished after a power cut, added three more (R1-23 … R1-25, all minor: test
gaps and a test-harness bug), which the defender fixed in the same PR under that instruction. While fixing R1-17 the
defender found one more problem in the round-1 code, listed as R1-D1.

Mutations, re-planted on 103de4d: 52 (the 28 of round 1 at their new places, 2 variants, 22 new on the code the fixes
added). The Node suites catch 47 of the 50 outside `js/app.js`; all 15 real round-1 survivors are caught. Five survive
every suite the reviewer ran: M01 (a vertex exactly on the waterline) and M23 (pitch torque × 1.02) are near-equivalent,
as in round 1; N21 and N22, the two halves of the Settle fix (R1-23); N18, the self-righting boundary (R1-25).

| ID | Severity | Finding | Defender's answer | Status |
| --- | --- | --- | --- | --- |
| R1-15 | minor | Open hulls get GZ curves and a verdict range past the angle where an opening goes under water (open box: "vanishes at 81.1°", water over the deck edge at about 31°); an opening below the waterline at rest gets only the general open-mesh note | Concede | fixed, for the reviewer's check |
| R1-16 | minor | An inside-out part that shares an edge with another part is not turned (stacked boxes: 4 m³ instead of 12 m³, every check green); an inside-out hollow part keeps its void as solid | Concede. The proposed fix (decide inversion per orientation component closed on its own) is not enough on its own: when two parts touch face to face, propagation stops at the four-use edges of the contact, so neither part is closed on its own. Contact faces are now paired as well | fixed, for the reviewer's check |
| R1-17 | minor (borders on major for the Settle demo) | For waterplanes with equal principal moments, the verdict's range is taken about a heel direction set by round-off (corner-down cube: 50.8° shown, 35.3° in the worst direction) | Concede. The range now comes from every heel direction, not only when the moments are close: the worst direction need not be the weakest axis on any body | fixed, for the reviewer's check |
| R1-18 | minor | The verdict contradicts the GZ panel on a self-righting sphere (faceting puts the zero at 179.997°); a raft with a 92.5° range is called "small range"; "Max GZ 0 m" when no GZ is positive; `gzSummary` has no round-off band, so the neutral edge-down cube reads stable or unstable depending on yaw | Concede all four parts | fixed, for the reviewer's check |
| R1-19 | minor | The overlap test samples 8 face centroids and misses shells that cross (two boxes crossing at right angles); the multi-body double-counting hint was hidden | Concede | fixed, for the reviewer's check |
| R1-20 | minor | The validation map's stated assumption is wider than what is true (Σ det/6 is the volume only for an embedded, outward surface); `Tetra` proves the volume only; `Balanced` assumes exact equality but `meshCheck` welds; "proved correct" | Concede: documentation | clarified, for the reviewer's check |
| R1-21 | minor | Welding rounds to a grid, so copies of a vertex a hair apart across a cell boundary are split (24 false open edges, 6 shells) | Concede | fixed, for the reviewer's check |
| R1-22 | minor | The import's nesting test runs on the main thread and grows with shells × triangles (64 shells × 3968 triangles: 12 s, page frozen) | Concede | fixed, for the reviewer's check |
| R1-23 | minor | No test can tell whether Settle ends with its static equilibrium solve: N21 (solve never used) passes all 131 e2e checks, because the check also accepts the "did not converge" message and the angles are rounded to 10⁻⁴° | Concede | fixed, for the reviewer's check |
| R1-24 | minor | `validate-node.mjs` (and four other runners) call `process.exit()` right after printing, which drops output not yet written to a pipe: the summary and the last cases can be lost (four false "CRASH" results in the review) | Concede | fixed, for the reviewer's check |
| R1-25 | minor | No test pins the verdict's "self-righting" boundary: N18 (a vanishing angle above 170° counts as self-righting) survives every Node suite | Concede | fixed, for the reviewer's check |
| R1-D1 | minor (found by the defender) | Free trim takes the first root of the trimming moment it finds, even where that trim is an energy maximum. Heeled about an axis of symmetry, the symmetric trim 0 is always a root, so `gzAt` returned it at once: the corner-down cube's free-trim range jumped from 23.3° to 54.7° between directions 7.5° apart. The free-trim curve is meant to be the trim of least potential energy (README, the scow tests) | Concede | fixed, for the reviewer's check |

#### Fixes made (for the reviewer's check)

| ID | What changed | Where to check |
| --- | --- | --- |
| R1-15 | `repairMesh` returns the corners of the edges used by one triangle (`report.openPts`); the app moves them with the body. `gzAt` reports how far the lowest opening point is below the waterline, and `gzAnalysis` finds the angle where it first goes under (regula falsi to 10⁻⁹°, 0 when one is under water at the start). `gzSummary` returns `flood` and `end` (the earlier of the vanishing and downflooding angles) and takes the maximum inside the range. The verdict's range ends there and says so ("an opening goes under water at X° (the downflooding angle)"). An opening under water at rest gives the verdict "Opening under water". The GZ panel draws the downflooding angle and fades the curve past it. The Waves-stage range follows | `js/meshcheck.js`, `js/physics.js` `gzAt`/`gzAnalysis`/`gzSummary`/`stabilityVerdict`, `js/app.js` `verdictFor`/`drawGZChart`, `js/seakeeping.js`; `validate-stability` stability_verdict (open-deck box about x against the [2D] code to 10⁻⁶°: 32.0054°, not the wall-sided 30.96°, because the bilge emerges first; the verdict's worst direction, a diagonal heel that floods at 15.2°; a missing end face: under water at 0°); `e2e-browser` 2d (open-deck STL, STL with a missing end face) |
| R1-16 | Shells are now orientation components that close on their own (the components that do not are grouped per edge-connected piece as before). Two parts touching face to face, at an edge used by four triangles of which two lie in the same half-plane: each contact patch is joined to the face on a fixed side of its plane (the patch with the lower number to the side its first triangle's normal points away from), so each part closes again. Shells are turned from the outermost in, and a shell inside a turned shell is turned with it when its winding was opposite to that shell's | `js/meshcheck.js` `repairMesh`; `validate-stability` mesh_check (stacked 4×2×1 + 4×2×1 and + 4×2×0.5 with the upper box inside out: 16 and 12 m³, also with the triangles in three shuffled orders; identical contact triangles in either file order; boxes sharing one edge; a hollow box inside out next to a raft: 106.5 m³, 1 void; box / void / core all inside out: 6.6 m³). Your `nonmanifold.mjs` and `shells.mjs` now give the true volume in every case |
| R1-17 | `worstHeelRange` (js/physics.js): GZ about the weakest axis and every 15° round from it, both senses (24 directions), then 7 refinements around the worst on a grid a third as wide each time (52 directions in all, a final grid of 0.007°). Worst = earliest end of the range; a tie goes to the direction found first, so a body with the same range every way (the box: 90° in every direction) keeps the weakest axis and its wording. Done for stable bodies; for unstable ones the loll angle still comes from both senses about the weakest axis. The verdict names the axis when it is not the weakest one. The app runs the curves in a pool of up to 6 workers | `validate-stability` stability_verdict (corner-down cube at yaw 0° and 13.3°: the worst range is atan(1/√2) = 35.2644° within 0.005°, where the weakest axis alone gives 50.8° and 45.8°) |
| R1-18 | (a) A crossing within 0.1° of 180° counts as positive to 180° (faceting). (b) "Small range" now means the range ends before 30°, from IS Code A 2.2.2 (GZ ≥ 0.2 m at 30° or more, which a range ending before 30° cannot give); an early peak, before 25° (A 2.2.3), is a separate note that does not lower the level. (c) The panel shows "GZ is not positive at any heel angle" instead of "Max GZ". (d) `gzSummary` treats \|GM\| ≤ 10⁻⁹ of the size as zero (neutral) and then reads stability from the curve | `validate-stability` stability_verdict (STEP sphere with G 0.3 m low: self-righting; raft: Stable plus the early-peak note; catamaran: small range citing A 2.2.2 and the 25° note; edge-down cube at yaw 0°, 10°, 33°: the same neutral summary) |
| R1-19 | `repairMesh` tests whether an edge of one shell passes through a face of another (bounding boxes first, then a grid). A crossing through a face's interior counts at once; one through a face's edge or corner is decided by the winding number just past it, so coplanar contact and grazing do not count. Nesting uses points just inside each face, so touching shells are not taken as nested. The multi-body hint is back ("treated as one rigid object … no overlaps were found; solids that overlap would have their shared volume counted twice") | `validate-stability` mesh_check (two boxes crossing at right angles, a cube poking out of a corner: overlaps; stacked boxes that only touch: none); `e2e-browser` 2d (crossing boxes in one STL) |
| R1-20 | The validation map and `Mesh.lean`'s docstring now state the assumption for closed, embedded, outward-oriented surfaces, say that the sums are the integrals of the winding number (overlaps count twice, inward gives −V), that `Tetra` proves the volume of one tetrahedron and not its moments (now a "next proof"), and that `meshCheck` tests the balance after welding to 10⁻⁷ of the size. "Proved correct" is replaced by what is proved | `docs/validation-map.md`, `proofs/Proofs/Mesh.lean` |
| R1-21 | `weld` joins a vertex to an earlier one within distance tol, found by a spatial hash on cells of size tol searched in the vertex's cell and its 26 neighbours | `validate-stability` mesh_check (copies 2×10⁻¹³ m apart straddling a cell boundary and the old rounding boundary: 8 vertices, closed; points 1.5 tol apart stay apart); your `weld.mjs` |
| R1-22 | The import repair runs in a worker (`js/meshworker.js`), and the page falls back to its own thread only when workers are unavailable. Bounding boxes are tested before any winding number or edge test, and a work budget (4×10⁸ elementary operations) replaces the 64-shell cap ("the overlap check stopped early" when it runs out) | `js/app.js` `prepareInWorker`; your `shellcost.mjs`, run back to back on this machine while it was busy: 16 shells × 3,968 triangles 434 ms (1,726 ms at 103de4d), 64 shells 1,475 ms (25,381 ms), now off the page's thread |
| R1-23 | The cube's Settle check now needs "Finished with a static equilibrium solve" (the fallback message no longer passes). New e2e case 4b: the box made tender (GM_T 0.01 m, CoG 2 mm off the centreline), whose simulation alone stops about 2.5×10⁻³° short of the wall-sided list; Settle must land on −7.001683° within 2×10⁻⁴° and say it finished with the solve. The box-list check's title gives its real tolerance (2×10⁻⁴°) | `test/e2e-browser.mjs` sections 4, 4b and 5 |
| R1-24 | The five runners exit from the callback of a last write to stdout, which runs only after everything written before it has gone out (`process.exitCode` alone could leave Playwright or the Capytaine helper holding the process open). Your `trunc/` reproducer, child changed only in its exit line: 1,000 and 5,000 lines, read at once or after 200 ms, all bytes and the summary arrive, exit code 1 kept; the original loses the summary in three of the four | `test/validate-node.mjs`, `validate-proofs.mjs`, `validate-bem.mjs`, `validate-capytaine.mjs`, `e2e-browser.mjs` |
| R1-25 | Verdict tests on two real bodies on the not-self-righting side: the box with KG 0.3 m (at rest; its worst direction is pitch, which vanishes at 99.9°, against the [2D] code on the 4 m section to 10⁻⁶°; roll at 112.32°, also against [2D]) and the STEP sphere with G 0.3 m low and 0.05 m off the centre (180° − atan(0.05/0.3) = 170.5377° within 0.01°; 170.5376° fine, 170.5351° coarse). With the self-righting STEP sphere (R1-18) they bracket the boundary. A mutant that widens the 180° tolerance to 170°, and one that calls any range past 95° self-righting, both fail | `validate-stability` stability_verdict |
| R1-D1 | After converging, `gzAt` checks the slope of the trimming arm. Where it falls through zero (an energy maximum), it goes down to the stable roots on either side and keeps the one of least energy | `validate-stability` rest_and_trim (corner-down cube heeled 10°, 15°, 20° about an axis of symmetry: a local energy minimum, below the symmetric trim's energy); the scow's least-energy and envelope checks still pass |

Results with these fixes: `validate-node` 549/549 fine and 452/452 normal and coarse (`validate-stability` 186 checks, was
138); `validate-proofs` 20/20; `lake build` passes with no `sorry`; `e2e-browser` 140/140 on 255c8b0, the validation page
included (549/549 fine, 452/452 normal and coarse); Python ports 126/126, 3/3 and all pass. Each new test was checked against a mutant
that restores the old behaviour (no stable-root step in free trim, no 180° tolerance, no round-off band, no contact-face
pairing, no parent-turn rule, no crossing test, a weld searching only its own cell, no downflooding angle, the weakest
axis only, contact patches taken in file order, a 170° self-righting cutoff, any range past 95° called self-righting):
each one fails. Two changes are equivalent and survive: welding on rounded instead of floored cells, and dropping the
coincident-triangle pairs, which the contact-face pairing already handles (that code was then removed).

### Check of the re-run fixes (reviewer, on Claude Opus 5.5)

Report: [round-1-check.md](round-1-check.md), on 255c8b0. Closed: R1-15, R1-17, R1-18, R1-19, R1-20, R1-21, R1-22, R1-23,
R1-24, R1-25, and R1-D1 for the bug. Still open: R1-16, for parts that share an edge but not a whole face (R1-26).
Of 42 mutations planted on the new code, 26 were caught. Six new findings, two of them major. They are side effects of
this round's fixes, so the defender fixed them in the same PR.

| ID | Severity | Finding | Defender's answer | Status |
| --- | --- | --- | --- | --- |
| R1-26 | major (regression) | The contact-face pairing breaks correctly wound parts that share an edge but not a whole face (a deckhouse flush with the hull side: 4 m³ for 12 m³, "Sinks", depending on which triangle is first); R1-16 stays wrong there | Concede | fixed, for the reviewer's check |
| R1-27 | minor | Shells that only touch are reported as overlapping (30 of 36 placements), because the edge/corner probe lands in the contact plane | Concede | fixed, for the reviewer's check |
| R1-28 | major | The verdict ends the range at the downflooding angle of every heel direction, pitch included: an open barge that floods at 48.4° in roll is "small range" from a direction that floods at 12.2° with 9.9 m of righting arm; the IS Code's θf is an angle of heel | Concede. The defender chose the criterion; the owner may prefer another (see below) | fixed, for the reviewer's check and the owner |
| R1-29 | minor | A range that ends before the first 5° sample has no maximum: "peaks at 0°" and "GZ is not positive" while GZ(2°) is +0.011 m | Concede | fixed, for the reviewer's check |
| R1-30 | minor | R1-D1's stable-root scan makes free trim 17× slower (112 s in the app on the 51k-triangle sphere) and silently keeps the energy maximum when it finds no stable root; "least potential energy" overstates a local branch | Concede | fixed, for the reviewer's check |
| R1-31 | minor | New thresholds and branches are not pinned (C10, C11, C18, C26, C27, C30, C02, C08, C09, C34), nor the app's sweep (E05) or the Waves-stage range with openings (E07) | Concede, except C10, C11 and C02 (see below) | fixed, for the reviewer's check |

#### Fixes made (for the reviewer's check)

| ID | What changed | Where to check |
| --- | --- | --- |
| R1-26 | At an edge used by four triangles, a contact triangle that belongs to a larger patch (the parts share an edge, not a whole face) is joined to its own patch's face at that edge. The fixed-side rule is kept only for isolated contact patches, where the contact faces coincide and either side closes both parts | `js/meshcheck.js` (contact pairing); `validate-stability` mesh_check (hull + flush deckhouse: both outward, the deckhouse inside out, the hull inside out, each in both file orders, and with each of the hull's 12 triangles first: 12 m³, closed, no overlap; the STL path with the deckhouse inside out: 12 m³); your `contact2.mjs`: 12 m³ in every case, no false overlap |
| R1-27 | The probe at an edge or corner crossing is moved just inside the shell whose edge it is (against that shell's outward normals at the edge) as well as past the crossing. It is then off every face of both shells, so it lies inside the other shell only if their insides overlap. Shells record their own triangles at each edge for this | `js/meshcheck.js` (`edgesInto`); `validate-stability` mesh_check (blocks on the deck or under the bottom, 8 placements × 2 orders: no overlap; two same-section blocks overlapping along their length: overlap); your `touch.mjs`: 0 of 36 (30 at 255c8b0) |
| R1-28 | `worstHeelRange` has two objectives. Capsizing: the earliest vanishing angle over every direction, as before. Flooding: the direction that floods with the least heeling moment, i.e. with the smallest largest righting arm up to its downflooding angle (the arm a steady heeling moment must overcome to get there; the weight is the same in every direction), among the directions that flood before they capsize. The range ends at the earlier of the two. The earliest downflooding angle over all directions is a note in the verdict when it comes sooner ("…but it takes a larger heeling moment to get there"). `gzSummary` reports the arm at the downflooding angle (`gzFlood`), so this objective is continuous across the 5° samples. The app and the tests call the same `verdictRange` | `js/physics.js` `worstHeelRange`, `verdictRange`, `stabilityVerdict`; `validate-stability` stability_verdict (barge 40 × 8 × 6 m open, T 2 m, KG 3 m: roll floods at atan(1.125) = 48.3665°; the verdict's range ends at 44.7°, 1.1° off roll, where it floods with a smaller arm than in roll; Stable; the 12.2° nearer pitch is the note). Open 4 × 2 × 1 m box: 24.3° at 10.4° off roll (the corners dip first; roll alone 32.0°). Square open box: 12.1° on the diagonal |
| R1-29 | When no sample lies in the range, the maximum is found on [start, end] by golden section (or, without refinement, the curve interpolated to the end). The GZ panel no longer prints a maximum when an opening is already under water | `js/physics.js` `gzSummary`, `js/app.js` `drawGZChart`; `validate-stability` stability_verdict (open box, freeboard 0.05 m: roll floods at atan(0.05) = 2.8624°; maximum positive, inside the range; no "peaks at 0°") |
| R1-30 | The search for stable trims goes to ±90° of trim in 0.1 rad steps (16 a side, was 60 steps of 0.05 rad to ±170°). Where it finds none, the unstable trim is kept and flagged (`trimUnstable`), the next angles of the curve skip the search, and the GZ panel says so. README and the validation map now say "a stable trim, following the local energy minimum from the previous angle". Without workers, the app takes only the weakest axis (Q2) | `js/physics.js` `gzAt`/`gzCurve`/`gzAnalysis`; the 51k-triangle sphere (G 0.3 m low, 0.05 m off centre), single-threaded: one free-trim `gzAnalysis` 1.1 s (9.1 s at 255c8b0); the verdict's whole range 29 s free and 5.4 s fixed (441 s and 10.8 s at 255c8b0); `validate-stability` rest_and_trim (STEP sphere: flagged from 85°, GZ equal to fixed trim's) |
| R1-31 | New tests: a catamaran whose range ends at 26.78° (the 30° rule, against [2D]); a square box that peaks at 22.90° (the 25° note, against [2D]); the STEP sphere with G 3 mm off centre, 179.43° (the 0.1° tolerance at 180°); the offset cube whose two stable trims differ in energy by 2.3×10⁻³ (started at the unstable trim, the lower is kept); touching blocks and a coplanar overlap (the probe); the app's sweep now is `verdictRange`, which the Node tests call; e2e: the cube's verdict after Settle reads "vanishes at 35.3°", and the Waves-stage roll range of the open-deck STL ends at the downflooding angle (32°). C10 and C11 (nesting samples outside, one sample enough) and C02 (contact sides swapped) remain equivalent on every test: the nesting decision only matters when surfaces do not cross, where inside or outside samples agree, and swapped sides close both parts when the contact faces coincide | `test/validate-stability.js`, `test/e2e-browser.mjs` sections 2d and 5. Mutants planted again by the defender on the new code: C30, C26, C27, C18, C08, the own-patch rule removed, the inward probe offset removed, untested shells turned again (Q1), R1-29's search removed, the flood objective by angle instead of arm: each fails |

Results with these fixes: `validate-node` 577/577 fine and 480/480 normal and coarse (`validate-stability` 214 checks);
`validate-proofs` 20/20; `e2e-browser` 142/142, the validation page included. No Lean or Python-ported code changed.

Answers to the questions:

- **Q1 (budget):** a fair catch. When the budget runs out, a negative shell whose possible containers (closed shells
  whose bounding box contains it) were not all tested is no longer turned, so a void stays a void. Tested with a budget
  of 1 on a box with an inward inner shell (7.75 m³).
- **Q2 (main-thread fallback):** yes. Without workers the app now takes only the weakest axis, both senses, and the
  verdict then says "About the weakest axis" (no "worst of all heel directions").
- **Q3 (three-use edges and opening points):** intended. An edge used three times is a junction (a fin or a partition
  meeting the hull), not a hole: the hull is closed across it. The holes are the edges used once, and those give the
  opening points. `meshCheck` counts both as open because both break the closedness the volume needs.

R1-28's criterion is the defender's choice, and the owner may prefer another:
1. Flooding counts only about the weakest axis (both senses), except on a square or round waterplane. This is the
   IS Code's heel for a ship, but it is discontinuous for nearly square bodies.
2. Flooding counts in directions whose waterplane second moment is within some percentage of the weakest. The defender
   tried 10 %: on the barge the edge of that band already floods at 38.3°, so the percentage decides the answer.

The least-moment rule needs no threshold and follows from what the downflooding angle is for. It gives near-roll
answers on long hulls and the diagonal on square ones.

### Second check of the fixes (reviewer, on Claude Opus 5.5)

Report: [round-1-check2.md](round-1-check2.md), on d43902d. Closed: R1-16, R1-26, R1-27, R1-29, R1-30, R1-31, and
Q1–Q3 answered. R1-28 is escalated to the owner (the choice of criterion). Of 56 Node mutants, 38 were caught, and 7
of 10 e2e mutants. Four new findings, one of them major. As before, the defender fixed them in this round's PR.

| ID | Severity | Finding | Defender's answer | Status |
| --- | --- | --- | --- | --- |
| R1-32 | minor | With fixed trim the least-moment flood objective compares only the arm about the heel axis and leaves out the moment that holds the trim, so skewed directions look cheaper (barge 44.7° 1.1° off roll, against 48.4°) | Concede | fixed, for the reviewer's check |
| R1-33 | minor (pre-existing) | An inner solid that shares a face with its container (the same triangles, wound the same way) is merged into one shell, and the overlap goes unreported | Concede | fixed, for the reviewer's check |
| R1-34 | major | With free trim the capsize objective, the earliest vanishing angle over every direction, is decided near pitch on slender hulls ("small range, vanishes at 12.5°" for a hull whose roll range is 78.6°), and 12.5° is where the refinement's start guess switches between two samples' trims, not a zero | Concede | fixed, for the reviewer's check |
| R1-35 | minor | Nine surviving mutants on the new code have no test (C34, F06, F08, F10, F11, F12, F14, F18, F20, G01, G02) | Concede, except F06 and F20 (see below); F11, F12 and F14 mutated code that is gone | fixed, for the reviewer's check |

#### Fixes made (for the reviewer's check)

| ID | What changed | Where to check |
| --- | --- | --- |
| R1-28, R1-32, R1-34 | One objective for both ways a range ends. The verdict's range is taken in the direction in which the least steady heeling moment ends the range, by capsizing or by downflooding, whichever comes first in that direction: the smallest largest arm of the buoyancy–weight couple up to the end (`gzSummary`'s new `arm`: B's horizontal distance from G, hypot(GZ, trimming arm), on the samples, at the end and at the refined maximum). With fixed trim it counts the trimming moment the fixed trim holds (R1-32); with free trim the trimming arm is zero. Directions whose range does not end are not candidates. The earliest end over every direction, of either kind, is a note when it differs at the verdict's 0.1° ("…the range ends sooner, at 99.9°, but it takes a larger heeling moment to get there"). The final run always uses the openings (`byFlood`, `gzFlood` and `floodAny` are gone; the note is `earliest`) | `js/physics.js` `gzSummary`, `worstHeelRange`, `verdictRange`, `stabilityVerdict`; `validate-stability` stability_verdict: the barge's range now ends within 0.15° of atan(1.125) and within 0.1° of roll (48.26° at −0.03°: the trimming arm adds to the arm only at second order while the downflooding angle falls at first order, so the least moment is a hair off roll); 1.09° off roll the arm is 1.11 m; the box with KG 0.3 m now ends at roll's 112.32° [2D], with pitch's 99.89° [2D] as a note; the 20 × 5 × 2.5 m hull with free trim ends at roll's 78.55° [2D] |
| R1-34 (folds) | Free-trim points between samples are followed up from the nearest point below on the curve's branch, in steps of at most 0.5°, and a step that changes the sign of GZ is not kept as a start point, so a crossing is found on one trim branch. Where that branch ends (the trim it follows stops being an equilibrium), GZ jumps; the summary flags it (`fold`), and the verdict and the GZ panel say so. `gzCurve` re-makes a step that loses the previous angle's stable trim in 0.5° sub-steps, so the samples follow the body too. With free trim, GZ within 1e-9 of the size counts as zero (a hull rolled 90° when heeled in pitch turns the heel into a yaw, GZ ≡ 0) | `js/physics.js` `gzCurve`, `gzAnalysis`; your `freebranch.mjs`: about 87.78° the range ends at a fold at 14.87° (your 0.25° continuation: between 14.75° and 15.00°), not 12.5°. The fold's angle is only as sharp as the branch: on this hull the roll minimum is very shallow from about 13° to 15° of pitch, and continuations in 0.25°, 0.05° and 0.01° steps lose it at 14.1°, 14.9° and 13.1° |
| R1-33 | At an edge used by four triangles where both half-planes hold a face of each part (two pairs of coincident directions), each part takes one face of each half-plane: its own when a patch holds both, otherwise the faces of the lower-numbered patches together, the same at every edge. Each part then closes on its own, and the nesting test finds the overlap | `js/meshcheck.js` (contact pairing); `validate-stability` mesh_check (the end slab, both file orders × 12 rotations: 2 closed shells, overlap reported); your `slab.mjs`: 2 shells, overlaps 2; `nest2.mjs`: 2 / 2 in all three cases; `contact3.mjs` (792 variants) and `touch.mjs`, `touch2.mjs`, `shells.mjs`, `nonmanifold.mjs`, `contact2.mjs`: unchanged |
| R1-35 | New tests: the conforming contact (the hull's deck split under the deckhouse) in 72 variants (C34); an L-section hull with an inside-out block in its notch and the budget one short of the whole check, found by bisection, so the pair is tested and the block turned (F08); the largest arm in roll equals GZ at the downflooding angle [2D] on the barge and on the low-freeboard box, whose range ends before the first sample (F10, F18); e2e: the GZ panel gives no maximum with an opening under water at the start (G01), and notes the angles with no stable trim on the buoy with free trim (G02) | `test/validate-stability.js`, `test/e2e-browser.mjs` (2d, 7b) |
| Q4 | The search for a stable trim, after one that found none, is made again 30° further along the curve (was never again), so a stable trim that comes back is found within 30°. The panel's note says "searched again every 30°" | `js/physics.js` `gzCurve`, `js/app.js` |
| Q5 | The verdict now names what it takes: "Heeled about the axis at X° from x, the direction in which the least heeling moment ends the range (fixed trim), …" | `js/physics.js` `stabilityVerdict`; `e2e-browser` 5 |

Cost on the 51k-triangle STEP sphere at fine quality, single-threaded (your `sweepcost.mjs`): the verdict's whole range
5.7 s fixed and 33.4 s free (G 0.05 m off centre; 5.6 s and 35.0 s at d43902d), 2.4 s and 22.7 s with G centred
(2.35 s and 12.9 s: the 0.5° sub-steps where the curve first loses its stable trim, and the 30° re-searches).

On the sphere with G off centre, every direction whose range ends takes the same largest arm, |CG|, because B is under
the centre. The verdict's direction is then any of them (177.5° here, between 170.5° about x and 180°), so the sphere
tests check the closed form about x and that the verdict's range lies between it and 180°, not self-righting.

Answers to the questions and to the mutants not given a test:

- **Q4:** a fair point; see the table. When no stable trim exists within ±90° (the sphere past 90°), the curve still
  follows the trim of maximum energy, flagged, and the panel says so.
- **Q5:** yes; see the table.
- **F06** (the probe without the step past the crossing): near-equivalent. The probe runs only when an edge of one shell
  crosses the other at a triangle edge or corner, and the step only matters when the inward offset lies in the other
  shell's face plane. In a triangulated mesh a neighbouring face diagonal then usually crosses the face's interior and
  finds the overlap first, or the inward offset already leaves the face plane: a square post through a
  fan-triangulated deck, with its four corners on the fan's edges, is caught at four heights in both file orders, one
  way or the other.
- **F20** (the trim flag kept after a stable trim is found): equivalent on every body found. It only matters when a
  stable trim comes back within ±90° after a stretch with none, and no such body turned up (the sphere and the buoy
  never get one back). The 30° re-search bounds what such a body would miss.
- **F11, F12, F14:** the code they mutated (the separate capsize and flood keys, and the final run without openings) is
  gone.

The owner's call on R1-28, with the reviewer's positions in [round-1-check2.md](round-1-check2.md): the defender now
applies the least-moment rule to both objectives with the full arm, as the reviewer's first option. The reviewer's
second option, both objectives only about the weakest axis, is one line in `js/app.js` (`sweep: false`), but brings
back R1-17 (a hexagonal or square waterplane's "weakest axis" is set by round-off). The defender also tried the least
energy to the end of the range (the area under GZ, as in the IS Code's area criteria): it picks near-pitch flooding on
the barge with free trim (10.6°), so it was not used.

**Owner's decision on R1-28 (2026-11-25):** the least-moment criterion, as built in b4541ad (both objectives, with the
full arm). R1-28 is settled on the criterion; whether the code applies it correctly is left to the reviewer's check of
b4541ad.

Results with these fixes: `validate-node` 591/591 fine and 494/494 normal and coarse (`validate-stability` 228
checks); `validate-proofs` 20/20; `e2e-browser` 144/144, the validation page included. No Lean or Python-ported code
changed.
