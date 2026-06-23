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
import { propDynamics } from '../../game/kinds/props';
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
// into the wall-end corner square, and a signed sz mirrors the diagonal when a
// reflected corner is needed.
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
    g.face(b1, b2, t2, t1, Geometry.normalize(1, 0, 1), [0, 0]);
    g.face(b2, b0, t0, t2, [-1, 0, 0], [0, 0]);
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
    g.face(b1, b2, t2, t1, Geometry.normalize(1, 0, -1), [0, 0]);
    g.face(b2, b0, t0, t2, [-1, 0, 0], [0, 0]);
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
