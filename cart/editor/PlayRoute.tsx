// editor/PlayRoute.tsx — the /play route.
//
// WorldLoader remains the authoritative native game renderer. The dynamic editor
// route composes retained document channels over it so the Gigwork wall, personal
// phone, and identity readout can be exercised together before their dictionaries
// are baked into the no-JS ship lump.
import CriminalCareersPlay from './play/CriminalCareersPlay';

const DEFAULT_GAME_FILE = 'zig-out/game/hmsc.gamefile';
const DEFAULT_STORE_DIR = 'zig-out/game/contentstore';

export default function PlayRoute() {
  return <CriminalCareersPlay gameFile={DEFAULT_GAME_FILE} storeDir={DEFAULT_STORE_DIR} />;
}
