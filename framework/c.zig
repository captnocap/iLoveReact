const builtin = @import("builtin");

pub const imports = @cImport({
    @cInclude("SDL3/SDL.h");
    @cInclude("ft2build.h");
    @cInclude("freetype/freetype.h");
    @cInclude("stb/stb_image.h");
});
