import Mathlib
import Proofs.Frames

/-!
# Reading the angles back from a rotation

js/physics.js `mat3.toEulerDeg(m)` reads roll, pitch and yaw back from a rotation matrix built by
`mat3.fromEulerDeg(roll, pitch, yaw)` = Rz(yaw)·Ry(pitch)·Rx(roll) (`fixedXYZ` in Proofs/Frames.lean). With
m[3i + j] = R i j it returns, in degrees,

* if hypot(m[7], m[8]) > 1e-9:  [atan2(m[7], m[8]), atan2(−m[6], hypot(m[7], m[8])), atan2(m[3], m[0])];
* otherwise (gimbal lock, pitch at ±90°): [atan2(−m[5], m[4]), ±90, 0].

js/refcsys.js `anglesFor` uses it to show a csys's angles, and js/app.js and js/sim.js use it for attitudes. This
file proves that

* hypot(m[7], m[8]) is cos(pitch), so the code takes the main branch whenever cos(pitch) > 1e-9;
* in the main branch it returns exactly the angles the matrix was built from, for roll and yaw in (−180°, 180°]
  and pitch strictly between −90° and 90°;
* at pitch ±90° (hypot = 0) only roll ∓ yaw is defined, and the gimbal-lock branch returns angles that rebuild
  exactly the same rotation.

`Math.atan2(y, x)` is modelled as the argument of x + iy in (−π, π], its value for (x, y) ≠ (0, 0). Degrees are a
constant factor and are left out.

Not covered: for 0 < cos(pitch) ≤ 1e-9 (pitch within 6×10⁻⁸ degrees of ±90°) the code takes the gimbal-lock
branch and reports pitch as exactly ±90°; the rebuilt rotation then differs by cos(pitch) ≤ 1e-9 in its entries.
(An earlier version used asin(−m[6]) and switched at |m[6]| ≥ 0.999999, 0.081° from ±90°, where the error reached
0.08°; this proof is what showed it.)

Tests that check the code: test/validate-refcsys.js (`refcsys_axes`: angles recovered, including Y = ±90°).
-/

namespace FloatSim.Euler

open Real Matrix FloatSim.Frames

/-- `Math.atan2(y, x)`: the argument of x + iy, in (−π, π]. -/
noncomputable def atan2 (y x : ℝ) : ℝ := Complex.arg (⟨x, y⟩ : ℂ)

/-- `Math.hypot(m[7], m[8])`, the code's branch test. -/
noncomputable def hypot78 (R : Matrix (Fin 3) (Fin 3) ℝ) : ℝ := √(R 2 1 ^ 2 + R 2 2 ^ 2)

/-- `toEulerDeg`, main branch, in radians: (atan2(m₇, m₈), atan2(−m₆, hypot(m₇, m₈)), atan2(m₃, m₀)). -/
noncomputable def anglesMain (R : Matrix (Fin 3) (Fin 3) ℝ) : ℝ × ℝ × ℝ :=
  (atan2 (R 2 1) (R 2 2), atan2 (-(R 2 0)) (hypot78 R), atan2 (R 1 0) (R 0 0))

/-- `toEulerDeg`, gimbal-lock branch, in radians: (atan2(−m₅, m₄), ±π/2 by the sign of −m₆, 0). -/
noncomputable def anglesLock (R : Matrix (Fin 3) (Fin 3) ℝ) : ℝ × ℝ × ℝ :=
  (atan2 (-(R 1 2)) (R 1 1), if 0 < -(R 2 0) then π / 2 else -(π / 2), 0)

/-! ## Entries of Rz(c)·Ry(b)·Rx(a) -/

theorem fixedXYZ_20 (a b c : ℝ) : fixedXYZ a b c 2 0 = -sin b := by
  simp [fixedXYZ, Rx, Ry, Rz, Matrix.mul_apply, Fin.sum_univ_three]
theorem fixedXYZ_21 (a b c : ℝ) : fixedXYZ a b c 2 1 = cos b * sin a := by
  simp [fixedXYZ, Rx, Ry, Rz, Matrix.mul_apply, Fin.sum_univ_three]
theorem fixedXYZ_22 (a b c : ℝ) : fixedXYZ a b c 2 2 = cos b * cos a := by
  simp [fixedXYZ, Rx, Ry, Rz, Matrix.mul_apply, Fin.sum_univ_three]
theorem fixedXYZ_10 (a b c : ℝ) : fixedXYZ a b c 1 0 = cos b * sin c := by
  simp [fixedXYZ, Rx, Ry, Rz, Matrix.mul_apply, Fin.sum_univ_three]; ring
theorem fixedXYZ_00 (a b c : ℝ) : fixedXYZ a b c 0 0 = cos b * cos c := by
  simp [fixedXYZ, Rx, Ry, Rz, Matrix.mul_apply, Fin.sum_univ_three]; ring

/-! ## atan2 -/

/-- atan2(r sin θ, r cos θ) = θ for r > 0 and θ in (−π, π]. -/
theorem atan2_scaled {r θ : ℝ} (hr : 0 < r) (hθ : θ ∈ Set.Ioc (-π) π) :
    atan2 (r * sin θ) (r * cos θ) = θ := by
  unfold atan2
  have hz : (⟨r * cos θ, r * sin θ⟩ : ℂ) = (r : ℂ) * (Complex.cos θ + Complex.sin θ * Complex.I) := by
    rw [Complex.mk_eq_add_mul_I]
    push_cast
    ring
  rw [hz, Complex.arg_real_mul _ hr, Complex.arg_cos_add_sin_mul_I hθ]

/-- For any θ, atan2(sin θ, cos θ) has the same cosine and sine as θ (it is θ brought into (−π, π]). -/
theorem atan2_cos_sin (θ : ℝ) :
    cos (atan2 (sin θ) (cos θ)) = cos θ ∧ sin (atan2 (sin θ) (cos θ)) = sin θ := by
  unfold atan2
  have hz : (⟨cos θ, sin θ⟩ : ℂ) = Complex.cos θ + Complex.sin θ * Complex.I := by
    rw [Complex.mk_eq_add_mul_I]
    push_cast
    ring
  have hn : ‖(⟨cos θ, sin θ⟩ : ℂ)‖ = 1 := by
    rw [hz]
    exact Complex.norm_cos_add_sin_mul_I θ
  have h0 : (⟨cos θ, sin θ⟩ : ℂ) ≠ 0 := by
    intro h
    rw [h, norm_zero] at hn
    exact zero_ne_one hn
  exact ⟨by rw [Complex.cos_arg h0, hn, div_one], by rw [Complex.sin_arg, hn, div_one]⟩

/-! ## The main branch returns the angles the matrix was built from -/

/-- The branch test: hypot(m₇, m₈) = |cos pitch|, which is cos pitch for pitch in [−90°, 90°]. -/
theorem hypot78_eq (a b c : ℝ) : hypot78 (fixedXYZ a b c) = |cos b| := by
  unfold hypot78
  rw [fixedXYZ_21, fixedXYZ_22,
    show (cos b * sin a) ^ 2 + (cos b * cos a) ^ 2 = cos b ^ 2 by linear_combination cos b ^ 2 * sin_sq_add_cos_sq a,
    Real.sqrt_sq_eq_abs]

theorem toEuler_main {a b c : ℝ} (ha : a ∈ Set.Ioc (-π) π) (hb : b ∈ Set.Ioo (-(π / 2)) (π / 2))
    (hc : c ∈ Set.Ioc (-π) π) : anglesMain (fixedXYZ a b c) = (a, b, c) := by
  have hcb : 0 < cos b := cos_pos_of_mem_Ioo hb
  have hb' : b ∈ Set.Ioc (-π) π := ⟨by linarith [hb.1, pi_pos], by linarith [hb.2, pi_pos]⟩
  have hp : atan2 (sin b) (cos b) = b := by simpa using atan2_scaled one_pos hb'
  have hm := hypot78_eq a b c
  rw [abs_of_pos hcb] at hm
  simp only [anglesMain, hm, fixedXYZ_20, fixedXYZ_21, fixedXYZ_22, fixedXYZ_10, fixedXYZ_00, neg_neg]
  rw [atan2_scaled hcb ha, atan2_scaled hcb hc, hp]

/-- At pitch ±90° the branch test is exactly 0, so the code takes the gimbal-lock branch. -/
theorem lock_branch_taken (a c : ℝ) :
    hypot78 (fixedXYZ a (π / 2) c) = 0 ∧ hypot78 (fixedXYZ a (-(π / 2)) c) = 0 := by
  simp [hypot78_eq]

/-! ## Gimbal lock: pitch ±90° -/

/-- At pitch +90° only roll − yaw matters. -/
theorem fixedXYZ_up (x y : ℝ) :
    fixedXYZ x (π / 2) y = !![0, sin (x - y), cos (x - y); 0, cos (x - y), -sin (x - y); -1, 0, 0] := by
  ext i j
  fin_cases i <;> fin_cases j <;>
    simp [fixedXYZ, Rx, Ry, Rz, Matrix.mul_apply, Fin.sum_univ_three, sin_sub, cos_sub] <;> ring

/-- At pitch −90° only roll + yaw matters. -/
theorem fixedXYZ_down (x y : ℝ) :
    fixedXYZ x (-(π / 2)) y = !![0, -sin (x + y), -cos (x + y); 0, cos (x + y), -sin (x + y); 1, 0, 0] := by
  ext i j
  fin_cases i <;> fin_cases j <;>
    simp [fixedXYZ, Rx, Ry, Rz, Matrix.mul_apply, Fin.sum_univ_three, sin_add, cos_add] <;> ring

/-- Pitch +90°: the gimbal-lock branch's angles rebuild exactly the same rotation. -/
theorem toEuler_lock_up (a c : ℝ) :
    let e := anglesLock (fixedXYZ a (π / 2) c)
    fixedXYZ e.1 e.2.1 e.2.2 = fixedXYZ a (π / 2) c := by
  intro e
  have he : e = (atan2 (sin (a - c)) (cos (a - c)), π / 2, 0) := by
    simp [e, anglesLock, fixedXYZ_up]
  obtain ⟨hc, hs⟩ := atan2_cos_sin (a - c)
  rw [he]
  simp only
  rw [fixedXYZ_up, fixedXYZ_up, sub_zero, hc, hs]

/-- Pitch −90°: the gimbal-lock branch's angles rebuild exactly the same rotation. -/
theorem toEuler_lock_down (a c : ℝ) :
    let e := anglesLock (fixedXYZ a (-(π / 2)) c)
    fixedXYZ e.1 e.2.1 e.2.2 = fixedXYZ a (-(π / 2)) c := by
  intro e
  have he : e = (atan2 (sin (a + c)) (cos (a + c)), -(π / 2), 0) := by
    simp [e, anglesLock, fixedXYZ_down]
  obtain ⟨hc, hs⟩ := atan2_cos_sin (a + c)
  rw [he]
  simp only
  rw [fixedXYZ_down, fixedXYZ_down, add_zero, hc, hs]

end FloatSim.Euler
