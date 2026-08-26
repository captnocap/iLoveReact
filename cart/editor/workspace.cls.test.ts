// Run with:
//   tools/esbuild cart/editor/workspace.cls.test.ts --bundle --outfile=/tmp/editor-workspace-cls.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-workspace-cls.test.js
//
// THE OVERFLOW POLICY IS ENFORCED HERE (req_4772).
//
// req_4435 wrote the policy and stamped it onto 34 classes. Sixty-seven others
// kept their bare `{ type: 'Text', … }` literal and nobody noticed, because a
// missing policy is invisible until a string happens to be long enough — which
// is how `HW_FormValue`, the class every select control in every panel renders
// its value with, painted "speaker squawk" straight over its neighbouring
// control in MODEL · STATS.
//
// So the sheet is no longer reviewed by eye. Every Text classifier the editor
// registers must come from one of the three policy constructors, and this test
// reads the REGISTERED definitions, so a new class cannot pass by looking
// right in the source.
import { classifiers } from '../../runtime/classifier';
import { oneLine, oneLineColumn, wrapping } from './panelText';
// Every sheet this test can vouch for. `workspace.cls` and `journalThreads.cls`
// are fully policed; `editor.cls`, `play/surfaces.cls` and `worldBible.cls` are
// NOT imported yet — see the gap note at the bottom of this file.
import './workspace.cls';
import './shell/journalThreads.cls';
import './stage/blobExplorer.cls';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ── the three constructors stamp what the checker looks for ────────────────
const elided = oneLine(10, 'theme:text');
assert(elided.noWrap === true && elided.numberOfLines === 1, 'oneLine stopped stamping the elision props');
assert(elided.style.minWidth === 0 && elided.style.flexShrink === 1, 'oneLine stopped stamping the shrink half');

const column = oneLineColumn(10, 'theme:text', 82);
assert(column.noWrap === true && column.style.minWidth === 82 && column.style.flexShrink === 0,
  'oneLineColumn no longer holds its column at a declared width');

const prose = wrapping(10, 'theme:text');
assert((prose as any).noWrap === undefined && prose.style.minWidth === 0 && prose.style.flexShrink === 1,
  'wrapping either stopped wrapping or stopped being shrinkable');

// Caller style merges OVER the policy, which is what lets a column state its
// own width — and is also the only way a class can silently opt back out.
const overridden = oneLine(10, 'theme:text', { minWidth: 120 });
assert(overridden.style.minWidth === 120, 'caller style no longer merges over the policy style');

// ── every registered Text class declares a policy ──────────────────────────
type Policy = 'elided' | 'column' | 'wrapping' | 'none';

function policyOf(def: any): Policy {
  const style = (def?.style ?? {}) as Record<string, unknown>;
  const single = def?.noWrap === true && def?.numberOfLines === 1;
  const shrinkable = style.minWidth === 0 && style.flexShrink === 1;
  if (single && style.flexShrink === 0 && typeof style.minWidth === 'number') return 'column';
  if (single && typeof style.minWidth === 'number') return 'elided';
  if (!single && shrinkable) return 'wrapping';
  return 'none';
}

const unpoliced: string[] = [];
const counts: Record<Policy, number> = { elided: 0, column: 0, wrapping: 0, none: 0 };
for (const name of Object.keys(classifiers)) {
  const def = (classifiers as Record<string, any>)[name]?.__def;
  if (def?.type !== 'Text') continue;
  const policy = policyOf(def);
  counts[policy] += 1;
  if (policy === 'none') unpoliced.push(name);
}

assert(counts.elided + counts.column + counts.wrapping > 100,
  `the sheet registered only ${counts.elided + counts.column + counts.wrapping} policed Text classes — did the import stop registering them?`);
assert(unpoliced.length === 0,
  `Text classes with NO overflow policy (declare them through oneLine / oneLineColumn / wrapping in panelText.ts): ${unpoliced.join(', ')}`);

// The class that started this: a select-control value elides at its box
// instead of painting over the control beside it.
const formValue = (classifiers as Record<string, any>).HW_FormValue?.__def;
assert(policyOf(formValue) === 'elided', 'HW_FormValue lost its elision policy — long clip names will paint over their neighbours again');

// ── KNOWN GAP ──────────────────────────────────────────────────────────────
// Three editor sheets are deliberately NOT imported here yet:
//   cart/editor/editor.cls.ts          5 Text classes
//   cart/editor/play/surfaces.cls.ts  57 Text classes
//   cart/editor/worldBible/worldBible.cls.ts  26 Text classes
// They are not simply unpoliced — most already carry `noWrap`/`numberOfLines`
// inline, so they have the PROPS half of the policy and are missing the
// `min-width: 0` style half, which is the half that actually lets a string
// shrink. Converting them is a different transformation from the one that
// finished workspace.cls, and doing it blind would change the /play HUD and the
// world bible without anyone looking at them. Named here so it is a filed gap
// rather than a silent hole: import them, and this test will tell you exactly
// which classes need which half.

console.log(`PASS overflow policy — ${counts.elided} elided, ${counts.column} column, ${counts.wrapping} wrapping, 0 unpoliced`);
