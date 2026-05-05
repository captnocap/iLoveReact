import { defineGalleryDataStory, defineGallerySection } from '../types';
import { connectionMockData, connectionReferences, connectionSchema } from '../data/core/connection';

export const connectionSection = defineGallerySection({
  id: "connection",
  title: "Connection",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "connection/catalog",
      title: "Connection",
      source: "cart/app/gallery/data/connection.ts",
      format: 'data',
      status: 'draft',
      tags: ["credential", "connection"],
      storage: ["atomic-file-to-db"],
      references: connectionReferences,
      schema: connectionSchema,
      mockData: connectionMockData,
    }),
  ],
});
