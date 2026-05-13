// Shared schema for `cart/app/recipes/<slug>.ts` files. Every recipe in
// the corpus satisfies this contract — there are no doc-only and no
// scaffold-only recipes. A recipe is one complete artifact:
//
//   - prose (instructions + sections) explains the what / why / when
//   - scaffold (body) is the executable two-node IFTTT chain that
//     demonstrates the pattern; the canvas/page picker drops it on the
//     editor as a starter graph, and the same body fires as live
//     useIFTTT rules when the recipe is bound to a sequencer row.
//
// Recipes the substrate doesn't yet have an answer for ship a TODO-
// marked sentinel scaffold so the gap is grep-able (`grep -rn
// "TODO: author scaffold" cart/app/recipes/`). The schema stays strict
// — every recipe has both halves, even if one is explicitly a sentinel
// pending future authoring.

export type RecipeSectionKind = "paragraph" | "bullet-list" | "code-block";

export type RecipeCodeLanguage =
  | "python"
  | "typescript"
  | "tsx"
  | "javascript"
  | "bash"
  | "markdown"
  | "text";

export interface RecipeParagraph {
  kind: "paragraph";
  title?: string;
  text: string;
}

export interface RecipeBulletList {
  kind: "bullet-list";
  title?: string;
  items: string[];
}

export interface RecipeCodeBlock {
  kind: "code-block";
  title?: string;
  language: RecipeCodeLanguage;
  code: string;
}

export type RecipeSection = RecipeParagraph | RecipeBulletList | RecipeCodeBlock;

export interface RecipeScaffold {
  /** TSX function body — one or more `useIFTTT(trigger, action)` calls.
   *  Wrapped with the standard import + `Recipe()` function shell by
   *  `wrapScaffold()` before parseCodeToGraph consumes it. Each call
   *  becomes one trigger→action node pair on the canvas AND one live
   *  rule when the recipe is bound to a sequencer row. */
  body: string;
}

export interface RecipeDocument {
  /** URL-safe identifier; matches the filename stem. Used as the
   *  primary key in the `recipe` table. */
  slug: string;
  /** Human-readable title, mirrors the recipe heading. */
  title: string;
  /** One-paragraph statement of what the recipe is for. Surfaced as
   *  the picker summary under the title. */
  instructions: string;
  /** Path to the verbatim markdown source for recipes ported from
   *  external pages (relative to repo root). Empty string for native
   *  scaffolds authored in-tree — they have no external source. */
  sourcePath: string;
  /** Ordered structured prose explaining the recipe. At minimum one
   *  paragraph framing what it does and why; longer-form ports carry
   *  the full source structure. */
  sections: RecipeSection[];
  /** Executable spine. ALWAYS present. Recipes the IFTTT substrate
   *  doesn't yet have an answer for ship a sentinel body starting
   *  with `// TODO: author scaffold` so the gap is grep-able. */
  scaffold: RecipeScaffold;
}

const SCAFFOLD_HEADER = `// Auto-generated recipe scaffold. Edit the useIFTTT(...) calls or
// drag new nodes onto the canvas; both surfaces stay in sync.

import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';

export function Recipe() {
`;

const SCAFFOLD_FOOTER = `  return null;
}
`;

/** Wrap a scaffold body into a full TSX module string the canvas's
 *  code editor + parseCodeToGraph can consume. The body itself is
 *  what the user reads on the canvas; the header/footer are scaffold-
 *  level boilerplate that stays out of their face. */
export function wrapScaffold(body: string): string {
  return SCAFFOLD_HEADER + body + SCAFFOLD_FOOTER;
}
