import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

export async function devCommand(args) {
  const cwd = process.cwd();
  const entry = join(cwd, 'src', 'main.tsx');

  if (!existsSync(entry)) {
    console.error('No src/main.tsx found. Are you in an iLoveReact project directory?');
    process.exit(1);
  }

  console.log(`
  iLoveReact dev mode
  Watching src/main.tsx for changes...
  Run "love ." in another terminal to see your app.
`);

  try {
    execSync([
      'npx', 'esbuild',
      '--bundle',
      '--format=iife',
      '--global-name=ReactLove',
      '--target=es2020',
      '--jsx=automatic',
      '--outfile=bundle.js',
      '--watch',
      'src/main.tsx',
    ].join(' '), { cwd, stdio: 'inherit' });
  } catch {
    // esbuild watch exits on ctrl+c — that's expected
  }
}
