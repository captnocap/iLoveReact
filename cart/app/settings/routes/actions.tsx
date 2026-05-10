// Actions route — bind app roles to specific models from the registry.
//
// Each role declares a required modality. The picker only lists models
// whose modality matches. Selections persist on the singleton settings
// row at `actionDefaults[<roleId>]`.

import { useState } from 'react';
import { Box, Pressable } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { Icon } from '@reactjit/runtime/icons/Icon';
import { Check, X, ChevronDown, Clock, GitCommit, Save } from '@reactjit/runtime/icons/icons';
import { ProviderIcon } from '../../gallery/components/model-card/ProviderIcon';
import { PROVIDER_ICONS } from '../../gallery/components/model-card/providerIcons.generated';
import { Section, SETTINGS_ID } from '../shared';
import { useSettingsCtx } from '../page';
import { lookupModel, MODALITY_LABEL, type Modality } from '../lib/modelRegistry';

type Role = {
  id: string;
  label: string;
  description: string;
  modality: Modality;
};

const ROLES: Role[] = [
  { id: 'assistant',       label: 'Assistant',         description: 'Main chat',                  modality: 'text' },
  { id: 'supervisor',      label: 'Supervisor',        description: 'Planning / orchestration',   modality: 'text' },
  { id: 'embedding',       label: 'Embedding',         description: 'Vectorize for search & RAG', modality: 'embed' },
  { id: 'memory',          label: 'Memory',            description: 'Summarize / recall history', modality: 'text' },
  { id: 'titleGen',        label: 'Title generation',  description: 'Auto-name new threads',      modality: 'text' },
  { id: 'voiceTranscribe', label: 'Voice transcribe',  description: 'Speech → text',              modality: 'voice' },
  { id: 'voiceSpeak',      label: 'Voice speak',       description: 'Text → speech',              modality: 'tts' },
  { id: 'imageGen',        label: 'Image generation',  description: 'Generate images',            modality: 'image' },
];

function modelLabel(m: any): string {
  return m?.displayName || m?.remoteId || '(unknown)';
}

// ─── Schedules ───────────────────────────────────────────────────────
//
// A schedule binds a recurring "action" (memory writing, embedding, …) to
// a "trigger" (interval / event). The runtime sweeper consumes
// settings.schedules[<actionId>] = { enabled, trigger }. When the action
// fires it uses the model from actionDefaults[<sameActionId>] when one
// exists.

type Trigger =
  | { kind: 'interval'; everyMs: number }
  | { kind: 'event'; name: string };

type ScheduleAction = {
  id: string;
  label: string;
  description: string;
  defaultTrigger: Trigger;
};

const SCHEDULABLE_ACTIONS: ScheduleAction[] = [
  {
    id: 'memoryWrite',
    label: 'Memory writing',
    description: 'Summarize recent activity and append to long-term memory',
    defaultTrigger: { kind: 'interval', everyMs: 60 * 60 * 1000 },
  },
  {
    id: 'embedding',
    label: 'Embedding',
    description: 'Vectorize new files / messages for search & RAG',
    defaultTrigger: { kind: 'event', name: 'commit' },
  },
];

type TriggerPreset = { id: string; label: string; trigger: Trigger; icon: number[][] };

const TRIGGER_PRESETS: TriggerPreset[] = [
  { id: 'i5m',    label: 'Every 5 minutes',  icon: Clock,     trigger: { kind: 'interval', everyMs: 5 * 60 * 1000 } },
  { id: 'i15m',   label: 'Every 15 minutes', icon: Clock,     trigger: { kind: 'interval', everyMs: 15 * 60 * 1000 } },
  { id: 'i1h',    label: 'Every hour',       icon: Clock,     trigger: { kind: 'interval', everyMs: 60 * 60 * 1000 } },
  { id: 'i6h',    label: 'Every 6 hours',    icon: Clock,     trigger: { kind: 'interval', everyMs: 6 * 60 * 60 * 1000 } },
  { id: 'i1d',    label: 'Every day',        icon: Clock,     trigger: { kind: 'interval', everyMs: 24 * 60 * 60 * 1000 } },
  { id: 'eCommit',label: 'On commit',        icon: GitCommit, trigger: { kind: 'event',    name: 'commit' } },
  { id: 'eSave',  label: 'On file save',     icon: Save,      trigger: { kind: 'event',    name: 'fileSave' } },
];

function triggerKey(t: Trigger): string {
  return t.kind === 'interval' ? `i:${t.everyMs}` : `e:${t.name}`;
}

function triggerLabel(t: Trigger): string {
  const hit = TRIGGER_PRESETS.find((p) => triggerKey(p.trigger) === triggerKey(t));
  if (hit) return hit.label;
  if (t.kind === 'interval') return `Every ${Math.round(t.everyMs / 60000)} min`;
  return `On ${t.name}`;
}

function triggerIcon(t: Trigger): number[][] {
  const hit = TRIGGER_PRESETS.find((p) => triggerKey(p.trigger) === triggerKey(t));
  return hit?.icon || (t.kind === 'event' ? GitCommit : Clock);
}

// Mirror models.tsx — registry-derived lab icon wins over the connection
// icon, so each model wears its own brand (Meta llama in an LMStudio conn
// shows the Meta logo, not the LMStudio one).
function effectiveIconId(m: any, conn: any): string | undefined {
  const hit = m ? lookupModel(m.remoteId) : null;
  if (hit?.iconId && PROVIDER_ICONS[hit.iconId]) return hit.iconId;
  return conn?.iconId;
}

type ScheduleState = { enabled: boolean; trigger: Trigger };

export default function ActionsRoute() {
  const { settings, models, connections, settingsStore, reload } = useSettingsCtx();
  const bindings: Record<string, string> = settings?.actionDefaults || {};
  const schedules: Record<string, ScheduleState> = settings?.schedules || {};
  const [openRoleId, setOpenRoleId] = useState<string | null>(null);
  const [openSchedId, setOpenSchedId] = useState<string | null>(null);

  const writeSettings = async (patch: Record<string, any>) => {
    if (settings) {
      await settingsStore.update(SETTINGS_ID, { ...settings, ...patch });
    } else {
      await settingsStore.create({ id: SETTINGS_ID, ...patch } as any);
    }
    reload();
  };

  const setBinding = async (roleId: string, modelId: string | null) => {
    const next = { ...(settings?.actionDefaults || {}) };
    if (modelId) next[roleId] = modelId;
    else delete next[roleId];
    setOpenRoleId(null);
    await writeSettings({ actionDefaults: next });
  };

  const setSchedule = async (actionId: string, patch: Partial<ScheduleState>) => {
    const cur = schedules[actionId] || {
      enabled: false,
      trigger: SCHEDULABLE_ACTIONS.find((a) => a.id === actionId)?.defaultTrigger
        ?? { kind: 'interval', everyMs: 60 * 60 * 1000 },
    };
    const next = { ...schedules, [actionId]: { ...cur, ...patch } };
    setOpenSchedId(null);
    await writeSettings({ schedules: next });
  };

  const connFor = (cid: string) => connections.find((c: any) => c.id === cid);

  return (
    <Box style={{ flexDirection: 'column', gap: 32 }}>
    <Section caption="Defaults" title="Actions">
      <S.BodyDim>
        Bind each role to a specific model. Picking a role lists every model whose modality
        matches. Roles without a binding fall back to the first compatible model at runtime.
      </S.BodyDim>

      <S.Card>
        <Box style={{ flexDirection: 'column' }}>
          {ROLES.map((r, idx) => {
            const bound = bindings[r.id];
            const m = bound ? models.find((mm: any) => mm.id === bound) : null;
            const matching = models.filter((mm: any) => mm.modality === r.modality);
            const isOpen = openRoleId === r.id;
            const conn = m ? connFor(m.connectionId) : null;
            return (
              <Box key={r.id} style={{
                flexDirection: 'column', gap: 10,
                paddingTop: idx === 0 ? 0 : 14,
                paddingBottom: 14,
                borderBottomWidth: idx === ROLES.length - 1 ? 0 : 1,
                borderBottomColor: 'theme:rule',
                // Hoist the entire row above sibling rows when its picker is
                // open. paintChildrenInZOrder only re-sorts within one parent —
                // a high zIndex on just the picker doesn't outpaint the next
                // role row's subtree, which is why the picker bled-through.
                zIndex: isOpen ? 999 : 0,
              }}>
                {/* Row header — label + current binding + pick + clear */}
                <Box style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                  <Box style={{ flexGrow: 1, flexShrink: 1, flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <S.Subheading>{r.label}</S.Subheading>
                    <S.Caption>{r.description} · {MODALITY_LABEL[r.modality]}</S.Caption>
                  </Box>

                  <Box style={{ flexDirection: 'row', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                    {/* Trigger + picker share an anchor Box so the picker can
                        position: absolute against the trigger and overlay
                        whatever sits below this row, instead of inflating the
                        flex layout and pushing later rows down. The framework
                        treats non-zero zIndex as a paint pass with a fresh
                        full-viewport scissor (engine.zig:1663) — same trick
                        useContextMenu uses. */}
                    <Box style={{ flexDirection: 'column', flexShrink: 0 }}>
                      <Pressable onPress={() => setOpenRoleId(isOpen ? null : r.id)}>
                        <Box style={{
                          flexDirection: 'row', alignItems: 'center', gap: 8,
                          paddingLeft: 14, paddingRight: 16, paddingTop: 9, paddingBottom: 9,
                          borderRadius: 'theme:radiusMd',
                          borderWidth: 1, borderColor: 'theme:rule',
                          backgroundColor: 'theme:bg2',
                          width: 280,
                        }}>
                          {(() => {
                            const iid = effectiveIconId(m, conn);
                            return iid && PROVIDER_ICONS[iid]
                              ? <ProviderIcon providerId={iid} size={18} />
                              : <Box style={{ width: 18, height: 18, flexShrink: 0 }} />;
                          })()}
                          <Box style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                            <S.ButtonOutlineLabel noWrap>
                              {m ? modelLabel(m) : '— pick a model —'}
                            </S.ButtonOutlineLabel>
                          </Box>
                          <Icon icon={ChevronDown} size={13} color="theme:inkDim" strokeWidth={2} />
                        </Box>
                      </Pressable>

                      {/* Click-outside backdrop — full-viewport Pressable
                          beneath the picker. Style goes on the Pressable
                          itself (not a child Box) so its hit-test bounds
                          actually cover the viewport — wrapping a Box in a
                          Pressable collapses the Pressable to 0×0 because
                          the absolute child contributes nothing to its
                          parent's intrinsic size. */}
                      {isOpen && (
                        <Pressable onPress={() => setOpenRoleId(null)} style={{
                          position: 'absolute',
                          top: -10000, left: -10000,
                          width: 100000, height: 100000,
                          zIndex: 998,
                        }} />
                      )}

                      {/* Expanded picker — absolute overlay anchored under the
                          trigger. The picker itself is the scroll container
                          (overflow:scroll + bounded height) — no nested
                          ScrollView needed. The inner Box just lays the
                          items out and grows past the picker's height; the
                          picker clips and scrolls. */}
                      {isOpen && (
                        <Box style={{
                          position: 'absolute',
                          top: 44, right: 0,
                          zIndex: 999,
                          width: 280,
                          flexDirection: 'column',
                          paddingTop: 6, paddingBottom: 6,
                          paddingLeft: 6, paddingRight: 6,
                          borderRadius: 'theme:radiusMd',
                          backgroundColor: 'theme:bg2',
                          borderWidth: 1, borderColor: 'theme:rule',
                          height: 320,
                          overflow: 'scroll',
                        }}>
                          {matching.length === 0 ? (
                            <Box style={{ paddingTop: 12, paddingBottom: 12, paddingLeft: 8, paddingRight: 8 }}>
                              <S.BodyDim>
                                No {MODALITY_LABEL[r.modality].toLowerCase()} models available.
                                Add a provider, then refetch in Models.
                              </S.BodyDim>
                            </Box>
                          ) : (
                            <Box style={{ flexDirection: 'column', gap: 2, paddingTop: 4, paddingBottom: 4 }}>
                              {matching.map((opt: any) => {
                                const isSelected = opt.id === bound;
                                const optConn = connFor(opt.connectionId);
                                return (
                                  <Pressable key={opt.id} onPress={() => setBinding(r.id, opt.id)}>
                                    <Box style={{
                                      flexDirection: 'row', gap: 10, alignItems: 'center',
                                      paddingTop: 8, paddingBottom: 8,
                                      paddingLeft: 10, paddingRight: 10,
                                      borderRadius: 6,
                                      backgroundColor: isSelected ? 'theme:bg1' : 'transparent',
                                      borderWidth: 1, borderColor: isSelected ? 'theme:accent' : 'transparent',
                                    }}>
                                      <Box style={{ width: 14, alignItems: 'center' }}>
                                        {isSelected && <Icon icon={Check} size={12} color="theme:accent" strokeWidth={2} />}
                                      </Box>
                                      {(() => {
                                        const iid = effectiveIconId(opt, optConn);
                                        return iid && PROVIDER_ICONS[iid]
                                          ? <ProviderIcon providerId={iid} size={20} />
                                          : <Box style={{ width: 20, height: 20 }} />;
                                      })()}
                                      <Box style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, flexDirection: 'column', gap: 2 }}>
                                        <S.Body noWrap>{modelLabel(opt)}</S.Body>
                                        <S.Caption noWrap>{optConn?.label || opt.connectionId}</S.Caption>
                                      </Box>
                                    </Box>
                                  </Pressable>
                                );
                              })}
                            </Box>
                          )}
                        </Box>
                      )}
                    </Box>

                    {m && (
                      <Pressable onPress={() => setBinding(r.id, null)} tooltip="Clear binding">
                        <Box style={{
                          flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                          width: 36, height: 36,
                          borderRadius: 'theme:radiusMd',
                          borderWidth: 1, borderColor: 'theme:rule',
                          backgroundColor: 'theme:bg2',
                        }}>
                          <Icon icon={X} size={13} color="theme:inkDim" strokeWidth={2} />
                        </Box>
                      </Pressable>
                    )}
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      </S.Card>
    </Section>

    <Section caption="Recurring" title="Schedules">
      <S.BodyDim>
        Run an action on a fixed interval or in response to an event. The action's
        model is read from the binding above when it fires.
      </S.BodyDim>

      <S.Card>
        <Box style={{ flexDirection: 'column' }}>
          {SCHEDULABLE_ACTIONS.map((a, idx) => {
            const sched = schedules[a.id];
            const enabled = !!sched?.enabled;
            const trigger = sched?.trigger || a.defaultTrigger;
            const isOpen = openSchedId === a.id;
            const TIcon = triggerIcon(trigger);
            return (
              <Box key={a.id} style={{
                flexDirection: 'column', gap: 10,
                paddingTop: idx === 0 ? 0 : 14,
                paddingBottom: 14,
                borderBottomWidth: idx === SCHEDULABLE_ACTIONS.length - 1 ? 0 : 1,
                borderBottomColor: 'theme:rule',
              }}>
                <Box style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                  <Box style={{ flexGrow: 1, flexShrink: 1, flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <S.Subheading>{a.label}</S.Subheading>
                    <S.Caption>{a.description}</S.Caption>
                  </Box>

                  <Box style={{ flexDirection: 'row', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                    {/* Trigger pill — opens preset picker */}
                    <Pressable onPress={() => setOpenSchedId(isOpen ? null : a.id)}>
                      <Box style={{
                        flexDirection: 'row', alignItems: 'center', gap: 8,
                        paddingLeft: 14, paddingRight: 16, paddingTop: 9, paddingBottom: 9,
                        borderRadius: 'theme:radiusMd',
                        borderWidth: 1, borderColor: 'theme:rule',
                        backgroundColor: 'theme:bg2',
                        width: 220,
                      }}>
                        <Icon icon={TIcon} size={14} color="theme:inkDim" strokeWidth={2} />
                        <Box style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                          <S.ButtonOutlineLabel noWrap>{triggerLabel(trigger)}</S.ButtonOutlineLabel>
                        </Box>
                        <Icon icon={ChevronDown} size={13} color="theme:inkDim" strokeWidth={2} />
                      </Box>
                    </Pressable>

                    {/* Enable toggle — uses the existing TraitChip atoms */}
                    {enabled ? (
                      <S.AppTraitChipActive onPress={() => setSchedule(a.id, { enabled: false })}>
                        <S.AppTraitChipTextActive>On</S.AppTraitChipTextActive>
                      </S.AppTraitChipActive>
                    ) : (
                      <S.AppTraitChip onPress={() => setSchedule(a.id, { enabled: true })}>
                        <S.AppTraitChipText>Off</S.AppTraitChipText>
                      </S.AppTraitChip>
                    )}
                  </Box>
                </Box>

                {isOpen && (
                  <Box style={{
                    flexDirection: 'column',
                    paddingTop: 6, paddingBottom: 6,
                    paddingLeft: 6, paddingRight: 6,
                    borderRadius: 'theme:radiusMd',
                    backgroundColor: 'theme:bg2',
                    borderWidth: 1, borderColor: 'theme:rule',
                  }}>
                    <Box style={{ flexDirection: 'column', gap: 2, paddingTop: 4, paddingBottom: 4 }}>
                      {TRIGGER_PRESETS.map((p) => {
                        const isSelected = triggerKey(p.trigger) === triggerKey(trigger);
                        return (
                          <Pressable key={p.id} onPress={() => setSchedule(a.id, { trigger: p.trigger })}>
                            <Box style={{
                              flexDirection: 'row', gap: 10, alignItems: 'center',
                              paddingTop: 8, paddingBottom: 8,
                              paddingLeft: 10, paddingRight: 10,
                              borderRadius: 6,
                              backgroundColor: isSelected ? 'theme:bg1' : 'transparent',
                              borderWidth: 1, borderColor: isSelected ? 'theme:accent' : 'transparent',
                            }}>
                              <Box style={{ width: 14, alignItems: 'center' }}>
                                {isSelected && <Icon icon={Check} size={12} color="theme:accent" strokeWidth={2} />}
                              </Box>
                              <Icon icon={p.icon} size={14} color="theme:inkDim" strokeWidth={2} />
                              <Box style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                                <S.Body noWrap>{p.label}</S.Body>
                              </Box>
                            </Box>
                          </Pressable>
                        );
                      })}
                    </Box>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </S.Card>
    </Section>
    </Box>
  );
}
