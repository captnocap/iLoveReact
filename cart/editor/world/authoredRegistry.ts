// world/authoredRegistry.ts — the live registry of AUTHORED placeables
// (req_2577/2578 build pieces + req_2712 props): meshes the user exported "as a
// wall piece" / "as a prop", which are placeable in the build bar and render
// their own real mesh. A build piece snaps by its base kind's affinity; a prop
// free-places on the ground.
//
// SOURCE OF TRUTH is the on-disk model package (manifest.placeable — USER RULING
// req_2718); EditorState carries the live list (seeded from the disk scan) and
// AppFrame mirrors it here on change so the pure placement/render helpers
// (pieces.ts, WorldViewport) can resolve an authored piece by id without
// threading EditorState through every call — the same module-level pattern
// buildCatalog uses.
import { catalogByKind, catalogRowFor, rowHex, KIND_LABEL, KIND_ORDER, type BuildKind } from './buildCatalog';

/** Everything a placeable can BE: a build-piece affinity, or a free-placing prop. */
export type PlaceableKind = BuildKind | 'prop';
export const PROP_KIND_LABEL = 'Props';

export type AuthoredBuildPiece = {
  /** the placeable id — `model:<modelId>` (build piece) or `prop:<modelId>`
   *  (prop), so one model can export as both without colliding. */
  id: string;
  /** the stored model this piece renders (the resident-mesh key). */
  modelId: string;
  /** the model PACKAGE id (e.g. 'studio:mdl-…') — lets the mesh resolver find the
   *  package (and thus its blob/parts) on a cold boot when the export cache is gone. */
  pkgId: string;
  label: string;
  /** base-piece affinity (drives grid snap, edge vs grid) — or 'prop' (free place). */
  kind: PlaceableKind;
  /** swatch colour for the build-bar chip. */
  hex: string;
};

let AUTHORED: AuthoredBuildPiece[] = [];
let BY_ID = new Map<string, AuthoredBuildPiece>();

/** The id namespace for an authored (mesh) placeable, split by what it exports as. */
export function authoredIdFor(modelId: string, kind: PlaceableKind): string {
  return kind === 'prop' ? `prop:${modelId}` : `model:${modelId}`;
}

export function isAuthoredPiece(pieceId: string): boolean {
  return pieceId.startsWith('model:') || pieceId.startsWith('prop:');
}

/** `model:<modelId>` / `prop:<modelId>` → the stored model id (the resident-mesh
 *  + ref key). The ONE place the namespaces strip. */
export function authoredModelIdOf(pieceId: string): string {
  return pieceId.slice(pieceId.indexOf(':') + 1);
}

/** Mirror EditorState.authoredBuildPieces here (called from AppFrame on change). */
export function setAuthoredPieces(list: readonly AuthoredBuildPiece[]): void {
  AUTHORED = list.slice();
  BY_ID = new Map(AUTHORED.map((p) => [p.id, p]));
}

export function authoredList(): readonly AuthoredBuildPiece[] {
  return AUTHORED;
}

export function authoredPieceFor(pieceId: string): AuthoredBuildPiece | null {
  return BY_ID.get(pieceId) ?? null;
}

/** The base kind of any placeable id — authored affinity/prop or catalog kind. */
export function placeableKind(pieceId: string): PlaceableKind | undefined {
  return authoredPieceFor(pieceId)?.kind ?? catalogRowFor(pieceId)?.kind;
}

// ── the build bar's unified source: catalog pieces + authored placeables ──────
export type PlaceableEntry = { id: string; label: string; hex: string; authored: boolean };
export type PlaceableGroup = { kind: PlaceableKind; label: string; entries: PlaceableEntry[] };

/** Every placeable grouped by kind: catalog rows first, then authored pieces of
 *  that same affinity (so an exported "wall piece" sits under Wall), and every
 *  exported PROP under its own trailing Props category. */
export function placeablesByKind(): PlaceableGroup[] {
  const byKind = new Map<PlaceableKind, PlaceableEntry[]>();
  for (const g of catalogByKind()) {
    byKind.set(g.kind, g.rows.map((r) => ({ id: r.id, label: r.label, hex: rowHex(r), authored: false })));
  }
  for (const ap of AUTHORED) {
    const list = byKind.get(ap.kind) ?? [];
    list.push({ id: ap.id, label: ap.label, hex: ap.hex, authored: true });
    byKind.set(ap.kind, list);
  }
  const groups: PlaceableGroup[] = KIND_ORDER
    .filter((k) => byKind.has(k))
    .map((k) => ({ kind: k, label: KIND_LABEL[k], entries: byKind.get(k)! }));
  const props = byKind.get('prop');
  if (props?.length) groups.push({ kind: 'prop', label: PROP_KIND_LABEL, entries: props });
  return groups;
}
