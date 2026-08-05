// Favorites and recents for the mixed Asset Explorer surface. These collections
// contain both package models and catalog assets; the old quick rows pointed at
// material-only folders and therefore could not represent the explorer they sat in.
import type { Asset, ContentFolderId, ModelPackage } from './types';
import { librarySearchHitKey, type LibrarySearchHit } from './librarySearch';

export const LIBRARY_COLLECTION_TUNING = Object.freeze({
  recentLimit: 24,
});

export type LibraryCollectionFolder = 'materials-favorites' | 'materials-recent';

export function isLibraryCollectionFolder(folder: ContentFolderId): folder is LibraryCollectionFolder {
  return folder === 'materials-favorites' || folder === 'materials-recent';
}

export function navigateLibraryCollection(
  currentFolder: ContentFolderId,
  returnFolder: ContentFolderId,
  requestedFolder: ContentFolderId,
): { folder: ContentFolderId; returnFolder: ContentFolderId } {
  if (!isLibraryCollectionFolder(requestedFolder)) {
    return { folder: requestedFolder, returnFolder: requestedFolder };
  }
  const safeReturn = isLibraryCollectionFolder(returnFolder) ? 'game' : returnFolder;
  if (currentFolder === requestedFolder) return { folder: safeReturn, returnFolder: safeReturn };
  return {
    folder: requestedFolder,
    returnFolder: isLibraryCollectionFolder(currentFolder) ? safeReturn : currentFolder,
  };
}

export function rememberRecentLibraryItem(keys: readonly string[], key: string): string[] {
  return [key, ...keys.filter((item) => item !== key)].slice(0, LIBRARY_COLLECTION_TUNING.recentLimit);
}

export function favoriteLibraryHits(
  assets: readonly Asset[],
  models: readonly ModelPackage[],
): LibrarySearchHit[] {
  const hits: LibrarySearchHit[] = [
    ...models.filter((model) => model.favorite).map((model) => ({ kind: 'model' as const, model })),
    ...assets.filter((asset) => asset.favorite).map((asset) => ({ kind: 'asset' as const, asset })),
  ];
  return hits.sort((a, b) => {
    const aName = a.kind === 'model' ? a.model.name : a.asset.name;
    const bName = b.kind === 'model' ? b.model.name : b.asset.name;
    return aName.localeCompare(bName);
  });
}

export function recentLibraryHits(
  keys: readonly string[],
  assets: readonly Asset[],
  models: readonly ModelPackage[],
): LibrarySearchHit[] {
  const byKey = new Map<string, LibrarySearchHit>();
  for (const model of models) {
    const hit: LibrarySearchHit = { kind: 'model', model };
    byKey.set(librarySearchHitKey(hit), hit);
  }
  for (const asset of assets) {
    const hit: LibrarySearchHit = { kind: 'asset', asset };
    byKey.set(librarySearchHitKey(hit), hit);
  }
  return keys.map((key) => byKey.get(key)).filter((hit): hit is LibrarySearchHit => Boolean(hit));
}
