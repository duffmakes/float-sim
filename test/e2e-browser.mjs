// End-to-end browser test: drives the real app and validation page in headless Chromium.
//   node test/e2e-browser.mjs [screenshotDir]
// Needs the dev server running (./serve.sh) and Playwright. If Playwright isn't installed in
// this project, set PLAYWRIGHT_MODULE to the absolute path of playwright/index.mjs.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.FLOAT_SIM_URL || 'http://127.0.0.1:8765';
const shots = process.argv[2];
const MODEL = new URL('./models/box_4x2x1.step', import.meta.url).pathname;

let fails = 0;
const expect = (label, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); };
const near = (got, want, tol) => Math.abs(got - want) <= tol;
const num = (s) => parseFloat(String(s).replace(/[^0-9eE.+-]/g, ''));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(e.message));
const stat = (label) => page.evaluate((l) => {
  const r = [...document.querySelectorAll('#stats tr')].find((t) => t.cells[0]?.innerText.startsWith(l));
  return r ? r.cells[1].innerText : null;
}, label);
const settle = async () => {
  await page.click('#simSettle');
  await page.waitForFunction(() => !document.querySelector('#simRun').textContent.includes('Pause'), null, { timeout: 180000 });
};

// 1 — validation page, all mesh qualities
await page.goto(`${BASE}/test/validate.html`);
for (const q of ['fine', 'normal', 'coarse']) {
  if (q !== 'fine') await page.selectOption('#q', q);
  await page.waitForFunction((q) => window.__floatSimValidation?.quality === q, q, { timeout: 120000 });
  const r = await page.evaluate(() => window.__floatSimValidation);
  expect(`validate.html [${q}] ${r.pass}/${r.total}`, r.pass === r.total);
}

// 2 — app: load the STEP barge through the file picker like a user
await page.goto(`${BASE}/`);
await page.waitForTimeout(800);
await page.setInputFiles('#file', MODEL);
await page.waitForFunction(() => document.querySelector('#modelInfo').innerText.includes('box_4x2x1'), null, { timeout: 60000 });
expect('STEP import: watertight, 8 m³', (await page.locator('#modelInfo').innerText()).match(/Watertight\s+yes/) && (await page.locator('#modelInfo').innerText()).includes('8 m³'));
for (const [id, v] of [['mass', '3200'], ['cgx', '2000'], ['cgy', '0'], ['cgz', '500']]) { await page.fill(`#${id}`, v); await page.press(`#${id}`, 'Enter'); }
await page.waitForTimeout(300);
expect('barge draft 400 mm', near(num(await stat('Draft')), 400, 1e-3), await stat('Draft'));
expect('barge BM_T 833.333 mm', near(num(await stat('BMT')), 833.333, 1e-3), await stat('BMT'));
expect('barge GM_T 533.333 mm', near(num(await stat('GMT')), 533.333, 1e-3), await stat('GMT'));
expect('barge GM_L 3033.333 mm', near(num(await stat('GML')), 3033.333, 1e-3), await stat('GML'));
expect('barge 80 kg/cm', near(num(await stat('Immersion')), 80, 1e-3), await stat('Immersion'));
expect('verdict stable', (await page.locator('#verdict').innerText()).startsWith('Stable'));
if (shots) await page.screenshot({ path: `${shots}/app-barge.png` });

await page.click('#water button[data-rho="1025"]'); await page.waitForTimeout(200);
expect('salt-water draft 390.244 mm', near(num(await stat('Draft')), 390.244, 1e-3), await stat('Draft'));
await page.click('#water button[data-rho="1000"]');

// 2b — units menu is display-only for STEP (known size): mm → in keeps the body where it is
await page.waitForTimeout(200);
await page.selectOption('#units', '0.0254'); await page.waitForTimeout(300);
expect('mm → in: same draft, shown as 15.748 in', near(num(await stat('Draft')), 400 / 25.4, 1e-3), await stat('Draft'));
expect('mm → in: CoG X converted to 78.7402 in', near(num(await page.inputValue('#cgx')), 2000 / 25.4, 1e-3), await page.inputValue('#cgx'));
expect('mm → in: still 40 % submerged', (await page.locator('#massInfo').innerText()).includes('40% of its volume'));
await page.click('#simRun'); await page.waitForTimeout(3500);
expect('simulate from rest explains why nothing moves', (await page.locator('#simInfo').innerText()).includes('started at rest'));
await page.click('#simReset');
await page.selectOption('#units', '0.001'); await page.waitForTimeout(300);
expect('in → mm: back to 400 mm and CoG X 2000', near(num(await stat('Draft')), 400, 1e-3) && near(num(await page.inputValue('#cgx')), 2000, 1e-6), `${await stat('Draft')}, ${await page.inputValue('#cgx')}`);

// 3 — target plane from upright: draft 250 mm → 2000 kg
await page.fill('#tVal', '250'); await page.click('#tCalc'); await page.waitForTimeout(200);
const tm = await page.evaluate(() => document.querySelector('#tOut tr td:last-child').innerText);
expect('target draft 250 mm → 2000 kg', near(num(tm), 2000, 0.05), tm);
await page.click('#tApply'); await page.waitForTimeout(200);
expect('apply mass → draft 250 mm', near(num(await stat('Draft')), 250, 1e-3), await stat('Draft'));
await page.fill('#mass', '3200'); await page.press('#mass', 'Enter');

// 4 — off-centre CoG: warning, then settle to the wall-sided list angle
await page.fill('#cgy', '50'); await page.press('#cgy', 'Enter'); await page.waitForTimeout(200);
expect('not-at-rest warning shown', (await page.locator('#verdict').innerText()).includes('not at rest'));
await settle();
const roll = num(await page.inputValue('#rollN'));
expect('settles at −5.32° list', near(roll, -5.32, 0.02), `roll ${roll}°`);
if (shots) await page.screenshot({ path: `${shots}/app-list.png` });

// 5 — cube s.g. ½: unstable upright, rolls to 45°, neutral about the edge axis
const gzBefore = await page.locator('#gzInfo').innerText();
await page.selectOption('#demo', 'box');
// the GZ panel redraws on a short debounce; software WebGL can delay it, so wait for the change
await page.waitForFunction((b) => document.querySelector('#gzInfo').innerText !== b, gzBefore, { timeout: 30000 });
expect('cube s.g. ½ upright → Unstable', (await page.locator('#verdict').innerText()).startsWith('Unstable'));
const gzTxt = await page.locator('#gzInfo').innerText();
const loll = num((gzTxt.match(/about ([\d.]+)°/) || [])[1]);
expect('GZ says unstable, rests near 45°', gzTxt.includes('unstable') && near(loll, 45, 0.5), gzTxt.split('\n').slice(-1)[0]);
await settle();
// released from exactly upright it must NOT stay balanced on the unstable equilibrium
const cr = num(await page.inputValue('#rollN')), cp = num(await page.inputValue('#pitchN'));
expect('cube leaves the unstable upright attitude', Math.abs(cr) > 10 || Math.abs(cp) > 10, `roll ${cr}°, pitch ${cp}°`);
expect('…and comes to rest stable (GM_T, GM_L > 0)', num(await stat('GMT')) > 0 && num(await stat('GML')) > 0, `${await stat('GMT')} / ${await stat('GML')}`);
if (shots) await page.screenshot({ path: `${shots}/app-cube.png` });

// 6 — seakeeping: SS3 beam seas on the demo barge
await page.selectOption('#demo', 'hull');
await page.waitForTimeout(500);
await page.selectOption('#ssSel', '3');
await page.click('#tabs button[data-tab="tabSea"]');
await page.waitForFunction(() => document.querySelector('#specInfo').innerText.includes('Peak'), null, { timeout: 30000 });
expect('spectrum drawn, FK validity reported', (await page.locator('#specInfo').innerText()).includes('Froude–Krylov validity'));
await page.click('#waveRun'); await page.waitForTimeout(4000);
const wi = await page.locator('#waveInfo').innerText();
expect('real-time wave run advances', num((wi.match(/t = ([\d.]+) s/) || [])[1]) > 0.5, wi.split('\n')[0]);
if (shots) await page.screenshot({ path: `${shots}/sea-run.png` });
await page.click('#waveRun');
await page.click('#ssSweep'); await page.waitForTimeout(800);
const ssRows = await page.locator('#ssTable tr').count();
expect('sea-state sweep table SS1–SS5', ssRows === 6, `${ssRows - 1} rows`);
await page.click('#waveStats');
await page.waitForFunction(() => document.querySelector('#waveInfo').innerText.startsWith('Statistics complete'), null, { timeout: 300000 });
const statRow = async (label) => page.evaluate((l) => {
  const r = [...document.querySelectorAll('#seaStats tr')].find((t) => t.cells[0]?.innerText.startsWith(l));
  return r ? [r.cells[1].innerText, r.cells[2].innerText] : null;
}, label);
const [rTd, rSp] = (await statRow('Roll σ')).map(num), [hTd, hSp] = (await statRow('Heave σ')).map(num);
expect('20-min SS3 run: roll σ time domain ≈ spectral (±15 %)', Math.abs(rTd / rSp - 1) < 0.15, `${rTd}° vs ${rSp}°`);
expect('20-min SS3 run: heave σ time domain ≈ spectral (±15 %)', Math.abs(hTd / hSp - 1) < 0.15, `${hTd} m vs ${hSp} m`);
expect('sea-state verdict shown', /SS3: max roll/.test(await page.locator('#seaVerdict').innerText()));
if (shots) await page.screenshot({ path: `${shots}/sea-stats.png` });

// 6b — regular waves from user inputs (no spectrum): H 0.5 m, T 8 s, beam
await page.click('#waveMode button[data-mode="regular"]');
expect('regular mode shows its inputs and hides the spectrum inputs',
  await page.locator('#regInputs').isVisible() && !(await page.locator('#specInputs').isVisible()) && !(await page.locator('#ssSel').isVisible()));
await page.fill('#rgH', '0.5'); await page.dispatchEvent('#rgH', 'change');
await page.fill('#rgT', '8'); await page.dispatchEvent('#rgT', 'change');
await page.fill('#ssHeadN', '90'); await page.dispatchEvent('#ssHeadN', 'change');
const rgi = await page.locator('#rgInfo').innerText();
expect('regular wave: wavelength gT²/2π = 99.9 m shown', /wavelength 99\.9 m/.test(rgi), rgi);
expect('regular wave: linear steady-state prediction shown', (await page.locator('#specInfo').innerText()).includes('Linear steady-state prediction'));
await page.click('#waveRun'); await page.waitForTimeout(4000);
const rwi = await page.locator('#waveInfo').innerText();
expect('regular real-time run advances with linear reference', num((rwi.match(/t = ([\d.]+) s/) || [])[1]) > 0.5 && rwi.includes('linear steady state'), rwi.split('\n')[0]);
if (shots) await page.screenshot({ path: `${shots}/sea-regular-run.png` });
expect('wave drift on by default: live drift speed and Stokes drift shown', rwi.includes('Stokes drift over the draft'));
expect('restart button enabled while running', !(await page.locator('#waveRestart').isDisabled()));
await page.click('#waveRestart'); await page.waitForTimeout(1500);
expect('restart starts the run again from t ≈ 0', num(((await page.locator('#waveInfo').innerText()).match(/t = ([\d.]+) s/) || [])[1]) < 2.5);
await page.uncheck('#driftOn'); await page.waitForTimeout(1500);
expect('drift off: held on station', (await page.locator('#waveInfo').innerText()).includes('wave drift off'));
await page.check('#driftOn');
await page.uncheck('#waveFollow');
const tgt0 = await page.evaluate(() => document.querySelector('#waveInfo').innerText);
await page.waitForTimeout(800);
expect('camera follow can be switched off while running', tgt0.length > 0 && !(await page.locator('#waveFollow').isChecked()));
await page.check('#waveFollow');
await page.click('#waveRun');
expect('restart button disabled when stopped', await page.locator('#waveRestart').isDisabled());
expect('statistics button reads 5 min in regular mode', (await page.locator('#waveStats').innerText()).includes('5 min'));
await page.click('#waveStats');
await page.waitForFunction(() => document.querySelector('#waveInfo').innerText.startsWith('Statistics complete'), null, { timeout: 300000 });
const [eTd, eIn] = (await statRow('Wave at G')).map(num), [rgTd, rgLin] = (await statRow('Roll')).map(num), [hgTd, hgLin] = (await statRow('Heave')).map(num);
expect('regular run: measured wave amplitude = H/2 (±3 %)', Math.abs(eTd / 0.25 - 1) < 0.03 && Math.abs(eIn - 0.25) < 1e-9, `${eTd} m vs ${eIn} m`);
expect('regular run: steady roll ≈ linear RAO × A (±15 %)', Math.abs(rgTd / rgLin - 1) < 0.15, `${rgTd}° vs ${rgLin}°`);
expect('regular run: steady heave ≈ linear RAO × A (±15 %)', Math.abs(hgTd / hgLin - 1) < 0.15, `${hgTd} m vs ${hgLin} m`);
const driftTxt = await page.evaluate(() => [...document.querySelectorAll('#seaStats tr')].find((t) => t.cells[0]?.innerText.startsWith('Mean drift'))?.cells[1]?.innerText || '');
expect('statistics report the mean drift', /toward [\d.]+°/.test(driftTxt), driftTxt);
expect('regular verdict names the wave', /Regular H 0\.5 m, T 8 s: max roll/.test(await page.locator('#seaVerdict').innerText()));
if (shots) await page.screenshot({ path: `${shots}/sea-regular-stats.png` });
await page.click('#waveMode button[data-mode="spectrum"]');
expect('back to spectrum mode restores the sea-state picker', await page.locator('#ssSel').isVisible());

// 7 — RAO sweep (Hz inputs, progress, async)
expect('RAO range shown in Hz → rad/s', (await page.locator('#raoRange').innerText()).includes('rad/s'));
await page.click('#raoRun');
await page.waitForFunction(() => !document.querySelector('#raoProgWrap').classList.contains('hidden'), null, { timeout: 10000 });
expect('progress bar shown while computing', true);
await page.waitForFunction(() => !document.querySelector('#raoRun').disabled && document.querySelector('#raoInfo').innerText.includes('headings'), null, { timeout: 120000 });
expect('RAO sweep computed', (await page.locator('#raoInfo').innerText()).includes('5 headings'));
expect('natural frequencies reported in Hz', /heave [\d.]+ Hz/.test(await page.locator('#raoInfo').innerText()));
expect('RAO response table (5 headings)', (await page.locator('#raoResp tr').count()) === 6);
const dl = page.waitForEvent('download');
await page.click('#raoCsv');
const csv = await (await dl).createReadStream().then((st) => new Promise((res) => { let d = ''; st.on('data', (c) => { d += c; }); st.on('end', () => res(d)); }));
expect('RAO CSV export (5 × 80 rows + header)', csv.trim().split('\n').length === 401, `${csv.trim().split('\n').length} lines`);
const dl2 = page.waitForEvent('download');
await page.click('#raoRaw');
const raw = await (await dl2).createReadStream().then((st) => new Promise((res) => { let d = ''; st.on('data', (c) => { d += c; }); st.on('end', () => res(d)); }));
const rawLines = raw.trim().split('\n'), dataLines = rawLines.filter((l) => !l.startsWith('#'));
expect('raw CSV: header comments + 41 columns × 400 rows', rawLines[0].startsWith('# Float Sim raw RAO export') && dataLines.length === 401 && dataLines[0].split(',').length === 41, `${dataLines.length} lines, ${dataLines[0].split(',').length} cols`);
// leaving and re-opening the RAO tab shows the loading overlay, then the plots
await page.click('#tabs button[data-tab="tabHydro"]');
await page.click('#tabs button[data-tab="tabRao"]');
await page.waitForFunction(() => document.querySelector('#raoLoading').classList.contains('hidden'), null, { timeout: 30000 });
expect('RAO tab re-renders after loading overlay', (await page.locator('#raoResp tr').count()) === 6);
if (shots) await page.screenshot({ path: `${shots}/sea-rao.png` });

// 8 — custom moments of inertia (STEP barge: roll period T = 2π√(Ixx / (ρgV·GM_T)), dry, no added mass)
await page.setInputFiles('#file', MODEL);
await page.waitForFunction(() => document.querySelector('#modelInfo').innerText.includes('box_4x2x1'), null, { timeout: 60000 });
for (const [id, v] of [['mass', '3200'], ['cgx', '2000'], ['cgy', '0'], ['cgz', '500']]) { await page.fill(`#${id}`, v); await page.press(`#${id}`, 'Enter'); }
await page.click('#tabs button[data-tab="tabHydro"]');
await page.selectOption('#inMode', 'custom');
expect('custom inertia prefilled with computed values', num(await page.inputValue('#inXX')) > 0);
await page.fill('#inXX', '2000'); await page.press('#inXX', 'Enter'); await page.waitForTimeout(300);
const Troll = 2 * Math.PI * Math.sqrt(2000 / (1000 * 9.80665 * 3.2 * (0.2 + 4 / (12 * 0.4) - 0.5)));
expect(`custom Ixx = 2000 kg·m² → roll period ${Troll.toFixed(3)} s`, near(num(await stat('Roll')), Troll, 0.01), await stat('Roll'));
await page.fill('#inXX', '99999'); await page.press('#inXX', 'Enter'); await page.waitForTimeout(300);
expect('non-physical inertia rejected (triangle inequality)', (await page.locator('#inInfo').innerText()).includes('triangle inequality'));

// 9 — drop / rise test (barge STEP still loaded, custom inertia back to computed)
await page.selectOption('#inMode', 'auto');
await page.fill('#dzH', '3000'); await page.dispatchEvent('#dzH', 'input');   // mm: CoG 3 m above the water
await page.click('#dzPlace'); await page.waitForTimeout(300);
const lockState = async () => page.evaluate(() => ['waveRun', 'waveStats', 'ssSweep', 'raoRun', 'simRun'].map((id) => document.getElementById(id).disabled));
expect('placing locks waves, statistics, sea-state table, RAOs and calm simulate', (await lockState()).every(Boolean));
expect('lock notes visible', await page.locator('.lock-note:not(.hidden)').count() === 2);
await page.fill('#dzSpeed', '8'); await page.dispatchEvent('#dzSpeed', 'input');
await page.click('#dzRun');
await page.waitForFunction(() => /Settled|Sinks|time limit/.test(document.querySelector('#dzInfo').innerText), null, { timeout: 180000 });
const dropRow = async (label) => page.evaluate((l) => { const r = [...document.querySelectorAll('#dzStats tr')].find((t) => t.cells[0].innerText.startsWith(l)); return r ? r.cells[1].innerText : ''; }, label);
const entry = await dropRow('Water entry speed');
const vEntry = num(entry.split(' m/s')[0]), vFree = Math.sqrt(2 * 9.80665 * 2.5);   // keel 0.5 m below the CoG → falls 2.5 m
expect('drop from 3 m: entry speed ≈ √(2gh) (air drag ≤ 2 %)', vEntry < vFree && vEntry > 0.98 * vFree, `${vEntry} m/s vs ${vFree.toFixed(3)} m/s`);
expect('drop: plunges, then settles at the float height (CoG 100 mm above water: draft 400, KG 500)', (await page.locator('#dropVerdict').innerText()).includes('Stabilized') && near(parseFloat((await dropRow('Settled')).split(' at ')[1]), 100, 3), await dropRow('Settled'));
await page.fill('#dzH', '-3000'); await page.dispatchEvent('#dzH', 'input');
await page.click('#dzPlace'); await page.click('#dzRun');
await page.waitForFunction(() => /Settled|Sinks|time limit/.test(document.querySelector('#dzInfo').innerText), null, { timeout: 180000 });
expect('rise from 3 m depth: breaks the surface and stabilizes', (await page.locator('#dropVerdict').innerText()).includes('Stabilized') && (await dropRow('Broke the surface')).length > 0);
if (shots) await page.screenshot({ path: `${shots}/drop.png` });
await page.click('#dzReset'); await page.waitForTimeout(300);
expect('reset position unlocks the tools', (await lockState()).every((d) => !d));

expect('no console errors', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
