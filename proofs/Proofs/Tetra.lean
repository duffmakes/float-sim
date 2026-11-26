import Mathlib

/-!
# One tetrahedron: the code's determinant is its volume

js/physics.js (`massProperties`, `submerged`) and js/meshcheck.js (`signedVolume`) add det(a − p, b − p, c − p)/6
for every triangle (a, b, c) with a reference point p, the determinant written out as
`ax*(by*cz − bz*cy) − ay*(bx*cz − bz*cx) + az*(bx*cy − by*cx)`. Proofs/Mesh.lean proves that the sum does not
depend on p for a closed mesh and that clipping at the water plane keeps the surface closed. This file proves the
step from the formula to an actual volume for one tetrahedron: the Lebesgue measure of the solid tetrahedron with
corners p, a, b, c is |det(a − p, b − p, c − p)|/6 (`volume_tetra`). The open tetrahedron (strict inequalities) is
used; its boundary has no volume.

Steps: the open unit simplex {s, t, u > 0, s + t + u < 1} has volume 1/6 (Tonelli: slices of area (1 − s)²/2,
integrated over 0 < s < 1), and the tetrahedron is its image under x ↦ p + A·x, with the columns of A the edges
a − p, b − p, c − p; a linear map scales Lebesgue measure by |det A| (Mathlib `addHaar_image_linearMap`).
-/

namespace FloatSim.Tetra

open MeasureTheory Set ENNReal

/-- The open triangle {s, t > 0, s + t < r} in ℝ × ℝ. -/
def tri2 (r : ℝ) : Set (ℝ × ℝ) := {q | 0 < q.1 ∧ 0 < q.2 ∧ q.1 + q.2 < r}

lemma tri2_meas (r : ℝ) : MeasurableSet (tri2 r) := by
  have h1 : MeasurableSet {q : ℝ × ℝ | 0 < q.1} := measurableSet_lt measurable_const measurable_fst
  have h2 : MeasurableSet {q : ℝ × ℝ | 0 < q.2} := measurableSet_lt measurable_const measurable_snd
  have h3 : MeasurableSet {q : ℝ × ℝ | q.1 + q.2 < r} := measurableSet_lt (measurable_fst.add measurable_snd) measurable_const
  exact h1.inter (h2.inter h3)

/-- Its area is r²/2 (for r ≥ 0). -/
lemma volume_tri2 (r : ℝ) (hr : 0 ≤ r) : volume (tri2 r) = ENNReal.ofReal (r ^ 2 / 2) := by
  rw [Measure.volume_eq_prod, Measure.prod_apply (tri2_meas r)]
  have slice : ∀ s : ℝ, volume (Prod.mk s ⁻¹' tri2 r) = (Ioc 0 r).indicator (fun s => ENNReal.ofReal (r - s)) s := by
    intro s
    by_cases hs : 0 < s
    · have : Prod.mk s ⁻¹' tri2 r = Ioo 0 (r - s) := by
        ext t; simp only [tri2, mem_preimage, mem_ofPred_eq, mem_Ioo]; constructor
        · rintro ⟨_, h2, h3⟩; exact ⟨h2, by linarith⟩
        · rintro ⟨h2, h3⟩; exact ⟨hs, h2, by linarith⟩
      rw [this, Real.volume_Ioo, sub_zero]
      by_cases hsr : s ≤ r
      · rw [indicator_of_mem (show s ∈ Ioc 0 r from ⟨hs, hsr⟩)]
      · rw [indicator_of_notMem (fun h : s ∈ Ioc 0 r => hsr h.2), ENNReal.ofReal_eq_zero]; linarith
    · have : Prod.mk s ⁻¹' tri2 r = ∅ := by
        ext t; simp only [tri2, mem_preimage, mem_ofPred_eq, mem_empty_iff_false, iff_false]
        rintro ⟨h1, _, _⟩; exact hs h1
      rw [this, measure_empty, indicator_of_notMem (fun h : s ∈ Ioc 0 r => hs h.1)]
  simp_rw [slice]
  rw [lintegral_indicator measurableSet_Ioc]
  rw [← ofReal_integral_eq_lintegral_ofReal]
  · congr 1
    rw [← intervalIntegral.integral_of_le hr]
    have e := intervalIntegral.integral_comp_sub_left (fun x : ℝ => x) (a := 0) (b := r) r
    simp only [sub_self, sub_zero] at e
    rw [e, integral_id]
    ring
  · exact (continuous_const.sub continuous_id).integrableOn_Icc.mono_set Ioc_subset_Icc_self
  · exact ae_restrict_of_forall_mem measurableSet_Ioc (fun s hs => by simp only [Pi.zero_apply]; linarith [hs.2])

/-- The open unit simplex {s, t, u > 0, s + t + u < 1} in ℝ × ℝ × ℝ. -/
def tet3 : Set (ℝ × ℝ × ℝ) := {p | 0 < p.1 ∧ 0 < p.2.1 ∧ 0 < p.2.2 ∧ p.1 + p.2.1 + p.2.2 < 1}

lemma tet3_meas : MeasurableSet tet3 := by
  have m1 : Measurable (fun p : ℝ × ℝ × ℝ => p.2.1) := measurable_fst.comp measurable_snd
  have m2 : Measurable (fun p : ℝ × ℝ × ℝ => p.2.2) := measurable_snd.comp measurable_snd
  have h1 : MeasurableSet {p : ℝ × ℝ × ℝ | 0 < p.1} := measurableSet_lt measurable_const measurable_fst
  have h2 : MeasurableSet {p : ℝ × ℝ × ℝ | 0 < p.2.1} := measurableSet_lt measurable_const m1
  have h3 : MeasurableSet {p : ℝ × ℝ × ℝ | 0 < p.2.2} := measurableSet_lt measurable_const m2
  have h4 : MeasurableSet {p : ℝ × ℝ × ℝ | p.1 + p.2.1 + p.2.2 < 1} :=
    measurableSet_lt ((measurable_fst.add m1).add m2) measurable_const
  exact h1.inter (h2.inter (h3.inter h4))

/-- Its volume is 1/6. -/
lemma volume_tet3 : volume tet3 = ENNReal.ofReal (1 / 6) := by
  rw [Measure.volume_eq_prod, Measure.prod_apply tet3_meas]
  have slice : ∀ s : ℝ, volume (Prod.mk s ⁻¹' tet3) = (Ioc 0 1).indicator (fun s => ENNReal.ofReal ((1 - s) ^ 2 / 2)) s := by
    intro s
    by_cases hs : 0 < s
    · have : Prod.mk s ⁻¹' tet3 = tri2 (1 - s) := by
        ext q; simp only [tet3, tri2, mem_preimage, mem_ofPred_eq]; constructor
        · rintro ⟨_, h2, h3, h4⟩; exact ⟨h2, h3, by linarith⟩
        · rintro ⟨h2, h3, h4⟩; exact ⟨hs, h2, h3, by linarith⟩
      rw [this]
      by_cases hs1 : s ≤ 1
      · rw [volume_tri2 _ (by linarith), indicator_of_mem (show s ∈ Ioc 0 1 from ⟨hs, hs1⟩)]
      · have : tri2 (1 - s) = ∅ := by
          ext q; simp only [tri2, mem_ofPred_eq, mem_empty_iff_false, iff_false]
          rintro ⟨h1, h2, h3⟩; linarith
        rw [this, measure_empty, indicator_of_notMem (fun h : s ∈ Ioc 0 1 => hs1 h.2)]
    · have : Prod.mk s ⁻¹' tet3 = ∅ := by
        ext q; simp only [tet3, mem_preimage, mem_ofPred_eq, mem_empty_iff_false, iff_false]
        rintro ⟨h1, _, _, _⟩; exact hs h1
      rw [this, measure_empty, indicator_of_notMem (fun h : s ∈ Ioc 0 1 => hs h.1)]
  simp_rw [slice]
  rw [lintegral_indicator measurableSet_Ioc, ← ofReal_integral_eq_lintegral_ofReal]
  · congr 1
    rw [← intervalIntegral.integral_of_le zero_le_one]
    have e := intervalIntegral.integral_comp_sub_left (fun x : ℝ => x ^ 2 / 2) (a := 0) (b := 1) 1
    simp only [sub_self, sub_zero] at e
    rw [e, intervalIntegral.integral_div, integral_pow]
    norm_num
  · exact ((continuous_const.sub continuous_id).pow 2 |>.div_const 2).integrableOn_Icc.mono_set Ioc_subset_Icc_self
  · exact ae_restrict_of_forall_mem measurableSet_Ioc (fun s _ => by simp only [Pi.zero_apply]; positivity)

/-- The open unit simplex in coordinates `Fin 3 → ℝ`. -/
def simplex3 : Set (Fin 3 → ℝ) := {x | 0 < x 0 ∧ 0 < x 1 ∧ 0 < x 2 ∧ x 0 + x 1 + x 2 < 1}

/-- (x₀, x₁, x₂) ↦ (x₀, (x₁, x₂)) keeps Lebesgue measure. -/
noncomputable def toProd : (Fin 3 → ℝ) ≃ᵐ ℝ × ℝ × ℝ :=
  (MeasurableEquiv.piFinSuccAbove (fun _ : Fin 3 => ℝ) 0).trans
    (MeasurableEquiv.prodCongr (MeasurableEquiv.refl ℝ) MeasurableEquiv.finTwoArrow)

lemma toProd_mp : MeasurePreserving toProd volume volume := by
  refine (volume_preserving_piFinSuccAbove (fun _ : Fin 3 => ℝ) 0).trans ?_
  rw [Measure.volume_eq_prod, Measure.volume_eq_prod]
  exact (MeasurePreserving.id volume).prod (volume_preserving_finTwoArrow ℝ)

lemma toProd_apply (x : Fin 3 → ℝ) : toProd x = (x 0, x 1, x 2) := rfl

lemma volume_simplex3 : volume simplex3 = ENNReal.ofReal (1 / 6) := by
  have : simplex3 = toProd ⁻¹' tet3 := by
    ext x; simp only [simplex3, tet3, mem_preimage, mem_ofPred_eq, toProd_apply]
  rw [this, toProd_mp.measure_preimage tet3_meas.nullMeasurableSet, volume_tet3]

/-- The open solid tetrahedron with corners p, a, b, c: p + s(a − p) + t(b − p) + u(c − p) with s, t, u > 0 and
s + t + u < 1. -/
def tetra (p a b c : Fin 3 → ℝ) : Set (Fin 3 → ℝ) :=
  {x | ∃ s t u : ℝ, 0 < s ∧ 0 < t ∧ 0 < u ∧ s + t + u < 1 ∧ x = p + s • (a - p) + t • (b - p) + u • (c - p)}

/-- The determinant as js/physics.js writes it (index 0, 1, 2 = x, y, z). -/
def det3 (a b c : Fin 3 → ℝ) : ℝ :=
  a 0 * (b 1 * c 2 - b 2 * c 1) - a 1 * (b 0 * c 2 - b 2 * c 0) + a 2 * (b 0 * c 1 - b 1 * c 0)

/-- **The tetrahedron's volume is |det(a − p, b − p, c − p)|/6**: the code's per-triangle term, up to its sign
(which the winding fixes), is the Lebesgue measure of the solid tetrahedron. -/
theorem volume_tetra (p a b c : Fin 3 → ℝ) :
    volume (tetra p a b c) = ENNReal.ofReal (|det3 (a - p) (b - p) (c - p)| / 6) := by
  -- the edge matrix: its columns are a − p, b − p, c − p
  set A : Matrix (Fin 3) (Fin 3) ℝ := Matrix.of fun i j => (![a - p, b - p, c - p] j) i with hA
  have himg : tetra p a b c = (fun y => p + y) '' (Matrix.toLin' A '' simplex3) := by
    ext x
    simp only [tetra, simplex3, mem_ofPred_eq, mem_image, Matrix.toLin'_apply]
    constructor
    · rintro ⟨s, t, u, hs, ht, hu, hsum, rfl⟩
      refine ⟨Matrix.mulVec A ![s, t, u], ⟨![s, t, u], ⟨by simpa using hs, by simpa using ht, by simpa using hu, by simpa using hsum⟩, rfl⟩, ?_⟩
      ext i
      simp [hA]
      ring
    · rintro ⟨y, ⟨v, ⟨h0, h1, h2, h3⟩, rfl⟩, rfl⟩
      refine ⟨v 0, v 1, v 2, h0, h1, h2, h3, ?_⟩
      ext i
      simp [hA, Matrix.mulVec, dotProduct, Fin.sum_univ_three]
      ring
  rw [himg, image_add_left, measure_preimage_add, Measure.addHaar_image_linearMap, LinearMap.det_toLin', volume_simplex3]
  rw [← ENNReal.ofReal_mul (abs_nonneg _)]
  congr 1
  have : A.det = det3 (a - p) (b - p) (c - p) := by
    rw [Matrix.det_fin_three]; simp [hA, det3]; ring
  rw [this]; ring

end FloatSim.Tetra
