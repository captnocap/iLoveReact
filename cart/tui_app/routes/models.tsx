import * as React from 'react';
import { Box, Col, Row, Text, Pressable } from '@reactjit/primitives';
import { Button, Field, Input } from '../components/Field';
import { Picker } from '../components/Picker';
import { SETTINGS_ID, nowIso, short, text, useConnectionStore, useModelStore, useSettingsStore } from '../settings';

type Modality = 'text' | 'embed' | 'voice' | 'image' | 'tts';
const MODALITIES: Modality[] = ['text', 'embed', 'voice', 'image', 'tts'];

function modelName(m: any): string {
  return m?.displayName || m?.remoteId || m?.id || '(unnamed)';
}

export function ModelsRoute() {
  const modelStore = useModelStore();
  const connStore = useConnectionStore();
  const settingsStore = useSettingsStore();
  const { data: models, refetch } = modelStore.useListQuery({ orderBy: 'createdAt', order: 'desc' });
  const { data: conns } = connStore.useListQuery({ orderBy: 'createdAt', order: 'desc' });
  const { data: settings, refetch: refetchSettings } = settingsStore.useQuery(SETTINGS_ID);
  const connectionIds = (conns || []).map((c: any) => String(c.id));
  const firstConn = connectionIds[0] || '';

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const editing = editingId ? (models || []).find((m: any) => m.id === editingId) : null;
  const [remoteId, setRemoteId] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [connectionId, setConnectionId] = React.useState(firstConn);
  const [modality, setModality] = React.useState<Modality>('text');
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    if (!connectionId && firstConn) setConnectionId(firstConn);
  }, [connectionId, firstConn]);

  const startNew = () => {
    setEditingId('new');
    setRemoteId('');
    setDisplayName('');
    setConnectionId(firstConn);
    setModality('text');
    setMessage('');
  };

  const startEdit = (m: any) => {
    setEditingId(m.id);
    setRemoteId(text(m.remoteId));
    setDisplayName(text(m.displayName));
    setConnectionId(text(m.connectionId, firstConn));
    setModality((MODALITIES.includes(m.modality) ? m.modality : 'text') as Modality);
    setMessage('');
  };

  const save = async () => {
    if (!remoteId.trim()) {
      setMessage('remoteId required');
      return;
    }
    if (!connectionId) {
      setMessage('connection required');
      return;
    }
    const id = editing && editingId !== 'new'
      ? editing.id
      : `${connectionId}:${remoteId.trim()}`;
    const row = {
      ...(editing || {}),
      id,
      connectionId,
      remoteId: remoteId.trim(),
      displayName: displayName.trim() || remoteId.trim(),
      modality,
      favorite: editing?.favorite || false,
      custom: true,
      source: editing?.source || 'manual',
      createdAt: editing?.createdAt || nowIso(),
      lastSeenIso: nowIso(),
    };
    setMessage('saving...');
    try {
      await modelStore.create(row);
      setEditingId(null);
      refetch();
      setMessage('saved');
    } catch (e: any) {
      setMessage(`save failed: ${e?.message || String(e)}`);
    }
  };

  const setAssistantDefault = async (m: any) => {
    const next = {
      ...(settings || { id: SETTINGS_ID }),
      id: SETTINGS_ID,
      actionDefaults: {
        ...(settings?.actionDefaults || {}),
        assistant: m.id,
      },
    };
    await settingsStore.create(next);
    refetchSettings();
  };

  const remove = async (id: string) => {
    await modelStore.delete(id);
    refetch();
  };

  const assistantId = settings?.actionDefaults?.assistant || '';

  return (
    <Col style={{ width: '100%', padding: 1, gap: 1 }}>
      <Row style={{ gap: 2, paddingBottom: 1 }}>
        <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>models</Text>
        <Text style={{ color: '#64748b' }}>{(models || []).length} rows</Text>
        <Box style={{ flexGrow: 1 }} />
        <Button label="+ manual" onPress={startNew} />
      </Row>

      {connectionIds.length === 0 ? (
        <Text style={{ color: '#f87171', paddingLeft: 2 }}>add a provider before creating models</Text>
      ) : null}

      {editingId ? (
        <Col style={{ gap: 1, paddingBottom: 1 }}>
          <Text style={{ color: '#fbbf24' }}>{editingId === 'new' ? 'new model' : `editing ${editingId}`}</Text>
          <Field label="Connection">
            <Picker<string> value={connectionId} options={connectionIds} onChange={setConnectionId} />
          </Field>
          <Field label="Remote id">
            <Input value={remoteId} onChange={setRemoteId} placeholder="claude-3-5-sonnet-20241022" />
          </Field>
          <Field label="Display name">
            <Input value={displayName} onChange={setDisplayName} placeholder={remoteId || 'Model label'} />
          </Field>
          <Field label="Modality">
            <Picker<Modality> value={modality} options={MODALITIES} onChange={setModality} />
          </Field>
          <Row style={{ gap: 2 }}>
            <Button label="save model" onPress={save} />
            <Button label="cancel" tone="muted" onPress={() => setEditingId(null)} />
            <Text style={{ color: message.startsWith('save failed') || message.endsWith('required') ? '#f87171' : '#94a3b8' }}>{message}</Text>
          </Row>
        </Col>
      ) : null}

      {(models || []).length === 0 ? (
        <Text style={{ color: '#64748b', paddingLeft: 2 }}>no models yet. add one manually or use the GUI fetcher.</Text>
      ) : (models || []).map((m: any) => {
        const isDefault = m.id === assistantId;
        const conn = (conns || []).find((c: any) => c.id === m.connectionId);
        return (
          <Row key={m.id} style={{ width: '100%', gap: 1, paddingBottom: 1 }}>
            <Pressable onPress={() => startEdit(m)}>
              <Box style={{ flexGrow: 1, paddingLeft: 2 }}>
                <Row style={{ gap: 2 }}>
                  <Text style={{ color: isDefault ? '#fbbf24' : '#e7eaff', fontWeight: isDefault ? 'bold' : 'normal' }}>
                    {isDefault ? '★' : '·'} {short(modelName(m), 34)}
                  </Text>
                  <Text style={{ color: '#22d3ee' }}>{m.modality || 'text'}</Text>
                  <Text style={{ color: '#64748b' }}>{short(conn?.label || m.connectionId, 28)} · {short(m.remoteId, 48)}</Text>
                </Row>
              </Box>
            </Pressable>
            <Button label="default" tone={isDefault ? 'primary' : 'muted'} onPress={() => setAssistantDefault(m)} />
            <Button label="×" tone="danger" onPress={() => remove(m.id)} />
          </Row>
        );
      })}
    </Col>
  );
}
