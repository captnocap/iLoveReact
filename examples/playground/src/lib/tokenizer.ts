/**
 * tokenizer.ts — JSX syntax highlighting tokenizer.
 */

export type TokenType =
  | 'keyword' | 'string' | 'number' | 'comment'
  | 'component' | 'tag' | 'prop'
  | 'identifier' | 'punctuation' | 'text';

export interface Token { text: string; type: TokenType; }

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for',
  'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this',
  'class', 'extends', 'import', 'export', 'from', 'default', 'true',
  'false', 'null', 'undefined', 'typeof', 'instanceof', 'in', 'of',
  'try', 'catch', 'finally', 'throw', 'async', 'await', 'yield',
]);

export const TOKEN_COLORS: Record<TokenType, string> = {
  keyword: '#c678dd', string: '#98c379', number: '#d19a66',
  comment: '#5c6370', component: '#61afef', tag: '#e06c75',
  prop: '#d19a66', identifier: '#abb2bf', punctuation: '#636d83', text: '#abb2bf',
};

export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let inJSXTag = false;

  while (i < line.length) {
    const ch = line[i];

    if (ch === '/' && line[i + 1] === '/') { tokens.push({ text: line.slice(i), type: 'comment' }); break; }

    if (ch === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end >= 0) { tokens.push({ text: line.slice(i, end + 2), type: 'comment' }); i = end + 2; }
      else { tokens.push({ text: line.slice(i), type: 'comment' }); break; }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < line.length && line[j] !== quote) { if (line[j] === '\\') j++; j++; }
      if (j < line.length) j++;
      tokens.push({ text: line.slice(i, j), type: 'string' }); i = j; continue;
    }

    if (ch === '<' && line[i + 1] === '/') {
      tokens.push({ text: '</', type: 'tag' }); i += 2; inJSXTag = true;
      const s = i; while (i < line.length && /[a-zA-Z0-9_.]/.test(line[i])) i++;
      if (i > s) { const n = line.slice(s, i); tokens.push({ text: n, type: n[0] >= 'A' && n[0] <= 'Z' ? 'component' : 'tag' }); }
      continue;
    }

    if (ch === '<' && i + 1 < line.length) {
      const next = line[i + 1];
      if (next === '>') { tokens.push({ text: '<>', type: 'tag' }); i += 2; continue; }
      if (/[a-zA-Z]/.test(next)) {
        tokens.push({ text: '<', type: 'tag' }); i += 1; inJSXTag = true;
        const s = i; while (i < line.length && /[a-zA-Z0-9_.]/.test(line[i])) i++;
        if (i > s) { const n = line.slice(s, i); tokens.push({ text: n, type: n[0] >= 'A' && n[0] <= 'Z' ? 'component' : 'tag' }); }
        continue;
      }
    }

    if (ch === '/' && line[i + 1] === '>') { tokens.push({ text: '/>', type: 'tag' }); i += 2; inJSXTag = false; continue; }
    if (ch === '>' && inJSXTag) { tokens.push({ text: '>', type: 'tag' }); i += 1; inJSXTag = false; continue; }

    if (/[0-9]/.test(ch)) {
      const s = i;
      if (ch === '0' && (line[i+1] === 'x' || line[i+1] === 'X')) { i += 2; while (i < line.length && /[0-9a-fA-F]/.test(line[i])) i++; }
      else { while (i < line.length && /[0-9.]/.test(line[i])) i++; }
      tokens.push({ text: line.slice(s, i), type: 'number' }); continue;
    }

    if (/[a-zA-Z_$]/.test(ch)) {
      const s = i; while (i < line.length && /[a-zA-Z0-9_$]/.test(line[i])) i++;
      const w = line.slice(s, i);
      if (inJSXTag && line[i] === '=') tokens.push({ text: w, type: 'prop' });
      else if (KEYWORDS.has(w)) tokens.push({ text: w, type: 'keyword' });
      else tokens.push({ text: w, type: 'identifier' });
      continue;
    }

    if (/\s/.test(ch)) { const s = i; while (i < line.length && /\s/.test(line[i])) i++; tokens.push({ text: line.slice(s, i), type: 'text' }); continue; }

    if ('{}()[];:,.=+->!&|?'.includes(ch)) {
      const three = line.slice(i, i + 3);
      const two = line.slice(i, i + 2);
      if (three === '===' || three === '!==' || three === '...') { tokens.push({ text: three, type: 'punctuation' }); i += 3; }
      else if (two === '=>' || two === '==' || two === '!=' || two === '&&' || two === '||') { tokens.push({ text: two, type: 'punctuation' }); i += 2; }
      else { tokens.push({ text: ch, type: 'punctuation' }); i += 1; }
      continue;
    }

    tokens.push({ text: ch, type: 'text' }); i += 1;
  }
  return tokens;
}
