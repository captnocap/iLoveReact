import { defineGalleryDataStory, defineGallerySection } from '../types';
import { planningPhaseMockData, planningPhaseReferences, planningPhaseSchema } from '../data/composition/planning-phase';

export const planningPhaseSection = defineGallerySection({
  id: "planning-phase",
  title: "Planning Phase",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "planning-phase/catalog",
      title: "Planning Phase",
      source: "cart/app/gallery/data/planning-phase.ts",
      format: 'data',
      status: 'draft',
      tags: ["plan", "phase", "lifecycle"],
      storage: ["json-file"],
      references: planningPhaseReferences,
      schema: planningPhaseSchema,
      mockData: planningPhaseMockData,
    }),
  ],
});
