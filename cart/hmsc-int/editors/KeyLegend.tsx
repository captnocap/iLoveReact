// editors/KeyLegend.tsx — the on-pane keymap strip (EDITORCTL-0610).
//
// Renders a scope's legend rows straight from the control contract
// (editors/controls.ts), so what the strip teaches IS what the dispatcher
// does — the legend cannot drift from the bindings. One renderer for every
// pane; surfaces never hand-write key hint strings again.

import { Row, Text } from '@reactjit/primitives';
import { legendForScope, type EditorScope } from './controls';

export function KeyLegend(props: { scope: EditorScope; dimmed?: boolean }) {
  const rows = legendForScope(props.scope);
  if (!rows.length) return null;
  return (
    <Row
      style={{
        gap: 6,
        alignItems: 'center',
        paddingLeft: 6,
        paddingRight: 6,
        paddingTop: 2,
        paddingBottom: 2,
        backgroundColor: 'rgba(10,12,16,0.55)',
        borderRadius: 4,
      }}
    >
      {rows.map((row) => (
        <Text key={row.legend} style={{ fontSize: 9, color: props.dimmed ? '#5c6470' : '#8b93a1' }}>
          {row.legend}
        </Text>
      ))}
    </Row>
  );
}
