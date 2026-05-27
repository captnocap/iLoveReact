// types.ts — normalized cross-source types for the composer sample
// aggregator. Mirrors cart/cutout/backends/types.ts's role: every adapter
// under sources/ maps its provider-native response into these shapes, so
// the rest of the cart only ever deals with one schema.
//
// Design rule (carried over from the strict draft): "the provider didn't
// tell us" is a real state the caller must handle, so optional technical /
// license fields are modelled as `T | null`, not `field?: T`. `?` is
// reserved for genuinely-absent query inputs.

/** Providers we have (or are building) first-class adapters for. The
 *  build order is freesound → internet_archive → fma → jamendo. */
export type SourceId = 'freesound' | 'internet_archive' | 'fma' | 'jamendo';

/** Container/codec as the provider reports it (lowercased, normalized).
 *  `unknown` when the provider is silent — we probe on ingest if it matters. */
export type AudioFormat =
  | 'wav' | 'aiff' | 'flac' | 'mp3' | 'ogg' | 'm4a' | 'opus' | 'unknown';

export type LicenseFamily =
  | 'cc0'
  | 'cc-by'
  | 'cc-by-sa'
  | 'cc-by-nc'
  | 'cc-by-nc-sa'
  | 'cc-by-nd'
  | 'cc-by-nc-nd'
  | 'cc-sampling-plus'
  | 'public-domain'
  | 'custom'
  | 'unknown';

/** Normalized licence. Tri-state booleans: null = the provider does not
 *  give us enough to decide. The UI should treat null as "unknown, show a
 *  warning" rather than "permitted". */
export interface NormalizedLicense {
  readonly family: LicenseFamily;
  /** Canonical deed URL, e.g. https://creativecommons.org/licenses/by/4.0/ */
  readonly url: string | null;
  readonly requiresAttribution: boolean | null;
  readonly allowsCommercial: boolean | null;
  /** Generative-AI training permission. Freesound exposes `ai_preference`;
   *  most providers are silent (null). */
  readonly allowsAiTraining: boolean | null;
}

/** Technical metadata as reported by the provider. Every field nullable —
 *  providers omit or lie (Freesound itself warns its `bitdepth` is
 *  untrustworthy), so the importer re-measures from the downloaded file. */
export interface AudioMeta {
  readonly format: AudioFormat;
  readonly durationSec: number | null;
  readonly sampleRateHz: number | null;
  readonly channels: number | null;
  readonly fileSizeBytes: number | null;
}

/** A fetchable audio URL. `expiresAt` tracks signed/ephemeral URLs (Pixabay
 *  24h, some Internet Archive derivatives) so callers never persist a URL
 *  and expect it to resolve later — re-resolve via the adapter instead. */
export interface MediaAsset {
  readonly url: string;
  readonly format: AudioFormat;
  readonly bitRateKbps: number | null;
  /** Epoch ms when this URL stops resolving; null = stable/canonical. */
  readonly expiresAt: number | null;
}

export interface Author {
  readonly name: string | null;
  readonly profileUrl: string | null;
}

/** The unified sample every adapter emits. Provider-agnostic; this is what
 *  the search UI renders and what the import bridge consumes. */
export interface NormalizedSample {
  readonly source: SourceId;
  /** Provider-native id, stringified. Stable across refetches. */
  readonly sourceId: string;
  /** Stable composite key for dedupe/caching: `${source}:${sourceId}`. */
  readonly uid: string;

  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];

  readonly audio: AudioMeta;
  /** Openly streamable, no auth. Used for in-app preview playback and, until
   *  per-provider original downloads land, as the import source too. */
  readonly preview: MediaAsset | null;
  /** Full-quality original. null when not obtainable, or gated behind auth
   *  we haven't wired yet (Freesound originals need OAuth2). */
  readonly original: MediaAsset | null;
  /** True when fetching `original` needs auth beyond a read token. */
  readonly requiresAuthToDownload: boolean;

  readonly license: NormalizedLicense;
  readonly author: Author;
  /** Human-facing page on the provider site. */
  readonly sourceUrl: string | null;

  /** Epoch ms we fetched this record. */
  readonly fetchedAt: number;
}

// ── Query + paging (adapters translate these to provider params) ──────

export type SortKey =
  | 'relevance'
  | 'duration_asc'
  | 'duration_desc'
  | 'downloads_desc'
  | 'created_desc';

export interface SearchQuery {
  readonly text: string;
  readonly tags?: readonly string[];
  readonly durationSecMin?: number;
  readonly durationSecMax?: number;
  /** Restrict to results we may use commercially (drops NC licences). */
  readonly commercialUseOnly?: boolean;
  readonly sort?: SortKey;
  readonly pageSize?: number;
  /** Opaque, provider-specific cursor returned by a prior page. */
  readonly cursor?: string | null;
}

export interface SearchPage {
  readonly items: readonly NormalizedSample[];
  /** Total matches if the provider reports it (some cap or omit this). */
  readonly totalCount: number | null;
  /** Pass to the next SearchQuery.cursor; null = last page. */
  readonly nextCursor: string | null;
}

/** What `resolveDownload` hands the import bridge: a currently-valid URL plus
 *  the format of the bytes at that URL (so the bridge knows whether it must
 *  transcode to WAV, or can stream straight through). */
export interface DownloadResolution {
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly sourceFormat: AudioFormat;
}

/** Minimal HTTP GET the adapters depend on. Injectable into each factory so
 *  tests can feed captured responses without the runtime FFI network (which
 *  only exists inside the full app, not under tools/v8cli). Production passes
 *  defaultHttpGet (see transport.ts). */
export interface HttpGet {
  (url: string, headers?: Record<string, string>): Promise<{ status: number; body: string }>;
}

/** One adapter per SourceId. Factories (createXAdapter) follow the cutout
 *  backends convention so adapters stay pure — no React, no workspace
 *  coupling, importing only the runtime fetch hook + the credential store. */
export interface SourceAdapter {
  readonly source: SourceId;
  readonly displayName: string;
  /** True if even *search* needs a token (Freesound: yes). */
  readonly needsAuthForSearch: boolean;
  /** True if downloading the full original needs OAuth/user auth. */
  readonly needsAuthForOriginal: boolean;

  search(query: SearchQuery): Promise<SearchPage>;
  getById(sourceId: string): Promise<NormalizedSample | null>;
  /** Resolve a fresh, currently-fetchable asset for download. null when
   *  nothing is obtainable with the auth we currently hold. */
  resolveDownload(sample: NormalizedSample): Promise<DownloadResolution | null>;
}
