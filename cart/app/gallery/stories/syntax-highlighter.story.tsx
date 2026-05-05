import { defineGallerySection, defineGalleryStory } from '../types';
import { SyntaxHighlighter } from '../components/syntax-highlighter/SyntaxHighlighter';
import { codeLineMockData } from '../data/overstock/code-line';

export const syntaxHighlighterSection = defineGallerySection({
  id: "syntax-highlighter",
  title: "Syntax Highlighter",
  group: {
    id: "controls",
    title: "Controls & Cards",
  },
  kind: "atom",
  stories: [
    defineGalleryStory({
      id: "syntax-highlighter/default",
      title: "Syntax Highlighter",
      source: "cart/app/gallery/components/syntax-highlighter/SyntaxHighlighter.tsx",
      status: 'ready',
      summary: 'Reusable token renderer mapped to the active gallery theme tokens.',
      tags: ["panel", "data"],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <SyntaxHighlighter row={codeLineMockData[0]} />,
        },
      ],
    }),
  ],
});
