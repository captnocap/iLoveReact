import { defineGalleryDataStory, defineGallerySection } from '../types';
import { promptTemplateMockData, promptTemplateReferences, promptTemplateSchema } from '../data/composition/prompt-template';

export const promptTemplateSection = defineGallerySection({
  id: "prompt-template",
  title: "Prompt Template",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "prompt-template/catalog",
      title: "Prompt Template",
      source: "cart/app/gallery/data/prompt-template.ts",
      format: 'data',
      status: 'draft',
      tags: ["prompt", "settings"],
      storage: ["json-file"],
      references: promptTemplateReferences,
      schema: promptTemplateSchema,
      mockData: promptTemplateMockData,
    }),
  ],
});
