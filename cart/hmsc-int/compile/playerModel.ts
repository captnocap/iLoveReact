// playerModel.ts — bake the V2 figure into loader-ready mesh + animation data.
//
// The editor/live figure is authored by @game/figure. This compile step emits
// flat primitive data for the no-V8 loader: one mesh node per rig primitive, plus
// declarative transform keyframes. Runtime work is only interpolation.

import { MAP_LUMP } from '@reactjit/workspace';
import { sha256 } from '@reactjit/workspace/sha256';
import * as Geometry from '@reactjit/geometries';
import { parseAnimationDsl, sampleAnimationTimeline } from '@game/animation';
import { bakeFigureFromSeed } from '@game/figure/bake';
import { buildRigFrame } from '@game/figure/rig';
import type { BodyInstance } from '@game/figure/assembly';
import type { ClothingInstance } from '@game/figure/clothing';
import type { BakedFigure, BakedPart } from '@game/figure/bake';
import type { RigTimelineAction } from '@game/figure/skeleton';

type V3 = [number, number, number];

export const PLAYER_MODEL_LUMP = MAP_LUMP.PLAYER_MODEL;
export const PLAYER_ANIMATION_LUMP = MAP_LUMP.PLAYER_ANIMATION;
export const PLAYER_MODEL_VERSION = 2;
export const PLAYER_ANIMATION_VERSION = 1;
export const PLAYER_MODEL_SEED = 1;

const WALK_KEYFRAMES = 9;
const JUMP_KEYFRAMES = 5;

const CLIP = {
  idle: 0,
  walk: 1,
  jump: 2,
  // PROPUSE req_0624 — the seat poses, baked from the SAME skeleton posture
  // actions /test plays live (Embodied.tsx: {target:'body', action:posture}).
  // Loader twin: world_loader.zig PLAYER_CLIP_SIT / PLAYER_CLIP_LAY.
  sit: 3,
  lay: 4,
} as const;

export type PlayerTransform = {
  position: V3;
  rotation: V3;
  scale: V3;
};

export type PlayerMeshGroup = PlayerTransform & {
  color: V3;
  alpha: number;
  vertices: Float32Array;
  texture?: { width: number; height: number; rgba: Uint8Array };
};

export type BakedPlayerModel = {
  groups: PlayerMeshGroup[];
};

export type PlayerAnimationKeyframe = {
  time: number;
  transforms: PlayerTransform[];
};

export type PlayerAnimationClip = {
  id: number;
  duration: number;
  looping: boolean;
  keyframes: PlayerAnimationKeyframe[];
};

export type BakedPlayerAnimation = {
  nodeCount: number;
  clips: PlayerAnimationClip[];
};

function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255, a / 255];
}

function scaleVec(scale: number | V3 | undefined): V3 {
  if (Array.isArray(scale)) return [scale[0], scale[1], scale[2]];
  const s = typeof scale === 'number' ? scale : 1;
  return [s, s, s];
}

function partScale(inst: BodyInstance): V3 {
  const xz = inst.thickness != null ? inst.scale * inst.thickness : inst.scale;
  return [xz, inst.scale, xz];
}

function clothingGeometry(kind: ClothingInstance['geometry']): Geometry.GeometryDef {
  switch (kind) {
    case 'sphere': return Geometry.Sphere;
    case 'cone': return Geometry.Cone;
    case 'cylinder': return Geometry.Cylinder;
    default: return Geometry.Box;
  }
}

function localGeometry(geometry: Geometry.GeometryDef, params: any): Float32Array {
  const data = geometry.generate({ ...geometry.defaults, ...(params ?? {}) } as any);
  return new Float32Array(data.positions);
}

function rasterFaceTexture(face: BakedFigure['faceTexture']): Uint8Array {
  const out = new Uint8Array(face.width * face.height * 4);
  const [sr, sg, sb, sa] = hexToRgba(face.skin);
  for (let i = 0; i < face.width * face.height; i += 1) {
    out[i * 4 + 0] = Math.round(sr * 255);
    out[i * 4 + 1] = Math.round(sg * 255);
    out[i * 4 + 2] = Math.round(sb * 255);
    out[i * 4 + 3] = Math.round(sa * 255);
  }
  const paint = (x: number, y: number, rgba: [number, number, number, number]) => {
    if (x < 0 || y < 0 || x >= face.width || y >= face.height) return;
    const at = (y * face.width + x) * 4;
    const a = rgba[3];
    out[at + 0] = Math.round(out[at + 0] * (1 - a) + rgba[0] * 255 * a);
    out[at + 1] = Math.round(out[at + 1] * (1 - a) + rgba[1] * 255 * a);
    out[at + 2] = Math.round(out[at + 2] * (1 - a) + rgba[2] * 255 * a);
    out[at + 3] = 255;
  };
  for (const layer of face.layers) {
    if (!layer.color) continue;
    const rgba = hexToRgba(layer.color);
    for (const shape of layer.shapes) {
      const centers = shape.mirror ? [shape.cx, 1 - shape.cx] : [shape.cx];
      for (const cx of centers) {
        const minX = Math.max(0, Math.floor((cx - shape.rx) * face.width));
        const maxX = Math.min(face.width - 1, Math.ceil((cx + shape.rx) * face.width));
        const minY = Math.max(0, Math.floor((shape.cy - shape.ry) * face.height));
        const maxY = Math.min(face.height - 1, Math.ceil((shape.cy + shape.ry) * face.height));
        for (let y = minY; y <= maxY; y += 1) {
          for (let x = minX; x <= maxX; x += 1) {
            const u = (x + 0.5) / face.width;
            const v = (y + 0.5) / face.height;
            const du = Math.abs(u - cx);
            const dv = Math.abs(v - shape.cy);
            const inside = shape.kind === 'rect'
              ? du <= shape.rx && dv <= shape.ry
              : (du / shape.rx) ** 2 + (dv / shape.ry) ** 2 <= 1;
            if (inside) paint(x, y, rgba);
          }
        }
      }
    }
  }
  return out;
}

function partGroup(figure: BakedFigure, faceTexture: { width: number; height: number; rgba: Uint8Array }, inst: BodyInstance): PlayerMeshGroup {
  const part: BakedPart = figure.parts[inst.part];
  const [r, g, b, a] = hexToRgba(figure.faceTexture.skin);
  return {
    color: [r, g, b],
    alpha: a,
    position: inst.position,
    rotation: inst.rotation ?? [0, 0, 0],
    scale: partScale(inst),
    vertices: localGeometry(Geometry.Globe, part.params),
    texture: inst.part === 'head' ? faceTexture : undefined,
  };
}

function clothingGroup(inst: ClothingInstance): PlayerMeshGroup {
  const [r, g, b, a] = hexToRgba(inst.textureKey ? '#ffffff' : inst.color);
  return {
    color: [r, g, b],
    alpha: a,
    position: inst.position,
    rotation: inst.rotation ?? [0, 0, 0],
    scale: scaleVec(inst.scale),
    vertices: localGeometry(clothingGeometry(inst.geometry), inst.params),
  };
}

function rigTransforms(phasePose: 'stand' | 'walk', phase: number, actions: RigTimelineAction[] = []): PlayerTransform[] {
  const rig = buildRigFrame('neutral', phasePose, phase, actions, 'tee', 'plain', [], 'jeans');
  const out: PlayerTransform[] = [];
  const pushPart = (inst: BodyInstance) => out.push({
    position: inst.position,
    rotation: inst.rotation ?? [0, 0, 0],
    scale: partScale(inst),
  });
  for (const inst of rig.assembly) pushPart(inst);
  for (const inst of rig.anatomy) pushPart(inst);
  for (const inst of rig.clothing) {
    out.push({
      position: inst.position,
      rotation: inst.rotation ?? [0, 0, 0],
      scale: scaleVec(inst.scale),
    });
  }
  return out;
}

function assertNodeCount(transforms: PlayerTransform[], count: number, label: string): void {
  if (transforms.length !== count) {
    throw new Error(`player animation ${label} produced ${transforms.length} nodes, expected ${count}`);
  }
}

function keyframe(time: number, transforms: PlayerTransform[]): PlayerAnimationKeyframe {
  return { time, transforms };
}

export function buildDefaultPlayerModel(): BakedPlayerModel {
  const figure = bakeFigureFromSeed(PLAYER_MODEL_SEED, { shape: 'neutral', outfit: { top: 'tee', bottoms: 'jeans' } });
  const rig = buildRigFrame('neutral', 'stand', 0, [], 'tee', 'plain', [], 'jeans');
  const faceTexture = { width: figure.faceTexture.width, height: figure.faceTexture.height, rgba: rasterFaceTexture(figure.faceTexture) };
  const groups: PlayerMeshGroup[] = [];
  for (const inst of rig.assembly) groups.push(partGroup(figure, faceTexture, inst));
  for (const inst of rig.anatomy) groups.push(partGroup(figure, faceTexture, inst));
  for (const inst of rig.clothing) groups.push(clothingGroup(inst));
  return { groups };
}

export function buildDefaultPlayerAnimation(nodeCount: number): BakedPlayerAnimation {
  const idleTransforms = rigTransforms('stand', 0);
  assertNodeCount(idleTransforms, nodeCount, 'idle');

  const walkKeys: PlayerAnimationKeyframe[] = [];
  for (let i = 0; i < WALK_KEYFRAMES; i += 1) {
    const phase = i / (WALK_KEYFRAMES - 1);
    const transforms = rigTransforms('walk', phase);
    assertNodeCount(transforms, nodeCount, `walk.${i}`);
    walkKeys.push(keyframe(phase, transforms));
  }

  const jumpTimeline = parseAnimationDsl('[0.24, both_arms, lift_and_bend; 0.24, both_legs, kick; 0.24, body, crouch]');
  const jumpKeys: PlayerAnimationKeyframe[] = [];
  for (let i = 0; i < JUMP_KEYFRAMES; i += 1) {
    const phase = i / (JUMP_KEYFRAMES - 1);
    const actions = sampleAnimationTimeline(jumpTimeline, phase * Math.max(0.001, jumpTimeline.total)) as RigTimelineAction[];
    const transforms = rigTransforms('stand', 0, actions);
    assertNodeCount(transforms, nodeCount, `jump.${i}`);
    jumpKeys.push(keyframe(phase, transforms));
  }

  const sitTransforms = rigTransforms('stand', 0, [{ target: 'body', action: 'sit', phase: 1, weight: 1 }]);
  assertNodeCount(sitTransforms, nodeCount, 'sit');
  const layTransforms = rigTransforms('stand', 0, [{ target: 'body', action: 'lay', phase: 1, weight: 1 }]);
  assertNodeCount(layTransforms, nodeCount, 'lay');

  return {
    nodeCount,
    clips: [
      { id: CLIP.idle, duration: 1, looping: false, keyframes: [keyframe(0, idleTransforms)] },
      { id: CLIP.walk, duration: 1, looping: true, keyframes: walkKeys },
      { id: CLIP.jump, duration: 1, looping: false, keyframes: jumpKeys },
      { id: CLIP.sit, duration: 1, looping: false, keyframes: [keyframe(0, sitTransforms)] },
      { id: CLIP.lay, duration: 1, looping: false, keyframes: [keyframe(0, layTransforms)] },
    ],
  };
}

export function encodePlayerModelLump(model: BakedPlayerModel): Uint8Array {
  let bytes = 8;
  for (const group of model.groups) {
    bytes += 68 + group.vertices.byteLength + (group.texture?.rgba.byteLength ?? 0);
  }
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, PLAYER_MODEL_VERSION, true);
  view.setUint32(4, model.groups.length, true);
  let at = 8;
  for (const group of model.groups) {
    view.setFloat32(at + 0, group.color[0], true);
    view.setFloat32(at + 4, group.color[1], true);
    view.setFloat32(at + 8, group.color[2], true);
    view.setFloat32(at + 12, group.alpha, true);
    view.setUint32(at + 16, Math.floor(group.vertices.length / 8), true);
    view.setUint32(at + 20, group.texture?.width ?? 0, true);
    view.setUint32(at + 24, group.texture?.height ?? 0, true);
    view.setUint32(at + 28, group.texture?.rgba.byteLength ?? 0, true);
    view.setFloat32(at + 32, group.position[0], true);
    view.setFloat32(at + 36, group.position[1], true);
    view.setFloat32(at + 40, group.position[2], true);
    view.setFloat32(at + 44, group.rotation[0], true);
    view.setFloat32(at + 48, group.rotation[1], true);
    view.setFloat32(at + 52, group.rotation[2], true);
    view.setFloat32(at + 56, group.scale[0], true);
    view.setFloat32(at + 60, group.scale[1], true);
    view.setFloat32(at + 64, group.scale[2], true);
    at += 68;
    const vertexBytes = new Uint8Array(group.vertices.buffer, group.vertices.byteOffset, group.vertices.byteLength);
    out.set(vertexBytes, at);
    at += vertexBytes.byteLength;
    if (group.texture) {
      out.set(group.texture.rgba, at);
      at += group.texture.rgba.byteLength;
    }
  }
  return out;
}

function encodeTransform(view: DataView, at: number, transform: PlayerTransform): number {
  view.setFloat32(at + 0, transform.position[0], true);
  view.setFloat32(at + 4, transform.position[1], true);
  view.setFloat32(at + 8, transform.position[2], true);
  view.setFloat32(at + 12, transform.rotation[0], true);
  view.setFloat32(at + 16, transform.rotation[1], true);
  view.setFloat32(at + 20, transform.rotation[2], true);
  view.setFloat32(at + 24, transform.scale[0], true);
  view.setFloat32(at + 28, transform.scale[1], true);
  view.setFloat32(at + 32, transform.scale[2], true);
  return at + 36;
}

function encodeAnimationPayload(animation: BakedPlayerAnimation): Uint8Array {
  let bytes = 12;
  for (const clip of animation.clips) {
    bytes += 16;
    for (const key of clip.keyframes) {
      bytes += 4 + animation.nodeCount * 36;
    }
  }
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, PLAYER_ANIMATION_VERSION, true);
  view.setUint32(4, animation.clips.length, true);
  view.setUint32(8, animation.nodeCount, true);
  let at = 12;
  for (const clip of animation.clips) {
    view.setUint32(at + 0, clip.id, true);
    view.setFloat32(at + 4, clip.duration, true);
    view.setUint32(at + 8, clip.looping ? 1 : 0, true);
    view.setUint32(at + 12, clip.keyframes.length, true);
    at += 16;
    for (const key of clip.keyframes) {
      view.setFloat32(at, key.time, true);
      at += 4;
      for (const transform of key.transforms) {
        at = encodeTransform(view, at, transform);
      }
    }
  }
  return out;
}

export function encodePlayerAnimationLump(animation: BakedPlayerAnimation): Uint8Array {
  const payload = encodeAnimationPayload(animation);
  const out = new Uint8Array(4 + 32 + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, PLAYER_ANIMATION_VERSION, true);
  out.set(sha256(payload), 4);
  out.set(payload, 36);
  return out;
}
