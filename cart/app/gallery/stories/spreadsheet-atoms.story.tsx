import { defineGallerySection, defineGalleryStory, type GallerySection } from '../types';
import { spreadsheetMockData } from '../data/overstock/spreadsheet';
import { SpreadsheetFormulaBar } from '../components/spreadsheet/SpreadsheetFormulaBar';
import { SpreadsheetGrid } from '../components/spreadsheet/SpreadsheetGrid';
import { SpreadsheetMetricStrip } from '../components/spreadsheet/SpreadsheetMetricStrip';
import { SpreadsheetStatusBar } from '../components/spreadsheet/SpreadsheetStatusBar';
import { SpreadsheetTopBar } from '../components/spreadsheet/SpreadsheetTopBar';
import { emptySpreadsheetNativeState } from '../data/overstock/spreadsheet';
import { classifiers as S } from '@reactjit/core';

const workbook = spreadsheetMockData[0];
const state = {
  ...emptySpreadsheetNativeState,
  address: 'B2',
  rawInput: '1200',
  draftInput: '1200',
  value: 1200,
  valueType: 'number' as const,
  valueDisplay: '1200',
};

function AtomPad({ children, height = 110 }: { children: any; height?: number }) {
  return (
    <S.SpreadsheetAtomPad style={{ height }}>
      {children}
    </S.SpreadsheetAtomPad>
  );
}

function section(id: string, title: string, source: string, render: () => any): GallerySection {
  return defineGallerySection({
    id,
    title,
    group: {
      id: 'controls',
      title: 'Controls & Cards',
    },
    kind: 'atom',
    stories: [
      defineGalleryStory({
        id: `${id}/default`,
        title,
        source,
        status: 'ready',
        tags: ['table', 'input', 'panel'],
        variants: [
          {
            id: 'default',
            name: 'Default',
            render,
          },
        ],
      }),
    ],
  });
}

export const spreadsheetTopBarSection = section(
  'spreadsheet-top-bar',
  'Spreadsheet Top Bar',
  'cart/app/gallery/components/spreadsheet/SpreadsheetTopBar.tsx',
  () => (
    <AtomPad>
      <SpreadsheetTopBar title={workbook.title} subtitle={workbook.subtitle} state={state} />
    </AtomPad>
  ),
);

export const spreadsheetFormulaBarSection = section(
  'spreadsheet-formula-bar',
  'Spreadsheet Formula Bar',
  'cart/app/gallery/components/spreadsheet/SpreadsheetFormulaBar.tsx',
  () => (
    <AtomPad>
      <SpreadsheetFormulaBar state={state} adjustments={workbook.quickAdjustments} />
    </AtomPad>
  ),
);

export const spreadsheetMetricStripSection = section(
  'spreadsheet-metric-strip',
  'Spreadsheet Metric Strip',
  'cart/app/gallery/components/spreadsheet/SpreadsheetMetricStrip.tsx',
  () => (
    <AtomPad>
      <SpreadsheetMetricStrip metrics={workbook.metrics} />
    </AtomPad>
  ),
);

export const spreadsheetStatusBarSection = section(
  'spreadsheet-status-bar',
  'Spreadsheet Status Bar',
  'cart/app/gallery/components/spreadsheet/SpreadsheetStatusBar.tsx',
  () => (
    <AtomPad>
      <SpreadsheetStatusBar state={state} rows={workbook.rows} cols={workbook.cols} />
    </AtomPad>
  ),
);

export const spreadsheetGridSection = section(
  'spreadsheet-grid',
  'Spreadsheet Native Grid',
  'cart/app/gallery/components/spreadsheet/SpreadsheetGrid.tsx',
  () => (
    <AtomPad height={280}>
      <SpreadsheetGrid
        rows={workbook.rows}
        cols={workbook.cols}
        cells={workbook.cells}
        selectedAddress={workbook.selectedAddress}
        columnWidth={workbook.columnWidth}
        columnWidths={workbook.columnWidths}
        fitColumnsToViewport={workbook.fitColumnsToViewport}
        theme={workbook.theme}
      />
    </AtomPad>
  ),
);

export const spreadsheetAtomSections = [
  spreadsheetTopBarSection,
  spreadsheetFormulaBarSection,
  spreadsheetMetricStripSection,
  spreadsheetStatusBarSection,
  spreadsheetGridSection,
];
