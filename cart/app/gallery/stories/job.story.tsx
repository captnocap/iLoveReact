import { defineGalleryDataStory, defineGallerySection } from '../types';
import { jobMockData, jobReferences, jobSchema } from '../data/core/job';

export const jobSection = defineGallerySection({
  id: "job",
  title: "Job",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "job/catalog",
      title: "Job",
      source: "cart/app/gallery/data/job.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-document"],
      references: jobReferences,
      schema: jobSchema,
      mockData: jobMockData,
    }),
  ],
});
