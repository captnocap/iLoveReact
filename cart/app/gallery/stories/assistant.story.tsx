import { defineGalleryDataStory, defineGallerySection } from '../types';
import { assistantMockData, assistantReferences, assistantSchema } from '../data/core/assistant';

export const assistantSection = defineGallerySection({
  id: 'assistant',
  title: 'Assistant',
  group: { id: 'data-shapes', title: 'Data Shapes' },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'assistant/catalog',
      title: 'Assistant',
      source: 'cart/app/gallery/data/assistant.ts',
      format: 'data',
      status: 'draft',
      tags: ['assistant', 'identity', 'memory'],
      storage: ['sqlite-table'],
      references: assistantReferences,
      schema: assistantSchema,
      mockData: assistantMockData,
    }),
  ],
});
