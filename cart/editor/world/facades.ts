// world/facades.ts — the graffiti facade model (req_3018 / req_3057).
//
// A facade is ONE meter-true paint canvas spanning an explicitly selected set
// of coplanar wall pieces. The author's explicit selection is always the
// facade scope (req_3062).
// Storage per the paint-program ruling: strokes + stamp rows, never pixels —
// the canvas is replayed through the host paintable ops (GPU dabs) and stamps
// blit at bake, then the readback bakes to ONE resident-mesh quad floated a
// hair off the wall plane. Unpainted texels keep alpha 0, so the quad shows
// exactly the paint and nothing else.
import type { PlacedPiece } from './pieces';
import { pieceKindOf, pieceLook } from './pieces';
import { BLEND_MODES, BRUSH_SHAPES, type BlendMode, type PaintInk, type StampSource } from '../../../runtime/paint/model';

/** RULED ambient graffiti density (req_3020 — the user picked 256 from the
 *  rendered density comparison). */
export const FACADE_TEXELS_PER_METER = 256;
/** The quad floats a hair off the wall so the wall (and its face skins at
 *  8mm) never z-fight the paint. */
export const FACADE_LIFT_METERS = 0.012;
/** Two piece faces this close (meters) count as one continuous surface. */
const COPLANAR_EPS = 0.15;

export type FacadePaintTool = 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse';

/** The universal Brush recipe expressed in facade-space units. `sizeMeters`
 *  makes a stroke resolution-independent; replay converts it to target texels. */
export type FacadeBrushRecipe = {
  stamp: StampSource;
  sizeMeters: number;
  hardness: number;
  flow: number;
  scatter: number;
  angleDeg: number;
  aspect: number;
  spacing: number;
  blend: BlendMode;
};

/** Selection masks are part of the stroke program: replaying after a restart
 *  must clip the same pixels the author saw. Points are facade meters. */
export type FacadeStrokeSelection = {
  kind: 'marquee' | 'lasso';
  points: number[];
};

/** One full studio-painter stroke, in facade meters (u across, v UP). */
export type FacadeStroke = {
  ink: PaintInk;
  brush: FacadeBrushRecipe;
  tool: FacadePaintTool;
  /** interleaved u,v points along the drag. */
  points: number[];
  selection?: FacadeStrokeSelection;
};

export type FacadeLayer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  strokes: FacadeStroke[];
};

export const DEFAULT_FACADE_LAYER_ID = 'layer-1';

export function defaultFacadeLayer(): FacadeLayer {
  return { id: DEFAULT_FACADE_LAYER_ID, name: 'Layer 1', visible: true, opacity: 1, strokes: [] };
}

/** One sticker stamp — free rotation, the paint level has no quarter-turn limit. */
export type FacadeStamp = {
  stickerId: string;
  u: number;
  v: number;
  scale: number;
  rotDegrees: number;
};

export type Facade = {
  id: string;
  /** world point of the canvas bottom-left corner. */
  origin: { x: number; y: number; z: number };
  /** outward face normal in the ground plane (unit). uDir derives from it. */
  normal: { x: number; z: number };
  widthMeters: number;
  heightMeters: number;
  /** the placed pieces whose faces this canvas covers (report only — the
   *  canvas is plane-anchored, so a later piece edit never shears the art). */
  pieceIds: string[];
  layers: FacadeLayer[];
  activeLayerId: string;
  /** req_3057 migration only. New strokes always live inside `layers`; old
   *  saves keep their simplified spray rows readable until next edit. */
  strokes?: LegacyFacadeStroke[];
  stamps: FacadeStamp[];
};

export type LegacyFacadeStroke = { hex: string; radiusMeters: number; points: number[] };

/** The horizontal canvas axis: normal rotated -90° in the ground plane, so
 *  u runs left→right when looking AT the face. */
export function facadeUDir(normal: { x: number; z: number }): { x: number; z: number } {
  return { x: normal.z, z: -normal.x };
}

const DEG = Math.PI / 180;

/** A piece's chosen face plane in the ground plane: outward normal (local +z
 *  under the pieceShapes yaw frame) + its rect along the face. Null for kinds
 *  a facade can't cover (plates, props, slotless meshes keep their own paint). */
function wallFace(piece: PlacedPiece, side: 'front' | 'back' = 'front'): { normal: { x: number; z: number }; offset: number; u0: number; u1: number; v0: number; v1: number } | null {
  const kind = pieceKindOf(piece.pieceId);
  if (kind !== 'wall' && kind !== 'arch' && kind !== 'fence' && kind !== 'railing') return null;
  const look = pieceLook(piece.pieceId);
  if (!look) return null;
  const yaw = piece.yawDegrees * DEG;
  const frontNormal = { x: Math.sin(yaw), z: Math.cos(yaw) };
  // Negating both terms preserves the plane while making origin/uDir describe
  // the face the author actually clicked.
  const normal = side === 'front' ? frontNormal : { x: -frontNormal.x, z: -frontNormal.z };
  const u = facadeUDir(normal);
  const cu = piece.x * u.x + piece.z * u.z;
  return {
    normal,
    offset: piece.x * normal.x + piece.z * normal.z,
    u0: cu - look.w / 2,
    u1: cu + look.w / 2,
    v0: piece.y,
    v1: piece.y + look.h,
  };
}

type FaceRect = { u0: number; u1: number; v0: number; v1: number };
type FacadeMember = { piece: PlacedPiece; rect: FaceRect };

function facadeFromMembers(members: readonly FacadeMember[], normal: { x: number; z: number }, planeOffset: number, id: string): Facade | null {
  if (!members.length) return null;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const member of members) {
    u0 = Math.min(u0, member.rect.u0); u1 = Math.max(u1, member.rect.u1);
    v0 = Math.min(v0, member.rect.v0); v1 = Math.max(v1, member.rect.v1);
  }
  if (![u0, u1, v0, v1].every(Number.isFinite) || u1 <= u0 || v1 <= v0) return null;
  const u = facadeUDir(normal);
  const base = defaultFacadeLayer();
  return {
    id,
    origin: {
      x: u.x * u0 + normal.x * planeOffset,
      y: v0,
      z: u.z * u0 + normal.z * planeOffset,
    },
    normal: { x: normal.x, z: normal.z },
    widthMeters: u1 - u0,
    heightMeters: v1 - v0,
    pieceIds: members.map((member) => member.piece.id),
    layers: [base],
    activeLayerId: base.id,
    stamps: [],
  };
}

/** Build ONE facade from exactly the selected pieces. Every selected piece must
 *  expose a wall-family face on the same plane (facing may differ by 180°).
 *  Gaps are allowed: the author selected the scope and its union rect is the
 *  meter-true canvas. */
export function facadeFromSelection(pieces: readonly PlacedPiece[], id: string, side: 'front' | 'back' = 'front'): Facade | null {
  const selected = pieces.filter((piece, index) => pieces.findIndex((candidate) => candidate.id === piece.id) === index);
  const first = selected[0];
  if (!first) return null;
  const seedFace = wallFace(first, side);
  if (!seedFace) return null;
  const n = seedFace.normal;
  const u = facadeUDir(n);
  const members: FacadeMember[] = [];
  for (const piece of selected) {
    const face = wallFace(piece, side);
    const look = pieceLook(piece.pieceId);
    if (!face || !look) return null;
    const align = face.normal.x * n.x + face.normal.z * n.z;
    if (Math.abs(align) < 0.999) return null;
    const offset = align > 0 ? face.offset : -face.offset;
    if (Math.abs(offset - seedFace.offset) > COPLANAR_EPS) return null;
    const centeredU = piece.x * u.x + piece.z * u.z;
    members.push({ piece, rect: { u0: centeredU - look.w / 2, u1: centeredU + look.w / 2, v0: piece.y, v1: piece.y + look.h } });
  }
  return facadeFromMembers(members, n, seedFace.offset, id);
}

/** New layer model, with a lossless adapter for req_3057's old spray rows. */
export function facadeLayers(facade: Facade): FacadeLayer[] {
  if (Array.isArray(facade.layers) && facade.layers.length) return facade.layers;
  const legacy = Array.isArray(facade.strokes) ? facade.strokes : [];
  return [{
    ...defaultFacadeLayer(),
    strokes: legacy.map((stroke) => ({
      ink: { kind: 'color', hex: stroke.hex },
      brush: {
        stamp: { kind: 'analytic', shape: 'spray' },
        sizeMeters: stroke.radiusMeters * 2,
        hardness: 0.55,
        flow: 0.85,
        scatter: 1.1,
        angleDeg: 0,
        aspect: 1,
        spacing: 0.25,
        blend: 'normal',
      },
      tool: 'brush',
      points: stroke.points.slice(),
    })),
  }];
}

/** Canvas pixel size for a facade at the ruled density. */
export function facadeCanvasSize(f: Facade): { w: number; h: number } {
  return {
    w: Math.max(2, Math.round(f.widthMeters * FACADE_TEXELS_PER_METER)),
    h: Math.max(2, Math.round(f.heightMeters * FACADE_TEXELS_PER_METER)),
  };
}

/** The facade's baked quad as a stride-8 resident mesh (pos3+normal3+uv2),
 *  in WORLD coordinates so its ref places at the origin with yaw 0 — the
 *  facade plane is already fully described by origin/normal. Two-sided (the
 *  reverse shows through open buildings mirrored, exactly like painted glass).
 *  v=0 at the canvas TOP (the cube/UVFLIP-0610 convention). */
export function facadeQuadMesh(f: Facade): Float32Array {
  const u = facadeUDir(f.normal);
  const lift = FACADE_LIFT_METERS;
  const ox = f.origin.x + f.normal.x * lift;
  const oy = f.origin.y;
  const oz = f.origin.z + f.normal.z * lift;
  const W = f.widthMeters, H = f.heightMeters;
  // corners: BL, BR, TR, TL (world), uv per cube convention (v flipped).
  const corners: [number, number, number, number, number][] = [
    [ox, oy, oz, 0, 1],
    [ox + u.x * W, oy, oz + u.z * W, 1, 1],
    [ox + u.x * W, oy + H, oz + u.z * W, 1, 0],
    [ox, oy + H, oz, 0, 0],
  ];
  const front = [0, 1, 2, 0, 2, 3];
  const back = [1, 0, 3, 1, 3, 2];
  const out = new Float32Array(12 * 8);
  let i = 0;
  const emit = (ci: number, nx: number, nz: number) => {
    const c = corners[ci]!;
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2];
    out[i + 3] = nx; out[i + 4] = 0; out[i + 5] = nz;
    out[i + 6] = c[3]; out[i + 7] = c[4];
    i += 8;
  };
  for (const ci of front) emit(ci, f.normal.x, f.normal.z);
  for (const ci of back) emit(ci, -f.normal.x, -f.normal.z);
  return out;
}

// ── validation (worldStore rides this) ────────────────────────────────────────

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function finiteList(v: unknown): v is number[] {
  return Array.isArray(v) && v.length % 2 === 0 && v.every(finite);
}

function validInk(value: unknown): value is PaintInk {
  const ink = value as PaintInk | null;
  if (!ink || typeof ink !== 'object') return false;
  if (ink.kind === 'color') return typeof ink.hex === 'string' && ink.hex.length > 0;
  if (ink.kind === 'texture') return typeof ink.key === 'string' && ink.key.length > 0;
  return ink.kind === 'shader' && typeof ink.surface === 'string' && ink.surface.length > 0
    && (ink.data === undefined || (Array.isArray(ink.data) && ink.data.every(finite)))
    && (ink.tiles === undefined || (finite(ink.tiles) && ink.tiles > 0));
}

function validStampSource(value: unknown): value is StampSource {
  const stamp = value as StampSource | null;
  if (!stamp || typeof stamp !== 'object') return false;
  if (stamp.kind === 'analytic') return BRUSH_SHAPES.includes(stamp.shape);
  if (stamp.kind === 'mask') return typeof stamp.stampKey === 'string' && stamp.stampKey.length > 0;
  if (stamp.kind === 'texture') return typeof stamp.textureKey === 'string' && stamp.textureKey.length > 0;
  return stamp.kind === 'shader' && typeof stamp.surface === 'string' && stamp.surface.length > 0;
}

function validStroke(value: unknown): value is FacadeStroke {
  const stroke = value as FacadeStroke | null;
  const brush = stroke?.brush;
  if (!stroke || !validInk(stroke.ink) || !brush || !validStampSource(brush.stamp)) return false;
  if (!['brush', 'eraser', 'line', 'rect', 'ellipse'].includes(stroke.tool)) return false;
  if (!finite(brush.sizeMeters) || brush.sizeMeters <= 0
    || !finite(brush.hardness) || brush.hardness < 0 || brush.hardness > 1
    || !finite(brush.flow) || brush.flow < 0 || brush.flow > 1
    || !finite(brush.scatter) || brush.scatter < 0
    || !finite(brush.angleDeg) || !finite(brush.aspect) || brush.aspect <= 0
    || !finite(brush.spacing) || brush.spacing <= 0
    || !BLEND_MODES.includes(brush.blend) || !finiteList(stroke.points) || stroke.points.length < 2) return false;
  if (stroke.selection !== undefined) {
    const minimumPoints = stroke.selection.kind === 'lasso' ? 6 : 4;
    if (!stroke.selection || !['marquee', 'lasso'].includes(stroke.selection.kind)
      || !finiteList(stroke.selection.points) || stroke.selection.points.length < minimumPoints) return false;
  }
  return true;
}

function validLayer(value: unknown): value is FacadeLayer {
  const layer = value as FacadeLayer | null;
  return !!layer && typeof layer.id === 'string' && layer.id.length > 0 && typeof layer.name === 'string'
    && typeof layer.visible === 'boolean' && finite(layer.opacity) && layer.opacity >= 0 && layer.opacity <= 1
    && Array.isArray(layer.strokes) && layer.strokes.every(validStroke);
}

export function validFacade(value: unknown): value is Facade {
  const f = value as Partial<Facade> | null;
  if (!f || typeof f.id !== 'string') return false;
  if (!f.origin || !finite(f.origin.x) || !finite(f.origin.y) || !finite(f.origin.z)) return false;
  if (!f.normal || !finite(f.normal.x) || !finite(f.normal.z)) return false;
  if (!finite(f.widthMeters) || !finite(f.heightMeters) || f.widthMeters <= 0 || f.heightMeters <= 0) return false;
  if (!Array.isArray(f.pieceIds) || !f.pieceIds.every((p) => typeof p === 'string')) return false;
  const hasLayers = Array.isArray(f.layers) && f.layers.length > 0 && f.layers.every(validLayer)
    && typeof f.activeLayerId === 'string' && f.layers.some((layer) => layer.id === f.activeLayerId);
  const legacy = Array.isArray(f.strokes) && f.strokes.every((s) =>
    typeof s.hex === 'string' && s.hex.length > 0 && finite(s.radiusMeters) && s.radiusMeters > 0
      && finiteList(s.points) && s.points.length >= 2);
  if (!hasLayers && !legacy) return false;
  if (!Array.isArray(f.stamps) || !f.stamps.every((s) =>
    typeof s.stickerId === 'string' && finite(s.u) && finite(s.v) && finite(s.scale) && finite(s.rotDegrees))) return false;
  return true;
}
