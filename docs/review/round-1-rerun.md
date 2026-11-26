# Round 1 re-run: hydrostatics and upright stability

Reviewer's worktree: `agent-a4346c395b65656ef` at `103de4d` (branch `review/round-1-hydrostatics`). Scripts and outputs are
in `/home/duff/float-sim/.claude/review-scratch/rerun/` (called `$S` below; git-excluded). My original scratch folder in /tmp
was lost when the machine went down near the end of the mutation run (2026-11-25, 05:43 UTC), so the scripts were restored
from my transcript; of the outputs this report cites, `base_fine.txt`, `lean/*.lean` (with their `*.out`), `e2e_base.txt`,
`mut2-log.txt` and `mut2-results.json` were regenerated after the restore, while the app-probe outputs (`probe_*.txt`) were
not and are no longer on disk (the probe scripts are). After the restore I re-ran `badmesh2.mjs`, `nonmanifold.mjs`,
`shells.mjs` and `settle3.mjs` myself and got the numbers quoted below. No project file was changed except this report.
Mutations were made in copies (`$S/mut2/<id>/`, `$S/e2e/<id>/`). My servers ran on ports 8791 (my worktree) and 8792–8793
(e2e mutant copies) and were stopped by PID at the end.

## Summary

I re-ran the evidence and mutations of every round-1 finding against `103de4d`, re-planted all 28 round-1 mutations
at their new places (plus 2 variants, M06b and M07b) and planted 22 new ones on the code the fixes added, checked the new
tests and the new Lean proofs (`Mesh`, `MeshBox`, `Tetra`, all re-checked from my worktree's copies, standard axioms only),
and drove the app in Chromium. Baselines reproduced: `validate-node fine` 501/501 (255 s on an idle machine; 558 s when
regenerated alongside seven other runs, `$S/base_fine.txt`), `validate-proofs` 20/20, `validate.py` 126/126,
`simcheck.py` 3/3, `verify_physics.py` all pass, `e2e-browser` (UI part, `E2E_SKIP_VALIDATE=1`) 131/131, "ALL PASSED"
(`$S/e2e_base.txt`).

All 14 findings close, and Q1, Q3 and Q4 are answered. The fixes do what was agreed, and the evidence reproduces: the
verdict follows the GZ curve and no longer depends on heading; flipped faces are repaired (draft 0.4 m, GM_T 0.533 m
for every flipped variant); the cube settling test exists and fails without the start kick; Settle lands on the
sphere's rest attitude to 10⁻⁴°; the weakest axis is right at every yaw; free trim matches my own trim search to
1.4×10⁻¹¹ m from 0° to 180°; an independent cube energy minimisation (no Float Sim code) confirms corner-down at
s.g. ½, 0.3 and 0.25.

Mutations: of the 52 (28 re-planted, 2 variants, 22 new), the Node suites catch 47 of the 50 outside `js/app.js`.
Five survive every suite I ran. M01 and M23 are near-equivalent, as in round 1. N21 and N22 are the two halves of the
Settle fix, which e2e cannot see (R1-23). N18 is the verdict's self-righting boundary (R1-25). The four "CRASH" results
before the interruption were my runner losing `validate-node`'s output, not crashes of the mutants (R1-24).

The new code and the mutation run bring eleven new findings (R1-15 to R1-25), all minor. The most useful ones to fix:
- R1-15: open hulls get GZ curves and a verdict range past the angle where the opening goes under water (open box:
  "vanishes at 81.1°", water comes over the edge at 31°).
- R1-16: an inside-out part that shares an edge with another part is not turned. It gives a wrong volume (4 m³
  instead of 12 m³) with every mesh check green.
- R1-17: for waterplanes with equal principal moments, the verdict's range is taken about one heel direction picked
  by round-off. On the corner-down cube it shows 50.8°; the worst direction gives 35.3°, peaking at 11.8°.
- R1-18: the verdict's wording contradicts the GZ panel on the classic self-righting body (a sphere with low G), and
  calls a 92.5° range "small".
- R1-23: no test can see Settle's final static equilibrium solve removed. Mutant N21 passes all 131 e2e checks, because
  the e2e check also accepts the "did not converge" message and reads angles rounded to 10⁻⁴°.
- R1-25: no test has a verdict on a body whose GZ vanishes between 90° and 180°, so mutant N18 survives: it calls a
  body that capsizes at 170.5° "self-righting".

Confidence: high in the hydrostatics, GZ, free trim, Settle and mesh repair on single shells; medium in the
multi-shell logic (nesting, overlaps, non-manifold contact) and in the verdict's range for near-isotropic waterplanes;
low in the tests of the app-only Settle code (R1-23), though Settle itself behaves correctly in every case I ran.

## Findings re-checked

| Finding | Status | Evidence (command and output, or file:line) |
| --- | --- | --- |
| R1-01 verdict "strongly self-righting" from GM/beam | **Closed.** The range words now come from the GZ curve; "self-righting" needs GZ > 0 to 180°; no beam ratio, no "loll" for GM > 0. Residual wording problems on other bodies are filed as R1-17 and R1-18 | Blind: box AVS 90° (B under G on its side, by symmetry); catamaran AVS 18.2° (my `ref_cat.py`, round 1). `node $S/app_probe.mjs basic`: box "Stable … peaks at 38.7° and vanishes at 90°; heeled past that, the body capsizes" (no "self-righting"); catamaran "Stable (small range) … peaks at 9.3° and is gone at 18.2° … IMO … A 2.2.3". `node $S/app_probe.mjs yaw`: the same verdict text, word for word, at yaw 0°, 20°, 30°, 45°, 90°. `validate-stability` checks `stabilityVerdict(0.5, {scale: 200})` has no "loll". M05 (Unstable only below −0.1 m) is now caught in Node: 498/501 |
| R1-02 mis-oriented mesh "watertight" | **Closed** (one gap on multi-part meshes is filed as R1-16) | Blind: true values draft 0.4 m, GM_T 0.533 m. `node $S/badmesh2.mjs` (the app's STL path: `soupFromIndexed` → `prepareMesh`): one side flipped, one triangle flipped, the bottom flipped, every face flipped and 7 of 12 faces flipped all give V 8.0000, draft 0.4000, GM_T 0.5333, BM_T 0.8333, `wpBad` false, misoriented 0 after the repair (4, 3, 4, 0 and 9 before it). Unrepaired, `openEdgeCount` now reports 4, 3 and 4 (`node $S/badmesh.mjs`). App: `box_flipped_side.stl` gives "Face winding: consistent after repair · 2 faces … re-oriented on import", draft 0.4 m, GM_T 0.533 m. M17, N01 and N02 are caught |
| R1-03 cube-settling claim untested | **Closed** | `test/models/expected.json` `cube_corner_s050.sim` (start upright, `expect_up: 'diagonal'`, tol 10⁻³°); baseline 1.13×10⁻⁴° off (`$S/base_fine.txt`). M16 (no start kick) is caught by `validate-node`, 500/501. Blind first: released exactly upright with no kick, the cube is in equilibrium, so the rest test (`ke < 10⁻⁶` after 2 s) should stop it upright, acos(1/√3) = 54.7356° from a diagonal. It does: cube_corner_s050 "sim settles" passes at t = 2.5 s, and "sim: vertical along a body diagonal (° off)" reads 54.735610° against 0 ± 10⁻³° (`$S/mut2/M16/vn-out.txt`). The map claims the cube settling only now |
| R1-04 cube rest attitude in README/GZ panel | **Closed** | `README.md:35` now says the cube comes to rest corner-down and that edge-down is only neutral. `test/e2e-browser.mjs:161-162` is fixed. App, cube upright (`app_probe.mjs cube`): "GZ (fixed trim, this axis) turns positive again at about 45° and vanishes at 90°. The 3D resting attitude can differ: use Settle to find it." |
| R1-05 "started at rest" after the cube moved | **Closed** | `node $S/app_probe.mjs cube`, after Settle: "Settled — this is a stable resting attitude. \| Finished with a static equilibrium solve (B under G to 0 m; it moved the attitude by 4.37e-5°)", with no "nothing to move". `js/app.js:886-889` needs B under G, GM_min > 0 and an end within 0.01° of the start; e2e 2 (barge) still gets the message |
| R1-06 proofs back references, not code | **Closed** (the rewording and the new proofs of the code's own formulas; residual wording in R1-20) | `docs/validation-map.md:7-11` defines the two kinds, and the theorem table has a Kind column that marks Hydrostatics and Stability as "reference". `Mesh.lean` and `MeshBox.lean` transcribe `submerged` and `massProperties` faithfully (see "Proofs against the code"). `lake env lean` on copies of my worktree's files: no errors; `#print axioms` on 17 main theorems gives [propext, Classical.choice, Quot.sound]. M08 (Ixy factor) is now caught by `validate-proofs` (box test) as well as `validate-stability` |
| R1-07 weakest-axis angle 90° off | **Closed** | Blind: the box's long axis at yaw θ. `node $S/app_probe.mjs yaw`: "GM about weakest axis: 0.533 m (axis at 0° / 20° / 45° / 30° / 90° from x)" at yaw 0°, 20°, 45°, 30°, 90°. `js/physics.js:277` is ½·atan2(I_xy, −(I_xx − I_yy)/2). M04 is caught: 492/501 |
| R1-08 untested read-outs; weak oracle | **Closed** | All 15 real round-1 survivors (M03–M07, M12–M14, M16–M18, M20, M22, M26, M27), re-planted by me at their new places, now fail at least one Node check (table below). The yawed 4 × 2 × 2 box (GM_T = GM_L = 1.083 m, GM_min −0.167 m) is in `validate-stability` with GM_min > 0 as the oracle. `validate-core.js:55` and `validate-proofs.mjs:61` use GM_min |
| R1-09 Settle stops while swinging | **Closed** (the behaviour is right; no test can see either half of the fix removed, filed as R1-23) | Blind: sphere rest roll = −atan(0.05/0.3) = −9.4623°. App (`app_probe.mjs sphere`, 51,066 triangles): −9.4622° at ζ 0.25 (5 s wall) and at ζ 0.05 (21 s), "Finished with a static equilibrium solve", no "not at rest" warning. Node copy of the new loop (`node $S/settle2.mjs`): the box released at 20° ends at \|roll\| < 3×10⁻¹⁴° for frame sizes of 12 to 400,000 triangles and ζ 0.25, 0.1, 0.05. The tender box ends at −7.001684° against the wall-sided −7.001683°; the simulation alone stops 2.5×10⁻³° short, and the static solve removes that |
| R1-10 open meshes | **Closed** (the agreed fix; the remaining gap, results past the point where an opening submerges, is R1-15) | `node $S/badmesh2.mjs`: a deckless box with its keel at z = 0, 3, −7 and 100 m, every face flipped in the file: V 8.0000, draft 0.4000, GM_T 0.5333 (the old code had the box at z = 3 sinking). App `box_nodeck.stl`: "Enclosed volume 8 m³", "floats with 40 % of its volume submerged" and "Submerged fraction 40 %", default mass 3200 kg, and the panel says the hydrostatics hold only while every opening stays above the waterline |
| R1-11 fixed-trim GZ unlabelled | **Closed** | The GZ panel says "fixed trim: the body is not allowed to re-trim as it heels" (app probes); the Waves-stage verdict says "… range (GZ at fixed trim)" (`js/seakeeping.js:689`, and the SS-table hint at :880). The optional free trim (`gzAt`) agrees with my own bisection on the trim at every 5° from 0° to 180°, on the scow and on a wedge hull: largest \|GZ − least-energy root\| 1.4×10⁻¹¹ m, one root at every angle, largest \|B·u\| 5.8×10⁻¹¹ m (`node $S/freetrim2.mjs`) |
| R1-12 instability with loll < 5° missed | **Closed** | Blind: wall-sided loll atan√(−2GM/BM), GM = 0.2 + 0.8333 − 1.0353 = −0.00197 m, gives 3.9302°. `app_probe.mjs tender`: verdict "Unstable … turns positive again at about 3.9°"; GZ panel "GM about this axis is negative … turns positive again at about 3.9° and vanishes at 37.1°". Yawed 4 × 2 × 2 box (`app_probe.mjs yaw`): verdict "Unstable"; the roll panel says "GM about the weakest waterplane axis (−0.167 m) is below this axis's GM (1.083 m): choose Weakest"; Weakest says GZ stays negative to 180°. My 2D code (`ref2d.py`, square section, G 0.2 m above the centre) agrees: GZ < 0 at every 5° from 5° to 175° (minimum −0.227 m at 65°). M06 and N13 are caught |
| R1-13 loose sim tolerances | **Closed** | 10⁻³° in `expected.json` for box_list, square_log_45 and cube_corner_s050. Achieved: 2.1×10⁻⁵°, 1.8×10⁻⁵° and 1.13×10⁻⁴°, so the margins are 50×, 55× and 9×. M27 (1 mm lever) is caught by all three, 498/501. Blind first: the rest moves to where GZ = 1 mm, so Δφ ≈ 0.001 m / (dGZ/dφ). For box_list, dGZ/dφ at 5.32° is 0.5465 m/rad (wall-sided), giving 0.105°; for the square log, GM = √2/6 gives 0.243°; for the cube, GM 0.036 m gives about 1.6°. Measured: box_list −5.215096° (0.1049° off), square_log_45 45.246221° (0.246°), cube 1.617° off a diagonal (`$S/mut2/M27/vn-out.txt`), so the margin over the 10⁻³° tolerance is 100× or more |
| R1-14 sphere flagged open | **Closed** | `node $S/openedges3.mjs`: all 12 STEP models at all 3 qualities (36 imports) through `prepareMesh` come out closed and consistently oriented, with no face flipped and no coordinate changed. Both spheres show 2 degenerate pole triangles, left out of the count. The flipped box is still rejected by `meshCheck` (4 misoriented edges). N07 (degenerate triangles counted) is caught |

## Questions re-checked

| Question | Status | Evidence |
| --- | --- | --- |
| Q1 source for the cube's corner-down rest | **Closed** (still no literature read, and the map cites none for it) | I wrote an independent check, `python3 -I $S/ref_cube3d.py`, with no Float Sim code. It takes the exact distribution of n·X for X uniform on the cube (inclusion–exclusion over the 8 corners) and searches 3,759 directions, then refines with Nelder–Mead. The global minimum of z_G − z_B is corner-down at every s.g. tried: 0.234548547 at ½, 0.338726466 at 0.3, 0.370218744 at 0.25, at 10⁻⁵° from a body diagonal. Edge-down gives 0.235702260, 0.341958410, 0.373773448; face-down 0.25, 0.35, 0.375. These equal the defender's numbers to all 9 digits shown |
| Q3 overlapping shells counted twice | **Closed, superseded by R1-19** | The warning and its tests exist (`validate-stability` mesh_check: box + overlapping cube; box + void). But the test samples 8 face centroids, so it misses shells that cross without either one having a sample inside the other. The general "overlapping bodies double-count" hint for multi-solid STEP files is now hidden when no overlap is detected (R1-19) |
| Q4 neutral buoyancy reported as "sinks" | **Closed** | `solveWaterline` sets `neutral` when \|m/ρ − V_total\| ≤ 10⁻⁹·V_total (`js/physics.js:243`); `verdictFor` then says "Neutrally buoyant" (`js/app.js:609-613`). `validate-stability` rest_and_trim checks exact equality (neutral), 1.000001·ρV (sinks) and 0.999999·ρV (floats); M10 (band 10⁻⁶) is caught by `validate-stability` rest_and_trim: "mass 1.000001·ρV: sinks, not neutral" reads `neutral` true where false is expected (`test/validate-stability.js:317`), 500/501. Its 0.999999·ρV twin still passes: at exactly 10⁻⁶ the band edge falls on round-off |

## New findings

### R1-15 Open hulls get GZ curves and a verdict range past the angle where the opening goes under water
- Severity: minor (the model panel says the limit in general terms; the verdict headline does not)
- Kind: code bug
- Claim challenged: `js/app.js:287` says the hydrostatics hold only while every opening stays above the waterline. That note is in the model panel only. The GZ panel (`js/app.js:776-786`), the verdict (`js/physics.js:516-537` via `js/app.js:617`) and the Waves-stage range all use the full 0–180° curve. README:143.
- Evidence: blind: an open-deck 4 × 2 × 1 m box at T 0.4 m, KG 0.5 m ships water over the deck edge at atan(0.6/1) = 30.96°. Past that angle it is no longer a closed displacement body. `node $S/openheel.mjs` compares the closed box with the open one:
  ```
  closed box: GZ max 0.3236 at 38.71°, vanish 90.00°; GZ at 30/35/45/60/80°: 0.2957 0.3191 0.3138 0.2392 0.0858
  open-deck box: GZ max 0.3074 at 32.01°, vanish 81.09°; GZ at 30/35/45/60/80°: 0.2957 0.3025 0.2632 0.1679 0.0091
  ```
  In the app (`app_probe.mjs basic`, `box_nodeck.stl`, 3200 kg, KG 0.5), the verdict reads "Stable … the righting arm peaks at 32° and vanishes at 81.1°; heeled past that, the body capsizes", and the GZ panel reads "Angle of vanishing stability (fixed trim): 81.1°". `wpBad` stays false at every heel. With an end face missing instead, the opening reaches the keel. The box then floats at draft 0.48 m with GM_T 0.457 m (true values 0.4 m and 0.533 m), with only the general open-mesh note (`$S/badmesh2.mjs`).
- Why it matters: open-deck exports are the usual output of hull-design tools. The range of an open boat ends at the downflooding angle (the IS Code's area criteria stop at θ_f, MSC.267(85) A 2.2.1). Here the verdict gives 81° instead of 31°.
- What would resolve it: the import already knows the open edges (`meshCheck`). At each heel angle, and upright, test whether any open edge lies below the waterline. If one does, end the curve there and say "an opening goes under water at X°" in the GZ panel and the verdict. Add the open box to `validate-stability`.

### R1-16 An inside-out part that shares an edge with another part is not turned, and an inside-out hollow part keeps its void as solid
- Severity: minor
- Kind: code bug
- Claim challenged: `js/meshcheck.js:128-131` joins shells across every shared edge. `:134-141` propagates orientation only across edges used by exactly two triangles. `:198` turns a whole shell only when its total volume is negative and it sits at even depth. README:143 says "a shell that is inside out is turned; the model panel says when this happened".
- Evidence: blind: two closed 4 × 2 boxes stacked on the same footprint. The union is 12 m³ when the upper box is 0.5 m tall, and 16 m³ when it is 1 m tall. `node $S/nonmanifold.mjs` runs the app's STL path:
  ```
  stacked 4x2x1 + 4x2x0.5 on top, upper inverted (STL): V 4.000 (true 12) open 0 misor 0 shells 1 flipped 0 inverted 0 overlaps 0 voids 0
  stacked boxes, upper inverted (one STL)           V 0.000 (true 16) … | 6400 kg: sinks
  boxes sharing one edge, second inverted (one STL) V 0.000 (true 16) … | 6400 kg: sinks
  stacked boxes, upper inverted (two STEP solids)   V 16.000 (true 16)
  ```
  The two parts form one shell (they share 4 non-manifold edges) but two orientation components. The shell's total volume is positive or zero, so nothing is turned, and every check is green: watertight, winding consistent, no warning. STEP is right only because `soupFromIndexed` turns each solid before the repair. A second case, `node $S/shells.mjs`: a hollow box (void 1.5 m³) turned inside out as a whole, in one STL with a second body, gives V 109.5 instead of 106.5. The model panel says "1 shell overlaps another shell: … counted twice". The outer shell is turned, but its inner shell, now outward, is left as it is. On its own, `repairMesh` gets the lone inverted hollow box wrong too (9.5 instead of 6.5); the app gets it right only because the STL whole-file flip runs first. No test calls `repairMesh` on such a case.
- Why it matters: an inverted part in a multi-body export is the case the repair exists for. The first case gives a wrong volume, wrong draft or "sinks" with every check green. The second gives a wrong volume with a misleading message.
- What would resolve it: decide inversion per orientation component that is closed on its own, not per edge-connected shell. When a shell is turned, turn the shells nested directly inside it as well, so the depth parity is kept. Add tests: stacked boxes with one part inverted, and an inverted hollow body next to a second body, run through `repairMesh` without the whole-file flip.

### R1-17 For waterplanes with equal principal moments, the verdict's range is taken about a heel direction picked by round-off
- Severity: minor (it borders on major for the app's own Settle demo)
- Kind: code bug (a limit of the agreed approach)
- Claim challenged: `js/app.js:693` requests the GZ about `H.axisMinDeg` and `H.axisMinDeg + 180`, and `:723-728` takes the worse of the two. README:33 says "The range words come from the GZ curve about that axis, in both heel directions".
- Evidence: blind: the corner-down cube's waterplane is a regular hexagon, so I_xx = I_yy and I_xy = 0. Every horizontal axis is then a weakest axis, and `axisMinDeg` = ½·atan2(≈0, ≈0) is set by round-off. The large-angle GZ still depends on direction, with 3-fold symmetry. `node $S/azimuth.mjs`, heel azimuth in the cube's frame:
  ```
  azimuth 0°: vanish 50.77° maxDeg 26.86°   7.5°: 48.29°   15°: 45.00° maxDeg 27.13°   22.5°: 40.73° maxDeg 14.06°
  azimuth 30°: vanish 35.26° maxDeg 11.83° max 0.0033 m   (repeats every 60°)
  ```
  In the app, after Settle on the cube demo (`app_probe.mjs cube`), the axis came out at 7.8° from x, the body's yaw, which is 0° in the cube's frame. The verdict read "Stable … peaks at 26.9° and vanishes at 50.8°". Heeled about an axis 30° round from that, the cube peaks at 11.8° and is gone at 35.3°. By the verdict's own 25° rule, that direction would be "Stable (small range)". A square barge shows a small spread (77.1–78.6°).
- Why it matters: the resting cube is the app's own Settle demo, and its verdict overstates the worst range by 15°. Square and polygonal floats behave the same way.
- What would resolve it: compute the range about several azimuths (every 15° over 0–180°, both directions; the worker already runs three curves) and report the worst one. At least do this when the principal moments are within a few per cent of each other. Add the corner-down cube to `validate-stability`.

### R1-18 The verdict and the GZ panel disagree on a self-righting sphere and on neutral bodies, and a 92.5° range is called small
- Severity: minor
- Kind: code bug (wording)
- Claim challenged: `js/physics.js:530`: "self-righting" only when `range.vanish === null`, with no tolerance at 180°. `:531-535`: "the range is small" whenever the peak comes before 25°. `js/app.js:780`: "Max GZ … at …" is printed even when no GZ is positive.
- Evidence:
  - (a) blind: a sphere of radius 1 m with G 0.3 m below its centre has GZ = 0.3 sin φ > 0 on (0°, 180°), so it is self-righting. `node $S/selfright.mjs` gives vanish null in the + direction. In the − direction faceting gives 179.997° (coarse mesh), 179.9991° (normal) and 179.99994° (fine). The verdict then reads "Stable: … the righting arm peaks at 90° and vanishes at 180°; heeled past that, the body capsizes." In the app (`app_probe.mjs selfright`), that verdict sits above a GZ panel that says "Angle of vanishing stability (fixed trim): > 180° (self-righting)". The only test of the self-righting branch passes a made-up `{ vanish: null }` (`test/validate-stability.js:223`), never a real body. An exactly symmetric 64-gon log does get "self-righting".
  - (b) `node $S/smallrange.mjs`: a raft 4 × 4 × 0.5 m (T 0.2 m, KG 0.2 m) peaks at 1.02 m at 20.1° and vanishes at 92.5°. Its verdict is "Stable (small range) … the range is small … gone at 92.5°". The 4 × 2 × 1 m box, with a 90° range, is plain "Stable".
  - (c) The yawed 4 × 2 × 2 m box heeled about Weakest has GZ negative everywhere, yet the panel shows "Max GZ 0 m at 180° → peak righting moment 0 N·m" (`app_probe.mjs yaw`).
  - (d) The verdict treats \|GM\| ≤ 10⁻⁹·size as zero (`js/physics.js:521-528`); `gzSummary` tests `GM < 0` with no band (`:396`). On the exactly neutral edge-down cube (GM_L = √2/6 − √2/6), `node $S/neutral.mjs` gives GM_min = +2.8×10⁻¹⁷ at yaw 0° and 33°, and −1.7×10⁻¹⁶ at yaw 10°. The verdict says "Neutral" each time. About Weakest, the GZ panel says "stable, vanishes at 90°" at 0° and 33°, and "GM about this axis is negative: this attitude is unstable … turns positive again at about 35.3°" at 10°.
- Why it matters: buoys are often designed to be self-righting, and for them the headline contradicts the panel under it. A raft with a large range is labelled "small range".
- What would resolve it: treat a vanishing angle within a small tolerance of 180° as "stays positive to 180°". Word the 25° rule as "the righting arm peaks early (at X°; the IMO code asks for 25° or more)", apart from the range. Omit "Max GZ" when no GZ is positive. Use the verdict's round-off band in `gzSummary` too. Test the self-righting wording on the STEP sphere.

### R1-19 The overlap test misses shells that cross, and the general double-counting hint for multi-body files is gone
- Severity: minor
- Kind: code bug / documentation
- Claim challenged: `js/meshcheck.js:174-195` tests 8 face centroids of each shell against every other closed shell. `js/app.js:290` now shows the old multi-body hint, without its "Overlapping bodies double-count volume", only when no overlap is found. README:143 says "It also reports … overlapping shells". The ledger's Q3 answer says "A positive shell inside or cutting another is reported as an overlap".
- Evidence: blind: two 4 × 1 × 1 m boxes crossing at right angles have a 7 m³ union and an 8 m³ sum. `node $S/shells.mjs`:
  ```
  cross: two 4x1x1 boxes crossing (STL, one part)         V 8.0000 … overlaps 0
  cross: same, two STEP solids                            V 8.0000 … overlaps 0
  box 2x2x1 + cube poking out at a corner (overlap 0.125) V 5.0000 … overlaps 0
  ```
  Every face centroid of each box lies outside the other box. For the STEP pair the panel says only "Multiple bodies are treated as one rigid object." A cube overlapping one end of a box is detected (overlaps 2), as the test case does.
- Why it matters: a keel, a crossing beam or a deckhouse modelled as separate solids is common. Such a user now gets no hint, where before the STEP hint warned of double counting.
- What would resolve it: keep the general hint whenever there are several shells and the test finds no overlap. Better, test each shell's edges against the other shells' triangles instead of a few centroids. Add the crossing boxes to the tests.

### R1-20 The proofs' stated remaining assumption is wider than what is true, and some coverage is overstated
- Severity: minor
- Kind: documentation
- Claim challenged: `docs/validation-map.md:8` ("transcribed by hand) and proved correct"); `:86` (the divergence-theorem bullet); `:22` ("the directed-edge balance `meshCheck` tests implies the closedness the volume theorems assume"); `proofs/Proofs/Mesh.lean:26-28`.
- Evidence:
  1. "A closed, consistently oriented triangulated surface bounds a solid whose volume is (1/6)·Σ det" is not true as stated. Σ det/6 is the integral of the winding number, which is the volume only for an embedded (not self-intersecting), outward-oriented surface. Two overlapping closed shells are balanced and give V₁ + V₂: the crossing boxes in R1-19 give 8 m³ for a 7 m³ solid. An inward-oriented closed surface is balanced too and gives −V.
  2. The bullet says `Tetra.volume_tetra` proves "it", meaning the volume and first moments, for one tetrahedron. `Tetra.lean` proves only the volume |det|/6. The first-moment formula det·(p + a + b + c)/24 is not proved, even for one tetrahedron. Neither is the second-moment formula behind `massProperties`' inertia (`Cov`, det/120·(…)), and the second moments are missing from the list of things taken as given.
  3. `Balanced` (`Mesh.lean:87-89`) counts directed edges between exactly equal points. `meshCheck` counts them between welded vertex ids: `Math.round(x/tol)` with tol 10⁻⁷ of the size (`js/meshcheck.js:17`, `js/loader.js:41`), leaving out triangles that weld to degenerate. A mesh that passes `meshCheck` is balanced on the welded ids, not exactly, so `closed_of_balanced` does not apply to it as it stands. The volume error is of the order of tol × area, which is negligible, but the map says the test "implies" the assumption.
  4. "Proved correct": the Mesh theorems prove reference-point independence, closure after clipping, that the lid adds nothing and fan-point independence. That the sums are a volume and its moments rests on item 1.
- Why it matters: the map is the project's statement of evidence. The rest of the rewording is accurate (see "Proofs against the code").
- What would resolve it: state the assumption as "for a closed, embedded, outward-oriented surface, Σ det/6 and the moment sums are the enclosed volume and its first and second moments". Say that Tetra covers the volume of one tetrahedron. Say that `meshCheck` tests the balance after welding to 10⁻⁷ of the size, while the theorem assumes exact coincidence. Replace "proved correct" with what is proved.

### R1-21 Welding rounds to a grid, so near-identical vertices can be split
- Severity: minor (unlikely with exporters that write shared vertices bit-identically)
- Kind: code bug
- Claim challenged: `js/meshcheck.js:1-22` says the weld joins "vertices that lie within `tol`".
- Evidence: the key is `Math.round(x/tol)` for each coordinate. Two copies of a vertex 10⁻¹³ m apart that straddle a cell boundary get different ids, while points up to √3·tol apart can merge. `node $S/weld.mjs` puts a closed box's end face on `prepareMesh`'s own grid boundary, with the copies of its end vertices 2×10⁻¹³ m apart:
  ```
  meshCheck open 24 misoriented 0; prepareMesh report open 24, shells 6, closedShells 0
  ```
  The split into 6 shells also stops orientation propagation between the faces, so a flipped face there would not be repaired. The volume is right to 5×10⁻⁸.
- Why it matters: false "not closed" warnings, the class of R1-14, and a disabled repair, for files whose shared vertices are not bit-identical.
- What would resolve it: weld by distance (hash to the cell and compare with the 26 neighbouring cells), or use two staggered grids.

### R1-22 The import's nesting test runs on the page's main thread and grows with shells × triangles
- Severity: minor
- Kind: code bug (responsiveness)
- Claim challenged: `js/meshcheck.js:182-196` runs on every import through `prepareMesh`, called from `setModel` (`js/app.js:213`) on the main thread.
- Evidence: `node $S/shellcost.mjs` (closed UV spheres, on a machine also running five test suites):
  ```
  16 shells × 3968 triangles = 63488 triangles: repairMesh 835 ms
  64 shells × 3968 triangles = 253952 triangles: repairMesh 12154 ms
  ```
  The cost is shells × 8 samples × triangles, capped at 64 shells. An assembly of 50 parts and 500k triangles would freeze the page for tens of seconds under "Building the model".
- Why it matters: the project's rule for long computations is that a worker and a progress bar keep the page responsive. This one blocks the page, with no progress, on every import of a multi-part file.
- What would resolve it: run the import repair in a worker, as the GZ curves now are; check bounding boxes before the winding numbers.

### R1-23 No test can tell whether Settle ends with its static equilibrium solve: N21 survives every suite, e2e included
- Severity: minor
- Kind: validation gap
- Claim challenged: the R1-09 fix ends Settle with `restAttitude` and keeps its attitude when it converges within 1°
  (`js/app.js:953-965`). `docs/validation-map.md:26` cites "Settle in the app on the cube (`e2e-browser` 5)" as evidence.
  The e2e checks on Settle are `test/e2e-browser.mjs:157` (box list, titled "to 1e-4°", tolerance 2×10⁻⁴°), `:180` (cube
  within 10⁻³° of a body diagonal) and `:182` (`si.includes('static equilibrium solve')`).
- Evidence: mutant N21 (`js/app.js:959`, `const useFin = false;`) never uses the solve. `validate-node` and
  `validate-proofs` do not load `js/app.js`. The e2e UI part gives 131/131 "ALL PASSED" on N21, the same as the fixed
  code (`$S/e2e_N21.txt`, `$S/e2e_base.txt`). Each of the three Settle checks passes under N21:
  1. `setEuler` rounds each angle to 4 decimals (`js/app.js:324`). The solved box list (−5.319994°) and the
     simulation's own stop (−5.319960°, `node $S/settle3.mjs`) both become −5.32°, so `:157` cannot see the solve. A
     2×10⁻⁴° tolerance on a read-out rounded to 10⁻⁴° can only catch errors above about 1.5×10⁻⁴°.
  2. Without the solve, the cube stops 8.97×10⁻⁵° off a diagonal (e2e on N21; 4.37×10⁻⁵° in `settle3.mjs` before
     rounding), against 1.03×10⁻⁵° on the fixed code and a 10⁻³° tolerance.
  3. `:182` needs only the substring "static equilibrium solve". The fallback message, "The static equilibrium solve did
     not converge near the simulated attitude, so the simulated attitude is kept.", contains it too. Under N21 the panel
     shows that message, and the check passes:
     ```
     fixed: PASS  …and does not claim it started at rest  — Settled — this is a stable resting attitude. | Finished with a static equilibrium solve (B under G to 0 m; it moved the attitude by 4.37e-5°).
     N21:   PASS  …and does not claim it started at rest  — Settled — this is a stable resting attitude. | The static equilibrium solve did not converge near the simulated attitude, so the simulated attitude is kept.
     ```
  The other half of the R1-09 fix is masked the same way. Mutant N22 (`js/app.js:917`, the old speed-only rest test
  `ke < 2e-4`) stops the cube earlier, and the solve then moves it by 0.007° instead of 4.37×10⁻⁵° and lands it
  1.03×10⁻⁵° off the diagonal, as on the fixed code. N22 also gives 131/131, exit 0 (`$S/e2e_N22_2.txt`). While the
  solve converges, N22 is close to equivalent: its slack only shows in the "moved the attitude by" figure, which no
  check reads. N21 is the real gap: with it, the only Settle results are the simulation's own.
- Why it matters: the solve is what makes Settle exact on large meshes and slow swings. On the tender box the
  simulation alone stops 2.5×10⁻³° short (`$S/settle2.mjs`, R1-09 above), and under the old rest test it stopped 0.04–0.25°
  off (round 1). If the solve were removed, or stopped converging after a later change, the user would see the
  "did not converge" note, but no test would fail.
- What would resolve it: make `:182` look for "Finished with a static equilibrium solve". Add an e2e Settle case where
  the simulation alone stops measurably off: the tender box (2.5×10⁻³°), or a large mesh with low damping. Compare its
  attitude, or the B–G offset in the stats table, at a tolerance the 4-decimal read-out can resolve. Make `:157`'s title
  match its tolerance.

### R1-24 `validate-node.mjs` can lose the end of its output, summary included, when its stdout is a pipe
- Severity: minor
- Kind: code bug (test harness)
- Claim challenged: `test/validate-node.mjs:22-23` prints the summary and calls `process.exit()` at once.
  `test/validate-core.js:138-141` first computes the stability, wave, drop, small-body and reference-csys cases, then
  prints all 30 of them in one burst: 43 KB of the 55 KB output, from `gz_summary` (byte 12,296) to the end.
- Evidence: my first runner started each mutant with `spawn` and read stdout through the default pipe. Linux gives the
  child a socket there (`fstatSync(1).isSocket()` is true). Under a load of 25–31 on 16 cores, M15, M16, M18 and M20
  ended with exit code 1, no signal, no stack trace and no summary line. Their output stopped after 31,199–47,822
  bytes, in the middle of the wave cases. The same M16 written to a file runs all 44 cases, 55,126 bytes, "500/501
  checks passed". `node --trace-exit` shows the exit is the normal one, at `validate-node.mjs:23:9`
  (`$S/m16-direct.txt`). A minimal reproducer with no Float Sim code (`$S/trunc/parent.mjs`, `child.mjs`): the child
  prints 1,000 lines of about 100 bytes, then calls `process.exit(1)`, and the parent reads at once. Only 35,640 bytes
  arrive, and the summary is lost; with 300 lines everything arrives. Node's documentation of `process.exit()` warns
  that it does not wait for pending writes to `process.stdout`, and it recommends setting `process.exitCode` instead.
- Why it matters: the exit code stays right, so pass or fail is unaffected. A log read through a pipe can still lack
  the summary and the failing lines of the cases printed last (CI runners, agent tools, scripts that spawn the suite).
  It cost this review four false "CRASH" results.
- What would resolve it: set `process.exitCode` and return, instead of calling `process.exit()`. The same pattern is in
  `test/validate-proofs.mjs:145`, `test/validate-bem.mjs:292`, `test/validate-capytaine.mjs:135` and
  `test/e2e-browser.mjs:529`; those print as they go, so less is at stake there.

### R1-25 No test pins the verdict's "self-righting" boundary: N18 survives every Node suite
- Severity: minor
- Kind: validation gap
- Claim challenged: the R1-01 fix says "self-righting" only when GZ stays positive to 180° (`js/physics.js:530`,
  `range.vanish === null`). The verdict tests use the box, which vanishes at 90° (`test/validate-stability.js:207-208`),
  the catamaran at 18.2° (`:218`) and a made-up range `{ vanish: null }` (`:223`).
- Evidence: mutant N18 (`js/physics.js:530`: `range.vanish === null || range.vanish > 170`) gives 501/501 and 20/20.
  No verdict test has a vanishing angle between 90° and 180°. `node $S/n18check.mjs` runs the verdict for GM 0.05 m,
  a peak at 80.54° and vanishing at 170.54°. Those are the values of a real body: a sphere of radius 1 m with G 0.3 m
  below and 0.05 m off its centre vanishes at 180° − atan(0.05/0.3) = 170.54° ("Checked and found sound").
  ```
  fixed vanish 170.54°: Stable: … the righting arm peaks at 80.5° and vanishes at 170.5°; heeled past that, the body capsizes.
  N18   vanish 170.54°: Stable and self-righting: … the righting arm about the weakest axis (fixed trim) stays positive all the way to 180°.
  ```
- Why it matters: "self-righting" is the claim a buoy or rescue-craft designer relies on. R1-18 asks for a small
  tolerance at 180°, because faceting moves the vanishing point of a truly self-righting sphere to 179.997–179.99994°.
  Made too wide, that tolerance would call a body that capsizes at 171° self-righting, and no test would fail.
- What would resolve it: test the verdict on real bodies on both sides of the boundary. The off-centre sphere
  (170.54°) must not be called self-righting. The STEP sphere with G 0.3 m below its centre (179.99994° at fine) must
  be, once R1-18's tolerance is in.

## Proofs against the code

I re-checked each file from my worktree's copy. I concatenated `Mesh.lean` and `MeshBox.lean` into a scratch file and
added `#print axioms` lines (`$S/lean/MeshAll.lean`; 14 s on an idle machine, 77 s when regenerated under load), and did
the same for `Tetra.lean` (`$S/lean/TetraAll.lean`); the outputs are in `$S/lean/*.out`.
I ran `cd /home/duff/float-sim/proofs && ~/.elan/bin/lake env lean <file>`. There are no errors and no `sorry`. For
`closed_of_balanced`, `vol_apex_indep`, `mom_apex_indep`, `massProperties_{volume,centroid,inertia}_indep`,
`clip_closed`, `lid_vol_zero`, `lid_mom_zero`, `submerged_vol`, `submerged_mom`, `green_indep`, `box_submerged`,
`box_wp`, `box_vol`, `clipPoly_all_wet` and `Tetra.volume_tetra`, the axioms are only [propext, Classical.choice,
Quot.sound].

**Mesh.lean against `submerged` (js/physics.js:164-234) and `massProperties` (:114-145).** I compared the
transcription term by term. It matches:
- `det3` is the code's determinant, written in the same order.
- `wet u := u.z < 0` is the code's `inside[k] = z < 0`. A vertex exactly on the plane is dry in both.
- `cut u v` is `t = za/(za − zb)` with x and y interpolated and z set to 0. When one end is on the plane, both give
  that end point (t = 1 or 0).
- `segPts`/`clipPoly` is the code's loop: push the wet corner, then the crossing if `inside[a] !== inside[b]`.
  `clipPoly_all_wet` shows that the `nIn === 3` shortcut equals the general path. For `nIn === 0` the Lean result is
  `[]`, which is the code's `continue`.
- `fan` is `for (k = 1; k + 1 < n; k++)`, with the apex at (0, 0, 0) relative to the plane. That is the code's
  (0, 0, zw); the x and y stay absolute in both.
- The code's `hasEn && hasEx` is Lean's `wpSeg` pattern `[e], [x]`. A triangle has 0 or 2 crossings, one entry and one
  exit, so the two agree in all 8 wet/dry patterns (`wpSeg_eq`).
- The six `green` terms are the code's `A`, `Ax`, `Ay`, `Iyy`, `Ixx` and `Ixy` sums, including Ixy's
  x₀y₁ + 2x₀y₀ + 2x₁y₁ + x₁y₀, taken entry → exit.
- `codeV`, `codeC1`, `codeC2` and `codeCovG` are `massProperties`' relative coordinates, `det/6`, `det·s/24`,
  `det/120·(…)`, `c/V + p` and `C − V·cen·cenᵀ`.
- `MeshBox` then runs the same definitions on a 12-triangle box and divides as the code does (`V /= 6`,
  `m/(24V)`, `A /= 2`, `Ax/(6A)`, `Ixx/12 − A·cy²`).

What the theorems do not cover:
- Exact arithmetic. The code is floating point, and the two triangles on an edge compute `cut(u, v)` and `cut(v, u)`,
  which agree only in real arithmetic (`cut_symm`). Disclosed.
- `Balanced` assumes exactly equal points. The code tests the balance after welding to a 10⁻⁷ grid, with
  welded-degenerate triangles left out (R1-20 item 3, R1-21). A triangle with two exactly equal corners is
  self-balanced and has det = 0, so leaving those out is consistent with the theorem. A sliver within tol is not.
- `MeshBox` needs z_b < 0 < z_t strictly, and only the general `Mesh` theorems cover a vertex on the plane. No test
  puts a vertex exactly on the waterline: M01 (`z <= 0`) survives every suite, as in round 1. Both conventions give
  the same wet volume, but the waterplane at a horizontal face lying exactly in the plane differs: it is the face's
  area with `z < 0` and 0 with `z <= 0`.
- The step from the sums to volumes and moments. The bullet in the map is too broad (R1-20 items 1 and 2).
- The parallel-axis shift of the waterplane moments, BM = I/V, GM = KB + BM − KG and GM_min from the principal
  moments are not in Lean. They are textbook, and the tests check them against closed forms on yawed and off-centre
  boxes.

**MeshBox.lean.** `box_submerged` proves exactly what the code returns for the box at any size, position and draft.
`validate-proofs` runs the JavaScript on the same 12 triangles, in the same order, for 2,000 random cases, with a
largest error of 7×10⁻¹² of the size of the sums. The docstring's "the box the tests use (test/models/box_4x2x1.step)"
is the same geometry, not the same triangulation: the STEP file is meshed by OpenCascade.

**Tetra.lean.** `volume_tetra` proves that the Lebesgue measure of the open tetrahedron is |det|/6, with the
determinant written as the code writes it. It is sound and self-contained (Tonelli for the unit simplex, then
`addHaar_image_linearMap`). It covers the volume only (R1-20 item 2).

**Rewording in docs/validation-map.md.** It is accurate on the points I agreed in round 1:
- There are two kinds of "Proven", and a Kind column.
- Hydrostatics and Stability are marked "reference".
- The new rows name what is proved: reference-point independence, closure of the clipped surface plus a lid,
  that the lid adds nothing, fan-point independence, and the box.
- It lists as not proved the tetrahedralisation of a general solid and the triangle integrals behind the Green
  terms.

Three statements are wider than the proofs (R1-20): the divergence-theorem assumption (it needs an embedded,
outward-oriented surface, and the moment formulas are not proved for even one tetrahedron), "meshCheck … implies the
closedness", and "proved correct".

## Mutation testing (re-planted on the fixed code)

List `$S/mutations2.mjs`, 52 entries: the 28 round-1 mutations at their new places (M01–M28), two variants (M06b,
M07b) and 22 new ones on the code the fixes added (N01–N22). Each mutant is applied once (the runner refuses a `find`
string that occurs more than once). It runs in its own copy (`$S/mut2/<id>/`: `js`, `test`, `proofs/expected.json`;
`vendor` linked), driver `$S/mutate2.mjs`. "Node" means `node test/validate-node.mjs fine` (501 checks) and
`node test/validate-proofs.mjs` (20), run on all 50 mutants outside `js/app.js`, eight at a time. No Node suite loads
`js/app.js`. After the restore I re-ran all 50 from scratch (`$S/mut2-log.txt`, `$S/mut2-results.json`, and
`vn-out.txt`/`vp-out.txt` in each copy). For M01–M14 the fresh results equal the log lines recovered from before the
interruption (`$S/mut2-log-before-power-cut.txt`). "e2e" means `E2E_SKIP_VALIDATE=1 node test/e2e-browser.mjs` (131
checks), run against a server started from a full mutated copy (`$S/e2e/<id>/`, made by `$S/mke2e.sh`). I ran it on the
two `js/app.js` mutants (N21, N22), on M01 and M23 (two of the three Node survivors outside `js/app.js`) and on M16
(round 1 expected e2e section 5 to catch it). I did not run it on N18, the third Node survivor: e2e's only check of the
verdict's range is the box at 90° (`test/e2e-browser.mjs:109`), so it cannot reach a vanishing angle above 170°.

The "CRASH" results for M15–M18 before the interruption were not crashes of the mutants. The runner read each child's
output through a pipe, and `validate-node.mjs`'s `process.exit()` dropped the part not yet read (R1-24). The same thing
happened again on my first re-run, to M15, M16, M18 and M20: exit code 1 (the normal code when a check fails), no
signal, output cut in the middle of the wave cases. The same M16 written to a file runs to the end, 500/501. The
runner now gives each child a file for its output, and all 50 runs end with a summary line. Two e2e runs (N22 and M01,
in parallel while eight Node mutants ran, load 48) timed out at `test/e2e-browser.mjs:290`. That is the 80-frequency
panel-method RAO solve, with a 120 s limit, and both copies had already passed every Settle and hydrostatics check. I
re-ran them one at a time at a lower load; the table gives those runs (`$S/e2e_<id>_2.txt`).

| Mutation (file:line, change) | Caught by | Survived? |
| --- | --- | --- |
| M01 physics.js:174, a vertex on the waterline counts as wet (`z < 0` → `z <= 0`) | none: Node 501/501, proofs 20/20; e2e 131/131 (`$S/e2e_M01_2.txt`) | survived (near-equivalent: it differs only for a vertex exactly on the plane, which no test has; see "Proofs against the code") |
| M02 physics.js:269, BM_L uses I_xx | Node 489/501: BM_L and GM_L of box_fresh, box_salt, hcyl_log, v_prism and box_moved; box pitch GZ; ρgV·GM_L·sin 1°; refcsys_yup GM_L. Proofs 17/20 (GM_L of the boxes, BM_L of the V-prism) | caught |
| M03 physics.js:280, GM_min uses I_max | Node 485/501: stability_readouts, the yawed boxes' GM about the weakest axis (3.033 m for 0.533 m) and gmAbout(weakest axis) = GM_min | caught |
| M04 physics.js:277, weakest-axis angle sign (I_xy → −I_xy) | Node 492/501: weakest axis at yaw 30°, 90°, −45° and 135° (−30° for 30°, …); "box at yaw 0°, 20°, 45°: the same verdict" | caught |
| M05 physics.js:521, verdict "Unstable" only for GM < −0.1 m | Node 498/501: stability_verdict "GM −0.1 m: Unstable" and the tender box (GM_T −0.002 m) give "warn" for "bad"; the verdict's loll angle 3.9° | caught |
| M06 physics.js:396, gzSummary unstable only for GM < −5 mm | Node 497/501: gz_summary tender box unstable flag, loll 3.930° against [2D] and the wall-sided formula; the verdict's loll angle | caught |
| M06b physics.js:396, the fallback without GM tests curve[2] | Node 500/501: gz_summary "sampled curve, negative at 5°: unstable, loll interpolated at 7.5°" | caught |
| M07 physics.js:398, crossing interpolation uses b.gz | Node 499/501: gz_summary sampled curve, vanishing angle 7.5° for 12.5°, and its loll | caught |
| M07b physics.js:408, regula falsi keeps the wrong end | Node 499/501: gz_summary angle of vanishing stability against [2D] (catamaran, tender box) | caught |
| M08 physics.js:214, I_xy Green term, factor 2 dropped on x₀y₀ | Node 488/501: yawed-box weakest axis (26.99° for 30°) and GM_min, wave_rao_limits symmetry zeros, refcsys_pipeline. Proofs 19/20 (2,000 random boxes) | caught |
| M09 physics.js:293, TPC halved | Node 498/501: immersion kg/cm of box_fresh, box_salt and the stability_readouts box (40 for 80) | caught |
| M10 physics.js:243, neutral band 10⁻⁹ → 10⁻⁶ of the volume | Node 500/501: rest_and_trim "mass 1.000001·ρV: sinks, not neutral" (neutral true) | caught |
| M11 physics.js:250, waterline volume tolerance 10⁻¹⁰ → 10⁻⁴ | Node 479/501: v_prism V, draft, A_wp, KB, BM, GM (3–9×10⁻⁵ relative); GZ curves against [2D] (box, catamaran, tender box, V-section); free trim (scow); the cube's global minimum at s.g. 0.3 and 0.25. Proofs 19/20 (v_prism GM_T, 8.9×10⁻⁵) | caught |
| M12 physics.js:340, GZ sign flipped for heel axes with a y component | Node 498/501: gz_summary box pitch GZ at 5° and 10° (−0.2655 m for +0.2655 m); the same verdict at three yaws | caught |
| M13 physics.js:268, BM_T about G's axis (I_xx + A·c_y²) | Node 500/501: stability_readouts, box with G 0.3 m off the centreline, BM_T about the waterplane centroid 1.058 m for 0.833 m | caught |
| M14 physics.js:223, waterplane centroid doubled (6A → 3A) | Node 499/501: the same box, waterplane centroid y −0.6 m for −0.3 m and BM_T 0.158 m for 0.833 m. Proofs 19/20 (random boxes) | caught |
| M15 physics.js:154, parallel-axis term sign | Node 500/501: refcsys_inertia "parallel axis agrees with the geometry integral about the corner" (1800 for 0) | caught |
| M16 sim.js:15, zero start kick | Node 500/501: cube_corner_s050 stays upright, 54.735610° off a diagonal (limit 10⁻³°); e2e 128/131: "cube leaves the unstable upright attitude" (roll 0°, pitch 0°) and the two checks after it (`$S/e2e_M16_2.txt`) | caught |
| M17 meshcheck.js:65, only edges used once count as open | Node 500/501: mesh_check "closed box plus a reversed copy of one triangle: 3 edges used 3 times count as open" (0 for 3) | caught |
| M18 loader.js:23, inverted parts never flipped on import | Node 500/501: mesh_check "import: an inverted closed box 5 m above the origin gets volume +8 m³" (−8) | caught |
| M19 physics.js:212, I_yy cross term doubled | Node 460/501: BM_L and GM_L of every box and cube case, and more. Proofs 11/20 | caught |
| M20 physics.js:284, freeboard from z_min | Node 500/501: stability_readouts "box: freeboard = depth − draft = 0.6 m" (1.0) | caught |
| M21 physics.js:338, heeled waterline for 1.001 × displacement | Node 475/501: box_fresh GZ at 5°–20° (0.12 %); GZ curves against [2D] (box, catamaran, …) | caught |
| M22 physics.js:291, righting moment per degree of roll uses GM_L | Node 500/501: stability_readouts "righting moment per degree of roll = ρgV·GM_T·sin 1°" (1661 N·m for 292) | caught |
| M23 sim.js:44, pitch torque × 1.02 (the equilibrium is unchanged) | none: Node 501/501, proofs 20/20; e2e 131/131 (`$S/e2e_M23_2.txt`) | survived (near-equivalent for every static result; it changes only the pitch dynamics, as in round 1) |
| M24 sim.js:40, simulation buoyancy lever +2 mm in y | Node 498/501: box_list −5.110137° (0.21° off), square_log_45 45.499°, cube 3.45° off a diagonal | caught |
| M25 physics.js:133, massProperties centroid 1 % off | Node 495/501: refcsys_yup centroid height 0.39596 m for 0.4; refcsys_inertia I about the corner (486.2 for 492); refcsys_rao phase. Proofs 19/20 (reference-point independence on 6 STEP models) | caught |
| M26 physics.js:438, the max-GZ search skips the first sample | Node 500/501: gz_summary "sampled curve: max GZ at the first angle (5°, 0.1 m)" | caught |
| M27 sim.js:40, simulation buoyancy lever +1 mm in y | Node 498/501: box_list −5.215096° (0.105° off), square_log_45 45.246221°, cube 1.617° off a diagonal (limit 10⁻³°) | caught |
| M28 physics.js:278, GM_T + 0.5 mm | Node 481/501: GM_T of all 12 hydrostatic cases (0.09–2.2 %), and more. Proofs 12/20 | caught |
| N01 meshcheck.js:66, meshCheck never reports misoriented edges | Node 500/501: mesh_check "one side face flipped: 4 edges wound the same way on both sides" (0 for 4) | caught |
| N02 meshcheck.js:150, orientation propagation rule reversed | Node 479/501: mesh_check, every flipped-face case (14 edges wrong after the repair, draft 1.0 m for 0.4 m, …) | caught |
| N03 meshcheck.js:156, propagation keeps the minority winding | Node 498/501: mesh_check box + overlapping cube (no overlap reported), box with an inward-wound inner shell (void lost, volume 8.25 for 7.75 m³). On single shells the whole-shell inversion step undoes it, so only the nested cases see it | caught |
| N04 meshcheck.js:198, every negative shell turned (voids become solids) | Node 499/501: mesh_check box with an inward-wound inner shell, 1 void expected, volume 8.25 for 7.75 m³ | caught |
| N05 meshcheck.js:194, overlap test: partly-inside shells not reported | Node 500/501: mesh_check "box + a cube that overlaps it: 2 shells, an overlap reported" | caught |
| N06 meshcheck.js:191, winding-number threshold 0.5 → 1.5 (nothing is inside) | Node 498/501: mesh_check overlap and void cases | caught |
| N07 meshcheck.js:59, degenerate triangles not skipped in the edge count | Node 498/501: mesh_check box plus a degenerate triangle (1 open for 0); sphere_r1.step and kramer_sphere.step (2 for 0) | caught |
| N08 meshcheck.js:182, nesting never checked | Node 498/501: mesh_check overlap and void cases | caught |
| N09 physics.js:122, massProperties default reference 1 m lower | Node 498/501: mesh_check, the open-deck box's "enclosed volume 8 m³ (origin-independent)" reads 5.333 m³ with the keel at z = 0, 3 and −7 m | caught |
| N10 physics.js:144, massProperties leaves the reference point out of the centroid's z | Node 497/501: refcsys_yup centroid height −0.4 for 0.4 m; refcsys_inertia I_xz, I_yz sign; refcsys_rao phase. Proofs 19/20 (reference-point independence) | caught |
| N11 physics.js:296, `wpBad` never set | Node 500/501: mesh_check "unrepaired flipped side: the waterplane fault is flagged (negative BM)" | caught |
| N12 physics.js:446, golden-section search finds the minimum | Node 493/501: gz_summary max GZ and its angle against [2D] (box: 40° for 38.71°; catamaran, tender box, V-section) | caught |
| N13 physics.js:417, near-start sign test reversed (loll below 5° not found) | Node 498/501: gz_summary tender box loll (null for 3.930°) against [2D] and the wall-sided formula; the verdict's loll angle | caught |
| N14 physics.js:340, free trim: trimming-moment arm along the wrong axis | Node 495/501: rest_and_trim box free-trim GZ = fixed-trim GZ (0.323 m apart), "box: free trim stays 0" (1.571 rad), the scow cases | caught |
| N15 physics.js:343, free-trim tolerance 10⁻¹¹ → 10⁻⁴ of the size | Node 499/501: rest_and_trim "scow: free trim leaves no trimming moment" (4.2×10⁻⁴ m); scow 40° free-trim GZ 0.2994 m at −7.27° | caught |
| N16 physics.js:490, restAttitude Newton step sign | Node 498/501: rest_and_trim "rest attitude (Newton on B under G): converged" false; list −5.020° for −5.320° | caught |
| N17 physics.js:531, verdict small-range threshold 25° → 9° | Node 499/501: stability_verdict catamaran (peak at 9.3°) "ok, not good" and the IMO 25° citation | caught |
| N18 physics.js:530, verdict: a vanishing angle above 170° counts as self-righting | none: Node 501/501, proofs 20/20; no verdict test has a vanishing angle between 90° and 180°. e2e not run: its only range check is the box at 90° (`test/e2e-browser.mjs:109`) | survived (R1-25) |
| N19 physics.js:321, gmAbout: product term sign | Node 498/501: stability_readouts gmAbout(weakest axis) = GM_min at yaw 30°, −45°, 135° (2.408 m and 3.033 m for 0.533 m) | caught |
| N20 physics.js:296, `wpBad` tested on the area only | Node 500/501: mesh_check "unrepaired flipped side: the waterplane fault is flagged (negative BM)" | caught |
| N21 app.js:959, Settle never uses the static equilibrium solve (`useFin = false`) | none: no Node suite loads `js/app.js`; e2e 131/131 (`$S/e2e_N21.txt`) | survived (R1-23) |
| N22 app.js:917, Settle's rest test back to speed only (`ke < 2e-4`) | none: e2e 131/131 (`$S/e2e_N22_2.txt`); the static solve then moves the cube by 0.007° instead of 4.37×10⁻⁵° and hides the early stop | survived (close to equivalent while the solve converges; R1-23) |

Totals: 52 mutants. The Node suites catch 47 of the 50 they can load: 26 of the 28 round-1 mutations, both variants,
and 19 of the 20 new ones outside `js/app.js`. Five survive every suite I ran:
- M01 and M23 are near-equivalent, as in round 1 (both also pass e2e, 131/131).
- N21 and N22 are the two halves of the Settle fix; e2e passes 131/131 on each (R1-23).
- N18 is the verdict's self-righting boundary (R1-25).

All 15 real round-1 survivors are now caught in Node; M16 is caught by e2e as well. Of the 22 new mutants, 19 are
caught and 3 survive (N18, N21, N22).

## Checked and found sound

**Baselines and app behaviour**
- Baselines reproduced on `103de4d`: `validate-node fine` 501/501 (255 s; regenerated, `$S/base_fine.txt`, 558 s under
  load); `validate-proofs` 20/20; `validate.py` 126/126; `simcheck.py` 3/3 (the cube ends 1.13×10⁻⁴° off a diagonal,
  as in JS); `verify_physics.py` all pass; e2e UI part 131/131; Lean as above.
- The import path leaves good meshes alone. All 36 STEP imports (12 models × 3 qualities) through `prepareMesh` come
  back with no coordinate changed (`$S/openedges3.mjs`). Validate-core reads STEP with `concat(readCad())`, not
  `prepareMesh`, so only this check and e2e cover the app's path on the STEP models.
- Free trim (`gzAt`). Its root is the least-energy trim, with one root at every 5° from 0° to 180° on two hulls. It
  agrees with my own bisection on the trim to 1.4×10⁻¹¹ m (`$S/freetrim2.mjs`). It costs about 2× fixed trim
  (535 ms against 248 ms on the 51k-triangle sphere, `$S/gztime.mjs`). On my unstable wedge hull, fixed trim shows a
  positive range (peak 0.028 m at 64.5°, gone at 85.1°), while free trim is negative all the way. That confirms
  round 1's point that fixed trim errs on the unsafe side.
- `gzSummary` refinement agrees with the closed forms:
  - tender-box loll 3.93017° = atan√(−2GM/BM);
  - box vanishing at 90.000000°;
  - sphere with G off-centre: peak at 80.54° and vanishing at 170.54° = 180° − atan(0.05/0.3).
- The upright box's verdict text is the same at five yaws, and the weakest axis is right at each (`app_probe.mjs yaw`).
- The GZ worker. Stale answers are dropped by sequence and state id (`js/app.js:715-720`). The panel greys out until
  the answer arrives. The verdict waits for a range from the same state and the same trim setting (`js/app.js:617`).
  I saw no console errors in any probe.
- `restAttitude` converges from the simulated attitude in every case I ran (box, tender box, sphere, cube) and
  moves it by 4×10⁻⁵ to 1.5×10⁻⁴° in the app.
- `massProperties(tris, ref)` gives the same volume, centroid and inertia from any reference point on closed meshes
  (`validate-proofs`). With the default top-centre reference, a deck-open hull gets its lidded volume at any height
  above the file origin (`$S/badmesh2.mjs`).

**The new tests**
- References. These are independent of Float Sim's physics: the [2D] section code written in
  `test/validate-stability.js`; the wall-sided formulas; the Irwin–Hall corner-down cube (re-derived:
  F(t) = (t³ − 3(t − 1)³)/6 and the moment integral for 1 ≤ t ≤ 2); the edge-down form (1 − 2√(2s)/3)/√2; and
  rectangle second moments. Two references are only partly independent. The scow free-trim numbers are mine, from
  Float Sim's clipping, which round 1 verified independently. The cube's global minimisation runs on Float Sim's
  `solveWaterline`, and my own minimisation (Q1) confirms it.
- Tolerances. 10⁻⁹ m and 10⁻⁶° for exact polygonal geometry, and 10⁻¹² for closed forms, both justified. The 10⁻³°
  settling tolerance has 9× to 55× margin. Three checks are weaker than the rest:
  - the scow checks at 4 digits;
  - "fixed trim overstates" as an inequality;
  - "free trim leaves no trimming moment", which reads the solver's own residual.
- Every check I targeted can fail: each of the 15 real round-1 survivors (M03–M07, M12–M14, M16–M18, M20, M22,
  M26, M27) and the two variants M06b and M07b fails at least one Node check (table above).
- Gaps in what the tests cover. No Node test runs `prepareMesh` or `repairMesh` on a multi-part mesh with
  non-manifold contact or nesting under an inverted part (R1-16), and none runs the self-righting branch on a real
  body (R1-18) or gives a verdict on a body whose GZ vanishes between 90° and 180° (R1-25, N18 survives). The
  app-only code (`restCheck`, the use of the static solve, `worseSide`) is covered only by e2e, and e2e cannot see the
  static solve or the new rest test removed: N21 and N22 both pass 131/131 (R1-23). I planted no mutant in
  `worseSide`.
