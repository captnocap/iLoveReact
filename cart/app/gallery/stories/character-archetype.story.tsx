import { defineGalleryDataStory, defineGallerySection } from '../types';
import {
  characterArchetypeMockData,
  characterArchetypeReferences,
  characterArchetypeSchema,
} from '../data/overstock/character-archetype';

export const characterArchetypeSection = defineGallerySection({
  id: 'character-archetype',
  title: 'Character archetype',
  group: { id: 'data-shapes', title: 'Data Shapes' },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'character-archetype/catalog',
      title: 'Character archetype',
      source: 'cart/app/gallery/data/character-archetype.ts',
      format: 'data',
      status: 'draft',
      tags: ['character', 'archetype', 'template'],
      storage: ['localstore'],
      references: characterArchetypeReferences,
      schema: characterArchetypeSchema,
      mockData: characterArchetypeMockData,
    }),
  ],
});
