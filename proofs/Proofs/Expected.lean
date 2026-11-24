import Proofs.Hydrostatics

/-!
# Expected values for the test models, from the proved formulas

Evaluates the formulas of Proofs/Hydrostatics.lean exactly over ℚ for the test models in test/models and writes
`expected.json` (each value as an exact fraction). test/validate-proofs.mjs checks Float Sim's hydrostatics, run on
the STEP files, against these numbers, and checks that the hand-derived references in test/models/expected.json
agree with them.

The stability verdicts use the criteria proved in Proofs/Stability.lean: an upright cube is stable iff
6s² − 6s + 1 > 0 (`cubeGM_eq`, `cube_stable_iff`); an upright cylinder iff r² − 2s(1 − s)H² > 0 (`cylGM_eq`,
`cyl_stable_iff`).

  lake exe expected
-/

open FloatSim.Hydrostatics

structure Row where
  id : String
  fields : List (String × ℚ)
  stable : Option Bool := none

/-- Upright box L × B (B across the roll axis), mass m, density ρ, CoG height KG above the keel. -/
def boxRow (id : String) (m ρ L B KG : ℚ) (stable : Option Bool := none) : Row :=
  let T := boxDraft m ρ L B
  let V := L * B * T
  let KB := T / 2
  let BMt := metacentricRadius (rectI L B) V
  let BMl := metacentricRadius (rectI B L) V
  { id, stable, fields := [("draft", T), ("KB", KB), ("BMt", BMt), ("BMl", BMl),
      ("GMt", metacentricHeight KB BMt KG), ("GMl", metacentricHeight KB BMl KG)] }

/-- Upright unit cube of specific gravity s, CoG at the centre. -/
def cubeRow (id : String) (s : ℚ) : Row :=
  boxRow id (1000 * s) 1000 1 1 (1 / 2) (some (decide (0 < 6 * s ^ 2 - 6 * s + 1)))

/-- Upright cylinder radius r, height H, specific gravity s, CoG at mid-height: T = sH, KB = T/2,
BM = (πr⁴/4)/(πr²T) = r²/(4T). -/
def cylRow (id : String) (r H s : ℚ) : Row :=
  let T := s * H
  let KB := T / 2
  let BM := r ^ 2 / (4 * T)
  { id, stable := some (decide (0 < r ^ 2 - 2 * s * (1 - s) * H ^ 2)),
    fields := [("draft", T), ("KB", KB), ("BMt", BM), ("BMl", BM),
      ("GMt", metacentricHeight KB BM (H / 2)), ("GMl", metacentricHeight KB BM (H / 2))] }

/-- V-section prism, apex down, half-angle 30° (tan² = 1/3), length L, draft T, CoG height KG: KB = 2T/3
(`vsection_KB`), BM_T = (2/3)·T·tan²α (`vsection_BM`), BM_L = (2T tanα·L³/12)/(L T² tanα) = L²/(6T). -/
def vprismRow (id : String) (L T KG : ℚ) : Row :=
  let KB := 2 * T / 3
  let BMt := 2 / 3 * T * (1 / 3)
  let BMl := L ^ 2 / (6 * T)
  { id, fields := [("draft", T), ("KB", KB), ("BMt", BMt), ("BMl", BMl),
      ("GMt", metacentricHeight KB BMt KG), ("GMl", metacentricHeight KB BMl KG)] }

def rows : List Row := [
  boxRow "box_fresh" 3200 1000 4 2 (1 / 2),
  boxRow "box_salt" 3200 1025 4 2 (1 / 2),
  cubeRow "cube_s015" (15 / 100),
  cubeRow "cube_s050" (1 / 2),
  cubeRow "cube_s085" (85 / 100),
  cylRow "vcyl_tall" (1 / 4) 1 (1 / 2),
  cylRow "vcyl_squat" (1 / 2) (2 / 5) (1 / 2),
  vprismRow "v_prism" 3 (3 / 5) (7 / 20)]

def ratJson (q : ℚ) : String := s!"\{\"num\": {q.num}, \"den\": {q.den}}"

def rowJson (r : Row) : String :=
  let fs := r.fields.map (fun (k, v) => s!"\"{k}\": {ratJson v}")
  let st := match r.stable with
    | some b => [s!"\"stable\": {if b then "true" else "false"}"]
    | none => []
  "    \"" ++ r.id ++ "\": {" ++ ", ".intercalate (fs ++ st) ++ "}"

def main : IO Unit := do
  let body := ",\n".intercalate (rows.map rowJson)
  let json := "{\n  \"note\": \"Written by `lake exe expected` (proofs/Proofs/Expected.lean): closed forms proved in proofs/Proofs, evaluated exactly. Values are fractions num/den in metres.\",\n  \"cases\": {\n" ++ body ++ "\n  }\n}\n"
  IO.FS.writeFile "expected.json" json
  IO.println s!"wrote expected.json ({rows.length} cases)"
