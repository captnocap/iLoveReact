import { defineGalleryDataStory, defineGallerySection } from '../types';
import { capabilityMockData, capabilityReferences, capabilitySchema } from '../data/overstock/capability';

export const capabilitySection = defineGallerySection({
  id: "capability",
  title: "Capability",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "capability/catalog",
      title: "Capability",
      source: "cart/app/gallery/data/capability.ts",
      format: 'data',
      status: 'draft',
      tags: ["catalog", "capability"],
      storage: ["json-file"],
      references: capabilityReferences,
      schema: capabilitySchema,
      mockData: capabilityMockData,
    }),
  ],
});
