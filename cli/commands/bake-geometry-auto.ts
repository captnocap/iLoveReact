// cli/commands/bake-geometry-auto.ts - scan a cart's source for Scene3D.Mesh
// elements whose params are statically-resolvable literals and emit a bake
// manifest. Composes with `rjit bake-geometry --manifest`:
//
//   rjit bake-geometry-auto cart/scape3d/index.tsx --out /tmp/m.json \
//     && rjit bake-geometry --manifest /tmp/m.json
//
// Or one shot to stdout:
//
//   rjit bake-geometry-auto cart/foo.tsx | tee /tmp/m.json
//
// This is the LITERAL-DETECTION foundation of the auto producer. It catches
// every `<Scene3D.Mesh geometry={NS.Name} params={{ ... literal ... }} />` whose
// params are a literal object tree (numbers, strings, booleans, arrays/objects
// of same, unary-minus). It does NOT yet handle:
//   - identifier refs to module-level consts        (extend with TypeChecker.getConstantValue)
//   - `params={{ ...DEFAULTS, override: v }}` spreads
//   - .map() / .forEach() loops over const arrays   (the citymap case)
//   - any expression involving a tainted value      (the full taint pass)
// Those are layered on top of this same emitter — the taint extension (see
// runtime/geometries/BAKE.md) replaces extractLiteral with a coloring pass that
// proves un-taintedness for non-literal expressions.

import { fsExists, fsRead, fsWrite } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { parseArgs } from '../host/argv.ts';

// ── TypeScript compiler loader ────────────────────────────────────────────
// Same pattern classify.ts uses: eval the vendored TypeScript bundle into a
// captured module scope and pull the `ts` namespace out. Inlined here rather
// than imported from classify (which doesn't export it) to keep the dependency
// graph narrow; this 50-line helper belongs in cli/host/typescript.ts when
// either command grows a third consumer.

declare const __cwd: () => string;
declare const __fs_read: (p: string) => string;
declare const __fs_exists: (p: string) => boolean;
declare const __writeStdout: (s: string) => void;
declare const __writeStderr: (s: string) => void;
declare const __exit: (code: number) => void;

function loadTypeScript(): any {
  const root = __cwd();
  const candidates = [`${root}/vendor/typescript/typescript.js`, `${root}/deps/typescript/typescript.js`];
  const tsPath = candidates.find((c) => __fs_exists(c));
  if (!tsPath) throw new Error(`bake-geometry-auto: deps/typescript/typescript.js not found`);
  const code = __fs_read(tsPath);

  const moduleObj: any = { exports: {} };
  const exportsObj = moduleObj.exports;
  const localProcess = {
    nextTick: undefined,
    argv: [],
    env: {},
    cwd: () => root,
    pid: 1,
    platform: 'linux',
    execArgv: [],
    platformVersion: '',
    version: '',
    memoryUsage: () => ({ heapUsed: 0 }),
    stdout: { write: (s: any) => __writeStdout(String(s)), columns: 80, isTTY: false },
    stderr: { write: (s: any) => __writeStderr(String(s)) },
    exit: (code: number) => __exit(code | 0),
  };
  function noopRequire(name: string): never {
    throw new Error(`require("${name}") is unavailable under v8cli`);
  }
  // Minimal Buffer stub — TypeScript's loader probes for it but bake-auto never
  // hits a code path that actually uses Buffer methods.
  const minimalBuffer = { isBuffer: () => false, from: (x: any) => x };

  (function (module: any, exports: any, require: any, process: any, global: any,
             setTimeout: any, clearTimeout: any, setInterval: any, clearInterval: any,
             Buffer: any, performance: any) {
    (0, eval)(code + '\n;');
  })(moduleObj, exportsObj, noopRequire, localProcess, globalThis,
     () => {}, () => {}, () => {}, () => {}, minimalBuffer, undefined);

  const ts = (globalThis as any).ts || moduleObj.exports || exportsObj;
  if (!ts || typeof ts.createSourceFile !== 'function') {
    throw new Error('bake-geometry-auto: failed to load TypeScript API');
  }
  return ts;
}

// ── Literal extraction ────────────────────────────────────────────────────
// Returns { value, ok }. `ok=false` means the expression isn't a literal tree —
// the caller skips baking it (it'll fall to runtime intern, which is correct).

function extractLiteral(node: any, ts: any): { value: unknown; ok: boolean } {
  if (!node) return { value: null, ok: false };
  if (ts.isNumericLiteral(node)) return { value: parseFloat(node.text), ok: true };
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { value: node.text, ok: true };
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { value: true, ok: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false, ok: true };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { value: null, ok: true };
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = extractLiteral(node.operand, ts);
    if (inner.ok && typeof inner.value === 'number') return { value: -(inner.value as number), ok: true };
    return { value: null, ok: false };
  }
  if (ts.isParenthesizedExpression(node)) return extractLiteral(node.expression, ts);
  if (ts.isArrayLiteralExpression(node)) {
    const arr: unknown[] = [];
    for (const el of node.elements) {
      const v = extractLiteral(el, ts);
      if (!v.ok) return { value: null, ok: false };
      arr.push(v.value);
    }
    return { value: arr, ok: true };
  }
  if (ts.isObjectLiteralExpression(node)) {
    const obj: Record<string, unknown> = {};
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) return { value: null, ok: false }; // spreads/shorthand: not yet
      let name: string;
      if (ts.isIdentifier(p.name)) name = p.name.text;
      else if (ts.isStringLiteral(p.name)) name = p.name.text;
      else return { value: null, ok: false };
      const v = extractLiteral(p.initializer, ts);
      if (!v.ok) return { value: null, ok: false };
      obj[name] = v.value;
    }
    return { value: obj, ok: true };
  }
  return { value: null, ok: false };
}

// ── JSX walker ────────────────────────────────────────────────────────────

function tagName(element: any, ts: any): string | null {
  const tag = element.tagName;
  if (ts.isIdentifier(tag)) return tag.text;
  if (ts.isPropertyAccessExpression(tag)) {
    const lhs = ts.isIdentifier(tag.expression) ? tag.expression.text : null;
    return lhs ? `${lhs}.${tag.name.text}` : tag.name.text;
  }
  return null;
}

/** Resolve the geometry def reference to its id. Accepts `Geometry.Box` or
 *  `geometries.Box` (namespace member access) and bare `Box` (the def imported
 *  directly). The id is the property name in either case. */
function geometryDefId(node: any, ts: any): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}

interface ManifestItem { geometry: string; params: Record<string, unknown>; }
interface ScanResult { items: ManifestItem[]; meshTotal: number; }

function scan(source: string, filename: string, ts: any): ScanResult {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const items: ManifestItem[] = [];
  let meshTotal = 0;
  const seen = new Set<string>(); // dedup by stable JSON of (id,params)

  function visit(node: any): void {
    const opening = ts.isJsxSelfClosingElement(node) ? node
      : ts.isJsxElement(node) ? node.openingElement
      : null;
    if (opening && tagName(opening, ts) === 'Scene3D.Mesh') {
      meshTotal++;
      let geomNode: any = null;
      let paramsNode: any = null;
      for (const attr of opening.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.name) continue;
        const init = attr.initializer;
        if (!init || !ts.isJsxExpression(init) || !init.expression) continue;
        if (attr.name.text === 'geometry') geomNode = init.expression;
        else if (attr.name.text === 'params') paramsNode = init.expression;
      }
      if (geomNode && paramsNode) {
        const defId = geometryDefId(geomNode, ts);
        const params = extractLiteral(paramsNode, ts);
        if (defId && params.ok && params.value !== null && typeof params.value === 'object') {
          const key = defId + '|' + JSON.stringify(params.value, Object.keys(params.value as object).sort());
          if (!seen.has(key)) {
            seen.add(key);
            items.push({ geometry: defId, params: params.value as Record<string, unknown> });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { items, meshTotal };
}

// ── Command ───────────────────────────────────────────────────────────────

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv, { positional: ['cart'], flags: { out: 'string' } });
  const cartArg = args.positional.cart;
  if (!cartArg) {
    err('bake-geometry-auto: usage: rjit bake-geometry-auto <cart-source.tsx> [--out <manifest.json>]');
    return 2;
  }
  if (!fsExists(cartArg)) {
    err(`bake-geometry-auto: source not found: ${cartArg}`);
    return 2;
  }

  let ts: any;
  try {
    ts = loadTypeScript();
  } catch (e) {
    err(`bake-geometry-auto: ${(e as Error).message}`);
    return 1;
  }

  const { items, meshTotal } = scan(fsRead(cartArg), cartArg, ts);
  const json = JSON.stringify(items, null, 2);
  const outPath = args.flags.out as string | undefined;

  if (outPath) {
    fsWrite(outPath, json + '\n');
    out(`bake-geometry-auto: ${cartArg} → ${items.length}/${meshTotal} Scene3D.Mesh elements bakeable → ${outPath}`);
    out(`  next: rjit bake-geometry --manifest ${outPath}`);
  } else {
    __writeStdout(json + '\n');
    err(`bake-geometry-auto: ${cartArg} → ${items.length}/${meshTotal} Scene3D.Mesh elements bakeable`);
  }
  return 0;
}
