// source.test.ts -- P4 behavior tests for the MATERIAL WorkbenchSource core
// (WBSTEP7-0606). These pin the consumption layer: roster -> panel setters ->
// hero actions -> stored materials/decal reopen.

import { assert, assertEqual, finish, test } from '../../../game/_testkit';
import { DECAL_DOC_VERSION, emptyDecalDoc } from '../../../game/textures/decal';
import type { ShaderSpec } from '../../../game/textures/shaders';
import type { FieldSpec, PanelSpec } from '../../../shell/fields';
import { materialFamily, materialLabel, materialPickOptions } from './chooser';
import { createMaterialStore, type MaterialTwigAdapter, type StoredMaterialSummary } from './store';

const SPEC: ShaderSpec = {
  id: 'brick',
  label: 'Brick',
  group: 'Test',
  blurb: 'test recipe',
  shader: 'wgsl',
  base: [{ key: 'seed', label: 'Seed', default: 4, min: 0, max: 10, step: 1, integer: true }],
  variants: [
    { id: 'clean', label: 'Clean', value: 1, params: [{ key: 'wear', label: 'Wear', default: 0.25, min: 0, max: 1, step: 0.25 }] },
    { id: 'dirty', label: 'Dirty', value: 2, params: [] },
  ],
  buildData: (variant, base, overlay) => [variant, base.seed ?? 4, overlay.wear ?? 0],
};

function memoryTwig(): { twig: MaterialTwigAdapter; raw: Record<string, unknown> } {
  const raw: Record<string, unknown> = {};
  return {
    raw,
    twig: {
      read(route, key, initial) {
        const k = `${route}:${key}`;
        return raw[k] === undefined ? initial : raw[k] as any;
      },
      write(route, key, value) {
        raw[`${route}:${key}`] = value;
      },
    },
  };
}

function field(spec: PanelSpec, groupTitle: string, k: string): FieldSpec {
  const f = spec.groups.find((g) => g.title === groupTitle)?.fields.find((x) => x.k === k);
  assert(!!f, `${groupTitle}.${k} exists`);
  return f!;
}

function rig() {
  const stored: StoredMaterialSummary[] = [
    { id: 'custom:old', label: 'Old Shader', shaderId: 'brick', data: [1, 2, 3] },
    { id: 'custom:sign', label: 'Sign', decal: { ...emptyDecalDoc(64, 32), bg: '#111827' } },
  ];
  const events: any[] = [];
  const twigs = memoryTwig();
  const store = createMaterialStore({
    recipes: () => [SPEC],
    reactTextures: () => [{ id: 'facade', label: 'Facade', kind: 'react' }],
    stored: () => stored,
    saveShader: (label, shaderId, data) => {
      const rec = { id: `custom:${label}`, label, shaderId, data: [...data] };
      stored.push(rec);
      return rec;
    },
    saveDecal: (label, doc, existingId) => {
      const rec = { id: existingId ?? `custom:${label}`, label, decal: JSON.parse(JSON.stringify(doc)) };
      const i = stored.findIndex((m) => m.id === rec.id);
      if (i >= 0) stored[i] = rec; else stored.push(rec);
      return rec;
    },
    remove: (id) => {
      const i = stored.findIndex((m) => m.id === id);
      if (i >= 0) stored.splice(i, 1);
    },
    session: { commit: (event, label) => events.push({ event, label }) },
    twig: twigs.twig,
  });
  return { store, stored, events, twigs: twigs.raw };
}

test('roster covers shader recipes, React textures, stored materials, and editable decals', () => {
  const { store } = rig();
  const rows = store.listRows().map((r) => r.id);
  assert(rows.includes('recipe:brick'), 'shader recipe row exists');
  assert(rows.includes('react:facade'), 'React texture row exists');
  assert(rows.includes('stored:custom:old'), 'stored shader material row exists');
  assert(rows.includes('stored:custom:sign'), 'stored decal material row exists');
  assert(rows.includes('decal:new'), 'new decal row exists');
  assert(rows.includes('decal:custom:sign'), 'saved decal compose row exists');
});

test('picking a shader recipe owns the shader lens and writes the legacy /textures selection twig', () => {
  const { store, twigs } = rig();
  store.pick('recipe:brick');
  assertEqual(store.lens, 'shader', 'recipe pick switches to shader lab');
  assertEqual((twigs['/textures:selection'] as any).kind, 'shader', 'legacy selection kind is shader');
  assertEqual((twigs['/textures:selection'] as any).id, 'brick', 'legacy selection id is the recipe');
});

test('shader Materialize freezes the current panel values into stored material data', () => {
  const { store, stored, events, twigs } = rig();
  store.pick('recipe:brick');
  const spec = store.panel(store.select('recipe:brick'));
  const save = field(spec, 'SHADER RECIPE', 'save as') as Extract<FieldSpec, { t: 'text' }>;
  save.set('wall-a');
  const seed = field(spec, 'BASE PARAMETERS', 'Seed') as Extract<FieldSpec, { t: 'slider' }>;
  seed.set(8);
  const wear = field(spec, 'CLEAN PARAMETERS', 'Wear') as Extract<FieldSpec, { t: 'slider' }>;
  wear.set(0.75);
  store.actions(store.select('recipe:brick')).find((a) => a.id === 'materialize')!.run();
  const saved = stored.find((m) => m.id === 'custom:wall-a');
  assert(!!saved, 'stored material was created');
  assertEqual(JSON.stringify(saved!.data), JSON.stringify([1, 8, 0.75]), 'panel values froze into shader data');
  assertEqual(events[0].event.kind, 'materialized', 'materials stream got materialized event');
  assertEqual(store.bank.length, 1, 'shader lab bank mirrors the Materialize action');
  assertEqual(twigs['/textures:saveAs'], '', 'save-as twig clears after materialize');
});

test('compose mode adds layers, moves the selected node, materializes, and reopens a saved decal', () => {
  const { store, stored, events, twigs } = rig();
  store.pick('decal:new');
  let panel = store.panel(store.select('decal:new'));
  (field(panel, 'COMPOSE', 'name') as Extract<FieldSpec, { t: 'text' }>).set('poster-a');
  (field(panel, 'COMPOSE', '+ rect') as Extract<FieldSpec, { t: 'act' }>).run();
  assertEqual(store.composeDoc.nodes.length, 1, 'rect node added through panel action');
  const nodeId = store.composeDoc.nodes[0].id;
  store.selectComposeNode(nodeId);
  store.moveComposeNode(nodeId, 5, 7);
  assertEqual(store.composeDoc.nodes[0].x, emptyDecalDoc().width / 4 + 5, 'stage drag writes node x');
  assertEqual(store.composeDoc.nodes[0].y, emptyDecalDoc().height / 4 + 7, 'stage drag writes node y');
  store.actions(store.select('decal:new')).find((a) => a.id === 'materialize-decal')!.run();
  const saved = stored.find((m) => m.id === 'custom:poster-a');
  assert(!!saved?.decal, 'stored decal was created');
  assertEqual(saved!.decal!.version, DECAL_DOC_VERSION, 'decal doc rides the stored material');
  assertEqual(events[0].event.kind, 'materialized', 'materials stream got decal materialized event');
  assertEqual((twigs['/compose:doc'] as any).nodes.length, 1, 'compose draft twig carries the doc');

  store.pick('decal:custom:poster-a');
  assertEqual(store.composeEditingId, 'custom:poster-a', 'saved decal row reopens for update');
  assertEqual(store.composeDoc.nodes.length, 1, 'reopened decal keeps its layers');

  panel = store.panel(store.select('decal:custom:poster-a'));
  (field(panel, 'LAYERS · 1', 'selected') as Extract<FieldSpec, { t: 'enum' }>).set(store.composeDoc.nodes[0].id);
  panel = store.panel(store.select('decal:custom:poster-a'));
  (field(panel, 'LAYERS · 1', 'remove') as Extract<FieldSpec, { t: 'act' }>).run();
  assertEqual(store.composeDoc.nodes.length, 0, 'layer removal is panel-owned');
});

test('stored material remove deletes only that record and records a removal event', () => {
  const { store, stored, events } = rig();
  store.pick('stored:custom:old');
  store.actions(store.select('stored:custom:old')).find((a) => a.id === 'delete')!.run();
  assert(!stored.some((m) => m.id === 'custom:old'), 'target material removed');
  assert(stored.some((m) => m.id === 'custom:sign'), 'unrelated decal material remains');
  assertEqual(events[0].event.kind, 'removed', 'materials stream got removed event');
});

test('shared chooser contract groups every material consumer the same way', () => {
  const opts = materialPickOptions([
    { id: 'a-concrete', label: 'Concrete' },
    { id: 'brickRed', label: 'Brick Red' },
  ]);
  assertEqual(materialFamily('a-concrete'), 'a-family', 'a- prefix groups under its family');
  assertEqual(materialFamily('brickRed'), 'misc', 'unprefixed material ids pool under misc');
  assertEqual(opts[0].group, 'a-family', 'chooser option carries the family');
  assertEqual(opts[1].group, 'misc', 'chooser option carries misc');
  assertEqual(materialLabel(opts, 'a-concrete'), 'Concrete', 'shared display label resolves from chooser rows');
  assertEqual(materialLabel(opts, 'missing'), 'missing', 'unknown ids remain readable');
});

finish('workbench/materials');
