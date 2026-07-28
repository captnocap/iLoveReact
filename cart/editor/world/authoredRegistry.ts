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
import { catalogByKind, catalogRowFor, rowHex, KIND_LABEL, KIND_ORDER, type BuildKind, type WallEdit } from './buildCatalog';
import type { PaintSkin } from '../data/paintVariants';
import type { PropExportRole } from '../data/propExports';
import type { ModelTextureSlot } from '../data/types';

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
  /** Meaningful wall edit preserved by export (door/garageDoor are interactive). */
  edit?: WallEdit;
  /** Semantic prop role consumed by derived intersections/transit stops. */
  propRole?: PropExportRole;
  /** swatch colour for the build-bar chip. */
  hex: string;
  /** Named face roles authored in the model Rig panel, in resident slot order. */
  textureSlots?: ModelTextureSlot[];
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

// ── paint SKINS on placeable ids (req_2834) ───────────────────────────────────
// A stored painting is catalog variety on the exported placeable (V24: "variety
// lives in the CATALOG"): `prop:<modelId>#p<skinId>` places the model wearing
// paint skin <skinId>. The suffix rides authoredResidentKeyOf's result, so the
// resident-mesh key `<placeableId>#p<skinId>` resolves the per-skin mesh everywhere
// (ghost, live refs, colliders) with no other id plumbing.
const SKIN_MARK = '#p';

/** The skinned placeable id — the base piece wearing paint skin `skinId`. */
export function skinnedPieceId(basePieceId: string, skinId: string): string {
  return `${basePieceId}${SKIN_MARK}${skinId}`;
}

/** The paint-skin id a placeable id carries, or null for the base look. */
export function paintSkinIdOf(pieceId: string): string | null {
  const at = pieceId.lastIndexOf(SKIN_MARK);
  return at >= 0 ? pieceId.slice(at + SKIN_MARK.length) : null;
}

/**
 * The resident key keeps the EXPORTED MEANING (`model:` vs `prop:`), not just
 * geometry identity. One mesh can be exported with different gameplay metadata
 * (a Door Wall and a prop); collapsing both to the bare model id made whichever
 * resident row decoded last silently win. Paint-skin suffixes remain part of it.
 */
export function authoredResidentKeyOf(pieceId: string): string {
  return pieceId;
}

/** Mirror EditorState.authoredBuildPieces here (called from AppFrame on change). */
export function setAuthoredPieces(list: readonly AuthoredBuildPiece[]): void {
  AUTHORED = list.slice();
  BY_ID = new Map(AUTHORED.map((p) => [p.id, p]));
}

export function authoredList(): readonly AuthoredBuildPiece[] {
  return AUTHORED;
}

/** Resolve against an explicit snapshot. Live-world hydration uses this instead
 *  of depending on the parent effect that mirrors EditorState into AUTHORED. */
export function authoredPieceFrom(
  list: readonly AuthoredBuildPiece[] | null | undefined,
  pieceId: string,
): AuthoredBuildPiece | null {
  // Hot reload can retain a caller compiled against pushLiveWorld's former
  // two-argument shape. Fall back to the mirrored registry so refreshing this
  // module never turns that retained closure into `undefined.find(...)`.
  const source = list ?? AUTHORED;
  const hit = source.find((piece) => piece.id === pieceId);
  if (hit) return hit;
  const at = pieceId.lastIndexOf(SKIN_MARK);
  if (at < 0) return null;
  const baseId = pieceId.slice(0, at);
  return source.find((piece) => piece.id === baseId) ?? null;
}

/** Resolve a placeable id to its authored piece — a skinned id (`…#p<skin>`)
 *  resolves to its BASE piece (kind/label/bounds are skin-independent). */
export function authoredPieceFor(pieceId: string): AuthoredBuildPiece | null {
  const hit = BY_ID.get(pieceId);
  if (hit) return hit;
  const at = pieceId.lastIndexOf(SKIN_MARK);
  return at >= 0 ? BY_ID.get(pieceId.slice(0, at)) ?? null : null;
}

/** The base kind of any placeable id — authored affinity/prop or catalog kind. */
export function placeableKind(pieceId: string): PlaceableKind | undefined {
  return authoredPieceFor(pieceId)?.kind ?? catalogRowFor(pieceId)?.kind;
}

// ── the build bar's unified source: catalog pieces + authored placeables ──────
export type PlaceableEntry = { id: string; label: string; hex: string; authored: boolean };
export type PlaceableGroup = { kind: PlaceableKind; label: string; entries: PlaceableEntry[] };

/** The palette entries for ONE exported model: exactly ONE tile (req_3443 —
 *  USER RULING: skins must not multiply build-menu entries; "the build menu
 *  will explode"). The tile is the model's CURRENT saved atlas — the look
 *  visible in Studio and therefore the look Export must arm and placement
 *  drops. Stored paintings stay catalog variety on the INSTANCE: the world
 *  quick menu's PAINTINGS section dresses a placed piece in any of them
 *  (world.piece.skin), and skinned ids still resolve everywhere. Passing
 *  `skins` keeps this boundary independently testable. */
export function authoredPaletteEntries(ap: AuthoredBuildPiece, skins?: readonly PaintSkin[]): PlaceableEntry[] {
  void skins; // skins no longer shape the palette — they are per-instance wardrobe
  return [{ id: ap.id, label: ap.label, hex: ap.hex, authored: true }];
}

/** Export arms the current saved atlas — exactly the look visible in Studio.
 *  Stored paintings never silently replace it. */
export function preferredAuthoredPaletteId(ap: AuthoredBuildPiece, skins?: readonly PaintSkin[]): string {
  return authoredPaletteEntries(ap, skins)[0]?.id ?? ap.id;
}

/** Every placeable grouped by kind: catalog rows first, then authored pieces of
 *  that same affinity (so an exported "wall piece" sits under Wall). An authored
 *  model contributes ONE tile — its current base look (stored paintings dress
 *  placed instances via the quick menu, req_3443); exported props occupy the
 *  trailing group. */
export function placeablesByKind(): PlaceableGroup[] {
  const byKind = new Map<PlaceableKind, PlaceableEntry[]>();
  for (const g of catalogByKind()) {
    byKind.set(g.kind, g.rows.map((r) => ({ id: r.id, label: r.label, hex: rowHex(r), authored: false })));
  }
  for (const ap of AUTHORED) {
    const list = byKind.get(ap.kind) ?? [];
    list.push(...authoredPaletteEntries(ap));
    byKind.set(ap.kind, list);
  }
  const groups: PlaceableGroup[] = KIND_ORDER
    .filter((k) => byKind.has(k))
    .map((k) => ({ kind: k, label: KIND_LABEL[k], entries: byKind.get(k)! }));
  const props = byKind.get('prop');
  if (props?.length) groups.push({ kind: 'prop', label: PROP_KIND_LABEL, entries: props });
  return groups;
}
