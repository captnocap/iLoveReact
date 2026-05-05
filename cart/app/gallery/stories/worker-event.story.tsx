import { defineGalleryDataStory, defineGallerySection } from '../types';
import { workerEventMockData, workerEventReferences, workerEventSchema } from '../data/core/worker-event';

export const workerEventSection = defineGallerySection({
  id: 'worker-event',
  title: 'Worker Event',
  group: {
    id: 'data-shapes',
    title: 'Data Shapes',
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'worker-event/catalog',
      title: 'Worker Event',
      source: 'cart/app/gallery/data/worker-event.ts',
      format: 'data',
      status: 'draft',
      summary:
        'Normalized per-event rows emitted by cockpit providers. These should land in a related event table keyed by worker session instead of staying in one appended JSON blob.',
      tags: ['data-shape', 'cockpit', 'ffi', 'worker'],
      storage: ['sqlite-table'],
      references: workerEventReferences,
      schema: workerEventSchema,
      mockData: workerEventMockData,
    }),
  ],
});
