// editors/workbench/clothing/panel.ts — the GARMENT source's headless half
// (CLOTHSOURCE-0606): roster + PanelSpec generation + the stage's render
// fold. No React (the characters.test.ts bundling law) — source.tsx adds the
// stage; the P4 suite drives THIS module through the real stream apply.
//
// Panel shape (LAW 1: gutter 3 is the ONE edit surface):
//   GARMENT  — identity (kind/name/piece count): val fields, read.
//   VARIANTS — printable tops only (the conditional-sections law): the
//              variant pick (selection is view state through a setter — the
//              WBCHAR C1 precedent), `add material` through THE shared
//              chooser (shell/picker via the `pick` field — req_0184: one
//              implementation, never an option dump), remove for saved rows.
// Column 4 DEMONSTRATES: garmentRender folds the selected variant into the
// garment-alone instance list (buildClothingSlices — buildClothing's own
// output sliced by slot, one placement truth).

import type { PanelSpec } from '../../../shell/fields';
import type { RosterRow } from '../../../shell/Workbench';
import {
  buildClothingSlices,
  type ClothingInstance,
} from '../../../game/figure/clothing';
import { DEFAULT_BOTTOMS, clothingSkinTextureKey, type ClothingSkinId } from '../../../game/figure/shapes';
import type { PaintedOverlay } from '../../../game/painted';
import { materialPickOptions } from '../materials/chooser';
import { PLAIN_VARIANT, type ClothingStore, type GarmentItem, type GarmentVariant } from './store';

export function clothingRoster(store: ClothingStore): RosterRow[] {
  return store.garments().map((g) => ({ id: g.id, label: `${g.label} · ${g.kind}` }));
}

// ── the render fold (column 4 receives, never edits) ─────────────────────────

export type GarmentRender = {
  /** the garment ALONE — no body, no outfit siblings */
  instances: ClothingInstance[];
  /** material captures the stage must mount (textureId sampled by staticKey) */
  mounts: Array<{ textureId: string; staticKey: string }>;
  /** design bakes the stage must mount (PaintedOverlaySurface per design —
   *  CLOTHFLIP-0607; stamp-keyed so a re-save re-bakes) */
  overlayMounts: Array<{ staticKey: string; overlay: PaintedOverlay }>;
  /** true when a seed print samples headlab.clothing.* (mount ClothingSkinCaptures) */
  needsSkinCaptures: boolean;
  caption: string;
};

export const MATERIAL_KEY_PREFIX = 'clothvar:';
export const DESIGN_KEY_PREFIX = 'clothdsgn:';

/** the garment-alone slice for an item at a given print (the placement truth) */
function baseSlice(g: GarmentItem, skin: ClothingSkinId): ClothingInstance[] {
  if (g.kind === 'top') {
    return buildClothingSlices(g.style, 'neutral', 'stand', 0, [], skin, [], DEFAULT_BOTTOMS[g.style]).top;
  }
  if (g.kind === 'bottom') {
    // a neutral top isolates the bottoms slice ('tee' never color-couples —
    // matchTop is suit/armor-only in clothing.ts)
    return buildClothingSlices('tee', 'neutral', 'stand', 0, [], 'plain', [], g.bottoms).bottoms;
  }
  return buildClothingSlices('tee', 'neutral', 'stand', 0, [], 'plain', [g.accessory], DEFAULT_BOTTOMS.tee).accessories;
}

/** a saved material rides the TORSO body (first top instance — pinned by the
 *  suite), textured front/back; a saved DESIGN rides the chest PRINT BOX
 *  (buildClothing's own placement — FRONT only, the user's per-face fear
 *  answered by construction); seeds keep buildClothing's own print box */
export function garmentRender(store: ClothingStore, garmentId: string): GarmentRender {
  const g = store.garment(garmentId);
  if (!g) return { instances: [], mounts: [], overlayMounts: [], needsSkinCaptures: false, caption: store.error() ?? 'unknown garment' };
  const variant = store.variantsOf(garmentId).find((v) => v.id === store.selectedVariant(garmentId))
    ?? store.variantsOf(garmentId)[0];

  if (variant.seed) {
    const instances = baseSlice(g, variant.skin);
    return {
      instances,
      mounts: [],
      overlayMounts: [],
      needsSkinCaptures: variant.skin !== 'plain',
      caption: `${g.label} · ${variant.label}`,
    };
  }

  if ('design' in variant) {
    // build with a forcing print (any non-plain) so buildClothing places its
    // OWN chest print box, then re-key that box to the design's bake — the
    // placement math never forks, and the design lands front-only
    const staticKey = `${DESIGN_KEY_PREFIX}${garmentId}:${variant.id}:${variant.design.stamp}`;
    const instances = baseSlice(g, 'designer').map((inst) =>
      inst.textureKey ? { ...inst, textureKey: staticKey } : inst,
    );
    return {
      instances,
      mounts: [],
      overlayMounts: [{ staticKey, overlay: variant.design }],
      needsSkinCaptures: false,
      caption: `${g.label} · ${variant.label} (design)`,
    };
  }

  const staticKey = `${MATERIAL_KEY_PREFIX}${variant.textureId}`;
  const instances = baseSlice(g, 'plain').map((inst, i) =>
    i === 0
      ? {
          ...inst,
          color: '#ffffff',
          textureKey: staticKey,
          params: { width: 1, height: 1, depth: 1, texturedFaces: ['front', 'back'] },
        }
      : inst,
  );
  return {
    instances,
    mounts: [{ textureId: variant.textureId, staticKey }],
    overlayMounts: [],
    needsSkinCaptures: false,
    caption: `${g.label} · ${variant.label}`,
  };
}

/** every print texKey the seed strip can sample — exported so the suite can
 *  pin the key shape against clothingSkinTextureKey */
export function seedPrintKey(variant: GarmentVariant): string | null {
  return variant.seed && variant.skin !== 'plain' ? clothingSkinTextureKey(variant.skin) : null;
}

// ── gutter 3 — the generated spec ─────────────────────────────────────────────

export function clothingPanel(store: ClothingStore, garmentId: string): PanelSpec {
  const g = store.garment(garmentId);
  if (!g) {
    return { groups: [{ title: 'GARMENT', fields: [{ k: 'status', t: 'val', get: () => store.error() ?? 'unknown garment' }] }] };
  }

  const groups: PanelSpec['groups'] = [];
  groups.push({
    title: 'GARMENT',
    fields: [
      { k: 'name', t: 'val', get: () => g.label },
      { k: 'kind', t: 'val', get: () => g.kind },
      { k: 'pieces', t: 'val', get: () => `${garmentRender(store, garmentId).instances.length}` },
    ],
  });

  // VARIANTS — printable tops only (conditional-sections law: armor/dress/
  // bottoms/accessories have exactly one honest look, no section renders).
  // CLOTHFLIP-0607 respec: SELECTION lives in the stage's visual grid (the
  // ruled spec — "designs are visual things"; the dropdown died); gutter 3
  // keeps CREATION + the selected variant's identity (name/metadata).
  if (store.printable(garmentId)) {
    const selected = () => store.variantsOf(garmentId).find((v) => v.id === store.selectedVariant(garmentId));
    const fields: PanelSpec['groups'][number]['fields'] = [
      {
        // THE SPINE — "add a new design, brings me to the painter"
        k: '+ new design', t: 'act', tone: 'success',
        run: () => store.startDesign(garmentId, null),
      },
      {
        // a material pick IS the save (one action, one commit) — THE MATERIAL
        // chooser contract, grouped by the a-/b-/… families like every material
        // pick (req_0184)
        k: 'add material', t: 'pick',
        get: () => { const v = selected(); return v && !v.seed && 'textureId' in v ? v.textureId : null; },
        opts: () => materialPickOptions(store.deps.materials()),
        clearLabel: 'none',
        set: (v: string | null) => { if (v !== null) store.saveMaterialVariant(garmentId, v); },
      },
    ];
    const sel = selected();
    if (sel && !sel.seed) {
      // the saved variant's identity — "i can give it a name, and all that
      // important meta data" (name commits as an upsert; meta reads)
      fields.push(
        { k: 'design name', t: 'text', get: () => sel.label, set: (x: string) => store.renameVariant(garmentId, sel.id, x) },
        { k: 'meta', t: 'val', get: () => ('design' in sel ? `painted design · ${sel.design.layers.length} layer${sel.design.layers.length === 1 ? '' : 's'}` : `material · ${sel.textureId}`) },
      );
      if ('design' in sel) {
        fields.push({ k: 'edit design', t: 'act', run: () => store.startDesign(garmentId, sel.id) });
      }
      fields.push({ k: 'remove variant', t: 'act', tone: 'error', run: () => store.removeVariant(garmentId, sel.id) });
    }
    groups.push({ title: 'VARIANTS', layout: 'rows', fields });
  }

  return { groups };
}
