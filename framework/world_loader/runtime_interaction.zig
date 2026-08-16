//! Reach occlusion, interaction state transitions, and native HUD publication.
//!
//! Operations are generic over the retained Runtime shape to keep ownership in runtime.zig.

const std = @import("std");
const build_options = @import("build_options");
const gpu = if (build_options.dev_native_modules and build_options.dev_game_module)
    @import("../dev_modules/gpu_api.zig")
else
    @import("../gpu/gpu.zig");
const layout = @import("../layout.zig");
const Node = layout.Node;
const game_physics = @import("../game/physics.zig");
const log = std.debug;
const m_config = @import("config.zig");
const m_state = @import("state.zig");
const runtime_dynamics = @import("runtime_dynamics.zig");

const SCAN_E = m_config.SCAN_E;
const INTERACT_REACH_METERS = m_config.INTERACT_REACH_METERS;
const INTERACT_Y_WINDOW_METERS = m_config.INTERACT_Y_WINDOW_METERS;
const INTERACT_SEARCH_CANCEL_MOVE_METERS = m_config.INTERACT_SEARCH_CANCEL_MOVE_METERS;
const INTERACT_EYE_HEIGHT_METERS = m_config.INTERACT_EYE_HEIGHT_METERS;
const INTERACT_PROP_AIM_HEIGHT_METERS = m_config.INTERACT_PROP_AIM_HEIGHT_METERS;
const INTERACT_BLOCKER_MAX_THICKNESS_METERS = m_config.INTERACT_BLOCKER_MAX_THICKNESS_METERS;
const ELEVATOR_ARRIVE_TOLERANCE_METERS = m_config.ELEVATOR_ARRIVE_TOLERANCE_METERS;
const ELEVATOR_BOARD_REACH_METERS = m_config.ELEVATOR_BOARD_REACH_METERS;
const ELEVATOR_BOARD_BELOW_METERS = m_config.ELEVATOR_BOARD_BELOW_METERS;
const ELEVATOR_CALL_REACH_METERS = m_config.ELEVATOR_CALL_REACH_METERS;
const DOOR_Y_WINDOW_METERS = m_config.DOOR_Y_WINDOW_METERS;
const nextElevatorStop = m_state.nextElevatorStop;
const nearestElevatorStop = m_state.nearestElevatorStop;
const elevatorStopIndex = m_state.elevatorStopIndex;
const CookedDoor = m_state.CookedDoor;
const clamp = m_state.clamp;
const keyDown = m_state.keyDown;
const toggleCookedDoor = runtime_dynamics.toggleCookedDoor;
const toggleDoor = runtime_dynamics.toggleDoor;
const toggleLiveCookedDoor = runtime_dynamics.toggleLiveCookedDoor;

pub fn interactReachBlockedExceptRect(self: anytype, target_x: f32, target_y: f32, target_z: f32, skip_oriented_index: ?usize) bool {
    if (!self.has_physics_colliders) return false;
    const colliders = &self.physics_colliders;
    if (colliders.rect_count == 0 and colliders.oriented_count == 0) return false;
    return game_physics.reachBlockedStepCollidersExceptRect(
        colliders.values[colliders.entity_capacity * game_physics.ENTITY_FLOATS ..],
        colliders.rect_count,
        colliders.oriented_count,
        self.player.x,
        self.player.y + INTERACT_EYE_HEIGHT_METERS,
        self.player.z,
        target_x,
        target_y,
        target_z,
        INTERACT_BLOCKER_MAX_THICKNESS_METERS,
        skip_oriented_index,
    );
}

pub fn interactReachBlocked(self: anytype, target_x: f32, target_y: f32, target_z: f32) bool {
    return interactReachBlockedExceptRect(self, target_x, target_y, target_z, null);
}

pub fn cookedDoorReachBlocked(self: anytype, cd: CookedDoor) bool {
    return interactReachBlockedExceptRect(self, cd.cx, cd.base_y + cd.panel_h / 2, cd.cz, cd.oriented_index);
}

/// PROPUSE req_0624 — /test's interact frame, native: resolve the nearest
/// seat/container in reach over the INTERACTABLES lump, run the prompt /
/// E edge / search timer, pin the seat pose. Mirrors PlayRoute.tsx
/// interactFrame semantics (reach, cancel radius, prompt grammar).
/// req_0652 adds the elevator: standing ON the car E rides to the next
/// stop (wrapping down from the top); at a landing with the car elsewhere
/// E calls it — props in reach win the E first, /test's priority.
pub fn stepInteract(self: anytype, dt: f32) void {
    const st = &self.interact;
    if (st.notice_left > 0) st.notice_left = @max(0, st.notice_left - dt);
    st.prompt_len = 0;
    st.bar_progress = -1;
    // props are optional (the INTERACTABLES lump) and so are elevators
    // (the ELEVATORS lump) — either alone keeps the frame alive (req_0652).
    const ia_opt = self.scene.interactables;
    const has_props = if (ia_opt) |ia| ia.instances.len > 0 else false;
    if (!has_props and self.cars.len == 0 and self.doors_state.len == 0 and self.cooked_doors.len == 0 and self.live_cooked_doors.len == 0) return;

    // 1. advance / cancel / finish an active search (props only)
    if (st.search_active) {
        const ia = ia_opt.?;
        const arch = ia.archetypes[ia.instances[st.search_instance].archetype];
        const adx = self.player.x - st.search_anchor_x;
        const adz = self.player.z - st.search_anchor_z;
        const moved_away = @sqrt(adx * adx + adz * adz) > INTERACT_SEARCH_CANCEL_MOVE_METERS;
        st.search_elapsed += dt;
        if (moved_away) {
            st.search_active = false;
            st.postNotice("Search interrupted", .{});
        } else if (st.search_elapsed >= arch.search_seconds) {
            st.search_active = false;
            st.searched[st.search_instance] = true;
            st.postNotice("Searched the {s} — empty for now ({s} loot lands with the item system)", .{ arch.label, arch.loot_category });
        } else {
            st.bar_progress = clamp(st.search_elapsed / @max(0.001, arch.search_seconds), 0, 1);
            st.setPrompt("Searching the {s}...", .{arch.label});
        }
    }

    // 2. resolve the nearest interactable in reach
    var target: ?usize = null;
    if (self.player.posture != .none) {
        st.setPrompt("WASD / Space — stand up", .{});
    } else if (!st.search_active and has_props) {
        const ia = ia_opt.?;
        var best_distance: f32 = INTERACT_REACH_METERS;
        for (ia.instances, 0..) |inst, i| {
            if (@abs(inst.y - self.player.y) > INTERACT_Y_WINDOW_METERS) continue;
            const dx = inst.x - self.player.x;
            const dz = inst.z - self.player.z;
            const distance = @sqrt(dx * dx + dz * dz);
            if (distance > best_distance) continue;
            // req_0674: within arm's length is not enough — a wall between
            // the player and the prop kills its E (fridge on the far side).
            if (interactReachBlocked(self, inst.x, inst.y + INTERACT_PROP_AIM_HEIGHT_METERS, inst.z)) continue;
            best_distance = distance;
            target = i;
        }
        if (target) |i| {
            const arch = ia.archetypes[ia.instances[i].archetype];
            if (arch.has_container) {
                if (st.searched[i]) {
                    st.setPrompt("{s} — already searched", .{arch.label});
                } else if (arch.access != 0) {
                    st.setPrompt("{s} — locked (needs a key)", .{arch.label});
                } else {
                    st.setPrompt("E — search the {s}", .{arch.label});
                }
            } else if (arch.has_seat) {
                if (arch.seat_pose == 1) {
                    st.setPrompt("E — lie down on the {s}", .{arch.label});
                } else {
                    st.setPrompt("E — sit on the {s}", .{arch.label});
                }
            }
        }
    }

    // 2a-doors (DOORS-0611) — the nearest door leaf in ITS OWN reach wins
    // the E when no prop claimed the prompt (/test's priority: things in
    // reach beat the elevator call).
    var door_target: ?usize = null;
    if (self.player.posture == .none and !st.search_active and st.prompt_len == 0 and self.doors_state.len > 0) {
        const doors = self.scene.doors.?;
        var best_distance: f32 = std.math.floatMax(f32);
        for (self.doors_state, 0..) |_, i| {
            const record = doors.records[i];
            if (@abs(record.base_y - self.player.y) > DOOR_Y_WINDOW_METERS) continue;
            const dx = record.x - self.player.x;
            const dz = record.z - self.player.z;
            const distance = @sqrt(dx * dx + dz * dz);
            if (distance > record.reach or distance > best_distance) continue;
            // req_0674: a door behind ANOTHER wall must not offer its E;
            // the aimed door's own panel is skipped inside the query.
            if (interactReachBlocked(self, record.x, record.base_y + record.panel_h / 2, record.z)) continue;
            best_distance = distance;
            door_target = i;
        }
        if (door_target) |i| {
            const record = doors.records[i];
            const label: []const u8 = if (record.vehicle) "garage door" else "door";
            if (self.doors_state[i].open) {
                st.setPrompt("E — close the {s}", .{label});
            } else {
                st.setPrompt("E — open the {s}", .{label});
            }
        }
    }

    // 2a-cooked (req_1864) — custom doors compiled from a Studio model. Same
    // nearest-in-reach rule + prompt grammar as the built-in doors; only when
    // a built-in door hasn't already claimed the prompt.
    var cooked_door_target: ?usize = null;
    if (self.player.posture == .none and !st.search_active and st.prompt_len == 0 and self.cooked_doors.len > 0) {
        var best_distance: f32 = std.math.floatMax(f32);
        for (self.cooked_doors, 0..) |cd, i| {
            if (@abs(cd.base_y - self.player.y) > DOOR_Y_WINDOW_METERS) continue;
            const dx = cd.cx - self.player.x;
            const dz = cd.cz - self.player.z;
            const distance = @sqrt(dx * dx + dz * dz);
            if (distance > cd.reach or distance > best_distance) continue;
            if (cookedDoorReachBlocked(self, cd)) continue;
            best_distance = distance;
            cooked_door_target = i;
        }
        if (cooked_door_target) |i| {
            const cd = self.cooked_doors[i];
            const label: []const u8 = if (cd.vehicle) "garage door" else "door";
            if (cd.open) {
                st.setPrompt("E — close the {s}", .{label});
            } else {
                st.setPrompt("E — open the {s}", .{label});
            }
        }
    }

    // 2a-live-cooked (req_2895/req_2896) — the editor's just-exported Door
    // Wall rides resident mesh metadata + live refs before any map Compile.
    // It uses the exact prompt/reach contract as a baked cooked door.
    var live_cooked_door_target: ?usize = null;
    if (self.player.posture == .none and !st.search_active and st.prompt_len == 0 and self.live_cooked_doors.len > 0) {
        var best_distance: f32 = std.math.floatMax(f32);
        for (self.live_cooked_doors, 0..) |cd, i| {
            if (@abs(cd.base_y - self.player.y) > DOOR_Y_WINDOW_METERS) continue;
            const dx = cd.cx - self.player.x;
            const dz = cd.cz - self.player.z;
            const distance = @sqrt(dx * dx + dz * dz);
            if (distance > cd.reach or distance > best_distance) continue;
            if (cookedDoorReachBlocked(self, cd)) continue;
            best_distance = distance;
            live_cooked_door_target = i;
        }
        if (live_cooked_door_target) |i| {
            const cd = self.live_cooked_doors[i];
            const label: []const u8 = if (cd.vehicle) "garage door" else "door";
            if (cd.open) {
                st.setPrompt("E — close the {s}", .{label});
            } else {
                st.setPrompt("E — open the {s}", .{label});
            }
        }
    }

    // 2b. the elevator (req_0652) — only when no prop claimed the prompt
    // (/test's priority: doors/props in reach win the E first).
    var elevator_ride: ?struct { index: usize, to_y: f32 } = null;
    if (self.player.posture == .none and !st.search_active and st.prompt_len == 0 and self.cars.len > 0) {
        const el = self.scene.elevators.?;
        for (self.cars, 0..) |car, i| {
            const shaft = el.shafts[i];
            const inside = @abs(self.player.x - shaft.x) <= shaft.module_half_x and @abs(self.player.z - shaft.z) <= shaft.module_half_z;
            const car_moving = @abs(car.target_y - car.car_y) > ELEVATOR_ARRIVE_TOLERANCE_METERS;
            if (inside and car_moving) {
                st.setPrompt("Elevator moving...", .{});
                break;
            }
            const car_top = car.car_y + shaft.car_thickness;
            const on_car = inside and self.player.y >= car.car_y - ELEVATOR_BOARD_BELOW_METERS and self.player.y <= car_top + ELEVATOR_BOARD_REACH_METERS;
            if (on_car) {
                if (nextElevatorStop(shaft.stops, car.car_y)) |next| {
                    elevator_ride = .{ .index = i, .to_y = next };
                    const floor_number = elevatorStopIndex(shaft.stops, next) + 1;
                    if (next > car.car_y) {
                        st.setPrompt("E — elevator up to floor {d}", .{floor_number});
                    } else {
                        st.setPrompt("E — elevator down to floor {d}", .{floor_number});
                    }
                } else {
                    st.setPrompt("Elevator — one stop (stack more storeys for more floors)", .{});
                }
                break;
            }
            if (car_moving) continue;
            const dx = shaft.x - self.player.x;
            const dz = shaft.z - self.player.z;
            if (@sqrt(dx * dx + dz * dz) > ELEVATOR_CALL_REACH_METERS) continue;
            const stop = nearestElevatorStop(shaft.stops, self.player.y);
            if (@abs(self.player.y - stop) > ELEVATOR_BOARD_REACH_METERS) continue;
            if (@abs(car.car_y - stop) <= ELEVATOR_ARRIVE_TOLERANCE_METERS) continue;
            elevator_ride = .{ .index = i, .to_y = stop };
            st.setPrompt("E — call the elevator", .{});
            break;
        }
    }

    // 3. the E edge
    const down = keyDown(SCAN_E);
    const pressed = down and !st.prev_e_down;
    st.prev_e_down = down;
    if (!pressed or st.search_active or self.player.posture != .none) return;
    if (door_target) |i| {
        toggleDoor(self, i);
        return;
    }
    if (cooked_door_target) |i| {
        toggleCookedDoor(self, i);
        return;
    }
    if (live_cooked_door_target) |i| {
        toggleLiveCookedDoor(self, i);
        return;
    }
    if (elevator_ride) |ride| {
        self.cars[ride.index].target_y = ride.to_y;
        return;
    }
    const i = target orelse return;
    const ia = ia_opt.?;
    const inst = ia.instances[i];
    const arch = ia.archetypes[inst.archetype];
    if (arch.has_container) {
        if (st.searched[i]) {
            st.postNotice("Nothing left in there", .{});
        } else if (arch.access != 0) {
            st.postNotice("The {s} is locked — needs a key", .{arch.label});
        } else {
            st.search_active = true;
            st.search_instance = i;
            st.search_elapsed = 0;
            st.search_anchor_x = self.player.x;
            st.search_anchor_z = self.player.z;
            st.bar_progress = 0;
        }
        return;
    }
    if (!arch.has_seat) return;
    // seat: pin the player to the prop (/test adoptPose parity: position =
    // the prop anchor, velocity zeroed, facing = the prop's yaw); stepNow's
    // stand-up edge owns the exit. Saved-character scene placement adds 180° to
    // player.yaw, so bake the prop's yaw
    // MINUS 180 into the state — the figure then faces the prop's own way
    // instead of sitting backwards (USER report 2026-06-11).
    self.player.x = inst.x;
    self.player.y = inst.y;
    self.player.z = inst.z;
    self.player.vx = 0;
    self.player.vy = 0;
    self.player.vz = 0;
    self.player.yaw = (inst.yaw_degrees - 180.0) * std.math.pi / 180.0;
    self.player.grounded = true;
    self.player.posture = if (arch.seat_pose == 1) .lay else .sit;
}

/// PROPUSE req_0624 — /test's InteractOverlay, native: the bottom-center
/// prompt pill / search loading bar / notice, drawn through the engine's
/// 2D batches right after the world quad is queued. Image quads record
/// segment boundaries, so these composite ON TOP of the world in both the
/// embedded /compiled route and the standalone window. Text no-ops when no
/// font face is initialized (drawTextLine guards); the bar still draws.
pub fn drawHud(self: anytype, x: f32, y: f32, w: f32, h: f32) void {
    const st = &self.interact;
    const has_bar = st.bar_progress >= 0;
    const has_prompt = st.prompt_len > 0;
    const has_notice = st.notice_left > 0 and st.notice_len > 0;
    if (!has_bar and !has_prompt and !has_notice) return;
    // /test anchors the overlay column 96px above the pane bottom.
    const cx = x + w / 2;
    const bar_block: f32 = 15 + 4 + 10;
    const prompt_block: f32 = 25;
    const notice_block: f32 = 22;
    var total: f32 = 0;
    if (has_bar) total += bar_block else if (has_prompt) total += prompt_block;
    if (has_notice) total += if (total > 0) 6 + notice_block else notice_block;
    var cy = y + h - 96 - total;
    if (has_bar) {
        // "Searching the X..." label over the 260x10 track + sky-blue fill.
        const label = st.prompt();
        const lw = gpu.measureTextLineWidth(label, 11);
        gpu.drawTextLine(label, cx - lw / 2, cy, 11, 0.886, 0.910, 0.941, 1);
        cy += 15 + 4;
        gpu.drawRect(cx - 130, cy, 260, 10, 0.059, 0.102, 0.180, 0.8, 5, 1, 0.2, 0.255, 0.333, 1);
        const fill_w: f32 = @max(4, @round(258 * st.bar_progress));
        gpu.drawRect(cx - 129, cy + 1, fill_w, 8, 0.22, 0.741, 0.973, 1, 4, 0, 0, 0, 0, 0);
        cy += 10 + 6;
    } else if (has_prompt) {
        const label = st.prompt();
        const lw = gpu.measureTextLineWidth(label, 11);
        gpu.drawRect(cx - lw / 2 - 12, cy, lw + 24, prompt_block, 0.059, 0.102, 0.180, 0.8, 6, 1, 0.2, 0.255, 0.333, 1);
        gpu.drawTextLine(label, cx - lw / 2, cy + 5, 11, 0.886, 0.910, 0.941, 1);
        cy += prompt_block + 6;
    }
    if (has_notice) {
        const label = st.notice();
        const lw = gpu.measureTextLineWidth(label, 10);
        gpu.drawRect(cx - lw / 2 - 12, cy, lw + 24, notice_block, 0.090, 0.145, 0.329, 0.8, 6, 0, 0, 0, 0, 0);
        gpu.drawTextLine(label, cx - lw / 2, cy + 4, 10, 0.749, 0.859, 0.996, 1);
    }
}
