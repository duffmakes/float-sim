import Proofs.Hydrostatics
import Proofs.Stability
import Proofs.Inertia
import Proofs.Frames
import Proofs.Euler
import Proofs.PointTransfer
import Proofs.WavePhase
import Proofs.Mesh
import Proofs.MeshBox
import Proofs.Tetra

/-!
# Float Sim: proofs

Machine-checked derivations of the closed forms and identities Float Sim's code and tests rely on.
See docs/validation-map.md for how each theorem connects to the code and to the tests.

  lake build            check every proof
  lake exe expected     write expected.json (the proved closed forms evaluated exactly for the test models)
-/
