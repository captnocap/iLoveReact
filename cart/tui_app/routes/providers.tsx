import * as React from 'react';
import { Box, Col, Row, Text, Pressable } from '@reactjit/runtime/primitives';
import { Button, Field, Input } from '../components/Field';
import { Picker } from '../components/Picker';
import { SETTINGS_ID, nowIso, short, text, useConnectionStore } from '../settings';

type Kind =
  | 'claude-code-cli'
  | 'anthropic-api-key'
  | 'openai-api-key'
  | 'openai-api-like'
  | 'kimi-api-key'
  | 'codex-cli'
  | 'local-runtime';

type Source = 'env' | 'literal' | 'cli-session' | 'none';

const KINDS: Kind[] = [
  'claude-code-cli',
  'anthropic-api-key',
  'openai-api-key',
  'openai-api-like',
  'kimi-api-key',
  'codex-cli',
  'local-runtime',
];

const SOURCES: Source[] = ['env', 'literal', 'cli-session', 'none'];

function defaultEndpoint(kind: Kind): string {
  if (kind === 'anthropic-api-key') return 'https://api.anthropic.com/v1';
  if (kind === 'openai-api-key') return 'https://api.openai.com/v1';
  if (kind === 'openai-api-like' || kind === 'kimi-api-key') return 'http://localhost:11434/v1';
  return '';
}

function defaultLocator(kind: Kind): string {
  if (kind === 'anthropic-api-key') return 'ANTHROPIC_API_KEY';
  if (kind === 'openai-api-key' || kind === 'openai-api-like') return 'OPENAI_API_KEY';
  if (kind === 'kimi-api-key') return 'KIMI_API_KEY';
  if (kind === 'claude-code-cli') return '~/.claude/';
  if (kind === 'codex-cli') return '~/.codex/';
  return '~/.lmstudio/models';
}

function defaultSource(kind: Kind): Source {
  if (kind === 'claude-code-cli' || kind === 'codex-cli') return 'cli-session';
  if (kind === 'local-runtime') return 'none';
  return 'env';
}

function labelFor(kind: Kind): string {
  return kind.replace(/-api-key|-api-like|-cli|-runtime/g, '').replace(/-/g, ' ');
}

function summary(c: any): string {
  const cr = c?.credentialRef || {};
  return [cr.source, cr.locator, c.endpoint].filter(Boolean).join(' · ') || '(unconfigured)';
}

export function ProvidersRoute() {
  const store = useConnectionStore();
  const { data: all, refetch } = store.useListQuery({ orderBy: 'createdAt', order: 'desc' });
  const rows = (all || []).filter((c: any) => !c.settingsId || c.settingsId === SETTINGS_ID);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const editing = editingId ? rows.find((c: any) => c.id === editingId) : null;
  const [kind, setKind] = React.useState<Kind>('openai-api-key');
  const [label, setLabel] = React.useState('');
  const [endpoint, setEndpoint] = React.useState(defaultEndpoint('openai-api-key'));
  const [source, setSource] = React.useState<Source>('env');
  const [locator, setLocator] = React.useState(defaultLocator('openai-api-key'));
  const [message, setMessage] = React.useState('');

  const startNew = () => {
    const k: Kind = 'openai-api-key';
    setEditingId('new');
    setKind(k);
    setLabel('');
    setEndpoint(defaultEndpoint(k));
    setSource(defaultSource(k));
    setLocator(defaultLocator(k));
    setMessage('');
  };

  const startEdit = (c: any) => {
    const k = (KINDS.includes(c.kind) ? c.kind : 'openai-api-key') as Kind;
    setEditingId(c.id);
    setKind(k);
    setLabel(text(c.label));
    setEndpoint(text(c.endpoint, defaultEndpoint(k)));
    setSource((SOURCES.includes(c?.credentialRef?.source) ? c.credentialRef.source : defaultSource(k)) as Source);
    setLocator(text(c?.credentialRef?.locator, defaultLocator(k)));
    setMessage('');
  };

  const pickKind = (k: Kind) => {
    setKind(k);
    setEndpoint(defaultEndpoint(k));
    setSource(defaultSource(k));
    setLocator(defaultLocator(k));
  };

  const save = async () => {
    const id = editing && editingId !== 'new' ? editing.id : `conn_${Date.now().toString(36)}`;
    const row: any = {
      ...(editing || {}),
      id,
      settingsId: SETTINGS_ID,
      kind,
      label: label.trim() || labelFor(kind),
      status: 'active',
      credentialRef: { source, locator: locator.trim() || undefined },
      createdAt: editing?.createdAt || nowIso(),
    };
    if (endpoint.trim()) row.endpoint = endpoint.trim();
    else delete row.endpoint;
    setMessage('saving...');
    try {
      await store.create(row);
      setEditingId(null);
      refetch();
      setMessage('saved');
    } catch (e: any) {
      setMessage(`save failed: ${e?.message || String(e)}`);
    }
  };

  const remove = async (id: string) => {
    await store.delete(id);
    refetch();
  };

  return (
    <Col style={{ width: '100%', padding: 1, gap: 1 }}>
      <Row style={{ gap: 2, paddingBottom: 1 }}>
        <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>providers</Text>
        <Text style={{ color: '#64748b' }}>{rows.length} connections</Text>
        <Box style={{ flexGrow: 1 }} />
        <Button label="+ new" onPress={startNew} />
      </Row>

      {editingId ? (
        <Col style={{ gap: 1, paddingBottom: 1 }}>
          <Text style={{ color: '#fbbf24' }}>{editingId === 'new' ? 'new connection' : `editing ${editingId}`}</Text>
          <Field label="Kind">
            <Picker<Kind> value={kind} options={KINDS} onChange={pickKind} />
          </Field>
          <Field label="Label">
            <Input value={label} onChange={setLabel} placeholder={labelFor(kind)} />
          </Field>
          <Field label="Endpoint">
            <Input value={endpoint} onChange={setEndpoint} placeholder={defaultEndpoint(kind)} />
          </Field>
          <Field label="Credential source">
            <Picker<Source> value={source} options={SOURCES} onChange={setSource} />
          </Field>
          <Field label="Credential locator">
            <Input value={locator} onChange={setLocator} placeholder={defaultLocator(kind)} />
          </Field>
          <Row style={{ gap: 2 }}>
            <Button label="save provider" onPress={save} />
            <Button label="cancel" tone="muted" onPress={() => setEditingId(null)} />
            <Text style={{ color: message.startsWith('save failed') ? '#f87171' : '#94a3b8' }}>{message}</Text>
          </Row>
        </Col>
      ) : null}

      {rows.length === 0 ? (
        <Text style={{ color: '#64748b', paddingLeft: 2 }}>no providers yet</Text>
      ) : rows.map((c: any) => (
        <Row key={c.id} style={{ width: '100%', gap: 1, paddingBottom: 1 }}>
          <Pressable onPress={() => startEdit(c)}>
            <Box style={{ flexGrow: 1, paddingLeft: 2 }}>
              <Row style={{ gap: 2 }}>
                <Text style={{ color: '#e7eaff', fontWeight: 'bold' }}>{short(c.label || c.id, 28)}</Text>
                <Text style={{ color: '#22d3ee' }}>{c.kind}</Text>
                <Text style={{ color: '#64748b' }}>{short(summary(c), 72)}</Text>
              </Row>
            </Box>
          </Pressable>
          <Button label="×" tone="danger" onPress={() => remove(c.id)} />
        </Row>
      ))}
    </Col>
  );
}
