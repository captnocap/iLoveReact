// The editor's world model. hmsc-int authors a REAL GameState — the same record
// the game boots from — not a pile of command text. Because localstore is one
// shared store across carts (fs.init("reactjit"), see the
// hmsc_localstore_shared_across_carts memory), writing the 'hmsc'/'game-state'
// key here IS how the game receives the authored world: it boots via
// readStoredGameState() in cart/hmsc/index.tsx. So "compile" = persist.
//
// Every mutation goes through the GAME's own world mutators (placeProp, addZone,
// addSurfaceRegion, placeCell), so an authored prop/zone/tile is byte-identical
// to one the game made itself —
// same ids, same collision, same borrow-a-tileKind gameplay. No parallel schema,
// no emit/parse round-trip that can drift.

import type {
  GameState,
  PropKind,
  TileKind,
  WorldProp,
  WorldSurfaceRegion,
  Zone,
  ZoneFlag,
} from './design';
import {
  createInitialGameState,
  readStoredGameState,
  saveGameState,
} from './state/gameState';
import { landformGroundTopAt } from './world/landforms';
import { placeProp, removeProp, propFootprint } from './world/props';
import { addZone, removeZone } from './world/zones';
import { addSurfaceRegion, placeCell } from './world/grid';
import { propKindDefinition } from './game/kinds/props';
import { nextUniqueId } from './world/idgen';
import { writeHmscPackageFromState } from './packageMap';

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
  const saved = saveGameState(state);
  writeHmscPackageFromState(saved);
  return saved;
}

// Reset the authored world to the fresh demo city. Returns the new state; the
// caller persists it (compile) to make the reset the booted world.
export function resetEditorWorld(): GameState {
  return createInitialGameState();
}

// A clean slate: the same GameState shape the game boots from, but with NO
// authored content — no props, roads, junctions, landforms, zones, or
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
      interiors: {},
      landforms: [],
      zones: [],
      spawnedEntities: {},
      npcs: {},
    },
  };
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
    const def = propKindDefinition(prop.kind);
    const fp = propFootprint(prop);
    const dx = fp ? (x < fp.minX ? fp.minX - x : x > fp.maxX ? x - fp.maxX : 0) : prop.x - x;
    const dz = fp ? (z < fp.minZ ? fp.minZ - z : z > fp.maxZ ? z - fp.maxZ : 0) : prop.z - z;
    const d = Math.hypot(dx, dz);
    const reach = fp ? 0 : Math.max(def.footprintRadiusMeters, 0.5);
    if (d - reach < bestDist) {
      bestDist = Math.max(0, d - reach);
      best = prop;
    }
  }
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
  opts: { kind: 'spawn' | 'save' | 'vehicleSpawn'; x: number; z: number; spawnKey?: string },
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
