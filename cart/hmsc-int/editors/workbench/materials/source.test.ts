// source.test.ts -- P4 behavior tests for the MATERIAL WorkbenchSource core
// (WBSTEP7-0606). These pin the consumption layer: roster -> panel setters ->
// hero actions -> stored materials/decal reopen.

import { assert, assertEqual, finish, test } from '../../../game/_testkit';
import { DECAL_DOC_VERSION, emptyDecalDoc } from '../../../game/textures/decal';
import type { ShaderSpec } from '../../../game/textures/shaders';
import type { FieldSpec, PanelSpec } from '../../../shell/fields';
import { materialFamily, materialLabel, materialPickOptions } from './chooser';
import { assignableMaterialCatalog } from './catalog';
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

const FILL_SPEC: ShaderSpec = {
  id: 'a-concrete',
  label: 'Concrete',
  group: 'Walls & Masonry',
  blurb: 'test effect fill',
  shader: 'fill-wgsl',
  base: [{ key: 'seed', label: 'Seed', default: 12, min: 0, max: 100, step: 1, integer: true }],
  variants: [{ id: 'v0', label: 'Take 1', value: 0, params: [] }],
  buildData: (variant, base) => [1, variant, base.seed ?? 12, 3, 0],
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
    recipes: () => [SPEC, FILL_SPEC],
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
    pickImage: () => 'file:///tmp/decal%20source.png',
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

test('mission codes appear as importable rows and load into the compose surface', () => {
  const { store } = rig();
  const rows = store.listRows();
  const mission = rows.find((r) => r.id === 'mission:delivery-gig');
  assert(!!mission, 'a mission-code row exists for the shipped mission');
  assert(mission!.label.startsWith('Mission · '), 'the row is labelled as a mission code');
  store.pick('mission:delivery-gig');
  assertEqual(store.lens, 'compose', 'picking a mission code opens the compose surface');
  const doc = store.composeDoc;
  assertEqual(doc.version, DECAL_DOC_VERSION, 'a valid decal doc is loaded');
  assertEqual(doc.nodes.length, 1, 'the code is the one shader-filled node');
  assertEqual((doc.nodes[0] as any).fillShaderId, 'mission-code', 'the node carries the mission-code fill');
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
  store.resizeComposeNode(nodeId, 'se', 20, 10);
  assertEqual(store.composeDoc.nodes[0].w, emptyDecalDoc().width / 2 + 20, 'stage resize writes node width');
  assertEqual(store.composeDoc.nodes[0].h, emptyDecalDoc().height / 2 + 10, 'stage resize writes node height');
  store.resizeComposeNode(nodeId, 'w', 9999, 0);
  assertEqual(store.composeDoc.nodes[0].w, 1, 'resize clamps to the minimum width');
  assertEqual(store.composeDoc.nodes[0].x, emptyDecalDoc().width / 4 + 5 + emptyDecalDoc().width / 2 + 20 - 1, 'west resize keeps the east edge pinned when clamped');
  panel = store.panel(store.select('decal:new'));
  (field(panel, 'NODE PROPERTIES', 'effect fill') as Extract<FieldSpec, { t: 'pick' }>).set(FILL_SPEC.id);
  assertEqual((store.composeDoc.nodes[0] as any).fillShaderId, FILL_SPEC.id, 'rect node can use a material effect fill');
  assertEqual(JSON.stringify((store.composeDoc.nodes[0] as any).fillData), JSON.stringify([1, 0, 12, 3, 0]), 'effect fill stores frozen shader data');
  panel = store.panel(store.select('decal:new'));
  (field(panel, 'COMPOSE', '+ image') as Extract<FieldSpec, { t: 'act' }>).run();
  const image = store.composeDoc.nodes.find((n) => n.kind === 'image');
  assert(image !== undefined && image.kind === 'image', 'image node added through panel action');
  assertEqual(image.src, '/tmp/decal source.png', 'image add opens picker and cleans the selected path');
  store.selectComposeNode(image.id);
  panel = store.panel(store.select('decal:new'));
  (field(panel, 'NODE PROPERTIES', 'pick file…') as Extract<FieldSpec, { t: 'act' }>).run();
  assertEqual((store.composeDoc.nodes.find((n) => n.id === image.id) as any).src, '/tmp/decal source.png', 'image node exposes the same picker from properties');
  store.actions(store.select('decal:new')).find((a) => a.id === 'materialize-decal')!.run();
  const saved = stored.find((m) => m.id === 'custom:poster-a');
  assert(!!saved?.decal, 'stored decal was created');
  assertEqual(saved!.decal!.version, DECAL_DOC_VERSION, 'decal doc rides the stored material');
  assertEqual(events[0].event.kind, 'materialized', 'materials stream got decal materialized event');
  assertEqual((twigs['/compose:doc'] as any).nodes.length, 2, 'compose draft twig carries the doc');

  store.pick('decal:custom:poster-a');
  assertEqual(store.composeEditingId, 'custom:poster-a', 'saved decal row reopens for update');
  assertEqual(store.composeDoc.nodes.length, 2, 'reopened decal keeps its layers');
  const reopenedId = store.composeDoc.nodes[0].id;
  store.selectComposeNode(reopenedId);
  store.renameComposeNode(reopenedId, 'front rect');
  assertEqual(store.composeDoc.nodes[0].name, 'front rect', 'compose layers can be renamed through the shared strip');
  store.toggleComposeNodeHidden(reopenedId);
  assertEqual(store.composeDoc.nodes[0].hidden, true, 'compose layers can be hidden through the shared strip');
  store.moveComposeNodeLayer(reopenedId, 1);
  assertEqual(store.composeDoc.nodes[1].id, reopenedId, 'compose layers can move forward through the shared strip');
  store.removeComposeNode(reopenedId);
  assertEqual(store.composeDoc.nodes.length, 1, 'compose layers can be removed through the shared strip');
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
  assertEqual(materialFamily('a-concrete'), 'Unsorted Materials', 'board-letter ids do not create visible families');
  assertEqual(materialFamily('brickRed'), 'Unsorted Materials', 'unprefixed ids use the fallback shelf');
  assertEqual(materialFamily('custom:old'), 'Stored Materials', 'stored ids have a useful fallback shelf');
  assertEqual(opts[0].group, 'Unsorted Materials', 'chooser option carries the fallback shelf');
  assertEqual(opts[1].group, 'Unsorted Materials', 'chooser option carries the fallback shelf');
  assertEqual(materialLabel(opts, 'a-concrete'), 'Concrete', 'shared display label resolves from chooser rows');
  assertEqual(materialLabel(opts, 'missing'), 'missing', 'unknown ids remain readable');
});

test('assignable material catalog includes the browsable standard shader presets', () => {
  const rows = assignableMaterialCatalog();
  const preset = rows.find((r) => r.id === 'n-floral-wallpaper--v2--std');
  assert(preset !== undefined, 'baked wallpaper preset is assignable');
  assertEqual(preset!.label, 'Floral Wallpaper · Blue China · Std', 'preset row carries material/take/quality label');
  assertEqual(preset!.group, 'Wallpaper & Interior Walls', 'preset row carries semantic shelf');
  assertEqual(preset!.source, 'preset', 'preset row is tagged separately from tunable recipes');
  assert(!rows.some((r) => r.id === 'n-floral-wallpaper--v2--max'), 'nonstandard quality presets stay out of the normal picker');
});

finish('workbench/materials');
