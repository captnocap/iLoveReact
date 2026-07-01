// buildjournal/types.ts — the data model for the visible build-journal stream.
//
// The request ledger (tools/request + docs/game/_requests/req_*.json) is the
// hidden source data. This layer turns it into a VISIBLE, self-incrementing
// build-number stream and a set of durable BUG THREADS that survive across
// sessions. The intake (cart/hmsc-workspace-mock/DESIGN_INTAKE.md → "Bottom
// Dock And Build Journal") is the felt requirement; this file is its shape.
//
// Three records, narrow on purpose (deep module, strict surface):
//   - BuildNote   one handled request, presented as a build version.
//   - BugThread   a recurring issue with a stable id + a human-editable name,
//                 so a break that reappears weeks later reattaches to history.
//   - LogCapture  a recorded console/diagnostics slice that travels with a thread.
//
// Identity is the whole game: links are by STABLE id (stableId / requestId /
// buildId / capture id), never by display name. Renaming a thread changes only
// its semanticName — every link keeps pointing at the same stableId.

/** One request, presented as a build version in the journal stream. EVERY request
 *  becomes a note the instant it lands — resolved or not — so an open bug is
 *  threadable immediately and never waits on someone writing a trophy paragraph.
 *  Derived from a request-ledger entry; `buildId` is `deriveBuildNumber(requestId)`. */
export interface BuildNote {
  /** Source request id, e.g. 'req_2163'. The ledger key this note was ingested from. */
  requestId: string;
  /** Derived build-number stream value, e.g. '1.0.0.2163'. */
  buildId: string;
  /** Who handled it (the agent/actor that touched the request), or its origin. */
  agent: string;
  /** The request text — what the user actually asked, in their words. The honest half. */
  ask: string;
  /** The agent's CLAIM of what it did (the resolution paragraph). Empty until written.
   *  Presented as a claim, never as fact — the evidence is `commits` + recurrence. */
  summary: string;
  /** Lifecycle status metadata (new/doing/review/done). A faint tag, never a gate. */
  status: string;
  /** Commit shas attached to the request — the hard evidence an attempt shipped
   *  anything. Zero commits behind a flowery claim reads as exactly that. */
  commits: string[];
  /** Free trace tags carried for filtering the journal. */
  traceTags: string[];
  /** Stable ids of bug threads this note is linked to. */
  threadIds: string[];
  /** Ids of diagnostic captures attached to this note. */
  captureIds: string[];
}

/** A recurring issue. The STABLE id never changes; the semantic name is the
 *  user-editable, human-memorable label ('jesus water walking'). A break that
 *  reappears later reattaches here so prior context is one search away. */
export interface BugThread {
  /** Internal, permanent id. All links point at this — renames never touch it. */
  stableId: string;
  /** User-editable display name, e.g. 'jesus water walking'. */
  semanticName: string;
  /** User-editable longer description — what this thread is actually about, in
   *  the user's words. Empty until written; the name stays the short handle. */
  description: string;
  /** Prior names / alternate phrasings, kept searchable. Renames push the old
   *  name here so a remembered label still finds the thread. */
  aliases: string[];
  /** Categorization tags ('physics', 'water', 'collision', …). */
  tags: string[];
  /** Extra free tokens to widen semantic search beyond the name. */
  searchTokens: string[];
  /** Capture ids attached to this thread, newest-relevant first. */
  attachedCaptures: string[];
  /** Request ids linked to this thread across all the times it broke. */
  linkedRequests: string[];
  /** Build-number stream values linked to this thread. */
  linkedBuilds: string[];
  /** Per-attempt rating, requestId → 1..10. How good was that stab at the bug?
   *  This is what turns a pile of attempts into a RANKED haystack: the needle
   *  (the fix that worked) rates high and floats up, the drunk ones sink. */
  ratings: Record<string, number>;
  /** The one crowned attempt — the gospel. The requestId whose fix is THE answer,
   *  pinned above the noise so a recurrence reads the needle instead of re-deriving.
   *  Empty when the thread hasn't found its guiding light yet. */
  gospel: string;
}

/** A recorded diagnostics/console slice. Created in-app (no terminal), it
 *  preserves the channels, time window, and the build version that produced it
 *  so a useful slice becomes part of the traceable history. */
export interface LogCapture {
  /** Stable capture id. */
  id: string;
  /** Human label for the capture. */
  name: string;
  /** Diagnostics channel ids included in the slice. */
  channels: string[];
  /** Wall-clock window the capture covers (ms). */
  timeRange: { start: number; end: number };
  /** Build-number stream value live when the capture was taken. */
  buildId: string;
  /** Map / scene context the capture was taken in. */
  mapContext: string;
  /** Short human note about why this slice matters. */
  note: string;
}

/** The slice of a request-ledger entry the journal ingests. Mirrors the on-disk
 *  docs/game/_requests/req_*.json shape; extra fields are ignored. READ-ONLY
 *  source data — the journal never writes back to the ledger. */
export interface RequestEntry {
  id: string;
  at?: string;
  origin?: string;
  text: string;
  status?: string;
  events?: Array<{ at?: string; actor?: string; kind?: string; from?: string; to?: string }>;
  resolution?: string;
  shas?: string[];
}

/** A link request for attachToThread — exactly one of these is the thing being
 *  attached to a thread's history. */
export interface ThreadLink {
  requestId?: string;
  buildId?: string;
  captureId?: string;
}
