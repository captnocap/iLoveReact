const state = @import("state.zig");
const layout = @import("layout.zig");
const luajit_runtime = @import("luajit_runtime.zig");

fn countTreeNodes(node: layout.Node) usize {
    var total: usize = 0;
    for (node.children) |child| {
        total += 1;
        total += countTreeNodes(child);
    }
    return total;
}

fn rootTextValue() []const u8 {
    const root = luajit_runtime.jsrtRoot();
    if (root.children.len == 0) return "";
    const pressable = root.children[0];
    if (pressable.children.len == 0) return "";
    const text_host = pressable.children[0];
    if (text_host.children.len == 0) return "";
    return text_host.children[0].text orelse "";
}

pub export fn test_init_vm() void {
    luajit_runtime.initVM();
}

pub export fn test_deinit_vm() void {
    luajit_runtime.deinit();
}

pub export fn test_eval_script(ptr: [*]const u8, len: usize) void {
    luajit_runtime.evalScript(ptr[0..len]);
}

pub export fn test_call_global(name: [*:0]const u8) void {
    luajit_runtime.callGlobal(name);
}

pub export fn test_root_child_count() usize {
    return luajit_runtime.jsrtRoot().children.len;
}

pub export fn test_root_total_node_count() usize {
    return countTreeNodes(luajit_runtime.jsrtRoot().*);
}

pub export fn test_root_text_value_ptr() [*]const u8 {
    return rootTextValue().ptr;
}

pub export fn test_root_text_value_len() usize {
    return rootTextValue().len;
}

// C-ABI state exports required by luajit_runtime.zig's host callbacks.
pub export fn rjit_state_create_slot(initial: i64) usize {
    return state.createSlot(initial);
}

pub export fn rjit_state_create_slot_float(initial: f64) usize {
    return state.createSlotFloat(initial);
}

pub export fn rjit_state_create_slot_bool(initial: bool) usize {
    return state.createSlotBool(initial);
}

pub export fn rjit_state_create_slot_string(ptr: [*]const u8, len: usize) usize {
    return state.createSlotString(ptr[0..len]);
}

pub export fn rjit_state_get_slot(id: usize) i64 {
    return state.getSlot(id);
}

pub export fn rjit_state_set_slot(id: usize, val: i64) void {
    state.setSlot(id, val);
}

pub export fn rjit_state_get_slot_float(id: usize) f64 {
    return state.getSlotFloat(id);
}

pub export fn rjit_state_set_slot_float(id: usize, val: f64) void {
    state.setSlotFloat(id, val);
}

pub export fn rjit_state_get_slot_bool(id: usize) bool {
    return state.getSlotBool(id);
}

pub export fn rjit_state_set_slot_bool(id: usize, val: bool) void {
    state.setSlotBool(id, val);
}

pub export fn rjit_state_get_slot_string_ptr(id: usize) [*]const u8 {
    return state.getSlotString(id).ptr;
}

pub export fn rjit_state_get_slot_string_len(id: usize) usize {
    return state.getSlotString(id).len;
}

pub export fn rjit_state_set_slot_string(id: usize, ptr: [*]const u8, len: usize) void {
    state.setSlotString(id, ptr[0..len]);
}

pub export fn rjit_state_mark_dirty() void {
    state.markDirty();
}

pub export fn rjit_state_is_dirty() bool {
    return state.isDirty();
}

pub export fn rjit_state_clear_dirty() void {
    state.clearDirty();
}
