import Mathlib

/-!
# Wave phase at another point

Float Sim's incident wave is η = Re{e^{iωt} e^{−ik(x cos β + y sin β)}} (js/bem.js, js/hydro.js), with the phase
measured at G. When the RAOs are reported at another point O = G + d (js/refcsys.js `raoAtPoint`), the phase is
measured from the wave at O instead, so every RAO is multiplied by e^{+ik(d_x cos β + d_y sin β)}. This file
proves that factor is exactly the ratio of the wave at G to the wave at O.

Tests that check the code against it: test/validate-refcsys.js (`refcsys_rao`: amplitude and phase of a point's
motion against the time-domain simulation).
-/

namespace FloatSim.WavePhase

open Complex

/-- Complex amplitude of the unit incident wave at horizontal position (x, y), wavenumber k, heading β. -/
noncomputable def wave (k β x y : ℝ) : ℂ := exp (-(I * (k * (x * Real.cos β + y * Real.sin β))))

/-- The wave at G + d is the wave at G times e^{−ik(d_x cos β + d_y sin β)}. -/
theorem wave_shift (k β gx gy dx dy : ℝ) :
    wave k β (gx + dx) (gy + dy) = wave k β gx gy * wave k β dx dy := by
  unfold wave
  rw [← Complex.exp_add]
  congr 1
  push_cast
  ring

/-- A response referenced to the wave at G, re-referenced to the wave at O = G + d, is multiplied by
e^{+ik(d_x cos β + d_y sin β)}: (response / wave at O) = (response / wave at G) · e^{+ik·d}. -/
theorem rao_at_point (k β gx gy dx dy : ℝ) (ξ : ℂ) :
    ξ / wave k β (gx + dx) (gy + dy) =
      ξ / wave k β gx gy * exp (I * (k * (dx * Real.cos β + dy * Real.sin β))) := by
  rw [wave_shift]
  unfold wave
  rw [div_mul_eq_div_div, div_eq_mul_inv (ξ / _), ← Complex.exp_neg, neg_neg]

end FloatSim.WavePhase
