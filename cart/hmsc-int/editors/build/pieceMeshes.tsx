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
import type { PlacedBuildPiece } from '@game';
import type { WorldProp } from '../../design';
import { Prop } from '../../render3d/Prop';
import { propDynamics, isCookedPropKind } from '../../game/kinds/props';
import { isImportedPropKind, importedPropMesh } from '../../game/kinds/importedProps';
import { cookedAssetById } from '../model/cookedAssets';
import { resolvePropParts } from '../../compile/propRecipes/resolve';
import { resolveMaterialShader } from '../../compile/worldGeometry';
import { propModelFootprintMeters, propVerticalBand } from '../../compile/propRecipes/footprint';
import { BUILD_UI, pieceVisualShapes, wallJoinSignature } from './pieceShapes';
import type { VisualBox, VisualShape } from './pieceShapes';
import { CAMERA_OCCLUSION_TUNING } from './buildUi';
import { markPlaceFreezeProbe, perfMs, warnPlaceFreeze, type PlaceFreezeProbe } from './placeFreezeProbe';

// The PURE shape decomposition lives in ./pieceShapes (PARITY-0611, req_0655)
// so the compile bake and the headless parity suite import it without React.
// Re-exported here so every existing consumer keeps its import path.
export { MATERIAL_LOOK, pieceVisualShapes, elevatorCarVisualShape, wallJoinSignature } from './pieceShapes';
export type { VisualBox, VisualRamp, VisualShape } from './pieceShapes';

type RampSlabParams = {
  width: number;
  depth: number;
  rise: number;
  thickness: number;
};

function openRunBoxGeometry(id: string, openMin: boolean, openMax: boolean): Geometry.GeometryDef<Record<string, never>> {
  return {
    id,
    defaults: {},
    generate: (): Geometry.GeometryData => {
      const v0: Geometry.Vec3 = [-0.5, -0.5, -0.5];
      const v1: Geometry.Vec3 = [0.5, -0.5, -0.5];
      const v2: Geometry.Vec3 = [0.5, 0.5, -0.5];
      const v3: Geometry.Vec3 = [-0.5, 0.5, -0.5];
      const v4: Geometry.Vec3 = [-0.5, -0.5, 0.5];
      const v5: Geometry.Vec3 = [0.5, -0.5, 0.5];
      const v6: Geometry.Vec3 = [0.5, 0.5, 0.5];
      const v7: Geometry.Vec3 = [-0.5, 0.5, 0.5];
      const g = Geometry.mesh();
      g.face(v4, v5, v6, v7, [0, 0, 1], [0, 0]);
      g.face(v1, v0, v3, v2, [0, 0, -1], [0, 0]);
      if (!openMax) g.face(v5, v1, v2, v6, [1, 0, 0], [0, 0]);
      if (!openMin) g.face(v0, v4, v7, v3, [-1, 0, 0], [0, 0]);
      g.face(v7, v6, v2, v3, [0, 1, 0], [0, 0]);
      g.face(v0, v1, v5, v4, [0, -1, 0], [0, 0]);
      return g.build();
    },
  };
}

const BoxOpenRunMinGeometry = openRunBoxGeometry('HmscBoxOpenRunMin', true, false);
const BoxOpenRunMaxGeometry = openRunBoxGeometry('HmscBoxOpenRunMax', false, true);
const BoxOpenRunBothGeometry = openRunBoxGeometry('HmscBoxOpenRunBoth', true, true);

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

function VisualBoxMesh(props: { box: VisualBox; colorOverride?: string; opacityOverride?: number }) {
  const b = props.box;
  const geometry = b.openRunMin && b.openRunMax
    ? BoxOpenRunBothGeometry
    : b.openRunMin
      ? BoxOpenRunMinGeometry
      : b.openRunMax
        ? BoxOpenRunMaxGeometry
        : Geometry.Box;
  return (
    <Scene3D.Mesh
      geometry={geometry}
      params={{ width: 1, height: 1, depth: 1 }}
      scale={[b.sx, b.sy, b.sz]}
      rotation={[0, b.yawDegrees, 0]}
      position={[b.cx, b.cy, b.cz]}
      material={{ color: props.colorOverride ?? b.color, opacity: props.opacityOverride ?? b.opacity ?? 1 }}
      textureKey={props.colorOverride ? undefined : b.textureKey}
    />
  );
}

// req_0930: the GABLE END prism — a unit isoceles-triangle wall, the EDITOR twin
// of world_loader.zig's buildGablePrism (same verts/normals/winding so the
// editor and the compiled game render the identical solid). Unit cube space:
// x ∈ [-0.5,0.5] is the thin width-thickness, z ∈ [-0.5,0.5] is the eave-to-eave
// base, y is centered [-0.5,0.5] so scale.y = the ridge rise. The apex is an
// EDGE at y=+0.5, z=0 (running along x); the base sits flat at y=-0.5.
const GablePrismGeometry: Geometry.GeometryDef<Record<string, never>> = {
  id: 'HmscGableEndPrism',
  defaults: {},
  generate: (): Geometry.GeometryData => {
    const a0: Geometry.Vec3 = [-0.5, -0.5, -0.5];
    const a1: Geometry.Vec3 = [0.5, -0.5, -0.5];
    const b0: Geometry.Vec3 = [-0.5, -0.5, 0.5];
    const b1: Geometry.Vec3 = [0.5, -0.5, 0.5];
    const p0: Geometry.Vec3 = [-0.5, 0.5, 0];
    const p1: Geometry.Vec3 = [0.5, 0.5, 0];
    const down: Geometry.Vec3 = [0, -1, 0];
    const negZ = Geometry.normalize(0, 0.5, -1); // -z slope, up-and-out
    const posZ = Geometry.normalize(0, 0.5, 1); // +z slope, up-and-out
    const negX: Geometry.Vec3 = [-1, 0, 0];
    const posX: Geometry.Vec3 = [1, 0, 0];
    const g = Geometry.mesh();
    // base (two tris, normal down)
    g.tri(a0, down, [0, 0], b1, down, [1, 1], b0, down, [0, 1]);
    g.tri(a0, down, [0, 0], a1, down, [1, 0], b1, down, [1, 1]);
    // -z slope
    g.tri(a0, negZ, [0, 0], p1, negZ, [1, 1], a1, negZ, [1, 0]);
    g.tri(a0, negZ, [0, 0], p0, negZ, [0, 1], p1, negZ, [1, 1]);
    // +z slope
    g.tri(b0, posZ, [0, 0], b1, posZ, [1, 0], p1, posZ, [1, 1]);
    g.tri(b0, posZ, [0, 0], p1, posZ, [1, 1], p0, posZ, [0, 1]);
    // triangular end caps
    g.tri(a0, negX, [0, 0], b0, negX, [1, 0], p0, negX, [0.5, 1]);
    g.tri(a1, posX, [0, 0], p1, posX, [0.5, 1], b1, posX, [1, 0]);
    return g.build();
  },
};

function VisualGablePrismMesh(props: { box: VisualBox; colorOverride?: string; opacityOverride?: number }) {
  const b = props.box;
  return (
    <Scene3D.Mesh
      geometry={GablePrismGeometry}
      params={{}}
      scale={[b.sx, b.sy, b.sz]}
      rotation={[0, b.yawDegrees, 0]}
      position={[b.cx, b.cy, b.cz]}
      material={{ color: props.colorOverride ?? b.color, opacity: props.opacityOverride ?? b.opacity ?? 1 }}
      textureKey={props.colorOverride ? undefined : b.textureKey}
    />
  );
}

// CORNERSEAM-0610: a unit vertical right-triangle prism, centered like a box.
// Local footprint vertices are (-x,-z), (+x,-z), (-x,+z); sx/sz/yaw place it
// into the wall-end corner square. The local -x face is intentionally omitted:
// it sits against the trimmed wall body and drawing it creates the visible
// vertical strip at L-corners. The diagonal split face is omitted too; it is an
// internal boundary between the two painted miter halves, not a real wall face.
const CornerMiterPrismGeometry: Geometry.GeometryDef<Record<string, never>> = {
  id: 'HmscWallCornerMiterPrism',
  defaults: {},
  generate: (): Geometry.GeometryData => {
    const b0: Geometry.Vec3 = [-0.5, -0.5, -0.5];
    const b1: Geometry.Vec3 = [0.5, -0.5, -0.5];
    const b2: Geometry.Vec3 = [-0.5, -0.5, 0.5];
    const t0: Geometry.Vec3 = [-0.5, 0.5, -0.5];
    const t1: Geometry.Vec3 = [0.5, 0.5, -0.5];
    const t2: Geometry.Vec3 = [-0.5, 0.5, 0.5];
    const g = Geometry.mesh();
    g.tri(b0, [0, -1, 0], [0, 0], b2, [0, -1, 0], [0, 1], b1, [0, -1, 0], [1, 0]);
    g.tri(t0, [0, 1, 0], [0, 0], t1, [0, 1, 0], [1, 0], t2, [0, 1, 0], [0, 1]);
    g.face(b0, b1, t1, t0, [0, 0, -1], [0, 0]);
    return g.build();
  },
};

const CornerMiterMirrorPrismGeometry: Geometry.GeometryDef<Record<string, never>> = {
  id: 'HmscWallCornerMiterMirrorPrism',
  defaults: {},
  generate: (): Geometry.GeometryData => {
    const b0: Geometry.Vec3 = [-0.5, -0.5, 0.5];
    const b1: Geometry.Vec3 = [0.5, -0.5, 0.5];
    const b2: Geometry.Vec3 = [-0.5, -0.5, -0.5];
    const t0: Geometry.Vec3 = [-0.5, 0.5, 0.5];
    const t1: Geometry.Vec3 = [0.5, 0.5, 0.5];
    const t2: Geometry.Vec3 = [-0.5, 0.5, -0.5];
    const g = Geometry.mesh();
    g.tri(b0, [0, -1, 0], [0, 0], b2, [0, -1, 0], [0, 1], b1, [0, -1, 0], [1, 0]);
    g.tri(t0, [0, 1, 0], [0, 0], t1, [0, 1, 0], [1, 0], t2, [0, 1, 0], [0, 1]);
    g.face(b0, b1, t1, t0, [0, 0, 1], [0, 0]);
    return g.build();
  },
};

function VisualCornerMiterPrismMesh(props: { box: VisualBox; mirrored?: boolean; colorOverride?: string; opacityOverride?: number }) {
  const b = props.box;
  return (
    <Scene3D.Mesh
      geometry={props.mirrored ? CornerMiterMirrorPrismGeometry : CornerMiterPrismGeometry}
      params={{}}
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
  if (props.shape.kind === 'ramp')
    return <VisualRampMesh ramp={props.shape.ramp} colorOverride={props.colorOverride} opacityOverride={props.opacityOverride} />;
  if (props.shape.kind === 'gable')
    return <VisualGablePrismMesh box={props.shape.box} colorOverride={props.colorOverride} opacityOverride={props.opacityOverride} />;
  if (props.shape.kind === 'cornerMiter')
    return <VisualCornerMiterPrismMesh box={props.shape.box} colorOverride={props.colorOverride} opacityOverride={props.opacityOverride} />;
  if (props.shape.kind === 'cornerMiterMirror')
    return <VisualCornerMiterPrismMesh box={props.shape.box} mirrored colorOverride={props.colorOverride} opacityOverride={props.opacityOverride} />;
  return <VisualBoxMesh box={props.shape.box} colorOverride={props.colorOverride} opacityOverride={props.opacityOverride} />;
}

// One ghost/preview piece (PROPGHOST-0754). The iso pane's placement / move /
// paint previews used to draw EVERY armed piece through pieceVisualShapes — and
// a PROP has no shape decomposition, so it fell through to a single def.size box.
// That slab looked nothing like the model it became ("you have no idea what it
// is til its placed"). A prop's ghost now mounts the SAME <Prop> renderer the
// standing world uses, so the preview IS the prop; non-prop pieces (walls, floors,
// ramps, stairs, elevators) keep the translucent box/ramp decomposition. A blocked
// placement lays the red def.size footprint OVER the model so the refusal still
// reads. This is the "ONE MODEL, TWO VIEWS" contract extended to the ghost.
export const GhostPiece = memo(function GhostPiece(props: {
  piece: Parameters<typeof pieceVisualShapes>[0];
  ghostKey: string;
  supportPieces: readonly PlacedBuildPiece[];
  colorOverride?: string;
  opacityOverride?: number;
  blocked?: boolean;
}) {
  const { piece, ghostKey, supportPieces, colorOverride, opacityOverride, blocked } = props;
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  if (def.kind === 'prop' && def.propKind) {
    const prop: WorldProp = {
      id: ghostKey,
      kind: def.propKind as WorldProp['kind'],
      x: piece.x,
      y: piece.y,
      z: piece.z,
      yawDegrees: piece.yawDegrees,
      text: piece.text,
      createdByCommand: 'hmsc-int:ghost',
    };
    return (
      <>
        <Prop prop={prop} />
        {blocked ? (
          <VisualShapeMesh
            shape={propSelectionShape({ id: ghostKey, ...piece } as PlacedBuildPiece, BUILD_UI.ghostBlockedColor, BUILD_UI.ghostOpacity)}
          />
        ) : null}
      </>
    );
  }
  return (
    <>
      {pieceVisualShapes(piece, ghostKey, supportPieces).map((shape) => (
        <VisualShapeMesh
          key={shape.kind === 'ramp' ? shape.ramp.key : shape.box.key}
          shape={shape}
          colorOverride={colorOverride}
          opacityOverride={opacityOverride}
        />
      ))}
    </>
  );
});


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

export function propFromPiece(piece: PlacedBuildPiece): WorldProp | null {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  if (def.kind !== 'prop' || !def.propKind) return null;
  return {
    id: piece.id,
    kind: def.propKind as WorldProp['kind'],
    x: piece.x,
    y: piece.y,
    z: piece.z,
    yawDegrees: piece.yawDegrees,
    // PROPSKIN-0766: the placed piece's per-part texture overrides ride into the
    // WorldProp so the rendered prop wears them (DataProp + WorldPartCaptures).
    partTextures: piece.partTextures,
    // PARAMETRIC props (req_0893): per-instance text rides in so the recipe
    // lowers THIS placement's word.
    text: piece.text,
    createdByCommand: 'hmsc-int:build-prop',
  };
}

/** The placed PROP pieces that carry per-part textures, as WorldProps — the
 *  capture mount needs these (only textured props produce buckets). */
export function texturedPropsFromPieces(pieces: readonly PlacedBuildPiece[]): WorldProp[] {
  const out: WorldProp[] = [];
  for (const piece of pieces) {
    if (!piece.partTextures) continue;
    const prop = propFromPiece(piece);
    if (prop) out.push(prop);
  }
  return out;
}

function propSelectionShape(piece: PlacedBuildPiece, color: string, opacity: number): VisualShape {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  // FOOTPRINT-0765: a recipe prop's selection box is its MEASURED footprint at
  // the model-center offset, rotated about the anchor (matching localOffset/yaw),
  // so the highlight tracks the mesh under rotation like its collider does.
  const fp = def.propKind ? propModelFootprintMeters(def.propKind) : null;
  // Vertical band of the actual geometry (req_1681): a prop whose mesh floats off
  // the ground (a hung frame) gets a highlight that tracks it, not a ground box.
  // baseY/height fall back to 0/heightMeters for ordinary ground-resting props.
  const band = def.propKind ? propVerticalBand(def.propKind) : null;
  const baseY = band?.baseY ?? 0;
  const heightY = band?.height ?? def.size.heightMeters;
  const yaw = piece.yawDegrees * Math.PI / 180;
  const ox = fp?.offsetXMeters ?? 0, oz = fp?.offsetZMeters ?? 0;
  const dx = ox * Math.cos(yaw) + oz * Math.sin(yaw);
  const dz = -ox * Math.sin(yaw) + oz * Math.cos(yaw);
  return {
    kind: 'box',
    box: {
      key: `${piece.id}.prop-select`,
      cx: piece.x + dx,
      cy: piece.y + baseY + heightY / 2,
      cz: piece.z + dz,
      sx: fp?.widthMeters ?? def.size.widthMeters,
      sy: heightY,
      sz: fp?.depthMeters ?? def.size.depthMeters,
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

const PROP_DEG = Math.PI / 180;
// Live instance rows for a PARTS prop (street furniture, signage, fences — the
// majority of props, which bake to primitive parts not mesh assets). Mirrors
// worldGeometry.propAt/propRotation — the bake's local→world transform — so the
// live overlay draws each part exactly where the bake will. Non-box parts
// (cylinders/spheres) ride as their bounding box in the stride-12 box overlay;
// the per-shape live path (Layer 2) restores their true geometry. This is what
// makes a prop placement instant with NO rebake, the same as a build piece.
function pushPropPartRows(rows: number[], prop: WorldProp): void {
  const yaw = (prop.yawDegrees ?? 0) * PROP_DEG;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const part of resolvePropParts(prop)) {
    const lx = part.local[0], ly = part.local[1], lz = part.local[2];
    const rx = part.rotation?.[0] ?? 0;
    const ry = (prop.yawDegrees ?? 0) + (part.rotation?.[1] ?? 0);
    const rz = part.rotation?.[2] ?? 0;
    rows.push(
      prop.x + lx * c + lz * s, (prop.y ?? 0) + ly, prop.z - lx * s + lz * c,
      rx, ry, rz,
      part.size[0], part.size[1], part.size[2],
      part.color[0], part.color[1], part.color[2],
    );
  }
}

// Pack placed pieces into a flat Float32Array of unit-box instance rows — 12 floats
// each (cx,cy,cz, 0,yaw,0, sx,sy,sz, r,g,b), the SAME layout pushBoxInstance batches
// and the bake's worldGeometry emits. The loader iso pane (LIVEHOST req_1798) pushes
// these to world_loader as a LIVE render overlay, so a just-placed piece appears as a
// real solid mesh instantly with no full rebake. Ramps/gables approximate as their box
// (the exact keyed geometry lands on the next Compile). PARTS props decompose to the
// same primitive parts the bake lowers, so they too show instantly; only MESH props
// (imported genmesh / Studio-cooked) are skipped here — they carry real mesh assets and
// render through the resident-mesh reference path (Layer 2), not a placeholder box.
export function pieceInstanceRows(pieces: readonly PlacedBuildPiece[]): Float32Array {
  const rows: number[] = [];
  for (const piece of pieces) {
    const prop = propFromPiece(piece);
    if (prop) {
      if (isImportedPropKind(prop.kind) || isCookedPropKind(prop.kind)) continue;
      pushPropPartRows(rows, prop);
      continue;
    }
    const sig = wallJoinSignature(piece, pieces) ?? '';
    for (const shape of pieceVisualShapes(piece, sig, pieces)) {
      if (shape.kind === 'ramp') {
        const r = shape.ramp;
        const rgb = rgbOf(r.color);
        rows.push(r.x, r.y + r.height / 2, r.z, 0, r.yawDegrees, 0, r.width, r.height, r.depth, rgb[0], rgb[1], rgb[2]);
      } else {
        const b = shape.box;
        const rgb = rgbOf(b.color);
        rows.push(b.cx, b.cy, b.cz, 0, b.yawDegrees, 0, b.sx, b.sy, b.sz, rgb[0], rgb[1], rgb[2]);
      }
    }
  }
  return new Float32Array(rows);
}

// FNV-1a 32-bit — MUST match world_loader.liveMeshHash so a mesh kind's key hashes the
// same on both sides of the door. charCodeAt == byte for the ASCII keys we hash (content
// hashes / asset ids). Math.imul keeps it 32-bit like the Zig u32 wrap.
function fnv1aHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// The resident-mesh KEY for a mesh-prop kind, identical to what the bake assigns the
// gamefile mesh: imported genmesh props key by their generated mesh key; Studio-cooked
// props by the cooked asset's meshRef (worldGeometry.cookedPropMesh ships `key: asset.meshRef`).
// Null ⇒ not a mesh prop (a parts/recipe prop, or unknown kind).
export function meshPropKeyForKind(kind: string): string | null {
  if (isImportedPropKind(kind)) return importedPropMesh(kind)?.key ?? null;
  if (isCookedPropKind(kind)) return cookedAssetById(kind)?.meshRef ?? null;
  return null;
}

// LIVEMESH ref layout (variable stride): a 24-byte header — u32 keyHash, f32 x,y,z,yaw,
// u32 matCount — then matCount × u32 matHash, ONE per loader texture slot (0 = that slot
// wears the mesh's own baked atlas). matCount 0 = the whole mesh on its baked texture (the
// ghost / a brand-new unskinned placement). Per-slot mats (req_2025) let a multi-slot cooked
// prop wear each slot's own skin in the editor pane instead of the FIRST skin smeared over
// every face — matching what the compiled bake's slotMaterials already does. Each matHash
// references a live material pushed via __compiled_world_set_live_material (LIVESKIN req_1843).
const MESH_REF_HEADER_BYTES = 24;

// Pack ONE live mesh ref (header + per-slot mats) — the layout world_loader.setLiveMeshProps
// decodes. `mats` is empty for the ghost / an unskinned placement (whole mesh, baked tex).
function packMeshRef(hash: number, x: number, y: number, z: number, yaw: number, mats: readonly number[]): Uint8Array {
  const buf = new ArrayBuffer(MESH_REF_HEADER_BYTES + mats.length * 4);
  const dv = new DataView(buf);
  dv.setUint32(0, hash, true);
  dv.setFloat32(4, x, true);
  dv.setFloat32(8, y, true);
  dv.setFloat32(12, z, true);
  dv.setFloat32(16, yaw, true);
  dv.setUint32(20, mats.length, true);
  for (let i = 0; i < mats.length; i += 1) dv.setUint32(MESH_REF_HEADER_BYTES + i * 4, mats[i], true);
  return new Uint8Array(buf);
}

// The placement-GHOST ref for an armed mesh-prop kind at a snap target (LIVEMESH req_1841):
// null when the kind has no resident mesh (parts prop / unknown) — the caller then clears
// the ghost and the projected wireframe stands alone. An unplaced prop wears no skin yet,
// so the ghost always references the baked texture (matHash 0).
export function meshGhostRef(propKind: string, x: number, y: number, z: number, yaw: number): Uint8Array | null {
  const key = meshPropKeyForKind(propKind);
  if (!key) return null;
  return packMeshRef(fnv1aHash(key), x, y, z, yaw, []);
}

// A procedural-shader skin to materialize live on the loader (LIVESKIN req_1843): keyed by
// hash, carries the WGSL recipe + tuned data the loader compiles into a 1-tile texture.
export interface LiveMaterial { hash: number; wgsl: string; data: number[]; opacity: number }
export interface LiveMeshPush { refs: Uint8Array; materials: LiveMaterial[] }

// Materialize ONE procedural skin id into a live material (interned by hash), returning the
// hash a live mesh ref then wears (0 = not a live-renderable skin → that slot stays on its
// baked atlas). Decal/image/flat skins aren't procedural, so they resolve to 0 and wait for
// Compile — the SAME rule the whole-prop path used.
function liveSkinHash(matId: string | undefined, materials: Map<number, LiveMaterial>): number {
  const shader = matId ? resolveMaterialShader(matId) : null;
  if (!matId || !shader) return 0;
  const hash = fnv1aHash(`${matId}:${shader.data.join(',')}`);
  if (!materials.has(hash)) materials.set(hash, { hash, wgsl: shader.wgsl, data: shader.data, opacity: shader.opacity });
  return hash;
}

// PER-SLOT live skins (req_2025): a cooked prop's skin lives PER TEXTURE SLOT, not whole-prop.
// Resolve each of the asset's texture slots (in the SAME order the loader's mesh.slots carries
// them — texture slots first) to its live material hash, keyed by partTextures[slot.id] exactly
// as the compiled bake's slotMaterials does. Returns null for a prop with no texture slots
// (imported / single-surface cooked) — the caller falls back to the whole-prop single skin.
function propSlotMaterials(prop: WorldProp, materials: Map<number, LiveMaterial>): number[] | null {
  if (!isCookedPropKind(prop.kind)) return null;
  const slots = cookedAssetById(prop.kind)?.slots;
  if (!slots || slots.length === 0) return null;
  const pt = prop.partTextures;
  return slots.map((slot) => liveSkinHash(pt?.[slot.id], materials));
}

// The whole-prop skin fallback (LIVESKIN req_1843): a prop with no per-slot texture slots
// (imported / single-surface) — the first applied part texture stands for the whole prop.
function wholePropMaterialId(prop: WorldProp): string | null {
  const pt = prop.partTextures;
  if (!pt) return null;
  for (const k of Object.keys(pt)) if (pt[k]) return pt[k];
  return null;
}

// A stable signature of a piece's applied face-skins (RESKIN req_1845) — so the loader pane
// can tell a prop re-skinned since the bake from one still wearing its baked look.
export function pieceSkinSig(piece: PlacedBuildPiece): string {
  return JSON.stringify(piece.partTextures ?? {});
}

// Live MESH-prop references + the skin materials they need (LIVEMESH req_1812 + LIVESKIN
// req_1843 + RESKIN req_1845 + HOTSURVIVE req_1851). Pass the FULL current piece set + a
// snapshot of each baked piece's skin signature (absent id ⇒ a brand-new placement). A mesh
// prop is pushed live when it is brand-new (geometry overlay) OR it WEARS A PROCEDURAL SKIN we
// can materialize live — the loader then hides the stale baked copy. The skin case is
// deliberately BASELINE-FREE: a procedurally-skinned prop always renders its current skin live,
// so the preview reconstructs from the SAVED edit and survives a hot re-mount (the prior diff
// against a mount-seeded "what's baked" baseline silently dropped the skin after any hot reload,
// because the re-mount re-seeded that baseline to the already-skinned state). A baked prop with
// no live-renderable skin is left to the baked render; decal/image/flat skins wait for Compile.
export function meshPropLivePush(pieces: readonly PlacedBuildPiece[], bakedSig: ReadonlyMap<string, string>): LiveMeshPush {
  const refs: { hash: number; x: number; y: number; z: number; yaw: number; mats: number[] }[] = [];
  const materials = new Map<number, LiveMaterial>();
  for (const piece of pieces) {
    const prop = propFromPiece(piece);
    if (!prop) continue;
    const key = meshPropKeyForKind(prop.kind);
    if (!key) continue;
    const isPending = !bakedSig.has(piece.id); // a brand-new placement (geometry overlay)
    // PER-SLOT (req_2025): a cooked prop resolves one live skin per texture slot; a no-slot
    // prop (imported / single-surface) falls back to the first applied skin smeared whole.
    const slotMats = propSlotMaterials(prop, materials);
    const wholeMat = slotMats ? 0 : liveSkinHash(wholePropMaterialId(prop) ?? undefined, materials);
    const hasLiveSkin = slotMats ? slotMats.some((m) => m !== 0) : wholeMat !== 0;
    if (!isPending && !hasLiveSkin) continue; // existing prop, no live-renderable skin → baked render is correct
    // No live skin (a brand-new unskinned placement) ⇒ empty mats = whole mesh on its baked
    // atlas (the cheap, per-face-correct path). A live skin ⇒ the per-slot array (or [wholeMat]
    // for a no-slot prop) so each slot wears its own skin instead of one smeared over all faces.
    const mats = hasLiveSkin ? (slotMats ?? [wholeMat]) : [];
    refs.push({ hash: fnv1aHash(key), x: prop.x, y: prop.y ?? 0, z: prop.z, yaw: prop.yawDegrees ?? 0, mats });
  }
  let total = 0;
  for (const r of refs) total += MESH_REF_HEADER_BYTES + r.mats.length * 4;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  let o = 0;
  for (const r of refs) {
    dv.setUint32(o, r.hash, true);
    dv.setFloat32(o + 4, r.x, true);
    dv.setFloat32(o + 8, r.y, true);
    dv.setFloat32(o + 12, r.z, true);
    dv.setFloat32(o + 16, r.yaw, true);
    dv.setUint32(o + 20, r.mats.length, true);
    o += MESH_REF_HEADER_BYTES;
    for (const m of r.mats) { dv.setUint32(o, m, true); o += 4; }
  }
  return { refs: new Uint8Array(buf), materials: [...materials.values()] };
}

// ── BUILDING-PIECE live skins (LIVEBLDSKIN req_1849) ────────────────────────
// A material skin on a building-piece face becomes a face-slab VisualBox carrying
// textureKey 'bldskin:<id>' (pieceShapes.visualLook). Unlike props (one mesh node each),
// building pieces are BATCHED instanced draws — you can't toggle one baked instance off.
// So a procedurally-skinned face renders as a live textured box OUTSET a hair to cover the
// baked face-slab cleanly (no z-fight, no batch surgery). Baseline-free like the prop skin
// path, so it survives hot reloads and covers existing pieces. 32 bytes/box: cx,cy,cz,
// sx,sy,sz, yawDeg (f32), matHash (u32) — the loader scales the cube + outsets it.
const SKIN_BOX_BYTES = 32;
const BLDSKIN_PREFIX = 'bldskin:';

// PERF req_1870: a piece can only produce a 'bldskin:' face-slab if one of its faces wears a
// MATERIAL skin (a flat-colour or unskinned face never does). Checking piece.skin is O(1) and
// lets us skip the expensive wallJoinSignature + pieceVisualShapes decomposition for the vast
// majority of pieces — without it, EVERY placement re-decomposed every wall/floor on the map
// (~O(N²) via the neighbour join scan), which made each placement take 5-6s.
function pieceHasMaterialSkin(piece: PlacedBuildPiece): boolean {
  const skin = piece.skin;
  if (!skin) return false;
  for (const slot of Object.keys(skin)) {
    const face = (skin as Record<string, { kind?: string } | undefined>)[slot];
    if (face && face.kind === 'material') return true;
  }
  return false;
}

export interface LiveSkinPush { boxes: Uint8Array; materials: LiveMaterial[] }
export function buildingSkinBoxes(pieces: readonly PlacedBuildPiece[]): LiveSkinPush {
  const out: { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number; yaw: number; matHash: number }[] = [];
  const materials = new Map<number, LiveMaterial>();
  for (const piece of pieces) {
    if (propFromPiece(piece)) continue; // props ride meshPropLivePush
    if (!pieceHasMaterialSkin(piece)) continue; // cheap skip — no material face → no live skin box
    const sig = wallJoinSignature(piece, pieces) ?? '';
    for (const shape of pieceVisualShapes(piece, sig, pieces)) {
      if (shape.kind !== 'box') continue; // skinned ramps deferred
      const tk = shape.box.textureKey;
      if (!tk || !tk.startsWith(BLDSKIN_PREFIX)) continue;
      const shader = resolveMaterialShader(tk.slice(BLDSKIN_PREFIX.length));
      if (!shader) continue; // non-procedural (decal/flat) skin — leave to baked/Compile
      const matHash = fnv1aHash(`${tk}:${shader.data.join(',')}`);
      if (!materials.has(matHash)) materials.set(matHash, { hash: matHash, wgsl: shader.wgsl, data: shader.data, opacity: shader.opacity });
      const b = shape.box;
      out.push({ cx: b.cx, cy: b.cy, cz: b.cz, sx: b.sx, sy: b.sy, sz: b.sz, yaw: b.yawDegrees, matHash });
    }
  }
  const buf = new ArrayBuffer(out.length * SKIN_BOX_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  out.forEach((b, i) => {
    const o = i * 8;
    f[o] = b.cx;
    f[o + 1] = b.cy;
    f[o + 2] = b.cz;
    f[o + 3] = b.sx;
    f[o + 4] = b.sy;
    f[o + 5] = b.sz;
    f[o + 6] = b.yaw;
    u[o + 7] = b.matHash;
  });
  return { boxes: new Uint8Array(buf), materials: [...materials.values()] };
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
      boxes += def.kind === 'stairs' ? GAME_BUILD.placed.tuning.stairVisualSteps : 1;
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
      // ramps AND gable-end prisms carry their own keyed geometry — they can't
      // ride the unit-box instance bucket, so they fall out to individual meshes.
      if (shape.kind === 'ramp' || shape.kind === 'gable' || opacityOverride !== undefined || (baseOpacity !== undefined && baseOpacity < 1)) {
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
