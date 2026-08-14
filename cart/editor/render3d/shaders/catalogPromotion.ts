// catalogPromotion.ts — "save to catalog": a Material Lab recipe emitted as a
// REAL materials/*.wgsl source. The generator then owns it like any
// hand-written material: stable id from ids.json, palette slots extracted,
// @params parsed — no special-casing anywhere downstream.
//
// Alignment contract (the part that must never drift): the saved file's
// @param declaration order IS the session's recipeParams() order, and its
// dummy slot lets appear in recipeSlots() order — so the mat_param_offset /
// mat_slot_offset call-site rebasing emitted into the body lands on the same
// table positions after the generator's own extraction. The recipe JSON rides
// a trailing `// @recipe-json` line, which the generator lifts into the
// registry so the Lab can reopen the material editable.
import { ATOMS, MATERIALS } from './_generated/registry';
import {
  recipeParams,
  recipeSlots,
  validateRecipe,
  type MaterialRecipe,
  type RecipeParamEntry,
} from './recipe';

const MATERIAL_BY_FN = new Map(MATERIALS.map((m) => [m.fn, m]));
const TAKEN_FNS = new Set([...MATERIALS.map((m) => m.fn), ...ATOMS.map((a) => a.fn)]);

export type PromotionSource =
  | { ok: true; fn: string; fileName: string; source: string }
  | { ok: false; error: string };

function f32(value: number): string {
  if (!Number.isFinite(value)) return '0.0';
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

/** `layer.0.mask.field_fbm.scale` → a WGSL-legal, human-readable identifier. */
function paramIdent(key: string): string {
  return `p_${key.replace(/[^a-z0-9]+/gi, '_')}`;
}

/** The saved material's WGSL source, or the reason it cannot be promoted. */
export function promoteRecipeSource(recipe: MaterialRecipe): PromotionSource {
  const invalid = validateRecipe(recipe);
  if (invalid) return { ok: false, error: invalid };
  const fn = recipe.id.replace(/-/g, '_');
  if (TAKEN_FNS.has(fn)) {
    const existing = MATERIAL_BY_FN.get(fn);
    if (!existing || existing.author !== 'lab') {
      return { ok: false, error: `fn '${fn}' already names a ${existing ? 'material' : 'atom'} — rename the recipe first` };
    }
    // Re-saving a lab material over itself is the update path — allowed.
  }
  const base = MATERIAL_BY_FN.get(recipe.base.fn)!;
  const variantLabels = recipe.base.variant === undefined
    ? base.variantLabels
    : [base.variantLabels[recipe.base.variant] ?? 'Fixed'];
  const kind = recipe.layers.some((l) => l.enabled !== false) || recipe.base.warp ? 'composition' : 'surface';
  const tags = [...new Set(['lab', ...base.tags])];

  const params = recipeParams(recipe);
  const slots = recipeSlots(recipe);
  const json = JSON.stringify(recipe);
  if (json.includes('`') || json.includes('${')) {
    return { ok: false, error: 'recipe name/fields may not contain backticks or ${ — the dispatch embeds sources in a template literal' };
  }
  const identByKey = new Map(params.map((entry) => [entry.key, paramIdent(entry.key)]));
  // Structural tunables are written straight into the body; callee @param
  // knobs get a no-op let so the generator's used-identifier law holds and
  // their values land at the exact table positions the offsets expect.
  const structural = (key: string) => identByKey.get(key)!;

  const lines: string[] = [];
  lines.push(`// @material ${fn}`);
  lines.push(`// @slug ${recipe.id}`);
  lines.push(`// @name ${recipe.name}`);
  lines.push(`// @board ${base.board}`);
  lines.push(`// @variant-labels ${variantLabels.join(', ')}`);
  lines.push(`// @kind ${kind}`);
  lines.push(`// @tags ${tags.join(', ')}`);
  lines.push(`// @author lab`);
  for (const entry of params) {
    lines.push(`// @param ${identByKey.get(entry.key)}: f32 = ${f32(entry.default)} range(${f32(entry.min)}, ${f32(entry.max)}) "${entry.label.replace(/"/g, "'")}"`);
  }
  lines.push(`fn ${fn}(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {`);

  const body: string[] = [];
  // The slot table — one literal per flat-table position, in extraction order.
  // The generator lifts each into the palette; the offsets below index them.
  // Extraction excludes exact all-0/all-1 triples (clamp bounds, not paint),
  // so nudge those inside the range — invisibly — to keep table positions.
  const extractable = (rgb: readonly number[]): number[] => {
    const all = (v: number) => rgb.every((c) => c === v);
    if (all(0)) return [0.001, 0.001, 0.001];
    if (all(1)) return [0.999, 0.999, 0.999];
    return [...rgb];
  };
  slots.forEach((slot, index) => {
    body.push(`  let lab_slot_${index} = vec3f(${extractable(slot.rgb).map((v) => f32(v)).join(', ')}); // ${slot.layer === -1 ? 'base' : `layer ${slot.layer + 1}`} · ${slot.name}`);
  });
  // Callee-knob anchors: unused lets that pin those @params to their table rows.
  params.forEach((entry) => {
    if (isStructuralKey(entry)) return;
    body.push(`  let lab_knob_${identByKey.get(entry.key)} = ${identByKey.get(entry.key)}; // callee knob anchor`);
  });

  const paramIndexByKey = new Map(params.map((entry, index) => [entry.key, index]));
  const siteParamStart = (siteKey: string, calleeFn: string): number | undefined => {
    const prefix = `${siteKey}.${calleeFn}.`;
    const first = params.findIndex((entry) => entry.key.startsWith(prefix));
    return first === -1 ? undefined : first;
  };
  const slotStartBySite = new Map<string, number>();
  {
    let at = 0;
    const claim = (site: string, calleeFn: string) => {
      slotStartBySite.set(site, at);
      at += MATERIAL_BY_FN.get(calleeFn)?.slots.length ?? 0;
    };
    claim('base', recipe.base.fn);
    recipe.layers.forEach((layer, index) => {
      if (layer.enabled === false) return;
      if (MATERIAL_BY_FN.has(layer.atom)) claim(`layer.${index}`, layer.atom);
    });
  }
  const sited = (siteKey: string, calleeFn: string, call: string, assign: string) => {
    const paramStart = siteParamStart(siteKey, calleeFn);
    const slotStart = slotStartBySite.get(siteKey);
    const needsParams = paramStart !== undefined;
    const needsSlots = slotStart !== undefined && slotStart > 0;
    if (needsParams) body.push(`  mat_param_offset = ${paramStart};`);
    if (needsSlots) body.push(`  mat_slot_offset = ${slotStart};`);
    body.push(`  ${assign} ${call};`);
    if (needsSlots) body.push(`  mat_slot_offset = 0;`);
    if (needsParams) body.push(`  mat_param_offset = 0;`);
  };

  const baseVariant = recipe.base.variant === undefined ? 'variant' : f32(recipe.base.variant);
  const baseSeed = recipe.base.seed === undefined ? 'seed' : f32(recipe.base.seed);
  body.push(`  var col = vec3f(0.0, 0.0, 0.0);`);
  if (recipe.base.warp) {
    body.push(`  var base_domain = uv;`);
    sited('base.warp', recipe.base.warp.atom, `${recipe.base.warp.atom}(uv, ${baseSeed}, ${structural('base.warp.amount')})`, 'base_domain =');
    sited('base', recipe.base.fn, `${recipe.base.fn}(base_domain, px, ${baseVariant}, ${baseSeed})`, 'col =');
  } else {
    sited('base', recipe.base.fn, `${recipe.base.fn}(uv, px, ${baseVariant}, ${baseSeed})`, 'col =');
  }
  recipe.layers.forEach((layer, index) => {
    if (layer.enabled === false) return;
    const seedExpr = layer.seed === undefined ? `seed + ${f32((index + 1) * 7)}` : f32(layer.seed);
    const isSurface = MATERIAL_BY_FN.has(layer.atom);
    body.push(`  {`);
    const block: string[] = [];
    const sitedIn = (siteKey: string, calleeFn: string, call: string, assign: string) => {
      const paramStart = siteParamStart(siteKey, calleeFn);
      const slotStart = slotStartBySite.get(siteKey);
      if (paramStart !== undefined) block.push(`    mat_param_offset = ${paramStart};`);
      if (slotStart !== undefined && slotStart > 0) block.push(`    mat_slot_offset = ${slotStart};`);
      block.push(`    ${assign} ${call};`);
      if (slotStart !== undefined && slotStart > 0) block.push(`    mat_slot_offset = 0;`);
      if (paramStart !== undefined) block.push(`    mat_param_offset = 0;`);
    };
    block.push(`    var layer_uv = uv;`);
    if (layer.warp) {
      sitedIn(`layer.${index}.warp`, layer.warp.atom, `${layer.warp.atom}(uv, ${seedExpr}, ${structural(`layer.${index}.warp.amount`)})`, 'layer_uv =');
    }
    block.push(`    var factor = ${structural(`layer.${index}.opacity`)};`);
    if (layer.mask) {
      sitedIn(`layer.${index}.mask`, layer.mask.field, `${layer.mask.field}(uv, px, ${seedExpr})`, 'let mask_v =');
      block.push(`    let mask_t = ${structural(`layer.${index}.mask.threshold`)};`);
      block.push(`    let mask_s = max(${structural(`layer.${index}.mask.softness`)}, 0.0001);`);
      const gate = `smoothstep(mask_t - mask_s, mask_t + mask_s, mask_v)`;
      block.push(`    factor = factor * ${layer.mask.invert ? `(1.0 - ${gate})` : gate};`);
    }
    if (isSurface) {
      sitedIn(`layer.${index}`, layer.atom, `${layer.atom}(layer_uv, px, ${f32(layer.variant ?? 0)}, ${seedExpr})`, 'let over =');
      block.push(`    col = surface_blend(${layer.blend ?? 0}, col, over, factor);`);
    } else {
      sitedIn(`layer.${index}`, layer.atom, `${layer.atom}(col, layer_uv, px, ${seedExpr}, ${structural(`layer.${index}.amount`)})`, 'let filtered =');
      block.push(`    col = mix(col, filtered, factor);`);
    }
    body.push(...block);
    body.push(`  }`);
  });
  body.push(`  return sat3(col);`);

  lines.push(...body);
  lines.push(`}`);
  lines.push(`// @recipe-json ${json}`);
  return { ok: true, fn, fileName: `${fn}.wgsl`, source: lines.join('\n') + '\n' };
}

function isStructuralKey(entry: RecipeParamEntry): boolean {
  return /^(base\.warp\.amount|layer\.\d+\.(opacity|amount|warp\.amount|mask\.threshold|mask\.softness))$/.test(entry.key);
}
