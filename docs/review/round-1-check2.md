# Round 1 second check: the fixes for R1-26 … R1-31, Q1–Q3 and R1-16 (d43902d)

Scripts and outputs are in `/home/duff/float-sim/.claude/review-scratch/check2/` (called `$K` below; git-excluded).
The code was loaded from my worktree, `agent-a4346c395b65656ef`, detached at `d43902d`. Comparisons use a copy of
`255c8b0` (`$K/old255/`, `git archive`) and of `103de4d` (`review-scratch/check/old103/`). Mutants ran in copies:
`$K/mut3/<id>/` for Node and `$K/e2e/<id>/` for e2e. My servers ran on ports 8791–8793 and were stopped by PID at the
end. The only project file I changed is this report. Every child process wrote its output to a file.

## Summary

I re-ran the evidence of my last check against `d43902d`, together with what the defender cites, and added cases of my
own:
- 792 shared-edge variants;
- 13 touching or coplanar-overlap placements;
- the least-moment flood criterion, re-derived with the full moment;
- free trim on slender hulls.

I re-planted all 42 mutations of the last check and planted 24 new ones on the new code: 22 for Node and 2 for e2e. I
drove the app in Chromium.

Baselines reproduced:
- `validate-node fine`: 577/577 (268 s).
- `validate-proofs`: 20/20.
- e2e UI part (`E2E_SKIP_VALIDATE=1`): 139/139, "ALL PASSED".
- No Lean or Python code changed.

Status:
- **Closed (6):** R1-16, R1-26, R1-27, R1-29, R1-30 and R1-31.
- **Answered (3):** Q1, Q2 and Q3.
- **Escalated to the owner (1):** R1-28, the choice of criterion.

The fixes are right where I could check them:
- **Mesh repair.**
  - Every partial-contact case comes out at the true volume, both parts outward or either one inside out, in every file
    order and with every triangle first.
  - Blocks that only touch are no longer overlaps: 0 of 36 placements, and 0 of 8 new ones.
  - Coplanar overlaps are still found: 5 of 5.
- **R1-29.** The low-freeboard box's maximum is 0.0163 m at 2.862°.
- **R1-30.** Free trim costs 14–17 s in the app on the 51k-triangle sphere, against 111–113 s at 255c8b0.
- **The tests.** 38 of 56 Node mutants and 7 of 10 e2e mutants are caught. Every target R1-31 named (C08, C09, C18,
  C26, C27, C30, E05, E07) is now caught.
- **The defender's equivalence claims.** C02, C10 and C11 hold on every case I tried.

Four new findings, one of them major:
- **R1-34 (major).** With free trim, the verdict's capsize objective, the earliest vanishing angle over every direction,
  is decided near pitch on slender hulls. A closed 20 × 5 × 2.5 m box hull, which vanishes at 78.6° in roll, gets
  "Stable (small range) … vanishes at 12.5°" about the axis at 87.8° from x, with 3.8 m of righting arm in that
  direction. The 12.50° is not even a zero of one trim branch. It is where the refinement switches between the start
  guesses of the 10° and 15° samples: GZ is +2.26 m at 12.49° and −4.59 m at 12.51°. This is R1-28's problem again,
  for capsizing with free trim. It has been present since the sweep was added.
- **R1-32 (minor).** With fixed trim, the least-moment flood objective compares only the arm about the heel axis. The
  moment that holds the trim is left out, so skewed directions look cheaper than they are. The barge's range ends at
  44.7°, 1.1° off roll, where the trim-holding arm alone is 0.85 m; counting it, pure roll is cheapest and floods at
  48.4°. On the open box it gives 24.3° against 29.5°. The error is on the safe side.
- **R1-33 (minor, pre-existing).** An inner solid that shares a face with its container, with the coincident triangles
  wound the same way, is merged into one shell, and the overlap goes unreported: 10 m³ for an 8 m³ union.
- **R1-35 (minor).** 9 surviving mutants on the new code have no test. One of them, C34, is not equivalent: it gives
  wrong volumes in 24 of 72 variants of a conforming contact.

Confidence:
- high in the mesh repair for shared edges and touching parts, in R1-29 and R1-30, and in the tests' references;
- medium in the verdict's range for open hulls with fixed trim (R1-32: the error is on the safe side);
- low in the verdict's range with free trim (R1-34).

## Findings re-checked

| Finding | Status | Evidence (command and output, or file:line) |
| --- | --- | --- |
| R1-16 inside-out part sharing an edge | **Closed** | `node $K/contact2.mjs`: hull + flush deckhouse gives 12.0000 m³ (true 12) and overlaps 0 in all six cases: both outward, the deckhouse inside out, the hull inside out, each in two file orders. The STL and STEP import paths give the same, and so does each of the hull's 12 triangles placed first. At 255c8b0 the inside-out deckhouse gave 4 m³ in both orders. `node $K/contact3.mjs` covers 792 variants (each part outward or inside out, every file order, the first part's triangle list rotated 12 ways) of five geometries: a flush deckhouse, a sponson flush with the wall and the bottom, two flush deckhouses, a conforming hull whose deck is split under the deckhouse, and a three-box stack with partial contact on top. Wrong volume 0, false overlaps 0. `nonmanifold.mjs` and `shells.mjs` are unchanged: 16, 16, 16, 16, 12 m³; 6.5 and 106.5 m³ with 1 void |
| R1-26 pairing breaks correctly wound partial contact | **Closed** | Same evidence. Mutants F01 (own-patch rule removed), F02 (own pairs crossed), F04 and F05 are caught by the new deckhouse tests. C02 (fixed-side rule swapped) passes all 577 checks and all 792 of my variants (`$K/contact3_C02.txt`). The defender's argument holds: the fixed-side rule now applies only to isolated contact patches, and an isolated patch's rim is made entirely of shared four-use edges, so the two parts' contact faces coincide and either pairing closes both parts. F03 is dead code: `pf(i) === pf(j)` is skipped first, at `js/meshcheck.js:235`. C34 is not equivalent (R1-35) |
| R1-27 touching shells reported as overlapping | **Closed** | `node $K/touch.mjs`: 0 of 36 (30 at 255c8b0). `node $K/touch2.mjs`: 8 more touching placements give 0 overlaps in both orders: against a wall, in a corner, along an edge, at a corner, an octagonal log on the deck, overhanging the deck edge, overhanging both sides under the bottom, and a thin plate flush with three faces. 5 coplanar overlaps are found in both orders: a block sunk into the deck, a block with its top flush with the deck from inside, a block flush with a wall, the same-section blocks overlapping at the end, and a corner block with three faces coplanar. The probe point is moved into the edge's own shell (`js/meshcheck.js:413-423`), so it lies off every face of both shells. C08 and C09 are now caught by the same-section test, and F04 and F05 by the touching tests. F06 (no step past the crossing) survives everything, mine included (R1-35). The end slab of R1-33 is a different mechanism |
| R1-28 downflooding taken in every direction | **Escalate to the owner** (positions below). The pitch-direction flooding no longer decides the range with fixed trim. My evidence on the criterion is R1-32 and R1-34 | `node $K/pitchflood.mjs`: the barge's range now ends at 44.7065° about −1.09°, level Stable, and the 12.2° nearer pitch is a note. App (`$K/app_freecap.txt`): "Stable … About the axis at −1.1° from x … an opening goes under water at 44.7° … Inclined about the axis at 75° from x, an opening goes under water sooner, at 12.2°, but it takes a larger heeling moment". Open 4 × 2 × 1 m box: 24.255° about 10.37° from x, "Stable (small range)"; in roll it floods at 32.0054°. Square open box: 12.057° on the diagonal, for both trims (`$K/r128.txt`). F09 (flood objective by angle) and F13 (no floodAny) are caught. F10, F11, F12, F14 and F18 survive (R1-35) |
| R1-29 no maximum before the first sample | **Closed** | Blind: the roll downflooding angle is atan(0.05) = 2.8624°, with GM_T 0.326 m > 0. `node $K/lowfb.mjs`: about x, flood 2.8624°, max 0.016295 m at 2.8624° (positive, inside the range). The verdict says "peaks at 2°" in the worst direction (az 12.78°, end 2.0201°). The GZ panel no longer prints a maximum when an opening is under water at the start (`js/app.js`, `flood === 0`). F16 is caught. F17 is near-equivalent (the golden section converges to the end of the range anyway). G01 survives (R1-35) |
| R1-30 free-trim cost and silent energy maximum | **Closed** (Q4 on the flag) | `$K/sweepcost.txt` (idle, single-threaded): one free-trim `gzAnalysis` on the 51k-triangle sphere takes 475 ms (refineMax off), and the verdict's whole range 35.0 s free and 5.6 s fixed (53 analyses). At 255c8b0 these were 13.8 s, 441 s and 10.8 s. With G centred: 12.9 s and 2.35 s. `$K/fttime2.txt` (machine loaded): a full free-trim analysis takes 1.2–1.3 s (9.1 s at 255c8b0, 0.54 s at 103de4d). App on an idle 16-core machine (`node $K/app_check.mjs timing`, `$K/app_timing.txt`): 2.6–2.7 s fixed, 14.0–16.5 s free (111–113 s at 255c8b0). The sphere is flagged from 85° with GZ equal to fixed trim's (the defender's test). The panel note exists (`js/app.js`, `trimUnstable`). README:34 and the map now say "following the local energy minimum from the previous angle's trim". F19 and F21 are caught. F20 and F22 survive: F22 changes only the cost; F20 is in R1-35 |
| R1-31 thresholds and app paths not pinned | **Closed** for its listed targets (new gaps in R1-35) | Now caught: C08 and C09 (same-section overlap), C18 (sphere at 179.43°), C26 (catamaran ending at 26.78° against [2D]), C27 (square box peaking at 22.90°), C30 (offset cube, stable trims 2.3×10⁻³ apart in energy), E05 (e2e: the cube's verdict reads "vanishes at 35.3°"), E07 (e2e: the Waves-stage range reads "roll range of stability (32°"). The new references are independent of Float Sim's GZ: [2D], closed forms, or bisection on `solveWaterline`, which round 1 verified. The defender's equivalence claims hold on my cases. C02 is covered in the R1-26 row. C10 and C11 pass all 577 checks, `touch2.mjs` (13 cases), `nest2.mjs` (3) and `shells.mjs` (11) (`$K/c10c11.txt`) |
| Q1 budget exhaustion turns voids into solids | **Closed** | With the budget exhausted, a negative shell whose bounding box lies inside a closed shell's, for a pair that was not tested, is not turned (`js/meshcheck.js:453-460`, `:470`). The defender's budget-1 test gives 7.75 m³. F07 is caught. F08 (no pair recorded as tested) survives (R1-35) |
| Q2 main-thread fallback | **Closed** | `js/app.js:796` passes `sweep: !!gzPool`, and `verdictRange` (`js/physics.js:622-637`) then takes only both senses about the weakest axis. F15 (never sweep) breaks the suite, which throws reading `floodAny` |
| Q3 three-use edges give no opening points | **Closed** | I accept the answer: an edge used three times is a junction (a fin or partition), not a hole, and the hull is closed across it |

**R1-28, positions for the owner.**
- **Defender.** The range ends at the earliest vanishing angle in any direction, or where the body floods with the
  least heeling moment: the smallest largest righting arm up to the downflooding angle, among the directions that flood
  before they capsize. The criterion needs no threshold, gives near-roll answers on long hulls and the diagonal on
  square ones, and reports the earliest flooding as a note.
- **Reviewer.** The least-moment idea is sound, but as built it is not applied consistently. With fixed trim it leaves
  out the moment that holds the trim, so skewed directions look cheaper (R1-32: barge 44.7° against 48.4°, box 24.3°
  against 29.5°). Capsizing still takes the earliest angle in any direction, which with free trim is a near-pitch
  roll-over that needs metres of righting arm to reach (R1-34). Apply the full-moment rule to both objectives, or
  restrict both to heel near the weakest axis.

## New findings

### R1-32 With fixed trim, the least-moment flood objective leaves out the moment that holds the trim
- Severity: minor (the error is on the safe side: earlier downflooding angles).
- Kind: code bug.
- Claim challenged:
  - `worstHeelRange`'s flood objective (`js/physics.js:573-605`) is "the smallest largest righting arm before the
    downflooding angle (the arm a steady heeling moment must overcome to get there)".
  - With fixed trim, GZ is the component of the buoyancy–weight couple about the heel axis u only.
- Evidence:
  - Derivation. Heeling about a skewed horizontal axis u with the trim held fixed is an equilibrium only if the
    external moment also balances the couple's component about w = z × u, which is W times the trimming arm (B − G)·u.
    The least moment that holds that attitude is W·|(B − G)_horizontal| = W·hypot(GZ, trimming arm). In free trim the
    trimming arm is zero by construction, so the two agree.
  - `node $K/floodmoment.mjs` (`$K/floodmoment.txt`), largest arms up to each direction's downflooding angle:

    | Body, direction | Floods at | Largest GZ | Largest full arm | Free trim |
    | --- | --- | --- | --- | --- |
    | Barge, roll (az 0°) | 48.366° | 0.7290 m | 0.7290 m | 48.366°, 0.7290 m |
    | Barge, az 1.09° (the defender's pick) | 44.708° | 0.7166 m | 1.1129 m (trimming arm 0.85 m) | 48.321°, 0.7288 m |
    | Barge, az 2° | 42.153° | 0.7237 m | 1.6576 m | 48.275°, 0.7287 m |
    | Box 4 × 2 × 1, roll | 32.005° | 0.3074 m | 0.3074 m | 32.005°, 0.3074 m |
    | Box, az 2.5° | 29.504° | 0.2940 m | 0.2982 m | 31.496°, 0.3049 m |
    | Box, az 10.37° (the defender's pick) | 24.255° | 0.2742 m | 0.3300 m | 29.786°, 0.2994 m |
    | Box, az 20° | 20.412° | 0.3002 m | 0.4148 m | 27.467°, 0.2978 m |

  - With the full arm, the least-moment direction is pure roll for the barge (48.37°) and az 2.5° for the box (29.50°).
    With free trim it is az 2° (48.28°) and az 20° (27.47°). The defender's objective picks 44.71° and 24.26°.
- Why it matters: the verdict's angle and its axis ("About the axis at −1.1° from x") are artefacts of leaving out the
  trim moment. A long hull's range is shortened by up to a few degrees. On these two bodies the level does not change:
  the barge stays Stable and the box stays small range.
- What would resolve it:
  - Compare directions by the largest hypot(GZ, trimming arm) up to flooding, with the trimming arm from `gzAt`'s
    fixed-trim evaluation. That is the same as GZ in free trim.
  - Test it on the barge: the range should end at atan(1.125) = 48.37° in roll.

### R1-33 An inner solid that shares a face with its container is merged into one shell, and the overlap goes unreported
- Severity: minor (pre-existing: the same at 103de4d and 255c8b0).
- Kind: code bug.
- Claim challenged:
  - README:143 says the import reports overlapping shells.
  - The model-panel hint at `js/app.js:314` says "No overlaps were found between them".
- Evidence:
  - The case: a 4 × 2 × 1 m hull with a 1 × 2 × 1 m end slab inside it, the slab sharing the hull's x = 4 end face
    (coincident triangles, both wound outward). The union is 8 m³; the sum is 10 m³.
  - `node $K/slab.mjs`:
    ```
    meshCheck {"open":0,"misoriented":0,"nonManifold":5}  repair: {"shells":1,"closedShells":1,"overlaps":0,...}  V 10.0000 (sum 10, union 8)
    ```
  - `node $K/nest2.mjs`: overlaps 0 / 0. The same at 103de4d and 255c8b0 (`$K/nest2_old.txt`).
  - Cause:
    - At the end face's rim edges the two side triangles lie on the same side of the face, so no contact pairing is
      made (`js/meshcheck.js:253`, `side[0] * side[1] < 0`).
    - The four coincident cap triangles have every edge used four times, so each one is its own component.
    - Nothing closes on its own, so all the pieces form one edge-connected shell, and no overlap test runs.
  - A corner block with 3 or 4 coplanar faces is found, because it shares no face exactly.
- Why it matters: an internal block (ballast, an engine room) modelled as a solid flush with the hull's transom is
  counted twice with no warning. With two STEP solids, the panel says "No overlaps were found between them".
- What would resolve it: when coincident same-orientation triangles join two parts, report an overlap, or pair them
  as an overlap so that each part closes. Add the end slab to the mesh tests.

### R1-34 With free trim, the verdict's capsize objective is decided near pitch on slender hulls, at a vanishing angle that is a start-guess switch
- Severity: major (a plausible case with a wrong level; free trim is the option README:34 calls "lower and safer").
- Kind: code bug / literature discrepancy.
- Claim challenged:
  - `worstHeelRange`'s capsize objective, `capsize: (s) => s.vanish ?? Infinity` (`js/physics.js:575`), takes the
    earliest vanishing angle over every direction, regardless of the moment needed to get there.
  - `gzAnalysis` refines crossings with `at(deg)` started from the nearest sample's trim (`:536-537`).
- Evidence:
  - Blind:
    - A closed 20 × 5 × 2.5 m box hull at T 1 m, KG 1.5 m is wall-sided and floats symmetrically; in roll it vanishes
      at 78.55° with both trims (the [2D] section).
    - Pitched past the angle where the stern's bilge leaves the water, atan(1/10) = 5.7°, its waterplane shortens and
      G rises above B. It then loses roll stability: my estimate for the barge at 10° of pitch is GM_T ≈ −0.9 m.
    - So with free trim (free roll) a near-pitch heel rolls the hull over. That needs a large moment: GZ in that
      direction peaks at 3.8 m.
  - `node $K/freecap.mjs`:
    ```
    closed hull 20x5x2.5: roll vanishes at 78.55 (fixed) / 78.55 (free) | verdict fixed: az 0.00 end 78.55 -> good | free: az 87.78 end 12.50 max 3.786 m -> ok
    closed pontoon 10x2x1: roll vanishes at 90.00 / 90.00 | verdict fixed: az 0.00 end 90.00 -> good | free: az -89.94 end 12.50 max 2.078 m -> ok
    ```
  - App (`node $K/app_check.mjs freecap`, `$K/app_freecap.txt`):
    - hull20.stl with Free trim ticked reads "Stable (small range) … About the axis at 87.8° from x, the worst of all
      heel directions (free trim), the righting arm peaks at 8.4° and vanishes at 12.5° … (IS Code A 2.2.2)"; fixed
      trim reads "Stable … vanishes at 78.5°".
    - The open barge with free trim reads "Stable (small range) … about the axis at 87.7° … vanishes at 11°"; fixed
      trim reads Stable, 44.7°.
  - The 12.50° is not a zero (`node $K/freebranch.mjs`):
    ```
    samples: 10°: GZ 3.493 trim −29.2° | 15°: GZ −3.532 trim −126.3°
    heel 12.49: from the 10° trim: gz 2.2593 trim −49.81° | heel 12.51: from the 15° trim: gz −4.5929 trim −149.35°
    continuation in 0.25° steps: crossing between 14.75 and 15.00 (trim −69.1 -> −126.3)
    ```
    The regula falsi brackets the point where `near(deg)` switches start guesses, midway between the samples. Along
    one branch, GZ is still +0.96 m at 14°. The branch folds near 14.9°, and the 15° sample lands on a root at −126°
    of trim, past the ±90° that the R1-30 text describes.
  - This is the same objective as at 255c8b0 (the earliest end over all directions), so it has been there since the
    sweep was added (R1-17). My last check ran free trim only on the cube and the sphere.
- Why it matters: with Free trim ticked, a user gets "small range" and an IS Code citation for ordinary slender hulls
  whose roll range is 78–90°. The angle shown is a numerical artefact, in a direction no realistic heeling load acts
  in.
- What would resolve it:
  - Apply the least-moment rule to capsizing as well (with the full arm of R1-32), or restrict both objectives to heel
    near the weakest axis (the owner's choice, R1-28).
  - Refine free-trim crossings along one branch (continue from the bracket's own end, not from the nearest sample),
    and report a fold rather than calling it a vanishing angle.
  - Add the 20 × 5 × 2.5 m hull with free trim to `validate-stability`.

### R1-35 New code paths with no test
- Severity: minor.
- Kind: validation gap.
- Claim challenged: the ledger says "Mutants planted again by the defender on the new code … each fails". These ones,
  on the same new code, do not.
- Evidence: each of these passes all 577 Node checks and 20/20 proofs, or 139/139 e2e (table below):
  - C34 (no opposite-sides check in the pairing) is not equivalent: `node $K/contact3.mjs` on its copy gives wrong
    volumes in 24 of 72 variants of the conforming hull, whose deck is split under the deckhouse.
  - F06: the probe without the step past the crossing.
  - F08: no pair recorded as tested, so with the budget exhausted every contained negative shell stays a void.
  - F10 and F18: `gzFlood` left out or set to 0. The objective is meant to use it "so it is continuous across the
    samples".
  - F11: the flood objective also counts directions that capsize first.
  - F12: the capsize key back to the end of the range.
  - F14: the final run always with openings.
  - F20: the `trimUnstable` flag kept after a stable trim is found, so the rest of the curve skips the search.
  - G01: the GZ panel prints the maximum with an opening under water at the start.
  - G02: the panel never shows the free-trim note.
- Why it matters: the R1-26, R1-28 and R1-30 fixes can regress without a failing test.
- What would resolve it:
  - Add the conforming contact case.
  - Add a case where some direction capsizes before it floods with a smaller arm.
  - Add an open hull whose range ends by capsizing, with openings elsewhere.
  - Add a free-trim curve on the R1-D1 cube that must still search after a stable trim.
  - Add e2e checks of the two panel texts.

## Questions for the defender

- Q4 (R1-30): once an angle is flagged `trimUnstable`, `gzCurve` passes `noScan` to every later angle
  (`js/physics.js:422`). The solver then starts from the unstable trim and usually stays on that branch. A stable trim
  that reappears within ±90° further along the curve is not looked for. Is that intended? F20 shows that the flag's
  reset is not tested either.
- Q5: when the flood objective decides, the verdict still says "the worst of all heel directions" (`js/physics.js:707`).
  It is the direction that floods with the least moment, not the earliest. Should the wording say so?

## Mutation testing

Node: `node test/validate-node.mjs fine` (577 checks) and `node test/validate-proofs.mjs` (20) in each copy, seven at a
time (driver `$K/mutate3.mjs`, list `$K/mutations3.mjs`, results `$K/mut3-results.json`, log `$K/mut3-log.txt`). e2e:
`E2E_SKIP_VALIDATE=1 node test/e2e-browser.mjs` (139 checks) against a server from each full copy, two at a time
(`$K/mke3.sh`, `$K/e2e_batch.sh`, `$K/e2e_<id>.txt`). Each `find` string occurs exactly once.

Under load 35, while Node mutants ran, four e2e runs stopped at the 120 s panel-method timeout (`e2e-browser.mjs:339`).
E03 and E04 had already failed their target checks before that point. G01 and G02 were re-run one pair at a time on
an idle machine (`$K/e2e_batch6.log`); the table gives those runs.

| Mutation (file:line, change) | Caught by | Survived? |
| --- | --- | --- |
| C01 meshcheck.js:46, weld searches 13 of 26 cells | Node 575/577: weld across a cell boundary | caught |
| C02 meshcheck.js:255, isolated-patch pairing sides swapped | none: 577/577; also 0 wrong in my 792 variants | survived (equivalent: an isolated patch's contact faces coincide) |
| C03 meshcheck.js:248, patches not ordered by number | Node 576/577: shuffled stacked boxes | caught |
| C04 meshcheck.js:232, contact pairing disabled | Node 568/577: stacked boxes, deckhouse | caught |
| C05 meshcheck.js, parent-turn rule removed | Node 574/577: raft + hollow box, box/void/core | caught |
| C06 meshcheck.js, shells turned innermost first | Node 574/577: the same | caught |
| C07 meshcheck.js:169, a segment ending on the plane can cross | Node 576/577: touching blocks (24 overlaps for 0) | caught |
| C08 meshcheck.js:177, edge/corner hits never probed | Node 576/577: same-section overlap (0 for 2) | caught (survived at 255c8b0) |
| C09 meshcheck.js, probe threshold 0.5 → 1.5 | Node 576/577: same-section overlap | caught (survived at 255c8b0) |
| C10 meshcheck.js:343, nesting samples just outside | none: 577/577; 0 wrong in `touch2`, `nest2`, `shells` | survived (equivalent on every case I tried) |
| C11 meshcheck.js, one sample enough for nesting | none: 577/577; the same | survived (equivalent on every case I tried) |
| C12 physics.js:345, opening depth sign | Node 569/577: open-deck box and barge flooding | caught |
| C13 physics.js:345, opening height from R's y row | Node 570/577 | caught |
| C14 physics.js, opening under water at the start ignored | Node 576/577 | caught |
| C15 physics.js, flood from the dry end of the bracket | none | survived (equivalent: 10⁻⁹° bracket) |
| C16 physics.js, "wet" sample only 10⁻³ of the size under | none | survived (equivalent: it changes the bracket, not the root) |
| C17 physics.js:476, end ignores the flood angle | Node 571/577 | caught |
| C18 physics.js:475, 180° tolerance 1° | Node 575/577: sphere at 179.43° | caught (survived at 255c8b0) |
| C19 physics.js:475, no 180° tolerance | Node 576/577 | caught |
| C20 physics.js, no neutral band | Node 575/577 | caught |
| C21 physics.js, maximum searched past the flood angle | Node 575/577 | caught |
| C22 physics.js:573, no refinement rounds | Node 575/577: cube 36.617° for 35.2644° | caught |
| C23 physics.js:573, 45° grid | Node 576/577: cube 35.2708° | caught |
| C24 physics.js, ties go to the last direction | Node 575/577: box "about the weakest axis" | caught |
| C25 physics.js, refinement grid half as wide | none | survived (near-equivalent within 0.005°) |
| C26 physics.js, small range below 25° | Node 576/577: catamaran at 26.78° reads "good" | caught (survived at 255c8b0) |
| C27 physics.js, early-peak note below 20° | Node 576/577: square box peak at 22.90° | caught (survived at 255c8b0) |
| C28 physics.js, opening exactly at the start not bad | Node 576/577 | caught |
| C29 physics.js:386, stable-root step never taken | Node 573/577: cube and offset cube | caught |
| C30 physics.js, stable root of more energy kept | Node 576/577: offset cube | caught (survived at 255c8b0) |
| C31 physics.js:396, scan in 1.0 rad steps | Node 574/577 | caught |
| C32 physics.js, range past 170° self-righting (N18) | Node 575/577 | caught |
| C33 physics.js, spread never detected | Node 575/577 | caught |
| C34 meshcheck.js:253, no opposite-sides check | none: 577/577; but 24 of 72 conforming variants wrong (`contact3.mjs`) | survived (not equivalent; R1-35) |
| F01 meshcheck.js:241, own-patch rule removed | Node 572/577: deckhouse cases | caught |
| F02 meshcheck.js, own-patch pairs crossed | Node 569/577 | caught |
| F03 meshcheck.js:242, same-own skip removed | none | survived (equivalent: dead code after `:235`) |
| F04 meshcheck.js:423, probe without the inward offset | Node 572/577: deckhouse no-overlap | caught |
| F05 meshcheck.js:413, offset outward | Node 569/577 | caught |
| F06 meshcheck.js, probe only inward (no step past the crossing) | none; 0 wrong in `touch2` | survived (R1-35) |
| F07 meshcheck.js:470, untested shells turned again (Q1) | Node 576/577: budget-1 void | caught |
| F08 meshcheck.js:447, tested pairs never recorded | none | survived (R1-35) |
| F09 physics.js:576, flood objective by angle | Node 574/577: barge | caught |
| F10 physics.js:576, flood objective without gzFlood | none | survived (R1-35) |
| F11 physics.js:576, flood objective over directions that capsize first | none | survived (R1-35) |
| F12 physics.js:575, capsize key = end of range | none | survived (R1-35) |
| F13 physics.js, floodAny never recorded | Node 576/577: barge note | caught |
| F14 physics.js:634, final run always with openings | none | survived (R1-35) |
| F15 physics.js:629, verdictRange never sweeps | the suite throws (`floodAny` undefined), 315/321 | caught |
| F16 physics.js:490, R1-29 search removed | Node 575/577: low-freeboard box | caught |
| F17 physics.js, end of range never taken as the maximum | none | survived (near-equivalent: the golden section converges to the end) |
| F18 physics.js, gzFlood always 0 | none | survived (R1-35) |
| F19 physics.js:391, trimUnstable never set | Node 576/577: sphere flag | caught |
| F20 physics.js, flag kept after a stable trim is found | none | survived (R1-35, Q4) |
| F21 physics.js:396, scan to ±28.6° | Node 574/577: cube and offset cube | caught |
| F22 physics.js:422, search at every angle | none | survived (equivalent: cost only) |
| E01 app.js:1044, Settle without the static solve (N21) | e2e 136/139: tender box, "did not converge" ×2 | caught |
| E02 app.js:1002, rest test speed only (N22) | none: 139/139 | survived (near-equivalent while the solve converges) |
| E03 app.js:647, "Opening under water" never given | e2e: missing end face reads "Unstable" | caught |
| E04 app.js:780, openings not sent to the workers | e2e: open-deck verdict "Stable", panel 81.1° | caught |
| E05 app.js:796, `sweep: false` | e2e 138/139: cube verdict without "worst of all heel directions … 35.3°" | caught (survived at 255c8b0) |
| E06 app.js:266, opening points not scaled | e2e 137/139: panel and Waves stage 45° for 32° | caught |
| E07 seakeeping.js:228, Waves range ignores flooding | e2e 138/139: "roll range of stability (81.1°" | caught (survived at 255c8b0) |
| E08 app.js:472, openDepth sign | e2e 137/139 | caught |
| G01 app.js, panel prints the maximum with flood 0 | none: 139/139 | survived (R1-35) |
| G02 app.js, free-trim note never shown | none: 139/139 | survived (R1-35) |

Totals:
- **Node:** 38 of 56 caught. Of the 18 that survive, 9 are equivalent or near-equivalent: C02, C10, C11, C15, C16,
  C25, F03, F17 and F22. The other 9 are R1-35: C34, F06, F08, F10, F11, F12, F14, F18 and F20.
- **e2e:** 7 of 10 caught. E02 is near-equivalent; G01 and G02 are R1-35.
- **Re-planted from earlier rounds:** N18 (C32) and N21 (E01) are still caught. Every R1-31 target is now caught.

## Checked and found sound

**Baselines**
- `validate-node fine`: 577/577 in 267.6 s (`$K/base_fine.txt`).
- `validate-proofs`: 20/20 (`$K/base_proofs.txt`).
- e2e UI part: 139/139, ALL PASSED (`$K/e2e_base.txt`). The new checks pass: the Waves-stage "roll range of stability
  (32°, … the range ends where an opening goes under water)", and the cube after Settle "vanishes at 35.3°".

**The verdict's sweep and other numbers that did not change**
- Corner-down cube: 35.2644–35.2655° fixed and 19.4712° free (asin(1/3)) at five yaws (`$K/r117.txt`).
- Square barge: 77.08° on the diagonal.
- Box: 90° every way, so the weakest axis keeps the wording.
- The cube's free-trim range over direction is unchanged and smooth (`$K/cubefree_az.txt`).
- The scow and wedge still match my bisection (`freetrim2.mjs`).

**Open hulls**
- Roll and pitch downflooding angles against closed forms: 48.3665°, 12.6804°, 32.005383° and 17.354025°.
- The open box's earliest flooding, which my Python puts at 15.182533° at 62.36°, is now the floodAny note. The note
  reads 15.2° at 60° from x: it comes from the 15° grid directions and is not refined, which is enough for a note.
- The barge test's reference, atan(1.125), is independent.

**Mesh repair**
- Every shared-edge geometry I could build gives the true volume.
- Every touching placement gives no overlap, and every coplanar overlap is found (R1-16, R1-26, R1-27 rows).
- Welding, voids and the parent-turn rule are unchanged (`weld.mjs`, `shells.mjs`).

**Cost on the 51k-triangle STEP sphere at fine quality, d43902d**

| Run | Fixed trim | Free trim |
| --- | --- | --- |
| Node single-threaded, G 0.05 m off centre (53 analyses) | 5.6 s | 35.0 s |
| Node single-threaded, G centred (25 analyses, no refinement) | 2.35 s | 12.9 s |
| App, idle 16-core machine, 6 workers | 2.6–2.7 s | 14.0–16.5 s |

The defender's figures (5.4 s and 29 s single-threaded) are within the machine-to-machine spread. At 255c8b0 the same
were 10.8 s and 441 s single-threaded, and 2.7 s and 111–113 s in the app.

**The new tests: independence and tolerances**
- The catamaran (26.78°) and square box (22.90°) are checked against [2D], to 10⁻⁶° and 0.01°.
- The sphere at 179.43° is a closed form, checked to 0.01°.
- The offset cube's two stable trims come from bisection on `solveWaterline`, to 10⁻⁶ rad.
- The deckhouse, touching-block and budget cases are closed-form volumes.
- The barge's 48.3665° is a closed form. Its other checks are inequalities that admit either my objective or the
  defender's (R1-32).
