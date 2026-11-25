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
// The app shows one stage (Float · Waves · RAO · drop test) and one tool pane at a time and folds some sections.
// Bring an element into view the way a user would (stage tab, Tools menu, section header) before using it.
const reveal = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return;
  const pane = el.closest('.stagepane');
  if (pane && !pane.classList.contains('active')) {
    const p = pane.dataset.pane;
    if (p.startsWith('tool-')) document.querySelector(`.menu [data-tool="${p.slice(5)}"]`).click();
    else document.querySelector(`#tabs [data-stage="${p}"]`).click();
  }
  const tb = el.closest('.tab-body');
  if (tb && tb.classList.contains('hidden')) document.querySelector(`#tabs [data-tab="${tb.id}"]`).click();
  const grp = el.closest('#anim .grp');
  if (grp && !grp.classList.contains('on')) document.querySelector(`#tabs [data-stage="${grp.dataset.for}"]`).click();
  for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
}, sel).then(() => page.waitForTimeout(30));
const click = async (sel, o) => { await reveal(sel); await page.click(sel, o); };
const fill = async (sel, v) => { await reveal(sel); await page.fill(sel, v); };
const select = async (sel, v) => { await reveal(sel); await page.selectOption(sel, v); };
const check = async (sel) => { await reveal(sel); await page.check(sel); };
const uncheck = async (sel) => { await reveal(sel); await page.uncheck(sel); };
const stat = (label) => page.evaluate((l) => {
  const r = [...document.querySelectorAll('#stats tr')].find((t) => t.cells[0]?.innerText.startsWith(l));
  return r ? r.cells[1].innerText : null;
}, label);
const settle = async () => {
  await click('#simSettle');
  await page.waitForFunction(() => !document.querySelector('#simRun').textContent.includes('Pause'), null, { timeout: 180000 });
};

// 1 — validation page, all mesh qualities (E2E_SKIP_VALIDATE=1 skips it when only the app UI changed)
if (!process.env.E2E_SKIP_VALIDATE) await page.goto(`${BASE}/test/validate.html`);
for (const q of process.env.E2E_SKIP_VALIDATE ? [] : ['fine', 'normal', 'coarse']) {
  if (q !== 'fine') await select('#q', q);
  await page.waitForFunction((q) => window.__floatSimValidation?.quality === q, q, { timeout: 1200000 });
  const r = await page.evaluate(() => window.__floatSimValidation);
  expect(`validate.html [${q}] ${r.pass}/${r.total}`, r.pass === r.total);
}

// 2 — app: load the STEP barge through the file picker like a user
await page.goto(`${BASE}/`);
await page.waitForTimeout(800);
await page.setInputFiles('#file', MODEL);
await page.waitForFunction(() => document.querySelector('#modelInfo').innerText.includes('box_4x2x1'), null, { timeout: 60000 });
expect('STEP import: watertight, 8 m³', (await page.locator('#modelInfo').innerText()).match(/Watertight\s+yes/) && (await page.locator('#modelInfo').innerText()).includes('8 m³'));
for (const [id, v] of [['mass', '3200'], ['cgx', '2'], ['cgy', '0'], ['cgz', '0.5']]) { await fill(`#${id}`, v); await page.press(`#${id}`, 'Enter'); }
await page.waitForTimeout(300);
// metric throughout: lengths in metres, shown to the millimetre
expect('barge draft 0.4 m', near(num(await stat('Draft')), 0.4, 1e-3), await stat('Draft'));
expect('barge BM_T 0.833 m', near(num(await stat('BMT')), 0.833333, 1e-3), await stat('BMT'));
expect('barge GM_T 0.533 m', near(num(await stat('GMT')), 0.533333, 1e-3), await stat('GMT'));
expect('barge GM_L 3.033 m', near(num(await stat('GML')), 3.033333, 1e-3), await stat('GML'));
expect('barge 80 kg/cm', near(num(await stat('Immersion')), 80, 1e-3), await stat('Immersion'));
expect('verdict stable', (await page.locator('#verdict').innerText()).startsWith('Stable'));
if (shots) await page.screenshot({ path: `${shots}/app-barge.png` });

await click('#water button[data-rho="1025"]'); await page.waitForTimeout(200);
expect('salt-water draft 0.390 m', near(num(await stat('Draft')), 0.390244, 1e-3), await stat('Draft'));
expect('status bar shows the water density', (await page.locator('#sbWater').innerText()).includes('1025'));
await click('#water button[data-rho="1000"]');

// 2b — workspace: metric only, stages, tools, view
expect('metric only: no units menu, status bar says m · kg · s · N', !(await page.$('#units')) && (await page.locator('#statusbar').innerText()).includes('m · kg · s · N'));
expect('STL units row hidden for a STEP model', !(await page.locator('#stlUnitsRow').isVisible()));
expect('Float tab shows the verdict', (await page.locator('#stFloat').innerText()) === 'Stable');
await click('#tabs [data-stage="waves"]');
expect('Waves tab shows the wave setup pane', await page.locator('#ssHeadN').isVisible() && !(await page.locator('#mass').isVisible()));
await click('#toolsBtn'); await click('.menu [data-tool="moor"]');
expect('Tools › Mooring opens its pane in the Waves stage', await page.locator('#moorOn').isVisible() && (await page.evaluate(() => document.body.dataset.stage)) === 'waves');
await click('.stagepane.active [data-act="closetool"]');
expect('OK returns to the wave setup', await page.locator('#ssHeadN').isVisible());
await click('#tabs [data-stage="float"]');
expect('global axes triad drawn', (await page.locator('#triad text').count()) === 3);
await click('#gtb [data-view="top"]'); await page.waitForTimeout(200);
expect('Top view: global Z points at the viewer (no Z arrowhead)', await page.evaluate(() => [...document.querySelectorAll('#triad g')].find((g) => g.textContent === 'Z').querySelector('polygon').getAttribute('points') === ''));
await click('#gtb [data-view="iso"]');
await click('#simRun');
// at rest = slow and B under G, held for 1 s of simulated time (the start kick dies away first)
await page.waitForFunction(() => document.querySelector('#simInfo').innerText.includes('started at rest'), null, { timeout: 60000 }).catch(() => {});
expect('simulate from rest explains why nothing moves', (await page.locator('#simInfo').innerText()).includes('started at rest'));
await click('#simReset');

// 2c — GZ panel: fixed trim by default and labelled; Weakest axis; free trim (same curve for a box, which is
// symmetric fore and aft); the verdict gives the range from the GZ curve about the weakest axis
const gzText = () => page.locator('#gzInfo').innerText();
const waitGz = (pred) => page.waitForFunction((src) => !document.querySelector('#gzInfo').classList.contains('stale') && new Function('t', `return ${src}`)(document.querySelector('#gzInfo').innerText), pred, { timeout: 30000 });
await waitGz("t.includes('fixed trim')");
expect('GZ panel says fixed trim', (await gzText()).includes('fixed trim: the body is not allowed to re-trim'));
await page.waitForFunction(() => /vanishes at 90°/.test(document.querySelector('#verdict').innerText), null, { timeout: 30000 }).catch(() => {});
expect('verdict: range from the GZ curve (box vanishes at 90°), not "self-righting"', /vanishes at 90°/.test(await page.locator('#verdict').innerText()) && !/self-righting/.test(await page.locator('#verdict').innerText()), (await page.locator('#verdict').innerText()).slice(0, 200));
expect('weakest axis row reads 0° for a box along x', (await stat('GM about weakest axis')).includes('axis at 0° from x'), await stat('GM about weakest axis'));
await click('#gzAxis button[data-axis="min"]');
await waitGz("t.includes('weakest waterplane axis')");
expect('GZ about the weakest axis', (await gzText()).includes('Heeling in the weakest waterplane axis (0° from x)'));
await check('#gzFree');
await waitGz("t.includes('free trim')");
const gzFreeTxt = await gzText();
expect('free trim: labelled, and the box keeps max GZ 0.324 m and 90°', gzFreeTxt.includes('free trim: at every angle') && /Max GZ\s+0\.324 m/.test(gzFreeTxt) && gzFreeTxt.includes('(free trim): 90°'), gzFreeTxt.split('\n').slice(1).join(' | '));
await uncheck('#gzFree');
await click('#gzAxis button[data-axis="x"]');
await waitGz("t.includes('fixed trim') && t.includes('roll (about x)')");

// 2d — an STL whose +y side face is wound the wrong way: repaired on import, true hydrostatics
{
  const P = [];   // 4 × 2 × 1 m box in millimetres (the default STL units), outward winding except the +y side
  const q = (a, b, c, d) => { P.push([a, b, c], [a, c, d]); };
  const V = (x, y, z) => [x * 1000, y * 1000, z * 1000];
  q(V(0, -1, 0), V(0, 1, 0), V(4, 1, 0), V(4, -1, 0)); q(V(0, -1, 1), V(4, -1, 1), V(4, 1, 1), V(0, 1, 1));
  q(V(0, -1, 0), V(4, -1, 0), V(4, -1, 1), V(0, -1, 1)); q(V(0, 1, 0), V(4, 1, 0), V(4, 1, 1), V(0, 1, 1));   // +y side: flipped
  q(V(0, -1, 0), V(0, -1, 1), V(0, 1, 1), V(0, 1, 0)); q(V(4, -1, 0), V(4, 1, 0), V(4, 1, 1), V(4, -1, 1));
  const stl = `solid flipped\n${P.map((t) => `facet normal 0 0 0\nouter loop\n${t.map((v) => `vertex ${v.join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid flipped\n`;
  await page.setInputFiles('#file', { name: 'box_flipped_side.stl', mimeType: 'model/stl', buffer: Buffer.from(stl) });
  await page.waitForFunction(() => document.querySelector('#modelInfo').innerText.includes('box_flipped_side'), null, { timeout: 60000 });
  for (const [id, v] of [['mass', '3200'], ['cgx', '2'], ['cgy', '0'], ['cgz', '0.5']]) { await fill(`#${id}`, v); await page.press(`#${id}`, 'Enter'); }
  await page.waitForTimeout(300);
  const mi = await page.locator('#modelInfo').innerText();
  expect('STL with a flipped side face: re-oriented on import (2 faces), 8 m³', mi.includes('2 faces wound against') && mi.includes('8 m³'), mi.split('\n').slice(-2).join(' | '));
  expect('…true hydrostatics: draft 0.4 m, GM_T 0.533 m', near(num(await stat('Draft')), 0.4, 1e-3) && near(num(await stat('GMT')), 0.533333, 1e-3), `${await stat('Draft')} / ${await stat('GMT')}`);
  // openings (review R1-15) and crossing shells (R1-19): the same box without its deck, without an end face, and two
  // crossing boxes, all repaired in the import worker
  const stlOf = (name, quads) => {
    const T = []; for (const [a, b, c, d] of quads) T.push([a, b, c], [a, c, d]);
    return { name, mimeType: 'model/stl', buffer: Buffer.from(`solid ${name}\n${T.map((t) => `facet normal 0 0 0\nouter loop\n${t.map((v) => `vertex ${v.join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid ${name}\n`) };
  };
  const boxQ = (x0, y0, z0, x1, y1, z1, skip = '') => [
    ['bottom', [V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), V(x1, y0, z0)]], ['deck', [V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1)]],
    ['-y', [V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1)]], ['+y', [V(x0, y1, z0), V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0)]],
    ['-x', [V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0)]], ['+x', [V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), V(x1, y0, z1)]],
  ].filter(([k]) => k !== skip).map(([, q4]) => q4);
  const loadStl = async (f) => {
    await page.setInputFiles('#file', f);
    await page.waitForFunction((n) => document.querySelector('#modelInfo').innerText.includes(n), f.name, { timeout: 60000 });
    for (const [id, v] of [['mass', '3200'], ['cgx', '2'], ['cgy', '0'], ['cgz', '0.5']]) { await fill(`#${id}`, v); await page.press(`#${id}`, 'Enter'); }
    await page.waitForFunction(() => !document.querySelector('#gzInfo').classList.contains('stale') && !/being worked out/.test(document.querySelector('#verdict').innerText), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(300);
  };
  await loadStl(stlOf('box_nodeck.stl', boxQ(0, -1, 0, 4, 1, 1, 'deck')));
  const vd = await page.locator('#verdict').innerText(), gzd = await page.locator('#gzInfo').innerText();
  expect('open-deck STL: the verdict\'s range ends where an opening goes under water', /opening goes under water/.test(vd), vd.slice(0, 220));
  expect('…the roll GZ panel gives the downflooding angle 32° (exact section: 32.0054°)', /goes under water at 32°/.test(gzd), gzd.split('\n').slice(-1).join(''));
  // the Waves stage's roll range ends there too (review R1-31)
  await click('#tabs [data-stage="waves"]'); await page.waitForTimeout(300);
  await click('#ssSweep');
  await page.waitForFunction(() => /roll range of stability/.test(document.querySelector('#ssTable').innerText), null, { timeout: 180000 }).catch(() => {});
  const sst = await page.locator('#ssTable').innerText();
  expect('…the Waves stage\'s roll range ends at the downflooding angle (32°)', /roll range of stability \(32°/.test(sst) && /opening goes under water/.test(sst), (sst.match(/roll range of stability \([^)]*\)/) || [''])[0]);
  await click('#tabs [data-stage="float"]'); await page.waitForTimeout(300);
  await loadStl(stlOf('box_noend.stl', boxQ(0, -1, 0, 4, 1, 1, '-x')));
  expect('STL with an end face missing: the verdict is "Opening under water"', (await page.locator('#verdict').innerText()).startsWith('Opening under water'), (await page.locator('#verdict').innerText()).slice(0, 120));
  await loadStl(stlOf('cross.stl', [...boxQ(-2, -0.5, 0, 2, 0.5, 1), ...boxQ(-0.5, -2, 0, 0.5, 2, 1)]));
  expect('two crossing boxes in one STL: the overlap is reported', /overlaps? another shell/.test(await page.locator('#modelInfo').innerText()), (await page.locator('#modelInfo').innerText()).split('\n').slice(-2).join(' | '));
  await page.setInputFiles('#file', MODEL);
  await page.waitForFunction(() => document.querySelector('#modelInfo').innerText.includes('box_4x2x1'), null, { timeout: 60000 });
  for (const [id, v] of [['mass', '3200'], ['cgx', '2'], ['cgy', '0'], ['cgz', '0.5']]) { await fill(`#${id}`, v); await page.press(`#${id}`, 'Enter'); }
  await page.waitForTimeout(300);
}

// 3 — target plane from upright: draft 0.25 m → 2000 kg
await fill('#tVal', '0.25'); await click('#tCalc'); await page.waitForTimeout(200);
const tm = await page.evaluate(() => document.querySelector('#tOut tr td:last-child').innerText);
expect('target draft 0.25 m → 2000 kg', near(num(tm), 2000, 0.05), tm);
await click('#tApply'); await page.waitForTimeout(200);
expect('apply mass → draft 0.25 m', near(num(await stat('Draft')), 0.25, 1e-3), await stat('Draft'));
await fill('#mass', '3200'); await page.press('#mass', 'Enter');

// 4 — off-centre CoG: warning, then settle to the wall-sided list angle
await fill('#cgy', '0.05'); await page.press('#cgy', 'Enter'); await page.waitForTimeout(200);
expect('not-at-rest warning shown', (await page.locator('#verdict').innerText()).includes('not at rest'));
await settle();
const roll = num(await page.inputValue('#rollN'));
expect('settles at the wall-sided list −5.31999° (to 2e-4°)', near(roll, -5.319994, 2e-4), `roll ${roll}°`);
expect('…and the verdict then says it is at rest', !(await page.locator('#verdict').innerText()).includes('not at rest'));
// 4b — a tender box: GM_T 0.01 m, CoG 2 mm off the centreline. The simulation alone stops about 2.5e-3° short of the
// wall-sided list (−7.001683°; exact here, since neither the deck edge nor the bilge emerges), so this checks that Settle
// ends with its static equilibrium solve (review R1-23)
await fill('#cgy', '0.002'); await page.press('#cgy', 'Enter');
await fill('#cgz', String(0.2 + 1 / 1.2 - 0.01)); await page.press('#cgz', 'Enter'); await page.waitForTimeout(200);
await settle();
{
  const tr = num(await page.inputValue('#rollN')), si = await page.locator('#simInfo').innerText();
  expect('tender box settles at the wall-sided list −7.001683° (to 2e-4°; the simulation alone stops ~2.5e-3° short)', near(tr, -7.001683, 2e-4), `roll ${tr}°`);
  expect('…and Settle finished with the static equilibrium solve', si.includes('Finished with a static equilibrium solve'), si.split('\n').slice(-1).join(''));
}
if (shots) await page.screenshot({ path: `${shots}/app-list.png` });

// 5 — cube s.g. ½: unstable upright. Fixed-trim GZ about x turns positive at 45° (edge-down, which is neutral about
// the edge), but the 3D rest is corner-down: the body diagonal vertical (lowest potential energy over all attitudes)
const gzBefore = await page.locator('#gzInfo').innerText();
await select('#demo', 'box');
// the GZ panel redraws on a short debounce; software WebGL can delay it, so wait for the change
await page.waitForFunction((b) => document.querySelector('#gzInfo').innerText !== b, gzBefore, { timeout: 30000 });
expect('cube s.g. ½ upright → Unstable', (await page.locator('#verdict').innerText()).startsWith('Unstable'));
const gzTxt = await page.locator('#gzInfo').innerText();
const loll = num((gzTxt.match(/about ([\d.]+)°/) || [])[1]);
expect('GZ says unstable, turns positive at 45° (fixed trim)', gzTxt.includes('unstable') && gzTxt.includes('fixed trim, this axis') && near(loll, 45, 0.01), gzTxt.split('\n').slice(-1)[0]);
await settle();
// released from exactly upright it must NOT stay balanced on the unstable equilibrium
const cr = num(await page.inputValue('#rollN')), cp = num(await page.inputValue('#pitchN'));
expect('cube leaves the unstable upright attitude', Math.abs(cr) > 10 || Math.abs(cp) > 10, `roll ${cr}°, pitch ${cp}°`);
expect('…and comes to rest stable (GM_T, GM_L > 0)', num(await stat('GMT')) > 0 && num(await stat('GML')) > 0, `${await stat('GMT')} / ${await stat('GML')}`);
{
  // corner-down: in R = Rz·Ry·Rx the world vertical in body axes is (−sin p, cos p sin r, cos p cos r)
  const r = cr * Math.PI / 180, p = cp * Math.PI / 180, up = [-Math.sin(p), Math.cos(p) * Math.sin(r), Math.cos(p) * Math.cos(r)];
  const off = Math.acos(Math.min(1, (Math.abs(up[0]) + Math.abs(up[1]) + Math.abs(up[2])) / Math.sqrt(3))) * 180 / Math.PI;
  expect('…corner-down: body diagonal vertical (within 0.001°)', off < 1e-3, `roll ${cr}°, pitch ${cp}°: ${off.toExponential(2)}° off`);
  const si = await page.locator('#simInfo').innerText();
  expect('…and does not claim it started at rest, and finished with the static equilibrium solve', !si.includes('started at rest') && si.includes('Finished with a static equilibrium solve'), si.split('\n').slice(-2).join(' | '));
  // the verdict's range over all heel directions: corner-down, it ends at the edge-down attitude, atan(1/√2) = 35.26°
  // (about the weakest axis alone, set by round-off, it would read up to 50.8°) (review R1-17, R1-31)
  await page.waitForFunction(() => !/being worked out/.test(document.querySelector('#verdict').innerText) && /vanishes at/.test(document.querySelector('#verdict').innerText), null, { timeout: 120000 }).catch(() => {});
  const cv = await page.locator('#verdict').innerText();
  expect('…its verdict\'s range is the worst heel direction: vanishes at 35.3°', /worst of all heel directions/.test(cv) && /vanishes at 35\.3°/.test(cv), cv.slice(0, 200));
}
if (shots) await page.screenshot({ path: `${shots}/app-cube.png` });

// 6 — seakeeping: SS3 beam seas on the demo barge
await select('#demo', 'hull');
await page.waitForTimeout(500);
await select('#ssSel', '3');
await click('#tabs button[data-tab="tabSea"]');
await page.waitForFunction(() => document.querySelector('#specInfo').innerText.includes('Peak'), null, { timeout: 30000 });
expect('spectrum drawn, FK validity reported', (await page.locator('#specInfo').innerText()).includes('Froude–Krylov validity'));
await click('#waveRun');
// the first run computes panel-method added mass and damping (quick coarse sweep), then starts
await page.waitForFunction(() => /t = [\d.]+ s/.test(document.querySelector('#waveInfo').innerText), null, { timeout: 120000 });
await page.waitForTimeout(4000);
const wi = await page.locator('#waveInfo').innerText();
expect('real-time wave run advances', num((wi.match(/t = ([\d.]+) s/) || [])[1]) > 0.5, wi.split('\n')[0]);
expect('wave run uses panel-method added mass and damping', wi.includes('panel method'), wi.split('\n').pop());
if (shots) await page.screenshot({ path: `${shots}/sea-run.png` });
await click('#waveRun');
await click('#ssSweep'); await page.waitForTimeout(800);
const ssRows = await page.locator('#ssTable tr').count();
expect('sea-state sweep table SS1–SS5', ssRows === 6, `${ssRows - 1} rows`);
await click('#waveStats');
await page.waitForFunction(() => !document.querySelector('#taskbox').classList.contains('hidden') && /Running statistics/.test(document.querySelector('#taskTitle').textContent), null, { timeout: 60000 });
await page.waitForFunction(() => /\d+ %/.test(document.querySelector('#taskPct').textContent) && /elapsed/.test(document.querySelector('#taskTime').textContent), null, { timeout: 60000 });
expect('statistics run: progress window over the view with title, % and elapsed time', true, `${await page.locator('#taskTitle').innerText()} · ${await page.locator('#taskPct').innerText()} · ${await page.locator('#taskTime').innerText()}`);
expect('statistics run: Waves tab shows the percentage', /statistics \d+ %/.test(await page.locator('#stWaves').innerText()), await page.locator('#stWaves').innerText());
await page.click('#taskHide');
expect('Hide moves the progress to the status bar', !(await page.locator('#taskbox').isVisible()) && (await page.locator('#sbTask').isVisible()) && /^Running statistics.* · \d+ %$/.test(await page.locator('#sbTaskText').innerText()), await page.locator('#sbTaskText').innerText());
await page.click('#sbTask');
expect('clicking the status-bar progress brings the window back', await page.locator('#taskbox').isVisible());
await page.waitForFunction(() => document.querySelector('#waveInfo').innerText.startsWith('Statistics complete'), null, { timeout: 900000 });
expect('progress window closes when the run finishes', !(await page.locator('#taskbox').isVisible()) && !(await page.locator('#sbTask').isVisible()));
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
await click('#waveMode button[data-mode="regular"]');
expect('regular mode shows its inputs and hides the spectrum inputs',
  await page.locator('#regInputs').isVisible() && !(await page.locator('#specInputs').isVisible()) && !(await page.locator('#ssSel').isVisible()));
await fill('#rgH', '0.5'); await page.dispatchEvent('#rgH', 'change');
await fill('#rgT', '8'); await page.dispatchEvent('#rgT', 'change');
await fill('#ssHeadN', '90'); await page.dispatchEvent('#ssHeadN', 'change');
const rgi = await page.locator('#rgInfo').innerText();
expect('regular wave: wavelength gT²/2π = 99.9 m shown', /wavelength 99\.9 m/.test(rgi), rgi);
expect('regular wave: linear steady-state prediction shown', (await page.locator('#specInfo').innerText()).includes('Linear steady-state prediction'));
await click('#waveRun'); await page.waitForTimeout(4000);
const rwi = await page.locator('#waveInfo').innerText();
expect('regular real-time run advances with linear reference', num((rwi.match(/t = ([\d.]+) s/) || [])[1]) > 0.5 && rwi.includes('linear steady state'), rwi.split('\n')[0]);
if (shots) await page.screenshot({ path: `${shots}/sea-regular-run.png` });
expect('wave drift on by default: live drift speed and Stokes drift shown', rwi.includes('Stokes drift over the draft'));
expect('restart button enabled while running', !(await page.locator('#waveRestart').isDisabled()));
await click('#waveRestart'); await page.waitForTimeout(1500);
expect('restart starts the run again from t ≈ 0', num(((await page.locator('#waveInfo').innerText()).match(/t = ([\d.]+) s/) || [])[1]) < 2.5);
await uncheck('#driftOn'); await page.waitForTimeout(1500);
expect('drift off: held on station', (await page.locator('#waveInfo').innerText()).includes('wave drift off'));
await check('#driftOn');
await uncheck('#waveFollow');
const tgt0 = await page.evaluate(() => document.querySelector('#waveInfo').innerText);
await page.waitForTimeout(800);
expect('camera follow can be switched off while running', tgt0.length > 0 && !(await page.locator('#waveFollow').isChecked()));
await check('#waveFollow');
await click('#waveRun');
expect('restart button disabled when stopped', await page.locator('#waveRestart').isDisabled());
expect('statistics button reads 5 min in regular mode', (await page.locator('#waveStats').innerText()).includes('5 min'));
await click('#waveStats');
await page.waitForFunction(() => document.querySelector('#waveInfo').innerText.startsWith('Statistics complete'), null, { timeout: 900000 });
const [eTd, eIn] = (await statRow('Wave at G')).map(num), [rgTd, rgLin] = (await statRow('Roll')).map(num), [hgTd, hgLin] = (await statRow('Heave')).map(num);
expect('regular run: measured wave amplitude = H/2 (±3 %)', Math.abs(eTd / 0.25 - 1) < 0.03 && Math.abs(eIn - 0.25) < 1e-9, `${eTd} m vs ${eIn} m`);
expect('regular run: steady roll ≈ linear RAO × A (±15 %)', Math.abs(rgTd / rgLin - 1) < 0.15, `${rgTd}° vs ${rgLin}°`);
expect('regular run: steady heave ≈ linear RAO × A (±15 %)', Math.abs(hgTd / hgLin - 1) < 0.15, `${hgTd} m vs ${hgLin} m`);
const driftTxt = await page.evaluate(() => [...document.querySelectorAll('#seaStats tr')].find((t) => t.cells[0]?.innerText.startsWith('Mean drift'))?.cells[1]?.innerText || '');
expect('statistics report the mean drift', /toward [\d.]+°/.test(driftTxt), driftTxt);
expect('regular verdict names the wave', /Regular H 0\.5 m, T 8 s: max roll/.test(await page.locator('#seaVerdict').innerText()));
if (shots) await page.screenshot({ path: `${shots}/sea-regular-stats.png` });
// 6c — the wave direction is global: yawing the barge 90° turns beam seas (90° from global +X) into head seas
const linPred = async () => { const t = await page.locator('#specInfo').innerText(); return { roll: num((t.match(/roll ±([\d.]+)°/) || [])[1]), pitch: num((t.match(/pitch ±([\d.]+)°/) || [])[1]) }; };
const beam = await linPred();
await fill('#yawN', '90'); await page.dispatchEvent('#yawN', 'change'); await page.waitForTimeout(300);
await click('#tabs [data-stage="waves"]'); await page.waitForTimeout(300);
const head = await linPred();
expect('global wave direction: yaw 90° turns beam seas into head seas (roll → 0, pitch appears)', beam.roll > 0.5 && head.roll < 0.05 && head.pitch > 0.1, `yaw 0: roll ±${beam.roll}°, pitch ±${beam.pitch}° · yaw 90: roll ±${head.roll}°, pitch ±${head.pitch}°`);
await click('#resetOri'); await page.waitForTimeout(200);
// Cancel in the progress window stops a statistics run
await click('#waveStats');
await page.waitForFunction(() => /Running statistics/.test(document.querySelector('#taskTitle').textContent) && !document.querySelector('#taskCancel').classList.contains('hidden'), null, { timeout: 60000 });
await page.click('#taskCancel');
expect('Cancel stops the statistics run and closes the progress window', (await page.locator('#waveInfo').innerText()).includes('cancelled') && !(await page.locator('#taskbox').isVisible()) && !(await page.locator('#waveStats').isDisabled()));
await click('#waveMode button[data-mode="spectrum"]');
expect('back to spectrum mode restores the sea-state picker', await page.locator('#ssSel').isVisible());

// 7 — RAO sweep (Hz inputs, progress, async)
expect('RAO range shown in Hz → rad/s', (await page.locator('#raoRange').innerText()).includes('rad/s'));
await click('#raoRun');
await page.waitForFunction(() => !document.querySelector('#raoProgWrap').classList.contains('hidden'), null, { timeout: 10000 });
expect('progress bar shown while computing', true);
await page.waitForFunction(() => /Panel method: \d+\/\d+ frequencies/.test(document.querySelector('#taskDetail').textContent), null, { timeout: 60000 });
expect('RAO solve: progress window shows the solver step, %, Cancel and the tab percentage',
  (await page.locator('#taskTitle').innerText()).startsWith('Solving RAOs') && /\d+ %/.test(await page.locator('#taskPct').innerText()) && (await page.locator('#taskCancel').isVisible()) && /solving \d+ %/.test(await page.locator('#stRao').innerText()),
  `${await page.locator('#taskDetail').innerText()} · ${await page.locator('#stRao').innerText()}`);
await page.waitForFunction(() => !document.querySelector('#raoRun').disabled && document.querySelector('#raoInfo').innerText.includes('headings'), null, { timeout: 120000 });
expect('progress window closes after the RAO solve', !(await page.locator('#taskbox').isVisible()));
const raoInfo = await page.locator('#raoInfo').innerText();
expect('RAO sweep computed with the panel method by default', raoInfo.includes('5 headings') && raoInfo.startsWith('Panel method') && /[\d,]+ panels/.test(raoInfo), raoInfo.split('\n')[0]);
expect('natural frequencies reported in Hz with radiation damping', /heave [\d.]+ Hz/.test(raoInfo) && raoInfo.includes('radiation damping'));
expect('RAO response table (5 headings)', (await page.locator('#raoResp tr').count()) === 6);
const dl = page.waitForEvent('download');
await click('#raoCsv');
const csv = await (await dl).createReadStream().then((st) => new Promise((res) => { let d = ''; st.on('data', (c) => { d += c; }); st.on('end', () => res(d)); }));
expect('RAO CSV export (5 × 80 rows + header)', csv.trim().split('\n').length === 401, `${csv.trim().split('\n').length} lines`);
const dl2 = page.waitForEvent('download');
await click('#raoRaw');
const raw = await (await dl2).createReadStream().then((st) => new Promise((res) => { let d = ''; st.on('data', (c) => { d += c; }); st.on('end', () => res(d)); }));
const rawLines = raw.trim().split('\n'), dataLines = rawLines.filter((l) => !l.startsWith('#'));
expect('raw CSV: header comments + 57 columns × 400 rows (RAOs, forces, A(ω) and B(ω))', rawLines[0].startsWith('# Float Sim raw RAO export') && dataLines.length === 401 && dataLines[0].split(',').length === 57 && dataLines[0].includes('A33') && raw.includes('panel method'), `${dataLines.length} lines, ${dataLines[0].split(',').length} cols`);
// leaving and re-opening the RAO tab shows the loading overlay, then the plots
await click('#tabs button[data-tab="tabHydro"]');
await click('#tabs button[data-tab="tabRao"]');
await page.waitForFunction(() => document.querySelector('#raoLoading').classList.contains('hidden'), null, { timeout: 30000 });
expect('RAO tab re-renders after loading overlay', (await page.locator('#raoResp tr').count()) === 6);
if (shots) await page.screenshot({ path: `${shots}/sea-rao.png` });
// the sea-state table now uses the panel-method RAOs where the sweep covers the sea
await click('#tabs button[data-tab="tabSea"]');
await click('#ssSweep'); await page.waitForTimeout(800);
expect('sea-state table from the panel-method RAOs', (await page.locator('#ssTable').innerText()).includes('panel-method RAOs'));
// a long panel-method sweep can be cancelled
await select('#bemFid', 'vfine'); await fill('#raoN', '400');
await click('#raoRun');
await page.waitForFunction(() => !document.querySelector('#raoCancel').classList.contains('hidden'), null, { timeout: 30000 });
await click('#raoCancel');
await page.waitForFunction(() => !document.querySelector('#raoRun').disabled, null, { timeout: 30000 });
expect('panel-method sweep cancelled', (await page.locator('#raoInfo').innerText()).includes('Cancelled'));
// the fast Froude–Krylov option still works
await select('#bemFid', 'standard'); await fill('#raoN', '80');
await select('#raoMethod', 'fk');
expect('panel count hidden for the Froude–Krylov option', !(await page.locator('#bemFid').isVisible()));
await click('#raoRun');
await page.waitForFunction(() => !document.querySelector('#raoRun').disabled && document.querySelector('#raoInfo').innerText.includes('headings'), null, { timeout: 120000 });
expect('Froude–Krylov RAOs on request', (await page.locator('#raoInfo').innerText()).startsWith('Froude–Krylov'));
await select('#raoMethod', 'bem');

// 7b — small-body options on a cylinder buoy (STEP, Ø0.7 × 1 m): tracked points, drag + heave plate, mooring, wind
const BUOY = new URL('./models/buoy_cyl.step', import.meta.url).pathname;
await page.setInputFiles('#file', BUOY);
const loadBox = await page.evaluate(() => ({ title: document.querySelector('#taskTitle').textContent, shown: !document.querySelector('#taskbox').classList.contains('hidden'), scrim: !document.querySelector('#viewScrim').classList.contains('hidden') }));
expect('model loading: progress window and dimmed view while the file loads', loadBox.shown && loadBox.scrim && loadBox.title === 'Loading buoy_cyl.step', JSON.stringify(loadBox));
await page.waitForFunction(() => document.querySelector('#modelInfo').innerText.includes('buoy_cyl'), null, { timeout: 60000 });
await page.waitForFunction(() => document.querySelector('#taskbox').classList.contains('hidden') && document.querySelector('#viewScrim').classList.contains('hidden'), null, { timeout: 10000 });
for (const [id, v] of [['mass', (1000 * Math.PI * 0.35 ** 2 * 0.6).toFixed(3)], ['cgx', '0'], ['cgy', '0'], ['cgz', '0.3']]) { await fill(`#${id}`, v); await page.press(`#${id}`, 'Enter'); }
await page.waitForTimeout(300);
expect('buoy: draft 0.6 m', near(num(await stat('Draft')), 0.6, 1e-3), await stat('Draft'));
await click('#ptPick');
const glBox = await page.locator('#gl').boundingBox();
await page.mouse.click(glBox.x + glBox.width / 2, glBox.y + glBox.height / 2);
await page.waitForTimeout(300);
expect('tracked point picked by clicking the model', (await page.locator('#ptList .ptrow').count()) === 1);
await click('#ptAdd');
const pt2 = page.locator('#ptList .ptrow').nth(1);
await pt2.locator('input[data-k="2"]').fill('1'); await pt2.locator('input[data-k="2"]').dispatchEvent('change');
await pt2.locator('input[data-k="0"]').fill('0.3'); await pt2.locator('input[data-k="0"]').dispatchEvent('change');
await check('#dragOn'); await select('#dragPreset', 'vcyl'); await click('#plAdd'); await page.waitForTimeout(500);
expect('drag info: projected areas and heave-plate added mass', (await page.locator('#dragInfo').innerText()).includes('Heave plates: added mass'));
await check('#moorOn'); await page.waitForTimeout(600);
const moorTxt = await page.locator('#moorInfo').innerText();
expect('mooring info: line state at the mean position and the draft change', moorTxt.includes('At the mean position') && moorTxt.includes('deeper than free'), moorTxt.split('\n')[0]);
expect('fairlead defaults to the keel point', near(num(await page.inputValue('#mfZ')), 0, 1e-6), await page.inputValue('#mfZ'));
await check('#windOn'); await page.waitForTimeout(600);
expect('wind info: steady force and static heel', (await page.locator('#windInfo').innerText()).includes('Steady wind at rest'));
await click('#tabs button[data-tab="tabSea"]');
await click('#waveMode button[data-mode="regular"]');
await fill('#rgH', '0.4'); await page.dispatchEvent('#rgH', 'change');
await fill('#rgT', '3'); await page.dispatchEvent('#rgT', 'change');
await click('#waveRun');
await page.waitForFunction(() => /t = [\d.]+ s/.test(document.querySelector('#waveInfo').innerText), null, { timeout: 120000 });
await page.waitForTimeout(4000);
const sbi = await page.locator('#waveInfo').innerText();
expect('live run: mooring tension, wind and tracked points', sbi.includes('mooring: tension') && sbi.includes('wind:') && /P1: .*above water/.test(sbi), sbi.split('\n').slice(-4).join(' | '));
expect('tracked-point and mooring charts shown', (await page.locator('#ptCharts').isVisible()) && (await page.locator('#moorCharts').isVisible()));
if (shots) await page.screenshot({ path: `${shots}/smallbody-run.png` });
await click('#waveRun');
await click('#waveStats');
await page.waitForFunction(() => document.querySelector('#waveInfo').innerText.startsWith('Statistics complete'), null, { timeout: 900000 });
const psTxt = await page.locator('#ptStats').innerText();
expect('point statistics: time above water, time domain and linear', psTxt.includes('Time above water') && psTxt.includes('Linear (RAO)'));
const mstTxt = await page.locator('#moorStats').innerText();
expect('mooring statistics: tensions, slack events and watch circle', mstTxt.includes('Max / min fairlead tension') && mstTxt.includes('Slack events') && mstTxt.includes('Watch circle'));
expect('wind summary in the statistics', (await page.locator('#seaStats').innerText()).includes('Wind: mean force'));
if (shots) await page.screenshot({ path: `${shots}/smallbody-stats.png` });
await select('#raoMethod', 'fk'); await fill('#raoHead', '0,90'); await page.dispatchEvent('#raoHead', 'change');
await click('#raoRun');
await page.waitForFunction(() => !document.querySelector('#raoRun').disabled && document.querySelector('#raoInfo').innerText.includes('headings'), null, { timeout: 120000 });
const sri = await page.locator('#raoInfo').innerText();
expect('RAO info lists the small-body options', sri.includes('Small-body options') && sri.includes('mooring stiffness') && sri.includes('viscous drag linearised'), sri.split('\n').pop());
expect('wave-following table for both headings', (await page.locator('#followInfo tr').count()) === 3);
if (shots) await page.screenshot({ path: `${shots}/smallbody-rao.png` });
await select('#raoMethod', 'bem'); await fill('#raoHead', '0:45:180'); await page.dispatchEvent('#raoHead', 'change');
await click('#tabs button[data-tab="tabSea"]');
await click('#waveMode button[data-mode="spectrum"]');
await click('#ssSweep'); await page.waitForTimeout(1500);
expect('sea-state table with drag linearised per row', (await page.locator('#ssTable').innerText()).includes('Viscous drag: linearised'));
for (const id of ['dragOn', 'moorOn', 'windOn']) await uncheck(`#${id}`);
await page.waitForTimeout(300);

// 8 — custom moments of inertia (STEP barge: roll period T = 2π√(Ixx / (ρgV·GM_T)), dry, no added mass)
await page.setInputFiles('#file', MODEL);
await page.waitForFunction(() => document.querySelector('#modelInfo').innerText.includes('box_4x2x1'), null, { timeout: 60000 });
for (const [id, v] of [['mass', '3200'], ['cgx', '2'], ['cgy', '0'], ['cgz', '0.5']]) { await fill(`#${id}`, v); await page.press(`#${id}`, 'Enter'); }
await click('#tabs button[data-tab="tabHydro"]');
await select('#inMode', 'custom');
expect('custom inertia prefilled with computed values', num(await page.inputValue('#inXX')) > 0);
await fill('#inXX', '2000'); await page.press('#inXX', 'Enter'); await page.waitForTimeout(300);
const Troll = 2 * Math.PI * Math.sqrt(2000 / (1000 * 9.80665 * 3.2 * (0.2 + 4 / (12 * 0.4) - 0.5)));
expect(`custom Ixx = 2000 kg·m² → roll period ${Troll.toFixed(3)} s`, near(num(await stat('Roll')), Troll, 0.01), await stat('Roll'));
await fill('#inXX', '99999'); await page.press('#inXX', 'Enter'); await page.waitForTimeout(300);
expect('non-physical inertia rejected (triangle inequality)', (await page.locator('#inInfo').innerText()).includes('triangle inequality'));

// 9 — drop / rise test (barge STEP still loaded, custom inertia back to computed)
await select('#inMode', 'auto');
await click('#toolsBtn'); await click('.menu [data-act="drop"]');
expect('Tools › Drop / rise test opens the drop mode', (await page.evaluate(() => document.body.dataset.stage)) === 'drop' && await page.locator('#modebar').isVisible());
await fill('#dzH', '3'); await page.dispatchEvent('#dzH', 'input');   // CoG 3 m above the water
await click('#dzPlace'); await page.waitForTimeout(300);
const lockState = async () => page.evaluate(() => ['waveRun', 'waveStats', 'ssSweep', 'raoRun', 'simRun'].map((id) => document.getElementById(id).disabled));
expect('placing locks waves, statistics, sea-state table, RAOs and calm simulate', (await lockState()).every(Boolean));
expect('lock notes visible', await page.locator('.lock-note:not(.hidden)').count() === 2);
await fill('#dzSpeed', '8'); await page.dispatchEvent('#dzSpeed', 'input');
await click('#dzRun');
await page.waitForFunction(() => /Settled|Sinks|time limit/.test(document.querySelector('#dzInfo').innerText), null, { timeout: 180000 });
const dropRow = async (label) => page.evaluate((l) => { const r = [...document.querySelectorAll('#dzStats tr')].find((t) => t.cells[0].innerText.startsWith(l)); return r ? r.cells[1].innerText : ''; }, label);
const entry = await dropRow('Water entry speed');
const vEntry = num(entry.split(' m/s')[0]), vFree = Math.sqrt(2 * 9.80665 * 2.5);   // keel 0.5 m below the CoG → falls 2.5 m
expect('drop from 3 m: entry speed ≈ √(2gh) (air drag ≤ 2 %)', vEntry < vFree && vEntry > 0.98 * vFree, `${vEntry} m/s vs ${vFree.toFixed(3)} m/s`);
expect('drop: plunges, then settles at the float height (CoG 0.1 m above water: draft 0.4, KG 0.5)', (await page.locator('#dropVerdict').innerText()).includes('Stabilized') && near(parseFloat((await dropRow('Settled')).split(' at ')[1]), 0.1, 0.003), await dropRow('Settled'));
const maxDepth = num(await dropRow('Max submersion depth')), minCoG = num((await dropRow('Deepest CoG')).split(' m')[0]);
// the keel is 0.5 m below the CoG and the barge stays near level, so the keel goes about 0.5 m deeper than the CoG
expect('drop: max submersion depth = lowest point below the still water', maxDepth > 0.4 && near(maxDepth, 0.5 - minCoG, 0.05), `depth ${maxDepth} m, deepest CoG ${minCoG} m`);
expect('drop: max rise rate reported (rebound)', num(await dropRow('Max rise rate')) > 0);
await fill('#dzRoll', '20'); await page.dispatchEvent('#dzRoll', 'change');
expect('drop orientation drives the start attitude', near(num(await page.inputValue('#rollN')), 20, 1e-9));
await fill('#dzH', '-3'); await page.dispatchEvent('#dzH', 'input');
await click('#dzPlace'); await click('#dzRun');
await page.waitForFunction(() => /Settled|Sinks|time limit/.test(document.querySelector('#dzInfo').innerText), null, { timeout: 180000 });
expect('rise from 3 m depth: breaks the surface and stabilizes', (await page.locator('#dropVerdict').innerText()).includes('Stabilized') && (await dropRow('Broke the surface')).length > 0);
expect('rise: max rise rate is the upward speed reached', num(await dropRow('Max rise rate')) > 0.5, await dropRow('Max rise rate'));
expect('drop test uses panel-method added mass and damping', (await page.locator('#dzStats').innerText()).includes('panel method'));
expect('runs table lists both releases', (await page.locator('#dzRuns tr').count()) === 3);
if (shots) await page.screenshot({ path: `${shots}/drop.png` });
await click('#exitDrop'); await page.waitForTimeout(300);
expect('Exit drop test resets the position, unlocks the tools and returns to Float', (await lockState()).every((d) => !d) && (await page.evaluate(() => document.body.dataset.stage)) === 'float');

// 10 — reference coordinate system (the CAD csys): box 4 × 2 × 1 m with its file origin at a bottom corner edge
//       (x 0…4, y −1…1, z 0…1). The ref csys is at the keel centre (2, 0, 0), turned 90° about Z, so ref x = file y.
// (the same file is already loaded, so clear the model info to wait for the reload itself)
await page.evaluate(() => { document.querySelector('#modelInfo').textContent = ''; });
await page.setInputFiles('#file', MODEL);
await page.waitForFunction(() => document.querySelector('#modelInfo').innerText.includes('box_4x2x1'), null, { timeout: 60000 });
expect('reload starts upright (the drop test left a 20° roll)', (await page.inputValue('#rollN')) === '0');
await fill('#mass', '3200'); await page.press('#mass', 'Enter');
expect('ref csys defaults to the file origin and axes', (await page.inputValue('#refMode')) === 'file' && (await page.locator('#refInfo').innerText()).includes("file's own origin"));
expect('unturned box: GM_T 0.533 m (beam 2 m), GM_L 3.033 m', near(num(await stat('GMT')), 0.2 + 4 / 4.8 - 0.5, 2e-3) && near(num(await stat('GML')), 0.2 + 16 / 4.8 - 0.5, 2e-3), `${await stat('GMT')} · ${await stat('GML')}`);
await select('#refMode', 'custom');
for (const [id, v] of [['refOx', '2'], ['refOy', '0'], ['refOz', '0'], ['refRz', '90']]) { await fill(`#${id}`, v); await page.press(`#${id}`, 'Enter'); }
await page.waitForTimeout(300);
const cogNow = async () => Promise.all(['cgx', 'cgy', 'cgz'].map(async (id) => num(await page.inputValue(`#${id}`))));
const cg1 = await cogNow();
expect('the default CoG (centroid) stays on the body: (2, 0, 0.5) in the file → (0, 0, 0.5) in the ref csys', near(cg1[0], 0, 1e-6) && near(cg1[1], 0, 1e-6) && near(cg1[2], 0.5, 1e-6), cg1.join(', '));
expect('ref axes listed in file coordinates: x → (0, 1, 0)', (await page.locator('#refInfo').innerText()).includes('x → (0, 1, 0)'), (await page.locator('#refInfo').innerText()).split('\n')[0]);
expect('model size in the ref axes: 2 × 4 × 1 m', (await page.locator('#modelInfo').innerText()).includes('2 × 4 × 1 m'));
expect('turned 90°: roll is now across the 4 m side (GM_T 3.033 m, GM_L 0.533 m), draft 0.4 m',
  near(num(await stat('GMT')), 0.2 + 16 / 4.8 - 0.5, 2e-3) && near(num(await stat('GML')), 0.2 + 4 / 4.8 - 0.5, 2e-3) && near(num(await stat('Draft')), 0.4, 1e-4), `${await stat('GMT')} · ${await stat('GML')} · ${await stat('Draft')}`);
// inertia taken at the ref origin (CAD "taken at the output coordinate system"): moved to G by −m·0.5² on I_xx
await select('#inMode', 'custom'); await select('#inAt', 'origin'); await page.waitForTimeout(200);
const IxxO = 3200 * (16 + 1) / 12 + 3200 * 0.25;
expect(`prefilled I_xx at the ref origin = m(4² + 1²)/12 + m·0.5² = ${IxxO.toFixed(1)}`, near(num(await page.inputValue('#inXX')), IxxO, 0.5), await page.inputValue('#inXX'));
await fill('#inXX', '6800'); await page.press('#inXX', 'Enter'); await page.waitForTimeout(300);
const TrollRef = 2 * Math.PI * Math.sqrt((6800 - 800) / (1000 * 9.80665 * 3.2 * (0.2 + 16 / 4.8 - 0.5)));
expect(`I_xx 6800 at the ref origin → 6000 about G → roll period ${TrollRef.toFixed(3)} s`, near(num(await stat('Roll')), TrollRef, 0.01) && (await page.locator('#inInfo').innerText()).includes('moved to the CoG'), await stat('Roll'));
await select('#inMode', 'auto');
// RAOs at the ref origin (0.5 m below G): roll and heave as at G, sway gains θ_x × 0.5 m
await select('#raoMethod', 'fk'); await fill('#raoN', '20'); await fill('#raoHead', '90'); await page.dispatchEvent('#raoHead', 'change');
await click('#raoRun');
await page.waitForFunction(() => !document.querySelector('#raoRun').disabled && document.querySelector('#raoInfo').innerText.includes('headings'), null, { timeout: 120000 });
expect('RAO info names the reference point and its offset from G', (await page.locator('#raoInfo').innerText()).includes('Motions at the ref csys origin, (0, 0, -0.5) m from G'), (await page.locator('#raoInfo').innerText()).split('\n').pop());
const readCsv = async (sel) => { const d = page.waitForEvent('download'); await click(sel); const dl = await d; return { name: dl.suggestedFilename(), text: await dl.createReadStream().then((st) => new Promise((res) => { let s = ''; st.on('data', (c) => { s += c; }); st.on('end', () => res(s)); })) }; };
const rows = (t) => t.trim().split('\n').filter((l) => !l.startsWith('#')).slice(1).map((l) => l.split(',').map(Number));
const atRef = await readCsv('#raoCsv'), rawRef = await readCsv('#raoRaw');
await select('#raoRef', 'G'); await page.waitForTimeout(500);
const atG = await readCsv('#raoCsv');
const rR = rows(atRef.text), rG = rows(atG.text), maxDiff = (c) => Math.max(...rR.map((r, i) => Math.abs(r[c] - rG[i][c])));
expect('CSV file names say the reference point', atRef.name === 'rao_at_ref_origin.csv' && atG.name === 'rao_at_G.csv', `${atRef.name}, ${atG.name}`);
expect('ref origin vs G: same roll and heave, different sway', rR.length === 20 && maxDiff(8) < 1e-9 && maxDiff(7) < 1e-9 && maxDiff(6) > 1e-3, `roll Δ ${maxDiff(8)}, heave Δ ${maxDiff(7)}, sway Δ ${maxDiff(6)}`);
expect('raw CSV header gives the reference point and the axes', rawRef.text.includes('# motions xi: of the ref csys origin O, at 0 0 -0.5 m from G') && rawRef.text.includes('reference csys: custom'));
await select('#raoRef', 'ref');
// typed CoG numbers stay as typed when the csys moves: the origin 0.2 m higher puts G 0.2 m higher on the body
await fill('#cgz', '0.6'); await page.press('#cgz', 'Enter'); await page.waitForTimeout(200);
const gmTyped = num(await stat('GMT'));
await fill('#refOz', '0.2'); await page.press('#refOz', 'Enter'); await page.waitForTimeout(300);
expect('typed CoG z 0.6 stays as typed in the moved csys, so G rises 0.2 m: GM_T 2.933 → 2.733 m', near(num(await page.inputValue('#cgz')), 0.6, 1e-9) && near(gmTyped, 0.2 + 16 / 4.8 - 0.6, 2e-3) && near(num(await stat('GMT')), 0.2 + 16 / 4.8 - 0.8, 2e-3), `${gmTyped} m → ${await stat('GMT')}`);
// switching to axis directions fills them with the same axes (the model does not turn)
await select('#refAxes', 'dirs'); await page.waitForTimeout(300);
const dirs = await Promise.all(['refXx', 'refXy', 'refXz', 'refZx', 'refZy', 'refZz'].map(async (id) => num(await page.inputValue(`#${id}`))));
expect('angles → directions keeps the frame: x (0, 1, 0), z (0, 0, 1), still 2 × 4 × 1 m', dirs.join() === '0,1,0,0,0,1' && (await page.locator('#modelInfo').innerText()).includes('2 × 4 × 1 m'), dirs.join(', '));
// axis directions: ref z = file Y (a Y-up export) makes the 2 m side the height
for (const [id, v] of [['refOz', '0'], ['refXx', '1'], ['refXy', '0'], ['refXz', '0'], ['refZx', '0'], ['refZy', '1'], ['refZz', '0']]) { await fill(`#${id}`, v); await page.press(`#${id}`, 'Enter'); }
await page.waitForTimeout(300);
expect('axis directions: ref z = file Y gives a 4 × 1 × 2 m body', (await page.locator('#modelInfo').innerText()).includes('4 × 1 × 2 m'));
await page.selectOption('#demo', 'box'); await page.waitForTimeout(500);
expect('a different model starts in its file csys again', (await page.inputValue('#refMode')) === 'file' && (await page.locator('#refCustom').isHidden()));
if (shots) await page.screenshot({ path: `${shots}/ref-csys.png` });

// 11 — Solve with Capytaine (tools/serve.py): off, with the reason, where the server has no Capytaine; otherwise the
//      same panel mesh solved by Capytaine gives the same RAOs as Float Sim's own solver.
const capyStatus = await page.evaluate(() => fetch('api/capytaine/status', { headers: { 'X-Float-Sim': '1' } })
  .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : { available: false })).catch(() => ({ available: false })));
await reveal('#raoCapy');
if (!capyStatus.available) {
  expect('Solve with Capytaine is off without Capytaine on this server, and says why', (await page.isDisabled('#raoCapy')) && (await page.locator('#capyStatus').innerText()).includes('is off'), await page.locator('#capyStatus').innerText());
} else {
  expect(`Capytaine ${capyStatus.version} found: the button is on and the Solver section says so`, !(await page.isDisabled('#raoCapy')) && (await page.locator('#capyStatus').innerText()).includes(`Capytaine ${capyStatus.version} found`));
  await select('#raoMethod', 'bem'); await select('#bemFid', 'coarse');
  for (const [id, v] of [['raoFmin', '0.1'], ['raoFmax', '0.6'], ['raoN', '12'], ['raoHead', '0:90:180']]) { await fill(`#${id}`, v); await page.dispatchEvent(`#${id}`, 'change'); }
  await select('#raoRef', 'G');
  await click('#raoRun');
  await page.waitForFunction(() => !document.querySelector('#raoRun').disabled && document.querySelector('#raoInfo').innerText.startsWith('Panel method'), null, { timeout: 180000 });
  const own = await readCsv('#raoCsv');
  await click('#raoCapy');
  expect('both solve buttons are off while Capytaine runs', (await page.isDisabled('#raoCapy')) && (await page.isDisabled('#raoRun')));
  await page.waitForFunction(() => !document.querySelector('#raoRun').disabled && document.querySelector('#raoInfo').innerText.startsWith('Capytaine'), null, { timeout: 300000 });
  expect('RAO info names Capytaine and the shared panel mesh', (await page.locator('#raoInfo').innerText()).includes("Float Sim's panel mesh"), (await page.locator('#raoInfo').innerText()).split('\n')[0]);
  const cap = await readCsv('#raoCsv'), capRaw = await readCsv('#raoRaw');
  const ro = rows(own.text), rc = rows(cap.text);
  const rel = [5, 6, 7, 8, 9].map((c) => Math.max(...ro.map((r, i) => Math.abs(r[c] - rc[i][c]))) / Math.max(1e-12, ...rc.map((r) => Math.abs(r[c]))));
  expect('same RAOs from both solvers on the same mesh: surge, sway, heave, roll, pitch within 3 % of their peaks', ro.length === 36 && rc.length === 36 && rel.every((e) => e < 0.03), rel.map((e) => `${(100 * e).toFixed(2)} %`).join(', '));
  expect('raw CSV header says Capytaine solved it', capRaw.text.includes(`# hydrodynamics: Capytaine ${capyStatus.version} (direct formulation, deep water) on Float Sim's panel mesh`));
}

expect('no console errors', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
// exit once stdout has been written out: process.exit() does not wait for pending writes to a pipe (review R1-24)
process.stdout.write('', () => process.exit(fails ? 1 : 0));
