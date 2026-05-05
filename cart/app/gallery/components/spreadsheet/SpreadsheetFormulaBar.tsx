import { classifiers as S } from '@reactjit/core';
import type { SpreadsheetNativeState, SpreadsheetQuickAdjustment } from '../../data/overstock/spreadsheet';

export type SpreadsheetFormulaBarProps = {
  state: SpreadsheetNativeState;
  adjustments?: SpreadsheetQuickAdjustment[];
  readOnly?: boolean;
  onAdjust?: (delta: number) => void;
};

function formulaText(state: SpreadsheetNativeState): string {
  if (state.editing) return state.draftInput;
  return state.rawInput || state.valueDisplay || '';
}

export function SpreadsheetFormulaBar({
  state,
  adjustments = [],
  readOnly = false,
  onAdjust,
}: SpreadsheetFormulaBarProps) {
  const text = formulaText(state);

  return (
    <S.SpreadsheetFormulaBar>
      <S.SpreadsheetNameBox>
        <S.SpreadsheetAddressText>{state.address}</S.SpreadsheetAddressText>
      </S.SpreadsheetNameBox>

      <S.SpreadsheetFormulaInput>
        {state.error ? (
          <S.SpreadsheetErrorText>{state.error}</S.SpreadsheetErrorText>
        ) : (
          <S.SpreadsheetFormulaText>{text}</S.SpreadsheetFormulaText>
        )}
      </S.SpreadsheetFormulaInput>

      {readOnly ? null : (
        <S.SpreadsheetAdjustments>
          {adjustments.map((adjustment) => {
            const positive = adjustment.delta > 0;
            return (
              <S.SpreadsheetToolbarButton key={adjustment.id} onPress={() => onAdjust?.(adjustment.delta)}>
                {positive ? (
                  <S.SpreadsheetPositiveText>{adjustment.label}</S.SpreadsheetPositiveText>
                ) : (
                  <S.SpreadsheetNegativeText>{adjustment.label}</S.SpreadsheetNegativeText>
                )}
              </S.SpreadsheetToolbarButton>
            );
          })}
        </S.SpreadsheetAdjustments>
      )}
    </S.SpreadsheetFormulaBar>
  );
}
