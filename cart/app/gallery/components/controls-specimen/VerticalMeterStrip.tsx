import { Box, Col } from '@reactjit/runtime/primitives';
import { CTRL } from './controlsSpecimenTheme';

export type VerticalMeterStripProps = {
  value?: number;
  segments?: number;
  width?: number;
};

export function VerticalMeterStrip({
  value = 0,
  segments = 24,
  width = 8,
}: VerticalMeterStripProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const threshold = segments * (clamped / 100);

  return (
    <Col
      style={{
        width,
        gap: 1,
        alignItems: 'center',
        justifyContent: 'flex-end',
      }}
    >
      {Array.from({ length: segments }).map((_, i) => {
        const segmentIndex = segments - 1 - i;
        const lit = segmentIndex < threshold;
        const warnZone = segmentIndex >= segments * 0.75;
        const clipZone = segmentIndex >= segments * 0.92;
        const color = clipZone ? CTRL.flag : warnZone ? CTRL.warn : CTRL.accent;
        return (
          <Box
            key={i}
            style={{
              width: width - 2,
              height: 3,
              backgroundColor: lit ? color : CTRL.bg1,
              borderWidth: lit ? 0 : 1,
              borderColor: CTRL.rule,
            }}
          />
        );
      })}
    </Col>
  );
}
