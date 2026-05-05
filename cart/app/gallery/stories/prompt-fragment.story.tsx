import { defineGalleryDataStory, defineGallerySection } from '../types';
import { promptFragmentMockData, promptFragmentReferences, promptFragmentSchema } from '../data/composition/prompt-fragment';

export const promptFragmentSection = defineGallerySection({
  id: "prompt-fragment",
  title: "Prompt Fragment",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "prompt-fragment/catalog",
      title: "Prompt Fragment",
      source: "cart/app/gallery/data/prompt-fragment.ts",
      format: 'data',
      status: 'draft',
      tags: ["input", "data"],
      storage: ["sqlite-document"],
      references: promptFragmentReferences,
      schema: promptFragmentSchema,
      mockData: promptFragmentMockData,
    }),
  ],
});
