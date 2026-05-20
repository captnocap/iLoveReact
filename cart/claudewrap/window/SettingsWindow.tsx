// SettingsWindow — top-level configuration surface.
//
// Mounted by App.tsx unconditionally. The <Window> primitive only
// renders when `windowOpen` is true; toggled by the chord wired in
// App.tsx, or by clicking a button in the TUI (later).
//
// Left rail = panel nav. Right pane = active panel content. All
// panels share the cart's settings store so edits in one are visible
// from the TUI's RecipesPage etc.

import * as React from 'react';
import { Box, Col, Row, Text, Pressable, Window } from '../../../runtime/primitives';
import { palette } from '../ui/palette';
import { useSettings, setSettings, type Settings } from '../state';
import { BridgePanel } from './BridgePanel';
import { BackendsPanel } from './BackendsPanel';
import { MemoryPanel } from './MemoryPanel';
import { LibraryPanel } from './LibraryPanel';
import { VmPanel } from './VmPanel';
import { CanvasPanel } from './CanvasPanel';

type PanelId = Settings['activePanel'];

const PANELS: { id: PanelId; label: string }[] = [
  { id: 'bridge',   label: 'bridge'   },
  { id: 'backends', label: 'backends' },
  { id: 'memory',   label: 'memory'   },
  { id: 'library',  label: 'library'  },
  { id: 'vm',       label: 'vm'       },
  { id: 'canvas',   label: 'canvas'   },
];

export function SettingsWindow() {
  const { windowOpen, activePanel } = useSettings();
  if (!windowOpen) return null;

  return (
    <Window title="claudewrap · settings" width={900} height={620}>
      <Row style={{ width: '100%', height: '100%', backgroundColor: palette.bg }}>
        <PanelNav active={activePanel} />
        <Col style={{ flexGrow: 1, padding: 1 }}>
          {activePanel === 'bridge'   && <BridgePanel />}
          {activePanel === 'backends' && <BackendsPanel />}
          {activePanel === 'memory'   && <MemoryPanel />}
          {activePanel === 'library'  && <LibraryPanel />}
          {activePanel === 'vm'       && <VmPanel />}
          {activePanel === 'canvas'   && <CanvasPanel />}
        </Col>
      </Row>
    </Window>
  );
}

function PanelNav({ active }: { active: PanelId }) {
  return (
    <Col style={{
      width: 18,
      height: '100%',
      backgroundColor: palette.bar,
      paddingTop: 1,
      paddingBottom: 1,
      gap: 0,
    }}>
      <Box style={{ paddingLeft: 1, paddingBottom: 1 }}>
        <Text style={{ color: palette.accent, fontWeight: 'bold' }}>panels</Text>
      </Box>
      {PANELS.map(p => {
        const isActive = p.id === active;
        return (
          <Pressable key={p.id} onPress={() => setSettings({ activePanel: p.id })}>
            <Box style={{
              paddingLeft: 2,
              paddingRight: 2,
              backgroundColor: isActive ? palette.accent : palette.bar,
            }}>
              <Text style={{
                color: isActive ? '#000000' : palette.dim,
                fontWeight: isActive ? 'bold' : 'normal',
              }}>{p.label}</Text>
            </Box>
          </Pressable>
        );
      })}
      <Box style={{ flexGrow: 1 }} />
      <Pressable onPress={() => setSettings({ windowOpen: false })}>
        <Box style={{ paddingLeft: 2, paddingRight: 2 }}>
          <Text style={{ color: palette.bad }}>[close]</Text>
        </Box>
      </Pressable>
    </Col>
  );
}
