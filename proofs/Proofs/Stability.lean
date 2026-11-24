import Mathlib

/-!
# Upright stability limits

Two classic results the test suite relies on (test/models/expected.json, cases `cube_s015`, `cube_s050`,
`cube_s085`, `vcyl_tall`, `vcyl_squat`; checked against Float Sim's hydrostatics and its free-float simulator):

* a solid cube of specific gravity s, CoG at its centre, is stable upright only if s < ½ − √3/6 ≈ 0.2113 or
  s > ½ + √3/6 ≈ 0.7887;
* an upright solid cylinder (radius r, height H) of specific gravity s, CoG at mid-height, is stable only if
  r/H > √(2s(1 − s)).

Both follow from GM = KB + BM − KG > 0 with the wall-sided draft T = s·(height), KB = T/2, KG = height/2 and
BM = I/V. The square's I = 1·1³/12 is `rectI` (Proofs/Hydrostatics.lean, derived there). The circle's I = π r⁴/4 is
the standard result and is taken as given here; π cancels in BM = (π r⁴/4)/(π r² T) = r²/(4T).
-/

namespace FloatSim.Stability

open Real

/-- GM of an upright unit cube, specific gravity `s`: KB = s/2, BM = 1/(12 s), KG = ½. -/
noncomputable def cubeGM (s : ℝ) : ℝ := s / 2 + 1 / (12 * s) - 1 / 2

theorem cubeGM_eq {s : ℝ} (hs : 0 < s) : cubeGM s = (6 * s ^ 2 - 6 * s + 1) / (12 * s) := by
  have hs' := hs.ne'
  unfold cubeGM
  field_simp
  ring

/-- The upright cube is stable (GM > 0) exactly when s < ½ − √3/6 or s > ½ + √3/6. -/
theorem cube_stable_iff {s : ℝ} (hs : 0 < s) :
    0 < cubeGM s ↔ s < 1 / 2 - √3 / 6 ∨ 1 / 2 + √3 / 6 < s := by
  rw [cubeGM_eq hs, div_pos_iff_of_pos_right (by positivity)]
  have h3 : (√3) ^ 2 = 3 := Real.sq_sqrt (by norm_num)
  have hc : 0 ≤ √3 / 6 := by positivity
  -- 6s² − 6s + 1 = 6((s − ½)² − (√3/6)²)
  have key : 6 * s ^ 2 - 6 * s + 1 = 6 * ((s - 1 / 2) ^ 2 - (√3 / 6) ^ 2) := by
    rw [div_pow, h3]; ring
  rw [key]
  constructor
  · intro h
    have hsq : (√3 / 6) ^ 2 < (s - 1 / 2) ^ 2 := by linarith
    have habs : √3 / 6 < |s - 1 / 2| := by
      have := sq_lt_sq.mp hsq
      rwa [abs_of_nonneg hc] at this
    rcases lt_abs.mp habs with h1 | h1
    · right; linarith
    · left; linarith
  · intro h
    have habs : √3 / 6 < |s - 1 / 2| := by
      rcases h with h1 | h1
      · rw [lt_abs]; right; linarith
      · rw [lt_abs]; left; linarith
    have hsq : (√3 / 6) ^ 2 < (s - 1 / 2) ^ 2 := by
      apply sq_lt_sq.mpr
      rwa [abs_of_nonneg hc]
    linarith

/-- GM of an upright cylinder (radius `r`, height `H`, specific gravity `s`): KB = sH/2, BM = r²/(4sH), KG = H/2. -/
noncomputable def cylGM (r H s : ℝ) : ℝ := s * H / 2 + r ^ 2 / (4 * (s * H)) - H / 2

theorem cylGM_eq {r H s : ℝ} (hH : 0 < H) (hs : 0 < s) :
    cylGM r H s = (r ^ 2 - 2 * s * (1 - s) * H ^ 2) / (4 * (s * H)) := by
  have hs' := hs.ne'
  have hH' := hH.ne'
  unfold cylGM
  field_simp
  ring

/-- The upright cylinder is stable exactly when r/H > √(2s(1 − s)). -/
theorem cyl_stable_iff {r H s : ℝ} (hr : 0 < r) (hH : 0 < H) (hs : 0 < s) :
    0 < cylGM r H s ↔ √(2 * s * (1 - s)) < r / H := by
  rw [cylGM_eq hH hs, div_pos_iff_of_pos_right (by positivity), Real.sqrt_lt' (by positivity)]
  rw [div_pow, lt_div_iff₀ (by positivity)]
  constructor <;> intro h <;> linarith

/-! ## The test-suite cases -/

/-- s.g. 0.15 and 0.85 are stable upright, s.g. 0.5 is not (cube_s015, cube_s085, cube_s050). -/
theorem cube_cases : 0 < cubeGM 0.15 ∧ cubeGM 0.5 < 0 ∧ 0 < cubeGM 0.85 := by
  unfold cubeGM
  refine ⟨?_, ?_, ?_⟩ <;> norm_num

/-- r 0.5 m, H 0.4 m (vcyl_squat) is stable at s.g. ½; r 0.25 m, H 1 m (vcyl_tall) is not. -/
theorem cyl_cases : 0 < cylGM 0.5 0.4 0.5 ∧ cylGM 0.25 1 0.5 < 0 := by
  unfold cylGM
  constructor <;> norm_num

end FloatSim.Stability
