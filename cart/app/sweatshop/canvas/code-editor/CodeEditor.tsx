// CodeEditor — wraps the framework's <TextEditor paintText colorRows>
// primitive with the proven layout shape from cart/deadcode/sweatshop/
// components/code-editor/CodeEditorPanel.tsx:
//
//   ScrollView (viewport)
//     Row (content row, height = editorHeight in pixels)
//       Box (gutter, fixed width)
//       Box (editor canvas, position:relative, fixed pixel size)
//         TextEditor (position:absolute, top:0 left:0, width/height pixels)
//
// The editor sizes to its CONTENT (one big virtual canvas) — not to
// its container. ScrollView lets the viewport scroll. Trying to make
// the TextEditor stretch via width:100%/minHeight:100% breaks
// selection / cursor rendering.
//
// Always editable — caller supplies onChange. A code editor that's
// read-only is a viewer; this is an editor. Edits flow back to the
// caller; bidirectional sync to the canvas is the caller's job (parse
// the new text into FlowEditor nodes/edges).

import { useMemo } from 'react';
import { Box, Col, Row, ScrollView, Text, TextEditor } from '@reactjit/runtime/primitives';
import { tokenizeToColorRows } from './tokenize-ts';

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  title?: string;
  filename?: string;
  fontSize?: number;
}

const DEFAULT_FONT_SIZE = 13;

export function CodeEditor({
  value,
  onChange,
  title,
  filename,
  fontSize = DEFAULT_FONT_SIZE,
}: CodeEditorProps) {
  const colorRows = useMemo(() => tokenizeToColorRows(value), [value]);
  const lineCount = colorRows.length;

  const lineHeight = fontSize + 5;
  const topPad = 8;
  const bottomPad = 16;
  const leftPad = 12;
  const rightPad = 24;

  const lines = value.split('\n');
  const longestCol = lines.reduce((m, l) => Math.max(m, l.length), 1);
  // Min editor width keeps short content from collapsing. The
  // measurement is approximate (0.6em per glyph for monospace) — the
  // ScrollView absorbs any slack.
  const editorWidth = Math.max(560, Math.ceil(longestCol * (fontSize * 0.6)) + leftPad + rightPad);
  const editorHeight = Math.max(160, lineCount * lineHeight + topPad + bottomPad);
  const gutterWidth = 44;

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
            {lineCount} line{lineCount === 1 ? '' : 's'}
          </Text>
        </Row>
      )}

      <ScrollView showScrollbar={true} style={{
        flexGrow: 1,
        height: '100%',
        backgroundColor: 'theme:bg1',
      }}>
        <Row style={{
          minHeight: editorHeight,
          width: gutterWidth + editorWidth,
          alignItems: 'flex-start',
        }}>
          {/* Gutter */}
          <Col style={{
            width: gutterWidth,
            paddingTop: topPad,
            paddingBottom: bottomPad,
            paddingLeft: 8, paddingRight: 8,
            backgroundColor: 'theme:bg2',
            borderRightWidth: 1, borderRightColor: 'theme:rule',
          }}>
            {colorRows.map((_, i) => (
              <Box key={i} style={{ height: lineHeight, alignItems: 'flex-end' }}>
                <Text
                  size={fontSize - 2}
                  color="theme:inkDimmer"
                  style={{ fontFamily: 'theme:fontMono' as any }}
                >
                  {String(i + 1)}
                </Text>
              </Box>
            ))}
          </Col>

          {/* Editor canvas — fixed pixel size, position:relative parent */}
          <Box style={{
            width: editorWidth,
            height: editorHeight,
            position: 'relative',
            backgroundColor: 'theme:bg1',
          }}>
            <TextEditor
              value={value}
              onChangeText={onChange}
              paintText={true}
              colorRows={colorRows}
              fontSize={fontSize}
              color="theme:ink"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: editorWidth,
                height: editorHeight,
                paddingTop: topPad,
                paddingBottom: bottomPad,
                paddingLeft: leftPad,
                paddingRight: rightPad,
                borderWidth: 0,
                fontFamily: 'theme:fontMono' as any,
                lineHeight,
              }}
            />
          </Box>
        </Row>
      </ScrollView>
    </Col>
  );
}
