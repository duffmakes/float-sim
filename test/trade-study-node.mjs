// Runs the RAO trade study and writes docs/rao-trade-study.md:  node test/trade-study-node.mjs [quality]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
globalThis.occtimportjs = createRequire(import.meta.url)('../vendor/occt-import-js.js');
const { readCad, concat } = await import('../js/loader.js');
const { hemisphereStudy, sparStudy, toMarkdown } = await import('./trade-study.js');

const quality = process.argv[2] || 'fine';
const exp = JSON.parse(await readFile(path.join(here, 'models/expected.json'), 'utf8'));
const load = async (f) => concat(await readCad(new Uint8Array(await readFile(path.join(here, 'models', f))), 'step', quality, path.join(here, '..', 'vendor') + '/')).map((v) => v * 0.001);
const t0 = performance.now();
const h = hemisphereStudy(await load(exp.wave.lit_hemisphere.file), exp.wave.lit_hemisphere);
const s = sparStudy(await load(exp.wave.lit_spar.file), exp.wave.lit_spar);
const md = toMarkdown(h, s, { date: new Date().toISOString().slice(0, 10), quality });
await mkdir(path.join(here, '..', 'docs'), { recursive: true });
await writeFile(path.join(here, '..', 'docs', 'rao-trade-study.md'), md + '\n');
console.log(md);
console.log(`\n(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
