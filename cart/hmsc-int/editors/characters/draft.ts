// editors/characters/draft.ts — the editor's working character (the DRAFT)
// and its lossless exchange with the kit's documents.
//
// The draft is document-shaped state plus edit affordances (region slider
// values, which bake INTO the sculpt on export). Pure functions only — the
// route owns React state, this module owns what the state MEANS. Behavior
// reference: cart/head_lab/index.tsx applyDoc/loadBody/saveHead/saveBody
// (read, never imported).
//
// The .hed coherence law carried over: when a face document arrives, its
// sculpt RESIDUE moves into the draft's head grid and the kept face document
// zeroes its sculpt — depth never double-counts (the residue lives in one
// place at a time).

import {
  HED_GRID_H, HED_GRID_W, buildHed, type HedDocument,
} from '../../game/figure/hed';
import { buildBody, type BodyDocument } from '../../game/figure/body';
import {
  DEFAULT_BOTTOMS, PART_IDS, PROFILE_N, defaultProfile,
  type BodyPoseId, type BodyShapeId, type BottomsId, type ClothingAccessoryId, type ClothingId, type ClothingSkinId, type PartId,
} from '../../game/figure/shapes';
import { applyRegionValues, type RegionValues } from './regions';

export const GRID_CELLS = HED_GRID_W * HED_GRID_H;

export const DRAFT_DEFAULTS = Object.freeze({
  skin: '#caa07a',
  /** world units of displacement at full depth (head_lab's default) */
  amount: 0.35,
  /** head skull stretch */
  headScaleY: 1.2,
  bodyShape: 'neutral' as BodyShapeId,
  clothing: 'tee' as ClothingId,
  clothingSkin: 'plain' as ClothingSkinId,
  bodyPose: 'stand' as BodyPoseId,
  /** the editor's skin-tone palette */
  skins: ['#caa07a', '#8d5a3c', '#e0b48c', '#a9785a'],
});

export type CharacterDraft = {
  skin: string;
  amount: number;
  headScaleY: number;
  /** per-part hand-sculpt grids, signed floats −1..1 (48×24 row-major) */
  grids: Record<PartId, number[]>;
  /** per-part dragged silhouette outlines (PROFILE_N radius samples) */
  profiles: Record<PartId, number[]>;
  /** per-part region slider values — an edit affordance; baked into the
   *  sculpt on export, never stored in the document */
  regions: Record<PartId, RegionValues>;
  /** the face document (layers only — its sculpt stays zeroed; the residue
   *  lives in grids.head per the coherence law) */
  face: HedDocument | null;
  bodyShape: BodyShapeId;
  clothing: ClothingId;
  bottoms: BottomsId;
  clothingSkin: ClothingSkinId;
  accessories: ClothingAccessoryId[];
  /** opaque id into the items registry; 'none' = empty hands */
  heldItem: string;
  bodyPose: BodyPoseId;
  /** MODELPAINT-0605: the document's painted overlays, carried OPAQUE
   *  through the edit cycle — /cutout authors them; a /characters save must
   *  never wipe them (pinned in characters.test.ts). */
  paint?: BodyDocument['paint'];
};

export const emptyGrid = (): number[] => new Array(GRID_CELLS).fill(0);

const perPart = <T>(make: (id: PartId) => T): Record<PartId, T> =>
  Object.fromEntries(PART_IDS.map((id) => [id, make(id)])) as Record<PartId, T>;

export function emptyDraft(): CharacterDraft {
  return {
    skin: DRAFT_DEFAULTS.skin,
    amount: DRAFT_DEFAULTS.amount,
    headScaleY: DRAFT_DEFAULTS.headScaleY,
    grids: perPart(() => emptyGrid()),
    profiles: perPart((id) => defaultProfile(id)),
    regions: perPart(() => ({})),
    face: null,
    bodyShape: DRAFT_DEFAULTS.bodyShape,
    clothing: DRAFT_DEFAULTS.clothing,
    bottoms: DEFAULT_BOTTOMS[DRAFT_DEFAULTS.clothing],
    clothingSkin: DRAFT_DEFAULTS.clothingSkin,
    accessories: [],
    heldItem: 'none',
    bodyPose: DRAFT_DEFAULTS.bodyPose,
  };
}

/** A part's EFFECTIVE sculpt: hand grid + region sliders composited. */
export function draftPartGrid(draft: CharacterDraft, part: PartId): number[] {
  return applyRegionValues(part, draft.grids[part], draft.regions[part]);
}

/** Apply a face document to the draft (the .hed coherence law): knobs from
 *  the doc, sculpt residue into the head grid, layers kept with sculpt
 *  zeroed, head region sliders reset (their effect is in the residue now). */
export function draftWithFace(draft: CharacterDraft, doc: HedDocument): CharacterDraft {
  return {
    ...draft,
    skin: doc.skin,
    amount: doc.amount,
    headScaleY: doc.scaleY,
    grids: { ...draft.grids, head: doc.sculpt.map((b) => b / 127) },
    regions: { ...draft.regions, head: {} },
    face: { ...doc, sculpt: emptyGrid().map(() => 0) },
  };
}

/** The draft's face as a standalone .hed document (the "save head" export):
 *  composited head sculpt + the face layers, current knobs. */
export function draftToHed(draft: CharacterDraft, title?: string): HedDocument {
  return buildHed({
    skin: draft.skin,
    amount: draft.amount,
    scaleY: draft.headScaleY,
    sculpt: draftPartGrid(draft, 'head'),
    layers: draft.face?.layers ?? [],
    title,
    seed: draft.face?.metadata?.seed,
  });
}

/** The draft as the whole-character document the stream stores and the bake
 *  consumes. Region sliders bake INTO each part's sculpt here. The painted
 *  overlays ride through opaque (MODELPAINT-0605 — never wiped by a save). */
export function draftToDocument(draft: CharacterDraft, title?: string): BodyDocument {
  const paint = draft.paint && Object.keys(draft.paint).length > 0 ? { paint: draft.paint } : {};
  return {
    ...paint,
    ...buildBody({
    skin: draft.skin,
    amount: draft.amount,
    headScaleY: draft.headScaleY,
    sculpts: perPart((id) => draftPartGrid(draft, id)),
    profiles: perPart((id) => draft.profiles[id].slice()),
    headLayers: draft.face?.layers ?? [],
    bodyShape: draft.bodyShape,
    clothing: draft.clothing,
    bottoms: draft.bottoms,
    clothingSkin: draft.clothingSkin,
    clothingAccessories: draft.accessories,
    heldItem: draft.heldItem === 'none' ? undefined : draft.heldItem,
    bodyPose: draft.bodyPose,
    title,
    }),
  };
}

/** A stored document back into a working draft (the roster "load" path).
 *  Regions come back empty — their effect is already in the sculpts. */
export function draftFromDocument(doc: BodyDocument): CharacterDraft {
  const clothing = doc.clothing ?? DRAFT_DEFAULTS.clothing;
  const headLayers = doc.parts.head?.layers ?? [];
  return {
    skin: doc.skin,
    amount: doc.amount,
    headScaleY: doc.headScaleY,
    grids: perPart((id) => {
      const sculpt = doc.parts[id]?.sculpt ?? [];
      return sculpt.length === GRID_CELLS ? sculpt.map((b) => b / 127) : emptyGrid();
    }),
    profiles: perPart((id) => {
      const profile = doc.parts[id]?.profile;
      return profile && profile.length === PROFILE_N ? profile.slice() : defaultProfile(id);
    }),
    regions: perPart(() => ({})),
    face: headLayers.length > 0
      ? {
          kind: 'hed', version: 1, cols: HED_GRID_W, rows: HED_GRID_H,
          skin: doc.skin, amount: doc.amount, scaleY: doc.headScaleY,
          sculpt: emptyGrid(), layers: headLayers,
          metadata: doc.metadata?.title ? { title: doc.metadata.title } : undefined,
        }
      : null,
    bodyShape: doc.bodyShape ?? DRAFT_DEFAULTS.bodyShape,
    clothing,
    bottoms: doc.bottoms ?? DEFAULT_BOTTOMS[clothing],
    clothingSkin: doc.clothingSkin ?? DRAFT_DEFAULTS.clothingSkin,
    accessories: doc.clothingAccessories ?? [],
    heldItem: doc.heldItem ?? 'none',
    bodyPose: doc.bodyPose ?? DRAFT_DEFAULTS.bodyPose,
    paint: doc.paint,
  };
}
