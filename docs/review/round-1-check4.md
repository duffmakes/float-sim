# Round 1 fourth check: the fixes for R1-36, R1-37, R1-38 and Q6 (78eb7ce)

Scripts and outputs are in `/home/duff/float-sim/.claude/review-scratch/check4/` (called `$K4` below; git-excluded).
The code was loaded from my worktree, `agent-a4346c395b65656ef`, detached at `78eb7ce`. Mutants ran in copies:
`$K4/mut3/<id>/` for Node and `$K4/e2e/<id>/` for e2e. The copies hold `js`, `test` and `proofs/expected.json` only, no
other part of `proofs/`. My servers ran on ports 8791–8793 and were stopped by PID. The only project file I changed is
this report. Every child process wrote its output to a file.

Two choices are settled by the owner, so this report checks only how the code applies them:
- the least-moment criterion for the verdict's range (R1-28);
- the 0.1 % band within which arms count as the same moment (R1-36).

## Summary

**Everything closes.** R1-36, R1-37, R1-38 and Q6 are closed. I found no new problems. From my side round 1 is done,
and the round-1 PR can open.

I re-ran the evidence of my third check against `78eb7ce` and added my own continuation of the free-trim branch, in
0.002° steps, for the pontoon, the closed barge and the 20 m hull heeled in pitch. I re-planted the mutations of the
last check (with C22, C23, H07 and H12 moved to their new places) and planted 9 new ones on the new code (I01–I09).

Baselines reproduced:
- `validate-node fine`: 599/599.
- `validate-proofs`: 20/20.
- e2e UI part (`E2E_SKIP_VALIDATE=1`): 142/142, "ALL PASSED". The defender's 145 includes the validation page.
- No Lean or Python code changed.

What the fixes now do:
- **The off-centre sphere (R1-36).** The verdict reads 170.536–170.538° at all three mesh qualities, against
  180° − atan(0.05/0.3) = 170.5377°, and 179.426–179.427° against 179.4271°. The false "larger heeling moment" note is
  gone.
- **The cube's tangency (R1-37).** The free-trim zero band no longer moves it: 19.471238° against
  asin(1/3) = 19.471221°.
- **The band's own case.** The pontoon and the barge heeled in pitch with free trim end where they lie on their sides:
  12.9872° and 10.2302°. My 0.002° continuations give 12.986–12.988° and 10.230–10.232°, and neither end is called a
  fold.
- **Mutations.** 63 of 75 Node mutants and 9 of 11 e2e mutants are caught. Every survivor is equivalent or
  near-equivalent, as checked on my cases.

Confidence: high in everything round 1 covers, with one disclosed limitation. Where a free-trim branch ends at a
shallow fold (the 20 m hull heeled in pitch), the fold's angle depends on the continuation step. It does not change
any verdict.

## Findings re-checked

| Finding | Status | Evidence (command and output, or file:line) |
| --- | --- | --- |
| R1-36 ties broken by faceting noise; a false "larger heeling moment" note | **Closed** (the 0.1 % band is the owner's) | `js/physics.js` `worstHeelRange`: among the directions tried, those within `same` = 10⁻³ of the least arm are the same moment, and the soonest end of those is taken. `node $K4/spheretie.mjs` at coarse, normal and fine quality, G 0.05 m off: 170.536°, 170.537°, 170.538° about x (blind 170.5377°), no note; G 3 mm off: 179.426–179.427° (blind 179.4271°). The note can now appear only when the earliest end's arm is more than 0.1 % above the least: a direction within 0.1 % with an earlier end would have been taken. Side effects, all sooner and all within 0.1 % of the least arm (`$K4/r_kg03.txt`, `r_pitchflood.txt`, `r_r128.txt`, `r_freecap.txt`): <br>– barge 48.138° about −0.06° fixed, 48.073° about −5.0° free; <br>– box with KG 0.3 m 112.3228° about −0.556° (arm 1.000067 × roll's; roll 112.3248°), with pitch's 99.9° as a note; <br>– open 4 × 2 × 1 m box 28.336° about −3.9° (28.787° before); <br>– open 20 m hull with free trim 31.131° about −8.3° (31.48° before); <br>– closed 20 m hull with free trim 78.54° about −1.7°. <br>With free trim the sphere reads 177.0° about 71.6° (`$K4/r_spherefree_normal.txt`). That is the rule applied correctly: in free trim the arm does vary with direction, 0.30024 m at 71.6° against 0.30414 m about x, 1.3 % more, so there the note's "larger heeling moment" is true. I01 (no band), I02 (1 %) and I03 (latest end) are caught |
| R1-37 the free-trim zero band moves tangent vanishing angles | **Closed** | The band is now 10⁻⁵ of the size, applied only where a sample and the next are both inside it (`js/physics.js` `gzSummary`, `gzAnalysis`). `node $K4/cubefold.mjs`: the cube about 90° with free trim vanishes at 19.471238° (asin(1/3) = 19.471221°). The cube's free-trim ranges are back at 31.483°, 35.264° and 19.471° (`$K4/r_cubefree_az.txt`). `node $K4/pitchfree.mjs`, my own 0.002° continuation of the free-trim branch: <br>– pontoon 10 × 2 × 1 m about y: gzAnalysis 12.9872°, not a fold; my continuation reaches 90° of trim between 12.986° and 12.988°, where GZ falls from 3.1×10⁻² to 1.8×10⁻⁹ m; <br>– closed barge about y: 10.2302°, not a fold; my continuation 10.230–10.232°; <br>– 20 m hull about y: a fold at 13.853°; my continuation falls off the branch between 13.144° and 13.146° (GZ 1.81 → −4.73 m, trim −62.9° → −154.5°). <br>So the fold's angle depends on the step (the defender reports 14.1°, 14.9° and 13.1° for 0.25°, 0.05° and 0.01°), as disclosed, and the verdict uses roll there anyway. The fold test's square-root rule keeps the pontoon and the barge from being called folds. I04 (band on single samples), I05 (band 10⁻⁹), I06 (band 10⁻³), I08 (no band floor), I09 (stretch looking back) and H12 (no band) are caught. I07 (no ratio term) is near-equivalent: it gives the same flags on all my cases |
| R1-38 untested new paths; H15 not equivalent | **Closed** | Now caught: H15 (the corner block), H08 and H10 (the 20 m hull pitched with free trim), H09 (the pontoon's "not a fold"), H12, H13 (the verdict's fold wording) and G03 (e2e: "the GZ panel says GZ jumps at the end of the range", on the slender box). H11 (no re-search) gives the same results on my cases (`pitchfree.mjs` on its copy), so I accept it as near-equivalent: no body I know gets a stable trim back after a stretch with none |
| Q6 what the free-trim band is for | **Closed** | Answered with a test: a body that turns 90° in trim (the pontoon, and the barge, whose GZ residue there is 1.4×10⁻⁴ m), checked against a 0.002° continuation. My own continuations agree |

## New findings

None.

## Mutation testing

Node: `node test/validate-node.mjs fine` (599 checks) and `node test/validate-proofs.mjs` (20) in each copy, seven at a
time (`$K4/mutate3.mjs`, `$K4/mutations3.mjs`, `$K4/mut3-results.json`, `$K4/mut3-log.txt`). e2e:
`E2E_SKIP_VALIDATE=1 node test/e2e-browser.mjs` (142 checks), three at a time, after the Node run
(`$K4/e2e_batch*.log`, `$K4/e2e_<id>.txt`). Each `find` string occurs exactly once.

Node: 63 of 75 caught. The new mutants:

| Mutation (change) | Caught by | Survived? |
| --- | --- | --- |
| I01 the same-moment band off (`same` = 0) | Node 597/599: sphere 177.51° for 170.54° | caught |
| I02 the same-moment band 1 % | Node 593/599: barge arm | caught |
| I03 the latest end among ties | Node 589/599: cube 35.71° | caught |
| I04 the zero band on single samples | Node 596/599: 20 m hull 78.535° for 78.55° | caught |
| I05 band 10⁻⁹ of the size | Node 598/599: pontoon | caught |
| I06 band 10⁻³ of the size | Node 598/599: cube asin(1/3) | caught |
| I07 fold test without the 10⁻⁵° ratio | none; the same flags on all my cases | survived (near-equivalent: the 10 × band floor already decides the pontoon and the barge) |
| I08 fold test without the 10 × band floor | Node 598/599: pontoon "not a fold" | caught |
| I09 band stretch looking back | Node 598/599: pontoon | caught |

The earlier mutants, re-planted:
- **Caught (now as before):**
  - C01, C03–C09, C12–C14, C17–C22, C24, C26–C34;
  - F01, F02, F04, F05, F07, F08, F15, F16, F19, F21;
  - H01, H02, H04–H10, H12–H18.
- **Caught for the first time:** H08, H09, H10, H12, H13 and H15, the targets of R1-38.
- **Survived, and equivalent or near-equivalent as in earlier checks:** C02, C10, C11, C15, C16, C23, F03, F06, F17 and
  H03.
- **Survived, near-equivalent:** H11 (the same results on my cases).

e2e: 9 of 11 caught. E01, E03–E08, G02 and G03 are caught; G03, the fold note, is newly caught. E02 survives
(near-equivalent: the static solve lands on the same attitude) and so does G01 (equivalent: with flood 0 there is no
maximum to print).

Totals:
- **Node:** 63 of 75 caught; all 12 survivors are equivalent or near-equivalent.
- **e2e:** 9 of 11 caught; both survivors are equivalent or near-equivalent.

## Checked and found sound

- **Baselines:** `validate-node fine` 599/599 (417 s, with the e2e baseline running alongside); `validate-proofs`
  20/20; e2e UI part 142/142.
- **The least-moment objective** still gives these results (`$K4/r_freecap.txt`, `r_r128.txt`):
  - the barge near roll, Stable;
  - the closed 20 m hull with free trim at roll's 78.5°, with its near-pitch roll-over as a note;
  - the pontoon, barge and box at 90°;
  - the square open box on its diagonal at 12.06°.
- **Mesh repair** is unchanged (`$K4/r_nest2.txt`, `r_slab2.txt`, `r_touch.txt`, `r_touch2.txt`, `r_contact2.txt`,
  `r_shells.txt`):
  - the corner block, the end slab and the three-faces-coplanar block: overlaps 2/2;
  - the four coincident-face overlaps, in all 24 variants each;
  - touching blocks: 0 of 36;
  - `touch2` and `contact2`: 0 wrong.
- **Cost on the 51k-triangle STEP sphere at fine quality**, single-threaded on an idle machine
  (`$K4/sweepcost_idle.txt`):

  | Run | Fixed trim | Free trim |
  | --- | --- | --- |
  | G 0.05 m off centre (53 analyses) | 5.7 s | 33.2 s |
  | G centred (25 analyses) | 2.35 s | 21.1 s |

  These equal b4541ad's (5.7, 33.1, 2.3 and 22.3 s). The tie scan costs nothing measurable.
- **The new tests' references are independent:**
  - the sphere's closed forms;
  - [2D] for the 20 m hull and the box with KG 0.3 m;
  - asin(1/3) for the cube;
  - a 0.002° continuation for the pontoon, which uses `gzAt` only and not the summary logic; my own continuation
    agrees with it.
