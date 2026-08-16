//! Dynamic props, tickers, traffic, elevators, and baked/live door motion.
//!
//! Operations are generic over the retained Runtime shape to keep ownership in runtime.zig.

const std = @import("std");
const layout = @import("../layout.zig");
const Node = layout.Node;
const constructor = @import("../world/constructor.zig");
const game_physics = @import("../game/physics.zig");
const log = std.debug;
const m_config = @import("config.zig");
const m_state = @import("state.zig");
const m_physics = @import("physics.zig");

const INSTANCE_STRIDE = m_config.INSTANCE_STRIDE;
const TRAFFIC_PROTO_STRIDE = m_config.TRAFFIC_PROTO_STRIDE;
const SHAPE_CYLINDER16 = m_config.SHAPE_CYLINDER16;
const SHAPE_SPHERE = m_config.SHAPE_SPHERE;
const ELEVATOR_ARRIVE_TOLERANCE_METERS = m_config.ELEVATOR_ARRIVE_TOLERANCE_METERS;
const DOOR_OPEN_HIDE_DROP_METERS = m_config.DOOR_OPEN_HIDE_DROP_METERS;
const DOOR_OPEN_PARK_METERS = m_config.DOOR_OPEN_PARK_METERS;
const doorHalfExtents = m_state.doorHalfExtents;
const CookedDoor = m_state.CookedDoor;
const COOKED_DOOR_SWING_ARC_DEGREES = m_state.COOKED_DOOR_SWING_ARC_DEGREES;
const COOKED_DOOR_OPEN_SECONDS = m_state.COOKED_DOOR_OPEN_SECONDS;
const cookedDoorOrientedFloats = m_state.cookedDoorOrientedFloats;
const rotateYLocal = m_state.rotateYLocal;
const sampleRoute = m_state.sampleRoute;
const sceneTerrainTopAt = m_physics.sceneTerrainTopAt;

pub fn updateDynamicPropNodes(self: anytype) void {
    const dp = self.scene.dynamic_props orelse return;
    var kid = self.dyn_first_child;
    for (dp.props, 0..) |dprop, i| {
        var ax = dprop.x;
        var ay = dprop.y;
        var az = dprop.z;
        if (i < self.bodies.len) {
            const b = self.bodies[i];
            ax = b.x;
            ay = b.y - b.radius;
            az = b.z;
        }
        const part_count = dprop.parts.len / constructor.DYNAMIC_PART_FLOATS;
        var k: usize = 0;
        while (k < part_count) : (k += 1) {
            const row = dprop.parts[k * constructor.DYNAMIC_PART_FLOATS ..];
            const local = rotateYLocal(.{ row[0], row[1], row[2] }, dprop.yaw_degrees);
            const node = &self.kid_list.items[kid];
            node.scene3d_pos_x = ax + local.x;
            node.scene3d_pos_y = ay + local.y;
            node.scene3d_pos_z = az + local.z;
            node.scene3d_rot_x = row[3];
            node.scene3d_rot_y = row[4] + dprop.yaw_degrees;
            node.scene3d_rot_z = row[5];
            kid += 1;
        }
    }
}

/// req_0893 #3 — scroll every LED ticker and rebuild its lit-LED instance
/// bucket in place. Mirrors cart/hmsc-int/compile/propRecipes/ledTicker.ts
/// ledLitDots: the integer part of the offset selects the source column
/// (wrapped), the fraction slides the window; lit cells become dot-box
/// instances at the prop's anchor + yaw. Visual only (no physics), so it runs
/// even under spatial windowing.
pub fn stepTickers(self: anytype, dt: f32) void {
    const tk = self.scene.tickers orelse return;
    if (tk.boards.len == 0) return;
    self.ticker_seconds += dt;
    for (tk.boards, 0..) |board, ti| {
        const buf = self.ticker_buffers[ti];
        const n_cols = board.columns.len;
        var count: u32 = 0;
        if (n_cols > 0) {
            const offset = self.ticker_seconds * board.scroll_cols_per_sec;
            const base: i64 = @floor(offset);
            const frac = offset - @floor(offset);
            const half_w = -board.face_left; // face_left is negative
            const max_dots: u32 = @intCast(buf.len / INSTANCE_STRIDE);
            const m: i64 = @intCast(n_cols);
            var vc: u32 = 0;
            while (vc <= board.window_cols) : (vc += 1) {
                const src: usize = @intCast(@mod(base + @as(i64, @intCast(vc)), m));
                const mask = board.columns[src];
                if (mask == 0) continue;
                const cell_x = board.face_left + (@as(f32, @floatFromInt(vc)) - frac + 0.5) * board.cell;
                if (cell_x < board.face_left - board.cell * 0.5 or cell_x > half_w + board.cell * 0.5) continue;
                var r: u32 = 0;
                while (r < board.rows) : (r += 1) {
                    if ((mask & (@as(u8, 1) << @as(u3, @intCast(r)))) == 0) continue;
                    if (count >= max_dots) break;
                    const ly = board.face_top - (@as(f32, @floatFromInt(r)) + 0.5) * board.cell;
                    const local = rotateYLocal(.{ cell_x, ly, board.face_z }, board.yaw_degrees);
                    const o = @as(usize, count) * INSTANCE_STRIDE;
                    buf[o + 0] = board.x + local.x;
                    buf[o + 1] = board.y + local.y;
                    buf[o + 2] = board.z + local.z;
                    buf[o + 3] = 0;
                    buf[o + 4] = board.yaw_degrees;
                    buf[o + 5] = 0;
                    buf[o + 6] = board.dot_size;
                    buf[o + 7] = board.dot_size;
                    buf[o + 8] = board.dot_size;
                    buf[o + 9] = board.color[0];
                    buf[o + 10] = board.color[1];
                    buf[o + 11] = board.color[2];
                    count += 1;
                }
            }
        }
        self.kid_list.items[self.ticker_first_child + ti].scene3d_instance_count = count;
    }
}

/// Ambient road traffic (req_2056): advance every vehicle along its baked
/// route (arc-length = speed*t + phase, wrapped to the loop length) and
/// rebuild the three mutable instance buffers at the sampled pose. Each part
/// prototype row is rotated about the agent by its heading and lifted onto the
/// terrain under it — the LED-ticker mutable-instance pattern, one bucket per
/// shape. No allocation in the hot path.
pub fn stepTraffic(self: anytype, dt: f32) void {
    const tr = self.scene.traffic orelse return;
    if (tr.vehicles.len == 0) return;
    self.traffic_seconds += dt;
    var box_n: u32 = 0;
    var cyl_n: u32 = 0;
    var sph_n: u32 = 0;
    const box_cap: u32 = @intCast(self.traffic_box_buf.len / INSTANCE_STRIDE);
    const cyl_cap: u32 = @intCast(self.traffic_cyl_buf.len / INSTANCE_STRIDE);
    const sph_cap: u32 = @intCast(self.traffic_sphere_buf.len / INSTANCE_STRIDE);
    for (tr.vehicles) |veh| {
        if (veh.length <= 1.0e-4 or veh.route.len < 4) continue;
        const s = @mod(self.traffic_seconds * veh.speed + veh.phase, veh.length);
        const pose = sampleRoute(veh.route, s);
        // The vehicle model's FRONT is -Z (hood/headlights at -halfLength), so face
        // travel by rotating the whole body 180° past the raw heading.
        const heading = pose.heading_deg + 180;
        const ground = sceneTerrainTopAt(self.scene.heightfields, pose.x, pose.z) orelse 0;
        var ri: usize = 0;
        while (ri + TRAFFIC_PROTO_STRIDE <= veh.rows.len) : (ri += TRAFFIC_PROTO_STRIDE) {
            const r = veh.rows[ri .. ri + TRAFFIC_PROTO_STRIDE];
            const shape = r[12];
            const local = rotateYLocal(.{ r[0], r[1], r[2] }, heading);
            var buf: []f32 = undefined;
            var slot: u32 = undefined;
            if (@abs(shape - SHAPE_CYLINDER16) < 0.5) {
                if (cyl_n >= cyl_cap) continue;
                buf = self.traffic_cyl_buf;
                slot = cyl_n;
                cyl_n += 1;
            } else if (@abs(shape - SHAPE_SPHERE) < 0.5) {
                if (sph_n >= sph_cap) continue;
                buf = self.traffic_sphere_buf;
                slot = sph_n;
                sph_n += 1;
            } else {
                if (box_n >= box_cap) continue;
                buf = self.traffic_box_buf;
                slot = box_n;
                box_n += 1;
            }
            const o = @as(usize, slot) * INSTANCE_STRIDE;
            buf[o + 0] = pose.x + local.x;
            buf[o + 1] = ground + local.y;
            buf[o + 2] = pose.z + local.z;
            buf[o + 3] = r[3];
            buf[o + 4] = r[4] + heading;
            buf[o + 5] = r[5];
            buf[o + 6] = r[6];
            buf[o + 7] = r[7];
            buf[o + 8] = r[8];
            buf[o + 9] = r[9];
            buf[o + 10] = r[10];
            buf[o + 11] = r[11];
        }
    }
    self.kid_list.items[self.traffic_first_child + 0].scene3d_instance_count = box_n;
    self.kid_list.items[self.traffic_first_child + 1].scene3d_instance_count = cyl_n;
    self.kid_list.items[self.traffic_first_child + 2].scene3d_instance_count = sph_n;
    // [traffic-diag req_2056] RJIT_TRAFFICLOG=1 prints the emit counts + vehicle 0's
    // first box row (world pos/scale/color) ONCE, mid-capture — proves the per-frame
    // transform produces sane, colored, sized instances.
    if (self.frame == 5 and self.traffic_log) {
        log.print("[traffic] frame5 emit box={d} cyl={d} sph={d}\n", .{ box_n, cyl_n, sph_n });
        if (box_n > 0) {
            const o: usize = 0;
            log.print("[traffic] v0 box0 pos=({d:.1},{d:.1},{d:.1}) scale=({d:.2},{d:.2},{d:.2}) color=({d:.2},{d:.2},{d:.2}) ry={d:.0}\n", .{
                self.traffic_box_buf[o + 0], self.traffic_box_buf[o + 1],  self.traffic_box_buf[o + 2],
                self.traffic_box_buf[o + 6], self.traffic_box_buf[o + 7],  self.traffic_box_buf[o + 8],
                self.traffic_box_buf[o + 9], self.traffic_box_buf[o + 10], self.traffic_box_buf[o + 11],
                self.traffic_box_buf[o + 4],
            });
        }
    }
}

/// req_0652 — /test's elevator ride, native: advance every car toward its
/// target stop and re-aim its LIVE rect in the physics buffer IN PLACE
/// (the step reads this buffer every frame, so the rising top carries the
/// standing player); the car's render node follows. No-op without cars;
/// skipped under spatial windowing (that path re-derives its buffer from
/// render instances per frame, which carries no cars).
pub fn stepElevators(self: anytype, dt: f32) void {
    if (self.cars.len == 0 or self.windowed) return;
    const el = self.scene.elevators orelse return;
    const base = self.physics_colliders.rectBase() + self.physics_colliders.car_rect_start * game_physics.RECT_FLOATS;
    for (self.cars, 0..) |*car, i| {
        const shaft = el.shafts[i];
        const delta = car.target_y - car.car_y;
        if (@abs(delta) > ELEVATOR_ARRIVE_TOLERANCE_METERS) {
            const step_m = @max(0.01, shaft.car_speed) * dt;
            car.car_y = if (@abs(delta) <= step_m) car.target_y else car.car_y + std.math.sign(delta) * step_m;
        }
        const at = base + i * game_physics.RECT_FLOATS;
        self.physics_colliders.values[at + 4] = car.car_y + shaft.car_thickness; // top
        self.physics_colliders.values[at + 8] = car.car_y; // floor
        const node = &self.kid_list.items[self.car_first_child + i];
        node.scene3d_pos_x = shaft.x;
        node.scene3d_pos_y = car.car_y + shaft.car_thickness / 2;
        node.scene3d_pos_z = shaft.z;
    }
}

/// DOORS-0611 — flip one door's two-state machine: the live rect stops or
/// resumes blocking (blocksPlayer float, read by the step every frame)
/// and the panel node drops out of sight / returns. Instant, /test parity
/// (pieceDoorSet re-materializes the panel the same way).
pub fn toggleDoor(self: anytype, index: usize) void {
    const doors = self.scene.doors orelse return;
    const record = doors.records[index];
    const open = !self.doors_state[index].open;
    self.doors_state[index].open = open;
    // The rect PARKS out of the world while open (see DOOR_OPEN_PARK_METERS:
    // a non-solid rect taller than step height still side-pushes — that
    // de-flag-only first cut was req_0663's unwalkable open door).
    const at = self.physics_colliders.rectBase() + (self.physics_colliders.door_rect_start + index) * game_physics.RECT_FLOATS;
    const half = doorHalfExtents(record);
    const park: f32 = if (open) DOOR_OPEN_PARK_METERS else 0;
    self.physics_colliders.values[at + 0] = record.x - half[0] + park; // minX
    self.physics_colliders.values[at + 1] = record.z - half[1] + park; // minZ
    self.physics_colliders.values[at + 2] = record.x + half[0] + park; // maxX
    self.physics_colliders.values[at + 3] = record.z + half[1] + park; // maxZ
    self.physics_colliders.values[at + 5] = if (open) 0 else 1; // blocksPlayer
    const node = &self.kid_list.items[self.door_first_child + index];
    const hide: f32 = if (open) DOOR_OPEN_HIDE_DROP_METERS else 0;
    node.scene3d_pos_y = record.base_y + record.panel_h / 2 - hide;
}

/// req_1864/req_1908 — flip a cooked door's TARGET; stepCookedDoors swings the
/// leaf about its hinge toward the new target (open/closed) over openSeconds.
pub fn toggleCookedDoor(self: anytype, index: usize) void {
    if (index >= self.cooked_doors.len) return;
    self.cooked_doors[index].open = !self.cooked_doors[index].open;
}

/// Editor-live twin of toggleCookedDoor. The parallel State slice is the
/// reconciliation record carried across the next whole-ref replacement.
pub fn toggleLiveCookedDoor(self: anytype, index: usize) void {
    if (index >= self.live_cooked_doors.len or index >= self.live_cooked_door_states.len) return;
    const open = !self.live_cooked_doors[index].open;
    self.live_cooked_doors[index].open = open;
    self.live_cooked_door_states[index].open = open;
}

/// Apply one cooked door's current progress to its leaf nodes + physical
/// panel. Live nodes are rebuilt at the end of every frame, so this is also
/// called immediately after appendLiveMeshRef binds their fresh indices.
pub fn applyCookedDoorPose(self: anytype, cd: *CookedDoor) void {
    const theta_deg = cd.progress * COOKED_DOOR_SWING_ARC_DEGREES;
    const theta = theta_deg * std.math.pi / 180.0;
    const ct = @cos(theta);
    const st = @sin(theta);
    const dx = cd.node_x - cd.hinge_x;
    const dz = cd.node_z - cd.hinge_z;
    // The leaf nodes (opaque frame + glass pane, req_2020) share one instance
    // pose, so the SAME hinge swing applies to each: node_pos = hinge +
    // Ry(theta)*(inst-hinge), matching the engine's m4rotateY.
    const swung_x = cd.hinge_x + (dx * ct + dz * st);
    const swung_z = cd.hinge_z + (-dx * st + dz * ct);
    var ni: usize = 0;
    while (ni < cd.node_child_count) : (ni += 1) {
        const idx = cd.node_child_first + ni;
        if (idx >= self.kid_list.items.len) break;
        const node = &self.kid_list.items[idx];
        node.scene3d_pos_x = swung_x;
        node.scene3d_pos_z = swung_z;
        node.scene3d_pos_y = cd.node_base_y;
        node.scene3d_rot_y = cd.yaw_degrees + theta_deg;
    }
    // req_1960: the panel collider follows the swing and remains physical.
    // req_4538: ORIENTED slot — orientedBase() moves with live rect folds, so
    // it must be recomputed every call, never cached.
    const at = self.physics_colliders.orientedBase() + cd.oriented_index * game_physics.ORIENTED_FLOATS;
    if (at + game_physics.ORIENTED_FLOATS <= self.physics_colliders.values.len and cd.oriented_index < self.physics_colliders.oriented_count) {
        @memcpy(self.physics_colliders.values[at .. at + game_physics.ORIENTED_FLOATS], &cookedDoorOrientedFloats(cd.*));
    }
}

pub fn stepCookedDoor(self: anytype, cd: *CookedDoor, rate: f32) void {
    const target: f32 = if (cd.open) 1.0 else 0.0;
    if (cd.progress < target) {
        cd.progress = @min(target, cd.progress + rate);
    } else if (cd.progress > target) {
        cd.progress = @max(target, cd.progress - rate);
    }
    applyCookedDoorPose(self, cd);
}

/// req_1908 — advance every cooked door's swing: ease `progress` toward the
/// target, rotate the leaf NODE about its world hinge by `progress * arc`, and
/// clear/raise its collision rect once it's past half-open (walk through the
/// swinging door). The pivot keeps the hinge edge fixed: a leaf vert at world
/// closed-pos rotates about the hinge, so node_pos = hinge + Ry(theta)*(inst-hinge)
/// and node_rot_y = inst_yaw + theta.
pub fn stepCookedDoors(self: anytype, dt: f32) void {
    if (self.cooked_doors.len == 0 and self.live_cooked_doors.len == 0) return;
    const rate = dt / COOKED_DOOR_OPEN_SECONDS;
    for (self.cooked_doors) |*cd| stepCookedDoor(self, cd, rate);
    for (self.live_cooked_doors, 0..) |*cd, index| {
        stepCookedDoor(self, cd, rate);
        if (index < self.live_cooked_door_states.len) {
            self.live_cooked_door_states[index].open = cd.open;
            self.live_cooked_door_states[index].progress = cd.progress;
        }
    }
}
