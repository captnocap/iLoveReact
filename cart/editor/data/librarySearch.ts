// Pure global search for the Asset Explorer. The query is intentionally a
// literal, case-insensitive substring: typing a model name, package path,
// material recipe, semantic kind, or stable id must find the same item no
// matter which content-tree folder happens to be selected.
import type { Asset, ModelPackage } from './types';

export type LibrarySearchHit =
  | { kind: 'model'; model: ModelPackage }
  | { kind: 'asset'; asset: Asset };

export function librarySearchHitKey(hit: LibrarySearchHit): string {
  return hit.kind === 'model' ? `model:${hit.model.id}` : `asset:${hit.asset.id}`;
}

/**
 * A mixed result list has one selection, even though the editor separately
 * retains an open model document and a last-used catalog asset. A click-owned
 * preferred key wins; on first render the catalog selection wins when present,
 * then the open model is the fallback.
 */
export function resolveLibrarySearchSelection(
  hits: readonly LibrarySearchHit[],
  preferredKey: string | null,
  activeAssetId: string,
  activeDocumentId: string,
): string | null {
  const available = new Set(hits.map(librarySearchHitKey));
  if (preferredKey && available.has(preferredKey)) return preferredKey;
  const assetKey = `asset:${activeAssetId}`;
  if (available.has(assetKey)) return assetKey;
  if (activeDocumentId.startsWith('model:')) {
    const modelKey = `model:${activeDocumentId.slice('model:'.length)}`;
    if (available.has(modelKey)) return modelKey;
  }
  return null;
}

function normalizedQuery(query: string): string {
  return query.trim().toLowerCase();
}

function assetSearchText(asset: Asset): string {
  return [
    asset.name,
    asset.id,
    asset.recipe ?? '',
    asset.sourceKind ?? '',
    asset.sourceId ?? '',
    asset.sourcePath ?? '',
    asset.semanticKind ?? '',
    ...(asset.variants ?? []),
    ...(asset.stats ?? []),
  ].join(' ').toLowerCase();
}

function modelSearchText(model: ModelPackage): string {
  return [
    model.name,
    model.id,
    model.path,
    model.kind,
    model.stage,
    model.semanticKind ?? '',
    model.sourceKind ?? '',
    model.source,
    model.viewerPath ?? '',
    model.viewerMeshRef ?? '',
    model.rig,
    model.data,
    ...model.decompositions,
    ...model.atlases.map((atlas) => `${atlas.label} ${atlas.scope}`),
    ...model.paints.map((paint) => `${paint.name} ${paint.atlas} ${paint.shaderRefs.join(' ')} ${paint.imageRefs.join(' ')}`),
  ].join(' ').toLowerCase();
}

export function assetMatchesLibrarySearch(asset: Asset, query: string): boolean {
  const needle = normalizedQuery(query);
  return needle.length === 0 || assetSearchText(asset).includes(needle);
}

export function modelMatchesLibrarySearch(model: ModelPackage, query: string): boolean {
  const needle = normalizedQuery(query);
  return needle.length === 0 || modelSearchText(model).includes(needle);
}

function resultRank(name: string, haystack: string, needle: string): number {
  const normalizedName = name.toLowerCase();
  if (normalizedName === needle) return 0;
  if (normalizedName.startsWith(needle)) return 1;
  if (normalizedName.includes(needle)) return 2;
  return haystack.includes(needle) ? 3 : 4;
}

/** All matching models and catalog assets, ranked by name match before metadata. */
export function searchLibrary(
  query: string,
  assets: readonly Asset[],
  models: readonly ModelPackage[],
): LibrarySearchHit[] {
  const needle = normalizedQuery(query);
  if (!needle) return [];

  const ranked = [
    ...models.map((model) => ({
      hit: { kind: 'model', model } as LibrarySearchHit,
      name: model.name,
      rank: resultRank(model.name, modelSearchText(model), needle),
    })),
    ...assets.map((asset) => ({
      hit: { kind: 'asset', asset } as LibrarySearchHit,
      name: asset.name,
      rank: resultRank(asset.name, assetSearchText(asset), needle),
    })),
  ].filter((entry) => entry.rank < 4);

  ranked.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return ranked.map((entry) => entry.hit);
}
