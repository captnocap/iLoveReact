import { defineGalleryDataStory, defineGallerySection } from '../types';
import { inferenceRequestMockData, inferenceRequestReferences, inferenceRequestSchema } from '../data/core/inference-request';

export const inferenceRequestSection = defineGallerySection({
  id: "inference-request",
  title: "Inference Request",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "inference-request/catalog",
      title: "Inference Request",
      source: "cart/app/gallery/data/inference-request.ts",
      format: 'data',
      status: 'draft',
      tags: ["inference", "audit", "worker"],
      storage: ["sqlite-table"],
      references: inferenceRequestReferences,
      schema: inferenceRequestSchema,
      mockData: inferenceRequestMockData,
    }),
  ],
});
