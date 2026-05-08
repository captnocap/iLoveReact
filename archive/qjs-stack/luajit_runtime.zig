//! LuaJIT Runtime — main-thread logic VM for .tsz script blocks.
//!
//! Replaces QuickJS for the logic layer. LuaJIT's trace compiler JITs hot paths
//! to native code — 2-11x faster than QuickJS on conditionals, .map(), state, compute.
//!
//! Architecture:
//!   - Main-thread LuaJIT VM (NOT the background worker — this runs event handlers)
//!   - Host functions mirror qjs_runtime.zig: state get/set, input, mouse, telemetry
//!   - tsl_stdlib loaded at init (.map, .filter, .find, merge, etc.)
//!   - evalExpr() for event handlers, tick() for per-frame logic
//!
//! The compiler can emit Lua instead of JS for script blocks. The engine calls
//! luajit_runtime.tick() each frame and luajit_runtime.evalExpr() on events.

const std = @import("std");
const log = @import("log.zig");
const state = @import("state.zig");
const input_mod = @import("input.zig");
const qjs_runtime = @import("qjs_runtime.zig");
const mouse_state = @import("mouse_state.zig");
const layout = @import("layout.zig");
const effect_ctx = @import("effect_ctx.zig");
const effect_shader_mod = @import("effect_shader.zig");
const click_latency = @import("click_latency.zig");
const Node = layout.Node;
const Style = layout.Style;
const Color = layout.Color;

// ── Effect lookup tables (populated by cart _appInit) ──────────────────
// Cart generators emit setEffectRender(id, fn) + setEffectShader(id, shader)
// calls so the Lua→Node decoder can resolve effect_id back to function ptrs
// without the framework knowing cart-specific symbol names.
pub const MAX_EFFECTS: usize = 64;
var g_effect_renders: [MAX_EFFECTS]?effect_ctx.RenderFn = [_]?effect_ctx.RenderFn{null} ** MAX_EFFECTS;
var g_effect_shaders: [MAX_EFFECTS]?*const ?effect_shader_mod.GpuShaderDesc = [_]?*const ?effect_shader_mod.GpuShaderDesc{null} ** MAX_EFFECTS;

pub fn setEffectRender(id: usize, fn_ptr: effect_ctx.RenderFn) void {
    if (id >= MAX_EFFECTS) return;
    g_effect_renders[id] = fn_ptr;
}

pub fn setEffectShader(id: usize, shader_ptr: *const ?effect_shader_mod.GpuShaderDesc) void {
    if (id >= MAX_EFFECTS) return;
    g_effect_shaders[id] = shader_ptr;
}

pub const lua = @cImport({
    @cInclude("lua.h");
    @cInclude("lauxlib.h");
    @cInclude("lualib.h");
});

// ── Global VM state ─────────────────────────────────────────────────────

pub var g_lua: ?*lua.lua_State = null;

// ── Telemetry (read from engine.zig) ────────────────────────────────────

pub var telemetry_fps: u32 = 0;
pub var telemetry_layout_us: u64 = 0;
pub var telemetry_paint_us: u64 = 0;
pub var telemetry_tick_us: u64 = 0;
pub var bridge_calls_this_second: u64 = 0;
var bridge_last_reset: i64 = 0;
var g_click_latency: click_latency.ClickLatencyRing = .{};
var g_click_latency_seq: u64 = 0;
var g_click_latency_dump_on_apply = false;

pub fn setClickLatencyDumpOnApply(enabled: bool) void {
    g_click_latency_dump_on_apply = enabled;
}

// ── Host functions ──────────────────────────────────────────────────────

fn hostSetState(L: ?*lua.lua_State) callconv(.c) c_int {
    const slot = lua.lua_tointeger(L, 1);
    if (slot < 0 or slot >= state.MAX_SLOTS) return 0;
    switch (state.getSlotKind(@intCast(slot))) {
        .string => {
            var len: usize = 0;
            const ptr = lua.lua_tolstring(L, 2, &len);
            if (ptr == null) return 0;
            const s: []const u8 = @as([*]const u8, @ptrCast(ptr))[0..len];
            state.setSlotString(@intCast(slot), s);
        },
        .float => {
            const val = lua.lua_tonumber(L, 2);
            state.setSlotFloat(@intCast(slot), val);
        },
        .boolean => {
            state.setSlotBool(@intCast(slot), lua.lua_toboolean(L, 2) != 0);
        },
        .int => {
            state.setSlot(@intCast(slot), lua.lua_tointeger(L, 2));
        },
    }
    state.markDirty();
    bridge_calls_this_second += 1;
    return 0;
}

fn hostGetState(L: ?*lua.lua_State) callconv(.c) c_int {
    const slot = lua.lua_tointeger(L, 1);
    if (slot < 0 or slot >= state.MAX_SLOTS) {
        lua.lua_pushnumber(L, 0);
        return 1;
    }
    switch (state.getSlotKind(@intCast(slot))) {
        .float => lua.lua_pushnumber(L, state.getSlotFloat(@intCast(slot))),
        .boolean => lua.lua_pushnumber(L, if (state.getSlotBool(@intCast(slot))) 1 else 0),
        .int => lua.lua_pushnumber(L, @floatFromInt(state.getSlot(@intCast(slot)))),
        .string => lua.lua_pushnumber(L, 0),
    }
    return 1;
}

fn hostSetStateString(L: ?*lua.lua_State) callconv(.c) c_int {
    const slot = lua.lua_tointeger(L, 1);
    if (slot < 0 or slot >= state.MAX_SLOTS) return 0;
    var len: usize = 0;
    const ptr = lua.lua_tolstring(L, 2, &len);
    if (ptr == null) return 0;
    const s: []const u8 = @as([*]const u8, @ptrCast(ptr))[0..len];
    state.setSlotString(@intCast(slot), s);
    state.markDirty();
    bridge_calls_this_second += 1;
    return 0;
}

fn hostGetStateString(L: ?*lua.lua_State) callconv(.c) c_int {
    const slot = lua.lua_tointeger(L, 1);
    if (slot < 0 or slot >= state.MAX_SLOTS) {
        lua.lua_pushstring(L, "");
        return 1;
    }
    const s = state.getSlotString(@intCast(slot));
    lua.lua_pushlstring(L, s.ptr, @intCast(s.len));
    return 1;
}

fn hostMarkDirty(_: ?*lua.lua_State) callconv(.c) c_int {
    state.markDirty();
    return 0;
}

fn hostLog(L: ?*lua.lua_State) callconv(.c) c_int {
    const argc = lua.lua_gettop(L);
    const msg_idx: c_int = if (argc >= 2) 2 else 1;
    var level_len: usize = 0;
    var msg_len: usize = 0;
    const level_ptr = if (argc >= 2) lua.lua_tolstring(L, 1, &level_len) else null;
    const msg_ptr = lua.lua_tolstring(L, msg_idx, &msg_len);
    if (msg_ptr != null) {
        const msg: []const u8 = @as([*]const u8, @ptrCast(msg_ptr))[0..msg_len];
        if (level_ptr != null and level_len > 0) {
            const level: []const u8 = @as([*]const u8, @ptrCast(level_ptr))[0..level_len];
            std.log.info("[Lua:{s}] {s}", .{ level, msg });
        } else {
            std.log.info("[Lua] {s}", .{msg});
        }
    }
    return 0;
}

fn hostTrace(name: []const u8) void {
    _ = name;
}

fn hostGetInputText(L: ?*lua.lua_State) callconv(.c) c_int {
    const id = lua.lua_tointeger(L, 1);
    const text = input_mod.getText(@intCast(@max(0, id)));
    if (text.len == 0) {
        lua.lua_pushstring(L, "");
    } else {
        lua.lua_pushlstring(L, text.ptr, @intCast(text.len));
    }
    return 1;
}

/// __setInputText(id, text) — write to the framework input buffer directly.
/// Used to clear an input from Lua after a button-driven submit. Mirrors
/// the QJS version in qjs_runtime.zig so cart code calls the same name.
fn hostSetInputText(L: ?*lua.lua_State) callconv(.c) c_int {
    const id = lua.lua_tointeger(L, 1);
    var len: usize = 0;
    const ptr = lua.lua_tolstring(L, 2, &len);
    if (ptr == null) {
        input_mod.setText(@intCast(@max(0, id)), "");
        return 0;
    }
    const s: []const u8 = @as([*]const u8, @ptrCast(ptr))[0..len];
    input_mod.setText(@intCast(@max(0, id)), s);
    return 0;
}

/// __pollInputSubmit() -> { id = number, text = string } | nil
/// Drains the framework's "last Enter submit" one-shot so tick-loop carts can
/// pick up Enter submissions when the compiler didn't wire onSubmit directly.
fn hostPollInputSubmit(L: ?*lua.lua_State) callconv(.c) c_int {
    const evt = input_mod.consumeLastSubmit() orelse {
        lua.lua_pushnil(L);
        return 1;
    };
    lua.lua_newtable(L);
    lua.lua_pushinteger(L, @intCast(evt.id));
    lua.lua_setfield(L, -2, "id");
    lua.lua_pushlstring(L, evt.text.ptr, @intCast(evt.text.len));
    lua.lua_setfield(L, -2, "text");
    return 1;
}

fn hostClickLatencyBegin(L: ?*lua.lua_State) callconv(.c) c_int {
    g_click_latency_seq = g_click_latency.beginClick();
    lua.lua_pushinteger(L, @intCast(g_click_latency_seq));
    return 1;
}

fn hostClickLatencyCurrentSeq(L: ?*lua.lua_State) callconv(.c) c_int {
    lua.lua_pushinteger(L, @intCast(g_click_latency_seq));
    return 1;
}

fn hostClickLatencyStampDispatch(_: ?*lua.lua_State) callconv(.c) c_int {
    _ = g_click_latency.stampDispatch(g_click_latency_seq);
    return 0;
}

fn hostClickLatencyStampHandler(_: ?*lua.lua_State) callconv(.c) c_int {
    _ = g_click_latency.stampHandler(g_click_latency_seq);
    return 0;
}

fn hostClickLatencyStampStateUpdate(_: ?*lua.lua_State) callconv(.c) c_int {
    _ = g_click_latency.stampStateUpdate(g_click_latency_seq);
    return 0;
}

fn hostClickLatencyStampFlush(_: ?*lua.lua_State) callconv(.c) c_int {
    _ = g_click_latency.stampFlush(g_click_latency_seq);
    return 0;
}

fn hostClickLatencyStampApplyDone(_: ?*lua.lua_State) callconv(.c) c_int {
    _ = g_click_latency.stampApplyDone(g_click_latency_seq);
    if (g_click_latency_dump_on_apply) {
        var stderr_buf: [4096]u8 = undefined;
        var stderr_file = std.fs.File.stderr();
        var stderr_writer = stderr_file.writer(&stderr_buf);
        g_click_latency.dumpRecent(&stderr_writer.interface, click_latency.default_capacity) catch |err| {
            std.log.warn("[click-latency] dump failed: {}", .{err});
        };
        g_click_latency_dump_on_apply = false;
    }
    g_click_latency_seq = 0;
    return 0;
}

fn hostClickLatencyDump(L: ?*lua.lua_State) callconv(.c) c_int {
    const last_n = if (lua.lua_gettop(L) >= 1 and lua.lua_isnumber(L, 1) != 0)
        @as(usize, @intCast(@max(0, lua.lua_tointeger(L, 1))))
    else
        click_latency.default_capacity;
    var stderr_buf: [4096]u8 = undefined;
    var stderr_file = std.fs.File.stderr();
    var stderr_writer = stderr_file.writer(&stderr_buf);
    g_click_latency.dumpRecent(&stderr_writer.interface, last_n) catch |err| {
        std.log.warn("[click-latency] dump failed: {}", .{err});
    };
    return 0;
}

// ── JSRT host-op tree ---------------------------------------------------

var jsrt_node_arena: std.heap.ArenaAllocator = std.heap.ArenaAllocator.init(std.heap.page_allocator);
var jsrt_nodes_by_id: std.ArrayList(?*Node) = undefined;
var jsrt_ptr_to_id: std.AutoHashMap(usize, u32) = undefined;
var jsrt_tree_inited: bool = false;
var jsrt_next_id: u32 = 1;
var jsrt_root: Node = .{};

fn jsrtNodeAllocator() std.mem.Allocator {
    return jsrt_node_arena.allocator();
}

fn jsrtInitTree() void {
    if (jsrt_tree_inited) return;
    jsrt_nodes_by_id = .{};
    jsrt_ptr_to_id = std.AutoHashMap(usize, u32).init(std.heap.page_allocator);
    jsrt_tree_inited = true;
    jsrtResetTree();
}

fn jsrtResetTree() void {
    if (!jsrt_tree_inited) return;
    jsrt_root = .{};
    jsrt_root.children = &.{};
    jsrt_next_id = 1;
    _ = jsrt_node_arena.reset(.retain_capacity);
    jsrt_ptr_to_id.clearRetainingCapacity();
    jsrt_nodes_by_id.clearRetainingCapacity();
    jsrt_nodes_by_id.append(std.heap.page_allocator, null) catch @panic("[luajit-runtime] JSRT node registry allocation failed");
}

fn jsrtDeinitTree() void {
    if (!jsrt_tree_inited) return;
    jsrt_nodes_by_id.deinit(std.heap.page_allocator);
    jsrt_ptr_to_id.deinit();
    jsrt_node_arena.deinit();
    jsrt_tree_inited = false;
}

fn jsrtEnsureSlot(id: u32) void {
    while (jsrt_nodes_by_id.items.len <= id) {
        jsrt_nodes_by_id.append(std.heap.page_allocator, null) catch @panic("[luajit-runtime] JSRT node registry allocation failed");
    }
}

fn jsrtRegisterNode(id: u32, ptr: *Node) void {
    jsrtEnsureSlot(id);
    jsrt_nodes_by_id.items[id] = ptr;
    jsrt_ptr_to_id.put(@intFromPtr(ptr), id) catch @panic("[luajit-runtime] JSRT node pointer registry allocation failed");
}

fn jsrtNodeForId(id: u32) ?*Node {
    if (id == 0 or id >= jsrt_nodes_by_id.items.len) return null;
    return jsrt_nodes_by_id.items[id];
}

fn jsrtIdForPtr(ptr: *const Node) ?u32 {
    return jsrt_ptr_to_id.get(@intFromPtr(ptr));
}

fn jsrtCopyChildren(parent: *Node, old_children: []const Node, new_ptrs: []const *Node) bool {
    const alloc = jsrtNodeAllocator();
    if (new_ptrs.len > 0) {
        const ids = alloc.alloc(u32, new_ptrs.len) catch return false;
        for (new_ptrs, 0..) |src_ptr, i| {
            ids[i] = jsrtIdForPtr(src_ptr) orelse return false;
        }
        for (old_children, 0..) |_, i| {
            const old_ptr = &old_children[i];
            if (jsrtIdForPtr(old_ptr)) |id| {
                jsrtEnsureSlot(id);
                jsrt_nodes_by_id.items[id] = null;
                _ = jsrt_ptr_to_id.remove(@intFromPtr(old_ptr));
            }
        }

        const new_children = alloc.alloc(Node, new_ptrs.len) catch return false;
        for (new_ptrs, 0..) |src_ptr, i| {
            new_children[i] = src_ptr.*;
        }
        for (new_ptrs, 0..) |_, i| {
            const id = ids[i];
            jsrtEnsureSlot(id);
            jsrt_nodes_by_id.items[id] = &new_children[i];
            jsrt_ptr_to_id.put(@intFromPtr(&new_children[i]), id) catch return false;
        }
        parent.children = new_children;
        return true;
    }

    for (old_children, 0..) |_, i| {
        const old_ptr = &old_children[i];
        if (jsrtIdForPtr(old_ptr)) |id| {
            jsrtEnsureSlot(id);
            jsrt_nodes_by_id.items[id] = null;
            _ = jsrt_ptr_to_id.remove(@intFromPtr(old_ptr));
        }
    }
    parent.children = &.{};
    return true;
}

fn jsrtAppendChild(parent: *Node, child: *Node) bool {
    const old_children = parent.children;
    var ptrs: std.ArrayList(*Node) = .{};
    defer ptrs.deinit(std.heap.page_allocator);
    for (old_children, 0..) |_, i| {
        ptrs.append(std.heap.page_allocator, &old_children[i]) catch return false;
    }
    ptrs.append(std.heap.page_allocator, child) catch return false;
    return jsrtCopyChildren(parent, old_children, ptrs.items);
}

fn jsrtInheritTypography(parent: *Node, child: *Node) void {
    if (child.text == null) return;
    child.font_size = parent.font_size;
    child.font_weight = parent.font_weight;
    if (parent.text_color) |c| child.text_color = c;
    child.letter_spacing = parent.letter_spacing;
    if (parent.line_height > 0) child.line_height = parent.line_height;
}

fn jsrtInsertChildBefore(parent: *Node, child: *Node, before: *Node) bool {
    const old_children = parent.children;
    var ptrs: std.ArrayList(*Node) = .{};
    defer ptrs.deinit(std.heap.page_allocator);
    var inserted = false;
    for (old_children, 0..) |_, i| {
        const src = &old_children[i];
        if (!inserted and jsrtIdForPtr(src) == jsrtIdForPtr(before)) {
            ptrs.append(std.heap.page_allocator, child) catch return false;
            inserted = true;
        }
        ptrs.append(std.heap.page_allocator, src) catch return false;
    }
    if (!inserted) ptrs.append(std.heap.page_allocator, child) catch return false;
    return jsrtCopyChildren(parent, old_children, ptrs.items);
}

fn jsrtRemoveChild(parent: *Node, child: *Node) bool {
    const old_children = parent.children;
    var ptrs: std.ArrayList(*Node) = .{};
    defer ptrs.deinit(std.heap.page_allocator);
    const remove_id = jsrtIdForPtr(child) orelse return false;
    var removed = false;
    for (old_children, 0..) |_, i| {
        const src = &old_children[i];
        if (!removed) {
            if (jsrtIdForPtr(src)) |id| {
                if (id == remove_id) {
                    removed = true;
                    continue;
                }
            }
        }
        ptrs.append(std.heap.page_allocator, src) catch return false;
    }
    if (!removed) return false;
    return jsrtCopyChildren(parent, old_children, ptrs.items);
}

fn jsrtDupLuaString(L: ?*lua.lua_State, idx: c_int, alloc: std.mem.Allocator) ?[]const u8 {
    var len: usize = 0;
    const ptr = lua.lua_tolstring(L, idx, &len);
    if (ptr == null) return null;
    const copy = alloc.alloc(u8, len) catch return null;
    @memcpy(copy, @as([*]const u8, @ptrCast(ptr))[0..len]);
    return copy;
}

fn jsrtSetNodeText(node: *Node, text: []const u8) void {
    if (node.children.len > 0) {
        node.children[0].text = text;
    } else {
        node.text = text;
    }
}

fn jsrtApplyUpdatePatch(L: ?*lua.lua_State, idx: c_int, node: *Node) void {
    if (!lua.lua_istable(L, idx)) return;

    lua.lua_getfield(L, idx, "style");
    if (lua.lua_istable(L, -1)) {
        node.style = readLuaStyle(L, -1);
        applyLuaTextProps(node, L, -1, jsrtNodeAllocator());
    }
    lua.lua_pop(L, 1);

    lua.lua_getfield(L, idx, "text");
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null) {
            jsrtSetNodeText(node, @as([*]const u8, @ptrCast(ptr))[0..len]);
        }
    }
    lua.lua_pop(L, 1);

    applyLuaTextProps(node, L, idx, jsrtNodeAllocator());
    lua.lua_getfield(L, idx, "hoverable");
    if (lua.lua_isboolean(L, -1)) {
        node.hoverable = lua.lua_toboolean(L, -1) != 0;
    }
    lua.lua_pop(L, 1);
    node.scroll_x = readLuaFloat2(L, idx, "scroll_x", "scrollX", node.scroll_x);
    node.scroll_y = readLuaFloat2(L, idx, "scroll_y", "scrollY", node.scroll_y);
    if (readLuaOptFloat2(L, idx, "scroll_persist_slot", "scrollPersistSlot")) |v| node.scroll_persist_slot = @intFromFloat(v);
    node.show_scrollbar = readLuaBool2(L, idx, "show_scrollbar", "showScrollbar");
    node.scrollbar_side = readLuaScrollbarSide(L, idx, "scrollbar_side", "scrollbarSide", node.scrollbar_side);
    node.scrollbar_auto_hide = readLuaBool2(L, idx, "scrollbar_auto_hide", "autoHide");
    node.content_height = readLuaFloat(L, idx, "content_height", node.content_height);
    node.content_width = readLuaFloat(L, idx, "content_width", node.content_width);
    luaGetFieldAlias2(L, idx, "window_drag", "windowDrag");
    if (lua.lua_isboolean(L, -1)) {
        node.window_drag = lua.lua_toboolean(L, -1) != 0;
    }
    lua.lua_pop(L, 1);
    luaGetFieldAlias2(L, idx, "window_resize", "windowResize");
    if (lua.lua_isboolean(L, -1)) {
        node.window_resize = lua.lua_toboolean(L, -1) != 0;
    }
    lua.lua_pop(L, 1);
}

fn hostCreate(L: ?*lua.lua_State) callconv(.c) c_int {
    hostTrace("__hostCreate");
    const alloc = jsrtNodeAllocator();
    const argc = lua.lua_gettop(L);
    var id: u32 = jsrt_next_id;
    var type_idx: c_int = 1;
    var props_idx: c_int = 2;

    if (argc >= 3 and lua.lua_isnumber(L, 1) != 0) {
        id = @intCast(@as(i64, @intFromFloat(lua.lua_tonumber(L, 1))));
        type_idx = 2;
        props_idx = 3;
        if (id >= jsrt_next_id) {
            jsrt_next_id = id + 1;
        }
    } else {
        jsrt_next_id += 1;
    }

    var node = stampLuaNode(L, props_idx, alloc);
    node.id = id;
    if (argc >= props_idx + 1 and lua.lua_istable(L, props_idx + 1)) {
        jsrtApplyHandlerNames(&node, alloc, id, L, props_idx + 1);
    }
    if (node.debug_name == null and lua.lua_isstring(L, type_idx) != 0) {
        if (jsrtDupLuaString(L, type_idx, alloc)) |type_name| {
            node.debug_name = type_name;
        }
    }
    const stored = alloc.create(Node) catch return 0;
    stored.* = node;
    jsrtRegisterNode(id, stored);
    lua.lua_pushinteger(L, @intCast(id));
    return 1;
}

fn hostCreateText(L: ?*lua.lua_State) callconv(.c) c_int {
    hostTrace("__hostCreateText");
    const alloc = jsrtNodeAllocator();
    const argc = lua.lua_gettop(L);
    var id: u32 = jsrt_next_id;
    var text_idx: c_int = 1;
    if (argc >= 2 and lua.lua_isnumber(L, 1) != 0) {
        id = @intCast(@as(i64, @intFromFloat(lua.lua_tonumber(L, 1))));
        text_idx = 2;
        if (id >= jsrt_next_id) {
            jsrt_next_id = id + 1;
        }
    } else {
        jsrt_next_id += 1;
    }

    const stored = alloc.create(Node) catch return 0;
    stored.* = .{};
    stored.id = id;
    if (jsrtDupLuaString(L, text_idx, alloc)) |text| {
        stored.text = text;
    }
    jsrtRegisterNode(id, stored);
    lua.lua_pushinteger(L, @intCast(id));
    return 1;
}

fn hostAppend(L: ?*lua.lua_State) callconv(.c) c_int {
    hostTrace("__hostAppend");
    const parent_id = @as(u32, @intCast(lua.lua_tointeger(L, 1)));
    const child_id = @as(u32, @intCast(lua.lua_tointeger(L, 2)));
    const parent = jsrtNodeForId(parent_id) orelse return 0;
    const child = jsrtNodeForId(child_id) orelse return 0;
    jsrtInheritTypography(parent, child);
    return if (jsrtAppendChild(parent, child)) 0 else 0;
}

fn hostAppendToRoot(L: ?*lua.lua_State) callconv(.c) c_int {
    hostTrace("__hostAppendToRoot");
    const child_id = @as(u32, @intCast(lua.lua_tointeger(L, 1)));
    const child = jsrtNodeForId(child_id) orelse return 0;
    return if (jsrtAppendChild(&jsrt_root, child)) 0 else 0;
}

fn hostUpdateText(L: ?*lua.lua_State) callconv(.c) c_int {
    hostTrace("__hostUpdateText");
    const id = @as(u32, @intCast(lua.lua_tointeger(L, 1)));
    const node = jsrtNodeForId(id) orelse return 0;
    if (jsrtDupLuaString(L, 2, jsrtNodeAllocator())) |text| {
        jsrtSetNodeText(node, text);
    }
    return 0;
}

fn hostUpdate(L: ?*lua.lua_State) callconv(.c) c_int {
    hostTrace("__hostUpdate");
    const id = @as(u32, @intCast(lua.lua_tointeger(L, 1)));
    const node = jsrtNodeForId(id) orelse return 0;
    jsrtApplyUpdatePatch(L, 2, node);
    if (lua.lua_gettop(L) >= 3 and lua.lua_istable(L, 3)) {
        jsrtApplyHandlerNames(node, jsrtNodeAllocator(), id, L, 3);
    }
    return 0;
}

fn hostRemove(L: ?*lua.lua_State) callconv(.c) c_int {
    hostTrace("__hostRemove");
    const parent_id = @as(u32, @intCast(lua.lua_tointeger(L, 1)));
    const child_id = @as(u32, @intCast(lua.lua_tointeger(L, 2)));
    const parent = jsrtNodeForId(parent_id) orelse return 0;
    const child = jsrtNodeForId(child_id) orelse return 0;
    return if (jsrtRemoveChild(parent, child)) 0 else 0;
}

fn hostRemoveFromRoot(L: ?*lua.lua_State) callconv(.c) c_int {
    hostTrace("__hostRemoveFromRoot");
    const child_id = @as(u32, @intCast(lua.lua_tointeger(L, 1)));
    const child = jsrtNodeForId(child_id) orelse return 0;
    return if (jsrtRemoveChild(&jsrt_root, child)) 0 else 0;
}

fn hostInsertBefore(L: ?*lua.lua_State) callconv(.c) c_int {
    hostTrace("__hostInsertBefore");
    const parent_id = @as(u32, @intCast(lua.lua_tointeger(L, 1)));
    const child_id = @as(u32, @intCast(lua.lua_tointeger(L, 2)));
    const before_id = @as(u32, @intCast(lua.lua_tointeger(L, 3)));
    const parent = jsrtNodeForId(parent_id) orelse return 0;
    const child = jsrtNodeForId(child_id) orelse return 0;
    const before = jsrtNodeForId(before_id) orelse return 0;
    jsrtInheritTypography(parent, child);
    const old_children = parent.children;
    var ptrs: std.ArrayList(*Node) = .{};
    defer ptrs.deinit(std.heap.page_allocator);
    var inserted = false;
    for (old_children, 0..) |_, i| {
        const src = &old_children[i];
        if (!inserted and jsrtIdForPtr(src) != null and jsrtIdForPtr(src).? == before_id) {
            ptrs.append(std.heap.page_allocator, child) catch return 0;
            inserted = true;
        }
        ptrs.append(std.heap.page_allocator, src) catch return 0;
    }
    if (!inserted) ptrs.append(std.heap.page_allocator, child) catch return 0;
    _ = before;
    return if (jsrtCopyChildren(parent, old_children, ptrs.items)) 0 else 0;
}

fn hostInsertBeforeRoot(L: ?*lua.lua_State) callconv(.c) c_int {
    hostTrace("__hostInsertBeforeRoot");
    const child_id = @as(u32, @intCast(lua.lua_tointeger(L, 1)));
    const before_id = @as(u32, @intCast(lua.lua_tointeger(L, 2)));
    const child = jsrtNodeForId(child_id) orelse return 0;
    const before = jsrtNodeForId(before_id) orelse return 0;
    const old_children = jsrt_root.children;
    var ptrs: std.ArrayList(*Node) = .{};
    defer ptrs.deinit(std.heap.page_allocator);
    var inserted = false;
    for (old_children, 0..) |_, i| {
        const src = &old_children[i];
        if (!inserted and jsrtIdForPtr(src) != null and jsrtIdForPtr(src).? == before_id) {
            ptrs.append(std.heap.page_allocator, child) catch return 0;
            inserted = true;
        }
        ptrs.append(std.heap.page_allocator, src) catch return 0;
    }
    if (!inserted) ptrs.append(std.heap.page_allocator, child) catch return 0;
    _ = before;
    return if (jsrtCopyChildren(&jsrt_root, old_children, ptrs.items)) 0 else 0;
}

fn hostFlush(_: ?*lua.lua_State) callconv(.c) c_int {
    hostTrace("__hostFlush");
    layout.markLayoutDirty();
    state.markDirty();
    return 0;
}

pub fn jsrtRoot() *Node {
    return &jsrt_root;
}

// ── Mouse host functions (state lives in mouse_state.zig) ──────────────

fn hostGetMouseX(L: ?*lua.lua_State) callconv(.c) c_int {
    lua.lua_pushnumber(L, mouse_state.g_mouse_x);
    return 1;
}

fn hostGetMouseY(L: ?*lua.lua_State) callconv(.c) c_int {
    lua.lua_pushnumber(L, mouse_state.g_mouse_y);
    return 1;
}

fn hostGetMouseDown(L: ?*lua.lua_State) callconv(.c) c_int {
    lua.lua_pushboolean(L, if (mouse_state.g_mouse_down) 1 else 0);
    return 1;
}

fn hostGetMouseRightDown(L: ?*lua.lua_State) callconv(.c) c_int {
    lua.lua_pushboolean(L, if (mouse_state.g_mouse_right_down) 1 else 0);
    return 1;
}

// ── Telemetry host functions ────────────────────────────────────────────

fn hostGetFps(L: ?*lua.lua_State) callconv(.c) c_int {
    lua.lua_pushnumber(L, @floatFromInt(telemetry_fps));
    return 1;
}

fn hostGetLayoutUs(L: ?*lua.lua_State) callconv(.c) c_int {
    lua.lua_pushnumber(L, @floatFromInt(telemetry_layout_us));
    return 1;
}

fn hostGetPaintUs(L: ?*lua.lua_State) callconv(.c) c_int {
    lua.lua_pushnumber(L, @floatFromInt(telemetry_paint_us));
    return 1;
}

fn hostGetTickUs(L: ?*lua.lua_State) callconv(.c) c_int {
    lua.lua_pushnumber(L, @floatFromInt(telemetry_tick_us));
    return 1;
}

fn hostGetNowMs(L: ?*lua.lua_State) callconv(.c) c_int {
    lua.lua_pushnumber(L, @as(f64, @floatFromInt(std.time.microTimestamp())) / 1000.0);
    return 1;
}

// ── AppleScript bridge (macOS only, no-op on Linux) ─────────────────────
const applescript = @import("applescript.zig");

fn hostApplescript(L: ?*lua.lua_State) callconv(.c) c_int {
    const script_ptr = lua.lua_tolstring(L, 1, null);
    if (script_ptr == null) {
        lua.lua_pushstring(L, "ERROR: missing script argument");
        return 1;
    }
    const script = std.mem.span(script_ptr.?);
    applescript.run(script, 0); // async, result delivered via pollResult
    lua.lua_pushstring(L, "Running...");
    return 1;
}

fn hostApplescriptFile(_: ?*lua.lua_State) callconv(.c) c_int {
    return 0;
}

// ── TSL stdlib (embedded) ───────────────────────────────────────────────

const TSL_STDLIB =
    \\-- tsl_stdlib: JS array/object/string methods for LuaJIT
    \\-- Auto-loaded by luajit_runtime. Used by compiler Lua output.
    \\__tsl = {}
    \\
    \\function __tsl.map(arr, fn)
    \\  local result = {}
    \\  for i = 1, #arr do result[i] = fn(arr[i], i, arr) end
    \\  return result
    \\end
    \\
    \\function __tsl.filter(arr, fn)
    \\  local result, j = {}, 1
    \\  for i = 1, #arr do
    \\    if fn(arr[i], i, arr) then result[j] = arr[i]; j = j + 1 end
    \\  end
    \\  return result
    \\end
    \\
    \\function __tsl.find(arr, fn)
    \\  for i = 1, #arr do if fn(arr[i], i, arr) then return arr[i] end end
    \\  return nil
    \\end
    \\
    \\function __tsl.forEach(arr, fn)
    \\  for i = 1, #arr do fn(arr[i], i, arr) end
    \\end
    \\
    \\function __tsl.indexOf(arr, value)
    \\  for i = 1, #arr do if arr[i] == value then return i end end
    \\  return -1
    \\end
    \\
    \\function __tsl.merge(...)
    \\  local result = {}
    \\  for i = 1, select("#", ...) do
    \\    local t = select(i, ...)
    \\    if t then for k, v in pairs(t) do result[k] = v end end
    \\  end
    \\  return result
    \\end
    \\
    \\function __tsl.push(arr, val)
    \\  arr[#arr+1] = val
    \\  return #arr
    \\end
    \\
    \\function __tsl.join(arr, sep)
    \\  return table.concat(arr, sep or ",")
    \\end
    \\
    \\function __tsl.slice(arr, from, to)
    \\  local result = {}
    \\  from = from or 1
    \\  to = to or #arr
    \\  for i = from, to do result[#result+1] = arr[i] end
    \\  return result
    \\end
    \\
    \\function __tsl.includes(arr, val)
    \\  for i = 1, #arr do if arr[i] == val then return true end end
    \\  return false
    \\end
    \\
    \\function __tsl.reduce(arr, fn, init)
    \\  local acc = init
    \\  local start = 1
    \\  if acc == nil then acc = arr[1]; start = 2 end
    \\  for i = start, #arr do acc = fn(acc, arr[i], i, arr) end
    \\  return acc
    \\end
    \\
    \\function __tsl.keys(obj)
    \\  local result = {}
    \\  for k in pairs(obj) do result[#result+1] = k end
    \\  return result
    \\end
    \\
    \\function __tsl.values(obj)
    \\  local result = {}
    \\  for _, v in pairs(obj) do result[#result+1] = v end
    \\  return result
    \\end
    \\
    \\-- String methods
    \\function __tsl.split(s, sep)
    \\  local result = {}
    \\  for part in s:gmatch("[^" .. (sep or ",") .. "]+") do
    \\    result[#result+1] = part
    \\  end
    \\  return result
    \\end
    \\
    \\function __tsl.trim(s) return s:match("^%s*(.-)%s*$") end
    \\function __tsl.startsWith(s, prefix) return s:sub(1, #prefix) == prefix end
    \\function __tsl.endsWith(s, suffix) return s:sub(-#suffix) == suffix end
    \\function __tsl.toUpperCase(s) return s:upper() end
    \\function __tsl.toLowerCase(s) return s:lower() end
    \\
    \\-- Map data is populated directly via pushJSValueToLua (zero-copy FFI).
    \\-- No JSON serialization needed. See qjs_runtime.zig:evalLuaMapData.
;

// ── Lua Map Node Stamping ───────────────────────────────────────────────
// LuaJIT-side .map() support. Lua iterates the array and builds a template
// table, then calls __declareChildren(wrapperPtr, tmpl) to stamp Zig Nodes.

var lua_node_arena: std.heap.ArenaAllocator = std.heap.ArenaAllocator.init(std.heap.page_allocator);

fn readLuaColor(L: ?*lua.lua_State, idx: c_int) ?Color {
    if (lua.lua_isnumber(L, idx) != 0) {
        const val: u32 = @intCast(@as(i64, @intFromFloat(lua.lua_tonumber(L, idx))));
        return Color.rgb(@intCast((val >> 16) & 0xFF), @intCast((val >> 8) & 0xFF), @intCast(val & 0xFF));
    }
    if (lua.lua_isstring(L, idx) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, idx, &len);
        if (ptr != null) {
            const s = @as([*]const u8, @ptrCast(ptr))[0..len];
            if (s.len >= 7 and s[0] == '#') {
                return Color.fromHex(s[0..7]);
            }
        }
    }
    return null;
}

fn readLuaGlyphColor(L: ?*lua.lua_State, idx: c_int) ?Color {
    if (lua.lua_isnumber(L, idx) != 0) {
        const val: u32 = @intCast(@as(i64, @intFromFloat(lua.lua_tonumber(L, idx))));
        return Color.rgba(@intCast((val >> 16) & 0xFF), @intCast((val >> 8) & 0xFF), @intCast(val & 0xFF), 255);
    }
    if (lua.lua_isstring(L, idx) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, idx, &len);
        if (ptr != null) {
            const s = @as([*]const u8, @ptrCast(ptr))[0..len];
            if (std.mem.eql(u8, s, "transparent")) {
                return Color.rgba(0, 0, 0, 0);
            }
            if (s.len >= 7 and s[0] == '#') {
                const rgb = Color.fromHex(s[0..7]);
                return Color.rgba(rgb.r, rgb.g, rgb.b, 255);
            }
        }
    }
    return null;
}

fn luaGetFieldAlias2(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias: [*:0]const u8) void {
    lua.lua_getfield(L, idx, primary);
    if (lua.lua_isnil(L, -1)) {
        lua.lua_pop(L, 1);
        lua.lua_getfield(L, idx, alias);
    }
}

fn luaGetFieldAlias3(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias_a: [*:0]const u8, alias_b: [*:0]const u8) void {
    lua.lua_getfield(L, idx, primary);
    if (lua.lua_isnil(L, -1)) {
        lua.lua_pop(L, 1);
        lua.lua_getfield(L, idx, alias_a);
        if (lua.lua_isnil(L, -1)) {
            lua.lua_pop(L, 1);
            lua.lua_getfield(L, idx, alias_b);
        }
    }
}

fn readLuaOptFloat(L: ?*lua.lua_State, idx: c_int, field: [*:0]const u8) ?f32 {
    lua.lua_getfield(L, idx, field);
    const result: ?f32 = if (lua.lua_isnumber(L, -1) != 0) @floatCast(lua.lua_tonumber(L, -1)) else null;
    lua.lua_pop(L, 1);
    return result;
}

fn readLuaOptFloat2(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias: [*:0]const u8) ?f32 {
    luaGetFieldAlias2(L, idx, primary, alias);
    const result: ?f32 = if (lua.lua_isnumber(L, -1) != 0) @floatCast(lua.lua_tonumber(L, -1)) else null;
    lua.lua_pop(L, 1);
    return result;
}

fn readLuaOptFloat3(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias_a: [*:0]const u8, alias_b: [*:0]const u8) ?f32 {
    luaGetFieldAlias3(L, idx, primary, alias_a, alias_b);
    const result: ?f32 = if (lua.lua_isnumber(L, -1) != 0) @floatCast(lua.lua_tonumber(L, -1)) else null;
    lua.lua_pop(L, 1);
    return result;
}

fn parsePctString(s: []const u8) ?f32 {
    const trimmed = std.mem.trim(u8, s, " \t\r\n");
    if (trimmed.len == 0) return null;
    if (std.mem.endsWith(u8, trimmed, "%")) {
        const pct = std.fmt.parseFloat(f32, trimmed[0 .. trimmed.len - 1]) catch return null;
        return -(pct / 100.0);
    }
    return std.fmt.parseFloat(f32, trimmed) catch null;
}

fn readLuaMaybePct(L: ?*lua.lua_State, idx: c_int) ?f32 {
    if (lua.lua_isnumber(L, idx) != 0) {
        return @floatCast(lua.lua_tonumber(L, idx));
    }
    if (lua.lua_isstring(L, idx) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, idx, &len);
        if (ptr != null) {
            return parsePctString(@as([*]const u8, @ptrCast(ptr))[0..len]);
        }
    }
    return null;
}

fn readLuaOptMaybePct2(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias: [*:0]const u8) ?f32 {
    luaGetFieldAlias2(L, idx, primary, alias);
    const result = readLuaMaybePct(L, -1);
    lua.lua_pop(L, 1);
    return result;
}

fn readLuaFloat(L: ?*lua.lua_State, idx: c_int, field: [*:0]const u8, default: f32) f32 {
    return readLuaOptFloat(L, idx, field) orelse default;
}

fn readLuaFloat2(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias: [*:0]const u8, default: f32) f32 {
    return readLuaOptFloat2(L, idx, primary, alias) orelse default;
}

fn readLuaFloat3(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias_a: [*:0]const u8, alias_b: [*:0]const u8, default: f32) f32 {
    return readLuaOptFloat3(L, idx, primary, alias_a, alias_b) orelse default;
}

/// Read a margin field: number → pixel value, "auto" → inf (triggers auto-margin in layout)
fn readLuaMargin(L: ?*lua.lua_State, idx: c_int, field: [*:0]const u8) ?f32 {
    lua.lua_getfield(L, idx, field);
    if (lua.lua_isnumber(L, -1) != 0) {
        const v: f32 = @floatCast(lua.lua_tonumber(L, -1));
        lua.lua_pop(L, 1);
        return v;
    }
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null) {
            const s = @as([*]const u8, @ptrCast(ptr))[0..len];
            if (std.mem.eql(u8, s, "auto")) {
                lua.lua_pop(L, 1);
                return std.math.inf(f32);
            }
        }
    }
    lua.lua_pop(L, 1);
    return null;
}

fn readLuaMargin2(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias: [*:0]const u8) ?f32 {
    luaGetFieldAlias2(L, idx, primary, alias);
    if (lua.lua_isnumber(L, -1) != 0) {
        const v: f32 = @floatCast(lua.lua_tonumber(L, -1));
        lua.lua_pop(L, 1);
        return v;
    }
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null) {
            const s = @as([*]const u8, @ptrCast(ptr))[0..len];
            if (std.mem.eql(u8, s, "auto")) {
                lua.lua_pop(L, 1);
                return std.math.inf(f32);
            }
        }
    }
    lua.lua_pop(L, 1);
    return null;
}

fn readLuaBool(L: ?*lua.lua_State, idx: c_int, field: [*:0]const u8) bool {
    lua.lua_getfield(L, idx, field);
    const result = lua.lua_toboolean(L, -1) != 0;
    lua.lua_pop(L, 1);
    return result;
}

fn readLuaBool2(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias: [*:0]const u8) bool {
    luaGetFieldAlias2(L, idx, primary, alias);
    const result = lua.lua_toboolean(L, -1) != 0;
    lua.lua_pop(L, 1);
    return result;
}

fn readLuaBool3(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias_a: [*:0]const u8, alias_b: [*:0]const u8) bool {
    luaGetFieldAlias3(L, idx, primary, alias_a, alias_b);
    const result = lua.lua_toboolean(L, -1) != 0;
    lua.lua_pop(L, 1);
    return result;
}

fn readLuaScrollbarSide(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias: [*:0]const u8, default: layout.ScrollbarSide) layout.ScrollbarSide {
    luaGetFieldAlias2(L, idx, primary, alias);
    var side = default;
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null) {
            const s = @as([*]const u8, @ptrCast(ptr))[0..len];
            if (std.mem.eql(u8, s, "left") or std.mem.eql(u8, s, "start")) {
                side = .left;
            } else if (std.mem.eql(u8, s, "right") or std.mem.eql(u8, s, "end")) {
                side = .right;
            } else if (std.mem.eql(u8, s, "top")) {
                side = .top;
            } else if (std.mem.eql(u8, s, "bottom")) {
                side = .bottom;
            } else if (std.mem.eql(u8, s, "auto")) {
                side = .auto;
            }
        }
    }
    lua.lua_pop(L, 1);
    return side;
}

fn readLuaU8(L: ?*lua.lua_State, idx: c_int, field: [*:0]const u8, default: u8) u8 {
    lua.lua_getfield(L, idx, field);
    const result: u8 = if (lua.lua_isnumber(L, -1) != 0) @intCast(@as(i64, @intFromFloat(lua.lua_tonumber(L, -1)))) else default;
    lua.lua_pop(L, 1);
    return result;
}

fn readLuaU82(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias: [*:0]const u8, default: u8) u8 {
    luaGetFieldAlias2(L, idx, primary, alias);
    const result: u8 = if (lua.lua_isnumber(L, -1) != 0) @intCast(@as(i64, @intFromFloat(lua.lua_tonumber(L, -1)))) else default;
    lua.lua_pop(L, 1);
    return result;
}

fn readLuaOptString(L: ?*lua.lua_State, idx: c_int, field: [*:0]const u8, alloc: std.mem.Allocator) ?[]const u8 {
    lua.lua_getfield(L, idx, field);
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null and len > 0) {
            const copy = alloc.alloc(u8, len) catch {
                lua.lua_pop(L, 1);
                return null;
            };
            @memcpy(copy, @as([*]const u8, @ptrCast(ptr))[0..len]);
            lua.lua_pop(L, 1);
            return copy;
        }
    }
    lua.lua_pop(L, 1);
    return null;
}

fn readLuaOptString2(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias: [*:0]const u8, alloc: std.mem.Allocator) ?[]const u8 {
    luaGetFieldAlias2(L, idx, primary, alias);
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null and len > 0) {
            const copy = alloc.alloc(u8, len) catch {
                lua.lua_pop(L, 1);
                return null;
            };
            @memcpy(copy, @as([*]const u8, @ptrCast(ptr))[0..len]);
            lua.lua_pop(L, 1);
            return copy;
        }
    }
    lua.lua_pop(L, 1);
    return null;
}

fn readLuaOptString3(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias_a: [*:0]const u8, alias_b: [*:0]const u8, alloc: std.mem.Allocator) ?[]const u8 {
    luaGetFieldAlias3(L, idx, primary, alias_a, alias_b);
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null and len > 0) {
            const copy = alloc.alloc(u8, len) catch {
                lua.lua_pop(L, 1);
                return null;
            };
            @memcpy(copy, @as([*]const u8, @ptrCast(ptr))[0..len]);
            lua.lua_pop(L, 1);
            return copy;
        }
    }
    lua.lua_pop(L, 1);
    return null;
}

fn readLuaColorField2(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias: [*:0]const u8) ?Color {
    luaGetFieldAlias2(L, idx, primary, alias);
    const color = readLuaColor(L, -1);
    lua.lua_pop(L, 1);
    return color;
}

fn readLuaColorField3(L: ?*lua.lua_State, idx: c_int, primary: [*:0]const u8, alias_a: [*:0]const u8, alias_b: [*:0]const u8) ?Color {
    luaGetFieldAlias3(L, idx, primary, alias_a, alias_b);
    const color = readLuaColor(L, -1);
    lua.lua_pop(L, 1);
    return color;
}

fn applyLuaTextProps(node: *Node, L: ?*lua.lua_State, idx: c_int, alloc: std.mem.Allocator) void {
    if (readLuaOptFloat2(L, idx, "font_size", "fontSize")) |v| node.font_size = @intFromFloat(v);
    if (readLuaColorField3(L, idx, "text_color", "textColor", "color")) |c| node.text_color = c;
    if (readLuaOptFloat2(L, idx, "letter_spacing", "letterSpacing")) |v| node.letter_spacing = v;
    if (readLuaOptFloat2(L, idx, "line_height", "lineHeight")) |v| node.line_height = v;
    if (readLuaOptFloat2(L, idx, "number_of_lines", "numberOfLines")) |v| node.number_of_lines = @intFromFloat(v);
    luaGetFieldAlias2(L, idx, "no_wrap", "noWrap");
    if (lua.lua_isboolean(L, -1)) {
        node.no_wrap = lua.lua_toboolean(L, -1) != 0;
    }
    lua.lua_pop(L, 1);

    node.placeholder = readLuaOptString2(L, idx, "placeholder", "placeholder", alloc) orelse node.placeholder;
    node.debug_name = readLuaOptString2(L, idx, "debug_name", "debugName", alloc) orelse node.debug_name;
    node.test_id = readLuaOptString3(L, idx, "test_id", "testId", "testID", alloc) orelse node.test_id;
    node.tooltip = readLuaOptString2(L, idx, "tooltip", "tooltip", alloc) orelse node.tooltip;
    node.href = readLuaOptString2(L, idx, "href", "href", alloc) orelse node.href;
}

fn readLuaInlineGlyphs(L: ?*lua.lua_State, idx: c_int, alloc: std.mem.Allocator) ?[]layout.InlineGlyph {
    lua.lua_getfield(L, idx, "inline_glyphs");
    if (!lua.lua_istable(L, -1)) {
        lua.lua_pop(L, 1);
        return null;
    }

    const count: usize = @intCast(lua.lua_objlen(L, -1));
    if (count == 0) {
        lua.lua_pop(L, 1);
        return null;
    }

    const glyphs = alloc.alloc(layout.InlineGlyph, count) catch {
        lua.lua_pop(L, 1);
        return null;
    };

    for (0..count) |i| {
        glyphs[i] = layout.InlineGlyph{ .d = "" };
        lua.lua_rawgeti(L, -1, @intCast(i + 1));
        if (lua.lua_istable(L, -1)) {
            glyphs[i].d = readLuaOptString(L, -1, "d", alloc) orelse "";
            lua.lua_getfield(L, -1, "fill");
            glyphs[i].fill = readLuaGlyphColor(L, -1) orelse Color.rgba(0, 0, 0, 0);
            lua.lua_pop(L, 1);
            glyphs[i].fill_effect = readLuaOptString(L, -1, "fill_effect", alloc);
            lua.lua_getfield(L, -1, "stroke");
            glyphs[i].stroke = readLuaGlyphColor(L, -1) orelse Color.rgba(0, 0, 0, 0);
            lua.lua_pop(L, 1);
            glyphs[i].stroke_width = readLuaFloat(L, -1, "stroke_width", 0);
            glyphs[i].scale = readLuaFloat(L, -1, "scale", 1.0);
        }
        lua.lua_pop(L, 1);
    }

    lua.lua_pop(L, 1);
    return glyphs;
}

fn readLuaStyle(L: ?*lua.lua_State, idx: c_int) Style {
    var s = Style{};
    if (!lua.lua_istable(L, idx)) return s;
    if (readLuaOptFloat2(L, idx, "flex_grow", "flexGrow")) |v| s.flex_grow = v;
    if (readLuaOptFloat2(L, idx, "flex_shrink", "flexShrink")) |v| s.flex_shrink = v;
    if (readLuaOptFloat(L, idx, "gap")) |v| s.gap = v;
    if (readLuaOptFloat2(L, idx, "row_gap", "rowGap")) |v| s.row_gap = v;
    if (readLuaOptFloat2(L, idx, "column_gap", "columnGap")) |v| s.column_gap = v;
    if (readLuaOptMaybePct2(L, idx, "width", "width")) |v| s.width = v;
    if (readLuaOptMaybePct2(L, idx, "height", "height")) |v| s.height = v;
    if (readLuaOptFloat(L, idx, "padding")) |v| {
        s.padding_top = v;
        s.padding_bottom = v;
        s.padding_left = v;
        s.padding_right = v;
    }
    if (readLuaOptFloat2(L, idx, "padding_top", "paddingTop")) |v| s.padding_top = v;
    if (readLuaOptFloat2(L, idx, "padding_bottom", "paddingBottom")) |v| s.padding_bottom = v;
    if (readLuaOptFloat2(L, idx, "padding_left", "paddingLeft")) |v| s.padding_left = v;
    if (readLuaOptFloat2(L, idx, "padding_right", "paddingRight")) |v| s.padding_right = v;
    if (readLuaMargin2(L, idx, "margin", "margin")) |v| s.margin = v;
    if (readLuaMargin2(L, idx, "margin_top", "marginTop")) |v| s.margin_top = v;
    if (readLuaMargin2(L, idx, "margin_bottom", "marginBottom")) |v| s.margin_bottom = v;
    if (readLuaMargin2(L, idx, "margin_left", "marginLeft")) |v| s.margin_left = v;
    if (readLuaMargin2(L, idx, "margin_right", "marginRight")) |v| s.margin_right = v;
    if (readLuaOptFloat2(L, idx, "border_radius", "borderRadius")) |v| s.border_radius = v;
    if (readLuaOptFloat(L, idx, "border_width")) |v| s.border_width = v;
    // justify_content: check string
    luaGetFieldAlias2(L, idx, "justify_content", "justifyContent");
    if (lua.lua_isstring(L, -1) != 0) {
        var jlen: usize = 0;
        const jptr = lua.lua_tolstring(L, -1, &jlen);
        if (jptr != null) {
            const jc: []const u8 = @as([*]const u8, @ptrCast(jptr))[0..jlen];
            if (std.mem.eql(u8, jc, "center")) {
                s.justify_content = .center;
            } else if (std.mem.eql(u8, jc, "spaceBetween") or std.mem.eql(u8, jc, "space_between") or std.mem.eql(u8, jc, "space-between")) {
                s.justify_content = .space_between;
            } else if (std.mem.eql(u8, jc, "spaceAround") or std.mem.eql(u8, jc, "space_around") or std.mem.eql(u8, jc, "space-around")) {
                s.justify_content = .space_around;
            } else if (std.mem.eql(u8, jc, "spaceEvenly") or std.mem.eql(u8, jc, "space_evenly") or std.mem.eql(u8, jc, "space-evenly")) {
                s.justify_content = .space_evenly;
            } else if (std.mem.eql(u8, jc, "end") or std.mem.eql(u8, jc, "flex_end") or std.mem.eql(u8, jc, "flex-end")) {
                s.justify_content = .end;
            } else if (std.mem.eql(u8, jc, "start") or std.mem.eql(u8, jc, "flex_start") or std.mem.eql(u8, jc, "flex-start")) {
                s.justify_content = .start;
            }
        }
    }
    lua.lua_pop(L, 1);
    // flex_direction: check string
    luaGetFieldAlias2(L, idx, "flex_direction", "flexDirection");
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null) {
            const dir: []const u8 = @as([*]const u8, @ptrCast(ptr))[0..len];
            if (std.mem.eql(u8, dir, "row")) s.flex_direction = .row else if (std.mem.eql(u8, dir, "row_reverse") or std.mem.eql(u8, dir, "row-reverse")) s.flex_direction = .row_reverse else if (std.mem.eql(u8, dir, "column_reverse") or std.mem.eql(u8, dir, "column-reverse")) s.flex_direction = .column_reverse;
        }
    }
    lua.lua_pop(L, 1);
    s.background_color = readLuaColorField2(L, idx, "background_color", "backgroundColor");
    if (readLuaColorField2(L, idx, "border_color", "borderColor")) |c| s.border_color = c;
    // align_items
    luaGetFieldAlias2(L, idx, "align_items", "alignItems");
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null) {
            const v: []const u8 = @as([*]const u8, @ptrCast(ptr))[0..len];
            if (std.mem.eql(u8, v, "center")) s.align_items = .center else if (std.mem.eql(u8, v, "flexStart") or std.mem.eql(u8, v, "start") or std.mem.eql(u8, v, "flex_start") or std.mem.eql(u8, v, "flex-start")) s.align_items = .start else if (std.mem.eql(u8, v, "flexEnd") or std.mem.eql(u8, v, "end") or std.mem.eql(u8, v, "flex_end") or std.mem.eql(u8, v, "flex-end")) s.align_items = .end else if (std.mem.eql(u8, v, "stretch")) s.align_items = .stretch;
        }
    }
    lua.lua_pop(L, 1);
    // align_self
    luaGetFieldAlias2(L, idx, "align_self", "alignSelf");
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null) {
            const v: []const u8 = @as([*]const u8, @ptrCast(ptr))[0..len];
            if (std.mem.eql(u8, v, "center")) s.align_self = .center else if (std.mem.eql(u8, v, "flexStart") or std.mem.eql(u8, v, "start") or std.mem.eql(u8, v, "flex_start") or std.mem.eql(u8, v, "flex-start")) s.align_self = .start else if (std.mem.eql(u8, v, "flexEnd") or std.mem.eql(u8, v, "end") or std.mem.eql(u8, v, "flex_end") or std.mem.eql(u8, v, "flex-end")) s.align_self = .end else if (std.mem.eql(u8, v, "stretch")) s.align_self = .stretch;
        }
    }
    lua.lua_pop(L, 1);
    // flex_wrap
    luaGetFieldAlias2(L, idx, "flex_wrap", "flexWrap");
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null) {
            const wrap = @as([*]const u8, @ptrCast(ptr))[0..len];
            if (std.mem.eql(u8, wrap, "wrap")) s.flex_wrap = .wrap else if (std.mem.eql(u8, wrap, "wrap_reverse") or std.mem.eql(u8, wrap, "wrap-reverse")) s.flex_wrap = .wrap_reverse;
        }
    }
    lua.lua_pop(L, 1);
    if (readLuaOptMaybePct2(L, idx, "min_width", "minWidth")) |v| s.min_width = v;
    if (readLuaOptMaybePct2(L, idx, "min_height", "minHeight")) |v| s.min_height = v;
    if (readLuaOptMaybePct2(L, idx, "max_width", "maxWidth")) |v| s.max_width = v;
    if (readLuaOptMaybePct2(L, idx, "max_height", "maxHeight")) |v| s.max_height = v;
    // overflow
    lua.lua_getfield(L, idx, "overflow");
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null) {
            const v: []const u8 = @as([*]const u8, @ptrCast(ptr))[0..len];
            if (std.mem.eql(u8, v, "scroll")) s.overflow = .scroll else if (std.mem.eql(u8, v, "hidden")) s.overflow = .hidden else if (std.mem.eql(u8, v, "auto")) s.overflow = .auto;
        }
    }
    lua.lua_pop(L, 1);
    // display: "none"
    lua.lua_getfield(L, idx, "display");
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null and std.mem.eql(u8, @as([*]const u8, @ptrCast(ptr))[0..len], "none")) {
            s.display = .none;
        }
    }
    lua.lua_pop(L, 1);
    return s;
}

fn installCString(alloc: std.mem.Allocator, s: []const u8) ?[*:0]const u8 {
    if (s.len == 0) return null;
    const copy = alloc.alloc(u8, s.len + 1) catch return null;
    @memcpy(copy[0..s.len], s);
    copy[s.len] = 0;
    return @ptrCast(copy[0..s.len :0]);
}

fn jsrtHandlerNamesContainPress(L: ?*lua.lua_State, idx: c_int) bool {
    if (!lua.lua_istable(L, idx)) return false;
    const count: usize = @intCast(lua.lua_objlen(L, idx));
    var i: usize = 0;
    while (i < count) : (i += 1) {
        lua.lua_rawgeti(L, idx, @intCast(i + 1));
        if (lua.lua_isstring(L, -1) != 0) {
            var len: usize = 0;
            const ptr = lua.lua_tolstring(L, -1, &len);
            if (ptr != null) {
                const name = @as([*]const u8, @ptrCast(ptr))[0..len];
                if (std.mem.eql(u8, name, "onClick") or std.mem.eql(u8, name, "onPress") or std.mem.eql(u8, name, "onMiddleClick")) {
                    lua.lua_pop(L, 1);
                    return true;
                }
            }
        }
        lua.lua_pop(L, 1);
    }
    return false;
}

fn jsrtApplyHandlerNames(node: *Node, alloc: std.mem.Allocator, id: u32, L: ?*lua.lua_State, idx: c_int) void {
    node.handlers.js_on_press = null;
    node.handlers.js_on_middle_click = null;
    node.has_on_layout = false;
    if (!lua.lua_istable(L, idx)) return;
    const count: usize = @intCast(lua.lua_objlen(L, idx));
    var i: usize = 0;
    while (i < count) : (i += 1) {
        lua.lua_rawgeti(L, idx, @intCast(i + 1));
        if (lua.lua_isstring(L, -1) != 0) {
            var len: usize = 0;
            const ptr = lua.lua_tolstring(L, -1, &len);
            if (ptr != null) {
                const name = @as([*]const u8, @ptrCast(ptr))[0..len];
                if (std.mem.eql(u8, name, "onClick") or std.mem.eql(u8, name, "onPress")) {
                    const expr = std.fmt.allocPrint(alloc, "__dispatchEvent({d},'onClick')", .{id}) catch {
                        lua.lua_pop(L, 1);
                        return;
                    };
                    node.handlers.js_on_press = installCString(alloc, expr);
                } else if (std.mem.eql(u8, name, "onMiddleClick")) {
                    const expr = std.fmt.allocPrint(alloc, "__dispatchEvent({d},'onMiddleClick')", .{id}) catch {
                        lua.lua_pop(L, 1);
                        return;
                    };
                    node.handlers.js_on_middle_click = installCString(alloc, expr);
                } else if (std.mem.eql(u8, name, "onLayout")) {
                    // Flag-only: layout.setRect calls back into v8 directly with
                    // the rect at the moment it's set. No precomputed expression
                    // because the values vary per call.
                    node.has_on_layout = true;
                }
            }
        }
        lua.lua_pop(L, 1);
    }
}

fn stampLuaNode(L: ?*lua.lua_State, idx: c_int, alloc: std.mem.Allocator) Node {
    var node = Node{};
    if (!lua.lua_istable(L, idx)) return node;
    // text
    lua.lua_getfield(L, idx, "text");
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null) {
            const copy = alloc.alloc(u8, len) catch {
                lua.lua_pop(L, 1);
                return node;
            };
            @memcpy(copy, @as([*]const u8, @ptrCast(ptr))[0..len]);
            node.text = copy;
        }
    }
    lua.lua_pop(L, 1);
    applyLuaTextProps(&node, L, idx, alloc);
    // inline_glyphs
    node.inline_glyphs = readLuaInlineGlyphs(L, idx, alloc);
    // TextInput support: input_id + multiline from Lua tree
    lua.lua_getfield(L, idx, "input_id");
    if (lua.lua_isnumber(L, -1) != 0) {
        const iid: u8 = @intCast(@as(i64, @intFromFloat(lua.lua_tonumber(L, -1))));
        node.input_id = iid;
        // Check multiline flag and register accordingly
        lua.lua_pop(L, 1);
        lua.lua_getfield(L, idx, "multiline");
        if (lua.lua_toboolean(L, -1) != 0) {
            input_mod.registerMultiline(iid);
        } else {
            input_mod.register(iid);
        }
    }
    lua.lua_pop(L, 1);
    // Terminal support: terminal + terminal_id from Lua tree
    lua.lua_getfield(L, idx, "terminal");
    if (lua.lua_toboolean(L, -1) != 0) {
        node.terminal = true;
        lua.lua_pop(L, 1);
        lua.lua_getfield(L, idx, "terminal_id");
        if (lua.lua_isnumber(L, -1) != 0) {
            node.terminal_id = @intCast(@as(i64, @intFromFloat(lua.lua_tonumber(L, -1))));
        }
        lua.lua_pop(L, 1);
        luaGetFieldAlias2(L, idx, "terminal_font_size", "terminalFontSize");
        if (lua.lua_isnumber(L, -1) != 0) {
            node.terminal_font_size = @intCast(@as(i64, @intFromFloat(lua.lua_tonumber(L, -1))));
        }
    }
    lua.lua_pop(L, 1);
    // style
    lua.lua_getfield(L, idx, "style");
    if (lua.lua_istable(L, -1)) {
        node.style = readLuaStyle(L, -1);
        applyLuaTextProps(&node, L, -1, alloc);
    }
    lua.lua_pop(L, 1);
    // scroll_y / scroll_persist_slot — restored from global `_scrollY` in emitted Lua
    luaGetFieldAlias2(L, idx, "scroll_y", "scrollY");
    if (lua.lua_isnumber(L, -1) != 0) {
        node.scroll_y = @floatCast(lua.lua_tonumber(L, -1));
    }
    lua.lua_pop(L, 1);
    luaGetFieldAlias2(L, idx, "scroll_persist_slot", "scrollPersistSlot");
    if (lua.lua_isnumber(L, -1) != 0) {
        const si = lua.lua_tointeger(L, -1);
        if (si > 0) node.scroll_persist_slot = @intCast(si);
    }
    lua.lua_pop(L, 1);
    node.show_scrollbar = readLuaBool2(L, idx, "show_scrollbar", "showScrollbar");
    node.scrollbar_side = readLuaScrollbarSide(L, idx, "scrollbar_side", "scrollbarSide", node.scrollbar_side);
    node.scrollbar_auto_hide = readLuaBool2(L, idx, "scrollbar_auto_hide", "autoHide");
    // lua_on_press handler (string → null-terminated copy for Zig)
    lua.lua_getfield(L, idx, "lua_on_press");
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null and len > 0) {
            const copy = alloc.alloc(u8, len + 1) catch {
                lua.lua_pop(L, 1);
                return node;
            };
            @memcpy(copy[0..len], @as([*]const u8, @ptrCast(ptr))[0..len]);
            copy[len] = 0;
            node.handlers.lua_on_press = @ptrCast(copy[0..len :0]);
        }
    }
    lua.lua_pop(L, 1);
    // js_on_press handler (string → null-terminated copy for Zig)
    lua.lua_getfield(L, idx, "js_on_press");
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null and len > 0) {
            const copy = alloc.alloc(u8, len + 1) catch {
                lua.lua_pop(L, 1);
                return node;
            };
            @memcpy(copy[0..len], @as([*]const u8, @ptrCast(ptr))[0..len]);
            copy[len] = 0;
            node.handlers.js_on_press = @ptrCast(copy[0..len :0]);
        }
    }
    lua.lua_pop(L, 1);
    // lua_on_hover_enter handler
    lua.lua_getfield(L, idx, "lua_on_hover_enter");
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null and len > 0) {
            const copy = alloc.alloc(u8, len + 1) catch {
                lua.lua_pop(L, 1);
                return node;
            };
            @memcpy(copy[0..len], @as([*]const u8, @ptrCast(ptr))[0..len]);
            copy[len] = 0;
            node.handlers.lua_on_hover_enter = @ptrCast(copy[0..len :0]);
        }
    }
    lua.lua_pop(L, 1);
    // js_on_hover_enter handler
    lua.lua_getfield(L, idx, "js_on_hover_enter");
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null and len > 0) {
            const copy = alloc.alloc(u8, len + 1) catch {
                lua.lua_pop(L, 1);
                return node;
            };
            @memcpy(copy[0..len], @as([*]const u8, @ptrCast(ptr))[0..len]);
            copy[len] = 0;
            node.handlers.js_on_hover_enter = @ptrCast(copy[0..len :0]);
        }
    }
    lua.lua_pop(L, 1);
    // lua_on_hover_exit handler
    lua.lua_getfield(L, idx, "lua_on_hover_exit");
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null and len > 0) {
            const copy = alloc.alloc(u8, len + 1) catch {
                lua.lua_pop(L, 1);
                return node;
            };
            @memcpy(copy[0..len], @as([*]const u8, @ptrCast(ptr))[0..len]);
            copy[len] = 0;
            node.handlers.lua_on_hover_exit = @ptrCast(copy[0..len :0]);
        }
    }
    lua.lua_pop(L, 1);
    // js_on_hover_exit handler
    lua.lua_getfield(L, idx, "js_on_hover_exit");
    if (lua.lua_isstring(L, -1) != 0) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, -1, &len);
        if (ptr != null and len > 0) {
            const copy = alloc.alloc(u8, len + 1) catch {
                lua.lua_pop(L, 1);
                return node;
            };
            @memcpy(copy[0..len], @as([*]const u8, @ptrCast(ptr))[0..len]);
            copy[len] = 0;
            node.handlers.js_on_hover_exit = @ptrCast(copy[0..len :0]);
        }
    }
    lua.lua_pop(L, 1);
    // test_id (for snapshot click discovery)
    node.test_id = readLuaOptString3(L, idx, "test_id", "testId", "testID", alloc);
    // ── Window chrome fields ──
    node.window_drag = readLuaBool2(L, idx, "window_drag", "windowDrag");
    node.window_resize = readLuaBool2(L, idx, "window_resize", "windowResize");
    // ── Canvas/Graph fields ──
    node.graph_container = readLuaBool(L, idx, "graph_container");
    node.canvas_type = readLuaOptString2(L, idx, "canvas_type", "canvasType", alloc);
    node.canvas_id = @intFromFloat(readLuaFloat(L, idx, "canvas_id", 0));
    node.canvas_clamp = readLuaBool(L, idx, "canvas_clamp");
    node.canvas_path = readLuaBool(L, idx, "canvas_path");
    node.canvas_node = readLuaBool(L, idx, "canvas_node");
    node.canvas_path_d = readLuaOptString2(L, idx, "canvas_path_d", "canvasPathD", alloc);
    node.canvas_fill_effect = readLuaOptString(L, idx, "canvas_fill_effect", alloc);
    node.canvas_stroke_width = readLuaFloat(L, idx, "canvas_stroke_width", 2);
    node.canvas_flow_speed = readLuaFloat(L, idx, "canvas_flow_speed", 0);
    node.canvas_view_x = readLuaFloat(L, idx, "canvas_view_x", 0);
    node.canvas_view_y = readLuaFloat(L, idx, "canvas_view_y", 0);
    if (readLuaOptFloat(L, idx, "canvas_view_zoom")) |vz| {
        node.canvas_view_zoom = vz;
        node.canvas_view_set = true;
    }
    node.canvas_view_set = node.canvas_view_set or readLuaBool(L, idx, "canvas_view_set");
    node.canvas_gx = readLuaFloat(L, idx, "canvas_gx", 0);
    node.canvas_gy = readLuaFloat(L, idx, "canvas_gy", 0);
    node.canvas_gw = readLuaFloat(L, idx, "canvas_gw", 0);
    node.canvas_gh = readLuaFloat(L, idx, "canvas_gh", 0);
    node.canvas_drift_x = readLuaFloat(L, idx, "canvas_drift_x", 0);
    node.canvas_drift_y = readLuaFloat(L, idx, "canvas_drift_y", 0);
    lua.lua_getfield(L, idx, "canvas_fill_color");
    node.canvas_fill_color = readLuaColor(L, -1);
    lua.lua_pop(L, 1);
    // ── 3D fields ──
    node.scene3d = readLuaBool(L, idx, "scene3d");
    node.scene3d_mesh = readLuaBool(L, idx, "scene3d_mesh");
    node.scene3d_camera = readLuaBool(L, idx, "scene3d_camera");
    node.scene3d_light = readLuaBool(L, idx, "scene3d_light");
    node.scene3d_group = readLuaBool(L, idx, "scene3d_group");
    node.scene3d_geometry = readLuaOptString(L, idx, "scene3d_geometry", alloc);
    node.scene3d_light_type = readLuaOptString(L, idx, "scene3d_light_type", alloc);
    node.scene3d_color_r = readLuaFloat(L, idx, "scene3d_color_r", 0.8);
    node.scene3d_color_g = readLuaFloat(L, idx, "scene3d_color_g", 0.8);
    node.scene3d_color_b = readLuaFloat(L, idx, "scene3d_color_b", 0.8);
    node.scene3d_pos_x = readLuaFloat(L, idx, "scene3d_pos_x", 0);
    node.scene3d_pos_y = readLuaFloat(L, idx, "scene3d_pos_y", 0);
    node.scene3d_pos_z = readLuaFloat(L, idx, "scene3d_pos_z", 0);
    node.scene3d_rot_x = readLuaFloat(L, idx, "scene3d_rot_x", 0);
    node.scene3d_rot_y = readLuaFloat(L, idx, "scene3d_rot_y", 0);
    node.scene3d_rot_z = readLuaFloat(L, idx, "scene3d_rot_z", 0);
    node.scene3d_scale_x = readLuaFloat(L, idx, "scene3d_scale_x", 1);
    node.scene3d_scale_y = readLuaFloat(L, idx, "scene3d_scale_y", 1);
    node.scene3d_scale_z = readLuaFloat(L, idx, "scene3d_scale_z", 1);
    node.scene3d_look_x = readLuaFloat(L, idx, "scene3d_look_x", 0);
    node.scene3d_look_y = readLuaFloat(L, idx, "scene3d_look_y", 0);
    node.scene3d_look_z = readLuaFloat(L, idx, "scene3d_look_z", 0);
    node.scene3d_dir_x = readLuaFloat(L, idx, "scene3d_dir_x", 0);
    node.scene3d_dir_y = readLuaFloat(L, idx, "scene3d_dir_y", -1);
    node.scene3d_dir_z = readLuaFloat(L, idx, "scene3d_dir_z", 0);
    node.scene3d_fov = readLuaFloat(L, idx, "scene3d_fov", 60);
    node.scene3d_intensity = readLuaFloat(L, idx, "scene3d_intensity", 1.0);
    node.scene3d_radius = readLuaFloat(L, idx, "scene3d_radius", 0.5);
    node.scene3d_size_x = readLuaFloat(L, idx, "scene3d_size_x", 1);
    node.scene3d_size_y = readLuaFloat(L, idx, "scene3d_size_y", 1);
    node.scene3d_size_z = readLuaFloat(L, idx, "scene3d_size_z", 1);
    // ── Effect fields ──
    if (readLuaOptFloat(L, idx, "effect_id")) |eid_f| {
        const eid: usize = @intFromFloat(eid_f);
        if (eid < MAX_EFFECTS) {
            node.effect_render = g_effect_renders[eid];
            if (g_effect_shaders[eid]) |shader_ptr| {
                node.effect_shader = shader_ptr.*;
            }
            log.print("[effect-decode] id={d} render_set={} shader_set={} bg_flag={}\n", .{
                eid,
                node.effect_render != null,
                node.effect_shader != null,
                readLuaBool(L, idx, "effect_background"),
            });
        }
    }
    node.effect_background = readLuaBool(L, idx, "effect_background");
    // ── Physics fields ──
    node.physics_world = readLuaBool(L, idx, "physics_world");
    node.physics_body = readLuaBool(L, idx, "physics_body");
    node.physics_collider = readLuaBool(L, idx, "physics_collider");
    node.physics_body_type = readLuaU8(L, idx, "physics_body_type", 2);
    node.physics_x = readLuaFloat(L, idx, "physics_x", 0);
    node.physics_y = readLuaFloat(L, idx, "physics_y", 0);
    node.physics_angle = readLuaFloat(L, idx, "physics_angle", 0);
    node.physics_gravity_x = readLuaFloat(L, idx, "physics_gravity_x", 0);
    node.physics_gravity_y = readLuaFloat(L, idx, "physics_gravity_y", 980);
    node.physics_density = readLuaFloat(L, idx, "physics_density", 1.0);
    node.physics_friction = readLuaFloat(L, idx, "physics_friction", 0.3);
    node.physics_restitution = readLuaFloat(L, idx, "physics_restitution", 0.1);
    node.physics_radius = readLuaFloat(L, idx, "physics_radius", 0);
    node.physics_shape = readLuaU8(L, idx, "physics_shape", 0);
    // children (recursive) — handles __isMapResult expansion
    // NOTE: uses lua_next to find true max index instead of lua_objlen,
    // because LuaJIT's # operator returns 0 on sparse arrays where
    // both first and last entries are nil (e.g. all-conditional children).
    lua.lua_getfield(L, idx, "children");
    if (lua.lua_istable(L, -1)) {
        // Find true max integer key via lua_next
        var n: usize = 0;
        lua.lua_pushnil(L);
        while (lua.lua_next(L, -2) != 0) {
            if (lua.lua_isnumber(L, -2) != 0) {
                const k: usize = @intCast(lua.lua_tointeger(L, -2));
                if (k > n) n = k;
            }
            lua.lua_pop(L, 1); // pop value, keep key
        }
        if (n > 0) {
            // Pass 1: count total children (expand __isMapResult arrays)
            var total: usize = 0;
            for (0..n) |i| {
                lua.lua_rawgeti(L, -1, @intCast(i + 1));
                if (lua.lua_istable(L, -1)) {
                    lua.lua_getfield(L, -1, "__isMapResult");
                    const is_map = lua.lua_toboolean(L, -1) != 0;
                    lua.lua_pop(L, 1);
                    if (is_map) {
                        total += @intCast(lua.lua_objlen(L, -1));
                    } else {
                        total += 1;
                    }
                } else if (!lua.lua_isnil(L, -1)) {
                    total += 1;
                }
                lua.lua_pop(L, 1);
            }
            if (total > 0) {
                const kids = alloc.alloc(Node, total) catch {
                    lua.lua_pop(L, 1);
                    return node;
                };
                // Pass 2: fill children (expand map results inline)
                var ki: usize = 0;
                for (0..n) |i| {
                    lua.lua_rawgeti(L, -1, @intCast(i + 1));
                    if (lua.lua_istable(L, -1)) {
                        lua.lua_getfield(L, -1, "__isMapResult");
                        const is_map = lua.lua_toboolean(L, -1) != 0;
                        lua.lua_pop(L, 1);
                        if (is_map) {
                            const mn: usize = @intCast(lua.lua_objlen(L, -1));
                            for (0..mn) |mi| {
                                lua.lua_rawgeti(L, -1, @intCast(mi + 1));
                                if (ki < total) {
                                    kids[ki] = stampLuaNode(L, -1, alloc);
                                    ki += 1;
                                }
                                lua.lua_pop(L, 1);
                            }
                        } else {
                            if (ki < total) {
                                kids[ki] = stampLuaNode(L, -1, alloc);
                                ki += 1;
                            }
                        }
                    }
                    lua.lua_pop(L, 1);
                }
                node.children = kids[0..ki];
            }
        }
    }
    lua.lua_pop(L, 1);
    return node;
}

fn hostDeclareChildren(L: ?*lua.lua_State) callconv(.c) c_int {
    // Arg 1: wrapper node pointer (lightuserdata)
    const wrapper_ptr = lua.lua_touserdata(L, 1) orelse return 0;
    const wrapper: *Node = @ptrCast(@alignCast(wrapper_ptr));
    // Arg 2: Lua table array of child node descriptions
    if (!lua.lua_istable(L, 2)) return 0;
    const count: usize = @intCast(lua.lua_objlen(L, 2));
    if (count == 0) {
        wrapper.children = &.{};
        layout.markLayoutDirty();
        return 0;
    }
    const alloc = lua_node_arena.allocator();
    const kids = alloc.alloc(Node, count) catch return 0;
    for (0..count) |i| {
        lua.lua_rawgeti(L, 2, @intCast(i + 1));
        kids[i] = stampLuaNode(L, -1, alloc);
        lua.lua_pop(L, 1);
    }
    wrapper.children = kids;
    layout.markLayoutDirty();
    return 0;
}

fn hostClearLuaNodes(_: ?*lua.lua_State) callconv(.c) c_int {
    // debug logging removed
    // Clear any wrapper nodes' children before resetting arena
    // (prevents dangling pointers during re-stamp)
    for (0..16) |i| {
        var buf: [16]u8 = undefined;
        const name = std.fmt.bufPrint(&buf, "__mw{d}", .{i}) catch break;
        buf[name.len] = 0;
        const L = g_lua orelse break;
        lua.lua_getglobal(L, @as([*:0]const u8, @ptrCast(buf[0..name.len :0])));
        if (lua.lua_isuserdata(L, -1) != 0) {
            const ptr = lua.lua_touserdata(L, -1);
            if (ptr) |p| {
                const node: *Node = @ptrCast(@alignCast(p));
                node.children = &.{};
            }
        }
        lua.lua_pop(L, 1);
    }
    _ = lua_node_arena.reset(.retain_capacity);
    layout.markLayoutDirty();
    return 0;
}

/// __eval(jsExpr) → evaluates a JS expression in QJS and returns the bridged value to Lua.
/// Scalars still work as before; arrays/objects now return Lua tables through the shared bridge.
/// __syncToJS(name, value) — sync a Lua state variable back to QJS
/// Called by Lua setters when a <script> block is present, so JS and Lua stay in sync.
fn hostSyncToJS(L: ?*lua.lua_State) callconv(.c) c_int {
    var name_len: usize = 0;
    const name_ptr = lua.lua_tolstring(L, 1, &name_len);
    if (name_ptr == null or name_len == 0) return 0;
    // The Lua setter already set the global before calling us,
    // so syncLuaToQjs can read it by name.
    const name_z: [*:0]const u8 = @ptrCast(name_ptr);
    qjs_runtime.syncLuaToQjs(name_z);
    return 0;
}

fn hostEval(L: ?*lua.lua_State) callconv(.c) c_int {
    var len: usize = 0;
    const ptr = lua.lua_tolstring(L, 1, &len);
    if (ptr == null or len == 0) {
        lua.lua_pushnil(L);
        return 1;
    }
    const code: []const u8 = @as([*]const u8, @ptrCast(ptr))[0..len];
    if (!qjs_runtime.evalToLua(code)) {
        lua.lua_pushnil(L);
    }
    return 1;
}

/// __callJS(name) → call a global JS function by name, discarding the return value.
fn hostCallJS(L: ?*lua.lua_State) callconv(.c) c_int {
    var len: usize = 0;
    const ptr = lua.lua_tolstring(L, 1, &len);
    if (ptr == null or len == 0) return 0;
    const name_z: [*:0]const u8 = @ptrCast(ptr);
    qjs_runtime.callGlobal(name_z);
    return 0;
}

/// __callJSReturn(name) → call a global JS function by name and bridge the result to Lua.
fn hostCallJSReturn(L: ?*lua.lua_State) callconv(.c) c_int {
    var len: usize = 0;
    const ptr = lua.lua_tolstring(L, 1, &len);
    if (ptr == null or len == 0) {
        lua.lua_pushnil(L);
        return 1;
    }
    const name_z: [*:0]const u8 = @ptrCast(ptr);
    if (!qjs_runtime.callGlobalReturnToLua(name_z)) {
        lua.lua_pushnil(L);
    }
    return 1;
}

/// Set a map wrapper node as a Lua global lightuserdata (__mw0, __mw1, etc.)
pub fn setMapWrapper(index: usize, ptr: *anyopaque) void {
    const L = g_lua orelse return;
    lua.lua_pushlightuserdata(L, ptr);
    var buf: [16]u8 = undefined;
    const name_slice = std.fmt.bufPrint(&buf, "__mw{d}", .{index}) catch return;
    buf[name_slice.len] = 0;
    lua.lua_setglobal(L, @as([*:0]const u8, @ptrCast(buf[0..name_slice.len :0])));
}

/// Store scroll offset in Lua global `_scrollY[slot]` for the next Lua-tree stamp.
/// Does not mark app dirty (avoids full `__render` on every wheel tick).
pub fn persistScrollSlot(slot: u32, scroll_y: f32) void {
    if (slot == 0) return;
    const L = g_lua orelse return;
    _ = lua.lua_getglobal(L, "_scrollY");
    if (lua.lua_isnil(L, -1)) {
        lua.lua_pop(L, 1);
        lua.lua_newtable(L);
        lua.lua_pushvalue(L, -1);
        lua.lua_setglobal(L, "_scrollY");
    }
    lua.lua_pushinteger(L, @intCast(slot));
    lua.lua_pushnumber(L, scroll_y);
    lua.lua_settable(L, -3);
    lua.lua_pop(L, 1);
}

// ── Init / Deinit ───────────────────────────────────────────────────────

pub fn initVM() void {
    const L = lua.luaL_newstate() orelse {
        std.log.err("[luajit-runtime] Failed to create Lua state", .{});
        return;
    };
    lua.luaL_openlibs(L);
    g_lua = L;
    jsrtInitTree();

    // Host-fn registration table was removed because nothing in modern V8
    // carts calls into Lua-side host fns (Smith/.tsz codegen was the only
    // consumer, and that's frozen). The table baked ~45 host-fn name string
    // literals into .rodata — visible in every binary even when unreferenced.
    // If a future feature needs Lua → Zig host calls, build a minimal table
    // here for *that* feature only. Don't restore the full Smith-era list.

    // Scroll offset persistence for Lua-tree apps (see persistScrollSlot / compiler emit)
    lua.lua_newtable(L);
    lua.lua_setglobal(L, "_scrollY");

    // Load tsl_stdlib
    if (lua.luaL_loadstring(L, TSL_STDLIB) == 0) {
        if (lua.lua_pcall(L, 0, 0, 0) != 0) {
            logLuaError(L, "tsl_stdlib init");
            lua.lua_pop(L, 1);
        }
    } else {
        logLuaError(L, "tsl_stdlib load");
        lua.lua_pop(L, 1);
    }

    std.log.info("[luajit-runtime] VM initialized with tsl_stdlib", .{});
}

/// Register a host function as a Lua global (mirrors qjs_runtime.registerHostFn).
/// Called from generated _appInit() for per-cart functions like __setObjArr0.
pub fn registerHostFn(name: [*:0]const u8, func: *const anyopaque, argc: c_int) void {
    _ = argc;
    const L = g_lua orelse return;
    const FnType = lua.lua_CFunction;
    const lua_fn: FnType = @ptrCast(@alignCast(func));
    lua.lua_pushcclosure(L, lua_fn, 0);
    lua.lua_setglobal(L, name);
}

pub fn deinit() void {
    if (g_lua) |L| {
        lua.lua_close(L);
        g_lua = null;
    }
    jsrtDeinitTree();
}

// ── Script evaluation ───────────────────────────────────────────────────

/// Load and run the app's Lua logic (equivalent to qjs_runtime.evalScript)
pub fn evalScript(lua_logic: []const u8) void {
    const L = g_lua orelse return;
    if (lua_logic.len == 0) return;

    if (lua.luaL_loadbuffer(L, lua_logic.ptr, lua_logic.len, "<app>") != 0) {
        logLuaError(L, "evalScript load");
        lua.lua_pop(L, 1);
        return;
    }
    if (lua.lua_pcall(L, 0, 0, 0) != 0) {
        logLuaError(L, "evalScript run");
        lua.lua_pop(L, 1);
        return;
    }
}

/// Eval a Lua expression (equivalent to qjs_runtime.evalExpr — called on events)
pub fn evalExpr(code: []const u8) void {
    const L = g_lua orelse return;
    if (code.len == 0) return;

    if (lua.luaL_loadbuffer(L, code.ptr, code.len, "<handler>") != 0) {
        logLuaError(L, "evalExpr");
        lua.lua_pop(L, 1);
        return;
    }
    if (lua.lua_pcall(L, 0, 0, 0) != 0) {
        logLuaError(L, "evalExpr");
        lua.lua_pop(L, 1);
    }
}

/// Call a global Lua function by name (no arguments)
pub fn callGlobal(name: [*:0]const u8) void {
    const L = g_lua orelse return;
    _ = lua.lua_getglobal(L, name);
    if (lua.lua_isfunction(L, -1)) {
        if (lua.lua_pcall(L, 0, 0, 0) != 0) {
            logLuaError(L, std.mem.span(name));
            lua.lua_pop(L, 1);
        }
    } else {
        lua.lua_pop(L, 1);
    }
}

/// Call a global Lua function with one string argument
pub fn callGlobalStr(name: [*:0]const u8, arg: [*:0]const u8) void {
    const L = g_lua orelse return;
    _ = lua.lua_getglobal(L, name);
    if (lua.lua_isfunction(L, -1)) {
        lua.lua_pushstring(L, arg);
        if (lua.lua_pcall(L, 1, 0, 0) != 0) {
            logLuaError(L, std.mem.span(name));
            lua.lua_pop(L, 1);
        }
    } else {
        lua.lua_pop(L, 1);
    }
}

/// Call a global Lua function with one integer argument
pub fn callGlobalInt(name: [*:0]const u8, arg: i64) void {
    const L = g_lua orelse return;
    _ = lua.lua_getglobal(L, name);
    if (lua.lua_isfunction(L, -1)) {
        lua.lua_pushinteger(L, @intCast(arg));
        if (lua.lua_pcall(L, 1, 0, 0) != 0) {
            logLuaError(L, std.mem.span(name));
            lua.lua_pop(L, 1);
        }
    } else {
        lua.lua_pop(L, 1);
    }
}

/// Call a global Lua function with one integer and one string argument.
pub fn callGlobalIntStr(name: [*:0]const u8, arg0: i64, arg1: [*:0]const u8) void {
    const L = g_lua orelse return;
    _ = lua.lua_getglobal(L, name);
    if (lua.lua_isfunction(L, -1)) {
        lua.lua_pushinteger(L, @intCast(arg0));
        lua.lua_pushstring(L, arg1);
        if (lua.lua_pcall(L, 2, 0, 0) != 0) {
            logLuaError(L, std.mem.span(name));
            lua.lua_pop(L, 1);
        }
    } else {
        lua.lua_pop(L, 1);
    }
}

/// Call a global Lua function with three integer arguments (used for keyboard events)
pub fn callGlobal3Int(name: [*:0]const u8, arg0: i64, arg1: i64, arg2: i64) void {
    const L = g_lua orelse return;
    _ = lua.lua_getglobal(L, name);
    if (lua.lua_isfunction(L, -1)) {
        lua.lua_pushinteger(L, @intCast(arg0));
        lua.lua_pushinteger(L, @intCast(arg1));
        lua.lua_pushinteger(L, @intCast(arg2));
        if (lua.lua_pcall(L, 3, 0, 0) != 0) {
            logLuaError(L, std.mem.span(name));
            lua.lua_pop(L, 1);
        }
    } else {
        lua.lua_pop(L, 1);
    }
}

/// Set a global Lua integer variable
pub fn setGlobalInt(name: [*:0]const u8, val: i64) void {
    const L = g_lua orelse return;
    lua.lua_pushinteger(L, @intCast(val));
    lua.lua_setglobal(L, name);
}

/// Check if a global Lua function exists
pub fn hasGlobal(name: [*:0]const u8) bool {
    const L = g_lua orelse return false;
    _ = lua.lua_getglobal(L, name);
    const is_fn = lua.lua_isfunction(L, -1);
    lua.lua_pop(L, 1);
    return is_fn;
}

/// Per-frame tick — calls __zigOS_tick if defined (same as QJS)
pub fn tick() void {
    const L = g_lua orelse return;
    const t0 = std.time.microTimestamp();

    _ = lua.lua_getglobal(L, "__zigOS_tick");
    if (lua.lua_isfunction(L, -1)) {
        if (lua.lua_pcall(L, 0, 0, 0) != 0) {
            logLuaError(L, "tick");
            lua.lua_pop(L, 1);
        }
    } else {
        lua.lua_pop(L, 1);
    }

    _ = lua.lua_getglobal(L, "__jsrtDrainMicrotasks");
    if (lua.lua_isfunction(L, -1)) {
        if (lua.lua_pcall(L, 0, 0, 0) != 0) {
            logLuaError(L, "jsrt-microtasks");
            lua.lua_pop(L, 1);
        }
    } else {
        lua.lua_pop(L, 1);
    }

    telemetry_tick_us = @intCast(std.time.microTimestamp() - t0);

    // Reset bridge call counter every second
    const now = std.time.microTimestamp();
    if (now - bridge_last_reset > 1_000_000) {
        bridge_calls_this_second = 0;
        bridge_last_reset = now;
    }
}

// ── Error helper ────────────────────────────────────────────────────────

fn logLuaError(L: *lua.lua_State, context: []const u8) void {
    var len: usize = 0;
    const err = lua.lua_tolstring(L, -1, &len);
    if (err != null) {
        const msg: []const u8 = @as([*]const u8, @ptrCast(err))[0..len];
        log.print("[raw-lua-err] {s}: {s}\n", .{ context, msg });
        std.log.err("[luajit-runtime] {s}: {s}", .{ context, msg });
    }
}
