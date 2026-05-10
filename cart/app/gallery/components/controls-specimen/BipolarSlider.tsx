import { Box, Pressable } from '@reactjit/runtime/primitives';
import { AtomFrame, Body, MeterMarks, Mono } from './controlsSpecimenParts';
import { useControllableNumberState, useHorizontalPercentDrag } from './controlsSpecimenInteractions';
import { CTRL } from './controlsSpecimenTheme';
import { classifiers as S } from '@reactjit/core';

export type BipolarSliderProps = {
  value?: number;
  defaultValue?: number;
  width?: number;
  label?: string;
  onChange?: (next: number) => void;
};

export function BipolarSlider({
  value,
  defaultValue = 65,
  width = 240,
  label = 'OFFSET',
  onChange,
}: BipolarSliderProps) {
  // Don't default `value` in the signature — see RotaryKnob for the why.
  const [current, setCurrent] = useControllableNumberState({ value, defaultValue, onChange });
  const center = 0.5;
  const trackWidth = Math.max(0, width - 20);
  const drag = useHorizontalPercentDrag(current, setCurrent, trackWidth);
  const centerX = Math.round(trackWidth / 2);
  const thumbCenterX = Math.round(trackWidth * drag.ratio);
  const fillLeft = Math.min(centerX, thumbCenterX);
  const fillWidth = Math.abs(thumbCenterX - centerX);
  const tone = drag.ratio >= center ? CTRL.accent : CTRL.flag;

  return (
    <AtomFrame width={width} padding={10} gap={8}>
      <S.InlineX4BetweenFull>
        <Mono>{label}</Mono>
        <Body fontSize={12}>{current - 50 > 0 ? `+${current - 50}` : `${current - 50}`}</Body>
      </S.InlineX4BetweenFull>
      <Box style={{ width: '100%', height: 24, justifyContent: 'center', position: 'relative' }}>
        <Box style={{ width: trackWidth, height: 4, borderWidth: 1, borderColor: CTRL.ruleBright, backgroundColor: CTRL.bg1 }} />
        <Box style={{ position: 'absolute', left: centerX, top: 7, width: 1, height: 10, backgroundColor: CTRL.inkDim }} />
        <Box style={{ position: 'absolute', left: fillLeft, top: 8, width: fillWidth, height: 6, backgroundColor: tone }} />
        <Box
          style={{
            position: 'absolute',
            left: thumbCenterX - 4,
            top: 4,
            width: 8,
            height: 16,
            borderWidth: 1,
            borderColor: tone,
            backgroundColor: drag.dragging ? tone : CTRL.bg3,
          }}
        />
        <Pressable onMouseDown={drag.begin} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
      </Box>
      <MeterMarks labels={['−50', '−25', '0', '+25', '+50']} />
    </AtomFrame>
  );
}
