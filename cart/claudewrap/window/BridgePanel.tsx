// BridgePanel — HTTP bridge status + recent traces.
//
// The bridge is always-on (mounted invisibly by App.tsx). This panel
// is the read-side: show the port, the route list, and the rolling
// last-N BridgeTrace records.

import * as React from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView, TextInput } from '../../../runtime/primitives';
import { palette } from '../ui/palette';
import { useTraces } from '../bridge/trace-store';
import { useSettings, setSettings } from '../state';
import { JsonView } from '../ui/JsonView';

const ROUTES = [
  'GET  /',
  'GET  /v1/models',
  'POST /v1/chat/completions',
  'POST /mcp',
  'GET  /rows',
  'GET  /state',
  'GET  /export',
  'GET  /transcripts',
  'POST /send',
];

export function BridgePanel() {
  const { bridgePort } = useSettings();
  const traces = useTraces();
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Col style={{ gap: 1, flexGrow: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>bridge</Text>
      <Row style={{ gap: 1 }}>
        <Text style={{ color: palette.dim }}>port</Text>
        <Box style={{
          width: 8,
          borderWidth: 1,
          borderColor: palette.border,
          paddingLeft: 1, paddingRight: 1,
        }}>
          <TextInput
            value={String(bridgePort)}
            onChangeText={(v: string) => {
              const n = Number(v);
              if (Number.isFinite(n) && n > 0 && n < 65536) {
                setSettings({ bridgePort: n });
              }
            }}
          />
        </Box>
        <Text style={{ color: palette.dim }}>
          (changes rebind on save — open/close panel to retry)
        </Text>
      </Row>
      <Text> </Text>

      <Text style={{ color: palette.dim, fontWeight: 'bold' }}>endpoints</Text>
      {ROUTES.map(r => (
        <Text key={r} style={{ color: palette.ink }}>· {r}</Text>
      ))}
      <Text> </Text>

      <Text style={{ color: palette.dim, fontWeight: 'bold' }}>
        recent traces ({traces.length})
      </Text>
      {traces.length === 0 && (
        <Text style={{ color: palette.dim }}>
          no requests yet — try: curl http://127.0.0.1:{bridgePort}/v1/models
        </Text>
      )}
      <ScrollView style={{ flexGrow: 1 }}>
        {traces.slice().reverse().map((t) => {
          const open = expanded.has(t.requestId);
          return (
            <Col key={t.requestId} style={{ gap: 0, paddingBottom: 1 }}>
              <Pressable onPress={() => toggle(t.requestId)}>
                <Row style={{ gap: 1 }}>
                  <Text style={{ color: palette.dim, width: 1 }}>{open ? '▼' : '▶'}</Text>
                  <Text style={{
                    color: t.resolvedBy?.startsWith('terminal') ? palette.warn : palette.good,
                  }}>
                    {t.resolvedBy ?? '(unresolved)'}
                  </Text>
                  <Text style={{ color: palette.dim }}>{t.requestId}</Text>
                  <Text style={{ color: palette.ink }}>{t.promptPreview}</Text>
                </Row>
              </Pressable>
              {open && (
                <Box style={{ paddingLeft: 4 }}>
                  <JsonView payload={t} width={80} />
                </Box>
              )}
            </Col>
          );
        })}
      </ScrollView>
    </Col>
  );
}
