import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';

export async function buildCommand(args) {
  const cwd = process.cwd();
  const entry = join(cwd, 'src', 'main.tsx');

  if (!existsSync(entry)) {
    console.error('No src/main.tsx found. Are you in an iLoveReact project directory?');
    process.exit(1);
  }

  const projectName = basename(cwd);
  const distDir = join(cwd, 'dist', projectName);
  const stagingDir = join('/tmp', `ilovereact-build-${projectName}`);

  console.log(`\n  Building ${projectName}...\n`);

  // 1. Bundle JS
  console.log('  Bundling JS...');
  execSync([
    'npx', 'esbuild',
    '--bundle',
    '--format=iife',
    '--global-name=ReactLove',
    '--target=es2020',
    '--jsx=automatic',
    '--outfile=bundle.js',
    'src/main.tsx',
  ].join(' '), { cwd, stdio: 'inherit' });

  // 2. Prepare staging directory
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(join(stagingDir, 'lua'), { recursive: true });

  // Copy bundle
  cpSync(join(cwd, 'bundle.js'), join(stagingDir, 'bundle.js'));

  // Copy main.lua and conf.lua
  cpSync(join(cwd, 'main.lua'), join(stagingDir, 'main.lua'));
  cpSync(join(cwd, 'conf.lua'), join(stagingDir, 'conf.lua'));

  // Copy lua runtime
  if (existsSync(join(cwd, 'lua'))) {
    cpSync(join(cwd, 'lua'), join(stagingDir, 'lua'), { recursive: true });
  } else {
    console.error('  Error: lua/ runtime not found in project.');
    process.exit(1);
  }

  // 3. Create .love file
  console.log('  Creating .love archive...');
  const lovePath = join('/tmp', `${projectName}.love`);
  execSync(`cd "${stagingDir}" && zip -9 -r "${lovePath}" .`, { stdio: 'pipe' });

  // 4. Find love binary
  let loveBin;
  try {
    loveBin = execSync('which love', { encoding: 'utf-8' }).trim();
  } catch {
    console.error('  Error: love binary not found. Install Love2D: https://love2d.org');
    process.exit(1);
  }

  // 5. Fuse binary
  console.log('  Fusing binary...');
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(join(distDir, 'lib'), { recursive: true });

  execSync(`cat "${loveBin}" "${lovePath}" > "${join(distDir, projectName)}"`, { stdio: 'pipe' });
  execSync(`chmod +x "${join(distDir, projectName)}"`, { stdio: 'pipe' });

  // 6. Copy native lib
  const libSrc = join(cwd, 'lib', 'libquickjs.so');
  if (existsSync(libSrc)) {
    cpSync(libSrc, join(distDir, 'lib', 'libquickjs.so'));
  } else {
    console.warn('  Warning: lib/libquickjs.so not found. The binary won\'t work without it.');
  }

  // 7. Cleanup
  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(lovePath, { force: true });

  console.log(`
  Build complete!

  Output: dist/${projectName}/
    ${projectName}          (fused binary)
    lib/libquickjs.so       (native library)

  Run: cd dist/${projectName} && ./${projectName}
`);
}
