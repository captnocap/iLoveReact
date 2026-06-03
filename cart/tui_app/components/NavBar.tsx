// NavBar — top-line route picker. Three pills, click to switch.
//
// Intentionally lo-fi: a row of Pressable cells, the active one
// reverse-video'd. Hotkey support (digit-keys to switch panes like
// devshell does) is a future add — it'd require subscribing to
// tui/host's key bus, which isn't exposed to carts cleanly yet.
// Pressable + mouse click works today and is enough for the basics.

import * as React from 'react';
import { Box, Row, Text, Pressable } from '@reactjit/primitives';
import { useNavigate } from '../../app/gallery/local-router';

interface Tab {
  path: string;
  label: string;
}

const TABS: Tab[] = [
  { path: '/chat',     label: 'chat' },
  { path: '/sessions', label: 'sessions' },
  { path: '/user',     label: 'user' },
  { path: '/providers', label: 'providers' },
  { path: '/models',   label: 'models' },
  { path: '/metadata', label: 'meta' },
  { path: '/status',   label: 'status' },
];

export function NavBar({ activePath }: { activePath: string }) {
  const nav = useNavigate();
  return (
    <Row style={{ width: '100%', backgroundColor: '#111827', paddingLeft: 1, paddingRight: 1 }}>
      <Box style={{ paddingRight: 2 }}>
        <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>tui_app</Text>
      </Box>
      {TABS.map((tab) => {
        const isActive = activePath.startsWith(tab.path);
        return (
          <Pressable key={tab.path} onPress={() => nav.push(tab.path)}>
            <Box style={{
              paddingLeft: 2,
              paddingRight: 2,
              backgroundColor: isActive ? '#fbbf24' : '#111827',
            }}>
              <Text style={{
                color: isActive ? '#000000' : '#94a3b8',
                fontWeight: isActive ? 'bold' : 'normal',
              }}>{tab.label}</Text>
            </Box>
          </Pressable>
        );
      })}
    </Row>
  );
}
