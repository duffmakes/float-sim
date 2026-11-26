// Runs the validation core under Node:  node test/validate-node.mjs [coarse|normal|fine]
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
globalThis.occtimportjs = createRequire(import.meta.url)('../vendor/occt-import-js.js');
const { runValidation } = await import('./validate-core.js');

const quality = process.argv[2] || 'fine';
const fmt = (x) => typeof x === 'number' ? x.toFixed(6) : String(x);
const r = await runValidation({
  quality, vendorDir: path.join(here, '..', 'vendor') + '/',
  fetchJSON: async (p) => JSON.parse(await readFile(path.join(here, p), 'utf8')),
  fetchBytes: async (p) => new Uint8Array(await readFile(path.join(here, p))),
  onCase: (c, rows, meta) => {
    console.log(`\n${rows.every((x) => x.ok) ? '✓' : '✗'} ${c.id} — ${c.title}\n  ${meta}`);
    for (const x of rows) console.log(`  ${x.ok ? 'PASS' : 'FAIL'}  ${x.label.padEnd(20)} ${fmt(x.got).padStart(14)}  expected ${fmt(x.want).padStart(12)}${x.rel != null ? `  err ${(x.rel * 100).toFixed(4)}%` : ''}`);
  },
});
console.log(`\n${r.pass}/${r.total} checks passed (${r.cases} cases, mesh quality ${quality}, ${r.seconds.toFixed(1)} s)`);
// exit once stdout has been written out: process.exit() does not wait for pending writes to a pipe (review R1-24)
process.stdout.write('', () => process.exit(r.pass === r.total ? 0 : 1));
