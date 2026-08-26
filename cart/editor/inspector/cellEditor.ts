// inspector/cellEditor.ts — AT MOST ONE CELL IS BEING EDITED (req_4776).
//
// Every boxed cell owned its own `editing` boolean and closed itself on blur.
// Nothing owned the fact that only ONE of them may be open, so when a blur did
// not land the cells simply accumulated: click three number cells in a row and
// three of them sit there lit and focused, each believing it has the caret.
//
// The host side of this is fine — `engine.zig` calls `input.unfocus()` when a
// press lands on a handler node, and `input.focus()` fires the previous input's
// blur (framework/primitive/input.zig). What was missing is a JS-side owner, so
// a dropped blur turned into permanent state instead of a missed frame.
//
// This module is that owner. It is deliberately a module singleton rather than
// a context: "which cell has the caret" is a property of the APPLICATION, not
// of a subtree, and a second editor opening in a different panel must still
// close the first one.

/** Closes whatever cell editor is currently open. */
type CloseEditor = () => void;

let openEditor: CloseEditor | null = null;

/** Subscribers that re-render when the caret moves — the panel shell needs to
 *  know, because its click-outside backdrop only exists while a cell is open. */
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/** `useSyncExternalStore` subscribe half. */
export function subscribeCellEditor(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Take the caret. Any editor already open is committed and closed first, so
 * opening a cell can never leave a second one lit.
 *
 * Returns a release function the caller invokes when it closes on its own
 * (Enter, Esc, blur) so it stops being the registered editor.
 */
export function claimCellEditor(close: CloseEditor): () => void {
  if (openEditor && openEditor !== close) openEditor();
  openEditor = close;
  publish();
  return () => {
    if (openEditor !== close) return;
    openEditor = null;
    publish();
  };
}

/**
 * Close the open cell editor, if any, because a press landed somewhere that is
 * not a cell. This is what makes "click outside and it lets go" true: a press
 * on empty panel space has nothing to focus, so nothing was going to blur the
 * caret on its own.
 */
export function closeCellEditor(): void {
  const close = openEditor;
  if (!close) return;
  openEditor = null;
  close();
  publish();
}

/** `useSyncExternalStore` snapshot half: whether a cell currently holds the
 *  caret. The backdrop only needs to exist while one does. */
export function cellEditorOpen(): boolean {
  return openEditor !== null;
}
