import { defineGalleryDataStory, defineGallerySection } from '../types';
import { avatarMockData, avatarReferences, avatarSchema } from '../data/overstock/avatar';

export const avatarSection = defineGallerySection({
  id: 'avatar',
  title: 'Avatar',
  group: { id: 'data-shapes', title: 'Data Shapes' },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'avatar/catalog',
      title: 'Avatar',
      source: 'cart/app/gallery/data/avatar.ts',
      format: 'data',
      status: 'draft',
      tags: ['avatar', '3d', 'visual'],
      storage: ['localstore'],
      references: avatarReferences,
      schema: avatarSchema,
      mockData: avatarMockData,
    }),
  ],
});
