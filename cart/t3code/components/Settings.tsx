// T3 Code — Settings Panels (1:1 behavior port)
//
// Ports: SettingsPanels.tsx, ProviderInstanceCard.tsx, ProviderSettingsForm.tsx,
// AddProviderInstanceDialog.tsx, KeybindingsSettings.tsx, settingsLayout.tsx

import { useState, useCallback, useMemo } from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView, TextInput } from '@reactjit/runtime/primitives';
import type { Settings, ProviderInstance, RuntimeMode, InteractionMode, Backend } from '../types';

// ── Props ────────────────────────────────────────────────────────────────────

interface SettingsProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onSetProvider: (id: string, patch: Partial<ProviderInstance>) => void;
  onAddProvider: (p: ProviderInstance) => void;
  onRemoveProvider: (id: string) => void;
  onClose: () => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

type SettingsTab = 'general' | 'providers' | 'keybindings';

const TAB_META: { key: SettingsTab; label: string; icon: string }[] = [
  { key: 'general', label: 'General', icon: '⚙' },
  { key: 'providers', label: 'Providers', icon: '◈' },
  { key: 'keybindings', label: 'Keybindings', icon: '⌨' },
];

const RUNTIME_MODE_OPTIONS: { value: RuntimeMode; label: string; description: string }[] = [
  { value: 'approval-required', label: 'Supervised', description: 'Ask before each tool use and edit' },
  { value: 'auto-accept-edits', label: 'Auto-accept edits', description: 'Accept file edits automatically, ask for commands' },
  { value: 'full-access', label: 'Full access', description: 'Run tools and edit files without asking' },
];

const INTERACTION_MODE_OPTIONS: { value: InteractionMode; label: string; description: string }[] = [
  { value: 'build', label: 'Build', description: 'Execute changes directly' },
  { value: 'plan', label: 'Plan', description: 'Propose a plan first, then execute' },
];

const TIMESTAMP_OPTIONS: { value: Settings['timestampFormat']; label: string }[] = [
  { value: 'relative', label: 'Relative (2m ago)' },
  { value: 'absolute', label: 'Absolute (14:32)' },
];

const SIDEBAR_SORT_OPTIONS: { value: Settings['sidebarThreadSortOrder']; label: string }[] = [
  { value: 'updated_at', label: 'Last message' },
  { value: 'created_at', label: 'Created date' },
];

const PROJECT_SORT_OPTIONS: { value: Settings['sidebarProjectSortOrder']; label: string }[] = [
  { value: 'updated_at', label: 'Last updated' },
  { value: 'created_at', label: 'Created date' },
  { value: 'manual', label: 'Manual' },
];

const DRIVER_OPTIONS: { value: Backend; label: string; accent: string }[] = [
  { value: 'claude_code', label: 'Claude', accent: '#cc785c' },
  { value: 'codex_app_server', label: 'Codex', accent: '#10a37f' },
  { value: 'kimi_cli_wire', label: 'Kimi', accent: '#6366f1' },
  { value: 'local_ai', label: 'Local AI', accent: '#737373' },
  { value: 'openai_compat', label: 'OpenAI Compatible', accent: '#10a37f' },
];

const COMING_SOON_DRIVERS: { label: string; accent: string }[] = [
  { label: 'Github Copilot', accent: '#6e7681' },
  { label: 'Gemini', accent: '#4285f4' },
  { label: 'Pi Agent', accent: '#e11d48' },
];

const KEYBINDING_ROWS: { command: string; label: string; keys: string; when: string }[] = [
  { command: 'commandPalette.toggle', label: 'Command Palette', keys: 'Ctrl+Shift+P', when: '' },
  { command: 'chat.new', label: 'New Thread', keys: 'Ctrl+N', when: '' },
  { command: 'chat.focus', label: 'Focus Chat Input', keys: 'Ctrl+L', when: '' },
  { command: 'chat.send', label: 'Send Message', keys: 'Enter', when: 'chatInputFocused' },
  { command: 'chat.newline', label: 'Insert Newline', keys: 'Shift+Enter', when: 'chatInputFocused' },
  { command: 'chat.cancel', label: 'Cancel Generation', keys: 'Escape', when: 'isStreaming' },
  { command: 'chat.regenerate', label: 'Regenerate', keys: 'Ctrl+Shift+R', when: '' },
  { command: 'terminal.toggle', label: 'Toggle Terminal', keys: 'Ctrl+`', when: '' },
  { command: 'terminal.new', label: 'New Terminal', keys: 'Ctrl+Shift+T', when: '' },
  { command: 'terminal.split', label: 'Split Terminal', keys: 'Ctrl+Shift+D', when: '' },
  { command: 'terminal.close', label: 'Close Terminal', keys: 'Ctrl+Shift+W', when: 'terminalFocused' },
  { command: 'terminal.next', label: 'Next Terminal', keys: 'Ctrl+PageDown', when: 'terminalFocused' },
  { command: 'terminal.prev', label: 'Previous Terminal', keys: 'Ctrl+PageUp', when: 'terminalFocused' },
  { command: 'diff.toggle', label: 'Toggle Diff Panel', keys: 'Ctrl+Shift+G', when: '' },
  { command: 'settings.open', label: 'Open Settings', keys: 'Ctrl+,', when: '' },
  { command: 'sidebar.toggle', label: 'Toggle Sidebar', keys: 'Ctrl+B', when: '' },
  { command: 'plan.toggle', label: 'Toggle Plan Panel', keys: 'Ctrl+Shift+E', when: '' },
  { command: 'thread.archive', label: 'Archive Thread', keys: 'Ctrl+Shift+A', when: 'threadSelected' },
  { command: 'thread.delete', label: 'Delete Thread', keys: 'Ctrl+Shift+Backspace', when: 'threadSelected' },
  { command: 'mode.plan', label: 'Switch to Plan Mode', keys: 'Ctrl+Shift+1', when: '' },
  { command: 'mode.build', label: 'Switch to Build Mode', keys: 'Ctrl+Shift+2', when: '' },
  { command: 'zoom.in', label: 'Zoom In', keys: 'Ctrl+=', when: '' },
  { command: 'zoom.out', label: 'Zoom Out', keys: 'Ctrl+-', when: '' },
  { command: 'zoom.reset', label: 'Reset Zoom', keys: 'Ctrl+0', when: '' },
];

// ── Theme colors ────────────────────────────────────────────────────────────

const C = {
  bg: '#0e0e10',
  bgCard: '#141418',
  bgCardHover: '#1a1a20',
  bgSelected: '#1a2332',
  bgOverlay: 'rgba(0,0,0,0.55)',
  bgInput: '#0a0a0c',
  bgBadge: '#2a2a30',
  bgDanger: '#3b1111',
  border: '#2a2a30',
  borderLight: '#222228',
  borderFocus: '#3b82f6',
  borderDanger: '#7f1d1d',
  text: '#e8e8ec',
  textMuted: '#888890',
  textDim: '#5a5a62',
  textDanger: '#ef4444',
  textSuccess: '#22c55e',
  textWarning: '#eab308',
  accent: '#3b82f6',
  accentHover: '#2563eb',
  accentSoft: '#1e3a5f',
  dotOk: '#22c55e',
  dotWarn: '#eab308',
  dotOff: '#4a4a50',
} as const;

// ── Shared styles ────────────────────────────────────────────────────────────

const FONT = { fontFamily: 'monospace' } as const;

const S = {
  label: { ...FONT, color: C.text, fontSize: 13, fontWeight: '600' as const },
  description: { ...FONT, color: C.textMuted, fontSize: 11, lineHeight: 16 },
  sectionTitle: { ...FONT, color: C.textDim, fontSize: 10, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 1.2 },
  inputBase: { ...FONT, color: C.text, fontSize: 12, backgroundColor: C.bgInput, borderWidth: 1, borderColor: C.border, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 7 },
  pill: { ...FONT, color: C.textMuted, fontSize: 10, backgroundColor: C.bgBadge, borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2 },
  badge: { ...FONT, fontSize: 9, fontWeight: '600' as const, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
} as const;

// ── Utility sub-components ──────────────────────────────────────────────────

function StatusDot({ color }: { color: string }) {
  return <Box style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />;
}

function Divider() {
  return <Box style={{ height: 1, backgroundColor: C.borderLight }} />;
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <Row style={{ alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 }}>
      <Row style={{ gap: 8, alignItems: 'center' }}>
        <Box style={{ width: 12, height: 1, backgroundColor: C.border }} />
        <Text style={S.sectionTitle}>{title}</Text>
      </Row>
      {action ?? null}
    </Row>
  );
}

function SettingsRow({
  title,
  description,
  control,
  resetAction,
}: {
  title: string;
  description: string;
  control?: React.ReactNode;
  resetAction?: React.ReactNode;
}) {
  return (
    <Row style={{
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderColor: C.borderLight,
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    }}>
      <Col style={{ flexShrink: 1, flexGrow: 1, gap: 3, minWidth: 0 }}>
        <Row style={{ alignItems: 'center', gap: 6 }}>
          <Text style={S.label}>{title}</Text>
          {resetAction ?? null}
        </Row>
        <Text style={S.description}>{description}</Text>
      </Col>
      {control ? (
        <Box style={{ flexShrink: 0 }}>
          {control}
        </Box>
      ) : null}
    </Row>
  );
}

function SettingsSection({ title, action, children }: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Col style={{ gap: 8 }}>
      <SectionHeader title={title} action={action} />
      <Box style={{
        borderRadius: 10,
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.bgCard,
        overflow: 'hidden',
      }}>
        {children}
      </Box>
    </Col>
  );
}

function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)}>
      <Box style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        backgroundColor: value ? C.accent : '#3a3a40',
        justifyContent: 'center',
        paddingHorizontal: 2,
      }}>
        <Box style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: '#fff',
          alignSelf: value ? 'flex-end' : 'flex-start',
        }} />
      </Box>
    </Pressable>
  );
}

function OptionPill({ label, selected, onPress }: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <Box style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: selected ? C.accent : C.border,
        backgroundColor: selected ? C.accentSoft : 'transparent',
      }}>
        <Text style={{ ...FONT, color: selected ? C.text : C.textMuted, fontSize: 12 }}>{label}</Text>
      </Box>
    </Pressable>
  );
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <Box style={{
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: selected ? C.accent : '#555',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {selected ? (
        <Box style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.accent }} />
      ) : null}
    </Box>
  );
}

function SmallButton({ label, onPress, variant = 'default', disabled }: {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
}) {
  const bgMap = {
    default: C.bgBadge,
    primary: C.accent,
    danger: C.bgDanger,
    ghost: 'transparent',
  };
  const textMap = {
    default: C.text,
    primary: '#fff',
    danger: C.textDanger,
    ghost: C.textMuted,
  };
  return (
    <Pressable onPress={disabled ? undefined : onPress}>
      <Box style={{
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 4,
        backgroundColor: disabled ? C.bgBadge : bgMap[variant],
        borderWidth: variant === 'ghost' ? 0 : 1,
        borderColor: variant === 'danger' ? C.borderDanger : C.border,
        opacity: disabled ? 0.5 : 1,
      }}>
        <Text style={{ ...FONT, color: disabled ? C.textDim : textMap[variant], fontSize: 11 }}>{label}</Text>
      </Box>
    </Pressable>
  );
}

function ResetButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Box style={{ padding: 2 }}>
        <Text style={{ ...FONT, color: C.textMuted, fontSize: 10 }}>↺</Text>
      </Box>
    </Pressable>
  );
}

function KeyPill({ value }: { value: string }) {
  const parts = value.split('+');
  return (
    <Row style={{ gap: 3 }}>
      {parts.map((part, i) => (
        <Box key={`${part}-${i}`} style={{
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 3,
          backgroundColor: C.bgBadge,
          borderWidth: 1,
          borderColor: C.border,
          minWidth: 22,
          alignItems: 'center',
        }}>
          <Text style={{ ...FONT, color: C.textMuted, fontSize: 10 }}>
            {part === 'Ctrl' ? '⌃' : part === 'Shift' ? '⇧' : part === 'Alt' ? '⌥' : part}
          </Text>
        </Box>
      ))}
    </Row>
  );
}

// ── General tab ─────────────────────────────────────────────────────────────

function GeneralTab({ settings, onUpdate }: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}) {
  return (
    <Col style={{ gap: 24 }}>
      <SettingsSection title="General">
        <SettingsRow
          title="Default runtime mode"
          description="Controls how much autonomy the agent has when executing tasks."
          control={
            <Col style={{ gap: 4 }}>
              {RUNTIME_MODE_OPTIONS.map(opt => (
                <Pressable key={opt.value} onPress={() => onUpdate({ defaultRuntimeMode: opt.value })}>
                  <Row style={{ gap: 8, alignItems: 'center', paddingVertical: 3 }}>
                    <RadioDot selected={settings.defaultRuntimeMode === opt.value} />
                    <Col>
                      <Text style={{ ...FONT, color: C.text, fontSize: 12 }}>{opt.label}</Text>
                      <Text style={{ ...FONT, color: C.textDim, fontSize: 10 }}>{opt.description}</Text>
                    </Col>
                  </Row>
                </Pressable>
              ))}
            </Col>
          }
        />

        <SettingsRow
          title="Default interaction mode"
          description="Pick whether new threads start in build or plan mode."
          control={
            <Row style={{ gap: 6 }}>
              {INTERACTION_MODE_OPTIONS.map(opt => (
                <OptionPill
                  key={opt.value}
                  label={opt.label}
                  selected={settings.defaultInteractionMode === opt.value}
                  onPress={() => onUpdate({ defaultInteractionMode: opt.value })}
                />
              ))}
            </Row>
          }
        />

        <SettingsRow
          title="Time format"
          description="How timestamps display in the thread list and messages."
          control={
            <Row style={{ gap: 6 }}>
              {TIMESTAMP_OPTIONS.map(opt => (
                <OptionPill
                  key={opt.value}
                  label={opt.label}
                  selected={settings.timestampFormat === opt.value}
                  onPress={() => onUpdate({ timestampFormat: opt.value })}
                />
              ))}
            </Row>
          }
        />

        <SettingsRow
          title="Thread sort order"
          description="How threads are ordered in the sidebar."
          control={
            <Row style={{ gap: 6 }}>
              {SIDEBAR_SORT_OPTIONS.map(opt => (
                <OptionPill
                  key={opt.value}
                  label={opt.label}
                  selected={settings.sidebarThreadSortOrder === opt.value}
                  onPress={() => onUpdate({ sidebarThreadSortOrder: opt.value })}
                />
              ))}
            </Row>
          }
        />

        <SettingsRow
          title="Project sort order"
          description="How projects are ordered in the sidebar."
          control={
            <Row style={{ gap: 6 }}>
              {PROJECT_SORT_OPTIONS.map(opt => (
                <OptionPill
                  key={opt.value}
                  label={opt.label}
                  selected={settings.sidebarProjectSortOrder === opt.value}
                  onPress={() => onUpdate({ sidebarProjectSortOrder: opt.value })}
                />
              ))}
            </Row>
          }
        />

        <SettingsRow
          title="Auto-open plan panel"
          description="Open the right-side plan panel automatically when steps appear."
          control={
            <ToggleSwitch
              value={settings.autoOpenPlanSidebar}
              onChange={v => onUpdate({ autoOpenPlanSidebar: v })}
            />
          }
        />

        <SettingsRow
          title="Archive confirmation"
          description="Require a second click before a thread is archived."
          control={
            <ToggleSwitch
              value={settings.confirmThreadArchive}
              onChange={v => onUpdate({ confirmThreadArchive: v })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="About">
        <SettingsRow
          title="Version"
          description="T3 Code — ReactJIT edition"
          control={
            <Text style={{ ...S.pill }}>dev</Text>
          }
        />
        <SettingsRow
          title="Diagnostics"
          description="Terminal logs only."
          control={
            <SmallButton label="View diagnostics" onPress={() => {}} />
          }
        />
      </SettingsSection>
    </Col>
  );
}

// ── Provider instance card ──────────────────────────────────────────────────

function ProviderCard({
  provider,
  onUpdate,
  onRemove,
}: {
  provider: ProviderInstance;
  onUpdate: (patch: Partial<ProviderInstance>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editLabel, setEditLabel] = useState(provider.label);
  const [editModel, setEditModel] = useState(provider.model);

  const driverMeta = DRIVER_OPTIONS.find(d => d.value === provider.driver);
  const driverLabel = driverMeta?.label ?? provider.driver;
  const accentColor = driverMeta?.accent ?? C.textMuted;
  const statusColor = provider.enabled ? C.dotOk : C.dotOff;

  const commitEdits = useCallback(() => {
    const labelTrimmed = editLabel.trim();
    const modelTrimmed = editModel.trim();
    const patch: Partial<ProviderInstance> = {};
    if (labelTrimmed && labelTrimmed !== provider.label) patch.label = labelTrimmed;
    if (modelTrimmed && modelTrimmed !== provider.model) patch.model = modelTrimmed;
    if (Object.keys(patch).length > 0) onUpdate(patch);
  }, [editLabel, editModel, provider.label, provider.model, onUpdate]);

  return (
    <Box style={{ borderTopWidth: 1, borderColor: C.borderLight }}>
      {/* Card header */}
      <Box style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Col style={{ flexShrink: 1, flexGrow: 1, gap: 4, minWidth: 0 }}>
            <Row style={{ alignItems: 'center', gap: 8 }}>
              <StatusDot color={statusColor} />
              <Box style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                backgroundColor: accentColor + '20',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Text style={{ ...FONT, color: accentColor, fontSize: 11, fontWeight: '700' }}>
                  {driverLabel.charAt(0).toUpperCase()}
                </Text>
              </Box>
              <Text style={{ ...FONT, color: C.text, fontSize: 13, fontWeight: '600' }}>
                {provider.label}
              </Text>
              {provider.id !== provider.driver ? (
                <Text style={{ ...S.pill, fontSize: 9 }}>{provider.id}</Text>
              ) : null}
            </Row>
            <Row style={{ gap: 8, paddingLeft: 37 }}>
              <Text style={{ ...FONT, color: C.textMuted, fontSize: 11 }}>
                {provider.enabled ? 'Active' : 'Disabled'}
              </Text>
              <Text style={{ ...FONT, color: C.textDim, fontSize: 11 }}>·</Text>
              <Text style={{ ...FONT, color: C.textMuted, fontSize: 11 }}>
                {provider.model}
              </Text>
            </Row>
          </Col>
          <Row style={{ gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <Pressable onPress={() => setExpanded(!expanded)}>
              <Box style={{ padding: 4 }}>
                <Text style={{ ...FONT, color: C.textMuted, fontSize: 11 }}>
                  {expanded ? '▲' : '▼'}
                </Text>
              </Box>
            </Pressable>
            <ToggleSwitch
              value={provider.enabled}
              onChange={v => onUpdate({ enabled: v })}
            />
          </Row>
        </Row>
      </Box>

      {/* Expanded detail */}
      {expanded ? (
        <Col style={{ borderTopWidth: 1, borderColor: C.borderLight }}>
          {/* Display name */}
          <Col style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 4, borderTopWidth: 0 }}>
            <Text style={{ ...FONT, color: C.text, fontSize: 11, fontWeight: '600' }}>Display name</Text>
            <TextInput
              value={editLabel}
              onChangeText={setEditLabel}
              onBlur={commitEdits}
              placeholder={driverLabel}
              style={{ ...S.inputBase }}
            />
            <Text style={{ ...FONT, color: C.textDim, fontSize: 10 }}>
              Optional label shown in the provider list.
            </Text>
          </Col>

          <Divider />

          {/* Model */}
          <Col style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 4 }}>
            <Text style={{ ...FONT, color: C.text, fontSize: 11, fontWeight: '600' }}>Model</Text>
            <TextInput
              value={editModel}
              onChangeText={setEditModel}
              onBlur={commitEdits}
              placeholder="e.g. claude-opus-4-7"
              style={{ ...S.inputBase }}
            />
            <Text style={{ ...FONT, color: C.textDim, fontSize: 10 }}>
              The model identifier used for requests to this provider.
            </Text>
          </Col>

          <Divider />

          {/* Driver info */}
          <Col style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 4 }}>
            <Text style={{ ...FONT, color: C.text, fontSize: 11, fontWeight: '600' }}>Driver</Text>
            <Row style={{ gap: 6, alignItems: 'center' }}>
              <Box style={{
                width: 18, height: 18, borderRadius: 3,
                backgroundColor: accentColor + '20',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ ...FONT, color: accentColor, fontSize: 9, fontWeight: '700' }}>
                  {driverLabel.charAt(0).toUpperCase()}
                </Text>
              </Box>
              <Text style={{ ...FONT, color: C.textMuted, fontSize: 11 }}>{driverLabel}</Text>
              <Text style={{ ...S.pill, fontSize: 9 }}>{provider.driver}</Text>
            </Row>
          </Col>

          <Divider />

          {/* Accent color swatches */}
          <Col style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 6 }}>
            <Text style={{ ...FONT, color: C.text, fontSize: 11, fontWeight: '600' }}>Accent color</Text>
            <Row style={{ gap: 6 }}>
              {['#2563eb', '#16a34a', '#ea580c', '#dc2626', '#7c3aed', '#0891b2'].map(swatch => (
                <Pressable key={swatch} onPress={() => {}}>
                  <Box style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: swatch,
                    borderWidth: accentColor === swatch ? 2 : 1,
                    borderColor: accentColor === swatch ? C.text : 'rgba(255,255,255,0.1)',
                  }} />
                </Pressable>
              ))}
            </Row>
            <Text style={{ ...FONT, color: C.textDim, fontSize: 10 }}>
              Used to distinguish this instance in picker rails and model lists.
            </Text>
          </Col>

          <Divider />

          {/* Environment variables placeholder */}
          <Col style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 4 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ ...FONT, color: C.text, fontSize: 11, fontWeight: '600' }}>Environment variables</Text>
              <SmallButton label="+ Add" onPress={() => {}} />
            </Row>
            <Text style={{ ...FONT, color: C.textDim, fontSize: 10 }}>
              Add variables to pass API keys, base URLs, or other per-instance CLI settings.
            </Text>
          </Col>

          <Divider />

          {/* Actions */}
          <Row style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            justifyContent: 'flex-end',
            gap: 8,
          }}>
            <SmallButton label="Remove instance" variant="danger" onPress={onRemove} />
          </Row>
        </Col>
      ) : null}
    </Box>
  );
}

// ── Add provider dialog ─────────────────────────────────────────────────────

function AddProviderForm({
  providers,
  onAdd,
  onCancel,
}: {
  providers: ProviderInstance[];
  onAdd: (p: ProviderInstance) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [driver, setDriver] = useState<Backend>('claude_code');
  const [label, setLabel] = useState('');
  const [model, setModel] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [idDirty, setIdDirty] = useState(false);

  const driverMeta = DRIVER_OPTIONS.find(d => d.value === driver);
  const driverLabel = driverMeta?.label ?? driver;
  const previewLabel = label.trim() || `${driverLabel} Workspace`;

  const existingIds = useMemo(() => new Set(providers.map(p => p.id)), [providers]);

  const derivedId = useMemo(() => {
    const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
    return slug ? `${driver}_${slug}` : '';
  }, [driver, label]);

  const effectiveId = idDirty ? instanceId : derivedId;

  const idError = useMemo(() => {
    if (!effectiveId) return 'Instance ID is required.';
    if (effectiveId.length > 64) return 'Instance ID must be 64 characters or fewer.';
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(effectiveId)) return 'Must start with a letter; use letters, digits, "-", or "_".';
    if (existingIds.has(effectiveId)) return `An instance named '${effectiveId}' already exists.`;
    return null;
  }, [effectiveId, existingIds]);

  const handleSave = useCallback(() => {
    if (idError) return;
    onAdd({
      id: effectiveId,
      driver,
      label: label.trim() || driverLabel,
      model: model.trim() || 'default',
      enabled: true,
    });
  }, [effectiveId, driver, label, model, driverLabel, idError, onAdd]);

  const stepLabels = ['Driver', 'Identity', 'Config'] as const;

  return (
    <Col style={{
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: 10,
      backgroundColor: C.bg,
      overflow: 'hidden',
    }}>
      {/* Dialog header */}
      <Col style={{
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderColor: C.borderLight,
        gap: 8,
      }}>
        <Text style={{ ...FONT, color: C.text, fontSize: 14, fontWeight: '600' }}>Add provider instance</Text>
        <Text style={{ ...FONT, color: C.textMuted, fontSize: 11 }}>
          Configure an additional provider instance — for example, a second Codex install pointed at a different workspace.
        </Text>

        {/* Wizard step indicators */}
        <Row style={{ gap: 6 }}>
          {stepLabels.map((s, i) => (
            <Pressable key={s} onPress={() => setStep(i as 0 | 1 | 2)}>
              <Box style={{
                flexGrow: 1,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: i === step ? C.accent : C.border,
                backgroundColor: i === step ? C.accentSoft : (i < step ? C.bgCard : C.bgBadge + '40'),
              }}>
                <Row style={{ gap: 6, alignItems: 'center' }}>
                  <Box style={{
                    width: 14, height: 14, borderRadius: 7,
                    borderWidth: 1,
                    borderColor: i < step ? C.accent : (i === step ? C.accent : C.textDim),
                    backgroundColor: i < step ? C.accent : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {i < step ? (
                      <Text style={{ ...FONT, color: '#fff', fontSize: 8 }}>✓</Text>
                    ) : null}
                  </Box>
                  <Col>
                    <Text style={{ ...FONT, color: C.textDim, fontSize: 8, textTransform: 'uppercase' }}>Step {i + 1}</Text>
                    <Text style={{ ...FONT, color: C.text, fontSize: 11, fontWeight: '600' }}>
                      {s}{i < step && i === 0 ? `: ${driverLabel}` : ''}{i < step && i === 1 ? `: ${previewLabel}` : ''}
                    </Text>
                  </Col>
                </Row>
              </Box>
            </Pressable>
          ))}
        </Row>
      </Col>

      {/* Step content */}
      <Col style={{
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 12,
        backgroundColor: C.bgCard,
        borderBottomWidth: 1,
        borderColor: C.borderLight,
      }}>
        {step === 0 ? (
          <Col style={{ gap: 6 }}>
            <Text style={{ ...FONT, color: C.text, fontSize: 11, fontWeight: '600' }}>Driver</Text>
            <Row style={{ gap: 6, flexWrap: 'wrap' }}>
              {DRIVER_OPTIONS.map(opt => {
                const selected = driver === opt.value;
                return (
                  <Pressable key={opt.value} onPress={() => setDriver(opt.value)}>
                    <Row style={{
                      gap: 8,
                      alignItems: 'center',
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: selected ? C.accent : C.border,
                      backgroundColor: selected ? C.bgCard : C.bg,
                    }}>
                      <Box style={{
                        width: 20, height: 20, borderRadius: 4,
                        backgroundColor: opt.accent + '25',
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Text style={{ ...FONT, color: opt.accent, fontSize: 11, fontWeight: '700' }}>
                          {opt.label.charAt(0)}
                        </Text>
                      </Box>
                      <Text style={{ ...FONT, color: C.text, fontSize: 12, fontWeight: '500' }}>{opt.label}</Text>
                    </Row>
                  </Pressable>
                );
              })}
            </Row>
            {/* Coming soon drivers */}
            <Row style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              {COMING_SOON_DRIVERS.map(opt => (
                <Box key={opt.label} style={{
                  flexDirection: 'row',
                  gap: 8,
                  alignItems: 'center',
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: C.border,
                  backgroundColor: C.bg,
                  opacity: 0.45,
                }}>
                  <Box style={{
                    width: 20, height: 20, borderRadius: 4,
                    backgroundColor: opt.accent + '25',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ ...FONT, color: opt.accent, fontSize: 11, fontWeight: '700' }}>
                      {opt.label.charAt(0)}
                    </Text>
                  </Box>
                  <Text style={{ ...FONT, color: C.textMuted, fontSize: 12 }}>{opt.label}</Text>
                  <Text style={{ ...S.badge, color: C.textWarning, backgroundColor: C.textWarning + '18' }}>Soon</Text>
                </Box>
              ))}
            </Row>
          </Col>
        ) : null}

        {step === 1 ? (
          <Col style={{ gap: 12 }}>
            <Col style={{ gap: 4 }}>
              <Text style={{ ...FONT, color: C.text, fontSize: 11, fontWeight: '600' }}>Label</Text>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder="e.g. Work"
                style={{ ...S.inputBase }}
              />
              <Text style={{ ...FONT, color: C.textDim, fontSize: 10 }}>Shown in the provider list. Optional.</Text>
            </Col>
            <Col style={{ gap: 4 }}>
              <Text style={{ ...FONT, color: C.text, fontSize: 11, fontWeight: '600' }}>Instance ID</Text>
              <TextInput
                value={idDirty ? instanceId : derivedId}
                onChangeText={v => { setIdDirty(true); setInstanceId(v); }}
                placeholder={`${driver}_work`}
                style={{ ...S.inputBase }}
              />
              {idError && idDirty ? (
                <Text style={{ ...FONT, color: C.textDanger, fontSize: 10 }}>{idError}</Text>
              ) : (
                <Text style={{ ...FONT, color: C.textDim, fontSize: 10 }}>
                  Routing key used by threads and sessions. Letters, digits, '-', or '_'.
                </Text>
              )}
            </Col>
            <Col style={{ gap: 4 }}>
              <Text style={{ ...FONT, color: C.text, fontSize: 11, fontWeight: '600' }}>Model</Text>
              <TextInput
                value={model}
                onChangeText={setModel}
                placeholder="e.g. claude-opus-4-7"
                style={{ ...S.inputBase }}
              />
              <Text style={{ ...FONT, color: C.textDim, fontSize: 10 }}>
                Default model for this instance. Can be changed per-thread.
              </Text>
            </Col>
          </Col>
        ) : null}

        {step === 2 ? (
          <Col style={{ gap: 8 }}>
            <Text style={{ ...FONT, color: C.textMuted, fontSize: 12 }}>
              This driver has no additional required configuration. You can add the instance now.
            </Text>
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <Text style={{ ...FONT, color: C.textDim, fontSize: 11 }}>Preview:</Text>
              <Row style={{ gap: 6, alignItems: 'center' }}>
                <Box style={{
                  width: 18, height: 18, borderRadius: 3,
                  backgroundColor: (driverMeta?.accent ?? C.textMuted) + '20',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ ...FONT, color: driverMeta?.accent ?? C.textMuted, fontSize: 10, fontWeight: '700' }}>
                    {driverLabel.charAt(0)}
                  </Text>
                </Box>
                <Text style={{ ...FONT, color: C.text, fontSize: 12, fontWeight: '600' }}>{previewLabel}</Text>
                <Text style={{ ...S.pill, fontSize: 9 }}>{effectiveId || '...'}</Text>
              </Row>
            </Row>
          </Col>
        ) : null}
      </Col>

      {/* Dialog footer */}
      <Row style={{
        paddingHorizontal: 16,
        paddingVertical: 10,
        justifyContent: 'flex-end',
        gap: 8,
      }}>
        <SmallButton
          label={step === 0 ? 'Cancel' : 'Back'}
          onPress={() => {
            if (step === 0) onCancel();
            else setStep((step - 1) as 0 | 1);
          }}
        />
        {step < 2 ? (
          <SmallButton
            label="Next"
            variant="primary"
            onPress={() => setStep((step + 1) as 1 | 2)}
          />
        ) : (
          <SmallButton
            label="Add instance"
            variant="primary"
            onPress={handleSave}
            disabled={!!idError}
          />
        )}
      </Row>
    </Col>
  );
}

// ── Providers tab ───────────────────────────────────────────────────────────

function ProvidersTab({ settings, onSetProvider, onAddProvider, onRemoveProvider }: {
  settings: Settings;
  onSetProvider: (id: string, patch: Partial<ProviderInstance>) => void;
  onAddProvider: (p: ProviderInstance) => void;
  onRemoveProvider: (id: string) => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);

  return (
    <Col style={{ gap: 24 }}>
      <SettingsSection
        title="Providers"
        action={
          <Row style={{ gap: 6, alignItems: 'center' }}>
            <Text style={{ ...FONT, color: C.textDim, fontSize: 10 }}>
              {settings.providers.filter(p => p.enabled).length}/{settings.providers.length} active
            </Text>
            <Pressable onPress={() => setShowAddForm(true)}>
              <Box style={{ padding: 2 }}>
                <Text style={{ ...FONT, color: C.textMuted, fontSize: 12 }}>+</Text>
              </Box>
            </Pressable>
          </Row>
        }
      >
        {settings.providers.map(p => (
          <ProviderCard
            key={p.id}
            provider={p}
            onUpdate={patch => onSetProvider(p.id, patch)}
            onRemove={() => onRemoveProvider(p.id)}
          />
        ))}
        {settings.providers.length === 0 ? (
          <Box style={{ padding: 16 }}>
            <Text style={{ ...FONT, color: C.textMuted, fontSize: 12, textAlign: 'center' }}>
              No providers configured. Add one to get started.
            </Text>
          </Box>
        ) : null}
      </SettingsSection>

      {showAddForm ? (
        <AddProviderForm
          providers={settings.providers}
          onAdd={p => {
            onAddProvider(p);
            setShowAddForm(false);
          }}
          onCancel={() => setShowAddForm(false)}
        />
      ) : !showAddForm ? (
        <Pressable onPress={() => setShowAddForm(true)}>
          <Box style={{
            paddingVertical: 10,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: C.border,
            borderStyle: 'dashed',
            alignItems: 'center',
          }}>
            <Text style={{ ...FONT, color: C.textMuted, fontSize: 12 }}>+ Add provider instance</Text>
          </Box>
        </Pressable>
      ) : null}
    </Col>
  );
}

// ── Keybindings tab ─────────────────────────────────────────────────────────

function KeybindingsTab() {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!query.trim()) return KEYBINDING_ROWS;
    const q = query.toLowerCase();
    return KEYBINDING_ROWS.filter(row =>
      row.label.toLowerCase().includes(q) ||
      row.command.toLowerCase().includes(q) ||
      row.keys.toLowerCase().includes(q)
    );
  }, [query]);

  return (
    <Col style={{ gap: 24 }}>
      <SettingsSection
        title="Keybindings"
        action={
          <Row style={{ gap: 6, alignItems: 'center' }}>
            <Text style={{ ...FONT, color: C.textDim, fontSize: 10 }}>
              {filtered.length} {filtered.length === 1 ? 'binding' : 'bindings'}
            </Text>
            <Pressable onPress={() => setSearchOpen(!searchOpen)}>
              <Box style={{ padding: 2 }}>
                <Text style={{ ...FONT, color: C.textMuted, fontSize: 11 }}>⌕</Text>
              </Box>
            </Pressable>
          </Row>
        }
      >
        {/* Search bar */}
        {searchOpen ? (
          <Box style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: C.borderLight }}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search keybindings..."
              style={{
                ...S.inputBase,
                paddingVertical: 5,
                fontSize: 11,
              }}
            />
          </Box>
        ) : null}

        {/* Column headers */}
        <Row style={{
          paddingHorizontal: 16,
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderColor: C.borderLight,
          backgroundColor: C.bgBadge + '40',
        }}>
          <Box style={{ width: '40%' }}>
            <Text style={{ ...FONT, color: C.textDim, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 }}>Command</Text>
          </Box>
          <Box style={{ width: '30%' }}>
            <Text style={{ ...FONT, color: C.textDim, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 }}>Keybinding</Text>
          </Box>
          <Box style={{ width: '30%' }}>
            <Text style={{ ...FONT, color: C.textDim, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 }}>When</Text>
          </Box>
        </Row>

        {/* Rows */}
        {filtered.map((row, i) => (
          <Row
            key={row.command}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 7,
              borderTopWidth: i > 0 ? 1 : 0,
              borderColor: C.borderLight,
              backgroundColor: i % 2 === 0 ? 'transparent' : C.bgBadge + '15',
              alignItems: 'center',
            }}
          >
            <Box style={{ width: '40%' }}>
              <Text style={{ ...FONT, color: C.text, fontSize: 12 }}>{row.label}</Text>
            </Box>
            <Box style={{ width: '30%' }}>
              <KeyPill value={row.keys} />
            </Box>
            <Box style={{ width: '30%' }}>
              <Text style={{ ...FONT, color: row.when ? C.textMuted : C.textDim, fontSize: 11 }}>
                {row.when || 'Always'}
              </Text>
            </Box>
          </Row>
        ))}

        {filtered.length === 0 ? (
          <Box style={{ padding: 24, alignItems: 'center' }}>
            <Text style={{ ...FONT, color: C.textMuted, fontSize: 12 }}>No keybindings match your search.</Text>
          </Box>
        ) : null}
      </SettingsSection>

      {/* Info note */}
      <Row style={{
        gap: 8,
        paddingHorizontal: 4,
        alignItems: 'flex-start',
      }}>
        <Text style={{ ...FONT, color: C.textWarning, fontSize: 11 }}>ℹ</Text>
        <Text style={{ ...FONT, color: C.textDim, fontSize: 10, lineHeight: 15 }}>
          Some shortcuts may be intercepted by the window manager or terminal emulator before the app sees them. Keybindings are read-only in this view.
        </Text>
      </Row>
    </Col>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

export default function SettingsPanel(props: SettingsProps) {
  const { settings, onUpdate, onSetProvider, onAddProvider, onRemoveProvider, onClose } = props;
  const [tab, setTab] = useState<SettingsTab>('general');

  return (
    <Box style={{
      position: 'absolute',
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      backgroundColor: C.bgOverlay,
      zIndex: 90,
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Pressable
        onPress={onClose}
        style={{
          position: 'absolute',
          left: 0, top: 0, right: 0, bottom: 0,
        }}
      >
        <Box style={{ width: '100%', height: '100%' }} />
      </Pressable>

      <Box style={{
        width: 780,
        maxWidth: '92%',
        height: 620,
        maxHeight: '92%',
        backgroundColor: C.bg,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: C.border,
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 91,
      }}>
        {/* Header bar */}
        <Row style={{
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderColor: C.border,
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: C.bgCard,
        }}>
          <Row style={{ gap: 10, alignItems: 'center' }}>
            <Text style={{ ...FONT, color: C.textDim, fontSize: 13 }}>⚙</Text>
            <Text style={{ ...FONT, color: C.text, fontSize: 14, fontWeight: '600' }}>Settings</Text>
          </Row>
          <Pressable onPress={onClose}>
            <Box style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              backgroundColor: 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Text style={{ ...FONT, color: C.textMuted, fontSize: 14 }}>✕</Text>
            </Box>
          </Pressable>
        </Row>

        <Row style={{ flexGrow: 1, minHeight: 0 }}>
          {/* Sidebar nav */}
          <Col style={{
            width: 180,
            borderRightWidth: 1,
            borderColor: C.border,
            paddingVertical: 8,
            paddingHorizontal: 6,
            gap: 1,
            backgroundColor: C.bgCard,
          }}>
            {TAB_META.map(t => {
              const active = tab === t.key;
              return (
                <Pressable key={t.key} onPress={() => setTab(t.key)}>
                  <Row style={{
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 5,
                    backgroundColor: active ? C.accentSoft : 'transparent',
                    gap: 8,
                    alignItems: 'center',
                  }}>
                    <Text style={{ ...FONT, color: active ? C.accent : C.textDim, fontSize: 12 }}>{t.icon}</Text>
                    <Text style={{
                      ...FONT,
                      color: active ? C.text : C.textMuted,
                      fontSize: 12,
                      fontWeight: active ? '600' : '400',
                    }}>{t.label}</Text>
                  </Row>
                </Pressable>
              );
            })}

            {/* Bottom version info */}
            <Box style={{ flexGrow: 1 }} />
            <Box style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
              <Text style={{ ...FONT, color: C.textDim, fontSize: 9 }}>T3 Code · ReactJIT</Text>
              <Text style={{ ...FONT, color: C.textDim, fontSize: 9 }}>dev build</Text>
            </Box>
          </Col>

          {/* Content area */}
          <ScrollView style={{ flexGrow: 1, flexShrink: 1 }}>
            <Col style={{ padding: 20, gap: 24 }}>
              {tab === 'general' ? (
                <GeneralTab settings={settings} onUpdate={onUpdate} />
              ) : null}

              {tab === 'providers' ? (
                <ProvidersTab
                  settings={settings}
                  onSetProvider={onSetProvider}
                  onAddProvider={onAddProvider}
                  onRemoveProvider={onRemoveProvider}
                />
              ) : null}

              {tab === 'keybindings' ? (
                <KeybindingsTab />
              ) : null}
            </Col>
          </ScrollView>
        </Row>
      </Box>
    </Box>
  );
}
