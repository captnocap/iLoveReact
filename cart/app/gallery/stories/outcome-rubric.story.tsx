import { defineGalleryDataStory, defineGallerySection } from '../types';
import { outcomeRubricMockData, outcomeRubricReferences, outcomeRubricSchema } from '../data/composition/outcome-rubric';

export const outcomeRubricSection = defineGallerySection({
  id: "outcome-rubric",
  title: "Outcome Rubric",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "outcome-rubric/catalog",
      title: "Outcome Rubric",
      source: "cart/app/gallery/data/outcome-rubric.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-document"],
      references: outcomeRubricReferences,
      schema: outcomeRubricSchema,
      mockData: outcomeRubricMockData,
    }),
  ],
});
