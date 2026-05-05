import { defineGalleryDataStory, defineGallerySection } from '../types';
import { supervisorMockData, supervisorReferences, supervisorSchema } from '../data/core/supervisor';

export const supervisorSection = defineGallerySection({
  id: 'supervisor',
  title: 'Supervisor',
  group: { id: 'data-shapes', title: 'Data Shapes' },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'supervisor/catalog',
      title: 'Supervisor',
      source: 'cart/app/gallery/data/supervisor.ts',
      format: 'data',
      status: 'draft',
      tags: ['supervisor', 'orchestration', 'workers'],
      storage: ['sqlite-table'],
      references: supervisorReferences,
      schema: supervisorSchema,
      mockData: supervisorMockData,
    }),
  ],
});
