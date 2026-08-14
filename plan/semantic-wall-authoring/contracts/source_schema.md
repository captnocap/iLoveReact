# Architecture Source Schema Contract

## Canonical v1 document

`ArchitectureSource` is the only persisted structural-authoring root. Version 1 owns
walls; derived topology and output data never enter this document.

```ts
type ArchitectureSource = {
  version: 1;
  revision: number;
  walls: WallSource;
};

type WallSource = {
  vertices: WallVertex[];
  edges: WallEdge[];
  anchors: WallAnchor[];
};

type WallVertex = {
  id: string;
  floor: number;
  xU: number;
  zU: number;
};

type WallEdge = {
  id: string;
  startVertexId: string;
  endVertexId: string;
  support: { kind: 'absolute'; baseYU: number };
  heightU: number;
  thicknessU: number;
  profile: 'full' | 'half';
  styleId: string;
  sideA: WallSideFinish;
  sideB: WallSideFinish;
  openings: WallOpening[];
};

type WallOpening = {
  id: string;
  kind: 'door' | 'window' | 'doubleWindow' | 'brokenWindow'
      | 'garageDoor' | 'slidingDoor' | 'arch';
  kitId: string;
  columnU: number;
  rowU: number;
  facingSide: 'a' | 'b';
  hinge: 'start' | 'end' | 'none';
};

type WallSideFinish = {
  materialId: string;
};

type WallAnchor = {
  id: string;
  edgeId: string;
  side: 'a' | 'b';
  columnU: number;
  rowU: number;
  targetPieceId: string;
};
```

## Measured architecture-kit manifest

The model-package manifest declares structural assets explicitly:

```ts
type ArchitectureKitDeclaration = {
  as: 'architecture-kit';
  family: 'wall' | 'floor' | 'vertical-link' | 'roof';
  role: 'style' | 'opening' | 'trim' | 'cap' | 'rail' | 'door-leaf';
  catalogPath: readonly string[];
  semanticKind?: WallOpeningKind | VerticalLinkKind | RoofProfile;
  themeTags: readonly string[];
  gameplayTags: readonly string[];
  measurement: ArchitectureKitMeasurement;
};

type ArchitectureKitMeasurement = {
  sourceBoundsU: {
    minXU: number; minYU: number; minZU: number;
    maxXU: number; maxYU: number; maxZU: number;
  };
  mountBoundsU: { minU: number; minV: number; maxU: number; maxV: number };
  footprint: {
    minColumn: number;
    minRow: number;
    maxColumnExclusive: number;
    maxRowExclusive: number;
  };
  clearanceMask: readonly WallCell[];
  pivotU: ArchitecturePoint3;
};
```

Measured source and mount bounds may be fractional Studio `u` evidence. Structural
footprint coordinates, pivot coordinates, and clearance cells are whole `u` values.
The footprint is derived exactly by outward rounding:

```text
minColumn        = floor(mountBoundsU.minU)
minRow           = floor(mountBoundsU.minV)
maxColumnExclusive = ceil(mountBoundsU.maxU)
maxRowExclusive    = ceil(mountBoundsU.maxV)
```

An opening requires an opening semantic kind, mount bounds, footprint, and clearance
mask. A wall style supplies measured wall defaults and has no opening footprint.
Fields incompatible with the selected family/role are rejected, not ignored.

## Installed identity and hierarchy

```ts
type ArchitectureCatalogEntry = {
  catalogId: string;
  contentHash: string;
  packageId: string;
  label: string;
  family: ArchitectureFamily;
  role: ArchitectureKitRole;
  semanticKind?: string;
  categoryPath: readonly string[];
  themeTags: readonly string[];
  gameplayTags: readonly string[];
  measurement: ArchitectureKitMeasurement;
  assetRefs: ArchitectureAssetRefs;
};
```

`catalogId` is the stable source reference. `contentHash` is immutable install and
deduplication identity. `categoryPath` is mutable organization data. Family, role,
semantic kind, measurement, and tags are authoritative query facts; no consumer may
parse `catalogId` or folder text for behavior.

The initial hierarchy is exactly:

```text
Wall
  Styles
  Openings
    Doors
    Windows
    Arches
    Garage
  Trim
Floor
  Structure
  Surface
  Ceiling
  Edge
Vertical Links
  Stairs
  Ramps
  Elevators
  Rails
Roof
  Profiles
  Surface
  Fascia and Soffit
  Openings
```

Additional category folders remain data and never create semantic kinds. Paint skins
dress instances and do not multiply catalog entries.

## Catalog query and atomic install

```ts
type ArchitectureCatalogQuery = {
  family: ArchitectureFamily;
  role?: ArchitectureKitRole;
  semanticKind?: string;
  requiredThemeTags?: readonly string[];
  requiredGameplayTags?: readonly string[];
  maximumWidthU?: number;
  maximumHeightU?: number;
  wallProfile?: WallProfile;
  wallThicknessU?: number;
};
```

Query results are canonically ordered by stable catalog ID and content hash. Manual
and procedural placement consume the same result rows and the same native
`openingSlots(edgeId, catalogId)` response.

Export saves the resident model before measuring, validates declaration and measured
envelopes, compiles referenced products, content-addresses them, and only then
publishes one catalog entry. Failure at any stage publishes nothing. Re-export creates
a new content hash and atomically rebinds the stable catalog ID after validation;
architecture source retains that stable ID while frozen bundles record resolved
hashes.

Wall `heightU`, `thicknessU`, and profile defaults come from the selected measured
wall-style entry. Opening footprint and clearance come from the selected measured
opening-kit entry. `WallTuning`, UI code, migration helpers, and placement commands
contain no default door or window dimensions.

The directed edge from `startVertexId` to `endVertexId` is stable source meaning:
side A and side B never swap because arrays reorder, topology is regenerated, or the
world reloads. A deliberate reverse-edge command must remap both sides and every
surface-local child in one receipt.

## Unit and scalar law

- X, Y, and Z structural coordinates and dimensions are signed whole `u` integers.
- `16 u = 1 m` exactly.
- Floating meters and integer millimeters are invalid persisted structural values.
- Rendering, collision, navigation, and frozen products convert `u` to meters only at
  their output boundary.
- Every v1 wall has the explicit absolute support `{ kind: 'absolute', baseYU }`.
  Nearby floors or mesh bounds never choose or alter its base.

The complete coordinate, wall-surface occupancy, and attachment laws are governed by
[architecture_lattice.md](architecture_lattice.md).

## Identity law

User-authored source IDs are never position-derived. A mutation command allocates IDs
in deterministic command-local order:

```text
vertex  = ${commandId}:v:<n>
edge    = ${commandId}:e:<n>
opening = ${commandId}:o:<n>
```

Splits preserve predecessor/successor lineage in the mutation receipt rather than
rewriting unrelated IDs. Catalog references remain stable catalog IDs; compiled
products resolve those references to immutable content hashes.

## Persisted-versus-derived boundary

The following are compiler products and are forbidden in `ArchitectureSource`:

- DCEL `twin`, `next`, `prev`, angular order, face membership, holes, and exterior;
- room polygons and boundary traversal arrays;
- tessellated/mitered mesh vertices and render bands;
- collider, cover, nav, portal, audio, visibility, and pick-proxy rows;
- dirty-target sets and compile hashes.

They are rebuilt deterministically from validated source plus a validated installed
catalog snapshot.

## Family extension rule

Later versions extend this root with first-class `floorSlabs`, `verticalLinks`, and
`topRoofs` families. They reuse the same revision, command/receipt, host-wire,
catalog-resolution, compilation, persistence, prefab, and frozen-output boundaries.
They may not encode themselves as wall variants, opaque props, or a parallel building
document. Slab-linked wall support is added only with the slab family as the explicit
variant `{ kind: 'slab', slabId, join: 'on-top' | 'at-edge' }`.

The measured asset and catalog boundary is governed by
[build_catalog.md](build_catalog.md).
