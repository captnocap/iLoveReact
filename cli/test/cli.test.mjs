/**
 * CLI smoke tests — verify every command at least runs without crashing.
 *
 * Uses Node.js built-in test runner (node:test). No external deps.
 * Run: node --test cli/test/cli.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'ilovereact.mjs');
const CLI_ROOT = join(__dirname, '..');
const REPO_ROOT = join(__dirname, '..', '..');

// Temp directory for test projects
const TEST_DIR = join(tmpdir(), `ilovereact-test-${process.pid}`);

// Helper: run the CLI and capture output
function cli(args, opts = {}) {
  const cwd = opts.cwd || REPO_ROOT;
  const timeout = opts.timeout || 30000;
  try {
    const stdout = execFileSync('node', [CLI_BIN, ...args], {
      cwd,
      timeout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status ?? 1,
    };
  }
}

// ── Setup / Teardown ────────────────────────────────────────

before(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

after(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ── Help ────────────────────────────────────────────────────

describe('ilovereact help', () => {
  it('prints help text and exits 0', () => {
    const { stdout, exitCode } = cli(['help']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('ilovereact'), 'Should contain "ilovereact"');
    assert.ok(stdout.includes('Usage'), 'Should contain "Usage"');
  });

  it('--help flag works', () => {
    const { stdout, exitCode } = cli(['--help']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Usage'));
  });

  it('-h flag works', () => {
    const { stdout, exitCode } = cli(['-h']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Usage'));
  });

  it('no args prints help', () => {
    const { stdout, exitCode } = cli([]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Usage'));
  });

  it('help mentions init flags', () => {
    const { stdout } = cli(['help']);
    assert.ok(stdout.includes('--all'), 'Should mention --all flag');
    assert.ok(stdout.includes('--minimal'), 'Should mention --minimal flag');
  });

  it('help mentions ilr shorthand', () => {
    const { stdout } = cli(['help']);
    assert.ok(stdout.includes('ilr'), 'Should mention ilr shorthand');
  });
});

// ── Unknown command ─────────────────────────────────────────

describe('unknown command', () => {
  it('exits with error for unknown command', () => {
    const { stderr, exitCode } = cli(['frobnicate']);
    assert.equal(exitCode, 1);
  });
});

// ── Init ────────────────────────────────────────────────────

describe('ilovereact init', () => {
  it('fails without project name', () => {
    const { exitCode } = cli(['init'], { cwd: TEST_DIR });
    assert.equal(exitCode, 1);
  });

  it('fails if directory already exists', () => {
    const name = 'already-exists';
    mkdirSync(join(TEST_DIR, name), { recursive: true });
    const { exitCode, stderr } = cli(['init', name], { cwd: TEST_DIR });
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('already exists'));
    rmSync(join(TEST_DIR, name), { recursive: true, force: true });
  });

  it('creates a project with --minimal', () => {
    const name = 'test-minimal';
    const dest = join(TEST_DIR, name);

    const { exitCode, stdout } = cli(['init', name, '--minimal'], {
      cwd: TEST_DIR,
      timeout: 60000,
    });
    assert.equal(exitCode, 0, `init failed: stdout=${stdout}`);

    // Core files exist
    assert.ok(existsSync(join(dest, 'package.json')), 'package.json should exist');
    assert.ok(existsSync(join(dest, 'tsconfig.json')), 'tsconfig.json should exist');
    assert.ok(existsSync(join(dest, 'src', 'App.tsx')), 'src/App.tsx should exist');
    assert.ok(existsSync(join(dest, 'src', 'main.tsx')), 'src/main.tsx should exist');

    // Core packages always included
    assert.ok(existsSync(join(dest, 'ilovereact', 'shared')), 'shared package should exist');
    assert.ok(existsSync(join(dest, 'ilovereact', 'native')), 'native package should exist');

    // Optional packages NOT included in minimal mode
    assert.ok(!existsSync(join(dest, 'ilovereact', 'router')), 'router should NOT exist in minimal');
    assert.ok(!existsSync(join(dest, 'ilovereact', 'storage')), 'storage should NOT exist in minimal');
    assert.ok(!existsSync(join(dest, 'ilovereact', 'components')), 'components should NOT exist in minimal');

    // tsconfig has only core paths
    const tsconfig = JSON.parse(readFileSync(join(dest, 'tsconfig.json'), 'utf-8'));
    assert.ok(tsconfig.compilerOptions.paths['@ilovereact/core'], 'tsconfig should have core path');
    assert.ok(tsconfig.compilerOptions.paths['@ilovereact/native'], 'tsconfig should have native path');
    assert.ok(!tsconfig.compilerOptions.paths['@ilovereact/router'], 'tsconfig should NOT have router path in minimal');

    // package.json has correct name
    const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf-8'));
    assert.equal(pkg.name, name);

    // Template uses @ilovereact/* imports (not relative paths)
    const appTsx = readFileSync(join(dest, 'src', 'App.tsx'), 'utf-8');
    assert.ok(appTsx.includes("from '@ilovereact/core'"), 'App.tsx should use @ilovereact/core import');
    assert.ok(!appTsx.includes('../ilovereact/'), 'App.tsx should NOT have relative ilovereact imports');

    const mainTsx = readFileSync(join(dest, 'src', 'main.tsx'), 'utf-8');
    assert.ok(mainTsx.includes("from '@ilovereact/native'"), 'main.tsx should use @ilovereact/native import');

    rmSync(dest, { recursive: true, force: true });
  });

  it('creates a project with --all (includes optional packages if available)', () => {
    const name = 'test-all';
    const dest = join(TEST_DIR, name);

    const { exitCode } = cli(['init', name, '--all'], {
      cwd: TEST_DIR,
      timeout: 60000,
    });
    assert.equal(exitCode, 0);

    // Core packages always present
    assert.ok(existsSync(join(dest, 'ilovereact', 'shared')));
    assert.ok(existsSync(join(dest, 'ilovereact', 'native')));

    // tsconfig has all paths (even if runtime dirs weren't available to copy)
    const tsconfig = JSON.parse(readFileSync(join(dest, 'tsconfig.json'), 'utf-8'));
    assert.ok(tsconfig.compilerOptions.paths['@ilovereact/core']);
    assert.ok(tsconfig.compilerOptions.paths['@ilovereact/native']);
    assert.ok(tsconfig.compilerOptions.paths['@ilovereact/router']);
    assert.ok(tsconfig.compilerOptions.paths['@ilovereact/storage']);
    assert.ok(tsconfig.compilerOptions.paths['@ilovereact/components']);

    rmSync(dest, { recursive: true, force: true });
  });

  it('creates a project with individual flags (--router only)', () => {
    const name = 'test-router-only';
    const dest = join(TEST_DIR, name);

    const { exitCode } = cli(['init', name, '--router'], {
      cwd: TEST_DIR,
      timeout: 60000,
    });
    assert.equal(exitCode, 0);

    // tsconfig should have router but not storage/components
    const tsconfig = JSON.parse(readFileSync(join(dest, 'tsconfig.json'), 'utf-8'));
    assert.ok(tsconfig.compilerOptions.paths['@ilovereact/router'], 'should have router');
    assert.ok(!tsconfig.compilerOptions.paths['@ilovereact/storage'], 'should NOT have storage');
    assert.ok(!tsconfig.compilerOptions.paths['@ilovereact/components'], 'should NOT have components');

    rmSync(dest, { recursive: true, force: true });
  });
});

// ── Lint ─────────────────────────────────────────────────────

describe('ilovereact lint', () => {
  let projectDir;

  before(() => {
    // Create a minimal project to lint
    const name = 'test-lint';
    projectDir = join(TEST_DIR, name);
    cli(['init', name, '--minimal'], { cwd: TEST_DIR, timeout: 60000 });
  });

  after(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('lints the template with no errors', () => {
    const { exitCode, stdout } = cli(['lint'], { cwd: projectDir });
    assert.equal(exitCode, 0, `Lint should pass on template. Output: ${stdout}`);
  });

  it('exits 0 when no src/ directory', () => {
    // Run lint in a directory without src/
    const { exitCode } = cli(['lint'], { cwd: TEST_DIR });
    assert.equal(exitCode, 0);
  });
});

// ── Build ───────────────────────────────────────────────────

describe('ilovereact build', () => {
  let projectDir;

  before(() => {
    const name = 'test-build';
    projectDir = join(TEST_DIR, name);
    cli(['init', name, '--minimal'], { cwd: TEST_DIR, timeout: 60000 });
  });

  after(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('bundles JS and produces bundle.js', () => {
    const { exitCode, stdout, stderr } = cli(['build', '--no-update'], {
      cwd: projectDir,
      timeout: 60000,
    });
    assert.equal(exitCode, 0, `Build failed. stdout: ${stdout}\nstderr: ${stderr}`);
    assert.ok(existsSync(join(projectDir, 'bundle.js')), 'bundle.js should be created');
  });

  it('fails with unknown build target', () => {
    const { exitCode, stderr } = cli(['build', 'dist:unknown'], { cwd: projectDir });
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('Unknown target'), `Expected "Unknown target" in stderr: ${stderr}`);
  });
});

// ── Update ──────────────────────────────────────────────────

describe('ilovereact update', () => {
  it('fails when not in a project directory', () => {
    const emptyDir = join(TEST_DIR, 'empty-dir');
    mkdirSync(emptyDir, { recursive: true });
    const { exitCode, stderr } = cli(['update'], { cwd: emptyDir });
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('does not look like'));
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('updates runtime files in a project', () => {
    const name = 'test-update';
    const projectDir = join(TEST_DIR, name);
    cli(['init', name, '--minimal'], { cwd: TEST_DIR, timeout: 60000 });

    // Remove lua/ to verify update restores it
    rmSync(join(projectDir, 'lua'), { recursive: true, force: true });
    assert.ok(!existsSync(join(projectDir, 'lua')), 'lua/ should be gone');

    const { exitCode, stdout } = cli(['update'], { cwd: projectDir });
    assert.equal(exitCode, 0, `Update failed: ${stdout}`);
    assert.ok(existsSync(join(projectDir, 'lua')), 'lua/ should be restored');

    rmSync(projectDir, { recursive: true, force: true });
  });
});

// ── Screenshot ──────────────────────────────────────────────

describe('ilovereact screenshot', () => {
  it('fails gracefully when not in a project', () => {
    // screenshot needs src/main.tsx — running in TEST_DIR should fail
    // but it should not crash with an unhandled exception
    const { exitCode } = cli(['screenshot'], { cwd: TEST_DIR });
    assert.notEqual(exitCode, 0);
  });
});

// ── Targets registry ────────────────────────────────────────

describe('targets.mjs', () => {
  it('exports TARGETS with expected keys', async () => {
    const { TARGETS, TARGET_NAMES, esbuildArgs } = await import(join(CLI_ROOT, 'targets.mjs'));
    assert.ok(TARGETS.love, 'love target should exist');
    assert.ok(TARGETS.terminal, 'terminal target should exist');
    assert.ok(TARGETS.cc, 'cc target should exist');
    assert.ok(TARGETS.nvim, 'nvim target should exist');
    assert.ok(TARGETS.web, 'web target should exist');
    assert.ok(Array.isArray(TARGET_NAMES));
    assert.ok(TARGET_NAMES.length >= 5);
  });

  it('esbuildArgs produces correct flags for love target', async () => {
    const { TARGETS, esbuildArgs } = await import(join(CLI_ROOT, 'targets.mjs'));
    const args = esbuildArgs(TARGETS.love);
    assert.ok(args.includes('--bundle'));
    assert.ok(args.includes('--format=iife'));
    assert.ok(args.some(a => a.includes('--global-name=')));
  });

  it('esbuildArgs produces correct flags for terminal target', async () => {
    const { TARGETS, esbuildArgs } = await import(join(CLI_ROOT, 'targets.mjs'));
    const args = esbuildArgs(TARGETS.terminal);
    assert.ok(args.includes('--format=esm'));
    assert.ok(args.includes('--platform=node'));
    assert.ok(!args.some(a => a.includes('--global-name=')));
  });
});

// ── Lint rules (unit-level) ─────────────────────────────────

describe('lint rules', () => {
  let projectDir;

  before(() => {
    const name = 'test-lint-rules';
    projectDir = join(TEST_DIR, name);
    cli(['init', name, '--minimal'], { cwd: TEST_DIR, timeout: 60000 });
  });

  after(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('catches Text without fontSize', async () => {
    const { writeFileSync } = await import('node:fs');
    const testFile = join(projectDir, 'src', 'Bad.tsx');
    writeFileSync(testFile, `
import React from 'react';
import { Text } from '@ilovereact/core';
export function Bad() {
  return <Text style={{ color: 'red' }}>hello</Text>;
}
`);
    const { exitCode, stdout } = cli(['lint'], { cwd: projectDir });
    assert.equal(exitCode, 1, 'Should fail with lint error');
    assert.ok(stdout.includes('no-text-without-fontsize') || stdout.includes('fontSize'));
    rmSync(testFile);
  });

  it('catches row justify without width', async () => {
    const { writeFileSync } = await import('node:fs');
    const testFile = join(projectDir, 'src', 'BadRow.tsx');
    writeFileSync(testFile, `
import React from 'react';
import { Box, Text } from '@ilovereact/core';
export function BadRow() {
  return (
    <Box style={{ width: '100%', height: '100%' }}>
      <Box style={{ flexDirection: 'row', justifyContent: 'center' }}>
        <Text style={{ fontSize: 14 }}>a</Text>
        <Text style={{ fontSize: 14 }}>b</Text>
      </Box>
    </Box>
  );
}
`);
    const { exitCode, stdout } = cli(['lint'], { cwd: projectDir });
    assert.equal(exitCode, 1, 'Should fail with lint error');
    assert.ok(stdout.includes('no-row-justify-without-width') || stdout.includes('justifyContent'));
    rmSync(testFile);
  });

  it('catches block char in Text', async () => {
    const { writeFileSync } = await import('node:fs');
    const testFile = join(projectDir, 'src', 'BlockChar.tsx');
    writeFileSync(testFile, `
import React from 'react';
import { Text } from '@ilovereact/core';
export function BlockChar() {
  return <Text style={{ fontSize: 14 }}>{'\u2588\u2588\u2588'}</Text>;
}
`);
    const { exitCode, stdout } = cli(['lint'], { cwd: projectDir });
    assert.equal(exitCode, 1, 'Should fail with lint error');
    assert.ok(stdout.includes('no-block-char-in-text') || stdout.includes('FULL BLOCK'));
    rmSync(testFile);
  });

  it('respects ilr-ignore-next-line', async () => {
    const { writeFileSync } = await import('node:fs');
    const testFile = join(projectDir, 'src', 'Ignored.tsx');
    writeFileSync(testFile, `
import React from 'react';
import { Text } from '@ilovereact/core';
export function Ignored() {
  return (
    // ilr-ignore-next-line
    <Text style={{ color: 'red' }}>hello</Text>
  );
}
`);
    const { exitCode } = cli(['lint'], { cwd: projectDir });
    assert.equal(exitCode, 0, 'Should pass with ignore comment');
    rmSync(testFile);
  });

  it('catches mixed text children', async () => {
    const { writeFileSync } = await import('node:fs');
    const testFile = join(projectDir, 'src', 'MixedText.tsx');
    writeFileSync(testFile, `
import React from 'react';
import { Text } from '@ilovereact/core';
export function MixedText({ count }: { count: number }) {
  return <Text style={{ fontSize: 14 }}>Count: {count}</Text>;
}
`);
    const { exitCode, stdout } = cli(['lint'], { cwd: projectDir });
    assert.equal(exitCode, 1, 'Should fail with lint error');
    assert.ok(stdout.includes('no-mixed-text-children') || stdout.includes('template literal'));
    rmSync(testFile);
  });
});
