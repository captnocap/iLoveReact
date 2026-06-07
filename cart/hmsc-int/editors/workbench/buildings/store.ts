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
  isCatalogId,
  isWallEdit,
  resolveFaceSkin,
  skinAllSlots,
  validatePrefab,
  type BuildFaceSkin,
  type BuildFaceSlot,
  type BuildPieceKind,
  type BuildPrefabDef,
  type BuildSkinSet,
  type PrefabPiece,
  type ResolvedFaceSkin,
  type WallEdit,
} from '../../../game/build';
import type { WorldEvent, WorldStreamState } from '../../../game/world/stream';

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
  materials(): Array<{ id: string; label: string }>;
};

export type BuildingRow = { id: string; label: string; pieceCount: number };

/** 'all' = every slot in one action (the user's "all walls → green") */
export type SkinSlotTarget = BuildFaceSlot | 'all';

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
  // ── structure (nothing is immutable) ───────────────────────────────────────
  swapPiece(id: string, index: number, pieceId: string): void;
  setPieceEdit(id: string, index: number, edit: WallEdit | null): void;
  setPiecePlacement(id: string, index: number, patch: Partial<Pick<PrefabPiece, 'x' | 'y' | 'z' | 'yawDegrees'>>): void;
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
    const all = { ...BUILD_PREFAB_DEFINITIONS, ...(world?.prefabs ?? {}) };
    for (const id of removed) delete all[id]; // tombstones beat seeds AND copies
    return all;
  };

  const building = (id: string): BuildPrefabDef | null => merged()[id] ?? null;

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
