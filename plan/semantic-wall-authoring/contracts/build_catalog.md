# Measured Architecture-Kit Catalog Contract

## Purpose

Studio export installs reusable art into the semantic building grammar without
turning the art into a fixed structural wall. A mutable wall remains a wall edge; a
door/window asset becomes an opening kit that the wall mutation can consume; a wall
surface asset becomes a wall style. Exported kits are organized hierarchically and
queryable by procedural systems.

This extends the active manifest pattern used by semantic prop roles:

- the model package manifest is disk truth;
- export writes an explicit declaration rather than relying on a filename;
- boot/catalog install derives searchable entries from manifests;
- the resulting asset is content-addressed;
- the palette and procedural builder query the same catalog projection.

## Manifest declaration

The target adds a distinct `architecture-kit` declaration instead of overloading
`prop` (which means free placement) or the legacy `build-piece` static-wall path:

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
  sourceBoundsU: { minXU: number; minYU: number; minZU: number;
                   maxXU: number; maxYU: number; maxZU: number };
  mountBoundsU: { minU: number; minV: number; maxU: number; maxV: number };
  footprint: { minColumn: number; minRow: number;
               maxColumnExclusive: number; maxRowExclusive: number };
  clearanceMask: readonly WallCell[];
  pivotU: ArchitecturePoint3;
};
```

Fields that do not apply to a role are rejected rather than ignored. An opening kit
requires an opening `semanticKind`, mount bounds, footprint, and clearance mask. A wall
style has no opening footprint. Family/role compatibility is a native table.

## Measurement law

No kit dimension is invented in a tuning table or inferred later from a placed mesh.
Export first saves the current resident model, then measures its authored semantic
mount envelope in Studio units. The mount envelope is initialized from measured model
or named-part bounds and remains an explicit visible export field so the author can
separate the structural opening from casing, handles, swing geometry, or decorative
overhang.

The grid footprint is the smallest conservative set of `1 u` cells containing that
envelope:

```text
minColumn = floor(mountMinU)
maxColumnExclusive = ceil(mountMaxU)
minRow = floor(mountMinV)
maxRowExclusive = ceil(mountMaxV)
```

`sourceBoundsU` and `mountBoundsU` are measurement evidence and may contain finite
fractional `u` values from Studio geometry. They never become structural coordinates.
Only the derived footprint, pivot, clearance mask, and authored building source use
integer `u` coordinates. Walls and slabs therefore remain exactly lattice-scaled even
when decorative geometry does not land precisely on a subdivision boundary.

This is directed outward rounding, not nearest rounding. It guarantees the real kit
fits. Export rejects non-finite/empty bounds, an envelope outside the saved model's
declared attachment allowance, a pivot outside its permitted region, or an authored
clearance cell outside format limits. The resulting integer footprint is shown before
confirmation in both `u` and meters.

The generated wall void uses the integer footprint. Frame/casing geometry is placed
from the authored pivot and covers any remainder between the real model and cell
boundary. Swing/routing clearance is a separate authored mask; it does not enlarge the
cutout by accident.

Legacy static wall variants migrate through an explicit compatibility table capturing
their existing dimensions. They do not seed default dimensions for newly exported
kits.

## Identity and organization

Each installed entry has four distinct identities:

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

- `contentHash` is immutable install/dedup identity.
- `catalogId` is the stable reference stored by architecture source.
- `categoryPath` is organization/search data and may be reorganized without changing
  gameplay meaning.
- `family`, `role`, `semanticKind`, measurement, and tags are typed query facts.

A readable ID may mirror the hierarchy, for example
`build:wall:opening:door:<slug>`, and the palette may display
`Wall / Openings / Doors / <label>`. No behavior may parse colon segments from the ID;
the explicit fields above remain authoritative. In particular, the `prop:` prefix
continues to mean a free-placeable prop and is not reused for structural wall kits.

The initial category tree is:

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

Additional folders are catalog data, not new semantic kinds. Paint skins continue to
dress placed instances and do not multiply palette rows.

## Export and install flow

```text
saved Studio model + semantic parts/slots + visible mount envelope
  → measure source and mount bounds in Studio u
  → derive outward-rounded integer cell footprint
  → validate family/role/semantic kind/pivot/clearance/material slots
  → write architecture-kit declaration to model manifest
  → compile mesh/material/animation products
  → content-address and install products
  → publish one ArchitectureCatalogEntry
      ├─ hierarchical Build palette/search
      ├─ wall/slab/link/roof authoring tools
      └─ procedural catalog query
```

Export failure writes no partial catalog entry. Re-export of changed geometry creates a
new content hash and atomically updates the stable catalog reference after validation.
Source records keep the stable catalog ID; frozen artifacts record resolved hashes.

## Procedural query contract

The native catalog exposes structured queries rather than folder-name scans:

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

Results are canonically ordered by stable catalog ID and content hash. A procedural
building generator:

1. queries eligible kits from semantic/theme/measurement requirements;
2. selects deterministically from those rows using its seed/grammar;
3. calls `openingSlots(edgeId, catalogId)` for exact valid anchors;
4. submits the ordinary `insertOpening` command;
5. receives the ordinary receipt or typed stale-source rejection.

It has no privileged placement path and never scans asset folders, parses catalog IDs,
or trial-places meshes.

## Required proofs

1. Exporting the same saved kit twice yields the same measurement fields and content
   hash.
2. Every emitted footprint equals outward rounding of its recorded mount bounds.
3. A kit whose real mount envelope exceeds its cell footprint is rejected.
4. Renaming or moving a category path does not change family/role behavior or existing
   source references.
5. An ID whose text resembles a door but whose typed role is not an opening never
   enters door queries.
6. Palette search and procedural catalog query project the same installed entry set.
7. Procedural and interactive placement consume identical `openingSlots` results.
8. Paint skins do not create additional architecture catalog entries.
