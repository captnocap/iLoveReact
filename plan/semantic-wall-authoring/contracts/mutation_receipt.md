# Architecture Mutation Receipt Contract

## Transaction boundary

Every architecture edit is one `ArchitectureCommand` against exactly one source
revision. The native authority returns either one typed rejection or one complete
receipt. No partial patch may escape.

```ts
type ArchitectureCommandEnvelope = {
  commandId: string;
  expectedRevision: number;
  command: ArchitectureCommand;
};

type ArchitectureMutationResult =
  | { ok: true; receipt: ArchitectureMutationReceipt }
  | { ok: false; rejection: ArchitectureMutationRejection };

type ArchitectureMutationRejection = {
  commandId: string;
  code: MutationRejectionCode;
  expectedRevision: number;
  actualRevision: number;
  subjectIds: readonly string[];
  message: string;
};
```

When `expectedRevision !== source.revision`, the result is
`stale_source_revision`. The command performs no validation against an invented
snapshot, creates no IDs, and changes no source or derived cache.

## Receipt

```ts
type ArchitectureMutationReceipt = {
  commandId: string;
  sourceRevisionBefore: number;
  sourceRevisionAfter: number;
  sourceHashBefore: string;
  sourceHashAfter: string;

  created: ArchitectureRecordRef[];
  updated: ArchitectureRecordDelta[];
  removed: ArchitectureRecordSnapshot[];

  edgeChildRemaps: EdgeChildRemap[];
  openingRemaps: SurfaceChildRemap[];
  anchorRemaps: SurfaceChildRemap[];
  faceLineage: FaceLineage[];

  forwardPatch: ArchitecturePatch;
  inversePatch: ArchitecturePatch;
  affectedBounds: ArchitectureAffectedBounds[];
  dirtyTargets: ArchitectureDirtyTarget[];
};
```

`created`, `updated`, and `removed` are canonically ordered by record family then
stable ID. `forwardPatch` applied to the exact before revision produces the exact
after source. `inversePatch` applied to that after revision restores the byte-identical
before source and its revision.

## Record and patch shapes

```ts
type ArchitectureRecordFamily = 'vertex' | 'edge' | 'opening' | 'anchor';

type ArchitectureRecordRef = {
  family: ArchitectureRecordFamily;
  id: string;
};

type ArchitectureRecordSnapshot = {
  family: ArchitectureRecordFamily;
  id: string;
  canonicalBytes: Uint8Array;
};

type ArchitectureRecordDelta = {
  family: ArchitectureRecordFamily;
  id: string;
  beforeCanonicalBytes: Uint8Array;
  afterCanonicalBytes: Uint8Array;
};

type ArchitecturePatch = {
  expectedRevision: number;
  resultRevision: number;
  operations: readonly ArchitecturePatchOperation[];
};

type ArchitecturePatchOperation =
  | { kind: 'insert'; record: ArchitectureRecordSnapshot }
  | { kind: 'replace'; delta: ArchitectureRecordDelta }
  | { kind: 'remove'; record: ArchitectureRecordSnapshot };
```

Patch operations are canonical and dependency-safe: vertices before edges before
their openings/anchors for insertion; the reverse order for removal. Patch
application rejects a missing subject, duplicate subject, revision mismatch, or
before-bytes mismatch.

## Split and surface-child remaps

```ts
type EdgeChildRemap = {
  predecessorEdgeId: string;
  childEdgeIds: readonly string[];
  childStartColumnsU: readonly number[];
};

type SurfaceChildRemap = {
  childFamily: 'opening' | 'anchor';
  childId: string;
  predecessorEdgeId: string;
  successorEdgeId: string;
  oldColumnU: number;
  newColumnU: number;
  rowU: number;
};
```

Child edges are ordered from the predecessor's stable start toward its stable end.
`childStartColumnsU[i]` is the integer predecessor-local column at which child `i`
begins. Any split that intersects a child's occupied or clearance mask rejects the
entire command rather than guessing a successor.

## Derived-face lineage

```ts
type DerivedFaceBoundarySignature = string;

type FaceLineage = {
  predecessorSignatures: readonly DerivedFaceBoundarySignature[];
  successorSignatures: readonly DerivedFaceBoundarySignature[];
};
```

A face signature is a canonical hash of its floor and cycle of stable directed source
edge sides after cycle-rotation normalization. Lineage records exact predecessor and
successor signature sets for every affected component. Empty predecessor means a
newly enclosed face; empty successor means a dissolved face. Ambiguous splits and
merges remain explicit many-to-many rows.

## Bounds and dirty targets

```ts
type ArchitectureAffectedBounds = {
  floor: number;
  minXU: number;
  minYU: number;
  minZU: number;
  maxXUExclusive: number;
  maxYUExclusive: number;
  maxZUExclusive: number;
};

type ArchitectureDirtyTarget =
  | 'topology'
  | 'render'
  | 'collision'
  | 'cover'
  | 'materials'
  | 'doors-portals'
  | 'navigation'
  | 'rooms'
  | 'visibility'
  | 'audio'
  | 'pick-proxies';
```

Bounds use signed whole `u` coordinates and half-open maxima. Dirty targets are
semantic compiler targets, never UI component or renderer-buffer names. Consumers
replace only outputs whose target and affected floor/bounds intersect the receipt.

## Generated identity

The command allocates deterministic IDs in creation order within each family:

```text
${commandId}:v:<n>
${commandId}:e:<n>
${commandId}:o:<n>
```

`n` begins at zero per family. A command ID must be globally unique within the
document journal. Replaying the same command against the same revision either returns
the recorded receipt or a typed duplicate-command rejection; it never allocates a
second identity set.

## Required proofs

1. A stale revision returns no receipt and leaves canonical source bytes unchanged.
2. Every command's forward then inverse patch restores byte-identical source and the
   original revision.
3. Reordering input arrays cannot change generated IDs, remap ordering, face lineage,
   dirty-target ordering, or affected bounds.
4. Opening and anchor remaps preserve stable IDs and exact local integer rows/columns.
5. A split through occupied or clearance cells rejects atomically.
6. Every allocation reachable from a receipt has one documented owner and deinit path.
