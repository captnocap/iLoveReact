---
name: chad-audit
description: Audit chad-tier conformance tests against the Intent Dictionary. Enforce exact syntax compliance — fix or rewrite any test that drifts.
---

# Chad Audit

You are now in **audit mode**. Your sole job is to verify that every `.tsz` file in `tsz/carts/conformance/chad/` exactly follows the Intent Dictionary at `tsz/docs/INTENT_DICTIONARY.md`.

## Rules of Engagement

1. **Read the Intent Dictionary first.** Every time. Do not rely on memory or training data. The dictionary is the single source of truth. If a construct isn't in the dictionary, it doesn't exist.

2. **Read every chad test file.** Compare each construct against the dictionary line by line.

3. **Zero tolerance for mixed syntax leaking into chad.** The following are ILLEGAL in chad tests:
   - `const`, `let`, `var` (JS-style declarations) — use `<var>` blocks with `is`/`exact`
   - `useState`, `setState` — use `<state>` blocks with `set_` prefix
   - `function X()` (JS function syntax) — use `<functions>` blocks with `name:` syntax
   - `=>` (arrow functions) — no arrows exist
   - `{}` (braces for logic) — everything is blocks
   - `===`, `!==`, `>`, `<`, `>=`, `<=` — use `exact`, `not exact`, `above`, `below`, `exact or above`, `exact or below`
   - `!variable` — use `not variable`
   - `? :` (ternary) — use `<if>`/`<else>`
   - `onClick`, `onChange` — use `onPress`, `onChange=set_name`
   - `<div>`, `<span>`, `<button>`, `<p>`, `<h1>` — use `<Box>`, `<Text>`, `<Pressable>`, `C.` classifiers
   - `import X from` — no JS imports exist
   - `export default` — no exports, the file block IS the export
   - `from '../../anything'` — cross-directory imports are ILLEGAL. Everything is ambient within its own app/lib directory. The only valid `from` is siblings in the same directory when needed.
   - `.map()` — use `<For each=X>`
   - `useEffect` — use `<during>`
   - `&&` for conditional rendering — use `<if>`
   - `style={{ }}` (inline style objects) — use `C.` classifiers

4. **Required chad structures:**
   - File must open with a named block: `<name widget>`, `<name page>`, `<name app>`, or `<name lib>`
   - Variables go in `<var>` — one per line, `name`, `name is value`, or `name exact value`
   - Setters go in `<state>` — `set_name`, optionally constrained with `exact`
   - Types go in `<types>` — nested blocks, one variant per line
   - Logic goes in `<functions>` — named, nullary or with `(args)`, `requires` for scope deps
   - Data goes in named blocks matching the var: `<items>` for `items is objects`
   - Arrays: `name is array`, objects: `name is object`, array of objects: `name is objects`
   - Composition uses `+`: `doA + doB + doC`
   - Guards use `stop` and `skip`
   - Control flow: `<if>`/`<else if>`/`<else>`, `<for X as item>`, `<during condition>`, `<while>`, `<switch>`/`<case>`
   - Loops: `<For each=items>` in return(), `<for items as item>` in functions
   - Lifecycle: `boot:` and `shutdown:` in functions, `tick every N:` for timers

5. **Every app/widget is a self-contained universe.** This is the most important rule.
   - **NO shared files.** No `from '../../theme.cls'`. No reaching outside your own directory. Every app directory contains everything it needs.
   - **Widgets** (single-file entries like `counter.tsz`, `weather.tsz`) inline everything. No imports, no support files. One file in, one binary out.
   - **Apps** (multi-file entries like `filebrowser/`) contain their own pages, components, classifiers, themes, glyphs, effects — all inside the same directory. Pages and components are **ambient** to the app — the compiler finds them by block tag name, not by `from` imports.
   - **Libs** (module packages) contain their own modules. Modules are ambient to their lib.
   - If two apps need the same theme, each app has its own copy of the `.tcls.tsz`. Duplication is correct. Sharing is a mixed-lane concept.
   - `from` is ONLY used within an app directory to reference sibling files (pages, components) when the compiler requires it. Cross-directory `from` with `../` paths is ALWAYS wrong in chad.

6. **Support file extensions — the author decides granularity:**
   - `.tcls.tsz` — theme definitions. One file with N themes, or N files with one theme each.
   - `.vcls.tsz` — variant compositions. One file with all variants, or split per variant.
   - `.cls.tsz` — base classifiers (layout/structure). One big file or split by concern.
   - `.effects.tsz` — visual effects. Bundle or split.
   - `.glyphs.tsz` — inline SVG/polygon icons. Bundle or split.
   - The extension says WHAT'S INSIDE, not HOW MANY. The compiler doesn't care about the split.

7. **Classifier references (`C.`) must resolve.** If a test uses `C.Header`, `C.Badge`, etc., the classifiers must be defined in a `.cls.tsz` (or `.tcls.tsz`/`.vcls.tsz`) file that is ambient to the entry point (same directory for apps, inline for widgets). If classifiers can't be provided, rewrite to use inline `<Box>`/`<Text>` with styles described in the block structure.

## Audit Process

For each file in `tsz/carts/conformance/chad/`:

1. Read the file
2. Check every line against the dictionary rules above
3. Report violations with line numbers
4. Categorize: **FIXABLE** (minor syntax error, can edit in place) vs **REWRITE** (fundamentally wrong structure)
5. Fix FIXABLE issues immediately
6. For REWRITE issues, rewrite the file from scratch preserving the original test intent

## Output Format

For each file audited, report:

```
=== filename.tsz ===
STATUS: CLEAN | FIXED | REWRITTEN
Violations found: N
- Line X: [violation description] → [fix applied]
```

After all files are audited:

```
=== AUDIT SUMMARY ===
Total files: N
Clean: N
Fixed: N  
Rewritten: N
Remaining violations: N (should be 0)
```

## Important

- Do NOT skip files. Audit every single `.tsz` in the chad directory.
- Do NOT add features or patterns not in the Intent Dictionary. If you think something should exist but isn't in the dictionary, flag it as "DICTIONARY GAP" but do NOT invent syntax.
- Do NOT touch files outside `tsz/carts/conformance/chad/`.
- `.cls.tsz`, `.effects.tsz`, `.glyphs.tsz`, `.tcls.tsz` files in the chad directory are support files — audit them for valid classifier/effect/glyph syntax but don't apply the same block-structure rules.
- After fixing/rewriting, attempt to build each changed file with `./scripts/build` to verify it compiles.
