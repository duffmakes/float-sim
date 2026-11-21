// Panel-method (BEM) validation: special functions, wetted-surface meshing, added mass, damping and exciting forces
// against WAMIT, Capytaine and closed-form results, and the Kramer et al. (2021) heave decay through the drop test.
//   node test/validate-bem.mjs [quick]
// "quick" uses every 4th reference frequency instead of every 2nd. Takes a few minutes either way.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const J = (...p) => path.join(here, ...p);
globalThis.occtimportjs = createRequire(import.meta.url)('../vendor/occt-import-js.js');
const Ph = await import('../js/physics.js');
const Hy = await import('../js/hydro.js');
const M = await import('../js/bemmesh.js');
const B = await import('../js/bem.js');
const { DropSim } = await import('../js/sim.js');
const { readCad, concat } = await import('../js/loader.js');
const { panelSize } = await import('../js/bemrun.js');

const every = process.argv[2] === 'quick' ? 4 : 2;
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); };
const pct = (x) => `${(100 * x).toFixed(2)} %`;
const step = async (f, q = 'fine') => concat(await readCad(new Uint8Array(await readFile(J('models', f))), 'step', q, J('..', 'vendor') + '/')).map((v) => v * 0.001);
const json = async (f) => JSON.parse(await readFile(J('models', f), 'utf8'));
const shiftZ = (t, dz, s = 1) => t.map((v, i) => (i % 3 === 2 ? (v + dz) * s : v * s));
function revolve(profile, n) {   // closed surface of revolution about z, profile from bottom (r = 0) to top (r = 0)
  const out = [];
  for (let i = 0; i + 1 < profile.length; i++) {
    const [r0, z0] = profile[i], [r1, z1] = profile[i + 1];
    for (let j = 0; j < n; j++) {
      const t0 = 2 * Math.PI * j / n, t1 = 2 * Math.PI * (j + 1) / n, p = (r, z, t) => [r * Math.cos(t), r * Math.sin(t), z];
      if (r0 > 0) out.push(...p(r0, z0, t0), ...p(r0, z0, t1), ...p(r1, z1, t1));
      if (r1 > 0) out.push(...p(r0, z0, t0), ...p(r1, z1, t1), ...p(r1, z1, t0));
    }
  }
  return new Float64Array(out);
}
const ellipsoid = (a, c, m = 200, n = 192) => revolve(Array.from({ length: m + 1 }, (_, i) => [a * Math.sin(Math.PI * i / m), -c * Math.cos(Math.PI * i / m)]), n);
// floating body → BEM panels at a panel count (standard fidelity ≈ 1000)
function setup(tris, mass, cog, rho, N = 1000, opts = {}) {
  const rel = Ph.transformTris(tris, Ph.mat3.identity(), cog);
  const sol = Ph.solveWaterline(rel, mass / rho);
  const h = Math.sqrt(M.soupArea(M.wettedSurface(rel, sol.zw).wet) / (0.433 * N));
  const mesh = M.prepareBemMesh(rel, sol.zw, { h, ...opts });
  const P = B.buildPanels(mesh.bodyQ, [mesh.sym.x0, mesh.sym.y0, -sol.zw], mesh.lidQ, mesh.sym);
  return { rel, sol, mesh, P };
}

console.log('— special functions (A&S §9, §12; values from SciPy)');
const SF = [[0.3, 0.977626246538, 0.148318816273, -0.807273577805, -2.29310513839, 0.189082935272, 0.0189842958554],
  [1, 0.765197686558, 0.440050585745, 0.0882569642157, -0.7812128213, 0.568656627048, 0.198457336202],
  [5, -0.177596771314, -0.327579137591, -0.308517625249, 0.147863143391, -0.185216815777, 0.807811945794],
  [11.9, 0.0250494416996, -0.228983249662, -0.229833213943, -0.034711498334, -0.176692780888, 0.606316908181],
  [12.1, 0.0696667736068, -0.215748973377, -0.218438380551, -0.0787369314514, -0.166165359431, 0.562149482752],
  [19.9, 0.172877756393, 0.0501174248074, 0.0457620941594, -0.17178303121, 0.0776739864088, 0.466432573671],
  [20.1, 0.159536067937, 0.0828010057602, 0.0788105924288, -0.157625980748, 0.110406471648, 0.480558244864],
  [30, -0.086367983581, -0.118751062617, -0.117295731687, 0.0844255706617, -0.0960984215542, 0.721750378347]];
let sfErr = 0;
for (const [x, ...ref] of SF) { const b = B.bessel(x), s = B.struve(x); [b.J0, b.J1, b.Y0, b.Y1, s.H0, s.H1].forEach((v, i) => { sfErr = Math.max(sfErr, Math.abs(v - ref[i])); }); }
check('J0, J1, Y0, Y1, H0, H1 at x = 0.3 … 30 (both sides of the series/asymptotic switches)', sfErr < 1e-8, `max abs error ${sfErr.toExponential(1)}`);

console.log('\n— wetted-surface meshing (fine CAD tessellation, ~1000 panels)');
const meshCases = [
  ['sphere_r1.step', null, [0, 0, 0.7], true], ['buoy_cyl.step', null, [0, 0, 0.23], true], ['kramer_sphere.step', 7.056, [0, 0, 0.1152], true],
  ['cube_1m.step', 850, [0, 0, 0.5], true], ['box_4x2x1.step', 3200, [2, 0, 0.5], true], ['hcyl_log.step', 188.4955592153876, [1.5, 0, 0.15], true],
  ['v_prism.step', 623.5382907247957, [1.5, 0, 0.35], true], ['vcyl_squat.step', 157.0796, [0, 0, 0.2], true], ['spar.step', 4712.389, [0, 0, 1], true],
  ['box_moved.step', 3200, [3.2320508075688776, 0.3, 0.75], false],
];
for (const [file, m0, cog, symExpected] of meshCases) {
  const tris = await step(file);
  const mass = m0 ?? 500 * Ph.submerged(tris, 1e9).V;
  const t0 = performance.now();
  const { sol, mesh } = setup(tris, mass, cog, 1000);
  const ms = performance.now() - t0;
  const H = Ph.hydrostatics(Ph.transformTris(tris, Ph.mat3.identity(), cog), sol.zw, mass, 1000);
  const full = M.mirrorSoup(mesh.bodyQ, mesh.sym), lid = mesh.lidQ ? M.mirrorSoup(mesh.lidQ, mesh.sym) : new Float64Array(0);
  let V = 0; for (let i = 0; i < full.length; i += 9) { const a = full.subarray(i, i + 3), b = full.subarray(i + 3, i + 6), c = full.subarray(i + 6, i + 9); V += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; }
  const q = mesh.quality, eV = V / H.V - 1, eL = M.soupArea(lid) / Math.abs(H.wp.area) - 1;
  check(`${file.padEnd(18)} ${String(mesh.panels).padStart(4)} + ${String(mesh.lidPanels).padStart(4)} lid panels, quality min ${q.qMin.toFixed(2)} mean ${q.qMean.toFixed(3)}, displaced volume ${pct(eV)}, lid area ${pct(eL)}, symmetry ${mesh.sym.x && mesh.sym.y ? 'xy' : '—'} (${ms.toFixed(0)} ms)`,
    q.qMin > 0.4 && q.qMean > 0.92 && Math.abs(eV) < 0.006 && Math.abs(eL) < 0.01 && (mesh.sym.x && mesh.sym.y) === symExpected);
}

console.log('\n— zero-frequency added mass of a slender body (Lamb 1932 §373: prolate spheroid c/a = 12, half immersed)');
{
  const a = 0.5, c = 6, e = Math.sqrt(1 - a * a / (c * c)), L = Math.log((1 + e) / (1 - e));
  const al = 2 * (1 - e * e) / e ** 3 * (0.5 * L - e), be = 1 / (e * e) - (1 - e * e) / (2 * e ** 3) * L;
  const k1 = al / (2 - al), k2 = be / (2 - be), Vh = 2 / 3 * Math.PI * a * a * c;
  const tris = ellipsoid(a, c, 400, 256);
  const { P } = setup(tris, 1000 * Vh, [0, 0, -c / 2], 1000, 2000, { irr: false });
  const R = B.rankineSetup(P, { limits: true });
  check(`lateral A0 = k₂ρV (k₂ = ${k2.toFixed(4)})`, Math.abs(R.A0[0][0] / (1000 * k2 * Vh) - 1) < 0.005, `error ${pct(R.A0[0][0] / (1000 * k2 * Vh) - 1)}`);
  console.log(`      (axial A0 = k₁ρV with k₁ = ${k1.toFixed(4)}: ${pct(R.A0[2][2] / (1000 * k1 * Vh) - 1)} — tiny and set by the sharp tip, not checked)`);
}

console.log('\n— added mass, radiation damping and exciting forces against WAMIT and Capytaine');
console.log('  error = max over frequency of |Float Sim − reference| / max over frequency of |reference|, per coefficient;');
console.log('  limits 2 % for the translational terms and 5 % for rotations and couplings (sharp-edged bodies converge slowly there)');
const capy = async (n) => json(`capytaine/${n}.json`), wam = async (n) => json(`wamit/${n}.json`);
const cases = [
  { name: 'Hemisphere r 5 m (WAMIT, depth 50 m: Kh ≥ π only)', tris: shiftZ(await step('sphere_r1.step'), -1, 5), cog: [0, 0, -2], ref: await wam('sphere'), O: [0, 0, -2], deep: 50 },
  { name: 'Ellipsoid 9 × 3.6 m (WAMIT, deep)', tris: ellipsoid(4.5, 1.8), cog: [0, 0, 0], ref: await wam('ellipsoid'), O: [0, 0, 0] },
  { name: 'Cylinder buoy a 0.35, T 0.63 m (Capytaine)', tris: shiftZ(await step('buoy_cyl.step'), -0.63), cog: [0, 0, -0.4], ref: await capy('cyl_buoy') },
  { name: 'Kramer sphere D 0.3 m (Capytaine)', tris: shiftZ(await step('kramer_sphere.step'), -0.15), cog: [0, 0, -0.0348], ref: await capy('kramer_sphere') },
  { name: 'Squat cylinder r 0.5, T 0.2 m (Capytaine)', tris: await step('vcyl_squat.step'), mass: 157.07963267948966, cog: [0, 0, 0.2], ref: await capy('squat_cyl') },
  { name: 'Cube 1 m, draft 0.85 m (Capytaine)', tris: await step('cube_1m.step'), mass: 850, cog: [0, 0, 0.5], ref: await capy('cube') },
  { name: 'Log Ø0.4 × 3 m (Capytaine)', tris: await step('hcyl_log.step'), mass: 188.4955592153876, cog: [1.5, 0, 0.15], ref: await capy('hcyl_log') },
  { name: 'Spar a 0.5, T 6 m (Capytaine)', tris: await step('spar.step'), mass: 1000 * Math.PI * 0.25 * 6, cog: [0, 0, 1], ref: await capy('spar') },
];
const fullW = (d, s) => { const m6 = Array.from({ length: 6 }, () => new Array(6).fill(0)); for (const [k, v] of Object.entries(d)) m6[+k[0] - 1][+k[1] - 1] = v * s; return m6; };
for (const c of cases) {
  const rho = 1000, r = c.ref, g = r.g;
  const mass = c.mass ?? rho * Ph.submerged(c.tris, 0).V;
  const t0 = performance.now();
  const { P, mesh, sol } = setup(c.tris, mass, c.cog, rho, 1000);
  const R = B.rankineSetup(P, { rho, limits: !!c.O });
  const ws = B.bemWorkspace(P, R);
  const err = {}, peak = {};
  const track = (key, t, ref) => { err[key] = Math.max(err[key] || 0, Math.abs(t - ref)); peak[key] = Math.max(peak[key] || 0, Math.abs(ref)); };
  const trackC = (key, t, ref) => { err[key] = Math.max(err[key] || 0, Math.hypot(t[0] - ref[0], t[1] - ref[1])); peak[key] = Math.max(peak[key] || 0, Math.hypot(...ref)); };
  let nf = 0;
  for (let k = 0; k < r.w.length; k += every) {
    const w = r.w[k];
    if (c.deep && w * w / g * c.deep < Math.PI) continue;
    const s = B.solveRadiation(P, R, w, { rho, g, ws });
    const X = B.haskindX(P, s.phi, w, 0, { rho, g });
    let RA, RB, RX;
    if (c.O) {
      RA = fullW(r.A[k], rho); RB = fullW(r.B[k], rho); RX = [0, 1, 2, 3, 4, 5].map((i) => (r.X[k][String(i + 1)] || [0, 0]).map((v) => v * rho * g));
      const OG = c.O.map((v, i) => v - c.cog[i]);
      if (OG.some(Boolean)) ({ A: RA, B: RB, X: [RX] } = B.transferToG(RA, RB, [RX], OG));
    } else { RA = r.A[k]; RB = r.B[k]; RX = r.X0[k]; }
    for (let i = 0; i < 6; i++) { track(`A${i + 1}${i + 1}`, s.A[i][i], RA[i][i]); track(`B${i + 1}${i + 1}`, s.B[i][i], RB[i][i]); trackC(`X${i + 1}`, X[i], RX[i]); }
    for (const [i, j] of [[0, 4], [1, 3]]) { track(`A${i + 1}${j + 1}`, s.A[i][j], RA[i][j]); track(`B${i + 1}${j + 1}`, s.B[i][j], RB[i][j]); }
    nf++;
  }
  // coefficients that are zero by symmetry (yaw of an axisymmetric body, sway force in head seas) are skipped
  const fam = (k) => Math.max(...Object.entries(peak).filter(([q]) => q[0] === k[0]).map(([, v]) => v));
  const keys = Object.keys(err).filter((k) => peak[k] > 0.02 * fam(k));
  const transl = keys.filter((k) => ['A11', 'A22', 'A33', 'B11', 'B22', 'B33', 'X1', 'X2', 'X3'].includes(k));
  const worst = (ks) => ks.reduce((m, k) => (err[k] / peak[k] > m[1] ? [k, err[k] / peak[k]] : m), ['—', 0]);
  const [wt, et] = worst(transl), [wr, er] = worst(keys.filter((k) => !transl.includes(k)));
  check(`${c.name}: ${mesh.panels} panels, ${nf} frequencies — translational worst ${wt} ${pct(et)}, rotational/coupling worst ${wr} ${pct(er)} (${((performance.now() - t0) / 1000).toFixed(0)} s)`, et < 0.02 && er < 0.05);
  if (c.O) {
    const Ai = fullW(r.Ainf, rho), e3 = R.Ainf[2][2] / Ai[2][2] - 1, e1 = R.Ainf[0][0] / Ai[0][0] - 1;
    check(`  infinite-frequency added mass A∞33 ${pct(e3)}, A∞11 ${pct(e1)} (WAMIT)`, Math.abs(e3) < 0.02 && Math.abs(e1) < 0.02);
  }
}

console.log('\n— solvers, RAO assembly and interpolation');
{
  const tris = shiftZ(await step('buoy_cyl.step'), -0.63), mass = 1000 * Ph.submerged(tris, 0).V, cog = [0, 0, -0.4];
  const { P, sol, rel } = setup(tris, mass, cog, 1000, 1000);
  const R = B.rankineSetup(P);
  const a = B.solveRadiation(P, R, 5, { solver: 'lu' }), b = B.solveRadiation(P, R, 5, { solver: 'gmres' });
  let d = 0; for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) d = Math.max(d, Math.abs(a.A[i][j] - b.A[i][j]) / Math.abs(a.A[i][i] || 1), Math.abs(a.B[i][j] - b.B[i][j]) / Math.abs(a.B[i][i] || 1));
  check(`GMRES and LU give the same A and B (Nq ${P.Nq}, ${b.iters} GMRES iterations)`, d < 1e-5, `max relative difference ${d.toExponential(1)}`);
  // RAO from Float Sim's coefficients vs the same equations with Capytaine's coefficients: natural frequency and peak
  const ref = await capy('cyl_buoy'), g = ref.g;
  const H = Ph.hydrostatics(rel, sol.zw, mass, 1000), IG = Ph.inertiaAbout(Ph.massProperties(tris), mass, cog);
  const model = Hy.linearModel(rel, H, mass, IG, 1000, Hy.defaultHydroCoeffs(H, mass, IG, 1000));
  const omegas = Array.from({ length: 80 }, (_, i) => 1 + 9 * i / 79);
  const ws = B.bemWorkspace(P, R);
  const bem = { omegas, headings: [0, 5, 355], A: [], B: [], X: [] };
  for (const w of omegas) { const s = B.solveRadiation(P, R, w, { g, ws }); bem.A.push(s.A); bem.B.push(s.B); bem.X.push(bem.headings.map((h) => B.haskindX(P, s.phi, w, h, { g }))); }
  const capBem = { omegas: ref.w, headings: [0, 90], A: ref.A, B: ref.B, X: ref.X0.map((x, k) => [x, ref.X90[k]]) };
  const nat = Hy.bemNatural(model, bem), natC = Hy.bemNatural(model, capBem);
  const peakOf = (bb, j) => { let best = [0, 0]; for (let i = 0; i < 400; i++) { const w = 1.2 + 8.6 * i / 399, r = Hy.raoAtBem(model, bb, w, 0); if (r) { const v = Math.hypot(...r.xi[j]); if (v > best[1]) best = [w, v]; } } return best; };
  const [wh, ph] = peakOf(bem, 2), [whc, phc] = peakOf(capBem, 2), [wp, pp] = peakOf(bem, 4), [wpc, ppc] = peakOf(capBem, 4);
  check(`heave natural frequency ${nat[2].w.toFixed(3)} rad/s vs ${natC[2].w.toFixed(3)} with Capytaine's A33(ω)`, Math.abs(nat[2].w / natC[2].w - 1) < 0.005, pct(nat[2].w / natC[2].w - 1));
  check(`heave RAO peak ${ph.toFixed(3)} m/m at ${wh.toFixed(2)} rad/s vs ${phc.toFixed(3)} at ${whc.toFixed(2)}`, Math.abs(ph / phc - 1) < 0.05 && Math.abs(wh / whc - 1) < 0.01, pct(ph / phc - 1));
  check(`pitch RAO peak ${(pp * 180 / Math.PI).toFixed(2)} °/m at ${wp.toFixed(2)} rad/s vs ${(ppc * 180 / Math.PI).toFixed(2)} at ${wpc.toFixed(2)}`, Math.abs(pp / ppc - 1) < 0.05 && Math.abs(wp / wpc - 1) < 0.01, pct(pp / ppc - 1));
  const x5 = Hy.bemCoeffsAt(bem, omegas[10], 2.5).X[0], x0 = bem.X[10][0][0], x5b = bem.X[10][1][0];
  check('exciting force interpolated halfway between headings 0° and 5°', Math.hypot(x5[0] - (x0[0] + x5b[0]) / 2, x5[1] - (x0[1] + x5b[1]) / 2) < 1e-9 * Math.hypot(...x0));
}

console.log('\n— Kramer et al. (2021) floating-sphere heave decay (Energies 14, 269; Table A2: WAMIT at the damped natural frequency, measured Te0 = 0.76 s)');
{
  const rho = 998.2, m = 7.056, IG = [0.098251, 0, 0, 0, 0.098254, 0, 0, 0, 0.073052];
  const tris = await step('kramer_sphere.step');
  const cog = [0, 0, 0.15 - 0.0348];
  const { P, sol, rel } = setup(tris, m, cog, rho, 400);   // the coarse mesh the app uses for the simulators
  const H = Ph.hydrostatics(rel, sol.zw, m, rho), C33 = rho * 9.80665 * H.wp.area;
  const R = B.rankineSetup(P, { rho }), ws = B.bemWorkspace(P, R);
  const omegas = Array.from({ length: 12 }, (_, i) => 2.5 * Math.pow(10, i / 11));
  const bem = { omegas, headings: [0], A: [], B: [], X: [] };
  for (const w of omegas) { const s = B.solveRadiation(P, R, w, { rho, ws }); bem.A.push(s.A); bem.B.push(s.B); bem.X.push([B.haskindX(P, s.phi, w, 0, { rho })]); }
  const model = { Mm: Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => (i === j ? (i < 3 ? m : IG[(i - 3) * 4]) : 0))), Cm: Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => (i === 2 && j === 2 ? C33 : 0))) };
  const n = Hy.bemNatural(model, bem)[2], Td = 2 * Math.PI / (n.w * Math.sqrt(1 - n.zeta ** 2));
  check(`A33(ωn) ${n.A.toFixed(3)} kg (WAMIT 2.97), B33 ${n.B.toFixed(2)} N·s/m (13.95)`, Math.abs(n.A / 2.97 - 1) < 0.03 && Math.abs(n.B / 13.95 - 1) < 0.03, `${pct(n.A / 2.97 - 1)}, ${pct(n.B / 13.95 - 1)}`);
  check(`linear damped period ${Td.toFixed(3)} s (measured 0.76 s)`, Math.abs(Td / 0.76 - 1) < 0.01, pct(Td / 0.76 - 1));
  const sim = new DropSim({ bodyTris: rel.map((v, i) => (i % 3 === 2 ? v : v)), inertiaG: IG, mass: m, rhoW: rho, rhoA: 1.2, q0: [0, 0, 0, 1], z0: -sol.zw + 0.03,
    addedMass: [n.A, n.A, n.A], wRef: n.w, B33: n.B, Brot: [0, 0, 0], CdW: 0, CdA: 0 });
  const z = [], t = [], zeq = -sol.zw;
  while (sim.t < 4) { sim.advance(0.002, 1e7); z.push(sim.p[2] - zeq); t.push(sim.t); }
  const ups = []; for (let i = 1; i < z.length; i++) if (z[i - 1] < 0 && z[i] >= 0) ups.push(t[i - 1] + (t[i] - t[i - 1]) * (-z[i - 1]) / (z[i] - z[i - 1]));
  const TdSim = (ups[4] - ups[0]) / 4;
  const pk = []; for (let i = 1; i + 1 < z.length; i++) if (z[i] > z[i - 1] && z[i] > z[i + 1] && z[i] > 1e-5) pk.push([t[i], z[i]]);
  const dec = Math.log(pk[0][1] / pk[2][1]) / (pk[2][0] - pk[0][0]);
  check(`drop test from H0 = 0.1D (30 mm): damped period ${TdSim.toFixed(3)} s (0.76), decay rate ${dec.toFixed(3)} 1/s (WAMIT LPF0 0.695)`, Math.abs(TdSim / 0.76 - 1) < 0.02 && Math.abs(dec / 0.695 - 1) < 0.06, `${pct(TdSim / 0.76 - 1)}, ${pct(dec / 0.695 - 1)}`);
}

console.log('\n— known models, meshed as the app does (panelSize at standard fidelity, panels ≤ λ/7 at the top frequency)');
{
  const g = 9.80665;
  const quad = (t, a, b, c, d) => t.push(...a, ...b, ...c, ...a, ...c, ...d);
  // closed box with an optional vertical through-hole (moonpool) [hx0, hx1] × [hy0, hy1]
  const boxSoup = ([x0, x1], [y0, y1], [z0, z1], hole = null) => {
    const t = [];
    quad(t, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); quad(t, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
    quad(t, [x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]); quad(t, [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]);
    if (!hole) { quad(t, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]); quad(t, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); return new Float64Array(t); }
    const [[a0, a1], [b0, b1]] = hole, O = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], I = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
    for (const [z, up] of [[z0, false], [z1, true]]) for (let k = 0; k < 4; k++) {
      const o0 = [...O[k], z], o1 = [...O[(k + 1) % 4], z], i1 = [...I[(k + 1) % 4], z], i0 = [...I[k], z];
      if (up) quad(t, o0, o1, i1, i0); else quad(t, o0, i0, i1, o1);
    }
    quad(t, [a0, b0, z0], [a0, b0, z1], [a1, b0, z1], [a1, b0, z0]); quad(t, [a1, b0, z0], [a1, b0, z1], [a1, b1, z1], [a1, b1, z0]);
    quad(t, [a1, b1, z0], [a1, b1, z1], [a0, b1, z1], [a0, b1, z0]); quad(t, [a0, b1, z0], [a0, b1, z1], [a0, b0, z1], [a0, b0, z0]);
    return new Float64Array(t);
  };
  // waterline at z = 0 of the given geometry, reference point (and G) at the waterplane origin
  const appMesh = (tris, rho, wMax) => {
    const rel = Ph.transformTris(tris, Ph.mat3.identity(), [0, 0, 0]);
    const sol = Ph.solveWaterline(rel, Ph.submerged(tris, 0).V);
    const { h } = panelSize(rel, sol.zw, 'standard', wMax, g, true);
    const mesh = M.prepareBemMesh(rel, sol.zw, { h });
    return { mesh, P: B.buildPanels(mesh.bodyQ, [mesh.sym.x0, mesh.sym.y0, -sol.zw], mesh.lidQ, mesh.sym), sol, rel };
  };

  // 1. irregular-frequency lid of a hull whose moonpool crosses the symmetry planes (the ITI barge: 10 × 10 m, centred)
  for (const [name, hole, wp] of [['moonpool centred on both symmetry planes', [[-5, 5], [-5, 5]], 1500], ['moonpool crossing one symmetry plane', [[4, 12], [-5, 5]], 1520]]) {
    const { mesh } = appMesh(boxSoup([-20, 20], [-20, 20], [-4, 6], hole), 1000, 2);
    const area = mesh.lidQ ? M.soupArea(mesh.lidQ) * (mesh.sym.x ? 2 : 1) * (mesh.sym.y ? 2 : 1) : 0;
    const q = mesh.lidQ ? M.meshQuality(mesh.lidQ) : { qMin: 0 };
    check(`lid for a 40 × 40 m barge with a ${name}: ${mesh.lidPanels} lid panels, area ${pct(area / wp - 1)}, quality min ${q.qMin.toFixed(2)}`, Math.abs(area / wp - 1) < 1e-3 && q.qMin > 0.4);
  }

  // 2. Hulme (1982): exact heave added mass and damping of a floating hemisphere in deep water, ka = 0 … 10
  {
    const H = await json('hulme/hemisphere_heave.json'), a = 1, gH = 9.81, V = 2 / 3 * Math.PI;
    const t0 = performance.now();
    const { P, mesh } = appMesh(shiftZ(await step('sphere_r1.step'), -1), 1, Math.sqrt(gH * 10 / a));
    const R = B.rankineSetup(P, { rho: 1, limits: true }), ws = B.bemWorkspace(P, R);
    let ea = Math.abs(R.A0[2][2] / V - H.a33[0]), eb = 0, n = 0;
    H.ka.forEach((ka, k) => {
      if (ka === 0 || (k % every && k !== H.ka.length - 1)) return;
      const w = Math.sqrt(gH * ka / a), s = B.solveRadiation(P, R, w, { rho: 1, g: gH, ws });
      ea = Math.max(ea, Math.abs(s.A[2][2] / V - H.a33[k])); eb = Math.max(eb, Math.abs(s.B[2][2] / (V * w) - H.b33[k])); n++;
    });
    const pa = Math.max(...H.a33), pb = Math.max(...H.b33), einf = R.Ainf[2][2] / V / 0.5 - 1;
    check(`Hulme hemisphere, ${mesh.panels} + ${mesh.lidPanels} lid panels, ${n} frequencies up to ka = 10 and ka = 0: a33 ${pct(ea / pa)}, b33 ${pct(eb / pb)} of peak; a33(∞) ${pct(einf)} vs ½ (${((performance.now() - t0) / 1000).toFixed(0)} s)`,
      ea / pa < 0.01 && eb / pb < 0.01 && Math.abs(einf) < 0.005);
  }

  // 3. OC3-Hywind spar against WAMIT (Jonkman 2010; OpenFAST r-test HydroData, depth 320 m: kh ≥ π only)
  // 4. ITI barge hull against Capytaine (direct, 1 m panels + lid): a large flat bottom near the surface, where the
  //    high-frequency heave and pitch damping need the wave part integrated over each panel, not at its centroid
  for (const c of [
    { name: 'OC3-Hywind spar Ø6.5/9.4 m, draft 120 m (WAMIT)', tris: revolve([[0, -120], [4.7, -120], [4.7, -12], [3.25, -4], [3.25, 10], [0, 10]], 128), ref: await wam('oc3_spar'), wMax: 2, lim: [0.05, 0.05] },
    { name: 'ITI barge 40 × 40 m, draft 4 m (Capytaine)', tris: boxSoup([-20, 20], [-20, 20], [-4, 6]), ref: await capy('iti_barge'), wMax: 2, lim: [0.02, 0.05] },
  ]) {
    const r = c.ref, rho = 1000, isW = !!r.Ainf, t0 = performance.now();
    const { P, mesh } = appMesh(c.tris, rho, c.wMax);
    const R = B.rankineSetup(P, { rho }), ws = B.bemWorkspace(P, R);
    const err = {}, peak = {};
    const track = (key, t, ref) => { const e = Array.isArray(t) ? Math.hypot(t[0] - ref[0], t[1] - ref[1]) : Math.abs(t - ref); err[key] = Math.max(err[key] || 0, e); peak[key] = Math.max(peak[key] || 0, Array.isArray(ref) ? Math.hypot(...ref) : Math.abs(ref)); };
    let nf = 0;
    for (let k = 0; k < r.w.length; k += isW ? every : 1) {
      const w = r.w[k];
      if (isW && w * w / g * r.depth < Math.PI) continue;
      const s = B.solveRadiation(P, R, w, { rho, g: r.g, ws }), X = B.haskindX(P, s.phi, w, 0, { rho, g: r.g });
      const RA = isW ? fullW(r.A[k], rho) : r.A[k], RB = isW ? fullW(r.B[k], rho) : r.B[k];
      const RX = isW ? [0, 1, 2, 3, 4, 5].map((i) => (r.X[k][String(i + 1)] || [0, 0]).map((v) => v * rho * r.g)) : r.X0[k];
      for (let i = 0; i < 6; i++) { track(`A${i + 1}${i + 1}`, s.A[i][i], RA[i][i]); track(`B${i + 1}${i + 1}`, s.B[i][i], RB[i][i]); track(`X${i + 1}`, X[i], RX[i]); }
      for (const [i, j] of [[0, 4], [1, 3]]) { track(`A${i + 1}${j + 1}`, s.A[i][j], RA[i][j]); track(`B${i + 1}${j + 1}`, s.B[i][j], RB[i][j]); }
      nf++;
    }
    // compare like with like: translational / coupling / rotational (A, B) and force / moment (X)
    const cls = (q) => (q[0] === 'X' ? `X${+q[1] > 3}` : `${q[0]}${(+q[1] > 3) + (+q[2] > 3)}`);
    const fam = (k) => Math.max(...Object.entries(peak).filter(([q]) => cls(q) === cls(k)).map(([, v]) => v));
    const keys = Object.keys(err).filter((k) => peak[k] > 0.02 * fam(k));
    const transl = keys.filter((k) => ['A11', 'A22', 'A33', 'B11', 'B22', 'B33', 'X1', 'X2', 'X3'].includes(k));
    const worst = (ks) => ks.reduce((m, k) => (err[k] / peak[k] > m[1] ? [k, err[k] / peak[k]] : m), ['—', 0]);
    const [wt, et] = worst(transl), [wr, er] = worst(keys.filter((k) => !transl.includes(k)));
    check(`${c.name}: ${mesh.panels} + ${mesh.lidPanels} lid panels, ${nf} frequencies — translational worst ${wt} ${pct(et)}, rotational/coupling worst ${wr} ${pct(er)} (${((performance.now() - t0) / 1000).toFixed(0)} s)`, et < c.lim[0] && er < c.lim[1]);
  }
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
