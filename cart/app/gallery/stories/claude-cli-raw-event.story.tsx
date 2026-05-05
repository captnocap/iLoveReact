import { defineGalleryDataStory, defineGallerySection } from '../types';
import { claudeCliRawEventMockData, claudeCliRawEventReferences, claudeCliRawEventSchema } from '../data/core/claude-cli-raw-event';

export const claudeCliRawEventSection = defineGallerySection({
  id: "claude-cli-raw-event",
  title: "Claude Cli Raw Event",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "claude-cli-raw-event/catalog",
      title: "Claude Cli Raw Event",
      source: "cart/app/gallery/data/claude-cli-raw-event.ts",
      format: 'data',
      status: 'draft',
      tags: ["raw-event", "claude-cli", "contract"],
      storage: ["json-file"],
      references: claudeCliRawEventReferences,
      schema: claudeCliRawEventSchema,
      mockData: claudeCliRawEventMockData,
    }),
  ],
});
