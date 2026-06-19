// npcModels.ts — bake an NPC population into loader-ready mesh + spawn data.
//
// This is the player figure path applied N times (compile/playerModel.ts):
// each NPC model is a set of mesh groups in the EXACT PLAYER_MODEL layout, so
// the no-V8 loader renders them with the same machinery and reuses
// PLAYER_ANIMATION unchanged (same neutral + tee/jeans skeleton ⇒ same node
// order ⇒ the clips apply to NPCs verbatim — animation stored once, referenced).
//
// Two lumps:
//   NPC_MODELS  = u32 version | u32 modelCount | per model: u32 groupCount | groups[]
//                 (each group is the SAME 68-byte header + verts(+texture) the
//                  PLAYER_MODEL lump uses — writeModelGroup is the shared writer)
//   NPC_SPAWNS  = u32 version | u32 count | per spawn:
//                 u32 modelIndex | f32 x,z,yaw | u32 kind | u32 faction
//                 (kind/faction are enums reserved for the Stage-2 Zig AI; the
//                  Stage-1 loader ignores them and just renders/animates).
//
// The Zig twins are decodeNpcModels / decodeNpcSpawns in
// framework/world/constructor.zig — TS encode and Zig parse must agree
// byte-for-byte (the PLAYER_MODEL hazard).

import { MAP_LUMP } from '@reactjit/workspace';
import {
  buildFigureModel,
  modelGroupByteLength,
  writeModelGroup,
  type BakedPlayerModel,
} from './playerModel';
import type { ClothingId, BottomsId } from '@game/figure/shapes';

export const NPC_MODELS_LUMP = MAP_LUMP.NPC_MODELS;
export const NPC_SPAWNS_LUMP = MAP_LUMP.NPC_SPAWNS;
export const NPC_MODELS_VERSION = 1;
export const NPC_SPAWNS_VERSION = 1;

const NPC_SPAWN_BYTES = 24; // u32 modelIndex + f32 x,z,yaw + u32 kind + u32 faction

export type NpcSpawn = {
  modelIndex: number;
  x: number;
  z: number;
  yaw: number; // radians, matching PlayerState.yaw
  kind: number;
  faction: number;
};

export type BakedNpcPopulation = {
  models: BakedPlayerModel[];
  spawns: NpcSpawn[];
};

// The Stage-1 test population: a small set of distinct figures placed in a row
// near the map anchor so they are immediately visible when the loader boots.
// Seeds vary the face/proportions; outfit (hence rig structure + group count)
// is fixed so every model stays PLAYER_ANIMATION-compatible. Replaced by real
// authored NPC placements once the editor grows an NPC tool.
const STAGE1_SEEDS: ReadonlyArray<{ seed: number; top: ClothingId; bottoms: BottomsId }> = [
  { seed: 11, top: 'tee', bottoms: 'jeans' },
  { seed: 23, top: 'hoodie', bottoms: 'slacks' },
  { seed: 37, top: 'tee', bottoms: 'shorts' },
  { seed: 51, top: 'suit', bottoms: 'slacks' },
];

const STAGE1_POPULATION = 8; // how many NPCs to spawn from the seed set
const STAGE1_SPACING_METERS = 2.5;

// y is NOT baked: the loader samples the terrain top at each (x,z) the same way
// it grounds the player spawn (sceneTerrainTopAt), so NPCs rest on painted
// hills without the bake guessing a height.
export function buildDefaultNpcPopulation(anchor: { x: number; z: number }): BakedNpcPopulation {
  const models = STAGE1_SEEDS.map((s) => buildFigureModel(s.seed, s.top, s.bottoms));
  const spawns: NpcSpawn[] = [];
  // A line offset from the anchor along +x, all facing -z toward the anchor so
  // the figures read as a small crowd rather than a wall.
  const baseX = anchor.x - ((STAGE1_POPULATION - 1) * STAGE1_SPACING_METERS) / 2;
  for (let i = 0; i < STAGE1_POPULATION; i += 1) {
    const x = baseX + i * STAGE1_SPACING_METERS;
    const z = anchor.z + 6;
    spawns.push({
      modelIndex: i % models.length,
      x,
      z,
      yaw: 0,
      kind: 0,
      faction: 0,
    });
  }
  return { models, spawns };
}

export function encodeNpcModelsLump(models: readonly BakedPlayerModel[]): Uint8Array {
  let bytes = 8; // version + modelCount
  for (const model of models) {
    bytes += 4; // groupCount
    for (const group of model.groups) bytes += modelGroupByteLength(group);
  }
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, NPC_MODELS_VERSION, true);
  view.setUint32(4, models.length, true);
  let at = 8;
  for (const model of models) {
    view.setUint32(at, model.groups.length, true);
    at += 4;
    for (const group of model.groups) at = writeModelGroup(out, view, at, group);
  }
  return out;
}

export function encodeNpcSpawnsLump(spawns: readonly NpcSpawn[]): Uint8Array {
  const out = new Uint8Array(8 + spawns.length * NPC_SPAWN_BYTES);
  const view = new DataView(out.buffer);
  view.setUint32(0, NPC_SPAWNS_VERSION, true);
  view.setUint32(4, spawns.length, true);
  let at = 8;
  for (const spawn of spawns) {
    view.setUint32(at + 0, spawn.modelIndex >>> 0, true);
    view.setFloat32(at + 4, spawn.x, true);
    view.setFloat32(at + 8, spawn.z, true);
    view.setFloat32(at + 12, spawn.yaw, true);
    view.setUint32(at + 16, spawn.kind >>> 0, true);
    view.setUint32(at + 20, spawn.faction >>> 0, true);
    at += NPC_SPAWN_BYTES;
  }
  return out;
}
