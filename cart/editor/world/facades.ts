// world/facades.ts — the graffiti facade model (req_3018 / req_3057).
//
// A facade is ONE meter-true paint canvas spanning every coplanar, contiguous
// wall piece around a seed: right-click a wall → Paint Facade → the whole run
// opens flat in the painter at the RULED ambient density (256 px/m, req_3020).
// Storage per the paint-program ruling: strokes + stamp rows, never pixels —
// the canvas is replayed through the host paintable ops (GPU dabs) and stamps
// blit at bake, then the readback bakes to ONE resident-mesh quad floated a
// hair off the wall plane. Unpainted texels keep alpha 0, so the quad shows
// exactly the paint and nothing else.
import type { PlacedPiece } from './pieces';
import { pieceKindOf, pieceLook } from './pieces';

/** RULED ambient graffiti density (req_3020 — the user picked 256 from the
 *  rendered density comparison). */
export const FACADE_TEXELS_PER_METER = 256;
/** The quad floats a hair off the wall so the wall (and its face skins at
 *  8mm) never z-fight the paint. */
export const FACADE_LIFT_METERS = 0.012;
/** Two piece faces this close (meters) count as one continuous surface. */
const COPLANAR_EPS = 0.15;
const TOUCH_EPS = 0.06;

/** One spray stroke, in facade meters (u across, v UP from the canvas base). */
export type FacadeStroke = {
  hex: string;
  radiusMeters: number;
  /** interleaved u,v points along the drag. */
  points: number[];
};

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
  strokes: FacadeStroke[];
  stamps: FacadeStamp[];
};

/** The horizontal canvas axis: normal rotated -90° in the ground plane, so
 *  u runs left→right when looking AT the face. */
export function facadeUDir(normal: { x: number; z: number }): { x: number; z: number } {
  return { x: normal.z, z: -normal.x };
}

const DEG = Math.PI / 180;

/** A piece's front-face plane in the ground plane: outward normal (local +z
 *  under the pieceShapes yaw frame) + its rect along the face. Null for kinds
 *  a facade can't cover (plates, props, slotless meshes keep their own paint). */
function wallFace(piece: PlacedPiece): { normal: { x: number; z: number }; offset: number; u0: number; u1: number; v0: number; v1: number } | null {
  const kind = pieceKindOf(piece.pieceId);
  if (kind !== 'wall' && kind !== 'arch' && kind !== 'fence' && kind !== 'railing') return null;
  const look = pieceLook(piece.pieceId);
  if (!look) return null;
  const yaw = piece.yawDegrees * DEG;
  const normal = { x: Math.sin(yaw), z: Math.cos(yaw) };
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

/** Whether two face rects touch (or overlap) on the shared plane. */
function rectsTouch(a: { u0: number; u1: number; v0: number; v1: number }, b: { u0: number; u1: number; v0: number; v1: number }): boolean {
  return a.u0 <= b.u1 + TOUCH_EPS && b.u0 <= a.u1 + TOUCH_EPS
    && a.v0 <= b.v1 + TOUCH_EPS && b.v0 <= a.v1 + TOUCH_EPS;
}

/** Gather the facade around a seed piece: every wall-family piece whose front
 *  plane matches the seed's (same facing mod 180°, same offset within a wall
 *  thickness) and whose face rect is contiguous with the growing set. The
 *  union rect becomes the canvas. Null = the seed has no facade face. */
export function gatherFacade(seed: PlacedPiece, pieces: readonly PlacedPiece[], id: string): Facade | null {
  const seedFace = wallFace(seed);
  if (!seedFace) return null;
  const n = seedFace.normal;
  type Cand = { piece: PlacedPiece; rect: { u0: number; u1: number; v0: number; v1: number } };
  const candidates: Cand[] = [];
  for (const piece of pieces) {
    const face = wallFace(piece);
    if (!face) continue;
    // Same facing (mod 180): a wall run alternates 0/180 yaws freely.
    const align = face.normal.x * n.x + face.normal.z * n.z;
    if (Math.abs(align) < 0.999) continue;
    // Same plane, regardless of which way this piece's front points.
    const offset = align > 0 ? face.offset : -face.offset;
    if (Math.abs(offset - seedFace.offset) > COPLANAR_EPS) continue;
    // Express the rect on the SEED's u axis (a 180° piece scans reversed).
    const u = facadeUDir(n);
    const centeredU = piece.x * u.x + piece.z * u.z;
    const look = pieceLook(piece.pieceId);
    if (!look) continue;
    candidates.push({
      piece,
      rect: { u0: centeredU - look.w / 2, u1: centeredU + look.w / 2, v0: piece.y, v1: piece.y + look.h },
    });
  }
  // BFS contiguity from the seed.
  const seedIdx = candidates.findIndex((c) => c.piece.id === seed.id);
  if (seedIdx < 0) return null;
  const taken = new Set<number>([seedIdx]);
  const queue = [seedIdx];
  while (queue.length) {
    const i = queue.pop()!;
    for (let j = 0; j < candidates.length; j += 1) {
      if (taken.has(j)) continue;
      if (rectsTouch(candidates[i]!.rect, candidates[j]!.rect)) {
        taken.add(j);
        queue.push(j);
      }
    }
  }
  const members = [...taken].map((i) => candidates[i]!);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const m of members) {
    u0 = Math.min(u0, m.rect.u0); u1 = Math.max(u1, m.rect.u1);
    v0 = Math.min(v0, m.rect.v0); v1 = Math.max(v1, m.rect.v1);
  }
  const u = facadeUDir(n);
  // origin = bottom-left world point ON the plane, lifted along the normal at bake.
  const origin = {
    x: u.x * u0 + n.x * seedFace.offset,
    y: v0,
    z: u.z * u0 + n.z * seedFace.offset,
  };
  return {
    id,
    origin,
    normal: { x: n.x, z: n.z },
    widthMeters: u1 - u0,
    heightMeters: v1 - v0,
    pieceIds: members.map((m) => m.piece.id),
    strokes: [],
    stamps: [],
  };
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

export function validFacade(value: unknown): value is Facade {
  const f = value as Partial<Facade> | null;
  if (!f || typeof f.id !== 'string') return false;
  if (!f.origin || !finite(f.origin.x) || !finite(f.origin.y) || !finite(f.origin.z)) return false;
  if (!f.normal || !finite(f.normal.x) || !finite(f.normal.z)) return false;
  if (!finite(f.widthMeters) || !finite(f.heightMeters) || f.widthMeters <= 0 || f.heightMeters <= 0) return false;
  if (!Array.isArray(f.pieceIds) || !f.pieceIds.every((p) => typeof p === 'string')) return false;
  if (!Array.isArray(f.strokes) || !f.strokes.every((s) =>
    typeof s.hex === 'string' && finite(s.radiusMeters) && Array.isArray(s.points) && s.points.every(finite))) return false;
  if (!Array.isArray(f.stamps) || !f.stamps.every((s) =>
    typeof s.stickerId === 'string' && finite(s.u) && finite(s.v) && finite(s.scale) && finite(s.rotDegrees))) return false;
  return true;
}
