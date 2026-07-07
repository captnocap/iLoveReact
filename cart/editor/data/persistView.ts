// editor/data/persistView.ts — keep the active view alive across dev hot reloads.
//
// Saving a .tsx file tears down the JS context and re-evals a fresh bundle,
// which normally resets all React state (you lose which folder/model/material
// you were looking at). useHotState persists atoms in Zig-owned memory
// (framework/state/hotstate.zig) that outlives the teardown, so we mirror the
// whole editor state into one atom and rehydrate it on boot. Same idea the
// previous editor app (hmsc-int) leans on for its studio/game state.
//
// Survives hot reload; resets on a cold process restart (hotstate is
// in-process) — which is the wanted behaviour for VIEW state: a fresh launch
// starts with clean chrome. World CONTENT is different (SESSIONSAVE req_2765):
// placed pieces / zone defs / the id seq rehydrate from the on-disk world save
// (data/worldStore.ts) so a session's building survives the restart; the
// painted map reloads host-side from its RMAP on the same boot.
import { getHotState, setHotState } from '../../../runtime/hooks/useHotState';
import { initialState, defaultModelTool } from './initialState';
import { loadWorldSave } from './worldStore';
import type { EditorState } from './types';

const VIEW_HOT_KEY = 'editor:view:v1';

// Transient surfaces that should NOT spring back open after a reload — even if
// a menu/dialog/popover was open when the reload fired, the rehydrated view
// starts with them closed.
const RESET_ON_RELOAD: Partial<EditorState> = {
  openMenu: null,
  presetMenuOpen: false,
  contextOpen: false,
  buildDialogOpen: false,
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
 *  their defaults), with transient overlays forced closed. Cold start = world
 *  save only; hot reload = hotstate wins where it carries a value (it is never
 *  behind the disk — every edit micro-saves), and the disk fills any slice a
 *  pre-worldStore hotstate shape lacks. */
export function loadPersistedState(): EditorState {
  const base = initialState();
  const world = loadWorldSave();
  if (world) {
    base.worldPieces = world.pieces;
    base.seq = Math.max(base.seq, world.seq);
    if (world.zones.length) base.mapPaint = { ...base.mapPaint, zones: world.zones };
  }
  const saved = getHotState<Partial<EditorState> | null>(VIEW_HOT_KEY, null);
  if (!saved) {
    if (world?.pieces.length) base.status = `restored world — ${world.pieces.length} placed piece${world.pieces.length === 1 ? '' : 's'} from the world save`;
    return base;
  }
  const merged = { ...base, ...saved, ...RESET_ON_RELOAD, status: 'restored your last view' };
  // The id seq only ever grows: a stale hotstate seq must not re-mint ids the
  // disk save already handed out.
  merged.seq = Math.max(merged.seq, base.seq);
  return merged;
}

/** Mirror the current state into the hot atom so the next reload can rehydrate. */
export function persistState(state: EditorState): void {
  setHotState(VIEW_HOT_KEY, state);
}
