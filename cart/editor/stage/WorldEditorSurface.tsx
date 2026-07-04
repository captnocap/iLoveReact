import { useMemo, useState, useCallback } from 'react';
import { C } from '../workspace.cls';
import WorldViewport from '../world/WorldViewport';
import { worldToolFor } from '../world/worldTool';
import { visibleStoreyPieces, type ArmedPiece, type PlacedPiece } from '../world/pieces';

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
export default function WorldEditorSurface(props: { paintActive: boolean; floor: number; wallsDown: boolean; activeCommandId: string }) {
  const [pieces, setPieces] = useState<PlacedPiece[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The viewport is modal (req_2550): the armed command decides the click. The palette piece is
  // armed ONLY in Place mode, so Select/Move/Focus never drop a piece — the always-armed floor
  // that placed on every click is gone. (Palette-driven arming is a separate wiring; a floor is
  // the placeholder Place piece for now.)
  const tool = worldToolFor(props.activeCommandId);
  const armed: ArmedPiece = tool === 'place' ? { pieceId: 'floor.concrete.common' } : null;

  const onPlace = useCallback((piece: PlacedPiece) => {
    setPieces((prev) => [...prev, { ...piece, id: `bp_${prev.length}` }]);
  }, []);

  // Storey cutaway (req_2567): the viewport only ever sees the pieces the active
  // floor should show — everything ABOVE the storey is hidden (so editing Level 1
  // isn't buried under Level 2's slab), and walls-down additionally hides the
  // active floor's walls for interior/prop work. The FULL list stays here: it is
  // the authored world; placements append to it and floor changes re-derive the
  // view. Picking naturally can't hit hidden pieces (the viewport never gets them).
  const visiblePieces = useMemo(
    () => visibleStoreyPieces(pieces, props.floor, props.wallsDown),
    [pieces, props.floor, props.wallsDown],
  );

  return (
    <C.HW_WorldEditorSurface>
      <WorldViewport
        gameFile={EDITOR_GAME_FILE}
        storeDir={EDITOR_STORE_DIR}
        pieces={visiblePieces}
        armed={armed}
        tool={tool}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onPlace={onPlace}
        floor={props.floor}
        paintActive={props.paintActive}
      />
    </C.HW_WorldEditorSurface>
  );
}
