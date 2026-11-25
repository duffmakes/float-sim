import Proofs.Mesh

/-!
# The transcribed `submerged` on a box, at any draft

The algorithm of Proofs/Mesh.lean (js/physics.js `submerged`: clip at the water plane, fan, signed tetrahedra from
the apex on the plane, Green's theorem over the cut segments) run symbolically on a 12-triangle box
[x₀, x₁] × [y₀, y₁] × [z_b, z_t] with the water plane at z = 0 between keel and deck (z_b < 0 < z_t). It returns
exactly the box's wet volume, centre of buoyancy, waterplane area, centroid and second moments, so the formulas
the hydrostatic theorems (Proofs/Hydrostatics.lean `box_KB`, `box_BM`) start from are what the code computes:

* 6V = Σ det = 6·L·B·T with T = −z_b the draft (`box_vol`);
* the first moments give B at the middle of the waterplane, T/2 below it (`box_mom_x`, `_y`, `_z`);
* the waterplane sums give A = L·B, its centroid, and about that centroid I_xx = L·B³/12, I_yy = B·L³/12,
  I_xy = 0, the code's `Ixx/12 − A·cy²` etc. (`box_wp_*`).

The box is the one the tests use (test/models/box_4x2x1.step), at any size, position and draft.
-/

namespace FloatSim.Mesh

section Box
variable (x0 x1 y0 y1 zb zt : ℝ)

/-- The box's 12 triangles, counter-clockwise seen from outside (2 per face). -/
def boxMesh : List Tri :=
  let p000 : P3 := ⟨x0, y0, zb⟩; let p100 : P3 := ⟨x1, y0, zb⟩; let p110 : P3 := ⟨x1, y1, zb⟩; let p010 : P3 := ⟨x0, y1, zb⟩
  let p001 : P3 := ⟨x0, y0, zt⟩; let p101 : P3 := ⟨x1, y0, zt⟩; let p111 : P3 := ⟨x1, y1, zt⟩; let p011 : P3 := ⟨x0, y1, zt⟩
  [⟨p000, p010, p110⟩, ⟨p000, p110, p100⟩,      -- keel (z_b)
   ⟨p001, p101, p111⟩, ⟨p001, p111, p011⟩,      -- deck (z_t)
   ⟨p000, p100, p101⟩, ⟨p000, p101, p001⟩,      -- side y₀
   ⟨p010, p011, p111⟩, ⟨p010, p111, p110⟩,      -- side y₁
   ⟨p000, p001, p011⟩, ⟨p000, p011, p010⟩,      -- end x₀
   ⟨p100, p110, p111⟩, ⟨p100, p111, p101⟩]      -- end x₁

variable {x0 x1 y0 y1 zb zt}

/-- 6V: the wet volume L·B·T, T = −z_b the draft. -/
theorem box_vol (hb : zb < 0) (ht : 0 < zt) :
    ((clipMesh (boxMesh x0 x1 y0 y1 zb zt)).map (D 0)).sum = 6 * ((x1 - x0) * (y1 - y0) * (-zb)) := by
  have ht' : ¬ zt < 0 := not_lt.mpr ht.le
  have hd : zb - zt ≠ 0 := by linarith
  have hd' : zt - zb ≠ 0 := by linarith
  have hd'' : -zb + zt ≠ 0 := by linarith
  simp [clipMesh, boxMesh, clipPoly, segPts, wet, fan, cut, D, det3, hb, ht']
  field_simp
  ring

/-- 24 × the x moment: 24·V·(x₀ + x₁)/2, so B_x = m_x/(24V) is mid-length. -/
theorem box_mom_x (hb : zb < 0) (ht : 0 < zt) :
    ((clipMesh (boxMesh x0 x1 y0 y1 zb zt)).map (Mom P3.x 0)).sum
      = 24 * ((x1 - x0) * (y1 - y0) * (-zb)) * ((x0 + x1) / 2) := by
  have ht' : ¬ zt < 0 := not_lt.mpr ht.le
  have hd : zb - zt ≠ 0 := by linarith
  have hd' : zt - zb ≠ 0 := by linarith
  have hd'' : -zb + zt ≠ 0 := by linarith
  simp [clipMesh, boxMesh, clipPoly, segPts, wet, fan, cut, Mom, D, det3, hb, ht']
  field_simp
  ring

theorem box_mom_y (hb : zb < 0) (ht : 0 < zt) :
    ((clipMesh (boxMesh x0 x1 y0 y1 zb zt)).map (Mom P3.y 0)).sum
      = 24 * ((x1 - x0) * (y1 - y0) * (-zb)) * ((y0 + y1) / 2) := by
  have ht' : ¬ zt < 0 := not_lt.mpr ht.le
  have hd : zb - zt ≠ 0 := by linarith
  have hd' : zt - zb ≠ 0 := by linarith
  have hd'' : -zb + zt ≠ 0 := by linarith
  simp [clipMesh, boxMesh, clipPoly, segPts, wet, fan, cut, Mom, D, det3, hb, ht']
  field_simp
  ring

/-- 24 × the z moment: B is T/2 below the waterline (KB = T/2 from the keel). -/
theorem box_mom_z (hb : zb < 0) (ht : 0 < zt) :
    ((clipMesh (boxMesh x0 x1 y0 y1 zb zt)).map (Mom P3.z 0)).sum
      = 24 * ((x1 - x0) * (y1 - y0) * (-zb)) * (zb / 2) := by
  have ht' : ¬ zt < 0 := not_lt.mpr ht.le
  have hd : zb - zt ≠ 0 := by linarith
  have hd' : zt - zb ≠ 0 := by linarith
  have hd'' : -zb + zt ≠ 0 := by linarith
  simp [clipMesh, boxMesh, clipPoly, segPts, wet, fan, cut, Mom, D, det3, hb, ht']
  field_simp
  ring

/-- The six waterplane sums over the cut segments (`A`, `Ax`, `Ay`, `Iyy`, `Ixx`, `Ixy` before the code divides
them): for the rectangle [x₀, x₁] × [y₀, y₁]. -/
theorem box_wp (hb : zb < 0) (ht : 0 < zt) :
    wpSum 0 (boxMesh x0 x1 y0 y1 zb zt) = 2 * ((x1 - x0) * (y1 - y0)) ∧
    wpSum 1 (boxMesh x0 x1 y0 y1 zb zt) = 6 * ((x1 - x0) * (y1 - y0)) * ((x0 + x1) / 2) ∧
    wpSum 2 (boxMesh x0 x1 y0 y1 zb zt) = 6 * ((x1 - x0) * (y1 - y0)) * ((y0 + y1) / 2) ∧
    wpSum 3 (boxMesh x0 x1 y0 y1 zb zt) = 12 * ((y1 - y0) * (x1 ^ 3 - x0 ^ 3) / 3) ∧
    wpSum 4 (boxMesh x0 x1 y0 y1 zb zt) = 12 * ((x1 - x0) * (y1 ^ 3 - y0 ^ 3) / 3) ∧
    wpSum 5 (boxMesh x0 x1 y0 y1 zb zt) = 24 * ((x1 ^ 2 - x0 ^ 2) / 2 * ((y1 ^ 2 - y0 ^ 2) / 2)) := by
  have ht' : ¬ zt < 0 := not_lt.mpr ht.le
  have hd : zb - zt ≠ 0 := by linarith
  have hd' : zt - zb ≠ 0 := by linarith
  have hd'' : -zb + zt ≠ 0 := by linarith
  refine ⟨?_, ?_, ?_, ?_, ?_, ?_⟩ <;>
  · simp [wpSum, boxMesh, wpSeg_eq, wet, hb, ht', cut, green]
    field_simp
    ring

/-- What `submerged` returns for the box (`V /= 6`, `B = m/(24V)`, `A /= 2`, `cxw = Ax/(6A)`,
`Ixx/12 − A·cyw²`, `Iyy/12 − A·cxw²`, `Ixy/24 − A·cxw·cyw`): the wet volume L·B·T, B at mid-length, mid-breadth and
T/2 below the waterline, the waterplane area L·B with its centroid in the middle, and about that centroid
I_xx = L·B³/12, I_yy = B·L³/12, I_xy = 0. -/
theorem box_submerged (hb : zb < 0) (ht : 0 < zt) (hx : x0 < x1) (hy : y0 < y1) :
    let M := boxMesh x0 x1 y0 y1 zb zt
    let L := x1 - x0; let B := y1 - y0; let T := -zb
    let V := ((clipMesh M).map (D 0)).sum / 6
    let A := wpSum 0 M / 2
    let cx := wpSum 1 M / (6 * A); let cy := wpSum 2 M / (6 * A)
    V = L * B * T ∧
    ((clipMesh M).map (Mom P3.x 0)).sum / (24 * V) = (x0 + x1) / 2 ∧
    ((clipMesh M).map (Mom P3.y 0)).sum / (24 * V) = (y0 + y1) / 2 ∧
    ((clipMesh M).map (Mom P3.z 0)).sum / (24 * V) = -T / 2 ∧
    A = L * B ∧ cx = (x0 + x1) / 2 ∧ cy = (y0 + y1) / 2 ∧
    wpSum 4 M / 12 - A * cy ^ 2 = L * B ^ 3 / 12 ∧
    wpSum 3 M / 12 - A * cx ^ 2 = B * L ^ 3 / 12 ∧
    wpSum 5 M / 24 - A * cx * cy = 0 := by
  intro M L B T V A cx cy
  obtain ⟨w0, w1, w2, w3, w4, w5⟩ := box_wp (x0 := x0) (x1 := x1) (y0 := y0) (y1 := y1) hb ht
  have hL : x1 - x0 ≠ 0 := by linarith
  have hB : y1 - y0 ≠ 0 := by linarith
  have hT : zb ≠ 0 := by linarith
  have hV : V = L * B * T := by simp only [V, M, L, B, T, box_vol hb ht]; ring
  have hA : A = L * B := by simp only [A, M, L, B, w0]; ring
  have hcx : cx = (x0 + x1) / 2 := by simp only [cx, M, hA, L, B, w1]; field_simp
  have hcy : cy = (y0 + y1) / 2 := by simp only [cy, M, hA, L, B, w2]; field_simp
  refine ⟨hV, ?_, ?_, ?_, hA, hcx, hcy, ?_, ?_, ?_⟩
  · simp only [M, box_mom_x hb ht, hV, L, B, T]; field_simp
  · simp only [M, box_mom_y hb ht, hV, L, B, T]; field_simp
  · simp only [M, box_mom_z hb ht, hV, L, B, T]; field_simp
  · simp only [M, w4, hA, hcy, L, B]; ring
  · simp only [M, w3, hA, hcx, L, B]; ring
  · simp only [M, w5, hA, hcx, hcy, L, B]; ring

end Box

end FloatSim.Mesh
