import { defineGalleryDataStory, defineGallerySection } from '../types';
import {
  personalityDialMockData,
  personalityDialReferences,
  personalityDialSchema,
} from '../data/overstock/personality-dial';

export const personalityDialSection = defineGallerySection({
  id: 'personality-dial',
  title: 'Personality dial',
  group: { id: 'data-shapes', title: 'Data Shapes' },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'personality-dial/catalog',
      title: 'Personality dial',
      source: 'cart/app/gallery/data/personality-dial.ts',
      format: 'data',
      status: 'draft',
      tags: ['character', 'dial', 'spectrum'],
      storage: ['localstore'],
      references: personalityDialReferences,
      schema: personalityDialSchema,
      mockData: personalityDialMockData,
    }),
  ],
});
