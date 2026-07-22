import { useMemo, useRef } from 'react';
import { C } from '../workspace.cls';
import WorldViewport from '../world/WorldViewport';
import { worldToolFor } from '../world/worldTool';
import { retainPieceSequence, visibleStoreyPieces, type ArmedPiece, type PlacedPiece, type PlacementGesture } from '../world/pieces';
import type { AuthoredBuildPiece } from '../world/authoredRegistry';
import type { MapPaintState, MapZoneDef } from './mapPaint';
import type { PieceMaterialTarget } from '../world/pieceEditCommand';
import type { PieceSelectionIntent } from '../world/selection';
import type { WorldPrefab } from '../world/prefabs';
import type { AuthoredFloraSpecies } from '../world/floraSpecies';
import type { FloraPaintSample, WorldFloraBrush, WorldFloraPatch } from '../world/surfaceFlora';

// BLANKBOOT req_2490: the editor's world file is ITS OWN, fresh path — the old
// main.gamefile is the condemned hmsc sandbox bake ("farts and dicks", ruled
// irrelevant) and mounting it clashed with the painted canvas. No file here yet
// ⇒ the loader boots a BLANK world (paint-first); the new compile lane writes
// this path when it lands.
// Exported: the playtest tab (GLOBALS req_2770) mounts the SAME world file so
// what you walk is what you authored.
export const EDITOR_GAME_FILE = 'zig-out/game/editor/world.gamefile';
export const EDITOR_STORE_DIR = 'zig-out/game/contentstore';

// The world document's surface: the editor's thin viewport over host doors.
// React owns only the placed-piece list + the armed palette entry;
// rendering, camera application, picking, validation, map painting, and
// colliders are host-side.
//
// Armed with a floor for now (the build-piece palette arms this next) — every
// click drops one so the place→live-render loop is visible. The active FLOOR
// comes from the action bar's one real floor control (req_2485).
export default function WorldEditorSurface(props: {
  mapOverviewOpen: boolean;
  onToggleMap: () => void;
  paintActive: boolean;
  mapPaint: MapPaintState;
  mapStem: string;
  mapZones: readonly MapZoneDef[];
  floor: number;
  wallsDown: boolean;
  activeCommandId: string;
  // req_2563 Phase 1: the world model is UNIFIED into EditorState now — the piece
  // list, the selected instance, and the armed palette piece all arrive as props
  // from AppFrame (was this component's own useState). Placements/picks report up.
  pieces: readonly PlacedPiece[];
  selectedIds: readonly string[];
  armedPieceId: string | null;
  armedYawDegrees: number;
  authoredPieces: readonly AuthoredBuildPiece[];
  prefabs: readonly WorldPrefab[];
  worldFlora: readonly WorldFloraPatch[];
  floraSpecies: readonly AuthoredFloraSpecies[];
  /** one gesture's placements: a click is a one-piece batch, a drag-run (req_2747) is the lot. */
  onPlace: (pieces: PlacedPiece[], gesture: PlacementGesture) => void;
  onMove: (id: string, destination: PlacedPiece) => void;
  onSelect: (id: string | null, intent: PieceSelectionIntent) => void;
  /** right-click hit a placed piece → open the quick context menu at window (x,y) (req_2733). */
  onPieceContext: (id: string, x: number, y: number, role: string | null) => void;
  /** Paint Faces (req_2879): one gesture's unique face targets for one material action. */
  onPaintFaces: (targets: readonly PieceMaterialTarget[]) => void;
  onStampSticker: (id: string, role: string, local: { lx: number; ly: number; lz: number; nx: number; ny: number; nz: number }) => void;
  onPaintFlora: (samples: readonly FloraPaintSample[], brush: WorldFloraBrush) => void;
}) {
  // The viewport is modal (req_2550): the armed command decides the click. The palette piece is
  // armed ONLY in Place mode, so Select/Move/Focus never drop a piece. The armed piece id is the
  // Build bar's pick (req_2563 Phase 2), defaulting to a concrete floor.
  const tool = props.paintActive ? 'select' : worldToolFor(props.activeCommandId);
  const armed: ArmedPiece = tool === 'place' && props.armedPieceId
    ? { pieceId: props.armedPieceId, yawDegrees: props.armedYawDegrees }
    : null;

  // Storey cutaway (req_2567): the viewport only ever sees the pieces the active
  // floor should show — everything ABOVE the storey is hidden (so editing Level 1
  // isn't buried under Level 2's slab), and walls-down additionally hides the
  // active floor's walls for interior/prop work. The FULL list stays here: it is
  // the authored world; placements append to it and floor changes re-derive the
  // view. Picking naturally can't hit hidden pieces (the viewport never gets them).
  const previousVisiblePieces = useRef<readonly PlacedPiece[]>([]);
  const visiblePieces = useMemo(() => {
    const next = visibleStoreyPieces(props.pieces, props.floor, props.wallsDown);
    const stable = retainPieceSequence(previousVisiblePieces.current, next);
    previousVisiblePieces.current = stable;
    return stable;
  }, [props.pieces, props.floor, props.wallsDown]);

  return (
    <C.HW_WorldEditorSurface>
      <WorldViewport
        mapOverviewOpen={props.mapOverviewOpen}
        onToggleMap={props.onToggleMap}
        gameFile={EDITOR_GAME_FILE}
        storeDir={EDITOR_STORE_DIR}
        pieces={visiblePieces}
        authoredPieces={props.authoredPieces}
        prefabs={props.prefabs}
        worldFlora={props.worldFlora}
        floraSpecies={props.floraSpecies}
        armed={armed}
        tool={tool}
        selectedIds={props.selectedIds}
        onSelect={props.onSelect}
        onPieceContext={props.onPieceContext}
        onPaintFaces={props.onPaintFaces}
        onStampSticker={props.onStampSticker}
        onPaintFlora={props.onPaintFlora}
        onPlace={props.onPlace}
        onMove={props.onMove}
        floor={props.floor}
        paintActive={props.paintActive}
        mapPaint={props.mapPaint}
        mapStem={props.mapStem}
        mapZones={props.mapZones}
      />
    </C.HW_WorldEditorSurface>
  );
}
