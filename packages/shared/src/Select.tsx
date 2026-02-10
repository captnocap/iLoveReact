/**
 * Select component for web and native (Love2D) modes.
 *
 * Web mode:   renders a styled native <select> element.
 * Native mode: inline accordion-style expand/collapse.
 *              Clicking the header toggles the option list.
 *              Clicking an option selects it and collapses.
 */

import React, { useState, useCallback } from 'react';
import { Box, Text } from './primitives';
import type { Style, LoveEvent, Color } from './types';
import { useRendererMode } from './context';

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  style?: Style;
  color?: Color;
}

export function Select({
  value: controlledValue,
  defaultValue,
  onValueChange,
  options,
  placeholder = 'Select...',
  disabled = false,
  style,
  color = '#3b82f6',
}: SelectProps) {
  const mode = useRendererMode();

  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = controlledValue !== undefined;
  const selectedValue = isControlled ? controlledValue : internalValue;
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = options.find(o => o.value === selectedValue);
  const displayText = selectedOption?.label ?? placeholder;

  const handleSelect = useCallback((optionValue: string) => {
    if (disabled) return;
    if (!isControlled) {
      setInternalValue(optionValue);
    }
    onValueChange?.(optionValue);
    setIsOpen(false);
  }, [disabled, isControlled, onValueChange]);

  const handleToggle = useCallback(() => {
    if (disabled) return;
    setIsOpen(prev => !prev);
  }, [disabled]);

  if (mode === 'web') {
    return (
      <select
        value={selectedValue ?? ''}
        onChange={e => handleSelect(e.target.value)}
        disabled={disabled}
        style={{
          padding: '6px 10px',
          fontSize: 14,
          borderRadius: 6,
          border: '1px solid #334155',
          backgroundColor: '#1e293b',
          color: selectedOption ? '#e2e8f0' : '#64748b',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          outline: 'none',
          minWidth: 160,
          ...style,
        } as React.CSSProperties}
      >
        {!selectedOption && (
          <option value="" disabled>{placeholder}</option>
        )}
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    );
  }

  // Native mode: inline accordion
  return (
    <Box style={{
      opacity: disabled ? 0.5 : 1,
      ...style,
    }}>
      {/* Header / trigger */}
      <Box
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#1e293b',
          borderWidth: 1,
          borderColor: isOpen ? color : '#334155',
          borderRadius: isOpen ? 0 : 6,
          borderTopWidth: 1,
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderBottomWidth: isOpen ? 0 : 1,
          padding: 8,
          paddingLeft: 10,
          paddingRight: 10,
        }}
        onClick={handleToggle}
      >
        <Text style={{
          color: selectedOption ? '#e2e8f0' : '#64748b',
          fontSize: 14,
        }}>
          {displayText}
        </Text>
        <Text style={{ color: '#64748b', fontSize: 10 }}>
          {isOpen ? '^' : 'v'}
        </Text>
      </Box>

      {/* Option list (visible when open) */}
      {isOpen && (
        <Box style={{
          backgroundColor: '#1e293b',
          borderWidth: 1,
          borderColor: color,
          borderTopWidth: 0,
          borderBottomLeftRadius: 6,
          borderBottomRightRadius: 6,
        }}>
          {options.map((opt, i) => {
            const isSelected = opt.value === selectedValue;
            return (
              <Box
                key={opt.value}
                style={{
                  padding: 8,
                  paddingLeft: 10,
                  paddingRight: 10,
                  backgroundColor: isSelected ? '#334155' : 'transparent',
                  borderBottomWidth: i < options.length - 1 ? 1 : 0,
                  borderColor: '#0f172a',
                }}
                onClick={() => handleSelect(opt.value)}
              >
                <Text style={{
                  color: isSelected ? '#e2e8f0' : '#94a3b8',
                  fontSize: 14,
                }}>
                  {opt.label}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
