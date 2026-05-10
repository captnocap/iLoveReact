// Bottom hint strip. One line; lists the always-on global hotkeys.

import * as React from 'react';
import { Row, Text } from '../../../runtime/primitives';

export function Footer() {
  return (
    <Row style={{ gap: 2, paddingLeft: 1, paddingRight: 1, backgroundColor: 'theme:bg1' }}>
      <Text style={{ color: 'theme:inkFaint' }}>1..5 pane · l log · y copy · ? help · q quit</Text>
    </Row>
  );
}
