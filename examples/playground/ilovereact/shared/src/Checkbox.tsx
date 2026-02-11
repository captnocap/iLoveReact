/**
 * Checkbox component for web and native (Love2D) modes.
 *
 * A toggleable checkbox with optional label. Supports controlled
 * and uncontrolled modes with customizable colors and sizing.
 */

import React, { useState, useCallback } from 'react';
import { Box, Text } from './primitives';
import type { Style, LoveEvent, Color } from './types';
import { useRendererMode } from './context';

export interface CheckboxProps {
  value?: boolean;
  defaultValue?: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
  size?: number;
  color?: Color;
  uncheckedColor?: Color;
  style?: Style;
}

export function Checkbox({
  value: controlledValue,
  defaultValue = false,
  onValueChange,
  disabled = false,
  label,
  size = 20,
  color = '#3b82f6',
  uncheckedColor = '#6b7280',
  style,
}: CheckboxProps) {
  const mode = useRendererMode();

  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = controlledValue !== undefined;
  const checked = isControlled ? controlledValue : internalValue;

  const handleToggle = useCallback(() => {
    if (disabled) return;
    const newValue = !checked;
    if (!isControlled) {
      setInternalValue(newValue);
    }
    onValueChange?.(newValue);
  }, [disabled, checked, isControlled, onValueChange]);

  const innerSize = Math.round(size * 0.6);
  const borderWidth = Math.max(2, Math.round(size / 10));

  if (mode === 'web') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          ...style,
        } as React.CSSProperties}
        onClick={disabled ? undefined : handleToggle}
      >
        <div style={{
          width: size,
          height: size,
          borderRadius: 4,
          border: `${borderWidth}px solid ${checked ? (typeof color === 'string' ? color : '#3b82f6') : (typeof uncheckedColor === 'string' ? uncheckedColor : '#6b7280')}`,
          backgroundColor: checked ? (typeof color === 'string' ? color : '#3b82f6') : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.15s ease, border-color 0.15s ease',
          flexShrink: 0,
        }}>
          {checked && (
            <div style={{
              width: Math.round(size * 0.4),
              height: Math.round(size * 0.4),
              borderRadius: 2,
              backgroundColor: '#ffffff',
            }} />
          )}
        </div>
        {label && (
          <span style={{
            color: '#e2e8f0',
            fontSize: 14,
            userSelect: 'none',
          }}>{label}</span>
        )}
      </div>
    );
  }

  // Native mode
  return (
    <Box
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
      onClick={handleToggle}
    >
      <Box style={{
        width: size,
        height: size,
        borderRadius: 4,
        borderWidth,
        borderColor: checked ? color : uncheckedColor,
        backgroundColor: checked ? color : 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        {checked && (
          <Box style={{
            width: Math.round(size * 0.4),
            height: Math.round(size * 0.4),
            borderRadius: 2,
            backgroundColor: '#ffffff',
          }} />
        )}
      </Box>
      {label && (
        <Text style={{ color: '#e2e8f0', fontSize: 14 }}>{label}</Text>
      )}
    </Box>
  );
}
