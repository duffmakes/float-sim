import Mathlib

/-!
# Rotations and the reference coordinate system

Float Sim builds the CAD reference csys from three angles (js/refcsys.js `refFrame`, with `mat3.rotX/rotY/rotZ`
from js/physics.js), moves the mesh into it with p_ref = Rᵀ(p_file − O) (`toRefTris`, `toRefPoint`) and back with
p_file = O + R·p_ref (`fromRefPoint`), and recovers the angles of the turning-axes order from the transpose
(`anglesFor`). This file proves the facts that code relies on:

* the three elementary rotations, entered here exactly as in js/physics.js, are rotations (Rᵀ R = 1, det R = 1),
  and their transpose is the rotation by the opposite angle;
* both angle orders give rotations;
* the turning-axes order X, Y′, Z″, R = Rx(a)·Ry(b)·Rz(c), has Rᵀ = Rz(−c)·Ry(−b)·Rx(−a), which is the fixed-axes
  order with the angles negated (what `anglesFor(R, 'moving')` uses);
* moving a point into the reference csys and back gives the same point, so nothing is lost or distorted.

Tests that check the code against these: test/validate-refcsys.js (`refcsys_axes`: orthonormal, det 1, round
trips, angle recovery).
-/

namespace FloatSim.Frames

open Matrix Real

/-- js/physics.js `rotX(a)`: [1, 0, 0, 0, c, −s, 0, s, c] (row-major). -/
noncomputable def Rx (a : ℝ) : Matrix (Fin 3) (Fin 3) ℝ := !![1, 0, 0; 0, cos a, -sin a; 0, sin a, cos a]
/-- js/physics.js `rotY(a)`: [c, 0, s, 0, 1, 0, −s, 0, c]. -/
noncomputable def Ry (a : ℝ) : Matrix (Fin 3) (Fin 3) ℝ := !![cos a, 0, sin a; 0, 1, 0; -sin a, 0, cos a]
/-- js/physics.js `rotZ(a)`: [c, −s, 0, s, c, 0, 0, 0, 1]. -/
noncomputable def Rz (a : ℝ) : Matrix (Fin 3) (Fin 3) ℝ := !![cos a, -sin a, 0; sin a, cos a, 0; 0, 0, 1]

theorem Rx_transpose (a : ℝ) : (Rx a)ᵀ = Rx (-a) := by
  ext i j; fin_cases i <;> fin_cases j <;> simp [Rx]
theorem Ry_transpose (a : ℝ) : (Ry a)ᵀ = Ry (-a) := by
  ext i j; fin_cases i <;> fin_cases j <;> simp [Ry]
theorem Rz_transpose (a : ℝ) : (Rz a)ᵀ = Rz (-a) := by
  ext i j; fin_cases i <;> fin_cases j <;> simp [Rz]

theorem Rx_orth (a : ℝ) : (Rx a)ᵀ * Rx a = 1 := by
  ext i j; fin_cases i <;> fin_cases j <;>
    simp [Rx, Matrix.mul_apply, Fin.sum_univ_three] <;> nlinarith [sin_sq_add_cos_sq a]
theorem Ry_orth (a : ℝ) : (Ry a)ᵀ * Ry a = 1 := by
  ext i j; fin_cases i <;> fin_cases j <;>
    simp [Ry, Matrix.mul_apply, Fin.sum_univ_three] <;> nlinarith [sin_sq_add_cos_sq a]
theorem Rz_orth (a : ℝ) : (Rz a)ᵀ * Rz a = 1 := by
  ext i j; fin_cases i <;> fin_cases j <;>
    simp [Rz, Matrix.mul_apply, Fin.sum_univ_three] <;> nlinarith [sin_sq_add_cos_sq a]

theorem Rx_det (a : ℝ) : (Rx a).det = 1 := by
  simp [Rx, Matrix.det_fin_three]; nlinarith [sin_sq_add_cos_sq a]
theorem Ry_det (a : ℝ) : (Ry a).det = 1 := by
  simp [Ry, Matrix.det_fin_three]; nlinarith [sin_sq_add_cos_sq a]
theorem Rz_det (a : ℝ) : (Rz a).det = 1 := by
  simp [Rz, Matrix.det_fin_three]; nlinarith [sin_sq_add_cos_sq a]

/-- js/refcsys.js `refFrame`, order 'fixed': rotate about the file's fixed X, then Y, then Z. -/
noncomputable def fixedXYZ (a b c : ℝ) : Matrix (Fin 3) (Fin 3) ℝ := Rz c * Ry b * Rx a
/-- js/refcsys.js `refFrame`, order 'moving': about X, then the turned Y′, then the turned Z″. -/
noncomputable def movingXYZ (a b c : ℝ) : Matrix (Fin 3) (Fin 3) ℝ := Rx a * Ry b * Rz c

/-- A product of matrices with Qᵀ Q = 1 also has it. -/
theorem orth_mul {P Q : Matrix (Fin 3) (Fin 3) ℝ} (hP : Pᵀ * P = 1) (hQ : Qᵀ * Q = 1) :
    (P * Q)ᵀ * (P * Q) = 1 := by
  rw [Matrix.transpose_mul, Matrix.mul_assoc, ← Matrix.mul_assoc Pᵀ, hP, Matrix.one_mul, hQ]

theorem fixedXYZ_orth (a b c : ℝ) : (fixedXYZ a b c)ᵀ * fixedXYZ a b c = 1 :=
  orth_mul (orth_mul (Rz_orth c) (Ry_orth b)) (Rx_orth a)
theorem movingXYZ_orth (a b c : ℝ) : (movingXYZ a b c)ᵀ * movingXYZ a b c = 1 :=
  orth_mul (orth_mul (Rx_orth a) (Ry_orth b)) (Rz_orth c)

theorem fixedXYZ_det (a b c : ℝ) : (fixedXYZ a b c).det = 1 := by
  simp [fixedXYZ, Matrix.det_mul, Rx_det, Ry_det, Rz_det]
theorem movingXYZ_det (a b c : ℝ) : (movingXYZ a b c).det = 1 := by
  simp [movingXYZ, Matrix.det_mul, Rx_det, Ry_det, Rz_det]

/-- The identity `anglesFor(R, 'moving')` uses: the transpose of the turning-axes rotation is the fixed-axes
rotation with every angle negated, so the turning-axes angles are minus the fixed-axes angles of Rᵀ. -/
theorem movingXYZ_transpose (a b c : ℝ) : (movingXYZ a b c)ᵀ = fixedXYZ (-a) (-b) (-c) := by
  simp only [movingXYZ, fixedXYZ, Matrix.transpose_mul, Rx_transpose, Ry_transpose, Rz_transpose, Matrix.mul_assoc]

/-- Into the reference csys and back: with p_ref = Rᵀ(p − O) and p = O + R·p_ref, the point is unchanged for any
rotation R (Rᵀ R = 1, hence also R Rᵀ = 1 for a square matrix). -/
theorem ref_round_trip {R : Matrix (Fin 3) (Fin 3) ℝ} (hR : Rᵀ * R = 1) (O p : Fin 3 → ℝ) :
    O + R *ᵥ (Rᵀ *ᵥ (p - O)) = p := by
  have h : R * Rᵀ = 1 := mul_eq_one_comm.mp hR
  rw [Matrix.mulVec_mulVec, h, Matrix.one_mulVec]
  abel

/-- …and the other way: a point given in the reference csys, moved to the file and back, is unchanged. -/
theorem ref_round_trip' {R : Matrix (Fin 3) (Fin 3) ℝ} (hR : Rᵀ * R = 1) (O q : Fin 3 → ℝ) :
    Rᵀ *ᵥ ((O + R *ᵥ q) - O) = q := by
  rw [add_sub_cancel_left, Matrix.mulVec_mulVec, hR, Matrix.one_mulVec]

/-- Distances do not change in the reference csys (the mesh keeps its shape and size). -/
theorem ref_preserves_dot {R : Matrix (Fin 3) (Fin 3) ℝ} (hR : Rᵀ * R = 1) (u v : Fin 3 → ℝ) :
    (Rᵀ *ᵥ u) ⬝ᵥ (Rᵀ *ᵥ v) = u ⬝ᵥ v := by
  have h : R * Rᵀ = 1 := mul_eq_one_comm.mp hR
  rw [Matrix.dotProduct_mulVec, Matrix.vecMul_transpose, Matrix.mulVec_mulVec, h, Matrix.one_mulVec]

end FloatSim.Frames
