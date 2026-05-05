import { defineGalleryDataStory, defineGallerySection } from '../types';
import { codexRawEventMockData, codexRawEventReferences, codexRawEventSchema } from '../data/core/codex-raw-event';

export const codexRawEventSection = defineGallerySection({
  id: "codex-raw-event",
  title: "Codex Raw Event",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "codex-raw-event/catalog",
      title: "Codex Raw Event",
      source: "cart/app/gallery/data/codex-raw-event.ts",
      format: 'data',
      status: 'draft',
      tags: ["raw-event", "codex", "openai", "contract"],
      storage: ["json-file"],
      references: codexRawEventReferences,
      schema: codexRawEventSchema,
      mockData: codexRawEventMockData,
    }),
  ],
});
