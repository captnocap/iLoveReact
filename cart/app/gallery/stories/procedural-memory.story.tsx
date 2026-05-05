import { defineGalleryDataStory, defineGallerySection } from '../types';
import { proceduralMemoryMockData, proceduralMemoryReferences, proceduralMemorySchema } from '../data/core/procedural-memory';

export const proceduralMemorySection = defineGallerySection({
  id: "procedural-memory",
  title: "Procedural Memory",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "procedural-memory/catalog",
      title: "Procedural Memory",
      source: "cart/app/gallery/data/procedural-memory.ts",
      format: 'data',
      status: 'draft',
      tags: ["memory", "playbook", "skill"],
      storage: ["atomic-file-to-db"],
      references: proceduralMemoryReferences,
      schema: proceduralMemorySchema,
      mockData: proceduralMemoryMockData,
    }),
  ],
});
