const std = @import("std");
const compile_progress = @import("../../gpu/compile_progress.zig");

test "shader compile completion records memory telemetry once" {
    var environ = try std.testing.environ.createMap(std.testing.allocator);
    defer environ.deinit();
    const before = compile_progress.memoryStats().compile_count;
    var progress = compile_progress.CompileProgress{};
    progress.start(std.testing.io, &environ, 2048);
    progress.finishMemory();
    progress.finishMemory();
    try std.testing.expectEqual(before + 1, compile_progress.memoryStats().compile_count);
}
