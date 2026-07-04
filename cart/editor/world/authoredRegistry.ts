// world/authoredRegistry.ts — the live registry of AUTHORED build pieces
// (req_2577/2578): meshes the user exported "as a wall piece" (etc.), which are
// placeable in the build bar and snap by the base kind's affinity while rendering
// their own real mesh.
//
// The authoritative list lives in EditorState (persisted); AppFrame mirrors it
// here on change so the pure placement/render helpers (pieces.ts, WorldViewport)
// can resolve an authored piece by id without threading EditorState through every
// call — the same module-level pattern buildCatalog uses.
import { catalogByKind, catalogRowFor, rowHex, KIND_LABEL, KIND_ORDER, type BuildKind } from './buildCatalog';

export type AuthoredBuildPiece = {
  /** the placeable id, namespaced `model:<modelId>` (distinct from catalog ids). */
  id: string;
  /** the stored model this piece renders (the resident-mesh key). */
  modelId: string;
  /** the model PACKAGE id (e.g. 'studio:mdl-…') — lets the mesh resolver find the
   *  package (and thus its blob/parts) on a cold boot when the export cache is gone. */
  pkgId: string;
  label: string;
  /** base-piece affinity — drives grid snap (edge vs grid), inherited at export. */
  kind: BuildKind;
  /** swatch colour for the build-bar chip. */
  hex: string;
};

let AUTHORED: AuthoredBuildPiece[] = [];
let BY_ID = new Map<string, AuthoredBuildPiece>();

/** The id namespace for an authored (mesh) piece. */
export function authoredIdFor(modelId: string): string {
  return `model:${modelId}`;
}

export function isAuthoredPiece(pieceId: string): boolean {
  return pieceId.startsWith('model:');
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

/** The base kind of any placeable id — authored affinity or catalog kind. */
export function placeableKind(pieceId: string): BuildKind | undefined {
  return authoredPieceFor(pieceId)?.kind ?? catalogRowFor(pieceId)?.kind;
}

// ── the build bar's unified source: catalog pieces + authored pieces by kind ──
export type PlaceableEntry = { id: string; label: string; hex: string; authored: boolean };

/** Every placeable grouped by kind: catalog rows first, then authored pieces of
 *  that same affinity (so an exported "wall piece" sits under Wall). */
export function placeablesByKind(): { kind: BuildKind; label: string; entries: PlaceableEntry[] }[] {
  const byKind = new Map<BuildKind, PlaceableEntry[]>();
  for (const g of catalogByKind()) {
    byKind.set(g.kind, g.rows.map((r) => ({ id: r.id, label: r.label, hex: rowHex(r), authored: false })));
  }
  for (const ap of AUTHORED) {
    const list = byKind.get(ap.kind) ?? [];
    list.push({ id: ap.id, label: ap.label, hex: ap.hex, authored: true });
    byKind.set(ap.kind, list);
  }
  return KIND_ORDER.filter((k) => byKind.has(k)).map((k) => ({ kind: k, label: KIND_LABEL[k], entries: byKind.get(k)! }));
}
