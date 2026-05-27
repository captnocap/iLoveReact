// jamendo.ts — SourceAdapter for Jamendo (api.jamendo.com/v3.0).
//
// Jamendo is track/music-oriented (full songs) rather than one-shots, but
// useful for loops/beds and stems. Auth: a client_id (read) is enough — no
// OAuth needed for search or download. Two gotchas baked in below:
//   • The envelope carries success/failure in `headers.status`, NOT the HTTP
//     status — a 200 can still be a logical error, so we check the body.
//   • Per-track download is gated by `audiodownload_allowed`; when false the
//     `audiodownload` URL is an empty string. We fall back to the stream URL.
//
// Pagination is offset/limit (max 200), not page tokens.

import { defaultHttpGet } from './transport';
import { getToken } from './credentials';
import { licenseFromCcUrl } from './license';
import type {
  DownloadResolution,
  HttpGet,
  NormalizedSample,
  SearchPage,
  SearchQuery,
  SortKey,
  SourceAdapter,
} from './types';

const BASE = 'https://api.jamendo.com/v3.0';
const DEFAULT_LIMIT = 30;

// ── Raw response shapes (only the fields we read) ─────────────────────

interface JamendoMusicInfoTags {
  readonly genres?: readonly string[];
  readonly instruments?: readonly string[];
  readonly vartags?: readonly string[];
}

interface JamendoTrack {
  readonly id: string;
  readonly name?: string;
  readonly duration?: number;
  readonly artist_name?: string;
  readonly artist_id?: string;
  readonly releasedate?: string;
  readonly audio?: string;
  readonly audiodownload?: string;
  readonly audiodownload_allowed?: boolean;
  readonly license_ccurl?: string;
  readonly shareurl?: string;
  readonly musicinfo?: { readonly tags?: JamendoMusicInfoTags };
}

interface JamendoHeaders {
  readonly status?: string;
  readonly code?: number;
  readonly error_message?: string;
  readonly results_count?: number;
}

interface JamendoResponse {
  readonly headers?: JamendoHeaders;
  readonly results?: readonly JamendoTrack[];
}

// ── Mapping ───────────────────────────────────────────────────────────

function mapTags(t: JamendoTrack): readonly string[] {
  const tags = t.musicinfo?.tags;
  if (!tags) return [];
  return [...(tags.genres ?? []), ...(tags.instruments ?? []), ...(tags.vartags ?? [])];
}

function mapTrack(t: JamendoTrack): NormalizedSample {
  const sourceId = String(t.id);
  const dlAllowed = t.audiodownload_allowed === true
    && typeof t.audiodownload === 'string'
    && t.audiodownload.length > 0;
  const stream = typeof t.audio === 'string' && t.audio.length > 0 ? t.audio : null;
  return {
    source: 'jamendo',
    sourceId,
    uid: `jamendo:${sourceId}`,
    title: t.name ?? `track ${sourceId}`,
    description: t.artist_name ? `by ${t.artist_name}` : null,
    tags: mapTags(t),
    audio: {
      // Jamendo serves mp3 by default (audioformat=mp31/mp32). No samplerate
      // or channel count in the response → null; importer re-measures.
      format: 'mp3',
      durationSec: typeof t.duration === 'number' ? t.duration : null,
      sampleRateHz: null,
      channels: null,
      fileSizeBytes: null,
    },
    preview: stream ? { url: stream, format: 'mp3', bitRateKbps: 96, expiresAt: null } : null,
    original: dlAllowed ? { url: t.audiodownload as string, format: 'mp3', bitRateKbps: null, expiresAt: null } : null,
    requiresAuthToDownload: false,
    license: licenseFromCcUrl(t.license_ccurl),
    author: {
      name: t.artist_name ?? null,
      profileUrl: t.artist_id ? `https://www.jamendo.com/artist/${encodeURIComponent(t.artist_id)}` : null,
    },
    sourceUrl: t.shareurl ?? `https://www.jamendo.com/track/${sourceId}`,
    fetchedAt: Date.now(),
  };
}

function mapOrder(sort: SortKey | undefined): string | null {
  switch (sort) {
    case 'duration_asc': return 'duration_asc';
    case 'duration_desc': return 'duration_desc';
    case 'downloads_desc': return 'downloads_total_desc';
    case 'created_desc': return 'releasedate_desc';
    case 'relevance':
    default: return null; // Jamendo defaults to relevance; omit the param.
  }
}

function clientId(): string {
  const id = getToken('jamendo');
  if (!id) {
    throw new Error(
      'Jamendo client_id not set. Store one via the credential store ' +
      '(credentials.setToken("jamendo", "<client_id>")) before searching.',
    );
  }
  return id;
}

function parseBody(body: string): JamendoResponse {
  let data: JamendoResponse;
  try {
    data = JSON.parse(body) as JamendoResponse;
  } catch {
    throw new Error('Jamendo: response was not valid JSON');
  }
  // Logical errors ride in headers.status even on HTTP 200.
  if (data.headers && data.headers.status && data.headers.status !== 'success') {
    throw new Error(`Jamendo: ${data.headers.error_message || `error code ${data.headers.code}`}`);
  }
  return data;
}

// ── Adapter ───────────────────────────────────────────────────────────

export function createJamendoAdapter(http: HttpGet = defaultHttpGet): SourceAdapter {
  function buildParams(query: SearchQuery, limit: number, offset: number): URLSearchParams {
    const params = new URLSearchParams({
      client_id: clientId(),
      format: 'json',
      limit: String(limit),
      offset: String(offset),
      include: 'musicinfo licenses',
      audioformat: 'mp32',
    });
    if (query.text) params.set('namesearch', query.text);
    const tags = (query.tags ?? []).filter((t) => t.trim());
    if (tags.length) params.set('fuzzytags', tags.join(' '));
    if (typeof query.durationSecMin === 'number' || typeof query.durationSecMax === 'number') {
      const lo = Math.max(0, Math.floor(query.durationSecMin ?? 0));
      const hi = Math.floor(query.durationSecMax ?? 99999);
      params.set('durationbetween', `${lo}_${hi}`);
    }
    const order = mapOrder(query.sort);
    if (order) params.set('order', order);
    return params;
  }

  async function search(query: SearchQuery): Promise<SearchPage> {
    const limit = query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 200) : DEFAULT_LIMIT;
    const offset = query.cursor ? Math.max(0, parseInt(query.cursor, 10) || 0) : 0;
    const params = buildParams(query, limit, offset);

    const res = await http(`${BASE}/tracks/?${params.toString()}`);
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Jamendo: auth rejected (HTTP ${res.status}) — check the client_id`);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Jamendo: search failed (HTTP ${res.status})`);
    }
    const data = parseBody(res.body);
    const results = data.results ?? [];
    let items = results.map(mapTrack);
    if (query.commercialUseOnly) {
      items = items.filter((s) => s.license.allowsCommercial !== false);
    }
    // No fullcount requested (perf) — infer another page when the page filled.
    const hasNext = results.length === limit;
    return {
      items,
      totalCount: null,
      nextCursor: hasNext ? String(offset + limit) : null,
    };
  }

  async function getById(sourceId: string): Promise<NormalizedSample | null> {
    const params = new URLSearchParams({
      client_id: clientId(),
      format: 'json',
      include: 'musicinfo licenses',
      audioformat: 'mp32',
      id: sourceId,
    });
    const res = await http(`${BASE}/tracks/?${params.toString()}`);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Jamendo: getById failed (HTTP ${res.status})`);
    }
    const data = parseBody(res.body);
    const first = (data.results ?? [])[0];
    return first ? mapTrack(first) : null;
  }

  async function resolveDownload(sample: NormalizedSample): Promise<DownloadResolution | null> {
    // Prefer the full download when the artist allowed it; else the stream.
    const asset = sample.original ?? sample.preview;
    if (!asset) return null;
    return { url: asset.url, sourceFormat: asset.format };
  }

  return {
    source: 'jamendo',
    displayName: 'Jamendo',
    needsAuthForSearch: true,
    needsAuthForOriginal: false,
    search,
    getById,
    resolveDownload,
  };
}
