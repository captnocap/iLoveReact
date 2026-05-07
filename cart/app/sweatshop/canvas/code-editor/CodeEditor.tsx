// CodeEditor — a real editable code surface for the sweatshop canvas
// mirror. Composes the framework's TextEditor primitive (cursor +
// selection + scroll + clipboard, all native) with a per-line TS
// tokenizer that paints syntax via the primitive's `colorRows` prop
// and `paintText={true}` flag.
//
// V0 supports TypeScript / TSX. Read-only mode supported via the
// `readOnly` prop; today the canvas mirror is read-only (the canvas
// is the source of truth) but the editor surface is the same — when
// bidirectional editing lands, flip readOnly off and parse onChange
// back into FlowNode/FlowEdge.

import { useMemo } from 'react';
import { Box, Col, Row, Text, TextEditor } from '@reactjit/runtime/primitives';
import { tokenizeTS, colorForToken } from './tokenize-ts';

export interface CodeEditorProps {
  value: string;
  onChange?: (next: string) => void;
  readOnly?: boolean;
  /** Optional title shown in the editor header. */
  title?: string;
  /** Optional filename badge — appears next to the title. */
  filename?: string;
  fontSize?: number;
  lineHeight?: number;
  /** Hide the gutter (line numbers). Default: false. */
  hideGutter?: boolean;
}

const DEFAULT_FONT_SIZE = 12;
const DEFAULT_LINE_HEIGHT = 18;
const GUTTER_WIDTH = 44;
const GUTTER_PADDING = 8;

export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  title,
  filename,
  fontSize = DEFAULT_FONT_SIZE,
  lineHeight = DEFAULT_LINE_HEIGHT,
  hideGutter = false,
}: CodeEditorProps) {
  const tokenLines = useMemo(() => tokenizeTS(value), [value]);
  const colorRows = useMemo(
    () => tokenLines.map((toks) => toks.map((t) => ({ text: t.text, color: colorForToken(t.kind) }))),
    [tokenLines],
  );
  const lineCount = tokenLines.length;

  return (
    <Col style={{
      flexGrow: 1,
      minHeight: 0,
      backgroundColor: '#0c1018',
      overflow: 'hidden',
    }}>
      {(title || filename) && (
        <Row style={{
          paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, gap: 8,
          borderBottomWidth: 1, borderBottomColor: 'theme:rule',
          backgroundColor: 'theme:bg2',
          alignItems: 'center',
        }}>
          {title ? <Text size={11} color="theme:ink" bold>{title}</Text> : null}
          {filename ? <Text size={10} color="theme:inkDim">{filename}</Text> : null}
          <Box style={{ flexGrow: 1 }} />
          <Text size={10} color="theme:inkDim">
            {readOnly ? 'read-only' : 'editable'} · {lineCount} line{lineCount === 1 ? '' : 's'}
          </Text>
        </Row>
      )}
      <Row style={{ flexGrow: 1, minHeight: 0, alignItems: 'stretch' }}>
        {!hideGutter && (
          <Col style={{
            width: GUTTER_WIDTH,
            paddingTop: 4, paddingBottom: 4,
            paddingLeft: GUTTER_PADDING, paddingRight: GUTTER_PADDING,
            backgroundColor: '#0a0d14',
            borderRightWidth: 1, borderRightColor: '#1a202b',
          }}>
            {tokenLines.map((_, i) => (
              <Box key={i} style={{ height: lineHeight, alignItems: 'flex-end' }}>
                <Text size={fontSize - 1} color="#3e4453" style={{ fontFamily: 'theme:fontMono' as any }}>
                  {String(i + 1)}
                </Text>
              </Box>
            ))}
          </Col>
        )}
        <Box style={{ flexGrow: 1, minWidth: 0, position: 'relative', overflow: 'auto' }}>
          <TextEditor
            value={value}
            onChange={readOnly ? undefined : onChange}
            paintText={true}
            colorRows={colorRows}
            fontSize={fontSize}
            color="#cdd6f4"
            readOnly={readOnly}
            multiline={true}
            style={{
              width: '100%',
              minHeight: '100%',
              paddingTop: 4,
              paddingBottom: 4,
              paddingLeft: 12,
              paddingRight: 12,
              borderWidth: 0,
              backgroundColor: 'transparent',
              fontFamily: 'theme:fontMono' as any,
              lineHeight,
              tabWidth: 2,
            }}
          />
        </Box>
      </Row>
    </Col>
  );
}
