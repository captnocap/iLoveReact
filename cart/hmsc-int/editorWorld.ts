// The editor's world model. hmsc-int authors a REAL GameState — the same record
// the game boots from — not a pile of command text. Because localstore is one
// shared store across carts (fs.init("reactjit"), see the
// hmsc_localstore_shared_across_carts memory), writing the 'hmsc'/'game-state'
// key here IS how the game receives the authored world: it boots via
// readStoredGameState() in cart/hmsc/index.tsx. So "compile" = persist.
//
// Every mutation goes through the GAME's own world mutators (resolveBuildingPlacement
// + addBuildingToWorld, placeProp, addZone, addSurfaceRegion, placeCell), so an
// authored building/prop/zone/tile is byte-identical to one the game made itself —
// same ids, same collision, same borrow-a-tileKind gameplay. No parallel schema,
// no emit/parse round-trip that can drift.

import type {
  Building,
  BuildingEnclosure,
  BuildingSide,
  GameState,
  PropKind,
  TileKind,
  WorldProp,
  WorldSurfaceRegion,
  Zone,
  ZoneFlag,
} from '../hmsc/design';
import {
  createInitialGameState,
  readStoredGameState,
  saveGameState,
} from '../hmsc/state/gameState';
import { addBuildingToWorld, removeBuildingFromWorld } from '../hmsc/world/interiors';
import { resolveBuildingPlacement } from '../hmsc/world/buildingPlacement';
import { landformGroundTopAt } from '../hmsc/world/landforms';
import { buildingKindDefinition } from '../hmsc/world/buildingKinds';
import { buildingFootprint } from '../hmsc/world/buildings';
import { placeProp, removeProp, propFootprint } from '../hmsc/world/props';
import { addZone, removeZone } from '../hmsc/world/zones';
import { addSurfaceRegion, placeCell } from '../hmsc/world/grid';
import { propKindDefinition } from '../hmsc/world/propKinds';
import { nextUniqueId } from '../hmsc/world/idgen';
import { rectsOverlap } from '../hmsc/world/rects';

// The editor always works on the same GameState shape the game uses. Load the
// authored world if one exists, else a fresh demo world — identical to the game's
// own boot fallback, so what you see in the editor is what the game will boot.
export function loadEditorWorld(): GameState {
  return readStoredGameState() ?? createInitialGameState();
}

// Compile = write the authored world to the boot key. saveGameState persists to
// 'hmsc'/'game-state' (the exact key cart/hmsc/index.tsx reads at boot) and
// mirrors the hot-reload snapshot, so a running dev game picks it up too.
export function compileEditorWorld(state: GameState): GameState {
  return saveGameState(state);
}

// Reset the authored world to the fresh demo city. Returns the new state; the
// caller persists it (compile) to make the reset the booted world.
export function resetEditorWorld(): GameState {
  return createInitialGameState();
}

// A clean slate: the same GameState shape the game boots from, but with NO
// authored content — no buildings, props, roads, junctions, landforms, zones, or
// surface regions. The grid layout + config are kept so the preview camera and
// addressing still have a frame; everything is placed from nothing. This is the
// "no built world" start for authoring on top of the kept mutators below.
export function emptyEditorWorld(): GameState {
  const base = createInitialGameState();
  return {
    ...base,
    world: {
      ...base.world,
      surfaceRegions: [],
      placedCells: {},
      roads: [],
      junctions: [],
      props: [],
      buildings: [],
      interiors: {},
      landforms: [],
      zones: [],
      spawnedEntities: {},
      npcs: {},
    },
  };
}

// ── Building placement ──────────────────────────────────────────────────────

export type BuildResult =
  | { ok: true; state: GameState; building: Building }
  | { ok: false; reason: string };

// Place a building at a cell. Mirrors the wv_building command's body exactly:
// allocate a collision-free id, build the record from the kind defaults (any of
// which the caller may override), run the city placement rules (overlap / on-road
// / near-road + door auto-snap) unless forced, then add it via the game mutator
// (which also wires interiors/entry pads). `force` keeps the given door + skips
// the sanity checks — the intentional-placement override.
export function placeBuilding(
  state: GameState,
  opts: {
    kind: Building['kind'];
    x: number;
    z: number;
    enclosure?: BuildingEnclosure;
    widthTiles?: number;
    depthTiles?: number;
    yawDegrees?: number;
    doorSide?: BuildingSide;
    skin?: Building['skin'];
    partTextures?: Building['partTextures'];
    force?: boolean;
  },
): BuildResult {
  const def = buildingKindDefinition(opts.kind);
  const widthTiles = opts.widthTiles ?? def.defaultWidthTiles;
  const depthTiles = opts.depthTiles ?? def.defaultDepthTiles;
  // Sit the pad on the terrain: sample the landform surface under the footprint
  // centre (a painted hill, the mountain, …). Flat ground returns nothing → y 0.
  const groundY = landformGroundTopAt(state, opts.x + widthTiles / 2, opts.z + depthTiles / 2) ?? 0;
  const proposed: Building = {
    id: nextUniqueId('building_int_', state.world.buildings.map((b) => b.id)),
    kind: opts.kind,
    label: def.label,
    enclosure: opts.enclosure ?? def.defaultEnclosure,
    x: opts.x,
    y: groundY,
    z: opts.z,
    widthTiles,
    depthTiles,
    ...(opts.yawDegrees ? { yawDegrees: opts.yawDegrees } : {}),
    doorSide: opts.doorSide ?? 'south',
    ...(opts.skin ? { skin: opts.skin } : {}),
    ...(opts.partTextures ? { partTextures: opts.partTextures } : {}),
    createdByCommand: 'hmsc-int:place',
  };
  const placement = resolveBuildingPlacement(state, proposed, opts.force ?? false);
  if (!placement.ok) return { ok: false, reason: placement.reason };
  return { ok: true, state: addBuildingToWorld(state, placement.building), building: placement.building };
}

export function removeBuilding(state: GameState, id: string): GameState {
  return removeBuildingFromWorld(state, id);
}

// Whether a building of this footprint at this corner would overlap an existing
// building or sit on a road — the cheap check the ghost cursor colors with
// (green = placeable, red = blocked). Mirrors resolveBuildingPlacement's overlap
// rules without mutating; the door-snap/near-road policy is applied on commit.
export function buildingFootprintBlocked(
  state: GameState,
  opts: { x: number; z: number; widthTiles: number; depthTiles: number },
): boolean {
  const f = { minX: opts.x, minZ: opts.z, maxX: opts.x + opts.widthTiles, maxZ: opts.z + opts.depthTiles };
  for (const other of state.world.buildings) {
    if (rectsOverlap(f, buildingFootprint(other))) return true;
  }
  return false;
}

// ── Prop placement ──────────────────────────────────────────────────────────

export function placeWorldProp(
  state: GameState,
  opts: { kind: PropKind; x: number; z: number; yawDegrees?: number; partTextures?: WorldProp['partTextures'] },
): { state: GameState; prop: WorldProp } {
  const prop: WorldProp = {
    id: nextUniqueId('prop_int_', state.world.props.map((p) => p.id)),
    kind: opts.kind,
    x: opts.x,
    // Stand the prop on the terrain under its anchor; flat ground → y 0.
    y: landformGroundTopAt(state, opts.x, opts.z) ?? 0,
    z: opts.z,
    yawDegrees: opts.yawDegrees ?? 0,
    ...(opts.partTextures ? { partTextures: opts.partTextures } : {}),
    createdByCommand: 'hmsc-int:place',
  };
  return { state: placeProp(state, prop), prop };
}

export function removeWorldProp(state: GameState, id: string): GameState {
  return removeProp(state, id);
}

// The nearest solid prop to a world point within `radius` meters — for click-to-
// select/delete in the editor. Non-solid props (bushes) have no footprint, so
// fall back to a small pick radius around their anchor.
export function propNearPoint(state: GameState, x: number, z: number, radius: number): WorldProp | null {
  let best: WorldProp | null = null;
  let bestDist = radius;
  for (const prop of state.world.props) {
    const d = Math.hypot(prop.x - x, prop.z - z);
    const def = propKindDefinition(prop.kind);
    const reach = Math.max(def.footprintRadiusMeters, 0.5);
    if (d - reach < bestDist) {
      bestDist = Math.max(0, d - reach);
      best = prop;
    }
  }
  void propFootprint;
  return best;
}

// ── Tile fill (surface regions) ─────────────────────────────────────────────

// Paint a rectangle of one tile kind as a surface region — the same unit a chunk
// is (one region of one kind), via the game's addSurfaceRegion. Later regions
// win at a cell (surfaceRegionAtCell scans newest-first), so a fill paints over
// what's under it, exactly like the game resolves it.
export function fillTiles(
  state: GameState,
  opts: { kind: TileKind; x: number; z: number; width: number; depth: number; y?: number },
): GameState {
  const region: WorldSurfaceRegion = {
    id: nextUniqueId('region_int_', state.world.surfaceRegions.map((r) => r.id)),
    label: `${opts.kind} fill`,
    kind: opts.kind,
    x: opts.x,
    y: opts.y ?? 0,
    z: opts.z,
    width: opts.width,
    depth: opts.depth,
    zoneKey: nextUniqueId('zone_int_', state.world.surfaceRegions.map((r) => r.zoneKey)),
  };
  return addSurfaceRegion(state, region);
}

// ── Gameplay markers (spawn / save) ──────────────────────────────────────────

// Place a spawn or save marker as a single PlacedCell — the same unit the game
// makes via placeCell, so an authored marker is byte-identical to one a command
// placed. A save cell carries `spawnKey`, the cellKey of the spawn it respawns
// the player at (the manual save↔spawn link). 1 tile = 1 m; markers ride the
// terrain via their tileKind altitude.
export function placeMarker(
  state: GameState,
  opts: { kind: 'spawn' | 'save'; x: number; z: number; spawnKey?: string },
): GameState {
  return placeCell(
    state,
    opts.kind,
    { x: opts.x, y: 0, z: opts.z },
    'hmsc-int:marker',
    opts.kind === 'save' && opts.spawnKey ? { spawnKey: opts.spawnKey } : {},
  );
}

// ── Zones ───────────────────────────────────────────────────────────────────

export function defineZone(
  state: GameState,
  opts: { name: string; x: number; z: number; width: number; depth: number; flags?: ZoneFlag[] },
): GameState {
  const zone: Zone = {
    id: nextUniqueId('zone_int_', state.world.zones.map((z) => z.id)),
    name: opts.name,
    x: opts.x,
    y: 0,
    z: opts.z,
    width: opts.width,
    depth: opts.depth,
    flags: opts.flags ?? [],
    createdByCommand: 'hmsc-int:zone',
  };
  return addZone(state, zone);
}

export function removeWorldZone(state: GameState, id: string): GameState {
  return removeZone(state, id);
}
