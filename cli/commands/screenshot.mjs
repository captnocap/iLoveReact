import { existsSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runLint } from './lint.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, '..');

export async function screenshotCommand(args) {
  const cwd = process.cwd();
  const projectName = basename(cwd);

  // Parse --output flag
  let outputPath = resolve(cwd, 'screenshot.png');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') {
      if (args[i + 1]) {
        outputPath = resolve(cwd, args[i + 1]);
        i++;
      }
    }
  }

  console.log(`\n  ilovereact screenshot\n`);

  // 1. Lint check
  console.log('  [1/3] Linting...');
  const { errors } = await runLint(cwd, { silent: false });
  if (errors > 0) {
    console.error(`\n  Screenshot blocked: ${errors} lint error${errors !== 1 ? 's' : ''} must be fixed first.\n`);
    process.exit(1);
  }

  // 2. Build bundle
  console.log('  [2/3] Bundling...');
  const entry = findEntry(cwd, 'src/main.tsx');
  execSync([
    'npx', 'esbuild',
    '--bundle',
    '--format=iife',
    '--global-name=ReactLove',
    '--target=es2020',
    '--jsx=automatic',
    '--outfile=bundle.js',
    entry,
  ].join(' '), { cwd, stdio: 'inherit' });

  // 3. Launch Love2D in screenshot mode
  console.log('  [3/3] Capturing screenshot...');
  console.log(`         Output: ${outputPath}`);

  const env = {
    ...process.env,
    ILOVEREACT_SCREENSHOT: '1',
    ILOVEREACT_SCREENSHOT_OUTPUT: outputPath,
  };

  // Detect xvfb-run for headless operation
  let useXvfb = false;
  try {
    execSync('which xvfb-run', { stdio: 'pipe' });
    useXvfb = true;
  } catch { /* not available */ }

  const loveCmd = useXvfb
    ? ['xvfb-run', '-a', 'love', '.']
    : ['love', '.'];

  return new Promise((resolveP) => {
    const proc = spawn(loveCmd[0], loveCmd.slice(1), {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let done = false;

    proc.on('error', (err) => {
      console.error(`\n  Failed to launch: ${loveCmd[0]}`);
      if (err.code === 'ENOENT') {
        console.error(useXvfb
          ? '  xvfb-run or love not found in PATH.'
          : '  Love2D not found. Install it: https://love2d.org');
      } else {
        console.error(`  ${err.message}`);
      }
      console.error('');
      process.exit(1);
    });

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      // Check for success marker
      if (stdout.includes('SCREENSHOT_SAVED:')) {
        done = true;
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Timeout: 15 seconds
    const timeout = setTimeout(() => {
      if (!done) {
        proc.kill('SIGTERM');
        console.error('\n  Screenshot timed out after 15 seconds.');
        console.error('  This usually means Love2D failed to initialize or render.\n');
        if (stderr) console.error('  stderr:', stderr.trim());
        process.exit(1);
      }
    }, 15000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (done || code === 0) {
        if (existsSync(outputPath)) {
          console.log(`\n  Done! Screenshot saved to ${outputPath}\n`);
          resolveP();
        } else {
          console.error('\n  Love2D exited but screenshot file was not created.');
          if (stderr) console.error('  stderr:', stderr.trim());
          process.exit(1);
        }
      } else {
        console.error(`\n  Love2D exited with code ${code}`);
        if (stderr) console.error('  stderr:', stderr.trim());
        process.exit(1);
      }
    });
  });
}

function findEntry(cwd, ...candidates) {
  for (const c of candidates) {
    const p = join(cwd, c);
    if (existsSync(p)) return p;
  }
  console.error(`No entry point found. Looked for: ${candidates.join(', ')}`);
  process.exit(1);
}
