import { defineGalleryDataStory, defineGallerySection } from '../types';
import {
  characterCompatibilityMockData,
  characterCompatibilityReferences,
  characterCompatibilitySchema,
} from '../data/overstock/character-compatibility';

export const characterCompatibilitySection = defineGallerySection({
  id: 'character-compatibility',
  title: 'Character compatibility',
  group: { id: 'data-shapes', title: 'Data Shapes' },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'character-compatibility/catalog',
      title: 'Character compatibility',
      source: 'cart/app/gallery/data/character-compatibility.ts',
      format: 'data',
      status: 'draft',
      tags: ['character', 'manifest', 'friction'],
      storage: ['localstore'],
      references: characterCompatibilityReferences,
      schema: characterCompatibilitySchema,
      mockData: characterCompatibilityMockData,
    }),
  ],
});
