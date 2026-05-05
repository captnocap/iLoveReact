import { defineGalleryDataStory, defineGallerySection } from '../types';
import { budgetLedgerMockData, budgetLedgerReferences, budgetLedgerSchema } from '../data/overstock/budget-ledger';

export const budgetLedgerSection = defineGallerySection({
  id: "budget-ledger",
  title: "Budget Ledger",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "budget-ledger/catalog",
      title: "Budget Ledger",
      source: "cart/app/gallery/data/budget-ledger.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-table"],
      references: budgetLedgerReferences,
      schema: budgetLedgerSchema,
      mockData: budgetLedgerMockData,
    }),
  ],
});
