import { defineGalleryDataStory, defineGallerySection } from '../types';
import { workspaceMockData, workspaceReferences, workspaceSchema } from '../data/overstock/workspace';

export const workspaceSection = defineGallerySection({
  id: "workspace",
  title: "Workspace",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "workspace/catalog",
      title: "Workspace",
      source: "cart/app/gallery/data/workspace.ts",
      format: 'data',
      status: 'draft',
      tags: ["workspace", "scope", "root"],
      storage: ["json-file"],
      references: workspaceReferences,
      schema: workspaceSchema,
      mockData: workspaceMockData,
    }),
  ],
});
