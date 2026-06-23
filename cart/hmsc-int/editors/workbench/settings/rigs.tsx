// editors/workbench/settings/rigs.tsx — column 4 for the SETTINGS source
// (WBSET9-0606). LAW 1: rigs DEMONSTRATE, they never edit — both rigs only
// READ the live tables/registry the panel writes through.
//
// Two rigs:
//
//   CameraFeelRig — the camera-feel cluster ('sculpt-camera') ACTS: a
//   synthetic circular drag (a phantom mouse at SWEEP px/s) replays
//   sculptCamera.orbitMove's exact hand math against the LIVE tunables
//   (yaw −= dx·yawPerPx, pitch clamped −= dy·pitchPerPx) through the proven
//   V23 native-orbit wire (ObjectInspect3D's engage + setInputDeltas — the
//   host integrates; the interval never re-renders React). Turn the °/px
//   knobs in gutter 3 and the sweep speeds up/slows down THAT instant.
//
//   DashboardRig — every other system demonstrates as a LIVE dashboard
//   (LAW 3's "idle width gets spent on demonstrative dashboards"): stat
//   cards (knobs / overridden / commits), a full-bleed bar per knob (value
//   fill + default tick), and the system's recent V20 tuning commits — a
//   knob turn lands a feed row while you watch.

import { useEffect, useRef, useState } from 'react';
import { Box, Scene3D, ScrollView, Text } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { GAME_CAMERA } from '../../../game/camera';
import { GAME_NATIVE_CAMERA } from '../../../game/nativeCamera';
import { PAINT_EDITOR_TUNING } from '../../characters/paintKit';
import { C, accentFor } from '../../../shell/workbench.cls';
import { toneFor } from '../tone';
import { knobBars, systemRoutes, tuningFeed } from './panel';
import type { SettingsStore } from './store';
import { ColorWheel } from '../../paint/ColorWheel';

const TUNE = PAINT_EDITOR_TUNING;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** the camera-feel cluster's system id — the rig switch key */
export const CAMERA_FEEL_SYSTEM = 'sculpt-camera';
export const GRASS_SYSTEM = 'grass';

export function SettingsRig(props: { store: SettingsStore; system: string }) {
  if (props.system === CAMERA_FEEL_SYSTEM) return <CameraFeelRig store={props.store} system={props.system} />;
  if (props.system === GRASS_SYSTEM) return <GrassRig store={props.store} system={props.system} />;
  return <DashboardRig store={props.store} system={props.system} />;
}

// ── the grass rig — the ColorWheel picker over the grass root-colour leaves ────
// The panel (col 3) edits height/density as the usual sliders; this demo pane adds
// the colour PICKER the user asked for. Each wheel reads/writes the rootLo/rootHi
// r/g/b tunables (so it persists + the editor field re-bakes live, same as any
// knob). 6 plain RGB sliders still exist in the panel — this is just the nice editor.
function rgb01ToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const s = hex.replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  const n = parseInt(full, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function GrassColorWheel(props: { store: SettingsStore; label: string; prefix: 'rootLo' | 'rootHi' }) {
  const { store, prefix } = props;
  const byId = new Map(store.entries(GRASS_SYSTEM).map((e) => [e.id, e] as const));
  const hex = rgb01ToHex(store.read(`grass.${prefix}.r`), store.read(`grass.${prefix}.g`), store.read(`grass.${prefix}.b`));
  const onChange = (h: string) => {
    const { r, g, b } = hexToRgb01(h);
    const set = (leaf: string, v: number) => { const e = byId.get(`grass.${prefix}.${leaf}`); if (e) store.set(e, v); };
    set('r', r);
    set('g', g);
    set('b', b);
  };
  return (
    <Box style={{ flexDirection: 'column', gap: 5, alignItems: 'center' }}>
      <Text fontSize={10} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>{props.label}</Text>
      <ColorWheel value={hex} onChange={onChange} size={132} />
    </Box>
  );
}

function GrassRig(props: { store: SettingsStore; system: string }) {
  return (
    <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
      <Box style={{ flexDirection: 'column', gap: 12, paddingLeft: 14, paddingRight: 14, paddingTop: 12, paddingBottom: 14 }}>
        <Text fontSize={11} color={accentFor('text')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>grass root colour</Text>
        <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>
          the base tint the blades gradient up from — varied per blade between low ↔ high so the field reads alive. the bright tip derives from it in-shader. painted grass re-bakes live as you turn the wheel.
        </Text>
        <Box style={{ flexDirection: 'row', gap: 18, flexWrap: 'wrap', paddingTop: 4 }}>
          <GrassColorWheel store={props.store} label="root low" prefix="rootLo" />
          <GrassColorWheel store={props.store} label="root high" prefix="rootHi" />
        </Box>
        <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', paddingTop: 6 }}>
          blade height (min/max) and per-level density (sparse / grass / lush, blades per cell) are the sliders in the panel ←
        </Text>
      </Box>
    </ScrollView>
  );
}

// ── the camera-feel rig ───────────────────────────────────────────────────────

const SWEEP_PX_PER_S = 140; // the phantom hand's speed — a brisk, steady drag
const TICK_MS = 80;

function CameraFeelRig(props: { store: SettingsStore; system: string }) {
  const lookRef = useRef({ yaw: 35, pitch: 24 });
  const phaseRef = useRef(0);
  const cameraRef = useRef<any>(null);
  const ctlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const dist = (TUNE.knobs.zoom.min + TUNE.knobs.zoom.max) / 2;

  const [bootCam] = useState(() =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: [0, 0.8, 0], yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, dist, fov: 45,
    }));

  // engage the native orbit once (the ObjectInspect3D wire), then drive it
  // at param rate from the phantom drag — zero React re-renders per tick.
  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) {
      console.warn('[workbench/settings] camera-feel rig: native camera not engaged (node id unavailable)');
      return;
    }
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    ctlRef.current = ctl;
    ctl.setOrbit({ target: [0, 0.8, 0], yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, distance: dist, fov: 45 });
    ctl.setMode('orbit');
    const id = setInterval(() => {
      // the phantom mouse: a circle at SWEEP px/s → per-tick px deltas
      const dt = TICK_MS / 1000;
      phaseRef.current += dt * 0.9;
      const dx = SWEEP_PX_PER_S * Math.cos(phaseRef.current) * dt;
      const dy = (SWEEP_PX_PER_S / 2) * Math.sin(phaseRef.current) * dt;
      // sculptCamera.orbitMove's exact math against the LIVE table
      const l = lookRef.current;
      const nextYaw = l.yaw - dx * TUNE.orbit.yawPerPx;
      const nextPitch = clamp(l.pitch - dy * TUNE.orbit.pitchPerPx, TUNE.orbit.pitchMin, TUNE.orbit.pitchMax);
      ctlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
      l.yaw = nextYaw;
      l.pitch = nextPitch;
    }, TICK_MS);
    return () => {
      clearInterval(id);
      ctlRef.current = null;
      ctl.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engage once; the interval reads the live table
  }, []);

  const o = TUNE.orbit;
  const z = TUNE.knobs.zoom;
  const iz = TUNE.itemCamera.zoom;
  return (
    <Box style={{ flexGrow: 1, minHeight: 0, flexDirection: 'column' }}>
      <Scene3D style={{ width: '100%', flexGrow: 1 }} backgroundColor="#0e1622" showGrid showAxes={false}>
        <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} />
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1.4, height: 1.4, depth: 1.4 }} position={[0, 0.7, 0]} material="#7dd3fc" />
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.5, height: 2.2, depth: 0.5 }} position={[2.2, 1.1, -1.4]} material="#475569" />
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.9, height: 0.5, depth: 0.9 }} position={[-2, 0.25, 1.6]} material="#a78bfa" />
      </Scene3D>
      {/* the numbers ACTING — reads the live table, re-renders on every edit */}
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 8 }}>
        <Text fontSize={9} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace' }}>
          {`phantom drag ${SWEEP_PX_PER_S} px/s → yaw ${(SWEEP_PX_PER_S * o.yawPerPx).toFixed(0)}°/s · pitch ${(SWEEP_PX_PER_S * o.pitchPerPx / 2).toFixed(0)}°/s (clamp ${o.pitchMin}…${o.pitchMax}°)`}
        </Text>
        <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>
          {`character zoom ${z.min}–${z.max} · item zoom ${iz.min}–${iz.max} (wheel ${iz.step}/notch, near ${TUNE.itemCamera.near}) · frame ×${TUNE.frame.margin} · fly ${TUNE.fly.speed} u/s @ ${TUNE.fly.lookPerPx}°/px`}
        </Text>
      </Box>
    </Box>
  );
}

// ── the dashboard rig ─────────────────────────────────────────────────────────

function DashboardRig(props: { store: SettingsStore; system: string }) {
  const { store, system } = props;
  const bars = knobBars(store, system);
  const feed = tuningFeed(store, system);
  const overridden = store.overriddenCount(system);
  const route = systemRoutes(store.entries(system));
  const accent = toneFor(system);

  return (
    <C.LogPane>
      <C.StatBand>
        <C.StatCard>
          <C.StatHead>
            <C.LogChip style={{ backgroundColor: accent }}><C.LogChipText>{system}</C.LogChipText></C.LogChip>
            <C.StatSub>{route}</C.StatSub>
          </C.StatHead>
          <C.StatBig>{`${bars.length}`}</C.StatBig>
          <C.StatSub>knobs registered</C.StatSub>
        </C.StatCard>
        <C.StatCard>
          <C.StatHead><C.StatSub>OVERRIDDEN</C.StatSub></C.StatHead>
          <C.StatBig>{`${overridden}`}</C.StatBig>
          <C.StatSub>{overridden === 0 ? 'all at code defaults' : 'persisted via the tuning stream'}</C.StatSub>
        </C.StatCard>
        <C.StatCard>
          <C.StatHead><C.StatSub>TUNING COMMITS</C.StatSub></C.StatHead>
          <C.StatBig>{`${feed.length}`}</C.StatBig>
          <C.StatSub>{store.error() ? `store unavailable: ${store.error()}` : 'this system, session bus'}</C.StatSub>
        </C.StatCard>
      </C.StatBand>

      <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
        <Box style={{ flexDirection: 'column', gap: 7, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 12 }}>
          {bars.map((b) => (
            <Box key={b.label} style={{ flexDirection: 'column', gap: 2 }}>
              <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text fontSize={10} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace', width: 170 }}>{b.label}</Text>
                <Text fontSize={10} color={b.overridden ? accentFor('warning') : accentFor('text')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>{b.shown}</Text>
                {b.overridden ? (
                  <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>{`default ${b.defaultShown}`}</Text>
                ) : null}
              </Box>
              {/* value fill + default tick over the full range */}
              <Box style={{ width: '100%', height: 8, borderRadius: 3, backgroundColor: accentFor('bg'), position: 'relative', overflow: 'hidden' }}>
                <Box style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(b.frac * 100)}%`, backgroundColor: b.overridden ? accentFor('warning') : accent, opacity: 0.75 }} />
                <Box style={{ position: 'absolute', top: 0, bottom: 0, width: 2, left: `${Math.round(b.defaultFrac * 100)}%`, backgroundColor: accentFor('text'), opacity: 0.6 }} />
              </Box>
            </Box>
          ))}

          {feed.length ? (
            <Box style={{ flexDirection: 'column', gap: 1, paddingTop: 8 }}>
              <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', letterSpacing: 1, paddingBottom: 3 }}>RECENT TUNING · newest first</Text>
              {feed.map((row) => (
                <C.LogRow key={`${row.seq}`}>
                  <C.LogStripe style={{ backgroundColor: accent }} />
                  <C.LogTime>{`#${row.seq}`}</C.LogTime>
                  <C.LogText>{row.label}</C.LogText>
                </C.LogRow>
              ))}
            </Box>
          ) : null}
        </Box>
      </ScrollView>
    </C.LogPane>
  );
}
