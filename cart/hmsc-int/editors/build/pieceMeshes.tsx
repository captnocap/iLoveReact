// pieceMeshes — the V24 placed-build-piece RENDERER, lifted verbatim out of
// PlayRoute so the embodied F2 build mode and the iso authoring pane draw a wall
// with ONE renderer (change a wall's look here, it changes in both). It turns a
// PlacedBuildPiece into visual shapes (the same meaning the colliders carry, as
// boxes/ramps) and then into Scene3D meshes.
//
// This is the "ONE MODEL, TWO VIEWS" contract taken to the renderer: the world
// stream stays the one source of WHAT stands; this is the one source of how it
// LOOKS. The iso pane imports pieceVisualShapes (ghost preview), VisualShapeMesh
// (ghost mesh), and PlacedPieceMeshes (the standing city), exactly as PlayRoute
// does — no second copy.

import { memo } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { GAME_BUILD, GAME_TELEMETRY } from '@game';
import type { BuildFaceSkin, BuildMaterial, BuildSkinSet, PlacedBuildPiece, WallEdit } from '@game';
import type { WorldProp } from '../../design';
import { Prop } from '../../render3d/Prop';
import { propDynamics } from '../../game/kinds/props';
import { BUILD_UI, CAMERA_OCCLUSION_TUNING } from './buildUi';
import { markPlaceFreezeProbe, perfMs, warnPlaceFreeze, type PlaceFreezeProbe } from './placeFreezeProbe';

const DEG = Math.PI / 180;

// How each material READS (display table — gameplay truth stays in the
// catalog tags; glass opacity matches the materials.ts family look).
const MATERIAL_LOOK: Record<BuildMaterial, { color: string; opacity?: number }> = {
  concrete: { color: '#9aa3ad' },
  brick: { color: '#8a4a3a' },
  stucco: { color: '#d8cdb8' },
  wood: { color: '#8a6a45' },
  metal: { color: '#7d858d' },
  glass: { color: '#cfe6f2', opacity: 0.3 },
  chainlink: { color: '#b9c2c9', opacity: 0.45 },
};
const SIGHTLINE_EDIT_OPACITY: Partial<Record<WallEdit, number>> = {
  window: 0.35,
  doubleWindow: 0.3,
  brokenWindow: 0.12,
};

// ── BUILD-mode piece visuals: the same meaning the colliders carry, as boxes ─

type VisualBox = {
  key: string;
  cx: number; cy: number; cz: number;
  sx: number; sy: number; sz: number;
  yawDegrees: number;
  color: string;
  textureKey?: string;
  opacity?: number;
};

type VisualRamp = {
  key: string;
  x: number; y: number; z: number;
  width: number; height: number; depth: number;
  slabThickness: number;
  yawDegrees: number;
  color: string;
  textureKey?: string;
  opacity?: number;
};

export type VisualShape =
  | { kind: 'box'; box: VisualBox }
  | { kind: 'ramp'; ramp: VisualRamp };

type RampSlabParams = {
  width: number;
  depth: number;
  rise: number;
  thickness: number;
};

const RampSlabGeometry: Geometry.GeometryDef<RampSlabParams> = {
  id: 'HmscRampInclinedSlab',
  defaults: { width: 3, depth: 3, rise: 3, thickness: 0.2 },
  generate: (params: RampSlabParams): Geometry.GeometryData => {
    const width = Math.max(0.01, params.width);
    const depth = Math.max(0.01, params.depth);
    const rise = params.rise;
    const thickness = Math.max(0.01, params.thickness);
    const hx = width / 2;
    const hz = depth / 2;
    const g = Geometry.mesh();
    const topNormal = Geometry.normalize(0, depth, -rise);
    const bottomNormal = Geometry.normalize(0, -depth, rise);
    const lowTop: Geometry.Vec3[] = [[-hx, 0, -hz], [hx, 0, -hz]];
    const highTop: Geometry.Vec3[] = [[-hx, rise, hz], [hx, rise, hz]];
    const lowBottom: Geometry.Vec3[] = [[-hx, -thickness, -hz], [hx, -thickness, -hz]];
    const highBottom: Geometry.Vec3[] = [[-hx, rise - thickness, hz], [hx, rise - thickness, hz]];
    g.tri(lowTop[0], topNormal, [0, 0], highTop[1], topNormal, [1, 1], lowTop[1], topNormal, [1, 0]);
    g.tri(lowTop[0], topNormal, [0, 0], highTop[0], topNormal, [0, 1], highTop[1], topNormal, [1, 1]);
    g.tri(lowBottom[0], bottomNormal, [0, 0], lowBottom[1], bottomNormal, [1, 0], highBottom[1], bottomNormal, [1, 1]);
    g.tri(lowBottom[0], bottomNormal, [0, 0], highBottom[1], bottomNormal, [1, 1], highBottom[0], bottomNormal, [0, 1]);
    g.face(lowBottom[1], lowTop[1], highTop[1], highBottom[1], [1, 0, 0], [0, 0]);
    g.face(lowTop[0], lowBottom[0], highBottom[0], highTop[0], [-1, 0, 0], [0, 0]);
    g.face(lowBottom[0], lowBottom[1], lowTop[1], lowTop[0], [0, 0, -1], [0, 0]);
    g.face(highBottom[1], highBottom[0], highTop[0], highTop[1], [0, 0, 1], [0, 0]);
    return g.build();
  },
};

/** local (u along width, v along depth) → world offset, R(+yaw) — the same
 *  frame the colliders/raycast/stamp rotate with. */
function localOffset(u: number, v: number, yawDegrees: number): { dx: number; dz: number } {
  const cos = Math.cos(yawDegrees * DEG);
  const sin = Math.sin(yawDegrees * DEG);
  // Match Scene3D/render3d yaw: local +v turns toward world +x at yaw 90.
  return { dx: u * cos + v * sin, dz: -u * sin + v * cos };
}

function visualLook(skin: BuildFaceSkin | undefined, fallback: string): { color: string; textureKey?: string } {
  if (!skin) return { color: fallback };
  if (skin.kind === 'color') return { color: skin.value };
  return { color: '#ffffff', textureKey: `bldskin:${skin.id}` };
}

function isHorizontalSkinPiece(kind: string): boolean {
  return kind === 'floor' || kind === 'roof';
}

export function pieceVisualShapes(
  piece: { pieceId: string; x: number; y: number; z: number; yawDegrees: number; edit?: WallEdit; skin?: BuildSkinSet },
  key: string,
  pieces?: readonly PlacedBuildPiece[],
): VisualShape[] {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  const look = MATERIAL_LOOK[def.material];
  const sides = visualLook(piece.skin?.sides, look.color);
  const front = visualLook(piece.skin?.front, look.color);
  const back = visualLook(piece.skin?.back, look.color);
  const size = def.size;
  const yaw = piece.yawDegrees;
  const depthSpan = GAME_BUILD.placed.depthSpan({ id: key, ...piece }, pieces);
  const depthCenter = (depthSpan.minV + depthSpan.maxV) / 2;
  const depthSize = depthSpan.maxV - depthSpan.minV;
  const box = (
    k: string,
    u: number,
    v: number,
    baseY: number,
    w: number,
    h: number,
    d: number,
    face: { color: string; textureKey?: string },
    opacity?: number,
  ): VisualShape => {
    const { dx, dz } = localOffset(u, v, yaw);
    return {
      kind: 'box',
      box: {
        key: `${key}.${k}`,
        cx: piece.x + dx, cy: baseY + h / 2, cz: piece.z + dz,
        sx: w, sy: h, sz: d,
        yawDegrees: yaw,
        color: face.color,
        textureKey: face.textureKey,
        opacity: opacity ?? look.opacity,
      },
    };
  };

  if (def.kind === 'ramp') {
    return [{
      kind: 'ramp',
      ramp: {
        key: `${key}.slope`,
        x: piece.x, y: piece.y, z: piece.z,
        width: size.widthMeters,
        height: size.heightMeters,
        depth: size.depthMeters,
        slabThickness: GAME_BUILD.placed.tuning.rampSlabThicknessMeters,
        yawDegrees: yaw,
        color: front.color,
        textureKey: front.textureKey,
        opacity: look.opacity,
      },
    }];
  }

  if (def.kind === 'stairs') {
    // stepped boxes rising along local +v — the heightfield's own direction,
    // so stairs stay visually distinct from the ramp's smooth plane.
    const boxes: VisualShape[] = [];
    const steps = BUILD_UI.stairVisualSteps;
    for (let i = 0; i < steps; i += 1) {
      const v = (-size.depthMeters / 2) + ((i + 0.5) / steps) * size.depthMeters;
      const h = ((i + 1) / steps) * size.heightMeters;
      const { dx, dz } = localOffset(0, v, yaw);
      boxes.push({
        kind: 'box',
        box: {
          key: `${key}.s${i}`,
          cx: piece.x + dx, cy: piece.y + h / 2, cz: piece.z + dz,
          sx: size.widthMeters, sy: h, sz: size.depthMeters / steps,
          yawDegrees: yaw,
          color: front.color,
          textureKey: front.textureKey,
          opacity: look.opacity,
        },
      });
    }
    return boxes;
  }

  const edit = piece.edit;
  if (GAME_BUILD.kinds.get(def.kind).edits === 'wall') {
    const shapes: VisualShape[] = [];
    const slab = BUILD_UI.faceSlabThicknessMeters;
    const lift = BUILD_UI.faceSlabLiftMeters;
    const frontV = depthSpan.maxV + lift;
    const backV = depthSpan.minV - lift;
    const isWindowOpening = edit === 'window' || edit === 'doubleWindow' || edit === 'brokenWindow';
    const hasGlassPane = edit === 'window' || edit === 'doubleWindow';
    const openingW = edit === 'doubleWindow' ? BUILD_UI.doubleWindowCutoutWidthMeters : BUILD_UI.editCutoutWidthMeters;
    const openingH = BUILD_UI.editCutoutHeightMeters;
    const openingBottom = piece.y + size.heightMeters * 0.55 - openingH / 2;
    const openingTop = openingBottom + openingH;
    // CORNERSEAM-0610: miter the face slabs where two walls corner. The core
    // bodies already close (run limits extend through the joining wall), but
    // each slab floats `lift` proud of its core, leaving an open vertical
    // pocket at the convex corner. Closure: the x-axis wall's outer slab runs
    // THROUGH to the joining wall's slab outer surface; the z-axis wall's
    // BUTTS into the through slab's inner surface. One through + one butt =
    // pocket filled, end caps meet edge-to-edge, no coplanar faces to z-fight.
    const bands = GAME_BUILD.placed.bands(piece as PlacedBuildPiece, pieces);
    const ends = GAME_BUILD.placed.wallEnds(piece as PlacedBuildPiece, pieces);
    const cornerExt = ends.axis === 'x' ? lift + slab / 2 : Math.max(0, lift - slab / 2);
    const wallMinU = bands.length > 0 ? bands[0].u0 : 0;
    const wallMaxU = bands.length > 0 ? bands[bands.length - 1].u1 : 0;
    const slabU0 = (u0: number, vSign: 1 | -1): number =>
      u0 === wallMinU && ends.minU?.outerV === vSign ? u0 - cornerExt : u0;
    const slabU1 = (u1: number, vSign: 1 | -1): number =>
      u1 === wallMaxU && ends.maxU?.outerV === vSign ? u1 + cornerExt : u1;
    const addWallBox = (label: string, u0: number, u1: number, baseY: number, h: number): void => {
      if (u1 - u0 <= 0.001 || h <= 0.001) return;
      shapes.push(box(`${label}.core`, (u0 + u1) / 2, depthCenter, baseY, u1 - u0, h, depthSize, sides));
      const f0 = slabU0(u0, 1);
      const f1 = slabU1(u1, 1);
      shapes.push(box(`${label}.front`, (f0 + f1) / 2, frontV, baseY, f1 - f0, h, slab, front));
      const b0 = slabU0(u0, -1);
      const b1 = slabU1(u1, -1);
      shapes.push(box(`${label}.back`, (b0 + b1) / 2, backV, baseY, b1 - b0, h, slab, back));
    };
    for (const [index, band] of bands.entries()) {
      const label = `band${index}`;
      if (!isWindowOpening) {
        addWallBox(label, band.u0, band.u1, piece.y, band.top - piece.y);
        continue;
      }
      const holeU0 = -openingW / 2;
      const holeU1 = openingW / 2;
      const leftU0 = band.u0;
      const leftU1 = Math.min(band.u1, holeU0);
      const rightU0 = Math.max(band.u0, holeU1);
      const rightU1 = band.u1;
      addWallBox(`${label}.leftJamb`, leftU0, leftU1, piece.y, band.top - piece.y);
      addWallBox(`${label}.rightJamb`, rightU0, rightU1, piece.y, band.top - piece.y);
      const midU0 = Math.max(band.u0, holeU0);
      const midU1 = Math.min(band.u1, holeU1);
      if (midU1 > midU0) {
        addWallBox(`${label}.sill`, midU0, midU1, piece.y, Math.max(0, openingBottom - piece.y));
        addWallBox(`${label}.header`, midU0, midU1, openingTop, Math.max(0, band.top - openingTop));
      }
    }
    if (hasGlassPane) {
      shapes.push(box(
        'glassPane',
        0,
        depthCenter,
        openingBottom,
        openingW,
        openingH,
        BUILD_UI.windowPaneDepthMeters,
        { color: BUILD_UI.windowPaneColor },
        BUILD_UI.windowPaneOpacity,
      ));
    }
    if (edit !== undefined && !isWindowOpening) {
      const low = edit === 'door' || edit === 'garageDoor' || edit === 'arch';
      const eh = low ? BUILD_UI.editCutoutLowHeightMeters : BUILD_UI.editCutoutHeightMeters;
      const ey = low ? piece.y + eh / 2 : piece.y + size.heightMeters * 0.55;
      const opacity = SIGHTLINE_EDIT_OPACITY[edit];
      shapes.push(box('edit', 0, depthCenter, ey - eh / 2, BUILD_UI.editCutoutWidthMeters, eh, depthSize + 0.06, { color: '#0c1018' }, opacity));
    }
    return shapes;
  }
  if (isHorizontalSkinPiece(def.kind)) {
    const slab = BUILD_UI.faceSlabThicknessMeters;
    const lift = BUILD_UI.faceSlabLiftMeters;
    const coreHeight = Math.max(0.01, size.heightMeters - lift * 2);
    return [
      box('edges', 0, 0, piece.y + lift, size.widthMeters, coreHeight, size.depthMeters, sides),
      box('top', 0, 0, piece.y + size.heightMeters + lift - slab / 2, size.widthMeters, slab, size.depthMeters, front),
      box('bottom', 0, 0, piece.y - lift - slab / 2, size.widthMeters, slab, size.depthMeters, back),
    ];
  }

  return [box('body', 0, 0, piece.y, size.widthMeters, size.heightMeters, size.depthMeters, front)];
}

function VisualBoxMesh(props: { box: VisualBox; colorOverride?: string; opacityOverride?: number }) {
  const b = props.box;
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: 1, height: 1, depth: 1 }}
      scale={[b.sx, b.sy, b.sz]}
      rotation={[0, b.yawDegrees, 0]}
      position={[b.cx, b.cy, b.cz]}
      material={{ color: props.colorOverride ?? b.color, opacity: props.opacityOverride ?? b.opacity ?? 1 }}
      textureKey={props.colorOverride ? undefined : b.textureKey}
    />
  );
}

function VisualRampMesh(props: { ramp: VisualRamp; colorOverride?: string; opacityOverride?: number }) {
  const r = props.ramp;
  return (
    <Scene3D.Mesh
      geometry={RampSlabGeometry}
      params={{
        width: r.width,
        depth: r.depth,
        rise: r.height,
        thickness: r.slabThickness,
      }}
      rotation={[0, r.yawDegrees, 0]}
      position={[r.x, r.y, r.z]}
      material={{ color: props.colorOverride ?? r.color, opacity: props.opacityOverride ?? r.opacity ?? 1 }}
      textureKey={props.colorOverride ? undefined : r.textureKey}
    />
  );
}

export function VisualShapeMesh(props: { shape: VisualShape; colorOverride?: string; opacityOverride?: number }) {
  return props.shape.kind === 'ramp'
    ? <VisualRampMesh ramp={props.shape.ramp} colorOverride={props.colorOverride} opacityOverride={props.opacityOverride} />
    : <VisualBoxMesh box={props.shape.box} colorOverride={props.colorOverride} opacityOverride={props.opacityOverride} />;
}

function wallJoinSignature(piece: PlacedBuildPiece, pieces: readonly PlacedBuildPiece[]): string {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  if (GAME_BUILD.kinds.get(def.kind).edits !== 'wall') return '';
  // End-corner state rides the digest (CORNERSEAM-0610): a neighbor can change
  // only the slab miter (not the bands), and the memo must still re-render.
  const ends = GAME_BUILD.placed.wallEnds(piece, pieces);
  const endsKey = `#${ends.minU?.outerV ?? 0}:${ends.maxU?.outerV ?? 0}`;
  return GAME_BUILD.placed.bands(piece, pieces)
    .map((band) => `${band.u0.toFixed(3)}:${band.u1.toFixed(3)}:${band.top.toFixed(3)}`)
    .join('|') + endsKey;
}

// ── Instanced city rendering (req_0504: "this whole building should turn into
// one object not 179") ───────────────────────────────────────────────────────
// The standing city used to mount one Scene3D.Mesh PER VISUAL BOX — ~4.9k
// pieces ≈ tens of thousands of live nodes, and a 179-piece building move
// unmounted+remounted ~1,800 of them (the 1-2s host stalls the DRAGDRAW
// watchdog caught). Now every OPAQUE box rides a Scene3D.Instances bucket
// keyed by its texture — a handful of nodes for the whole city, and an edit
// is a data-array update, not a mount storm. Translucent shapes (glass,
// window panes, occlusion-faded pieces) and ramps stay individual meshes:
// instanced batches draw opaque (alpha is fixed 1.0 in the instance stream)
// and ramps carry per-piece geometry params.

const UNIT_BOX_PARAMS = { width: 1, height: 1, depth: 1 };

// hex '#rrggbb' → normalized rgb, cached (a handful of distinct colors in play)
const rgbCache = new Map<string, readonly [number, number, number]>();
function rgbOf(hex: string): readonly [number, number, number] {
  const hit = rgbCache.get(hex);
  if (hit) return hit;
  let v: readonly [number, number, number] = [1, 1, 1];
  if (typeof hex === 'string' && hex[0] === '#' && hex.length === 7) {
    v = [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    ];
  }
  rgbCache.set(hex, v);
  return v;
}

// Per-piece shape cache: piece objects are immutable and REUSED across stream
// materializations (an edit replaces only the touched pieces), so caching on
// the piece object + its join digest means a 1-piece edit recomputes 1 piece's
// shapes, not 4.9k — the same role the old per-piece memo played, without the
// per-piece component.
const pieceShapeCache = new WeakMap<PlacedBuildPiece, { joinKey: string; shapes: VisualShape[] }>();
function pieceShapesCached(piece: PlacedBuildPiece, joinKey: string, pieces: readonly PlacedBuildPiece[]): VisualShape[] {
  const hit = pieceShapeCache.get(piece);
  if (hit && hit.joinKey === joinKey) return hit.shapes;
  const shapes = pieceVisualShapes(piece, piece.id, pieces);
  pieceShapeCache.set(piece, { joinKey, shapes });
  return shapes;
}

type InstanceBucket = {
  texKey: string; // '' = untextured (flat color)
  data: number[]; // stride 12: pos(3) rotDeg(3) scale(3) rgb(3)
  count: number;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  maxHalf: number;
};

function propFromPiece(piece: PlacedBuildPiece): WorldProp | null {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  if (def.kind !== 'prop' || !def.propKind) return null;
  return {
    id: piece.id,
    kind: def.propKind as WorldProp['kind'],
    x: piece.x,
    y: piece.y,
    z: piece.z,
    yawDegrees: piece.yawDegrees,
    createdByCommand: 'hmsc-int:build-prop',
  };
}

function propSelectionShape(piece: PlacedBuildPiece, color: string, opacity: number): VisualShape {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  return {
    kind: 'box',
    box: {
      key: `${piece.id}.prop-select`,
      cx: piece.x,
      cy: piece.y + def.size.heightMeters / 2,
      cz: piece.z,
      sx: def.size.widthMeters,
      sy: def.size.heightMeters,
      sz: def.size.depthMeters,
      yawDegrees: piece.yawDegrees,
      color,
      opacity,
    },
  };
}

function pushBoxInstance(bucket: InstanceBucket, b: VisualBox, rgb: readonly [number, number, number]): void {
  bucket.data.push(b.cx, b.cy, b.cz, 0, b.yawDegrees, 0, b.sx, b.sy, b.sz, rgb[0], rgb[1], rgb[2]);
  bucket.count += 1;
  if (b.cx < bucket.minX) bucket.minX = b.cx;
  if (b.cy < bucket.minY) bucket.minY = b.cy;
  if (b.cz < bucket.minZ) bucket.minZ = b.cz;
  if (b.cx > bucket.maxX) bucket.maxX = b.cx;
  if (b.cy > bucket.maxY) bucket.maxY = b.cy;
  if (b.cz > bucket.maxZ) bucket.maxZ = b.cz;
  const half = Math.max(b.sx, b.sy, b.sz) / 2;
  if (half > bucket.maxHalf) bucket.maxHalf = half;
}

// The join-signature pass over the whole piece array, cached on the ARRAY
// IDENTITY (PLACEPERF-0610): every render of PlacedPieceMeshes used to redo it
// (43ms at ~4.8k pieces), and a single commit re-renders several times
// (selection clear, occlusion recompute, snapshot tick…) — the user saw six
// 43ms visualBoxes lines per move. Pieces arrays are immutable (the stream
// materializes a fresh array per change), so identity is the correct key.
const joinKeysCache = new WeakMap<readonly PlacedBuildPiece[], { joinKeys: Map<string, string>; boxes: number; ms: number }>();

function joinKeysOf(pieces: readonly PlacedBuildPiece[]): { joinKeys: Map<string, string>; boxes: number; ms: number; cached: boolean } {
  const hit = joinKeysCache.get(pieces);
  if (hit) return { ...hit, cached: true };
  const t0 = perfMs();
  const joinKeys = new Map<string, string>();
  let boxes = 0;
  for (const piece of pieces) {
    const signature = wallJoinSignature(piece, pieces);
    if (signature) {
      joinKeys.set(piece.id, signature);
      boxes += signature.split('|').length;
    } else {
      const def = GAME_BUILD.catalog.get(piece.pieceId);
      boxes += def.kind === 'stairs' ? BUILD_UI.stairVisualSteps : 1;
    }
  }
  const entry = { joinKeys, boxes, ms: perfMs() - t0 };
  joinKeysCache.set(pieces, entry);
  return { ...entry, cached: false };
}

export const PlacedPieceMeshes = memo(function PlacedPieceMeshes(props: {
  pieces: readonly PlacedBuildPiece[];
  markedIds: ReadonlySet<string>;
  targetId: string | null;
  occludedIds: ReadonlySet<string>;
  placeFreezeProbe?: PlaceFreezeProbe | null;
  /** KICKPROP-0610: the play route simulates dynamic props (balls, cones) as
   *  host bodies and renders them in its own live layer — skip them here so
   *  they don't ALSO render frozen at their placement anchor. Default false
   *  (the iso author pane has no physics loop and renders everything). */
  skipDynamicProps?: boolean;
}) {
  const { joinKeys, boxes, ms: boxesMs, cached } = joinKeysOf(props.pieces);
  // Bucket every opaque box by texture into instance streams; everything that
  // needs per-node treatment (ramps, glass/window panes, occlusion-faded
  // pieces, anything translucent) falls out to individual meshes. Rebuilt per
  // render — array fills over cached shapes, a few ms at city scale.
  const t0 = perfMs();
  const buckets = new Map<string, InstanceBucket>();
  const loose: { key: string; shape: VisualShape; color?: string; opacity?: number }[] = [];
  const propMeshes: WorldProp[] = [];
  for (const piece of props.pieces) {
    const marked = props.markedIds.has(piece.id);
    const target = props.targetId === piece.id;
    const occluded = props.occludedIds.has(piece.id);
    const colorOverride = marked ? BUILD_UI.markColor : target ? BUILD_UI.targetColor : undefined;
    const opacityOverride = occluded ? CAMERA_OCCLUSION_TUNING.residualOpacity : undefined;
    const prop = propFromPiece(piece);
    if (prop) {
      if (props.skipDynamicProps && propDynamics(prop.kind)) continue;
      propMeshes.push(prop);
      if (colorOverride || opacityOverride !== undefined) {
        loose.push({
          key: `${piece.id}.prop-select`,
          shape: propSelectionShape(piece, colorOverride ?? BUILD_UI.targetColor, opacityOverride ?? 0.22),
        });
      }
      continue;
    }
    const shapes = pieceShapesCached(piece, joinKeys.get(piece.id) ?? '', props.pieces);
    for (const shape of shapes) {
      const baseOpacity = shape.kind === 'ramp' ? shape.ramp.opacity : shape.box.opacity;
      if (shape.kind === 'ramp' || opacityOverride !== undefined || (baseOpacity !== undefined && baseOpacity < 1)) {
        loose.push({
          key: shape.kind === 'ramp' ? shape.ramp.key : shape.box.key,
          shape,
          color: colorOverride,
          opacity: opacityOverride,
        });
        continue;
      }
      const b = shape.box;
      const texKey = colorOverride ? '' : (b.textureKey ?? '');
      let bucket = buckets.get(texKey);
      if (!bucket) {
        bucket = { texKey, data: [], count: 0, minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, maxHalf: 0 };
        buckets.set(texKey, bucket);
      }
      pushBoxInstance(bucket, b, rgbOf(colorOverride ?? b.color));
    }
  }
  const batchMs = perfMs() - t0;
  GAME_TELEMETRY.recordDiagnostic('draw', 'placement.visualBoxes', {
    pieces: props.pieces.length,
    boxes,
    ms: boxesMs,
    cached,
    buckets: buckets.size,
    loose: loose.length,
    batchMs,
  });
  markPlaceFreezeProbe(props.placeFreezeProbe, 'visualBoxes', { pieces: props.pieces.length, boxes, ms: boxesMs, cached, buckets: buckets.size, loose: loose.length, batchMs });
  // Only a real (uncached) join pass warns — a cache hit costs ~nothing.
  if (!cached) warnPlaceFreeze('visualBoxes', { pieces: props.pieces.length, boxes, ms: boxesMs, buckets: buckets.size, loose: loose.length, batchMs });
  return (
    <>
      {[...buckets.values()].map((bk) => {
        const cx = (bk.minX + bk.maxX) / 2;
        const cy = (bk.minY + bk.maxY) / 2;
        const cz = (bk.minZ + bk.maxZ) / 2;
        const dx = bk.maxX - cx, dy = bk.maxY - cy, dz = bk.maxZ - cz;
        const radius = Math.sqrt(dx * dx + dy * dy + dz * dz) + bk.maxHalf;
        return (
          <Scene3D.Instances
            key={`bk:${bk.texKey || 'flat'}`}
            geometry={Geometry.Box}
            params={UNIT_BOX_PARAMS}
            data={bk.data}
            count={bk.count}
            stride={12}
            textureKey={bk.texKey || undefined}
            center={[cx, cy, cz]}
            boundsRadius={radius}
          />
        );
      })}
      {propMeshes.map((prop) => <Prop key={prop.id} prop={prop} />)}
      {loose.map((l) => (
        <VisualShapeMesh key={l.key} shape={l.shape} colorOverride={l.color} opacityOverride={l.opacity} />
      ))}
    </>
  );
});
