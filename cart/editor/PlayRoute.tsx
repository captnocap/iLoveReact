// editor/PlayRoute.tsx — the /play route.
//
// Verbatim the existing /compiled route: it mounts the host-native no-JS world
// loader (the `WorldLoader` primitive, handled by framework world_loader.zig /
// v8_bindings_compiled_world.zig) pointed at the compiled game-file. Nothing
// changes vs /compiled — edit on /editor, Compile, jump here and play.
//
// `WorldLoader` is a host primitive (not a component), so it's invoked via
// createElement with the gameFile/storeDir + an explicit fill style — the one
// place an inline style is warranted (a leaf host primitive needs its own size,
// exactly as the original CompiledWorld did).
import { createElement } from 'react';

const DEFAULT_GAME_FILE = 'zig-out/game/hmsc.gamefile';
const DEFAULT_STORE_DIR = 'zig-out/game/contentstore';

export default function PlayRoute() {
  return createElement('WorldLoader', {
    gameFile: DEFAULT_GAME_FILE,
    storeDir: DEFAULT_STORE_DIR,
    testID: 'play-world-loader',
    style: { width: '100%', height: '100%', backgroundColor: '#0d141f' },
  });
}
