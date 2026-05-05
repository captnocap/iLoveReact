import { defineGalleryDataStory, defineGallerySection } from '../types';
import {
  promptCompositionMockData,
  promptCompositionReferences,
  promptCompositionSchema,
} from '../data/composition/prompt-composition';

export const promptCompositionSection = defineGallerySection({
  id: "prompt-composition",
  title: "Prompt Composition",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "prompt-composition/catalog",
      title: "Prompt Composition",
      source: "cart/app/gallery/data/composition/prompt-composition.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-document"],
      references: promptCompositionReferences,
      schema: promptCompositionSchema,
      mockData: promptCompositionMockData,
    }),
  ],
});
