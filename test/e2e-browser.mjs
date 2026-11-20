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

// 7 — RAO sweep
await page.click('#raoRun'); await page.waitForTimeout(1500);
expect('RAO sweep computed', (await page.locator('#raoInfo').innerText()).includes('5 headings'));
expect('RAO response table (5 headings)', (await page.locator('#raoResp tr').count()) === 6);
const dl = page.waitForEvent('download');
await page.click('#raoCsv');
const csv = await (await dl).createReadStream().then((st) => new Promise((res) => { let d = ''; st.on('data', (c) => { d += c; }); st.on('end', () => res(d)); }));
expect('RAO CSV export (5 × 80 rows + header)', csv.trim().split('\n').length === 401, `${csv.trim().split('\n').length} lines`);
if (shots) await page.screenshot({ path: `${shots}/sea-rao.png` });

expect('no console errors', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
