// Default landing pane. Just shows what's running: the target cart and
// whether the dev host is up. No framework trivia.

import * as React from 'react';
import { Box, Col, Row, Text } from '../../../runtime/primitives';

export function StatusPane({ cart, hostUp }: { cart: string; hostUp: boolean }) {
  return (
    <Col>
      <Text style={{ color: 'theme:accent', fontWeight: 'bold' }}>Processes</Text>
      <KV k="cart"     v={cart} />
      <KV k="dev host" v={hostUp ? 'connected at /tmp/reactjit.sock' : 'not running'}
                       kc={hostUp ? 'theme:ok' : 'theme:bad'} />
      <KV k="bundle"   v={`.cache/bundle-${cart}.js`} />

      <Text style={{ color: 'theme:inkFaint' }}> </Text>
      <Text style={{ color: 'theme:inkFaint' }}>Press 1..5 to switch panes. Click rail entries to navigate.</Text>
    </Col>
  );
}

function KV({ k, v, kc }: { k: string; v: string; kc?: string }) {
  return (
    <Row style={{ gap: 2 }}>
      <Box style={{ width: 14 }}><Text style={{ color: 'theme:inkDim' }}>{k}</Text></Box>
      <Text style={{ color: kc ?? 'theme:ink' }}>{v}</Text>
    </Row>
  );
}
