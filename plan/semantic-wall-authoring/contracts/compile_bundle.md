# Architecture Compile Bundle Contract

## Bundle envelope

`ArchitectureCompileBundle` is a deterministic, renderer-neutral compiler product.
It is generated from one validated architecture source revision plus one immutable
catalog snapshot. It is not persisted back into authored source.

```ts
type ArchitectureCompileBundle = {
  magic: 'RJAB';
  version: 1;
  sourceRevision: number;
  sourceHash: string;
  compilerVersion: string;
  tuningHash: string;
  catalogHash: string;
  bundleHash: string;
  sections: readonly ArchitectureCompileSectionDirectoryEntry[];
  wall: WallCompileSection;
};

type ArchitectureCompileSectionDirectoryEntry = {
  family: 'wall' | 'floor' | 'vertical-link' | 'roof';
  version: number;
  offset: number;
  byteLength: number;
  itemCount: number;
  sectionHash: string;
};
```

Directory entries are ordered by the fixed family order shown above. Unknown future
families are skippable by byte length. Every section hash covers its canonical encoded
bytes; `bundleHash` covers the header, directory, and section bytes.

## Wall section

```ts
type WallCompileSection = {
  version: 1;
  renderBands: readonly WallRenderBand[];
  colliderBands: readonly WallColliderBand[];
  materialBindings: readonly WallMaterialBinding[];
  doors: readonly WallDoorRow[];
  portals: readonly WallPortalRow[];
  gameplayBands: readonly WallGameplayBand[];
  roomFaces: readonly WallRoomFace[];
  pickProxies: readonly WallPickProxy[];
  diagnostics: readonly ArchitectureDiagnostic[];
  targetHashes: readonly ArchitectureTargetHash[];
};
```

Wall arrays use these canonical orders:

1. floor ascending;
2. stable source edge ID ascending by UTF-8 bytes;
3. edge side A before side B;
4. local start column, then row, then end column, then top row;
5. generated material role order `face`, `reveal`, `jamb`, `sill`, `header`, `cap`,
   `end`;
6. stable opening or derived-row ID as the final tie-breaker.

## Render, collision, and materials

```ts
type WallBandExtent = {
  floor: number;
  edgeId: string;
  side: 'a' | 'b' | 'volume';
  startColumnU: number;
  endColumnU: number;
  bottomRowU: number;
  topRowU: number;
};

type WallRenderBand = WallBandExtent & {
  id: string;
  role: 'face' | 'reveal' | 'jamb' | 'sill' | 'header' | 'cap' | 'end';
  materialBindingId: string;
  transformMeters: readonly number[];
  uvMeters: readonly number[];
};

type WallColliderBand = WallBandExtent & {
  id: string;
  blocksMovement: boolean;
  coverClass: 'none' | 'half' | 'full';
};

type WallMaterialBinding = {
  id: string;
  edgeId: string;
  side: 'a' | 'b' | 'generated';
  role: 'face' | 'reveal' | 'jamb' | 'sill' | 'header' | 'cap' | 'end';
  catalogId: string;
  contentHash: string;
  materialId: string;
};
```

All structural extents remain integer `u`; meter arrays are output-only transforms and
UV projections. Every visible solid interval has matching collision/cover semantics
from the same interval partition. No opening void receives a solid collider.

## Doors, portals, and gameplay flags

```ts
type WallDoorRow = {
  id: string;
  openingId: string;
  edgeId: string;
  kitCatalogId: string;
  kitContentHash: string;
  facingSide: 'a' | 'b';
  hinge: 'start' | 'end' | 'none';
  attachmentTransformMeters: readonly number[];
};

type WallPortalRow = {
  id: string;
  openingId: string;
  edgeId: string;
  roomA: string;
  roomB: string;
  portalClass: string;
  traversable: boolean;
};

type WallGameplayBand = WallBandExtent & {
  id: string;
  navBlocks: boolean;
  blocksSound: boolean;
  blocksVisibility: boolean;
  blocksProjectiles: boolean;
  coverClass: 'none' | 'half' | 'full';
};
```

Door, portal, navigation, sound, visibility, projectile, and cover facts lower from
the same measured-kit interval partition as render and collision. A catalog row cannot
override source identity; it only supplies validated kit behavior and assets.

## Rooms and picking

```ts
type WallRoomFace = {
  signature: string;
  floor: number;
  kind: 'interior' | 'exterior' | 'hole';
  signedArea2U: string;
  boundaryHalfEdgeIds: readonly string[];
  parentSignature?: string;
};

type WallPickProxy = {
  id: string;
  kind: 'wall-face' | 'opening' | 'jamb';
  edgeId: string;
  openingId?: string;
  side: 'a' | 'b';
  extent: WallBandExtent;
};
```

`signedArea2U` is encoded as a decimal string because widened native integer area may
exceed JavaScript's exact integer range. Face signatures are canonical cycle hashes,
not persisted source IDs. Pick results resolve back to stable edge/opening IDs and
integer local wall-surface coordinates.

## Diagnostics and target hashes

```ts
type ArchitectureDiagnostic = {
  code: string;
  severity: 'warning' | 'error';
  family: 'wall' | 'floor' | 'vertical-link' | 'roof';
  subjectIds: readonly string[];
  floor?: number;
  message: string;
};

type ArchitectureTargetHash = {
  target: 'topology' | 'render' | 'collision' | 'cover' | 'materials'
    | 'doors-portals' | 'navigation' | 'rooms' | 'visibility' | 'audio'
    | 'pick-proxies';
  floor: number;
  contentHash: string;
};
```

Diagnostics and target hashes use the same canonical target/floor ordering as the
section arrays. A mutation may request affected-bounds filtering, but compiling the
same full source/catalog/compiler/tuning tuple must always produce byte-identical full
bundle bytes and hashes.

## Required proofs

1. Source-array permutation does not change bundle bytes.
2. A material-only edit changes only material/render target hashes.
3. An opening edit changes exactly the geometry/gameplay/pick targets intersecting its
   floor and affected bounds.
4. Render solids and collider/cover solids have identical integer extents.
5. Traversable opening intervals contain no nav blocker or collider band.
6. Every catalog reference resolves to a stable ID and immutable content hash before
   the bundle is accepted.
7. Shipped runtime readers consume frozen sections without importing mutation or
   topology modules.
