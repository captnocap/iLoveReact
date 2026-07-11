// world/buildCatalog.ts — the editor's readable mirror of the host BUILD_CATALOG
// (req_2563). The host owns the 36-piece catalog (framework/game/build.zig
// BUILD_CATALOG) and all placement math; the editor needs a little PRESENTATION
// metadata per piece — label, kind, material, dimensions, a representative tint —
// to draw the Sims build bar, the focus-panel piece definition, and the live
// overlay boxes.
//
// SOURCE OF TRUTH: the host, once the `__game_build_catalog_rows` door lands
// (Phase 0). Until that framework rebuild ships, this file carries a hand-mirror
// of the catalog rows (FALLBACK_CATALOG) so every React phase works on the dev
// host with zero rebuild. `catalogRows()` prefers the host readback and falls
// back to the mirror — when the door is live the mirror is dead weight (kept
// only as the pre-rebuild bridge; delete once the door is the sole path).
//
// The row ORDER matches BUILD_CATALOG_IDS (runtime/game/build.ts) so a row's
// index is its catalog index.
import { callHostJson, hasHost } from '../../../runtime/ffi';
import { BUILD_CATALOG_IDS } from '../../../runtime/game/build';

export type BuildKind =
  | 'wall' | 'floor' | 'roof' | 'ramp' | 'stairs' | 'elevator'
  | 'pillar' | 'corner' | 'arch' | 'fence' | 'railing' | 'trim' | 'sign';

export type BuildMaterial = 'concrete' | 'brick' | 'stucco' | 'wood' | 'metal' | 'glass' | 'chainlink';

// The wall-cutout vocabulary (host WallEdit, framework/game/build.zig). A wall
// row that IS a cutout (window/doorway/garage) names its edit; a plain wall has
// none. Drives pieceShapes decomposition — the opening + pane + door leaf.
export type WallEdit = 'door' | 'window' | 'doubleWindow' | 'brokenWindow' | 'garageDoor' | 'arch';

export type CatalogRow = {
  id: string;
  label: string;
  kind: BuildKind;
  material: BuildMaterial;
  theme: string;
  /** metres — the piece's collider/visual box (matches build.zig BuildPieceSize). */
  w: number;
  h: number;
  d: number;
  /** representative tint 0..1, from the material look table below. */
  rgb: [number, number, number];
  /** < 1 for see-through materials (glass, chainlink). */
  opacity?: number;
  /** wall-cutout kind for window/doorway/garage walls; absent for plain walls. */
  edit?: WallEdit;
};

// Which catalog walls carry a cutout edit (host defaultEdit). Drives the window/
// door decomposition in pieceShapes. Kept beside the RAW mirror; the host door
// readback supersedes it (it emits `edit` per row) once the framework rebuilds.
const EDIT_BY_ID: Record<string, WallEdit> = {
  'wall.concrete.doorway': 'door',
  'wall.concrete.openDoorway': 'arch',
  'wall.metal.garageDoor': 'garageDoor',
  'wall.stucco.window': 'window',
  'wall.stucco.doubleWindow': 'doubleWindow',
  'wall.plywood.brokenWindow': 'brokenWindow',
};

// How each material reads in the editor. Gameplay truth stays host-side in the tags.
const MATERIAL_LOOK: Record<BuildMaterial, { hex: string; opacity?: number }> = {
  concrete: { hex: '#9aa3ad' },
  brick: { hex: '#8a4a3a' },
  stucco: { hex: '#d8cdb8' },
  wood: { hex: '#8a6a45' },
  metal: { hex: '#7d858d' },
  glass: { hex: '#cfe6f2', opacity: 0.3 },
  chainlink: { hex: '#b9c2c9', opacity: 0.45 },
};

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Compact raw mirror: [id, label, material, theme, w, h, d]. `kind` is the id's
// first dotted segment. Sizes verbatim from build.zig (WALL/PLATE/FLOOR/
// VERTICAL_LINK_SIZE + the per-piece overrides).
type Raw = [string, string, BuildMaterial, string, number, number, number];
const W: [number, number, number] = [3, 3, 0.005];        // WALL_SIZE
const P: [number, number, number] = [3, 0.2, 3];          // PLATE_SIZE (roofs)
const F: [number, number, number] = [3, 0.05, 3];         // FLOOR_SIZE
const V: [number, number, number] = [3, 3, 3];            // VERTICAL_LINK_SIZE
const RAW: Raw[] = [
  ['wall.concrete.common', 'Concrete Wall', 'concrete', 'common', ...W],
  ['wall.brick.downtown', 'Brick Wall', 'brick', 'downtown', ...W],
  ['wall.stucco.suburb', 'Stucco Wall', 'stucco', 'suburb', ...W],
  ['wall.stucco.motel', 'Motel Wall', 'stucco', 'motel', ...W],
  ['wall.metal.industrial', 'Sheet-Metal Wall', 'metal', 'industrial', ...W],
  ['wall.plywood.trap_lot', 'Plywood Wall', 'wood', 'trap_lot', ...W],
  ['wall.storefront.downtown', 'Storefront Glass', 'glass', 'downtown', ...W],
  ['wall.concrete.doorway', 'Doorway Wall', 'concrete', 'common', ...W],
  ['wall.concrete.openDoorway', 'Open Doorway Wall', 'concrete', 'common', ...W],
  ['wall.metal.garageDoor', 'Garage Door Wall', 'metal', 'industrial', ...W],
  ['wall.stucco.window', 'Window Wall', 'stucco', 'suburb', ...W],
  ['wall.stucco.doubleWindow', 'Double Window Wall', 'stucco', 'suburb', ...W],
  ['wall.plywood.brokenWindow', 'Broken Window Wall', 'wood', 'trap_lot', ...W],
  ['floor.concrete.common', 'Concrete Floor', 'concrete', 'common', ...F],
  ['floor.wood.suburb', 'Wood Floor', 'wood', 'suburb', ...F],
  ['roof.flat.common', 'Flat Roof', 'concrete', 'common', ...P],
  ['roof.gable.suburb', 'Gable Roof', 'wood', 'suburb', ...P],
  ['roof.gableSteep.suburb', 'Gable Roof (Steep)', 'wood', 'suburb', ...P],
  ['roof.shed.common', 'Shed Roof', 'metal', 'common', ...P],
  ['roof.shedSteep.common', 'Shed Roof (Steep)', 'metal', 'common', ...P],
  ['roof.shingle.suburb', 'Shingle Roof', 'wood', 'suburb', ...P],
  ['ramp.concrete.common', 'Concrete Ramp', 'concrete', 'common', ...V],
  ['stairs.wood.common', 'Wood Stairs', 'wood', 'common', ...V],
  ['stairs.concrete.common', 'Concrete Stairs', 'concrete', 'common', ...V],
  ['stairs.metal.industrial', 'Metal Utility Stairs', 'metal', 'industrial', ...V],
  ['stairs.wood.narrow', 'Narrow Wood Stairs', 'wood', 'common', 1.2, 3, 3],
  ['elevator.metal.common', 'Elevator', 'metal', 'common', ...V],
  ['pillar.concrete.common', 'Concrete Pillar', 'concrete', 'common', 0.6, 3, 0.6],
  ['corner.concrete.common', 'Concrete Corner', 'concrete', 'common', ...V],
  ['arch.concrete.downtown', 'Concrete Arch', 'concrete', 'downtown', ...W],
  ['fence.chainlink.trap_lot', 'Chainlink Fence', 'chainlink', 'trap_lot', 3, 2, 0.05],
  ['fence.wood.suburb', 'Wood Fence', 'wood', 'suburb', 3, 1.8, 0.08],
  ['railing.metal.motel', 'Walkway Railing', 'metal', 'motel', 3, 1, 0.08],
  ['trim.cornice.downtown', 'Cornice Trim', 'concrete', 'downtown', 3, 0.3, 0.3],
  ['sign.shop.downtown', 'Shop Sign', 'metal', 'downtown', 2.4, 0.8, 0.2],
  ['sign.pole.common', 'Pole Sign', 'metal', 'common', 0.24, 3.3, 0.24],
];

function rowFromRaw([id, label, material, theme, w, h, d]: Raw): CatalogRow {
  const look = MATERIAL_LOOK[material];
  return { id, label, kind: id.split('.')[0] as BuildKind, material, theme, w, h, d, rgb: rgbOf(look.hex), opacity: look.opacity, edit: EDIT_BY_ID[id] };
}

const FALLBACK_CATALOG: CatalogRow[] = RAW.map(rowFromRaw);

// ── host readback (Phase 0 door) ───────────────────────────────────────────
// `__game_build_catalog_rows` returns a JSON array of
// { id, label, kind, material, theme, w, h, d, r, g, b, opacity }. Parsed once
// and cached. Absent (framework not rebuilt with the door) ⇒ null ⇒ fallback.
let hostCache: CatalogRow[] | null | undefined; // undefined = not tried yet
function hostCatalogRows(): CatalogRow[] | null {
  if (hostCache !== undefined) return hostCache;
  if (!hasHost('__game_build_catalog_rows')) { hostCache = null; return null; }
  const raw = callHostJson<any[]>('__game_build_catalog_rows', []);
  hostCache = raw.length ? raw.map((r) => ({
    id: r.id, label: r.label, kind: r.kind, material: r.material, theme: r.theme,
    w: r.w, h: r.h, d: r.d, rgb: [r.r, r.g, r.b] as [number, number, number],
    opacity: r.opacity < 1 ? r.opacity : undefined,
    edit: (r.edit || EDIT_BY_ID[r.id]) as WallEdit | undefined,
  })) : null;
  return hostCache;
}

/** Every catalog row, in catalog-index order. Host readback when live, else the mirror. */
export function catalogRows(): CatalogRow[] {
  return hostCatalogRows() ?? FALLBACK_CATALOG;
}

const ROW_BY_ID: ReadonlyMap<string, CatalogRow> = new Map(FALLBACK_CATALOG.map((r) => [r.id, r]));

/** The row for a piece id, or null (props/cooked ids aren't in the static catalog). */
export function catalogRowFor(pieceId: string): CatalogRow | null {
  const live = hostCatalogRows();
  if (live) {
    const hit = live.find((r) => r.id === pieceId);
    if (hit) return hit;
  }
  return ROW_BY_ID.get(pieceId) ?? null;
}

// ── category grouping for the Sims bar (Phase 2) ───────────────────────────
export const KIND_ORDER: BuildKind[] = ['wall', 'floor', 'roof', 'ramp', 'stairs', 'elevator', 'pillar', 'corner', 'arch', 'fence', 'railing', 'trim', 'sign'];
export const KIND_LABEL: Record<BuildKind, string> = {
  wall: 'Wall', floor: 'Floor', roof: 'Roof', ramp: 'Ramp', stairs: 'Stairs', elevator: 'Elevator',
  pillar: 'Pillar', corner: 'Corner', arch: 'Arch', fence: 'Fence', railing: 'Railing', trim: 'Trim', sign: 'Sign',
};

/** Catalog rows grouped by kind, in KIND_ORDER (empty kinds dropped). */
export function catalogByKind(): { kind: BuildKind; label: string; rows: CatalogRow[] }[] {
  const rows = catalogRows();
  return KIND_ORDER
    .map((kind) => ({ kind, label: KIND_LABEL[kind], rows: rows.filter((r) => r.kind === kind) }))
    .filter((g) => g.rows.length > 0);
}

/** '#rrggbb' for a catalog row's tint (swatch styling). */
export function rowHex(row: CatalogRow): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return `#${to(row.rgb[0])}${to(row.rgb[1])}${to(row.rgb[2])}`;
}
