// scripts/help.js — top-level help for the rjit CLI.
//
// Runs via:
//   tools/v8cli scripts/help.js                  # full help
//   tools/v8cli scripts/help.js <subcommand>     # per-subcommand help
//
// Subcommands listed here mirror the entry points the future rjit
// dispatcher will dispatch to (init, dev, ship, help). The feature
// catalogue is sourced from sdk/dependency-registry.json so docs and
// build-time gating stay in sync.

const ROOT = __cwd();
const REGISTRY_PATH = ROOT + '/sdk/dependency-registry.json';

const TEMPLATES = ['basic', 'routes', 'dashboard', 'taskboard', 'canvas', 'stdlib'];

const SUBCOMMANDS = ['init', 'dev', 'ship', 'help'];

const SUBCOMMAND_DOC = {
  init: {
    summary: 'scaffold a new cart from a template',
    usage: [
      'rjit init <directory>',
      'rjit init <directory> <template>',
      'rjit init <template> <directory>',
    ],
    detail: [
      'Templates:',
      '  ' + TEMPLATES.join(', '),
      '',
      'The one-argument form uses the basic template.',
      'The directory is created if it does not exist; existing files are',
      'never overwritten.',
    ],
  },
  dev: {
    summary: 'iterate on a cart with hot reload',
    usage: ['rjit dev <cart-name>'],
    detail: [
      'Bundles cart/<name>.tsx → .cache/bundle-<name>.js, then either:',
      '  1. pushes the bundle to a running dev host (one already on',
      '     /tmp/reactjit.sock), upserting its tab, or',
      '  2. spawns a fresh dev host and starts a watch loop that',
      '     re-pushes on every save.',
      '',
      'TSX / TS edits hot-reload in ~300ms. Zig / framework / build.zig',
      'edits require a rebuild.',
    ],
  },
  ship: {
    summary: 'build a cart into a single self-extracting binary',
    usage: [
      'rjit ship <cart-name>          # release, self-extracting',
    ],
    detail: [
      'Pipeline:',
      '  1. esbuild cart/<name>.tsx → bundle-<name>.js',
      '  2. resolver inspects the bundle\'s metafile and selects the',
      '     -Dhas-* feature flags from sdk/dependency-registry.json',
      '  3. zig build app → zig-out/bin/<name>',
      '  4. ldd-walk + tar + self-extracting shell header',
      '',
      'Result is one file you can move anywhere; on first run it',
      'extracts to ~/.cache/reactjit-<name>/<sig>/ and execs.',
    ],
  },
  help: {
    summary: 'print this help, or per-subcommand help',
    usage: ['rjit help', 'rjit help <subcommand>'],
    detail: [],
  },
};

function readRegistry() {
  const raw = __fs_read(REGISTRY_PATH);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function listFeatures(registry) {
  if (!registry || !registry.features) return [];
  const names = Object.keys(registry.features).sort();
  const lines = [];
  for (const name of names) {
    const f = registry.features[name];
    const flags = (f.buildOptions || []).map((o) => '-D' + o + '=true').join(' ');
    lines.push('  ' + pad(name, 16) + (flags || '(no build flag)'));
  }
  return lines;
}

function pad(s, n) {
  if (s.length >= n) return s + '  ';
  return s + ' '.repeat(n - s.length);
}

function printTopLevel(registry) {
  const lines = [
    'rjit — ReactJIT cart toolchain',
    '',
    'Usage:',
    '  rjit <subcommand> [args]',
    '',
    'Subcommands:',
  ];
  for (const name of SUBCOMMANDS) {
    lines.push('  ' + pad(name, 8) + SUBCOMMAND_DOC[name].summary);
  }
  lines.push('');
  lines.push('Run `rjit help <subcommand>` for details.');
  lines.push('');
  const features = listFeatures(registry);
  if (features.length) {
    lines.push('Source-driven build features (selected by the resolver from');
    lines.push('the cart\'s esbuild metafile; you don\'t pass these by hand):');
    lines.push.apply(lines, features);
    lines.push('');
  }
  __writeStdout(lines.join('\n') + '\n');
}

function printSubcommand(name) {
  const doc = SUBCOMMAND_DOC[name];
  if (!doc) {
    __writeStderr('rjit help: unknown subcommand: ' + name + '\n');
    __writeStderr('try: rjit help\n');
    __exit(1);
  }
  const lines = ['rjit ' + name + ' — ' + doc.summary, '', 'Usage:'];
  for (const u of doc.usage) lines.push('  ' + u);
  if (doc.detail.length) {
    lines.push('');
    lines.push.apply(lines, doc.detail);
  }
  __writeStdout(lines.join('\n') + '\n');
}

const argv = process.argv.slice(1);
const target = argv[0];

const registry = readRegistry();
if (!target) {
  printTopLevel(registry);
} else {
  printSubcommand(target);
}
