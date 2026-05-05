import { defineGallerySection, defineGalleryStory } from '../types';
import { CodeCopyButton } from '../components/code-copy-button/CodeCopyButton';
import { codeSnippetMockData } from '../data/overstock/code-snippet';
import type { CodeSnippet } from '../data/overstock/code-snippet';

const codeSnippetRows = Array.isArray(codeSnippetMockData)
  ? codeSnippetMockData
  : [codeSnippetMockData as CodeSnippet];

export const codeCopyButtonSection = defineGallerySection({
  id: "code-copy-button",
  title: "Code Copy Button",
  group: {
    id: "controls",
    title: "Controls & Cards",
  },
  kind: "atom",
  stories: [
    defineGalleryStory({
      id: "code-copy-button/default",
      title: "Code Copy Button",
      source: "cart/app/gallery/components/code-copy-button/CodeCopyButton.tsx",
      status: 'ready',
      summary: 'Clipboard action atom for code-oriented source rows.',
      tags: ["button", "card", "data"],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <CodeCopyButton row={codeSnippetRows[0]} />,
        },
      ],
    }),
  ],
});
