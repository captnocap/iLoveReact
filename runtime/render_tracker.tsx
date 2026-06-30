import React, { Profiler } from 'react';
import type { ReactNode } from 'react';

type RenderStat = {
  id: string;
  commits: number;
  mounts: number;
  updates: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  lastMs: number;
  lastBaseMs: number;
  lastPhase: 'mount' | 'update' | 'nested-update';
  lastCommitAt: number;
};

type RenderStatsSnapshot = {
  summary: {
    regions: number;
    commits: number;
    updates: number;
    totalMs: number;
    maxMs: number;
  };
  top: RenderStat[];
  recent: RenderStat[];
};

type InternalRenderStat = Omit<RenderStat, 'avgMs'>;

const STATS = new Map<string, InternalRenderStat>();
const RECENT_LIMIT = 24;
const recentIds: string[] = [];

function now(): number {
  return (globalThis as any).performance?.now?.() ?? Date.now();
}

function roundMs(value: number): number {
  return Number(value.toFixed(3));
}

function publicStat(stat: InternalRenderStat): RenderStat {
  return {
    ...stat,
    totalMs: roundMs(stat.totalMs),
    avgMs: stat.commits > 0 ? roundMs(stat.totalMs / stat.commits) : 0,
    maxMs: roundMs(stat.maxMs),
    lastMs: roundMs(stat.lastMs),
    lastBaseMs: roundMs(stat.lastBaseMs),
    lastCommitAt: roundMs(stat.lastCommitAt),
  };
}

function recordRender(
  id: string,
  phase: 'mount' | 'update' | 'nested-update',
  actualDuration: number,
  baseDuration: number,
  commitTime: number,
): void {
  const stat = STATS.get(id) ?? {
    id,
    commits: 0,
    mounts: 0,
    updates: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
    lastBaseMs: 0,
    lastPhase: phase,
    lastCommitAt: 0,
  };
  stat.commits += 1;
  if (phase === 'mount') stat.mounts += 1;
  else stat.updates += 1;
  stat.totalMs += actualDuration;
  stat.maxMs = Math.max(stat.maxMs, actualDuration);
  stat.lastMs = actualDuration;
  stat.lastBaseMs = baseDuration;
  stat.lastPhase = phase;
  stat.lastCommitAt = commitTime || now();
  STATS.set(id, stat);

  recentIds.unshift(id);
  if (recentIds.length > RECENT_LIMIT) recentIds.length = RECENT_LIMIT;
}

function readRenderStats(limit = 12): RenderStatsSnapshot {
  const cap = Number.isFinite(limit) && limit > 0 ? limit : 12;
  const stats = Array.from(STATS.values());
  const top = [...stats].sort((a, b) => b.totalMs - a.totalMs).slice(0, cap).map(publicStat);
  const recent = recentIds
    .map((id) => STATS.get(id))
    .filter(Boolean)
    .map((stat) => publicStat(stat!));
  const commits = stats.reduce((sum, stat) => sum + stat.commits, 0);
  const updates = stats.reduce((sum, stat) => sum + stat.updates, 0);
  const totalMs = stats.reduce((sum, stat) => sum + stat.totalMs, 0);
  const maxMs = stats.reduce((max, stat) => Math.max(max, stat.maxMs), 0);
  return {
    summary: {
      regions: stats.length,
      commits,
      updates,
      totalMs: roundMs(totalMs),
      maxMs: roundMs(maxMs),
    },
    top,
    recent,
  };
}

function resetRenderStats(): void {
  STATS.clear();
  recentIds.length = 0;
}

export default function RenderProbe({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Profiler id={id} onRender={(probeId, phase, actualDuration, baseDuration, _startTime, commitTime) => {
      recordRender(probeId, phase, actualDuration, baseDuration, commitTime);
    }}>
      {children}
    </Profiler>
  );
}

(globalThis as any).__getRenderStats = readRenderStats;
(globalThis as any).__resetRenderStats = resetRenderStats;
