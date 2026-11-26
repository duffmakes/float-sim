# Round 1 third check: the fixes for R1-32 … R1-35, Q4 and Q5 (b4541ad)

Scripts and outputs are in `/home/duff/float-sim/.claude/review-scratch/check3/` (called `$K3` below; git-excluded).
The code was loaded from my worktree, `agent-a4346c395b65656ef`, detached at `b4541ad`. Comparisons use the copy of
`255c8b0` in `review-scratch/check2/old255/`. Mutants ran in copies: `$K3/mut3/<id>/` for Node and `$K3/e2e/<id>/` for
e2e. My servers ran on ports 8791–8793 and were stopped by PID. The only project file I changed is this report. Every
child process wrote its output to a file.

The owner has decided R1-28: the least-moment criterion as built in `b4541ad`, both objectives, with the full arm
hypot(GZ, trimming arm). This report treats the choice of criterion as settled and checks only whether the code applies
it correctly.

## Summary

I re-ran the evidence of my second check against `b4541ad`, together with what the defender cites, and added cases of
my own:
- four coincident-face overlaps (24 variants each);
- the barge's full arm on a 0.01° direction grid;
- the cube's free-trim fold;
- the off-centre sphere, where all arms tie.

I re-planted the mutations of my second check that still have code to act on (34 C, 14 F, 8 E, 2 G) and planted 19
new ones on the new code: 18 for Node and 1 for e2e. I drove the app in Chromium.

Baselines reproduced:
- `validate-node fine`: 591/591.
- `validate-proofs`: 20/20.
- e2e UI part (`E2E_SKIP_VALIDATE=1`): 141/141, "ALL PASSED".
- No Lean or Python code changed.

Status:
- **Closed (6):** R1-32, R1-33, R1-34, R1-35, Q4 and Q5.
- **R1-28:** settled by the owner. On every body I tried, the code applies the criterion as described.

The fixes are right where I could check them:
- **Barge (R1-32).** The verdict's range ends at 48.2646° about −0.03°. My own full-arm search on a 0.01° grid puts the
  least arm at 0.03° (48.255°, 0.7287 m against roll's 0.7290 m), so the defender's "a hair off roll" holds.
- **Slender hulls with free trim (R1-34).** The 20 × 5 × 2.5 m hull now gets roll's 78.55° with free trim, and its
  near-pitch roll-over is a note. About 87.78° the curve is followed on one branch and flagged as a fold at 14.87°.
- **Coincident faces (R1-33).** The end slab, the slab at the other end, a duplicated hull and an overlapping slab are
  reported as overlaps in all 24 variants each; at 255c8b0, three of the four were missed in every variant.
- **Cost.** On the 51k-triangle sphere the sweep takes 2.7 s with fixed trim and 15 s with free trim in the app.

Three new findings, all minor:
- **R1-36.** The arm objective breaks ties by faceting noise. On the off-centre sphere, where every direction's arm is
  |CG| in exact arithmetic, the verdict reports 177.5° about 75° from x. Its note says 170.5° about x "takes a larger
  heeling moment", but the two arms differ only by faceting, 0.09 %.
- **R1-37.** The free-trim zero band (GZ ≤ 10⁻⁹ of the size counts as zero) moves vanishing angles where GZ is tangent
  to zero. The corner-down cube's free-trim range about az 90° is now 19.4651°, against asin(1/3) = 19.4712°.
  Without the band (H12) it is 19.47124° again, and no test or case of mine needs the band.
- **R1-38.** 8 surviving mutants on the new code have no test. One of them, H15, is not equivalent: it misses the
  overlap of a block fitted into the hull's corner.

Mutations: 47 of 66 Node mutants and 8 of 11 e2e mutants are caught. Of the 22 survivors, 14 are equivalent or
near-equivalent: C02, C10, C11, C15, C16, C23, C25, F03, F06, F17, F20, H03, E02 and G01.

Confidence:
- high in the least-moment objective as built, the fold handling, the mesh repair, the tests' references and the
  runners;
- medium in free-trim vanishing angles near tangencies (R1-37) and in verdict directions on bodies whose arm is nearly
  the same every way (R1-36).

## Findings re-checked

| Finding | Status | Evidence (command and output, or file:line) |
| --- | --- | --- |
| R1-28 downflooding in every direction (criterion) | **Settled by the owner** (least moment, full arm). My R1-32 and R1-34 positions are met; R1-36 is a residue of the tie rule | The criterion is one objective for both ways a range ends: the least largest arm hypot(GZ, along) up to the end (`js/physics.js:542`, `:634`). Directions whose range does not end are not candidates. The earliest end over all directions is a note when it differs at 0.1° (`:685`). Mutants H01 (arm = GZ only), H02 (end point left out), H04 (non-ending directions as candidates), H05 (back to the earliest end), H06 (no note), H17 (looser tie) and H18 (final run without openings) are all caught |
| R1-32 fixed-trim arm leaves out the trim moment | **Closed** | `node $K3/pitchflood.mjs`: the barge's verdict range is az −0.03°, end 48.2646°, Stable, with "Inclined about the axis at 75° … sooner, at 12.2°" as the note. My own check (`node $K3/floodmoment2.mjs`, the full arm on a 0.01° grid) gives the least arm at az 0.03° (0.7287 m, floods at 48.255°), against 0.7290 m in roll and 0.8257 m at 0.5°. So the defender's second-order argument holds: the trimming arm adds to the arm only as az², while the flood angle falls as \|az\|. Open 4 × 2 × 1 m box: 28.787° about −3.33° (my coarse full-arm grid: 29.50° about 2.5°; the same minimum seen on a 2.5° grid). `$K3/r_r128.txt`: the open hull 20 × 5 × 2.5 m ends at 31.60° (−0.19°), and the square open box at 12.057° on the diagonal. The barge test's checks (\|az\| < 0.1°, end within 0.15° of atan(1.125)) catch H01 and C24 |
| R1-33 coincident-face overlap merged into one shell | **Closed** (new test gap: H15, R1-38) | `node $K3/slab.mjs`: 2 shells, overlaps 2. `node $K3/slab2.mjs`, 24 variants each (2 file orders × 12 rotations of the hull): the end slab at x = 4, at x = 0, a duplicate of the hull, and a slab sticking out on the side planes all report the overlap in every variant. At 255c8b0 the first three were missed in all 24. `nest2.mjs`: 2 / 2 in all three cases. Nothing regressed: `contact3.mjs` (792 variants), `contact2.mjs` (no WRONG), `touch.mjs` (0 of 36), `touch2.mjs` (0 wrong), `shells.mjs`, `nonmanifold.mjs` and `weld.mjs` are as at d43902d. H14 and H16 are caught |
| R1-34 free-trim capsize near pitch; vanishing angle at a start-guess switch | **Closed** | `node $K3/freecap.mjs`: closed 20 × 5 × 2.5 m hull, verdict roll 78.55° with both trims (it was 12.50° near pitch with free trim); pontoon 10 × 2 × 1 m, 90° with both. App (`$K3/app_freecap.txt`): free trim reads "Stable … Heeled about the weakest axis … vanishes at 78.5° … Inclined about the axis at 90° from x, the range ends sooner, at 13.9°, but it takes a larger heeling moment". `node $K3/freebranch.mjs`: about 87.78° the summary's vanish is 14.866° with `fold` true (my 0.25° continuation: between 14.75° and 15.00°). The value at 12.49–12.51° is no longer used. Open barge with free trim: 48.25° about −2.45°, Stable. H07 is caught by the fold test; C29, C30 and C31 are caught there too. The fold's angle depends on the continuation step (the defender reports 14.1°, 14.9° and 13.1° for 0.25°, 0.05° and 0.01°), which is honest for a shallow minimum and is disclosed |
| R1-35 untested new paths | **Closed** for its listed mutants (new gaps in R1-38) | Now caught: C34 (conforming contact, 24 wrong of 72), F08 (L-hull, budget one short), G02 (e2e: buoy note). F10, F11, F12, F14 and F18 acted on code that is gone. The defender's equivalence claims hold on my cases: F06 passes `touch2.mjs` (0 wrong) and `nest2.mjs` (3/3); F20 can now differ only for a stretch shorter than the 30° re-search |
| Q4 the trim search is never repeated | **Closed** | `js/physics.js:426`: the search is made again 30° along the curve. The buoy's GZ panel (e2e) reads "searched again every 30°". H11 (no re-search) survives (R1-38) |
| Q5 "worst of all heel directions" wording | **Closed** | `js/physics.js:757-759`, and the verdict texts above: "Heeled about …, the direction in which the least heeling moment ends the range". The e2e cube check reads it, and E05 is caught |

## New findings

### R1-36 Ties in the arm objective are broken by faceting noise, and the note then claims "a larger heeling moment"
- Severity: minor.
- Kind: code bug (wording and tie rule).
- Claim challenged:
  - `worstHeelRange` breaks ties within 10⁻⁹ of the size (`js/physics.js:635`).
  - The verdict's note says the earlier end "takes a larger heeling moment to get there" (`:764`).
- Evidence:
  - Blind: a sphere with G 0.3 m below and 0.05 m beside its centre has, in every direction whose range ends, the same
    largest arm |CG| = √(0.3² + 0.05²) = 0.30414 m, because B is always under the centre. About x the range ends
    soonest, at 180° − atan(0.05/0.3) = 170.54°.
  - `node $K3/spheretie.mjs` (STEP sphere, normal quality):
    ```
    verdict az 75.02 end 177.532 arm 0.30386 | about x: end 170.537 arm 0.30414 | earliest 170.537 at -0.0
    "… Heeled about the axis at 75° from x, the direction in which the least heeling moment ends the range (fixed trim),
     … vanishes at 177.5° … Inclined about the axis at 0° from x, the range ends sooner, at 170.5°, but it takes a
     larger heeling moment to get there."
    ```
  - At fine quality: 177.51° about 74.9° (`$K3/sweepcost.txt`).
  - The 0.09 % difference between the arms is faceting. The note's "larger heeling moment" is not true here.
  - The defender's test accepts any range between 170.54° and 180°.
- Why it matters: on bodies whose arm is nearly the same every way (spheres, round buoys, vertical cylinders), the
  verdict's direction and range come from the mesh. The note's claim is then false, and the range reported is the
  less conservative of two equal-moment ends.
- What would resolve it:
  - Treat arms within the faceting error (for example 10⁻³ of the arm, not of the size: H17, 10⁻³ of the size, breaks
    the cube) as tied, and break ties by the earliest end.
  - Leave out "larger heeling moment" when the two arms tie.
  - The sphere test could then check 170.54°.

### R1-37 The free-trim zero band moves vanishing angles where GZ is tangent to zero
- Severity: minor (0.006–0.012° on the cube).
- Kind: code bug / validation gap.
- Claim challenged: `gzAnalysis` passes `zero: 1e-9·size` with free trim (`js/physics.js:611`). The comment says a
  band would move a tangency, which is why fixed trim has none.
- Evidence:
  - The corner-down cube heeled about az 90° with free trim reaches the edge-down equilibrium at asin(1/3) =
    19.4712° (`check/cubefree.txt`, my last check). There GZ is nearly tangent to zero: 9.3×10⁻⁹ m at 19.46° and
    1.1×10⁻¹⁰ m at 19.47° (`node $K3/cubefold.mjs`).
  - `b4541ad` gives 19.465111°. 255c8b0 gave 19.471193°. With the band removed (mutant H12) it gives 19.471238°.
  - The cube's free-trim ranges all moved down by 0.006–0.012° (`$K3/r_cubefree_az.txt`: 35.252° for 35.264°).
  - H12 passes all 591 checks, and on my slender hulls (`freecap.mjs` on the H12 copy) the verdicts are unchanged. So
    no test or case I have needs the band.
- Why it matters: a free-trim vanishing angle can be wrong by about √(band / curvature) at a tangency, and nothing
  shows what the band is protecting against.
- What would resolve it:
  - Count GZ as zero only where it stays within the band over an interval (the 90°-trim yaw case the comment names),
    or not at all.
  - Add a test for the case the band is meant for.

### R1-38 New code paths with no test; one mutant is not equivalent
- Severity: minor.
- Kind: validation gap.
- Evidence: these mutants pass all 591 Node checks and 20/20 proofs, or 141/141 e2e:
  - H15 (R1-33 own-patch pairs crossed, `js/meshcheck.js:240`) is not equivalent. `node $K3/nest2.mjs` on its copy:
    the block fitted into the hull's corner (x 3..4, y 0..1, full height) gives overlaps 0 / 0, against 2 / 2 on
    b4541ad (`$K3/r_H15.txt`). The defender's own comment names this case ("a part fitted into a corner of another").
  - H08 (branch following in 5° steps), H09 (sign-changing steps kept as start points) and H10 (no 0.5° sub-steps in
    `gzCurve`): none of the tests depends on how the branch is followed between samples.
  - H11 (no re-search, Q4).
  - H12 (no free-trim band, R1-37).
  - H13 (the verdict's fold wording) and G03 (the GZ panel's fold note).
- Why it matters: the R1-33, R1-34 and Q4 fixes can regress without a failing test.
- What would resolve it:
  - Add the corner block to the mesh tests.
  - Add a free-trim curve whose samples must follow the body through a fold: the barge heeled about y, where the trim
    goes to −155° at 10° with the sub-steps.
  - Add a stable trim that returns after a stretch with none.
  - Add checks of the fold texts in the verdict and the panel.

## Questions for the defender

- Q6 (R1-37): what case does the free-trim zero band protect against, and can it have a test? I could not find a body
  that needs it.

## Mutation testing

Node: `node test/validate-node.mjs fine` (591 checks) and `node test/validate-proofs.mjs` (20) in each copy, seven at a
time (`$K3/mutate3.mjs`, `$K3/mutations3.mjs`, `$K3/mut3-results.json`, `$K3/mut3-log.txt`). e2e:
`E2E_SKIP_VALIDATE=1 node test/e2e-browser.mjs` (141 checks), three at a time, after the Node run (`$K3/e2e_batch*.log`,
`$K3/e2e_<id>.txt`). Each `find` string occurs exactly once. F09–F14, F18 and F22 were dropped: the code they mutated
is gone.

| Mutation (change) | Caught by | Survived? |
| --- | --- | --- |
| C01 weld searches 13 of 26 cells | Node 589/591 | caught |
| C02 isolated-patch pairing sides swapped | none | survived (equivalent, as before) |
| C03 patches not ordered by number | Node 590/591 | caught |
| C04 contact pairing disabled | Node 581/591 | caught |
| C05 parent-turn rule removed | Node 588/591 | caught |
| C06 shells turned innermost first | Node 588/591 | caught |
| C07 a segment ending on the plane can cross | Node 590/591 | caught |
| C08 edge/corner hits never probed | Node 589/591: the end slab | caught |
| C09 probe threshold 1.5 | Node 589/591: the end slab | caught |
| C10 nesting samples outside | none | survived (equivalent on my cases) |
| C11 one sample enough | none | survived (equivalent on my cases) |
| C12 opening depth sign | Node 579/591 | caught |
| C13 opening height from R's y row | Node 580/591 | caught |
| C14 opening under water at the start ignored | Node 590/591 | caught |
| C15 flood from the dry end of the bracket | none | survived (equivalent) |
| C16 "wet" sample 10⁻³ of the size under | none | survived (equivalent) |
| C17 end ignores the flood angle | Node 581/591 | caught |
| C18 180° tolerance 1° | Node 589/591 | caught |
| C19 no 180° tolerance | Node 589/591 | caught |
| C20 no neutral band | Node 589/591 | caught |
| C21 maximum searched past the flood angle | Node 588/591 | caught |
| C22 no refinement rounds | Node 589/591: cube 36.617° | caught |
| C23 45° grid | none | survived (near-equivalent: the refinement still reaches the cube's minimum within the new 0.01° tolerance) |
| C24 ties go to the last direction | Node 590/591: barge direction | caught |
| C25 refinement grid half as wide | none | survived (near-equivalent) |
| C26 small range below 25° | Node 590/591 | caught |
| C27 early-peak note below 20° | Node 588/591 | caught |
| C28 opening exactly at the start not bad | Node 590/591 | caught |
| C29 stable-root step never taken | Node 586/591: the fold about 87.78° | caught |
| C30 stable root of more energy kept | Node 589/591 | caught |
| C31 stable-root scan in 1.0 rad steps | Node 588/591 | caught |
| C32 range past 170° self-righting (N18) | Node 589/591 | caught |
| C33 spread never detected | Node 589/591 | caught |
| C34 no opposite-sides check | Node 590/591: conforming contact, 24 of 72 wrong | caught (survived at d43902d) |
| F01 own-patch rule removed | Node 586/591 | caught |
| F02 own-patch pairs crossed | Node 583/591 | caught |
| F03 same-own skip removed | none | survived (equivalent: dead code) |
| F04 probe without the inward offset | Node 586/591 | caught |
| F05 offset outward | Node 582/591 | caught |
| F06 probe without the step past the crossing | none; 0 wrong in `touch2`, 3/3 in `nest2` | survived (near-equivalent, as the defender argues) |
| F07 untested shells turned again (Q1) | Node 590/591 | caught |
| F08 tested pairs never recorded | Node 590/591: L-hull, budget one short | caught (survived at d43902d) |
| F15 verdictRange never sweeps | the suite throws, 316/322 | caught |
| F16 R1-29 search removed | Node 589/591 | caught |
| F17 end never taken as the maximum | none | survived (near-equivalent) |
| F19 trimUnstable never set | Node 590/591 | caught |
| F20 flag kept after a stable trim | none | survived (near-equivalent with the 30° re-search) |
| F21 scan to ±28.6° | Node 587/591 | caught |
| H01 arm = GZ only (no trimming arm) | Node 587/591: barge 1.09° arm, cube | caught |
| H02 arm without the end point | Node 590/591 | caught |
| H03 arm without the refined maximum | none | survived (near-equivalent: the 5° samples bound the maximum) |
| H04 non-ending directions as candidates | Node 588/591: sphere | caught |
| H05 objective = earliest end | Node 582/591: barge | caught |
| H06 earliest note never given | Node 589/591 | caught |
| H07 fold never flagged | Node 590/591 | caught |
| H08 branch following in 5° steps | none | survived (R1-38) |
| H09 sign-changing steps kept | none | survived (R1-38) |
| H10 no 0.5° sub-steps in gzCurve | none | survived (R1-38) |
| H11 no re-search (Q4) | none | survived (R1-38) |
| H12 no free-trim zero band | none | survived (R1-37, R1-38) |
| H13 verdict fold wording never used | none | survived (R1-38) |
| H14 R1-33 two-tie pairing disabled | Node 590/591: end slab | caught |
| H15 R1-33 own-patch pairs crossed | none; corner block missed (`$K3/r_H15.txt`) | survived (not equivalent; R1-38) |
| H16 R1-33 lower-patch rule crossed | Node 587/591 | caught |
| H17 arm tie 10⁻³ of the size | Node 589/591: cube 36.617° | caught |
| H18 final run without openings | Node 588/591: open-deck box | caught |
| E01 Settle without the static solve (N21) | e2e 138/141 | caught |
| E02 rest test speed only (N22) | none | survived (near-equivalent) |
| E03 "Opening under water" never given | e2e 140/141 | caught |
| E04 openings not sent to the workers | e2e 138/141 (also the no-maximum check) | caught |
| E05 `sweep: false` | e2e 140/141: the cube's 35.3° | caught |
| E06 opening points not scaled | e2e 139/141 | caught |
| E07 Waves range ignores flooding | e2e 140/141 | caught |
| E08 openDepth sign | e2e 139/141 | caught |
| G01 panel prints the maximum with flood 0 | none | survived (equivalent: with flood 0 the maximum stays −∞, since the R1-29 search needs end > start) |
| G02 free-trim note never shown | e2e 140/141: buoy | caught (survived at d43902d) |
| G03 panel fold note never shown | none | survived (R1-38) |

Totals:
- **Node:** 47 of 66 caught. Of the 19 that survive, 11 are equivalent or near-equivalent (C02, C10, C11, C15, C16,
  C23, C25, F03, F06, F17, F20); H03 is near-equivalent too. The other 7 are R1-38 (H08–H13, H15).
- **e2e:** 8 of 11 caught. E02 and G01 are equivalent or near-equivalent; G03 is R1-38.
- **Re-planted from earlier rounds:** N18 (C32) and N21 (E01) are still caught.

## Checked and found sound

**Baselines**
- `validate-node fine`: 591/591, 371 s with the e2e baseline running alongside (`$K3/base_fine.txt`).
- `validate-proofs`: 20/20.
- e2e UI part: 141/141 (`$K3/e2e_base.txt`), including the new checks:
  - the panel gives no maximum with an opening under water at the start;
  - the cube's verdict "the direction in which the least heeling moment ends the range … 35.3°";
  - the buoy's free-trim note.

**The least-moment objective as built**
- Barge, fixed trim: 48.2646° about −0.03° (my full-arm minimum: 0.03°, 48.255°). Free trim: 48.25° about −2.45°. Both
  Stable, with the 12.2° and 7.1° near-pitch flooding as notes (app).
- Closed hulls with free trim: 78.55° (20 × 5 × 2.5 m) and 90° (pontoon, barge, box) in roll.
- Box with KG 0.3 m: roll's 112.32°, with pitch's 99.89° as a note (the defender's test, against [2D]).
- Corner-down cube: 35.2644–35.2745° fixed at five yaws (`$K3/r_r117.txt`), within the new 0.01° tolerance.
- Rafts and the pontoon: Stable, with the early-peak note where the peak is below 25°.
- The edge-down cube is neutral at three yaws.
- The arm is the full couple arm. `gzAt` now returns the fixed-trim `along`, and `gzSummary` takes the maximum of
  hypot(GZ, along) over the samples, the end and the refined maximum (`js/physics.js:538-550`).

**Free trim**
- The scow and wedge still match my bisection (1.4×10⁻¹¹ m, `$K3/r_freetrim2.txt`).
- The cube's free-trim range over direction is smooth and 3-fold symmetric, 0.006–0.012° lower than before (R1-37).
- The barge pitched with free roll rolls over: at 10° of pitch, with the sub-steps, the trim reaches −155° and GZ is
  −9.35 m. That is the roll instability my estimate predicted (GM_T ≈ −0.9 m once the stern is out).

**Mesh repair:** every case from my earlier checks is unchanged, and the four coincident-face overlaps are found.

**Cost on the 51k-triangle STEP sphere at fine quality, b4541ad**

| Run | Fixed trim | Free trim |
| --- | --- | --- |
| Node single-threaded, G 0.05 m off centre (53 analyses) | 5.7 s | 33.1 s |
| Node single-threaded, G centred (25 analyses) | 2.3 s | 22.3 s |
| App, idle 16-core machine, 6 workers | 2.7 s | 14.8–15.0 s |

The single-threaded runs are in `$K3/sweepcost.txt`, the app runs in `$K3/app_timing.txt`. They agree with the
defender's 5.7 s, 33.4 s, 2.4 s and 22.7 s. Against d43902d, only the centred free-trim sweep is slower (12.9 s → 22.3 s),
from the 0.5° sub-steps and the 30° re-searches.

**The new tests: independence and tolerances**
- The barge's arm in roll equals GZ at atan(1.125), against [2D] (10⁻⁷ m); so does the low-freeboard box's.
- The box with KG 0.3 m: roll and pitch against [2D] (10⁻⁶°).
- The 20 × 5 × 2.5 m hull: 78.55° against [2D].
- The conforming contact (72 variants), the end slab (24) and the L-hull budget case are closed-form volumes.
- The sphere's range test is loose by design (R1-36).
