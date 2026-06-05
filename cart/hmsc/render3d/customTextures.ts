// customTextures.ts — the stored MATERIALS the texture studio authors.
//
// A texture shader (render3d/textureShaders.ts) is a tunable RECIPE; pressing
// Materialize in the studio freezes the current slider values into a named
// material — a {shaderId, data[]} snapshot — and saves it HERE. Stored materials
// live in the shared 'hmsc' localstore (the same store the game boots from, see
// hmsc_localstore_shared_across_carts), so the game bakes them with no editor
// dependency: render3d/textures.tsx hydrates each record back through the shader
// catalog into a regular TextureDef, and from there the normal capture path
// (TextureCapture / partTextureKey) treats it like any built-in texture.
//
// Records are raw data only (id/label/shaderId/data) — hydration lives in
// textures.tsx so this module has no component imports and no cycles.

import { hmscStoreGet, hmscStoreSet } from '../state/gameState';
import { busOn, busEmit } from '@reactjit/hooks/useIFTTT';
import { useEffect, useState } from 'react';

const STORE_KEY = 'custom-textures';
const CHANGED = 'hmsc:custom-textures-changed';

export type CustomTexture = {
  id: string;       // 'custom:<slug>' — stable; what partTextures / tiles reference
  label: string;
  shaderId: string; // a textureShaders spec id ('road', 'e-stucco-facade', …)
  data: number[];   // the frozen buildData snapshot
};

export function loadCustomTextures(): CustomTexture[] {
  try {
    const raw = hmscStoreGet(STORE_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    return j.filter((t: any) => t && typeof t.id === 'string' && typeof t.shaderId === 'string' && Array.isArray(t.data));
  } catch {
    return [];
  }
}

function write(list: CustomTexture[]): void {
  hmscStoreSet(STORE_KEY, JSON.stringify(list));
  busEmit(CHANGED, list);
}

function slugify(label: string): string {
  const s = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s || 'material';
}

// Save a materialized look under a name. Returns the stored record (its id is
// unique — a name collision gets a numeric suffix, never an overwrite).
export function saveCustomTexture(label: string, shaderId: string, data: number[]): CustomTexture {
  const list = loadCustomTextures();
  const base = `custom:${slugify(label)}`;
  let id = base;
  for (let n = 2; list.some((t) => t.id === id); n++) id = `${base}-${n}`;
  const record: CustomTexture = { id, label: label.trim() || id, shaderId, data: [...data] };
  write([...list, record]);
  return record;
}

export function removeCustomTexture(id: string): void {
  write(loadCustomTextures().filter((t) => t.id !== id));
}

// Subscribe a component to the stored-material list. Re-renders on save/remove.
export function useCustomTextures(): CustomTexture[] {
  const [list, setList] = useState<CustomTexture[]>(loadCustomTextures);
  useEffect(() => busOn(CHANGED, (next: CustomTexture[]) => setList(Array.isArray(next) ? next : loadCustomTextures())), []);
  return list;
}
