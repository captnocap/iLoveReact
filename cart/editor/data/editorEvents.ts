// cart/editor/data/editorEvents.ts — the editor boarding the real eventbus.
//
// Every recorded authoring edit is dispatched as ONE `editor.edit` event through the
// runtime/editorbus door. That door is host-backed by framework/events/editor_bus.zig
// (durable SQLite log, authoritative monotonic seq, multiplayer-shaped origin) once the
// v8 bindings are built into the binary, and degrades to an in-process log otherwise.
//
// state.history stays the editor's LOCAL undo model (fast, capped, session-only). The
// bus is the separate durable source of truth. This is the first step of the migration
// AppFrame has been promising itself — the editor getting on the bus that was already
// built and parked at the station (req_2424).
import { defineEventType, dispatch } from '../../../runtime/editorbus';
import type { HistoryEvent } from './types';

type EditPayload = { verb: string; target: string; meta: string; editMs: number };

// One event type for now — a plain authoring edit. Richer per-system types (piece.place,
// material.slot.fill, …) register themselves through this same seam as they get wired.
export const editorEdit = defineEventType<EditPayload>({
  type: 'editor.edit',
  undoable: true,
  describe: (p) => `${p.verb} ${p.target}`.trim() || 'edit',
});

/** Dispatch a recorded history entry onto the editor bus. Returns the assigned seq
 *  (SEQ_PENDING if the host rejected it). Safe to call whether or not the host bus
 *  is wired — the door handles the fallback. */
export function dispatchEdit(h: HistoryEvent): number {
  return dispatch(editorEdit(
    { verb: h.verb, target: h.target, meta: h.meta, editMs: h.editMs ?? 0 },
    [{ kind: 'edit', id: h.id }],
  ));
}
