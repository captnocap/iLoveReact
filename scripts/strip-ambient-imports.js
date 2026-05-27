// scripts/strip-ambient-imports.js — v8cli version of scripts/strip-ambient-imports.js.
//
// Strip redundant imports of ambient-injected names from cart .tsx/.ts.
//
// esbuild is configured (in scripts/cart-bundle.js) with:
//   --inject:runtime/jsx_shim.ts
//   --inject:runtime/ambient.ts
//   --inject:runtime/ambient_primitives.ts
//
// Every name exported from those three files is globally available in every
// bundled .tsx/.ts file. So:
//   import { Box, Col } from '../../../runtime/primitives';
//   import { useState, useEffect } from 'react';
//   import React from 'react';
// are all dead weight.
//
// Usage:
//   ./scripts/strip-ambient-imports --dry-run            # preview, default cart/
//   ./scripts/strip-ambient-imports --dry-run cart/      # explicit target
//   ./scripts/strip-ambient-imports cart/sweatshop/index.tsx
//
// Leaves `import type { ... }` statements alone (types aren't in ambient).
// Leaves namespace imports (`import * as React from 'react'`) alone — those
// are intentional and the script can't safely rewrite usages.

function die(msg) {
  __writeStderr('[strip-ambient-imports] ' + msg + '\n');
  __exit(1);
}

function normalizeArgv(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    if (raw.length === 0) return [];
    return [raw];
  }
  if (!raw) return [];
  return [String(raw)];
}

const AMBIENT = new Set([
  // runtime/ambient_primitives.ts
  'Box','Row','Col','Text','Image','Pressable','ScrollView','TextInput','TextArea',
  'TextEditor','Terminal','terminal','Canvas','Graph','Render','Effect','Native',
  // runtime/ambient.ts (React hooks + helpers)
  'useState','useEffect','useLayoutEffect','useCallback','useMemo','useRef',
  'useContext','useReducer','useId','useImperativeHandle','useSyncExternalStore',
  'useTransition','useDeferredValue','createElement','cloneElement','isValidElement',
  'memo','forwardRef','lazy','createContext','startTransition','Fragment',
  'Suspense','Children',
  // NOTE: `React` as a namespace is NOT ambient — only the named hooks/helpers
  // above are. Files that call `React.cloneElement(...)` still need
  // `import React from 'react'`. Do not add 'React' to this set.
]);

const __hostArgv = normalizeArgv(typeof __argv === 'function' ? __argv() : __argv);
const args = __hostArgv.slice(1);
const dryRun = args.includes('--dry-run');
const targets = args.filter((a) => !a.startsWith('--'));

function isAmbientModule(spec) {
  if (spec === 'react' || spec.startsWith('react/')) return true;
  if (/\/runtime\/primitives(\.tsx?|\.js)?$/.test(spec)) return true;
  return false;
}

function walk(dir, out = []) {
  const entriesRaw = __fs_list_json(dir);
  if (entriesRaw === null) return out;

  let entries;
  try {
    entries = JSON.parse(entriesRaw);
  } catch {
    return out;
  }

  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = joinPath(dir, name);
    const st = statParse(__fs_stat_json(full));
    if (!st) continue;
    if (st.isDir) walk(full, out);
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) out.push(full);
  }
  return out;
}

function joinPath(parent, child) {
  if (!parent) return child;
  if (parent.endsWith('/')) return parent + child;
  return parent + '/' + child;
}

function statParse(raw) {
  if (raw === null) return null;
  try {
    const st = JSON.parse(raw);
    if (!st || typeof st !== 'object') return null;

    const isDir =
      (typeof st.isDir === 'boolean') ? st.isDir :
      (typeof st.is_dir === 'boolean') ? st.is_dir :
      (typeof st.is_file === 'boolean') ? !st.is_file :
      false;

    return {
      isDir,
      is_file: typeof st.is_file === 'boolean' ? st.is_file : !isDir,
    };
  } catch {
    return null;
  }
}

// Matches a full import statement (multi-line capable), captures the clause
// between `import` and `from`, and the module specifier.
const IMPORT_RE = /import(\s+type)?\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?[ \t]*\r?\n?/g;

function rewriteImport(match, typeKw, clause, spec) {
  if (typeKw) return match;                    // `import type { ... }` — leave
  if (!isAmbientModule(spec)) return match;
  if (/\*\s+as\s+/.test(clause)) return match; // namespace import — leave

  // Split `React, { a, b }` into default + named.
  let defaultName = null;
  let named = null;
  const braceStart = clause.indexOf('{');
  if (braceStart === -1) {
    defaultName = clause.trim();
  } else {
    const head = clause.slice(0, braceStart).replace(/,\s*$/, '').trim();
    if (head.length) defaultName = head;
    const braceEnd = clause.indexOf('}', braceStart);
    if (braceEnd === -1) return match;          // malformed, bail
    named = clause.slice(braceStart + 1, braceEnd).split(',').map((s) => s.trim()).filter(Boolean);
  }

  if (defaultName && AMBIENT.has(defaultName)) defaultName = null;

  let kept = [];
  if (named) {
    for (const entry of named) {
      // `type Foo` or `Foo as Bar` — only strip if the *local* name is ambient
      // AND it's not a type-only entry.
      if (/^type\s+/.test(entry)) { kept.push(entry); continue; }
      const asMatch = entry.match(/^(\w+)\s+as\s+(\w+)$/);
      const local = asMatch ? asMatch[2] : entry;
      if (AMBIENT.has(local)) continue;
      kept.push(entry);
    }
  }

  const parts = [];
  if (defaultName) parts.push(defaultName);
  if (kept.length) parts.push(`{ ${kept.join(', ')} }`);
  if (parts.length === 0) return '';            // whole import is redundant
  return `import ${parts.join(', ')} from '${spec}';\n`;
}

function processFile(path) {
  const src = __fs_read(path);
  if (src === null) die('failed to read ' + path);
  const out = src.replace(IMPORT_RE, rewriteImport);
  if (out === src) return false;
  if (dryRun) {
    __writeStdout(`[would change] ${path}\n`);
  } else {
    if (!__fs_write(path, out)) die('failed to write ' + path);
    __writeStdout(`[rewrote]     ${path}\n`);
  }
  return true;
}

const files = targets.length
  ? targets.flatMap((target) => {
      const st = statParse(__fs_stat_json(target));
      if (!st) return [target];
      return st.isDir ? walk(target) : [target];
    })
  : walk('cart');

let changed = 0;
for (const path of files) if (processFile(path)) changed++;
__writeStdout(`\n${dryRun ? 'would change' : 'rewrote'} ${changed} / ${files.length} files\n`);
