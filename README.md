# Float Sim

Browser-based hydrostatics and stability tool for CAD bodies. Runs entirely locally; all libraries are in `vendor/`.

```bash
./serve.sh          # then open http://localhost:8765
```

## What it does

- **Imports STEP / IGES / BREP** files (via `occt-import-js`, OpenCascade compiled to WASM) and **STL**. The STEP geometry is converted to millimetres; pick other units for STL.
- **Inputs:** mass, CoG (x, y, z in model coordinates), fresh (1000 kg/m³), salt (1025 kg/m³) or custom water, and an initial roll/pitch/yaw.
- **Static float solve:** for the chosen attitude, finds the waterline where buoyancy = weight, then shows
  - the waterline outline, **G** (CoG), **B** (centre of buoyancy) and the weight/buoyancy force arrows
  - **M<sub>T</sub>, M<sub>L</sub>** (roll and pitch metacentres): BM = I<sub>waterplane</sub> / V
  - draft, freeboard, displaced volume, reserve buoyancy, immersion rate
  - KB, KG, BM, **GM** (roll, pitch, and the weakest waterplane axis), righting moment per degree, approximate heave/roll/pitch periods
  - a plain-language stability verdict, and a warning if the attitude is not at rest (B not under G)
- **GZ righting-arm curve** (0–180°, roll or pitch) with max GZ, the angle where it peaks, and the angle of vanishing stability.
- **Free-float simulation:** a 6-DOF rigid body with damping, released from the chosen attitude so it settles into a stable floating attitude (for example, a 1 m cube at half draft rolls onto an edge). **Settle (fast)** runs it to rest and copies the attitude back.
- **Target float plane → mass:** give a draft, a waterline height in model Z, or a submerged-volume %, and get the mass needed for it. It also tells you where the CoG has to be for that attitude to be in equilibrium. **Preview plane** draws it.

## Method

The body is triangulated and each triangle is clipped to the part below the waterplane. Tetrahedra are taken from a point *on* the waterplane, so the waterplane "cap" adds nothing and the clipped surface gives the exact submerged volume and B. The cut edges form the waterplane boundary, and Green's theorem on them gives area, centroid and second moments (I<sub>xx</sub>, I<sub>yy</sub>, I<sub>xy</sub>). The waterline is solved by safeguarded Newton (dV/dz = waterplane area). `test/verify_physics.py` is a direct Python port of the core routine, checked against closed-form results (cube, box barge upright and heeled, half-submerged cylinder).

## Assumptions and limits

- Rigid body in calm water. The inertia used for the simulation and periods assumes **uniform density**, and **added mass is ignored**, so periods are indicative only.
- The mesh should be closed (watertight). The model panel reports open edges. Overlapping bodies in an assembly double-count volume.
- GZ curves are at fixed trim (the body isn't allowed to re-trim as it heels).
- Coordinates: Z is up. Roll is about X, pitch about Y, yaw about Z, applied in the order X → Y → Z (extrinsic).

## Validation suite

`test/models/` holds 8 exact B-rep STEP bodies (boxes, a cube, a square log, a V-prism, true cylinders upright and on their side, and a box moved and rotated off the origin). They are written by `test/make_models.py`, a standard-library STEP writer that also checks each shell is closed and consistently oriented. `expected.json` has 14 cases with closed-form answers and citations: Rawson & Tupper, Barrass & Derrett, Biran, and Erdős et al., Am. J. Phys. 60 (1992).

| Run | What it exercises | Result (2026-11-20) |
|---|---|---|
| `python3 test/validate.py` | Python port of the solver on the same geometry | 126/126 |
| `python3 test/simcheck.py` | Python port of the free-float simulator | 2/2 |
| `node test/validate-node.mjs [fine\|normal\|coarse]` | **Real pipeline** under Node: OpenCascade STEP import, then the JS solver and simulator | 132/132 at all three qualities |
| http://localhost:8765/test/validate.html | Same checks, in the browser | 132/132 in headless Chromium |
| `node test/e2e-browser.mjs [shotDir]` | Drives the app UI in Chromium: file picker, inputs, salt water, target mass, settle, cube demo, console errors | 20/20 |

`validate.html` and `validate-node.mjs` share `test/validate-core.js`. The e2e test needs Playwright (`npm i playwright && npx playwright install chromium`). Regenerate the models with `python3 test/make_models.py`.

Worst-case error on curved bodies, from faceting (planar bodies match to about 1e-9): Fine 0.026 %, Normal 0.22 %, Coarse 1.8 %.
