import { defineGalleryDataStory, defineGallerySection } from '../types';
import { taskClaimMockData, taskClaimReferences, taskClaimSchema } from '../data/overstock/task-claim';

export const taskClaimSection = defineGallerySection({
  id: "task-claim",
  title: "Task Claim",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "task-claim/catalog",
      title: "Task Claim",
      source: "cart/app/gallery/data/task-claim.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-table"],
      references: taskClaimReferences,
      schema: taskClaimSchema,
      mockData: taskClaimMockData,
    }),
  ],
});
