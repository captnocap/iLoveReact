import { defineGalleryDataStory, defineGallerySection } from '../types';
import { compositionSourceKindMockData, compositionSourceKindReferences, compositionSourceKindSchema } from '../data/composition/composition-source-kind';

export const compositionSourceKindSection = defineGallerySection({
  id: "composition-source-kind",
  title: "Composition Source Kind",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "composition-source-kind/catalog",
      title: "Composition Source Kind",
      source: "cart/app/gallery/data/composition-source-kind.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["json-file"],
      references: compositionSourceKindReferences,
      schema: compositionSourceKindSchema,
      mockData: compositionSourceKindMockData,
    }),
  ],
});
