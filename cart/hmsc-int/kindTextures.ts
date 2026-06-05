// kindTextures.ts — GLOBAL, per-KIND part textures (the right-rail texture channel).
//
// The two texture surfaces split by scope (the studio panel split): the top-left
// in-focus panel textures ONE placed instance; the right-rail Objects inspector
// textures the KIND — every parking garage, every street sign of that kind follows.
// A kind texture is a GLOBAL (mapStore's "globals are shared, maps are thin
// references" rule), so it lives in the shared 'hmsc' localstore, not on a map or a
// placement. It is folded into each instance's partTextures at preview + compile
// (instance overrides win), so the game sees it with no game-side store dependency.
//
// Key = `${cat}:${kind}` (e.g. 'building:parkingGarage', 'prop:streetSign'); value
// = a partId → textureId map (the same render3d/parts.tsx shape an instance carries).

import { hmscStoreGet, hmscStoreSet } from '../hmsc/state/gameState';
import { busOn, busEmit } from '@reactjit/hooks/useIFTTT';
import { useEffect, useState } from 'react';

const STORE_KEY = 'kind-textures';
const CHANGED = 'hmsc-int:kind-textures-changed';

export type KindTextures = Record<string, Record<string, string>>;

function read(): KindTextures {
  try {
    const raw = hmscStoreGet(STORE_KEY);
    if (!raw) return {};
    const j = JSON.parse(raw);
    return j && typeof j === 'object' ? (j as KindTextures) : {};
  } catch {
    return {};
  }
}

function write(map: KindTextures): void {
  hmscStoreSet(STORE_KEY, JSON.stringify(map));
  // In-process notify so every reader (the inspector, the preview) re-pulls
  // immediately rather than waiting on a remount.
  busEmit(CHANGED, map);
}

const kindKey = (cat: string, kind: string): string => `${cat}:${kind}`;

// The global texture map for a (cat, kind), or {} if none. Used to fold kind
// textures into an instance (instance overrides win): { ...kindTexturesFor, ...inst }.
export function kindTexturesFor(cat: string, kind: string): Record<string, string> {
  return read()[kindKey(cat, kind)] ?? {};
}

// Set or clear one part's global texture for a kind. textureId === null clears it.
export function setKindTexture(cat: string, kind: string, partId: string, textureId: string | null): void {
  const map = read();
  const key = kindKey(cat, kind);
  const parts = { ...(map[key] ?? {}) };
  if (textureId) parts[partId] = textureId; else delete parts[partId];
  if (Object.keys(parts).length) map[key] = parts; else delete map[key];
  write(map);
}

// Subscribe a component to the global kind-texture map. Re-renders on any change.
export function useKindTextures(): KindTextures {
  const [map, setMap] = useState<KindTextures>(read);
  useEffect(() => busOn(CHANGED, (next: KindTextures) => setMap(next ?? read())), []);
  return map;
}
