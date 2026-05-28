// @ts-nocheck
/**
 * scripts/classify.js — pattern extractor for the ReactJIT classifier system.
 *
 * Scans TSX files, finds repeated inline style + prop patterns on JSX
 * primitives, groups them by structural hash, applies semantic naming
 * heuristics, and outputs a ready-to-use .cls.ts file.
 *
 * Usage:
 *   rjit classify                   Scan src/ and print analysis
 *   rjit classify --output app.cls.ts   Write classifier sheet to file
 *   rjit classify --min 3           Only patterns with 3+ occurrences (default: 2)
 *   rjit classify --prefix App      Prefix all names with "App" (default: auto)
 *   rjit classify --dir ./stories   Scan a specific directory instead of src/
 */

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

// Lightweight v8cli host bridge.
const __hostArgv = normalizeArgv(typeof __argv === 'function' ? __argv() : __argv);
const __hostProcess = (typeof globalThis.process === 'object' && globalThis.process !== null) ? globalThis.process : null;
const process = Object.assign({}, __hostProcess || {});
process.argv = __hostArgv;
process.cwd = typeof __cwd === 'function' ? () => __cwd() : process.cwd;
process.exit = typeof __exit === 'function' ? (code) => __exit(code | 0) : process.exit;
process.env = typeof __env === 'function' ? __env() : (process.env || {});
process.platform = 'linux';
process.nextTick = undefined;
process.argv0 = __hostArgv[0] || process.argv0;

if (!Array.isArray(process.argv)) process.argv = __hostArgv;

function utf8ByteLength(value) {
  let n = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) n += 1;
    else if (code < 0x800) n += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        n += 4;
        i++;
      } else {
        n += 3;
      }
    } else {
      n += 3;
    }
  }
  return n;
}

function stringToUtf8Bytes(value) {
  const bytes = [];
  for (let i = 0; i < value.length; i++) {
    let c = value.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
      continue;
    }
    if (c < 0x800) {
      bytes.push((c >> 6) | 0xc0);
      bytes.push((c & 0x3f) | 0x80);
      continue;
    }
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const cp = ((c - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        i++;
        bytes.push((cp >> 18) | 0xf0);
        bytes.push(((cp >> 12) & 0x3f) | 0x80);
        bytes.push(((cp >> 6) & 0x3f) | 0x80);
        bytes.push((cp & 0x3f) | 0x80);
        continue;
      }
    }
    bytes.push((c >> 12) | 0xe0);
    bytes.push(((c >> 6) & 0x3f) | 0x80);
    bytes.push((c & 0x3f) | 0x80);
  }
  return new Uint8Array(bytes);
}

function utf8BytesToString(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const c1 = bytes[i];
    if (c1 < 0x80) {
      out += String.fromCharCode(c1);
    } else if ((c1 & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      const c2 = bytes[++i];
      out += String.fromCharCode(((c1 & 0x1f) << 6) | (c2 & 0x3f));
    } else if ((c1 & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      const c2 = bytes[++i];
      const c3 = bytes[++i];
      out += String.fromCharCode(((c1 & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
    } else if ((c1 & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      const c2 = bytes[++i];
      const c3 = bytes[++i];
      const c4 = bytes[++i];
      const cp = (((c1 & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f)) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      out += String.fromCharCode(c1);
    }
  }
  return out;
}

const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const n = (b0 << 16) | ((b1 || 0) << 8) | (b2 || 0);

    out += base64Chars[(n >>> 18) & 63];
    out += base64Chars[(n >>> 12) & 63];
    out += (i + 1 < bytes.length) ? base64Chars[(n >>> 6) & 63] : '=';
    out += (i + 2 < bytes.length) ? base64Chars[n & 63] : '=';
  }
  return out;
}

function base64ToBytes(value) {
  let i = 0;
  const clean = String(value).replace(/[^A-Za-z0-9+/=]/g, '');
  const out = [];

  function idx(ch) {
    if (ch === '=') return 0;
    const c = base64Chars.indexOf(ch);
    return c < 0 ? 0 : c;
  }

  while (i < clean.length) {
    const e0 = idx(clean[i++]);
    const e1 = idx(clean[i++]);
    const e2 = idx(clean[i++]);
    const e3 = idx(clean[i++]);
    const n = (e0 << 18) | (e1 << 12) | (e2 << 6) | e3;
    out.push((n >> 16) & 0xff);
    if (clean[i - 2] !== '=') out.push((n >> 8) & 0xff);
    if (clean[i - 1] !== '=') out.push(n & 0xff);
  }

  return new Uint8Array(out);
}

function makeBufferFrom(bytes) {
  return {
    _bytes: bytes,
    toString(encoding) {
      if (encoding === 'base64') return bytesToBase64(this._bytes);
      if (encoding === 'hex') return [...this._bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      return utf8BytesToString(this._bytes);
    },
  };
}

const minimalBuffer = {
  from(value, encoding) {
    if (typeof encoding === 'string') {
      const enc = encoding.toLowerCase();
      if (enc === 'base64') {
        return makeBufferFrom(base64ToBytes(value));
      }
    }
    if (typeof value === 'string') return makeBufferFrom(stringToUtf8Bytes(value));
    if (value instanceof Uint8Array) return makeBufferFrom(new Uint8Array(value));
    if (value instanceof ArrayBuffer) return makeBufferFrom(new Uint8Array(value));
    if (Array.isArray(value)) return makeBufferFrom(new Uint8Array(value));
    if (typeof value === 'number') return makeBufferFrom(new Uint8Array(value));
    return makeBufferFrom(stringToUtf8Bytes(String(value)));
  },
};

const console = {
  log: (...args) => __writeStdout(args.map((x) => String(x)).join(' ') + '\n'),
  error: (...args) => __writeStderr(args.map((x) => String(x)).join(' ') + '\n'),
};

function normalizePath(value) {
  const raw = String(value || '');
  const absolute = raw.startsWith('/');
  const parts = [];
  for (const p of raw.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') {
      if (parts.length) parts.pop();
    } else {
      parts.push(p);
    }
  }
  if (absolute) return '/' + parts.join('/');
  return parts.join('/');
}

function join(...parts) {
  const filtered = [];
  for (const p of parts) {
    if (!p) continue;
    filtered.push(String(p));
  }
  return normalizePath(filtered.join('/'));
}

function dirname(pathValue) {
  const normalized = normalizePath(pathValue);
  if (normalized === '/' || !normalized) return normalized ? '/' : '.';
  const segs = normalized.split('/');
  if (segs.length <= 1) return '.';
  segs.pop();
  return segs.join('/') || '/';
}

function basename(pathValue) {
  const normalized = normalizePath(pathValue);
  if (!normalized || normalized === '/') return '';
  const segs = normalized.split('/');
  return segs[segs.length - 1];
}

function splitPath(pathValue) {
  const normalized = normalizePath(pathValue);
  if (normalized === '/' || normalized === '.') return { absolute: normalized === '/', parts: [] };
  const absolute = normalized.startsWith('/');
  const noRoot = absolute ? normalized.slice(1) : normalized;
  return { absolute, parts: noRoot ? noRoot.split('/') : [] };
}

function relative(from, to) {
  const fromParts = splitPath(from);
  const toParts = splitPath(to);
  if (fromParts.absolute !== toParts.absolute) return normalizePath(to);

  const a = fromParts.parts;
  const b = toParts.parts;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;

  const up = new Array(a.length - i).fill('..');
  const down = b.slice(i);
  const out = up.concat(down).join('/');
  return out || '.';
}

function toNumber(v) {
  return Number(v) || 0;
}

function toStatObject(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {}
  }
  return null;
}

function normalizeStat(stat) {
  if (!stat) return null;
  const s = toStatObject(stat);
  if (!s) return null;

  const isDir = (() => {
    if (typeof s.isDir === 'boolean') return s.isDir;
    if (typeof s.is_dir === 'boolean') return s.is_dir;
    if (typeof s.isDirectory === 'boolean') return s.isDirectory;
    if (typeof s.is_file === 'boolean') return !s.is_file;
    if (typeof s.is_file === 'function') {
      try { return !s.is_file(); } catch { }
    }
    if (typeof s.isFile === 'function') {
      try { return !s.isFile(); } catch { }
    }
    return false;
  })();

  const isFile = (() => {
    if (typeof s.is_file === 'boolean') return s.is_file;
    if (typeof s.isFile === 'boolean') return s.isFile;
    if (typeof s.is_file === 'function') {
      try { return !!s.is_file(); } catch { }
    }
    if (typeof s.isFile === 'function') {
      try { return !!s.isFile(); } catch { }
    }
    return !isDir;
  })();

  return {
    is_file: !!isFile,
    size: toNumber(s.size ?? 0),
    mtime_ms: toNumber(s.mtime_ms ?? s.mtimeMs ?? 0),
    is_dir: !!isDir,
  };
}

function statSync(pathValue) {
  return normalizeStat(__fs_stat_json(pathValue));
}

function existsSync(pathValue) {
  return !!__fs_exists(pathValue);
}

function readFileSync(pathValue) {
  const text = __fs_read(pathValue);
  if (text == null) {
    throw new Error(`ENOENT: no such file ${pathValue}`);
  }
  return text;
}

function writeFileSync(pathValue, data) {
  const ok = __fs_write(pathValue, String(data));
  if (!ok) throw new Error(`EIO: unable to write ${pathValue}`);
  return undefined;
}

function readdirSync(pathValue, options = {}) {
  const raw = __fs_list_json(pathValue);
  let names = null;
  if (Array.isArray(raw)) names = raw;
  else {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) names = parsed;
    } catch {}
  }
  if (!Array.isArray(names)) {
    throw new Error(`ENOENT: no such directory ${pathValue}`);
  }

  if (options.withFileTypes) {
    return names.map((name) => {
      const entryStat = statSync(join(pathValue, name)) || {};
      return {
        name,
        isDirectory() { return !!entryStat.is_dir; },
        isFile() { return !!entryStat.is_file; },
        isSymbolicLink() { return false; },
      };
    });
  }

  return [...names];
}

function loadTypeScript() {
  const tsPath = [join(__cwd(), 'vendor', 'typescript', 'typescript.js'), join(__cwd(), 'deps', 'typescript', 'typescript.js')]
    .find((candidate) => __fs_exists(candidate));
  const code = tsPath ? __fs_read(tsPath) : null;
  if (code === null) {
    throw new Error(`Missing deps/typescript/typescript.js at ${join(__cwd(), 'deps', 'typescript', 'typescript.js')}`);
  }

  const module = { exports: {} };
  const exports = module.exports;
  const localProcess = {
    nextTick: undefined,
    argv: [],
    env: {},
    cwd: () => __cwd(),
    pid: 1,
    platform: 'linux',
    execArgv: [],
    platformVersion: '',
    version: '',
    memoryUsage: () => ({ heapUsed: 0 }),
    stdout: { write: (s) => __writeStdout(String(s)), columns: 80, isTTY: false },
    stderr: { write: (s) => __writeStderr(String(s)) },
    exit: (code) => __exit(code | 0),
  };

  function noopRequire(name) {
    throw new Error(`require("${name}") is unavailable under v8cli classification runtime`);
  }

  (function(module, exports, require, process, global, setTimeout, clearTimeout, setInterval, clearInterval, Buffer, performance) {
    (0, eval)(code + '\n;');
  })(
    module,
    exports,
    noopRequire,
    localProcess,
    globalThis,
    () => {},
    () => {},
    () => {},
    () => {},
    minimalBuffer,
    undefined,
  );

  const ts = globalThis.ts || module.exports || exports;
  if (!ts || typeof ts.createSourceFile !== 'function') {
    throw new Error('Failed to load vendored TypeScript API');
  }
  return ts;
}

// ── Primitives the classifier system supports ────────────────

// Row/Col are JSX sugar over Box (runtime/primitives.tsx). Classifiers
// express direction explicitly via { type: 'Box', style: { flexDirection } }.
const CLASSIFIER_PRIMITIVES = new Set([
  'Box', 'Text', 'Image', 'Pressable', 'ScrollView',
  'TextInput', 'TextArea', 'TextEditor', 'Canvas', 'Graph', 'Native',
]);

// Tag → primitive. Row/FlexRow/Col/FlexColumn collapse to Box; a Row
// JSX element gets flexDirection:'row' injected into its extracted
// styleStatics in injectFlexDirectionForTag below so signatures match
// classifiers like { type: 'Box', style: { flexDirection: 'row', ... } }.
const TAG_TO_PRIMITIVE = {
  'Box': 'Box', 'View': 'Box', 'view': 'Box', 'div': 'Box',
  'Row': 'Box', 'FlexRow': 'Box',
  'Col': 'Box', 'FlexColumn': 'Box',
  'Text': 'Text', 'text': 'Text', 'span': 'Text', 'p': 'Text',
  'Image': 'Image', 'image': 'Image', 'img': 'Image',
  'Pressable': 'Pressable', 'button': 'Pressable',
  'ScrollView': 'ScrollView',
  'TextInput': 'TextInput', 'Input': 'TextInput', 'input': 'TextInput',
  'TextArea': 'TextArea', 'textarea': 'TextArea',
  'TextEditor': 'TextEditor',
  'Canvas': 'Canvas',
  'Graph': 'Graph',
  'Native': 'Native',
};

// Mirror the runtime/primitives.tsx Row shim: { flexDirection: 'row', ...style }.
// Column is the default for View, so Col needs no injection. User overrides win
// (existing flexDirection in styleStatics is preserved).
function injectFlexDirectionForTag(tagName, styleStatics) {
  if ((tagName === 'Row' || tagName === 'FlexRow') &&
      !('flexDirection' in styleStatics)) {
    styleStatics.flexDirection = 'row';
  }
}

// ── Cockpit theme tokens (for resolving 'theme:NAME' in cls files) ──
//
// Mirrors cart/app/gallery/themes/cockpit/theme-classifier.ts after
// the gallery-theme.ts flattening (radius.sm → radiusSm, spacing.x4 →
// spaceX4, type.body → typeBody, etc.). Used by parseClsFile to resolve
// classifier values written as 'theme:NAME' strings into their literal
// values before signature matching, so a classifier definition like
// { padding: 'theme:spaceX4' } matches inline JSX with { padding: 8 }.

const COCKPIT_TOKENS = {
  // surfaces
  bg: '#0e0b09', bg1: '#14100d', bg2: '#1a1511',
  // paper
  paper: '#e8dcc4', paperAlt: '#eadfca', paperInk: '#2a1f14',
  paperInkDim: '#7a6e5d', paperRule: '#3a2a1e', paperRuleBright: '#8a4a20',
  // ink
  ink: '#f2e8dc', inkDim: '#b8a890', inkDimmer: '#7a6e5d', inkGhost: '#4a4238',
  // rules
  rule: '#3a2a1e', ruleBright: '#8a4a20',
  // accent
  accent: '#d26a2a', accentHot: '#e8501c',
  // state
  ok: '#6aa390', warn: '#d6a54a', flag: '#e14a2a',
  // auxiliary
  lilac: '#8a7fd4', blue: '#5a8bd6',
  // categories (data channels)
  sys: '#5a8bd6', ctx: '#8a7fd4', usr: '#6aa390', ast: '#d26a2a',
  atch: '#d48aa7', tool: '#6ac3d6', wnd: '#e14a2a', pin: '#8aca6a',
  // decorative
  gridDot: 'rgba(138, 74, 32, 0.08)', gridDotStrong: 'rgba(138, 74, 32, 0.18)',
  // typography (strings)
  fontMono: "'JetBrains Mono', 'IBM Plex Mono', 'Menlo', monospace",
  fontSans: "'Inter Tight', 'Inter', system-ui, sans-serif",
  // type sizes (numbers)
  typeMicro: 7, typeTiny: 8, typeCaption: 9, typeBody: 10,
  typeBase: 11, typeMeta: 12, typeStrong: 14, typeHeading: 18,
  // radius
  radiusSm: 4, radiusMd: 6, radiusLg: 8, radiusXl: 10, radiusPill: 99, radiusRound: 999,
  // spacing rhythm
  spaceX0: 1, spaceX1: 2, spaceX2: 4, spaceX3: 6, spaceX4: 8,
  spaceX5: 10, spaceX6: 12, spaceX7: 16, spaceX8: 18,
  // chrome heights
  chromeTopbar: 28, chromeStatusbar: 22, chromeTileHead: 20, chromeStrip: 28,
  // letter spacing
  lsTight: '0.05em', lsNormal: '0.08em', lsWide: '0.1em', lsWider: '0.12em',
  lsWidest: '0.15em', lsUltra: '0.2em', lsBrand: '0.24em',
  // misc
  lineHeight: 1.35,
};

function resolveThemeValue(v) {
  if (typeof v === 'string' && v.startsWith('theme:')) {
    const name = v.slice('theme:'.length);
    if (name in COCKPIT_TOKENS) return COCKPIT_TOKENS[name];
  }
  return v;
}

function resolveThemeStyleObj(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = resolveThemeValue(v);
  }
  return out;
}

// ── Theme color detection ────────────────────────────────────
// Maps `c.X` or `colors.X` property access → 'theme:X'

const THEME_PROP_MAP = {
  'bg': 'theme:bg',
  'bgAlt': 'theme:bgAlt',
  'bgElevated': 'theme:bgElevated',
  'text': 'theme:text',
  'textSecondary': 'theme:textSecondary',
  'textDim': 'theme:textDim',
  'muted': 'theme:textDim',          // common alias
  'primary': 'theme:primary',
  'primaryHover': 'theme:primaryHover',
  'primaryPressed': 'theme:primaryPressed',
  'surface': 'theme:surface',
  'surfaceHover': 'theme:surfaceHover',
  'border': 'theme:border',
  'borderFocus': 'theme:borderFocus',
  'accent': 'theme:accent',
  'error': 'theme:error',
  'warning': 'theme:warning',
  'success': 'theme:success',
  'info': 'theme:info',
};

// Known theme variable names used in stories
const THEME_VARS = new Set(['c', 'colors', 'theme', 'themeColors']);

// ── File discovery ───────────────────────────────────────────

/** Prefer cart/ (ReactJIT layout), fall back to src/ (love2d/standard). */
function defaultScanDir(cwd) {
  const cart = join(cwd, 'cart');
  if (existsSync(cart)) return cart;
  return join(cwd, 'src');
}

function findTsxFiles(dir) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      results.push(...findTsxFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.cls.ts')) {
      results.push(full);
    }
  }
  return results;
}

// ── AST helpers ──────────────────────────────────────────────

function getTagName(element, ts) {
  const tag = element.tagName;
  if (ts.isIdentifier(tag)) return tag.text;
  if (ts.isPropertyAccessExpression(tag)) return tag.name.text;
  return null;
}

/**
 * Extract the literal value from an AST initializer node.
 * Returns { value, kind } where kind is 'literal', 'theme', or 'dynamic'.
 */
function extractValue(node, ts) {
  if (!node) return { value: null, kind: 'dynamic' };

  // Numeric literal: 10, 0.5
  if (ts.isNumericLiteral(node)) {
    return { value: parseFloat(node.text), kind: 'literal' };
  }

  // String literal: 'bold', '#fff', '100%'
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { value: node.text, kind: 'literal' };
  }

  // true / false
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { value: true, kind: 'literal' };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false, kind: 'literal' };

  // Property access: c.text, c.bgElevated, colors.muted
  if (ts.isPropertyAccessExpression(node)) {
    const obj = node.expression;
    const prop = node.name.text;
    if (ts.isIdentifier(obj) && THEME_VARS.has(obj.text) && THEME_PROP_MAP[prop]) {
      return { value: THEME_PROP_MAP[prop], kind: 'theme' };
    }
  }

  // Negative number: -10
  if (ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(node.operand)) {
    return { value: -parseFloat(node.operand.text), kind: 'literal' };
  }

  return { value: null, kind: 'dynamic' };
}

/**
 * Extract all static properties from an inline style object literal.
 * Returns { statics: Record<string,any>, dynamicKeys: string[], hasSpread: boolean }
 */
function extractStyleProps(objLit, ts) {
  const statics = {};
  const dynamicKeys = [];
  let hasSpread = false;

  for (const prop of objLit.properties) {
    if (ts.isSpreadAssignment(prop) || ts.isSpreadElement?.(prop)) {
      hasSpread = true;
      continue;
    }
    if (!ts.isPropertyAssignment(prop)) continue;

    const name = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : null;
    if (!name) continue;

    const { value, kind } = extractValue(prop.initializer, ts);
    if (kind === 'literal' || kind === 'theme') {
      statics[name] = value;
    } else {
      dynamicKeys.push(name);
    }
  }

  return { statics, dynamicKeys, hasSpread };
}

/**
 * Extract classifier-relevant props from a JSX element (non-style props).
 * For Text: bold, color, size, etc.
 * For Image: src (skip dynamic), width/height from style.
 */
function extractJsxProps(element, ts) {
  const attrs = element.attributes;
  if (!attrs) return {};
  const props = {};

  for (const attr of attrs.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (!attr.name) continue;
    const name = attr.name.text;

    // Skip event handlers, children, key, ref, testId, style (handled separately)
    if (name.startsWith('on') || name === 'children' || name === 'key' ||
        name === 'ref' || name === 'testId' || name === 'style') continue;

    if (!attr.initializer) {
      // Boolean prop: <Text bold />
      props[name] = true;
      continue;
    }

    if (ts.isStringLiteral(attr.initializer)) {
      props[name] = attr.initializer.text;
      continue;
    }

    if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      const { value, kind } = extractValue(attr.initializer.expression, ts);
      if (kind === 'literal' || kind === 'theme') {
        props[name] = value;
      }
      // Skip dynamic props — they vary per usage
    }
  }

  return props;
}

// ── Signature hashing ────────────────────────────────────────

function makeSignature(primitive, styleStatics, jsxProps) {
  // Combine element type + sorted static style + sorted jsx props into a stable key
  const parts = [primitive];

  // Style props (prefix with 's:' to avoid collisions)
  const styleKeys = Object.keys(styleStatics).sort();
  for (const k of styleKeys) {
    parts.push(`s:${k}=${JSON.stringify(styleStatics[k])}`);
  }

  // JSX props (prefix with 'p:')
  const propKeys = Object.keys(jsxProps).sort();
  for (const k of propKeys) {
    parts.push(`p:${k}=${JSON.stringify(jsxProps[k])}`);
  }

  return parts.join('|');
}

// ── Semantic naming ──────────────────────────────────────────

/**
 * Generate a semantic name from the pattern's structural traits.
 * Returns a PascalCase name that describes what the pattern IS.
 */
function suggestName(primitive, styleStatics, jsxProps, prefix) {
  const s = styleStatics;
  const p = jsxProps;
  const pfx = prefix ? prefix : '';

  // ── Text naming (based on size + weight + color + extra style props) ──
  if (primitive === 'Text') {
    const size = s.fontSize || p.size;
    const bold = s.fontWeight === 'bold' || p.bold === true;
    const color = s.color || p.color || '';
    const hasLetterSpacing = 'letterSpacing' in s;
    const styleKeyCount = Object.keys(s).length;

    // Color modifier
    let colorMod = '';
    if (typeof color === 'string') {
      if (color.includes('textDim') || color.includes('muted')) colorMod = 'Dim';
      else if (color.includes('error') || color.includes('#f38b') || color.includes('red')) colorMod = 'Error';
      else if (color.includes('accent') || color.includes('#8b5c')) colorMod = 'Accent';
      else if (color.includes('primary')) colorMod = 'Primary';
      else if (color.includes('success') || color.includes('#a6e3') || color.includes('green')) colorMod = 'Ok';
      else if (color.includes('warning') || color.includes('#f9e2') || color.includes('#fab3')) colorMod = 'Warn';
      else if (color.includes('#89b4') || color.includes('blue') || color.includes('info')) colorMod = 'Info';
      else if (color.includes('#94e2') || color.includes('teal')) colorMod = 'Teal';
      else if (color.includes('#cba6') || color.includes('mauve')) colorMod = 'Mauve';
      else if (color.includes('text')) colorMod = '';  // default text color = no modifier
    }
    // No color at all
    const noColor = !color;

    // Extra style traits for disambiguation
    let extraMod = '';
    if (s.width || s.flexShrink === 0) extraMod += 'Fixed';
    if (s.textAlign === 'center') extraMod += 'Center';
    if (s.textAlign === 'right') extraMod += 'Right';

    // Size tier name
    let sizeName;
    if (hasLetterSpacing && bold) sizeName = 'Label';
    else if (!size) sizeName = bold ? 'BoldText' : 'Text';
    else if (size >= 20) sizeName = bold ? 'Title' : 'DisplayText';
    else if (size >= 16) sizeName = bold ? 'Heading' : 'LargeText';
    else if (size >= 14) sizeName = bold ? 'SectionHead' : 'LargeBody';
    else if (size >= 12) sizeName = bold ? 'Subtitle' : 'MedText';
    else if (size >= 11) sizeName = bold ? 'BoldBody' : 'Body11';
    else if (size >= 10) sizeName = bold ? 'BoldBody10' : 'Body';
    else if (size >= 9) sizeName = bold ? 'SmallBold' : 'Caption';
    else if (size >= 8) sizeName = bold ? 'TinyBold' : 'Tiny';
    else if (size >= 6) sizeName = 'Micro';
    else sizeName = 'Nano';

    // Compose: prefix + colorMod + sizeName + extraMod
    // e.g., DimCaption, AccentBody, ErrorTiny, Label, Title
    return `${pfx}${colorMod}${sizeName}${extraMod}`;
  }

  // ── Image naming (based on exact pixel size) ──
  if (primitive === 'Image') {
    const w = s.width || p.width;
    const h = s.height || p.height;
    if (w && h) return `${pfx}Icon${w}x${h}`;
    const size = w || h;
    if (size) return `${pfx}Icon${size}`;
    return `${pfx}Img`;
  }

  // ── Box / Row / Col naming ──
  const isRow = primitive === 'Row' || s.flexDirection === 'row';
  const hasBgElevated = typeof s.backgroundColor === 'string' && s.backgroundColor.includes('Elevated');
  const hasBgSurface = typeof s.backgroundColor === 'string' && s.backgroundColor.includes('surface');
  const hasBg = typeof s.backgroundColor === 'string' && s.backgroundColor.includes('theme:bg') && !hasBgElevated;
  const hasBorderBottom = s.borderBottomWidth > 0;
  const hasBorderTop = s.borderTopWidth > 0;
  const hasBorderLeft = s.borderLeftWidth > 0;
  const hasRadius = s.borderRadius > 0;
  const pad = s.padding || s.paddingLeft || s.paddingTop || 0;
  const hasPadding = pad > 0;
  const gap = s.gap || 0;
  const hasGap = gap > 0;
  const isFullSize = s.width === '100%' && s.height === '100%';
  const isDividerLike = (s.height === 1 || s.height === 0.5) && !hasPadding;
  const isDot = s.width && s.height && s.width === s.height && s.width <= 12 && s.borderRadius >= s.width / 2;
  const isFlexFill = (s.flexGrow === 1);
  const isHalf = (s.flexGrow === 1 && s.flexBasis === 0);
  const radius = s.borderRadius || 0;

  // Specific patterns (most specific first)
  if (isFullSize && hasBg) return `${pfx}Root`;
  if (isDot) return `${pfx}Dot${s.width}`;
  if (isDividerLike) return `${pfx}Divider`;

  if (hasBgElevated && hasBorderBottom) return `${pfx}HeaderBar`;
  if (hasBgElevated && hasBorderTop) return `${pfx}FooterBar`;
  if (hasBgElevated && hasRadius) return `${pfx}Well${radius ? `R${radius}` : ''}`;
  if (hasBgElevated && hasPadding) return `${pfx}ElevatedPanel`;

  if (hasBgSurface && hasRadius) return `${pfx}InputWell${radius ? `R${radius}` : ''}`;
  if (hasBgSurface) return `${pfx}Surface`;

  if (hasBorderLeft && hasPadding) return `${pfx}Callout`;

  if (isHalf && hasGap) return `${pfx}HalfGap${gap}`;
  if (isHalf) return `${pfx}Half`;
  if (isFlexFill && !hasPadding && !hasRadius) return `${pfx}Spacer`;

  // Radius + padding without other signals = badge/chip/card family
  if (hasRadius && hasPadding && !hasGap) {
    if (pad <= 4) return `${pfx}Tag${radius ? `R${radius}` : ''}`;
    if (pad <= 8) return `${pfx}Chip${radius ? `R${radius}` : ''}`;
    if (pad <= 12) return `${pfx}Badge${radius ? `R${radius}` : ''}`;
    return `${pfx}CardR${radius}`;
  }
  if (hasRadius && hasPadding && hasGap) return `${pfx}Card${radius ? `R${radius}` : ''}`;

  if (isRow && hasGap && hasPadding) return `${pfx}Band${gap ? `G${gap}` : ''}`;
  if (isRow && hasGap) return `${pfx}InlineG${gap}`;
  if (isRow) return `${pfx}Inline`;

  if (hasPadding && hasGap) return `${pfx}Section${gap ? `G${gap}` : ''}`;
  if (hasGap) return `${pfx}Stack${gap}`;
  if (hasPadding) return `${pfx}Pad${pad}`;

  if (hasRadius) return `${pfx}RoundR${radius}`;
  if (isFlexFill) return `${pfx}Fill`;

  // Minimal style — name by total prop count
  const totalProps = Object.keys(s).length + Object.keys(p).length;
  if (totalProps <= 1) return `${pfx}Bare`;
  return `${pfx}Box${totalProps}p`;
}

/**
 * Deduplicate names. For collisions, differentiate by the most distinctive
 * trait that differs between the colliding groups.
 */
function deduplicateNames(groups) {
  // Group by base name
  const byName = new Map();
  for (const g of groups) {
    if (!byName.has(g.suggestedName)) byName.set(g.suggestedName, []);
    byName.get(g.suggestedName).push(g);
  }

  for (const [name, items] of byName) {
    if (items.length <= 1) continue;

    // Try differentiating by traits in order of usefulness
    for (let i = 0; i < items.length; i++) {
      const g = items[i];
      const suffix = buildDistinctSuffix(g, items);
      g.suggestedName = i === 0 && !suffix ? name : `${name}${suffix || `V${i + 1}`}`;
    }

    // If first item got no suffix but others did, check if it's still unique
    const finalNames = new Set();
    for (const g of items) {
      if (finalNames.has(g.suggestedName)) {
        // Still colliding — fall back to numbering
        let n = 2;
        while (finalNames.has(`${g.suggestedName}${n}`)) n++;
        g.suggestedName = `${g.suggestedName}${n}`;
      }
      finalNames.add(g.suggestedName);
    }
  }
}

/**
 * Build a distinguishing suffix from the pattern's unique traits.
 */
function buildDistinctSuffix(group, siblings) {
  const s = group.styleStatics;
  const p = group.jsxProps;
  const parts = [];

  // Collect all trait dimensions that differ across siblings
  const traits = [
    { key: 'color', get: g => g.styleStatics.color || g.jsxProps.color || '' },
    { key: 'bold', get: g => g.styleStatics.fontWeight === 'bold' || g.jsxProps.bold === true },
    { key: 'padding', get: g => g.styleStatics.padding || g.styleStatics.paddingLeft || g.styleStatics.paddingTop || 0 },
    { key: 'gap', get: g => g.styleStatics.gap || 0 },
    { key: 'borderRadius', get: g => g.styleStatics.borderRadius || 0 },
    { key: 'width', get: g => g.styleStatics.width || '' },
    { key: 'height', get: g => g.styleStatics.height || '' },
    { key: 'flexShrink', get: g => g.styleStatics.flexShrink },
    { key: 'bg', get: g => g.styleStatics.backgroundColor || '' },
    { key: 'border', get: g => (g.styleStatics.borderWidth || 0) + (g.styleStatics.borderBottomWidth || 0) + (g.styleStatics.borderTopWidth || 0) },
    { key: 'propCount', get: g => Object.keys(g.styleStatics).length + Object.keys(g.jsxProps).length },
  ];

  const myValues = {};
  for (const t of traits) {
    myValues[t.key] = JSON.stringify(t.get(group));
  }

  // Find traits where this group differs from at least one sibling
  for (const t of traits) {
    const myVal = t.get(group);
    const differs = siblings.some(g => g !== group && JSON.stringify(t.get(g)) !== myValues[t.key]);
    if (!differs) continue;

    // Build a concise modifier from this trait
    if (t.key === 'color') {
      const c = String(myVal);
      if (!c) parts.push('Plain');
      else if (c.includes('textDim') || c.includes('muted')) { /* already in name */ }
      else if (c.includes('text')) { /* default */ }
      else if (c.includes('accent')) parts.push('Accent');
      else if (c.includes('error')) parts.push('Err');
      else if (c.includes('#')) parts.push(`C${c.slice(1, 4)}`);
      break; // one trait is usually enough
    }
    if (t.key === 'bold') { parts.push(myVal ? 'Bold' : 'Normal'); break; }
    if (t.key === 'padding') { if (myVal) parts.push(`P${myVal}`); break; }
    if (t.key === 'gap') { if (myVal) parts.push(`G${myVal}`); break; }
    if (t.key === 'width') { if (myVal) parts.push(`W${myVal}`); break; }
    if (t.key === 'height') { if (myVal) parts.push(`H${myVal}`); break; }
    if (t.key === 'propCount') { parts.push(`${myVal}s`); break; }
  }

  return parts.join('');
}

// ── Main scanner ─────────────────────────────────────────────

/**
 * Scan all TSX files under `dir`, extract patterns, group and name them.
 */
function scanPatterns(dir, ts, minOccurrences) {
  const files = findTsxFiles(dir);
  /** @type {Map<string, { primitive, styleStatics, jsxProps, dynamicKeys, occurrences }>} */
  const groups = new Map();

  for (const filePath of files) {
    const source = readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      filePath, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX,
    );

    walkJsx(sourceFile, sourceFile, filePath, ts, groups);
  }

  // Filter by min occurrences and sort by frequency
  const results = [];
  for (const [sig, group] of groups) {
    if (group.occurrences.length < minOccurrences) continue;
    // Skip patterns with no static props (just a bare <Box> with no style)
    const propCount = Object.keys(group.styleStatics).length + Object.keys(group.jsxProps).length;
    if (propCount === 0) continue;
    results.push(group);
  }

  results.sort((a, b) => b.occurrences.length - a.occurrences.length);
  return { groups: results, fileCount: files.length };
}

function walkJsx(node, sourceFile, filePath, ts, groups) {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const element = ts.isJsxElement(node) ? node.openingElement : node;
    const tagName = getTagName(element, ts);
    const primitive = tagName ? TAG_TO_PRIMITIVE[tagName] : null;

    if (primitive) {
      // Extract style props
      let styleStatics = {};
      let dynamicKeys = [];
      let hasSpread = false;

      const attrs = element.attributes;
      if (attrs) {
        for (const attr of attrs.properties) {
          if (!ts.isJsxAttribute(attr)) continue;
          if (!attr.name || attr.name.text !== 'style') continue;
          const init = attr.initializer;
          if (init && ts.isJsxExpression(init) && init.expression &&
              ts.isObjectLiteralExpression(init.expression)) {
            const extracted = extractStyleProps(init.expression, ts);
            styleStatics = extracted.statics;
            dynamicKeys = extracted.dynamicKeys;
            hasSpread = extracted.hasSpread;
          }
        }
      }

      injectFlexDirectionForTag(tagName, styleStatics);

      // Skip elements with spread in style — not fully analyzable
      if (!hasSpread) {
        const jsxProps = extractJsxProps(element, ts);
        const sig = makeSignature(primitive, styleStatics, jsxProps);

        // Get enclosing function name for context
        let parentFn = '';
        let p = node.parent;
        while (p) {
          if (ts.isFunctionDeclaration(p) && p.name) { parentFn = p.name.text; break; }
          if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) { parentFn = p.name.text; break; }
          if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name)) { parentFn = p.name.text; break; }
          p = p.parent;
        }

        const pos = ts.getLineAndCharacterOfPosition(sourceFile, element.getStart(sourceFile));

        if (!groups.has(sig)) {
          groups.set(sig, {
            primitive,
            styleStatics,
            jsxProps,
            dynamicKeys,
            occurrences: [],
            suggestedName: '',
          });
        }
        groups.get(sig).occurrences.push({
          file: filePath,
          line: pos.line + 1,
          parentFn,
        });
      }
    }
  }

  ts.forEachChild(node, child => walkJsx(child, sourceFile, filePath, ts, groups));
}

// ── Element scanning (for pick mode) ────────────────────────

/**
 * Scan all JSX elements individually (not grouped by signature).
 * Only includes elements with fully static styles (no spread, no dynamic keys).
 */
function scanElements(dir, ts) {
  const files = findTsxFiles(dir);
  const elements = [];

  for (const filePath of files) {
    const source = readFileSync(filePath, 'utf-8');
    const sf = ts.createSourceFile(
      filePath, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX,
    );

    function visit(node) {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const element = ts.isJsxElement(node) ? node.openingElement : node;
        const tagName = getTagName(element, ts);
        const primitive = tagName ? TAG_TO_PRIMITIVE[tagName] : null;

        if (primitive) {
          let styleStatics = {};
          let dynamicKeys = [];
          let hasSpread = false;

          const attrs = element.attributes;
          if (attrs) {
            for (const attr of attrs.properties) {
              if (!ts.isJsxAttribute(attr)) continue;
              if (!attr.name || attr.name.text !== 'style') continue;
              const init = attr.initializer;
              if (init && ts.isJsxExpression(init) && init.expression &&
                  ts.isObjectLiteralExpression(init.expression)) {
                const extracted = extractStyleProps(init.expression, ts);
                styleStatics = extracted.statics;
                dynamicKeys = extracted.dynamicKeys;
                hasSpread = extracted.hasSpread;
              }
            }
          }

          injectFlexDirectionForTag(tagName, styleStatics);

          // Only include fully static elements (migratable)
          if (!hasSpread && dynamicKeys.length === 0) {
            const jsxProps = extractJsxProps(element, ts);
            const propCount = Object.keys(styleStatics).length + Object.keys(jsxProps).length;
            if (propCount > 0) {
              const pos = ts.getLineAndCharacterOfPosition(sf, element.getStart(sf));
              elements.push({
                primitive,
                styleStatics,
                jsxProps,
                file: filePath,
                line: pos.line + 1,
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }

  return { elements, fileCount: files.length };
}

// ── Output generation ────────────────────────────────────────

function formatValue(v) {
  if (typeof v === 'string') return `'${v}'`;
  if (typeof v === 'boolean') return v.toString();
  if (typeof v === 'number') return v.toString();
  return JSON.stringify(v);
}

/**
 * Find near-duplicate sibling groups (same primitive, name-prefix relationship,
 * 1–2 differing fields) and fold the children into the parent as `.Suffix`
 * appendages. Mutates groups in place: parents gain `appendages: [{suffix, styleDelta, propDelta}]`,
 * children are marked `isAppendage: true` so the emitter skips their top-level entry.
 */
function clusterAppendages(groups, maxDeltaFields = 2) {
  // Index by primitive so we only compare apples to apples.
  const byPrimitive = new Map();
  for (const g of groups) {
    if (!byPrimitive.has(g.primitive)) byPrimitive.set(g.primitive, []);
    byPrimitive.get(g.primitive).push(g);
  }

  for (const [, bucket] of byPrimitive) {
    // Longest names first so a child is matched to its most-specific parent.
    const sortedByLen = [...bucket].sort((a, b) => b.suggestedName.length - a.suggestedName.length);
    for (const child of sortedByLen) {
      if (child.isAppendage) continue;
      // Candidate parents: any sibling whose name is a strict prefix of child's.
      const candidates = bucket.filter(p =>
        p !== child &&
        !p.isAppendage &&
        child.suggestedName.startsWith(p.suggestedName) &&
        child.suggestedName.length > p.suggestedName.length,
      );
      if (candidates.length === 0) continue;

      // Prefer the longest-prefix parent (most specific match).
      candidates.sort((a, b) => b.suggestedName.length - a.suggestedName.length);

      for (const parent of candidates) {
        const styleDelta = {};
        for (const k of Object.keys(child.styleStatics)) {
          if (JSON.stringify(child.styleStatics[k]) !== JSON.stringify(parent.styleStatics[k])) {
            styleDelta[k] = child.styleStatics[k];
          }
        }
        const propDelta = {};
        for (const k of Object.keys(child.jsxProps)) {
          if (JSON.stringify(child.jsxProps[k]) !== JSON.stringify(parent.jsxProps[k])) {
            propDelta[k] = child.jsxProps[k];
          }
        }
        // Also flag keys the parent has but the child drops — these can't be
        // expressed as a pure additive appendage, so leave such pairs alone.
        const parentDropsStyle = Object.keys(parent.styleStatics).some(k => !(k in child.styleStatics));
        const parentDropsProps = Object.keys(parent.jsxProps).some(k => !(k in child.jsxProps));
        const totalDelta = Object.keys(styleDelta).length + Object.keys(propDelta).length;
        if (totalDelta === 0 || totalDelta > maxDeltaFields) continue;
        if (parentDropsStyle || parentDropsProps) continue;

        const suffix = child.suggestedName.slice(parent.suggestedName.length);
        if (!/^[A-Z][A-Za-z0-9]*$/.test(suffix)) continue;

        parent.appendages = parent.appendages || [];
        parent.appendages.push({ suffix, styleDelta, propDelta, occurrences: child.occurrences });
        child.isAppendage = true;
        child.appendageOf = parent.suggestedName;
        break; // matched to one parent — done.
      }
    }
  }
}

/**
 * Format a child appendage body. Mirrors the parent's emission shape:
 *  - for Text parents, promote style.color/fontWeight/fontSize to flat color/bold/size
 *  - everything else goes under `style: { ... }`
 *  - flat jsxProp deltas stay flat
 */
function formatAppendageBody(primitive, styleDelta, propDelta) {
  const parts = [];
  let remainingStyle = { ...styleDelta };

  if (primitive === 'Text') {
    if ('color' in remainingStyle) {
      parts.push(`color: ${formatValue(remainingStyle.color)}`);
      delete remainingStyle.color;
    }
    if ('fontWeight' in remainingStyle) {
      if (remainingStyle.fontWeight === 'bold') parts.push(`bold: true`);
      delete remainingStyle.fontWeight;
    }
    if ('fontSize' in remainingStyle) {
      parts.push(`size: ${remainingStyle.fontSize}`);
      delete remainingStyle.fontSize;
    }
  }

  for (const [k, v] of Object.entries(propDelta)) {
    parts.push(`${k}: ${formatValue(v)}`);
  }

  const styleKeys = Object.keys(remainingStyle);
  if (styleKeys.length > 0) {
    const styleParts = styleKeys.map(k => `${k}: ${formatValue(remainingStyle[k])}`);
    parts.push(`style: { ${styleParts.join(', ')} }`);
  }

  return parts.join(', ');
}

function generateClsFile(groups, prefix) {
  const lines = [
    `/**`,
    ` * Auto-generated classifier sheet`,
    ` * Generated by: rjit classify`,
    ` * Patterns: ${groups.length}`,
    ` * Total occurrences: ${groups.reduce((s, g) => s + g.occurrences.length, 0)}`,
    ` *`,
    ` * Review names, adjust as needed, then import at app entry.`,
    ` */`,
    ``,
    `import { classifier } from '@reactjit/core';`,
    ``,
    `classifier({`,
  ];

  for (const group of groups) {
    if (group.isAppendage) continue; // emitted under its parent below
    const { primitive, styleStatics, jsxProps, suggestedName, occurrences } = group;
    const fileCount = new Set(occurrences.map(o => o.file)).size;

    lines.push(`  // ${occurrences.length} occurrences across ${fileCount} files`);

    // Build the entry
    const entryParts = [`type: '${primitive}'`];

    // Add non-style jsx props
    for (const [k, v] of Object.entries(jsxProps)) {
      entryParts.push(`${k}: ${formatValue(v)}`);
    }

    // Add style object if there are style props
    const styleKeys = Object.keys(styleStatics);
    if (styleKeys.length > 0) {
      const styleParts = styleKeys.map(k => `${k}: ${formatValue(styleStatics[k])}`);
      if (styleParts.length <= 3) {
        entryParts.push(`style: { ${styleParts.join(', ')} }`);
      } else {
        entryParts.push(`style: {\n      ${styleParts.join(',\n      ')},\n    }`);
      }
    }

    // For Text with fontSize in style, suggest using `size` prop instead
    // (classifier Text entries use `size`, not `style.fontSize`)
    let entry;
    if (primitive === 'Text' && styleStatics.fontSize) {
      // Promote fontSize → size, fontWeight → bold, color → color
      const promoted = [];
      promoted.push(`type: 'Text'`);
      promoted.push(`size: ${styleStatics.fontSize}`);
      if (styleStatics.fontWeight === 'bold') promoted.push(`bold: true`);
      if (styleStatics.color) promoted.push(`color: ${formatValue(styleStatics.color)}`);

      // Remaining style props (not fontSize/fontWeight/color)
      const remaining = {};
      for (const k of styleKeys) {
        if (k !== 'fontSize' && k !== 'fontWeight' && k !== 'color') {
          remaining[k] = styleStatics[k];
        }
      }
      const remKeys = Object.keys(remaining);
      if (remKeys.length > 0) {
        const remParts = remKeys.map(k => `${k}: ${formatValue(remaining[k])}`);
        promoted.push(`style: { ${remParts.join(', ')} }`);
      }

      // Non-style props (excluding ones we promoted)
      for (const [k, v] of Object.entries(jsxProps)) {
        if (k !== 'size' && k !== 'bold' && k !== 'color') {
          promoted.push(`${k}: ${formatValue(v)}`);
        }
      }

      entry = promoted.join(', ');
    } else {
      entry = entryParts.join(', ');
    }

    if (group.appendages && group.appendages.length > 0) {
      // Emit parent body open + nested `.Suffix` siblings + close.
      lines.push(`  ${suggestedName}: { ${entry},`);
      for (const ap of group.appendages) {
        const childBody = formatAppendageBody(primitive, ap.styleDelta, ap.propDelta);
        const apFiles = new Set(ap.occurrences.map(o => o.file)).size;
        lines.push(`    // ${ap.occurrences.length} occurrences across ${apFiles} files`);
        lines.push(`    '.${ap.suffix}': { ${childBody} },`);
      }
      lines.push(`  },`);
    } else {
      lines.push(`  ${suggestedName}: { ${entry} },`);
    }
    lines.push(``);
  }

  lines.push(`});`);
  lines.push(``);

  return lines.join('\n');
}

function generateReport(groups, fileCount) {
  const lines = [];
  const emittedGroups = groups.filter(g => !g.isAppendage);
  const appendageCount = groups.length - emittedGroups.length;
  const totalOccurrences = groups.reduce((s, g) => s + g.occurrences.length, 0);

  lines.push(`\n  Classifier Pattern Analysis`);
  lines.push(`  ${'─'.repeat(50)}`);
  lines.push(`  Files scanned: ${fileCount}`);
  lines.push(`  Patterns found: ${emittedGroups.length} (+${appendageCount} folded as .Suffix)`);
  lines.push(`  Total inline styles replaced: ${totalOccurrences}`);
  lines.push(`  ${'─'.repeat(50)}\n`);

  // Table header
  lines.push(`  ${'Name'.padEnd(25)} ${'Type'.padEnd(12)} ${'Hits'.padStart(5)} ${'Files'.padStart(6)}  Key traits`);
  lines.push(`  ${'─'.repeat(25)} ${'─'.repeat(12)} ${'─'.repeat(5)} ${'─'.repeat(6)}  ${'─'.repeat(30)}`);

  for (const group of groups) {
    if (group.isAppendage) continue;
    const { primitive, styleStatics, jsxProps, suggestedName, occurrences } = group;
    const fileCount = new Set(occurrences.map(o => o.file)).size;

    // Build trait summary
    const traits = [];
    if (styleStatics.fontSize) traits.push(`${styleStatics.fontSize}px`);
    if (styleStatics.fontWeight === 'bold' || jsxProps.bold) traits.push('bold');
    if (styleStatics.backgroundColor) {
      const bg = styleStatics.backgroundColor;
      if (bg.includes('Elevated')) traits.push('bgElevated');
      else if (bg.includes('surface')) traits.push('surface');
      else if (bg.includes('bg')) traits.push('bg');
      else traits.push('bg:custom');
    }
    if (styleStatics.borderRadius) traits.push(`r${styleStatics.borderRadius}`);
    if (styleStatics.padding) traits.push(`p${styleStatics.padding}`);
    if (styleStatics.gap) traits.push(`gap${styleStatics.gap}`);
    if (styleStatics.borderBottomWidth) traits.push('borderBot');
    if (styleStatics.borderTopWidth) traits.push('borderTop');
    if (styleStatics.borderLeftWidth) traits.push('borderLeft');
    if (styleStatics.flexGrow) traits.push('grow');
    if (styleStatics.color) {
      const c = styleStatics.color;
      if (c.includes('textDim') || c.includes('muted')) traits.push('muted');
      else if (c.includes('text')) traits.push('text');
      else if (c.includes('accent')) traits.push('accent');
    }

    const traitStr = traits.join(', ');
    lines.push(`  ${suggestedName.padEnd(25)} ${primitive.padEnd(12)} ${String(occurrences.length).padStart(5)} ${String(fileCount).padStart(6)}  ${traitStr}`);
  }

  lines.push('');
  return lines.join('\n');
}

// ── Rename command ────────────────────────────────────────────

/**
 * Find all .cls.ts and .tsx files under a directory.
 */
function findRenameTargets(dir) {
  const results = { cls: [], tsx: [] };
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      const sub = findRenameTargets(full);
      results.cls.push(...sub.cls);
      results.tsx.push(...sub.tsx);
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.cls.ts')) results.cls.push(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.cls.ts')) results.tsx.push(full);
    }
  }
  return results;
}

/**
 * Detect the local alias for `classifiers` in a file.
 * Matches: `classifiers as C`, `classifiers as cls`, `const C = classifiers`, etc.
 */
function findClassifierAliases(source) {
  const aliases = new Set();
  // import { classifiers as X }
  const importRe = /classifiers\s+as\s+(\w+)/g;
  let m;
  while ((m = importRe.exec(source))) aliases.add(m[1]);
  // const X = classifiers
  const constRe = /(?:const|let|var)\s+(\w+)\s*=\s*classifiers\b/g;
  while ((m = constRe.exec(source))) aliases.add(m[1]);
  // Direct usage without alias
  if (/\bclassifiers\s*\./.test(source)) aliases.add('classifiers');
  return aliases;
}

async function renameCommand(args) {
  if (args.length < 2) {
    console.error(`\n  Usage: rjit classify rename <OldName> <NewName>`);
    console.error(`         rjit classify rename <OldName> <NewName> --dir ./stories\n`);
    process.exit(1);
  }

  const oldName = args[0];
  const newName = args[1];
  const cwd = process.cwd();
  let scanDir = defaultScanDir(cwd);
  let dryRun = false;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--dir') { scanDir = join(cwd, args[++i]); continue; }
    if (args[i] === '--dry-run') { dryRun = true; continue; }
  }

  if (!existsSync(scanDir)) {
    console.error(`  Directory not found: ${scanDir}`);
    process.exit(1);
  }

  if (oldName === newName) {
    console.log(`  Nothing to do — names are identical.`);
    return;
  }

  if (!/^[A-Z][A-Za-z0-9]*$/.test(newName)) {
    console.error(`  New name must be PascalCase (e.g., PageTitle, DimCaption). Got: ${newName}`);
    process.exit(1);
  }

  console.log(`\n  Renaming classifier: ${oldName} → ${newName}`);
  console.log(`  Scanning ${relative(cwd, scanDir) || '.'}/ ...\n`);

  const { cls, tsx } = findRenameTargets(scanDir);
  let totalReplacements = 0;
  const touchedFiles = [];

  // 1. Rename definition key in .cls.ts files
  for (const filePath of cls) {
    const source = readFileSync(filePath, 'utf-8');
    // Match the definition key: `  OldName: {` or `OldName:{`
    const defRe = new RegExp(`(^|[\\s,{])${oldName}(\\s*:)`, 'gm');
    if (!defRe.test(source)) continue;

    const updated = source.replace(defRe, `$1${newName}$2`);
    if (updated !== source) {
      if (!dryRun) writeFileSync(filePath, updated, 'utf-8');
      const count = (source.match(defRe) || []).length;
      totalReplacements += count;
      touchedFiles.push({ file: relative(cwd, filePath), count, type: 'def' });
    }
  }

  // 2. Rename usages in .tsx files (and .cls.ts files for cross-references)
  const allFiles = [...tsx, ...cls];
  for (const filePath of allFiles) {
    const source = readFileSync(filePath, 'utf-8');
    const aliases = findClassifierAliases(source);
    if (aliases.size === 0) continue;

    let updated = source;
    let count = 0;

    for (const alias of aliases) {
      // Match: <C.OldName, </C.OldName, C.OldName (in expressions)
      // Use word boundary after name to avoid partial matches (e.g., StoryBody vs StoryBodyText)
      const usageRe = new RegExp(`(${alias}\\.)${oldName}\\b`, 'g');
      const matches = updated.match(usageRe);
      if (matches) {
        count += matches.length;
        updated = updated.replace(usageRe, `$1${newName}`);
      }
    }

    if (updated !== source) {
      if (!dryRun) writeFileSync(filePath, updated, 'utf-8');
      totalReplacements += count;
      touchedFiles.push({ file: relative(cwd, filePath), count, type: 'usage' });
    }
  }

  // Report
  if (touchedFiles.length === 0) {
    console.log(`  No occurrences of "${oldName}" found.\n`);
    return;
  }

  console.log(`  ${'File'.padEnd(50)} ${'Type'.padEnd(6)} Hits`);
  console.log(`  ${'─'.repeat(50)} ${'─'.repeat(6)} ${'─'.repeat(4)}`);
  for (const { file, count, type } of touchedFiles) {
    console.log(`  ${file.padEnd(50)} ${type.padEnd(6)} ${count}`);
  }
  console.log(`\n  Total: ${totalReplacements} replacements across ${touchedFiles.length} files.`);
  console.log(`  ${oldName} → ${newName}${dryRun ? '  (dry-run — no files written)' : ''}\n`);
}

// ── Migrate command ───────────────────────────────────────────

/**
 * Parse a .cls.ts file and extract classifier definitions.
 * Returns Map<signatureHash, { name, primitive, props }> for matching.
 */
function parseClsFile(clsPath, ts) {
  const source = readFileSync(clsPath, 'utf-8');
  const sf = ts.createSourceFile(clsPath, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);

  // Also extract any exported const objects (like SB palette) for color resolution
  const exportedConsts = {};
  sf.forEachChild(node => {
    if (ts.isVariableStatement(node) &&
        node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
          const obj = {};
          for (const prop of decl.initializer.properties) {
            if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
              const { value } = extractValue(prop.initializer, ts);
              if (value !== null) obj[prop.name.text] = value;
            }
          }
          exportedConsts[decl.name.text] = obj;
        }
      }
    }
  });

  const classifiers = [];

  // Find classifier({...}) call
  function walk(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === 'classifier' && node.arguments.length === 1 &&
        ts.isObjectLiteralExpression(node.arguments[0])) {
      const obj = node.arguments[0];
      for (const prop of obj.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const name = ts.isIdentifier(prop.name) ? prop.name.text
                   : ts.isStringLiteral(prop.name) ? prop.name.text : null;
        if (!name) continue;
        if (!ts.isObjectLiteralExpression(prop.initializer)) continue;

        // Extract classifier entry props
        const entry = {};
        for (const ep of prop.initializer.properties) {
          if (!ts.isPropertyAssignment(ep) || !ts.isIdentifier(ep.name)) continue;
          const key = ep.name.text;
          if (key === 'style' && ts.isObjectLiteralExpression(ep.initializer)) {
            entry.style = {};
            for (const sp of ep.initializer.properties) {
              if (!ts.isPropertyAssignment(sp) || !ts.isIdentifier(sp.name)) continue;
              const { value } = extractValue(sp.initializer, ts);
              // Handle SB.xxx references
              if (value === null && ts.isPropertyAccessExpression(sp.initializer)) {
                const objName = ts.isIdentifier(sp.initializer.expression) ? sp.initializer.expression.text : null;
                const propName = sp.initializer.name.text;
                if (objName && exportedConsts[objName] && exportedConsts[objName][propName] !== undefined) {
                  entry.style[sp.name.text] = exportedConsts[objName][propName];
                }
              } else if (value !== null) {
                entry.style[sp.name.text] = value;
              }
            }
          } else {
            const { value } = extractValue(ep.initializer, ts);
            if (value === null && ts.isPropertyAccessExpression(ep.initializer)) {
              const objName = ts.isIdentifier(ep.initializer.expression) ? ep.initializer.expression.text : null;
              const propName = ep.initializer.name.text;
              if (objName && exportedConsts[objName] && exportedConsts[objName][propName] !== undefined) {
                entry[key] = exportedConsts[objName][propName];
              }
            } else if (value !== null) {
              entry[key] = value;
            }
          }
        }

        const primitive = entry.type;
        if (!primitive) continue;
        delete entry.type;

        // Build signature for matching
        // For Text: size→fontSize, bold→fontWeight:'bold', color→color (in style)
        let styleStatics = { ...(entry.style || {}) };
        const jsxProps = {};
        for (const [k, v] of Object.entries(entry)) {
          if (k === 'style') continue;
          if (k === 'use') continue;
          if (primitive === 'Text') {
            if (k === 'size') { styleStatics.fontSize = v; continue; }
            if (k === 'bold' && v === true) { styleStatics.fontWeight = 'bold'; continue; }
            if (k === 'color') { styleStatics.color = v; continue; }
          }
          jsxProps[k] = v;
        }

        // Resolve any 'theme:NAME' values to their literal cockpit values
        // so signatures match raw inline JSX. Without this, a classifier
        // with { padding: 'theme:spaceX4' } never matches { padding: 8 }.
        styleStatics = resolveThemeStyleObj(styleStatics);
        for (const k of Object.keys(jsxProps)) {
          jsxProps[k] = resolveThemeValue(jsxProps[k]);
        }

        const sig = makeSignature(primitive, styleStatics, jsxProps);
        classifiers.push({ name, primitive, sig, styleStatics, jsxProps, entry });
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(sf);

  // Build lookup by signature
  const bySig = new Map();
  for (const c of classifiers) {
    if (!bySig.has(c.sig)) bySig.set(c.sig, c);
  }

  return { classifiers, bySig, exportedConsts };
}

/**
 * Migrate a single TSX file: replace inline styles with classifier references.
 */
function migrateFile(filePath, bySig, clsAlias, ts, partial = false, dryRun = false) {
  const source = readFileSync(filePath, 'utf-8');
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);

  const replacements = []; // { start, end, text }

  // For partial matching: find best classifier whose properties are a subset
  // of the element's properties with matching values.
  function findPartialMatch(primitive, elStyle, elJsx) {
    let best = null;
    let bestScore = 0;
    for (const [, cls] of bySig) {
      if (cls.primitive !== primitive) continue;
      // Check: all classifier style props must be in element with matching values
      const clsStyle = cls.styleStatics;
      const clsJsx = cls.jsxProps;
      let allMatch = true;
      let score = 0;
      for (const [k, v] of Object.entries(clsStyle)) {
        if (elStyle[k] === undefined || JSON.stringify(elStyle[k]) !== JSON.stringify(v)) {
          allMatch = false;
          break;
        }
        score++;
      }
      if (!allMatch) continue;
      for (const [k, v] of Object.entries(clsJsx)) {
        if (elJsx[k] === undefined || JSON.stringify(elJsx[k]) !== JSON.stringify(v)) {
          allMatch = false;
          break;
        }
        score++;
      }
      if (!allMatch) continue;
      // Must actually cover at least 2 properties to be worthwhile
      if (score < 2) continue;
      // Element must have MORE properties (otherwise it's exact, already handled)
      const totalEl = Object.keys(elStyle).length + Object.keys(elJsx).length;
      if (totalEl <= score) continue;
      if (score > bestScore) {
        bestScore = score;
        best = cls;
      }
    }
    return best;
  }

  function visitJsx(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const element = ts.isJsxElement(node) ? node.openingElement : node;
      const tagName = getTagName(element, ts);
      const primitive = tagName ? TAG_TO_PRIMITIVE[tagName] : null;

      if (primitive) {
        // Extract style + jsx props to compute signature
        let styleStatics = {};
        let dynamicKeys = [];
        let hasSpread = false;
        let styleObjNode = null;

        const attrs = element.attributes;
        if (attrs) {
          for (const attr of attrs.properties) {
            if (ts.isSpreadAssignment?.(attr) || ts.isJsxSpreadAttribute?.(attr)) {
              hasSpread = true;
              continue;
            }
            if (!ts.isJsxAttribute(attr)) continue;
            if (!attr.name || attr.name.text !== 'style') continue;
            const init = attr.initializer;
            if (init && ts.isJsxExpression(init) && init.expression &&
                ts.isObjectLiteralExpression(init.expression)) {
              const extracted = extractStyleProps(init.expression, ts);
              styleStatics = extracted.statics;
              dynamicKeys = extracted.dynamicKeys;
              hasSpread = extracted.hasSpread;
              styleObjNode = init.expression;
            }
          }
        }

        if (hasSpread || dynamicKeys.length > 0) {
          // Can't fully migrate — has dynamic or spread props
          ts.forEachChild(node, visitJsx);
          return;
        }

        injectFlexDirectionForTag(tagName, styleStatics);

        const jsxProps = extractJsxProps(element, ts);
        const sig = makeSignature(primitive, styleStatics, jsxProps);
        let match = bySig.get(sig);
        let isPartial = false;

        // If no exact match and partial mode is on, find partial match
        if (!match && partial) {
          match = findPartialMatch(primitive, styleStatics, jsxProps);
          if (match) isPartial = true;
        }

        if (match) {
          const cName = `${clsAlias}.${match.name}`;
          const removeProps = new Set(Object.keys(match.jsxProps));

          // Build new attributes string — keep props NOT in the classifier
          const keptAttrs = [];
          if (attrs) {
            for (const attr of attrs.properties) {
              if (ts.isJsxSpreadAttribute?.(attr)) {
                keptAttrs.push(source.slice(attr.getStart(sf), attr.getEnd()));
                continue;
              }
              if (!ts.isJsxAttribute(attr)) continue;
              if (!attr.name) continue;
              const aName = attr.name.text;

              if (aName === 'style') {
                if (isPartial && styleObjNode) {
                  // Partial match: keep style properties NOT covered by classifier
                  const coveredKeys = new Set(Object.keys(match.styleStatics));
                  const keptProps = [];
                  for (const prop of styleObjNode.properties) {
                    if (!ts.isPropertyAssignment(prop)) continue;
                    const pName = ts.isIdentifier(prop.name) ? prop.name.text
                                : ts.isStringLiteral(prop.name) ? prop.name.text : null;
                    if (!pName || coveredKeys.has(pName)) continue;
                    keptProps.push(source.slice(prop.getStart(sf), prop.getEnd()));
                  }
                  if (keptProps.length > 0) {
                    keptAttrs.push(`style={{ ${keptProps.join(', ')} }}`);
                  }
                }
                // For exact match: style is fully removed (already in classifier)
                continue;
              }
              if (removeProps.has(aName)) continue;
              keptAttrs.push(source.slice(attr.getStart(sf), attr.getEnd()));
            }
          }

          const attrStr = keptAttrs.length > 0 ? ' ' + keptAttrs.join(' ') : '';

          if (ts.isJsxSelfClosingElement(node)) {
            replacements.push({
              start: node.getStart(sf),
              end: node.getEnd(),
              text: `<${cName}${attrStr} />`,
            });
          } else {
            const opening = node.openingElement;
            const closing = node.closingElement;
            const childrenSrc = source.slice(opening.getEnd(), closing.getStart(sf));

            replacements.push({
              start: node.getStart(sf),
              end: node.getEnd(),
              text: `<${cName}${attrStr}>${childrenSrc}</${cName}>`,
            });
          }

          return;
        }
      }
    }
    ts.forEachChild(node, visitJsx);
  }

  visitJsx(sf);

  if (replacements.length === 0) return { changed: false, count: 0 };

  // Apply replacements from end to start
  replacements.sort((a, b) => b.start - a.start);
  let result = source;
  for (const r of replacements) {
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }

  // Always use 'S' as the classifier alias — never conflicts with palette 'C'
  const alias = 'S';

  // Rewrite all classifier refs we just wrote from clsAlias → S
  if (clsAlias !== alias) {
    result = result.replace(new RegExp(`<${clsAlias}\\.`, 'g'), `<${alias}.`)
                   .replace(new RegExp(`</${clsAlias}\\.`, 'g'), `</${alias}.`);
  }

  // Also convert any pre-existing C.Story* refs (from before migration)
  result = result.replace(/<C\.(Story\w+)/g, `<${alias}.$1`)
                 .replace(/<\/C\.(Story\w+)/g, `</${alias}.$1`);

  // Ensure classifiers import exists
  if (!result.includes('classifiers')) {
    const coreImportRe = /import\s*\{([^}]+)\}\s*from\s*'[^']*core[^']*'/;
    const coreMatch = result.match(coreImportRe);
    if (coreMatch && !coreMatch[1].includes('classifiers')) {
      const newImports = coreMatch[1].trimEnd().replace(/,\s*$/, '') + `, classifiers as ${alias}`;
      result = result.replace(coreMatch[1], newImports);
    } else if (!coreMatch) {
      // Find end of last import declaration via AST so multi-line imports
      // don't get bisected. Re-parse the original source — JSX replacements
      // happen below imports, so the import region's byte offsets are
      // unchanged in `result`.
      let lastImportEnd = 0;
      for (const stmt of sf.statements) {
        if (ts.isImportDeclaration(stmt)) {
          lastImportEnd = Math.max(lastImportEnd, stmt.getEnd());
        }
      }
      if (lastImportEnd > 0) {
        result = result.slice(0, lastImportEnd) +
          `\nimport { classifiers as ${alias} } from '@reactjit/core';` +
          result.slice(lastImportEnd);
      }
    }
  } else {
    // File already imports classifiers — rewrite its alias to S
    result = result.replace(/classifiers as \w+/g, `classifiers as ${alias}`);
    result = result.replace(/const \w+ = classifiers\b/g, `const ${alias} = classifiers`);
  }

  if (!dryRun) writeFileSync(filePath, result, 'utf-8');
  return { changed: true, count: replacements.length };
}

async function migrateCommand(args, ts) {
  const cwd = process.cwd();
  let scanDir = defaultScanDir(cwd);
  let clsPath = null;
  let partial = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') { scanDir = join(cwd, args[++i]); continue; }
    if (args[i] === '--cls') { clsPath = args[++i]; continue; }
    if (args[i] === '--partial') { partial = true; continue; }
    if (args[i] === '--dry-run') { dryRun = true; continue; }
  }

  if (!existsSync(scanDir)) {
    console.error(`  Directory not found: ${scanDir}`);
    process.exit(1);
  }

  // Find .cls.ts file
  if (!clsPath) {
    const { cls } = findRenameTargets(scanDir);
    if (cls.length === 0) {
      console.error(`  No .cls.ts file found in ${scanDir}. Run rjit classify first.`);
      process.exit(1);
    }
    clsPath = cls[0];
    if (cls.length > 1) {
      console.log(`  Multiple .cls.ts files found, using: ${relative(cwd, clsPath)}`);
    }
  }

  console.log(`\n  Migrating ${relative(cwd, scanDir) || '.'}/ using ${relative(cwd, clsPath)}`);

  // Parse classifier definitions
  const { bySig } = parseClsFile(clsPath, ts);
  console.log(`  Loaded ${bySig.size} classifier signatures\n`);

  // Find all TSX files (skip .cls.ts files)
  const { tsx } = findRenameTargets(scanDir);

  // Detect what alias files use for classifiers
  let totalReplacements = 0;
  const touchedFiles = [];

  for (const filePath of tsx) {
    const source = readFileSync(filePath, 'utf-8');
    // Skip files that are already fully classified (no inline primitives with style)
    const aliases = findClassifierAliases(source);
    const clsAlias = aliases.size > 0 ? [...aliases][0] : 'C';

    const { changed, count } = migrateFile(filePath, bySig, clsAlias, ts, partial, dryRun);
    if (changed) {
      totalReplacements += count;
      touchedFiles.push({ file: relative(cwd, filePath), count });
    }
  }

  if (touchedFiles.length === 0) {
    console.log(`  No inline styles matched any classifier.${partial ? '' : ' Try --partial for superset matching.'}\n`);
    return;
  }

  console.log(`  ${'File'.padEnd(55)} Replacements`);
  console.log(`  ${'─'.repeat(55)} ${'─'.repeat(12)}`);
  for (const { file, count } of touchedFiles.sort((a, b) => b.count - a.count)) {
    console.log(`  ${file.padEnd(55)} ${count}`);
  }
  console.log(`\n  Total: ${totalReplacements} inline styles → classifier references across ${touchedFiles.length} files.${dryRun ? '  (dry-run — no files written)' : ''}\n`);
}

// ── Pick mode helpers ─────────────────────────────────────────

/**
 * Format a compact trait summary for displaying a full style pattern.
 */
function formatTraits(styleStatics, jsxProps) {
  const parts = [];
  const s = styleStatics;
  if (s.backgroundColor) {
    const bg = String(s.backgroundColor);
    if (bg.includes('Elevated')) parts.push('bgElevated');
    else if (bg.includes('surface')) parts.push('surface');
    else if (bg.includes('bg')) parts.push('bg');
    else parts.push(`bg:${bg.slice(0, 15)}`);
  }
  if (s.borderRadius) parts.push(`r:${s.borderRadius}`);
  if (s.padding) parts.push(`p:${s.padding}`);
  else if (s.paddingLeft) parts.push(`pl:${s.paddingLeft}`);
  if (s.gap) parts.push(`gap:${s.gap}`);
  if (s.flexGrow) parts.push('grow');
  if (s.flexBasis === 0) parts.push('basis:0');
  if (s.flexShrink === 0) parts.push('shrink:0');
  if (s.width) parts.push(`w:${s.width}`);
  if (s.height != null) parts.push(`h:${s.height}`);
  if (s.borderBottomWidth) parts.push('borderBot');
  if (s.borderTopWidth) parts.push('borderTop');
  if (s.borderLeftWidth) parts.push('borderLeft');
  if (s.fontSize) parts.push(`${s.fontSize}px`);
  if (s.fontWeight === 'bold' || jsxProps.bold) parts.push('bold');
  if (s.color) {
    const c = String(s.color);
    if (c.includes('textDim') || c.includes('muted')) parts.push('muted');
    else if (c.includes('text')) parts.push('text');
    else if (c.includes('accent')) parts.push('accent');
    else parts.push(`color:${c.slice(0, 12)}`);
  }
  if (s.alignItems) parts.push(`align:${s.alignItems}`);
  if (s.justifyContent) parts.push(`justify:${s.justifyContent}`);
  const covered = new Set(['backgroundColor', 'borderRadius', 'padding', 'paddingLeft',
    'paddingRight', 'paddingTop', 'paddingBottom', 'gap', 'flexGrow', 'flexBasis',
    'flexShrink', 'width', 'height', 'borderBottomWidth', 'borderTopWidth',
    'borderLeftWidth', 'color', 'fontSize', 'fontWeight', 'borderColor',
    'alignItems', 'justifyContent']);
  for (const k of Object.keys(s)) {
    if (!covered.has(k)) parts.push(`${k}:${JSON.stringify(s[k]).slice(0, 10)}`);
  }
  for (const [k, v] of Object.entries(jsxProps)) {
    if (k !== 'bold') parts.push(`${k}:${JSON.stringify(v).slice(0, 10)}`);
  }
  return parts.join(', ');
}

/**
 * Generate a classifier entry string for a picked pattern.
 */
function generatePickEntry(p) {
  const { name, primitive, styleStatics, jsxProps, matches } = p;
  const parts = [`type: '${primitive}'`];

  if (primitive === 'Text') {
    const remaining = { ...styleStatics };
    if (remaining.fontSize != null) { parts.push(`size: ${remaining.fontSize}`); delete remaining.fontSize; }
    if (remaining.fontWeight === 'bold') { parts.push(`bold: true`); delete remaining.fontWeight; }
    if (remaining.color != null) { parts.push(`color: ${formatValue(remaining.color)}`); delete remaining.color; }
    for (const [k, v] of Object.entries(jsxProps)) {
      if (k !== 'size' && k !== 'bold' && k !== 'color') parts.push(`${k}: ${formatValue(v)}`);
    }
    const remKeys = Object.keys(remaining);
    if (remKeys.length > 0) {
      const styleParts = remKeys.map(k => `${k}: ${formatValue(remaining[k])}`);
      parts.push(`style: { ${styleParts.join(', ')} }`);
    }
  } else {
    for (const [k, v] of Object.entries(jsxProps)) {
      parts.push(`${k}: ${formatValue(v)}`);
    }
    const styleKeys = Object.keys(styleStatics);
    if (styleKeys.length > 0) {
      const styleParts = styleKeys.map(k => `${k}: ${formatValue(styleStatics[k])}`);
      if (styleParts.length <= 3) {
        parts.push(`style: { ${styleParts.join(', ')} }`);
      } else {
        parts.push(`style: {\n      ${styleParts.join(',\n      ')},\n    }`);
      }
    }
  }

  return `  // ${matches.length} occurrences\n  ${name}: { ${parts.join(', ')} },`;
}

/**
 * Append new classifier entries to an existing .cls.ts file.
 * Inserts before the final `});` that closes the classifier() call.
 */
function appendEntries(clsPath, entries) {
  const source = readFileSync(clsPath, 'utf-8');
  const lastClose = source.lastIndexOf('});');
  if (lastClose === -1) {
    console.error('  Could not find closing }); in .cls.ts file.');
    process.exit(1);
  }
  const before = source.slice(0, lastClose);
  const after = source.slice(lastClose);
  const insert = '\n' + entries.join('\n\n') + '\n';
  writeFileSync(clsPath, before + insert + after, 'utf-8');
}

// ── Add command (non-interactive) ─────────────────────────────

/**
 * Non-interactive classifier add: name a pattern, append to .cls.ts, auto-migrate.
 *
 * Usage:
 *   rjit classify add <Name> '<json_definition>'
 *   rjit classify add SurfaceCard '{"type":"Box","style":{"backgroundColor":"theme:surface","borderWidth":1,"borderColor":"theme:border"}}'
 *   rjit classify add MutedCaption '{"type":"Text","size":9,"color":"theme:textDim"}'
 */
async function addCommand(args, ts) {
  const cwd = process.cwd();
  let scanDir = defaultScanDir(cwd);
  let clsPath = null;
  let noMigrate = false;
  let dryRun = false;

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') { scanDir = join(cwd, args[++i]); continue; }
    if (args[i] === '--cls') { clsPath = args[++i]; continue; }
    if (args[i] === '--no-migrate') { noMigrate = true; continue; }
    if (args[i] === '--dry-run') { dryRun = true; continue; }
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
  rjit classify add — Add a single classifier and auto-migrate

  Usage:
    rjit classify add <Name> '<json_definition>'

  Examples:
    rjit classify add SurfaceCard '{"type":"Box","style":{"backgroundColor":"theme:surface","borderWidth":1,"borderColor":"theme:border"}}'
    rjit classify add MutedCaption '{"type":"Text","size":9,"color":"theme:textDim"}'
    rjit classify add InlineG4 '{"type":"Box","style":{"flexDirection":"row","gap":4,"alignItems":"center"}}'

  The JSON definition uses the same format as classifier() entries:
    - type: primitive name (Box, Text, Image, Pressable, ScrollView, Input, Video, Row, Col)
    - style: { ... } for CSS-like style properties
    - For Text: size, bold, color are top-level (not inside style)
    - Use 'theme:X' strings for theme tokens (theme:text, theme:textDim, theme:surface, etc.)

  Options:
    --dir <path>      Scan directory for migration (default: src/)
    --cls <path>      Target .cls.ts file (default: auto-detect or app.cls.ts)
    --no-migrate      Skip auto-migration after adding
    --dry-run         Show what would be added without writing
`);
      return;
    }
    positional.push(args[i]);
  }

  if (positional.length < 2) {
    console.error('  Usage: rjit classify add <Name> \'<json_definition>\'');
    process.exit(1);
  }

  const name = positional[0];
  const defStr = positional.slice(1).join(' ');

  // Validate name
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    console.error(`  Name must be PascalCase (e.g., MyPanel): "${name}"`);
    process.exit(1);
  }

  // Parse definition
  let def;
  try {
    def = JSON.parse(defStr);
  } catch (e) {
    console.error(`  Invalid JSON definition: ${e.message}`);
    console.error(`  Got: ${defStr}`);
    process.exit(1);
  }

  const primitive = def.type;
  if (!primitive || !CLASSIFIER_PRIMITIVES.has(primitive)) {
    console.error(`  Invalid type "${primitive}". Valid: ${[...CLASSIFIER_PRIMITIVES].join(', ')}`);
    process.exit(1);
  }

  // Build styleStatics and jsxProps for signature matching
  const styleStatics = { ...(def.style || {}) };
  const jsxProps = {};

  for (const [k, v] of Object.entries(def)) {
    if (k === 'type' || k === 'style' || k === 'use') continue;
    if (primitive === 'Text') {
      if (k === 'size') { styleStatics.fontSize = v; continue; }
      if (k === 'bold' && v === true) { styleStatics.fontWeight = 'bold'; continue; }
      if (k === 'color') { styleStatics.color = v; continue; }
    }
    jsxProps[k] = v;
  }

  // Count matches in codebase (both exact and partial)
  let exactCount = 0;
  let partialCount = 0;
  let matchFileCount = 0;
  if (existsSync(scanDir)) {
    const sig = makeSignature(primitive, styleStatics, jsxProps);
    const { elements } = scanElements(scanDir, ts);
    const matchFiles = new Set();
    for (const el of elements) {
      if (el.primitive !== primitive) continue;
      const elSig = makeSignature(el.primitive, el.styleStatics, el.jsxProps);
      if (elSig === sig) {
        exactCount++;
        matchFiles.add(el.file);
      } else {
        // Partial: all classifier props must exist in element with matching values
        let isPartial = true;
        for (const [k, v] of Object.entries(styleStatics)) {
          if (el.styleStatics[k] === undefined || JSON.stringify(el.styleStatics[k]) !== JSON.stringify(v)) {
            isPartial = false; break;
          }
        }
        if (isPartial) {
          for (const [k, v] of Object.entries(jsxProps)) {
            if (el.jsxProps[k] === undefined || JSON.stringify(el.jsxProps[k]) !== JSON.stringify(v)) {
              isPartial = false; break;
            }
          }
        }
        if (isPartial) {
          partialCount++;
          matchFiles.add(el.file);
        }
      }
    }
    matchFileCount = matchFiles.size;
  }
  const matchCount = exactCount + partialCount;

  // Generate the entry — styleStatics for generatePickEntry must include
  // Text shorthand props (size→fontSize, bold→fontWeight, color) so the
  // output renders them correctly as top-level classifier fields.
  const entryStyleStatics = { ...(def.style || {}) };
  const entryJsxProps = {};
  for (const [k, v] of Object.entries(def)) {
    if (k === 'type' || k === 'style' || k === 'use') continue;
    if (primitive === 'Text') {
      if (k === 'size') { entryStyleStatics.fontSize = v; continue; }
      if (k === 'bold' && v === true) { entryStyleStatics.fontWeight = 'bold'; continue; }
      if (k === 'color') { entryStyleStatics.color = v; continue; }
    }
    entryJsxProps[k] = v;
  }

  const entry = generatePickEntry({
    name,
    primitive,
    styleStatics: entryStyleStatics,
    jsxProps: entryJsxProps,
    matches: new Array(matchCount),
  });

  // Find or create .cls.ts (needed for duplicate check before dry-run)
  if (!clsPath) {
    if (existsSync(scanDir)) {
      const { cls } = findRenameTargets(scanDir);
      clsPath = cls.length > 0 ? cls[0] : null;
    }
    // Fall back: look in cwd for any .cls.ts
    if (!clsPath) {
      try {
        const cwdEntries = readdirSync(cwd);
        const found = cwdEntries.find(e => e.endsWith('.cls.ts'));
        if (found) clsPath = join(cwd, found);
      } catch {}
    }
    if (!clsPath) {
      clsPath = join(cwd, 'app.cls.ts');
    }
  }

  // Check for duplicate name
  if (existsSync(clsPath)) {
    const existing = readFileSync(clsPath, 'utf-8');
    const nameRe = new RegExp(`^\\s*${name}\\s*:`, 'm');
    if (nameRe.test(existing)) {
      console.error(`  Classifier "${name}" already exists in ${relative(cwd, clsPath)}`);
      process.exit(1);
    }
  }

  console.log(`\n  ${name}: ${primitive}`);
  const traits = formatTraits(styleStatics, jsxProps);
  if (traits) console.log(`    ${traits}`);
  console.log(`    ${exactCount} exact + ${partialCount} partial = ${matchCount} matches across ${matchFileCount} files`);

  if (dryRun) {
    console.log(`\n  Entry that would be added:\n${entry}\n`);
    return;
  }

  if (existsSync(clsPath)) {
    appendEntries(clsPath, [entry]);
  } else {
    const content = [
      `import { classifier } from '@reactjit/core';`,
      ``,
      `classifier({`,
      entry,
      `});`,
      ``,
    ].join('\n');
    writeFileSync(clsPath, content, 'utf-8');
  }

  console.log(`  Written to ${relative(cwd, clsPath)}`);

  // Auto-migrate (always uses partial matching — the whole point of `add` is partial patterns)
  if (!noMigrate && existsSync(scanDir)) {
    console.log(`  Running migration (partial)...`);
    const { bySig } = parseClsFile(clsPath, ts);
    const { tsx } = findRenameTargets(scanDir);
    let totalReplacements = 0;
    const touchedFiles = [];

    for (const filePath of tsx) {
      const source = readFileSync(filePath, 'utf-8');
      const aliases = findClassifierAliases(source);
      const clsAlias = aliases.size > 0 ? [...aliases][0] : 'S';
      const { changed, count } = migrateFile(filePath, bySig, clsAlias, ts, true);
      if (changed) {
        totalReplacements += count;
        touchedFiles.push({ file: relative(cwd, filePath), count });
      }
    }

    if (touchedFiles.length > 0) {
      console.log(`  Migrated ${totalReplacements} inline styles across ${touchedFiles.length} files:`);
      for (const { file, count } of touchedFiles.sort((a, b) => b.count - a.count)) {
        console.log(`    ${file.padEnd(55)} ${count}`);
      }
    } else {
      console.log(`  No inline styles matched for migration.`);
    }
  }

  console.log('');
}

// ── Partial pattern mining (frequent itemset analysis) ────────

function binarySearchIdx(arr, val) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === val) return true;
    if (arr[mid] < val) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/**
 * Mine frequent style property subsets using Apriori algorithm.
 * Finds recurring partial patterns across elements with different full styles.
 * Only reports subsets that appear in multiple distinct exact-match groups (spread > 1).
 */
function minePartialPatterns(elements, minOccurrences, maxSize) {
  const byPrim = {};
  for (const el of elements) {
    if (!byPrim[el.primitive]) byPrim[el.primitive] = [];
    byPrim[el.primitive].push(el);
  }

  const allResults = [];

  for (const [primitive, els] of Object.entries(byPrim)) {
    // Each element → set of "key=value" items
    const transactions = els.map(el => {
      const items = new Set();
      for (const [k, v] of Object.entries(el.styleStatics)) {
        items.add(`s:${k}=${JSON.stringify(v)}`);
      }
      for (const [k, v] of Object.entries(el.jsxProps)) {
        items.add(`p:${k}=${JSON.stringify(v)}`);
      }
      return items;
    });

    // Full signatures for measuring spread across exact-match groups
    const fullSigs = els.map(el =>
      makeSignature(el.primitive, el.styleStatics, el.jsxProps)
    );

    // Level 1: count individual items
    const itemFreq = new Map();
    for (const t of transactions) {
      for (const item of t) {
        itemFreq.set(item, (itemFreq.get(item) || 0) + 1);
      }
    }

    // Frequent 1-items (sorted for deterministic candidate generation)
    const freq1 = [...itemFreq.entries()]
      .filter(([, c]) => c >= minOccurrences)
      .sort(([a], [b]) => a < b ? -1 : 1)
      .map(([item]) => item);

    if (freq1.length === 0) continue;

    const itemIdx = new Map();
    freq1.forEach((item, i) => itemIdx.set(item, i));

    // Convert transactions to sorted index arrays for fast subset checks
    const txIdx = transactions.map(t => {
      const arr = [];
      for (const item of t) {
        const idx = itemIdx.get(item);
        if (idx !== undefined) arr.push(idx);
      }
      return arr.sort((a, b) => a - b);
    });

    // Apriori: build levels 2..maxSize
    let prevLevel = freq1.map((_, i) => [i]);

    for (let k = 2; k <= maxSize && prevLevel.length > 0; k++) {
      // Generate candidates: merge (k-1)-itemsets sharing first k-2 items
      const candidates = [];
      for (let i = 0; i < prevLevel.length; i++) {
        for (let j = i + 1; j < prevLevel.length; j++) {
          const a = prevLevel[i];
          const b = prevLevel[j];
          let ok = true;
          for (let x = 0; x < k - 2; x++) {
            if (a[x] !== b[x]) { ok = false; break; }
          }
          if (!ok) continue;
          candidates.push([...a, b[k - 2]]);
        }
      }

      // Safety cap to avoid OOM on pathological inputs
      if (candidates.length > 50000) break;

      const nextLevel = [];
      for (const cand of candidates) {
        let count = 0;
        const sigs = new Set();
        const files = new Set();

        for (let ti = 0; ti < txIdx.length; ti++) {
          const tx = txIdx[ti];
          let all = true;
          for (const idx of cand) {
            if (!binarySearchIdx(tx, idx)) { all = false; break; }
          }
          if (all) {
            count++;
            sigs.add(fullSigs[ti]);
            files.add(els[ti].file);
          }
        }

        if (count >= minOccurrences) {
          nextLevel.push(cand);
          // Only report patterns spanning multiple distinct full-match groups
          if (sigs.size > 1) {
            const styleStatics = {};
            const jsxProps = {};
            for (const idx of cand) {
              const item = freq1[idx];
              const isStyle = item.startsWith('s:');
              const rest = item.slice(2);
              const eq = rest.indexOf('=');
              const key = rest.slice(0, eq);
              const val = JSON.parse(rest.slice(eq + 1));
              if (isStyle) styleStatics[key] = val;
              else jsxProps[key] = val;
            }
            allResults.push({
              primitive,
              styleStatics,
              jsxProps,
              count,
              spread: sigs.size,
              fileCount: files.size,
              size: k,
            });
          }
        }
      }
      prevLevel = nextLevel;
    }
  }

  // Score: frequency × sqrt(size) — rewards both coverage and specificity
  allResults.sort((a, b) => {
    const sa = a.count * Math.sqrt(a.size);
    const sb = b.count * Math.sqrt(b.size);
    return sb - sa;
  });

  return allResults;
}

/**
 * Filter dominated patterns: remove pattern P if a strict superset Q exists
 * with >= 90% of P's support. Q is more specific and covers nearly the same
 * elements, so P is redundant noise.
 *
 * Also handles exact closedness (superset with equal support) as a special case.
 */
function filterDominatedPatterns(patterns) {
  const itemSets = patterns.map(p => new Set([
    ...Object.entries(p.styleStatics).map(([k, v]) => `s:${k}=${JSON.stringify(v)}`),
    ...Object.entries(p.jsxProps).map(([k, v]) => `p:${k}=${JSON.stringify(v)}`),
  ]));

  const dominated = new Set();
  for (let i = 0; i < patterns.length; i++) {
    if (dominated.has(i)) continue;
    const p = patterns[i];
    const pItems = itemSets[i];
    for (let j = 0; j < patterns.length; j++) {
      if (i === j || dominated.has(j)) continue;
      const q = patterns[j];
      if (q.primitive !== p.primitive) continue;
      if (q.size <= p.size) continue;
      // Q must cover >= 90% of P's elements to dominate
      if (q.count < p.count * 0.9) continue;
      // Check if Q ⊃ P (Q is a strict superset)
      const qItems = itemSets[j];
      let isSuperset = true;
      for (const k of pItems) {
        if (!qItems.has(k)) { isSuperset = false; break; }
      }
      if (isSuperset) { dominated.add(i); break; }
    }
  }

  return patterns.filter((_, i) => !dominated.has(i));
}

/**
 * Build a JSON definition string for `rjit classify add`.
 */
function buildAddCommand(primitive, styleStatics, jsxProps) {
  const def = { type: primitive };
  if (primitive === 'Text') {
    if (styleStatics.fontSize != null) def.size = styleStatics.fontSize;
    if (styleStatics.fontWeight === 'bold') def.bold = true;
    if (styleStatics.color != null) def.color = styleStatics.color;
    const remaining = {};
    for (const [k, v] of Object.entries(styleStatics)) {
      if (k !== 'fontSize' && k !== 'fontWeight' && k !== 'color') remaining[k] = v;
    }
    if (Object.keys(remaining).length > 0) def.style = remaining;
  } else {
    if (Object.keys(styleStatics).length > 0) def.style = styleStatics;
  }
  for (const [k, v] of Object.entries(jsxProps)) def[k] = v;
  return JSON.stringify(def);
}

async function partialCommand(args, ts) {
  const cwd = process.cwd();
  let scanDir = defaultScanDir(cwd);
  let minOccurrences = 10;
  let maxSize = 12;
  let top = 40;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') { scanDir = join(cwd, args[++i]); continue; }
    if (args[i] === '--min') { minOccurrences = parseInt(args[++i], 10); continue; }
    if (args[i] === '--max-size') { maxSize = parseInt(args[++i], 10); continue; }
    if (args[i] === '--top') { top = parseInt(args[++i], 10); continue; }
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
  rjit classify partial — Find recurring partial style patterns

  Discovers style property subsets that recur across elements with different
  full styles. Unlike the default mode (which requires ALL properties to
  match), this finds partial overlaps — the building blocks that appear
  in many different contexts.

  Usage:
    rjit classify partial                   Analyze src/
    rjit classify partial --dir ./stories   Analyze a specific directory
    rjit classify partial --min 15          Minimum occurrences (default: 10)
    rjit classify partial --max-size 4      Max properties per pattern (default: 12)
    rjit classify partial --top 20          Show top N patterns (default: 40)

  Output columns:
    Props   — number of style properties in the pattern
    Hits    — total elements containing this property subset
    Spread  — how many distinct full patterns contain it
    Files   — how many source files

  To add a discovered pattern as a classifier:
    rjit classify add <Name> '<json_definition>'
`);
      return;
    }
  }

  if (!existsSync(scanDir)) {
    console.error(`  Directory not found: ${scanDir}`);
    process.exit(1);
  }

  console.log(`\n  Scanning ${relative(cwd, scanDir) || '.'}/ for partial style patterns...`);
  const { elements, fileCount } = scanElements(scanDir, ts);
  console.log(`  Found ${elements.length} classifiable elements across ${fileCount} files.`);
  console.log(`  Mining frequent property subsets (min: ${minOccurrences})...`);

  if (elements.length === 0) {
    console.log('  Nothing to analyze.\n');
    return;
  }

  const raw = minePartialPatterns(elements, minOccurrences, maxSize);
  const patterns = filterDominatedPatterns(raw);

  if (patterns.length === 0) {
    console.log(`  No partial patterns found with ${minOccurrences}+ occurrences spanning multiple groups.`);
    console.log(`  Try lowering --min.\n`);
    return;
  }

  const shown = patterns.slice(0, top);

  console.log(`\n  ── Partial Patterns (${patterns.length} found, showing top ${shown.length}) ──\n`);
  console.log(`  ${'#'.padStart(4)}  ${'Props'.padStart(5)}  ${'Hits'.padStart(5)}  ${'Spread'.padStart(6)}  ${'Files'.padStart(5)}  Pattern`);
  console.log(`  ${'─'.repeat(4)}  ${'─'.repeat(5)}  ${'─'.repeat(5)}  ${'─'.repeat(6)}  ${'─'.repeat(5)}  ${'─'.repeat(50)}`);

  for (let i = 0; i < shown.length; i++) {
    const p = shown[i];
    // Show ALL properties explicitly (formatTraits hides some)
    const allProps = [];
    for (const [k, v] of Object.entries(p.styleStatics)) {
      const vs = typeof v === 'string' ? (v.length > 20 ? `'${v.slice(0, 17)}…'` : `'${v}'`) : v;
      allProps.push(`${k}: ${vs}`);
    }
    for (const [k, v] of Object.entries(p.jsxProps)) {
      const vs = typeof v === 'string' ? (v.length > 20 ? `'${v.slice(0, 17)}…'` : `'${v}'`) : v;
      allProps.push(`${k}: ${vs}`);
    }
    console.log(
      `  ${String(i + 1).padStart(4)}  ${String(p.size).padStart(5)}  ` +
      `${String(p.count).padStart(5)}  ${String(p.spread).padStart(6)}  ` +
      `${String(p.fileCount).padStart(5)}  ${p.primitive}: ${allProps.join(', ')}`
    );
  }

  // Show add commands for top patterns
  const exCount = Math.min(5, shown.length);
  console.log(`\n  ── Quick-add commands for top ${exCount} ──\n`);
  for (let i = 0; i < exCount; i++) {
    const p = shown[i];
    const name = suggestName(p.primitive, p.styleStatics, p.jsxProps, '')
      .replace(/%/g, 'Pct').replace(/[^A-Za-z0-9]/g, '');
    const json = buildAddCommand(p.primitive, p.styleStatics, p.jsxProps);
    console.log(`  rjit classify add ${name} '${json}'`);
  }
  console.log('');
}

// ── Pick command ──────────────────────────────────────────────

async function pickCommand(args, ts) {
  const cwd = process.cwd();
  let scanDir = defaultScanDir(cwd);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') { scanDir = join(cwd, args[++i]); continue; }
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
  rjit classify pick — Interactive pattern picker

  Usage:
    rjit classify pick                    Scan src/ interactively
    rjit classify pick --dir ./stories    Scan a specific directory
    rjit classify pick --cls my.cls.ts    Append to a specific .cls.ts file

  Flow:
    1. Pick a primitive (Box, Text, Row, ...)
    2. Pick style properties to filter by
    3. Pick a value combination
    4. See exact patterns + file locations
    5. Name each pattern
    6. Writes to .cls.ts and auto-migrates inline styles

  Type 'q' at any prompt to quit early.
 `);
      return;
    }
  }
  const message = [
    '[classify] pick is currently unavailable under v8cli.',
    'This command requires an interactive stdin readline bridge that is not exposed yet.',
    'Use non-interactive commands (`theme`, `partial`, `add`, `migrate`, `rename`) or run the Bun/node script.',
  ].join('\n');
  console.error(message);
  if (typeof __exit === 'function') __exit(1);
  if (typeof process.exit === 'function') process.exit(1);
  throw new Error(message);
}

// ── Theme token mining ───────────────────────────────────────
//
// Walks every style object in the scanned TSX, buckets literal values by
// category (color / radius / spacing / border / font), counts occurrences,
// and prints a ranked suggestion table. Read-only by design — output is
// meant to inform the theme palette you pass to ThemeProvider. Pass
// --emit <file> to additionally write a starter palette snippet (the
// --dry-run flag gates only that emit, since the scan itself is read-only).

const THEME_CATEGORIES = {
  color: (k) => /color$/i.test(k) || k === 'backgroundColor' || k === 'tintColor',
  radius: (k) => /Radius$/.test(k),
  spacing: (k) => /^(padding|margin|gap|rowGap|columnGap|top|left|right|bottom|width|height)(Top|Right|Bottom|Left|Horizontal|Vertical|Start|End)?$/.test(k),
  border: (k) => /^border(Top|Right|Bottom|Left)?Width$/.test(k),
  font: (k) => k === 'fontSize' || k === 'lineHeight',
};

function classifyKey(k) {
  for (const [cat, match] of Object.entries(THEME_CATEGORIES)) {
    if (match(k)) return cat;
  }
  return null;
}

function isColorLiteral(v) {
  if (typeof v !== 'string') return false;
  return /^#[0-9a-fA-F]{3,8}$/.test(v) || /^rgba?\(/i.test(v) || /^hsla?\(/i.test(v);
}

function isNumericLiteral(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function suggestTokenName(category, value, usedNames) {
  // Base stem per category.
  const stems = { color: 'color', radius: 'radius', spacing: 'space', border: 'border', font: 'font' };
  const stem = stems[category] || 'token';

  // Numeric values → appendSize tier if in a common range.
  let base;
  if (category === 'radius' || category === 'border') {
    base = value <= 2 ? `${stem}Sm` : value <= 8 ? `${stem}Md` : `${stem}Lg`;
  } else if (category === 'spacing') {
    base = value <= 4 ? `${stem}Xs` : value <= 8 ? `${stem}Sm` : value <= 16 ? `${stem}Md` : value <= 24 ? `${stem}Lg` : `${stem}Xl`;
  } else if (category === 'font') {
    base = value <= 12 ? `${stem}Sm` : value <= 16 ? `${stem}Md` : `${stem}Lg`;
  } else {
    // Color: try hex short form without #.
    const short = String(value).replace('#', '').replace(/[(),\s%]/g, '').toLowerCase();
    base = `${stem}${short.slice(0, 6)}`;
  }

  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  // Deduplicate with a numeric suffix.
  let i = 2;
  while (usedNames.has(`${base}${i}`)) i++;
  const name = `${base}${i}`;
  usedNames.add(name);
  return name;
}

function scanThemeTokens(scanDir, ts) {
  const files = findTsxFiles(scanDir);
  const buckets = { color: new Map(), radius: new Map(), spacing: new Map(), border: new Map(), font: new Map() };
  let styleObjCount = 0;

  for (const filePath of files) {
    let source;
    try { source = readFileSync(filePath, 'utf-8'); } catch { continue; }
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const visit = (node) => {
      // `style={{ ... }}` attribute
      if (ts.isJsxAttribute(node) && node.name && node.name.text === 'style' &&
          node.initializer && ts.isJsxExpression(node.initializer) &&
          node.initializer.expression && ts.isObjectLiteralExpression(node.initializer.expression)) {
        styleObjCount++;
        const { statics } = extractStyleProps(node.initializer.expression, ts);
        for (const [k, v] of Object.entries(statics)) {
          const cat = classifyKey(k);
          if (!cat) continue;
          // Skip values that are already theme tokens (they arrive verbatim from extractValue).
          if (typeof v === 'string' && v.startsWith('theme:')) continue;
          if (cat === 'color' && !isColorLiteral(v)) continue;
          if (cat !== 'color' && !isNumericLiteral(v)) continue;
          const bucket = buckets[cat];
          const key = typeof v === 'string' ? v.toLowerCase() : v;
          if (!bucket.has(key)) bucket.set(key, { value: v, count: 0, props: new Map(), files: new Set() });
          const entry = bucket.get(key);
          entry.count++;
          entry.props.set(k, (entry.props.get(k) || 0) + 1);
          entry.files.add(relative(process.cwd(), filePath));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { buckets, files: files.length, styleObjCount };
}

function formatThemeReport(buckets, minOcc) {
  const lines = [];
  const categoryOrder = ['color', 'radius', 'spacing', 'border', 'font'];
  const used = new Set();

  let total = 0;
  for (const cat of categoryOrder) {
    const bucket = buckets[cat];
    const rows = [...bucket.values()]
      .filter((e) => e.count >= minOcc)
      .sort((a, b) => b.count - a.count);
    if (rows.length === 0) continue;

    lines.push(`\n  ── ${cat.toUpperCase()} ${`(${rows.length} candidates)`.padStart(20 - cat.length)}`);
    lines.push(`  ${'suggested'.padEnd(18)} ${'value'.padEnd(14)} ${'hits'.padStart(5)}  props (top)`);
    lines.push(`  ${'─'.repeat(18)} ${'─'.repeat(14)} ${'─'.repeat(5)}  ${'─'.repeat(40)}`);
    for (const row of rows) {
      total += row.count;
      const name = suggestTokenName(cat, row.value, used);
      const topProps = [...row.props.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, n]) => `${k}×${n}`)
        .join(', ');
      const valStr = String(row.value);
      lines.push(`  ${name.padEnd(18)} ${valStr.padEnd(14)} ${String(row.count).padStart(5)}  ${topProps}`);
    }
  }

  if (total === 0) return '\n  No recurring literal style values found above the threshold.\n';
  return lines.join('\n') + `\n\n  ${total} literal uses could collapse into theme tokens.\n`;
}

function generateThemePaletteSnippet(buckets, minOcc) {
  const used = new Set();
  const colors = {};
  const styles = {};
  const categoryOrder = ['color', 'radius', 'spacing', 'border', 'font'];

  for (const cat of categoryOrder) {
    const bucket = buckets[cat];
    const rows = [...bucket.values()]
      .filter((e) => e.count >= minOcc)
      .sort((a, b) => b.count - a.count);
    for (const row of rows) {
      const name = suggestTokenName(cat, row.value, used);
      if (cat === 'color') colors[name] = row.value;
      else styles[name] = row.value;
    }
  }

  const lines = [
    '// Suggested theme tokens — generated by `rjit classify theme`.',
    '// Merge into your ThemeProvider colors/styles or applyPreset().',
    '',
    'export const suggestedColors = ' + JSON.stringify(colors, null, 2) + ';',
    '',
    'export const suggestedStyles = ' + JSON.stringify(styles, null, 2) + ';',
    '',
  ];
  return lines.join('\n');
}

async function themeCommand(args, ts) {
  const cwd = process.cwd();
  let scanDir = defaultScanDir(cwd);
  let minOccurrences = 3;
  let emitPath = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') { scanDir = join(cwd, args[++i]); continue; }
    if (args[i] === '--min') { minOccurrences = parseInt(args[++i], 10); continue; }
    if (args[i] === '--emit') { emitPath = args[++i]; continue; }
    if (args[i] === '--dry-run') { dryRun = true; continue; }
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`\n  rjit classify theme — suggest theme tokens from recurring style literals\n`);
      console.log(`    --dir <path>      Scan directory (default: cart/ or src/)`);
      console.log(`    --min <n>         Minimum occurrences to suggest (default: 3)`);
      console.log(`    --emit <file>     Also write a palette snippet to <file>`);
      console.log(`    --dry-run         With --emit, show what would be written\n`);
      return;
    }
  }

  if (!existsSync(scanDir)) {
    console.error(`  Directory not found: ${scanDir}`);
    process.exit(1);
  }

  console.log(`\n  Scanning ${relative(cwd, scanDir) || '.'}/ for repeated style literals (min ${minOccurrences})...`);
  const { buckets, files, styleObjCount } = scanThemeTokens(scanDir, ts);
  console.log(`  ${files} files · ${styleObjCount} style objects\n`);
  console.log(formatThemeReport(buckets, minOccurrences));

  if (emitPath) {
    const snippet = generateThemePaletteSnippet(buckets, minOccurrences);
    if (dryRun) {
      console.log(`  (dry-run) Would write ${snippet.length} bytes to: ${emitPath}\n`);
    } else {
      writeFileSync(emitPath, snippet, 'utf-8');
      console.log(`  Snippet written to: ${emitPath}\n`);
    }
  }
}

// ── Public API ───────────────────────────────────────────────

async function classifyCommand(args) {
  // Route subcommands
  if (args[0] === 'rename') {
    return renameCommand(args.slice(1));
  }

  const cwd = process.cwd();
  let ts;
  try {
    ts = loadTypeScript();
  } catch (err) {
    console.error('  Failed to load vendored TypeScript:', err?.stack || err?.message || err);
    process.exit(1);
  }

  if (args[0] === 'migrate') {
    return migrateCommand(args.slice(1), ts);
  }

  if (args[0] === 'pick') {
    return pickCommand(args.slice(1), ts);
  }

  if (args[0] === 'add') {
    return addCommand(args.slice(1), ts);
  }

  if (args[0] === 'partial') {
    return partialCommand(args.slice(1), ts);
  }

  if (args[0] === 'theme') {
    return themeCommand(args.slice(1), ts);
  }

  // Parse args
  let outputPath = join(cwd, 'app.cls.ts');
  let minOccurrences = 2;
  let prefix = '';
  let scanDir = defaultScanDir(cwd);
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') { outputPath = args[++i]; continue; }
    if (args[i] === '--min') { minOccurrences = parseInt(args[++i], 10); continue; }
    if (args[i] === '--prefix') { prefix = args[++i]; continue; }
    if (args[i] === '--dir') { scanDir = join(cwd, args[++i]); continue; }
    if (args[i] === '--dry-run') { dryRun = true; continue; }
  }

  if (!existsSync(scanDir)) {
    console.error(`  Directory not found: ${scanDir}`);
    process.exit(1);
  }

  console.log(`\n  Scanning ${relative(cwd, scanDir) || '.'}/ for classifier patterns...`);

  const { groups, fileCount } = scanPatterns(scanDir, ts, minOccurrences);

  if (groups.length === 0) {
    console.log(`  No repeated patterns found (min: ${minOccurrences} occurrences).`);
    return;
  }

  // Apply semantic naming
  for (const group of groups) {
    group.suggestedName = suggestName(group.primitive, group.styleStatics, group.jsxProps, prefix);
  }
  deduplicateNames(groups);

  // Sanitize all names to valid JS identifiers
  for (const group of groups) {
    group.suggestedName = group.suggestedName.replace(/%/g, 'Pct').replace(/[^A-Za-z0-9]/g, '');
  }

  // Fold near-duplicate siblings (≤2 differing fields, same primitive,
  // name-prefix relationship) into the parent as `.Suffix` appendages.
  clusterAppendages(groups);
  const appendageCount = groups.filter(g => g.isAppendage).length;
  if (appendageCount > 0) {
    console.log(`  Folded ${appendageCount} near-duplicate sibling(s) into parent classifiers as .Suffix appendages.`);
  }

  // Print report
  console.log(generateReport(groups, fileCount));

  // Write file
  const content = generateClsFile(groups, prefix);
  if (dryRun) {
    console.log(`  (dry-run) Would write ${content.length} bytes to: ${outputPath}`);
    console.log(`  (dry-run) Pass without --dry-run to write.`);
  } else {
    writeFileSync(outputPath, content, 'utf-8');
    console.log(`  Written to: ${outputPath}`);
    console.log(`  Import it at your app entry: import './${basename(outputPath).replace('.ts', '')}';`);
  }

  console.log('');
}

export async function run(argv) {
  try {
    await classifyCommand(argv);
    return 0;
  } catch (err) {
    console.error(err);
    return 1;
  }
}
