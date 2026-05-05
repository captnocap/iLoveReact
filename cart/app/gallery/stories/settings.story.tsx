import { defineGalleryDataStory, defineGallerySection } from '../types';
import { settingsMockData, settingsReferences, settingsSchema } from '../data/core/settings';

export const settingsSection = defineGallerySection({
  id: "settings",
  title: "Settings",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "settings/catalog",
      title: "Settings",
      source: "cart/app/gallery/data/settings.ts",
      format: 'data',
      status: 'draft',
      tags: ["configuration", "profile", "identity"],
      storage: ["json-file"],
      references: settingsReferences,
      schema: settingsSchema,
      mockData: settingsMockData,
    }),
  ],
});
