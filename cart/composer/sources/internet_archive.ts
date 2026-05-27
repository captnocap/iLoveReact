// internet_archive.ts — SourceAdapter for the Internet Archive (archive.org).
//
// Huge volume of public-domain / CC audio. No auth for search or download.
// The IA data model is item → many files, and advancedsearch returns items
// without their file lists, so:
//   • search() runs advancedsearch (cheap, one round-trip) and maps each
//     item to a NormalizedSample with no preview/audio meta yet.
//   • resolveDownload() / getById() fetch /metadata/<id>, pick the best audio
//     file, and build the download URL.
// An item can hold many audio files (e.g. an album); we pick one
// representative file (lossless-preferred, largest). Expanding items into
// per-file results is a refinement for the unified search layer later.

import { defaultHttpGet } from './transport';
import { licenseFromCcUrl } from './license';
import type {
  AudioFormat,
  DownloadResolution,
  HttpGet,
  NormalizedSample,
  SearchPage,
  SearchQuery,
  SortKey,
  SourceAdapter,
} from './types';

const SEARCH = 'https://archive.org/advancedsearch.php';
const META = 'https://archive.org/metadata';
const DL = 'https://archive.org/download';
const DEFAULT_ROWS = 30;

// ── Raw response shapes (only the fields we read) ─────────────────────

interface IaDoc {
  readonly identifier: string;
  readonly title?: string | readonly string[];
  readonly creator?: string | readonly string[];
  readonly licenseurl?: string | readonly string[];
  readonly description?: string | readonly string[];
  readonly subject?: string | readonly string[];
}

interface IaSearchResponse {
  readonly response?: {
    readonly numFound?: number;
    readonly start?: number;
    readonly docs?: readonly IaDoc[];
  };
}

interface IaFile {
  readonly name: string;
  readonly format?: string;
  readonly size?: string;   // bytes, as a string
  readonly length?: string; // seconds "183.45" or "mm:ss"
  readonly title?: string;
}

interface IaMetadata {
  readonly metadata?: {
    readonly identifier?: string;
    readonly title?: string | readonly string[];
    readonly creator?: string | readonly string[];
    readonly licenseurl?: string;
    readonly description?: string | readonly string[];
  };
  readonly files?: readonly IaFile[];
}

// ── Small coercion helpers (IA fields are string | string[]) ──────────

function firstStr(v: string | readonly string[] | undefined): string | null {
  if (Array.isArray(v)) return v.length ? String(v[0]) : null;
  return typeof v === 'string' ? v : null;
}

function allStr(v: string | readonly string[] | undefined): string[] {
  if (Array.isArray(v)) return v.map(String);
  return typeof v === 'string' ? [v] : [];
}

/** Parse IA's `length` ("183.45" or "3:03") into seconds. */
function parseLength(len: string | undefined): number | null {
  if (!len) return null;
  if (len.includes(':')) {
    const parts = len.split(':').map((p) => parseInt(p, 10));
    if (parts.some((n) => Number.isNaN(n))) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  const f = parseFloat(len);
  return Number.isFinite(f) ? f : null;
}

// ── Audio-file detection + ranking ────────────────────────────────────

const AUDIO_EXT: Record<string, AudioFormat> = {
  wav: 'wav', aiff: 'aiff', aif: 'aiff', flac: 'flac',
  mp3: 'mp3', ogg: 'ogg', oga: 'ogg', m4a: 'm4a', opus: 'opus',
};

function formatOf(file: IaFile): AudioFormat {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  return AUDIO_EXT[ext] ?? 'unknown';
}

/** Lossless first, then mp3, then other lossy; ties broken by file size. */
function fileScore(file: IaFile): number {
  const fmt = formatOf(file);
  const rank =
    fmt === 'wav' || fmt === 'aiff' || fmt === 'flac' ? 3 :
    fmt === 'mp3' ? 2 :
    fmt === 'ogg' || fmt === 'm4a' || fmt === 'opus' ? 1 : 0;
  const size = parseInt(file.size ?? '0', 10) || 0;
  return rank * 1e12 + size;
}

function pickAudioFile(files: readonly IaFile[]): IaFile | null {
  const audio = files.filter((f) => formatOf(f) !== 'unknown');
  if (!audio.length) return null;
  return audio.reduce((best, f) => (fileScore(f) > fileScore(best) ? f : best));
}

function downloadUrl(identifier: string, fileName: string): string {
  // Each path segment encoded individually so '/' inside file paths survives.
  const encName = fileName.split('/').map(encodeURIComponent).join('/');
  return `${DL}/${encodeURIComponent(identifier)}/${encName}`;
}

// ── Mapping ───────────────────────────────────────────────────────────

/** Map a search doc — no file list yet, so preview/audio stay null and get
 *  filled by resolveDownload/getById via the metadata endpoint. */
function mapDoc(doc: IaDoc): NormalizedSample {
  const id = doc.identifier;
  return {
    source: 'internet_archive',
    sourceId: id,
    uid: `internet_archive:${id}`,
    title: firstStr(doc.title) ?? id,
    description: firstStr(doc.description),
    tags: allStr(doc.subject),
    audio: { format: 'unknown', durationSec: null, sampleRateHz: null, channels: null, fileSizeBytes: null },
    preview: null,
    original: null,
    requiresAuthToDownload: false,
    license: licenseFromCcUrl(firstStr(doc.licenseurl)),
    author: { name: firstStr(doc.creator), profileUrl: null },
    sourceUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
    fetchedAt: Date.now(),
  };
}

/** Map full metadata (item fields + chosen audio file) into a sample with
 *  audio meta + a concrete original asset. */
function mapMetadata(id: string, meta: IaMetadata): NormalizedSample {
  const m = meta.metadata ?? {};
  const file = pickAudioFile(meta.files ?? []);
  const fmt = file ? formatOf(file) : 'unknown';
  const url = file ? downloadUrl(id, file.name) : null;
  return {
    source: 'internet_archive',
    sourceId: id,
    uid: `internet_archive:${id}`,
    title: firstStr(m.title) ?? id,
    description: firstStr(m.description),
    tags: [],
    audio: {
      format: fmt,
      durationSec: file ? parseLength(file.length) : null,
      sampleRateHz: null,
      channels: null,
      fileSizeBytes: file ? (parseInt(file.size ?? '0', 10) || null) : null,
    },
    // IA forbids nothing here, but the file is the real asset → expose as
    // original. Previews would need a derivative; not modelled yet.
    preview: null,
    original: url ? { url, format: fmt, bitRateKbps: null, expiresAt: null } : null,
    requiresAuthToDownload: false,
    license: licenseFromCcUrl(m.licenseurl),
    author: { name: firstStr(m.creator), profileUrl: null },
    sourceUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
    fetchedAt: Date.now(),
  };
}

function mapSort(sort: SortKey | undefined): string | null {
  switch (sort) {
    case 'downloads_desc': return 'downloads desc';
    case 'created_desc': return 'addeddate desc';
    // IA can't sort by per-item duration (length is per-file) → default.
    default: return null;
  }
}

async function fetchMetadata(http: HttpGet, id: string): Promise<IaMetadata> {
  const res = await http(`${META}/${encodeURIComponent(id)}`);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Internet Archive: metadata failed (HTTP ${res.status})`);
  }
  try {
    return JSON.parse(res.body) as IaMetadata;
  } catch {
    throw new Error('Internet Archive: metadata response was not valid JSON');
  }
}

// ── Adapter ───────────────────────────────────────────────────────────

export function createInternetArchiveAdapter(http: HttpGet = defaultHttpGet): SourceAdapter {
  async function search(query: SearchQuery): Promise<SearchPage> {
    const rows = query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 100) : DEFAULT_ROWS;
    const page = query.cursor ? Math.max(1, parseInt(query.cursor, 10) || 1) : 1;

    // Constrain to audio items. tags become subject clauses; commercial-use
    // filtering isn't reliable in advancedsearch so it's applied post-hoc.
    const clauses = ['mediatype:(audio)'];
    if (query.text.trim()) clauses.push(`(${query.text.trim()})`);
    for (const tag of query.tags ?? []) {
      if (tag.trim()) clauses.push(`subject:(${JSON.stringify(tag)})`);
    }

    const params = new URLSearchParams({ q: clauses.join(' AND '), output: 'json', rows: String(rows), page: String(page) });
    for (const fl of ['identifier', 'title', 'creator', 'licenseurl', 'description', 'subject']) {
      params.append('fl[]', fl);
    }
    const sort = mapSort(query.sort);
    if (sort) params.append('sort[]', sort);

    const res = await http(`${SEARCH}?${params.toString()}`);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Internet Archive: search failed (HTTP ${res.status})`);
    }
    let data: IaSearchResponse;
    try {
      data = JSON.parse(res.body) as IaSearchResponse;
    } catch {
      throw new Error('Internet Archive: search response was not valid JSON');
    }
    const resp = data.response ?? {};
    const docs = resp.docs ?? [];
    let items = docs.map(mapDoc);
    if (query.commercialUseOnly) {
      items = items.filter((s) => s.license.allowsCommercial !== false);
    }
    const numFound = typeof resp.numFound === 'number' ? resp.numFound : null;
    const seen = (page - 1) * rows + docs.length;
    const hasNext = numFound !== null ? seen < numFound : docs.length === rows;
    return { items, totalCount: numFound, nextCursor: hasNext ? String(page + 1) : null };
  }

  async function getById(sourceId: string): Promise<NormalizedSample | null> {
    const meta = await fetchMetadata(http, sourceId);
    if (!meta.metadata && !meta.files) return null;
    return mapMetadata(sourceId, meta);
  }

  async function resolveDownload(sample: NormalizedSample): Promise<DownloadResolution | null> {
    // If we already resolved an original (e.g. via getById), use it.
    if (sample.original) {
      return { url: sample.original.url, sourceFormat: sample.original.format };
    }
    // Otherwise look up the item's files now and pick the best audio file.
    const meta = await fetchMetadata(http, sample.sourceId);
    const file = pickAudioFile(meta.files ?? []);
    if (!file) return null;
    return { url: downloadUrl(sample.sourceId, file.name), sourceFormat: formatOf(file) };
  }

  return {
    source: 'internet_archive',
    displayName: 'Internet Archive',
    needsAuthForSearch: false,
    needsAuthForOriginal: false,
    search,
    getById,
    resolveDownload,
  };
}
