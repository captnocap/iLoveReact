// worldDoors.ts — bake the DOOR PANELS (DOORS-0611, req_0654) into the DOORS
// map lump so the compiled game gets /test's two-state door: walk up, E
// toggles open/closed, the closed leaf blocks body AND eye, the open doorway
// is genuinely clear (the user's ruling: "either an open arch for a door or
// at least a minecraft like door, simple two state machine, open and closed").
//
// SHAPE: one record per wall piece whose WallEdit declares an interaction
// (door/garageDoor — edits.ts is the vocabulary; arch has no leaf). The panel
// GEOMETRY is taken from the SHARED decomposition (pieceShapes' door-marked
// VisualBox, forced closed), so the live leaf the loader toggles is byte-for-
// byte the panel the editor renders — the same parity law as everything else.
// The loader appends one LIVE rect per door after the elevator car rects and
// renders one live panel node; the static INSTANCES/COLLIDERS lumps carry
// neither (worldGeometry skips door-marked boxes; placedPieceColliders bakes
// with liveDoorPanels).

import { GAME_BUILD } from '@game';
import type { PlacedBuildPiece } from '@game';
import { pieceVisualShapes } from '../editors/build/pieceShapes';

export const DOORS_LUMP_VERSION = 1;

export type DoorRecord = {
  /** panel center, world meters */
  x: number;
  z: number;
  /** panel bottom (the wall piece's base) */
  baseY: number;
  yawDegrees: number;
  panelWidthMeters: number;
  panelHeightMeters: number;
  panelDepthMeters: number;
  /** E reach, from the edit's interaction contract (edits.ts) */
  reachMeters: number;
  /** vehicle portal (garage door) — prompt wording, future open speeds */
  vehicle: boolean;
  /** authored doorOpen state — the door boots open and can be closed */
  startOpen: boolean;
};

/** Derive the lump records from the placed pieces — the panel box comes from
 *  the SAME pieceVisualShapes the editor renders (doorOpen forced off so an
 *  authored-open door still ships its closeable leaf). */
export function doorRecords(pieces: readonly PlacedBuildPiece[]): DoorRecord[] {
  const records: DoorRecord[] = [];
  for (const piece of pieces) {
    let def;
    try {
      def = GAME_BUILD.catalog.get(piece.pieceId);
    } catch {
      continue;
    }
    if (GAME_BUILD.kinds.get(def.kind).edits !== 'wall' || piece.edit === undefined) continue;
    const meaning = GAME_BUILD.edits.wall[piece.edit];
    if (!meaning?.interaction) continue;
    const closed = { ...piece, doorOpen: false };
    for (const shape of pieceVisualShapes(closed, piece.id, pieces)) {
      if (shape.kind !== 'box' || shape.box.door !== true) continue;
      const v = shape.box;
      records.push({
        x: v.cx,
        z: v.cz,
        baseY: v.cy - v.sy / 2,
        yawDegrees: v.yawDegrees,
        panelWidthMeters: v.sx,
        panelHeightMeters: v.sy,
        panelDepthMeters: v.sz,
        reachMeters: meaning.interaction.reachMeters,
        vehicle: meaning.portalKind === 'vehicle',
        startOpen: piece.doorOpen === true,
      });
    }
  }
  return records;
}

const DOOR_FLAG_VEHICLE = 1;
const DOOR_FLAG_START_OPEN = 2;

/** Encode the DOORS lump.
 *
 *  Layout (version 1, little-endian):
 *    u32 version
 *    u32 doorCount
 *    per door:
 *      f32 x | f32 baseY | f32 z | f32 yawDegrees |
 *      f32 panelW | f32 panelH | f32 panelD | f32 reach |
 *      u32 flags (bit0 vehicle, bit1 startOpen) */
export function encodeDoors(records: readonly DoorRecord[]): Uint8Array {
  const out = new Uint8Array(8 + records.length * 36);
  const view = new DataView(out.buffer);
  view.setUint32(0, DOORS_LUMP_VERSION, true);
  view.setUint32(4, records.length, true);
  let at = 8;
  for (const r of records) {
    view.setFloat32(at, r.x, true);
    view.setFloat32(at + 4, r.baseY, true);
    view.setFloat32(at + 8, r.z, true);
    view.setFloat32(at + 12, r.yawDegrees, true);
    view.setFloat32(at + 16, r.panelWidthMeters, true);
    view.setFloat32(at + 20, r.panelHeightMeters, true);
    view.setFloat32(at + 24, r.panelDepthMeters, true);
    view.setFloat32(at + 28, r.reachMeters, true);
    view.setUint32(at + 32, (r.vehicle ? DOOR_FLAG_VEHICLE : 0) | (r.startOpen ? DOOR_FLAG_START_OPEN : 0), true);
    at += 36;
  }
  return out;
}

/** Wire-format twin of encodeDoors — the round-trip test's reader and the
 *  reference for constructor.zig decodeDoors. */
export function decodeDoors(bytes: Uint8Array): { version: number; records: DoorRecord[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0, true);
  if (version !== DOORS_LUMP_VERSION) throw new Error(`unsupported doors version ${version}`);
  const count = view.getUint32(4, true);
  const records: DoorRecord[] = [];
  let at = 8;
  for (let i = 0; i < count; i += 1) {
    const flags = view.getUint32(at + 32, true);
    records.push({
      x: view.getFloat32(at, true),
      baseY: view.getFloat32(at + 4, true),
      z: view.getFloat32(at + 8, true),
      yawDegrees: view.getFloat32(at + 12, true),
      panelWidthMeters: view.getFloat32(at + 16, true),
      panelHeightMeters: view.getFloat32(at + 20, true),
      panelDepthMeters: view.getFloat32(at + 24, true),
      reachMeters: view.getFloat32(at + 28, true),
      vehicle: (flags & DOOR_FLAG_VEHICLE) !== 0,
      startOpen: (flags & DOOR_FLAG_START_OPEN) !== 0,
    });
    at += 36;
  }
  return { version, records };
}
