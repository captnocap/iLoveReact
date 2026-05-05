import { defineGalleryDataStory, defineGallerySection } from '../types';
import { gitActivityMockData, gitActivityReferences, gitActivitySchema } from '../data/overstock/git-activity';

export const gitActivitySection = defineGallerySection({
  id: "git-activity",
  title: "Git Activity",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "git-activity/catalog",
      title: "Git Activity",
      source: "cart/app/gallery/data/git-activity.ts",
      format: 'data',
      status: 'ready',
      tags: ["data"],
      storage: ["sqlite-table", "json-file"],
      references: gitActivityReferences,
      schema: gitActivitySchema,
      mockData: gitActivityMockData,
    }),
  ],
});
