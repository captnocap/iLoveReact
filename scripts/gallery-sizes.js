// scripts/gallery-sizes.js — print the on-launch size of every gallery component.
//
// Static read of cart/app/gallery/components/<name>/*.tsx. For each component
// we find the root JSX element and extract width/height from its `className`
// (Tailwind) or inline `style` prop. Percentage / viewport values resolve
// against the launch window (1280 x 800). No runtime, no measurement hook.
//
// Also scans cart/app/gallery/stories/*.story.tsx for variant render funcs;
// per-variant root sizes get their own section + roll into the summary.
//
// Run:  ./tools/v8cli scripts/gallery-sizes.js
//       ./tools/v8cli scripts/gallery-sizes.js --json

const WIN_W = 1280;
const WIN_H = 800;
const COMPONENTS_DIR = 'cart/app/gallery/components';
const STORIES_DIR = 'cart/app/gallery/stories';

function argv() {
  const raw = typeof __argv === 'function' ? __argv() : __argv;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {}
    return raw ? [raw] : [];
  }
  return [];
}

const args = argv();
const wantJson = args.includes('--json');

// ──────────────────────────────────────────────────────────────────────────
// Tailwind w-/h- parser (default theme)
// ──────────────────────────────────────────────────────────────────────────

// Each parser returns {px, kind} where kind ∈ "px" | "pct" | "auto",
// or null if the token is unparseable. "pct" covers anything proportional to
// the viewport (Tailwind w-full/w-screen/w-1/2, %, vw, vh).

function parseTailwindSize(token, parentPx) {
  if (token === 'full' || token === 'screen') return { px: parentPx, kind: 'pct' };
  if (token === 'min' || token === 'max' || token === 'fit' || token === 'auto') return { px: null, kind: 'auto' };
  if (token === 'px') return { px: 1, kind: 'px' };
  if (token.startsWith('[') && token.endsWith(']')) {
    return parseLengthValue(token.slice(1, -1), parentPx);
  }
  if (token.includes('/')) {
    const [n, d] = token.split('/').map(Number);
    if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) return { px: (n / d) * parentPx, kind: 'pct' };
    return null;
  }
  const num = Number(token);
  if (Number.isFinite(num)) return { px: num * 4, kind: 'px' }; // tailwind unit = 0.25rem = 4px
  return null;
}

function parseLengthValue(v, parentPx) {
  v = String(v).trim();
  // Reject identifiers / expressions — only parse literal lengths whose
  // numeric prefix is actually numeric. Otherwise `width: px` (a variable
  // named `px`) gets misread as `0px`.
  const numLit = /^-?\d+(?:\.\d+)?$/;
  const trySuffix = (suffix, mul) => {
    if (!v.endsWith(suffix)) return null;
    const head = v.slice(0, -suffix.length).trim();
    if (!numLit.test(head)) return null;
    return Number(head) * mul;
  };
  let n;
  if ((n = trySuffix('px', 1)) !== null) return { px: n, kind: 'px' };
  if ((n = trySuffix('rem', 16)) !== null) return { px: n, kind: 'px' };
  if ((n = trySuffix('em', 16)) !== null) return { px: n, kind: 'px' };
  if ((n = trySuffix('vw', WIN_W / 100)) !== null) return { px: n, kind: 'pct' };
  if ((n = trySuffix('vh', WIN_H / 100)) !== null) return { px: n, kind: 'pct' };
  if (v.endsWith('%')) {
    const head = v.slice(0, -1).trim();
    if (!numLit.test(head)) return null;
    return { px: (Number(head) / 100) * parentPx, kind: 'pct' };
  }
  if (numLit.test(v)) return { px: Number(v), kind: 'px' }; // bare number = px
  return null;
}

// Returns {w, wKind, h, hKind} where any field may be undefined.
// kind ∈ "px" | "pct" | "auto"; px value is null for "auto".
function extractFromClassName(className) {
  const out = {};
  const tokens = className.split(/\s+/);
  for (const t of tokens) {
    let m;
    if ((m = t.match(/^w-(.+)$/))) {
      const r = parseTailwindSize(m[1], WIN_W);
      if (r) { out.w = r.px; out.wKind = r.kind; }
    } else if ((m = t.match(/^h-(.+)$/))) {
      const r = parseTailwindSize(m[1], WIN_H);
      if (r) { out.h = r.px; out.hKind = r.kind; }
    }
  }
  return out;
}

function extractFromStyleObject(styleSrc) {
  const out = {};
  const grab = (key) => {
    const re = new RegExp(`(?:^|[\\s,{])${key}\\s*:\\s*([^,}\\n]+)`, 'i');
    const m = styleSrc.match(re);
    if (!m) return undefined;
    let v = m[1].trim().replace(/[,]+$/, '');
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
      v = v.slice(1, -1);
    }
    return v;
  };
  const w = grab('width');
  const h = grab('height');
  if (w !== undefined) {
    const r = parseLengthValue(w, WIN_W);
    if (r) { out.w = r.px; out.wKind = r.kind; }
  }
  if (h !== undefined) {
    const r = parseLengthValue(h, WIN_H);
    if (r) { out.h = r.px; out.hKind = r.kind; }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Find the root JSX element of the file's main exported component
// ──────────────────────────────────────────────────────────────────────────

function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

function findRootJsx(src, anchorIdent) {
  const stripped = stripComments(src);
  // If an anchor identifier is given, narrow the search to that function/arrow.
  let scope = stripped;
  let scopeStart = 0;
  if (anchorIdent) {
    const reFn = new RegExp(`\\bfunction\\s+${anchorIdent}\\s*\\(`);
    const reConst = new RegExp(`\\b(?:const|let|var)\\s+${anchorIdent}\\s*[:=]`);
    const m = stripped.match(reFn) || stripped.match(reConst);
    if (m) {
      scopeStart = m.index;
      // Walk forward to the end of this function's body. Find first '{' after match,
      // then balance until depth returns to 0.
      let i = scopeStart;
      while (i < stripped.length && stripped[i] !== '{') i++;
      if (i < stripped.length) {
        let depth = 0;
        let inStr = null;
        const start = i;
        for (; i < stripped.length; i++) {
          const c = stripped[i];
          if (inStr) {
            if (c === '\\') { i++; continue; }
            if (c === inStr) inStr = null;
            continue;
          }
          if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
          if (c === '{') depth++;
          else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
        }
        scope = stripped.slice(start, i);
      } else {
        // Arrow function `const X = (props) => <...>` — take the rest.
        scope = stripped.slice(scopeStart);
      }
    }
  }
  // Walk return statements (or arrow-body JSX) within scope; pick first opening tag.
  const re = /(?:\breturn\s*\(?|=>\s*\(?)\s*(<\s*[A-Za-z][\w.]*)/g;
  let match;
  while ((match = re.exec(scope)) !== null) {
    const start = match.index + match[0].length - match[1].length;
    const tag = readOpeningTag(scope, start);
    if (tag) return tag;
  }
  return null;
}

function readOpeningTag(src, start) {
  // start points at '<'. Walk forward, tracking braces/quotes, until we hit
  // the matching '>' that closes the opening tag.
  let i = start + 1;
  // tag name
  while (i < src.length && /[\w.]/.test(src[i])) i++;
  const tagName = src.slice(start + 1, i).trim();
  let depth = 0; // {} depth
  let inStr = null;
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; i++; continue; }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { depth--; i++; continue; }
    if (depth === 0 && (c === '>' || (c === '/' && src[i + 1] === '>'))) {
      const end = c === '/' ? i + 2 : i + 1;
      const body = src.slice(start, end);
      return { name: tagName, body };
    }
    i++;
  }
  return null;
}

function extractAttrs(tagBody) {
  // Pull className="..." | className={`...`} | className={'...'} and style={{ ... }}.
  let className = null;
  let styleSrc = null;

  // className="..." | '...'
  let m = tagBody.match(/\bclassName\s*=\s*"([^"]*)"/);
  if (!m) m = tagBody.match(/\bclassName\s*=\s*'([^']*)'/);
  if (m) className = m[1];
  if (!className) {
    // className={`...`} — take just the static parts (drop ${...}).
    m = tagBody.match(/\bclassName\s*=\s*\{`([^`]*)`\}/);
    if (m) className = m[1].replace(/\$\{[^}]*\}/g, ' ');
  }
  if (!className) {
    m = tagBody.match(/\bclassName\s*=\s*\{\s*"([^"]*)"\s*\}/);
    if (m) className = m[1];
  }

  // style={{ ... }}
  m = tagBody.match(/\bstyle\s*=\s*\{\s*\{([\s\S]*?)\}\s*\}/);
  if (m) styleSrc = m[1];

  return { className, styleSrc };
}

// Pull numeric-literal width/height/size JSX props off the root opening tag.
// Catches patterns like `<X size={512} />` or `<Box width={240} height={120} />`
// where the size is set via custom prop, not style/className.
function extractFromJsxProps(tagBody) {
  const out = {};
  const numProp = (name) => {
    const re = new RegExp(`\\b${name}\\s*=\\s*\\{\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\}`);
    const m = tagBody.match(re);
    return m ? Number(m[1]) : undefined;
  };
  const w = numProp('width');
  const h = numProp('height');
  const s = numProp('size');
  if (w !== undefined) { out.w = w; out.wKind = 'px'; }
  if (h !== undefined) { out.h = h; out.hKind = 'px'; }
  if (s !== undefined) {
    if (out.w === undefined) { out.w = s; out.wKind = 'px'; }
    if (out.h === undefined) { out.h = s; out.hKind = 'px'; }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Walk components dir
// ──────────────────────────────────────────────────────────────────────────

function listDir(path) {
  let raw;
  try { raw = __fs_list_json(path); } catch { return []; }
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw;
  try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {}
  return [];
}

function statOf(path) {
  let raw;
  try { raw = __fs_stat_json(path); } catch { return null; }
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

function isDirAt(path) {
  const st = statOf(path);
  if (!st) return false;
  return !!(st.is_dir || st.isDir || st.type === 'dir');
}

function isFileAt(path) {
  const st = statOf(path);
  if (!st) return false;
  if (st.is_file || st.isFile || st.type === 'file') return true;
  // stat shape may only carry isDir; treat "exists and not a dir" as a file.
  const isDir = !!(st.is_dir || st.isDir || st.type === 'dir');
  return !isDir;
}

function readText(path) {
  try { return __fs_read(path); } catch { return null; }
}

// Resolve a relative import (./foo) against `dir` to a real file on disk,
// trying common extensions. Returns the resolved path or null.
function resolveImport(dir, spec) {
  if (!spec.startsWith('.')) return null;
  const base = `${dir}/${spec.replace(/^\.\//, '')}`;
  const tries = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts'];
  for (const ext of tries) {
    if (isFileAt(base + ext)) return base + ext;
  }
  return null;
}

// If `src` is a re-export shell, return { file, ident } where ident is the
// name of the function/const to find inside the resolved file. Else null.
function followReExport(file, src) {
  const dir = file.replace(/\/[^\/]+$/, '');
  // export const X = Y;
  let m = src.match(/export\s+const\s+\w+\s*=\s*(\w+)\s*;?/);
  if (m) {
    const ident = m[1];
    const re = new RegExp(`import\\s*(?:[^'"\\n]*\\b${ident}\\b[^'"\\n]*)from\\s*['"]([^'"]+)['"]`);
    const im = src.match(re);
    if (im) {
      const r = resolveImport(dir, im[1]);
      if (r) return { file: r, ident };
    }
  }
  // export { X } from './path'  (X is what we look for inside)
  m = src.match(/export\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/);
  if (m) {
    const first = m[1].split(',')[0].trim().split(/\s+as\s+/)[0].trim();
    const r = resolveImport(dir, m[2]);
    if (r) return { file: r, ident: first };
  }
  return null;
}

function pickPrimaryFile(dirPath, dirName) {
  // Prefer PascalCase match of dir name; else first .tsx that isn't an index/data/style file.
  const entries = listDir(dirPath);
  const files = entries.filter((n) => n.endsWith('.tsx') && isFileAt(`${dirPath}/${n}`));
  if (files.length === 0) return null;
  const pascal = dirName.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
  const exact = files.find((f) => f === `${pascal}.tsx`);
  if (exact) return `${dirPath}/${exact}`;
  // Fallbacks: anything that looks like the main component (single PascalCase file).
  const pascalish = files.filter((f) => /^[A-Z]/.test(f) && !/Data\.tsx$|Theme\.tsx$|Variants?\.tsx$/.test(f));
  if (pascalish.length >= 1) return `${dirPath}/${pascalish[0]}`;
  return `${dirPath}/${files[0]}`;
}

const componentDirs = listDir(COMPONENTS_DIR)
  .filter((n) => n && !n.startsWith('.') && isDirAt(`${COMPONENTS_DIR}/${n}`))
  .sort();

const rows = [];
for (const dirName of componentDirs) {
  const dirPath = `${COMPONENTS_DIR}/${dirName}`;
  const file = pickPrimaryFile(dirPath, dirName);
  if (!file) {
    rows.push({ name: dirName, file: null, w: null, h: null, note: 'no .tsx file' });
    continue;
  }
  let curFile = file;
  let src = readText(curFile);
  if (!src) {
    rows.push({ name: dirName, file: curFile, w: null, h: null, note: 'unreadable' });
    continue;
  }
  let anchor = null;
  // Always try to follow re-export shells first — they have no JSX of their own.
  const followed = followReExport(curFile, src);
  if (followed) {
    const nextSrc = readText(followed.file);
    if (nextSrc) {
      curFile = followed.file;
      src = nextSrc;
      anchor = followed.ident;
    }
  }
  let root = findRootJsx(src, anchor);
  // If anchor lookup found nothing, try unanchored as a fallback.
  if (!root && anchor) root = findRootJsx(src, null);
  if (!root) {
    rows.push({ name: dirName, file: curFile, w: null, h: null, note: 'no return JSX' });
    continue;
  }
  const sz = sizeFromTagBody(root.body);
  rows.push({
    name: dirName,
    file: curFile,
    rootTag: root.name,
    w: sz.w === undefined ? null : sz.w,
    h: sz.h === undefined ? null : sz.h,
    wKind: sz.wKind || null,
    hKind: sz.hKind || null,
    note: sz.w === undefined && sz.h === undefined ? 'auto (intrinsic)' : '',
  });
}

function sizeFromTagBody(body) {
  const { className, styleSrc } = extractAttrs(body);
  const cls = className ? extractFromClassName(className) : {};
  const sty = styleSrc ? extractFromStyleObject(styleSrc) : {};
  const jsx = extractFromJsxProps(body);
  // Precedence: inline style > className > custom JSX size/width/height props.
  const pick = (a, b, c) => (a !== undefined ? a : b !== undefined ? b : c);
  return {
    w: pick(sty.w, cls.w, jsx.w),
    h: pick(sty.h, cls.h, jsx.h),
    wKind: pick(sty.wKind, cls.wKind, jsx.wKind),
    hKind: pick(sty.hKind, cls.hKind, jsx.hKind),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Deep-literal scan — every pixel-literal width/height/size value found
// anywhere in a file (not just root). Used to surface sizes hidden inside
// subcomponents, e.g. `<X size={512} />` deep in a render tree.
// ──────────────────────────────────────────────────────────────────────────

function deepLiteralSizes(src) {
  const stripped = stripComments(src);
  const found = []; // [{ axis: 'w'|'h'|'s', px, kind, ctx }]

  // 1) Inline style: width: 512, height: 512, width: '512px', etc.
  //    Scan inside any `style={{ ... }}` block.
  const styleRx = /\bstyle\s*=\s*\{\s*\{([\s\S]*?)\}\s*\}/g;
  let sm;
  while ((sm = styleRx.exec(stripped)) !== null) {
    const body = sm[1];
    const grabAll = (key, axis, parentPx) => {
      const re = new RegExp(`(?:^|[\\s,{])${key}\\s*:\\s*([^,}\\n]+)`, 'gi');
      let mm;
      while ((mm = re.exec(body)) !== null) {
        let v = mm[1].trim().replace(/[,]+$/, '');
        if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
        const r = parseLengthValue(v, parentPx);
        if (r) found.push({ axis, px: r.px, kind: r.kind, ctx: `style.${key}` });
      }
    };
    grabAll('width', 'w', WIN_W);
    grabAll('height', 'h', WIN_H);
  }

  // 2) JSX numeric props: width={N}, height={N}, size={N}
  const jsxNum = (name, axis) => {
    const re = new RegExp(`\\b${name}\\s*=\\s*\\{\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\}`, 'g');
    let mm;
    while ((mm = re.exec(stripped)) !== null) {
      found.push({ axis, px: Number(mm[1]), kind: 'px', ctx: `prop.${name}` });
    }
  };
  jsxNum('width', 'w');
  jsxNum('height', 'h');
  jsxNum('size', 's');

  // 3) JSX string props with px units: width="512px", size="64"
  const jsxStr = (name, axis, parentPx) => {
    const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]+)"`, 'g');
    let mm;
    while ((mm = re.exec(stripped)) !== null) {
      const r = parseLengthValue(mm[1], parentPx);
      if (r) found.push({ axis, px: r.px, kind: r.kind, ctx: `prop.${name}` });
    }
  };
  jsxStr('width', 'w', WIN_W);
  jsxStr('height', 'h', WIN_H);

  // 4) Tailwind className tokens with literal pixel values: w-[512px], h-[Npx],
  //    and tailwind unit forms w-N / h-N. Scan all className strings.
  const classRx = /\bclassName\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{\s*"([^"]*)"\s*\})/g;
  let cm;
  while ((cm = classRx.exec(stripped)) !== null) {
    const cls = (cm[1] || cm[2] || cm[3] || cm[4] || '').replace(/\$\{[^}]*\}/g, ' ');
    for (const t of cls.split(/\s+/)) {
      let mm;
      if ((mm = t.match(/^w-(.+)$/))) {
        const r = parseTailwindSize(mm[1], WIN_W);
        if (r && r.kind !== 'auto') found.push({ axis: 'w', px: r.px, kind: r.kind, ctx: `class.${t}` });
      } else if ((mm = t.match(/^h-(.+)$/))) {
        const r = parseTailwindSize(mm[1], WIN_H);
        if (r && r.kind !== 'auto') found.push({ axis: 'h', px: r.px, kind: r.kind, ctx: `class.${t}` });
      }
    }
  }

  return found;
}

function walkTsxFiles(dir, out = []) {
  const entries = listDir(dir);
  for (const name of entries) {
    if (!name || name.startsWith('.')) continue;
    const full = `${dir}/${name}`;
    if (isDirAt(full)) walkTsxFiles(full, out);
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// For each component dir, scan every .tsx file recursively and aggregate the
// max literal width/height/size value found anywhere.
const deepRows = []; // [{ name, maxW, maxH, maxS, biggest: {px, axis, ctx, file} }]
for (const dirName of componentDirs) {
  const dirPath = `${COMPONENTS_DIR}/${dirName}`;
  const files = walkTsxFiles(dirPath);
  let maxW = 0, maxWWhere = null;
  let maxH = 0, maxHWhere = null;
  let maxS = 0, maxSWhere = null;
  for (const f of files) {
    const src = readText(f);
    if (!src) continue;
    const hits = deepLiteralSizes(src);
    for (const hit of hits) {
      if (hit.kind !== 'px') continue; // pct values would all collapse to WIN size; skip for "biggest fixed" tracking
      if (hit.axis === 'w' && hit.px > maxW) { maxW = hit.px; maxWWhere = { ...hit, file: f }; }
      if (hit.axis === 'h' && hit.px > maxH) { maxH = hit.px; maxHWhere = { ...hit, file: f }; }
      if (hit.axis === 's' && hit.px > maxS) { maxS = hit.px; maxSWhere = { ...hit, file: f }; }
    }
  }
  // For "size" (square) treat as both w and h.
  const eff = (a, b) => Math.max(a || 0, b || 0);
  deepRows.push({
    name: dirName,
    maxW: eff(maxW, maxS),
    maxH: eff(maxH, maxS),
    maxWhereW: maxS > maxW ? maxSWhere : maxWWhere,
    maxWhereH: maxS > maxH ? maxSWhere : maxHWhere,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Story variants — scan cart/app/gallery/stories/*.story.tsx
// ──────────────────────────────────────────────────────────────────────────

function scanStoryFile(file) {
  const src = readText(file);
  if (!src) return [];
  const stripped = stripComments(src);
  const out = [];
  // Match `render: () => <X .../>` (with or without paren wrapping the JSX).
  const rx = /\brender\s*:\s*\([^)]*\)\s*=>\s*\(?\s*(<\s*[A-Za-z][\w.]*)/g;
  let m;
  while ((m = rx.exec(stripped)) !== null) {
    const start = m.index + m[0].length - m[1].length;
    const tag = readOpeningTag(stripped, start);
    if (!tag) continue;
    const before = stripped.slice(0, m.index);
    // Last `id: '...'` before this render — that's the variant id (since
    // variants are { id, name, ..., render }). Falls back to story id if
    // the variant didn't set one.
    const allIds = [...before.matchAll(/\bid\s*:\s*['"]([^'"]+)['"]/g)];
    const variantId = allIds.length ? allIds[allIds.length - 1][1] : '?';
    out.push({ file, variantId, rootTag: tag.name, body: tag.body });
  }
  return out;
}

const storyFiles = listDir(STORIES_DIR)
  .filter((n) => n.endsWith('.story.tsx') && isFileAt(`${STORIES_DIR}/${n}`))
  .sort();

const variantRows = [];
for (const sf of storyFiles) {
  const path = `${STORIES_DIR}/${sf}`;
  const entries = scanStoryFile(path);
  for (const e of entries) {
    const sz = sizeFromTagBody(e.body);
    variantRows.push({
      story: sf.replace(/\.story\.tsx$/, ''),
      variantId: e.variantId,
      rootTag: e.rootTag,
      file: path,
      w: sz.w === undefined ? null : sz.w,
      h: sz.h === undefined ? null : sz.h,
      wKind: sz.wKind || null,
      hKind: sz.hKind || null,
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Output
// ──────────────────────────────────────────────────────────────────────────

if (wantJson) {
  __writeStdout(JSON.stringify({
    window: { w: WIN_W, h: WIN_H },
    components: rows,
    variants: variantRows,
  }, null, 2) + '\n');
  __exit(0);
}

const fmt = (v) => {
  if (v === null || v === undefined) return 'auto';
  return Math.round(v * 100) / 100 + 'px';
};

const nameW = Math.max(12, ...rows.map((r) => r.name.length));
const tagW = Math.max(4, ...rows.map((r) => (r.rootTag || '?').length));

const cell = (px, kind) => {
  if (kind === 'pct') return `${fmt(px)} (%)`;
  if (kind === 'px') return `${fmt(px)}`;
  return 'auto';
};

__writeStdout(`gallery component sizes @ ${WIN_W}×${WIN_H} (launch window)\n`);
__writeStdout(''.padEnd(nameW + tagW + 36, '─') + '\n');
for (const r of rows) {
  const line =
    r.name.padEnd(nameW + 2) +
    (r.rootTag || '?').padEnd(tagW + 2) +
    `w=${cell(r.w, r.wKind)}`.padEnd(18) +
    `h=${cell(r.h, r.hKind)}`.padEnd(18) +
    (r.note || '');
  __writeStdout(line + '\n');
}

// ──────────────────────────────────────────────────────────────────────────
// Variants table — only show those with an explicit size at the root
// ──────────────────────────────────────────────────────────────────────────

const sizedVariants = variantRows.filter((v) => v.wKind || v.hKind);
if (sizedVariants.length) {
  const storyW = Math.max(8, ...sizedVariants.map((v) => v.story.length));
  const varW = Math.max(8, ...sizedVariants.map((v) => v.variantId.length));
  const vtagW = Math.max(4, ...sizedVariants.map((v) => v.rootTag.length));
  __writeStdout(`\nstory variants with explicit root sizing\n`);
  __writeStdout(''.padEnd(storyW + varW + vtagW + 36, '─') + '\n');
  for (const v of sizedVariants) {
    const line =
      v.story.padEnd(storyW + 2) +
      v.variantId.padEnd(varW + 2) +
      v.rootTag.padEnd(vtagW + 2) +
      `w=${cell(v.w, v.wKind)}`.padEnd(18) +
      `h=${cell(v.h, v.hKind)}`.padEnd(18);
    __writeStdout(line + '\n');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Summary (components + variants)
// ──────────────────────────────────────────────────────────────────────────

const labelComp = (r) => r.name;
const labelVar  = (v) => `${v.story}/${v.variantId}`;

const allPxW = [
  ...rows.filter((r) => r.wKind === 'px' && Number.isFinite(r.w) && r.w > 0).map((r) => ({ v: r.w, label: labelComp(r), src: 'component' })),
  ...variantRows.filter((v) => v.wKind === 'px' && Number.isFinite(v.w) && v.w > 0).map((v) => ({ v: v.w, label: labelVar(v), src: 'variant' })),
];
const allPxH = [
  ...rows.filter((r) => r.hKind === 'px' && Number.isFinite(r.h) && r.h > 0).map((r) => ({ v: r.h, label: labelComp(r), src: 'component' })),
  ...variantRows.filter((v) => v.hKind === 'px' && Number.isFinite(v.h) && v.h > 0).map((v) => ({ v: v.h, label: labelVar(v), src: 'variant' })),
];
const pctRows = rows.filter((r) => r.wKind === 'pct' || r.hKind === 'pct');
const pctVars = variantRows.filter((v) => v.wKind === 'pct' || v.hKind === 'pct');

const minByV = (arr) => arr.slice().sort((a, b) => a.v - b.v)[0];
const maxByV = (arr) => arr.slice().sort((a, b) => b.v - a.v)[0];

__writeStdout(`\n${rows.length} components, ${variantRows.length} variants (${sizedVariants.length} sized) scanned.\n`);
__writeStdout(`\nsummary — fixed-pixel sizes (components + variants combined):\n`);
if (allPxW.length) {
  const sw = minByV(allPxW);
  const lw = maxByV(allPxW);
  __writeStdout(`  width  → smallest ${sw.v}px (${sw.label} [${sw.src}]), largest ${lw.v}px (${lw.label} [${lw.src}]), n=${allPxW.length}\n`);
} else {
  __writeStdout(`  width  → no fixed-px roots\n`);
}
if (allPxH.length) {
  const sh = minByV(allPxH);
  const lh = maxByV(allPxH);
  __writeStdout(`  height → smallest ${sh.v}px (${sh.label} [${sh.src}]), largest ${lh.v}px (${lh.label} [${lh.src}]), n=${allPxH.length}\n`);
} else {
  __writeStdout(`  height → no fixed-px roots\n`);
}

__writeStdout(`\n%-based root sizing (w-full / w-screen / w-1/2 / %, vw, vh):\n`);
__writeStdout(`  components: ${pctRows.length}${pctRows.length ? ' → ' + pctRows.map((r) => r.name).join(', ') : ''}\n`);
__writeStdout(`  variants  : ${pctVars.length}${pctVars.length ? ' → ' + pctVars.map(labelVar).join(', ') : ''}\n`);

// ──────────────────────────────────────────────────────────────────────────
// Deep-scan summary — pixel literals found anywhere inside each component dir
// ──────────────────────────────────────────────────────────────────────────

const deepW = deepRows.filter((d) => d.maxW > 0);
const deepH = deepRows.filter((d) => d.maxH > 0);
const dMaxW = deepW.slice().sort((a, b) => b.maxW - a.maxW)[0];
const dMaxH = deepH.slice().sort((a, b) => b.maxH - a.maxH)[0];
const dMinW = deepW.slice().sort((a, b) => a.maxW - b.maxW)[0];
const dMinH = deepH.slice().sort((a, b) => a.maxH - b.maxH)[0];

__writeStdout(`\ndeep scan — pixel literals found anywhere in component dir (incl. subcomponents):\n`);
if (dMaxW) __writeStdout(`  largest width  : ${dMaxW.maxW}px (${dMaxW.name} via ${dMaxW.maxWhereW?.ctx} in ${dMaxW.maxWhereW?.file?.split('/').pop()})\n`);
if (dMaxH) __writeStdout(`  largest height : ${dMaxH.maxH}px (${dMaxH.name} via ${dMaxH.maxWhereH?.ctx} in ${dMaxH.maxWhereH?.file?.split('/').pop()})\n`);
if (dMinW) __writeStdout(`  smallest width : ${dMinW.maxW}px (${dMinW.name})\n`);
if (dMinH) __writeStdout(`  smallest height: ${dMinH.maxH}px (${dMinH.name})\n`);
__writeStdout(`  components with any pixel literal: ${deepW.length} (width), ${deepH.length} (height)\n`);

// Top 10 largest by max(w,h) for the overview the user asked for.
const byBiggest = deepRows
  .map((d) => ({ name: d.name, max: Math.max(d.maxW, d.maxH) }))
  .filter((d) => d.max > 0)
  .sort((a, b) => b.max - a.max)
  .slice(0, 10);
__writeStdout(`\ntop 10 components by largest single pixel-literal:\n`);
for (const t of byBiggest) {
  __writeStdout(`  ${t.max.toString().padStart(5)}px  ${t.name}\n`);
}

__exit(0);
