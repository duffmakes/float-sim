# RAO comparison: Float Sim vs Capytaine

The full report, with the literature review and the coefficient validation, is [../rao-solver-review.md](../rao-solver-review.md) (also as a web page, `rao-solver-review.html`).

All 12 test models were run through Float Sim's panel method and through [Capytaine](https://github.com/capytaine/capytaine) 3.0 on its own. Away from resonances the RAOs agree within 4.3 % of each motion's peak, and within 1 % for most motions. Natural frequencies agree within 1.2 %, and radiation damping ratios within 3 %.

Generated 2026-11-24 by the scripts in `test/rao-compare/`:

- **Float Sim** (`floatsim_rao.mjs`): the STEP files read with OpenCascade and meshed as the app does, at Standard fidelity with panels refined for 1 Hz. It uses an irregular-frequency lid and symmetry where the hull has it, and gives RAOs about G with the wave phase at G.
- **Capytaine** (`capytaine_rao.py`) uses nothing from Float Sim's meshes or solver:
  - each body meshed analytically with Capytaine's own generators and floated at its exact draft;
  - the direct formulation, with the lid from `generate_lid`;
  - Capytaine's own hydrostatic stiffness, and RAOs from `capytaine.post_pro.rao`.
- **Shared inputs:** mass, CoG and inertia about the CoG (Float Sim's uniform-density tensor, as a CAD report would give it), 100 frequencies from 0.01 to 1 Hz, and headings 0–180° every 10°. There is no extra damping, so these are pure potential-flow RAOs.
- **Plots and scores** (`plot.py`): one PNG per model, plus `summary.csv` and `natural.csv`.

## How the two are compared

- **Plotted RAOs:** each solver's own A(ω), B(ω), X(ω, β), mass and restoring matrices, with cubic splines in ω between the solved frequencies. They are solved on a 0.00025 Hz grid, so resonance peaks narrower than the 0.01 Hz solve grid are drawn in full. At the solved frequencies this reproduces each solver's own RAOs exactly.
- **Difference:** (Float Sim − Capytaine) divided by the motion's peak over all frequencies and headings, at the solved frequencies.
  - It is scored away from resonances, leaving out frequencies within 3 % of either solver's coupled natural frequencies (the grey bands in the plots).
  - Near an almost undamped resonance, a 1 % shift in natural frequency makes a large difference at any fixed frequency. So resonances are compared by natural frequency, damping ratio and peak height instead.
- **Arbiter:** the Haskind energy relation, B<sub>jj</sub> = ω³/(4πρg³) ∫|X<sub>j</sub>(β)|² dβ, checked for both solvers.

## Results

| Model | Float Sim panels + lid | Capytaine panels + lid | Worst motion away from resonance | Natural frequency, largest difference | Energy relation, worst: Float Sim / Capytaine |
|---|---|---|---|---|---|
| [box_4x2x1](box_4x2x1.png) | 1,396 + 776 | 800 + 434 | roll 4.3 % | roll +0.50 % | 3.0 % / 3.1 % |
| [box_moved](box_moved.png) | 1,408 + 796 | 800 + 445 | roll 4.2 % | roll +0.49 % | 2.4 % / 3.1 % |
| [buoy_cyl](buoy_cyl.png) | 2,848 + 300 | 1,056 + 197 | heave 1.4 % | roll +0.30 % | 0.2 % / 0.4 % |
| [cube_1m](cube_1m.png) | 1,108 + 264 | 868 + 144 | pitch 3.6 % | pitch +1.16 % | 1.4 % / 1.3 % |
| [hcyl_log](hcyl_log.png) | 4,768 + 748 | 1,440 + 616 | sway 0.6 % | pitch +0.13 % | 0.2 % / 0.4 % |
| [kramer_sphere](kramer_sphere.png) | 1,232 + 564 | 1,088 + 392 | surge 0.5 % | roll +0.15 % | 0.0 % / 0.2 % |
| [spar](spar.png) | 4,412 + 52 | 1,920 + 61 | heave 2.0 % | pitch +0.22 % | 0.7 % / 2.3 % |
| [sphere_r1](sphere_r1.png) | 1,300 + 616 | 1,600 + 561 | pitch 0.8 % | roll +0.08 % | 1.3 % / 1.3 % |
| [square_log_3x1x1](square_log_3x1x1.png) | 1,288 + 784 | 1,020 + 578 | roll 2.4 % | roll +0.17 % | 1.7 % / 1.8 % |
| [v_prism](v_prism.png) | 1,132 + 580 | 518 + 124 | pitch 0.5 % | pitch +0.13 % | 0.9 % / 2.9 % |
| [vcyl_squat](vcyl_squat.png) | 1,220 + 644 | 896 + 354 | roll 2.8 % | roll +0.61 % | 2.4 % / 2.2 % |
| [vcyl_tall](vcyl_tall.png) | 3,496 + 280 | 640 + 90 | pitch 3.6 % | pitch +0.46 % | 0.1 % / 0.5 % |

All motions for every model are in `summary.csv`; natural frequencies, damping ratios and restoring stiffnesses are in `natural.csv`.

- **Natural frequencies.** The differences come mostly from the hydrostatics, not the wave solution.
  - Capytaine's faceted cylinders and spheres lose 0.1–0.9 % of their waterplane stiffness.
  - Capytaine integrates the waterplane moments at panel centroids. That makes the 1 m cube's roll stiffness 2.2 % low, because the cube's GM is only 23 mm, which shifts its roll resonance 1.2 %.
  - Float Sim's restoring matrix is exact for the CAD mesh.
- **Peak heights** agree within 3 % where the radiation damping is at least 0.2 % of critical. Several bodies have almost no roll or pitch damping in potential flow (0.06 % of critical for the cylinder buoy, 0.003 % or less for the spar, the cube and the tall cylinder), so their peaks are needles. Their heights depend on where the frequency grid falls and are not compared. Real peaks are set by viscous damping (extra ζ in the app).
- **Capytaine set-up.** A lid covering the whole waterplane, with its edge on the hull's waterline, gave Capytaine wrong results on the flat-sided bodies. For the 4 × 2 m box at 0.5 Hz, heave damping was 40 % off the energy relation and the wave force was 50 % off. Capytaine's `generate_lid`, which keeps a margin from the hull, satisfies the relation and matches Float Sim. The app's **Solve with Capytaine** sends Float Sim's own lid, which does not have this problem (`test/validate-capytaine.mjs`).

## Reproduce

```bash
node test/rao-compare/floatsim_rao.mjs props                  # mass properties and waterlines
node test/rao-compare/floatsim_rao.mjs run box_4x2x1 0 2      # repeat for every model and part (parallel)
node test/rao-compare/floatsim_rao.mjs merge box_4x2x1 2
~/venvs/bem/bin/python test/rao-compare/capytaine_rao.py      # all models, one frequency per process
~/venvs/bem/bin/python test/rao-compare/plot.py
```

On a 16-core desktop, Float Sim took 4.9 CPU-hours for the 12 models × 100 frequencies (23 min on 14 processes), and Capytaine took 4 min. Capytaine tabulates the wave part of the Green function, while Float Sim evaluates it from series at every panel pair, which is the next speed-up to make.
