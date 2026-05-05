import { defineGalleryDataStory, defineGallerySection } from '../types';
import { retrievalQueryMockData, retrievalQueryReferences, retrievalQuerySchema } from '../data/composition/retrieval-query';

export const retrievalQuerySection = defineGallerySection({
  id: "retrieval-query",
  title: "Retrieval Query",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "retrieval-query/catalog",
      title: "Retrieval Query",
      source: "cart/app/gallery/data/retrieval-query.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-table"],
      references: retrievalQueryReferences,
      schema: retrievalQuerySchema,
      mockData: retrievalQueryMockData,
    }),
  ],
});
