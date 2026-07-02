import { useState, useCallback, useEffect } from 'react';
import { C } from '../workspace.cls';
import { LoaderIsoView } from '../../hmsc-int/LoaderIsoView';
import type { PlacedBuildPiece } from '../../hmsc-int/game/build/placed';
import type { Armed } from '../../hmsc-int/buildArmed';
import type { BuildEditEvent } from '../../hmsc-int/game';
import {
  mapChunkCount, mapGrowChunk, mapHostLive, mapSetGroundLook, mapSetTool, mapSetZonePalette,
  mapRoadCancel, mapRoadCommit, mapRoadSetKinds, mapRoadSetProfile,
} from '../../../runtime/game/map';
import MapPaintDock, { DEFAULT_MAP_PAINT, type MapPaintState, type MapZoneDef } from './MapPaintDock';
import { EDITOR_GROUND_FORMULA, TILE_KIND_PALETTE, FLORA_KIND_PALETTE, zonePaletteOf } from '../render3d/groundFormula';
import { FLORA_KIND_DEFINITIONS, FLORA_LANE_INDEX, ZONE_COLORS } from '../world/floraKinds';
import { TILE_KINDS } from '../world/tileKinds';

const EDITOR_GAME_FILE = 'zig-out/game/editor/main.gamefile';
const EDITOR_STORE_DIR = 'zig-out/game/contentstore';

// RoadCellKind → this cart's TILE_KINDS indices, in the host enum order
// (laneNorth, laneSouth, laneEast, laneWest, median, sidewalk, junction,
// crosswalk). The grammar is content-free; this is where the content binds.
const ROAD_KIND_INDICES = (['laneNorth', 'laneSouth', 'laneEast', 'laneWest', 'median', 'sidewalk', 'junction', 'crosswalk'] as const)
  .map((k) => TILE_KINDS.indexOf(k));

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
// Push the dock's state into the host map painter as the ONE armed tool
// (MAPPAINT req_2473). The dock's height dial + RAISE/DIG toggle collapse into
// the engine's signed centerZ; rampMin/rampMax feed both the ramp and the slope.
function pushMapTool(s: MapPaintState): void {
  const flora = FLORA_KIND_DEFINITIONS[s.floraKindIdx];
  mapRoadSetProfile({ lanesF: s.roadLanesF, lanesB: s.roadLanesB, sidewalks: s.roadSidewalks });
  mapSetTool({
    channel: s.channel,
    mode: s.mode,
    terrainTool: s.terrainTool,
    shape: s.shape,
    profile: s.profile,
    radiusM: s.radiusM,
    centerZ: s.raise ? s.heightM : -s.heightM,
    rampMin: s.rampMin,
    rampMax: s.rampMax,
    rampWide: s.rampWide,
    smoothStrength: s.smoothStrength,
    kindIdx: s.tileKindIdx,
    floraKindIdx: s.floraKindIdx,
    floraLane: flora ? FLORA_LANE_INDEX[flora.lane] : 0,
    zoneIdx: s.zones.length ? Math.min(s.zoneIdx, s.zones.length - 1) : -1,
  });
}

export default function WorldEditorSurface() {
  const [pieces, setPieces] = useState<PlacedBuildPiece[]>([]);
  // Armed with a floor for now (no palette yet) — every click drops one so the
  // place→live-render loop is visible. A build-piece palette arms this next.
  const [armed, setArmed] = useState<Armed>({ kind: 'piece', id: 'floor.concrete.common' });
  // MAPPAINT req_2473: the Map Paint tool state — React owns only this chrome
  // mirror; strokes/stamps/render/colliders are host-side (framework/game/map).
  const [paint, setPaint] = useState<MapPaintState>(DEFAULT_MAP_PAINT);

  const onCommit = useCallback((event: BuildEditEvent, _label: string) => {
    if (event.kind === 'piecePlaced') {
      setPieces((prev) => [...prev, { ...event.placement, id: `bp_${prev.length}` } as PlacedBuildPiece]);
    }
  }, []);

  const onPaintPatch = useCallback((patch: Partial<MapPaintState>) => {
    setPaint((prev) => {
      const next = { ...prev, ...patch };
      pushMapTool(next);
      return next;
    });
  }, []);

  // Adding a zone: cart owns the def list (names/colors); the host stores only
  // per-cell indices. Every list change re-pushes the zone palette so the
  // overlay tints track it.
  const onAddZone = useCallback(() => {
    setPaint((prev) => {
      const zone: MapZoneDef = {
        id: `z_${prev.zones.length + 1}`,
        name: `Zone ${prev.zones.length + 1}`,
        color: ZONE_COLORS[prev.zones.length % ZONE_COLORS.length]!,
      };
      const next = { ...prev, zones: [...prev.zones, zone], zoneIdx: prev.zones.length, mode: 'paint' as const };
      mapSetZonePalette(zonePaletteOf(next.zones));
      pushMapTool(next);
      return next;
    });
  }, []);

  // Roads: clicks in the viewport lay draft points host-side; COMMIT compiles
  // lanes/junctions/crosswalks into the tile grid (with the undercoat), CANCEL
  // drops the draft. The onPatch({}) nudge re-renders the dock's stats readout.
  const onRoadCommit = useCallback(() => {
    mapRoadCommit();
    onPaintPatch({});
  }, [onPaintPatch]);
  const onRoadCancel = useCallback(() => {
    mapRoadCancel();
    onPaintPatch({});
  }, [onPaintPatch]);

  // First arm seeds the world's chunk (0,0) so strokes have canvas — the grown
  // chunk grid gets its own chrome with the multi-chunk workspace — and pushes
  // the cell channels' ground look (formula + palettes) + road kind mapping once.
  useEffect(() => {
    if (!paint.active || !mapHostLive()) return;
    if (mapChunkCount() === 0) mapGrowChunk(0, 0);
    mapSetGroundLook(EDITOR_GROUND_FORMULA, TILE_KIND_PALETTE, FLORA_KIND_PALETTE, zonePaletteOf(paint.zones));
    mapRoadSetKinds(ROAD_KIND_INDICES);
    pushMapTool(paint);
  }, [paint.active]);

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
        paintMode={paint.active}
      />
      <MapPaintDock state={paint} onPatch={onPaintPatch} onAddZone={onAddZone} onRoadCommit={onRoadCommit} onRoadCancel={onRoadCancel} />
    </C.HW_WorldEditorSurface>
  );
}
