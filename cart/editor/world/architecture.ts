// Canonical editor-owned semantic architecture DTOs.
//
// This module owns persisted v1 shape and its strict dynamic-data boundary. Native
// remains authoritative for catalog meaning, topology, mutation, and compilation;
// editor state never persists those derived products.

export const ARCHITECTURE_SOURCE_VERSION = 1 as const;
export const ARCHITECTURE_UNITS_PER_METER = 16 as const;

export const ARCHITECTURE_LIMITS = Object.freeze({
  minimumUnit: -16_777_216,
  maximumUnit: 16_777_216,
  maximumIdBytes: 512,
  maximumLabelBytes: 1_024,
  maximumTagBytes: 128,
  maximumPathSegments: 32,
  maximumTagsPerEntry: 256,
  maximumCatalogEntries: 65_536,
  maximumVertices: 1_048_576,
  maximumEdges: 1_048_576,
  maximumOpenings: 1_048_576,
  maximumAnchors: 1_048_576,
  maximumFloorMagnitude: 4_096,
  minimumWallLengthU: 2,
  minimumWallHeightU: 1,
  maximumWallHeightU: 4_096,
  minimumWallThicknessU: 1,
  maximumWallThicknessU: 1_024,
});

export type ArchitectureFamily = 'wall' | 'floor' | 'verticalLink' | 'roof';
export type ArchitectureManifestFamily = 'wall' | 'floor' | 'vertical-link' | 'roof';
export type ArchitectureKitRole = 'style' | 'opening' | 'trim' | 'cap' | 'rail' | 'doorLeaf';
export type ArchitectureManifestKitRole = 'style' | 'opening' | 'trim' | 'cap' | 'rail' | 'door-leaf';
export type WallProfile = 'full' | 'half';
export type WallSide = 'a' | 'b';
export type WallHinge = 'start' | 'end' | 'none';
export type WallOpeningKind = 'door' | 'window' | 'doubleWindow' | 'brokenWindow'
  | 'garageDoor' | 'slidingDoor' | 'arch';
export type VerticalLinkKind = 'stair' | 'ramp' | 'elevator';
export type RoofProfile = 'flat' | 'shed' | 'gable' | 'hip' | 'pyramid';
export type PortalClass = 'none' | 'walk' | 'vehicle';

export type ArchitecturePoint3 = { xU: number; yU: number; zU: number };
export type WallCell = { columnU: number; rowU: number };
export type MeasuredBounds3 = {
  minXU: number;
  minYU: number;
  minZU: number;
  maxXU: number;
  maxYU: number;
  maxZU: number;
};
export type MountBounds2 = { minU: number; minV: number; maxU: number; maxV: number };
export type ArchitectureFootprint = {
  minColumn: number;
  minRow: number;
  maxColumnExclusive: number;
  maxRowExclusive: number;
};

export type ArchitectureKitMeasurement = {
  sourceBoundsU: MeasuredBounds3;
  mountBoundsU?: MountBounds2;
  footprint?: ArchitectureFootprint;
  /** Empty means the complete opening footprint is occupied. */
  occupiedMask?: readonly WallCell[];
  clearanceMask: readonly WallCell[];
  pivotU: ArchitecturePoint3;
};

export type ArchitectureKitDeclaration = {
  as: 'architecture-kit';
  family: ArchitectureManifestFamily;
  role: ArchitectureManifestKitRole;
  catalogPath: readonly string[];
  semanticKind?: WallOpeningKind | VerticalLinkKind | RoofProfile;
  themeTags: readonly string[];
  gameplayTags: readonly string[];
  measurement: ArchitectureKitMeasurement;
};

export type ArchitectureAssetRefs = {
  meshContentHash: string;
  materialContentHashes: readonly string[];
  animationContentHash?: string;
};

/** Atomic install evidence written only after measured export products exist. */
export type ArchitectureKitInstallDeclaration = {
  catalogId: string;
  contentHash: string;
  assetRefs: ArchitectureAssetRefs;
  wallStyleProfile?: WallProfile;
  wallOpeningCompatibility?: {
    permittedProfiles: readonly WallProfile[];
    permittedThicknessU: readonly number[];
    portalClass: PortalClass;
  };
};

/** Complete manifest variant: authored declaration plus committed install evidence. */
export type ArchitectureKitPlaceable = ArchitectureKitDeclaration & {
  install: ArchitectureKitInstallDeclaration;
};

export type ArchitectureCatalogEntry = {
  catalogId: string;
  contentHash: string;
  packageId: string;
  label: string;
  family: ArchitectureFamily;
  role: ArchitectureKitRole;
  semanticKind?: WallOpeningKind | VerticalLinkKind | RoofProfile;
  categoryPath: readonly string[];
  themeTags: readonly string[];
  gameplayTags: readonly string[];
  measurement: ArchitectureKitMeasurement;
  wallStyleDefaults?: { heightU: number; thicknessU: number; profile: WallProfile };
  wallOpeningCompatibility?: {
    permittedProfiles: readonly WallProfile[];
    permittedThicknessU: readonly number[];
    portalClass: PortalClass;
  };
  assetRefs: ArchitectureAssetRefs;
};

export type ArchitectureCatalogQuery = {
  family: ArchitectureFamily;
  role?: ArchitectureKitRole;
  semanticKind?: WallOpeningKind | VerticalLinkKind | RoofProfile;
  requiredThemeTags?: readonly string[];
  requiredGameplayTags?: readonly string[];
  maximumWidthU?: number;
  maximumHeightU?: number;
  wallProfile?: WallProfile;
  wallThicknessU?: number;
};

export type WallSideFinish = { materialId: string };
export type WallSupport = { kind: 'absolute'; baseYU: number };
export type WallOpening = {
  id: string;
  kind: WallOpeningKind;
  kitId: string;
  columnU: number;
  rowU: number;
  facingSide: WallSide;
  hinge: WallHinge;
};
export type WallVertex = { id: string; floor: number; xU: number; zU: number };
export type WallEdge = {
  id: string;
  startVertexId: string;
  endVertexId: string;
  support: WallSupport;
  heightU: number;
  thicknessU: number;
  profile: WallProfile;
  styleId: string;
  sideA: WallSideFinish;
  sideB: WallSideFinish;
  openings: readonly WallOpening[];
};
export type WallAnchor = {
  id: string;
  edgeId: string;
  side: WallSide;
  columnU: number;
  rowU: number;
  targetPieceId: string;
};
export type WallSource = {
  vertices: readonly WallVertex[];
  edges: readonly WallEdge[];
  anchors: readonly WallAnchor[];
};
export type ArchitectureSource = {
  version: 1;
  revision: number;
  walls: WallSource;
};

export type ArchitectureSelection =
  | { kind: 'none' }
  | { kind: 'wallVertex'; vertexId: string }
  | { kind: 'wallEdge'; edgeId: string; side: WallSide }
  | { kind: 'wallOpening'; edgeId: string; openingId: string }
  | { kind: 'wallAnchor'; anchorId: string };

export type ArchitectureToolState =
  | { kind: 'select' }
  | {
    kind: 'drawWall';
    floor: number;
    baseYU: number;
    styleId: string;
    heightU: number;
    thicknessU: number;
    profile: WallProfile;
    materialAId: string;
    materialBId: string;
  }
  | { kind: 'placeOpening'; kitId: string; facingSide: WallSide; hinge: WallHinge }
  | { kind: 'paintWallSide'; materialId: string }
  | { kind: 'placeWallAnchor'; targetPieceId: string };

export type ArchitectureSummary = {
  revision: number;
  vertexCount: number;
  edgeCount: number;
  openingCount: number;
  anchorCount: number;
  floors: readonly number[];
  boundsU: null | {
    minXU: number;
    minYU: number;
    minZU: number;
    maxXU: number;
    maxYU: number;
    maxZU: number;
  };
};

export class ArchitectureValidationError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ArchitectureValidationError';
  }
}

type UnknownRecord = Record<string, unknown>;

function reject(path: string, message: string): never {
  throw new ArchitectureValidationError(path, message);
}

function asRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return reject(path, 'must be an object');
  }
  return value as UnknownRecord;
}

function exactRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): UnknownRecord {
  const record = asRecord(value, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) reject(`${path}.${key}`, 'is not a persisted field');
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) reject(`${path}.${key}`, 'is required');
  }
  return record;
}

function asArray(value: unknown, path: string, maximum?: number): readonly unknown[] {
  if (!Array.isArray(value)) return reject(path, 'must be an array');
  if (maximum !== undefined && value.length > maximum) reject(path, `exceeds maximum count ${maximum}`);
  return value;
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0)!;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}

function asString(value: unknown, path: string, maximumBytes = ARCHITECTURE_LIMITS.maximumIdBytes): string {
  if (typeof value !== 'string' || value.length === 0) return reject(path, 'must be a non-empty string');
  if (utf8ByteLength(value) > maximumBytes) reject(path, `exceeds maximum UTF-8 length ${maximumBytes}`);
  return value;
}

function asCatalogText(value: unknown, path: string, maximumBytes: number): string {
  const text = asString(value, path, maximumBytes);
  for (const scalar of text) {
    const codePoint = scalar.codePointAt(0)!;
    if (codePoint < 0x20 || codePoint === 0x7f) reject(path, 'contains a control character');
  }
  return text;
}

function asEnum<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    return reject(path, `must be one of ${values.join(', ')}`);
  }
  return value as T;
}

function asInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return reject(path, 'must be a finite number');
  if (!Number.isInteger(value)) return reject(path, 'must be a whole architecture unit');
  if (value < minimum || value > maximum) return reject(path, `must be in [${minimum}, ${maximum}]`);
  return value;
}

function asUnit(value: unknown, path: string): number {
  return asInteger(value, path, ARCHITECTURE_LIMITS.minimumUnit, ARCHITECTURE_LIMITS.maximumUnit);
}

function asFiniteMeasurement(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return reject(path, 'must be finite measurement evidence');
  if (value < ARCHITECTURE_LIMITS.minimumUnit || value > ARCHITECTURE_LIMITS.maximumUnit) {
    reject(path, `must be in [${ARCHITECTURE_LIMITS.minimumUnit}, ${ARCHITECTURE_LIMITS.maximumUnit}]`);
  }
  return value;
}

function asHash(value: unknown, path: string): string {
  const hash = asString(value, path, 64);
  if (!/^[0-9a-f]{64}$/.test(hash)) reject(path, 'must be a lowercase 64-character content hash');
  return hash;
}

function validateStringList(
  value: unknown,
  path: string,
  options: { maximumCount: number; maximumBytes: number; category?: boolean },
): readonly string[] {
  const values = asArray(value, path, options.maximumCount);
  const seen = new Set<string>();
  values.forEach((candidate, index) => {
    const itemPath = `${path}[${index}]`;
    const text = asCatalogText(candidate, itemPath, options.maximumBytes);
    if (options.category && (text.includes('/') || text.includes(':'))) {
      reject(itemPath, 'category segments cannot contain slash or colon');
    }
    if (seen.has(text)) reject(itemPath, 'duplicates an earlier value');
    seen.add(text);
  });
  return values as readonly string[];
}

function validateSourceBounds(value: unknown, path: string): MeasuredBounds3 {
  const bounds = exactRecord(value, path,
    ['minXU', 'minYU', 'minZU', 'maxXU', 'maxYU', 'maxZU']);
  const result = {
    minXU: asFiniteMeasurement(bounds.minXU, `${path}.minXU`),
    minYU: asFiniteMeasurement(bounds.minYU, `${path}.minYU`),
    minZU: asFiniteMeasurement(bounds.minZU, `${path}.minZU`),
    maxXU: asFiniteMeasurement(bounds.maxXU, `${path}.maxXU`),
    maxYU: asFiniteMeasurement(bounds.maxYU, `${path}.maxYU`),
    maxZU: asFiniteMeasurement(bounds.maxZU, `${path}.maxZU`),
  };
  if (result.minXU >= result.maxXU || result.minYU >= result.maxYU || result.minZU >= result.maxZU) {
    reject(path, 'must have a non-empty measured volume');
  }
  return result;
}

function validateMountBounds(value: unknown, path: string): MountBounds2 {
  const bounds = exactRecord(value, path, ['minU', 'minV', 'maxU', 'maxV']);
  const result = {
    minU: asFiniteMeasurement(bounds.minU, `${path}.minU`),
    minV: asFiniteMeasurement(bounds.minV, `${path}.minV`),
    maxU: asFiniteMeasurement(bounds.maxU, `${path}.maxU`),
    maxV: asFiniteMeasurement(bounds.maxV, `${path}.maxV`),
  };
  if (result.minU >= result.maxU || result.minV >= result.maxV) reject(path, 'must have a non-empty measured area');
  return result;
}

function validateFootprint(value: unknown, path: string): ArchitectureFootprint {
  const footprint = exactRecord(value, path,
    ['minColumn', 'minRow', 'maxColumnExclusive', 'maxRowExclusive']);
  const result = {
    minColumn: asUnit(footprint.minColumn, `${path}.minColumn`),
    minRow: asUnit(footprint.minRow, `${path}.minRow`),
    maxColumnExclusive: asUnit(footprint.maxColumnExclusive, `${path}.maxColumnExclusive`),
    maxRowExclusive: asUnit(footprint.maxRowExclusive, `${path}.maxRowExclusive`),
  };
  if (result.minColumn >= result.maxColumnExclusive || result.minRow >= result.maxRowExclusive) {
    reject(path, 'must have a non-empty half-open area');
  }
  return result;
}

function validatePoint3(value: unknown, path: string): ArchitecturePoint3 {
  const point = exactRecord(value, path, ['xU', 'yU', 'zU']);
  return {
    xU: asUnit(point.xU, `${path}.xU`),
    yU: asUnit(point.yU, `${path}.yU`),
    zU: asUnit(point.zU, `${path}.zU`),
  };
}

function validateCells(value: unknown, path: string): readonly WallCell[] {
  const cells = asArray(value, path);
  const occupied = new Set<string>();
  cells.forEach((candidate, index) => {
    const cellPath = `${path}[${index}]`;
    const cell = exactRecord(candidate, cellPath, ['columnU', 'rowU']);
    const columnU = asUnit(cell.columnU, `${cellPath}.columnU`);
    const rowU = asUnit(cell.rowU, `${cellPath}.rowU`);
    const key = `${columnU},${rowU}`;
    if (occupied.has(key)) reject(cellPath, 'duplicates an earlier cell');
    occupied.add(key);
  });
  return cells as readonly WallCell[];
}

function cellKey(cell: WallCell): string {
  return `${cell.columnU},${cell.rowU}`;
}

function footprintContains(footprint: ArchitectureFootprint, cell: WallCell): boolean {
  return cell.columnU >= footprint.minColumn && cell.columnU < footprint.maxColumnExclusive
    && cell.rowU >= footprint.minRow && cell.rowU < footprint.maxRowExclusive;
}

function validateMeasurement(value: unknown, path: string, opening: boolean): ArchitectureKitMeasurement {
  const measurement = exactRecord(value, path,
    ['sourceBoundsU', 'clearanceMask', 'pivotU'],
    ['mountBoundsU', 'footprint', 'occupiedMask']);
  const sourceBounds = validateSourceBounds(measurement.sourceBoundsU, `${path}.sourceBoundsU`);
  validatePoint3(measurement.pivotU, `${path}.pivotU`);
  const clearance = validateCells(measurement.clearanceMask, `${path}.clearanceMask`);
  const occupied = measurement.occupiedMask === undefined
    ? []
    : validateCells(measurement.occupiedMask, `${path}.occupiedMask`);

  if (!opening) {
    if (measurement.mountBoundsU !== undefined) reject(`${path}.mountBoundsU`, 'is only valid for wall opening kits');
    if (measurement.footprint !== undefined) reject(`${path}.footprint`, 'is only valid for wall opening kits');
    if (occupied.length !== 0) reject(`${path}.occupiedMask`, 'must be empty outside a wall opening kit');
    if (clearance.length !== 0) reject(`${path}.clearanceMask`, 'must be empty outside a wall opening kit');
    return measurement as ArchitectureKitMeasurement;
  }

  if (measurement.mountBoundsU === undefined) reject(`${path}.mountBoundsU`, 'is required for a wall opening kit');
  if (measurement.footprint === undefined) reject(`${path}.footprint`, 'is required for a wall opening kit');
  const mount = validateMountBounds(measurement.mountBoundsU, `${path}.mountBoundsU`);
  const footprint = validateFootprint(measurement.footprint, `${path}.footprint`);
  if (footprint.minColumn !== Math.floor(mount.minU)
    || footprint.minRow !== Math.floor(mount.minV)
    || footprint.maxColumnExclusive !== Math.ceil(mount.maxU)
    || footprint.maxRowExclusive !== Math.ceil(mount.maxV)) {
    reject(`${path}.footprint`, 'must equal the outward-rounded mount bounds');
  }
  occupied.forEach((cell, index) => {
    if (!footprintContains(footprint, cell)) reject(`${path}.occupiedMask[${index}]`, 'lies outside the footprint');
  });
  const occupiedKeys = new Set(occupied.map(cellKey));
  clearance.forEach((cell, index) => {
    const overlapsOccupied = occupied.length === 0
      ? footprintContains(footprint, cell)
      : occupiedKeys.has(cellKey(cell));
    if (overlapsOccupied) reject(`${path}.clearanceMask[${index}]`, 'overlaps occupied opening area');
  });
  void sourceBounds;
  return measurement as ArchitectureKitMeasurement;
}

const ARCHITECTURE_FAMILIES = ['wall', 'floor', 'verticalLink', 'roof'] as const;
const MANIFEST_FAMILIES = ['wall', 'floor', 'vertical-link', 'roof'] as const;
const ARCHITECTURE_ROLES = ['style', 'opening', 'trim', 'cap', 'rail', 'doorLeaf'] as const;
const MANIFEST_ROLES = ['style', 'opening', 'trim', 'cap', 'rail', 'door-leaf'] as const;
const WALL_PROFILES = ['full', 'half'] as const;
const WALL_SIDES = ['a', 'b'] as const;
const WALL_HINGES = ['start', 'end', 'none'] as const;
const WALL_OPENING_KINDS = ['door', 'window', 'doubleWindow', 'brokenWindow', 'garageDoor', 'slidingDoor', 'arch'] as const;
const VERTICAL_LINK_KINDS = ['stair', 'ramp', 'elevator'] as const;
const ROOF_PROFILES = ['flat', 'shed', 'gable', 'hip', 'pyramid'] as const;
const PORTAL_CLASSES = ['none', 'walk', 'vehicle'] as const;

function normalizedManifestFamily(family: ArchitectureManifestFamily): ArchitectureFamily {
  return family === 'vertical-link' ? 'verticalLink' : family;
}

function normalizedManifestRole(role: ArchitectureManifestKitRole): ArchitectureKitRole {
  return role === 'door-leaf' ? 'doorLeaf' : role;
}

function familyRoleCompatible(family: ArchitectureFamily, role: ArchitectureKitRole): boolean {
  if (family === 'wall') return true;
  if (family === 'floor' || family === 'roof') return role === 'style' || role === 'opening' || role === 'trim' || role === 'cap';
  return role === 'style' || role === 'rail';
}

function validateSemanticKind(
  family: ArchitectureFamily,
  role: ArchitectureKitRole,
  value: unknown,
  path: string,
): void {
  if (family === 'wall' && role === 'opening') {
    asEnum(value, WALL_OPENING_KINDS, path);
    return;
  }
  if (family === 'verticalLink' && role === 'style') {
    asEnum(value, VERTICAL_LINK_KINDS, path);
    return;
  }
  if (family === 'roof' && role === 'style') {
    asEnum(value, ROOF_PROFILES, path);
    return;
  }
  if (value !== undefined) reject(path, 'is incompatible with the selected family and role');
}

export function validateArchitectureKitDeclaration(value: unknown): asserts value is ArchitectureKitDeclaration {
  const path = 'architectureKit';
  const declaration = exactRecord(value, path,
    ['as', 'family', 'role', 'catalogPath', 'themeTags', 'gameplayTags', 'measurement'],
    ['semanticKind']);
  if (declaration.as !== 'architecture-kit') reject(`${path}.as`, "must equal 'architecture-kit'");
  const manifestFamily = asEnum(declaration.family, MANIFEST_FAMILIES, `${path}.family`);
  const manifestRole = asEnum(declaration.role, MANIFEST_ROLES, `${path}.role`);
  const family = normalizedManifestFamily(manifestFamily);
  const role = normalizedManifestRole(manifestRole);
  if (!familyRoleCompatible(family, role)) reject(`${path}.role`, 'is incompatible with the selected family');
  validateSemanticKind(family, role, declaration.semanticKind, `${path}.semanticKind`);
  const categoryPath = validateStringList(declaration.catalogPath, `${path}.catalogPath`, {
    maximumCount: ARCHITECTURE_LIMITS.maximumPathSegments,
    maximumBytes: ARCHITECTURE_LIMITS.maximumLabelBytes,
    category: true,
  });
  if (categoryPath.length === 0) reject(`${path}.catalogPath`, 'must contain at least one segment');
  validateStringList(declaration.themeTags, `${path}.themeTags`, {
    maximumCount: ARCHITECTURE_LIMITS.maximumTagsPerEntry,
    maximumBytes: ARCHITECTURE_LIMITS.maximumTagBytes,
  });
  validateStringList(declaration.gameplayTags, `${path}.gameplayTags`, {
    maximumCount: ARCHITECTURE_LIMITS.maximumTagsPerEntry,
    maximumBytes: ARCHITECTURE_LIMITS.maximumTagBytes,
  });
  validateMeasurement(declaration.measurement, `${path}.measurement`, family === 'wall' && role === 'opening');
}

function validateAssetRefs(value: unknown, path: string): void {
  const refs = exactRecord(value, path,
    ['meshContentHash', 'materialContentHashes'], ['animationContentHash']);
  asHash(refs.meshContentHash, `${path}.meshContentHash`);
  asArray(refs.materialContentHashes, `${path}.materialContentHashes`).forEach((hash, index) => {
    asHash(hash, `${path}.materialContentHashes[${index}]`);
  });
  if (refs.animationContentHash !== undefined) asHash(refs.animationContentHash, `${path}.animationContentHash`);
}

export function validateArchitectureCatalogEntry(value: unknown, path = 'architectureCatalogEntry'): asserts value is ArchitectureCatalogEntry {
  const entry = exactRecord(value, path,
    ['catalogId', 'contentHash', 'packageId', 'label', 'family', 'role', 'categoryPath', 'themeTags', 'gameplayTags', 'measurement', 'assetRefs'],
    ['semanticKind', 'wallStyleDefaults', 'wallOpeningCompatibility']);
  asString(entry.catalogId, `${path}.catalogId`);
  asHash(entry.contentHash, `${path}.contentHash`);
  asString(entry.packageId, `${path}.packageId`);
  asCatalogText(entry.label, `${path}.label`, ARCHITECTURE_LIMITS.maximumLabelBytes);
  const family = asEnum(entry.family, ARCHITECTURE_FAMILIES, `${path}.family`);
  const role = asEnum(entry.role, ARCHITECTURE_ROLES, `${path}.role`);
  if (!familyRoleCompatible(family, role)) reject(`${path}.role`, 'is incompatible with the selected family');
  validateSemanticKind(family, role, entry.semanticKind, `${path}.semanticKind`);
  const categoryPath = validateStringList(entry.categoryPath, `${path}.categoryPath`, {
    maximumCount: ARCHITECTURE_LIMITS.maximumPathSegments,
    maximumBytes: ARCHITECTURE_LIMITS.maximumLabelBytes,
    category: true,
  });
  if (categoryPath.length === 0) reject(`${path}.categoryPath`, 'must contain at least one segment');
  validateStringList(entry.themeTags, `${path}.themeTags`, {
    maximumCount: ARCHITECTURE_LIMITS.maximumTagsPerEntry,
    maximumBytes: ARCHITECTURE_LIMITS.maximumTagBytes,
  });
  validateStringList(entry.gameplayTags, `${path}.gameplayTags`, {
    maximumCount: ARCHITECTURE_LIMITS.maximumTagsPerEntry,
    maximumBytes: ARCHITECTURE_LIMITS.maximumTagBytes,
  });
  const opening = family === 'wall' && role === 'opening';
  const measurement = validateMeasurement(entry.measurement, `${path}.measurement`, opening);

  if (family === 'wall' && role === 'style') {
    if (entry.wallStyleDefaults === undefined) reject(`${path}.wallStyleDefaults`, 'is required for a wall style');
    const defaults = exactRecord(entry.wallStyleDefaults, `${path}.wallStyleDefaults`, ['heightU', 'thicknessU', 'profile']);
    const heightU = asInteger(defaults.heightU, `${path}.wallStyleDefaults.heightU`,
      ARCHITECTURE_LIMITS.minimumWallHeightU, ARCHITECTURE_LIMITS.maximumWallHeightU);
    const thicknessU = asInteger(defaults.thicknessU, `${path}.wallStyleDefaults.thicknessU`,
      ARCHITECTURE_LIMITS.minimumWallThicknessU, ARCHITECTURE_LIMITS.maximumWallThicknessU);
    asEnum(defaults.profile, WALL_PROFILES, `${path}.wallStyleDefaults.profile`);
    const source = measurement.sourceBoundsU;
    if (heightU !== Math.ceil(source.maxYU) - Math.floor(source.minYU)
      || thicknessU !== Math.ceil(source.maxZU) - Math.floor(source.minZU)) {
      reject(`${path}.wallStyleDefaults`, 'must equal outward-rounded measured bounds');
    }
  } else if (entry.wallStyleDefaults !== undefined) {
    reject(`${path}.wallStyleDefaults`, 'is only valid for a wall style');
  }

  if (opening) {
    if (entry.wallOpeningCompatibility === undefined) reject(`${path}.wallOpeningCompatibility`, 'is required for a wall opening kit');
    const compatibility = exactRecord(entry.wallOpeningCompatibility, `${path}.wallOpeningCompatibility`,
      ['permittedProfiles', 'permittedThicknessU', 'portalClass']);
    const profiles = asArray(compatibility.permittedProfiles, `${path}.wallOpeningCompatibility.permittedProfiles`);
    if (profiles.length === 0) reject(`${path}.wallOpeningCompatibility.permittedProfiles`, 'must not be empty');
    const seenProfiles = new Set<string>();
    profiles.forEach((profile, index) => {
      const parsed = asEnum(profile, WALL_PROFILES, `${path}.wallOpeningCompatibility.permittedProfiles[${index}]`);
      if (seenProfiles.has(parsed)) reject(`${path}.wallOpeningCompatibility.permittedProfiles[${index}]`, 'duplicates an earlier profile');
      seenProfiles.add(parsed);
    });
    const thicknesses = asArray(compatibility.permittedThicknessU, `${path}.wallOpeningCompatibility.permittedThicknessU`);
    if (thicknesses.length === 0) reject(`${path}.wallOpeningCompatibility.permittedThicknessU`, 'must not be empty');
    const seenThicknesses = new Set<number>();
    thicknesses.forEach((thickness, index) => {
      const parsed = asInteger(thickness, `${path}.wallOpeningCompatibility.permittedThicknessU[${index}]`,
        ARCHITECTURE_LIMITS.minimumWallThicknessU, ARCHITECTURE_LIMITS.maximumWallThicknessU);
      if (seenThicknesses.has(parsed)) reject(`${path}.wallOpeningCompatibility.permittedThicknessU[${index}]`, 'duplicates an earlier thickness');
      seenThicknesses.add(parsed);
    });
    asEnum(compatibility.portalClass, PORTAL_CLASSES, `${path}.wallOpeningCompatibility.portalClass`);
  } else if (entry.wallOpeningCompatibility !== undefined) {
    reject(`${path}.wallOpeningCompatibility`, 'is only valid for a wall opening kit');
  }
  validateAssetRefs(entry.assetRefs, `${path}.assetRefs`);
}

export function validateArchitectureCatalog(entries: unknown): asserts entries is readonly ArchitectureCatalogEntry[] {
  const rows = asArray(entries, 'architectureCatalog', ARCHITECTURE_LIMITS.maximumCatalogEntries);
  const catalogIds = new Set<string>();
  rows.forEach((entry, index) => {
    const path = `architectureCatalog[${index}]`;
    validateArchitectureCatalogEntry(entry, path);
    if (catalogIds.has(entry.catalogId)) reject(`${path}.catalogId`, 'duplicates an earlier catalog ID');
    catalogIds.add(entry.catalogId);
  });
}

export function validateArchitectureCatalogQuery(value: unknown): asserts value is ArchitectureCatalogQuery {
  const path = 'architectureCatalogQuery';
  const query = exactRecord(value, path, ['family'], [
    'role', 'semanticKind', 'requiredThemeTags', 'requiredGameplayTags',
    'maximumWidthU', 'maximumHeightU', 'wallProfile', 'wallThicknessU',
  ]);
  const family = asEnum(query.family, ARCHITECTURE_FAMILIES, `${path}.family`);
  const role = query.role === undefined ? undefined : asEnum(query.role, ARCHITECTURE_ROLES, `${path}.role`);
  if (role !== undefined && !familyRoleCompatible(family, role)) reject(`${path}.role`, 'is incompatible with the selected family');
  if (query.semanticKind !== undefined) {
    const semanticRole = role ?? (family === 'wall' ? 'opening' : 'style');
    validateSemanticKind(family, semanticRole, query.semanticKind, `${path}.semanticKind`);
  }
  if (query.requiredThemeTags !== undefined) validateStringList(query.requiredThemeTags, `${path}.requiredThemeTags`, {
    maximumCount: ARCHITECTURE_LIMITS.maximumTagsPerEntry,
    maximumBytes: ARCHITECTURE_LIMITS.maximumTagBytes,
  });
  if (query.requiredGameplayTags !== undefined) validateStringList(query.requiredGameplayTags, `${path}.requiredGameplayTags`, {
    maximumCount: ARCHITECTURE_LIMITS.maximumTagsPerEntry,
    maximumBytes: ARCHITECTURE_LIMITS.maximumTagBytes,
  });
  if (query.maximumWidthU !== undefined) asUnit(query.maximumWidthU, `${path}.maximumWidthU`);
  if (query.maximumHeightU !== undefined) asUnit(query.maximumHeightU, `${path}.maximumHeightU`);
  if (query.wallProfile !== undefined) asEnum(query.wallProfile, WALL_PROFILES, `${path}.wallProfile`);
  if (query.wallThicknessU !== undefined) asInteger(query.wallThicknessU, `${path}.wallThicknessU`,
    ARCHITECTURE_LIMITS.minimumWallThicknessU, ARCHITECTURE_LIMITS.maximumWallThicknessU);
}

function validateFinish(value: unknown, path: string): void {
  const finish = exactRecord(value, path, ['materialId']);
  asString(finish.materialId, `${path}.materialId`);
}

function validateOpening(value: unknown, path: string, sourceIds: Set<string>): void {
  const opening = exactRecord(value, path,
    ['id', 'kind', 'kitId', 'columnU', 'rowU', 'facingSide', 'hinge']);
  const id = asString(opening.id, `${path}.id`);
  if (sourceIds.has(id)) reject(`${path}.id`, 'duplicates another source ID');
  sourceIds.add(id);
  asEnum(opening.kind, WALL_OPENING_KINDS, `${path}.kind`);
  asString(opening.kitId, `${path}.kitId`);
  asUnit(opening.columnU, `${path}.columnU`);
  asUnit(opening.rowU, `${path}.rowU`);
  asEnum(opening.facingSide, WALL_SIDES, `${path}.facingSide`);
  asEnum(opening.hinge, WALL_HINGES, `${path}.hinge`);
}

export function validateArchitectureSource(value: unknown): asserts value is ArchitectureSource {
  const root = exactRecord(value, 'architecture', ['version', 'revision', 'walls']);
  if (root.version !== ARCHITECTURE_SOURCE_VERSION) reject('architecture.version', 'must equal 1');
  asInteger(root.revision, 'architecture.revision', 0, 0xffff_ffff);
  const walls = exactRecord(root.walls, 'architecture.walls', ['vertices', 'edges', 'anchors']);
  const vertices = asArray(walls.vertices, 'architecture.walls.vertices', ARCHITECTURE_LIMITS.maximumVertices);
  const edges = asArray(walls.edges, 'architecture.walls.edges', ARCHITECTURE_LIMITS.maximumEdges);
  const anchors = asArray(walls.anchors, 'architecture.walls.anchors', ARCHITECTURE_LIMITS.maximumAnchors);

  const sourceIds = new Set<string>();
  const vertexFloors = new Map<string, number>();
  const vertexRows = new Map<string, WallVertex>();
  vertices.forEach((candidate, index) => {
    const path = `architecture.walls.vertices[${index}]`;
    const vertex = exactRecord(candidate, path, ['id', 'floor', 'xU', 'zU']);
    const id = asString(vertex.id, `${path}.id`);
    if (sourceIds.has(id)) reject(`${path}.id`, 'duplicates another source ID');
    sourceIds.add(id);
    const floor = asInteger(vertex.floor, `${path}.floor`,
      -ARCHITECTURE_LIMITS.maximumFloorMagnitude, ARCHITECTURE_LIMITS.maximumFloorMagnitude);
    asUnit(vertex.xU, `${path}.xU`);
    asUnit(vertex.zU, `${path}.zU`);
    vertexFloors.set(id, floor);
    vertexRows.set(id, vertex as unknown as WallVertex);
  });

  const edgeIds = new Set<string>();
  let openingCount = 0;
  edges.forEach((candidate, index) => {
    const path = `architecture.walls.edges[${index}]`;
    const edge = exactRecord(candidate, path, [
      'id', 'startVertexId', 'endVertexId', 'support', 'heightU', 'thicknessU',
      'profile', 'styleId', 'sideA', 'sideB', 'openings',
    ]);
    const id = asString(edge.id, `${path}.id`);
    if (sourceIds.has(id)) reject(`${path}.id`, 'duplicates another source ID');
    sourceIds.add(id);
    edgeIds.add(id);
    const startId = asString(edge.startVertexId, `${path}.startVertexId`);
    const endId = asString(edge.endVertexId, `${path}.endVertexId`);
    const startFloor = vertexFloors.get(startId);
    const endFloor = vertexFloors.get(endId);
    if (startFloor === undefined) reject(`${path}.startVertexId`, 'does not reference a vertex');
    if (endFloor === undefined) reject(`${path}.endVertexId`, 'does not reference a vertex');
    if (startFloor !== endFloor) reject(path, 'cannot connect vertices on different floors');
    const start = vertexRows.get(startId)!;
    const end = vertexRows.get(endId)!;
    const deltaX = end.xU - start.xU;
    const deltaZ = end.zU - start.zU;
    if (deltaX * deltaX + deltaZ * deltaZ < ARCHITECTURE_LIMITS.minimumWallLengthU ** 2) {
      reject(path, `must be at least ${ARCHITECTURE_LIMITS.minimumWallLengthU} u long`);
    }
    const support = exactRecord(edge.support, `${path}.support`, ['kind', 'baseYU']);
    if (support.kind !== 'absolute') reject(`${path}.support.kind`, "v1 support must equal 'absolute'");
    asUnit(support.baseYU, `${path}.support.baseYU`);
    asInteger(edge.heightU, `${path}.heightU`, ARCHITECTURE_LIMITS.minimumWallHeightU, ARCHITECTURE_LIMITS.maximumWallHeightU);
    asInteger(edge.thicknessU, `${path}.thicknessU`, ARCHITECTURE_LIMITS.minimumWallThicknessU, ARCHITECTURE_LIMITS.maximumWallThicknessU);
    asEnum(edge.profile, WALL_PROFILES, `${path}.profile`);
    asString(edge.styleId, `${path}.styleId`);
    validateFinish(edge.sideA, `${path}.sideA`);
    validateFinish(edge.sideB, `${path}.sideB`);
    const openings = asArray(edge.openings, `${path}.openings`);
    openingCount += openings.length;
    if (openingCount > ARCHITECTURE_LIMITS.maximumOpenings) reject(`${path}.openings`, 'exceeds the source opening limit');
    openings.forEach((opening, openingIndex) => validateOpening(opening, `${path}.openings[${openingIndex}]`, sourceIds));
  });

  anchors.forEach((candidate, index) => {
    const path = `architecture.walls.anchors[${index}]`;
    const anchor = exactRecord(candidate, path,
      ['id', 'edgeId', 'side', 'columnU', 'rowU', 'targetPieceId']);
    const id = asString(anchor.id, `${path}.id`);
    if (sourceIds.has(id)) reject(`${path}.id`, 'duplicates another source ID');
    sourceIds.add(id);
    const edgeId = asString(anchor.edgeId, `${path}.edgeId`);
    if (!edgeIds.has(edgeId)) reject(`${path}.edgeId`, 'does not reference a wall edge');
    asEnum(anchor.side, WALL_SIDES, `${path}.side`);
    asUnit(anchor.columnU, `${path}.columnU`);
    asUnit(anchor.rowU, `${path}.rowU`);
    asString(anchor.targetPieceId, `${path}.targetPieceId`);
  });
}

export function parseArchitectureSource(value: unknown): ArchitectureSource {
  validateArchitectureSource(value);
  return value;
}

export function emptyArchitectureSource(): ArchitectureSource {
  return { version: ARCHITECTURE_SOURCE_VERSION, revision: 0, walls: { vertices: [], edges: [], anchors: [] } };
}

export function cloneArchitectureSource(source: ArchitectureSource): ArchitectureSource {
  validateArchitectureSource(source);
  return {
    version: ARCHITECTURE_SOURCE_VERSION,
    revision: source.revision,
    walls: {
      vertices: source.walls.vertices.map(vertex => ({ ...vertex })),
      edges: source.walls.edges.map(edge => ({
        ...edge,
        support: { ...edge.support },
        sideA: { ...edge.sideA },
        sideB: { ...edge.sideB },
        openings: edge.openings.map(opening => ({ ...opening })),
      })),
      anchors: source.walls.anchors.map(anchor => ({ ...anchor })),
    },
  };
}

export type ArchitectureIndex = {
  vertices: ReadonlyMap<string, WallVertex>;
  edges: ReadonlyMap<string, WallEdge>;
  openings: ReadonlyMap<string, { edge: WallEdge; opening: WallOpening }>;
  anchors: ReadonlyMap<string, WallAnchor>;
};

export function indexArchitectureSource(source: ArchitectureSource): ArchitectureIndex {
  validateArchitectureSource(source);
  const vertices = new Map(source.walls.vertices.map(vertex => [vertex.id, vertex]));
  const edges = new Map(source.walls.edges.map(edge => [edge.id, edge]));
  const openings = new Map<string, { edge: WallEdge; opening: WallOpening }>();
  source.walls.edges.forEach(edge => edge.openings.forEach(opening => openings.set(opening.id, { edge, opening })));
  const anchors = new Map(source.walls.anchors.map(anchor => [anchor.id, anchor]));
  return { vertices, edges, openings, anchors };
}

export function requireWallVertex(source: ArchitectureSource, vertexId: string): WallVertex {
  return indexArchitectureSource(source).vertices.get(vertexId)
    ?? reject('vertexId', `unknown wall vertex '${vertexId}'`);
}

export function requireWallEdge(source: ArchitectureSource, edgeId: string): WallEdge {
  return indexArchitectureSource(source).edges.get(edgeId)
    ?? reject('edgeId', `unknown wall edge '${edgeId}'`);
}

export function requireWallOpening(source: ArchitectureSource, openingId: string): { edge: WallEdge; opening: WallOpening } {
  return indexArchitectureSource(source).openings.get(openingId)
    ?? reject('openingId', `unknown wall opening '${openingId}'`);
}

export function requireWallAnchor(source: ArchitectureSource, anchorId: string): WallAnchor {
  return indexArchitectureSource(source).anchors.get(anchorId)
    ?? reject('anchorId', `unknown wall anchor '${anchorId}'`);
}

export function requireWallEdgeSide(
  source: ArchitectureSource,
  edgeId: string,
  side: WallSide,
): { edge: WallEdge; side: WallSide; finish: WallSideFinish } {
  const edge = requireWallEdge(source, edgeId);
  return { edge, side, finish: side === 'a' ? edge.sideA : edge.sideB };
}

export function summarizeArchitecture(source: ArchitectureSource): ArchitectureSummary {
  validateArchitectureSource(source);
  const floors = [...new Set(source.walls.vertices.map(vertex => vertex.floor))].sort((a, b) => a - b);
  let bounds: ArchitectureSummary['boundsU'] = null;
  const include = (xU: number, yU: number, zU: number): void => {
    if (bounds === null) {
      bounds = { minXU: xU, minYU: yU, minZU: zU, maxXU: xU, maxYU: yU, maxZU: zU };
      return;
    }
    bounds.minXU = Math.min(bounds.minXU, xU);
    bounds.minYU = Math.min(bounds.minYU, yU);
    bounds.minZU = Math.min(bounds.minZU, zU);
    bounds.maxXU = Math.max(bounds.maxXU, xU);
    bounds.maxYU = Math.max(bounds.maxYU, yU);
    bounds.maxZU = Math.max(bounds.maxZU, zU);
  };
  const vertices = new Map(source.walls.vertices.map(vertex => [vertex.id, vertex]));
  source.walls.edges.forEach(edge => {
    const start = vertices.get(edge.startVertexId)!;
    const end = vertices.get(edge.endVertexId)!;
    const baseYU = edge.support.baseYU;
    include(start.xU, baseYU, start.zU);
    include(start.xU, baseYU + edge.heightU, start.zU);
    include(end.xU, baseYU, end.zU);
    include(end.xU, baseYU + edge.heightU, end.zU);
  });
  if (bounds === null) source.walls.vertices.forEach(vertex => include(vertex.xU, 0, vertex.zU));
  return {
    revision: source.revision,
    vertexCount: source.walls.vertices.length,
    edgeCount: source.walls.edges.length,
    openingCount: source.walls.edges.reduce((count, edge) => count + edge.openings.length, 0),
    anchorCount: source.walls.anchors.length,
    floors,
    boundsU: bounds,
  };
}

export const EMPTY_ARCHITECTURE_SELECTION: ArchitectureSelection = Object.freeze({ kind: 'none' });
export const DEFAULT_ARCHITECTURE_TOOL: ArchitectureToolState = Object.freeze({ kind: 'select' });
