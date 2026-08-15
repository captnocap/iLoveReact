// Wall draw tool: pure gesture state over the integer architecture lattice.
//
// The tool owns clicks, snapping, vertex magnets, and cancellation. It emits at
// most ONE semantic draw-wall command per committed gesture and never touches
// topology, geometry, or the wire — the native engine owns all of that. Every
// structural number here is a whole `u` (16 u = 1 m) or a rejection.
import {
  ARCHITECTURE_UNITS_PER_METER,
  type ArchitectureSource,
  type WallVertex,
} from './architecture';
import type { ArchitectureCatalogEntry, ArchitectureCommand } from './architectureHost';

/** Default endpoint snap: one meter. Fine placement can pass 1 for whole-u snapping. */
export const WALL_SNAP_U = ARCHITECTURE_UNITS_PER_METER;
/** A click this close (in u) to an existing vertex reuses it exactly. */
export const WALL_MAGNET_RADIUS_U = 8;
/** Storeys are 3 m — 48 u. Wall bases sit on their storey; the ghost guide
 * draws one storey tall. */
export const STOREY_HEIGHT_U = 48;
/** Gizmo adjustment laws (req_4479): height snaps to quarter-metres, thickness
 * to whole u. Clamps are generous by ruling — the engine owns real limits. */
export const WALL_HEIGHT_SNAP_U = 4;
export const WALL_HEIGHT_MIN_U = 4;
export const WALL_HEIGHT_MAX_U = 480;
export const WALL_THICKNESS_SNAP_U = 1;
export const WALL_THICKNESS_MIN_U = 1;
export const WALL_THICKNESS_MAX_U = 32;

function snapClamp(raw: number, snap: number, min: number, max: number): number {
  if (!Number.isFinite(raw)) return min;
  return Math.min(max, Math.max(min, Math.round(raw / snap) * snap));
}

export function snapWallHeightU(raw: number): number {
  return snapClamp(raw, WALL_HEIGHT_SNAP_U, WALL_HEIGHT_MIN_U, WALL_HEIGHT_MAX_U);
}

export function snapWallThicknessU(raw: number): number {
  return snapClamp(raw, WALL_THICKNESS_SNAP_U, WALL_THICKNESS_MIN_U, WALL_THICKNESS_MAX_U);
}

export type WallLatticePoint = { xU: number; zU: number };

export type WallDrawGesture =
  | { kind: 'idle' }
  | { kind: 'anchored'; floor: number; start: WallLatticePoint; startMagnetVertexId?: string };

export const IDLE_WALL_GESTURE: WallDrawGesture = Object.freeze({ kind: 'idle' });

export type WallDrawCommit = {
  floor: number;
  start: WallLatticePoint;
  end: WallLatticePoint;
  startMagnetVertexId?: string;
  endMagnetVertexId?: string;
  /** Gizmo-adjusted measurements (req_4479). Absent = the measured style's
   * defaults. Whole u, engine-validated like every structural number. */
  heightU?: number;
  thicknessU?: number;
};

/** Snap a ground-plane pick (meters) onto the integer lattice. Returns null for
 * a non-finite pick — the caller drops the event rather than guessing. */
export function snapWallPoint(xMeters: number, zMeters: number, snapU: number = WALL_SNAP_U): WallLatticePoint | null {
  if (!Number.isFinite(xMeters) || !Number.isFinite(zMeters)) return null;
  if (!Number.isInteger(snapU) || snapU <= 0) return null;
  const xU = Math.round((xMeters * ARCHITECTURE_UNITS_PER_METER) / snapU) * snapU;
  const zU = Math.round((zMeters * ARCHITECTURE_UNITS_PER_METER) / snapU) * snapU;
  if (!Number.isSafeInteger(xU) || !Number.isSafeInteger(zU)) return null;
  return { xU, zU };
}

/** The nearest existing vertex on the floor within the magnet radius, or null.
 * Reusing a vertex is exact endpoint identity — corners and T joins share it. */
export function wallVertexMagnet(
  source: ArchitectureSource,
  floor: number,
  point: WallLatticePoint,
  radiusU: number = WALL_MAGNET_RADIUS_U,
): WallVertex | null {
  let best: WallVertex | null = null;
  let bestDistance = radiusU * radiusU + 1;
  for (const vertex of source.walls.vertices) {
    if (vertex.floor !== floor) continue;
    const dx = vertex.xU - point.xU;
    const dz = vertex.zU - point.zU;
    const distance = dx * dx + dz * dz;
    if (distance <= radiusU * radiusU && distance < bestDistance) {
      best = vertex;
      bestDistance = distance;
    }
  }
  return best;
}

/** First click: anchor the wall start. A magnet hit overrides the snapped point
 * with the vertex's exact position so reuse is identity, never proximity. */
export function beginWallDraw(
  source: ArchitectureSource,
  floor: number,
  point: WallLatticePoint,
): Extract<WallDrawGesture, { kind: 'anchored' }> {
  const magnet = wallVertexMagnet(source, floor, point);
  return {
    kind: 'anchored',
    floor,
    start: magnet ? { xU: magnet.xU, zU: magnet.zU } : point,
    ...(magnet ? { startMagnetVertexId: magnet.id } : {}),
  };
}

export type WallDrawOutcome =
  | { status: 'committed'; commit: WallDrawCommit }
  | { status: 'rejected'; reason: string };

/** Second click: commit the span. A zero-length span rejects here so the host
 * never sees it; everything else is the engine's to validate. */
export function commitWallDraw(
  source: ArchitectureSource,
  gesture: WallDrawGesture,
  point: WallLatticePoint,
): WallDrawOutcome {
  if (gesture.kind !== 'anchored') return { status: 'rejected', reason: 'no wall start is anchored' };
  const magnet = wallVertexMagnet(source, gesture.floor, point);
  const end = magnet ? { xU: magnet.xU, zU: magnet.zU } : point;
  if (end.xU === gesture.start.xU && end.zU === gesture.start.zU) {
    return { status: 'rejected', reason: 'wall start and end are the same point' };
  }
  return {
    status: 'committed',
    commit: {
      floor: gesture.floor,
      start: gesture.start,
      end,
      ...(gesture.startMagnetVertexId ? { startMagnetVertexId: gesture.startMagnetVertexId } : {}),
      ...(magnet ? { endMagnetVertexId: magnet.id } : {}),
    },
  };
}

export type WallPointerRelease =
  | { kind: 'anchor'; gesture: Extract<WallDrawGesture, { kind: 'anchored' }> }
  | { kind: 'commit'; commit: WallDrawCommit }
  | { kind: 'miss'; reason: string };

/** Route one pointer release (req_4474). Both natural gestures resolve here:
 * click-then-click (anchor, then commit at the second release) AND
 * press-drag-release (the whole span in one gesture — down anchors, up
 * commits). A stationary or off-map drag falls back to anchoring, so a jittery
 * click never draws a zero wall and never gets eaten as a camera drag. */
export function wallPointerRelease(
  source: ArchitectureSource,
  floor: number,
  anchor: WallDrawGesture | null,
  downPoint: WallLatticePoint | null,
  upPoint: WallLatticePoint | null,
  dragged: boolean,
): WallPointerRelease {
  if (anchor && anchor.kind === 'anchored') {
    if (!upPoint) return { kind: 'miss', reason: 'release landed off the map' };
    // Re-derive the anchor's magnet against the CURRENT source: a chained
    // anchor (req_4479) sits on a vertex the engine minted AFTER the anchor
    // was taken, and magnetizing it now makes the shared corner exact vertex
    // reuse instead of a coincident twin.
    const rebound = beginWallDraw(source, anchor.floor, anchor.start);
    const outcome = commitWallDraw(source, rebound, upPoint);
    if (outcome.status === 'committed') return { kind: 'commit', commit: outcome.commit };
    return { kind: 'miss', reason: outcome.reason };
  }
  if (!downPoint) return { kind: 'miss', reason: 'click landed off the map' };
  const began = beginWallDraw(source, floor, downPoint);
  if (dragged && upPoint && (upPoint.xU !== began.start.xU || upPoint.zU !== began.start.zU)) {
    const outcome = commitWallDraw(source, began, upPoint);
    if (outcome.status === 'committed') return { kind: 'commit', commit: outcome.commit };
    return { kind: 'miss', reason: outcome.reason };
  }
  return { kind: 'anchor', gesture: began };
}

/** One committed gesture becomes exactly one semantic command. Every structural
 * measurement comes from the SELECTED MEASURED STYLE — the tool contributes only
 * the drawn span. */
export function wallDrawCommand(
  commandId: string,
  expectedRevision: number,
  commit: WallDrawCommit,
  style: ArchitectureCatalogEntry,
): ArchitectureCommand {
  if (style.family !== 'wall' || style.role !== 'style' || !style.wallStyleDefaults) {
    throw new Error(`catalog entry '${style.catalogId}' is not a measured wall style`);
  }
  // The style measures the DEFAULTS; the gizmo may adjust a draw (req_4479).
  const heightU = commit.heightU ?? style.wallStyleDefaults.heightU;
  const thicknessU = commit.thicknessU ?? style.wallStyleDefaults.thicknessU;
  if (!Number.isSafeInteger(heightU) || heightU <= 0) throw new Error(`wall height ${heightU}u is not a positive whole unit`);
  if (!Number.isSafeInteger(thicknessU) || thicknessU <= 0) throw new Error(`wall thickness ${thicknessU}u is not a positive whole unit`);
  return {
    commandId,
    expectedRevision,
    kind: 'drawWall',
    floor: commit.floor,
    start: commit.start,
    end: commit.end,
    ...(commit.startMagnetVertexId ? { startMagnetVertexId: commit.startMagnetVertexId } : {}),
    ...(commit.endMagnetVertexId ? { endMagnetVertexId: commit.endMagnetVertexId } : {}),
    // Slab support arrives with the floor family — until then the base is the
    // storey's absolute height.
    support: { kind: 'absolute', baseYU: commit.floor * STOREY_HEIGHT_U },
    heightU,
    thicknessU,
    profile: style.wallStyleDefaults.profile,
    styleId: style.catalogId,
    sideAMaterialId: style.catalogId,
    sideBMaterialId: style.catalogId,
  };
}
