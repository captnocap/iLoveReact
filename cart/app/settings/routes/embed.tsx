// Settings → Embed.
//
// Sources are user-edited entities; the manager owns the run lifecycle
// (queue, scheduler, model cache) so leaving this route doesn't pause
// anything. This file is purely UI over the manager.

import { useEffect, useMemo, useState } from 'react';
import { Box, Pressable, ScrollView } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import * as fs from '@reactjit/runtime/hooks/fs';
import * as http from '@reactjit/runtime/hooks/fetch';
import { callHost, hasHost } from '@reactjit/runtime/ffi';
import type { EmbedKind, EmbedMapping } from '@reactjit/runtime/hooks/embed';
import { Card, Field, Input, Section } from '../shared';
import { useSettingsCtx } from '../page';
import { useEmbedManager } from '../../embed/useEmbedManager';
import { slugFor, CONVERSATION_PRESETS, KNOWLEDGE_PRESETS } from '../../embed/manager';
import type { EmbedSource, MergedHit, Schedule } from '../../embed/manager';

// ── recommended fallback model (whisper-style direct download) ───────

const FALLBACK_MODEL = {
  url: 'https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf',
  dest: '~/.reactjit/models/Qwen3-Embedding-0.6B-Q8_0.gguf',
  approxMb: 639,
  label: 'Qwen3-Embedding-0.6B-Q8_0',
};

function expandHome(p: string): string {
  if (!p.startsWith('~/')) return p;
  if (!hasHost('__env')) return p;
  const home = callHost<string>('__env', '', 'HOME') || '';
  return home + p.slice(1);
}

// ── kind metadata (presentation only) ─────────────────────────────────

const KIND_ORDER: EmbedKind[] = ['code', 'documentation', 'conversation-history', 'knowledge'];

const KIND_LABEL: Record<EmbedKind, string> = {
  code: 'Code',
  documentation: 'Documentation',
  'conversation-history': 'Conversation history',
  knowledge: 'Knowledge',
};

const KIND_HINT: Record<EmbedKind, string> = {
  code: 'Walks a directory for source files; chunks by line window.',
  documentation: 'Same walker as code, lands as document-chunk for separate query filtering. Good for docs trees.',
  'conversation-history': 'Walks .json/.jsonl files. You declare which JSON keys hold role + content + timestamp. Windows N events per chunk.',
  knowledge: 'Walks .json/.jsonl files. Each record becomes one chunk. You declare which keys hold title + content.',
};

const KIND_DEFAULT_CHUNK: Record<EmbedKind, number> = {
  code: 200,
  documentation: 200,
  'conversation-history': 4,
  knowledge: 1,
};

const STRUCTURED_KINDS: EmbedKind[] = ['conversation-history', 'knowledge'];

function isStructured(k: EmbedKind): boolean {
  return STRUCTURED_KINDS.includes(k);
}

const SCHEDULE_ORDER: Schedule[] = ['never', '24h', 'weekly', 'monthly', 'on-change'];

const SCHEDULE_LABEL: Record<Schedule, string> = {
  'never': 'Manual only',
  '24h': 'Every 24 hours',
  'weekly': 'Weekly',
  'monthly': 'Monthly',
  'on-change': 'On change (TODO)',
};

// ── route ─────────────────────────────────────────────────────────────

export default function EmbedRoute() {
  const m = useEmbedManager();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EmbedSource | null>(null);
  const [queryText, setQueryText] = useState('');
  const [selectedForQuery, setSelectedForQuery] = useState<Set<string>>(new Set());

  // Default-select every enabled source the first time we see them, then
  // leave the user in control.
  const [hasSeededQuerySelection, setHasSeededQuerySelection] = useState(false);
  useEffect(() => {
    if (hasSeededQuerySelection) return;
    if (m.sources.length === 0) return;
    setSelectedForQuery(new Set(m.sources.filter((s) => s.enabled).map((s) => s.id)));
    setHasSeededQuerySelection(true);
  }, [m.sources, hasSeededQuerySelection]);

  // tick once a second so "10s ago" labels and ingest rate refresh while
  // the manager is the source of truth.
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  function startAdd() {
    setDraft(m.newSourceDraft());
    setEditingId('__new__');
  }

  function startEdit(s: EmbedSource) {
    setDraft({ ...s });
    setEditingId(s.id);
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim() || !draft.path.trim() || !draft.modelPath.trim()) {
      return;
    }
    await m.saveSource(draft);
    setDraft(null);
    setEditingId(null);
  }

  function cancelDraft() {
    setDraft(null);
    setEditingId(null);
  }

  return (
    <Box style={{ flexDirection: 'column', gap: 20 }}>
      <Section
        title="Embedding sources"
        caption="Each source is one (path, kind, model) configured for its own ingest + query lane. Multiple sources can target the same path with different models — queries fan out and merge via reciprocal rank fusion."
      >
        <Box style={{ flexDirection: 'column', gap: 10 }}>
          {m.sources.length === 0 ? (
            <Card>
              <S.Caption>No sources yet. Add one to start embedding.</S.Caption>
            </Card>
          ) : null}

          {m.sources.map((s) => (
            <SourceRow
              key={s.id}
              source={s}
              activeId={m.active}
              queue={m.queue}
              progress={m.progress}
              startedAt={m.startedAt}
              onRun={() => m.runSource(s.id)}
              onPause={() => m.pauseSource(s.id)}
              onReset={() => m.resetSource(s.id)}
              onEdit={() => startEdit(s)}
              onDelete={() => m.deleteSource(s.id)}
              onToggleEnabled={async () => {
                await m.saveSource({ ...s, enabled: !s.enabled });
              }}
            />
          ))}

          <Box style={{ flexDirection: 'row', gap: 8 }}>
            <PrimaryButton label="Add source" onPress={startAdd} />
            {m.loadedModels.length > 0 ? (
              <GhostButton
                label={`Unload ${m.loadedModels.length} model${m.loadedModels.length === 1 ? '' : 's'}`}
                onPress={m.unloadAll}
              />
            ) : null}
          </Box>

          {m.error ? <Hint tone="err">{m.error}</Hint> : null}
        </Box>
      </Section>

      {draft ? (
        <Section
          title={editingId === '__new__' ? 'New source' : `Edit "${draft.name || draft.id}"`}
        >
          <SourceEditor
            draft={draft}
            setDraft={setDraft}
            onSave={saveDraft}
            onCancel={cancelDraft}
          />
        </Section>
      ) : null}

      <Section
        title="Ensemble query"
        caption="Each selected source embeds the query against its own model, runs a top-K search, and the rankings are fused. Different models capture different aspects of the same text — running 2-3 in parallel typically beats any single one."
      >
        <QueryPanel
          sources={m.sources}
          selected={selectedForQuery}
          setSelected={setSelectedForQuery}
          queryText={queryText}
          setQueryText={setQueryText}
          lastQuery={m.lastQuery}
          onRun={() => {
            const sourceIds = Array.from(selectedForQuery);
            if (sourceIds.length === 0 || !queryText.trim()) return;
            m.query(queryText, { sourceIds });
          }}
        />
      </Section>
    </Box>
  );
}

// ── source row ────────────────────────────────────────────────────────

function SourceRow({
  source, activeId, queue, progress, startedAt,
  onRun, onPause, onReset, onEdit, onDelete, onToggleEnabled,
}: {
  source: EmbedSource;
  activeId: string | null;
  queue: string[];
  progress: import('@reactjit/runtime/hooks/embed').IngestProgress;
  startedAt: number;
  onRun: () => void;
  onPause: () => void;
  onReset: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
}) {
  const isActive = activeId === source.id;
  const isQueued = queue.includes(source.id);
  const status: 'active' | 'queued' | 'idle' = isActive ? 'active' : isQueued ? 'queued' : 'idle';
  const statusLabel = isActive
    ? 'ingesting'
    : isQueued
    ? `queued (#${queue.indexOf(source.id) + 1})`
    : source.lastRunAt
    ? `last run ${relTime(source.lastRunAt)}`
    : 'never run';
  const next = source.nextRunAt && source.enabled
    ? `next ${relTime(source.nextRunAt)}`
    : '';
  return (
    <Card>
      <Box style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Pressable onPress={onToggleEnabled}>
          <Box style={{
            width: 10, height: 10, borderRadius: 5,
            backgroundColor: source.enabled ? 'theme:success' : 'theme:muted',
          } as any} />
        </Pressable>
        <Box style={{ flexDirection: 'column', flexGrow: 1, gap: 2 }}>
          <Box style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <S.AppFormLabel>{source.name || '(unnamed)'}</S.AppFormLabel>
            <Pill>{KIND_LABEL[source.kind]}</Pill>
            <Pill>{SCHEDULE_LABEL[source.schedule]}</Pill>
            <Pill>{source.workers}w</Pill>
            <Pill>chunk {source.chunkSize}</Pill>
          </Box>
          <S.Caption>{source.path}</S.Caption>
          <S.Caption>
            {source.modelPath
              ? `model ${shortBasename(source.modelPath)} · slug ${slugFor(source.modelPath)}`
              : 'no model selected'} · {source.excludes.length} excludes
          </S.Caption>
          <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <StatusDot status={status} />
            <S.Caption>
              {statusLabel}{next ? ` · ${next}` : ''}
              {source.lastResult ? ` · ${source.lastResult.files} files, ${source.lastResult.chunks} chunks${source.lastResult.error ? ', error: ' + source.lastResult.error : ''}` : ''}
            </S.Caption>
          </Box>
        </Box>
      </Box>
      {isActive ? (
        <Box style={{ flexDirection: 'column', gap: 4 }}>
          <ProgressBar value={progress.files_total > 0 ? progress.files_done / progress.files_total : 0} />
          <S.Caption>
            {progress.files_done}/{progress.files_total} files · {progress.chunks_done} chunks ·{' '}
            {(progress.chunks_done / Math.max(0.001, (Date.now() - startedAt) / 1000)).toFixed(1)} chunks/s
          </S.Caption>
          {progress.current_file ? <S.Caption>{progress.current_file}</S.Caption> : null}
        </Box>
      ) : null}
      <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {isActive || isQueued ? (
          <GhostButton label="Pause" onPress={onPause} />
        ) : (
          <PrimaryButton label="Run now" onPress={onRun} disabled={!source.enabled} />
        )}
        <GhostButton label="Reset" onPress={onReset} />
        <GhostButton label="Edit" onPress={onEdit} />
        <GhostButton label="Delete" onPress={onDelete} />
      </Box>
    </Card>
  );
}

// ── editor ────────────────────────────────────────────────────────────

function SourceEditor({
  draft, setDraft, onSave, onCancel,
}: {
  draft: EmbedSource;
  setDraft: (s: EmbedSource) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const ctx = useSettingsCtx();
  // Read from Settings → Models, filtered to embed modality. This is
  // the same set Settings → Actions picks from for the 'embedding'
  // role binding.
  const embedModels = useMemo(
    () => (ctx.models || []).filter((mm: any) => mm.modality === 'embed'),
    [ctx.models],
  );
  const set = <K extends keyof EmbedSource>(k: K, v: EmbedSource[K]) => setDraft({ ...draft, [k]: v });
  const excludesText = useMemo(() => draft.excludes.join('\n'), [draft.excludes]);
  return (
    <Card>
      <Field label="Name"><Input value={draft.name} onChange={(v) => set('name', v)} /></Field>
      <Field label="Path">
        <Input value={draft.path} onChange={(v) => set('path', v)} mono placeholder="/absolute/path" />
      </Field>
      <Field label="Kind">
        <Box style={{ flexDirection: 'column', gap: 6 }}>
          <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {KIND_ORDER.map((k) => (
              <Pressable
                key={k}
                onPress={() => {
                  const nextChunk = draft.chunkSize === KIND_DEFAULT_CHUNK[draft.kind]
                    ? KIND_DEFAULT_CHUNK[k]
                    : draft.chunkSize;
                  setDraft({ ...draft, kind: k, chunkSize: nextChunk });
                }}
              >
                <PillT active={k === draft.kind}>{KIND_LABEL[k]}</PillT>
              </Pressable>
            ))}
          </Box>
          <S.Caption>{KIND_HINT[draft.kind]}</S.Caption>
        </Box>
      </Field>
      <ModelPickerField
        models={embedModels}
        value={draft.modelPath}
        onPick={(p) => set('modelPath', p)}
        onReloadModels={ctx.reload}
      />
      {isStructured(draft.kind) ? (
        <MappingEditor
          kind={draft.kind}
          mapping={draft.mapping || {}}
          onChange={(m) => set('mapping', m)}
        />
      ) : null}
      <Field label="Worker threads">
        <Input value={String(draft.workers)} onChange={(v) => set('workers', clampInt(v, 1, 16, 2))} />
      </Field>
      <Field label={`Chunk size (${draft.kind === 'code' || draft.kind === 'documentation' ? 'lines' : draft.kind === 'conversation-history' ? 'events' : 'records (ignored — knowledge is one record per chunk)'} per window)`}>
        <Input value={String(draft.chunkSize)} onChange={(v) => set('chunkSize', clampInt(v, 1, 4096, KIND_DEFAULT_CHUNK[draft.kind]))} />
      </Field>
      <Field label="Excludes (one per line — path substring matches)">
        <Input
          value={excludesText}
          onChange={(v) => set('excludes', v.split('\n').map((s) => s.trim()).filter(Boolean))}
          mono
          placeholder="archive/&#10;node_modules&#10;cart/app/bundle.js"
        />
      </Field>
      <Field label="Schedule">
        <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {SCHEDULE_ORDER.map((sch) => (
            <Pressable key={sch} onPress={() => set('schedule', sch)}>
              <PillT active={sch === draft.schedule}>{SCHEDULE_LABEL[sch]}</PillT>
            </Pressable>
          ))}
        </Box>
      </Field>
      <Field label="Enabled">
        <Pressable onPress={() => set('enabled', !draft.enabled)}>
          <PillT active={draft.enabled}>{draft.enabled ? 'enabled (scheduled + queried by default)' : 'paused'}</PillT>
        </Pressable>
      </Field>
      <Box style={{ flexDirection: 'row', gap: 8 }}>
        <PrimaryButton label="Save" onPress={onSave} />
        <GhostButton label="Cancel" onPress={onCancel} />
      </Box>
    </Card>
  );
}

// ── query panel ───────────────────────────────────────────────────────

function QueryPanel({
  sources, selected, setSelected,
  queryText, setQueryText,
  lastQuery, onRun,
}: {
  sources: EmbedSource[];
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  queryText: string;
  setQueryText: (s: string) => void;
  lastQuery: import('../../embed/manager').LastQuery | null;
  onRun: () => void;
}) {
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sources) m.set(s.id, s.name || s.id);
    return m;
  }, [sources]);
  return (
    <Card>
      <Field label="Sources to query (panel of judges)">
        <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {sources.length === 0 ? (
            <S.Caption>No sources to query against — add one above.</S.Caption>
          ) : (
            sources.map((s) => (
              <Pressable key={s.id} onPress={() => toggle(s.id)}>
                <PillT active={selected.has(s.id)}>{s.name || s.id}</PillT>
              </Pressable>
            ))
          )}
        </Box>
      </Field>
      <Field label="Query">
        <Input value={queryText} onChange={setQueryText} placeholder="ask anything…" />
      </Field>
      <Box style={{ flexDirection: 'row', gap: 8 }}>
        <PrimaryButton
          label="Run query"
          onPress={onRun}
          disabled={selected.size === 0 || !queryText.trim()}
        />
      </Box>
      {lastQuery ? (
        <Box style={{ flexDirection: 'column', gap: 8 }}>
          <S.Caption>
            {lastQuery.merged.length} merged hits · {lastQuery.ms}ms ·{' '}
            {Object.keys(lastQuery.bySource).length} sources
          </S.Caption>
          <ScrollView style={{ maxHeight: 360 }}>
            <Box style={{ flexDirection: 'column', gap: 6 }}>
              {lastQuery.merged.map((h, i) => (
                <MergedHitRow key={`${h.source_id}#${h.chunk_index}-${i}`} rank={i + 1} hit={h} nameById={nameById} />
              ))}
              {lastQuery.merged.length === 0 ? <S.Caption>no results</S.Caption> : null}
            </Box>
          </ScrollView>
        </Box>
      ) : null}
    </Card>
  );
}

function MergedHitRow({
  rank, hit, nameById,
}: { rank: number; hit: MergedHit; nameById: Map<string, string> }) {
  return (
    <Box style={{
      backgroundColor: 'theme:surface-2',
      borderRadius: 4,
      padding: 8,
      flexDirection: 'column',
      gap: 4,
    } as any}>
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <S.AppFormLabel>{`${rank}. ${hit.source_id}#${hit.chunk_index}`}</S.AppFormLabel>
        <S.Caption>rrf {hit.fused_score.toFixed(4)}</S.Caption>
      </Box>
      <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {hit.contributors.map((c) => (
          <Pill key={c.embedSourceId}>
            {`${nameById.get(c.embedSourceId) || c.embedSourceId} #${c.rank} (${c.dense_score.toFixed(3)})`}
          </Pill>
        ))}
      </Box>
      <S.Caption>{hit.text_preview}</S.Caption>
    </Box>
  );
}

// ── atoms ─────────────────────────────────────────────────────────────

function Pill({ children }: { children: any }) {
  return <S.AppTraitChip><S.AppTraitChipText>{children}</S.AppTraitChipText></S.AppTraitChip>;
}

function PillT({ active, children }: { active?: boolean; children: any }) {
  const C = active ? S.AppTraitChipActive : S.AppTraitChip;
  const T = active ? S.AppTraitChipTextActive : S.AppTraitChipText;
  return <C><T>{children}</T></C>;
}

// Model picker over Settings → Models (embed modality). If empty,
// offers a direct download of the recommended fallback — same UX as
// the whisper download gate. Once the file lands on disk the user
// still needs to Refresh in Settings → Models to register it as a
// row; we surface that nudge inline.

function ModelPickerField({
  models, value, onPick, onReloadModels,
}: {
  models: any[];
  value: string;
  onPick: (modelPath: string) => void;
  onReloadModels: () => void;
}) {
  const [download, setDownload] = useState<{ bytes: number; total: number; done: boolean; err?: string } | null>(null);
  const matchByPath = useMemo(
    () => models.find((mm: any) => mm.remoteId === value),
    [models, value],
  );
  const destAbs = useMemo(() => expandHome(FALLBACK_MODEL.dest), []);
  const fallbackOnDisk = fs.exists(destAbs);

  async function startDownload() {
    fs.mkdir(expandHome('~/.reactjit/models'));
    setDownload({ bytes: 0, total: 0, done: false });
    try {
      await http.download({
        url: FALLBACK_MODEL.url,
        destPath: destAbs,
        onProgress: ({ bytes, total }) => setDownload({ bytes, total, done: false }),
      });
      setDownload({ bytes: FALLBACK_MODEL.approxMb * 1024 * 1024, total: FALLBACK_MODEL.approxMb * 1024 * 1024, done: true });
      // Wire the source straight to the file we just wrote — registry
      // refresh is optional housekeeping; the source uses the path.
      onPick(destAbs);
      onReloadModels();
    } catch (e: any) {
      setDownload({ bytes: 0, total: 0, done: false, err: e?.message ?? String(e) });
    }
  }

  return (
    <Field label="Embedding model">
      {models.length > 0 ? (
        <Box style={{ flexDirection: 'column', gap: 6 }}>
          <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {models.map((mm: any) => (
              <Pressable key={mm.id} onPress={() => onPick(mm.remoteId)}>
                <PillT active={mm.remoteId === value}>
                  {mm.displayName || shortBasename(mm.remoteId)}
                </PillT>
              </Pressable>
            ))}
          </Box>
          {value && !matchByPath ? (
            <S.Caption>
              Using {shortBasename(value)} (not in Models registry — Refresh in Settings → Models if you want it picked up there too).
            </S.Caption>
          ) : null}
          <S.Caption>Slug auto-derived: chunks_{value ? slugFor(value) : '<none>'}</S.Caption>
        </Box>
      ) : (
        <Box style={{ flexDirection: 'column', gap: 8 }}>
          <S.Caption>
            No embedding models in Settings → Models. Either set Providers → Local Models to a folder
            with an embed .gguf and Refresh, or download the recommended one here.
          </S.Caption>
          {fallbackOnDisk ? (
            <Box style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <PrimaryButton label={`Use ${FALLBACK_MODEL.label}`} onPress={() => onPick(destAbs)} />
              <S.Caption>{destAbs}</S.Caption>
            </Box>
          ) : (
            <Box style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <PrimaryButton
                label={
                  download
                    ? download.done
                      ? 'Downloaded'
                      : download.err
                      ? 'Retry download'
                      : `Downloading… ${download.total > 0 ? Math.round((download.bytes / download.total) * 100) : 0}%`
                    : `Download ${FALLBACK_MODEL.label} (~${FALLBACK_MODEL.approxMb} MB)`
                }
                onPress={startDownload}
                disabled={!!download && !download.done && !download.err}
              />
              <S.Caption>huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF</S.Caption>
            </Box>
          )}
          {download?.err ? <Hint tone="err">{download.err}</Hint> : null}
        </Box>
      )}
    </Field>
  );
}

// Mapping editor for structured kinds (conversation-history, knowledge).
// The user declares which JSON key paths in the source records correspond
// to canonical fields. Preset buttons populate the paths for known
// formats (Claude/Codex/Kimi JSONL, generic {title,content} knowledge).
// Free-text fields let the user adapt to any other format — paths are
// dotted (e.g. `payload.body.text`).

const CONV_FIELDS: Array<{ key: keyof EmbedMapping; label: string; placeholder: string; required?: boolean }> = [
  { key: 'role',       label: 'role',       placeholder: 'message.role' },
  { key: 'content',    label: 'content',    placeholder: 'message.content', required: true },
  { key: 'timestamp',  label: 'timestamp',  placeholder: 'timestamp' },
  { key: 'session_id', label: 'session_id', placeholder: 'sessionId' },
];

const KNOW_FIELDS: Array<{ key: keyof EmbedMapping; label: string; placeholder: string; required?: boolean }> = [
  { key: 'title',      label: 'title',      placeholder: 'title' },
  { key: 'content',    label: 'content',    placeholder: 'content', required: true },
  { key: 'source_uri', label: 'source_uri', placeholder: 'url' },
];

function MappingEditor({
  kind, mapping, onChange,
}: {
  kind: EmbedKind;
  mapping: EmbedMapping;
  onChange: (m: EmbedMapping) => void;
}) {
  const presets = kind === 'conversation-history' ? CONVERSATION_PRESETS : KNOWLEDGE_PRESETS;
  const fields = kind === 'conversation-history' ? CONV_FIELDS : KNOW_FIELDS;
  const setField = (k: keyof EmbedMapping, v: string) => onChange({ ...mapping, [k]: v });
  return (
    <Field label="Mapping (JSON key paths → canonical fields)">
      <Box style={{ flexDirection: 'column', gap: 10 }}>
        <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {Object.keys(presets).map((name) => (
            <Pressable key={name} onPress={() => onChange({ ...presets[name] })}>
              <PillT>{name}</PillT>
            </Pressable>
          ))}
        </Box>
        <S.Caption>
          Click a preset to fill the fields below, then tweak. Paths are dotted —
          {' '}<S.Caption>e.g. "message.content" navigates {'{message: {content: "..."}}'}</S.Caption>.
        </S.Caption>
        <Box style={{ flexDirection: 'column', gap: 6 }}>
          {fields.map((f) => (
            <Box key={f.key as string} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Box style={{ width: 110 }}>
                <S.AppFormLabel>
                  {f.label}{f.required ? ' *' : ''}
                </S.AppFormLabel>
              </Box>
              <Box style={{ flexGrow: 1 }}>
                <Input
                  value={String(mapping[f.key] || '')}
                  onChange={(v) => setField(f.key, v)}
                  mono
                  placeholder={f.placeholder}
                />
              </Box>
            </Box>
          ))}
        </Box>
        {!mapping.content ? (
          <Hint tone="warn">content path is required — without it the parser produces zero chunks.</Hint>
        ) : null}
      </Box>
    </Field>
  );
}

function StatusDot({ status }: { status: 'active' | 'queued' | 'idle' }) {
  const color = status === 'active' ? 'theme:accent' : status === 'queued' ? 'theme:warn' : 'theme:muted';
  return (
    <Box style={{
      width: 8, height: 8, borderRadius: 4, backgroundColor: color,
    } as any} />
  );
}

function Hint({ children, tone }: { children: any; tone?: 'err' | 'warn' }) {
  const prefix = tone === 'err' ? '× ' : tone === 'warn' ? '! ' : '';
  return <S.Caption>{prefix}{children}</S.Caption>;
}

function PrimaryButton({
  label, onPress, disabled,
}: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={() => { if (!disabled) onPress(); }}
      style={{
        backgroundColor: disabled ? 'theme:surface-2' : 'theme:accent',
        paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7,
        borderRadius: 6, opacity: disabled ? 0.6 : 1,
      } as any}
    >
      <S.AppFormLabel>{label}</S.AppFormLabel>
    </Pressable>
  );
}

function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: 'theme:surface-2',
        paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7,
        borderRadius: 6,
      } as any}
    >
      <S.AppFormLabel>{label}</S.AppFormLabel>
    </Pressable>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <Box style={{
      width: '100%', height: 8,
      backgroundColor: 'theme:surface-2',
      borderRadius: 4, overflow: 'hidden',
    } as any}>
      <Box style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: 'theme:accent' } as any} />
    </Box>
  );
}

// ── helpers ───────────────────────────────────────────────────────────

function clampInt(s: string, min: number, max: number, fallback: number): number {
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function shortBasename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function relTime(ts: number): string {
  const delta = Date.now() - ts;
  const abs = Math.abs(delta);
  const ago = delta >= 0;
  const sec = Math.round(abs / 1000);
  if (sec < 60) return ago ? `${sec}s ago` : `in ${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return ago ? `${min}m ago` : `in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return ago ? `${hr}h ago` : `in ${hr}h`;
  const day = Math.round(hr / 24);
  return ago ? `${day}d ago` : `in ${day}d`;
}
