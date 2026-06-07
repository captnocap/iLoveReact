// source.test.ts -- P4 tests for the ITEM WorkbenchSource (WBSTEP5-0606).
// Headless: exercises the source core, PanelSpec write paths, item stream,
// voxel stream, and the voxel->item import path without importing Stage.tsx.

import { assert, assertClose, assertEqual, finish, test } from '../../../game/_testkit';
import { workbenchShortcutHandlers } from '../../../shell/Workbench';
import { itemSourceCore, itemPanel, field } from './panel';
import { GAME_ITEMS } from '../../../game/items';
import { createItemStore, draftFromItemDoc, draftToItemDoc, gameItemRosterId, streamItemRosterId, VOXEL_FACES, WORKING_ITEM_ROSTER_ID, type ItemStoreDeps } from './store';
import { bakeBlockoutToGlobe, emptyItemGrid } from '../../items/bake';
import type { ItemsStreamState } from '../../items/stream';
import { VOXEL_BLOCKOUT_TUNING, type VoxelsStreamState } from '../../voxels/stream';

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
      ? { dims: { w: 5, d: 6, h: 7 }, cellSizeMeters: VOXEL_BLOCKOUT_TUNING.defaultCellSizeMeters, blocks: [{ id: 1001, x: 0, y: 1, z: 0, kind: 'wall' }] }
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
  assertEqual(rows.length, GAME_ITEMS.definitions.length + 1, 'registry items plus one saved item list');
  const saved = rows.find((r) => r.id === streamItemRosterId('itm-a'));
  assert(!!saved, 'the saved sculpted item is still present');
  assertEqual(saved!.label, 'saved wrench', 'row label uses document title');
  assertEqual(src.defaultRow!(rows), streamItemRosterId('itm-a'), 'the saved row is the default');
  src.onPick!(streamItemRosterId('itm-a'));
  assertEqual(store.draftId, 'itm-a', 'onPick installs the saved id');
  assertEqual(store.draftName, 'saved wrench', 'the draft name follows the doc');
});

test('ITEMSGONE-0606: legacy/stream/working name collisions keep distinct roster ids', () => {
  const { deps, items } = fakeDeps(false);
  const doc = draftToItemDoc({ radius: 0.75, amount: 0.25, grid: emptyItemGrid(), color: '#d8b56a', source: null }, 'blockout item');
  items.items['itm-blockout'] = doc;
  items.order.push('itm-blockout');
  const store = createItemStore({ ...deps, itemSession: null });
  store.newItem();
  store.openVoxelBlockout();
  store.addPreviewBlock();
  const rows = itemSourceCore(store).list();
  const blockoutRows = rows.filter((r) => r.label === 'blockout item');
  console.log(`[ITEMSGONE-0606-KEYS] ${JSON.stringify(blockoutRows.map((r) => r.id))}`);

  assertEqual(blockoutRows.length, 2, 'working and stream rows with the same visible name both render');
  assertEqual(new Set(blockoutRows.map((r) => r.id)).size, 2, 'visible-name collisions keep distinct stable row ids');
  assert(blockoutRows.some((r) => r.id === WORKING_ITEM_ROSTER_ID), 'working row uses the reserved working id');
  assert(blockoutRows.some((r) => r.id === streamItemRosterId('itm-blockout')), 'stream row uses the namespaced stream id');
});

test('ITEMSGONE-0606: built-in GAME_ITEMS are visible when the items stream is empty', () => {
  const { deps, rec } = fakeDeps(false);
  const store = createItemStore(deps);
  const src = itemSourceCore(store);
  const rows = src.list();
  console.log(`[ITEMSGONE-0606] streamOrder=${JSON.stringify(deps.items!.state().order)} rosterCount=${rows.length} first=${rows[0]?.id} legacyCount=${GAME_ITEMS.definitions.length}`);

  assertEqual(rows.length, GAME_ITEMS.definitions.length, 'empty authored stream still exposes the game item registry');
  assertEqual(rows[0].id, gameItemRosterId('knife'), 'registry ids are namespaced and unmigrated');
  assertEqual(rows[0].label, 'Knife', 'registry labels are visible in the workbench roster');
  assertEqual(src.defaultRow!(rows), gameItemRosterId('knife'), 'empty stream defaults to the first existing game item');
  src.onPick!(gameItemRosterId('knife'));
  assertEqual(store.selectedRegistryItem()?.id, 'knife', 'picking a registry row selects the existing game item');
  assertEqual(store.draftId, null, 'registry rows do not masquerade as authored sculpt ids');
  assertEqual(rec.itemCommits.length, 0, 'showing legacy registry items writes no migration event');
});

test('VOXELDISCOVER-0606: Voxel Blockout opens the VOXEL lens without a saved roster row', () => {
  const { deps } = fakeDeps(false);
  const store = createItemStore({ ...deps, itemSession: null });
  const src = itemSourceCore(store);
  const action = src.actions!(store).find((a) => a.id === 'voxel-blockout');
  assert(!!action, 'voxel blockout is a first-level item action beside New');
  action!.run();
  const rows = src.list();
  console.log(`[VOXELDISCOVER-0606] rows=${rows.map((r) => r.id).join(',')} default=${src.defaultRow!(rows)} lens=${store.view.lens} status=${store.status}`);

  assertEqual(store.view.lens, 'voxel', 'the action switches directly to voxel authoring');
  assert(rows.some((r) => r.id === WORKING_ITEM_ROSTER_ID), 'an unsaved working row appears even when autosave cannot mint an item row');
  assertEqual(src.defaultRow!(rows), WORKING_ITEM_ROSTER_ID, 'the workbench selects the working row so the lens bar is visible');
  assert(store.status?.includes('stack blocks'), 'status names the voxel stacking path');
});

test('VOXELDISCOVER-0606: empty item source actions include a voxel-authoring doorway', () => {
  const { deps } = fakeDeps(false);
  const store = createItemStore(deps);
  const src = itemSourceCore(store);
  const emptyVoxel = src.emptyActions!().find((a) => a.id === 'voxel-blockout');
  assert(!!emptyVoxel, 'empty roster state still exposes Voxel Blockout next to New');
  emptyVoxel!.run();
  assertEqual(store.view.lens, 'voxel', 'empty-state voxel action opens the VOXEL lens');
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
  assert(((field(spec, 'SCULPT', 'mode') as any).opts as string[]).includes('smooth'), 'item sculpt exposes the character-kit smooth mode');
  assert(!field(spec, 'SCULPT', 'import voxel'), 'auto-flow removes the manual voxel import step');
  assert(field(spec, 'VOXEL BLOCKOUT', 'cell m'), 'voxel cell-size field is in the voxel group');
  assert(field(spec, 'VOXEL BLOCKOUT', 'export JSON'), 'voxel export action is in the voxel group');
  assert(!itemSourceCore(store).actions!(store).some((a) => a.id === 'import'), 'hero actions do not require Import Voxels');
});

test('voxel dimensions and cell size clamp and autosave to the voxels stream', () => {
  const { deps, rec } = fakeDeps(false);
  const store = createItemStore(deps);
  console.log(`[VOXELSCALE-0606] defaultCellSizeMeters=${store.voxelCellSizeMeters} dims=${store.voxelDims.w}x${store.voxelDims.d}x${store.voxelDims.h}`);
  assertEqual(store.voxelCellSizeMeters, VOXEL_BLOCKOUT_TUNING.defaultCellSizeMeters, 'default blockout cells are item-sized');
  store.setVoxelCellSizeMeters(0.05);
  assertEqual(store.voxelCellSizeMeters, 0.05, 'cell size changed');
  assertEqual(rec.voxelCommits[0].e.doc.cellSizeMeters, 0.05, 'cell size autosaves into the blockout doc');
  store.setVoxelDims({ w: 2, d: 2, h: 2 });
  assertEqual(store.voxelDims.w, 2, 'width changed');
  assertEqual(rec.voxelCommits.length, 2, 'cell-size and dimension edits autosave');
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

test('AUTOFLOW-0606: voxel edits immediately bake into the sculpt draft', () => {
  const { deps, rec } = fakeDeps(false);
  const store = createItemStore(deps);
  const blankRadius = store.draft.radius;
  store.addPreviewBlock();
  assertEqual(store.draftName, 'blockout item', 'voxel authoring names the working item');
  assertEqual(store.draft.source?.blocks, 1, 'source metadata records block count');
  assert(store.draft.radius !== blankRadius, 'the blank sphere is replaced without a manual import');
  store.setLens('sculpt');
  assertEqual(store.view.lens, 'sculpt', 'switching to sculpt is only a view change');
  assertEqual(store.draft.source?.blocks, 1, 'sculpt sees the same already-baked blockout');
  assert(rec.itemCommits.some((c) => c.label === 'autosave · blockout item'), 'auto-baked content autosaves');
});

test('AUTOFLOW-0606: voxel rebake preserves sculpt grid detail as a delta', () => {
  const { deps } = fakeDeps(false);
  const store = createItemStore(deps);
  store.addPreviewBlock();
  const idx = 12;
  const delta = 0.12;
  const edited = store.draft.grid.slice();
  edited[idx] = Math.max(-1, Math.min(1, edited[idx] + delta));
  store.setGrid(edited, { history: true, note: 'test sculpt detail' });
  const xp = VOXEL_FACES.find((f) => f.key === 'xp')!;
  store.setActiveFace(xp);
  store.onVoxelFace(store.voxelCustom[0], xp);
  const expectedBase = bakeBlockoutToGlobe(store.voxelDoc)!;
  assertClose(store.draft.grid[idx], Math.max(-1, Math.min(1, expectedBase.grid[idx] + delta)), 1e-9, 'rebake carries sculpt detail forward as a grid delta');
});

test('VOXELSCALE-0606: small cell blockouts import as item-sized sculpt dimensions', () => {
  const { deps } = fakeDeps(false);
  const store = createItemStore(deps);
  const blankRadius = store.draft.radius;
  store.setVoxelDims({ w: 3, d: 1, h: 1 });
  store.setVoxelCellSizeMeters(0.1);
  store.addPreviewBlock();
  const xp = VOXEL_FACES.find((f) => f.key === 'xp')!;
  store.setActiveFace(xp);
  store.onVoxelFace(store.voxelCustom[0], xp);
  store.onVoxelFace(store.voxelCustom[1], xp);
  assertEqual(store.voxelCustom.length, 3, 'authored a three-cell strip');
  const smallRadius = store.draft.radius;
  const smallAmount = store.draft.amount;
  assertEqual(store.draft.source?.cellSizeMeters, 0.1, 'item provenance records 10cm voxel cells');
  assertClose(store.draft.source!.dims.w * store.draft.source!.cellSizeMeters!, 0.3, 1e-9, 'world width is cell size × count');

  store.setVoxelCellSizeMeters(1);
  console.log(`[VOXELSCALE-0606] imported10cm radius=${smallRadius.toFixed(4)} amount=${smallAmount.toFixed(4)} imported1m radius=${store.draft.radius.toFixed(4)} amount=${store.draft.amount.toFixed(4)} widthMeters=${(store.draft.source!.dims.w * store.draft.source!.cellSizeMeters!).toFixed(2)}`);
  assertClose(smallRadius, store.draft.radius * 0.1, 1e-9, 'imported radius scales exactly with voxel cell size');
  assertClose(smallAmount, store.draft.amount * 0.1, 1e-9, 'imported sculpt amount scales exactly with voxel cell size');
  assert(blankRadius !== smallRadius, 'auto-flow changed the draft from the blank sphere');
});

test('empty blockout does not invent item data', () => {
  const { deps } = fakeDeps(false);
  const store = createItemStore(deps);
  store.setVoxelCellSizeMeters(0.1);
  assert(store.status?.includes('no custom blocks'), 'empty voxel edits report there is no sculpt source');
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

test('KEYBINDINGS: item sculpt ctrl+z removes the last completed stroke only', () => {
  const { deps } = fakeDeps(false);
  const store = createItemStore(deps);
  const src = itemSourceCore(store);
  store.setLens('sculpt');
  const base = store.draft.grid.slice();
  const first = base.slice();
  first[17] = 0.25;
  store.setGrid(first, { history: true, note: 'stroke 1' });
  const second = store.draft.grid.slice();
  second[31] = 0.75;
  store.setGrid(second, { history: true, note: 'stroke 2' });

  workbenchShortcutHandlers(src.actions!(store), (a) => a.run()).undo?.();
  assertClose(store.draft.grid[17], 0.25, 1e-9, 'the previous stroke survives');
  assertClose(store.draft.grid[31], base[31], 1e-9, 'only the last stroke disappears');
});

finish('editors/workbench/items');
