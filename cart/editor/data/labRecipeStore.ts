// editor/data/labRecipeStore.ts — on-disk persistence for Material Lab
// recipes. Same per-concern-file contract as globalsStore / colorLibraryStore
// (V20: never one blob): loads once at boot (persistView.loadPersistedState),
// debounced micro-save on every recipe change. A recipe here is a WORKING
// document — "save to catalog" (a .wgsl in materials/ with the recipe JSON
// embedded) is a separate, explicit promotion, not this store's job.
import { mkdir, readFile, writeFile, writeFileBytesAtomic } from '../../../runtime/hooks/fs';
import { EDITOR_DATA_ROOT } from './editorDataRoot';
import { textBytes } from '../../../runtime/workspace/lumps';
import { validateRecipe, type MaterialRecipe } from '../render3d/shaders/recipe';

export const LAB_RECIPES_FILE = `${EDITOR_DATA_ROOT}/lab-recipes.json`;

export type LabRecipesSave = {
  version: 1;
  recipes: MaterialRecipe[];
};

/** Read the recipe documents. Null = no file yet (fresh install) or
 *  unreadable — a malformed file is reported LOUD and left untouched. Rows
 *  that no longer validate (a deleted material, a renamed atom) are KEPT —
 *  the Lab shows their reason instead of silently dropping authored work. */
export function loadLabRecipes(): MaterialRecipe[] | null {
  const text = readFile(LAB_RECIPES_FILE);
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<LabRecipesSave>;
    if (raw.version !== 1) throw new Error(`unrecognized shape (version ${raw.version})`);
    if (!Array.isArray(raw.recipes)) throw new Error('recipes is not a list');
    const recipes = raw.recipes.filter((recipe): recipe is MaterialRecipe =>
      !!recipe && typeof recipe === 'object' && typeof (recipe as MaterialRecipe).id === 'string');
    for (const recipe of recipes) {
      const reason = validateRecipe(recipe);
      if (reason) console.warn(`[lab-recipes] '${recipe.id}' will not compose until fixed: ${reason}`);
    }
    return recipes;
  } catch (err) {
    console.error(`[lab-recipes] ${LAB_RECIPES_FILE} is malformed — booting without recipes, the file stays untouched until the next save: ${err}`);
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queued: LabRecipesSave | null = null;
let dirReady = false;

function writeSave(save: LabRecipesSave): boolean {
  if (!dirReady) {
    mkdir(EDITOR_DATA_ROOT);
    dirReady = true;
  }
  const text = JSON.stringify(save);
  const ok = writeFileBytesAtomic(LAB_RECIPES_FILE, textBytes(text)) || writeFile(LAB_RECIPES_FILE, text);
  if (!ok) {
    console.error(`[lab-recipes] SAVE FAILED: ${LAB_RECIPES_FILE} — recipes will NOT survive a restart`);
  }
  return ok;
}

function writeQueued(): void {
  saveTimer = null;
  const save = queued;
  queued = null;
  if (save) writeSave(save);
}

/** Schedule a micro-save of the recipe documents (debounced). AppFrame calls
 *  this on every labRecipes change. */
export function scheduleLabRecipesSave(recipes: readonly MaterialRecipe[], delayMs = 400): void {
  queued = { version: 1, recipes: recipes.map((recipe) => JSON.parse(JSON.stringify(recipe)) as MaterialRecipe) };
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(writeQueued, Math.max(0, delayMs));
}
