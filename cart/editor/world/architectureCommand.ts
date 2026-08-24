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
import type { ArchitectureSource, WallCell, WallHinge, WallOpeningKind, WallSide } from './architecture';
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

/** The in-flight wall-edit mark (req_4726): stamped when the engine accepts a
 * command, taken by the WorldViewport catalog push — the END of the placement
 * pipeline (mutate → bake → refs → catalog) — which publishes the BuildDock
 * AVG/P95 sample. Date.now() on purpose: performance.now() is shimmed to the
 * frozen per-tick clock and reads 0 across any intra-tick span. One slot is
 * enough — wall commands are single-gesture and the same-tick push consumes
 * the mark before the next gesture can land. */
let architectureEditMark: { verb: string; startedAtMs: number } | null = null;

export function takeArchitectureEditMark(): { verb: string; startedAtMs: number } | null {
  const mark = architectureEditMark;
  architectureEditMark = null;
  return mark;
}

/** Apply one semantic command. Success adopts the engine's returned source;
 * any engine rejection surfaces its reason and changes nothing. */
export function applyArchitectureCommand(
  source: ArchitectureSource,
  command: ArchitectureCommand,
  host: ArchitectureMutationHost = architectureHost,
): ArchitectureApplyResult {
  const startedAtMs = Date.now();
  try {
    const mutation = host.mutate(source, command);
    architectureEditMark = { verb: command.kind, startedAtMs };
    return { status: 'applied', source: mutation.source, receipt: mutation.receipt };
  } catch (error) {
    architectureEditMark = null;
    return { status: 'rejected', reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Command ids are minted from the editor's monotonic seq so engine-derived
 * vertex/edge ids (`<commandId>:v:<n>`) stay unique per document. */
export function architectureCommandId(verb: 'draw' | 'delete-edge' | 'opening' | 'delete-opening' | 'move-opening' | 'flip-opening' | 'dimensions' | 'side-finish', seq: number): string {
  return `arch:${verb}:${seq}`;
}

/** Dress ONE side of a placed wall (req_4739): the side's finish becomes the
 * named material id — a Skins-tab asset id for a real material, or the edge's
 * own style id to return to the default look. The engine stores it verbatim
 * (side finishes are opaque strings) and the live bake resolves it. */
export function setSideFinishCommand(
  commandId: string,
  expectedRevision: number,
  edgeId: string,
  side: WallSide,
  materialId: string,
): ArchitectureCommand {
  return { commandId, expectedRevision, kind: 'setSideFinish', edgeId, side, materialId };
}

export function deleteEdgeCommand(commandId: string, expectedRevision: number, edgeId: string): ArchitectureCommand {
  return { commandId, expectedRevision, kind: 'deleteEdge', edgeId };
}

/** Re-dimension a PLACED wall (req_4520): the selected edge's height/thickness
 * change through the engine, support untouched — the host gizmo's drag is the
 * authoring gesture, this command is its one semantic edit. */
export function setEdgeDimensionsCommand(
  commandId: string,
  expectedRevision: number,
  edge: { id: string; support: ArchitectureSource['walls']['edges'][number]['support']; },
  heightU: number,
  thicknessU: number,
): ArchitectureCommand {
  return { commandId, expectedRevision, kind: 'setEdgeDimensions', edgeId: edge.id, support: edge.support, heightU, thicknessU };
}

/** Cut one opening: the engine subtracts the kit's measured footprint at the
 * slot and mints the opening record `<commandId>:o:0`. Facing defaults to the
 * side the camera saw (the raycast hit side); hinge starts at the run start —
 * both editable later through configureOpening (req_4503). */
export function insertOpeningCommand(
  commandId: string,
  expectedRevision: number,
  edgeId: string,
  kit: { catalogId: string; kind: WallOpeningKind },
  slot: WallCell,
  facingSide: WallSide,
  hinge: WallHinge = 'start',
): ArchitectureCommand {
  return {
    commandId,
    expectedRevision,
    kind: 'insertOpening',
    edgeId,
    opening: {
      openingId: `${commandId}:o:0`,
      kind: kit.kind,
      kitId: kit.catalogId,
      columnU: slot.columnU,
      rowU: slot.rowU,
      facingSide,
      hinge,
    },
  };
}

export function deleteOpeningCommand(commandId: string, expectedRevision: number, openingId: string): ArchitectureCommand {
  return { commandId, expectedRevision, kind: 'deleteOpening', openingId };
}

/** Slide a placed opening to a new anchor on ITS wall (req_4738): the gizmo's
 * arm drags land here. The engine re-validates the footprint at the new cell —
 * junction clearance, overlaps, wall bounds — and rejects with its reason. */
export function moveOpeningCommand(commandId: string, expectedRevision: number, openingId: string, cell: WallCell): ArchitectureCommand {
  return { commandId, expectedRevision, kind: 'moveOpening', openingId, columnU: cell.columnU, rowU: cell.rowU };
}

/** Turn a placed opening around (req_4738): the gizmo ring flips which side
 * the kit mounts flush against — the whole record rides configureOpening with
 * only facingSide changed, so kind/kit/anchor/hinge provably stay put. */
export function flipOpeningFacingCommand(
  commandId: string,
  expectedRevision: number,
  opening: { id: string; kind: WallOpeningKind; kitId: string; columnU: number; rowU: number; facingSide: WallSide; hinge: WallHinge },
): ArchitectureCommand {
  return {
    commandId,
    expectedRevision,
    kind: 'configureOpening',
    opening: {
      openingId: opening.id,
      kind: opening.kind,
      kitId: opening.kitId,
      columnU: opening.columnU,
      rowU: opening.rowU,
      facingSide: opening.facingSide === 'a' ? 'b' : 'a',
      hinge: opening.hinge,
    },
  };
}
