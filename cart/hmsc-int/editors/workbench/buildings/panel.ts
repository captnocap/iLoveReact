// editors/workbench/buildings/panel.ts — the BUILDING source's headless half
// (BUILDSKIN-0606): roster, the generated PanelSpec (type-global skin groups
// + the selected piece's override/structure group), hero actions, and the
// stage's render fold. No React (the characters.test.ts bundling law).
//
// Panel shape (LAW 1: gutter 3 is the ONE edit surface):
//   BUILDING        — name, counts, the piece selector (selection is view
//                     state through a setter — the WBCHAR C1 precedent), add.
//   <KIND> GLOBAL   — one group per piece type PRESENT (structural quartet
//                     first): per-slot color + material rows + the ALL row
//                     ("all walls → green" is ONE control) + clear.
//   PIECE #n        — the selected piece: resolved provenance (read), the
//                     override rows (beat the globals), placement nums,
//                     swap/edit enums, remove. "Nothing is immutable."

import type { FieldSpec, PanelSpec, PickOption } from '../../../shell/fields';
import type { ActionSpec, RosterRow } from '../../../shell/Workbench';
import { materialLabel, materialPickOptions as sharedMaterialPickOptions } from '../materials/chooser';
import {
  BUILD_CATALOG_IDS,
  WALL_EDITS,
  buildKindContract,
  carriesMicroGrid,
  catalogEntry,
  describeFaceSkin,
  faceSlotLabels,
  FLOOR_DEFAULT_CELL_KIND,
  skinKindOrder,
  BUILD_FACE_SLOTS,
  type BuildFaceSkin,
  type BuildFaceSlot,
  type BuildMaterial,
  type BuildPieceKind,
  type BuildPrefabDef,
  type WallEdit,
} from '../../../game/build';
import { PAINTABLE_TILE_KINDS, tileKindDefinition, type TileKind } from '../../../game/kinds';
import type { BuildingPaintTarget, BuildingSkinScope, BuildingsStore, SkinSlotTarget } from './store';

// quick-pick swatches for the color rows (colors are local; material choices
// come through the MATERIAL source chooser contract).
export const BUILDING_PALETTE = ['#16a34a', '#dc2626', '#2563eb', '#f59e0b', '#7c3aed', '#0891b2', '#f8fafc', '#111827', '#a16207', '#db2777'];

/** the BARE look per physical material — what an unskinned face renders
 *  (display default only; a skin always wins) */
export const BARE_MATERIAL_COLORS: Record<BuildMaterial, string> = {
  concrete: '#8b8f94',
  brick: '#9a5b45',
  stucco: '#cdbfa8',
  wood: '#8a6a48',
  metal: '#6f7b86',
  glass: '#9fc4d8',
  chainlink: '#aab4bc',
};

export function buildingsRoster(store: BuildingsStore): RosterRow[] {
  return store.buildings().map((b) => ({ id: b.id, label: `${b.label} · ${b.pieceCount}` }));
}

function pieceLabel(def: BuildPrefabDef, index: number): string {
  const piece = def.pieces[index];
  const kind = catalogEntry(piece.pieceId).kind;
  return `#${index} ${kind}${piece.edit ? ` · ${piece.edit}` : ''}`;
}

function pieceAcceptsEdit(pieceId: string): boolean {
  return buildKindContract(catalogEntry(pieceId).kind).edits === 'wall';
}

function sameSkin(a: BuildFaceSkin | null, b: BuildFaceSkin | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === 'color' ? a.value === (b as { value: string }).value : a.id === (b as { id: string }).id;
}

function targetSkin(target: SkinSlotTarget, read: (slot: BuildFaceSlot) => BuildFaceSkin | null): BuildFaceSkin | null {
  if (target !== 'all') return read(target);
  const [first, ...rest] = BUILD_FACE_SLOTS.map(read);
  return rest.every((skin) => sameSkin(first, skin)) ? first : null;
}

function sameScope(a: BuildingSkinScope, b: BuildingSkinScope): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'type' ? a.pieceKind === (b as { pieceKind: BuildPieceKind }).pieceKind : a.index === (b as { index: number }).index;
}

function sameTarget(a: BuildingPaintTarget | null, b: BuildingPaintTarget): boolean {
  return !!a && a.buildingId === b.buildingId && a.slot === b.slot && sameScope(a.scope, b.scope);
}

// ── pick options (req_0184: the chooser replaces every roster chip wall) ────

export function materialPickOptions(store: BuildingsStore): PickOption[] {
  return sharedMaterialPickOptions(store.deps.materials());
}

/** the piece list grouped by TYPE with counts — the chooser shows
 *  `WALLS · 5` headers; collapsed it is ONE compact chip, never a flood */
export function piecePickOptions(def: BuildPrefabDef): PickOption[] {
  return def.pieces.map((piece, i) => {
    const kind = catalogEntry(piece.pieceId).kind;
    return { id: `#${i}`, label: pieceLabel(def, i), group: `${kind}s` };
  });
}

/** the catalog, grouped by kind — the swap chooser */
export function catalogPickOptions(): PickOption[] {
  return BUILD_CATALOG_IDS.map((id) => {
    const row = catalogEntry(id);
    return { id, label: row.label, group: `${row.kind}s` };
  });
}

/** one color row + ONE compact material pick per face slot — the slot holds
 *  ONE skin, so setting a color replaces a material and vice versa */
function skinRows(
  store: BuildingsStore,
  id: string,
  scope: BuildingSkinScope,
  label: (slot: SkinSlotTarget) => string,
  read: (slot: BuildFaceSlot) => BuildFaceSkin | null,
  write: (target: SkinSlotTarget, skin: BuildFaceSkin | null) => void,
  onMaterialTarget?: (target: BuildingPaintTarget) => void,
  onPaintTarget?: (target: BuildingPaintTarget) => void,
): FieldSpec[] {
  const materials = materialPickOptions(store);
  const showMaterial = (mid: string) => materialLabel(materials, mid);
  const active = () => store.skinTarget(id, scope);
  const activeSkin = () => targetSkin(active(), read);
  const activeLabel = () => label(active());
  const activeMaterial = () => {
    const skin = activeSkin();
    return skin?.kind === 'material' ? skin.id : null;
  };
  const makeTarget = (): BuildingPaintTarget => ({
    buildingId: id,
    scope,
    slot: active(),
    label: activeLabel(),
    materialId: activeMaterial(),
  });
  return [
    {
      k: 'target',
      t: 'pick',
      get: () => active(),
      opts: () => (['all', ...BUILD_FACE_SLOTS] as SkinSlotTarget[]).map((slot) => ({ id: slot, label: label(slot), group: 'faces' })),
      show: (slot) => label(slot as SkinSlotTarget),
      set: (v: string | null) => { if (v) store.setSkinTarget(id, scope, v as SkinSlotTarget); },
    },
    {
      k: 'color',
      t: 'color',
      get: () => { const skin = activeSkin(); return skin?.kind === 'color' ? skin.value : ''; },
      opts: BUILDING_PALETTE,
      set: (v: string) => write(active(), { kind: 'color', value: v }),
    },
    {
      k: 'material',
      t: 'val',
      get: () => {
        const id = activeMaterial();
        return id ? showMaterial(id) : 'bare';
      },
    },
    {
      k: 'browse material',
      t: 'act',
      tone: 'info',
      run: () => onMaterialTarget?.(makeTarget()),
    },
    {
      k: 'paint target',
      t: 'act',
      tone: 'success',
      run: () => onPaintTarget?.(makeTarget()),
    },
    {
      k: 'clear target',
      t: 'act',
      tone: 'warning',
      run: () => {
        const target = makeTarget();
        write(target.slot, null);
        if (sameTarget(store.paintTarget(), target)) store.setPaintTarget({ ...target, materialId: null });
      },
    },
  ];
}

export function buildingsPanel(
  store: BuildingsStore,
  id: string,
  onMaterialTarget?: (target: BuildingPaintTarget) => void,
  onPaintTarget?: (target: BuildingPaintTarget) => void,
): PanelSpec {
  const def = store.building(id);
  if (!def) return { groups: [{ title: 'BUILDING', fields: [{ k: 'status', t: 'val', get: () => store.error() ?? 'unknown building' }] }] };

  const sel = store.selectedPiece(id);
  const groups: PanelSpec['groups'] = [];

  // ── BUILDING ────────────────────────────────────────────────────────────────
  const armed = store.armedDelete() === id;
  groups.push({
    title: 'BUILDING',
    layout: 'rows',
    fields: [
      { k: 'name', t: 'text', get: () => store.building(id)?.label ?? '', set: (v: string) => store.renameBuilding(id, v) },
      { k: 'pieces', t: 'val', get: () => `${store.building(id)?.pieces.length ?? 0}` },
      { k: 'theme', t: 'val', get: () => store.building(id)?.theme ?? '' },
      {
        // the piece list as ONE compact pick — grouped by type with counts
        // in the chooser (req_0184: never a flat chip flood)
        k: 'edit', t: 'pick',
        get: () => (store.selectedPiece(id) < 0 ? null : `#${store.selectedPiece(id)}`),
        opts: () => piecePickOptions(store.building(id)!),
        show: (v: string) => pieceLabel(store.building(id)!, Number(v.slice(1))),
        clearLabel: 'building',
        // selection, not a property — the setter is view state (WBCHAR C1)
        set: (v: string | null) => store.selectPiece(id, v === null ? -1 : Number(v.slice(1))),
      },
      // req_0184 addendum: delete the building — two-step (arm, then the
      // SAME chip reads ⚠ confirm; any other edit/selection disarms)
      {
        k: armed ? '⚠ confirm delete building' : 'delete building',
        t: 'act', tone: 'error',
        run: () => { store.deleteBuilding(id); },
      },
    ],
  });

  // ── the type GLOBALS — one group per kind present, quartet first ───────────
  const present = def.pieces.map((p) => catalogEntry(p.pieceId).kind);
  for (const kind of skinKindOrder(present)) {
    const labels = faceSlotLabels(kind);
    groups.push({
      title: `${kind.toUpperCase()}S · GLOBAL`,
      layout: 'rows',
      fields: skinRows(
        store,
        id,
        { kind: 'type', pieceKind: kind },
        (slot) => (slot === 'all' ? 'all faces' : labels[slot]),
        (slot) => store.building(id)?.skins?.[kind]?.[slot] ?? null,
        (target, skin) => store.setTypeSkin(id, kind, target, skin),
        onMaterialTarget,
        onPaintTarget,
      ),
    });
  }

  // ── the selected piece: override + structure ───────────────────────────────
  if (sel >= 0) {
    const piece = () => store.building(id)!.pieces[sel];
    const kind = () => catalogEntry(piece().pieceId).kind;
    const acceptsEdit = () => pieceAcceptsEdit(piece().pieceId);
    const labels = faceSlotLabels(kind());
    const placement = (key: 'x' | 'y' | 'z' | 'yawDegrees', max: number, step: number): FieldSpec => ({
      k: key === 'yawDegrees' ? 'yaw°' : key,
      t: 'num',
      min: key === 'yawDegrees' ? 0 : -max,
      max,
      step,
      precision: 0,
      get: () => piece()[key],
      set: (v: number) => store.setPiecePlacement(id, sel, { [key]: v }),
    });
    groups.push({
      title: `PIECE ${pieceLabel(def, sel).toUpperCase()}`,
      layout: 'rows',
      fields: [
        {
          // the catalog swap as a pick, grouped by kind (no id chip wall)
          k: 'piece type', t: 'pick',
          get: () => piece().pieceId,
          opts: () => catalogPickOptions(),
          show: (v: string) => catalogEntry(v).label,
          set: (v: string | null) => { if (v !== null) store.swapPiece(id, sel, v); },
        },
        ...(acceptsEdit() ? [{
          k: 'cutout', t: 'enum',
          get: () => piece().edit ?? 'none',
          opts: ['none', ...WALL_EDITS],
          set: (v: string) => store.setPieceEdit(id, sel, v === 'none' ? null : (v as WallEdit)),
        } satisfies FieldSpec] : []),
        placement('x', 60, 1), placement('y', 30, 1), placement('z', 60, 1), placement('yawDegrees', 270, 90),
        // resolved provenance — piece override BEATS type global, visibly
        ...BUILD_FACE_SLOTS.map((slot): FieldSpec => ({
          k: `${labels[slot]} =`, t: 'val',
          get: () => describeFaceSkin(store.resolved(id, sel, slot)),
        })),
        ...skinRows(
          store,
          id,
          { kind: 'piece', index: sel },
          (slot) => (slot === 'all' ? 'override all' : `override ${labels[slot]}`),
          (slot) => piece().skin?.[slot] ?? null,
          (target, skin) => store.setPieceSkin(id, sel, target, skin),
          onMaterialTarget,
          onPaintTarget,
        ),
        { k: 'remove piece', t: 'act', tone: 'error', run: () => store.removePiece(id, sel) },
      ],
    });

    // ── FLOOR CELLS (MICROGRID-0610): the 3×3 cell painter — col 3 EDITS ─────
    // Nine compass rows (row-major, iz south), each a pick over the paintable
    // tile kinds; clearing returns the cell to the material default (which the
    // chip shows, so "default" is never a mystery). Writes go through
    // setFloorCell via the store — the SAME cells the nav bake paths.
    if (carriesMicroGrid(kind())) {
      const defaultKind = () => FLOOR_DEFAULT_CELL_KIND[catalogEntry(piece().pieceId).material];
      const cellLabels = ['nw', 'n', 'ne', 'w', 'centre', 'e', 'sw', 's', 'se'];
      groups.push({
        title: 'FLOOR CELLS · 3×3',
        layout: 'rows',
        fields: cellLabels.map((label, i): FieldSpec => ({
          k: label,
          t: 'pick',
          get: () => piece().cells?.[i] ?? null,
          opts: () => PAINTABLE_TILE_KINDS.map((k) => ({ id: k, label: tileKindDefinition(k).label, group: 'tiles' })),
          show: (v: string) => tileKindDefinition(v as TileKind).label,
          clearLabel: `default (${tileKindDefinition(defaultKind()).label})`,
          set: (v: string | null) => store.setPieceFloorCell(id, sel, i, (v as TileKind | null)),
        })),
      });
    }
  }

  return { groups };
}

export function buildingsActions(store: BuildingsStore, id: string): ActionSpec[] {
  if (!store.building(id)) return [];
  return [
    { id: 'add-wall', label: '+ wall', icon: 'Plus', run: () => store.addPiece(id, 'wall.concrete.common') },
    { id: 'add-floor', label: '+ floor', icon: 'Plus', run: () => store.addPiece(id, 'floor.concrete.common') },
  ];
}

// ── the stage fold: what column 4 renders (receives, never edits) ────────────

export type FaceLook = { color?: string; textureId?: string };

export type PieceRender = {
  index: number;
  kind: BuildPieceKind;
  size: { widthMeters: number; heightMeters: number; depthMeters: number };
  x: number; y: number; z: number; yawDegrees: number;
  edit?: string;
  faces: Record<BuildFaceSlot, FaceLook>;
  selected: boolean;
  /** MICROGRID-0610: a floor's authored 3×3 cells (null = material default) —
   *  the stage tints the authored ones so painting is visible as it happens */
  cells?: (TileKind | null)[];
};
export type BuildingSkinPreview = { target: BuildingPaintTarget; textureId: string };

function lookOf(skin: BuildFaceSkin | null, bare: string): FaceLook {
  if (!skin) return { color: bare };
  return skin.kind === 'color' ? { color: skin.value } : { textureId: skin.id };
}

function previewApplies(preview: BuildingSkinPreview | undefined, id: string, index: number, kind: BuildPieceKind, slot: BuildFaceSlot): boolean {
  if (!preview || preview.target.buildingId !== id) return false;
  if (preview.target.slot !== 'all' && preview.target.slot !== slot) return false;
  const scope = preview.target.scope;
  if (scope.kind === 'piece') return scope.index === index;
  return scope.pieceKind === kind;
}

export function buildingRender(store: BuildingsStore, id: string, preview?: BuildingSkinPreview): PieceRender[] {
  const def = store.building(id);
  if (!def) return [];
  const sel = store.selectedPiece(id);
  return def.pieces.map((piece, index) => {
    const row = catalogEntry(piece.pieceId);
    const bare = BARE_MATERIAL_COLORS[row.material];
    const faces = {} as Record<BuildFaceSlot, FaceLook>;
    for (const slot of BUILD_FACE_SLOTS) {
      faces[slot] = previewApplies(preview, id, index, row.kind, slot)
        ? { textureId: preview!.textureId }
        : lookOf(store.resolved(id, index, slot).skin, bare);
    }
    return {
      index,
      kind: row.kind,
      size: row.size,
      x: piece.x, y: piece.y, z: piece.z, yawDegrees: piece.yawDegrees,
      edit: piece.edit,
      faces,
      selected: index === sel,
      ...(piece.cells ? { cells: piece.cells } : {}),
    };
  });
}

/** every material id the stage must mount a TextureCapture for */
export function stageTextureIds(pieces: PieceRender[]): string[] {
  const ids: string[] = [];
  for (const piece of pieces) {
    for (const slot of BUILD_FACE_SLOTS) {
      const tex = piece.faces[slot].textureId;
      if (tex && !ids.includes(tex)) ids.push(tex);
    }
  }
  return ids;
}
