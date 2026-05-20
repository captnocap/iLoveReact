// JsonView — colorized + wrapped JSON renderer for the expanded
// event view. Wraps tui/devshell/services/JsonColorizer so the
// formatting logic lives in one shared place.

import * as React from 'react';
import { Col, Row, Text } from '../../../runtime/primitives';
import { colorizeJsonLines, wrapLines } from '../../../tui/devshell/services/JsonColorizer';

export function JsonView({
  payload,
  width,
}: {
  payload: any;
  width: number;
}) {
  const text = formatPayload(payload);
  const lines = wrapLines(text, Math.max(1, width)).map(l => l.length === 0 ? ' ' : l);
  const colorized = colorizeJsonLines(lines);
  return (
    <Col style={{ gap: 0 }}>
      {colorized.map((toks, j) => (
        <Row key={j} style={{ gap: 0 }}>
          {toks.map((tok, k) => (
            <Text key={k} style={{ color: tok.color }}>{tok.text}</Text>
          ))}
        </Row>
      ))}
    </Col>
  );
}

export function formatPayload(p: any): string {
  if (p == null) return '(no payload)';
  if (typeof p === 'string') return p;
  try { return JSON.stringify(p, null, 2); } catch { return String(p); }
}
