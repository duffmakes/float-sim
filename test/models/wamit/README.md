# WAMIT reference data

Added mass, radiation damping and wave exciting forces from WAMIT v7 low-order runs (irregular-frequency removal on), taken from the BEMIO examples of [WEC-Sim](https://github.com/WEC-Sim/WEC-Sim) (`examples/BEMIO/WAMIT`, Apache License 2.0) and reduced to JSON by `test/wamit_extract.py`. Values are non-dimensional with L = 1 m, as WAMIT writes them. The `note` field in each file says how to scale them.

| File | Body | Depth | Used for |
|---|---|---|---|
| `sphere.json` | Hemisphere r 5 m (floating sphere) | 50 m | panel-method check where Kh ≥ π |
| `ellipsoid.json` | Ellipsoid 9 × 3.6 m | deep | panel-method check |
| `cyl.json` | Cylinder r 0.35 m, draft 0.63 m | 3 m | checking the Capytaine set-up (`test/capytaine_ref.py`) |
