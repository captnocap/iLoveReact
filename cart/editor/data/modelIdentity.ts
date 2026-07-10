// editor/data/modelIdentity.ts — durable model identity boundaries.
//
// Display names are labels, never keys. The content catalog still has legacy
// aliases (Studio source + imported/cooked export) that need presentation-level
// collapsing, but every materialized package is an independently saved model
// and must survive even when another package has the same name.
import type { ModelPackage, PrimitiveKind, WorkspaceDocument } from './types';

const normalizedModelName = (model: ModelPackage): string => model.name.trim().toLowerCase();

function legacySourcePriority(model: ModelPackage): number {
  switch (model.sourceKind) {
    case 'studio-model': return 0;  // the editable original you authored
    case 'source-file': return 1;   // a raw imported mesh file
    case 'imported-prop': return 2; // an exported/imported prop
    case 'cooked-asset': return 3;  // the baked game output
    default: return 4;
  }
}

/** Merge the model catalog's two authority classes.
 *
 * Materialized packages are disk truth and dedupe ONLY by durable id. Legacy
 * sources may still describe the same pre-package model under multiple ids, so
 * those aliases collapse by normalized display name and source priority. A
 * legacy alias matching a durable package's id OR name yields to disk truth.
 */
export function mergeModelCatalogSources(
  materialized: readonly ModelPackage[],
  legacy: readonly ModelPackage[],
): ModelPackage[] {
  const durableById = new Map<string, ModelPackage>();
  const durableNames = new Set<string>();
  for (const model of materialized) {
    if (!durableById.has(model.id)) durableById.set(model.id, model);
    durableNames.add(normalizedModelName(model));
  }

  const legacyByName = new Map<string, ModelPackage>();
  for (const model of legacy) {
    if (durableById.has(model.id)) continue;
    const name = normalizedModelName(model);
    if (durableNames.has(name)) continue;
    const existing = legacyByName.get(name);
    if (!existing || legacySourcePriority(model) < legacySourcePriority(existing)) {
      legacyByName.set(name, model);
    }
  }
  return [...durableById.values(), ...legacyByName.values()];
}

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
