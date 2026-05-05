import { defineGalleryDataStory, defineGallerySection } from '../types';
import { embeddingModelMockData, embeddingModelReferences, embeddingModelSchema } from '../data/overstock/embedding-model';

export const embeddingModelSection = defineGallerySection({
  id: "embedding-model",
  title: "Embedding Model",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "embedding-model/catalog",
      title: "Embedding Model",
      source: "cart/app/gallery/data/embedding-model.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["json-file"],
      references: embeddingModelReferences,
      schema: embeddingModelSchema,
      mockData: embeddingModelMockData,
    }),
  ],
});
