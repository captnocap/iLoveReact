import { defineGalleryDataStory, defineGallerySection } from '../types';
import { compositionMockData, compositionReferences, compositionSchema } from '../data/composition/composition';

export const compositionSection = defineGallerySection({
  id: "composition",
  title: "Composition",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "composition/catalog",
      title: "Composition",
      source: "cart/app/gallery/data/composition.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-document"],
      references: compositionReferences,
      schema: compositionSchema,
      mockData: compositionMockData,
    }),
  ],
});
