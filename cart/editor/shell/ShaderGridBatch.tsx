// One GPU Effect for the standard generated-material cells in Paint's shader
// browser. The transparent Pressable overlay remains in PaintSidePanel, so
// batching changes render cost without changing density, tooltips, or clicks.
import { memo } from 'react';
import { Effect } from '../../../runtime/primitives';
import { FILL_GRID_DATA } from '../render3d/shaders/index';
import { fillShaderFor, fnForMaterialRow } from '../render3d/shaders/compose';

export const SHADER_GRID_TUNING = Object.freeze({
  columns: 8,
  maxCells: 48,
  cellSize: 36,
  thumbnailSize: 32,
  gap: 4,
  cornerRadius: 6,
} as const);

const THUMBNAIL_INSET = (SHADER_GRID_TUNING.cellSize - SHADER_GRID_TUNING.thumbnailSize) / 2;

/** A fill row is [material, variant, seed, quality, board, paletteCount?,
 *  ...rgb, paramCount?, ...params]. */
export function isBatchableFillData(data: readonly number[]): boolean {
  if (data.length < 5 || data.some((value) => !Number.isFinite(value))) return false;
  if (data.length === 5) return true;
  const paletteCount = data[5];
  if (!Number.isInteger(paletteCount) || paletteCount < 0) return false;
  return data.length >= 6 + paletteCount * 3;
}

/**
 * Pack variable-length material rows behind a cell-offset table. Null entries
 * stay transparent for special/custom shaders rendered by the per-cell fallback.
 * Rows are completed with explicit zero palette AND param counts, so neither
 * mat_pal nor mat_param can ever read the following packed row as metadata —
 * inside a grid, arrayLength spans every row, so counts are the only fence.
 */
export function packFillShaderGridData(cells: readonly (readonly number[] | null)[]): number[] {
  if (cells.length > SHADER_GRID_TUNING.maxCells) {
    throw new Error(`shader grid accepts at most ${SHADER_GRID_TUNING.maxCells} cells`);
  }
  const packed = [
    FILL_GRID_DATA.marker,
    cells.length,
    SHADER_GRID_TUNING.columns,
    SHADER_GRID_TUNING.cellSize,
    SHADER_GRID_TUNING.gap,
    SHADER_GRID_TUNING.thumbnailSize,
    THUMBNAIL_INSET,
    SHADER_GRID_TUNING.cornerRadius,
    ...cells.map(() => -1),
  ];
  cells.forEach((data, cellIndex) => {
    if (!data || !isBatchableFillData(data)) return;
    packed[FILL_GRID_DATA.offsetStartIndex + cellIndex] = packed.length;
    packed.push(...data);
    const paletteCount = data.length === 5 ? 0 : data[5]!;
    if (data.length === 5) packed.push(0);
    if (data.length <= 6 + paletteCount * 3) packed.push(0);
  });
  return packed;
}

export function shaderGridDimensions(cellCount: number): { width: number; height: number; rows: number } {
  const safeCount = Math.max(0, Math.min(SHADER_GRID_TUNING.maxCells, Math.floor(cellCount)));
  const rows = Math.ceil(safeCount / SHADER_GRID_TUNING.columns);
  return {
    width: SHADER_GRID_TUNING.columns * SHADER_GRID_TUNING.cellSize
      + (SHADER_GRID_TUNING.columns - 1) * SHADER_GRID_TUNING.gap,
    height: rows === 0
      ? 0
      : rows * SHADER_GRID_TUNING.cellSize + (rows - 1) * SHADER_GRID_TUNING.gap,
    rows,
  };
}

export type ShaderGridBatchProps = {
  data: readonly number[];
  width: number;
  height: number;
};

/** Fresh arrays from parent renders must not dirty the enclosing StaticSurface. */
export function sameShaderGridBatchProps(a: ShaderGridBatchProps, b: ShaderGridBatchProps): boolean {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false;
  for (let index = 0; index < a.data.length; index += 1) {
    if (!Object.is(a.data[index], b.data[index])) return false;
  }
  return true;
}

/** The material fns behind a packed grid's rows — each cell offset points at a
 *  [materialId, variant, seed, quality, board, …] row. The composed page module
 *  (req_3473) carries exactly these, so paging compiles tens of KB per page
 *  instead of the 410-material catalog once. */
export function fnsForPackedGrid(data: readonly number[]): string[] {
  const count = Math.max(0, Math.floor(data[FILL_GRID_DATA.cellCountIndex] ?? 0));
  const fns: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = data[FILL_GRID_DATA.offsetStartIndex + index] ?? -1;
    if (offset < 0) continue;
    const fn = fnForMaterialRow(data[offset] ?? -1, data[offset + 4] ?? -1);
    if (fn) fns.push(fn);
  }
  return fns;
}

function ShaderGridBatch(props: ShaderGridBatchProps) {
  return (
    <Effect
      shader={fillShaderFor(fnsForPackedGrid(props.data))}
      data={props.data}
      style={{ position: 'absolute', left: 0, top: 0, width: props.width, height: props.height }}
    />
  );
}

export default memo(ShaderGridBatch, sameShaderGridBatchProps);
