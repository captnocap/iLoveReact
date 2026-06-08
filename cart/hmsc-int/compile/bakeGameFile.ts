// bakeGameFile.ts — bake the AUTHORED hmsc world into a platform game-file.
//
// This is the editor->loader bridge (PLATMOD step 4): it takes the world you
// actually painted in hmsc-int (loadEditorWorld = your saved world, else the
// fresh demo city), transcodes its map to the RJMP map container that already
// backs Compile (createHmscMapfile), and wraps that as the game-map stream of a
// platform game-file (writeGameFile). The stateless no-V8 loader (world_loader.zig)
// then renders THIS — your real map, not the hand-typed test fixture.
//
// Logic / skins streams + the asset vocabulary are empty for now (the map slice);
// they fill in as those bakes land. Emits the game-file as base64 on stdout, the
// same shape the round-trip fixtures use, so `rjit game play/shot` can capture it.

import { loadEditorWorld } from '../editorWorld';
import { createHmscMapfile } from '../packageMap';
import { bytesToBase64 } from '@reactjit/workspace';
import { writeGameFile } from '@reactjit/workspace/gamefile';

const state = loadEditorWorld();
const mapContainer = createHmscMapfile(state);

const file = writeGameFile({
  logic: { refs: [], data: new Uint8Array(0) },
  map: { refs: [], data: mapContainer },
  skins: { refs: [], data: new Uint8Array(0) },
  assets: [],
});

const emit = (globalThis as any).print ?? console.log;
emit(bytesToBase64(file));
