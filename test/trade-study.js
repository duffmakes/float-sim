// RAO trade study: Float Sim vs literature references (shared by Node runner and validation).
//  - Floating hemisphere heave: Hulme (1982) exact potential flow + Haskind exciting force
//  - Deep-draft spar sway: MacCamy & Fuchs (1954) diffraction force, Ca = 1
// Variants show how much each modelling ingredient matters.
import { mat3, transformTris, solveWaterline, hydrostatics, inertiaAbout, massProperties } from '../js/physics.js';
import { refineTris, linearModel, defaultHydroCoeffs, raoAt, fkExcitation } from '../js/hydro.js';

const G = 9.80665;

function build(tris, c, maxEdge) {
  const R = mat3.fromEulerDeg(...c.euler);
  const rel = transformTris(tris, R, c.cog);
  const sol = solveWaterline(rel, c.mass / c.rho);
  const H = hydrostatics(rel, sol.zw, c.mass, c.rho);
  const IGw = mat3.mul(R, mat3.mul(inertiaAbout(massProperties(tris), c.mass, c.cog), mat3.transpose(R)));
  const relFine = refineTris(rel, maxEdge, 60000);
  const Hf = hydrostatics(relFine, sol.zw, c.mass, c.rho);
  return { rel: relFine, H: Hf, IGw, defaults: defaultHydroCoeffs(H, c.mass, IGw, c.rho) };
}
const model = (b, c, A, zeta, diffraction) => linearModel(b.rel, b.H, c.mass, b.IGw, c.rho, { A: A.slice(), zeta: zeta.slice() }, { diffraction });
const mag = (z) => Math.hypot(z[0], z[1]);
// set heave damping directly (B33 in N·s/m) on a model
const withB33 = (m, B33) => { m.Bd = m.Bd.slice(); m.Bd[2] = B33; return m; };

export function hemisphereStudy(tris, ref) {
  const c = ref, a = ref.a, V = 2 / 3 * Math.PI * a ** 3, rhoV = c.rho * V;
  const b = build(tris, c, a / 12);
  const d = b.defaults;
  const variants = [
    { key: 'default', name: 'Tool defaults: FK only, disk A33, ζ = 0.15', A: d.A, zeta: d.zeta, diffraction: false },
    { key: 'default_dc', name: 'Tool defaults + heave diffraction correction', A: d.A, zeta: d.zeta, diffraction: true },
  ];
  // calibrated constants: Hulme a33 and b33 at the undamped resonance (ka ≈ 1), entered as constants
  const res = ref.points.find((p) => p.ka === 1.0);
  const Acal = d.A.slice(); Acal[2] = res.a33 * rhoV;
  variants.push({ key: 'calibrated', name: 'Calibrated constants (Hulme A33, B33 at ka = 1) + diffraction corr.', A: Acal, zeta: d.zeta, diffraction: true, B33: res.b33 * rhoV * res.w });
  const rows = ref.points.map((p) => {
    const out = { ka: p.ka, w: p.w, exact: p.rao, Xexact: p.X_norm };
    for (const v of variants) {
      const m = model(b, c, v.A, v.zeta, v.diffraction);
      if (v.B33 !== undefined) withB33(m, v.B33);
      out[v.key] = mag(raoAt(m, p.w, 0).xi[2]);
    }
    // frequency-dependent Hulme coefficients: isolates the excitation model
    for (const dc of [false, true]) {
      const A = d.A.slice(); A[2] = p.a33 * rhoV;
      const m = withB33(model(b, c, A, d.zeta, dc), p.b33 * rhoV * p.w);
      out[dc ? 'hulmeAB_dc' : 'hulmeAB'] = mag(raoAt(m, p.w, 0).xi[2]);
      out[dc ? 'X_dc' : 'X_fk'] = mag(fkExcitation(m, p.w, 0).F[2]) / (c.rho * G * Math.PI * a * a);
    }
    return out;
  });
  variants.push({ key: 'hulmeAB', name: 'Hulme A33(ω), B33(ω), Froude–Krylov excitation' });
  variants.push({ key: 'hulmeAB_dc', name: 'Hulme A33(ω), B33(ω), FK + diffraction correction' });
  return { rows, variants, defaults: { A33: d.A[2], A33_norm: d.A[2] / rhoV, zeta: d.zeta[2] }, panels: b.rel.length / 9 };
}

export function sparStudy(tris, ref) {
  const c = ref, b = build(tris, c, ref.a / 4);
  const d = b.defaults;
  const rows = ref.points.map((p) => {
    const out = { ka: p.ka, w: p.w, exactF: p.F, exact: p.rao };
    for (const dc of [false, true]) {
      const m = model(b, c, d.A, d.zeta.map((z, j) => (j === 1 ? 0 : z)), dc);  // reference has no sway damping
      const { F, xi } = { ...raoAt(m, p.w, 90), F: fkExcitation(m, p.w, 90).F };
      out[dc ? 'F_dc' : 'F_fk'] = mag(F[1]);
      out[dc ? 'rao_dc' : 'rao_fk'] = mag(xi[1]);
    }
    return out;
  });
  return { rows, defaults: { A22: d.A[1], A22_exact: ref.A22_exact }, panels: b.rel.length / 9 };
}

const pct = (a, b) => `${((a / b - 1) * 100).toFixed(1)} %`;
const n3 = (x) => x.toFixed(3);

export function toMarkdown(h, s, meta) {
  const L = [];
  L.push('# RAO trade study: Float Sim vs literature', '');
  L.push(`Generated ${meta.date} by \`node test/trade-study-node.mjs\` (mesh quality: ${meta.quality}). Both bodies are STEP files in \`test/models/\`, imported with OpenCascade exactly as the app does.`, '');
  // ---- findings, computed from the tables below
  const maxErr = (rows, k, ref, lim) => Math.max(...rows.filter((r) => r.ka <= lim).map((r) => Math.abs(r[k] / r[ref] - 1))) * 100;
  const at = (rows, ka) => rows.find((r) => r.ka === ka);
  const r1 = at(h.rows, 1.0);
  L.push('## Findings', '');
  L.push(`1. **Hydrostatics and wave forces are right where the method applies.** With exact added mass and damping, the hemisphere heave RAO is within ${maxErr(h.rows, 'hulmeAB_dc', 'exact', 0.7).toFixed(1)} % of Hulme's exact solution up to ka = 0.7, and the heave exciting force with the diffraction correction is within ${maxErr(h.rows, 'X_dc', 'Xexact', 0.6).toFixed(1)} % of the Haskind value up to ka = 0.6.`);
  L.push(`2. **Froude–Krylov alone misses half the horizontal wave force on slender bodies.** On the spar it is ${(Math.abs(at(s.rows, 0.05).F_fk / at(s.rows, 0.05).exactF - 1) * 100).toFixed(0)} % low in long waves (C_m = 1 instead of 2). The long-wave diffraction correction (added mass × volume-averaged incident acceleration) brings the sway force and RAO within ${maxErr(s.rows, 'F_dc', 'exactF', 0.7).toFixed(1)} % of MacCamy–Fuchs up to ka = 0.7. **It is on by default for surge and sway.**`);
  L.push(`3. **For heave the correction is a long-wave fix.** It is excellent at small ka (defaults: within ${maxErr(h.rows, 'default_dc', 'exact', 0.3).toFixed(1)} % up to ka = 0.3), but with a constant added mass it overcorrects towards resonance (${pct(r1.default_dc, r1.exact)} at ka = 1). Froude–Krylov alone overpredicts the heave force by up to ${Math.max(...h.rows.filter((r) => r.ka <= 1.2).map((r) => (r.X_fk / r.Xexact - 1) * 100)).toFixed(0)} % instead. **The heave correction is off by default; enable it when A33 is known.**`);
  L.push(`4. **The default added-mass and damping estimates dominate the error near resonance.** With tool defaults (disk A33 = ${h.defaults.A33_norm.toFixed(2)} ρV, ζ = ${h.defaults.zeta}), the hemisphere heave RAO is ${pct(r1.default, r1.exact)} at the exact resonance (ka = 1). The peak is shifted because real added mass and damping vary with frequency. Entering known values (e.g. from a BEM code, model tests or published coefficients) in *Wave & hydrodynamic settings* reduces it to ${pct(r1.calibrated, r1.exact)} ("calibrated constants"). The remainder matches the exciting-force error at that frequency (${pct(r1.X_dc, r1.Xexact)} at ka = 1), which is the limit of the long-wave force model.`);
  L.push('5. **Trust region.** Results degrade once the body is no longer small relative to the wavelength (ka ≳ 0.7 here, i.e. D/λ ≳ 0.2). That is the same threshold at which the app shows its diffraction warning. Roll RAOs are not benchmarked here: real roll damping is dominated by viscous effects that linear potential theory (and this tool) only approximate with the ζ input.', '');
  L.push('## 1. Floating hemisphere, heave (radius 1 m)', '');
  L.push('**Reference:** Hulme (1982), *J. Fluid Mech.* 121, 443–463: exact linear potential-flow heave added mass a₃₃ = A₃₃/ρV and damping b₃₃ = B₃₃/ρVω versus ka (table from [LHEEA/Hulme_Heaving_Sphere](https://github.com/LHEEA/Hulme_Heaving_Sphere)). The exciting force follows from the Haskind relation |X₃|² = 2ρg³B₃₃/ω³, and the RAO from |X₃| / |C₃₃ − ω²(m + A₃₃) + iωB₃₃|. The sphere floats half-submerged, so its wetted surface is the hemisphere.', '');
  L.push(`Tool default heave added mass: A₃₃ = ${h.defaults.A33.toFixed(0)} kg = **${h.defaults.A33_norm.toFixed(2)} ρV** (floating elliptic disk), against Hulme's 0.83 ρV (ka→0) to 0.39 ρV (ka≈1.8). ${h.panels.toLocaleString()} panels.`, '');
  L.push('### Heave RAO (m/m)', '');
  const keys = ['default', 'default_dc', 'calibrated', 'hulmeAB', 'hulmeAB_dc'];
  L.push(`| ka | ω rad/s | f Hz | **Hulme exact** | ${keys.map((k) => h.variants.find((v) => v.key === k).name).join(' | ')} |`);
  L.push(`|---|---|---|---|${keys.map(() => '---').join('|')}|`);
  for (const r of h.rows) L.push(`| ${r.ka} | ${n3(r.w)} | ${n3(r.w / 2 / Math.PI)} | **${n3(r.exact)}** | ${keys.map((k) => `${n3(r[k])} (${pct(r[k], r.exact)})`).join(' | ')} |`);
  L.push('', '### Heave exciting force |X₃| / (ρgπa²)', '');
  L.push('| ka | **Haskind exact** | Froude–Krylov | FK + diffraction correction |', '|---|---|---|---|');
  for (const r of h.rows) L.push(`| ${r.ka} | **${n3(r.Xexact)}** | ${n3(r.X_fk)} (${pct(r.X_fk, r.Xexact)}) | ${n3(r.X_dc)} (${pct(r.X_dc, r.Xexact)}) |`);
  L.push('', '## 2. Deep-draft spar, sway (radius 0.5 m, draft 6 m)', '');
  L.push('**Reference:** MacCamy & Fuchs (1954) diffraction theory, dF/dz = (4ρgA/k)·e^{kz}/|H₁′(ka)|, integrated over the draft (deep water), with a freely floating sway RAO F/(ω²(m + A₂₂)) using the 2-D added mass A₂₂ = ρπa²T (C_a = 1). Bessel functions are checked against Abramowitz & Stegun table 9.1.', '');
  L.push(`Tool default sway added mass: ${s.defaults.A22.toFixed(0)} kg (exact strip value ${s.defaults.A22_exact.toFixed(0)} kg). ${s.panels.toLocaleString()} panels.`, '');
  L.push('| ka | f Hz | **MF force kN/m** | FK force | FK + diffraction corr. | **reference RAO** | FK RAO | FK + corr. RAO |', '|---|---|---|---|---|---|---|---|');
  for (const r of s.rows) L.push(`| ${r.ka} | ${n3(r.w / 2 / Math.PI)} | **${(r.exactF / 1000).toFixed(3)}** | ${(r.F_fk / 1000).toFixed(3)} (${pct(r.F_fk, r.exactF)}) | ${(r.F_dc / 1000).toFixed(3)} (${pct(r.F_dc, r.exactF)}) | **${n3(r.exact)}** | ${n3(r.rao_fk)} (${pct(r.rao_fk, r.exact)}) | ${n3(r.rao_dc)} (${pct(r.rao_dc, r.exact)}) |`);
  return L.join('\n');
}
