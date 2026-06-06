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
import { PART_IDS } from '../../game/figure/shapes';
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
  if (m.family === 'figure' && (PART_IDS as readonly string[]).includes(m.part)) {
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

/** Strict gate: wrong kind/version/embedded-document shape → null (boot
 *  blank, never a half-restored canvas). */
export function parseDraft(text: string): CutoutDraft | null {
  let d: any;
  try { d = JSON.parse(text); } catch { return null; }
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
