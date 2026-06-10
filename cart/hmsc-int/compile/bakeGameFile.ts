// bakeGameFile.ts — bake the AUTHORED hmsc world into a platform game-file.
//
// This is the editor->loader bridge (PLATMOD step 4): it takes the world you
// actually authored in hmsc-int and lowers it to a platform game-file the
// stateless no-V8 loader (world_loader.zig) renders — your REAL map, not a
// hand-typed fixture. Two real sources, the same two the /test play view reads:
//
//   • the painted GameState (loadEditorWorld = your saved world, else the demo
//     city) — surface regions / roads / props / landforms; and
//   • the BUILD WORLD STREAM's PLACED PIECES (world.state().pieces) — the
//     walls/floors/pillars that make the city's TOWERS and prefab buildings.
//     The active map is whatever /test shows (sessions/_last.txt), merged with
//     the legacy global pool exactly as PlayRoute does (piecesForMap).
//
// createHmscMapfile transcodes both into the RJMP map container (incl. the 3D
// instance lump worldGeometry.ts builds); writeGameFile wraps it as the game-
// map stream. Logic / skins streams + the asset vocabulary stay empty for now.
// Emits the game-file as base64 on stdout (same shape the round-trip fixtures
// use) so `rjit game play/shot` can capture it.

import { loadEditorWorld } from '../editorWorld';
import { createHmscMapfile } from '../packageMap';
import { sceneEnvironmentFromSky } from './sceneEnv';
import { buildHmscSky } from '../../hmsc/render3d/sky';
import { deserializeMap } from '../mapStore';
import { floorsFromEditorWorld, type ChunkFloor } from '../chunkFloor';
import { bytesToBase64 } from '@reactjit/workspace';
import { writeGameFile } from '@reactjit/workspace/gamefile';
import { sha256Hex } from '@reactjit/workspace/sha256';
import { lastPointerPath, sessionPathFor } from '@reactjit/workspace';
import { readFile } from '@reactjit/hooks/fs';
import { openStreamStore } from '../data';
import { buildingsStream, worldStream, piecesForMap, withBuildingPieces } from '@game';
import type { PlacedBuildPiece } from '@game';
import { buildDefaultPlayerAnimation, buildDefaultPlayerModel, encodePlayerAnimationLump, encodePlayerModelLump } from './playerModel';

const CART = 'hmsc-int';
const EDITOR_DATA_ROOT = 'cart/hmsc-int/data';
const PLAYER_MODEL_ASSET_KEY = 2001;
const PLAYER_ANIMATION_ASSET_KEY = 2002;
const ASSET_KIND_PLAYER_MODEL = 9;
const ASSET_KIND_PLAYER_ANIMATION = 10;

const warn = (msg: string): void => {
  // severity-warn so it reaches the bake's stderr (the CLI captures it).
  (globalThis as any).console?.warn?.(msg);
};

/** The active map stem — what /test shows (sessions/_last.txt). */
function activeStem(): string | null {
  try {
    return (readFile(lastPointerPath(CART)) ?? '').trim() || null;
  } catch {
    return null;
  }
}

/** Read the active map's placed build pieces — its OWN scoped pieces only
 *  (piecesByMap[stem]), the content that map actually holds.
 *
 *  We deliberately do NOT merge the legacy global pool (`state.pieces`,
 *  legacyMapName: null). That pool is orphaned pre-multimap content belonging to
 *  no current named map; merging it leaks another map's buildings into every map
 *  (an EMPTY map rendered a city). /test only merges it when the map had authored
 *  content at mount — for the build-editor maps here that is effectively never,
 *  so scoped-only is the faithful match: each map renders exactly its own pieces.
 *  Returns [] (with a warning) if the store can't be opened. */
function readPlacedPieces(stem: string | null): PlacedBuildPiece[] {
  try {
    const store = openStreamStore(EDITOR_DATA_ROOT, 'world');
    const world = store.defineStream(worldStream);
    // buildings (req_0513): the compile SEES THROUGH instances — derived
    // stamps merge into the same pieces view (V24's bake contract; native
    // instance consumption is slice 4 / V29 references). Tolerant: an older
    // store with no buildings domain bakes loose pieces alone.
    let buildingPieces: PlacedBuildPiece[] = [];
    try {
      const bstore = openStreamStore(EDITOR_DATA_ROOT, 'buildings');
      const buildings = bstore.defineStream(buildingsStream);
      buildingPieces = withBuildingPieces([], buildings.state(), stem ?? '');
    } catch (error: any) {
      warn(`[bake] no buildings stream (ok on older stores): ${String(error?.message ?? error)}`);
    }
    const pieces = [
      ...piecesForMap(world.state(), stem ?? '', { legacyMapName: null }),
      ...buildingPieces,
    ];
    warn(`[bake] read ${pieces.length} placed pieces (${buildingPieces.length} from buildings; scoped to map=${stem ?? '<none>'})`);
    return pieces;
  } catch (error: any) {
    warn(`[bake] could not read placed pieces from the world stream: ${String(error?.message ?? error)}`);
    return [];
  }
}

/** Read the active map's PAINTED FLOOR — the user's real ground. It lives in the
 *  workspace map session payload as the editor world's chunks; reconstruct it the
 *  same way the editor does (deserializeMap → floorsFromEditorWorld), so the bake
 *  picks up the live paint (no Compile needed). */
function readPaintedFloors(stem: string | null): ChunkFloor[] {
  if (!stem) return [];
  try {
    const text = readFile(sessionPathFor(CART, stem));
    if (!text) return [];
    const payload = JSON.parse(text)?.payload;
    if (!payload?.world) return [];
    const floors = floorsFromEditorWorld(deserializeMap(payload.world));
    const painted = floors.reduce((n, f) => n + (f.tileData[0] | 0) * (f.tileData[1] | 0), 0);
    warn(`[bake] read ${floors.length} painted floor chunk(s) (~${painted} cells) from map session`);
    return floors;
  } catch (error: any) {
    warn(`[bake] could not read the painted floor: ${String(error?.message ?? error)}`);
    return [];
  }
}

const stem = activeStem();
const state = loadEditorWorld();
const pieces = readPlacedPieces(stem);
const floors = readPaintedFloors(stem);
// The render environment IS /test's: build it from the SAME buildHmscSky the
// game's WorldStatics lights the scene with, so the loader's lighting/sky match.
const sky = buildHmscSky(state.config.sky.hour, state.config.sky.weather, state.config.sky.gloom);
const env = sceneEnvironmentFromSky(sky);
const mapContainer = createHmscMapfile(state, pieces, floors, env, { includePlayerLumps: false });
const playerModelData = buildDefaultPlayerModel();
const playerModel = encodePlayerModelLump(playerModelData);
const playerAnimation = encodePlayerAnimationLump(buildDefaultPlayerAnimation(playerModelData.groups.length));

const playerModelHash = sha256Hex(playerModel);
const playerAnimationHash = sha256Hex(playerAnimation);
warn(`[bake] prepared player model asset ${playerModelHash} (${playerModel.byteLength} bytes)`);
warn(`[bake] prepared player animation asset ${playerAnimationHash} (${playerAnimation.byteLength} bytes)`);

const file = writeGameFile({
  logic: { refs: [], data: new Uint8Array(0) },
  map: { refs: [PLAYER_MODEL_ASSET_KEY, PLAYER_ANIMATION_ASSET_KEY], data: mapContainer },
  skins: { refs: [], data: new Uint8Array(0) },
  assets: [
    { key: PLAYER_MODEL_ASSET_KEY, kind: ASSET_KIND_PLAYER_MODEL, bytes: playerModel, embed: false },
    { key: PLAYER_ANIMATION_ASSET_KEY, kind: ASSET_KIND_PLAYER_ANIMATION, bytes: playerAnimation, embed: false },
  ],
});

const emit = (globalThis as any).print ?? console.log;
emit(JSON.stringify({
  gamefile: bytesToBase64(file),
  assets: [
    { hash: playerModelHash, base64: bytesToBase64(playerModel), bytes: playerModel.byteLength },
    { hash: playerAnimationHash, base64: bytesToBase64(playerAnimation), bytes: playerAnimation.byteLength },
  ],
}));
