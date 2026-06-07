// packPackage.ts — helper bundled by `rjit pack hmsc`.

import { createInitialGameState } from '../../hmsc/state/gameState';
import { bytesToBase64 } from '@reactjit/workspace';
import { createHmscMapfile, hmscManifest } from '../packageMap';

const state = createInitialGameState();
console.log(JSON.stringify({
  manifest: hmscManifest(),
  mapBase64: bytesToBase64(createHmscMapfile(state)),
}));
