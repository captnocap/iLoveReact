// editor/data/paintVariants.ts — a model's PAINT VARIANTS, stored ON DISK inside the
// model's own package directory (req_2523: "each model gets its own directory … paints
// store variations of paint on the atlas … all those paintings live inside that one
// model's folder"). This used to stash variants in the editor's localstore (a db); that
// is exactly the storage the user does NOT want (git-bloat risk), so variants now live as
// real files under paints/ and a copied model folder carries its paintings with it.
//
// TWO FORMS PER VARIANT (the user's ruling):
//   paints/paint_<id>.json  — the durable record + the STROKE PROGRAM (game export form;
//                             GUIDING_LIGHT "store the strokes, not the pixels"), replayed
//                             on load via __model_paint_program_apply.
//   paints/paint_<id>.png   — the rasterized atlas, the EDITING SUBSTRATE / preview (what
//                             you see). Written from the live atlas via __image_write_png.
import { exists, listDir, mkdir, readFile, remove, stat, writeFile } from '../../../runtime/hooks/fs';
import { claimPackageDir } from './modelPackageStore';
import type { ModelPackage } from './types';

const host = globalThis as any;

// Package identity + name: the store resolves the package's REAL home by id and
// claims a name-slug dir for a model saved for the first time (req_2735), so
// paints always land beside the manifest they belong to.
export type PaintTarget = Pick<ModelPackage, 'kind' | 'id' | 'name'>;

export type PaintVariant = {
  id: string; // stable + unique within the model (a monotonic sequence)
  name: string; // user-facing label
  w: number;
  h: number;
  detail: number; // patch resolution the painting was made at
  data: string; // 'program' → base64 stroke program; 'atlas'/absent → base64 RGBA atlas
  format?: 'atlas' | 'program'; // absent = legacy atlas
  png?: string; // on-disk path of the rasterized substrate, when one was written
};

function paintsDir(pkg: PaintTarget): string { return `${claimPackageDir(pkg)}/paints`; }
function jsonPath(pkg: PaintTarget, id: string): string { return `${paintsDir(pkg)}/paint_${id}.json`; }
function pngPath(pkg: PaintTarget, id: string): string { return `${paintsDir(pkg)}/paint_${id}.png`; }
function blobPath(pkg: PaintTarget, id: string): string { return `${paintsDir(pkg)}/paint_${id}.blob`; }

/** Persist the DISPLAYED paint-space mesh beside a variant (paints/paint_<id>.blob).
 *  The variant's .png maps through this blob's island-space UVs (req_2833). The
 *  raw resident format also carries positions/normals, but those are only a save-
 *  time snapshot; placement rebinds the UVs to the current model geometry. Call
 *  when the variant is the APPLIED painting (save writes what you see; load just
 *  applied it). */
export function writePaintVariantMeshBlob(pkg: PaintTarget, id: string): boolean {
  const ok = host.__model_painted_mesh_write?.(blobPath(pkg, id)) === 1;
  if (ok) invalidatePaintSkins(pkg);
  return ok;
}

export function listPaintVariants(pkg: PaintTarget): PaintVariant[] {
  const dir = paintsDir(pkg);
  if (!exists(dir)) return [];
  const out: PaintVariant[] = [];
  for (const name of listDir(dir)) {
    if (!name.endsWith('.json')) continue;
    const text = readFile(`${dir}/${name}`);
    if (!text) continue;
    try {
      const v = JSON.parse(text) as PaintVariant;
      if (v && typeof v.id === 'string') out.push(v);
    } catch { /* skip a malformed variant, keep the rest */ }
  }
  return out.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
}

/** Append a new variant (auto-named "Painting N" when unnamed), writing its stroke-program
 *  json and — when atlas pixels are supplied — its rasterized .png substrate. Returns it. */
export function savePaintVariant(
  pkg: PaintTarget,
  v: { name?: string; w: number; h: number; detail: number; data: string; format?: 'atlas' | 'program'; atlasRgba?: string },
): PaintVariant {
  const dir = paintsDir(pkg);
  mkdir(dir); // recursive: creates the package + paints/ dir if this is the first save
  const list = listPaintVariants(pkg);
  const seq = list.reduce((max, x) => Math.max(max, Number(x.id) || 0), 0) + 1;
  const id = String(seq);
  // The rasterized substrate (real PNG) — best-effort; the variant still works without it.
  let png: string | undefined;
  if (v.atlasRgba && v.w > 0 && v.h > 0 && host.__image_write_png?.(pngPath(pkg, id), v.atlasRgba, v.w, v.h) === 1) {
    png = pngPath(pkg, id);
  }
  const variant: PaintVariant = {
    id,
    name: v.name?.trim() || `Painting ${seq}`,
    w: v.w,
    h: v.h,
    detail: v.detail,
    data: v.data,
    format: v.format ?? 'program',
    png,
  };
  writeFile(jsonPath(pkg, id), JSON.stringify(variant, null, 2));
  writePaintVariantMeshBlob(pkg, id); // save writes what you SEE — the paint-space mesh pairs with the .png
  return variant;
}

/** Overwrite an EXISTING variant in place (Save-back), keeping its id + name and refreshing
 *  its stroke program + .png substrate. Returns the updated variant, or null if the id is
 *  gone (the caller can then fall back to a fresh save). */
export function updatePaintVariant(
  pkg: PaintTarget,
  id: string,
  v: { w: number; h: number; detail: number; data: string; format?: 'atlas' | 'program'; atlasRgba?: string },
): PaintVariant | null {
  const existing = listPaintVariants(pkg).find((x) => x.id === id);
  if (!existing) return null;
  let png = existing.png;
  if (v.atlasRgba && v.w > 0 && v.h > 0 && host.__image_write_png?.(pngPath(pkg, id), v.atlasRgba, v.w, v.h) === 1) {
    png = pngPath(pkg, id);
  }
  const variant: PaintVariant = {
    ...existing,
    w: v.w,
    h: v.h,
    detail: v.detail,
    data: v.data,
    format: v.format ?? existing.format ?? 'program',
    png,
  };
  writeFile(jsonPath(pkg, id), JSON.stringify(variant, null, 2));
  writePaintVariantMeshBlob(pkg, id); // keep the paint-space mesh in step with the refreshed painting
  return variant;
}

export function removePaintVariant(pkg: PaintTarget, id: string): void {
  remove(jsonPath(pkg, id));
  remove(pngPath(pkg, id));
  remove(blobPath(pkg, id));
  invalidatePaintSkins(pkg);
}

// ── Paint SKINS: the placement-facing view of a model's paintings (req_2834) ──────────
// A stored painting is CATALOG VARIETY on the exported placeable (V24: "variety lives in
// the CATALOG — skin by catalog"): the build palette lists one entry per skin and the
// world registers one resident mesh per skin. A skin is PLACEABLE only when both halves
// exist on disk — paint_<id>.png (the atlas) AND paint_<id>.blob (the paint-space mesh
// it maps onto); a variant saved before the blob writer existed heals on its next
// Load/Save in the paint panel. Reads are light (listDir + a name sniff on the json's
// head — never a full parse of the multi-MB stroke program) and cached per package dir;
// every writer above invalidates.

export type PaintSkin = { id: string; name: string };

/** Paint blobs use the resident mesh contract: position3 + normal3 + uv2. */
export const PAINT_MESH_VERTEX_FLOATS = 8;
export const PAINT_MESH_VERTEX_BYTES = PAINT_MESH_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const PAINT_MESH_U_OFFSET = 6;
const PAINT_MESH_V_OFFSET = 7;

/** A skin is paint on the CURRENT model, never authority for an older geometry
 *  snapshot. Matching vertex cardinality is the strict boundary that lets the
 *  saved UV layout bind to today's positions/normals. A package without a base
 *  blob keeps the legacy skin usable until the model is next saved. */
export function paintSkinFitsCurrentMesh(currentMeshBytes: number | null, skinMeshBytes: number): boolean {
  const validSkin = skinMeshBytes >= PAINT_MESH_VERTEX_BYTES * 3
    && skinMeshBytes % PAINT_MESH_VERTEX_BYTES === 0;
  return validSkin && (currentMeshBytes === null || currentMeshBytes === skinMeshBytes);
}

/** Rebind a saved skin's UV layout to the model's latest geometry. The skin
 *  blob deliberately contributes ONLY uv2; current positions and normals stay
 *  authoritative so scaling/moving/editing a model cannot resurrect the mesh
 *  revision that happened to be present when the painting was saved. */
export function bindPaintSkinToCurrentMesh(current: Float32Array, skin: Float32Array): Float32Array | null {
  if (current.length !== skin.length || current.length < PAINT_MESH_VERTEX_FLOATS * 3) return null;
  if (current.length % PAINT_MESH_VERTEX_FLOATS !== 0) return null;
  const bound = new Float32Array(current);
  for (let i = 0; i < bound.length; i += PAINT_MESH_VERTEX_FLOATS) {
    bound[i + PAINT_MESH_U_OFFSET] = skin[i + PAINT_MESH_U_OFFSET]!;
    bound[i + PAINT_MESH_V_OFFSET] = skin[i + PAINT_MESH_V_OFFSET]!;
  }
  return bound;
}

type PaintSkinCache = { currentMeshStamp: string; skins: PaintSkin[] };
const skinsCache = new Map<string, PaintSkinCache>();

function invalidatePaintSkins(pkg: PaintTarget): void {
  skinsCache.delete(paintsDir(pkg));
}

/** The variant's user-facing name without parsing the whole multi-MB json: the writer
 *  puts id/name first (JSON.stringify property order), so the head carries it. */
function sniffVariantName(text: string, fallback: string): string {
  const m = /"name":\s*"((?:[^"\\]|\\.)*)"/.exec(text.slice(0, 512));
  return m ? m[1]!.replace(/\\(.)/g, '$1') : fallback;
}

/** The model's PLACEABLE paint skins: every variant with an atlas png and a
 *  paint-space UV blob whose vertex cardinality fits the current model. A
 *  topology-stale skin stays stored but leaves the palette until Load + Save
 *  rebuilds it against the current mesh. */
export function listPaintSkins(pkg: PaintTarget): PaintSkin[] {
  const dir = paintsDir(pkg);
  const currentMesh = stat(`${claimPackageDir(pkg)}/mesh/base.blob`);
  const currentMeshBytes = currentMesh?.size ?? null;
  // The stamp makes a Save/Export that changes topology invalidate the list
  // without coupling modelPackageStore back to this module (which would form a
  // circular dependency). Same-cardinality shape edits remain valid skins.
  const currentMeshStamp = currentMesh ? `${currentMesh.size}:${currentMesh.mtimeMs}` : 'missing';
  const hit = skinsCache.get(dir);
  if (hit?.currentMeshStamp === currentMeshStamp) return hit.skins;
  const out: PaintSkin[] = [];
  if (exists(dir)) {
    for (const name of listDir(dir)) {
      const m = /^paint_(\w+)\.blob$/.exec(name);
      if (!m) continue;
      const id = m[1]!;
      const skinMesh = stat(blobPath(pkg, id));
      if (!skinMesh || !paintSkinFitsCurrentMesh(currentMeshBytes, skinMesh.size)) continue;
      if (!exists(pngPath(pkg, id))) continue;
      const head = readFile(jsonPath(pkg, id));
      out.push({ id, name: head ? sniffVariantName(head, `Painting ${id}`) : `Painting ${id}` });
    }
  }
  out.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  skinsCache.set(dir, { currentMeshStamp, skins: out });
  return out;
}
