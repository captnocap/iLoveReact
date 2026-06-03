// Body parts — the user's decomposition: a head egg, a tall+wide torso
// barrel, ONE limb pipe (placed eight times: upper/fore arms AND thighs/
// shins — "use the pipes for the legs"), and wide-but-flat blocks for hands
// and feet. Every part is the SAME sculptable Globe surface wearing a
// different silhouette profile, so the unwrap painter, the depth brush, the
// .hed layers, and the animation machinery work identically on all of them.
//
// ASSEMBLY is the figure-view layout: where each part instance sits on a
// standing body (~1.9 units tall, ground at y=0). Mirrored limbs reuse the
// same part doc — sculpt the pipe once, both arms and both legs follow.

import type { HedLayer } from './hed';

export type PartId = 'head' | 'torso' | 'pipe' | 'hand' | 'foot';
export const PART_IDS: PartId[] = ['head', 'torso', 'pipe', 'hand', 'foot'];

export type PartPreset = {
  label: string;
  /** silhouette: lerped radius multipliers along v (see Globe.profile). */
  profile?: number[];
  scaleX?: number;
  scaleY: number;
  scaleZ?: number;
};

export const PART_PRESETS: Record<PartId, PartPreset> = {
  head: { label: 'head', scaleY: 1.2 },
  // taller and wider than the egg: shoulders → chest → waist → hips
  torso: { label: 'torso', scaleY: 1.5, scaleZ: 0.62, profile: [0.62, 1.0, 0.94, 0.88, 0.6] },
  // the limb pipe: a long segment, slightly waisted, rounded ends so two of
  // them visually connect at an elbow/knee without a seam gap
  pipe: { label: 'pipe', scaleY: 2.2, profile: [0.45, 0.85, 0.8, 0.85, 0.45] },
  // wider than tall, flattened front-to-back
  hand: { label: 'hand', scaleY: 1.0, scaleZ: 0.45, profile: [0.55, 1.0, 0.85] },
  // like the hand but squat and stretched forward (toes at -Z, the facing
  // convention every sculpt surface shares)
  foot: { label: 'foot', scaleY: 0.6, scaleX: 0.8, scaleZ: 1.5, profile: [0.7, 1.0, 0.9] },
};

export type BodyInstance = {
  part: PartId;
  position: [number, number, number];
  scale: number;
  /** degrees [rx, ry, rz] — small rz tilts hang the limbs naturally. */
  rotation?: [number, number, number];
};

// Standing figure, ground at y=0, ~2.2 units tall. Parts are radius-1 globes,
// so a part's half-extents ≈ scale × (profile·scaleX/Y/Z) — sized here so
// limbs sit CLEAR of the torso (arms out at the sides, legs spread a touch)
// instead of nesting inside it like a matryoshka. Pipes still kiss at the
// elbows/knees on purpose — the rounded profile ends read as the joint.
export const ASSEMBLY: BodyInstance[] = [
  { part: 'torso', position: [0, 1.3, 0], scale: 0.3 },
  { part: 'head', position: [0, 1.97, 0], scale: 0.21 },
  // arms: shoulder pipe + forearm pipe + hand, hanging just off the torso
  { part: 'pipe', position: [-0.46, 1.38, 0], scale: 0.19, rotation: [0, 0, 10] },
  { part: 'pipe', position: [0.46, 1.38, 0], scale: 0.19, rotation: [0, 0, -10] },
  { part: 'pipe', position: [-0.54, 0.88, 0], scale: 0.17, rotation: [0, 0, 6] },
  { part: 'pipe', position: [0.54, 0.88, 0], scale: 0.17, rotation: [0, 0, -6] },
  { part: 'hand', position: [-0.6, 0.54, 0], scale: 0.1, rotation: [0, 0, 8] },
  { part: 'hand', position: [0.6, 0.54, 0], scale: 0.1, rotation: [0, 0, -8] },
  // legs: thigh pipe + shin pipe + foot, spread a bit
  { part: 'pipe', position: [-0.17, 0.64, 0], scale: 0.2, rotation: [0, 0, 4] },
  { part: 'pipe', position: [0.17, 0.64, 0], scale: 0.2, rotation: [0, 0, -4] },
  { part: 'pipe', position: [-0.21, 0.25, 0], scale: 0.18, rotation: [0, 0, 2] },
  { part: 'pipe', position: [0.21, 0.25, 0], scale: 0.18, rotation: [0, 0, -2] },
  { part: 'foot', position: [-0.23, 0.07, -0.08], scale: 0.11 },
  { part: 'foot', position: [0.23, 0.07, -0.08], scale: 0.11 },
];

// ── .body documents — a whole character, sqi/hed conventions ────────────────

export type BodyDocument = {
  kind: 'body';
  version: 1;
  skin: string;
  amount: number;
  headScaleY: number;
  /** per part: quantized signed sculpt bytes (−127..127) + feature layers
   *  (the head's face lives in parts.head.layers). */
  parts: Record<PartId, { sculpt: number[]; layers: HedLayer[] }>;
  metadata?: { title?: string; createdAt?: number };
};

export function buildBody(args: {
  skin: string;
  amount: number;
  headScaleY: number;
  /** signed floats −1..1 per part (the lab's live grids). */
  sculpts: Record<PartId, number[]>;
  headLayers: HedLayer[];
  title?: string;
}): BodyDocument {
  const parts = {} as BodyDocument['parts'];
  for (const id of PART_IDS) {
    parts[id] = {
      sculpt: (args.sculpts[id] ?? []).map((v) => Math.max(-127, Math.min(127, Math.round(v * 127)))),
      layers: id === 'head' ? args.headLayers : [],
    };
  }
  return {
    kind: 'body',
    version: 1,
    skin: args.skin,
    amount: args.amount,
    headScaleY: args.headScaleY,
    parts,
    metadata: { title: args.title, createdAt: Date.now() },
  };
}

export function parseBody(text: string): BodyDocument | null {
  let doc: any;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || doc.kind !== 'body' || doc.version !== 1) return null;
  if (typeof doc.skin !== 'string' || !doc.parts) return null;
  for (const id of PART_IDS) {
    const part = doc.parts[id];
    if (!part || !Array.isArray(part.sculpt) || !Array.isArray(part.layers)) return null;
  }
  return doc as BodyDocument;
}

export function serializeBody(doc: BodyDocument): string {
  return JSON.stringify(doc);
}
