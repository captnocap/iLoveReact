// game/textures/materials.ts — the stored MATERIALS the texture studio authors.
// (Lineage: cart/hmsc/render3d/customTextures.ts; TEXPORT-0606 moved the texture
// pipeline behind the game/textures door. Export names unchanged — a stored
// material is still a CustomTexture and 'custom:' ids stay stable.)
//
// A material's SOURCE is one of the locked vocabulary's kinds:
//   • SHADER — a tunable RECIPE (./shaders.ts); Materialize freezes the current
//     slider values into a {shaderId, data[]} snapshot.
//   • DECAL — a look authored in React (Box/Text/Image) as a DecalDoc
//     (./decal.ts, DECALEDIT-0606); the /compose editor authors it and the doc
//     rides the record, so reopening a saved decal is lossless (re-edit law).
// Stored materials live in the shared 'hmsc' localstore (the same store the
// game boots from, see hmsc_localstore_shared_across_carts), so the game bakes
// them with no editor dependency: ./registry.tsx hydrates each record back into
// a regular TextureDef (shader → Effect, decal → DecalSurface), and from there
// the normal capture path (TextureCapture / partTextureKey) treats it like any
// built-in texture.
//
// Records are raw data only — hydration lives in registry.tsx so this module
// has no component imports and no cycles (decal.ts is data-only too).

// GAP(V15): the shared-store wires still live with the legacy game state module;
// they move when hmsc becomes compile/'s output.
import { hmscStoreGet, hmscStoreSet } from '../../../hmsc/state/gameState';
import { busOn, busEmit } from '@reactjit/hooks/useIFTTT';
import { useEffect, useState } from 'react';
import { validateDecalDoc, type DecalDoc } from './decal';
import { validateDecalPixels, type DecalPixels } from './decalPixels';

const STORE_KEY = 'custom-textures';
const CHANGED = 'hmsc:custom-textures-changed';

export type CustomTexture = {
  id: string;       // 'custom:<slug>' — stable; what partTextures / tiles reference
  label: string;
  /** SHADER source: a ./shaders spec id ('road', 'e-stucco-facade', …) */
  shaderId?: string;
  /** SHADER source: the frozen buildData snapshot */
  data?: number[];
  /** DECAL source: the composed Box/Text/Image document (re-editable) */
  decal?: DecalDoc;
  /** DECAL source: pixels baked by the editor (DECALPIX-0610, bake-by-
   *  execution) — what the compiled game ships, since a decal has no WGSL
   *  recipe. Derived cache: stale whenever pixels.docHash no longer matches
   *  the doc (the DecalPixelBaker re-captures); the doc stays the source. */
  pixels?: DecalPixels;
};

export function loadCustomTextures(): CustomTexture[] {
  try {
    const raw = hmscStoreGet(STORE_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    const out: CustomTexture[] = [];
    for (const t of j) {
      if (!t || typeof t.id !== 'string' || typeof t.label !== 'string') continue;
      // shader record — the pre-decal shape, unchanged
      if (typeof t.shaderId === 'string' && Array.isArray(t.data)) {
        out.push({ id: t.id, label: t.label, shaderId: t.shaderId, data: t.data });
        continue;
      }
      // decal record — boundary-validated; a corrupt doc drops the record.
      // Baked pixels ride along when present (a corrupt payload degrades to
      // pixel-less, never a dropped decal — the baker just re-captures).
      const doc = validateDecalDoc(t.decal);
      if (doc) out.push({ id: t.id, label: t.label, decal: doc, pixels: validateDecalPixels(t.pixels) });
    }
    return out;
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

function mintId(list: CustomTexture[], label: string): string {
  const base = `custom:${slugify(label)}`;
  let id = base;
  for (let n = 2; list.some((t) => t.id === id); n++) id = `${base}-${n}`;
  return id;
}

// Save a materialized look under a name. Returns the stored record (its id is
// unique — a name collision gets a numeric suffix, never an overwrite).
export function saveCustomTexture(label: string, shaderId: string, data: number[]): CustomTexture {
  const list = loadCustomTextures();
  const id = mintId(list, label);
  const record: CustomTexture = { id, label: label.trim() || id, shaderId, data: [...data] };
  write([...list, record]);
  return record;
}

// Save a composed decal under a name (DECALEDIT-0606). Same id minting; the
// doc is boundary-validated so the store never holds a half-doc. UPSERT by
// existingId — re-saving an opened decal updates it in place (re-edit law);
// a missing/foreign existingId falls back to a fresh record.
export function saveDecalTexture(label: string, doc: DecalDoc, existingId?: string): CustomTexture | null {
  const valid = validateDecalDoc(doc);
  if (!valid) return null;
  const list = loadCustomTextures();
  const existing = existingId ? list.find((t) => t.id === existingId && t.decal) : undefined;
  if (existing) {
    // Keep the previous bake's pixels (likely stale now — the DecalPixelBaker
    // re-captures on the hash mismatch) so a compile between save and re-bake
    // ships the old look instead of dropping to flat color.
    const record: CustomTexture = { id: existing.id, label: label.trim() || existing.label, decal: valid, pixels: existing.pixels };
    write(list.map((t) => (t.id === existing.id ? record : t)));
    return record;
  }
  const id = mintId(list, label);
  const record: CustomTexture = { id, label: label.trim() || id, decal: valid };
  write([...list, record]);
  return record;
}

// Attach freshly-captured pixels to a stored decal (DECALPIX-0610). Called by
// the DecalPixelBaker after __surface_readback; a no-op for ids that aren't
// decal records. Emits the same CHANGED bus event — the baker's staleness
// check (docHash) makes the resulting re-entry idle, never a loop.
export function saveDecalPixels(id: string, pixels: DecalPixels): void {
  const list = loadCustomTextures();
  if (!list.some((t) => t.id === id && t.decal)) return;
  write(list.map((t) => (t.id === id && t.decal ? { ...t, pixels } : t)));
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
