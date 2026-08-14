// recipe.ts — the Material Lab's recipe: DATA describing a base material plus
// ordered layers (surfaces or colormods, each optionally masked by a field
// atom and domain-warped by a warp atom), compiled DETERMINISTICALLY into one
// WGSL fn with the standard surface signature. A compiled recipe is
// indistinguishable from a hand-written material: the emitted fn takes
// (uv, px, variant, seed) and returns vec3f, so every existing consumer of
// fill_pick / FILL_MAIN previews it unchanged.
//
// Two-speed contract (the Lab's core UX law):
//   topology (add/remove/reorder/swap layers) → recompose this module,
//     sub-second through the same per-set machinery as compose.ts;
//   data (variant, seed, quality, palette — and params in the D[] param
//     section) → floats only, no recompile.
//
// The parser/walker of a format lives beside the format: this file is the ONLY
// author of recipe WGSL. blend kinds are helpers.wgsl's surface_blend
// (0 over · 1 add · 2 multiply · 3 screen); masks gate through smoothstep
// around a threshold; warps obey amount=0 ⇒ identity, so a zeroed warp slider
// is exactly the unwarped material.
import { splitFillDispatch, resolveMaterialFns } from './compose';
import { FILL_MAIN_SRC } from './index';
import { ATOMS, MATERIALS } from './_generated/registry';

export type RecipeWarp = {
  /** warp_* atom fn */
  atom: string;
  amount: number;
};

export type RecipeMask = {
  /** field_* atom fn — sampled at the UNwarped uv so the mask stays put while
   *  the layer content warps under it. */
  field: string;
  /** mask passes where the field exceeds this (default 0.5). */
  threshold?: number;
  /** smoothstep half-width around the threshold (default 0.25). */
  softness?: number;
  invert?: boolean;
};

export type RecipeLayer = {
  /** a catalog material fn (surface/composition/gradient) painted over the
   *  running color, or a colormod_* atom filtering it. */
  atom: string;
  /** surface layers: the take (default 0). */
  variant?: number;
  /** absolute layer seed; absent = derived from the recipe seed so reroll
   *  moves every layer coherently. */
  seed?: number;
  /** surface layers: surface_blend kind 0 over · 1 add · 2 multiply · 3 screen
   *  (default 0). */
  blend?: 0 | 1 | 2 | 3;
  /** 0..1 layer strength (default 1). */
  opacity?: number;
  /** colormod layers: the atom's amount argument (default 1). */
  amount?: number;
  mask?: RecipeMask;
  warp?: RecipeWarp;
  /** default true; a disabled layer is absent from the composed fn. */
  enabled?: boolean;
};

export type MaterialRecipe = {
  version: 1;
  /** recipe slug: [a-z0-9-]+ — becomes the fn name recipe_<slug with _>. */
  id: string;
  name: string;
  base: {
    fn: string;
    /** absent = the fn's variant argument passes through, so the standard
     *  VARIANT control drives the base take. */
    variant?: number;
    /** absent = the recipe seed passes through. */
    seed?: number;
    warp?: RecipeWarp;
  };
  layers: RecipeLayer[];
};

const MATERIAL_FNS = new Set(MATERIALS.map((m) => m.fn));
const ATOM_BY_FN = new Map(ATOMS.map((a) => [a.fn, a]));

function atomOfKind(fn: string, kind: 'field' | 'warp' | 'colormod'): boolean {
  return ATOM_BY_FN.get(fn)?.kind === kind;
}

/** Human-readable reason a recipe cannot compose, or null when it can. Loud
 *  and specific — a picker drift must name the missing fn, never render black. */
export function validateRecipe(recipe: MaterialRecipe): string | null {
  if (recipe.version !== 1) return `unrecognized recipe version ${String((recipe as { version?: unknown }).version)}`;
  if (!/^[a-z0-9-]+$/.test(recipe.id)) return `recipe id '${recipe.id}' must be [a-z0-9-]+`;
  if (!MATERIAL_FNS.has(recipe.base.fn)) return `base material '${recipe.base.fn}' is not in the generated registry`;
  if (recipe.base.warp && !atomOfKind(recipe.base.warp.atom, 'warp')) return `base warp '${recipe.base.warp.atom}' is not a warp atom`;
  for (const [index, layer] of recipe.layers.entries()) {
    const at = `layer ${index + 1} (${layer.atom})`;
    const isSurface = MATERIAL_FNS.has(layer.atom);
    const isColormod = atomOfKind(layer.atom, 'colormod');
    if (!isSurface && !isColormod) return `${at}: not a catalog material or colormod atom`;
    if (layer.mask && !atomOfKind(layer.mask.field, 'field')) return `${at}: mask '${layer.mask.field}' is not a field atom`;
    if (layer.warp && !atomOfKind(layer.warp.atom, 'warp')) return `${at}: warp '${layer.warp.atom}' is not a warp atom`;
  }
  return null;
}

export function recipeFnName(id: string): string {
  return `recipe_${id.replace(/-/g, '_')}`;
}

/** Deterministic float literal — every number the emitter writes goes through
 *  here so equal recipes emit byte-identical WGSL. */
function f32(value: number): string {
  if (!Number.isFinite(value)) return '0.0';
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

/** Every fn the recipe references (base + layer surfaces/colormods + masks +
 *  warps), first-seen order. Feed to resolveMaterialFns for the transitive
 *  closure. */
export function recipeFns(recipe: MaterialRecipe): string[] {
  const fns: string[] = [recipe.base.fn];
  if (recipe.base.warp) fns.push(recipe.base.warp.atom);
  for (const layer of recipe.layers) {
    if (layer.enabled === false) continue;
    fns.push(layer.atom);
    if (layer.mask) fns.push(layer.mask.field);
    if (layer.warp) fns.push(layer.warp.atom);
  }
  return [...new Set(fns)];
}

function emitMaskFactor(mask: RecipeMask, seedExpr: string, lines: string[]): void {
  const threshold = mask.threshold ?? 0.5;
  const softness = Math.max(0.0001, mask.softness ?? 0.25);
  lines.push(`    let mask_v = ${mask.field}(uv, px, ${seedExpr});`);
  const gate = `smoothstep(${f32(threshold - softness)}, ${f32(threshold + softness)}, mask_v)`;
  lines.push(`    factor = factor * ${mask.invert ? `(1.0 - ${gate})` : gate};`);
}

/** The recipe compiled to one WGSL fn named `fnName`, truncated after
 *  `throughLayer` enabled layers (-1 = base only; layers.length = the full
 *  recipe). Truncation drives the intermediates strip: stage i IS the recipe
 *  with its tail cut, not a separate program. */
function emitRecipeFn(recipe: MaterialRecipe, fnName: string, throughLayer: number): string {
  const lines: string[] = [];
  lines.push(`fn ${fnName}(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {`);
  const base = recipe.base;
  const baseVariant = base.variant === undefined ? 'variant' : f32(base.variant);
  const baseSeed = base.seed === undefined ? 'seed' : f32(base.seed);
  if (base.warp) {
    lines.push(`  let base_uv = ${base.warp.atom}(uv, ${baseSeed}, ${f32(base.warp.amount)});`);
    lines.push(`  var col = ${base.fn}(base_uv, px, ${baseVariant}, ${baseSeed});`);
  } else {
    lines.push(`  var col = ${base.fn}(uv, px, ${baseVariant}, ${baseSeed});`);
  }
  let emitted = 0;
  for (const [index, layer] of recipe.layers.entries()) {
    if (layer.enabled === false) continue;
    if (emitted > throughLayer) break;
    emitted += 1;
    const seedExpr = layer.seed === undefined ? `seed + ${f32((index + 1) * 7)}` : f32(layer.seed);
    const isSurface = MATERIAL_FNS.has(layer.atom);
    lines.push(`  {`);
    if (layer.warp) {
      lines.push(`    let layer_uv = ${layer.warp.atom}(uv, ${seedExpr}, ${f32(layer.warp.amount)});`);
    } else {
      lines.push(`    let layer_uv = uv;`);
    }
    lines.push(`    var factor = ${f32(layer.opacity ?? 1)};`);
    if (layer.mask) emitMaskFactor(layer.mask, seedExpr, lines);
    if (isSurface) {
      lines.push(`    let over = ${layer.atom}(layer_uv, px, ${f32(layer.variant ?? 0)}, ${seedExpr});`);
      lines.push(`    col = surface_blend(${layer.blend ?? 0}, col, over, factor);`);
    } else {
      lines.push(`    col = mix(col, ${layer.atom}(col, layer_uv, px, ${seedExpr}, ${f32(layer.amount ?? 1)}), factor);`);
    }
    lines.push(`  }`);
  }
  lines.push(`  return sat3(col);`);
  lines.push(`}`);
  return lines.join('\n');
}

/** The recipe as one standard-signature material fn (the whole stack). */
export function composeRecipeFn(recipe: MaterialRecipe): string {
  return emitRecipeFn(recipe, recipeFnName(recipe.id), recipe.layers.length);
}

function composedModule(recipe: MaterialRecipe, fns: string[], pick: string): string | null {
  const resolved = resolveMaterialFns(recipeFns(recipe));
  if (!resolved) return null;
  const { prelude, bodies, atoms } = splitFillDispatch();
  return [prelude, ...resolved.map((fn) => (bodies.get(fn) ?? atoms.get(fn))!), ...fns, pick, FILL_MAIN_SRC].join('\n');
}

/** A full Effect module for the recipe — prelude + only the bodies the stack
 *  actually calls + the recipe fn + a fill_pick that always evaluates it. The
 *  exact FILL_SHADER D[] contract holds (variant/seed/quality drive the fn,
 *  the packed-grid envelope batches thumbnails), so ShaderThumb, the paint
 *  grid, and the Lab stage all consume it unchanged. Null when a referenced
 *  fn is missing (already reported loudly by compose). */
export function recipeShader(recipe: MaterialRecipe): string | null {
  const fn = composeRecipeFn(recipe);
  const name = recipeFnName(recipe.id);
  const pick = `
fn fill_pick(material: i32, board: f32, uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  return ${name}(uv, px, variant, seed);
}`;
  return composedModule(recipe, [fn], pick);
}

/** One module carrying every stage prefix of the recipe (stage 0 = base only,
 *  stage i = through enabled layer i), dispatched by materialId — so the
 *  intermediates strip is ONE packed-grid Effect whose cell i carries
 *  [i, variant, seed, quality, board] and lights up stage i. */
export function recipeStageShader(recipe: MaterialRecipe): string | null {
  const name = recipeFnName(recipe.id);
  const enabledCount = recipe.layers.filter((layer) => layer.enabled !== false).length;
  const stageFns: string[] = [];
  const arms: string[] = [];
  for (let stage = 0; stage <= enabledCount; stage += 1) {
    const stageName = `${name}_stage_${stage}`;
    stageFns.push(emitRecipeFn(recipe, stageName, stage - 1));
    arms.push(`  ${stage === 0 ? 'if' : '} else if'} (material == ${stage}) {\n    col = ${stageName}(uv, px, variant, seed);`);
  }
  const pick = `
fn fill_pick(material: i32, board: f32, uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = vec3f(0.0, 0.0, 0.0);
${arms.join('\n')}
  }
  return col;
}`;
  return composedModule(recipe, stageFns, pick);
}
