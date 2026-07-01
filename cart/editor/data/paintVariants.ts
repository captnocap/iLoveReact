// editor/data/paintVariants.ts — the editor-owned store of a model's PAINT VARIANTS: whole
// saved paintings of the model (DESIGN_INTAKE: "a ball painted a million ways, every one lives
// inside that single model's folder"). The editor reads hmsc-int's model store through a
// read-only snapshot, so paint variants can't live there — they live in the editor's own
// localstore, keyed by model id, and are read live (never baked into the snapshot package).
//
// A variant carries the full paint atlas (base64 RGBA) plus its detail, so loading it restores
// the painting faithfully — free-form strokes included, not just per-face fills.
import { getJson, setJson } from '../../../runtime/hooks/localstore';

export type PaintVariant = {
  id: string; // stable + unique within the model (a monotonic sequence)
  name: string; // user-facing label
  w: number;
  h: number;
  detail: number; // patch resolution the painting was made at
  data: string; // base64 RGBA atlas bytes (from __model_atlas_read)
};

const keyFor = (modelId: string) => `editor:paintvar:${modelId}`;

export function listPaintVariants(modelId: string): PaintVariant[] {
  return getJson<PaintVariant[]>(keyFor(modelId), []);
}

/** Append a new variant (auto-named "Painting N" when unnamed) and return it. */
export function savePaintVariant(
  modelId: string,
  v: { name?: string; w: number; h: number; detail: number; data: string },
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
  };
  setJson(keyFor(modelId), [...list, variant]);
  return variant;
}

export function removePaintVariant(modelId: string, id: string): void {
  setJson(keyFor(modelId), listPaintVariants(modelId).filter((v) => v.id !== id));
}
