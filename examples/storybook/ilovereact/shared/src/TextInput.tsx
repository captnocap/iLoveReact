/**
 * TextInput -- editable text field for web and native (Love2D) modes.
 *
 * Web mode:  renders <input> or <textarea> with standard HTML behavior.
 * Native mode: renders a View container with Text child, using onKeyDown
 *              and onTextInput events from Love2D for editing.
 */

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react';
import { useRendererMode } from './context';
import { Box, Text, styleToCSS, colorToCSS } from './primitives';
import type { TextInputProps, Style, Color, LoveEvent } from './types';

// ── Helpers ─────────────────────────────────────────────

/** Mask text for secure entry (replace each character with a bullet). */
function maskText(text: string): string {
  return '\u2022'.repeat(text.length);
}

/** Clamp a cursor position to valid bounds for the given text. */
function clampCursor(pos: number, textLength: number): number {
  if (pos < 0) return 0;
  if (pos > textLength) return textLength;
  return pos;
}

/** Insert characters at the cursor position, respecting maxLength. */
function insertAtCursor(
  text: string,
  chars: string,
  cursorPos: number,
  maxLength?: number,
): { text: string; cursor: number } {
  const before = text.slice(0, cursorPos);
  const after = text.slice(cursorPos);
  let newText = before + chars + after;
  if (maxLength !== undefined && newText.length > maxLength) {
    const allowed = maxLength - text.length;
    if (allowed <= 0) return { text, cursor: cursorPos };
    const trimmedChars = chars.slice(0, allowed);
    newText = before + trimmedChars + after;
    return { text: newText, cursor: cursorPos + trimmedChars.length };
  }
  return { text: newText, cursor: cursorPos + chars.length };
}

/** Delete the character before the cursor (backspace). */
function deleteBeforeCursor(
  text: string,
  cursorPos: number,
): { text: string; cursor: number } {
  if (cursorPos <= 0) return { text, cursor: cursorPos };
  const before = text.slice(0, cursorPos - 1);
  const after = text.slice(cursorPos);
  return { text: before + after, cursor: cursorPos - 1 };
}

/** Delete the character after the cursor (delete key). */
function deleteAfterCursor(
  text: string,
  cursorPos: number,
): { text: string; cursor: number } {
  if (cursorPos >= text.length) return { text, cursor: cursorPos };
  const before = text.slice(0, cursorPos);
  const after = text.slice(cursorPos + 1);
  return { text: before + after, cursor: cursorPos };
}

// ── Cursor blink hook ───────────────────────────────────

const BLINK_INTERVAL_MS = 530;

function useCursorBlink(isFocused: boolean): boolean {
  const [visible, setVisible] = useState(true);
  const resetRef = useRef(0);

  useEffect(() => {
    if (!isFocused) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const id = setInterval(() => {
      setVisible((v) => !v);
    }, BLINK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isFocused, resetRef.current]);

  /** Call this to reset blink to visible (e.g. after typing). */
  const reset = useCallback(() => {
    resetRef.current += 1;
  }, []);

  return visible;
}

// ── Web mode component ──────────────────────────────────

function WebTextInput({
  value,
  defaultValue,
  onChangeText,
  onSubmit,
  onFocus,
  onBlur,
  placeholder,
  placeholderColor,
  maxLength,
  multiline,
  editable = true,
  secureTextEntry,
  style,
  textStyle,
  autoFocus,
  cursorColor,
}: TextInputProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const containerCSS = styleToCSS(style);
  // Remove flex defaults that don't apply to input containers
  delete (containerCSS as any).flexDirection;

  const textCSS = styleToCSS(textStyle);
  // Build input-specific styles
  const inputCSS: React.CSSProperties = {
    width: '100%',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    padding: 0,
    margin: 0,
    fontFamily: textCSS.fontFamily || 'inherit',
    fontSize: textCSS.fontSize || 'inherit',
    fontWeight: textCSS.fontWeight || 'inherit',
    color: textCSS.color || 'inherit',
    textAlign: textCSS.textAlign || 'left',
    letterSpacing: textCSS.letterSpacing,
    lineHeight: textCSS.lineHeight,
    resize: 'none' as const,
  };

  if (cursorColor) {
    inputCSS.caretColor = colorToCSS(cursorColor);
  }

  // Placeholder color via CSS custom property
  const placeholderStyle = placeholderColor
    ? `::placeholder { color: ${colorToCSS(placeholderColor)}; opacity: 1; }`
    : '';

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChangeText?.(e.target.value);
    },
    [onChangeText],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !multiline && onSubmit) {
        e.preventDefault();
        const target = e.target as HTMLInputElement;
        onSubmit(target.value);
      }
    },
    [multiline, onSubmit],
  );

  const commonProps = {
    ref: inputRef as any,
    style: inputCSS,
    value,
    defaultValue,
    placeholder,
    maxLength,
    readOnly: !editable,
    autoFocus,
    onChange: handleChange,
    onFocus,
    onBlur,
    onKeyDown: handleKeyDown,
  };

  // Generate a unique ID for scoped placeholder styles
  const styleId = useRef(
    `rl-ti-${Math.random().toString(36).slice(2, 8)}`,
  );

  return (
    <div style={containerCSS}>
      {placeholderStyle && (
        <style>{`.${styleId.current}${placeholderStyle}`}</style>
      )}
      {multiline ? (
        <textarea
          {...commonProps}
          className={placeholderStyle ? styleId.current : undefined}
        />
      ) : (
        <input
          {...commonProps}
          type={secureTextEntry ? 'password' : 'text'}
          className={placeholderStyle ? styleId.current : undefined}
        />
      )}
    </div>
  );
}

// ── Native mode component ───────────────────────────────

function NativeTextInput({
  value: controlledValue,
  defaultValue,
  onChangeText,
  onSubmit,
  onFocus,
  onBlur,
  placeholder,
  placeholderColor,
  maxLength,
  multiline = false,
  editable = true,
  secureTextEntry = false,
  style,
  textStyle,
  autoFocus = false,
  cursorColor,
}: TextInputProps) {
  // Internal text state for uncontrolled mode
  const [internalValue, setInternalValue] = useState(defaultValue ?? '');
  const isControlled = controlledValue !== undefined;
  const currentText = isControlled ? controlledValue : internalValue;

  // Focus state
  const [focused, setFocused] = useState(false);

  // Cursor position
  const [cursorPos, setCursorPos] = useState(
    (defaultValue ?? '').length,
  );

  // Blinking cursor
  const cursorVisible = useCursorBlink(focused);

  // Reset ref for cursor blink (re-show cursor on edit actions)
  const blinkResetRef = useRef(0);

  // Auto-focus on mount
  useEffect(() => {
    if (autoFocus) {
      setFocused(true);
      onFocus?.();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep cursor within bounds when text changes externally (controlled mode)
  useEffect(() => {
    if (cursorPos > currentText.length) {
      setCursorPos(currentText.length);
    }
  }, [currentText, cursorPos]);

  /** Update text, notifying the parent and managing internal state. */
  const updateText = useCallback(
    (newText: string, newCursor: number) => {
      if (!isControlled) {
        setInternalValue(newText);
      }
      setCursorPos(clampCursor(newCursor, newText.length));
      blinkResetRef.current += 1;
      onChangeText?.(newText);
    },
    [isControlled, onChangeText],
  );

  /** Handle click to focus the input. */
  const handleClick = useCallback(() => {
    if (!focused) {
      setFocused(true);
      setCursorPos(currentText.length);
      onFocus?.();
    }
  }, [focused, currentText, onFocus]);

  /** Handle text input events from Love2D (character typed). */
  const handleTextInput = useCallback(
    (event: LoveEvent) => {
      if (!focused || !editable) return;
      const chars = event.text;
      if (!chars) return;

      // In single-line mode, ignore newline characters
      if (!multiline && (chars === '\n' || chars === '\r')) return;

      const result = insertAtCursor(currentText, chars, cursorPos, maxLength);
      updateText(result.text, result.cursor);
    },
    [focused, editable, multiline, currentText, cursorPos, maxLength, updateText],
  );

  /** Handle key down events from Love2D (backspace, arrows, etc.). */
  const handleKeyDown = useCallback(
    (event: LoveEvent) => {
      if (!focused) return;

      const key = event.key;
      if (!key) return;

      // Reset blink on any keypress
      blinkResetRef.current += 1;

      switch (key) {
        case 'backspace': {
          if (!editable) return;
          const result = deleteBeforeCursor(currentText, cursorPos);
          updateText(result.text, result.cursor);
          break;
        }
        case 'delete': {
          if (!editable) return;
          const result = deleteAfterCursor(currentText, cursorPos);
          updateText(result.text, result.cursor);
          break;
        }
        case 'left': {
          setCursorPos((p) => clampCursor(p - 1, currentText.length));
          break;
        }
        case 'right': {
          setCursorPos((p) => clampCursor(p + 1, currentText.length));
          break;
        }
        case 'home': {
          setCursorPos(0);
          break;
        }
        case 'end': {
          setCursorPos(currentText.length);
          break;
        }
        case 'return': {
          if (multiline && editable) {
            const result = insertAtCursor(currentText, '\n', cursorPos, maxLength);
            updateText(result.text, result.cursor);
          } else {
            onSubmit?.(currentText);
          }
          break;
        }
        case 'escape': {
          setFocused(false);
          onBlur?.();
          break;
        }
        case 'tab': {
          // Blur on tab to move focus elsewhere
          setFocused(false);
          onBlur?.();
          break;
        }
        default:
          break;
      }
    },
    [
      focused,
      editable,
      multiline,
      currentText,
      cursorPos,
      maxLength,
      updateText,
      onSubmit,
      onBlur,
    ],
  );

  // Determine what to display
  const isEmpty = currentText.length === 0;
  const showPlaceholder = isEmpty && !focused;

  let displayText: string;
  if (showPlaceholder) {
    displayText = placeholder ?? '';
  } else if (secureTextEntry) {
    displayText = maskText(currentText);
  } else {
    displayText = currentText;
  }

  // Build the display text with cursor for native mode
  let textBeforeCursor = '';
  let textAfterCursor = '';
  if (focused && !showPlaceholder) {
    const displaySource = secureTextEntry ? maskText(currentText) : currentText;
    textBeforeCursor = displaySource.slice(0, cursorPos);
    textAfterCursor = displaySource.slice(cursorPos);
  }

  // Container style: apply focus border highlight
  const containerStyle: Style = {
    flexDirection: 'row',
    alignItems: 'start',
    padding: 4,
    borderWidth: 1,
    borderColor: focused ? (cursorColor ?? '#4A90D9') : '#666666',
    borderRadius: 4,
    backgroundColor: '#1a1a1a',
    overflow: 'hidden',
    ...style,
  };

  // Text style defaults
  const baseTextStyle: Style = {
    fontSize: 14,
    color: '#ffffff',
    ...textStyle,
  };

  // Placeholder text style
  const placeholderTextStyle: Style = {
    ...baseTextStyle,
    color: placeholderColor ?? '#888888',
  };

  // Cursor style: a thin colored box
  const resolvedCursorColor: Color = cursorColor ?? '#4A90D9';
  const cursorStyle: Style = {
    width: 2,
    height: baseTextStyle.fontSize ?? 14,
    backgroundColor: cursorVisible ? resolvedCursorColor : 'transparent',
  };

  if (showPlaceholder) {
    // Show placeholder text, clicking focuses
    return (
      <Box style={containerStyle} onClick={handleClick}>
        <Text style={placeholderTextStyle}>{displayText}</Text>
      </Box>
    );
  }

  if (!focused) {
    // Show the text value, clicking focuses
    return (
      <Box style={containerStyle} onClick={handleClick}>
        <Text style={baseTextStyle}>{displayText || ' '}</Text>
      </Box>
    );
  }

  // Focused: show text with blinking cursor, handle keyboard events
  return (
    <Box
      style={containerStyle}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onTextInput={handleTextInput}
    >
      <Box style={{ flexDirection: 'row', alignItems: 'center' }}>
        {textBeforeCursor.length > 0 && (
          <Text style={baseTextStyle}>{textBeforeCursor}</Text>
        )}
        <Box style={cursorStyle} />
        {textAfterCursor.length > 0 && (
          <Text style={baseTextStyle}>{textAfterCursor}</Text>
        )}
        {isEmpty && (
          <Text style={placeholderTextStyle}>{placeholder ?? ''}</Text>
        )}
      </Box>
    </Box>
  );
}

// ── Public component ────────────────────────────────────

export function TextInput(props: TextInputProps) {
  const mode = useRendererMode();

  if (mode === 'web') {
    return <WebTextInput {...props} />;
  }

  return <NativeTextInput {...props} />;
}
