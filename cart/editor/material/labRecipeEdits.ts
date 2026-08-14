// editor/material/labRecipeEdits.ts — the Lab's pure recipe mutations, the
// edit vocabulary every onEditRecipe call applies (req_4395; extracted from
// the stage surface in req_4406 when the STACK and the Lab inspector moved
// onto the real rails and started editing from separate panels).
import type { MaterialRecipe } from '../render3d/shaders/recipe';
import type { Rgb } from '../data/types';

export function mutateLayer(
  recipe: MaterialRecipe,
  index: number,
  mutate: (layer: MaterialRecipe['layers'][number]) => MaterialRecipe['layers'][number],
): MaterialRecipe | null {
  const layer = recipe.layers[index];
  if (!layer) return null;
  const layers = [...recipe.layers];
  layers[index] = mutate(layer);
  return { ...recipe, layers };
}

export function moveLayer(recipe: MaterialRecipe, index: number, direction: 1 | -1): MaterialRecipe | null {
  const to = index + direction;
  if (to < 0 || to >= recipe.layers.length) return null;
  const layers = [...recipe.layers];
  const [layer] = layers.splice(index, 1);
  layers.splice(to, 0, layer!);
  // Stored atom-knob keys are layer-indexed; remap the two swapped positions.
  const params: Record<string, number> = {};
  for (const [key, value] of Object.entries(recipe.params ?? {})) {
    const remapped = key
      .replace(new RegExp(`^layer\\.${index}\\.`), `layer.__swap__.`)
      .replace(new RegExp(`^layer\\.${to}\\.`), `layer.${index}.`)
      .replace(/^layer\.__swap__\./, `layer.${to}.`);
    params[remapped] = value;
  }
  return { ...recipe, layers, params };
}

export function storeParam(recipe: MaterialRecipe, key: string, value: number): MaterialRecipe {
  // Structural tunables live on their layer fields; atom knobs in recipe.params.
  const structural = /^(base\.warp\.amount|layer\.(\d+)\.(opacity|amount|warp\.amount|mask\.threshold|mask\.softness))$/.exec(key);
  if (!structural) {
    return { ...recipe, params: { ...(recipe.params ?? {}), [key]: value } };
  }
  if (key === 'base.warp.amount') {
    return recipe.base.warp ? { ...recipe, base: { ...recipe.base, warp: { ...recipe.base.warp, amount: value } } } : recipe;
  }
  const layerIndex = Number(structural[2]);
  const field = structural[3]!;
  const mutated = mutateLayer(recipe, layerIndex, (layer) => {
    if (field === 'opacity') return { ...layer, opacity: value };
    if (field === 'amount') return { ...layer, amount: value };
    if (field === 'warp.amount') return layer.warp ? { ...layer, warp: { ...layer.warp, amount: value } } : layer;
    if (field === 'mask.threshold') return layer.mask ? { ...layer, mask: { ...layer.mask, threshold: value } } : layer;
    return layer.mask ? { ...layer, mask: { ...layer.mask, softness: value } } : layer;
  });
  return mutated ?? recipe;
}

export function storeSlot(recipe: MaterialRecipe, layer: number, ordinal: number, rgb: Rgb): MaterialRecipe {
  const next: [number, number, number] = [rgb[0], rgb[1], rgb[2]];
  if (layer === -1) {
    const palette = [...(recipe.base.palette ?? [])];
    while (palette.length <= ordinal) palette.push(null);
    palette[ordinal] = next;
    return { ...recipe, base: { ...recipe.base, palette } };
  }
  const mutated = mutateLayer(recipe, layer, (l) => {
    const palette = [...(l.palette ?? [])];
    while (palette.length <= ordinal) palette.push(null);
    palette[ordinal] = next;
    return { ...l, palette };
  });
  return mutated ?? recipe;
}

export function resetPalettes(recipe: MaterialRecipe, selected: number | null): MaterialRecipe | null {
  if (selected === -1) {
    if (!recipe.base.palette) return null;
    return { ...recipe, base: { ...recipe.base, palette: undefined } };
  }
  if (selected !== null) {
    return mutateLayer(recipe, selected, (l) => ({ ...l, palette: undefined }));
  }
  const anyOwned = recipe.base.palette || recipe.layers.some((l) => l.palette);
  if (!anyOwned) return null;
  return {
    ...recipe,
    base: { ...recipe.base, palette: undefined },
    layers: recipe.layers.map((l) => ({ ...l, palette: undefined })),
  };
}
