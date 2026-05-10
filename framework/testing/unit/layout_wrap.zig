const std = @import("std");
const testing = std.testing;
const layout = @import("../../layout.zig");

fn mockMeasure(
    text: []const u8,
    font_size: u16,
    font_family_id: u8,
    max_width: f32,
    letter_spacing: f32,
    line_height: f32,
    max_lines: u16,
    no_wrap: bool,
    bold: bool,
) layout.TextMetrics {
    _ = font_family_id;
    _ = letter_spacing;
    _ = max_lines;
    _ = no_wrap;
    _ = bold;

    const char_w: f32 = 6;
    const width = @as(f32, @floatFromInt(text.len)) * char_w;
    const line_px = if (line_height > 0) line_height else @as(f32, @floatFromInt(font_size));
    return .{ .width = if (max_width > 0) @min(width, max_width) else width, .height = line_px, .ascent = line_px * 0.8 };
}

test "auto-height overflow hidden paper grows to wrapped row content" {
    layout.setMeasureFn(mockMeasure);
    defer layout.setMeasureFn(null);

    var tiles = [_]layout.Node{
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
    };
    var card_children = [_]layout.Node{
        .{ .text = "Pick a starting voice", .font_size = 10 },
        .{
            .style = .{
                .flex_direction = .row,
                .flex_wrap = .wrap,
                .gap = 10,
                .justify_content = .center,
            },
            .children = &tiles,
        },
    };
    var content_children = [_]layout.Node{
        .{
            .style = .{
                .padding = 10,
                .gap = 10,
            },
            .children = &card_children,
        },
    };
    var page_children = [_]layout.Node{
        .{
            .style = .{
                .padding = 18,
            },
            .children = &content_children,
        },
    };
    var root = layout.Node{
        .style = .{
            .width = 940,
            .overflow = .hidden,
        },
        .children = &page_children,
    };

    layout.markLayoutDirty();
    layout.layout(&root, 0, 0, 940, 720);

    const card = &root.children[0].children[0];
    try testing.expect(card.computed.h >= 424);
    try testing.expect(root.computed.h >= card.computed.h + 36);
}

test "auto-height percent max-width document grows to wrapped row content" {
    layout.setMeasureFn(mockMeasure);
    defer layout.setMeasureFn(null);

    var tiles = [_]layout.Node{
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
        .{ .style = .{ .width = 220, .min_height = 96 } },
    };
    var card_children = [_]layout.Node{
        .{ .text = "Pick a starting voice", .font_size = 10 },
        .{
            .style = .{
                .flex_direction = .row,
                .flex_wrap = .wrap,
                .gap = 10,
                .justify_content = .center,
            },
            .children = &tiles,
        },
    };
    var workbench_children = [_]layout.Node{
        .{
            .style = .{
                .padding = 10,
                .gap = 10,
            },
            .children = &card_children,
        },
    };
    var content_children = [_]layout.Node{
        .{ .text = "Voice Lab", .font_size = 18 },
        .{ .children = &workbench_children },
    };
    var doc_children = [_]layout.Node{
        .{
            .style = .{
                .padding = 18,
                .gap = 14,
            },
            .children = &content_children,
        },
    };
    var wrap_children = [_]layout.Node{
        .{
            .style = .{
                .flex_grow = 1,
                .flex_shrink = 1,
                .overflow = .hidden,
            },
            .children = &doc_children,
        },
    };
    var shell_children = [_]layout.Node{
        .{ .text = "CHARACTER", .font_size = 18 },
        .{ .text = "tabs", .font_size = 10 },
        .{
            .style = .{
                .flex_grow = 1,
                .flex_shrink = 1,
            },
            .children = &wrap_children,
        },
    };
    var outer_children = [_]layout.Node{
        .{
            .style = .{
                .width = -1,
                .max_width = 1040,
                .gap = 16,
            },
            .children = &shell_children,
        },
    };
    var root = layout.Node{
        .style = .{
            .width = 1300,
            .align_items = .center,
        },
        .children = &outer_children,
    };

    layout.markLayoutDirty();
    layout.layout(&root, 0, 0, 1300, 720);

    const shell = &root.children[0];
    const doc = &shell.children[2].children[0];
    const card = &doc.children[0].children[1].children[0];
    try testing.expect(card.computed.h >= 328);
    try testing.expect(doc.computed.h >= card.computed.h + 68);
}
