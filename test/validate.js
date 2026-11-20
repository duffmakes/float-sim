// Browser page for the validation suite.
import { runValidation } from './validate-core.js';

const $ = (id) => document.getElementById(id);
let last = null;

async function run() {
  const quality = $('q').value;
  $('cases').innerHTML = ''; $('summary').className = ''; $('summary').textContent = 'Running…';
  const r = await runValidation({
    quality, vendorDir: '../vendor/',
    fetchJSON: async (p) => (await fetch(p, { cache: 'no-store' })).json(),
    fetchBytes: async (p) => new Uint8Array(await (await fetch(p, { cache: 'no-store' })).arrayBuffer()),
    onCase: renderCase,
  });
  last = r;
  const ok = r.pass === r.total;
  $('summary').className = ok ? 'pass' : 'fail';
  $('summary').innerHTML = `<b>${r.pass} / ${r.total}</b> checks passed across ${r.cases} cases (mesh quality: ${quality}, ${r.seconds.toFixed(1)} s).
    Tolerances: planar bodies 0.001 %, curved bodies ${(r.curvedTol * 100).toFixed(1)} % (faceting under-reads curved volume).`;
  window.__floatSimValidation = r;
}

const f = (x) => typeof x === 'number' ? (Math.abs(x) >= 1e4 || (x !== 0 && Math.abs(x) < 1e-4) ? x.toExponential(4) : x.toFixed(6)) : String(x);
function renderCase(c, rows, meta) {
  const d = document.createElement('div'); d.className = 'case';
  const allOk = rows.every((r) => r.ok);
  d.innerHTML = `<h2><span class="${allOk ? 'p' : 'f'}">${allOk ? '✓' : '✗'}</span> ${c.id} — ${c.title}</h2>
    <div class="ref">${c.ref}</div><div class="meta">${meta}</div>
    <div class="scroll"><table><tr><th>Quantity</th><th>Float Sim</th><th>Closed form</th><th>Error</th><th></th></tr>
    ${rows.map((r) => `<tr><td>${r.label}</td><td>${f(r.got)}</td><td>${f(r.want)}</td>
      <td>${r.rel !== null && r.rel !== undefined ? (r.rel * 100).toFixed(4) + ' %' : r.err !== null && r.err !== undefined ? f(r.err) : ''}</td>
      <td class="${r.ok ? 'p' : 'f'}">${r.ok ? 'PASS' : 'FAIL'}</td></tr>`).join('')}
    </table></div>`;
  $('cases').appendChild(d);
}

$('run').onclick = run;
$('q').onchange = run;
$('copy').onclick = () => navigator.clipboard.writeText(JSON.stringify(last, null, 1));
run();
