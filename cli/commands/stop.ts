// cli/commands/stop.ts - shut the dev session down on purpose.
//
// `rjit dev` is the only verb that starts a dev host, and until now there was no
// verb that stopped one. Closing the terminal is not that verb: a supervisor
// killed outright never runs its exit path, and the host it launched carries on
// with a window on screen and a gigabyte of RSS. The user's whole question in
// req_4109 was "how am I supposed to get rid of it without always going to run
// kill" — and the honest answer was that they weren't, because no command did it.
//
// `rjit orphans --kill` is deliberately not that command either. It retires only
// hosts that nothing is attached to, and it SPARES anything holding the dev
// socket or a window — which is exactly the host you mean when you say "stop the
// dev server". Sparing it is right for an automatic sweep and wrong for a direct
// order. So: `orphans` is the sweep, `stop` is the order.
//
// Same safety spine as the sweep (cli/dev/orphan-hosts.ts): exact numeric pids
// only, never a pattern; every pid printed with what it is before anything is
// signalled; SIGTERM then verify then escalate then verify, so "stopped" means
// the process is GONE rather than "the signal was sent".

import { err, out } from '../host/log.ts';
import {
  formatGb,
  retirePid,
  scanDevHosts,
  scanDevWatchers,
  type OrphanKillOutcome,
} from '../dev/orphan-hosts.ts';
import { DEV_SOCKET_PATH } from '../dev/rebuild-signal.ts';

type StopArgs = { dryRun: boolean };

function usage(): number {
  err('Usage: rjit stop [--dry-run]');
  err('  Stops the running dev host and its bundle watcher(s).');
  err('  --dry-run   list what would be stopped, signal nothing');
  return 1;
}

function parseArgs(argv: string[]): StopArgs | number {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') dryRun = true;
    else {
      err(`[stop] unknown arg: ${arg}`);
      return usage();
    }
  }
  return { dryRun };
}

function describeOutcome(outcome: OrphanKillOutcome): string {
  if (outcome.ok) return outcome.how ?? 'stopped';
  return outcome.reason ?? 'did not stop';
}

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (typeof parsed === 'number') return parsed;

  const rjitHome = __env('RJIT_HOME') || __cwd();
  const scan = scanDevHosts(rjitHome, DEV_SOCKET_PATH);
  // Excluding our own pid is belt-and-braces — this scan matches argv
  // positionally, so `rjit stop` could not match a `watch-and-push` row anyway.
  const watchers = scanDevWatchers(rjitHome, __pid());

  if (scan.hosts.length === 0 && watchers.length === 0) {
    out('[stop] no dev host or watcher running');
    return 0;
  }

  // Say what is about to be signalled, and what each thing is, BEFORE signalling
  // any of it. A list you can read is the difference between a stop and a sweep.
  for (const host of scan.hosts) {
    const note = host.keptBecause.length > 0 ? host.keptBecause.join('; ') : 'reparented to init, no socket, no window';
    out(`[stop]   host pid ${host.pid} (${host.elapsed}, ${formatGb(host.rssKb)}) — ${note}`);
  }
  for (const watcher of watchers) {
    const launcher = watcher.ppid === 1 ? 'its launcher is gone' : `launched by pid ${watcher.ppid}`;
    out(`[stop]   watcher pid ${watcher.pid} (${watcher.elapsed}) — watching '${watcher.cart}', ${launcher}`);
  }

  if (parsed.dryRun) {
    out(`[stop] --dry-run: ${scan.hosts.length + watchers.length} process(es) left running`);
    return 0;
  }

  // Watchers first. A watcher that outlives the stop by even a moment will push
  // a bundle at whatever host it can still reach, which is worse than wasteful.
  let failures = 0;
  for (const watcher of watchers) {
    const outcome = retirePid(watcher.pid);
    if (!outcome.ok) failures += 1;
    out(`[stop] watcher ${watcher.pid} — ${describeOutcome(outcome)}`);
  }
  let reclaimedKb = 0;
  for (const host of scan.hosts) {
    const outcome = retirePid(host.pid);
    if (outcome.ok) reclaimedKb += host.rssKb;
    else failures += 1;
    out(`[stop] host ${host.pid} — ${describeOutcome(outcome)}`);
  }

  if (failures > 0) {
    err(`[stop] ${failures} process(es) did not stop — see the reasons above`);
    return 1;
  }
  out(`[stop] dev session stopped · ${formatGb(reclaimedKb)} reclaimed`);
  return 0;
}
