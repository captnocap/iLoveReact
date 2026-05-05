import { defineGalleryDataStory, defineGallerySection } from '../types';
import { constraintMockData, constraintReferences, constraintSchema } from '../data/core/constraint';

export const constraintSection = defineGallerySection({
  id: "constraint",
  title: "Constraint",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "constraint/catalog",
      title: "Constraint",
      source: "cart/app/gallery/data/constraint.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-document"],
      references: constraintReferences,
      schema: constraintSchema,
      mockData: constraintMockData,
    }),
  ],
});
