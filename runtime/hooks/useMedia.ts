import { useCallback } from 'react';
import { useLatest } from './useLatest';
import { useAsyncResource } from './useAsyncResource';
import { useAudio } from '../audio';
import { exists as fileExists, listDir, stat as fileStat, type FsStat } from './fs';
import { useFileDrop } from './useFileDrop';
import { useFileWatch, type FileWatchOptions } from './useFileWatch';
import {
  classifyFile,
  dirStats,
  formatSize,
  indexDeep,
  scan,
  type DirStats,
  type MediaFile,
  type MediaType,
} from './media';

export type ScanOptions = {
  dir: string | null;
  recursive?: boolean;
  maxDepth?: number;
  kinds?: MediaType[];
};

export type StatsOptions = {
  dir: string | null;
  recursive?: boolean;
  maxDepth?: number;
};

export type IndexOptions = {
  dir: string | null;
  recursive?: boolean;
  maxDepth?: number;
  indexArchives?: boolean;
  archivePattern?: string;
  kinds?: MediaType[];
};

export type QueryOptions = {
  dir: string | null;
  source?: 'scan' | 'index';
  recursive?: boolean;
  maxDepth?: number;
  indexArchives?: boolean;
  archivePattern?: string;
  text?: string;
  kinds?: MediaType[];
  minSize?: number;
  maxSize?: number;
  orderBy?: 'name' | 'size' | 'mtime' | 'type';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

export type MediaInput = string | MediaFile | null | undefined;

export type AudioPlacementOptions = {
  track: number;
  start?: number;
  end?: number;
  sliceStart?: number;
  sliceEnd?: number;
  stretchFactor?: number;
  play?: boolean;
};

export type LoadedAudioMedia = {
  path: string;
  file: MediaFile;
  sound: number;
  duration: number;
};

export type MediaDropEvent = {
  path: string;
  file: MediaFile;
  stat: FsStat | null;
  audio: LoadedAudioMedia | null;
};

export type MediaDropOptions = {
  kinds?: MediaType[];
  loadAudio?: boolean;
  placeAudio?: AudioPlacementOptions;
};

export type UseAudioFileOptions = {
  place?: AudioPlacementOptions;
};

// ── Pure helpers ─────────────────────────────────────────────────────

function basename(path: string): string {
  const normalized = String(path || '').replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || normalized;
}

function mediaPath(input: MediaInput): string {
  if (!input) return '';
  return typeof input === 'string' ? input : input.path;
}

export function mediaFileFromPath(path: string): MediaFile {
  const st = fileStat(path);
  return {
    path,
    name: basename(path),
    size: st?.size ?? 0,
    mtime: st?.mtimeMs,
    type: classifyFile(path),
    source: 'filesystem',
  };
}

function normalizeMediaFile(input: MediaInput): MediaFile | null {
  const path = mediaPath(input);
  if (!path) return null;
  return typeof input === 'string' ? mediaFileFromPath(path) : input;
}

export function isFilesystemAudio(input: MediaInput): boolean {
  const file = normalizeMediaFile(input);
  return !!file && file.source === 'filesystem' && file.type === 'audio';
}

function filterKinds(items: MediaFile[], kinds?: MediaType[]): MediaFile[] {
  if (!kinds || kinds.length === 0) return items;
  const allow = new Set(kinds);
  return items.filter((f) => allow.has(f.type));
}

function queryItems(items: MediaFile[], options: QueryOptions): MediaFile[] {
  let out = items;

  if (options.text && options.text.trim()) {
    const q = options.text.trim().toLowerCase();
    out = out.filter((f) =>
      f.name.toLowerCase().includes(q) ||
      f.path.toLowerCase().includes(q),
    );
  }
  out = filterKinds(out, options.kinds);

  if (options.minSize != null) out = out.filter((f) => f.size >= options.minSize!);
  if (options.maxSize != null) out = out.filter((f) => f.size <= options.maxSize!);

  const orderBy = options.orderBy ?? 'name';
  const order = options.order === 'desc' ? -1 : 1;
  out = [...out].sort((a, b) => {
    let av: string | number = '';
    let bv: string | number = '';
    if (orderBy === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
    else if (orderBy === 'size') { av = a.size; bv = b.size; }
    else if (orderBy === 'mtime') { av = a.mtime ?? 0; bv = b.mtime ?? 0; }
    else { av = a.type; bv = b.type; }
    if (av < bv) return -1 * order;
    if (av > bv) return 1 * order;
    return 0;
  });

  const offset = options.offset ?? 0;
  const limited = offset > 0 ? out.slice(offset) : out;
  if (options.limit == null) return limited;
  return limited.slice(0, options.limit);
}

// ── Imperative media operations (module-level, React-free) ──────────

export async function scanMedia(options: ScanOptions): Promise<MediaFile[]> {
  if (!options.dir) return [];
  return filterKinds(
    scan(options.dir, {
      recursive: options.recursive ?? true,
      maxDepth: options.maxDepth ?? 10,
    }),
    options.kinds,
  );
}

export async function statsMedia(options: StatsOptions): Promise<DirStats> {
  const empty: DirStats = { total: 0, byType: {}, totalSize: 0, largestFile: null };
  if (!options.dir) return empty;
  return dirStats(options.dir, {
    recursive: options.recursive ?? true,
    maxDepth: options.maxDepth ?? 10,
  });
}

export async function indexMedia(options: IndexOptions): Promise<MediaFile[]> {
  if (!options.dir) return [];
  return filterKinds(
    indexDeep(options.dir, {
      recursive: options.recursive ?? true,
      maxDepth: options.maxDepth ?? 10,
      indexArchives: options.indexArchives ?? true,
      archivePattern: options.archivePattern,
    }),
    options.kinds,
  );
}

export async function queryMedia(options: QueryOptions): Promise<MediaFile[]> {
  if (!options.dir) return [];
  const source = options.source ?? 'scan';
  const items = source === 'index'
    ? await indexMedia({
        dir: options.dir,
        recursive: options.recursive,
        maxDepth: options.maxDepth,
        indexArchives: options.indexArchives,
        archivePattern: options.archivePattern,
      })
    : await scanMedia({
        dir: options.dir,
        recursive: options.recursive,
        maxDepth: options.maxDepth,
      });
  return queryItems(items, options);
}

// ── Reactive hooks (each a top-level export) ─────────────────────────

export function useMediaScan(options: ScanOptions) {
  const ref = useLatest(options);
  const depsKey = JSON.stringify(options);
  const r = useAsyncResource<MediaFile[]>(() => scanMedia(ref.current), [depsKey]);
  return { files: r.data ?? [], loading: r.loading, error: r.error, rescan: r.refetch };
}

export function useMediaStats(options: StatsOptions) {
  const ref = useLatest(options);
  const depsKey = JSON.stringify(options);
  const r = useAsyncResource<DirStats>(() => statsMedia(ref.current), [depsKey]);
  return {
    stats: r.data ?? { total: 0, byType: {}, totalSize: 0, largestFile: null },
    loading: r.loading, error: r.error, rescan: r.refetch,
  };
}

export function useMediaIndex(options: IndexOptions) {
  const ref = useLatest(options);
  const depsKey = JSON.stringify(options);
  const r = useAsyncResource<MediaFile[]>(() => indexMedia(ref.current), [depsKey]);
  return { index: r.data ?? [], loading: r.loading, error: r.error, rescan: r.refetch };
}

export function useMediaQuery(options: QueryOptions) {
  const ref = useLatest(options);
  const depsKey = JSON.stringify(options);
  const r = useAsyncResource<MediaFile[]>(() => queryMedia(ref.current), [depsKey]);
  return { results: r.data ?? [], loading: r.loading, error: r.error, refetch: r.refetch };
}

export function useMediaWatchedScan(options: ScanOptions, watchOptions: FileWatchOptions = {}) {
  const result = useMediaScan(options);
  useFileWatch(options.dir ?? '', () => result.rescan(), {
    recursive: watchOptions.recursive ?? options.recursive ?? true,
    intervalMs: watchOptions.intervalMs,
    pattern: watchOptions.pattern,
  });
  return result;
}

export function useMediaAudioFile(input: MediaInput, options: UseAudioFileOptions = {}) {
  const m = useMedia();
  const path = mediaPath(input);
  const optsKey = JSON.stringify(options);
  const r = useAsyncResource<LoadedAudioMedia | null>(
    async () => options.place ? m.placeAudio(input, options.place) : m.loadAudio(input),
    [path, optsKey],
  );
  return { audio: r.data, loading: r.loading, error: r.error, reload: r.refetch };
}

export function useMediaDrop(
  handler: (event: MediaDropEvent) => void,
  options: MediaDropOptions = {},
): void {
  const m = useMedia();
  const handlerRef = useLatest(handler);
  const optionsRef = useLatest(options);
  useFileDrop((path) => {
    const file = mediaFileFromPath(path);
    const opts = optionsRef.current;
    if (opts.kinds && opts.kinds.length > 0 && !opts.kinds.includes(file.type)) return;
    const audioResult = opts.placeAudio
      ? m.placeAudio(file, opts.placeAudio)
      : opts.loadAudio
        ? m.loadAudio(file)
        : null;
    handlerRef.current({ path, file, stat: fileStat(path), audio: audioResult });
  });
}

// ── Imperative facade ────────────────────────────────────────────────
// Bundles imperative methods + audio-dependent loaders behind a single
// `const m = useMedia()` call. The reactive variants are top-level
// exports above (useMediaScan etc.) — those follow rules-of-hooks
// natively, whereas the facade's audio methods need `audio` from
// useAudio().

export function useMedia() {
  const audio = useAudio();

  const loadAudio = useCallback((input: MediaInput): LoadedAudioMedia | null => {
    const file = normalizeMediaFile(input);
    if (!file || file.source !== 'filesystem' || file.type !== 'audio') return null;
    const sound = audio.loadSound(file.path);
    if (!sound) return null;
    return { path: file.path, file, sound, duration: audio.dur(sound) };
  }, [audio]);

  const loadSample = useCallback((
    target: string | number,
    slot: number,
    input: MediaInput,
    mode: 'oneshot' | 'loop' = 'oneshot',
  ): boolean => {
    const file = normalizeMediaFile(input);
    if (!file || file.source !== 'filesystem' || file.type !== 'audio') return false;
    return audio.loadSample(target, slot, file.path, mode);
  }, [audio]);

  const placeAudio = useCallback((input: MediaInput, options: AudioPlacementOptions): LoadedAudioMedia | null => {
    const loaded = loadAudio(input);
    if (!loaded) return null;

    let sound = loaded.sound;
    if (typeof options.sliceStart === 'number' && typeof options.sliceEnd === 'number') {
      sound = audio.createAudioSlice(sound, options.sliceStart, options.sliceEnd);
    }
    if (typeof options.stretchFactor === 'number') {
      sound = audio.createAudioStretch(sound, options.stretchFactor);
    }

    const start = typeof options.start === 'number' ? options.start : audio.getPlayhead();
    if (typeof options.end === 'number') audio.fitMedia(sound, options.track, start, options.end);
    else audio.insertMedia(sound, options.track, start);
    if (options.play) audio.play();

    return { ...loaded, sound, duration: audio.dur(sound) };
  }, [audio, loadAudio]);

  return {
    scan: scanMedia,
    stats: statsMedia,
    index: indexMedia,
    query: queryMedia,
    fileFromPath: mediaFileFromPath,
    exists: fileExists,
    stat: fileStat,
    listDir,
    isAudio: isFilesystemAudio,
    loadAudio,
    loadSample,
    placeAudio,
    classifyFile,
    formatSize,
  };
}
