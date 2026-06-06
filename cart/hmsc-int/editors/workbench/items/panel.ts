// editors/workbench/items/panel.ts -- headless ITEM WorkbenchSource core.

import type { WorkbenchSource, RosterRow, ActionSpec } from '../../../shell/Workbench';
import type { PanelSpec, FieldSpec } from '../../../shell/fields';
import type { LensSpec } from '../../../shell/stage';
import { PAINT_EDITOR_TUNING, type SculptMode } from '../../characters/paintKit';
import { ITEM_DRAFT_DEFAULTS } from '../../items/bake';
import {
  ITEM_KNOBS, VOXEL_FACES, VOXEL_KINDS, VOXEL_PALETTE, itemWorkbenchStore,
  type ItemLens, type ItemStore, type VoxelBlockKind, type VoxelTool,
} from './store';

export const ITEM_LENSES: LensSpec[] = [
  { id: 'item', label: 'ITEM' },
  { id: 'sculpt', label: 'SCULPT' },
  { id: 'voxel', label: 'VOXEL' },
];

const SCULPT_MODES: SculptMode[] = ['raise', 'lower', 'flatten'];
const VOXEL_TOOLS: VoxelTool[] = ['build', 'mine'];

function sourceLabel(s: ItemStore): string {
  return s.draft.source
    ? `${s.draft.source.blocks} blocks · ${s.draft.source.dims.w}x${s.draft.source.dims.d}x${s.draft.source.dims.h}`
    : 'blank sphere';
}

function selectedVoxelLabel(s: ItemStore): string {
  const b = s.selectedVoxel();
  return b ? `#${b.id} · ${b.x},${b.y},${b.z} · ${s.view.activeFace.label}` : 'none';
}

function groupLabel(s: ItemStore): string {
  const g = s.selectedGroup();
  return g ? `${g.face.label} ${g.kind} x${g.cells.length}` : 'none';
}

export function itemPanel(s: ItemStore): PanelSpec {
  const groups: PanelSpec['groups'] = [];
  groups.push({
    title: 'IDENTITY',
    fields: [
      { k: 'name', t: 'text', width: 150, get: () => s.draftName, set: (v) => s.setDraftName(v) },
      { k: 'status', t: 'val', get: () => s.status ?? 'ready' },
      { k: 'source', t: 'val', get: () => sourceLabel(s) },
    ],
  });

  groups.push({
    title: 'ITEM SHAPE',
    fields: [
      { k: 'base radius', t: 'num', ...ITEM_KNOBS.radius, get: () => s.draft.radius, set: (v) => s.setRadius(v) },
      { k: 'depth amount', t: 'num', ...ITEM_KNOBS.amount, get: () => s.draft.amount, set: (v) => s.setAmount(v) },
      { k: 'color', t: 'color', opts: ITEM_DRAFT_DEFAULTS.colors.slice(), get: () => s.draft.color, set: (v) => s.setColor(v) },
      { k: 'grab grid', t: 'bool', get: () => s.view.showGrabGrid, set: (v) => s.setShowGrabGrid(v) },
    ],
  });

  groups.push({
    title: 'SCULPT',
    fields: [
      { k: 'mode', t: 'enum', opts: SCULPT_MODES, get: () => s.view.sculptMode, set: (v) => s.setSculptMode(v as SculptMode) },
      { k: 'mirror', t: 'bool', get: () => s.view.mirror, set: (v) => s.setMirror(v) },
      { k: 'brush', t: 'num', ...ITEM_KNOBS.brush, get: () => s.view.brush, set: (v) => s.setBrush(v) },
      { k: 'strength', t: 'slider', min: ITEM_KNOBS.strength.min, max: ITEM_KNOBS.strength.max, show: (v) => v.toFixed(2), get: () => s.view.strength, set: (v) => s.setStrength(v) },
      { k: 'import voxel', t: 'act', tone: 'success', run: () => s.importBlockout() },
      { k: 'clear sculpt', t: 'act', tone: 'error', run: () => s.clearSculpt() },
    ],
  });

  groups.push({
    title: 'VOXEL BLOCKOUT',
    fields: [
      { k: 'W', t: 'num', ...ITEM_KNOBS.dims, get: () => s.voxelDims.w, set: (w) => s.setVoxelDims({ w }) },
      { k: 'D', t: 'num', ...ITEM_KNOBS.dims, get: () => s.voxelDims.d, set: (d) => s.setVoxelDims({ d }) },
      { k: 'H', t: 'num', ...ITEM_KNOBS.dims, get: () => s.voxelDims.h, set: (h) => s.setVoxelDims({ h }) },
      { k: 'tool', t: 'enum', opts: VOXEL_TOOLS, get: () => s.view.voxelTool, set: (v) => s.setVoxelTool(v as VoxelTool) },
      { k: 'kind', t: 'enum', opts: VOXEL_PALETTE, get: () => s.view.voxelKind, set: (v) => s.setVoxelKind(v as VoxelBlockKind) },
      { k: 'face', t: 'enum', opts: VOXEL_FACES.map((f) => f.label), get: () => s.view.activeFace.label, set: (label) => s.setActiveFace(VOXEL_FACES.find((f) => f.label === label) ?? VOXEL_FACES[2]) },
      { k: 'selected', t: 'val', get: () => selectedVoxelLabel(s) },
      { k: 'custom blocks', t: 'val', get: () => `${s.voxelCustom.length}` },
      { k: 'face group', t: 'val', get: () => groupLabel(s) },
      { k: 'add preview', t: 'act', tone: 'success', run: () => s.addPreviewBlock() },
      { k: 'clear blocks', t: 'act', tone: 'error', run: () => s.clearVoxel() },
      { k: 'export JSON', t: 'act', run: () => s.exportVoxelJson() },
    ],
  });

  return { groups };
}

function rosterDoors(s: ItemStore) {
  return {
    list(): RosterRow[] {
      const st = s.rosterState();
      return st.order.map((id) => ({ id, label: st.items[id]?.metadata?.title ?? st.items[id]?.name ?? id, icon: 'Package' }));
    },
    defaultRow: (rows: RosterRow[]) => (s.draftId && rows.some((r) => r.id === s.draftId) ? s.draftId : rows[rows.length - 1]?.id),
    onPick: (id: string) => s.loadFromRoster(id),
    select: () => s,
    subscribe: (fn: () => void) => s.subscribe(fn),
  };
}

const newItemAction = (s: ItemStore): ActionSpec => ({ id: 'new', label: 'New', icon: 'Plus', run: () => s.newItem() });

export function itemSourceCore(store?: ItemStore): Omit<WorkbenchSource<ItemStore>, 'stage'> & { store: ItemStore } {
  const s = store ?? itemWorkbenchStore();
  return {
    store: s,
    id: 'item',
    icon: 'Package',
    kicker: 'ITEMS',
    ...rosterDoors(s),
    panel: () => itemPanel(s),
    lenses: () => ITEM_LENSES,
    activeLens: () => s.view.lens,
    onLens: (_subject, id) => s.setLens(id as ItemLens),
    actions(): ActionSpec[] {
      return [
        newItemAction(s),
        { id: 'save', label: 'Save', icon: 'Check', run: () => s.saveToRoster() },
        { id: 'import', label: 'Import Voxels', icon: 'Boxes', run: () => s.importBlockout() },
        { id: 'export-voxels', label: 'Export Voxels', icon: 'Download', run: () => s.exportVoxelJson() },
        { id: 'undo', label: 'Undo', icon: 'Undo2', run: () => s.undo() },
        { id: 'redo', label: 'Redo', icon: 'Redo2', run: () => s.redo() },
        ...(s.draftId ? [{ id: 'remove', label: 'Remove', icon: 'Trash2', run: () => s.removeFromRoster(s.draftId!) }] : []),
      ];
    },
    emptyActions(): ActionSpec[] {
      return [newItemAction(s), { id: 'import', label: 'Import Voxels', icon: 'Boxes', run: () => s.importBlockout() }];
    },
  };
}

export function field(spec: PanelSpec, groupTitle: string, k: string): FieldSpec | undefined {
  const g = spec.groups.find((x) => x.title === groupTitle || x.title.startsWith(groupTitle));
  return g?.fields.find((f) => f.k === k);
}
