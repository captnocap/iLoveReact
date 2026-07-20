//! 3d.zig — 3D rendering pipeline for wgpu
//!
//! Renders 3D.Mesh children to an offscreen texture with depth buffer,
//! composited into the 2D layout tree via images.queueQuad().
//! Reads camera/light/mesh props from the 3D.View node's children.

const std = @import("std");
const log = @import("../diag/log.zig");
const wgpu = @import("wgpu");
const bu = @import("buffer_upload.zig");
const shaders = @import("shaders.zig");
const terrain_grid = @import("terrain_grid.zig");
const core = @import("gpu.zig");
const images = @import("images.zig");
const build_options = @import("build_options");
const math = @import("../math/root.zig");
const layout = @import("../layout.zig");
const effect_assemble = @import("effect_assemble.zig");
const compile_progress = @import("compile_progress.zig");
const static_instance_policy = @import("static_instance_policy.zig");
const model_paint = @import("model_paint.zig");
const effects_ctx = @import("effects_ctx.zig");
const paint_islands_mod = @import("paint_islands.zig");
const paint_program = @import("paint_program.zig");
const model_source = @import("model_source.zig");
const mesh_edit = @import("mesh_edit.zig");
const indexed_edit_mesh = @import("indexed_edit_mesh.zig");
const mesh_journal_log = @import("mesh_journal_log.zig");
const path_array = @import("path_array.zig");
const path_plane = @import("path_plane.zig");
const stage_scale = @import("stage_scale.zig");
const capsules = @import("capsules.zig");
const polys = @import("polys.zig");
const pack = @import("pack.zig");
const Node = layout.Node;

// ════════════════════════════════════════════════════════════════════════
// Vertex format: position f32x3 + oct normal snorm16x2 + uv f16x2 = 20 bytes
// ════════════════════════════════════════════════════════════════════════
//
// The GPU-resident mesh vertex — the slim-instance treatment applied to the
// vertex itself (was 32 B: pos/normal/uv all f32). Positions stay f32 (world
// scale needs the range). The normal is a direction, not a point — octahedral
// snorm16x2 keeps ~0.003° accuracy in 4 bytes (pack.octEncodeSnorm16 encodes,
// oct_decode in each consuming shader decodes — keep in lockstep). UVs ride
// f16: NOT unorm, because flora's uv_band tiling runs past 1.0 — f16 is exact
// to 2048 texels and full-range beyond. The wire/authoring format everywhere
// else (JS geometry registry, mesh_import, world_loader rows, mapfile lumps —
// V29: raw aligned f32) is UNCHANGED stride-8 f32; packing happens once at the
// upload boundary (stageVertexRows), exactly like makeInstance does for
// instance rows. Net: the 256 MiB retained buffer now holds 13.4M verts
// instead of 8.4M, and every dynamic mesh upload ships 37.5% fewer bytes.
const Vertex = extern struct {
    px: f32,
    py: f32,
    pz: f32,
    noct: [2]i16, // snorm16x2 octahedral normal
    u: f16,
    v: f16,
};

// ════════════════════════════════════════════════════════════════════════
// Uniform buffer — matches SceneUniforms in WGSL
// ════════════════════════════════════════════════════════════════════════

const SceneUniforms = extern struct {
    vp: [16]f32, // 0
    light_dir: [3]f32, // 64
    specular_power: f32, // 76
    light_color: [3]f32, // 80
    light_count: f32 = 0, // 92  number of placed lights in g_lights_buf this frame
    ambient_color: [3]f32, // 96
    _pad2: f32 = 0, // 108
    camera_pos: [3]f32, // 112
    time: f32 = 0, // 124  wrapped wall-clock for the grass pipeline's wind (was _pad3)
    fog_color: [3]f32, // 128  flat fade target (used when fog_sky == 0)
    fog_near: f32, // 140
    fog_far: f32, // 144
    fog_sky: f32, // 148  1 = fade toward the screen-space sky gradient, 0 = flat fog_color
    wire: f32 = 0, // 152  1 = draw a barycentric wireframe over every mesh (was _pad4a)
    _pad4b: f32 = 0, // 156  (pad up to the 16-aligned 160 the vec3 needs)
    sky_horizon: [3]f32 = .{ 0, 0, 0 }, // 160
    _pad5: f32 = 0, // 172
    // @Vector(4, f32) has align 16 — forces the extern struct's alignment to 16
    // (WGSL std140) and sits at the 16-aligned 176. Only .xyz is used (sky zenith).
    sky_zenith: @Vector(4, f32) = .{ 0, 0, 0, 0 }, // 176 → 192 total (multiple of 16)
};

// Per-instance vertex attributes (vertex buffer 1, step=instance) for the standard
// 3D path — EVERY mesh that isn't a foliage card: floors, walls, buildings, props,
// dynamic entities, water, ground. Was a baked 4×4 model matrix + rgba (80 bytes),
// but the matrix is the PRODUCT of TRS the shaders can rebuild for free — and a floor
// is the worst case (axis-aligned, so the 64-byte matrix encodes rotations it never
// uses). We store the FACTORS instead and rebuild the matrix in the vertex shaders
// (scene3d_wgsl / water_wgsl / scene3d_ground_prefix), 80 → 32 bytes (2.5×). Scale is
// f16 (full float range, NOT a fixed-max unorm — a tower must not clip a low cap) and
// rotation is a u16 degree ring (axis-aligned 0/90/180/270 quantize EXACTLY; arbitrary
// angles get 0.0055° steps). Decode in those shaders MUST stay in lockstep:
//   euler: u16 = round(deg / 360 * 65536)  → deg = f32(u16) / 65536 * 360
//   scale: f16 metres (IEEE half)          → vec3f directly
//   color: unorm8 per channel              → c = u8 / 255 (rgba; alpha = glass)
const InstanceData = extern struct {
    pos: [3]f32, // location 3 (float32x3) — px, py, pz (map-scale, full f32)
    euler: [4]u16, // location 4 (uint16x4)  — rx, ry, rz deg ring (+1 pad)
    scale: [4]f16, // location 5 (float16x4) — sx, sy, sz metres (+1 pad)
    color: [4]u8, // location 6 (unorm8x4)  — rgba
};

// Slim per-instance row shared by ALL foliage-card pipelines — grass/bush/flower
// (~grass~, g_grass_pipeline) and palm fronds (~frond~, g_frond_pipeline). A foliage
// card's real degrees of freedom are tiny — position, pitch+yaw (rz always 0; grass
// is yaw-only), one width + one length (sx==sz), and a single tint — so storing the
// full 80-byte model matrix is ~64 bytes of pure waste per card, and the counts are
// enormous (millions of grass blades, 19–29 frond cards per palm). We pack it to 24
// bytes (3.33× smaller) and rebuild the matrix in the card shaders (grass_wgsl /
// frond_wgsl). Foliage cards also get their OWN instance buffer (g_slim_*), so they
// stop competing for the shared 1.05M static pool — easing in-view despawn directly.
// Quantization (decode side lives in the card shaders, MUST stay in lockstep):
//   angles: u16 = round(deg / 360 * 65536)      → deg = f32(u16) / 65536 * 360
//   scale : unorm16 over [0, SLIM_SCALE_MAX m]  → m = unorm * SLIM_SCALE_MAX
//   color : unorm8 per channel                   → c = u8 / 255
const SLIM_SCALE_MAX: f32 = 16.0; // metres the unorm16 width/length range spans
const SlimInstance = extern struct {
    pos: [3]f32, // location 3 (float32x3) — px, py, pz
    angles: [2]u16, // location 4 (uint16x2)  — pitch, yaw (deg × 65536/360)
    scale: [2]u16, // location 5 (unorm16x2) — wide, len (÷ SLIM_SCALE_MAX)
    color: [4]u8, // location 6 (unorm8x4)  — root rgb (+ a = 255, unused)
};

comptime {
    if (@sizeOf(Vertex) != 20 or @alignOf(Vertex) != 4) {
        @compileError("Vertex must match the packed vbuf0 vertex layout (20 bytes)");
    }
    if (@sizeOf(SceneUniforms) != 192 or @alignOf(SceneUniforms) != 16) {
        @compileError("SceneUniforms must match scene3d_wgsl uniform layout (192 bytes, align 16)");
    }
    if (@sizeOf(InstanceData) != 32 or @alignOf(InstanceData) != 4) {
        @compileError("InstanceData must match scene3d_wgsl per-instance vertex layout (32 bytes)");
    }
    if (@sizeOf(SlimInstance) != 24 or @alignOf(SlimInstance) != 4) {
        @compileError("SlimInstance must match frond_wgsl per-instance vertex layout (24 bytes)");
    }
}

// One placed light, byte-identical to `struct Light` in shaders.scene3d_wgsl
// (std430). The user authors a "pyramid": a tip at `pos`, aimed down `dir`,
// opening to the cone [cos_outer..cos_inner] and carrying `range`. An omni bulb
// sets cos_outer = -1 (cos 180°) so the cone term is a flat 1. Every vec3 lands
// on a 16-aligned offset already (0/16/32), so this extern struct copies straight
// to the GPU with no padding surprises — the comptime check below pins it to 64 B.
const Light = extern struct {
    pos: [3]f32, // 0
    range: f32, // 12
    dir: [3]f32, // 16
    cos_outer: f32, // 28
    color: [3]f32, // 32
    intensity: f32, // 44
    cos_inner: f32, // 48
    kind: f32, // 52  (0 = point/omni, 1 = spot) — reserved for future use
    _a: f32 = 0, // 56  (reserved: animation phase / strip param)
    _b: f32 = 0, // 60
};

// How many placed lights one frame can carry. Sized generously per the
// "juice limits, don't set low" rule — 256 lights is 16 KB of GPU storage, and a
// view full of sign bulbs / lamps is well under that. Overflow is dropped LOUDLY
// (see collectLights) rather than silently truncating the tail.
const MAX_LIGHTS = 256;

comptime {
    if (@sizeOf(Light) != 64) {
        @compileError("Light must match scene3d_wgsl std430 Light (64 bytes)");
    }
}

// Shadow of ONE caster — matches ShadowUniforms in scene3d_wgsl. The light-space
// view-projection plus the sample knobs; has_shadow gates the whole test off.
const ShadowUniforms = extern struct {
    light_vp: [16]f32, // 0   light-space VP (row-major, transposed for WGSL like S.vp)
    has_shadow: f32 = 0, // 64
    caster_index: f32 = 0, // 68  which placed light this map belongs to
    bias: f32 = 0.0015, // 72  depth bias to kill acne
    texel: f32 = 0, // 76  1/SHADOW_MAP_SIZE for the PCF kernel step
};

// One shadow map for now (the first shadow-casting spotlight). 2048² depth is a
// crisp pool at lamp scale; this generalises to a depth-array atlas for N casters.
const SHADOW_MAP_SIZE: u32 = 2048;

// Skybox uniforms — must match SkyUniforms in shaders.skybox_wgsl. Each vec3 is
// followed by a scalar so the std140 16-byte alignment holds with no padding.
const SkyUniforms = extern struct {
    inv_vp: [16]f32,
    cam_pos: [3]f32,
    time: f32,
    sun_dir: [3]f32,
    sun_size: f32,
    zenith: [3]f32,
    haze: f32,
    horizon: [3]f32,
    cloud: f32,
    ground: [3]f32,
    sun_glow: f32,
    sun_color: [3]f32,
    night: f32,
};

comptime {
    // Size == 160 already proves there is no surprise padding; every vec3 sits
    // at a 16-byte-aligned offset followed by its scalar, matching WGSL's
    // uniform layout. (@alignOf is only 4 — no vec field — but writeBuffer is a
    // byte copy, so the field *offsets* are what must match, and they do.)
    if (@sizeOf(SkyUniforms) != 160) {
        @compileError("SkyUniforms must match skybox_wgsl uniform layout");
    }
}

// ════════════════════════════════════════════════════════════════════════
// Geometry buffers
// ════════════════════════════════════════════════════════════════════════
//
// The framework knows ZERO shape names. Vertices arrive from @reactjit/geometries
// (TS generators) as bytes; the framework only uploads + draws them. There is no
// procedural shape generation here anymore — `generateBox`/`generateSphere`/… and
// the `generateGeometry` shape-name dispatch were deleted (the debug grid that
// depended on a hardwired box went with them).
//
// MAX_FRAME_VERTS caps the per-frame vertex buffer (the cache-full degrade path
// uploads here). Allocated once; writeBuffer only uploads bytes actually drawn,
// so a larger ceiling costs reserved GPU memory, not per-frame work.
const MAX_FRAME_VERTS = 262144;

// ── Retained geometry intern cache (@reactjit/geometries) ───────────────────
//
// A registry mesh ships its verts (already in Vertex layout) ONCE, tagged with
// an intern key. We upload each UNIQUE key into g_retained_vbuf and remember its
// (offset, count); every later frame just redraws that slice — no regeneration,
// no re-upload. This is the texture cache (getOrCreateTexBindGroup) applied to
// vertices: identical geometry across N meshes collapses to one GPU copy. The
// "240fps coconut" — regenerated every frame in the legacy path — becomes one
// upload that never runs again unless its params (hence its key) change.
// CAP RAISE (req_0725): a city editor interns a LOT of distinct geometry —
// every prop kind, imported mesh, building piece variant, etc. When this region
// (or GEO_CACHE_SIZE below) fills, internGeometry returns null and pass 1
// SILENTLY DROPS the mesh (no per-frame fallback despite the older comment). The
// fill order is deterministic — worldStatics props are collected before the
// build pieces, so once the cache is full the shared Box geometry (the grid AND
// every building bucket) can't intern and EVERY building + the grid vanish while
// props survive (and a restart can't help: same order refills the same way).
// MEASURED (req_0727): with caps at 2M/2048 the census still showed
// inst_collected=0 with geo_cache_len=146 — so it's NOT the KEY count (146 ≪
// 2048), it's the VERTEX BUFFER: ~146 distinct geometries (props, humanoids,
// carves, and the user's newly-IMPORTED mesh) fill MAX_RETAINED_VERTS before the
// Box geometry the building buckets share can intern, so every bucket + the grid
// drop. So we want this region as large as possible to fit a city's worth of
// distinct meshes plus the imported asset.
//
// HARD CEILING (req_0731): g_retained_vbuf is ONE buffer holding the intern
// region [0, MAX_RETAINED_VERTS) AND the reserved dynamic-slot tail
// (DYN_REGION_VERTS) on top — its total alloc is (MAX_RETAINED_VERTS +
// DYN_REGION_VERTS) * sizeof(Vertex). WebGPU caps a SINGLE buffer at
// maxBufferSize (the 256 MiB default we get from passing null limits at device
// creation — NOT the machine's VRAM). req_0725 set this to 8M verts = exactly
// 256 MiB, ignoring the dyn tail, so the buffer asked the GPU for ~400 MiB —
// over the per-buffer limit. In a validation build that's a clean abort; in a
// build where validation does not catch it, the oversized per-frame allocation
// hard-locks the GPU driver (observed: kernel panic + looping audio). So size
// the intern region to fill exactly what's LEFT under the cap once the dyn tail
// is reserved. The comptime assert below DYN_REGION_VERTS enforces this so the
// build FAILS instead of the machine if either constant is bumped past the cap.
// (To genuinely get a 256 MiB intern region back, split the dyn tail into its
// own buffer or request a higher maxBufferSize at device creation — both are
// later changes; this keeps the single-buffer layout safe.)
// WebGPU's default per-buffer ceiling. We get this because device creation passes
// null limits (gpu.zig), so we never raise maxBufferSize. This is a single-buffer
// API cap, NOT the machine's VRAM — a beefy GPU does not change it.
const MAX_BUFFER_BYTES = 268_435_456; // 256 MiB — WebGPU default maxBufferSize
const MAX_BUFFER_VERTS = MAX_BUFFER_BYTES / @sizeOf(Vertex); // 13,421,772 verts at 20 B/vert
const MAX_RETAINED_VERTS = MAX_BUFFER_VERTS - DYN_REGION_VERTS; // fills the buffer up to the 256 MiB cap
const GEO_CACHE_SIZE = 2048;
const GeoEntry = struct {
    hash: u64 = 0,
    offset_bytes: u64 = 0,
    count: u32 = 0,
    present: bool = false,
};
var g_geo_cache: [GEO_CACHE_SIZE]GeoEntry = [_]GeoEntry{.{}} ** GEO_CACHE_SIZE;
var g_geo_cache_len: usize = 0;
var g_retained_top: u64 = 0; // bump cursor (bytes) into g_retained_vbuf; persists across frames

/// Retained (interned) geometry bytes currently resident in the GPU vertex
/// buffer — the bump cursor itself. Device-local (VRAM). Dominated by world/map
/// geometry (chunk meshes, props, buildings) because the intern never evicts, so
/// this is the headline "World" number in the memory breakdown telemetry.
pub fn retainedGeometryBytes() u64 {
    return g_retained_top;
}

// ── Host-loaded mesh stash (drop-to-view, framework/world/mesh_import.zig) ───────
// A GLB/OBJ dropped on a viewer is parsed ENTIRELY in the host and never crosses the
// JS bridge as geometry — only a short intern key does (see __mesh_load_file). The
// parse door owns no GPU queue, so it parks the verts here, keyed by the same FNV hash
// the geo cache uses; the first draw that resolves the key interns them into
// g_retained_vbuf (internFromStash) and frees the host copy. A viewer holds a handful
// of models, so a small fixed table; overflow is loud and simply doesn't draw.
const HOST_MESH_STASH = 16;
const HostMeshStash = struct {
    hash: u64 = 0,
    verts: ?[]f32 = null, // c_allocator-owned until interned, then freed
    count: u32 = 0,
    present: bool = false,
};
var g_host_stash: [HOST_MESH_STASH]HostMeshStash = [_]HostMeshStash{.{}} ** HOST_MESH_STASH;

/// Host-side bytes parked in the mesh stash (c_allocator-owned vertex copies
/// awaiting their first-draw intern). Counts toward process RSS, not VRAM.
pub fn hostStashBytes() u64 {
    var total: u64 = 0;
    for (g_host_stash) |s| {
        if (s.present) {
            if (s.verts) |v| total += @as(u64, @intCast(v.len)) * @sizeOf(f32);
        }
    }
    return total;
}

/// Park a host-parsed mesh under `key` for lazy interning on first draw. `verts` is
/// COPIED into a host-owned buffer (the caller's parse result is freed right after).
/// Returns false (loud) only when the stash is full. A re-drop of the same key
/// overwrites; an already-resident key is a no-op success.
pub fn stashHostMesh(key: []const u8, verts: []const f32, count: u32) bool {
    if (lookupGeometry(key) != null) return true; // already GPU-resident
    const hash = hashKey(key);
    // The viewer shows ONE host mesh at a time, so a previously-stashed-but-not-yet-
    // drawn mesh (a superseded quality level mid-scrub) is obsolete. Evict every OTHER
    // entry as we stash the new current one — otherwise a fast slider drag fills the
    // 16-slot stash with meshes that never draw and the model vanishes (req_2137).
    var slot: ?*HostMeshStash = null;
    for (&g_host_stash) |*s| {
        if (s.present and s.hash == hash) {
            slot = s; // reuse the same-key entry (re-stash)
        } else if (s.present) {
            if (s.verts) |old| std.heap.c_allocator.free(old);
            s.* = .{};
        }
    }
    const s = slot orelse &g_host_stash[0]; // everything else is now free
    if (s.verts) |old| std.heap.c_allocator.free(old);
    const copy = std.heap.c_allocator.alloc(f32, verts.len) catch return false;
    @memcpy(copy, verts);
    s.* = .{ .hash = hash, .verts = copy, .count = count, .present = true };
    return true;
}

/// Resolve a stashed host mesh into the retained GPU buffer (once), freeing the host
/// copy on success. Returns null if no stash entry matches or interning failed.
fn internFromStash(queue: *wgpu.Queue, key: []const u8) ?GeoSlice {
    const hash = hashKey(key);
    for (&g_host_stash) |*s| {
        if (s.present and s.hash == hash) {
            const verts = s.verts orelse return null;
            const slot = internGeometry(queue, key, verts, s.count) orelse return null;
            std.heap.c_allocator.free(verts);
            s.* = .{};
            return slot;
        }
    }
    return null;
}

// ── Native orbit camera (drop-to-view) ──────────────────────────────────────────
// A <Scene3D.Camera nativeCamera> hands camera control to the HOST: the cart never
// re-renders to MOVE the camera — drag orbits, wheel dollies, and the host redraws on
// markDirty. That sidesteps the per-frame React-rerender churn that made the loader
// pane choppy (see the loader_pane_camera memory). The door layer feeds raw input
// deltas in (orbitDrag/orbitZoom); orbitFrame seeds it on model load so an
// arbitrary-scale import always lands framed in view.
const Orbit = struct {
    yaw: f32 = 0.7, // radians around +Y
    pitch: f32 = 0.45, // radians above the XZ plane
    dist: f32 = 6,
    target: [3]f32 = .{ 0, 0, 0 },
    radius: f32 = 1,
    framed: bool = false,
    // Camera lock (req_2893): freeze the view where the user set it. Gates EVERY
    // user-motion entry (drag/zoom/pan/double-click focus/compass snap) at the one
    // place they all funnel through, so the JS doors AND engine.zig's native input
    // loop are covered by the same switch. orbitFrame (model load) stays live — a
    // fresh model must land in view even under lock.
    locked: bool = false,
};
var g_orbit: Orbit = .{};

/// Set the mesh editor's camera lock (req_2893 — `__model_orbit_lock`).
pub fn orbitSetLocked(on: bool) void {
    g_orbit.locked = on;
}

// View bookmarks (req_3067/req_3074): the host's job is the POSE — read it out, apply
// one back. The bookmark LIST is authored data and lives cart-side (ModelView state +
// hot twig), where naming/removal/ordering belong. This replaced the one-slot
// store/recall doors the moment the user wanted more than one pin.

/// Read the orbit pose (`__model_cam_pose`): yaw, pitch, dist, target xyz.
pub fn orbitPose() [6]f32 {
    return .{ g_orbit.yaw, g_orbit.pitch, g_orbit.dist, g_orbit.target[0], g_orbit.target[1], g_orbit.target[2] };
}
/// Apply a bookmarked orbit pose (`__model_cam_set_pose`). False under the req_2893
/// lock — applying a bookmark is a camera motion like any other. radius/framed/locked
/// stay live: they belong to the current model/session, not the view. Inputs are
/// clamped like the drag path so a hand-edited twig can never wedge the camera.
pub fn orbitSetPose(yaw: f32, pitch: f32, dist: f32, target: [3]f32) bool {
    if (g_orbit.locked) return false;
    g_orbit.yaw = yaw;
    g_orbit.pitch = std.math.clamp(pitch, -ORBIT_PITCH_LIM, ORBIT_PITCH_LIM);
    g_orbit.dist = @max(0.01, dist);
    g_orbit.target = target;
    return true;
}

/// Seed the orbit to frame a model of bounding `radius` about `target`. Called by the
/// load door the moment a model finishes parsing.
pub fn orbitFrame(target: [3]f32, radius: f32) void {
    g_orbit.target = target;
    g_orbit.radius = @max(1e-3, radius);
    g_orbit.dist = g_orbit.radius * 2.6;
    g_orbit.framed = true;
}
/// Pitch clamp shy of the poles — straight-down is degenerate for a Y-up orbit (the
/// view basis loses its right vector). Shared by drag AND the compass axis snaps so a
/// snapped view is always reachable by dragging too.
const ORBIT_PITCH_LIM: f32 = 1.5;
/// Orbit by a screen-space drag delta (pixels). Pitch clamps shy of the poles.
pub fn orbitDrag(dx: f32, dy: f32) void {
    if (g_orbit.locked) return;
    g_orbit.yaw -= dx * 0.01;
    g_orbit.pitch += dy * 0.01;
    g_orbit.pitch = @max(-ORBIT_PITCH_LIM, @min(ORBIT_PITCH_LIM, g_orbit.pitch));
}
/// Dolly in/out by a wheel delta (sign only matters). Clamped to a sane band of the
/// model radius so you can't fly through it or lose it.
pub fn orbitZoom(delta: f32) void {
    if (g_orbit.locked) return;
    const factor: f32 = if (delta > 0) 0.88 else 1.0 / 0.88;
    g_orbit.dist = @max(g_orbit.radius * 0.15, @min(g_orbit.radius * 40.0, g_orbit.dist * factor));
}
fn orbitCamPos() math.Vec3 {
    const cp = @cos(g_orbit.pitch);
    return .{
        .x = g_orbit.target[0] + g_orbit.dist * cp * @sin(g_orbit.yaw),
        .y = g_orbit.target[1] + g_orbit.dist * @sin(g_orbit.pitch),
        .z = g_orbit.target[2] + g_orbit.dist * cp * @cos(g_orbit.yaw),
    };
}
/// Pan the orbit PIVOT in the screen plane by a drag delta (pixels). The orbit point was
/// nailed to the model centre, which fights you the moment a model is large — you'd
/// orbit a far edge around a centre half a model away. Moving the focus (not the eye)
/// lets you drop the centre of rotation right where you're working (req_2148). Speed
/// scales with dist so the grab tracks the cursor at any zoom; drag follows the content.
pub fn orbitPan(dx: f32, dy: f32) void {
    if (g_orbit.locked) return;
    const eye = orbitCamPos();
    const tgt = math.Vec3{ .x = g_orbit.target[0], .y = g_orbit.target[1], .z = g_orbit.target[2] };
    const fwd = math.v3normalize(math.v3sub(tgt, eye));
    const right = math.v3normalize(math.v3cross(fwd, math.v3up()));
    const up = math.v3cross(right, fwd);
    const k = g_orbit.dist * 0.0018;
    g_orbit.target[0] += -dx * k * right.x + dy * k * up.x;
    g_orbit.target[1] += -dx * k * right.y + dy * k * up.y;
    g_orbit.target[2] += -dx * k * right.z + dy * k * up.z;
}
/// Snap the orbit pivot to an explicit world point — keeps yaw/pitch/dist, so only the
/// centre of attention moves. The programmatic recentre (e.g. focus on a selection).
pub fn orbitFocus(p: [3]f32) void {
    g_orbit.target = p;
}
/// Re-centre the orbit on whatever the camera ray through (mx,my) hits — double-click a
/// far corner and it becomes the pivot. Returns false on a miss (empty space) so the cart
/// keeps the current focus. Uses the exact last-drawn camera, like paintAt.
pub fn focusAt(mx: f32, my: f32) bool {
    if (g_orbit.locked) return false;
    if (!model_paint.hasTarget()) return false;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const p = model_paint.pickPoint(cam, g_paint_vp_w, g_paint_vp_h, vpLocalX(mx), vpLocalY(my)) orelse return false;
    g_orbit.target = p;
    return true;
}

// The EXACT camera + viewport the last drawScene used, captured so a paint raycast
// (model_paint) shoots the same ray the user sees. Without this the pick would guess
// the fov/aspect and miss near the silhouette.
var g_paint_eye: [3]f32 = .{ 0, 0, 0 };
var g_paint_target: [3]f32 = .{ 0, 0, 0 };
var g_paint_fov: f32 = 50;
var g_paint_vp_w: f32 = 0;
var g_paint_vp_h: f32 = 0;
// Screen-space origin (window px) of the Scene3D node's composite rect — the SAME
// (r.x, r.y) drawEditorOverlay adds when projecting overlay markers. Captured so the
// input pickers can convert window coords → viewport-local. Standalone the scene fills
// the window so this is (0,0) and the conversion is a no-op; embedded in the editor the
// node is offset by the rails/chrome, and without subtracting it every pick / marquee /
// gizmo-hit / paint raycast lands off by that offset (req_2248).
var g_paint_vp_x: f32 = 0;
var g_paint_vp_y: f32 = 0;
inline fn vpLocalX(mx: f32) f32 {
    return mx - g_paint_vp_x;
}
inline fn vpLocalY(my: f32) f32 {
    return my - g_paint_vp_y;
}
var g_paint_probed: bool = false; // RJIT_PAINTPROBE one-shot guard
var g_paint_probe_enabled: bool = false;
var g_edit_key_hash: u64 = 0;
var g_edit_key: ?[]u8 = null;
var g_edit_verts: ?[]f32 = null; // active displayed mesh, interleaved 8 f32/vert
var g_edit_count: u32 = 0;
var g_edit_revision: u32 = 0;
// Indexed-aware edit operations preserve this table across previews and commits.
// Rendering still consumes g_edit_verts; legacy topology replacements clear the table
// and the next indexed operation imports their result once at that boundary.
var g_indexed_edit_mesh: ?indexed_edit_mesh.Mesh = null;
var g_guard_before: ?[]f32 = null; // pre-gizmo face positions for safety prompt/revert
var g_guard_indexed_before: ?indexed_edit_mesh.Mesh = null;
var g_guard_pending: bool = false;
var g_guard_bad_faces: u32 = 0;
var g_guard_face_count: u32 = 0;
var g_guard_bad_list: ?[]u32 = null; // indices of the offending tris — Split Quads targets these
var g_guard_can_split: bool = false; // some offending tri sits in a multi-tri authored group

fn clearIndexedEditMesh() void {
    if (g_indexed_edit_mesh) |*mesh| mesh.deinit();
    g_indexed_edit_mesh = null;
}

fn adoptIndexedEditMesh(mesh: *indexed_edit_mesh.Mesh, lowered: *const indexed_edit_mesh.Lowered) void {
    const groups = captureFaceGroups();
    defer if (groups) |rows| std.heap.c_allocator.free(rows);
    const parts = capturePartOfFaces();
    defer if (parts) |rows| std.heap.c_allocator.free(rows);
    mesh.clearCutOrigins();
    mesh.adoptLoweredMetadata(lowered, groups, parts);
    clearIndexedEditMesh();
    g_indexed_edit_mesh = mesh.*;
    mesh.* = .{ .allocator = std.heap.c_allocator };
}

fn cloneIndexedEditMeshOrImport(
    verts: []const f32,
    tri_count: u32,
    groups: ?[]const u32,
    parts: ?[]const u32,
) ?indexed_edit_mesh.Mesh {
    if (g_indexed_edit_mesh) |*mesh| return mesh.clone() catch null;
    return indexed_edit_mesh.Mesh.fromSoup(std.heap.c_allocator, verts, tri_count, groups, parts) catch null;
}

fn ensureIndexedEditMesh() bool {
    if (g_indexed_edit_mesh != null) return true;
    const verts = g_edit_verts orelse return false;
    const tri_count = g_edit_count / 3;
    if (tri_count == 0) return false;
    const groups = captureFaceGroups();
    defer if (groups) |rows| std.heap.c_allocator.free(rows);
    const parts = capturePartOfFaces();
    defer if (parts) |rows| std.heap.c_allocator.free(rows);
    const groups_arg: ?[]const u32 = if (model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP) groups else null;
    g_indexed_edit_mesh = indexed_edit_mesh.Mesh.fromSoup(std.heap.c_allocator, verts, tri_count, groups_arg, parts) catch return false;
    return true;
}

fn clearMeshGuardSnapshot() void {
    if (g_guard_before) |p| std.heap.c_allocator.free(p);
    g_guard_before = null;
    if (g_guard_indexed_before) |*mesh| mesh.deinit();
    g_guard_indexed_before = null;
    if (g_guard_bad_list) |l| std.heap.c_allocator.free(l);
    g_guard_bad_list = null;
    g_guard_pending = false;
    g_guard_bad_faces = 0;
    g_guard_face_count = 0;
    g_guard_can_split = false;
}

fn clearActiveEditMesh() void {
    clearMeshGuardSnapshot();
    clearIndexedEditMesh();
    if (g_edit_verts) |v| std.heap.c_allocator.free(v);
    if (g_edit_key) |k| std.heap.c_allocator.free(k);
    g_edit_verts = null;
    g_edit_key = null;
    g_edit_key_hash = 0;
    g_edit_count = 0;
}

fn normalOf(a: [3]f32, b: [3]f32, c: [3]f32) [3]f32 {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    var n = [3]f32{ uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx };
    const l = @sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (l > 1e-8) {
        n[0] /= l;
        n[1] /= l;
        n[2] /= l;
    } else {
        n = .{ 0, 1, 0 };
    }
    return n;
}

fn copyPaintPositionsToEditVerts(first_face: u32, last_face: u32) bool {
    const verts = g_edit_verts orelse return false;
    const pos = model_paint.positions() orelse return false;
    if (g_edit_count == 0 or first_face > last_face) return false;
    const face_count = @min(g_edit_count / 3, @as(u32, @intCast(pos.len / 9)));
    if (first_face >= face_count) return false;
    const hi = @min(last_face, face_count - 1);
    var f = first_face;
    while (f <= hi) : (f += 1) {
        const pb = @as(usize, f) * 9;
        const a = [3]f32{ pos[pb + 0], pos[pb + 1], pos[pb + 2] };
        const b = [3]f32{ pos[pb + 3], pos[pb + 4], pos[pb + 5] };
        const c = [3]f32{ pos[pb + 6], pos[pb + 7], pos[pb + 8] };
        const n = normalOf(a, b, c);
        var k: usize = 0;
        while (k < 3) : (k += 1) {
            const vi = @as(usize, f) * 3 + k;
            const dst = vi * 8;
            const src = pb + k * 3;
            if (dst + 7 >= verts.len) continue;
            verts[dst + 0] = pos[src + 0];
            verts[dst + 1] = pos[src + 1];
            verts[dst + 2] = pos[src + 2];
            verts[dst + 3] = n[0];
            verts[dst + 4] = n[1];
            verts[dst + 5] = n[2];
        }
    }
    return true;
}

fn patchActiveEditMesh(first_face: u32, last_face: u32) bool {
    const verts = g_edit_verts orelse return false;
    if (g_edit_key_hash == 0 or g_edit_count == 0 or first_face > last_face) return false;
    const first_vert = first_face * 3;
    const face_count = g_edit_count / 3;
    if (first_face >= face_count) return false;
    const hi = @min(last_face, face_count - 1);
    const vert_count = (hi - first_face + 1) * 3;
    const start_f32 = @as(usize, first_vert) * 8;
    const len_f32 = @as(usize, vert_count) * 8;
    if (start_f32 + len_f32 > verts.len) return false;

    var patched = false;
    for (&g_host_stash) |*s| {
        if (!s.present or s.hash != g_edit_key_hash) continue;
        if (s.verts) |stash_verts| {
            if (start_f32 + len_f32 <= stash_verts.len) {
                @memcpy(stash_verts[start_f32 .. start_f32 + len_f32], verts[start_f32 .. start_f32 + len_f32]);
                patched = true;
            }
        }
    }
    const queue = core.getQueue();
    const buf = g_retained_vbuf;
    if (queue != null and buf != null) {
        for (g_geo_cache[0..g_geo_cache_len]) |*e| {
            if (!e.present or e.hash != g_edit_key_hash) continue;
            if (first_vert + vert_count > e.count) continue;
            stageVertexRows(
                queue.?,
                buf.?,
                e.offset_bytes + @as(u64, first_vert) * @sizeOf(Vertex),
                verts[start_f32 .. start_f32 + len_f32],
                vert_count,
            );
            patched = true;
        }
    }
    return patched;
}

fn applyMeshMutation(m: mesh_edit.Mutation) bool {
    if (!m.changed) return false;
    if (!copyPaintPositionsToEditVerts(m.first_face, m.last_face)) return false;
    if (g_indexed_edit_mesh) |*mesh| {
        const verts = g_edit_verts orelse return false;
        if (!mesh.updatePositionsFromInterleaved(verts, g_edit_count / 3)) clearIndexedEditMesh();
    }
    if (model_paint.positions()) |pos| {
        _ = model_source.updateGeometryFromDisplayed(pos, m.first_face, m.last_face);
    }
    return patchActiveEditMesh(m.first_face, m.last_face);
}

/// Adopt a freshly-parsed mesh (interleaved verts, 8 f32/vert) as the paint target.
/// Rewrites its UVs to the per-face atlas in place, so the SAME verts then uploaded by
/// stashHostMesh carry the paint mapping. Keyed by the intern key so the draw can find
/// it. Called by the load door before stashing.
pub fn setPaintTarget(key: []const u8, verts: []f32, count: u32) void {
    clearActiveEditMesh();
    paint_program.reset(); // a fresh model starts with an empty stroke program
    // Reset BEFORE the target swaps: reset restores any selection tint, and the saved
    // base patches belong to the OUTGOING atlas — restoring them into the new one
    // would write stale bytes (or silently no-op) wherever the layouts differ.
    mesh_edit.reset(); // topology changed (load, quality re-mesh, or edit replace) → rebuild lazily
    model_paint.setTarget(hashKey(key), verts, count);
    const need = @as(usize, count) * 8;
    if (verts.len >= need) {
        g_edit_verts = std.heap.c_allocator.dupe(f32, verts[0..need]) catch null;
        if (g_edit_verts != null) {
            g_edit_key = std.heap.c_allocator.dupe(u8, key) catch null;
            g_edit_key_hash = hashKey(key);
            g_edit_count = count;
        }
    }
}

pub fn meshEditActiveKey() ?[]const u8 {
    return g_edit_key;
}
pub fn meshEditActiveCount() u32 {
    return g_edit_count;
}

/// Start a genuinely new model document. Unlike an in-document topology replace or
/// quality remesh, this drops the previous document's focused outliner range so it
/// cannot filter the incoming mesh (req_2953).
pub fn meshEditBeginModel() void {
    g_paint_layout_stale = false;
    mesh_edit.resetForModelLoad();
}

fn appendFloats(list: *std.ArrayListUnmanaged(f32), values: []const f32) bool {
    for (values) |v| list.append(std.heap.c_allocator, v) catch return false;
    return true;
}

fn appendVertex(list: *std.ArrayListUnmanaged(f32), p: [3]f32, n: [3]f32) bool {
    const row = [_]f32{ p[0], p[1], p[2], n[0], n[1], n[2], 0, 0 };
    return appendFloats(list, row[0..]);
}

fn appendTri(list: *std.ArrayListUnmanaged(f32), a: [3]f32, b: [3]f32, c: [3]f32) bool {
    const n = normalOf(a, b, c);
    return appendVertex(list, a, n) and appendVertex(list, b, n) and appendVertex(list, c, n);
}

fn appendTriWithUvs(
    list: *std.ArrayListUnmanaged(f32),
    a: [3]f32,
    b: [3]f32,
    c: [3]f32,
    uvs: [3][2]f32,
) bool {
    const n = normalOf(a, b, c);
    const positions = [3][3]f32{ a, b, c };
    for (positions, 0..) |position, corner| {
        const row = [_]f32{
            position[0],    position[1],    position[2],
            n[0],           n[1],           n[2],
            uvs[corner][0], uvs[corner][1],
        };
        if (!appendFloats(list, &row)) return false;
    }
    return true;
}

fn triArea2(a: [3]f32, b: [3]f32, c: [3]f32) f32 {
    const cr = vcross(vsub(b, a), vsub(c, a));
    return vdot(cr, cr);
}

fn appendQuadSplit(list: *std.ArrayListUnmanaged(f32), a: [3]f32, b: [3]f32, c: [3]f32, d: [3]f32) bool {
    const score_ac = @min(triArea2(a, b, c), triArea2(a, c, d));
    const score_bd = @min(triArea2(a, b, d), triArea2(b, c, d));
    if (score_bd > score_ac) {
        return appendTri(list, a, b, d) and appendTri(list, b, c, d);
    }
    return appendTri(list, a, b, c) and appendTri(list, a, c, d);
}

/// A face's TRUE colour: the saved pre-tint base when the face is selection-tinted,
/// else the live atlas centroid texel. Every colour snapshot/carry reads through this
/// so the selection orange never bakes into carried or journaled colours.
fn trueFaceColor(f: u32) [4]u8 {
    if (mesh_edit.savedFaceBaseColor(f)) |c| return c;
    return model_paint.faceColor(f) orelse model_paint.DEFAULT_FACE;
}

fn collectCurrentFaceColors() ?[]u8 {
    const fc = model_paint.faceCount();
    const colors = std.heap.c_allocator.alloc(u8, @as(usize, fc) * 4) catch return null;
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        const c = trueFaceColor(f);
        colors[f * 4 + 0] = c[0];
        colors[f * 4 + 1] = c[1];
        colors[f * 4 + 2] = c[2];
        colors[f * 4 + 3] = c[3];
    }
    return colors;
}

fn applyCarriedFaceColors(old_colors: ?[]const u8, new_fc: u32) void {
    const colors = std.heap.c_allocator.alloc(u8, @as(usize, new_fc) * 4) catch return;
    defer std.heap.c_allocator.free(colors);
    var f: u32 = 0;
    while (f < new_fc) : (f += 1) {
        colors[f * 4 + 0] = model_paint.DEFAULT_FACE[0];
        colors[f * 4 + 1] = model_paint.DEFAULT_FACE[1];
        colors[f * 4 + 2] = model_paint.DEFAULT_FACE[2];
        colors[f * 4 + 3] = model_paint.DEFAULT_FACE[3];
    }
    if (old_colors) |old| {
        const carry_faces: u32 = @intCast(@min(old.len / 4, @as(usize, new_fc)));
        if (carry_faces > 0) @memcpy(colors[0 .. @as(usize, carry_faces) * 4], old[0 .. @as(usize, carry_faces) * 4]);
    }
    model_paint.applyColors(colors);
    if (model_source.colors()) |src_colors| {
        const n = @min(src_colors.len, colors.len);
        if (n > 0) @memcpy(src_colors[0..n], colors[0..n]);
    }
}

/// Apply an already-parented face-colour table after a topology rebuild. The caller
/// derives these rows through CutResult.src_face; unlike applyCarriedFaceColors this is
/// independent of the previous resident preview's face order (req_2906).
fn applyExactFaceColors(colors: []const u8, face_count: u32) bool {
    const need = @as(usize, face_count) * 4;
    if (colors.len != need) return false;
    model_paint.applyColors(colors);
    if (model_source.colors()) |dst| {
        if (dst.len < need) return false;
        @memcpy(dst[0..need], colors);
    }
    return true;
}

/// Update the source-side representative colour table without flooding the paint
/// atlas. Indexed topology installs keep the raster and UVs exactly; applyColors
/// would flatten every detailed face back to this one centroid colour.
fn applyExactSourceFaceColors(colors: []const u8, face_count: u32) bool {
    const need = @as(usize, face_count) * 4;
    if (colors.len != need) return false;
    const destination = model_source.colors() orelse return false;
    if (destination.len < need) return false;
    @memcpy(destination[0..need], colors);
    return true;
}

fn replaceActiveEditMesh(new_verts: []f32, count: u32) bool {
    const need = @as(usize, count) * 8;
    // count == 0 is a LEGITIMATE state (req_2806: deleting the last part empties the
    // model — the old refuse-to-empty guard was never asked for): setPaintTarget
    // clears the paint target below 3 verts, the empty soup stashes under a fresh
    // key, and the viewer draws nothing.
    if (count != 0 and (count < 3 or new_verts.len < need)) return false;
    const old_colors = collectCurrentFaceColors();
    defer if (old_colors) |c| std.heap.c_allocator.free(c);
    // Part ranges are pure authored-group-id spans — they survive every EDIT replace
    // (retain() clears them, which is right for a fresh LOAD but was silently destroying
    // the outliner's part identity on every topology op; req_2644). Ops that change the
    // spans (append/detach/merge/renormalize) overwrite them right after.
    const old_ranges: ?[]u32 = if (model_source.partRanges()) |pr| (std.heap.c_allocator.dupe(u32, pr) catch null) else null;
    defer if (old_ranges) |r| std.heap.c_allocator.free(r);

    const old_hash = g_edit_key_hash;
    g_edit_revision +%= 1;
    const key = std.fmt.allocPrint(std.heap.c_allocator, "modelview-edit-{x}-{d}", .{ old_hash, g_edit_revision }) catch return false;
    defer std.heap.c_allocator.free(key);

    // setPaintTarget rewrites UVs for the per-face paint atlas; retain/stash the same
    // mutated vertices so quality changes and first draw see the new topology.
    // An EDIT replace resets the stroke program (strokes can't survive a topology
    // change; the atlas texel carry preserves the pixels) — but the user's LAYER
    // table is organizational setup, not geometry: stash it so the reset re-adopts
    // it instead of nuking the layer list on every eye toggle / topo op (req_2672).
    paint_program.snapshotLayersForCarry();
    setPaintTarget(key, new_verts, count);
    model_source.retain(key, new_verts[0..need], count);
    if (old_ranges) |r| model_source.setPartRanges(r);
    applyCarriedFaceColors(old_colors, count / 3);
    if (!stashHostMesh(key, new_verts[0..need], count)) return false;
    return true;
}

/// Swap to indexed-lowered geometry without rebuilding or recolouring the live paint
/// atlas. `new_verts` already carries the old atlas's interpolated UVs. The paint
/// program and raster remain recoverable while painting is locked; an explicit atlas
/// remake is the point that resets the now-stale strokes and derives a fresh layout.
fn replaceActiveEditMeshPreservingAtlas(
    new_verts: []const f32,
    count: u32,
    groups: ?[]const u32,
    colors: []const u8,
) bool {
    const need = @as(usize, count) * 8;
    if (count < 3 or count % 3 != 0 or new_verts.len < need) return false;
    if (colors.len != @as(usize, count / 3) * 4 or model_paint.atlas() == null) return false;
    if (groups) |rows| if (rows.len < @as(usize, count / 3)) return false;

    const old_ranges: ?[]u32 = if (model_source.partRanges()) |ranges|
        (std.heap.c_allocator.dupe(u32, ranges) catch null)
    else
        null;
    defer if (old_ranges) |ranges| std.heap.c_allocator.free(ranges);
    const old_hash = g_edit_key_hash;
    g_edit_revision +%= 1;
    const key = std.fmt.allocPrint(std.heap.c_allocator, "modelview-edit-{x}-{d}", .{ old_hash, g_edit_revision }) catch return false;
    defer std.heap.c_allocator.free(key);
    const edit_copy = std.heap.c_allocator.dupe(f32, new_verts[0..need]) catch return false;
    var edit_copy_adopted = false;
    defer if (!edit_copy_adopted) std.heap.c_allocator.free(edit_copy);
    const key_copy = std.heap.c_allocator.dupe(u8, key) catch return false;
    var key_copy_adopted = false;
    defer if (!key_copy_adopted) std.heap.c_allocator.free(key_copy);
    if (!stashHostMesh(key, new_verts[0..need], count)) return false;

    // Restore any orange face tint into true paint while the OLD face indices and
    // layout still own its saved patches. The preserved atlas must never capture UI.
    mesh_edit.clearSelection();
    if (!model_paint.setTargetPreservingAtlas(hashKey(key), new_verts, count, groups)) return false;
    g_paint_layout_stale = true;

    mesh_edit.reset();
    clearActiveEditMesh();
    g_edit_verts = edit_copy;
    g_edit_key = key_copy;
    g_edit_key_hash = hashKey(key);
    g_edit_count = count;
    edit_copy_adopted = true;
    key_copy_adopted = true;

    model_source.retain(key, new_verts[0..need], count);
    if (groups) |rows| model_source.setFaceGroups(rows);
    if (old_ranges) |ranges| model_source.setPartRanges(ranges);
    if (!applyExactSourceFaceColors(colors, count / 3)) return false;
    return true;
}

fn edgeSharesVertex(a: mesh_edit.Edge, b: mesh_edit.Edge) bool {
    return a[0] == b[0] or a[0] == b[1] or a[1] == b[0] or a[1] == b[1];
}

fn dist2(a: [3]f32, b: [3]f32) f32 {
    const d = vsub(a, b);
    return vdot(d, d);
}

fn appendCurrentDisplayed(list: *std.ArrayListUnmanaged(f32)) bool {
    const verts = g_edit_verts orelse return false;
    const need = @as(usize, g_edit_count) * 8;
    if (need > verts.len) return false;
    return appendFloats(list, verts[0..need]);
}

/// The part owning the FIRST face that uses welded verts (va, vb) — where an edge op's
/// new geometry belongs. NO_PART when nothing grouped uses the edge. Reads the CURRENT
/// weld, so call it BEFORE the op replaces the mesh.
fn partOfWeldedEdge(va: u32, vb: u32) u32 {
    const fc = g_edit_count / 3;
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        var has_a = false;
        var has_b = false;
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const v = mesh_edit.cornerVertPub(f, k);
            if (v == va) has_a = true;
            if (v == vb) has_b = true;
        }
        if (has_a and has_b) return model_source.partIndexOf(model_source.faceGroupOf(f));
    }
    return model_source.NO_PART;
}

const FaceExtrudeEntity = struct {
    grouped: bool,
    group: u32,
    face: u32,
    part: u32,
    color: [4]u8,
};

fn faceExtrudePosKey(p: [3]f32) u64 {
    const q: [3]f32 = .{ p[0] + 0.0, p[1] + 0.0, p[2] + 0.0 };
    var h = std.hash.Wyhash.init(0xe47d);
    h.update(std.mem.asBytes(&q));
    return h.final();
}

fn faceEntityContains(e: FaceExtrudeEntity, f: u32) bool {
    return if (e.grouped) model_source.faceGroupOf(f) == e.group else f == e.face;
}

fn chainExtrudeBoundary(verts: []const f32, tri_count: u32, entity: FaceExtrudeEntity, out: *std.ArrayListUnmanaged([3]f32)) bool {
    const Dir = struct { from_key: u64, to_key: u64, ukey: u128, from: [3]f32 };
    var undirected = std.AutoHashMapUnmanaged(u128, u32){};
    defer undirected.deinit(std.heap.c_allocator);
    var dirs: std.ArrayListUnmanaged(Dir) = .empty;
    defer dirs.deinit(std.heap.c_allocator);

    var f: u32 = 0;
    while (f < tri_count) : (f += 1) {
        if (!faceEntityContains(entity, f)) continue;
        const base = @as(usize, f) * 24;
        if (base + 24 > verts.len) return false;
        var k: usize = 0;
        while (k < 3) : (k += 1) {
            const ia = base + k * 8;
            const ib = base + ((k + 1) % 3) * 8;
            const a: [3]f32 = .{ verts[ia + 0], verts[ia + 1], verts[ia + 2] };
            const b: [3]f32 = .{ verts[ib + 0], verts[ib + 1], verts[ib + 2] };
            const ka = faceExtrudePosKey(a);
            const kb = faceExtrudePosKey(b);
            if (ka == kb) continue;
            const ukey: u128 = (@as(u128, @min(ka, kb)) << 64) | @max(ka, kb);
            const gop = undirected.getOrPut(std.heap.c_allocator, ukey) catch return false;
            if (!gop.found_existing) gop.value_ptr.* = 0;
            gop.value_ptr.* += 1;
            dirs.append(std.heap.c_allocator, .{ .from_key = ka, .to_key = kb, .ukey = ukey, .from = a }) catch return false;
        }
    }

    const Next = struct { to_key: u64, from: [3]f32 };
    var adj = std.AutoHashMapUnmanaged(u64, Next){};
    defer adj.deinit(std.heap.c_allocator);
    var boundary_n: u32 = 0;
    var start_key: u64 = 0;
    var have_start = false;
    for (dirs.items) |de| {
        if ((undirected.get(de.ukey) orelse 0) != 1) continue;
        boundary_n += 1;
        const gop = adj.getOrPut(std.heap.c_allocator, de.from_key) catch return false;
        if (gop.found_existing) return false;
        gop.value_ptr.* = .{ .to_key = de.to_key, .from = de.from };
        if (!have_start) {
            start_key = de.from_key;
            have_start = true;
        }
    }
    if (!have_start or boundary_n < 3) return false;

    var cur = start_key;
    var count: u32 = 0;
    while (count < boundary_n) {
        const e = adj.get(cur) orelse return false;
        out.append(std.heap.c_allocator, e.from) catch return false;
        count += 1;
        cur = e.to_key;
        if (cur == start_key) break;
    }
    return cur == start_key and count == boundary_n;
}

fn faceLoopNormal(loop: []const [3]f32) [3]f32 {
    var n: [3]f32 = .{ 0, 0, 0 };
    for (loop, 0..) |cur, i| {
        const nxt = loop[(i + 1) % loop.len];
        n[0] += (cur[1] - nxt[1]) * (cur[2] + nxt[2]);
        n[1] += (cur[2] - nxt[2]) * (cur[0] + nxt[0]);
        n[2] += (cur[0] - nxt[0]) * (cur[1] + nxt[1]);
    }
    const l = @sqrt(vdot(n, n));
    if (l > 1e-8) return .{ n[0] / l, n[1] / l, n[2] / l };
    if (loop.len >= 3) return normalOf(loop[0], loop[1], loop[2]);
    return .{ 0, 1, 0 };
}

fn faceLoopCentroid(loop: []const [3]f32) [3]f32 {
    var c: [3]f32 = .{ 0, 0, 0 };
    for (loop) |p| c = vadd(c, p);
    const inv = if (loop.len > 0) 1.0 / @as(f32, @floatFromInt(loop.len)) else 1.0;
    return vmul(c, inv);
}

fn appendFaceColor(list: *std.ArrayListUnmanaged(u8), c: [4]u8) bool {
    list.appendSlice(std.heap.c_allocator, c[0..]) catch return false;
    return true;
}

/// req_2644: an edge op (extrude / create face) appends faces and used to let retain()
/// silently DROP the whole authored grouping — the mesh went ungrouped, and with it every
/// part range. Re-apply the pre-op grouping, give the appended faces one fresh authored
/// id, and fold them into `src_part`'s contiguous range (renormalize keeps the partition).
fn adoptAppendedFaces(old_groups: ?[]const u32, old_faces: u32, src_part: u32) void {
    const og = old_groups orelse return; // ungrouped import — nothing to maintain
    const fc = g_edit_count / 3;
    if (fc <= old_faces or og.len < old_faces) return;
    const groups = std.heap.c_allocator.alloc(u32, fc) catch return;
    defer std.heap.c_allocator.free(groups);
    @memcpy(groups[0..old_faces], og[0..old_faces]);
    const new_id: u32 = @intCast(maxGroupId(og[0..old_faces]) + 1);
    @memset(groups[old_faces..fc], new_id);
    model_source.setFaceGroups(groups);
    const pc = hostPartCount();
    if (pc > 0) {
        const fp = std.heap.c_allocator.alloc(u32, fc) catch return;
        defer std.heap.c_allocator.free(fp);
        var f: u32 = 0;
        while (f < old_faces) : (f += 1) fp[f] = model_source.partIndexOf(og[f]);
        @memset(fp[old_faces..fc], src_part);
        renormalizePartRanges(fp, pc);
    }
    _ = refreshPaintLayout();
}

pub fn meshTopoExtrudeFace(distance_raw: f32) bool {
    if (!model_paint.hasTarget()) return false;
    if (mesh_edit.mode() != .face) return false;
    const cur_verts = g_edit_verts orelse return false;
    const tri_count = g_edit_count / 3;
    if (tri_count == 0) return false;

    const mask = std.heap.c_allocator.alloc(bool, tri_count) catch return false;
    defer std.heap.c_allocator.free(mask);
    const selected = mesh_edit.buildDeleteMask(mask);
    if (selected == 0) return false;

    const has_groups = model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP;
    var entity: ?FaceExtrudeEntity = null;
    var f: u32 = 0;
    while (f < tri_count) : (f += 1) {
        if (!mask[f]) continue;
        const g = if (has_groups) model_source.faceGroupOf(f) else model_source.NO_FACE_GROUP;
        const grouped = has_groups and g != model_source.NO_FACE_GROUP;
        if (entity) |e| {
            if (grouped and e.grouped and e.group == g) continue;
            return false; // face extrude is intentionally one authored face at a time
        }
        entity = .{
            .grouped = grouped,
            .group = g,
            .face = f,
            .part = if (grouped) model_source.partIndexOf(g) else model_source.NO_PART,
            .color = trueFaceColor(f),
        };
    }
    const ent = entity orelse return false;

    const old_groups: ?[]u32 = if (has_groups) (captureFaceGroups() orelse return false) else null;
    defer if (old_groups) |g| std.heap.c_allocator.free(g);
    const part_count = hostPartCount();

    var loop: std.ArrayListUnmanaged([3]f32) = .empty;
    defer loop.deinit(std.heap.c_allocator);
    if (!chainExtrudeBoundary(cur_verts, tri_count, ent, &loop) or loop.items.len < 3) return false;
    const n = faceLoopNormal(loop.items);
    const dist = if (@abs(distance_raw) > 1e-6) distance_raw else @max(0.05, g_orbit.radius * 0.08);
    const off = vmul(n, dist);
    const center = faceLoopCentroid(loop.items);

    var out: std.ArrayListUnmanaged(f32) = .empty;
    defer out.deinit(std.heap.c_allocator);
    var groups: std.ArrayListUnmanaged(u32) = .empty;
    defer groups.deinit(std.heap.c_allocator);
    var face_part: std.ArrayListUnmanaged(u32) = .empty;
    defer face_part.deinit(std.heap.c_allocator);
    var colors: std.ArrayListUnmanaged(u8) = .empty;
    defer colors.deinit(std.heap.c_allocator);

    f = 0;
    while (f < tri_count) : (f += 1) {
        if (mask[f]) continue;
        const base = @as(usize, f) * 24;
        if (base + 24 > cur_verts.len) return false;
        if (!appendFloats(&out, cur_verts[base .. base + 24])) return false;
        if (has_groups) {
            const g = old_groups.?[f];
            groups.append(std.heap.c_allocator, g) catch return false;
            if (part_count > 0) face_part.append(std.heap.c_allocator, model_source.partIndexOf(g)) catch return false;
        }
        if (!appendFaceColor(&colors, trueFaceColor(f))) return false;
    }

    var next_group: u32 = if (has_groups) @intCast(maxGroupId(old_groups.?) + 1) else 0;
    const cap_group = if (has_groups) ent.group else model_source.NO_FACE_GROUP;
    const cap_start_face: u32 = @intCast(out.items.len / 24);

    var i: usize = 1;
    while (i + 1 < loop.items.len) : (i += 1) {
        const a = vadd(loop.items[0], off);
        const b = vadd(loop.items[i], off);
        const c = vadd(loop.items[i + 1], off);
        if (!appendTri(&out, a, b, c)) return false;
        if (has_groups) {
            groups.append(std.heap.c_allocator, cap_group) catch return false;
            if (part_count > 0) face_part.append(std.heap.c_allocator, ent.part) catch return false;
        }
        if (!appendFaceColor(&colors, ent.color)) return false;
    }

    i = 0;
    while (i < loop.items.len) : (i += 1) {
        const a = loop.items[i];
        const b = loop.items[(i + 1) % loop.items.len];
        const a2 = vadd(a, off);
        const b2 = vadd(b, off);
        const qc = vmul(vadd(vadd(a, b), vadd(a2, b2)), 0.25);
        const wn = normalOf(a, b, b2);
        const side_group = if (has_groups) blk: {
            const g = next_group;
            next_group += 1;
            break :blk g;
        } else model_source.NO_FACE_GROUP;
        const ok = if (vdot(wn, vsub(qc, center)) < 0)
            appendQuadSplit(&out, a2, b2, b, a)
        else
            appendQuadSplit(&out, a, b, b2, a2);
        if (!ok) return false;
        if (has_groups) {
            groups.append(std.heap.c_allocator, side_group) catch return false;
            groups.append(std.heap.c_allocator, side_group) catch return false;
            if (part_count > 0) {
                face_part.append(std.heap.c_allocator, ent.part) catch return false;
                face_part.append(std.heap.c_allocator, ent.part) catch return false;
            }
        }
        if (!appendFaceColor(&colors, ent.color) or !appendFaceColor(&colors, ent.color)) return false;
    }

    const new_count: u32 = @intCast(out.items.len / 8);
    if (new_count == g_edit_count) return false;
    var snap = journalSnapshotCurrent("extrude face");
    mesh_edit.clearSelection();
    if (!replaceActiveEditMesh(out.items, new_count)) {
        journalDiscard(&snap);
        return false;
    }
    if (has_groups) {
        model_source.setFaceGroups(groups.items);
        if (part_count > 0) renormalizePartRanges(face_part.items, part_count) else _ = refreshPaintLayout();
    }
    model_paint.applyColors(colors.items);
    if (model_source.colors()) |src| {
        const nbytes = @min(src.len, colors.items.len);
        if (nbytes > 0) @memcpy(src[0..nbytes], colors.items[0..nbytes]);
    }
    const cap_group_after = if (has_groups) model_source.faceGroupOf(cap_start_face) else model_source.NO_FACE_GROUP;
    ensureGlassTrailing();
    if (cap_group_after != model_source.NO_FACE_GROUP) {
        _ = mesh_edit.selectFacesByGroupRange(cap_group_after, cap_group_after + 1, false);
    } else {
        _ = mesh_edit.selectFaceByIndex(cap_start_face, false);
    }
    mesh_edit.setMode(.face);
    journalCommit(&snap);
    return true;
}

/// Select the welded edge whose endpoints sit at (p, q) — how a topo op hands its NEW
/// edge to the gizmo so the user can move it without re-clicking (req_3114).
fn selectWeldedEdgeAt(p: [3]f32, q: [3]f32) bool {
    if (!mesh_edit.ensureTopologyPub()) return false;
    const eps2: f32 = 1e-8;
    const n = mesh_edit.edgeCount();
    var e: u32 = 0;
    while (e < n) : (e += 1) {
        const ep = mesh_edit.edgeEndpointsPub(e);
        const va = mesh_edit.vertPosPub(ep[0]);
        const vb = mesh_edit.vertPosPub(ep[1]);
        if ((dist2(va, p) <= eps2 and dist2(vb, q) <= eps2) or
            (dist2(va, q) <= eps2 and dist2(vb, p) <= eps2))
            return mesh_edit.selectEdgeByIndex(e, false);
    }
    return false;
}

pub fn meshTopoExtrudeEdge(distance_raw: f32) bool {
    if (!model_paint.hasTarget()) return false;
    const edge_idx = mesh_edit.selectedEdgeIndexPub() orelse return false;
    const ep = mesh_edit.edgeEndpointsPub(edge_idx);
    const a = mesh_edit.vertPosPub(ep[0]);
    const b = mesh_edit.vertPosPub(ep[1]);
    var n = mesh_edit.edgeAverageNormalPub(edge_idx);
    if (vdot(n, n) < 0.5) n = .{ 0, 1, 0 };
    const dist = if (@abs(distance_raw) > 1e-6) distance_raw else @max(0.05, g_orbit.radius * 0.08);
    const c = vadd(a, vmul(n, dist));
    const d = vadd(b, vmul(n, dist));

    var verts: std.ArrayListUnmanaged(f32) = .empty;
    if (!appendCurrentDisplayed(&verts)) {
        verts.deinit(std.heap.c_allocator);
        return false;
    }
    if (!appendQuadSplit(&verts, a, b, d, c)) {
        verts.deinit(std.heap.c_allocator);
        return false;
    }
    const owned = verts.toOwnedSlice(std.heap.c_allocator) catch {
        verts.deinit(std.heap.c_allocator);
        return false;
    };
    defer std.heap.c_allocator.free(owned);
    // Grouping bookkeeping BEFORE the replace wipes it (req_2644).
    const old_faces = g_edit_count / 3;
    const old_groups: ?[]u32 = if (model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP) captureFaceGroups() else null;
    defer if (old_groups) |g| std.heap.c_allocator.free(g);
    const src_part = partOfWeldedEdge(ep[0], ep[1]);
    var snap = journalSnapshotCurrent("extrude edge");
    const ok = replaceActiveEditMesh(owned, g_edit_count + 6);
    if (ok) {
        adoptAppendedFaces(old_groups, old_faces, src_part);
        _ = selectWeldedEdgeAt(c, d);
        mesh_edit.setMode(.edge);
        journalCommit(&snap);
    } else journalDiscard(&snap);
    return ok;
}

fn findUniqueIndex(items: []const u32, count: u32, v: u32) ?usize {
    var i: u32 = 0;
    while (i < count) : (i += 1) {
        if (items[i] == v) return i;
    }
    return null;
}

fn edgeConnects(edges: []const mesh_edit.Edge, a: u32, b: u32) bool {
    for (edges) |e| {
        if ((e[0] == a and e[1] == b) or (e[0] == b and e[1] == a)) return true;
    }
    return false;
}

fn closedEdgeLoopOrder(edges: []const mesh_edit.Edge, out: *[4]u32) ?u32 {
    if (edges.len < 3 or edges.len > 4) return null;
    var unique: [4]u32 = undefined;
    var degree = [_]u8{0} ** 4;
    var unique_count: u32 = 0;
    for (edges) |e| {
        var k: usize = 0;
        while (k < 2) : (k += 1) {
            const v = e[k];
            const idx = findUniqueIndex(unique[0..], unique_count, v) orelse blk: {
                if (unique_count >= unique.len) return null;
                unique[unique_count] = v;
                unique_count += 1;
                break :blk @as(usize, @intCast(unique_count - 1));
            };
            degree[idx] += 1;
        }
    }
    if (unique_count != edges.len) return null;
    var i: u32 = 0;
    while (i < unique_count) : (i += 1) {
        if (degree[i] != 2) return null;
    }

    out[0] = edges[0][0];
    out[1] = edges[0][1];
    var prev = out[0];
    var curr = out[1];
    var n: u32 = 2;
    while (n < unique_count) : (n += 1) {
        var next: ?u32 = null;
        for (edges) |e| {
            if (e[0] == curr and e[1] != prev) next = e[1];
            if (e[1] == curr and e[0] != prev) next = e[0];
        }
        const v = next orelse return null;
        if (v == out[0]) return null;
        out[n] = v;
        prev = curr;
        curr = v;
    }
    if (!edgeConnects(edges, curr, out[0])) return null;
    return unique_count;
}

pub fn meshTopoCreateFaceFromEdges() bool {
    if (!model_paint.hasTarget()) return false;
    var selected: [16]mesh_edit.Edge = undefined;
    const selected_count = mesh_edit.selectedEdgesPub(selected[0..]);
    if (selected_count < 2 or selected_count > selected.len) return false;
    const edges = selected[0..@as(usize, @intCast(selected_count))];

    var verts: std.ArrayListUnmanaged(f32) = .empty;
    if (!appendCurrentDisplayed(&verts)) {
        verts.deinit(std.heap.c_allocator);
        return false;
    }

    var ok = false;
    if (selected_count == 2) {
        if (!edgeSharesVertex(edges[0], edges[1])) {
            const a = mesh_edit.vertPosPub(edges[0][0]);
            const b = mesh_edit.vertPosPub(edges[0][1]);
            var c = mesh_edit.vertPosPub(edges[1][0]);
            var d = mesh_edit.vertPosPub(edges[1][1]);
            if (dist2(a, d) + dist2(b, c) < dist2(a, c) + dist2(b, d)) {
                const tmp = c;
                c = d;
                d = tmp;
            }
            ok = appendQuadSplit(&verts, a, b, d, c);
        } else {
            var order: [3]u32 = undefined;
            if (mesh_edit.triangleFromAdjacentEdges(edges[0], edges[1], &order)) {
                ok = appendTri(
                    &verts,
                    mesh_edit.vertPosPub(order[0]),
                    mesh_edit.vertPosPub(order[1]),
                    mesh_edit.vertPosPub(order[2]),
                );
            }
        }
    } else {
        var order: [4]u32 = undefined;
        if (closedEdgeLoopOrder(edges, &order)) |n| {
            const p0 = mesh_edit.vertPosPub(order[0]);
            const p1 = mesh_edit.vertPosPub(order[1]);
            const p2 = mesh_edit.vertPosPub(order[2]);
            ok = if (n == 3) appendTri(&verts, p0, p1, p2) else appendQuadSplit(&verts, p0, p1, p2, mesh_edit.vertPosPub(order[3]));
        }
    }
    if (!ok) {
        verts.deinit(std.heap.c_allocator);
        return false;
    }
    const owned = verts.toOwnedSlice(std.heap.c_allocator) catch {
        verts.deinit(std.heap.c_allocator);
        return false;
    };
    defer std.heap.c_allocator.free(owned);
    const added: u32 = @intCast((owned.len / 8) - @as(usize, g_edit_count));
    // Grouping bookkeeping BEFORE the replace wipes it (req_2644): the bridged face
    // joins the part of the first selected edge's face.
    const old_faces = g_edit_count / 3;
    const old_groups: ?[]u32 = if (model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP) captureFaceGroups() else null;
    defer if (old_groups) |g| std.heap.c_allocator.free(g);
    const src_part = partOfWeldedEdge(edges[0][0], edges[0][1]);
    var snap = journalSnapshotCurrent("create face");
    const replaced = replaceActiveEditMesh(owned, g_edit_count + added);
    if (replaced) {
        adoptAppendedFaces(old_groups, old_faces, src_part);
        // Create Face hands the next edit to its result: Face mode + exactly the new
        // authored face selected, so X can reverse an unlucky winding immediately.
        _ = mesh_edit.focusCreatedFace(old_faces, added / 3);
        journalCommit(&snap);
    } else journalDiscard(&snap);
    return replaced;
}

// ── Part-range truth (req_2644) ──────────────────────────────────────────────────
// The outliner's parts are contiguous authored-group-id ranges. Topology cuts mint
// FRESH ids for their new pieces, so after a cut a part's faces no
// longer sit inside its [lo,hi) — the cart's stale ranges then select the wrong slab,
// tear the mesh on part moves, and mis-scope appended parts. The host is the single
// source of truth: ops that re-group carry per-face part parentage through the cut and
// renormalize below; __mesh_part_ranges reads the result back for the cart to mirror.

/// The number of parts currently declared (0 = unparted mesh — plain viewer flows).
fn hostPartCount() u32 {
    const pr = model_source.partRanges() orelse return 0;
    return @intCast(pr.len / 2);
}

/// One part index per DISPLAYED face, from the current ranges (caller frees).
/// Null when the mesh has no parts or no grouping — callers skip renormalizing.
fn capturePartOfFaces() ?[]u32 {
    if (hostPartCount() == 0) return null;
    if (model_source.faceGroupOf(0) == model_source.NO_FACE_GROUP) return null;
    const fc = g_edit_count / 3;
    const out = std.heap.c_allocator.alloc(u32, fc) catch return null;
    var f: u32 = 0;
    while (f < fc) : (f += 1) out[f] = model_source.partIndexOf(model_source.faceGroupOf(f));
    return out;
}

/// Renumber the CURRENT face grouping so every part's distinct groups are contiguous
/// again — parts keep their (ascending-lo) order — and re-derive the part ranges from
/// the result. `face_part` is one part index per displayed face (NO_PART = unowned;
/// those ids land after every part, outside all ranges). Rebuilds the weld/scope
/// (mesh_edit.reset) because part membership changed, so this DROPS the selection —
/// callers re-select after when the op's contract wants one.
fn renormalizePartRanges(face_part: []const u32, part_count: u32) void {
    if (part_count == 0) return;
    if (model_source.faceGroupOf(0) == model_source.NO_FACE_GROUP) return;
    const fc = g_edit_count / 3;
    if (face_part.len < fc) return;
    const groups = captureFaceGroups() orelse return;
    defer std.heap.c_allocator.free(groups);
    const new_groups = std.heap.c_allocator.alloc(u32, fc) catch return;
    defer std.heap.c_allocator.free(new_groups);
    var ranges: std.ArrayListUnmanaged(u32) = .empty;
    defer ranges.deinit(std.heap.c_allocator);

    var next: u32 = 0;
    var p: u32 = 0;
    while (p <= part_count) : (p += 1) { // the extra pass sweeps NO_PART faces
        const want: u32 = if (p == part_count) model_source.NO_PART else p;
        const start = next;
        var remap = std.AutoHashMapUnmanaged(u32, u32){};
        defer remap.deinit(std.heap.c_allocator);
        var f: u32 = 0;
        while (f < fc) : (f += 1) {
            if (face_part[f] != want) continue;
            if (groups[f] == model_source.NO_FACE_GROUP) {
                new_groups[f] = groups[f];
                continue;
            }
            const gop = remap.getOrPut(std.heap.c_allocator, groups[f]) catch return;
            if (!gop.found_existing) {
                gop.value_ptr.* = next;
                next += 1;
            }
            new_groups[f] = gop.value_ptr.*;
        }
        if (p < part_count) {
            ranges.append(std.heap.c_allocator, start) catch return;
            ranges.append(std.heap.c_allocator, next) catch return;
        }
    }
    model_source.setFaceGroups(new_groups);
    model_source.setPartRanges(ranges.items);
    mesh_edit.reset(); // part membership moved → weld/scope masks are stale
    _ = refreshPaintLayout(); // islands key off the grouping
}

/// Tripwire for the partition invariant (req_3032). Part spans must be pairwise
/// disjoint — ownership is span-containment arithmetic, so an overlap means faces
/// with two owners and every range-scoped op (select, gizmo, delete, paint) acting
/// on the wrong geometry, discovered N edits too late (req_3029: a part minted
/// inside another's span). Every path that installs ranges runs this after. An
/// overlap is LOUD and heals immediately: each contested group id goes to the
/// LATEST containing part (the one whose op minted it) and the partition
/// renormalizes to clean contiguous spans. Returns true when a repair ran.
fn ensureDisjointPartRanges(context: []const u8) bool {
    const pr = model_source.partRanges() orelse return false;
    const pc = pr.len / 2;
    if (pc < 2) return false;
    var overlap = false;
    var i: usize = 0;
    outer: while (i < pc) : (i += 1) {
        const ilo = pr[i * 2];
        const ihi = pr[i * 2 + 1];
        if (ilo >= ihi) continue; // empty span owns nothing — nothing to contest
        var j: usize = i + 1;
        while (j < pc) : (j += 1) {
            const jlo = pr[j * 2];
            const jhi = pr[j * 2 + 1];
            if (jlo >= jhi) continue;
            if (ilo < jhi and jlo < ihi) {
                overlap = true;
                break :outer;
            }
        }
    }
    if (!overlap) return false;
    log.print("[mesh] part ranges OVERLAP after {s} — face ownership was ambiguous; repairing: contested group ids go to the latest containing part, partition renormalized (req_3032)\n", .{context});
    const fc = g_edit_count / 3;
    if (fc == 0 or model_source.faceGroupOf(0) == model_source.NO_FACE_GROUP) return false;
    const face_part = std.heap.c_allocator.alloc(u32, fc) catch return false;
    defer std.heap.c_allocator.free(face_part);
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        const g = model_source.faceGroupOf(f);
        var owner: u32 = model_source.NO_PART;
        if (g != model_source.NO_FACE_GROUP) {
            var p: usize = 0;
            while (p < pc) : (p += 1) {
                if (g >= pr[p * 2] and g < pr[p * 2 + 1]) owner = @intCast(p);
            }
        }
        face_part[f] = owner;
    }
    renormalizePartRanges(face_part, @intCast(pc));
    return true;
}

/// Run the js-bench-editor/Blockbench topological loop walk from the selected edge.
/// Rendering remains triangle soup, but adjacency and traversal use stable vertex ids;
/// a boundary, non-quad, or closed ring terminates the walk instead of changing the
/// operation into an infinite plane slice.
pub fn meshTopoLoopCut() bool {
    if (!model_paint.hasTarget()) return false;
    const edge_idx = mesh_edit.selectedEdgeIndexPub() orelse return false;
    const ep = mesh_edit.edgeEndpointsPub(edge_idx);
    const a = mesh_edit.vertPosPub(ep[0]);
    const b = mesh_edit.vertPosPub(ep[1]);
    const selected_part = mesh_edit.selectedEdgePartPub();
    if (vdot(vsub(b, a), vsub(b, a)) < 1e-12) return false;

    const verts = g_edit_verts orelse return false;
    const tri_count = g_edit_count / 3;
    if (tri_count == 0) return false;
    const base_colors = collectCurrentFaceColors() orelse return false;
    defer std.heap.c_allocator.free(base_colors);

    // Per-tri authored group (null when this mesh has no grouping — plain imports).
    var groups_buf: ?[]u32 = null;
    defer if (groups_buf) |g| std.heap.c_allocator.free(g);
    if (model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP) {
        const g = std.heap.c_allocator.alloc(u32, tri_count) catch return false;
        var i: u32 = 0;
        while (i < tri_count) : (i += 1) g[i] = model_source.faceGroupOf(i);
        groups_buf = g;
    }

    // Per-face part parentage BEFORE the cut, so the fresh group ids the cut mints can
    // renormalize back into their parts' contiguous ranges after install (req_2644).
    const base_part = capturePartOfFaces();
    defer if (base_part) |bp| std.heap.c_allocator.free(bp);
    const part_count = hostPartCount();

    const groups_arg: ?[]const u32 = if (groups_buf) |g| g else null;
    const parts_arg: ?[]const u32 = if (base_part) |p| p else null;
    var indexed = cloneIndexedEditMeshOrImport(verts, tri_count, groups_arg, parts_arg) orelse return false;
    defer indexed.deinit();
    if (!(indexed.loopCutFromEdge(a, b, selected_part, 1, 0.5) catch return false)) return false;
    var cut = indexed.lower() catch return false;
    defer cut.deinit();
    if (cut.tri_count <= tri_count) return false;
    const cut_colors = std.heap.c_allocator.alloc(u8, @as(usize, cut.tri_count) * 4) catch return false;
    defer std.heap.c_allocator.free(cut_colors);
    if (!mesh_edit.inheritFaceRgba(base_colors, cut.source_triangles, cut_colors)) return false;

    var snap = journalSnapshotCurrent("loop cut");
    const install_groups: ?[]const u32 = if (groups_arg != null) cut.groups else null;
    const ok = lcInstallLowered(cut.positions, cut.uvs, cut.tri_count, install_groups, cut_colors);
    if (ok) {
        if (base_part) |bp| {
            _ = bp;
            renormalizePartRanges(cut.parts, part_count);
        }
        adoptIndexedEditMesh(&indexed, &cut);
        mesh_edit.setMode(.edge);
        journalCommit(&snap);
    } else journalDiscard(&snap);
    return ok;
}

// ── Symmetrize + symmetry check (the studio's req_1190/1191/1192, host-native — req_2831) ──
// The trust layer the mirror planes shipped without: a live "is it symmetric?" count and
// the keep+/− repair. Both use the same per-outliner-part identity domains and bounds
// centers as live mirrored transforms. Scope is authoritative: focused parts are repaired,
// and every other part passes through untouched.

/// Returns {display center, unmatched, total} for logical vertices in the current
/// outliner scope. Pairing is part-local, exactly like live mirrored transforms.
pub fn meshSymmetryReport(axis: u8) ?[3]f32 {
    if (axis > 2 or !model_paint.hasTarget()) return null;
    return mesh_edit.symmetryReportPub(axis);
}

/// Port of Studio symmetrize (req_1190): repair the active outliner part(s), not the
/// composed model. Each part cuts at its own live-mirror center, drops the far half,
/// and emits reflected reverse-wound twins. Selection clears, as in the original UI.
pub fn meshTopoSymmetrize(axis: u8, keep_positive: bool) bool {
    if (axis > 2 or !model_paint.hasTarget()) return false;
    const original_mode = mesh_edit.mode();
    const verts = g_edit_verts orelse return false;
    const tri_count = g_edit_count / 3;
    if (tri_count == 0) return false;
    const base_colors = collectCurrentFaceColors() orelse return false;
    defer std.heap.c_allocator.free(base_colors);
    const groups = captureFaceGroups();
    defer if (groups) |rows| std.heap.c_allocator.free(rows);
    const parts = capturePartOfFaces();
    defer if (parts) |rows| std.heap.c_allocator.free(rows);
    const part_count = hostPartCount();
    const groups_arg: ?[]const u32 = if (model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP) groups else null;
    var indexed = cloneIndexedEditMeshOrImport(verts, tri_count, groups_arg, parts) orelse return false;
    defer indexed.deinit();
    if (parts) |face_parts| {
        if (part_count == 0) return false;
        const target_parts = std.heap.c_allocator.alloc(bool, @intCast(part_count)) catch return false;
        defer std.heap.c_allocator.free(target_parts);
        @memset(target_parts, false);
        var face: u32 = 0;
        while (face < tri_count) : (face += 1) {
            if (!mesh_edit.faceInScopePub(face)) continue;
            const part = face_parts[@intCast(face)];
            const part_index: usize = @intCast(part);
            if (part_index < target_parts.len) target_parts[part_index] = true;
        }
        if (!(indexed.symmetrizeParts(axis, keep_positive, target_parts) catch return false)) return false;
    } else {
        const frame = mesh_edit.mirrorFramePub() orelse return false;
        if (!(indexed.symmetrize(axis, frame.center[axis], keep_positive) catch return false)) return false;
    }
    var lowered = indexed.lower() catch return false;
    defer lowered.deinit();
    if (lowered.tri_count == 0) return false;
    const colors = std.heap.c_allocator.alloc(u8, @as(usize, lowered.tri_count) * 4) catch return false;
    defer std.heap.c_allocator.free(colors);
    if (!mesh_edit.inheritFaceRgba(base_colors, lowered.source_triangles, colors)) return false;

    var snap = journalSnapshotCurrent("symmetrize");
    const install_groups: ?[]const u32 = if (groups_arg != null) lowered.groups else null;
    const ok = lcInstallLowered(lowered.positions, lowered.uvs, lowered.tri_count, install_groups, colors);
    if (ok) {
        if (parts != null) renormalizePartRanges(lowered.parts, part_count);
        adoptIndexedEditMesh(&indexed, &lowered);
        // The shared indexed-lowering install deliberately enters face mode.
        // Studio symmetrize instead preserves the active tool and clears its selection.
        mesh_edit.setMode(original_mode);
        mesh_edit.clearSelection();
        journalCommit(&snap);
    } else journalDiscard(&snap);
    return ok;
}

// ── Loop cut on a FACE: reference topological walk in a host-owned session ────
// Direction selects an ordered edge of the clicked face. The cut follows opposite
// edges by stable vertex identity, terminates at boundaries/non-quads, and previews
// live from a captured indexed base. Journal commit happens only on end(commit);
// cancel restores the base exactly and leaves no undo entry.
const LcSession = struct {
    basic: bool,
    base_mesh: indexed_edit_mesh.Mesh,
    last_mesh: ?indexed_edit_mesh.Mesh,
    base_paint_layout_stale: bool,
    base_groups: ?[]u32, // per-tri authored groups at begin (null = ungrouped import)
    base_colors: []u8, // true RGBA per base face; previews inherit through src_face
    // Exact authored face selection at begin. A face is selected only when all render
    // triangles derived from it are selected.
    base_cut_mask: []bool,
    // Part parentage (req_2644): one part index per BASE face at begin, and the same
    // carried through the LAST installed preview — commit renormalizes the minted
    // group ids back into contiguous per-part ranges from this.
    base_face_part: ?[]u32,
    last_face_part: ?[]u32, // per LAST-preview face; aliases nothing (owned)
    part_count: u32,
    // The seed face's first two ordered edge directions. Popup direction 0/1 chooses
    // the same edge index that the reference walk receives; these vectors only drive
    // the overlay handle and never determine topological adjacency.
    dirs: [2][3]f32,
    lo: [2]f32, // selected-face extent along each cut direction (dot-space)
    hi: [2]f32,
    keep_group: u32, // clicked face's group id — its −side piece re-selects after commit
    snap: ?JournalEntry,
    // Overlay visibility (req_2625): the selection's world centroid at begin anchors
    // the handle; last_planes is a visual guide, not the cutting algorithm.
    sel_center: [3]f32 = .{ 0, 0, 0 },
    last_dir: u32 = 0,
    last_planes: [64]f32 = undefined,
    last_plane_count: u32 = 0,
    // Full last-preview params (req_2625 gap DD): the handle drag re-previews at the
    // session's own dir/cuts, and __mesh_lc_state echoes them back to the popup.
    last_cuts: u32 = 1,
    last_offset_frac: f32 = 0.5,
    // The handle drag's CONTINUOUS cursor offset (req_2644 QQ): previews install the
    // SNAPPED frac, so the raw position accumulates here or slow drags could never
    // cross a whole-unit detent. Every preview re-seeds it (steppers move both).
    drag_raw_frac: f32 = 0.5,
};
var g_lc: ?LcSession = null;

/// One size-unit in world space — the mesh basis (16 u = 1 tile), the loop-cut handle's
/// default snap increment (req_2644 QQ) and the studio gizmo's own step law.
const LC_SNAP_WORLD: f32 = 1.0 / 16.0;

fn lcFree() void {
    var s = g_lc orelse return;
    s.base_mesh.deinit();
    if (s.last_mesh) |*mesh| mesh.deinit();
    if (s.base_groups) |g| std.heap.c_allocator.free(g);
    std.heap.c_allocator.free(s.base_colors);
    std.heap.c_allocator.free(s.base_cut_mask);
    if (s.base_face_part) |p| std.heap.c_allocator.free(p);
    if (s.last_face_part) |p| std.heap.c_allocator.free(p);
    journalDiscard(&s.snap);
    g_lc = null;
}

/// Dominant world axis of a direction (largest |component|) — the gizmo color /
/// fallback-axis rule shared by the loop-cut handle and direction derivation.
fn domAxis(v: [3]f32) u8 {
    const x = @abs(v[0]);
    const y = @abs(v[1]);
    const z = @abs(v[2]);
    return if (x >= y and x >= z) 0 else if (y >= z) 1 else 2;
}

/// The plane comb for `cuts` planes at `offset` within [lo,hi] — the studio's
/// loopCutPositions: at offset = size/2 the planes divide the span into cuts+1 EQUAL
/// slabs; raising the offset translates the comb toward +axis, shrinking the −side
/// (selected-face) end slab. Planes that land outside the span are skipped.
fn lcPlanes(lo: f32, hi: f32, cuts: u32, offset: f32, out: []f32) u32 {
    const n: u32 = @max(1, cuts);
    const size = hi - lo;
    const even = size / @as(f32, @floatFromInt(n + 1));
    const shift = -(offset - size / 2.0);
    var m: u32 = 0;
    var k: u32 = 1;
    while (k <= n and m < out.len) : (k += 1) {
        const p = lo + @as(f32, @floatFromInt(k)) * even + shift;
        if (p > lo + 1e-5 and p < hi - 1e-5) {
            out[m] = p;
            m += 1;
        }
    }
    return m;
}

/// Derive the render soup from indexed positions + per-corner UVs and install it
/// without repacking the live paint atlas. Normals are derived here; topology and UV
/// identity remain owned by indexed_edit_mesh. Stays in face mode.
fn lcInstallLowered(
    pos: []const f32,
    uvs: []const f32,
    tri_count: u32,
    groups: ?[]const u32,
    colors: []const u8,
) bool {
    if (pos.len != @as(usize, tri_count) * 9 or
        uvs.len != @as(usize, tri_count) * 6 or
        colors.len != @as(usize, tri_count) * 4) return false;
    var out: std.ArrayListUnmanaged(f32) = .empty;
    var t: u32 = 0;
    while (t < tri_count) : (t += 1) {
        const b = @as(usize, t) * 9;
        const uv = @as(usize, t) * 6;
        const p0: [3]f32 = .{ pos[b + 0], pos[b + 1], pos[b + 2] };
        const p1: [3]f32 = .{ pos[b + 3], pos[b + 4], pos[b + 5] };
        const p2: [3]f32 = .{ pos[b + 6], pos[b + 7], pos[b + 8] };
        const tri_uvs = [3][2]f32{
            .{ uvs[uv + 0], uvs[uv + 1] },
            .{ uvs[uv + 2], uvs[uv + 3] },
            .{ uvs[uv + 4], uvs[uv + 5] },
        };
        if (!appendTriWithUvs(&out, p0, p1, p2, tri_uvs)) {
            out.deinit(std.heap.c_allocator);
            return false;
        }
    }
    const owned = out.toOwnedSlice(std.heap.c_allocator) catch {
        out.deinit(std.heap.c_allocator);
        return false;
    };
    defer std.heap.c_allocator.free(owned);
    if (!replaceActiveEditMeshPreservingAtlas(owned, tri_count * 3, groups, colors)) return false;
    mesh_edit.setMode(.face);
    return true;
}

pub const LcInfo = struct { size0: f32, size1: f32 };

/// Open a loop-cut session on the CURRENT face selection: capture the indexed base and
/// expose the first face's first two ordered edge lengths as direction choices. Returns
/// those two lengths for the popup, or null when not in face mode /
/// nothing selected. A prior session (stale popup) is dropped, not committed.
pub fn meshLoopCutFaceBegin(basic: bool) ?LcInfo {
    lcFree();
    if (!model_paint.hasTarget()) return null;
    if (mesh_edit.mode() != .face) return null;
    const verts = g_edit_verts orelse return null;
    const tri_count = g_edit_count / 3;
    if (tri_count == 0 or model_paint.faceCount() < tri_count) return null;

    const mask = std.heap.c_allocator.alloc(bool, model_paint.faceCount()) catch return null;
    defer std.heap.c_allocator.free(mask);
    if (mesh_edit.buildDeleteMask(mask) == 0) return null;
    // Selection sets can outlive a scope change. The topology session starts from the
    // intersection, never from stale selected faces in sibling outliner parts.
    var selected_in_scope: u32 = 0;
    var scoped_face: u32 = 0;
    while (scoped_face < tri_count) : (scoped_face += 1) {
        mask[scoped_face] = mask[scoped_face] and mesh_edit.faceInScopePub(scoped_face);
        if (mask[scoped_face]) selected_in_scope += 1;
    }
    if (selected_in_scope == 0) return null;

    var groups: ?[]u32 = null;
    if (model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP) {
        const g = std.heap.c_allocator.alloc(u32, tri_count) catch return null;
        var i: u32 = 0;
        while (i < tri_count) : (i += 1) g[i] = model_source.faceGroupOf(i);
        groups = g;
    }

    const base_cut_mask = std.heap.c_allocator.dupe(bool, mask[0..tri_count]) catch {
        if (groups) |g| std.heap.c_allocator.free(g);
        return null;
    };
    const base_colors = collectCurrentFaceColors() orelse {
        if (groups) |g| std.heap.c_allocator.free(g);
        std.heap.c_allocator.free(base_cut_mask);
        return null;
    };
    if (base_colors.len != @as(usize, tri_count) * 4) {
        if (groups) |g| std.heap.c_allocator.free(g);
        std.heap.c_allocator.free(base_cut_mask);
        std.heap.c_allocator.free(base_colors);
        return null;
    }

    const base_face_part = capturePartOfFaces();
    const groups_arg: ?[]const u32 = if (groups) |g| g else null;
    const parts_arg: ?[]const u32 = if (base_face_part) |p| p else null;
    var base_mesh = cloneIndexedEditMeshOrImport(verts, tri_count, groups_arg, parts_arg) orelse {
        if (groups) |g| std.heap.c_allocator.free(g);
        std.heap.c_allocator.free(base_cut_mask);
        std.heap.c_allocator.free(base_colors);
        if (base_face_part) |p| std.heap.c_allocator.free(p);
        return null;
    };
    const seed = base_mesh.seedInfo(base_cut_mask) orelse {
        base_mesh.deinit();
        if (groups) |g| std.heap.c_allocator.free(g);
        std.heap.c_allocator.free(base_cut_mask);
        std.heap.c_allocator.free(base_colors);
        if (base_face_part) |p| std.heap.c_allocator.free(p);
        return null;
    };

    g_lc = .{
        .basic = basic,
        .base_mesh = base_mesh,
        .last_mesh = null,
        .base_paint_layout_stale = g_paint_layout_stale,
        .base_groups = groups,
        .base_colors = base_colors,
        .base_cut_mask = base_cut_mask,
        .base_face_part = base_face_part,
        .last_face_part = null, // no preview yet — commit falls back to the base parts
        .part_count = hostPartCount(),
        .dirs = seed.directions,
        .lo = seed.lo,
        .hi = seed.hi,
        .keep_group = seed.keep_group,
        .snap = journalSnapshotCurrent(if (basic) "cut" else "loop cut"),
        .sel_center = seed.center,
    };
    return .{ .size0 = seed.sizes[0], .size1 = seed.sizes[1] };
}

/// Re-run the reference topological edit from the captured indexed base and lower
/// the result for rendering. No plane fallback exists: traversal termination is a
/// successful partial ring, exactly as in js-bench-editor.
pub fn meshLoopCutFacePreview(dir: u32, cuts: u32, offset_frac: f32) bool {
    const s: *LcSession = if (g_lc) |*sp| sp else return false;
    const d: usize = @min(dir, 1);
    const cut_count = @min(@max(cuts, 1), 64);
    const fraction = std.math.clamp(offset_frac, 0.0, 1.0);
    const reuse_topology = s.last_mesh != null and s.last_dir == @as(u32, @intCast(d)) and s.last_cuts == cut_count;

    // Keep the popup overlay/read-back contract. These planes are display guides only;
    // topology is determined exclusively by the indexed edge walk below.
    var planes: [64]f32 = undefined;
    const span = s.hi[d] - s.lo[d];
    if (span < 1e-6) return false;
    const n_planes = lcPlanes(s.lo[d], s.hi[d], cut_count, fraction * span, &planes);
    s.last_dir = @intCast(d);
    s.last_planes = planes;
    s.last_plane_count = n_planes;
    s.last_cuts = cut_count;
    s.last_offset_frac = fraction;
    s.drag_raw_frac = fraction;

    var preview = if (reuse_topology)
        s.last_mesh.?.clone() catch return false
    else
        s.base_mesh.clone() catch return false;
    defer preview.deinit();
    const changed = if (reuse_topology) blk: {
        preview.repositionCutVertices(cut_count, fraction);
        break :blk true;
    } else if (s.basic)
        preview.cutSelected(s.base_cut_mask, @intCast(d), cut_count, fraction) catch return false
    else
        preview.loopCut(s.base_cut_mask, @intCast(d), cut_count, fraction) catch return false;
    if (!changed) return false;

    var lowered = preview.lower() catch return false;
    defer lowered.deinit();
    const colors = std.heap.c_allocator.alloc(u8, @as(usize, lowered.tri_count) * 4) catch return false;
    defer std.heap.c_allocator.free(colors);
    if (!mesh_edit.inheritFaceRgba(s.base_colors, lowered.source_triangles, colors)) return false;

    if (s.last_face_part) |p| std.heap.c_allocator.free(p);
    s.last_face_part = null;
    if (s.base_face_part != null) {
        s.last_face_part = std.heap.c_allocator.dupe(u32, lowered.parts) catch return false;
    }
    const install_groups: ?[]const u32 = if (s.base_groups != null) lowered.groups else null;
    if (!lcInstallLowered(lowered.positions, lowered.uvs, lowered.tri_count, install_groups, colors)) return false;
    if (s.last_mesh) |*mesh| mesh.deinit();
    s.last_mesh = preview;
    preview = .{ .allocator = std.heap.c_allocator };
    return true;
}

/// Close the session. commit keeps the previewed cut as ONE journal entry and re-selects
/// the clicked face's retained piece (the indexed split keeps its original group id,
/// so the selection rides the cut like the studio's, req_0989). cancel restores the
/// captured base exactly and leaves no undo entry.
pub fn meshLoopCutFaceEnd(commit: bool) bool {
    var s = g_lc orelse return false;
    var ok = true;
    if (commit) {
        journalCommit(&s.snap);
        // Renormalize the minted +side group ids back into their parts' contiguous
        // ranges (req_2644) — remember a face carrying the clicked face's group FIRST
        // so the −side re-select below survives the renumber.
        var keep_face: ?u32 = null;
        if (s.keep_group != model_source.NO_FACE_GROUP) {
            const fc = g_edit_count / 3;
            var f: u32 = 0;
            while (f < fc) : (f += 1) {
                if (model_source.faceGroupOf(f) == s.keep_group) {
                    keep_face = f;
                    break;
                }
            }
        }
        const fp: ?[]const u32 = if (s.last_face_part) |p| p else if (s.base_face_part) |p| p else null;
        if (fp) |face_part| renormalizePartRanges(face_part, s.part_count);
        if (s.last_mesh) |*mesh| {
            if (mesh.lower()) |lowered_value| {
                var lowered = lowered_value;
                defer lowered.deinit();
                adoptIndexedEditMesh(mesh, &lowered);
            } else |_| {}
        }
        if (keep_face) |f| {
            const g = model_source.faceGroupOf(f);
            if (g != model_source.NO_FACE_GROUP) _ = mesh_edit.selectFacesByGroupRange(g, g + 1, false);
        } else if (s.keep_group != model_source.NO_FACE_GROUP) {
            _ = mesh_edit.selectFacesByGroupRange(s.keep_group, s.keep_group + 1, false);
        }
        mesh_edit.setMode(.face);
    } else {
        const groups_arg: ?[]const u32 = if (s.base_groups) |g| g else null;
        if (s.base_mesh.lower()) |lowered_value| {
            var lowered = lowered_value;
            defer lowered.deinit();
            ok = lcInstallLowered(lowered.positions, lowered.uvs, lowered.tri_count, groups_arg, s.base_colors);
        } else |_| {
            ok = false;
        }
        if (ok) {
            if (s.base_mesh.clone()) |restored_value| {
                var restored = restored_value;
                defer restored.deinit();
                if (restored.lower()) |lowered_value| {
                    var lowered = lowered_value;
                    defer lowered.deinit();
                    adoptIndexedEditMesh(&restored, &lowered);
                } else |_| {}
            } else |_| {}
            g_paint_layout_stale = s.base_paint_layout_stale;
        }
        journalDiscard(&s.snap);
    }
    s.base_mesh.deinit();
    if (s.last_mesh) |*mesh| mesh.deinit();
    if (s.base_groups) |g| std.heap.c_allocator.free(g);
    std.heap.c_allocator.free(s.base_colors);
    if (s.base_face_part) |p| std.heap.c_allocator.free(p);
    if (s.last_face_part) |p| std.heap.c_allocator.free(p);
    journalDiscard(&s.snap); // no-op when committed
    g_lc = null;
    return ok;
}

/// A loop-cut popup session is LIVE. The engine's press routing treats a live session as
/// MODAL: the drawn cut-plane handle is the only grabbable — nothing falls through to a
/// face pick that would mutate the selection the captured base was built from (req_2625
/// gap DD). The popup buttons and Esc are the exits.
pub fn meshLcActive() bool {
    return g_lc != null;
}

pub const LcState = struct { dir: u32, cuts: u32, offset_frac: f32, fallback_reason: ?[]const u8 };
/// The live session's last-previewed params — the __mesh_lc_state read-back. A host-side
/// handle drag re-previews internally, so the popup polls this to keep its steppers and
/// offset cell tracking the drag.
pub fn meshLcState() ?LcState {
    const sp: *const LcSession = if (g_lc) |*p| p else return null;
    return .{
        .dir = sp.last_dir,
        .cuts = sp.last_cuts,
        .offset_frac = sp.last_offset_frac,
        .fallback_reason = null,
    };
}

pub fn meshLcFallbackReason() ?[]const u8 {
    return null;
}

/// Delete exactly the selected mesh elements: drop every triangle the current selection
/// marks (mesh_edit.buildDeleteMask — selected faces, or faces touching a selected vert/edge)
/// and rebuild the edit mesh from the survivors, carrying their face groups. Deleting
/// EVERYTHING is allowed and empties the model (req_2806 USER RULING: the old
/// refuse-to-empty guard "shouldn't exist" — it made the outliner remove its last row
/// while the host kept a ghost mesh). An empty result is journaled like any edit, so
/// undo restores it.
pub fn meshDeleteSelection() bool {
    if (!model_paint.hasTarget()) return false;
    const verts = g_edit_verts orelse return false;
    const tri_count = g_edit_count / 3;
    if (tri_count == 0) return false;

    const mask = std.heap.c_allocator.alloc(bool, tri_count) catch return false;
    defer std.heap.c_allocator.free(mask);
    const del = mesh_edit.buildDeleteMask(mask);
    if (del == 0) return false;
    return deleteMaskedFaces(verts, tri_count, mask, "delete selection");
}

/// Delete every face whose authored group id is in [lo, hi) — the outliner removing a
/// PART. Structural, not a selection gesture: it must not route through the interactive
/// selection doors, which the paint session makes inert (req_2662) — that routing made
/// an outliner delete mid-paint silently no-op while the row still left the list (req_2981).
pub fn meshDeleteGroupRange(lo: u32, hi: u32) bool {
    if (!model_paint.hasTarget()) return false;
    const verts = g_edit_verts orelse return false;
    const tri_count = g_edit_count / 3;
    if (tri_count == 0 or hi <= lo) return false;
    const live_ranges = model_source.partRanges() orelse return false;
    if (!mesh_journal_log.hasExactPartRange(live_ranges, lo, hi)) {
        std.log.err("[mesh-part] refused delete of stale/non-part range [{d},{d})", .{ lo, hi });
        return false;
    }

    const mask = std.heap.c_allocator.alloc(bool, tri_count) catch return false;
    defer std.heap.c_allocator.free(mask);
    var del: u32 = 0;
    var f: u32 = 0;
    while (f < tri_count) : (f += 1) {
        const g = model_source.faceGroupOf(f);
        mask[f] = g != model_source.NO_FACE_GROUP and g >= lo and g < hi;
        if (mask[f]) del += 1;
    }
    if (del == 0) return false;
    return deleteMaskedFaces(verts, tri_count, mask, "delete part");
}

/// Structural part operations preserve every surviving face's stable paint key
/// (authored group + intra-group ordinal). Arm both halves of the same-document
/// target swap together: exact atlas texels for the immediate image, and the full
/// stroke program/journal for later save, replay, and paint undo. Topology edits that
/// can change a survivor's key must not use this path.
fn beginPaintStableReplace() void {
    // An empty target can be the midpoint of delete-last → undo. In that state the
    // previous target's carry is the only exact raster left; do not erase it by trying
    // to snapshot a nonexistent live atlas.
    if (model_paint.atlas() != null) {
        mesh_edit.suspendFaceTint();
        model_paint.snapshotAtlasForCarry();
        mesh_edit.resumeFaceTint();
    }
    paint_program.carryProgramAcrossNextTarget();
}

fn cancelPaintStableReplace() void {
    model_paint.dropAtlasCarry();
    paint_program.cancelProgramCarry();
}

fn paintStableJournalLabel(label: []const u8) bool {
    return std.mem.eql(u8, label, "add part") or
        std.mem.eql(u8, label, "duplicate part") or
        std.mem.eql(u8, label, "mirror part") or
        std.mem.eql(u8, label, "delete part") or
        std.mem.eql(u8, label, "hide part") or
        std.mem.eql(u8, label, "show part") or
        // Identity-mapped replacements must carry the exact atlas/program on
        // undo instead of flattening every painted island to its centroid
        // colour. Symmetrize still marks the live layout stale because it
        // rewrites topology; carrying here only protects the return trip.
        std.mem.eql(u8, label, "transform") or
        std.mem.eql(u8, label, "nudge") or
        std.mem.eql(u8, label, "scale by value") or
        std.mem.eql(u8, label, "symmetrize") or
        std.mem.eql(u8, label, "flip faces");
}

fn deleteMaskedFaces(verts: []const f32, tri_count: u32, mask: []const bool, label: []const u8) bool {
    // Drop the selection FIRST (same rule as detach/glass): the orange tint is
    // real atlas pixels with per-face saved patches, and both are keyed by the
    // CURRENT face indices. Restoring after the survivors compact would paint
    // the tint / patches onto whatever faces inherited those indices — the
    // "selection moved to the other side of the model" residue (req_2559).
    mesh_edit.clearSelection();

    const has_groups = model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP;
    var out: std.ArrayListUnmanaged(f32) = .empty;
    var groups: std.ArrayListUnmanaged(u32) = .empty;
    defer groups.deinit(std.heap.c_allocator);
    var f: u32 = 0;
    while (f < tri_count) : (f += 1) {
        if (mask[f]) continue;
        const base = @as(usize, f) * 24; // 3 verts × 8 interleaved floats
        if (base + 24 > verts.len) break;
        if (!appendFloats(&out, verts[base .. base + 24])) {
            out.deinit(std.heap.c_allocator);
            return false;
        }
        if (has_groups) groups.append(std.heap.c_allocator, model_source.faceGroupOf(f)) catch {};
    }
    const kept: u32 = @intCast(out.items.len / 8);
    const owned = out.toOwnedSlice(std.heap.c_allocator) catch {
        out.deinit(std.heap.c_allocator);
        return false;
    };
    defer std.heap.c_allocator.free(owned);

    var snap = journalSnapshotCurrent(label);
    const paint_stable = std.mem.eql(u8, label, "delete part");
    if (paint_stable) beginPaintStableReplace();
    const ok = replaceActiveEditMesh(owned, kept);
    if (!ok and paint_stable) cancelPaintStableReplace();
    if (ok) {
        if (kept > 0 and has_groups) {
            model_source.setFaceGroups(groups.items);
            _ = refreshPaintLayout();
        } else if (kept == 0) {
            model_source.setPartRanges(&.{}); // no faces → no parts own anything
        }
        journalCommit(&snap);
    } else journalDiscard(&snap);
    return ok;
}

// Snapshot the current mesh's per-face authored groups (before a replace resets them).
fn captureFaceGroups() ?[]u32 {
    const fc = g_edit_count / 3;
    const out = std.heap.c_allocator.alloc(u32, fc) catch return null;
    var f: u32 = 0;
    while (f < fc) : (f += 1) out[f] = model_source.faceGroupOf(f);
    return out;
}

fn maxGroupId(groups: []const u32) i64 {
    var mx: i64 = -1;
    for (groups) |g| {
        if (g != model_source.NO_FACE_GROUP and @as(i64, g) > mx) mx = g;
    }
    return mx;
}

/// First group id safe for a FRESH part range. maxGroupId alone is wrong here:
/// part ranges are id SPANS that keep their [lo,hi) through deletions, so after a
/// delete the max LIVING id can sit far below an existing part's hi — minting at
/// max+1 then lands the new range inside that part's span and the faces become
/// multiply-owned (sphere owned the appended cylinder, req_3029). Ops that append
/// a range pair without renormalizing must allocate above every declared hi too.
fn nextFreeGroupId(groups: []const u32) u32 {
    var next: i64 = maxGroupId(groups) + 1;
    if (model_source.partRanges()) |pr| {
        var i: usize = 1;
        while (i < pr.len) : (i += 2) {
            if (@as(i64, pr[i]) > next) next = pr[i];
        }
    }
    return @intCast(next);
}

pub const AppendResult = struct { ok: bool, lo: u32, hi: u32, count: u32 };

/// Append a fresh part's triangles to the LIVE edit mesh (which already carries the user's
/// deletes/edits), giving them a new authored-group range above every existing group. This is
/// how "add a part" preserves prior edits — it grows the host mesh instead of recomposing from
/// JS. `new_verts` is interleaved 8 f32/vert; `new_groups` is one authored id per new triangle
/// (part-local, 0-based). Returns the new group range [lo, hi). Journaled as "add part";
/// duplicate/mirror capture their own label and call the inner op directly.
pub fn meshAppendGroup(new_verts: []const f32, new_count: u32, new_groups: []const u32, expected_parts: u32) AppendResult {
    const fail = AppendResult{ .ok = false, .lo = 0, .hi = 0, .count = 0 };
    const current_faces = g_edit_count / 3;
    if (current_faces == 0) {
        if (expected_parts != 0) return fail;
    } else {
        const current_groups = captureFaceGroups() orelse return fail;
        defer std.heap.c_allocator.free(current_groups);
        var partition_groups: std.ArrayListUnmanaged(u32) = .empty;
        defer partition_groups.deinit(std.heap.c_allocator);
        partition_groups.appendSlice(std.heap.c_allocator, current_groups) catch return fail;
        // Hidden parts are absent from the displayed soup but remain members of
        // the same ownership partition in their host stash.
        for (g_hidden_groups.items) |hidden| {
            partition_groups.appendSlice(std.heap.c_allocator, hidden.groups) catch return fail;
        }
        const live_ranges = model_source.partRanges() orelse return fail;
        if (!mesh_journal_log.ownsExactPartPartition(partition_groups.items, live_ranges, expected_parts)) {
            std.log.err(
                "[mesh-part] refused append: cart expects {d} parts, host has {d} ranges over {d} faces",
                .{ expected_parts, live_ranges.len / 2, current_faces },
            );
            return fail;
        }
    }
    var snap = journalSnapshotCurrent("add part");
    const r = appendGroupInner(new_verts, new_count, new_groups);
    if (r.ok) {
        journalCommit(&snap);
        ensureGlassTrailing();
    } else journalDiscard(&snap);
    return r;
}

/// Turn one closed normalized pen path into a camera-facing plane through the
/// current orbit focus, then append it through the ordinary part transaction.
pub fn meshAppendPathPlane(points: []const f32, expected_parts: u32) AppendResult {
    const fail = AppendResult{ .ok = false, .lo = 0, .hi = 0, .count = 0 };
    if (points.len < 6 or points.len % 2 != 0 or points.len > paint_program.MAX_POLYGON_POINTS * 2) return fail;
    const camera = path_plane.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    var plane = path_plane.build(std.heap.c_allocator, points, camera, g_paint_vp_w, g_paint_vp_h) orelse return fail;
    defer plane.deinit(std.heap.c_allocator);
    return meshAppendGroup(plane.verts, @intCast(plane.verts.len / 8), plane.groups, expected_parts);
}

fn appendGroupInner(new_verts: []const f32, new_count: u32, new_groups: []const u32) AppendResult {
    const fail = AppendResult{ .ok = false, .lo = 0, .hi = 0, .count = 0 };
    // An EMPTIED model (req_2806: delete-all is legal) has no paint target but a live
    // zero-count edit mesh — appending the first part onto it is a plain install.
    if (g_edit_count > 0 and !model_paint.hasTarget()) return fail;
    const cur_verts = g_edit_verts orelse return fail;
    const cur_count = g_edit_count;
    const need = @as(usize, new_count) * 8;
    if (new_count < 3 or new_verts.len < need) return fail;

    const cur_groups = captureFaceGroups() orelse return fail;
    defer std.heap.c_allocator.free(cur_groups);
    const offset: u32 = nextFreeGroupId(cur_groups);

    const cur_faces = cur_count / 3;
    const new_faces = new_count / 3;
    var new_group_span: u32 = 0;
    {
        var i: u32 = 0;
        while (i < new_faces) : (i += 1) {
            const g = if (i < new_groups.len) new_groups[i] else 0;
            if (g + 1 > new_group_span) new_group_span = g + 1;
        }
    }

    var out: std.ArrayListUnmanaged(f32) = .empty;
    if (!appendFloats(&out, cur_verts[0 .. @as(usize, cur_count) * 8]) or !appendFloats(&out, new_verts[0..need])) {
        out.deinit(std.heap.c_allocator);
        return fail;
    }
    var groups: std.ArrayListUnmanaged(u32) = .empty;
    defer groups.deinit(std.heap.c_allocator);
    {
        groups.ensureTotalCapacity(std.heap.c_allocator, @as(usize, cur_faces + new_faces)) catch return fail;
        var f: u32 = 0;
        while (f < cur_faces) : (f += 1) groups.appendAssumeCapacity(cur_groups[f]);
        var i: u32 = 0;
        while (i < new_faces) : (i += 1) groups.appendAssumeCapacity((if (i < new_groups.len) new_groups[i] else 0) + offset);
    }
    const owned = out.toOwnedSlice(std.heap.c_allocator) catch {
        out.deinit(std.heap.c_allocator);
        return fail;
    };
    defer std.heap.c_allocator.free(owned);

    // Once an atlas exists, append is an indexed topology install too.  The legacy
    // path below rebuilt a blank target first and expected refreshPaintLayout() to
    // recover the old raster afterward.  That recovery is deliberately forbidden
    // while the UV contract is stale, which is how Add Cube could turn a painted
    // model grey.  Existing corners now keep their exact UVs/raster; fresh corners
    // point at one neutral gutter texel until the explicit Remake Atlas decision.
    var exact_colors: ?[]u8 = null;
    defer if (exact_colors) |colors| std.heap.c_allocator.free(colors);
    if (cur_count > 0) {
        const old_colors = collectCurrentFaceColors() orelse return fail;
        defer std.heap.c_allocator.free(old_colors);
        if (old_colors.len != @as(usize, cur_faces) * 4) return fail;
        const colors = std.heap.c_allocator.alloc(u8, @as(usize, cur_faces + new_faces) * 4) catch return fail;
        exact_colors = colors;
        @memcpy(colors[0..old_colors.len], old_colors);
        var f: u32 = cur_faces;
        while (f < cur_faces + new_faces) : (f += 1) {
            colors[f * 4 + 0] = model_paint.DEFAULT_FACE[0];
            colors[f * 4 + 1] = model_paint.DEFAULT_FACE[1];
            colors[f * 4 + 2] = model_paint.DEFAULT_FACE[2];
            colors[f * 4 + 3] = model_paint.DEFAULT_FACE[3];
        }
        const placeholder_uv = model_paint.reserveNeutralPlaceholderUv() orelse return fail;
        var vertex: u32 = cur_count;
        while (vertex < cur_count + new_count) : (vertex += 1) {
            owned[vertex * 8 + 6] = placeholder_uv[0];
            owned[vertex * 8 + 7] = placeholder_uv[1];
        }
    }

    // Appending onto an emptied document is the one fresh paint domain: there is no
    // atlas to preserve, so install normally and derive its first layout.
    const ok = if (cur_count > 0)
        replaceActiveEditMeshPreservingAtlas(owned, cur_count + new_count, groups.items, exact_colors.?)
    else
        replaceActiveEditMesh(owned, new_count);
    if (ok) {
        model_source.setFaceGroups(groups.items);
        // The appended part joins the host's part-range truth (req_2644): grow the
        // preserved ranges with its fresh pair so __mesh_part_ranges reads back the
        // full partition without waiting for a cart push.
        if (model_source.partRanges()) |pr| {
            var ranges: std.ArrayListUnmanaged(u32) = .empty;
            defer ranges.deinit(std.heap.c_allocator);
            var appended = true;
            ranges.appendSlice(std.heap.c_allocator, pr) catch {
                appended = false;
            };
            if (appended) {
                ranges.append(std.heap.c_allocator, offset) catch {};
                ranges.append(std.heap.c_allocator, offset + new_group_span) catch {};
                if (ranges.items.len == pr.len + 2) model_source.setPartRanges(ranges.items);
            }
        } else {
            // First part onto an EMPTIED model (req_2806): no ranges survive the empty
            // state — the fresh pair IS the partition.
            const pair = [_]u32{ offset, offset + new_group_span };
            model_source.setPartRanges(pair[0..]);
        }
        _ = ensureDisjointPartRanges("add part");
        if (cur_count == 0) _ = refreshPaintLayout();
    }
    return .{ .ok = ok, .lo = offset, .hi = offset + new_group_span, .count = cur_count + new_count };
}

// Host-side stash of a hidden part: its exact triangles (interleaved verts) + authored groups,
// so hide is non-destructive and unhide restores the edited geometry (no JS round-trip).
const HiddenGroup = struct { lo: u32, hi: u32, verts: []f32, groups: []u32 };
var g_hidden_groups: std.ArrayListUnmanaged(HiddenGroup) = .empty;

/// Hide or show the part occupying authored-group range [lo, hi). Hiding moves its triangles
/// out of the live mesh into a host stash (geometry never crosses the bridge); showing
/// re-appends them with their original groups. Returns whether the mesh changed.
pub fn meshSetGroupHidden(lo: u32, hi: u32, hidden: bool) bool {
    if (!model_paint.hasTarget()) return false;
    var snap = journalSnapshotCurrent(if (hidden) "hide part" else "show part");
    // Hide/show removes or restores whole stable groups, so both the pixels and the
    // recorded program remain valid across the target swap.
    beginPaintStableReplace();
    const ok = if (hidden) hideGroup(lo, hi) else showGroup(lo, hi);
    if (!ok) cancelPaintStableReplace(); // failed op — never let a stale stash blit later
    if (ok) journalCommit(&snap) else journalDiscard(&snap);
    return ok;
}

fn hideGroup(lo: u32, hi: u32) bool {
    const cur_verts = g_edit_verts orelse return false;
    const cur_count = g_edit_count;
    const cur_faces = cur_count / 3;
    const cur_groups = captureFaceGroups() orelse return false;
    defer std.heap.c_allocator.free(cur_groups);

    var keep: std.ArrayListUnmanaged(f32) = .empty;
    var keep_g: std.ArrayListUnmanaged(u32) = .empty;
    defer keep_g.deinit(std.heap.c_allocator);
    var hid: std.ArrayListUnmanaged(f32) = .empty;
    var hid_g: std.ArrayListUnmanaged(u32) = .empty;
    var any = false;
    var f: u32 = 0;
    while (f < cur_faces) : (f += 1) {
        const g = cur_groups[f];
        const base = @as(usize, f) * 24;
        if (base + 24 > cur_verts.len) break;
        if (g != model_source.NO_FACE_GROUP and g >= lo and g < hi) {
            any = true;
            _ = appendFloats(&hid, cur_verts[base .. base + 24]);
            hid_g.append(std.heap.c_allocator, g) catch {};
        } else {
            _ = appendFloats(&keep, cur_verts[base .. base + 24]);
            keep_g.append(std.heap.c_allocator, g) catch {};
        }
    }
    if (!any or keep.items.len < 24 * 3) {
        keep.deinit(std.heap.c_allocator);
        hid.deinit(std.heap.c_allocator);
        hid_g.deinit(std.heap.c_allocator);
        return false;
    }
    const hid_verts = hid.toOwnedSlice(std.heap.c_allocator) catch return false;
    const hid_groups = hid_g.toOwnedSlice(std.heap.c_allocator) catch return false;
    g_hidden_groups.append(std.heap.c_allocator, .{ .lo = lo, .hi = hi, .verts = hid_verts, .groups = hid_groups }) catch {};

    const owned = keep.toOwnedSlice(std.heap.c_allocator) catch return false;
    defer std.heap.c_allocator.free(owned);
    const kept: u32 = @intCast(owned.len / 8);
    const ok = replaceActiveEditMesh(owned, kept);
    if (ok) {
        model_source.setFaceGroups(keep_g.items);
        _ = refreshPaintLayout();
    }
    return ok;
}

fn showGroup(lo: u32, hi: u32) bool {
    var idx: ?usize = null;
    for (g_hidden_groups.items, 0..) |h, i| {
        if (h.lo == lo and h.hi == hi) {
            idx = i;
            break;
        }
    }
    const i = idx orelse return false;
    const entry = g_hidden_groups.items[i];
    defer {
        std.heap.c_allocator.free(entry.verts);
        std.heap.c_allocator.free(entry.groups);
        _ = g_hidden_groups.orderedRemove(i);
    }

    const cur_verts = g_edit_verts orelse return false;
    const cur_count = g_edit_count;
    const cur_groups = captureFaceGroups() orelse return false;
    defer std.heap.c_allocator.free(cur_groups);

    var out: std.ArrayListUnmanaged(f32) = .empty;
    if (!appendFloats(&out, cur_verts[0 .. @as(usize, cur_count) * 8]) or !appendFloats(&out, entry.verts)) {
        out.deinit(std.heap.c_allocator);
        return false;
    }
    var groups: std.ArrayListUnmanaged(u32) = .empty;
    defer groups.deinit(std.heap.c_allocator);
    for (cur_groups) |g| groups.append(std.heap.c_allocator, g) catch {};
    for (entry.groups) |g| groups.append(std.heap.c_allocator, g) catch {};

    const owned = out.toOwnedSlice(std.heap.c_allocator) catch {
        out.deinit(std.heap.c_allocator);
        return false;
    };
    defer std.heap.c_allocator.free(owned);
    const ok = replaceActiveEditMesh(owned, cur_count + @as(u32, @intCast(entry.verts.len / 8)));
    if (ok) {
        model_source.setFaceGroups(groups.items);
        _ = refreshPaintLayout();
    }
    return ok;
}

/// Distinct authored group ids in [lo, hi) that still have at least one surviving face after a
/// delete. The outliner uses this to prune each part's STORED faces down to what remains — only
/// the small id list crosses the bridge, never geometry — so a later recompose keeps the delete.
pub fn meshSurvivingGroups(lo: u32, hi: u32, out: []u32) u32 {
    if (hi <= lo) return 0;
    const span = hi - lo;
    const seen = std.heap.c_allocator.alloc(bool, span) catch return 0;
    defer std.heap.c_allocator.free(seen);
    @memset(seen, false);
    const fc = model_paint.faceCount();
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        const g = model_source.faceGroupOf(f);
        if (g != model_source.NO_FACE_GROUP and g >= lo and g < hi) seen[g - lo] = true;
    }
    var n: u32 = 0;
    var i: u32 = 0;
    while (i < span) : (i += 1) {
        if (seen[i] and n < out.len) {
            out[n] = lo + i;
            n += 1;
        }
    }
    return n;
}

// ══════════════════════════════════════════════════════════════════════════
// Mesh-edit journal (undo/redo) + the part-level ops that ride it
// ══════════════════════════════════════════════════════════════════════════
// Every committed mutation of the resident edit mesh (gizmo release, topology op,
// delete, part append/duplicate/detach/merge, hide/show, glass, solidify) snapshots
// the FULL pre-op state: verts, authored face groups, part ranges, per-face colours,
// the hidden-part stash, and an opaque JS note (the cart's parts metadata, set via
// __mesh_journal_note) so the outliner resyncs after a restore. Undo/redo swap the
// live state with the top snapshot. Bounded by count AND bytes, oldest-first.

const jalloc = std.heap.c_allocator;

const JournalHidden = struct { lo: u32, hi: u32, verts: []f32, groups: []u32 };
const JournalEntry = struct {
    verts: []f32,
    count: u32,
    groups: ?[]u32,
    part_ranges: ?[]u32,
    colors: ?[]u8,
    hidden: []JournalHidden,
    paint_layout_stale: bool,
    note: ?[]u8,
    label: []const u8, // static string — the op that FOLLOWED this snapshot
    action_id: u32 = 0,
    action_kind: ?mesh_journal_log.ActionKind = null,
};
const JOURNAL_CAP = 32;
const JOURNAL_BYTE_BUDGET: usize = 192 * 1024 * 1024;
pub const MESH_ACTION_CAP: usize = 128;
pub const MeshActionEvent = mesh_journal_log.ActionEvent;
var g_journal_undo: std.ArrayListUnmanaged(JournalEntry) = .empty;
var g_journal_redo: std.ArrayListUnmanaged(JournalEntry) = .empty;
var g_journal_note: ?[]u8 = null; // the cart's CURRENT parts metadata (rides each snapshot)
var g_gizmo_snap: ?JournalEntry = null; // taken at gizmo-begin; committed only if the drag moved something
var g_mesh_action_events: [MESH_ACTION_CAP]MeshActionEvent = undefined;
var g_mesh_action_len: usize = 0;
var g_mesh_action_seq: u32 = 0;
var g_mesh_action_dropped: u32 = 0;
var g_mesh_action_document_token: u32 = 0;
var g_mesh_action_source: mesh_journal_log.ActionSource = .native;

fn partCountFromRanges(ranges: ?[]const u32) u32 {
    return if (ranges) |rows| @intCast(rows.len / 2) else 0;
}

fn currentPartCount() u32 {
    return partCountFromRanges(model_source.partRanges());
}

fn enqueueMeshAction(
    id: u32,
    kind: mesh_journal_log.ActionKind,
    phase: mesh_journal_log.ActionPhase,
    before_vertices: u32,
    after_vertices: u32,
    before_parts: u32,
    after_parts: u32,
) void {
    if (g_mesh_action_len == MESH_ACTION_CAP) {
        var i: usize = 1;
        while (i < g_mesh_action_len) : (i += 1) g_mesh_action_events[i - 1] = g_mesh_action_events[i];
        g_mesh_action_len -= 1;
        g_mesh_action_dropped +%= 1;
    }
    g_mesh_action_events[g_mesh_action_len] = .{
        .id = id,
        .document_token = g_mesh_action_document_token,
        .kind = kind,
        .phase = phase,
        .source = g_mesh_action_source,
        .before_vertices = before_vertices,
        .after_vertices = after_vertices,
        .before_parts = before_parts,
        .after_parts = after_parts,
        .dropped_before = g_mesh_action_dropped,
    };
    g_mesh_action_dropped = 0;
    g_mesh_action_len += 1;
}

pub fn meshActionSourceSet(raw: u8) void {
    g_mesh_action_source = std.enums.fromInt(mesh_journal_log.ActionSource, raw) orelse .native;
}

pub fn meshActionDocumentSet(token: u32) void {
    g_mesh_action_document_token = token;
}

pub fn meshActionDrain(out: []MeshActionEvent) usize {
    const n = @min(out.len, g_mesh_action_len);
    if (n == 0) return 0;
    @memcpy(out[0..n], g_mesh_action_events[0..n]);
    const remain = g_mesh_action_len - n;
    if (remain > 0) std.mem.copyForwards(MeshActionEvent, g_mesh_action_events[0..remain], g_mesh_action_events[n..g_mesh_action_len]);
    g_mesh_action_len = remain;
    return n;
}

fn journalEntryBytes(e: *const JournalEntry) usize {
    var n: usize = e.verts.len * @sizeOf(f32);
    if (e.groups) |g| n += g.len * @sizeOf(u32);
    if (e.part_ranges) |p| n += p.len * @sizeOf(u32);
    if (e.colors) |c| n += c.len;
    n += e.hidden.len * @sizeOf(JournalHidden);
    for (e.hidden) |h| n += h.verts.len * @sizeOf(f32) + h.groups.len * @sizeOf(u32);
    if (e.note) |note| n += note.len;
    return n;
}

fn journalFreeEntry(e: *JournalEntry) void {
    jalloc.free(e.verts);
    if (e.groups) |g| jalloc.free(g);
    if (e.part_ranges) |p| jalloc.free(p);
    if (e.colors) |c| jalloc.free(c);
    for (e.hidden) |h| {
        jalloc.free(h.verts);
        jalloc.free(h.groups);
    }
    if (e.hidden.len > 0) jalloc.free(e.hidden);
    if (e.note) |n| jalloc.free(n);
}

fn journalFreeStack(stack: *std.ArrayListUnmanaged(JournalEntry)) void {
    for (stack.items) |*e| journalFreeEntry(e);
    stack.clearRetainingCapacity();
}

fn journalSnapshotCurrent(label: []const u8) ?JournalEntry {
    const verts = g_edit_verts orelse return null;
    // g_edit_count == 0 is a valid EMPTY snapshot (req_2806): stepping the journal
    // away from an emptied model must be able to record "it was empty" for redo.
    const need = @as(usize, g_edit_count) * 8;
    if (verts.len < need) return null;
    const v = jalloc.dupe(f32, verts[0..need]) catch return null;
    var entry = JournalEntry{
        .verts = v,
        .count = g_edit_count,
        .groups = null,
        .part_ranges = null,
        .colors = null,
        .hidden = &.{},
        .paint_layout_stale = g_paint_layout_stale,
        .note = null,
        .label = label,
        .action_id = 0,
        .action_kind = null,
    };
    if (model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP) entry.groups = captureFaceGroups();
    if (model_source.partRanges()) |pr| entry.part_ranges = jalloc.dupe(u32, pr) catch null;
    entry.colors = collectCurrentFaceColors();
    if (g_hidden_groups.items.len > 0) {
        var hs: std.ArrayListUnmanaged(JournalHidden) = .empty;
        for (g_hidden_groups.items) |h| {
            const hv = jalloc.dupe(f32, h.verts) catch continue;
            const hg = jalloc.dupe(u32, h.groups) catch {
                jalloc.free(hv);
                continue;
            };
            hs.append(jalloc, .{ .lo = h.lo, .hi = h.hi, .verts = hv, .groups = hg }) catch {
                jalloc.free(hv);
                jalloc.free(hg);
            };
        }
        entry.hidden = hs.toOwnedSlice(jalloc) catch &.{};
    }
    if (g_journal_note) |n| entry.note = jalloc.dupe(u8, n) catch null;
    return entry;
}

/// Adopt a pre-op snapshot as an undo step (the op SUCCEEDED). Clears redo and
/// bounds the stack. Sets *snap to null so the op's discard defer no-ops.
fn journalCommit(snap: *?JournalEntry) void {
    var e = snap.* orelse return;
    snap.* = null;
    if (mesh_journal_log.actionKindForLabel(e.label)) |kind| {
        if (mesh_journal_log.actionInvalidatesPaintLayout(kind)) g_paint_layout_stale = true;
        g_mesh_action_seq +%= 1;
        if (g_mesh_action_seq == 0) g_mesh_action_seq = 1;
        e.action_id = g_mesh_action_seq;
        e.action_kind = kind;
        enqueueMeshAction(
            e.action_id,
            kind,
            .applied,
            e.count,
            g_edit_count,
            partCountFromRanges(e.part_ranges),
            currentPartCount(),
        );
    }
    journalFreeStack(&g_journal_redo);
    g_journal_undo.append(jalloc, e) catch {
        var x = e;
        journalFreeEntry(&x);
        return;
    };
    var total: usize = 0;
    for (g_journal_undo.items) |*it| total += journalEntryBytes(it);
    while (g_journal_undo.items.len > JOURNAL_CAP or (total > JOURNAL_BYTE_BUDGET and g_journal_undo.items.len > 1)) {
        var old = g_journal_undo.orderedRemove(0);
        total -= journalEntryBytes(&old);
        journalFreeEntry(&old);
    }
}

/// Free an untaken snapshot (the op failed or changed nothing).
fn journalDiscard(snap: *?JournalEntry) void {
    if (snap.*) |e| {
        var x = e;
        journalFreeEntry(&x);
    }
    snap.* = null;
}

/// Drop the newest undo entry — used when a guard REVERT returns the mesh to the
/// exact state the entry snapshots (undoing to it would be a visible no-op).
fn journalDropLast() void {
    if (g_journal_undo.items.len == 0) return;
    var e = g_journal_undo.items[g_journal_undo.items.len - 1];
    g_journal_undo.items.len -= 1;
    if (e.action_kind) |kind| enqueueMeshAction(
        e.action_id,
        kind,
        .undone,
        g_edit_count,
        e.count,
        currentPartCount(),
        partCountFromRanges(e.part_ranges),
    );
    journalFreeEntry(&e);
}

/// Forget all history — a fresh model load is a new document.
pub fn meshJournalClear() void {
    journalFreeStack(&g_journal_undo);
    journalFreeStack(&g_journal_redo);
    journalDiscard(&g_gizmo_snap);
    lcFree(); // a live loop-cut popup can't outlive the mesh it captured
    if (g_journal_note) |n| jalloc.free(n);
    g_journal_note = null;
    g_mesh_action_source = .native;
}

pub fn meshJournalNoteSet(note: []const u8) bool {
    const next = jalloc.dupe(u8, note) catch return false;
    if (g_journal_note) |n| jalloc.free(n);
    g_journal_note = next;
    return true;
}

pub fn meshJournalNoteGet() ?[]const u8 {
    return g_journal_note;
}

pub fn meshJournalCounts() [2]u32 {
    return .{ @intCast(g_journal_undo.items.len), @intCast(g_journal_redo.items.len) };
}

/// Append one metadata-only edit to the SAME journal as geometry. The explicit
/// before note makes rapid React commands deterministic even when the effect
/// that normally mirrors g_journal_note has not run between clicks.
pub fn meshJournalMetadataCheckpoint(label: []const u8, before_note: []const u8, after_note: []const u8) bool {
    if (!mesh_journal_log.metadataCheckpointValid(before_note, after_note)) return false;
    if (!meshJournalNoteSet(before_note)) return false;
    var snap = journalSnapshotCurrent(label);
    if (snap == null) return false;
    if (snap.?.note == null) {
        journalDiscard(&snap);
        return false;
    }
    if (!meshJournalNoteSet(after_note)) {
        journalDiscard(&snap);
        return false;
    }
    journalCommit(&snap);
    return true;
}

pub fn meshJournalMetadataCheckpointLabel(kind: []const u8) ?[]const u8 {
    return mesh_journal_log.metadataCheckpointLabel(kind);
}

fn journalLogEntryView(entry: *const JournalEntry) mesh_journal_log.EntryView {
    return .{
        .label = entry.label,
        .state = .{
            .vertex_count = entry.count,
            .groups = entry.groups,
            .part_ranges = entry.part_ranges,
            .hidden_parts = entry.hidden.len,
            .bytes = journalEntryBytes(entry),
            .note = entry.note,
        },
    };
}

fn journalCurrentStateBytes(groups: ?[]const u32) usize {
    var bytes = @as(usize, g_edit_count) * 8 * @sizeOf(f32);
    if (groups) |rows| bytes += rows.len * @sizeOf(u32);
    if (model_source.partRanges()) |ranges| bytes += ranges.len * @sizeOf(u32);
    if (model_source.colors()) |colors| bytes += colors.len;
    bytes += g_hidden_groups.items.len * @sizeOf(HiddenGroup);
    for (g_hidden_groups.items) |hidden| {
        bytes += hidden.verts.len * @sizeOf(f32) + hidden.groups.len * @sizeOf(u32);
    }
    if (g_journal_note) |note| bytes += note.len;
    return bytes;
}

/// Full, bounded in-memory edit history for the model surface's right-click
/// diagnostics. Every snapshot includes topology counts and exact outliner
/// group-range ownership; redo is emitted in the order it will be replayed.
pub fn meshJournalLogJson(allocator: std.mem.Allocator) ?[]u8 {
    const undo = allocator.alloc(mesh_journal_log.EntryView, g_journal_undo.items.len) catch return null;
    defer allocator.free(undo);
    for (g_journal_undo.items, 0..) |*entry, index| undo[index] = journalLogEntryView(entry);

    const redo = allocator.alloc(mesh_journal_log.EntryView, g_journal_redo.items.len) catch return null;
    defer allocator.free(redo);
    for (0..g_journal_redo.items.len) |index| {
        const source_index = g_journal_redo.items.len - 1 - index;
        redo[index] = journalLogEntryView(&g_journal_redo.items[source_index]);
    }

    const current_groups: ?[]u32 = if (model_source.faceGroups() != null) captureFaceGroups() else null;
    defer if (current_groups) |groups| jalloc.free(groups);

    var journal_bytes: usize = 0;
    for (g_journal_undo.items) |*entry| journal_bytes += journalEntryBytes(entry);
    for (g_journal_redo.items) |*entry| journal_bytes += journalEntryBytes(entry);
    if (g_gizmo_snap) |*entry| journal_bytes += journalEntryBytes(entry);

    // The journal's ownership table can be perfectly healthy while a stale live edit
    // scope hides most of the part (req_2953). Include both the scope and the two edge
    // vocabularies so the copied log distinguishes render triangulation from authored
    // topology without relying on a screenshot.
    var scope_storage: [mesh_edit.max_scope_ranges * 2]u32 = undefined;
    const scope_len = mesh_edit.scopeRangesPub(scope_storage[0..]);
    const topology: ?mesh_journal_log.TopologyView = if (mesh_edit.ensureTopologyPub()) .{
        .welded_vertices = mesh_edit.vertCount(),
        .triangle_edges = mesh_edit.edgeCount(),
        .editable_edges = mesh_edit.boundaryEdgeCount(),
    } else null;

    return mesh_journal_log.encode(allocator, .{
        .capacity = JOURNAL_CAP,
        .byte_budget = JOURNAL_BYTE_BUDGET,
        .journal_bytes = journal_bytes,
        .pending_gizmo = g_gizmo_snap != null,
        .pending_loop_cut = g_lc != null,
        .scope_ranges = scope_storage[0..scope_len],
        .topology = topology,
        .undo = undo,
        .current = .{
            .vertex_count = g_edit_count,
            .groups = current_groups,
            .part_ranges = model_source.partRanges(),
            .hidden_parts = g_hidden_groups.items.len,
            .bytes = journalCurrentStateBytes(current_groups),
            .note = g_journal_note,
        },
        .redo = redo,
    }) catch null;
}

/// The resident mesh-editor SESSION (req_2898 hot-reload resume). A dev hot reload
/// tears down the JS world but this process — the live edit mesh, its journal, the
/// paint atlas, and the orbit pose — all survive. This readback gives the remounted
/// viewer everything it needs to decide "the host still holds my live document":
/// adopt it instead of re-loading the stale seed (which would wipe the edits).
/// Null when no edit mesh is resident (cold boot / viewer never loaded).
pub fn modelSessionJson(alloc: std.mem.Allocator) ?[]u8 {
    const key = g_edit_key orelse return null;
    const j = meshJournalCounts();
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(alloc);
    out.appendSlice(alloc, "{\"key\":\"") catch return null;
    for (key) |ch| switch (ch) {
        '"' => out.appendSlice(alloc, "\\\"") catch return null,
        '\\' => out.appendSlice(alloc, "\\\\") catch return null,
        0...31 => {
            var print_buf: [8]u8 = undefined;
            const rendered = std.fmt.bufPrint(&print_buf, "\\u{x:0>4}", .{ch}) catch return null;
            out.appendSlice(alloc, rendered) catch return null;
        },
        else => out.append(alloc, ch) catch return null,
    };
    var print_buf: [192]u8 = undefined;
    const rendered = std.fmt.bufPrint(&print_buf, "\",\"count\":{d},\"radius\":{d:.6},\"undo\":{d},\"redo\":{d},\"atlas\":{},\"paintStale\":{}}}", .{
        g_edit_count, g_orbit.radius, j[0], j[1], model_paint.atlas() != null, g_paint_layout_stale,
    }) catch return null;
    out.appendSlice(alloc, rendered) catch return null;
    return out.toOwnedSlice(alloc) catch null;
}

pub fn meshUndoLabel() []const u8 {
    if (g_journal_undo.items.len == 0) return "";
    return g_journal_undo.items[g_journal_undo.items.len - 1].label;
}
pub fn meshRedoLabel() []const u8 {
    if (g_journal_redo.items.len == 0) return "";
    return g_journal_redo.items[g_journal_redo.items.len - 1].label;
}

/// Install a snapshot as the live mesh (the undo/redo restore path). The entry's
/// buffers stay owned by the caller — every adopt below copies.
fn journalInstall(e: *const JournalEntry) bool {
    const vcopy = jalloc.dupe(f32, e.verts) catch return false;
    defer jalloc.free(vcopy);
    const invalidates_layout = if (mesh_journal_log.actionKindForLabel(e.label)) |kind|
        mesh_journal_log.actionInvalidatesPaintLayout(kind)
    else
        false;
    // Indexed structural installs keep the atlas raster alive and journal snapshots
    // retain their exact interleaved UVs. Undo/redo must use those UVs too; running the
    // generic replace here would repack before the snapshot's stale flag is restored.
    const preserve_indexed_atlas = invalidates_layout and
        e.count >= 3 and
        model_paint.atlas() != null and
        e.colors != null;
    // Part-only journals add/remove whole stable groups; survivor paint identity is
    // unchanged, so undo/redo must preserve exact pixels AND the durable program.
    // Other topology journals may rewrite identity and keep the conservative reset.
    const paint_stable = !preserve_indexed_atlas and paintStableJournalLabel(e.label);
    if (paint_stable) beginPaintStableReplace();
    const installed = if (preserve_indexed_atlas)
        replaceActiveEditMeshPreservingAtlas(vcopy, e.count, e.groups, e.colors.?)
    else
        replaceActiveEditMesh(vcopy, e.count);
    if (!installed) {
        if (paint_stable) cancelPaintStableReplace();
        return false;
    }
    // Hidden-part stash: restore AFTER the install succeeded (independent of the mesh).
    for (g_hidden_groups.items) |h| {
        std.heap.c_allocator.free(h.verts);
        std.heap.c_allocator.free(h.groups);
    }
    g_hidden_groups.clearRetainingCapacity();
    for (e.hidden) |h| {
        const hv = std.heap.c_allocator.dupe(f32, h.verts) catch continue;
        const hg = std.heap.c_allocator.dupe(u32, h.groups) catch {
            std.heap.c_allocator.free(hv);
            continue;
        };
        g_hidden_groups.append(std.heap.c_allocator, .{ .lo = h.lo, .hi = h.hi, .verts = hv, .groups = hg }) catch {
            std.heap.c_allocator.free(hv);
            std.heap.c_allocator.free(hg);
        };
    }
    if (e.groups) |g| model_source.setFaceGroups(g);
    // Tripwire (req_3049): restoring a snapshot that carries NO ranges over a mesh
    // that has them silently un-parts the model — the save then persists a doc that
    // reopens merged. Name it when it happens.
    if (e.part_ranges == null and model_source.partRanges() != null) {
        log.print("[mesh] undo/redo restored a snapshot WITHOUT part ranges over a mesh that had {d} parts — ranges cleared (req_3049)\n", .{model_source.partRanges().?.len / 2});
    }
    model_source.setPartRanges(e.part_ranges orelse &.{});
    if (e.colors) |c| {
        if (!preserve_indexed_atlas) model_paint.applyColors(c);
        if (model_source.colors()) |src| {
            const n = @min(src.len, c.len);
            if (n > 0) @memcpy(src[0..n], c[0..n]);
        }
    }
    if (g_journal_note) |n| jalloc.free(n);
    g_journal_note = if (e.note) |n| (jalloc.dupe(u8, n) catch null) else null;
    // Snapshots taken while the minting bug was live carry overlapped spans (req_3029)
    // — undoing into one must heal it, not resurrect the corruption.
    _ = ensureDisjointPartRanges("undo/redo restore");
    if (e.count > 0 and !preserve_indexed_atlas) _ = refreshPaintLayout(); // an EMPTY snapshot has no islands to lay out
    g_paint_layout_stale = e.paint_layout_stale;
    return true;
}

fn journalStep(from_undo: bool) bool {
    const src = if (from_undo) &g_journal_undo else &g_journal_redo;
    const dst = if (from_undo) &g_journal_redo else &g_journal_undo;
    if (src.items.len == 0) return false;
    const top = src.items[src.items.len - 1];
    const top_label = top.label;
    const cur = journalSnapshotCurrent(top_label) orelse return false;
    var current = cur;
    current.action_id = top.action_id;
    current.action_kind = top.action_kind;
    var entry = src.items[src.items.len - 1];
    src.items.len -= 1;
    if (!journalInstall(&entry)) {
        src.append(jalloc, entry) catch journalFreeEntry(&entry);
        var c = current;
        journalFreeEntry(&c);
        return false;
    }
    if (entry.action_kind) |kind| enqueueMeshAction(
        entry.action_id,
        kind,
        if (from_undo) .undone else .redone,
        current.count,
        entry.count,
        partCountFromRanges(current.part_ranges),
        partCountFromRanges(entry.part_ranges),
    );
    journalFreeEntry(&entry);
    dst.append(jalloc, current) catch {
        var c = current;
        journalFreeEntry(&c);
    };
    return true;
}

pub fn meshUndo() bool {
    return journalStep(true);
}
pub fn meshRedo() bool {
    return journalStep(false);
}

// ── Part-level ops: duplicate / mirror / detach / merge / glass / solidify ────────

const GLASS_ALPHA: u8 = 87; // ~0.34 of 255 — the old studio's glassOpacity

/// Duplicate the part occupying authored-group range [lo, hi) — optionally REFLECTED
/// across the origin plane of `mirror_axis` (0=X 1=Y 2=Z; -1 = plain copy). The copy
/// appends as a fresh part (new group range) carrying the source's per-face paint;
/// mirrored copies reverse their winding so normals stay outward. The mirror workflow
/// matches the old studio: center the source, mirror across the plane, get the twin.
pub fn meshDuplicateGroupRange(lo: u32, hi: u32, mirror_axis: i32) AppendResult {
    const fail = AppendResult{ .ok = false, .lo = 0, .hi = 0, .count = 0 };
    if (!model_paint.hasTarget() or hi <= lo) return fail;
    const cur_verts = g_edit_verts orelse return fail;
    if (model_source.faceGroupOf(0) == model_source.NO_FACE_GROUP) return fail;
    const live_ranges = model_source.partRanges() orelse return fail;
    // Deep boundary: duplicate means one COMPLETE live outliner part. Topology
    // edits can renumber a part from e.g. [0,6) to [0,16); accepting the stale
    // subrange copied a plausible-looking 9/24-face fragment and only failed
    // after the user moved it. The viewer resolves same-rank renumber aliases;
    // anything still stale or malformed is rejected here without mutation.
    if (!mesh_journal_log.hasExactPartRange(live_ranges, lo, hi)) return fail;
    const cur_faces = g_edit_count / 3;

    var out: std.ArrayListUnmanaged(f32) = .empty;
    defer out.deinit(jalloc);
    var groups: std.ArrayListUnmanaged(u32) = .empty;
    defer groups.deinit(jalloc);
    var colors: std.ArrayListUnmanaged(u8) = .empty;
    defer colors.deinit(jalloc);
    var remap = std.AutoHashMapUnmanaged(u32, u32){};
    defer remap.deinit(jalloc);
    var next_local: u32 = 0;

    var f: u32 = 0;
    while (f < cur_faces) : (f += 1) {
        const g = model_source.faceGroupOf(f);
        if (g == model_source.NO_FACE_GROUP or g < lo or g >= hi) continue;
        const base = @as(usize, f) * 24;
        if (base + 24 > cur_verts.len) break;
        if (mirror_axis >= 0 and mirror_axis <= 2) {
            const ax: usize = @intCast(mirror_axis);
            var p: [3][3]f32 = undefined;
            var k: usize = 0;
            while (k < 3) : (k += 1) {
                p[k] = .{ cur_verts[base + k * 8], cur_verts[base + k * 8 + 1], cur_verts[base + k * 8 + 2] };
                p[k][ax] = -p[k][ax];
            }
            // A reflection flips handedness — swap two corners so winding stays outward.
            if (!appendTri(&out, p[0], p[2], p[1])) return fail;
        } else {
            if (!appendFloats(&out, cur_verts[base .. base + 24])) return fail;
        }
        const gop = remap.getOrPut(jalloc, g) catch return fail;
        if (!gop.found_existing) {
            gop.value_ptr.* = next_local;
            next_local += 1;
        }
        groups.append(jalloc, gop.value_ptr.*) catch return fail;
        const c = trueFaceColor(f);
        colors.appendSlice(jalloc, c[0..]) catch return fail;
    }
    if (groups.items.len == 0) return fail;

    var snap = journalSnapshotCurrent(if (mirror_axis >= 0) "mirror part" else "duplicate part");
    const first_new_face = model_paint.faceCount();
    const r = appendGroupInner(out.items, @intCast(out.items.len / 8), groups.items);
    if (!r.ok) {
        journalDiscard(&snap);
        return r;
    }
    // The copy keeps the source's per-face paint — a duplicate reads as a twin.
    var i: u32 = 0;
    while (i < groups.items.len) : (i += 1) {
        const c: [4]u8 = .{ colors.items[i * 4], colors.items[i * 4 + 1], colors.items[i * 4 + 2], colors.items[i * 4 + 3] };
        model_paint.paintFace(first_new_face + i, c);
        model_source.writeColor(@intCast(first_new_face + i), c[0], c[1], c[2]);
    }
    journalCommit(&snap);
    ensureGlassTrailing();
    return r;
}

pub const PathArrayAxis = path_array.Axis;
pub const PathArrayProfile = path_array.Profile;
pub const PathArrayParams = path_array.Params;
pub const PathArrayResult = struct {
    ok: bool,
    count: u32,
    /// Fresh [lo,hi) pairs in generated-bay-major, source-part-minor order.
    /// Owned by the allocator passed to meshPathArray when ok=true.
    ranges: ?[]u32,
};

fn pathArrayFail() PathArrayResult {
    return .{ .ok = false, .count = 0, .ranges = null };
}

fn knownPartRange(part_ranges: []const u32, lo: u32, hi: u32) bool {
    return mesh_journal_log.hasExactPartRange(part_ranges, lo, hi);
}

fn sourceRangeIndex(source_ranges: []const u32, group: u32) ?usize {
    var i: usize = 0;
    while (i + 1 < source_ranges.len) : (i += 2) {
        if (group >= source_ranges[i] and group < source_ranges[i + 1]) return i / 2;
    }
    return null;
}

fn pathDot(a: [3]f32, b: [3]f32) f32 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/// Read-only source-bay spans for the cart's 3D-coordinate editor. Returns X/Z
/// model-space lengths; the cart expresses them in its ruled 16-u-per-tile scale.
pub fn meshPathArrayHorizontalSpans(source_ranges: []const u32) ?[2]f32 {
    if (source_ranges.len == 0 or source_ranges.len % 2 != 0) return null;
    const verts = g_edit_verts orelse return null;
    const groups = captureFaceGroups() orelse return null;
    defer jalloc.free(groups);
    var min_x = std.math.inf(f32);
    var max_x = -std.math.inf(f32);
    var min_z = std.math.inf(f32);
    var max_z = -std.math.inf(f32);
    var found = false;
    var f: u32 = 0;
    while (f < g_edit_count / 3) : (f += 1) {
        if (sourceRangeIndex(source_ranges, groups[f]) == null) continue;
        const base = @as(usize, f) * 24;
        if (base + 24 > verts.len) return null;
        var corner: usize = 0;
        while (corner < 3) : (corner += 1) {
            const x = verts[base + corner * 8];
            const z = verts[base + corner * 8 + 2];
            min_x = @min(min_x, x);
            max_x = @max(max_x, x);
            min_z = @min(min_z, z);
            max_z = @max(max_z, z);
            found = true;
        }
    }
    return if (found) .{ max_x - min_x, max_z - min_z } else null;
}

/// Grow one selected source bay into a curved/rising run without touching that source.
/// Every selected range remains an independent part in every generated bay. The whole
/// append is built before installation and journals as ONE "path array" undo unit.
/// Geometry comes from the resident edited mesh, never the cart's stale primitive seed.
pub fn meshPathArray(alloc: std.mem.Allocator, source_ranges: []const u32, params: PathArrayParams) PathArrayResult {
    return meshPathArrayInner(alloc, source_ranges, params, null);
}

pub fn meshPathArrayPoints(alloc: std.mem.Allocator, source_ranges: []const u32, axis: PathArrayAxis, points: []const path_array.Vec3) PathArrayResult {
    const bays: u32 = @intCast(points.len);
    return meshPathArrayInner(alloc, source_ranges, .{
        .axis = axis,
        .bays = bays,
        .turn_radians = 0,
        .rise = 0,
        .profile = .linear,
    }, points);
}

fn meshPathArrayInner(alloc: std.mem.Allocator, source_ranges: []const u32, params: PathArrayParams, point_path: ?[]const path_array.Vec3) PathArrayResult {
    const fail = pathArrayFail();
    if (!model_paint.hasTarget() or source_ranges.len == 0 or source_ranges.len % 2 != 0) return fail;
    const cur_verts = g_edit_verts orelse return fail;
    const part_ranges = model_source.partRanges() orelse return fail;
    const cur_groups = captureFaceGroups() orelse return fail;
    defer jalloc.free(cur_groups);
    const cur_colors = collectCurrentFaceColors() orelse return fail;
    defer jalloc.free(cur_colors);
    const cur_faces = g_edit_count / 3;
    if (cur_colors.len != @as(usize, cur_faces) * 4) return fail;

    // The bridge is strict: callers may only array complete, distinct live parts.
    var pair_i: usize = 0;
    while (pair_i + 1 < source_ranges.len) : (pair_i += 2) {
        const lo = source_ranges[pair_i];
        const hi = source_ranges[pair_i + 1];
        if (hi <= lo or !knownPartRange(part_ranges, lo, hi)) return fail;
        var earlier: usize = 0;
        while (earlier < pair_i) : (earlier += 2) {
            if (lo < source_ranges[earlier + 1] and hi > source_ranges[earlier]) return fail;
        }
    }

    const frame = path_array.basis(params.axis);
    var forward_min = std.math.inf(f32);
    var forward_max = -std.math.inf(f32);
    var lateral_min = std.math.inf(f32);
    var lateral_max = -std.math.inf(f32);
    var vertical_min = std.math.inf(f32);
    var vertical_max = -std.math.inf(f32);
    var source_faces: u32 = 0;
    var f: u32 = 0;
    while (f < cur_faces) : (f += 1) {
        if (sourceRangeIndex(source_ranges, cur_groups[f]) == null) continue;
        source_faces += 1;
        const base = @as(usize, f) * 24;
        if (base + 24 > cur_verts.len) return fail;
        var corner: usize = 0;
        while (corner < 3) : (corner += 1) {
            const p: [3]f32 = .{ cur_verts[base + corner * 8], cur_verts[base + corner * 8 + 1], cur_verts[base + corner * 8 + 2] };
            const forward = pathDot(p, frame.forward);
            const lateral = pathDot(p, frame.right);
            forward_min = @min(forward_min, forward);
            forward_max = @max(forward_max, forward);
            lateral_min = @min(lateral_min, lateral);
            lateral_max = @max(lateral_max, lateral);
            vertical_min = @min(vertical_min, p[1]);
            vertical_max = @max(vertical_max, p[1]);
        }
    }
    if (source_faces == 0) return fail;
    const template = path_array.Template{
        .forward_min = forward_min,
        .forward_max = forward_max,
        .lateral_center = (lateral_min + lateral_max) * 0.5,
        .vertical_origin = (vertical_min + vertical_max) * 0.5,
    };
    if (point_path) |points| {
        if (!path_array.validPointPath(template, points)) return fail;
    } else if (!path_array.valid(template, params)) return fail;

    var verts: std.ArrayListUnmanaged(f32) = .empty;
    defer verts.deinit(jalloc);
    var groups: std.ArrayListUnmanaged(u32) = .empty;
    defer groups.deinit(jalloc);
    var colors: std.ArrayListUnmanaged(u8) = .empty;
    defer colors.deinit(jalloc);
    var all_ranges: std.ArrayListUnmanaged(u32) = .empty;
    defer all_ranges.deinit(jalloc);
    var fresh_ranges: std.ArrayListUnmanaged(u32) = .empty;
    defer fresh_ranges.deinit(alloc);

    if (!appendFloats(&verts, cur_verts[0 .. @as(usize, g_edit_count) * 8])) return fail;
    groups.appendSlice(jalloc, cur_groups) catch return fail;
    colors.appendSlice(jalloc, cur_colors) catch return fail;
    all_ranges.appendSlice(jalloc, part_ranges) catch return fail;

    var next_group: u32 = nextFreeGroupId(cur_groups);
    const generated_bays: u32 = if (point_path) |points| @intCast(points.len - 1) else params.bays - 1;
    var bay: u32 = 0;
    while (bay < generated_bays) : (bay += 1) {
        var source_index: usize = 0;
        while (source_index * 2 + 1 < source_ranges.len) : (source_index += 1) {
            const lo = source_ranges[source_index * 2];
            const hi = source_ranges[source_index * 2 + 1];
            const range_start = next_group;
            var local_groups = std.AutoHashMapUnmanaged(u32, u32){};
            defer local_groups.deinit(jalloc);
            var next_local: u32 = 0;
            var copied_faces: u32 = 0;

            f = 0;
            while (f < cur_faces) : (f += 1) {
                const source_group = cur_groups[f];
                if (source_group < lo or source_group >= hi) continue;
                const base = @as(usize, f) * 24;
                if (base + 24 > cur_verts.len) return fail;
                var mapped: [3][3]f32 = undefined;
                var corner: usize = 0;
                while (corner < 3) : (corner += 1) {
                    const p: [3]f32 = .{ cur_verts[base + corner * 8], cur_verts[base + corner * 8 + 1], cur_verts[base + corner * 8 + 2] };
                    mapped[corner] = if (point_path) |points|
                        path_array.mapPointPath(template, params.axis, points, bay, p)
                    else
                        path_array.mapPoint(template, params, bay, p);
                }
                if (!appendTri(&verts, mapped[0], mapped[1], mapped[2])) return fail;
                const group_entry = local_groups.getOrPut(jalloc, source_group) catch return fail;
                if (!group_entry.found_existing) {
                    group_entry.value_ptr.* = next_local;
                    next_local += 1;
                }
                groups.append(jalloc, range_start + group_entry.value_ptr.*) catch return fail;
                colors.appendSlice(jalloc, cur_colors[@as(usize, f) * 4 .. @as(usize, f) * 4 + 4]) catch return fail;
                copied_faces += 1;
            }
            if (copied_faces == 0 or next_local == 0) return fail;
            next_group += next_local;
            all_ranges.appendSlice(jalloc, &.{ range_start, next_group }) catch return fail;
            fresh_ranges.appendSlice(alloc, &.{ range_start, next_group }) catch return fail;
        }
    }

    const expected_fresh_pairs = @as(usize, generated_bays) * (source_ranges.len / 2) * 2;
    if (fresh_ranges.items.len != expected_fresh_pairs) return fail;
    const result_ranges = fresh_ranges.toOwnedSlice(alloc) catch return fail;
    const installed_count: u32 = @intCast(verts.items.len / 8);
    var snap = journalSnapshotCurrent("path array");
    if (!replaceActiveEditMesh(verts.items, installed_count)) {
        journalDiscard(&snap);
        alloc.free(result_ranges);
        return fail;
    }
    model_source.setFaceGroups(groups.items);
    model_source.setPartRanges(all_ranges.items);
    if (!applyExactFaceColors(colors.items, @intCast(groups.items.len))) {
        if (snap) |*before| _ = journalInstall(before);
        journalDiscard(&snap);
        alloc.free(result_ranges);
        return fail;
    }
    _ = ensureDisjointPartRanges("path array");
    _ = refreshPaintLayout();
    journalCommit(&snap);
    ensureGlassTrailing();
    return .{ .ok = true, .count = installed_count, .ranges = result_ranges };
}

/// Detach the selected faces (face mode) into a NEW part: their authored groups are
/// re-numbered into a fresh contiguous range past every existing group. Pure group
/// remap — no geometry moves, so paint and topology are untouched; the outliner gains
/// a part whose range is the returned [lo, hi). The old studio's "peel a panel off
/// the body" — here the panel keeps its exact triangles.
pub fn meshDetachSelection() AppendResult {
    const fail = AppendResult{ .ok = false, .lo = 0, .hi = 0, .count = 0 };
    if (!model_paint.hasTarget()) return fail;
    if (mesh_edit.mode() != .face) return fail;
    if (model_source.faceGroupOf(0) == model_source.NO_FACE_GROUP) return fail;
    // Group ids are per SOURCE face — require the displayed mesh to BE the source
    // (any edit at decimated quality already retains the displayed mesh as source).
    if (g_edit_count != model_source.count()) return fail;
    const tri_count = g_edit_count / 3;
    const mask = jalloc.alloc(bool, tri_count) catch return fail;
    defer jalloc.free(mask);
    const del = mesh_edit.buildDeleteMask(mask);
    if (del == 0 or del >= tri_count) return fail;

    const groups = captureFaceGroups() orelse return fail;
    defer jalloc.free(groups);
    var snap = journalSnapshotCurrent("detach faces");
    // Drop the selection FIRST — its saved-patch tint must restore before the
    // paint layout re-islands under the new grouping.
    mesh_edit.clearSelection();

    const offset: u32 = nextFreeGroupId(groups);
    var remap = std.AutoHashMapUnmanaged(u32, u32){};
    defer remap.deinit(jalloc);
    var next: u32 = offset;
    var f: u32 = 0;
    while (f < tri_count) : (f += 1) {
        if (!mask[f]) continue;
        const gop = remap.getOrPut(jalloc, groups[f]) catch {
            journalDiscard(&snap);
            return fail;
        };
        if (!gop.found_existing) {
            gop.value_ptr.* = next;
            next += 1;
        }
        groups[f] = gop.value_ptr.*;
    }
    model_source.setFaceGroups(groups);
    // The detached panel becomes a part in the host's range truth too (req_2644), and
    // the weld must re-key: its faces changed part, so coincident verts along the seam
    // now belong to two parts and may no longer merge.
    if (model_source.partRanges()) |pr| {
        var ranges: std.ArrayListUnmanaged(u32) = .empty;
        defer ranges.deinit(jalloc);
        if (ranges.appendSlice(jalloc, pr)) |_| {
            ranges.append(jalloc, offset) catch {};
            ranges.append(jalloc, next) catch {};
            if (ranges.items.len == pr.len + 2) model_source.setPartRanges(ranges.items);
        } else |_| {}
    }
    _ = ensureDisjointPartRanges("detach faces");
    mesh_edit.reset();
    _ = refreshPaintLayout();
    journalCommit(&snap);
    return .{ .ok = true, .lo = offset, .hi = next, .count = g_edit_count };
}

/// Merge two parts into ONE: every face in either range gets re-numbered into a fresh
/// contiguous group range (n-gon grouping preserved across both). Pure group remap.
/// The outliner replaces both parts with one over the returned range — the old
/// studio's "merge down" (the durable re-attach path after a detach).
pub fn meshMergeGroupRanges(a_lo: u32, a_hi: u32, b_lo: u32, b_hi: u32) AppendResult {
    const fail = AppendResult{ .ok = false, .lo = 0, .hi = 0, .count = 0 };
    if (!model_paint.hasTarget()) return fail;
    if (model_source.faceGroupOf(0) == model_source.NO_FACE_GROUP) return fail;
    if (g_edit_count != model_source.count()) return fail;
    const tri_count = g_edit_count / 3;
    const groups = captureFaceGroups() orelse return fail;
    defer jalloc.free(groups);

    var snap = journalSnapshotCurrent("merge parts");
    mesh_edit.clearSelection();
    const offset: u32 = nextFreeGroupId(groups);
    var remap = std.AutoHashMapUnmanaged(u32, u32){};
    defer remap.deinit(jalloc);
    var next: u32 = offset;
    var touched = false;
    var f: u32 = 0;
    while (f < tri_count) : (f += 1) {
        const g = groups[f];
        if (g == model_source.NO_FACE_GROUP) continue;
        const in_a = g >= a_lo and g < a_hi;
        const in_b = g >= b_lo and g < b_hi;
        if (!in_a and !in_b) continue;
        const gop = remap.getOrPut(jalloc, g) catch {
            journalDiscard(&snap);
            return fail;
        };
        if (!gop.found_existing) {
            gop.value_ptr.* = next;
            next += 1;
        }
        groups[f] = gop.value_ptr.*;
        touched = true;
    }
    if (!touched) {
        journalDiscard(&snap);
        return fail;
    }
    model_source.setFaceGroups(groups);
    // Host range truth (req_2644): the two source ranges collapse into the fused pair.
    if (model_source.partRanges()) |pr| {
        var ranges: std.ArrayListUnmanaged(u32) = .empty;
        defer ranges.deinit(jalloc);
        var i: usize = 0;
        var copied = true;
        while (i + 1 < pr.len) : (i += 2) {
            const keep = !((pr[i] == a_lo and pr[i + 1] == a_hi) or (pr[i] == b_lo and pr[i + 1] == b_hi));
            if (!keep) continue;
            ranges.append(jalloc, pr[i]) catch {
                copied = false;
            };
            ranges.append(jalloc, pr[i + 1]) catch {
                copied = false;
            };
        }
        if (copied) {
            ranges.append(jalloc, offset) catch {};
            ranges.append(jalloc, next) catch {};
            model_source.setPartRanges(ranges.items);
        }
    }
    _ = ensureDisjointPartRanges("merge parts");
    mesh_edit.reset(); // part membership moved → weld re-keys
    _ = refreshPaintLayout();
    journalCommit(&snap);
    return .{ .ok = true, .lo = offset, .hi = next, .count = g_edit_count };
}

/// Reverse the selected authored face(s) so their normals point to the opposite side.
/// This is the host-native port of Studio's `flipFace` (req_1182 / req_2883): every
/// member triangle reverses winding with its interleaved UV row, while face groups,
/// part ownership, paint, and triangle order remain unchanged. The selection is restored
/// after the resident mesh rekeys, so X can be tapped again to flip back immediately.
pub fn meshFlipSelectionWinding() bool {
    if (!model_paint.hasTarget()) return false;
    if (mesh_edit.mode() != .face) return false;
    const cur_verts = g_edit_verts orelse return false;
    const tri_count = g_edit_count / 3;
    if (tri_count == 0) return false;

    const mask = jalloc.alloc(bool, tri_count) catch return false;
    defer jalloc.free(mask);
    if (mesh_edit.buildDeleteMask(mask) == 0) return false;

    const needed = @as(usize, g_edit_count) * 8;
    if (cur_verts.len < needed) return false;
    const flipped_verts = jalloc.dupe(f32, cur_verts[0..needed]) catch return false;
    defer jalloc.free(flipped_verts);
    if (mesh_edit.flipSelectedTriangleWinding(flipped_verts, tri_count, mask) == 0) return false;

    // retain() inside replaceActiveEditMesh deliberately clears authored groups. Capture
    // and restore them around the replace; unchanged group ids also let the atlas carry
    // put every painted island back exactly where it was.
    const grouped = model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP;
    const groups: ?[]u32 = if (grouped) (captureFaceGroups() orelse return false) else null;
    defer if (groups) |g| jalloc.free(g);

    var snap = journalSnapshotCurrent("flip faces");
    mesh_edit.suspendFaceTint();
    model_paint.snapshotAtlasForCarry();
    mesh_edit.clearSelection();
    mesh_edit.resumeFaceTint();

    if (!replaceActiveEditMesh(flipped_verts, g_edit_count)) {
        model_paint.dropAtlasCarry();
        _ = mesh_edit.selectFacesByTriangleMask(mask);
        journalDiscard(&snap);
        return false;
    }
    if (groups) |g| model_source.setFaceGroups(g);
    _ = refreshPaintLayout();
    model_paint.dropAtlasCarry(); // refresh consumes it; this also clears a failed rebuild's stash
    _ = mesh_edit.selectFacesByTriangleMask(mask);
    journalCommit(&snap);
    return true;
}

/// Fuse selected faces into ONE clean authored face.  Beyond regrouping, this rebuilds
/// the selected region as a boundary fan: shared seams and their collinear midpoint
/// verts disappear, exactly like Studio's mergeFaces.
pub fn meshMergeSelectedFaces() bool {
    if (!model_paint.hasTarget() or mesh_edit.mode() != .face) return false;
    const verts = g_edit_verts orelse return false;
    const tri_count = g_edit_count / 3;
    if (tri_count == 0) return false;
    const mask = jalloc.alloc(bool, tri_count) catch return false;
    defer jalloc.free(mask);
    if (mesh_edit.buildDeleteMask(mask) == 0) return false;
    const groups = captureFaceGroups();
    defer if (groups) |rows| std.heap.c_allocator.free(rows);
    const parts = capturePartOfFaces();
    defer if (parts) |rows| std.heap.c_allocator.free(rows);
    const part_count = hostPartCount();
    const base_colors = collectCurrentFaceColors() orelse return false;
    defer std.heap.c_allocator.free(base_colors);
    const groups_arg: ?[]const u32 = if (model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP) groups else null;
    var indexed = cloneIndexedEditMeshOrImport(verts, tri_count, groups_arg, parts) orelse return false;
    defer indexed.deinit();
    if (!(indexed.mergeSelected(mask) catch return false)) return false;
    var lowered = indexed.lower() catch return false;
    defer lowered.deinit();
    const colors = std.heap.c_allocator.alloc(u8, @as(usize, lowered.tri_count) * 4) catch return false;
    defer std.heap.c_allocator.free(colors);
    if (!mesh_edit.inheritFaceRgba(base_colors, lowered.source_triangles, colors)) return false;

    var snap = journalSnapshotCurrent("merge faces");
    mesh_edit.clearSelection();
    const install_groups: ?[]const u32 = if (groups_arg != null) lowered.groups else null;
    const ok = lcInstallLowered(lowered.positions, lowered.uvs, lowered.tri_count, install_groups, colors);
    if (ok) {
        if (parts != null) renormalizePartRanges(lowered.parts, part_count);
        adoptIndexedEditMesh(&indexed, &lowered);
        journalCommit(&snap);
    } else journalDiscard(&snap);
    return ok;
}

/// Toggle the selected faces (face mode) as GLASS: their atlas texels get a translucent
/// alpha and the mesh re-partitions so every glass face sits in one trailing run the
/// draw routes through the transparent pipeline (per-face glass on ONE resident mesh).
/// Toggling faces that are already glass makes them opaque again.
pub fn meshSetSelectionGlass() bool {
    if (!model_paint.hasTarget()) return false;
    if (mesh_edit.mode() != .face) return false;
    const tri_count = g_edit_count / 3;
    if (tri_count == 0) return false;
    const mask = jalloc.alloc(bool, tri_count) catch return false;
    defer jalloc.free(mask);
    const selected = mesh_edit.buildDeleteMask(mask);
    if (selected == 0) return false;

    var snap = journalSnapshotCurrent("glass faces");
    mesh_edit.clearSelection(); // restore the tinted patches before colours are read

    const colors = collectCurrentFaceColors() orelse {
        journalDiscard(&snap);
        return false;
    };
    defer jalloc.free(colors);
    // Toggle by the first selected face: already glass → un-glass the selection.
    var first: u32 = 0;
    var f: u32 = 0;
    while (f < tri_count) : (f += 1) {
        if (mask[f]) {
            first = f;
            break;
        }
    }
    const make_glass = colors[@as(usize, first) * 4 + 3] >= 250;
    f = 0;
    while (f < tri_count) : (f += 1) {
        if (!mask[f]) continue;
        colors[@as(usize, f) * 4 + 3] = if (make_glass) GLASS_ALPHA else 255;
    }
    if (!partitionGlassFaces(colors)) {
        journalDiscard(&snap);
        return false;
    }
    journalCommit(&snap);
    return true;
}

/// Rebuild the mesh with a STABLE opaque-then-glass partition (face order otherwise
/// preserved), applying `colors` (per PRE-partition face, alpha authoritative)
/// permuted to the new order. Group ids ride along, so part identity is untouched.
fn partitionGlassFaces(colors: []const u8) bool {
    const cur_verts = g_edit_verts orelse return false;
    const tri_count = g_edit_count / 3;
    if (colors.len < @as(usize, tri_count) * 4) return false;
    const has_groups = model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP;
    const cur_groups: ?[]u32 = if (has_groups) captureFaceGroups() else null;
    defer if (cur_groups) |g| jalloc.free(g);

    var out: std.ArrayListUnmanaged(f32) = .empty;
    defer out.deinit(jalloc);
    var new_groups: std.ArrayListUnmanaged(u32) = .empty;
    defer new_groups.deinit(jalloc);
    var new_colors: std.ArrayListUnmanaged(u8) = .empty;
    defer new_colors.deinit(jalloc);

    inline for (.{ true, false }) |want_opaque| {
        var f: u32 = 0;
        while (f < tri_count) : (f += 1) {
            const is_opaque = colors[@as(usize, f) * 4 + 3] >= 250;
            if (is_opaque != want_opaque) continue;
            const base = @as(usize, f) * 24;
            if (base + 24 > cur_verts.len) break;
            if (!appendFloats(&out, cur_verts[base .. base + 24])) return false;
            if (cur_groups) |g| new_groups.append(jalloc, g[f]) catch return false;
            new_colors.appendSlice(jalloc, colors[@as(usize, f) * 4 .. @as(usize, f) * 4 + 4]) catch return false;
        }
    }
    const count: u32 = @intCast(out.items.len / 8);
    if (count != g_edit_count) return false;
    if (!replaceActiveEditMesh(out.items, count)) return false;
    if (cur_groups != null) model_source.setFaceGroups(new_groups.items);
    model_paint.applyColors(new_colors.items);
    if (model_source.colors()) |src| {
        const n = @min(src.len, new_colors.items.len);
        if (n > 0) @memcpy(src[0..n], new_colors.items[0..n]);
    }
    _ = refreshPaintLayout();
    return true;
}

/// Glass faces must occupy ONE trailing run (the draw splits the mesh there). Anything
/// that appends opaque faces after them (add part, duplicate, solidify) re-partitions.
fn ensureGlassTrailing() void {
    const fc = model_paint.faceCount();
    if (fc == 0) return;
    var first_glass: ?u32 = null;
    var needs = false;
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        const c = model_paint.faceColor(f) orelse continue;
        const is_glass = c[3] < 250;
        if (is_glass and first_glass == null) first_glass = f;
        if (!is_glass and first_glass != null) needs = true;
    }
    if (!needs) return;
    const colors = collectCurrentFaceColors() orelse return;
    defer jalloc.free(colors);
    _ = partitionGlassFaces(colors);
}

/// First vertex of the trailing GLASS run (== displayed vert count when no glass).
/// Derived live from the per-face alphas, so it's correct after any op or restore.
fn editGlassFirstVert() u32 {
    const fc = model_paint.faceCount();
    var k = fc;
    while (k > 0) : (k -= 1) {
        const c = model_paint.faceColor(k - 1) orelse break;
        if (c[3] >= 250) break;
    }
    return k * 3;
}

/// Durable model-document boundary: first vertex of the trailing per-face glass
/// run. Meshdoc v2 stores this beside the source soup so an exported resident
/// mesh can recreate the transparent, depth-write-off draw after leaving Studio.
pub fn modelGlassFirstVertex() u32 {
    const verts = model_source.verts() orelse return 0;
    const face_count: usize = verts.len / 24;
    const colors = model_source.colors() orelse return @intCast(face_count * 3);
    if (colors.len < face_count * 4) return @intCast(face_count * 3);
    var first = face_count;
    while (first > 0) : (first -= 1) {
        if (colors[(first - 1) * 4 + 3] >= 250) break;
    }
    return @intCast(first * 3);
}

/// Solidify the selected faces (face mode) IN PLACE: an inner skin offset by the
/// selected AUTHORED face planes plus wall quads around the selection's boundary edges.
/// Render triangles sharing a quad/ngon group collapse to one plane before the inset is
/// solved, so triangulation diagonals cannot skew the shell.  New logical faces mint
/// fresh authored identities (one inner cap per source face, one per wall quad), while
/// retaining their source colour and part ownership. Thickness in meters; <= 0 uses the
/// studio default 2/16.
pub fn meshSolidifySelection(thickness_raw: f32) bool {
    if (!model_paint.hasTarget()) return false;
    if (mesh_edit.mode() != .face) return false;
    if (!mesh_edit.ensureTopologyPub()) return false;
    const cur_verts = g_edit_verts orelse return false;
    const tri_count = g_edit_count / 3;
    if (tri_count == 0) return false;
    const mask = jalloc.alloc(bool, tri_count) catch return false;
    defer jalloc.free(mask);
    const selected = mesh_edit.buildDeleteMask(mask);
    if (selected == 0) return false;
    const t: f32 = if (thickness_raw > 1e-5) thickness_raw else mesh_edit.SolidifyTuning.default_thickness_m;

    const has_groups = model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP;
    const cur_groups: ?[]u32 = if (has_groups) captureFaceGroups() else null;
    defer if (cur_groups) |g| jalloc.free(g);
    const base_part = capturePartOfFaces();
    defer if (base_part) |p| jalloc.free(p);
    const part_count = hostPartCount();

    // Selected render triangles are reduced to authored planes by mesh_edit's deep
    // solidify boundary. Keeping that reduction outside this host orchestration is the
    // guard against ever weighting a quad's diagonal endpoints twice again.
    var solidify_triangles: std.ArrayListUnmanaged(mesh_edit.SolidifyTriangle) = .empty;
    defer solidify_triangles.deinit(jalloc);
    // Selection-boundary edges: welded-vert pair → incident selected-face count, plus
    // the (face, corner) that owns the edge in winding order (for the wall's winding).
    const EdgeUse = struct { count: u32, face: u32, corner: u32 };
    var euse = std.AutoHashMapUnmanaged(u64, EdgeUse){};
    defer euse.deinit(jalloc);

    var f: u32 = 0;
    while (f < tri_count) : (f += 1) {
        if (!mask[f]) continue;
        const base = @as(usize, f) * 24;
        if (base + 24 > cur_verts.len) break;
        const p0: [3]f32 = .{ cur_verts[base + 0], cur_verts[base + 1], cur_verts[base + 2] };
        const p1: [3]f32 = .{ cur_verts[base + 8], cur_verts[base + 9], cur_verts[base + 10] };
        const p2: [3]f32 = .{ cur_verts[base + 16], cur_verts[base + 17], cur_verts[base + 18] };
        const corners = [3]u32{
            mesh_edit.cornerVertPub(f, 0),
            mesh_edit.cornerVertPub(f, 1),
            mesh_edit.cornerVertPub(f, 2),
        };
        solidify_triangles.append(jalloc, .{
            .face = f,
            .group = model_source.faceGroupOf(f),
            .corners = corners,
            .positions = .{ p0, p1, p2 },
        }) catch return false;
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const a = corners[k];
            const b = corners[(k + 1) % 3];
            if (a == b) continue;
            const key = (@as(u64, @min(a, b)) << 32) | @as(u64, @max(a, b));
            const egop = euse.getOrPut(jalloc, key) catch return false;
            if (!egop.found_existing) {
                egop.value_ptr.* = .{ .count = 1, .face = f, .corner = k };
            } else {
                egop.value_ptr.count += 1;
            }
        }
    }

    var offsets = mesh_edit.solidifyOffsets(jalloc, solidify_triangles.items, t) catch return false;
    defer offsets.deinit();

    var out: std.ArrayListUnmanaged(f32) = .empty;
    defer out.deinit(jalloc);
    if (!appendCurrentDisplayed(&out)) return false;
    var add_groups: std.ArrayListUnmanaged(u32) = .empty;
    defer add_groups.deinit(jalloc);
    var add_colors: std.ArrayListUnmanaged(u8) = .empty;
    defer add_colors.deinit(jalloc);
    var add_part: std.ArrayListUnmanaged(u32) = .empty;
    defer add_part.deinit(jalloc);
    var next_group: u32 = if (has_groups) nextFreeGroupId(cur_groups.?) else 0;
    var inner_groups = std.AutoHashMapUnmanaged(u32, u32){};
    defer inner_groups.deinit(jalloc);

    // Inner skin: one reversed, offset triangle per selected face (group + colour inherit).
    f = 0;
    while (f < tri_count) : (f += 1) {
        if (!mask[f]) continue;
        const base = @as(usize, f) * 24;
        if (base + 24 > cur_verts.len) break;
        var p: [3][3]f32 = undefined;
        var k: usize = 0;
        while (k < 3) : (k += 1) {
            p[k] = .{ cur_verts[base + k * 8], cur_verts[base + k * 8 + 1], cur_verts[base + k * 8 + 2] };
            const off = offsets.get(mesh_edit.cornerVertPub(f, @intCast(k)));
            p[k] = .{ p[k][0] + off[0], p[k][1] + off[1], p[k][2] + off[2] };
        }
        if (!appendTri(&out, p[0], p[2], p[1])) return false;
        if (has_groups) {
            const gop = inner_groups.getOrPut(jalloc, model_source.faceGroupOf(f)) catch return false;
            if (!gop.found_existing) {
                gop.value_ptr.* = next_group;
                next_group += 1;
            }
            add_groups.append(jalloc, gop.value_ptr.*) catch return false;
        }
        const c = trueFaceColor(f);
        add_colors.appendSlice(jalloc, c[0..]) catch return false;
        if (base_part) |bp| add_part.append(jalloc, bp[f]) catch return false;
    }
    // Rim walls on the selection's boundary edges (incident to exactly ONE selected face).
    var it = euse.iterator();
    while (it.next()) |entry| {
        const use = entry.value_ptr.*;
        if (use.count != 1) continue;
        const fa = use.face;
        const a = mesh_edit.vertPosPub(mesh_edit.cornerVertPub(fa, use.corner));
        const b = mesh_edit.vertPosPub(mesh_edit.cornerVertPub(fa, (use.corner + 1) % 3));
        const oa = offsets.get(mesh_edit.cornerVertPub(fa, use.corner));
        const ob = offsets.get(mesh_edit.cornerVertPub(fa, (use.corner + 1) % 3));
        const ai: [3]f32 = .{ a[0] + oa[0], a[1] + oa[1], a[2] + oa[2] };
        const bi: [3]f32 = .{ b[0] + ob[0], b[1] + ob[1], b[2] + ob[2] };
        // Edge a→b runs in the face's winding, so (a, ai, bi, b) faces outward.
        if (!appendQuadSplit(&out, a, ai, bi, b)) return false;
        if (has_groups) {
            const wall_group = next_group;
            next_group += 1;
            add_groups.append(jalloc, wall_group) catch return false;
            add_groups.append(jalloc, wall_group) catch return false;
        }
        const c = trueFaceColor(fa);
        add_colors.appendSlice(jalloc, c[0..]) catch return false;
        add_colors.appendSlice(jalloc, c[0..]) catch return false;
        if (base_part) |bp| {
            add_part.append(jalloc, bp[fa]) catch return false;
            add_part.append(jalloc, bp[fa]) catch return false;
        }
    }

    var snap = journalSnapshotCurrent("solidify faces");
    mesh_edit.clearSelection();
    const first_new_face = tri_count;
    const new_count: u32 = @intCast(out.items.len / 8);
    if (!replaceActiveEditMesh(out.items, new_count)) {
        journalDiscard(&snap);
        return false;
    }
    if (has_groups) {
        var all_groups: std.ArrayListUnmanaged(u32) = .empty;
        defer all_groups.deinit(jalloc);
        for (cur_groups.?) |g| all_groups.append(jalloc, g) catch {};
        for (add_groups.items) |g| all_groups.append(jalloc, g) catch {};
        model_source.setFaceGroups(all_groups.items);
        // Fresh ids must join the source part's contiguous interval; preserve each
        // output face's pre-solidify owner while re-numbering the whole partition.
        if (base_part) |bp| {
            const face_part = jalloc.alloc(u32, new_count / 3) catch null;
            if (face_part) |fp| {
                defer jalloc.free(fp);
                var old_face: u32 = 0;
                while (old_face < tri_count) : (old_face += 1) fp[old_face] = bp[old_face];
                var new_face: u32 = 0;
                while (new_face < add_part.items.len) : (new_face += 1) fp[tri_count + new_face] = add_part.items[new_face];
                renormalizePartRanges(fp, part_count);
            }
        }
    }
    // The added skin/walls take their source face's colour.
    var i: u32 = 0;
    while (i * 4 < add_colors.items.len) : (i += 1) {
        const c: [4]u8 = .{ add_colors.items[i * 4], add_colors.items[i * 4 + 1], add_colors.items[i * 4 + 2], add_colors.items[i * 4 + 3] };
        model_paint.paintFace(first_new_face + i, c);
        model_source.writeColor(@intCast(first_new_face + i), c[0], c[1], c[2]);
    }
    _ = refreshPaintLayout();
    journalCommit(&snap);
    ensureGlassTrailing();
    return true;
}

fn faceCrossFromPositions(pos: []const f32, face: u32) [3]f32 {
    const b = @as(usize, face) * 9;
    if (b + 8 >= pos.len) return .{ 0, 0, 0 };
    const a: [3]f32 = .{ pos[b + 0], pos[b + 1], pos[b + 2] };
    const p1: [3]f32 = .{ pos[b + 3], pos[b + 4], pos[b + 5] };
    const p2: [3]f32 = .{ pos[b + 6], pos[b + 7], pos[b + 8] };
    return vcross(vsub(p1, a), vsub(p2, a));
}

// The unsafe-edit predicate is the studio's concave Auto-Fix over ordered indexed
// faces (editMesh.ts isFaceConcave/newConcaveFaces, req_2823). The differential
// normal/area heuristics that lived here false-fired
// on rotates (req_2754), pre-degenerate meshes (req_2755), loop-cut slivers, and
// hinge edits (req_2816) — "changed a lot" is not "became invalid".

/// True if Split Quads would actually change topology: authored groups exist, the
/// displayed mesh IS the source (group ids are per source face), and at least one
/// offending tri sits in a group with 2+ members (splitting a singleton is a no-op).
fn guardSplitPossible(bad_list: []const u32) bool {
    if (bad_list.len == 0) return false;
    if (!model_paint.hasTarget()) return false;
    if (model_source.faceGroupOf(0) == model_source.NO_FACE_GROUP) return false;
    if (g_edit_count != model_source.count()) return false;
    const tri_count = g_edit_count / 3;
    const groups = captureFaceGroups() orelse return false;
    defer std.heap.c_allocator.free(groups);
    for (bad_list) |bf| {
        if (bf >= tri_count) continue;
        const g = groups[bf];
        if (g == model_source.NO_FACE_GROUP) continue;
        var members: u32 = 0;
        for (groups) |og| {
            if (og != g) continue;
            members += 1;
            if (members >= 2) return true;
        }
    }
    return false;
}

/// Split Quads (guard action 0, req_2757): every authored group that contains an
/// offending tri breaks into per-triangle groups, so the fold the drag created becomes
/// explicit topology instead of a hidden artifact inside a "flat" quad. Pure group
/// remap — no geometry moves; part membership is preserved by re-deriving it from the
/// ORIGINAL ids and renormalizing the per-part contiguous ranges after the renumber.
fn guardSplitQuads() bool {
    const bad_list = g_guard_bad_list orelse return false;
    if (!guardSplitPossible(bad_list)) return false;
    const tri_count = g_edit_count / 3;
    const groups = captureFaceGroups() orelse return false;
    defer jalloc.free(groups);

    var affected = std.AutoHashMapUnmanaged(u32, void){};
    defer affected.deinit(jalloc);
    for (bad_list) |bf| {
        if (bf >= tri_count) continue;
        const g = groups[bf];
        if (g == model_source.NO_FACE_GROUP) continue;
        affected.put(jalloc, g, {}) catch return false;
    }
    if (affected.count() == 0) return false;

    // Part membership must be read off the ORIGINAL ids before the renumber moves
    // them past every part range.
    var face_part: ?[]u32 = null;
    defer if (face_part) |fp| jalloc.free(fp);
    var part_count: u32 = 0;
    if (model_source.partRanges()) |pr| {
        part_count = @intCast(pr.len / 2);
        const fp = jalloc.alloc(u32, tri_count) catch return false;
        for (fp, 0..) |*slot, f| {
            slot.* = model_source.NO_PART;
            const g = groups[f];
            if (g == model_source.NO_FACE_GROUP) continue;
            var p: u32 = 0;
            while (p < part_count) : (p += 1) {
                if (g >= pr[p * 2] and g < pr[p * 2 + 1]) {
                    slot.* = p;
                    break;
                }
            }
        }
        face_part = fp;
    }

    var snap = journalSnapshotCurrent("split quads");
    // Selection tint must restore before the paint layout re-islands (detach's rule).
    mesh_edit.clearSelection();
    var next: u32 = @intCast(maxGroupId(groups) + 1);
    var f: u32 = 0;
    while (f < tri_count) : (f += 1) {
        if (groups[f] == model_source.NO_FACE_GROUP) continue;
        if (!affected.contains(groups[f])) continue;
        groups[f] = next;
        next += 1;
    }
    model_source.setFaceGroups(groups);
    if (face_part) |fp| {
        renormalizePartRanges(fp, part_count);
    } else {
        mesh_edit.reset();
        _ = refreshPaintLayout();
    }
    journalCommit(&snap);
    return true;
}

pub fn meshGizmoBegin() void {
    clearMeshGuardSnapshot();
    gizmoDragReset(); // stepped drags (req_2759): fresh accumulator + frozen pivot per grab
    // Pre-drag journal snapshot — committed at release only if the drag moved something.
    journalDiscard(&g_gizmo_snap);
    g_gizmo_snap = journalSnapshotCurrent("transform");
    const pos = model_paint.positions() orelse return;
    g_guard_before = std.heap.c_allocator.dupe(f32, pos) catch null;
    if (ensureIndexedEditMesh()) {
        if (g_indexed_edit_mesh) |*mesh| g_guard_indexed_before = mesh.clone() catch null;
    }
    g_guard_face_count = model_paint.faceCount();
}

/// Grab bookkeeping the engine reports at press: WHICH handle was grabbed (the gold
/// glow) and where the cursor started — the uniform hub drag is RADIAL (the studio's
/// hypot(cursor − anchor) / startScreenDist), so it needs the grab point. Window px.
pub fn meshGizmoGrabAt(mx: f32, my: f32, code: i32) void {
    g_gizmo_active = code;
    g_gizmo_cursor = .{ vpLocalX(mx), vpLocalY(my) };
    g_gizmo_start_dist = 4;
    const pivot = mesh_edit.selectionPivot() orelse return;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const a = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, pivot) orelse return;
    const ddx = g_gizmo_cursor[0] - a[0];
    const ddy = g_gizmo_cursor[1] - a[1];
    g_gizmo_start_dist = @max(4.0, @sqrt(ddx * ddx + ddy * ddy));
}

pub fn meshGizmoFinish() bool {
    g_gizmo_readout_len = 0; // the drag is ending — drop the live step readout
    g_gizmo_pivot0 = null;
    g_gizmo_active = -1; // release drops the gold glow
    const before = g_guard_before orelse {
        journalDiscard(&g_gizmo_snap);
        return false;
    };
    const after = model_paint.positions() orelse {
        journalDiscard(&g_gizmo_snap);
        clearMeshGuardSnapshot();
        return false;
    };
    if (after.len != before.len) {
        journalDiscard(&g_gizmo_snap);
        clearMeshGuardSnapshot();
        return false;
    }
    // A press that moved nothing leaves no undo step.
    if (std.mem.eql(f32, before, after)) journalDiscard(&g_gizmo_snap) else journalCommit(&g_gizmo_snap);
    const fc: u32 = @intCast(@min(before.len / 9, after.len / 9));
    // Studio concave guard (req_0949 port): only an authored face NEWLY buckled into a
    // reflex polygon is unsafe. bad_list carries one member tri per buckled face (the
    // currency guardSplitPossible/guardSplitQuads already speak); the dialog count is
    // FACES, matching the studio's "N face(s) buckled — not convex".
    var bad_list: std.ArrayListUnmanaged(u32) = .empty;
    var bad_faces: u32 = 0;
    if (g_guard_indexed_before) |*before_mesh| {
        if (g_indexed_edit_mesh) |*after_mesh| {
            bad_faces = after_mesh.newlyConcaveComparedTo(before_mesh, &bad_list);
        }
    }
    if (bad_faces == 0) {
        bad_list.deinit(std.heap.c_allocator);
        clearMeshGuardSnapshot();
        return false;
    }
    g_guard_pending = true;
    g_guard_bad_faces = bad_faces;
    g_guard_face_count = fc;
    g_guard_bad_list = bad_list.toOwnedSlice(std.heap.c_allocator) catch null;
    g_guard_can_split = if (g_guard_bad_list) |bl| guardSplitPossible(bl) else false;
    return true;
}

pub fn meshEditGuardInfo() [4]u32 {
    return .{ if (g_guard_pending) 1 else 0, g_guard_bad_faces, g_guard_face_count, if (g_guard_pending and g_guard_can_split) 1 else 0 };
}

pub fn meshEditGuardResolve(action: u8) bool {
    if (!g_guard_pending) return false;
    var changed = false;
    if (action == 0) changed = guardSplitQuads();
    if (action == 2) {
        const before = g_guard_before orelse {
            clearMeshGuardSnapshot();
            return false;
        };
        const pos = model_paint.positionsMutable() orelse {
            clearMeshGuardSnapshot();
            return false;
        };
        if (before.len == pos.len) {
            @memcpy(pos, before);
            const fc: u32 = @intCast(pos.len / 9);
            if (fc > 0) {
                _ = copyPaintPositionsToEditVerts(0, fc - 1);
                _ = model_source.updateGeometryFromDisplayed(pos, 0, fc - 1);
                _ = patchActiveEditMesh(0, fc - 1);
                if (g_indexed_edit_mesh) |*mesh| {
                    const verts = g_edit_verts orelse {
                        clearIndexedEditMesh();
                        return false;
                    };
                    if (!mesh.updatePositionsFromInterleaved(verts, fc)) clearIndexedEditMesh();
                }
            }
            // The restore bypassed mesh_edit's mutation path, so its welded
            // vert positions (overlay dots/edges, gizmo pivot, picking) still
            // hold the pre-revert drag — resync them from the restored soup
            // (req_2539). Selection and topology stay.
            mesh_edit.refreshPositionsFromSoup();
            changed = true;
            // The revert returned the mesh to the exact state the newest journal entry
            // snapshots — undoing to it would be a visible no-op, so drop the entry.
            journalDropLast();
        }
    }
    clearMeshGuardSnapshot();
    return changed;
}

// ── Mesh-element selection (the host-native editor surface) ───────────────────────
// ── Native mesh-editor input capture (modelview) ─────────────────────────────────
// When capturing, the ENGINE owns the model-editor input loop (middle-drag orbit, left
// select/marquee, wheel zoom, double-click focus) with zero JS per event — the cart sets
// the mode/tool via doors but never touches a mouse event. These flags are the engine's
// gate + tool read; the gesture state itself lives in the engine event loop.
var g_me_capture: bool = false;
var g_me_focus_tool: bool = false;
const GizmoTool = enum(u8) { move = 0, scale = 1, rotate = 2 };
var g_gizmo_tool: GizmoTool = .move;
pub fn setMeshEditCapture(on: bool) void {
    g_me_capture = on;
}
pub fn meshEditCapturing() bool {
    return g_me_capture;
}
pub fn setMeshEditFocusTool(on: bool) void {
    g_me_focus_tool = on;
}
pub fn meshEditFocusTool() bool {
    return g_me_focus_tool;
}
pub fn setMeshGizmoTool(t: u8) void {
    g_gizmo_tool = switch (t) {
        1 => .scale,
        2 => .rotate,
        else => .move,
    };
}
pub fn meshGizmoToolRaw() u8 {
    return @intFromEnum(g_gizmo_tool);
}
/// The current selection mode as a raw int (0 none, 1 vertex, 2 edge, 3 face) — the engine
/// reads it to decide what a left press does (select vs nothing).
pub fn meshEditModeRaw() u8 {
    return @intFromEnum(mesh_edit.mode());
}
/// Set the selection mode: 0 none, 1 vertex, 2 edge, 3 face. Out-of-range → none.
pub fn meshEditSetMode(m: u8) void {
    mesh_edit.setMode(switch (m) {
        1 => .vertex,
        2 => .edge,
        3 => .face,
        else => .none,
    });
}
/// Live mirror editing (req_2758): enable/disable the X/Y/Z symmetry planes (bit 0/1/2).
pub fn meshEditSetMirror(mask: u8) void {
    mesh_edit.setMirrorMask(mask);
}
pub fn meshEditMirrorRaw() u8 {
    return mesh_edit.mirrorMask();
}
// ── Paint session (req_2662: the mode row is ONE exclusive state machine) ───────────
// While the cart is in paint mode, every edit-selection affordance goes quiet:
// selection doors are inert (an outliner click mid-paint used to force face mode +
// tint + live gizmo rings — "i dont know how i got here"), and the overlay draws no
// mode dressing / gizmo. Entering the session RESETS the selection (documented choice:
// paint entry clears; leaving paint starts clean in Object mode — nothing to restore).
var g_paint_session: bool = false;
// Structural mesh edits invalidate the authored UV/island contract.  The
// carried atlas may remain visible as a preview, but all paint entry points
// fail closed until Create/Remake Paint Atlas explicitly lays a new base.
var g_paint_layout_stale: bool = false;

pub fn paintLayoutStale() bool {
    return g_paint_layout_stale;
}

/// Restore the persisted topology/atlas mismatch on a cold editor load. Only
/// explicit setPaintBase may clear this state; loading an old raster/program is
/// deliberately not an unlock path.
pub fn invalidatePaintLayout() void {
    g_paint_layout_stale = true;
    g_paint_session = false;
}

pub fn setPaintSession(io: std.Io, environ: *const std.process.Environ.Map, on: bool) void {
    // Host enforcement: a cart bug, script, or stale UI state cannot enter paint
    // against a topology revision whose atlas has not been explicitly rebuilt.
    if (on and g_paint_layout_stale) return;
    if (on == g_paint_session) return;
    g_paint_session = on;
    if (on) {
        mesh_edit.clearSelection(); // restores tinted faces to true paint (atlas patches)
        mesh_edit.setMode(.none); // drops the face-mode dressing with it
    } else {
        // Leaving paint commits any half-open stroke as its own undo unit — the journal
        // must never carry a dangling gesture across sessions (req_2672).
        _ = paintStrokeEnd(io, environ);
    }
}
pub fn paintSessionActive() bool {
    return g_paint_session;
}
/// Pick the element under (mx,my) in the current mode (additive = shift toggle/extend),
/// fold it into the selection, and repaint. Returns the new selected count, -1 if no mesh.
pub fn meshEditPick(mx: f32, my: f32, additive: bool) i32 {
    if (g_paint_session) return -1; // paint owns the surface — no selection gestures (req_2662)
    if (!model_paint.hasTarget()) return -1;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    return mesh_edit.pick(cam, g_paint_vp_w, g_paint_vp_h, vpLocalX(mx), vpLocalY(my), additive);
}

/// The visible outliner part under the pointer when it is outside the current
/// edit scope.  The engine asks before an element pick so one click can focus a
/// different part and then perform the requested vertex/edge/face selection.
pub fn meshEditOutOfScopePartAt(mx: f32, my: f32) i32 {
    if (!model_paint.hasTarget()) return -1;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const face = model_paint.pick(cam, g_paint_vp_w, g_paint_vp_h, vpLocalX(mx), vpLocalY(my));
    if (face < 0 or mesh_edit.faceInScopePub(@intCast(face))) return -1;
    const part = model_source.partIndexOf(model_source.faceGroupOf(@intCast(face)));
    return if (part == model_source.NO_PART) -1 else @intCast(part);
}
pub fn meshEditClear() void {
    mesh_edit.clearSelection();
}
/// Mesh-editor Ctrl+A — select every element of the current mode within the focused part
/// (or the whole model). Returns the selected count, -1 if no mesh.
pub fn meshEditSelectAll() i32 {
    if (g_paint_session) return -1;
    return mesh_edit.selectAll();
}
// Marquee rectangle (window px), set by the native input loop during a left drag-select.
var g_mq_active: bool = false;
var g_mq: [4]f32 = .{ 0, 0, 0, 0 };
pub fn meshSetMarquee(x0: f32, y0: f32, x1: f32, y1: f32) void {
    g_mq = .{ x0, y0, x1, y1 };
    g_mq_active = true;
}
pub fn meshClearMarquee() void {
    g_mq_active = false;
}

// Overlay colours (0..1) + sizes (px). Orange matches the face tint. Each dot/line is drawn
// twice — a dark HALO under a bright fill — so it pops on a white model AND a dark void (a
// single colour can't contrast with both).
const OV_ORANGE = [3]f32{ 1.0, 0.52, 0.16 }; // selected
const OV_HALO = [4]f32{ 0.02, 0.03, 0.07, 0.95 }; // dark outline behind every marker
const OV_MARQUEE = [4]f32{ 0.62, 0.78, 1.0, 0.98 };
// ── Gizmo (PORT of the studio's meshGizmo.tsx, req_2827) ────────────────────────────
// Fixed SCREEN sizes — zoom-independent, like Blockbench: armPx 48 / headPx 9 /
// centerPx 6 / grabPx 14 / shaft 2.5, verbatim from the studio's GIZMO table. Shape
// encodes the tool: MOVE arms end in chevron ARROWHEADS and the hub is a hollow ring;
// SCALE arms are DOUBLE-ended with square handles and a solid hub — grabbing the hub
// scales ALL axes at once (uniform). The grabbed handle glows gold. The axis palette
// is the studio's (#e0584e / #5ec26a / #4aa3ff) — the compass and mirror planes share
// it through axisColor.
const GIZMO_X = [3]f32{ 0.878, 0.345, 0.306 }; // #e0584e
const GIZMO_Y = [3]f32{ 0.369, 0.761, 0.416 }; // #5ec26a
const GIZMO_Z = [3]f32{ 0.290, 0.639, 1.0 }; // #4aa3ff
const GIZMO_ACTIVE = [3]f32{ 1.0, 0.824, 0.290 }; // #ffd24a — the grabbed handle glows
const GIZMO_HUB_RIM = [3]f32{ 0.812, 0.886, 1.0 }; // #cfe2ff — hub border / rotate hub
const GIZMO_HUB_FILL = [3]f32{ 0.749, 0.902, 0.933 }; // #bfe6ee — scale's solid hub
const GIZMO_DARK = [3]f32{ 0.043, 0.075, 0.125 }; // #0b1320 — move hub fill / square edge
const GIZMO_ARM_PX: f32 = 48; // studio armPx — fixed, never selection-scaled
const GIZMO_HEAD_PX: f32 = 9; // arrowhead reach / square handle half-size
const GIZMO_CENTER_PX: f32 = 6; // hub radius
const GIZMO_SHAFT_W: f32 = 2.5;
const GIZMO_UNIFORM_CODE: i32 = 3; // hit code: the scale hub — uniform all-axes scale
// negative-end handles (scale's second squares) encode as axis + GIZMO_NEG_BASE.
const GIZMO_NEG_BASE: i32 = 4;
const GIZMO_STEP_UNIFORM: f32 = 0.1; // studio gizmoUniformStep
const GIZMO_STEP_UNIFORM_FINE: f32 = 0.05; // studio gizmoUniformStepFine
const GIZMO_HIT_PX: f32 = 14; // studio grabPx — click radius around a handle / along a shaft
const OV_MAX_VERT_DOTS: u32 = 80000; // beyond this draw only selected dots (wireframe still
// shows topology) — a generous fps guard, not a data cap.
const OV_EDGE = [3]f32{ 0.62, 0.70, 0.85 }; // unselected boundary edge (real model edges)
// Above this boundary-edge count, skip the overlay edge lines (a huge triangle soup with no
// grouping would flood the pass) — the GPU wireframe toggle still shows topology.
const OV_MAX_EDGE_LINES: u32 = 40000;
// ── Face-mode dressing (req_2618 gap B) ────────────────────────────────────────────
// Face mode must be unmistakable: every front-facing face gets a translucent tint quad
// and a centroid dot (the old studio's signature look). Drawn as OVERLAY polys/capsules
// only — never by touching vertex colors or the paint atlas (the bake bugs of
// req_2611/req_2613 came from tinting atlas pixels; overlay geometry cannot bake).
const OV_FACE_TINT = [4]f32{ 0.55, 0.66, 0.92, 0.10 }; // unselected face wash
const OV_FACE_TINT_SEL = [4]f32{ 1.0, 0.52, 0.16, 0.22 }; // selected face wash (over atlas orange)
const OV_FACE_DOT = [3]f32{ 0.72, 0.79, 0.95 }; // centroid dot fill
const OV_FACE_DOT_PX: f32 = 3.0;
const OV_FACE_DOT_SEL_PX: f32 = 5.0;
const OV_MAX_FACE_TINT: u32 = 20000; // tint/dot pass fps guard (tris)
// ── Loop-cut session accents (req_2625 gaps CC/DD) ─────────────────────────────────
const OV_LC_ACCENT = [3]f32{ 0.30, 0.95, 1.0 }; // fresh cut edges while the popup is live
const OV_LC_HANDLE_PX: f32 = 34; // translate-style handle half-length on the cut plane
// ── Modeling stage (req_2618 gap A / req_2623): the 3×3 tile floor + world axes ────
// World basis: 1 game tile = 1 m = 16 u — the SAME Blockbench 16x basis the paint
// density uses (model_paint: detail is texels per METER, 16x = 16 to the meter) and the
// studio grid pinned (unitsPerTile 16, tileMeters 1, gridTiles 3, fineDivisions 16).
// This is tile SPACE, not decoration: a part spanning one panel is one tile in-game.
const STAGE_TILE_M: f32 = stage_scale.Tuning.tile_meters; // one panel = one game tile = 1 m
const STAGE_TILES: u32 = 3; // 3×3 panels on the ground plane
const STAGE_FINE_DIV: u32 = 16; // center panel sub-grid: 1 u = 1/16 m pitch
const STAGE_AXIS_M: f32 = STAGE_TILE_M; // one game metre from origin
const STAGE_PANEL = [4]f32{ 0.30, 0.40, 0.62, 0.09 }; // faint blue-grey tile panel
const STAGE_PANEL_CENTER = [4]f32{ 0.36, 0.48, 0.72, 0.13 }; // brighter fine center cell
const STAGE_LINE = [4]f32{ 0.46, 0.56, 0.78, 0.38 }; // tile boundary lines
const STAGE_FINE_LINE = [4]f32{ 0.46, 0.56, 0.78, 0.16 }; // center sub-grid (dimmer)
const STAGE_AXIS_ALPHA: f32 = 0.55;
// Player-scale cue (req_2869): the floor grid tells width/depth, but it has no honest
// height reference. This compact ruler + mannequin lives in the native stage overlay so
// it follows the same camera and metre contract as the mesh and never becomes model data.
const STAGE_SCALE_CUE = struct {
    // The cue sits on the ground plane beside the camera target, not at a fixed stage
    // corner. Small models frame tightly, so a corner ruler would fall offscreen just
    // when its scale reference is most needed.
    const ruler_side_min_m: f32 = 0.36;
    const ruler_side_radius_fraction: f32 = 0.40;
    const ruler_side_max_m: f32 = 0.70;
    const mannequin_ruler_gap_m: f32 = 0.34;
    const ruler_minor_tick_length_m: f32 = 0.10;
    const ruler_major_tick_length_m: f32 = 0.18;
    const ruler_reference_tick_length_m: f32 = 0.28;
    const ruler_width_px: f32 = 2.0;
    const tick_width_px: f32 = 1.3;
    const reference_width_px: f32 = 2.2;
    const guide_width_px: f32 = 1.1;
    const label_pad_px: f32 = 8;
    const label_font_px: u16 = 11;
    const label_top_rise_px: f32 = 11;
    const label_center_rise_px: f32 = 5.5;
    const mannequin_shoulder_height_m: f32 = 1.43;
    const mannequin_hip_height_m: f32 = 0.84;
    const mannequin_hand_height_m: f32 = 0.92;
    const mannequin_shoulder_half_width_m: f32 = 0.20;
    const mannequin_hand_half_width_m: f32 = 0.32;
    const mannequin_foot_half_width_m: f32 = 0.13;
    const mannequin_head_radius_m: f32 = 0.16;
    const mannequin_line_width_px: f32 = 2.2;
    const mannequin_head_min_diameter_px: f32 = 7;
    const mannequin_head_max_diameter_px: f32 = 42;
    const mannequin_viewport_margin_px: f32 = 16;
    const ruler = [4]f32{ 0.63, 0.75, 0.98, 0.80 };
    const meter = [4]f32{ 0.66, 0.80, 1.0, 0.88 };
    const collider = [4]f32{ 1.0, 0.67, 0.32, 0.96 };
    const visual_head = [4]f32{ 0.78, 0.56, 1.0, 0.96 };
    const mannequin = [4]f32{ 0.71, 0.84, 1.0, 0.78 };
    const guide_alpha: f32 = 0.54;
    const text_shadow = [4]f32{ 0.02, 0.03, 0.07, 0.90 };
};
// ── Viewport orientation compass (req_2643 gap LL) ─────────────────────────────────
// The old studio's bottom-left nav ball, host-native: a small ball whose three axis
// arms are the CURRENT camera's rotation applied to the world basis (rotation only —
// no translation, no perspective), so it turns live with every orbit. Positive ends
// are solid labeled dots; negative ends dimmer hollow rings (the standard nav-ball
// read). Drawn whenever the model doc view has a mesh — like the stage, not only in
// edit modes. Clicking a dot snaps the orbit to that axis-aligned view (the engine's
// press path routes through meshCompassHit/meshCompassSnap).
const COMPASS_R_PX: f32 = 38; // ball (backdrop disc) radius
const COMPASS_MARGIN_PX: f32 = 14; // inset from the pane's bottom-left corner
const COMPASS_ARM_PX: f32 = 25; // axis arm length, ball centre → dot centre
const COMPASS_DOT_PX: f32 = 13; // positive (labeled) dot diameter
const COMPASS_DOT_NEG_PX: f32 = 9; // negative ring outer diameter
const COMPASS_RING_GAP_PX: f32 = 4; // ring wall: outer minus inner disc diameter
const COMPASS_HIT_PX: f32 = 11; // click-to-snap pick radius around a dot
const COMPASS_MIN_PANE_PX: f32 = 170; // hide on panes too small to host the ball
const COMPASS_BACK = [4]f32{ 0.05, 0.07, 0.12, 0.66 }; // ball backdrop
const COMPASS_RIM = [4]f32{ 0.35, 0.42, 0.58, 0.55 }; // 1.5px rim ring
const COMPASS_TEXT = [3]f32{ 0.72, 0.79, 0.95 }; // readout text (OV_FACE_DOT blue)
const COMPASS_AWAY_FADE: f32 = 0.72; // depth cue: ends pointing away sit dimmer

/// Depth-coded vertex fill (req_3064): from an axis-on view every dot lands on the same
/// pixel column and coplanarity is unreadable, so the FILL encodes depth along the view's
/// dominant WORLD axis — verts at the exact same depth share the exact same colour, and
/// one off-plane vert reads as the odd colour out. The hue wheel cycles once per
/// OV_DEPTH_HUE_PERIOD_M of depth, so a
/// centimetre of drift becomes a ~14° hue step instead of an invisible fraction of the
/// mesh's whole depth range. Cyclic aliasing (two planes 25 cm apart sharing a hue) is
/// fine — the comparison is always between neighbours expected coplanar.
const OV_DEPTH_HUE_PERIOD_M: f32 = 0.25;
fn ovDepthColor(depth: f32) [3]f32 {
    return effects_ctx.EffectContext.hsvToRgb(depth / OV_DEPTH_HUE_PERIOD_M, 0.65, 1.0);
}
/// A haloed dot: a dark disc, then the bright fill on top — visible on any background.
fn overlayDot(px: f32, py: f32, r: f32, g: f32, b: f32, size: f32) void {
    capsules.drawCapsule(px, py, px, py, OV_HALO[0], OV_HALO[1], OV_HALO[2], OV_HALO[3], size + 3.5);
    capsules.drawCapsule(px, py, px, py, r, g, b, 1.0, size);
}
/// A haloed line — dark stroke under a bright one, so selected edges read on any surface.
fn overlayLine(ax: f32, ay: f32, bx: f32, by: f32, r: f32, g: f32, b: f32, w: f32) void {
    capsules.drawCapsule(ax, ay, bx, by, OV_HALO[0], OV_HALO[1], OV_HALO[2], OV_HALO[3], w + 2.5);
    capsules.drawCapsule(ax, ay, bx, by, r, g, b, 1.0, w);
}

fn axisVec(axis: i32) [3]f32 {
    return switch (axis) {
        0 => .{ 1, 0, 0 },
        1 => .{ 0, 1, 0 },
        else => .{ 0, 0, 1 },
    };
}
fn axisColor(axis: i32) [3]f32 {
    return switch (axis) {
        0 => GIZMO_X,
        1 => GIZMO_Y,
        else => GIZMO_Z,
    };
}
fn vadd(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[0] + b[0], a[1] + b[1], a[2] + b[2] };
}
fn vsub(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}
fn vmul(a: [3]f32, s: f32) [3]f32 {
    return .{ a[0] * s, a[1] * s, a[2] * s };
}
fn vdot(a: [3]f32, b: [3]f32) f32 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
fn vcross(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] };
}
fn vnorm(a: [3]f32) [3]f32 {
    const l = @sqrt(vdot(a, a));
    if (l < 1e-8) return .{ 0, 0, 0 };
    return .{ a[0] / l, a[1] / l, a[2] / l };
}
fn worldUnitsPerPixel(cam: model_paint.Camera, p: [3]f32) f32 {
    const fwd = vnorm(vsub(cam.target, cam.eye));
    const rel = vsub(p, cam.eye);
    const z = @max(0.001, vdot(rel, fwd));
    const span = 2.0 * z * @tan(cam.fov_deg * std.math.pi / 180.0 * 0.5);
    return if (g_paint_vp_h > 1) span / g_paint_vp_h else 0.01;
}
/// Port of the studio's axisScreen (meshGizmo.tsx): a world direction at the pivot, in
/// screen space — the anchor, the 2D unit direction, and how many screen px one world
/// unit spans there (the drag→world mapping). Arms are drawn a FIXED GIZMO_ARM_PX along
/// this direction, so the gizmo is zoom-independent and foreshortening never bends it.
/// Null when the pivot/probe projects behind the camera or the axis vanishes into the
/// screen (the studio's `pxPerUnit <= 0` skip).
const AxisScreen = struct { ax: f32, ay: f32, dx: f32, dy: f32, px_per_unit: f32 };
fn axisScreenInfo(cam: model_paint.Camera, pivot: [3]f32, u: [3]f32) ?AxisScreen {
    const eps: f32 = 0.01;
    const a = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, pivot) orelse return null;
    const b = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, vadd(pivot, vmul(u, eps))) orelse return null;
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len = @sqrt(vx * vx + vy * vy);
    if (len <= 1e-4) return null; // studio: lenPerEps must clear 1e-4
    return .{ .ax = a[0], .ay = a[1], .dx = vx / len, .dy = vy / len, .px_per_unit = len / eps };
}
/// A handle's screen position: GIZMO_ARM_PX along the axis' screen direction.
fn gizmoArmEnd(s: AxisScreen, sign: f32) [2]f32 {
    return .{ s.ax + s.dx * GIZMO_ARM_PX * sign, s.ay + s.dy * GIZMO_ARM_PX * sign };
}
fn segDist2(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) f32 {
    const vx = bx - ax;
    const vy = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const len2 = vx * vx + vy * vy;
    const t = if (len2 > 1e-6) std.math.clamp((wx * vx + wy * vy) / len2, 0.0, 1.0) else 0.0;
    const cx = ax + t * vx;
    const cy = ay + t * vy;
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy;
}
fn ringBasis(axis: [3]f32) [2][3]f32 {
    const ref: [3]f32 = if (@abs(axis[1]) < 0.85) .{ 0, 1, 0 } else .{ 1, 0, 0 };
    const u = vnorm(vcross(axis, ref));
    return .{ u, vnorm(vcross(axis, u)) };
}
/// Port of the studio's ringRadiusWorld: the world radius that projects to ~armPx at
/// the pivot, derived from the FIRST axis with a usable screen span (X unless X is
/// degenerate). Deliberately including the studio's quirk the user PINNED as a feature
/// (req_2827): when that axis foreshortens (the view swinging down it), px-per-unit
/// collapses and the rings BLOW UP on screen — a much larger wheel, so every dragged
/// pixel is a finer angle.
fn gizmoRingWorldR(cam: model_paint.Camera, pivot: [3]f32) f32 {
    var a: i32 = 0;
    while (a < 3) : (a += 1) {
        const s = axisScreenInfo(cam, pivot, axisVec(a)) orelse continue;
        if (s.px_per_unit > 1e-4) return GIZMO_ARM_PX / s.px_per_unit;
    }
    return 0;
}
fn drawGizmoRing(cam: model_paint.Camera, pivot: [3]f32, axis: i32, ox: f32, oy: f32) void {
    const col = gizmoAxisDrawColor(axis); // the grabbed ring glows gold (studio behavior)
    const av = axisVec(axis);
    const basis = ringBasis(av);
    const r = gizmoRingWorldR(cam, pivot);
    const steps: u32 = 48;
    var prev: ?[2]f32 = null;
    var i: u32 = 0;
    while (i <= steps) : (i += 1) {
        const t = (@as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(steps))) * std.math.pi * 2.0;
        const p = vadd(pivot, vadd(vmul(basis[0], @cos(t) * r), vmul(basis[1], @sin(t) * r)));
        const sp = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, p) orelse {
            prev = null;
            continue;
        };
        if (prev) |q| overlayLine(q[0] + ox, q[1] + oy, sp[0] + ox, sp[1] + oy, col[0], col[1], col[2], 3.0);
        prev = sp;
    }
}
fn ringHitDist2(cam: model_paint.Camera, pivot: [3]f32, axis: i32, mx: f32, my: f32) f32 {
    const av = axisVec(axis);
    const basis = ringBasis(av);
    const r = gizmoRingWorldR(cam, pivot);
    const steps: u32 = 48;
    var prev: ?[2]f32 = null;
    var best: f32 = 1.0e12;
    var i: u32 = 0;
    while (i <= steps) : (i += 1) {
        const t = (@as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(steps))) * std.math.pi * 2.0;
        const p = vadd(pivot, vadd(vmul(basis[0], @cos(t) * r), vmul(basis[1], @sin(t) * r)));
        const sp = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, p) orelse {
            prev = null;
            continue;
        };
        if (prev) |q| best = @min(best, segDist2(mx, my, q[0], q[1], sp[0], sp[1]));
        prev = sp;
    }
    return best;
}

/// Live mirror planes (req_2758): each enabled symmetry plane draws as an axis-colored
/// square outline through the current outliner scope's local center — the standing
/// signal that edits on one side land on the other. Edit dressing: paint mode hides it.
fn drawMirrorPlanesOverlay(cam: model_paint.Camera, ox: f32, oy: f32) void {
    const mask = mesh_edit.mirrorMask();
    if (mask == 0) return;
    const frame = mesh_edit.mirrorFramePub() orelse return;
    const r = frame.radius;
    const center = frame.center;
    var axis: u3 = 0;
    while (axis < 3) : (axis += 1) {
        if (mask & (@as(u8, 1) << axis) == 0) continue;
        // The plane's rect spans the two OTHER axes; the plane axis stays at the
        // scoped part center, not workspace zero.
        const b: u3 = if (axis == 0) 1 else 0;
        const cx: u3 = if (axis == 2) 1 else 2;
        var corners: [4][3]f32 = .{ center, center, center, center };
        const signs = [4][2]f32{ .{ -1, -1 }, .{ 1, -1 }, .{ 1, 1 }, .{ -1, 1 } };
        for (signs, 0..) |s, i| {
            corners[i][axis] = center[axis];
            corners[i][b] = center[b] + s[0] * r;
            corners[i][cx] = center[cx] + s[1] * r;
        }
        const col = axisColor(@intCast(axis));
        var i: usize = 0;
        while (i < 4) : (i += 1) {
            const pa = ovProject(cam, corners[i], ox, oy) orelse continue;
            const pb = ovProject(cam, corners[(i + 1) % 4], ox, oy) orelse continue;
            overlayLine(pa[0], pa[1], pb[0], pb[1], col[0], col[1], col[2], 1.5);
        }
    }
}

/// Gold when this axis is the live grab — the studio glows BOTH ends of a grabbed axis.
fn gizmoAxisDrawColor(axis: i32) [3]f32 {
    if (g_gizmo_active == axis or g_gizmo_active == axis + GIZMO_NEG_BASE) return GIZMO_ACTIVE;
    return axisColor(axis);
}
/// Chevron arrowhead (studio ArrowHead): two wings opening back along the axis at ±26°,
/// so MOVE reads as an arrow (vs SCALE's square).
fn drawGizmoArrowHead(x: f32, y: f32, dx: f32, dy: f32, col: [3]f32) void {
    const base = std.math.atan2(dy, dx);
    const wing = 26.0 * std.math.pi / 180.0;
    const len = GIZMO_HEAD_PX + 3;
    overlayLine(x, y, x - @cos(base - wing) * len, y - @sin(base - wing) * len, col[0], col[1], col[2], GIZMO_SHAFT_W);
    overlayLine(x, y, x - @cos(base + wing) * len, y - @sin(base + wing) * len, col[0], col[1], col[2], GIZMO_SHAFT_W);
}
/// Square scale handle (studio Square): screen-aligned quad, dark edge under the fill.
fn drawGizmoSquare(x: f32, y: f32, col: [3]f32) void {
    const h = GIZMO_HEAD_PX;
    const e = h + 1.5;
    polys.drawTri(x - e, y - e, x + e, y - e, x + e, y + e, GIZMO_DARK[0], GIZMO_DARK[1], GIZMO_DARK[2], 1.0);
    polys.drawTri(x - e, y - e, x + e, y + e, x - e, y + e, GIZMO_DARK[0], GIZMO_DARK[1], GIZMO_DARK[2], 1.0);
    polys.drawTri(x - h, y - h, x + h, y - h, x + h, y + h, col[0], col[1], col[2], 1.0);
    polys.drawTri(x - h, y - h, x + h, y + h, x - h, y + h, col[0], col[1], col[2], 1.0);
}
fn drawGizmoOverlay(cam: model_paint.Camera, ox: f32, oy: f32) void {
    if (g_paint_session) return; // paint mode suspends the gizmo entirely (req_2662)
    if (meshEditModeRaw() == 0) return;
    const pivot = mesh_edit.selectionPivot() orelse return;
    const pc = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, pivot) orelse return;
    if (g_gizmo_tool == .rotate) {
        var axis: i32 = 0;
        while (axis < 3) : (axis += 1) drawGizmoRing(cam, pivot, axis, ox, oy);
        // rotate hub: the studio's small light dot at the anchor.
        overlayDot(pc[0] + ox, pc[1] + oy, GIZMO_HUB_RIM[0], GIZMO_HUB_RIM[1], GIZMO_HUB_RIM[2], 6);
    } else {
        // Arms in the current capsule pass; MOVE tips get chevrons.
        var axis: i32 = 0;
        while (axis < 3) : (axis += 1) {
            const s = axisScreenInfo(cam, pivot, axisVec(axis)) orelse continue;
            const c = gizmoAxisDrawColor(axis);
            const signs = [2]f32{ 1, -1 };
            const nsigns: usize = if (g_gizmo_tool == .scale) 2 else 1; // scale is double-ended
            var k: usize = 0;
            while (k < nsigns) : (k += 1) {
                const h = gizmoArmEnd(s, signs[k]);
                overlayLine(s.ax + ox, s.ay + oy, h[0] + ox, h[1] + oy, c[0], c[1], c[2], GIZMO_SHAFT_W);
                if (g_gizmo_tool == .move) drawGizmoArrowHead(h[0] + ox, h[1] + oy, s.dx, s.dy, c);
            }
        }
        // Fresh segment: the square handles are POLYS, and within one segment polys flush
        // under capsules — the break lands them ON TOP of the already-flushed arms, and
        // the hub capsules below then top the squares (studio stacking: arm < square < hub).
        overlayLayerBreak(ox, oy);
        if (g_gizmo_tool == .scale) {
            var sq_axis: i32 = 0;
            while (sq_axis < 3) : (sq_axis += 1) {
                const s = axisScreenInfo(cam, pivot, axisVec(sq_axis)) orelse continue;
                const c = gizmoAxisDrawColor(sq_axis);
                for ([2]f32{ 1, -1 }) |sign| {
                    const h = gizmoArmEnd(s, sign);
                    drawGizmoSquare(h[0] + ox, h[1] + oy, c);
                }
            }
        }
        // Hub (studio): MOVE = hollow ring, decoration; SCALE = solid ball, THE uniform
        // handle — grabbing it scales all three axes at once, gold while held.
        const hub_active = g_gizmo_active == GIZMO_UNIFORM_CODE;
        const rim = if (hub_active) GIZMO_ACTIVE else GIZMO_HUB_RIM;
        overlayDot(pc[0] + ox, pc[1] + oy, rim[0], rim[1], rim[2], GIZMO_CENTER_PX * 2 + 2);
        const core_col = if (g_gizmo_tool == .scale) (if (hub_active) GIZMO_ACTIVE else GIZMO_HUB_FILL) else GIZMO_DARK;
        capsules.drawCapsule(pc[0] + ox, pc[1] + oy, pc[0] + ox, pc[1] + oy, core_col[0], core_col[1], core_col[2], 1.0, GIZMO_CENTER_PX * 2 - 2);
    }
    // Live step readout (req_2759): the drag's current SNAPPED value beside the pivot —
    // "+3.00u" / "+15°" / "×1.20" — so the grid the drag clicks along can be read off.
    if (g_gizmo_readout_len > 0) {
        const line = g_gizmo_readout[0..g_gizmo_readout_len];
        const tx = pc[0] + ox + 16;
        const ty = pc[1] + oy - 22;
        core.drawTextLine(line, tx + 1, ty + 1, 12, 0.02, 0.03, 0.07, 0.9); // shadow
        core.drawTextLine(line, tx, ty, 12, OV_ORANGE[0], OV_ORANGE[1], OV_ORANGE[2], 1.0);
    }
}

/// Port of the studio's pickGizmoHandle: rotate → nearest ring; else the SCALE hub
/// (uniform, centerPx+4 grab ring) first, then each arm — TIP or SHAFT, whichever is
/// closer, within grabPx. Returns 0..2 = positive axis handle, GIZMO_NEG_BASE+axis =
/// scale's negative-end square, GIZMO_UNIFORM_CODE = the uniform hub, -1 = miss.
pub fn meshGizmoHit(mx: f32, my: f32) i32 {
    if (g_paint_session) return -1; // req_2662: no gizmo grabs while paint owns the surface
    if (!g_me_capture or meshEditModeRaw() == 0 or !model_paint.hasTarget()) return -1;
    const pivot = mesh_edit.selectionPivot() orelse return -1;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const lmx = vpLocalX(mx);
    const lmy = vpLocalY(my);
    var best: i32 = -1;
    var best_d2: f32 = GIZMO_HIT_PX * GIZMO_HIT_PX;
    if (g_gizmo_tool == .rotate) {
        var axis: i32 = 0;
        while (axis < 3) : (axis += 1) {
            const d2 = ringHitDist2(cam, pivot, axis, lmx, lmy);
            if (d2 < best_d2) {
                best_d2 = d2;
                best = axis;
            }
        }
        return best;
    }
    const a = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, pivot) orelse return -1;
    if (g_gizmo_tool == .scale) {
        const dxc = lmx - a[0];
        const dyc = lmy - a[1];
        const r = GIZMO_CENTER_PX + 4;
        if (dxc * dxc + dyc * dyc <= r * r) return GIZMO_UNIFORM_CODE;
    }
    var axis: i32 = 0;
    while (axis < 3) : (axis += 1) {
        const s = axisScreenInfo(cam, pivot, axisVec(axis)) orelse continue;
        const signs = [2]f32{ 1, -1 };
        const nsigns: usize = if (g_gizmo_tool == .scale) 2 else 1;
        var k: usize = 0;
        while (k < nsigns) : (k += 1) {
            const h = gizmoArmEnd(s, signs[k]);
            const tdx = lmx - h[0];
            const tdy = lmy - h[1];
            const d2 = @min(tdx * tdx + tdy * tdy, segDist2(lmx, lmy, s.ax, s.ay, h[0], h[1]));
            if (d2 < best_d2) {
                best_d2 = d2;
                best = if (k == 1) axis + GIZMO_NEG_BASE else axis;
            }
        }
    }
    return best;
}

// ── Backdrop move session (req_3080) ──────────────────────────────────────────────────
// While the Reference Images panel has a backdrop expanded, the cart opens this session
// and a MOVE gizmo rides the image's center — the native input loop drags it exactly
// like the mesh gizmo (same arms, same stepped grid), and the cart polls the pose back
// while the session is open to move the quad + persist. Position only: size/opacity
// stay panel sliders (USER: keep those two, "the xyz pos blows chunks"). The session is
// hit-tested BEFORE the mesh gizmo, but its arms sit at the backdrop, never the
// selection pivot, so the two can't fight over a grab.
var g_bd_pos: ?[3]f32 = null; // active backdrop's world center; null = no session
var g_bd_active: i32 = -1; // grabbed arm (gold), -1 = none
var g_bd_raw: f32 = 0; // cumulative raw drag on the grabbed axis (m)
var g_bd_applied: f32 = 0; // stepped value already applied to the pose
var g_bd_pos0: [3]f32 = .{ 0, 0, 0 }; // pose frozen at grab — the drag's screen mapping anchor

/// Begin/update the session at the backdrop's center (`__model_bd_gizmo_set`).
pub fn bdGizmoSet(x: f32, y: f32, z: f32) void {
    g_bd_pos = .{ x, y, z };
}
/// End the session (`__model_bd_gizmo_clear`) — panel closed / row collapsed.
pub fn bdGizmoClear() void {
    g_bd_pos = null;
    g_bd_active = -1;
}
pub fn bdGizmoActive() bool {
    return g_bd_pos != null;
}
pub fn bdGizmoPos() [3]f32 {
    return g_bd_pos orelse .{ 0, 0, 0 };
}
/// Hit-test the session's three move arms (tip or shaft, grabPx — the mesh gizmo's
/// exact rule). Returns the axis 0..2, or -1.
pub fn bdGizmoHit(mx: f32, my: f32) i32 {
    const pos = g_bd_pos orelse return -1;
    if (g_paint_session or !g_me_capture or !model_paint.hasTarget()) return -1;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const lmx = vpLocalX(mx);
    const lmy = vpLocalY(my);
    var best: i32 = -1;
    var best_d2: f32 = GIZMO_HIT_PX * GIZMO_HIT_PX;
    var axis: i32 = 0;
    while (axis < 3) : (axis += 1) {
        const s = axisScreenInfo(cam, pos, axisVec(axis)) orelse continue;
        const h = gizmoArmEnd(s, 1);
        const tdx = lmx - h[0];
        const tdy = lmy - h[1];
        const d2 = @min(tdx * tdx + tdy * tdy, segDist2(lmx, lmy, s.ax, s.ay, h[0], h[1]));
        if (d2 < best_d2) {
            best_d2 = d2;
            best = axis;
        }
    }
    return best;
}
pub fn bdGizmoBegin(code: i32) void {
    g_bd_active = code;
    g_bd_raw = 0;
    g_bd_applied = 0;
    g_bd_pos0 = g_bd_pos orelse .{ 0, 0, 0 };
}
/// Drag the grabbed arm — the mesh move-gizmo's exact stepped mapping (whole modeling
/// units, Shift = fine grid, Ctrl/Alt = freeform), applied to the session pose.
pub fn bdGizmoDrag(dx: f32, dy: f32, shift: bool, free: bool) bool {
    if (g_bd_pos == null or g_bd_active < 0 or g_bd_active > 2) return false;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const s = axisScreenInfo(cam, g_bd_pos0, axisVec(g_bd_active)) orelse return false;
    g_bd_raw += (dx * s.dx + dy * s.dy) / s.px_per_unit;
    const target = snapStep(g_bd_raw, GIZMO_STEP_M, GIZMO_STEP_FINE_M, shift, free);
    const d = target - g_bd_applied;
    if (@abs(d) < 1e-7) return false;
    const av = axisVec(g_bd_active);
    g_bd_pos = vadd(g_bd_pos0, vmul(av, target));
    g_bd_applied = target;
    return true;
}
pub fn bdGizmoFinish() void {
    g_bd_active = -1;
}
/// The session's move arms + hub, drawn beside the mesh dressing — same anatomy as the
/// mesh MOVE gizmo (arm/chevron/hollow hub) so it reads as "the gizmo, on the image".
fn drawBdGizmoOverlay(cam: model_paint.Camera, ox: f32, oy: f32) void {
    const pos = g_bd_pos orelse return;
    if (g_paint_session) return;
    const pc = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, pos) orelse return;
    var axis: i32 = 0;
    while (axis < 3) : (axis += 1) {
        const s = axisScreenInfo(cam, pos, axisVec(axis)) orelse continue;
        const col = if (g_bd_active == axis) GIZMO_ACTIVE else axisColor(axis);
        const h = gizmoArmEnd(s, 1);
        overlayLine(s.ax + ox, s.ay + oy, h[0] + ox, h[1] + oy, col[0], col[1], col[2], GIZMO_SHAFT_W);
        drawGizmoArrowHead(h[0] + ox, h[1] + oy, s.dx, s.dy, col);
    }
    overlayDot(pc[0] + ox, pc[1] + oy, GIZMO_HUB_RIM[0], GIZMO_HUB_RIM[1], GIZMO_HUB_RIM[2], GIZMO_CENTER_PX * 2 + 2);
    capsules.drawCapsule(pc[0] + ox, pc[1] + oy, pc[0] + ox, pc[1] + oy, GIZMO_DARK[0], GIZMO_DARK[1], GIZMO_DARK[2], 1.0, GIZMO_CENTER_PX * 2 - 2);
}

// ── Stepped gizmo drags (req_2759; the studio's req_1023 USER RULING, host-native) ────
// Every gizmo drag is STEPPED by default: the drag accumulates a RAW cumulative value
// from grab, the cumulative target snaps to the step grid, and only the difference to
// what's already applied lands on the mesh — so the mesh clicks between grid values
// instead of drifting freeform. Shift = the fine grid; Ctrl (or Alt, the old studio's
// key) = freeform. The pivot is FROZEN at grab so cumulative rotate/scale stay exact.
const GIZMO_STEP_M: f32 = STAGE_TILE_M / 16.0; // 1 modeling unit — the stage's fine sub-grid pitch
const GIZMO_STEP_FINE_M: f32 = STAGE_TILE_M / 64.0; // Shift: a quarter unit
const GIZMO_STEP_ROT: f32 = 15.0 * std.math.pi / 180.0;
const GIZMO_STEP_ROT_FINE: f32 = 1.0 * std.math.pi / 180.0;
const GIZMO_STEP_SCALE: f32 = 0.1;
const GIZMO_STEP_SCALE_FINE: f32 = 0.05;
var g_gizmo_raw: f32 = 0; // cumulative RAW drag since grab (m / rad / linear factor offset)
var g_gizmo_applied: f32 = 0; // the stepped value already ON the mesh (scale: the factor, init 1)
var g_gizmo_pivot0: ?[3]f32 = null; // pivot frozen at grab
var g_gizmo_readout: [24]u8 = undefined; // live drag readout ("+3u" / "+15°" / "×1.20")
var g_gizmo_readout_len: usize = 0;
var g_gizmo_active: i32 = -1; // the grabbed handle's hit code (gold glow); -1 = none
var g_gizmo_cursor: [2]f32 = .{ 0, 0 }; // live cursor (vp-local px), accumulated from grab
var g_gizmo_start_dist: f32 = 40; // cursor→anchor px at grab — the uniform drag's ×1 base

fn snapStep(value: f32, step: f32, fine: f32, shift: bool, free: bool) f32 {
    if (free) return value;
    const s = if (shift) fine else step;
    if (s <= 0) return value;
    return @round(value / s) * s;
}

fn setGizmoReadout(comptime fmt: []const u8, args: anytype) void {
    const line = std.fmt.bufPrint(&g_gizmo_readout, fmt, args) catch {
        g_gizmo_readout_len = 0;
        return;
    };
    g_gizmo_readout_len = line.len;
}

/// Reset the stepped-drag accumulator — the grab site (meshGizmoBegin) calls this.
fn gizmoDragReset() void {
    g_gizmo_raw = 0;
    g_gizmo_applied = if (g_gizmo_tool == .scale) 1.0 else 0.0;
    g_gizmo_pivot0 = mesh_edit.selectionPivot();
    g_gizmo_readout_len = 0;
}

pub fn meshGizmoDrag(axis_code: i32, dx: f32, dy: f32, shift: bool, free: bool) bool {
    if (axis_code < 0 or axis_code > GIZMO_NEG_BASE + 2 or meshEditModeRaw() == 0 or !model_paint.hasTarget()) return false;
    g_gizmo_active = axis_code; // the grabbed handle glows gold until release
    // The FROZEN grab pivot keeps cumulative rotate/scale exact (each step re-derives
    // from the same origin); the live pivot is only a fallback for a lost grab.
    const pivot = g_gizmo_pivot0 orelse (mesh_edit.selectionPivot() orelse return false);
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    g_gizmo_cursor[0] += dx;
    g_gizmo_cursor[1] += dy;
    // UNIFORM scale — the studio's center-hub grab: the factor is the cursor's RADIAL
    // screen distance from the anchor over the grab distance (pull away to grow, toward
    // to shrink), snapped on the studio's gizmoUniformStep grid, applied on all 3 axes.
    if (axis_code == GIZMO_UNIFORM_CODE) {
        if (g_gizmo_tool != .scale) return false;
        const anchor = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, pivot) orelse return false;
        const rdx = g_gizmo_cursor[0] - anchor[0];
        const rdy = g_gizmo_cursor[1] - anchor[1];
        const f_raw = @sqrt(rdx * rdx + rdy * rdy) / @max(g_gizmo_start_dist, 4.0);
        const target = std.math.clamp(
            snapStep(f_raw, GIZMO_STEP_UNIFORM, GIZMO_STEP_UNIFORM_FINE, shift, free),
            mesh_edit.scale_factor_tuning.min,
            mesh_edit.scale_factor_tuning.max,
        );
        setGizmoReadout("\u{00D7}{d:.2}", .{target});
        const rel = target / g_gizmo_applied;
        if (@abs(rel - 1.0) < 1e-6) return false;
        const m = mesh_edit.scaleSelectionUniform(pivot, rel);
        if (!applyMeshMutation(m)) return false;
        g_gizmo_applied = target;
        return true;
    }
    const neg = axis_code >= GIZMO_NEG_BASE;
    const axis: i32 = if (neg) axis_code - GIZMO_NEG_BASE else axis_code;
    const s = axisScreenInfo(cam, pivot, axisVec(axis)) orelse return false;
    // Studio dragWorldDistance: project the cursor delta onto the axis' screen direction,
    // divide by px-per-unit at the anchor. A negative-end square inverts — its outward
    // (grow) direction is −axis on screen.
    const px = (dx * s.dx + dy * s.dy) * @as(f32, if (neg) -1 else 1);
    const av = axisVec(axis);
    const move_wpp = 1.0 / s.px_per_unit;
    switch (g_gizmo_tool) {
        .move => {
            g_gizmo_raw += px * move_wpp;
            const target = snapStep(g_gizmo_raw, GIZMO_STEP_M, GIZMO_STEP_FINE_M, shift, free);
            const units = target / GIZMO_STEP_M;
            setGizmoReadout("{s}{d:.2}u", .{ if (units < 0) "-" else "+", @abs(units) });
            const d = target - g_gizmo_applied;
            if (@abs(d) < 1e-7) return false;
            const m = mesh_edit.translateSelection(vmul(av, d));
            if (!applyMeshMutation(m)) return false;
            g_gizmo_applied = target;
            return true;
        },
        .rotate => {
            g_gizmo_raw += px * 0.018;
            const target = snapStep(g_gizmo_raw, GIZMO_STEP_ROT, GIZMO_STEP_ROT_FINE, shift, free);
            const deg = target * 180.0 / std.math.pi;
            setGizmoReadout("{s}{d:.0}\u{00B0}", .{ if (deg < 0) "-" else "+", @abs(deg) });
            const d = target - g_gizmo_applied;
            if (@abs(d) < 1e-7) return false;
            const m = mesh_edit.rotateSelectionAxis(av, pivot, d);
            if (!applyMeshMutation(m)) return false;
            g_gizmo_applied = target;
            return true;
        },
        .scale => {
            g_gizmo_raw += px * 0.012;
            const target = std.math.clamp(
                1.0 + snapStep(g_gizmo_raw, GIZMO_STEP_SCALE, GIZMO_STEP_SCALE_FINE, shift, free),
                mesh_edit.scale_factor_tuning.min,
                mesh_edit.scale_factor_tuning.max,
            );
            setGizmoReadout("\u{00D7}{d:.2}", .{target});
            // Multiplicative bookkeeping: applying target/applied lands the mesh exactly
            // at the cumulative factor, whatever path the drag wandered.
            const rel = target / g_gizmo_applied;
            if (@abs(rel - 1.0) < 1e-6) return false;
            const m = mesh_edit.scaleSelectionAxis(av, pivot, rel);
            if (!applyMeshMutation(m)) return false;
            g_gizmo_applied = target;
            return true;
        },
    }
}

pub fn meshGizmoNudge(axis: u8, amount: f32) bool {
    if (axis > 2 or meshEditModeRaw() == 0 or !model_paint.hasTarget()) return false;
    var snap = journalSnapshotCurrent("nudge");
    const m = mesh_edit.translateSelection(vmul(axisVec(axis), amount));
    const ok = applyMeshMutation(m);
    if (ok) journalCommit(&snap) else journalDiscard(&snap);
    return ok;
}

/// Apply an exact uniform factor without a screen-distance drag. The selection
/// pivot is frozen once, the geometry changes in one mutation / one journal
/// entry, and the orbit is reframed to the result unless the camera is locked.
pub fn meshGizmoScaleBy(factor: f32) bool {
    if (meshEditModeRaw() == 0 or !model_paint.hasTarget()) return false;
    const pivot = mesh_edit.selectionPivot() orelse return false;
    var snap = journalSnapshotCurrent("scale by value");
    const m = mesh_edit.scaleSelectionUniform(pivot, factor);
    const ok = applyMeshMutation(m);
    if (ok) {
        journalCommit(&snap);
        if (!g_orbit.locked) {
            if (mesh_edit.selectionFrame()) |frame| orbitFrame(frame.center, frame.radius);
        }
    } else journalDiscard(&snap);
    return ok;
}

/// Project a world point into the pane's window-px space (viewport-local + pane origin).
fn ovProject(cam: model_paint.Camera, p: [3]f32, ox: f32, oy: f32) ?[2]f32 {
    const s = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, p) orelse return null;
    return .{ s[0] + ox, s[1] + oy };
}
/// Force a scissor-SEGMENT boundary without changing the clip rect. Within one segment
/// the pipelines draw in a fixed order (…capsules, THEN polys), so a poly fill emitted
/// alongside capsules would land ON TOP of them. Breaking the segment puts everything
/// emitted after this call in a later segment — drawn after (above) everything before it.
fn overlayLayerBreak(ox: f32, oy: f32) void {
    core.popScissor();
    core.pushScissor(ox, oy, g_paint_vp_w, g_paint_vp_h);
}
/// Marquee box (any mode) — four thin capsules forming the rect outline (window px).
fn drawMarqueeOverlay() void {
    if (!g_mq_active) return;
    const x0 = g_mq[0];
    const y0 = g_mq[1];
    const x1 = g_mq[2];
    const y1 = g_mq[3];
    overlayLine(x0, y0, x1, y0, OV_MARQUEE[0], OV_MARQUEE[1], OV_MARQUEE[2], 2.0);
    overlayLine(x1, y0, x1, y1, OV_MARQUEE[0], OV_MARQUEE[1], OV_MARQUEE[2], 2.0);
    overlayLine(x1, y1, x0, y1, OV_MARQUEE[0], OV_MARQUEE[1], OV_MARQUEE[2], 2.0);
    overlayLine(x0, y1, x0, y0, OV_MARQUEE[0], OV_MARQUEE[1], OV_MARQUEE[2], 2.0);
}
/// One grid line on the stage floor: a world segment as a single dim capsule (a straight
/// world line projects to a straight screen line, so two endpoints are exact).
fn stageLine(cam: model_paint.Camera, a: [3]f32, b: [3]f32, col: [4]f32, w: f32, ox: f32, oy: f32) void {
    const pa = ovProject(cam, a, ox, oy) orelse return;
    const pb = ovProject(cam, b, ox, oy) orelse return;
    capsules.drawCapsule(pa[0], pa[1], pb[0], pb[1], col[0], col[1], col[2], col[3], w);
}
/// The 3×3 tile-panel fills on the ground plane — each panel is ONE game tile (1 m); the
/// center panel (the fine cell) is slightly brighter. Emitted as polys → must sit in its
/// own segment BELOW the stage lines.
fn drawStagePanels(cam: model_paint.Camera, ox: f32, oy: f32) void {
    const half = STAGE_TILE_M * @as(f32, @floatFromInt(STAGE_TILES)) * 0.5;
    var iz: u32 = 0;
    while (iz < STAGE_TILES) : (iz += 1) {
        var ix: u32 = 0;
        while (ix < STAGE_TILES) : (ix += 1) {
            const x0 = -half + @as(f32, @floatFromInt(ix)) * STAGE_TILE_M;
            const z0 = -half + @as(f32, @floatFromInt(iz)) * STAGE_TILE_M;
            const c00 = ovProject(cam, .{ x0, 0, z0 }, ox, oy) orelse continue;
            const c10 = ovProject(cam, .{ x0 + STAGE_TILE_M, 0, z0 }, ox, oy) orelse continue;
            const c11 = ovProject(cam, .{ x0 + STAGE_TILE_M, 0, z0 + STAGE_TILE_M }, ox, oy) orelse continue;
            const c01 = ovProject(cam, .{ x0, 0, z0 + STAGE_TILE_M }, ox, oy) orelse continue;
            const center = ix == STAGE_TILES / 2 and iz == STAGE_TILES / 2;
            const col = if (center) STAGE_PANEL_CENTER else STAGE_PANEL;
            polys.drawTri(c00[0], c00[1], c10[0], c10[1], c11[0], c11[1], col[0], col[1], col[2], col[3]);
            polys.drawTri(c00[0], c00[1], c11[0], c11[1], c01[0], c01[1], col[0], col[1], col[2], col[3]);
        }
    }
}
/// Tile-boundary lines, the center panel's 16×16 fine sub-grid (1 u pitch), and the world
/// axis lines from origin (X red, Y green, Z blue — the axisColor convention).
fn drawStageLines(cam: model_paint.Camera, ox: f32, oy: f32) void {
    const half = STAGE_TILE_M * @as(f32, @floatFromInt(STAGE_TILES)) * 0.5;
    var i: u32 = 0;
    while (i <= STAGE_TILES) : (i += 1) {
        const t = -half + @as(f32, @floatFromInt(i)) * STAGE_TILE_M;
        stageLine(cam, .{ t, 0, -half }, .{ t, 0, half }, STAGE_LINE, 1.4, ox, oy);
        stageLine(cam, .{ -half, 0, t }, .{ half, 0, t }, STAGE_LINE, 1.4, ox, oy);
    }
    const ch = STAGE_TILE_M * 0.5; // center panel spans [-ch, ch]
    const pitch = STAGE_TILE_M / @as(f32, @floatFromInt(STAGE_FINE_DIV));
    var k: u32 = 1;
    while (k < STAGE_FINE_DIV) : (k += 1) { // interior lines; the borders ARE tile lines
        const t = -ch + @as(f32, @floatFromInt(k)) * pitch;
        stageLine(cam, .{ t, 0, -ch }, .{ t, 0, ch }, STAGE_FINE_LINE, 1.0, ox, oy);
        stageLine(cam, .{ -ch, 0, t }, .{ ch, 0, t }, STAGE_FINE_LINE, 1.0, ox, oy);
    }
    var a: i32 = 0;
    while (a < 3) : (a += 1) {
        const c = axisColor(a);
        stageLine(cam, .{ 0, 0, 0 }, vmul(axisVec(a), STAGE_AXIS_M), .{ c[0], c[1], c[2], STAGE_AXIS_ALPHA }, 1.8, ox, oy);
    }
}

fn stageScaleCameraRight(cam: model_paint.Camera) [3]f32 {
    const forward = vnorm(vsub(cam.target, cam.eye));
    const right = vcross(forward, .{ 0, 1, 0 });
    return if (vdot(right, right) < 1e-8) .{ 1, 0, 0 } else vnorm(right);
}

fn stageScalePoint(origin: [3]f32, right: [3]f32, lateral_m: f32, height_m: f32) [3]f32 {
    return .{ origin[0] + right[0] * lateral_m, height_m, origin[2] + right[2] * lateral_m };
}

fn stageScaleRulerOrigin(cam: model_paint.Camera, right: [3]f32) [3]f32 {
    const side_m = std.math.clamp(
        g_orbit.radius * STAGE_SCALE_CUE.ruler_side_radius_fraction,
        STAGE_SCALE_CUE.ruler_side_min_m,
        STAGE_SCALE_CUE.ruler_side_max_m,
    );
    return stageScalePoint(.{ cam.target[0], 0, cam.target[2] }, right, -side_m, 0);
}

fn stageScaleMannequinOrigin(ruler: [3]f32, right: [3]f32) [3]f32 {
    return stageScalePoint(ruler, right, -STAGE_SCALE_CUE.mannequin_ruler_gap_m, 0);
}

fn stageScaleMarkColor(tone: stage_scale.MarkTone) [4]f32 {
    return switch (tone) {
        .meter => STAGE_SCALE_CUE.meter,
        .collider => STAGE_SCALE_CUE.collider,
        .visual_head => STAGE_SCALE_CUE.visual_head,
    };
}

fn stageScaleTickEnd(ruler: [3]f32, right: [3]f32, height_m: f32, length_m: f32) [3]f32 {
    return stageScalePoint(ruler, right, length_m, height_m);
}

fn stageScalePointInViewport(p: [2]f32) bool {
    const margin = STAGE_SCALE_CUE.mannequin_viewport_margin_px;
    return p[0] >= g_paint_vp_x + margin and p[0] <= g_paint_vp_x + g_paint_vp_w - margin and
        p[1] >= g_paint_vp_y + margin and p[1] <= g_paint_vp_y + g_paint_vp_h - margin;
}

/// A lightweight standing player reference. It is deliberately an overlay—not a scene
/// mesh—so it can never be selected, baked, painted, or confused with the authored model.
fn drawStageScaleMannequin(cam: model_paint.Camera, origin: [3]f32, right: [3]f32, ox: f32, oy: f32) void {
    const col = STAGE_SCALE_CUE.mannequin;
    const feet = ovProject(cam, origin, ox, oy) orelse return;
    const visual_head_top = ovProject(cam, stageScalePoint(origin, right, 0, stage_scale.Tuning.player_visual_head_top_meters), ox, oy) orelse return;
    // A player taller than the current zoom should not leave a broken half-figure
    // on the edge of the stage. The ruler still shows every in-frame meter mark;
    // zoom out a notch and the full physical reference appears.
    if (!stageScalePointInViewport(feet) or !stageScalePointInViewport(visual_head_top)) return;
    const shoulder = stageScalePoint(origin, right, 0, STAGE_SCALE_CUE.mannequin_shoulder_height_m);
    const hip = stageScalePoint(origin, right, 0, STAGE_SCALE_CUE.mannequin_hip_height_m);
    const head_center = stageScalePoint(origin, right, 0, stage_scale.Tuning.player_visual_head_top_meters - STAGE_SCALE_CUE.mannequin_head_radius_m);
    const head_base = stageScalePoint(origin, right, 0, stage_scale.Tuning.player_visual_head_top_meters - STAGE_SCALE_CUE.mannequin_head_radius_m * 2);
    const left_shoulder = stageScalePoint(origin, right, -STAGE_SCALE_CUE.mannequin_shoulder_half_width_m, shoulder[1]);
    const right_shoulder = stageScalePoint(origin, right, STAGE_SCALE_CUE.mannequin_shoulder_half_width_m, shoulder[1]);
    const left_hand = stageScalePoint(origin, right, -STAGE_SCALE_CUE.mannequin_hand_half_width_m, STAGE_SCALE_CUE.mannequin_hand_height_m);
    const right_hand = stageScalePoint(origin, right, STAGE_SCALE_CUE.mannequin_hand_half_width_m, STAGE_SCALE_CUE.mannequin_hand_height_m);
    const left_foot = stageScalePoint(origin, right, -STAGE_SCALE_CUE.mannequin_foot_half_width_m, 0);
    const right_foot = stageScalePoint(origin, right, STAGE_SCALE_CUE.mannequin_foot_half_width_m, 0);

    stageLine(cam, hip, shoulder, col, STAGE_SCALE_CUE.mannequin_line_width_px, ox, oy);
    stageLine(cam, shoulder, head_base, col, STAGE_SCALE_CUE.mannequin_line_width_px, ox, oy);
    stageLine(cam, left_shoulder, right_shoulder, col, STAGE_SCALE_CUE.mannequin_line_width_px, ox, oy);
    stageLine(cam, left_shoulder, left_hand, col, STAGE_SCALE_CUE.mannequin_line_width_px, ox, oy);
    stageLine(cam, right_shoulder, right_hand, col, STAGE_SCALE_CUE.mannequin_line_width_px, ox, oy);
    stageLine(cam, hip, left_foot, col, STAGE_SCALE_CUE.mannequin_line_width_px, ox, oy);
    stageLine(cam, hip, right_foot, col, STAGE_SCALE_CUE.mannequin_line_width_px, ox, oy);

    const head = ovProject(cam, head_center, ox, oy) orelse return;
    const units_per_px = @max(@as(f32, 0.0001), worldUnitsPerPixel(cam, head_center));
    const raw_head_diameter_px = STAGE_SCALE_CUE.mannequin_head_radius_m * 2 / units_per_px;
    const head_diameter_px = @max(
        STAGE_SCALE_CUE.mannequin_head_min_diameter_px,
        @min(STAGE_SCALE_CUE.mannequin_head_max_diameter_px, raw_head_diameter_px),
    );
    capsules.drawCapsule(head[0], head[1], head[0], head[1], OV_HALO[0], OV_HALO[1], OV_HALO[2], OV_HALO[3], head_diameter_px + 3.5);
    capsules.drawCapsule(head[0], head[1], head[0], head[1], col[0], col[1], col[2], col[3], head_diameter_px);
}

/// Height cues beside the existing 1m floor grid: a 0–3m ruler, distinct collider and
/// visual-head guides, and a passive mannequin whose feet sit on the same y=0 plane.
fn drawStageScaleCue(cam: model_paint.Camera, ox: f32, oy: f32) void {
    const right = stageScaleCameraRight(cam);
    const ruler = stageScaleRulerOrigin(cam, right);
    const mannequin = stageScaleMannequinOrigin(ruler, right);
    const ruler_top = [3]f32{ ruler[0], stage_scale.Tuning.ruler_height_meters, ruler[2] };
    stageLine(cam, ruler, ruler_top, STAGE_SCALE_CUE.ruler, STAGE_SCALE_CUE.ruler_width_px, ox, oy);

    var tick_index: u32 = 0;
    while (tick_index <= stage_scale.minorTickCount()) : (tick_index += 1) {
        const height_m = stage_scale.tickMeters(tick_index);
        const major = stage_scale.isMajorTick(tick_index);
        const tick_length_m = if (major) STAGE_SCALE_CUE.ruler_major_tick_length_m else STAGE_SCALE_CUE.ruler_minor_tick_length_m;
        const tick_col = if (major) STAGE_SCALE_CUE.meter else STAGE_SCALE_CUE.ruler;
        stageLine(cam, .{ ruler[0], height_m, ruler[2] }, stageScaleTickEnd(ruler, right, height_m, tick_length_m), tick_col, STAGE_SCALE_CUE.tick_width_px, ox, oy);
    }

    for (stage_scale.reference_marks) |mark| {
        const col = stageScaleMarkColor(mark.tone);
        const tick_end = stageScaleTickEnd(ruler, right, mark.meters, STAGE_SCALE_CUE.ruler_reference_tick_length_m);
        const guide_start = stageScalePoint(mannequin, right, STAGE_SCALE_CUE.mannequin_shoulder_half_width_m, mark.meters);
        const guide_col = [4]f32{ col[0], col[1], col[2], STAGE_SCALE_CUE.guide_alpha };
        stageLine(cam, .{ ruler[0], mark.meters, ruler[2] }, tick_end, col, STAGE_SCALE_CUE.reference_width_px, ox, oy);
        stageLine(cam, guide_start, .{ ruler[0], mark.meters, ruler[2] }, guide_col, STAGE_SCALE_CUE.guide_width_px, ox, oy);
    }
    drawStageScaleMannequin(cam, mannequin, right, ox, oy);
}

fn drawStageScaleLabel(label: []const u8, x: f32, y: f32, col: [4]f32) void {
    core.drawTextLine(label, x + 1, y + 1, STAGE_SCALE_CUE.label_font_px, STAGE_SCALE_CUE.text_shadow[0], STAGE_SCALE_CUE.text_shadow[1], STAGE_SCALE_CUE.text_shadow[2], STAGE_SCALE_CUE.text_shadow[3]);
    core.drawTextLine(label, x, y, STAGE_SCALE_CUE.label_font_px, col[0], col[1], col[2], col[3]);
}

/// Text rides a later overlay segment than the ruler capsules, keeping labels readable on
/// either dark stage space or a bright model face.
fn drawStageScaleText(cam: model_paint.Camera, ox: f32, oy: f32) void {
    const right = stageScaleCameraRight(cam);
    const ruler = stageScaleRulerOrigin(cam, right);
    const title = ovProject(cam, .{ ruler[0], stage_scale.Tuning.ruler_height_meters, ruler[2] }, ox, oy);
    if (title) |p| drawStageScaleLabel("PLAYER SCALE", p[0] + STAGE_SCALE_CUE.label_pad_px, p[1] - STAGE_SCALE_CUE.label_top_rise_px, STAGE_SCALE_CUE.meter);
    for (stage_scale.reference_marks) |mark| {
        const tick_end = stageScaleTickEnd(ruler, right, mark.meters, STAGE_SCALE_CUE.ruler_reference_tick_length_m);
        const p = ovProject(cam, tick_end, ox, oy) orelse continue;
        const col = stageScaleMarkColor(mark.tone);
        drawStageScaleLabel(mark.label, p[0] + STAGE_SCALE_CUE.label_pad_px, p[1] - STAGE_SCALE_CUE.label_center_rise_px, col);
    }
}
/// Faces the current selection touches (any mode) — alloc'd, caller frees. Null when
/// nothing is selected (or allocation fails), so callers can skip the lookup entirely.
fn selectionFaceMaskAlloc(fc: u32) ?[]bool {
    if (fc == 0) return null;
    const mask = std.heap.c_allocator.alloc(bool, fc) catch return null;
    if (mesh_edit.buildDeleteMask(mask) == 0) {
        std.heap.c_allocator.free(mask);
        return null;
    }
    return mask;
}
/// Face-mode wash (req_2618 gap B): every FRONT-facing in-scope triangle gets a subtle
/// translucent overlay quad (selected faces a stronger orange). Pure overlay polys — the
/// paint atlas and vertex colors are never touched, so nothing can bake (req_2611/2613).
fn drawFaceTintOverlay(cam: model_paint.Camera, ox: f32, oy: f32) void {
    const pos = model_paint.positions() orelse return;
    const fc = model_paint.faceCount();
    if (fc == 0 or fc > OV_MAX_FACE_TINT) return;
    const mask = selectionFaceMaskAlloc(fc);
    defer if (mask) |m| std.heap.c_allocator.free(m);
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        if (!mesh_edit.faceInScopePub(f)) continue;
        const b = @as(usize, f) * 9;
        if (b + 8 >= pos.len) break;
        const p0: [3]f32 = .{ pos[b + 0], pos[b + 1], pos[b + 2] };
        const p1: [3]f32 = .{ pos[b + 3], pos[b + 4], pos[b + 5] };
        const p2: [3]f32 = .{ pos[b + 6], pos[b + 7], pos[b + 8] };
        const n = vcross(vsub(p1, p0), vsub(p2, p0));
        const cen = vmul(vadd(vadd(p0, p1), p2), 1.0 / 3.0);
        if (vdot(n, vsub(cam.eye, cen)) <= 0) continue; // back-facing
        const a = ovProject(cam, p0, ox, oy) orelse continue;
        const bb = ovProject(cam, p1, ox, oy) orelse continue;
        const cc = ovProject(cam, p2, ox, oy) orelse continue;
        const selected = if (mask) |m| m[f] else false;
        const col = if (selected) OV_FACE_TINT_SEL else OV_FACE_TINT;
        polys.drawTri(a[0], a[1], bb[0], bb[1], cc[0], cc[1], col[0], col[1], col[2], col[3]);
    }
}
const FaceDotAcc = struct { cen: [3]f32, nrm: [3]f32, w: f32, sel: bool };
/// Face-mode centroid dots — the old studio's signature look: one small dot per AUTHORED
/// face (a cube face reads as one dot, not two triangle dots), front-facing only.
fn drawFaceDotsOverlay(cam: model_paint.Camera, ox: f32, oy: f32) void {
    const pos = model_paint.positions() orelse return;
    const fc = model_paint.faceCount();
    if (fc == 0 or fc > OV_MAX_FACE_TINT) return;
    const mask = selectionFaceMaskAlloc(fc);
    defer if (mask) |m| std.heap.c_allocator.free(m);
    var groups = std.AutoHashMapUnmanaged(u32, FaceDotAcc){};
    defer groups.deinit(std.heap.c_allocator);
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        if (!mesh_edit.faceInScopePub(f)) continue;
        const b = @as(usize, f) * 9;
        if (b + 8 >= pos.len) break;
        const p0: [3]f32 = .{ pos[b + 0], pos[b + 1], pos[b + 2] };
        const p1: [3]f32 = .{ pos[b + 3], pos[b + 4], pos[b + 5] };
        const p2: [3]f32 = .{ pos[b + 6], pos[b + 7], pos[b + 8] };
        const n = vcross(vsub(p1, p0), vsub(p2, p0));
        const cen = vmul(vadd(vadd(p0, p1), p2), 1.0 / 3.0);
        const selected = if (mask) |m| m[f] else false;
        const grp = model_source.faceGroupOf(f);
        if (grp == model_source.NO_FACE_GROUP) {
            // Ungrouped soup: a dot per front-facing triangle.
            if (vdot(n, vsub(cam.eye, cen)) <= 0) continue;
            const sp = ovProject(cam, cen, ox, oy) orelse continue;
            if (selected) {
                overlayDot(sp[0], sp[1], OV_ORANGE[0], OV_ORANGE[1], OV_ORANGE[2], OV_FACE_DOT_SEL_PX);
            } else {
                overlayDot(sp[0], sp[1], OV_FACE_DOT[0], OV_FACE_DOT[1], OV_FACE_DOT[2], OV_FACE_DOT_PX);
            }
            continue;
        }
        // Authored face: accumulate an area-weighted centroid across the group's tris.
        const w = @sqrt(vdot(n, n)); // 2 × tri area
        const g = groups.getOrPut(std.heap.c_allocator, grp) catch continue;
        if (!g.found_existing) g.value_ptr.* = .{ .cen = .{ 0, 0, 0 }, .nrm = .{ 0, 0, 0 }, .w = 0, .sel = false };
        g.value_ptr.cen = vadd(g.value_ptr.cen, vmul(cen, w));
        g.value_ptr.nrm = vadd(g.value_ptr.nrm, n);
        g.value_ptr.w += w;
        g.value_ptr.sel = g.value_ptr.sel or selected;
    }
    var it = groups.iterator();
    while (it.next()) |entry| {
        const acc = entry.value_ptr.*;
        if (acc.w <= 1e-12) continue;
        const cen = vmul(acc.cen, 1.0 / acc.w);
        if (vdot(acc.nrm, vsub(cam.eye, cen)) <= 0) continue; // back-facing face
        const sp = ovProject(cam, cen, ox, oy) orelse continue;
        if (acc.sel) {
            overlayDot(sp[0], sp[1], OV_ORANGE[0], OV_ORANGE[1], OV_ORANGE[2], OV_FACE_DOT_SEL_PX);
        } else {
            overlayDot(sp[0], sp[1], OV_FACE_DOT[0], OV_FACE_DOT[1], OV_FACE_DOT[2], OV_FACE_DOT_PX);
        }
    }
}
/// The model's BOUNDARY edges as real lines (Blender/Blockbench style) — triangulation
/// diagonals stay hidden (req_2367). Vertex/edge modes draw them at full presence; face
/// mode gets a dimmer pass so authored faces read (and loop-cut previews show, req_2625).
/// While a loop-cut session is live, edges lying in a previewed cut plane accent bright.
fn drawEdgeOverlay(cam: model_paint.Camera, mode: u8, ox: f32, oy: f32) void {
    if (mesh_edit.boundaryEdgeCount() > OV_MAX_EDGE_LINES) return;
    var lc_dir: ?[3]f32 = null;
    var lc_eps: f32 = 1e-4;
    var lc_planes: []const f32 = &.{};
    if (g_lc) |*sp| {
        if (sp.last_plane_count > 0) {
            const d: usize = @min(sp.last_dir, 1);
            lc_dir = sp.dirs[d];
            lc_eps = @max(1e-4, (sp.hi[d] - sp.lo[d]) * 1e-3);
            lc_planes = sp.last_planes[0..sp.last_plane_count];
        }
    }
    const n = mesh_edit.edgeCount();
    var e: u32 = 0;
    while (e < n) : (e += 1) {
        if (!mesh_edit.edgeIsBoundaryPub(e)) continue;
        if (!mesh_edit.edgeInScopePub(e)) continue; // only the focused part's edges
        const ep = mesh_edit.edgeEndpointsPub(e);
        const wa = mesh_edit.vertPosPub(ep[0]);
        const wb = mesh_edit.vertPosPub(ep[1]);
        const a = ovProject(cam, wa, ox, oy) orelse continue;
        const b = ovProject(cam, wb, ox, oy) orelse continue;
        // In edge mode a selected boundary edge draws bold-orange over the dim base.
        if (mode == 2 and mesh_edit.edgeSelectedPub(e)) {
            overlayLine(a[0], a[1], b[0], b[1], OV_ORANGE[0], OV_ORANGE[1], OV_ORANGE[2], 4.0);
            continue;
        }
        if (lc_dir) |ld| {
            const ca = vdot(wa, ld);
            const cb = vdot(wb, ld);
            if (@abs(ca - cb) <= lc_eps) {
                var on_plane = false;
                for (lc_planes) |pl| {
                    if (@abs(ca - pl) <= lc_eps) {
                        on_plane = true;
                        break;
                    }
                }
                if (on_plane) {
                    overlayLine(a[0], a[1], b[0], b[1], OV_LC_ACCENT[0], OV_LC_ACCENT[1], OV_LC_ACCENT[2], 3.0);
                    continue;
                }
            }
        }
        const w: f32 = if (mode == 3) 1.2 else 1.6;
        overlayLine(a[0], a[1], b[0], b[1], OV_EDGE[0], OV_EDGE[1], OV_EDGE[2], w);
    }
}
const LcHandleGeom = struct { p: [3]f32, a: [3]f32, b: [3]f32, axis: i32, half_w: f32 };
/// The loop-cut handle's world geometry — the ONE source drawn, hit-tested, and dragged
/// (the gizmoRingWorldR rule: draw and hit can never disagree). Anchor = the selection's
/// centroid moved onto the MIDDLE cut plane; when the comb is empty (offset scrubbed to
/// 0/1 pushed every plane out) it falls back to the span midpoint so a drag in flight
/// keeps a stable direction/scale.
fn lcHandleGeom(cam: model_paint.Camera) ?LcHandleGeom {
    const sp: *const LcSession = if (g_lc) |*p| p else return null;
    const d: usize = @min(sp.last_dir, 1);
    const dirv = sp.dirs[d];
    const target: f32 = if (sp.last_plane_count > 0)
        sp.last_planes[sp.last_plane_count / 2]
    else
        (sp.lo[d] + sp.hi[d]) * 0.5;
    // Slide the centroid along the cut direction onto the middle plane (dot-space).
    const p = vadd(sp.sel_center, vmul(dirv, target - vdot(sp.sel_center, dirv)));
    const half_w = worldUnitsPerPixel(cam, p) * OV_LC_HANDLE_PX;
    return .{
        .p = p,
        .a = vadd(p, vmul(dirv, -half_w)),
        .b = vadd(p, vmul(dirv, half_w)),
        .axis = domAxis(dirv), // gizmo color only — the geometry runs along dirv
        .half_w = half_w,
    };
}
/// While a loop-cut popup session is live: a translate-style handle on the MIDDLE cut
/// plane, anchored at the selection's centroid — the drag surface for the offset
/// (meshLcHandleHit/meshLcHandleDrag, req_2625 gap DD).
fn drawLoopCutOverlay(cam: model_paint.Camera, ox: f32, oy: f32) void {
    const sp: *const LcSession = if (g_lc) |*p| p else return;
    if (sp.last_plane_count == 0) return;
    const g = lcHandleGeom(cam) orelse return;
    const pa = ovProject(cam, g.a, ox, oy) orelse return;
    const pb = ovProject(cam, g.b, ox, oy) orelse return;
    const c = axisColor(g.axis);
    overlayLine(pa[0], pa[1], pb[0], pb[1], c[0], c[1], c[2], 4.0);
    overlayDot(pa[0], pa[1], c[0], c[1], c[2], 6);
    overlayDot(pb[0], pb[1], c[0], c[1], c[2], 6);
    const pc = ovProject(cam, g.p, ox, oy) orelse return;
    overlayDot(pc[0], pc[1], OV_LC_ACCENT[0], OV_LC_ACCENT[1], OV_LC_ACCENT[2], 5);
}
/// Is (mx,my) — window px, like meshGizmoHit — on the drawn loop-cut handle? Same
/// geometry as drawLoopCutOverlay via lcHandleGeom, same GIZMO_HIT_PX threshold. O(1).
pub fn meshLcHandleHit(mx: f32, my: f32) bool {
    if (!g_me_capture or !model_paint.hasTarget()) return false;
    const sp: *const LcSession = if (g_lc) |*p| p else return false;
    if (sp.last_plane_count == 0) return false; // no comb drawn → nothing to grab
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const g = lcHandleGeom(cam) orelse return false;
    const pa = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, g.a) orelse return false;
    const pb = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, g.b) orelse return false;
    return segDist2(vpLocalX(mx), vpLocalY(my), pa[0], pa[1], pb[0], pb[1]) <= GIZMO_HIT_PX * GIZMO_HIT_PX;
}
/// Drag the grabbed loop-cut handle by a pixel delta: project the delta onto the
/// handle's SCREEN direction, map it through the drawn handle length to world units (the
/// meshGizmoDrag precision rule), convert to an offset-frac delta on the cut axis, clamp
/// 0..1, and re-preview at the session's own dir/cuts. Sign: lcPlanes' shift is
/// −(offset − size/2), i.e. dPlane/dOffset = −1, so offset moves OPPOSITE the world
/// delta — that is exactly what keeps the drawn comb following the cursor.
///
/// SNAP (req_2644 QQ): by default the offset lands on whole size-units — the mesh basis
/// (16 u to the tile, the studio gizmo's own law) — so a handle drag produces the same
/// clean authored offsets the popup steppers do. The cursor's RAW (continuous) offset
/// accumulates on the session so slow drags still cross the detent; `snap = false`
/// (Shift held in the engine's input loop) frees it to continuous.
pub fn meshLcHandleDrag(dx: f32, dy: f32, snap: bool) bool {
    const sp: *const LcSession = if (g_lc) |*p| p else return false;
    if (!model_paint.hasTarget()) return false;
    const d: usize = @min(sp.last_dir, 1);
    const span = sp.hi[d] - sp.lo[d];
    if (span < 1e-6) return false;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const g = lcHandleGeom(cam) orelse return false;
    const pa = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, g.a) orelse return false;
    const pb = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, g.b) orelse return false;
    const hdx = pb[0] - pa[0];
    const hdy = pb[1] - pa[1];
    const hlen = @sqrt(hdx * hdx + hdy * hdy);
    // Degenerate projection (axis into the screen): fall back to raw horizontal px at
    // the depth-based rate, mirroring meshGizmoDrag's fallback.
    var px = dx;
    var world_per_px = worldUnitsPerPixel(cam, g.p);
    if (hlen > 4) {
        px = (dx * hdx + dy * hdy) / hlen;
        world_per_px = (g.half_w * 2.0) / hlen;
    }
    const dir = sp.last_dir;
    const cuts = sp.last_cuts;
    const raw = std.math.clamp(sp.drag_raw_frac - (px * world_per_px) / span, 0.0, 1.0);
    var frac = raw;
    if (snap) {
        const step = LC_SNAP_WORLD / span; // one size-unit as an offset fraction
        if (step < 0.5) frac = std.math.clamp(@round(raw / step) * step, 0.0, 1.0);
    }
    const ok = meshLoopCutFacePreview(dir, cuts, frac);
    // The preview mirrored the SNAPPED frac into drag_raw_frac — restore the raw
    // accumulator so the next motion continues from the cursor, not the detent.
    if (g_lc) |*p2| p2.drag_raw_frac = raw;
    return ok;
}

// ── Orientation compass (req_2643 gap LL) ──────────────────────────────────────────
const CompassEnd = struct { x: f32, y: f32, depth: f32, axis: i32, positive: bool };
const CompassGeom = struct { cx: f32, cy: f32, ends: [6]CompassEnd };
/// Big enough pane to host the ball without crowding the corner chips.
fn compassVisible() bool {
    return g_paint_vp_w >= COMPASS_MIN_PANE_PX and g_paint_vp_h >= COMPASS_MIN_PANE_PX;
}
/// The ball's screen geometry from the CURRENT camera — rotation only: each world axis
/// is resolved against the view's right/up/forward basis (never the perspective
/// transform), so the ball reads pure orientation at a fixed corner size. depth > 0
/// means the end points AWAY from the viewer (into the screen).
fn compassGeom(cam: model_paint.Camera) CompassGeom {
    const cx = g_paint_vp_x + COMPASS_MARGIN_PX + COMPASS_R_PX;
    const cy = g_paint_vp_y + g_paint_vp_h - COMPASS_MARGIN_PX - COMPASS_R_PX;
    const fwd = vnorm(vsub(cam.target, cam.eye));
    var right = vcross(fwd, .{ 0, 1, 0 });
    right = if (vdot(right, right) < 1e-8) .{ 1, 0, 0 } else vnorm(right);
    const up = vcross(right, fwd);
    var g = CompassGeom{ .cx = cx, .cy = cy, .ends = undefined };
    var a: i32 = 0;
    while (a < 3) : (a += 1) {
        const e = axisVec(a);
        const sx = vdot(e, right) * COMPASS_ARM_PX;
        const sy = -vdot(e, up) * COMPASS_ARM_PX; // screen y grows downward
        const depth = vdot(e, fwd);
        g.ends[@intCast(a * 2)] = .{ .x = cx + sx, .y = cy + sy, .depth = depth, .axis = a, .positive = true };
        g.ends[@intCast(a * 2 + 1)] = .{ .x = cx - sx, .y = cy - sy, .depth = -depth, .axis = a, .positive = false };
    }
    return g;
}
/// The ball itself (capsule layer): backdrop disc + rim, then the six ends painter's-
/// ordered back-to-front so near dots cover far arms at the centre. Positive ends get
/// an arm line + solid dot (labels ride a LATER glyph segment — text flushes before
/// capsules inside one segment); negative ends a dimmer hollow ring.
fn drawCompassBall(cam: model_paint.Camera) void {
    const g = compassGeom(cam);
    capsules.drawCapsule(g.cx, g.cy, g.cx, g.cy, COMPASS_RIM[0], COMPASS_RIM[1], COMPASS_RIM[2], COMPASS_RIM[3], COMPASS_R_PX * 2 + 3);
    capsules.drawCapsule(g.cx, g.cy, g.cx, g.cy, COMPASS_BACK[0], COMPASS_BACK[1], COMPASS_BACK[2], COMPASS_BACK[3], COMPASS_R_PX * 2);
    var order: [6]usize = .{ 0, 1, 2, 3, 4, 5 };
    var i: usize = 0;
    while (i < 6) : (i += 1) { // 6 items: selection sort is the whole story
        var j: usize = i + 1;
        while (j < 6) : (j += 1) {
            if (g.ends[order[j]].depth > g.ends[order[i]].depth) {
                const t = order[i];
                order[i] = order[j];
                order[j] = t;
            }
        }
    }
    for (order) |k| {
        const e = g.ends[k];
        const c = axisColor(e.axis);
        const fade: f32 = if (e.depth > 0) COMPASS_AWAY_FADE else 1.0;
        if (e.positive) {
            capsules.drawCapsule(g.cx, g.cy, e.x, e.y, c[0] * fade, c[1] * fade, c[2] * fade, 1.0, 2.6);
            capsules.drawCapsule(e.x, e.y, e.x, e.y, c[0] * fade, c[1] * fade, c[2] * fade, 1.0, COMPASS_DOT_PX);
        } else {
            const dim = 0.55 * fade;
            capsules.drawCapsule(e.x, e.y, e.x, e.y, c[0] * dim, c[1] * dim, c[2] * dim, 0.95, COMPASS_DOT_NEG_PX);
            capsules.drawCapsule(e.x, e.y, e.x, e.y, COMPASS_BACK[0], COMPASS_BACK[1], COMPASS_BACK[2], 1.0, COMPASS_DOT_NEG_PX - COMPASS_RING_GAP_PX);
        }
    }
}
/// Axis labels on the positive dots + the live angle readout beside the ball. yaw/pitch
/// are derived from the SAME camera the frame drew (the exact orbitCamPos() angles:
/// yaw around +Y, pitch above the XZ plane), so the numbers stay honest even if a
/// future pane drives this camera without the orbit doors.
fn drawCompassText(cam: model_paint.Camera) void {
    const g = compassGeom(cam);
    const labels = [3][]const u8{ "X", "Y", "Z" };
    for (g.ends) |e| {
        if (!e.positive) continue;
        core.drawTextLine(labels[@intCast(e.axis)], e.x - 3, e.y - 6, 10, 0.04, 0.05, 0.09, 0.95);
    }
    const dir = vsub(cam.eye, cam.target);
    const len = @sqrt(vdot(dir, dir));
    if (len < 1e-6) return;
    const yaw_deg = std.math.atan2(dir[0], dir[2]) * 180.0 / std.math.pi;
    const pitch_deg = std.math.asin(std.math.clamp(dir[1] / len, -1.0, 1.0)) * 180.0 / std.math.pi;
    var buf: [64]u8 = undefined;
    const line = std.fmt.bufPrint(&buf, "yaw {d:.0}\u{00B0}  pitch {d:.0}\u{00B0}  fov {d:.0}\u{00B0}", .{ yaw_deg, pitch_deg, cam.fov_deg }) catch return;
    const tx = g.cx + COMPASS_R_PX + 10;
    const ty = g.cy - 8;
    core.drawTextLine(line, tx + 1, ty + 1, 12, 0.02, 0.03, 0.07, 0.85); // shadow
    core.drawTextLine(line, tx, ty, 12, COMPASS_TEXT[0], COMPASS_TEXT[1], COMPASS_TEXT[2], 1.0);
}
/// What does a press at (mx,my) (window px) hit on the compass? 0..5 = axis*2 (+1 for
/// the negative end); 6 = the ball body (furniture — consume the press, no snap);
/// -1 = not on the compass at all. Where dots overlap the closer dot wins, front
/// (toward-viewer) end breaking ties.
pub fn meshCompassHit(mx: f32, my: f32) i32 {
    if (!g_me_capture or !model_paint.hasTarget()) return -1;
    if (g_paint_vp_w <= 1 or g_paint_vp_h <= 1 or !compassVisible()) return -1;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const g = compassGeom(cam);
    const dxc = mx - g.cx;
    const dyc = my - g.cy;
    if (dxc * dxc + dyc * dyc > COMPASS_R_PX * COMPASS_R_PX) return -1;
    var best: i32 = 6;
    var best_key: f32 = std.math.floatMax(f32);
    for (g.ends, 0..) |e, k| {
        const dx = mx - e.x;
        const dy = my - e.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > COMPASS_HIT_PX * COMPASS_HIT_PX) continue;
        const key = d2 + e.depth; // depth ∈ [-1,1] px² — a pure tie-break
        if (key < best_key) {
            best_key = key;
            best = @intCast(k);
        }
    }
    return best;
}
/// Snap the orbit to the axis-aligned view for a compass hit code (axis*2 + neg):
/// clicking a dot moves the EYE onto that world axis (front/right/top…), keeping the
/// target and distance. Y uses the orbit's own pitch clamp — the pole is degenerate
/// for a Y-up camera — so "top" is the same near-vertical view dragging reaches.
pub fn meshCompassSnap(code: i32) bool {
    if (g_orbit.locked) return false;
    if (code < 0 or code > 5) return false;
    const neg = @rem(code, 2) == 1;
    const half_pi: f32 = std.math.pi / 2.0;
    switch (@divTrunc(code, 2)) {
        0 => { // ±X
            g_orbit.yaw = if (neg) -half_pi else half_pi;
            g_orbit.pitch = 0;
        },
        1 => g_orbit.pitch = if (neg) -ORBIT_PITCH_LIM else ORBIT_PITCH_LIM, // ±Y (top/bottom)
        else => { // ±Z
            g_orbit.yaw = if (neg) std.math.pi else 0;
            g_orbit.pitch = 0;
        },
    }
    return true;
}

/// Draw the editor overlay — the modeling stage (tile panels + grid + axes), mode
/// dressing (face wash/centroid dots, edge lines, vertex dots), loop-cut accents, the
/// gizmo, and the marquee — as screen-space capsules/polys projected with the EXACT
/// last-drawn camera, so every mark sits on the pixel its raycast shoots back through.
/// Capsules/polys ride the 2D draw-command z-order, so emitting right after the Scene3D
/// composite lands them on top; scissor-segment breaks order the fill layers under the
/// line layers. (ox,oy) is the viewport origin (0,0 full-window). Lives here, not in
/// mesh_edit, to keep that GPU-free.
pub fn drawEditorOverlay(ox: f32, oy: f32) void {
    if (!g_me_capture) return;
    if (!model_paint.hasTarget() or g_paint_vp_w <= 1 or g_paint_vp_h <= 1) {
        drawMarqueeOverlay();
        return;
    }
    // Only the pane that HOLDS the edit target gets the furniture: the engine calls this
    // for every large Scene3D pane, and projecting the target camera through another
    // pane's origin would smear the stage/dots across it.
    if (@abs(ox - g_paint_vp_x) > 0.5 or @abs(oy - g_paint_vp_y) > 0.5) return;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    // Paint session (req_2662): the whole mode dressing goes quiet — the stage,
    // compass and marquee are view furniture and stay; wash/dots/edges/gizmo are
    // EDIT affordances and must never render over a paint surface.
    const mode: u8 = if (g_paint_session) 0 else meshEditModeRaw();
    // Clip everything to the pane, and use segment breaks to layer polys under capsules.
    core.pushScissor(ox, oy, g_paint_vp_w, g_paint_vp_h);
    // Layer 1 (polys): the tile-panel fills. Always drawn in the model doc view — the
    // stage is the scale reference, selection or not (req_2618 A / req_2623).
    drawStagePanels(cam, ox, oy);
    overlayLayerBreak(ox, oy);
    // Layer 2 (capsules): tile grid + fine center sub-grid + world axes.
    drawStageLines(cam, ox, oy);
    overlayLayerBreak(ox, oy);
    // Layer 3 (polys): face-mode translucent wash.
    if (mode == 3) drawFaceTintOverlay(cam, ox, oy);
    overlayLayerBreak(ox, oy);
    // Layer 4 (capsules): edges, dots, loop-cut accents, gizmo, marquee.
    if ((mode == 1 or mode == 2 or mode == 3) and mesh_edit.ensureTopologyPub()) {
        drawEdgeOverlay(cam, mode, ox, oy);
    }
    if (mode == 3) drawFaceDotsOverlay(cam, ox, oy);
    if (mode == 1) { // vertex: every vert as a haloed dot, selected ones orange + bigger
        const n = mesh_edit.vertCount();
        const draw_all = n <= OV_MAX_VERT_DOTS;
        // Depth axis for the dot colours: the camera forward SNAPPED to its dominant
        // WORLD axis, anchored at the world origin. Raw view depth spread a genuinely
        // flat plane into two hues whenever the view sat a few degrees off axis — and
        // the compass TOP view deliberately stops at the pitch clamp (~86°, the Y-up
        // pole is degenerate), so even dial-snapped views hit it (req_3066). Snapped,
        // "same depth" means "same world coordinate": exact from any near-axis view,
        // and the palette never swims with the camera at all.
        const fwd = vnorm(vsub(cam.target, cam.eye));
        const dax: usize = if (@abs(fwd[0]) >= @abs(fwd[1]) and @abs(fwd[0]) >= @abs(fwd[2])) 0 else if (@abs(fwd[1]) >= @abs(fwd[2])) 1 else 2;
        const dsign: f32 = if (fwd[dax] < 0) -1 else 1; // keep near/far sense with the view
        var i: u32 = 0;
        while (i < n) : (i += 1) {
            if (!mesh_edit.vertInScopePub(i)) continue; // only the focused part's verts
            const selected = mesh_edit.vertSelectedPub(i);
            if (!selected and !draw_all) continue;
            const p = mesh_edit.vertPosPub(i);
            const sp = ovProject(cam, p, ox, oy) orelse continue;
            if (selected) {
                overlayDot(sp[0], sp[1], OV_ORANGE[0], OV_ORANGE[1], OV_ORANGE[2], 13);
            } else {
                const c = ovDepthColor(p[dax] * dsign);
                overlayDot(sp[0], sp[1], c[0], c[1], c[2], 8);
            }
        }
    }
    drawLoopCutOverlay(cam, ox, oy);
    if (mode != 0) drawMirrorPlanesOverlay(cam, ox, oy); // req_2758: edit dressing, quiet in paint/view
    drawGizmoOverlay(cam, ox, oy);
    // Backdrop move session (req_3080): the reference image's own move gizmo — drawn in
    // ANY mode (tracing setup isn't an edit mode), quiet only while paint owns the surface.
    drawBdGizmoOverlay(cam, ox, oy);
    // Scale ladder + mannequin (req_2869): passive stage furniture, always present even
    // in paint/view mode so the author can judge an asset before it ever reaches play.
    drawStageScaleCue(cam, ox, oy);
    drawMarqueeOverlay();
    // Text needs a later segment than the ruler capsules; otherwise the batch's glyph
    // flush lands under them and the numerical height marks become unreadable.
    overlayLayerBreak(ox, oy);
    drawStageScaleText(cam, ox, oy);
    // Layer 5: the orientation compass — always-on view furniture like the stage
    // (req_2643 gap LL). Ball/arms/dots ride this capsule segment (on top of the mesh
    // dressing); the break puts labels + the angle readout in a LATER segment so the
    // glyphs land ON the dots (within one segment text flushes before capsules).
    if (compassVisible()) {
        overlayLayerBreak(ox, oy);
        drawCompassBall(cam);
        overlayLayerBreak(ox, oy);
        drawCompassText(cam);
    }
    core.popScissor();
}
/// Marquee (rubber-band) select every element inside the screen rect (Alt+drag).
pub fn meshEditBox(x0: f32, y0: f32, x1: f32, y1: f32, additive: bool) i32 {
    if (g_paint_session) return -1; // req_2662: paint owns the drag — no marquee selects
    if (!model_paint.hasTarget()) return -1;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    return mesh_edit.boxSelect(cam, g_paint_vp_w, g_paint_vp_h, vpLocalX(x0), vpLocalY(y0), vpLocalX(x1), vpLocalY(y1), additive);
}
/// Snapshot the selection before an instant mousedown pick; revert if the press drags.
pub fn meshEditSnapshot() void {
    mesh_edit.snapshotSelection();
}
pub fn meshEditRevert() void {
    mesh_edit.revertSelection();
}
/// Select a face by index (no raycast) — programmatic / headless. Returns true on success.
pub fn meshEditSelectFace(idx: u32, additive: bool) bool {
    if (g_paint_session) return false; // req_2662: selection doors are inert in paint mode
    return mesh_edit.selectFaceByIndex(idx, additive);
}
/// Select every face in the authored group range [lo, hi) — the outliner grabs a whole part.
pub fn meshEditSelectGroupRange(lo: u32, hi: u32, additive: bool) i32 {
    if (g_paint_session) return -1; // req_2662: an outliner click mid-paint must not force face mode
    return mesh_edit.selectFacesByGroupRange(lo, hi, additive);
}
/// Restrict editing (select + overlay) to the authored group range [lo, hi) — the outliner
/// focusing ONE part. hi <= lo edits the whole model.
pub fn meshEditSetScope(lo: u32, hi: u32) void {
    mesh_edit.setEditScope(lo, hi);
}
/// Restrict editing to the UNION of group ranges (flattened [lo,hi) pairs) — the outliner's
/// multi-select (req_2659): shift-click accumulates parts and the gizmo/pick/marquee operate
/// on all of them. Empty clears the scope (whole model).
pub fn meshEditSetScopeRanges(pairs: []const u32) void {
    mesh_edit.setEditScopeRanges(pairs);
}
/// Adopt authored-face ids as topology, invalidating any boundary classification
/// built before the groups arrived. The binding must not write model_source directly:
/// same-triangle-count group changes are invisible to mesh_edit's normal cache key.
pub fn meshEditSetFaceGroups(groups: []const u32) void {
    clearIndexedEditMesh();
    model_source.setFaceGroups(groups);
    mesh_edit.faceGroupsChanged();
}
/// Adopt the outliner's part ranges (flattened [lo,hi) group-id pairs) and rebuild the
/// welded topology, so coincident verts in DIFFERENT parts stay separate logical verts.
/// This is also where a PERSISTED doc's ranges arrive on load/resume — a doc saved
/// while the req_3029 minting bug was live heals here instead of reopening corrupt.
pub fn meshEditSetPartRanges(pairs: []const u32) void {
    clearIndexedEditMesh();
    // Tripwire (req_3049): a session lost its host part ranges and the next save
    // persisted a doc that reopens with every part merged. An empty push over a mesh
    // that HAS ranges is the one legal way to clear them — name it when it happens.
    if (pairs.len < 2 and model_source.partRanges() != null) {
        log.print("[mesh] part ranges CLEARED by an empty cart push over a mesh that had {d} parts — if unintended this is the req_3049 merged-outliner save corruption\n", .{model_source.partRanges().?.len / 2});
    }
    model_source.setPartRanges(pairs);
    _ = ensureDisjointPartRanges("cart range push");
    mesh_edit.reset();
}
/// Count the surviving faces whose authored group is in [lo, hi) — the outliner asks this
/// after a delete to drop parts that have no geometry left.
pub fn meshGroupFaceCount(lo: u32, hi: u32) u32 {
    const fc = model_paint.faceCount();
    var n: u32 = 0;
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        const grp = model_source.faceGroupOf(f);
        if (grp != model_source.NO_FACE_GROUP and grp >= lo and grp < hi) n += 1;
    }
    return n;
}
/// Paint every face in the authored group range [lo, hi) a solid colour — the outliner tints
/// each PART its own colour on load so a bare studio mesh reads as coloured parts, matching
/// the outliner swatches. Returns the number of faces painted.
pub fn meshPaintGroupRange(lo: u32, hi: u32, r: u8, g: u8, b: u8) u32 {
    if (g_paint_layout_stale) return 0;
    const fc = model_paint.faceCount();
    // Painting a selection-tinted face must land UNDER the tint (the outliner can recolor
    // a part while its faces are selected): lift the tint, paint, re-apply — the re-saved
    // base patch then holds the new paint, so a later deselect keeps it.
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    var painted: u32 = 0;
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        const grp = model_source.faceGroupOf(f);
        if (grp == model_source.NO_FACE_GROUP or grp < lo or grp >= hi) continue;
        model_paint.paintFaceRgb(f, .{ r, g, b });
        model_source.writeColor(@intCast(f), r, g, b);
        painted += 1;
    }
    return painted;
}
/// Select an edge by welded-edge index (no raycast) — programmatic / headless.
pub fn meshEditSelectEdge(idx: u32, additive: bool) bool {
    return mesh_edit.selectEdgeByIndex(idx, additive);
}
pub fn meshEditReset() void {
    mesh_edit.reset();
}
/// Authored topology + selection counts for the HUD: {mode, verts, editable edges,
/// selected-in-mode}. `edgeCount` is the render soup's triangle-edge count; exposing it
/// made a 12-sided cylinder claim 66 edges even though only 36 can be drawn/selected.
pub fn meshEditCounts() [4]u32 {
    if (mesh_edit.mode() != .none) _ = mesh_edit.ensureTopologyPub();
    return .{ @intFromEnum(mesh_edit.mode()), mesh_edit.vertCount(), mesh_edit.boundaryEdgeCount(), mesh_edit.selCount() };
}

/// Paint the face under viewport pixel (mx,my) the given colour, using the last-drawn
/// camera. Returns the DISPLAYED face index painted, or -1 on a miss. The caller maps
/// that face back to the source paint (so it survives quality changes) and marks dirty.
pub fn paintAt(mx: f32, my: f32, r: u8, g: u8, b: u8) i32 {
    if (!model_paint.hasTarget() or g_paint_layout_stale) return -1;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const face = mesh_edit.scopedFaceHit(model_paint.pick(cam, g_paint_vp_w, g_paint_vp_h, vpLocalX(mx), vpLocalY(my)));
    if (face < 0) return -1;
    // The fill unit is the LOGICAL face — the whole authored group (a quad's two
    // triangles, a cap fan), not the one picked triangle (req_2506). With a material
    // ink dipped each member samples the shared group plane (seamless across the
    // diagonal); else the flat colour. The per-face source store mirrors flat fills
    // (a material fill has no single face colour — it lives on the atlas only).
    const mat = model_paint.hasMaterialInk();
    var gbuf: [model_paint.MAX_GROUP_FACES]u32 = undefined;
    const members = model_paint.groupFaces(@intCast(face), &gbuf);
    paint_program.beginRecordedOp(); // anchor the undo baseline BEFORE the fill lands (req_2672)
    mesh_edit.suspendFaceTint(); // paint lands under any selection tint, never mixed with it
    defer mesh_edit.resumeFaceTint();
    for (members) |f| {
        if (mat) {
            model_paint.paintFaceTex(f);
        } else {
            model_paint.paintFaceRgb(f, .{ r, g, b });
            model_source.writeColor(@intCast(f), r, g, b);
        }
        paint_program.recordFill(f, mat, .{ r, g, b }); // the stroke program is the durable form, not the atlas
    }
    return face;
}

// ── Paint-with-a-shader: the brush's material ink ───────────────────────────────────
// The door renders a shader recipe to pixels (material_tex.bakePixels) and hands them
// here; while set, every dab/fill SAMPLES the material instead of a flat colour.
pub fn setPaintMaterial(rgba: []const u8, w: u32, h: u32, scale: f32) bool {
    return model_paint.setMaterialInk(rgba, w, h, scale);
}
pub fn clearPaintMaterial() void {
    model_paint.clearMaterialInk();
}
pub fn hasPaintMaterial() bool {
    return model_paint.hasMaterialInk();
}

// ── Paint program (the durable form) ────────────────────────────────────────────────
/// Serialize the recorded stroke program (the durable painting — strokes, not pixels), or
/// null if nothing's been painted. Caller frees the returned blob.
pub fn paintProgramRead() ?[]u8 {
    return paint_program.serialize();
}
/// Exact raster underneath the current program. Persisted independently so a
/// user-edited PNG remains the base rather than being mistaken for UI imagery.
pub fn paintProgramBaseline() ?[]const u8 {
    return paint_program.baseline();
}
/// Replay a serialized stroke program onto the resident model, rebuilding the atlas from
/// the recipe. Sets the program's detail first (re-tessellate + re-upload the mesh — which
/// the paint module can't do) so face+bary dabs land at the resolution they were made.
/// False if there's no resident mesh or the blob is malformed.
pub fn paintProgramApply(io: std.Io, environ: *const std.process.Environ.Map, blob: []const u8) bool {
    // A program stores face/barycentric addresses from one UV/topology revision.
    // It may restore a cold, unchanged model, but it must never silently bless a
    // structurally changed one. setPaintBase is the sole explicit unlock.
    if (g_paint_layout_stale or g_edit_verts == null or g_edit_count == 0) return false;
    // The replay overwrites atlas texels wholesale — lift any selection tint first so
    // the replayed paint is TRUE paint, then re-tint over it (depth-counted, so the
    // nested setPaintDetail's own guard folds into this one).
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    if (paint_program.programDetail(blob)) |d| {
        if (@as(u32, d) != model_paint.detail()) _ = setPaintDetail(@intCast(d));
    }
    return paint_program.apply(io, environ, blob);
}

/// Replay a program over a raster baseline that the package loader has already
/// installed. Detail must match because rebuilding it here would erase that raster.
pub fn paintProgramApplyOverBase(io: std.Io, environ: *const std.process.Environ.Map, blob: []const u8) bool {
    if (g_paint_layout_stale or g_edit_verts == null or g_edit_count == 0) return false;
    const stored_detail = paint_program.programDetail(blob) orelse return false;
    if (@as(u32, stored_detail) != model_paint.detail()) return false;
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    return paint_program.applyOverCurrentBaseline(io, environ, blob);
}

// ── Stroke journal + paint layers (req_2672) ────────────────────────────────────────
// Thin wrappers over paint_program: every path that RE-RUNS the program onto the atlas
// lifts the selection tint first (the replay writes texels wholesale — it must lay TRUE
// paint, never mix with the orange; same law as paintProgramApply).

/// Commit the open stroke unit (pointer-up). Returns true when a stroke was recorded.
pub fn paintStrokeEnd(io: std.Io, environ: *const std.process.Environ.Map) bool {
    if (g_paint_layout_stale) return false;
    const committed = paint_program.endStrokeUnit();
    if (!committed) return false;
    if (paint_program.activeLayerNeedsCompositeReplay()) {
        mesh_edit.suspendFaceTint();
        defer mesh_edit.resumeFaceTint();
        paint_program.replayAll(io, environ);
    }
    return true;
}

/// Undo/redo ONE stroke-journal unit (a stroke or a structural layer op) by program
/// replay. False when the journal side is empty.
pub fn paintStrokeUndo(io: std.Io, environ: *const std.process.Environ.Map) bool {
    if (g_paint_layout_stale) return false;
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    return paint_program.undoStroke(io, environ);
}
pub fn paintStrokeRedo(io: std.Io, environ: *const std.process.Environ.Map) bool {
    if (g_paint_layout_stale) return false;
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    return paint_program.redoStroke(io, environ);
}
pub fn paintHistoryCounts() [2]u32 {
    return paint_program.historyCounts();
}
pub fn paintUndoLabel() []const u8 {
    return paint_program.undoLabel();
}
pub fn paintRedoLabel() []const u8 {
    return paint_program.redoLabel();
}

/// Layer ops — each mutates the stroke program and (when the composite changes)
/// re-runs it. See paint_program for the per-op journal semantics.
pub const PaintLayerInfo = paint_program.LayerInfo;
pub fn paintLayerCount() usize {
    return paint_program.layerCount();
}
pub fn paintLayerAt(i: usize) PaintLayerInfo {
    return paint_program.layerInfoAt(i);
}
pub fn paintActiveLayer() u32 {
    return paint_program.activeLayerId();
}
pub fn paintLayerAdd() u32 {
    if (g_paint_layout_stale) return 0;
    return paint_program.layerAdd();
}
pub fn paintLayerDelete(io: std.Io, environ: *const std.process.Environ.Map, id: u32) bool {
    if (g_paint_layout_stale) return false;
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    return paint_program.layerDelete(io, environ, id);
}
pub fn paintLayerMove(io: std.Io, environ: *const std.process.Environ.Map, id: u32, up: bool) bool {
    if (g_paint_layout_stale) return false;
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    return paint_program.layerMove(io, environ, id, up);
}
pub fn paintLayerSetVisible(io: std.Io, environ: *const std.process.Environ.Map, id: u32, on: bool) bool {
    if (g_paint_layout_stale) return false;
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    return paint_program.layerSetVisible(io, environ, id, on);
}
pub fn paintLayerSetActive(id: u32) bool {
    if (g_paint_layout_stale) return false;
    return paint_program.layerSetActive(id);
}
pub fn paintLayerRename(id: u32, name: []const u8) bool {
    if (g_paint_layout_stale) return false;
    return paint_program.layerRename(id, name);
}
pub fn paintLayerMergeDown(io: std.Io, environ: *const std.process.Environ.Map, id: u32) bool {
    if (g_paint_layout_stale) return false;
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    return paint_program.layerMergeDown(io, environ, id);
}

/// Carry a per-face colour set onto the active paint target (length ≥ facecount*4) —
/// used when a quality change derives the new mesh's colours from the source paint.
pub fn applyPaintColors(colors: []const u8) void {
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    model_paint.applyColors(colors);
}

/// The default unpainted face colour (matches the displayed atlas), so the source-side
/// authoritative paint starts identical to what's shown.
pub const DEFAULT_FACE = model_paint.DEFAULT_FACE;

/// Paint a face by its index (no raycast) — programmatic fill / the headless paint
/// proof. Returns false if there's no target or the index is out of range.
pub fn paintFaceByIndex(face: u32, r: u8, g: u8, b: u8) bool {
    if (g_paint_layout_stale or face >= model_paint.faceCount()) return false;
    mesh_edit.suspendFaceTint(); // paint lands under any selection tint, never mixed with it
    defer mesh_edit.resumeFaceTint();
    model_paint.paintFaceRgb(face, .{ r, g, b });
    return true;
}

/// Set the atlas base type (0 = Texture Template, 1 = Solid Colour, 2 = Blank) + solid colour,
/// then re-lay it on the current (unpainted) atlas — the Create Paint Atlas "Type" pick (req_2546).
pub fn setPaintBase(mode: u8, r: u8, g: u8, b: u8) bool {
    if (!model_paint.hasTarget()) return false;
    const m: model_paint.BaseMode = switch (mode) {
        1 => .solid,
        2 => .blank,
        else => .template,
    };
    // The base re-lay reads per-face colours and rewrites the whole atlas — both sides
    // must see TRUE paint, not the selection tint (this door fires from the Create Paint
    // Atlas prompt, which can open while faces are still selected).
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    if (g_paint_layout_stale) {
        // This is the user's explicit Remake Atlas decision. Until this exact door,
        // structural edits retain their old UVs/raster for recovery; now derive a
        // fresh packed layout for the current authored faces before laying the base.
        const verts = g_edit_verts orelse return false;
        paint_program.snapshotLayersForCarry();
        paint_program.reset();
        model_paint.rebuildLayout(verts, g_edit_count);
        const face_count = g_edit_count / 3;
        if (face_count > 0) _ = patchActiveEditMesh(0, face_count - 1);
    }
    model_paint.setBase(m, .{ r, g, b, 255 });
    model_paint.clearAtlas();
    // Even an untouched atlas is a durable authoring result. Capturing it now
    // lets a cold reopen restore without presenting the creation prompt again.
    paint_program.adoptCurrentAtlasAsBaseline();
    g_paint_layout_stale = false;
    return true;
}

/// Triangle count of the active paint target (0 if none) — lets a cart iterate faces.
pub fn paintFaceCount() u32 {
    return model_paint.faceCount();
}

// ── Free-form brush stroke (face-safe sub-face painting) ────────────────────────────
// The one brush system paints two ways: a per-face fill (paintAt/paintFaceByIndex above)
// and a free-form stroke of dabs in the face's ISLAND space (model_paint) — the dab is
// clipped to the authored face's silhouette, so it crosses a quad's diagonal seamlessly
// but never leaks onto a neighbour face (req_2281, req_2515/req_2516). Two face-safety
// modes, user-toggleable (req_2283): CLIP paints whichever face each dab lands on; LOCK
// masks the whole stroke to the face pressed at stroke-begin (it stops at that face's
// boundary). Stroke fineness comes from the paint DENSITY (texels/meter, setPaintDetail).
var g_paint_mode: u8 = 0; // 0 = clip, 1 = lock
var g_locked_face: u32 = 0;

/// Toggle the free-form face-safety mode: 0 = clip (paint the face under the dab), 1 = lock
/// (mask the stroke to the face captured by paintStrokeBegin).
pub fn paintModeSet(mode: i32) void {
    g_paint_mode = if (mode == 1) 1 else 0;
}

/// LOCK-mode stroke begin: pick the face under the cursor and remember it, so every dab in
/// this stroke masks to that one face. Returns the face index, or -1 on a miss / no target.
pub fn paintStrokeBegin(mx: f32, my: f32) i32 {
    if (!model_paint.hasTarget() or g_paint_layout_stale) return -1;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const hit = model_paint.pickBary(cam, g_paint_vp_w, g_paint_vp_h, vpLocalX(mx), vpLocalY(my)) orelse return -1;
    if (mesh_edit.scopedFaceHit(@intCast(hit.face)) < 0) return -1;
    g_locked_face = hit.face;
    return @intCast(hit.face);
}

/// Stamp ONE dab (and record it once). The island layout made the per-member fan-out
/// obsolete: a single stamp covers every triangle of the authored face the disc
/// overlaps (the island is one continuous space), and stamping each member separately
/// would double-blend the texels near the diagonal.
/// Re-export for the binding layer — the brush footprint spec lives in model_paint.
pub const BrushShape = model_paint.BrushShape;

fn stampGroup(face: u32, u: f32, v: f32, radius: f32, rgba: [4]u8, mat: bool, flow: f32, rgb: [3]u8, spec: model_paint.BrushShape) void {
    paint_program.beginRecordedOp(); // anchor the undo baseline BEFORE the dab lands (req_2672)
    if (mat) model_paint.paintStampTexShaped(face, u, v, radius, flow, spec) else model_paint.paintStampShaped(face, u, v, radius, rgba, flow, spec);
    paint_program.recordDabShaped(face, u, v, radius, flow, mat, rgb, spec);
}

/// Mirror painting (the studio's req_1538, ported host-side — req_2831): with mirror
/// planes armed, every dab also lands at its reflection(s). Face+bary → the world
/// point, reflect across each non-empty SUBSET of the armed planes about the mirror
/// frame's center (1 plane = 1 image, 2 = 3, 3 = 7 — the geometry mirror's law), map
/// each image back to face+bary, and stamp it as its OWN recorded dab — so program
/// replay never depends on the mirror state that painted it.
fn stampGroupMirrored(face: u32, u: f32, v: f32, radius: f32, rgba: [4]u8, mat: bool, flow: f32, rgb: [3]u8, spec: model_paint.BrushShape) void {
    stampGroup(face, u, v, radius, rgba, mat, flow, rgb, spec);
    const mask = mesh_edit.mirrorMask();
    if (mask == 0) return;
    const frame = mesh_edit.mirrorFramePub() orelse return;
    const pos = model_paint.positions() orelse return;
    const b = @as(usize, face) * 9;
    if (b + 8 >= pos.len) return;
    const a3 = [3]f32{ pos[b + 0], pos[b + 1], pos[b + 2] };
    const p = [3]f32{
        a3[0] + u * (pos[b + 3] - a3[0]) + v * (pos[b + 6] - a3[0]),
        a3[1] + u * (pos[b + 4] - a3[1]) + v * (pos[b + 7] - a3[1]),
        a3[2] + u * (pos[b + 5] - a3[2]) + v * (pos[b + 8] - a3[2]),
    };
    // On-plane epsilon proportional to the model's scale (the studio's rule).
    const eps = model_paint.modelScale() * 1e-3 + 1e-4;
    var sub: u8 = 1;
    while (sub < 8) : (sub += 1) {
        if ((sub & mask) != sub) continue; // only subsets of the ARMED planes
        var q = p;
        var ax: u3 = 0;
        while (ax < 3) : (ax += 1) {
            if (sub & (@as(u8, 1) << ax) != 0) q[ax] = 2.0 * frame.center[ax] - q[ax];
        }
        const hit = model_paint.worldToFaceBary(q, eps) orelse continue;
        if (mesh_edit.scopedFaceHit(@intCast(hit.face)) < 0) continue;
        if (hit.face == face) continue; // a dab ON the plane is its own mirror — skip
        stampGroup(hit.face, hit.u, hit.v, radius, rgba, mat, flow, rgb, spec);
    }
}

/// One free-form brush dab. CLIP: paint whichever face the ray hits, clipped to its
/// LOGICAL face (the authored group — a dab spans a quad's diagonal seamlessly). LOCK:
/// paint g_locked_face's group (from paintStrokeBegin) where the ray meets that face's
/// plane, even if the cursor drifted onto a neighbour. `radius`/`flow` are the brush disc
/// (patch-texel units) and its blend. Reuses vpLocalX/Y so the embedded-editor viewport
/// offset is honoured (req_2248) exactly like paintAt. Returns the painted face, or -1.
pub fn paintStampAt(mx: f32, my: f32, r: u8, g: u8, b: u8, radius: f32, flow: f32, spec: model_paint.BrushShape) i32 {
    if (!model_paint.hasTarget() or g_paint_layout_stale) return -1;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const lx = vpLocalX(mx);
    const ly = vpLocalY(my);
    const rgba = [4]u8{ r, g, b, 255 };
    const mat = model_paint.hasMaterialInk(); // dip into a shader bucket → sample it per dab
    if (g_paint_mode == 1) {
        if (mesh_edit.scopedFaceHit(@intCast(g_locked_face)) < 0) return -1;
        const uv = model_paint.baryOnFace(cam, g_paint_vp_w, g_paint_vp_h, lx, ly, g_locked_face) orelse return -1;
        stampGroupMirrored(g_locked_face, uv[0], uv[1], radius, rgba, mat, flow, .{ r, g, b }, spec);
        return @intCast(g_locked_face);
    }
    const hit = model_paint.pickBary(cam, g_paint_vp_w, g_paint_vp_h, lx, ly) orelse return -1;
    if (mesh_edit.scopedFaceHit(@intCast(hit.face)) < 0) return -1;
    stampGroupMirrored(hit.face, hit.u, hit.v, radius, rgba, mat, flow, .{ r, g, b }, spec);
    return @intCast(hit.face);
}

/// Fill one closed screen-authored pen path on a single logical UV island.
/// Every flattened point is raycast through the live camera; crossing a quad's
/// triangulation is allowed, crossing into another authored face is refused.
/// `points` are interleaved normalized viewport coordinates.
pub fn paintPolygonAt(points: []const f32, r: u8, g: u8, b: u8, flow: f32, blend: u8) bool {
    if (!model_paint.hasTarget() or g_paint_layout_stale) return false;
    if (points.len < 6 or points.len % 2 != 0 or points.len > paint_program.MAX_POLYGON_POINTS * 2) return false;
    const mapped = std.heap.c_allocator.alloc(f32, points.len) catch return false;
    defer std.heap.c_allocator.free(mapped);
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    var island: ?u32 = null;
    var representative_face: u32 = 0;
    var index: usize = 0;
    while (index < points.len) : (index += 2) {
        const nx = points[index + 0];
        const ny = points[index + 1];
        if (!std.math.isFinite(nx) or !std.math.isFinite(ny) or nx < 0.0 or nx > 1.0 or ny < 0.0 or ny > 1.0) return false;
        const hit = model_paint.pickBary(cam, g_paint_vp_w, g_paint_vp_h, nx * g_paint_vp_w, ny * g_paint_vp_h) orelse return false;
        if (mesh_edit.scopedFaceHit(@intCast(hit.face)) < 0) return false;
        const hit_island = model_paint.islandIndexForFace(hit.face) orelse return false;
        if (island) |expected| {
            if (hit_island != expected) return false;
        } else {
            island = hit_island;
            representative_face = hit.face;
        }
        const uv = model_paint.faceBaryToIslandUv(hit.face, hit.u, hit.v) orelse return false;
        mapped[index + 0] = uv[0];
        mapped[index + 1] = uv[1];
    }

    const mat = model_paint.hasMaterialInk();
    const safe_blend: u8 = if (blend <= 7) blend else 0;
    paint_program.beginRecordedOp();
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    const wrote = model_paint.paintPolygon(representative_face, mapped, .{ r, g, b, 255 }, mat, flow, safe_blend);
    if (!wrote) return false;
    paint_program.recordPolygon(representative_face, mapped, flow, safe_blend, mat, .{ r, g, b });
    return true;
}

/// Set the paint DENSITY (texels per meter — Blockbench 16x semantics; 1 = fill-only
/// look). Rebuilds the island atlas, rewrites the resident mesh UVs in place, then
/// re-uploads the whole mesh so the new mapping draws. Returns the ACTUAL density after
/// the call (paint_islands halves an over-budget request), so the UI shows what took.
pub fn setPaintDetail(px: i32) i32 {
    const verts = g_edit_verts orelse return -1;
    if (g_edit_count == 0) return -1;
    const want: u32 = if (px < 0) 1 else @intCast(px);
    // The rebuild carries each face's LIVE atlas colour — lift the selection tint first
    // so it never bakes into the carried paint (req_2611), re-tint over the new layout.
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    model_paint.setDetail(want, verts, g_edit_count);
    const face_count = g_edit_count / 3;
    if (face_count > 0) _ = patchActiveEditMesh(0, face_count - 1);
    return @intCast(model_paint.detail());
}

/// Rebuild the paint-island layout from the CURRENT model_source face groups and
/// re-upload the mesh. Face groups always land AFTER the paint target is adopted (the
/// __mesh_set_face_groups door, a topo op's re-grouping), so every groups-setter calls
/// this to turn the initial all-loose layout into real authored-face islands. Carries
/// per-face base colours; sub-face strokes return via stroke-program replay.
pub fn refreshPaintLayout() bool {
    const verts = g_edit_verts orelse return false;
    if (g_edit_count == 0 or !model_paint.hasTarget()) return false;
    // Structural topology installs already carry valid old-atlas UVs for display and
    // recovery. Group/range bookkeeping must not silently repack them; only the
    // explicit Remake Atlas door above is authorized to destroy that raster.
    if (g_paint_layout_stale) return false;
    // The authored grouping just (re)landed — the stroke program's hide-stable face
    // keys (group + intra-group ordinal) must recompute against it (req_2672).
    paint_program.invalidateFaceKeys();
    // The rebuild's colour carry reads the LIVE atlas — lift the selection tint first
    // so it never bakes into the new layout (req_2611), re-tint once it settles.
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    model_paint.rebuildLayout(verts, g_edit_count);
    const face_count = g_edit_count / 3;
    if (face_count > 0) _ = patchActiveEditMesh(0, face_count - 1);
    return true;
}

/// Set the paint fidelity by ATLAS BUDGET (the proven painter's law, req_2518): the
/// whole model's islands fit a fit_texels² atlas and the density falls out of the
/// model's own size. Returns the DERIVED density (texels/meter) so the UI can show it.
pub fn setPaintFit(fit_texels: i32) i32 {
    const verts = g_edit_verts orelse return -1;
    if (g_edit_count == 0) return -1;
    const want: u32 = if (fit_texels < 64) 64 else @intCast(fit_texels);
    mesh_edit.suspendFaceTint(); // as setPaintDetail: never carry the tint into the rebuild
    defer mesh_edit.resumeFaceTint();
    model_paint.setFit(want, verts, g_edit_count);
    const face_count = g_edit_count / 3;
    if (face_count > 0) _ = patchActiveEditMesh(0, face_count - 1);
    return @intCast(model_paint.detail());
}

/// Dry-run a density against the current paint target — the atlas dims + applied
/// density the island layout would produce, without adopting it. The atlas-creation
/// prompt shows these as the honest per-option cost.
pub const PaintEstimate = model_paint.AtlasEstimate;
pub fn estimatePaintAtlas(density: f32) ?PaintEstimate {
    return model_paint.estimateAtlas(density);
}

/// Dry-run an atlas-budget FIT (see setPaintFit) — dims + the derived density.
pub fn estimatePaintAtlasFit(fit_texels: u32) ?PaintEstimate {
    return model_paint.estimateAtlasFit(fit_texels);
}

/// The live island rects (for the UV inspector's structure overlay), or null.
pub fn paintIslands() ?[]const paint_islands_mod.Island {
    return model_paint.layoutIslands();
}

/// Exact UV silhouette for one displayed triangle. The atlas bridge emits these
/// beside island bounds so non-rectangular authored faces remain intelligible.
pub const PaintUvTriangle = model_paint.UvTriangle;
pub fn paintUvTriangle(face: u32) ?PaintUvTriangle {
    return model_paint.uvTriangle(face);
}

/// True when the active 3D authored-face selection contains this UV island.
/// An authored n-gon may contain several render triangles; any selected member
/// identifies the shared island because normal face picking selects the group.
pub fn paintIslandSelected(island_index: u32) bool {
    const face_count = model_paint.faceCount();
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        if (!mesh_edit.faceSelectedPub(face)) continue;
        if (model_paint.islandIndexForFace(face) == island_index) return true;
    }
    return false;
}

/// Select one UV island through the native authored-face selection. This is the
/// inverse of paintIslandSelected and keeps the viewport overlay, HUD count, and
/// UV transform handles on one authoritative selection.
pub fn meshEditSelectPaintIsland(island_index: u32, additive: bool) bool {
    const face = model_paint.firstFaceForIsland(island_index) orelse return false;
    return meshEditSelectFace(face, additive);
}

/// Apply one complete UV-island rectangle table to the live model. The atlas is
/// fixed artwork: only the resident mesh's sampling coordinates move. Since the
/// stroke program records face-relative coordinates, bake the unchanged current
/// raster as its new baseline at this boundary so a later replay cannot move old
/// pixels behind the user's back.
pub fn applyUvIslandRects(rects: []const u32) bool {
    const verts = g_edit_verts orelse return false;
    const islands = model_paint.layoutIslands() orelse return false;
    if (rects.len != islands.len * 4) return false;

    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    if (!model_paint.applyIslandRects(rects, verts, g_edit_count)) return false;
    paint_program.adoptCurrentAtlasAsBaseline();
    const face_count = g_edit_count / 3;
    // No retained GPU row is a valid pre-first-draw state. The CPU edit mesh is
    // already authoritative and will seed that row when it appears; a missing
    // cache must not make a completed UV edit report failure to the author.
    if (face_count > 0) _ = patchActiveEditMesh(0, face_count - 1);
    return true;
}

/// Replace the current atlas with an equal-sized externally edited raster. This
/// is an explicit bake boundary: the imported PNG becomes the new undo baseline
/// and subsequent strokes continue on the existing layer table.
pub fn replacePaintAtlas(rgba: []const u8) bool {
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    if (!model_paint.setAtlas(rgba)) return false;
    paint_program.adoptCurrentAtlasAsBaseline();
    return true;
}

// ── Paint variants (save / load a whole painting) ───────────────────────────────────
// A saved variant is the model's entire paint atlas at a moment in time (DESIGN_INTAKE: a
// model painted a million ways, each stored in its folder). Read gives the raw atlas + its
// detail so the editor can persist it; apply restores the detail (so the layout/UVs match)
// then blits the saved bytes back over the texture.
pub const PaintAtlas = struct { rgba: []const u8, w: u32, h: u32, detail: u32 };
pub fn paintAtlas() ?PaintAtlas {
    const a = model_paint.atlas() orelse return null;
    return .{ .rgba = a.rgba, .w = a.w, .h = a.h, .detail = model_paint.detail() };
}

/// Eyedropper: the painted colour under the viewport pixel — pickBary against the
/// resident model, then the atlas texel at the hit. Null on a miss / no paint target.
pub fn samplePaintAt(mx: f32, my: f32) ?[3]u8 {
    if (!model_paint.hasTarget()) return null;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const hit = model_paint.pickBary(cam, g_paint_vp_w, g_paint_vp_h, vpLocalX(mx), vpLocalY(my)) orelse return null;
    if (mesh_edit.scopedFaceHit(@intCast(hit.face)) < 0) return null;
    const px = model_paint.sampleTexel(hit.face, hit.u, hit.v) orelse return null;
    return .{ px[0], px[1], px[2] };
}

/// The painting's dominant colours (the colour library's SCENE swatches) — see
/// model_paint.atlasPalette. Returns 0 when no model is adopted for paint.
pub fn paintAtlasPalette(out: [][3]u8) usize {
    if (!model_paint.hasTarget()) return 0;
    return model_paint.atlasPalette(out);
}
/// The active DISPLAYED mesh — the verts the painted preview actually renders, whose
/// UVs the island layout rewrote into paint-atlas space (req_2833: the source mesh's
/// UVs do NOT match the paint atlas; a consumer pairing base.png with source verts
/// gets a scrambled painting). Null when no model is resident.
pub fn paintedMeshVerts() ?[]const f32 {
    const verts = g_edit_verts orelse return null;
    if (g_edit_count == 0) return null;
    return verts[0 .. @as(usize, g_edit_count) * 8];
}
/// Load a saved painting: restore its detail (rewrites UVs + re-uploads the mesh) then blit the
/// saved atlas over the texture. Returns false if the bytes don't match the restored dimensions.
pub fn applyPaintAtlas(detail_px: i32, rgba: []const u8) bool {
    // Saved atlas pixels describe the previous island layout. They cannot be the
    // implicit way out of a stale topology; the user must remake the atlas first.
    if (g_paint_layout_stale) return false;
    // The blit overwrites every texel — lift the tint so the saved painting lands as
    // TRUE paint, then re-tint over it (folds with setPaintDetail's nested guard).
    mesh_edit.suspendFaceTint();
    defer mesh_edit.resumeFaceTint();
    _ = setPaintDetail(detail_px);
    if (!model_paint.setAtlas(rgba)) return false;
    // The saved painting knows nothing about the mesh's glass — its alpha is whatever
    // was live at save time. Re-assert the per-face glass state from the source colour
    // table (the durable truth meshdoc exports), colour untouched (req_2928).
    if (model_source.colors()) |src| {
        const fc = model_paint.faceCount();
        var f: u32 = 0;
        while (f < fc) : (f += 1) {
            if (@as(usize, f) * 4 + 3 >= src.len) break;
            model_paint.paintFaceAlpha(f, src[f * 4 + 3]);
        }
    }
    return true;
}

/// Lift / re-apply the mesh-editor selection tint around an atlas READ done outside this
/// module — the __model_atlas_read door persists what it reads, and a persisted atlas
/// must hold TRUE paint, never the selection orange (req_2611). Depth-counted.
pub fn paintTintSuspend() void {
    mesh_edit.suspendFaceTint();
}
pub fn paintTintResume() void {
    mesh_edit.resumeFaceTint();
}

var g_dbg_frame: u64 = 0; // req_0727: rate-limit the r3d-census diagnostic print

// ── Dynamic geometry region (variable-size bump) ────────────────────────────
// LIVE-edited or per-chunk geometry (a sculpted heightfield, a painted ground
// chunk, an imported prop mesh) cannot use the intern cache: every edit is a new
// content key, so interning would consume a PERMANENT block per edit and fill the
// region (then the mesh vanishes). Instead a mesh ships a key of the form
// "~dyn~<slotId>~<version>" (or "~hf~…"): the host keeps ONE entry per slotId and
// OVERWRITES its verts in place when the version changes. The entry's GPU region is
// bump-allocated by its ACTUAL vertex count out of the reserved dyn tail of
// g_retained_vbuf — NOT a fixed per-slot reservation.
//
// WHY VARIABLE-SIZE (GROUNDVANISH-0622, req_1654): the old design gave every entry a
// fixed MAX_DYN_VERTS slot and capped the entry COUNT at 48. A painted world emits
// ONE heightfield mesh per chunk (worldGeometry.encodeFloorHeightfields, "EVERY
// painted chunk"), and a real map has hundreds of chunks — far past 48. Slots claim
// lazily on the first in-frustum draw and NEVER evict, so once 48 distinct ground/dyn
// meshes had ever drawn, every further chunk's mesh resolved to null and SILENTLY did
// not draw: walk so a fresh patch of ground (or the trees standing on it) comes into
// view and the ground under you drops, permanently. A flat chunk bakes ~30 verts and
// a full tile-res relief chunk ~89k; sizing each entry by its REAL count instead of a
// flat 98,304-vert slot fits thousands of flat chunks (or ~53 max-res relief chunks,
// or any mix) in the SAME tail — and exhaustion is now LOUD, never silent (the user's
// standing rule against low silent caps, req_0892).
//
// Per-MESH vertex ceiling. The heightfield mesh is NON-indexed (6 verts/quad), so a
// tile-resolution chunk — hmsc-int paints one mesh vertex per tile, 121x121 over a
// 120-tile chunk — is 120*120*6 = 86,400 top verts + perimeter skirt ≈ 89k. Also
// sizes g_hf_scratch. (Indexed meshes would cut this ~6x and are the real long-term
// fix, but that's a vertex+index pipeline change for later.)
const MAX_DYN_VERTS = 98304;
// Reserved vertex budget for the whole dyn tail, shared by ALL ~dyn~/~hf~ entries via
// the bump allocator below. Same TOTAL as the old 48 fixed slots, so the single-buffer
// layout and the 256 MiB comptime cap are unchanged — but now packed by real size
// instead of one fat slot apiece.
const DYN_REGION_VERTS = 48 * MAX_DYN_VERTS; // 4,718,592 verts of dyn tail
// Max distinct live keys (metadata structs ONLY — ~40 B each, NOT a vert reservation),
// so this is cheap to size generously; the real ceiling is DYN_REGION_VERTS above. A
// max-extent map is 152*8 ≈ 1216 chunks + water + props, well under this.
const DYN_META_SLOTS = 4096;

// req_0731: g_retained_vbuf is ONE buffer = intern region + this dyn tail. Its
// total alloc MUST stay within the WebGPU per-buffer cap, or the GPU allocation
// is illegal — and uncaught (a non-validation build) that hard-locks the driver
// (kernel panic + looping audio). Fail the BUILD here, not the machine, if either
// MAX_RETAINED_VERTS or the dyn region is ever bumped past the cap.
comptime {
    const total_bytes = (MAX_RETAINED_VERTS + DYN_REGION_VERTS) * @sizeOf(Vertex);
    if (total_bytes > MAX_BUFFER_BYTES) {
        @compileError("g_retained_vbuf would exceed WebGPU maxBufferSize (256 MiB): shrink MAX_RETAINED_VERTS or the dyn region, or raise the device maxBufferSize limit at device creation");
    }
}

const DynSlot = struct {
    id_hash: u64 = 0,
    version_hash: u64 = 0,
    offset_bytes: u64 = 0, // this entry's region in g_retained_vbuf (set by dynEnsureRegion)
    capacity: u32 = 0, // verts bump-allocated for it; reuse in place while count ≤ this
    count: u32 = 0, // live vertex count actually uploaded
    present: bool = false,
};
var g_dyn_slots: [DYN_META_SLOTS]DynSlot = [_]DynSlot{.{}} ** DYN_META_SLOTS;
var g_dyn_len: usize = 0;
var g_dyn_bump_verts: u64 = 0; // bump cursor (verts) into the dyn tail [0, DYN_REGION_VERTS)
var g_dyn_warned: bool = false; // one-shot LOUD warning when the region/table fills

// Per-frame DYNAMIC instance cap. drawScene refills + re-uploads this buffer every
// frame for instanced batches whose contents change, and for oversized streamed
// static families that cannot fit in the retained static buffer. 262144 × 80 bytes
// is ~20 MB: large enough for dense streamed city views without jumping to the
// hundreds of MB a whole 4M-row world would require per frame.
// STATIC world geometry that fits rides g_static_inst_buf below and never re-stages.
const MAX_INSTANCES: u32 = 262144;
const MAX_SCENE_MESHES: usize = 32768;

// The instance staging buffer, off the stack (a large local risks stack overflow).
// Used for the per-frame dynamic fill AND as the chunked staging window for one-time
// static uploads. BSS-resident, so its pages are committed only as drawScene writes.
var g_inst_scratch: [MAX_INSTANCES]InstanceData = undefined;

// Retained INSTANCE buffer — the instance-level analogue of g_retained_vbuf. A node
// flagged scene3d_instance_static (the loader's static world batch) is staged +
// uploaded ONCE, keyed by its data pointer, then redrawn every frame straight from
// this buffer with NO restage/upload. THE fix for the static-world re-upload choke.
// The per-instance model matrix is camera-independent (makeInstance is model-only;
// the camera lives in per-frame SceneUniforms), so a cached instance still tracks the
// camera. Lazily created (80 MB at the 512-block max), so carts with no static batch
// reserve nothing.
pub const MAX_STATIC_INSTANCES: u32 = 1048576; // pub: the world loader budgets its LOD shell against this
const STATIC_INST_CACHE_LEN: usize = 64;
const StaticInstEntry = struct { key: usize = 0, count: u32 = 0, offset: u64 = 0, used: bool = false, version: u32 = 0, last_seen: u64 = 0 };
var g_static_inst_buf: ?*wgpu.Buffer = null;
var g_static_inst_top: u64 = 0; // bump cursor (bytes) into g_static_inst_buf
var g_static_inst_cache: [STATIC_INST_CACHE_LEN]StaticInstEntry = [_]StaticInstEntry{.{}} ** STATIC_INST_CACHE_LEN;
var g_static_inst_cache_len: usize = 0;
// req_2843 ("the 15.5mb cap on flora is killing me"): the retained pools are
// ELASTIC — MAX_STATIC_INSTANCES is the STARTING size, these are the live row
// capacities. When a batch doesn't fit, the pool doubles (GPU-copy at the same
// offsets, so every retained region stays valid) up to the device's granted
// maxBufferSize. The machine is the wall now, not a constant in this file.
var g_static_inst_cap: u32 = MAX_STATIC_INSTANCES;
var g_slim_static_cap: u32 = MAX_STATIC_INSTANCES;

// FOLIAGE CARDS' OWN retained instance pool — the slim 24-byte twin of g_static_inst_*,
// shared by grass/bush/flower (~grass~) and palm fronds (~frond~). Foliage is the
// heaviest by count (millions of grass blades, 19–29 frond cards/palm), so it gets a
// separate buffer in the slim SlimInstance format: 3.33× less per row AND off the
// shared static pool, so a view full of foliage no longer starves buildings (the
// despawn lever). Same MAX_STATIC_INSTANCES row budget → 24 MB here vs 80 MB shared.
var g_slim_static_buf: ?*wgpu.Buffer = null;
var g_slim_static_top: u64 = 0; // bump cursor (bytes) into g_slim_static_buf
var g_slim_static_cache: [STATIC_INST_CACHE_LEN]StaticInstEntry = [_]StaticInstEntry{.{}} ** STATIC_INST_CACHE_LEN;
var g_slim_static_cache_len: usize = 0;
// Per-frame staging window for foliage-card rows that overflow the retained pool (the
// static→dynamic degrade path), the SlimInstance analogue of g_inst_scratch.
var g_slim_inst_scratch: [MAX_INSTANCES]SlimInstance = undefined;

// LOUD one-shot warnings for every instance-pool degrade (req_2708). A batch
// that can't retain falls to per-frame staging; a full per-frame pool DROPS the
// rest of the frame's groups — either way something on screen quietly changed,
// and the user's standing rule is that truncation is never silent (req_0892).
var g_static_retain_warned: bool = false;
var g_frame_pool_warned: bool = false;

fn staticRetainWarn(pool: []const u8, what: []const u8, rows: u32, used: u32) void {
    if (g_static_retain_warned) return;
    g_static_retain_warned = true;
    log.print("[r3d] static {s} instance {s} FULL ({d}-row batch refused, {d} rows retained) — the pool could NOT grow further (device maxBufferSize, or every cache entry was used this render). The batch degrades to per-frame staging and can VANISH if the per-frame pool also fills (req_2843: pools are elastic, this is the machine's wall).\n", .{ pool, what, rows, used });
}

fn framePoolWarn(pool: []const u8) void {
    if (g_frame_pool_warned) return;
    g_frame_pool_warned = true;
    log.print("[r3d] per-frame {s} instance pool FULL — the remaining instance groups this frame were DROPPED (foliage/props visibly missing). Raise MAX_INSTANCES in framework/gpu/3d.zig or free the static pools.\n", .{pool});
}

/// Grow a retained instance pool to hold `needed_rows` (req_2843). The new
/// buffer is the doubled capacity (clamped to the device's granted
/// maxBufferSize) and the old contents ride along via a GPU-side copy at the
/// SAME offsets, so every cached region stays valid and no re-upload is
/// needed. Returns false only when the DEVICE can't go further — the honest
/// wall — and the caller falls to the loud per-frame degrade path.
fn growStaticPool(device: *wgpu.Device, queue: *wgpu.Queue, buf: *?*wgpu.Buffer, cap_rows: *u32, top_bytes: u64, row_bytes: u64, needed_rows: u64, label: []const u8) bool {
    const max_rows: u64 = core.deviceMaxBufferSize() / row_bytes;
    if (needed_rows > max_rows) return false;
    var new_cap: u64 = @max(@as(u64, cap_rows.*), 1);
    while (new_cap < needed_rows) new_cap *= 2;
    if (new_cap > max_rows) new_cap = max_rows;
    const old = buf.* orelse return false;
    const new_buf = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice(label),
        .size = new_cap * row_bytes,
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst | wgpu.BufferUsages.copy_src,
        .mapped_at_creation = 0,
    }) orelse return false;
    if (top_bytes > 0) {
        const enc = device.createCommandEncoder(&.{}) orelse {
            new_buf.release();
            return false;
        };
        enc.copyBufferToBuffer(old, 0, new_buf, 0, top_bytes);
        const cmd = enc.finish(null) orelse {
            enc.release();
            new_buf.release();
            return false;
        };
        enc.release();
        queue.submit(&.{cmd});
        cmd.release();
    }
    old.release();
    buf.* = new_buf;
    cap_rows.* = @intCast(new_cap);
    log.print("[r3d] {s} pool GREW to {d} rows ({d} MiB) — elastic pools, the device is the wall (req_2843)\n", .{ label, new_cap, new_cap * row_bytes / (1024 * 1024) });
    return true;
}

/// Pick the cache slot for a new retained batch: the next free slot, else the
/// least-recently-seen entry that was NOT referenced this render (req_2843 —
/// elastic CPU buffers change pointers when they grow, stranding their old
/// entries; recycling the stalest slot keeps the table from filling with
/// ghosts). Returns null only when every entry was seen this render.
fn staticCacheSlot(cache: []StaticInstEntry, len: *usize, now: u64) ?*StaticInstEntry {
    if (len.* < cache.len) {
        const e = &cache[len.*];
        len.* += 1;
        return e;
    }
    var oldest: ?*StaticInstEntry = null;
    for (cache) |*e| {
        if (e.last_seen >= now) continue;
        if (oldest == null or e.last_seen < oldest.?.last_seen) oldest = e;
    }
    return oldest;
}

// ════════════════════════════════════════════════════════════════════════
// Pipeline state
// ════════════════════════════════════════════════════════════════════════

var g_pipeline: ?*wgpu.RenderPipeline = null;
// Same pipeline as g_pipeline but depth-WRITE off (depth-test stays on). Glass
// and other alpha<1 meshes draw through this in a second, back-to-front pass so
// they composite over the opaque scene without occluding each other via depth.
var g_pipeline_transparent: ?*wgpu.RenderPipeline = null;
// Grass pipeline — same pipeline LAYOUT and vertex layouts as g_pipeline (group0
// SceneUniforms + group1 diffuse, per-instance model+color), only the shader module
// differs (shaders.grass_wgsl: vertex wind + procedural wisp cutout + root→tip
// gradient). Built once in init. Instanced groups whose leader carries the "~grass~"
// texture-key sentinel swap to this mid-pass (the ~hf~-style host-routing convention).
var g_grass_pipeline: ?*wgpu.RenderPipeline = null;
// Water pipeline — twin of g_grass_pipeline (same layout/vertex layouts/blend),
// only shaders.water_wgsl differs (vertex FBM wave displacement from S.time +
// fragment deep/shallow/foam/Bayer-dither). Alpha-hashed via discard so it's an
// opaque-pass draw (depth-write ON, no sorting). Instanced groups whose leader
// carries the "~water~" tex-key sentinel swap to this mid-pass.
var g_water_pipeline: ?*wgpu.RenderPipeline = null;
// Frond pipeline — twin of grass/water (same layout/vertex layouts), shaders.frond_wgsl:
// vertex wind sway + fragment palm/leaf cutout (feathered or broad by uv.u) + green
// gradient. Alpha-tested via discard → opaque-pass draw. Instanced groups whose leader
// carries the "~frond~" tex-key sentinel swap to this — tree crowns of leaf cards.
var g_frond_pipeline: ?*wgpu.RenderPipeline = null;
// Ground-formula pipeline (the data-shape ground — GUIDING_LIGHT). Built ONCE,
// lazily, the first frame a mesh carries scene3d_ground_formula: the formula is
// identical for every chunk (only the per-cell D ref stream differs), so one
// pipeline serves them all. group0 = SceneUniforms (shared layout); group1 = a
// per-chunk storage buffer holding D. No baked texture — crisp at any zoom.
var g_ground_pipeline: ?*wgpu.RenderPipeline = null;
var g_ground_formula_hash: u64 = 0; // formula the live pipeline was built from; rebuild on change
var g_ground_bgl: ?*wgpu.BindGroupLayout = null; // group1: vertex+fragment read-only D
const GROUND_POOL = terrain_grid.MAX_RESIDENT_CHUNKS;
// D carries the formula prefix plus a fixed-offset 121×121 height trailer. The
// vertex stage reads the trailer; the fragment stage continues to read the
// unchanged formula prefix.
const GROUND_DATA_FLOATS = terrain_grid.TOTAL_FLOATS;
var g_ground_truncate_warned: bool = false;
var g_ground_data_buf: [GROUND_POOL]?*wgpu.Buffer = [_]?*wgpu.Buffer{null} ** GROUND_POOL;
var g_ground_data_bg: [GROUND_POOL]?*wgpu.BindGroup = [_]?*wgpu.BindGroup{null} ** GROUND_POOL;
var g_ground_data_ptr: [GROUND_POOL]usize = @splat(0);
var g_ground_data_version: [GROUND_POOL]u64 = @splat(0);
var g_ground_data_len: [GROUND_POOL]usize = @splat(0);
// One immutable topology serves every formula-painted terrain chunk. Per-chunk
// height and normal values are fetched from D in the vertex shader, so ground
// never consumes the bump-only arbitrary dynamic-mesh arena.
var g_ground_grid_vbuf: ?*wgpu.Buffer = null;
var g_ground_grid_vert_count: u32 = 0;
// DEDICATED per-instance buffer for the ground-formula pass (GROUNDSTARVE-0622,
// req_1659). The ground pass used to write its model instances into the SHARED
// per-frame g_instance_buf at the running inst_top cursor — AFTER the dynamic
// instanced batches. When a big world overflows the static instance buffer
// (total rows > MAX_STATIC_INSTANCES), the overflow FOLIAGE families fall back to
// that same per-frame buffer, and a view full of trees/grass filled inst_top to its
// 262144 cap before the ground pass ran — so every painted ground chunk broke out on
// the cap and VANISHED (view-dependent: look away from the trees and the ground came
// back). The ground you stand on must always draw (mirrors the loader registering
// floor colliders first), so it gets its OWN small buffer — one InstanceData per
// drawn chunk, never contending with foliage. GROUND_POOL * 32 B = 4 KB.
var g_ground_inst_buf: ?*wgpu.Buffer = null;
var g_vertex_buffer: ?*wgpu.Buffer = null;
var g_retained_vbuf: ?*wgpu.Buffer = null; // persistent verts for interned registry geometry
var g_instance_buf: ?*wgpu.Buffer = null; // per-frame InstanceData buffer (step=instance, vbuf 1)
var g_slim_inst_buf: ?*wgpu.Buffer = null; // per-frame slim SlimInstance buffer (frond pipeline only)
var g_uniform_buffer: ?*wgpu.Buffer = null;
// Placed-light storage (group 0, binding 1) — MAX_LIGHTS Light rows, fragment
// read-only. Bound on EVERY scene draw (it lives in g_bind_group); the count is
// carried in SceneUniforms.light_count, so a frame with no placed lights binds
// the same buffer and the shader loop simply runs zero times.
var g_lights_buf: ?*wgpu.Buffer = null;
// Shadow map for the first shadow-casting spotlight (group 0, bindings 2–4).
// Always bound on every scene draw; `has_shadow` in g_shadow_uniform_buf gates the
// test, so frames with no caster sample a cleared map but short-circuit to lit.
var g_shadow_tex: ?*wgpu.Texture = null;
var g_shadow_view: ?*wgpu.TextureView = null;
var g_shadow_sampler: ?*wgpu.Sampler = null; // comparison sampler
var g_shadow_uniform_buf: ?*wgpu.Buffer = null;
var g_shadow_pipeline: ?*wgpu.RenderPipeline = null; // depth-only, light POV
var g_shadow_inst_buf: ?*wgpu.Buffer = null; // caster geometry instances (own buffer)
var g_shadow_vp_buf: ?*wgpu.Buffer = null; // light VP for the shadow pipeline's group0
var g_shadow_pass_bind_group: ?*wgpu.BindGroup = null; // shadow pipeline group0 (just VP)
var g_bind_group: ?*wgpu.BindGroup = null;
var g_bind_group_layout: ?*wgpu.BindGroupLayout = null;
var g_tex_bind_group_layout: ?*wgpu.BindGroupLayout = null;
// Skybox: a separate pipeline + uniform buffer. Drawn as one fullscreen
// triangle before the meshes, depth-test = always / depth-write = off, so it
// fills the background and meshes paint over it. See shaders.skybox_wgsl.
var g_sky_pipeline: ?*wgpu.RenderPipeline = null;
var g_sky_uniform_buffer: ?*wgpu.Buffer = null;
var g_sky_bind_group: ?*wgpu.BindGroup = null;
var g_sky_bind_group_layout: ?*wgpu.BindGroupLayout = null;
// 1×1 white default texture so every mesh has *something* to sample —
// multiplying by white collapses to the uniform color, preserving the
// pre-texture look for meshes that don't supply their own texture.
var g_default_tex: ?*wgpu.Texture = null;
var g_default_tex_view: ?*wgpu.TextureView = null;
var g_default_tex_bind_group: ?*wgpu.BindGroup = null;
// Nearest-filter sampler for the diffuse texture path. Block-face pixels
// stay crisp; switch to linear later if smoother sampling is wanted.
var g_diffuse_sampler: ?*wgpu.Sampler = null;
var g_initialized: bool = false;

var g_sampler: ?*wgpu.Sampler = null;

// ── Render-target pool ─────────────────────────────────────────────────
//
// Each <Scene3D> instance needs its own render-to-texture surface so that
// when multiple scenes share a frame (the avatar's bust portrait next to
// the chat, plus the full-body view on /character, plus debug labs) they
// don't clobber each other's texture content before the image pipeline
// composites the quads.
//
// The pool is round-robin per frame: render() pulls the next slot, sizes
// it on first use (or on a size change), and renders into it. queueQuad
// references that slot's bind_group. frameCleanup() resets the cursor so
// the next frame reuses the same slots from the top.
//
// Slots persist across frames — only resized when a tile changes
// dimensions. With the pipeline already serialized (each frame flushes
// before the next begins), the previous frame's bind groups are no
// longer in flight by the time we recycle the slots.
const MAX_RT_POOL = 16;
const Rt = struct {
    color_texture: ?*wgpu.Texture = null,
    color_view: ?*wgpu.TextureView = null,
    depth_texture: ?*wgpu.Texture = null,
    depth_view: ?*wgpu.TextureView = null,
    composite_bind_group: ?*wgpu.BindGroup = null,
    width: u32 = 0,
    height: u32 = 0,
};
var g_rt_pool: [MAX_RT_POOL]Rt = [_]Rt{.{}} ** MAX_RT_POOL;
var g_rt_cursor: usize = 0;
// [req_1752] one-shot diagnostics: which way acquireRt fails when a Scene3D view
// gets no render target (→ render() returns false → drawScene never runs → blank).
var g_rt_pool_warned: bool = false;
var g_rt_alloc_warned: bool = false;

// Scenes recorded by render() during the paint walk, drawn later by
// flushPending() (after StaticSurface captures). One pending entry per
// acquired RT slot, so it shares the pool's cap.
const Pending = struct { node: *Node, slot: *Rt, x: f32, y: f32, w: f32, h: f32 };
var g_pending: [MAX_RT_POOL]Pending = undefined;
var g_pending_count: usize = 0;

pub const TelemetryStats = struct {
    scene_count: u32 = 0,
    mesh_children: u32 = 0,
    meshes_collected: u32 = 0,
    meshes_dropped: u32 = 0,
    instances: u32 = 0,
    /// Of `instances`, how many were RE-STAGED into the per-frame buffer this frame
    /// (overflow families that don't fit the static buffer — pure per-frame upload
    /// waste). High + correlated with fps drop ⇒ the cost is CPU re-staging, not
    /// GPU overdraw. req_1670 discriminator.
    staged_dynamic: u32 = 0,
    draw_calls: u32 = 0,
    triangles: u64 = 0,
    draw_us: u64 = 0,
};
var g_telemetry = TelemetryStats{};

fn recordDraw(vertex_count: u32, instance_count: u32) void {
    if (instance_count == 0) return;
    g_telemetry.draw_calls += 1;
    g_telemetry.instances += instance_count;
    g_telemetry.triangles += (@as(u64, vertex_count) / 3) * @as(u64, instance_count);
}

// Distance-density LOD for segmented foliage batches (req_2868). Inside NEAR
// every plant draws; density falls linearly to FLOOR at FAR and holds there.
// A 0.5 m grass blade is sub-pixel past ~150 m on a 1440p view, so the thinning
// starts where individual plants stop being resolvable and never drops below
// the floor — distant fields stay green, they just stop paying per-blade.
const FOLIAGE_LOD_NEAR_M: f32 = 150.0;
const FOLIAGE_LOD_FAR_M: f32 = 480.0;
const FOLIAGE_LOD_FLOOR: f32 = 0.15;

/// Sphere-vs-frustum: true when the sphere at (cx,cy,cz) touches the frustum
/// described by six normalized inward-facing planes (req_2859).
fn sphereInFrustum(planes: *const [6][4]f32, cx: f32, cy: f32, cz: f32, radius: f32) bool {
    for (planes) |p| {
        if (p[0] * cx + p[1] * cy + p[2] * cz + p[3] < -radius) return false;
    }
    return true;
}

/// One instanced draw of rows [first, first+count) from a retained static
/// instance pool (slim or standard) — the shared tail of the whole-batch and
/// per-segment (req_2859) static draw paths. Vertex buffer 0 and the bind
/// group must already be set.
fn drawStaticInstanceRange(pass: *wgpu.RenderPassEncoder, group_verts: u32, sd_offset: u64, is_slim: bool, first: u32, count: u32) void {
    if (count == 0 or group_verts == 0) return;
    if (is_slim) {
        pass.setVertexBuffer(1, g_slim_static_buf.?, sd_offset + bu.bytesOfCount(SlimInstance, first), bu.bytesOfCount(SlimInstance, count));
    } else {
        pass.setVertexBuffer(1, g_static_inst_buf.?, sd_offset + bu.bytesOfCount(InstanceData, first), bu.bytesOfCount(InstanceData, count));
    }
    pass.draw(group_verts, count, 0, 0);
    recordDraw(group_verts, count);
}

// Opt-in per-frame perf readout (RJIT_PERFLOG=1). cpu_draw_us measures CPU command
// encoding + instance re-staging only — async GPU shading (overdraw) is NOT in it, so
// the two numbers together separate a CPU re-stage choke from a GPU overdraw choke.
var g_perflog_on: bool = false;
var g_perf_frame: u64 = 0;
fn perfLogOn() bool {
    return g_perflog_on;
}

// req_1933: the [r3d-census] / [ground-pass] diagnostics (req_0727) printed every 120 frames
// UNCONDITIONALLY and spammed the dev terminal. Opt-in now — set RJIT_R3D_CENSUS=1 to bring them
// back when debugging the instanced-mesh / ground pass.
var g_census_on: bool = false;
fn censusOn() bool {
    return g_census_on;
}

// On-screen fps HUD (RJIT_FPS=1, or RJIT_PERFLOG=1). Queued from render() — which
// runs in the paint WALK, BEFORE gpu.frame() does its text.upload — so the glyphs
// make it into this frame's 2D pass (queuing from flushPending is too late: the text
// buffer is already uploaded by then). fps is WALL-CLOCK frame-to-frame (so it
// reflects GPU overdraw stalls and the 60fps SDL cap, unlike draw_us which is
// CPU-encode only; the telemetry shown is the PREVIOUS frame's, a harmless 1-frame
// lag). req_1674.
var g_fpshud_on: bool = false;
var g_last_flush_us: i64 = 0;
var g_fps_ema: f32 = 0;
fn fpsHudOn() bool {
    return g_fpshud_on;
}

pub fn drawFpsHud(io: std.Io) void {
    if (!fpsHudOn()) return;
    const now = std.Io.Clock.now(.awake, io).toMicroseconds();
    if (g_last_flush_us != 0) {
        const dt_us = now - g_last_flush_us;
        if (dt_us > 0) {
            const inst_fps = 1_000_000.0 / @as(f32, @floatFromInt(dt_us));
            g_fps_ema = if (g_fps_ema <= 0) inst_fps else g_fps_ema * 0.9 + inst_fps * 0.1;
        }
    }
    g_last_flush_us = now;
    var buf: [160]u8 = undefined;
    const line = std.fmt.bufPrint(&buf, "fps {d:.0}   draw {d}us   inst {d}   restage {d}   dc {d}", .{
        g_fps_ema, g_telemetry.draw_us, g_telemetry.instances, g_telemetry.staged_dynamic, g_telemetry.draw_calls,
    }) catch return;
    // Shadow + bright text so it reads over any background.
    core.drawTextLine(line, 9, 9, 14, 0, 0, 0, 0.8);
    core.drawTextLine(line, 8, 8, 14, 0.3, 1.0, 0.45, 1.0);
}

pub fn telemetryStats() TelemetryStats {
    return g_telemetry;
}

// ════════════════════════════════════════════════════════════════════════
// Init / deinit (same as before — pipeline, bind groups, sampler)
// ════════════════════════════════════════════════════════════════════════

pub fn init(environ: *const std.process.Environ.Map) void {
    g_perflog_on = environ.get("RJIT_PERFLOG") != null;
    g_census_on = environ.get("RJIT_R3D_CENSUS") != null;
    g_paint_probe_enabled = environ.get("RJIT_PAINTPROBE") != null;
    if (environ.get("RJIT_FPS")) |value| {
        g_fpshud_on = !std.mem.eql(u8, value, "0") and !std.mem.eql(u8, value, "");
    } else {
        const default_on = if (@hasDecl(build_options, "use_v8")) !build_options.use_v8 else false;
        g_fpshud_on = default_on or g_perflog_on;
    }
    const device = core.getDevice() orelse return;
    const shader_desc = wgpu.shaderModuleWGSLDescriptor(.{ .label = "render3d_shader", .code = shaders.scene3d_wgsl });
    const shader_module = device.createShaderModule(&shader_desc) orelse return;
    defer shader_module.release();

    g_vertex_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("render3d_verts"),
        .size = MAX_FRAME_VERTS * @sizeOf(Vertex),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });
    // Retained buffer for interned registry geometry — uploaded once per unique
    // key, never reset per frame (unlike g_vertex_buffer which bump-resets).
    g_retained_vbuf = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("render3d_retained_verts"),
        // Intern region [0, MAX_RETAINED_VERTS) + a reserved dynamic-slot tail.
        .size = (MAX_RETAINED_VERTS + DYN_REGION_VERTS) * @sizeOf(Vertex),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });
    // Scene uniforms — ONE set per frame (no dynamic offset). Was per-draw with
    // a 256-byte stride × MAX_DRAW_UNIFORMS; instancing moved per-mesh data (model
    // matrix, color) into the per-instance vertex buffer below.
    g_uniform_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("render3d_scene_uniforms"),
        .size = @sizeOf(SceneUniforms),
        .usage = wgpu.BufferUsages.uniform | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });
    // Per-instance vertex buffer — packed InstanceData (model + color), step=instance.
    // drawScene writes one record per mesh, grouped by (geom_key, texture); each
    // group issues ONE pass.draw(vert_count, instance_count, ...).
    g_instance_buf = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("render3d_instances"),
        .size = MAX_INSTANCES * @sizeOf(InstanceData),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });
    // Per-frame slim buffer for foliage-card overflow rows (24 B each → ~6.3 MB vs 21 MB).
    g_slim_inst_buf = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("render3d_slim_instances"),
        .size = MAX_INSTANCES * @sizeOf(SlimInstance),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });
    // Placed-light storage buffer (group 0, binding 1). Allocated once at
    // MAX_LIGHTS; collectLights writes the live prefix each frame.
    g_lights_buf = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("render3d_lights"),
        .size = MAX_LIGHTS * @sizeOf(Light),
        .usage = wgpu.BufferUsages.storage | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });
    // ── Shadow resources (group 0, bindings 2–4) ──
    // The shadow map is a sampleable depth texture rendered from the caster's POV;
    // the comparison sampler does hardware PCF; the uniform carries the light VP +
    // gate. Bound on every scene draw so the layout stays uniform across pipelines.
    g_shadow_tex = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("render3d_shadow_map"),
        .size = .{ .width = SHADOW_MAP_SIZE, .height = SHADOW_MAP_SIZE, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = .depth32_float,
        .usage = wgpu.TextureUsages.render_attachment | wgpu.TextureUsages.texture_binding,
    });
    if (g_shadow_tex) |st| {
        g_shadow_view = st.createView(&.{
            .format = .depth32_float,
            .dimension = .@"2d",
            .base_mip_level = 0,
            .mip_level_count = 1,
            .base_array_layer = 0,
            .array_layer_count = 1,
            .aspect = .all,
        });
    }
    g_shadow_sampler = device.createSampler(&.{
        .address_mode_u = .clamp_to_edge,
        .address_mode_v = .clamp_to_edge,
        .mag_filter = .linear,
        .min_filter = .linear,
        .compare = .less, // depth-comparison sampler: passes (1) when frag is closer
    });
    g_shadow_uniform_buf = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("render3d_shadow_uniform"),
        .size = @sizeOf(ShadowUniforms),
        .usage = wgpu.BufferUsages.uniform | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });
    g_shadow_vp_buf = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("render3d_shadow_vp"),
        .size = 16 * @sizeOf(f32),
        .usage = wgpu.BufferUsages.uniform | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });
    g_shadow_inst_buf = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("render3d_shadow_instances"),
        .size = MAX_INSTANCES * @sizeOf(InstanceData),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });
    const scene_bgl_entries = [_]wgpu.BindGroupLayoutEntry{
        .{
            .binding = 0,
            .visibility = wgpu.ShaderStages.vertex | wgpu.ShaderStages.fragment,
            .buffer = .{ .type = .uniform, .has_dynamic_offset = 0, .min_binding_size = @sizeOf(SceneUniforms) },
        },
        .{
            .binding = 1,
            .visibility = wgpu.ShaderStages.fragment,
            .buffer = .{ .type = .read_only_storage, .has_dynamic_offset = 0, .min_binding_size = 0 },
        },
        .{
            .binding = 2,
            .visibility = wgpu.ShaderStages.fragment,
            .buffer = .{ .type = .uniform, .has_dynamic_offset = 0, .min_binding_size = @sizeOf(ShadowUniforms) },
        },
        .{
            .binding = 3,
            .visibility = wgpu.ShaderStages.fragment,
            .texture = .{ .sample_type = .depth, .view_dimension = .@"2d", .multisampled = 0 },
        },
        .{
            .binding = 4,
            .visibility = wgpu.ShaderStages.fragment,
            .sampler = .{ .type = .comparison },
        },
    };
    g_bind_group_layout = device.createBindGroupLayout(&.{
        .entry_count = scene_bgl_entries.len,
        .entries = &scene_bgl_entries,
    }) orelse return;
    const scene_bg_entries = [_]wgpu.BindGroupEntry{
        .{ .binding = 0, .buffer = g_uniform_buffer.?, .offset = 0, .size = @sizeOf(SceneUniforms) },
        .{ .binding = 1, .buffer = g_lights_buf.?, .offset = 0, .size = MAX_LIGHTS * @sizeOf(Light) },
        .{ .binding = 2, .buffer = g_shadow_uniform_buf.?, .offset = 0, .size = @sizeOf(ShadowUniforms) },
        .{ .binding = 3, .texture_view = g_shadow_view.? },
        .{ .binding = 4, .sampler = g_shadow_sampler.? },
    };
    g_bind_group = device.createBindGroup(&.{
        .layout = g_bind_group_layout.?,
        .entry_count = scene_bg_entries.len,
        .entries = &scene_bg_entries,
    });

    // ── Texture bind group layout (group 1) ──
    // Per-mesh diffuse texture + sampler. Each mesh gets its own bind group
    // pointing at that mesh's texture; meshes without a texture point at
    // g_default_tex_bind_group (1×1 white).
    const tex_entries = [_]wgpu.BindGroupLayoutEntry{
        .{
            .binding = 0,
            .visibility = wgpu.ShaderStages.fragment,
            .texture = .{ .sample_type = .float, .view_dimension = .@"2d", .multisampled = 0 },
        },
        .{
            .binding = 1,
            .visibility = wgpu.ShaderStages.fragment,
            // NON-FILTERING to match the nearest diffuse sampler below. Linear
            // sampling averaged each atlas slot's edge texels with the neighbour
            // slot / gutter, drawing thin off-colour SEAM lines at every face
            // boundary and bleeding a neighbour's paint onto a face's corner
            // (the Studio paint seams, req_1321). Nearest samples exactly one
            // texel — no cross-slot blend — and flat paint loses nothing.
            .sampler = .{ .type = .non_filtering },
        },
    };
    g_tex_bind_group_layout = device.createBindGroupLayout(&.{
        .entry_count = tex_entries.len,
        .entries = &tex_entries,
    }) orelse return;

    g_diffuse_sampler = device.createSampler(&.{
        .address_mode_u = .clamp_to_edge,
        .address_mode_v = .clamp_to_edge,
        // NEAREST: no blend across atlas slot boundaries → no seam lines, no
        // neighbour-paint bleed onto a face edge (req_1321). Flat paint + the
        // crisp PSX look mean nearest loses nothing; the matching bind-group
        // layout above is .non_filtering.
        .mag_filter = .nearest,
        .min_filter = .nearest,
    });

    // 1×1 white default texture so untextured meshes sample white →
    // multiply with uniform color → unchanged visual.
    g_default_tex = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("r3d_default_white"),
        .size = .{ .width = 1, .height = 1, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = .rgba8_unorm,
        .usage = wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst,
    });
    if (g_default_tex) |dtex| {
        const white_pixel = [_]u8{ 255, 255, 255, 255 };
        const queue = core.getQueue();
        if (queue) |q| {
            q.writeTexture(
                &.{ .texture = dtex, .mip_level = 0, .origin = .{}, .aspect = .all },
                @ptrCast(&white_pixel),
                white_pixel.len,
                &.{ .offset = 0, .bytes_per_row = 4, .rows_per_image = 1 },
                &.{ .width = 1, .height = 1, .depth_or_array_layers = 1 },
            );
        }
        g_default_tex_view = dtex.createView(&.{
            .format = .rgba8_unorm,
            .dimension = .@"2d",
            .base_mip_level = 0,
            .mip_level_count = 1,
            .base_array_layer = 0,
            .array_layer_count = 1,
            .aspect = .all,
        });
    }
    if (g_default_tex_view != null and g_diffuse_sampler != null) {
        const def_entries = [_]wgpu.BindGroupEntry{
            .{ .binding = 0, .texture_view = g_default_tex_view.? },
            .{ .binding = 1, .sampler = g_diffuse_sampler.? },
        };
        g_default_tex_bind_group = device.createBindGroup(&.{
            .layout = g_tex_bind_group_layout.?,
            .entry_count = def_entries.len,
            .entries = &def_entries,
        });
    }

    // ── Ground-formula group(1): one read-only storage buffer (the D ref stream).
    //    The pool of buffers + their bind groups is created up front; the PIPELINE
    //    is built lazily (ensureGroundPipeline) once a formula arrives. ──
    g_ground_bgl = device.createBindGroupLayout(&.{
        .entry_count = 1,
        .entries = @ptrCast(&wgpu.BindGroupLayoutEntry{
            .binding = 0,
            .visibility = wgpu.ShaderStages.vertex | wgpu.ShaderStages.fragment,
            .buffer = .{ .type = .read_only_storage, .has_dynamic_offset = 0, .min_binding_size = 0 },
        }),
    }) orelse return;
    {
        var gi: usize = 0;
        while (gi < GROUND_POOL) : (gi += 1) {
            const buf = device.createBuffer(&.{
                .label = wgpu.StringView.fromSlice("r3d_ground_data"),
                .size = GROUND_DATA_FLOATS * @sizeOf(f32),
                .usage = wgpu.BufferUsages.storage | wgpu.BufferUsages.copy_dst,
                .mapped_at_creation = 0,
            });
            g_ground_data_buf[gi] = buf;
            if (buf) |b| {
                g_ground_data_bg[gi] = device.createBindGroup(&.{
                    .layout = g_ground_bgl.?,
                    .entry_count = 1,
                    .entries = @ptrCast(&wgpu.BindGroupEntry{
                        .binding = 0,
                        .buffer = b,
                        .offset = 0,
                        .size = GROUND_DATA_FLOATS * @sizeOf(f32),
                    }),
                });
            }
        }
    }
    // The ground pass's own instance buffer — one InstanceData per drawn chunk, so the
    // ground never competes with foliage for the shared per-frame g_instance_buf (req_1659).
    g_ground_inst_buf = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("r3d_ground_instances"),
        .size = GROUND_POOL * @sizeOf(InstanceData),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });
    initGroundGridTopology(device);
    g_ground_data_ptr = @splat(0);
    g_ground_data_version = @splat(0);
    g_ground_data_len = @splat(0);

    const layouts = [_]?*wgpu.BindGroupLayout{ g_bind_group_layout.?, g_tex_bind_group_layout.? };
    const pipeline_layout = device.createPipelineLayout(&.{
        .bind_group_layout_count = layouts.len,
        .bind_group_layouts = @ptrCast(&layouts),
    }) orelse return;
    defer pipeline_layout.release();
    // Per-vertex attributes (vertex buffer 0, step=vertex) — position/normal/uv.
    const vert_attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x3, .offset = 0, .shader_location = 0 },
        .{ .format = .snorm16x2, .offset = 12, .shader_location = 1 }, // oct normal
        .{ .format = .float16x2, .offset = 16, .shader_location = 2 }, // uv
    };
    // Per-instance attributes (vertex buffer 1, step=instance) — packed TRS+rgba
    // (32-byte InstanceData): pos f32x3 @3, euler u16x4 @4, scale f16x4 @5, rgba
    // unorm8x4 @6. The shaders rebuild the model matrix from these.
    const inst_attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x3, .offset = 0, .shader_location = 3 },
        .{ .format = .uint16x4, .offset = 12, .shader_location = 4 },
        .{ .format = .float16x4, .offset = 20, .shader_location = 5 },
        .{ .format = .unorm8x4, .offset = 28, .shader_location = 6 },
    };
    const vert_layouts = [_]wgpu.VertexBufferLayout{
        .{ .step_mode = .vertex, .array_stride = @sizeOf(Vertex), .attribute_count = vert_attrs.len, .attributes = &vert_attrs },
        .{ .step_mode = .instance, .array_stride = @sizeOf(InstanceData), .attribute_count = inst_attrs.len, .attributes = &inst_attrs },
    };
    // Slim per-instance attributes for the FROND pipeline ONLY — the 24-byte
    // SlimInstance (pos f32x3 @3, pitch/yaw u16x2 @4, wide/len unorm16x2 @5, rgb
    // unorm8x4 @6). frond_wgsl rebuilds the model matrix from these. Same per-vertex
    // layout as everyone (vbuf 0), different instance buffer + stride (vbuf 1).
    const slim_inst_attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x3, .offset = 0, .shader_location = 3 },
        .{ .format = .uint16x2, .offset = 12, .shader_location = 4 },
        .{ .format = .unorm16x2, .offset = 16, .shader_location = 5 },
        .{ .format = .unorm8x4, .offset = 20, .shader_location = 6 },
    };
    const slim_vert_layouts = [_]wgpu.VertexBufferLayout{
        .{ .step_mode = .vertex, .array_stride = @sizeOf(Vertex), .attribute_count = vert_attrs.len, .attributes = &vert_attrs },
        .{ .step_mode = .instance, .array_stride = @sizeOf(SlimInstance), .attribute_count = slim_inst_attrs.len, .attributes = &slim_inst_attrs },
    };
    const color_target = wgpu.ColorTargetState{
        .format = .rgba8_unorm,
        .blend = &wgpu.BlendState.premultiplied_alpha_blending,
        .write_mask = wgpu.ColorWriteMasks.all,
    };
    const frag = wgpu.FragmentState{
        .module = shader_module,
        .entry_point = wgpu.StringView.fromSlice("fs_main"),
        .target_count = 1,
        .targets = @ptrCast(&color_target),
    };
    const depth_stencil = wgpu.DepthStencilState{
        .format = .depth24_plus,
        .depth_write_enabled = .true,
        .depth_compare = .less,
        .stencil_front = .{},
        .stencil_back = .{},
    };
    g_pipeline = device.createRenderPipeline(&.{
        .layout = pipeline_layout,
        .vertex = .{ .module = shader_module, .entry_point = wgpu.StringView.fromSlice("vs_main"), .buffer_count = vert_layouts.len, .buffers = &vert_layouts },
        .primitive = .{ .topology = .triangle_list, .cull_mode = .back, .front_face = .ccw },
        .depth_stencil = &depth_stencil,
        .multisample = .{},
        .fragment = &frag,
    });
    // Transparent companion: identical layout/shader/blend, depth-test on but
    // depth-write OFF, so translucent meshes drawn after the opaque batch read
    // the depth buffer (hidden behind walls) without writing it (no self-occlusion
    // between panes). `less_equal` lets intentional coplanar overlays (painted
    // stencil over the face's underlay material) draw on top of the base face.
    // Reuses pipeline_layout/shader_module/frag, which the createRenderPipeline
    // calls retain — both stay valid until this fn's deferred releases fire.
    const depth_stencil_transparent = wgpu.DepthStencilState{
        .format = .depth24_plus,
        .depth_write_enabled = .false,
        .depth_compare = .less_equal,
        .stencil_front = .{},
        .stencil_back = .{},
    };
    g_pipeline_transparent = device.createRenderPipeline(&.{
        .layout = pipeline_layout,
        .vertex = .{ .module = shader_module, .entry_point = wgpu.StringView.fromSlice("vs_main"), .buffer_count = vert_layouts.len, .buffers = &vert_layouts },
        .primitive = .{ .topology = .triangle_list, .cull_mode = .back, .front_face = .ccw },
        .depth_stencil = &depth_stencil_transparent,
        .multisample = .{},
        .fragment = &frag,
    });

    // ── Shadow depth pipeline (renders geometry from a light's POV, depth only) ──
    // Reuses vert_layouts (same vbuf0 verts + vbuf1 packed InstanceData), so the
    // caster instances staged for shadows replay through the exact vertex path. Its
    // own group0 = just the light VP. No fragment / no color target (depth-only).
    const shadow_bgl_entry = wgpu.BindGroupLayoutEntry{
        .binding = 0,
        .visibility = wgpu.ShaderStages.vertex,
        .buffer = .{ .type = .uniform, .has_dynamic_offset = 0, .min_binding_size = 16 * @sizeOf(f32) },
    };
    const shadow_bgl = device.createBindGroupLayout(&.{
        .entry_count = 1,
        .entries = @ptrCast(&shadow_bgl_entry),
    });
    if (shadow_bgl) |sbgl| {
        g_shadow_pass_bind_group = device.createBindGroup(&.{
            .layout = sbgl,
            .entry_count = 1,
            .entries = @ptrCast(&wgpu.BindGroupEntry{ .binding = 0, .buffer = g_shadow_vp_buf.?, .offset = 0, .size = 16 * @sizeOf(f32) }),
        });
        const shadow_layouts = [_]?*wgpu.BindGroupLayout{sbgl};
        const shadow_pl = device.createPipelineLayout(&.{
            .bind_group_layout_count = shadow_layouts.len,
            .bind_group_layouts = @ptrCast(&shadow_layouts),
        });
        const shadow_desc = wgpu.shaderModuleWGSLDescriptor(.{ .label = "shadow_depth_shader", .code = shaders.shadow_depth_wgsl });
        const shadow_module = device.createShaderModule(&shadow_desc);
        const shadow_depth_stencil = wgpu.DepthStencilState{
            .format = .depth32_float,
            .depth_write_enabled = .true,
            .depth_compare = .less,
            .stencil_front = .{},
            .stencil_back = .{},
        };
        if (shadow_pl != null and shadow_module != null) {
            g_shadow_pipeline = device.createRenderPipeline(&.{
                .layout = shadow_pl.?,
                .vertex = .{ .module = shadow_module.?, .entry_point = wgpu.StringView.fromSlice("vs_main"), .buffer_count = vert_layouts.len, .buffers = &vert_layouts },
                .primitive = .{ .topology = .triangle_list, .cull_mode = .back, .front_face = .ccw },
                .depth_stencil = &shadow_depth_stencil,
                .multisample = .{},
            });
        }
        if (shadow_module) |sm| sm.release();
        if (shadow_pl) |spl| spl.release();
        sbgl.release();
    }
    // Grass companion: same layout/vertex/blend as g_pipeline, depth-write ON (the
    // blade is alpha-TESTED via discard in the shader, so it's opaque), only the
    // module differs — wind + procedural wisp cutout + root→tip gradient. The
    // createRenderPipeline call retains the module, so we release it right after.
    {
        const grass_desc = wgpu.shaderModuleWGSLDescriptor(.{ .label = "render3d_grass_shader", .code = shaders.grass_wgsl });
        if (device.createShaderModule(&grass_desc)) |grass_module| {
            const grass_frag = wgpu.FragmentState{
                .module = grass_module,
                .entry_point = wgpu.StringView.fromSlice("fs_main"),
                .target_count = 1,
                .targets = @ptrCast(&color_target),
            };
            g_grass_pipeline = device.createRenderPipeline(&.{
                .layout = pipeline_layout,
                .vertex = .{ .module = grass_module, .entry_point = wgpu.StringView.fromSlice("vs_main"), .buffer_count = slim_vert_layouts.len, .buffers = &slim_vert_layouts },
                .primitive = .{ .topology = .triangle_list, .cull_mode = .back, .front_face = .ccw },
                .depth_stencil = &depth_stencil,
                .multisample = .{},
                .fragment = &grass_frag,
            });
            grass_module.release();
        }
    }
    // Water companion: same layout/vertex/blend, depth-write ON (alpha-hashed via
    // discard → opaque), cull OFF so wave troughs/edges never drop out. Only the
    // module differs — FBM waves + deep/shallow/foam/Bayer-dither.
    {
        const water_desc = wgpu.shaderModuleWGSLDescriptor(.{ .label = "render3d_water_shader", .code = shaders.water_wgsl });
        if (device.createShaderModule(&water_desc)) |water_module| {
            const water_frag = wgpu.FragmentState{
                .module = water_module,
                .entry_point = wgpu.StringView.fromSlice("fs_main"),
                .target_count = 1,
                .targets = @ptrCast(&color_target),
            };
            g_water_pipeline = device.createRenderPipeline(&.{
                .layout = pipeline_layout,
                .vertex = .{ .module = water_module, .entry_point = wgpu.StringView.fromSlice("vs_main"), .buffer_count = vert_layouts.len, .buffers = &vert_layouts },
                .primitive = .{ .topology = .triangle_list, .cull_mode = .none, .front_face = .ccw },
                .depth_stencil = &depth_stencil,
                .multisample = .{},
                .fragment = &water_frag,
            });
            water_module.release();
        }
    }
    // Frond companion: same layout/vertex/blend, depth-write ON (alpha-tested via
    // discard → opaque), cull OFF so a wind-bent frond reads from both faces. Only
    // the module differs — wind sway + palm/leaf cutout + green gradient.
    {
        const frond_desc = wgpu.shaderModuleWGSLDescriptor(.{ .label = "render3d_frond_shader", .code = shaders.frond_wgsl });
        if (device.createShaderModule(&frond_desc)) |frond_module| {
            const frond_frag = wgpu.FragmentState{
                .module = frond_module,
                .entry_point = wgpu.StringView.fromSlice("fs_main"),
                .target_count = 1,
                .targets = @ptrCast(&color_target),
            };
            g_frond_pipeline = device.createRenderPipeline(&.{
                .layout = pipeline_layout,
                .vertex = .{ .module = frond_module, .entry_point = wgpu.StringView.fromSlice("vs_main"), .buffer_count = slim_vert_layouts.len, .buffers = &slim_vert_layouts },
                .primitive = .{ .topology = .triangle_list, .cull_mode = .none, .front_face = .ccw },
                .depth_stencil = &depth_stencil,
                .multisample = .{},
                .fragment = &frond_frag,
            });
            frond_module.release();
        }
    }
    g_sampler = device.createSampler(&.{
        .address_mode_u = .clamp_to_edge,
        .address_mode_v = .clamp_to_edge,
        .mag_filter = .linear,
        .min_filter = .linear,
    });

    // ── Skybox pipeline ──
    // One uniform buffer (group 0), a fullscreen triangle generated from
    // @builtin(vertex_index) (no vertex buffer), no culling, and depth
    // compare = always with depth-write off so the sky never occludes the
    // meshes drawn after it. Same rgba8 color target as the mesh pipeline.
    const sky_desc = wgpu.shaderModuleWGSLDescriptor(.{ .label = "skybox_shader", .code = shaders.skybox_wgsl });
    const sky_shader = device.createShaderModule(&sky_desc);
    if (sky_shader) |sky_mod| {
        defer sky_mod.release();
        g_sky_uniform_buffer = device.createBuffer(&.{
            .label = wgpu.StringView.fromSlice("skybox_uniforms"),
            .size = @sizeOf(SkyUniforms),
            .usage = wgpu.BufferUsages.uniform | wgpu.BufferUsages.copy_dst,
            .mapped_at_creation = 0,
        });
        g_sky_bind_group_layout = device.createBindGroupLayout(&.{
            .entry_count = 1,
            .entries = @ptrCast(&wgpu.BindGroupLayoutEntry{
                .binding = 0,
                .visibility = wgpu.ShaderStages.vertex | wgpu.ShaderStages.fragment,
                .buffer = .{ .type = .uniform, .has_dynamic_offset = 0, .min_binding_size = @sizeOf(SkyUniforms) },
            }),
        });
        if (g_sky_bind_group_layout != null and g_sky_uniform_buffer != null) {
            g_sky_bind_group = device.createBindGroup(&.{
                .layout = g_sky_bind_group_layout.?,
                .entry_count = 1,
                .entries = @ptrCast(&wgpu.BindGroupEntry{
                    .binding = 0,
                    .buffer = g_sky_uniform_buffer.?,
                    .offset = 0,
                    .size = @sizeOf(SkyUniforms),
                }),
            });
            const sky_layout = [_]?*wgpu.BindGroupLayout{g_sky_bind_group_layout.?};
            const sky_pipeline_layout = device.createPipelineLayout(&.{
                .bind_group_layout_count = sky_layout.len,
                .bind_group_layouts = @ptrCast(&sky_layout),
            });
            if (sky_pipeline_layout) |spl| {
                defer spl.release();
                const sky_color_target = wgpu.ColorTargetState{
                    .format = .rgba8_unorm,
                    .blend = &wgpu.BlendState.premultiplied_alpha_blending,
                    .write_mask = wgpu.ColorWriteMasks.all,
                };
                const sky_frag = wgpu.FragmentState{
                    .module = sky_mod,
                    .entry_point = wgpu.StringView.fromSlice("sky_fs"),
                    .target_count = 1,
                    .targets = @ptrCast(&sky_color_target),
                };
                const sky_depth = wgpu.DepthStencilState{
                    .format = .depth24_plus,
                    .depth_write_enabled = .false,
                    .depth_compare = .always,
                    .stencil_front = .{},
                    .stencil_back = .{},
                };
                g_sky_pipeline = device.createRenderPipeline(&.{
                    .layout = spl,
                    .vertex = .{ .module = sky_mod, .entry_point = wgpu.StringView.fromSlice("sky_vs"), .buffer_count = 0 },
                    .primitive = .{ .topology = .triangle_list, .cull_mode = .none, .front_face = .ccw },
                    .depth_stencil = &sky_depth,
                    .multisample = .{},
                    .fragment = &sky_frag,
                });
            }
        }
    }

    g_initialized = g_pipeline != null;
}

pub fn getTexBindGroupLayout() ?*wgpu.BindGroupLayout {
    return g_tex_bind_group_layout;
}

/// The NEAREST, non-filtering diffuse sampler. Any bind group built against
/// getTexBindGroupLayout() MUST bind this (the layout is .non_filtering, so a
/// filtering sampler is a validation error — req_1321). StaticSurface-textured
/// meshes use it so the paint atlas samples crisply with no cross-slot seams.
pub fn getDiffuseSampler() ?*wgpu.Sampler {
    return g_diffuse_sampler;
}

pub fn deinit() void {
    // Release every pool slot's resources.
    for (0..MAX_RT_POOL) |i| {
        const slot = &g_rt_pool[i];
        if (slot.composite_bind_group) |bg| bg.release();
        if (slot.depth_view) |v| v.release();
        if (slot.depth_texture) |t| t.destroy();
        if (slot.color_view) |v| v.release();
        if (slot.color_texture) |t| t.destroy();
        slot.* = .{};
    }
    g_rt_cursor = 0;
    for (&g_tex_cache) |*e| dropTexEntry(e);
    if (g_sampler) |s| s.release();
    if (g_default_tex_bind_group) |bg| bg.release();
    if (g_default_tex_view) |v| v.release();
    if (g_default_tex) |t| t.destroy();
    if (g_diffuse_sampler) |s| s.release();
    if (g_tex_bind_group_layout) |l| l.release();
    if (g_bind_group) |bg| bg.release();
    if (g_bind_group_layout) |l| l.release();
    if (g_uniform_buffer) |b| b.release();
    if (g_lights_buf) |b| b.release();
    if (g_shadow_view) |v| v.release();
    if (g_shadow_tex) |t| t.release();
    if (g_shadow_sampler) |s| s.release();
    if (g_shadow_uniform_buf) |b| b.release();
    if (g_shadow_vp_buf) |b| b.release();
    if (g_shadow_inst_buf) |b| b.release();
    if (g_shadow_pipeline) |p| p.release();
    if (g_shadow_pass_bind_group) |bg| bg.release();
    if (g_instance_buf) |b| b.release();
    if (g_slim_inst_buf) |b| b.release();
    if (g_slim_static_buf) |b| b.release();
    if (g_ground_inst_buf) |b| b.release();
    if (g_ground_grid_vbuf) |b| b.release();
    for (0..GROUND_POOL) |i| {
        if (g_ground_data_bg[i]) |bg| bg.release();
        if (g_ground_data_buf[i]) |b| b.release();
        g_ground_data_bg[i] = null;
        g_ground_data_buf[i] = null;
    }
    if (g_ground_pipeline) |p| p.release();
    if (g_ground_bgl) |l| l.release();
    g_ground_pipeline = null;
    g_ground_bgl = null;
    g_ground_grid_vbuf = null;
    g_ground_grid_vert_count = 0;
    if (g_vertex_buffer) |b| b.release();
    if (g_pipeline) |p| p.release();
    if (g_grass_pipeline) |p| p.release();
    if (g_water_pipeline) |p| p.release();
    if (g_frond_pipeline) |p| p.release();
    if (g_sky_bind_group) |bg| bg.release();
    if (g_sky_bind_group_layout) |l| l.release();
    if (g_sky_uniform_buffer) |b| b.release();
    if (g_sky_pipeline) |p| p.release();
    g_initialized = false;
}

/// Reset the per-frame RT cursor so the next frame reuses pool slots from
/// the top. Slots themselves stay alive across frames — only resized when
/// a tile changes dimensions. Must be called AFTER images.drawAll() so the
/// previous frame's quads have all been sampled.
pub fn frameCleanup() void {
    g_rt_cursor = 0;
}

/// Drop every retained-geometry registration so the next bundle re-interns
/// from scratch. The dev hot-reload path calls this while tearing down the
/// tree: the JS world re-evals in a fresh V8 context, so its ship-once-per-key
/// set (runtime/geometries/intern.ts) resets and every first-per-key mesh
/// re-ships its verts. The HOST intern caches, by contrast, are append-only
/// bump allocators that NEVER evict (g_retained_top / g_static_inst_top) and
/// persist across the reload — so without this reset they accumulate dead
/// geometry from every prior map version across edit→reload cycles until they
/// hit GEO_CACHE_SIZE / MAX_RETAINED_VERTS. Past that point internGeometry
/// returns null and pass 1 SILENTLY DROPS the mesh, and because the shared Box
/// geometry (the grid AND every building bucket) interns late in the fill
/// order, every building + the grid vanish while props survive (req_0725/0727,
/// reproduced as "turn the camera after a reload and the world disappears").
/// Resetting the bump cursors here makes the re-shipped verts repopulate a
/// clean cache, so geometry survives the reload exactly like a fresh boot.
/// The GPU buffer memory is reused in place (cursors rewind to 0); no GPU
/// resource is freed. The per-frame dynamic instance staging buffer and the
/// content-hashed FIFO texture cache are NOT touched — they self-evict and
/// never overflow-to-drop.
pub fn resetForReload() void {
    g_geo_cache_len = 0;
    g_retained_top = 0;
    for (&g_geo_cache) |*e| e.* = .{};
    g_static_inst_cache_len = 0;
    g_static_inst_top = 0;
    for (&g_static_inst_cache) |*e| e.* = .{};
    g_slim_static_cache_len = 0;
    g_slim_static_top = 0;
    for (&g_slim_static_cache) |*e| e.* = .{};
    g_dyn_len = 0;
    g_dyn_bump_verts = 0;
    g_dyn_warned = false;
    g_static_retain_warned = false;
    g_frame_pool_warned = false;
    for (&g_dyn_slots) |*s| s.* = .{};
    // Ground D buffers persist across reload just like retained geometry. New
    // runtime allocations may reuse an old pointer/version/length tuple, so the
    // upload memo must not let stale material or height data survive remount.
    g_ground_data_ptr = @splat(0);
    g_ground_data_version = @splat(0);
    g_ground_data_len = @splat(0);
    // The geo cache (above) was cleared, so any stashed-but-not-yet-interned host
    // mesh would re-intern fine — but free the host copies so a reload doesn't leak
    // them, and so a re-drop re-parses cleanly.
    for (&g_host_stash) |*s| {
        if (s.verts) |old| std.heap.c_allocator.free(old);
        s.* = .{};
    }
    // The texture hash memo keys on buffer POINTERS; a reload frees + recycles
    // those addresses, so a stale (ptr,len) could collide with a new buffer. Clear
    // it (the fingerprint guards the rare same-address+len case, but a clean memo
    // is free and removes all doubt — every texture just re-walks once).
    for (&g_tex_hash_memo) |*e| e.* = .{};
    // The mesh-editor SESSION survives the reload (req_2913 — this line was the bug
    // that broke the req_2898 resume: clearActiveEditMesh() here wiped g_edit_key,
    // so the remounted viewer's session readback came back empty and it fell back
    // to re-loading seed geometry over your edits). The session's CPU copy
    // (g_edit_verts, duped by setPaintTarget) is the durable truth: the GPU intern
    // + the consumed stash copy died with the cache clears above, so RE-STASH it —
    // the first post-reload draw re-interns it into the fresh cache exactly like a
    // fresh load. Selection (mesh_edit), journal, paint atlas, and orbit were never
    // cleared here and keep surviving untouched.
    if (g_edit_key) |key| {
        if (g_edit_verts) |verts| _ = stashHostMesh(key, verts, g_edit_count);
    }
}

/// Acquire the next RT slot for this frame. Returns null on pool exhaustion
/// or device failure. Slots are reused across frames; resized lazily when
/// a tile's dimensions change.
fn acquireRt(w: u32, h: u32) ?*Rt {
    if (w == 0 or h == 0) return null;
    if (g_rt_cursor >= MAX_RT_POOL) {
        if (!g_rt_pool_warned) {
            g_rt_pool_warned = true;
            log.print("[r3d-rt] RT POOL EXHAUSTED: >{d} Scene3D views in one frame — views past the cap (incl. the build pane if painted last) get no render target and stay blank.\n", .{MAX_RT_POOL});
        }
        return null;
    }
    const slot = &g_rt_pool[g_rt_cursor];
    g_rt_cursor += 1;
    const rt = ensureRt(slot, w, h);
    if (rt == null and !g_rt_alloc_warned) {
        g_rt_alloc_warned = true;
        log.print("[r3d-rt] RT TEXTURE ALLOC FAILED at {d}x{d} — GPU could not create the render target (out of memory from this map's capture surfaces/geometry?). That view stays blank.\n", .{ w, h });
    }
    return rt;
}

/// (Re)build a render-target slot at the given size — shared by the per-frame
/// pool (acquireRt) and detached targets (WORLDWIN-0611). No-op when the slot
/// already matches.
fn ensureRt(slot: *Rt, w: u32, h: u32) ?*Rt {
    if (slot.width == w and slot.height == h and slot.color_view != null) return slot;

    const device = core.getDevice() orelse return null;

    // Drop the slot's previous resources. Frame loop is serial — by the
    // time we recycle a slot across frames, the prior frame's quads have
    // already been drawn and the bind group is no longer in flight.
    if (slot.composite_bind_group) |bg| bg.release();
    if (slot.depth_view) |v| v.release();
    if (slot.depth_texture) |t| t.destroy();
    if (slot.color_view) |v| v.release();
    if (slot.color_texture) |t| t.destroy();
    slot.* = .{};

    slot.color_texture = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("r3d_color"),
        .size = .{ .width = w, .height = h, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = .rgba8_unorm,
        .usage = wgpu.TextureUsages.render_attachment | wgpu.TextureUsages.texture_binding,
    }) orelse return null;
    slot.color_view = slot.color_texture.?.createView(&.{
        .format = .rgba8_unorm,
        .dimension = .@"2d",
        .base_mip_level = 0,
        .mip_level_count = 1,
        .base_array_layer = 0,
        .array_layer_count = 1,
        .aspect = .all,
    }) orelse return null;
    slot.depth_texture = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("r3d_depth"),
        .size = .{ .width = w, .height = h, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = .depth24_plus,
        .usage = wgpu.TextureUsages.render_attachment,
    }) orelse return null;
    slot.depth_view = slot.depth_texture.?.createView(&.{
        .format = .depth24_plus,
        .dimension = .@"2d",
        .base_mip_level = 0,
        .mip_level_count = 1,
        .base_array_layer = 0,
        .array_layer_count = 1,
        .aspect = .all,
    }) orelse return null;
    if (g_sampler) |sampler| slot.composite_bind_group = images.createBindGroup(slot.color_view.?, sampler);
    slot.width = w;
    slot.height = h;
    return slot;
}

fn max3(a: f32, b: f32, c: f32) f32 {
    return @max(a, @max(b, c));
}

fn estimateMeshRadius(node: *const Node) f32 {
    const sx = @abs(node.scene3d_scale_x);
    const sy = @abs(node.scene3d_scale_y);
    const sz = @abs(node.scene3d_scale_z);
    // The generator ships its own unscaled bounds — cull off that × max scale. No
    // per-shape switch; this is what lets the framework cull a shape it knows
    // nothing about. A node without bounds (broken legacy mesh) culls as ~unit.
    if (node.scene3d_bounds_radius > 0) {
        return node.scene3d_bounds_radius * max3(sx, sy, sz);
    }
    return max3(sx, sy, sz);
}

// ════════════════════════════════════════════════════════════════════════
// Per-mesh diffuse texture cache.
//
// v8_app.zig allocates a fresh RGBA byte buffer on every prop commit, so
// caching by pointer would miss every render. Instead the cache keys on a
// content hash of (w, h, bytes); identical textures across renders or
// across multiple meshes collapse to a single uploaded GPU texture.
//
// Eviction: FIFO when full. Cap is small because the moonshot expects
// only a handful of distinct face textures live at once.
// ════════════════════════════════════════════════════════════════════════

// Was 16 with FIFO eviction (req_1739): a detailed painted world (CookedProp ships
// each painted mesh a 512² = 1 MB inline atlas) has far more than 16 distinct
// textures in view at once, so the FIFO thrashed — every frame it evicted, then
// re-created + re-uploaded 1 MB textures for the ones it had just dropped. 256 slots
// with LRU (touch-on-hit) keeps a cityful of cooked-prop atlases resident.
const TEX_CACHE_SIZE = 256;
const TexEntry = struct {
    hash: u64 = 0,
    w: u32 = 0,
    h: u32 = 0,
    lru: u64 = 0, // last g_tex_lru_clock tick this entry was used (LRU eviction)
    tex: ?*wgpu.Texture = null,
    view: ?*wgpu.TextureView = null,
    bind_group: ?*wgpu.BindGroup = null,
};
var g_tex_cache: [TEX_CACHE_SIZE]TexEntry = [_]TexEntry{.{}} ** TEX_CACHE_SIZE;
var g_tex_lru_clock: u64 = 0;

fn hashTex(w: u32, h: u32, data: []const u8) u64 {
    var h64: u64 = 0xcbf29ce484222325;
    h64 ^= @as(u64, w);
    h64 *%= 0x100000001b3;
    h64 ^= @as(u64, h);
    h64 *%= 0x100000001b3;
    for (data) |byte| {
        h64 ^= byte;
        h64 *%= 0x100000001b3;
    }
    return h64;
}

// Cheap O(1) content fingerprint: w, h, len + a sparse strided byte sample. Used to
// detect when a recycled buffer POINTER secretly carries new content, so the hash
// memo below never returns a stale hash for it.
fn texFingerprint(w: u32, h: u32, data: []const u8) u64 {
    var f: u64 = 0xcbf29ce484222325;
    f ^= @as(u64, w);
    f *%= 0x100000001b3;
    f ^= @as(u64, h);
    f *%= 0x100000001b3;
    f ^= @as(u64, data.len);
    f *%= 0x100000001b3;
    // 512 spread samples (was 32): the fingerprint is now strong enough to serve
    // as the memo's content identity (see memoHashTex) — two distinct painted
    // atlases aliasing on 512 spread bytes + w + h + len is negligible, while the
    // walk stays ~512 iters regardless of atlas size (cheap for a 4 MB texture).
    const step: usize = @max(1, data.len / 512);
    var i: usize = 0;
    while (i < data.len) : (i += step) {
        f ^= data[i];
        f *%= 0x100000001b3;
    }
    return f;
}

// Per-frame hash memo (req_1739) — THE 4 fps fix. The texture cache is content-hash
// keyed, but hashTex walks the WHOLE atlas (1 MB+ for a 512² CookedProp) every call.
// drawScene calls getOrCreateTexBindGroup once per textured mesh PER FRAME, so a
// detailed painted storefront re-hashed tens of MB every frame on the CPU inside
// gpu.frame() — flat 4 fps with the GPU idle (present ~30 µs). This direct-mapped
// memo returns the already-computed FNV hash for a (ptr,len,fingerprint) we've walked
// before, so a stable buffer is hashed ONCE, not once per frame. A pointer reused for
// new content has a different fingerprint → miss → re-walk (correct). A buffer that
// genuinely changes every frame degrades to the old behaviour, never worse.
const TEX_HASH_MEMO_LEN = 1024;
const TexHashMemo = struct { ptr: usize = 0, len: usize = 0, fp: u64 = 0, hash: u64 = 0, used: bool = false };
var g_tex_hash_memo: [TEX_HASH_MEMO_LEN]TexHashMemo = [_]TexHashMemo{.{}} ** TEX_HASH_MEMO_LEN;

fn memoHashTex(w: u32, h: u32, data: []const u8, fp: u64) u64 {
    // Key the memo by CONTENT (fingerprint), not by buffer pointer (req_1840).
    // The V8 bridge can hand back a NEW pointer every frame for an unchanged
    // texture (observed on macOS: ~29 stable 1024² atlases re-marshaled per
    // frame), which made the old (ptr,len,fp) memo miss every frame and re-walk
    // ~116 MB of FNV — a flat ~88 ms inside gpu.frame(). Fingerprint keying hits
    // whenever the content matches, regardless of pointer churn. The memo only
    // ever holds the handful of inline-RGBA (key-less) atlases, so the
    // direct-mapped table doesn't collide in practice.
    const idx: usize = @intCast(fp % TEX_HASH_MEMO_LEN);
    const e = &g_tex_hash_memo[idx];
    if (e.used and e.fp == fp and e.len == data.len) return e.hash;
    const hash = hashTex(w, h, data); // the full walk — only on a memo miss
    e.* = .{ .ptr = @intFromPtr(data.ptr), .len = data.len, .fp = fp, .hash = hash, .used = true };
    return hash;
}

fn dropTexEntry(e: *TexEntry) void {
    if (e.bind_group) |bg| bg.release();
    if (e.view) |v| v.release();
    if (e.tex) |t| t.destroy();
    e.* = .{};
}

fn getOrCreateTexBindGroup(rgba: []const u8, w: u32, h: u32) ?*wgpu.BindGroup {
    if (w == 0 or h == 0) return null;
    if (rgba.len != @as(usize, w) * @as(usize, h) * 4) return null;
    const fp = texFingerprint(w, h, rgba);
    const hash = memoHashTex(w, h, rgba, fp);

    g_tex_lru_clock +%= 1;
    for (&g_tex_cache) |*e| {
        if (e.bind_group != null and e.hash == hash and e.w == w and e.h == h) {
            e.lru = g_tex_lru_clock;
            return e.bind_group;
        }
    }

    // Miss: take a free slot, else evict the least-recently-used entry.
    var slot: *TexEntry = &g_tex_cache[0];
    var found: bool = false;
    for (&g_tex_cache) |*e| {
        if (e.bind_group == null) {
            slot = e;
            found = true;
            break;
        }
    }
    if (!found) {
        var oldest: u64 = std.math.maxInt(u64);
        for (&g_tex_cache) |*e| {
            if (e.lru < oldest) {
                oldest = e.lru;
                slot = e;
            }
        }
        dropTexEntry(slot);
    }

    const device = core.getDevice() orelse return null;
    const queue = core.getQueue() orelse return null;
    const tex = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("r3d_diffuse"),
        .size = .{ .width = w, .height = h, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = .rgba8_unorm,
        .usage = wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst,
    }) orelse return null;
    queue.writeTexture(
        &.{ .texture = tex, .mip_level = 0, .origin = .{}, .aspect = .all },
        @ptrCast(rgba.ptr),
        rgba.len,
        &.{ .offset = 0, .bytes_per_row = w * 4, .rows_per_image = h },
        &.{ .width = w, .height = h, .depth_or_array_layers = 1 },
    );
    const view = tex.createView(&.{
        .format = .rgba8_unorm,
        .dimension = .@"2d",
        .base_mip_level = 0,
        .mip_level_count = 1,
        .base_array_layer = 0,
        .array_layer_count = 1,
        .aspect = .all,
    }) orelse {
        tex.destroy();
        return null;
    };
    const sampler = g_diffuse_sampler orelse {
        view.release();
        tex.destroy();
        return null;
    };
    const layout_ = g_tex_bind_group_layout orelse {
        view.release();
        tex.destroy();
        return null;
    };
    const entries = [_]wgpu.BindGroupEntry{
        .{ .binding = 0, .texture_view = view },
        .{ .binding = 1, .sampler = sampler },
    };
    const bg = device.createBindGroup(&.{
        .layout = layout_,
        .entry_count = entries.len,
        .entries = &entries,
    }) orelse {
        view.release();
        tex.destroy();
        return null;
    };
    slot.* = .{ .hash = hash, .w = w, .h = h, .lru = g_tex_lru_clock, .tex = tex, .view = view, .bind_group = bg };
    return bg;
}

// ── Paint target's own texture (in-place updated) ───────────────────────────────
// The paint atlas is MUTATED every stroke, so it must NOT ride the content-hash cache
// above: texFingerprint samples only ~512 spread bytes, so a single-face change usually
// leaves the hash unchanged and the STALE texture is returned — the paint only appears
// after enough strokes flip a sampled byte (the "threshold"/delayed-apply bug). Instead
// one persistent texture, re-uploaded in place only when model_paint.version() advances.
var g_paint_tex: ?*wgpu.Texture = null;
var g_paint_view: ?*wgpu.TextureView = null;
var g_paint_bg: ?*wgpu.BindGroup = null;
var g_paint_tex_w: u32 = 0;
var g_paint_tex_h: u32 = 0;

fn paintBindGroup() ?*wgpu.BindGroup {
    const a = model_paint.atlas() orelse return null;
    const device = core.getDevice() orelse return null;
    const queue = core.getQueue() orelse return null;
    var recreated = false;
    if (g_paint_tex == null or g_paint_tex_w != a.w or g_paint_tex_h != a.h) {
        recreated = true;
        if (g_paint_bg) |bg| bg.release();
        if (g_paint_view) |v| v.release();
        if (g_paint_tex) |t| t.destroy();
        g_paint_bg = null;
        g_paint_view = null;
        g_paint_tex = null;
        const tex = device.createTexture(&.{
            .label = wgpu.StringView.fromSlice("r3d_paint"),
            .size = .{ .width = a.w, .height = a.h, .depth_or_array_layers = 1 },
            .mip_level_count = 1,
            .sample_count = 1,
            .dimension = .@"2d",
            .format = .rgba8_unorm,
            .usage = wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst,
        }) orelse return null;
        const view = tex.createView(&.{
            .format = .rgba8_unorm,
            .dimension = .@"2d",
            .base_mip_level = 0,
            .mip_level_count = 1,
            .base_array_layer = 0,
            .array_layer_count = 1,
            .aspect = .all,
        }) orelse {
            tex.destroy();
            return null;
        };
        const sampler = g_diffuse_sampler orelse {
            view.release();
            tex.destroy();
            return null;
        };
        const layout_ = g_tex_bind_group_layout orelse {
            view.release();
            tex.destroy();
            return null;
        };
        const entries = [_]wgpu.BindGroupEntry{
            .{ .binding = 0, .texture_view = view },
            .{ .binding = 1, .sampler = sampler },
        };
        const bg = device.createBindGroup(&.{
            .layout = layout_,
            .entry_count = entries.len,
            .entries = &entries,
        }) orelse {
            view.release();
            tex.destroy();
            return null;
        };
        g_paint_tex = tex;
        g_paint_view = view;
        g_paint_bg = bg;
        g_paint_tex_w = a.w;
        g_paint_tex_h = a.h;
    }
    // A fresh texture needs the whole atlas; otherwise upload only the row band that
    // changed since last frame (one row for a single stroke, not the whole 1.6 MB).
    var lo: u32 = 0;
    var hi: u32 = 0;
    var upload = false;
    if (recreated) {
        lo = 0;
        hi = a.h - 1;
        upload = true;
        _ = model_paint.consumeDirtyRows(); // the full upload below covers any pending
    } else if (model_paint.consumeDirtyRows()) |rows| {
        lo = rows[0];
        hi = @min(rows[1], a.h - 1);
        upload = true;
    }
    if (upload) {
        const band_rows = hi - lo + 1;
        const row_bytes: usize = @as(usize, a.w) * 4;
        const start = @as(usize, lo) * row_bytes;
        queue.writeTexture(
            &.{ .texture = g_paint_tex.?, .mip_level = 0, .origin = .{ .x = 0, .y = lo, .z = 0 }, .aspect = .all },
            @ptrCast(a.rgba[start..].ptr),
            band_rows * row_bytes,
            &.{ .offset = 0, .bytes_per_row = a.w * 4, .rows_per_image = band_rows },
            &.{ .width = a.w, .height = band_rows, .depth_or_array_layers = 1 },
        );
    }
    return g_paint_bg;
}

fn hashKey(key: []const u8) u64 {
    var h: u64 = 0xcbf29ce484222325;
    for (key) |byte| {
        h ^= byte;
        h *%= 0x100000001b3;
    }
    return h;
}

const GeoSlice = struct { offset: u64, count: u32 };

// Resolve a geometry key to a retained (offset, count), uploading the verts on
// first sight. Returns null when the cache or retained buffer is full — the
// caller then falls back to a per-frame upload (correct, just not retained).
/// Cache-only lookup. Returns the retained (offset, count) if the key is already
/// cached (from an earlier mesh's CREATE, or the build-time bake seed), else null.
/// Used by the ship-once-per-key dedup path so a deduped mesh node with NO verts
/// can still draw, riding on the upload an earlier sibling did.
fn lookupGeometry(key: []const u8) ?GeoSlice {
    const hash = hashKey(key);
    for (g_geo_cache[0..g_geo_cache_len]) |*e| {
        if (e.present and e.hash == hash) return .{ .offset = e.offset_bytes, .count = e.count };
    }
    return null;
}

/// Pack one stride-8 f32 vertex row (pos3 + normal3 + uv2, the wire format
/// every generator/importer ships) into the 20-byte GPU Vertex.
fn packVertexRow(src: []const f32) Vertex {
    return .{
        .px = src[0],
        .py = src[1],
        .pz = src[2],
        .noct = pack.octEncodeSnorm16(src[3], src[4], src[5]),
        .u = @floatCast(src[6]),
        .v = @floatCast(src[7]),
    };
}

// Fixed staging window for pack-at-upload: big meshes stream through in
// chunks (same pattern as stageStaticInstanceBytes), so the scratch stays a
// bounded 1.3 MB regardless of mesh size.
const VERT_PACK_CHUNK = 65536;
var g_vert_pack_scratch: [VERT_PACK_CHUNK]Vertex = undefined;

/// Pack + upload `count` stride-8 f32 vertex rows to `buf` starting at byte
/// `dst_offset`. This is THE write boundary between the f32 wire format and
/// the packed GPU Vertex — every vbuf0 upload routes through here.
fn stageVertexRows(queue: *wgpu.Queue, buf: *wgpu.Buffer, dst_offset: u64, verts: []const f32, count: u32) void {
    var done: u32 = 0;
    while (done < count) {
        const chunk: u32 = @min(VERT_PACK_CHUNK, count - done);
        for (0..chunk) |k| {
            const s = (@as(usize, done) + k) * 8;
            g_vert_pack_scratch[k] = packVertexRow(verts[s .. s + 8]);
        }
        bu.writeTypedBuffer(queue, buf, dst_offset + bu.bytesOfCount(Vertex, done), Vertex, g_vert_pack_scratch[0..chunk]);
        done += chunk;
    }
}

fn internGeometry(queue: *wgpu.Queue, key: []const u8, verts: []const f32, count: u32) ?GeoSlice {
    if (lookupGeometry(key)) |slot| return slot;
    if (g_geo_cache_len >= GEO_CACHE_SIZE) return null;
    const buf = g_retained_vbuf orelse return null;
    const bytes = bu.bytesOfCount(Vertex, count);
    if (g_retained_top + bytes > @as(u64, MAX_RETAINED_VERTS) * @sizeOf(Vertex)) return null;
    stageVertexRows(queue, buf, g_retained_top, verts, count);
    const off = g_retained_top;
    g_retained_top += bytes;
    g_geo_cache[g_geo_cache_len] = .{ .hash = hashKey(key), .offset_bytes = off, .count = count, .present = true };
    g_geo_cache_len += 1;
    return .{ .offset = off, .count = count };
}

/// Find (or create) the metadata entry for a dynamic key "<prefix><slotId>~<version>"
/// by its stable slotId. Shared by every dynamic-geom path (verts-shipped and host-
/// generated). Does NOT allocate GPU space — the caller bump-allocates by real vertex
/// count via dynEnsureRegion once it knows the count. Returns null only when the
/// metadata table is full (LOUD, once).
const DynLoc = struct { i: usize, ver_hash: u64 };
fn dynSlotLocate(prefix_len: usize, key: []const u8) ?DynLoc {
    const rest = key[prefix_len..]; // "<slotId>~<version>"
    const sep = std.mem.lastIndexOfScalar(u8, rest, '~') orelse return null;
    const id_hash = hashKey(rest[0..sep]);
    const ver_hash = hashKey(rest[sep + 1 ..]);
    for (g_dyn_slots[0..g_dyn_len], 0..) |*s, i| {
        if (s.present and s.id_hash == id_hash) return .{ .i = i, .ver_hash = ver_hash };
    }
    if (g_dyn_len >= DYN_META_SLOTS) {
        dynWarnFull("metadata table", DYN_META_SLOTS);
        return null;
    }
    const idx = g_dyn_len;
    g_dyn_slots[idx] = .{ .id_hash = id_hash, .present = true };
    g_dyn_len += 1;
    return .{ .i = idx, .ver_hash = ver_hash };
}

/// Ensure entry `s` owns a GPU region of at least `count` verts. Reuses its existing
/// region in place when it already fits (the common case: a live edit keeps the same
/// grid resolution, so nothing grows); otherwise bump-allocates a fresh block from the
/// dyn tail (the old block leaks until resetForReload — the same bump-never-evict
/// contract the intern region uses).
///
/// `reserve_hint` is the growth armor (req_2708): a mesh that OUTGREW its region is
/// mid-edit and will keep growing — sculpting terrain grew the heightfield's vert
/// count a little EVERY FRAME of the stroke, and exact-fit re-allocation leaked a
/// fresh region per frame until the 4.7M-vert tail filled mid-stroke (then every
/// re-bake drew the stale mesh: "terrain stops painting", while colliders — fed the
/// raw heights — kept working). On a growth re-alloc we reserve max(count, hint) so
/// each entry re-allocates at most once more (heightfields pass their grid's worst
/// case; live-edit meshes pass count×2 for geometric growth). Returns the byte
/// offset, or null when the tail is full (LOUD, once). Callers guarantee
/// 0 < count ≤ MAX_DYN_VERTS.
fn dynEnsureRegion(s: *DynSlot, count: u32, reserve_hint: u32) ?u64 {
    if (s.capacity >= count) return s.offset_bytes;
    // First sight reserves exact fit (a flat chunk is ~30 verts — that's what lets
    // hundreds of untouched chunks coexist); growth reserves the hint.
    const reserve = if (s.capacity == 0) count else @max(count, @min(reserve_hint, MAX_DYN_VERTS));
    if (g_dyn_bump_verts + reserve > DYN_REGION_VERTS) {
        dynWarnFull("vertex region", DYN_REGION_VERTS);
        return null;
    }
    const off = (@as(u64, MAX_RETAINED_VERTS) + g_dyn_bump_verts) * @sizeOf(Vertex);
    s.offset_bytes = off;
    s.capacity = reserve;
    g_dyn_bump_verts += reserve;
    return off;
}

/// The entry's current drawable slice, or null if it has never uploaded anything.
fn existingDyn(s: *const DynSlot) ?GeoSlice {
    return if (s.count > 0) .{ .offset = s.offset_bytes, .count = s.count } else null;
}

/// LOUD one-shot warning that a dynamic-geometry ceiling was hit and a mesh was
/// dropped — the user's standing rule is that truncation is never silent (req_0892).
fn dynWarnFull(what: []const u8, cap: u64) void {
    if (g_dyn_warned) return;
    g_dyn_warned = true;
    log.print("[r3d] dynamic geometry {s} FULL (cap {d}) — a ground/live/imported mesh was DROPPED and will not draw. Raise DYN_META_SLOTS or DYN_REGION_VERTS in framework/gpu/3d.zig.\n", .{ what, cap });
}

/// Resolve a dynamic key "~dyn~<slotId>~<version>" to its reused entry, overwriting
/// its verts in place when the version changed. `verts` may be null on a frame the
/// node didn't re-ship (then we draw the entry's existing contents). Returns null
/// only if there's no room and nothing yet uploaded.
fn resolveDynamicGeom(queue: *wgpu.Queue, key: []const u8, verts: ?[]const f32, count: u32) ?GeoSlice {
    const loc = dynSlotLocate("~dyn~".len, key) orelse return null;
    const s = &g_dyn_slots[loc.i];
    if (s.version_hash != loc.ver_hash or s.count == 0) {
        const v = verts orelse return existingDyn(s);
        if (count == 0 or count > MAX_DYN_VERTS or v.len < @as(usize, count) * 8) return existingDyn(s);
        const buf = g_retained_vbuf orelse return null;
        // Growth hint ×2: a live-edited mesh that grew will grow again; geometric
        // reservation bounds the total leaked bytes to ~one extra copy.
        const off = dynEnsureRegion(s, count, count *| 2) orelse return existingDyn(s);
        stageVertexRows(queue, buf, off, v, count);
        s.version_hash = loc.ver_hash;
        s.count = count;
    }
    return .{ .offset = s.offset_bytes, .count = s.count };
}

/// Imperative dyn-slot patch (HOST-OWNED LIVE EDIT). Overwrites an EXISTING dyn
/// slot's verts in place WITHOUT bumping its version, so a mounted node keeps
/// drawing the slot while JS pushes fresh verts each frame straight to the GPU —
/// entirely off the React/reconciler path. This is the imperative twin of
/// resolveDynamicGeom: that path re-uploads when the node's VERSION changes (one
/// React update per change); this one re-uploads on a direct call with no update
/// at all (a Studio face-drag streams verts here per frame, setState only on
/// release). `id` is the SLOT ID (the part before the final '~' of a dyn key,
/// e.g. "studio.draft"). Returns false if no slot is claimed for that id yet —
/// the node must have mounted it first; this never claims one. version_hash is
/// left untouched so the node's own redraw (same version) won't reset our verts.
pub fn patchDynSlotById(id: []const u8, verts: []const f32, count: u32) bool {
    if (count == 0 or count > MAX_DYN_VERTS or verts.len < @as(usize, count) * 8) return false;
    const id_hash = hashKey(id);
    for (g_dyn_slots[0..g_dyn_len]) |*s| {
        if (!s.present or s.id_hash != id_hash) continue;
        // Stream into the entry's existing region. It must already fit — this path
        // never grows the region (a grow would need the bump allocator + a remount).
        if (s.capacity < count) return false;
        const queue = core.getQueue() orelse return false;
        const buf = g_retained_vbuf orelse return false;
        stageVertexRows(queue, buf, s.offset_bytes, verts, count);
        s.count = count;
        return true;
    }
    return false;
}

// ── Host-generated heightfield ──────────────────────────────────────────────
// Faithful port of runtime/geometries/Heightfield.ts (top surface + central-
// difference normals + perimeter skirt down to `base`). The live painted-terrain
// path streams ONLY the cols×rows height grid; the host bakes the mesh verts here,
// instead of the JS side shipping ~86k baked verts across the bridge every sculpt.
// Painted terrain is static-t, so the TS generator's optional travelling wave is
// omitted. KEEP IN PARITY with Heightfield.ts (winding, normals, skirt).
var g_hf_scratch: [MAX_DYN_VERTS]Vertex = undefined;

// A travelling surface wave for a heightfield (bodies of water). Zero amplitude =
// no wave (all terrain). Mirrors runtime/geometries/Heightfield.ts waveHeight.
const HfWave = struct { amp: f32 = 0, len: f32 = 0, speed: f32 = 0, dx: f32 = 1, dz: f32 = 0 };
fn hfWaveActive(w: HfWave) bool {
    return @abs(w.amp) > 1e-4 and w.len > 1e-4;
}
fn hfWaveAt(w: HfWave, x: f32, z: f32, t: f32) f32 {
    const dlen = @sqrt(w.dx * w.dx + w.dz * w.dz);
    const ux = if (dlen > 1e-4) w.dx / dlen else 1.0;
    const uz = if (dlen > 1e-4) w.dz / dlen else 0.0;
    const cycles = (x * ux + z * uz) / w.len + t * w.speed;
    return @sin(cycles * std.math.pi * 2.0) * w.amp;
}
// Scratch for the rippled copy of a wave heightfield's grid (water grids are
// small; a field too big for this renders still — no wave, never a crash).
var g_hf_wave_heights: [64 * 64]f32 = undefined;

fn hfHeightAt(hs: []const f32, cols: usize, rows: usize, ix: i64, iz: i64) f32 {
    const ci: usize = @intCast(std.math.clamp(ix, 0, @as(i64, @intCast(cols)) - 1));
    const cj: usize = @intCast(std.math.clamp(iz, 0, @as(i64, @intCast(rows)) - 1));
    return hs[cj * cols + ci];
}

fn hfNormalAt(hs: []const f32, cols: usize, rows: usize, i: usize, j: usize, dx: f32, dz: f32) [3]f32 {
    const ii: i64 = @intCast(i);
    const jj: i64 = @intCast(j);
    const hl = hfHeightAt(hs, cols, rows, ii - 1, jj);
    const hr = hfHeightAt(hs, cols, rows, ii + 1, jj);
    const hu = hfHeightAt(hs, cols, rows, ii, jj - 1);
    const hd = hfHeightAt(hs, cols, rows, ii, jj + 1);
    var nx = -(hr - hl) / (2.0 * dx);
    var ny: f32 = 1.0;
    var nz = -(hd - hu) / (2.0 * dz);
    const len = @sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-6) {
        nx /= len;
        ny /= len;
        nz /= len;
    }
    return .{ nx, ny, nz };
}

fn hfPos(hs: []const f32, cols: usize, i: usize, j: usize, x0: f32, dx: f32, z0: f32, dz: f32) [3]f32 {
    return .{ x0 + @as(f32, @floatFromInt(i)) * dx, hs[j * cols + i], z0 + @as(f32, @floatFromInt(j)) * dz };
}

fn hfPush(n: *usize, p: [3]f32, nrm: [3]f32, u: f32, vv: f32) void {
    if (n.* >= MAX_DYN_VERTS) return;
    g_hf_scratch[n.*] = .{
        .px = p[0],
        .py = p[1],
        .pz = p[2],
        .noct = pack.octEncodeSnorm16(nrm[0], nrm[1], nrm[2]),
        .u = @floatCast(u),
        .v = @floatCast(vv),
    };
    n.* += 1;
}

fn hfSkirt(n: *usize, a: [3]f32, b: [3]f32, c: [3]f32, d: [3]f32, nrm: [3]f32, su: f32) void {
    hfPush(n, a, nrm, su, 0);
    hfPush(n, b, nrm, su, 0);
    hfPush(n, c, nrm, su, 0);
    hfPush(n, a, nrm, su, 0);
    hfPush(n, c, nrm, su, 0);
    hfPush(n, d, nrm, su, 0);
}

// Water-depth UV: when a water mesh ships a per-cell depth grid, the top-surface
// UV.x carries the normalised water column depth (0 at the waterline → 1 at
// HF_DEPTH_NORM metres deep) instead of grid coords, so the water shader can draw
// the deep/shallow gradient + shoreline foam. Non-water fields pass null → grid u.
const HF_DEPTH_NORM: f32 = 12.0;
fn hfDepthU(depths: ?[]const f32, idx: usize, fallback: f32) f32 {
    if (depths) |d| {
        if (idx < d.len) return std.math.clamp(d[idx] / HF_DEPTH_NORM, 0.0, 1.0);
    }
    return fallback;
}

/// Build the heightfield mesh into g_hf_scratch; returns the vertex count (0 = bad
/// input). Caller uploads g_hf_scratch[0..count] to the slot.
fn hfGen(hs_in: []const f32, cols: usize, rows: usize, width: f32, depth: f32, base: f32, wave: HfWave, t: f32, depths: ?[]const f32) u32 {
    if (cols < 2 or rows < 2 or hs_in.len < cols * rows) return 0;
    // Water meshes carry a depth grid → top-surface UV.x = normalised depth (so the
    // water shader knows the waterline); skirt walls are "deep" (su=1, no foam).
    const skirt_u: f32 = if (depths != null) 1.0 else 0.0;
    const cf: f32 = @floatFromInt(cols - 1);
    const rf: f32 = @floatFromInt(rows - 1);
    const dx = width / cf;
    const dz = depth / rf;
    const x0 = -width * 0.5;
    const z0 = -depth * 0.5;
    // A wave heightfield ripples its top: build a rippled copy of the grid and
    // bake from that (the rest of the bake is untouched). Cells at/under `base`
    // (outside a disc's footprint) stay flat so the skirt rounds the body off.
    var hs = hs_in;
    if (hfWaveActive(wave) and cols * rows <= g_hf_wave_heights.len) {
        var wj: usize = 0;
        while (wj < rows) : (wj += 1) {
            const z = z0 + @as(f32, @floatFromInt(wj)) * dz;
            var wi: usize = 0;
            while (wi < cols) : (wi += 1) {
                const idx = wj * cols + wi;
                const h = hs_in[idx];
                const x = x0 + @as(f32, @floatFromInt(wi)) * dx;
                g_hf_wave_heights[idx] = if (h > base) h + hfWaveAt(wave, x, z, t) else h;
            }
        }
        hs = g_hf_wave_heights[0 .. cols * rows];
    }
    var n: usize = 0;

    // Top surface — wound to face +Y.
    var j: usize = 0;
    while (j + 1 < rows) : (j += 1) {
        var i: usize = 0;
        while (i + 1 < cols) : (i += 1) {
            const pa = hfPos(hs, cols, i, j, x0, dx, z0, dz);
            const pb = hfPos(hs, cols, i + 1, j, x0, dx, z0, dz);
            const pc = hfPos(hs, cols, i + 1, j + 1, x0, dx, z0, dz);
            const pd = hfPos(hs, cols, i, j + 1, x0, dx, z0, dz);
            const na = hfNormalAt(hs, cols, rows, i, j, dx, dz);
            const nb = hfNormalAt(hs, cols, rows, i + 1, j, dx, dz);
            const nc = hfNormalAt(hs, cols, rows, i + 1, j + 1, dx, dz);
            const nd = hfNormalAt(hs, cols, rows, i, j + 1, dx, dz);
            // UV.x: grid column by default, OR per-cell normalised water depth when a
            // depth grid is present (water). Each corner keys its own cell, so depth
            // u varies in both i and j (grid u only varied by column).
            const gua = @as(f32, @floatFromInt(i)) / cf;
            const gub = @as(f32, @floatFromInt(i + 1)) / cf;
            const ua = hfDepthU(depths, j * cols + i, gua);
            const ub = hfDepthU(depths, j * cols + (i + 1), gub);
            const uc = hfDepthU(depths, (j + 1) * cols + (i + 1), gub);
            const ud = hfDepthU(depths, (j + 1) * cols + i, gua);
            const va0 = @as(f32, @floatFromInt(j)) / rf;
            const vb0 = @as(f32, @floatFromInt(j + 1)) / rf;
            hfPush(&n, pa, na, ua, va0);
            hfPush(&n, pc, nc, uc, vb0);
            hfPush(&n, pb, nb, ub, va0);
            hfPush(&n, pa, na, ua, va0);
            hfPush(&n, pd, nd, ud, vb0);
            hfPush(&n, pc, nc, uc, vb0);
        }
    }

    // Perimeter skirt — seal each boundary edge down to `base`, faces outward.
    var si: usize = 0;
    while (si + 1 < cols) : (si += 1) {
        const tn0 = hfPos(hs, cols, si, 0, x0, dx, z0, dz);
        const tn1 = hfPos(hs, cols, si + 1, 0, x0, dx, z0, dz);
        if (tn0[1] > base or tn1[1] > base) hfSkirt(&n, .{ tn1[0], base, tn1[2] }, .{ tn0[0], base, tn0[2] }, tn0, tn1, .{ 0, 0, -1 }, skirt_u);
        const js = rows - 1;
        const ts0 = hfPos(hs, cols, si, js, x0, dx, z0, dz);
        const ts1 = hfPos(hs, cols, si + 1, js, x0, dx, z0, dz);
        if (ts0[1] > base or ts1[1] > base) hfSkirt(&n, .{ ts0[0], base, ts0[2] }, .{ ts1[0], base, ts1[2] }, ts1, ts0, .{ 0, 0, 1 }, skirt_u);
    }
    var sj: usize = 0;
    while (sj + 1 < rows) : (sj += 1) {
        const tw0 = hfPos(hs, cols, 0, sj, x0, dx, z0, dz);
        const tw1 = hfPos(hs, cols, 0, sj + 1, x0, dx, z0, dz);
        if (tw0[1] > base or tw1[1] > base) hfSkirt(&n, .{ tw0[0], base, tw0[2] }, .{ tw1[0], base, tw1[2] }, tw1, tw0, .{ -1, 0, 0 }, skirt_u);
        const ie = cols - 1;
        const te0 = hfPos(hs, cols, ie, sj, x0, dx, z0, dz);
        const te1 = hfPos(hs, cols, ie, sj + 1, x0, dx, z0, dz);
        if (te0[1] > base or te1[1] > base) hfSkirt(&n, .{ te1[0], base, te1[2] }, .{ te0[0], base, te0[2] }, te0, te1, .{ 1, 0, 0 }, skirt_u);
    }

    return @intCast(n);
}

/// Materialize the one immutable 121×121 topology used by formula-painted
/// terrain. A unit-high source grid forces hfGen to include the perimeter skirt:
/// shader-side y=1 vertices fetch real heights, while y=0 skirt bottoms remain
/// at the chunk base. X/Z are unit-spaced sample coordinates and are scaled by
/// the per-chunk cell sizes in the vertex shader.
fn initGroundGridTopology(device: *wgpu.Device) void {
    const queue = core.getQueue() orelse return;
    const source = std.heap.c_allocator.alloc(f32, terrain_grid.SAMPLE_COUNT) catch return;
    defer std.heap.c_allocator.free(source);
    @memset(source, 1);
    const span: f32 = @floatFromInt(terrain_grid.SAMPLE_COLS - 1);
    const count = hfGen(
        source,
        terrain_grid.SAMPLE_COLS,
        terrain_grid.SAMPLE_ROWS,
        span,
        span,
        0,
        .{},
        0,
        null,
    );
    if (count != terrain_grid.TOPOLOGY_VERTEX_COUNT) {
        log.print("[r3d-ground] ERROR: shared terrain topology emitted {d} vertices, expected {d}\n", .{ count, terrain_grid.TOPOLOGY_VERTEX_COUNT });
        return;
    }
    const buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("r3d_ground_shared_grid"),
        .size = @as(u64, count) * @sizeOf(Vertex),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    }) orelse return;
    bu.writeTypedBuffer(queue, buffer, 0, Vertex, g_hf_scratch[0..count]);
    g_ground_grid_vbuf = buffer;
    g_ground_grid_vert_count = count;
}

/// Resolve a "~hf~<slotId>~<version>" key: generate the heightfield mesh from the
/// streamed height grid into the reused slot, overwriting on version change. The
/// grid is the same one the collider takes, so render == collide.
fn resolveDynamicHeightfield(io: std.Io, queue: *wgpu.Queue, key: []const u8, heights: ?[]const f32, cols: u32, rows: u32, width: f32, depth: f32, base: f32, wave: HfWave, depths: ?[]const f32) ?GeoSlice {
    const loc = dynSlotLocate("~hf~".len, key) orelse return null;
    const s = &g_dyn_slots[loc.i];
    // A wave heightfield (bodies of water) re-bakes EVERY frame from the host
    // clock so the ripple animates; static fields rebake only on version change.
    const animated = hfWaveActive(wave);
    if (animated or s.version_hash != loc.ver_hash or s.count == 0) {
        const hs = heights orelse return existingDyn(s);
        const t: f32 = if (animated) @as(f32, @floatFromInt(@mod(std.Io.Clock.now(.awake, io).toMilliseconds(), 1_000_000))) / 1000.0 else 0;
        const cnt = hfGen(hs, @intCast(cols), @intCast(rows), width, depth, base, wave, t, depths);
        if (cnt == 0) return existingDyn(s);
        const buf = g_retained_vbuf orelse return null;
        // Bump-allocate by the mesh's REAL vert count: a flat chunk is ~30 verts, not a
        // fixed 98k slot — that's what lets hundreds of painted ground chunks coexist.
        // The growth hint is this grid's WORST CASE (every top quad + the perimeter
        // skirt): a chunk being sculpted grows a little every stroke frame, so on its
        // first growth it reserves the ceiling once instead of leaking a region per
        // frame until the tail filled mid-stroke (req_2708).
        const worst: u32 = (cols - 1) * (rows - 1) * 6 + 2 * ((cols - 1) + (rows - 1)) * 6;
        const off = dynEnsureRegion(s, cnt, worst) orelse return existingDyn(s);
        bu.writeTypedBuffer(queue, buf, off, Vertex, g_hf_scratch[0..cnt]);
        s.version_hash = loc.ver_hash;
        s.count = cnt;
    }
    return existingDyn(s);
}

// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

pub fn update(_: f32) void {
    // Clear scenes recorded but never flushed (e.g. a frame where gpu.frame()
    // bailed before flushPending). Runs before the paint walk each frame.
    g_pending_count = 0;
}

/// Render a 3D.View node: walk children for 3D.Camera/Light/Mesh, draw to offscreen, composite.
pub fn render(io: std.Io, environ: *const std.process.Environ.Map, node: *Node, x: f32, y: f32, w: f32, h: f32, opacity: f32) bool {
    if (!g_initialized) init(environ);
    if (!g_initialized) return false;
    const iw: u32 = @trunc(@max(1, w));
    const ih: u32 = @trunc(@max(1, h));
    const slot = acquireRt(iw, ih) orelse return false;

    // render() runs during the paint WALK and only RECORDS the scene. The
    // actual GPU pass is deferred to flushPending(), which gpu.frame() calls
    // AFTER renderStaticSurfaceCaptures(). That ordering is the whole point:
    // a mesh that samples a <StaticSurface> via textureKey (a billboard, a
    // screen) then reads THIS frame's captured content instead of last
    // frame's — fixing the one-frame-stale / first-frame-blank monitor.
    if (g_pending_count < g_pending.len) {
        g_pending[g_pending_count] = .{ .node = node, .slot = slot, .x = x, .y = y, .w = w, .h = h };
        g_pending_count += 1;
    }

    // Queue the composite quad NOW so the 3D view holds its z-order/position
    // in the 2D draw stream; its bind group points at slot.color_view, which
    // flushPending() fills before the main 2D pass samples it.
    if (slot.composite_bind_group) |bg| {
        // No-flip variant: the 3D pipeline writes the render-to-texture
        // already in final screen orientation, so the default Y-flip the
        // image compositor applies (correct for top-down sprite sources)
        // would invert the scene.
        images.queueQuadNoFlip(x, y, w, h, opacity, bg);
        drawFpsHud(io); // self-gated (RJIT_FPS); queued here so it lands before gpu.frame's text upload
        return true;
    }
    return false;
}

// Draw every scene recorded by render() this frame. Called once from
// gpu.frame(), after StaticSurface captures and before the main 2D pass, so
// textureKey-sampled surfaces are already populated for this frame.
pub fn flushPending(io: std.Io, environ: *const std.process.Environ.Map) void {
    g_telemetry = .{ .scene_count = @intCast(g_pending_count) };
    const started = std.Io.Clock.now(.awake, io).toMicroseconds();
    for (g_pending[0..g_pending_count]) |p| drawScene(io, environ, p.node, p.slot, p.x, p.y, p.w, p.h);
    const ended = std.Io.Clock.now(.awake, io).toMicroseconds();
    g_telemetry.draw_us = @intCast(@max(0, ended - started));
    if (perfLogOn()) {
        g_perf_frame += 1;
        if (g_perf_frame % 30 == 0)
            log.print("[r3d-perf] cpu_draw_us={d} instances={d} restaged={d} draw_calls={d} | cpu_draw_us=encode+restage (GPU overdraw NOT counted): high here = re-stage choke, low+laggy = overdraw\n", .{ g_telemetry.draw_us, g_telemetry.instances, g_telemetry.staged_dynamic, g_telemetry.draw_calls });
    }
    g_pending_count = 0;
}

// ════════════════════════════════════════════════════════════════════════
// Detached targets (WORLDWIN-0611) — a render target OWNED BY THE CALLER,
// outside the per-frame pool (whose cursor resets every main-window frame).
// A secondary OS window renders its scene here on its own schedule:
// drawScene is encoder-self-contained (own encoder, own submit), so nothing
// about this touches the main frame's pass or the pool's slot identity.
// ════════════════════════════════════════════════════════════════════════

pub const DetachedTarget = struct {
    slot: Rt = .{},

    pub fn deinit(self: *DetachedTarget) void {
        if (self.slot.composite_bind_group) |bg| bg.release();
        if (self.slot.depth_view) |v| v.release();
        if (self.slot.depth_texture) |t| t.destroy();
        if (self.slot.color_view) |v| v.release();
        if (self.slot.color_texture) |t| t.destroy();
        self.slot = .{};
    }
};

/// Render one scene into a detached target IMMEDIATELY (drawScene submits its
/// own command buffer) and return the color view to blit/sample. Resizes the
/// target when the requested dims changed.
pub fn renderDetached(io: std.Io, environ: *const std.process.Environ.Map, target: *DetachedTarget, node: *Node, w: f32, h: f32) ?*wgpu.TextureView {
    if (!g_initialized) init(environ);
    if (!g_initialized) return null;
    const iw: u32 = @trunc(@max(1, w));
    const ih: u32 = @trunc(@max(1, h));
    const slot = ensureRt(&target.slot, iw, ih) orelse return null;
    // Detached targets are their own window/surface — the scene fills it, origin (0,0).
    drawScene(io, environ, node, slot, 0, 0, w, h);
    return slot.color_view;
}

// Draw the analytic skybox as one fullscreen triangle. Reconstructs each
// pixel's world ray from inv(vp) in the shader, so the only data it needs is
// that inverse, the camera position, a wrapped wall-clock for cloud drift, and
// the sky colour/sun/haze/cloud/night params off the Scene3D node.
fn drawSky(io: std.Io, pass: anytype, queue: *wgpu.Queue, node: *Node, vp: math.Mat4, cam_pos: math.Vec3) void {
    const sky_pipeline = g_sky_pipeline orelse return;
    const sky_bg = g_sky_bind_group orelse return;
    const sky_buf = g_sky_uniform_buffer orelse return;
    const inv_vp = math.m4invert(vp) orelse return;

    // Wrap the clock so float32 keeps cloud-noise precision (a raw epoch in
    // seconds is ~1.7e9 and quantises the drift to a stutter).
    const t: f32 = @as(f32, @floatFromInt(@mod(std.Io.Clock.now(.awake, io).toMilliseconds(), 1_000_000))) / 1000.0;

    const u = SkyUniforms{
        .inv_vp = inv_vp,
        .cam_pos = .{ cam_pos.x, cam_pos.y, cam_pos.z },
        .time = t,
        .sun_dir = node.scene3d_sky_sun_dir,
        .sun_size = node.scene3d_sky_sun_size,
        .zenith = node.scene3d_sky_zenith,
        .haze = node.scene3d_sky_haze,
        .horizon = node.scene3d_sky_horizon,
        .cloud = node.scene3d_sky_cloud,
        .ground = node.scene3d_sky_ground,
        .sun_glow = node.scene3d_sky_sun_glow,
        .sun_color = node.scene3d_sky_sun_color,
        .night = node.scene3d_sky_night,
    };
    bu.writeValue(queue, sky_buf, 0, &u);

    pass.setPipeline(sky_pipeline);
    pass.setBindGroup(0, sky_bg, 0, null);
    pass.draw(3, 1, 0, 0);
}

/// Quantize a degree angle onto the u16 ring (0..65536 ≡ 0..360°). Axis-aligned
/// 0/90/180/270 land on exact integers (a wall/floor's rotation is lossless). Round
/// can hit 65536 for an angle a hair under 360° — mask through u32 so it wraps to 0
/// instead of overflowing the u16 cast.
fn quantAngleU16(deg: f32) u16 {
    const m = deg - @floor(deg / 360.0) * 360.0;
    const v: u32 = @round(m * (65536.0 / 360.0));
    return @intCast(v & 0xFFFF);
}

/// Pack the standard per-instance row (32-byte InstanceData): position f32, euler
/// u16 ring, scale f16 (IEEE half — full float range, no fixed-max cap), rgba u8.
/// The vertex shaders (scene3d_wgsl/water_wgsl/scene3d_ground_prefix) rebuild the
/// model matrix from these — see InstanceData's note. Replaces baking a 4×4 here.
fn makeInstance(px: f32, py: f32, pz: f32, rx: f32, ry: f32, rz: f32, sx: f32, sy: f32, sz: f32, cr: f32, cg: f32, cb: f32, ca: f32) InstanceData {
    return InstanceData{
        .pos = .{ px, py, pz },
        .euler = .{ quantAngleU16(rx), quantAngleU16(ry), quantAngleU16(rz), 0 },
        .scale = .{ @floatCast(sx), @floatCast(sy), @floatCast(sz), 0 },
        .color = pack.rgba8(cr, cg, cb, ca),
    };
}

/// Pack a foliage-card row into the 24-byte slim format (grass/bush/flower/frond).
/// `rz` is dropped (always 0; grass is yaw-only), and width is one value (sx==sz).
/// Decode lives in the card shaders (grass_wgsl/frond_wgsl) — keep them in lockstep
/// with SLIM_SCALE_MAX. Out-of-range scale clamps loudly to the unorm ceiling rather
/// than wrapping (a card bigger than 16 m is a bug).
fn makeSlimInstance(px: f32, py: f32, pz: f32, pitch: f32, yaw: f32, wide: f32, len: f32, cr: f32, cg: f32, cb: f32) SlimInstance {
    const scl = struct {
        fn q(m: f32) u16 {
            const u = std.math.clamp(m / SLIM_SCALE_MAX, 0.0, 1.0);
            return @round(u * 65535.0);
        }
    };
    return SlimInstance{
        .pos = .{ px, py, pz },
        .angles = .{ quantAngleU16(pitch), quantAngleU16(yaw) },
        .scale = .{ scl.q(wide), scl.q(len) },
        .color = .{ pack.unorm8(cr), pack.unorm8(cg), pack.unorm8(cb), 255 },
    };
}

const StaticInstDraw = struct { offset: u64, count: u32 };

/// Resolve a STATIC instanced batch (scene3d_instance_static) to a persistent
/// (offset, count) in g_static_inst_buf, staging + uploading it ONCE on first sight
/// keyed by the data pointer. Later frames cache-hit and redraw with no restage and
/// no upload — the fix for re-uploading a static world every frame. The one-time
/// upload streams through g_inst_scratch in MAX_INSTANCES-sized chunks so the
/// staging window stays small. Returns null when the batch is malformed, the cache
/// is full, or capacity is exhausted; the caller falls back to the dynamic path.
///
/// The WHOLE array uploads (count = idata.len / stride), not the node's draw
/// count: many nodes may draw sub-ranges of one shared upload (world streaming's
/// per-chunk draws via scene3d_instance_first) and all resolve to this one entry.
/// Stage `n` instance rows from `idata` into g_static_inst_buf starting at byte
/// `dst_offset`, streaming through g_inst_scratch in MAX_INSTANCES chunks. Used
/// for the first upload AND the in-place re-upload when a static batch's bytes
/// change (DIRTYRECT) — same offset, so retained/streamed sub-ranges stay valid.
fn stageStaticInstanceBytes(queue: *wgpu.Queue, idata: []const f32, stride: u32, n: u32, dst_offset: u64) void {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const color_base: usize = if (stride >= 12) 9 else 6;
    var done: u32 = 0;
    while (done < n) {
        const chunk: u32 = @min(MAX_INSTANCES, n - done);
        var k: u32 = 0;
        while (k < chunk) : (k += 1) {
            const src = @as(usize, done + k) * stride;
            g_inst_scratch[k] = makeInstance(
                idata[src + 0],
                idata[src + 1],
                idata[src + 2],
                if (stride >= 12) idata[src + 3] else 0,
                if (stride >= 12) idata[src + 4] else 0,
                if (stride >= 12) idata[src + 5] else 0,
                idata[src + scale_base + 0],
                idata[src + scale_base + 1],
                idata[src + scale_base + 2],
                idata[src + color_base + 0],
                idata[src + color_base + 1],
                idata[src + color_base + 2],
                1.0,
            );
        }
        bu.writeTypedBuffer(queue, g_static_inst_buf.?, dst_offset + @as(u64, done) * @sizeOf(InstanceData), InstanceData, g_inst_scratch[0..chunk]);
        done += chunk;
    }
}

fn resolveStaticInstances(device: *wgpu.Device, queue: *wgpu.Queue, idata: []const f32, stride: u32, version: u32) ?StaticInstDraw {
    if (stride < 9 or idata.len < stride) return null;
    const icount: u32 = @intCast(idata.len / @as(usize, stride));
    const key = @intFromPtr(idata.ptr);
    var i: usize = 0;
    while (i < g_static_inst_cache_len) : (i += 1) {
        const e = &g_static_inst_cache[i];
        if (e.used and e.key == key and e.count == icount) {
            // DIRTYRECT: the loader edited the bytes in place and bumped the
            // node version — re-upload the whole batch at its retained offset
            // (offsets stay stable, so streamed sub-ranges remain valid).
            if (e.version != version) {
                stageStaticInstanceBytes(queue, idata, stride, icount, e.offset);
                e.version = version;
            }
            e.last_seen = g_dbg_frame;
            return .{ .offset = e.offset, .count = e.count };
        }
    }
    if (icount == 0) return null;
    if (g_static_inst_buf == null) {
        g_static_inst_buf = device.createBuffer(&.{
            .label = wgpu.StringView.fromSlice("render3d_static_instances"),
            .size = @as(u64, g_static_inst_cap) * @sizeOf(InstanceData),
            .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst | wgpu.BufferUsages.copy_src,
            .mapped_at_creation = 0,
        });
        if (g_static_inst_buf == null) return null;
        g_static_inst_top = 0;
    }
    const used_count: u32 = @intCast(g_static_inst_top / @sizeOf(InstanceData));
    // Retained static uploads must be whole-array because streamed draw nodes
    // address sub-ranges by scene3d_instance_first. A partial upload makes any
    // later range clamp to count=0, so turning the camera can drop whole chunks.
    // A batch past the current capacity GROWS the pool (req_2843); only the
    // device's refusal drops to the loud per-frame degrade path below.
    if (!static_instance_policy.canRetainWholeBatch(icount, used_count, g_static_inst_cap)) {
        if (!growStaticPool(device, queue, &g_static_inst_buf, &g_static_inst_cap, g_static_inst_top, @sizeOf(InstanceData), @as(u64, used_count) + icount, "render3d_static_instances")) {
            staticRetainWarn("standard", "row budget", icount, used_count);
            return null;
        }
    }
    const slot = staticCacheSlot(g_static_inst_cache[0..], &g_static_inst_cache_len, g_dbg_frame) orelse {
        staticRetainWarn("standard", "cache table", icount, used_count);
        return null;
    };
    const n: u32 = icount;
    if (n == 0) return null;
    const base_offset = g_static_inst_top;
    stageStaticInstanceBytes(queue, idata, stride, n, base_offset);
    g_static_inst_top += @as(u64, n) * @sizeOf(InstanceData);
    slot.* = .{ .key = key, .count = n, .offset = base_offset, .used = true, .version = version, .last_seen = g_dbg_frame };
    return .{ .offset = base_offset, .count = n };
}

// ── Foliage cards: the slim 24-byte twin of the static-instance staging above ──
// Foliage source rows are stride-13 (transform12 + shape) like every foliage family;
// the transform is px,py,pz, pitch,yaw,0(rz), wide,len,wide, r,g,b. We drop rz and
// the duplicate width and pack to SlimInstance. Same whole-array retained-upload
// contract as stageStaticInstanceBytes so streamed sub-ranges stay addressable.
fn stageStaticSlimBytes(queue: *wgpu.Queue, idata: []const f32, stride: u32, n: u32, dst_offset: u64) void {
    var done: u32 = 0;
    while (done < n) {
        const chunk: u32 = @min(MAX_INSTANCES, n - done);
        var k: u32 = 0;
        while (k < chunk) : (k += 1) {
            const src = @as(usize, done + k) * stride;
            g_slim_inst_scratch[k] = makeSlimInstance(
                idata[src + 0],
                idata[src + 1],
                idata[src + 2], // pos
                idata[src + 3],
                idata[src + 4], // pitch, yaw (rz at +5 dropped)
                idata[src + 6],
                idata[src + 7], // wide, len (sz at +8 == wide, dropped)
                idata[src + 9],
                idata[src + 10],
                idata[src + 11], // root rgb
            );
        }
        bu.writeTypedBuffer(queue, g_slim_static_buf.?, dst_offset + @as(u64, done) * @sizeOf(SlimInstance), SlimInstance, g_slim_inst_scratch[0..chunk]);
        done += chunk;
    }
}

fn resolveStaticSlimInstances(device: *wgpu.Device, queue: *wgpu.Queue, idata: []const f32, stride: u32, version: u32) ?StaticInstDraw {
    if (stride < 12 or idata.len < stride) return null;
    const icount: u32 = @intCast(idata.len / @as(usize, stride));
    const key = @intFromPtr(idata.ptr);
    var i: usize = 0;
    while (i < g_slim_static_cache_len) : (i += 1) {
        const e = &g_slim_static_cache[i];
        if (e.used and e.key == key and e.count == icount) {
            if (e.version != version) {
                stageStaticSlimBytes(queue, idata, stride, icount, e.offset);
                e.version = version;
            }
            e.last_seen = g_dbg_frame;
            return .{ .offset = e.offset, .count = e.count };
        }
    }
    if (icount == 0) return null;
    if (g_slim_static_buf == null) {
        g_slim_static_buf = device.createBuffer(&.{
            .label = wgpu.StringView.fromSlice("render3d_slim_static_instances"),
            .size = @as(u64, g_slim_static_cap) * @sizeOf(SlimInstance),
            .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst | wgpu.BufferUsages.copy_src,
            .mapped_at_creation = 0,
        });
        if (g_slim_static_buf == null) return null;
        g_slim_static_top = 0;
    }
    const used_count: u32 = @intCast(g_slim_static_top / @sizeOf(SlimInstance));
    if (!static_instance_policy.canRetainWholeBatch(icount, used_count, g_slim_static_cap)) {
        if (!growStaticPool(device, queue, &g_slim_static_buf, &g_slim_static_cap, g_slim_static_top, @sizeOf(SlimInstance), @as(u64, used_count) + icount, "render3d_slim_static_instances")) {
            staticRetainWarn("slim (foliage)", "row budget", icount, used_count);
            return null;
        }
    }
    const slot = staticCacheSlot(g_slim_static_cache[0..], &g_slim_static_cache_len, g_dbg_frame) orelse {
        staticRetainWarn("slim (foliage)", "cache table", icount, used_count);
        return null;
    };
    const base_offset = g_slim_static_top;
    stageStaticSlimBytes(queue, idata, stride, icount, base_offset);
    g_slim_static_top += @as(u64, icount) * @sizeOf(SlimInstance);
    slot.* = .{ .key = key, .count = icount, .offset = base_offset, .used = true, .version = version, .last_seen = g_dbg_frame };
    return .{ .offset = base_offset, .count = icount };
}

// Build the ground-formula pipeline once, from the first chunk's formula. The
// assembled module = scene3d_ground_prefix + effect_math (fbm/snoise) + the
// shipped formula (hf_ground_rgb + helpers) + scene3d_ground_epilogue. The
// formula is identical across chunks, so this runs exactly once.
fn ensureGroundPipeline(io: std.Io, environ: *const std.process.Environ.Map, formula: []const u8) void {
    // Rebuild when the formula CHANGES, not just once: a TSX hot-reload (e.g. a
    // tile-material fix) ships a new formula string, and a cached pipeline would
    // keep running the stale shader (roads reading as concrete). Hash-gate it so
    // an unchanged formula is a no-op but an edited one re-compiles.
    const h = std.hash.Wyhash.hash(0, formula);
    if (g_ground_pipeline != null and h == g_ground_formula_hash) return;
    const device = core.getDevice() orelse return;
    if (g_bind_group_layout == null or g_ground_bgl == null) return;
    if (g_ground_pipeline) |old| old.release();
    g_ground_pipeline = null;
    // Heap-assemble the module sized to the formula (the catalog-composed editor
    // formula is ~188 KB — a fixed scratch buffer silently truncated it and the
    // ground never drew, req_2651). The text is only needed for the duration of
    // createShaderModule, so it is freed on every path out of this function.
    const wgsl = std.fmt.allocPrint(std.heap.c_allocator, "{s}\n{s}\n{s}\n{s}", .{
        shaders.scene3d_ground_prefix, effect_assemble.MATH, formula, shaders.scene3d_ground_epilogue,
    }) catch {
        log.print("[r3d-ground] ERROR: out of memory assembling the ground shader ({d}B formula, hash {x}) — the GROUND PIPELINE never builds and ALL painted ground is INVISIBLE until this is fixed.\n", .{ formula.len, h });
        return;
    };
    defer std.heap.c_allocator.free(wgsl);
    // Narrate a slow (cold driver cache) compile — the catalog-composed ground
    // formula is megashader-class, and this call blocks the render thread with
    // zero output otherwise (req_2692).
    var progress = compile_progress.CompileProgress{};
    progress.start(io, environ, wgsl.len);
    defer progress.stop();
    const sm_desc = wgpu.shaderModuleWGSLDescriptor(.{ .label = "render3d_ground", .code = wgsl });
    const sm = device.createShaderModule(&sm_desc) orelse {
        log.print("[r3d-ground] ERROR: ground formula WGSL FAILED TO COMPILE (formula hash {x}, {d}B) — createShaderModule returned null; the GROUND PIPELINE never builds and ALL painted ground (terrain, tiles, water) is INVISIBLE until the formula is fixed. Check the wgpu validation output above for the naga error.\n", .{ h, formula.len });
        return;
    };
    defer sm.release();
    const gl = [_]?*wgpu.BindGroupLayout{ g_bind_group_layout.?, g_ground_bgl.? };
    const pl = device.createPipelineLayout(&.{
        .bind_group_layout_count = gl.len,
        .bind_group_layouts = @ptrCast(&gl),
    }) orelse return;
    defer pl.release();
    const vert_attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x3, .offset = 0, .shader_location = 0 },
        .{ .format = .snorm16x2, .offset = 12, .shader_location = 1 }, // oct normal
        .{ .format = .float16x2, .offset = 16, .shader_location = 2 }, // uv
    };
    const inst_attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x3, .offset = 0, .shader_location = 3 },
        .{ .format = .uint16x4, .offset = 12, .shader_location = 4 },
        .{ .format = .float16x4, .offset = 20, .shader_location = 5 },
        .{ .format = .unorm8x4, .offset = 28, .shader_location = 6 },
    };
    const vert_layouts = [_]wgpu.VertexBufferLayout{
        .{ .step_mode = .vertex, .array_stride = @sizeOf(Vertex), .attribute_count = vert_attrs.len, .attributes = &vert_attrs },
        .{ .step_mode = .instance, .array_stride = @sizeOf(InstanceData), .attribute_count = inst_attrs.len, .attributes = &inst_attrs },
    };
    const color_target = wgpu.ColorTargetState{
        .format = .rgba8_unorm,
        .blend = &wgpu.BlendState.premultiplied_alpha_blending,
        .write_mask = wgpu.ColorWriteMasks.all,
    };
    const frag = wgpu.FragmentState{
        .module = sm,
        .entry_point = wgpu.StringView.fromSlice("fs_main"),
        .target_count = 1,
        .targets = @ptrCast(&color_target),
    };
    const depth_stencil = wgpu.DepthStencilState{
        .format = .depth24_plus,
        .depth_write_enabled = .true,
        .depth_compare = .less,
        .stencil_front = .{},
        .stencil_back = .{},
    };
    g_ground_pipeline = device.createRenderPipeline(&.{
        .layout = pl,
        .vertex = .{ .module = sm, .entry_point = wgpu.StringView.fromSlice("vs_main"), .buffer_count = vert_layouts.len, .buffers = &vert_layouts },
        .primitive = .{ .topology = .triangle_list, .cull_mode = .back, .front_face = .ccw },
        .depth_stencil = &depth_stencil,
        .multisample = .{},
        .fragment = &frag,
    });
    if (g_ground_pipeline != null) {
        g_ground_formula_hash = h;
        progress.finishOk();
    } else {
        log.print("[r3d-ground] ERROR: createRenderPipeline returned null for the ground formula (hash {x}) — the GROUND PIPELINE never builds and ALL painted ground (terrain, tiles, water) is INVISIBLE until this is fixed.\n", .{h});
    }
}

fn drawScene(io: std.Io, environ: *const std.process.Environ.Map, scene_node: *Node, slot: *Rt, vp_x: f32, vp_y: f32, w: f32, h: f32) void {
    const queue = core.getQueue() orelse return;
    const device = core.getDevice() orelse return;

    // ── Extract camera, lights, meshes from children ──
    var cam_pos = math.Vec3{ .x = 0, .y = 5, .z = 10 };
    var cam_look = math.Vec3{ .x = 0, .y = 0, .z = 0 };
    var cam_fov: f32 = 60;
    var cam_far: f32 = 0; // explicit draw radius; 0 = auto-derive from scene extent
    var cam_near: f32 = 0; // explicit near clip; 0 = auto
    var ambient_color: [3]f32 = .{ 0.15, 0.15, 0.2 };
    var light_dir: [3]f32 = .{ 0.577, 0.577, 0.577 };
    var light_color: [3]f32 = .{ 1.0, 0.95, 0.9 };
    // Placed point/spot lights collected from <Scene3D.PointLight/SpotLight>
    // children. Overflow past MAX_LIGHTS is dropped loudly (a one-shot warn).
    var placed_lights: [MAX_LIGHTS]Light = undefined;
    var n_placed: u32 = 0;
    // The first shadow-casting spot owns the single shadow map. Its index into
    // placed_lights + the params needed to build its light-space VP.
    var shadow_caster: i32 = -1;
    var caster_pos: [3]f32 = .{ 0, 0, 0 };
    var caster_dir: [3]f32 = .{ 0, -1, 0 };
    var caster_range: f32 = 0;
    var caster_half_deg: f32 = 30;
    var clear_color: [3]f32 = .{ 0.05, 0.05, 0.08 };
    if (scene_node.style.background_color) |bg| {
        clear_color = .{
            @as(f32, bg.r) / 255.0,
            @as(f32, bg.g) / 255.0,
            @as(f32, bg.b) / 255.0,
        };
    }
    // <Scene3D.Skybox> is a child View carrying scene3d_skybox + the sky_*
    // params, the same way Camera/Light are. Captured here, used for both the
    // sky draw and the horizon-coloured distance fog.
    var sky_node: ?*Node = null;
    // <Scene3D.Fog> child — explicit distance fog that overrides the auto fade.
    var fog_node: ?*Node = null;

    for (scene_node.children) |*child| {
        if (child.scene3d_skybox) sky_node = child;
        if (child.scene3d_fog) fog_node = child;
        if (child.scene3d_camera) {
            if (child.scene3d_camera_orbit) {
                // Host-driven orbit: position derives from the orbit state, not from
                // React props, so moving the camera never re-renders the cart.
                cam_pos = orbitCamPos();
                cam_look = .{ .x = g_orbit.target[0], .y = g_orbit.target[1], .z = g_orbit.target[2] };
                cam_fov = if (child.scene3d_fov > 0) child.scene3d_fov else 50;
                // Auto near/far bracketing the orbit so an arbitrary-scale model never
                // clips, unless the cart pins them explicitly.
                cam_far = if (child.scene3d_far > 0) child.scene3d_far else (g_orbit.dist + g_orbit.radius * 4.0);
                cam_near = if (child.scene3d_near > 0) child.scene3d_near else @max(0.01, g_orbit.radius * 0.01);
            } else {
                cam_pos = .{ .x = child.scene3d_pos_x, .y = child.scene3d_pos_y, .z = child.scene3d_pos_z };
                cam_look = .{ .x = child.scene3d_look_x, .y = child.scene3d_look_y, .z = child.scene3d_look_z };
                cam_fov = child.scene3d_fov;
                cam_far = child.scene3d_far;
                cam_near = child.scene3d_near;
            }
        }
        if (child.scene3d_light) {
            if (child.scene3d_light_type) |lt| {
                const i = child.scene3d_intensity;
                if (std.mem.eql(u8, lt, "ambient")) {
                    ambient_color = .{ child.scene3d_color_r * i, child.scene3d_color_g * i, child.scene3d_color_b * i };
                } else if (std.mem.eql(u8, lt, "directional")) {
                    const dx = child.scene3d_dir_x;
                    const dy = child.scene3d_dir_y;
                    const dz = child.scene3d_dir_z;
                    const len = math.length3(dx, dy, dz);
                    if (len > 0.001) {
                        light_dir = .{ dx / len, dy / len, dz / len };
                    }
                    light_color = .{ child.scene3d_color_r * i, child.scene3d_color_g * i, child.scene3d_color_b * i };
                } else if (std.mem.eql(u8, lt, "point") or std.mem.eql(u8, lt, "spot")) {
                    // The user's pyramid. point → omni (cos_outer = -1, a flat
                    // cone term); spot → a cone of half-angle scene3d_spread.
                    const is_spot = std.mem.eql(u8, lt, "spot");
                    const range = if (child.scene3d_range > 0.001) child.scene3d_range else 12.0;
                    var dir: [3]f32 = .{ child.scene3d_dir_x, child.scene3d_dir_y, child.scene3d_dir_z };
                    const dlen = math.length3(dir[0], dir[1], dir[2]);
                    if (dlen > 0.001) {
                        dir = .{ dir[0] / dlen, dir[1] / dlen, dir[2] / dlen };
                    } else {
                        dir = .{ 0, -1, 0 };
                    }
                    // Cone edges as cosines of the half-angle. The inner edge sits
                    // a touch tighter so the rim feathers instead of hard-cutting.
                    var cos_outer: f32 = -1.0;
                    var cos_inner: f32 = -1.0;
                    if (is_spot) {
                        const half = @min(@max(child.scene3d_spread, 1.0), 89.0) * std.math.pi / 180.0;
                        cos_outer = @cos(half);
                        cos_inner = @cos(half * 0.82);
                    }
                    if (n_placed < MAX_LIGHTS) {
                        placed_lights[n_placed] = .{
                            .pos = .{ child.scene3d_pos_x, child.scene3d_pos_y, child.scene3d_pos_z },
                            .range = range,
                            .dir = dir,
                            .cos_outer = cos_outer,
                            .color = .{ child.scene3d_color_r, child.scene3d_color_g, child.scene3d_color_b },
                            .intensity = i,
                            .cos_inner = cos_inner,
                            .kind = if (is_spot) 1 else 0,
                        };
                        // First shadow-casting spot claims the shadow map.
                        if (is_spot and child.scene3d_cast_shadow and shadow_caster < 0) {
                            shadow_caster = @intCast(n_placed);
                            caster_pos = .{ child.scene3d_pos_x, child.scene3d_pos_y, child.scene3d_pos_z };
                            caster_dir = dir;
                            caster_range = range;
                            caster_half_deg = @min(@max(child.scene3d_spread, 1.0), 89.0);
                        }
                        n_placed += 1;
                    } else {
                        log.print("[r3d-light] placed-light overflow — MAX_LIGHTS ({d}) reached, dropping the rest. Raise MAX_LIGHTS in framework/gpu/3d.zig.\n", .{MAX_LIGHTS});
                    }
                }
            }
        }
    }

    const focus_dist = math.v3distance(cam_pos, cam_look);
    var scene_extent: f32 = @max(8.0, focus_dist);
    var scene_mesh_children: u32 = 0;
    for (scene_node.children) |*child| {
        if (!child.scene3d_mesh) continue;
        scene_mesh_children += if (child.scene3d_instance_count > 0) child.scene3d_instance_count else 1;
        const center = math.Vec3{ .x = child.scene3d_pos_x, .y = child.scene3d_pos_y, .z = child.scene3d_pos_z };
        scene_extent = @max(scene_extent, math.v3distance(center, cam_look) + estimateMeshRadius(child));
    }
    g_telemetry.mesh_children += scene_mesh_children;

    // ── Draw radius. When the camera sets an explicit `far`, THAT is the draw
    // radius: the hard clip plane and the per-mesh cull distance below. Without
    // it, fall back to the historical auto extent so existing scenes are
    // unchanged. ──
    const draw_radius: f32 = if (cam_far > 0) cam_far else (focus_dist + scene_extent + 64.0);

    // ── Distance fog. Default behaviour:
    //   * explicit `far` set  → fog anchors to it (fade finishes AT the draw
    //     radius, starts at 0.7× it) so geometry melts into the horizon right
    //     before the cull edge — no popping when cresting a hill.
    //   * no `far`            → the historical scene_extent fade (fog should only
    //     fade near the FAR edge of what's in view, not at focus_dist; a close
    //     third-person camera otherwise fogged a big ground plane metres out).
    // A <Scene3D.Fog> child overrides either plane (0 = keep auto on that side),
    // decoupling fog falloff from the cull distance when wanted. ──
    var fog_near: f32 = undefined;
    var fog_far: f32 = undefined;
    if (cam_far > 0) {
        fog_far = cam_far;
        fog_near = cam_far * 0.7;
    } else {
        fog_near = @max(6.0, scene_extent * 0.8);
        fog_far = @max(fog_near + 12.0, scene_extent * 1.1);
    }
    if (fog_node) |f| {
        if (f.scene3d_fog_far > 0) fog_far = f.scene3d_fog_far;
        if (f.scene3d_fog_near > 0) fog_near = f.scene3d_fog_near;
    }
    if (fog_near >= fog_far) fog_near = fog_far * 0.7; // keep near < far

    // ── Build view + projection ──
    const aspect = w / @max(h, 1);
    const fov_rad = cam_fov * std.math.pi / 180.0;
    const projection_near = if (cam_near > 0) cam_near else @min(1.0, @max(0.1, focus_dist * 0.01));
    const projection_far = if (cam_far > 0)
        @max(cam_far, projection_near + 1.0)
    else
        @min(12000.0, @max(1000.0, focus_dist + scene_extent + 64.0));
    const projection = math.m4perspective(fov_rad, aspect, projection_near, projection_far);
    const view = math.m4lookAt(cam_pos, cam_look, .{ .x = 0, .y = 1, .z = 0 });
    const vp = math.m4multiply(projection, view);

    // Camera frustum planes (Gribb–Hartmann on the row-major vp; normalized,
    // inward-facing) — used to cull per-chunk instance segments (req_2859).
    var frustum_planes: [6][4]f32 = undefined;
    {
        inline for (0..4) |i| {
            frustum_planes[0][i] = vp[12 + i] + vp[0 + i]; // left
            frustum_planes[1][i] = vp[12 + i] - vp[0 + i]; // right
            frustum_planes[2][i] = vp[12 + i] + vp[4 + i]; // bottom
            frustum_planes[3][i] = vp[12 + i] - vp[4 + i]; // top
            frustum_planes[4][i] = vp[12 + i] + vp[8 + i]; // near
            frustum_planes[5][i] = vp[12 + i] - vp[8 + i]; // far
        }
        for (&frustum_planes) |*p| {
            const plane_len = @sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
            if (plane_len > 1e-6) {
                p[0] /= plane_len;
                p[1] /= plane_len;
                p[2] /= plane_len;
                p[3] /= plane_len;
            }
        }
    }

    // Only the scene that actually holds the mesh-edit / paint target may publish the
    // viewport globals below. These are single process-wide vars read by the mesh-edit
    // overlay projection (drawEditorOverlay) and by paint/pick raycasts; in a multi-Scene3D
    // layout — the editor's content browser mounts a <Scene3D> per model thumbnail — the
    // LAST scene drawn would otherwise clobber them with its own (thumbnail-sized) viewport,
    // so the overlay projected the model through the wrong rect: handles collapsed into the
    // pane corner and face picks missed. This implements the gate the comment below has
    // always named. (Thumbnails render generated geometry, never the target key, so they
    // never match.)
    var scene_holds_target = false;
    for (scene_node.children) |*child| {
        const gk = child.scene3d_geom_key orelse continue;
        const key_hash = hashKey(gk);
        if (model_paint.isTarget(key_hash) or (g_edit_key_hash != 0 and key_hash == g_edit_key_hash)) {
            scene_holds_target = true;
            break;
        }
    }

    // Capture the exact camera this frame so a paint raycast shoots the ray the user
    // sees (model_paint.pick). Only meaningful when this scene holds the paint target.
    if (scene_holds_target) {
        g_paint_eye = .{ cam_pos.x, cam_pos.y, cam_pos.z };
        g_paint_target = .{ cam_look.x, cam_look.y, cam_look.z };
        g_paint_fov = cam_fov;
        g_paint_vp_w = w;
        g_paint_vp_h = h;
        g_paint_vp_x = vp_x;
        g_paint_vp_y = vp_y;
    }

    // One-shot raycast probe (RJIT_PAINTPROBE): paint four KNOWN viewport pixels with
    // four known colours, so a headless shot shows exactly where each ray lands vs the
    // pixel it came from — ground truth for the hit-test, independent of live mouse
    // delivery. Red=centre, green=right, blue=top, yellow=left.
    if (model_paint.hasTarget() and !g_paint_probed and g_paint_probe_enabled) {
        g_paint_probed = true;
        const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
        // Small offsets that STAY on the model, so right/up/aspect terms are exercised
        // (the dead-centre pixel cancels them and can't catch a horizontal/vertical bug).
        const probes = [_][2]f32{ .{ 0.5, 0.5 }, .{ 0.60, 0.5 }, .{ 0.40, 0.5 }, .{ 0.5, 0.62 } };
        const cols = [_][4]u8{ .{ 255, 40, 40, 255 }, .{ 40, 255, 40, 255 }, .{ 255, 220, 40, 255 }, .{ 60, 120, 255, 255 } };
        for (probes, cols) |pr, col| {
            const px = w * pr[0];
            const py = h * pr[1];
            const fc = model_paint.pick(cam, w, h, px, py);
            log.print("[paintprobe] vp={d:.0}x{d:.0} fov={d:.0} eye=({d:.2},{d:.2},{d:.2}) target=({d:.2},{d:.2},{d:.2}) px=({d:.0},{d:.0}) -> face {d}\n", .{ w, h, g_paint_fov, g_paint_eye[0], g_paint_eye[1], g_paint_eye[2], g_paint_target[0], g_paint_target[1], g_paint_target[2], px, py, fc });
            if (fc >= 0) model_paint.paintFace(@intCast(fc), col);
        }
    }

    // With a skybox, distant geometry should melt into the HORIZON colour, not
    // the flat clear colour — that distance fade is most of what sells the sky.
    // A <Scene3D.Fog color=...> overrides it (sentinel {-1,-1,-1} = keep auto).
    var fog_color: [3]f32 = if (sky_node) |s| s.scene3d_sky_horizon else clear_color;
    // Aerial perspective: with a skybox, geometry fades toward the sky colour in
    // its own screen direction (the same vertical gradient drawSky paints), not a
    // flat horizon colour — so a tall peak melts into the upper sky instead of
    // leaving a horizon-coloured silhouette that pops when culled. An explicit
    // <Fog color> falls back to that flat colour.
    var sky_horizon: [3]f32 = fog_color;
    var sky_zenith: [3]f32 = fog_color;
    var fog_sky: f32 = 0;
    if (sky_node) |s| {
        sky_horizon = s.scene3d_sky_horizon;
        sky_zenith = s.scene3d_sky_zenith;
        fog_sky = 1;
    }
    if (fog_node) |f| {
        if (f.scene3d_fog_color[0] >= 0) {
            fog_color = f.scene3d_fog_color;
            fog_sky = 0; // explicit flat fog colour overrides the gradient
        }
    }

    // ── Begin render pass ──
    const color_view = slot.color_view orelse return;
    const depth_view = slot.depth_view orelse return;
    const encoder = device.createCommandEncoder(&.{ .label = wgpu.StringView.fromSlice("r3d") }) orelse return;

    // ── Shadow depth pass ───────────────────────────────────────────────────
    // Render opaque caster geometry from the shadow-casting spot's POV into the
    // depth map, so the main fragment shader can test occlusion. Runs BEFORE the
    // color pass (which samples the map). Deliberately covers the things that
    // should cast — single meshes + instanced prop/building batches — and skips
    // foliage/ground/dynamic/transparent (a grass blade or the floor self-shadow
    // is noise, glass should not cast solid). `light_vp` matches S.vp's transpose.
    var shadow_on: bool = false;
    var caster_lvp_t: math.Mat4 = .{ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 };
    if (shadow_caster >= 0 and g_shadow_pipeline != null and g_shadow_view != null and caster_range > 0.01) {
        const cpos = math.Vec3{ .x = caster_pos[0], .y = caster_pos[1], .z = caster_pos[2] };
        const ctgt = math.Vec3{ .x = caster_pos[0] + caster_dir[0], .y = caster_pos[1] + caster_dir[1], .z = caster_pos[2] + caster_dir[2] };
        // Up vector that isn't parallel to the aim (a straight-down spot needs z-up).
        const up = if (@abs(caster_dir[1]) > 0.99) math.Vec3{ .x = 0, .y = 0, .z = 1 } else math.Vec3{ .x = 0, .y = 1, .z = 0 };
        const lview = math.m4lookAt(cpos, ctgt, up);
        const lfov_deg: f32 = @min(2.0 * caster_half_deg + 8.0, 170.0);
        const lfov = lfov_deg * std.math.pi / 180.0;
        const lnear: f32 = @max(0.05, caster_range * 0.02);
        const lfar: f32 = @max(lnear + 1.0, caster_range);
        const lproj = math.m4perspective(lfov, 1.0, lnear, lfar);
        const lvp = math.m4multiply(lproj, lview);
        const lvp_t = math.m4transpose(lvp);
        caster_lvp_t = lvp_t;
        if (g_shadow_vp_buf) |vb| bu.writeValue(queue, vb, 0, &lvp_t);

        // Stage caster instances into g_shadow_inst_buf, recording per-group draws.
        const sh_scratch = &g_inst_scratch; // reused; pass 2 resets it afterward
        const sh_cap: u64 = @as(u64, MAX_INSTANCES) * @sizeOf(InstanceData);
        var sh_top: u64 = 0;
        var sh_rec_off: [MAX_SCENE_MESHES]u64 = undefined;
        var sh_rec_cnt: [MAX_SCENE_MESHES]u32 = undefined;
        var sh_rec_slot: [MAX_SCENE_MESHES]GeoSlice = undefined;
        var sh_nrec: usize = 0;
        var sci: usize = 0;
        while (sci < scene_node.children.len and sh_nrec < MAX_SCENE_MESHES) : (sci += 1) {
            const c = &scene_node.children[sci];
            if (!c.scene3d_mesh) continue;
            if (c.scene3d_ground_formula != null) continue;
            const key = c.scene3d_geom_key orelse continue;
            // Skip foliage / dynamic / heightfield / water — only solid casters.
            if (std.mem.startsWith(u8, key, "~grass~") or std.mem.startsWith(u8, key, "~frond~") or
                std.mem.startsWith(u8, key, "~water~") or std.mem.startsWith(u8, key, "~hf~") or
                std.mem.startsWith(u8, key, "~dyn~")) continue;
            // Opaque only (a glass pane shouldn't throw a solid shadow).
            if (c.scene3d_instance_count == 0 and c.scene3d_color_a < 0.999) continue;
            const sl = lookupGeometry(key) orelse blk: {
                const verts = c.scene3d_vertices orelse break :blk null;
                if (c.scene3d_vert_count == 0) break :blk null;
                if (verts.len < @as(usize, c.scene3d_vert_count) * 8) break :blk null;
                break :blk internGeometry(queue, key, verts, c.scene3d_vert_count);
            } orelse continue;
            const grp_start = sh_top;
            var grp_cnt: u32 = 0;
            if (c.scene3d_instance_data) |idata| {
                const stride = c.scene3d_instance_stride;
                if (stride >= 9) {
                    const total: u32 = @intCast(idata.len / @max(1, stride));
                    const ifirst: u32 = @min(c.scene3d_instance_first, total);
                    const icount: u32 = @min(c.scene3d_instance_count, total - ifirst);
                    var ii: u32 = 0;
                    while (ii < icount and sh_top + @sizeOf(InstanceData) <= sh_cap) : (ii += 1) {
                        const base = @as(usize, ifirst + ii) * stride;
                        const sb: usize = if (stride >= 12) 6 else 3;
                        const cb: usize = if (stride >= 12) 9 else 6;
                        const idx: usize = @intCast(sh_top / @sizeOf(InstanceData));
                        sh_scratch[idx] = makeInstance(
                            idata[base + 0],
                            idata[base + 1],
                            idata[base + 2],
                            if (stride >= 12) idata[base + 3] else 0,
                            if (stride >= 12) idata[base + 4] else 0,
                            if (stride >= 12) idata[base + 5] else 0,
                            idata[base + sb + 0],
                            idata[base + sb + 1],
                            idata[base + sb + 2],
                            idata[base + cb + 0],
                            idata[base + cb + 1],
                            idata[base + cb + 2],
                            1.0,
                        );
                        sh_top += @sizeOf(InstanceData);
                        grp_cnt += 1;
                    }
                }
            } else if (sh_top + @sizeOf(InstanceData) <= sh_cap) {
                const idx: usize = @intCast(sh_top / @sizeOf(InstanceData));
                sh_scratch[idx] = makeInstance(
                    c.scene3d_pos_x,
                    c.scene3d_pos_y,
                    c.scene3d_pos_z,
                    c.scene3d_rot_x,
                    c.scene3d_rot_y,
                    c.scene3d_rot_z,
                    c.scene3d_scale_x,
                    c.scene3d_scale_y,
                    c.scene3d_scale_z,
                    c.scene3d_color_r,
                    c.scene3d_color_g,
                    c.scene3d_color_b,
                    1.0,
                );
                sh_top += @sizeOf(InstanceData);
                grp_cnt += 1;
            }
            if (grp_cnt > 0) {
                sh_rec_off[sh_nrec] = grp_start;
                sh_rec_cnt[sh_nrec] = grp_cnt;
                sh_rec_slot[sh_nrec] = sl;
                sh_nrec += 1;
            }
        }
        if (sh_nrec > 0 and g_shadow_inst_buf != null) {
            const start_idx: usize = 0;
            const total_inst: usize = @intCast(sh_top / @sizeOf(InstanceData));
            bu.writeTypedBuffer(queue, g_shadow_inst_buf.?, 0, InstanceData, sh_scratch[start_idx .. start_idx + total_inst]);
            const spass = encoder.beginRenderPass(&.{
                .color_attachment_count = 0,
                .color_attachments = &[_]wgpu.ColorAttachment{},
                .depth_stencil_attachment = &wgpu.DepthStencilAttachment{
                    .view = g_shadow_view.?,
                    .depth_load_op = .clear,
                    .depth_store_op = .store,
                    .depth_clear_value = 1.0,
                    .stencil_load_op = .clear,
                    .stencil_store_op = .store,
                    .stencil_clear_value = 0,
                },
            });
            if (spass) |sp| {
                sp.setPipeline(g_shadow_pipeline.?);
                sp.setBindGroup(0, g_shadow_pass_bind_group.?, 0, null);
                var ri: usize = 0;
                while (ri < sh_nrec) : (ri += 1) {
                    const sl = sh_rec_slot[ri];
                    if (sl.count == 0) continue; // empty mesh (req_2806) — 0-byte setVertexBuffer aborts wgpu
                    sp.setVertexBuffer(0, g_retained_vbuf.?, sl.offset, bu.bytesOfCount(Vertex, sl.count));
                    sp.setVertexBuffer(1, g_shadow_inst_buf.?, sh_rec_off[ri], bu.bytesOfCount(InstanceData, sh_rec_cnt[ri]));
                    sp.draw(sl.count, sh_rec_cnt[ri], 0, 0);
                }
                sp.end();
                shadow_on = true;
            }
        }
    }
    const pass = encoder.beginRenderPass(&.{
        .color_attachment_count = 1,
        .color_attachments = @ptrCast(&wgpu.ColorAttachment{
            .view = color_view,
            .load_op = .clear,
            .store_op = .store,
            .clear_value = .{ .r = clear_color[0], .g = clear_color[1], .b = clear_color[2], .a = 1.0 },
        }),
        .depth_stencil_attachment = &wgpu.DepthStencilAttachment{
            .view = depth_view,
            .depth_load_op = .clear,
            .depth_store_op = .store,
            .depth_clear_value = 1.0,
            .stencil_load_op = .clear,
            .stencil_store_op = .store,
            .stencil_clear_value = 0,
        },
    }) orelse {
        encoder.release();
        return;
    };

    // ── Skybox first: fills the whole target behind the meshes ──
    if (sky_node) |s| drawSky(io, pass, queue, s, vp, cam_pos);

    pass.setPipeline(g_pipeline.?);

    // ── Scene uniforms: ONE write per frame (no dynamic offset). The per-mesh
    //    model matrix + color moved into per-instance vertex attributes below. ──
    // Wrapped wall-clock (mod 1e6 s) so float32 keeps precision — the grass
    // pipeline's wind reads S.time. Same wrap drawSky uses for cloud drift.
    const scene_time: f32 = @as(f32, @floatFromInt(@mod(std.Io.Clock.now(.awake, io).toMilliseconds(), 1_000_000))) / 1000.0;
    // Upload the placed lights collected above. The shader loops light_count of
    // them; an empty frame writes nothing and the loop runs zero times.
    if (n_placed > 0) {
        if (g_lights_buf) |lb| {
            queue.writeBuffer(lb, 0, @ptrCast(&placed_lights), n_placed * @sizeOf(Light));
        }
    }
    const scene_u = SceneUniforms{
        .vp = math.m4transpose(vp),
        .light_dir = light_dir,
        .specular_power = 64.0,
        .light_color = light_color,
        .light_count = @floatFromInt(n_placed),
        .ambient_color = ambient_color,
        .camera_pos = .{ cam_pos.x, cam_pos.y, cam_pos.z },
        .time = scene_time,
        .fog_color = fog_color,
        .fog_near = fog_near,
        .fog_far = fog_far,
        .fog_sky = fog_sky,
        .wire = if (scene_node.scene3d_wireframe) 1 else 0,
        .sky_horizon = sky_horizon,
        .sky_zenith = .{ sky_zenith[0], sky_zenith[1], sky_zenith[2], 0 },
    };
    bu.writeValue(queue, g_uniform_buffer.?, 0, &scene_u);
    // Shadow uniform for the main fragment shader: the caster's light VP + the gate.
    // has_shadow is on only when the depth pass above actually populated the map.
    const shadow_u = ShadowUniforms{
        .light_vp = caster_lvp_t,
        .has_shadow = if (shadow_on) 1 else 0,
        .caster_index = if (shadow_caster >= 0) @floatFromInt(shadow_caster) else 0,
        .texel = 1.0 / @as(f32, @floatFromInt(SHADOW_MAP_SIZE)),
    };
    if (g_shadow_uniform_buf) |sb| bu.writeValue(queue, sb, 0, &shadow_u);
    pass.setBindGroup(0, g_bind_group.?, 0, null);

    // ── Pass 1: resolve each mesh (geometry slot, texture bind group). Skips
    //    nodes whose first-paint upload would miss the cache (broken state). ──
    // Keep mesh collection aligned with the instance-buffer cap. A lower
    // collection cap silently drops later Scene3D.Mesh children in large maps.
    var midx: [MAX_SCENE_MESHES]u32 = undefined;
    var mslot: [MAX_SCENE_MESHES]GeoSlice = undefined;
    var mtex: [MAX_SCENE_MESHES]?*wgpu.BindGroup = undefined;
    var mvisited: [MAX_SCENE_MESHES]bool = [_]bool{false} ** MAX_SCENE_MESHES;
    var mcount: usize = 0;
    var collected_logical: u32 = 0;
    // Transparent (alpha<1) single meshes are collected separately and drawn in a
    // back-to-front pass after the opaque batch. Distance is cached for the sort.
    var tidx: [MAX_SCENE_MESHES]u32 = undefined;
    var tslot: [MAX_SCENE_MESHES]GeoSlice = undefined;
    var ttex: [MAX_SCENE_MESHES]?*wgpu.BindGroup = undefined;
    var tdist: [MAX_SCENE_MESHES]f32 = undefined;
    var tcount: usize = 0;
    // Ground-formula single meshes — collected separately, drawn in their own
    // opaque pass binding each chunk's D ref stream (the data-shape ground).
    var gidx: [GROUND_POOL]u32 = undefined;
    var gslot: [GROUND_POOL]GeoSlice = undefined;
    var gshared: [GROUND_POOL]bool = undefined;
    var gcount: usize = 0;
    var dbg_ground_seen: u32 = 0; // ground-formula meshes SEEN (uncapped) vs gcount collected

    var dbg_inst_seen: u32 = 0; // req_0727: instanced (bucket) meshes seen vs collected
    var dbg_inst_collected: u32 = 0;
    var ci: u32 = 0;
    while (ci < scene_node.children.len and mcount < MAX_SCENE_MESHES) : (ci += 1) {
        const child = &scene_node.children[ci];
        if (!child.scene3d_mesh) continue;
        if (child.scene3d_instance_count > 0) dbg_inst_seen += 1;
        if (child.scene3d_ground_formula != null) dbg_ground_seen += 1; // total ground meshes (pre-cull)
        // Draw-radius cull. Only with an explicit camera `far`, and only for
        // single (non-instanced) meshes — an instance batch carries many
        // positions, not this node's one. Skip if the mesh's nearest point is
        // past the radius. The clip plane already handles the rest; this saves
        // the per-mesh CPU/instance work for things fully beyond the horizon.
        if (cam_far > 0 and child.scene3d_instance_count == 0) {
            const center = math.Vec3{ .x = child.scene3d_pos_x, .y = child.scene3d_pos_y, .z = child.scene3d_pos_z };
            if (math.v3distance(center, cam_pos) - estimateMeshRadius(child) > draw_radius) continue;
        }
        const key = child.scene3d_geom_key orelse continue;

        var maybe_slot: ?GeoSlice = null;
        const shared_ground = child.scene3d_ground_formula != null and
            terrain_grid.hasTrailer(child.scene3d_ground_data) and
            g_ground_grid_vbuf != null and g_ground_grid_vert_count > 0;
        if (shared_ground) {
            // Formula-painted terrain is a data grid. Every chunk draws the one
            // immutable topology; its D binding supplies current heights.
            maybe_slot = .{ .offset = 0, .count = g_ground_grid_vert_count };
        } else if (std.mem.startsWith(u8, key, "~hf~")) {
            // Host-generated heightfield: JS ships only the cols×rows height grid;
            // the host bakes the mesh verts into the slot (topology is fixed, only y
            // moves). Far cheaper across the bridge than re-shipping ~86k verts/sculpt.
            maybe_slot = resolveDynamicHeightfield(
                io,
                queue,
                key,
                child.scene3d_heights,
                child.scene3d_hf_cols,
                child.scene3d_hf_rows,
                child.scene3d_hf_width,
                child.scene3d_hf_depth,
                child.scene3d_hf_base,
                .{
                    .amp = child.scene3d_hf_wave_amp,
                    .len = child.scene3d_hf_wave_len,
                    .speed = child.scene3d_hf_wave_speed,
                    .dx = child.scene3d_hf_wave_dx,
                    .dz = child.scene3d_hf_wave_dz,
                },
                child.scene3d_hf_depths,
            );
            if (maybe_slot == null) continue;
        } else if (std.mem.startsWith(u8, key, "~dyn~")) {
            // Live-edited geometry: reused per-slot, overwritten on version change.
            maybe_slot = resolveDynamicGeom(queue, key, child.scene3d_vertices, child.scene3d_vert_count);
            if (maybe_slot == null) continue;
        } else {
            maybe_slot = lookupGeometry(key);
            if (maybe_slot == null) {
                // Host-loaded model (drop-to-view): the parse door stashed verts under
                // this key; intern them now that we hold the GPU queue. No JS verts.
                maybe_slot = internFromStash(queue, key);
            }
            if (maybe_slot == null) {
                // First mesh per key in this scene must carry verts (the dedup path
                // only ships verts on the first per key; later ones cache-hit).
                const verts = child.scene3d_vertices orelse continue;
                if (child.scene3d_vert_count == 0) continue;
                if (verts.len < @as(usize, child.scene3d_vert_count) * 8) continue;
                maybe_slot = internGeometry(queue, key, verts, child.scene3d_vert_count);
                if (maybe_slot == null) continue;
            }
        }

        // Ground-formula mesh: skip the textured batches; collect for the dedicated
        // ground pass (binds the per-chunk D ref stream + the ground pipeline).
        if (child.scene3d_ground_formula != null) {
            if (gcount < GROUND_POOL) {
                gidx[gcount] = ci;
                gslot[gcount] = maybe_slot.?;
                gshared[gcount] = shared_ground;
                gcount += 1;
                collected_logical += 1;
            }
            continue;
        }

        var tex_bg: ?*wgpu.BindGroup = g_default_tex_bind_group;
        if (child.scene3d_tex_rgba) |rgba| {
            if (getOrCreateTexBindGroup(rgba, child.scene3d_tex_w, child.scene3d_tex_h)) |bg| tex_bg = bg;
        }
        // Paint target: bind its OWN in-place-updated paint texture as the diffuse, so
        // each face shows its painted colour (its verts' UVs map to one atlas texel/
        // face). Uses paintBindGroup, NOT the content-hash cache (which aliases on
        // single-face changes — the delayed/threshold paint bug).
        if (child.scene3d_geom_key) |gk| {
            if (model_paint.isTarget(hashKey(gk))) {
                if (paintBindGroup()) |bg| tex_bg = bg;
            }
        }
        if (child.scene3d_tex_key) |tk| {
            if (images.staticSurfaceBindGroup3D(tk)) |bg| tex_bg = bg;
        }

        // Per-face GLASS on the resident edit mesh: glass faces live in ONE trailing
        // run (partitionGlassFaces keeps that invariant), so the opaque pass draws the
        // prefix and the trailing run rides the transparent pass (depth-write off,
        // far→near) — per-face translucency on a single resident model.
        if (child.scene3d_instance_count == 0 and model_paint.isTarget(hashKey(key))) {
            const gv = editGlassFirstVert();
            const slot0 = maybe_slot.?;
            if (gv < slot0.count) {
                if (tcount < MAX_SCENE_MESHES) {
                    const gc = math.Vec3{ .x = child.scene3d_pos_x, .y = child.scene3d_pos_y, .z = child.scene3d_pos_z };
                    tidx[tcount] = ci;
                    tslot[tcount] = .{ .offset = slot0.offset + @as(u64, gv) * @sizeOf(Vertex), .count = slot0.count - gv };
                    ttex[tcount] = tex_bg;
                    tdist[tcount] = math.v3distance(gc, cam_pos);
                    tcount += 1;
                    collected_logical += 1;
                }
                if (gv == 0) continue; // the whole mesh is glass
                maybe_slot.?.count = gv; // opaque pass draws only the opaque prefix
            }
        }

        // Route alpha<1 single meshes to the transparent list; everything else
        // (opaque, and all instanced batches) stays on the opaque fast path.
        if (child.scene3d_instance_count == 0 and child.scene3d_color_a < 0.999) {
            if (tcount < MAX_SCENE_MESHES) {
                const tc = math.Vec3{ .x = child.scene3d_pos_x, .y = child.scene3d_pos_y, .z = child.scene3d_pos_z };
                tidx[tcount] = ci;
                tslot[tcount] = maybe_slot.?;
                ttex[tcount] = tex_bg;
                tdist[tcount] = math.v3distance(tc, cam_pos);
                tcount += 1;
                collected_logical += 1;
            }
            continue;
        }

        midx[mcount] = ci;
        mslot[mcount] = maybe_slot.?;
        mtex[mcount] = tex_bg;
        mcount += 1;
        if (child.scene3d_instance_count > 0) dbg_inst_collected += 1;
        collected_logical += if (child.scene3d_instance_count > 0) child.scene3d_instance_count else 1;
    }
    const collected_count: u32 = collected_logical;
    g_telemetry.meshes_collected += collected_count;
    if (scene_mesh_children > collected_count) g_telemetry.meshes_dropped += scene_mesh_children - collected_count;
    // req_0727 one-shot-per-~120-frames census: instanced bucket meshes seen vs
    // collected, + total scene children. If seen>0 but collected==0, pass 1 is
    // dropping the building buckets (geometry key never cached / no verts);
    // if seen==collected, they pass collection and the DRAW is the suspect.
    g_dbg_frame += 1;
    if (censusOn() and g_dbg_frame % 120 == 1) {
        const retained_kverts = g_retained_top / @sizeOf(Vertex) / 1000;
        log.print("[r3d-census] children={d} inst_seen={d} inst_collected={d} mcount={d} tcount={d} geo_cache_len={d} retained={d}k/{d}k verts\n", .{ scene_node.children.len, dbg_inst_seen, dbg_inst_collected, mcount, tcount, g_geo_cache_len, retained_kverts, MAX_RETAINED_VERTS / 1000 });
    }

    // ── Pass 2: group by (slot.offset, tex_bg) and issue ONE instanced draw per
    //    group. slot.offset is the cache offset for a key — identity-by-offset
    //    is equivalent to identity-by-key since each key has one cache entry. ──
    const inst_cap_bytes: u64 = @as(u64, MAX_INSTANCES) * @sizeOf(InstanceData);
    const inst_scratch = &g_inst_scratch; // BSS-resident staging buffer (off the stack)
    var inst_top: u64 = 0;
    // Frond overflow rows stage into their OWN slim buffer (separate format/stride),
    // so they get their own per-frame cursor + cap, parallel to inst_top above.
    const slim_inst_scratch = &g_slim_inst_scratch;
    const slim_cap_bytes: u64 = @as(u64, MAX_INSTANCES) * @sizeOf(SlimInstance);
    var slim_inst_top: u64 = 0;
    // g_pipeline is the bound pipeline coming in (set above). A sentinel-flagged
    // group ("~grass~"/"~water~" tex-key) swaps to its companion pipeline for the
    // draw and we swap back for the next plain group — all three share the exact
    // pipeline layout, so the bound group0/group1 stay valid across the switch.
    var cur_special: ?*wgpu.RenderPipeline = null;
    var gi: usize = 0;
    while (gi < mcount) : (gi += 1) {
        if (mvisited[gi]) continue;
        const group_slot = mslot[gi];
        const group_tex = mtex[gi];

        // STATIC FAST PATH: a node flagged scene3d_instance_static is uploaded once
        // to g_static_inst_buf and redrawn straight from it — no per-frame restage or
        // upload. Each static batch is its own draw (not merged), which is exactly
        // the loader's static world (one box batch + one ramp batch). Many nodes may
        // share one upload and draw sub-ranges of it (scene3d_instance_first +
        // scene3d_instance_count — world streaming's per-chunk draws). Falls through
        // to the dynamic path if the retained buffer is full.
        const leader = &scene_node.children[midx[gi]];
        // Route grass/water groups to their companion pipeline (wind + cutout +
        // gradient for grass; FBM waves + foam + dither for water). A null key, or
        // any other key, falls back to the plain mesh pipeline.
        const want_special: ?*wgpu.RenderPipeline = blk: {
            const k = leader.scene3d_tex_key orelse break :blk null;
            if (g_grass_pipeline != null and std.mem.startsWith(u8, k, "~grass~")) break :blk g_grass_pipeline.?;
            if (g_water_pipeline != null and std.mem.startsWith(u8, k, "~water~")) break :blk g_water_pipeline.?;
            if (g_frond_pipeline != null and std.mem.startsWith(u8, k, "~frond~")) break :blk g_frond_pipeline.?;
            break :blk null;
        };
        if (want_special != cur_special) {
            pass.setPipeline(want_special orelse g_pipeline.?);
            cur_special = want_special;
        }
        // Foliage cards (grass/bush/flower via ~grass~, palm fronds via ~frond~) use
        // the slim 24-byte SlimInstance buffer + format; everyone else (incl. water)
        // the 80-byte InstanceData. Branch the staging/binding accordingly.
        const is_slim = want_special != null and
            (want_special == g_grass_pipeline or want_special == g_frond_pipeline);
        if (leader.scene3d_instance_static) {
            if (leader.scene3d_instance_data) |idata| {
                const sd_opt = if (is_slim)
                    resolveStaticSlimInstances(device, queue, idata, leader.scene3d_instance_stride, leader.scene3d_instance_version)
                else
                    resolveStaticInstances(device, queue, idata, leader.scene3d_instance_stride, leader.scene3d_instance_version);
                if (sd_opt) |sd| {
                    mvisited[gi] = true;
                    const first: u32 = @min(leader.scene3d_instance_first, sd.count);
                    const count: u32 = @min(leader.scene3d_instance_count, sd.count - first);
                    if (count > 0 and group_slot.count > 0) {
                        if (group_tex) |bg| pass.setBindGroup(1, bg, 0, null);
                        pass.setVertexBuffer(0, g_retained_vbuf.?, group_slot.offset, bu.bytesOfCount(Vertex, group_slot.count));
                        if (leader.scene3d_instance_segments) |segments| {
                            // req_2859: chunk-granular frustum culling — draw only
                            // the segments whose sphere survives the frustum, and
                            // coalesce adjacent survivors into one draw. Segment
                            // ranges are absolute rows of the batch, clamped to
                            // what actually staged.
                            // req_2868: with lod_density, a FAR segment draws only
                            // a prefix of its (producer-shuffled) rows — sub-pixel
                            // distant plants thin out, near segments stay exact.
                            // Partial segments draw alone; only full ones coalesce.
                            const lod_on = leader.scene3d_instance_lod_density;
                            var run_first: u32 = 0;
                            var run_count: u32 = 0;
                            for (segments) |seg| {
                                const sfirst = @min(seg.first, count);
                                var scount = @min(seg.count, count - sfirst);
                                if (scount == 0) continue;
                                if (!sphereInFrustum(&frustum_planes, seg.cx, seg.cy, seg.cz, seg.radius)) continue;
                                var partial = false;
                                if (lod_on) {
                                    const ddx = seg.cx - cam_pos.x;
                                    const ddy = seg.cy - cam_pos.y;
                                    const ddz = seg.cz - cam_pos.z;
                                    const dist = @sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
                                    if (dist > FOLIAGE_LOD_NEAR_M) {
                                        const t = @min(1.0, (dist - FOLIAGE_LOD_NEAR_M) / (FOLIAGE_LOD_FAR_M - FOLIAGE_LOD_NEAR_M));
                                        const density = 1.0 - t * (1.0 - FOLIAGE_LOD_FLOOR);
                                        const thinned: u32 = @ceil(@as(f32, @floatFromInt(scount)) * density);
                                        if (thinned < scount) {
                                            scount = @max(1, thinned);
                                            partial = true;
                                        }
                                    }
                                }
                                if (!partial and run_count > 0 and run_first + run_count == sfirst) {
                                    run_count += scount;
                                } else {
                                    drawStaticInstanceRange(pass, group_slot.count, sd.offset, is_slim, run_first, run_count);
                                    if (partial) {
                                        drawStaticInstanceRange(pass, group_slot.count, sd.offset, is_slim, sfirst, scount);
                                        run_first = 0;
                                        run_count = 0;
                                    } else {
                                        run_first = sfirst;
                                        run_count = scount;
                                    }
                                }
                            }
                            drawStaticInstanceRange(pass, group_slot.count, sd.offset, is_slim, run_first, run_count);
                        } else {
                            drawStaticInstanceRange(pass, group_slot.count, sd.offset, is_slim, first, count);
                        }
                    }
                    continue;
                }
            }
        }

        // Per-frame foliage-card overflow draws from g_slim_inst_buf (slim format); the
        // standard families draw from g_instance_buf. One leader's group is wholly
        // one or the other (same tex key → same pipeline), so this branch is total.
        if (is_slim) {
            const fstart = slim_inst_top;
            var fcount: u32 = 0;
            var hf: usize = gi;
            while (hf < mcount) : (hf += 1) {
                if (mvisited[hf]) continue;
                if (mslot[hf].offset != group_slot.offset) continue;
                if (mtex[hf] != group_tex) continue;
                if (hf != gi and scene_node.children[midx[hf]].scene3d_instance_static) continue;
                if (slim_inst_top + @sizeOf(SlimInstance) > slim_cap_bytes) {
                    framePoolWarn("slim (foliage)");
                    break;
                }
                const child = &scene_node.children[midx[hf]];
                if (child.scene3d_instance_data) |idata| {
                    const stride = child.scene3d_instance_stride;
                    if (stride >= 12) {
                        const total_rows: u32 = @intCast(idata.len / stride);
                        const ifirst: u32 = @min(child.scene3d_instance_first, total_rows);
                        const icount: u32 = @min(child.scene3d_instance_count, total_rows - ifirst);
                        if (icount > 0 and slim_inst_top + @as(u64, icount) * @sizeOf(SlimInstance) > slim_cap_bytes) framePoolWarn("slim (foliage)");
                        var ii: u32 = 0;
                        while (ii < icount and slim_inst_top + @sizeOf(SlimInstance) <= slim_cap_bytes) : (ii += 1) {
                            const base = @as(usize, ifirst + ii) * stride;
                            const fi: usize = @intCast(slim_inst_top / @sizeOf(SlimInstance));
                            slim_inst_scratch[fi] = makeSlimInstance(
                                idata[base + 0],
                                idata[base + 1],
                                idata[base + 2],
                                idata[base + 3],
                                idata[base + 4],
                                idata[base + 6],
                                idata[base + 7],
                                idata[base + 9],
                                idata[base + 10],
                                idata[base + 11],
                            );
                            slim_inst_top += @sizeOf(SlimInstance);
                            fcount += 1;
                        }
                    }
                }
                mvisited[hf] = true;
            }
            if (fcount == 0 or group_slot.count == 0) continue;
            const fstart_index: usize = @intCast(fstart / @sizeOf(SlimInstance));
            bu.writeTypedBuffer(queue, g_slim_inst_buf.?, fstart, SlimInstance, slim_inst_scratch[fstart_index .. fstart_index + fcount]);
            if (group_tex) |bg| pass.setBindGroup(1, bg, 0, null);
            pass.setVertexBuffer(0, g_retained_vbuf.?, group_slot.offset, bu.bytesOfCount(Vertex, group_slot.count));
            pass.setVertexBuffer(1, g_slim_inst_buf.?, fstart, bu.bytesOfCount(SlimInstance, fcount));
            pass.draw(group_slot.count, fcount, 0, 0);
            recordDraw(group_slot.count, fcount);
            g_telemetry.staged_dynamic += fcount;
            continue;
        }

        const inst_start = inst_top;
        var group_count: u32 = 0;

        var hi: usize = gi;
        while (hi < mcount) : (hi += 1) {
            if (mvisited[hi]) continue;
            if (mslot[hi].offset != group_slot.offset) continue;
            if (mtex[hi] != group_tex) continue;
            // A STATIC-instanced batch draws on its own leader turn (the fast
            // path above) — never fold it into another leader's dynamic group.
            // Folding staged idata[0..count] and ignored scene3d_instance_first,
            // so a plain mesh sharing the batch's (geometry, texture) — e.g. a
            // live prop box beside the streamed world's box family — made every
            // sub-range chunk draw the WRONG rows (req_0631's partial renders:
            // walls vanished while their building's other faces drew).
            if (hi != gi and scene_node.children[midx[hi]].scene3d_instance_static) continue;
            if (inst_top + @sizeOf(InstanceData) > inst_cap_bytes) {
                framePoolWarn("standard");
                break; // overflow
            }

            const child = &scene_node.children[midx[hi]];
            if (child.scene3d_instance_data) |idata| {
                const stride = child.scene3d_instance_stride;
                // Honor the sub-range here too (the static→dynamic degrade path
                // when the retained instance buffer is full): stage rows starting
                // at scene3d_instance_first, clamped to the data's real length.
                const total_rows: u32 = @intCast(idata.len / @max(1, stride));
                const ifirst: u32 = @min(child.scene3d_instance_first, total_rows);
                const icount: u32 = @min(child.scene3d_instance_count, total_rows - ifirst);
                if (stride >= 9 and icount > 0) {
                    if (inst_top + @as(u64, icount) * @sizeOf(InstanceData) > inst_cap_bytes) framePoolWarn("standard");
                    var ii: u32 = 0;
                    while (ii < icount and inst_top + @sizeOf(InstanceData) <= inst_cap_bytes) : (ii += 1) {
                        const base = @as(usize, ifirst + ii) * stride;
                        const inst_index: usize = @intCast(inst_top / @sizeOf(InstanceData));
                        const scale_base: usize = if (stride >= 12) 6 else 3;
                        const color_base: usize = if (stride >= 12) 9 else 6;
                        inst_scratch[inst_index] = makeInstance(
                            idata[base + 0],
                            idata[base + 1],
                            idata[base + 2],
                            if (stride >= 12) idata[base + 3] else 0,
                            if (stride >= 12) idata[base + 4] else 0,
                            if (stride >= 12) idata[base + 5] else 0,
                            idata[base + scale_base + 0],
                            idata[base + scale_base + 1],
                            idata[base + scale_base + 2],
                            idata[base + color_base + 0],
                            idata[base + color_base + 1],
                            idata[base + color_base + 2],
                            1.0, // instanced batches stay opaque (3-float color stride)
                        );
                        inst_top += @sizeOf(InstanceData);
                        group_count += 1;
                    }
                }
            } else {
                const inst_index: usize = @intCast(inst_top / @sizeOf(InstanceData));
                inst_scratch[inst_index] = makeInstance(
                    child.scene3d_pos_x,
                    child.scene3d_pos_y,
                    child.scene3d_pos_z,
                    child.scene3d_rot_x,
                    child.scene3d_rot_y,
                    child.scene3d_rot_z,
                    child.scene3d_scale_x,
                    child.scene3d_scale_y,
                    child.scene3d_scale_z,
                    child.scene3d_color_r,
                    child.scene3d_color_g,
                    child.scene3d_color_b,
                    child.scene3d_color_a,
                );
                inst_top += @sizeOf(InstanceData);
                group_count += 1;
            }
            mvisited[hi] = true;
        }

        if (group_count == 0 or group_slot.count == 0) continue;
        const inst_start_index: usize = @intCast(inst_start / @sizeOf(InstanceData));
        bu.writeTypedBuffer(queue, g_instance_buf.?, inst_start, InstanceData, inst_scratch[inst_start_index .. inst_start_index + group_count]);
        if (group_tex) |bg| pass.setBindGroup(1, bg, 0, null);
        const geo_bytes = bu.bytesOfCount(Vertex, group_slot.count);
        pass.setVertexBuffer(0, g_retained_vbuf.?, group_slot.offset, geo_bytes);
        pass.setVertexBuffer(1, g_instance_buf.?, inst_start, bu.bytesOfCount(InstanceData, group_count));
        pass.draw(group_slot.count, group_count, 0, 0);
        recordDraw(group_slot.count, group_count);
        g_telemetry.staged_dynamic += group_count; // re-staged this frame (overflow path)
    }

    // ── Transparent pass ──────────────────────────────────────────────────
    // ── Ground-formula pass (the data-shape ground): each chunk floor runs its
    //    surface formula per fragment instead of sampling a baked texture. Opaque,
    //    so drawn after the opaque batch and before the transparent pass. Build the
    //    one pipeline lazily, then per chunk upload its D ref stream to a pool
    //    buffer, write the model instance, and draw. ──
    var dbg_ground_drawn: u32 = 0;
    // The ground pass writes into its OWN g_ground_inst_buf (one InstanceData per drawn
    // chunk, indexed by gp_i), so a view full of foliage that exhausted the shared
    // per-frame inst_top can no longer starve the ground — the floor always draws (req_1659).
    if (gcount > 0 and g_ground_inst_buf != null and scene_node.children[gidx[0]].scene3d_ground_formula != null) {
        ensureGroundPipeline(io, environ, scene_node.children[gidx[0]].scene3d_ground_formula.?);
        if (g_ground_pipeline) |gp| {
            pass.setPipeline(gp);
            pass.setBindGroup(0, g_bind_group.?, 0, null);
            var gp_i: usize = 0;
            while (gp_i < gcount) : (gp_i += 1) {
                const child = &scene_node.children[gidx[gp_i]];
                const pool = gp_i; // gcount <= GROUND_POOL → one distinct D buffer per draw
                if (g_ground_data_buf[pool] == null or g_ground_data_bg[pool] == null) continue;
                const d = child.scene3d_ground_data orelse continue;
                const n = @min(d.len, GROUND_DATA_FLOATS);
                // Truncation is LOUD (req_2697): a D stream past the pooled buffer
                // cap renders as "paint works up to a perfect line, then defaults" —
                // never let that hunt start silently again. Revise terrain_grid's
                // wire layout deliberately when the formula prefix grows.
                if (d.len > GROUND_DATA_FLOATS and !g_ground_truncate_warned) {
                    g_ground_truncate_warned = true;
                    log.print("[r3d-ground] ERROR: ground D stream is {d} floats but the shared terrain wire caps at {d}; rendering is truncated\n", .{ d.len, GROUND_DATA_FLOATS });
                }
                const data_ptr = @intFromPtr(d.ptr);
                if (g_ground_data_ptr[pool] != data_ptr or
                    g_ground_data_version[pool] != child.scene3d_ground_data_version or
                    g_ground_data_len[pool] != d.len)
                {
                    // writeTypedBuffer derives its byte count as u64, preserving
                    // the req_0842 overflow fix. Stable chunks now upload once,
                    // rather than re-shipping ~190 KiB every frame.
                    bu.writeTypedBuffer(queue, g_ground_data_buf[pool].?, 0, f32, d[0..n]);
                    if (!terrain_grid.hasTrailer(d)) {
                        // Pool entries follow draw order, so a legacy formula can
                        // inherit a previous shared-grid marker unless we clear it.
                        const no_marker: f32 = 0;
                        bu.writeValue(
                            queue,
                            g_ground_data_buf[pool].?,
                            terrain_grid.MARKER_OFFSET * @sizeOf(f32),
                            &no_marker,
                        );
                    }
                    g_ground_data_ptr[pool] = data_ptr;
                    g_ground_data_version[pool] = child.scene3d_ground_data_version;
                    g_ground_data_len[pool] = d.len;
                }
                const gi_off: u64 = @as(u64, @intCast(gp_i)) * @sizeOf(InstanceData);
                var gi_data = makeInstance(
                    child.scene3d_pos_x,
                    child.scene3d_pos_y,
                    child.scene3d_pos_z,
                    child.scene3d_rot_x,
                    child.scene3d_rot_y,
                    child.scene3d_rot_z,
                    child.scene3d_scale_x,
                    child.scene3d_scale_y,
                    child.scene3d_scale_z,
                    child.scene3d_color_r,
                    child.scene3d_color_g,
                    child.scene3d_color_b,
                    child.scene3d_color_a,
                );
                bu.writeValue(queue, g_ground_inst_buf.?, gi_off, &gi_data);
                pass.setBindGroup(1, g_ground_data_bg[pool].?, 0, null);
                const geo_bytes: u64 = @as(u64, gslot[gp_i].count) * @sizeOf(Vertex);
                if (gshared[gp_i]) {
                    pass.setVertexBuffer(0, g_ground_grid_vbuf.?, 0, geo_bytes);
                } else {
                    pass.setVertexBuffer(0, g_retained_vbuf.?, gslot[gp_i].offset, geo_bytes);
                }
                pass.setVertexBuffer(1, g_ground_inst_buf.?, gi_off, @sizeOf(InstanceData));
                pass.draw(gslot[gp_i].count, 1, 0, 0);
                dbg_ground_drawn += 1;
                recordDraw(gslot[gp_i].count, 1);
            }
        }
    }
    if (censusOn() and g_dbg_frame % 120 == 1) {
        log.print("[ground-pass] seen={d} collected(gcount)={d} drawn={d} pool_cap={d} (dedicated inst buffer — foliage can't starve it)\n", .{ dbg_ground_seen, gcount, dbg_ground_drawn, GROUND_POOL });
    }

    // Glass and other alpha<1 meshes, drawn after every opaque draw so they read
    // a complete depth buffer, sorted far→near so overlapping panes blend in the
    // correct order. depth-write is off (g_pipeline_transparent), so panes don't
    // occlude each other or the geometry seen through them. Drawn one mesh per
    // draw — the exact sort matters more than batching, and glass is sparse.
    if (tcount > 0 and g_pipeline_transparent != null) {
        // Insertion sort by distance, far → near (descending).
        var si: usize = 1;
        while (si < tcount) : (si += 1) {
            const d = tdist[si];
            const vi = tidx[si];
            const vs = tslot[si];
            const vt = ttex[si];
            var sj: usize = si;
            while (sj > 0 and tdist[sj - 1] < d) : (sj -= 1) {
                tdist[sj] = tdist[sj - 1];
                tidx[sj] = tidx[sj - 1];
                tslot[sj] = tslot[sj - 1];
                ttex[sj] = ttex[sj - 1];
            }
            tdist[sj] = d;
            tidx[sj] = vi;
            tslot[sj] = vs;
            ttex[sj] = vt;
        }
        pass.setPipeline(g_pipeline_transparent.?);
        pass.setBindGroup(0, g_bind_group.?, 0, null);
        var ti: usize = 0;
        while (ti < tcount) : (ti += 1) {
            if (inst_top + @sizeOf(InstanceData) > inst_cap_bytes) break;
            if (tslot[ti].count == 0) continue; // empty mesh (req_2806) — 0-byte setVertexBuffer aborts wgpu
            const child = &scene_node.children[tidx[ti]];
            const inst_index: usize = @intCast(inst_top / @sizeOf(InstanceData));
            inst_scratch[inst_index] = makeInstance(
                child.scene3d_pos_x,
                child.scene3d_pos_y,
                child.scene3d_pos_z,
                child.scene3d_rot_x,
                child.scene3d_rot_y,
                child.scene3d_rot_z,
                child.scene3d_scale_x,
                child.scene3d_scale_y,
                child.scene3d_scale_z,
                child.scene3d_color_r,
                child.scene3d_color_g,
                child.scene3d_color_b,
                child.scene3d_color_a,
            );
            bu.writeValue(queue, g_instance_buf.?, inst_top, &inst_scratch[inst_index]);
            if (ttex[ti]) |bg| pass.setBindGroup(1, bg, 0, null);
            const geo_bytes: u64 = @as(u64, tslot[ti].count) * @sizeOf(Vertex);
            pass.setVertexBuffer(0, g_retained_vbuf.?, tslot[ti].offset, geo_bytes);
            pass.setVertexBuffer(1, g_instance_buf.?, inst_top, @sizeOf(InstanceData));
            pass.draw(tslot[ti].count, 1, 0, 0);
            inst_top += @sizeOf(InstanceData);
            recordDraw(tslot[ti].count, 1);
        }
    }

    pass.end();
    pass.release();
    const command = encoder.finish(&.{ .label = wgpu.StringView.fromSlice("r3d_cmd") }) orelse {
        encoder.release();
        return;
    };
    encoder.release();
    queue.submit(&.{command});
    command.release();
}
