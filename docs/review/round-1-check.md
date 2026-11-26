# Round 1 check: the fixes for R1-15 … R1-25 and R1-D1 (255c8b0)

Scripts and outputs are in `/home/duff/float-sim/.claude/review-scratch/check/` (called `$C` below; git-excluded).
The code was loaded from my worktree, `agent-a4346c395b65656ef`, detached at `255c8b0`. Where I compare with the previous
commit, the copy is `$C/old103/` (`git archive 103de4d js test`). Mutants ran in copies: `$C/mut3/<id>/` for Node and
`$C/e2e/<id>/` for e2e. My servers ran on ports 8791–8793 and were stopped by PID at the end. The only project file I
changed is this report. Every child process wrote its output to a file.

## Summary

I re-ran the evidence of every finding of my re-run against `255c8b0`, together with what the defender cites. I drove the
app in Chromium and planted 42 mutations on the new code: 34 for the Node suites and 8 for e2e. N18, N21 and N22 were
re-planted among them.

Baselines reproduced:
- `validate-node fine`: 549/549 (264 s, idle).
- `validate-proofs`: 20/20.
- e2e UI part (`E2E_SKIP_VALIDATE=1`): 137/137, "ALL PASSED" (11 min).
- `Mesh.lean` compiles from my worktree's copy.
- `validate-node coarse` gives the same 47,715 bytes and summary through a pipe as through a file.

Status of the twelve:
- **Closed (10):** R1-15, R1-17, R1-18, R1-19, R1-20, R1-21, R1-22, R1-23, R1-24 and R1-25.
- **Closed with a new finding (1):** R1-D1. The bug is fixed, but the fix brings a cost problem (R1-30).
- **Still open (1):** R1-16.

The fixes I could check against independent references are right:
- the downflooding angles of an open box, against my own box-clipping code: roll 32.0054°, pitch 17.3540°, worst
  direction 15.1825° at 62.36° from x;
- the corner-down cube's worst range: atan(1/√2) = 35.2644°, at five yaws;
- its free-trim worst range: asin(1/3) = 19.4712°, which is the edge-down equilibrium;
- the self-righting STEP sphere, and the sphere that capsizes at 170.54°;
- Settle's static solve, now caught by e2e (N21: the tender box ends at −6.9991° against −7.001683°).

Six new findings, two of them major:
- **R1-26 (major), a regression.** The contact-face pairing added for R1-16 breaks a correctly wound two-part mesh when
  the parts share an edge but not a whole face, as a deckhouse flush with the hull side does. The app then shows
  4 m³ instead of 12 m³, a centroid outside the body, and "Sinks". Whether it happens depends on which triangle comes
  first in the file. With the deckhouse inside out, the case R1-16 was about, it is still wrong in either file
  order.
- **R1-28 (major).** The verdict takes the downflooding angle in every heel direction, pitch included. An open-deck
  barge 40 × 8 × 6 m that floods at 48.4° in roll is called "Stable (small range)", because a direction 16° off pitch
  floods at 12.2°, where its righting arm is 9.9 m. The verdict cites IS Code A 2.2.2, which is a heel criterion.
- **R1-27 (minor).** Shells that only touch are reported as overlapping in 30 of 36 placements of a block on a deck or
  under a bottom. The edge/corner probe evaluates the winding number in the contact plane, where it is 0 or 1 by the
  sign of a zero.
- **R1-29 (minor).** When a range ends before the first 5° sample, the maximum is −∞. The verdict then says "peaks at
  0°", and the panel says "GZ is not positive at any heel angle", while GZ(2°) is +0.011 m.
- **R1-30 (minor).** The R1-D1 stable-root scan makes free trim 17× slower on the 51k-triangle sphere: the verdict
  takes 112 s in the app on an idle 16-core machine, against 2.7 s with fixed trim. Where it finds no stable root it
  keeps the energy maximum. The docs' "trim of least potential energy" is a local branch.
- **R1-31 (minor).** Several new thresholds and branches are not pinned by any test: 13 of the 34 Node mutants survive,
  and so do the app's sweep (E05) and the Waves-stage range with openings (E07).

Confidence:
- high in the downflooding angle itself, the sweep's result on closed bodies, the self-righting and neutral wording,
  the weld, the worker, Settle and the runners;
- low in the multi-part mesh repair (R1-26, R1-27);
- medium in the verdict's range for open hulls (R1-28).

## Findings re-checked

| Finding | Status | Evidence (command and output, or file:line) |
| --- | --- | --- |
| R1-15 open hulls past the downflooding angle | **Closed** (the downflooding angle is right; how the verdict uses it in every direction is R1-28, and a range ending before 5° is R1-29) | Blind: 4 × 2 × 1 m open box at T 0.4 m. With the bilge out, the submerged section at flooding is a triangle of area 1/(2t), so roll floods at atan(0.625) = 32.0054° and pitch at atan(0.3125) = 17.3540°. My own code, with no Float Sim code (`python3 -I $C/ref_flood.py`: corner inclusion–exclusion volume of a box under a plane, bisection), gives roll 32.00545, pitch 17.35359, and the worst direction at az 62.357° with 15.182533°. On the two axes my code is good only to about 10⁻⁴°: a zero component of the vertical makes its inclusion–exclusion cancel. The closed forms cover those axes. Float Sim (`node $C/r115.mjs`): 32.005383, 17.354025, and the worst direction at az 62.3457° with 15.182533°. Barge 40 × 8 × 6 m at T 2 m: blind atan(1.125) = 48.3665° and atan(0.225) = 12.6804°; Float Sim 48.3665° and 12.6804° (`$C/pitchflood.txt`). In the app (`$C/app_open.txt`), `box_nodeck.stl` gives a GZ panel that says "An opening goes under water at 32°", with the vanishing angle marked "as if closed". e2e 2d passes, including the missing end face ("Opening under water"). Mutants C12, C13, C14, C17, C21 and C28 are caught. C15 and C16 are equivalent (they change the bracket, not the root) |
| R1-16 inside-out part sharing an edge | **Still open** (R1-26) | The full-face cases are fixed. `node $C/nonmanifold.mjs` gives 16, 16, 16, 16 and 12 m³ (true 16 and 12) with the upper box turned. `node $C/shells.mjs` gives 6.5 m³ for the hollow box inverted through `repairMesh` alone, and 106.5 m³ for the raft with an inverted hollow box, 1 void. C03, C04, C05 and C06 are caught. Partial contact is not fixed: a deckhouse flush with the hull side and inside out gives 4 m³ for 12 in either file order, and a correctly wound pair breaks (R1-26). C02, which swaps the pairing sides, passes all 549 checks |
| R1-17 range direction set by round-off | **Closed** (the cost is in R1-30; combined with openings the sweep reaches pitch, R1-28) | Blind [SYM]: 35.2644°. `node $C/r117.mjs`, the app's logic over all directions, on the corner-down cube at yaws 0°, 7.8°, 13.3°, 29° and 44.5°: 35.2644, 35.2647, 35.2647, 35.2655 and 35.2644°. App after Settle (`$C/app_cube.txt`): "About the axis at 37.8° from x, the worst of all heel directions (fixed trim) … vanishes at 35.3°". Free trim: 19.4712° at every yaw. That is asin(1/3), and the attitude there is edge-down (body vertical (−0.70711, 0.70711, 5×10⁻⁷), `$C/cubefree.txt`). Square barge: worst 77.08° at the diagonal, roll 78.55°. Box: 90° in all 24 directions, so no refinement runs and the weakest axis keeps the wording at yaw 0°, 20° and 45°. C22, C23, C24 and C33 are caught; C25 is near-equivalent |
| R1-18 wording: self-righting, 92.5° "small", "Max GZ 0", neutral | **Closed** (the thresholds are not pinned, R1-31; the "not positive" text misfires when the range ends before 5°, R1-29) | (a) App, STEP sphere at normal quality with G 0.3 m low: "Stable and self-righting … stays positive all the way to 180° in every heel direction" (`$C/app_sphere.txt`); C19 is caught. (b) App raft: "Stable … vanishes at 92.4° … The righting arm peaks early, at 19.2° … (A 2.2.3)" (`$C/app_misc.txt`). Rafts 6 × 6 × 0.4 m and a 6 × 3 pontoon: Stable, with the early-peak note when the peak is below 25° (`$C/smallrange2.txt`). The catamaran cites A 2.2.2. (c) Yawed 4 × 2 × 2 m box about Weakest: "GZ is not positive at any heel angle about this axis." (d) Edge-down cube (`node $C/neutral2.mjs`): GM_min +2.8×10⁻¹⁷, −1.7×10⁻¹⁶ and +2.8×10⁻¹⁷ at yaw 0°, 10° and 33°; the summary is the same each time (neutral, loll 35.2644°, vanish 90°) and the verdict is Neutral; C20 is caught. The 30° rule follows from A 2.2.2 as worded |
| R1-19 crossing shells missed | **Closed** (the new false positives are R1-27) | `node $C/shells.mjs`: the two crossing 4 × 1 × 1 boxes give overlaps 2, in one STL and as two STEP solids. A cube poking out of a corner gives 2. e2e 2d (crossing STL) passes. The multi-body hint is back (`js/app.js:314`) |
| R1-20 proof assumptions overstated | **Closed** | `docs/validation-map.md` and the `Mesh.lean` docstring now say: "closed, embedded, outward-oriented"; the sums are integrals of the winding number; `Tetra` covers the volume only; `Balanced` holds on the welded mesh; and what is proved, in place of "proved correct". `lake env lean` on my worktree's `proofs/Proofs/Mesh.lean`: exit 0, no messages (`$C/lean_mesh.out`) |
| R1-21 weld on a grid | **Closed** | `node $C/weld.mjs`: open 0, misoriented 0, 1 closed shell (24 open edges and 6 shells at 103de4d). C01 (13 neighbour cells) is caught: "welds to the box's 8 corners" reads 10 |
| R1-22 nesting test on the main thread | **Closed** (Q1 on the budget) | The app starts `meshworker.js` on import (Playwright `worker` event, `$C/app_lowfb.txt`). `node $C/shellcost.mjs`: 16 shells × 3,968 triangles in 398 ms, 64 shells in 1,292 ms, against 835 and 12,154 ms in my re-run of 103de4d. Both now run off the page's thread |
| R1-23 Settle's static solve untested | **Closed** | E01 (N21 re-planted, `useFin = false`) fails 3 of 137 e2e checks (`$C/e2e_E01.txt`): the tender box reads "roll −6.9991°" against −7.001683° ± 2×10⁻⁴°, and two checks read "The static equilibrium solve did not converge…". Blind for 4b: the wall-sided equilibrium tan φ (0.01 + ½·0.8333 tan²φ) = 0.002 gives 7.0017°; neither the bilge (21.8°) nor the deck edge (31°) is reached. E02 (N22 re-planted) still passes 137/137. That is expected: while the solve converges it lands on the same attitude, as my re-run said |
| R1-24 runner output lost through a pipe | **Closed** | `$C/trunc/`: the old child (`process.exit(1)`) loses the summary at 20,000 lines when read at once (474,903 of 1,990,026 bytes), and everything when the reader is 200 ms or 2 s late. The new child (`process.stdout.write('', () => process.exit(1))`) delivers all bytes and the summary in all 9 cases, exit code 1 (`$C/trunc/trunc_out.txt`). The real runners (`node $C/pipecheck.mjs`, under load 19): `validate-node coarse` through a socketpair, read at once and 3 s late, gives 47,715 bytes and "452/452 checks passed", the same as to a file; `validate-proofs` gives 2,680 bytes and "20/20 passed". The callback exit is sound. `process.exitCode` would also have been enough here, but the defender's reason (Playwright handles that keep the process alive) is plausible, and the callback cannot drop data |
| R1-25 self-righting boundary untested | **Closed** | C32 (N18 re-planted, `end === null \|\| end > 170`) is caught by "STEP sphere, G 0.3 m low and 0.05 m off the centre … verdict: not self-righting", which reads true for false. App: "vanishes at 170.5°" (blind 180° − atan(0.05/0.3) = 170.5377°) |
| R1-D1 free trim at an energy maximum | **Closed** for the bug; its cost and residue are R1-30 | `node $C/cubefree_az.mjs`: the cube's free-trim range against direction, every 2.5°, is smooth and 3-fold symmetric, from 19.471° to 35.264° (fixed trim: 35.264° to 54.736°). The jump between neighbouring directions is gone. `node $C/freetrim2.mjs`: the scow and wedge still match my own bisection, to 1.4×10⁻¹¹ and 3×10⁻¹² m. C29 and C31 are caught. C30 (keep the higher of the two stable roots) survives, because the test's two roots are mirror images of equal energy |

## New findings

### R1-26 The contact-face pairing breaks correctly wound parts that share an edge but not a whole face, and R1-16 stays wrong there
- Severity: major. It is a regression against 103de4d on correctly wound files.
- Kind: code bug.
- Claim challenged: the ledger's R1-16 fix says "each contact patch is joined to the face on a fixed side of its plane
  … so each part is closed again" (`js/meshcheck.js:208-249`). README:143 says inside-out shells are turned.
- Evidence: blind: a hull 4 × 2 × 1 m at [0,4]×[−1,1]×[0,1] and a deckhouse 4 × 1 × 1 m at [0,4]×[0,1]×[1,2], flush
  with the +y side. They share one edge, (0,1,1)–(4,1,1), used by four triangles. The union is 12 m³. With 6000 kg the
  body floats at draft 0.75 m. `node $C/contact2.mjs`, `repairMesh` and the app's two import paths:
  ```
  hull + flush deckhouse, both outward, hull first       V 4.0000 (true 12) shells 1 flipped 12 overlaps 0   <-- WRONG
  hull + flush deckhouse, both outward, deckhouse first  V 12.0000 (true 12) shells 2 overlaps 2 (false, see R1-27)
  hull + flush deckhouse inside out, hull first          V 4.0000 (true 12)   <-- WRONG
  hull + flush deckhouse inside out, deckhouse first     V 4.0000 (true 12)   <-- WRONG
  STL path, both outward, hull first                     V 4.0000 (true 12) flipped 12
  two solids (STEP path), both outward, hull first       V 4.0000 (true 12) flipped 12
  hull's triangles rotated so its first triangle is the bottom (normal −z): V 4; any other face first: V 12, overlaps 2
  ```
  At 103de4d (`$C/contact2_old103.txt`), both correctly wound orders give 12 m³ with no overlap. In the app,
  `hull_deckhouse_flush.stl` at 6000 kg (`$C/app_open.txt`) reads "Enclosed volume 4 m³ \| Centroid (2, −0.5, −0.5) \|
  Watertight yes \| Face winding consistent after repair \| 12 faces wound against their neighbours … were re-oriented on
  import", with the verdict "Sinks".
  Cause:
  - A "patch" is the set of triangles joined through edges used exactly twice (`js/meshcheck.js:213-215`).
  - When the two contact faces do not share their whole boundary, the patch is the whole part, not a flat contact face.
  - `patchN.set(pid, nrm(pid))` (`:238`) then takes the normal of the part's lowest-numbered triangle as "the plane".
  - In my files that triangle is the bottom face (−z), so the side rule (`:241-247`) links the hull's deck triangle
    to the deckhouse's side face, and the deckhouse's bottom triangle to the hull's side face.
  - Propagation then flips 12 faces.
  - C02 (the two sides swapped) passes all 549 checks, so no test can tell the rule's side choice. In every test the
    contact faces coincide, so either pairing closes both parts. On the six deckhouse cases (both parts outward, the
    deckhouse inside out, the hull inside out, each in two file orders), the fixed code is right in 3 and C02 is right
    in the other 3: the rule is a coin toss here.
- Why it matters: a deckhouse, a box keel or a pontoon flush with a hull side, exported as separate solids that share
  vertices along the edge, is a plausible export. A correctly wound file then gets a third of its volume and "Sinks",
  and the only hint is the re-orientation note. An inside-out deckhouse in that geometry, the case R1-16 was
  about, is still wrong in both file orders; an inside-out hull comes out right, with a false overlap.
- What would resolve it:
  - At a four-use edge, pair each coplanar (tie) triangle with the side triangle that lies in the same patch, when
    there is one. With partial contact the patch is the part, and it already holds its own side face.
  - Keep the fixed-side rule only for isolated contact patches.
  - Test partial contact, both parts outward and each one inside out, in both file orders and with the triangles
    rotated, through `repairMesh` and `prepareMesh`.

### R1-27 Shells that only touch are reported as overlapping, because the probe evaluates the winding number in the contact plane
- Severity: minor (a false warning; the volume is right).
- Kind: code bug / validation gap.
- Claim challenged: the ledger's R1-19 fix says a crossing "through a face's edge or corner is decided by the winding
  number just past it, so coplanar contact and grazing do not count" (`js/meshcheck.js:390-398`). The test "stacked
  boxes that only touch: no overlap" (`test/validate-stability.js`, R1-19 block) covers only full-face contact.
- Evidence:
  - `node $C/touch.mjs`: a 4 × 2 × 1 m box with a block standing on its deck or hanging under its bottom, touching
    only, at 9 sizes and positions × 2 file orders. 30 of the 36 cases report "overlaps 2" (all should be 0). 103de4d
    gives 24 of 36 with its centroid samples (`$C/touch_old103.txt`).
  - App, `deckhouse_on_deck.stl`: "2 shells overlap another shell: the overlapping volume is counted twice. Merge the
    solids (Boolean union) in CAD."
  - An instrumented copy (`node $C/touch_why.mjs`) shows the path. The hull's deck diagonal (0,1,1)→(4,−1,1) lies in
    the contact plane and crosses the block's side face on its bottom edge, so `segTri` returns 1. The probe point
    (2.9991, −0.4996, 1) also lies in the contact plane, and its winding number is 1.0000000000000002.
  - `windingNumber` at points exactly on a face of a box gives 0.99999999999999989, 1.0000000000000002 and 1.0,
    never ½: atan2(±0, negative) is ±π by the sign of a zero determinant.
  - The same accident is what finds genuine coplanar overlaps. Two 4 × 2 × 1 m blocks overlapping 1 m along their
    length (same section) are reported, but with C08 (no probe) that case gives overlaps 0 (`$C/contact2.txt`).
  - C08 (edge/corner hits never probed) and C09 (probe threshold 1.5) both pass all 549 checks, so the probe path is
    untested.
- Why it matters: a deckhouse, a keel block or a fender modelled as a separate solid touching the hull is the common
  multi-body case. The user is told to merge solids that do not overlap, and real coplanar overlaps are found by
  round-off.
- What would resolve it: never classify by the winding number at a point on a face of the other shell. For example,
  when the segment lies in the plane of a face of b, probe just off that plane on both sides and count a crossing
  only if b's inside is entered off the plane. Add the touching blocks (on a deck, under a bottom, flush with a side)
  and the same-section overlap to `validate-stability`.

### R1-28 The verdict takes the downflooding angle in every heel direction, pitch included, and calls ordinary open hulls "small range"
- Severity: major (a validation claim that does not hold for the usual open-deck export).
- Kind: code bug / literature discrepancy.
- Claim challenged: `worstHeelRange` (`js/physics.js:528-558`, called from `js/app.js:792-796`) takes the earliest end
  of the range over all 52 directions, and `gzSummary`'s `end` includes the downflooding angle (`:476`).
  `stabilityVerdict` (`:636-640`) then says "small range … The IMO intact stability code asks for a righting arm of at
  least 0.2 m at 30° or more (2008 IS Code A 2.2.2)".
- Evidence: blind: an open-deck barge 40 × 8 × 6 m at T 2 m, KG 3 m, floods at atan(1.125) = 48.37° in roll and at
  atan(0.225) = 12.68° in pitch. `node $C/pitchflood.mjs`:
  ```
  about az 0: flood 48.3665 vanish 75.519 GZ at the flood angle 0.729 m
  about az 90: flood 12.6804 vanish 87.803 GZ at the flood angle 10.621 m
  verdict range: az 74.14 end 12.1875 flood 12.1875; GZ at that angle 9.902 m
  ok: Stable at small angles, but the range is small. About the axis at 74.1° from x … an opening goes under water at
  12.2° … so a heel past 12.2° floods it. The IMO intact stability code asks for a righting arm of at least 0.2 m at 30°
  or more (2008 IS Code A 2.2.2) … The righting arm peaks early, at 12.2° …
  ```
  - The app gives the same verdict for `barge40_nodeck.stl`, while its roll GZ panel says the opening goes under at
    48.4° (`$C/app_open.txt`).
  - The 4 × 2 × 1 m open box floods at 32.0° in roll, which is past 30°. It is called "Stable (small range)" from the
    direction 62.3° from x, at 15.2°.
  - The 2008 IS Code (resolution MSC.267(85), MSC 85/26/Add.1 Annex 2, Part A) is about heel, not pitch. I read the
    text in an open copy (https://personales.gestion.unican.es/martinji/Archivos/267(85)_2008_IS_Code.pdf, extracted
    to `$C/dl/is2008.txt`, lines 549–567):
    - 2.2.1, footnote 5: "θf is an angle of heel at which openings in the hull, superstructures or deckhouses which
      cannot be closed weathertight immerse".
    - 2.2.2: "The righting lever GZ shall be at least 0.2 m at an angle of heel equal to or greater than 30°".
    - 2.2.3: "The maximum righting lever shall occur at an angle of heel not less than 25°".
  - A slender open hull floods in pitch at about atan(freeboard / half-length), so almost any open-deck ship-shaped
    export is labelled "small range", with a GZ of metres at the end of that "range".
- Why it matters: open-deck hulls are the case R1-15 was filed for. The verdict's level and its IS Code citation are
  now driven by the pitch direction, where no realistic heeling moment acts, and they contradict the roll panel under
  them. Closed bodies are not affected in the same way: the box with KG 0.3 m ends in pitch at 99.9°, which is real.
- What would resolve it: decide the scope the verdict means.
  - One option: use the downflooding angle only for heel directions near the weakest axis (or roll), and report the
    worst direction's flooding angle as a separate note.
  - Another: end the range at flooding only where the GZ there is small.
  - In any case, apply A 2.2.2's wording only to heel.
  - Add an open-deck barge to `validate-stability`.

### R1-29 A range that ends before the first 5° sample has no maximum: "peaks at 0°" and "GZ is not positive at any heel angle"
- Severity: minor.
- Kind: code bug.
- Claim challenged: `gzSummary` takes the maximum over samples with 0 < deg ≤ end (`js/physics.js:478-480`). The
  fallback for "no sample in the range" is skipped when `flood` is set (`:480`). `drawGZChart` prints "GZ is not
  positive at any heel angle about this axis" when `max ≤ 0` (`js/app.js:861-862`).
- Evidence: blind: the open box at 7600 kg (T 0.95 m, freeboard 0.05 m) floods in roll at atan(0.05) = 2.862°, with
  GM_T 0.326 m > 0. `node $C/lowfb.mjs`:
  ```
  about x: flood 2.8624 end 2.8624 max -Infinity maxDeg 0 unstable false; GZ(2 deg) = 0.01138
  verdict: … the righting arm peaks at 0° and an opening goes under water at 1.3° …
  ```
  The app (`$C/app_lowfb.txt`) shows the same verdict, and a GZ panel that reads "GZ is not positive at any heel angle
  about this axis. … An opening goes under water at 2.9°".
- Why it matters: a deep-laden open boat or pontoon with little freeboard gets a self-contradictory panel. The note
  was added for R1-18(c) to avoid exactly that kind of statement.
- What would resolve it: when no sample lies in (0, end], search the maximum on [0, end] with the refinement already
  used, or take it at `end`. Test a range ending before 5°.

### R1-30 The R1-D1 stable-root scan makes free trim 17× slower on compact bodies, and keeps the energy maximum when it finds no stable root
- Severity: minor.
- Kind: code bug (cost) / documentation.
- Claim challenged:
  - `gzAt` (`js/physics.js:383-401`) scans up to 60 steps of 0.05 rad each way for a stable root whenever the
    converged trim has a falling slope, and keeps the converged one if none is found.
  - README:34 says "Free trim re-trims the body at every heel angle to the trim of least potential energy".
  - `docs/validation-map.md:25` says free trim "is the trim of least energy".
- Evidence:
  - Sphere, 51k triangles, G 0.3 m low and 0.05 m off centre, instrumented copy (`node $C/fttime.mjs`). From 85° of
    heel, G is above the centre, so every trim lowers it and trim 0 is an energy maximum. The stable trim is ±180°,
    outside the ±170° scan. Each angle then costs 124 waterline solves instead of 4, and the code keeps trim 0:
    ```
    heel 85: ev 124, trim 0.0000°, … stable-root step taken (along 1.79e-14 -> -2.36e-6 at +1e-4 rad)
    … the same at every 5° to 180°
    ```
  - `$C/fttime2.txt`: a free-trim `gzAnalysis` on that sphere takes 538 ms at 103de4d and 9,137 ms at 255c8b0, with
    the same GZ (for a sphere the trim does not change GZ). With G centred: 443 ms and 8,363 ms.
  - The sweep, single-threaded (`node $C/sweepcost.mjs`), on 53 analyses:

    | Trim | Per analysis | Sweep |
    | --- | --- | --- |
    | Fixed | 204 ms | 10.8 s |
    | Free | 8.3 s | 441 s |

  - In the app on an idle machine (16 cores, 6 GZ workers; `node $C/app_check.mjs timing`, `$C/app_timing.txt`), the
    verdict's range arrives 2.7 s after a CoG change with fixed trim. With free trim it arrives after 112.7 s (when
    switched on) and 111.1 s (after the next CoG change).
  - With my Node mutants running at the same time it took 125.8 s at fine quality and 25.5 s at normal
    (`$C/app_sphere.txt`).
  - The Waves stage calls `gzAnalysis` on the page's own thread (`js/seakeeping.js:226`), so with free trim it now
    freezes the page for about 9 s on this mesh.
  - On hulls the step runs in the pitch-like directions the sweep now visits (`$C/ftcount.txt`): the scow heeled about
    y needs 5,314 waterline solves against 73 at fixed trim, and the wedge 6,151.
  - "Least potential energy": the curve follows the local minimum reached from the previous angle's trim. On the
    corner-down cube, 333 of 840 samples (24 directions × 35 heels) are not at the trim of least energy over all trims
    (`$C/ftglobal.txt`). For example, at az −58.2° and 15° of heel the code is at trim −8.10° with U 0.235319, while
    the least is at −108.96° with U 0.234602. Following the branch is sensible; it is not what the docs say.
- Why it matters: free trim is the safer curve the project recommends, and on a compact or large body it now leaves
  the verdict "being worked out" for about two minutes. Where no stable root is found, the curve silently uses the energy
  maximum, which the map says it never does.
- What would resolve it:
  - Bound the cost: stop the scan once U has risen past its start, or scan only to ±90°.
  - Report or accept the unstable trim explicitly, instead of keeping it silently.
  - Consider moving the Waves-stage call to a worker.
  - Word README:34 and the map as "the local energy minimum followed from the upright trim".

### R1-31 New thresholds and the app's sweep are not pinned by any test
- Severity: minor.
- Kind: validation gap.
- Claim challenged: the ledger says "Each new test was checked against a mutant that restores the old behaviour".
  That is true for those mutants. Changing the new thresholds or branches is not caught.
- Evidence: these mutants pass all 549 Node checks and 20/20 proofs (table below):
  - C26: small range below 25° instead of 30°. No test has a range ending between 25° and 30°.
  - C27: early-peak note below 20° instead of 25°. The raft peaks at 19.2°.
  - C18: 180° tolerance 1° instead of 0.1°. No range ends between 179° and 179.9°.
  - C30: the stable root of more energy is kept. The test's two roots are mirror images.
  - C10 and C11: nesting samples outside the faces; a single sample is enough.
  - C02, C08, C09, C34: the contact pairing and the probe (R1-26, R1-27).
  - E05: the app never runs the sweep and uses both senses about the weakest axis. It passes all 137 e2e checks
    (`$C/e2e_E05.txt`). No Node suite loads `js/app.js`, and `validate-stability`'s `range()` (`:211-219`)
    re-implements the app's logic rather than calling it.
  - E07: the Waves-stage range ignores the downflooding angle (`js/seakeeping.js:228`). It passes all 137 e2e checks.
- Why it matters: the R1-18 wording and the R1-17 sweep could regress without a failing test, and the app's sweep is
  covered only by a Node copy of its logic.
- What would resolve it:
  - Add a range ending between 25° and 30°, a peak between 20° and 25°, and an asymmetric case with two stable trims
    of different energy.
  - Add an e2e check that reads the verdict's worst direction on the corner-down cube ("35.3°" after Settle), and a
    Waves-stage range on the open-deck STL.

## Questions for the defender

- Q1 (R1-22 budget): when the work budget runs out, the remaining pairs get no nesting test (`js/meshcheck.js:407-422`).
  An inward inner shell that was not reached then has depth 0 and is turned into a solid (`:434`), but the message
  says only "overlapping shells may be missed". Is that intended? I did not build a case that exhausts 4×10⁸
  operations.
- Q2: if a GZ worker fails, the pool falls back to the page's own thread for the whole sweep (`js/app.js`
  `gzRunner`). With free trim on the 51k sphere that is about 441 s of frozen page (R1-30). Should the fallback compute
  only the weakest axis?
- Q3: `report.openPts` takes only edges used once (`js/meshcheck.js`, `e.f + e.b === 1`). An edge used three times is
  counted as open by `meshCheck`, but it gives no downflooding point. Intended?

## Mutation testing

Node: `node test/validate-node.mjs fine` (549 checks) and `node test/validate-proofs.mjs` (20) in each copy, six at a time
(driver `$C/mutate3.mjs`, list `$C/mutations3.mjs`, results `$C/mut3-results.json`, log `$C/mut3-log.txt`). e2e:
`E2E_SKIP_VALIDATE=1 node test/e2e-browser.mjs` (137 checks) against a server started from each full copy
(`$C/mke3.sh`, `$C/e2e_batch.sh`, output `$C/e2e_<id>.txt`). Each `find` string occurs exactly once in its file.

| Mutation (file:line, change) | Caught by | Survived? |
| --- | --- | --- |
| C01 meshcheck.js:46, weld searches 13 of 26 neighbour cells | Node 547/549: weld across a cell boundary (10 vertices for 8; open edges) | caught |
| C02 meshcheck.js:243, contact pairing sides swapped | none: 549/549, 20/20 | survived (equivalent on full-face contact; decides R1-26's partial contact) |
| C03 meshcheck.js:236, patches not ordered by number | Node 548/549: stacked boxes, triangles shuffled (order 2): 4 m³ for 12 | caught |
| C04 meshcheck.js:232, contact pairing disabled | Node 540/549: stacked boxes 16 and 12 m³ (0 and 4), identical contact triangles | caught |
| C05 meshcheck.js:434, parent-turn rule removed | Node 546/549: raft + hollow box 109.5 for 106.5 m³; box/void/core 9.6 for 6.6 | caught |
| C06 meshcheck.js:427, shells turned innermost first | Node 546/549: the same three | caught |
| C07 meshcheck.js:169, a segment ending on the plane can cross | Node 547/549: stacked boxes "no overlap or void reported" | caught |
| C08 meshcheck.js:177, edge/corner hits never probed | none: 549/549 | survived (removes R1-27's false overlaps and the coplanar true one; R1-27) |
| C09 meshcheck.js:398, probe threshold 0.5 → 1.5 | none: 549/549 | survived (as C08) |
| C10 meshcheck.js:343, nesting samples just outside the faces | none: 549/549 | survived (near-equivalent on the tests) |
| C11 meshcheck.js:419, one sample inside is enough for nesting | none: 549/549 | survived |
| C12 physics.js:345, opening depth sign | Node 546/549: open-deck box flood 0° for 32.0054°; verdict | caught |
| C13 physics.js:345, opening height from R's y row | Node 547/549: open-deck box flood vs [2D] | caught |
| C14 physics.js:513, opening under water at the start ignored | Node 548/549: missing end face, verdict bad | caught |
| C15 physics.js:523, flood from the dry end of the bracket | none | survived (equivalent: the bracket is 10⁻⁹° wide) |
| C16 physics.js:511, "wet" sample only 10⁻³ of the size under | none | survived (equivalent: it changes the bracket, not the root) |
| C17 physics.js:476, end ignores the flood angle | Node 544/549: open-deck box range, maximum, verdict | caught |
| C18 physics.js:475, 180° tolerance 1° | none | survived (R1-31) |
| C19 physics.js:475, no 180° tolerance | Node 547/549: STEP sphere G 0.3 m low not self-righting | caught |
| C20 physics.js:435, no neutral band | Node 547/549: edge-down cube neutral, same summary at three yaws | caught |
| C21 physics.js:478, maximum searched past the flood angle | Node 548/549: "the maximum is taken inside the range" | caught |
| C22 physics.js:537, no refinement rounds | Node 547/549: cube at yaw 13.3°: 36.617° for 35.2644° | caught |
| C23 physics.js:537, 45° grid | Node 548/549: cube yaw 13.3°: 35.2708° (tolerance 0.005°) | caught |
| C24 physics.js:546, ties go to the last direction | Node 547/549: box "about the weakest axis", same verdict at three yaws | caught |
| C25 physics.js:550, refinement grid half as wide | none | survived (near-equivalent within 0.005°) |
| C26 physics.js:636, small range below 25° | none | survived (R1-31) |
| C27 physics.js:632, early-peak note below 20° | none | survived (R1-31) |
| C28 physics.js:634, opening exactly at the start not bad | Node 548/549: missing end face, verdict bad | caught |
| C29 physics.js:386, stable-root step never taken (R1-D1 undone) | Node 547/549: cube free trim not a local minimum; 0 of 3 below trim 0 | caught |
| C30 physics.js:400, stable root of most energy kept | none | survived (the test's roots have equal energy; R1-31) |
| C31 physics.js:391, stable-root scan in 0.5 rad steps | Node 547/549: cube free trim, 1 of 3 below trim 0 | caught |
| C32 physics.js:633, range past 170° self-righting (N18 re-planted) | Node 548/549: off-centre STEP sphere "not self-righting" reads true | caught |
| C33 physics.js:545, spread never detected | Node 547/549: cube yaw 13.3°: 36.617° | caught |
| C34 meshcheck.js:241, no opposite-sides check in the pairing | none | survived (no test has both side faces on one side) |
| E01 app.js:1044, Settle never uses the static solve (N21 re-planted) | e2e 134/137: tender box −6.9991° (4b), "did not converge" (4b, 5) | caught |
| E02 app.js:1002, Settle rest test speed only (N22 re-planted) | none: e2e 137/137 (`$C/e2e_E02.txt`) | survived (near-equivalent while the static solve converges: it then lands on the same attitude, as in my re-run) |
| E03 app.js:647, "Opening under water" never given | e2e 136/137: missing end face reads "Unstable" for "Opening under water" | caught |
| E04 app.js:780, openings not sent to the GZ workers | e2e 135/137: open-deck verdict "Stable" with no flooding; roll panel 81.1° for 32° | caught |
| E05 app.js:792, no sweep (both senses about the weakest axis) | none: e2e 137/137 (`$C/e2e_E05.txt`) | survived (R1-31) |
| E06 app.js:266, opening points not scaled to metres | e2e 136/137: roll panel floods at 45° for 32° | caught |
| E07 seakeeping.js:228, Waves-stage range ignores the flood angle | none: e2e 137/137 (`$C/e2e_E07.txt`) | survived (no test runs the Waves stage on a mesh with openings; R1-31) |
| E08 app.js:472, openDepth sign | e2e: open-deck verdict reads "Opening under water"; missing end face reads "Unstable" (2 fails) | caught |

Node totals: 21 of the 34 Node mutants are caught. Of the 13 that survive:
- C15, C16 and C25 are equivalent or near-equivalent;
- C02, C08, C09 and C34 sit in the code of R1-26 and R1-27;
- C10, C11, C18, C26, C27 and C30 are thresholds or branches with no test (R1-31).

N18 (C32) and N21 (E01) are now caught.

e2e totals: E01, E03, E04, E06 and E08 are caught. Three survive:
- E02 (N22) is near-equivalent;
- E05 (the app's sweep) and E07 (the Waves-stage range with openings) are untested (R1-31).

## Checked and found sound

**Baselines**
- `validate-node fine`: 549/549 in 263.9 s (`$C/base_fine.txt`).
- `validate-proofs`: 20/20 (`$C/base_proofs.txt`).
- e2e UI part: 137/137, ALL PASSED, 11 min 7 s (`$C/e2e_base.txt`). The new checks pass: 2d (open-deck STL, missing end
  face, crossing STL), 4b (tender box −7.0017°, "Finished with a static equilibrium solve", moved 0.003°) and section
  5's static-solve check.
- `Mesh.lean` compiles from my worktree's copy. The Python ports were not re-run: no Python or hydrostatics core file
  changed in 255c8b0.

**The downflooding angle**
- It is right about every axis I checked, against my own code with no Float Sim code (R1-15 row).
- The opening points come from the welded one-use edges and move with the body: `rescaleModel` and `relGeometry` in
  `js/app.js`, and `transformTris` with any length divisible by 3.
- The STEP spheres have no opening points: the 2 degenerate pole triangles are left out (`$C/sweepcost.txt`: openPts 0).
- The Waves stage passes the opening points in the run's frame (`js/seakeeping.js:225`).

**The sweep (closed bodies)**
- `worstHeelRange` finds the corner-down cube's edge-down limit, 35.2644°, to 0.0011° at five yaws, and its free-trim
  limit, asin(1/3).
- It leaves the box on the weakest axis (no spread, no refinement).
- It picks pitch for the box with KG 0.3 m: 99.9°, against [2D], in the defender's test, which passes.
- The tie rule (strictly earlier by 10⁻⁶°) and the weakest flag (`rel` within 10⁻⁹ of 0° or 180°) behave as documented.
- The sweep over all directions, rather than only near-isotropic waterplanes, is sound for closed bodies: the worst
  direction need not be the weakest axis (the box with KG 0.3 m). Its problem is the open-hull case, R1-28.

**Sweep cost on the 51k-triangle STEP sphere at fine quality** (Node, single-threaded; `$C/sweepcost.txt`):

| Trim | G 0.05 m off centre (53 analyses) | G centred (25, no refinement) |
| --- | --- | --- |
| Fixed | 10.8 s | 2.4 s |
| Free | 441 s | 128 s |

With 6 workers the sweep runs in 12 sequential waves (24 directions over 6 workers, 7 rounds of 4, 1 final). That is
about 2.4 s with fixed trim and about 100 s with free trim.

Measured in the app on an idle 16-core machine (`$C/app_timing.txt`): 2.7 s with fixed trim, 111–113 s with free
trim. The free-trim figure is the R1-30 regression; at 103de4d a free-trim analysis took 0.54 s, which would make the
sweep about 7 s.

**Wording and verdict**
- "Self-righting" with the 0.1° tolerance on the STEP sphere: in the app at normal quality, and in `validate-stability`
  at fine.
- 170.5° for the off-centre sphere.
- The 30° rule is a correct consequence of A 2.2.2's angle, and the early-peak note follows A 2.2.3.
- Neutral is read the same at three yaws.
- "GZ is not positive" for the yawed 4 × 2 × 2 m box.
- `f1` no longer prints "-0".

**Free trim**
- It matches my bisection on the scow and wedge (1.4×10⁻¹¹ m).
- The cube's free-trim range is smooth and symmetric over direction.
- The R1-D1 test's reference (energy from `solveWaterline`) is partly independent, as before.

**Mesh repair and welding**
- The weld joins copies across cell boundaries and keeps points 1.5 tol apart.
- The full-face contact cases (identical or differently triangulated, shuffled, either file order) give the true
  volume.
- The hollow inverted body and the box/void/core nest are right through `repairMesh` alone.

**Runners and Settle**
- The runners exit only after their output is written (R1-24 row).
- Settle's static solve is required by e2e and is caught when removed (E01).

**New tests: independence and tolerances**
- [SYM] 35.2644° is a geometric fact.
- The [2D] downflooding depth in the test is independent code. Float Sim matches the closed form atan(0.625) to
  10⁻⁶°, and my Python matches Float Sim in the worst direction to 10⁻⁶°.
- The off-centre sphere's 180° − atan(0.05/0.3) is a closed form.
- The stacked-box volumes are closed forms.
- The tolerances (10⁻⁶° on exact sections, 0.005° on the cube's sweep, 0.01° on a faceted sphere) are justified by
  what each case can reach.
