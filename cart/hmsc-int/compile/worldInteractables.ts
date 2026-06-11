// worldInteractables.ts — bake the prop interaction layer (PROPUSE-0610) into
// the INTERACTABLES map lump so the compiled game carries /test's capability:
// walk up to a chair/bed and E sits/lies you down, walk up to a dumpster/fridge
// and E runs the search loading bar (USER ASK req_0624).
//
// THE GAP THIS FIXES: the bake lowered every prop to anonymous instance rows
// (pos/scale/color), so the no-V8 loader had geometry but no idea WHICH rows
// are a couch or a container — the interaction capability existed only in
// /test's JS scan (PlayRoute.tsx interactFrame).
//
// SHAPE (GUIDING_LIGHT: factor the product into a sum): the seat/container
// definitions live ONCE per prop kind in an ARCHETYPE table (the same data
// the kind registry authors — game/kinds/props.ts seat/container); instances
// are thin references (archetype index + transform). A map with 400 chairs
// ships ONE chair archetype and 400 five-number rows.

import type { PropKind, WorldProp } from '../design';
import {
  propContainer,
  propKindDefinition,
  propSeat,
  type PropContainer,
  type PropSeat,
} from '../game/kinds/props';
import { textBytes } from '@reactjit/workspace';

export const INTERACTABLES_LUMP_VERSION = 1;

// Archetype flag bits / enum codes — the Zig twin is constructor.zig
// parseInteractables; keep them in lockstep.
const FLAG_SEAT = 1;
const FLAG_CONTAINER = 2;
const POSE_CODE = { sit: 0, lay: 1 } as const;
const ACCESS_CODE = { open: 0, locked: 1, keyed: 2 } as const;
const POSE_BY_CODE = ['sit', 'lay'] as const;
const ACCESS_BY_CODE = ['open', 'locked', 'keyed'] as const;

export type InteractableArchetype = {
  kind: PropKind;
  label: string;
  seat: PropSeat | null;
  container: PropContainer | null;
};

export type InteractableInstance = {
  /** index into the archetype table */
  archetype: number;
  x: number;
  y: number;
  z: number;
  yawDegrees: number;
};

export type InteractableSink = {
  archetypes: InteractableArchetype[];
  instances: InteractableInstance[];
  /** Record a placed prop if its kind carries seat/container data; no-op otherwise. */
  collect(prop: WorldProp): void;
};

export function createInteractableSink(): InteractableSink {
  const archetypes: InteractableArchetype[] = [];
  const instances: InteractableInstance[] = [];
  const slotByKind = new Map<PropKind, number>();
  return {
    archetypes,
    instances,
    collect(prop: WorldProp): void {
      const seat = propSeat(prop.kind);
      const container = propContainer(prop.kind);
      if (!seat && !container) return;
      let slot = slotByKind.get(prop.kind);
      if (slot === undefined) {
        slot = archetypes.length;
        archetypes.push({ kind: prop.kind, label: propKindDefinition(prop.kind).label, seat, container });
        slotByKind.set(prop.kind, slot);
      }
      instances.push({ archetype: slot, x: prop.x, y: prop.y, z: prop.z, yawDegrees: prop.yawDegrees });
    },
  };
}

/** Encode the INTERACTABLES lump.
 *
 *  Layout (version 1, little-endian; every archetype field is written
 *  regardless of flags so the record walk is unconditional):
 *    u32 version
 *    u32 archetypeCount
 *    per archetype:
 *      u8 flags (bit0 seat, bit1 container) | u8 seatPose (0 sit, 1 lay) |
 *      u8 access (0 open, 1 locked, 2 keyed) | u8 pad |
 *      f32 seatHeightMeters | f32 searchSeconds |
 *      u32 labelLen | label utf8 | u32 lootLen | lootCategory utf8
 *    u32 instanceCount
 *    per instance: u32 archetypeIndex | f32 x | f32 y | f32 z | f32 yawDegrees */
export function encodeInteractables(sink: Pick<InteractableSink, 'archetypes' | 'instances'>): Uint8Array {
  const labels = sink.archetypes.map((a) => textBytes(a.label));
  const loots = sink.archetypes.map((a) => textBytes(a.container?.lootCategory ?? ''));
  let bytes = 12;
  for (let i = 0; i < sink.archetypes.length; i += 1) {
    bytes += 4 + 8 + 4 + labels[i].byteLength + 4 + loots[i].byteLength;
  }
  bytes += sink.instances.length * 20;
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, INTERACTABLES_LUMP_VERSION, true);
  view.setUint32(4, sink.archetypes.length, true);
  let at = 8;
  for (let i = 0; i < sink.archetypes.length; i += 1) {
    const a = sink.archetypes[i];
    out[at] = (a.seat ? FLAG_SEAT : 0) | (a.container ? FLAG_CONTAINER : 0);
    out[at + 1] = a.seat ? POSE_CODE[a.seat.pose] : 0;
    out[at + 2] = a.container ? ACCESS_CODE[a.container.access] : 0;
    out[at + 3] = 0;
    at += 4;
    view.setFloat32(at, a.seat?.seatHeightMeters ?? 0, true);
    view.setFloat32(at + 4, a.container?.searchSeconds ?? 0, true);
    at += 8;
    view.setUint32(at, labels[i].byteLength, true);
    at += 4;
    out.set(labels[i], at);
    at += labels[i].byteLength;
    view.setUint32(at, loots[i].byteLength, true);
    at += 4;
    out.set(loots[i], at);
    at += loots[i].byteLength;
  }
  view.setUint32(at, sink.instances.length, true);
  at += 4;
  for (const inst of sink.instances) {
    view.setUint32(at, inst.archetype, true);
    view.setFloat32(at + 4, inst.x, true);
    view.setFloat32(at + 8, inst.y, true);
    view.setFloat32(at + 12, inst.z, true);
    view.setFloat32(at + 16, inst.yawDegrees, true);
    at += 20;
  }
  return out;
}

/** Decoded archetype — pose/access come back as their string names so tests
 *  compare against the registry data directly. `kind` does not travel (the
 *  loader doesn't need it); decode returns the wire fields only. */
export type DecodedInteractableArchetype = {
  flags: number;
  label: string;
  lootCategory: string;
  seatPose: (typeof POSE_BY_CODE)[number];
  seatHeightMeters: number;
  access: (typeof ACCESS_BY_CODE)[number];
  searchSeconds: number;
};

export type DecodedInteractables = {
  version: number;
  archetypes: DecodedInteractableArchetype[];
  instances: InteractableInstance[];
};

/** Wire-format twin of encodeInteractables — the round-trip test's reader and
 *  the reference for constructor.zig parseInteractables. */
export function decodeInteractables(bytes: Uint8Array): DecodedInteractables {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0, true);
  if (version !== INTERACTABLES_LUMP_VERSION) throw new Error(`unsupported interactables version ${version}`);
  const archetypeCount = view.getUint32(4, true);
  let at = 8;
  const text = (len: number): string => {
    let s = '';
    for (let i = 0; i < len; i += 1) s += String.fromCharCode(bytes[at + i]);
    at += len;
    return decodeURIComponent(escape(s));
  };
  const archetypes: DecodedInteractableArchetype[] = [];
  for (let i = 0; i < archetypeCount; i += 1) {
    const flags = bytes[at];
    const seatPose = POSE_BY_CODE[bytes[at + 1]] ?? 'sit';
    const access = ACCESS_BY_CODE[bytes[at + 2]] ?? 'open';
    at += 4;
    const seatHeightMeters = view.getFloat32(at, true);
    const searchSeconds = view.getFloat32(at + 4, true);
    at += 8;
    const labelLen = view.getUint32(at, true);
    at += 4;
    const label = text(labelLen);
    const lootLen = view.getUint32(at, true);
    at += 4;
    const lootCategory = text(lootLen);
    archetypes.push({ flags, label, lootCategory, seatPose, seatHeightMeters, access, searchSeconds });
  }
  const instanceCount = view.getUint32(at, true);
  at += 4;
  const instances: InteractableInstance[] = [];
  for (let i = 0; i < instanceCount; i += 1) {
    instances.push({
      archetype: view.getUint32(at, true),
      x: view.getFloat32(at + 4, true),
      y: view.getFloat32(at + 8, true),
      z: view.getFloat32(at + 12, true),
      yawDegrees: view.getFloat32(at + 16, true),
    });
    at += 20;
  }
  return { version, archetypes, instances };
}
