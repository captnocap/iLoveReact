/**
 * jsx-transform.ts — Lightweight JSX -> React.createElement transformer.
 */

export interface TransformResult { code: string; errors: TransformError[]; }
export interface TransformError { line: number; col: number; message: string; }

let src: string, pos: number, lineNum: number, colNum: number, errors: TransformError[];

function peek(): string { return src[pos] || ''; }
function peekAt(n: number): string { return src[pos + n] || ''; }
function advance(): string { const ch = src[pos] || ''; if (ch === '\n') { lineNum++; colNum = 1; } else colNum++; pos++; return ch; }
function match(s: string): boolean { return src.slice(pos, pos + s.length) === s; }
function eat(s: string): boolean { if (match(s)) { for (let i = 0; i < s.length; i++) advance(); return true; } return false; }
function addError(msg: string): void { errors.push({ line: lineNum, col: colNum, message: msg }); }
function skipWS(): void { while (pos < src.length && ' \t\n\r'.includes(peek())) advance(); }

function readIdent(): string { let n = ''; while (pos < src.length && /[a-zA-Z0-9_$.]/.test(peek())) n += advance(); return n; }

function readBraced(): string {
  let depth = 1, r = '';
  while (pos < src.length && depth > 0) {
    const ch = peek();
    if (ch === '{') { depth++; r += advance(); }
    else if (ch === '}') { depth--; if (depth > 0) r += advance(); else advance(); }
    else if (ch === '"' || ch === "'") r += readStr(ch);
    else if (ch === '`') r += readTmpl();
    else if (ch === '/' && peekAt(1) === '/') { while (pos < src.length && peek() !== '\n') r += advance(); }
    else if (ch === '/' && peekAt(1) === '*') { r += advance(); r += advance(); while (pos < src.length && !(peek() === '*' && peekAt(1) === '/')) r += advance(); if (pos < src.length) { r += advance(); r += advance(); } }
    else r += advance();
  }
  return r;
}

function readStr(q: string): string {
  let r = advance();
  while (pos < src.length && peek() !== q) { if (peek() === '\\') { r += advance(); if (pos < src.length) r += advance(); } else r += advance(); }
  if (pos < src.length) r += advance();
  return r;
}

function readTmpl(): string {
  let r = advance();
  while (pos < src.length && peek() !== '`') {
    if (peek() === '\\') { r += advance(); if (pos < src.length) r += advance(); }
    else if (peek() === '$' && peekAt(1) === '{') { r += advance(); r += advance(); let d = 1; while (pos < src.length && d > 0) { if (peek() === '{') d++; else if (peek() === '}') d--; if (d > 0) r += advance(); else advance(); } r += '}'; }
    else r += advance();
  }
  if (pos < src.length) r += advance();
  return r;
}

function isJSXStart(): boolean { return peek() === '<' && (peekAt(1) === '>' || /[a-zA-Z_$]/.test(peekAt(1))); }

function parseJSX(): string {
  advance(); // <
  if (peek() === '>') { advance(); const ch = parseChildren(''); if (eat('</')) eat('>'); return ch.length ? `React.createElement(React.Fragment, null, ${ch.join(', ')})` : 'React.createElement(React.Fragment, null)'; }
  const tag = readIdent();
  if (!tag) { addError('Expected tag name'); return '"<error>"'; }
  const props = parseProps();
  if (eat('/>')) return `React.createElement(${tag}, ${props})`;
  if (!eat('>')) { addError(`Expected > after <${tag}`); return '"<error>"'; }
  const ch = parseChildren(tag);
  if (eat('</')) { readIdent(); eat('>'); }
  return ch.length ? `React.createElement(${tag}, ${props}, ${ch.join(', ')})` : `React.createElement(${tag}, ${props})`;
}

function parseProps(): string {
  const ps: string[] = [];
  while (pos < src.length) {
    skipWS();
    if (peek() === '/' || peek() === '>') break;
    if (peek() === '{' && peekAt(1) === '.' && peekAt(2) === '.' && peekAt(3) === '.') { advance(); advance(); advance(); advance(); ps.push(`...${readBraced()}`); continue; }
    const name = readIdent();
    if (!name) { advance(); continue; }
    if (peek() !== '=') { ps.push(`${name}: true`); continue; }
    advance();
    if (peek() === '"' || peek() === "'") { ps.push(`${name}: ${readStr(peek())}`); continue; }
    if (peek() === '{') { advance(); ps.push(`${name}: ${readBraced()}`); continue; }
    addError(`Expected value after ${name}=`);
  }
  if (!ps.length) return 'null';
  if (ps.some(p => p.startsWith('...'))) { return `Object.assign({}, ${ps.map(p => p.startsWith('...') ? p.slice(3) : `{${p}}`).join(', ')})`; }
  return `{${ps.join(', ')}}`;
}

function parseChildren(parent: string): string[] {
  const ch: string[] = [];
  while (pos < src.length) {
    if (match('</')) break;
    if (parent === '' && match('</>')) break;
    if (peek() === '{') { advance(); const e = readBraced(); if (e.trim()) ch.push(e.trim()); continue; }
    if (isJSXStart()) { ch.push(parseJSX()); continue; }
    let t = ''; while (pos < src.length && peek() !== '<' && peek() !== '{') t += advance();
    const s = t.replace(/\s+/g, ' ').trim();
    if (s) ch.push(JSON.stringify(s));
  }
  return ch;
}

export function transformJSX(source: string): TransformResult {
  src = source; pos = 0; lineNum = 1; colNum = 1; errors = [];
  let out = '';
  while (pos < src.length) {
    if (isJSXStart()) { out += parseJSX(); continue; }
    const ch = peek();
    if (ch === '"' || ch === "'") { out += readStr(ch); continue; }
    if (ch === '`') { out += readTmpl(); continue; }
    if (ch === '/' && peekAt(1) === '/') { while (pos < src.length && peek() !== '\n') out += advance(); continue; }
    if (ch === '/' && peekAt(1) === '*') { out += advance(); out += advance(); while (pos < src.length && !(peek() === '*' && peekAt(1) === '/')) out += advance(); if (pos < src.length) { out += advance(); out += advance(); } continue; }
    out += advance();
  }
  return { code: out, errors };
}
