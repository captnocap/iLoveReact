// status route — what's wired, what isn't.
//
// Three sections:
//   1. bindings — is __pg_connect bound? (proves v8_ingredients
//      catalog reached this binary)
//   2. assistant connection — what model/backend the provider would
//      use if you submitted a chat right now (reads Settings +
//      Connection + Model rows the GUI's /settings page writes)
//   3. live phase — same useChatStatus the Footer uses, but with
//      more detail (full error strings, not truncated)
//
// If section 2 says "(none)", the cart can't actually chat yet —
// go through the GUI cart's /settings/providers to wire a key, then
// come back here.

import * as React from 'react';
import { Box, Col, Row, Text } from '@reactjit/runtime/primitives';
import * as pg from '@reactjit/runtime/hooks/pg';
import { useCRUD } from '../../app/db';
import { useChatStatus } from '../../app/chat/store';

const passthrough: any = { parse: (v: unknown) => v };
const SETTINGS_ID = 'settings_default';

function Field({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Row style={{ gap: 2, paddingLeft: 2, paddingBottom: 0 }}>
      <Text style={{ color: '#94a3b8' }}>{label}</Text>
      <Text style={{ color }}>{value}</Text>
    </Row>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Col style={{ width: '100%', paddingBottom: 1 }}>
      <Text style={{ color: '#fbbf24' }}>── {title} ──</Text>
      {children}
    </Col>
  );
}

export function StatusRoute() {
  const pgBound = pg.isAvailable();
  const settingsStore = useCRUD<any>('settings', passthrough, { namespace: 'app' });
  const modelStore = useCRUD<any>('model', passthrough, { namespace: 'app' });
  const connectionStore = useCRUD<any>('connection', passthrough, { namespace: 'app' });
  const { data: settings } = settingsStore.useQuery(SETTINGS_ID);
  const assistantModelId: string = settings?.actionDefaults?.assistant || '';
  const { data: model } = modelStore.useQuery(assistantModelId);
  const connId: string = model?.connectionId || '';
  const { data: conn } = connectionStore.useQuery(connId);
  const status = useChatStatus();

  const provider = conn?.kind ? String(conn.kind) : '(none)';
  const modelLabel = model?.remoteId ? String(model.remoteId) : '(no model bound)';

  return (
    <Col style={{ width: '100%', height: '100%', padding: 1, gap: 1 }}>
      <Section title="bindings">
        <Field label="__pg_connect" value={pgBound ? 'bound' : 'MISSING'} color={pgBound ? '#22d3ee' : '#f87171'} />
      </Section>

      <Section title="assistant connection">
        <Field
          label="provider kind"
          value={provider}
          color={provider === '(none)' ? '#f87171' : '#22d3ee'}
        />
        <Field
          label="model"
          value={modelLabel}
          color={modelLabel.startsWith('(') ? '#f87171' : '#e7eaff'}
        />
        {provider === '(none)' ? (
          <Box style={{ paddingLeft: 2, paddingTop: 1 }}>
            <Text style={{ color: '#64748b' }}>
              no assistant model bound. open the GUI cart (./scripts/dev app),
              go to /settings/providers, wire a connection + pick a default
              model, then come back here.
            </Text>
          </Box>
        ) : null}
      </Section>

      <Section title="live phase">
        <Field label="phase" value={status.phase} color="#e7eaff" />
        <Field label="lastStatus" value={status.lastStatus || '(empty)'} color="#94a3b8" />
        {status.error ? (
          <Box style={{ paddingLeft: 2, paddingTop: 1 }}>
            <Text style={{ color: '#f87171' }}>error: {status.error}</Text>
          </Box>
        ) : null}
      </Section>

      <Box style={{ flexGrow: 1 }} />
      <Text style={{ color: '#475569', paddingLeft: 1 }}>
        same datashapes the GUI cart writes — flip to /chat and type to fire a turn.
      </Text>
    </Col>
  );
}
