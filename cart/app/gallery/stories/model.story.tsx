import { defineGalleryDataStory, defineGallerySection } from '../types';
import { modelMockData, modelReferences, modelSchema } from '../data/core/model';

export const modelSection = defineGallerySection({
  id: "model",
  title: "Model",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "model/catalog",
      title: "Model",
      source: "cart/app/gallery/data/model.ts",
      format: 'data',
      status: 'draft',
      tags: ["catalog", "model"],
      storage: ["json-file"],
      references: modelReferences,
      schema: modelSchema,
      mockData: modelMockData,
    }),
  ],
});
