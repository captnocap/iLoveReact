// ProjectBar — the workspace shell's persistent top strip + its maps menu.
//
// hmsc-int is a multi-map workspace (the city, every building interior, ...).
// This is the project manager: it shows the CURRENT map, switches between maps,
// makes new ones, renames + deletes — VSCode's "open folder" role. It is the one
// piece of chrome that never resets while you iterate; the editor panes live below.
//
// IMPORTANT layering note: the maps menu is a SEPARATE export (MapsMenu) rendered
// by the cart as the LAST child of the shell root — NOT nested in the 38px strip.
// Nested, it overflowed the short bar and the editor panes (a later sibling) painted
// on top of it, so this engine's reverse hit-test routed clicks to the canvas and
// you couldn't pick a map. As the root's last child it's on top of everything.

import { useState } from 'react';
import { Box, Pressable, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { sanitizeMapName } from './projects';

export const PROJECT_BAR_H = 38;

function savedLabel(at: number | null): string {
  return at ? 'saved' : 'autosaving';
}

// ── The strip ────────────────────────────────────────────────────────────────

interface ProjectBarProps {
  mapName: string;
  menuOpen: boolean;
  lastSavedAt: number | null;
  onToggleMenu: () => void;
  onNew: () => void;
}

export function ProjectBar(props: ProjectBarProps) {
  return (
    <Box style={{ width: '100%', height: PROJECT_BAR_H, flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 10, gap: 10, backgroundColor: '#0b1320', borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="Map" size={14} color="#64748b" />
        <Text fontSize={10} color="#475569" style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}>WORLD EDITOR</Text>
      </Box>

      <Box style={{ width: 1, height: 18, backgroundColor: '#1e293b' }} />

      {/* Current-map switcher → toggles the maps menu */}
      <Pressable onPress={props.onToggleMenu} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 10, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, borderWidth: 1, borderColor: props.menuOpen ? '#f8fafc' : '#27364a', backgroundColor: props.menuOpen ? '#1e293b' : '#0f1a2e' }}>
        <Box style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#86efac' }} />
        <Text fontSize={12} color="#e2e8f0" style={{ fontWeight: 700 }}>{props.mapName}</Text>
        <Icon name="ChevronDown" size={13} color="#94a3b8" />
      </Pressable>

      {/* New map */}
      <Pressable onPress={props.onNew} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, borderWidth: 1, borderColor: '#27364a', backgroundColor: '#0f1a2e' }}>
        <Icon name="Plus" size={13} color="#86efac" />
        <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 600 }}>New map</Text>
      </Pressable>

      <Box style={{ flexGrow: 1 }} />

      {/* Save status */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Icon name="Check" size={12} color="#22c55e" />
        <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>{savedLabel(props.lastSavedAt)}</Text>
      </Box>
    </Box>
  );
}

// ── The maps menu (overlay) ────────────────────────────────────────────────────

interface MapsMenuProps {
  mapName: string;
  maps: string[];
  onOpen: (name: string) => void;
  onRename: (name: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
}

export function MapsMenu(props: MapsMenuProps) {
  const [draft, setDraft] = useState(props.mapName);

  const commitRename = () => {
    const next = sanitizeMapName(draft);
    if (next && next !== props.mapName) props.onRename(next);
    else props.onClose();
  };

  return (
    <>
      {/* Click-away backdrop — starts BELOW the strip so the bar stays clickable.
          Last child of the shell root, so it (and the panel) sit above the editor. */}
      <Pressable onPress={props.onClose} style={{ position: 'absolute', left: 0, top: PROJECT_BAR_H, right: 0, bottom: 0, backgroundColor: '#00000001' }} />
      <Box style={{ position: 'absolute', left: 150, top: PROJECT_BAR_H + 2, width: 264, maxHeight: 380, backgroundColor: '#0b1320', borderWidth: 1, borderColor: '#27364a', borderRadius: 8, paddingTop: 6, paddingBottom: 6 }}>
        {/* Rename current */}
        <Box style={{ paddingLeft: 8, paddingRight: 8, paddingBottom: 6 }}>
          <Text fontSize={8} color="#475569" style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>CURRENT MAP</Text>
          <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <TextInput
              text={draft}
              onChangeText={setDraft}
              style={{ flexGrow: 1, backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: '#27364a', borderRadius: 4, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, color: '#e2e8f0', fontSize: 11 }}
            />
            <Pressable onPress={commitRename} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: '#27364a', backgroundColor: '#0f1a2e' }}>
              <Text fontSize={10} color="#cbd5e1" style={{ fontWeight: 700 }}>rename</Text>
            </Pressable>
          </Box>
        </Box>

        <Box style={{ height: 1, backgroundColor: '#1e293b', marginTop: 2, marginBottom: 4 }} />

        {/* The maps */}
        <Text fontSize={8} color="#475569" style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1, paddingLeft: 8, marginBottom: 4 }}>MAPS · {props.maps.length}</Text>
        <ScrollView showScrollbar style={{ maxHeight: 244 }} contentContainerStyle={{ paddingLeft: 4, paddingRight: 4, gap: 2 }}>
          {props.maps.map((m) => {
            const isCur = m === props.mapName;
            return (
              <Box key={m} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Pressable
                  onPress={() => { if (!isCur) props.onOpen(m); }}
                  style={{ flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6, borderRadius: 5, borderWidth: 1, borderColor: isCur ? '#334155' : '#0b1320', backgroundColor: isCur ? '#1e293b' : '#0b1320' }}
                >
                  <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isCur ? '#86efac' : '#334155' }} />
                  <Text fontSize={12} color={isCur ? '#f8fafc' : '#cbd5e1'} style={{ fontWeight: isCur ? 700 : 500 }}>{m}</Text>
                  <Box style={{ flexGrow: 1 }} />
                  {isCur ? <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>current</Text> : <Text fontSize={8} color="#475569" style={{ fontFamily: 'monospace' }}>open</Text>}
                </Pressable>
                {!isCur ? (
                  <Pressable onPress={() => props.onDelete(m)} style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: '#3a1d1d', backgroundColor: '#1a0f0f' }}>
                    <Icon name="Trash2" size={12} color="#b45757" />
                  </Pressable>
                ) : null}
              </Box>
            );
          })}
        </ScrollView>
      </Box>
    </>
  );
}
