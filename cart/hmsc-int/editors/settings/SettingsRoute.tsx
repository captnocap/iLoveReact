// editors/settings/ — the GRAND SETTINGS route (SETTINGS-0605, ruled).
//
// THE USER'S WORDS: "it would be nice to have a grand settings page that
// shows an event bus for all of these [the routes' session/autosave
// systems], and we need to get all those magic numbers into some route for
// interfacing with."
//
// Two surfaces, both READ layers over machinery that already exists:
//
//   SESSION EVENT BUS — a live unified view of every route's session
//   channel. The 'sessions' stream (editors/sessions.ts, V20) already
//   records every route's lifecycle + every labeled commit/note on the one
//   global sequence; this page folds it (editors/settings/bus.ts) and polls
//   undoPoint() for liveness. Read-only — no second event system.
//
//   TUNABLES — THE P2 interface (editors/tunables.ts): every registered
//   magic number grouped by system, live-editable, reset-to-default. The
//   page only reads the registry; registration happens where each number
//   lives. Edits are this route's own session commits on the V20 'tuning'
//   channel — so turning a knob here shows up in the bus beside everyone
//   else's interactions, and persists across boots (index.tsx folds the
//   tuning snapshot at shell mount).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Pressable, Row, ScrollView, Text } from '@reactjit/primitives';
import { GAME_CHROME } from '@game';
import { editorChannel } from '../store';
import { editorSessions, type RouteSession, type SessionsState } from '../sessions';
import { editorTunables, tuningStream, type TunableEntry, type TuningEvent } from '../tunables';
import { useRouteTwigState } from '../twigs';
import { busChannels, busRows, filterBusRows } from './bus';

const T = GAME_CHROME.tokens.color;
const { Chip, Knob } = GAME_CHROME;

// The page's own chrome numbers, registered like everything else's (P2 —
// the settings page eats its own dog food; see the migration commits).
const SETTINGS_VIEW = {
  pollMs: 500,
  busRowCap: 200,
  busColumnWidth: 470,
};
editorTunables().register({
  system: 'settings-view', route: '/settings', table: SETTINGS_VIEW,
  specs: {
    pollMs: { label: 'bus poll ms', min: 100, max: 5000, step: 100, precision: 0 },
    busRowCap: { label: 'bus row cap', min: 20, max: 1000, step: 20, precision: 0 },
    busColumnWidth: { label: 'bus col px', min: 320, max: 760, step: 10, precision: 0 },
  },
});

/** channel name → a stable chrome tone (display only) */
const CHANNEL_TONES = [T.accent, T.cyan, T.good, T.warn, T.gold, T.bad] as const;
function toneFor(channel: string): string {
  let hash = 0;
  for (let i = 0; i < channel.length; i += 1) hash = (hash * 31 + channel.charCodeAt(i)) >>> 0;
  return CHANNEL_TONES[hash % CHANNEL_TONES.length];
}

type Wiring = {
  session: RouteSession<TuningEvent> | null;
  error: string | null;
};

export function SettingsRoute(props: { onExit: () => void }) {
  // ── this route's own session on the V20 'tuning' channel ──────────────────
  const wiring: Wiring = useMemo(() => {
    try {
      return { session: editorSessions().open('/settings', editorChannel(tuningStream)), error: null };
    } catch (error: any) {
      return { session: null, error: String(error?.message ?? error) };
    }
  }, []);
  useEffect(() => () => wiring.session?.close(), [wiring]);

  // ── liveness: poll the two read doors, re-render only when either moved ───
  const [sync, setSync] = useState(0);
  const lastRef = useRef({ undo: -1, rev: -1 });
  useEffect(() => {
    const tick = () => {
      let undo = lastRef.current.undo;
      try { undo = editorSessions().undoPoint(); } catch { /* no store host */ }
      const rev = editorTunables().revision();
      if (undo !== lastRef.current.undo || rev !== lastRef.current.rev) {
        lastRef.current = { undo, rev };
        setSync((s) => s + 1);
      }
    };
    tick();
    const id = setInterval(tick, SETTINGS_VIEW.pollMs);
    return () => clearInterval(id);
  }, []);

  // ── the bus fold ───────────────────────────────────────────────────────────
  const sessionsState: SessionsState = useMemo(() => {
    try { return editorSessions().state(); } catch { return { sessions: {}, order: [] }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync IS the dependency (poll signal)
  }, [sync]);
  const rows = useMemo(() => busRows(sessionsState), [sessionsState]);
  const channels = useMemo(() => busChannels(sessionsState), [sessionsState]);
  const [channelFilter, setChannelFilter] = useRouteTwigState<string | null>('/settings', 'channelFilter', null);
  const visible = filterBusRows(rows, channelFilter).slice(0, SETTINGS_VIEW.busRowCap);

  // ── the tunables fold ──────────────────────────────────────────────────────
  const groups = useMemo(() => {
    const bySystem = new Map<string, TunableEntry[]>();
    for (const entry of editorTunables().list()) {
      const list = bySystem.get(entry.system);
      if (list) list.push(entry);
      else bySystem.set(entry.system, [entry]);
    }
    return [...bySystem.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync IS the dependency (poll signal)
  }, [sync]);

  const bump = () => {
    lastRef.current = { undo: -1, rev: -1 }; // force the next poll through
    setSync((s) => s + 1);
  };
  const setKnob = (entry: TunableEntry, value: number) => {
    const applied = editorTunables().write(entry.id, value);
    wiring.session?.commit(
      { kind: 'set', id: entry.id, value: applied },
      `${entry.id} → ${GAME_CHROME.formatKnobValue(applied, entry)}`,
    );
    bump();
  };
  const resetKnob = (entry: TunableEntry) => {
    const value = editorTunables().reset(entry.id);
    wiring.session?.commit(
      { kind: 'reset', id: entry.id },
      `${entry.id} → default (${GAME_CHROME.formatKnobValue(value, entry)})`,
    );
    bump();
  };

  return (
    // Route surfaces COVER the always-mounted editor (the VehiclesRoute rule):
    // absolute full-area + opaque bg.
    <Col style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', backgroundColor: T.page }}>
      <Row style={{ alignItems: 'center', justifyContent: 'space-between', paddingLeft: 14, paddingRight: 14, paddingTop: 12, paddingBottom: 8 }}>
        <Text fontSize={16} color={T.ink} style={{ fontWeight: 900 }}>SETTINGS</Text>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          {wiring.error ? <Text fontSize={11} color={T.bad}>{`store unavailable: ${wiring.error}`}</Text> : null}
          <Chip label="← editor" onPress={props.onExit} />
        </Row>
      </Row>

      <Row style={{ flexGrow: 1, width: '100%' }}>
        {/* ── SESSION EVENT BUS ──────────────────────────────────────────── */}
        <Col style={{ width: SETTINGS_VIEW.busColumnWidth, height: '100%', paddingLeft: 14, paddingRight: 10, gap: 8 }}>
          <Text fontSize={12} color={T.dim} style={{ fontWeight: 800, letterSpacing: 1 }}>
            {`SESSION EVENT BUS · ${channels.length} channels · ${rows.length} commits`}
          </Text>
          <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip label={`all · ${rows.length}`} active={channelFilter === null} onPress={() => setChannelFilter(null)} />
            {channels.map((c) => (
              <Chip
                key={c.channel}
                label={`${c.channel} · ${c.commits}${c.open > 0 ? ' ●' : ''}`}
                active={channelFilter === c.channel}
                color={toneFor(c.channel)}
                onPress={() => setChannelFilter(channelFilter === c.channel ? null : c.channel)}
              />
            ))}
          </Row>
          <ScrollView showScrollbar style={{ width: '100%', flexGrow: 1 }} contentContainerStyle={{ gap: 2, paddingBottom: 14 }}>
            {visible.length === 0 ? (
              <Text fontSize={11} color={T.dim}>no session activity yet — edit on any route and it lands here</Text>
            ) : visible.map((row) => (
              <Row key={`${row.seq}`} style={{ alignItems: 'center', gap: 8, paddingTop: 3, paddingBottom: 3 }}>
                <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace', width: 44, textAlign: 'right' }}>{`#${row.seq}`}</Text>
                <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: toneFor(row.channel) }} />
                <Text fontSize={9} color={toneFor(row.channel)} style={{ fontFamily: 'monospace', fontWeight: 700, width: 64 }}>{row.channel}</Text>
                <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace', width: 64 }}>{row.route}</Text>
                <Text fontSize={11} color={T.ink} style={{ flexGrow: 1 }}>{row.label}</Text>
                {row.at === null ? <Text fontSize={8} color={T.dim} style={{ fontFamily: 'monospace' }}>note</Text> : null}
              </Row>
            ))}
          </ScrollView>
        </Col>

        <Box style={{ width: 1, height: '100%', backgroundColor: T.frame }} />

        {/* ── TUNABLES — the P2 interface ────────────────────────────────── */}
        <Col style={{ flexGrow: 1, height: '100%', paddingLeft: 12, paddingRight: 14, gap: 8 }}>
          <Text fontSize={12} color={T.dim} style={{ fontWeight: 800, letterSpacing: 1 }}>
            {`TUNABLES · ${groups.length} systems · ${groups.reduce((n, [, list]) => n + list.length, 0)} knobs`}
          </Text>
          <ScrollView showScrollbar style={{ width: '100%', flexGrow: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 14 }}>
            {groups.length === 0 ? (
              <Text fontSize={11} color={T.dim}>no tunables registered — a tuning module registers its knobs where the numbers live</Text>
            ) : groups.map(([system, entries]) => (
              <Col key={system} style={{ gap: 5 }}>
                <Row style={{ alignItems: 'center', gap: 8 }}>
                  <Text fontSize={12} color={T.ink} style={{ fontWeight: 800 }}>{system}</Text>
                  <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>{entries[0].route}</Text>
                </Row>
                {entries.map((entry) => {
                  const atDefault = editorTunables().isDefault(entry.id);
                  return (
                    <Row key={entry.id} style={{ alignItems: 'center', gap: 8 }}>
                      <Knob label={entry.label} value={editorTunables().read(entry.id)} spec={entry} onChange={(v) => setKnob(entry, v)} />
                      {atDefault ? (
                        <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>default</Text>
                      ) : (
                        <Pressable onPress={() => resetKnob(entry)} style={{ paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 5, borderWidth: 1, borderColor: T.frame, backgroundColor: T.control }}>
                          <Text fontSize={9} color={T.warn} style={{ fontFamily: 'monospace' }}>{`↺ ${GAME_CHROME.formatKnobValue(entry.defaultValue, entry)}`}</Text>
                        </Pressable>
                      )}
                    </Row>
                  );
                })}
              </Col>
            ))}
          </ScrollView>
        </Col>
      </Row>
    </Col>
  );
}
