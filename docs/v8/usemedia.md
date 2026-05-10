# `useMedia` (V8 Runtime)

`useMedia` is the collapsed media surface for the V8 runtime.

It provides:

- filesystem media scanning
- directory stats
- media indexing
- local query/filter/sort/pagination
- file drop and watched-directory scan helpers
- audio file loading, sampler-slot loading, and track placement
- reactive hook variants for each method

## Runtime Scope

This implementation is V8-only and depends on fs-domain host bindings. The audio
helpers also require the V8 audio host functions from `framework/audio.zig`.

Required host functions:

- `__fs_media_scan_json`
- `__fs_media_stats_json`
- `__fs_media_index_json`
- `__fs_stat_json`
- `__fs_exists`
- `__fs_list_json`
- `__filedropSeq`
- `__filedropLastPath`
- `__fswatchAdd`
- `__fswatchRemove`
- `__fswatchDrain`
- `__audioLoadSound`
- `__audioLoadSample`
- `__audioInsertMedia`
- `__audioFitMedia`

These are registered in `framework/v8_bindings_fs.zig`,
`framework/v8_bindings_core.zig`, and the audio binding block in
`framework/v8_bindings_core.zig`.

## Import

```ts
import { useMedia } from '../../runtime/hooks';
```

Or low-level wrappers:

```ts
import { media } from '../../runtime/hooks';
```

## Collapsed Surface

`useMedia()` returns:

```ts
{
  // Imperative methods
  scan(options): Promise<MediaFile[]>;
  stats(options): Promise<DirStats>;
  index(options): Promise<MediaFile[]>;
  query(options): Promise<MediaFile[]>;

  // Reactive methods
  useScan(options):  { files, loading, error, rescan };
  useStats(options): { stats, loading, error, rescan };
  useIndex(options): { index, loading, error, rescan };
  useQuery(options): { results, loading, error, refetch };
  useWatchedScan(options, watchOptions?): { files, loading, error, rescan };
  useAudioFile(fileOrPath, options?): { audio, loading, error, reload };
  useDrop(handler, options): void;

  // Filesystem controls
  fileFromPath(path): MediaFile;
  exists(path): boolean;
  stat(path): FsStat | null;
  listDir(path): string[];

  // Utilities
  isAudio(fileOrPath): boolean;
  loadAudio(fileOrPath): LoadedAudioMedia | null;
  loadSample(target, slot, fileOrPath, mode?): boolean;
  placeAudio(fileOrPath, options): LoadedAudioMedia | null;
  classifyFile(filename): MediaType;
  formatSize(bytes): string;
}
```

## Types

```ts
type MediaType =
  | 'video'
  | 'audio'
  | 'image'
  | 'subtitle'
  | 'document'
  | 'archive'
  | 'metadata'
  | 'unknown';

type MediaFile = {
  path: string;
  name: string;
  size: number;
  mtime?: number;
  type: MediaType;
  source: 'filesystem' | 'archive';
  archivePath?: string;
  archiveEntry?: string;
};

type DirStats = {
  total: number;
  byType: Partial<Record<MediaType, number>>;
  totalSize: number;
  largestFile: MediaFile | null;
};

type LoadedAudioMedia = {
  path: string;
  file: MediaFile;
  sound: number;
  duration: number;
};

type AudioPlacementOptions = {
  track: number;
  start?: number;
  end?: number;
  sliceStart?: number;
  sliceEnd?: number;
  stretchFactor?: number;
  play?: boolean;
};
```

## Method Option Shapes

```ts
type ScanOptions = {
  dir: string | null;
  recursive?: boolean; // default true
  maxDepth?: number;   // default 10
  kinds?: MediaType[];
};

type StatsOptions = {
  dir: string | null;
  recursive?: boolean; // default true
  maxDepth?: number;   // default 10
};

type IndexOptions = {
  dir: string | null;
  recursive?: boolean;      // default true
  maxDepth?: number;        // default 10
  indexArchives?: boolean;  // default true
  archivePattern?: string;
  kinds?: MediaType[];
};

type QueryOptions = {
  dir: string | null;
  source?: 'scan' | 'index'; // default 'scan'
  recursive?: boolean;
  maxDepth?: number;
  indexArchives?: boolean;
  archivePattern?: string;
  text?: string;             // name/path contains
  kinds?: MediaType[];
  minSize?: number;
  maxSize?: number;
  orderBy?: 'name' | 'size' | 'mtime' | 'type'; // default 'name'
  order?: 'asc' | 'desc';                        // default 'asc'
  limit?: number;
  offset?: number;
};

type MediaDropOptions = {
  kinds?: MediaType[];
  loadAudio?: boolean;
  placeAudio?: AudioPlacementOptions;
};
```

## Coverage Notes

- `scan` and `stats` are fully implemented from Zig traversal/classification.
- `index` currently returns filesystem index coverage (same base traversal as scan).
- `indexArchives` and `archivePattern` are accepted by the API surface, but archive-entry expansion is not yet implemented in this V8 path.
- `query` runs in JS over scan/index results (text/kind/size filters + sorting + pagination).
- `loadAudio`, `loadSample`, and `placeAudio` only operate on filesystem audio
  files. Archive entries can be listed, but cannot be decoded until the archive
  index has extract/read-through support.
- `placeAudio` loads a WAV through `useAudio().loadSound`, optionally slices or
  stretches it, then calls `insertMedia` or `fitMedia`.
- `useDrop` wraps `useFileDrop`, classifies the dropped path, stats it, and can
  load or place audio before firing the handler.
- `useWatchedScan` combines `useScan` with `useFileWatch` and rescans when the
  watched directory changes.

## Example

```ts
import { useMedia } from '../../runtime/hooks';

export default function MediaPanel() {
  const media = useMedia();

  const { files, loading, rescan } = media.useScan({
    dir: '/home/user/Movies',
    recursive: true,
    maxDepth: 6,
    kinds: ['video', 'subtitle'],
  });

  const { stats } = media.useStats({
    dir: '/home/user/Movies',
  });

  const { results } = media.useQuery({
    dir: '/home/user/Movies',
    source: 'scan',
    text: 'beethoven',
    kinds: ['audio'],
    orderBy: 'size',
    order: 'desc',
    limit: 100,
  });

  media.useDrop((event) => {
    if (event.audio) {
      console.log('loaded sound handle', event.audio.sound);
    }
  }, {
    kinds: ['audio'],
    placeAudio: { track: 0, start: 1, end: 5, play: true },
  });

  return null;
}
```

## Audio File Flow

```ts
const media = useMedia();

const file = media.fileFromPath('/absolute/path/loop.wav');
const loaded = media.loadAudio(file);

if (loaded) {
  media.placeAudio(loaded.file, {
    track: 0,
    start: 1,
    end: 9,
  });
}

media.loadSample('drums', 1, '/absolute/path/kick.wav', 'oneshot');
```

## File Map

- Zig host implementation: `framework/v8_bindings_fs.zig`
- Low-level runtime wrapper: `runtime/hooks/media.ts`
- Collapsed hook surface: `runtime/hooks/useMedia.ts`
- File drop/watch hooks: `runtime/hooks/useFileDrop.ts`, `runtime/hooks/useFileWatch.ts`
- Audio bridge: `runtime/audio.tsx`, `framework/audio.zig`
- Public exports: `runtime/hooks/index.ts`
