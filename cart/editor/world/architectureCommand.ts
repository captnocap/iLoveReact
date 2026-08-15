// Architecture command boundary: every structural wall edit goes through the
// native engine exactly once and returns either the engine's mutated source or
// the engine's rejection reason — nothing in between.
//
// Undo/redo is NOT owned here: `state.architecture` rides the editor's existing
// world undo journal (WorldUndoSlices / WORLD_UNDO_KEYS), which restores retained
// source references exactly like every other world slice. That is honest because
// the persisted source is bounded authored data held immutably in React state and
// the engine re-validates every source it is handed. Selection stability across
// undo belongs to the deferred receipt plumbing, not this boundary.
import type { ArchitectureSource } from './architecture';
import {
  architectureHost,
  type ArchitectureCommand,
  type ArchitectureMutation,
  type MutationReceipt,
} from './architectureHost';

/** The one engine call this module makes — injectable so tests exercise the
 * boundary without wire fixtures (the wire is proven in architectureHost.test.ts). */
export type ArchitectureMutationHost = {
  mutate(source: ArchitectureSource, command: ArchitectureCommand): ArchitectureMutation;
};

export type ArchitectureApplyResult =
  | { status: 'applied'; source: ArchitectureSource; receipt: MutationReceipt }
  | { status: 'rejected'; reason: string };

/** Apply one semantic command. Success adopts the engine's returned source;
 * any engine rejection surfaces its reason and changes nothing. */
export function applyArchitectureCommand(
  source: ArchitectureSource,
  command: ArchitectureCommand,
  host: ArchitectureMutationHost = architectureHost,
): ArchitectureApplyResult {
  try {
    const mutation = host.mutate(source, command);
    return { status: 'applied', source: mutation.source, receipt: mutation.receipt };
  } catch (error) {
    return { status: 'rejected', reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Command ids are minted from the editor's monotonic seq so engine-derived
 * vertex/edge ids (`<commandId>:v:<n>`) stay unique per document. */
export function architectureCommandId(verb: 'draw' | 'delete-edge', seq: number): string {
  return `arch:${verb}:${seq}`;
}

export function deleteEdgeCommand(commandId: string, expectedRevision: number, edgeId: string): ArchitectureCommand {
  return { commandId, expectedRevision, kind: 'deleteEdge', edgeId };
}
