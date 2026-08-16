// File → Export → Wall Opening: the OPEN model becomes a measured opening kit.
//
// The manifest is the record (req_2718): this module builds the complete
// `placeable: architecture-kit` declaration — measured off the REAL mesh
// bounds, never hand-typed — and the boot catalog scan installs it. The kit
// owns the frame (req_4487): the exported model IS the mounted asset (frame +
// leaf parts together); the wall renders only its own cut flesh. Thickness
// compatibility is the kit's own measured housing depth as a MINIMUM — it fits
// any wall at least that thick (req_4491).

import {
  ARCHITECTURE_UNITS_PER_METER,
  ArchitectureValidationError,
  type ArchitectureKitMeasurement,
  type ArchitectureKitPlaceable,
  type PortalClass,
  type WallOpeningKind,
} from './architecture';
import { projectArchitectureCatalogEntry } from './architectureCatalog';
import { sha256Hex } from '@reactjit/runtime/workspace/sha256';
import { textBytes } from '@reactjit/runtime/workspace/lumps';

export type MeshBoundsMeters = {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
};

export type WallOpeningExportTarget = {
  /** command suffix: export-wall-opening-<id> */
  id: string;
  label: string;
  kind: WallOpeningKind;
  icon: string;
  portalClass: PortalClass;
  /** Door-family kinds keep the legacy named-part contract: the Outliner must
   * name WHICH geometry swings before the declaration is written. */
  needsDoorLeafPart: boolean;
};

// brokenWindow is deliberately absent: it reads as a damage VARIANT of a
// window kit, not an authored kit of its own — pending a ruling.
export const WALL_OPENING_EXPORT_TARGETS: readonly WallOpeningExportTarget[] = [
  { id: 'door', label: 'Door', kind: 'door', icon: 'DoorOpen', portalClass: 'walk', needsDoorLeafPart: true },
  { id: 'window', label: 'Window', kind: 'window', icon: 'Blinds', portalClass: 'none', needsDoorLeafPart: false },
  { id: 'double-window', label: 'Double Window', kind: 'doubleWindow', icon: 'Columns2', portalClass: 'none', needsDoorLeafPart: false },
  { id: 'garage-door', label: 'Garage Door', kind: 'garageDoor', icon: 'Warehouse', portalClass: 'vehicle', needsDoorLeafPart: true },
  { id: 'sliding-door', label: 'Sliding Door', kind: 'slidingDoor', icon: 'MoveHorizontal', portalClass: 'walk', needsDoorLeafPart: true },
  { id: 'arch', label: 'Arch', kind: 'arch', icon: 'Landmark', portalClass: 'walk', needsDoorLeafPart: false },
] as const;

export function wallOpeningExportTargetForCommand(commandId: string): WallOpeningExportTarget | null {
  if (!commandId.startsWith('export-wall-opening-')) return null;
  const id = commandId.slice('export-wall-opening-'.length);
  return WALL_OPENING_EXPORT_TARGETS.find((target) => target.id === id) ?? null;
}

function fail(path: string, message: string): never {
  throw new ArchitectureValidationError(path, message);
}

/** Kit catalog slug from the model's display name — stable, readable, no id parsing. */
export function wallOpeningCatalogSlug(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) fail('wallOpeningExport.name', 'must contain at least one letter or digit');
  return slug;
}

/** The measured lattice projection of the model: the mount face is the model's
 * X/Y extent, the footprint its outward-rounded cells, and the housing depth
 * its Z extent. Model-space coordinates are AUTHORITATIVE — the model origin
 * is the pivot, exactly as the mesh editor's mirror plane treats it. */
export function measuredWallOpeningKit(bounds: MeshBoundsMeters): {
  measurement: ArchitectureKitMeasurement;
  minimumThicknessU: number;
} {
  const u = ARCHITECTURE_UNITS_PER_METER;
  const path = 'wallOpeningExport.bounds';
  ([bounds.minX, bounds.minY, bounds.minZ, bounds.maxX, bounds.maxY, bounds.maxZ] as const).forEach((value) => {
    if (!Number.isFinite(value)) fail(path, 'must be finite measured mesh bounds');
  });
  const mountBoundsU = {
    minU: bounds.minX * u, minV: bounds.minY * u,
    maxU: bounds.maxX * u, maxV: bounds.maxY * u,
  };
  const footprint = {
    minColumn: Math.floor(mountBoundsU.minU),
    minRow: Math.floor(mountBoundsU.minV),
    maxColumnExclusive: Math.ceil(mountBoundsU.maxU),
    maxRowExclusive: Math.ceil(mountBoundsU.maxV),
  };
  if (footprint.minColumn >= footprint.maxColumnExclusive || footprint.minRow >= footprint.maxRowExclusive) {
    fail(path, 'must span at least one lattice cell across the wall face');
  }
  const minimumThicknessU = Math.max(1, Math.ceil(bounds.maxZ * u) - Math.floor(bounds.minZ * u));
  const measurement: ArchitectureKitMeasurement = {
    sourceBoundsU: {
      minXU: bounds.minX * u, minYU: bounds.minY * u, minZU: bounds.minZ * u,
      maxXU: bounds.maxX * u, maxYU: bounds.maxY * u, maxZU: bounds.maxZ * u,
    },
    mountBoundsU,
    footprint,
    // Flush-against-junction placement is ALLOWED (req_4500) — kits may
    // declare clearance margins later; the measured export starts with none.
    clearanceMask: [],
    pivotU: { xU: 0, yU: 0, zU: 0 },
  };
  return { measurement, minimumThicknessU };
}

export type WallOpeningKitExportInput = {
  target: WallOpeningExportTarget;
  /** Model display name — becomes the catalog slug and the palette label. */
  name: string;
  bounds: MeshBoundsMeters;
  /** sha256 of the package's mesh/doc.blob — the content-addressed model document. */
  meshContentHash: string;
};

/** The complete manifest declaration, validated end to end: authored fields,
 * measured evidence, and the content-addressed install block. Throws
 * ArchitectureValidationError (loud, typed) rather than writing a bad manifest. */
export function wallOpeningKitPlaceable(input: WallOpeningKitExportInput): ArchitectureKitPlaceable {
  const { measurement, minimumThicknessU } = measuredWallOpeningKit(input.bounds);
  const slug = wallOpeningCatalogSlug(input.name);
  const assetRefs = { meshContentHash: input.meshContentHash, materialContentHashes: [] as string[] };
  const declaration = {
    as: 'architecture-kit' as const,
    family: 'wall' as const,
    role: 'opening' as const,
    semanticKind: input.target.kind,
    catalogPath: ['Walls', 'Openings', input.target.label],
    themeTags: [] as string[],
    gameplayTags: [] as string[],
    measurement,
  };
  // The install content hash is the declaration + asset refs, canonically
  // serialized — the same content always addresses the same catalog entry.
  const contentHash = sha256Hex(textBytes(JSON.stringify({ declaration, assetRefs })));
  const placeable: ArchitectureKitPlaceable = {
    ...declaration,
    install: {
      catalogId: `build:wall:opening:${input.target.id}:${slug}`,
      contentHash,
      assetRefs,
      wallOpeningCompatibility: {
        permittedProfiles: ['full'],
        minimumThicknessU,
        portalClass: input.target.portalClass,
      },
    },
  };
  // Prove the projection the boot scan will run — a declaration this function
  // returns must install; anything else throws here, at export time.
  const entry = projectArchitectureCatalogEntry({ id: `export:${slug}`, name: input.name, placeable });
  if (!entry) fail('wallOpeningExport', 'projected to no catalog entry');
  return placeable;
}
