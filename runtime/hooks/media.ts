import { callHostJson } from '../ffi';

export type MediaType =
  | 'video'
  | 'audio'
  | 'image'
  | 'subtitle'
  | 'document'
  | 'archive'
  | 'metadata'
  | 'unknown';

export type MediaFile = {
  path: string;
  name: string;
  size: number;
  mtime?: number;
  type: MediaType;
  source: 'filesystem' | 'archive';
  archivePath?: string;
  archiveEntry?: string;
};

export type DirStats = {
  total: number;
  byType: Partial<Record<MediaType, number>>;
  totalSize: number;
  largestFile: MediaFile | null;
};

export type MediaScanOptions = {
  recursive?: boolean;
  maxDepth?: number;
};

export type MediaIndexOptions = MediaScanOptions & {
  indexArchives?: boolean;
  archivePattern?: string;
};

export function scan(dir: string, options?: MediaScanOptions): MediaFile[] {
  if (!dir) return [];
  return callHostJson<MediaFile[]>(
    '__fs_media_scan_json',
    [],
    dir,
    options?.recursive ?? true ? 1 : 0,
    options?.maxDepth ?? 10,
  );
}

export function dirStats(dir: string, options?: MediaScanOptions): DirStats {
  const empty: DirStats = { total: 0, byType: {}, totalSize: 0, largestFile: null };
  if (!dir) return empty;
  return callHostJson<DirStats>(
    '__fs_media_stats_json',
    empty,
    dir,
    options?.recursive ?? true ? 1 : 0,
    options?.maxDepth ?? 10,
  );
}

export function indexDeep(dir: string, options?: MediaIndexOptions): MediaFile[] {
  if (!dir) return [];
  return callHostJson<MediaFile[]>(
    '__fs_media_index_json',
    [],
    dir,
    options?.recursive ?? true ? 1 : 0,
    options?.maxDepth ?? 10,
    options?.indexArchives ?? true ? 1 : 0,
    options?.archivePattern ?? '',
  );
}

const MEDIA_TYPES: Record<string, MediaType> = {
  mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', wmv: 'video',
  webm: 'video', flv: 'video', m4v: 'video', mpg: 'video', mpeg: 'video',
  // m2ts / mts are the unambiguous MPEG-TS container extensions. Bare
  // `.ts` is overloaded with TypeScript source files — classifying every
  // .ts as video and feeding it to libmpv produces "Failed to recognize
  // file format" on any cart that lives in a TS source tree.
  m2ts: 'video', mts: 'video', vob: 'video', ogv: 'video', '3gp': 'video',
  mp3: 'audio', flac: 'audio', ogg: 'audio', wav: 'audio', aac: 'audio',
  m4a: 'audio', wma: 'audio', opus: 'audio', aiff: 'audio', ape: 'audio', alac: 'audio',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', bmp: 'image',
  webp: 'image', svg: 'image', tiff: 'image', tif: 'image', ico: 'image',
  heic: 'image', heif: 'image', avif: 'image', raw: 'image',
  srt: 'subtitle', ass: 'subtitle', ssa: 'subtitle', sub: 'subtitle', vtt: 'subtitle', idx: 'subtitle',
  pdf: 'document', epub: 'document', mobi: 'document', djvu: 'document', txt: 'document', md: 'document',
  doc: 'document', docx: 'document', rtf: 'document', odt: 'document',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive',
  xz: 'archive', zst: 'archive', iso: 'archive', cab: 'archive', lz4: 'archive',
  nfo: 'metadata', xml: 'metadata',
};

export function classifyFile(filename: string): MediaType {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return 'unknown';
  return MEDIA_TYPES[ext] || 'unknown';
}

export function formatSize(bytes: number): string {
  if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(1)} TB`;
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

