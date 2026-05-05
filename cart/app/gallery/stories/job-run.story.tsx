import { defineGalleryDataStory, defineGallerySection } from '../types';
import { jobRunMockData, jobRunReferences, jobRunSchema } from '../data/core/job-run';

export const jobRunSection = defineGallerySection({
  id: "job-run",
  title: "Job Run",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "job-run/catalog",
      title: "Job Run",
      source: "cart/app/gallery/data/job-run.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-table"],
      references: jobRunReferences,
      schema: jobRunSchema,
      mockData: jobRunMockData,
    }),
  ],
});
