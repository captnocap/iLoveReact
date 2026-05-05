import { defineGalleryDataStory, defineGallerySection } from '../types';
import { episodicMemoryMockData, episodicMemoryReferences, episodicMemorySchema } from '../data/core/episodic-memory';

export const episodicMemorySection = defineGallerySection({
  id: "episodic-memory",
  title: "Episodic Memory",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "episodic-memory/catalog",
      title: "Episodic Memory",
      source: "cart/app/gallery/data/episodic-memory.ts",
      format: 'data',
      status: 'draft',
      tags: ["memory", "session", "history"],
      storage: ["sqlite-table"],
      references: episodicMemoryReferences,
      schema: episodicMemorySchema,
      mockData: episodicMemoryMockData,
    }),
  ],
});
