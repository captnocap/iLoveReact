import { defineGallerySection, defineGalleryStory } from '../types';
import { CodeBlock } from '../components/code-block/CodeBlock';
import { codeSnippetMockData } from '../data/overstock/code-snippet';
import type { CodeSnippet } from '../data/overstock/code-snippet';

const codeSnippetRows = Array.isArray(codeSnippetMockData)
  ? codeSnippetMockData
  : [codeSnippetMockData as CodeSnippet];

export const codeBlockSection = defineGallerySection({
  id: "code-block",
  title: "Code Block",
  group: {
    id: "compositions",
    title: "Compositions",
  },
  kind: "top-level",
  composedOf: [
    "cart/app/gallery/components/code-line-number/CodeLineNumber.tsx",
    "cart/app/gallery/components/syntax-highlighter/SyntaxHighlighter.tsx",
    "cart/app/gallery/components/code-copy-button/CodeCopyButton.tsx",
  ],
  stories: [
    defineGalleryStory({
      id: "code-block/default",
      title: "Code Block",
      source: "cart/app/gallery/components/code-block/CodeBlock.tsx",
      status: 'ready',
      summary: 'Top-level code surface composed from reusable line-number, syntax-highlight, and copy-button atoms.',
      tags: ["button", "card", "panel", "data"],
      variants: [
        {
          id: 'default',
          name: 'TSX',
          render: () => <CodeBlock row={codeSnippetRows[0]} />,
        },
        {
          id: 'json',
          name: 'JSON',
          render: () => <CodeBlock row={codeSnippetRows[1] || codeSnippetRows[0]} />,
        },
      ],
    }),
  ],
});
