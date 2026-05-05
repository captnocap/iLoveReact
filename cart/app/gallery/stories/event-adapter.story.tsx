import { defineGalleryDataStory, defineGallerySection } from '../types';
import { eventAdapterMockData, eventAdapterReferences, eventAdapterSchema } from '../data/core/event-adapter';

export const eventAdapterSection = defineGallerySection({
  id: "event-adapter",
  title: "Event Adapter",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "event-adapter/catalog",
      title: "Event Adapter",
      source: "cart/app/gallery/data/event-adapter.ts",
      format: 'data',
      status: 'draft',
      tags: ["adapter", "contract", "normalization"],
      storage: ["json-file"],
      references: eventAdapterReferences,
      schema: eventAdapterSchema,
      mockData: eventAdapterMockData,
    }),
  ],
});
