// game/build — the world build/placement system, ported VERBATIM from the
// TypeScript at cart/hmsc-int/game/build/ (placed.ts + catalog/pieces/edits/
// prefabs/skins) into host-owned Zig (USER ASK req_2349).
//
// Why: the iso world editor (cart/hmsc-int/LoaderIsoView.tsx) is a thin consumer
// whose placement brain — raycast / placementFor / validatePlacement / piece
// connectivity / wall-lifting — was ALL TypeScript (~5,685 lines across
// game/build, zero callHost). Placing a floor in the old editor ran TS, not the
// framework. Per the doctrine (DESIGN_INTAKE "React Is UI Authoring; Tools Are
// Host-Owned"), that capability belongs in Zig. Once it lives here, the editor
// pane becomes a thin caller into __game_build_* and the cross-cart TS import of
// the whole game (req_2178) dissolves at its root.
//
// PORT DISCIPLINE: verbatim behaviour. Field names, tuning values, and control
// flow mirror the TS 1:1 so editor and compiled game never drift. Port order is
// bottom-up: PLACED_TUNING (this stone) → catalog/piece types → leaf geometry
// (bounds, roofRise, liftedWallBaseY) → raycast/placementFor/validatePlacement.

const std = @import("std");

// ── P2 tuning: every behavior-affecting number is table data ─────────────────
// (the WORLD_TUNING convention — named rows, never literals in logic)
// Verbatim from cart/hmsc-int/game/build/placed.ts PLACED_TUNING.
pub const PLACED_TUNING = struct {
    /// a walk portal's traversable opening (door/arch cutouts), meters
    pub const walkOpeningWidthMeters: f32 = 1.2;
    /// a vehicle portal's opening (garage door), meters
    pub const vehicleOpeningWidthMeters: f32 = 2.6;
    /// closed door panels fill only the portal opening, not the wall jambs
    pub const walkDoorPanelHeightMeters: f32 = 2.2;
    pub const garageDoorPanelHeightMeters: f32 = 2.8;
    /// where a halfHeight wall's collision band tops out (low cover), meters
    pub const halfHeightTopMeters: f32 = 1.1;
    /// surface feel of built pieces (one material-agnostic profile until the
    /// materials lane gives per-material feel)
    pub const pieceFriction: f32 = 0.85;
    pub const pieceRestitution: f32 = 0.02;
    /// ramp/stairs walkable-slope gate (cos): 3m rise over 3m run is 45°;
    /// 0.6 keeps the standard ramp walkable with margin
    pub const rampWalkableSlopeCos: f32 = 0.6;
    /// RAMPREAL-0606: ramps are inclined floor slabs, not solid wedges. The
    /// slab thickness matches the catalog plate thickness; tune live if the
    /// catalog's common floor module changes.
    pub const rampSlabThicknessMeters: f32 = 0.2;
    /// Thin plan footprint of a ramp slab edge. This is only the physical edge
    /// lip of the tilted floor, not a full side/back wall mass.
    pub const rampSlabEdgePlanThicknessMeters: f32 = 0.12;
    /// Segment count for sloped side-edge bands; high enough that adjacent bands
    /// overlap vertically for the standard 45° / 3m ramp.
    pub const rampSlabEdgeSegments: i32 = 16;
    /// Uniform host heightfield cell size for ramp/stair slopes. This keeps
    /// non-square links like stairs on their real footprint instead of widening
    /// them to the 3m ramp module.
    pub const verticalLinkHeightfieldCellMeters: f32 = 0.6;
    /// RAMPSIDE-0606 legacy for stairs only: side/back boundary thickness for
    /// stair wall faces. Ramps no longer use this.
    pub const stairBoundaryWallThicknessMeters: f32 = 0.25;
    /// Stairs lower to this many visible step boxes in every renderer. This is
    /// presentation, but it must live with placed-build semantics so editor and
    /// compiled game never drift into different stair models.
    pub const stairVisualSteps: i32 = 10;
    /// ── ELEVATOR (REQ-0647): the moving vertical link ─────────────────────
    /// One catalog module per storey; stacked modules form a SHAFT whose car
    /// serves one stop per storey (game/build/elevators.ts derives both). The
    /// shaft is an open-front frame: back + side walls collide, the front face
    /// stays open so a body walks onto the car.
    pub const elevatorShaftWallThicknessMeters: f32 = 0.12;
    pub const elevatorPostSizeMeters: f32 = 0.18;
    /// the visual beam over the open front (reads as the shaft doorway)
    pub const elevatorHeaderHeightMeters: f32 = 0.35;
    /// the car: a platform slab; its TOP surface = stop level + this thickness
    /// (matches the 0.2m floor-plate top at each storey within a step)
    pub const elevatorCarFloorThicknessMeters: f32 = 0.22;
    /// the car sits this far inside the shaft's inner walls on every side
    pub const elevatorCarInsetMeters: f32 = 0.06;
    pub const elevatorCarSpeedMetersPerSecond: f32 = 2.2;
    /// stacked storeys whose seams sit within this are ONE shaft
    pub const elevatorStackToleranceMeters: f32 = 0.05;
    /// |carY - stop| under this = the car has arrived
    pub const elevatorArriveToleranceMeters: f32 = 0.02;
    /// how far above/below a stop a body can stand and still board/call
    pub const elevatorBoardVerticalReachMeters: f32 = 1.2;
    /// horizontal reach for calling the car from a landing
    pub const elevatorCallReachMeters: f32 = 2.8;
    /// RAMPFOOT-0605: degenerate-band floor when trimming wall overhangs out of
    /// ramp footprints — a trimmed band thinner than this is dropped, meters
    pub const rampTrimMinBandMeters: f32 = 0.01;
    /// SMARTSEL-0605: two pieces TOUCH when their envelopes come within this
    /// (abutting faces count; module-snapped neighbors sit exactly flush)
    pub const touchToleranceMeters: f32 = 0.05;
    /// REQ-0109: numeric recognition tolerance for exact lattice wall joins.
    pub const wallJoinToleranceMeters: f32 = 1e-6;
};

// ── the type layer ───────────────────────────────────────────────────────────
// Verbatim from game/build/{pieces,catalog,edits,skins}.ts + kinds/tiles.ts.

/// The Fortnite-semantics structural primitives (game/build/pieces.ts).
pub const BuildPieceKind = enum { wall, floor, ramp, stairs, elevator, roof, pillar, corner, arch, fence, railing, trim, sign, prop };

/// How a piece snaps when placed (pieces.ts BuildSnapMode).
/// 'grid' = 1m substrate cells; 'edge' = cell edges; 'surface' = onto a face; 'free' = unsnapped.
pub const BuildSnapMode = enum { grid, edge, surface, free };

/// The roof PROFILE (catalog.ts RoofShape) — roof-kind rows only.
pub const RoofShape = enum { flat, shed, gable, hip, pyramid };

/// kinds/tiles.ts TileCoverHeight — reused so cover carries into the chance engine.
pub const TileCoverHeight = enum { none, low, high, full };

/// The wall-cutout vocabulary (edits.ts WallEdit).
pub const WallEdit = enum { solid, door, window, doubleWindow, brokenWindow, garageDoor, slidingDoor, arch, halfHeight };

/// What an opening admits through the nav graph (edits.ts EditPortalKind).
pub const EditPortalKind = enum { none, walk, vehicle };

/// The three skinnable faces (skins.ts BuildFaceSlot). Slot ids stay fixed so
/// skins survive a piece-kind swap; labels (front/back vs top/bottom) are per-kind.
pub const BuildFaceSlot = enum { front, back, sides };
pub const BUILD_FACE_SLOTS = [_]BuildFaceSlot{ .front, .back, .sides };

/// catalog.ts BuildTheme.
pub const BuildTheme = enum { common, downtown, motel, trap_lot, suburb, industrial };

/// catalog.ts BuildMaterial.
pub const BuildMaterial = enum { concrete, brick, stucco, wood, metal, glass, chainlink };

/// catalog.ts BuildPieceSize — the piece's plan/height extent in meters.
pub const BuildPieceSize = struct {
    widthMeters: f32,
    heightMeters: f32,
    depthMeters: f32,
};

/// The gameplay tags a catalog entry carries (pieces.ts BuildGameplayTags, V24 ruling #2).
pub const BuildGameplayTags = struct {
    collision: bool,
    blocksSight: bool,
    blocksSound: bool,
    cover: TileCoverHeight,
    /// Hit points of the destructible section; null = indestructible.
    durability: ?i32,
    climbable: bool,
    vaultable: bool,
    /// The piece (or its edit) connects rooms — bakes to a nav portal + room seam.
    portal: bool,
};

/// What a placed piece of a kind PROMISES the bake (pieces.ts BakePromise). Declaration only.
pub const BakePromise = struct {
    renderGeometry: bool,
    collisionBoxes: bool,
    coverFaces: bool,
    soundOcclusion: bool,
    roomBoundary: bool,
    navPortal: bool,
    navBlocker: bool,
    verticalLink: bool,
    destructibleSections: bool,
};

/// Roof pitch presets, rise:run (catalog.ts ROOF_PITCH). 0.5 ≈ 27°, 1.0 = 45°.
pub const ROOF_PITCH = struct {
    pub const semiSlant: f32 = 0.5;
    pub const fullSlant: f32 = 1.0;
};

/// A catalog piece definition (catalog.ts BuildPieceDef). The row's meaning +
/// variety axes; `defaultEdit`/`propKind`/`roofShape`/`roofPitch` are family-gated.
pub const BuildPieceDef = struct {
    id: []const u8,
    kind: BuildPieceKind,
    label: []const u8,
    theme: BuildTheme,
    material: BuildMaterial,
    size: BuildPieceSize,
    snap: BuildSnapMode,
    tags: BuildGameplayTags,
    /// Wall-family rows only: a row that IS a cutout names its WallEdit here.
    defaultEdit: ?WallEdit = null,
    /// kind 'prop' only — the prop registry id (PropKind). Ported with the kinds module.
    propKind: ?[]const u8 = null,
    /// Roof-family rows only. Absent or .flat = the legacy slab.
    roofShape: ?RoofShape = null,
    /// Roof-family rows only — pitch as a rise:run ratio. Default ROOF_PITCH.semiSlant.
    roofPitch: ?f32 = null,
};

/// A pitched roof's dragged footprint override (placed.ts PlacedBuildPiece.roofSpan).
pub const RoofSpan = struct { widthMeters: f32, depthMeters: f32 };

/// The placed record the world stream stores (placed.ts PlacedBuildPiece).
/// Geometry-carried fields are typed here; skin/partTextures/text/prefab/cells are
/// carried data (not placement math) and port fully with the skins/prefab modules.
pub const PlacedBuildPiece = struct {
    /// `bp_<n>` — minted by the world stream's materializer (replay-deterministic)
    id: []const u8,
    /// BUILD_CATALOG id
    pieceId: []const u8,
    /// world meters (R4): x/z is the piece CENTER on the ground plane
    x: f32,
    /// world meters: the piece BASE (bottom face) — stacking sets this to the face top
    y: f32,
    z: f32,
    /// rotation about +Y in degrees (snap authors in 90° steps; data stays general)
    yawDegrees: f32,
    /// the meaningful cutout on THIS placement (wall-family kinds only)
    edit: ?WallEdit = null,
    /// Runtime state for interactive door edits. null = the edit's default (closed).
    doorOpen: ?bool = null,
    /// ROOFSPAN (req_0917): a dragged roof footprint override (roof-kind only).
    roofSpan: ?RoofSpan = null,
    // Carried, non-geometry channels (port with their modules):
    //   skin: BuildSkinSet, partTextures: map, text: []const u8, stampId/prefabId,
    //   prefabPieceIndex, cells: []?TileKind (floor 3×3 micro-grid).
};

// ── edit / contract / tag composition ────────────────────────────────────────
// Verbatim from game/build/{edits,pieces}.ts. The door-interaction internals
// (reach/openSeconds/auto-radius/panel style/count) are runtime door behaviour,
// not placement math — they port with the door module. Only the tag-delta
// overrides and the per-kind edits/snap contract that placement + effectiveTags
// read live here.

/// Only the wall kind accepts the WallEdit vocabulary
/// (pieces.ts BUILD_KIND_CONTRACTS[kind].edits === 'wall'; every other kind 'none').
pub fn kindAcceptsWallEdits(kind: BuildPieceKind) bool {
    return kind == .wall;
}

/// Per-kind default snap mode (pieces.ts BUILD_KIND_CONTRACTS[kind].snapDefault).
pub fn kindSnapDefault(kind: BuildPieceKind) BuildSnapMode {
    return switch (kind) {
        .wall => .edge,
        .floor, .ramp, .stairs, .elevator, .roof, .pillar => .grid,
        .corner, .arch, .fence, .railing => .edge,
        .trim, .sign => .surface,
        .prop => .free,
    };
}

/// The edit's tag deltas layered over base tags — verbatim the
/// WALL_EDIT_DEFINITIONS[edit].overrides applied over base (edits.ts applyWallEdit).
/// Pure; the one place edit semantics apply so authored and baked meaning agree.
pub fn applyWallEdit(base: BuildGameplayTags, edit: WallEdit) BuildGameplayTags {
    var t = base;
    switch (edit) {
        .solid => {}, // the identity edit — {}
        .door => t.portal = true,
        .window => t.blocksSight = false,
        .doubleWindow => t.blocksSight = false,
        .brokenWindow => {
            t.blocksSight = false;
            t.vaultable = true;
        },
        .garageDoor => t.portal = true,
        .slidingDoor => {
            t.portal = true;
            t.blocksSight = false; // glass leaves see through even closed
        },
        .arch => t.portal = true,
        .halfHeight => {
            t.blocksSight = false;
            t.cover = .low;
            t.vaultable = true;
        },
    }
    return t;
}

/// A placed piece's EFFECTIVE tags: the catalog row's tags with the edit's deltas
/// applied (catalog.ts effectiveTags). null edit ⇒ the row's tags unchanged. The
/// TS throws if a non-wall kind carries an edit; placement only stamps edits onto
/// wall pieces, so that invariant is an assert here.
pub fn effectiveTags(entry: BuildPieceDef, edit: ?WallEdit) BuildGameplayTags {
    const e = edit orelse return entry.tags;
    std.debug.assert(kindAcceptsWallEdits(entry.kind));
    return applyWallEdit(entry.tags, e);
}

/// Can this kind take the WallEdit vocabulary? (placed.ts placedPieceAcceptsEdits)
pub fn placedPieceAcceptsEdits(kind: BuildPieceKind) bool {
    return kindAcceptsWallEdits(kind);
}

// ── the catalog ──────────────────────────────────────────────────────────────
// Verbatim from game/build/catalog.ts BUILD_CATALOG — the 36 static structural
// rows. Shared size/tag consts mirror the TS; per-row overrides (the `{...BASE,
// field: x}` spreads) become block expressions that copy the base and set the
// same fields. The runtime PROP_CATALOG / COOKED_CATALOG entries derive from the
// prop/cooked pipelines (propKindDefinition + propModelFootprintMeters) — that
// coded-model derivation is out of scope; catalogEntry falls through to a runtime
// registry the cooked module registers.

const WALL_SIZE = BuildPieceSize{ .widthMeters = 3, .heightMeters = 3, .depthMeters = 0.005 };
const PLATE_SIZE = BuildPieceSize{ .widthMeters = 3, .heightMeters = 0.2, .depthMeters = 3 };
const FLOOR_SIZE = BuildPieceSize{ .widthMeters = 3, .heightMeters = 0.05, .depthMeters = 3 };
const VERTICAL_LINK_SIZE = BuildPieceSize{ .widthMeters = 3, .heightMeters = 3, .depthMeters = 3 };

const SOLID_WALL_TAGS = BuildGameplayTags{ .collision = true, .blocksSight = true, .blocksSound = true, .cover = .full, .durability = null, .climbable = false, .vaultable = false, .portal = false };
const SOLID_PLATE_TAGS = BuildGameplayTags{ .collision = true, .blocksSight = false, .blocksSound = true, .cover = .none, .durability = null, .climbable = false, .vaultable = false, .portal = false };

pub const BUILD_CATALOG = [_]BuildPieceDef{
    // ── walls (the edit-bearing family) ────────────────────────────────────────
    .{ .id = "wall.concrete.common", .kind = .wall, .label = "Concrete Wall", .theme = .common, .material = .concrete, .size = WALL_SIZE, .snap = .edge, .tags = SOLID_WALL_TAGS },
    .{ .id = "wall.brick.downtown", .kind = .wall, .label = "Brick Wall", .theme = .downtown, .material = .brick, .size = WALL_SIZE, .snap = .edge, .tags = SOLID_WALL_TAGS },
    .{ .id = "wall.stucco.suburb", .kind = .wall, .label = "Stucco Wall", .theme = .suburb, .material = .stucco, .size = WALL_SIZE, .snap = .edge, .tags = blk: {
        var t = SOLID_WALL_TAGS;
        t.durability = 240;
        break :blk t;
    } },
    .{ .id = "wall.stucco.motel", .kind = .wall, .label = "Motel Wall", .theme = .motel, .material = .stucco, .size = WALL_SIZE, .snap = .edge, .tags = blk: {
        var t = SOLID_WALL_TAGS;
        t.durability = 240;
        break :blk t;
    } },
    .{ .id = "wall.metal.industrial", .kind = .wall, .label = "Sheet-Metal Wall", .theme = .industrial, .material = .metal, .size = WALL_SIZE, .snap = .edge, .tags = blk: {
        var t = SOLID_WALL_TAGS;
        t.blocksSound = false;
        break :blk t;
    } },
    .{ .id = "wall.plywood.trap_lot", .kind = .wall, .label = "Plywood Wall", .theme = .trap_lot, .material = .wood, .size = WALL_SIZE, .snap = .edge, .tags = blk: {
        var t = SOLID_WALL_TAGS;
        t.blocksSound = false;
        t.durability = 120;
        break :blk t;
    } },
    .{ .id = "wall.storefront.downtown", .kind = .wall, .label = "Storefront Glass", .theme = .downtown, .material = .glass, .size = WALL_SIZE, .snap = .edge, .tags = .{ .collision = true, .blocksSight = false, .blocksSound = true, .cover = .none, .durability = 60, .climbable = false, .vaultable = false, .portal = false } },

    // ── wall TYPES that are a cutout (REQ-0647) ────────────────────────────────
    .{ .id = "wall.concrete.doorway", .kind = .wall, .label = "Doorway Wall", .theme = .common, .material = .concrete, .size = WALL_SIZE, .snap = .edge, .defaultEdit = .door, .tags = SOLID_WALL_TAGS },
    .{ .id = "wall.concrete.openDoorway", .kind = .wall, .label = "Open Doorway Wall", .theme = .common, .material = .concrete, .size = WALL_SIZE, .snap = .edge, .defaultEdit = .arch, .tags = SOLID_WALL_TAGS },
    .{ .id = "wall.metal.garageDoor", .kind = .wall, .label = "Garage Door Wall", .theme = .industrial, .material = .metal, .size = WALL_SIZE, .snap = .edge, .defaultEdit = .garageDoor, .tags = blk: {
        var t = SOLID_WALL_TAGS;
        t.blocksSound = false;
        break :blk t;
    } },
    .{ .id = "wall.stucco.window", .kind = .wall, .label = "Window Wall", .theme = .suburb, .material = .stucco, .size = WALL_SIZE, .snap = .edge, .defaultEdit = .window, .tags = blk: {
        var t = SOLID_WALL_TAGS;
        t.durability = 240;
        break :blk t;
    } },
    .{ .id = "wall.stucco.doubleWindow", .kind = .wall, .label = "Double Window Wall", .theme = .suburb, .material = .stucco, .size = WALL_SIZE, .snap = .edge, .defaultEdit = .doubleWindow, .tags = blk: {
        var t = SOLID_WALL_TAGS;
        t.durability = 240;
        break :blk t;
    } },
    .{ .id = "wall.plywood.brokenWindow", .kind = .wall, .label = "Broken Window Wall", .theme = .trap_lot, .material = .wood, .size = WALL_SIZE, .snap = .edge, .defaultEdit = .brokenWindow, .tags = blk: {
        var t = SOLID_WALL_TAGS;
        t.blocksSound = false;
        t.durability = 120;
        break :blk t;
    } },

    // ── floors / roofs ─────────────────────────────────────────────────────────
    .{ .id = "floor.concrete.common", .kind = .floor, .label = "Concrete Floor", .theme = .common, .material = .concrete, .size = FLOOR_SIZE, .snap = .grid, .tags = SOLID_PLATE_TAGS },
    .{ .id = "floor.wood.suburb", .kind = .floor, .label = "Wood Floor", .theme = .suburb, .material = .wood, .size = FLOOR_SIZE, .snap = .grid, .tags = blk: {
        var t = SOLID_PLATE_TAGS;
        t.durability = 180;
        break :blk t;
    } },
    .{ .id = "roof.flat.common", .kind = .roof, .label = "Flat Roof", .theme = .common, .material = .concrete, .size = PLATE_SIZE, .snap = .grid, .roofShape = .flat, .tags = blk: {
        var t = SOLID_PLATE_TAGS;
        t.cover = .low;
        break :blk t;
    } },
    .{ .id = "roof.gable.suburb", .kind = .roof, .label = "Gable Roof", .theme = .suburb, .material = .wood, .size = PLATE_SIZE, .snap = .grid, .roofShape = .gable, .roofPitch = ROOF_PITCH.semiSlant, .tags = ROOF_CLIMB_TAGS },
    .{ .id = "roof.gableSteep.suburb", .kind = .roof, .label = "Gable Roof (Steep)", .theme = .suburb, .material = .wood, .size = PLATE_SIZE, .snap = .grid, .roofShape = .gable, .roofPitch = ROOF_PITCH.fullSlant, .tags = ROOF_CLIMB_TAGS },
    .{ .id = "roof.shed.common", .kind = .roof, .label = "Shed Roof", .theme = .common, .material = .metal, .size = PLATE_SIZE, .snap = .grid, .roofShape = .shed, .roofPitch = ROOF_PITCH.semiSlant, .tags = ROOF_CLIMB_TAGS },
    .{ .id = "roof.shedSteep.common", .kind = .roof, .label = "Shed Roof (Steep)", .theme = .common, .material = .metal, .size = PLATE_SIZE, .snap = .grid, .roofShape = .shed, .roofPitch = ROOF_PITCH.fullSlant, .tags = ROOF_CLIMB_TAGS },
    .{ .id = "roof.shingle.suburb", .kind = .roof, .label = "Shingle Roof", .theme = .suburb, .material = .wood, .size = PLATE_SIZE, .snap = .grid, .roofShape = .gable, .roofPitch = ROOF_PITCH.semiSlant, .tags = ROOF_CLIMB_TAGS },

    // ── vertical links ─────────────────────────────────────────────────────────
    .{ .id = "ramp.concrete.common", .kind = .ramp, .label = "Concrete Ramp", .theme = .common, .material = .concrete, .size = VERTICAL_LINK_SIZE, .snap = .grid, .tags = blk: {
        var t = SOLID_PLATE_TAGS;
        t.cover = .high;
        t.blocksSight = true;
        t.blocksSound = false;
        break :blk t;
    } },
    .{ .id = "stairs.wood.common", .kind = .stairs, .label = "Wood Stairs", .theme = .common, .material = .wood, .size = VERTICAL_LINK_SIZE, .snap = .grid, .tags = blk: {
        var t = SOLID_PLATE_TAGS;
        t.cover = .low;
        t.durability = 150;
        t.blocksSound = false;
        break :blk t;
    } },
    .{ .id = "stairs.concrete.common", .kind = .stairs, .label = "Concrete Stairs", .theme = .common, .material = .concrete, .size = VERTICAL_LINK_SIZE, .snap = .grid, .tags = blk: {
        var t = SOLID_PLATE_TAGS;
        t.cover = .low;
        t.blocksSound = false;
        break :blk t;
    } },
    .{ .id = "stairs.metal.industrial", .kind = .stairs, .label = "Metal Utility Stairs", .theme = .industrial, .material = .metal, .size = VERTICAL_LINK_SIZE, .snap = .grid, .tags = blk: {
        var t = SOLID_PLATE_TAGS;
        t.cover = .low;
        t.durability = 180;
        t.blocksSound = false;
        break :blk t;
    } },
    .{ .id = "stairs.wood.narrow", .kind = .stairs, .label = "Narrow Wood Stairs", .theme = .common, .material = .wood, .size = .{ .widthMeters = 1.2, .heightMeters = 3, .depthMeters = 3 }, .snap = .grid, .tags = blk: {
        var t = SOLID_PLATE_TAGS;
        t.cover = .low;
        t.durability = 120;
        t.blocksSound = false;
        break :blk t;
    } },
    .{ .id = "elevator.metal.common", .kind = .elevator, .label = "Elevator", .theme = .common, .material = .metal, .size = VERTICAL_LINK_SIZE, .snap = .grid, .tags = blk: {
        var t = SOLID_PLATE_TAGS;
        t.cover = .high;
        t.durability = 200;
        t.blocksSound = false;
        break :blk t;
    } },

    // ── columns / corners / arches ─────────────────────────────────────────────
    .{ .id = "pillar.concrete.common", .kind = .pillar, .label = "Concrete Pillar", .theme = .common, .material = .concrete, .size = .{ .widthMeters = 0.6, .heightMeters = 3, .depthMeters = 0.6 }, .snap = .grid, .tags = blk: {
        var t = SOLID_WALL_TAGS;
        t.cover = .full;
        t.blocksSound = false;
        break :blk t;
    } },
    .{ .id = "corner.concrete.common", .kind = .corner, .label = "Concrete Corner", .theme = .common, .material = .concrete, .size = .{ .widthMeters = 3, .heightMeters = 3, .depthMeters = 3 }, .snap = .edge, .tags = SOLID_WALL_TAGS },
    .{ .id = "arch.concrete.downtown", .kind = .arch, .label = "Concrete Arch", .theme = .downtown, .material = .concrete, .size = WALL_SIZE, .snap = .edge, .tags = blk: {
        var t = SOLID_WALL_TAGS;
        t.blocksSight = false;
        t.blocksSound = false;
        t.portal = true;
        break :blk t;
    } },

    // ── boundary lines ─────────────────────────────────────────────────────────
    .{ .id = "fence.chainlink.trap_lot", .kind = .fence, .label = "Chainlink Fence", .theme = .trap_lot, .material = .chainlink, .size = .{ .widthMeters = 3, .heightMeters = 2, .depthMeters = 0.05 }, .snap = .edge, .tags = .{ .collision = true, .blocksSight = false, .blocksSound = false, .cover = .none, .durability = 80, .climbable = true, .vaultable = false, .portal = false } },
    .{ .id = "fence.wood.suburb", .kind = .fence, .label = "Wood Fence", .theme = .suburb, .material = .wood, .size = .{ .widthMeters = 3, .heightMeters = 1.8, .depthMeters = 0.08 }, .snap = .edge, .tags = .{ .collision = true, .blocksSight = true, .blocksSound = false, .cover = .high, .durability = 90, .climbable = true, .vaultable = false, .portal = false } },
    .{ .id = "railing.metal.motel", .kind = .railing, .label = "Walkway Railing", .theme = .motel, .material = .metal, .size = .{ .widthMeters = 3, .heightMeters = 1, .depthMeters = 0.08 }, .snap = .edge, .tags = .{ .collision = true, .blocksSight = false, .blocksSound = false, .cover = .low, .durability = 110, .climbable = false, .vaultable = true, .portal = false } },

    // ── signal-only pieces ─────────────────────────────────────────────────────
    .{ .id = "trim.cornice.downtown", .kind = .trim, .label = "Cornice Trim", .theme = .downtown, .material = .concrete, .size = .{ .widthMeters = 3, .heightMeters = 0.3, .depthMeters = 0.3 }, .snap = .surface, .tags = .{ .collision = false, .blocksSight = false, .blocksSound = false, .cover = .none, .durability = null, .climbable = false, .vaultable = false, .portal = false } },
    .{ .id = "sign.shop.downtown", .kind = .sign, .label = "Shop Sign", .theme = .downtown, .material = .metal, .size = .{ .widthMeters = 2.4, .heightMeters = 0.8, .depthMeters = 0.2 }, .snap = .surface, .tags = .{ .collision = false, .blocksSight = false, .blocksSound = false, .cover = .none, .durability = 40, .climbable = false, .vaultable = false, .portal = false } },
    .{ .id = "sign.pole.common", .kind = .sign, .label = "Pole Sign", .theme = .common, .material = .metal, .size = .{ .widthMeters = 0.24, .heightMeters = 3.3, .depthMeters = 0.24 }, .snap = .free, .tags = .{ .collision = true, .blocksSight = false, .blocksSound = false, .cover = .none, .durability = 70, .climbable = false, .vaultable = false, .portal = false } },
};

// Shared roof tag row: SOLID_PLATE_TAGS + { cover: 'low', durability: 180, climbable: true }.
const ROOF_CLIMB_TAGS = blk: {
    var t = SOLID_PLATE_TAGS;
    t.cover = .low;
    t.durability = 180;
    t.climbable = true;
    break :blk t;
};

/// Runtime prop/cooked catalog registry (the TS COOKED_CATALOG + PROP_CATALOG).
/// The cooked/prop module registers a lookup once ported; null until then, so
/// catalogEntry resolves the static rows immediately and cooked ids when wired.
const CookedLookup = *const fn (id: []const u8) ?BuildPieceDef;
var cooked_lookup: ?CookedLookup = null;
pub fn registerCookedCatalog(lookup: CookedLookup) void {
    cooked_lookup = lookup;
}
fn cookedCatalogEntry(id: []const u8) ?BuildPieceDef {
    if (cooked_lookup) |f| return f(id);
    return null;
}

/// The static BUILD_CATALOG row for an id, or null (catalog.ts BUILD_CATALOG[id]).
pub fn builtinCatalogEntry(id: []const u8) ?BuildPieceDef {
    for (BUILD_CATALOG) |entry| {
        if (std.mem.eql(u8, entry.id, id)) return entry;
    }
    return null;
}

/// catalog.ts catalogEntry — BUILD_CATALOG then COOKED_CATALOG. null = unknown id
/// (the TS throws `unknown piece id`; callers treat null as that error).
pub fn catalogEntry(id: []const u8) ?BuildPieceDef {
    if (builtinCatalogEntry(id)) |e| return e;
    return cookedCatalogEntry(id);
}

/// catalog.ts isCatalogId.
pub fn isCatalogId(id: []const u8) bool {
    return catalogEntry(id) != null;
}

/// placed.ts placedPieceDef — the catalog row for a placed piece (null = unknown id).
pub fn placedPieceDef(piece: PlacedBuildPiece) ?BuildPieceDef {
    return catalogEntry(piece.pieceId);
}

// ── leaf geometry ────────────────────────────────────────────────────────────
// Verbatim from placed.ts. The JS WeakMap perf-grid (pieceGridOf/piecesNear) is
// an identity-cached candidate narrower whose predicates re-check exactly — the
// TS notes "the result is identical" — so liftedWallBaseY scans directly here;
// the spatial index ports later if host profiling needs it. The prop-specific
// visualBounds Y-band (propLocalYBand) is coded-model content and is deferred.
// placedPieceDef is unwrapped with `.?` — the world stream only stores valid
// ids, and the TS placedPieceDef throws on an unknown id (same invariant).

const DEG: f32 = std.math.pi / 180.0;

pub const PieceBounds = struct {
    minX: f32,
    maxX: f32,
    minZ: f32,
    maxZ: f32,
    baseY: f32,
    topY: f32,
};

pub const RoofProfile = struct { shape: RoofShape, pitch: f32 };

fn normalizeYaw(yawDegrees: f32) f32 {
    return @mod(@mod(yawDegrees, 360.0) + 360.0, 360.0);
}

/// yaw snapped onto a quarter turn, or null when genuinely free-angled (placed.ts).
fn quarterTurns(yawDegrees: f32) ?i32 {
    const yaw = normalizeYaw(yawDegrees);
    const quarter = @mod(@as(i32, @round(yaw / 90.0)), 4);
    if (@abs(yaw - @as(f32, @floatFromInt(quarter)) * 90.0) < 1e-6 or @abs(yaw - 360.0) < 1e-6) return quarter;
    return null;
}

/// placed.ts placedPieceSize — the row's size with a roof's dragged footprint
/// (ROOFSPAN) substituted for width/depth. ONE source for visuals/bounds/snap/colliders.
pub fn placedPieceSize(piece: PlacedBuildPiece) BuildPieceSize {
    const size = placedPieceDef(piece).?.size;
    if (piece.roofSpan) |rs| {
        if (rs.widthMeters > 0 and rs.depthMeters > 0) {
            return .{ .widthMeters = rs.widthMeters, .heightMeters = size.heightMeters, .depthMeters = rs.depthMeters };
        }
    }
    return size;
}

/// placed.ts placedRoofProfile — a pitched roof's effective (shape, pitch);
/// non-roof / flat rows report shape .flat, pitch 0.
pub fn placedRoofProfile(piece: PlacedBuildPiece) RoofProfile {
    const def = placedPieceDef(piece).?;
    if (def.kind != .roof) return .{ .shape = .flat, .pitch = 0 };
    return .{ .shape = def.roofShape orelse .flat, .pitch = def.roofPitch orelse ROOF_PITCH.semiSlant };
}

/// placed.ts roofRiseMeters — the ridge/apex rise above the eave, scaled to the
/// footprint span. run = full depth (shed), half depth (gable), or half the short
/// axis (hip/pyramid). 0 for flat roofs and non-roof pieces.
pub fn roofRiseMeters(piece: PlacedBuildPiece) f32 {
    const prof = placedRoofProfile(piece);
    if (prof.shape == .flat) return 0;
    const size = placedPieceSize(piece);
    const run = switch (prof.shape) {
        .shed => size.depthMeters,
        .gable => size.depthMeters / 2.0,
        .hip, .pyramid => @min(size.widthMeters, size.depthMeters) / 2.0,
        .flat => unreachable, // returned above
    };
    return @max(0, prof.pitch * run);
}

/// placed.ts placedPieceTags — catalog row + edit, the one composition point.
pub fn placedPieceTags(piece: PlacedBuildPiece) BuildGameplayTags {
    return effectiveTags(placedPieceDef(piece).?, piece.edit);
}

/// placed.ts pieceBounds — axis-aligned world envelope (exact for quarter-turn
/// yaw, the rotated envelope otherwise). topY tops out at the ridge for pitched roofs.
pub fn pieceBounds(piece: PlacedBuildPiece) PieceBounds {
    const size = placedPieceSize(piece);
    const halfW = size.widthMeters / 2.0;
    const halfD = size.depthMeters / 2.0;
    var hx: f32 = undefined;
    var hz: f32 = undefined;
    if (quarterTurns(piece.yawDegrees)) |quarter| {
        const swapped = @mod(quarter, 2) == 1;
        hx = if (swapped) halfD else halfW;
        hz = if (swapped) halfW else halfD;
    } else {
        const cos = @abs(@cos(piece.yawDegrees * DEG));
        const sin = @abs(@sin(piece.yawDegrees * DEG));
        hx = cos * halfW + sin * halfD;
        hz = sin * halfW + cos * halfD;
    }
    return .{
        .minX = piece.x - hx,
        .maxX = piece.x + hx,
        .minZ = piece.z - hz,
        .maxZ = piece.z + hz,
        .baseY = piece.y,
        .topY = piece.y + @max(size.heightMeters, roofRiseMeters(piece)),
    };
}

/// placed.ts pieceVisualBounds — the selection/highlight envelope. For a prop
/// whose mesh sits off the ground the TS lifts Y to propLocalYBand (coded-model
/// content, deferred); every non-prop piece is exactly pieceBounds.
pub fn pieceVisualBounds(piece: PlacedBuildPiece) PieceBounds {
    const base = pieceBounds(piece);
    // prop kind: propLocalYBand lift deferred with the prop/cooked module.
    return base;
}

fn isSupportPlate(kind: BuildPieceKind) bool {
    return kind == .floor or kind == .roof;
}

// WALLTOP (placed.ts): wall-family pieces ALWAYS rest on the floor at their cell.
fn isWallRestKind(kind: BuildPieceKind) bool {
    return switch (kind) {
        .wall, .fence, .railing, .pillar, .corner, .arch => true,
        else => false,
    };
}
const WALL_REST_MAX_RISE_METERS: f32 = 1.5;
const WALL_REST_EPSILON_METERS: f32 = 0.02;

/// placed.ts liftedWallBaseY — the Y a wall-family piece should REST at: the top
/// of the highest floor/roof plate overlapping its footprint at its own storey,
/// else its authored Y. READ-TIME projection; idempotent. (Direct scan; see note.)
pub fn liftedWallBaseY(piece: PlacedBuildPiece, pieces: []const PlacedBuildPiece) f32 {
    if (!isWallRestKind(placedPieceDef(piece).?.kind)) return piece.y;
    const wall = pieceBounds(piece);
    var restY = piece.y;
    for (pieces) |other| {
        if (std.mem.eql(u8, other.id, piece.id)) continue;
        if (!isSupportPlate(placedPieceDef(other).?.kind)) continue;
        const plate = pieceBounds(other);
        if (@min(wall.maxX, plate.maxX) <= @max(wall.minX, plate.minX)) continue; // no plan overlap (x)
        if (@min(wall.maxZ, plate.maxZ) <= @max(wall.minZ, plate.minZ)) continue; // no plan overlap (z)
        if (plate.topY < piece.y - WALL_REST_EPSILON_METERS) continue; // below the wall
        if (plate.topY > piece.y + WALL_REST_MAX_RISE_METERS) continue; // a storey up
        if (plate.topY > restY) restY = plate.topY;
    }
    return restY;
}

/// placed.ts liftWallsOntoFloors — the piece list with every wall-family piece
/// lifted onto the floor beneath it (READ-TIME; stored data unchanged). Idempotent.
/// Caller owns the returned slice.
pub fn liftWallsOntoFloors(allocator: std.mem.Allocator, pieces: []const PlacedBuildPiece) ![]PlacedBuildPiece {
    const out = try allocator.alloc(PlacedBuildPiece, pieces.len);
    for (pieces, 0..) |piece, i| {
        out[i] = piece;
        const restY = liftedWallBaseY(piece, pieces);
        if (restY > piece.y + WALL_REST_EPSILON_METERS) out[i].y = restY;
    }
    return out;
}

/// placed.ts boundsTouch — two envelopes come within tolerance on every axis.
fn boundsTouch(a: PieceBounds, b: PieceBounds, tolerance: f32) bool {
    return a.minX <= b.maxX + tolerance and b.minX <= a.maxX + tolerance and
        a.minZ <= b.maxZ + tolerance and b.minZ <= a.maxZ + tolerance and
        a.baseY <= b.topY + tolerance and b.baseY <= a.topY + tolerance;
}

// ── the brain: placementFor / validatePlacement ──────────────────────────────
// Verbatim from placed.ts. These are what the iso editor commits through — arm a
// catalog def, resolve a pose, build the placement, validate it, commit the
// piecePlaced event.

pub const PlacementPose = struct { x: f32, y: f32, z: f32, yawDegrees: f32 };

/// placed.ts placementFor — the placement record for a def at a pose. `id` is
/// minted by the world-stream materializer (the TS returns Omit<...,'id'>, so
/// id is left empty here); a wall row's defaultEdit rides onto every placement.
pub fn placementFor(def: BuildPieceDef, at: PlacementPose) PlacedBuildPiece {
    return .{
        .id = "", // minted downstream by the materializer (replay-deterministic)
        .pieceId = def.id,
        .x = at.x,
        .y = at.y,
        .z = at.z,
        .yawDegrees = at.yawDegrees,
        .edit = def.defaultEdit,
    };
}

/// The typed reasons a placement is invalid (placed.ts validatePlacement returns
/// the equivalent human strings; the binding renders these). `ok()` = the TS
/// empty-list valid result.
pub const PlacementValidation = struct {
    unknown_piece: bool = false,
    kind_accepts_no_edits: bool = false,
    position_not_finite: bool = false,

    pub fn ok(self: PlacementValidation) bool {
        return !self.unknown_piece and !self.kind_accepts_no_edits and !self.position_not_finite;
    }
};

/// placed.ts validatePlacement — every way a placement is invalid; ok() = valid.
/// Unknown piece short-circuits (the TS returns immediately with only that).
pub fn validatePlacement(placement: PlacedBuildPiece) PlacementValidation {
    var v = PlacementValidation{};
    if (!isCatalogId(placement.pieceId)) {
        v.unknown_piece = true;
        return v;
    }
    if (placement.edit != null and !kindAcceptsWallEdits(catalogEntry(placement.pieceId).?.kind)) {
        v.kind_accepts_no_edits = true;
    }
    if (!std.math.isFinite(placement.x) or !std.math.isFinite(placement.y) or !std.math.isFinite(placement.z)) {
        v.position_not_finite = true;
    }
    return v;
}

// ── picking: raycastPieces ───────────────────────────────────────────────────
// Verbatim from placed.ts. placedPieceDepthSpan is just centeredDepthSpan (its
// `pieces` param is `void pieces` — the wall-join extension is renderer-miter
// geometry, placedPieceWallEnds, not this). Direct scan replaces the JS
// piecesNear grid. The prop off-ground Y-band (propVerticalBand) is deferred →
// band 0, so non-prop pieces pick exactly and props pick on a ground-anchored box.

pub const Vec3 = struct { x: f32, y: f32, z: f32 };
pub const PieceRay = struct { origin: Vec3, dir: Vec3 };
pub const PieceHit = struct { piece: PlacedBuildPiece, index: usize, t: f32, point: Vec3, normal: Vec3 };
pub const PlacedPieceDepthSpan = struct { minV: f32, maxV: f32 };

fn centeredDepthSpan(size: BuildPieceSize) PlacedPieceDepthSpan {
    return .{ .minV = -size.depthMeters / 2.0, .maxV = size.depthMeters / 2.0 };
}

/// placed.ts placedPieceDepthSpan — the centered depth span (pieces param unused).
pub fn placedPieceDepthSpan(piece: PlacedBuildPiece) PlacedPieceDepthSpan {
    return centeredDepthSpan(placedPieceDef(piece).?.size);
}

/// placed.ts raycastPieces — the closest ray↔piece hit (oriented-box slab test in
/// each piece's local frame), or null past maxDistance / on a clean miss.
pub fn raycastPieces(ray: PieceRay, pieces: []const PlacedBuildPiece, maxDistance: f32) ?PieceHit {
    var best: ?PieceHit = null;
    for (pieces, 0..) |piece, piece_index| {
        const size = placedPieceDef(piece).?.size;
        const depthSpan = placedPieceDepthSpan(piece);
        const depthCenter = (depthSpan.minV + depthSpan.maxV) / 2.0;
        const depthSize = depthSpan.maxV - depthSpan.minV;
        const yawRadians = piece.yawDegrees * DEG;
        const cos = @cos(-yawRadians);
        const sin = @sin(-yawRadians);
        const baseY: f32 = 0; // propVerticalBand deferred (coded-model content)
        const heightY: f32 = size.heightMeters;
        const centerY = piece.y + baseY + heightY / 2.0;
        // ray → piece frame (translate to center, rotate by -yaw about +Y)
        const relX = ray.origin.x - piece.x;
        const relZ = ray.origin.z - piece.z;
        const ox = relX * cos - relZ * sin;
        const oy = ray.origin.y - centerY;
        const oz = relX * sin + relZ * cos - depthCenter;
        const dx = ray.dir.x * cos - ray.dir.z * sin;
        const dy = ray.dir.y;
        const dz = ray.dir.x * sin + ray.dir.z * cos;
        const half = [3]f32{ size.widthMeters / 2.0, heightY / 2.0, depthSize / 2.0 };
        const origin = [3]f32{ ox, oy, oz };
        const dir = [3]f32{ dx, dy, dz };
        // slab test
        var tNear: f32 = 0;
        var tFar: f32 = maxDistance;
        var nearAxis: i32 = -1;
        var nearSign: f32 = 0;
        var miss = false;
        var axis: usize = 0;
        while (axis < 3) : (axis += 1) {
            if (@abs(dir[axis]) < 1e-9) {
                if (@abs(origin[axis]) > half[axis]) {
                    miss = true;
                    break;
                }
                continue;
            }
            var t0 = (-half[axis] - origin[axis]) / dir[axis];
            var t1 = (half[axis] - origin[axis]) / dir[axis];
            // the entry face is the one the ray travels AGAINST
            const sign: f32 = if (dir[axis] > 0) -1 else 1;
            if (t0 > t1) {
                const swap = t0;
                t0 = t1;
                t1 = swap;
            }
            if (t0 > tNear) {
                tNear = t0;
                nearAxis = @intCast(axis);
                nearSign = sign;
            }
            if (t1 < tFar) tFar = t1;
            if (tNear > tFar) {
                miss = true;
                break;
            }
        }
        if (miss or nearAxis < 0) continue;
        if (best) |b| {
            if (tNear >= b.t) continue;
        }
        // local face normal → world (rotate by +yaw)
        var local = [3]f32{ 0, 0, 0 };
        local[@intCast(nearAxis)] = nearSign;
        const wcos = @cos(yawRadians);
        const wsin = @sin(yawRadians);
        best = .{
            .piece = piece,
            .index = piece_index,
            .t = tNear,
            .point = .{
                .x = ray.origin.x + ray.dir.x * tNear,
                .y = ray.origin.y + ray.dir.y * tNear,
                .z = ray.origin.z + ray.dir.z * tNear,
            },
            .normal = .{
                .x = local[0] * wcos - local[2] * wsin,
                .y = local[1],
                .z = local[0] * wsin + local[2] * wcos,
            },
        };
    }
    return best;
}

// ── editor queries: piecesNearPoint / connectedPieceIds ──────────────────────
// Verbatim from placed.ts, allocation-free (caller-owned buffers, matching the
// host-binding style). The JS spatial grid (piecesNear) is a candidate superset
// whose callers re-check exactly — a direct bounds-overlap scan is an equally
// valid superset, so results are identical.

/// placed.ts piecesNearPoint — pieces whose footprint may sit within radius of
/// (x,z). Writes matches into `out`, returns the count (capped at out.len).
pub fn piecesNearPoint(pieces: []const PlacedBuildPiece, x: f32, z: f32, radiusMeters: f32, out: []PlacedBuildPiece) usize {
    const minX = x - radiusMeters;
    const maxX = x + radiusMeters;
    const minZ = z - radiusMeters;
    const maxZ = z + radiusMeters;
    var n: usize = 0;
    for (pieces) |piece| {
        if (n >= out.len) break;
        const b = pieceBounds(piece);
        if (b.minX <= maxX and b.maxX >= minX and b.minZ <= maxZ and b.maxZ >= minZ) {
            out[n] = piece;
            n += 1;
        }
    }
    return n;
}

/// placed.ts connectedPieceIds — every piece TRANSITIVELY touching the seed (BFS
/// over pieceBounds envelope contact). Writes connected INDICES into `out` (the
/// binding maps to ids), returns the count; the seed is always included, an
/// unknown seed → 0. `visited` is caller scratch (len ≥ pieces.len); `out` doubles
/// as the BFS queue (a head pointer walks the appended indices).
pub fn connectedPieceIds(
    seedId: []const u8,
    pieces: []const PlacedBuildPiece,
    toleranceMeters: f32,
    visited: []bool,
    out: []usize,
) usize {
    @memset(visited[0..pieces.len], false);
    var seedIdx: ?usize = null;
    for (pieces, 0..) |p, i| {
        if (std.mem.eql(u8, p.id, seedId)) {
            seedIdx = i;
            break;
        }
    }
    const si = seedIdx orelse return 0;
    var count: usize = 0;
    visited[si] = true;
    out[count] = si;
    count += 1;
    var head: usize = 0;
    while (head < count) : (head += 1) {
        const current = pieceBounds(pieces[out[head]]);
        for (pieces, 0..) |cand, i| {
            if (visited[i]) continue;
            const cb = pieceBounds(cand);
            if (boundsTouch(current, cb, toleranceMeters)) {
                visited[i] = true;
                if (count >= out.len) return count;
                out[count] = i;
                count += 1;
            }
        }
    }
    return count;
}

test "PLACED_TUNING values match the TS source verbatim" {
    try std.testing.expectEqual(@as(f32, 1.2), PLACED_TUNING.walkOpeningWidthMeters);
    try std.testing.expectEqual(@as(f32, 2.6), PLACED_TUNING.vehicleOpeningWidthMeters);
    try std.testing.expectEqual(@as(i32, 10), PLACED_TUNING.stairVisualSteps);
    try std.testing.expectEqual(@as(f32, 1e-6), PLACED_TUNING.wallJoinToleranceMeters);
}

test "BUILD_CATALOG rows + catalogEntry match the TS source verbatim" {
    try std.testing.expectEqual(@as(usize, 36), BUILD_CATALOG.len);
    // floor row: kind + FLOOR_SIZE
    const floor = catalogEntry("floor.concrete.common").?;
    try std.testing.expectEqual(BuildPieceKind.floor, floor.kind);
    try std.testing.expectEqual(@as(f32, 0.05), floor.size.heightMeters);
    // wall cutout carries its defaultEdit
    try std.testing.expectEqual(WallEdit.door, catalogEntry("wall.concrete.doorway").?.defaultEdit.?);
    // durability override
    try std.testing.expectEqual(@as(i32, 240), catalogEntry("wall.stucco.suburb").?.tags.durability.?);
    // chainlink material + see-through fence tags
    const fence = catalogEntry("fence.chainlink.trap_lot").?;
    try std.testing.expectEqual(BuildMaterial.chainlink, fence.material);
    try std.testing.expect(!fence.tags.blocksSight);
    try std.testing.expect(fence.tags.climbable);
    // roof: shared climb tags + pitch
    const gable = catalogEntry("roof.gable.suburb").?;
    try std.testing.expectEqual(RoofShape.gable, gable.roofShape.?);
    try std.testing.expectEqual(@as(f32, 0.5), gable.roofPitch.?);
    try std.testing.expect(gable.tags.climbable);
    // unknown id ⇒ null (the TS throw)
    try std.testing.expect(!isCatalogId("wall.nope"));
    try std.testing.expect(catalogEntry("wall.nope") == null);
}

test "applyWallEdit / effectiveTags match the TS overrides verbatim" {
    const solid_wall = BuildGameplayTags{
        .collision = true, .blocksSight = true, .blocksSound = true, .cover = .full,
        .durability = null, .climbable = false, .vaultable = false, .portal = false,
    };
    // door: overrides { portal: true }
    try std.testing.expect(applyWallEdit(solid_wall, .door).portal);
    // window: overrides { blocksSight: false }
    try std.testing.expect(!applyWallEdit(solid_wall, .window).blocksSight);
    // halfHeight: { blocksSight:false, cover:'low', vaultable:true }
    const hh = applyWallEdit(solid_wall, .halfHeight);
    try std.testing.expect(!hh.blocksSight);
    try std.testing.expectEqual(TileCoverHeight.low, hh.cover);
    try std.testing.expect(hh.vaultable);
    // solid: identity
    try std.testing.expectEqual(solid_wall.portal, applyWallEdit(solid_wall, .solid).portal);
    // effectiveTags: null edit ⇒ base row tags
    const def = BuildPieceDef{
        .id = "w", .kind = .wall, .label = "W", .theme = .common, .material = .concrete,
        .size = .{ .widthMeters = 3, .heightMeters = 3, .depthMeters = 0.005 },
        .snap = .edge, .tags = solid_wall,
    };
    try std.testing.expectEqual(solid_wall.portal, effectiveTags(def, null).portal);
    try std.testing.expect(effectiveTags(def, .door).portal);
    // contract: only wall accepts edits; snap defaults
    try std.testing.expect(placedPieceAcceptsEdits(.wall));
    try std.testing.expect(!placedPieceAcceptsEdits(.floor));
    try std.testing.expectEqual(BuildSnapMode.grid, kindSnapDefault(.floor));
    try std.testing.expectEqual(BuildSnapMode.surface, kindSnapDefault(.trim));
}

test "leaf geometry — bounds, roofRise, liftedWallBaseY match the TS math" {
    // a 3×3 floor at origin, yaw 0 → ±1.5 footprint, base 0, top 0.05 (FLOOR_SIZE height)
    const floor = PlacedBuildPiece{ .id = "f", .pieceId = "floor.concrete.common", .x = 0, .y = 0, .z = 0, .yawDegrees = 0 };
    const fb = pieceBounds(floor);
    try std.testing.expectApproxEqAbs(@as(f32, -1.5), fb.minX, 1e-5);
    try std.testing.expectApproxEqAbs(@as(f32, 1.5), fb.maxX, 1e-5);
    try std.testing.expectApproxEqAbs(@as(f32, 0.05), fb.topY, 1e-5);
    // quarter-turn swap: a WALL_SIZE piece (3 wide × 0.005 deep) yawed 90° swaps x/z half-extents
    const wall90 = PlacedBuildPiece{ .id = "w", .pieceId = "wall.concrete.common", .x = 0, .y = 0, .z = 0, .yawDegrees = 90 };
    const wb = pieceBounds(wall90);
    try std.testing.expectApproxEqAbs(@as(f32, 0.0025), wb.maxX, 1e-5); // half of 0.005 depth
    try std.testing.expectApproxEqAbs(@as(f32, 1.5), wb.maxZ, 1e-5); // half of 3 width
    // roofRise: flat → 0; gable pitch 0.5 over depth 3 → 0.5 * (3/2) = 0.75
    try std.testing.expectApproxEqAbs(@as(f32, 0), roofRiseMeters(.{ .id = "r", .pieceId = "roof.flat.common", .x = 0, .y = 0, .z = 0, .yawDegrees = 0 }), 1e-5);
    try std.testing.expectApproxEqAbs(@as(f32, 0.75), roofRiseMeters(.{ .id = "g", .pieceId = "roof.gable.suburb", .x = 0, .y = 0, .z = 0, .yawDegrees = 0 }), 1e-5);
    // liftedWallBaseY: a wall authored at y=0 over a floor whose top is 0.05 rests at 0.05
    const scene = [_]PlacedBuildPiece{
        floor,
        .{ .id = "w2", .pieceId = "wall.concrete.common", .x = 0, .y = 0, .z = 0, .yawDegrees = 0 },
    };
    try std.testing.expectApproxEqAbs(@as(f32, 0.05), liftedWallBaseY(scene[1], &scene), 1e-5);
    // a floor never rests (not a wall-rest kind) → its own y
    try std.testing.expectApproxEqAbs(@as(f32, 0), liftedWallBaseY(scene[0], &scene), 1e-5);
}

test "placementFor / validatePlacement match the TS brain" {
    // a plain floor at a pose → the pose, no edit
    const floorDef = catalogEntry("floor.concrete.common").?;
    const p = placementFor(floorDef, .{ .x = 3, .y = 0, .z = -6, .yawDegrees = 90 });
    try std.testing.expectEqualStrings("floor.concrete.common", p.pieceId);
    try std.testing.expectEqual(@as(f32, 3), p.x);
    try std.testing.expectEqual(@as(?WallEdit, null), p.edit);
    try std.testing.expect(validatePlacement(p).ok());
    // a doorway wall row rides its defaultEdit onto the placement
    const doorDef = catalogEntry("wall.concrete.doorway").?;
    const dp = placementFor(doorDef, .{ .x = 0, .y = 0, .z = 0, .yawDegrees = 0 });
    try std.testing.expectEqual(WallEdit.door, dp.edit.?);
    try std.testing.expect(validatePlacement(dp).ok());
    // unknown piece → unknown_piece, short-circuits
    try std.testing.expect(validatePlacement(.{ .id = "", .pieceId = "wall.nope", .x = 0, .y = 0, .z = 0, .yawDegrees = 0 }).unknown_piece);
    // an edit on a non-wall kind → kind_accepts_no_edits
    try std.testing.expect(validatePlacement(.{ .id = "", .pieceId = "floor.concrete.common", .x = 0, .y = 0, .z = 0, .yawDegrees = 0, .edit = .door }).kind_accepts_no_edits);
    // non-finite position → position_not_finite
    const nan = std.math.nan(f32);
    try std.testing.expect(validatePlacement(.{ .id = "", .pieceId = "floor.concrete.common", .x = nan, .y = 0, .z = 0, .yawDegrees = 0 }).position_not_finite);
}

test "raycastPieces — down-ray hits the floor top, up normal" {
    const scene = [_]PlacedBuildPiece{
        .{ .id = "f", .pieceId = "floor.concrete.common", .x = 0, .y = 0, .z = 0, .yawDegrees = 0 },
    };
    const hit = raycastPieces(.{ .origin = .{ .x = 0, .y = 5, .z = 0 }, .dir = .{ .x = 0, .y = -1, .z = 0 } }, &scene, 100).?;
    try std.testing.expectApproxEqAbs(@as(f32, 4.95), hit.t, 1e-4); // 5 → floor top 0.05
    try std.testing.expectApproxEqAbs(@as(f32, 0.05), hit.point.y, 1e-4);
    try std.testing.expectApproxEqAbs(@as(f32, 1.0), hit.normal.y, 1e-4); // top face points up
    // a ray that misses the footprint returns null
    try std.testing.expect(raycastPieces(.{ .origin = .{ .x = 50, .y = 5, .z = 0 }, .dir = .{ .x = 0, .y = -1, .z = 0 } }, &scene, 100) == null);
}

test "piecesNearPoint / connectedPieceIds match the TS queries" {
    const scene = [_]PlacedBuildPiece{
        .{ .id = "f0", .pieceId = "floor.concrete.common", .x = 0, .y = 0, .z = 0, .yawDegrees = 0 },
        .{ .id = "w0", .pieceId = "wall.concrete.common", .x = 0, .y = 0, .z = 0, .yawDegrees = 0 },
        .{ .id = "far", .pieceId = "floor.concrete.common", .x = 100, .y = 0, .z = 0, .yawDegrees = 0 },
    };
    // near (0,0) r=1 → the two at origin, not the far one
    var near_buf: [8]PlacedBuildPiece = undefined;
    try std.testing.expectEqual(@as(usize, 2), piecesNearPoint(&scene, 0, 0, 1, &near_buf));
    try std.testing.expectEqual(@as(usize, 1), piecesNearPoint(&scene, 100, 0, 1, &near_buf));
    // connected from the wall → wall + its floor (2), the far floor excluded
    var visited: [8]bool = undefined;
    var out: [8]usize = undefined;
    const n = connectedPieceIds("w0", &scene, PLACED_TUNING.touchToleranceMeters, &visited, &out);
    try std.testing.expectEqual(@as(usize, 2), n);
    // unknown seed → 0
    try std.testing.expectEqual(@as(usize, 0), connectedPieceIds("nope", &scene, PLACED_TUNING.touchToleranceMeters, &visited, &out));
}
