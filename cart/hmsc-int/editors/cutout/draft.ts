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
  doc: PaintDocument;
};

export function buildDraft(args: { docId: string; name: string; srcPath: string | null; doc: PaintDocument }): CutoutDraft {
  return {
    kind: CUTOUT_DRAFT_KIND,
    version: CUTOUT_DRAFT_VERSION,
    docId: args.docId,
    name: args.name,
    srcPath: args.srcPath ?? null,
    doc: args.doc,
  };
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
  const doc = d.doc;
  if (!doc || doc.kind !== PAINT_DOC_KIND || doc.version !== PAINT_DOC_VERSION) return null;
  if (!doc.dims || typeof doc.dims.w !== 'number' || typeof doc.dims.h !== 'number') return null;
  if (!Array.isArray(doc.layers)) return null;
  return d as CutoutDraft;
}
