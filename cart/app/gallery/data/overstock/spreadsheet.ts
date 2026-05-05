import type { JsonObject } from '../../types';

export type SpreadsheetScalar = string | number | boolean;

export type SpreadsheetCellMap = Record<string, SpreadsheetScalar>;

export type SpreadsheetValueType = 'empty' | 'text' | 'number' | 'boolean';

export type SpreadsheetGridTheme = {
  bg: string;
  bgAlt: string;
  surface: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentSoft: string;
  error: string;
};

export type SpreadsheetNativeState = {
  address: string;
  rawInput: string;
  draftInput: string;
  value: SpreadsheetScalar | '';
  error?: string;
  editing: boolean;
  valueType: SpreadsheetValueType;
  valueDisplay: string;
  errorCount: number;
};

export type SpreadsheetQuickAdjustment = {
  id: string;
  label: string;
  delta: number;
};

export type SpreadsheetMetric = {
  id: string;
  label: string;
  value: string;
  tone: 'neutral' | 'accent' | 'error';
};

export type SpreadsheetWorkbook = {
  id: string;
  title: string;
  subtitle?: string;
  rows: number;
  cols: number;
  cells: SpreadsheetCellMap;
  selectedAddress: string;
  readOnly?: boolean;
  columnWidth?: number;
  columnWidths?: number[];
  minColumnWidth?: number;
  maxColumnWidth?: number;
  fitColumnsToViewport?: boolean;
  resizableColumns?: boolean;
  rowHeight?: number;
  autoScrollToSelection?: boolean;
  theme: SpreadsheetGridTheme;
  metrics: SpreadsheetMetric[];
  quickAdjustments: SpreadsheetQuickAdjustment[];
};

export const defaultSpreadsheetTheme: SpreadsheetGridTheme = {
  bg: 'theme:bg2',
  bgAlt: 'theme:bg2',
  surface: 'theme:paperRule',
  border: 'theme:inkGhost',
  text: 'theme:ink',
  textDim: 'theme:lilac',
  accent: 'theme:tool',
  accentSoft: 'theme:inkGhost',
  error: 'theme:flag',
};

export const emptySpreadsheetNativeState: SpreadsheetNativeState = {
  address: 'A1',
  rawInput: '',
  draftInput: '',
  value: '',
  editing: false,
  valueType: 'empty',
  valueDisplay: '',
  errorCount: 0,
};

export const spreadsheetMockData: SpreadsheetWorkbook[] = [
  {
    id: 'spreadsheet-quarterly-001',
    title: 'Quarterly Operating Plan',
    subtitle: 'Lua-owned grid with React shell controls',
    rows: 10,
    cols: 6,
    selectedAddress: 'B2',
    columnWidth: 118,
    columnWidths: [126, 112, 112, 112, 132, 140],
    minColumnWidth: 72,
    maxColumnWidth: 460,
    fitColumnsToViewport: true,
    resizableColumns: true,
    rowHeight: 30,
    autoScrollToSelection: true,
    theme: defaultSpreadsheetTheme,
    quickAdjustments: [
      { id: 'minus-100', label: '-100', delta: -100 },
      { id: 'minus-10', label: '-10', delta: -10 },
      { id: 'plus-10', label: '+10', delta: 10 },
      { id: 'plus-100', label: '+100', delta: 100 },
    ],
    metrics: [
      { id: 'errors', label: 'Errors', value: '0', tone: 'neutral' },
      { id: 'mode', label: 'Mode', value: 'editable', tone: 'accent' },
      { id: 'source', label: 'Source', value: 'SpreadsheetGrid', tone: 'neutral' },
    ],
    cells: {
      A1: 'Quarter',
      B1: 'Revenue',
      C1: 'Costs',
      D1: 'Marketing',
      E1: 'Other',
      F1: 'Total',
      A2: 'Q1',
      B2: 1200,
      C2: 800,
      D2: 350,
      E2: 200,
      F2: '=SUM(B2:E2)',
      A3: 'Q2',
      B3: 1400,
      C3: 750,
      D3: 400,
      E3: 180,
      F3: '=SUM(B3:E3)',
      A4: 'Q3',
      B4: 1100,
      C4: 900,
      D4: 280,
      E4: 220,
      F4: '=SUM(B4:E4)',
      A5: 'Q4',
      B5: 1600,
      C5: 850,
      D5: 420,
      E5: 190,
      F5: '=SUM(B5:E5)',
      A6: 'Adj',
      B6: -200,
      C6: -150,
      D6: -80,
      E6: -50,
      F6: '=SUM(B6:E6)',
      A8: 'Revenue avg',
      B8: '=AVERAGE(B2:B5)',
      A9: 'Grand total',
      F9: '=SUM(F2:F6)',
    },
  },
];

export const spreadsheetSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'SpreadsheetWorkbook',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'title', 'rows', 'cols', 'selectedAddress', 'cells', 'theme', 'metrics', 'quickAdjustments'],
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      subtitle: { type: 'string' },
      rows: { type: 'number' },
      cols: { type: 'number' },
      selectedAddress: { type: 'string' },
      readOnly: { type: 'boolean' },
      columnWidth: { type: 'number' },
      columnWidths: { type: 'array', items: { type: 'number' } },
      minColumnWidth: { type: 'number' },
      maxColumnWidth: { type: 'number' },
      fitColumnsToViewport: { type: 'boolean' },
      resizableColumns: { type: 'boolean' },
      rowHeight: { type: 'number' },
      autoScrollToSelection: { type: 'boolean' },
      cells: {
        type: 'object',
        additionalProperties: {
          oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
        },
      },
      theme: {
        type: 'object',
        additionalProperties: false,
        required: ['bg', 'bgAlt', 'surface', 'border', 'text', 'textDim', 'accent', 'accentSoft', 'error'],
        properties: {
          bg: { type: 'string' },
          bgAlt: { type: 'string' },
          surface: { type: 'string' },
          border: { type: 'string' },
          text: { type: 'string' },
          textDim: { type: 'string' },
          accent: { type: 'string' },
          accentSoft: { type: 'string' },
          error: { type: 'string' },
        },
      },
      metrics: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label', 'value', 'tone'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            value: { type: 'string' },
            tone: { type: 'string', enum: ['neutral', 'accent', 'error'] },
          },
        },
      },
      quickAdjustments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label', 'delta'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            delta: { type: 'number' },
          },
        },
      },
    },
  },
};
