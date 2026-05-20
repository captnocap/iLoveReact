// BackendsPanel — workers for the useAssistant dispatch path.
//
// These are NOT the claude session running in the main TUI Terminal.
// The TUI Terminal is locked to claude-code-in-firecracker (driven by
// scripts/claude-ss). Nothing on this panel touches it.
//
// useAssistant spawns ADDITIONAL workers via framework/worker_bindings.zig.
// The OpenAI HTTP bridge can route /v1/chat/completions through these
// workers instead of the live vterm, future automation can drive them
// in parallel with the vterm session, etc. Each entry is its own
// independent claude/codex/kimi/local/openai-compatible session — even
// 'claude_code' here is a separate claude process from the TUI vterm.

import * as React from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView } from '../../../runtime/primitives';
import { palette } from '../ui/palette';
import { useSettings, setSettings } from '../state';
import type { AssistantBackend } from '../../../runtime/hooks/useAssistant';

interface BackendCard {
  id: AssistantBackend;
  label: string;
  description: string;
}

const BACKENDS: BackendCard[] = [
  {
    id: 'claude_code',
    label: 'Claude Code (worker)',
    description: 'Separate claude CLI subprocess — NOT the TUI vterm. Same backend as the in-firecracker claude, but a fresh session driven via __worker_*.',
  },
  {
    id: 'codex_app_server',
    label: 'Codex (app server)',
    description: 'OpenAI Codex CLI app-server protocol. V8 bridge pending.',
  },
  {
    id: 'kimi_cli_wire',
    label: 'Kimi (--wire)',
    description: 'Moonshot Kimi CLI subprocess in wire-protocol mode.',
  },
  {
    id: 'local_ai',
    label: 'Local AI',
    description: 'Embedded llama.cpp on a local .gguf. Set modelPath in settings.',
  },
  {
    id: 'openai_compat',
    label: 'OpenAI-compat HTTP',
    description: 'Generic OpenAI-shaped endpoint via base_url + model.',
  },
];

export function BackendsPanel() {
  const { activeBackend } = useSettings();

  return (
    <Col style={{ gap: 1, flexGrow: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>
        useAssistant workers
      </Text>
      <Text style={{ color: palette.dim }}>
        worker dispatch surface — does NOT control the TUI vterm
      </Text>
      <Text style={{ color: palette.dim }}>
        the terminal pane stays on claude-in-firecracker regardless of what's active here
      </Text>
      <Text> </Text>
      <Text style={{ color: palette.dim }}>
        consumers: the OpenAI HTTP bridge (route /v1/chat/completions through
        the active worker instead of the vterm), future parallel-agent automation
      </Text>
      <Text style={{ color: palette.dim }}>
        active = {activeBackend}
      </Text>
      <Text> </Text>
      <ScrollView style={{ flexGrow: 1 }}>
        {BACKENDS.map((b) => {
          const isActive = b.id === activeBackend;
          return (
            <Col key={b.id} style={{
              gap: 0,
              paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1,
              borderWidth: 1,
              borderColor: isActive ? palette.accent : palette.border,
            }}>
              <Row style={{ gap: 1 }}>
                <Pressable onPress={() => setSettings({ activeBackend: b.id })}>
                  <Text style={{
                    color: isActive ? palette.good : palette.dim,
                    fontWeight: 'bold',
                  }}>
                    {isActive ? '[active]' : '[select]'}
                  </Text>
                </Pressable>
                <Text style={{ color: palette.ink, fontWeight: 'bold' }}>{b.label}</Text>
                <Box style={{ flexGrow: 1 }} />
                <Text style={{ color: palette.dim }}>{b.id}</Text>
              </Row>
              <Box style={{ paddingLeft: 9 }}>
                <Text style={{ color: palette.dim }}>{b.description}</Text>
              </Box>
            </Col>
          );
        })}
      </ScrollView>
    </Col>
  );
}
