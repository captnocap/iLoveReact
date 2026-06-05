// game/world/authored — load the USER'S AUTHORED MAP through this door.
//
// THE CHANNEL (traced, not invented): the editor stages a real GameState and
// "Compile" persists it to the shared localstore key 'hmsc'/'game-state' via
// saveGameState (cart/hmsc-int/editorWorld.ts; localstore is ONE store across
// carts — fs.init("reactjit")). The game boots by reading that exact key.
// Painted chunks lower to 'heightfield' landforms (field grids), placements
// to buildings/props/markers, markers to single placedCells, and the first
// spawn marker becomes the player start + armed respawnCell.
//
// This module CONSUMES that persisted record as DATA — it extracts the
// world-grid slice this door owns plus the player's start/respawn, tolerantly
// (absent layers → empty, malformed JSON → null), and never forks the
// editor's codec or mutators. Other lanes (roads, buildings, props, zones …)
// read their own layers from the same record; `raw` hands it to them parsed
// once, as data.

import { createWorldGridState, type GridCell, type WorldGridState } from './grid';

declare const globalThis: any;

/** The shared boot channel — the editor writes it, the game boots from it. */
export const AUTHORED_WORLD_STORE = Object.freeze({
  namespace: 'hmsc',
  key: 'game-state',
});

export type AuthoredWorld = {
  grid: WorldGridState;
  player: {
    /** authored start position (the compile put it on the first spawn marker) */
    position: { x: number; y: number; z: number } | null;
    /** the armed respawn cell, when the authored map carries one */
    respawnCell: GridCell | null;
  };
  /** the full persisted record, parsed once — DATA for the other world lanes */
  raw: Record<string, unknown>;
};

/** Read the raw boot-key payload via the host localstore shims (both names). */
export function readAuthoredWorldRaw(): string | null {
  if (typeof globalThis.__localstoreGet === 'function') {
    const value = globalThis.__localstoreGet(AUTHORED_WORLD_STORE.namespace, AUTHORED_WORLD_STORE.key);
    return value ? String(value) : null;
  }
  if (typeof globalThis.__store_get === 'function') {
    const value = globalThis.__store_get(`${AUTHORED_WORLD_STORE.namespace}:${AUTHORED_WORLD_STORE.key}`);
    return value ? String(value) : null;
  }
  return null;
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asCell(value: any): GridCell | null {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

/**
 * Extract this door's world-grid slice + player start from a persisted
 * GameState record. Tolerant by contract (V20 schema evolution by addition):
 * an absent layer is empty, never an error; unknown extra fields pass through
 * in `raw` untouched.
 */
export function authoredWorldFromRecord(parsed: Record<string, unknown>): AuthoredWorld {
  const world: any = (parsed as any).world ?? {};
  const player: any = (parsed as any).player ?? {};
  const base = createWorldGridState();
  const grid: WorldGridState = {
    cellSizeMeters: asNumber(world.cellSizeMeters, base.cellSizeMeters),
    surfaceRegions: Array.isArray(world.surfaceRegions) ? world.surfaceRegions : [],
    placedCells: world.placedCells && typeof world.placedCells === 'object' ? world.placedCells : {},
    landforms: Array.isArray(world.landforms) ? world.landforms : [],
  };
  const position = player.position && Number.isFinite(Number(player.position.x))
    ? { x: Number(player.position.x), y: asNumber(player.position.y, 0), z: asNumber(player.position.z, 0) }
    : null;
  return {
    grid,
    player: { position, respawnCell: asCell(player.respawnCell) },
    raw: parsed,
  };
}

/**
 * The user's authored map, loaded through the door: read the boot key, parse,
 * extract. null when nothing is authored yet (or the payload is malformed) —
 * the caller decides its blank-world fallback; this never fakes one.
 */
export function loadAuthoredWorld(): AuthoredWorld | null {
  const raw = readAuthoredWorldRaw();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return authoredWorldFromRecord(parsed);
  } catch {
    return null;
  }
}
