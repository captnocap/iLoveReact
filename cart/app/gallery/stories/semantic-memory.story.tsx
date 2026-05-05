import { defineGalleryDataStory, defineGallerySection } from '../types';
import { semanticMemoryMockData, semanticMemoryReferences, semanticMemorySchema } from '../data/core/semantic-memory';

export const semanticMemorySection = defineGallerySection({
  id: "semantic-memory",
  title: "Semantic Memory",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "semantic-memory/catalog",
      title: "Semantic Memory",
      source: "cart/app/gallery/data/semantic-memory.ts",
      format: 'data',
      status: 'draft',
      tags: ["memory", "facts", "knowledge"],
      storage: ["atomic-file-to-db"],
      references: semanticMemoryReferences,
      schema: semanticMemorySchema,
      mockData: semanticMemoryMockData,
    }),
  ],
});
