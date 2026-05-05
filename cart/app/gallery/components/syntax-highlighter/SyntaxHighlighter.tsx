// SyntaxHighlighter — gallery atom bound to the `CodeLine` data shape.
//
// Source of truth: cart/app/gallery/data/code-line.ts

import { classifiers as S } from '@reactjit/core';
import { Box, Text } from '@reactjit/runtime/primitives';
import type { CodeLine } from '../../data/overstock/code-line';
import type { CodeSnippet } from '../../data/overstock/code-snippet';

export type SyntaxHighlighterProps = {
  row: CodeLine;
  wrap?: boolean;
};

type SyntaxKind =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'function'
  | 'type'
  | 'property'
  | 'punctuation'
  | 'operator'
  | 'tag'
  | 'meta';

type SyntaxToken = {
  text: string;
  kind: SyntaxKind;
};

type TokenizeState = {
  inBlockComment: boolean;
};

const JS_KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
  'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'if',
  'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'of', 'return', 'satisfies',
  'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'var', 'void',
  'while', 'yield',
]);

const ZIG_KEYWORDS = new Set([
  'align', 'allowzero', 'and', 'anyframe', 'anytype', 'asm', 'async', 'await', 'break', 'callconv',
  'catch', 'comptime', 'const', 'continue', 'defer', 'else', 'enum', 'errdefer', 'error', 'export',
  'extern', 'false', 'fn', 'for', 'if', 'inline', 'noalias', 'null', 'opaque', 'or', 'orelse',
  'packed', 'pub', 'resume', 'return', 'struct', 'suspend', 'switch', 'test', 'threadlocal',
  'true', 'try', 'undefined', 'union', 'unreachable', 'usingnamespace', 'var', 'volatile', 'while',
]);

const PY_KEYWORDS = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
  'else', 'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'None', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while',
  'with', 'yield',
]);

const SHELL_KEYWORDS = new Set([
  'case', 'do', 'done', 'elif', 'else', 'esac', 'export', 'fi', 'for', 'function', 'if', 'in',
  'local', 'readonly', 'select', 'set', 'shift', 'then', 'until', 'while',
]);

function getSyntaxComponent(kind: SyntaxKind): any {
  if (kind === 'keyword') return S.SyntaxKeyword || S.SyntaxPlain || Text;
  if (kind === 'string') return S.SyntaxString || S.SyntaxPlain || Text;
  if (kind === 'number') return S.SyntaxNumber || S.SyntaxPlain || Text;
  if (kind === 'comment') return S.SyntaxComment || S.SyntaxPlain || Text;
  if (kind === 'function') return S.SyntaxFunction || S.SyntaxPlain || Text;
  if (kind === 'type') return S.SyntaxType || S.SyntaxPlain || Text;
  if (kind === 'property') return S.SyntaxProperty || S.SyntaxPlain || Text;
  if (kind === 'punctuation') return S.SyntaxPunctuation || S.SyntaxPlain || Text;
  if (kind === 'operator') return S.SyntaxOperator || S.SyntaxPlain || Text;
  if (kind === 'tag') return S.SyntaxTag || S.SyntaxPlain || Text;
  if (kind === 'meta') return S.SyntaxMeta || S.SyntaxPlain || Text;
  return S.SyntaxPlain || Text;
}

function isWordStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isWordPart(char: string): boolean {
  return /[A-Za-z0-9_$-]/.test(char);
}

function takeString(line: string, start: number): number {
  const quote = line[start];
  let index = start + 1;
  while (index < line.length) {
    if (line[index] === '\\') {
      index += 2;
      continue;
    }
    if (line[index] === quote) return index + 1;
    index += 1;
  }
  return line.length;
}

function takeNumber(line: string, start: number): number {
  const match = line.slice(start).match(/^-?(0x[0-9a-fA-F_]+|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?)/);
  return start + (match ? match[0].length : 1);
}

function previousNonSpace(line: string, index: number): string {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!/\s/.test(line[i])) return line[i];
  }
  return '';
}

function nextNonSpace(line: string, index: number): string {
  for (let i = index; i < line.length; i += 1) {
    if (!/\s/.test(line[i])) return line[i];
  }
  return '';
}

function classifyWord(word: string, line: string, start: number, language: CodeLine['language']): SyntaxKind {
  const keywordSet =
    language === 'zig' ? ZIG_KEYWORDS :
    language === 'python' ? PY_KEYWORDS :
    language === 'shell' ? SHELL_KEYWORDS :
    JS_KEYWORDS;

  if (keywordSet.has(word)) return 'keyword';
  if (language === 'shell' && word.startsWith('$')) return 'meta';
  if (previousNonSpace(line, start) === '.') return 'property';
  if (nextNonSpace(line, start + word.length) === '(') return 'function';
  if (/^[A-Z]/.test(word) || (language === 'zig' && word.startsWith('@'))) return 'type';
  return 'plain';
}

function pushToken(tokens: SyntaxToken[], text: string, kind: SyntaxKind): void {
  if (!text) return;
  const prev = tokens[tokens.length - 1];
  if (prev?.kind === kind) {
    prev.text += text;
  } else {
    tokens.push({ text, kind });
  }
}

function tokenizeJsonLine(line: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (/\s/.test(char)) {
      pushToken(tokens, char, 'plain');
      index += 1;
      continue;
    }
    if (char === '"') {
      const end = takeString(line, index);
      const kind = nextNonSpace(line, end) === ':' ? 'property' : 'string';
      pushToken(tokens, line.slice(index, end), kind);
      index = end;
      continue;
    }
    if (/[0-9-]/.test(char)) {
      const end = takeNumber(line, index);
      pushToken(tokens, line.slice(index, end), 'number');
      index = end;
      continue;
    }
    if (/[A-Za-z]/.test(char)) {
      let end = index + 1;
      while (end < line.length && /[A-Za-z]/.test(line[end])) end += 1;
      pushToken(tokens, line.slice(index, end), 'keyword');
      index = end;
      continue;
    }
    pushToken(tokens, char, '{}[],:'.includes(char) ? 'punctuation' : 'operator');
    index += 1;
  }
  return tokens.length ? tokens : [{ text: ' ', kind: 'plain' }];
}

function tokenizeCodeLine(line: string, language: CodeLine['language'], state: TokenizeState): SyntaxToken[] {
  if (language === 'json') return tokenizeJsonLine(line);
  if (language === 'text') return [{ text: line || ' ', kind: 'plain' }];

  const tokens: SyntaxToken[] = [];
  let index = 0;
  if (state.inBlockComment) {
    const close = line.indexOf('*/');
    if (close < 0) return [{ text: line || ' ', kind: 'comment' }];
    pushToken(tokens, line.slice(0, close + 2), 'comment');
    state.inBlockComment = false;
    index = close + 2;
  }

  while (index < line.length) {
    const char = line[index];
    const rest = line.slice(index);

    if (/\s/.test(char)) {
      pushToken(tokens, char, 'plain');
      index += 1;
      continue;
    }
    if (rest.startsWith('//') || (language === 'shell' && char === '#') || (language === 'python' && char === '#')) {
      pushToken(tokens, rest, 'comment');
      break;
    }
    if (rest.startsWith('/*')) {
      const close = line.indexOf('*/', index + 2);
      const end = close >= 0 ? close + 2 : line.length;
      pushToken(tokens, line.slice(index, end), 'comment');
      if (close < 0) state.inBlockComment = true;
      index = end;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const end = takeString(line, index);
      pushToken(tokens, line.slice(index, end), 'string');
      index = end;
      continue;
    }
    if (/[0-9]/.test(char)) {
      const end = takeNumber(line, index);
      pushToken(tokens, line.slice(index, end), 'number');
      index = end;
      continue;
    }
    if ((language === 'tsx' || language === 'ts' || language === 'js') && char === '<' && /[A-Za-z/]/.test(line[index + 1] || '')) {
      pushToken(tokens, '<', 'punctuation');
      index += 1;
      continue;
    }
    if (isWordStart(char) || (language === 'zig' && char === '@') || (language === 'shell' && char === '$')) {
      let end = index + 1;
      while (end < line.length && isWordPart(line[end])) end += 1;
      const word = line.slice(index, end);
      const prev = previousNonSpace(line, index);
      const kind = prev === '<' || prev === '/' ? 'tag' : classifyWord(word, line, index, language);
      pushToken(tokens, word, kind);
      index = end;
      continue;
    }
    pushToken(tokens, char, '{}[]().,;:'.includes(char) ? 'punctuation' : 'operator');
    index += 1;
  }
  return tokens.length ? tokens : [{ text: ' ', kind: 'plain' }];
}

export function splitSnippetIntoCodeLines(snippet: CodeSnippet): CodeLine[] {
  const highlighted = new Set(snippet.emphasisLines || []);
  const state: TokenizeState = { inBlockComment: false };
  return snippet.code
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((text, index) => {
      const startsInBlockComment = state.inBlockComment;
      tokenizeCodeLine(text, snippet.language, state);
      return {
        id: `${snippet.id}-line-${index + 1}`,
        snippetId: snippet.id,
        lineNumber: index + 1,
        text,
        language: snippet.language,
        highlighted: highlighted.has(index + 1),
        startsInBlockComment,
      };
    });
}

export function SyntaxHighlighter({ row, wrap = false }: SyntaxHighlighterProps) {
  const LineContent = S.CodeLineContent || Box;
  const state: TokenizeState = { inBlockComment: row.startsInBlockComment };
  const tokens = tokenizeCodeLine(row.text, row.language, state);

  return (
    <LineContent style={{ flexWrap: wrap ? 'wrap' : 'nowrap' }}>
      {tokens.map((token, index) => {
        const Token = getSyntaxComponent(token.kind);
        return <Token key={`${row.id}-${index}`}>{token.text}</Token>;
      })}
    </LineContent>
  );
}
