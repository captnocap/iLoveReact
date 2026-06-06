// compose.test.ts — P4 behavior tests for the decal editor's non-visual
// contracts (DECALEDIT-0606): the DecalDoc boundary validator (a corrupt
// record degrades to null, never a half-doc), the doc-rides-the-record
// re-edit law's data shape, and the materials stream's additive decal
// records (the V20 chain carries the doc; shader records unchanged).
//
// Deliberately store-free and React-free (the cutout.test idiom): the live
// 'hmsc' localstore is the USER'S material list — a verify run must never
// write it — and a verify-bundled suite must not pull the React halves
// (decalRender/registry). The pure validator + the pure stream apply ARE
// the contracts everything else trusts.

import {
  DECAL_DOC_VERSION, DECAL_SIZE_PRESETS, emptyDecalDoc, validateDecalDoc,
  type DecalDoc,
} from '../../game/textures/decal';
import { materialsStream, type MaterialsStreamState } from '../materials/stream';
import { assert, assertEqual, finish, test } from '../../game/_testkit';

function sampleDoc(): DecalDoc {
  return {
    version: DECAL_DOC_VERSION,
    width: 512,
    height: 256,
    bg: '#0b1320',
    nodes: [
      { id: 'r1', kind: 'rect', x: 32, y: 32, w: 448, h: 192, bg: '#2563eb', borderRadius: 12, borderWidth: 4, borderColor: '#f8fafc', opacity: 0.9 },
      { id: 't1', kind: 'text', x: 64, y: 96, w: 384, h: 64, text: 'EAT AT JOES', color: '#f8fafc', fontSize: 48, fontWeight: 800, fontFamily: 'monospace', letterSpacing: 2, align: 'center' },
      { id: 'i1', kind: 'image', x: 400, y: 40, w: 64, h: 64, src: 'cart/hmsc-int/assets/logo.png' },
    ],
  };
}

/** key-order-insensitive stringify with JSON semantics (undefined-valued keys
 *  drop, exactly as persistence drops them) — the validator rebuilds objects,
 *  so key order and explicit-undefined optionals may differ; the STORED VALUES
 *  are the round-trip contract */
function canonical(v: any): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

test('a valid doc round-trips the validator exactly (the re-edit law\'s data half)', () => {
  const doc = sampleDoc();
  const out = validateDecalDoc(JSON.parse(JSON.stringify(doc)));
  assert(out !== null, 'a valid doc must validate');
  assertEqual(canonical(out), canonical(doc), 'validation must not lose or alter any field the doc carries');
});

test('the font surface survives validation — graffiti faces need no schema change', () => {
  const doc = sampleDoc();
  const out = validateDecalDoc(doc)!;
  const text = out.nodes.find((n) => n.kind === 'text');
  assert(text !== undefined && text.kind === 'text', 'the text node survives');
  assertEqual(text.fontFamily, 'monospace', 'fontFamily rides the doc verbatim (host maps the name)');
  assertEqual(text.fontWeight, 800, 'fontWeight rides the doc');
  assertEqual(text.letterSpacing, 2, 'letterSpacing rides the doc');
});

test('garbage degrades to null — never a half-doc', () => {
  assertEqual(validateDecalDoc(null), null, 'null is not a doc');
  assertEqual(validateDecalDoc('decal'), null, 'a string is not a doc');
  assertEqual(validateDecalDoc({ ...sampleDoc(), version: 99 }), null, 'a future version is rejected, not half-read');
  assertEqual(validateDecalDoc({ ...sampleDoc(), nodes: 'nope' }), null, 'non-array nodes reject');
  assertEqual(validateDecalDoc({ ...sampleDoc(), width: Infinity }), null, 'non-finite dimensions reject');
  const oneBad = sampleDoc();
  (oneBad.nodes as any[]).push({ kind: 'text', x: 0, y: 0, w: 10, h: 10 }); // no id/text/color/fontSize
  assertEqual(validateDecalDoc(oneBad), null, 'ONE corrupt node rejects the whole doc — a capture never renders a partial decal');
});

test('values clamp at the boundary, not downstream', () => {
  const doc = sampleDoc();
  (doc.nodes[0] as any).opacity = 7;
  (doc.nodes[1] as any).fontSize = 99999;
  const out = validateDecalDoc(doc)!;
  assert((out.nodes[0] as any).opacity <= 1, 'opacity clamps to [0,1]');
  assert((out.nodes[1] as any).fontSize <= 1024, 'fontSize clamps to the sane ceiling');
});

test('emptyDecalDoc and every size preset validate', () => {
  assert(validateDecalDoc(emptyDecalDoc()) !== null, 'the empty doc is a valid doc');
  for (const p of DECAL_SIZE_PRESETS) {
    assert(validateDecalDoc(emptyDecalDoc(p.width, p.height)) !== null, `preset ${p.label} yields a valid doc`);
  }
});

test('the materials stream carries decal records beside shader records (additive V20)', () => {
  let state: MaterialsStreamState = materialsStream.initial();
  state = materialsStream.apply(state, { kind: 'materialized', material: { id: 'custom:road-x', label: 'road x', shaderId: 'road', data: [1, 2, 3] } });
  state = materialsStream.apply(state, { kind: 'materialized', material: { id: 'custom:joes', label: 'joes', decal: sampleDoc() } });
  assertEqual(state.order.length, 2, 'both kinds land in authoring order');
  assert(state.materials['custom:road-x'].shaderId === 'road', 'the shader record is untouched by the decal addition');
  const decal = state.materials['custom:joes'].decal;
  assert(decal !== undefined && validateDecalDoc(decal) !== null, 'the chain carries the full re-editable doc');
  // upsert by id — a re-Materialize updates in place, order stays
  const updated = { ...sampleDoc(), bg: '#111827' };
  state = materialsStream.apply(state, { kind: 'materialized', material: { id: 'custom:joes', label: 'joes', decal: updated } });
  assertEqual(state.order.length, 2, 're-materializing the same id does not duplicate');
  assertEqual(state.materials['custom:joes'].decal?.bg, '#111827', 'the update lands');
  state = materialsStream.apply(state, { kind: 'removed', id: 'custom:joes' });
  assert(!('custom:joes' in state.materials), 'removal drops the record');
  state = materialsStream.apply(state, { kind: 'someFutureThing' } as any);
  assertEqual(state.order.length, 1, 'unknown kinds pass through (the addition rule)');
});

finish('compose-decals');
