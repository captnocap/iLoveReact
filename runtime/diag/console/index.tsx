// diag/console/index.tsx — the in-app raw diagnostics console (Seam 3).
//
// "The editor needs a z-indexed in-app raw console overlay fed by [the] same
// registry. It should show the unfiltered/filtered raw feed in a copyable text
// form so the user can paste it into an agent prompt without caring whether
// anything reached terminal stdout." (DESIGN_INTAKE.)
//
// This is UI — allowed in React. It OWNS no diagnostics logic: it reads the
// registry (registeredChannels) + the live feed (feed.ts, an ffi subscription
// to the Zig ring) and routes user intent (toggle, capture, attach) back
// through the registry door + the capture/journal seam. Styling is the console's
// own classifier sheet (console.cls.ts) — theme tokens only, no inline styles.
//
// Features (the DESIGN_INTAKE minimum): channel filter, severity filter,
// pause/resume, clear view, copy visible feed, copy recent N entries, jump to a
// channel's setting toggle, and create-a-named-capture (preserving channels,
// filters, time range, build id, request id, map/context, and a note) that can
// be attached to an ongoing bug/build thread.

import * as React from 'react';
import { C } from './console.cls';
import { emit as ffiEmit } from '../../ffi';
import {
  registeredChannels, setChannelEnabled, isChannelEnabled,
} from '../channel';
import {
  subscribeFeed, feedSnapshot, isPaused, togglePause, clearFeed,
  channelStates, type DiagLine,
} from './feed';
import {
  applyFilter, linesToText, copyText, SEVERITY_ORDER,
  type Severity, type FeedFilter,
} from './format';
import {
  createCapture, attachCaptureToThread, findThreads, hasJournal,
  type LogCapture,
} from './captures';

const { useState, useMemo, useSyncExternalStore, useCallback } = React;

/** The console is mounted by the editor shell and shown on a hotkey/dock entry. */
export interface DiagConsoleProps {
  /** When false, renders nothing (keeps the subscription cheap when closed). */
  open?: boolean;
  onClose?: () => void;
  /** Navigate the settings UI to a channel's toggle (the "jump to" action).
   *  Also broadcast on the `diag.jumpToSetting` ffi channel for any listener. */
  onJumpToSetting?: (channelId: string) => void;
  /** Context folded into a named capture so it is traceable later. */
  buildId?: string;
  requestId?: string;
  mapContext?: string;
}

const RECENT_PRESETS = [50, 100, 250, 500];

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function dotClass(sev: string): any {
  switch (sev) {
    case 'trace': return C.DC_DotTrace;
    case 'debug': return C.DC_DotDebug;
    case 'warn': return C.DC_DotWarn;
    case 'error': return C.DC_DotError;
    default: return C.DC_DotInfo;
  }
}
function sevClass(sev: string): any {
  switch (sev) {
    case 'trace': return C.DC_SevTrace;
    case 'debug': return C.DC_SevDebug;
    case 'warn': return C.DC_SevWarn;
    case 'error': return C.DC_SevError;
    default: return C.DC_SevInfo;
  }
}

function FeedRow({ line }: { line: DiagLine }) {
  const Dot = dotClass(line.sev);
  const Sev = sevClass(line.sev);
  const hasFields = line.fields && Object.keys(line.fields).length > 0;
  let fieldsStr = '';
  if (hasFields) { try { fieldsStr = JSON.stringify(line.fields); } catch { fieldsStr = ''; } }
  return (
    <C.DC_Row>
      <C.DC_Time>{fmtTime(line.ts)}</C.DC_Time>
      <Dot />
      <Sev>{line.sev.toUpperCase()}</Sev>
      <C.DC_ChCell>{line.ch}</C.DC_ChCell>
      <C.DC_Msg numberOfLines={1}>{line.msg}</C.DC_Msg>
      {hasFields ? <C.DC_Fields numberOfLines={1}>{fieldsStr}</C.DC_Fields> : null}
    </C.DC_Row>
  );
}

function CaptureDialog({
  filtered, filter, ctx, onClose,
}: {
  filtered: DiagLine[];
  filter: FeedFilter;
  ctx: { buildId?: string; requestId?: string; mapContext?: string };
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [made, setMade] = useState<LogCapture | null>(null);
  const [query, setQuery] = useState('');
  const threads = useMemo(() => (query.trim() ? findThreads(query) : []), [query]);

  const make = useCallback(() => {
    const cap = createCapture(name, filtered, filter, { ...ctx, note });
    setMade(cap);
  }, [name, note, filtered, filter, ctx]);

  return (
    <C.DC_CapScrim>
      <C.DC_CapCard>
        <C.DC_CapTitle>Create named capture</C.DC_CapTitle>
        <C.DC_CapMeta>
          {filtered.length} lines · {filter.channels ? filter.channels.size + ' channels' : 'all channels'} · ≥{filter.minSeverity}
          {ctx.buildId ? ` · build ${ctx.buildId}` : ''}{ctx.requestId ? ` · ${ctx.requestId}` : ''}
          {ctx.mapContext ? ` · ${ctx.mapContext}` : ''}
        </C.DC_CapMeta>
        {!made ? (
          <>
            <C.DC_CapLabel>NAME</C.DC_CapLabel>
            <C.DC_CapInput value={name} onChangeText={setName} placeholder="e.g. orbit jitter" />
            <C.DC_CapLabel>NOTE</C.DC_CapLabel>
            <C.DC_CapInput value={note} onChangeText={setNote} placeholder="short user/agent note" />
            <C.DC_CapActions>
              <C.DC_BtnOn onPress={make}><C.DC_BtnTextOn>Create capture</C.DC_BtnTextOn></C.DC_BtnOn>
              <C.DC_Btn onPress={onClose}><C.DC_BtnText>Cancel</C.DC_BtnText></C.DC_Btn>
            </C.DC_CapActions>
          </>
        ) : (
          <>
            <C.DC_CapMeta>Saved "{made.name}" ({made.id}). Copy it or attach to a bug/build thread.</C.DC_CapMeta>
            <C.DC_CapActions>
              <C.DC_Btn onPress={() => copyText(linesToText(made.lines))}><C.DC_BtnText>Copy capture text</C.DC_BtnText></C.DC_Btn>
            </C.DC_CapActions>
            <C.DC_CapLabel>ATTACH TO BUG / BUILD THREAD</C.DC_CapLabel>
            {hasJournal() ? (
              <>
                <C.DC_CapInput value={query} onChangeText={setQuery} placeholder="search a thread by name…" />
                {threads.map((t) => (
                  <C.DC_ThreadRow key={t.stableId} onPress={() => { attachCaptureToThread(made.id, t.stableId); onClose(); }}>
                    <C.DC_ThreadText>{t.name}</C.DC_ThreadText>
                  </C.DC_ThreadRow>
                ))}
              </>
            ) : (
              <C.DC_CapMeta>No build-journal wired — capture saved locally ({made.id}).</C.DC_CapMeta>
            )}
            <C.DC_CapActions>
              <C.DC_Btn onPress={onClose}><C.DC_BtnText>Done</C.DC_BtnText></C.DC_Btn>
            </C.DC_CapActions>
          </>
        )}
      </C.DC_CapCard>
    </C.DC_CapScrim>
  );
}

function DiagConsole({ open = true, onClose, onJumpToSetting, buildId, requestId, mapContext }: DiagConsoleProps) {
  const lines = useSyncExternalStore(subscribeFeed, feedSnapshot);
  const [minSeverity, setMinSeverity] = useState<Severity>('trace');
  const [only, setOnly] = useState<Set<string>>(() => new Set());
  const [text, setText] = useState('');
  const [recentN, setRecentN] = useState(100);
  const [capturing, setCapturing] = useState(false);

  const paused = isPaused();

  // Channels: the registry's declared streams unioned with anything seen live.
  const channels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of lines) counts.set(l.ch, (counts.get(l.ch) ?? 0) + 1);
    const ids = new Set<string>(counts.keys());
    for (const ch of registeredChannels()) ids.add(ch.id);
    return Array.from(ids).sort().map((id) => ({ id, count: counts.get(id) ?? 0 }));
  }, [lines]);

  const filter: FeedFilter = useMemo(
    () => ({ channels: only.size ? only : null, minSeverity, text }),
    [only, minSeverity, text],
  );
  const filtered = useMemo(() => applyFilter(lines, filter), [lines, filter]);
  const recent = useMemo(() => filtered.slice(-recentN), [filtered, recentN]);

  const toggleChannel = useCallback((id: string) => {
    setOnly((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const jump = useCallback((id: string) => {
    ffiEmit('diag.jumpToSetting', id);
    if (onJumpToSetting) onJumpToSetting(id);
  }, [onJumpToSetting]);

  const dropped = useMemo(() => {
    let d = 0;
    for (const s of channelStates()) d += s.dropped;
    return d;
  }, [lines]);

  if (!open) return null;

  return (
    <C.DC_Scrim>
      <C.DC_Panel>
        {/* Header */}
        <C.DC_Header>
          <C.DC_Kicker>RAW CONSOLE</C.DC_Kicker>
          <C.DC_Title>Diagnostics</C.DC_Title>
          <C.DC_Sub>{lines.length} lines{dropped ? ` · ${dropped} sampled-out` : ''}</C.DC_Sub>
          <C.DC_Spacer />
          {paused
            ? <C.DC_BtnOn onPress={togglePause}><C.DC_BtnTextOn>paused</C.DC_BtnTextOn></C.DC_BtnOn>
            : <C.DC_Btn onPress={togglePause}><C.DC_BtnText>pause</C.DC_BtnText></C.DC_Btn>}
          <C.DC_Btn onPress={clearFeed}><C.DC_BtnText>clear</C.DC_BtnText></C.DC_Btn>
          <C.DC_Btn onPress={() => copyText(linesToText(filtered))}><C.DC_BtnText>copy visible</C.DC_BtnText></C.DC_Btn>
          <C.DC_Btn onPress={() => setCapturing(true)}><C.DC_BtnText>capture…</C.DC_BtnText></C.DC_Btn>
          {onClose ? <C.DC_Btn onPress={onClose}><C.DC_BtnText>close</C.DC_BtnText></C.DC_Btn> : null}
        </C.DC_Header>

        {/* Severity floor + text search */}
        <C.DC_Toolbar>
          <C.DC_SegTrack>
            {SEVERITY_ORDER.map((s) => {
              const on = s === minSeverity;
              const Seg = on ? C.DC_SegOn : C.DC_Seg;
              const Txt = on ? C.DC_SegTextOn : C.DC_SegText;
              return <Seg key={s} onPress={() => setMinSeverity(s)}><Txt>{s}</Txt></Seg>;
            })}
          </C.DC_SegTrack>
          <C.DC_Search value={text} onChangeText={setText} placeholder="filter by channel, message, or fields (substring)" />
        </C.DC_Toolbar>

        {/* Channel filter chips (with jump-to-setting + inline enable mirror) */}
        <C.DC_ChannelBar>
          {channels.map(({ id, count }) => {
            const active = only.size === 0 || only.has(id);
            const Chip = active ? C.DC_ChanOn : C.DC_Chan;
            const Txt = active ? C.DC_ChanTextOn : C.DC_ChanText;
            const enabled = isChannelEnabled(id);
            return (
              <Chip key={id} onPress={() => toggleChannel(id)}>
                <C.DC_ChanText>{enabled ? '●' : '○'}</C.DC_ChanText>
                <Txt>{id}</Txt>
                <C.DC_ChanCount>{count}</C.DC_ChanCount>
                <C.DC_Jump onPress={() => { setChannelEnabled(id, !enabled); jump(id); }}>
                  <C.DC_JumpText>⚙</C.DC_JumpText>
                </C.DC_Jump>
              </Chip>
            );
          })}
        </C.DC_ChannelBar>

        {/* Feed */}
        <C.DC_Body>
          <C.DC_List>
            {filtered.length === 0
              ? <C.DC_Empty><C.DC_EmptyText>no lines match — waiting for diagnostics traffic…</C.DC_EmptyText></C.DC_Empty>
              : filtered.map((l) => <FeedRow key={l.seq} line={l} />)}
          </C.DC_List>
        </C.DC_Body>

        {/* Footer: copy-recent-N */}
        <C.DC_Footer>
          <C.DC_FootText>{filtered.length} shown</C.DC_FootText>
          <C.DC_Spacer />
          <C.DC_FootText>recent</C.DC_FootText>
          {RECENT_PRESETS.map((n) => {
            const on = n === recentN;
            const Seg = on ? C.DC_BtnOn : C.DC_Btn;
            const Txt = on ? C.DC_BtnTextOn : C.DC_BtnText;
            return <Seg key={n} onPress={() => setRecentN(n)}><Txt>{String(n)}</Txt></Seg>;
          })}
          <C.DC_Btn onPress={() => copyText(linesToText(recent))}>
            <C.DC_BtnText>copy recent {recentN}</C.DC_BtnText>
          </C.DC_Btn>
        </C.DC_Footer>
      </C.DC_Panel>

      {capturing
        ? <CaptureDialog filtered={filtered} filter={filter} ctx={{ buildId, requestId, mapContext }} onClose={() => setCapturing(false)} />
        : null}
    </C.DC_Scrim>
  );
}

export default DiagConsole;
