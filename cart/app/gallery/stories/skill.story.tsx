import { defineGalleryDataStory, defineGallerySection } from '../types';
import { skillMockData, skillReferences, skillSchema } from '../data/overstock/skill';

export const skillSection = defineGallerySection({
  id: "skill",
  title: "Skill",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "skill/catalog",
      title: "Skill",
      source: "cart/app/gallery/data/skill.ts",
      format: 'data',
      status: 'draft',
      tags: ["skill", "capability", "prompt"],
      storage: ["json-file"],
      references: skillReferences,
      schema: skillSchema,
      mockData: skillMockData,
    }),
  ],
});
