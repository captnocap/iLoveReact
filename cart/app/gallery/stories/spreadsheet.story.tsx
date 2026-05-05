import { defineGallerySection, defineGalleryStory } from '../types';
import { spreadsheetMockData } from '../data/overstock/spreadsheet';
import { Spreadsheet } from '../components/spreadsheet/Spreadsheet';

export const spreadsheetSection = defineGallerySection({
  id: 'spreadsheet',
  title: 'Spreadsheet',
  group: {
    id: 'compositions',
    title: 'Compositions',
  },
  kind: 'top-level',
  composedOf: [
    'cart/app/gallery/components/spreadsheet/SpreadsheetTopBar.tsx',
    'cart/app/gallery/components/spreadsheet/SpreadsheetFormulaBar.tsx',
    'cart/app/gallery/components/spreadsheet/SpreadsheetGrid.tsx',
    'cart/app/gallery/components/spreadsheet/SpreadsheetMetricStrip.tsx',
    'cart/app/gallery/components/spreadsheet/SpreadsheetStatusBar.tsx',
  ],
  stories: [
    defineGalleryStory({
      id: 'spreadsheet/default',
      title: 'Spreadsheet',
      source: 'cart/app/gallery/components/spreadsheet/Spreadsheet.tsx',
      status: 'ready',
      tags: ['table', 'input', 'panel'],
      variants: [
        {
          id: 'default',
          name: 'Native-grid shell',
          render: () => <Spreadsheet workbook={spreadsheetMockData[0]} />,
        },
      ],
    }),
  ],
});
