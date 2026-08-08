// cli/commands/orphans.ts - find and retire dev hosts nothing is attached to.
//
// `rjit orphans`         report only; kills nothing
// `rjit orphans --kill`  retire every orphan, one exact pid at a time
// `rjit orphans --json`  machine-readable, for the editor notice
//
// The report is the default because the user should see WHY a pid was classified
// before anything signals it. Every spared host says what spared it.

import { err, out } from '../host/log.ts';
import {
  formatGb,
  killOrphanHosts,
  scanDevHosts,
  type OrphanScan,
} from '../dev/orphan-hosts.ts';
import { DEV_SOCKET_PATH } from '../dev/rebuild-signal.ts';

function report(scan: OrphanScan): void {
  out(`[orphans] ${scan.hosts.length} dev host${scan.hosts.length === 1 ? '' : 's'} running · socket owner ${scan.socketOwner ?? 'none'}`);
  for (const host of scan.live) {
    out(`[orphans]   KEEP pid ${host.pid} (${host.elapsed}, ${formatGb(host.rssKb)}) — ${host.keptBecause.join('; ')}`);
  }
  for (const host of scan.orphans) {
    out(`[orphans]   ORPHAN pid ${host.pid} (${host.elapsed}, ${formatGb(host.rssKb)}) — reparented to init, no socket, no window`);
  }
  if (scan.orphans.length === 0) {
    out('[orphans] nothing to retire');
    return;
  }
  out(`[orphans] ${scan.orphans.length} orphan${scan.orphans.length === 1 ? '' : 's'} holding ${formatGb(scan.reclaimableKb)}`);
}

export async function run(argv: string[]): Promise<number> {
  let kill = false;
  let json = false;
  for (const arg of argv) {
    if (arg === '--kill') kill = true;
    else if (arg === '--json') json = true;
    else {
      err(`[orphans] unknown arg: ${arg}`);
      err('Usage: rjit orphans [--kill] [--json]');
      return 1;
    }
  }

  const rjitHome = __env('RJIT_HOME') || __cwd();
  const scan = scanDevHosts(rjitHome, DEV_SOCKET_PATH);

  if (!kill) {
    if (json) out(JSON.stringify(scan));
    else report(scan);
    return 0;
  }

  if (scan.orphans.length === 0) {
    if (json) out(JSON.stringify({ killed: [], scan }));
    else out('[orphans] nothing to retire');
    return 0;
  }

  // Exact pids, one at a time, each re-verified inside killOrphanHosts. Never a pattern.
  const outcomes = killOrphanHosts(rjitHome, DEV_SOCKET_PATH, scan.orphans.map((row) => row.pid));
  const retired = outcomes.filter((row) => row.ok);
  if (json) {
    out(JSON.stringify({ killed: outcomes, reclaimedKb: scan.reclaimableKb }));
  } else {
    for (const outcome of outcomes) {
      if (outcome.ok) out(`[orphans] retired pid ${outcome.pid} — ${outcome.how}`);
      else err(`[orphans] NOT retired, pid ${outcome.pid}: ${outcome.reason}`);
    }
    // Every "retired" above is a CONFIRMED exit, not a delivered signal. Only count the
    // memory of hosts that actually went away.
    const wedged = retired.filter((row) => row.how === 'wedged — needed SIGKILL').length;
    out(`[orphans] retired ${retired.length}/${outcomes.length}${retired.length === outcomes.length ? '' : ' — the rest are STILL RUNNING'}, reclaiming about ${formatGb(scan.reclaimableKb)}`);
    if (wedged > 0) {
      out(`[orphans] ${wedged} ignored SIGTERM and needed SIGKILL — their main loop was already gone, so the quit flag had no reader`);
    }
  }
  return retired.length === outcomes.length ? 0 : 1;
}
