import { defineGalleryDataStory, defineGallerySection } from '../types';
import { ruleMockData, ruleReferences, ruleSchema } from '../data/core/rule';

export const ruleSection = defineGallerySection({
  id: "rule",
  title: "Rule",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "rule/catalog",
      title: "Rule",
      source: "cart/app/gallery/data/core/rule.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-document"],
      references: ruleReferences,
      schema: ruleSchema,
      mockData: ruleMockData,
    }),
  ],
});
