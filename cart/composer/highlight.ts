// highlight.ts — minimal JS/TS tokenizer for the composer editor.
//
// Feeds the host TextEditor primitive's `colorRows` prop:
//   colorRows: Array<Array<{ text: string, color: string }>>
//
// One outer entry per line; each line is a sequence of colored spans
// that sum to exactly the line text (newline characters not included —
// the host inserts line breaks between rows).
//
// Scope is deliberately small: line comments (//), single/double/back-
// tick strings, numbers, identifiers (classified into keyword / builtin
// / synth / text), and punctuation. Block comments (/* */) and template
// interpolation (${ ... }) are NOT special-cased — they'd render as one
// large string token, which is harmless. The default source uses neither.

import { COLORS } from './theme';
import { STATIC_SANDBOX_NAMES } from './compiler';

export type TokenKind =
  | 'keyword'
  | 'builtin'   // sandbox API name (setTempo, makeBeat, …)
  | 'synth'     // built-in synth constant (kick, snare, hat, bass, lead)
  | 'sample'    // project-defined sample id (resolved at render time)
  | 'string'
  | 'number'
  | 'comment'
  | 'punct'
  | 'text';

export interface Token {
  text: string;
  kind: TokenKind;
}

export interface ColorRow {
  text: string;
  color: string;
}

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'throw', 'try', 'catch', 'finally',
  'new', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void',
  'true', 'false', 'null', 'undefined',
  'this', 'class', 'extends', 'super', 'import', 'export', 'from', 'as', 'async', 'await',
]);

const SYNTHS = new Set(['kick', 'snare', 'hat', 'bass', 'lead']);

/** Sandbox API names exposed by the compiler — pulled from a single
 *  source of truth so adding a new sandbox binding only touches one
 *  file. The lookup excludes the synth constants (they get their own
 *  kind for stronger visual distinction). */
const BUILTINS: Set<string> = (() => {
  const s = new Set<string>(STATIC_SANDBOX_NAMES);
  for (const k of SYNTHS) s.delete(k);
  return s;
})();

export function tokenColor(kind: TokenKind): string {
  switch (kind) {
    case 'keyword': return COLORS.tokKeyword;
    case 'builtin': return COLORS.tokBuiltin;
    case 'synth':   return COLORS.tokSynth;
    case 'sample':  return COLORS.tokSynth; // project samples share the synth tone
    case 'string':  return COLORS.tokString;
    case 'number':  return COLORS.tokNumber;
    case 'comment': return COLORS.tokComment;
    case 'punct':   return COLORS.tokPunct;
    case 'text':    return COLORS.tokText;
  }
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_BODY = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;
const PUNCT = /[(){}\[\];,.<>:=+\-*/%&|!?~^]/;

/** Tokenize a single line. The line MUST NOT contain '\n' — call
 *  `tokenize(source)` for multi-line input. */
export function tokenizeLine(line: string, sampleIds: ReadonlySet<string>): Token[] {
  const out: Token[] = [];
  let i = 0;
  const N = line.length;

  while (i < N) {
    const ch = line[i];

    // Line comment — eats the rest of the line.
    if (ch === '/' && line[i + 1] === '/') {
      out.push({ text: line.slice(i), kind: 'comment' });
      break;
    }

    // String — single, double, or backtick. No interpolation handling;
    // the whole literal is one 'string' token.
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < N) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line[j] === quote) { j += 1; break; }
        j += 1;
      }
      out.push({ text: line.slice(i, j), kind: 'string' });
      i = j;
      continue;
    }

    // Number — integer or decimal. No exponent or hex for v1.
    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(line[i + 1] ?? ''))) {
      let j = i;
      while (j < N && (DIGIT.test(line[j]) || line[j] === '.')) j += 1;
      out.push({ text: line.slice(i, j), kind: 'number' });
      i = j;
      continue;
    }

    // Identifier — classify via lookup tables.
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < N && IDENT_BODY.test(line[j])) j += 1;
      const word = line.slice(i, j);
      let kind: TokenKind = 'text';
      if (KEYWORDS.has(word)) kind = 'keyword';
      else if (SYNTHS.has(word)) kind = 'synth';
      else if (BUILTINS.has(word)) kind = 'builtin';
      else if (sampleIds.has(word)) kind = 'sample';
      out.push({ text: word, kind });
      i = j;
      continue;
    }

    // Whitespace — passes through as 'text' so its color matches the
    // surrounding text (no flashing of a different color between tokens).
    if (ch === ' ' || ch === '\t') {
      let j = i;
      while (j < N && (line[j] === ' ' || line[j] === '\t')) j += 1;
      out.push({ text: line.slice(i, j), kind: 'text' });
      i = j;
      continue;
    }

    // Punctuation — single char.
    if (PUNCT.test(ch)) {
      out.push({ text: ch, kind: 'punct' });
      i += 1;
      continue;
    }

    // Fallback — anything else (unicode letters not caught above, etc.)
    out.push({ text: ch, kind: 'text' });
    i += 1;
  }

  return out;
}

/** Tokenize a full multi-line source into the colorRows shape the host
 *  TextEditor primitive expects. The sample id set is passed in so
 *  project samples get the synth color (rather than falling back to
 *  plain text). */
export function tokenizeToColorRows(source: string, sampleIds: ReadonlySet<string>): ColorRow[][] {
  return source.split('\n').map((line) =>
    tokenizeLine(line, sampleIds).map((tok) => ({
      text: tok.text,
      color: tokenColor(tok.kind),
    })),
  );
}
