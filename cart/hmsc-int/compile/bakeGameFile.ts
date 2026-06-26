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

import { loadEditorWorld, editorMapStateKey } from '../editorWorld';
import { readStoredGameStateForKey, createInitialGameState } from '../state/gameState';
import { createHmscMapfile } from '../packageMap';
import { sceneEnvironmentFromSky } from './sceneEnv';
import { buildHmscSky } from '../render3d/sky';
import { deserializeMap } from '../mapStore';
import { floorsFromEditorWorld, type ChunkFloor } from '../chunkFloor';
import { emitBakedGameFile } from './emitGameFile';
import { writeGameFile } from '@reactjit/workspace/gamefile';
import { sha256Hex } from '@reactjit/workspace/sha256';
import { lastPointerPath, sessionPathFor } from '@reactjit/workspace';
import { readFile, writeFile as fsWriteDiag } from '@reactjit/hooks/fs';
import { openStreamStore } from '../data';
import { editorChannel } from '../editors/store';
import { editorTunables, tuningStream } from '../editors/tunables';
import { buildingsStream, worldStream, piecesForMap, withBuildingPieces } from '@game';
import type { PlacedBuildPiece } from '@game';
import { buildDefaultPlayerAnimation, buildDefaultPlayerModel, encodePlayerAnimationLump, encodePlayerModelLump } from './playerModel';
import { ASSET_KIND_DECAL_IMAGE, createDecalAssetSink } from './decalAssets';
import { ensureCookedRegistry } from '../editors/model/cookedAssets';

const CART = 'hmsc-int';
const EDITOR_DATA_ROOT = 'cart/hmsc-int/data';
// Asset keys: player range 2001/2002; decal images count up from 3001
// (decalAssets.ts DECAL_IMAGE_ASSET_KEY_BASE).
const PLAYER_MODEL_ASSET_KEY = 2001;
const PLAYER_ANIMATION_ASSET_KEY = 2002;
const ASSET_KIND_PLAYER_MODEL = 9;
const ASSET_KIND_PLAYER_ANIMATION = 10;

const warn = (msg: string): void => {
  // severity-warn so it reaches the bake's stderr (the CLI captures it).
  (globalThis as any).console?.warn?.(msg);
};

// ── BAKE MEMORY PROBE (req_1585) ──────────────────────────────────────────────
// The bake OOM'd (V8 JS heap ~1.4GB) after the user added chunks. To localize
// WHERE the bytes blow up rather than guess, log RSS (real process memory) at
// every stage by reading /proc/self/status — VmRSS is current, VmHWM is the
// high-water mark. Pure diagnostic; reads a virtual file, allocates nothing big.
function readProcKb(field: string): number {
  try {
    const status = readFile('/proc/self/status') ?? '';
    const m = status.match(new RegExp(`${field}:\\s*(\\d+)\\s*kB`));
    return m ? Number(m[1]) : -1;
  } catch {
    return -1;
  }
}
const mb = (kb: number): string => (kb < 0 ? '?' : `${(kb / 1024).toFixed(0)}MB`);
function memStage(label: string): void {
  warn(`[bake-mem] ${label.padEnd(28)} rss=${mb(readProcKb('VmRSS'))} peak=${mb(readProcKb('VmHWM'))}`);
}

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

// Studio-cooked props (req_1134) live in the cooked-asset content store, not the
// static catalog. The editor registers them at boot (index.tsx ensureCookedRegistry)
// BEFORE any placement resolves; the bake runs in a fresh v8cli process, so it must
// do the same or a placed `prop.<cooked>` id throws "unknown piece id" mid-bake
// (req_1146: a placed cooked mesh broke Compile entirely). Same EDITOR_DATA_ROOT
// store the world/tuning reads below; idempotent + headless-tolerant.
try {
  ensureCookedRegistry();
} catch (error: any) {
  warn(`[bake] could not register cooked props (ok on older/empty stores): ${String(error?.message ?? error)}`);
}

// --editor-stem <stem> (req_2013): bake ONE map's isolated editor preview — its
// pieces/floors come from that stem (as always) and its terrain/props/roads come
// from the PER-MAP editor key (editorMapStateKey), NOT the global boot key. So the
// editor loader can bake just the active map to its own gamefile without reading
// or writing the game's booted world. No flag → the original /compiled behavior
// (active stem from _last.txt + the global boot key via loadEditorWorld).
const bakeArgv = ((globalThis as any).process?.argv ?? []) as string[];
const editorStemIdx = bakeArgv.indexOf('--editor-stem');
const editorStem = editorStemIdx >= 0 && bakeArgv[editorStemIdx + 1] ? String(bakeArgv[editorStemIdx + 1]) : null;
const stem = editorStem ?? activeStem();
const state = editorStem
  ? (readStoredGameStateForKey(editorMapStateKey(editorStem)) ?? createInitialGameState())
  : loadEditorWorld();
if (editorStem) warn(`[bake] --editor-stem '${editorStem}': isolated per-map editor bake (state from ${editorMapStateKey(editorStem)}, not the boot key)`);
// TEMP DIAG (req_1505): record what the BOOT KEY actually carries when the bake
// reads it — compared with the live-previewWorld diag, this localizes whether the
// auto-generated signs are lost in the write/read (clobber) or never present.
try {
  const dp: any[] = (state as any).world?.props ?? [];
  const signKinds = ['streetSign', 'stopSign', 'trafficLight', 'streetLight'];
  const signs = dp.filter((p) => signKinds.includes(p.kind));
  fsWriteDiag('/tmp/rjit-bake-diag.json', JSON.stringify({
    when: 'bakeGameFile(loadEditorWorld boot key)',
    stem,
    props: dp.length,
    signs: signs.length,
    signTexts: [...new Set(signs.map((p) => p.text).filter(Boolean))],
    studioProps: dp.filter((p) => String(p.kind).startsWith('studio.')).map((p) => p.kind),
    roadNames: ((state as any).world?.roads ?? []).map((r: any) => r.name).filter(Boolean),
  }, null, 2));
} catch { /* diag best-effort */ }
// --no-pieces (LIVEHOST/bake-free editing, req_1804): the editor's loader pane bakes a
// PIECE-FREE world (terrain/props/scenery only) and renders all build pieces from a LIVE
// streaming overlay the editor pushes, so place/delete/move/rotate are instant with no
// rebake. The /compiled bake omits this flag → pieces baked as before. Reading the flag
// here (not deeper) keeps the whole geometry/collider pipeline naturally piece-free.
const noPieces = ((globalThis as any).process?.argv ?? []).includes('--no-pieces');
const pieces = noPieces ? [] : readPlacedPieces(stem);
if (noPieces) warn('[bake] --no-pieces: baking terrain/props only; build pieces render live in the editor');
const floors = readPaintedFloors(stem);
memStage('after world load (state/pieces/floors)');
// The render environment IS /test's: build it from the SAME buildHmscSky the
// game's WorldStatics lights the scene with, so the loader's lighting/sky match.
const sky = buildHmscSky(state.config.sky.hour, state.config.sky.weather, state.config.sky.gloom);
const env = sceneEnvironmentFromSky(sky);
// Decal image payloads (DECALIMG-0610, req_0592): the materials intern reads
// each image file ONCE (sha256-deduped) while the mapfile builds; the keys land
// in the packed docs, the bytes ship below as content-addressed assets.
const decalAssets = createDecalAssetSink();
// Fold the persisted /settings tuning over the registered globals so the compiled
// world matches what the editor shows — e.g. grass colour/height/density tuned on
// /settings (GRASS_CONFIG). Same store root (cart/hmsc-int/data) the editor writes
// to and this bake already reads the map from; same fold index.tsx does on boot.
try {
  editorTunables().applyOverrides(editorChannel(tuningStream).state().overrides);
} catch {
  // no fs / empty store headless → registered code defaults; the bake still runs.
}
memStage('before createHmscMapfile');
const mapContainer = createHmscMapfile(state, pieces, floors, env, { includePlayerLumps: false, decalAssets });
warn(`[bake-mem] mapContainer = ${(mapContainer.byteLength / 1024 / 1024).toFixed(1)}MB`);
memStage('after createHmscMapfile');
for (const asset of decalAssets.assets) {
  warn(`[bake] prepared decal image asset ${asset.hashHex} (${asset.bytes.byteLength} bytes, key ${asset.key}, src '${asset.src}')`);
}
const playerModelData = buildDefaultPlayerModel();
const playerModel = encodePlayerModelLump(playerModelData);
const playerAnimation = encodePlayerAnimationLump(buildDefaultPlayerAnimation(playerModelData.groups.length));

const playerModelHash = sha256Hex(playerModel);
const playerAnimationHash = sha256Hex(playerAnimation);
warn(`[bake] prepared player model asset ${playerModelHash} (${playerModel.byteLength} bytes)`);
warn(`[bake] prepared player animation asset ${playerAnimationHash} (${playerAnimation.byteLength} bytes)`);

const file = writeGameFile({
  logic: { refs: [], data: new Uint8Array(0) },
  map: {
    // The map stream's data (the MATERIALS lump's packed docs) references the
    // decal image keys, so they belong in its declared refs — the loader's
    // installAndValidate gate resolves every one against the manifest.
    refs: [PLAYER_MODEL_ASSET_KEY, PLAYER_ANIMATION_ASSET_KEY, ...decalAssets.assets.map((a) => a.key)],
    data: mapContainer,
  },
  skins: { refs: [], data: new Uint8Array(0) },
  assets: [
    { key: PLAYER_MODEL_ASSET_KEY, kind: ASSET_KIND_PLAYER_MODEL, bytes: playerModel, embed: false },
    { key: PLAYER_ANIMATION_ASSET_KEY, kind: ASSET_KIND_PLAYER_ANIMATION, bytes: playerAnimation, embed: false },
    ...decalAssets.assets.map((a) => ({ key: a.key, kind: ASSET_KIND_DECAL_IMAGE, bytes: a.bytes, embed: false })),
  ],
});
warn(`[bake-mem] writeGameFile = ${(file.byteLength / 1024 / 1024).toFixed(1)}MB`);
memStage('after writeGameFile');

// Hand the packed binary to the CLI ON DISK (GUIDING_LIGHT: pack binary, not
// base64 text — see emitGameFile.ts). Writes the game-file + content-addressed
// asset blobs straight to the paths the CLI passed (--gamefile / --store) and
// prints only a small manifest. No base64, no megabyte JSON, no GC bomb.
emitBakedGameFile(file, [
  { hash: playerModelHash, bytes: playerModel },
  { hash: playerAnimationHash, bytes: playerAnimation },
  ...decalAssets.assets.map((a) => ({ hash: a.hashHex, bytes: a.bytes })),
]);
memStage('after emit (binary written to disk)');
