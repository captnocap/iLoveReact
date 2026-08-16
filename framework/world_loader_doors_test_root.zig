// Root at framework/ so the test's world_loader + game physics imports stay
// inside the Zig 0.16 module boundary. The actual test lives under
// framework/testing/unit/ per repository convention.
test {
    _ = @import("testing/unit/world_loader_doors.zig");
}
