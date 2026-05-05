import { defineGalleryDataStory, defineGallerySection } from '../types';
import { userInterventionMockData, userInterventionReferences, userInterventionSchema } from '../data/core/user-intervention';

export const userInterventionSection = defineGallerySection({
  id: "user-intervention",
  title: "User Intervention",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "user-intervention/catalog",
      title: "User Intervention",
      source: "cart/app/gallery/data/user-intervention.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-table"],
      references: userInterventionReferences,
      schema: userInterventionSchema,
      mockData: userInterventionMockData,
    }),
  ],
});
