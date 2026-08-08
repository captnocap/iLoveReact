// cli/dev/orphan-hosts.ts — find dev hosts nothing is attached to any more.
//
// A `rjit dev` run that dies without taking its host down leaves the host running,
// reparented to init. It holds no window, serves no socket, and answers nothing — it
// just sits on a gigabyte of RSS until someone notices. On 2026-08-08 there were NINE,
// the oldest six days old, holding 4.7 GB between them, and the user's honest reaction
// was "I have 1 running app as far as I am concerned" (req_4074). They were right: the
// orphans are invisible by definition, so the tooling has to be what sees them.
//
// SAFETY IS THE WHOLE DESIGN. Killing by pattern is what logged the user out of their
// desktop and killed all 14 worker panes on 2026-04-22 — `pkill -f <repo path>` matches
// the polling shell's own command line and cascades. So this module never produces a
// pattern: it produces exact numeric PIDs, each one proven orphaned by three independent
// facts, and the caller kills them one at a time by number.

import { spawnSync } from '../host/process.ts';

export const DEV_HOST_BINARY = 'zig-out/bin/reactjit-dev';

export type DevHostProcess = {
  pid: number;
  ppid: number;
  /** Resident set size in KB, as ps reports it. */
  rssKb: number;
  /** ps state field — a trailing `+` means it is in a foreground process group. */
  state: string;
  elapsed: string;
  startedAt: string;
};

export type OrphanVerdict = DevHostProcess & {
  orphan: boolean;
  /** Why this process was spared, when it was. Empty for orphans. */
  keptBecause: string[];
};

export type OrphanScan = {
  hosts: OrphanVerdict[];
  orphans: OrphanVerdict[];
  live: OrphanVerdict[];
  /** The pid that owns the dev socket, when one could be read. */
  socketOwner: number | null;
  reclaimableKb: number;
};

/** Parse `ps` output. Split out so the classifier is testable without a process table. */
export function parseDevHostProcesses(psOutput: string, binaryPath: string): DevHostProcess[] {
  const hosts: DevHostProcess[] = [];
  for (const line of psOutput.split('\n')) {
    // pid ppid rss state elapsed <args...> — ps pads with spaces, so split on runs.
    const fields = line.trim().split(/\s+/);
    if (fields.length < 6) continue;
    // The EXECUTABLE must be the dev host, not merely a command line that mentions the
    // path. A substring match would also match this scan's own shell, which is exactly
    // the self-matching class of bug that makes `pkill -f` unsafe here.
    if (fields[5] !== binaryPath) continue;
    const pid = Number(fields[0]);
    const ppid = Number(fields[1]);
    const rssKb = Number(fields[2]);
    if (!Number.isInteger(pid) || pid <= 1 || !Number.isInteger(ppid)) continue;
    hosts.push({ pid, ppid, rssKb: Number.isFinite(rssKb) ? rssKb : 0, state: fields[3] ?? '', elapsed: fields[4] ?? '', startedAt: '' });
  }
  return hosts;
}

/** Which pid is LISTENING on the dev socket. That host is serving every `tools/seat`
 *  call and every agent lane; it is never an orphan, whatever else is true of it. */
export function parseSocketOwner(ssOutput: string, socketPath: string): number | null {
  for (const line of ssOutput.split('\n')) {
    if (!line.includes(socketPath)) continue;
    const match = /pid=(\d+)/.exec(line);
    if (match) return Number(match[1]);
  }
  return null;
}

/** Three independent facts must ALL agree before a pid is called an orphan, because the
 *  cost of a false positive is killing the window someone is working in:
 *    1. reparented to init (its launcher is gone),
 *    2. not the dev socket's listener,
 *    3. holding no display or GPU file descriptors — no window on screen.
 *  A process that fails any one of them is kept, and the reason is reported. */
export function classifyDevHosts(
  hosts: readonly DevHostProcess[],
  socketOwner: number | null,
  displayFdCount: (pid: number) => number,
): OrphanScan {
  const verdicts: OrphanVerdict[] = hosts.map((host) => {
    const keptBecause: string[] = [];
    if (host.ppid !== 1) keptBecause.push(`its launcher is still alive (ppid ${host.ppid})`);
    if (socketOwner !== null && host.pid === socketOwner) keptBecause.push('it owns the dev socket');
    const fds = displayFdCount(host.pid);
    if (fds > 0) keptBecause.push(`it holds ${fds} display/GPU handle${fds === 1 ? '' : 's'}`);
    return { ...host, orphan: keptBecause.length === 0, keptBecause };
  });
  const orphans = verdicts.filter((row) => row.orphan);
  return {
    hosts: verdicts,
    orphans,
    live: verdicts.filter((row) => !row.orphan),
    socketOwner,
    reclaimableKb: orphans.reduce((sum, row) => sum + row.rssKb, 0),
  };
}

/** Handles that prove a pid is PRESENTING something. Measured, not assumed: on this
 *  machine every dev host — orphan or not — keeps `/dev/dri/renderD128` open, because
 *  that only means the GPU was initialised once. The honest signal is a dmabuf (a buffer
 *  actually handed to the compositor) or a connection to the display server socket. An
 *  orphan has neither; the live host had three dmabufs. Matching the render node instead
 *  spared every orphan and made this whole scan useless. */
export function displayHandleCount(pid: number): number {
  const listed = spawnSync('ls', ['-l', `/proc/${pid}/fd`]);
  if (listed.code !== 0) return 0;
  let count = 0;
  for (const line of (listed.stdout ?? '').split('\n')) {
    if (/dmabuf|wayland|X11-unix/i.test(line)) count += 1;
  }
  return count;
}

export function scanDevHosts(rjitHome: string, socketPath: string): OrphanScan {
  const binary = `${rjitHome}/${DEV_HOST_BINARY}`;
  const listed = spawnSync('ps', ['-eo', 'pid,ppid,rss,stat,etime,args', '--no-headers']);
  const hosts = parseDevHostProcesses(listed.stdout ?? '', binary);
  const sockets = spawnSync('ss', ['-xlp']);
  const owner = parseSocketOwner(sockets.stdout ?? '', socketPath);
  return classifyDevHosts(hosts, owner, displayHandleCount);
}

export type OrphanKillOutcome = {
  pid: number;
  /** TRUE only when the process is confirmed GONE — never merely "the signal was sent". */
  ok: boolean;
  /** How it ended, so a wedged host is visible as a wedge instead of a clean retirement. */
  how?: 'exited on SIGTERM' | 'wedged — needed SIGKILL';
  reason?: string;
};

/** Is this pid still alive? `kill -0` signals nothing and only tests deliverability. */
function isAlive(pid: number): boolean {
  return spawnSync('kill', ['-0', String(pid)]).code === 0;
}

/** Poll for a pid to disappear, up to `attempts` × 100ms. A healthy dev host drops out of
 *  its main loop and exits well inside this window. */
function waitForExit(pid: number, attempts: number): boolean {
  for (let i = 0; i < attempts; i += 1) {
    if (!isAlive(pid)) return true;
    spawnSync('sleep', ['0.1']);
  }
  return !isAlive(pid);
}

/** Retire ONE pid, by number, and do not return until its fate is known. Shared by the
 *  orphan sweep and by `rjit stop`, so both escalate and both verify identically. */
export function retirePid(pid: number): OrphanKillOutcome {
  if (!Number.isInteger(pid) || pid <= 1) return { pid, ok: false, reason: 'not a valid pid' };

  // SIGTERM first: engine.zig catches it and flips the quit flag the main loop polls, so
  // a healthy host runs its full teardown (SDL_CaptureMouse(false), SDL_Quit, state
  // saves) instead of leaving the X server holding a captured pointer.
  const termed = spawnSync('kill', [String(pid)]);
  if (termed.code !== 0) {
    return { pid, ok: false, reason: (termed.stderr ?? '').trim() || `kill exited ${termed.code}` };
  }
  if (waitForExit(pid, 20)) return { pid, ok: true, how: 'exited on SIGTERM' };

  // Still here after 2s. `kill` exiting 0 only means the signal was DELIVERED, and an
  // orphan is usually parked in futex_wait with its main loop already gone — nothing is
  // left to poll the quit flag, so SIGTERM sits there forever. Reporting success off that
  // exit code claimed "retired 9/9, reclaiming 4.7 GB" while all nine were still running
  // (req_4088). Escalate, then verify again, and only then call it retired.
  spawnSync('kill', ['-KILL', String(pid)]);
  if (waitForExit(pid, 10)) return { pid, ok: true, how: 'wedged — needed SIGKILL' };
  return { pid, ok: false, reason: 'survived SIGTERM and SIGKILL — likely stuck in an uninterruptible syscall (state D)' };
}

/** Kill exactly these pids, one numeric signal at a time. There is deliberately no
 *  pattern form and no "kill everything that looks like X" — see the header. Each pid is
 *  re-verified as an orphan immediately before its signal, so a host that acquired a
 *  window between the scan and the click is spared. */
export function killOrphanHosts(
  rjitHome: string,
  socketPath: string,
  pids: readonly number[],
): OrphanKillOutcome[] {
  const scan = scanDevHosts(rjitHome, socketPath);
  const stillOrphaned = new Set(scan.orphans.map((row) => row.pid));
  return pids.map((pid) => {
    if (!Number.isInteger(pid) || pid <= 1) return { pid, ok: false, reason: 'not a valid pid' };
    if (!stillOrphaned.has(pid)) return { pid, ok: false, reason: 'no longer classifies as an orphan — it was spared' };
    return retirePid(pid);
  });
}

export function formatGb(kb: number): string {
  return `${(kb / 1048576).toFixed(1)} GB`;
}

// ── the other half of a dev session ───────────────────────────────────────────
// A `rjit dev` run supervises TWO children: the host and the bundle watcher. Only the
// host was ever scanned, so abandoned watchers accumulated completely unseen — req_4109
// found one still rebundling on a core-build-id two hours stale, next to the host it no
// longer matched. A watcher costs 30 MB rather than a gigabyte, but a stale one pushes
// bundles into whatever host it can reach, which is worse than merely wasteful.

export type DevWatcherProcess = {
  pid: number;
  ppid: number;
  elapsed: string;
  /** The cart it watches — `rjit dev <cart>`'s argument. */
  cart: string;
};

/**
 * Parse `ps` output for `rjit watch-and-push` processes.
 *
 * The match is POSITIONAL, not a substring sweep: argv must be exactly
 * `<v8cli> <rjit.js> watch-and-push <cart> …`. A substring test for
 * "watch-and-push" would also match the shell running this scan — the
 * self-matching bug that makes `pkill -f` unsafe here — so `selfPid` is
 * excluded outright as well.
 */
export function parseDevWatchers(psOutput: string, rjitScript: string, selfPid: number): DevWatcherProcess[] {
  const watchers: DevWatcherProcess[] = [];
  for (const line of psOutput.split('\n')) {
    const fields = line.trim().split(/\s+/);
    // pid ppid rss stat etime <v8cli> <rjit.js> <verb> <cart>
    if (fields.length < 9) continue;
    if (fields[6] !== rjitScript) continue;
    if (fields[7] !== 'watch-and-push') continue;
    const pid = Number(fields[0]);
    const ppid = Number(fields[1]);
    if (!Number.isInteger(pid) || pid <= 1 || pid === selfPid) continue;
    watchers.push({ pid, ppid, elapsed: fields[4] ?? '', cart: fields[8] ?? '?' });
  }
  return watchers;
}

export function scanDevWatchers(rjitHome: string, selfPid: number): DevWatcherProcess[] {
  const listed = spawnSync('ps', ['-eo', 'pid,ppid,rss,stat,etime,args', '--no-headers']);
  return parseDevWatchers(listed.stdout ?? '', `${rjitHome}/tools/rjit.js`, selfPid);
}

// ── the approval handshake ────────────────────────────────────────────────────
// The EDITOR never signals a process. It writes a one-shot token file and the dev
// supervisor — the thing that already owns process lifetime — does the retiring, which
// keeps every kill on the exact pids a person was shown and clicked.

export const ORPHAN_APPROVAL_FILENAME = 'dev-orphan-cleanup.json';
export const ORPHAN_TOKEN_PREFIX = 'orphan-hosts-v1:';

export function orphanApprovalPath(rjitHome: string): string {
  return `${rjitHome}/.cache/${ORPHAN_APPROVAL_FILENAME}`;
}

/** A token binds the notice to the exact pid set it advertised, so an approval that
 *  arrives after the situation changed is stale rather than approximately right. */
export function orphanCleanupToken(pids: readonly number[]): string {
  return `${ORPHAN_TOKEN_PREFIX}${[...pids].sort((a, b) => a - b).join('-')}`;
}

export type OrphanCleanupApproval = { token: string; pids: number[] };

export function parseOrphanCleanupApproval(raw: string | null): OrphanCleanupApproval | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (typeof value?.token !== 'string' || !value.token.startsWith(ORPHAN_TOKEN_PREFIX)) return null;
    const pids = Array.isArray(value?.pids)
      ? value.pids.filter((pid: unknown) => Number.isInteger(pid) && (pid as number) > 1)
      : [];
    return pids.length > 0 ? { token: value.token, pids } : null;
  } catch {
    return null;
  }
}
