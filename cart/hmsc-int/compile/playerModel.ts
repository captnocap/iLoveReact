// playerModel.ts — bake the V2 figure into loader-ready mesh data.
//
// The live/editor figure is authored by @game/figure. This module evaluates that
// authored kit at compile time and emits local-coordinate vertex groups the
// stateless no-V8 loader can instantiate at the runtime player transform.

import { MAP_LUMP } from '@reactjit/workspace';
import * as Geometry from '@reactjit/geometries';
import { bakeFigureFromSeed } from '@game/figure/bake';
import { buildRigFrame } from '@game/figure/rig';
import type { BodyInstance } from '@game/figure/assembly';
import type { ClothingInstance } from '@game/figure/clothing';
import type { BakedFigure, BakedPart } from '@game/figure/bake';

type V3 = [number, number, number];

export const PLAYER_MODEL_LUMP = MAP_LUMP.PLAYER_MODEL;
export const PLAYER_MODEL_VERSION = 1;
export const PLAYER_MODEL_SEED = 1;

export type PlayerMeshGroup = {
  color: V3;
  alpha: number;
  vertices: Float32Array;
  texture?: { width: number; height: number; rgba: Uint8Array };
};

export type BakedPlayerModel = {
  groups: PlayerMeshGroup[];
};

type MutableGroup = {
  color: V3;
  alpha: number;
  verts: number[];
  texture?: { width: number; height: number; rgba: Uint8Array };
};

function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255, a / 255];
}

function rgbaKey(color: V3, alpha: number, textureKey = ''): string {
  return `${textureKey}|${color.map((v) => v.toFixed(4)).join(',')},${alpha.toFixed(4)}`;
}

function rotateZ(p: V3, deg: number): V3 {
  const r = deg * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}

function rotateX(p: V3, deg: number): V3 {
  const r = deg * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}

function rotateY(p: V3, deg: number): V3 {
  const r = deg * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

function normalize(p: V3): V3 {
  const len = Math.hypot(p[0], p[1], p[2]);
  return len > 1e-6 ? [p[0] / len, p[1] / len, p[2] / len] : [0, 1, 0];
}

function scaleVec(scale: number | V3 | undefined): V3 {
  if (Array.isArray(scale)) return [scale[0], scale[1], scale[2]];
  const s = typeof scale === 'number' ? scale : 1;
  return [s, s, s];
}

function transformPosition(p: V3, position: V3, rotation: V3, scale: V3): V3 {
  let out: V3 = [p[0] * scale[0], p[1] * scale[1], p[2] * scale[2]];
  out = rotateZ(out, rotation[2]);
  out = rotateX(out, rotation[0]);
  out = rotateY(out, rotation[1]);
  return [out[0] + position[0], out[1] + position[1], out[2] + position[2]];
}

function transformNormal(n: V3, rotation: V3, scale: V3): V3 {
  let out = normalize([
    scale[0] !== 0 ? n[0] / scale[0] : n[0],
    scale[1] !== 0 ? n[1] / scale[1] : n[1],
    scale[2] !== 0 ? n[2] / scale[2] : n[2],
  ]);
  out = rotateZ(out, rotation[2]);
  out = rotateX(out, rotation[0]);
  out = rotateY(out, rotation[1]);
  return normalize(out);
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

function appendGeometry(
  groups: Map<string, MutableGroup>,
  geometry: Geometry.GeometryDef,
  params: any,
  position: V3,
  rotation: V3,
  scale: number | V3 | undefined,
  colorHex: string,
  texture?: { width: number; height: number; rgba: Uint8Array },
): void {
  const [r, g, b, a] = hexToRgba(colorHex);
  const color: V3 = [r, g, b];
  const key = rgbaKey(color, a, texture ? 'tex' : '');
  let group = groups.get(key);
  if (!group) {
    group = { color, alpha: a, verts: [], texture };
    groups.set(key, group);
  }

  const data = geometry.generate({ ...geometry.defaults, ...(params ?? {}) } as any);
  const s = scaleVec(scale);
  for (let i = 0; i < data.count; i += 1) {
    const at = i * 8;
    const p = transformPosition([data.positions[at], data.positions[at + 1], data.positions[at + 2]], position, rotation, s);
    const n = transformNormal([data.positions[at + 3], data.positions[at + 4], data.positions[at + 5]], rotation, s);
    group.verts.push(p[0], p[1], p[2], n[0], n[1], n[2], data.positions[at + 6], data.positions[at + 7]);
  }
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

export function buildDefaultPlayerModel(): BakedPlayerModel {
  const figure = bakeFigureFromSeed(PLAYER_MODEL_SEED, { shape: 'neutral', outfit: { top: 'tee', bottoms: 'jeans' } });
  const rig = buildRigFrame('neutral', 'stand', 0, [], 'tee', 'plain', [], 'jeans');
  const groups = new Map<string, MutableGroup>();
  const faceTexture = { width: figure.faceTexture.width, height: figure.faceTexture.height, rgba: rasterFaceTexture(figure.faceTexture) };

  const appendPart = (inst: BodyInstance): void => {
    const part: BakedPart = figure.parts[inst.part];
    appendGeometry(
      groups,
      Geometry.Globe,
      part.params,
      inst.position,
      inst.rotation ?? [0, 0, 0],
      partScale(inst),
      figure.faceTexture.skin,
      inst.part === 'head' ? faceTexture : undefined,
    );
  };

  for (const inst of rig.assembly) appendPart(inst);
  for (const inst of rig.anatomy) appendPart(inst);
  for (const inst of rig.clothing) {
    appendGeometry(
      groups,
      clothingGeometry(inst.geometry),
      inst.params,
      inst.position,
      inst.rotation ?? [0, 0, 0],
      inst.scale,
      inst.textureKey ? '#ffffff' : inst.color,
    );
  }

  return {
    groups: Array.from(groups.values()).map((group) => ({
      color: group.color,
      alpha: group.alpha,
      vertices: new Float32Array(group.verts),
      texture: group.texture,
    })),
  };
}

export function encodePlayerModelLump(model: BakedPlayerModel): Uint8Array {
  let bytes = 8;
  for (const group of model.groups) {
    bytes += 32 + group.vertices.byteLength + (group.texture?.rgba.byteLength ?? 0);
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
    at += 32;
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
