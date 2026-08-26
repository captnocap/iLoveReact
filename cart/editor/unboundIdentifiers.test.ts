// cart/editor/unboundIdentifiers.test.ts — CATCH THE IDENTIFIER NOTHING BINDS.
//
// req_4772 shipped `useFocusPanelResize(...)` with no import for it. The editor
// threw `ReferenceError: useFocusPanelResize is not defined` on first render and
// GlobalErrorBoundary tore down the whole Inspector tree. It passed review
// because the check was an esbuild bundle, and **esbuild does not resolve
// identifiers** — it emitted a 6.4MB bundle containing exactly one textual
// occurrence of the symbol (the call) and no definition, and reported success.
//
// The repo has no typechecker in the loop (esbuild strips types; there is no
// tsc entry point), so this is the missing guard, scoped to the one failure
// that actually happened: an identifier a module USES that the module never
// imports, declares, or receives.
//
// It is a scope check, not a type check. It reads source text, so it is blind
// to anything clever, and it deliberately only inspects PascalCase components
// and `useXxx` hooks — the two shapes that appear in JSX and hook position,
// which is where an unbound name reaches the user as a white screen instead of
// a build error.
//
// Run with:
//   tools/esbuild cart/editor/unboundIdentifiers.test.ts --bundle \
//     --outfile=/tmp/editor-unbound.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-unbound.test.js
import { listDir, readFile } from '../../runtime/hooks/fs';

const ROOTS = ['cart/editor'];
/** Names the runtime injects (runtime/ambient*.ts) or the language provides. */
const AMBIENT = new Set([
  'Object', 'Array', 'Math', 'JSON', 'Number', 'String', 'Boolean', 'Set', 'Map',
  'Promise', 'Error', 'Date', 'RegExp', 'Symbol', 'Proxy', 'Reflect', 'BigInt',
  'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'Int8Array',
  'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer',
  'DataView', 'WeakMap', 'WeakSet', 'Intl', 'Fragment', 'React',
]);

function walk(dir: string, out: string[]): string[] {
  for (const entry of listDir(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const path = `${dir}/${entry}`;
    if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      if (!entry.endsWith('.d.ts')) out.push(path);
    } else if (!entry.includes('.')) {
      walk(path, out);
    }
  }
  return out;
}

/** Every name this module binds: imports, declarations, and destructures. */
function boundNames(source: string): Set<string> {
  const bound = new Set<string>();
  const add = (name: string) => { if (name) bound.add(name); };

  // import X, { a as b, c } from '...'  /  import * as N from '...'
  for (const match of source.matchAll(/\bimport\s+([\s\S]*?)\s+from\s+['"][^'"]*['"]/g)) {
    const clause = match[1] ?? '';
    for (const part of clause.replace(/[{}]/g, ',').split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim() ?? '';
      if (/^\*$/.test(name)) continue;
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name);
    }
  }
  // declarations and local bindings
  for (const match of source.matchAll(/\b(?:function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) add(match[1]!);
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(match[1]!);
  for (const match of source.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part.split(':').pop()?.trim().split('=')[0]?.trim() ?? '';
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name);
    }
  }
  return bound;
}

/**
 * Blank out comments, preserving length so the leading-character guard in
 * `usedNames` still sees the real neighbour.
 *
 * Comments only. An earlier cut also blanked string literals and promptly
 * mis-lexed the apostrophe in a JSX text node as an opening quote, blanking the
 * rest of the file and reporting a function declared 80 lines below as unbound.
 * Hand-rolling a lexer to avoid using a parser is the same mistake twice, so
 * this does the part that is unambiguous and stops. A name that appears only
 * inside a string can now hide a real miss — that is a false NEGATIVE, which
 * costs nothing that was not already uncaught.
 */
function stripComments(source: string): string {
  const out = source.split('');
  let index = 0;
  const blank = (from: number, to: number) => {
    for (let at = from; at < to && at < out.length; at += 1) {
      if (out[at] !== '\n') out[at] = ' ';
    }
  };
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (two === '//') {
      const end = source.indexOf('\n', index);
      blank(index, end === -1 ? source.length : end);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', index + 2);
      blank(index, end === -1 ? source.length : end + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    index += 1;
  }
  return out.join('');
}

/** Component and hook names this module USES in a position that runs. */
function usedNames(source: string): Set<string> {
  const used = new Set<string>();
  // <Component ...> and <Component/>. The leading guard is what separates JSX
  // from a TYPE ARGUMENT: `Promise<T>`, `useState<Bar>(`, `Record<K, number>`
  // all put an identifier character (or `>` or `.`) immediately before the `<`,
  // and none of them is a component reference.
  for (const match of source.matchAll(/(?:^|[^\w$>.])<([A-Z][\w$]*)([\s/>][^\n]{0,40})/gm)) {
    // `<T>(fn)` and `<A extends unknown[]>(fn)` are generic ARROW type
    // parameters, not components — both close straight into a call or an
    // `extends` clause, which no JSX tag does.
    const tail = match[2] ?? '';
    if (/^>\s*\(/.test(tail) || /^\s+extends\b/.test(tail) || /^,/.test(tail)) continue;
    used.add(match[1]!);
  }
  // useSomething(...) in call position
  for (const match of source.matchAll(/\b(use[A-Z][\w$]*)\s*\(/g)) used.add(match[1]!);
  return used;
}

const files = ROOTS.flatMap((root) => walk(root, []));
const failures: string[] = [];
for (const file of files) {
  const raw = readFile(file);
  if (!raw) continue;
  // This file's own doc comment names the very symbols it hunts for.
  if (file.endsWith('unboundIdentifiers.test.ts')) continue;
  const source = stripComments(raw);
  const bound = boundNames(source);
  for (const name of usedNames(source)) {
    if (bound.has(name) || AMBIENT.has(name)) continue;
    failures.push(`${file}: '${name}' is used but nothing in the module binds it`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  throw new Error(`${failures.length} unbound identifier(s) — each one is a ReferenceError at render`);
}
console.log(`PASS unbound identifiers — ${files.length} editor modules, every component and hook binds`);
