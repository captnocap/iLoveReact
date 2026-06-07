// editors/workbench/clothing/store.ts — the GARMENT source's headless store
// (CLOTHSOURCE-0606, dispatch req_0187).
//
// USER verbatim: "it should just show the clothing items, and then the
// variety in that same item (shirt with many materials type of ordeal)".
// The roster is the garment TABLES (shapes.ts CLOTHING/BOTTOMS/
// CLOTHING_ACCESSORIES — P2 data, generated, never enumerated by hand), and
// a garment's VARIANTS are two layers over one truth:
//   seeds — the built-in CLOTHING_SKINS prints (print-bearing tops only;
//           clothing.ts:82 is the placement law: armor/dress take no print);
//   saved — user material assignments, a textureId into THE texture registry
//           (validated here via deps.validMaterial — live = textureById;
//           tests fake it), persisted as ONE `garmentVariantSaved` commit on
//           the V20 clothing-variants stream.
// Variant SELECTION is view state (the WBCHAR C1 precedent: a setter, not a
// property); the stage's variant strip and the panel's pick both drive it.

import {
  BOTTOMS, CLOTHING, CLOTHING_ACCESSORIES, CLOTHING_SKINS,
  type BottomsId, type ClothingAccessoryId, type ClothingId, type ClothingSkinId,
} from '../../../game/figure/shapes';
import type { PaintedOverlay } from '../../../game/painted';
import type { ClothingVariantsEvent, ClothingVariantsState, SavedGarmentVariant } from '../../../game/figure/clothingVariants';
import { readRouteTwigState, writeRouteTwigState } from '../../twigs';

export type GarmentKind = 'top' | 'bottom' | 'acc';

export type GarmentItem =
  | { id: string; kind: 'top'; style: ClothingId; label: string }
  | { id: string; kind: 'bottom'; bottoms: BottomsId; label: string }
  | { id: string; kind: 'acc'; accessory: ClothingAccessoryId; label: string };

/** one row of the variant grid — a seed print, a saved material, or a
 *  painted DESIGN (CLOTHFLIP-0607) */
export type GarmentVariant =
  | { id: string; label: string; seed: true; skin: ClothingSkinId }
  | { id: string; label: string; seed: false; textureId: string }
  | { id: string; label: string; seed: false; design: PaintedOverlay };

export type ClothingSession = {
  commit(event: ClothingVariantsEvent, label: string): void;
};

export type ClothingStoreDeps = {
  /** the variants stream's materialized state; null = store down */
  variants: () => ClothingVariantsState | null;
  session: ClothingSession | null;
  /** why the store is down (the census store-unavailable convention) */
  error: string | null;
  /** does this id resolve in THE texture registry? (live: textureById) */
  validMaterial(id: string): boolean;
  /** the registry's assignable materials, for the panel's picker */
  materials(): Array<{ id: string; label: string }>;
  /** CLOTHFLIP-0607 — "brings me to the painter": open THE shared bench on
   *  a garment-design target (live: paintBenchStore().open; tests record) */
  openDesigner?: ((garmentId: string, designId: string | null) => void) | null;
  /** twig io gate (the characters-store precedent) — tests pass false */
  twig?: boolean;
};

export type ClothingStore = {
  deps: ClothingStoreDeps;
  /** the roster: every garment in the tables, tables' own order */
  garments(): GarmentItem[];
  garment(id: string): GarmentItem | null;
  /** seeds (prints) + the user's saved materials, seed-first */
  variantsOf(garmentId: string): GarmentVariant[];
  /** can this garment hold a print/material? (tops; clothing.ts:82 law) */
  printable(garmentId: string): boolean;
  // ── variants (the material system; one commit per action) ─────────────────
  saveMaterialVariant(garmentId: string, textureId: string): void;
  /** seeds refuse — only saved variants remove */
  removeVariant(garmentId: string, variantId: string): void;
  /** rename a SAVED variant ("now that shirt exists i can give it a name") —
   *  one upsert commit; seeds refuse */
  renameVariant(garmentId: string, variantId: string, label: string): void;
  // ── the design spine (CLOTHFLIP-0607) ──────────────────────────────────────
  /** open the painter on a new (null) or saved design + flip to the DESIGN lens */
  startDesign(garmentId: string, designId: string | null): void;
  /** the source's controlled lens: 'stage' (the garment) ⇄ 'design' (the bench) */
  lens(): 'stage' | 'design';
  setLens(lens: 'stage' | 'design'): void;
  // ── selection (view state; default = the plain seed; twig-persisted) ──────
  selectedVariant(garmentId: string): string;
  selectVariant(garmentId: string, variantId: string): void;
  subscribe(fn: () => void): () => void;
  error(): string | null;
};

export const PLAIN_VARIANT = 'skin:plain';

/** pure garment-id → label (the tables' own words) — the paint bench's
 *  garment-design resolve gate imports THIS, not the store (CLOTHFLIP-0607) */
export function garmentLabelById(id: string): string | null {
  const sep = id.indexOf(':');
  if (sep < 0) return null;
  const kind = id.slice(0, sep);
  const key = id.slice(sep + 1);
  if (kind === 'top' && key !== 'underwear') return (CLOTHING as any)[key]?.label ?? null;
  if (kind === 'bottom') return (BOTTOMS as any)[key]?.label ?? null;
  if (kind === 'acc') return (CLOTHING_ACCESSORIES as any)[key]?.label ?? null;
  return null;
}

/** the prints a top can wear — clothing.ts:82: the chest print box exists
 *  only when the style is neither armor nor dress (and never on underwear,
 *  which is painted-on body art by ruling, not a mesh garment) */
function printableStyle(style: ClothingId): boolean {
  return style !== 'armor' && style !== 'dress' && style !== 'underwear';
}

// TWIGSTATE-0606: per-source view state gets its own twig keys — the variant
// selection survives reloads (and headless shots can boot into a variant)
const TWIG_ROUTE = '/garment';

function readSelectionTwig(): Record<string, string> {
  try { return readRouteTwigState(TWIG_ROUTE, 'variantSel', {} as Record<string, string>); } catch { return {}; }
}

function writeSelectionTwig(sel: Record<string, string>): void {
  try { writeRouteTwigState(TWIG_ROUTE, 'variantSel', sel); } catch { /* twigless host */ }
}

export function createClothingStore(deps: ClothingStoreDeps): ClothingStore {
  const twig = deps.twig !== false;
  // view state: which variant each garment demonstrates (twig-backed)
  const selection: Record<string, string> = twig ? readSelectionTwig() : {};
  const persistSelection = () => { if (twig) writeSelectionTwig(selection); };
  let lens: 'stage' | 'design' = 'stage';
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const fn of Array.from(listeners)) {
      try { fn(); } catch { /* a dead subscriber never kills the store */ }
    }
  };

  const garments = (): GarmentItem[] => {
    const rows: GarmentItem[] = [];
    // 'underwear' is excluded: painted-on by ruling ("clothing is MESHES"),
    // buildClothing emits zero top instances for it — nothing to show alone
    for (const style of Object.keys(CLOTHING) as ClothingId[]) {
      if (style === 'underwear') continue;
      rows.push({ id: `top:${style}`, kind: 'top', style, label: CLOTHING[style].label });
    }
    for (const b of Object.keys(BOTTOMS) as BottomsId[]) {
      rows.push({ id: `bottom:${b}`, kind: 'bottom', bottoms: b, label: BOTTOMS[b].label });
    }
    for (const a of Object.keys(CLOTHING_ACCESSORIES) as ClothingAccessoryId[]) {
      rows.push({ id: `acc:${a}`, kind: 'acc', accessory: a, label: CLOTHING_ACCESSORIES[a].label });
    }
    return rows;
  };

  const garment = (id: string): GarmentItem | null => garments().find((g) => g.id === id) ?? null;

  const must = (id: string): GarmentItem => {
    const g = garment(id);
    if (!g) throw new Error(`clothing: unknown garment '${id}'`);
    return g;
  };

  const printable = (garmentId: string): boolean => {
    const g = must(garmentId);
    return g.kind === 'top' && printableStyle(g.style);
  };

  const saved = (garmentId: string): SavedGarmentVariant[] =>
    deps.variants()?.variants[garmentId] ?? [];

  const variantsOf = (garmentId: string): GarmentVariant[] => {
    const rows: GarmentVariant[] = [];
    if (printable(garmentId)) {
      for (const skin of Object.keys(CLOTHING_SKINS) as ClothingSkinId[]) {
        rows.push({ id: `skin:${skin}`, label: CLOTHING_SKINS[skin].label, seed: true, skin });
      }
      for (const v of saved(garmentId)) {
        // a saved variant is a DESIGN (painted overlay) or a MATERIAL
        // (registry textureId); malformed rows (neither) are skipped loud-free
        if (v.overlay) rows.push({ id: v.id, label: v.label, seed: false, design: v.overlay });
        else if (v.textureId) rows.push({ id: v.id, label: v.label, seed: false, textureId: v.textureId });
      }
    } else {
      // non-printable garments still have their one base look
      rows.push({ id: PLAIN_VARIANT, label: 'plain', seed: true, skin: 'plain' });
    }
    return rows;
  };

  return {
    deps,
    garments,
    garment,
    variantsOf,
    printable,

    saveMaterialVariant(garmentId, textureId): void {
      if (!printable(garmentId)) {
        throw new Error(`clothing: '${garmentId}' takes no print/material (clothing.ts:82 — armor/dress have no print surface)`);
      }
      if (!deps.validMaterial(textureId)) {
        throw new Error(`clothing: '${textureId}' is not a registry material — variants assign THE material system`);
      }
      const g = must(garmentId);
      const label = deps.materials().find((m) => m.id === textureId)?.label ?? textureId;
      const variant: SavedGarmentVariant = { id: `mat:${textureId}`, label, textureId };
      deps.session?.commit(
        { kind: 'garmentVariantSaved', garmentId, variant },
        `${g.label}: + variant ${label}`,
      );
      selection[garmentId] = variant.id; // show what was just made
      persistSelection();
      notify();
    },

    removeVariant(garmentId, variantId): void {
      const v = variantsOf(garmentId).find((x) => x.id === variantId);
      if (!v) throw new Error(`clothing: '${garmentId}' has no variant '${variantId}'`);
      if (v.seed) throw new Error(`clothing: '${variantId}' is a built-in print — only saved variants remove`);
      const g = must(garmentId);
      deps.session?.commit(
        { kind: 'garmentVariantRemoved', garmentId, variantId },
        `${g.label}: − variant ${v.label}`,
      );
      if (selection[garmentId] === variantId) {
        selection[garmentId] = PLAIN_VARIANT;
        persistSelection();
      }
      notify();
    },

    renameVariant(garmentId, variantId, label): void {
      const v = saved(garmentId).find((x) => x.id === variantId);
      if (!v) throw new Error(`clothing: '${garmentId}' has no saved variant '${variantId}' (seeds keep their names)`);
      const clean = label.trim();
      if (!clean || clean === v.label) return;
      const g = must(garmentId);
      // the stream's upsert IS the rename — same id, new label, data intact
      deps.session?.commit(
        { kind: 'garmentVariantSaved', garmentId, variant: { ...v, label: clean } },
        `${g.label}: variant ${v.label} → ${clean}`,
      );
      notify();
    },

    startDesign(garmentId, designId): void {
      if (!printable(garmentId)) {
        throw new Error(`clothing: '${garmentId}' takes no print/design (clothing.ts:82)`);
      }
      if (!deps.openDesigner) throw new Error('clothing: the painter door is not wired');
      deps.openDesigner(garmentId, designId);
      lens = 'design'; // "brings me to the painter"
      notify();
    },
    lens: () => lens,
    setLens(next): void {
      lens = next;
      notify();
    },

    selectedVariant(garmentId): string {
      const id = selection[garmentId] ?? PLAIN_VARIANT;
      // a removed/unknown selection falls back to the plain seed
      return variantsOf(garmentId).some((v) => v.id === id) ? id : PLAIN_VARIANT;
    },
    selectVariant(garmentId, variantId): void {
      selection[garmentId] = variantId;
      persistSelection();
      notify();
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    error: () => deps.error,
  };
}
