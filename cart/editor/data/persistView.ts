// editor/data/persistView.ts — keep the active view alive across dev hot reloads.
//
// Saving a .tsx file tears down the JS context and re-evals a fresh bundle,
// which normally resets all React state (you lose which folder/model/material
// you were looking at). useHotState persists atoms in Zig-owned memory
// (framework/state/hotstate.zig) that outlives the teardown, so we mirror the
// editor VIEW into one atom and rehydrate it on boot. Map-authored slices are
// redacted: named document files are their only truth.
//
// Survives hot reload; resets on a cold process restart (hotstate is
// in-process) — which is the wanted behaviour for VIEW state: a fresh launch
// starts with clean chrome. World CONTENT is different (SESSIONSAVE req_2765):
// placed pieces / zone defs / the id seq rehydrate from the on-disk world save
// (data/worldStore.ts) so a session's building survives the restart; the
// painted map reloads host-side from its RMAP on the same boot.
import { getHotState, setHotState } from '../../../runtime/hooks/useHotState';
import { initialState, defaultModelTool } from './initialState';
import { readWorldSave } from './worldStore';
import { createMapDocument, mapDocumentName, setActiveMapDocumentStem } from './mapDocuments';
import { loadGlobalsSave } from './globalsStore';
import { commandExists, MENUS } from './commands';
import type { EditorState } from './types';

const VIEW_HOT_KEY = 'editor:view:v2';
const MODEL_WORK_HOT_KEY = 'editor:model-work:v1';

type ModelWorkHot = Pick<EditorState, 'modelParts' | 'modelRigs'>;
let lastModelParts: EditorState['modelParts'] | null = null;
let lastModelRigs: EditorState['modelRigs'] | null = null;

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
    base.worldPieces = world.pieces;
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
  const saved = getHotState<Partial<EditorState> | null>(VIEW_HOT_KEY, null);
  const modelWork = getHotState<Partial<ModelWorkHot> | null>(MODEL_WORK_HOT_KEY, null);
  if (!saved) {
    if (bootStatus) base.status = bootStatus;
    else if (world?.pieces.length) base.status = `restored world — ${world.pieces.length} placed piece${world.pieces.length === 1 ? '' : 's'} from the world save`;
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
    worldPieces: base.worldPieces,
    objects: base.objects,
    selectedObjectId: base.selectedObjectId,
    selectedPieceId: null,
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
  if (merged.activeDomain === 'pipeline') merged.activeDomain = 'world';
  if (merged.rightPane === 'mission' || merged.rightPane === 'routes') merged.rightPane = 'inspector';
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
  if (state.modelParts !== lastModelParts || state.modelRigs !== lastModelRigs) {
    lastModelParts = state.modelParts;
    lastModelRigs = state.modelRigs;
    setHotState<ModelWorkHot>(MODEL_WORK_HOT_KEY, {
      modelParts: state.modelParts,
      modelRigs: state.modelRigs,
    });
  }

  const {
    modelParts: _modelParts,
    modelRigs: _modelRigs,
    history: _history,
    redo: _redo,
    worldUndo: _worldUndo,
    worldRedo: _worldRedo,
    ...view
  } = state;
  // Store the chrome/view shape but redact every per-map authored slice. This
  // makes stale hot memory incapable of resurrecting pieces after New/Open.
  setHotState(VIEW_HOT_KEY, {
    ...view,
    worldPieces: [],
    objects: [],
    selectedObjectId: 'obj-tile',
    selectedPieceId: null,
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
