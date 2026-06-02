// projects.ts — the multi-map side of the workspace.
//
// hmsc-int is a workspace of MANY maps (the city, every building interior, ...),
// not one world. Each map is a named project stored as its own session file via
// the workspace layer (runtime/workspace): cart/hmsc-int/sessions/<name>.session.json.
// This module is the directory-level CRUD over that set — list / exists / delete /
// name hygiene. Opening + saving a map's CONTENT goes through the workspace hook +
// the map codec (mapStore.ts); this file only manages the SET of maps.

import { listDir, remove, exists } from '@reactjit/hooks/fs';
import { sessionsDirFor, sessionPathFor } from '@reactjit/workspace';

const CART = 'hmsc-int';
const SUFFIX = '.session.json';

/** Every saved map's name, sorted. (Filters the _last.txt pointer + anything
 *  that isn't a session file.) */
export function listMaps(): string[] {
  let entries: string[] = [];
  try { entries = listDir(sessionsDirFor(CART)) ?? []; } catch { entries = []; }
  return entries
    .filter((e) => e.endsWith(SUFFIX))
    .map((e) => e.slice(0, -SUFFIX.length))
    .sort();
}

export function mapExists(name: string): boolean {
  return exists(sessionPathFor(CART, name));
}

export function deleteMap(name: string): boolean {
  return remove(sessionPathFor(CART, name));
}

// A user-typed name → a filename-safe stem (lowercase, dashed, ascii). Empty
// input degrades to 'untitled' so a map always has a valid name.
export function sanitizeMapName(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_ ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'untitled';
}

// A fresh name that doesn't collide with an existing map: 'untitled',
// 'untitled-2', 'untitled-3', ...
export function uniqueMapName(base = 'untitled'): string {
  const b = sanitizeMapName(base);
  if (!mapExists(b)) return b;
  let i = 2;
  while (mapExists(`${b}-${i}`)) i++;
  return `${b}-${i}`;
}
