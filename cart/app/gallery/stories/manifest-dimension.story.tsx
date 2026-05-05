import { defineGalleryDataStory, defineGallerySection } from '../types';
import {
  manifestDimensionDefMockData,
  manifestDimensionDefReferences,
  manifestDimensionDefSchema,
} from '../data/overstock/manifest-dimension';

export const manifestDimensionSection = defineGallerySection({
  id: 'manifest-dimension',
  title: 'Manifest dimension',
  group: { id: 'data-shapes', title: 'Data Shapes' },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'manifest-dimension/catalog',
      title: 'Manifest dimension',
      source: 'cart/app/gallery/data/manifest-dimension.ts',
      format: 'data',
      status: 'draft',
      tags: ['manifest', 'dimension', 'catalog'],
      storage: ['localstore'],
      references: manifestDimensionDefReferences,
      schema: manifestDimensionDefSchema,
      mockData: manifestDimensionDefMockData,
    }),
  ],
});
