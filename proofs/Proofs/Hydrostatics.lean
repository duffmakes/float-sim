import Mathlib

/-!
# Hydrostatics of wall-sided bodies

The closed-form answers Float Sim's hydrostatic tests are checked against (test/models/expected.json, written by
test/make_models.py from textbook formulas) come from the formulas below. Each formula is derived here from its
definition (Archimedes' principle, the centroid of the immersed volume, the second moment of the waterplane), so the
references are not taken on trust.

The formulas are stated over any field `K`, so the same definitions are evaluated exactly over ℚ by
`Proofs/Expected.lean` (the numbers `test/validate-proofs.mjs` compares Float Sim with) and reasoned about over ℝ.

Float Sim code: `hydrostatics` and `solveWaterline` in js/physics.js (draft = zw − zmin, KB, BM = I/V, GM = KB + BM − KG).
-/

namespace FloatSim.Hydrostatics

section Formulas
variable {K : Type*} [Field K]

/-- Draft of an upright box (length `L`, beam `B`) of mass `m` in fluid of density `ρ`. -/
def boxDraft (m ρ L B : K) : K := m / (ρ * L * B)

/-- Second moment of a rectangular waterplane `L × B` about its centreline along `L`: L·B³/12. -/
def rectI (L B : K) : K := L * B ^ 3 / 12

/-- Metacentric radius BM = I/V. -/
def metacentricRadius (I V : K) : K := I / V

/-- Metacentric height GM = KB + BM − KG. -/
def metacentricHeight (KB BM KG : K) : K := KB + BM - KG

/-- Archimedes: at the draft `boxDraft`, the displaced mass ρ·L·B·T equals the body's mass. -/
theorem boxDraft_floats {m ρ L B : K} (hρ : ρ ≠ 0) (hL : L ≠ 0) (hB : B ≠ 0) :
    ρ * (L * B * boxDraft m ρ L B) = m := by
  unfold boxDraft
  field_simp

/-- BM of a box: I/V = (L·B³/12)/(L·B·T) = B²/(12·T). -/
theorem box_BM {L B T : K} (hL : L ≠ 0) (hB : B ≠ 0) (hT : T ≠ 0) :
    metacentricRadius (rectI L B) (L * B * T) = B ^ 2 / (12 * T) := by
  unfold metacentricRadius rectI
  field_simp

end Formulas

/-! ## The formulas from their definitions (over ℝ) -/

open intervalIntegral in
/-- The second moment of a rectangular waterplane about its centreline, ∫ y² dA over −B/2 … B/2 (times L),
is L·B³/12, which is `rectI`. -/
theorem rect_second_moment (L B : ℝ) :
    ∫ y in (-B / 2)..(B / 2), L * y ^ 2 = rectI L B := by
  rw [intervalIntegral.integral_const_mul, integral_pow]
  unfold rectI
  push_cast
  ring

open intervalIntegral in
/-- KB of a box: the centroid height of the immersed volume, (∫₀ᵀ z·L·B dz)/(L·B·T), is T/2. -/
theorem box_KB {L B T : ℝ} (hL : L ≠ 0) (hB : B ≠ 0) (hT : T ≠ 0) :
    (∫ z in (0 : ℝ)..T, z * (L * B)) / (L * B * T) = T / 2 := by
  rw [intervalIntegral.integral_mul_const, integral_id]
  field_simp
  ring

open intervalIntegral in
/-- V-section (apex down, half-angle α, `t = tan α`): the immersed width at height z is 2·z·t, so the
volume per unit length is ∫₀ᵀ 2zt dz = T²t and KB = (∫₀ᵀ z·2zt dz)/(T²t) = 2T/3. -/
theorem vsection_KB {T t : ℝ} (hT : T ≠ 0) (ht : t ≠ 0) :
    (∫ z in (0 : ℝ)..T, z * (2 * z * t)) / (∫ z in (0 : ℝ)..T, 2 * z * t) = 2 * T / 3 := by
  have h1 : (∫ z in (0 : ℝ)..T, z * (2 * z * t)) = 2 * t * (T ^ 3 / 3) := by
    have : (fun z : ℝ => z * (2 * z * t)) = fun z => (2 * t) * z ^ 2 := by ext z; ring
    rw [this, intervalIntegral.integral_const_mul, integral_pow]
    ring
  have h2 : (∫ z in (0 : ℝ)..T, 2 * z * t) = 2 * t * (T ^ 2 / 2) := by
    have : (fun z : ℝ => 2 * z * t) = fun z => (2 * t) * z := by ext z; ring
    rw [this, intervalIntegral.integral_const_mul, integral_id]
    ring
  rw [h1, h2]
  field_simp

/-- V-section BM: waterline width b = 2Tt, I = L·b³/12, V = L·T²·t, so BM = (2/3)·T·t². -/
theorem vsection_BM {L T t : ℝ} (hL : L ≠ 0) (hT : T ≠ 0) (ht : t ≠ 0) :
    metacentricRadius (rectI L (2 * T * t)) (L * T ^ 2 * t) = 2 / 3 * T * t ^ 2 := by
  unfold metacentricRadius rectI
  field_simp
  ring

/-! ## The box barge of the test suite (test/models/box_4x2x1.step, case `box_fresh`) -/

/-- 4 × 2 m box, 3200 kg, fresh water: draft 0.4 m. -/
theorem box_fresh_draft : boxDraft (3200 : ℝ) 1000 4 2 = 2 / 5 := by
  unfold boxDraft; norm_num

/-- …and GM_T = T/2 + B²/(12T) − KG = 0.2 + 0.8333 − 0.5 = 8/15 m, GM_L = 0.2 + 3.3333 − 0.5 = 91/30 m. -/
theorem box_fresh_GM :
    metacentricHeight ((2 / 5 : ℝ) / 2) (metacentricRadius (rectI 4 2) (4 * 2 * (2 / 5))) (1 / 2) = 8 / 15 ∧
    metacentricHeight ((2 / 5 : ℝ) / 2) (metacentricRadius (rectI 2 4) (4 * 2 * (2 / 5))) (1 / 2) = 91 / 30 := by
  unfold metacentricHeight metacentricRadius rectI
  constructor <;> norm_num

end FloatSim.Hydrostatics
