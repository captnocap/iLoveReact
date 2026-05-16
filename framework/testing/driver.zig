//! Input simulation — inject synthetic SDL events for automated testing.
//!
//! Pushes SDL_Event structs directly into the event queue to simulate
//! mouse clicks, keyboard input, text typing, scroll, and resize.

const std = @import("std");
const c = @import("../c.zig").imports;
const layout = @import("../layout.zig");
const Node = layout.Node;
const query = @import("query.zig");
const QueryOpts = query.QueryOpts;

/// Simulate a mouse click at (x, y). Pushes MOUSE_BUTTON_DOWN + MOUSE_BUTTON_UP.
pub fn click(x: f32, y: f32) void {
    var down: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
    down.type = c.SDL_EVENT_MOUSE_BUTTON_DOWN;
    down.button.x = x;
    down.button.y = y;
    down.button.button = c.SDL_BUTTON_LEFT;
    down.button.down = true;
    down.button.clicks = 1;
    _ = c.SDL_PushEvent(&down);

    var up: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
    up.type = c.SDL_EVENT_MOUSE_BUTTON_UP;
    up.button.x = x;
    up.button.y = y;
    up.button.button = c.SDL_BUTTON_LEFT;
    up.button.down = false;
    up.button.clicks = 1;
    _ = c.SDL_PushEvent(&up);
}

/// Simulate a right click at (x, y). Pushes MOUSE_BUTTON_DOWN + MOUSE_BUTTON_UP.
pub fn rightClick(x: f32, y: f32) void {
    var down: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
    down.type = c.SDL_EVENT_MOUSE_BUTTON_DOWN;
    down.button.x = x;
    down.button.y = y;
    down.button.button = c.SDL_BUTTON_RIGHT;
    down.button.down = true;
    down.button.clicks = 1;
    _ = c.SDL_PushEvent(&down);

    var up: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
    up.type = c.SDL_EVENT_MOUSE_BUTTON_UP;
    up.button.x = x;
    up.button.y = y;
    up.button.button = c.SDL_BUTTON_RIGHT;
    up.button.down = false;
    up.button.clicks = 1;
    _ = c.SDL_PushEvent(&up);
}

/// Click a node found by query. Returns true if found and clicked.
pub fn clickNode(root: *Node, opts: QueryOpts) bool {
    if (query.find(root, opts)) |result| {
        click(result.cx, result.cy);
        return true;
    }
    return false;
}

/// Simulate a mouse move to (x, y).
pub fn moveMouse(x: f32, y: f32) void {
    var event: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
    event.type = c.SDL_EVENT_MOUSE_MOTION;
    event.motion.x = x;
    event.motion.y = y;
    _ = c.SDL_PushEvent(&event);
}

/// Simulate a key press + release.
pub fn key(sym: c_int) void {
    var down: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
    down.type = c.SDL_EVENT_KEY_DOWN;
    down.key.key = @intCast(sym);
    down.key.down = true;
    _ = c.SDL_PushEvent(&down);

    var up: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
    up.type = c.SDL_EVENT_KEY_UP;
    up.key.key = @intCast(sym);
    up.key.down = false;
    _ = c.SDL_PushEvent(&up);
}

/// Simulate typing a string (one SDL_EVENT_TEXT_INPUT event per character).
/// NOTE: SDL3 text input events use a const char* pointer, so we cannot
/// easily synthesize them by setting struct fields. For test purposes,
/// use the key() function with character codes instead, or send text
/// through the input module directly.
pub fn typeText(text: []const u8) void {
    // SDL3 changed text.text to a const char* pointer managed by SDL.
    // We cannot safely synthesize these events. Instead, directly inject
    // through the input system.
    const input = @import("../primitive/input.zig");
    for (text) |ch| {
        var buf: [2]u8 = .{ ch, 0 };
        input.handleTextInput(@ptrCast(&buf));
    }
}

/// Simulate a window resize.
pub fn resize(w: c_int, h: c_int) void {
    // SDL3: window events are top-level, no sub-event field.
    // SDL_EVENT_WINDOW_RESIZED carries data in window.data1/data2.
    var event: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
    event.type = c.SDL_EVENT_WINDOW_RESIZED;
    event.window.data1 = w;
    event.window.data2 = h;
    _ = c.SDL_PushEvent(&event);
}

/// Simulate a mouse wheel scroll.
pub fn scroll(x_val: f32, y_val: f32) void {
    scrollAt(x_val, y_val, 0, 0);
}

/// Simulate a mouse wheel scroll at a specific position.
pub fn scrollAt(x_val: f32, y_val: f32, mx: f32, my: f32) void {
    var event: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
    event.type = c.SDL_EVENT_MOUSE_WHEEL;
    event.wheel.x = x_val;
    event.wheel.y = y_val;
    event.wheel.mouse_x = mx;
    event.wheel.mouse_y = my;
    _ = c.SDL_PushEvent(&event);
}

/// Push a SDL_EVENT_QUIT event.
pub fn quit() void {
    var event: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
    event.type = c.SDL_EVENT_QUIT;
    _ = c.SDL_PushEvent(&event);
}
