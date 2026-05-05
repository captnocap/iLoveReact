import { classifiers as S } from '@reactjit/core';
import type {
  SpreadsheetCellMap,
  SpreadsheetGridTheme,
  SpreadsheetNativeState,
  SpreadsheetScalar,
} from '../../data/overstock/spreadsheet';
import { defaultSpreadsheetTheme, emptySpreadsheetNativeState } from '../../data/overstock/spreadsheet';

export const SPREADSHEET_NATIVE_TYPE = 'SpreadsheetGrid';

export const SPREADSHEET_NATIVE_EVENTS = {
  state: 'spreadsheet:state',
  select: 'spreadsheet:select',
  change: 'spreadsheet:change',
  columnResize: 'spreadsheet:columnresize',
} as const;

export type SpreadsheetSelectEvent = {
  address: string;
  targetId?: number;
};

export type SpreadsheetCellChangeEvent = {
  address: string;
  input: string;
  targetId?: number;
};

export type SpreadsheetColumnResizeEvent = {
  widths: number[];
  targetId?: number;
};

export type SpreadsheetGridProps = {
  rows: number;
  cols: number;
  cells: SpreadsheetCellMap;
  selectedAddress?: string;
  readOnly?: boolean;
  columnWidth?: number;
  columnWidths?: number[];
  resizableColumns?: boolean;
  minColumnWidth?: number;
  maxColumnWidth?: number;
  fitColumnsToViewport?: boolean;
  rowHeight?: number;
  autoScrollToSelection?: boolean;
  theme?: SpreadsheetGridTheme;
  renderMode?: 'react' | 'native';
  style?: Record<string, unknown>;
  onState?: (state: SpreadsheetNativeState) => void;
  onSelect?: (event: SpreadsheetSelectEvent) => void;
  onCellChange?: (event: SpreadsheetCellChangeEvent) => void;
  onColumnResize?: (event: SpreadsheetColumnResizeEvent) => void;
};

function toText(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value);
}

function toBool(value: unknown): boolean {
  return value === true;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toScalar(value: unknown): SpreadsheetScalar | '' {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return '';
}

function normalizeNativeState(payload: any): SpreadsheetNativeState {
  return {
    address: toText(payload?.address, emptySpreadsheetNativeState.address),
    rawInput: toText(payload?.rawInput),
    draftInput: toText(payload?.draftInput),
    value: toScalar(payload?.value),
    error: payload?.error ? String(payload.error) : undefined,
    editing: toBool(payload?.editing),
    valueType: payload?.valueType || emptySpreadsheetNativeState.valueType,
    valueDisplay: toText(payload?.valueDisplay),
    errorCount: toNumber(payload?.errorCount, 0),
  };
}

function normalizeWidths(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => toNumber(entry)).filter((entry) => entry > 0);
}

const ROW_HEADER_WIDTH = 44;

type EvaluatedCell = {
  rawInput: string;
  value: SpreadsheetScalar | '';
  display: string;
  error?: string;
  isFormula: boolean;
  isNumeric: boolean;
};

function columnLabel(index: number): string {
  let n = index;
  let label = '';
  while (n > 0) {
    n -= 1;
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26);
  }
  return label;
}

function cellAddress(row: number, col: number): string {
  return `${columnLabel(col)}${row}`;
}

function parseAddress(address: string): { row: number; col: number } | null {
  const match = /^([A-Z]+)([0-9]+)$/i.exec(address);
  if (!match) return null;
  const letters = match[1].toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i += 1) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  const row = Number(match[2]);
  return Number.isFinite(row) && row > 0 && col > 0 ? { row, col } : null;
}

function rangeAddresses(range: string): string[] {
  const [startRaw, endRaw] = range.split(':');
  const start = parseAddress(startRaw || '');
  const end = parseAddress(endRaw || startRaw || '');
  if (!start || !end) return [];
  const rowStart = Math.min(start.row, end.row);
  const rowEnd = Math.max(start.row, end.row);
  const colStart = Math.min(start.col, end.col);
  const colEnd = Math.max(start.col, end.col);
  const out: string[] = [];
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      out.push(cellAddress(row, col));
    }
  }
  return out;
}

function displayScalar(value: SpreadsheetScalar | ''): string {
  if (value == null || value === '') return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return String(value);
}

function evaluateCell(cells: SpreadsheetCellMap, address: string, seen: Set<string> = new Set()): EvaluatedCell {
  const raw = cells[address];
  const rawInput = raw == null ? '' : String(raw);
  const isFormula = rawInput.charAt(0) === '=';

  if (!isFormula) {
    const numeric = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw)));
    const value = typeof raw === 'string' && numeric ? Number(raw) : raw ?? '';
    return {
      rawInput,
      value,
      display: displayScalar(value),
      isFormula: false,
      isNumeric: numeric,
    };
  }

  if (seen.has(address)) {
    return { rawInput, value: '', display: '#ERR', error: 'Circular reference', isFormula: true, isNumeric: false };
  }

  const formula = rawInput.slice(1).trim();
  const match = /^(SUM|AVERAGE)\(([^)]+)\)$/i.exec(formula);
  if (!match) {
    return { rawInput, value: '', display: '#ERR', error: 'Unsupported formula', isFormula: true, isNumeric: false };
  }

  seen.add(address);
  const refs = rangeAddresses(match[2].trim());
  const values = refs
    .map((ref) => evaluateCell(cells, ref, seen))
    .filter((entry) => !entry.error && entry.value !== '' && Number.isFinite(Number(entry.value)))
    .map((entry) => Number(entry.value));
  seen.delete(address);

  if (values.length === 0) {
    return { rawInput, value: 0, display: '0', isFormula: true, isNumeric: true };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  const value = match[1].toUpperCase() === 'AVERAGE' ? total / values.length : total;
  return {
    rawInput,
    value,
    display: displayScalar(value),
    isFormula: true,
    isNumeric: true,
  };
}

function stateFromCell(cells: SpreadsheetCellMap, address: string, errorCount = 0): SpreadsheetNativeState {
  const evaluated = evaluateCell(cells, address);
  return {
    address,
    rawInput: evaluated.rawInput,
    draftInput: evaluated.rawInput,
    value: evaluated.value,
    error: evaluated.error,
    editing: false,
    valueType: evaluated.value === '' ? 'empty'
      : typeof evaluated.value === 'boolean' ? 'boolean'
      : evaluated.isNumeric ? 'number'
      : 'text',
    valueDisplay: evaluated.error ? '#ERR' : evaluated.display,
    errorCount,
  };
}

function countFormulaErrors(cells: SpreadsheetCellMap): number {
  let total = 0;
  for (const address of Object.keys(cells)) {
    if (evaluateCell(cells, address).error) total += 1;
  }
  return total;
}

function cellText(evaluated: EvaluatedCell) {
  if (evaluated.error) return <S.SpreadsheetErrorText>{evaluated.display}</S.SpreadsheetErrorText>;
  if (evaluated.isFormula) return <S.SpreadsheetCellFormulaText>{evaluated.display}</S.SpreadsheetCellFormulaText>;
  if (evaluated.isNumeric) return <S.SpreadsheetCellNumberText>{evaluated.display}</S.SpreadsheetCellNumberText>;
  return <S.SpreadsheetCellText>{evaluated.display}</S.SpreadsheetCellText>;
}

export function SpreadsheetGrid({
  rows,
  cols,
  cells,
  selectedAddress = 'A1',
  readOnly = false,
  columnWidth = 118,
  columnWidths,
  resizableColumns = true,
  minColumnWidth = 72,
  maxColumnWidth = 460,
  fitColumnsToViewport = true,
  rowHeight = 30,
  autoScrollToSelection = true,
  theme = defaultSpreadsheetTheme,
  renderMode = 'react',
  style,
  onState,
  onSelect,
  onCellChange,
  onColumnResize,
}: SpreadsheetGridProps) {
  const handleState = (payload: any) => {
    onState?.(normalizeNativeState(payload));
  };

  const handleSelect = (payload: any) => {
    onSelect?.({
      address: toText(payload?.address, selectedAddress),
      targetId: payload?.targetId,
    });
  };

  const handleCellChange = (payload: any) => {
    onCellChange?.({
      address: toText(payload?.address, selectedAddress),
      input: toText(payload?.input),
      targetId: payload?.targetId,
    });
  };

  const handleColumnResize = (payload: any) => {
    onColumnResize?.({
      widths: normalizeWidths(payload?.widths),
      targetId: payload?.targetId,
    });
  };

  if (renderMode === 'native') {
    return (
      <S.SpreadsheetNativeGridSurface
        type={SPREADSHEET_NATIVE_TYPE}
        rows={rows}
        cols={cols}
        cells={cells}
        selectedAddress={selectedAddress}
        readOnly={readOnly}
        columnWidth={columnWidth}
        columnWidths={columnWidths}
        resizableColumns={resizableColumns}
        minColumnWidth={minColumnWidth}
        maxColumnWidth={maxColumnWidth}
        fitColumnsToViewport={fitColumnsToViewport}
        rowHeight={rowHeight}
        autoScrollToSelection={autoScrollToSelection}
        colorBg={theme.bg}
        colorBgAlt={theme.bgAlt}
        colorSurface={theme.surface}
        colorBorder={theme.border}
        colorText={theme.text}
        colorTextDim={theme.textDim}
        colorAccent={theme.accent}
        colorAccentSoft={theme.accentSoft}
        colorError={theme.error}
        onSpreadsheetState={handleState}
        onSpreadsheetSelect={handleSelect}
        onSpreadsheetChange={handleCellChange}
        onSpreadsheetColumnResize={handleColumnResize}
        style={style}
      />
    );
  }

  const widths = Array.from({ length: cols }, (_, idx) => {
    const width = columnWidths?.[idx] ?? columnWidth;
    return Math.min(maxColumnWidth, Math.max(minColumnWidth, width));
  });
  const errorCount = countFormulaErrors(cells);
  const selectAddress = (address: string) => {
    const event = { address };
    onSelect?.(event);
    onState?.(stateFromCell(cells, address, errorCount));
  };

  return (
    <S.SpreadsheetGridSurface
      type={SPREADSHEET_NATIVE_TYPE}
      rows={rows}
      cols={cols}
      cells={cells}
      selectedAddress={selectedAddress}
      readOnly={readOnly}
      columnWidth={columnWidth}
      columnWidths={columnWidths}
      resizableColumns={resizableColumns}
      minColumnWidth={minColumnWidth}
      maxColumnWidth={maxColumnWidth}
      fitColumnsToViewport={fitColumnsToViewport}
      rowHeight={rowHeight}
      autoScrollToSelection={autoScrollToSelection}
      colorBg={theme.bg}
      colorBgAlt={theme.bgAlt}
      colorSurface={theme.surface}
      colorBorder={theme.border}
      colorText={theme.text}
      colorTextDim={theme.textDim}
      colorAccent={theme.accent}
      colorAccentSoft={theme.accentSoft}
      colorError={theme.error}
      onSpreadsheetState={handleState}
      onSpreadsheetSelect={handleSelect}
      onSpreadsheetChange={handleCellChange}
      onSpreadsheetColumnResize={handleColumnResize}
      style={style}
    >
      <S.SpreadsheetGridContent>
        <S.SpreadsheetGridRow>
          <S.SpreadsheetCornerCell style={{ width: ROW_HEADER_WIDTH, height: rowHeight }}>
            <S.SpreadsheetCellHeaderText />
          </S.SpreadsheetCornerCell>
          {widths.map((width, idx) => (
            <S.SpreadsheetColumnHeaderCell key={`col-${idx}`} style={{ width, height: rowHeight }}>
              <S.SpreadsheetCellHeaderText>{columnLabel(idx + 1)}</S.SpreadsheetCellHeaderText>
            </S.SpreadsheetColumnHeaderCell>
          ))}
        </S.SpreadsheetGridRow>

        {Array.from({ length: rows }, (_, rowIdx) => {
          const row = rowIdx + 1;
          return (
            <S.SpreadsheetGridRow key={`row-${row}`}>
              <S.SpreadsheetRowHeaderCell style={{ width: ROW_HEADER_WIDTH, height: rowHeight }}>
                <S.SpreadsheetCellHeaderText>{row}</S.SpreadsheetCellHeaderText>
              </S.SpreadsheetRowHeaderCell>
              {widths.map((width, colIdx) => {
                const address = cellAddress(row, colIdx + 1);
                const selected = address === selectedAddress;
                const alt = row % 2 === 0;
                const Root = selected ? S.SpreadsheetCellSelected : alt ? S.SpreadsheetCellAlt : S.SpreadsheetCell;
                const evaluated = evaluateCell(cells, address);
                return (
                  <Root
                    key={address}
                    onPress={() => selectAddress(address)}
                    style={{ width, height: rowHeight, alignItems: evaluated.isNumeric ? 'flex-end' : 'flex-start' }}
                  >
                    {cellText(evaluated)}
                  </Root>
                );
              })}
            </S.SpreadsheetGridRow>
          );
        })}
      </S.SpreadsheetGridContent>
    </S.SpreadsheetGridSurface>
  );
}
