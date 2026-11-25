import Mathlib

/-!
# The code's own volume, centre-of-buoyancy and waterplane formulas

js/physics.js computes everything hydrostatic from a triangle soup:

* `massProperties` (and js/meshcheck.js `signedVolume`): volume and first moments from signed tetrahedra with apex at
  a reference point p, det(a − p, b − p, c − p)/6 per triangle;
* `submerged`: each triangle is clipped against the water plane (the vertices with z < 0 are wet, in coordinates with
  the plane at z = 0), the clipped polygon is fan-triangulated, and the tetrahedra are taken from the apex (0, 0, 0)
  on the plane; the waterplane itself is never meshed;
* the waterplane area and moments come from the cut segments (entry → exit of each clipped triangle) by Green's
  theorem.

This file writes those algorithms down as the code has them and proves what they rely on, for any mesh that is
closed and consistently oriented (every directed edge p→q used as often as q→p, the test js/meshcheck.js applies):

* `vol_apex_indep`, `mom_apex_indep`: the signed volume and first moments do not depend on the reference point;
* `clip_closed`: the clipped triangles together with a lid over the cut segments form a closed, consistently oriented
  surface again: the boundary of the wet part of the body;
* `lid_vol_zero`, `submerged_vol`, `submerged_mom`: from an apex on the water plane the lid contributes nothing, so
  `submerged`'s sums equal the volume and first moments of that closed surface, as computed from any apex;
* `green_indep`: the waterplane sums do not depend on the point the lid is fanned from.

What is taken as given: that a closed, consistently oriented triangulated surface bounds a solid whose volume is
(1/6)·Σ det (the divergence theorem for polyhedra). Proofs/Tetra.lean proves the single tetrahedron's case, and
Proofs/MeshBox.lean runs the transcribed algorithm on a box at any draft and gets its exact volume, centre of
buoyancy and waterplane.
-/

namespace FloatSim.Mesh

/-- A point (x, y, z), metres. -/
@[ext] structure P3 where
  x : ℝ
  y : ℝ
  z : ℝ

namespace P3
instance : Sub P3 := ⟨fun a b => ⟨a.x - b.x, a.y - b.y, a.z - b.z⟩⟩
instance : Zero P3 := ⟨⟨0, 0, 0⟩⟩
@[simp] lemma sub_x (a b : P3) : (a - b).x = a.x - b.x := rfl
@[simp] lemma sub_y (a b : P3) : (a - b).y = a.y - b.y := rfl
@[simp] lemma sub_z (a b : P3) : (a - b).z = a.z - b.z := rfl
@[simp] lemma zero_x : (0 : P3).x = 0 := rfl
@[simp] lemma zero_y : (0 : P3).y = 0 := rfl
@[simp] lemma zero_z : (0 : P3).z = 0 := rfl
end P3

/-- A triangle (a, b, c), counter-clockwise seen from outside. -/
structure Tri where
  a : P3
  b : P3
  c : P3

/-- The determinant exactly as js/physics.js writes it:
`ax*(by*cz − bz*cy) − ay*(bx*cz − bz*cx) + az*(bx*cy − by*cx)`, six times the signed volume of the tetrahedron
(0, a, b, c). -/
def det3 (a b c : P3) : ℝ :=
  a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)

/-- Six times the signed volume of the tetrahedron (p, a, b, c): the code's term with reference point p. -/
def D (p : P3) (t : Tri) : ℝ := det3 (t.a - p) (t.b - p) (t.c - p)

/-- 24 × the first moment ∫ ℓ dV of the tetrahedron (p, a, b, c), for the coordinate ℓ = x, y or z:
D·(ℓ(p) + ℓ(a) + ℓ(b) + ℓ(c)). The code works relative to p and adds V·p afterwards, which is the same (`mom_rel`). -/
def Mom (ℓ : P3 → ℝ) (p : P3) (t : Tri) : ℝ := D p t * (ℓ p + ℓ t.a + ℓ t.b + ℓ t.c)

/-! ## Closed, consistently oriented meshes -/

/-- g is antisymmetric: g v u = −g u v (a function of directed edges that changes sign with the direction). -/
def Antisymm (g : P3 → P3 → ℝ) : Prop := ∀ u v, g v u = -g u v

/-- g summed over the three directed edges a→b, b→c, c→a of a triangle. -/
def bnd (g : P3 → P3 → ℝ) (t : Tri) : ℝ := g t.a t.b + g t.b t.c + g t.c t.a

/-- Closed and consistently oriented, in the form the proofs use: every antisymmetric edge function sums to zero
over the mesh's directed edges (the edges cancel in pairs p→q, q→p). `closed_of_balanced` derives it from the test
js/meshcheck.js applies. -/
def Closed (M : List Tri) : Prop := ∀ g, Antisymm g → (M.map (bnd g)).sum = 0

/-- The directed edges of a triangle. -/
def Tri.edges (t : Tri) : List (P3 × P3) := [(t.a, t.b), (t.b, t.c), (t.c, t.a)]

open Classical in
/-- js/meshcheck.js `meshCheck`: open = misoriented = 0 means each directed edge p→q is used as often as q→p. -/
def Balanced (M : List Tri) : Prop :=
  ∀ u v, (M.flatMap Tri.edges).count (u, v) = (M.flatMap Tri.edges).count (v, u)

lemma lsum_sub {α : Type*} (l : List α) (f g : α → ℝ) :
    (l.map f).sum - (l.map g).sum = (l.map (fun x => f x - g x)).sum := by
  induction l with
  | nil => simp
  | cons a l ih => simp only [List.map_cons, List.sum_cons]; linarith

lemma lsum_neg {α : Type*} (l : List α) (f : α → ℝ) : (l.map (fun x => -f x)).sum = -(l.map f).sum := by
  induction l with
  | nil => simp
  | cons a l ih => simp only [List.map_cons, List.sum_cons, ih]; ring

lemma sum_bnd_eq (g : P3 → P3 → ℝ) (M : List Tri) :
    (M.map (bnd g)).sum = ((M.flatMap Tri.edges).map (fun e => g e.1 e.2)).sum := by
  induction M with
  | nil => simp
  | cons t M ih =>
    simp only [List.map_cons, List.sum_cons, List.flatMap_cons, List.map_append, List.sum_append, ih]
    simp [bnd, Tri.edges]
    ring

open Classical in
/-- The directed-edge balance that js/meshcheck.js tests implies `Closed`. -/
theorem closed_of_balanced (M : List Tri) (h : Balanced M) : Closed M := by
  intro g hg
  rw [sum_bnd_eq]
  set E := M.flatMap Tri.edges
  have hperm : E.Perm (E.map Prod.swap) := by
    rw [List.perm_iff_count]
    intro e
    obtain ⟨u, v⟩ := e
    have hc : ∀ x, (E.map Prod.swap).count x = E.count x.swap := by
      intro x
      have := List.count_map_of_injective E Prod.swap Prod.swap_injective x.swap
      simpa using this
    rw [hc]
    exact h u v
  have h1 : (E.map (fun e => g e.1 e.2)).sum = ((E.map Prod.swap).map (fun e => g e.1 e.2)).sum :=
    (hperm.map _).sum_eq
  have h2 : ((E.map Prod.swap).map (fun e => g e.1 e.2)).sum = -(E.map (fun e => g e.1 e.2)).sum := by
    rw [List.map_map, ← lsum_neg]
    congr 1
    apply List.map_congr_left
    intro e _
    simp [hg e.1 e.2]
  linarith

/-! ## The reference point does not matter -/

/-- The edge function the apex change decomposes into: det(q − p, u − p, v − p). -/
def hApex (p q : P3) (u v : P3) : ℝ := det3 (q - p) (u - p) (v - p)

lemma hApex_antisymm (p q : P3) : Antisymm (hApex p q) := by
  intro u v; simp only [hApex, det3, P3.sub_x, P3.sub_y, P3.sub_z]; ring

/-- One triangle: moving the apex from p to q changes the tetrahedron by a sum over its edges (the boundary of the
4-simplex (p, q, a, b, c) has zero volume in 3D). -/
lemma D_sub (p q : P3) (t : Tri) : D p t - D q t = bnd (hApex p q) t := by
  simp only [D, bnd, hApex, det3, P3.sub_x, P3.sub_y, P3.sub_z]; ring

/-- `massProperties`' volume does not depend on the reference point, for a closed mesh. -/
theorem vol_apex_indep (M : List Tri) (hM : Closed M) (p q : P3) :
    (M.map (D p)).sum = (M.map (D q)).sum := by
  have : (M.map (D p)).sum - (M.map (D q)).sum = (M.map (bnd (hApex p q))).sum := by
    rw [lsum_sub]; congr 1; apply List.map_congr_left; intro t _; exact D_sub p q t
  rw [hM _ (hApex_antisymm p q)] at this; linarith

/-- The first-moment edge function: det(q − p, u − p, v − p)·(ℓ p + ℓ q + ℓ u + ℓ v). -/
def kApex (ℓ : P3 → ℝ) (p q : P3) (u v : P3) : ℝ := hApex p q u v * (ℓ p + ℓ q + ℓ u + ℓ v)

/-- A coordinate: x, y or z (any linear function would do). -/
def IsCoord (ℓ : P3 → ℝ) : Prop := ℓ = P3.x ∨ ℓ = P3.y ∨ ℓ = P3.z

lemma kApex_antisymm (ℓ : P3 → ℝ) (p q : P3) : Antisymm (kApex ℓ p q) := by
  intro u v; simp only [kApex]; rw [hApex_antisymm p q u v]; ring

lemma Mom_sub (ℓ : P3 → ℝ) (hℓ : IsCoord ℓ) (p q : P3) (t : Tri) :
    Mom ℓ p t - Mom ℓ q t = bnd (kApex ℓ p q) t := by
  rcases hℓ with rfl | rfl | rfl <;>
    simp only [Mom, D, bnd, kApex, hApex, det3, P3.sub_x, P3.sub_y, P3.sub_z] <;> ring

/-- The first moments (hence the centroid and the centre of buoyancy) do not depend on the reference point. -/
theorem mom_apex_indep (ℓ : P3 → ℝ) (hℓ : IsCoord ℓ) (M : List Tri) (hM : Closed M) (p q : P3) :
    (M.map (Mom ℓ p)).sum = (M.map (Mom ℓ q)).sum := by
  have : (M.map (Mom ℓ p)).sum - (M.map (Mom ℓ q)).sum = (M.map (bnd (kApex ℓ p q))).sum := by
    rw [lsum_sub]; congr 1; apply List.map_congr_left; intro t _; exact Mom_sub ℓ hℓ p q t
  rw [hM _ (kApex_antisymm ℓ p q)] at this; linarith

/-- The code's first moment is taken relative to p (`det·(a' + b' + c')`, primes relative to p) and the centroid is
shifted back by p afterwards; that is the same as `Mom`: D·(ℓa' + ℓb' + ℓc') + 4·D·ℓ(p) = D·(ℓp + ℓa + ℓb + ℓc). -/
lemma mom_rel (p : P3) (t : Tri) :
    D p t * ((t.a - p).x + (t.b - p).x + (t.c - p).x) + 4 * D p t * p.x = Mom P3.x p t := by
  simp only [Mom, P3.sub_x]; ring

/-! ## `massProperties`, as the code computes it

js/physics.js `massProperties(tris, ref)` works in coordinates relative to the reference point p (the top centre of
the bounding box by default): `det` of the relative corners, `V += det/6`, `c += det·(a' + b' + c')/24`,
`C += det/120·(a'a'ᵀ + b'b'ᵀ + c'c'ᵀ + s's'ᵀ)` with s' = a' + b' + c'; then centroid = c/V + p and
C − V·cen'·cen'ᵀ about the centroid, I = tr(C)·E − C. Below, ℓ and m are coordinates (x, y or z). -/

/-- 120 × ∫ ℓ·m dV over the tetrahedron (p, a, b, c), absolute coordinates. -/
def Cov (ℓ m : P3 → ℝ) (p : P3) (t : Tri) : ℝ :=
  D p t * (ℓ p * m p + ℓ t.a * m t.a + ℓ t.b * m t.b + ℓ t.c * m t.c
    + (ℓ p + ℓ t.a + ℓ t.b + ℓ t.c) * (m p + m t.a + m t.b + m t.c))

lemma Cov_sub (ℓ m : P3 → ℝ) (hℓ : IsCoord ℓ) (hm : IsCoord m) (p q : P3) (t : Tri) :
    Cov ℓ m p t - Cov ℓ m q t = bnd (fun u v => Cov ℓ m p ⟨q, u, v⟩) t := by
  rcases hℓ with rfl | rfl | rfl <;> rcases hm with rfl | rfl | rfl <;>
    simp only [Cov, D, bnd, det3, P3.sub_x, P3.sub_y, P3.sub_z] <;> ring

lemma Cov_edge_antisymm (ℓ m : P3 → ℝ) (p q : P3) : Antisymm (fun u v => Cov ℓ m p ⟨q, u, v⟩) := by
  intro u v; simp only [Cov, D, det3, P3.sub_x, P3.sub_y, P3.sub_z]; ring

theorem cov_apex_indep (ℓ m : P3 → ℝ) (hℓ : IsCoord ℓ) (hm : IsCoord m) (M : List Tri) (hM : Closed M) (p q : P3) :
    (M.map (Cov ℓ m p)).sum = (M.map (Cov ℓ m q)).sum := by
  have : (M.map (Cov ℓ m p)).sum - (M.map (Cov ℓ m q)).sum = (M.map (bnd (fun u v => Cov ℓ m p ⟨q, u, v⟩))).sum := by
    rw [lsum_sub]; congr 1; apply List.map_congr_left; intro t _; exact Cov_sub ℓ m hℓ hm p q t
  rw [hM _ (Cov_edge_antisymm ℓ m p q)] at this; linarith

/-- The code's sums, relative to p: `det` of a − p, b − p, c − p and the relative corners. -/
def relDet (p : P3) (t : Tri) : ℝ := det3 (t.a - p) (t.b - p) (t.c - p)
noncomputable def codeV (p : P3) (M : List Tri) : ℝ := (M.map (fun t => relDet p t / 6)).sum
noncomputable def codeC1 (ℓ : P3 → ℝ) (p : P3) (M : List Tri) : ℝ :=
  (M.map (fun t => relDet p t * (ℓ (t.a - p) + ℓ (t.b - p) + ℓ (t.c - p)) / 24)).sum
noncomputable def codeC2 (ℓ m : P3 → ℝ) (p : P3) (M : List Tri) : ℝ :=
  (M.map (fun t => relDet p t / 120 * (ℓ (t.a - p) * m (t.a - p) + ℓ (t.b - p) * m (t.b - p) + ℓ (t.c - p) * m (t.c - p)
    + (ℓ (t.a - p) + ℓ (t.b - p) + ℓ (t.c - p)) * (m (t.a - p) + m (t.b - p) + m (t.c - p))))).sum
/-- `centroid = c/V + p`. -/
noncomputable def codeCen (ℓ : P3 → ℝ) (p : P3) (M : List Tri) : ℝ := codeC1 ℓ p M / codeV p M + ℓ p
/-- `C − V·cen'·cen'ᵀ`: the covariance about the centroid (cen' = c/V, the centroid relative to p). -/
noncomputable def codeCovG (ℓ m : P3 → ℝ) (p : P3) (M : List Tri) : ℝ :=
  codeC2 ℓ m p M - codeV p M * (codeC1 ℓ p M / codeV p M) * (codeC1 m p M / codeV p M)

lemma coord_sub (ℓ : P3 → ℝ) (hℓ : IsCoord ℓ) (a b : P3) : ℓ (a - b) = ℓ a - ℓ b := by
  rcases hℓ with rfl | rfl | rfl <;> rfl

lemma codeV_eq (p : P3) (M : List Tri) : codeV p M = (M.map (D p)).sum / 6 := by
  induction M with
  | nil => simp [codeV]
  | cons t M ih => simp only [codeV, List.map_cons, List.sum_cons] at ih ⊢; rw [ih]; simp only [relDet, D]; ring

lemma codeC1_eq (ℓ : P3 → ℝ) (hℓ : IsCoord ℓ) (p : P3) (M : List Tri) :
    codeC1 ℓ p M = (M.map (Mom ℓ p)).sum / 24 - ℓ p * ((M.map (D p)).sum / 6) := by
  induction M with
  | nil => simp [codeC1]
  | cons t M ih =>
    simp only [codeC1, List.map_cons, List.sum_cons] at ih ⊢; rw [ih]
    simp only [relDet, Mom, D, coord_sub ℓ hℓ]; ring

lemma codeC2_eq (ℓ m : P3 → ℝ) (hℓ : IsCoord ℓ) (hm : IsCoord m) (p : P3) (M : List Tri) :
    codeC2 ℓ m p M = (M.map (Cov ℓ m p)).sum / 120 - ℓ p * ((M.map (Mom m p)).sum / 24)
      - m p * ((M.map (Mom ℓ p)).sum / 24) + ℓ p * m p * ((M.map (D p)).sum / 6) := by
  induction M with
  | nil => simp [codeC2]
  | cons t M ih =>
    simp only [codeC2, List.map_cons, List.sum_cons] at ih ⊢; rw [ih]
    simp only [relDet, Cov, Mom, D, coord_sub ℓ hℓ, coord_sub m hm]; ring

/-- `massProperties`' volume does not depend on its reference point (closed mesh). -/
theorem massProperties_volume_indep (M : List Tri) (hM : Closed M) (p q : P3) : codeV p M = codeV q M := by
  rw [codeV_eq, codeV_eq, vol_apex_indep M hM p q]

/-- `massProperties`' centroid does not depend on its reference point (closed mesh, non-zero volume). -/
theorem massProperties_centroid_indep (ℓ : P3 → ℝ) (hℓ : IsCoord ℓ) (M : List Tri) (hM : Closed M) (p q : P3)
    (hV : (M.map (D p)).sum ≠ 0) : codeCen ℓ p M = codeCen ℓ q M := by
  have hVq : (M.map (D q)).sum ≠ 0 := by rwa [← vol_apex_indep M hM p q]
  simp only [codeCen, codeC1_eq ℓ hℓ, codeV_eq]
  rw [mom_apex_indep ℓ hℓ M hM p q, vol_apex_indep M hM p q]
  field_simp
  ring

/-- `massProperties`' covariance about the centroid (hence its inertia tensor tr(C)·E − C) does not depend on its
reference point (closed mesh, non-zero volume). -/
theorem massProperties_inertia_indep (ℓ m : P3 → ℝ) (hℓ : IsCoord ℓ) (hm : IsCoord m) (M : List Tri) (hM : Closed M)
    (p q : P3) (hV : (M.map (D p)).sum ≠ 0) : codeCovG ℓ m p M = codeCovG ℓ m q M := by
  have hVq : (M.map (D q)).sum ≠ 0 := by rwa [← vol_apex_indep M hM p q]
  simp only [codeCovG, codeC2_eq ℓ m hℓ hm, codeC1_eq ℓ hℓ, codeC1_eq m hm, codeV_eq]
  rw [cov_apex_indep ℓ m hℓ hm M hM p q, mom_apex_indep ℓ hℓ M hM p q, mom_apex_indep m hm M hM p q,
    vol_apex_indep M hM p q]
  field_simp
  ring

/-! ## Clipping at the water plane, as `submerged` does it

Coordinates are relative to the water plane (the code's `z − zw`), so the plane is z = 0 and a vertex is wet when
z < 0. -/

/-- A vertex is wet (`inside[k] = z < 0`). -/
def wet (u : P3) : Prop := u.z < 0

/-- Where the edge u→v crosses the plane: `t = za/(za − zb)`, x and y interpolated, z set to 0. -/
noncomputable def cut (u v : P3) : P3 :=
  ⟨u.x + u.z / (u.z - v.z) * (v.x - u.x), u.y + u.z / (u.z - v.z) * (v.y - u.y), 0⟩

/-- Both triangles sharing an edge put the cut at the same point. -/
lemma cut_symm (u v : P3) (h : u.z ≠ v.z) : cut u v = cut v u := by
  have h1 : u.z - v.z ≠ 0 := sub_ne_zero.mpr h
  have h2 : v.z - u.z ≠ 0 := sub_ne_zero.mpr (Ne.symm h)
  ext <;> simp only [cut]
  · field_simp; ring
  · field_simp; ring

open Classical in
/-- The points one edge a→b adds to the clipped polygon: a if it is wet, then the crossing point if the edge crosses
(`if (inside[a]) push a; if (inside[a] !== inside[b]) push crossing`). -/
noncomputable def segPts (u v : P3) : List P3 :=
  (if wet u then [u] else []) ++ (if (wet u ↔ wet v) then [] else [cut u v])

/-- The clipped polygon of a triangle (the code's P). For a fully wet triangle it is the triangle itself
(`clipPoly_all_wet`), the code's `nIn === 3` shortcut; a dry one gives [] (`nIn === 0`). -/
noncomputable def clipPoly (t : Tri) : List P3 := segPts t.a t.b ++ segPts t.b t.c ++ segPts t.c t.a

lemma clipPoly_all_wet (t : Tri) (ha : wet t.a) (hb : wet t.b) (hc : wet t.c) :
    clipPoly t = [t.a, t.b, t.c] := by
  simp [clipPoly, segPts, ha, hb, hc]

/-- Fan triangulation from the first point: (P₀, P_k, P_{k+1}) for k = 1 … n − 2 (`for (k = 1; k + 1 < n; k++)`). -/
def fan : List P3 → List Tri
  | [] => []
  | p0 :: rest => (rest.zip rest.tail).map (fun qr => ⟨p0, qr.1, qr.2⟩)

/-- The wet triangles `submerged` sums over. -/
noncomputable def clipMesh (M : List Tri) : List Tri := M.flatMap (fun t => fan (clipPoly t))

open Classical in
/-- The exit point of a triangle (an edge from a wet to a dry vertex), as a list of 0 or 1 points. -/
noncomputable def exits (t : Tri) : List P3 :=
  (t.edges.filter (fun e => wet e.1 ∧ ¬ wet e.2)).map (fun e => cut e.1 e.2)

open Classical in
/-- The entry point (an edge from a dry to a wet vertex). -/
noncomputable def entries (t : Tri) : List P3 :=
  (t.edges.filter (fun e => ¬ wet e.1 ∧ wet e.2)).map (fun e => cut e.1 e.2)

/-- The cut segment of a triangle, entry → exit (`if (hasEn && hasEx)`); the code's Green's-theorem sums run over
these. -/
noncomputable def wpSeg (t : Tri) : List (P3 × P3) :=
  match entries t, exits t with
  | [e], [x] => [(e, x)]
  | _, _ => []

/-! The cut segment entry → exit of a triangle, for each pattern of wet (w) and dry (d) corners a, b, c. -/
section wpSegCases
variable {a b c : P3}
lemma wpSeg_www (ha : wet a) (hb : wet b) (hc : wet c) : wpSeg ⟨a, b, c⟩ = [] := by
  simp [wpSeg, entries, exits, Tri.edges, ha, hb, hc]
lemma wpSeg_ddd (ha : ¬ wet a) (hb : ¬ wet b) (hc : ¬ wet c) : wpSeg ⟨a, b, c⟩ = [] := by
  simp [wpSeg, entries, exits, Tri.edges, ha, hb, hc]
lemma wpSeg_wwd (ha : wet a) (hb : wet b) (hc : ¬ wet c) : wpSeg ⟨a, b, c⟩ = [(cut c a, cut b c)] := by
  simp [wpSeg, entries, exits, Tri.edges, ha, hb, hc]
lemma wpSeg_wdw (ha : wet a) (hb : ¬ wet b) (hc : wet c) : wpSeg ⟨a, b, c⟩ = [(cut b c, cut a b)] := by
  simp [wpSeg, entries, exits, Tri.edges, ha, hb, hc]
lemma wpSeg_dww (ha : ¬ wet a) (hb : wet b) (hc : wet c) : wpSeg ⟨a, b, c⟩ = [(cut a b, cut c a)] := by
  simp [wpSeg, entries, exits, Tri.edges, ha, hb, hc]
lemma wpSeg_wdd (ha : wet a) (hb : ¬ wet b) (hc : ¬ wet c) : wpSeg ⟨a, b, c⟩ = [(cut c a, cut a b)] := by
  simp [wpSeg, entries, exits, Tri.edges, ha, hb, hc]
lemma wpSeg_dwd (ha : ¬ wet a) (hb : wet b) (hc : ¬ wet c) : wpSeg ⟨a, b, c⟩ = [(cut a b, cut b c)] := by
  simp [wpSeg, entries, exits, Tri.edges, ha, hb, hc]
lemma wpSeg_ddw (ha : ¬ wet a) (hb : ¬ wet b) (hc : wet c) : wpSeg ⟨a, b, c⟩ = [(cut b c, cut c a)] := by
  simp [wpSeg, entries, exits, Tri.edges, ha, hb, hc]
open Classical in
/-- All eight patterns in one rewrite rule. -/
lemma wpSeg_eq : wpSeg ⟨a, b, c⟩ =
    if wet a then (if wet b then (if wet c then [] else [(cut c a, cut b c)])
      else (if wet c then [(cut b c, cut a b)] else [(cut c a, cut a b)]))
    else (if wet b then (if wet c then [(cut a b, cut c a)] else [(cut a b, cut b c)])
      else (if wet c then [(cut b c, cut c a)] else [])) := by
  by_cases ha : wet a <;> by_cases hb : wet b <;> by_cases hc : wet c <;> simp only [ha, hb, hc, ite_true, ite_false]
  · exact wpSeg_www ha hb hc
  · exact wpSeg_wwd ha hb hc
  · exact wpSeg_wdw ha hb hc
  · exact wpSeg_wdd ha hb hc
  · exact wpSeg_dww ha hb hc
  · exact wpSeg_dwd ha hb hc
  · exact wpSeg_ddw ha hb hc
  · exact wpSeg_ddd ha hb hc
end wpSegCases

/-- The lid: the waterplane fanned from a point w over the cut segments, (w, entry, exit). It closes the wet surface
from above (its edges entry → exit run opposite to the clipped polygons' exit → entry). -/
noncomputable def lid (w : P3) (M : List Tri) : List Tri :=
  (M.flatMap wpSeg).map (fun s => ⟨w, s.1, s.2⟩)

/-- g on the wet part of the directed edge u→v (0 if the edge is dry). -/
noncomputable def gWet (g : P3 → P3 → ℝ) (u v : P3) : ℝ := by
  classical
  exact if wet u ∧ wet v then g u v
    else if wet u ∧ ¬ wet v then g u (cut u v)
    else if ¬ wet u ∧ wet v then g (cut u v) v
    else 0

lemma wet_ne {u v : P3} (hu : wet u) (hv : ¬ wet v) : u.z ≠ v.z := by
  unfold wet at hu hv; intro h; rw [h] at hu; exact hv hu

lemma gWet_antisymm (g : P3 → P3 → ℝ) (hg : Antisymm g) : Antisymm (gWet g) := by
  intro u v
  by_cases hu : wet u <;> by_cases hv : wet v
  · simp [gWet, hu, hv, hg u v]
  · simp [gWet, hu, hv, cut_symm u v (wet_ne hu hv)]; exact hg _ _
  · simp [gWet, hu, hv, cut_symm v u (wet_ne hv hu)]; exact hg _ _
  · simp [gWet, hu, hv]

/-- g around a polygon's closed boundary P₀→P₁→…→P₀. -/
def polyBnd (g : P3 → P3 → ℝ) : List P3 → ℝ
  | [] => 0
  | p0 :: rest => (((p0 :: rest).zip (rest ++ [p0])).map (fun e => g e.1 e.2)).sum

/-- The clipped polygon of a triangle: its fan has the boundary of the wet parts of the three edges plus the closing
cut segment exit → entry. -/
lemma fan_clip_bnd (g : P3 → P3 → ℝ) (hg : Antisymm g) (t : Tri) :
    ((fan (clipPoly t)).map (bnd g)).sum
      = gWet g t.a t.b + gWet g t.b t.c + gWet g t.c t.a
        + ((wpSeg t).map (fun s => g s.2 s.1)).sum := by
  obtain ⟨a, b, c⟩ := t
  by_cases ha : wet a <;> by_cases hb : wet b <;> by_cases hc : wet c <;>
    simp [clipPoly, segPts, fan, bnd, gWet, wpSeg, entries, exits, Tri.edges, ha, hb, hc] <;>
    linarith [hg a b, hg b c, hg c a, hg a (cut b c), hg (cut b c) (cut c a), hg (cut c a) a,
      hg b (cut c a), hg (cut a b) b, hg (cut a b) (cut b c), hg c (cut a b), hg (cut b c) c,
      hg (cut c a) (cut a b), hg a (cut a b), hg (cut c a) c, hg b (cut b c),
      hg (cut a b) (cut c a), hg (cut b c) (cut a b), hg (cut c a) (cut b c)]

/-- Every exit point is matched by an entry point at the same place on the neighbouring triangle: for any φ, φ summed
over the entries equals φ summed over the exits. -/
lemma entries_exits (φ : P3 → ℝ) (M : List Tri) (hM : Closed M) :
    ((M.flatMap wpSeg).map (fun s => φ s.1)).sum = ((M.flatMap wpSeg).map (fun s => φ s.2)).sum := by
  classical
  let F : P3 → P3 → ℝ := fun u v =>
    (if wet u ∧ ¬ wet v then φ (cut u v) else 0) - (if ¬ wet u ∧ wet v then φ (cut u v) else 0)
  have hF : Antisymm F := by
    intro u v
    by_cases hu : wet u <;> by_cases hv : wet v
    · simp [F, hu, hv]
    · simp [F, hu, hv, cut_symm u v (wet_ne hu hv)]
    · simp [F, hu, hv, cut_symm v u (wet_ne hv hu)]
    · simp [F, hu, hv]
  have key : ∀ t : Tri, bnd F t = ((wpSeg t).map (fun s => φ s.2)).sum - ((wpSeg t).map (fun s => φ s.1)).sum := by
    intro t
    obtain ⟨a, b, c⟩ := t
    by_cases ha : wet a <;> by_cases hb : wet b <;> by_cases hc : wet c <;>
      simp [bnd, F, wpSeg, entries, exits, Tri.edges, ha, hb, hc] <;> ring
  have h0 := hM F hF
  have hsum : ∀ N : List Tri, (N.map (bnd F)).sum
      = ((N.flatMap wpSeg).map (fun s => φ s.2)).sum - ((N.flatMap wpSeg).map (fun s => φ s.1)).sum := by
    intro N
    induction N with
    | nil => simp
    | cons t N ih =>
      simp only [List.map_cons, List.sum_cons, List.flatMap_cons, List.map_append, List.sum_append, key t, ih]
      ring
  rw [hsum M] at h0
  linarith

lemma lsum_add {α : Type*} (l : List α) (f g : α → ℝ) :
    (l.map (fun x => f x + g x)).sum = (l.map f).sum + (l.map g).sum := by
  induction l with
  | nil => simp
  | cons a l ih => simp only [List.map_cons, List.sum_cons, ih]; ring

/-- Summing the clipped fans: the wet parts of all edges, plus the closing cut segments exit → entry. -/
lemma clip_sum (g : P3 → P3 → ℝ) (hg : Antisymm g) (M : List Tri) :
    ((clipMesh M).map (bnd g)).sum
      = (M.map (bnd (gWet g))).sum + ((M.flatMap wpSeg).map (fun s => g s.2 s.1)).sum := by
  induction M with
  | nil => simp [clipMesh]
  | cons t M ih =>
    have e1 : clipMesh (t :: M) = fan (clipPoly t) ++ clipMesh M := by simp [clipMesh]
    rw [e1, List.map_append, List.sum_append, ih, fan_clip_bnd g hg t]
    simp only [List.map_cons, List.sum_cons, List.flatMap_cons, List.map_append, List.sum_append, bnd]
    ring

/-- The clipped (wet) triangles and the lid over the cut segments form a closed, consistently oriented surface: the
boundary of the wet part of the body. -/
theorem clip_closed (M : List Tri) (hM : Closed M) (w : P3) : Closed (clipMesh M ++ lid w M) := by
  intro g hg
  rw [List.map_append, List.sum_append, clip_sum g hg M, hM _ (gWet_antisymm g hg)]
  have hl : ((lid w M).map (bnd g)).sum
      = ((M.flatMap wpSeg).map (fun s => g w s.1 + g s.1 s.2 + g s.2 w)).sum := by
    simp only [lid, List.map_map]; rfl
  rw [hl]
  have he := entries_exits (g w) M hM
  have : ∀ s : P3 × P3, g s.2 s.1 + (g w s.1 + g s.1 s.2 + g s.2 w) = g w s.1 - g w s.2 := by
    intro s; rw [hg s.1 s.2, hg w s.2]; ring
  rw [zero_add, ← lsum_add]
  simp only [this]
  rw [← lsum_sub, he, sub_self]

/-- A triangle lying in the water plane, seen from an apex on the plane, has no volume. -/
lemma D_flat (t : Tri) (ha : t.a.z = 0) (hb : t.b.z = 0) (hc : t.c.z = 0) : D 0 t = 0 := by
  simp [D, det3, ha, hb, hc]

lemma cut_z (u v : P3) : (cut u v).z = 0 := rfl

lemma wpSeg_z (t : Tri) : ∀ s ∈ wpSeg t, s.1.z = 0 ∧ s.2.z = 0 := by
  intro s hs
  unfold wpSeg at hs
  split at hs
  · rename_i e x he hx
    simp only [List.mem_singleton] at hs
    subst hs
    have h1 : e ∈ entries t := by rw [he]; simp
    have h2 : x ∈ exits t := by rw [hx]; simp
    simp only [entries, exits, List.mem_map] at h1 h2
    obtain ⟨_, _, rfl⟩ := h1
    obtain ⟨_, _, rfl⟩ := h2
    exact ⟨rfl, rfl⟩
  · simp at hs

/-- The lid contributes nothing from an apex on the plane: the reason `submerged` never meshes the waterplane. -/
theorem lid_vol_zero (M : List Tri) : ((lid 0 M).map (D 0)).sum = 0 := by
  have : ∀ s ∈ M.flatMap wpSeg, D 0 ⟨0, s.1, s.2⟩ = 0 := by
    intro s hs
    obtain ⟨t, _, ht⟩ := List.mem_flatMap.mp hs
    obtain ⟨h1, h2⟩ := wpSeg_z t s ht
    exact D_flat _ rfl h1 h2
  simp only [lid, List.map_map]
  rw [List.sum_eq_zero]
  intro x hx
  obtain ⟨s, hs, rfl⟩ := List.mem_map.mp hx
  exact this s hs

theorem lid_mom_zero (ℓ : P3 → ℝ) (M : List Tri) : ((lid 0 M).map (Mom ℓ 0)).sum = 0 := by
  have : ∀ s ∈ M.flatMap wpSeg, Mom ℓ 0 ⟨0, s.1, s.2⟩ = 0 := by
    intro s hs
    obtain ⟨t, _, ht⟩ := List.mem_flatMap.mp hs
    obtain ⟨h1, h2⟩ := wpSeg_z t s ht
    have hz : D 0 ⟨0, s.1, s.2⟩ = 0 := D_flat ⟨0, s.1, s.2⟩ rfl h1 h2
    simp only [Mom, hz, zero_mul]
  simp only [lid, List.map_map]
  rw [List.sum_eq_zero]
  intro x hx
  obtain ⟨s, hs, rfl⟩ := List.mem_map.mp hx
  exact this s hs

/-- `submerged`'s volume: 6V = Σ det over the clipped triangles from the apex (0, 0, 0) on the water plane. For a
closed mesh this is the signed volume of the closed wet surface (clipped triangles + lid), computed from any apex q:
leaving the waterplane out is exact. -/
theorem submerged_vol (M : List Tri) (hM : Closed M) (q : P3) :
    ((clipMesh M).map (D 0)).sum = ((clipMesh M ++ lid 0 M).map (D q)).sum := by
  rw [← vol_apex_indep _ (clip_closed M hM 0) 0 q, List.map_append, List.sum_append, lid_vol_zero, add_zero]

/-- `submerged`'s first moments, `mx += det·(ax + bx + cx)` (apex at 0, so ℓ(apex) = 0): the first moments of the
closed wet surface from any apex. B = m/(24V) is therefore the centroid of the wet volume. -/
theorem submerged_mom (ℓ : P3 → ℝ) (hℓ : IsCoord ℓ) (M : List Tri) (hM : Closed M) (q : P3) :
    ((clipMesh M).map (Mom ℓ 0)).sum = ((clipMesh M ++ lid 0 M).map (Mom ℓ q)).sum := by
  rw [← mom_apex_indep ℓ hℓ _ (clip_closed M hM 0) 0 q, List.map_append, List.sum_append, lid_mom_zero, add_zero]

/-- The code's moment term relative to the apex 0 is `det·(ax + bx + cx)`. -/
lemma mom_code (ℓ : P3 → ℝ) (hℓ : IsCoord ℓ) (t : Tri) :
    Mom ℓ 0 t = det3 t.a t.b t.c * (ℓ t.a + ℓ t.b + ℓ t.c) := by
  have h0 : ℓ 0 = 0 := by rcases hℓ with rfl | rfl | rfl <;> rfl
  have hD : D 0 t = det3 t.a t.b t.c := by
    have e : ∀ u : P3, u - 0 = u := fun u => by ext <;> simp
    simp only [D, e]
  rw [Mom, h0, hD]; ring

/-! ## The waterplane by Green's theorem

`submerged` sums, over the cut segments (x₀, y₀) = entry → (x₁, y₁) = exit, with c = x₀y₁ − x₁y₀:
2A = Σ c, 6∫x = Σ (x₀ + x₁)c, 6∫y = Σ (y₀ + y₁)c, 12∫x² = Σ (x₀² + x₀x₁ + x₁²)c, 12∫y² = Σ (y₀² + y₀y₁ + y₁²)c,
24∫xy = Σ (x₀y₁ + 2x₀y₀ + 2x₁y₁ + x₁y₀)c. Each term is that quantity for the triangle (origin, entry, exit), and for
any triangle the quantity is the same term summed over its three edges (the edges through the origin add 0). -/

/-- The code's per-segment Green's-theorem terms, k = 0 … 5: area, x and y moments, x², y², xy. -/
def green (k : Fin 6) (u v : P3) : ℝ :=
  let c := u.x * v.y - v.x * u.y
  match k with
  | 0 => c
  | 1 => (u.x + v.x) * c
  | 2 => (u.y + v.y) * c
  | 3 => (u.x * u.x + u.x * v.x + v.x * v.x) * c
  | 4 => (u.y * u.y + u.y * v.y + v.y * v.y) * c
  | 5 => (u.x * v.y + 2 * u.x * u.y + 2 * v.x * v.y + v.x * u.y) * c

lemma green_antisymm (k : Fin 6) : Antisymm (green k) := by
  intro u v; fin_cases k <;> simp [green] <;> ring

/-- `submerged`'s waterplane sums: the green terms over the cut segments entry → exit. -/
noncomputable def wpSum (k : Fin 6) (M : List Tri) : ℝ := ((M.flatMap wpSeg).map (fun s => green k s.1 s.2)).sum

/-- The waterplane sums do not depend on where the waterplane is fanned from: summed over the lid triangles
(w, entry, exit), each taken round its three edges, they are the code's segment sums, for any w. So they are the
area and moments of the waterplane, whatever its shape (any number of separate or holed waterplane regions). -/
theorem green_indep (k : Fin 6) (M : List Tri) (hM : Closed M) (w : P3) :
    ((lid w M).map (bnd (green k))).sum = wpSum k M := by
  have he := entries_exits (green k w) M hM
  have hl : ((lid w M).map (bnd (green k))).sum
      = ((M.flatMap wpSeg).map (fun s => green k w s.1 + green k s.1 s.2 + green k s.2 w)).sum := by
    simp only [lid, List.map_map]; rfl
  have : ∀ s : P3 × P3, green k w s.1 + green k s.1 s.2 + green k s.2 w
      = green k s.1 s.2 + (green k w s.1 - green k w s.2) := by
    intro s; rw [green_antisymm k w s.2]; ring
  rw [hl]; simp only [this]
  rw [lsum_add, ← lsum_sub, he, sub_self, add_zero]; rfl

end FloatSim.Mesh
