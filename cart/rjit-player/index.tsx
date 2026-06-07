import { useMemo } from 'react';
import { Box, Cartridge, Text } from '@reactjit/primitives';
import { readFile, readRjmpEntities } from '@reactjit/hooks/fs';

type PackageManifest = {
  id: string;
  name?: string;
  version?: number;
  minPlatformVersion?: string;
  entryMap: string;
  bundle: string;
  maps: string[];
  assets?: string[];
};

type LoadResult =
  | { ok: true; manifest: PackageManifest; bundlePath: string; mapPath: string; entitiesText: string }
  | { ok: false; error: string };

function joinPath(base: string, child: string): string {
  return `${base.replace(/\/+$/, '')}/${child.replace(/^\/+/, '')}`;
}

function packageArg(): string | null {
  const argv = (globalThis as any).process?.argv;
  if ((globalThis as any).process?.env?.ZIGOS_SCREENSHOT) {
    try { console.error(`RJIT_PLAYER_ARGV ${JSON.stringify(argv ?? null)}`); } catch {}
  }
  return Array.isArray(argv) && typeof argv[1] === 'string' ? argv[1] : null;
}

function loadPackage(packageDir: string | null): LoadResult {
  if (!packageDir) return { ok: false, error: 'usage: rjit-player <package.rjpkg>' };
  const manifestRaw = readFile(joinPath(packageDir, 'manifest.json'));
  if (!manifestRaw) return { ok: false, error: `missing package manifest: ${joinPath(packageDir, 'manifest.json')}` };
  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(manifestRaw) as PackageManifest;
  } catch (error: any) {
    return { ok: false, error: `manifest parse failed: ${error?.message ?? String(error)}` };
  }
  const mapPath = joinPath(packageDir, `maps/${manifest.entryMap}`);
  const entitiesText = readRjmpEntities(mapPath);
  if (!entitiesText) return { ok: false, error: `missing entry map or ENTITIES lump: ${mapPath}` };
  const bundlePath = joinPath(packageDir, manifest.bundle);
  const bundle = readFile(bundlePath);
  if (!bundle) return { ok: false, error: `missing package bundle: ${bundlePath}` };

  (globalThis as any).__rjpkg = {
    packageDir,
    manifest,
    mapPath,
    entitiesText,
  };
  return { ok: true, manifest, bundlePath, mapPath, entitiesText };
}

export default function ReactjitPlayer() {
  const loaded = useMemo(() => loadPackage(packageArg()), []);
  if (!loaded.ok) {
    return (
      <Box style={{ width: '100%', height: '100%', backgroundColor: '#111827', padding: 24 }}>
        <Text fontSize={18} color="#fca5a5" style={{ fontWeight: 800 }}>PACKAGE LOAD FAILED</Text>
        <Text fontSize={14} color="#fee2e2" style={{ marginTop: 10 }}>{loaded.error}</Text>
      </Box>
    );
  }
  return <Cartridge src={loaded.bundlePath} />;
}
