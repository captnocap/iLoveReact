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
import { listPaintSkins, type PaintSkin } from '../data/paintVariants';
import { modelPackageById } from '../data/content';
import type { PropExportRole } from '../data/propExports';

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

/** The palette entries for ONE exported model. Stored paintings are the
 *  exported catalog looks, so they REPLACE the mutable base entry rather than
 *  sitting beside it. A model with no stored painting keeps one base fallback.
 *  Passing `skins` makes this boundary independently testable; production reads
 *  the package's placeable paint-skin pairs from disk. */
export function authoredPaletteEntries(ap: AuthoredBuildPiece, skins?: readonly PaintSkin[]): PlaceableEntry[] {
  const resolvedSkins = skins ?? (() => {
    const pkg = modelPackageById(ap.pkgId);
    return pkg ? listPaintSkins(pkg) : [];
  })();
  if (resolvedSkins.length === 0) {
    return [{ id: ap.id, label: ap.label, hex: ap.hex, authored: true }];
  }
  return resolvedSkins.map((skin) => ({
    id: skinnedPieceId(ap.id, skin.id),
    label: `${ap.label} · ${skin.name}`,
    hex: ap.hex,
    authored: true,
  }));
}

/** The visible entry Export arms. Paint skins are id-sorted, so the newest
 *  stored painting is the default; the tray still exposes every saved look. */
export function preferredAuthoredPaletteId(ap: AuthoredBuildPiece, skins?: readonly PaintSkin[]): string {
  const entries = authoredPaletteEntries(ap, skins);
  return entries[entries.length - 1]?.id ?? ap.id;
}

/** Every placeable grouped by kind: catalog rows first, then authored pieces of
 *  that same affinity (so an exported "wall piece" sits under Wall). An authored
 *  model contributes exactly one tile per stored paint skin, or one base tile
 *  when it has no skins (req_2834); exported props occupy the trailing group. */
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
