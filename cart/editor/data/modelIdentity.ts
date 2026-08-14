// editor/data/modelIdentity.ts — durable model identity allocation.
// Display names are labels, never keys; package ids are disk truth.
import type { ModelPackage, PrimitiveKind, WorkspaceDocument } from './types';
import type { BuildPieceStarterId } from './buildStarters';

export type DurableModelIdExists = (id: string) => boolean;

/** Identities this session already handed out. The other three sources all prove
 *  reuse from something that OUTLIVES the allocation — disk, the catalog, an open
 *  tab — and a document closed before its first save leaves none of them. Its id
 *  looked free, so the next New Mesh re-minted it and inherited the dead
 *  document's live-mesh lease, outliner rows, and reference images
 *  (req_3773/req_3774). A retired identity stays retired for the whole session. */
export type MintedModelIds = readonly string[];

/** Allocate a pristine primitive id. `durableIdExists` is deliberately separate
 * from the presentation catalog: a filtered/hidden row can never make an on-disk
 * identity reusable. Generic Model N names stay unique for browser readability. */
export function allocatePrimitiveModelId(
  kind: PrimitiveKind,
  docs: readonly WorkspaceDocument[],
  catalog: readonly ModelPackage[],
  durableIdExists: DurableModelIdExists,
  minted: MintedModelIds = [],
): string {
  const taken = (n: number) => {
    const id = `primitive:${kind}:${n}`;
    return durableIdExists(id)
      // Retired across primitive KINDS, exactly like the open-doc rule below:
      // every primitive doc shows as "Model n", so a retired 1 must not come
      // back as a differently-seeded "Model 1" either.
      || minted.some((mintedId) => mintedId.startsWith('primitive:') && mintedId.endsWith(`:${n}`))
      || catalog.some((model) => model.id === id || model.name === `Model ${n}`)
      || docs.some((doc) => doc.kind === 'model' && doc.sourceId?.startsWith('primitive:') && doc.sourceId.endsWith(`:${n}`));
  };
  let n = 1;
  while (taken(n)) n += 1;
  return `primitive:${kind}:${n}`;
}

export const BUILD_STARTER_MODEL_ID_PREFIX = 'starter:build:';

/** Allocate a semantic build-starter id without trusting the visible catalog. */
export function allocateBuildStarterModelId(
  starterId: BuildPieceStarterId,
  docs: readonly WorkspaceDocument[],
  catalog: readonly ModelPackage[],
  durableIdExists: DurableModelIdExists,
  minted: MintedModelIds = [],
): string {
  const prefix = `${BUILD_STARTER_MODEL_ID_PREFIX}${starterId}:`;
  const taken = (n: number) => {
    const id = `${prefix}${n}`;
    return durableIdExists(id)
      || minted.includes(id)
      || catalog.some((model) => model.id === id)
      || docs.some((doc) => doc.kind === 'model' && doc.sourceId === id);
  };
  let n = 1;
  while (taken(n)) n += 1;
  return `${prefix}${n}`;
}
