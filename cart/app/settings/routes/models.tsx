// Models route — unified registry across all providers and modalities.
//
// Fetch flow (see lib/fetch.ts):
//   1. fetchModelsFor(conn) → live list from provider
//   2. upsertRows(store, rows) → create new, refresh lastSeen on existing
//      while preserving user-edited favorite + displayName.
//
// The route never deletes a model row that disappeared from a provider's
// list (could be a temporary outage). Stale rows just stop getting their
// lastSeenIso bumped — the UI shows that age so the user can decide.
//
// Schema (option A — materialized):
//   id:           '<connectionId>:<remoteId>'
//   connectionId: string
//   remoteId:     string
//   displayName:  string                 // user-overridable
//   modality:     'text'|'embed'|'voice'|'image'|'tts'
//   contextLength?: number
//   favorite:     boolean
//   custom:       boolean
//   lastSeenIso:  string
//   source:       'remote-list'|'gguf-walk'|'manual'

import { useMemo, useState } from 'react';
import { Box, Pressable, StaticSurface } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { Icon } from '@reactjit/runtime/icons/Icon';
import {
  Eye, Brain, Wrench, Globe, Code, FileText,
  Star, RefreshCw, Pencil,
} from '@reactjit/runtime/icons/icons';
import { ProviderIcon } from '../../gallery/components/model-card/ProviderIcon';
import { PROVIDER_ICONS } from '../../gallery/components/model-card/providerIcons.generated';
import { Section, Field, Input, PillRow } from '../shared';
import { useSettingsCtx } from '../page';
import { fetchModelsFor, upsertRows, type Modality, type ModelRow } from '../lib/fetch';
import {
  lookupModel,
  ALL_CAPABILITIES,
  ALL_MODALITIES,
  MODALITY_LABEL,
  type Capability,
  type RegistryHit,
} from '../lib/modelRegistry';
import {
  effortLevelsFor,
  latestOpusId,
  supports1M,
} from '../../claude-models';

const ALL_CAPS: Capability[] = ALL_CAPABILITIES;

const CAP_CONFIG: Record<Capability, { icon: number[][]; color: string; label: string; hint: string }> = {
  vision:    { icon: Eye,      color: 'theme:tool',  label: 'Vision',    hint: 'Image input' },
  reasoning: { icon: Brain,    color: 'theme:lilac', label: 'Reasoning', hint: 'Extended thinking' },
  tools:     { icon: Wrench,   color: 'theme:warn',  label: 'Tools',     hint: 'Function calling' },
  search:    { icon: Globe,    color: 'theme:ok',    label: 'Search',    hint: 'Web access' },
  code:      { icon: Code,     color: 'theme:blue',  label: 'Code',      hint: 'Code generation' },
  files:     { icon: FileText, color: 'theme:atch',  label: 'Files',     hint: 'File analysis' },
};

// Fallback heuristic for capabilities of UNKNOWN (registry-miss) models.
// Registry hits never reach this — their capabilities are lab-defined.
function inferCaps(remoteId: string, modality: Modality): Capability[] {
  if (modality !== 'text') return [];
  const s = remoteId.toLowerCase();
  const caps = new Set<Capability>(['tools']);
  if (/(vision|vl|visual|4o|gpt-4|claude-3|claude-4|opus|sonnet|gemini|llava|pixtral)/.test(s)) caps.add('vision');
  if (/(o1|o3|o4|reasoner|thinking|reason|qwq|deepseek-r|grok-3)/.test(s)) caps.add('reasoning');
  if (/(claude|opus|sonnet|haiku|gpt-4|gpt-5|gemini|grok|deepseek-coder|coder)/.test(s)) caps.add('code');
  if (/(perplexity|sonar|search|web|browse)/.test(s)) caps.add('search');
  return Array.from(caps);
}

function capsOf(m: ModelRow, hit: RegistryHit | null): Capability[] {
  if (hit?.capabilities) return hit.capabilities;
  const v = (m as any).capabilities;
  if (Array.isArray(v)) return v.filter((c: any): c is Capability => ALL_CAPS.includes(c));
  return inferCaps(m.remoteId, m.modality);
}

const MODALITIES: Modality[] = ALL_MODALITIES;

type FetchState = { status: 'idle' | 'busy' | 'ok' | 'fail'; message: string };
const IDLE: FetchState = { status: 'idle', message: '' };

function fmtAge(iso: string): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ─── Capability toggle button ────────────────────────────────────────

function CapabilityButton({ cap, active, onToggle }: {
  cap: Capability; active: boolean; onToggle: () => void;
}) {
  const cfg = CAP_CONFIG[cap];
  return (
    <Pressable onPress={onToggle} tooltip={`${cfg.label} — ${cfg.hint}${active ? ' (on)' : ' (off)'}`}>
      <Box style={{
        width: 26, height: 26,
        borderRadius: 6,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? 'theme:bg2' : 'theme:bg1',
        borderWidth: 1,
        borderColor: active ? cfg.color : 'theme:rule',
        opacity: active ? 1 : 0.45,
      }}>
        <Icon icon={cfg.icon} size={13} color={active ? cfg.color : 'theme:inkDim'} strokeWidth={2} />
      </Box>
    </Pressable>
  );
}

// Inert capability badge for registry-defined models. Same visual
// affordance as the active CapabilityButton minus the toggle — the
// tooltip explains why it can't be unset.
function LockedCapabilityBadge({ cap, labLabel }: { cap: Capability; labLabel: string }) {
  const cfg = CAP_CONFIG[cap];
  return (
    <Pressable onPress={() => {}} tooltip={`${cfg.label} — ${cfg.hint} · defined by ${labLabel}`}>
      <Box style={{
        width: 26, height: 26,
        borderRadius: 6,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'theme:bg1',
        borderWidth: 1, borderColor: cfg.color,
      }}>
        <Icon icon={cfg.icon} size={13} color={cfg.color} strokeWidth={2} />
      </Box>
    </Pressable>
  );
}

// Combined "type · context-window options" pill. For Anthropic 1M-capable
// families we surface the alternate 200k context (you select via the
// Anthropic API header), so a single Claude Opus 4.7 row reads
// "Text · 200k / 1M" without needing two rows.
function TypeContextBadge({
  mod, ctxLabel, tooltip,
}: { mod: Modality; ctxLabel: string; tooltip: string }) {
  return (
    <Pressable onPress={() => {}} tooltip={tooltip}>
      <Box style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        alignSelf: 'flex-start',
        paddingLeft: 10, paddingRight: 12, paddingTop: 4, paddingBottom: 4,
        borderRadius: 999,
        backgroundColor: 'theme:bg1',
        borderWidth: 1, borderColor: 'theme:rule',
      }}>
        <S.Caption>{MODALITY_LABEL[mod]}</S.Caption>
        {ctxLabel ? (
          <>
            <S.Caption>·</S.Caption>
            <S.Caption>{ctxLabel}</S.Caption>
          </>
        ) : null}
      </Box>
    </Pressable>
  );
}

// One inert effort tier badge. Effort tiers come from
// claude-models.effortLevelsFor — currently Anthropic-only (Sonnet/Opus
// via API or Claude Code CLI). The codex-cli connection kind is wired,
// but effortLevelsFor doesn't yet cover gpt-5-codex variants — extend
// it (or add a parallel helper) when Codex effort tiers should render.
function EffortBadge({ level }: { level: string }) {
  return (
    <Pressable onPress={() => {}} tooltip={`Effort tier: ${level}`}>
      <Box style={{
        paddingLeft: 8, paddingRight: 9, paddingTop: 3, paddingBottom: 3,
        borderRadius: 4,
        backgroundColor: 'theme:bg1',
        borderWidth: 1, borderColor: 'theme:rule',
      }}>
        <S.Caption>{level}</S.Caption>
      </Box>
    </Pressable>
  );
}

// ─── Model card ──────────────────────────────────────────────────────

function fmtCtx(n?: number): string {
  if (!n) return '';
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return m === Math.floor(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  return `${Math.round(n / 1000)}k`;
}

// Cap a string to fit visually in the 212px text column inside the model
// card. Long .gguf paths or unbroken model ids would otherwise blow out the
// flex box (the text engine doesn't break inside a non-whitespace token).
function clip(s: string, max: number): string {
  if (!s) return '';
  // Path-shaped ids: drop the directory, keep the filename. Every gguf in a
  // folder shares the prefix, so the prefix is noise.
  const slash = s.lastIndexOf('/');
  const visible = slash >= 0 ? s.slice(slash + 1) : s;
  if (visible.length <= max) return visible;
  return `${visible.slice(0, max - 1)}…`;
}

// Build the "200k / 1M" label for the type+context badge. Anthropic
// Opus/Sonnet expose both 200k (default) and 1M (header opt-in), so we
// surface that pair when the family supports it. Everything else is a
// single number from the registry (or the fetched value).
function ctxLabel(hit: RegistryHit | null, m: ModelRow): string {
  const ctx = hit?.contextLength ?? m.contextLength;
  if (!ctx) return '';
  if (hit?.lab === 'anthropic' && supports1M(m.remoteId) && ctx >= 1_000_000) {
    return `200k / ${fmtCtx(ctx)}`;
  }
  return fmtCtx(ctx);
}

function ModelCard({
  m, providerIconId, connectionLabel, opusLatestId,
  onToggleFav, onRename, onChangeModality, onToggleCap,
}: {
  m: ModelRow;
  providerIconId?: string;
  connectionLabel: string;
  opusLatestId: string | null;
  onToggleFav: () => void;
  onRename: (next: string) => void;
  onChangeModality: (next: Modality) => void;
  onToggleCap: (cap: Capability) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.displayName);

  // Registry hit decides icon + locks modality/capabilities/ctx.
  // Connection iconId is the fallback (e.g., for unrecognised local
  // .gguf files, custom proprietary endpoints, brand-new models the
  // registry doesn't know yet).
  const hit = useMemo(() => lookupModel(m.remoteId), [m.remoteId]);
  const effectiveIcon = (hit?.iconId && PROVIDER_ICONS[hit.iconId]) ? hit.iconId : providerIconId;
  const effectiveMod: Modality = hit?.modality ?? m.modality;
  const caps = capsOf(m, hit);

  const isText = effectiveMod === 'text';
  const modalityLocked = !!hit;
  const capsLocked = !!hit?.capabilities;

  // Effort tiers — currently only Anthropic Sonnet/Opus expose them.
  // Returns [] for Haiku, non-Claude, or registry-miss rows; in all
  // those cases the effort row simply doesn't render.
  const efforts = useMemo(
    () => effortLevelsFor(m.remoteId, opusLatestId),
    [m.remoteId, opusLatestId],
  );

  const ctx = ctxLabel(hit, m);
  const ctxTooltip = hit?.contextLength
    ? `Modality: ${MODALITY_LABEL[effectiveMod]} · context window: ${ctx} (defined by ${hit.labLabel})`
    : `Modality: ${MODALITY_LABEL[effectiveMod]}${ctx ? ` · context window: ${ctx}` : ''}`;

  return (
    // StaticSurface = the outer flex-item; participates in the wrap row's
    // sizing/positioning. Visual styling (bg/border/padding/gap) lives on
    // the inner Box so it gets painted INTO the cached texture, not onto
    // the texture-quad host that just composites it.
    <StaticSurface staticKey={`model:${m.id}`} style={{
      width: 240, maxWidth: 240,
      flexShrink: 0, flexGrow: 0,
    }}>
      <Box style={{
        flexGrow: 1,
        flexDirection: 'column',
        paddingTop: 12, paddingBottom: 12, paddingLeft: 14, paddingRight: 14,
        gap: 8,
        borderRadius: 'theme:radiusLg',
        borderWidth: 1, borderColor: m.favorite ? 'theme:accent' : 'theme:rule',
        backgroundColor: 'theme:bg2',
        overflow: 'hidden',
      }}>
      {/* Row 1 — icon | name+from | star */}
      <Box style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        {effectiveIcon && PROVIDER_ICONS[effectiveIcon] ? (
          <ProviderIcon providerId={effectiveIcon} size={32} />
        ) : hit ? (
          // Lab without an icon yet — show the first letter so the
          // user still sees who built it.
          <Box style={{
            width: 32, height: 32, borderRadius: 8,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'theme:paper',
            borderWidth: 1, borderColor: 'theme:rule',
          }}>
            <S.Subheading>{(hit.labLabel[0] || '?').toUpperCase()}</S.Subheading>
          </Box>
        ) : (
          <Box style={{
            width: 32, height: 32, borderRadius: 8,
            backgroundColor: 'theme:bg1',
            borderWidth: 1, borderColor: 'theme:rule',
          }} />
        )}

        {/* Name + "from {connection}" subline. */}
        <Box style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, flexDirection: 'column', gap: 2 }}>
          {editing ? (
            <Box style={{ flexDirection: 'column', gap: 6 }}>
              <Input value={draft} onChange={setDraft} placeholder={m.remoteId} />
              <Box style={{ flexDirection: 'row', gap: 6 }}>
                <S.Button onPress={() => { onRename(draft.trim() || m.remoteId); setEditing(false); }}>
                  <S.ButtonLabel>Save</S.ButtonLabel>
                </S.Button>
                <S.ButtonOutline onPress={() => { setDraft(m.displayName); setEditing(false); }}>
                  <S.ButtonOutlineLabel>Cancel</S.ButtonOutlineLabel>
                </S.ButtonOutline>
              </Box>
            </Box>
          ) : (
            <>
              <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Box style={{ flexShrink: 1, minWidth: 0 }}>
                  <S.Subheading noWrap>{clip(m.displayName, 20)}</S.Subheading>
                </Box>
                <Pressable
                  onPress={() => { setDraft(m.displayName); setEditing(true); }}
                  tooltip={`Rename · current: ${m.displayName}`}
                >
                  <Icon icon={Pencil} size={10} color="theme:inkDim" strokeWidth={2} />
                </Pressable>
              </Box>
              <S.Caption noWrap>from {connectionLabel}</S.Caption>
            </>
          )}
        </Box>

        <Pressable onPress={onToggleFav} tooltip={m.favorite ? 'Unfavorite' : 'Favorite'}>
          <Box style={{
            width: 26, height: 26, borderRadius: 13,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'theme:bg1',
          }}>
            <Icon
              icon={Star}
              size={13}
              color={m.favorite ? 'theme:accent' : 'theme:inkDim'}
              strokeWidth={m.favorite ? 2.4 : 1.8}
            />
          </Box>
        </Pressable>
      </Box>

      {/* Row 2 — type + context badge for known models, or PillRow for
          unknown rows where the user might need to fix the modality. */}
      {modalityLocked ? (
        <TypeContextBadge mod={effectiveMod} ctxLabel={ctx} tooltip={ctxTooltip} />
      ) : (
        <PillRow<Modality>
          options={MODALITIES}
          labels={MODALITY_LABEL}
          value={m.modality}
          onChange={onChangeModality}
        />
      )}

      {/* Row 3 — effort tiers. Only renders for Anthropic Sonnet/Opus
          today (Haiku has none, non-Claude returns []). */}
      {efforts.length > 0 && (
        <Box style={{ flexDirection: 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {efforts.map((lvl) => <EffortBadge key={lvl} level={lvl} />)}
        </Box>
      )}

      {/* Row 4 — capabilities. Locked → only the active ones as inert
          badges. Unlocked → the full toggle row so the user can fix
          mis-inferred capabilities for unknown models. */}
      {isText && (capsLocked ? (
        caps.length > 0 && (
          <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {caps.map((c) => (
              <LockedCapabilityBadge key={c} cap={c} labLabel={hit!.labLabel} />
            ))}
          </Box>
        )
      ) : (
        <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {ALL_CAPS.map((c) => (
            <CapabilityButton
              key={c}
              cap={c}
              active={caps.includes(c)}
              onToggle={() => onToggleCap(c)}
            />
          ))}
        </Box>
      ))}
      </Box>
    </StaticSurface>
  );
}

// ─── Per-provider section ────────────────────────────────────────────

function ProviderModelsBlock({ conn, modelsForConn, onRefetch, fetching }: {
  conn: any;
  modelsForConn: ModelRow[];
  onRefetch: () => void;
  fetching: FetchState;
}) {
  const grouped = useMemo(() => {
    const g: Partial<Record<Modality, ModelRow[]>> = {};
    for (const m of modelsForConn) (g[m.modality] ||= []).push(m);
    for (const k of Object.keys(g) as Modality[]) {
      g[k]!.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.displayName.localeCompare(b.displayName));
    }
    return g;
  }, [modelsForConn]);

  // Per-connection latest-Opus id — only that one gets `xhigh`. We
  // recompute when the model list changes (refetch). Returns null when
  // the connection isn't Anthropic-shaped, which is harmless: effort
  // tiers default to the non-latest set in that case.
  const opusLatestId = useMemo(
    () => latestOpusId(modelsForConn.map((m) => m.remoteId)),
    [modelsForConn],
  );

  const connLabel: string = conn.label || conn.id;

  const { modelStore, reload } = useSettingsCtx();

  const updateRow = async (m: ModelRow, patch: Partial<ModelRow>) => {
    await modelStore.update(m.id, { ...m, ...patch });
    reload();
  };

  const toggleCap = async (m: ModelRow, cap: Capability) => {
    const hit = lookupModel(m.remoteId);
    // Registry hits are authoritative — ignore stray toggle attempts.
    if (hit?.capabilities) return;
    const cur = capsOf(m, hit);
    const next = cur.includes(cap) ? cur.filter((c) => c !== cap) : [...cur, cap];
    await updateRow(m, { capabilities: next } as any);
  };

  const changeModality = (m: ModelRow, next: Modality) => {
    if (lookupModel(m.remoteId)) return; // locked by registry
    updateRow(m, { modality: next });
  };

  return (
    <S.Card>
      <Box style={{ flexDirection: 'column', gap: 16 }}>
        {/* Provider header */}
        <Box style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          {conn.iconId && PROVIDER_ICONS[conn.iconId] ? (
            <ProviderIcon providerId={conn.iconId} size={40} />
          ) : null}
          <Box style={{ flexGrow: 1, flexDirection: 'column', gap: 2 }}>
            <S.Heading>{conn.label || conn.id}</S.Heading>
            <S.BodyDim>{modelsForConn.length} model{modelsForConn.length === 1 ? '' : 's'}</S.BodyDim>
          </Box>
          <Pressable onPress={fetching.status === 'busy' ? () => {} : onRefetch}>
            <Box style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              paddingLeft: 14, paddingRight: 16, paddingTop: 9, paddingBottom: 9,
              borderRadius: 'theme:radiusMd',
              borderWidth: 1, borderColor: 'theme:rule',
              backgroundColor: 'theme:bg2',
            }}>
              <Icon icon={RefreshCw} size={13} color="theme:ink" strokeWidth={2} />
              <S.ButtonOutlineLabel>{fetching.status === 'busy' ? 'Fetching…' : 'Refetch'}</S.ButtonOutlineLabel>
            </Box>
          </Pressable>
        </Box>

        {fetching.status === 'fail' && (
          <S.AppProbeResult>
            <S.AppProbeFail>Fetch failed</S.AppProbeFail>
            <S.AppProbeMessage>{fetching.message}</S.AppProbeMessage>
          </S.AppProbeResult>
        )}
        {fetching.status === 'ok' && (
          <S.AppProbeResult>
            <S.AppProbeOk>{fetching.message}</S.AppProbeOk>
          </S.AppProbeResult>
        )}

        {modelsForConn.length === 0 && fetching.status !== 'busy' && (
          <S.BodyDim>No models yet — click Refetch to pull the live list.</S.BodyDim>
        )}

        {MODALITIES.map((mod) => {
          const rows = grouped[mod] || [];
          if (rows.length === 0) return null;
          return (
            <Box key={mod} style={{ flexDirection: 'column', gap: 10 }}>
              <S.Label>{MODALITY_LABEL[mod].toUpperCase()}</S.Label>
              <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {rows.map((m) => (
                  <ModelCard
                    key={m.id}
                    m={m}
                    providerIconId={conn.iconId}
                    connectionLabel={connLabel}
                    opusLatestId={opusLatestId}
                    onToggleFav={() => updateRow(m, { favorite: !m.favorite })}
                    onRename={(next) => updateRow(m, { displayName: next })}
                    onChangeModality={(next) => changeModality(m, next)}
                    onToggleCap={(cap) => toggleCap(m, cap)}
                  />
                ))}
              </Box>
            </Box>
          );
        })}
      </Box>
    </S.Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────

export default function ModelsRoute() {
  const { connections, models, modelStore, reload } = useSettingsCtx();
  const [fetching, setFetching] = useState<Record<string, FetchState>>({});
  const [allBusy, setAllBusy] = useState(false);

  const byConn = useMemo(() => {
    const g: Record<string, ModelRow[]> = {};
    for (const m of models) (g[m.connectionId] ||= []).push(m as ModelRow);
    return g;
  }, [models]);

  const refetchOne = async (conn: any) => {
    setFetching((f) => ({ ...f, [conn.id]: { status: 'busy', message: '' } }));
    const r = await fetchModelsFor(conn);
    if (!r.ok) {
      setFetching((f) => ({ ...f, [conn.id]: { status: 'fail', message: r.message } }));
      return;
    }
    const u = await upsertRows(modelStore, r.rows);
    setFetching((f) => ({ ...f, [conn.id]: {
      status: 'ok',
      message: `${r.message}  ·  +${u.added} new, ${u.refreshed} refreshed`,
    } }));
    reload();
  };

  const refetchAll = async () => {
    setAllBusy(true);
    for (const c of connections) await refetchOne(c);
    setAllBusy(false);
  };

  return (
    <Section caption="Registry" title="Models">
      <Box style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        gap: 24, marginTop: -4,
      }}>
        <S.BodyDim style={{ flexShrink: 1 }}>
          {models.length} model{models.length === 1 ? '' : 's'} across {connections.length} provider{connections.length === 1 ? '' : 's'}.
          Star to favorite, click a name to rename, toggle capability badges per model.
        </S.BodyDim>
        {connections.length > 0 && (
          <Pressable onPress={allBusy ? () => {} : refetchAll}>
            <Box style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              paddingLeft: 16, paddingRight: 18, paddingTop: 10, paddingBottom: 10,
              borderRadius: 'theme:radiusMd',
              backgroundColor: 'theme:accent',
              flexShrink: 0,
            }}>
              <Icon icon={RefreshCw} size={14} color="theme:bg" strokeWidth={2.4} />
              <S.ButtonLabel>{allBusy ? 'Fetching all…' : 'Refetch all'}</S.ButtonLabel>
            </Box>
          </Pressable>
        )}
      </Box>

      {connections.length === 0 && (
        <S.Card style={{ paddingTop: 56, paddingBottom: 56 }}>
          <Box style={{ alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <S.Heading>No providers yet</S.Heading>
            <S.BodyDim>Add one in Providers, then come back.</S.BodyDim>
          </Box>
        </S.Card>
      )}

      {connections.map((c: any) => (
        <ProviderModelsBlock
          key={c.id}
          conn={c}
          modelsForConn={byConn[c.id] || []}
          onRefetch={() => refetchOne(c)}
          fetching={fetching[c.id] || IDLE}
        />
      ))}
    </Section>
  );
}
