// shell/chrome.tsx — the workspace shell's titlebar + its overlays (WORKBENCH.md
// §6 step 2; replaces ProjectBar.tsx, the W1 wireframe made real).
//
// hmsc-int is a multi-map workspace (the city, every building interior, ...).
// This is the project manager: it shows the CURRENT map, switches between maps,
// makes new ones, renames + deletes — VSCode's "open folder" role. It also carries
// undo/redo, Compile, a save-log trace, and (new at the swap) the WINDOW CONTROLS:
// the host is borderless, so this strip IS the titlebar — the dead middle carries
// windowDrag and min/max/close call the __window_* host fns.
//
// IMPORTANT layering note: the menus (MapsMenu, EventLog) are SEPARATE exports
// rendered by the cart as the LAST children of the shell root — NOT nested in the
// 38px strip. Nested, they overflowed the short bar and the editor panes (a later
// sibling) painted on top, so this engine's reverse hit-test routed clicks to the
// canvas. As the root's last child they sit on top of everything. See memory
// overlays_must_be_root_last_child.
//
// Token discipline: zero raw colours. The strip renders through the Chrome*/Win*
// classes (shell/workbench.cls.ts); the overlays' per-instance values resolve
// through accentFor() (user props are not token-resolved — studio.cls.ts:16).
// The one literal: the overlays' #00000001 click-away backdrop — alpha-only
// hit-test catcher, not a palette colour.

import { useState } from 'react';
import { Box, Pressable, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { callHost } from '@reactjit/ffi';
import { C, CHROME_H, accentFor } from './workbench.cls';
import { sanitizeMapName } from '../projects';
import { CAT_COLOR, CAT_TAG, relTime, type EditEvent } from '../editLog';

// ── The strip ────────────────────────────────────────────────────────────────

interface ChromeProps {
  mapName: string;
  activeRoute?: 'editor' | 'assist3d' | 'log' | 'test' | 'textures' | 'labs' | 'compose' | 'settings' | 'workbench';
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
  // Navigate to the /test route — the embodied game surface (PLAYFOLD-0605:
  // test + Creative Build folded; F1 test / F2 build flip the mode in-route).
  onTest: () => void;
  // Navigate to the /textures route — the texture studio (tune a shader recipe,
  // Materialize it into a stored material the registry serves everywhere).
  onTextures: () => void;
  // Navigate to the /labs route — every lab, instantly loadable (V13).
  onLabs: () => void;
  // Navigate to the /compose route — the decal editor (editors/compose,
  // DECALEDIT-0606: compose Box/Text/Image looks → Materialize → the texture
  // registry; billboards, signs, posters).
  onCompose: () => void;
  // Navigate to the /settings route — the grand settings page (editors/settings):
  // the session event bus across every route channel + the P2 tunables registry.
  onSettings: () => void;
  // Navigate to the /workbench route — the four-gutter rebuild (WORKBENCH.md).
  // Temporary while sources land; the chrome collapse (step 10) retires most of
  // this row.
  onWorkbench: () => void;
}

function NavBtn(props: { icon: string; on?: boolean; enabled?: boolean; onPress: () => void; title?: string }) {
  const enabled = props.enabled !== false;
  const B = props.on ? C.ChromeBtnOn : C.ChromeBtn;
  return (
    // NOTE: the style prop must be ABSENT when enabled — classifier mergeUserProps
    // spreads user props over the class's resolved set, so an explicit
    // `style={undefined}` would wipe ChromeBtn's styling (classifier.tsx:445).
    <B onPress={() => { if (enabled) props.onPress(); }} {...(enabled ? {} : { style: { opacity: 0.35 } })}>
      <Icon name={props.icon} size={14} color={accentFor(enabled ? (props.on ? 'text' : 'textSecondary') : 'textFaint')} />
    </B>
  );
}

// Flat OS-style window controls, flush right, full strip height (the classes'
// hover states carry the OS affordance: neutral for min/max, error for close).
function WindowControls() {
  return (
    <C.WinGroup>
      <C.WinBtn onPress={() => callHost<void>('__window_minimize', undefined as never)}>
        <Icon name="Minus" size={13} color={accentFor('textSecondary')} />
      </C.WinBtn>
      <C.WinBtn onPress={() => callHost<void>('__window_maximize', undefined as never)}>
        <Icon name="Square" size={11} color={accentFor('textSecondary')} />
      </C.WinBtn>
      <C.WinBtnClose onPress={() => callHost<void>('__window_close', undefined as never)}>
        <Icon name="X" size={13} color={accentFor('textSecondary')} />
      </C.WinBtnClose>
    </C.WinGroup>
  );
}

export function Chrome(props: ChromeProps) {
  const MapPill = props.menuOpen ? C.ChromePillOn : C.ChromePill;
  const SavePill = props.logOpen ? C.ChromePillOn : C.ChromePill;
  return (
    <C.ChromeBar>
      <C.ChromeBrand>
        <Icon name="Map" size={14} color={accentFor('textDim')} />
        <C.ChromeKicker>WORLD EDITOR</C.ChromeKicker>
      </C.ChromeBrand>

      <C.ChromeRule />

      {/* Current-map switcher → toggles the maps menu */}
      <MapPill onPress={props.onToggleMenu}>
        <Box style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: accentFor('success') }} />
        <C.ChromePillStrong>{props.mapName}</C.ChromePillStrong>
        <Icon name="ChevronDown" size={13} color={accentFor('textDim')} />
      </MapPill>

      {/* New map */}
      <C.ChromePill onPress={props.onNew}>
        <Icon name="Plus" size={13} color={accentFor('success')} />
        <C.ChromePillText>New map</C.ChromePillText>
      </C.ChromePill>

      {/* The dead middle — this IS the titlebar grab area (borderless host). */}
      <C.ChromeDragSpace windowDrag={true} />

      {/* Route navigation — this is the persistent shell for every hmsc-int
          route. The FULL current set; the collapse to 6 is step 10, not here. */}
      <C.ChromeGroup>
        <NavBtn icon="LayoutGrid" on={props.activeRoute === 'editor'} onPress={props.onEditor} title="editor" />
        <NavBtn icon="Play" on={props.activeRoute === 'test'} onPress={props.onTest} title="play (F1 test / F2 build)" />
        <NavBtn icon="FlaskConical" on={props.activeRoute === 'labs'} onPress={props.onLabs} title="labs" />
        <NavBtn icon="Sparkles" on={props.activeRoute === 'assist3d'} onPress={props.onAssist} title="assistant 3D" />
        <NavBtn icon="PenTool" on={props.activeRoute === 'compose'} onPress={props.onCompose} title="decal editor" />
        <NavBtn icon="Palette" on={props.activeRoute === 'textures'} onPress={props.onTextures} title="texture studio" />
        <NavBtn icon="Columns3" on={props.activeRoute === 'workbench'} onPress={props.onWorkbench} title="workbench (rebuild in progress)" />
        <NavBtn icon="Activity" on={props.activeRoute === 'log'} onPress={props.onPerf} title="churn log" />
        <NavBtn icon="Settings" on={props.activeRoute === 'settings'} onPress={props.onSettings} title="settings" />
      </C.ChromeGroup>

      <C.ChromeRule />

      {/* Undo / redo */}
      <C.ChromeGroup>
        <NavBtn icon="Undo2" enabled={props.canUndo} onPress={props.onUndo} />
        <NavBtn icon="Redo2" enabled={props.canRedo} onPress={props.onRedo} />
      </C.ChromeGroup>

      <C.ChromeRule />

      {/* Compile → write this authored map to the game's boot key */}
      <C.ChromePill onPress={props.onCompile}>
        <Icon name="Hammer" size={13} color={accentFor('success')} />
        <C.ChromePillText>Compile</C.ChromePillText>
      </C.ChromePill>

      {/* Save status — click to expand the save-log trace */}
      <SavePill onPress={props.onToggleLog}>
        <Icon name="Check" size={12} color={accentFor('success')} />
        <C.ChromePillFaint>{props.lastSavedAt ? 'saved' : 'autosaving'}</C.ChromePillFaint>
        <Icon name="ChevronDown" size={12} color={accentFor('textDim')} />
      </SavePill>

      <C.ChromeRule />

      <WindowControls />
    </C.ChromeBar>
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
      <Pressable onPress={props.onClose} style={{ position: 'absolute', left: 0, top: CHROME_H, right: 0, bottom: 0, backgroundColor: '#00000001' }} />
      <Box style={{ position: 'absolute', left: 150, top: CHROME_H + 2, width: 264, maxHeight: 380, backgroundColor: accentFor('surface'), borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 8, paddingTop: 6, paddingBottom: 6 }}>
        {/* Rename current */}
        <Box style={{ paddingLeft: 8, paddingRight: 8, paddingBottom: 6 }}>
          <Text fontSize={8} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>CURRENT MAP</Text>
          <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <TextInput
              text={draft}
              onChangeText={setDraft}
              style={{ flexGrow: 1, backgroundColor: accentFor('controlBg'), borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 4, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, color: accentFor('text'), fontSize: 11 }}
            />
            <Pressable onPress={commitRename} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: accentFor('controlBorder'), backgroundColor: accentFor('controlBg') }}>
              <Text fontSize={10} color={accentFor('textSecondary')} style={{ fontWeight: 700 }}>rename</Text>
            </Pressable>
          </Box>
        </Box>

        <Box style={{ height: 1, backgroundColor: accentFor('border'), marginTop: 2, marginBottom: 4 }} />

        {/* The maps */}
        <Text fontSize={8} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1, paddingLeft: 8, marginBottom: 4 }}>MAPS · {props.maps.length}</Text>
        <ScrollView showScrollbar style={{ maxHeight: 244 }} contentContainerStyle={{ paddingLeft: 4, paddingRight: 4, gap: 2 }}>
          {props.maps.map((m) => {
            const isCur = m === props.mapName;
            return (
              <Box key={m} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Pressable
                  onPress={() => { if (!isCur) props.onOpen(m); }}
                  style={{ flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6, borderRadius: 5, borderWidth: 1, borderColor: isCur ? accentFor('border') : accentFor('surface'), backgroundColor: isCur ? accentFor('bgElevated') : accentFor('surface') }}
                >
                  <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isCur ? accentFor('success') : accentFor('border') }} />
                  <Text fontSize={12} color={isCur ? accentFor('text') : accentFor('textSecondary')} style={{ fontWeight: isCur ? 700 : 500 }}>{m}</Text>
                  <Box style={{ flexGrow: 1 }} />
                  {isCur ? <Text fontSize={8} color={accentFor('textDim')} style={{ fontFamily: 'monospace' }}>current</Text> : <Text fontSize={8} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>open</Text>}
                </Pressable>
                {!isCur ? (
                  <Pressable onPress={() => props.onDelete(m)} style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: accentFor('controlBorder'), backgroundColor: accentFor('controlBg') }}>
                    <Icon name="Trash2" size={12} color={accentFor('error')} />
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
// the category (editLog's CAT_COLOR — data, not chrome's palette); the line text
// describes the specific edit.

export function EventLog(props: { events: EditEvent[]; now: number; onClose: () => void }) {
  const rows = props.events.slice().reverse(); // newest first
  return (
    <>
      <Pressable onPress={props.onClose} style={{ position: 'absolute', left: 0, top: CHROME_H, right: 0, bottom: 0, backgroundColor: '#00000001' }} />
      <Box style={{ position: 'absolute', right: 10, top: CHROME_H + 2, width: 288, maxHeight: 380, backgroundColor: accentFor('surface'), borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 8, paddingTop: 6, paddingBottom: 6 }}>
        <Text fontSize={8} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1, paddingLeft: 10, marginBottom: 4 }}>EVENT LOG · {props.events.length}</Text>
        {rows.length === 0 ? (
          <Text fontSize={10} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', paddingLeft: 10, paddingTop: 4, paddingBottom: 6 }}>no edits yet</Text>
        ) : (
          <ScrollView showScrollbar style={{ maxHeight: 340 }} contentContainerStyle={{ paddingLeft: 6, paddingRight: 6, gap: 1 }}>
            {rows.map((e, i) => {
              const color = CAT_COLOR[e.cat];
              return (
                <Box key={`${e.t}_${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 6, paddingRight: 6, paddingTop: 5, paddingBottom: 5, borderRadius: 4 }}>
                  <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
                  <Text fontSize={8} color={color} style={{ fontFamily: 'monospace', fontWeight: 700, width: 34 }}>{CAT_TAG[e.cat]}</Text>
                  <Text fontSize={11} color={accentFor('textSecondary')} style={{ flexGrow: 1 }}>{e.text}</Text>
                  <Text fontSize={9} color={accentFor('textDim')} style={{ fontFamily: 'monospace' }}>{relTime(e.t, props.now)}</Text>
                </Box>
              );
            })}
          </ScrollView>
        )}
      </Box>
    </>
  );
}
