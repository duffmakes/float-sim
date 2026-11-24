import Mathlib

/-!
# Inertia tensor about another point (Huygens–Steiner)

Float Sim moves inertia tensors between the CoG G and the reference csys origin O
(js/refcsys.js `inertiaAboutPoint` and `inertiaToG`):

  I_O = I_G + m (|r|² E − r rᵀ),  r = G − O,   and back with the minus sign,

in the tensor convention I_ab = Σ m (|q|² δ_ab − q_a q_b) (products of inertia are −Σ m q_a q_b). This file proves
that formula for any set of point masses (the uniform-density solid is the same sum as an integral), and that the
two code paths undo each other.

Tests that check the code against it: test/validate-refcsys.js (`refcsys_inertia`: a solid box about its corner,
Ixx = m(b² + c²)/3, Ixy = −mab/4).
-/

namespace FloatSim.Inertia

open Finset

variable {ι : Type*} (s : Finset ι) (w : ι → ℝ) (p : ι → Fin 3 → ℝ)

/-- Kronecker delta on the three axes. -/
def δ (a b : Fin 3) : ℝ := if a = b then 1 else 0

/-- Inertia tensor of point masses `w i` at `p i` about the point `O`. -/
def inertiaAbout (O : Fin 3 → ℝ) (a b : Fin 3) : ℝ :=
  ∑ i ∈ s, w i * ((∑ c, (p i c - O c) ^ 2) * δ a b - (p i a - O a) * (p i b - O b))

/-- The parallel-axis term m (|r|² δ_ab − r_a r_b) for a total mass `m` and an offset `r`. -/
def shift (m : ℝ) (r : Fin 3 → ℝ) (a b : Fin 3) : ℝ := m * ((∑ c, r c ^ 2) * δ a b - r a * r b)

/-- Huygens–Steiner: if G is the centre of mass (Σ wᵢ (pᵢ − G) = 0), the inertia about any point O is the
inertia about G plus the parallel-axis term with the total mass and r = G − O. -/
theorem steiner (G O : Fin 3 → ℝ) (hG : ∀ c, ∑ i ∈ s, w i * (p i c - G c) = 0) (a b : Fin 3) :
    inertiaAbout s w p O a b = inertiaAbout s w p G a b + shift (∑ i ∈ s, w i) (fun c => G c - O c) a b := by
  unfold inertiaAbout shift
  -- pᵢ − O = (pᵢ − G) + (G − O); the cross terms are linear in pᵢ − G and sum to zero
  have expand : ∀ i, w i * ((∑ c, (p i c - O c) ^ 2) * δ a b - (p i a - O a) * (p i b - O b)) =
      w i * ((∑ c, (p i c - G c) ^ 2) * δ a b - (p i a - G a) * (p i b - G b))
      + w i * ((∑ c, (G c - O c) ^ 2) * δ a b - (G a - O a) * (G b - O b))
      + 2 * δ a b * (w i * (p i 0 - G 0) * (G 0 - O 0) + w i * (p i 1 - G 1) * (G 1 - O 1)
          + w i * (p i 2 - G 2) * (G 2 - O 2))
      - w i * (p i a - G a) * (G b - O b) - w i * (p i b - G b) * (G a - O a) := by
    intro i
    simp only [Fin.sum_univ_three]
    ring
  rw [Finset.sum_congr rfl (fun i _ => expand i)]
  have lin : ∀ (c : Fin 3) (k : ℝ), ∑ i ∈ s, w i * (p i c - G c) * k = 0 := by
    intro c k
    rw [← Finset.sum_mul, hG c, zero_mul]
  simp only [Finset.sum_sub_distrib, Finset.sum_add_distrib, ← Finset.mul_sum, lin, ← Finset.sum_mul]
  ring

/-- `inertiaToG` undoes `inertiaAboutPoint`: adding the parallel-axis term and subtracting it again gives the
tensor back exactly. -/
theorem shift_round_trip (I : Fin 3 → Fin 3 → ℝ) (m : ℝ) (r : Fin 3 → ℝ) (a b : Fin 3) :
    (I a b + shift m r a b) - shift m r a b = I a b := by
  ring

/-- The parallel-axis term is symmetric, so a symmetric tensor stays symmetric when it is moved. -/
theorem shift_symm (m : ℝ) (r : Fin 3 → ℝ) (a b : Fin 3) : shift m r a b = shift m r b a := by
  unfold shift δ
  split_ifs with h1 h2 h2
  · ring
  · exact absurd h1.symm h2
  · exact absurd h2.symm h1
  · ring

/-- A symmetric tensor stays symmetric when it is moved to the point (`inertiaAboutPoint`, + shift) or back to G
(`inertiaToG`, − shift). -/
theorem shifted_symm {I : Fin 3 → Fin 3 → ℝ} (hI : ∀ a b, I a b = I b a) (m : ℝ) (r : Fin 3 → ℝ)
    (a b : Fin 3) :
    I a b + shift m r a b = I b a + shift m r b a ∧ I a b - shift m r a b = I b a - shift m r b a := by
  rw [hI a b, shift_symm m r a b]
  exact ⟨rfl, rfl⟩

/-- Moving away from the centre of mass never lowers a moment of inertia: the diagonal of the parallel-axis
term is m (|r|² − r_a²) ≥ 0 for m ≥ 0. -/
theorem shift_diag_nonneg {m : ℝ} (hm : 0 ≤ m) (r : Fin 3 → ℝ) (a : Fin 3) : 0 ≤ shift m r a a := by
  unfold shift δ
  split_ifs with h
  · rw [mul_one]
    apply mul_nonneg hm
    rw [Fin.sum_univ_three]
    fin_cases a <;> simp <;> nlinarith [sq_nonneg (r 0), sq_nonneg (r 1), sq_nonneg (r 2)]
  · exact absurd rfl h

end FloatSim.Inertia
