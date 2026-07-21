// The model editor has two representations of a multipart document:
//
// - a cart-side boot source (saved meshdoc or primitive seeds), used only to start ModelView;
// - the live native mesh, which becomes authoritative for every structural edit afterward.
//
// Imported library rows intentionally carry only metadata + native group ranges. Their lack
// of a cart-side seed must never be interpreted as the live mesh disappearing.

export type ModelViewResidency = {
  modelId: string | null;
  established: boolean;
};

export const EMPTY_MODEL_VIEW_RESIDENCY: ModelViewResidency = {
  modelId: null,
  established: false,
};

/**
 * Advance the lifetime of the native viewer for one continuously-open multipart model.
 * A boot source establishes the session once; later structural edits may remove every
 * replayable cart-side seed without revoking that live native session.
 */
export function advanceModelViewResidency(
  previous: ModelViewResidency,
  modelId: string | null,
  ownsMultipartSession: boolean,
  hasBootSource: boolean,
): ModelViewResidency {
  if (!modelId || !ownsMultipartSession) return { modelId, established: false };
  if (previous.modelId !== modelId) return { modelId, established: hasBootSource };
  if (previous.established || hasBootSource) return { modelId, established: true };
  return previous;
}

export type PartAppendRoute = 'resident' | 'seed-empty' | 'refuse';

/**
 * Choose the only safe Add Part path. A live viewer always owns the mutation, including
 * an honestly empty native mesh. Without one, only a truly row-empty document may seed;
 * metadata-only imported rows must be preserved rather than overwritten by a new cube.
 */
export function choosePartAppendRoute(hasResidentViewer: boolean, partCount: number): PartAppendRoute {
  if (hasResidentViewer) return 'resident';
  return partCount === 0 ? 'seed-empty' : 'refuse';
}
