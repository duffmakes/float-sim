// Drop / rise test validation (closed forms), run by validate-core.js.
//  [NEW]  Newton's quadratic drag F = ½ρC_dA v²  ⇒ terminal speed v_t = √(2 F_net / (ρ C_d A))
//  [HOE]  Hoerner, Fluid-Dynamic Drag (1965): sphere C_d ≈ 0.47 (subcritical)
//  [LAMB] Lamb, Hydrodynamics §92: added mass of a sphere = ½ ρ V
import { mat3, transformTris, solveWaterline, submerged } from '../js/physics.js';
import { DropSim } from '../js/sim.js';

const G = 9.80665;

export async function runDropValidation({ getTris, chkFactory }) {
  const out = [];
  const tris = await getTris('sphere_r1.step', 'coarse');   // closed forms use the mesh's own volume
  const r = 1, center = [0, 0, 1], V = 4 / 3 * Math.PI * r ** 3, rhoW = 1000, rhoA = 1.225;
  const body = transformTris(tris, mat3.identity(), center);       // relative to the CoG at the centre
  const Vm = submerged(body, 2).V;                                    // the mesh's own (fully submerged) volume
  const I = (m) => { const k = 0.4 * m * r * r; return [k, 0, 0, 0, k, 0, 0, 0, k]; };
  const make = (o) => new DropSim({ bodyTris: body, inertiaG: I(o.mass), rhoW, rhoA, q0: [0, 0, 0, 1], wRef: 3, ...o });
  const Ap = Math.PI * r * r;
  const { rows, chk } = chkFactory();

  // 1 — free fall in air without drag: z = z0 − ½ g(1 − ρa V/m) t²
  {
    const m = 50, sim = make({ mass: m, z0: 100, CdA: 0 });
    sim.advance(2.0, 1e7);
    const geff = G * (1 - rhoA * Vm / m);
    chk('free fall (C_d = 0): height after 2 s', sim.p[2], 100 - 0.5 * geff * 4, 1e-4);
  }
  // 2 — terminal velocity in air, sphere C_d = 0.47
  {
    const m = 50, sim = make({ mass: m, z0: 2000, CdA: 0.47 });
    sim.advance(60, 1e8);
    const vt = Math.sqrt(2 * (m - rhoA * Vm) * G / (rhoA * 0.47 * Ap));
    chk('terminal speed in air (C_d 0.47)', -sim.v[2], vt, 0.01);
  }
  // 3 — rising from depth: initial acceleration with added mass ½ρV, then terminal rise speed
  {
    const m = 0.5 * rhoW * V;
    const sim = make({ mass: m, z0: -300, CdW: 0, addedMass: [0.5 * rhoW * Vm, 0.5 * rhoW * Vm, 0.5 * rhoW * Vm] });
    sim.advance(0.05, 1e7);
    const a0 = (rhoW * Vm - m - rhoA * 0) * G / (m + 0.5 * rhoW * Vm);
    chk('submerged release: initial acceleration = (ρV − m)g/(m + ½ρV)', sim.v[2] / sim.t, a0, 0.005);
    const sim2 = make({ mass: m, z0: -400, CdW: 0.47, addedMass: [0.5 * rhoW * Vm, 0.5 * rhoW * Vm, 0.5 * rhoW * Vm] });
    sim2.advance(40, 1e8);
    const vt = Math.sqrt(2 * (rhoW * Vm - m) * G / (rhoW * 0.47 * Ap));
    chk('terminal rise speed in water (C_d 0.47)', sim2.v[2], vt, 0.01);
  }
  // 4 — rises, breaks the surface and settles at the static float position
  {
    const m = 0.5 * rhoW * V;
    const sim = make({ mass: m, z0: -5, CdW: 0.47, addedMass: [0.5 * rhoW * Vm, 0.5 * rhoW * Vm, 0.5 * rhoW * Vm], zetaRot: 0.1 });
    while (!sim.settled() && sim.t < 300) sim.advance(1, 1e7);
    const zEq = -solveWaterline(body, m / rhoW).zw;                    // CoG height above water at equilibrium
    chk('settles after rising from 5 m depth', sim.settled() ? 1 : 0, 1, 0, 0);
    chk('final CoG height = static equilibrium', sim.p[2], zEq, 0, 2e-3);
    chk('surface breach detected', sim.st.breachT !== null ? 1 : 0, 1, 0, 0);
  }
  // 5 — dropped from 3 m: hits the water at ≈ √(2 g h) (light air drag), plunges, then settles
  {
    const m = 0.5 * rhoW * V;
    const sim = make({ mass: m, z0: 1 + 3, CdA: 1.0, CdW: 0.47, addedMass: [0.5 * rhoW * Vm, 0.5 * rhoW * Vm, 0.5 * rhoW * Vm] });
    while (!sim.settled() && sim.t < 300) sim.advance(1, 1e7);
    chk('water entry speed ≈ √(2gh), h = 3 m', sim.st.entrySpeed, Math.sqrt(2 * G * 3), 0.01);
    chk('plunges below the equilibrium float position', sim.st.minZ < -0.05 ? 1 : 0, 1, 0, 0);
    chk('then settles at equilibrium', Math.abs(sim.p[2] - -solveWaterline(body, m / rhoW).zw) < 2e-3 ? 1 : 0, 1, 0, 0);
  }
  out.push({ id: 'drop_test', title: 'Drop / rise test: free fall, terminal velocity, submerged release, settling (sphere r = 1 m)', ref: "Newton drag F = ½ρC_dAv²; sphere C_d = 0.47 (Hoerner 1965); sphere added mass ½ρV (Lamb §92)", rows });
  return out;
}
