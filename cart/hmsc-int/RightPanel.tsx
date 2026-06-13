// RightPanel — the top-right quadrant: a right nav rail of tabs over the active
// tab's content.
//
//   ┌──────────────────────┬──┐
//   │  active tab content   │ ▣│  ← right rail: Objects / Notes / Chat
//   └──────────────────────┴──┘
//
// Tab content lives in ./tabs/*. The active tab is owned + persisted by the cart
// (so it survives hot reload), so this shell is pure routing.

import { Box, Pressable, Text } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { ObjectsTab } from './tabs/ObjectsTab';
import { NotesTab } from './tabs/NotesTab';
import { ChatTab } from './tabs/ChatTab';
import { FacePainter } from './editors/build/FacePainter';
import type { PlaceCat } from './placements';
import type { ScatterBrushId } from './game/kinds/scatter';
import type { BuildEditEvent, BuildPrefabDef, PlacedBuildPiece } from '@game';

// SET retired (SETFOLD-0610, review §5.1/L4): the chrome's SETTINGS door →
// the workbench settings source is THE settings home. The tab's three
// controls went to their task homes: grid toggle → the painter rail,
// pane reset → double-press the QuadSplit knob, notepad clear → NotesTab.
// PAINT added (req_0702): the iso build pane's face painter moved up here —
// full skin-editing capability in the quadrant, off the crowded map. It
// auto-opens when the build pane gets a selection (the cart owns that flip).
export type TabId = 'paint' | 'objects' | 'notes' | 'chat';

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'paint', icon: 'Paintbrush', label: 'PAINT' },
  { id: 'objects', icon: 'FolderTree', label: 'OBJ' },
  { id: 'notes', icon: 'NotebookPen', label: 'NOTE' },
  { id: 'chat', icon: 'MessageSquare', label: 'CHAT' },
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
  buildingPrefabs?: BuildPrefabDef[];
  onPlace: (cat: 'building' | 'prop' | 'marker', kind: string) => void;
  activePlaceable?: { cat: PlaceCat; kind: string } | null;
  onArmPlaceable?: (cat: PlaceCat, kind: string) => void;
  onArmScatter?: (id: ScatterBrushId) => void;
  // PAINT tab (req_0702): the build pieces + the iso pane's mirrored selection +
  // the cart's batched commit — the same trio the floating panel used to get.
  paintPieces: readonly PlacedBuildPiece[];
  paintSelectedIds: ReadonlySet<string>;
  onPaintCommit: (items: ReadonlyArray<{ event: BuildEditEvent; label: string }>) => void;
  // req_0749: the PAINT tab's "paint a texture…" door → the /workbench painter.
  onOpenPainter?: () => void;
}) {
  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'row', backgroundColor: '#0b1320' }}>
      {/* Active tab content */}
      <Box style={{ flexGrow: 1, minWidth: 0, height: '100%' }}>
        {props.tab === 'paint' ? <FacePainter pieces={props.paintPieces} selectedIds={props.paintSelectedIds} commitBatch={props.onPaintCommit} onOpenPainter={props.onOpenPainter} /> : null}
        {props.tab === 'objects' ? <ObjectsTab buildingPrefabs={props.buildingPrefabs} onPlace={props.onPlace} activePlaceable={props.activePlaceable} onArmPlaceable={props.onArmPlaceable} onArmScatter={props.onArmScatter} /> : null}
        {props.tab === 'notes' ? <NotesTab notes={props.notes} onNotes={props.onNotes} /> : null}
        {props.tab === 'chat' ? <ChatTab /> : null}
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
