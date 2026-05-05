import { defineGalleryDataStory, defineGallerySection } from '../types';
import { eventMockData, eventReferences, eventSchema } from '../data/core/event';

export const eventSection = defineGallerySection({
  id: "event",
  title: "Event",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "event/catalog",
      title: "Event",
      source: "cart/app/gallery/data/event.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-table"],
      references: eventReferences,
      schema: eventSchema,
      mockData: eventMockData,
    }),
  ],
});
