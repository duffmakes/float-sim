# WAMIT reference data

Added mass, radiation damping and wave exciting forces from WAMIT low-order runs, reduced to JSON by `test/wamit_extract.py`. `sphere`, `ellipsoid` and `cyl` are WAMIT v7 runs with irregular-frequency removal from the BEMIO examples of [WEC-Sim](https://github.com/WEC-Sim/WEC-Sim) (`examples/BEMIO/WAMIT`, Apache License 2.0). `oc3_spar` is the OC3-Hywind spar run shipped with OpenFAST's regression tests ([OpenFAST/r-test](https://github.com/OpenFAST/r-test), `glue-codes/openfast/5MW_Baseline/HydroData/Spar.*`, Apache License 2.0); that folder has no `.out` file, so the depth and gravity were given on the command line. Values are non-dimensional with L = 1 m, as WAMIT writes them. The `note` field in each file says how to scale them.

| File | Body | Depth | Used for |
|---|---|---|---|
| `sphere.json` | Hemisphere r 5 m (floating sphere) | 50 m | panel-method check where Kh ≥ π |
| `ellipsoid.json` | Ellipsoid 9 × 3.6 m | deep | panel-method check |
| `cyl.json` | Cylinder r 0.35 m, draft 0.63 m | 3 m | checking the Capytaine set-up (`test/capytaine_ref.py`) |
| `oc3_spar.json` | OC3-Hywind spar (Jonkman 2010): Ø6.5 m to 4 m depth, tapering to Ø9.4 m at 12 m, draft 120 m | 320 m | panel-method check where Kh ≥ π |
