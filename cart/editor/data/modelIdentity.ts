// editor/data/modelIdentity.ts — durable model identity allocation.
// Display names are labels, never keys; package ids are disk truth.
import type { ModelPackage, PrimitiveKind, WorkspaceDocument } from './types';
import type { BuildPieceStarterId } from './buildStarters';

export type DurableModelIdExists = (id: string) => boolean;

/** Allocate a pristine primitive id. `durableIdExists` is deliberately separate
 * from the presentation catalog: a filtered/hidden row can never make an on-disk
 * identity reusable. Generic Model N names stay unique for browser readability. */
export function allocatePrimitiveModelId(
  kind: PrimitiveKind,
  docs: readonly WorkspaceDocument[],
  catalog: readonly ModelPackage[],
  durableIdExists: DurableModelIdExists,
): string {
  const taken = (n: number) => {
    const id = `primitive:${kind}:${n}`;
    return durableIdExists(id)
      || catalog.some((model) => model.id === id || model.name === `Model ${n}`)
      || docs.some((doc) => doc.kind === 'model' && doc.sourceId?.startsWith('primitive:') && doc.sourceId.endsWith(`:${n}`));
  };
  let n = 1;
  while (taken(n)) n += 1;
  return `primitive:${kind}:${n}`;
}

export const PLAYER_MODEL_ID_PREFIX = 'character:player:';

export const BUILD_STARTER_MODEL_ID_PREFIX = 'starter:build:';

/** Allocate a semantic build-starter id without trusting the visible catalog. */
export function allocateBuildStarterModelId(
  starterId: BuildPieceStarterId,
  docs: readonly WorkspaceDocument[],
  catalog: readonly ModelPackage[],
  durableIdExists: DurableModelIdExists,
): string {
  const prefix = `${BUILD_STARTER_MODEL_ID_PREFIX}${starterId}:`;
  const taken = (n: number) => {
    const id = `${prefix}${n}`;
    return durableIdExists(id)
      || catalog.some((model) => model.id === id)
      || docs.some((doc) => doc.kind === 'model' && doc.sourceId === id);
  };
  let n = 1;
  while (taken(n)) n += 1;
  return `${prefix}${n}`;
}

/** Player/NPC starter twin of allocatePrimitiveModelId. */
export function allocatePlayerModelId(
  docs: readonly WorkspaceDocument[],
  catalog: readonly ModelPackage[],
  durableIdExists: DurableModelIdExists,
): string {
  const taken = (n: number) => {
    const id = `${PLAYER_MODEL_ID_PREFIX}${n}`;
    return durableIdExists(id)
      || catalog.some((model) => model.id === id || model.name === `Player Model ${n}`)
      || docs.some((doc) => doc.kind === 'model' && doc.sourceId === id);
  };
  let n = 1;
  while (taken(n)) n += 1;
  return `${PLAYER_MODEL_ID_PREFIX}${n}`;
}
