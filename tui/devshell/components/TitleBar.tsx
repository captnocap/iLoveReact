// Top strip: app name + cart name + host status + log level.
// One line; the toast pane below replaces it temporarily on copy.

import * as React from 'react';
import { Box, Row, Text } from '../../../runtime/primitives';
import { useLogLevel } from '../services/LogLevel';

export function TitleBar({ cart, hostUp }: { cart: string; hostUp: boolean }) {
  const log = useLogLevel();
  return (
    <Row style={{ paddingLeft: 1, paddingRight: 1, gap: 2, backgroundColor: 'theme:bg1' }}>
      <Text style={{ color: 'theme:info', fontWeight: 'bold' }}>rjit</Text>
      <Row style={{ gap: 1 }}>
        <Text style={{ color: 'theme:inkDim' }}>cart=</Text>
        <Text style={{ color: 'theme:accent', fontWeight: 'bold' }}>{cart}</Text>
      </Row>
      <Text style={{ color: hostUp ? 'theme:ok' : 'theme:bad' }}>
        host {hostUp ? '● up' : '○ down'}
      </Text>
      <Text style={{ color: log.color }}>log:{log.name ?? '—'}</Text>
      <Box style={{ flexGrow: 1 }} />
    </Row>
  );
}
