// editor/data/paintVariants.ts — the editor-owned store of a model's PAINT VARIANTS: whole
// saved paintings of the model (DESIGN_INTAKE: "a ball painted a million ways, every one lives
// inside that single model's folder"). The editor reads hmsc-int's model store through a
// read-only snapshot, so paint variants can't live there — they live in the editor's own
// localstore, keyed by model id, and are read live (never baked into the snapshot package).
//
// A variant carries the painting's durable form. GUIDING_LIGHT ("store the strokes, not the
// pixels"): `format: 'program'` variants store the base64 STROKE PROGRAM (from
// __model_paint_program_read) — tiny, lossless, replayed once on load to rebuild the atlas.
// Legacy `format: 'atlas'` (or absent) variants store base64 RGBA and load via __model_atlas_apply;
// kept only so old saves still open. w/h/detail are display metadata.
import { getJson, setJson } from '../../../runtime/hooks/localstore';

export type PaintVariant = {
  id: string; // stable + unique within the model (a monotonic sequence)
  name: string; // user-facing label
  w: number;
  h: number;
  detail: number; // patch resolution the painting was made at
  data: string; // 'program' → base64 stroke program; 'atlas'/absent → base64 RGBA atlas
  format?: 'atlas' | 'program'; // absent = legacy atlas
};

const keyFor = (modelId: string) => `editor:paintvar:${modelId}`;

export function listPaintVariants(modelId: string): PaintVariant[] {
  return getJson<PaintVariant[]>(keyFor(modelId), []);
}

/** Append a new variant (auto-named "Painting N" when unnamed) and return it. */
export function savePaintVariant(
  modelId: string,
  v: { name?: string; w: number; h: number; detail: number; data: string; format?: 'atlas' | 'program' },
): PaintVariant {
  const list = listPaintVariants(modelId);
  const seq = list.reduce((max, x) => Math.max(max, Number(x.id) || 0), 0) + 1;
  const variant: PaintVariant = {
    id: String(seq),
    name: v.name?.trim() || `Painting ${seq}`,
    w: v.w,
    h: v.h,
    detail: v.detail,
    data: v.data,
    format: v.format ?? 'atlas',
  };
  setJson(keyFor(modelId), [...list, variant]);
  return variant;
}

export function removePaintVariant(modelId: string, id: string): void {
  setJson(keyFor(modelId), listPaintVariants(modelId).filter((v) => v.id !== id));
}
