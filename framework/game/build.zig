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
pub const BuildMaterial = enum { concrete, brick, stucco, wood, metal, glass };

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

test "PLACED_TUNING values match the TS source verbatim" {
    try std.testing.expectEqual(@as(f32, 1.2), PLACED_TUNING.walkOpeningWidthMeters);
    try std.testing.expectEqual(@as(f32, 2.6), PLACED_TUNING.vehicleOpeningWidthMeters);
    try std.testing.expectEqual(@as(i32, 10), PLACED_TUNING.stairVisualSteps);
    try std.testing.expectEqual(@as(f32, 1e-6), PLACED_TUNING.wallJoinToleranceMeters);
}
