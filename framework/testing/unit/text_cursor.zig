const std = @import("std");
const testing = std.testing;
const TextEngine = @import("../../primitive/text.zig").TextEngine;
const gpu_text = @import("../../gpu/text.zig");

fn initMonospaceTextEngine() !TextEngine {
    return TextEngine.initHeadless("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf") catch
        TextEngine.initHeadless("/usr/share/fonts/dejavu/DejaVuSansMono.ttf") catch
        TextEngine.initHeadless("/System/Library/Fonts/Supplemental/Courier New.ttf") catch
        TextEngine.initHeadless("C:/Windows/Fonts/consola.ttf");
}

test "editable-text caret and hit-test share the painted glyph advances" {
    var text_engine = try initMonospaceTextEngine();
    defer text_engine.deinit();

    gpu_text.initText(
        text_engine.library,
        text_engine.face,
        text_engine.fallback_faces,
        text_engine.fallback_count,
    );
    defer gpu_text.deinit();

    const sample = "a b {} [] \\ /_|-+=()";
    const size_px: u16 = 17;
    const letter_spacing: f32 = 1.25;
    gpu_text.setLetterSpacing(letter_spacing);
    defer gpu_text.setLetterSpacing(0);

    // Every byte boundary in this ASCII regression string must land at the
    // exact pen position used by drawTextLine. Spaces, braces, brackets, and
    // backslashes are the glyphs that exposed the accumulated mismatch.
    for (0..sample.len + 1) |byte_idx| {
        const painted_advance = gpu_text.subLineAdvance(sample[0..byte_idx], size_px);
        const caret = text_engine.byteToPosStyledLH(
            sample,
            byte_idx,
            size_px,
            0,
            letter_spacing,
            0,
        );
        try testing.expectApproxEqAbs(painted_advance, caret.x, 0.001);
        try testing.expectEqual(@as(f32, 0), caret.y);

        const hit = text_engine.hitTestWrappedAlignedStyledLH(
            sample,
            caret.x,
            0,
            size_px,
            0,
            .left,
            letter_spacing,
            0,
        );
        try testing.expectEqual(byte_idx, hit);
    }

    // A click on the right half of the first glyph resolves after it. The old
    // hit-test returned the previous glyph's start and was one byte behind.
    const first_advance = gpu_text.subLineAdvance(sample[0..1], size_px);
    const after_first = text_engine.hitTestWrappedAlignedStyledLH(
        sample,
        first_advance * 0.75,
        0,
        size_px,
        0,
        .left,
        letter_spacing,
        0,
    );
    try testing.expectEqual(@as(usize, 1), after_first);
}
