import { defineGalleryDataStory, defineGallerySection } from '../types';
import { mergeConflictMockData, mergeConflictReferences, mergeConflictSchema } from '../data/overstock/merge-conflict';

export const mergeConflictSection = defineGallerySection({
  id: "merge-conflict",
  title: "Merge Conflict",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "merge-conflict/catalog",
      title: "Merge Conflict",
      source: "cart/app/gallery/data/merge-conflict.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-document"],
      references: mergeConflictReferences,
      schema: mergeConflictSchema,
      mockData: mergeConflictMockData,
    }),
  ],
});
