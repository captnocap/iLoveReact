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
import { useChatStatus } from '../../app/chat/store';
import {
  SETTINGS_ID,
  PRIVACY_ID,
  USER_ID,
  short,
  useConnectionStore,
  useModelStore,
  usePrivacyStore,
  useSettingsStore,
  useUserStore,
} from '../settings';

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
  const settingsStore = useSettingsStore();
  const modelStore = useModelStore();
  const connectionStore = useConnectionStore();
  const userStore = useUserStore();
  const privacyStore = usePrivacyStore();
  const { data: settings } = settingsStore.useQuery(SETTINGS_ID);
  const { data: user } = userStore.useQuery(USER_ID);
  const { data: privacy } = privacyStore.useQuery(PRIVACY_ID);
  const { data: connections } = connectionStore.useListQuery({ orderBy: 'createdAt', order: 'desc' });
  const { data: models } = modelStore.useListQuery({ orderBy: 'createdAt', order: 'desc' });
  const assistantModelId: string = settings?.actionDefaults?.assistant || '';
  const { data: model } = modelStore.useQuery(assistantModelId);
  const connId: string = model?.connectionId || '';
  const { data: conn } = connectionStore.useQuery(connId);
  const status = useChatStatus();

  const provider = conn?.kind ? String(conn.kind) : '(none)';
  const modelLabel = model?.remoteId ? String(model.remoteId) : '(no model bound)';

  return (
    <Col style={{ width: '100%', padding: 1, gap: 1 }}>
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

      <Section title="settings rows">
        <Field label="user.name" value={String(user?.displayName || user?.name || '(empty)')} color="#e7eaff" />
        <Field label="user.goal" value={short(user?.goal || user?.bio || '(empty)', 76)} color="#94a3b8" />
        <Field label="connections" value={String((connections || []).length)} color="#22d3ee" />
        {(connections || []).map((c: any) => (
          <Field
            key={c.id}
            label={`conn ${short(c.label || c.id, 20)}`}
            value={`${c.kind || '(kind?)'} ${short(c.endpoint || c?.credentialRef?.locator || '', 48)}`}
            color="#94a3b8"
          />
        ))}
        <Field label="models" value={String((models || []).length)} color="#22d3ee" />
        {(models || []).slice(0, 8).map((m: any) => (
          <Field
            key={m.id}
            label={`model ${short(m.displayName || m.remoteId || m.id, 20)}`}
            value={`${m.modality || 'text'} · ${short(m.connectionId || '', 42)}`}
            color={m.id === assistantModelId ? '#fbbf24' : '#94a3b8'}
          />
        ))}
        {(models || []).length > 8 ? (
          <Field label="model list" value={`+${(models || []).length - 8} more`} color="#64748b" />
        ) : null}
      </Section>

      <Section title="privacy">
        <Field label="proxy" value={String(privacy?.network?.proxy || '(direct)')} color="#94a3b8" />
        <Field label="tools.allow" value={String(privacy?.tools?.allow?.length || 0)} color="#94a3b8" />
        <Field label="filesystem.allow" value={String(privacy?.filesystem?.allow?.length || 0)} color="#94a3b8" />
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
