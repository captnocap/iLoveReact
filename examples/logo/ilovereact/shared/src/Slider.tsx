/**
 * Slider component for web and native (Love2D) modes.
 *
 * Provides a draggable slider with track and thumb for selecting a value
 * within a range. Supports controlled and uncontrolled modes, step snapping,
 * and both horizontal and vertical orientations.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box } from './primitives';
import type { Style, LoveEvent, Color } from './types';
import { useRendererMode } from './context';

export interface SliderProps {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  onSlidingStart?: () => void;
  onSlidingEnd?: (value: number) => void;
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
  disabled?: boolean;

  // Visual customization
  style?: Style;
  trackColor?: Color;
  activeTrackColor?: Color;
  thumbColor?: Color;
  thumbSize?: number;
  trackHeight?: number;

  // Orientation
  vertical?: boolean;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function snapToStep(value: number, step: number, min: number, max: number): number {
  const steps = Math.round((value - min) / step);
  return clamp(min + steps * step, min, max);
}

export function Slider({
  value: controlledValue,
  defaultValue = 0,
  onValueChange,
  onSlidingStart,
  onSlidingEnd,
  minimumValue = 0,
  maximumValue = 1,
  step,
  disabled = false,
  style,
  trackColor = '#333333',
  activeTrackColor = '#4A90D9',
  thumbColor = '#ffffff',
  thumbSize = 20,
  trackHeight = 4,
  vertical = false,
}: SliderProps) {
  const mode = useRendererMode();

  // Controlled vs uncontrolled
  const [internalValue, setInternalValue] = useState(
    clamp(defaultValue, minimumValue, maximumValue)
  );
  const isControlled = controlledValue !== undefined;
  const currentValue = isControlled ? controlledValue : internalValue;

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);

  // Track container ref (for web mode drag calculations)
  const trackRef = useRef<HTMLDivElement>(null);

  // Value at the start of a native drag (used to apply relative deltas)
  const dragStartValueRef = useRef(0);

  // Track width for native mode calculations
  const trackWidth = (style?.width as number) || 200;

  /** Update value, respecting controlled mode and step snapping. */
  const updateValue = useCallback(
    (newValue: number, isEnd = false) => {
      let clampedValue = clamp(newValue, minimumValue, maximumValue);

      // Apply step snapping
      if (step !== undefined) {
        clampedValue = snapToStep(clampedValue, step, minimumValue, maximumValue);
      }

      if (!isControlled) {
        setInternalValue(clampedValue);
      }

      onValueChange?.(clampedValue);

      if (isEnd) {
        onSlidingEnd?.(clampedValue);
      }
    },
    [isControlled, minimumValue, maximumValue, step, onValueChange, onSlidingEnd]
  );

  /** Convert position (0-1) to value. */
  const positionToValue = useCallback(
    (position: number): number => {
      return minimumValue + position * (maximumValue - minimumValue);
    },
    [minimumValue, maximumValue]
  );

  /** Convert value to position (0-1). */
  const valueToPosition = useCallback(
    (val: number): number => {
      return (val - minimumValue) / (maximumValue - minimumValue);
    },
    [minimumValue, maximumValue]
  );

  // Web mode drag handlers
  const handleWebDragStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled || !trackRef.current) return;

      e.preventDefault();
      setIsDragging(true);
      onSlidingStart?.();

      const rect = trackRef.current.getBoundingClientRect();
      const position = vertical
        ? 1 - (e.clientY - rect.top) / rect.height
        : (e.clientX - rect.left) / rect.width;

      const newValue = positionToValue(clamp(position, 0, 1));
      updateValue(newValue);
    },
    [disabled, vertical, positionToValue, updateValue, onSlidingStart]
  );

  const handleWebDragMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !trackRef.current) return;

      const rect = trackRef.current.getBoundingClientRect();
      const position = vertical
        ? 1 - (e.clientY - rect.top) / rect.height
        : (e.clientX - rect.left) / rect.width;

      const newValue = positionToValue(clamp(position, 0, 1));
      updateValue(newValue);
    },
    [isDragging, vertical, positionToValue, updateValue]
  );

  const handleWebDragEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    updateValue(currentValue, true);
  }, [isDragging, currentValue, updateValue]);

  // Web mode: attach global mouse listeners during drag
  useEffect(() => {
    if (mode === 'web' && isDragging) {
      document.addEventListener('mousemove', handleWebDragMove);
      document.addEventListener('mouseup', handleWebDragEnd);
      return () => {
        document.removeEventListener('mousemove', handleWebDragMove);
        document.removeEventListener('mouseup', handleWebDragEnd);
      };
    }
  }, [mode, isDragging, handleWebDragMove, handleWebDragEnd]);

  // Native mode drag handlers -- use relative deltas from drag start
  const handleNativeDragStart = useCallback(
    (event: LoveEvent) => {
      if (disabled) return;
      setIsDragging(true);
      dragStartValueRef.current = currentValue;
      onSlidingStart?.();
    },
    [disabled, currentValue, onSlidingStart]
  );

  const handleNativeDrag = useCallback(
    (event: LoveEvent) => {
      // Convert total drag distance to a value delta
      const totalDelta = vertical
        ? -(event.totalDeltaY ?? 0)
        : (event.totalDeltaX ?? 0);
      const positionDelta = totalDelta / trackWidth;
      const range = maximumValue - minimumValue;
      const newValue = dragStartValueRef.current + positionDelta * range;
      updateValue(clamp(newValue, minimumValue, maximumValue));
    },
    [vertical, trackWidth, minimumValue, maximumValue, updateValue]
  );

  const handleNativeDragEnd = useCallback(
    (event: LoveEvent) => {
      setIsDragging(false);
      updateValue(currentValue, true);
    },
    [currentValue, updateValue]
  );

  // Calculate thumb position based on current value
  const thumbPosition = valueToPosition(currentValue);

  // Container style
  const containerStyle: Style = {
    flexDirection: vertical ? 'column' : 'row',
    alignItems: 'center',
    justifyContent: 'start',
    ...(vertical ? { height: 200, width: thumbSize + 8 } : { width: 200, height: thumbSize + 8 }),
    opacity: disabled ? 0.5 : 1,
    ...style,
  };

  // Track background style
  const trackStyle: Style = {
    position: 'relative',
    backgroundColor: trackColor,
    borderRadius: trackHeight / 2,
    ...(vertical
      ? { width: trackHeight, height: '100%', flexGrow: 1 }
      : { height: trackHeight, width: '100%', flexGrow: 1 }),
  };

  // Active track style
  const activeTrackStyle: Style = {
    position: 'absolute',
    backgroundColor: activeTrackColor,
    borderRadius: trackHeight / 2,
    ...(vertical
      ? {
          width: trackHeight,
          height: `${thumbPosition * 100}%`,
          bottom: 0,
          left: 0,
        }
      : {
          height: trackHeight,
          width: `${thumbPosition * 100}%`,
          top: 0,
          left: 0,
        }),
  };

  // Thumb style
  const thumbStyle: Style = {
    position: 'absolute',
    width: thumbSize,
    height: thumbSize,
    borderRadius: thumbSize / 2,
    backgroundColor: thumbColor,
    ...(vertical
      ? {
          bottom: `calc(${thumbPosition * 100}% - ${thumbSize / 2}px)`,
          left: `calc(50% - ${thumbSize / 2}px)`,
        }
      : {
          left: `calc(${thumbPosition * 100}% - ${thumbSize / 2}px)`,
          top: `calc(50% - ${thumbSize / 2}px)`,
        }),
  };

  if (mode === 'web') {
    return (
      <div style={{ display: 'flex', ...containerStyle } as React.CSSProperties}>
        <div
          ref={trackRef}
          style={{ position: 'relative', ...trackStyle } as React.CSSProperties}
          onMouseDown={handleWebDragStart}
        >
          <div style={activeTrackStyle as React.CSSProperties} />
          <div
            style={{
              ...thumbStyle,
              cursor: disabled ? 'not-allowed' : 'grab',
            } as React.CSSProperties}
          />
        </div>
      </div>
    );
  }

  // Native mode: flex-based layout (no position:absolute needed)
  // Three segments in a row: active track | thumb | inactive track
  const activeWidth = Math.max(0, thumbPosition * (trackWidth - thumbSize));
  const inactiveWidth = Math.max(0, (1 - thumbPosition) * (trackWidth - thumbSize));

  return (
    <Box
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        width: trackWidth,
        height: thumbSize + 8,
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
      onDragStart={handleNativeDragStart}
      onDrag={handleNativeDrag}
      onDragEnd={handleNativeDragEnd}
      onClick={handleNativeDragStart}
    >
      {/* Active track (left of thumb) */}
      <Box style={{
        width: activeWidth,
        height: trackHeight,
        backgroundColor: activeTrackColor,
        borderRadius: trackHeight / 2,
      }} />
      {/* Thumb */}
      <Box style={{
        width: thumbSize,
        height: thumbSize,
        borderRadius: thumbSize / 2,
        backgroundColor: thumbColor,
      }} />
      {/* Inactive track (right of thumb) */}
      <Box style={{
        width: inactiveWidth,
        height: trackHeight,
        backgroundColor: trackColor,
        borderRadius: trackHeight / 2,
      }} />
    </Box>
  );
}
