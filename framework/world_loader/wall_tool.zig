//! Draw Wall native overlay (req_4520): the lattice cursor, anchor gizmo, hologram
//! span, magnet marker, and measurement drags ALL run host-side, per frame — zero
//! JS per mouse move (the modelview input law, feedback: React writes UI only).
//!
//! JS keeps exactly the gesture-rate work it must own: arming the tool, mirroring
//! the anchor for the semantic command flow, and applying committed spans through
//! the architecture engine. Everything the eye tracks between clicks lives here.
//!
//! Snap/clamp laws mirror cart/editor/world/wallTools.ts (req_4479): height snaps
//! to quarter-metres (4u), thickness to whole u, 16u = 1m, storeys are 48u.

const std = @import("std");
const c = @import("../c.zig").imports;
const config = @import("config.zig");
const paint_surface = @import("paint_surface.zig");

const MAX_EMBEDDED_LOADERS = config.MAX_EMBEDDED_LOADERS;

pub const UNITS_PER_METER: f32 = 16.0;
pub const METERS_PER_LEVEL: f32 = 3.0;
pub const HEIGHT_SNAP_U: i32 = 4;
pub const HEIGHT_MIN_U: i32 = 4;
pub const HEIGHT_MAX_U: i32 = 480;
pub const THICKNESS_SNAP_U: i32 = 1;
pub const THICKNESS_MIN_U: i32 = 1;
pub const THICKNESS_MAX_U: i32 = 32;
/// Endpoint lattice snap: one metre, matching WALL_SNAP_U.
pub const SNAP_U: i32 = 16;
/// A hover this close (in u) to an existing vertex magnetizes (visual only —
/// exact vertex identity stays with the JS command flow, WALL_MAGNET_RADIUS_U).
pub const MAGNET_RADIUS_U: f32 = 8.0;

/// Handle sizes in SCREEN pixels — the constant-screen-size law. World size is
/// derived per frame from camera distance so the gizmo reads identically at
/// street zoom and block zoom.
const ARM_THICKNESS_PX: f32 = 3.5;
const HEAD_PX: f32 = 16.0;
const HUB_PX: f32 = 13.0;
const NUDGE_PX: f32 = 12.0;
const NUDGE_GAP_PX: f32 = 26.0;
const DIAMOND_PX: f32 = 12.0;
const HANDLE_HIT_PX: f32 = 16.0;

// Palette — the editor's wall-tool colors (#34d399 emerald preview, #ffd24a
// active amber, #5ec26a arm green, #bfe6ee hub ice, #42d9e8 selection cyan).
const EMERALD = [3]f32{ 0.204, 0.827, 0.6 };
const AMBER = [3]f32{ 1.0, 0.823, 0.29 };
const ARM_GREEN = [3]f32{ 0.369, 0.761, 0.416 };
const HUB_ICE = [3]f32{ 0.749, 0.902, 0.933 };
const CYAN = [3]f32{ 0.259, 0.851, 0.910 };

pub const Drag = enum(u8) { none = 0, height = 1, thickness = 2 };

/// Press classification returned to the JS gesture handler: zero means the
/// press was not the gizmo's and the click keeps its normal meaning.
pub const PressResult = enum(u8) { pass = 0, grab = 1, nudge_thinner = 2, nudge_thicker = 3 };

pub const WallToolState = struct {
    node_id: u32 = 0,
    armed: bool = false,
    floor: i32 = 0,
    height_u: i32 = 48,
    thickness_u: i32 = 2,
    // Draw anchor (JS mirrors this at gesture rate; the host renders from it).
    anchored: bool = false,
    anchor_x_u: i32 = 0,
    anchor_z_u: i32 = 0,
    // Selected placed wall (req_4520 #4): the same gizmo on its midpoint.
    sel: bool = false,
    sel_ax_u: i32 = 0,
    sel_az_u: i32 = 0,
    sel_bx_u: i32 = 0,
    sel_bz_u: i32 = 0,
    sel_floor: i32 = 0,
    // Live measurement drag. The base freezes at grab so a pre-anchor gizmo
    // (riding the cursor) stops sliding while it is being pulled.
    drag: Drag = .none,
    drag_base_x: f32 = 0,
    drag_base_y: f32 = 0,
    drag_base_z: f32 = 0,
    // Frame-fresh hover (lattice u) + magnet, computed once per frame.
    hover_valid: bool = false,
    hover_x_u: i32 = 0,
    hover_z_u: i32 = 0,
    magnet_valid: bool = false,
    magnet_x_u: f32 = 0,
    magnet_z_u: f32 = 0,
    // Existing wall vertices (xU,zU pairs) pushed at source-change rate for the
    // magnet marker. Owned copy (c_allocator).
    magnets: []f32 = &.{},
};

var g_states: [MAX_EMBEDDED_LOADERS]WallToolState = [_]WallToolState{.{}} ** MAX_EMBEDDED_LOADERS;
var g_any_armed: bool = false;

fn slotFor(node_id: u32) ?*WallToolState {
    if (node_id == 0) return null;
    var free: ?*WallToolState = null;
    for (&g_states) |*s| {
        if (s.node_id == node_id) return s;
        if (free == null and s.node_id == 0) free = s;
    }
    if (free) |s| {
        s.* = .{ .node_id = node_id };
        return s;
    }
    return null;
}

pub fn stateFor(node_id: u32) ?*WallToolState {
    for (&g_states) |*s| {
        if (s.node_id != 0 and s.node_id == node_id) return s;
    }
    return null;
}

fn refreshAnyArmed() void {
    g_any_armed = false;
    for (&g_states) |*s| {
        if (s.node_id != 0 and (s.armed or s.sel)) g_any_armed = true;
    }
}

/// Cheap pre-check for engine.zig's motion branch: keep frames coming while any
/// viewport wants the overlay tracking the mouse.
pub fn anyWallToolArmed() bool {
    return g_any_armed;
}

pub fn snapHeightU(raw: f32) i32 {
    return snapClamp(raw, HEIGHT_SNAP_U, HEIGHT_MIN_U, HEIGHT_MAX_U);
}

pub fn snapThicknessU(raw: f32) i32 {
    return snapClamp(raw, THICKNESS_SNAP_U, THICKNESS_MIN_U, THICKNESS_MAX_U);
}

fn snapClamp(raw: f32, snap: i32, min: i32, max: i32) i32 {
    if (!std.math.isFinite(raw)) return min;
    const snapped = @round(raw / @as(f32, @floatFromInt(snap))) * @as(f32, @floatFromInt(snap));
    const v: i32 = @intFromFloat(@max(@min(snapped, @as(f32, @floatFromInt(max))), @as(f32, @floatFromInt(min))));
    return v;
}

/// Arm/disarm the draw overlay. Arming resets the anchor and adopts the
/// measured style's defaults; params survive re-arms of the same node (sticky
/// for the session — the JS side passes its current mirror back in).
pub fn setMode(node_id: u32, on: bool, floor: i32, height_u: i32, thickness_u: i32) void {
    const st = slotFor(node_id) orelse return;
    st.armed = on;
    st.floor = floor;
    if (height_u > 0) st.height_u = snapHeightU(@floatFromInt(height_u));
    if (thickness_u > 0) st.thickness_u = snapThicknessU(@floatFromInt(thickness_u));
    if (!on) {
        st.anchored = false;
        st.drag = .none;
    }
    refreshAnyArmed();
}

/// The JS anchor mirror (gesture rate): has=false breaks the chain (Escape,
/// miss, tool leave); a commit-accept re-anchors at the new end.
pub fn setAnchor(node_id: u32, has: bool, x_u: i32, z_u: i32) void {
    const st = slotFor(node_id) orelse return;
    st.anchored = has;
    st.anchor_x_u = x_u;
    st.anchor_z_u = z_u;
}

/// The selected placed wall (req_4480 selection → req_4520 dimension gizmo).
pub fn setSelection(node_id: u32, on: bool, ax_u: i32, az_u: i32, bx_u: i32, bz_u: i32, floor: i32, height_u: i32, thickness_u: i32) void {
    const st = slotFor(node_id) orelse return;
    st.sel = on;
    st.sel_ax_u = ax_u;
    st.sel_az_u = az_u;
    st.sel_bx_u = bx_u;
    st.sel_bz_u = bz_u;
    st.sel_floor = floor;
    if (on) {
        if (height_u > 0) st.height_u = snapHeightU(@floatFromInt(height_u));
        if (thickness_u > 0) st.thickness_u = snapThicknessU(@floatFromInt(thickness_u));
    } else if (st.drag != .none and !st.armed) {
        st.drag = .none;
    }
    refreshAnyArmed();
}

/// Existing wall vertices for the magnet marker: (xU,zU) f32 pairs. Visual
/// only — command-time vertex identity stays in wallTools.ts.
pub fn setMagnets(node_id: u32, bytes: []const u8) void {
    const st = slotFor(node_id) orelse return;
    const alloc = std.heap.c_allocator;
    if (st.magnets.len > 0) alloc.free(st.magnets);
    st.magnets = &.{};
    const count = bytes.len / 8; // pairs of f32
    if (count == 0) return;
    const buf = alloc.alloc(f32, count * 2) catch return;
    @memcpy(std.mem.sliceAsBytes(buf), bytes[0 .. count * 8]);
    st.magnets = buf;
}

/// End any measurement drag and report the pending params. `out` receives
/// [height_u, thickness_u, was_drag].
pub fn release(node_id: u32, out: *[3]i32) void {
    const st = slotFor(node_id) orelse {
        out.* = .{ 0, 0, 0 };
        return;
    };
    out.* = .{ st.height_u, st.thickness_u, if (st.drag != .none) 1 else 0 };
    st.drag = .none;
}

// ── Geometry helpers ────────────────────────────────────────────────────────

const Ray = struct { ox: f32, oy: f32, oz: f32, dx: f32, dy: f32, dz: f32 };

fn rayAt(runtime: anytype, mx: f32, my: f32) ?Ray {
    const r = paint_surface.screenRayAt(runtime, mx, my) orelse return null;
    return .{ .ox = r[0], .oy = r[1], .oz = r[2], .dx = r[3], .dy = r[4], .dz = r[5] };
}

/// Ray-sphere hit test with a world-space radius.
fn raySphere(ray: Ray, cx: f32, cy: f32, cz: f32, radius: f32) bool {
    const ox = cx - ray.ox;
    const oy = cy - ray.oy;
    const oz = cz - ray.oz;
    const t = ox * ray.dx + oy * ray.dy + oz * ray.dz;
    if (t < 0) return false;
    const px = ray.ox + ray.dx * t - cx;
    const py = ray.oy + ray.dy * t - cy;
    const pz = ray.oz + ray.dz * t - cz;
    return px * px + py * py + pz * pz <= radius * radius;
}

/// Metres per screen pixel at a world point — the constant-screen-size law.
fn worldPerPixel(runtime: anytype, px: f32, py: f32, pz: f32) f32 {
    const cam = &runtime.camera;
    const dx = px - cam.ext_pos.x;
    const dy = py - cam.ext_pos.y;
    const dz = pz - cam.ext_pos.z;
    const dist = @max(0.5, @sqrt(dx * dx + dy * dy + dz * dz));
    const tan_half = @tan(cam.ext_fov * std.math.pi / 360.0);
    return (2.0 * dist * tan_half) / @max(1.0, runtime.paint_last_h);
}

fn mouseInPane(runtime: anytype, mx: f32, my: f32) bool {
    return mx >= runtime.paint_last_x and mx <= runtime.paint_last_x + runtime.paint_last_w and
        my >= runtime.paint_last_y and my <= runtime.paint_last_y + runtime.paint_last_h;
}

/// The gizmo's base point in world metres: the draw anchor while anchored, the
/// selected wall's midpoint in selection mode, else the frame's hover cell.
fn gizmoBase(st: *WallToolState) ?[3]f32 {
    if (st.drag != .none) return .{ st.drag_base_x, st.drag_base_y, st.drag_base_z };
    if (st.armed) {
        if (st.anchored) return .{
            @as(f32, @floatFromInt(st.anchor_x_u)) / UNITS_PER_METER,
            @as(f32, @floatFromInt(st.floor)) * METERS_PER_LEVEL,
            @as(f32, @floatFromInt(st.anchor_z_u)) / UNITS_PER_METER,
        };
        if (st.hover_valid) return .{
            @as(f32, @floatFromInt(st.hover_x_u)) / UNITS_PER_METER,
            @as(f32, @floatFromInt(st.floor)) * METERS_PER_LEVEL,
            @as(f32, @floatFromInt(st.hover_z_u)) / UNITS_PER_METER,
        };
        return null;
    }
    if (st.sel) return .{
        (@as(f32, @floatFromInt(st.sel_ax_u)) + @as(f32, @floatFromInt(st.sel_bx_u))) * 0.5 / UNITS_PER_METER,
        @as(f32, @floatFromInt(st.sel_floor)) * METERS_PER_LEVEL,
        (@as(f32, @floatFromInt(st.sel_az_u)) + @as(f32, @floatFromInt(st.sel_bz_u))) * 0.5 / UNITS_PER_METER,
    };
    return null;
}

// ── Pointer classification (gesture rate, called from the JS handlers) ──────

/// A press over a handle claims the whole gesture: grab starts a drag the
/// per-frame update tracks natively; a nudge steps thickness one whole u.
pub fn press(runtime: anytype, node_id: u32, mx: f32, my: f32) PressResult {
    const st = stateFor(node_id) orelse return .pass;
    // Handles exist only once the gizmo is PLANTED — on the draw anchor or the
    // selected wall. Pre-anchor the cursor IS the click target (req_4531: the
    // ride-along gizmo ate the first click as a hub grab and desynced the
    // whole flow), so every pre-anchor press passes through to anchoring.
    const interactive = (st.armed and st.anchored) or (st.sel and !st.armed);
    if (!interactive) return .pass;
    if (!mouseInPane(runtime, mx, my)) return .pass;
    const base = gizmoBase(st) orelse return .pass;
    const ray = rayAt(runtime, mx, my) orelse return .pass;
    const wpp = worldPerPixel(runtime, base[0], base[1], base[2]);
    const hit_r = HANDLE_HIT_PX * wpp;
    const height_m = @as(f32, @floatFromInt(st.height_u)) / UNITS_PER_METER;

    // Height arm head (the pull handle at the top).
    if (raySphere(ray, base[0], base[1] + height_m, base[2], hit_r + HEAD_PX * wpp * 0.5)) {
        st.drag = .height;
        st.drag_base_x = base[0];
        st.drag_base_y = base[1];
        st.drag_base_z = base[2];
        return .grab;
    }
    // Thickness nudge arrows flanking the hub (req_4520 #2 — stepping beats a
    // hypersensitive pull). World X flanks; one snap step each.
    const gap = NUDGE_GAP_PX * wpp;
    const nudge_r = hit_r;
    if (raySphere(ray, base[0] - gap, base[1] + 0.02, base[2], nudge_r)) {
        st.thickness_u = snapThicknessU(@as(f32, @floatFromInt(st.thickness_u - THICKNESS_SNAP_U)));
        return .nudge_thinner;
    }
    if (raySphere(ray, base[0] + gap, base[1] + 0.02, base[2], nudge_r)) {
        st.thickness_u = snapThicknessU(@as(f32, @floatFromInt(st.thickness_u + THICKNESS_SNAP_U)));
        return .nudge_thicker;
    }
    // Thickness hub at the base — drag maps ground-plane radial distance, far
    // gentler than the old pixel mapping, and still snapped to whole u.
    if (raySphere(ray, base[0], base[1] + 0.02, base[2], hit_r)) {
        st.drag = .thickness;
        st.drag_base_x = base[0];
        st.drag_base_y = base[1];
        st.drag_base_z = base[2];
        return .grab;
    }
    return .pass;
}

// ── Per-frame update + overlay publication ──────────────────────────────────

/// Called from applyLiveMeshProps (after the kid-list shrink, beside the skin
/// boxes): refresh hover/magnet/drag from the live mouse, then append the
/// overlay nodes for this frame.
pub fn appendOverlay(self: anytype) void {
    const st = stateFor(self.node_id) orelse return;
    if (!(st.armed or st.sel)) return;
    if (!self.camera.external) return;

    var mx: f32 = 0;
    var my: f32 = 0;
    _ = c.SDL_GetMouseState(&mx, &my);

    // Hover: lattice-snapped ground hit at the active storey (the same
    // terrain-aware door path the JS click resolution uses, req_2666/2744).
    st.hover_valid = false;
    st.magnet_valid = false;
    if (st.armed and st.drag == .none and mouseInPane(self, mx, my)) {
        const level_y = @as(f32, @floatFromInt(st.floor)) * METERS_PER_LEVEL;
        if (paint_surface.paintGroundHitAt(self, mx, my, level_y)) |hit| {
            const snap_m = @as(f32, @floatFromInt(SNAP_U)) / UNITS_PER_METER;
            const sx = @round(hit[0] / snap_m) * snap_m;
            const sz = @round(hit[2] / snap_m) * snap_m;
            st.hover_x_u = @intFromFloat(@round(sx * UNITS_PER_METER));
            st.hover_z_u = @intFromFloat(@round(sz * UNITS_PER_METER));
            st.hover_valid = true;
            // Magnet marker: nearest pushed vertex within the radius.
            var best = MAGNET_RADIUS_U * MAGNET_RADIUS_U;
            var i: usize = 0;
            while (i + 1 < st.magnets.len) : (i += 2) {
                const dx = st.magnets[i] - @as(f32, @floatFromInt(st.hover_x_u));
                const dz = st.magnets[i + 1] - @as(f32, @floatFromInt(st.hover_z_u));
                const d = dx * dx + dz * dz;
                if (d <= best) {
                    best = d;
                    st.magnet_x_u = st.magnets[i];
                    st.magnet_z_u = st.magnets[i + 1];
                    st.magnet_valid = true;
                }
            }
        }
    }

    // Live measurement drag (zero JS: the host polls the mouse per frame).
    if (st.drag != .none) {
        if (rayAt(self, mx, my)) |ray| {
            if (st.drag == .height) {
                // Intersect the camera-facing vertical plane through the base:
                // the pulled height is simply the hit's altitude over the base.
                var nx = self.camera.ext_pos.x - st.drag_base_x;
                var nz = self.camera.ext_pos.z - st.drag_base_z;
                const nlen = @sqrt(nx * nx + nz * nz);
                if (nlen > 0.001) {
                    nx /= nlen;
                    nz /= nlen;
                    const denom = ray.dx * nx + ray.dz * nz;
                    if (@abs(denom) > 0.0001) {
                        const t = ((st.drag_base_x - ray.ox) * nx + (st.drag_base_z - ray.oz) * nz) / denom;
                        if (t > 0) {
                            const hit_y = ray.oy + ray.dy * t;
                            st.height_u = snapHeightU((hit_y - st.drag_base_y) * UNITS_PER_METER);
                        }
                    }
                }
            } else {
                // Thickness: radial distance on the base plane → wall depth.
                if (@abs(ray.dy) > 0.0001) {
                    const t = (st.drag_base_y - ray.oy) / ray.dy;
                    if (t > 0) {
                        const hx = ray.ox + ray.dx * t - st.drag_base_x;
                        const hz = ray.oz + ray.dz * t - st.drag_base_z;
                        const dist = @sqrt(hx * hx + hz * hz);
                        st.thickness_u = snapThicknessU(dist * 2.0 * UNITS_PER_METER);
                    }
                }
            }
        }
    }

    const base = gizmoBase(st) orelse return;
    const wpp = worldPerPixel(self, base[0], base[1], base[2]);
    const height_m = @as(f32, @floatFromInt(st.height_u)) / UNITS_PER_METER;
    const thickness_m = @as(f32, @floatFromInt(st.thickness_u)) / UNITS_PER_METER;

    // Cursor diamond — visible from the moment the tool arms (req_4520 #1).
    if (st.armed and st.hover_valid) {
        const hx = @as(f32, @floatFromInt(st.hover_x_u)) / UNITS_PER_METER;
        const hz = @as(f32, @floatFromInt(st.hover_z_u)) / UNITS_PER_METER;
        const hy = @as(f32, @floatFromInt(st.floor)) * METERS_PER_LEVEL;
        const s = DIAMOND_PX * worldPerPixel(self, hx, hy, hz);
        appendBox(self, hx, hy + 0.01, hz, s, 0.03, s, std.math.pi / 4.0, EMERALD, 0.95);
        // Pre-anchor: a faint one-storey pole telegraphs "this tool builds
        // walls" — deliberately NOT interactive and with no handles, so the
        // first click can never be eaten by chrome riding the cursor
        // (req_4531). The real gizmo plants once the anchor exists.
        if (!st.anchored and st.drag == .none) {
            const pole_w = ARM_THICKNESS_PX * 0.8 * worldPerPixel(self, hx, hy, hz);
            appendBox(self, hx, hy + height_m * 0.5, hz, pole_w, height_m, pole_w, 0, ARM_GREEN, 0.4);
        }
    }
    // Magnet marker: cyan — "your next click reuses this exact corner".
    if (st.magnet_valid) {
        const mx_m = st.magnet_x_u / UNITS_PER_METER;
        const mz_m = st.magnet_z_u / UNITS_PER_METER;
        const my_m = @as(f32, @floatFromInt(st.floor)) * METERS_PER_LEVEL;
        const s = (DIAMOND_PX + 4) * worldPerPixel(self, mx_m, my_m, mz_m);
        appendBox(self, mx_m, my_m + 0.02, mz_m, s, 0.05, s, std.math.pi / 4.0, CYAN, 0.95);
    }
    // The planted anchor (req_4531 flow step 3): the committed start point is
    // AMBER — unmistakably "the wall starts here, your next click ends it".
    if (st.armed and st.anchored) {
        const ax_m = @as(f32, @floatFromInt(st.anchor_x_u)) / UNITS_PER_METER;
        const az_m = @as(f32, @floatFromInt(st.anchor_z_u)) / UNITS_PER_METER;
        const ay_m = @as(f32, @floatFromInt(st.floor)) * METERS_PER_LEVEL;
        const s = (DIAMOND_PX + 3) * worldPerPixel(self, ax_m, ay_m, az_m);
        appendBox(self, ax_m, ay_m + 0.02, az_m, s, 0.05, s, std.math.pi / 4.0, AMBER, 0.95);
    }
    // The hologram span (req_4520 #3): a translucent wall VOLUME from the
    // anchor to the cursor at the pending height × thickness — the unmissable
    // "your next click spawns this wall".
    if (st.armed and st.anchored and st.hover_valid and
        (st.hover_x_u != st.anchor_x_u or st.hover_z_u != st.anchor_z_u))
    {
        const ax = @as(f32, @floatFromInt(st.anchor_x_u)) / UNITS_PER_METER;
        const az = @as(f32, @floatFromInt(st.anchor_z_u)) / UNITS_PER_METER;
        const hx = @as(f32, @floatFromInt(st.hover_x_u)) / UNITS_PER_METER;
        const hz = @as(f32, @floatFromInt(st.hover_z_u)) / UNITS_PER_METER;
        const dx = hx - ax;
        const dz = hz - az;
        const len = @sqrt(dx * dx + dz * dz);
        if (len > 0.01) {
            const yaw = -std.math.atan2(dz, dx);
            appendBox(
                self,
                (ax + hx) * 0.5,
                base[1] + height_m * 0.5,
                (az + hz) * 0.5,
                len,
                height_m,
                @max(thickness_m, 0.05),
                yaw,
                EMERALD,
                0.30,
            );
        }
    }
    // The measurement gizmo: height arm + head, thickness hub + nudge arrows.
    // PLANTED chrome only (req_4531): it stands on the draw anchor or the
    // selected wall's midpoint — never on the free cursor.
    if ((st.armed and st.anchored) or (st.sel and !st.armed)) {
        const arm_w = ARM_THICKNESS_PX * wpp;
        const head_s = HEAD_PX * wpp;
        const hub_s = HUB_PX * wpp;
        const nudge_s = NUDGE_PX * wpp;
        const gap = NUDGE_GAP_PX * wpp;
        const arm_color = if (st.drag == .height) AMBER else (if (st.sel and !st.armed) CYAN else ARM_GREEN);
        const hub_color = if (st.drag == .thickness) AMBER else HUB_ICE;
        // Arm shaft base→top, head cone on top (apex up).
        appendBox(self, base[0], base[1] + height_m * 0.5, base[2], arm_w, height_m, arm_w, 0, arm_color, 0.95);
        appendCone(self, base[0], base[1] + height_m + head_s * 0.5, base[2], head_s, head_s, 0, arm_color, 0.95);
        // Hub: a squat diamond at the base.
        appendBox(self, base[0], base[1] + 0.02, base[2], hub_s, 0.04, hub_s, std.math.pi / 4.0, hub_color, 0.95);
        // Nudge arrows: cones tipped outward along world X (− thinner, + thicker).
        appendCone(self, base[0] - gap, base[1] + 0.03, base[2], nudge_s, nudge_s, std.math.pi / 2.0, hub_color, 0.95);
        appendCone(self, base[0] + gap, base[1] + 0.03, base[2], nudge_s, nudge_s, -std.math.pi / 2.0, hub_color, 0.95);
    }
}

fn appendBox(self: anytype, x: f32, y: f32, z: f32, sx: f32, sy: f32, sz: f32, rot_y: f32, color: [3]f32, alpha: f32) void {
    appendNode(self, "box", self.cube[0..], x, y, z, sx, sy, sz, 0, rot_y, color, alpha);
}

fn appendCone(self: anytype, x: f32, y: f32, z: f32, s: f32, h: f32, rot_z: f32, color: [3]f32, alpha: f32) void {
    appendNode(self, "paint-gizmo-cone", self.brush_cone[0..], x, y, z, s, h, s, rot_z, 0, color, alpha);
}

fn appendNode(self: anytype, key: []const u8, verts: []const f32, x: f32, y: f32, z: f32, sx: f32, sy: f32, sz: f32, rot_z: f32, rot_y: f32, color: [3]f32, alpha: f32) void {
    self.kid_list.append(self.allocator, .{
        .scene3d_mesh = true,
        .scene3d_geom_key = key,
        .scene3d_vertices = verts,
        .scene3d_vert_count = @intCast(verts.len / 8),
        .scene3d_pos_x = x,
        .scene3d_pos_y = y,
        .scene3d_pos_z = z,
        .scene3d_scale_x = sx,
        .scene3d_scale_y = sy,
        .scene3d_scale_z = sz,
        .scene3d_rot_y = rot_y,
        .scene3d_rot_z = rot_z,
        .scene3d_color_r = color[0],
        .scene3d_color_g = color[1],
        .scene3d_color_b = color[2],
        .scene3d_color_a = alpha,
    }) catch {};
}

// ── Laws under test ─────────────────────────────────────────────────────────

test "height snaps to quarter-metres and clamps to the ruled range" {
    try std.testing.expectEqual(@as(i32, 48), snapHeightU(48.4));
    try std.testing.expectEqual(@as(i32, 48), snapHeightU(46.1));
    try std.testing.expectEqual(@as(i32, HEIGHT_MIN_U), snapHeightU(-20));
    try std.testing.expectEqual(@as(i32, HEIGHT_MAX_U), snapHeightU(10_000));
    try std.testing.expectEqual(@as(i32, HEIGHT_MIN_U), snapHeightU(std.math.nan(f32)));
}

test "thickness snaps to whole u and clamps" {
    try std.testing.expectEqual(@as(i32, 2), snapThicknessU(2.3));
    try std.testing.expectEqual(@as(i32, THICKNESS_MIN_U), snapThicknessU(0));
    try std.testing.expectEqual(@as(i32, THICKNESS_MAX_U), snapThicknessU(400));
}

test "nudge steps stay inside the clamp" {
    const st = slotFor(7777).?;
    st.armed = true;
    st.thickness_u = THICKNESS_MIN_U;
    st.thickness_u = snapThicknessU(@as(f32, @floatFromInt(st.thickness_u - THICKNESS_SNAP_U)));
    try std.testing.expectEqual(THICKNESS_MIN_U, st.thickness_u);
    st.thickness_u = snapThicknessU(@as(f32, @floatFromInt(st.thickness_u + THICKNESS_SNAP_U)));
    try std.testing.expectEqual(THICKNESS_MIN_U + THICKNESS_SNAP_U, st.thickness_u);
    st.* = .{};
    refreshAnyArmed();
}

test "arming resets the anchor and disarming clears the armed flag" {
    setMode(4242, true, 1, 48, 2);
    setAnchor(4242, true, 32, 64);
    const st = stateFor(4242).?;
    try std.testing.expect(st.armed and st.anchored);
    try std.testing.expectEqual(@as(i32, 1), st.floor);
    setMode(4242, false, 1, 0, 0);
    try std.testing.expect(!st.armed and !st.anchored);
    try std.testing.expect(!anyWallToolArmed());
    st.* = .{};
}
