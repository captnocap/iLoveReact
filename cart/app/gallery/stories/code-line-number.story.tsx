import { defineGallerySection, defineGalleryStory } from '../types';
import { CodeLineNumber } from '../components/code-line-number/CodeLineNumber';
import { codeLineMockData } from '../data/overstock/code-line';

export const codeLineNumberSection = defineGallerySection({
  id: "code-line-number",
  title: "Code Line Number",
  group: {
    id: "controls",
    title: "Controls & Cards",
  },
  kind: "atom",
  stories: [
    defineGalleryStory({
      id: "code-line-number/default",
      title: "Code Line Number",
      source: "cart/app/gallery/components/code-line-number/CodeLineNumber.tsx",
      status: 'ready',
      summary: 'Reusable monospace gutter atom for numbered code rows.',
      tags: ["data"],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <CodeLineNumber row={codeLineMockData[0]} />,
        },
      ],
    }),
  ],
});
