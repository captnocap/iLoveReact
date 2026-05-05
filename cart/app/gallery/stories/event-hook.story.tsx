import { defineGalleryDataStory, defineGallerySection } from '../types';
import { eventHookMockData, eventHookReferences, eventHookSchema } from '../data/core/event-hook';

export const eventHookSection = defineGallerySection({
  id: "event-hook",
  title: "Event Hook",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "event-hook/catalog",
      title: "Event Hook",
      source: "cart/app/gallery/data/event-hook.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-document"],
      references: eventHookReferences,
      schema: eventHookSchema,
      mockData: eventHookMockData,
    }),
  ],
});
