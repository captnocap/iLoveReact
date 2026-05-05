import { defineGalleryDataStory, defineGallerySection } from '../types';
import { embeddingMockData, embeddingReferences, embeddingSchema } from '../data/overstock/embedding';

export const embeddingSection = defineGallerySection({
  id: "embedding",
  title: "Embedding",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "embedding/catalog",
      title: "Embedding",
      source: "cart/app/gallery/data/embedding.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-table"],
      references: embeddingReferences,
      schema: embeddingSchema,
      mockData: embeddingMockData,
    }),
  ],
});
