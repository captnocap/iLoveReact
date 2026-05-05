import { defineGalleryDataStory, defineGallerySection } from '../types';
import { systemMessageMockData, systemMessageReferences, systemMessageSchema } from '../data/composition/system-message';

export const systemMessageSection = defineGallerySection({
  id: "system-message",
  title: "System Message",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "system-message/catalog",
      title: "System Message",
      source: "cart/app/gallery/data/system-message.ts",
      format: 'data',
      status: 'draft',
      tags: ["prompt", "settings"],
      storage: ["json-file"],
      references: systemMessageReferences,
      schema: systemMessageSchema,
      mockData: systemMessageMockData,
    }),
  ],
});
