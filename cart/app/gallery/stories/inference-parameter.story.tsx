import { defineGalleryDataStory, defineGallerySection } from '../types';
import { inferenceParameterMockData, inferenceParameterReferences, inferenceParameterSchema } from '../data/core/inference-parameter';

export const inferenceParameterSection = defineGallerySection({
  id: "inference-parameter",
  title: "Inference Parameter",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "inference-parameter/catalog",
      title: "Inference Parameter",
      source: "cart/app/gallery/data/inference-parameter.ts",
      format: 'data',
      status: 'draft',
      tags: ["catalog", "inference", "connection"],
      storage: ["json-file"],
      references: inferenceParameterReferences,
      schema: inferenceParameterSchema,
      mockData: inferenceParameterMockData,
    }),
  ],
});
