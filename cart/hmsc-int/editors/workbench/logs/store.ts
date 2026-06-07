// editors/workbench/logs/store.ts — the LOGS source's headless store
// (WBSET9-0606, WORKBENCH.md §6 step 9).
//
// The fold of /log + /settings' read halves into ONE streaming category:
//
//   churn          — the perfLog ring (LogView.tsx's feed): key-only ⇄ all
//                    lines, pause/resume, clear, the on-disk path.
//   session bus    — the V20 sessions fold (SettingsRoute.tsx's left column,
//                    editors/settings/bus.ts UNCHANGED): every route's
//                    commits, newest first, per-channel filtering.
//   bus channels   — one roster row per live channel (the route's chip
//                    filter, ALL ⇄ CHANNEL as a lens — LAW 2's own example).
//
// Deps are injected (the createCharacterStore discipline): the P4 suite
// drives a fake ring + a fake SessionsState; live.ts wires perfLog and
// editorSessions. The stage (LogStream.tsx) renders what this store folds.

import { busChannels, busRows, type BusChannelSummary } from '../../settings/bus';
import type { SessionsState } from '../../sessions';
import { isKeyLine, lineColor, lineStamp, tagOf } from './churn';

export const CHURN_ID = 'churn';
export const BUS_ID = 'bus';
export const BUS_PREFIX = 'bus:';

export type LogsRingDeps = {
  lines(): string[];
  enabled(): boolean;
  setEnabled(on: boolean): void;
  clear(): void;
  path(): string;
  /** fires on each ring flush — the tail-live wire (census/log.md C7) */
  subscribe(fn: () => void): () => void;
};

export type LogsStoreDeps = {
  ring: LogsRingDeps;
  /** the sessions fold; null = store down */
  bus: () => SessionsState | null;
  /** why the bus is down (census/settings.md C3 store-unavailable parity) */
  busError: string | null;
};

/** one stream row, unified across feeds (key is selection identity) */
export type LogLine = {
  key: string;
  time: string;
  channel: string;
  text: string;
  /** stripe/chip color — churn lines bring their tag color, bus rows null
   *  (the stage tones by channel hash) */
  color: string | null;
  /** what COPY puts on the clipboard for this row */
  copy: string;
};

export type LogStat = {
  id: string;
  label: string;
  big: string;
  sub: string;
  /** normalized 0..1 activity buckets, oldest → newest */
  spark: number[];
};

export type LogsStore = {
  deps: LogsStoreDeps;
  /** roster ids, fixed feeds first: churn · session bus · one per channel */
  channelIds(): string[];
  labelOf(id: string): string;
  /** the stream, newest first, capped — lens 'all' widens churn to every
   *  line and a channel row to the whole bus */
  rowsFor(id: string, lens: string, cap: number): LogLine[];
  /** the dashboard band's cards — always every feed, real numbers */
  stats(): LogStat[];
  /** selection → clipboard text, displayed order */
  copyText(rows: LogLine[], selected: Set<string>): string;
  busState(): SessionsState | null;
  busError(): string | null;
};

const SPARK_BINS = 12;

/** bucket sample positions into normalized activity heights (0..1) */
export function sparkBuckets(positions: number[], lo: number, hi: number, bins = SPARK_BINS): number[] {
  const counts = new Array<number>(bins).fill(0);
  if (positions.length && hi > lo) {
    for (const p of positions) {
      const at = Math.min(bins - 1, Math.max(0, Math.floor(((p - lo) / (hi - lo)) * bins)));
      counts[at] += 1;
    }
  } else if (positions.length) {
    counts[bins - 1] = positions.length; // all at one instant
  }
  const max = Math.max(...counts, 1);
  return counts.map((c) => c / max);
}

export function createLogsStore(deps: LogsStoreDeps): LogsStore {
  const channels = (): BusChannelSummary[] => {
    const state = deps.bus();
    return state ? busChannels(state) : [];
  };

  const churnRows = (lens: string, cap: number): LogLine[] => {
    const all = deps.ring.lines();
    const shown = lens === 'all' ? all : all.filter(isKeyLine);
    const newest = shown.slice(-cap).reverse(); // tail view, newest first
    return newest.map((line, i) => {
      const { time, rest } = lineStamp(line);
      return {
        key: `c${shown.length - i}:${line.length}`,
        time,
        channel: tagOf(line) || 'log',
        text: rest,
        color: lineColor(line),
        copy: line,
      };
    });
  };

  const busLines = (channel: string | null, cap: number): LogLine[] => {
    const state = deps.bus();
    if (!state) return [];
    const rows = busRows(state); // newest first by global seq
    const picked = channel === null ? rows : rows.filter((r) => r.channel === channel);
    return picked.slice(0, cap).map((r) => ({
      key: `s${r.seq}`,
      time: `#${r.seq}`,
      channel: r.channel,
      text: `${r.route}  ${r.label}${r.at === null ? '  · note' : ''}`,
      color: null,
      copy: `#${r.seq} [${r.channel}] ${r.route} ${r.label}`,
    }));
  };

  return {
    deps,
    channelIds(): string[] {
      return [CHURN_ID, BUS_ID, ...channels().map((c) => `${BUS_PREFIX}${c.channel}`)];
    },
    labelOf(id: string): string {
      if (id === CHURN_ID) return 'churn (ring)';
      if (id === BUS_ID) return 'session bus';
      return id.startsWith(BUS_PREFIX) ? id.slice(BUS_PREFIX.length) : id;
    },
    rowsFor(id: string, lens: string, cap: number): LogLine[] {
      if (id === CHURN_ID) return churnRows(lens, cap);
      if (id === BUS_ID) return busLines(null, cap);
      const channel = id.startsWith(BUS_PREFIX) ? id.slice(BUS_PREFIX.length) : id;
      return busLines(lens === 'all' ? null : channel, cap);
    },
    stats(): LogStat[] {
      const ringLines = deps.ring.lines();
      const stamps = ringLines.map((l) => Number(lineStamp(l).time)).filter((n) => Number.isFinite(n) && n > 0);
      const churn: LogStat = {
        id: CHURN_ID,
        label: 'churn',
        big: `${ringLines.length}`,
        sub: deps.ring.enabled() ? 'logging' : 'paused',
        spark: sparkBuckets(
          stamps,
          stamps.length ? Math.min(...stamps) : 0,
          stamps.length ? Math.max(...stamps) : 1,
        ),
      };
      const state = deps.bus();
      if (!state) return [churn];
      const rows = busRows(state);
      const seqLo = rows.length ? rows[rows.length - 1].seq : 0;
      const seqHi = rows.length ? rows[0].seq : 1;
      const cards = channels().map((c): LogStat => {
        const seqs = rows.filter((r) => r.channel === c.channel).map((r) => r.seq);
        return {
          id: `${BUS_PREFIX}${c.channel}`,
          label: c.channel,
          big: `${c.commits}`,
          sub: `${c.sessions} session${c.sessions === 1 ? '' : 's'}${c.open ? ` · ${c.open} open` : ''}`,
          spark: sparkBuckets(seqs, seqLo, seqHi),
        };
      });
      return [churn, ...cards];
    },
    copyText(rows: LogLine[], selected: Set<string>): string {
      return rows.filter((r) => selected.has(r.key)).map((r) => r.copy).join('\n');
    },
    busState: () => deps.bus(),
    busError: () => deps.busError,
  };
}
