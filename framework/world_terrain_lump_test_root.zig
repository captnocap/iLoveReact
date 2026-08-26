// Root at framework/ so the test's world/ + gpu/ + game/ imports stay inside the
// Zig 0.16 module boundary. The test itself lives under framework/testing/unit/
// per repository convention.
test {
    _ = @import("testing/unit/world_terrain_lump.zig");
}
