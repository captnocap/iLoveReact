import { memo, useMemo } from 'react';
import { Scene3D, StaticSurface } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import type { BoxFace } from '@reactjit/geometries';
import type { Building, BuildingSkin, PerceptionState } from '../design';
import {
  buildingExteriorFaces,
  buildingFootprint,
  buildingTopMeters,
  resolveFaceSkin,
  resolveTopSkin,
} from '../world/buildings';
import {
  buildingSkinFacade,
  skinCapturePx,
  skinGridCols,
  skinGridFloors,
  skinTextureKey,
} from './buildingSkins';
import { isOpenBuildingKind } from '../world/buildingKinds';

// Building facades: a thin textured panel laid flat on each wall face (and the
// roof), sampling that face's skin texture (the billboard_demo / tileSurface
// pattern). The structural wall box (Building.tsx) stays solid for physics; this
// is the decorative skin over it. Skin is resolved PER FACE (front/back/left/
// right/top), so a warehouse can wear its garage on the front and plain walls on
// the sides. A hollow building's door side is left unskinned so the doorway
// reads; 'plain' faces get no panel (the bare wall color shows).

const PANEL_NUDGE_METERS = 0.06; // off the wall to avoid z-fighting
const PANEL_THICKNESS = 0.05;

type FaceBucket = { skin: BuildingSkin; cols: number; floors: number };

// Every skinned panel a building contributes: one per non-plain wall face plus a
// roof panel when a top skin is set. Each yields the mesh transform and the
// texture bucket it samples. The single source the panels and the captures share.
type Panel = { key: string; bucket: FaceBucket; scale: [number, number, number]; position: [number, number, number]; texturedFaces: BoxFace[] };

function buildingPanels(building: Building): Panel[] {
  const out: Panel[] = [];
  // Open structures draw their own model (no box walls) — no facade panels.
  if (isOpenBuildingKind(building.kind)) return out;
  for (const face of buildingExteriorFaces(building)) {
    if (building.enclosure === 'hollow' && face.side === building.doorSide) continue;
    const skin = resolveFaceSkin(building, face.side);
    if (skin === 'plain') continue;
    const bucket: FaceBucket = { skin, cols: skinGridCols(face.widthMeters), floors: skinGridFloors(face.heightMeters) };
    out.push({
      key: face.side,
      bucket,
      scale: face.horizontal
        ? [face.widthMeters, face.heightMeters, PANEL_THICKNESS]
        : [PANEL_THICKNESS, face.heightMeters, face.widthMeters],
      // Only the two broad faces of the thin panel carry the skin; the thin
      // edges pin to the corner texel. Broad faces are front/back for a
      // horizontal wall, left/right for a vertical one.
      texturedFaces: face.horizontal ? ['front', 'back'] : ['left', 'right'],
      position: [
        face.centerX + face.outwardX * PANEL_NUDGE_METERS,
        building.y + face.heightMeters / 2,
        face.centerZ + face.outwardZ * PANEL_NUDGE_METERS,
      ],
    });
  }
  const topSkin = resolveTopSkin(building);
  if (topSkin !== 'plain') {
    const f = buildingFootprint(building);
    const spanX = f.maxX - f.minX;
    const spanZ = f.maxZ - f.minZ;
    out.push({
      key: 'top',
      bucket: { skin: topSkin, cols: skinGridCols(spanX), floors: skinGridFloors(spanZ) },
      scale: [spanX, PANEL_THICKNESS, spanZ],
      texturedFaces: ['top'],
      position: [(f.minX + f.maxX) / 2, buildingTopMeters(building) + PANEL_NUDGE_METERS, (f.minZ + f.maxZ) / 2],
    });
  }
  return out;
}

const BuildingFacadePanels = memo(function BuildingFacadePanels(props: { building: Building }) {
  return (
    <>
      {buildingPanels(props.building).map((panel) => (
        <Scene3D.Mesh
          key={panel.key}
          geometry={Geometry.Box}
          params={{ width: 1, height: 1, depth: 1, texturedFaces: panel.texturedFaces }}
          scale={panel.scale}
          material="#ffffff"
          textureKey={skinTextureKey(panel.bucket.skin, panel.bucket.cols, panel.bucket.floors)}
          position={panel.position}
        />
      ))}
    </>
  );
});

// All buildings' facade panels. Memoized on the buildings list so it only
// re-renders when buildings change, not every player/camera frame.
export const BuildingFacades = memo(function BuildingFacades(props: { buildings: Building[] }) {
  return (
    <>
      {props.buildings.map((building) => (
        <BuildingFacadePanels key={building.id} building={building} />
      ))}
    </>
  );
});

// One skin texture: the facade for a (skin, cols, floors) bucket captured once to
// a GPU texture every panel of that shape samples. Memoized exactly like
// tileSurface's RegionCapture so the heavy bake happens once and the cache holds
// across player/camera churn (the StaticSurface inline-prop rebake trap). The
// bake deps are [skin, cols, floors] only — the static catalog ignores
// `perception`, so a perception change must NOT re-bake these; when a reactive
// skin lands it adds a perception bucket to its own key.
const FacadeCapture = memo(function FacadeCapture(props: {
  skin: BuildingSkin;
  cols: number;
  floors: number;
  perception: PerceptionState;
}) {
  const facade = buildingSkinFacade(props.skin);
  const w = skinCapturePx(props.cols);
  const h = skinCapturePx(props.floors);
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: w, height: h }),
    [w, h],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- perception intentionally
  // excluded: the static catalog does not read it, so it must not trigger a re-bake.
  const content = useMemo(
    () => (facade
      ? facade({
          skin: props.skin,
          cols: props.cols,
          floors: props.floors,
          widthMeters: props.cols * 3,
          heightMeters: props.floors * 3,
          perception: props.perception,
        })
      : null),
    [props.skin, props.cols, props.floors],
  );
  if (!facade) return null;
  return (
    <StaticSurface staticKey={skinTextureKey(props.skin, props.cols, props.floors)} style={surfaceStyle}>
      {content}
    </StaticSurface>
  );
});

// Offscreen captures for every distinct (skin, cols, floors) bucket across the
// world's buildings' panels. Mount as a 2D sibling of <Scene3D> in the rig, like
// TileSurfaceCaptures. One texture is shared by every panel of the same shape.
export const BuildingSurfaceCaptures = memo(function BuildingSurfaceCaptures(props: {
  buildings: Building[];
  perception: PerceptionState;
}) {
  const buckets = useMemo(() => {
    const map = new Map<string, FaceBucket>();
    for (const building of props.buildings) {
      for (const panel of buildingPanels(building)) {
        const key = skinTextureKey(panel.bucket.skin, panel.bucket.cols, panel.bucket.floors);
        if (!map.has(key)) map.set(key, panel.bucket);
      }
    }
    return Array.from(map.values());
  }, [props.buildings]);

  return (
    <>
      {buckets.map((bucket) => (
        <FacadeCapture
          key={skinTextureKey(bucket.skin, bucket.cols, bucket.floors)}
          skin={bucket.skin}
          cols={bucket.cols}
          floors={bucket.floors}
          perception={props.perception}
        />
      ))}
    </>
  );
});
