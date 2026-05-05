import { defineGalleryDataStory, defineGallerySection } from '../types';
import { chartDemoData, chartDemoDataReferences, chartDemoDataSchema } from '../data/overstock/chart-demo-data';

export const chartDemoDataSection = defineGallerySection({
  id: 'chart-demo-data',
  title: 'Chart Demo Data',
  group: {
    id: 'data-shapes',
    title: 'Data Shapes',
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'chart-demo-data/catalog',
      title: 'Chart Demo Data',
      source: 'cart/app/gallery/data/chart-demo-data.ts',
      format: 'data',
      status: 'ready',
      summary:
        'Shared mock contract for the chart gallery atoms. This is the object the timeline, grouped bar, tracking, bubble, fan, and population pyramid demos are converging on.',
      tags: ['data-shape', 'demo-data', 'charts'],
      storage: ['sqlite-document'],
      references: chartDemoDataReferences,
      schema: chartDemoDataSchema,
      mockData: chartDemoData,
    }),
  ],
});
