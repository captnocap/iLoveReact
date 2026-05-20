import * as React from 'react';
import { Box, Row, Text, Pressable } from '../../../runtime/primitives';
import { palette } from './palette';
import { useSettings, setSettings } from '../state';
import type { TabId } from '../types';

const TABS: { id: TabId; label: string }[] = [
  { id: 'main',    label: '1 claude'  },
  { id: 'ifttt',   label: '2 ifttt'   },
  { id: 'recipes', label: '3 recipes' },
  { id: 'help',    label: '4 help'    },
];

export function TabBar({
  tab,
  onSelect,
}: {
  tab: TabId;
  onSelect: (t: TabId) => void;
}) {
  const { windowOpen } = useSettings();
  return (
    <Row style={{ height: 1, backgroundColor: palette.bar }}>
      {TABS.map(t => {
        const active = t.id === tab;
        return (
          <Pressable key={t.id} onPress={() => onSelect(t.id)}>
            <Box style={{
              paddingLeft: 2, paddingRight: 2,
              backgroundColor: active ? palette.accent : palette.bar,
            }}>
              <Text style={{
                color: active ? '#000000' : palette.dim,
                fontWeight: active ? 'bold' : 'normal',
              }}>{t.label}</Text>
            </Box>
          </Pressable>
        );
      })}
      {/* Pushes the settings button to the right edge — it's a different
          kind of action (opens a GUI window, doesn't switch TUI tab). */}
      <Box style={{ flexGrow: 1 }} />
      <Pressable onPress={() => setSettings({ windowOpen: !windowOpen })}>
        <Box style={{
          paddingLeft: 2, paddingRight: 2,
          backgroundColor: windowOpen ? palette.accent : palette.bar,
        }}>
          <Text style={{
            color: windowOpen ? '#000000' : palette.dim,
            fontWeight: windowOpen ? 'bold' : 'normal',
          }}>
            {windowOpen ? '5 settings ▼' : '5 settings ▶'}
          </Text>
        </Box>
      </Pressable>
    </Row>
  );
}
