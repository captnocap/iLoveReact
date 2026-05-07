// Tokenizer for TS / TSX. Hand-rolled: no parser library, no full AST,
// just enough to colorize keywords / strings / comments / types /
// numbers / operators per line. Ported from the deadcode sweatshop
// CodeEditor (commit history → cart/deadcode/sweatshop/components/
// code-editor/languages/ts.ts).
//
// Each line tokenizes independently — multi-line constructs (e.g.
// /* ... */ comments spanning lines) won't carry state across newlines
// in this simple form. Acceptable for the canvas-as-code mirror where
// the generated source is single-block useIFTTT calls.

export type Token = { text: string; kind: TokenKind };

export type TokenKind =
  | 'text'
  | 'keyword'
  | 'type'
  | 'constant'
  | 'string'
  | 'number'
  | 'comment'
  | 'operator';

const KEYWORDS = new Set([
  'import', 'from', 'export', 'default', 'as', 'const', 'let', 'var', 'function', 'return',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch',
  'finally', 'throw', 'new', 'this', 'class', 'extends', 'implements', 'interface', 'type',
  'enum', 'namespace', 'module', 'declare', 'abstract', 'readonly', 'private', 'protected',
  'public', 'static', 'async', 'await', 'yield', 'typeof', 'instanceof', 'in', 'of', 'void',
  'null', 'undefined', 'true', 'false', 'debugger', 'with',
]);

const TYPES = new Set([
  'string', 'number', 'boolean', 'any', 'unknown', 'never', 'void', 'object', 'symbol',
  'bigint', 'Array', 'Record', 'Partial', 'Required', 'Pick', 'Omit', 'Exclude', 'Extract',
  'Promise', 'Map', 'Set', 'Date', 'RegExp', 'Error', 'Function',
]);

const isWordStart = (ch: string): boolean => /[a-zA-Z_$]/.test(ch);
const isWordChar  = (ch: string): boolean => /[a-zA-Z0-9_$]/.test(ch);
const isDigit     = (ch: string): boolean => /[0-9]/.test(ch);

export function tokenizeTSLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line.charAt(i);
    const next = i + 1 < line.length ? line.charAt(i + 1) : '';

    if (ch === ' ' || ch === '\t') {
      const start = i;
      while (i < line.length && (line.charAt(i) === ' ' || line.charAt(i) === '\t')) i++;
      tokens.push({ text: line.slice(start, i), kind: 'text' });
      continue;
    }

    if (ch === '/' && next === '/') {
      tokens.push({ text: line.slice(i), kind: 'comment' });
      break;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      const start = i;
      i++;
      while (i < line.length) {
        if (line.charAt(i) === quote && line.charAt(i - 1) !== '\\') { i++; break; }
        i++;
      }
      tokens.push({ text: line.slice(start, i), kind: 'string' });
      continue;
    }

    if (isDigit(ch)) {
      const start = i;
      i++;
      while (i < line.length && (isDigit(line.charAt(i)) || line.charAt(i) === '.')) i++;
      tokens.push({ text: line.slice(start, i), kind: 'number' });
      continue;
    }

    if (isWordStart(ch)) {
      const start = i;
      i++;
      while (i < line.length && isWordChar(line.charAt(i))) i++;
      const word = line.slice(start, i);
      let kind: TokenKind = 'text';
      if (KEYWORDS.has(word)) kind = 'keyword';
      else if (TYPES.has(word)) kind = 'type';
      else if (/^[A-Z][a-zA-Z0-9_$]*$/.test(word)) kind = 'type';
      else if (/^[A-Z][A-Z0-9_]*$/.test(word)) kind = 'constant';
      tokens.push({ text: word, kind });
      continue;
    }

    if ('{}[]()=:;+-*%!&|<>?/.,~'.includes(ch)) {
      tokens.push({ text: ch, kind: 'operator' });
      i++;
      continue;
    }

    tokens.push({ text: ch, kind: 'text' });
    i++;
  }
  if (tokens.length === 0) tokens.push({ text: ' ', kind: 'text' });
  return tokens;
}

export function tokenizeTS(text: string): Token[][] {
  if (!text) return [[{ text: ' ', kind: 'text' }]];
  return text.split('\n').map(tokenizeTSLine);
}

// ── Token kind → color ───────────────────────────────────────────
//
// Hex literals here pending a `theme:codeKeyword` / `theme:codeString`
// / etc. token family. When that lands, swap to `theme:` strings and
// the tokens cascade with the active gallery theme. (See app.md
// "no-color-drift" memory for the convention.)

const TOKEN_COLOR: Record<TokenKind, string> = {
  text:     '#cdd6f4',
  keyword:  '#cba6f7',
  type:     '#94e2d5',
  constant: '#fab387',
  string:   '#a6e3a1',
  number:   '#fab387',
  comment:  '#6c7086',
  operator: '#89b4fa',
};

export function colorForToken(kind: TokenKind): string {
  return TOKEN_COLOR[kind] ?? TOKEN_COLOR.text;
}
