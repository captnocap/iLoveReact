// game/build/skins — the BUILDING SKIN vocabulary (BUILDSKIN-0606).
//
// USER SPEC, near-verbatim: a saved prefab is a BUILDING type; skins have
// GLOBAL controls per piece TYPE ("all walls → green" in one action) with
// PER-PIECE OVERRIDES on top ("set global green, then change one wall to
// red"); skins are PER-FACE with the side rule — a piece is a 3D box with 6
// faces but only the 2 MAJOR faces matter individually, the side/edge faces
// are ONE uniform group.
//
// DESIGN CONSTRAINT (non-negotiable): the skin vocabulary IS the material
// system. A face skin is either the mesh's native base COLOR (the channel
// catalog pieces already render with) or a MATERIAL — a textureKey into THE
// texture registry (game/textures: shader recipes, stored materials, decals,
// facades). No third path exists; material ids are validated at the editing
// boundary (the workbench store, where the registry is importable) — this
// module stays pure data + resolution so the bake/game side can consume it
// without React.
//
// RESOLUTION ORDER (the user's law): piece override BEATS type global BEATS
// the catalog's bare look. Overrides ride the PrefabPiece itself (not an
// index-keyed side table), so structure edits — swap/remove/add, "nothing is
// immutable" — can never detach a skin from its piece.

import type { BuildPieceKind } from './pieces';
import { BUILD_KIND_CONTRACTS } from './pieces';

// ── the face slots: 2 majors + the one side group ───────────────────────────

export type BuildFaceSlot = 'front' | 'back' | 'sides';

export const BUILD_FACE_SLOTS: BuildFaceSlot[] = ['front', 'back', 'sides'];

/** What the two major faces MEAN per kind (display labels — the slot ids stay
 *  fixed so skins survive a piece-kind swap): vertical pieces read front/back,
 *  horizontal plates read top/bottom. */
export function faceSlotLabels(kind: BuildPieceKind): Record<BuildFaceSlot, string> {
  const plate = kind === 'floor' || kind === 'roof' || kind === 'ramp' || kind === 'stairs';
  return plate
    ? { front: 'top', back: 'bottom', sides: 'edges' }
    : { front: 'front', back: 'back', sides: 'sides' };
}

// ── the skin value: a color OR a material — never a third thing ──────────────

export type BuildFaceSkin =
  | { kind: 'color'; value: string }
  | { kind: 'material'; id: string; spanGroup?: BuildSpanGroup };

/** SURFACE MODES (DESIGN_INTAKE.md Part 2): when a material id resolves to a
 *  SURFACE source (game/textures/materials.ts CustomTexture.mode === 'span'),
 *  this placement's own (gx, gy) slice of the shared (w, h) grid — several
 *  pieces sharing one `id` string reassemble into one continuous field
 *  instead of each repeating the pattern independently. Absent = tile (each
 *  piece renders the material fresh, today's behavior). Lives on the
 *  PLACEMENT, not the material record, since the same material can span
 *  differently across different buildings. */
export type BuildSpanGroup = { id: string; gx: number; gy: number; w: number; h: number };

/** a piece's (or a type's) per-face assignment; absent slot = inherit */
export type BuildSkinSet = Partial<Record<BuildFaceSlot, BuildFaceSkin>>;

/** the building-level global skins, keyed by piece TYPE */
export type BuildTypeSkins = Partial<Record<BuildPieceKind, BuildSkinSet>>;

// ── the 4 structural piece types (the user's "4 building piece types") ───────
// The Fortnite-semantics quartet (V24 ruling #1) headlines the global skin
// controls; every other kind present in a building gets the same treatment
// (buildings are ONE category — no kind is exempt, the quartet just leads).

export const STRUCTURAL_SKIN_KINDS: BuildPieceKind[] = ['wall', 'floor', 'ramp', 'roof'];

/** global-control ordering: the structural quartet first, then every other
 *  kind that actually appears in the building, contract order */
export function skinKindOrder(present: Iterable<BuildPieceKind>): BuildPieceKind[] {
  const has = new Set(present);
  const rest = (Object.keys(BUILD_KIND_CONTRACTS) as BuildPieceKind[])
    .filter((k) => has.has(k) && !STRUCTURAL_SKIN_KINDS.includes(k));
  return [...STRUCTURAL_SKIN_KINDS.filter((k) => has.has(k)), ...rest];
}

// ── resolution: piece override > type global > bare ──────────────────────────

export type ResolvedFaceSkin = {
  skin: BuildFaceSkin | null;
  /** where the value came from — the panel/stage show provenance live */
  from: 'piece' | 'type' | 'none';
};

export function resolveFaceSkin(
  typeSkins: BuildTypeSkins | undefined,
  kind: BuildPieceKind,
  pieceSkin: BuildSkinSet | undefined,
  slot: BuildFaceSlot,
): ResolvedFaceSkin {
  const fromPiece = pieceSkin?.[slot];
  if (fromPiece) return { skin: fromPiece, from: 'piece' };
  const fromType = typeSkins?.[kind]?.[slot];
  if (fromType) return { skin: fromType, from: 'type' };
  return { skin: null, from: 'none' };
}

/** "all walls → green" in ONE action: every slot of a set, one write */
export function skinAllSlots(skin: BuildFaceSkin): BuildSkinSet {
  return { front: skin, back: skin, sides: skin };
}

/** boundary shape-check (V20 tolerance: unknown extras pass, junk is named).
 *  Material EXISTENCE is checked where the registry lives (the workbench
 *  store) — here only the shape, so game-side consumers stay React-free. */
export function skinSetProblems(set: BuildSkinSet | undefined, where: string): string[] {
  if (set === undefined) return [];
  const problems: string[] = [];
  for (const slot of Object.keys(set) as BuildFaceSlot[]) {
    if (!BUILD_FACE_SLOTS.includes(slot)) {
      problems.push(`${where}: unknown face slot '${slot}'`);
      continue;
    }
    const skin = set[slot];
    if (!skin) continue;
    if (skin.kind === 'color') {
      if (typeof skin.value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(skin.value)) {
        problems.push(`${where}.${slot}: color skins are '#rrggbb' (got ${JSON.stringify(skin.value)})`);
      }
    } else if (skin.kind === 'material') {
      if (typeof skin.id !== 'string' || skin.id.length === 0) {
        problems.push(`${where}.${slot}: material skins carry a registry texture id`);
      }
    } else {
      problems.push(`${where}.${slot}: a skin is a color or a material (got kind ${JSON.stringify((skin as any).kind)})`);
    }
  }
  return problems;
}

/** one human line per face — the stage's provenance caption + commit labels */
export function describeFaceSkin(resolved: ResolvedFaceSkin): string {
  if (!resolved.skin) return 'bare';
  const what = resolved.skin.kind === 'color' ? resolved.skin.value : resolved.skin.id;
  return resolved.from === 'piece' ? `${what} (piece override)` : `${what} (type global)`;
}
