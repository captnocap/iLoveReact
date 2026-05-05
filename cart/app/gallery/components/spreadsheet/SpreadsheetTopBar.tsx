import { classifiers as S } from '@reactjit/core';
import type { SpreadsheetNativeState } from '../../data/overstock/spreadsheet';

export type SpreadsheetTopBarProps = {
  title: string;
  subtitle?: string;
  state: SpreadsheetNativeState;
  readOnly?: boolean;
};

export function SpreadsheetTopBar({ title, subtitle, state, readOnly = false }: SpreadsheetTopBarProps) {
  return (
    <S.SpreadsheetTopBar>
      <S.StackX1>
        <S.SpreadsheetTitle>{title}</S.SpreadsheetTitle>
        {subtitle ? <S.SpreadsheetSubtitle>{subtitle}</S.SpreadsheetSubtitle> : null}
      </S.StackX1>

      <S.SpreadsheetTopCluster>
        <S.SpreadsheetBadge>
          <S.SpreadsheetLabel>{readOnly ? 'READ ONLY' : 'EDITABLE'}</S.SpreadsheetLabel>
        </S.SpreadsheetBadge>
        <S.SpreadsheetBadge>
          <S.SpreadsheetLabel>{state.editing ? 'EDITING' : state.valueType.toUpperCase()}</S.SpreadsheetLabel>
        </S.SpreadsheetBadge>
        {state.errorCount > 0 ? (
          <S.SpreadsheetBadgeError>
            <S.SpreadsheetErrorText>{`${state.errorCount} ERR`}</S.SpreadsheetErrorText>
          </S.SpreadsheetBadgeError>
        ) : null}
      </S.SpreadsheetTopCluster>
    </S.SpreadsheetTopBar>
  );
}
