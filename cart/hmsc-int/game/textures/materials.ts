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
//   • SURFACE (DESIGN_INTAKE.md Part 2) — a SHADER base with an optional stack
//     of overlay layers (dual-tone: base = what the place IS, overlay = what
//     light/mood does to it) and/or `mode: 'span'` (this record is meant to be
//     shared across a grid of placements — see BuildSpanGroup in
//     game/build/skins.ts). No new material shaders: composeSurfaceShader
//     (../render3d/shaders/surfaceCompose.ts) assembles a bespoke fs_main that
//     reuses the existing catalog materials. A plain SHADER record (no layers,
//     mode 'tile') is unaffected and stays on the fast plain-material path.
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
import { hmscStoreGet, hmscStoreSet } from '../../state/gameState';
import { busOn, busEmit } from '@reactjit/hooks/useIFTTT';
import { useEffect, useState } from 'react';
import { validateDecalDoc, type DecalDoc } from './decal';

const STORE_KEY = 'custom-textures';
const CHANGED = 'hmsc:custom-textures-changed';

export type CustomTexture = {
  id: string;       // 'custom:<slug>' — stable; what partTextures / tiles reference
  label: string;
  /** SHADER source: a ./shaders spec id ('road', 'e-stucco-facade', …) */
  shaderId?: string;
  /** SHADER source: the frozen buildData snapshot */
  data?: number[];
  /** Optional material canvas the paint bench used under this shader. Painted
   *  cutout stencils are transparent overlays; the compiler uses this to ship
   *  the same underlay+paint stack the live preview shows. */
  underlayId?: string | null;
  /** DECAL source: the composed Box/Text/Image document (re-editable).
   *  The doc IS what the compiled game ships (DECALRECIPE-0610 — the bake
   *  packs it; the loader rasterizes it at load). */
  decal?: DecalDoc;
  /** SURFACE source: overlay layers stacked on the SHADER base (shaderId/data
   *  above). Empty/absent = plain shader record, unchanged fast path. */
  layers?: SurfaceLayerRecord[];
  /** SURFACE source: 'span' marks this record as meant to be shared across a
   *  grid of placements (see BuildSpanGroup, game/build/skins.ts) rather than
   *  tiled independently per piece. Absent/'tile' = today's behavior. */
  mode?: 'tile' | 'span';
};

/** One overlay layer of a SURFACE material — a shaders.ts material id/board
 *  slot, a blend mode, and a factor (see render3d/shaders/surfaceCompose.ts,
 *  which is the only place that reads this shape at build time). */
export type SurfaceLayerRecord = {
  /** a shaders.ts ShaderSpec id for a fill-board material ('a-road', …) or a
   *  bare render3d/shaders registry fn/slug ('road') — either resolves. */
  materialId: string;
  variant: number;
  seed: number;
  blend: 'over' | 'add' | 'multiply' | 'screen' | 'mask';
  factor: { kind: 'const' | 'gradientY' | 'gradientX' | 'timePulse'; value: number };
};

// Host localstore writes can lag a same-dispatch read in some runtimes. Keep
// this process' material writes visible immediately so materialize-then-assign
// flows resolve through textureById without weakening registry validation.
const sessionWrites = new Map<string, CustomTexture>();
const sessionRemoved = new Set<string>();

function withSessionWrites(list: CustomTexture[]): CustomTexture[] {
  const out = list.filter((t) => !sessionRemoved.has(t.id));
  const seen = new Set(out.map((t) => t.id));
  for (const t of sessionWrites.values()) {
    if (!seen.has(t.id) && !sessionRemoved.has(t.id)) {
      out.push(t);
      seen.add(t.id);
    }
  }
  return out;
}

function rememberSessionWrite(record: CustomTexture): void {
  sessionRemoved.delete(record.id);
  sessionWrites.set(record.id, record);
}

export function loadCustomTextures(): CustomTexture[] {
  try {
    const raw = hmscStoreGet(STORE_KEY);
    if (!raw) return withSessionWrites([]);
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return withSessionWrites([]);
    const out: CustomTexture[] = [];
    for (const t of j) {
      if (!t || typeof t.id !== 'string' || typeof t.label !== 'string') continue;
      // shader record — the pre-decal shape, unchanged; optionally a SURFACE
      // (layers/mode) on top, boundary-validated so a corrupt layer drops the
      // whole layers array rather than shipping a half-built composite.
      if (typeof t.shaderId === 'string' && Array.isArray(t.data)) {
        const layers = Array.isArray(t.layers) ? validateSurfaceLayers(t.layers) : undefined;
        out.push({
          id: t.id,
          label: t.label,
          shaderId: t.shaderId,
          data: t.data,
          ...(typeof t.underlayId === 'string' ? { underlayId: t.underlayId } : {}),
          ...(layers && layers.length ? { layers } : {}),
          ...(t.mode === 'span' ? { mode: 'span' as const } : {}),
        });
        continue;
      }
      // decal record — boundary-validated; a corrupt doc drops the record
      const doc = validateDecalDoc(t.decal);
      if (doc) out.push({ id: t.id, label: t.label, decal: doc });
    }
    return withSessionWrites(out);
  } catch {
    return withSessionWrites([]);
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
export function saveCustomTexture(label: string, shaderId: string, data: number[], opts?: { underlayId?: string | null }): CustomTexture {
  const list = loadCustomTextures();
  const id = mintId(list, label);
  const record: CustomTexture = {
    id,
    label: label.trim() || id,
    shaderId,
    data: [...data],
    ...(opts?.underlayId ? { underlayId: opts.underlayId } : {}),
  };
  write([...list, record]);
  rememberSessionWrite(record);
  return record;
}

export function paintUnderlayIdForTexture(id: string | null | undefined): string | null {
  if (!id) return null;
  let cur: string | null = id;
  const seen = new Set<string>();
  for (let i = 0; i < 16 && cur && !seen.has(cur); i += 1) {
    seen.add(cur);
    const tex = loadCustomTextures().find((t) => t.id === cur);
    if (tex?.shaderId === 'cutout-stencil' && tex.underlayId && tex.underlayId !== cur) {
      cur = tex.underlayId;
      continue;
    }
    return cur;
  }
  return id;
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
    const record: CustomTexture = { id: existing.id, label: label.trim() || existing.label, decal: valid };
    write(list.map((t) => (t.id === existing.id ? record : t)));
    rememberSessionWrite(record);
    return record;
  }
  const id = mintId(list, label);
  const record: CustomTexture = { id, label: label.trim() || id, decal: valid };
  write([...list, record]);
  rememberSessionWrite(record);
  return record;
}

export function removeCustomTexture(id: string): void {
  sessionWrites.delete(id);
  sessionRemoved.add(id);
  write(loadCustomTextures().filter((t) => t.id !== id));
}

export function __resetCustomTextureSessionCacheForTests(): void {
  sessionWrites.clear();
  sessionRemoved.clear();
}

// Subscribe a component to the stored-material list. Re-renders on save/remove.
export function useCustomTextures(): CustomTexture[] {
  const [list, setList] = useState<CustomTexture[]>(loadCustomTextures);
  useEffect(() => busOn(CHANGED, (next: CustomTexture[]) => setList(Array.isArray(next) ? next : loadCustomTextures())), []);
  return list;
}
