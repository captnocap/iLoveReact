// cart/editor/data/assetCatalog.primitives.test.ts — curve-kit primitive kinds (req_4322).
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/assetCatalog.primitives.test.ts --bundle \
//     --outfile=/tmp/editor-primitives.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit/geometries=$ROOT/runtime/geometries \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-primitives.test.js

import { PRIMITIVE_FIELDS, defaultPrimitiveParamsU, primitiveParamsFromU, primitivePartMesh, U_PER_TILE } from './assetCatalog';
import { PRIMITIVE_MESHES } from './commands';
import { BAKED_ICON_NAMES } from '../../../runtime/icons/baked-names';
import type { EditMesh } from '../model/editMesh';
import type { PrimitiveKind } from './types';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function expect(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

const CURVE_KINDS: PrimitiveKind[] = ['vessel', 'arch', 'spring', 'egg', 'tray'];
const ALL_KINDS = Object.keys(PRIMITIVE_FIELDS) as PrimitiveKind[];

function meshSignedVolume(m: EditMesh): number {
  let vol = 0;
  for (const f of m.faces) {
    const a = m.verts[f.loop[0]];
    for (let i = 1; i + 1 < f.loop.length; i += 1) {
      const b = m.verts[f.loop[i]], c = m.verts[f.loop[i + 1]];
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
  }
  return vol;
}

test('every kind in PRIMITIVE_FIELDS has a menu row, and every menu icon is baked', () => {
  for (const kind of ALL_KINDS) {
    const row = PRIMITIVE_MESHES.find((m) => m.kind === kind);
    expect(!!row, `${kind} appears in the File → New Mesh registry`);
    expect(BAKED_ICON_NAMES.has(row!.icon), `${kind} icon '${row!.icon}' exists in the SDF atlas`);
  }
  expect(PRIMITIVE_MESHES.length === ALL_KINDS.length, 'no menu row without a fields entry');
});

test('dialog defaults seed every exposed field for the curve kinds', () => {
  for (const kind of CURVE_KINDS) {
    const p = defaultPrimitiveParamsU(kind) as Record<string, number>;
    for (const f of PRIMITIVE_FIELDS[kind]) {
      expect(Number.isFinite(p[f.key]), `${kind}.${String(f.key)} has a numeric default`);
      expect(p[f.key] === f.default, `${kind}.${String(f.key)} seeds from its field default`);
    }
  }
});

test('u → meters conversion covers the new dimension keys and spares the counts', () => {
  const meters = primitiveParamsFromU({
    size: 16, height: 32, resolution: 24,
    belly: 24, foot: 8, depth: 8, wire: 4, shift: 3, turns: 5, roundness: 4,
  });
  expect(meters.size === 1 && meters.height === 2, 'legacy keys still divide by 16');
  expect(meters.belly === 24 / U_PER_TILE && meters.foot === 0.5 && meters.depth === 0.5, 'new u dimensions convert');
  expect(meters.wire === 0.25 && meters.shift === 3 / U_PER_TILE, 'wire and shift convert');
  expect(meters.turns === 5 && meters.roundness === 4, 'counts pass through untouched');
});

test('every curve kind mints a finite, non-empty, ground-resting mesh at its defaults', () => {
  for (const kind of CURVE_KINDS) {
    const mesh = primitivePartMesh(kind, primitiveParamsFromU(defaultPrimitiveParamsU(kind)));
    expect(mesh.verts.length > 0 && mesh.faces.length > 0, `${kind} is non-empty`);
    let minY = Infinity;
    for (const v of mesh.verts) {
      expect(Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]), `${kind} verts finite`);
      minY = Math.min(minY, v[1]);
    }
    expect(Math.abs(minY) < 1e-9, `${kind} rests on the ground plane (minY ${minY})`);
    for (const f of mesh.faces) {
      expect(f.loop.length >= 3, `${kind} has no degenerate loops`);
      for (const i of f.loop) expect(i >= 0 && i < mesh.verts.length, `${kind} loop indices in range`);
    }
  }
});

test('every curve kind is a closed solid wound outward (positive volume)', () => {
  for (const kind of CURVE_KINDS) {
    const mesh = primitivePartMesh(kind, primitiveParamsFromU(defaultPrimitiveParamsU(kind)));
    const vol = meshSignedVolume(mesh);
    expect(vol > 1e-6, `${kind} volume ${vol.toFixed(6)} is positive`);
  }
});

test('vessel belly actually swells past mouth and foot at the defaults', () => {
  const mesh = primitivePartMesh('vessel', primitiveParamsFromU(defaultPrimitiveParamsU('vessel')));
  let maxR = 0, maxY = 0;
  for (const v of mesh.verts) { maxR = Math.max(maxR, Math.hypot(v[0], v[2])); maxY = Math.max(maxY, v[1]); }
  const belly = (24 / U_PER_TILE) / 2, mouth = (18 / U_PER_TILE) / 2;
  expect(maxR > mouth * 1.05, `widest ring ${maxR.toFixed(3)} swells past the mouth ${mouth}`);
  expect(maxR < belly * 1.35, 'the spline stays near the belly station');
  expect(Math.abs(maxY - 1) < 0.05, 'default vessel stands one tile tall');
});

test('arch rise picks the strike: low rise stays under span/2 height, high rise peaks', () => {
  const base = defaultPrimitiveParamsU('arch');
  const low = primitivePartMesh('arch', primitiveParamsFromU({ ...base, height: 8 }));   // rise 8 < span 32 / 2
  const high = primitivePartMesh('arch', primitiveParamsFromU({ ...base, height: 28 })); // rise 28 > 16
  const topOf = (m: EditMesh) => Math.max(...m.verts.map((v) => v[1]));
  expect(Math.abs(topOf(low) - 0.5) < 0.03, `segmental strike tops at its rise (got ${topOf(low).toFixed(3)})`);
  expect(Math.abs(topOf(high) - 1.75) < 0.03, `gothic strike tops at its rise (got ${topOf(high).toFixed(3)})`);
});

test('spring turns multiply the coil: more turns, more mesh, same footprint', () => {
  const base = defaultPrimitiveParamsU('spring');
  const two = primitivePartMesh('spring', primitiveParamsFromU({ ...base, turns: 2 }));
  const six = primitivePartMesh('spring', primitiveParamsFromU({ ...base, turns: 6 }));
  expect(six.verts.length > two.verts.length * 2, 'turn count scales the ring stack');
  const spanOf = (m: EditMesh) => Math.max(...m.verts.map((v) => Math.hypot(v[0], v[2])));
  expect(Math.abs(spanOf(two) - spanOf(six)) < 0.05, 'coil diameter independent of turns');
});

test('egg tip shift moves the widest ring off center', () => {
  const base = defaultPrimitiveParamsU('egg');
  const shifted = primitivePartMesh('egg', primitiveParamsFromU({ ...base, shift: 6 }));
  let widestY = 0, maxR = 0, topY = 0;
  for (const v of shifted.verts) {
    const rr = Math.hypot(v[0], v[2]);
    if (rr > maxR) { maxR = rr; widestY = v[1]; }
    topY = Math.max(topY, v[1]);
  }
  expect(widestY < topY * 0.5, `widest ring (y ${widestY.toFixed(3)}) sits in the lower half — fat end down`);
});

test('tray roundness morphs the outline: exponent 8 fills more plan area than 2', () => {
  const base = defaultPrimitiveParamsU('tray');
  const area = (m: EditMesh) => {
    // plan-area proxy: the front n-gon's shoelace area (first face is the outline)
    const loop = m.faces.find((f) => f.loop.length > 4)!.loop;
    let a = 0;
    for (let i = 0; i < loop.length; i += 1) {
      const p = m.verts[loop[i]], q = m.verts[loop[(i + 1) % loop.length]];
      a += p[0] * q[2] - q[0] * p[2];
    }
    return Math.abs(a / 2);
  };
  const round2 = primitivePartMesh('tray', primitiveParamsFromU({ ...base, roundness: 2 }));
  const round8 = primitivePartMesh('tray', primitiveParamsFromU({ ...base, roundness: 8 }));
  expect(area(round8) > area(round2) * 1.1, 'higher exponent squares the corners out');
});

log('');
log(`primitives: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
