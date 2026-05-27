// index.ts — sources registry + the import bridge.
//
// The registry holds one SourceAdapter per provider (built lazily). The
// import bridge is the seam into the rest of the cart: given a
// NormalizedSample picked in the search UI, it resolves a fetchable URL via
// the adapter, streams the bytes to disk through the runtime `download`
// hook, and transcodes to WAV so the file matches everything else under
// samples/ (capture writes 44.1k WAV; the local importer copies WAV). The
// caller (state.ts) owns id allocation + SampleRef creation, mirroring
// addSampleFromFile — this module stays pure (no React, no workspace).
//
// Build order is freesound → internet_archive → fma → jamendo. Freesound,
// Internet Archive, and Jamendo have working adapters; FMA has no usable
// public API (see fma.ts) and is reported as unavailable rather than dropped.

import { download, type DownloadProgress } from '@reactjit/runtime/hooks/fetch';
import { run } from '@reactjit/runtime/hooks/process';
import { mkdir, remove } from '@reactjit/runtime/hooks/fs';
import { createFreesoundAdapter } from './freesound';
import { createInternetArchiveAdapter } from './internet_archive';
import { createJamendoAdapter } from './jamendo';
import { FMA_UNAVAILABLE_REASON } from './fma';
import type {
  NormalizedSample,
  SearchPage,
  SearchQuery,
  SourceAdapter,
  SourceId,
} from './types';

export type {
  AudioFormat,
  Author,
  DownloadResolution,
  LicenseFamily,
  MediaAsset,
  NormalizedLicense,
  NormalizedSample,
  AudioMeta,
  SearchPage,
  SearchQuery,
  SortKey,
  SourceAdapter,
  SourceId,
} from './types';
export { credentials, getToken } from './credentials';

// ── Registry ──────────────────────────────────────────────────────────

const _adapters = new Map<SourceId, SourceAdapter>();

/** All providers in build order — including unavailable ones, so the unified
 *  search UI can render them (greyed, with a reason) rather than dropping
 *  them silently. */
export const ALL_SOURCES: readonly SourceId[] = ['freesound', 'internet_archive', 'fma', 'jamendo'];

/** Get the adapter for a provider, building it on first use. Returns null for
 *  providers without a usable adapter (currently only fma — see fma.ts). */
export function getAdapter(source: SourceId): SourceAdapter | null {
  const existing = _adapters.get(source);
  if (existing) return existing;
  let built: SourceAdapter | null = null;
  switch (source) {
    case 'freesound': built = createFreesoundAdapter(); break;
    case 'internet_archive': built = createInternetArchiveAdapter(); break;
    case 'jamendo': built = createJamendoAdapter(); break;
    case 'fma': built = null; break; // no public API — see fma.ts
  }
  if (built) _adapters.set(source, built);
  return built;
}

/** Providers with a working adapter right now, in build order. */
export function availableSources(): SourceId[] {
  return ALL_SOURCES.filter((id) => getAdapter(id) !== null);
}

/** Why a provider is unavailable, or null when it's usable. Lets the UI show
 *  a tooltip explaining the greyed-out source. */
export function sourceUnavailableReason(source: SourceId): string | null {
  if (getAdapter(source)) return null;
  if (source === 'fma') return FMA_UNAVAILABLE_REASON;
  return 'Not implemented yet.';
}

/** Convenience: search one provider. Throws if the provider isn't implemented. */
export function searchSource(source: SourceId, query: SearchQuery): Promise<SearchPage> {
  const adapter = getAdapter(source);
  if (!adapter) throw new Error(`No adapter for source "${source}" yet`);
  return adapter.search(query);
}

// ── Import bridge ───────────────────────────────────────────────────────

export interface ImportToWavOptions {
  readonly sample: NormalizedSample;
  /** Final on-disk WAV path, e.g. samplePathFor(stem, id). */
  readonly destPath: string;
  readonly onProgress?: (p: DownloadProgress) => void;
}

export interface ImportToWavResult {
  /** Measured duration if the provider gave one, else 0 (caller may
   *  re-measure lazily — composer already does on first load). */
  readonly durationMs: number;
  /** Format of the bytes we downloaded before transcoding (mp3 preview,
   *  wav original, …) — useful for status/telemetry. */
  readonly sourceFormat: string;
}

function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i > 0 ? path.slice(0, i) : '.';
}

/**
 * Download a chosen sample and land it as a WAV at `destPath`.
 *
 * Steps: resolve a fetchable URL → stream to a `.src` sidecar → if the bytes
 * are already WAV, move into place; otherwise transcode with ffmpeg to
 * 44.1kHz PCM s16le (channels preserved) → clean up the sidecar.
 *
 * Throws with a clear message on any failure (auth, network, transcode,
 * missing ffmpeg) — callers surface it to the status line rather than
 * silently registering a broken sample.
 */
export async function importSampleAsWav(opts: ImportToWavOptions): Promise<ImportToWavResult> {
  const { sample, destPath, onProgress } = opts;
  const adapter = getAdapter(sample.source);
  if (!adapter) throw new Error(`No adapter for source "${sample.source}" yet`);

  const resolution = await adapter.resolveDownload(sample);
  if (!resolution) {
    throw new Error(`${adapter.displayName}: nothing downloadable for "${sample.title}"`);
  }

  mkdir(parentDir(destPath));
  const srcPath = `${destPath}.src`;

  const dl = await download({
    url: resolution.url,
    destPath: srcPath,
    headers: resolution.headers,
    onProgress,
  });
  if (dl.status < 200 || dl.status >= 300) {
    remove(srcPath);
    throw new Error(`${adapter.displayName}: download failed (HTTP ${dl.status})`);
  }

  if (resolution.sourceFormat === 'wav') {
    // Already WAV — move into place losslessly, no transcode.
    const mv = await run('mv', ['-f', srcPath, destPath]);
    if (mv.code !== 0) {
      remove(srcPath);
      throw new Error(`${adapter.displayName}: could not place WAV (${mv.stderr.trim() || `exit ${mv.code}`})`);
    }
  } else {
    // Transcode to canonical WAV. Preserve channel count; normalize rate to
    // 44.1k PCM s16le to match capture output and the engine's expectations.
    const ff = await run('ffmpeg', ['-y', '-i', srcPath, '-ar', '44100', '-c:a', 'pcm_s16le', destPath]);
    remove(srcPath);
    if (ff.code !== 0) {
      const why = ff.stderr.includes('spawn failed') || ff.code === -1
        ? 'ffmpeg not found on PATH'
        : ff.stderr.trim().split('\n').slice(-1)[0] || `exit ${ff.code}`;
      throw new Error(`${adapter.displayName}: transcode to WAV failed (${why})`);
    }
  }

  const durationMs = typeof sample.audio.durationSec === 'number'
    ? Math.round(sample.audio.durationSec * 1000)
    : 0;
  return { durationMs, sourceFormat: resolution.sourceFormat };
}
