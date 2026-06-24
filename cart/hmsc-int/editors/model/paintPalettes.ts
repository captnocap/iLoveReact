// editors/model/paintPalettes.ts — DURABLE palette storage for the mesh painter,
// shared across every model (req_1729). Two long-standing gripes this cures:
//
//   • The recents ring lived in twig hot-state, so it RESET on every cold start
//     ("the palette history is ephemeral and wipes regularly"). Now it write-throughs
//     to localstore and re-hydrates on boot.
//   • There was no way to keep a set of colours AROUND across different assets. Saved
//     palettes are named colour sets in the shared 'reactjit' localstore — save the
//     colours you like once, load them onto any model you open next.
//
// localstore is ONE store across carts (fs.init("reactjit"), see the
// hmsc_localstore_shared_across_carts memory), so these survive restart and follow
// you between models. Pure I/O over localstore — no React, no host.

import * as localstore from '@reactjit/hooks/localstore';

const RECENTS_KEY = 'studio:paint:recents';
const SAVED_KEY = 'studio:paint:saved-palettes';
/** generous so a working session's colours aren't evicted — recents are the
 *  HISTORY the user complained about losing, not a tiny scratch ring. */
const RECENTS_CAP = 24;

/** A named, durable set of colours the user keeps around between models. */
export type SavedPalette = { id: string; name: string; colors: string[] };

function normHex(hex: string): string { return hex.trim().toLowerCase(); }

/** De-duped, capped, lower-cased hex list. */
function cleanColors(colors: string[], cap = RECENTS_CAP): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of colors) {
    const h = normHex(c);
    if (!h || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
    if (out.length >= cap) break;
  }
  return out;
}

// ── Recents (persisted) ──────────────────────────────────────────────────────

export function loadRecents(): string[] {
  return cleanColors(localstore.getJson<string[]>(RECENTS_KEY, []));
}

export function saveRecents(colors: string[]): void {
  localstore.setJson(RECENTS_KEY, cleanColors(colors));
}

// ── Saved palettes (persisted, named, cross-asset) ───────────────────────────

export function loadSavedPalettes(): SavedPalette[] {
  const list = localstore.getJson<SavedPalette[]>(SAVED_KEY, []);
  return Array.isArray(list) ? list.filter((p) => p && Array.isArray(p.colors)) : [];
}

function persist(list: SavedPalette[]): void {
  localstore.setJson(SAVED_KEY, list);
}

/** Save (or overwrite, by name) a named colour set. Returns the updated list. */
export function saveNamedPalette(name: string, colors: string[]): SavedPalette[] {
  const clean = cleanColors(colors, 64);
  if (!clean.length) return loadSavedPalettes();
  const trimmed = name.trim() || 'palette';
  const id = `pal:${trimmed.toLowerCase()}`;
  const list = loadSavedPalettes().filter((p) => p.id !== id);
  list.unshift({ id, name: trimmed, colors: clean });
  persist(list);
  return list;
}

/** Forget a saved palette by id. Returns the updated list. */
export function deleteSavedPalette(id: string): SavedPalette[] {
  const list = loadSavedPalettes().filter((p) => p.id !== id);
  persist(list);
  return list;
}
