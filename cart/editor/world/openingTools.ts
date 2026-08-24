// Cut Opening tool: pure laws over the wall-surface lattice.
//
// The tool owns hover snapping, per-edge legality, and the ghost rectangle;
// the ENGINE owns truth (openingSlots enumerates legal anchors, insertOpening
// rejects with typed reasons). These laws only decide what the ghost shows
// between engine calls — a slot the engine listed, or the reason the hovered
// wall can never take this kit (req_4503).

import {
  ARCHITECTURE_UNITS_PER_METER,
  type ArchitectureCatalogEntry,
  type ArchitectureFootprint,
  type ArchitectureSource,
  type WallCell,
  type WallOpeningKind,
  type WallProfile,
} from './architecture';

/** How many placed openings in the source reference this catalog id (req_4725).
 * An export that would RETIRE the id (re-export under a different kind mints a
 * new one, or another lane replaces the declaration wholesale) while this is
 * nonzero orphans those placements and bricks every wall verb with
 * unknown_opening_kit — the exact incident this law exists to refuse. */
export function placedOpeningsReferencing(source: ArchitectureSource, catalogId: string): number {
  let count = 0;
  for (const edge of source.walls.edges) {
    for (const opening of edge.openings) {
      if (opening.kitId === catalogId) count += 1;
    }
  }
  return count;
}

/** Everything the viewport needs from the armed kit — projected once at tool
 * arm from the installed catalog entry, never re-read per frame. */
export type OpeningKitArm = {
  catalogId: string;
  kind: WallOpeningKind;
  label: string;
  footprint: ArchitectureFootprint;
  minimumThicknessU: number;
  permittedProfiles: readonly WallProfile[];
};

function kitArmFromEntry(entry: ArchitectureCatalogEntry): OpeningKitArm | null {
  if (entry.family !== 'wall' || entry.role !== 'opening') return null;
  if (!entry.measurement.footprint || !entry.wallOpeningCompatibility) return null;
  return {
    catalogId: entry.catalogId,
    kind: entry.semanticKind as WallOpeningKind,
    label: entry.label,
    footprint: { ...entry.measurement.footprint },
    minimumThicknessU: entry.wallOpeningCompatibility.minimumThicknessU,
    permittedProfiles: [...entry.wallOpeningCompatibility.permittedProfiles],
  };
}

/** Lattice fill (RULED req_4719: "they scale on the same sub divided grid
 * that walls already have"): the wall cuts whole lattice cells (the kit's
 * outward-rounded footprint), so a kit authored between subdivisions left a
 * sliver of open cut on every side it didn't reach (req_4718's gaps — doors
 * never gapped only because door_001 measures to exact units). The cure is
 * the prop-scale idea baked per kit: a per-axis affine map, in METERS, that
 * stretches the model's mount face onto its own footprint exactly. Depth is
 * deliberately untouched — housing depth stays authored (req_4491). Null for
 * a kit already lattice-exact (identity would be noise) or unmeasurable. */
export function openingLatticeFill(entry: ArchitectureCatalogEntry): { scaleX: number; offsetX: number; scaleY: number; offsetY: number } | null {
  const mount = entry.measurement.mountBoundsU;
  const footprint = entry.measurement.footprint;
  if (!mount || !footprint) return null;
  const spanU = mount.maxU - mount.minU;
  const spanV = mount.maxV - mount.minV;
  if (!(spanU > 0) || !(spanV > 0)) return null;
  const scaleX = (footprint.maxColumnExclusive - footprint.minColumn) / spanU;
  const scaleY = (footprint.maxRowExclusive - footprint.minRow) / spanV;
  const offsetX = (footprint.minColumn - mount.minU * scaleX) / ARCHITECTURE_UNITS_PER_METER;
  const offsetY = (footprint.minRow - mount.minV * scaleY) / ARCHITECTURE_UNITS_PER_METER;
  const identity = Math.abs(scaleX - 1) < 1e-6 && Math.abs(scaleY - 1) < 1e-6
    && Math.abs(offsetX) < 1e-6 && Math.abs(offsetY) < 1e-6;
  return identity ? null : { scaleX, offsetX, scaleY, offsetY };
}

/** The palette tile id for an installed opening kit — the Doors/Windows
 * categories arm THROUGH the palette (req_4513: "the door is cutting into
 * the wall"), never through tool keys. */
export const OPENING_PALETTE_PREFIX = 'opening:';

export function openingPaletteId(catalogId: string): string {
  return `${OPENING_PALETTE_PREFIX}${catalogId}`;
}

export function openingCatalogIdOf(paletteId: string): string | null {
  return paletteId.startsWith(OPENING_PALETTE_PREFIX) ? paletteId.slice(OPENING_PALETTE_PREFIX.length) : null;
}

const DOOR_FAMILY: readonly WallOpeningKind[] = ['door', 'garageDoor', 'slidingDoor', 'arch'];

export type OpeningPaletteEntry = {
  paletteId: string;
  catalogId: string;
  packageId: string;
  label: string;
  kind: WallOpeningKind;
};
export type OpeningPaletteGroup = { key: 'doorKits' | 'windowKits'; label: string; entries: OpeningPaletteEntry[] };

/** Doors and Windows as build categories: every installed opening kit becomes
 * one palette tile, doors-family first. Empty groups are omitted — the palette
 * never shows a dead category. */
export function openingPaletteGroups(entries: readonly ArchitectureCatalogEntry[]): OpeningPaletteGroup[] {
  const doors: OpeningPaletteEntry[] = [];
  const windows: OpeningPaletteEntry[] = [];
  for (const entry of entries) {
    const kit = kitArmFromEntry(entry);
    if (!kit) continue;
    const row: OpeningPaletteEntry = {
      paletteId: openingPaletteId(entry.catalogId),
      catalogId: entry.catalogId,
      packageId: entry.packageId,
      label: entry.label,
      kind: kit.kind,
    };
    (DOOR_FAMILY.includes(kit.kind) ? doors : windows).push(row);
  }
  const groups: OpeningPaletteGroup[] = [];
  if (doors.length) groups.push({ key: 'doorKits', label: 'Doors', entries: doors });
  if (windows.length) groups.push({ key: 'windowKits', label: 'Windows', entries: windows });
  return groups;
}

/** The armed kit by its exact catalog id — what a palette tile arms. */
export function armedOpeningKitById(
  entries: readonly ArchitectureCatalogEntry[],
  catalogId: string,
): OpeningKitArm | null {
  const entry = entries.find((candidate) => candidate.catalogId === catalogId);
  return entry ? kitArmFromEntry(entry) : null;
}

/** The first installed kit of the requested kind — the fallback when the tool
 * activates without a palette choice (action-bar button, harness). Null when
 * nothing of that kind is installed. */
export function armedOpeningKitFromEntries(
  entries: readonly ArchitectureCatalogEntry[],
  kind: WallOpeningKind,
): OpeningKitArm | null {
  const entry = entries.find((candidate) => candidate.family === 'wall'
    && candidate.role === 'opening' && candidate.semanticKind === kind);
  return entry ? kitArmFromEntry(entry) : null;
}

/** The hovered cursor slides the kit ALONG the wall; vertical placement is
 * the SCROLL WHEEL, exactly like a prop's height dial (RULED req_4526 — "keep
 * the behavior the same all the way around"). `preferredRowU` is the wheel's
 * lift above the kit's authored elevation: the legal anchor row nearest it
 * wins (0 = the authored height — a door stands on the floor, a window keeps
 * its modeled sill), then the nearest column to the cursor within that row.
 * The hover's own vertical position never steers (req_4524's ceiling-pinned
 * door). Null when the edge offers no slot at all. */
export function snapOpeningSlot(
  slots: readonly WallCell[],
  columnU: number,
  preferredRowU: number,
): WallCell | null {
  let bestRow = Infinity;
  let bestRowDistance = Infinity;
  for (const slot of slots) {
    const distance = Math.abs(slot.rowU - preferredRowU);
    if (distance < bestRowDistance || (distance === bestRowDistance && slot.rowU < bestRow)) {
      bestRow = slot.rowU;
      bestRowDistance = distance;
    }
  }
  let best: WallCell | null = null;
  let bestDistance = Infinity;
  for (const slot of slots) {
    if (slot.rowU !== bestRow) continue;
    const distance = Math.abs(slot.columnU - columnU);
    if (distance < bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best;
}

export type OpeningWorldPose = { x: number; y: number; z: number; yawDegrees: number };

/** The kit's seat within the wall's depth (RULED req_4491): the wall owns the
 * tunnel at ITS thickness; the kit is a fixed measured asset that mounts flush
 * with its authored facing side. A thicker wall deep-sets the door and the
 * remaining depth reads as wall reveal — nothing stretches, nothing centers. */
export type OpeningSeat = { wallThicknessU: number; kitDepthU: number };

/** Where the kit's MODEL mounts for an anchor on an edge, in world meters —
 * the model's authored origin is the anchor (pivot law), its +X runs along
 * the edge from the start vertex, and facing side 'b' turns it around so the
 * leaf swings toward the side the camera saw. The seat shifts the mount off
 * the wall centerline so the kit sits flush with its facing side (req_4491
 * deep-set law); an exact-fit wall gets offset 0 — the pre-seat pose. The
 * same pose serves the armed mesh ghost and every placed opening's mounted
 * door (req_4526). */
export function openingWorldPose(
  start: { xM: number; zM: number },
  end: { xM: number; zM: number },
  baseYM: number,
  anchor: WallCell,
  facingSide: 'a' | 'b',
  seat: OpeningSeat,
): OpeningWorldPose | null {
  const dx = end.xM - start.xM;
  const dz = end.zM - start.zM;
  const length = Math.hypot(dx, dz);
  if (!(length > 0)) return null;
  const dirX = dx / length;
  const dirZ = dz / length;
  // Loader vertex law: model +X → world (cos yaw, 0, -sin yaw).
  const yawDegrees = (Math.atan2(-dirZ, dirX) * 180) / Math.PI + (facingSide === 'b' ? 180 : 0);
  // Engine side law (wall_geometry.zig): side-a normal = (-dirZ, dirX); side b
  // is its negation. Flush = kit center moved from the centerline toward the
  // facing face by half the surplus depth. Never negative — a too-thin wall
  // was already refused before any pose exists.
  const surplusM = Math.max(0, seat.wallThicknessU - seat.kitDepthU) / (2 * ARCHITECTURE_UNITS_PER_METER);
  const normalSign = facingSide === 'a' ? 1 : -1;
  const offsetX = -dirZ * surplusM * normalSign;
  const offsetZ = dirX * surplusM * normalSign;
  return {
    x: start.xM + dirX * (anchor.columnU / ARCHITECTURE_UNITS_PER_METER) + offsetX,
    y: baseYM + anchor.rowU / ARCHITECTURE_UNITS_PER_METER,
    z: start.zM + dirZ * (anchor.columnU / ARCHITECTURE_UNITS_PER_METER) + offsetZ,
    yawDegrees: ((yawDegrees % 360) + 360) % 360,
  };
}

/** Why the hovered edge can NEVER take this kit — the same three static
 * incompatibilities the engine rejects with typed codes, phrased for the
 * status line. Null means the edge is compatible (a hover may still find no
 * room — that reason comes from the slot enumeration, not from here). */
export function openingEdgeRefusal(
  kit: OpeningKitArm,
  edge: { profile: WallProfile; thicknessU: number; heightU: number },
): string | null {
  if (!kit.permittedProfiles.includes(edge.profile)) {
    return `${kit.label} needs a ${kit.permittedProfiles.join(' or ')} wall — this wall is ${edge.profile}`;
  }
  if (edge.thicknessU < kit.minimumThicknessU) {
    return `wall is ${edge.thicknessU}u thick — ${kit.label} needs at least ${kit.minimumThicknessU}u of housing`;
  }
  const kitHeight = kit.footprint.maxRowExclusive - kit.footprint.minRow;
  if (kitHeight > edge.heightU) {
    return `${kit.label} is ${kitHeight}u tall — taller than this ${edge.heightU}u wall`;
  }
  return null;
}

// ── Placed-opening gizmo laws (req_4738): the prop gizmo brought to a door or
// window standing in a wall. The opening lives on the wall's lattice, so its
// gizmo is the CONSTRAINED cousin of the prop's — slide along the wall, lift
// on it, flip which side it faces. Everything here is pure geometry over the
// persisted source; the viewport projects, the engine keeps final say.

export type OpeningGizmoFrame = {
  edgeId: string;
  openingId: string;
  start: { xM: number; zM: number };
  end: { xM: number; zM: number };
  baseYM: number;
  /** Unit vector along the wall, start → end. */
  dir: { x: number; z: number };
  anchor: WallCell;
  footprint: ArchitectureFootprint;
  edgeLengthU: number;
  edgeHeightU: number;
  facingSide: 'a' | 'b';
};

/** Resolve the selected opening into everything its gizmo needs — or null when
 * the record is gone, the wall is degenerate, or the kit is unmeasured. */
export function openingGizmoFrame(
  source: ArchitectureSource,
  footprints: Readonly<Record<string, ArchitectureFootprint>>,
  edgeId: string,
  openingId: string,
): OpeningGizmoFrame | null {
  const edge = source.walls.edges.find((candidate) => candidate.id === edgeId);
  const opening = edge?.openings.find((candidate) => candidate.id === openingId);
  if (!edge || !opening || edge.support.kind !== 'absolute') return null;
  const startVertex = source.walls.vertices.find((vertex) => vertex.id === edge.startVertexId);
  const endVertex = source.walls.vertices.find((vertex) => vertex.id === edge.endVertexId);
  const footprint = footprints[opening.kitId];
  if (!startVertex || !endVertex || !footprint) return null;
  const start = { xM: startVertex.xU / ARCHITECTURE_UNITS_PER_METER, zM: startVertex.zU / ARCHITECTURE_UNITS_PER_METER };
  const end = { xM: endVertex.xU / ARCHITECTURE_UNITS_PER_METER, zM: endVertex.zU / ARCHITECTURE_UNITS_PER_METER };
  const dxU = endVertex.xU - startVertex.xU;
  const dzU = endVertex.zU - startVertex.zU;
  const lengthU = Math.hypot(dxU, dzU);
  if (!(lengthU > 0)) return null;
  return {
    edgeId: edge.id,
    openingId: opening.id,
    start,
    end,
    baseYM: edge.support.baseYU / ARCHITECTURE_UNITS_PER_METER,
    dir: { x: dxU / lengthU, z: dzU / lengthU },
    anchor: { columnU: opening.columnU, rowU: opening.rowU },
    footprint,
    edgeLengthU: lengthU,
    edgeHeightU: edge.heightU,
    facingSide: opening.facingSide,
  };
}

/** The world center of the cut rectangle at a candidate anchor — where the
 * gizmo stands, and where its handles measure from. */
export function openingRectCenter(frame: OpeningGizmoFrame, cell: WallCell): { x: number; y: number; z: number } {
  const centerColumnU = cell.columnU + (frame.footprint.minColumn + frame.footprint.maxColumnExclusive) / 2;
  const centerRowU = cell.rowU + (frame.footprint.minRow + frame.footprint.maxRowExclusive) / 2;
  const alongM = centerColumnU / ARCHITECTURE_UNITS_PER_METER;
  return {
    x: frame.start.xM + frame.dir.x * alongM,
    y: frame.baseYM + centerRowU / ARCHITECTURE_UNITS_PER_METER,
    z: frame.start.zM + frame.dir.z * alongM,
  };
}

/** A candidate anchor clamped to whole lattice units with the footprint held
 * inside the wall face — the drag can never preview an out-of-wall cut. The
 * engine still rules on junction clearance and overlaps at commit. */
export function clampOpeningCell(frame: OpeningGizmoFrame, columnU: number, rowU: number): WallCell {
  const minColumn = -frame.footprint.minColumn;
  const maxColumn = frame.edgeLengthU - frame.footprint.maxColumnExclusive;
  const minRow = -frame.footprint.minRow;
  const maxRow = frame.edgeHeightU - frame.footprint.maxRowExclusive;
  const clamp = (value: number, low: number, high: number): number =>
    high < low ? low : Math.min(high, Math.max(low, value));
  return {
    columnU: Math.round(clamp(columnU, minColumn, maxColumn)),
    rowU: Math.round(clamp(rowU, minRow, maxRow)),
  };
}

/** Which side of the wall a world point stands on — the ring drag's flip law.
 * Engine side law (wall_geometry.zig): side-a normal = (-dirZ, dirX). */
export function openingSideOfPoint(frame: OpeningGizmoFrame, point: { x: number; z: number }): 'a' | 'b' {
  const toPointX = point.x - frame.start.xM;
  const toPointZ = point.z - frame.start.zM;
  return (-frame.dir.z * toPointX + frame.dir.x * toPointZ) >= 0 ? 'a' : 'b';
}

export type OpeningGhostCorner = { x: number; y: number; z: number };

/** The kit's cut rectangle on the wall face, in world meters — anchored at the
 * slot, spanning the footprint, along the edge from its start vertex. The
 * caller projects the four corners to screen. */
export function openingGhostCorners(
  start: { xM: number; zM: number },
  end: { xM: number; zM: number },
  baseYM: number,
  anchor: WallCell,
  footprint: ArchitectureFootprint,
): OpeningGhostCorner[] | null {
  const dx = end.xM - start.xM;
  const dz = end.zM - start.zM;
  const length = Math.hypot(dx, dz);
  if (!(length > 0)) return null;
  const dirX = dx / length;
  const dirZ = dz / length;
  const u0 = (anchor.columnU + footprint.minColumn) / ARCHITECTURE_UNITS_PER_METER;
  const u1 = (anchor.columnU + footprint.maxColumnExclusive) / ARCHITECTURE_UNITS_PER_METER;
  const v0 = baseYM + (anchor.rowU + footprint.minRow) / ARCHITECTURE_UNITS_PER_METER;
  const v1 = baseYM + (anchor.rowU + footprint.maxRowExclusive) / ARCHITECTURE_UNITS_PER_METER;
  const at = (u: number, v: number): OpeningGhostCorner => ({
    x: start.xM + dirX * u,
    y: v,
    z: start.zM + dirZ * u,
  });
  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
}
