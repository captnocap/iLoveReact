import { existsSync, mkdirSync, cpSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, '..');

export async function initCommand(args) {
  const name = args[0];
  if (!name) {
    console.error('Usage: ilovereact init <project-name>');
    process.exit(1);
  }

  const dest = join(process.cwd(), name);
  if (existsSync(dest)) {
    console.error(`Directory "${name}" already exists.`);
    process.exit(1);
  }

  console.log(`\n  Creating iLoveReact project: ${name}\n`);

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

  // Copy framework source (shared + native packages)
  const runtimePkgs = join(CLI_ROOT, 'runtime', 'ilovereact');
  if (existsSync(runtimePkgs)) {
    cpSync(runtimePkgs, join(dest, 'ilovereact'), { recursive: true });
  } else {
    console.warn('  Warning: ilovereact/ packages not found in CLI. Run `make cli-setup` first.');
  }

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

  console.log(`
  Done! Your iLoveReact project is ready.

  Next steps:
    cd ${name}
    ilovereact dev          # Start esbuild watch (HMR)
    love .                  # Run Love2D (in another terminal)

  Edit src/App.tsx and watch it reload live!
`);
}
