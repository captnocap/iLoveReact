import { defineGalleryDataStory, defineGallerySection } from '../types';
import { privacyMockData, privacyReferences, privacySchema } from '../data/core/privacy';

export const privacySection = defineGallerySection({
  id: "privacy",
  title: "Privacy",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "privacy/catalog",
      title: "Privacy",
      source: "cart/app/gallery/data/privacy.ts",
      format: 'data',
      status: 'draft',
      tags: ["privacy", "policy", "security"],
      storage: ["json-file"],
      references: privacyReferences,
      schema: privacySchema,
      mockData: privacyMockData,
    }),
  ],
});
