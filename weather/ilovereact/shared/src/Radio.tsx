/**
 * Radio and RadioGroup components for web and native (Love2D) modes.
 *
 * RadioGroup provides context for exclusive selection.
 * Radio renders an individual option that reads group state from context.
 */

import React, { useState, useCallback, useContext, createContext } from 'react';
import { Box, Text } from './primitives';
import type { Style, LoveEvent, Color } from './types';
import { useRendererMode } from './context';

// ── RadioGroup context ──────────────────────────────────

interface RadioGroupContextValue {
  selectedValue: string | undefined;
  onChange: (value: string) => void;
  disabled: boolean;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

// ── RadioGroup ──────────────────────────────────────────

export interface RadioGroupProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
  style?: Style;
}

export function RadioGroup({
  value: controlledValue,
  defaultValue,
  onValueChange,
  disabled = false,
  children,
  style,
}: RadioGroupProps) {
  const mode = useRendererMode();
  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = controlledValue !== undefined;
  const selectedValue = isControlled ? controlledValue : internalValue;

  const onChange = useCallback((newValue: string) => {
    if (disabled) return;
    if (!isControlled) {
      setInternalValue(newValue);
    }
    onValueChange?.(newValue);
  }, [disabled, isControlled, onValueChange]);

  const ctx: RadioGroupContextValue = { selectedValue, onChange, disabled };

  if (mode === 'web') {
    return (
      <RadioGroupContext.Provider value={ctx}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style } as React.CSSProperties}>
          {children}
        </div>
      </RadioGroupContext.Provider>
    );
  }

  return (
    <RadioGroupContext.Provider value={ctx}>
      <Box style={{ gap: 8, ...style }}>
        {children}
      </Box>
    </RadioGroupContext.Provider>
  );
}

// ── Radio ───────────────────────────────────────────────

export interface RadioProps {
  value: string;
  label?: string;
  disabled?: boolean;
  size?: number;
  color?: Color;
  uncheckedColor?: Color;
  style?: Style;
}

export function Radio({
  value,
  label,
  disabled: localDisabled = false,
  size = 20,
  color = '#3b82f6',
  uncheckedColor = '#6b7280',
  style,
}: RadioProps) {
  const mode = useRendererMode();
  const group = useContext(RadioGroupContext);

  const isDisabled = localDisabled || (group?.disabled ?? false);
  const isSelected = group?.selectedValue === value;

  const handlePress = useCallback(() => {
    if (isDisabled || !group) return;
    group.onChange(value);
  }, [isDisabled, group, value]);

  const innerSize = Math.round(size * 0.5);
  const borderWidth = Math.max(2, Math.round(size / 10));

  if (mode === 'web') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          opacity: isDisabled ? 0.5 : 1,
          ...style,
        } as React.CSSProperties}
        onClick={isDisabled ? undefined : handlePress}
      >
        <div style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          border: `${borderWidth}px solid ${isSelected ? (typeof color === 'string' ? color : '#3b82f6') : (typeof uncheckedColor === 'string' ? uncheckedColor : '#6b7280')}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          {isSelected && (
            <div style={{
              width: innerSize,
              height: innerSize,
              borderRadius: innerSize / 2,
              backgroundColor: typeof color === 'string' ? color : '#3b82f6',
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
        opacity: isDisabled ? 0.5 : 1,
        ...style,
      }}
      onClick={handlePress}
    >
      <Box style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth,
        borderColor: isSelected ? color : uncheckedColor,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        {isSelected && (
          <Box style={{
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
            backgroundColor: color,
          }} />
        )}
      </Box>
      {label && (
        <Text style={{ color: '#e2e8f0', fontSize: 14 }}>{label}</Text>
      )}
    </Box>
  );
}
