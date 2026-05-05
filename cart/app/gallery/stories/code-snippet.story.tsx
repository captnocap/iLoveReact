import { defineGalleryDataStory, defineGallerySection } from '../types';
import { codeSnippetMockData, codeSnippetReferences, codeSnippetSchema } from '../data/overstock/code-snippet';

export const codeSnippetSection = defineGallerySection({
  id: "code-snippet",
  title: "Code Snippet",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "code-snippet/catalog",
      title: "Code Snippet",
      source: "cart/app/gallery/data/code-snippet.ts",
      format: 'data',
      status: 'ready',
      tags: ["data"],
      storage: ["json-file"],
      references: codeSnippetReferences,
      schema: codeSnippetSchema,
      mockData: codeSnippetMockData,
    }),
  ],
});
