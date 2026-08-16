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

/** The first installed kit of the requested kind — the Draw Wall convention
 * (first measured style wins) until a kit picker exists. Null when nothing of
 * that kind is installed; the tool then refuses to arm with a pointer to the
 * export verb. */
export function armedOpeningKitFromEntries(
  entries: readonly ArchitectureCatalogEntry[],
  kind: WallOpeningKind,
): OpeningKitArm | null {
  const entry = entries.find((candidate) => candidate.family === 'wall'
    && candidate.role === 'opening' && candidate.semanticKind === kind);
  if (!entry || !entry.measurement.footprint || !entry.wallOpeningCompatibility) return null;
  return {
    catalogId: entry.catalogId,
    kind,
    label: entry.label,
    footprint: { ...entry.measurement.footprint },
    minimumThicknessU: entry.wallOpeningCompatibility.minimumThicknessU,
    permittedProfiles: [...entry.wallOpeningCompatibility.permittedProfiles],
  };
}

/** Nearest legal anchor to the hovered surface cell, by squared lattice
 * distance; ties break toward the earlier slot in engine order. Null when the
 * edge offers no slot at all. */
export function snapOpeningSlot(
  slots: readonly WallCell[],
  columnU: number,
  rowU: number,
): WallCell | null {
  let best: WallCell | null = null;
  let bestDistance = Infinity;
  for (const slot of slots) {
    const dc = slot.columnU - columnU;
    const dr = slot.rowU - rowU;
    const distance = dc * dc + dr * dr;
    if (distance < bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best;
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
