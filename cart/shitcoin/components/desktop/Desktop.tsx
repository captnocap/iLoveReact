// Desktop — icon grid + window manager + Start menu + CRT wrapper.
//
// Drag implementation: the title bar declares onMouseDown + onMouseMove
// + onMouseUp, which causes the framework to auto-capture pointer
// events on that node until release (see nodeWantsPointerCapture in
// framework/engine.zig). With capture, move/up events fire on the
// title bar regardless of where the cursor wanders — no separate
// overlay needed. The drag offset (cursor-to-window-origin) lives in a
// ref so the move handler can read it without a re-render storm.
//
// Maximize: stores the pre-maximize rect in a side-map keyed by uid
// so toggling back restores exact position. Maximized windows ignore
// drag and render via Window's `maximized` branch (right/bottom inset
// rather than width/height).
//
// CRT filter: wraps the entire Desktop in <Filter shader="crt">. The
// `crtOn` state toggles it; the Start menu has a "CRT filter" entry
// and Ctrl+Shift+C is a dev-time hotkey to flip it without opening
// the menu.

import { useState, useCallback, useEffect, useRef } from 'react';
import { Text, Pressable, Filter } from '@reactjit/runtime/primitives';
import { classifiers as C } from '../../../../runtime/classifier';
import { SkinProvider } from '../shared/SkinProvider';
import type { SkinKey } from '../shared/skins';
import { Window } from './Window';
import { APPS, findApp, useDesktopApps, type DesktopApp } from './icons';
import { ShaderPixelIcon } from '../../../pixel_icons/ShaderPixelIcon';
import { Box } from '@reactjit/runtime/primitives';
import { useHardwareTier, sim } from '../../sim';
import { AchievementsListener } from './apps/AchievementsListener';
import './Desktop.cls';

/** Render a desktop app's icon — pixel matrix preferred, glyph fallback.
 *  `size` is the desired pixel size on screen; we compute the per-cell
 *  pixelSize so the matrix fills the requested box. */
function AppIcon({ app, size }: { app: DesktopApp; size: number }) {
  if (app.iconMatrix) {
    const m = app.iconMatrix;
    const pixelSize = Math.max(1, Math.floor(size / m.size));
    return <ShaderPixelIcon data={m} pixelSize={pixelSize} />;
  }
  // Glyph fallback (emoji string)
  return (
    <Box style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <C.DesktopIconGlyphText>{app.glyph ?? '?'}</C.DesktopIconGlyphText>
    </Box>
  );
}

export interface DesktopProps {
  /** Initial OS skin: 'xp' | 'win7' | 'macos' | 'linux'. */
  skin?: SkinKey;
  /** Default CRT state. ON by default; pass false during development. */
  crtDefault?: boolean;
}

type OpenWindow = {
  uid: number;
  appId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  maximized: boolean;
  /** Pre-maximize rect, restored when un-maximizing. */
  prevRect?: { x: number; y: number; w: number; h: number };
};

/** Live drag offset. Kept in a ref so the title bar's move handler
 *  reads it cheaply per pointer event without forcing a re-render. */
type DragSession = {
  uid: number;
  offsetX: number;
  offsetY: number;
};

let _winUid = 1;

function spawnFor(app: DesktopApp, offset: number): OpenWindow {
  return {
    uid: _winUid++,
    appId: app.id,
    x: app.defaultX + offset * 28,
    y: app.defaultY + offset * 28,
    w: app.defaultW,
    h: app.defaultH,
    minimized: false,
    maximized: false,
  };
}

export function Desktop({ skin = 'win7' }: DesktopProps) {
  // BASE + gated apps (gated = require a purchased upgrade). This is
  // what shows in the icon grid + taskbar. Start menu uses the static
  // APPS list so the player can see locked-but-discoverable apps.
  const apps = useDesktopApps();
  const [windows, setWindows] = useState<OpenWindow[]>(() => {
    const browser = apps[0] ?? APPS[0];
    return [spawnFor(browser, 0)];
  });
  const dragRef = useRef<DragSession | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  // Monitor tier drives the post-process Filter. tier 0 = full CRT,
  // tier 1 = softer CRT, tier 2+ = no filter at all. Player buys
  // hardware upgrades to escape the CRT — that's the first carrot.
  const monitorTier = useHardwareTier('monitor');
  const crtOn = monitorTier === 0;

  const focus = useCallback((uid: number) => {
    setWindows((prev) => {
      const idx = prev.findIndex((w) => w.uid === uid);
      if (idx < 0 || idx === prev.length - 1) return prev;
      const out = prev.slice();
      const [w] = out.splice(idx, 1);
      out.push({ ...w, minimized: false });
      return out;
    });
  }, []);

  const openApp = useCallback((appId: string) => {
    const app = findApp(appId);
    if (!app) return;
    setWindows((prev) => {
      const existing = prev.find((w) => w.appId === appId);
      if (existing) {
        const out = prev.filter((w) => w.uid !== existing.uid);
        out.push({ ...existing, minimized: false });
        return out;
      }
      return [...prev, spawnFor(app, prev.length)];
    });
    setStartOpen(false);
  }, []);

  const closeWin = useCallback((uid: number) => {
    setWindows((prev) => prev.filter((w) => w.uid !== uid));
  }, []);

  const minimizeWin = useCallback((uid: number) => {
    setWindows((prev) => prev.map((w) => w.uid === uid ? { ...w, minimized: true } : w));
  }, []);

  const toggleMaximize = useCallback((uid: number) => {
    setWindows((prev) => prev.map((w) => {
      if (w.uid !== uid) return w;
      if (w.maximized) {
        // Restore from snapshot.
        const r = w.prevRect ?? { x: w.x, y: w.y, w: w.w, h: w.h };
        return { ...w, maximized: false, x: r.x, y: r.y, w: r.w, h: r.h };
      }
      // Snapshot current rect, set maximized — the visual fill happens
      // in Window.tsx via the maximized branch.
      return { ...w, maximized: true, prevRect: { x: w.x, y: w.y, w: w.w, h: w.h } };
    }));
  }, []);

  // Title-bar drag uses framework pointer capture. The down handler
  // records the cursor→window-origin offset in a ref; the move handler
  // (which the engine now routes to the title bar regardless of cursor
  // position) reads that ref and writes a new (x, y) into windows
  // state. Up clears the ref.
  const onTitleDown = useCallback((uid: number, winX: number, winY: number, payload: { x: number; y: number }) => {
    dragRef.current = { uid, offsetX: payload.x - winX, offsetY: payload.y - winY };
  }, []);

  const onTitleMove = useCallback((uid: number, payload: { x: number; y: number }) => {
    const d = dragRef.current;
    if (!d || d.uid !== uid) return;
    const nx = payload.x - d.offsetX;
    const ny = payload.y - d.offsetY;
    setWindows((prev) => prev.map((w) => (w.uid === uid ? { ...w, x: nx, y: ny } : w)));
  }, []);

  const onTitleUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Dev hotkey: Ctrl+Shift+C toggles CRT. Bound at the document level
  // via the host's keyboard event channel if available; falls back to
  // a no-op gracefully when the runtime doesn't surface kbd handlers.
  useEffect(() => {
    const host = (globalThis as any);
    if (typeof host.addEventListener !== 'function') return;
    const handler = (e: any) => {
      // Dev: Ctrl+Shift+C toggles between tier-0 CRT and tier-2 LCD.
      // The "real" upgrade path is buying a monitor in-game.
      if (e?.ctrlKey && e?.shiftKey && (e.key === 'C' || e.key === 'c')) {
        const next = monitorTier === 0 ? 2 : 0;
        sim.setHardwareTier('monitor', next);
      }
    };
    host.addEventListener('keydown', handler);
    return () => host.removeEventListener('keydown', handler);
  }, [monitorTier]);

  const desktopBody = (
    <SkinProvider skin={skin}>
      <C.DesktopRoot
        // Close the Start menu when clicking empty desktop.
        onPress={() => setStartOpen(false)}
      >
        {/* Icon grid — base apps + any unlocked via upgrades */}
        <C.DesktopIconGrid>
          {apps.map((app) => (
            <C.DesktopIcon key={app.id} onPress={() => openApp(app.id)}>
              <C.DesktopIconGlyph>
                <AppIcon app={app} size={36} />
              </C.DesktopIconGlyph>
              <C.DesktopIconLabel>{app.label}</C.DesktopIconLabel>
            </C.DesktopIcon>
          ))}
        </C.DesktopIconGrid>

        {/* Windows */}
        {windows.map((w, i) => {
          if (w.minimized) return null;
          const app = findApp(w.appId);
          if (!app) return null;
          const AppView = app.render;
          const focused = i === windows.length - 1;
          return (
            <Window
              key={w.uid}
              title={app.label}
              x={w.x}
              y={w.y}
              w={w.w}
              h={w.h}
              z={10 + i}
              focused={focused}
              maximized={w.maximized}
              onClose={() => closeWin(w.uid)}
              onMin={() => minimizeWin(w.uid)}
              onMax={() => toggleMaximize(w.uid)}
              onFocus={() => focus(w.uid)}
              onTitleMouseDown={(payload) => onTitleDown(w.uid, w.x, w.y, payload)}
              onTitleMouseMove={(payload) => onTitleMove(w.uid, payload)}
              onTitleMouseUp={onTitleUp}
            >
              <AppView />
            </Window>
          );
        })}

        {/* Start menu popup */}
        {startOpen ? (
          <StartMenu
            onLaunch={openApp}
            crtOn={crtOn}
            onToggleCrt={() => {
              const next = monitorTier === 0 ? 2 : 0;
              sim.setHardwareTier('monitor', next);
            }}
            onDismiss={() => setStartOpen(false)}
          />
        ) : null}

        {/* Taskbar */}
        <C.DesktopTaskbar>
          <C.DesktopStartBtn onPress={() => setStartOpen((v) => !v)}>
            <C.DesktopStartBtnText>Start</C.DesktopStartBtnText>
          </C.DesktopStartBtn>
          {windows.map((w, i) => {
            const app = findApp(w.appId);
            if (!app) return null;
            const focused = i === windows.length - 1 && !w.minimized;
            const Slot = focused ? C.DesktopTaskbarSlotActive : C.DesktopTaskbarSlot;
            const SlotText = focused ? C.DesktopTaskbarSlotTextActive : C.DesktopTaskbarSlotText;
            return (
              <Slot key={w.uid} onPress={() => focus(w.uid)}>
                <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <AppIcon app={app} size={14} />
                  <SlotText>{app.label}</SlotText>
                </Box>
              </Slot>
            );
          })}
        </C.DesktopTaskbar>
        {/* Invisible: mounts every achievement's useIFTTT binding so
            unlocks fire as the bus emits sim events. */}
        <AchievementsListener />
      </C.DesktopRoot>
    </SkinProvider>
  );

  // Monitor-tier-driven Filter wrapper. tier 0 = full CRT (start),
  // tier 1 = soft CRT (plasma look), tier 2+ = no filter (LCD/OLED).
  // Filter NEEDS explicit size or the offscreen capture is 0×0 and the
  // cart hard-crashes before logs flush — see memory feedback_filter_needs_size.
  const filterIntensity = monitorTier === 0 ? 1.0 : monitorTier === 1 ? 0.45 : null;
  return filterIntensity != null ? (
    <Filter shader="crt" intensity={filterIntensity} style={{ width: '100%', height: '100%' }}>
      {desktopBody}
    </Filter>
  ) : desktopBody;
}

// ── Start menu ──────────────────────────────────────────────────────────
// Anchored to the bottom-left taskbar. First section = app launchers.
// Second section = game/system menu (New Run, CRT toggle, About, Quit).

interface StartMenuProps {
  onLaunch: (appId: string) => void;
  crtOn: boolean;
  onToggleCrt: () => void;
  onDismiss: () => void;
}

function StartMenu({ onLaunch, crtOn, onToggleCrt, onDismiss }: StartMenuProps) {
  return (
    <Box
      style={{
        position: 'absolute',
        left: 8,
        bottom: 44,
        width: 280,
        flexDirection: 'column',
        gap: 6,
        padding: 10,
        borderRadius: 'theme:radiusMd' as any,
        backgroundColor: 'theme:surface' as any,
        borderWidth: 1,
        borderColor: 'theme:border' as any,
        zIndex: 100,
      }}
    >
      <Text style={{ fontSize: 11, color: 'theme:textDim' as any, fontWeight: 'bold', textTransform: 'uppercase' }}>
        Apps
      </Text>
      {APPS.map((app) => (
        <StartMenuItem
          key={app.id}
          glyph={<AppIcon app={app} size={20} />}
          label={app.label}
          onPress={() => onLaunch(app.id)}
        />
      ))}

      <Box style={{ height: 1, backgroundColor: 'theme:border' as any, marginTop: 4, marginBottom: 4 }} />

      <Text style={{ fontSize: 11, color: 'theme:textDim' as any, fontWeight: 'bold', textTransform: 'uppercase' }}>
        Game
      </Text>
      <StartMenuItem glyph="🆕" label="New Run" onPress={() => { /* TODO: hook to sim.reset() once we re-wire it */ onDismiss(); }} />
      <StartMenuItem glyph="💾" label="Save & Continue" onPress={onDismiss} />
      <StartMenuItem glyph="🏆" label="Leaderboard" onPress={onDismiss} />
      <StartMenuItem glyph="⚙" label="Settings" onPress={onDismiss} />
      <StartMenuItem
        glyph={crtOn ? '🖥️' : '⬛'}
        label={`CRT filter: ${crtOn ? 'ON' : 'OFF'}  (Ctrl+Shift+C)`}
        onPress={onToggleCrt}
      />
      <StartMenuItem glyph="ℹ" label="About" onPress={onDismiss} />
      <StartMenuItem glyph="⏻" label="Quit" onPress={onDismiss} />
    </Box>
  );
}

interface StartMenuItemProps {
  /** Either an emoji string OR a pre-rendered JSX icon (e.g. <AppIcon>). */
  glyph: any;
  label: string;
  onPress: () => void;
}

function StartMenuItem({ glyph, label, onPress }: StartMenuItemProps) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 6,
        paddingBottom: 6,
        borderRadius: 4,
      }}
      hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
    >
      <Box style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
        {typeof glyph === 'string'
          ? <Text style={{ fontSize: 16, color: 'theme:text' as any }}>{glyph}</Text>
          : glyph}
      </Box>
      <Text style={{ fontSize: 13, color: 'theme:text' as any }}>{label}</Text>
    </Pressable>
  );
}
