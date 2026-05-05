import { defineGalleryDataStory, defineGallerySection } from '../types';
import { roleMockData, roleReferences, roleSchema } from '../data/core/role';

export const roleSection = defineGallerySection({
  id: "role",
  title: "Role",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "role/catalog",
      title: "Role",
      source: "cart/app/gallery/data/role.ts",
      format: 'data',
      status: 'draft',
      tags: ["role", "persona", "skill"],
      storage: ["json-file"],
      references: roleReferences,
      schema: roleSchema,
      mockData: roleMockData,
    }),
  ],
});
