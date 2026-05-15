// T3 Code — Settings Panels (1:1 behavior port)

import { useState, useCallback } from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView, TextInput, Switch } from '@reactjit/runtime/primitives';
import type { Settings, ProviderInstance, RuntimeMode, InteractionMode } from '../types';

interface SettingsProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onSetProvider: (id: string, patch: Partial<ProviderInstance>) => void;
  onAddProvider: (p: ProviderInstance) => void;
  onRemoveProvider: (id: string) => void;
  onClose: () => void;
}

const RUNTIME_MODE_LABELS: Record<RuntimeMode, string> = {
  'approval-required': 'Supervised',
  'auto-accept-edits': 'Auto-accept edits',
  'full-access': 'Full access',
};

const DRIVER_OPTIONS: { value: ProviderInstance['driver']; label: string }[] = [
  { value: 'claude_code', label: 'Claude' },
  { value: 'codex_app_server', label: 'Codex' },
  { value: 'kimi_cli_wire', label: 'Kimi' },
  { value: 'local_ai', label: 'Local AI' },
  { value: 'openai_compat', label: 'OpenAI Compatible' },
];

export default function SettingsPanel(props: SettingsProps) {
  const { settings, onUpdate, onSetProvider, onAddProvider, onRemoveProvider, onClose } = props;
  const [tab, setTab] = useState<'general' | 'providers' | 'keybindings'>('general');
  const [newProviderDriver, setNewProviderDriver] = useState<ProviderInstance['driver']>('claude_code');
  const [newProviderLabel, setNewProviderLabel] = useState('');
  const [newProviderModel, setNewProviderModel] = useState('');

  const handleAddProvider = useCallback(() => {
    if (!newProviderLabel.trim() || !newProviderModel.trim()) return;
    onAddProvider({
      id: `provider-${Date.now()}`,
      driver: newProviderDriver,
      label: newProviderLabel.trim(),
      model: newProviderModel.trim(),
      enabled: true,
    });
    setNewProviderLabel('');
    setNewProviderModel('');
  }, [newProviderDriver, newProviderLabel, newProviderModel, onAddProvider]);

  return (
    <Box style={{
      position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 90,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Box style={{
        width: 720, maxWidth: '90%', height: 560, maxHeight: '90%',
        backgroundColor: '#0e0e10', borderRadius: 8,
        borderWidth: 1, borderColor: '#2a2a30',
        flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <Row style={{
          padding: 12, borderBottomWidth: 1, borderColor: '#2a2a30',
          justifyContent: 'space-between', alignItems: 'center',
        }}>
          <Text style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: 14, fontWeight: 'bold' }}>Settings</Text>
          <Pressable onPress={onClose}>
            <Box style={{ padding: 4 }}>
              <Text style={{ color: '#888', fontFamily: 'monospace', fontSize: 14 }}>✕</Text>
            </Box>
          </Pressable>
        </Row>

        <Row style={{ flexGrow: 1, minHeight: 0 }}>
          {/* Sidebar nav */}
          <Col style={{ width: 180, borderRightWidth: 1, borderColor: '#2a2a30', padding: 8, gap: 2 }}>
            {(['general', 'providers', 'keybindings'] as const).map(t => (
              <Pressable key={t} onPress={() => setTab(t)}>
                <Box style={{
                  padding: 8, borderRadius: 4,
                  backgroundColor: tab === t ? '#1a1a1f' : 'transparent',
                }}>
                  <Text style={{
                    color: tab === t ? '#e8e8e8' : '#888',
                    fontFamily: 'monospace', fontSize: 12, textTransform: 'capitalize',
                  }}>{t}</Text>
                </Box>
              </Pressable>
            ))}
          </Col>

          {/* Content */}
          <ScrollView style={{ flexGrow: 1 }}>
            <Col style={{ padding: 16, gap: 16 }}>
              {tab === 'general' && (
                <>
                  <SettingsSection title="Default runtime mode">
                    <Col style={{ gap: 6 }}>
                      {(['approval-required', 'auto-accept-edits', 'full-access'] as RuntimeMode[]).map(mode => (
                        <Pressable key={mode} onPress={() => onUpdate({ defaultRuntimeMode: mode })}>
                          <Row style={{ gap: 8, alignItems: 'center' }}>
                            <Box style={{
                              width: 12, height: 12, borderRadius: 6,
                              borderWidth: 1, borderColor: '#555',
                              backgroundColor: settings.defaultRuntimeMode === mode ? '#3b82f6' : 'transparent',
                            }} />
                            <Col>
                              <Text style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: 12 }}>{RUNTIME_MODE_LABELS[mode]}</Text>
                              <Text style={{ color: '#666', fontFamily: 'monospace', fontSize: 10 }}>{mode}</Text>
                            </Col>
                          </Row>
                        </Pressable>
                      ))}
                    </Col>
                  </SettingsSection>

                  <SettingsSection title="Default interaction mode">
                    <Row style={{ gap: 12 }}>
                      {(['build', 'plan'] as InteractionMode[]).map(mode => (
                        <Pressable key={mode} onPress={() => onUpdate({ defaultInteractionMode: mode })}>
                          <Box style={{
                            padding: 8, borderRadius: 4, borderWidth: 1,
                            borderColor: settings.defaultInteractionMode === mode ? '#3b82f6' : '#2a2a30',
                            backgroundColor: settings.defaultInteractionMode === mode ? '#1a2332' : 'transparent',
                          }}>
                            <Text style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: 12, textTransform: 'capitalize' }}>{mode}</Text>
                          </Box>
                        </Pressable>
                      ))}
                    </Row>
                  </SettingsSection>

                  <SettingsSection title="Sidebar sort order">
                    <Row style={{ gap: 12 }}>
                      {(['updated_at', 'created_at'] as const).map(order => (
                        <Pressable key={order} onPress={() => onUpdate({ sidebarThreadSortOrder: order })}>
                          <Box style={{
                            padding: 8, borderRadius: 4, borderWidth: 1,
                            borderColor: settings.sidebarThreadSortOrder === order ? '#3b82f6' : '#2a2a30',
                            backgroundColor: settings.sidebarThreadSortOrder === order ? '#1a2332' : 'transparent',
                          }}>
                            <Text style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: 12 }}>{order === 'updated_at' ? 'Last message' : 'Created at'}</Text>
                          </Box>
                        </Pressable>
                      ))}
                    </Row>
                  </SettingsSection>
                </>
              )}

              {tab === 'providers' && (
                <>
                  <SettingsSection title="Provider instances">
                    <Col style={{ gap: 8 }}>
                      {settings.providers.map(p => (
                        <Box key={p.id} style={{
                          padding: 10, borderRadius: 4, borderWidth: 1, borderColor: '#2a2a30',
                          backgroundColor: '#1a1a1f', gap: 6,
                        }}>
                          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: 12, fontWeight: 'bold' }}>{p.label}</Text>
                            <Row style={{ gap: 8, alignItems: 'center' }}>
                              <Pressable onPress={() => onSetProvider(p.id, { enabled: !p.enabled })}>
                                <Box style={{
                                  width: 28, height: 16, borderRadius: 8,
                                  backgroundColor: p.enabled ? '#3b82f6' : '#3a3a40',
                                  alignItems: p.enabled ? 'flex-end' : 'flex-start',
                                  justifyContent: 'center', padding: 2,
                                }}>
                                  <Box style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff' }} />
                                </Box>
                              </Pressable>
                              <Pressable onPress={() => onRemoveProvider(p.id)}>
                                <Text style={{ color: '#ff6b6b', fontFamily: 'monospace', fontSize: 11 }}>Remove</Text>
                              </Pressable>
                            </Row>
                          </Row>
                          <Row style={{ gap: 8 }}>
                            <Text style={{ color: '#888', fontFamily: 'monospace', fontSize: 10 }}>{p.driver}</Text>
                            <Text style={{ color: '#888', fontFamily: 'monospace', fontSize: 10 }}>{p.model}</Text>
                          </Row>
                        </Box>
                      ))}
                    </Col>
                  </SettingsSection>

                  <SettingsSection title="Add provider">
                    <Col style={{ gap: 8 }}>
                      <Row style={{ gap: 8, flexWrap: 'wrap' }}>
                        {DRIVER_OPTIONS.map(d => (
                          <Pressable key={d.value} onPress={() => setNewProviderDriver(d.value)}>
                            <Box style={{
                              padding: 6, borderRadius: 4, borderWidth: 1,
                              borderColor: newProviderDriver === d.value ? '#3b82f6' : '#2a2a30',
                              backgroundColor: newProviderDriver === d.value ? '#1a2332' : 'transparent',
                            }}>
                              <Text style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: 11 }}>{d.label}</Text>
                            </Box>
                          </Pressable>
                        ))}
                      </Row>
                      <TextInput
                        value={newProviderLabel}
                        onChangeText={setNewProviderLabel}
                        placeholder="Label (e.g. Claude Pro)"
                        style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: 12, borderWidth: 1, borderColor: '#2a2a30', padding: 8, borderRadius: 4 }}
                      />
                      <TextInput
                        value={newProviderModel}
                        onChangeText={setNewProviderModel}
                        placeholder="Model (e.g. claude-opus-4-7)"
                        style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: 12, borderWidth: 1, borderColor: '#2a2a30', padding: 8, borderRadius: 4 }}
                      />
                      <Pressable onPress={handleAddProvider}>
                        <Box style={{
                          padding: 8, borderRadius: 4, backgroundColor: '#3b82f6',
                          alignItems: 'center',
                        }}>
                          <Text style={{ color: '#fff', fontFamily: 'monospace', fontSize: 12 }}>Add provider</Text>
                        </Box>
                      </Pressable>
                    </Col>
                  </SettingsSection>
                </>
              )}

              {tab === 'keybindings' && (
                <SettingsSection title="Keyboard shortcuts">
                  <Col style={{ gap: 6 }}>
                    {KEYBINDING_ROWS.map(row => (
                      <Row key={row.command} style={{ justifyContent: 'space-between', padding: 6, borderRadius: 4, backgroundColor: '#1a1a1f' }}>
                        <Text style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: 12 }}>{row.label}</Text>
                        <Text style={{ color: '#888', fontFamily: 'monospace', fontSize: 11 }}>{row.keys}</Text>
                      </Row>
                    ))}
                  </Col>
                </SettingsSection>
              )}
            </Col>
          </ScrollView>
        </Row>
      </Box>
    </Box>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Col style={{ gap: 8 }}>
      <Text style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: 12, fontWeight: 'bold' }}>{title}</Text>
      {children}
    </Col>
  );
}

const KEYBINDING_ROWS = [
  { command: 'commandPalette.toggle', label: 'Command palette', keys: 'Ctrl+Shift+P' },
  { command: 'chat.new', label: 'New thread', keys: 'Ctrl+N' },
  { command: 'terminal.toggle', label: 'Toggle terminal', keys: 'Ctrl+`' },
  { command: 'terminal.new', label: 'New terminal', keys: 'Ctrl+Shift+T' },
  { command: 'terminal.split', label: 'Split terminal', keys: 'Ctrl+Shift+D' },
  { command: 'terminal.close', label: 'Close terminal', keys: 'Ctrl+Shift+W' },
  { command: 'diff.toggle', label: 'Toggle diff panel', keys: 'Ctrl+Shift+G' },
];
