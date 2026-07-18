//! Loader-wide tuning and wire constants.
//!
//! Behavior-affecting values live here so renderer, physics, paint, and simulation
//! consume one named contract instead of burying magic numbers in implementation code.

const std = @import("std");
const foliage = @import("../world/foliage.zig");
const game_physics = @import("../game/physics.zig");

// Resolution of each materialized shader's 1-tile texture (the shader's canvas
// is exactly one 1m tile; the face sampler REPEATS it across the surface).
pub const MATERIAL_TILE_PX: u32 = 256;

pub const WIN_W: c_int = 800;
pub const WIN_H: c_int = 600;
pub const DEFAULT_FIXTURE = "framework/testing/fixtures/gamefile_roundtrip.b64";
pub const RJMP_MAGIC: u32 = 0x504d4a52;
pub const STORE_DIR = "zig-out/game/contentstore";
pub const MAX_FRAMES: u32 = 600;
// Instance row: pos3 + rot3 + scale3 + color3 + optional shape id. The first
// 12 floats match gpu/3d.zig; shape id is loader metadata for keyed geometry.
pub const INSTANCE_STRIDE: usize = 12;
// A baked traffic prototype row (req_2056): the 12 instance floats + a shape id
// at index 12. Mirrors compile/worldTraffic.ts TRAFFIC_ROW_STRIDE.
pub const TRAFFIC_PROTO_STRIDE: usize = 13;
pub const SHAPE_BOX: f32 = 0;
pub const SHAPE_RAMP: f32 = 1;
pub const SHAPE_CYLINDER8: f32 = 2;

// MAPPAINT req_2473: live-painted terrain mirror. One render node + one
// collider slot per painted chunk; the collider ids claim the TOP of the
// game_physics heightfield table so baked scene fields (counting up from 0)
// never collide with them.
pub const MAX_PAINT_SLOTS: usize = 64;
pub const PAINT_COLLIDER_BASE: usize = game_physics.MAX_HEIGHTFIELDS - MAX_PAINT_SLOTS;
/// The default THPS-style brush beam: a translucent column over the brush footprint.
pub const PAINT_BEAM_HEIGHT_METERS: f32 = 42;
pub const PAINT_BEAM_ALPHA: f32 = 0.32;
pub const PAINT_GIZMO_SURFACE_LIFT_M: f32 = 0.035;
pub const PAINT_GIZMO_PROFILE_MAX_M: f32 = 8;

/// The rendered vocabulary for semantic rail paths and the live path ghost.
/// Values are P2 tuning, consumed by both committed and preview geometry.
pub const TransportRenderTuning = struct {
    surface_lift_m: f32,
    preview_thickness_m: f32,
    preview_alpha: f32,
    anchor_marker_m: f32,
    segment_overlap_m: f32,
    rail_gauge_m: f32,
    double_track_spacing_m: f32,
    rail_width_m: f32,
    rail_height_m: f32,
    sleeper_spacing_m: f32,
    sleeper_width_m: f32,
    sleeper_height_m: f32,
    railway_bed_margin_m: f32,
    railway_bed_height_m: f32,
    light_rail_slab_margin_m: f32,
    light_rail_slab_height_m: f32,
    preview_color: [3]f32,
    invalid_color: [3]f32,
    ballast_color: [3]f32,
    slab_color: [3]f32,
    sleeper_color: [3]f32,
    steel_color: [3]f32,
    stop_bar_depth_m: f32,
    stop_bar_height_m: f32,
    stop_side_margin_m: f32,
    stop_post_width_m: f32,
    stop_post_height_m: f32,
    stop_head_size_m: f32,
    stop_color: [3]f32,
};

pub const TRANSPORT_RENDER = TransportRenderTuning{
    .surface_lift_m = 0.055,
    .preview_thickness_m = 0.07,
    .preview_alpha = 0.58,
    .anchor_marker_m = 1.1,
    .segment_overlap_m = 0.08,
    .rail_gauge_m = 1.435,
    .double_track_spacing_m = 3.6,
    .rail_width_m = 0.095,
    .rail_height_m = 0.13,
    .sleeper_spacing_m = 0.72,
    .sleeper_width_m = 0.19,
    .sleeper_height_m = 0.09,
    .railway_bed_margin_m = 0.95,
    .railway_bed_height_m = 0.11,
    .light_rail_slab_margin_m = 0.72,
    .light_rail_slab_height_m = 0.08,
    .preview_color = .{ 0.16, 0.88, 1.0 },
    .invalid_color = .{ 1.0, 0.2, 0.16 },
    .ballast_color = .{ 0.33, 0.31, 0.28 },
    .slab_color = .{ 0.32, 0.36, 0.41 },
    .sleeper_color = .{ 0.34, 0.22, 0.14 },
    .steel_color = .{ 0.68, 0.72, 0.76 },
    .stop_bar_depth_m = 0.34,
    .stop_bar_height_m = 0.12,
    .stop_side_margin_m = 0.42,
    .stop_post_width_m = 0.16,
    .stop_post_height_m = 1.8,
    .stop_head_size_m = 0.42,
    .stop_color = .{ 1.0, 0.62, 0.08 },
};
// Live-foliage preview STARTING sizes (req_2497: painting flora grows LITERAL
// blades/bushes/flowers/palms live). These are NOT walls (req_2843: "the
// 15.5mb cap on flora is killing me" — dozens of asks died on fixed budgets):
// pushFoliageRow DOUBLES a family when it fills, and the GPU retained pools
// grow to match (gpu/3d.zig growStaticPool, up to the device's granted
// maxBufferSize — real limits are requested at device creation now). The only
// refusals left are the machine's: allocator, device, frame rate. One palm =
// 1 trunk + ~16 crown fronds, so frond:trunk starts 16:1. Rows are SLIM on
// the GPU: grass/bush/flower/frond ride the 24 B SlimInstance pool and trunks
// the InstanceData pool. CPU side is 12 f32/row, reallocated on growth.
pub const PAINT_GRASS_ROW_CAP: u32 = 262144;
pub const PAINT_BUSH_ROW_CAP: u32 = 65536;
pub const PAINT_FLOWER_ROW_CAP: u32 = 65536;
pub const PAINT_FROND_ROW_CAP: u32 = 262144;
pub const PAINT_TRUNK_ROW_CAP: u32 = 16384;
pub const PAINT_WRAPPED_ROW_CAP: u32 = 16384;
pub const FOLIAGE_SEGMENT_HEADROOM_M: f32 = 16;
pub const FOLIAGE_SEGMENT_HORIZONTAL_RADIUS_M: f32 = 87; // 120 m chunk half-diagonal + row jitter

/// Live-preview node/buffer order. Ground families retain distance-density LOD;
/// palm parts and whole wrapped-flora silhouettes stay exact. Appending species here
/// keeps every row one existing 24-byte slim GPU instance.
pub const PaintFoliageFamily = enum(usize) {
    grass,
    flowers,
    bush,
    palm_fronds,
    palm_trunks,
    pine,
    maple,
    oak,
    cedar,
    spruce,
    mophead_hydrangea,
    panicle_hydrangea,
    leafy_thicket,
    wild_weed,
};
pub const PAINT_FOLIAGE_FAMILY_COUNT: usize = @intFromEnum(PaintFoliageFamily.wild_weed) + 1;
pub const PAINT_FOLIAGE_THINNABLE_COUNT: usize = @intFromEnum(PaintFoliageFamily.palm_fronds);
pub const PAINT_WRAPPED_FAMILY_FIRST: usize = @intFromEnum(PaintFoliageFamily.pine);
pub const PAINT_FOLIAGE_START_CAPS: [PAINT_FOLIAGE_FAMILY_COUNT]u32 = .{
    PAINT_GRASS_ROW_CAP,
    PAINT_FLOWER_ROW_CAP,
    PAINT_BUSH_ROW_CAP,
    PAINT_FROND_ROW_CAP,
    PAINT_TRUNK_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
};
pub const PAINT_FOLIAGE_NAMES: [PAINT_FOLIAGE_FAMILY_COUNT][]const u8 = .{
    "grass",             "flowers",           "bush",          "palm fronds", "palm trunks",
    "pine",              "maple",             "oak",           "cedar",       "spruce",
    "mophead hydrangea", "panicle hydrangea", "leafy thicket", "wild weed",
};
comptime {
    if (PAINT_FOLIAGE_FAMILY_COUNT != PAINT_WRAPPED_FAMILY_FIRST + foliage.WRAPPED_SPECIES_COUNT) {
        @compileError("paint foliage family order must end with WrappedSpecies in exact enum order");
    }
}
// Verbatim palm trunk constants (render3d/palmPopulation.ts PALM_CONFIG +
// PALM_TRUNK_UNIT_RADIUS) — the live trunk must roll the SAME hash chain the
// crown does so bark and fronds agree per cell.
pub const PALM_TRUNK_UNIT_RADIUS: f64 = 0.13;
pub const PALM_TRUNK_RADIUS_MIN: f64 = 0.14;
pub const PALM_TRUNK_RADIUS_MAX: f64 = 0.2;
pub const PALM_TRUNK_COLOR = [3]f32{ 0.48, 0.38, 0.26 };
pub const SHAPE_CYLINDER16: f32 = 3;
pub const SHAPE_SPHERE: f32 = 4;
pub const SHAPE_GABLE: f32 = 5; // req_0930: the triangular gable-end wall prism
pub const SHAPE_GRASS: f32 = 6; // a grass blade clump — drawn by the grass pipeline (wind/wisp/gradient)
pub const SHAPE_BUSH: f32 = 7; // a bush foliage clump — same foliage pipeline, bushier geometry
pub const SHAPE_FROND: f32 = 8; // a palm-crown frond card — drawn by the ~frond~ pipeline (leaf cutout + wind)
pub const SHAPE_PALMTRUNK: f32 = 9; // a palm trunk — tapered/curved/scar-ringed log, a normal lit mesh
pub const SHAPE_FLOWER: f32 = 10; // flower heads — tiny cards drawn by the ~grass~ wind pipeline
// A decorative box — renders exactly like SHAPE_BOX (geomForShape falls back to
// box) but NEVER becomes a physics collider. The procedural void shell
// (SKYBOX_PLAYBOOK) bakes thousands of these for the distant skyline; you never
// bump them (its single ground heightfield is what you walk on), and keeping them
// out of the collider build is what stops them saturating the rect/oriented cap.
pub const SHAPE_SCENERY_BOX: f32 = 11;
pub const SHAPE_CORNER_MITER: f32 = 12; // wall L-corner triangular miter prism
pub const SHAPE_CORNER_MITER_MIRROR: f32 = 13; // reflected wall L-corner miter prism
pub const SHAPE_BOX_OPEN_RUN_MIN: f32 = 14; // cube without local -x face
pub const SHAPE_BOX_OPEN_RUN_MAX: f32 = 15; // cube without local +x face
pub const SHAPE_BOX_OPEN_RUN_BOTH: f32 = 16; // cube without local +/-x faces
pub const SHAPE_WRAPPED_FIRST: f32 = 17; // contiguous whole-flora shapes, WrappedSpecies order

pub fn wrappedShapeId(species: foliage.WrappedSpecies) f32 {
    return SHAPE_WRAPPED_FIRST + @as(f32, @intFromEnum(species));
}

pub fn wrappedSpeciesForShape(shape: f32) ?foliage.WrappedSpecies {
    const rounded: i32 = @round(shape - SHAPE_WRAPPED_FIRST);
    if (rounded < 0 or rounded >= foliage.WRAPPED_SPECIES_COUNT) return null;
    if (@abs(shape - wrappedShapeId(@enumFromInt(rounded))) >= 0.5) return null;
    return @enumFromInt(rounded);
}
// WALLHIDE req_2053: a marker stamped into the SHAPE slot (index 12) of a wall
// row INSIDE a built batch/family buffer — never in self.insts. It's safe to
// overwrite there because: (1) post-batching every shape/material batch and every
// stream family is single-geometry (the draw picks geometry from the batch/proto,
// not the per-row shape), and (2) makeInstance (gpu/3d.zig) reads only indices
// 0..11, so index 12 is GPU-dead. collapseWallRows finds wall rows by this value
// so hide-walls can scale them to 0 with no rebake. Value is far outside the real
// shape id range so a non-stamped row's true shape never reads as a wall.
pub const WALL_SENTINEL_SHAPE: f32 = 424242.0;
pub const SCAN_A: usize = 4;
pub const SCAN_D: usize = 7;
pub const SCAN_S: usize = 22;
pub const SCAN_W: usize = 26;
pub const SCAN_SPACE: usize = 44;
pub const SCAN_LSHIFT: usize = 225;
// Spawn drops in from slightly above the resolved ground (req_0523): an exact
// or stale surface sample must settle ONTO the floor, never inside it.
pub const SPAWN_DROP_CLEARANCE_METERS: f32 = 0.35;
pub const CAMERA_DISTANCE_METERS: f32 = 7.65;
pub const CAMERA_INITIAL_PITCH_DEGREES: f32 = 17.8;
pub const CAMERA_MIN_PITCH_DEGREES: f32 = -10.0;
pub const CAMERA_MAX_PITCH_DEGREES: f32 = 62.0;
pub const CAMERA_TARGET_HEIGHT_METERS: f32 = 1.45;
pub const CAMERA_FOV_DEGREES: f32 = 52.0;
pub const CAMERA_YAW_DEGREES_PER_PIXEL: f32 = 0.28;
pub const CAMERA_PITCH_DEGREES_PER_PIXEL: f32 = 0.22;
pub const CAMERA_SMOOTHING_PER_SECOND: f32 = 14.0;
pub const AIM_SHOULDER_SHIFT_METERS: f32 = 0.62;
pub const AIM_PIVOT_HEIGHT_METERS: f32 = 1.62;
pub const AIM_CROUCH_DROP_METERS: f32 = 0.42;
pub const AIM_DISTANCE_METERS: f32 = 2.4;
pub const AIM_LOOK_AHEAD_METERS: f32 = 12.0;
pub const AIM_MIN_PITCH_DEGREES: f32 = -1.15 * 180.0 / std.math.pi;
pub const AIM_MAX_PITCH_DEGREES: f32 = 1.0 * 180.0 / std.math.pi;
pub const AIM_FOV_DEGREES: f32 = 47.0;
// Camera-collision spring-arm (parity with the editor's play-camera-occlusion
// tuning): when a wall/roof sits between the eye and the player-side pivot, pull
// the eye in to the wall's near side instead of clipping through it.
pub const CAMERA_SPRING_MIN_DISTANCE_METERS: f32 = 0.7;
pub const CAMERA_SPRING_SKIN_METERS: f32 = 0.14;
pub const CAMERA_SPRING_SWEEP_RADIUS_METERS: f32 = 0.08;
pub const PLAYER_WALK_SPEED_METERS_PER_SECOND: f32 = 4.5;
pub const PLAYER_RUN_SPEED_METERS_PER_SECOND: f32 = 8.0;
pub const PLAYER_RADIUS_METERS: f32 = 0.42;
pub const PLAYER_HEIGHT_METERS: f32 = 1.9;
pub const PLAYER_STEP_HEIGHT_METERS: f32 = 0.42;
pub const PLAYER_WALL_RESTITUTION: f32 = 0.0;
pub const PLAYER_SURFACE_FRICTION: f32 = 0.55;
pub const PLAYER_SURFACE_RESTITUTION: f32 = 0.0;
pub const PLAYER_ACCELERATION_MULTIPLIER: f32 = 1.0;
pub const PLAYER_GRAVITY_METERS_PER_SECOND2: f32 = 10.0;
pub const PLAYER_JUMP_SPEED_METERS_PER_SECOND: f32 = 5.2;
pub const WALKABLE_SIDE_PUSH_GRACE_METERS: f32 = 0.08;
pub const PHYSICS_SOLID_HEIGHT_METERS: f32 = PLAYER_STEP_HEIGHT_METERS + 0.05;
pub const RAMP_SLAB_THICKNESS_METERS: f32 = 0.2;
pub const RAMP_SLAB_THICKNESS_RATIO: f32 = RAMP_SLAB_THICKNESS_METERS / 3.0;
pub const RAMP_HEIGHTFIELD_CELL_METERS: f32 = 0.6;
pub const RAMP_WALKABLE_SLOPE_COS: f32 = 0.6;
pub const PLAYER_WALK_CYCLES_PER_SECOND: f32 = 1.6;
pub const PLAYER_RUN_CYCLES_PER_SECOND: f32 = 2.3;
pub const PLAYER_CLIP_IDLE: u32 = 0;
pub const PLAYER_CLIP_WALK: u32 = 1;
pub const PLAYER_CLIP_JUMP: u32 = 2;
// PROPUSE req_0624 — the seat poses (compile/playerModel.ts CLIP.sit/lay).
pub const PLAYER_CLIP_SIT: u32 = 3;
pub const PLAYER_CLIP_LAY: u32 = 4;
pub const MAX_EMBEDDED_LOADERS: usize = 8;

// ── prop interaction (PROPUSE req_0624) — parity with /test's interact frame
// (cart/hmsc-int/editors/play/PlayRoute.tsx): same reach, same cancel radius,
// same prompt grammar, driven by the INTERACTABLES lump instead of a JS scan.
pub const SCAN_E: usize = 8;
pub const SCAN_P: usize = 19; // [traffic-paths req_2072] toggle the route-debug ribbon
pub const INTERACT_REACH_METERS: f32 = 2.2;
pub const INTERACT_Y_WINDOW_METERS: f32 = 2.5;
pub const INTERACT_SEARCH_CANCEL_MOVE_METERS: f32 = 0.35;
pub const INTERACT_NOTICE_SECONDS: f32 = 3.2;
// req_0674: the reach gate — the E ray starts at the standing chest/eye line
// and aims at the candidate's mid-body; a THIN solid collider crossing it
// (wall slab, closed door panel, window strip) kills the prompt. Props are
// chunkier than the thickness cap in both plan extents, so a candidate's own
// collider never blocks it. Mirrors PlayRoute.tsx's editor-side gate.
pub const INTERACT_EYE_HEIGHT_METERS: f32 = 1.4;
pub const INTERACT_PROP_AIM_HEIGHT_METERS: f32 = 0.9;
pub const INTERACT_BLOCKER_MAX_THICKNESS_METERS: f32 = 0.5;

// ── elevators (req_0652) — parity with /test's ride (PlayRoute.tsx): the car
// is a LIVE rect in the physics buffer, re-aimed in place per frame; E rides
// up a stop per press (wrapping down from the top) or calls the car to a
// landing. Tuning mirrors PLACED_TUNING (game/build/placed.ts) — per-shaft
// speed/thickness travel in the ELEVATORS lump, interaction reach here.
pub const ELEVATOR_ARRIVE_TOLERANCE_METERS: f32 = 0.02;
pub const ELEVATOR_BOARD_REACH_METERS: f32 = 1.2;
pub const ELEVATOR_BOARD_BELOW_METERS: f32 = 0.4;
pub const ELEVATOR_CALL_REACH_METERS: f32 = 2.8;
pub const ELEVATOR_CAR_FRICTION: f32 = 0.85;
pub const ELEVATOR_CAR_RESTITUTION: f32 = 0.02;
// the editor's BUILD_UI.elevatorCarColor look
pub const ELEVATOR_CAR_COLOR = [3]f32{ 0.68, 0.71, 0.75 };

// ── doors (DOORS-0611, req_0654) — /test's two-state door, native: the closed
// panel is a LIVE rect in the physics buffer + a live render node; E within
// the record's reach toggles open/closed (closed blocks body AND eye, open is
// genuinely clear). Per-door reach travels in the DOORS lump (edits.ts is the
// source); the leaf's look mirrors pieceShapes' DOOR_PANEL_COLOR (#0c1018).
pub const DOOR_PANEL_COLOR = [3]f32{ 0.047, 0.063, 0.094 };
pub const DOOR_PANEL_FRICTION: f32 = 0.85;
pub const DOOR_PANEL_RESTITUTION: f32 = 0.02;
/// vertical window around the door base the prompt accepts (player on the
/// same storey, mirrors the interactables Y window)
pub const DOOR_Y_WINDOW_METERS: f32 = 2.5;
/// an OPEN door's node drops here — out of every sightline (no node-hide
/// flag in the kid list)
pub const DOOR_OPEN_HIDE_DROP_METERS: f32 = 4000.0;
/// an OPEN door's rect parks here. Flipping blocksPlayer alone is NOT enough:
/// the host step side-pushes any rect too tall to step onto EVEN when
/// non-solid (physics.zig collideSolidRects — that's what makes walkable
/// platforms push you off their sides), so a de-flagged 2.2m door still
/// blocked the doorway (req_0663). Out of the world = out of every test.
pub const DOOR_OPEN_PARK_METERS: f32 = 1.0e9;
