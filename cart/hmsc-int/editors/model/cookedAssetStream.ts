// editors/model/cookedAssetStream.ts — THE CONTENT STORE for cooked assets
// (Part 7, req_1122/req_1129). A V20 per-concern stream: install once, reference
// everywhere. Modeled on modelStream.ts (the library idiom) — a dumb-upsert
// materializer, unknown kinds pass through (schema-by-addition).
//
// GUIDING LIGHT (req_1129): the heavy FACTORS are content-addressed and interned
// ONCE — the mesh blob keyed by `meshRef` (its sha256), the texture blob keyed by
// `texRef`. A `CookedAsset` record is references + the descriptor factor; many
// assets that share a mesh point at the SAME blob (a sum, not a product). This is
// the AUTHOR-side store (the catalog the palette reads + the bake reads); the
// SHIPPED artifact is the flat binary the bake emits (MESH_PROPS + assets[]),
// never this jsonl. The hash IS the dedup/cache key.
//
// BRANCH (persisted): every install is a branch event. The Compile dialog's
// working state is a TWIG and never lands here.

import type { StreamDef } from '../../data';
import type { CookedAsset, CookKind, CookResult } from './cookedAsset';

export type CookedAssetEvent =
  // Install (or re-install, idempotent by id): the asset RECORD + its heavy
  // factors as bytes (verts as a plain array, texture as base64) so the bake can
  // emit them without the source model. Blobs intern by their hash (dedup).
  | { kind: 'assetInstalled'; asset: CookedAsset; meshVerts: number[]; texB64?: string }
  | { kind: 'assetRenamed'; id: string; name: string }
  | { kind: 'assetRemoved'; id: string };

export type CookedAssetStreamState = {
  /** the cooked-asset catalog, by id. */
  assets: Record<string, CookedAsset>;
  /** content-addressed geometry blobs: meshRef → verts (8 floats/vertex). */
  meshBlobs: Record<string, number[]>;
  /** content-addressed texture blobs: texRef → base64 (compressed WebP). */
  textureBlobs: Record<string, string>;
  /** install order — the catalog list. */
  order: string[];
};

function emptyState(): CookedAssetStreamState {
  return { assets: {}, meshBlobs: {}, textureBlobs: {}, order: [] };
}

export const cookedAssetStream: StreamDef<CookedAssetStreamState, CookedAssetEvent> = Object.freeze({
  name: 'cooked-asset',
  initial: emptyState,
  apply: (state: CookedAssetStreamState, event: CookedAssetEvent): CookedAssetStreamState => {
    if (!state || !(state as Partial<CookedAssetStreamState>).assets) state = emptyState();
    switch (event?.kind) {
      case 'assetInstalled': {
        const a = event.asset;
        if (!a?.id) return state;
        const known = a.id in state.assets;
        return {
          assets: { ...state.assets, [a.id]: a },
          // intern blobs by their content hash — re-install of the same bytes is a no-op.
          meshBlobs: a.meshRef in state.meshBlobs ? state.meshBlobs : { ...state.meshBlobs, [a.meshRef]: event.meshVerts },
          textureBlobs: a.texRef && event.texB64 && !(a.texRef in state.textureBlobs)
            ? { ...state.textureBlobs, [a.texRef]: event.texB64 }
            : state.textureBlobs,
          order: known ? state.order : [...state.order, a.id],
        };
      }
      case 'assetRenamed': {
        const a = state.assets[event.id];
        return a ? { ...state, assets: { ...state.assets, [event.id]: { ...a, name: event.name } } } : state;
      }
      case 'assetRemoved': {
        if (!(event.id in state.assets)) return state;
        const assets = { ...state.assets };
        delete assets[event.id];
        // Blobs are content-addressed and may be shared by another asset, so we do
        // NOT drop them here — a sweep (later) reclaims any with no referrer.
        return { ...state, assets, order: state.order.filter((id) => id !== event.id) };
      }
      default:
        return state; // unknown kinds are future additions — old materializers skip them.
    }
  },
});

// ── selectors ─────────────────────────────────────────────────────────────────

/** The catalog in install order — what a palette lists. */
export function installedAssets(state: CookedAssetStreamState): CookedAsset[] {
  const assets = state?.assets ?? {};
  return (state?.order ?? []).map((id) => assets[id]).filter(Boolean);
}

/** The cooked assets of one kind (the prop palette reads kind='prop'). */
export function cookedAssetsByKind(state: CookedAssetStreamState, kind: CookKind): CookedAsset[] {
  return installedAssets(state).filter((a) => a.kind === kind);
}

export function cookedAsset(state: CookedAssetStreamState, id: string): CookedAsset | null {
  return state?.assets?.[id] ?? null;
}

/** The geometry factor for a meshRef, as the loader's soup (or null). */
export function meshBlobFor(state: CookedAssetStreamState, meshRef: string): Float32Array | null {
  const verts = state?.meshBlobs?.[meshRef];
  return verts ? new Float32Array(verts) : null;
}

/** The texture factor for a texRef, as base64 WebP (or null). */
export function textureBlobFor(state: CookedAssetStreamState, texRef: string): string | null {
  return state?.textureBlobs?.[texRef] ?? null;
}

/** Build the install event from a cook result + the (already-compressed) texture
 *  bytes. The single place a CookResult becomes a stream event (rule of two). */
export function installEvent(result: CookResult, texB64?: string): CookedAssetEvent {
  return {
    kind: 'assetInstalled',
    asset: result.asset,
    meshVerts: Array.from(result.blob.verts),
    ...(result.asset.texRef && texB64 ? { texB64 } : {}),
  };
}
