import { defineGalleryDataStory, defineGallerySection } from '../types';
import {
  workerSessionMockData,
  workerSessionReferences,
  workerSessionSchema,
} from '../data/core/worker-session';

export const workerSessionSection = defineGallerySection({
  id: 'worker-session',
  title: 'Worker Session',
  group: {
    id: 'data-shapes',
    title: 'Data Shapes',
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'worker-session/catalog',
      title: 'Worker Session',
      source: 'cart/app/gallery/data/worker-session.ts',
      format: 'data',
      status: 'draft',
      summary:
        'Session header rows for cockpit providers so event streams, model identity, timing, and accounting can normalize into related tables.',
      tags: ['data-shape', 'cockpit', 'worker', 'session'],
      storage: ['sqlite-table'],
      references: workerSessionReferences,
      schema: workerSessionSchema,
      mockData: workerSessionMockData,
    }),
  ],
});
