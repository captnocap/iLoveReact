import { defineGalleryDataStory, defineGallerySection } from '../types';
import { codeLineMockData, codeLineReferences, codeLineSchema } from '../data/overstock/code-line';

export const codeLineSection = defineGallerySection({
  id: "code-line",
  title: "Code Line",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "code-line/catalog",
      title: "Code Line",
      source: "cart/app/gallery/data/code-line.ts",
      format: 'data',
      status: 'ready',
      tags: ["data"],
      storage: ["json-file"],
      references: codeLineReferences,
      schema: codeLineSchema,
      mockData: codeLineMockData,
    }),
  ],
});
