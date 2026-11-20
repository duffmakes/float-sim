// Validation core shared by test/validate.html (browser) and test/validate-node.mjs (Node):
// real STEP import + real JS solver/simulator vs closed-form answers.
import { readCad, concat } from '../js/loader.js';
import {
  mat3, transformTris, solveWaterline, hydrostatics, gzCurve, massProperties, inertiaAbout,
  mat3ToQuat, quatToMat3,
} from '../js/physics.js';
import { FloatSim } from '../js/sim.js';
import { runWaveValidation } from './validate-waves.js';
import { runDropValidation } from './validate-drop.js';

export async function runValidation({ quality = 'fine', fetchBytes, fetchJSON, vendorDir, onCase = () => {}, waves = true }) {
  const results = [];
  const exp = await fetchJSON('models/expected.json');
  const cache = {};
  let pass = 0, total = 0;
  const t0 = performance.now();
  for (const c of exp.cases) {
    const rows = [];
    const flatTol = 1e-5, curvedTol = { coarse: 0.03, normal: 0.005, fine: 0.001 }[quality];
    const tol = c.curved ? curvedTol : flatTol;
    const chk = (label, got, want, rel = tol, absFloor = c.curved ? 1e-4 : 1e-6) => {
      let ok, err = null;
      if (typeof want === 'boolean' || typeof want === 'string') ok = got === want;
      else { err = Math.abs(got - want); ok = err <= Math.max(rel * Math.abs(want), absFloor); }
      rows.push({ label, got, want, err, rel: err !== null && want !== 0 ? err / Math.abs(want) : null, ok });
      total++; if (ok) pass++;
    };
    let meta = '';
    try {
      if (!cache[c.file]) {
        const bytes = await fetchBytes(`models/${c.file}`);
        const parts = await readCad(bytes, 'step', quality, vendorDir);
        const mm = concat(parts);
        cache[c.file] = mm.map((v) => v * 0.001);
      }
      const tris = cache[c.file];
      const mp = massProperties(tris);
      meta = `${(tris.length / 9).toLocaleString()} triangles from OpenCascade · enclosed volume ${mp.volume.toFixed(6)} m³`;
      const R = mat3.fromEulerDeg(...c.euler);
      const G = c.cog;
      const rel = transformTris(tris, R, G);
      const sol = solveWaterline(rel, c.mass / c.rho);
      const e = c.expect;
      chk('status', sol.status, e.status);
      if (sol.status !== 'sinks') {
        const H = hydrostatics(rel, sol.zw, c.mass, c.rho);
        const meas = { V: H.V, draft: H.draft, Awp: H.wp.area, KB: H.B[2] - H.zmin, BMt: H.BMt, BMl: H.BMl, GMt: H.GMt, GMl: H.GMl };
        for (const k of ['V', 'draft', 'Awp', 'KB', 'BMt', 'BMl', 'GMt', 'GMl']) if (k in e) chk(k, meas[k], e[k]);
        if ('offset' in e) chk('B–G horiz. offset', Math.hypot(...H.offset), 0, 0, c.curved ? 1e-4 : 1e-6);
        if ('stable' in e) chk('stable upright', H.GMt > 0 && H.GMl > 0, e.stable);
        if ('kg_per_cm' in e) chk('immersion kg/cm', H.tpc / 100, e.kg_per_cm);
        if (e.B_model) {
          const b = mat3.apply(mat3.transpose(R), H.B).map((v, i) => v + G[i]);
          ['x', 'y', 'z'].forEach((a, i) => chk(`B model ${a}`, b[i], e.B_model[i], tol, 1e-6));
        }
        if (c.gz) {
          const curve = gzCurve(rel, H.V, c.gz.axis, c.gz.points.map((p) => p[0]));
          c.gz.points.forEach(([deg, want], i) => chk(`GZ ${deg}°`, curve[i].gz, want, Math.max(tol, 1e-5), c.curved ? 1e-4 : 2e-5));
        }
        if (c.target) {
          const t = c.target;
          const zt = t.mode === 'draft' ? H.zmin + t.value : solveWaterline(rel, mp.volume * t.value / 100).zw;
          const Ht = hydrostatics(rel, zt, 1, c.rho);
          chk('target → mass', c.rho * Ht.V, t.mass);
          if ('draft' in t) chk('target draft', Ht.draft, t.draft);
        }
      }
      if (c.sim) {
        // same construction as the app's "Simulate" button
        const R0 = mat3.fromEulerDeg(...c.sim.start_euler);
        const rel0 = transformTris(tris, R0, G);
        const s0 = solveWaterline(rel0, c.mass / c.rho);
        const H0 = hydrostatics(rel0, s0.zw, c.mass, c.rho);
        const sim = new FloatSim({
          bodyTris: transformTris(tris, mat3.identity(), G), mass: c.mass,
          inertiaG: inertiaAbout(mp, c.mass, G), rho: c.rho, q0: mat3ToQuat(R0), z0: -s0.zw,
          zeta: 0.5, awpRef: Math.max(H0.wp.area, 1e-6),
        });
        const diag = Math.hypot(...[0, 1, 2].map((k) => { let lo = Infinity, hi = -Infinity; for (let i = k; i < tris.length; i += 3) { lo = Math.min(lo, tris[i]); hi = Math.max(hi, tris[i]); } return hi - lo; }));
        let settledAt = null;
        while (sim.t < 300) {
          sim.advance(sim.dt * 200, 200);
          const ke = Math.hypot(...sim.v) / diag + Math.hypot(...sim.w);
          if (sim.t > 2 && ke < 1e-6) { settledAt = sim.t; break; }
        }
        const eul = mat3.toEulerDeg(quatToMat3(sim.q));
        chk('sim settles', settledAt !== null, true);
        chk('sim final roll °', eul[0], c.sim.expect_roll, 0, c.sim.tol_deg);
        chk('sim final pitch °', eul[1], 0, 0, c.sim.tol_deg);
        meta += ` · sim dt ${(sim.dt * 1000).toFixed(2)} ms, settled at t = ${settledAt?.toFixed(1) ?? '—'} s`;
      }
    } catch (err) {
      console.error(err);
      rows.push({ label: 'ERROR', got: String(err.message || err), want: '', ok: false }); total++;
    }
    results.push({ id: c.id, title: c.title, rows, meta });
    onCase(c, rows, meta);
  }
  if (waves) {
    const getTris = async (file, q = quality) => {
      const key = q === quality ? file : `${file}@${q}`;
      if (!cache[key]) cache[key] = concat(await readCad(await fetchBytes(`models/${file}`), 'step', q, vendorDir)).map((v) => v * 0.001);
      return cache[key];
    };
    const chkFactory = () => {
      const rows = [];
      const chk = (label, got, want, rel = 1e-6, absFloor = 0) => {
        const err = Math.abs(got - want);
        const ok = err <= Math.max(rel * Math.abs(want), absFloor);
        rows.push({ label, got, want, err, rel: want !== 0 ? err / Math.abs(want) : null, ok });
        total++; if (ok) pass++;
      };
      return { rows, chk };
    };
    try {
      const t1 = performance.now();
      for (const c of [...await runWaveValidation({ exp, getTris, chkFactory }), ...await runDropValidation({ getTris, chkFactory })]) {
        c.meta = c.meta || '';
        results.push(c); onCase(c, c.rows, c.meta);
      }
      results.waveSeconds = (performance.now() - t1) / 1000;
    } catch (err) {
      console.error(err);
      const rows = [{ label: 'ERROR', got: String(err.stack || err), want: '', ok: false }]; total++;
      const c = { id: 'wave_error', title: 'Wave validation crashed', ref: '', rows };
      results.push(c); onCase(c, rows, '');
    }
  }
  return { pass, total, quality, cases: results.length, curvedTol: { coarse: 0.03, normal: 0.005, fine: 0.001 }[quality], seconds: (performance.now() - t0) / 1000, results };
}
