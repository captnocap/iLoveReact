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
  return {
    commandId,
    expectedRevision,
    kind: 'drawWall',
    floor: commit.floor,
    start: commit.start,
    end: commit.end,
    ...(commit.startMagnetVertexId ? { startMagnetVertexId: commit.startMagnetVertexId } : {}),
    ...(commit.endMagnetVertexId ? { endMagnetVertexId: commit.endMagnetVertexId } : {}),
    // Storeys are 3 m (METERS_PER_LEVEL) = 48 u; slab support arrives with the
    // floor family — until then the base is the storey's absolute height.
    support: { kind: 'absolute', baseYU: commit.floor * 48 },
    heightU: style.wallStyleDefaults.heightU,
    thicknessU: style.wallStyleDefaults.thicknessU,
    profile: style.wallStyleDefaults.profile,
    styleId: style.catalogId,
    sideAMaterialId: style.catalogId,
    sideBMaterialId: style.catalogId,
  };
}
