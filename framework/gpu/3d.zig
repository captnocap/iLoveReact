//! 3d.zig — 3D rendering pipeline for wgpu
//!
//! Renders 3D.Mesh children to an offscreen texture with depth buffer,
//! composited into the 2D layout tree via images.queueQuad().
//! Reads camera/light/mesh props from the 3D.View node's children.

const std = @import("std");
const wgpu = @import("wgpu");
const bu = @import("buffer_upload.zig");
const shaders = @import("shaders.zig");
const core = @import("gpu.zig");
const images = @import("images.zig");
const build_options = @import("build_options");
const math = @import("../math/root.zig");
const layout = @import("../layout.zig");
const effect_assemble = @import("effect_assemble.zig");
const static_instance_policy = @import("static_instance_policy.zig");
const model_paint = @import("model_paint.zig");
const paint_program = @import("paint_program.zig");
const model_source = @import("model_source.zig");
const mesh_edit = @import("mesh_edit.zig");
const capsules = @import("capsules.zig");
const Node = layout.Node;

// ════════════════════════════════════════════════════════════════════════
// Vertex format: position(3) + normal(3) + uv(2) = 32 bytes
// ════════════════════════════════════════════════════════════════════════

const Vertex = extern struct {
    px: f32,
    py: f32,
    pz: f32,
    nx: f32,
    ny: f32,
    nz: f32,
    u: f32,
    v: f32,
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
const MAX_BUFFER_VERTS = MAX_BUFFER_BYTES / @sizeOf(Vertex); // 8,388,608 verts at 32 B/vert
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
};
var g_orbit: Orbit = .{};

/// Seed the orbit to frame a model of bounding `radius` about `target`. Called by the
/// load door the moment a model finishes parsing.
pub fn orbitFrame(target: [3]f32, radius: f32) void {
    g_orbit.target = target;
    g_orbit.radius = @max(1e-3, radius);
    g_orbit.dist = g_orbit.radius * 2.6;
    g_orbit.framed = true;
}
/// Orbit by a screen-space drag delta (pixels). Pitch clamps shy of the poles.
pub fn orbitDrag(dx: f32, dy: f32) void {
    g_orbit.yaw -= dx * 0.01;
    g_orbit.pitch += dy * 0.01;
    const lim: f32 = 1.5;
    g_orbit.pitch = @max(-lim, @min(lim, g_orbit.pitch));
}
/// Dolly in/out by a wheel delta (sign only matters). Clamped to a sane band of the
/// model radius so you can't fly through it or lose it.
pub fn orbitZoom(delta: f32) void {
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
var g_edit_key_hash: u64 = 0;
var g_edit_key: ?[]u8 = null;
var g_edit_verts: ?[]f32 = null; // active displayed mesh, interleaved 8 f32/vert
var g_edit_count: u32 = 0;
var g_edit_revision: u32 = 0;
var g_guard_before: ?[]f32 = null; // pre-gizmo face positions for safety prompt/revert
var g_guard_pending: bool = false;
var g_guard_bad_faces: u32 = 0;
var g_guard_face_count: u32 = 0;

fn clearMeshGuardSnapshot() void {
    if (g_guard_before) |p| std.heap.c_allocator.free(p);
    g_guard_before = null;
    g_guard_pending = false;
    g_guard_bad_faces = 0;
    g_guard_face_count = 0;
}

fn clearActiveEditMesh() void {
    clearMeshGuardSnapshot();
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
            queue.?.writeBuffer(
                buf.?,
                e.offset_bytes + @as(u64, first_vert) * @sizeOf(Vertex),
                @ptrCast(verts[start_f32..].ptr),
                bu.bytesOfCount(Vertex, vert_count),
            );
            patched = true;
        }
    }
    return patched;
}

fn applyMeshMutation(m: mesh_edit.Mutation) bool {
    if (!m.changed) return false;
    if (!copyPaintPositionsToEditVerts(m.first_face, m.last_face)) return false;
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
    mesh_edit.reset(); // topology changed (load or quality re-mesh) → rebuild lazily
}

pub fn meshEditActiveKey() ?[]const u8 {
    return g_edit_key;
}
pub fn meshEditActiveCount() u32 {
    return g_edit_count;
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

fn collectCurrentFaceColors() ?[]u8 {
    const fc = model_paint.faceCount();
    const colors = std.heap.c_allocator.alloc(u8, @as(usize, fc) * 4) catch return null;
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        const c = model_paint.faceColor(f) orelse model_paint.DEFAULT_FACE;
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

fn replaceActiveEditMesh(new_verts: []f32, count: u32) bool {
    const need = @as(usize, count) * 8;
    if (count < 3 or new_verts.len < need) return false;
    const old_colors = collectCurrentFaceColors();
    defer if (old_colors) |c| std.heap.c_allocator.free(c);

    const old_hash = g_edit_key_hash;
    g_edit_revision +%= 1;
    const key = std.fmt.allocPrint(std.heap.c_allocator, "modelview-edit-{x}-{d}", .{ old_hash, g_edit_revision }) catch return false;
    defer std.heap.c_allocator.free(key);

    // setPaintTarget rewrites UVs for the per-face paint atlas; retain/stash the same
    // mutated vertices so quality changes and first draw see the new topology.
    setPaintTarget(key, new_verts, count);
    model_source.retain(key, new_verts[0..need], count);
    applyCarriedFaceColors(old_colors, count / 3);
    if (!stashHostMesh(key, new_verts[0..need], count)) return false;
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

    var verts = std.ArrayListUnmanaged(f32){};
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
    const ok = replaceActiveEditMesh(owned, g_edit_count + 6);
    if (ok) mesh_edit.setMode(.edge);
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

    var verts = std.ArrayListUnmanaged(f32){};
    if (!appendCurrentDisplayed(&verts)) {
        verts.deinit(std.heap.c_allocator);
        return false;
    }

    var ok = false;
    if (selected_count == 2 and !edgeSharesVertex(edges[0], edges[1])) {
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
    const replaced = replaceActiveEditMesh(owned, g_edit_count + added);
    if (replaced) mesh_edit.setMode(.edge);
    return replaced;
}

/// Loop cut: slice the resident mesh by the plane perpendicular to the ONE selected edge,
/// through that edge's midpoint (Blender's rule — the new loop runs across the ring the
/// edge belongs to). Straddling faces split; authored face grouping (studio meshes)
/// carries through so each crossed n-gon becomes two clean faces — the host-native twin of
/// the Studio's loopCut(EditMesh). The heavy work is mesh_edit.planeCutSoup (pure, tested);
/// this derives the plane, rebuilds the interleaved edit mesh, and re-applies the grouping.
pub fn meshTopoLoopCut() bool {
    if (!model_paint.hasTarget()) return false;
    const edge_idx = mesh_edit.selectedEdgeIndexPub() orelse return false;
    const ep = mesh_edit.edgeEndpointsPub(edge_idx);
    const a = mesh_edit.vertPosPub(ep[0]);
    const b = mesh_edit.vertPosPub(ep[1]);
    var nrm = vsub(b, a);
    const l2 = vdot(nrm, nrm);
    if (l2 < 1e-12) return false;
    nrm = vmul(nrm, 1.0 / @sqrt(l2));
    const mid = vmul(vadd(a, b), 0.5);
    const d = vdot(nrm, mid);

    const verts = g_edit_verts orelse return false;
    const tri_count = g_edit_count / 3;
    if (tri_count == 0) return false;

    // Extract a positions-only soup (9 f32/tri) from the interleaved edit mesh.
    const pos = std.heap.c_allocator.alloc(f32, @as(usize, tri_count) * 9) catch return false;
    defer std.heap.c_allocator.free(pos);
    {
        var f: u32 = 0;
        while (f < tri_count) : (f += 1) {
            var k: u32 = 0;
            while (k < 3) : (k += 1) {
                const src = (@as(usize, f) * 3 + k) * 8;
                const dst = (@as(usize, f) * 3 + k) * 3;
                if (src + 2 >= verts.len) return false;
                pos[dst + 0] = verts[src + 0];
                pos[dst + 1] = verts[src + 1];
                pos[dst + 2] = verts[src + 2];
            }
        }
    }

    // Per-tri authored group (null when this mesh has no grouping — plain imports).
    var groups_buf: ?[]u32 = null;
    defer if (groups_buf) |g| std.heap.c_allocator.free(g);
    if (model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP) {
        const g = std.heap.c_allocator.alloc(u32, tri_count) catch return false;
        var i: u32 = 0;
        while (i < tri_count) : (i += 1) g[i] = model_source.faceGroupOf(i);
        groups_buf = g;
    }

    const groups_arg: ?[]const u32 = if (groups_buf) |g| g else null;
    const cut = mesh_edit.planeCutSoup(pos, tri_count, nrm, d, groups_arg) orelse return false;
    defer std.heap.c_allocator.free(cut.positions);
    defer if (cut.groups) |g| std.heap.c_allocator.free(g);
    if (cut.tri_count <= tri_count) return false; // the plane missed every face → not a cut

    // Rebuild the interleaved edit mesh (appendTri recomputes normals; UVs are rewritten by
    // setPaintTarget on install), then re-apply the fresh grouping AFTER the retain (which
    // clears it).
    var out = std.ArrayListUnmanaged(f32){};
    var t: u32 = 0;
    while (t < cut.tri_count) : (t += 1) {
        const bse = @as(usize, t) * 9;
        const p0: [3]f32 = .{ cut.positions[bse + 0], cut.positions[bse + 1], cut.positions[bse + 2] };
        const p1: [3]f32 = .{ cut.positions[bse + 3], cut.positions[bse + 4], cut.positions[bse + 5] };
        const p2: [3]f32 = .{ cut.positions[bse + 6], cut.positions[bse + 7], cut.positions[bse + 8] };
        if (!appendTri(&out, p0, p1, p2)) {
            out.deinit(std.heap.c_allocator);
            return false;
        }
    }
    const owned = out.toOwnedSlice(std.heap.c_allocator) catch {
        out.deinit(std.heap.c_allocator);
        return false;
    };
    defer std.heap.c_allocator.free(owned);

    const ok = replaceActiveEditMesh(owned, cut.tri_count * 3);
    if (ok) {
        if (cut.groups) |g| model_source.setFaceGroups(g);
        mesh_edit.setMode(.edge);
    }
    return ok;
}

/// Delete exactly the selected mesh elements: drop every triangle the current selection
/// marks (mesh_edit.buildDeleteMask — selected faces, or faces touching a selected vert/edge)
/// and rebuild the edit mesh from the survivors, carrying their face groups. Refuses to empty
/// the mesh (a no-op when nothing is selected or everything would go).
pub fn meshDeleteSelection() bool {
    if (!model_paint.hasTarget()) return false;
    const verts = g_edit_verts orelse return false;
    const tri_count = g_edit_count / 3;
    if (tri_count == 0) return false;

    const mask = std.heap.c_allocator.alloc(bool, tri_count) catch return false;
    defer std.heap.c_allocator.free(mask);
    const del = mesh_edit.buildDeleteMask(mask);
    if (del == 0 or del >= tri_count) return false;

    const has_groups = model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP;
    var out = std.ArrayListUnmanaged(f32){};
    var groups = std.ArrayListUnmanaged(u32){};
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
    if (kept < 3) {
        out.deinit(std.heap.c_allocator);
        return false;
    }
    const owned = out.toOwnedSlice(std.heap.c_allocator) catch {
        out.deinit(std.heap.c_allocator);
        return false;
    };
    defer std.heap.c_allocator.free(owned);

    const ok = replaceActiveEditMesh(owned, kept);
    if (ok and has_groups) model_source.setFaceGroups(groups.items);
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

pub const AppendResult = struct { ok: bool, lo: u32, hi: u32, count: u32 };

/// Append a fresh part's triangles to the LIVE edit mesh (which already carries the user's
/// deletes/edits), giving them a new authored-group range above every existing group. This is
/// how "add a part" preserves prior edits — it grows the host mesh instead of recomposing from
/// JS. `new_verts` is interleaved 8 f32/vert; `new_groups` is one authored id per new triangle
/// (part-local, 0-based). Returns the new group range [lo, hi).
pub fn meshAppendGroup(new_verts: []const f32, new_count: u32, new_groups: []const u32) AppendResult {
    const fail = AppendResult{ .ok = false, .lo = 0, .hi = 0, .count = 0 };
    if (!model_paint.hasTarget()) return fail;
    const cur_verts = g_edit_verts orelse return fail;
    const cur_count = g_edit_count;
    const need = @as(usize, new_count) * 8;
    if (new_count < 3 or new_verts.len < need) return fail;

    const cur_groups = captureFaceGroups() orelse return fail;
    defer std.heap.c_allocator.free(cur_groups);
    const offset: u32 = @intCast(maxGroupId(cur_groups) + 1);

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

    var out = std.ArrayListUnmanaged(f32){};
    if (!appendFloats(&out, cur_verts[0 .. @as(usize, cur_count) * 8]) or !appendFloats(&out, new_verts[0..need])) {
        out.deinit(std.heap.c_allocator);
        return fail;
    }
    var groups = std.ArrayListUnmanaged(u32){};
    defer groups.deinit(std.heap.c_allocator);
    {
        var f: u32 = 0;
        while (f < cur_faces) : (f += 1) groups.append(std.heap.c_allocator, cur_groups[f]) catch {};
        var i: u32 = 0;
        while (i < new_faces) : (i += 1) groups.append(std.heap.c_allocator, (if (i < new_groups.len) new_groups[i] else 0) + offset) catch {};
    }
    const owned = out.toOwnedSlice(std.heap.c_allocator) catch {
        out.deinit(std.heap.c_allocator);
        return fail;
    };
    defer std.heap.c_allocator.free(owned);

    const ok = replaceActiveEditMesh(owned, cur_count + new_count);
    if (ok) model_source.setFaceGroups(groups.items);
    return .{ .ok = ok, .lo = offset, .hi = offset + new_group_span, .count = cur_count + new_count };
}

// Host-side stash of a hidden part: its exact triangles (interleaved verts) + authored groups,
// so hide is non-destructive and unhide restores the edited geometry (no JS round-trip).
const HiddenGroup = struct { lo: u32, hi: u32, verts: []f32, groups: []u32 };
var g_hidden_groups: std.ArrayListUnmanaged(HiddenGroup) = .{};

/// Hide or show the part occupying authored-group range [lo, hi). Hiding moves its triangles
/// out of the live mesh into a host stash (geometry never crosses the bridge); showing
/// re-appends them with their original groups. Returns whether the mesh changed.
pub fn meshSetGroupHidden(lo: u32, hi: u32, hidden: bool) bool {
    if (!model_paint.hasTarget()) return false;
    if (hidden) return hideGroup(lo, hi) else return showGroup(lo, hi);
}

fn hideGroup(lo: u32, hi: u32) bool {
    const cur_verts = g_edit_verts orelse return false;
    const cur_count = g_edit_count;
    const cur_faces = cur_count / 3;
    const cur_groups = captureFaceGroups() orelse return false;
    defer std.heap.c_allocator.free(cur_groups);

    var keep = std.ArrayListUnmanaged(f32){};
    var keep_g = std.ArrayListUnmanaged(u32){};
    defer keep_g.deinit(std.heap.c_allocator);
    var hid = std.ArrayListUnmanaged(f32){};
    var hid_g = std.ArrayListUnmanaged(u32){};
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
    if (ok) model_source.setFaceGroups(keep_g.items);
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

    var out = std.ArrayListUnmanaged(f32){};
    if (!appendFloats(&out, cur_verts[0 .. @as(usize, cur_count) * 8]) or !appendFloats(&out, entry.verts)) {
        out.deinit(std.heap.c_allocator);
        return false;
    }
    var groups = std.ArrayListUnmanaged(u32){};
    defer groups.deinit(std.heap.c_allocator);
    for (cur_groups) |g| groups.append(std.heap.c_allocator, g) catch {};
    for (entry.groups) |g| groups.append(std.heap.c_allocator, g) catch {};

    const owned = out.toOwnedSlice(std.heap.c_allocator) catch {
        out.deinit(std.heap.c_allocator);
        return false;
    };
    defer std.heap.c_allocator.free(owned);
    const ok = replaceActiveEditMesh(owned, cur_count + @as(u32, @intCast(entry.verts.len / 8)));
    if (ok) model_source.setFaceGroups(groups.items);
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

fn faceCrossFromPositions(pos: []const f32, face: u32) [3]f32 {
    const b = @as(usize, face) * 9;
    if (b + 8 >= pos.len) return .{ 0, 0, 0 };
    const a: [3]f32 = .{ pos[b + 0], pos[b + 1], pos[b + 2] };
    const p1: [3]f32 = .{ pos[b + 3], pos[b + 4], pos[b + 5] };
    const p2: [3]f32 = .{ pos[b + 6], pos[b + 7], pos[b + 8] };
    return vcross(vsub(p1, a), vsub(p2, a));
}

fn countUnsafeFaceEdits(before: []const f32, after: []const f32, face_count: u32) u32 {
    var bad: u32 = 0;
    var f: u32 = 0;
    while (f < face_count) : (f += 1) {
        const bc = faceCrossFromPositions(before, f);
        const ac = faceCrossFromPositions(after, f);
        const b2 = vdot(bc, bc);
        const a2 = vdot(ac, ac);
        if (a2 < @max(@as(f32, 1e-12), b2 * 1e-6)) {
            bad += 1;
            continue;
        }
        if (b2 > 1e-12 and vdot(vnorm(bc), vnorm(ac)) < -0.05) bad += 1;
    }
    return bad;
}

pub fn meshGizmoBegin() void {
    clearMeshGuardSnapshot();
    const pos = model_paint.positions() orelse return;
    g_guard_before = std.heap.c_allocator.dupe(f32, pos) catch null;
    g_guard_face_count = model_paint.faceCount();
}

pub fn meshGizmoFinish() bool {
    const before = g_guard_before orelse return false;
    const after = model_paint.positions() orelse {
        clearMeshGuardSnapshot();
        return false;
    };
    if (after.len != before.len) {
        clearMeshGuardSnapshot();
        return false;
    }
    const fc: u32 = @intCast(@min(before.len / 9, after.len / 9));
    const bad = countUnsafeFaceEdits(before, after, fc);
    if (bad == 0) {
        clearMeshGuardSnapshot();
        return false;
    }
    g_guard_pending = true;
    g_guard_bad_faces = bad;
    g_guard_face_count = fc;
    return true;
}

pub fn meshEditGuardInfo() [4]u32 {
    return .{ if (g_guard_pending) 1 else 0, g_guard_bad_faces, g_guard_face_count, if (g_guard_pending) 1 else 0 };
}

pub fn meshEditGuardResolve(action: u8) bool {
    if (!g_guard_pending) return false;
    var changed = false;
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
            }
            changed = true;
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
/// Pick the element under (mx,my) in the current mode (additive = shift toggle/extend),
/// fold it into the selection, and repaint. Returns the new selected count, -1 if no mesh.
pub fn meshEditPick(mx: f32, my: f32, additive: bool) i32 {
    if (!model_paint.hasTarget()) return -1;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    return mesh_edit.pick(cam, g_paint_vp_w, g_paint_vp_h, vpLocalX(mx), vpLocalY(my), additive);
}
pub fn meshEditClear() void {
    mesh_edit.clearSelection();
}
/// Mesh-editor Ctrl+A — select every element of the current mode within the focused part
/// (or the whole model). Returns the selected count, -1 if no mesh.
pub fn meshEditSelectAll() i32 {
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
const OV_VERT = [3]f32{ 0.95, 0.97, 1.0 }; // unselected vertex fill
const OV_HALO = [4]f32{ 0.02, 0.03, 0.07, 0.95 }; // dark outline behind every marker
const OV_MARQUEE = [4]f32{ 0.62, 0.78, 1.0, 0.98 };
const GIZMO_X = [3]f32{ 1.0, 0.18, 0.16 };
const GIZMO_Y = [3]f32{ 0.28, 0.9, 0.28 };
const GIZMO_Z = [3]f32{ 0.3, 0.55, 1.0 };
const GIZMO_AXIS_PX: f32 = 86;
const GIZMO_HIT_PX: f32 = 13;
const OV_MAX_VERT_DOTS: u32 = 80000; // beyond this draw only selected dots (wireframe still
// shows topology) — a generous fps guard, not a data cap.
const OV_EDGE = [3]f32{ 0.62, 0.70, 0.85 }; // unselected boundary edge (real model edges)
// Above this boundary-edge count, skip the overlay edge lines (a huge triangle soup with no
// grouping would flood the pass) — the GPU wireframe toggle still shows topology.
const OV_MAX_EDGE_LINES: u32 = 40000;

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
fn axisEndpoint(cam: model_paint.Camera, pivot: [3]f32, axis: i32) ?[2][2]f32 {
    const p0 = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, pivot) orelse return null;
    const len = worldUnitsPerPixel(cam, pivot) * GIZMO_AXIS_PX;
    const p1w = vadd(pivot, vmul(axisVec(axis), len));
    const p1 = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, p1w) orelse return null;
    return .{ p0, p1 };
}
fn screenAxisDir(cam: model_paint.Camera, pivot: [3]f32, axis: i32) [2]f32 {
    const ep = axisEndpoint(cam, pivot, axis) orelse return .{ 1, 0 };
    const dx = ep[1][0] - ep[0][0];
    const dy = ep[1][1] - ep[0][1];
    const l = @sqrt(dx * dx + dy * dy);
    if (l < 4) return .{ 1, 0 };
    return .{ dx / l, dy / l };
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
fn drawGizmoRing(cam: model_paint.Camera, pivot: [3]f32, axis: i32, ox: f32, oy: f32) void {
    const col = axisColor(axis);
    const av = axisVec(axis);
    const basis = ringBasis(av);
    const r = worldUnitsPerPixel(cam, pivot) * GIZMO_AXIS_PX * 0.82;
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
    const r = worldUnitsPerPixel(cam, pivot) * GIZMO_AXIS_PX * 0.82;
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

fn drawGizmoOverlay(cam: model_paint.Camera, ox: f32, oy: f32) void {
    if (meshEditModeRaw() == 0) return;
    const pivot = mesh_edit.selectionPivot() orelse return;
    const pc = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, pivot) orelse return;
    overlayDot(pc[0] + ox, pc[1] + oy, OV_ORANGE[0], OV_ORANGE[1], OV_ORANGE[2], 10);
    var axis: i32 = 0;
    while (axis < 3) : (axis += 1) {
        if (g_gizmo_tool == .rotate) {
            drawGizmoRing(cam, pivot, axis, ox, oy);
        } else if (axisEndpoint(cam, pivot, axis)) |ep| {
            const c = axisColor(axis);
            overlayLine(ep[0][0] + ox, ep[0][1] + oy, ep[1][0] + ox, ep[1][1] + oy, c[0], c[1], c[2], 5.0);
            overlayDot(ep[1][0] + ox, ep[1][1] + oy, c[0], c[1], c[2], if (g_gizmo_tool == .scale) 14 else 11);
        }
    }
}

pub fn meshGizmoHit(mx: f32, my: f32) i32 {
    if (!g_me_capture or meshEditModeRaw() == 0 or !model_paint.hasTarget()) return -1;
    const pivot = mesh_edit.selectionPivot() orelse return -1;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const lmx = vpLocalX(mx);
    const lmy = vpLocalY(my);
    var best_axis: i32 = -1;
    var best_d2: f32 = GIZMO_HIT_PX * GIZMO_HIT_PX;
    var axis: i32 = 0;
    while (axis < 3) : (axis += 1) {
        const d2 = if (g_gizmo_tool == .rotate) blk: {
            break :blk ringHitDist2(cam, pivot, axis, lmx, lmy);
        } else blk: {
            const ep = axisEndpoint(cam, pivot, axis) orelse break :blk 1.0e12;
            break :blk segDist2(lmx, lmy, ep[0][0], ep[0][1], ep[1][0], ep[1][1]);
        };
        if (d2 < best_d2) {
            best_d2 = d2;
            best_axis = axis;
        }
    }
    return best_axis;
}

pub fn meshGizmoDrag(axis: i32, dx: f32, dy: f32) bool {
    if (axis < 0 or axis > 2 or meshEditModeRaw() == 0 or !model_paint.hasTarget()) return false;
    const pivot = mesh_edit.selectionPivot() orelse return false;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const dir = screenAxisDir(cam, pivot, axis);
    const px = dx * dir[0] + dy * dir[1];
    const av = axisVec(axis);
    const m = switch (g_gizmo_tool) {
        .move => mesh_edit.translateSelection(vmul(av, px * worldUnitsPerPixel(cam, pivot))),
        .scale => mesh_edit.scaleSelectionAxis(av, pivot, 1.0 + px * 0.012),
        .rotate => mesh_edit.rotateSelectionAxis(av, pivot, px * 0.018),
    };
    return applyMeshMutation(m);
}

pub fn meshGizmoNudge(axis: u8, amount: f32) bool {
    if (axis > 2 or meshEditModeRaw() == 0 or !model_paint.hasTarget()) return false;
    const m = mesh_edit.translateSelection(vmul(axisVec(axis), amount));
    return applyMeshMutation(m);
}

/// Draw the editor overlay (vertex dots / edge highlights / marquee box) as screen-space
/// capsules projected with the EXACT last-drawn camera, so every dot sits on the pixel its
/// raycast shoots back through — pixel-locked at any zoom. Capsules ride the 2D draw-command
/// z-order, so emitting right after the Scene3D composite lands them on top. (ox,oy) is the
/// viewport origin (0,0 full-window). Lives here, not in mesh_edit, to keep that GPU-free.
pub fn drawEditorOverlay(ox: f32, oy: f32) void {
    if (!g_me_capture) return;
    // Marquee box (any mode) — four thin capsules forming the rect outline.
    if (g_mq_active) {
        const x0 = g_mq[0];
        const y0 = g_mq[1];
        const x1 = g_mq[2];
        const y1 = g_mq[3];
        overlayLine(x0, y0, x1, y0, OV_MARQUEE[0], OV_MARQUEE[1], OV_MARQUEE[2], 2.0);
        overlayLine(x1, y0, x1, y1, OV_MARQUEE[0], OV_MARQUEE[1], OV_MARQUEE[2], 2.0);
        overlayLine(x1, y1, x0, y1, OV_MARQUEE[0], OV_MARQUEE[1], OV_MARQUEE[2], 2.0);
        overlayLine(x0, y1, x0, y0, OV_MARQUEE[0], OV_MARQUEE[1], OV_MARQUEE[2], 2.0);
    }
    if (!model_paint.hasTarget()) return;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const mode = meshEditModeRaw();
    // Vertex + edge modes draw the model's BOUNDARY edges as real lines (Blender/Blockbench
    // style) — the triangulation diagonals stay hidden because they aren't boundary edges.
    // This is the topology view; the GPU barycentric wireframe (full tris) is a separate
    // toggle. Skipped for a huge ungrouped soup (cap) where the GPU wire is the better tool.
    if ((mode == 1 or mode == 2) and mesh_edit.ensureTopologyPub()) {
        if (mesh_edit.boundaryEdgeCount() <= OV_MAX_EDGE_LINES) {
            const n = mesh_edit.edgeCount();
            var e: u32 = 0;
            while (e < n) : (e += 1) {
                if (!mesh_edit.edgeIsBoundaryPub(e)) continue;
                if (!mesh_edit.edgeInScopePub(e)) continue; // only the focused part's edges
                // In edge mode a selected boundary edge draws bold-orange over the dim base.
                const sel = mode == 2 and mesh_edit.edgeSelectedPub(e);
                const ep = mesh_edit.edgeEndpointsPub(e);
                const a = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, mesh_edit.vertPosPub(ep[0])) orelse continue;
                const b = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, mesh_edit.vertPosPub(ep[1])) orelse continue;
                if (sel) {
                    overlayLine(a[0] + ox, a[1] + oy, b[0] + ox, b[1] + oy, OV_ORANGE[0], OV_ORANGE[1], OV_ORANGE[2], 4.0);
                } else {
                    overlayLine(a[0] + ox, a[1] + oy, b[0] + ox, b[1] + oy, OV_EDGE[0], OV_EDGE[1], OV_EDGE[2], 1.6);
                }
            }
        }
    }
    if (mode == 1) { // vertex: every vert as a haloed dot, selected ones orange + bigger
        const n = mesh_edit.vertCount();
        const draw_all = n <= OV_MAX_VERT_DOTS;
        var i: u32 = 0;
        while (i < n) : (i += 1) {
            if (!mesh_edit.vertInScopePub(i)) continue; // only the focused part's verts
            const selected = mesh_edit.vertSelectedPub(i);
            if (!selected and !draw_all) continue;
            const sp = model_paint.project(cam, g_paint_vp_w, g_paint_vp_h, mesh_edit.vertPosPub(i)) orelse continue;
            if (selected) {
                overlayDot(sp[0] + ox, sp[1] + oy, OV_ORANGE[0], OV_ORANGE[1], OV_ORANGE[2], 13);
            } else {
                overlayDot(sp[0] + ox, sp[1] + oy, OV_VERT[0], OV_VERT[1], OV_VERT[2], 8);
            }
        }
    }
    drawGizmoOverlay(cam, ox, oy);
}
/// Marquee (rubber-band) select every element inside the screen rect (Alt+drag).
pub fn meshEditBox(x0: f32, y0: f32, x1: f32, y1: f32, additive: bool) i32 {
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
    return mesh_edit.selectFaceByIndex(idx, additive);
}
/// Select every face in the authored group range [lo, hi) — the outliner grabs a whole part.
pub fn meshEditSelectGroupRange(lo: u32, hi: u32, additive: bool) i32 {
    return mesh_edit.selectFacesByGroupRange(lo, hi, additive);
}
/// Restrict editing (select + overlay) to the authored group range [lo, hi) — the outliner
/// focusing ONE part. hi <= lo edits the whole model.
pub fn meshEditSetScope(lo: u32, hi: u32) void {
    mesh_edit.setEditScope(lo, hi);
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
    const fc = model_paint.faceCount();
    var painted: u32 = 0;
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        const grp = model_source.faceGroupOf(f);
        if (grp == model_source.NO_FACE_GROUP or grp < lo or grp >= hi) continue;
        model_paint.paintFace(f, .{ r, g, b, 255 });
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
/// Topology + selection counts for the HUD: {mode, verts, edges, selected-in-mode}.
pub fn meshEditCounts() [4]u32 {
    if (mesh_edit.mode() == .vertex or mesh_edit.mode() == .edge) _ = mesh_edit.ensureTopologyPub();
    return .{ @intFromEnum(mesh_edit.mode()), mesh_edit.vertCount(), mesh_edit.edgeCount(), mesh_edit.selCount() };
}

/// Paint the face under viewport pixel (mx,my) the given colour, using the last-drawn
/// camera. Returns the DISPLAYED face index painted, or -1 on a miss. The caller maps
/// that face back to the source paint (so it survives quality changes) and marks dirty.
pub fn paintAt(mx: f32, my: f32, r: u8, g: u8, b: u8) i32 {
    if (!model_paint.hasTarget()) return -1;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const face = model_paint.pick(cam, g_paint_vp_w, g_paint_vp_h, vpLocalX(mx), vpLocalY(my));
    if (face < 0) return -1;
    // With a material ink dipped, fill the face with the shader's LOOK; else the flat colour.
    const mat = model_paint.hasMaterialInk();
    if (mat) {
        model_paint.paintFaceTex(@intCast(face));
    } else {
        model_paint.paintFace(@intCast(face), .{ r, g, b, 255 });
    }
    paint_program.recordFill(@intCast(face), mat, .{ r, g, b }); // the stroke program is the durable form, not the atlas
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
/// Replay a serialized stroke program onto the resident model, rebuilding the atlas from
/// the recipe. Sets the program's detail first (re-tessellate + re-upload the mesh — which
/// the paint module can't do) so face+bary dabs land at the resolution they were made.
/// False if there's no resident mesh or the blob is malformed.
pub fn paintProgramApply(blob: []const u8) bool {
    if (g_edit_verts == null or g_edit_count == 0) return false;
    if (paint_program.programDetail(blob)) |d| {
        if (@as(u32, d) != model_paint.detail()) _ = setPaintDetail(@intCast(d));
    }
    return paint_program.apply(blob);
}

/// Carry a per-face colour set onto the active paint target (length ≥ facecount*4) —
/// used when a quality change derives the new mesh's colours from the source paint.
pub fn applyPaintColors(colors: []const u8) void {
    model_paint.applyColors(colors);
}

/// The default unpainted face colour (matches the displayed atlas), so the source-side
/// authoritative paint starts identical to what's shown.
pub const DEFAULT_FACE = model_paint.DEFAULT_FACE;

/// Paint a face by its index (no raycast) — programmatic fill / the headless paint
/// proof. Returns false if there's no target or the index is out of range.
pub fn paintFaceByIndex(face: u32, r: u8, g: u8, b: u8) bool {
    if (face >= model_paint.faceCount()) return false;
    model_paint.paintFace(face, .{ r, g, b, 255 });
    return true;
}

/// Triangle count of the active paint target (0 if none) — lets a cart iterate faces.
pub fn paintFaceCount() u32 {
    return model_paint.faceCount();
}

// ── Free-form brush stroke (per-face-safe sub-face painting) ────────────────────────
// The one brush system paints two ways: a per-face fill (paintAt/paintFaceByIndex above)
// and a free-form stroke that lays sub-face dabs WITHOUT leaking onto neighbour faces
// (req_2281). Two face-safety modes, user-toggleable (req_2283): CLIP paints whichever
// face each dab lands on (overhang clipped to that triangle); LOCK masks the whole stroke
// to the face pressed at stroke-begin. Sub-face room only exists once detail>1 (setPaintDetail);
// at detail 1 a dab degrades to a fill, so the fill path never regresses.
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
    if (!model_paint.hasTarget()) return -1;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const hit = model_paint.pickBary(cam, g_paint_vp_w, g_paint_vp_h, vpLocalX(mx), vpLocalY(my)) orelse return -1;
    g_locked_face = hit.face;
    return @intCast(hit.face);
}

/// One free-form brush dab. CLIP: paint whichever face the ray hits, clipped to its triangle.
/// LOCK: paint g_locked_face (from paintStrokeBegin) where the ray meets that face's plane,
/// even if the cursor drifted onto a neighbour. `radius`/`flow` are the brush disc (patch-texel
/// units) and its blend. Reuses vpLocalX/Y so the embedded-editor viewport offset is honoured
/// (req_2248) exactly like paintAt. Returns the painted face, or -1 on a miss.
pub fn paintStampAt(mx: f32, my: f32, r: u8, g: u8, b: u8, radius: f32, flow: f32) i32 {
    if (!model_paint.hasTarget()) return -1;
    const cam = model_paint.Camera{ .eye = g_paint_eye, .target = g_paint_target, .fov_deg = g_paint_fov };
    const lx = vpLocalX(mx);
    const ly = vpLocalY(my);
    const rgba = [4]u8{ r, g, b, 255 };
    const mat = model_paint.hasMaterialInk(); // dip into a shader bucket → sample it per dab
    if (g_paint_mode == 1) {
        const uv = model_paint.baryOnFace(cam, g_paint_vp_w, g_paint_vp_h, lx, ly, g_locked_face) orelse return -1;
        if (mat) model_paint.paintStampTex(g_locked_face, uv[0], uv[1], radius, flow) else model_paint.paintStamp(g_locked_face, uv[0], uv[1], radius, rgba, flow);
        paint_program.recordDab(g_locked_face, uv[0], uv[1], radius, flow, mat, .{ r, g, b });
        return @intCast(g_locked_face);
    }
    const hit = model_paint.pickBary(cam, g_paint_vp_w, g_paint_vp_h, lx, ly) orelse return -1;
    if (mat) model_paint.paintStampTex(hit.face, hit.u, hit.v, radius, flow) else model_paint.paintStamp(hit.face, hit.u, hit.v, radius, rgba, flow);
    paint_program.recordDab(hit.face, hit.u, hit.v, radius, flow, mat, .{ r, g, b });
    return @intCast(hit.face);
}

/// Set the free-form detail (patch size 8/16/32; 1 = fill-only). Re-tessellates the paint
/// atlas, rewrites the resident mesh UVs in place, then re-uploads the whole mesh so the new
/// mapping draws. Returns the ACTUAL detail after the call (the budget guard may keep the old
/// one), so the UI can reflect what really took.
pub fn setPaintDetail(px: i32) i32 {
    const verts = g_edit_verts orelse return -1;
    if (g_edit_count == 0) return -1;
    const want: u32 = if (px < 0) 1 else @intCast(px);
    model_paint.setDetail(want, verts, g_edit_count);
    const face_count = g_edit_count / 3;
    if (face_count > 0) _ = patchActiveEditMesh(0, face_count - 1);
    return @intCast(model_paint.detail());
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
/// Load a saved painting: restore its detail (rewrites UVs + re-uploads the mesh) then blit the
/// saved atlas over the texture. Returns false if the bytes don't match the restored dimensions.
pub fn applyPaintAtlas(detail_px: i32, rgba: []const u8) bool {
    _ = setPaintDetail(detail_px);
    return model_paint.setAtlas(rgba);
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
const StaticInstEntry = struct { key: usize = 0, count: u32 = 0, offset: u64 = 0, used: bool = false, version: u32 = 0 };
var g_static_inst_buf: ?*wgpu.Buffer = null;
var g_static_inst_top: u64 = 0; // bump cursor (bytes) into g_static_inst_buf
var g_static_inst_cache: [STATIC_INST_CACHE_LEN]StaticInstEntry = [_]StaticInstEntry{.{}} ** STATIC_INST_CACHE_LEN;
var g_static_inst_cache_len: usize = 0;

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
var g_ground_bgl: ?*wgpu.BindGroupLayout = null; // group1: read-only storage D
const GROUND_POOL = 128; // distinct D buffers (≈ max simultaneously-drawn ground chunks).
// Was 16 — a city's worth of painted chunks (one ground mesh each) blew past it and
// every chunk past the 16th was silently dropped, so roads vanished / stopped at a
// chunk seam (PERTILEROAD-0814). 128 × 20000 f32 ≈ 10 MB of pooled storage buffers.
const GROUND_DATA_FLOATS = 20000; // cap per chunk: 130*130 cells + palette + ribbon, ample
var g_ground_data_buf: [GROUND_POOL]?*wgpu.Buffer = [_]?*wgpu.Buffer{null} ** GROUND_POOL;
var g_ground_data_bg: [GROUND_POOL]?*wgpu.BindGroup = [_]?*wgpu.BindGroup{null} ** GROUND_POOL;
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
// drawn chunk, never contending with foliage. GROUND_POOL * 80 B ≈ 10 KB.
var g_ground_inst_buf: ?*wgpu.Buffer = null;
var g_ground_wgsl_buf: [96 * 1024]u8 = undefined; // scratch for the one-time assembled module
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

// Opt-in per-frame perf readout (RJIT_PERFLOG=1). cpu_draw_us measures CPU command
// encoding + instance re-staging only — async GPU shading (overdraw) is NOT in it, so
// the two numbers together separate a CPU re-stage choke from a GPU overdraw choke.
var g_perflog_on: ?bool = null;
var g_perf_frame: u64 = 0;
fn perfLogOn() bool {
    if (g_perflog_on) |v| return v;
    const on = std.posix.getenv("RJIT_PERFLOG") != null;
    g_perflog_on = on;
    return on;
}

// req_1933: the [r3d-census] / [ground-pass] diagnostics (req_0727) printed every 120 frames
// UNCONDITIONALLY and spammed the dev terminal. Opt-in now — set RJIT_R3D_CENSUS=1 to bring them
// back when debugging the instanced-mesh / ground pass.
var g_census_on: ?bool = null;
fn censusOn() bool {
    if (g_census_on) |v| return v;
    const on = std.posix.getenv("RJIT_R3D_CENSUS") != null;
    g_census_on = on;
    return on;
}

// On-screen fps HUD (RJIT_FPS=1, or RJIT_PERFLOG=1). Queued from render() — which
// runs in the paint WALK, BEFORE gpu.frame() does its text.upload — so the glyphs
// make it into this frame's 2D pass (queuing from flushPending is too late: the text
// buffer is already uploaded by then). fps is WALL-CLOCK frame-to-frame (so it
// reflects GPU overdraw stalls and the 60fps SDL cap, unlike draw_us which is
// CPU-encode only; the telemetry shown is the PREVIOUS frame's, a harmless 1-frame
// lag). req_1674.
var g_fpshud_on: ?bool = null;
var g_last_flush_us: i64 = 0;
var g_fps_ema: f32 = 0;
fn fpsHudOn() bool {
    if (g_fpshud_on) |v| return v;
    // Default ON for the compiled no-V8 game (this is its window — an fps counter is
    // always wanted there), OFF for the V8 editor. RJIT_FPS=0 force-hides; RJIT_FPS or
    // RJIT_PERFLOG (any value) force-shows. req_1677: the user couldn't find the HUD
    // because it required an env var — make it just appear in the game.
    const fps_env = std.posix.getenv("RJIT_FPS");
    if (fps_env) |v| {
        const off = std.mem.eql(u8, v, "0") or std.mem.eql(u8, v, "");
        g_fpshud_on = !off;
        return !off;
    }
    const default_on = if (@hasDecl(build_options, "use_v8")) !build_options.use_v8 else false;
    const on = default_on or std.posix.getenv("RJIT_PERFLOG") != null;
    g_fpshud_on = on;
    return on;
}

pub fn drawFpsHud() void {
    if (!fpsHudOn()) return;
    const now = std.time.microTimestamp();
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

pub fn init() void {
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
            .visibility = wgpu.ShaderStages.fragment,
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

    const layouts = [_]?*wgpu.BindGroupLayout{ g_bind_group_layout.?, g_tex_bind_group_layout.? };
    const pipeline_layout = device.createPipelineLayout(&.{
        .bind_group_layout_count = layouts.len,
        .bind_group_layouts = @ptrCast(&layouts),
    }) orelse return;
    defer pipeline_layout.release();
    // Per-vertex attributes (vertex buffer 0, step=vertex) — position/normal/uv.
    const vert_attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x3, .offset = 0, .shader_location = 0 },
        .{ .format = .float32x3, .offset = 12, .shader_location = 1 },
        .{ .format = .float32x2, .offset = 24, .shader_location = 2 },
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
    clearActiveEditMesh();
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
    for (&g_dyn_slots) |*s| s.* = .{};
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
}

/// Acquire the next RT slot for this frame. Returns null on pool exhaustion
/// or device failure. Slots are reused across frames; resized lazily when
/// a tile's dimensions change.
fn acquireRt(w: u32, h: u32) ?*Rt {
    if (w == 0 or h == 0) return null;
    if (g_rt_cursor >= MAX_RT_POOL) {
        if (!g_rt_pool_warned) {
            g_rt_pool_warned = true;
            std.debug.print("[r3d-rt] RT POOL EXHAUSTED: >{d} Scene3D views in one frame — views past the cap (incl. the build pane if painted last) get no render target and stay blank.\n", .{MAX_RT_POOL});
        }
        return null;
    }
    const slot = &g_rt_pool[g_rt_cursor];
    g_rt_cursor += 1;
    const rt = ensureRt(slot, w, h);
    if (rt == null and !g_rt_alloc_warned) {
        g_rt_alloc_warned = true;
        std.debug.print("[r3d-rt] RT TEXTURE ALLOC FAILED at {d}x{d} — GPU could not create the render target (out of memory from this map's capture surfaces/geometry?). That view stays blank.\n", .{ w, h });
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

fn internGeometry(queue: *wgpu.Queue, key: []const u8, verts: []const f32, count: u32) ?GeoSlice {
    if (lookupGeometry(key)) |slot| return slot;
    if (g_geo_cache_len >= GEO_CACHE_SIZE) return null;
    const buf = g_retained_vbuf orelse return null;
    const bytes = bu.bytesOfCount(Vertex, count);
    if (g_retained_top + bytes > @as(u64, MAX_RETAINED_VERTS) * @sizeOf(Vertex)) return null;
    queue.writeBuffer(buf, g_retained_top, @ptrCast(verts.ptr), bytes);
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
/// contract the intern region uses). Returns the byte offset, or null when the tail is
/// full (LOUD, once). Callers guarantee 0 < count ≤ MAX_DYN_VERTS.
fn dynEnsureRegion(s: *DynSlot, count: u32) ?u64 {
    if (s.capacity >= count) return s.offset_bytes;
    if (g_dyn_bump_verts + count > DYN_REGION_VERTS) {
        dynWarnFull("vertex region", DYN_REGION_VERTS);
        return null;
    }
    const off = (@as(u64, MAX_RETAINED_VERTS) + g_dyn_bump_verts) * @sizeOf(Vertex);
    s.offset_bytes = off;
    s.capacity = count;
    g_dyn_bump_verts += count;
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
    std.debug.print("[r3d] dynamic geometry {s} FULL (cap {d}) — a ground/live/imported mesh was DROPPED and will not draw. Raise DYN_META_SLOTS or DYN_REGION_VERTS in framework/gpu/3d.zig.\n", .{ what, cap });
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
        const off = dynEnsureRegion(s, count) orelse return existingDyn(s);
        queue.writeBuffer(buf, off, @ptrCast(v.ptr), bu.bytesOfCount(Vertex, count));
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
        queue.writeBuffer(buf, s.offset_bytes, @ptrCast(verts.ptr), bu.bytesOfCount(Vertex, count));
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
    g_hf_scratch[n.*] = .{ .px = p[0], .py = p[1], .pz = p[2], .nx = nrm[0], .ny = nrm[1], .nz = nrm[2], .u = u, .v = vv };
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

/// Resolve a "~hf~<slotId>~<version>" key: generate the heightfield mesh from the
/// streamed height grid into the reused slot, overwriting on version change. The
/// grid is the same one the collider takes, so render == collide.
fn resolveDynamicHeightfield(queue: *wgpu.Queue, key: []const u8, heights: ?[]const f32, cols: u32, rows: u32, width: f32, depth: f32, base: f32, wave: HfWave, depths: ?[]const f32) ?GeoSlice {
    const loc = dynSlotLocate("~hf~".len, key) orelse return null;
    const s = &g_dyn_slots[loc.i];
    // A wave heightfield (bodies of water) re-bakes EVERY frame from the host
    // clock so the ripple animates; static fields rebake only on version change.
    const animated = hfWaveActive(wave);
    if (animated or s.version_hash != loc.ver_hash or s.count == 0) {
        const hs = heights orelse return existingDyn(s);
        const t: f32 = if (animated) @as(f32, @floatFromInt(@mod(std.time.milliTimestamp(), 1_000_000))) / 1000.0 else 0;
        const cnt = hfGen(hs, @intCast(cols), @intCast(rows), width, depth, base, wave, t, depths);
        if (cnt == 0) return existingDyn(s);
        const buf = g_retained_vbuf orelse return null;
        // Bump-allocate by the mesh's REAL vert count: a flat chunk is ~30 verts, not a
        // fixed 98k slot — that's what lets hundreds of painted ground chunks coexist.
        const off = dynEnsureRegion(s, cnt) orelse return existingDyn(s);
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
pub fn render(node: *Node, x: f32, y: f32, w: f32, h: f32, opacity: f32) bool {
    if (!g_initialized) init();
    if (!g_initialized) return false;
    const iw: u32 = @intFromFloat(@max(1, w));
    const ih: u32 = @intFromFloat(@max(1, h));
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
        drawFpsHud(); // self-gated (RJIT_FPS); queued here so it lands before gpu.frame's text upload
        return true;
    }
    return false;
}

// Draw every scene recorded by render() this frame. Called once from
// gpu.frame(), after StaticSurface captures and before the main 2D pass, so
// textureKey-sampled surfaces are already populated for this frame.
pub fn flushPending() void {
    g_telemetry = .{ .scene_count = @intCast(g_pending_count) };
    const started = std.time.microTimestamp();
    for (g_pending[0..g_pending_count]) |p| drawScene(p.node, p.slot, p.x, p.y, p.w, p.h);
    const ended = std.time.microTimestamp();
    g_telemetry.draw_us = @intCast(@max(0, ended - started));
    if (perfLogOn()) {
        g_perf_frame += 1;
        if (g_perf_frame % 30 == 0)
            std.debug.print("[r3d-perf] cpu_draw_us={d} instances={d} restaged={d} draw_calls={d} | cpu_draw_us=encode+restage (GPU overdraw NOT counted): high here = re-stage choke, low+laggy = overdraw\n", .{ g_telemetry.draw_us, g_telemetry.instances, g_telemetry.staged_dynamic, g_telemetry.draw_calls });
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
pub fn renderDetached(target: *DetachedTarget, node: *Node, w: f32, h: f32) ?*wgpu.TextureView {
    if (!g_initialized) init();
    if (!g_initialized) return null;
    const iw: u32 = @intFromFloat(@max(1, w));
    const ih: u32 = @intFromFloat(@max(1, h));
    const slot = ensureRt(&target.slot, iw, ih) orelse return null;
    // Detached targets are their own window/surface — the scene fills it, origin (0,0).
    drawScene(node, slot, 0, 0, w, h);
    return slot.color_view;
}

// Draw the analytic skybox as one fullscreen triangle. Reconstructs each
// pixel's world ray from inv(vp) in the shader, so the only data it needs is
// that inverse, the camera position, a wrapped wall-clock for cloud drift, and
// the sky colour/sun/haze/cloud/night params off the Scene3D node.
fn drawSky(pass: anytype, queue: *wgpu.Queue, node: *Node, vp: math.Mat4, cam_pos: math.Vec3) void {
    const sky_pipeline = g_sky_pipeline orelse return;
    const sky_bg = g_sky_bind_group orelse return;
    const sky_buf = g_sky_uniform_buffer orelse return;
    const inv_vp = math.m4invert(vp) orelse return;

    // Wrap the clock so float32 keeps cloud-noise precision (a raw epoch in
    // seconds is ~1.7e9 and quantises the drift to a stutter).
    const t: f32 = @as(f32, @floatFromInt(@mod(std.time.milliTimestamp(), 1_000_000))) / 1000.0;

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

fn quantColor(c: f32) u8 {
    return @intFromFloat(@round(std.math.clamp(c, 0.0, 1.0) * 255.0));
}

/// Quantize a degree angle onto the u16 ring (0..65536 ≡ 0..360°). Axis-aligned
/// 0/90/180/270 land on exact integers (a wall/floor's rotation is lossless). Round
/// can hit 65536 for an angle a hair under 360° — mask through u32 so it wraps to 0
/// instead of overflowing the u16 cast.
fn quantAngleU16(deg: f32) u16 {
    const m = deg - @floor(deg / 360.0) * 360.0;
    const v: u32 = @intFromFloat(@round(m * (65536.0 / 360.0)));
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
        .color = .{ quantColor(cr), quantColor(cg), quantColor(cb), quantColor(ca) },
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
            return @intFromFloat(@round(u * 65535.0));
        }
    };
    return SlimInstance{
        .pos = .{ px, py, pz },
        .angles = .{ quantAngleU16(pitch), quantAngleU16(yaw) },
        .scale = .{ scl.q(wide), scl.q(len) },
        .color = .{ quantColor(cr), quantColor(cg), quantColor(cb), 255 },
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
            return .{ .offset = e.offset, .count = e.count };
        }
    }
    if (icount == 0) return null;
    if (g_static_inst_cache_len >= STATIC_INST_CACHE_LEN) return null;
    if (g_static_inst_buf == null) {
        g_static_inst_buf = device.createBuffer(&.{
            .label = wgpu.StringView.fromSlice("render3d_static_instances"),
            .size = @as(u64, MAX_STATIC_INSTANCES) * @sizeOf(InstanceData),
            .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
            .mapped_at_creation = 0,
        });
        if (g_static_inst_buf == null) return null;
        g_static_inst_top = 0;
    }
    const used_count: u32 = @intCast(g_static_inst_top / @sizeOf(InstanceData));
    // Retained static uploads must be whole-array because streamed draw nodes
    // address sub-ranges by scene3d_instance_first. A partial upload makes any
    // later range clamp to count=0, so turning the camera can drop whole chunks.
    // Oversized batches fall back to the dynamic sub-range path below instead.
    if (!static_instance_policy.canRetainWholeBatch(icount, used_count, MAX_STATIC_INSTANCES)) return null;
    const n: u32 = icount;
    if (n == 0) return null;
    const base_offset = g_static_inst_top;
    stageStaticInstanceBytes(queue, idata, stride, n, base_offset);
    g_static_inst_top += @as(u64, n) * @sizeOf(InstanceData);
    g_static_inst_cache[g_static_inst_cache_len] = .{ .key = key, .count = n, .offset = base_offset, .used = true, .version = version };
    g_static_inst_cache_len += 1;
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
            return .{ .offset = e.offset, .count = e.count };
        }
    }
    if (icount == 0) return null;
    if (g_slim_static_cache_len >= STATIC_INST_CACHE_LEN) return null;
    if (g_slim_static_buf == null) {
        g_slim_static_buf = device.createBuffer(&.{
            .label = wgpu.StringView.fromSlice("render3d_slim_static_instances"),
            .size = @as(u64, MAX_STATIC_INSTANCES) * @sizeOf(SlimInstance),
            .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
            .mapped_at_creation = 0,
        });
        if (g_slim_static_buf == null) return null;
        g_slim_static_top = 0;
    }
    const used_count: u32 = @intCast(g_slim_static_top / @sizeOf(SlimInstance));
    if (!static_instance_policy.canRetainWholeBatch(icount, used_count, MAX_STATIC_INSTANCES)) return null;
    const base_offset = g_slim_static_top;
    stageStaticSlimBytes(queue, idata, stride, icount, base_offset);
    g_slim_static_top += @as(u64, icount) * @sizeOf(SlimInstance);
    g_slim_static_cache[g_slim_static_cache_len] = .{ .key = key, .count = icount, .offset = base_offset, .used = true, .version = version };
    g_slim_static_cache_len += 1;
    return .{ .offset = base_offset, .count = icount };
}

// Build the ground-formula pipeline once, from the first chunk's formula. The
// assembled module = scene3d_ground_prefix + effect_math (fbm/snoise) + the
// shipped formula (hf_ground_rgb + helpers) + scene3d_ground_epilogue. The
// formula is identical across chunks, so this runs exactly once.
fn ensureGroundPipeline(formula: []const u8) void {
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
    const wgsl = std.fmt.bufPrint(&g_ground_wgsl_buf, "{s}\n{s}\n{s}\n{s}", .{
        shaders.scene3d_ground_prefix, effect_assemble.MATH, formula, shaders.scene3d_ground_epilogue,
    }) catch return;
    const sm_desc = wgpu.shaderModuleWGSLDescriptor(.{ .label = "render3d_ground", .code = wgsl });
    const sm = device.createShaderModule(&sm_desc) orelse return;
    defer sm.release();
    const gl = [_]?*wgpu.BindGroupLayout{ g_bind_group_layout.?, g_ground_bgl.? };
    const pl = device.createPipelineLayout(&.{
        .bind_group_layout_count = gl.len,
        .bind_group_layouts = @ptrCast(&gl),
    }) orelse return;
    defer pl.release();
    const vert_attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x3, .offset = 0, .shader_location = 0 },
        .{ .format = .float32x3, .offset = 12, .shader_location = 1 },
        .{ .format = .float32x2, .offset = 24, .shader_location = 2 },
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
    if (g_ground_pipeline != null) g_ground_formula_hash = h;
}

fn drawScene(scene_node: *Node, slot: *Rt, vp_x: f32, vp_y: f32, w: f32, h: f32) void {
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
            @as(f32, @floatFromInt(bg.r)) / 255.0,
            @as(f32, @floatFromInt(bg.g)) / 255.0,
            @as(f32, @floatFromInt(bg.b)) / 255.0,
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
                        std.debug.print("[r3d-light] placed-light overflow — MAX_LIGHTS ({d}) reached, dropping the rest. Raise MAX_LIGHTS in framework/gpu/3d.zig.\n", .{MAX_LIGHTS});
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
    if (model_paint.hasTarget() and !g_paint_probed and std.posix.getenv("RJIT_PAINTPROBE") != null) {
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
            std.debug.print("[paintprobe] vp={d:.0}x{d:.0} fov={d:.0} eye=({d:.2},{d:.2},{d:.2}) target=({d:.2},{d:.2},{d:.2}) px=({d:.0},{d:.0}) -> face {d}\n", .{ w, h, g_paint_fov, g_paint_eye[0], g_paint_eye[1], g_paint_eye[2], g_paint_target[0], g_paint_target[1], g_paint_target[2], px, py, fc });
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
    if (sky_node) |s| drawSky(pass, queue, s, vp, cam_pos);

    pass.setPipeline(g_pipeline.?);

    // ── Scene uniforms: ONE write per frame (no dynamic offset). The per-mesh
    //    model matrix + color moved into per-instance vertex attributes below. ──
    // Wrapped wall-clock (mod 1e6 s) so float32 keeps precision — the grass
    // pipeline's wind reads S.time. Same wrap drawSky uses for cloud drift.
    const scene_time: f32 = @as(f32, @floatFromInt(@mod(std.time.milliTimestamp(), 1_000_000))) / 1000.0;
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
        if (std.mem.startsWith(u8, key, "~hf~")) {
            // Host-generated heightfield: JS ships only the cols×rows height grid;
            // the host bakes the mesh verts into the slot (topology is fixed, only y
            // moves). Far cheaper across the bridge than re-shipping ~86k verts/sculpt.
            maybe_slot = resolveDynamicHeightfield(
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
        std.debug.print("[r3d-census] children={d} inst_seen={d} inst_collected={d} mcount={d} tcount={d} geo_cache_len={d} retained={d}k/{d}k verts\n", .{ scene_node.children.len, dbg_inst_seen, dbg_inst_collected, mcount, tcount, g_geo_cache_len, retained_kverts, MAX_RETAINED_VERTS / 1000 });
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
                    if (count > 0) {
                        if (group_tex) |bg| pass.setBindGroup(1, bg, 0, null);
                        pass.setVertexBuffer(0, g_retained_vbuf.?, group_slot.offset, bu.bytesOfCount(Vertex, group_slot.count));
                        if (is_slim) {
                            pass.setVertexBuffer(1, g_slim_static_buf.?, sd.offset + bu.bytesOfCount(SlimInstance, first), bu.bytesOfCount(SlimInstance, count));
                        } else {
                            pass.setVertexBuffer(1, g_static_inst_buf.?, sd.offset + bu.bytesOfCount(InstanceData, first), bu.bytesOfCount(InstanceData, count));
                        }
                        pass.draw(group_slot.count, count, 0, 0);
                        recordDraw(group_slot.count, count);
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
                if (slim_inst_top + @sizeOf(SlimInstance) > slim_cap_bytes) break;
                const child = &scene_node.children[midx[hf]];
                if (child.scene3d_instance_data) |idata| {
                    const stride = child.scene3d_instance_stride;
                    if (stride >= 12) {
                        const total_rows: u32 = @intCast(idata.len / stride);
                        const ifirst: u32 = @min(child.scene3d_instance_first, total_rows);
                        const icount: u32 = @min(child.scene3d_instance_count, total_rows - ifirst);
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
            if (fcount == 0) continue;
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
            if (inst_top + @sizeOf(InstanceData) > inst_cap_bytes) break; // overflow

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

        if (group_count == 0) continue;
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
        ensureGroundPipeline(scene_node.children[gidx[0]].scene3d_ground_formula.?);
        if (g_ground_pipeline) |gp| {
            pass.setPipeline(gp);
            pass.setBindGroup(0, g_bind_group.?, 0, null);
            var gp_i: usize = 0;
            while (gp_i < gcount) : (gp_i += 1) {
                const child = &scene_node.children[gidx[gp_i]];
                const pool = gp_i; // gcount <= GROUND_POOL → one distinct D buffer per draw
                if (g_ground_data_buf[pool] == null or g_ground_data_bg[pool] == null) continue;
                if (child.scene3d_ground_data) |d| {
                    const n = @min(d.len, GROUND_DATA_FLOATS);
                    // req_0842: this upload once computed its size as `n * @sizeOf(f32)`
                    // WITHOUT a wide cast — for n=14528 that overflowed to 25344 instead
                    // of 58112, truncating the write so cells past ~6336 read 0 = water =
                    // concrete, and painted roads rendered as concrete past a chunk seam.
                    // writeTypedBuffer derives the byte size in u64 from the slice itself,
                    // so the class of bug can't recur (req_0871).
                    bu.writeTypedBuffer(queue, g_ground_data_buf[pool].?, 0, f32, d[0..n]);
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
                pass.setVertexBuffer(0, g_retained_vbuf.?, gslot[gp_i].offset, geo_bytes);
                pass.setVertexBuffer(1, g_ground_inst_buf.?, gi_off, @sizeOf(InstanceData));
                pass.draw(gslot[gp_i].count, 1, 0, 0);
                dbg_ground_drawn += 1;
                recordDraw(gslot[gp_i].count, 1);
            }
        }
    }
    if (censusOn() and g_dbg_frame % 120 == 1) {
        std.debug.print("[ground-pass] seen={d} collected(gcount)={d} drawn={d} pool_cap={d} (dedicated inst buffer — foliage can't starve it)\n", .{ dbg_ground_seen, gcount, dbg_ground_drawn, GROUND_POOL });
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
