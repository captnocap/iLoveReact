import { defineGalleryDataStory, defineGallerySection } from '../types';
import { projectMockData, projectReferences, projectSchema } from '../data/overstock/project';

export const projectSection = defineGallerySection({
  id: "project",
  title: "Project",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "project/catalog",
      title: "Project",
      source: "cart/app/gallery/data/project.ts",
      format: 'data',
      status: 'draft',
      tags: ["project", "workspace", "scope"],
      storage: ["json-file"],
      references: projectReferences,
      schema: projectSchema,
      mockData: projectMockData,
    }),
  ],
});
