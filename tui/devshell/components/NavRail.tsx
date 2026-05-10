// Vertical navigation rail (gallery-shaped). Each pane gets a row;
// the active route is highlighted. Hotkeys are listed alongside so
// the digit-key shortcut is discoverable without opening Help.
//
// Uses the local-router from gallery so navigation state stays in
// React rather than the global URL.

import * as React from 'react';
import { Box, Col, Row, Text } from '../../../runtime/primitives';
import { useNavigate, useRoute } from '../../../cart/app/gallery/local-router';
import { PANES } from '../registry';

export function NavRail() {
  const { path } = useRoute();
  const nav = useNavigate();
  return (
    <Col style={{ width: 16, backgroundColor: 'theme:bg1', paddingTop: 1, paddingBottom: 1 }}>
      <Box style={{ paddingLeft: 1, paddingRight: 1, paddingBottom: 1 }}>
        <Text style={{ color: 'theme:inkFaint' }}>panes</Text>
      </Box>
      {PANES.map(p => {
        const sel = p.route === path;
        return (
          <Row
            key={p.id}
            onPress={() => nav.push(p.route)}
            style={{
              paddingLeft: 1, paddingRight: 1, gap: 1,
              backgroundColor: sel ? 'theme:pinBg' : undefined,
            }}
          >
            <Text style={{ color: sel ? 'theme:accent' : 'theme:inkFaint' }}>{p.hotkey}</Text>
            <Text style={{
              color: sel ? 'theme:accent' : 'theme:inkDim',
              fontWeight: sel ? 'bold' : undefined,
            }}>{p.label}</Text>
          </Row>
        );
      })}
    </Col>
  );
}
