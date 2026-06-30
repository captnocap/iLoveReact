# Compile Cache Architecture

Purpose: define the next compiler shape for hmsc-int's Compile button. The
current world is authored in the tool, baked to the platform game-file, and
loaded by the no-JS compiled route. This document formalizes the cache layer
that lets massive authored maps compile in time proportional to the work that
actually changed.

This sits on top of V28/V29/V30:

- V28: the game is data loaded by a stateless Zig engine.
- V29: the mapfile is content-addressed assets plus binary-RLE reference lumps.
- V30: the outdoor city is one citywide map; chunks are residency/cache units,
  not separate changelevel maps.

## Ruling

Every Compile writes a manifest. The manifest is the authority for reconstructing
the compiled world from content-addressed compiled chunks.

A compiled chunk is an independently valid game chunk artifact. It can be reused
with any manifest that references the exact same validation hash and dependency
set. "Glue the chunks together" means assemble the map through the manifest and
the platform lump directory; it does not mean blind byte concatenation.

If a chunk overview hash in the new manifest matches an existing cached chunk
artifact exactly, the compiler does not recompile it and the loader does not
deep-revalidate its internal data. The hash is the validation string. A mismatch
means the artifact is stale, corrupt, or belongs to different inputs; the chunk
is rebuilt or the previous valid artifact is retained. An accepted rebuild emits
a new chunk hash and bumps only that chunk's local version.

Compiled chunk history is first-class. The editor can restore a chunk by pointing
a new manifest entry at an older valid chunk hash/version instead of replaying a
long authoring edit chain. V20 append-only streams still exist as the audit/source
history, but chunk-level "I do not like where this area went" restores should use
compiled chunk history as the practical surface.

## Manifest Shape

A manifest is small, immutable, and content-addressed. It names the compiler ABI,
the source snapshot it came from, the chunks it assembled, and the global summary
lumps required to load the world.

Minimum fields:

```ts
type CompileManifest = {
  schema: 'hmsc.compile_manifest.v1';
  manifestHash: string;
  parentManifestHash?: string;
  mapId: string;
  mapKind: 'city' | 'interior';
  createdAt: string;
  compilerAbiHash: string;
  sourceSnapshotHash: string;
  assetManifestHash: string;
  globalConfigHash: string;
  chunkOverviewRootHash: string;
  chunks: ChunkOverview[];
  globalSummaries: GlobalSummaryRef[];
};
```

The manifest hash is a Merkle root over:

- compiler ABI hash;
- global config/tuning hash;
- asset manifest hash;
- ordered chunk overview hashes;
- global summary hashes.

The manifest is append-only. A successful Compile writes a new manifest and then
atomically swaps the "current manifest" pointer. A failed chunk rebuild never
damages the last valid manifest.

## Chunk Overview Shape

Each manifest row is the cheap validation handle for one compiled chunk.

```ts
type ChunkOverview = {
  coord: { cx: number; cz: number };
  localVersion: number;
  chunkHash: string;
  previousChunkHash?: string;
  sourceSignatureHash: string;
  dependencyHash: string;
  artifactHash: string;
  summaryHash: string;
  byteLength: number;
  boundsMeters: { minX: number; minZ: number; maxX: number; maxZ: number };
  edgeSignatures: {
    north: string;
    east: string;
    south: string;
    west: string;
  };
  historyRef: string;
};
```

`chunkHash` is the content-addressed validation string for the whole compiled
chunk. It is derived from the compiler ABI, local source signature, dependency
signature, output artifact bytes, and summary bytes. `localVersion` is only a
human/history ordering value; the hash is the authority.

Version semantics:

- If the chunk output is byte-identical, keep the same hash and local version.
- If the source or dependencies change but the output still matches, keep the
  same hash and local version.
- If an accepted artifact changes, increment only that chunk's local version.
- If the compiler ABI changes, chunks may rebuild under a new hash without
  implying an authored map change.

## Chunk Artifact

A chunk artifact is the compiled data for one spatial cache unit. It should be
loadable and inspectable without the rest of the city, while still being assembled
into one citywide map by the manifest.

Expected artifact families:

- terrain/heightfield rows;
- tile/reference-grid residuals and pattern stamps;
- static render placements;
- build-piece output: collision, cover, sound occlusion, room and portal data;
- prop/model placement refs;
- nav cells or nav portals owned by this chunk;
- VIS/audio/occlusion local contribution;
- interactables and dynamic-prop recipes;
- summary records for global systems.

The chunk owns its local bytes. Shared assets remain content-addressed assets in
the asset store and are referenced by hash/id.

## Dirty Rules

The cache is only useful if dirtying is exact and explicit. Every editor mutation
must produce a dirty region and a concern.

Base rules:

- Painting a tile/height/zone dirties the touched chunk.
- A border edit dirties the touched chunk plus neighbors whose edge signatures
  may change.
- A placed object dirties every chunk its bounds intersect.
- A road/building/prefab edit dirties every chunk touched by its footprint and
  any subsystem halo it affects.
- A material/model/asset change dirties chunks that reference that asset, unless
  the asset hash is unchanged.
- A global tuning/compiler ABI change dirties every chunk whose compiled output
  reads that value.

Subsystem halos must be declared in data, not hidden in code:

- nav/pathing halo for portals, ramps, lanes, crosswalks, and link costs;
- VIS halo for blockers and potential visibility cells;
- audio halo for occluders and propagation portals;
- physics halo for colliders touching chunk edges;
- water/void/seam halo where terrain continuity matters;
- traffic halo for junctions and controlled stop lines.

An edit that cannot state its dirty region is an incomplete editor mutation.

## Global Summaries

Global world data should be derived from chunk summaries, not by rescanning the
entire map on every Compile.

Examples:

- asset dependency manifest;
- VIS/PVS table root;
- road and traffic portal graph;
- nav supergraph over chunk exits;
- room/interior portal index;
- streaming/residency table;
- world bounds and all-default sparse-chunk index;
- diagnostics: changed chunks, reused chunks, rebuilt chunks, bytes reused.

The compiler flow is:

1. Read the authoring snapshot and prior manifest.
2. Compute dirty chunks from edit regions, source signatures, dependencies, and
   compiler ABI.
3. Reuse exact-match chunk artifacts.
4. Rebuild only dirty or missing chunks.
5. Recompute global summaries from chunk summaries.
6. Write a new manifest and atomically publish it.

## Restore Flow

Chunk restore should be cheap and explicit:

1. User selects chunk `(cx, cz)` and an older `localVersion`.
2. The editor creates a new manifest candidate with that chunk overview pointed
   at the old chunk hash.
3. Neighbor/global summaries are checked through edge signatures. If the restored
   chunk changes an edge, the affected neighbors/global summaries become dirty.
4. Compile emits a new manifest. The restored chunk's historical artifact is
   reused; only necessary neighbors/summaries rebuild.

This is not a rewind of the V20 event log. It is a new accepted compiled state
that references an older compiled chunk artifact.

## Storage Layout

The exact backing store can be filesystem or SQLite, but the logical layout is:

```text
compile-cache/
  manifests/
    <manifestHash>.json
  chunks/
    <chunkHash>.hgc
  summaries/
    <summaryHash>.bin
  assets/
    <assetHash>...
  history/
    <mapId>/
      <cx>_<cz>.jsonl
  current/
    <mapId>.manifest
```

Chunk history rows:

```ts
type ChunkHistoryRow = {
  coord: { cx: number; cz: number };
  localVersion: number;
  chunkHash: string;
  parentChunkHash?: string;
  manifestHash: string;
  sourceSignatureHash: string;
  dependencyHash: string;
  reason: 'compile' | 'restore' | 'compiler_abi' | 'repair';
  label?: string;
  createdAt: string;
};
```

Garbage collection must treat manifests and protected chunk history as roots.
Old chunks are only deleted after no retained manifest/history row references
them.

## Validation

Fast path:

- Manifest hash validates the manifest.
- Chunk overview hash validates the row.
- Chunk hash validates the artifact and its summaries.
- Exact match means reuse without deep validation.

Slow path:

- Missing artifact: rebuild the chunk if source exists, otherwise fall back to
  the latest valid manifest that still references an available artifact.
- Hash mismatch: quarantine the artifact, rebuild, and emit a new chunk hash.
- Unknown future manifest fields: skip them if the schema allows it, matching the
  V29 unknown-lump rule.

The loader should require no JavaScript. It reads the manifest, maps chunk
artifacts and global summaries, validates hashes, and constructs the game through
the Zig loader.

## Hazards

- Global dictionaries can accidentally dirty the whole map. Prefer stable
  content-addressed ids or per-chunk dictionaries with a manifest-level string
  table.
- VIS can become the new full-map choke. It must be hierarchical and summary-led:
  chunk-local blockers plus portal/edge summaries, then global roots.
- Cross-chunk objects must not duplicate authority. Either emit chunk-local
  compiled pieces from one source id, or store a shared asset with per-chunk
  placement refs.
- Version numbers are not validation. Hashes validate; versions order history.
- Compiled chunk history is not perfect source recovery unless the source snapshot
  for that chunk is retained too.
- Cache ABI is mandatory. A fast stale reuse caused by a compiler format change
  is worse than a slow rebuild.

## Acceptance Tests

The refactor is not done until these are true:

- Touching one interior tile rebuilds only that chunk and expected subsystem
  halos.
- Touching a chunk edge rebuilds that chunk plus the neighbor whose edge
  signature changed.
- Re-running Compile with no edits writes a manifest that reuses every chunk.
- Corrupting one cached chunk causes one quarantine/rebuild, not a full-map
  rebuild.
- Restoring an older chunk version creates a new manifest and reuses the old
  chunk artifact.
- A global compiler ABI change produces new hashes without pretending every
  authored chunk got a local edit.
- The no-JS loader reconstructs the same world from manifest + chunks + assets.
- Compile telemetry reports changed chunks, reused chunks, rebuilt chunks, cache
  hit rate, and bytes reused.
