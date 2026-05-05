import { defineGalleryDataStory, defineGallerySection } from '../types';
import { budgetMockData, budgetReferences, budgetSchema } from '../data/overstock/budget';

export const budgetSection = defineGallerySection({
  id: "budget",
  title: "Budget",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "budget/catalog",
      title: "Budget",
      source: "cart/app/gallery/data/budget.ts",
      format: 'data',
      status: 'draft',
      tags: ["budget", "policy", "spending"],
      storage: ["json-file"],
      references: budgetReferences,
      schema: budgetSchema,
      mockData: budgetMockData,
    }),
  ],
});
