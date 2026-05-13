// User-saved recipe storage — localStorage-backed CRUD with a tiny
// shape. Premade recipes (recipes.ts) are read-only seeds; saved
// recipes are the user's library.
//
// Names + paths are free-form text fields. The id is allocated on
// first save and never changes; the user edits the name (e.g. "When
// build breaks") and the path (e.g. "recipes/build/break.tsx") freely.
// The recipe list view sorts by updatedAt desc.

const STORE_KEY = 'canvas_recipes_v0';

export interface SavedRecipe {
  id: string;
  name: string;
  path: string;
  code: string;
  createdAt: number;
  updatedAt: number;
}

function read(): SavedRecipe[] {
  try {
    const raw = (globalThis as any).localStorage?.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValid);
  } catch { return []; }
}

function write(list: SavedRecipe[]): void {
  try { (globalThis as any).localStorage?.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

function isValid(r: any): r is SavedRecipe {
  return r && typeof r.id === 'string' && typeof r.name === 'string' &&
         typeof r.path === 'string' && typeof r.code === 'string' &&
         typeof r.createdAt === 'number' && typeof r.updatedAt === 'number';
}

export function listRecipes(): SavedRecipe[] {
  return read().slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getRecipe(id: string): SavedRecipe | null {
  return read().find((r) => r.id === id) ?? null;
}

export function newRecipeId(): string {
  return `recipe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Insert or update a recipe (matched by id). Returns the persisted row. */
export function upsertRecipe(input: Omit<SavedRecipe, 'createdAt' | 'updatedAt'> & Partial<Pick<SavedRecipe, 'createdAt' | 'updatedAt'>>): SavedRecipe {
  const list = read();
  const now = Date.now();
  const existing = list.find((r) => r.id === input.id);
  const next: SavedRecipe = {
    id: input.id,
    name: input.name,
    path: input.path,
    code: input.code,
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };
  const out = existing
    ? list.map((r) => (r.id === input.id ? next : r))
    : [...list, next];
  write(out);
  return next;
}

export function deleteRecipe(id: string): void {
  write(read().filter((r) => r.id !== id));
}
