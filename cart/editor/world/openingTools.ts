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
  type WallCell,
  type WallOpeningKind,
  type WallProfile,
} from './architecture';

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
