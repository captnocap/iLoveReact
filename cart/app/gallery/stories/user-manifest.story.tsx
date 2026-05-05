import { defineGalleryDataStory, defineGallerySection } from '../types';
import {
  userManifestMockData,
  userManifestReferences,
  userManifestSchema,
} from '../data/overstock/user-manifest';

export const userManifestSection = defineGallerySection({
  id: 'user-manifest',
  title: 'User manifest',
  group: { id: 'data-shapes', title: 'Data Shapes' },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'user-manifest/catalog',
      title: 'User manifest',
      source: 'cart/app/gallery/data/user-manifest.ts',
      format: 'data',
      status: 'draft',
      tags: ['manifest', 'user', 'inference'],
      storage: ['localstore'],
      references: userManifestReferences,
      schema: userManifestSchema,
      mockData: userManifestMockData,
    }),
  ],
});
