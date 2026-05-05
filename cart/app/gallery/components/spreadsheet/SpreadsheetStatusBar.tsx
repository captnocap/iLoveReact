import { classifiers as S } from '@reactjit/core';
import type { SpreadsheetNativeState } from '../../data/overstock/spreadsheet';

export type SpreadsheetStatusBarProps = {
  state: SpreadsheetNativeState;
  rows: number;
  cols: number;
  sourceType?: string;
};

export function SpreadsheetStatusBar({
  state,
  rows,
  cols,
  sourceType = 'SpreadsheetGrid',
}: SpreadsheetStatusBarProps) {
  return (
    <S.SpreadsheetStatusBar>
      <S.SpreadsheetDimText>{`${rows} rows x ${cols} cols`}</S.SpreadsheetDimText>
      <S.Spacer />
      <S.SpreadsheetDimText>{sourceType}</S.SpreadsheetDimText>
      <S.SpreadsheetDimText>{state.editing ? 'input open' : 'ready'}</S.SpreadsheetDimText>
    </S.SpreadsheetStatusBar>
  );
}
