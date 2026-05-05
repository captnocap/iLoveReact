import { useState } from 'react';
import type {
  SpreadsheetCellMap,
  SpreadsheetMetric,
  SpreadsheetNativeState,
  SpreadsheetScalar,
  SpreadsheetWorkbook,
} from '../../data/overstock/spreadsheet';
import { emptySpreadsheetNativeState } from '../../data/overstock/spreadsheet';
import { SpreadsheetFormulaBar } from './SpreadsheetFormulaBar';
import { SpreadsheetGrid, type SpreadsheetCellChangeEvent, type SpreadsheetColumnResizeEvent, type SpreadsheetSelectEvent } from './SpreadsheetGrid';
import { SpreadsheetMetricStrip } from './SpreadsheetMetricStrip';
import { SpreadsheetStatusBar } from './SpreadsheetStatusBar';
import { SpreadsheetTopBar } from './SpreadsheetTopBar';
import { classifiers as S } from '@reactjit/core';

export type SpreadsheetProps = {
  workbook: SpreadsheetWorkbook;
  cells?: SpreadsheetCellMap;
  selectedAddress?: string;
  columnWidths?: number[];
  height?: number;
  onCellsChange?: (cells: SpreadsheetCellMap, event: SpreadsheetCellChangeEvent) => void;
  onSelectedAddressChange?: (address: string, event: SpreadsheetSelectEvent) => void;
  onColumnWidthsChange?: (widths: number[], event: SpreadsheetColumnResizeEvent) => void;
  onStateChange?: (state: SpreadsheetNativeState) => void;
};

function valueTypeForRaw(raw: SpreadsheetScalar | undefined): SpreadsheetNativeState['valueType'] {
  if (raw == null || raw === '') return 'empty';
  if (typeof raw === 'boolean') return 'boolean';
  if (typeof raw === 'number') return 'number';
  return Number.isFinite(Number(raw)) ? 'number' : 'text';
}

function stateForCell(base: SpreadsheetNativeState, cells: SpreadsheetCellMap, address: string): SpreadsheetNativeState {
  if (base.address === address) return base;
  const raw = cells[address];
  const rawInput = raw == null ? '' : String(raw);
  return {
    ...base,
    address,
    rawInput,
    draftInput: rawInput,
    value: raw ?? '',
    valueDisplay: rawInput,
    error: undefined,
    editing: false,
    valueType: valueTypeForRaw(raw),
  };
}

function initialState(workbook: SpreadsheetWorkbook): SpreadsheetNativeState {
  return stateForCell(emptySpreadsheetNativeState, workbook.cells, workbook.selectedAddress || 'A1');
}

function applyCellChange(cells: SpreadsheetCellMap, event: SpreadsheetCellChangeEvent): SpreadsheetCellMap {
  const next = { ...cells };
  if (event.input.length === 0) {
    delete next[event.address];
  } else {
    next[event.address] = event.input;
  }
  return next;
}

function adjustCell(cells: SpreadsheetCellMap, address: string, delta: number): SpreadsheetCellMap {
  const current = cells[address];
  const numeric = Number(current);
  const base = Number.isFinite(numeric) ? numeric : 0;
  return { ...cells, [address]: base + delta };
}

function metricsWithState(base: SpreadsheetMetric[], state: SpreadsheetNativeState): SpreadsheetMetric[] {
  const errors = state.errorCount > 0
    ? { id: 'errors', label: 'Errors', value: String(state.errorCount), tone: 'error' as const }
    : { id: 'errors', label: 'Errors', value: '0', tone: 'neutral' as const };

  const current = {
    id: 'current',
    label: 'Current',
    value: state.valueDisplay || state.rawInput || '-',
    tone: state.error ? 'error' as const : 'accent' as const,
  };

  const rest = base.filter((metric) => metric.id !== 'errors' && metric.id !== 'current');
  return [errors, current, ...rest];
}

export function Spreadsheet({
  workbook,
  cells,
  selectedAddress,
  columnWidths,
  height = 430,
  onCellsChange,
  onSelectedAddressChange,
  onColumnWidthsChange,
  onStateChange,
}: SpreadsheetProps) {
  const [localCells, setLocalCells] = useState<SpreadsheetCellMap>(() => ({ ...workbook.cells }));
  const [localSelected, setLocalSelected] = useState(workbook.selectedAddress);
  const [localWidths, setLocalWidths] = useState<number[] | undefined>(() => workbook.columnWidths);
  const [nativeState, setNativeState] = useState<SpreadsheetNativeState>(() => initialState(workbook));

  const activeCells = cells || localCells;
  const activeSelected = selectedAddress || localSelected;
  const activeWidths = columnWidths || localWidths;
  const activeState = stateForCell(nativeState, activeCells, activeSelected);

  const handleState = (state: SpreadsheetNativeState) => {
    setNativeState(state);
    onStateChange?.(state);
  };

  const handleSelect = (event: SpreadsheetSelectEvent) => {
    setLocalSelected(event.address);
    setNativeState((state) => stateForCell(state, activeCells, event.address));
    onSelectedAddressChange?.(event.address, event);
  };

  const handleCellChange = (event: SpreadsheetCellChangeEvent) => {
    const next = applyCellChange(activeCells, event);
    setLocalCells(next);
    setNativeState((state) => ({
      ...state,
      address: event.address,
      rawInput: event.input,
      draftInput: event.input,
      value: event.input,
      valueDisplay: event.input,
      editing: false,
      valueType: valueTypeForRaw(event.input),
    }));
    onCellsChange?.(next, event);
  };

  const handleColumnResize = (event: SpreadsheetColumnResizeEvent) => {
    setLocalWidths(event.widths);
    onColumnWidthsChange?.(event.widths, event);
  };

  const handleAdjust = (delta: number) => {
    if (workbook.readOnly) return;
    const next = adjustCell(activeCells, activeSelected, delta);
    const input = String(next[activeSelected] ?? '');
    const event = { address: activeSelected, input };
    setLocalCells(next);
    setNativeState((state) => ({
      ...state,
      address: activeSelected,
      rawInput: input,
      draftInput: input,
      value: input,
      valueDisplay: input,
      editing: false,
      valueType: 'number',
    }));
    onCellsChange?.(next, event);
  };

  return (
    <S.SpreadsheetFrame style={{ height }}>
      <SpreadsheetTopBar
        title={workbook.title}
        subtitle={workbook.subtitle}
        state={activeState}
        readOnly={workbook.readOnly}
      />

      <SpreadsheetFormulaBar
        state={activeState}
        readOnly={workbook.readOnly}
        adjustments={workbook.quickAdjustments}
        onAdjust={handleAdjust}
      />

      <S.SpreadsheetGridSlot>
        <SpreadsheetGrid
          rows={workbook.rows}
          cols={workbook.cols}
          cells={activeCells}
          selectedAddress={activeSelected}
          readOnly={workbook.readOnly}
          columnWidth={workbook.columnWidth}
          columnWidths={activeWidths}
          minColumnWidth={workbook.minColumnWidth}
          maxColumnWidth={workbook.maxColumnWidth}
          fitColumnsToViewport={workbook.fitColumnsToViewport}
          resizableColumns={workbook.resizableColumns}
          rowHeight={workbook.rowHeight}
          autoScrollToSelection={workbook.autoScrollToSelection}
          theme={workbook.theme}
          onState={handleState}
          onSelect={handleSelect}
          onCellChange={handleCellChange}
          onColumnResize={handleColumnResize}
        />
      </S.SpreadsheetGridSlot>

      <SpreadsheetMetricStrip metrics={metricsWithState(workbook.metrics, activeState)} />
      <SpreadsheetStatusBar state={activeState} rows={workbook.rows} cols={workbook.cols} />
    </S.SpreadsheetFrame>
  );
}
