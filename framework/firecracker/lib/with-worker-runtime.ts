// withWorkerRuntime — recipe helper that bakes the reactjit runtime
// into a VmImage's rootfs.
//
// Every worker VM runs the same V8+reactjit substrate the host runs.
// Wrapping a recipe with `withWorkerRuntime(spec)` adds the BuildSteps
// that install `tools/v8cli`, drop the worker shell cart, and write
// the init script that launches reactjit at boot.
//
// The result is still a VmImage — same shape, same id space as the
// gallery's `vm-image.ts` runtime catalog row. Other recipe-side
// helpers (e.g. an agent-CLI installer) compose on top.

import type { VmImage, BuildStep } from '../recipe';

export interface WorkerRuntimeOptions {
  /** Path inside the rootfs where v8cli lands. Default '/usr/local/bin/v8cli'. */
  v8cliDest?: string;
  /** Host-side path to the v8cli binary. Default 'tools/v8cli'. */
  v8cliSrc?: string;
  /** Path inside the rootfs for the worker shell cart bundle. Default '/worker/cart.js'. */
  cartDest?: string;
  /** Host-side path to the bundled worker shell cart. Default
   *  'framework/firecracker/vm-runtime/cart.bundle.js' (produced by
   *  scripts/firecracker-build.js as part of the build pipeline). */
  cartSrc?: string;
  /** Init script path inside the rootfs. Default '/sbin/worker-init'. */
  initScriptDest?: string;
  /** Override the init script body (advanced). */
  initScriptBody?: string;
  /** When false, the helper is a no-op — same recipe back. Lets
   *  callers compose conditionally without an `if` ladder. */
  enabled?: boolean;
}

const DEFAULT_INIT_SCRIPT = `#!/bin/sh
# Worker init — boots the in-VM reactjit runtime with the worker shell
# cart. The cart reads its assignment from /worker/assignment.json,
# spawns the agent CLI subprocess, applies useIFTTT rules to its
# tool-call output, and mirrors the bus over vsock to the host.
set -eu
exec /usr/local/bin/v8cli /worker/cart.js
`;

/** Wrap a VmImage recipe so workers boot into reactjit. The returned
 *  recipe is identical except for prepended BuildSteps that install
 *  the runtime. Existing steps run after, so a recipe can layer agent
 *  CLI installation, custom tools, etc. on top. */
export function withWorkerRuntime(
  spec: VmImage,
  opts: WorkerRuntimeOptions = {},
): VmImage {
  if (opts.enabled === false) return spec;

  const v8cliDest = opts.v8cliDest ?? '/usr/local/bin/v8cli';
  const v8cliSrc = opts.v8cliSrc ?? 'tools/v8cli';
  const cartDest = opts.cartDest ?? '/worker/cart.js';
  const cartSrc = opts.cartSrc ?? 'framework/firecracker/vm-runtime/cart.bundle.js';
  const initScriptDest = opts.initScriptDest ?? '/sbin/worker-init';
  const initScriptBody = opts.initScriptBody ?? DEFAULT_INIT_SCRIPT;

  const runtimeSteps: BuildStep[] = [
    { copyFromHost: { src: v8cliSrc, dest: v8cliDest } },
    { copyFromHost: { src: cartSrc, dest: cartDest } },
    { writeFile: { path: initScriptDest, content: initScriptBody, mode: 0o755 } },
    // Make sure /worker/assignment.json exists with a default empty
    // body so the cart's read on first boot doesn't error before the
    // host has rendered an assignment.
    { writeFile: { path: '/worker/assignment.json', content: '{}\n', mode: 0o644 } },
  ];

  return {
    ...spec,
    apt: dedupe([...(spec.apt ?? []), 'ca-certificates']),
    steps: [
      ...runtimeSteps,
      ...(spec.steps ?? []),
    ],
  };
}

function dedupe<T>(xs: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const x of xs) {
    if (!seen.has(x)) { seen.add(x); out.push(x); }
  }
  return out;
}
