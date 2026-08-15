// editor/data/persistView.ts — keep the active view alive across dev hot reloads.
//
// Saving a .tsx file tears down the JS context and re-evals a fresh bundle,
// which normally resets all React state (you lose which folder/model/material
// you were looking at). useHotState persists atoms in Zig-owned memory
// (framework/state/hotstate.zig) that outlives the teardown, so we mirror the
// editor VIEW into one atom and rehydrate it on boot. Map-authored slices are
// redacted: named document files are their only truth.
//
// Survives hot reload and the dev supervisor's managed exact-child replacement.
// A genuinely separate cold launch still starts clean because only the
// supervisor supplies a one-shot handoff. World CONTENT is different
// (SESSIONSAVE req_2765):
// placed pieces / zone defs / the id seq rehydrate from the on-disk world save
// (data/worldStore.ts) so a session's building survives the restart; the
// painted map reloads host-side from its RMAP on the same boot.
import { getHotState, setHotState } from '../../../runtime/hooks/useHotState';
import { initialState, defaultModelTool } from './initialState';
import { setAuthoredPieces } from '../world/authoredRegistry';
import { readWorldSave } from './worldStore';
import { createMapDocument, mapDocumentName, setActiveMapDocumentStem } from './mapDocuments';
import { loadGlobalsSave } from './globalsStore';
import { loadColorLibrary } from './colorLibraryStore';
import { starterPaletteSets } from './colorSpine';
import { loadLabRecipes } from './labRecipeStore';
import { loadLibraryHistory } from './libraryHistoryStore';
import { commandExists, MENUS } from './commands';
import { HOME_DOCUMENT, HOME_DOCUMENT_ID, WORLD_DOCUMENT_ID } from './documents';
import { normalizeContentFolderId, normalizeLeftPanelId, normalizeRightPanelId } from './panelSystem';
import type { EditorState } from './types';
import {
  cloneArchitectureSource,
  DEFAULT_ARCHITECTURE_TOOL,
  EMPTY_ARCHITECTURE_SELECTION,
} from '../world/architecture';

const VIEW_HOT_KEY = 'editor:view:v2';
const MODEL_WORK_HOT_KEY = 'editor:model-work:v1';

type ModelWorkHot = Pick<EditorState, 'modelParts' | 'modelRigs' | 'modelTextureSlots' | 'modelLights'>;
let lastModelParts: EditorState['modelParts'] | null = null;
let lastModelRigs: EditorState['modelRigs'] | null = null;
let lastModelTextureSlots: EditorState['modelTextureSlots'] | null = null;
let lastModelLights: EditorState['modelLights'] | null = null;

// Transient surfaces that should NOT spring back open after a reload — even if
// a menu/dialog/popover was open when the reload fired, the rehydrated view
// starts with them closed.
const RESET_ON_RELOAD: Partial<EditorState> = {
  openMenu: null,
  presetMenuOpen: false,
  contextOpen: false,
  buildDialogOpen: false,
  mapDocumentOpen: false,
  addChunkOpen: false,
  eventbusPopoverOpen: false,
  perfPopoverOpen: false,
  memoryPopoverOpen: false,
  fileExplorerOpen: false,
  // Explorer folder/file ids come from the live disk index, which rebuilds on every
  // reload — a persisted id may not exist in the fresh scan, so start at the root.
  fileExplorerFolder: 'all',
  fileExplorerSelectedId: '',
  // Tool state is owned by the (re-mounted) model viewer; start from its default
  // so the toolbar highlight matches a freshly re-mounted, view-mode viewer.
  modelTool: defaultModelTool(),
};

/** Boot state: the on-disk world save materialized into fresh defaults, then
 *  the persisted view merged over it (so fields added since the last save get
 *  their defaults), with transient overlays forced closed. Cold start = named
 *  world save only; hot reload may restore chrome/view fields, while durable
 *  map-authored slices always remain the named document's values. */
export function loadPersistedState(): EditorState {
  const base = initialState();
  // The authored registry must be live BEFORE the world parse (req_4474): the
  // pre-v5 wall drop (worldStore req_4462) asks isWallPiece, which resolves
  // authored pieces' kinds through this registry. Populated only by AppFrame's
  // post-render effect, an authored wall-kind piece parsed as kind-unknown here,
  // survived the load, and then poisoned EVERY save — writeWorldSave (registry
  // live by then) refused the whole snapshot, so the map could never persist.
  setAuthoredPieces(base.authoredBuildPieces);
  let load = readWorldSave(base.activeMapStem);
  let bootStatus: string | null = null;
  if (load.status === 'invalid') {
    const damagedStem = base.activeMapStem;
    const damageError = load.error;
    try {
      const recoveryStem = createMapDocument(`${damagedStem}-recovery`);
      if (!setActiveMapDocumentStem(recoveryStem)) throw new Error('could not commit the recovery pointer');
      base.activeMapStem = recoveryStem;
      base.activeMapName = mapDocumentName(recoveryStem);
      bootStatus = `${damagedStem}/world.json is malformed and was preserved (${damageError}); opened clean recovery map ${recoveryStem}`;
      load = { status: 'missing', save: null, migratedLegacy: false };
    } catch (error) {
      // readWorldSave write-protected the malformed stem, so the debounce below
      // cannot overwrite it even when recovery allocation itself is unavailable.
      bootStatus = `${damagedStem}/world.json is malformed and write-protected (${damageError}); recovery failed: ${(error as Error).message}`;
    }
  }
  const world = load.status === 'ok' ? load.save : null;
  if (world) {
    base.architecture = cloneArchitectureSource(world.architecture);
    base.worldPieces = world.pieces;
    base.worldFlora = world.worldFlora;
    base.worldPrefabs = world.prefabs;
    base.worldFacades = world.facades;
    base.worldViews = world.views;
    base.objects = world.objects;
    base.selectedObjectId = world.objects.find((object) => !object.hidden)?.id ?? 'obj-tile';
    base.seq = Math.max(base.seq, world.seq);
    if (world.zones.length) base.mapPaint = { ...base.mapPaint, zones: world.zones };
  } else {
    // INITIAL_OBJECTS is an old view placeholder, not content for a genuinely
    // empty named map. Do not let the first micro-save turn it into authoring.
    base.objects = [];
    base.selectedObjectId = 'obj-tile';
  }
  // Tuned globals rehydrate from their own per-concern save (GLOBALS req_2770) —
  // a locked-in jump height survives the cold restart like placed pieces do.
  const globals = loadGlobalsSave();
  if (globals) base.worldGlobals = globals;
  // Saved colors + the raw use-history + named sets rehydrate from the color
  // library save (req_3097/req_4395) — a saved color is a real save, not a
  // session-lifetime illusion. A file that predates named sets (sets: null)
  // seeds the deletable starters exactly once; from then on the file rules.
  const colorLibrary = loadColorLibrary();
  if (colorLibrary) {
    base.colorSpinePalette = colorLibrary.saved;
    base.colorSpineRecents = colorLibrary.recents;
    base.colorSpineSets = colorLibrary.sets ?? starterPaletteSets();
  } else {
    base.colorSpineSets = starterPaletteSets();
  }
  // Material Lab recipe documents (req_4395) — the same per-concern contract.
  const labRecipes = loadLabRecipes();
  if (labRecipes) base.labRecipes = labRecipes;
  // Asset/model use history is editor-wide user state. Unlike ordinary view
  // chrome it survives a cold process restart through its per-concern save.
  const libraryHistory = loadLibraryHistory();
  if (libraryHistory) base.recentLibraryKeys = libraryHistory;
  const saved = getHotState<Partial<EditorState> | null>(VIEW_HOT_KEY, null);
  const modelWork = getHotState<Partial<ModelWorkHot> | null>(MODEL_WORK_HOT_KEY, null);
  if (!saved) {
    // COLD START. Open on HOME (req_4435) — the resume board, where the
    // previous session, the real map list and New all live. The world tab is
    // loaded behind it so Continue and a map click are both one press away,
    // but nothing about the world is presented as chosen until it is.
    // Repro door, same pattern as RJIT_MODELDOC / RJIT_EDKEYS elsewhere in this
    // cart: `RJIT_BOOT_DOC=world` starts past Home so a headless shot can verify
    // the world surface's own cold state. Home is still opened as a tab — the
    // door changes which one is in front, never what exists.
    const bootDoc = (globalThis as any).__env_get?.('RJIT_BOOT_DOC') as string | null | undefined;
    base.workspaceDocuments = [HOME_DOCUMENT, ...base.workspaceDocuments];
    base.activeWorkspaceDocumentId = bootDoc === 'world' ? WORLD_DOCUMENT_ID : HOME_DOCUMENT_ID;
    if (bootStatus) base.status = bootStatus;
    else if (world?.pieces.length) base.status = `${base.activeMapName} loaded — ${world.pieces.length} placed piece${world.pieces.length === 1 ? '' : 's'} from its world save`;
    else base.status = `${base.activeMapName} loaded`;
    return base;
  }
  // Hot state is a VIEW cache, never a second world store. In particular, do
  // not let the prior map's pieces/zones/binding table or selections cross the
  // named document boundary. The durable per-document files above are the only
  // source for those slices.
  const savedPaint = saved.mapPaint;
  // v2 hot memory may contain UI concepts that no longer exist. Strip removed
  // shape before merging so a code update cannot keep a phantom field alive.
  const savedView = { ...saved } as Partial<EditorState> & { viewMode?: unknown };
  delete savedView.viewMode;
  const merged: EditorState = {
    ...base,
    ...savedView,
    ...(modelWork ?? {}),
    ...RESET_ON_RELOAD,
    activeMapStem: base.activeMapStem,
    activeMapName: base.activeMapName,
    architecture: base.architecture,
    architectureSelection: EMPTY_ARCHITECTURE_SELECTION,
    architectureTool: DEFAULT_ARCHITECTURE_TOOL,
    worldPieces: base.worldPieces,
    worldFlora: base.worldFlora,
    worldPrefabs: base.worldPrefabs,
    worldFacades: base.worldFacades,
    worldViews: base.worldViews,
    activeWorldViewId: null,
    worldViewRecallNonce: 0,
    objects: base.objects,
    selectedObjectId: base.selectedObjectId,
    selectedPieceId: null,
    selectedPieceIds: [],
    armedStamp: null,
    worldUndo: [],
    worldRedo: [],
    mapPaint: {
      ...base.mapPaint,
      ...(savedPaint ?? {}),
      active: false,
      texturePickerOpen: false,
      zones: base.mapPaint.zones,
      // painting.rmap is authoritative; ensureMapSeeded mirrors this table when
      // Map Paint is armed. A hot table may belong to another document.
      tileBindings: [],
      zoneIdx: base.mapPaint.zones.length ? Math.min(savedPaint?.zoneIdx ?? 0, base.mapPaint.zones.length - 1) : 0,
      tileBindIdx: -1,
    },
    status: bootStatus ?? 'restored your last view',
  };
  // Removed commands/menus and their placeholder navigation projections may be
  // selected at the instant a dev reload lands. Re-enter through real defaults.
  if (!commandExists(merged.activeCommandId)) merged.activeCommandId = 'select-tool';
  if (!MENUS.includes(merged.actionMenu)) merged.actionMenu = 'Build';
  merged.activeDomain = normalizeLeftPanelId(merged.activeDomain);
  merged.rightPane = normalizeRightPanelId(merged.rightPane);
  merged.contentFolder = normalizeContentFolderId(merged.contentFolder);
  merged.libraryCollectionReturnFolder = normalizeContentFolderId(merged.libraryCollectionReturnFolder);
  // The id seq only ever grows: a stale hotstate seq must not re-mint ids the
  // disk save already handed out.
  merged.seq = Math.max(merged.seq, base.seq);
  return merged;
}

/** Mirror the current state into the hot atom so the next reload can rehydrate. */
export function persistState(state: EditorState): void {
  // Model part seeds can contain large typed vertex arrays. They are a separate
  // twig written only when that authored structure actually changes; colour
  // drags, camera/tool state, and selection no longer stringify it repeatedly.
  if (state.modelParts !== lastModelParts || state.modelRigs !== lastModelRigs || state.modelTextureSlots !== lastModelTextureSlots || state.modelLights !== lastModelLights) {
    lastModelParts = state.modelParts;
    lastModelRigs = state.modelRigs;
    lastModelTextureSlots = state.modelTextureSlots;
    lastModelLights = state.modelLights;
    setHotState<ModelWorkHot>(MODEL_WORK_HOT_KEY, {
      modelParts: state.modelParts,
      modelRigs: state.modelRigs,
      modelTextureSlots: state.modelTextureSlots,
      modelLights: state.modelLights,
    });
  }

  const {
    modelParts: _modelParts,
    modelRigs: _modelRigs,
    modelTextureSlots: _modelTextureSlots,
    modelLights: _modelLights,
    history: _history,
    redo: _redo,
    worldUndo: _worldUndo,
    worldRedo: _worldRedo,
    architecture: _architecture,
    architectureSelection: _architectureSelection,
    architectureTool: _architectureTool,
    ...view
  } = state;
  // Store the chrome/view shape but redact every per-map authored slice. This
  // makes stale hot memory incapable of resurrecting pieces after New/Open.
  setHotState(VIEW_HOT_KEY, {
    ...view,
    worldPieces: [],
    worldFlora: [],
    worldPrefabs: [],
    worldFacades: [],
    worldViews: [],
    activeWorldViewId: null,
    worldViewRecallNonce: 0,
    objects: [],
    selectedObjectId: 'obj-tile',
    selectedPieceId: null,
    selectedPieceIds: [],
    armedStamp: null,
    worldUndo: [],
    worldRedo: [],
    mapPaint: {
      ...state.mapPaint,
      active: false,
      texturePickerOpen: false,
      zones: [],
      tileBindings: [],
      zoneIdx: 0,
      tileBindIdx: -1,
    },
  });
}
