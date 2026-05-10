// Transient banner that overlays TitleBar position. Caller decides
// dismissal — Toast just renders.

import * as React from 'react';
import { Row, Text } from '../../../runtime/primitives';

export function Toast({ message }: { message: string }) {
  return (
    <Row style={{ paddingLeft: 1, paddingRight: 1, backgroundColor: 'theme:bg1' }}>
      <Text style={{ color: 'theme:ok', fontWeight: 'bold' }}>{message}</Text>
    </Row>
  );
}
