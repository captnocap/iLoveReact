// stb_image_resize_impl.c — single translation unit that emits the
// stb_image_resize2 implementation. Mirrors stb_image_impl.c /
// stb_image_write_impl.c. Linked into the cart host when -Dhas-imageops
// (the @reactjit/image door). Powers codec.zig's resize stage.
#define STB_IMAGE_RESIZE_IMPLEMENTATION
#include "stb_image_resize2.h"
