// CAD → triangle-soup loading, shared by the app and the validation harness.
import { massProperties } from './physics.js';

// Chord tolerance (fraction of bounding-box size) and angular tolerance (rad) for OpenCascade meshing.
// An inscribed polygon under-reads volume by about (1 − sin(2π/n)/(2π/n)), so curved bodies need fine angles:
// 0.5 rad ≈ 13 facets/circle (−3.8 % area), 0.15 rad ≈ 42 (−0.4 %), 0.05 rad ≈ 126 (−0.04 %).
export const QUALITY = {
  coarse: { linearDeflection: 0.002, angularDeflection: 0.5 },
  normal: { linearDeflection: 0.0005, angularDeflection: 0.15 },
  fine: { linearDeflection: 0.0001, angularDeflection: 0.05 },
};

export function soupFromIndexed(pos, idx) {
  const n = idx ? idx.length : pos.length / 3;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = idx ? idx[i] : i;
    out[i * 3] = pos[v * 3]; out[i * 3 + 1] = pos[v * 3 + 1]; out[i * 3 + 2] = pos[v * 3 + 2];
  }
  // fix inverted parts so every solid has positive volume
  if (massProperties(out).volume < 0) {
    for (let i = 0; i < out.length; i += 9) for (let k = 0; k < 3; k++) {
      const t = out[i + 3 + k]; out[i + 3 + k] = out[i + 6 + k]; out[i + 6 + k] = t;
    }
  }
  return out;
}

export function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float64Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const occtCache = new Map();
function getOcct(vendorDir) {
  if (!occtCache.has(vendorDir)) {
    // occtimportjs is the global from vendor/occt-import-js.js (classic script tag)
    occtCache.set(vendorDir, globalThis.occtimportjs({ locateFile: (f) => `${vendorDir}${f}` }));
  }
  return occtCache.get(vendorDir);
}

// Read STEP / IGES / BREP bytes → list of triangle soups in millimetres (one per solid/mesh).
export async function readCad(bytes, ext, quality = 'normal', vendorDir = 'vendor/') {
  const occt = await getOcct(vendorDir);
  const q = QUALITY[quality] || QUALITY.normal;
  const params = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', ...q };
  const res = ext === 'iges' || ext === 'igs' ? occt.ReadIgesFile(bytes, params)
    : ext === 'brep' ? occt.ReadBrepFile(bytes, params) : occt.ReadStepFile(bytes, params);
  if (!res.success || !res.meshes.length) throw new Error('The CAD file could not be read (no solid geometry found).');
  return res.meshes.map((m) => soupFromIndexed(m.attributes.position.array, m.index ? m.index.array : null));
}
