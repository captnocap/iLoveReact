// editors/cutout/stream.ts — the V20 per-concern stream for the cutout
// painter route: the LIBRARY of painted documents (skins/textures in
// progress) and extracted cutout assets, defined in ONE registration
// (log name + materializer — the data layer's incompleteness guard).
//
// The materialized snapshot is the library other editors consume: every
// SAVED working document (the full PaintDocument — re-openable, re-editable)
// and every EXTRACTED cutout (a named region: source-resolution RLE mask +
// source path + a coarse preview cell set), keyed by id, in authoring order.
// Events carry the RESULTING artifact, not the edit verb — strokes, layer
// ops and smart clicks are editor-side and ride the sessions stream as
// labeled notes; the materializer stays a dumb upsert so the round-trip
// save → stream → snapshot → reopen is exact by construction. Unknown event
// kinds pass through untouched (V20: schema evolution by addition; old logs
// stay valid forever).
//
// This def lives route-side (not game/) because nothing in the game compile
// consumes painted assets yet; when characters skins / build-catalog
// textures start loading them, the def graduates behind a game/ door — the
// stream FILE and its history stay valid as-is (V20: the log never moves).
// Recorded as ambiguity #1 in CAPTURE.md.

import type { StreamDef } from '../../data';
import type { RleGrid } from '@reactjit/workspace/rle';
import type { PaintDocument } from '../paint/layers';

/** One saved working document — the full painter state, re-openable. */
export type SavedPaintDoc = {
  id: string;
  name: string;
  /** the image under the paint (null = blank canvas) */
  srcPath: string | null;
  /** the registry material under the paint (the material canvas), if any */
  textureId?: string | null;
  doc: PaintDocument;
};

/** One extracted cutout — a named selected region, usable as an asset. */
export type CutoutAsset = {
  id: string;
  name: string;
  dims: { w: number; h: number };
  /** binary RLE of the selection at source resolution (1 = in the cutout) */
  mask: RleGrid;
  /** sparse set-cell indices at the painter's overlayRes — the cheap
   *  library-preview shape (PaintQuad cells mode renders it directly) */
  preview: number[];
  /** selected-pixel count (bookkeeping the UI shows; derivable from mask) */
  pixels: number;
  /** the image the region was cut from (null = cut from a blank canvas) */
  srcPath: string | null;
  /** the registry material the region was painted ON (the /cutout material
   *  canvas — textures.tsx id), when the working surface was one */
  textureId?: string | null;
  /** the look's color slots at extraction (fill/background candidates for
   *  materializing the cutout as a stencil material) */
  colors?: string[];
  /** the working document it was extracted from */
  docId: string | null;
};

export type CutoutEvent =
  | { kind: 'saved'; id: string; name: string; srcPath: string | null; textureId?: string | null; doc: PaintDocument }
  | { kind: 'extracted'; id: string; asset: CutoutAsset }
  | { kind: 'removed'; id: string; target: 'document' | 'cutout' };

export type CutoutStreamState = {
  /** saved working documents, by id */
  documents: Record<string, SavedPaintDoc>;
  /** first-saved order — the library rail's stable listing */
  docOrder: string[];
  /** extracted cutout assets, by id */
  cutouts: Record<string, CutoutAsset>;
  cutoutOrder: string[];
};

export const cutoutStream: StreamDef<CutoutStreamState, CutoutEvent> = Object.freeze({
  name: 'cutout',
  initial: (): CutoutStreamState => ({ documents: {}, docOrder: [], cutouts: {}, cutoutOrder: [] }),
  apply: (state: CutoutStreamState, event: CutoutEvent): CutoutStreamState => {
    switch (event?.kind) {
      case 'saved': {
        const known = event.id in state.documents;
        return {
          ...state,
          documents: {
            ...state.documents,
            [event.id]: { id: event.id, name: event.name, srcPath: event.srcPath ?? null, textureId: event.textureId ?? null, doc: event.doc },
          },
          docOrder: known ? state.docOrder : [...state.docOrder, event.id],
        };
      }
      case 'extracted': {
        const known = event.id in state.cutouts;
        return {
          ...state,
          cutouts: { ...state.cutouts, [event.id]: event.asset },
          cutoutOrder: known ? state.cutoutOrder : [...state.cutoutOrder, event.id],
        };
      }
      case 'removed': {
        if (event.target === 'document') {
          if (!(event.id in state.documents)) return state;
          const documents = { ...state.documents };
          delete documents[event.id];
          return { ...state, documents, docOrder: state.docOrder.filter((id) => id !== event.id) };
        }
        if (!(event.id in state.cutouts)) return state;
        const cutouts = { ...state.cutouts };
        delete cutouts[event.id];
        return { ...state, cutouts, cutoutOrder: state.cutoutOrder.filter((id) => id !== event.id) };
      }
      default:
        // Unknown kinds are future additions — old materializers skip them.
        return state;
    }
  },
});

/** The library in listing order — what the rail renders. */
export function libraryDocuments(state: CutoutStreamState): SavedPaintDoc[] {
  return state.docOrder.map((id) => state.documents[id]).filter(Boolean);
}

export function libraryCutouts(state: CutoutStreamState): CutoutAsset[] {
  return state.cutoutOrder.map((id) => state.cutouts[id]).filter(Boolean);
}
