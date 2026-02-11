/**
 * TextEditor -- Document-style text editor for web and native (Love2D) modes.
 *
 * This is a "Lua-owned interaction" primitive. In native mode, ALL text editing
 * (cursor, selection, keystrokes, scrolling) happens entirely in Lua. The JS
 * side only receives boundary events: focus, blur, submit.
 *
 * Web mode: renders a <textarea> with appropriate styling.
 * Native mode: emits a 'TextEditor' host element — Lua's texteditor.lua
 *              handles everything.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRendererMode } from './context';
import { styleToCSS, colorToCSS } from './primitives';
import type { TextEditorProps, Style, LoveEvent } from './types';

// ── Web mode component ──────────────────────────────────

function WebTextEditor({
  initialValue,
  value,
  onChangeText,
  onSubmit,
  onFocus,
  onBlur,
  placeholder,
  readOnly,
  lineNumbers,
  style,
  textStyle,
}: TextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [internalValue, setInternalValue] = useState(initialValue ?? '');
  const isControlled = value !== undefined;
  const currentText = isControlled ? value : internalValue;

  const containerCSS = styleToCSS(style);

  const textCSS = styleToCSS(textStyle);
  const inputCSS: React.CSSProperties = {
    width: '100%',
    height: '100%',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    padding: 8,
    margin: 0,
    fontFamily: textCSS.fontFamily || 'monospace',
    fontSize: textCSS.fontSize || 14,
    fontWeight: textCSS.fontWeight || 'normal',
    color: textCSS.color || '#d9dee8',
    resize: 'none' as const,
    lineHeight: 1.55,
    tabSize: 4,
  };

  const handleBlur = useCallback(() => {
    const val = isControlled ? value! : internalValue;
    onBlur?.(val);
    onChangeText?.(val);
  }, [isControlled, value, internalValue, onBlur, onChangeText]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter' && onSubmit) {
        e.preventDefault();
        const val = (e.target as HTMLTextAreaElement).value;
        onSubmit(val);
      }
    },
    [onSubmit],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!isControlled) {
        setInternalValue(e.target.value);
      }
    },
    [isControlled],
  );

  return (
    <div
      style={{
        backgroundColor: '#1e1e24',
        borderRadius: 4,
        overflow: 'hidden',
        ...containerCSS,
      }}
    >
      <textarea
        ref={textareaRef}
        style={inputCSS}
        value={currentText}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={handleChange}
        onFocus={onFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        spellCheck={false}
      />
    </div>
  );
}

// ── Native mode component ───────────────────────────────

function NativeTextEditor({
  initialValue,
  value,
  onChangeText,
  onSubmit,
  onFocus,
  onBlur,
  placeholder,
  readOnly,
  lineNumbers,
  style,
  textStyle,
}: TextEditorProps) {
  // In native mode, we emit a 'TextEditor' host element.
  // Lua's texteditor.lua handles ALL interaction — cursor, selection,
  // keyboard input, scrolling. No per-keystroke bridge traffic.
  //
  // The only events that cross the bridge are:
  //   texteditor:focus  — user clicked into the editor
  //   texteditor:blur   — user clicked away or pressed Escape
  //   texteditor:submit — user pressed Ctrl+Enter

  // Merge text style into the main style so Lua can read fontSize/fontFamily/color
  const mergedStyle: Style = {
    ...(style || {}),
  };
  if (textStyle) {
    if (textStyle.fontSize) mergedStyle.fontSize = textStyle.fontSize;
    if (textStyle.fontFamily) mergedStyle.fontFamily = textStyle.fontFamily;
    if (textStyle.fontWeight) mergedStyle.fontWeight = textStyle.fontWeight;
    if (textStyle.color) mergedStyle.color = textStyle.color;
  }

  // Event handlers — these stay in JS via handlerRegistry, Lua sends
  // boundary events that dispatch to them
  const handleFocus = useCallback(
    (event: LoveEvent) => {
      onFocus?.();
    },
    [onFocus],
  );

  const handleBlur = useCallback(
    (event: LoveEvent) => {
      const text = (event as any).value ?? '';
      onBlur?.(text);
      onChangeText?.(text);
    },
    [onBlur, onChangeText],
  );

  const handleSubmit = useCallback(
    (event: LoveEvent) => {
      const text = (event as any).value ?? '';
      onSubmit?.(text);
      onChangeText?.(text);
    },
    [onSubmit, onChangeText],
  );

  // Data props that cross the bridge (Lua reads from node.props)
  const props: Record<string, any> = {
    style: mergedStyle,
    initialValue: initialValue ?? '',
    placeholder: placeholder ?? '',
    readOnly: readOnly ?? false,
    lineNumbers: lineNumbers !== false,
  };

  // Controlled value support
  if (value !== undefined) {
    props.value = value;
  }

  // Handlers — these are extracted by the reconciler's extractHandlers()
  // and stored in handlerRegistry, NOT sent to Lua
  if (onFocus) props['onTextEditorFocus'] = handleFocus;
  if (onBlur || onChangeText) props['onTextEditorBlur'] = handleBlur;
  if (onSubmit) props['onTextEditorSubmit'] = handleSubmit;

  return React.createElement('TextEditor', props);
}

// ── Public component ────────────────────────────────────

export function TextEditor(props: TextEditorProps) {
  const mode = useRendererMode();

  if (mode === 'web') {
    return <WebTextEditor {...props} />;
  }

  return <NativeTextEditor {...props} />;
}
