import { defineGalleryDataStory, defineGallerySection } from '../types';
import { inferencePresetMockData, inferencePresetReferences, inferencePresetSchema } from '../data/core/inference-preset';

export const inferencePresetSection = defineGallerySection({
  id: "inference-preset",
  title: "Inference Preset",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "inference-preset/catalog",
      title: "Inference Preset",
      source: "cart/app/gallery/data/inference-preset.ts",
      format: 'data',
      status: 'draft',
      tags: ["preset", "inference", "identity"],
      storage: ["json-file"],
      references: inferencePresetReferences,
      schema: inferencePresetSchema,
      mockData: inferencePresetMockData,
    }),
  ],
});
