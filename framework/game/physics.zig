//! framework/game/physics.zig — the game's host-side physics sim (V1).
//!
//! ONE coherent system: player locomotion (via framework/game/movement.zig,
//! V7), gravity, collision against flat axis-aligned rects, yawed oriented
//! rects, and bilinear heightfield terrain, plus the spawned-entity sphere
//! sim. Graduated out of framework/v8_bindings_physics_lab.zig (2026-06);
//! that file keeps only the __physics_lab_* toy world. The V8 registrar for
//! THIS module is framework/v8_bindings_game_physics.zig, which preserves the
//! host-fn names cart JS grew up with (__hmsc_physics_step etc.).
//!
//! The bridge contract (repo revealed preference): cross the JS↔host bridge
//! ONCE per frame with a packed f32 buffer rather than maintain per-body node
//! bindings to a general engine.
//!
//! Input buffer (f32):
//!   [0]  dt                      [13] rect count
//!   [1]  move x                  [14] gravity
//!   [2]  move z                  [15] jump speed
//!   [3]  speed                   [16] player radius
//!   [4]  jump down (>0.5)        [17] player height
//!   [5..7]  player x,y,z         [18] wall restitution
//!   [8..10] player vx,vy,vz      [19] body restitution (player→body kick)
//!   [11] walkable rect side-push grace
//!                                [20] step height
//!   [12] entity count            [21] acceleration multiplier
//!                                [22] player surface friction
//!                                [23] player surface restitution
//!                                [24] oriented rect count
//!   then entity_count × ENTITY_FLOATS  [x,y,z,vx,vy,vz,r,restitution]
//!   then rect_count   × RECT_FLOATS    (see below)
//!   then oriented_count × ORIENTED_FLOATS
//!
//! Output snapshot (f32):
//!   [0] host µs (stamped by the registrar) · [1..3] player x,y,z ·
//!   [4..6] player vx,vy,vz · [7] grounded · [8] entity count ·
//!   then entity_count × ENTITY_FLOATS [x,y,z,vx,vy,vz,r,grounded]
//!
//! Pure math — no V8, no SDL, no engine import. Behavior-tested in
//! framework/testing/unit/game_physics.zig.

const std = @import("std");
pub const movement = @import("movement.zig");
pub const mesh_collision = @import("mesh_collision.zig");

pub const MAX_ENTITIES: usize = 128;
// 16384: a built-out city (hand-placed walls + floor plates) overran the old
// 4096 — placedPieceColliders alone hit ~4928 on a real map, so the tail of
// recently-built structures silently lost collision (you walked through them).
// The only static buffer keyed to this is g_camera_occlusion_rect_values
// (~720KB at 16384), so the headroom is cheap. The per-step cost is the ACTUAL
// rect count, not the cap, so unused headroom is free.
pub const MAX_RECTS: usize = 16384;
// 16384 (was 256): every prop now bakes a footprint collider, and a quarter-turn
// prop still rides the ORIENTED lane (off-center/non-square footprints orbit the
// pivot under yaw). A built-out map crossed 256 oriented (~300 on a real city),
// so the tail of props silently lost collision — same walk-through-the-tail bug
// that forced MAX_RECTS up from 4096. Matched to MAX_RECTS: the only static
// buffer keyed to this is g_camera_occlusion_oriented_values (~850KB at 16384),
// and the per-step cost is the ACTUAL oriented count, not the cap, so the
// headroom is free. Don't set this low again.
pub const MAX_ORIENTED: usize = 16384;
pub const INPUT_HEADER_FLOATS: usize = 25;
pub const ENTITY_FLOATS: usize = 8;
// A rect is [minX, minZ, maxX, maxZ, top, solid, friction, restitution, floor].
// `floor` (index 8) is the BOTTOM of the solid band: the rect blocks horizontally
// only while the body overlaps [floor, top], so a thin platform (floor = top −
// thickness) is solid to stand ON yet open to walk UNDER — the primitive that
// makes stacked parking decks, overpasses, and mezzanines possible. A normal wall
// passes floor = −∞ so it stays solid to the ground exactly as before.
// Standing-on-top is unchanged (the top + step-height gate already only grounds
// you when your feet are within a step of the top, so a deck overhead never
// snaps a player on the floor below up onto it).
pub const RECT_FLOATS: usize = 9;
// An oriented rect: the same 9-float AABB in the building's OWN un-rotated frame,
// then [pivotX, pivotZ, yawRadians]. The sim tests a point by rotating it into
// that frame about the pivot (inverse of the mesh's +Y yaw) and reusing the AABB
// math; a push is rotated back out. yaw 0 would be identical to an AABB rect, so
// only rotated buildings are sent here (state/hostPhysics.ts physicsOrientedRects).
pub const ORIENTED_FLOATS: usize = 12;
pub const OUTPUT_HEADER_FLOATS: usize = 9;
pub const OUTPUT_FLOATS: usize = OUTPUT_HEADER_FLOATS + MAX_ENTITIES * ENTITY_FLOATS;

// Camera occlusion query: same rect dialect as the physics step, plus one
// owner id per rect so JS can map host hits back to placed pieces.
pub const CAMERA_OCCLUSION_HEADER_FLOATS: usize = 10;
pub const CAMERA_OCCLUSION_RECT_FLOATS: usize = RECT_FLOATS + 1;
pub const CAMERA_OCCLUSION_ORIENTED_FLOATS: usize = ORIENTED_FLOATS + 1;
pub const MAX_CAMERA_OCCLUSION_HITS: usize = 64;
pub const CAMERA_OCCLUSION_OUTPUT_FLOATS: usize = 4 + MAX_CAMERA_OCCLUSION_HITS;
// Wire sentinel for a collider band that extends down without a finite underside.
// A non-solid row carrying this value is terrain/ground, not overhead geometry.
pub const SOLID_TO_GROUND_FLOOR_METERS: f32 = -1e9;
// Exact mesh props retain their coarse boxes for broadphase, the spring-arm
// camera, and dynamic bodies. Player contact alone skips this sentinel because
// the exact triangle narrowphase owns that response.
pub const EXACT_MESH_COARSE_SOLID_FLAG: f32 = -1;
// req_0938: a heightfield whose surface sits more than this ABOVE the camera
// pivot is a CEILING/ROOF the player is under — it must not cap the spring-arm
// eye (the rek when you walk under a roof a storey-plus overhead). Heightfields
// are floors-you-stand-on; only those at/below ~head height cap the camera.
pub const CAMERA_HEIGHTFIELD_CEILING_CLEARANCE_METERS: f32 = 1.0;

pub const CameraOcclusionConfiguredHit = struct {
    nearest_target_distance: f32 = 0,
    nearest_owner: f32 = 0,
};

// ── Heightfield colliders ──────────────────────────────────────────────
// A generic terrain collider: a cols×rows grid of corner heights the sim
// samples bilinearly to get the ground under a point, plus a per-field walk
// slope cosine. Surfaces flatter than the limit (normal.y >= walk_cos) are
// walkable ground you stand on; steeper ones are walls you can't ascend. The
// sim knows ZERO shapes — TS bakes the grid (a cone, a carved trail, anything)
// the same way it bakes a Heightfield mesh, registers it once via
// __hmsc_register_heightfield, and the step samples it every frame. This is what
// makes hit detection follow a real slope instead of a stack of flat boxes.
// 64 slots × HF_MAX_SAMPLES f32 = ~4 MB of static memory — negligible for a
// desktop binary (one tile texture dwarfs it), and the per-frame step only samples
// ACTIVE fields, so an empty slot is free. Headroom for many heightfield-floored
// structures (garages, ramps, overpasses) on top of the terrain landforms.
// One slot per WALKABLE FIELD: every painted relief chunk, every ramp/stair slope,
// and every flat piece-floor field. A normal authored city mixes all three and blows
// far past a 64-slot budget (a 240² map measured ~70: 20 relief chunks + 32 ramp/stair
// fields + flat floors). Overflow is doubly bad — the dropped fields are unwalkable
// stairs (no collision under the steps), AND the overflow used to flip the whole map
// into instance-derived collider WINDOWING, which re-derives floors as solid-to-ground
// boxes (invisible walls under upper floors/roofs). Sized generously so real maps fit
// without truncation; each slot is HF_MAX_SAMPLES f32 (~64KB), so 256 ≈ 16MB of BSS.
pub const MAX_HEIGHTFIELDS: usize = 256;
// Must fit hmsc-int's tile-resolution painted chunks: one collider sample per tile,
// 121×121 = 14,641 over a 120-tile chunk (mesh and collider share the field, so
// see-it==walk-it). The old 8192 cap rejected that whole field — count >
// HF_MAX_SAMPLES registers NO collider, so a tile-res painted chunk would have
// rendered but had no collision (walk straight through it).
pub const HF_MAX_SAMPLES: usize = 16384; // up to a 127×127 grid (121×121 = 14,641 fits)

const Heightfield = struct {
    active: bool = false,
    origin_x: f32 = 0, // world position of sample (0,0)
    origin_z: f32 = 0,
    cell: f32 = 1, // world meters between samples
    cols: usize = 0,
    rows: usize = 0,
    base_y: f32 = 0, // world Y the stored heights are measured above
    walk_cos: f32 = 1, // cos(slope limit): normal.y >= this ⇒ walkable
    // Rotation of the grid about (pivot_x, pivot_z), radians +Y. 0 = axis-aligned
    // (mountains/hills/painted terrain). A rotated building's heightfield floor (a
    // parking garage) sets these so the ramp you walk follows the rotated model.
    yaw: f32 = 0,
    pivot_x: f32 = 0,
    pivot_z: f32 = 0,
    samples: [HF_MAX_SAMPLES]f32 = [_]f32{0} ** HF_MAX_SAMPLES,
};

pub const HeightfieldDesc = struct {
    id: usize,
    origin_x: f32,
    origin_z: f32,
    cell: f32,
    cols: usize,
    rows: usize,
    base_y: f32,
    walk_cos: f32,
    yaw: f32 = 0,
    pivot_x: f32 = 0,
    pivot_z: f32 = 0,
};

var g_heightfields: [MAX_HEIGHTFIELDS]Heightfield = [_]Heightfield{.{}} ** MAX_HEIGHTFIELDS;
var g_snapshot: [OUTPUT_FLOATS]f32 = undefined;
var g_camera_occlusion: [CAMERA_OCCLUSION_OUTPUT_FLOATS]f32 = undefined;
var g_camera_occlusion_rect_values: [MAX_RECTS * CAMERA_OCCLUSION_RECT_FLOATS]f32 = [_]f32{0} ** (MAX_RECTS * CAMERA_OCCLUSION_RECT_FLOATS);
var g_camera_occlusion_oriented_values: [MAX_ORIENTED * CAMERA_OCCLUSION_ORIENTED_FLOATS]f32 = [_]f32{0} ** (MAX_ORIENTED * CAMERA_OCCLUSION_ORIENTED_FLOATS);
var g_camera_occlusion_rect_count: usize = 0;
var g_camera_occlusion_oriented_count: usize = 0;

// --- Stair / locomotion diagnostic (RJIT_STAIRLOG=1) ---
// The compiled game is no-V8: JS console.log never runs there. To prove the
// "hold W, walk into an invisible wall at the top of a staircase" report we log
// the locomotion step directly from the Zig sim. Gated behind RJIT_STAIRLOG so
// it costs nothing in normal play; set the env var and the player's intent vs.
// the actual horizontal delta — and WHICH branch zeroed the move — prints per
// frame while they walk. The application root resolves environment settings
// once through configureDiagnostics; the physics hot path never reaches into
// process-global state.
var g_stairlog_enabled = false;
var g_stairlog_frame: u64 = 0;

fn stairlogOn() bool {
    return g_stairlog_enabled;
}

// --- Collider diagnostic (RJIT_COLLIDERLOG=1) ---
// "I walk right through the props/trees in the compiled game." Same no-V8 reason
// as the stairlog: prove it from the Zig sim. Per frame the player moves (or
// stands inside a collider), print how many solid colliders are LOADED and how
// many the player capsule currently OVERLAPS, plus the side-push that fired.
//   inside=0 next to a visible prop  → NO collider was baked for it (a bake bug).
//   inside>0 while push≈0 and moving → a collider exists but isn't stopping you
//                                       (a resolution/band bug) — tagged THROUGH.
var g_colliderlog_enabled = false;
var g_colliderlog_tick: u64 = 0;

fn colliderlogOn() bool {
    return g_colliderlog_enabled;
}

fn environmentFlag(environ: *const std.process.Environ.Map, name: []const u8) bool {
    const value = environ.get(name) orelse return false;
    return value.len > 0 and value[0] != '0';
}

/// Resolve optional diagnostics at an application boundary. This deliberately
/// converts environment capability access into plain configuration before any
/// per-frame physics work begins.
pub fn configureDiagnostics(environ: *const std.process.Environ.Map) void {
    g_stairlog_enabled = environmentFlag(environ, "RJIT_STAIRLOG");
    g_colliderlog_enabled = environmentFlag(environ, "RJIT_COLLIDERLOG");
}

/// Count the SOLID colliders whose band + XZ footprint the player capsule
/// overlaps — the same band test (feet<top, head>floor) and circle-vs-AABB the
/// side-push uses, oriented rects un-rotated about their pivot first. `nearest_out`
/// gets the distance to the nearest overlapped edge (−1 when none).
fn playerSolidOverlaps(rects: []const f32, oriented: []const f32, px: f32, py: f32, pz: f32, radius: f32, height: f32, nearest_out: *f32) u32 {
    var count: u32 = 0;
    var nearest2: f32 = 1e30;
    const feet = py;
    const head = py + height;
    var r: usize = 0;
    while (r + RECT_FLOATS <= rects.len) : (r += RECT_FLOATS) {
        if (rects[r + 5] <= 0.5) continue; // solid only
        if (feet >= rects[r + 4] or head <= bandFloor(rects[r + 8])) continue; // band miss
        const ex = px - clamp(px, rects[r], rects[r + 2]);
        const ez = pz - clamp(pz, rects[r + 1], rects[r + 3]);
        const d2 = ex * ex + ez * ez;
        if (d2 <= radius * radius) {
            count += 1;
            if (d2 < nearest2) nearest2 = d2;
        }
    }
    var o: usize = 0;
    while (o + ORIENTED_FLOATS <= oriented.len) : (o += ORIENTED_FLOATS) {
        if (oriented[o + 5] <= 0.5) continue;
        if (feet >= oriented[o + 4] or head <= bandFloor(oriented[o + 8])) continue;
        const cs = @cos(oriented[o + 11]);
        const sn = @sin(oriented[o + 11]);
        var lx: f32 = undefined;
        var lz: f32 = undefined;
        worldToLocal(px, pz, oriented[o + 9], oriented[o + 10], cs, sn, &lx, &lz);
        const ex = lx - clamp(lx, oriented[o], oriented[o + 2]);
        const ez = lz - clamp(lz, oriented[o + 1], oriented[o + 3]);
        const d2 = ex * ex + ez * ez;
        if (d2 <= radius * radius) {
            count += 1;
            if (d2 < nearest2) nearest2 = d2;
        }
    }
    nearest_out.* = if (nearest2 >= 1e30) -1 else @sqrt(nearest2);
    return count;
}

/// RJIT_COLLIDERLOG detail: print every collider whose XZ footprint the player
/// stands in (solid OR not), with its band vs the player's feet/head — so the
/// WRONG collider is obvious at a glance:
///   UNDER  = its floor is above your head — you SHOULD pass beneath it (a roof /
///            the sign's beam). If you're blocked while it says UNDER, the band
///            skip isn't firing; if it says BLOCKS with band=(0.00..tall), the
///            piece was baked solid-to-ground instead of as a high band.
///   BLOCKS = its band straddles you (a real wall — correct).
///   solid={} = a non-solid prop (foliage/flower) should be solid=false; solid=true
///            on a flower is a bake bug. Capped at 6 so a dense spot can't flood.
fn colliderlogDump(rects: []const f32, oriented: []const f32, px: f32, py: f32, pz: f32, radius: f32, height: f32) void {
    const feet = py;
    const head = py + height;
    std.debug.print("    player feet={d:.2} head={d:.2}\n", .{ feet, head });
    var shown: u32 = 0;
    var r: usize = 0;
    while (r + RECT_FLOATS <= rects.len and shown < 6) : (r += RECT_FLOATS) {
        const ex = px - clamp(px, rects[r], rects[r + 2]);
        const ez = pz - clamp(pz, rects[r + 1], rects[r + 3]);
        if (ex * ex + ez * ez > radius * radius) continue;
        const floor = bandFloor(rects[r + 8]);
        const rel = if (head <= floor) "UNDER" else if (feet >= rects[r + 4]) "ABOVE" else "BLOCKS";
        std.debug.print("    rect#{d} foot=({d:.1},{d:.1}..{d:.1},{d:.1}) band=({d:.2}..{d:.2}) solid={} {s}\n", .{ r / RECT_FLOATS, rects[r], rects[r + 1], rects[r + 2], rects[r + 3], floor, rects[r + 4], rects[r + 5] > 0.5, rel });
        shown += 1;
    }
    var o: usize = 0;
    while (o + ORIENTED_FLOATS <= oriented.len and shown < 6) : (o += ORIENTED_FLOATS) {
        const cs = @cos(oriented[o + 11]);
        const sn = @sin(oriented[o + 11]);
        var lx: f32 = undefined;
        var lz: f32 = undefined;
        worldToLocal(px, pz, oriented[o + 9], oriented[o + 10], cs, sn, &lx, &lz);
        const ex = lx - clamp(lx, oriented[o], oriented[o + 2]);
        const ez = lz - clamp(lz, oriented[o + 1], oriented[o + 3]);
        if (ex * ex + ez * ez > radius * radius) continue;
        const floor = bandFloor(oriented[o + 8]);
        const rel = if (head <= floor) "UNDER" else if (feet >= oriented[o + 4]) "ABOVE" else "BLOCKS";
        std.debug.print("    orient#{d} foot=({d:.1},{d:.1}..{d:.1},{d:.1}) band=({d:.2}..{d:.2}) solid={} {s}\n", .{ o / ORIENTED_FLOATS, oriented[o], oriented[o + 1], oriented[o + 2], oriented[o + 3], floor, oriented[o + 4], oriented[o + 5] > 0.5, rel });
        shown += 1;
    }
}

fn clamp(n: f32, a: f32, b: f32) f32 {
    return @max(a, @min(b, n));
}

fn bandFloor(raw: f32) f32 {
    return if (std.math.isFinite(raw)) raw else -1000000;
}

/// Whether a collider has a real underside. Thin walkable floors carry a finite
/// band even when their `solid` flag is false (that flag controls player SIDE
/// push); unbounded ground/walls use the wire sentinel instead.
fn hasFiniteUnderside(raw_floor: f32) bool {
    return std.math.isFinite(raw_floor) and raw_floor > SOLID_TO_GROUND_FLOOR_METERS;
}

/// Player collision and camera occlusion have different meanings for the rect
/// `solid` flag. A thin floor is non-solid so its sides do not push the player,
/// but its finite vertical band must still stop a camera passing through it.
/// Unbounded non-solid ground rows stay out of the spring-arm query; terrain has
/// its own heightfield occlusion path.
fn blocksCamera(blocks_player: f32, raw_floor: f32) bool {
    return blocks_player > 0.5 or hasFiniteUnderside(raw_floor);
}

/// Upload/replace a terrain grid by id. Called once when a landform loads
/// (the grid is static), then referenced every frame by the step. Heights are
/// stored above base_y, row-major (iz*cols + ix). `samples_bytes` is the raw
/// f32 payload (a possibly-unaligned ArrayBuffer view — byte-copied here).
/// Returns false (registering nothing) on a malformed descriptor.
pub fn registerHeightfield(desc: HeightfieldDesc, samples_bytes: []const u8) bool {
    if (desc.id >= MAX_HEIGHTFIELDS) return false;
    const count = desc.cols * desc.rows;
    if (count < 4 or count > HF_MAX_SAMPLES or desc.cell <= 0) return false;
    if (samples_bytes.len < count * @sizeOf(f32)) return false;
    var hf = &g_heightfields[desc.id];
    hf.origin_x = desc.origin_x;
    hf.origin_z = desc.origin_z;
    hf.cell = desc.cell;
    hf.cols = desc.cols;
    hf.rows = desc.rows;
    hf.base_y = desc.base_y;
    hf.walk_cos = desc.walk_cos;
    hf.yaw = desc.yaw;
    hf.pivot_x = desc.pivot_x;
    hf.pivot_z = desc.pivot_z;
    // Byte copy (the source view may be unaligned) into the sample store.
    const dst_bytes = std.mem.sliceAsBytes(hf.samples[0..count]);
    @memcpy(dst_bytes, samples_bytes[0 .. count * @sizeOf(f32)]);
    hf.active = true;
    return true;
}

/// Drop one terrain grid without disturbing unrelated baked/world fields.
/// Painted-map slots occupy a reserved id range and use this on document
/// replacement; clearing the entire table would make authored ramps vanish.
pub fn unregisterHeightfield(id: usize) void {
    if (id < MAX_HEIGHTFIELDS) g_heightfields[id].active = false;
}

/// Drop all registered terrain (world reset / cart swap). TS re-registers
/// what the new world needs.
pub fn clearHeightfields() void {
    for (&g_heightfields) |*hf| hf.active = false;
}

// A world XZ point rotated into an oriented rect's local (un-rotated) frame —
// the inverse of the mesh's +Y yaw about the pivot. `cs`/`sn` are cos/sin(yaw);
// the inverse rotation is [[cs, -sn],[sn, cs]] applied to (point - pivot). Matches
// render3d/buildingTransform.ts (whose local→world offset is its transpose).
fn worldToLocal(x: f32, z: f32, pivot_x: f32, pivot_z: f32, cs: f32, sn: f32, out_x: *f32, out_z: *f32) void {
    const dx = x - pivot_x;
    const dz = z - pivot_z;
    out_x.* = pivot_x + cs * dx - sn * dz;
    out_z.* = pivot_z + sn * dx + cs * dz;
}

// The reverse: a local point/push back to world (forward +Y yaw), [[cs, sn],[-sn, cs]].
fn localToWorld(x: f32, z: f32, pivot_x: f32, pivot_z: f32, cs: f32, sn: f32, out_x: *f32, out_z: *f32) void {
    const dx = x - pivot_x;
    const dz = z - pivot_z;
    out_x.* = pivot_x + cs * dx + sn * dz;
    out_z.* = pivot_z - sn * dx + cs * dz;
}

fn segmentSlabAxis(origin: f32, dir: f32, raw_min: f32, raw_max: f32, t0: *f32, t1: *f32) bool {
    const min_v = @min(raw_min, raw_max);
    const max_v = @max(raw_min, raw_max);
    if (@abs(dir) < 0.000001) return origin >= min_v and origin <= max_v;
    var near = (min_v - origin) / dir;
    var far = (max_v - origin) / dir;
    if (near > far) {
        const tmp = near;
        near = far;
        far = tmp;
    }
    t0.* = @max(t0.*, near);
    t1.* = @min(t1.*, far);
    return t0.* <= t1.*;
}

fn segmentHitsAabb(
    ox: f32,
    oy: f32,
    oz: f32,
    dx: f32,
    dy: f32,
    dz: f32,
    min_x: f32,
    min_y: f32,
    min_z: f32,
    max_x: f32,
    max_y: f32,
    max_z: f32,
) bool {
    var t0: f32 = 0;
    var t1: f32 = 1;
    if (!segmentSlabAxis(ox, dx, min_x, max_x, &t0, &t1)) return false;
    if (!segmentSlabAxis(oy, dy, min_y, max_y, &t0, &t1)) return false;
    if (!segmentSlabAxis(oz, dz, min_z, max_z, &t0, &t1)) return false;
    return true;
}

fn segmentAabbEntryT(
    ox: f32,
    oy: f32,
    oz: f32,
    dx: f32,
    dy: f32,
    dz: f32,
    min_x: f32,
    min_y: f32,
    min_z: f32,
    max_x: f32,
    max_y: f32,
    max_z: f32,
) ?f32 {
    var t0: f32 = 0;
    var t1: f32 = 1;
    if (!segmentSlabAxis(ox, dx, min_x, max_x, &t0, &t1)) return null;
    if (!segmentSlabAxis(oy, dy, min_y, max_y, &t0, &t1)) return null;
    if (!segmentSlabAxis(oz, dz, min_z, max_z, &t0, &t1)) return null;
    return clamp(t0, 0, 1);
}

/// The segment's [entry, exit] fractions through the AABB (camera→pivot order,
/// so entry is the camera-facing face and exit is the pivot-facing face). The
/// spring-arm needs the EXIT: a wall is a box with thickness, so pulling to the
/// entry leaves the camera inside the wall — pull past the exit to clear it.
fn segmentAabbSpan(
    ox: f32,
    oy: f32,
    oz: f32,
    dx: f32,
    dy: f32,
    dz: f32,
    min_x: f32,
    min_y: f32,
    min_z: f32,
    max_x: f32,
    max_y: f32,
    max_z: f32,
) ?[2]f32 {
    var t0: f32 = 0;
    var t1: f32 = 1;
    if (!segmentSlabAxis(ox, dx, min_x, max_x, &t0, &t1)) return null;
    if (!segmentSlabAxis(oy, dy, min_y, max_y, &t0, &t1)) return null;
    if (!segmentSlabAxis(oz, dz, min_z, max_z, &t0, &t1)) return null;
    return .{ clamp(t0, 0, 1), clamp(t1, 0, 1) };
}

fn addCameraOcclusionHit(owner: f32, max_hits: usize, entry_t: f32, segment_len: f32) void {
    if (owner <= 0) return;
    const target_distance = segment_len * (1.0 - clamp(entry_t, 0, 1));
    if (g_camera_occlusion[2] <= 0 or target_distance > g_camera_occlusion[2]) {
        g_camera_occlusion[2] = target_distance;
        g_camera_occlusion[3] = owner;
    }
    var count: usize = @trunc(g_camera_occlusion[1]);
    var i: usize = 0;
    while (i < count) : (i += 1) {
        if (g_camera_occlusion[4 + i] == owner) return;
    }
    if (count >= max_hits or count >= MAX_CAMERA_OCCLUSION_HITS) return;
    g_camera_occlusion[4 + count] = owner;
    count += 1;
    g_camera_occlusion[1] = @floatFromInt(count);
}

fn clearCameraOcclusionOutput() void {
    var clear_i: usize = 0;
    while (clear_i < g_camera_occlusion.len) : (clear_i += 1) {
        g_camera_occlusion[clear_i] = 0;
    }
}

fn cameraOcclusionRectValue(index: usize) f32 {
    return g_camera_occlusion_rect_values[index];
}

fn cameraOcclusionOrientedValue(index: usize) f32 {
    return g_camera_occlusion_oriented_values[index];
}

fn storeCameraOcclusionRectValue(index: usize, value: f32) void {
    g_camera_occlusion_rect_values[index] = value;
}

fn storeCameraOcclusionOrientedValue(index: usize, value: f32) void {
    g_camera_occlusion_oriented_values[index] = value;
}

fn scanCameraOcclusion(
    ox: f32,
    oy: f32,
    oz: f32,
    tx: f32,
    ty: f32,
    tz: f32,
    rects: []const f32,
    rect_count: usize,
    oriented: []const f32,
    oriented_count: usize,
    requested_hits: usize,
    sweep_radius: f32,
) ?[]f32 {
    clearCameraOcclusionOutput();
    const dx = tx - ox;
    const dy = ty - oy;
    const dz = tz - oz;
    if (!std.math.isFinite(dx) or !std.math.isFinite(dy) or !std.math.isFinite(dz)) return null;
    const segment_len = @sqrt(dx * dx + dy * dy + dz * dz);
    if (segment_len <= 0.0001) return g_camera_occlusion[0..CAMERA_OCCLUSION_OUTPUT_FLOATS];
    const max_hits = @min(MAX_CAMERA_OCCLUSION_HITS, if (requested_hits == 0) MAX_CAMERA_OCCLUSION_HITS else requested_hits);
    const radius = if (std.math.isFinite(sweep_radius)) @max(@as(f32, 0), sweep_radius) else 0;

    var r: usize = 0;
    while (r < rect_count) : (r += 1) {
        const at = r * CAMERA_OCCLUSION_RECT_FLOATS;
        if (rects[at + 5] <= 0.5) continue;
        if (segmentAabbEntryT(
            ox,
            oy,
            oz,
            dx,
            dy,
            dz,
            rects[at] - radius,
            bandFloor(rects[at + 8]) - radius,
            rects[at + 1] - radius,
            rects[at + 2] + radius,
            rects[at + 4] + radius,
            rects[at + 3] + radius,
        )) |entry_t| {
            addCameraOcclusionHit(rects[at + RECT_FLOATS], max_hits, entry_t, segment_len);
        }
    }

    var o: usize = 0;
    while (o < oriented_count) : (o += 1) {
        const at = o * CAMERA_OCCLUSION_ORIENTED_FLOATS;
        if (oriented[at + 5] <= 0.5) continue;
        const yaw = oriented[at + 11];
        const cs = @cos(yaw);
        const sn = @sin(yaw);
        var lo_x: f32 = undefined;
        var lo_z: f32 = undefined;
        var lt_x: f32 = undefined;
        var lt_z: f32 = undefined;
        worldToLocal(ox, oz, oriented[at + 9], oriented[at + 10], cs, sn, &lo_x, &lo_z);
        worldToLocal(tx, tz, oriented[at + 9], oriented[at + 10], cs, sn, &lt_x, &lt_z);
        if (segmentAabbEntryT(
            lo_x,
            oy,
            lo_z,
            lt_x - lo_x,
            dy,
            lt_z - lo_z,
            oriented[at] - radius,
            bandFloor(oriented[at + 8]) - radius,
            oriented[at + 1] - radius,
            oriented[at + 2] + radius,
            oriented[at + 4] + radius,
            oriented[at + 3] + radius,
        )) |entry_t| {
            addCameraOcclusionHit(oriented[at + ORIENTED_FLOATS], max_hits, entry_t, segment_len);
        }
    }

    return g_camera_occlusion[0..CAMERA_OCCLUSION_OUTPUT_FLOATS];
}

/// Upload wall-class camera occluders once when the placed-piece set changes.
/// Per-frame camera queries then reuse this host-side scene instead of repacking
/// the same rect arrays across the JS bridge every render frame. Input buffer:
/// [rectCount, orientedCount], then rects and oriented rects in the same payload
/// dialect as `cameraOcclusion`.
pub fn configureCameraOcclusion(input: []const f32) bool {
    if (input.len < 2) return false;
    const rect_count: usize = @trunc(@max(@as(f32, 0), input[0]));
    const oriented_count: usize = @trunc(@max(@as(f32, 0), input[1]));
    if (rect_count > MAX_RECTS or oriented_count > MAX_ORIENTED) return false;
    const rect_base = 2;
    const oriented_base = rect_base + rect_count * CAMERA_OCCLUSION_RECT_FLOATS;
    const required = oriented_base + oriented_count * CAMERA_OCCLUSION_ORIENTED_FLOATS;
    if (input.len < required) return false;

    const rect_values = rect_count * CAMERA_OCCLUSION_RECT_FLOATS;
    var rv: usize = 0;
    while (rv < rect_values) : (rv += 1) {
        storeCameraOcclusionRectValue(rv, input[rect_base + rv]);
    }
    const oriented_values = oriented_count * CAMERA_OCCLUSION_ORIENTED_FLOATS;
    var ov: usize = 0;
    while (ov < oriented_values) : (ov += 1) {
        storeCameraOcclusionOrientedValue(ov, input[oriented_base + ov]);
    }
    g_camera_occlusion_rect_count = rect_count;
    g_camera_occlusion_oriented_count = oriented_count;
    return true;
}

pub fn cameraOcclusionConfiguredHit(
    camera_x: f32,
    camera_y: f32,
    camera_z: f32,
    target_x: f32,
    target_y: f32,
    target_z: f32,
    sweep_radius: f32,
    out: *CameraOcclusionConfiguredHit,
) bool {
    out.* = .{};
    const dx = target_x - camera_x;
    const dy = target_y - camera_y;
    const dz = target_z - camera_z;
    if (!std.math.isFinite(dx) or !std.math.isFinite(dy) or !std.math.isFinite(dz)) return false;
    const segment_len = @sqrt(dx * dx + dy * dy + dz * dz);
    if (segment_len <= 0.0001) return true;
    const radius = if (std.math.isFinite(sweep_radius)) @max(@as(f32, 0), sweep_radius) else 0;
    var nearest_target_distance: f32 = 0;
    var nearest_owner: f32 = 0;

    var r: usize = 0;
    while (r < g_camera_occlusion_rect_count) : (r += 1) {
        const at = r * CAMERA_OCCLUSION_RECT_FLOATS;
        if (cameraOcclusionRectValue(at + 5) <= 0.5) continue;
        if (segmentAabbEntryT(
            camera_x,
            camera_y,
            camera_z,
            dx,
            dy,
            dz,
            cameraOcclusionRectValue(at) - radius,
            bandFloor(cameraOcclusionRectValue(at + 8)) - radius,
            cameraOcclusionRectValue(at + 1) - radius,
            cameraOcclusionRectValue(at + 2) + radius,
            cameraOcclusionRectValue(at + 4) + radius,
            cameraOcclusionRectValue(at + 3) + radius,
        )) |entry_t| {
            const target_distance = segment_len * (1.0 - clamp(entry_t, 0, 1));
            if (nearest_target_distance <= 0 or target_distance > nearest_target_distance) {
                nearest_target_distance = target_distance;
                nearest_owner = cameraOcclusionRectValue(at + RECT_FLOATS);
            }
        }
    }

    var o: usize = 0;
    while (o < g_camera_occlusion_oriented_count) : (o += 1) {
        const at = o * CAMERA_OCCLUSION_ORIENTED_FLOATS;
        if (cameraOcclusionOrientedValue(at + 5) <= 0.5) continue;
        const yaw = cameraOcclusionOrientedValue(at + 11);
        const cs = @cos(yaw);
        const sn = @sin(yaw);
        var lo_x: f32 = undefined;
        var lo_z: f32 = undefined;
        var lt_x: f32 = undefined;
        var lt_z: f32 = undefined;
        worldToLocal(camera_x, camera_z, cameraOcclusionOrientedValue(at + 9), cameraOcclusionOrientedValue(at + 10), cs, sn, &lo_x, &lo_z);
        worldToLocal(target_x, target_z, cameraOcclusionOrientedValue(at + 9), cameraOcclusionOrientedValue(at + 10), cs, sn, &lt_x, &lt_z);
        if (segmentAabbEntryT(
            lo_x,
            camera_y,
            lo_z,
            lt_x - lo_x,
            dy,
            lt_z - lo_z,
            cameraOcclusionOrientedValue(at) - radius,
            bandFloor(cameraOcclusionOrientedValue(at + 8)) - radius,
            cameraOcclusionOrientedValue(at + 1) - radius,
            cameraOcclusionOrientedValue(at + 2) + radius,
            cameraOcclusionOrientedValue(at + 4) + radius,
            cameraOcclusionOrientedValue(at + 3) + radius,
        )) |entry_t| {
            const target_distance = segment_len * (1.0 - clamp(entry_t, 0, 1));
            if (nearest_target_distance <= 0 or target_distance > nearest_target_distance) {
                nearest_target_distance = target_distance;
                nearest_owner = cameraOcclusionOrientedValue(at + ORIENTED_FLOATS);
            }
        }
    }

    out.nearest_target_distance = nearest_target_distance;
    out.nearest_owner = nearest_owner;
    return true;
}

pub fn cameraOcclusionConfiguredHitOutput(
    camera_x: f32,
    camera_y: f32,
    camera_z: f32,
    target_x: f32,
    target_y: f32,
    target_z: f32,
    sweep_radius: f32,
) ?[]f32 {
    var hit: CameraOcclusionConfiguredHit = .{};
    if (!cameraOcclusionConfiguredHit(
        camera_x,
        camera_y,
        camera_z,
        target_x,
        target_y,
        target_z,
        sweep_radius,
        &hit,
    )) return null;
    clearCameraOcclusionOutput();
    g_camera_occlusion[1] = hit.nearest_target_distance;
    g_camera_occlusion[2] = hit.nearest_owner;
    return g_camera_occlusion[0..CAMERA_OCCLUSION_OUTPUT_FLOATS];
}

/// Full-list variant of the configured hit: scans the stored occluder scene and
/// returns EVERY owner whose band the camera→target segment crosses (not just the
/// nearest), in the same output dialect as `cameraOcclusion`
/// ([_, count, nearestTargetDistance, nearestOwner, owner0, owner1, ...]). The
/// interior third-person camera fades all of these so the player stays visible
/// inside a building; the nearest still drives the distance pull-in. Reuses the
/// same per-hit machinery (`addCameraOcclusionHit`) as the array-fed scan.
pub fn cameraOcclusionConfiguredHits(
    camera_x: f32,
    camera_y: f32,
    camera_z: f32,
    target_x: f32,
    target_y: f32,
    target_z: f32,
    sweep_radius: f32,
    requested_hits: usize,
) ?[]f32 {
    clearCameraOcclusionOutput();
    const dx = target_x - camera_x;
    const dy = target_y - camera_y;
    const dz = target_z - camera_z;
    if (!std.math.isFinite(dx) or !std.math.isFinite(dy) or !std.math.isFinite(dz)) return null;
    const segment_len = @sqrt(dx * dx + dy * dy + dz * dz);
    if (segment_len <= 0.0001) return g_camera_occlusion[0..CAMERA_OCCLUSION_OUTPUT_FLOATS];
    const max_hits = @min(MAX_CAMERA_OCCLUSION_HITS, if (requested_hits == 0) MAX_CAMERA_OCCLUSION_HITS else requested_hits);
    const radius = if (std.math.isFinite(sweep_radius)) @max(@as(f32, 0), sweep_radius) else 0;

    var r: usize = 0;
    while (r < g_camera_occlusion_rect_count) : (r += 1) {
        const at = r * CAMERA_OCCLUSION_RECT_FLOATS;
        if (cameraOcclusionRectValue(at + 5) <= 0.5) continue;
        if (segmentAabbEntryT(
            camera_x,
            camera_y,
            camera_z,
            dx,
            dy,
            dz,
            cameraOcclusionRectValue(at) - radius,
            bandFloor(cameraOcclusionRectValue(at + 8)) - radius,
            cameraOcclusionRectValue(at + 1) - radius,
            cameraOcclusionRectValue(at + 2) + radius,
            cameraOcclusionRectValue(at + 4) + radius,
            cameraOcclusionRectValue(at + 3) + radius,
        )) |entry_t| {
            addCameraOcclusionHit(cameraOcclusionRectValue(at + RECT_FLOATS), max_hits, entry_t, segment_len);
        }
    }

    var o: usize = 0;
    while (o < g_camera_occlusion_oriented_count) : (o += 1) {
        const at = o * CAMERA_OCCLUSION_ORIENTED_FLOATS;
        if (cameraOcclusionOrientedValue(at + 5) <= 0.5) continue;
        const yaw = cameraOcclusionOrientedValue(at + 11);
        const cs = @cos(yaw);
        const sn = @sin(yaw);
        var lo_x: f32 = undefined;
        var lo_z: f32 = undefined;
        var lt_x: f32 = undefined;
        var lt_z: f32 = undefined;
        worldToLocal(camera_x, camera_z, cameraOcclusionOrientedValue(at + 9), cameraOcclusionOrientedValue(at + 10), cs, sn, &lo_x, &lo_z);
        worldToLocal(target_x, target_z, cameraOcclusionOrientedValue(at + 9), cameraOcclusionOrientedValue(at + 10), cs, sn, &lt_x, &lt_z);
        if (segmentAabbEntryT(
            lo_x,
            camera_y,
            lo_z,
            lt_x - lo_x,
            dy,
            lt_z - lo_z,
            cameraOcclusionOrientedValue(at) - radius,
            bandFloor(cameraOcclusionOrientedValue(at + 8)) - radius,
            cameraOcclusionOrientedValue(at + 1) - radius,
            cameraOcclusionOrientedValue(at + 2) + radius,
            cameraOcclusionOrientedValue(at + 4) + radius,
            cameraOcclusionOrientedValue(at + 3) + radius,
        )) |entry_t| {
            addCameraOcclusionHit(cameraOcclusionOrientedValue(at + ORIENTED_FLOATS), max_hits, entry_t, segment_len);
        }
    }

    return g_camera_occlusion[0..CAMERA_OCCLUSION_OUTPUT_FLOATS];
}

/// Spring-arm distance for a third-person camera, queried against the SAME
/// packed collider buffer the physics step consumes (`step_input`). The no-V8
/// compiled-game loader has no V8 occlusion door, so it reuses this to collide
/// its camera with authored walls and finite-height platform bands exactly like
/// the editor's JS spring-arm.
/// Rects start at INPUT_HEADER_FLOATS (the loader builds no entity section),
/// oriented rects follow. Returns the distance from `pivot` to the nearest band's
/// PIVOT-FACING face (its far side, accounting for box thickness) — i.e. the
/// farthest the eye may sit and still be clear of every band (0 = clear). The
/// caller pulls the eye in to `result - skin`.
pub fn cameraOcclusionStepColliders(
    step_input: []const f32,
    rect_count: usize,
    oriented_count: usize,
    cam_x: f32,
    cam_y: f32,
    cam_z: f32,
    pivot_x: f32,
    pivot_y: f32,
    pivot_z: f32,
    sweep_radius: f32,
) f32 {
    const dx = pivot_x - cam_x;
    const dy = pivot_y - cam_y;
    const dz = pivot_z - cam_z;
    if (!std.math.isFinite(dx) or !std.math.isFinite(dy) or !std.math.isFinite(dz)) return 0;
    const segment_len = @sqrt(dx * dx + dy * dy + dz * dz);
    if (segment_len <= 0.0001) return 0;
    const radius = if (std.math.isFinite(sweep_radius)) @max(@as(f32, 0), sweep_radius) else 0;
    const rect_base = INPUT_HEADER_FLOATS;
    const oriented_base = rect_base + rect_count * RECT_FLOATS;
    if (step_input.len < oriented_base + oriented_count * ORIENTED_FLOATS) return 0;
    // The eye is clear of EVERY wall on the segment when it sits closer to the
    // pivot than the nearest wall's pivot-facing (exit) face. A wall is a box
    // with thickness, so we take the EXIT (span[1]), not the entry — pulling to
    // the entry leaves the eye inside the wall box (clipping its inner half).
    // Aggregate by the SMALLEST inner-face distance so a wall near the player
    // wins over the outer shell.
    var clear: f32 = -1;

    var r: usize = 0;
    while (r < rect_count) : (r += 1) {
        const at = rect_base + r * RECT_FLOATS;
        if (!blocksCamera(step_input[at + 5], step_input[at + 8])) continue;
        if (segmentAabbSpan(
            cam_x,
            cam_y,
            cam_z,
            dx,
            dy,
            dz,
            step_input[at] - radius,
            bandFloor(step_input[at + 8]) - radius,
            step_input[at + 1] - radius,
            step_input[at + 2] + radius,
            step_input[at + 4] + radius,
            step_input[at + 3] + radius,
        )) |span| {
            const inner_face = segment_len * (1.0 - span[1]);
            if (clear < 0 or inner_face < clear) clear = inner_face;
        }
    }

    var o: usize = 0;
    while (o < oriented_count) : (o += 1) {
        const at = oriented_base + o * ORIENTED_FLOATS;
        if (!blocksCamera(step_input[at + 5], step_input[at + 8])) continue;
        const yaw = step_input[at + 11];
        const cs = @cos(yaw);
        const sn = @sin(yaw);
        var lo_x: f32 = undefined;
        var lo_z: f32 = undefined;
        var lt_x: f32 = undefined;
        var lt_z: f32 = undefined;
        worldToLocal(cam_x, cam_z, step_input[at + 9], step_input[at + 10], cs, sn, &lo_x, &lo_z);
        worldToLocal(pivot_x, pivot_z, step_input[at + 9], step_input[at + 10], cs, sn, &lt_x, &lt_z);
        if (segmentAabbSpan(
            lo_x,
            cam_y,
            lo_z,
            lt_x - lo_x,
            dy,
            lt_z - lo_z,
            step_input[at] - radius,
            bandFloor(step_input[at + 8]) - radius,
            step_input[at + 1] - radius,
            step_input[at + 2] + radius,
            step_input[at + 4] + radius,
            step_input[at + 3] + radius,
        )) |span| {
            const inner_face = segment_len * (1.0 - span[1]);
            if (clear < 0 or inner_face < clear) clear = inner_face;
        }
    }

    return if (clear < 0) 0 else clear;
}

/// req_0674 — the compiled game's interact REACH gate: true when a THIN solid
/// collider crosses the eye→target segment. Thin solid boxes are the wall
/// family (wall slabs, CLOSED door panels, window strips — an open door
/// already dropped its solid flag), while props are chunky in both plan
/// extents, so a candidate's own body never reads as an obstruction. A box
/// containing the target point itself (the door panel being aimed at) is
/// skipped explicitly, so doors stay interactable from both of their sides.
/// Same packed step_input wire as the spring-arm above (rects at
/// INPUT_HEADER_FLOATS, oriented rects after).
pub fn reachBlockedStepColliders(
    step_input: []const f32,
    rect_count: usize,
    oriented_count: usize,
    eye_x: f32,
    eye_y: f32,
    eye_z: f32,
    target_x: f32,
    target_y: f32,
    target_z: f32,
    max_blocker_thickness: f32,
) bool {
    return reachBlockedStepCollidersExceptRect(
        step_input,
        rect_count,
        oriented_count,
        eye_x,
        eye_y,
        eye_z,
        target_x,
        target_y,
        target_z,
        max_blocker_thickness,
        null,
    );
}

/// Door-aware reach query. `skip_rect_index` identifies the candidate door's
/// own moving panel in the packed RECT section, so that panel cannot hide its
/// close/open prompt after swinging away from the closed-position target.
/// Every other thin wall remains an occluder.
pub fn reachBlockedStepCollidersExceptRect(
    step_input: []const f32,
    rect_count: usize,
    oriented_count: usize,
    eye_x: f32,
    eye_y: f32,
    eye_z: f32,
    target_x: f32,
    target_y: f32,
    target_z: f32,
    max_blocker_thickness: f32,
    skip_rect_index: ?usize,
) bool {
    const dx = target_x - eye_x;
    const dy = target_y - eye_y;
    const dz = target_z - eye_z;
    if (!std.math.isFinite(dx) or !std.math.isFinite(dy) or !std.math.isFinite(dz)) return false;
    if (dx * dx + dy * dy + dz * dz <= 0.0001) return false;
    const rect_base = INPUT_HEADER_FLOATS;
    const oriented_base = rect_base + rect_count * RECT_FLOATS;
    if (step_input.len < oriented_base + oriented_count * ORIENTED_FLOATS) return false;

    var r: usize = 0;
    while (r < rect_count) : (r += 1) {
        if (skip_rect_index != null and r == skip_rect_index.?) continue;
        const at = rect_base + r * RECT_FLOATS;
        if (step_input[at + 5] <= 0.5) continue; // solid only
        const min_x = step_input[at];
        const min_z = step_input[at + 1];
        const max_x = step_input[at + 2];
        const max_z = step_input[at + 3];
        const top = step_input[at + 4];
        const floor = bandFloor(step_input[at + 8]);
        if (@min(max_x - min_x, max_z - min_z) > max_blocker_thickness) continue; // walls are thin
        const contains_target = target_x >= min_x and target_x <= max_x and target_z >= min_z and target_z <= max_z and target_y >= floor and target_y <= top;
        if (contains_target) continue;
        if (segmentAabbSpan(eye_x, eye_y, eye_z, dx, dy, dz, min_x, floor, min_z, max_x, top, max_z) != null) return true;
    }

    var o: usize = 0;
    while (o < oriented_count) : (o += 1) {
        const at = oriented_base + o * ORIENTED_FLOATS;
        if (step_input[at + 5] <= 0.5) continue;
        const min_u = step_input[at];
        const min_v = step_input[at + 1];
        const max_u = step_input[at + 2];
        const max_v = step_input[at + 3];
        const top = step_input[at + 4];
        const floor = bandFloor(step_input[at + 8]);
        if (@min(max_u - min_u, max_v - min_v) > max_blocker_thickness) continue;
        const yaw = step_input[at + 11];
        const cs = @cos(yaw);
        const sn = @sin(yaw);
        var le_x: f32 = undefined;
        var le_z: f32 = undefined;
        var lt_x: f32 = undefined;
        var lt_z: f32 = undefined;
        worldToLocal(eye_x, eye_z, step_input[at + 9], step_input[at + 10], cs, sn, &le_x, &le_z);
        worldToLocal(target_x, target_z, step_input[at + 9], step_input[at + 10], cs, sn, &lt_x, &lt_z);
        const contains_target = lt_x >= min_u and lt_x <= max_u and lt_z >= min_v and lt_z <= max_v and target_y >= floor and target_y <= top;
        if (contains_target) continue;
        if (segmentAabbSpan(le_x, eye_y, le_z, lt_x - le_x, dy, lt_z - le_z, min_u, floor, min_v, max_u, top, max_v) != null) return true;
    }
    return false;
}

/// Spring-arm against the terrain/ramp HEIGHTFIELDS (a separate collider type
/// from the rect buffer — sampled, not box-tested). Marches the camera→pivot
/// segment and returns the distance from the pivot at which the terrain first
/// rises into the line of sight (0 = clear) — catching both a hill that blocks
/// the view and the eye sitting inside a slope. The caller takes the min of this
/// and the wall/roof result, then pulls the eye to `cap - skin`.
pub fn cameraOcclusionHeightfields(
    cam_x: f32,
    cam_y: f32,
    cam_z: f32,
    pivot_x: f32,
    pivot_y: f32,
    pivot_z: f32,
    sweep_radius: f32,
) f32 {
    var any = false;
    for (&g_heightfields) |*hf| {
        if (hf.active) {
            any = true;
            break;
        }
    }
    if (!any) return 0;
    const dx = cam_x - pivot_x;
    const dy = cam_y - pivot_y;
    const dz = cam_z - pivot_z;
    if (!std.math.isFinite(dx) or !std.math.isFinite(dy) or !std.math.isFinite(dz)) return 0;
    const segment_len = @sqrt(dx * dx + dy * dy + dz * dz);
    if (segment_len <= 0.0001) return 0;
    const margin = if (std.math.isFinite(sweep_radius)) @max(@as(f32, 0), sweep_radius) else 0;
    // Bounded march from the pivot OUTWARD toward the eye: the first sample whose
    // terrain rises to within `margin` of the segment caps the eye there. Smooth
    // terrain won't slip between ~0.5 m samples; the count is clamped [8, 64].
    const steps_f = @max(@as(f32, 8), @min(@as(f32, 64), segment_len / 0.5));
    const steps: usize = @trunc(steps_f);
    var i: usize = 1;
    while (i <= steps) : (i += 1) {
        const s = @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(steps)); // 0 at pivot → 1 at eye
        const sx = pivot_x + dx * s;
        const sy = pivot_y + dy * s;
        const sz = pivot_z + dz * s;
        const surf = heightfieldSurfaceAt(sx, sz) orelse continue;
        // A surface well above the player-side pivot is a ceiling/roof the
        // player is UNDER — skip it, or it caps the eye right at the pivot and
        // slams the camera into the player (req_0938). Floors (≤ ~head height)
        // still cap so the eye never clips down through the ground/a ramp.
        if (surf.height > pivot_y + CAMERA_HEIGHTFIELD_CEILING_CLEARANCE_METERS) continue;
        if (surf.height + margin >= sy) return segment_len * s;
    }
    return 0;
}

pub fn cameraOcclusionConfiguredDistance(
    camera_x: f32,
    camera_y: f32,
    camera_z: f32,
    target_x: f32,
    target_y: f32,
    target_z: f32,
    sweep_radius: f32,
) ?f32 {
    var hit: CameraOcclusionConfiguredHit = .{};
    if (!cameraOcclusionConfiguredHit(
        camera_x,
        camera_y,
        camera_z,
        target_x,
        target_y,
        target_z,
        sweep_radius,
        &hit,
    )) return null;
    return hit.nearest_target_distance;
}

/// Camera→player visibility query against the same flat/oriented solid bands
/// the host physics step already consumes. Input buffer:
/// [camera x,y,z, target x,y,z, rectCount, orientedCount, maxHits, sweepRadius],
/// then rectCount × (RECT_FLOATS + ownerId), then orientedCount ×
/// (ORIENTED_FLOATS + ownerId). Output:
/// [hostUs, hitCount, nearestTargetDistance, nearestOwnerId, ownerId...].
pub fn cameraOcclusion(input: []const f32) ?[]f32 {
    if (input.len < CAMERA_OCCLUSION_HEADER_FLOATS) return null;
    const ox = input[0];
    const oy = input[1];
    const oz = input[2];
    const tx = input[3];
    const ty = input[4];
    const tz = input[5];
    const rect_count: usize = @trunc(@max(@as(f32, 0), input[6]));
    const oriented_count: usize = @trunc(@max(@as(f32, 0), input[7]));
    const requested_hits: usize = @trunc(@max(@as(f32, 0), input[8]));
    const sweep_radius = if (std.math.isFinite(input[9])) @max(@as(f32, 0), input[9]) else 0;
    const max_hits = @min(MAX_CAMERA_OCCLUSION_HITS, if (requested_hits == 0) MAX_CAMERA_OCCLUSION_HITS else requested_hits);
    if (rect_count > MAX_RECTS or oriented_count > MAX_ORIENTED) return null;
    const rect_base = CAMERA_OCCLUSION_HEADER_FLOATS;
    const oriented_base = rect_base + rect_count * CAMERA_OCCLUSION_RECT_FLOATS;
    const required = oriented_base + oriented_count * CAMERA_OCCLUSION_ORIENTED_FLOATS;
    if (input.len < required) return null;

    clearCameraOcclusionOutput();
    const dx = tx - ox;
    const dy = ty - oy;
    const dz = tz - oz;
    if (!std.math.isFinite(dx) or !std.math.isFinite(dy) or !std.math.isFinite(dz)) return null;
    const segment_len = @sqrt(dx * dx + dy * dy + dz * dz);
    if (segment_len <= 0.0001) return g_camera_occlusion[0..CAMERA_OCCLUSION_OUTPUT_FLOATS];

    var r: usize = 0;
    while (r < rect_count) : (r += 1) {
        const at = rect_base + r * CAMERA_OCCLUSION_RECT_FLOATS;
        if (input[at + 5] <= 0.5) continue;
        if (segmentAabbEntryT(
            ox,
            oy,
            oz,
            dx,
            dy,
            dz,
            input[at] - sweep_radius,
            bandFloor(input[at + 8]) - sweep_radius,
            input[at + 1] - sweep_radius,
            input[at + 2] + sweep_radius,
            input[at + 4] + sweep_radius,
            input[at + 3] + sweep_radius,
        )) |entry_t| {
            addCameraOcclusionHit(input[at + RECT_FLOATS], max_hits, entry_t, segment_len);
        }
    }

    var o: usize = 0;
    while (o < oriented_count) : (o += 1) {
        const at = oriented_base + o * CAMERA_OCCLUSION_ORIENTED_FLOATS;
        if (input[at + 5] <= 0.5) continue;
        const yaw = input[at + 11];
        const cs = @cos(yaw);
        const sn = @sin(yaw);
        var lo_x: f32 = undefined;
        var lo_z: f32 = undefined;
        var lt_x: f32 = undefined;
        var lt_z: f32 = undefined;
        worldToLocal(ox, oz, input[at + 9], input[at + 10], cs, sn, &lo_x, &lo_z);
        worldToLocal(tx, tz, input[at + 9], input[at + 10], cs, sn, &lt_x, &lt_z);
        if (segmentAabbEntryT(
            lo_x,
            oy,
            lo_z,
            lt_x - lo_x,
            dy,
            lt_z - lo_z,
            input[at] - sweep_radius,
            bandFloor(input[at + 8]) - sweep_radius,
            input[at + 1] - sweep_radius,
            input[at + 2] + sweep_radius,
            input[at + 4] + sweep_radius,
            input[at + 3] + sweep_radius,
        )) |entry_t| {
            addCameraOcclusionHit(input[at + ORIENTED_FLOATS], max_hits, entry_t, segment_len);
        }
    }

    return g_camera_occlusion[0..CAMERA_OCCLUSION_OUTPUT_FLOATS];
}

// Bilinear height of one heightfield at (x,z), in stored units (above base_y).
// null when (x,z) is outside the grid.
fn rawHeight(hf: *const Heightfield, x: f32, z: f32) ?f32 {
    if (hf.cols < 2 or hf.rows < 2 or hf.cell <= 0) return null;
    // A rotated grid (a turned parking garage's floor) is sampled in its own
    // un-rotated frame: rotate the query point into local coords about the pivot.
    // The returned height (above base_y) and the Y-normal are rotation-invariant,
    // so only the sample coordinate moves. Axis-aligned grids skip this.
    var qx = x;
    var qz = z;
    if (hf.yaw != 0) {
        worldToLocal(x, z, hf.pivot_x, hf.pivot_z, @cos(hf.yaw), @sin(hf.yaw), &qx, &qz);
    }
    const fx = (qx - hf.origin_x) / hf.cell;
    const fz = (qz - hf.origin_z) / hf.cell;
    if (fx < 0 or fz < 0) return null;
    const fxi = @floor(fx);
    const fzi = @floor(fz);
    const ix: usize = @trunc(fxi);
    const iz: usize = @trunc(fzi);
    if (ix + 1 >= hf.cols or iz + 1 >= hf.rows) return null;
    const tx = fx - fxi;
    const tz = fz - fzi;
    const h00 = hf.samples[iz * hf.cols + ix];
    const h10 = hf.samples[iz * hf.cols + ix + 1];
    const h01 = hf.samples[(iz + 1) * hf.cols + ix];
    const h11 = hf.samples[(iz + 1) * hf.cols + ix + 1];
    const h0 = h00 + (h10 - h00) * tx;
    const h1 = h01 + (h11 - h01) * tx;
    return h0 + (h1 - h0) * tz;
}

pub const HfSurface = struct { height: f32, normal_y: f32, walk_cos: f32 };

fn heightfieldSurface(hf: *const Heightfield, x: f32, z: f32) ?HfSurface {
    const raw = rawHeight(hf, x, z) orelse return null;
    const h = hf.base_y + raw;
    const e = hf.cell;
    const hx0 = rawHeight(hf, x - e, z) orelse raw;
    const hx1 = rawHeight(hf, x + e, z) orelse raw;
    const hz0 = rawHeight(hf, x, z - e) orelse raw;
    const hz1 = rawHeight(hf, x, z + e) orelse raw;
    const dhdx = (hx1 - hx0) / (2 * e);
    const dhdz = (hz1 - hz0) / (2 * e);
    const ny = 1.0 / @sqrt(dhdx * dhdx + 1.0 + dhdz * dhdz);
    return .{ .height = h, .normal_y = ny, .walk_cos = hf.walk_cos };
}

fn clampUphillSurfaceSpeed(vx: *f32, vz: *f32, x: f32, z: f32, y: f32, step_height: f32, dt: f32, surface: HfSurface, max_surface_speed: f32) void {
    if (max_surface_speed <= 0) return;
    const horizontal_speed = @sqrt(vx.* * vx.* + vz.* * vz.*);
    if (horizontal_speed <= 0.001) return;
    const next_x = x + vx.* * dt;
    const next_z = z + vz.* * dt;
    const next_surface = heightfieldGroundSurfaceAt(next_x, next_z, y, step_height) orelse return;
    if (next_surface.height <= surface.height) return;
    // Cap uphill speed by the surface GRADIENT (its up-normal), NOT by a finite
    // difference over the player's own displacement. The old form divided the
    // height rise by horizontal_speed*dt — so as the clamp slowed the player the
    // *same* rise read as an ever-steeper slope, clamping harder: a positive-
    // feedback death spiral that pinned the player at a stair crest (a tiny top-
    // step lip, read as near-vertical, froze them with full forward intent —
    // RJIT_STAIRLOG showed integ=2.4 collapsing to clamp=0.01). normal_y already
    // encodes the true grade independent of speed: a surface with up-normal ny
    // admits at most max_surface_speed*ny of horizontal travel (ny→1 flat = no
    // cap; ny small = steep = slow), and it never collapses to zero, so a walk
    // DOWN a staircase crest stays smooth.
    const ny = clamp(next_surface.normal_y, 0.05, 1);
    const max_horizontal = max_surface_speed * ny;
    if (horizontal_speed <= max_horizontal) return;
    const scale = max_horizontal / horizontal_speed;
    vx.* *= scale;
    vz.* *= scale;
}

/// The highest registered-heightfield surface under (x,z), with its up-normal.
/// This remains public for diagnostics/tests. Ground support below intentionally
/// uses heightfieldFloorAt instead: an overhead ramp must not hide the terrain
/// heightfield the player is actually standing on.
pub fn heightfieldSurfaceAt(x: f32, z: f32) ?HfSurface {
    var best: ?HfSurface = null;
    for (&g_heightfields) |*hf| {
        if (!hf.active) continue;
        const s = heightfieldSurface(hf, x, z) orelse continue;
        if (best == null or s.height > best.?.height) best = s;
    }
    return best;
}

pub fn heightfieldGroundSurfaceAt(x: f32, z: f32, current_y: f32, step_height: f32) ?HfSurface {
    var best: ?HfSurface = null;
    for (&g_heightfields) |*hf| {
        if (!hf.active) continue;
        const s = heightfieldSurface(hf, x, z) orelse continue;
        if (s.normal_y >= s.walk_cos and s.height <= current_y + step_height) {
            if (best == null or s.height > best.?.height) best = s;
        }
    }
    return best;
}

// Ground SUPPORT under the feet, SLOPE-AGNOSTIC. Stands the player on the
// highest heightfield mesh surface at/below the feet (within a step) no matter
// how steep it is — a basin wall, a dug-pool rim, a cone face all hold you up so
// you never fall THROUGH the mesh. The slope LIMIT (can you CLIMB onto it / gain
// height) is enforced separately: the move-cancel wall-block in step() reverts a
// horizontal move into a too-steep face that rises ABOVE the feet, and the
// walkable-only heightfieldGroundSurfaceAt drives speed clamping + wall grace.
// Before this, steep cells returned NO support, so walking onto the steep wall of
// a painted water basin (or any heightfield edge) dropped you into the void.
fn heightfieldFloorSurfaceAt(x: f32, z: f32, current_y: f32, step_height: f32) ?HfSurface {
    var best: ?HfSurface = null;
    for (&g_heightfields) |*hf| {
        if (!hf.active) continue;
        const s = heightfieldSurface(hf, x, z) orelse continue;
        if (s.height <= current_y + step_height) {
            if (best == null or s.height > best.?.height) best = s;
        }
    }
    return best;
}

fn heightfieldFloorAt(x: f32, z: f32, current_y: f32, step_height: f32) f32 {
    return if (heightfieldFloorSurfaceAt(x, z, current_y, step_height)) |s| s.height else -1000000;
}

fn heightfieldSlopeGroundAt(x: f32, z: f32, current_y: f32, step_height: f32) bool {
    return if (heightfieldGroundSurfaceAt(x, z, current_y, step_height)) |s| s.normal_y < 1.0 else false;
}

fn groundAt(rects: []const f32, oriented: []const f32, x: f32, z: f32, current_y: f32, step_height: f32, skip_exact_mesh_coarse: bool) f32 {
    var ground_y: f32 = -1000000;
    var at: usize = 0;
    while (at + RECT_FLOATS <= rects.len) : (at += RECT_FLOATS) {
        if (skip_exact_mesh_coarse and rects[at + 5] == EXACT_MESH_COARSE_SOLID_FLAG) continue;
        // Solid rects (walls, props) ARE standable tops, not just side blockers.
        // The step-height gate below keeps a tall wall from counting as ground at
        // its base (its top is far above current_y + step), so it only becomes
        // ground once you're actually on it — hop onto a hydrant and stand. The
        // side push (collideSolidRects) still blocks you while your feet are
        // below the top, so "bump from the side, stand from above" both hold.
        if (x >= rects[at] and x <= rects[at + 2] and z >= rects[at + 1] and z <= rects[at + 3]) {
            const rect_height = rects[at + 4];
            if (rect_height <= current_y + step_height) ground_y = @max(ground_y, rect_height);
        }
    }
    // Oriented walls: rotate the foot point into each rect's frame, same test.
    var o: usize = 0;
    while (o + ORIENTED_FLOATS <= oriented.len) : (o += ORIENTED_FLOATS) {
        if (skip_exact_mesh_coarse and oriented[o + 5] == EXACT_MESH_COARSE_SOLID_FLAG) continue;
        const yaw = oriented[o + 11];
        var lx: f32 = undefined;
        var lz: f32 = undefined;
        worldToLocal(x, z, oriented[o + 9], oriented[o + 10], @cos(yaw), @sin(yaw), &lx, &lz);
        if (lx >= oriented[o] and lx <= oriented[o + 2] and lz >= oriented[o + 1] and lz <= oriented[o + 3]) {
            const rect_height = oriented[o + 4];
            if (rect_height <= current_y + step_height) ground_y = @max(ground_y, rect_height);
        }
    }
    return ground_y;
}

fn surfaceValueAt(rects: []const f32, oriented: []const f32, x: f32, z: f32, current_y: f32, step_height: f32, value_offset: usize, fallback: f32) f32 {
    var ground_y: f32 = -1000000;
    var value = fallback;
    var at: usize = 0;
    while (at + RECT_FLOATS <= rects.len) : (at += RECT_FLOATS) {
        // Mirror groundAt: solids are standable, so when you rest on a prop's
        // top its friction/restitution (rect[6]/rect[7]) is the surface you read,
        // not the fallback. Same step-height gate keeps wall bases out.
        if (x >= rects[at] and x <= rects[at + 2] and z >= rects[at + 1] and z <= rects[at + 3]) {
            const rect_height = rects[at + 4];
            if (rect_height <= current_y + step_height and rect_height >= ground_y) {
                ground_y = rect_height;
                value = rects[at + value_offset];
            }
        }
    }
    var o: usize = 0;
    while (o + ORIENTED_FLOATS <= oriented.len) : (o += ORIENTED_FLOATS) {
        const yaw = oriented[o + 11];
        var lx: f32 = undefined;
        var lz: f32 = undefined;
        worldToLocal(x, z, oriented[o + 9], oriented[o + 10], @cos(yaw), @sin(yaw), &lx, &lz);
        if (lx >= oriented[o] and lx <= oriented[o + 2] and lz >= oriented[o + 1] and lz <= oriented[o + 3]) {
            const rect_height = oriented[o + 4];
            if (rect_height <= current_y + step_height and rect_height >= ground_y) {
                ground_y = rect_height;
                value = oriented[o + value_offset];
            }
        }
    }
    return value;
}

fn collideCircleRect(x: *f32, z: *f32, vx: *f32, vz: *f32, radius: f32, rect: []const f32, restitution: f32) bool {
    const closest_x = clamp(x.*, rect[0], rect[2]);
    const closest_z = clamp(z.*, rect[1], rect[3]);
    var dx = x.* - closest_x;
    var dz = z.* - closest_z;
    var d = @sqrt(dx * dx + dz * dz);
    if (d >= radius) return false;
    if (d < 0.0001) {
        const side_x = @min(@abs(x.* - rect[0]), @abs(rect[2] - x.*));
        const side_z = @min(@abs(z.* - rect[1]), @abs(rect[3] - z.*));
        if (side_x < side_z) {
            dx = if (x.* < (rect[0] + rect[2]) * 0.5) -1 else 1;
            dz = 0;
        } else {
            dx = 0;
            dz = if (z.* < (rect[1] + rect[3]) * 0.5) -1 else 1;
        }
        d = 1;
    }
    const nx = dx / d;
    const nz = dz / d;
    const push = radius - d;
    x.* += nx * push;
    z.* += nz * push;
    const into = vx.* * nx + vz.* * nz;
    if (into < 0) {
        vx.* -= (1 + restitution) * into * nx;
        vz.* -= (1 + restitution) * into * nz;
    }
    return true;
}

const COLLIDER_TOP_SIDE_CLEARANCE_METERS: f32 = 0.04;

/// Whether the player's vertical capsule span intersects a collider's solid
/// band closely enough to require horizontal side-push. This is deliberately
/// relative to the collider band: negative world elevations (underwater basins,
/// tunnels, basements) obey the same collision law as elevations above Y=0.
fn bodyOverlapsColliderBand(feet_y: f32, height: f32, floor_y: f32, top_y: f32) bool {
    return feet_y < top_y - COLLIDER_TOP_SIDE_CLEARANCE_METERS and feet_y + height > floor_y;
}

fn collideSolidRects(x: *f32, y: f32, z: *f32, vx: *f32, vz: *f32, radius: f32, height: f32, rects: []const f32, oriented: []const f32, restitution: f32, step_height: f32, walkable_side_push_grace: f32, skip_exact_mesh_coarse: bool) void {
    var at: usize = 0;
    while (at + RECT_FLOATS <= rects.len) : (at += RECT_FLOATS) {
        const exact_mesh_coarse = rects[at + 5] == EXACT_MESH_COARSE_SOLID_FLAG;
        if (skip_exact_mesh_coarse and exact_mesh_coarse) continue;
        const solid = rects[at + 5] > 0.5 or exact_mesh_coarse;
        const rect_height = rects[at + 4];
        const rect_floor = rects[at + 8];
        const too_tall_to_step = rect_height > y + step_height;
        if (!solid and !too_tall_to_step) continue;
        // Banded solid: skip side-push above the top or entirely below the
        // floor. The comparison is collider-relative; world Y=0 is not sea
        // level to generic physics and must not disable submerged collision.
        if (!bodyOverlapsColliderBand(y, height, rect_floor, rect_height)) continue;
        const finite_floor_band = rect_floor > -100000;
        const grace_walkable = walkable_side_push_grace > 0 and finite_floor_band and rect_height <= y + step_height and y >= rect_floor - walkable_side_push_grace;
        // req_0742: slope_walkable skips the side-push so descending a slope/stairs
        // doesn't shove you off the low ramp-edge platforms — but it MUST only apply
        // to rects you could actually step ONTO. Without the `rect_height <= y +
        // step_height` guard (the one grace_walkable already has), a TALL finite-
        // floor wall (finite so it doesn't block lower storeys) gets its side-push
        // skipped whenever you stand on any heightfield slope. With painted terrain
        // the whole ground is a heightfield, so every wall stopped blocking. Guard it.
        const slope_walkable = finite_floor_band and rect_height <= y + step_height and heightfieldSlopeGroundAt(x.*, z.*, y, step_height);
        if (grace_walkable or slope_walkable) continue;
        _ = collideCircleRect(x, z, vx, vz, radius, rects[at .. at + RECT_FLOATS], restitution);
    }
    // Oriented walls (yawed buildings): rotate the body + its velocity into the
    // rect's frame, run the SAME AABB push there, then rotate the result back to
    // world. The first 9 floats are the AABB the push reads; [9..12] are pivot+yaw.
    var o: usize = 0;
    while (o + ORIENTED_FLOATS <= oriented.len) : (o += ORIENTED_FLOATS) {
        const exact_mesh_coarse = oriented[o + 5] == EXACT_MESH_COARSE_SOLID_FLAG;
        if (skip_exact_mesh_coarse and exact_mesh_coarse) continue;
        const solid = oriented[o + 5] > 0.5 or exact_mesh_coarse;
        const rect_height = oriented[o + 4];
        const rect_floor = oriented[o + 8];
        const too_tall_to_step = rect_height > y + step_height;
        if (!solid and !too_tall_to_step) continue;
        if (!bodyOverlapsColliderBand(y, height, rect_floor, rect_height)) continue;
        const finite_floor_band = rect_floor > -100000;
        const grace_walkable = walkable_side_push_grace > 0 and finite_floor_band and rect_height <= y + step_height and y >= rect_floor - walkable_side_push_grace;
        // req_0742: slope_walkable skips the side-push so descending a slope/stairs
        // doesn't shove you off the low ramp-edge platforms — but it MUST only apply
        // to rects you could actually step ONTO. Without the `rect_height <= y +
        // step_height` guard (the one grace_walkable already has), a TALL finite-
        // floor wall (finite so it doesn't block lower storeys) gets its side-push
        // skipped whenever you stand on any heightfield slope. With painted terrain
        // the whole ground is a heightfield, so every wall stopped blocking. Guard it.
        const slope_walkable = finite_floor_band and rect_height <= y + step_height and heightfieldSlopeGroundAt(x.*, z.*, y, step_height);
        if (grace_walkable or slope_walkable) continue;
        const pivot_x = oriented[o + 9];
        const pivot_z = oriented[o + 10];
        const yaw = oriented[o + 11];
        const cs = @cos(yaw);
        const sn = @sin(yaw);
        var lx: f32 = undefined;
        var lz: f32 = undefined;
        worldToLocal(x.*, z.*, pivot_x, pivot_z, cs, sn, &lx, &lz);
        var lvx = cs * vx.* - sn * vz.*;
        var lvz = sn * vx.* + cs * vz.*;
        if (collideCircleRect(&lx, &lz, &lvx, &lvz, radius, oriented[o .. o + RECT_FLOATS], restitution)) {
            localToWorld(lx, lz, pivot_x, pivot_z, cs, sn, x, z);
            vx.* = cs * lvx + sn * lvz;
            vz.* = -sn * lvx + cs * lvz;
        }
    }
}

/// The lowest collider underside the player's head would punch through this
/// frame: a finite-floor band whose underside (rect_floor) sits ABOVE the feet
/// but BELOW the head, with the body column inside the footprint. Returns a huge
/// sentinel when the head is clear. Walls (floor = −∞) have no underside and are
/// skipped — they belong to the horizontal side-push, not the vertical bonk.
/// A floor's `solid` flag is deliberately irrelevant here: live walkable slabs
/// disable side-push but remain real ceilings when approached from below.
/// Used for the ceiling head-bonk: a ceiling is just a surface whose normal
/// points down, so the response removes only the INTO-surface (upward) velocity
/// and leaves horizontal momentum intact (Source-style — skim a low hallway at
/// speed instead of getting side-shoved into glitchy jitter).
fn ceilingUndersideAt(rects: []const f32, oriented: []const f32, x: f32, z: f32, radius: f32, feet_y: f32, head_y: f32) f32 {
    var lowest: f32 = 1e30;
    var at: usize = 0;
    while (at + RECT_FLOATS <= rects.len) : (at += RECT_FLOATS) {
        if (rects[at + 5] == EXACT_MESH_COARSE_SOLID_FLAG) continue;
        const rf = rects[at + 8];
        if (!hasFiniteUnderside(rf)) continue;
        if (rf <= feet_y + 0.04 or rf >= head_y) continue; // underside not between feet and head
        if (x + radius < rects[at] or x - radius > rects[at + 2]) continue;
        if (z + radius < rects[at + 1] or z - radius > rects[at + 3]) continue;
        if (rf < lowest) lowest = rf;
    }
    var o: usize = 0;
    while (o + ORIENTED_FLOATS <= oriented.len) : (o += ORIENTED_FLOATS) {
        if (oriented[o + 5] == EXACT_MESH_COARSE_SOLID_FLAG) continue;
        const rf = oriented[o + 8];
        if (!hasFiniteUnderside(rf)) continue;
        if (rf <= feet_y + 0.04 or rf >= head_y) continue;
        const cs = @cos(oriented[o + 11]);
        const sn = @sin(oriented[o + 11]);
        var lx: f32 = undefined;
        var lz: f32 = undefined;
        worldToLocal(x, z, oriented[o + 9], oriented[o + 10], cs, sn, &lx, &lz);
        if (lx + radius < oriented[o] or lx - radius > oriented[o + 2]) continue;
        if (lz + radius < oriented[o + 1] or lz - radius > oriented[o + 3]) continue;
        if (rf < lowest) lowest = rf;
    }
    return lowest;
}

fn resolveSpherePair(a: []f32, b: []f32) void {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var dz = b[2] - a[2];
    var d = @sqrt(dx * dx + dy * dy + dz * dz);
    const min_d = a[6] + b[6];
    if (d >= min_d) return;
    if (d < 0.0001) {
        dx = 1;
        dy = 0;
        dz = 0;
        d = 1;
    }
    const nx = dx / d;
    const ny = dy / d;
    const nz = dz / d;
    const push = (min_d - d) * 0.5;
    a[0] -= nx * push;
    a[1] -= ny * push;
    a[2] -= nz * push;
    b[0] += nx * push;
    b[1] += ny * push;
    b[2] += nz * push;
    const rvx = b[3] - a[3];
    const rvy = b[4] - a[4];
    const rvz = b[5] - a[5];
    const into = rvx * nx + rvy * ny + rvz * nz;
    if (into >= 0) return;
    const impulse = -into * 0.5;
    a[3] -= nx * impulse;
    a[4] -= ny * impulse;
    a[5] -= nz * impulse;
    b[3] += nx * impulse;
    b[4] += ny * impulse;
    b[5] += nz * impulse;
}

/// One frame of the game sim. `input` is the packed f32 buffer described in
/// the module header. Returns the packed snapshot (player header + entities),
/// or null on a malformed buffer. Slot [0] of the snapshot is left at 0 for
/// the registrar to stamp with the host-fn wall time in µs.
pub fn step(input: []const f32) ?[]f32 {
    if (input.len < INPUT_HEADER_FLOATS) return null;

    const dt = clamp(input[0], 0.001, 0.05);
    const move_x = input[1];
    const move_z = input[2];
    const speed = @max(0, input[3]);
    const jump_down = input[4] > 0.5;
    var px = input[5];
    var py = input[6];
    var pz = input[7];
    var pvx = input[8];
    var pvy = input[9];
    var pvz = input[10];
    const entity_count = @min(MAX_ENTITIES, @as(usize, @trunc(@max(0, input[12]))));
    const rect_count = @min(MAX_RECTS, @as(usize, @trunc(@max(0, input[13]))));
    const oriented_count = @min(MAX_ORIENTED, @as(usize, @trunc(@max(0, input[24]))));
    const gravity = @max(0, input[14]);
    const jump_speed = @max(0, input[15]);
    const player_radius = @max(0.05, input[16]);
    const player_height = @max(0.2, input[17]);
    const wall_restitution = clamp(input[18], 0, 1);
    const body_restitution = clamp(input[19], 0, 1); // player→body kick transfer (the capsule-vs-sphere contact below)
    const step_height = @max(0, input[20]);
    const acceleration_multiplier = clamp(input[21], 0.05, 4);
    const player_surface_friction = clamp(input[22], 0, 1);
    const player_surface_restitution = clamp(input[23], 0, 1);

    const walkable_side_push_grace = @max(@as(f32, 0), input[11]);

    const entity_start = INPUT_HEADER_FLOATS;
    const rect_start = entity_start + entity_count * ENTITY_FLOATS;
    const oriented_start = rect_start + rect_count * RECT_FLOATS;
    if (input.len < oriented_start + oriented_count * ORIENTED_FLOATS) return null;
    const rects = input[rect_start .. rect_start + rect_count * RECT_FLOATS];
    const oriented = input[oriented_start .. oriented_start + oriented_count * ORIENTED_FLOATS];

    // V7: the ONE host-side movement integrator, inside the physics step.
    movement.integrateHorizontal(&pvx, &pvz, move_x, move_z, speed, acceleration_multiplier, player_surface_friction, dt);
    // Stairlog: the velocity the integrator produced, BEFORE the uphill speed
    // clamp can scale it. If integ is large but the final move is ~0, the clamp
    // (or a collision) ate it — see the clamp=() column below.
    const integ_vx = pvx;
    const integ_vz = pvz;

    // Ground support = highest of the rect floor and the heightfield mesh under
    // the feet. The terrain holds you up at ANY slope (a steep face is still
    // ground, not a hole) — the slope limit only governs whether you can CLIMB
    // it, enforced by the move-cancel wall-block after the move, not by dropping
    // the surface from support here (that was the basin-wall fall-through bug).
    var player_ground_y = groundAt(rects, oriented, px, pz, py, step_height, true);
    player_ground_y = @max(player_ground_y, heightfieldFloorAt(px, pz, py, step_height));
    var player_grounded = py <= player_ground_y + 0.015 and pvy <= 0;
    if (player_grounded) {
        if (heightfieldGroundSurfaceAt(px, pz, py, step_height)) |s| {
            clampUphillSurfaceSpeed(&pvx, &pvz, px, pz, py, step_height, dt, s, speed);
        }
    }
    // Stairlog: velocity AFTER the uphill clamp. If clamp_v << integ_v while the
    // player holds full intent and isn't gaining height, the clamp is misreading
    // the crest cell as a near-vertical walkable slope (the stair-top stick).
    const clamp_vx = pvx;
    const clamp_vz = pvz;
    if (jump_down and player_grounded) {
        pvy = jump_speed;
        player_grounded = false;
        // Stairlog jump marker: a loud, easy-to-grep line on the rising edge of a
        // jump (fires once per launch — player_grounded clears until landing). The
        // user jumps 3× at the staircase to bracket the repro, so the walk-up
        // frames before it can be ignored.
        if (stairlogOn()) {
            g_stairlog_frame += 1;
            std.debug.print("[stairlog f{d}] ===== JUMP ===== pos=({d:.2},{d:.2},{d:.2})\n", .{ g_stairlog_frame, px, py, pz });
        }
    }
    pvy -= gravity * dt;
    const prev_px = px;
    const prev_pz = pz;
    px += pvx * dt;
    py += pvy * dt;
    pz += pvz * dt;
    // Head bonk: jumping under a ceiling (a floor/roof/deck overhead). A ceiling
    // is a surface whose normal points DOWN, so the collision force removes only
    // the velocity component INTO it — the upward part — and leaves horizontal
    // momentum untouched. We clamp the head just below the lowest overhead
    // underside and zero any rising velocity; pvx/pvz are deliberately preserved,
    // so you skim a low hallway at speed (Source-style) instead of being shoved
    // sideways. Doing this BEFORE collideSolidRects is also what kills the glitch:
    // once the head sits at the underside, the body no longer overlaps the rect's
    // solid band, so the horizontal circle-vs-rect push never fires on a ceiling.
    if (pvy > 0) {
        const ceiling = ceilingUndersideAt(rects, oriented, px, pz, player_radius, py, py + player_height);
        if (ceiling < py + player_height) {
            // Clamp the head under the ceiling, but NEVER below the ground holding
            // the feet up. A landing floor at the TOP of a staircase has its
            // underside above your head while you climb — naively seating the head
            // at it (py = ceiling - height) drops the feet through the steps and
            // pins you under the floor. When there isn't headroom you're climbing
            // ONTO that slab, not under a roof: stay on the support and let the
            // step-up mount you (slope-walkable already skips the side-push there).
            const support = @max(groundAt(rects, oriented, px, pz, py, step_height, true), heightfieldFloorAt(px, pz, py, step_height));
            const limit = @max(ceiling - player_height, support);
            if (limit < py) py = limit;
            pvy = 0;
        }
    }
    // Stairlog capture: where the integrator WANTED to land this frame, before
    // any collision response. Compared against the final position below to see
    // which branch (rect side-push vs. heightfield move-cancel) eats the move.
    const desired_px = px;
    const desired_pz = pz;
    collideSolidRects(&px, py, &pz, &pvx, &pvz, player_radius, player_height, rects, oriented, @max(wall_restitution, player_surface_restitution * 0.15), step_height, walkable_side_push_grace, true);
    const rect_push_x = px - desired_px; // how far the rect/oriented side-push pulled us off the desired path
    const rect_push_z = pz - desired_pz;
    var next_ground_y = groundAt(rects, oriented, px, pz, py, step_height, true);
    // Terrain hit detection on the real slope. The slope LIMIT is enforced by the
    // surface normal, not the step height: a single frame only nudges the player a
    // few cm, so a step-height gate would let them creep up any grade. Instead —
    //   • walkable surface (normal.y >= limit): stand on it, climbing the gentle
    //     grade smoothly (this is the carved trail);
    //   • too-steep surface that rises ABOVE the feet (by any amount): a wall —
    //     cancel the move into it so the steep cone face can't be climbed at all;
    //   • too-steep surface at/below the feet: stand on it (sidehill / descend,
    //     no fall-through) but you still can't gain height on it.
    // So the only way UP a steep cone is the gently-graded trail cut into it.
    var hf_cancel = false; // stairlog: did the too-steep-terrain move-cancel fire?
    var hf_height: f32 = 0;
    var hf_normal_y: f32 = 0;
    var hf_walk_cos: f32 = 0;
    if (heightfieldSurfaceAt(px, pz)) |s| {
        const walkable = s.normal_y >= s.walk_cos;
        if (!walkable and s.height > py + 0.02) {
            px = prev_px;
            pz = prev_pz;
            pvx = 0;
            pvz = 0;
            hf_cancel = true;
            hf_height = s.height;
            hf_normal_y = s.normal_y;
            hf_walk_cos = s.walk_cos;
        }
    }
    next_ground_y = @max(next_ground_y, heightfieldFloorAt(px, pz, py, step_height));
    if (py <= next_ground_y) {
        py = next_ground_y;
        if (pvy < 0) pvy = 0;
        player_grounded = true;
    } else if (player_grounded and pvy <= 0 and py - next_ground_y <= step_height) {
        // Downhill snap: a player who was standing last frame and whose ground
        // dropped by at most a step stays glued to it. Without this, every
        // downslope/stair frame goes ballistic (gravity accumulates, then a
        // hard landing) — walking down reads as falling on each step. A drop
        // beyond step_height is a real ledge and falls normally.
        py = next_ground_y;
        pvy = 0;
        player_grounded = true;
    }

    // Stairlog (RJIT_STAIRLOG=1): one line per frame the player is actually
    // trying to move. `want` is the horizontal distance the integrator asked
    // for this frame; `moved` is what survived collision. When want is real but
    // moved collapses to ~0 we tag "<< BLOCKED" and the columns say which branch
    // ate it: rectpush=(...) means a solid rect/oriented wall side-pushed us;
    // hfcancel=true means the too-steep heightfield (stair/cone face) cancelled
    // the move, with hf(h=surface height, ny=normal.y, walkcos=climb limit).
    // This is how the user proves "holding W into an invisible wall at the stair
    // top": expect a run of BLOCKED frames with one branch flagged.
    if (stairlogOn()) {
        const intent_mag = @sqrt(move_x * move_x + move_z * move_z);
        if (intent_mag > 0.01) {
            g_stairlog_frame += 1;
            const dx = px - prev_px;
            const dz = pz - prev_pz;
            const moved = @sqrt(dx * dx + dz * dz);
            const wdx = desired_px - prev_px;
            const wdz = desired_pz - prev_pz;
            const want = @sqrt(wdx * wdx + wdz * wdz);
            const blocked = want > 0.0005 and moved < want * 0.3;
            // integ=() is the velocity the movement integrator produced this frame;
            // clamp=() is it after the uphill speed-clamp. integ big + clamp tiny =
            // the clamp ate the move (the stair-top stick). rectpush/hfcancel name
            // the other two killers.
            std.debug.print("[stairlog f{d}] intent=({d:.2},{d:.2}) pos=({d:.2},{d:.2},{d:.2}) want={d:.3} moved={d:.3} integ=({d:.2},{d:.2}) clamp=({d:.2},{d:.2}) vel=({d:.2},{d:.2},{d:.2}) grounded={} rectpush=({d:.3},{d:.3}) hfcancel={} hf(h={d:.2} ny={d:.2} walkcos={d:.2}) {s}\n", .{ g_stairlog_frame, move_x, move_z, px, py, pz, want, moved, integ_vx, integ_vz, clamp_vx, clamp_vz, pvx, pvy, pvz, player_grounded, rect_push_x, rect_push_z, hf_cancel, hf_height, hf_normal_y, hf_walk_cos, if (blocked) "<< BLOCKED" else "" });
        }
    }

    // Collider diagnostic (RJIT_COLLIDERLOG=1): prove "I walk through the props".
    // Throttled to ~every 6th qualifying frame so a 240fps walk doesn't flood.
    if (colliderlogOn()) {
        const intent_mag = @sqrt(move_x * move_x + move_z * move_z);
        var nearest: f32 = -1;
        const inside = playerSolidOverlaps(rects, oriented, px, py, pz, player_radius, player_height, &nearest);
        if (intent_mag > 0.01 or inside > 0) {
            g_colliderlog_tick += 1;
            if (g_colliderlog_tick % 6 == 0) {
                const push = @sqrt(rect_push_x * rect_push_x + rect_push_z * rect_push_z);
                const loaded_rects = rects.len / RECT_FLOATS;
                const loaded_oriented = oriented.len / ORIENTED_FLOATS;
                const tag = if (inside > 0 and push < 0.005 and intent_mag > 0.01) "<< WALKING THROUGH a solid collider" else if (inside > 0) "(inside, pushed)" else if (intent_mag > 0.01) "(clear — no collider here)" else "";
                std.debug.print("[colliderlog] pos=({d:.2},{d:.2},{d:.2}) loaded(rects={d} oriented={d}) inside={d} nearestEdge={d:.2}m push={d:.3} {s}\n", .{ px, py, pz, loaded_rects, loaded_oriented, inside, nearest, push, tag });
                // Detail: every collider footprint the player is standing in + its band
                // relation (UNDER/BLOCKS/ABOVE) + solid flag — names the wrong collider.
                colliderlogDump(rects, oriented, px, py, pz, player_radius, player_height);
            }
        }
    }

    var at: usize = OUTPUT_HEADER_FLOATS;
    var i: usize = 0;
    while (i < entity_count) : (i += 1) {
        const src = entity_start + i * ENTITY_FLOATS;
        var x = input[src];
        var y = input[src + 1];
        var z = input[src + 2];
        var vx = input[src + 3];
        var vy = input[src + 4];
        var vz = input[src + 5];
        const r = @max(0.05, input[src + 6]);
        const restitution = clamp(input[src + 7], 0, 1);

        vy -= gravity * dt;
        x += vx * dt;
        y += vy * dt;
        z += vz * dt;
        const entity_step_height = @max(0.05, r * 0.35);
        collideSolidRects(&x, y - r, &z, &vx, &vz, r, r * 2, rects, oriented, wall_restitution, entity_step_height, walkable_side_push_grace, false);
        // Painted terrain supports bodies too (req_0625: balls/cones fell
        // through heightfield landforms — only the player sampled them).
        var gy = groundAt(rects, oriented, x, z, y - r, entity_step_height, false) + r;
        gy = @max(gy, heightfieldFloorAt(x, z, y - r, entity_step_height) + r);
        const surface_friction = clamp(surfaceValueAt(rects, oriented, x, z, y - r, entity_step_height, 6, 0.2), 0, 1);
        const surface_restitution = clamp(surfaceValueAt(rects, oriented, x, z, y - r, entity_step_height, 7, 0.8), 0, 1);
        var grounded: f32 = 0;
        if (y <= gy) {
            y = gy;
            if (vy < 0) {
                vy = -vy * restitution * surface_restitution;
                const impact_drag = @max(@as(f32, 0), 1 - surface_friction * 0.22);
                vx *= impact_drag;
                vz *= impact_drag;
            }
            if (@abs(vy) < 0.08) {
                vy = 0;
                grounded = 1;
            }
            const surface_drag = @max(@as(f32, 0), 1 - dt * (1.5 + surface_friction * 12));
            vx *= surface_drag;
            vz *= surface_drag;
        }

        // The kick: player capsule vs entity sphere. Pushing into a body
        // transfers the player's approach velocity along the contact normal,
        // scaled by tuning's bodyRestitution ([19]) — so running into a ball
        // boots it, and a faster run boots it harder. The player is kinematic
        // here (a light prop never deflects the runner). Grounded contacts get
        // a small upward pop so a hard kick lofts the ball off the pavement.
        {
            const dxp = x - px;
            const dzp = z - pz;
            const cy = clamp(y, py, py + player_height);
            const dyp = y - cy;
            const dist2 = dxp * dxp + dyp * dyp + dzp * dzp;
            const min_dist = r + player_radius;
            if (dist2 < min_dist * min_dist and dist2 > 1e-8) {
                const dist = @sqrt(dist2);
                const nx = dxp / dist;
                const ny = dyp / dist;
                const nz = dzp / dist;
                const overlap = min_dist - dist;
                x += nx * overlap;
                y += @max(0, ny) * overlap;
                z += nz * overlap;
                const rel = (pvx - vx) * nx + (pvy - vy) * ny + (pvz - vz) * nz;
                if (rel > 0) {
                    const transfer = rel * (1 + restitution) * body_restitution;
                    vx += nx * transfer;
                    vy += @max(0, ny) * transfer;
                    vz += nz * transfer;
                    if (grounded == 1 and transfer > 1.2) {
                        vy = @max(vy, transfer * 0.22);
                        grounded = 0;
                    }
                }
            }
        }

        g_snapshot[at] = x;
        at += 1;
        g_snapshot[at] = y;
        at += 1;
        g_snapshot[at] = z;
        at += 1;
        g_snapshot[at] = vx;
        at += 1;
        g_snapshot[at] = vy;
        at += 1;
        g_snapshot[at] = vz;
        at += 1;
        g_snapshot[at] = r;
        at += 1;
        g_snapshot[at] = grounded;
        at += 1;
    }

    i = 0;
    while (i < entity_count) : (i += 1) {
        var j = i + 1;
        while (j < entity_count) : (j += 1) {
            const a = OUTPUT_HEADER_FLOATS + i * ENTITY_FLOATS;
            const b = OUTPUT_HEADER_FLOATS + j * ENTITY_FLOATS;
            resolveSpherePair(g_snapshot[a .. a + ENTITY_FLOATS], g_snapshot[b .. b + ENTITY_FLOATS]);
        }
    }

    g_snapshot[0] = 0; // host-fn µs — stamped by the registrar
    g_snapshot[1] = px;
    g_snapshot[2] = py;
    g_snapshot[3] = pz;
    g_snapshot[4] = pvx;
    g_snapshot[5] = pvy;
    g_snapshot[6] = pvz;
    g_snapshot[7] = if (player_grounded) 1 else 0;
    g_snapshot[8] = @floatFromInt(entity_count);
    return g_snapshot[0 .. OUTPUT_HEADER_FLOATS + entity_count * ENTITY_FLOATS];
}
