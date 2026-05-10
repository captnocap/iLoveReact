import { useCallback, useEffect, useRef, useState } from 'react';
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

function basename(path: string): string {
  const normalized = String(path || '').replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || normalized;
}

function mediaPath(input: MediaInput): string {
  if (!input) return '';
  return typeof input === 'string' ? input : input.path;
}

function mediaFileFromPath(path: string): MediaFile {
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

function isFilesystemAudio(input: MediaInput): boolean {
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

export function useMedia() {
  const audio = useAudio();

  const runScan = useCallback(async (options: ScanOptions): Promise<MediaFile[]> => {
    if (!options.dir) return [];
    return filterKinds(
      scan(options.dir, {
        recursive: options.recursive ?? true,
        maxDepth: options.maxDepth ?? 10,
      }),
      options.kinds,
    );
  }, []);

  const runStats = useCallback(async (options: StatsOptions): Promise<DirStats> => {
    const empty: DirStats = { total: 0, byType: {}, totalSize: 0, largestFile: null };
    if (!options.dir) return empty;
    return dirStats(options.dir, {
      recursive: options.recursive ?? true,
      maxDepth: options.maxDepth ?? 10,
    });
  }, []);

  const runIndex = useCallback(async (options: IndexOptions): Promise<MediaFile[]> => {
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
  }, []);

  const runQuery = useCallback(async (options: QueryOptions): Promise<MediaFile[]> => {
    if (!options.dir) return [];
    const source = options.source ?? 'scan';
    const items = source === 'index'
      ? await runIndex({
          dir: options.dir,
          recursive: options.recursive,
          maxDepth: options.maxDepth,
          indexArchives: options.indexArchives,
          archivePattern: options.archivePattern,
        })
      : await runScan({
          dir: options.dir,
          recursive: options.recursive,
          maxDepth: options.maxDepth,
        });
    return queryItems(items, options);
  }, [runIndex, runScan]);

  const loadAudio = useCallback((input: MediaInput): LoadedAudioMedia | null => {
    const file = normalizeMediaFile(input);
    if (!file || file.source !== 'filesystem' || file.type !== 'audio') return null;
    const sound = audio.loadSound(file.path);
    if (!sound) return null;
    return {
      path: file.path,
      file,
      sound,
      duration: audio.dur(sound),
    };
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

    return {
      ...loaded,
      sound,
      duration: audio.dur(sound),
    };
  }, [audio, loadAudio]);

  const useScan = (options: ScanOptions) => {
    const [files, setFiles] = useState<MediaFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [version, setVersion] = useState(0);
    const depsKey = JSON.stringify(options);
    const ref = useRef(options);
    ref.current = options;

    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      runScan(ref.current)
        .then((next) => { if (!cancelled) setFiles(next); })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e : new Error(String(e))); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, [version, depsKey]);

    const rescan = useCallback(() => setVersion((v) => v + 1), []);
    return { files, loading, error, rescan };
  };

  const useStats = (options: StatsOptions) => {
    const [stats, setStats] = useState<DirStats>({ total: 0, byType: {}, totalSize: 0, largestFile: null });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [version, setVersion] = useState(0);
    const depsKey = JSON.stringify(options);
    const ref = useRef(options);
    ref.current = options;

    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      runStats(ref.current)
        .then((next) => { if (!cancelled) setStats(next); })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e : new Error(String(e))); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, [version, depsKey]);

    const rescan = useCallback(() => setVersion((v) => v + 1), []);
    return { stats, loading, error, rescan };
  };

  const useIndex = (options: IndexOptions) => {
    const [index, setIndex] = useState<MediaFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [version, setVersion] = useState(0);
    const depsKey = JSON.stringify(options);
    const ref = useRef(options);
    ref.current = options;

    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      runIndex(ref.current)
        .then((next) => { if (!cancelled) setIndex(next); })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e : new Error(String(e))); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, [version, depsKey]);

    const rescan = useCallback(() => setVersion((v) => v + 1), []);
    return { index, loading, error, rescan };
  };

  const useQuery = (options: QueryOptions) => {
    const [results, setResults] = useState<MediaFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [version, setVersion] = useState(0);
    const depsKey = JSON.stringify(options);
    const ref = useRef(options);
    ref.current = options;

    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      runQuery(ref.current)
        .then((next) => { if (!cancelled) setResults(next); })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e : new Error(String(e))); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, [version, depsKey]);

    const refetch = useCallback(() => setVersion((v) => v + 1), []);
    return { results, loading, error, refetch };
  };

  const useWatchedScan = (options: ScanOptions, watchOptions: FileWatchOptions = {}) => {
    const result = useScan(options);
    useFileWatch(options.dir ?? '', () => result.rescan(), {
      recursive: watchOptions.recursive ?? options.recursive ?? true,
      intervalMs: watchOptions.intervalMs,
      pattern: watchOptions.pattern,
    });
    return result;
  };

  const useAudioFile = (input: MediaInput, options: UseAudioFileOptions = {}) => {
    const [value, setValue] = useState<LoadedAudioMedia | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [version, setVersion] = useState(0);
    const path = mediaPath(input);
    const optsKey = JSON.stringify(options);

    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      try {
        const loaded = options.place ? placeAudio(input, options.place) : loadAudio(input);
        if (!cancelled) setValue(loaded);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) setLoading(false);
      }
      return () => { cancelled = true; };
    }, [path, optsKey, version]);

    const reload = useCallback(() => setVersion((v) => v + 1), []);
    return { audio: value, loading, error, reload };
  };

  const useDrop = (handler: (event: MediaDropEvent) => void, options: MediaDropOptions = {}) => {
    const handlerRef = useRef(handler);
    const optionsRef = useRef(options);
    handlerRef.current = handler;
    optionsRef.current = options;

    useFileDrop((path) => {
      const file = mediaFileFromPath(path);
      const opts = optionsRef.current;
      if (opts.kinds && opts.kinds.length > 0 && !opts.kinds.includes(file.type)) return;
      const audioResult = opts.placeAudio
        ? placeAudio(file, opts.placeAudio)
        : opts.loadAudio
          ? loadAudio(file)
          : null;
      handlerRef.current({
        path,
        file,
        stat: fileStat(path),
        audio: audioResult,
      });
    });
  };

  return {
    scan: runScan,
    stats: runStats,
    index: runIndex,
    query: runQuery,
    useScan,
    useStats,
    useIndex,
    useQuery,
    useWatchedScan,
    useAudioFile,
    useDrop,
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
