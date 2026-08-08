// cli/commands/help.ts - top-level help for the rjit CLI.

import { tryFsRead } from '../host/fs.ts';
import { err, out } from '../host/log.ts';

const TEMPLATES = ['basic', 'routes', 'dashboard', 'taskboard', 'canvas', 'stdlib'];
const SUBCOMMANDS = ['init', 'dev', 'stop', 'gdev', 'tui', 'ship', 'ship-tui', 'pack', 'play', 'shot', 'autotest', 'classify', 'clean', 'orphans', 'bake-icons', 'pack-sdk', 'firecracker-build', 'help'] as const;

type HelpCommand = typeof SUBCOMMANDS[number];

const SUBCOMMAND_DOC: Record<HelpCommand, { summary: string; usage: string[]; detail: string[] }> = {
  init: {
    summary: 'scaffold a new cart from a template',
    usage: ['rjit init <directory>', 'rjit init <directory> <template>', 'rjit init <template> <directory>'],
    detail: [
      'Templates:',
      `  ${TEMPLATES.join(', ')}`,
      '',
      'The one-argument form uses the basic template.',
      'The directory is created if it does not exist; existing files are',
      'never overwritten.',
    ],
  },
  dev: {
    summary: 'iterate on a cart with hot reload',
    usage: ['rjit dev <cart-name> [--gui|--tui]'],
    detail: [
      'Bundles cart/<name>.tsx -> .cache/bundle-<name>.js, then either:',
      '  1. pushes the bundle to a running dev host (one already on',
      '     /tmp/reactjit.sock), upserting its tab, or',
      '  2. spawns a fresh dev host and starts a watch loop that',
      '     re-pushes on every save.',
      '',
      'TSX / TS edits hot-reload in ~300ms. Zig / framework / build.zig',
      'edits compile in the background, then wait for explicit approval in',
      'the editor before any native module activation or host restart.',
      '',
      '--tui (alias --headless) runs the headless substrate; --gui is the',
      'default unless cart.json declares "surface": "tui".',
    ],
  },
  gdev: {
    summary: 'iterate on game carts with a lean hot-reload host',
    usage: ['rjit gdev [cart-name] [--gui|--tui]'],
    detail: [
      'Game-focused sibling of rjit dev. Defaults to cart/hmsc-int, bundles',
      'to .cache/gdev-bundle-<name>.js, and starts a separate game dev host',
      'on /tmp/reactjit-gdev.sock.',
      '',
      'Unlike rjit dev, this builds native flags from the cart metafile',
      'instead of linking every dev feature, and it does not bootstrap',
      'embedded Postgres. Future game-only services should slot into this',
      'command instead of the general cart dev path.',
    ],
  },
  ship: {
    summary: 'build a cart into a single self-extracting binary',
    usage: ['rjit ship <cart-name> [--gui|--tui]          # release, self-extracting'],
    detail: [
      'Pipeline:',
      '  1. esbuild cart/<name>.tsx -> bundle-<name>.js',
      "  2. resolver inspects the bundle's metafile and selects the",
      '     -Dhas-* feature flags from sdk/dependency-registry.json',
      '  3. zig build app -> zig-out/bin/<name>',
      '  4. ldd-walk + tar + self-extracting shell header',
      '',
      'Result is one file you can move anywhere; on first run it',
      'extracts to ~/.cache/reactjit-<name>/<sig>/ and execs.',
      '',
      '--tui (alias --headless) builds the headless substrate; --gui is the',
      'default unless cart.json declares "surface": "tui".',
    ],
  },
  tui: {
    summary: 'run a TUI cart in the foreground terminal',
    usage: ['rjit tui [cart-name|entry.tsx] [-- app-args...]'],
    detail: [
      'Bundles the cart through tui/entry.tsx, builds a headless native',
      'binary, then execs it with the current terminal attached. This is',
      'the interactive path: alt-screen painting, raw input, mouse reporting,',
      'and Ctrl-C all belong to the TUI app.',
      '',
      'Use `rjit dev <cart-name> --tui` only for the experimental persistent',
      'TUI dev host. That path is log/socket-oriented and is not the same as',
      'foreground terminal execution.',
    ],
  },
  'ship-tui': {
    summary: 'compatibility alias for ship --tui',
    usage: ['rjit ship-tui <cart-name> [--fat]'],
    detail: [
      'Equivalent to:',
      '  rjit ship <cart-name> --tui',
      '',
      'Kept for muscle memory during the migration; the canonical command is',
      'rjit ship <cart-name> --tui.',
    ],
  },
  pack: {
    summary: 'build a game package (.rjpkg)',
    usage: ['rjit pack hmsc [--out path/to/hmsc.rjpkg]'],
    detail: [
      'Builds the hmsc cartridge bundle and emits the package manifest plus',
      'the slice-1 binary mapfile under maps/city.map.',
    ],
  },
  play: {
    summary: 'run a game package with the package player',
    usage: ['rjit play path/to/game.rjpkg'],
    detail: [
      'Builds zig-out/bin/rjit-player when missing, then boots that player',
      'binary with the package path.',
    ],
  },
  shot: {
    summary: "capture a cart's OWN rendered frame headless (never the desktop)",
    usage: ['rjit shot <cart> [--out path.png] [--route /r] [--frames N] [--timeout S] [-- app-args...]'],
    detail: [
      'SELFSHOT-0606: desktop/X11 capture of the user\'s system is BANNED.',
      'This boots the cart\'s shipped binary with a HIDDEN window',
      '(ZIGOS_HEADLESS=1 — never shown on any desktop), optionally navigates',
      'to --route (RJIT_BOOT_ROUTE), renders N frames (default 60), captures',
      'the app\'s own swapchain to a PNG, and exits. The PNG is then asserted',
      '(magic, IHDR dims, plausible size) — exit 0 = PASS, so this doubles as',
      'the capability\'s smoke test.',
      '',
      'Default output: shots/<cart>-<stamp>.png. Builds via ship when the',
      'binary is stale. The live-app sibling is the in-app console verb',
      '`shot [path]` (__capture_frame — same readback, no exit).',
    ],
  },
  autotest: {
    summary: 'run a headless witness test and proof grid',
    usage: ['rjit autotest <name>'],
    detail: [
      'Looks for tests/<name>.autotest and cart/<name>/index.tsx or',
      'cart/<name>.tsx.',
      '',
      'Builds the cart when needed, runs the binary with ZIGOS_WITNESS=autotest,',
      'then calls scripts/autotest-grid to write tests/screenshots/<name>/proof.png',
      'and archive the run under a timestamped PASS/FAIL directory.',
    ],
  },
  classify: {
    summary: 'extract and migrate JSX classifier patterns',
    usage: [
      'rjit classify [--dir path] [--output file] [--min n] [--dry-run]',
      'rjit classify migrate|rename|add|partial|theme|pick ...',
    ],
    detail: [
      'Scans TSX files for repeated primitive style/prop patterns and writes',
      'a .cls.ts classifier sheet. Subcommands handle migration, renaming,',
      'manual classifier insertion, partial-pattern mining, and theme-token',
      'suggestions.',
    ],
  },
  stop: {
    summary: 'stop the running dev host and its bundle watcher(s)',
    usage: ['rjit stop', 'rjit stop --dry-run'],
    detail: [
      'The counterpart to `rjit dev`. Closing the terminal is not a reliable stop:',
      'a supervisor killed outright never runs its exit path, and the host keeps',
      'its window and its gigabyte of RSS (req_4109).',
      '',
      'This is an ORDER, not a sweep. `rjit orphans --kill` spares anything holding',
      'the dev socket or a window — correct for an automatic sweep, wrong when you',
      'have said "stop it". `stop` retires the host you can see, plus the bundle',
      'watchers, which nothing else scanned at all.',
      '',
      'Every pid is printed with what it is before anything is signalled, exact',
      'numeric pids only, and each is verified GONE (SIGTERM, verify, escalate,',
      'verify) before it is reported stopped.',
      '',
      'Hosts launched after this change also die with their supervisor on their own:',
      'they arm the kernel parent-death signal (framework/proc_lifetime.zig), which',
      'covers the SIGKILLs and crashes no exit path can.',
    ],
  },
  orphans: {
    summary: 'find dev hosts nothing is attached to, and retire them by exact pid',
    usage: ['rjit orphans', 'rjit orphans --kill', 'rjit orphans --json'],
    detail: [
      'A `rjit dev` run that dies without taking its host down leaves the host',
      'running, reparented to init. It holds no window and serves no socket, so',
      'it is invisible — nine had accumulated over six days holding 4.7GB before',
      'anyone noticed (req_4074).',
      '',
      'A pid is only called an orphan when THREE facts agree: reparented to init,',
      'not the dev socket listener, and holding no dmabuf or display-server handle.',
      'Anything failing one of them is kept, and the report says what kept it.',
      '',
      'There is deliberately no pattern form. `pkill -f <repo path>` matches the',
      'polling shell that is running it and cascades — that is what logged the user',
      'out of their desktop and killed all 14 worker panes on 2026-04-22. This',
      'command emits exact numeric pids and signals them one at a time, re-checking',
      'each immediately before it does.',
      '',
      'The editor shows the same finding as a notice; approving it there writes a',
      'one-shot token the dev supervisor acts on, so the editor never signals',
      'anything itself.',
    ],
  },
  clean: {
    summary: 'report / drop the local zig cache (the per-build disk eater)',
    usage: ['rjit clean', 'rjit clean --drop'],
    detail: [
      'Zig never evicts .zig-cache/o entries, and every build lands a fresh',
      'multi-hundred-MB one (it reached 756GB on 2026-07-03). Successful',
      'ship/dev builds auto-drop the whole cache once it outgrows the budget',
      '(RJIT_CACHE_MAX_GB, default 100GB; 0 disables).',
      '',
      'No partial prune exists ON PURPOSE: zig derives o/<hash> names by',
      're-hashing manifest inputs, so deleting a subset of o/ poisons the',
      'surviving manifests and wedges every build. All or nothing.',
      '',
      '--drop   drop the whole cache now; the next build is fully cold',
    ],
  },
  'bake-icons': {
    summary: 'bake runtime icon polylines into the GPU SDF atlas',
    usage: ['rjit bake-icons'],
    detail: [
      'Reads runtime/icons/icons.ts and writes:',
      '  framework/gpu/icon_atlas.zig',
      '  framework/gpu/icon_atlas_debug.ppm.txt',
      '  runtime/icons/baked-names.ts',
    ],
  },
  'pack-sdk': {
    summary: 'build the self-extracting rjit SDK distributable',
    usage: ['rjit pack-sdk [--out path] [--keep-stage]'],
    detail: [
      'Stages the toolchain, runtime/framework sources, dependency registry,',
      'vendored packages, generated CLI bundle, and sysroot payload into a',
      'single shell self-extractor.',
    ],
  },
  'firecracker-build': {
    summary: 'build a Firecracker rootfs from a TS recipe',
    usage: ['rjit firecracker-build <recipe.ts>'],
    detail: [
      'Bundles the recipe with esbuild, evaluates its default export, then',
      'runs mmdebstrap to emit the requested ext4 or squashfs image and',
      'writes a manifest beside the image.',
    ],
  },
  help: {
    summary: 'print this help, or per-subcommand help',
    usage: ['rjit help', 'rjit help <subcommand>'],
    detail: [],
  },
};

interface Registry {
  features?: Record<string, { buildOptions?: string[] }>;
}

export async function run(argv: string[]): Promise<number> {
  const target = argv[0];
  const registry = readRegistry();
  if (!target) {
    printTopLevel(registry);
    return 0;
  }
  return printSubcommand(target);
}

export function printTopLevel(registry: Registry | null = readRegistry()): void {
  const lines = [
    'rjit - ReactJIT cart toolchain',
    '',
    'Usage:',
    '  rjit <subcommand> [args]',
    '',
    'Subcommands:',
  ];
  for (const name of SUBCOMMANDS) {
    lines.push(`  ${pad(name, 8)}${SUBCOMMAND_DOC[name].summary}`);
  }
  lines.push('');
  lines.push('Run `rjit help <subcommand>` for details.');
  lines.push('');
  const features = listFeatures(registry);
  if (features.length) {
    lines.push('Source-driven build features (selected by the resolver from');
    lines.push("the cart's esbuild metafile; you don't pass these by hand):");
    lines.push(...features);
    lines.push('');
  }
  __writeStdout(lines.join('\n') + '\n');
}

function printSubcommand(name: string): number {
  if (!isHelpCommand(name)) {
    err(`rjit help: unknown subcommand: ${name}`);
    err('try: rjit help');
    return 1;
  }
  const doc = SUBCOMMAND_DOC[name];
  const lines = [`rjit ${name} - ${doc.summary}`, '', 'Usage:'];
  for (const usage of doc.usage) lines.push(`  ${usage}`);
  if (doc.detail.length) {
    lines.push('');
    lines.push(...doc.detail);
  }
  out(lines.join('\n'));
  return 0;
}

function readRegistry(): Registry | null {
  const raw = tryFsRead(`${__cwd()}/sdk/dependency-registry.json`);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as Registry;
  } catch {
    return null;
  }
}

function listFeatures(registry: Registry | null): string[] {
  if (!registry?.features) return [];
  const lines: string[] = [];
  for (const name of Object.keys(registry.features).sort()) {
    const feature = registry.features[name]!;
    const flags = (feature.buildOptions ?? []).map((option) => `-D${option}=true`).join(' ');
    lines.push(`  ${pad(name, 16)}${flags || '(no build flag)'}`);
  }
  return lines;
}

function pad(value: string, length: number): string {
  if (value.length >= length) return `${value}  `;
  return value + ' '.repeat(length - value.length);
}

function isHelpCommand(value: string): value is HelpCommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}
