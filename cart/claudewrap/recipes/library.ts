// recipes/library.ts — adapter over cart/app/recipes/ ALL_RECIPES.
//
// Each recipe is a useIFTTT composition. The scaffold.body is the
// authored TSX function body — typically one or more `useIFTTT(<trig>,
// <act>)` calls. We pull them back out so the LibraryPanel can toggle
// a whole recipe into the live rules list without re-authoring it.
//
// Recipes whose body uses function actions (callbacks instead of
// string actions) won't extract — they show as "non-toggleable" in
// the panel.

import { ALL_RECIPES, type RecipeDocument } from '../../app/recipes';
import type { RecipeRule } from '../types';

export interface LibraryBinding {
  trigger: string;
  action: string;
}

export interface LibraryEntry {
  slug: string;
  title: string;
  instructions: string;
  bindings: LibraryBinding[];
  /** True when the scaffold body contained no extractable bindings —
   *  usually because it uses a function action or the body is the
   *  sentinel `// TODO: author scaffold`. */
  unsupported: boolean;
  doc: RecipeDocument;
}

// useIFTTT('<trig>', '<act>')  — accepts single OR double quotes;
// permissive on whitespace between args.
const CALL_RE = /useIFTTT\s*\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]+)\3\s*\)/g;

export function parseScaffoldBindings(body: string): LibraryBinding[] {
  const out: LibraryBinding[] = [];
  let m: RegExpExecArray | null;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(body)) !== null) {
    out.push({ trigger: m[2], action: m[4] });
  }
  return out;
}

export function getLibrary(): LibraryEntry[] {
  return ALL_RECIPES.map((doc) => {
    const bindings = parseScaffoldBindings(doc.scaffold.body);
    return {
      slug: doc.slug,
      title: doc.title,
      instructions: doc.instructions,
      bindings,
      unsupported: bindings.length === 0,
      doc,
    };
  });
}

export function rulesForLibraryEntry(entry: LibraryEntry): RecipeRule[] {
  return entry.bindings.map((b, i) => ({
    id: `library:${entry.slug}:${i}`,
    label: entry.title + (entry.bindings.length > 1 ? ` (${i + 1})` : ''),
    trigger: b.trigger,
    action: b.action,
    enabled: true,
    source: 'library' as const,
  }));
}

export function isLibraryRule(rule: RecipeRule): boolean {
  return rule.id.startsWith('library:');
}

export function libraryRuleSlug(rule: RecipeRule): string | null {
  if (!isLibraryRule(rule)) return null;
  const m = rule.id.match(/^library:([^:]+):/);
  return m ? m[1] : null;
}
