import { defineGalleryDataStory, defineGallerySection } from '../types';
import { workerMockData, workerReferences, workerSchema } from '../data/core/worker';

export const workerSection = defineGallerySection({
  id: "worker",
  title: "Worker",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "worker/catalog",
      title: "Worker",
      source: "cart/app/gallery/data/worker.ts",
      format: 'data',
      status: 'draft',
      tags: ["worker", "agent", "session"],
      storage: ["sqlite-document"],
      references: workerReferences,
      schema: workerSchema,
      mockData: workerMockData,
    }),
  ],
});
