import { defineGalleryDataStory, defineGallerySection } from '../types';
import { characterMockData, characterReferences, characterSchema } from '../data/core/character';

export const characterSection = defineGallerySection({
  id: 'character',
  title: 'Character',
  group: { id: 'data-shapes', title: 'Data Shapes' },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'character/catalog',
      title: 'Character',
      source: 'cart/app/gallery/data/character.ts',
      format: 'data',
      status: 'draft',
      tags: ['character', 'persona', 'voice'],
      storage: ['localstore'],
      references: characterReferences,
      schema: characterSchema,
      mockData: characterMockData,
    }),
  ],
});
