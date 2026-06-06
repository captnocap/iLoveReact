// source.test.ts -- P4 tests for the ITEM WorkbenchSource (WBSTEP5-0606).
// Headless: exercises the source core, PanelSpec write paths, item stream,
// voxel stream, and the voxel->item import path without importing Stage.tsx.

import { assert, assertEqual, finish, test } from '../../../game/_testkit';
import { itemSourceCore, itemPanel, field } from './panel';
import { createItemStore, draftFromItemDoc, draftToItemDoc, type ItemStoreDeps } from './store';
import { emptyItemGrid } from '../../items/bake';
import type { ItemsStreamState } from '../../items/stream';
import type { VoxelsStreamState } from '../../voxels/stream';

type Rec = {
  itemCommits: Array<{ e: any; label: string }>;
  voxelCommits: Array<{ e: any; label: string }>;
  notes: string[];
  exports: Array<{ path: string; content: string }>;
};

function fakeDeps(withItems = false, withVoxels = false): { deps: ItemStoreDeps; rec: Rec; items: ItemsStreamState; voxels: VoxelsStreamState } {
  const rec: Rec = { itemCommits: [], voxelCommits: [], notes: [], exports: [] };
  const items: ItemsStreamState = { items: {}, order: [] };
  if (withItems) {
    const doc = draftToItemDoc({ radius: 0.75, amount: 0.25, grid: emptyItemGrid(), color: '#d8b56a', source: null }, 'saved wrench');
    items.items['itm-a'] = doc;
    items.order.push('itm-a');
  }
  const voxels: VoxelsStreamState = {
    doc: withVoxels
      ? { dims: { w: 5, d: 6, h: 7 }, blocks: [{ id: 1001, x: 0, y: 1, z: 0, kind: 'wall' }] }
      : null,
  };
  const deps: ItemStoreDeps = {
    items: { state: () => items },
    voxels: { state: () => voxels },
    itemSession: {
      commit: ((e: any, label: string) => {
        rec.itemCommits.push({ e, label });
        if (e.kind === 'authored') {
          items.items[e.id] = e.doc;
          if (!items.order.includes(e.id)) items.order.push(e.id);
        } else if (e.kind === 'removed') {
          delete items.items[e.id];
          items.order = items.order.filter((id) => id !== e.id);
        }
        return { globalSeq: rec.itemCommits.length } as any;
      }) as any,
      note: ((label: string) => { rec.notes.push(label); return { globalSeq: rec.notes.length } as any; }) as any,
    },
    voxelSession: {
      commit: ((e: any, label: string) => {
        rec.voxelCommits.push({ e, label });
        if (e.kind === 'authored') voxels.doc = e.doc;
        return { globalSeq: rec.voxelCommits.length } as any;
      }) as any,
      note: ((label: string) => { rec.notes.push(label); return { globalSeq: rec.notes.length } as any; }) as any,
    },
    error: null,
    autosaveMs: 0,
    twig: false,
    exportFile: (path, content) => { rec.exports.push({ path, content }); },
  };
  return { deps, rec, items, voxels };
}

test('list/defaultRow/onPick: saved sculpted items restore through the item roster', () => {
  const { deps } = fakeDeps(true);
  const store = createItemStore(deps);
  const src = itemSourceCore(store);
  const rows = src.list();
  assertEqual(rows.length, 1, 'one saved item lists');
  assertEqual(rows[0].label, 'saved wrench', 'row label uses document title');
  assertEqual(src.defaultRow!(rows), 'itm-a', 'the saved row is the default');
  src.onPick!('itm-a');
  assertEqual(store.draftId, 'itm-a', 'onPick installs the saved id');
  assertEqual(store.draftName, 'saved wrench', 'the draft name follows the doc');
});

test('name edits do not autosave until a sculpt/item field changes', () => {
  const { deps, rec } = fakeDeps(false);
  const store = createItemStore(deps);
  (field(itemPanel(store), 'IDENTITY', 'name') as any).set('pipe');
  assertEqual(rec.itemCommits.length, 0, 'name alone is view metadata, not an authored item event');
  (field(itemPanel(store), 'ITEM SHAPE', 'base radius') as any).set(1.25);
  assertEqual(rec.itemCommits.length, 1, 'shape edit autosaves');
  assertEqual(rec.itemCommits[0].label, 'autosave · pipe', 'autosave label carries the current name');
});

test('save/new/remove actions use the same items stream event shapes as /items', () => {
  const { deps, rec } = fakeDeps(false);
  const store = createItemStore(deps);
  const src = itemSourceCore(store);
  src.actions!(store).find((a) => a.id === 'save')!.run();
  assertEqual(rec.itemCommits[0].e.kind, 'authored', 'save authors the item');
  const saved = rec.itemCommits[0].e.id;
  assert(store.draftId === saved, 'save assigns the working id');
  src.actions!(store).find((a) => a.id === 'new')!.run();
  assert(store.draftId !== saved, 'new starts a separate target via autosave');
  store.loadFromRoster(saved);
  src.actions!(store).find((a) => a.id === 'remove')!.run();
  assertEqual(rec.itemCommits[rec.itemCommits.length - 1].e.kind, 'removed', 'remove emits a removed event');
});

test('PanelSpec exposes the item source lens set and source-owned lens control', () => {
  const { deps } = fakeDeps(false);
  const store = createItemStore(deps);
  const src = itemSourceCore(store);
  assertEqual(src.lenses!(store).map((l) => l.id).join(','), 'item,sculpt,voxel', 'the ruled lens set');
  assertEqual(src.activeLens!(store), 'item', 'default lens is item preview');
  src.onLens!(store, 'voxel');
  assertEqual(store.view.lens, 'voxel', 'onLens writes the store');
});

test('item panel fields cover name, shape, sculpt, and voxel blockout controls', () => {
  const { deps } = fakeDeps(false);
  const store = createItemStore(deps);
  const spec = itemPanel(store);
  assertEqual(spec.groups.map((g) => g.title).join('|'), 'IDENTITY|ITEM SHAPE|SCULPT|VOXEL BLOCKOUT', 'all groups are present');
  assert(field(spec, 'ITEM SHAPE', 'color'), 'color field is present');
  assert(field(spec, 'SCULPT', 'import voxel'), 'voxel import action is in the sculpt group');
  assert(field(spec, 'VOXEL BLOCKOUT', 'export JSON'), 'voxel export action is in the voxel group');
});

test('voxel dimensions clamp, trim custom blocks, and autosave to the voxels stream', () => {
  const { deps, rec } = fakeDeps(false);
  const store = createItemStore(deps);
  store.setVoxelDims({ w: 2, d: 2, h: 2 });
  assertEqual(store.voxelDims.w, 2, 'width changed');
  assertEqual(rec.voxelCommits.length, 1, 'dimension edit autosaves');
  store.setVoxelDims({ w: 99 });
  assertEqual(store.voxelDims.w, 20, 'width clamps at the route maximum');
});

test('voxel build adds at the selected face; mine removes custom blocks but refuses the floor', () => {
  const { deps } = fakeDeps(false);
  const store = createItemStore(deps);
  store.addPreviewBlock();
  assertEqual(store.voxelCustom.length, 1, 'add preview builds one custom block');
  const added = store.voxelCustom[0];
  assertEqual(added.kind, 'wall', 'default kind is wall');
  store.setVoxelTool('mine');
  store.onVoxelFace(added, store.view.activeFace);
  assertEqual(store.voxelCustom.length, 0, 'mine removes the custom block');
  store.onVoxelFace(store.selectedVoxel(), store.view.activeFace);
  assertEqual(store.status, 'Floor is locked', 'mine refuses locked floor');
});

test('palette pick switches back to build and face groups summarize exposed surfaces', () => {
  const { deps } = fakeDeps(false);
  const store = createItemStore(deps);
  store.setVoxelTool('mine');
  store.setVoxelKind('glass');
  assertEqual(store.view.voxelTool, 'build', 'palette pick switches to build');
  store.addPreviewBlock();
  const groups = store.voxelGroups();
  assert(groups.length > 0, 'face groups compute from floor plus custom block');
  store.selectGroup(groups[0].id);
  assert(store.status?.includes(groups[0].kind), 'selecting a group narrates it');
});

test('import voxel blockout bakes the current voxel doc into the item draft', () => {
  const { deps, rec } = fakeDeps(false);
  const store = createItemStore(deps);
  store.addPreviewBlock();
  store.importBlockout();
  assertEqual(store.draftName, 'blockout item', 'import starts a new item');
  assertEqual(store.draft.source?.blocks, 1, 'source metadata records block count');
  assertEqual(store.view.lens, 'sculpt', 'import moves the source to the sculpt lens');
  assert(rec.itemCommits.some((c) => c.label === 'autosave · blockout item'), 'imported content autosaves');
});

test('import reports an empty blockout instead of inventing item data', () => {
  const { deps } = fakeDeps(false);
  const store = createItemStore(deps);
  store.importBlockout();
  assert(store.status?.includes('no blockout yet'), 'empty import reports the missing blockout');
  assertEqual(store.draft.source, null, 'draft source stays blank');
});

test('undo restores the pre-edit item draft through shared paint history', () => {
  const { deps } = fakeDeps(false);
  const store = createItemStore(deps);
  const before = store.draft.radius;
  store.setRadius(1.4);
  assertEqual(store.draft.radius, 1.4, 'edit landed');
  store.undo();
  assertEqual(store.draft.radius, before, 'undo restored the pre-edit radius');
});

test('export JSON writes the voxel blockout payload with dims, blocks, floor, and face groups', () => {
  const { deps, rec } = fakeDeps(false);
  const store = createItemStore(deps);
  store.addPreviewBlock();
  store.exportVoxelJson();
  assertEqual(rec.exports.length, 1, 'one export write');
  assertEqual(rec.exports[0].path, 'cart/hmsc-int/exports/voxel-blockout.json', 'same export path as /voxels');
  const payload = JSON.parse(rec.exports[0].content);
  assertEqual(payload.schema, 'hmsc-int.voxel-blockout.v1', 'schema is preserved');
  assertEqual(payload.blocks.length, 1, 'custom blocks export');
  assert(payload.faceGroups.length > 0, 'face group metadata exports');
});

test('saved sculpted item documents round-trip through the store doc helpers', () => {
  const doc = draftToItemDoc({ radius: 1.2, amount: 0.4, grid: emptyItemGrid(), color: '#4fc3df', source: { blocks: 2, dims: { w: 3, d: 4, h: 5 } } }, 'round trip');
  const draft = draftFromItemDoc(doc);
  assertEqual(draft.radius, 1.2, 'radius round-trips');
  assertEqual(draft.source?.dims.h, 5, 'source dims round-trip');
});

finish('editors/workbench/items');
