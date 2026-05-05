import type { GalleryDataReference, JsonObject } from '../../types';

export type CodeSnippetLanguage =
  | 'tsx'
  | 'ts'
  | 'js'
  | 'json'
  | 'zig'
  | 'python'
  | 'shell'
  | 'text';

export type CodeSnippet = {
  id: string;
  title: string;
  filename?: string;
  language: CodeSnippetLanguage;
  code: string;
  showLineNumbers: boolean;
  wrap: boolean;
  emphasisLines?: number[];
};

export const codeSnippetSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'CodeSnippet',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'language', 'code', 'showLineNumbers', 'wrap'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    filename: { type: 'string' },
    language: { type: 'string', enum: ['tsx', 'ts', 'js', 'json', 'zig', 'python', 'shell', 'text'] },
    code: { type: 'string' },
    showLineNumbers: { type: 'boolean' },
    wrap: { type: 'boolean' },
    emphasisLines: {
      type: 'array',
      items: { type: 'number' },
    },
  },
};

export const codeSnippetMockData: CodeSnippet[] = [
  {
    id: 'code-snippet-001',
    title: 'Theme-aware TSX',
    filename: 'CodeBlock.tsx',
    language: 'tsx',
    showLineNumbers: true,
    wrap: false,
    emphasisLines: [8, 15],
    code: [
      'import { classifiers as S } from \'@reactjit/core\';',
      '',
      'type Tone = \'info\' | \'success\' | \'danger\';',
      '',
      'export function Notice({ tone, children }: { tone: Tone; children: any }) {',
      '  const active = tone === \'success\';',
      '  return (',
      '    <S.CodeBlockFrame data-tone={tone}>',
      '      <S.CodeBlockHeader>',
      '        <S.SyntaxKeyword>{active ? \'ready\' : \'review\'}</S.SyntaxKeyword>',
      '      </S.CodeBlockHeader>',
      '      <S.CodeBlockBody>{children}</S.CodeBlockBody>',
      '    </S.CodeBlockFrame>',
      '  );',
      '}',
    ].join('\n'),
  },
  {
    id: 'code-snippet-002',
    title: 'Runtime token payload',
    filename: 'theme.json',
    language: 'json',
    showLineNumbers: true,
    wrap: true,
    emphasisLines: [3],
    code: [
      '{',
      '  "surface": "theme:bg2",',
      '  "keyword": "theme:accent",',
      '  "literal": "theme:ok",',
      '  "lineHeight": 1.35,',
      '  "enabled": true',
      '}',
    ].join('\n'),
  },
];

export const codeSnippetReferences: GalleryDataReference[] = [];
