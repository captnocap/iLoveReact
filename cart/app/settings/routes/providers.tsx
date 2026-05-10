// Providers route — credentials only.
//
// Six UI kinds (internal kind strings kept stable so the assistant /
// model-picking code that switches on `kind` keeps working):
//
//   "OpenAI"            → openai-api-key   (Chat Completions HTTP — also covers Codex models via API key)
//   "OpenAI-Compatible" → openai-api-like  (Kimi, LMStudio HTTP, Ollama, vLLM…)
//   "Anthropic"         → anthropic-api-key
//   "Claude Code"       → claude-code-cli  (subscription via local CLI auth)
//   "Codex"             → codex-cli        (local `codex` app-server subprocess, stdio JSON-RPC)
//   "Local"             → local-runtime    (embedded llama.cpp; needs .gguf folder)
//
// Multiple instances per kind are fine. Each row is one connection
// pointing the assistant at one credential / endpoint.
//
// Connection row shape (preserved for compat):
//   {
//     id, settingsId, kind, label, status, createdAt,
//     credentialRef: { source: 'env' | 'cli-session' | 'none', locator: string | undefined },
//     endpoint?: string,
//   }
//
// Model listing/picking lives in /models (not here) — this route is
// purely "how to reach a provider", not "what models it serves".

import { useState } from 'react';
import { Box, Pressable } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { Icon } from '@reactjit/runtime/icons/Icon';
import {
  Sparkles, Cloud, Bot, Key, HardDrive,
  Pencil, Trash2, Plus, X,
} from '@reactjit/runtime/icons/icons';
import { ProviderIcon } from '../../gallery/components/model-card/ProviderIcon';
import { PROVIDER_ICONS } from '../../gallery/components/model-card/providerIcons.generated';
import { Section, Field, Input, PillRow, SETTINGS_ID } from '../shared';
import { useSettingsCtx } from '../page';

type UiKind = 'openai' | 'openai-compat' | 'anthropic' | 'claude-code' | 'codex' | 'local';

const UI_KINDS: UiKind[] = ['openai', 'openai-compat', 'anthropic', 'claude-code', 'codex', 'local'];
const UI_LABELS: Record<UiKind, string> = {
  'openai':        'OpenAI',
  'openai-compat': 'OpenAI-Compatible',
  'anthropic':     'Anthropic',
  'claude-code':   'Claude Code',
  'codex':         'Codex',
  'local':         'Local',
};

// Internal kind strings, kept for assistant-chat compat.
const INTERNAL_KIND: Record<UiKind, string> = {
  'openai':        'openai-api-key',
  'openai-compat': 'openai-api-like',
  'anthropic':     'anthropic-api-key',
  'claude-code':   'claude-code-cli',
  'codex':         'codex-cli',
  'local':         'local-runtime',
};
const UI_FROM_INTERNAL: Record<string, UiKind> = {
  'openai-api-key':    'openai',
  'openai-api-like':   'openai-compat',
  'kimi-api-key':      'openai-compat', // legacy preset folds into openai-compat
  'anthropic-api-key': 'anthropic',
  'claude-code-cli':   'claude-code',
  'codex-cli':         'codex',
  'local-runtime':     'local',
};

const KIND_ICON: Record<UiKind, number[][]> = {
  'openai':        Sparkles,
  'openai-compat': Cloud,
  'anthropic':     Bot,
  'claude-code':   Key,
  'codex':         Key,
  'local':         HardDrive,
};

// Brand-icon defaults per kind. Maps to PROVIDER_ICONS keys.
const DEFAULT_BRAND_ICON: Record<UiKind, string> = {
  'openai':        'openai',
  'openai-compat': 'ollama',
  'anthropic':     'anthropic',
  'claude-code':   'claude',
  'codex':         'openai',
  'local':         'meta',
};

// Order shown in the picker. All are valid PROVIDER_ICONS keys.
const BRAND_ICON_ORDER: string[] = [
  'openai', 'anthropic', 'claude',
  'gemini', 'google', 'meta', 'metaai',
  'mistral', 'cohere', 'deepseek', 'qwen', 'zhipu',
  'grok', 'xai', 'groq', 'perplexity', 'huggingface', 'ollama',
];

const BRAND_LABEL: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', claude: 'Claude',
  gemini: 'Gemini', google: 'Google', meta: 'Meta', metaai: 'Meta AI',
  mistral: 'Mistral', cohere: 'Cohere', deepseek: 'DeepSeek',
  qwen: 'Qwen', zhipu: 'Zhipu', grok: 'Grok', xai: 'xAI', groq: 'Groq',
  perplexity: 'Perplexity', huggingface: 'Hugging Face', ollama: 'Ollama',
};

const DEFAULTS = {
  endpoint: {
    'openai':        'https://api.openai.com/v1',
    'openai-compat': 'http://localhost:11434/v1',
    'anthropic':     'https://api.anthropic.com/v1',
  } as Record<string, string>,
  envVar: {
    'openai':        'OPENAI_API_KEY',
    'openai-compat': 'OPENAI_API_KEY',
    'anthropic':     'ANTHROPIC_API_KEY',
  } as Record<string, string>,
  folder: {
    'claude-code': '~/.claude/',
    'codex':       '~/.codex/',
    'local':       '~/.lmstudio/models',
  } as Record<string, string>,
};

function needsEndpoint(k: UiKind) { return k === 'openai' || k === 'openai-compat' || k === 'anthropic'; }
function needsKey(k: UiKind)      { return k === 'openai' || k === 'openai-compat' || k === 'anthropic'; }
function needsFolder(k: UiKind)   { return k === 'claude-code' || k === 'codex' || k === 'local'; }
function defaultLabel(k: UiKind)  { return UI_LABELS[k]; }

type Draft = {
  uiKind: UiKind;
  label: string;
  endpoint: string;
  envVar: string;
  folder: string;
  iconId: string;
};

function emptyDraft(uiKind: UiKind = 'openai'): Draft {
  return {
    uiKind,
    label: '',
    endpoint: DEFAULTS.endpoint[uiKind] || '',
    envVar: DEFAULTS.envVar[uiKind] || '',
    folder: DEFAULTS.folder[uiKind] || '',
    iconId: DEFAULT_BRAND_ICON[uiKind],
  };
}

function draftFromConn(c: any): Draft {
  const uiKind = UI_FROM_INTERNAL[c.kind] || 'openai';
  const cr = c.credentialRef || {};
  return {
    uiKind,
    label: c.label || '',
    endpoint: c.endpoint || DEFAULTS.endpoint[uiKind] || '',
    envVar: cr.source === 'env' ? (cr.locator || DEFAULTS.envVar[uiKind] || '') : (DEFAULTS.envVar[uiKind] || ''),
    folder: (cr.source === 'cli-session' || cr.source === 'none' || uiKind === 'local') ? (cr.locator || DEFAULTS.folder[uiKind] || '') : (DEFAULTS.folder[uiKind] || ''),
    iconId: (typeof c.iconId === 'string' && PROVIDER_ICONS[c.iconId]) ? c.iconId : DEFAULT_BRAND_ICON[uiKind],
  };
}

function draftToRow(d: Draft, idHint?: string): any {
  const internalKind = INTERNAL_KIND[d.uiKind];
  let credentialRef: { source: string; locator: string | undefined };
  if (needsKey(d.uiKind)) {
    credentialRef = { source: 'env', locator: d.envVar.trim() || undefined };
  } else if (d.uiKind === 'claude-code') {
    credentialRef = { source: 'cli-session', locator: d.folder.trim() || undefined };
  } else { // local
    credentialRef = { source: 'none', locator: d.folder.trim() || undefined };
  }
  const row: any = {
    kind: internalKind,
    label: d.label.trim() || defaultLabel(d.uiKind),
    credentialRef,
    status: 'active',
    iconId: d.iconId,
  };
  if (needsEndpoint(d.uiKind)) row.endpoint = d.endpoint.trim() || DEFAULTS.endpoint[d.uiKind];
  if (idHint) row.id = idHint;
  return row;
}

function validate(d: Draft): string | null {
  if (!d.label.trim() && !defaultLabel(d.uiKind)) return 'Label is required.';
  if (needsKey(d.uiKind) && !d.envVar.trim()) return 'Env var name is required.';
  if (needsEndpoint(d.uiKind) && !d.endpoint.trim()) return 'Endpoint URL is required.';
  if (needsFolder(d.uiKind) && !d.folder.trim()) return 'Folder path is required.';
  return null;
}

// ─── Editor ──────────────────────────────────────────────────────────

function ProviderEditor({ initial, onSave, onCancel }: {
  initial: Draft;
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const onPickKind = (k: UiKind) => {
    setDraft((prev) => ({
      ...prev,
      uiKind: k,
      endpoint: prev.endpoint || DEFAULTS.endpoint[k] || '',
      envVar:   prev.envVar   || DEFAULTS.envVar[k]   || '',
      folder:   prev.folder   || DEFAULTS.folder[k]   || '',
      iconId:   DEFAULT_BRAND_ICON[k],
    }));
  };
  const err = validate(draft);

  return (
    <S.AppFormShell style={{ width: '100%', maxWidth: '100%' }}>
      <Field label="Kind">
        <PillRow<UiKind>
          options={UI_KINDS}
          labels={UI_LABELS}
          value={draft.uiKind}
          onChange={onPickKind}
        />
      </Field>

      <Field label="Icon">
        <IconPicker
          value={draft.iconId}
          onChange={(id) => update({ iconId: id })}
        />
      </Field>

      <Field label="Label">
        <Input
          value={draft.label}
          onChange={(v) => update({ label: v })}
          placeholder={defaultLabel(draft.uiKind)}
        />
      </Field>

      {needsEndpoint(draft.uiKind) && (
        <Field label="Endpoint URL">
          <Input
            mono
            value={draft.endpoint}
            onChange={(v) => update({ endpoint: v })}
            placeholder={DEFAULTS.endpoint[draft.uiKind]}
          />
        </Field>
      )}

      {needsKey(draft.uiKind) && (
        <Field label="API key env var">
          <Input
            mono
            value={draft.envVar}
            onChange={(v) => update({ envVar: v })}
            placeholder={DEFAULTS.envVar[draft.uiKind] || 'API_KEY'}
          />
        </Field>
      )}

      {needsFolder(draft.uiKind) && (
        <Field label={draft.uiKind === 'local' ? 'Models folder (.gguf)' : 'Auth directory'}>
          <Input
            mono
            value={draft.folder}
            onChange={(v) => update({ folder: v })}
            placeholder={DEFAULTS.folder[draft.uiKind]}
          />
        </Field>
      )}

      {err ? (
        <S.AppProbeResult>
          <S.AppProbeFail>Cannot save</S.AppProbeFail>
          <S.AppProbeMessage>{err}</S.AppProbeMessage>
        </S.AppProbeResult>
      ) : null}

      <S.AppFormButtonRow style={{ gap: 8 }}>
        <S.ButtonOutline onPress={onCancel}>
          <S.ButtonOutlineLabel>Cancel</S.ButtonOutlineLabel>
        </S.ButtonOutline>
        <S.Button onPress={err ? () => {} : () => onSave(draft)}>
          <S.ButtonLabel>Save</S.ButtonLabel>
        </S.Button>
      </S.AppFormButtonRow>
    </S.AppFormShell>
  );
}

// ─── Row view ────────────────────────────────────────────────────────

function summaryFor(c: any): string {
  const cr = c.credentialRef || {};
  const ui = UI_FROM_INTERNAL[c.kind] || 'openai';
  if (ui === 'local')       return cr.locator || '(no folder)';
  if (ui === 'claude-code') return cr.locator || '(no auth dir)';
  // api kinds
  const ep  = c.endpoint ? c.endpoint : '';
  const env = cr.source === 'env' ? cr.locator : '';
  return [env, ep].filter(Boolean).join('  ·  ') || '(unconfigured)';
}

function ProviderGlyph({ iconId, ui, size = 56 }: { iconId?: string; ui: UiKind; size?: number }) {
  const id = (iconId && PROVIDER_ICONS[iconId]) ? iconId : DEFAULT_BRAND_ICON[ui];
  if (id && PROVIDER_ICONS[id]) {
    return <ProviderIcon providerId={id} size={size} />;
  }
  // Fallback to lucide kind glyph
  return (
    <Box style={{
      width: size, height: size,
      borderRadius: Math.round(size * 0.22),
      backgroundColor: 'theme:bg2',
      borderWidth: 1, borderColor: 'theme:rule',
      alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Icon icon={KIND_ICON[ui]} size={Math.round(size * 0.46)} color="theme:ink" strokeWidth={1.6} />
    </Box>
  );
}

function IconPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <Box style={{
      flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    }}>
      {BRAND_ICON_ORDER.filter((id) => PROVIDER_ICONS[id]).map((id) => {
        const active = id === value;
        return (
          <Pressable key={id} onPress={() => onChange(id)} tooltip={BRAND_LABEL[id] || id}>
            <Box style={{
              padding: 4,
              borderRadius: 10,
              borderWidth: 2,
              borderColor: active ? 'theme:accent' : 'theme:rule',
              backgroundColor: active ? 'theme:bg1' : 'theme:bg2',
            }}>
              <ProviderIcon providerId={id} size={36} />
            </Box>
          </Pressable>
        );
      })}
    </Box>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <Box style={{
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingLeft: 10, paddingRight: 12, paddingTop: 4, paddingBottom: 4,
      borderRadius: 999,
      backgroundColor: 'theme:bg2',
      borderWidth: 1, borderColor: 'theme:rule',
    }}>
      <Box style={{
        width: 7, height: 7, borderRadius: 4,
        backgroundColor: active ? 'theme:ok' : 'theme:inkDimmer',
      }} />
      <S.Caption>{active ? 'Active' : 'Idle'}</S.Caption>
    </Box>
  );
}

function IconButton({ icon, onPress, tone, label }: {
  icon: number[][]; onPress: () => void; tone?: 'danger'; label?: string;
}) {
  const color = tone === 'danger' ? 'theme:flag' : 'theme:ink';
  return (
    <Pressable onPress={onPress}>
      <Box style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingLeft: 14, paddingRight: 16, paddingTop: 9, paddingBottom: 9,
        borderRadius: 'theme:radiusMd',
        borderWidth: 1, borderColor: 'theme:rule',
        backgroundColor: 'theme:bg2',
      }}>
        <Icon icon={icon} size={15} color={color} strokeWidth={2} />
        {label ? <S.ButtonOutlineLabel>{label}</S.ButtonOutlineLabel> : null}
      </Box>
    </Pressable>
  );
}

function ProviderRow({ conn, onEdit, onDelete }: {
  conn: any;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const ui = UI_FROM_INTERNAL[conn.kind] || 'openai';
  const isActive = (conn.status || 'active') === 'active';
  return (
    <Box style={{
      flexDirection: 'row', gap: 18, alignItems: 'center',
      paddingTop: 6, paddingBottom: 6,
    }}>
      <ProviderGlyph iconId={conn.iconId} ui={ui} />
      <Box style={{ flexGrow: 1, flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <Box style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <S.Heading>{conn.label || UI_LABELS[ui]}</S.Heading>
          <S.BadgeNeutral><S.BadgeNeutralText>{UI_LABELS[ui]}</S.BadgeNeutralText></S.BadgeNeutral>
          <StatusPill active={isActive} />
        </Box>
        <S.BodyDim>{summaryFor(conn)}</S.BodyDim>
      </Box>
      {confirmDel ? (
        <Box style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <S.BodyDim>Delete this provider?</S.BodyDim>
          <Pressable onPress={() => { setConfirmDel(false); onDelete(); }}>
            <Box style={{
              paddingLeft: 14, paddingRight: 14, paddingTop: 9, paddingBottom: 9,
              borderRadius: 'theme:radiusMd',
              backgroundColor: 'theme:flag',
            }}>
              <S.ButtonLabel>Confirm</S.ButtonLabel>
            </Box>
          </Pressable>
          <Pressable onPress={() => setConfirmDel(false)}>
            <Box style={{
              paddingLeft: 14, paddingRight: 14, paddingTop: 9, paddingBottom: 9,
              borderRadius: 'theme:radiusMd',
              borderWidth: 1, borderColor: 'theme:rule',
              backgroundColor: 'theme:bg2',
            }}>
              <S.ButtonOutlineLabel>Cancel</S.ButtonOutlineLabel>
            </Box>
          </Pressable>
        </Box>
      ) : (
        <Box style={{ flexDirection: 'row', gap: 8, flexShrink: 0 }}>
          <IconButton icon={Pencil} onPress={onEdit} label="Edit" />
          <IconButton icon={Trash2} onPress={() => setConfirmDel(true)} tone="danger" label="Delete" />
        </Box>
      )}
    </Box>
  );
}

// ─── Page ────────────────────────────────────────────────────────────

function EditorFrame({ title, onCancel, children }: {
  title: string; onCancel: () => void; children: any;
}) {
  return (
    <Box style={{ flexDirection: 'column', gap: 10 }}>
      <Box style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingLeft: 4, paddingRight: 4,
      }}>
        <S.Heading>{title}</S.Heading>
        <Pressable onPress={onCancel}>
          <Box style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingLeft: 8, paddingRight: 10, paddingTop: 4, paddingBottom: 4,
            borderRadius: 6,
            borderWidth: 1, borderColor: 'theme:rule',
            backgroundColor: 'theme:bg2',
          }}>
            <Icon icon={X} size={12} color="theme:inkDim" strokeWidth={2} />
            <S.Caption>Cancel</S.Caption>
          </Box>
        </Pressable>
      </Box>
      {children}
    </Box>
  );
}

export default function ProvidersRoute() {
  const { connections, connectionStore, reload } = useSettingsCtx();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const showHeader = !adding && !editingId;
  const visibleRows = connections.filter((c: any) => c.id !== editingId);
  const editingConn = editingId ? connections.find((c: any) => c.id === editingId) : null;

  return (
    <Section caption="Connections" title="Providers">
      {/* Sub-header: description + Add CTA */}
      {showHeader && (
        <Box style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          marginTop: -4,
        }}>
          <S.BodyDim style={{ flexShrink: 1 }}>
            Each provider is a credential + endpoint. Multiple instances per kind are fine.
          </S.BodyDim>
          {!editingId && (
            <Pressable onPress={() => { setAdding(true); setEditingId(null); }}>
              <Box style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                paddingLeft: 16, paddingRight: 18, paddingTop: 10, paddingBottom: 10,
                borderRadius: 'theme:radiusMd',
                backgroundColor: 'theme:accent',
                flexShrink: 0,
              }}>
                <Icon icon={Plus} size={15} color="theme:bg" strokeWidth={2.4} />
                <S.ButtonLabel>Add provider</S.ButtonLabel>
              </Box>
            </Pressable>
          )}
        </Box>
      )}

      {/* New-provider editor */}
      {adding && (
        <EditorFrame title="New provider" onCancel={() => setAdding(false)}>
          <ProviderEditor
            initial={emptyDraft('openai')}
            onCancel={() => setAdding(false)}
            onSave={async (d) => {
              const id = `conn_${Date.now().toString(36)}`;
              await connectionStore.create({
                ...draftToRow(d),
                id,
                settingsId: SETTINGS_ID,
                createdAt: new Date().toISOString(),
              });
              setAdding(false);
              reload();
            }}
          />
        </EditorFrame>
      )}

      {/* Edit existing */}
      {editingConn && (
        <EditorFrame
          title={`Edit · ${editingConn.label || UI_LABELS[UI_FROM_INTERNAL[editingConn.kind] || 'openai']}`}
          onCancel={() => setEditingId(null)}
        >
          <ProviderEditor
            initial={draftFromConn(editingConn)}
            onCancel={() => setEditingId(null)}
            onSave={async (d) => {
              await connectionStore.update(editingConn.id, draftToRow(d));
              setEditingId(null);
              reload();
            }}
          />
        </EditorFrame>
      )}

      {/* Empty state */}
      {connections.length === 0 && !adding && (
        <S.Card style={{ paddingTop: 56, paddingBottom: 56 }}>
          <Box style={{
            alignItems: 'center', justifyContent: 'center', gap: 12,
          }}>
            <Box style={{
              width: 64, height: 64, borderRadius: 32,
              backgroundColor: 'theme:bg2',
              borderWidth: 1, borderColor: 'theme:rule',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon icon={Cloud} size={28} color="theme:inkDim" strokeWidth={1.6} />
            </Box>
            <S.Heading>No providers yet</S.Heading>
            <S.BodyDim>Add a credential + endpoint to get started.</S.BodyDim>
          </Box>
        </S.Card>
      )}

      {/* Provider list — single card with dividers */}
      {visibleRows.length > 0 && (
        <S.Card style={{ paddingTop: 18, paddingBottom: 18, paddingLeft: 22, paddingRight: 22 }}>
          {visibleRows.map((c: any, idx: number) => (
            <Box key={c.id} style={{ flexDirection: 'column' }}>
              {idx > 0 && <Box style={{
                height: 1, backgroundColor: 'theme:rule',
                marginTop: 16, marginBottom: 16,
              }} />}
              <ProviderRow
                conn={c}
                onEdit={() => { setEditingId(c.id); setAdding(false); }}
                onDelete={async () => {
                  await connectionStore.delete(c.id);
                  reload();
                }}
              />
            </Box>
          ))}
        </S.Card>
      )}
    </Section>
  );
}
