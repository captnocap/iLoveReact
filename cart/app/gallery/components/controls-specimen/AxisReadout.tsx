import { Box, Col, Row } from '@reactjit/runtime/primitives';
import { AtomFrame, Body, Mono, VerticalText } from './controlsSpecimenParts';
import { CTRL } from './controlsSpecimenTheme';
import { classifiers as S } from '@reactjit/core';

export type AxisReadoutBar = {
  label: string;
  value: number;
};

export type AxisReadoutProps = {
  axisLabel?: string;
  bars?: AxisReadoutBar[];
};

const DEFAULT_BARS: AxisReadoutBar[] = [
  { label: 'W·01', value: 48 },
  { label: 'W·02', value: 82 },
  { label: 'W·03', value: 96 },
  { label: 'W·04', value: 22 },
  { label: 'W·05', value: 64 },
  { label: 'W·06', value: 38 },
];

export function AxisReadout({
  axisLabel = 'LOAD · SKEW',
  bars = DEFAULT_BARS,
}: AxisReadoutProps) {
  return (
    <S.InlineX5>
      <VerticalText text={axisLabel} color={CTRL.inkDimmer} fontSize={8} />
      <AtomFrame width={260} padding={10} gap={8}>
        {bars.map((bar) => (
          <S.InlineX4Center key={bar.label} style={{ width: '100%' }}>
            <Mono color={CTRL.inkDimmer} style={{ width: 28 }}>{bar.label}</Mono>
            <Box style={{ flexGrow: 1, flexBasis: 0, height: 6, borderWidth: 1, borderColor: CTRL.rule, backgroundColor: CTRL.bg1 }}>
              <Box style={{ width: `${bar.value}%`, height: 4, backgroundColor: bar.value > 85 ? CTRL.accentHot : CTRL.accent }} />
            </Box>
            <Body fontSize={10} color={CTRL.ink}>{bar.value}%</Body>
          </S.InlineX4Center>
        ))}
      </AtomFrame>
    </S.InlineX5>
  );
}
