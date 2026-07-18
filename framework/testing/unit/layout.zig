const std = @import("std");
const testing = std.testing;
const layout = @import("layout");

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
    _ = bold;
    _ = letter_spacing;
    _ = max_lines;

    const char_w: f32 = 6;
    const font_size_f: f32 = font_size;
    const full_width = @as(f32, @floatFromInt(text.len)) * char_w;
    const line_px = if (line_height > 0) line_height else font_size_f;

    var width = full_width;
    var lines: usize = 1;
    if (!no_wrap and max_width > 0 and full_width > max_width) {
        const measured_chars: usize = @floor(max_width / char_w);
        const chars_per_line = @max(1, measured_chars);
        lines = std.math.divCeil(usize, text.len, chars_per_line) catch unreachable;
        width = @min(full_width, max_width);
    }
    const height = line_px * @as(f32, @floatFromInt(lines));
    return .{
        .width = width,
        .height = height,
        .ascent = font_size_f * 0.8,
    };
}

test "pointer-blocking overlay consumes hit before interactive sibling behind it" {
    const behind = layout.Node{
        .computed = .{ .x = 10, .y = 10, .w = 80, .h = 80 },
        .handlers = .{ .on_press = noopPress },
    };
    const scrim = layout.Node{
        .computed = .{ .x = 0, .y = 0, .w = 120, .h = 120 },
        .blocks_pointer_events = true,
    };
    var children = [_]layout.Node{ behind, scrim };
    var root = layout.Node{
        .computed = .{ .x = 0, .y = 0, .w = 120, .h = 120 },
        .children = &children,
    };

    const hit = layout.hitTest(&root, 20, 20) orelse return error.ExpectedHit;
    try testing.expectEqual(&root.children[1], hit);
}

fn noopPress(_: ?*anyopaque) void {}

test "small centered text in a fixed-width box does not expand parent row height" {
    layout.setMeasureFn(mockMeasure);
    defer layout.setMeasureFn(null);

    var icon_text = [_]layout.Node{
        .{ .text = "+v", .font_size = 10 },
    };
    var gutter_slot = [_]layout.Node{
        .{
            .style = .{
                .width = 12,
                .align_items = .center,
                .justify_content = .center,
            },
            .children = &icon_text,
        },
    };
    var first_row_children = [_]layout.Node{
        .{
            .style = .{
                .width = 170,
                .flex_direction = .row,
                .align_items = .center,
            },
            .children = &gutter_slot,
        },
        .{ .text = "line 1", .font_size = 11 },
    };
    var second_row_children = [_]layout.Node{
        .{ .text = "line 2", .font_size = 11 },
    };
    var root_children = [_]layout.Node{
        .{
            .style = .{
                .flex_direction = .row,
            },
            .children = &first_row_children,
        },
        .{
            .style = .{
                .flex_direction = .row,
            },
            .children = &second_row_children,
        },
    };
    var root = layout.Node{
        .style = .{
            .flex_direction = .column,
            .gap = 1,
        },
        .children = &root_children,
    };

    layout.markLayoutDirty();
    layout.layout(&root, 0, 0, 220, 720);

    const first_row = &root.children[0];
    const second_row = &root.children[1];

    try testing.expectApproxEqAbs(@as(f32, 11), first_row.computed.h, 0.01);
    try testing.expectApproxEqAbs(@as(f32, 12), second_row.computed.y, 0.01);
    try testing.expectApproxEqAbs(@as(f32, 11), second_row.computed.h, 0.01);
}

test "centered auto-height fixed-width box shrink-wraps to its text" {
    layout.setMeasureFn(mockMeasure);
    defer layout.setMeasureFn(null);

    var icon_text = [_]layout.Node{
        .{ .text = "+v", .font_size = 10 },
    };
    var gutter_slot = [_]layout.Node{
        .{
            .style = .{
                .width = 12,
                .align_items = .center,
                .justify_content = .center,
            },
            .children = &icon_text,
        },
    };
    var leading_group = [_]layout.Node{
        .{
            .style = .{
                .width = 170,
                .flex_direction = .row,
                .align_items = .center,
            },
            .children = &gutter_slot,
        },
    };
    var root = layout.Node{
        .style = .{
            .flex_direction = .row,
        },
        .children = &leading_group,
    };

    layout.markLayoutDirty();
    layout.layout(&root, 0, 0, 220, 720);

    const centered_box = &root.children[0].children[0];
    const centered_text = &centered_box.children[0];

    try testing.expectApproxEqAbs(@as(f32, 10), centered_box.computed.h, 0.01);
    try testing.expectApproxEqAbs(centered_box.computed.y, centered_text.computed.y, 0.01);
}

test "empty centered fixed-width box stays shrink-wrapped" {
    layout.setMeasureFn(mockMeasure);
    defer layout.setMeasureFn(null);

    var gutter_slot = [_]layout.Node{
        .{
            .style = .{
                .width = 12,
                .align_items = .center,
                .justify_content = .center,
            },
        },
    };
    var first_row_children = [_]layout.Node{
        .{
            .style = .{
                .width = 170,
                .flex_direction = .row,
                .align_items = .center,
            },
            .children = &gutter_slot,
        },
        .{ .text = "line 1", .font_size = 11 },
    };
    var second_row_children = [_]layout.Node{
        .{ .text = "line 2", .font_size = 11 },
    };
    var root_children = [_]layout.Node{
        .{
            .style = .{
                .flex_direction = .row,
            },
            .children = &first_row_children,
        },
        .{
            .style = .{
                .flex_direction = .row,
            },
            .children = &second_row_children,
        },
    };
    var root = layout.Node{
        .style = .{
            .flex_direction = .column,
            .gap = 1,
        },
        .children = &root_children,
    };

    layout.markLayoutDirty();
    layout.layout(&root, 0, 0, 220, 720);

    try testing.expectApproxEqAbs(@as(f32, 11), root.children[0].computed.h, 0.01);
    try testing.expectApproxEqAbs(@as(f32, 12), root.children[1].computed.y, 0.01);
}

test "text in centered flex detail region wraps to the detail width" {
    layout.setMeasureFn(mockMeasure);
    defer layout.setMeasureFn(null);

    var tree_text = [_]layout.Node{
        .{ .text = "Tree", .font_size = 11 },
    };
    var detail_text = [_]layout.Node{
        .{ .text = "detail flex region should wrap", .font_size = 11 },
    };
    var row_children = [_]layout.Node{
        .{
            .style = .{
                .width = 120,
                .justify_content = .center,
                .align_items = .center,
            },
            .children = &tree_text,
        },
        .{
            .style = .{
                .flex_grow = 1,
                .flex_basis = 0,
                .justify_content = .center,
                .align_items = .center,
            },
            .children = &detail_text,
        },
    };
    var root = layout.Node{
        .style = .{
            .flex_direction = .row,
            .gap = 6,
            .align_items = .stretch,
        },
        .children = &row_children,
    };

    layout.markLayoutDirty();
    layout.layout(&root, 0, 0, 160, 52);

    const detail = &root.children[1];
    const label = &detail.children[0];

    try testing.expectApproxEqAbs(@as(f32, 34), detail.computed.w, 0.01);
    try testing.expect(label.computed.w <= detail.computed.w + 0.01);
    try testing.expect(label.computed.h > 11);
}

test "text in stretch flex detail region wraps as a control" {
    layout.setMeasureFn(mockMeasure);
    defer layout.setMeasureFn(null);

    var tree_text = [_]layout.Node{
        .{ .text = "Tree", .font_size = 11 },
    };
    var detail_text = [_]layout.Node{
        .{ .text = "detail flex region should wrap", .font_size = 11 },
    };
    var row_children = [_]layout.Node{
        .{
            .style = .{
                .width = 120,
                .justify_content = .center,
                .align_items = .center,
            },
            .children = &tree_text,
        },
        .{
            .style = .{
                .flex_grow = 1,
                .flex_basis = 0,
                .justify_content = .center,
                .align_items = .stretch,
            },
            .children = &detail_text,
        },
    };
    var root = layout.Node{
        .style = .{
            .flex_direction = .row,
            .gap = 6,
            .align_items = .stretch,
        },
        .children = &row_children,
    };

    layout.markLayoutDirty();
    layout.layout(&root, 0, 0, 160, 52);

    const detail = &root.children[1];
    const label = &detail.children[0];

    try testing.expectApproxEqAbs(@as(f32, 34), detail.computed.w, 0.01);
    try testing.expectApproxEqAbs(detail.computed.w, label.computed.w, 0.01);
    try testing.expect(label.computed.h > 11);
}

test "text primitive wrapper passes stretched width to bare text child" {
    layout.setMeasureFn(mockMeasure);
    defer layout.setMeasureFn(null);

    var footer_text = [_]layout.Node{
        .{ .text = "footer text should use the full tooltip content width before wrapping", .font_size = 10 },
    };
    var footer_wrapper = [_]layout.Node{
        .{
            .style = .{
                .flex_direction = .column,
            },
            .children = &footer_text,
        },
    };
    var root = layout.Node{
        .style = .{
            .width = 360,
            .padding = 12,
            .gap = 10,
        },
        .children = &footer_wrapper,
    };

    layout.markLayoutDirty();
    layout.layout(&root, 0, 0, 360, 200);

    const wrapper = &root.children[0];
    const text = &wrapper.children[0];

    try testing.expectApproxEqAbs(@as(f32, 336), wrapper.computed.w, 0.01);
    try testing.expectApproxEqAbs(wrapper.computed.w, text.computed.w, 0.01);
}

test "row flex item with flex_basis zero keeps auto min width at exact boundary" {
    layout.setMeasureFn(mockMeasure);
    defer layout.setMeasureFn(null);

    var tree_text = [_]layout.Node{
        .{ .text = "Tree", .font_size = 11 },
    };
    var detail_text = [_]layout.Node{
        .{ .text = "detail flex region should wrap", .font_size = 11 },
    };
    var row_children = [_]layout.Node{
        .{
            .style = .{
                .width = 120,
                .justify_content = .center,
                .align_items = .center,
            },
            .children = &tree_text,
        },
        .{
            .style = .{
                .flex_grow = 1,
                .flex_basis = 0,
                .justify_content = .center,
                .align_items = .stretch,
            },
            .children = &detail_text,
        },
    };
    var root = layout.Node{
        .style = .{
            .flex_direction = .row,
            .gap = 6,
            .align_items = .stretch,
        },
        .children = &row_children,
    };

    layout.markLayoutDirty();
    layout.layout(&root, 0, 0, 126, 52);

    const detail = &root.children[1];
    const label = &detail.children[0];

    try testing.expectApproxEqAbs(@as(f32, 36), detail.computed.w, 0.01);
    try testing.expectApproxEqAbs(detail.computed.w, label.computed.w, 0.01);
    try testing.expect(label.computed.h > 11);
}

test "explicit min_width zero opts out of row flex auto minimum" {
    layout.setMeasureFn(mockMeasure);
    defer layout.setMeasureFn(null);

    var tree_text = [_]layout.Node{
        .{ .text = "Tree", .font_size = 11 },
    };
    var detail_text = [_]layout.Node{
        .{ .text = "detail flex region should wrap", .font_size = 11 },
    };
    var row_children = [_]layout.Node{
        .{
            .style = .{
                .width = 120,
                .justify_content = .center,
                .align_items = .center,
            },
            .children = &tree_text,
        },
        .{
            .style = .{
                .flex_grow = 1,
                .flex_basis = 0,
                .min_width = 0,
                .justify_content = .center,
                .align_items = .stretch,
            },
            .children = &detail_text,
        },
    };
    var root = layout.Node{
        .style = .{
            .flex_direction = .row,
            .gap = 6,
            .align_items = .stretch,
        },
        .children = &row_children,
    };

    layout.markLayoutDirty();
    layout.layout(&root, 0, 0, 126, 52);

    const detail = &root.children[1];

    try testing.expectApproxEqAbs(@as(f32, 0), detail.computed.w, 0.01);
}
