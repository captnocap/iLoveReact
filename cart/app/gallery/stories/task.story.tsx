import { defineGalleryDataStory, defineGallerySection } from '../types';
import { taskMockData, taskReferences, taskSchema } from '../data/overstock/task';

export const taskSection = defineGallerySection({
  id: "task",
  title: "Task",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "task/catalog",
      title: "Task",
      source: "cart/app/gallery/data/task.ts",
      format: 'data',
      status: 'draft',
      tags: ["task", "work", "worker"],
      storage: ["sqlite-table"],
      references: taskReferences,
      schema: taskSchema,
      mockData: taskMockData,
    }),
  ],
});
