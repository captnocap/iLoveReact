// editors/cutout/draft.ts — the working-draft autosave document, pure.
//
// The original app debounced every edit into a session file and restored it
// on mount — the workspace "disk = truth" lifeline that makes hot reloads
// and crashes free. The route keeps that behavior WITHOUT spamming the V20
// stream (a stroke is a session note, not a full-document event): the live
// working state autosaves to ONE draft file beside the map sessions, and
// the route restores it on mount. Deliberate Saves still go to the stream;
// the draft is the in-between-saves safety net.
//
// Behavior reference: cart/cutout/state.ts autosave/restore (read, never
// imported).

import { PAINT_DOC_KIND, PAINT_DOC_VERSION, type PaintDocument } from '../paint/layers';
import { PAINT_TARGET_IDS } from '../../game/figure/shapes';
import { VEHICLE_PART_IDS } from '../../game/vehicle';
import type { ModelBinding } from './models';

export const CUTOUT_DRAFT_KIND = 'cutout-draft';
export const CUTOUT_DRAFT_VERSION = 1;
export const CUTOUT_DRAFT_PATH = 'cart/hmsc-int/sessions/_cutout_draft.json';

/** The draft: the working target's identity + the full painter document. */
export type CutoutDraft = {
  kind: typeof CUTOUT_DRAFT_KIND;
  version: number;
  /** the library id re-saves upsert into */
  docId: string;
  name: string;
  srcPath: string | null;
  /** the registry material under the paint (the material canvas), if any */
  textureId?: string | null;
  /** MODELPAINT-0605 (HOTDRAFT): the model slot under the paint, so a hot
   *  update mid-painting restores the MODEL target (saves keep applying to
   *  the model, never silently retarget the library). Arrived by addition —
   *  older drafts lack it. */
  model?: ModelBinding | null;
  doc: PaintDocument;
};

export function buildDraft(args: { docId: string; name: string; srcPath: string | null; textureId?: string | null; model?: ModelBinding | null; doc: PaintDocument }): CutoutDraft {
  return {
    kind: CUTOUT_DRAFT_KIND,
    version: CUTOUT_DRAFT_VERSION,
    docId: args.docId,
    name: args.name,
    srcPath: args.srcPath ?? null,
    textureId: args.textureId ?? null,
    model: args.model ?? null,
    doc: args.doc,
  };
}

/** A draft's model binding, validated against the REAL part vocabularies —
 *  a stale/garbage binding restores as no binding, never a half-target. */
export function draftModelBinding(d: CutoutDraft): ModelBinding | null {
  const m: any = d.model;
  if (!m || typeof m.docId !== 'string' || m.docId.length === 0) return null;
  if (m.family === 'figure' && (PAINT_TARGET_IDS as readonly string[]).includes(m.part)) {
    return { family: 'figure', docId: m.docId, part: m.part };
  }
  if (m.family === 'vehicle' && (VEHICLE_PART_IDS as readonly string[]).includes(m.part)) {
    return { family: 'vehicle', docId: m.docId, part: m.part };
  }
  return null;
}

export function serializeDraft(draft: CutoutDraft): string {
  return JSON.stringify(draft);
}

/** Strict gate on one draft VALUE: wrong kind/version/embedded-document
 *  shape → null (boot blank, never a half-restored canvas). */
export function validateDraft(d: any): CutoutDraft | null {
  if (!d || d.kind !== CUTOUT_DRAFT_KIND || d.version !== CUTOUT_DRAFT_VERSION) return null;
  if (typeof d.docId !== 'string' || d.docId.length === 0) return null;
  if (typeof d.name !== 'string') return null;
  if (d.srcPath !== null && typeof d.srcPath !== 'string') return null;
  // textureId arrived by addition — older drafts lack it (→ null)
  if (d.textureId !== undefined && d.textureId !== null && typeof d.textureId !== 'string') return null;
  // model arrived by addition (HOTDRAFT) — shape-checked here loosely; the
  // REAL gate is draftModelBinding (part vocabulary + family), which the
  // restore path consults. A malformed slot degrades to "no binding".
  if (d.model !== undefined && d.model !== null && typeof d.model !== 'object') return null;
  const doc = d.doc;
  if (!doc || doc.kind !== PAINT_DOC_KIND || doc.version !== PAINT_DOC_VERSION) return null;
  if (!doc.dims || typeof doc.dims.w !== 'number' || typeof doc.dims.h !== 'number') return null;
  if (!Array.isArray(doc.layers)) return null;
  return d as CutoutDraft;
}

export function parseDraft(text: string): CutoutDraft | null {
  let d: any;
  try { d = JSON.parse(text); } catch { return null; }
  return validateDraft(d);
}

// ── the DRAFT BOOK (MODELPAINT-0605 TATTOODRAFT) ─────────────────────────────
// The user's tattoo workflow hops between body parts mid-design. One draft
// slot meant switching targets dropped the previous part's unsaved strokes —
// so the lifeline grew into a BOOK: one slot per working target (each body
// part, each vehicle panel, the library canvas), MRU-ordered and capped.
// Every part keeps its own in-progress painting across hot updates AND
// target switches; the newest slot is what a fresh mount restores.

export const CUTOUT_DRAFTS_KIND = 'cutout-drafts';
export const CUTOUT_DRAFTS_VERSION = 1;
export const CUTOUT_DRAFTS_PATH = 'cart/hmsc-int/sessions/_cutout_drafts.json';

export type CutoutDraftBook = {
  kind: typeof CUTOUT_DRAFTS_KIND;
  version: number;
  /** MRU order, newest LAST — order[order.length - 1] is the current target */
  order: string[];
  slots: Record<string, CutoutDraft>;
};

export function emptyDraftBook(): CutoutDraftBook {
  return { kind: CUTOUT_DRAFTS_KIND, version: CUTOUT_DRAFTS_VERSION, order: [], slots: {} };
}

/** Parse the book; every slot passes the single-draft gate or is dropped —
 *  one torn slot never costs the others. */
export function parseDraftBook(text: string): CutoutDraftBook | null {
  let b: any;
  try { b = JSON.parse(text); } catch { return null; }
  if (!b || b.kind !== CUTOUT_DRAFTS_KIND || b.version !== CUTOUT_DRAFTS_VERSION) return null;
  if (!Array.isArray(b.order) || !b.slots || typeof b.slots !== 'object') return null;
  const book = emptyDraftBook();
  for (const key of b.order) {
    if (typeof key !== 'string') continue;
    const slot = validateDraft(b.slots[key]);
    if (!slot) continue;
    book.order.push(key);
    book.slots[key] = slot;
  }
  return book;
}

export function serializeDraftBook(book: CutoutDraftBook): string {
  return JSON.stringify(book);
}

/** Upsert one slot as the current (newest) target; evict the OLDEST slots
 *  beyond `cap` (never the one just written). Pure. */
export function upsertDraftSlot(book: CutoutDraftBook, key: string, draft: CutoutDraft, cap: number): CutoutDraftBook {
  const order = [...book.order.filter((k) => k !== key), key];
  const slots: Record<string, CutoutDraft> = { ...book.slots, [key]: draft };
  while (order.length > Math.max(1, cap)) {
    const evicted = order.shift()!;
    delete slots[evicted];
  }
  return { ...book, order, slots };
}

/** Drop one slot (a save landed — the model document carries it now). Pure. */
export function removeDraftSlot(book: CutoutDraftBook, key: string): CutoutDraftBook {
  if (!(key in book.slots)) return book;
  const slots = { ...book.slots };
  delete slots[key];
  return { ...book, order: book.order.filter((k) => k !== key), slots };
}

/** The newest slot — what a fresh mount restores. */
export function currentDraft(book: CutoutDraftBook): { key: string; draft: CutoutDraft } | null {
  const key = book.order[book.order.length - 1];
  return key ? { key, draft: book.slots[key] } : null;
}
