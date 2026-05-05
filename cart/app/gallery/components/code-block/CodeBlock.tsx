// CodeBlock — top-level gallery component bound to the `CodeSnippet` data shape.
//
// Composed atoms:
//   - cart/app/gallery/components/code-line-number/CodeLineNumber.tsx
//   - cart/app/gallery/components/syntax-highlighter/SyntaxHighlighter.tsx
//   - cart/app/gallery/components/code-copy-button/CodeCopyButton.tsx

import { classifiers as S } from '@reactjit/core';
import { Box, ScrollView, Text } from '@reactjit/runtime/primitives';
import type { CodeSnippet } from '../../data/overstock/code-snippet';
import { CodeCopyButton } from '../code-copy-button/CodeCopyButton';
import { CodeLineNumber } from '../code-line-number/CodeLineNumber';
import { splitSnippetIntoCodeLines, SyntaxHighlighter } from '../syntax-highlighter/SyntaxHighlighter';

export type CodeBlockProps = {
  row?: Partial<CodeSnippet> | null;
};

const FALLBACK_SNIPPET: CodeSnippet = {
  id: 'code-snippet-fallback',
  title: 'Code Block',
  filename: 'snippet.txt',
  language: 'text',
  code: 'Code snippet unavailable.',
  showLineNumbers: true,
  wrap: true,
};

function normalizeLanguage(value: unknown): CodeSnippet['language'] {
  if (
    value === 'tsx' ||
    value === 'ts' ||
    value === 'js' ||
    value === 'json' ||
    value === 'zig' ||
    value === 'python' ||
    value === 'shell' ||
    value === 'text'
  ) {
    return value;
  }
  return 'text';
}

function normalizeCodeSnippet(row: Partial<CodeSnippet> | null | undefined): CodeSnippet {
  if (!row || typeof row !== 'object') return FALLBACK_SNIPPET;
  const id = typeof row.id === 'string' && row.id ? row.id : FALLBACK_SNIPPET.id;
  const code = typeof row.code === 'string'
    ? row.code
    : typeof (row as any).content === 'string'
      ? (row as any).content
      : FALLBACK_SNIPPET.code;
  return {
    id,
    title: typeof row.title === 'string' && row.title ? row.title : id,
    filename: typeof row.filename === 'string' ? row.filename : undefined,
    language: normalizeLanguage(row.language),
    code,
    showLineNumbers: typeof row.showLineNumbers === 'boolean' ? row.showLineNumbers : true,
    wrap: typeof row.wrap === 'boolean' ? row.wrap : false,
    emphasisLines: Array.isArray(row.emphasisLines)
      ? row.emphasisLines.filter((line): line is number => typeof line === 'number' && Number.isFinite(line))
      : [],
  };
}

function displayLanguage(language: CodeSnippet['language']): string {
  if (language === 'tsx') return 'TSX';
  if (language === 'ts') return 'TypeScript';
  if (language === 'js') return 'JavaScript';
  if (language === 'json') return 'JSON';
  if (language === 'zig') return 'Zig';
  if (language === 'python') return 'Python';
  if (language === 'shell') return 'Shell';
  return 'Text';
}

export function CodeBlock({ row }: CodeBlockProps) {
  const snippet = normalizeCodeSnippet(row);
  const lines = splitSnippetIntoCodeLines(snippet);
  const Frame = S.CodeBlockFrame || Box;
  const Header = S.CodeBlockHeader || Box;
  const Meta = S.CodeBlockMeta || Box;
  const Title = S.CodeBlockTitle || Text;
  const Subtle = S.CodeBlockSubtle || Text;
  const Badge = S.CodeBlockBadge || Box;
  const BadgeText = S.CodeBlockBadgeText || Text;
  const CodeScroll = S.CodeBlockScroll || ScrollView;
  const Body = S.CodeBlockBody || Box;
  const Line = S.CodeLine || Box;
  const LineEmphasis = S.CodeLineEmphasis || Line;
  const HeaderActions = S.InlineX4Center || Box;

  return (
    <Frame>
      <Header>
        <Meta>
          <Title>{snippet.title}</Title>
          <Subtle>{snippet.filename || snippet.id}</Subtle>
        </Meta>
        <HeaderActions>
          <Badge>
            <BadgeText>{displayLanguage(snippet.language)}</BadgeText>
          </Badge>
          <CodeCopyButton row={snippet} />
        </HeaderActions>
      </Header>
      <CodeScroll>
        <Body>
          {lines.map((line) => {
            const LineFrame = line.highlighted ? LineEmphasis : Line;
            return (
              <LineFrame key={line.id}>
                {snippet.showLineNumbers ? <CodeLineNumber row={line} /> : null}
                <SyntaxHighlighter row={line} wrap={snippet.wrap} />
              </LineFrame>
            );
          })}
        </Body>
      </CodeScroll>
    </Frame>
  );
}
