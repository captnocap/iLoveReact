import { defineGalleryDataStory, defineGallerySection } from '../types';
import { mergeProposalMockData, mergeProposalReferences, mergeProposalSchema } from '../data/overstock/merge-proposal';

export const mergeProposalSection = defineGallerySection({
  id: "merge-proposal",
  title: "Merge Proposal",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "merge-proposal/catalog",
      title: "Merge Proposal",
      source: "cart/app/gallery/data/merge-proposal.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-document"],
      references: mergeProposalReferences,
      schema: mergeProposalSchema,
      mockData: mergeProposalMockData,
    }),
  ],
});
