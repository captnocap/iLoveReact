import { useState, useCallback } from 'react';
import { C } from '../workspace.cls';
import { LoaderIsoView } from '../../hmsc-int/LoaderIsoView';
import type { PlacedBuildPiece } from '../../hmsc-int/game/build/placed';
import type { Armed } from '../../hmsc-int/buildArmed';
import type { BuildEditEvent } from '../../hmsc-int/game';

const EDITOR_GAME_FILE = 'zig-out/game/editor/main.gamefile';
const EDITOR_STORE_DIR = 'zig-out/game/contentstore';

// MINIMAL live authoring (req_2401 "put something on the map"): the new editor
// mounted LoaderIsoView as a dead viewer (editable=false, no pieces, nothing
// armed). This turns the place flow ON by handing it the three things it needs:
// a growing piece list, an armed catalog piece, and an onCommit door. LoaderIsoView's
// existing resolveAt→placeAt→set_live_pieces path then drops the piece and renders
// it live with no rebake — click empty ground and a floor appears.
//
// This is the FAST path on shipped machinery (JS holds the pieces, the TS
// GAME_BUILD.placed does the placement math). The un-laundered version — the
// framework owning the piece list, build.zig doing the placement, the host
// rendering + picking (req_2349 is the ported brain) — is the next step now that
// there is finally something on the map for it to own.
//
// MAPPAINT req_2484: the viewport is CLEAN — the Map Paint chrome lives in the
// workspace action bar (ToolOptions → MapPaintBar; state in AppFrame's
// EditorState.mapPaint, host mirroring in stage/mapPaint.ts). This surface only
// arms/disarms the native paint input via LoaderIsoView's paintMode door; the
// brush beam is the only in-world chrome.
export default function WorldEditorSurface(props: { paintActive: boolean }) {
  const [pieces, setPieces] = useState<PlacedBuildPiece[]>([]);
  // Armed with a floor for now (no palette yet) — every click drops one so the
  // place→live-render loop is visible. A build-piece palette arms this next.
  const [armed, setArmed] = useState<Armed>({ kind: 'piece', id: 'floor.concrete.common' });

  const onCommit = useCallback((event: BuildEditEvent, _label: string) => {
    if (event.kind === 'piecePlaced') {
      setPieces((prev) => [...prev, { ...event.placement, id: `bp_${prev.length}` } as PlacedBuildPiece]);
    }
  }, []);

  return (
    <C.HW_WorldEditorSurface>
      <LoaderIsoView
        gameFile={EDITOR_GAME_FILE}
        storeDir={EDITOR_STORE_DIR}
        centerX={0}
        centerZ={0}
        pieces={pieces}
        armed={armed}
        onArm={setArmed}
        onCommit={onCommit}
        baselineReady
        paintMode={props.paintActive}
      />
    </C.HW_WorldEditorSurface>
  );
}
