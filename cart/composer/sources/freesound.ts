// freesound.ts — reference SourceAdapter for Freesound (freesound.org/apiv2).
//
// Freesound is the richest one-shot / field-recording / loop source and the
// model the other adapters follow. Auth: a read token (header
// `Authorization: Token <token>`) is required even for search. Downloading
// the *original* needs OAuth2, which we have not wired yet — so for now we
// import the hi-quality mp3 preview (no auth) and transcode to WAV. Originals
// are modelled (see `original`) but left null until the OAuth flow lands.
//
// Solr-backed search: see the API notes the team gathered — `fields` must be
// requested explicitly or you pay an N+1 round-trip per result.

import { defaultHttpGet } from './transport';
import { getToken } from './credentials';
import type {
  AudioFormat,
  DownloadResolution,
  HttpGet,
  LicenseFamily,
  NormalizedLicense,
  NormalizedSample,
  SearchPage,
  SearchQuery,
  SortKey,
  SourceAdapter,
} from './types';

const BASE = 'https://freesound.org/apiv2';
const DEFAULT_PAGE_SIZE = 30;
// Request exactly the fields we map below — anything else is wasted transfer.
const FIELDS = [
  'id', 'name', 'tags', 'description', 'license', 'type', 'channels',
  'duration', 'samplerate', 'filesize', 'username', 'url', 'previews',
  'download', 'ai_preference',
].join(',');

// ── Raw response shapes (only the fields we read) ─────────────────────

interface FsPreviews {
  readonly 'preview-hq-mp3'?: string;
  readonly 'preview-lq-mp3'?: string;
  readonly 'preview-hq-ogg'?: string;
  readonly 'preview-lq-ogg'?: string;
}

interface FsSound {
  readonly id: number;
  readonly name?: string;
  readonly tags?: readonly string[];
  readonly description?: string;
  readonly license?: string;
  readonly type?: string;
  readonly channels?: number;
  readonly duration?: number;
  readonly samplerate?: number;
  readonly filesize?: number;
  readonly username?: string;
  readonly url?: string;
  readonly previews?: FsPreviews;
  readonly download?: string;
  readonly ai_preference?: string;
}

interface FsSearchResponse {
  readonly count: number;
  readonly next: string | null;
  readonly previous: string | null;
  readonly results: readonly FsSound[];
}

// ── Mapping helpers ───────────────────────────────────────────────────

/** Freesound returns one of three licence strings (or a deed URL). Map the
 *  human strings to our family + permission flags; fall back to `custom`. */
function mapLicense(raw: string | undefined): NormalizedLicense {
  const s = (raw ?? '').trim().toLowerCase();
  let family: LicenseFamily = 'unknown';
  let allowsCommercial: boolean | null = null;
  let requiresAttribution: boolean | null = null;
  if (s === 'creative commons 0' || s.includes('publicdomain/zero')) {
    family = 'cc0'; allowsCommercial = true; requiresAttribution = false;
  } else if (s === 'attribution' || (s.includes('/by/') && !s.includes('nc'))) {
    family = 'cc-by'; allowsCommercial = true; requiresAttribution = true;
  } else if (s === 'attribution noncommercial' || s.includes('by-nc')) {
    family = 'cc-by-nc'; allowsCommercial = false; requiresAttribution = true;
  } else if (s.includes('sampling+')) {
    family = 'cc-sampling-plus'; requiresAttribution = true;
  } else if (s.length > 0) {
    family = 'custom';
  }
  // Freesound deed URLs come through as the licence string for some records;
  // keep it as the canonical url when it looks like one.
  const url = (raw ?? '').startsWith('http') ? (raw ?? null) : null;
  return { family, url, requiresAttribution, allowsCommercial, allowsAiTraining: null };
}

function mapFormat(type: string | undefined): AudioFormat {
  switch ((type ?? '').toLowerCase()) {
    case 'wav': return 'wav';
    case 'aif':
    case 'aiff': return 'aiff';
    case 'flac': return 'flac';
    case 'mp3': return 'mp3';
    case 'ogg': return 'ogg';
    case 'm4a': return 'm4a';
    default: return 'unknown';
  }
}

function mapSound(s: FsSound): NormalizedSample {
  const sourceId = String(s.id);
  const previewUrl = s.previews?.['preview-hq-mp3'] ?? s.previews?.['preview-lq-mp3'] ?? null;
  return {
    source: 'freesound',
    sourceId,
    uid: `freesound:${sourceId}`,
    title: s.name ?? `sound ${sourceId}`,
    description: s.description ?? null,
    tags: s.tags ?? [],
    audio: {
      format: mapFormat(s.type),
      durationSec: typeof s.duration === 'number' ? s.duration : null,
      sampleRateHz: typeof s.samplerate === 'number' ? s.samplerate : null,
      channels: typeof s.channels === 'number' ? s.channels : null,
      fileSizeBytes: typeof s.filesize === 'number' ? s.filesize : null,
    },
    preview: previewUrl
      ? { url: previewUrl, format: 'mp3', bitRateKbps: 128, expiresAt: null }
      : null,
    // Original exists (s.download) but is OAuth2-gated — left null until that
    // flow is wired, so the import bridge falls back to the preview.
    original: null,
    requiresAuthToDownload: true,
    license: mapLicense(s.license),
    author: {
      name: s.username ?? null,
      profileUrl: s.username ? `https://freesound.org/people/${encodeURIComponent(s.username)}/` : null,
    },
    sourceUrl: s.url ?? `https://freesound.org/s/${sourceId}/`,
    fetchedAt: Date.now(),
  };
}

function mapSort(sort: SortKey | undefined): string {
  switch (sort) {
    case 'duration_asc': return 'duration_asc';
    case 'duration_desc': return 'duration_desc';
    case 'downloads_desc': return 'downloads_desc';
    case 'created_desc': return 'created_desc';
    case 'relevance':
    default: return 'score';
  }
}

/** Build the Solr `filter` string from the normalized query. Empty string
 *  when nothing to filter (caller omits the param then). */
function buildFilter(q: SearchQuery): string {
  const parts: string[] = [];
  if (typeof q.durationSecMin === 'number' || typeof q.durationSecMax === 'number') {
    const lo = typeof q.durationSecMin === 'number' ? q.durationSecMin : '*';
    const hi = typeof q.durationSecMax === 'number' ? q.durationSecMax : '*';
    parts.push(`duration:[${lo} TO ${hi}]`);
  }
  for (const tag of q.tags ?? []) {
    if (tag.trim()) parts.push(`tag:${JSON.stringify(tag)}`);
  }
  if (q.commercialUseOnly) {
    // Drop NonCommercial: keep only CC0 + Attribution.
    parts.push('license:("Attribution" OR "Creative Commons 0")');
  }
  return parts.join(' ');
}

function authHeaders(): Record<string, string> {
  const token = getToken('freesound');
  if (!token) {
    throw new Error(
      'Freesound token not set. Store one via the credential store ' +
      '(credentials.setToken("freesound", "<token>")) before searching.',
    );
  }
  return { Authorization: `Token ${token}` };
}

function parseBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Freesound: response was not valid JSON');
  }
}

// ── Adapter ───────────────────────────────────────────────────────────

export function createFreesoundAdapter(http: HttpGet = defaultHttpGet): SourceAdapter {
  async function search(query: SearchQuery): Promise<SearchPage> {
    const pageSize = query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 150) : DEFAULT_PAGE_SIZE;
    const page = query.cursor ? Math.max(1, parseInt(query.cursor, 10) || 1) : 1;
    const params = new URLSearchParams({
      query: query.text,
      fields: FIELDS,
      sort: mapSort(query.sort),
      page: String(page),
      page_size: String(pageSize),
    });
    const filter = buildFilter(query);
    if (filter) params.set('filter', filter);

    const res = await http(`${BASE}/search/?${params.toString()}`, authHeaders());
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Freesound: auth rejected (HTTP ${res.status}) — check the token`);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Freesound: search failed (HTTP ${res.status})`);
    }
    const data = parseBody(res.body) as FsSearchResponse;
    if (!Array.isArray(data.results)) {
      throw new Error('Freesound: malformed search response (no results array)');
    }
    const hasNext = typeof data.next === 'string' && data.next.length > 0;
    return {
      items: data.results.map(mapSound),
      totalCount: typeof data.count === 'number' ? data.count : null,
      nextCursor: hasNext ? String(page + 1) : null,
    };
  }

  async function getById(sourceId: string): Promise<NormalizedSample | null> {
    const params = new URLSearchParams({ fields: FIELDS });
    const res = await http(`${BASE}/sounds/${encodeURIComponent(sourceId)}/?${params.toString()}`, authHeaders());
    if (res.status === 404) return null;
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Freesound: getById failed (HTTP ${res.status})`);
    }
    return mapSound(parseBody(res.body) as FsSound);
  }

  async function resolveDownload(sample: NormalizedSample): Promise<DownloadResolution | null> {
    // Originals need OAuth2 (not wired yet) so we serve the public preview.
    // Previews require no auth header. When OAuth lands, prefer sample.original.
    if (sample.preview) {
      return { url: sample.preview.url, sourceFormat: sample.preview.format };
    }
    return null;
  }

  return {
    source: 'freesound',
    displayName: 'Freesound',
    needsAuthForSearch: true,
    needsAuthForOriginal: true,
    search,
    getById,
    resolveDownload,
  };
}
