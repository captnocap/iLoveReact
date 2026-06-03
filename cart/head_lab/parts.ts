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
  // the limb pipe: a long SLIM segment (narrow in x/z, full length in y —
  // arms and legs are not the michelin man), slightly waisted, rounded ends
  // so two of them visually connect at an elbow/knee without a seam gap
  pipe: { label: 'pipe', scaleY: 2.2, scaleX: 0.42, scaleZ: 0.42, profile: [0.45, 0.85, 0.8, 0.85, 0.45] },
  // a touch taller than wide, flattened front-to-back (a palm, not a paddle)
  hand: { label: 'hand', scaleX: 0.78, scaleY: 1.05, scaleZ: 0.45, profile: [0.55, 1.0, 0.85] },
  // like the hand but squat and stretched forward (toes at -Z, the facing
  // convention every sculpt surface shares)
  foot: { label: 'foot', scaleY: 0.6, scaleX: 0.8, scaleZ: 1.5, profile: [0.7, 1.0, 0.9] },
};

// Editable outline resolution: each part's silhouette is PROFILE_N radius
// samples top→bottom, dragged in the lab's outline editor. The presets above
// are only the DEFAULTS — resampled to this grid on init/reset.
export const PROFILE_N = 16;

export function defaultProfile(id: PartId): number[] {
  const src = PART_PRESETS[id].profile ?? [1];
  const out: number[] = [];
  for (let i = 0; i < PROFILE_N; i++) {
    if (src.length === 1) { out.push(src[0]); continue; }
    const t = (i / (PROFILE_N - 1)) * (src.length - 1);
    const j = Math.min(src.length - 2, Math.floor(t));
    out.push(src[j] + (src[j + 1] - src[j]) * (t - j));
  }
  return out;
}

export type BodyInstance = {
  part: PartId;
  position: [number, number, number];
  scale: number;
  /** degrees [rx, ry, rz] — small rz tilts hang the limbs naturally. */
  rotation?: [number, number, number];
  /** lateral (x/z) thickness multiplier on top of `scale` — proportions:
   *  the same pipe sculpt renders slimmer as a forearm than as a thigh. */
  thickness?: number;
};

// Standing figure, ground at y=0, ~2.2 units tall. Parts are radius-1 globes,
// so a part's half-extents ≈ scale × (profile·scaleX/Y/Z) — sized here so
// limbs sit CLEAR of the torso (arms out at the sides, legs spread a touch)
// instead of nesting inside it like a matryoshka. Pipes still kiss at the
// elbows/knees on purpose — the rounded profile ends read as the joint.
// Proportions follow the body, not the part: thighs are the thickest limb,
// shins middle, upper arms slimmer, forearms slimmest. One pipe sculpt
// serves all of them — `thickness` does the anatomy.
export const ASSEMBLY: BodyInstance[] = [
  { part: 'torso', position: [0, 1.3, 0], scale: 0.3 },
  { part: 'head', position: [0, 1.8, 0], scale: 0.21 },
  // arms: slim pipes chained shoulder → elbow → hand, hanging close to the
  // torso with a gentle outward drift toward the hands
  { part: 'pipe', position: [-0.4, 1.36, 0], scale: 0.19, rotation: [0, 0, -5], thickness: 0.85 },
  { part: 'pipe', position: [0.4, 1.36, 0], scale: 0.19, rotation: [0, 0, 5], thickness: 0.85 },
  { part: 'pipe', position: [-0.45, 0.88, 0], scale: 0.17, rotation: [0, 0, -8], thickness: 0.7 },
  { part: 'pipe', position: [0.45, 0.88, 0], scale: 0.17, rotation: [0, 0, 8], thickness: 0.7 },
  { part: 'hand', position: [-0.5, 0.52, 0], scale: 0.13 },
  { part: 'hand', position: [0.5, 0.52, 0], scale: 0.13 },
  // thumbs — the mitten rule: four fingers fused (the hand blob) but real
  // opposable thumbs. Tiny stubby pipes on each hand's INNER edge, angled up
  // toward the body; placed per side (not mirrored geometry) so they oppose.
  { part: 'pipe', position: [-0.405, 0.58, -0.02], scale: 0.05, rotation: [0, 0, -35], thickness: 2.0 },
  { part: 'pipe', position: [0.405, 0.58, -0.02], scale: 0.05, rotation: [0, 0, 35], thickness: 2.0 },
  // legs: thigh + shin pipes with a slight stance, feet pointing forward
  { part: 'pipe', position: [-0.15, 0.65, 0], scale: 0.21, rotation: [0, 0, -3], thickness: 1.3 },
  { part: 'pipe', position: [0.15, 0.65, 0], scale: 0.21, rotation: [0, 0, 3], thickness: 1.3 },
  { part: 'pipe', position: [-0.19, 0.27, 0], scale: 0.19 },
  { part: 'pipe', position: [0.19, 0.27, 0], scale: 0.19 },
  { part: 'foot', position: [-0.2, 0.07, -0.1], scale: 0.14 },
  { part: 'foot', position: [0.2, 0.07, -0.1], scale: 0.14 },
];

// ── .body documents — a whole character, sqi/hed conventions ────────────────

export type BodyDocument = {
  kind: 'body';
  version: 1;
  skin: string;
  amount: number;
  headScaleY: number;
  /** per part: quantized signed sculpt bytes (−127..127) + feature layers
   *  (the head's face lives in parts.head.layers) + the dragged outline
   *  (PROFILE_N radius samples; absent = the part's preset default). */
  parts: Record<PartId, { sculpt: number[]; layers: HedLayer[]; profile?: number[] }>;
  metadata?: { title?: string; createdAt?: number };
};

export function buildBody(args: {
  skin: string;
  amount: number;
  headScaleY: number;
  /** signed floats −1..1 per part (the lab's live grids). */
  sculpts: Record<PartId, number[]>;
  /** dragged outlines per part (PROFILE_N samples). */
  profiles: Record<PartId, number[]>;
  headLayers: HedLayer[];
  title?: string;
}): BodyDocument {
  const parts = {} as BodyDocument['parts'];
  for (const id of PART_IDS) {
    parts[id] = {
      sculpt: (args.sculpts[id] ?? []).map((v) => Math.max(-127, Math.min(127, Math.round(v * 127)))),
      layers: id === 'head' ? args.headLayers : [],
      profile: id === 'head' ? undefined : (args.profiles[id] ?? defaultProfile(id)).slice(),
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
