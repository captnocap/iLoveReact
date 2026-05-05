import { defineGalleryDataStory, defineGallerySection } from '../types';
import {
  calendarDimensionMockData,
  calendarDimensionReferences,
  calendarDimensionSchema,
} from '../data/overstock/calendar-dimension';

export const calendarDimensionSection = defineGallerySection({
  id: 'calendar-dimension',
  title: 'Calendar Dimension',
  group: {
    id: 'data-shapes',
    title: 'Data Shapes',
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'calendar-dimension/catalog',
      title: 'Calendar Dimension',
      source: 'cart/app/gallery/data/calendar-dimension.ts',
      format: 'data',
      status: 'draft',
      summary:
        'Normalized calendar lookup rows for month, quarter, and day labels that chart documents can reference instead of storing repeated strings inline.',
      tags: ['data-shape', 'dimension', 'calendar', 'charts'],
      storage: ['sqlite-table'],
      references: calendarDimensionReferences,
      schema: calendarDimensionSchema,
      mockData: calendarDimensionMockData,
    }),
  ],
});
