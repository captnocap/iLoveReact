import React from 'react';
import { Box, Pressable } from '../../../runtime/primitives';

export function TimeSlider({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const [dragging, setDragging] = React.useState(false);
  const draggingRef = React.useRef(false);
  const rectRef = React.useRef<{ x: number; width: number } | null>(null);

  const setFromPayload = React.useCallback((payload: any) => {
    const rect = rectRef.current;
    if (!rect || rect.width <= 0 || typeof payload?.x !== 'number') return;
    const ratio = Math.max(0, Math.min(1, (payload.x - rect.x) / rect.width));
    onChange(min + (max - min) * ratio);
  }, [max, min, onChange]);

  const onLayout = React.useCallback((rect: any) => {
    if (rect && Number.isFinite(rect.x) && Number.isFinite(rect.width)) {
      rectRef.current = { x: rect.x, width: rect.width };
    }
  }, []);

  const pct = max <= min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));

  return (
    <Pressable
      onMouseDown={(payload: any) => {
        draggingRef.current = true;
        setDragging(true);
        setFromPayload(payload);
      }}
      onMouseMove={(payload: any) => {
        if (draggingRef.current) setFromPayload(payload);
      }}
      onMouseUp={() => {
        draggingRef.current = false;
        setDragging(false);
      }}
      onMouseLeave={() => {
        draggingRef.current = false;
        setDragging(false);
      }}
      onLayout={onLayout}
      style={{ width: '100%', height: 16, justifyContent: 'center' }}
    >
      <Box
        style={{
          width: '100%',
          height: 4,
          borderRadius: 2,
          backgroundColor: 'rgba(255,255,255,0.25)',
          overflow: 'hidden',
        }}
      >
        <Box
          style={{
            width: `${pct * 100}%`,
            height: 4,
            borderRadius: 2,
            backgroundColor: '#4ea1ff',
          }}
        />
      </Box>
      <Box
        style={{
          position: 'absolute',
          left: `${pct * 100}%`,
          top: 4,
          width: 12,
          height: 12,
          marginLeft: -6,
          borderRadius: 6,
          backgroundColor: dragging ? '#4ea1ff' : '#ffffff',
          borderWidth: dragging ? 0 : 2,
          borderColor: '#4ea1ff',
        }}
      />
    </Pressable>
  );
}
