// Measured architecture-kit manifest projection and catalog presentation.
//
// Native owns validation, installation, and structured query matching. This module
// performs one strict disk-manifest projection, then turns native readback rows into
// hierarchy/search/palette views without parsing IDs for behavior.

import { architectureHost } from './architectureHost';
import {
  ArchitectureValidationError,
  validateArchitectureCatalog,
  validateArchitectureCatalogQuery,
  validateArchitectureKitDeclaration,
  type ArchitectureCatalogEntry,
  type ArchitectureCatalogQuery,
  type ArchitectureFamily,
  type ArchitectureKitPlaceable,
  type ArchitectureKitRole,
  type ArchitectureKitMeasurement,
} from './architecture';

export type ArchitectureManifestPackage = {
  id: string;
  name: string;
  placeable?: unknown;
  /** Stored paintings dress the one entry and never create additional rows. */
  paints?: readonly unknown[];
};

export type ArchitectureCatalogNative = {
  installCatalog(entries: readonly ArchitectureCatalogEntry[]): void;
  queryCatalog(query: ArchitectureCatalogQuery): number[];
  readCatalog(): ArchitectureCatalogEntry[];
};

export type ArchitecturePaletteRow = {
  catalogId: string;
  contentHash: string;
  label: string;
  family: ArchitectureFamily;
  role: ArchitectureKitRole;
  semanticKind?: string;
  categoryPath: readonly string[];
  themeTags: readonly string[];
  gameplayTags: readonly string[];
};

export type ArchitectureCategoryNode = {
  id: string;
  label: string;
  path: readonly string[];
  children: readonly ArchitectureCategoryNode[];
  rows: readonly ArchitecturePaletteRow[];
};

const DEFAULT_NATIVE: ArchitectureCatalogNative = {
  installCatalog: entries => architectureHost.installCatalog(entries as Parameters<typeof architectureHost.installCatalog>[0]),
  queryCatalog: query => architectureHost.queryCatalog(query as Parameters<typeof architectureHost.queryCatalog>[0]),
  readCatalog: () => architectureHost.readCatalog() as ArchitectureCatalogEntry[],
};

function fail(path: string, message: string): never {
  throw new ArchitectureValidationError(path, message);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(path, 'must be an object');
  return value as Record<string, unknown>;
}

function exactInstall(value: unknown, path: string): ArchitectureKitPlaceable['install'] {
  const install = asRecord(value, path);
  const allowed = new Set([
    'catalogId', 'contentHash', 'assetRefs', 'wallStyleProfile', 'wallOpeningCompatibility',
  ]);
  Object.keys(install).forEach(key => {
    if (!allowed.has(key)) fail(`${path}.${key}`, 'is not an architecture install field');
  });
  ['catalogId', 'contentHash', 'assetRefs'].forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(install, key)) fail(`${path}.${key}`, 'is required');
  });
  return install as ArchitectureKitPlaceable['install'];
}

export function normalizeArchitectureFamily(family: ArchitectureKitPlaceable['family']): ArchitectureFamily {
  return family === 'vertical-link' ? 'verticalLink' : family;
}

export function normalizeArchitectureRole(role: ArchitectureKitPlaceable['role']): ArchitectureKitRole {
  return role === 'door-leaf' ? 'doorLeaf' : role;
}

function cloneMeasurement(measurement: ArchitectureKitMeasurement): ArchitectureKitMeasurement {
  return {
    sourceBoundsU: { ...measurement.sourceBoundsU },
    ...(measurement.mountBoundsU ? { mountBoundsU: { ...measurement.mountBoundsU } } : {}),
    ...(measurement.footprint ? { footprint: { ...measurement.footprint } } : {}),
    ...(measurement.occupiedMask ? { occupiedMask: measurement.occupiedMask.map(cell => ({ ...cell })) } : {}),
    clearanceMask: measurement.clearanceMask.map(cell => ({ ...cell })),
    pivotU: { ...measurement.pivotU },
  };
}

export function projectArchitectureCatalogEntry(pkg: ArchitectureManifestPackage): ArchitectureCatalogEntry | null {
  if (typeof pkg.placeable !== 'object' || pkg.placeable === null
    || (pkg.placeable as { as?: unknown }).as !== 'architecture-kit') return null;
  const placeable = pkg.placeable as ArchitectureKitPlaceable;
  const { install: rawInstall, ...declaration } = placeable;
  validateArchitectureKitDeclaration(declaration);
  const install = exactInstall(rawInstall, `package[${pkg.id}].placeable.install`);
  const family = normalizeArchitectureFamily(placeable.family);
  const role = normalizeArchitectureRole(placeable.role);
  const wallStyle = family === 'wall' && role === 'style';
  const wallOpening = family === 'wall' && role === 'opening';

  if (wallStyle && install.wallStyleProfile === undefined) {
    fail(`package[${pkg.id}].placeable.install.wallStyleProfile`, 'is required for a wall style');
  }
  if (!wallStyle && install.wallStyleProfile !== undefined) {
    fail(`package[${pkg.id}].placeable.install.wallStyleProfile`, 'is only valid for a wall style');
  }
  if (wallOpening && install.wallOpeningCompatibility === undefined) {
    fail(`package[${pkg.id}].placeable.install.wallOpeningCompatibility`, 'is required for a wall opening kit');
  }
  if (!wallOpening && install.wallOpeningCompatibility !== undefined) {
    fail(`package[${pkg.id}].placeable.install.wallOpeningCompatibility`, 'is only valid for a wall opening kit');
  }

  const sourceBounds = placeable.measurement.sourceBoundsU;
  const entry: ArchitectureCatalogEntry = {
    catalogId: install.catalogId,
    contentHash: install.contentHash,
    packageId: pkg.id,
    label: pkg.name,
    family,
    role,
    ...(placeable.semanticKind ? { semanticKind: placeable.semanticKind } : {}),
    categoryPath: [...placeable.catalogPath],
    themeTags: [...placeable.themeTags],
    gameplayTags: [...placeable.gameplayTags],
    measurement: cloneMeasurement(placeable.measurement),
    ...(wallStyle ? {
      wallStyleDefaults: {
        heightU: Math.ceil(sourceBounds.maxYU) - Math.floor(sourceBounds.minYU),
        thicknessU: Math.ceil(sourceBounds.maxZU) - Math.floor(sourceBounds.minZU),
        profile: install.wallStyleProfile!,
      },
    } : {}),
    ...(wallOpening ? {
      wallOpeningCompatibility: {
        permittedProfiles: [...install.wallOpeningCompatibility!.permittedProfiles],
        permittedThicknessU: [...install.wallOpeningCompatibility!.permittedThicknessU],
        portalClass: install.wallOpeningCompatibility!.portalClass,
      },
    } : {}),
    assetRefs: {
      meshContentHash: install.assetRefs.meshContentHash,
      materialContentHashes: [...install.assetRefs.materialContentHashes],
      ...(install.assetRefs.animationContentHash ? { animationContentHash: install.assetRefs.animationContentHash } : {}),
    },
  };
  validateArchitectureCatalog([entry]);
  return entry;
}

export function projectArchitectureCatalog(packages: readonly ArchitectureManifestPackage[]): ArchitectureCatalogEntry[] {
  const entries = packages.flatMap(pkg => {
    const entry = projectArchitectureCatalogEntry(pkg);
    return entry ? [entry] : [];
  });
  validateArchitectureCatalog(entries);
  entries.sort((left, right) => left.catalogId.localeCompare(right.catalogId)
    || left.contentHash.localeCompare(right.contentHash));
  return entries;
}

export function installArchitectureCatalogFromPackages(
  packages: readonly ArchitectureManifestPackage[],
  native: ArchitectureCatalogNative = DEFAULT_NATIVE,
): ArchitectureCatalogEntry[] {
  const entries = projectArchitectureCatalog(packages);
  native.installCatalog(entries);
  return entries;
}

export function structuredArchitectureCatalogQuery(query: ArchitectureCatalogQuery): ArchitectureCatalogQuery {
  validateArchitectureCatalogQuery(query);
  return {
    family: query.family,
    ...(query.role ? { role: query.role } : {}),
    ...(query.semanticKind ? { semanticKind: query.semanticKind } : {}),
    ...(query.requiredThemeTags ? { requiredThemeTags: [...query.requiredThemeTags] } : {}),
    ...(query.requiredGameplayTags ? { requiredGameplayTags: [...query.requiredGameplayTags] } : {}),
    ...(query.maximumWidthU !== undefined ? { maximumWidthU: query.maximumWidthU } : {}),
    ...(query.maximumHeightU !== undefined ? { maximumHeightU: query.maximumHeightU } : {}),
    ...(query.wallProfile ? { wallProfile: query.wallProfile } : {}),
    ...(query.wallThicknessU !== undefined ? { wallThicknessU: query.wallThicknessU } : {}),
  };
}

function rowsAtIndices(entries: readonly ArchitectureCatalogEntry[], indices: readonly number[]): ArchitectureCatalogEntry[] {
  const seen = new Set<number>();
  return indices.map((index, position) => {
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
      return fail(`catalogQueryResult[${position}]`, `index ${index} is outside native catalog readback`);
    }
    if (seen.has(index)) fail(`catalogQueryResult[${position}]`, `duplicates native result index ${index}`);
    seen.add(index);
    return entries[index]!;
  });
}

export function queryInstalledArchitectureCatalog(
  query: ArchitectureCatalogQuery,
  native: ArchitectureCatalogNative = DEFAULT_NATIVE,
): ArchitectureCatalogEntry[] {
  const request = structuredArchitectureCatalogQuery(query);
  const indices = native.queryCatalog(request);
  const entries = native.readCatalog();
  validateArchitectureCatalog(entries);
  return rowsAtIndices(entries, indices);
}

export function architecturePaletteRows(entries: readonly ArchitectureCatalogEntry[]): ArchitecturePaletteRow[] {
  validateArchitectureCatalog(entries);
  return entries.map(entry => ({
    catalogId: entry.catalogId,
    contentHash: entry.contentHash,
    label: entry.label,
    family: entry.family,
    role: entry.role,
    ...(entry.semanticKind ? { semanticKind: entry.semanticKind } : {}),
    categoryPath: [...entry.categoryPath],
    themeTags: [...entry.themeTags],
    gameplayTags: [...entry.gameplayTags],
  }));
}

export function queryArchitecturePalette(
  query: ArchitectureCatalogQuery,
  native: ArchitectureCatalogNative = DEFAULT_NATIVE,
): ArchitecturePaletteRow[] {
  return architecturePaletteRows(queryInstalledArchitectureCatalog(query, native));
}

export function searchArchitectureCatalog(
  entries: readonly ArchitectureCatalogEntry[],
  search: string,
): ArchitecturePaletteRow[] {
  const needle = search.trim().toLowerCase();
  const rows = architecturePaletteRows(entries);
  if (!needle) return rows;
  return rows.filter(row => [
    row.label,
    ...row.categoryPath,
    ...row.themeTags,
    ...row.gameplayTags,
  ].some(value => value.toLowerCase().includes(needle)));
}

type MutableCategoryNode = {
  id: string;
  label: string;
  path: string[];
  children: Map<string, MutableCategoryNode>;
  rows: ArchitecturePaletteRow[];
};

function finalizedNode(node: MutableCategoryNode): ArchitectureCategoryNode {
  return {
    id: node.id,
    label: node.label,
    path: node.path,
    children: [...node.children.values()]
      .sort((left, right) => left.label.localeCompare(right.label))
      .map(finalizedNode),
    rows: [...node.rows].sort((left, right) => left.catalogId.localeCompare(right.catalogId)
      || left.contentHash.localeCompare(right.contentHash)),
  };
}

export function architectureCatalogHierarchy(entries: readonly ArchitectureCatalogEntry[]): ArchitectureCategoryNode[] {
  const roots = new Map<string, MutableCategoryNode>();
  for (const row of architecturePaletteRows(entries)) {
    let siblings = roots;
    let parent: MutableCategoryNode | null = null;
    const path: string[] = [];
    for (const segment of row.categoryPath) {
      path.push(segment);
      let node = siblings.get(segment);
      if (!node) {
        node = { id: `architecture-category:${path.join('/')}`, label: segment, path: [...path], children: new Map(), rows: [] };
        siblings.set(segment, node);
      }
      parent = node;
      siblings = node.children;
    }
    if (!parent) fail(`catalog[${row.catalogId}].categoryPath`, 'cannot be empty');
    parent.rows.push(row);
  }
  return [...roots.values()]
    .sort((left, right) => left.label.localeCompare(right.label))
    .map(finalizedNode);
}
