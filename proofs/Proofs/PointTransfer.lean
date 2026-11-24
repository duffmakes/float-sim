import Mathlib

/-!
# Motions and loads at another point of the body

The RAOs are solved about the CoG G. Float Sim reports them at another point O of the rigid body
(js/refcsys.js `raoAtPoint`, `forcesAtPoint`) and moves the panel-method coefficients from the solve's reference
point to G (js/bem.js `transferToG`):

  ξ_O = ξ_G + θ × d,  M_O = M_G − d × F   (d = O − G; small rotations θ),

and A_G = Tᵀ A_O T, B_G = Tᵀ B_O T, X_G = Tᵀ X_O with the 6 × 6 matrix T of `transferToG`. This file proves:

* the power the wave puts into the body is the same whichever point is used (so the transfer is consistent);
  with complex amplitudes the same holds for F·ξ̄ because d is real;
* the matrix T entered in `transferToG` is exactly ξ_O = ξ_G + θ × r (its six off-diagonal entries are copied
  from js/bem.js);
* a quadratic form such as the added-mass energy ξᵀ A ξ is unchanged by the transfer A ↦ Tᵀ A T.

Tests that check the code against these: test/validate-refcsys.js (`refcsys_rao`: power invariance, transferToG,
time-domain motion of a point).
-/

namespace FloatSim.PointTransfer

open Matrix

section Ring
variable {R : Type*} [CommRing R]

/-- Power through O equals power through G: F·(x + t × d) + (M − d × F)·t = F·x + M·t for any vectors (the
cyclic triple product F·(t × d) = (d × F)·t). -/
theorem power_invariant (F M x t d : Fin 3 → R) :
    F ⬝ᵥ (x + t ⨯₃ d) + (M - d ⨯₃ F) ⬝ᵥ t = F ⬝ᵥ x + M ⬝ᵥ t := by
  simp [cross_apply, dotProduct, Fin.sum_univ_three]
  ring

/-- `transferToG`'s matrix T (js/bem.js), r = O − G: identity, with T[0][4] = z, T[0][5] = −y, T[1][3] = −z,
T[1][5] = x, T[2][3] = y, T[2][4] = −x. -/
def T (r : Fin 3 → R) : Matrix (Fin 6) (Fin 6) R :=
  !![1, 0, 0, 0, r 2, -r 1;
     0, 1, 0, -r 2, 0, r 0;
     0, 0, 1, r 1, -r 0, 0;
     0, 0, 0, 1, 0, 0;
     0, 0, 0, 0, 1, 0;
     0, 0, 0, 0, 0, 1]

/-- T applied to (ξ, θ) gives (ξ + θ × r, θ): the translations of the point O, the same rotations. -/
theorem T_mulVec (r : Fin 3 → R) (v : Fin 6 → R) :
    T r *ᵥ v = ![v 0 + (![v 3, v 4, v 5] ⨯₃ r) 0, v 1 + (![v 3, v 4, v 5] ⨯₃ r) 1,
      v 2 + (![v 3, v 4, v 5] ⨯₃ r) 2, v 3, v 4, v 5] := by
  ext i
  fin_cases i <;> simp [T, cross_apply, Matrix.mulVec, dotProduct, Fin.sum_univ_succ] <;> ring

/-- Energy is unchanged by the transfer: (T v)ᵀ A (T v) = vᵀ (Tᵀ A T) v for any square matrices. -/
theorem quadratic_transfer {n : Type*} [Fintype n] (T A : Matrix n n R) (v : n → R) :
    (T *ᵥ v) ⬝ᵥ (A *ᵥ (T *ᵥ v)) = v ⬝ᵥ ((Tᵀ * A * T) *ᵥ v) := by
  rw [← Matrix.mulVec_mulVec, ← Matrix.mulVec_mulVec, Matrix.dotProduct_mulVec v Tᵀ, Matrix.vecMul_transpose]

end Ring

/-! ## Complex amplitudes -/

/-- For a real offset `d`, the complex conjugate of θ × d is θ̄ × d. -/
theorem conj_cross_real (t : Fin 3 → ℂ) (d : Fin 3 → ℝ) :
    star (t ⨯₃ (fun i => (d i : ℂ))) = star t ⨯₃ (fun i => (d i : ℂ)) := by
  ext i
  fin_cases i <;> simp [cross_apply, Complex.conj_ofReal]

/-- The complex power F·ξ̄ + M·θ̄ is the same at O and at G when ξ_O = ξ_G + θ × d and M_O = M_G − d × F. -/
theorem complex_power_invariant (F M ξ θ : Fin 3 → ℂ) (d : Fin 3 → ℝ) :
    let dc : Fin 3 → ℂ := fun i => (d i : ℂ)
    F ⬝ᵥ star (ξ + θ ⨯₃ dc) + (M - dc ⨯₃ F) ⬝ᵥ star θ = F ⬝ᵥ star ξ + M ⬝ᵥ star θ := by
  intro dc
  rw [star_add, conj_cross_real]
  exact power_invariant F M (star ξ) (star θ) dc

end FloatSim.PointTransfer
