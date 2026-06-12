// editors/workbench/buildings/store.ts — the BUILDING source's headless store
// (BUILDSKIN-0606).
//
// A saved PREFAB is a BUILDING TYPE: the roster is the prefab table (static
// seeds + world-saved clones, world wins same-id — the stream's own law) and
// every edit here — a skin, a swap, a remove, an add — is ONE `prefabDefined`
// commit on the V20 world channel carrying the full updated def. Buildings
// stay LIVE EDITABLE STRUCTURES ("nothing is immutable"); the stream's
// newest-meaning rule means editing a seed shadows it without touching code.
//
// THE SKIN LAW (the dispatch's non-negotiable): the skin vocabulary IS the
// material system. A face skin is the mesh's native base COLOR or a MATERIAL
// — a textureKey into THE texture registry. Material EXISTENCE is validated
// HERE (deps.validMaterial — live = game/textures textureById; tests fake
// it); the pure model (game/build/skins.ts) owns shape + resolution.
//
// Resolution order (user law, resolveFaceSkin): piece override > type global
// > bare catalog look. Overrides ride the PrefabPiece, so structure edits
// never detach a skin from its piece.

import {
  BUILD_PREFAB_DEFINITIONS,
  catalogEntry,
  faceSlotLabels,
  FLOOR_GRID,
  isCatalogId,
  isWallEdit,
  resolveFaceSkin,
  setFloorCell,
  skinAllSlots,
  validatePrefab,
  type BuildFaceSkin,
  type BuildFaceSlot,
  type BuildPieceKind,
  type BuildPrefabDef,
  type BuildSkinSet,
  type FloorCell,
  type PrefabPiece,
  type ResolvedFaceSkin,
  type WallEdit,
} from '../../../game/build';
import type { WorldEvent, WorldStreamState } from '../../../game/world/stream';
import type { MaterialChoice } from '../materials/chooser';

export type BuildingsSession = {
  commit(event: WorldEvent, label: string): void;
};

export type BuildingsStoreDeps = {
  /** the world stream's materialized state (world-saved prefabs); null = store down */
  world: () => WorldStreamState | null;
  session: BuildingsSession | null;
  /** why the store is down (the census store-unavailable convention) */
  error: string | null;
  /** does this id resolve in THE texture registry? (live: textureById) */
  validMaterial(id: string): boolean;
  /** the registry's assignable materials, for the panel's picker */
  materials(): MaterialChoice[];
};

export type BuildingRow = { id: string; label: string; pieceCount: number };

/** 'all' = every slot in one action (the user's "all walls → green") */
export type SkinSlotTarget = BuildFaceSlot | 'all';
export type BuildingsLens = 'model' | 'materials' | 'paint';
export type BuildingSkinScope =
  | { kind: 'type'; pieceKind: BuildPieceKind }
  | { kind: 'piece'; index: number };
export type BuildingPaintTarget = {
  buildingId: string;
  scope: BuildingSkinScope;
  slot: SkinSlotTarget;
  label: string;
  materialId: string | null;
  underlayId?: string | null;
};

export type BuildingsStore = {
  deps: BuildingsStoreDeps;
  /** the roster: every prefab-building with its total piece count */
  buildings(): BuildingRow[];
  /** the merged def — world-saved wins over a same-id static seed */
  building(id: string): BuildPrefabDef | null;
  // ── skins (the material system, two scopes, per-face) ─────────────────────
  setTypeSkin(id: string, kind: BuildPieceKind, target: SkinSlotTarget, skin: BuildFaceSkin | null): void;
  setPieceSkin(id: string, index: number, target: SkinSlotTarget, skin: BuildFaceSkin | null): void;
  /** piece override > type global > bare — with provenance */
  resolved(id: string, index: number, slot: BuildFaceSlot): ResolvedFaceSkin;
  /** compact panel view state: which face row a type/piece skin group edits */
  skinTarget(id: string, scope: BuildingSkinScope): SkinSlotTarget;
  setSkinTarget(id: string, scope: BuildingSkinScope, target: SkinSlotTarget): void;
  /** PANELGRAMMAR-0610 (§11.2): the ONE type-globals group edits one piece
   *  CLASS at a time — this is that selector's view state (null = the panel
   *  defaults to the first kind present) */
  skinClass(id: string): BuildPieceKind | null;
  setSkinClass(id: string, kind: BuildPieceKind): void;
  /** a paint lens target selected from the panel */
  paintTarget(): BuildingPaintTarget | null;
  setPaintTarget(target: BuildingPaintTarget | null): void;
  setPaintTargetSlot(slot: SkinSlotTarget): void;
  setPaintTargetSkin(target: BuildingPaintTarget, skin: BuildFaceSkin | null): void;
  applyPaintTargetSkin(skin: BuildFaceSkin | null): boolean;
  /** stage click: selection + active face + material browser target move together */
  selectPieceTarget(id: string, index: number, slot: BuildFaceSlot): void;
  lens(): BuildingsLens;
  setLens(lens: BuildingsLens): void;
  // ── structure (nothing is immutable) ───────────────────────────────────────
  swapPiece(id: string, index: number, pieceId: string): void;
  setPieceEdit(id: string, index: number, edit: WallEdit | null): void;
  setPiecePlacement(id: string, index: number, patch: Partial<Pick<PrefabPiece, 'x' | 'y' | 'z' | 'yawDegrees'>>): void;
  /** MICROGRID-0610: paint one of a floor piece's 3×3 cells (row-major 0..8;
   *  null = back to the material default; all-default drops the field) */
  setPieceFloorCell(id: string, index: number, cellIndex: number, kind: FloorCell): void;
  removePiece(id: string, index: number): void;
  addPiece(id: string, pieceId: string): void;
  renameBuilding(id: string, label: string): void;
  // ── delete the whole building (req_0184 addendum) — two-step ──────────────
  /** first call ARMS (returns false); the second call within the armed state
   *  executes (returns true). Any other mutation/selection disarms. */
  deleteBuilding(id: string): boolean;
  /** the building whose delete is armed (the panel renders ⚠ confirm) */
  armedDelete(): string | null;
  // ── selection (view state: -1 = building scope, else a piece index) ───────
  selectedPiece(id: string): number;
  selectPiece(id: string, index: number): void;
  /** stage click-picks + mutations tick here so the frame re-reads */
  subscribe(fn: () => void): () => void;
  error(): string | null;
};

function describeSkin(skin: BuildFaceSkin | null): string {
  if (!skin) return 'bare';
  return skin.kind === 'color' ? skin.value : skin.id;
}

export function createBuildingsStore(deps: BuildingsStoreDeps): BuildingsStore {
  // ephemeral view state: the piece the panel's override section edits
  const selection: Record<string, number> = {};
  const skinTargets: Record<string, SkinSlotTarget> = {};
  const skinClasses: Record<string, BuildPieceKind> = {};
  const localPrefabs: Record<string, BuildPrefabDef> = {};
  const localRemoved = new Set<string>();
  let paintTarget: BuildingPaintTarget | null = null;
  let lens: BuildingsLens = 'model';
  // req_0184 addendum: the two-step delete's armed id — any other mutation
  // or selection change disarms (a destructive verb never fires by surprise)
  let armed: string | null = null;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const fn of Array.from(listeners)) {
      try { fn(); } catch { /* a dead subscriber never kills the store */ }
    }
  };

  const merged = (): Record<string, BuildPrefabDef> => {
    const world = deps.world();
    const removed = new Set(world?.removedPrefabs ?? []);
    for (const id of localRemoved) removed.add(id);
    const all = { ...BUILD_PREFAB_DEFINITIONS, ...(world?.prefabs ?? {}), ...localPrefabs };
    for (const id of removed) delete all[id]; // tombstones beat seeds AND copies
    return all;
  };

  const building = (id: string): BuildPrefabDef | null => merged()[id] ?? null;

  const scopeKey = (id: string, scope: BuildingSkinScope): string =>
    scope.kind === 'type' ? `${id}/type/${scope.pieceKind}` : `${id}/piece/${scope.index}`;

  const must = (id: string): BuildPrefabDef => {
    const def = building(id);
    if (!def) throw new Error(`buildings: unknown building '${id}'`);
    return def;
  };

  const mustPiece = (def: BuildPrefabDef, index: number): PrefabPiece => {
    const piece = def.pieces[index];
    if (!piece) throw new Error(`buildings: ${def.id} has no piece #${index}`);
    return piece;
  };

  const checkSkin = (skin: BuildFaceSkin | null): void => {
    if (skin && skin.kind === 'material' && !deps.validMaterial(skin.id)) {
      throw new Error(`buildings: '${skin.id}' is not a registry material — skins assign THE material system`);
    }
  };

  /** the one write path: validate, then ONE prefabDefined commit (full def) */
  const redefine = (def: BuildPrefabDef, label: string): void => {
    const problems = validatePrefab(def);
    if (problems.length > 0) throw new Error(`buildings: refusing a malformed def — ${problems[0]}`);
    deps.session?.commit({ kind: 'prefabDefined', def }, label);
    localPrefabs[def.id] = def;
    localRemoved.delete(def.id);
    armed = null; // any edit disarms a pending delete
    notify();
  };

  const withSlots = (set: BuildSkinSet | undefined, target: SkinSlotTarget, skin: BuildFaceSkin | null): BuildSkinSet | undefined => {
    if (target === 'all') {
      if (skin === null) return undefined; // clear the whole set
      return skinAllSlots(skin);
    }
    const next: BuildSkinSet = { ...(set ?? {}) };
    if (skin === null) delete next[target];
    else next[target] = skin;
    return Object.keys(next).length > 0 ? next : undefined;
  };

  const sameSkin = (a: BuildFaceSkin | null, b: BuildFaceSkin | null): boolean => {
    if (a === null || b === null) return a === b;
    if (a.kind !== b.kind) return false;
    return a.kind === 'color' ? a.value === (b as { value: string }).value : a.id === (b as { id: string }).id;
  };

  const scopedSkin = (id: string, scope: BuildingSkinScope, slot: BuildFaceSlot): BuildFaceSkin | null => {
    const def = must(id);
    if (scope.kind === 'type') return def.skins?.[scope.pieceKind]?.[slot] ?? null;
    return mustPiece(def, scope.index).skin?.[slot] ?? null;
  };

  const targetSkin = (id: string, scope: BuildingSkinScope, target: SkinSlotTarget): BuildFaceSkin | null => {
    if (target !== 'all') return scopedSkin(id, scope, target);
    const [first, ...rest] = (['front', 'back', 'sides'] as BuildFaceSlot[]).map((slot) => scopedSkin(id, scope, slot));
    return rest.every((skin) => sameSkin(first, skin)) ? first : null;
  };

  const targetLabel = (id: string, scope: BuildingSkinScope, target: SkinSlotTarget): string => {
    const kind = scope.kind === 'type' ? scope.pieceKind : catalogEntry(mustPiece(must(id), scope.index).pieceId).kind;
    const labels = faceSlotLabels(kind);
    if (scope.kind === 'type') return target === 'all' ? 'all faces' : labels[target];
    return target === 'all' ? 'override all' : `override ${labels[target]}`;
  };

  const normalizedTarget = (target: BuildingPaintTarget): BuildingPaintTarget => {
    const skin = targetSkin(target.buildingId, target.scope, target.slot);
    let underlayId: string | null = null;
    if (target.scope.kind === 'piece' && target.slot !== 'all') {
      const def = must(target.buildingId);
      const piece = mustPiece(def, target.scope.index);
      const kind = catalogEntry(piece.pieceId).kind;
      const inherited = def.skins?.[kind]?.[target.slot];
      underlayId = inherited?.kind === 'material' ? inherited.id : null;
    }
    return {
      ...target,
      label: targetLabel(target.buildingId, target.scope, target.slot),
      materialId: skin?.kind === 'material' ? skin.id : null,
      underlayId,
    };
  };

  const writeTargetSkin = (target: BuildingPaintTarget, skin: BuildFaceSkin | null): void => {
    checkSkin(skin);
    const def = must(target.buildingId);
    if (target.scope.kind === 'type') {
      const skins = { ...(def.skins ?? {}) };
      const nextSet = withSlots(skins[target.scope.pieceKind], target.slot, skin);
      if (nextSet === undefined) delete skins[target.scope.pieceKind];
      else skins[target.scope.pieceKind] = nextSet;
      redefine({ ...def, skins: Object.keys(skins).length > 0 ? skins : undefined },
        `${def.label}: ${target.label} → ${describeSkin(skin)}`);
      return;
    }
    const piece = mustPiece(def, target.scope.index);
    const nextSkin = withSlots(piece.skin, target.slot, skin);
    const pieces = [...def.pieces];
    pieces[target.scope.index] = { ...piece, skin: nextSkin };
    if (nextSkin === undefined) delete (pieces[target.scope.index] as any).skin;
    redefine({ ...def, pieces }, `${def.label}: ${target.label} → ${describeSkin(skin)}`);
  };

  return {
    deps,
    buildings(): BuildingRow[] {
      const defs = merged();
      return Object.keys(defs).map((id) => ({
        id,
        label: defs[id].label,
        pieceCount: defs[id].pieces.length,
      }));
    },
    building,

    setTypeSkin(id, kind, target, skin): void {
      checkSkin(skin);
      const def = must(id);
      const skins = { ...(def.skins ?? {}) };
      const nextSet = withSlots(skins[kind], target, skin);
      if (nextSet === undefined) delete skins[kind];
      else skins[kind] = nextSet;
      const next: BuildPrefabDef = { ...def, skins: Object.keys(skins).length > 0 ? skins : undefined };
      redefine(next, `${def.label}: ${kind}s ${target === 'all' ? '' : `${target} `}→ ${describeSkin(skin)}`);
    },

    setPieceSkin(id, index, target, skin): void {
      checkSkin(skin);
      const def = must(id);
      const piece = mustPiece(def, index);
      const nextSkin = withSlots(piece.skin, target, skin);
      const pieces = [...def.pieces];
      pieces[index] = { ...piece, skin: nextSkin };
      if (nextSkin === undefined) delete (pieces[index] as any).skin;
      redefine({ ...def, pieces }, `${def.label}: piece #${index} ${target === 'all' ? '' : `${target} `}→ ${describeSkin(skin)}`);
    },

    resolved(id, index, slot): ResolvedFaceSkin {
      const def = must(id);
      const piece = mustPiece(def, index);
      return resolveFaceSkin(def.skins, catalogEntry(piece.pieceId).kind, piece.skin, slot);
    },
    skinTarget(id, scope): SkinSlotTarget {
      return skinTargets[scopeKey(id, scope)] ?? 'all';
    },
    setSkinTarget(id, scope, target): void {
      skinTargets[scopeKey(id, scope)] = target;
      armed = null;
      notify();
    },
    skinClass(id): BuildPieceKind | null {
      return skinClasses[id] ?? null;
    },
    setSkinClass(id, kind): void {
      skinClasses[id] = kind;
      armed = null;
      notify();
    },
    paintTarget: () => paintTarget,
    setPaintTarget(target): void {
      if (target) skinTargets[scopeKey(target.buildingId, target.scope)] = target.slot;
      paintTarget = target ? normalizedTarget(target) : null;
      armed = null;
      notify();
    },
    setPaintTargetSlot(slot): void {
      if (!paintTarget) return;
      const target = { ...paintTarget, slot };
      skinTargets[scopeKey(target.buildingId, target.scope)] = slot;
      paintTarget = normalizedTarget(target);
      armed = null;
      notify();
    },
    setPaintTargetSkin(target, skin): void {
      writeTargetSkin(target, skin);
      skinTargets[scopeKey(target.buildingId, target.scope)] = target.slot;
      paintTarget = { ...target, materialId: skin?.kind === 'material' ? skin.id : null };
      notify();
    },
    applyPaintTargetSkin(skin): boolean {
      if (!paintTarget) return false;
      const target = paintTarget;
      writeTargetSkin(target, skin);
      skinTargets[scopeKey(target.buildingId, target.scope)] = target.slot;
      paintTarget = { ...target, materialId: skin?.kind === 'material' ? skin.id : null };
      notify();
      return true;
    },
    selectPieceTarget(id, index, slot): void {
      const def = must(id);
      mustPiece(def, index);
      const scope: BuildingSkinScope = { kind: 'piece', index };
      selection[id] = index;
      skinTargets[scopeKey(id, scope)] = slot;
      paintTarget = normalizedTarget({
        buildingId: id,
        scope,
        slot,
        label: '',
        materialId: null,
      });
      armed = null;
      notify();
    },
    lens: () => lens,
    setLens(next): void {
      lens = next;
      notify();
    },

    swapPiece(id, index, pieceId): void {
      if (!isCatalogId(pieceId)) throw new Error(`buildings: unknown catalog piece '${pieceId}'`);
      const def = must(id);
      const piece = mustPiece(def, index);
      const pieces = [...def.pieces];
      // a swap KEEPS placement + skin (the override rides the piece); the edit
      // drops when the new kind takes none (validatePrefab would refuse it)
      const keepEdit = catalogEntry(pieceId).kind === 'wall' ? piece.edit : undefined;
      pieces[index] = { ...piece, pieceId, ...(keepEdit !== undefined ? { edit: keepEdit } : {}) };
      if (keepEdit === undefined) delete (pieces[index] as any).edit;
      redefine({ ...def, pieces }, `${def.label}: piece #${index} → ${pieceId}`);
    },

    setPieceEdit(id, index, edit): void {
      if (edit !== null && !isWallEdit(edit)) throw new Error(`buildings: unknown edit '${edit}'`);
      const def = must(id);
      const piece = mustPiece(def, index);
      const pieces = [...def.pieces];
      pieces[index] = { ...piece, ...(edit !== null ? { edit } : {}) };
      if (edit === null) delete (pieces[index] as any).edit;
      redefine({ ...def, pieces }, `${def.label}: piece #${index} edit → ${edit ?? 'none'}`);
    },

    setPiecePlacement(id, index, patch): void {
      const def = must(id);
      const piece = mustPiece(def, index);
      const pieces = [...def.pieces];
      pieces[index] = { ...piece, ...patch };
      redefine({ ...def, pieces }, `${def.label}: piece #${index} moved`);
    },

    setPieceFloorCell(id, index, cellIndex, kind): void {
      const def = must(id);
      const piece = mustPiece(def, index);
      if (catalogEntry(piece.pieceId).kind !== 'floor') throw new Error('buildings: cells live on floor pieces only');
      const next = setFloorCell(piece.cells, cellIndex % FLOOR_GRID, Math.floor(cellIndex / FLOOR_GRID), kind);
      const pieces = [...def.pieces];
      // all-default collapses back to "no cells field" — older defs stay the
      // canonical shape and the nav bake's material-default path covers them
      const allDefault = next.every((c) => c === null);
      pieces[index] = { ...piece };
      if (allDefault) delete pieces[index].cells;
      else pieces[index].cells = next;
      redefine({ ...def, pieces }, `${def.label}: piece #${index} cell ${cellIndex} → ${kind ?? 'default'}`);
    },

    removePiece(id, index): void {
      const def = must(id);
      mustPiece(def, index);
      const pieces = def.pieces.filter((_, i) => i !== index);
      redefine({ ...def, pieces }, `${def.label}: − piece #${index}`);
      const sel = selection[id] ?? -1;
      if (sel === index) selection[id] = -1;
      else if (sel > index) selection[id] = sel - 1;
    },

    addPiece(id, pieceId): void {
      if (!isCatalogId(pieceId)) throw new Error(`buildings: unknown catalog piece '${pieceId}'`);
      const def = must(id);
      const pieces = [...def.pieces, { pieceId, x: 0, y: 0, z: 0, yawDegrees: 0 }];
      redefine({ ...def, pieces }, `${def.label}: + ${pieceId}`);
      selection[id] = pieces.length - 1;
    },

    renameBuilding(id, label): void {
      const def = must(id);
      const name = label.trim();
      if (!name) return;
      redefine({ ...def, label: name }, `${def.label} → ${name}`);
    },

    deleteBuilding(id): boolean {
      must(id); // unknown ids are loud, armed or not
      if (armed !== id) {
        armed = id; // step 1: ARM — the panel re-renders ⚠ confirm
        notify();
        return false;
      }
      // step 2: the confirmed click — ONE prefabRemoved commit. The skins
      // live INSIDE the def (def.skins + pieces[].skin), so they die with
      // it atomically — nothing orphaned by construction.
      const def = must(id);
      deps.session?.commit({ kind: 'prefabRemoved', id }, `− building ${def.label} (${def.pieces.length} pieces)`);
      armed = null;
      delete selection[id]; // the only other state keyed by building id
      delete localPrefabs[id];
      localRemoved.add(id);
      for (const key of Object.keys(skinTargets)) if (key.startsWith(`${id}/`)) delete skinTargets[key];
      if (paintTarget?.buildingId === id) paintTarget = null;
      notify();
      return true;
    },
    armedDelete: () => armed,

    selectedPiece(id): number {
      const sel = selection[id] ?? -1;
      const def = building(id);
      return def && sel >= 0 && sel < def.pieces.length ? sel : -1;
    },
    selectPiece(id, index): void {
      selection[id] = index;
      armed = null; // moving on disarms
      notify();
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    error: () => deps.error,
  };
}
