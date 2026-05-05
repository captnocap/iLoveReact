import { defineGalleryDataStory, defineGallerySection } from '../types';
import { taskGraphMockData, taskGraphReferences, taskGraphSchema } from '../data/overstock/task-graph';

export const taskGraphSection = defineGallerySection({
  id: "task-graph",
  title: "Task Graph",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "task-graph/catalog",
      title: "Task Graph",
      source: "cart/app/gallery/data/task-graph.ts",
      format: 'data',
      status: 'draft',
      tags: ["task", "graph", "dag"],
      storage: ["sqlite-document"],
      references: taskGraphReferences,
      schema: taskGraphSchema,
      mockData: taskGraphMockData,
    }),
  ],
});
