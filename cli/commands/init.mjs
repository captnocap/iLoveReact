import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, '..');

// ── Color helpers ────────────────────────────────────────

const color = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const bold   = color('1');
const dim    = color('2');
const cyan   = color('36');
const green  = color('32');
const yellow = color('33');

// ── Package registry ─────────────────────────────────────

const OPTIONAL_PACKAGES = [
  {
    name: '@ilovereact/router',
    dir: 'router',
    alias: '@ilovereact/router',
    flag: '--router',
    description: 'Navigation and URL routing',
    importExample: "import { RouterProvider, Route, Link } from '@ilovereact/router';",
    default: true,
  },
  {
    name: '@ilovereact/storage',
    dir: 'storage',
    alias: '@ilovereact/storage',
    flag: '--storage',
    description: 'CRUD, schemas, data persistence',
    importExample: "import { useCRUD, createCRUD, z } from '@ilovereact/storage';",
    default: true,
  },
  {
    name: '@ilovereact/components',
    dir: 'components',
    alias: '@ilovereact/components',
    flag: '--components',
    description: 'Pre-built UI widgets',
    importExample: "import { Card, Badge } from '@ilovereact/components';",
    default: true,
  },
];

// ── Interactive checkbox prompt ──────────────────────────

function promptPackages(packages) {
  return new Promise((resolve) => {
    // If not a TTY (piped input), skip interactive and use defaults
    if (!process.stdin.isTTY) {
      resolve(packages.map(p => p.default));
      return;
    }

    const selected = packages.map(p => p.default);
    let cursor = 0;

    function render() {
      // Move cursor up to overwrite previous render (except first time)
      if (render._drawn) {
        process.stdout.write(`\x1b[${packages.length}A`);
      }
      render._drawn = true;

      for (let i = 0; i < packages.length; i++) {
        const pkg = packages[i];
        const check = selected[i] ? green('[x]') : dim('[ ]');
        const pointer = i === cursor ? cyan('>') : ' ';
        const name = i === cursor ? bold(pkg.name) : pkg.name;
        const pad = ' '.repeat(Math.max(0, 26 - pkg.name.length));
        // Clear line then write
        process.stdout.write(`\x1b[2K  ${pointer} ${check} ${name}${pad}${dim(pkg.description)}\n`);
      }
    }

    console.log(`\n  ${bold('Optional packages')} ${dim('(arrows to move, space to toggle, enter to confirm)')}\n`);
    render();

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    function onData(key) {
      // Ctrl+C
      if (key === '\x03') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        process.exit(0);
      }

      // Enter
      if (key === '\r' || key === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(selected);
        return;
      }

      // Space — toggle
      if (key === ' ') {
        selected[cursor] = !selected[cursor];
        render();
        return;
      }

      // Arrow keys (escape sequences)
      if (key === '\x1b[A' || key === 'k') {
        // Up
        cursor = (cursor - 1 + packages.length) % packages.length;
        render();
        return;
      }
      if (key === '\x1b[B' || key === 'j') {
        // Down
        cursor = (cursor + 1) % packages.length;
        render();
        return;
      }

      // 'a' — toggle all
      if (key === 'a') {
        const allSelected = selected.every(Boolean);
        for (let i = 0; i < selected.length; i++) selected[i] = !allSelected;
        render();
        return;
      }
    }

    process.stdin.on('data', onData);
  });
}

// ── Parse flags for non-interactive mode ─────────────────

function parseFlags(args) {
  const flags = args.filter(a => a.startsWith('--'));

  if (flags.includes('--minimal')) {
    return OPTIONAL_PACKAGES.map(() => false);
  }

  if (flags.includes('--all')) {
    return OPTIONAL_PACKAGES.map(() => true);
  }

  // Check for individual package flags
  const hasSpecificFlags = OPTIONAL_PACKAGES.some(p => flags.includes(p.flag));
  if (hasSpecificFlags) {
    return OPTIONAL_PACKAGES.map(p => flags.includes(p.flag));
  }

  return null; // No flags — use interactive mode
}

// ── Generate tsconfig with selected paths ────────────────

function generateTsconfig(selectedPackages) {
  const paths = {
    '@ilovereact/core': ['./ilovereact/shared/src'],
    '@ilovereact/native': ['./ilovereact/native/src'],
  };

  for (const pkg of selectedPackages) {
    paths[pkg.alias] = [`./ilovereact/${pkg.dir}/src`];
  }

  return {
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      paths,
    },
    include: ['src'],
  };
}

// ── Init command ─────────────────────────────────────────

export async function initCommand(args) {
  const name = args.filter(a => !a.startsWith('--'))[0];
  if (!name) {
    console.error('Usage: ilovereact init <project-name> [--all | --minimal | --router --storage --components]');
    process.exit(1);
  }

  const dest = join(process.cwd(), name);
  if (existsSync(dest)) {
    console.error(`Directory "${name}" already exists.`);
    process.exit(1);
  }

  console.log(`\n  ${bold('Creating iLoveReact project:')} ${cyan(name)}`);

  // Determine which optional packages to include
  let selections = parseFlags(args);
  if (selections === null) {
    // Interactive mode
    selections = await promptPackages(OPTIONAL_PACKAGES);
  } else {
    // Non-interactive — show what was selected
    const mode = args.includes('--minimal') ? 'minimal' : args.includes('--all') ? 'all' : 'custom';
    const count = selections.filter(Boolean).length;
    console.log(`  ${dim(`(${mode} mode: ${count} optional package${count !== 1 ? 's' : ''})`)}\n`);
  }

  const selectedPackages = OPTIONAL_PACKAGES.filter((_, i) => selections[i]);

  // Create project directory
  mkdirSync(dest, { recursive: true });

  // Copy template files
  const templateDir = join(CLI_ROOT, 'template');
  cpSync(templateDir, dest, { recursive: true });

  // Copy lua runtime
  const runtimeLua = join(CLI_ROOT, 'runtime', 'lua');
  if (existsSync(runtimeLua)) {
    cpSync(runtimeLua, join(dest, 'lua'), { recursive: true });
  } else {
    console.warn('  Warning: lua/ runtime not found in CLI. Run `make cli-setup` first.');
  }

  // Copy native lib
  const runtimeLib = join(CLI_ROOT, 'runtime', 'lib');
  if (existsSync(runtimeLib)) {
    cpSync(runtimeLib, join(dest, 'lib'), { recursive: true });
  } else {
    console.warn('  Warning: lib/ (libquickjs.so) not found in CLI. Run `make cli-setup` first.');
  }

  // Copy bundled binaries (tor)
  const runtimeBin = join(CLI_ROOT, 'runtime', 'bin');
  if (existsSync(runtimeBin)) {
    cpSync(runtimeBin, join(dest, 'bin'), { recursive: true });
  }

  // Copy framework source (shared + native — always included)
  const runtimePkgs = join(CLI_ROOT, 'runtime', 'ilovereact');
  if (existsSync(runtimePkgs)) {
    // Copy core packages (always included)
    const destPkgs = join(dest, 'ilovereact');
    mkdirSync(destPkgs, { recursive: true });

    for (const dir of ['shared', 'native']) {
      const src = join(runtimePkgs, dir);
      if (existsSync(src)) {
        cpSync(src, join(destPkgs, dir), { recursive: true });
      }
    }

    // Copy selected optional packages
    for (const pkg of selectedPackages) {
      const src = join(runtimePkgs, pkg.dir);
      if (existsSync(src)) {
        cpSync(src, join(destPkgs, pkg.dir), { recursive: true });
      }
    }
  } else {
    console.warn('  Warning: ilovereact/ packages not found in CLI. Run `make cli-setup` first.');
  }

  // Generate tsconfig.json with selected path aliases (overwrite template)
  const tsconfig = generateTsconfig(selectedPackages);
  writeFileSync(join(dest, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n');

  // Write package.json for the new project
  const pkg = {
    name: name,
    version: '0.1.0',
    private: true,
    scripts: {
      dev: 'ilovereact dev',
      build: 'ilovereact build',
    },
    dependencies: {
      'react': '^18.3.0',
      'react-reconciler': '^0.29.0',
    },
    devDependencies: {
      'esbuild': '^0.24.0',
      '@types/react': '^18.3.0',
      'typescript': '^5.5.0',
    },
  };
  writeFileSync(join(dest, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  // Install dependencies
  console.log('  Installing dependencies...\n');
  try {
    execSync('npm install', { cwd: dest, stdio: 'inherit' });
  } catch {
    console.warn('\n  npm install failed. Run it manually in the project directory.');
  }

  // Show results
  console.log(`\n  ${green('Done!')} Your iLoveReact project is ready.\n`);

  console.log(`  ${bold('Included packages:')}`);
  console.log(`    ${dim("import { Box, Text, Pressable } from '@ilovereact/core';")}`);
  for (const pkg of selectedPackages) {
    console.log(`    ${dim(pkg.importExample)}`);
  }

  console.log(`\n  ${bold('Next steps:')}`);
  console.log(`    ${cyan('cd ' + name)}`);
  console.log(`    ${cyan('ilovereact dev')}          ${dim('# Start esbuild watch (HMR)')}`);
  console.log(`    ${cyan('love .')}                  ${dim('# Run Love2D (in another terminal)')}`);
  console.log(`\n  Edit src/App.tsx and watch it reload live!\n`);
}
