const std = @import("std");
const events = @import("events");

const testing = std.testing;
const Node = events.Node;

test "middle-click handler in front of a viewport owns its hit region" {
    const viewport = Node{
        .computed = .{ .x = 0, .y = 0, .w = 900, .h = 700 },
    };
    const uv_visual = Node{
        .computed = .{ .x = 620, .y = 80, .w = 260, .h = 520 },
    };
    var uv_children = [_]Node{uv_visual};
    const uv_canvas = Node{
        .computed = .{ .x = 620, .y = 80, .w = 260, .h = 520 },
        .handlers = .{ .js_on_middle_click = "__dispatchEvent(42,'onMiddleClick')" },
        .children = &uv_children,
    };
    var children = [_]Node{ viewport, uv_canvas };
    var root = Node{
        .computed = .{ .x = 0, .y = 0, .w = 900, .h = 700 },
        .children = &children,
    };

    const uv_hit = events.hitTestMiddleClick(&root, 700, 200) orelse return error.ExpectedUvHit;
    try testing.expectEqual(&root.children[1], uv_hit);
    try testing.expect(events.hitTestMiddleClick(&root, 300, 200) == null);
}

test "pointer-blocking chrome consumes middle-click before content behind it" {
    const behind = Node{
        .computed = .{ .x = 0, .y = 0, .w = 400, .h = 300 },
        .handlers = .{ .js_on_middle_click = "__dispatchEvent(1,'onMiddleClick')" },
    };
    const chrome = Node{
        .computed = .{ .x = 40, .y = 40, .w = 180, .h = 120 },
        .blocks_pointer_events = true,
    };
    var children = [_]Node{ behind, chrome };
    var root = Node{
        .computed = .{ .x = 0, .y = 0, .w = 400, .h = 300 },
        .children = &children,
    };

    const hit = events.hitTestMiddleClick(&root, 80, 80) orelse return error.ExpectedChromeHit;
    try testing.expectEqual(&root.children[1], hit);
    try testing.expect(hit.handlers.js_on_middle_click == null);
}

test "scroll container owns wheel across its blank body and interactive children" {
    const blank = Node{
        .computed = .{ .x = 40, .y = 40, .w = 220, .h = 210 },
    };
    const button = Node{
        .computed = .{ .x = 60, .y = 60, .w = 90, .h = 28 },
        .handlers = .{ .js_on_press = "__dispatchEvent(7,'onClick')" },
    };
    var scroll_children = [_]Node{ blank, button };
    const scroll = Node{
        .computed = .{ .x = 40, .y = 40, .w = 220, .h = 210 },
        .style = .{ .overflow = .scroll },
        .content_height = 640,
        .children = &scroll_children,
    };
    const viewport = Node{
        .computed = .{ .x = 0, .y = 0, .w = 640, .h = 480 },
    };
    var children = [_]Node{ viewport, scroll };
    var root = Node{
        .computed = .{ .x = 0, .y = 0, .w = 640, .h = 480 },
        .children = &children,
    };

    try testing.expect(events.scrollContainerOwnsWheel(&root, 190, 170));
    try testing.expect(events.scrollContainerOwnsWheel(&root, 80, 72));
    try testing.expect(!events.scrollContainerOwnsWheel(&root, 320, 170));
}
