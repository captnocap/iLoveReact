// TS/TSX line tokenizer — produces the `Array<Array<{text, color}>>`
// shape that v8_app.zig:944 `parseColorTextRows` consumes for
// <TextEditor paintText colorRows={…}>. Each outer entry is one row
// of the editor; each inner entry is one colored span on that row.
//
// Colors are theme: tokens matching the existing SyntaxX classifier
// family in cart/app/gallery/components.cls.ts. Same cascade as the
// rest of the cart — flips with the active gallery theme.
//
// Hand-rolled per-line tokenizer (no parser library). Multi-line
// constructs (block comments spanning newlines) won't carry state
// across rows in this simple form — fine for the canvas-as-code
// mirror where the generated source is small useIFTTT-call blocks.

export type TokenKind =
  | 'text'
  | 'keyword'
  | 'type'
  | 'constant'
  | 'string'
  | 'number'
  | 'comment'
  | 'operator';

export interface ColorSpan {
  text: string;
  color: string;
}

const TOKEN_COLOR: Record<TokenKind, string> = {
  text:     'theme:ink',
  keyword:  'theme:accent',
  type:     'theme:lilac',
  constant: 'theme:warn',
  string:   'theme:ok',
  number:   'theme:warn',
  comment:  'theme:inkDimmer',
  operator: 'theme:flag',
};

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

function tokenizeLine(line: string): ColorSpan[] {
  const out: ColorSpan[] = [];
  if (line.length === 0) {
    out.push({ text: ' ', color: TOKEN_COLOR.text });
    return out;
  }
  let i = 0;
  while (i < line.length) {
    const ch = line.charAt(i);
    const next = i + 1 < line.length ? line.charAt(i + 1) : '';

    if (ch === ' ' || ch === '\t') {
      const start = i;
      while (i < line.length && (line.charAt(i) === ' ' || line.charAt(i) === '\t')) i++;
      out.push({ text: line.slice(start, i), color: TOKEN_COLOR.text });
      continue;
    }

    if (ch === '/' && next === '/') {
      out.push({ text: line.slice(i), color: TOKEN_COLOR.comment });
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
      out.push({ text: line.slice(start, i), color: TOKEN_COLOR.string });
      continue;
    }

    if (isDigit(ch)) {
      const start = i;
      i++;
      while (i < line.length && (isDigit(line.charAt(i)) || line.charAt(i) === '.')) i++;
      out.push({ text: line.slice(start, i), color: TOKEN_COLOR.number });
      continue;
    }

    if (isWordStart(ch)) {
      const start = i;
      i++;
      while (i < line.length && isWordChar(line.charAt(i))) i++;
      const word = line.slice(start, i);
      let color = TOKEN_COLOR.text;
      if (KEYWORDS.has(word)) color = TOKEN_COLOR.keyword;
      else if (TYPES.has(word)) color = TOKEN_COLOR.type;
      else if (/^[A-Z][a-zA-Z0-9_$]*$/.test(word)) color = TOKEN_COLOR.type;
      else if (/^[A-Z][A-Z0-9_]*$/.test(word)) color = TOKEN_COLOR.constant;
      out.push({ text: word, color });
      continue;
    }

    if ('{}[]()=:;+-*%!&|<>?/.,~'.includes(ch)) {
      out.push({ text: ch, color: TOKEN_COLOR.operator });
      i++;
      continue;
    }

    out.push({ text: ch, color: TOKEN_COLOR.text });
    i++;
  }
  if (out.length === 0) out.push({ text: ' ', color: TOKEN_COLOR.text });
  return out;
}

/** Tokenize TS/TSX source into the colorRows shape consumed by
 *  <TextEditor paintText colorRows={…}>. */
export function tokenizeToColorRows(source: string): ColorSpan[][] {
  if (!source) return [[{ text: ' ', color: TOKEN_COLOR.text }]];
  return source.split('\n').map(tokenizeLine);
}
