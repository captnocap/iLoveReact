import { useState, useCallback } from 'react';
import { C } from '../workspace.cls';
import WorldViewport from '../world/WorldViewport';
import type { ArmedPiece, PlacedPiece } from '../world/pieces';

// BLANKBOOT req_2490: the editor's world file is ITS OWN, fresh path — the old
// main.gamefile is the condemned hmsc sandbox bake ("farts and dicks", ruled
// irrelevant) and mounting it clashed with the painted canvas. No file here yet
// ⇒ the loader boots a BLANK world (paint-first); the new compile lane writes
// this path when it lands.
const EDITOR_GAME_FILE = 'zig-out/game/editor/world.gamefile';
const EDITOR_STORE_DIR = 'zig-out/game/contentstore';

// The world document's surface: the editor's OWN thin viewport over host doors
// (world/WorldViewport — req_2486 cut the LoaderIsoView cross-import; hmsc-int
// is dying). React owns only the placed-piece list + the armed palette entry;
// rendering, camera application, picking, validation, map painting, and
// colliders are host-side.
//
// Armed with a floor for now (the build-piece palette arms this next) — every
// click drops one so the place→live-render loop is visible. The active FLOOR
// comes from the action bar's one real floor control (req_2485).
export default function WorldEditorSurface(props: { paintActive: boolean; floor: number }) {
  const [pieces, setPieces] = useState<PlacedPiece[]>([]);
  const [armed] = useState<ArmedPiece>({ pieceId: 'floor.concrete.common' });

  const onPlace = useCallback((piece: PlacedPiece) => {
    setPieces((prev) => [...prev, { ...piece, id: `bp_${prev.length}` }]);
  }, []);

  return (
    <C.HW_WorldEditorSurface>
      <WorldViewport
        gameFile={EDITOR_GAME_FILE}
        storeDir={EDITOR_STORE_DIR}
        pieces={pieces}
        armed={armed}
        onPlace={onPlace}
        floor={props.floor}
        paintActive={props.paintActive}
      />
    </C.HW_WorldEditorSurface>
  );
}
