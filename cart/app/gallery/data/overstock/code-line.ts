import type { GalleryDataReference, JsonObject } from '../../types';
import type { CodeSnippetLanguage } from './code-snippet';

export type CodeLine = {
  id: string;
  snippetId: string;
  lineNumber: number;
  text: string;
  language: CodeSnippetLanguage;
  highlighted: boolean;
  startsInBlockComment: boolean;
};

export const codeLineSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'CodeLine',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'snippetId', 'lineNumber', 'text', 'language', 'highlighted', 'startsInBlockComment'],
  properties: {
    id: { type: 'string' },
    snippetId: { type: 'string' },
    lineNumber: { type: 'number' },
    text: { type: 'string' },
    language: { type: 'string', enum: ['tsx', 'ts', 'js', 'json', 'zig', 'python', 'shell', 'text'] },
    highlighted: { type: 'boolean' },
    startsInBlockComment: { type: 'boolean' },
  },
};

export const codeLineMockData: CodeLine[] = [
  {
    id: 'code-line-001',
    snippetId: 'code-snippet-001',
    lineNumber: 8,
    text: '    <S.CodeBlockFrame data-tone={tone}>',
    language: 'tsx',
    highlighted: true,
    startsInBlockComment: false,
  },
  {
    id: 'code-line-002',
    snippetId: 'code-snippet-002',
    lineNumber: 3,
    text: '  "keyword": "theme:accent",',
    language: 'json',
    highlighted: true,
    startsInBlockComment: false,
  },
];

export const codeLineReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Snippet',
    targetSource: 'cart/app/gallery/data/code-snippet.ts',
    sourceField: 'snippetId',
    targetField: 'id',
    summary: 'A rendered line belongs to the source snippet it was split from.',
  },
];
