import * as React from 'react';
import { Box, Col, Row, Text } from '@reactjit/primitives';
import { Button, KeyValue } from '../components/Field';
import { SETTINGS_ID, useSettingsStore } from '../settings';

export type ChatMetadataSettings = {
  showTimestamp?: boolean;
  showModel?: boolean;
  showBackend?: boolean;
  showCost?: boolean;
  showUsage?: boolean;
  showSession?: boolean;
};

export const DEFAULT_CHAT_METADATA: Required<ChatMetadataSettings> = {
  showTimestamp: true,
  showModel: true,
  showBackend: false,
  showCost: true,
  showUsage: true,
  showSession: false,
};

export function chatMetadataSettings(settings: any): Required<ChatMetadataSettings> {
  return {
    ...DEFAULT_CHAT_METADATA,
    ...(settings?.tui?.chatMetadata || {}),
  };
}

function Toggle({ label, value, onPress }: { label: string; value: boolean; onPress: () => void }) {
  return (
    <Row style={{ gap: 2, paddingBottom: 1 }}>
      <Button label={value ? 'on ' : 'off'} tone={value ? 'primary' : 'muted'} onPress={onPress} />
      <Text style={{ color: '#e7eaff' }}>{label}</Text>
    </Row>
  );
}

export function MetadataRoute() {
  const settingsStore = useSettingsStore();
  const { data: settings, refetch } = settingsStore.useQuery(SETTINGS_ID);
  const cfg = chatMetadataSettings(settings);
  const [message, setMessage] = React.useState('');

  const setFlag = async (key: keyof ChatMetadataSettings, value: boolean) => {
    const next = {
      ...(settings || { id: SETTINGS_ID }),
      id: SETTINGS_ID,
      tui: {
        ...(settings?.tui || {}),
        chatMetadata: {
          ...(settings?.tui?.chatMetadata || {}),
          [key]: value,
        },
      },
    };
    setMessage('saving...');
    try {
      await settingsStore.create(next);
      refetch();
      setMessage('saved');
    } catch (e: any) {
      setMessage(`save failed: ${e?.message || String(e)}`);
    }
  };

  return (
    <Col style={{ width: '100%', padding: 1, gap: 1 }}>
      <Row style={{ gap: 2, paddingBottom: 1 }}>
        <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>chat metadata</Text>
        <Text style={{ color: '#64748b' }}>Settings.settings_default.tui.chatMetadata</Text>
      </Row>

      <Toggle label="timestamp beside each turn" value={cfg.showTimestamp} onPress={() => setFlag('showTimestamp', !cfg.showTimestamp)} />
      <Toggle label="model from WorkerEvent.model" value={cfg.showModel} onPress={() => setFlag('showModel', !cfg.showModel)} />
      <Toggle label="backend from WorkerEvent.backend" value={cfg.showBackend} onPress={() => setFlag('showBackend', !cfg.showBackend)} />
      <Toggle label="cost from WorkerEvent.cost_usd_delta" value={cfg.showCost} onPress={() => setFlag('showCost', !cfg.showCost)} />
      <Toggle label="tokens from WorkerEvent.usage" value={cfg.showUsage} onPress={() => setFlag('showUsage', !cfg.showUsage)} />
      <Toggle label="worker/external session ids" value={cfg.showSession} onPress={() => setFlag('showSession', !cfg.showSession)} />

      <Box style={{ paddingTop: 1 }}>
        <Text style={{ color: '#fbbf24' }}>── source fields ──</Text>
        <KeyValue label="event model" value="WorkerEvent.model" />
        <KeyValue label="event backend" value="WorkerEvent.backend" />
        <KeyValue label="event cost" value="WorkerEvent.cost_usd_delta" />
        <KeyValue label="event usage" value="WorkerEvent.usage.{input,output,cache_*}" />
        <KeyValue label="persisted on" value="chat-turn.data.metadata" />
      </Box>

      <Text style={{ color: message.startsWith('save failed') ? '#f87171' : '#94a3b8' }}>{message}</Text>
    </Col>
  );
}

