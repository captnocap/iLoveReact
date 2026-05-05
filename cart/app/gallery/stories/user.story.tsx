import { defineGalleryDataStory, defineGallerySection } from '../types';
import { userMockData, userReferences, userSchema } from '../data/core/user';

export const userSection = defineGallerySection({
  id: "user",
  title: "User",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "user/catalog",
      title: "User",
      source: "cart/app/gallery/data/user.ts",
      format: 'data',
      status: 'draft',
      tags: ["identity", "catalog"],
      storage: ["json-file"],
      references: userReferences,
      schema: userSchema,
      mockData: userMockData,
    }),
  ],
});
