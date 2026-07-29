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
//                             you see). Native save finalization keeps only exact UV
//                             coverage + its filter gutter (req_3520).
//
// FULL LOOKS (req_3439): a variant is the model's whole current LOOK, not only brush
// strokes — an imported texture atlas plus the UV layout mapped over it is a look with
// ZERO strokes, and it saves/loads the same way the package's base painting does
// (base.paint.json v4 parity): a raster base + the exact per-face UV geometry + the
// stroke program on top. With strokes, the baseline BENEATH them persists as
// paints/paint_<id>.base.png; with none, the composite .png doubles as the base.
import { exists, listDir, mkdir, readFile, readFileBase64, remove, stat, writeFile } from '../../../runtime/hooks/fs';
import { claimPackageDir, parsedUvCornerGeometry } from './modelPackageStore';
import { hasUvCoverageRasterWriter, writeUvCoverageRasters, type UvCoverageSummary } from './uvCoverageRaster';
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
  data: string; // 'program' → base64 stroke program ('' when the look carries no strokes); 'atlas'/absent → base64 RGBA atlas
  format?: 'atlas' | 'program'; // absent = legacy atlas
  png?: string; // on-disk path of the rasterized substrate, when one was written
  // Full-LOOK restore record (req_3439, base.paint.json v4 parity). When present the
  // variant rebuilds an imported-texture look exactly: import the raster base, apply
  // the exact UV geometry, then replay any strokes over that base.
  cornerUv?: number[]; // six absolute-atlas floats per render face (__model_uv_geometry_apply)
  rasterBase?: true; // a restore raster exists on disk: basePng when strokes ride on top, else png
  basePng?: string; // the baseline BENEATH the strokes (paint_<id>.base.png); absent when data is ''
  uvCoverage?: UvCoverageSummary; // save-time discarded-pixel proof (req_3520)
};

function paintsDir(pkg: PaintTarget): string { return `${claimPackageDir(pkg)}/paints`; }
function jsonPath(pkg: PaintTarget, id: string): string { return `${paintsDir(pkg)}/paint_${id}.json`; }
function pngPath(pkg: PaintTarget, id: string): string { return `${paintsDir(pkg)}/paint_${id}.png`; }
function blobPath(pkg: PaintTarget, id: string): string { return `${paintsDir(pkg)}/paint_${id}.blob`; }
function basePngPath(pkg: PaintTarget, id: string): string { return `${paintsDir(pkg)}/paint_${id}.base.png`; }

/** What savers pass to capture the model's current look alongside the program. */
type PaintLookInput = {
  w: number;
  h: number;
  data: string;
  cornerUv?: number[] | null; // exact UV geometry (exactUvCornersFromAtlasTriangles)
  baselineRgba?: string; // base64 RGBA beneath the strokes (__model_paint_baseline_read)
};

type PaintRasterWrite = {
  png?: string;
  basePng?: string;
  uvCoverage?: UvCoverageSummary;
};

/** Finalize the resident raster through the native UV-coverage door. The old base64
 * writer remains a lazy failure/back-compat path, but successful large-atlas saves
 * never copy their pixels into the JS heap. */
function writeVariantRasters(
  pkg: PaintTarget,
  id: string,
  v: PaintLookInput & { atlasRgba?: string },
): PaintRasterWrite {
  const compositePath = pngPath(pkg, id);
  const baselinePath = basePngPath(pkg, id);
  const native = writeUvCoverageRasters(compositePath, v.data ? baselinePath : null, v.w, v.h);
  if (native) {
    if (!native.baselinePath && exists(baselinePath)) remove(baselinePath);
    return {
      png: native.compositePath,
      ...(native.baselinePath ? { basePng: native.baselinePath } : {}),
      uvCoverage: native.coverage,
    };
  }

  // Only a failed native attempt needs to fetch the large raster. Older hosts already
  // supplied these strings through readCurrentPaint, so their fallback remains unchanged.
  let atlasRgba = v.atlasRgba;
  let baselineRgba = v.baselineRgba;
  if (!atlasRgba && hasUvCoverageRasterWriter()) {
    try {
      const atlas = JSON.parse(host.__model_atlas_read?.() || '{}');
      if (atlas?.w === v.w && atlas?.h === v.h && typeof atlas.data === 'string') atlasRgba = atlas.data;
    } catch { /* the caller will receive a raster-less save, as before */ }
    if (v.data && !baselineRgba) {
      const baseline = host.__model_paint_baseline_read?.();
      if (typeof baseline === 'string') baselineRgba = baseline;
    }
  }

  let png: string | undefined;
  if (atlasRgba && v.w > 0 && v.h > 0
    && host.__image_write_png?.(compositePath, atlasRgba, v.w, v.h) === 1) {
    png = compositePath;
  }
  let basePng: string | undefined;
  if (v.data && baselineRgba && v.w > 0 && v.h > 0
    && host.__image_write_png?.(baselinePath, baselineRgba, v.w, v.h) === 1) {
    basePng = baselinePath;
  }
  if (!basePng && exists(baselinePath)) remove(baselinePath);
  return { png, basePng };
}

/** Full-look metadata follows only files proven to have landed. With strokes the
 * baseline is distinct; without strokes the optimized composite doubles as the base. */
function writeLookFields(
  v: PaintLookInput,
  rasters: PaintRasterWrite,
): Pick<PaintVariant, 'cornerUv' | 'rasterBase' | 'basePng'> {
  const hasRasterBase = !!rasters.basePng || (!v.data && !!rasters.png);
  if (!v.cornerUv?.length || !hasRasterBase) return {};
  return {
    cornerUv: v.cornerUv.slice(),
    rasterBase: true,
    ...(rasters.basePng ? { basePng: rasters.basePng } : {}),
  };
}

function withValidatedCoverage(v: PaintVariant): PaintVariant {
  const c = v.uvCoverage;
  const valid = !!c
    && Number.isSafeInteger(c.totalPixels) && c.totalPixels === v.w * v.h
    && Number.isSafeInteger(c.keptPixels) && c.keptPixels > 0
    && Number.isSafeInteger(c.clearedPixels) && c.clearedPixels >= 0
    && c.keptPixels + c.clearedPixels === c.totalPixels
    && Number.isSafeInteger(c.gutterTexels) && c.gutterTexels >= 0
    && Number.isSafeInteger(c.pngBytes) && c.pngBytes >= 0
    && (c.basePngBytes === undefined || (Number.isSafeInteger(c.basePngBytes) && c.basePngBytes >= 0));
  if (!c || valid) return v;
  const { uvCoverage: _u, ...rest } = v;
  return rest;
}

/** A loaded variant only advertises a full look when the record is coherent AND its
 *  raster base is actually on disk — a half-restorable look must fall back to the
 *  plain program/atlas path instead of importing nothing. */
function withValidatedLook(raw: PaintVariant): PaintVariant {
  const v = withValidatedCoverage(raw);
  if (v.rasterBase === undefined && v.cornerUv === undefined && v.basePng === undefined) return v;
  const cornerUv = parsedUvCornerGeometry(v.cornerUv);
  const raster = v.basePng ?? v.png;
  if (v.rasterBase === true && cornerUv && raster && exists(raster)) return v;
  const { cornerUv: _c, rasterBase: _r, basePng: _b, ...rest } = v;
  return rest;
}

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
      if (v && typeof v.id === 'string') out.push(withValidatedLook(v));
    } catch { /* skip a malformed variant, keep the rest */ }
  }
  return out.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
}

/** Append a new variant (auto-named "Painting N" when unnamed), writing its stroke-program
 *  json, its rasterized .png substrate, and — when the caller captured the current look —
 *  the full-look restore record (cornerUv + raster base). Returns it. */
export function savePaintVariant(
  pkg: PaintTarget,
  v: { name?: string; w: number; h: number; detail: number; data: string; format?: 'atlas' | 'program'; atlasRgba?: string } & Partial<PaintLookInput>,
): PaintVariant {
  const dir = paintsDir(pkg);
  mkdir(dir); // recursive: creates the package + paints/ dir if this is the first save
  const list = listPaintVariants(pkg);
  const seq = list.reduce((max, x) => Math.max(max, Number(x.id) || 0), 0) + 1;
  const id = String(seq);
  const rasters = writeVariantRasters(pkg, id, v);
  const variant: PaintVariant = {
    id,
    name: v.name?.trim() || `Painting ${seq}`,
    w: v.w,
    h: v.h,
    detail: v.detail,
    data: v.data,
    format: v.format ?? 'program',
    png: rasters.png,
    ...writeLookFields(v, rasters),
    ...(rasters.uvCoverage ? { uvCoverage: rasters.uvCoverage } : {}),
  };
  writeFile(jsonPath(pkg, id), JSON.stringify(variant, null, 2));
  writePaintVariantMeshBlob(pkg, id); // save writes what you SEE — the paint-space mesh pairs with the .png
  return variant;
}

/** Overwrite an EXISTING variant in place (Save-back), keeping its id + name and refreshing
 *  its stroke program, .png substrate, and full-look record. Returns the updated variant,
 *  or null if the id is gone (the caller can then fall back to a fresh save). */
export function updatePaintVariant(
  pkg: PaintTarget,
  id: string,
  v: { w: number; h: number; detail: number; data: string; format?: 'atlas' | 'program'; atlasRgba?: string } & Partial<PaintLookInput>,
): PaintVariant | null {
  const existing = listPaintVariants(pkg).find((x) => x.id === id);
  if (!existing) return null;
  const rasters = writeVariantRasters(pkg, id, v);
  const png = rasters.png ?? existing.png;
  // Strip the old look fields before spreading: an update that lost its look (or its
  // strokes) must not inherit a stale cornerUv/raster-base claim from the previous save.
  const { cornerUv: _c, rasterBase: _r, basePng: _b, uvCoverage: _u, ...kept } = existing;
  const variant: PaintVariant = {
    ...kept,
    w: v.w,
    h: v.h,
    detail: v.detail,
    data: v.data,
    format: v.format ?? existing.format ?? 'program',
    png,
    ...writeLookFields(v, rasters),
    ...(rasters.uvCoverage ? { uvCoverage: rasters.uvCoverage } : {}),
  };
  writeFile(jsonPath(pkg, id), JSON.stringify(variant, null, 2));
  writePaintVariantMeshBlob(pkg, id); // keep the paint-space mesh in step with the refreshed painting
  return variant;
}

/** Rename a variant in place (req_3448) — identity, files, and the painting
 *  itself are untouched; only the user-facing label changes. The build palette
 *  and quick-menu chips read the same json, so the new name shows everywhere.
 *  Returns the renamed variant, or null when the id is gone or the name empty. */
export function renamePaintVariant(pkg: PaintTarget, id: string, name: string): PaintVariant | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = listPaintVariants(pkg).find((x) => x.id === id);
  if (!existing || existing.name === trimmed) return existing ?? null;
  // Spread keeps the writer's property order (id, name first) — the skins list
  // sniffs the name from the json HEAD without parsing the multi-MB program.
  const variant: PaintVariant = { ...existing, name: trimmed };
  writeFile(jsonPath(pkg, id), JSON.stringify(variant, null, 2));
  invalidatePaintSkins(pkg);
  return variant;
}

export function removePaintVariant(pkg: PaintTarget, id: string): void {
  remove(jsonPath(pkg, id));
  remove(pngPath(pkg, id));
  remove(basePngPath(pkg, id));
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

/** The saved painting the model's CURRENT base look IS, or null when it matches
 *  none (a diverged/unsaved look). Save Painting writes atlases/base.png and
 *  paint_<id>.png from the same atlas readback in the same call, so an
 *  un-diverged look compares byte-identical; a false negative merely keeps the
 *  fallback chip. The world quick menu collapses its redundant "Current" chip
 *  with this (req_3459: "Current … is also the same thing as honey_crunch"). */
export function basePaintingSkinId(pkg: PaintTarget): string | null {
  const basePath = `${claimPackageDir(pkg)}/atlases/base.png`;
  const base = stat(basePath);
  if (!base) return null;
  let baseB64: string | null | undefined;
  for (const skin of listPaintSkins(pkg)) {
    const skinPng = stat(pngPath(pkg, skin.id));
    if (!skinPng || skinPng.size !== base.size) continue;
    baseB64 ??= readFileBase64(basePath);
    if (baseB64 && readFileBase64(pngPath(pkg, skin.id)) === baseB64) return skin.id;
  }
  return null;
}
