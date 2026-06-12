//! Test root for storage/localstore.zig (zig build test-localstore).
//! Lives at framework/ top level so the module root dir is framework/ and
//! localstore's relative imports (../fs/fs.zig, sqlite.zig) stay in-path.
//! The tests pin the regression that ate painted building-face materials:
//! large values (>8KB custom-textures JSON) must persist, and oversized
//! writes must error loudly instead of vanishing.

test {
    _ = @import("storage/localstore.zig");
}
