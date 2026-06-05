// ProjectBar — the workspace shell's persistent top strip + its overlays.
//
// hmsc-int is a multi-map workspace (the city, every building interior, ...).
// This is the project manager: it shows the CURRENT map, switches between maps,
// makes new ones, renames + deletes — VSCode's "open folder" role. It also carries
// undo/redo and a save-log trace. It is the one piece of chrome that never resets
// while you iterate; the editor panes live below.
//
// IMPORTANT layering note: the menus (MapsMenu, SaveLog) are SEPARATE exports
// rendered by the cart as the LAST children of the shell root — NOT nested in the
// 38px strip. Nested, they overflowed the short bar and the editor panes (a later
// sibling) painted on top, so this engine's reverse hit-test routed clicks to the
// canvas. As the root's last child they sit on top of everything. See memory
// overlays_must_be_root_last_child.

import { useState } from 'react';
import { Box, Pressable, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { sanitizeMapName } from './projects';
import { CAT_COLOR, CAT_TAG, relTime, type EditEvent } from './editLog';

export const PROJECT_BAR_H = 38;

// ── The strip ────────────────────────────────────────────────────────────────

interface ProjectBarProps {
  mapName: string;
  activeRoute?: 'editor' | 'assist3d' | 'log' | 'test' | 'textures' | 'voxels' | 'labs' | 'characters' | 'vehicles';
  menuOpen: boolean;
  logOpen: boolean;
  lastSavedAt: number | null;
  canUndo: boolean;
  canRedo: boolean;
  onToggleMenu: () => void;
  onToggleLog: () => void;
  onNew: () => void;
  onEditor: () => void;
  onUndo: () => void;
  onRedo: () => void;
  // Write the authored world (painted terrain as landforms + placements) to the
  // game's boot key, so the standalone game boots THIS map. Deliberate, not on
  // every keystroke — see index.tsx compileToGame.
  onCompile: () => void;
  // Navigate to the /log route — the in-app churn-log viewer (perf diagnostics).
  onPerf: () => void;
  // Navigate to the /assist3d route — the assistant-authored hot 3D surface.
  onAssist: () => void;
  // Navigate to the /test route — quick in-editor player drop-in.
  onTest: () => void;
  // Navigate to the /textures route — the texture studio (tune a shader recipe,
  // Materialize it into a stored material the registry serves everywhere).
  onTextures: () => void;
  // Navigate to the /voxels route — the 1m³ authoring / baked-mesh proposal.
  onVoxels: () => void;
  // Navigate to the /labs route — every lab, instantly loadable (V13).
  onLabs: () => void;
  // Navigate to the /characters route — the character editor (editors/characters,
  // the head_lab authoring UI remade; authors what game/figure runs).
  onCharacters: () => void;
  // Navigate to the /vehicles route — the vehicle editor (editors/vehicles,
  // the vehicle_lab authoring UI remade; authors what game/vehicle builds).
  onVehicles: () => void;
}

function IconBtn(props: { icon: string; on?: boolean; enabled?: boolean; onPress: () => void; title?: string }) {
  const enabled = props.enabled !== false;
  return (
    <Pressable
      onPress={() => { if (enabled) props.onPress(); }}
      style={{ width: 28, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: props.on ? '#f8fafc' : '#27364a', backgroundColor: props.on ? '#1e293b' : '#0f1a2e', opacity: enabled ? 1 : 0.35 }}
    >
      <Icon name={props.icon} size={14} color={enabled ? '#cbd5e1' : '#475569'} />
    </Pressable>
  );
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

      {/* Route navigation — this is the persistent shell for every hmsc-int route. */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <IconBtn icon="LayoutGrid" on={props.activeRoute === 'editor'} onPress={props.onEditor} title="editor" />
        <IconBtn icon="Play" on={props.activeRoute === 'test'} onPress={props.onTest} title="test" />
        <IconBtn icon="FlaskConical" on={props.activeRoute === 'labs'} onPress={props.onLabs} title="labs" />
        <IconBtn icon="User" on={props.activeRoute === 'characters'} onPress={props.onCharacters} title="characters" />
        <IconBtn icon="Car" on={props.activeRoute === 'vehicles'} onPress={props.onVehicles} title="vehicles" />
        <IconBtn icon="Boxes" on={props.activeRoute === 'voxels'} onPress={props.onVoxels} title="voxel bake" />
        <IconBtn icon="Sparkles" on={props.activeRoute === 'assist3d'} onPress={props.onAssist} title="assistant 3D" />
        <IconBtn icon="Palette" on={props.activeRoute === 'textures'} onPress={props.onTextures} title="texture studio" />
        <IconBtn icon="Activity" on={props.activeRoute === 'log'} onPress={props.onPerf} title="churn log" />
      </Box>

      {/* Undo / redo */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <IconBtn icon="Undo2" enabled={props.canUndo} onPress={props.onUndo} />
        <IconBtn icon="Redo2" enabled={props.canRedo} onPress={props.onRedo} />
      </Box>

      <Box style={{ width: 1, height: 18, backgroundColor: '#1e293b' }} />

      {/* Compile → write this authored map to the game's boot key */}
      <Pressable onPress={props.onCompile} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 9, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, borderWidth: 1, borderColor: '#3f6f4a', backgroundColor: '#13351f' }}>
        <Icon name="Hammer" size={13} color="#86efac" />
        <Text fontSize={11} color="#bbf7d0" style={{ fontWeight: 700 }}>Compile</Text>
      </Pressable>

      <Box style={{ width: 1, height: 18, backgroundColor: '#1e293b' }} />

      {/* Save status — click to expand the save-log trace */}
      <Pressable onPress={props.onToggleLog} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 6, borderWidth: 1, borderColor: props.logOpen ? '#f8fafc' : '#27364a', backgroundColor: props.logOpen ? '#1e293b' : '#0f1a2e' }}>
        <Icon name="Check" size={12} color="#22c55e" />
        <Text fontSize={10} color="#94a3b8" style={{ fontFamily: 'monospace' }}>{props.lastSavedAt ? 'saved' : 'autosaving'}</Text>
        <Icon name="ChevronDown" size={12} color="#94a3b8" />
      </Pressable>
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

// ── The event-log trace (overlay) ──────────────────────────────────────────────
// A categorized stream of what actually happened (tile painted, object moved,
// camera moved, ...) — an eventbus view, not autosave spam. Colour + tag come from
// the category; the line text describes the specific edit.

export function EventLog(props: { events: EditEvent[]; now: number; onClose: () => void }) {
  const rows = props.events.slice().reverse(); // newest first
  return (
    <>
      <Pressable onPress={props.onClose} style={{ position: 'absolute', left: 0, top: PROJECT_BAR_H, right: 0, bottom: 0, backgroundColor: '#00000001' }} />
      <Box style={{ position: 'absolute', right: 10, top: PROJECT_BAR_H + 2, width: 288, maxHeight: 380, backgroundColor: '#0b1320', borderWidth: 1, borderColor: '#27364a', borderRadius: 8, paddingTop: 6, paddingBottom: 6 }}>
        <Text fontSize={8} color="#475569" style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1, paddingLeft: 10, marginBottom: 4 }}>EVENT LOG · {props.events.length}</Text>
        {rows.length === 0 ? (
          <Text fontSize={10} color="#475569" style={{ fontFamily: 'monospace', paddingLeft: 10, paddingTop: 4, paddingBottom: 6 }}>no edits yet</Text>
        ) : (
          <ScrollView showScrollbar style={{ maxHeight: 340 }} contentContainerStyle={{ paddingLeft: 6, paddingRight: 6, gap: 1 }}>
            {rows.map((e, i) => {
              const color = CAT_COLOR[e.cat];
              return (
                <Box key={`${e.t}_${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 6, paddingRight: 6, paddingTop: 5, paddingBottom: 5, borderRadius: 4 }}>
                  <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
                  <Text fontSize={8} color={color} style={{ fontFamily: 'monospace', fontWeight: 700, width: 34 }}>{CAT_TAG[e.cat]}</Text>
                  <Text fontSize={11} color="#cbd5e1" style={{ flexGrow: 1 }}>{e.text}</Text>
                  <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace' }}>{relTime(e.t, props.now)}</Text>
                </Box>
              );
            })}
          </ScrollView>
        )}
      </Box>
    </>
  );
}
