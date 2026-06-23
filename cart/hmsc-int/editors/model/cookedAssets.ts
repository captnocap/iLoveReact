// editors/model/cookedAssets.ts — the Studio-side door to the cooked-asset
// content store (editors/model/cookedAssetStream.ts). Mirrors studioModel.ts's
// relationship to modelStream: a thin module-level wrapper that opens the live
// editor channel, exposes install / rename / remove + a React hook, and notifies
// subscribers. Install is a plain BRANCH append (no per-model undo chain — the
// catalog is install-once data, not an edit history).
//
// GUIDING LIGHT (req_1129): this is the AUTHOR-side catalog the palette + bake
// read. The shipped artifact is the flat binary the bake emits, never this.

import { useEffect } from 'react';
import { useRerender } from '@reactjit/hooks';
import { registerCookedProps } from '../../game/kinds/props';
import { registerCookedCatalog } from '../../game/build/catalog';
import { registerCookedAssetLookup } from '../../compile/propRecipes/resolve';
import { editorChannel } from '../store';
import type { CookedAsset, CookKind, CookResult } from './cookedAsset';
import {
  cookedAssetStream, cookedAssetsByKind, installEvent, installedAssets,
  meshBlobFor, textureBlobFor, type CookedAssetStreamState,
} from './cookedAssetStream';

const listeners = new Set<() => void>();
function notify(): void { for (const fn of listeners) fn(); }

/** Mirror the installed cooked PROP descriptors into the prop registry's runtime
 *  overlay (game/kinds/props), so physics / palette / render / bake resolve a
 *  cooked kind through the SAME lookup as a built-in. Idempotent + cheap. */
export function syncCookedRegistry(state: CookedAssetStreamState): void {
  const props = cookedAssetsByKind(state, 'prop');
  // descriptors FIRST (the prop registry overlay) so the catalog's footprint
  // derivation resolves each kind, THEN the placement catalog rows.
  registerCookedProps(props.map((a) => a.descriptor));
  registerCookedCatalog(props.map((a) => a.descriptor.kind));
}

let booted = false;
function channel() {
  const ch = editorChannel(cookedAssetStream);
  // First touch loads the persisted catalog from disk — register it immediately so
  // a cold-loaded session resolves cooked kinds before any placement renders.
  if (!booted) { booted = true; syncCookedRegistry(ch.state()); }
  return ch;
}

/** Register the persisted cooked props into the prop + catalog overlays. The
 *  editor calls this at boot (index.tsx) BEFORE the worldStream folds buildPieces,
 *  so a placed cooked prop survives the materializer's catalog-id check. Idempotent. */
export function ensureCookedRegistry(): void {
  syncCookedRegistry(channel().state());
}

function commit(event: Parameters<ReturnType<typeof channel>['append']>[0]): void {
  const ch = channel();
  ch.append(event);
  syncCookedRegistry(ch.state()); // keep the overlay fresh after a mutation
  notify();
}

/** Install (or re-install, idempotent) a cooked asset + its compressed texture. */
export function installCookedAsset(result: CookResult, texB64?: string): void {
  commit(installEvent(result, texB64));
}

export function renameCookedAsset(id: string, name: string): void {
  commit({ kind: 'assetRenamed', id, name });
}

export function removeCookedAsset(id: string): void {
  commit({ kind: 'assetRemoved', id });
}

// Non-hook accessors (the palette source + the bake read run outside React).
export function cookedAssetCatalog(): CookedAsset[] { return installedAssets(channel().state()); }
export function cookedPropCatalog(): CookedAsset[] { return cookedAssetsByKind(channel().state(), 'prop'); }
export function cookedAssetById(id: string): CookedAsset | null { return channel().state().assets?.[id] ?? null; }
// Hand the prop resolver our lookup at init (req_1682) — inverts the import so the
// early/widely-loaded resolve.ts never statically depends on this heavy module.
registerCookedAssetLookup(cookedAssetById);
export function cookedMeshBlob(meshRef: string): Float32Array | null { return meshBlobFor(channel().state(), meshRef); }
export function cookedTextureBlob(texRef: string): string | null { return textureBlobFor(channel().state(), texRef); }

/** Subscribe a non-React consumer (a workbench source) to catalog changes. */
export function subscribeCookedAssets(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export type CookedAssetsView = {
  all: CookedAsset[];
  byKind(kind: CookKind): CookedAsset[];
  install(result: CookResult, texB64?: string): void;
  rename(id: string, name: string): void;
  remove(id: string): void;
};

export function useCookedAssets(): CookedAssetsView {
  const rerender = useRerender();
  useEffect(() => {
    listeners.add(rerender);
    return () => { listeners.delete(rerender); };
  }, [rerender]);
  const state = channel().state();
  return {
    all: installedAssets(state),
    byKind: (kind: CookKind) => cookedAssetsByKind(state, kind),
    install: installCookedAsset,
    rename: renameCookedAsset,
    remove: removeCookedAsset,
  };
}
