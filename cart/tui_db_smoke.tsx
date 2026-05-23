// tui_db_smoke — proves a TUI cart connects to the same pg buckets the
// GUI `app` cart uses. Imports cart/app/db's useCRUD + cart/app/chat's
// store hook directly; no parallel client, no per-substrate code path.
// If you've ever launched ./scripts/dev app, this cart sees the same
// rows.
//
// Ship:  ./scripts/ship-tui cart/tui_db_smoke.tsx
// Run:   ./zig-out/bin/tui_db_smoke
//        (q to quit. ctrl-c also works.)

import * as React from 'react';
import { Box, Col, Row, Text } from '@reactjit/runtime/primitives';
import * as pg from '@reactjit/runtime/hooks/pg';
import { useCRUD } from './app/db';
import { useChatSessions, useChatHasAny } from './app/chat/store';

const passthrough: any = { parse: (v: unknown) => v };

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean | null }) {
  const color = ok === null ? '#94a3b8' : ok ? '#22d3ee' : '#f87171';
  return (
    <Row style={{ gap: 2 }}>
      <Text style={{ color: '#94a3b8' }}>{label}</Text>
      <Text style={{ color }}>{value}</Text>
    </Row>
  );
}

export default function Smoke() {
  // ── Host binding probe ──────────────────────────────────────────
  // pg.isAvailable() = hasHost('__pg_connect'). Proves v8_ingredients
  // registered the pg binding into THIS binary's V8 context — the same
  // catalog row the GUI cart consumes.
  const pgBound = pg.isAvailable();

  // ── Data-shape probes — useCRUD against cart/app/db ─────────────
  // Same `app` namespace + `user` / `settings` entity types the GUI
  // cart uses. Reading user_local + settings_default. If the user
  // ever ran ./scripts/dev app and completed onboarding, those rows
  // exist here.
  const userStore = useCRUD<any>('user', passthrough, { namespace: 'app' });
  const settingsStore = useCRUD<any>('settings', passthrough, { namespace: 'app' });
  const { data: user } = userStore.useQuery('user_local');
  const { data: settings } = settingsStore.useQuery('settings_default');

  // ── Chat substrate — exact same store the GUI's persistent rail
  // and /chat route use. useChatSessions triggers ensureChatLoaded()
  // which bootstraps the assistant bucket. useChatHasAny() rolls up
  // turn-count + session-count into one signal.
  const sessions = useChatSessions();
  const hasAny = useChatHasAny();

  const userSummary = user
    ? `name="${user.name ?? ''}" goal="${(user.goal ?? '').slice(0, 40)}"`
    : '(no row — GUI onboarding hasn\'t seeded one yet)';
  const settingsSummary = settings
    ? `actionDefaults.assistant=${settings?.actionDefaults?.assistant ?? '(none)'}`
    : '(no row)';

  return (
    <Col style={{ width: '100%', height: '100%', padding: 1, gap: 1 }}>
      <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>tui_db_smoke · same pg as cart/app</Text>
      <Text style={{ color: '#94a3b8' }}>shipping through unified v8_app -Dhas-gpu=false</Text>

      <Box style={{ marginTop: 1 }} />
      <Text style={{ color: '#fbbf24' }}>── bindings ──</Text>
      <StatusRow label="__pg_connect" value={pgBound ? 'bound' : 'MISSING'} ok={pgBound} />

      <Box style={{ marginTop: 1 }} />
      <Text style={{ color: '#fbbf24' }}>── app bucket (user + settings) ──</Text>
      <StatusRow label="User.user_local" value={userSummary} ok={!!user} />
      <StatusRow label="Settings.settings_default" value={settingsSummary} ok={!!settings} />

      <Box style={{ marginTop: 1 }} />
      <Text style={{ color: '#fbbf24' }}>── assistant bucket (chat) ──</Text>
      <StatusRow
        label="chat sessions"
        value={`${sessions.length}${hasAny ? ' (live)' : ' (empty)'}`}
        ok={sessions.length > 0}
      />
      {sessions.slice(0, 5).map((s) => (
        <Row key={s.id} style={{ gap: 2, paddingLeft: 2 }}>
          <Text style={{ color: '#94a3b8' }}>·</Text>
          <Text style={{ color: '#e7eaff' }}>{(s.title || '(untitled)').slice(0, 56)}</Text>
          <Text style={{ color: '#94a3b8' }}>
            {s.turn_count} turn{s.turn_count === 1 ? '' : 's'}
          </Text>
        </Row>
      ))}

      <Box style={{ marginTop: 1 }} />
      <Text style={{ color: '#94a3b8' }}>
        if all three sections are cyan → TUI and GUI are connected to the same datashapes.
      </Text>
    </Col>
  );
}
