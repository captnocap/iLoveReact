// worldDynamicProps.ts — bake the KICKABLE props (KICKPROP-0610) into the
// DYNAMIC_PROPS map lump so the compiled game gets /test's dynamics: run into
// a ball and it flies, cones and cans shove around (USER ASK req_0625 —
// KICKPROP's named "compiled no-V8 game parity" follow-up).
//
// THE GAP THIS FIXES: the bake lowered every prop to STATIC instance rows, so
// a beach ball in the compiled game was a painted statue. The host integrator
// (framework/game/physics.zig step()) already steps dynamic sphere entities —
// gravity, world collision, bounce, sphere-sphere, the player kick — the
// compiled path just never shipped WHICH props are bodies.
//
// SHAPE: per dynamic prop — the sphere body recipe (radius/restitution, the
// kind registry's authored dynamics) plus its RENDER PARTS in LOCAL space
// (the same 13-float rows the instance lump uses, anchored at the prop and
// un-yawed). The loader renders these as live per-frame nodes (the player-
// model pattern) instead of rows in the one-time-uploaded static buffer —
// a moving prop never re-stages the world.

import type { WorldProp } from '../design';
import { propDynamics } from '../game/kinds/props';

export const DYNAMIC_PROPS_LUMP_VERSION = 1;

/** One 13-float local render part: px,py,pz, rx,ry,rz, sx,sy,sz, r,g,b, shapeId
 *  — identical field order to the INSTANCES lump rows, but positions are
 *  relative to the prop anchor and yaw is NOT folded in (the loader composes
 *  anchor + yaw per frame, exactly like the player model). */
export const DYNAMIC_PART_FLOATS = 13;

export type DynamicPropRecord = {
  x: number;
  y: number;
  z: number;
  yawDegrees: number;
  bodyRadiusMeters: number;
  restitution: number;
  /** length = partCount * DYNAMIC_PART_FLOATS */
  parts: number[];
};

export type DynamicPropSink = {
  props: DynamicPropRecord[];
  /** Open a record if the kind is dynamic — the caller then feeds it LOCAL
   *  part rows and skips the static instance path. Null for static scenery. */
  open(prop: WorldProp): DynamicPropRecord | null;
};

export function createDynamicPropSink(): DynamicPropSink {
  const props: DynamicPropRecord[] = [];
  return {
    props,
    open(prop: WorldProp): DynamicPropRecord | null {
      const dynamics = propDynamics(prop.kind);
      if (!dynamics) return null;
      const record: DynamicPropRecord = {
        x: prop.x,
        y: prop.y,
        z: prop.z,
        yawDegrees: prop.yawDegrees ?? 0,
        bodyRadiusMeters: dynamics.bodyRadiusMeters,
        restitution: dynamics.restitution,
        parts: [],
      };
      props.push(record);
      return record;
    },
  };
}

/** Encode the DYNAMIC_PROPS lump.
 *
 *  Layout (version 1, little-endian):
 *    u32 version
 *    u32 propCount
 *    per prop:
 *      f32 anchorX | f32 anchorY | f32 anchorZ | f32 yawDegrees |
 *      f32 bodyRadiusMeters | f32 restitution |
 *      u32 partCount | f32[partCount * 13] local part rows */
export function encodeDynamicProps(props: readonly DynamicPropRecord[]): Uint8Array {
  let bytes = 8;
  for (const p of props) bytes += 6 * 4 + 4 + p.parts.length * 4;
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, DYNAMIC_PROPS_LUMP_VERSION, true);
  view.setUint32(4, props.length, true);
  let at = 8;
  for (const p of props) {
    view.setFloat32(at, p.x, true);
    view.setFloat32(at + 4, p.y, true);
    view.setFloat32(at + 8, p.z, true);
    view.setFloat32(at + 12, p.yawDegrees, true);
    view.setFloat32(at + 16, p.bodyRadiusMeters, true);
    view.setFloat32(at + 20, p.restitution, true);
    at += 24;
    const partCount = Math.floor(p.parts.length / DYNAMIC_PART_FLOATS);
    view.setUint32(at, partCount, true);
    at += 4;
    for (let i = 0; i < partCount * DYNAMIC_PART_FLOATS; i += 1) {
      view.setFloat32(at, p.parts[i], true);
      at += 4;
    }
  }
  return out;
}

/** Wire-format twin of encodeDynamicProps — the round-trip test's reader and
 *  the reference for constructor.zig decodeDynamicProps. */
export function decodeDynamicProps(bytes: Uint8Array): { version: number; props: DynamicPropRecord[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0, true);
  if (version !== DYNAMIC_PROPS_LUMP_VERSION) throw new Error(`unsupported dynamic-props version ${version}`);
  const propCount = view.getUint32(4, true);
  let at = 8;
  const props: DynamicPropRecord[] = [];
  for (let i = 0; i < propCount; i += 1) {
    const record: DynamicPropRecord = {
      x: view.getFloat32(at, true),
      y: view.getFloat32(at + 4, true),
      z: view.getFloat32(at + 8, true),
      yawDegrees: view.getFloat32(at + 12, true),
      bodyRadiusMeters: view.getFloat32(at + 16, true),
      restitution: view.getFloat32(at + 20, true),
      parts: [],
    };
    at += 24;
    const partCount = view.getUint32(at, true);
    at += 4;
    for (let k = 0; k < partCount * DYNAMIC_PART_FLOATS; k += 1) {
      record.parts.push(view.getFloat32(at, true));
      at += 4;
    }
    props.push(record);
  }
  return { version, props };
}
