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
//   data (variant, seed, quality, palette, and EVERY tunable scalar —
//     opacities, mask thresholds, warp amounts, atom @params) → floats in the
//     D[] palette/param sections, ZERO recompile. The emitter routes each
//     tunable through mat_param(i, baked) and each layer's colors through
//     mat_pal with a call-site slot offset, so the shader STRING is a pure
//     function of the recipe's TOPOLOGY, never of its numbers.
//
// The parser/walker of a format lives beside the format: this file is the ONLY
// author of recipe WGSL. blend kinds are helpers.wgsl's surface_blend
// (0 over · 1 add · 2 multiply · 3 screen); masks gate through smoothstep
// around a threshold; warps obey amount=0 ⇒ identity, so a zeroed warp slider
// is exactly the unwarped material.
import { splitFillDispatch, resolveMaterialFns } from './compose';
import { FILL_MAIN_SRC } from './index';
import { ATOMS, MATERIALS, type RegistryParam } from './_generated/registry';

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

/** Per-slot color overrides for one call site, in the owning material's slot
 *  order; null/absent = the baked constant. Pure DATA — never in the string. */
export type RecipePalette = (readonly [number, number, number] | null)[];

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
  /** surface layers: slot color overrides, riding the layer through reorders. */
  palette?: RecipePalette;
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
    palette?: RecipePalette;
  };
  layers: RecipeLayer[];
  /** stored atom-@param values, keyed by RecipeParamEntry.key. Structural
   *  tunables (opacity, thresholds, amounts) live on their layer fields; this
   *  map carries only the callee knobs. Pure DATA — never in the string. */
  params?: Record<string, number>;
};

const MATERIAL_BY_FN = new Map(MATERIALS.map((m) => [m.fn, m]));
const ATOM_BY_FN = new Map(ATOMS.map((a) => [a.fn, a]));

function atomOfKind(fn: string, kind: 'field' | 'warp' | 'colormod'): boolean {
  return ATOM_BY_FN.get(fn)?.kind === kind;
}

function fnParams(fn: string): RegistryParam[] {
  return MATERIAL_BY_FN.get(fn)?.params ?? ATOM_BY_FN.get(fn)?.params ?? [];
}

function fnSlotCount(fn: string): number {
  return MATERIAL_BY_FN.get(fn)?.slots.length ?? 0;
}

/** Human-readable reason a recipe cannot compose, or null when it can. Loud
 *  and specific — a picker drift must name the missing fn, never render black. */
export function validateRecipe(recipe: MaterialRecipe): string | null {
  if (recipe.version !== 1) return `unrecognized recipe version ${String((recipe as { version?: unknown }).version)}`;
  if (!/^[a-z0-9-]+$/.test(recipe.id)) return `recipe id '${recipe.id}' must be [a-z0-9-]+`;
  if (!MATERIAL_BY_FN.has(recipe.base.fn)) return `base material '${recipe.base.fn}' is not in the generated registry`;
  if (recipe.base.warp && !atomOfKind(recipe.base.warp.atom, 'warp')) return `base warp '${recipe.base.warp.atom}' is not a warp atom`;
  for (const [index, layer] of recipe.layers.entries()) {
    const at = `layer ${index + 1} (${layer.atom})`;
    const isSurface = MATERIAL_BY_FN.has(layer.atom);
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

// ── the ONE walk that assigns D-table indices ────────────────────────────────
// The emitter and the inspector UI must agree on every index, so both read
// this single traversal. Order: recipe-level tunables and call-site @param
// regions interleaved in stack order (base first, then each enabled layer);
// slots in call order (base material, then each enabled surface layer).

export type RecipeParamEntry = {
  /** stable identity for overrides: 'base.warp.amount', 'layer.2.opacity',
   *  'layer.2.mask.field_fbm.scale', ... */
  key: string;
  /** -1 = base, otherwise the layer's index in recipe.layers. */
  layer: number;
  label: string;
  default: number;
  min: number;
  max: number;
};

export type RecipeSlotEntry = {
  /** -1 = base, otherwise the layer's index in recipe.layers. */
  layer: number;
  /** the owning material fn */
  fn: string;
  /** the slot's index within its owning call site (RecipePalette position). */
  ordinal: number;
  name: string;
  /** the RESOLVED color: the call site's stored override, else the baked rgb. */
  rgb: [number, number, number];
  baked: [number, number, number];
};

type ParamIndexMap = Map<string, number>;

function pushFnParams(
  recipe: MaterialRecipe,
  entries: RecipeParamEntry[],
  layer: number,
  siteKey: string,
  fn: string,
  labelPrefix: string,
): void {
  for (const p of fnParams(fn)) {
    const key = `${siteKey}.${fn}.${p.key}`;
    entries.push({
      key,
      layer,
      label: `${labelPrefix}${p.label}`,
      default: recipe.params?.[key] ?? p.default,
      min: p.min,
      max: p.max,
    });
  }
}

/** The recipe's flat param table, in mat_param index order. Defaults reflect
 *  STORED values (layer fields / recipe.params), so recipeData with no
 *  overrides renders the document as saved. */
export function recipeParams(recipe: MaterialRecipe): RecipeParamEntry[] {
  const entries: RecipeParamEntry[] = [];
  const base = recipe.base;
  if (base.warp) {
    entries.push({ key: 'base.warp.amount', layer: -1, label: 'Base warp', default: base.warp.amount, min: 0, max: 2 });
    pushFnParams(recipe, entries, -1, 'base.warp', base.warp.atom, 'Base warp · ');
  }
  pushFnParams(recipe, entries, -1, 'base', base.fn, 'Base · ');
  for (const [index, layer] of recipe.layers.entries()) {
    if (layer.enabled === false) continue;
    const n = index + 1;
    const isSurface = MATERIAL_BY_FN.has(layer.atom);
    entries.push({ key: `layer.${index}.opacity`, layer: index, label: `Layer ${n} opacity`, default: layer.opacity ?? 1, min: 0, max: 1 });
    if (!isSurface) {
      entries.push({ key: `layer.${index}.amount`, layer: index, label: `Layer ${n} amount`, default: layer.amount ?? 1, min: -1, max: 2 });
    }
    if (layer.mask) {
      entries.push({ key: `layer.${index}.mask.threshold`, layer: index, label: `Layer ${n} mask threshold`, default: layer.mask.threshold ?? 0.5, min: 0, max: 1 });
      entries.push({ key: `layer.${index}.mask.softness`, layer: index, label: `Layer ${n} mask softness`, default: layer.mask.softness ?? 0.25, min: 0.0001, max: 0.5 });
      pushFnParams(recipe, entries, index, `layer.${index}.mask`, layer.mask.field, `Layer ${n} mask · `);
    }
    if (layer.warp) {
      entries.push({ key: `layer.${index}.warp.amount`, layer: index, label: `Layer ${n} warp`, default: layer.warp.amount, min: 0, max: 2 });
      pushFnParams(recipe, entries, index, `layer.${index}.warp`, layer.warp.atom, `Layer ${n} warp · `);
    }
    pushFnParams(recipe, entries, index, `layer.${index}`, layer.atom, `Layer ${n} · `);
  }
  return entries;
}

/** The recipe's flat palette table, in mat_pal index order. Colors resolve
 *  stored per-call-site overrides over the baked constants. */
export function recipeSlots(recipe: MaterialRecipe): RecipeSlotEntry[] {
  const entries: RecipeSlotEntry[] = [];
  const push = (layer: number, fn: string, palette: RecipePalette | undefined) => {
    const mat = MATERIAL_BY_FN.get(fn);
    if (!mat) return;
    mat.slots.forEach((slot, ordinal) => {
      const baked: [number, number, number] = [slot.rgb[0], slot.rgb[1], slot.rgb[2]];
      const override = palette?.[ordinal] ?? null;
      entries.push({
        layer,
        fn,
        ordinal,
        name: slot.name,
        rgb: override ? [override[0], override[1], override[2]] : baked,
        baked,
      });
    });
  };
  push(-1, recipe.base.fn, recipe.base.palette);
  for (const [index, layer] of recipe.layers.entries()) {
    if (layer.enabled === false) continue;
    if (MATERIAL_BY_FN.has(layer.atom)) push(index, layer.atom, layer.palette);
  }
  return entries;
}

function paramIndexMap(recipe: MaterialRecipe): ParamIndexMap {
  const map: ParamIndexMap = new Map();
  recipeParams(recipe).forEach((entry, index) => map.set(entry.key, index));
  return map;
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

// ── the emitter ──────────────────────────────────────────────────────────────

type EmitCtx = {
  params: ParamIndexMap;
  /** call-site param region starts, keyed like params */
  paramRegion: Map<string, number>;
  /** call-site slot region starts */
  slotRegion: Map<string, number>;
};

function buildCtx(recipe: MaterialRecipe): EmitCtx {
  const params = paramIndexMap(recipe);
  const paramRegion = new Map<string, number>();
  const table = recipeParams(recipe);
  // A call site's region starts at its fn's FIRST param entry.
  for (const [index, entry] of table.entries()) {
    const site = entry.key.split('.').slice(0, -2).join('.') + '.' + entry.key.split('.').slice(-2, -1)[0];
    if (!paramRegion.has(site)) paramRegion.set(site, index);
  }
  const slotRegion = new Map<string, number>();
  let slotAt = 0;
  const slots = (site: string, fn: string) => {
    slotRegion.set(site, slotAt);
    slotAt += fnSlotCount(fn);
  };
  slots('base', recipe.base.fn);
  for (const [index, layer] of recipe.layers.entries()) {
    if (layer.enabled === false) continue;
    if (MATERIAL_BY_FN.has(layer.atom)) slots(`layer.${index}`, layer.atom);
  }
  return { params, paramRegion, slotRegion };
}

/** mat_param read for a recipe-level tunable (absolute index, offset 0). */
function tunable(ctx: EmitCtx, key: string, baked: number): string {
  const index = ctx.params.get(key);
  return index === undefined ? f32(baked) : `mat_param(${index}, ${f32(baked)})`;
}

/** Emit `<callee>(...)` bracketed by slot/param offset rebasing when the
 *  callee owns slots or @params; plain call otherwise. */
function sitedCall(ctx: EmitCtx, lines: string[], siteKey: string, fn: string, call: string, assign: string): void {
  const paramStart = ctx.paramRegion.get(`${siteKey}.${fn}`);
  const slotStart = ctx.slotRegion.get(siteKey);
  const needsParams = paramStart !== undefined && fnParams(fn).length > 0;
  const needsSlots = slotStart !== undefined && slotStart > 0 && fnSlotCount(fn) > 0;
  if (needsParams) lines.push(`    mat_param_offset = ${paramStart};`);
  if (needsSlots) lines.push(`    mat_slot_offset = ${slotStart};`);
  lines.push(`    ${assign} ${call};`);
  if (needsSlots) lines.push(`    mat_slot_offset = 0;`);
  if (needsParams) lines.push(`    mat_param_offset = 0;`);
}

/** The recipe compiled to one WGSL fn named `fnName`, truncated after
 *  `throughLayer` enabled layers (-1 = base only; layers.length = the full
 *  recipe). Truncation drives the intermediates strip: stage i IS the recipe
 *  with its tail cut, not a separate program. Indices come from the FULL
 *  recipe's tables, so one D row drives every stage. */
function emitRecipeFn(recipe: MaterialRecipe, ctx: EmitCtx, fnName: string, throughLayer: number): string {
  const lines: string[] = [];
  lines.push(`fn ${fnName}(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {`);
  const base = recipe.base;
  const baseVariant = base.variant === undefined ? 'variant' : f32(base.variant);
  const baseSeed = base.seed === undefined ? 'seed' : f32(base.seed);
  {
    const inner: string[] = [];
    let domain = 'uv';
    if (base.warp) {
      const amount = tunable(ctx, 'base.warp.amount', base.warp.amount);
      sitedCall(ctx, inner, 'base.warp', base.warp.atom, `${base.warp.atom}(uv, ${baseSeed}, ${amount})`, 'base_domain =');
      domain = 'base_domain';
    }
    sitedCall(ctx, inner, 'base', base.fn, `${base.fn}(${domain}, px, ${baseVariant}, ${baseSeed})`, 'col =');
    if (base.warp) lines.push(`  var base_domain = uv;`);
    lines.push(`  var col = vec3f(0.0, 0.0, 0.0);`);
    lines.push(`  {`);
    lines.push(...inner);
    lines.push(`  }`);
  }
  let emitted = 0;
  for (const [index, layer] of recipe.layers.entries()) {
    if (layer.enabled === false) continue;
    if (emitted > throughLayer) break;
    emitted += 1;
    const seedExpr = layer.seed === undefined ? `seed + ${f32((index + 1) * 7)}` : f32(layer.seed);
    const isSurface = MATERIAL_BY_FN.has(layer.atom);
    lines.push(`  {`);
    const inner: string[] = [];
    if (layer.warp) {
      const amount = tunable(ctx, `layer.${index}.warp.amount`, layer.warp.amount);
      sitedCall(ctx, inner, `layer.${index}.warp`, layer.warp.atom, `${layer.warp.atom}(uv, ${seedExpr}, ${amount})`, 'layer_uv =');
    }
    inner.push(`    var factor = ${tunable(ctx, `layer.${index}.opacity`, layer.opacity ?? 1)};`);
    if (layer.mask) {
      const threshold = tunable(ctx, `layer.${index}.mask.threshold`, layer.mask.threshold ?? 0.5);
      const softness = tunable(ctx, `layer.${index}.mask.softness`, layer.mask.softness ?? 0.25);
      sitedCall(ctx, inner, `layer.${index}.mask`, layer.mask.field, `${layer.mask.field}(uv, px, ${seedExpr})`, 'let mask_v =');
      inner.push(`    let mask_t = ${threshold};`);
      inner.push(`    let mask_s = max(${softness}, 0.0001);`);
      const gate = `smoothstep(mask_t - mask_s, mask_t + mask_s, mask_v)`;
      inner.push(`    factor = factor * ${layer.mask.invert ? `(1.0 - ${gate})` : gate};`);
    }
    if (isSurface) {
      sitedCall(ctx, inner, `layer.${index}`, layer.atom, `${layer.atom}(layer_uv, px, ${f32(layer.variant ?? 0)}, ${seedExpr})`, 'let over =');
      inner.push(`    col = surface_blend(${layer.blend ?? 0}, col, over, factor);`);
    } else {
      const amount = tunable(ctx, `layer.${index}.amount`, layer.amount ?? 1);
      sitedCall(ctx, inner, `layer.${index}`, layer.atom, `${layer.atom}(col, layer_uv, px, ${seedExpr}, ${amount})`, 'let filtered =');
      inner.push(`    col = mix(col, filtered, factor);`);
    }
    lines.push(`    var layer_uv = uv;`);
    lines.push(...inner);
    lines.push(`  }`);
  }
  lines.push(`  return sat3(col);`);
  lines.push(`}`);
  return lines.join('\n');
}

/** The recipe as one standard-signature material fn (the whole stack). */
export function composeRecipeFn(recipe: MaterialRecipe): string {
  return emitRecipeFn(recipe, buildCtx(recipe), recipeFnName(recipe.id), recipe.layers.length);
}

/** The STRUCTURE of a recipe, minus every data-speed number. The Lab keys
 *  recomposition on this: while it is unchanged, slider commits into the
 *  stored recipe never rebuild a pipeline — the full param/palette tables in
 *  recipeData override the (now stale) baked defaults, pixel-equivalently. */
export function recipeTopologyKey(recipe: MaterialRecipe): string {
  return JSON.stringify({
    id: recipe.id,
    base: {
      fn: recipe.base.fn,
      variant: recipe.base.variant,
      seed: recipe.base.seed,
      warp: recipe.base.warp?.atom ?? null,
    },
    layers: recipe.layers
      .filter((layer) => layer.enabled !== false)
      .map((layer, order) => ({
        order,
        atom: layer.atom,
        variant: layer.variant ?? 0,
        seed: layer.seed,
        blend: layer.blend ?? 0,
        mask: layer.mask ? { field: layer.mask.field, invert: layer.mask.invert ?? false } : null,
        warp: layer.warp?.atom ?? null,
      })),
  });
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
  const ctx = buildCtx(recipe);
  const enabledCount = recipe.layers.filter((layer) => layer.enabled !== false).length;
  const stageFns: string[] = [];
  const arms: string[] = [];
  for (let stage = 0; stage <= enabledCount; stage += 1) {
    const stageName = `${name}_stage_${stage}`;
    stageFns.push(emitRecipeFn(recipe, ctx, stageName, stage - 1));
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

// ── the data side (zero-recompile) ───────────────────────────────────────────

export type RecipeDataOptions = {
  variant?: number;
  seed?: number;
  quality?: number;
  /** overrides keyed by RecipeSlotEntry table index. */
  palette?: ReadonlyMap<number, readonly [number, number, number]>;
  /** overrides keyed by RecipeParamEntry.key. */
  params?: ReadonlyMap<string, number>;
};

/** The full D row for a recipe preview: [0, variant, seed, quality, 0] +
 *  palette section (the flat slot table with overrides) + param section (the
 *  flat param table with overrides). Only DATA changes here — the shader
 *  string from recipeShader is untouched by any of these numbers, which is
 *  the zero-recompile proof surface. */
export function recipeData(recipe: MaterialRecipe, options: RecipeDataOptions = {}): number[] {
  const slots = recipeSlots(recipe);
  const params = recipeParams(recipe);
  const out: number[] = [0, options.variant ?? 0, options.seed ?? 7, options.quality ?? 3, 0];
  out.push(slots.length);
  slots.forEach((slot, index) => {
    const override = options.palette?.get(index);
    const rgb = override ?? slot.rgb;
    out.push(rgb[0], rgb[1], rgb[2]);
  });
  out.push(params.length);
  for (const entry of params) {
    out.push(options.params?.get(entry.key) ?? entry.default);
  }
  return out;
}

/** Stage-strip rows: cell i drives stage i through the SAME palette/param
 *  tables (indices are full-recipe stable), so one packed grid previews every
 *  intermediate under the live slider values. */
export function recipeStageData(recipe: MaterialRecipe, options: RecipeDataOptions = {}): number[][] {
  const enabledCount = recipe.layers.filter((layer) => layer.enabled !== false).length;
  const rows: number[][] = [];
  for (let stage = 0; stage <= enabledCount; stage += 1) {
    const row = recipeData(recipe, options);
    row[0] = stage;
    rows.push(row);
  }
  return rows;
}
