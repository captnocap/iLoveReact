import { Box, Pressable } from '@reactjit/runtime/primitives';
import { Mono } from './controlsSpecimenParts';
import { useControllableNumberState, useVerticalPercentDrag } from './controlsSpecimenInteractions';
import { CTRL } from './controlsSpecimenTheme';

export type RotaryKnobProps = {
  value?: number;
  defaultValue?: number;
  size?: number;
  label?: string;
  onChange?: (next: number) => void;
};

export function RotaryKnob({
  value,
  defaultValue = 50,
  size = 44,
  label,
  onChange,
}: RotaryKnobProps) {
  // Don't default `value` in the signature — `useControllableNumberState` treats
  // any numeric `value` as a "controlled" signal, which would freeze the knob
  // when the parent passes only `onChange`.
  const [current, setCurrent] = useControllableNumberState({ value, defaultValue, onChange });
  const drag = useVerticalPercentDrag(current, setCurrent, 120);

  const center = size / 2;
  const outerR = size / 2 - 2;
  const indicatorR = size / 2 - 5;
  const dotSize = 5;

  const startA = (3 * Math.PI) / 4;
  const sweep = (3 * Math.PI) / 2;
  const angle = startA + drag.ratio * sweep;

  const ix = center + indicatorR * Math.cos(angle) - dotSize / 2;
  const iy = center + indicatorR * Math.sin(angle) - dotSize / 2;

  const ticks = Array.from({ length: 11 }, (_, i) => {
    const t = i / 10;
    const a = startA + t * sweep;
    return {
      x: center + outerR * Math.cos(a) - 1,
      y: center + outerR * Math.sin(a) - 1,
      lit: t <= drag.ratio + 0.05,
    };
  });

  return (
    <Box style={{ alignItems: 'center', gap: 3 }}>
      <Box style={{ width: size, height: size, position: 'relative' }}>
        {/* Outer ring */}
        <Box
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 1.5,
            borderColor: CTRL.ruleBright,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Box
            style={{
              width: size - 6,
              height: size - 6,
              borderRadius: (size - 6) / 2,
              backgroundColor: CTRL.bg1,
            }}
          />
        </Box>

        {/* Tick marks */}
        {ticks.map((t, i) => (
          <Box
            key={i}
            style={{
              position: 'absolute',
              left: t.x,
              top: t.y,
              width: 2,
              height: 2,
              borderRadius: 1,
              backgroundColor: t.lit ? CTRL.accent : CTRL.rule,
            }}
          />
        ))}

        {/* Indicator dot */}
        <Box
          style={{
            position: 'absolute',
            left: ix,
            top: iy,
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: drag.dragging ? CTRL.accentHot : CTRL.accent,
          }}
        />

        {/* Hit overlay — absolute, on top, captures all pointer events */}
        <Pressable
          onMouseDown={drag.begin}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            borderRadius: size / 2,
          }}
        />
      </Box>

      {label ? (
        <Mono fontSize={8} color={CTRL.inkDim} letterSpacing={1}>
          {label}
        </Mono>
      ) : null}
    </Box>
  );
}
