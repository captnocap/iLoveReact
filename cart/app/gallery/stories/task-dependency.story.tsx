import { defineGalleryDataStory, defineGallerySection } from '../types';
import { taskDependencyMockData, taskDependencyReferences, taskDependencySchema } from '../data/overstock/task-dependency';

export const taskDependencySection = defineGallerySection({
  id: "task-dependency",
  title: "Task Dependency",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "task-dependency/catalog",
      title: "Task Dependency",
      source: "cart/app/gallery/data/task-dependency.ts",
      format: 'data',
      status: 'draft',
      tags: ["task", "dependency", "graph"],
      storage: ["sqlite-table"],
      references: taskDependencyReferences,
      schema: taskDependencySchema,
      mockData: taskDependencyMockData,
    }),
  ],
});
