// cli/dev/child-lifetime.ts — spawn a child that cannot outlive this process.
//
// `rjit dev` supervises two long-lived children: the dev host itself and the
// bundle watcher. Both must go when the supervisor goes. v8cli's signal
// handlers already kill tracked children on SIGINT/SIGTERM/SIGHUP, which covers
// Ctrl-C and a polite hangup — but a SIGKILL, an OOM kill, or a crashed
// supervisor never runs a handler, and those are the deaths that leave a dev
// host reparented to init with a window still on screen (req_4074, req_4109).
//
// The kernel-side half of the contract is framework/proc_lifetime.zig: a child
// that sees this variable arms PR_SET_PDEATHSIG, so the KERNEL signals it when
// its launcher dies, whatever killed the launcher. This module is the only
// place that names the variable, so the two halves cannot drift apart.
//
// It is opt-in per spawn on purpose. `rjit ship`'s zig build, a bundle push,
// and anything the user starts by hand must NOT inherit it — a build that
// outlives its shell is correct; a dev host that outlives its supervisor is
// the bug this fixes.

import { spawn } from '../host/process.ts';

/** Must match framework/proc_lifetime.zig ENV_KEY. */
export const DIE_WITH_PARENT_ENV = 'RJIT_DIE_WITH_PARENT';

/**
 * Spawn `cmd` so the kernel kills it when THIS process dies.
 *
 * `extraEnv` entries are plain `KEY=VALUE` strings, applied ahead of the
 * command exactly as `env(1)` takes them.
 */
export function spawnTiedToUs(cmd: string, args: string[], extraEnv: string[] = []): { id: number } {
  return spawn('env', [`${DIE_WITH_PARENT_ENV}=1`, ...extraEnv, cmd, ...args]);
}
