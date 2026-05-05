import { defineGalleryDataStory, defineGallerySection } from '../types';
import {
  characterQuirkMockData,
  characterQuirkReferences,
  characterQuirkSchema,
} from '../data/overstock/character-quirk';

export const characterQuirkSection = defineGallerySection({
  id: 'character-quirk',
  title: 'Character quirk',
  group: { id: 'data-shapes', title: 'Data Shapes' },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'character-quirk/catalog',
      title: 'Character quirk',
      source: 'cart/app/gallery/data/character-quirk.ts',
      format: 'data',
      status: 'draft',
      tags: ['character', 'quirk', 'voice'],
      storage: ['localstore'],
      references: characterQuirkReferences,
      schema: characterQuirkSchema,
      mockData: characterQuirkMockData,
    }),
  ],
});
