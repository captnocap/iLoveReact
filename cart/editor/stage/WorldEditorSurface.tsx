import { useMemo, useRef } from 'react';
import { EDITOR_DATA_ROOT } from '../data/editorDataRoot';
import { C } from '../workspace.cls';
import WorldViewport from '../world/WorldViewport';
import type { WorldView } from '../world/worldViews';
import { worldToolFor } from '../world/worldTool';
import { retainPieceSequence, visibleStoreyPieces, type ArmedPiece, type PlacedPiece, type PlacementGesture } from '../world/pieces';
import type { AuthoredBuildPiece } from '../world/authoredRegistry';
import type { MapPaintState, MapZoneDef } from './mapPaint';
import type { PieceMaterialTarget } from '../world/pieceEditCommand';
import type { PieceSelectionIntent } from '../world/selection';
import type { WorldPrefab } from '../world/prefabs';
import type { AuthoredFloraSpecies } from '../world/floraSpecies';
import type { FloraPaintSample, WorldFloraBrush, WorldFloraPatch } from '../world/surfaceFlora';
import type { ArchitectureSelection, ArchitectureSource } from '../world/architecture';
import type { WallDrawCommit } from '../world/wallTools';

// BLANKBOOT req_2490: the editor's world file is ITS OWN, fresh path — the old
// main.gamefile is the condemned hmsc sandbox bake ("farts and dicks", ruled
// irrelevant) and mounting it clashed with the painted canvas. No file here yet
// ⇒ the loader boots a BLANK world (paint-first); the new compile lane writes
// this path when it lands.
// Exported: the playtest tab (GLOBALS req_2770) mounts the SAME world file so
// what you walk is what you authored.
export const EDITOR_GAME_FILE = `${EDITOR_DATA_ROOT}/world.gamefile`;
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
  active: boolean;
  interactionLocked: boolean;
  mapOverviewOpen: boolean;
  onToggleMap: () => void;
  paintActive: boolean;
  mapPaint: MapPaintState;
  mapStem: string;
  mapZones: readonly MapZoneDef[];
  floor: number;
  /** Saved-view recall request (req_4168) — the pin's whole pose, plus the nonce
   *  that lets the SAME pin be recalled twice. */
  viewRecall: { view: WorldView; nonce: number } | null;
  /** Saved views drawn as jump pins on the minimap. */
  views: readonly WorldView[];
  onRecallView: (id: string) => void;
  wallsDown: boolean;
  activeCommandId: string;
  // req_2563 Phase 1: the world model is UNIFIED into EditorState now — the piece
  // list, the selected instance, and the armed palette piece all arrive as props
  // from AppFrame (was this component's own useState). Placements/picks report up.
  pieces: readonly PlacedPiece[];
  selectedIds: readonly string[];
  /** The outliner-selected painted-flora patch (req_4737) — drawn as a ground
   *  ring in the same cyan selection vocabulary as pieces and walls. */
  selectedFloraPatchId: string | null;
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
  /** Semantic wall source + one committed draw span (req_4473). */
  architecture: ArchitectureSource;
  /** Returns engine acceptance — a reject keeps the anchor put (req_4479). */
  onDrawWall: (commit: WallDrawCommit) => boolean;
  /** The measured style's default measurements — the wall gizmo's seed (req_4479). */
  wallDefaults: { heightU: number; thicknessU: number } | null;
  /** Wall selection (req_4480): the selected record + the Select-click report. */
  architectureSelection: ArchitectureSelection;
  onSelectWall: (hit: { edgeId: string; side: 'a' | 'b' }) => void;
  /** Place Door/Window (req_4513): the palette-armed kit + its verbs. */
  openingKit: import('../world/openingTools').OpeningKitArm | null;
  onCutOpening: (hit: { edgeId: string; side: 'a' | 'b'; slot: import('../world/architecture').WallCell }) => boolean;
  onSelectOpening: (hit: { edgeId: string; openingId: string }) => void;
  openingFootprints: Readonly<Record<string, import('../world/architecture').ArchitectureFootprint>>;
  openingDepthsU: Readonly<Record<string, number>>;
  /** Opening-kit resident adapters (req_4526) — mounted doors + the armed mesh ghost. */
  openingKitPieces: readonly import('../world/authoredRegistry').AuthoredBuildPiece[];
}) {
  // The viewport is modal (req_2550): the armed command decides the click. The palette piece is
  // armed ONLY in Place mode, so Select/Move/Focus never drop a piece. The armed piece id is the
  // Build bar's pick (req_2563 Phase 2), defaulting to a concrete floor.
  const tool = props.interactionLocked || props.paintActive ? 'select' : worldToolFor(props.activeCommandId);
  const armed: ArmedPiece = !props.interactionLocked && tool === 'place' && props.armedPieceId
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
    <C.HW_WorldEditorSurface style={{ display: props.active ? 'flex' : 'none' }}>
      <WorldViewport
        active={props.active}
        interactionLocked={props.interactionLocked}
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
        selectedFloraPatch={props.worldFlora.find((patch) => patch.id === props.selectedFloraPatchId) ?? null}
        onSelect={props.onSelect}
        onPieceContext={props.onPieceContext}
        onPaintFaces={props.onPaintFaces}
        onStampSticker={props.onStampSticker}
        onPaintFlora={props.onPaintFlora}
        onPlace={props.onPlace}
        onMove={props.onMove}
        architecture={props.architecture}
        onDrawWall={props.onDrawWall}
        wallDefaults={props.wallDefaults}
        architectureSelection={props.architectureSelection}
        onSelectWall={props.onSelectWall}
        openingKit={props.openingKit}
        onCutOpening={props.onCutOpening}
        onSelectOpening={props.onSelectOpening}
        openingFootprints={props.openingFootprints}
        openingDepthsU={props.openingDepthsU}
        openingKitPieces={props.openingKitPieces}
        floor={props.floor}
        viewRecall={props.viewRecall}
        views={props.views}
        onRecallView={props.onRecallView}
        paintActive={!props.interactionLocked && props.paintActive}
        mapPaint={props.mapPaint}
        mapStem={props.mapStem}
        mapZones={props.mapZones}
      />
    </C.HW_WorldEditorSurface>
  );
}
