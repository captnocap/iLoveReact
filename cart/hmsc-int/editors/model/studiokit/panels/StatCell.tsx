// editors/model/studio/panels/StatCell.tsx — a label·value pair for the frame
// diagnostics strip. Lifted verbatim from editors/model/Studio.tsx (req_1390).

import { Row, Text } from '@reactjit/primitives';
import { T } from '../config';

export function StatCell(props: { label: string; value: string; warn?: boolean }) {
  return (
    <Row style={{ gap: 3, alignItems: 'baseline' }}>
      <Text fontSize={8} color={T.dim} style={{ fontFamily: 'monospace' }}>{props.label}</Text>
      <Text fontSize={9} color={props.warn ? '#ffb454' : T.text} style={{ fontFamily: 'monospace', fontWeight: '800' }}>{props.value}</Text>
    </Row>
  );
}
