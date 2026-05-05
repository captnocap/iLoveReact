import { defineGalleryDataStory, defineGallerySection } from '../types';
import { envVarMockData, envVarReferences, envVarSchema } from '../data/overstock/env-var';

export const envVarSection = defineGallerySection({
  id: "env-var",
  title: "Env Var",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "env-var/catalog",
      title: "Env Var",
      source: "cart/app/gallery/data/env-var.ts",
      format: 'data',
      status: 'draft',
      tags: ["catalog", "connection", "claude-code"],
      storage: ["json-file"],
      references: envVarReferences,
      schema: envVarSchema,
      mockData: envVarMockData,
    }),
  ],
});
