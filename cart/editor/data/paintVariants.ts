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
import { exists, listDir, mkdir, readFile, remove, writeFile } from '../../../runtime/hooks/fs';
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
  return variant;
}

export function removePaintVariant(pkg: PaintTarget, id: string): void {
  remove(jsonPath(pkg, id));
  remove(pngPath(pkg, id));
}
