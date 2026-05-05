import { defineGalleryDataStory, defineGallerySection } from '../types';
import { commandComposerMockData, commandComposerReferences, commandComposerSchema } from '../data/overstock/command-composer';

export const commandComposerSection = defineGallerySection({
  id: "command-composer",
  title: "Command Composer",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "command-composer/catalog",
      title: "Command Composer",
      source: "cart/app/gallery/data/command-composer.ts",
      format: 'data',
      status: 'draft',
      tags: ["input", "data"],
      storage: ["sqlite-document", "json-file"],
      references: commandComposerReferences,
      schema: commandComposerSchema,
      mockData: commandComposerMockData,
    }),
  ],
});
