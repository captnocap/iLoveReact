const std = @import("std");
const path_array = @import("path_array");

fn expectVec(expected: path_array.Vec3, actual: path_array.Vec3) !void {
    for (expected, actual) |want, got| try std.testing.expectApproxEqAbs(want, got, 0.0001);
}

test "straight array begins at the untouched source end" {
    const template = path_array.Template{
        .forward_min = 10,
        .forward_max = 12,
        .lateral_center = 5,
        .vertical_origin = 0,
    };
    const params = path_array.Params{
        .axis = .positive_z,
        .bays = 2,
        .turn_radians = 0,
        .rise = 0,
        .profile = .linear,
    };
    try std.testing.expect(path_array.valid(template, params));
    try expectVec(.{ 6, 1, 12 }, path_array.mapPoint(template, params, 0, .{ 6, 1, 10 }));
    try expectVec(.{ 6, 1, 14 }, path_array.mapPoint(template, params, 0, .{ 6, 1, 12 }));
}

test "neighbor bays share one constant-radius path frame" {
    const template = path_array.Template{
        .forward_min = 0,
        .forward_max = 2,
        .lateral_center = 0,
        .vertical_origin = 0,
    };
    const params = path_array.Params{
        .axis = .positive_x,
        .bays = 3,
        .turn_radians = @as(f32, std.math.pi) / 2,
        .rise = 2,
        .profile = .linear,
    };
    const first_end = path_array.mapPoint(template, params, 0, .{ 2, 0, 0 });
    const second_start = path_array.mapPoint(template, params, 1, .{ 0, 0, 0 });
    try expectVec(first_end, second_start);
    try std.testing.expectApproxEqAbs(@as(f32, 1), first_end[1], 0.0001);

    const radius: f32 = 4 / (@as(f32, std.math.pi) / 2);
    const final = path_array.mapPoint(template, params, 1, .{ 2, 0, 0 });
    try expectVec(.{ 2 + radius, 2, -radius }, final);
}

test "eased rise starts gently while linear rise remains proportional" {
    const template = path_array.Template{
        .forward_min = 0,
        .forward_max = 2,
        .lateral_center = 0,
        .vertical_origin = 0,
    };
    var params = path_array.Params{
        .axis = .negative_z,
        .bays = 3,
        .turn_radians = 0,
        .rise = 8,
        .profile = .linear,
    };
    const linear = path_array.mapPoint(template, params, 0, .{ 0, 0, -1 });
    try std.testing.expectApproxEqAbs(@as(f32, 2), linear[1], 0.0001);

    params.profile = .eased;
    const eased = path_array.mapPoint(template, params, 0, .{ 0, 0, -1 });
    try std.testing.expectApproxEqAbs(@as(f32, 1.25), eased[1], 0.0001);
}

test "explicit 3D boundary points share frames and preserve their coordinates" {
    const template = path_array.Template{
        .forward_min = 0,
        .forward_max = 1,
        .lateral_center = 0,
        .vertical_origin = 0,
    };
    const points = [_]path_array.Vec3{
        .{ 0, 0, 0 },
        .{ 1, 0.5, 0 },
        .{ 2, 1, 1 },
    };
    try std.testing.expect(path_array.validPointPath(template, &points));
    const first_end = path_array.mapPointPath(template, .positive_x, &points, 0, .{ 1, 0, 0 });
    const second_start = path_array.mapPointPath(template, .positive_x, &points, 1, .{ 0, 0, 0 });
    try expectVec(first_end, second_start);
    try expectVec(.{ 2, 0.5, 0 }, first_end);
    try expectVec(.{ 3, 1, 1 }, path_array.mapPointPath(template, .positive_x, &points, 1, .{ 1, 0, 0 }));
}
