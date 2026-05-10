//! CartridgeOS — persistent multi-app host shell with hot-reload.
//!
//! Loads .tsz app .so files as "cartridges" in a tabbed interface.
//! Listens on HTTP port 7778 for new cartridge registrations:
//!
//!   curl -X POST localhost:7778/load -d '/path/to/app.so'
//!   → {"ok":true,"tab":2,"title":"my-app"}
//!
//! Usage:
//!   tsz-dev app1.so app2.so         — load apps in tabs
//!   tsz-dev                         — empty shell, waiting for curl

const std = @import("std");
const log = @import("log.zig");
const layout = @import("../layout.zig");
const engine = @import("../engine.zig");
const cartridge = @import("../cartridge.zig");
const cartpack = @import("../cartpack.zig");
const Node = layout.Node;
const Color = layout.Color;

// ── Config ──

const LISTEN_PORT = 7778;

// ── Shell UI colors ──

const TAB_BG = Color.rgb(17, 24, 39);
const TAB_ACTIVE_BG = Color.rgb(30, 58, 138);
const TAB_TEXT = Color.rgb(148, 163, 184);
const TAB_ACTIVE_TEXT = Color.rgb(219, 234, 254);
const STATUS_BG = Color.rgb(17, 24, 39);
const STATUS_TEXT = Color.rgb(100, 116, 139);

// ── Shell UI node storage ──

const MAX_TABS = cartridge.MAX_CARTRIDGES;

var tab_text_nodes: [MAX_TABS]Node = [_]Node{.{}} ** MAX_TABS;
var tab_inner: [MAX_TABS][1]Node = undefined;
var tab_buttons: [MAX_TABS]Node = [_]Node{.{}} ** MAX_TABS;
var tab_bar_kids: [MAX_TABS]Node = [_]Node{.{}} ** MAX_TABS;

var content_child = [1]Node{.{}};
var content_area = Node{ .style = .{ .flex_grow = 1, .flex_basis = 0 } };
var status_text_node = Node{ .text = "CartridgeOS", .font_size = 11, .text_color = STATUS_TEXT };
var status_child = [1]Node{.{}};
var status_bar = Node{ .style = .{ .padding_left = 12, .padding_right = 12, .padding_top = 4, .padding_bottom = 4, .background_color = STATUS_BG } };
var tab_bar = Node{ .style = .{ .flex_direction = .row, .gap = 2, .padding_left = 8, .padding_right = 8, .padding_top = 6, .padding_bottom = 6, .background_color = TAB_BG } };

var shell_kids_multi = [3]Node{ .{}, .{}, .{} };
var shell_root_multi = Node{ .style = .{ .width = -1, .height = -1 } };

var loaded_count: usize = 0;

// ── Tab click handlers (comptime-generated dispatch table) ──

fn switchTo(idx: usize) void {
    cartridge.setActive(idx);
    refreshUI();
}

fn makeHandler(comptime i: usize) *const fn () void {
    return &struct {
        fn h() void {
            switchTo(i);
        }
    }.h;
}

const tab_handlers = blk: {
    var h: [MAX_TABS]*const fn () void = undefined;
    for (0..MAX_TABS) |i| h[i] = makeHandler(i);
    break :blk h;
};

// ── UI refresh ──

fn refreshUI() void {
    const n = loaded_count;
    const act = cartridge.activeIndex();

    for (0..n) |i| {
        tab_buttons[i].style.background_color = if (i == act) TAB_ACTIVE_BG else null;
        tab_text_nodes[i].text_color = if (i == act) TAB_ACTIVE_TEXT else TAB_TEXT;
        tab_inner[i][0] = tab_text_nodes[i];
        tab_buttons[i].children = &tab_inner[i];
        tab_bar_kids[i] = tab_buttons[i];
    }
    tab_bar.children = tab_bar_kids[0..n];

    if (cartridge.getActiveRoot()) |root| {
        content_child[0] = root.*;
        content_area.children = &content_child;
    }

    var buf: [128]u8 = undefined;
    if (n > 0) {
        if (cartridge.get(act)) |cart| {
            const s = std.fmt.bufPrint(&buf, "{d} cartridge(s) | active: {s}", .{ n, cart.titleSlice() }) catch "CartridgeOS";
            @memcpy(g_status_buf[0..s.len], s);
            g_status_len = s.len;
        }
    } else {
        const s = "CartridgeOS | waiting for apps (curl localhost:7778/load)";
        @memcpy(g_status_buf[0..s.len], s);
        g_status_len = s.len;
    }
    status_text_node.text = g_status_buf[0..g_status_len];
    status_child[0] = status_text_node;
    status_bar.children = &status_child;

    shell_kids_multi[0] = tab_bar;
    shell_kids_multi[1] = content_area;
    shell_kids_multi[2] = status_bar;
    shell_root_multi.children = &shell_kids_multi;
}

var g_status_buf: [128]u8 = undefined;
var g_status_len: usize = 0;

// ── HTTP listener for cartridge registration ──

var g_listener: ?std.posix.socket_t = null;

fn startListener() void {
    const addr = std.net.Address.parseIp4("127.0.0.1", LISTEN_PORT) catch return;
    const sock = std.posix.socket(std.posix.AF.INET, std.posix.SOCK.STREAM | std.posix.SOCK.NONBLOCK, 0) catch return;

    // Allow port reuse
    const one: [4]u8 = @bitCast(@as(u32, 1));
    std.posix.setsockopt(sock, std.posix.SOL.SOCKET, std.posix.SO.REUSEADDR, &one) catch {};

    std.posix.bind(sock, &addr.any, addr.getOsSockLen()) catch |err| {
        log.print("[dev_shell] Failed to bind port {d}: {}\n", .{ LISTEN_PORT, err });
        std.posix.close(sock);
        return;
    };
    std.posix.listen(sock, 4) catch |err| {
        log.print("[dev_shell] Failed to listen: {}\n", .{err});
        std.posix.close(sock);
        return;
    };
    g_listener = sock;
    log.print("[dev_shell] Listening on http://127.0.0.1:{d}\n", .{LISTEN_PORT});
}

/// Non-blocking: accept one connection, handle it, close it. Called each tick.
fn pollListener() void {
    const sock = g_listener orelse return;
    var client_addr: std.net.Address = undefined;
    var addr_len: std.posix.socklen_t = @sizeOf(std.net.Address);
    const client = std.posix.accept(sock, &client_addr.any, &addr_len, std.posix.SOCK.NONBLOCK) catch return;
    defer std.posix.close(client);

    // Read the request (small — path fits in 2K)
    var req_buf: [2048]u8 = undefined;
    const n = std.posix.read(client, &req_buf) catch return;
    if (n == 0) return;
    const req = req_buf[0..n];

    // Route: POST /load-pack or POST /load
    if (std.mem.startsWith(u8, req, "POST /load-pack")) {
        handleLoadPack(client, req);
        return;
    }
    if (!std.mem.startsWith(u8, req, "POST /load")) {
        const resp = "HTTP/1.1 404 Not Found\r\nContent-Length: 24\r\nConnection: close\r\n\r\n{\"error\":\"not found\"}\n";
        _ = std.posix.write(client, resp) catch {};
        return;
    }

    // Extract body (after \r\n\r\n)
    const body_start = std.mem.indexOf(u8, req, "\r\n\r\n") orelse {
        const resp = "HTTP/1.1 400 Bad Request\r\nContent-Length: 25\r\nConnection: close\r\n\r\n{\"error\":\"no body\"}\n";
        _ = std.posix.write(client, resp) catch {};
        return;
    };
    const body = std.mem.trim(u8, req[body_start + 4 ..], &.{ ' ', '\n', '\r', '\t' });
    if (body.len == 0 or !std.mem.endsWith(u8, body, ".so")) {
        const resp = "HTTP/1.1 400 Bad Request\r\nContent-Length: 32\r\nConnection: close\r\n\r\n{\"error\":\"need .so path\"}\n";
        _ = std.posix.write(client, resp) catch {};
        return;
    }

    // Load the cartridge
    const idx = cartridge.load(body) catch |err| {
        var err_buf: [256]u8 = undefined;
        const err_body = std.fmt.bufPrint(&err_buf, "{{\"ok\":false,\"error\":\"{}\"}}\n", .{err}) catch "{\"ok\":false}\n";
        var hdr_buf: [512]u8 = undefined;
        const hdr = std.fmt.bufPrint(&hdr_buf, "HTTP/1.1 500 Error\r\nContent-Length: {d}\r\nConnection: close\r\n\r\n", .{err_body.len}) catch return;
        _ = std.posix.write(client, hdr) catch {};
        _ = std.posix.write(client, err_body) catch {};
        return;
    };

    // Wire up tab
    loaded_count = cartridge.count();
    if (cartridge.get(idx)) |c| {
        tab_text_nodes[idx] = .{ .text = c.titleSlice(), .font_size = 12, .text_color = TAB_TEXT };
        tab_buttons[idx] = .{
            .style = .{ .padding_left = 12, .padding_right = 12, .padding_top = 6, .padding_bottom = 6, .border_radius = 4 },
            .handlers = .{ .on_press = tab_handlers[idx] },
        };

        // Switch to new tab
        cartridge.setActive(idx);
        refreshUI();

        // Respond with success
        var resp_buf: [256]u8 = undefined;
        const resp_body = std.fmt.bufPrint(&resp_buf, "{{\"ok\":true,\"tab\":{d},\"title\":\"{s}\"}}\n", .{ idx, c.titleSlice() }) catch "{\"ok\":true}\n";
        var hdr_buf: [512]u8 = undefined;
        const hdr = std.fmt.bufPrint(&hdr_buf, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {d}\r\nConnection: close\r\n\r\n", .{resp_body.len}) catch return;
        _ = std.posix.write(client, hdr) catch {};
        _ = std.posix.write(client, resp_body) catch {};

        log.print("[dev_shell] Loaded new cart via HTTP: {s} (tab {d})\n", .{ c.titleSlice(), idx });
    }
}

fn handleLoadPack(client: std.posix.socket_t, req: []const u8) void {
    const body_start = std.mem.indexOf(u8, req, "\r\n\r\n") orelse {
        const resp = "HTTP/1.1 400 Bad Request\r\nContent-Length: 25\r\nConnection: close\r\n\r\n{\"error\":\"no body\"}\n";
        _ = std.posix.write(client, resp) catch {};
        return;
    };
    const pack_path = std.mem.trim(u8, req[body_start + 4 ..], &.{ ' ', '\n', '\r', '\t' });
    if (pack_path.len == 0 or !std.mem.endsWith(u8, pack_path, ".pack")) {
        const resp = "HTTP/1.1 400 Bad Request\r\nContent-Length: 34\r\nConnection: close\r\n\r\n{\"error\":\"need .pack path\"}\n";
        _ = std.posix.write(client, resp) catch {};
        return;
    }

    const toc = cartpack.readToc(pack_path) catch {
        const resp = "HTTP/1.1 500 Error\r\nContent-Length: 36\r\nConnection: close\r\n\r\n{\"ok\":false,\"error\":\"bad pack\"}\n";
        _ = std.posix.write(client, resp) catch {};
        return;
    };

    var tabs_loaded: usize = 0;
    for (0..toc.count) |i| {
        var tmp_buf: [256]u8 = undefined;
        const tmp_path = cartpack.extractEntry(pack_path, &toc.entries[i], &tmp_buf) catch continue;

        const idx = cartridge.load(tmp_path) catch continue;
        loaded_count = cartridge.count();

        if (cartridge.get(idx)) |c| {
            tab_text_nodes[idx] = .{ .text = c.titleSlice(), .font_size = 12, .text_color = TAB_TEXT };
            tab_buttons[idx] = .{
                .style = .{ .padding_left = 12, .padding_right = 12, .padding_top = 6, .padding_bottom = 6, .border_radius = 4 },
                .handlers = .{ .on_press = tab_handlers[idx] },
            };
        }
        tabs_loaded += 1;
    }

    if (tabs_loaded > 0) {
        cartridge.setActive(cartridge.count() - 1);
        refreshUI();
    }

    var resp_buf: [256]u8 = undefined;
    const resp_body = std.fmt.bufPrint(&resp_buf, "{{\"ok\":true,\"loaded\":{d}}}\n", .{tabs_loaded}) catch "{\"ok\":true}\n";
    var hdr_buf: [512]u8 = undefined;
    const hdr = std.fmt.bufPrint(&hdr_buf, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {d}\r\nConnection: close\r\n\r\n", .{resp_body.len}) catch return;
    _ = std.posix.write(client, hdr) catch {};
    _ = std.posix.write(client, resp_body) catch {};

    log.print("[dev_shell] Loaded pack: {d} cartridge(s) from {s}\n", .{ tabs_loaded, pack_path });
}

// ── Engine callbacks ──

fn shellTick(now: u32) void {
    cartridge.tickAll(now);
    pollListener();

    // Refresh content (tick may have changed the tree)
    if (cartridge.getActiveRoot()) |root| {
        content_child[0] = root.*;
        content_area.children = &content_child;
        shell_kids_multi[1] = content_area;
    }
}

fn shellCheckReload(config: *engine.AppConfig) bool {
    if (cartridge.checkReloads()) |idx| {
        if (idx == cartridge.activeIndex()) {
            refreshUI();
            config.root = &shell_root_multi;
        }
        return true;
    }
    const current = cartridge.count();
    if (current != loaded_count) {
        loaded_count = current;
        refreshUI();
        config.root = &shell_root_multi;
        return true;
    }
    return false;
}

fn shellPostReload() void {}

// ── Entry point ──

pub fn main() !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    const args = try std.process.argsAlloc(alloc);

    // All non-flag args are .so paths
    for (args[1..]) |arg| {
        if (arg.len > 0 and arg[0] == '-') continue;
        _ = cartridge.load(arg) catch |err| {
            log.print("[cartridge] Failed to load {s}: {}\n", .{ arg, err });
        };
    }

    loaded_count = cartridge.count();
    log.print("[cartridge] Loaded {d} cartridge(s)\n", .{loaded_count});
    for (0..loaded_count) |i| {
        if (cartridge.get(i)) |c| {
            log.print("[cartridge]   [{d}] {s}\n", .{ i + 1, c.titleSlice() });
        }
    }

    // Build tab buttons for initial carts
    for (0..loaded_count) |i| {
        if (cartridge.get(i)) |c| {
            tab_text_nodes[i] = .{ .text = c.titleSlice(), .font_size = 12, .text_color = TAB_TEXT };
            tab_buttons[i] = .{
                .style = .{ .padding_left = 12, .padding_right = 12, .padding_top = 6, .padding_bottom = 6, .border_radius = 4 },
                .handlers = .{ .on_press = tab_handlers[i] },
            };
        }
    }

    refreshUI();

    // Start HTTP listener for dynamic cart registration
    startListener();

    // Always use tabbed shell (carts can arrive at any time via HTTP)
    const config_root: *Node = &shell_root_multi;

    const win_w: u32 = 1280;
    const win_h: u32 = 800;
    log.print("[dev_shell] window {d}x{d}\n", .{ win_w, win_h });

    try engine.run(.{
        .title = "CartridgeOS",
        .width = win_w,
        .height = win_h,
        .root = config_root,
        .tick = shellTick,
        .check_reload = shellCheckReload,
        .post_reload = shellPostReload,
    });
}
