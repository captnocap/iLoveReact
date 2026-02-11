/**
 * CodeEditor — Multi-line code editor built from Box + Text primitives.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text } from '../ilovereact/shared/src';
import { tokenizeLine, TOKEN_COLORS } from './lib/tokenizer';
import type { LoveEvent } from '../ilovereact/shared/src/types';

const FONT_SIZE = 13;
const LINE_HEIGHT = 20;
const GUTTER_WIDTH = 36;
const CURSOR_WIDTH = 2;
const TAB_STRING = '  ';

interface Cursor { line: number; col: number; }
interface CodeEditorProps { initialCode: string; onChange: (code: string) => void; jumpToLine?: number; }

function useCursorBlink(focused: boolean): [boolean, () => void] {
  const [visible, setVisible] = useState(true);
  const resetRef = useRef(0);
  useEffect(() => {
    if (!focused) { setVisible(false); return; }
    setVisible(true);
    const id = setInterval(() => setVisible(v => !v), 530);
    return () => clearInterval(id);
  }, [focused, resetRef.current]);
  return [visible, useCallback(() => { resetRef.current += 1; }, [])];
}

export function CodeEditor({ initialCode, onChange, jumpToLine }: CodeEditorProps) {
  const [lines, setLines] = useState<string[]>(() => initialCode.split('\n'));
  const [cursor, setCursor] = useState<Cursor>({ line: 0, col: 0 });
  const [focused, setFocused] = useState(true);
  const [cursorVisible, resetBlink] = useCursorBlink(focused);

  const notify = useCallback((nl: string[]) => onChange(nl.join('\n')), [onChange]);

  useEffect(() => {
    if (jumpToLine !== undefined && jumpToLine > 0)
      setCursor({ line: Math.min(jumpToLine - 1, lines.length - 1), col: 0 });
  }, [jumpToLine]);

  const update = useCallback((nl: string[], nc: Cursor) => {
    setLines(nl); setCursor(nc); resetBlink(); notify(nl);
  }, [notify, resetBlink]);

  const insertText = useCallback((text: string) => {
    const nl = [...lines]; const l = nl[cursor.line] || '';
    nl[cursor.line] = l.slice(0, cursor.col) + text + l.slice(cursor.col);
    update(nl, { line: cursor.line, col: cursor.col + text.length });
  }, [lines, cursor, update]);

  const insertNewline = useCallback(() => {
    const nl = [...lines]; const l = nl[cursor.line] || '';
    const indent = l.match(/^(\s*)/)?.[1] || '';
    nl[cursor.line] = l.slice(0, cursor.col);
    nl.splice(cursor.line + 1, 0, indent + l.slice(cursor.col));
    update(nl, { line: cursor.line + 1, col: indent.length });
  }, [lines, cursor, update]);

  const backspace = useCallback(() => {
    if (cursor.col > 0) {
      const nl = [...lines]; const l = nl[cursor.line] || '';
      nl[cursor.line] = l.slice(0, cursor.col - 1) + l.slice(cursor.col);
      update(nl, { line: cursor.line, col: cursor.col - 1 });
    } else if (cursor.line > 0) {
      const nl = [...lines]; const plen = (nl[cursor.line - 1] || '').length;
      nl[cursor.line - 1] = (nl[cursor.line - 1] || '') + (nl[cursor.line] || '');
      nl.splice(cursor.line, 1);
      update(nl, { line: cursor.line - 1, col: plen });
    }
  }, [lines, cursor, update]);

  const deleteFwd = useCallback(() => {
    const l = lines[cursor.line] || '';
    if (cursor.col < l.length) {
      const nl = [...lines]; nl[cursor.line] = l.slice(0, cursor.col) + l.slice(cursor.col + 1);
      update(nl, cursor);
    } else if (cursor.line < lines.length - 1) {
      const nl = [...lines]; nl[cursor.line] = l + (nl[cursor.line + 1] || '');
      nl.splice(cursor.line + 1, 1); update(nl, cursor);
    }
  }, [lines, cursor, update]);

  const move = useCallback((nl: number, nc: number) => {
    const cl = Math.max(0, Math.min(nl, lines.length - 1));
    setCursor({ line: cl, col: Math.max(0, Math.min(nc, (lines[cl] || '').length)) });
    resetBlink();
  }, [lines, resetBlink]);

  const handleTextInput = useCallback((e: LoveEvent) => {
    if (!focused || !e.text || e.text === '\n' || e.text === '\r') return;
    insertText(e.text);
  }, [focused, insertText]);

  const handleKeyDown = useCallback((e: LoveEvent) => {
    if (!focused || !e.key) return;
    resetBlink();
    switch (e.key) {
      case 'backspace': backspace(); break;
      case 'delete': deleteFwd(); break;
      case 'return': insertNewline(); break;
      case 'tab': insertText(TAB_STRING); break;
      case 'left': cursor.col > 0 ? move(cursor.line, cursor.col - 1) : cursor.line > 0 && move(cursor.line - 1, (lines[cursor.line - 1] || '').length); break;
      case 'right': { const len = (lines[cursor.line] || '').length; cursor.col < len ? move(cursor.line, cursor.col + 1) : cursor.line < lines.length - 1 && move(cursor.line + 1, 0); break; }
      case 'up': cursor.line > 0 && move(cursor.line - 1, cursor.col); break;
      case 'down': cursor.line < lines.length - 1 && move(cursor.line + 1, cursor.col); break;
      case 'home': move(cursor.line, 0); break;
      case 'end': move(cursor.line, (lines[cursor.line] || '').length); break;
      case 'escape': setFocused(false); break;
    }
  }, [focused, cursor, lines, backspace, deleteFwd, insertNewline, insertText, move, resetBlink]);

  return (
    // ilr-ignore-next-line
    <Box style={{ flexGrow: 1, backgroundColor: '#1e1e2e', overflow: 'scroll' }}
      onClick={() => { if (!focused) { setFocused(true); resetBlink(); } }}
      onKeyDown={handleKeyDown} onTextInput={handleTextInput}>
      {lines.map((line, i) => (
        <Box key={i} style={{ flexDirection: 'row', height: LINE_HEIGHT, alignItems: 'center' }}>
          <Box style={{ width: GUTTER_WIDTH, height: LINE_HEIGHT, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 8 }}>
            <Text style={{ fontSize: FONT_SIZE, color: cursor.line === i ? '#6c7086' : '#45475a' }}>{String(i + 1)}</Text>
          </Box>
          <Box style={{ flexDirection: 'row', flexGrow: 1, height: LINE_HEIGHT, alignItems: 'center', paddingLeft: 4 }}>
            {renderTokens(line, i, cursor, focused && cursorVisible)}
          </Box>
        </Box>
      ))}
      <Box style={{ height: 100 }} />
    </Box>
  );
}

function renderTokens(line: string, lineIdx: number, cursor: Cursor, showCursor: boolean): React.ReactNode[] {
  const tokens = tokenizeLine(line);
  const els: React.ReactNode[] = [];
  const isCL = cursor.line === lineIdx;

  if (!line.length) {
    if (isCL && showCursor) els.push(<Box key="c" style={{ width: CURSOR_WIDTH, height: FONT_SIZE + 2, backgroundColor: '#cdd6f4' }} />);
    return els;
  }

  let off = 0, done = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], s = off, e = off + t.text.length;
    if (isCL && !done && cursor.col >= s && cursor.col <= e) {
      const sp = cursor.col - s;
      if (sp > 0) els.push(<Text key={`${i}a`} style={{ fontSize: FONT_SIZE, color: TOKEN_COLORS[t.type] }}>{t.text.slice(0, sp)}</Text>);
      if (showCursor) els.push(<Box key="c" style={{ width: CURSOR_WIDTH, height: FONT_SIZE + 2, backgroundColor: '#cdd6f4' }} />);
      if (sp < t.text.length) els.push(<Text key={`${i}b`} style={{ fontSize: FONT_SIZE, color: TOKEN_COLORS[t.type] }}>{t.text.slice(sp)}</Text>);
      done = true;
    } else {
      els.push(<Text key={`${i}`} style={{ fontSize: FONT_SIZE, color: TOKEN_COLORS[t.type] }}>{t.text}</Text>);
    }
    off = e;
  }
  if (isCL && !done && showCursor) els.push(<Box key="c" style={{ width: CURSOR_WIDTH, height: FONT_SIZE + 2, backgroundColor: '#cdd6f4' }} />);
  return els;
}
