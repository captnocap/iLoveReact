// RightPanel — the top-right quadrant: a right nav rail of tabs over the active
// tab's content.
//
//   ┌──────────────────────┬──┐
//   │  active tab content   │ ▣│  ← right rail: Objects / Notes / Chat / Settings
//   └──────────────────────┴──┘
//
// Tab content lives in ./tabs/*. The active tab is owned + persisted by the cart
// (so it survives hot reload), so this shell is pure routing.

import { Box, Pressable, Text } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { ObjectsTab } from './tabs/ObjectsTab';
import { NotesTab } from './tabs/NotesTab';
import { ChatTab } from './tabs/ChatTab';
import { SettingsTab } from './tabs/SettingsTab';
import type { PlaceCat } from './placements';

export type TabId = 'objects' | 'notes' | 'chat' | 'settings';

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'objects', icon: 'FolderTree', label: 'OBJ' },
  { id: 'notes', icon: 'NotebookPen', label: 'NOTE' },
  { id: 'chat', icon: 'MessageSquare', label: 'CHAT' },
  { id: 'settings', icon: 'Settings', label: 'SET' },
];

function TabButton(props: { icon: string; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={{
        width: '100%', paddingTop: 8, paddingBottom: 8, gap: 3,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: props.active ? '#0b1320' : 'transparent',
        borderLeftWidth: 2, borderLeftColor: props.active ? '#38bdf8' : 'transparent',
      }}
    >
      <Icon name={props.icon} size={16} color={props.active ? '#f8fafc' : '#64748b'} />
      <Text fontSize={7} color={props.active ? '#cbd5e1' : '#475569'} style={{ fontWeight: 700, letterSpacing: 1 }}>{props.label}</Text>
    </Pressable>
  );
}

export function RightPanel(props: {
  tab: TabId;
  onTab: (t: TabId) => void;
  notes: string;
  onNotes: (s: string) => void;
  showGrid: boolean;
  onShowGrid: (v: boolean) => void;
  onResetLayout: () => void;
  onClearNotes: () => void;
  lastSavedAt: number | null;
  onPlace: (cat: 'building' | 'prop' | 'marker', kind: string) => void;
  activePlaceable?: { cat: PlaceCat; kind: string } | null;
  onArmPlaceable?: (cat: PlaceCat, kind: string) => void;
}) {
  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'row', backgroundColor: '#0b1320' }}>
      {/* Active tab content */}
      <Box style={{ flexGrow: 1, minWidth: 0, height: '100%' }}>
        {props.tab === 'objects' ? <ObjectsTab onPlace={props.onPlace} activePlaceable={props.activePlaceable} onArmPlaceable={props.onArmPlaceable} /> : null}
        {props.tab === 'notes' ? <NotesTab notes={props.notes} onNotes={props.onNotes} /> : null}
        {props.tab === 'chat' ? <ChatTab /> : null}
        {props.tab === 'settings' ? (
          <SettingsTab
            showGrid={props.showGrid}
            onShowGrid={props.onShowGrid}
            onResetLayout={props.onResetLayout}
            onClearNotes={props.onClearNotes}
            lastSavedAt={props.lastSavedAt}
          />
        ) : null}
      </Box>

      {/* Right nav rail */}
      <Box style={{ width: 46, height: '100%', borderLeftWidth: 1, borderLeftColor: '#16202f', backgroundColor: '#0a0f1a' }}>
        {TABS.map((t) => (
          <TabButton key={t.id} icon={t.icon} label={t.label} active={props.tab === t.id} onPress={() => props.onTab(t.id)} />
        ))}
      </Box>
    </Box>
  );
}
