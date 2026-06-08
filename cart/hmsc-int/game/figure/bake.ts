// game/figure/bake.ts — THE BAKE ENTRY (V2-AMENDED, ruled): author in JS,
// bake into the host.
//
// "If the model stays evaluation-based at runtime we are going to have a real
// problem." So: the editor authors documents/seeds; bakeFigure() evaluates
// everything evaluable AHEAD of time and emits one BakedFigure — plain,
// JSON-able, host-shaped data (geometry recipes + composited depth grids +
// texture descriptions + skeleton + hit volumes + anchors + wardrobe). The
// compile lowers BakedFigures into host data; the game instantiates them via
// the one physics system (V1) and the animation system (V6). Per-frame JS rig
// evaluation (render.tsx) is the EDITOR/LAB PREVIEW path only.
//
// The bake preserves the generated variety (the V2-AMENDED demand): seed in →
// deterministic figure out; a population is seeds.map(bakeFigureFromSeed).

import { hedDepthGrid, generateFace, type FaceStyle, type HedDocument, type HedLayer } from './hed';
import {
  HED_GRID_H, HED_GRID_W,
} from './hed';
import {
  BODY_SHAPES, PART_IDS, PART_LOD, PART_PRESETS, defaultProfile, footShapeGlobeExtras,
  type BodyShapeId, type FootShape, type PartId,
} from './shapes';
import { partsWithPelvisFallback, type BodyDocument } from './body';
import { attachOutfit, buildOutfit, outfitOf } from './outfit';
import { buildMeshFrame, type BodyAnchor, type BodyHitbox } from './rig';
import type { ClothingInstance } from './clothing';
import type { Bones } from './skeleton';

/** One part's compiled geometry recipe — what a Globe mesh bakes from. */
export type BakedPart = {
  part: PartId;
  params: {
    radius: 1;
    segments: number;
    rings: number;
    /** the composited displacement grid (head only) */
    displace?: number[];
    dCols?: number;
    dRows?: number;
    amount: number;
    profile: number[];
    scaleX?: number;
    scaleY: number;
    scaleZ?: number;
    /** FOOTMESH-0606: the foot's toe-box lean + flat sole (Globe deformers) */
    shiftZ?: number[];
    floorY?: number;
  };
};

/** The texture DESCRIPTION (not pixels): the unwrap recipe a capture or the
 *  compile rasterizes — skin base + the face's colored layers. */
export type BakedTexture = {
  width: number;
  height: number;
  skin: string;
  layers: HedLayer[];
};

/** One compiled figure — everything the game needs, nothing it re-evaluates. */
export type BakedFigure = {
  kind: 'baked-figure';
  version: 1;
  /** provenance: the seed (generated) and/or document title */
  seed?: number;
  title?: string;
  shape: BodyShapeId;
  parts: Record<PartId, BakedPart>;
  faceTexture: BakedTexture;
  skinTexture: BakedTexture;
  /** the canonical stand skeleton (animation poses FROM it at runtime) */
  bones: Bones;
  hitboxes: BodyHitbox[];
  anchors: BodyAnchor[];
  /** the stand wardrobe (garments re-pose off bones at runtime) */
  clothing: ClothingInstance[];
};

/** CLOTHSPLIT-0606: the bake dresses through the SAME attachment vocabulary
 *  everything else speaks — BakeWardrobe (the loose-fields shape) retired in
 *  favor of OutfitDocument; the seed path takes a partial via buildOutfit. */
export type BakeOutfit = Parameters<typeof buildOutfit>[0];

/** One part's Globe params from a face doc + its (live or composited) depth
 *  grid — the ONE place this recipe exists; the bake and the preview renderer
 *  both call it (no forked param assembly). */
export function partGlobeParams(
  id: PartId,
  face: Pick<HedDocument, 'amount' | 'scaleY'>,
  faceDepth: number[],
  draggedProfile?: number[],
  footShape?: FootShape | null,
): BakedPart['params'] {
  const preset = PART_PRESETS[id];
  const lod = PART_LOD[id];
  // FOOTMESH-0606: the foot's scales + toe-box lean + flat-cut sole come
  // from the document's FOOT SHAPE dials (defaults when absent) — the ONE
  // mapping lives in shapes.ts footShapeGlobeExtras.
  const foot = id === 'foot' ? footShapeGlobeExtras(footShape) : null;
  return {
    radius: 1,
    segments: lod.segments,
    rings: lod.rings,
    displace: id === 'head' ? faceDepth : undefined,
    dCols: id === 'head' ? HED_GRID_W : undefined,
    dRows: id === 'head' ? HED_GRID_H : undefined,
    amount: id === 'head' ? face.amount : 0,
    // radial-only law: the profile thins x/z; length is scaleY alone
    profile: id === 'head' ? (preset.profile ?? [1]) : (draggedProfile ?? defaultProfile(id)),
    scaleX: foot ? foot.scaleX : preset.scaleX,
    scaleY: id === 'head' ? face.scaleY : foot ? foot.scaleY : preset.scaleY,
    scaleZ: foot ? foot.scaleZ : preset.scaleZ,
    ...(foot ? { shiftZ: foot.shiftZ, floorY: foot.floorY } : {}),
  };
}

/** Bake a figure from a face document + body choices (the editor's output).
 *  CLOTHSPLIT-0606: the body bakes as a MESH FRAME; the outfit attaches to
 *  its bones — the same body-then-attachments composition every consumer
 *  speaks now. */
export function bakeFigure(
  face: HedDocument,
  shape: BodyShapeId = 'neutral',
  outfitArgs: BakeOutfit = {},
  opts: { sculpts?: BodyDocument['parts']; title?: string; footShape?: FootShape | null } = {},
): BakedFigure {
  const faceDepth = hedDepthGrid(face);
  const parts = {} as Record<PartId, BakedPart>;
  for (const id of PART_IDS) {
    parts[id] = { part: id, params: partGlobeParams(id, face, faceDepth, opts.sculpts?.[id]?.profile, opts.footShape) };
  }

  const frame = buildMeshFrame(shape, 'stand', 0, []);
  const outfit = buildOutfit(outfitArgs);
  const clothing = attachOutfit(frame.bones, outfit, shape, 'stand', 0, []);

  return {
    kind: 'baked-figure',
    version: 1,
    seed: face.metadata?.seed,
    title: opts.title ?? face.metadata?.title,
    shape,
    parts,
    faceTexture: { width: 512, height: 256, skin: face.skin, layers: face.layers },
    skinTexture: { width: 512, height: 256, skin: face.skin, layers: [] },
    bones: frame.bones,
    hitboxes: frame.hitboxes,
    anchors: frame.anchors,
    clothing,
  };
}

/** A whole-character document → figure: the adapter the characters stream's
 *  snapshot consumers call (compile, verify, the editor's bake trigger). The
 *  head's face document is reconstructed from the doc's own head part — the
 *  one place that mapping exists. NOTE: `.body.heldItem` is carried by the
 *  document but not by BakedFigure — item resolution is the V11 lane's (see
 *  CAPTURE.md ambiguity 5). */
export function bakeBodyDocument(doc: BodyDocument): BakedFigure {
  const face: HedDocument = {
    kind: 'hed',
    version: 1,
    cols: HED_GRID_W,
    rows: HED_GRID_H,
    skin: doc.skin,
    amount: doc.amount,
    scaleY: doc.headScaleY,
    sculpt: doc.parts.head?.sculpt ?? [],
    layers: doc.parts.head?.layers ?? [],
    metadata: { title: doc.metadata?.title },
  };
  // CLOTHSPLIT-0606: the wardrobe reads through the one attachment door —
  // new docs carry `outfit`, pre-split docs map their legacy fields
  const outfit = outfitOf(doc);
  return bakeFigure(face, doc.bodyShape ?? 'neutral', {
    top: outfit.top,
    bottoms: outfit.bottoms,
    print: outfit.print,
    accessories: outfit.accessories,
    // PELVISMESH-0606: pre-split documents bake the pelvis as the torso copy
    // (stream docs bypass parseBody, so the bake normalizes itself)
  }, { sculpts: partsWithPelvisFallback(doc.parts), title: doc.metadata?.title, footShape: doc.footShape });
}

/** Seed → figure, deterministically — the population path (variety preserved:
 *  the same seed always bakes the same citizen). */
export function bakeFigureFromSeed(
  seed: number,
  opts: { style?: FaceStyle; shape?: BodyShapeId; outfit?: BakeOutfit } = {},
): BakedFigure {
  const face = generateFace(seed, { style: opts.style });
  return bakeFigure(face, opts.shape ?? 'neutral', opts.outfit ?? {});
}

/** Every body shape is bakeable — the variety check the compile runs. */
export function bakePopulation(seeds: number[], shapes?: BodyShapeId[]): BakedFigure[] {
  const shapeIds = shapes ?? (Object.keys(BODY_SHAPES) as BodyShapeId[]);
  return seeds.map((seed, i) => bakeFigureFromSeed(seed, { shape: shapeIds[i % shapeIds.length] }));
}
