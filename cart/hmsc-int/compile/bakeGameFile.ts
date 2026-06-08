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
import { bytesToBase64 } from '@reactjit/workspace';
import { writeGameFile } from '@reactjit/workspace/gamefile';
import { lastPointerPath } from '@reactjit/workspace';
import { readFile } from '@reactjit/hooks/fs';
import { openStore } from '../data';
import { worldStream, piecesForMap } from '@game';
import type { PlacedBuildPiece } from '@game';

const CART = 'hmsc-int';
const EDITOR_DATA_ROOT = 'cart/hmsc-int/data';

const warn = (msg: string): void => {
  // severity-warn so it reaches the bake's stderr (the CLI captures it).
  (globalThis as any).console?.warn?.(msg);
};

/** Read the active map's placed build pieces from the editor's world stream —
 *  the SAME set /test renders (active stem from sessions/_last.txt, merged with
 *  the legacy global pool via piecesForMap). Returns [] (with a warning) if the
 *  store can't be opened, so the bake still emits the painted-world geometry. */
function readPlacedPieces(): PlacedBuildPiece[] {
  let stem: string | null = null;
  try {
    stem = (readFile(lastPointerPath(CART)) ?? '').trim() || null;
  } catch {
    stem = null;
  }
  try {
    const store = openStore(EDITOR_DATA_ROOT);
    const world = store.defineStream(worldStream);
    const pieces = piecesForMap(world.state(), stem ?? '', { legacyMapName: stem });
    warn(`[bake] read ${pieces.length} placed pieces from world stream (map=${stem ?? '<none>'})`);
    return pieces;
  } catch (error: any) {
    warn(`[bake] could not read placed pieces from the world stream: ${String(error?.message ?? error)}`);
    return [];
  }
}

const state = loadEditorWorld();
const pieces = readPlacedPieces();
const mapContainer = createHmscMapfile(state, pieces);

const file = writeGameFile({
  logic: { refs: [], data: new Uint8Array(0) },
  map: { refs: [], data: mapContainer },
  skins: { refs: [], data: new Uint8Array(0) },
  assets: [],
});

const emit = (globalThis as any).print ?? console.log;
emit(bytesToBase64(file));
