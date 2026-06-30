import { C } from '../workspace.cls';
import { LoaderIsoView } from '../../hmsc-int/LoaderIsoView';

const EDITOR_GAME_FILE = 'zig-out/game/editor/main.gamefile';
const EDITOR_STORE_DIR = 'zig-out/game/contentstore';

export default function WorldEditorSurface() {
  return (
    <C.HW_WorldEditorSurface>
      <LoaderIsoView
        gameFile={EDITOR_GAME_FILE}
        storeDir={EDITOR_STORE_DIR}
        centerX={0}
        centerZ={0}
      />
    </C.HW_WorldEditorSurface>
  );
}
