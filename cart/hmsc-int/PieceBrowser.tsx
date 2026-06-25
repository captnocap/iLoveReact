// PieceBrowser — the BUILD section's picture browser (req_1918). The build menu
// was a wall of identical text pills ("get away from this dogshit pilled
// approach"); this is the prop browser's treatment turned around onto build
// pieces: framed 3D thumbnails, a page sized to fill the rail (no scroll), one
// shared vocabulary (railThumbGrid) so a wall and a bench look + page the same.
//
// One tab's entries at a time (the build-tab row stays in CatalogRail). Three
// entry shapes render through the SAME PlacedPieceMeshes path the iso map uses:
//   • a catalog PIECE (floor/wall/ramp/roof/stairs/elevator/pillar) → one placed
//     piece via placementFor, framed by its own visual bounds;
//   • a PREFAB → stamped to its pieces, recentred on its envelope;
//   • WATER → the preset's tinted surface slab (environmental, not a mesh).

import { useMemo } from 'react';
import { Box, Scene3D, Text } from '@reactjit/primitives';
import { GAME_BUILD } from './game';
import type { BuildPrefabDef, PlacedBuildPiece } from './game';
import type { TileKind } from './design';
import { tileKindDefinition } from './world/tileKinds';
import { waterBodyPreset } from './game/kinds/waterBodies';
import { ModelScene } from './ModelViewer';
import {
  RailPager, ThumbTile, useFittedGrid, solveThumbOrbit, solveThumbOrbitForBounds,
  thumbCellH, type GridBounds,
} from './railThumbGrid';

const TILE_W = 92;
const TILE_H = 84;

export type PieceArmKind = 'piece' | 'prefab' | 'water';

type ThumbScene = { node: any; cam: ReturnType<typeof solveThumbOrbit> } | null;

// Build the renderable scene + framing camera for one build entry. Pure, keyed
// by (kind,id) so a tile costs nothing on re-page.
function buildThumbScene(armKind: PieceArmKind, id: string, prefabDef?: BuildPrefabDef): ThumbScene {
  try {
    if (armKind === 'water') {
      const preset = waterBodyPreset(id);
      const h = Math.max(0.3, preset?.surfaceY ?? 1.2);
      // Water is a surface, not a mesh — show the tinted slab the tile path draws.
      return {
        node: <ModelScene tile={'water' as TileKind} />,
        cam: solveThumbOrbit(0, h * 0.5, 0, 8, h, 8),
      };
    }
    if (armKind === 'prefab') {
      const def = prefabDef ?? GAME_BUILD.prefabs.get(id);
      if (!def) return null;
      const pieces = GAME_BUILD.placed.stamp(def, { x: 0, y: 0, z: 0 }, 0);
      if (!pieces.length) return null;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pieces) {
        const b = GAME_BUILD.placed.bounds(p);
        minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
        minZ = Math.min(minZ, b.minZ); maxZ = Math.max(maxZ, b.maxZ);
        minY = Math.min(minY, b.baseY); maxY = Math.max(maxY, b.topY);
      }
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      // Recentre so the orbit pivots on the composition (the iso lift preserves
      // relative placement → wall joins still resolve).
      const centred = pieces.map((p) => ({ ...p, x: p.x - cx, z: p.z - cz }));
      const bounds: GridBounds = { minX: minX - cx, maxX: maxX - cx, minY, maxY, minZ: minZ - cz, maxZ: maxZ - cz };
      return { node: <ModelScene pieces={centred} />, cam: solveThumbOrbitForBounds(bounds) };
    }
    // A single catalog piece, authored exactly as a click would place it.
    const def = GAME_BUILD.catalog.get(id);
    if (!def) return null;
    const piece: PlacedBuildPiece = { ...GAME_BUILD.placed.placementFor(def, { x: 0, y: 0, z: 0, yawDegrees: 0 }), id: `thumb-${id}` };
    const b = GAME_BUILD.placed.visualBounds(piece);
    const bounds: GridBounds = { minX: b.minX, maxX: b.maxX, minY: b.baseY, maxY: b.topY, minZ: b.minZ, maxZ: b.maxZ };
    return { node: <ModelScene pieces={[piece]} />, cam: solveThumbOrbitForBounds(bounds) };
  } catch { return null; }
}

function PieceThumb(props: { id: string; label: string; armKind: PieceArmKind; prefabDef?: BuildPrefabDef; active: boolean; onPick: () => void }) {
  const scene = useMemo(() => buildThumbScene(props.armKind, props.id, props.prefabDef), [props.armKind, props.id, props.prefabDef]);
  return (
    <ThumbTile label={props.label} active={props.active} tileW={TILE_W} tileH={TILE_H} onPick={props.onPick}>
      {scene ? (
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0e1622" showGrid={false} showAxes={false}>
          <Scene3D.Camera position={scene.cam.pos} target={scene.cam.target} fov={scene.cam.fov} />
          {scene.node}
        </Scene3D>
      ) : null}
    </ThumbTile>
  );
}

export function PieceBrowser(props: {
  entries: readonly { id: string; label: string }[];
  armKind: PieceArmKind;
  armedId: string | null;
  prefabs?: readonly BuildPrefabDef[];
  onArm: (id: string) => void;
}) {
  const prefabById = useMemo(
    () => new Map((props.prefabs ?? []).map((d) => [d.id, d])),
    [props.prefabs],
  );
  const grid = useFittedGrid({ total: props.entries.length, tileW: TILE_W, cellH: thumbCellH(TILE_H) });
  const pageItems = props.entries.slice(grid.start, grid.end);

  return (
    <>
      <Box style={grid.containerStyle} onLayout={(rect: any) => grid.onLayout(rect)}>
        <Box style={grid.rowStyle}>
          {pageItems.map((e) => (
            <PieceThumb
              key={e.id}
              id={e.id}
              label={e.label}
              armKind={props.armKind}
              prefabDef={prefabById.get(e.id)}
              active={props.armedId === e.id}
              onPick={() => props.onArm(e.id)}
            />
          ))}
          {props.entries.length === 0 ? (
            <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace', paddingTop: 6 }}>nothing in this tab</Text>
          ) : null}
        </Box>
      </Box>
      <RailPager pageCount={grid.pageCount} cur={grid.cur} setPage={grid.setPage} />
    </>
  );
}
