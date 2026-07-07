// world/playerAnimation.ts — the BASIC ANIMATION SHAPES for exported bodies (req_2781).
//
// The loader animates its player as per-node keyframe clips (idle/walk/jump/
// sit/lay, world_loader.zig sampleClipTransform) — but clips only engage when
// their node_count matches the model's group count, and an EXPORTED body's
// groups are whatever the outliner held at export. So the clips are GENERATED
// here, from the same rank-ordered part rows the model push stages: bone-named
// parts get the gait program (legs/arms swing about their measured joint
// pivots — the hip/shoulder/knee/elbow parts ARE the pivots), unnamed strays
// ride the root. This is the approved animation-arc's first leg (req_0576
// phase 3b brought to the active surface): hand-tuned basic shapes now, the
// pose editor / timeline / garage-mocap CAPTURE lenses author into this same
// per-node clip stream later.
//
// Pure data + math — no host doors here (playerModelPush stages the encoded
// payload through __compiled_world_set_player_animation).

export type V3 = [number, number, number];
export type AnimNode = { name: string; center: V3 };
export type NodeTransform = { pos: V3; rot: V3 };
export type BodyKeyframe = { time: number; transforms: NodeTransform[] };
export type BodyClip = { id: number; duration: number; looping: boolean; keys: BodyKeyframe[] };

// The loader's clip vocabulary (world_loader.zig PLAYER_CLIP_*).
export const CLIP_IDLE = 0;
export const CLIP_WALK = 1;
export const CLIP_JUMP = 2;
export const CLIP_SIT = 3;
export const CLIP_LAY = 4;

const DEG = Math.PI / 180;

/** Rotate `p` about `pivot` around the world X axis (degrees; positive swings
 *  a hanging limb toward -Z — the figure's forward). */
function rotXAt(pivot: V3, p: V3, deg: number): V3 {
  const r = deg * DEG;
  const c = Math.cos(r), s = Math.sin(r);
  const dy = p[1] - pivot[1], dz = p[2] - pivot[2];
  return [p[0], pivot[1] + dy * c - dz * s, pivot[2] + dy * s + dz * c];
}

type Working = { pos: V3; rx: number; ry: number };

/** One limb chain swung about its measured pivots: the whole chain rotates
 *  `upperDeg` about the root joint part (hip/shoulder), then the sub-chain
 *  from the lower segment onward rotates `lowerDeg` about the (already-moved)
 *  knee/elbow part. Missing parts skip silently — a chopped import animates
 *  whatever chain segments it has. */
function swingLimb(
  work: Map<string, Working>,
  rest: Map<string, V3>,
  side: 'left' | 'right',
  kind: 'leg' | 'arm',
  upperDeg: number,
  lowerDeg: number,
): void {
  const chain = kind === 'leg'
    ? ['upper_leg', 'knee', 'lower_leg', 'foot', 'toes']
    : ['upper_arm', 'elbow', 'lower_arm', 'wrist', 'hand', 'fingers'];
  const rootJoint = kind === 'leg' ? `hip_${side}` : `shoulder_${side}`;
  const midJoint = kind === 'leg' ? `knee_${side}` : `elbow_${side}`;
  const names = chain.map((n) => `${n}_${side}`);
  const rootPivot = rest.get(rootJoint) ?? rest.get(names[0]!);
  if (!rootPivot) return;
  for (const name of names) {
    const w = work.get(name);
    if (!w) continue;
    w.pos = rotXAt(rootPivot, w.pos, upperDeg);
    w.rx += upperDeg;
  }
  const mid = work.get(midJoint);
  if (!mid || lowerDeg === 0) return;
  const lowerFrom = chain.indexOf(kind === 'leg' ? 'lower_leg' : 'lower_arm');
  const midPivot = mid.pos;
  for (const name of names.slice(lowerFrom)) {
    const w = work.get(name);
    if (!w) continue;
    w.pos = rotXAt(midPivot, w.pos, lowerDeg);
    w.rx += lowerDeg;
  }
}

/** Bones that twist with the torso during gait (ry counter-rotation). */
const TORSO_BONES = new Set(['chest', 'abdomen', 'butt', 'back', 'breast']);

/** One gait sample at phase p ∈ [0,1] — the walk program: opposite-phase leg
 *  and arm swings about measured pivots, knee/elbow follow-through, a small
 *  double-bounce bob, torso counter-twist. */
function walkPose(nodes: AnimNode[], p: number): NodeTransform[] {
  const s = Math.sin(p * Math.PI * 2);
  const work = new Map<string, Working>(nodes.map((n) => [n.name, { pos: [...n.center] as V3, rx: 0, ry: 0 }]));
  const rest = new Map<string, V3>(nodes.map((n) => [n.name, n.center]));
  swingLimb(work, rest, 'left', 'leg', 26 * s, -20 * Math.max(0, -s));
  swingLimb(work, rest, 'right', 'leg', -26 * s, -20 * Math.max(0, s));
  swingLimb(work, rest, 'left', 'arm', -18 * s, 14 - 6 * s);
  swingLimb(work, rest, 'right', 'arm', 18 * s, 14 + 6 * s);
  const bob = 0.025 * (0.5 - 0.5 * Math.cos(p * Math.PI * 4));
  return nodes.map((n) => {
    const w = work.get(n.name)!;
    const ry = TORSO_BONES.has(n.name) ? 4 * s : n.name === 'head' ? -3 * s : 0;
    return { pos: [w.pos[0], w.pos[1] + bob, w.pos[2]], rot: [w.rx, w.ry + ry, 0] };
  });
}

/** A static full-body pose from per-limb angles + a whole-body vertical drop. */
function limbPose(nodes: AnimNode[], a: { legUpper: number; legLower: number; armUpper: number; armLower: number; dropY?: number }): NodeTransform[] {
  const work = new Map<string, Working>(nodes.map((n) => [n.name, { pos: [...n.center] as V3, rx: 0, ry: 0 }]));
  const rest = new Map<string, V3>(nodes.map((n) => [n.name, n.center]));
  for (const side of ['left', 'right'] as const) {
    swingLimb(work, rest, side, 'leg', a.legUpper, a.legLower);
    swingLimb(work, rest, side, 'arm', a.armUpper, a.armLower);
  }
  const drop = a.dropY ?? 0;
  return nodes.map((n) => {
    const w = work.get(n.name)!;
    return { pos: [w.pos[0], Math.max(0.02, w.pos[1] - drop), w.pos[2]], rot: [w.rx, 0, 0] };
  });
}

function restPose(nodes: AnimNode[]): NodeTransform[] {
  return nodes.map((n) => ({ pos: n.center, rot: [0, 0, 0] as V3 }));
}

/** Lying on the back: every part rotated -85° about X at a low pivot. */
function layPose(nodes: AnimNode[]): NodeTransform[] {
  const pivot: V3 = [0, 0.2, 0.1];
  return nodes.map((n) => ({ pos: rotXAt(pivot, n.center, -85), rot: [-85, 0, 0] as V3 }));
}

/** The basic shapes, generated for THIS body's rank-ordered nodes. */
export function buildBodyClips(nodes: AnimNode[]): BodyClip[] {
  const WALK_KEYS = 8; // + the closing key that mirrors t=0 for a clean loop
  const walkKeys: BodyKeyframe[] = [];
  for (let k = 0; k <= WALK_KEYS; k += 1) {
    const p = k / WALK_KEYS;
    walkKeys.push({ time: p, transforms: walkPose(nodes, p % 1) });
  }
  return [
    { id: CLIP_IDLE, duration: 1, looping: true, keys: [{ time: 0, transforms: restPose(nodes) }] },
    { id: CLIP_WALK, duration: 1, looping: true, keys: walkKeys },
    {
      id: CLIP_JUMP, duration: 0.6, looping: false, keys: [
        { time: 0, transforms: limbPose(nodes, { legUpper: 16, legLower: -28, armUpper: -26, armLower: 18, dropY: 0.1 }) },
        { time: 0.22, transforms: limbPose(nodes, { legUpper: -6, legLower: -4, armUpper: 52, armLower: 10 }) },
        { time: 0.6, transforms: limbPose(nodes, { legUpper: 6, legLower: -10, armUpper: 8, armLower: 14 }) },
      ],
    },
    { id: CLIP_SIT, duration: 1, looping: true, keys: [{ time: 0, transforms: limbPose(nodes, { legUpper: 80, legLower: -75, armUpper: 14, armLower: 24, dropY: 0.42 }) }] },
    { id: CLIP_LAY, duration: 1, looping: true, keys: [{ time: 0, transforms: layPose(nodes) }] },
  ];
}

/** Encode clips for __compiled_world_set_player_animation:
 *  [nodeCount, clipCount, per clip: [id, duration, looping, keyCount,
 *   per key: [time, per node: px,py,pz, rx,ry,rz, sx,sy,sz]]]. */
export function encodeAnimationPayload(nodeCount: number, clips: BodyClip[]): Float32Array {
  const out: number[] = [nodeCount, clips.length];
  for (const clip of clips) {
    out.push(clip.id, clip.duration, clip.looping ? 1 : 0, clip.keys.length);
    for (const key of clip.keys) {
      out.push(key.time);
      for (const t of key.transforms) {
        out.push(t.pos[0], t.pos[1], t.pos[2], t.rot[0], t.rot[1], t.rot[2], 1, 1, 1);
      }
    }
  }
  return new Float32Array(out);
}
