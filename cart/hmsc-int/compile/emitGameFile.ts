// emitGameFile.ts — hand a baked game-file to the CLI as PACKED BINARY ON DISK.
//
// GUIDING_LIGHT, "When the Obvious Shape Tempts You": *Use JSON/base64 at runtime
// → Pack binary, zero-copy; data IS the load format.* The old transport base64-
// encoded the whole game-file (70MB → 94MB text), wrapped it in JSON (another
// copy), and printed it on stdout for the CLI to `base64 -d` back to bytes. That
// text inflate pass is a GC bomb: it OOM'd the bake's JS heap once the map grew
// (req_1585/req_1586). The bytes were already a packed binary lump — the only
// non-compliant step was the textual hand-off.
//
// So the bake now writes the binary game-file + each content-addressed asset blob
// straight to disk (via the writeFileBytes binary door, zero base64), and emits
// only a tiny JSON MANIFEST on stdout: paths + hashes + sizes. The CLI reads the
// manifest and the files are already in place. No megabyte strings ever exist.

import { writeFileBytes } from '@reactjit/hooks/fs';

export type BakedAsset = { hash: string; bytes: Uint8Array };

export type GameFileManifest = {
  ok: boolean;
  gamefile: { path: string; bytes: number };
  assets: Array<{ hash: string; path: string; bytes: number }>;
};

/** Read a `--flag value` (or `--flag=value`) string argument from the bake's argv. */
function argValue(flag: string): string | null {
  const argv: string[] = (globalThis as any).process?.argv ?? [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag && argv[i + 1] != null) return argv[i + 1]!;
    const m = new RegExp(`^${flag}=(.+)$`).exec(argv[i] ?? '');
    if (m) return m[1]!;
  }
  return null;
}

/** Write the baked game-file + assets to disk and print the manifest on stdout.
 *  `--gamefile <path>` (required) and `--store <dir>` (required when assets ship)
 *  come from the CLI spawn. Throws loudly if a required path is missing or a write
 *  fails — the CLI turns a non-zero exit / empty stdout into a bake failure. */
export function emitBakedGameFile(file: Uint8Array, assets: BakedAsset[] = []): void {
  const gamefilePath = argValue('--gamefile');
  if (!gamefilePath) {
    throw new Error('emitBakedGameFile: missing --gamefile <path> argv (the CLI passes it; pass it for a manual bake)');
  }
  const storeDir = argValue('--store');
  if (assets.length && !storeDir) {
    throw new Error('emitBakedGameFile: missing --store <dir> argv but the bake ships content-addressed assets');
  }

  if (!writeFileBytes(gamefilePath, file)) {
    throw new Error(`emitBakedGameFile: could not write game-file bytes to ${gamefilePath}`);
  }

  const manifestAssets: GameFileManifest['assets'] = [];
  for (const asset of assets) {
    if (!/^[0-9a-f]{64}$/.test(asset.hash)) {
      throw new Error(`emitBakedGameFile: asset hash is not a sha256 hex: ${asset.hash}`);
    }
    const assetPath = `${storeDir}/${asset.hash}`;
    if (!writeFileBytes(assetPath, asset.bytes)) {
      throw new Error(`emitBakedGameFile: could not write asset ${asset.hash} to ${assetPath}`);
    }
    manifestAssets.push({ hash: asset.hash, path: assetPath, bytes: asset.bytes.byteLength });
  }

  const manifest: GameFileManifest = {
    ok: true,
    gamefile: { path: gamefilePath, bytes: file.byteLength },
    assets: manifestAssets,
  };
  const emit = (globalThis as any).print ?? console.log;
  emit(JSON.stringify(manifest));
}
