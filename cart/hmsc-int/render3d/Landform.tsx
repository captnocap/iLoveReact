import { Fragment, memo, useMemo, useRef } from 'react';
import { Effect, Scene3D, StaticSurface } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { Landform as LandformData } from '../design';
import { landformHeightfield, landformRoadCenterline, landformRoadHalfWidth, mountainCraterLake } from '../world/landforms';
import { LANDFORM_FILL_SHADER, landformCaptureDimension, landformFillData, landformTextureKey } from './landformFill';
import { HEIGHTFIELD_TILE_BODY, HeightfieldSurfaceCaptures, heightfieldTextureKey, heightfieldTileData } from './heightfieldSurface';
import { WATER_FILL_SHADER, waterTextureKey } from './waterFill';
import {
  ROAD_RIBBON_CAPTURE_H,
  ROAD_RIBBON_CAPTURE_W,
  ROAD_RIBBON_DEF,
  ROAD_RIBBON_FILL_SHADER,
  roadRibbonFillData,
  roadRibbonTextureKey,
} from './roadRibbon';

// Generic landform renderer — ONE Heightfield mesh baked from the kind's height
// function (the same bake the collider uses), tiled by world-XZ with the surface
// tile material. One component for every landform kind; the kind def supplies the
// shape + surface tile. A kind that needs extra meshes on top (a crater lake, a
// road ribbon) registers a DECORATION keyed by kind below — the only place a kind
// name appears render-side, kept out of the JSX-free world registry.

const paramsKey = (lf: LandformData) =>
  `${lf.kind}|${lf.centerX}|${lf.centerZ}|${lf.baseY}|${JSON.stringify(lf.params)}`;

// --- Decorations: extra meshes a kind drapes over its surface (by kind) ---

// Thin water-skin slab thickness, and how far the plane oversizes the lake so its
// square corners tuck UNDER the higher crater walls (visible waterline = the round
// bowl edge).
const WATER_SLAB_THICKNESS_METERS = 0.15;
const WATER_PLANE_MARGIN_METERS = 4;

// The mountain's crater lake: a flat textured plane at the water level. The host
// still walks the player on the crater bed underneath; this is the visible water,
// and the 'water' wade footing comes from the kind's submergedAt (registry).
function CraterLake(props: { landform: LandformData }) {
  const lake = mountainCraterLake(props.landform);
  const side = lake.radius * 2 + WATER_PLANE_MARGIN_METERS;
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: 1, height: 1, depth: 1, texturedFaces: ['top'] }}
      scale={[side, WATER_SLAB_THICKNESS_METERS, side]}
      material="#ffffff"
      textureKey={waterTextureKey(props.landform.id)}
      position={[lake.centerX, lake.level - WATER_SLAB_THICKNESS_METERS / 2, lake.centerZ]}
    />
  );
}

// The estate's road: a strip mesh following the carved road bench, drape-textured
// with the real road cross-section (crisp lanes + double-yellow), instead of
// painting the road into the low-res terrain capture.
function EstateRoadRibbon(props: { landform: LandformData }) {
  const lf = props.landform;
  const roadParams = useMemo(
    () => ({ points: landformRoadCenterline(lf), halfWidth: landformRoadHalfWidth() }),
    [paramsKey(lf)],
  );
  return (
    <Scene3D.Mesh
      geometry={ROAD_RIBBON_DEF}
      params={roadParams}
      material="#ffffff"
      textureKey={roadRibbonTextureKey(lf.id)}
      position={[0, 0, 0]}
    />
  );
}

// The extra mesh a kind decorates its surface with. A kind not listed gets none.
const LANDFORM_DECORATIONS: Record<string, (lf: LandformData) => JSX.Element> = {
  mountain: (lf) => <CraterLake landform={lf} />,
  estate: (lf) => <EstateRoadRibbon landform={lf} />,
};

// A painted ('heightfield') landform carrying a tile grid drapes that paint over
// the relief as its texture (render3d/heightfieldSurface); every other kind uses
// the natural-blend surface fill (landformFill). One mesh, two texture sources.
function landformSurfaceTextureKey(lf: LandformData): string {
  return lf.field?.tiles ? heightfieldTextureKey(lf.id) : landformTextureKey(lf.id);
}

export const Landform = memo(function Landform(props: { landform: LandformData }) {
  const lf = props.landform;
  // Re-bake when the parametric shape (paramsKey) OR a painted field's height
  // samples change. paramsKey omits `field` (a painted landform has empty params),
  // so without the heights reference the mesh would keep a stale flat bake while
  // the LIVE field still repositioned anything placed on it — terrain that "won't
  // show up but moves the buildings". The editor hands a new heights array per
  // height edit (stable across tile-only edits), so this re-bakes exactly then.
  const field = useMemo(() => landformHeightfield(lf), [paramsKey(lf), lf.field?.heights]);
  // A painted landform is LIVE-EDITED in the editor preview — its verts change as
  // you brush. The static intern geometry cache fills with a new content key per
  // edit and the mesh vanishes (the same churn the editor's old ChunkFloorMesh hit),
  // so a field-backed landform takes the dynamic-geometry path: a STABLE per-landform
  // slot id + a version that bumps whenever the height samples change (the editor
  // hands a new heights array each height edit). Parametric landforms are static and
  // keep the intern path (no dynamicKey).
  const heightsRef = useRef(lf.field?.heights);
  const verRef = useRef(0);
  if (heightsRef.current !== lf.field?.heights) {
    heightsRef.current = lf.field?.heights;
    verRef.current += 1;
  }
  const dynamicKey = lf.field ? `landform_${lf.id}~${verRef.current}` : undefined;
  // Painted (tile-grid) fields run the ground FORMULA per fragment — crisp at any
  // zoom, no baked capture (the data-shape ground, GUIDING_LIGHT). Other landform
  // kinds keep the natural-blend surface capture. groundData is memoised on the
  // tile/road identity so the prop only re-crosses the bridge when the paint
  // actually changes (static_surface_inline_props_rebake discipline).
  const tiles = lf.field?.tiles;
  const roads = lf.field?.roads;
  const groundData = useMemo(() => (tiles ? heightfieldTileData(tiles, roads) : null), [tiles, roads]);
  return (
    <>
      <Scene3D.Mesh
        geometry={Geometry.Heightfield}
        params={{
          heights: field.heights,
          cols: field.cols,
          rows: field.rows,
          width: field.width,
          depth: field.depth,
          base: field.base,
        }}
        dynamicKey={dynamicKey}
        material="#ffffff"
        {...(groundData
          ? { groundFormula: HEIGHTFIELD_TILE_BODY, groundData }
          : { textureKey: landformSurfaceTextureKey(lf) })}
        position={[lf.centerX, lf.baseY, lf.centerZ]}
      />
      {LANDFORM_DECORATIONS[lf.kind]?.(lf)}
    </>
  );
});

// --- Offscreen surface + decoration captures (one set per landform) ---

const LandformCapture = memo(function LandformCapture(props: { landform: LandformData }) {
  const lf = props.landform;
  const px = landformCaptureDimension(lf);
  const data = useMemo(() => landformFillData(lf), [paramsKey(lf)]);
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: px, height: px }),
    [px],
  );
  const effectStyle = useMemo(() => ({ width: px, height: px }), [px]);
  return (
    <StaticSurface staticKey={landformTextureKey(lf.id)} style={surfaceStyle}>
      <Effect shader={LANDFORM_FILL_SHADER} data={data} style={effectStyle} />
    </StaticSurface>
  );
});

// The crater lake's calm-water texture (a small fixed capture; no shape inputs).
const WATER_CAPTURE_PX = 512;
const WaterCapture = memo(function WaterCapture(props: { landform: LandformData }) {
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: WATER_CAPTURE_PX, height: WATER_CAPTURE_PX }),
    [],
  );
  const effectStyle = useMemo(() => ({ width: WATER_CAPTURE_PX, height: WATER_CAPTURE_PX }), []);
  const data = useMemo(() => [0], []);
  return (
    <StaticSurface staticKey={waterTextureKey(props.landform.id)} style={surfaceStyle}>
      <Effect shader={WATER_FILL_SHADER} data={data} style={effectStyle} />
    </StaticSurface>
  );
});

// The road ribbon's dedicated cross-section texture (crisp across the lanes).
const RoadRibbonCapture = memo(function RoadRibbonCapture(props: { landform: LandformData }) {
  const data = useMemo(() => roadRibbonFillData(), []);
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: ROAD_RIBBON_CAPTURE_W, height: ROAD_RIBBON_CAPTURE_H }),
    [],
  );
  const effectStyle = useMemo(() => ({ width: ROAD_RIBBON_CAPTURE_W, height: ROAD_RIBBON_CAPTURE_H }), []);
  return (
    <StaticSurface staticKey={roadRibbonTextureKey(props.landform.id)} style={surfaceStyle}>
      <Effect shader={ROAD_RIBBON_FILL_SHADER} data={data} style={effectStyle} />
    </StaticSurface>
  );
});

// The capture(s) a kind's decoration needs, by kind (mirrors LANDFORM_DECORATIONS).
const LANDFORM_DECORATION_CAPTURES: Record<string, (lf: LandformData) => JSX.Element> = {
  mountain: (lf) => <WaterCapture landform={lf} />,
  estate: (lf) => <RoadRibbonCapture landform={lf} />,
};

export const LandformSurfaceCaptures = memo(function LandformSurfaceCaptures(props: { landforms: LandformData[] }) {
  return (
    <>
      {/* Natural-blend fill for parametric kinds; a painted (tile-grid) landform
          gets its texture from the tile capture below instead, so skip it here. */}
      {props.landforms.filter((lf) => !lf.field?.tiles).map((lf) => (
        <LandformCapture key={landformTextureKey(lf.id)} landform={lf} />
      ))}
      {/* Painted per-cell tile textures for the heightfield landforms. */}
      <HeightfieldSurfaceCaptures landforms={props.landforms} />
      {props.landforms.map((lf) => {
        const capture = LANDFORM_DECORATION_CAPTURES[lf.kind];
        return capture ? <Fragment key={`${lf.id}_decor`}>{capture(lf)}</Fragment> : null;
      })}
    </>
  );
});
