// editor/data/surfaces.ts — the ONE derivation of "what authoring surface is loaded in view".
//
// The editor has two real surfaces (plus a minor material focus), decided by the active
// workspace document's kind. Menus, keybindings, the action bar, and context menus all gate
// on this — so it lives in one place instead of the ~6 duplicated `workspaceDocuments.find(...)`
// lookups that used to be scattered through AppFrame / DropdownMenu / ToolOptions.
import type { EditorState, WorkspaceDocument } from './types';

// 'playtest' (GLOBALS req_2770): the embodied drop-in tab. Deliberately NOT a
// Command scope — no command targets it, so on the playtest tab every
// world/model/material command grays with its surface reason and only global
// chords fire (the loader owns WASD/Space/Shift).
// 'animation' (req_2786): the webcam capture tab — same non-scope treatment.
export type Surface = 'world' | 'model' | 'material' | 'playtest' | 'animation' | 'knowledge';

function activeDoc(state: EditorState): WorkspaceDocument | undefined {
  return state.workspaceDocuments.find((doc) => doc.id === state.activeWorkspaceDocumentId);
}

/** The surface currently in view: a model document → 'model'; the Color Studio / a material
 *  document → 'material'; the playtest drop-in → 'playtest'; otherwise the default world/map
 *  surface. */
export function activeSurface(state: EditorState): Surface {
  const doc = activeDoc(state);
  if (doc?.kind === 'model') return 'model';
  if (doc?.kind === 'material' || state.materialFocused) return 'material';
  if (doc?.kind === 'playtest') return 'playtest';
  if (doc?.kind === 'animation') return 'animation';
  if (doc?.kind === 'knowledge') return 'knowledge';
  return 'world';
}

/** The active model document, or undefined when the world/material surface is in view. */
export function activeModelDoc(state: EditorState): WorkspaceDocument | undefined {
  const doc = activeDoc(state);
  return doc?.kind === 'model' ? doc : undefined;
}

/** Is there a selection to act on for the given surface? Drives selection-gated commands
 *  (Duplicate/Delete/Rotate/…): world reads the selected PLACED PIECE first (req_2733), then
 *  the legacy world object; model reads the mesh editor's live element-selection count.
 *  Material has no selection concept → always true. */
export function hasSelection(state: EditorState, surface: Surface): boolean {
  if (surface === 'model') return state.modelTool.sel > 0;
  if (surface === 'world') return !!state.selectedPieceId || !!state.selectedObjectId;
  return true;
}
