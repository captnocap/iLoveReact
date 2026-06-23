import {
  IMPORTED_PROP_KINDS,
  IMPORTED_PROP_MESHES,
  type ImportedPropKind,
  type ImportedPropMesh,
} from './importedProps.generated';

const IMPORTED_SET = new Set<string>(IMPORTED_PROP_KINDS as readonly string[]);

export { IMPORTED_PROP_KINDS, IMPORTED_PROP_MESHES };
export type { ImportedPropKind, ImportedPropMesh };

export function isImportedPropKind(value: string): value is ImportedPropKind {
  return IMPORTED_SET.has(value);
}

export function importedPropMesh(kind: string): ImportedPropMesh | null {
  return isImportedPropKind(kind) ? IMPORTED_PROP_MESHES[kind] ?? null : null;
}
