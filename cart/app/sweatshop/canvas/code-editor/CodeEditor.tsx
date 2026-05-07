// CodeEditor — a real editable code surface. Wraps the framework's
// <TextEditor> primitive with paintText=true + colorRows so the Zig
// side renders syntax-colored text from the per-row span arrays we
// build with tokenize-ts.ts.
//
// Cursor / selection / scroll / copy-paste are handled natively by
// the primitive — this component just feeds it tokens + chrome.
//
// Read-only mode supported via the `readOnly` prop. The canvas-as-code
// mirror starts read-only (canvas is the source of truth); when
// bidirectional editing lands, flip readOnly off and parse onChange
// back into FlowNode/FlowEdge.

import { useMemo } from 'react';
import { Box, Col, Row, Text, TextEditor } from '@reactjit/runtime/primitives';
import { tokenizeToColorRows } from './tokenize-ts';

export interface CodeEditorProps {
  value: string;
  onChange?: (next: string) => void;
  readOnly?: boolean;
  title?: string;
  filename?: string;
  fontSize?: number;
  lineHeight?: number;
  hideGutter?: boolean;
}

const DEFAULT_FONT_SIZE = 12;
const DEFAULT_LINE_HEIGHT = 18;
const GUTTER_WIDTH = 44;

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
  const colorRows = useMemo(() => tokenizeToColorRows(value), [value]);
  const lineCount = colorRows.length;

  return (
    <Col style={{
      flexGrow: 1,
      minHeight: 0,
      backgroundColor: 'theme:bg1',
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
            paddingLeft: 8, paddingRight: 8,
            backgroundColor: 'theme:bg2',
            borderRightWidth: 1, borderRightColor: 'theme:rule',
          }}>
            {colorRows.map((_, i) => (
              <Box key={i} style={{ height: lineHeight, alignItems: 'flex-end' }}>
                <Text
                  size={fontSize - 1}
                  color="theme:inkDimmer"
                  style={{ fontFamily: 'theme:fontMono' as any }}
                >
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
            color="theme:ink"
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
