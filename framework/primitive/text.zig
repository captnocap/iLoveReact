//! ReactJIT Text Renderer — Phase 2
//!
//! FreeType glyph rasterization → SDL2 texture cache → screen.
//! Measures text for the layout engine, renders it for the painter.

const std = @import("std");
const c = @import("../c.zig").imports;
const layout = @import("../layout.zig");
const gpu_text = @import("../gpu/text.zig");

// ── UTF-8 decoding ──────────────────────────────────────────────────────────

const Utf8Char = struct {
    codepoint: u32,
    len: u3, // 1–4 bytes consumed
};

/// Decode one UTF-8 codepoint from the start of `bytes`.
/// Returns the codepoint and how many bytes it consumed.
/// Invalid sequences return U+FFFD (replacement character) and advance 1 byte.
fn decodeUtf8(bytes: []const u8) Utf8Char {
    if (bytes.len == 0) return .{ .codepoint = 0xFFFD, .len = 1 };
    const b0 = bytes[0];
    if (b0 < 0x80) {
        return .{ .codepoint = b0, .len = 1 };
    } else if (b0 < 0xC0) {
        return .{ .codepoint = 0xFFFD, .len = 1 }; // stray continuation byte
    } else if (b0 < 0xE0) {
        if (bytes.len < 2) return .{ .codepoint = 0xFFFD, .len = 1 };
        return .{ .codepoint = (@as(u32, b0 & 0x1F) << 6) | @as(u32, bytes[1] & 0x3F), .len = 2 };
    } else if (b0 < 0xF0) {
        if (bytes.len < 3) return .{ .codepoint = 0xFFFD, .len = 1 };
        return .{ .codepoint = (@as(u32, b0 & 0x0F) << 12) | (@as(u32, bytes[1] & 0x3F) << 6) | @as(u32, bytes[2] & 0x3F), .len = 3 };
    } else {
        if (bytes.len < 4) return .{ .codepoint = 0xFFFD, .len = 1 };
        return .{ .codepoint = (@as(u32, b0 & 0x07) << 18) | (@as(u32, bytes[1] & 0x3F) << 12) | (@as(u32, bytes[2] & 0x3F) << 6) | @as(u32, bytes[3] & 0x3F), .len = 4 };
    }
}

fn inlineGlyphSentinelLen(text: []const u8, i: usize) usize {
    if (i >= text.len) return 0;
    if (text[i] == 0x01) return 1;
    if (text[i] != '\\') return 0;
    if (i + 2 < text.len and text[i + 1] == '\\' and text[i + 2] == '1') return 3;
    if (i + 4 < text.len and text[i + 1] == '\\' and text[i + 2] == 'x' and text[i + 3] == '0' and text[i + 4] == '1') return 5;
    if (i + 1 < text.len and text[i + 1] == '1') return 2;
    if (i + 3 < text.len and text[i + 1] == 'x' and text[i + 2] == '0' and text[i + 3] == '1') return 4;
    return 0;
}

// ── Color Span (for syntax highlighting) ─────────────────────────────────────

pub const ColorSpan = struct {
    text: []const u8,
    color: layout.Color,
};

// ── Text Engine ─────────────────────────────────────────────────────────────

// ── Measurement cache types ──────────────────────────────────────────────────

const MCACHE_SIZE = 512;

const MeasureCacheKey = struct {
    text_ptr: usize,
    text_len: usize,
    size_px: u16,
    max_width_i: i32,
    letter_spacing_i: i16,
    line_height_i: i16,
    max_lines: u16,
    bold: bool,
};

pub const TextEngine = struct {
    library: c.FT_Library,
    face: c.FT_Face,
    /// Optional bold face. Null if no bold .ttf was found at init —
    /// fontWeight: 'bold' then silently degrades to regular (today's behavior).
    face_bold: c.FT_Face = null,
    fallback_faces: [8]c.FT_Face = undefined,
    fallback_count: usize = 0,
    current_size: u16,
    headless: bool = false,

    // Text measurement cache — avoids re-measuring identical text every frame
    measure_cache_keys: [MCACHE_SIZE]MeasureCacheKey,
    measure_cache_vals: [MCACHE_SIZE]layout.TextMetrics,
    measure_cache_valid: [MCACHE_SIZE]bool,

    pub fn init(_: *c.SDL_Renderer, font_path: [*:0]const u8) !TextEngine {
        return initHeadless(font_path);
    }

    /// Initialize TextEngine for measurement only (no SDL_Renderer needed).
    /// Use when GPU rendering handles drawing — TextEngine only does FreeType measurement.
    pub fn initHeadless(font_path: [*:0]const u8) !TextEngine {
        var library: c.FT_Library = undefined;
        if (c.FT_Init_FreeType(&library) != 0) return error.FreeTypeInitFailed;

        var face: c.FT_Face = undefined;
        if (c.FT_New_Face(library, font_path, 0, &face) != 0) return error.FontLoadFailed;
        _ = c.FT_Set_Pixel_Sizes(face, 0, 16);

        // Try to load a bold companion face. We probe a fixed set of paths
        // matching the regular faces this codebase falls back through. First
        // hit wins; absence is non-fatal — fontWeight: 'bold' just degrades
        // to regular at paint time.
        const bold_paths = [_][*:0]const u8{
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/dejavu-sans/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "C:/Windows/Fonts/segoeuib.ttf",
        };
        var face_bold: c.FT_Face = null;
        for (bold_paths) |bp| {
            var fb_bold: c.FT_Face = undefined;
            if (c.FT_New_Face(library, bp, 0, &fb_bold) == 0) {
                _ = c.FT_Set_Pixel_Sizes(fb_bold, 0, 16);
                face_bold = fb_bold;
                break;
            }
        }

        const fallback_paths = [_][*:0]const u8{
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
            "/usr/share/fonts/truetype/noto/NotoSansSymbols2-Regular.ttf",
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            "/System/Library/Fonts/Apple Color Emoji.ttc",
            "/System/Library/Fonts/Supplemental/Courier New.ttf",
        };
        var fallbacks: [8]c.FT_Face = undefined;
        var fb_count: usize = 0;
        for (fallback_paths) |fb_path| {
            if (fb_count >= fallbacks.len) break;
            var fb_face: c.FT_Face = undefined;
            if (c.FT_New_Face(library, fb_path, 0, &fb_face) == 0) {
                _ = c.FT_Set_Pixel_Sizes(fb_face, 0, 16);
                fallbacks[fb_count] = fb_face;
                fb_count += 1;
            }
        }

        return TextEngine{
            .library = library,
            .face = face,
            .face_bold = face_bold,
            .fallback_faces = fallbacks,
            .fallback_count = fb_count,
            .headless = true,
            .current_size = 16,
            .measure_cache_keys = undefined,
            .measure_cache_vals = undefined,
            .measure_cache_valid = [_]bool{false} ** MCACHE_SIZE,
        };
    }

    /// Clear the measurement cache (call on font changes or major state resets).
    pub fn clearMeasureCache(self: *TextEngine) void {
        @memset(&self.measure_cache_valid, false);
    }

    fn measureCacheHash(key: MeasureCacheKey) usize {
        var h: usize = key.text_ptr;
        h = h *% 31 +% key.text_len;
        h = h *% 31 +% @as(usize, key.size_px);
        h = h *% 31 +% @as(usize, @intCast(@as(u32, @bitCast(key.max_width_i))));
        h = h *% 31 +% @as(usize, @intCast(@as(u16, @bitCast(key.letter_spacing_i))));
        h = h *% 31 +% @as(usize, @intCast(@as(u16, @bitCast(key.line_height_i))));
        h = h *% 31 +% @as(usize, key.max_lines);
        h = h *% 31 +% @as(usize, @intFromBool(key.bold));
        return h % MCACHE_SIZE;
    }

    fn measureCacheLookup(self: *TextEngine, key: MeasureCacheKey) ?layout.TextMetrics {
        const idx = measureCacheHash(key);
        if (self.measure_cache_valid[idx] and
            std.meta.eql(self.measure_cache_keys[idx], key))
        {
            return self.measure_cache_vals[idx];
        }
        return null;
    }

    fn measureCacheStore(self: *TextEngine, key: MeasureCacheKey, val: layout.TextMetrics) void {
        const idx = measureCacheHash(key);
        self.measure_cache_keys[idx] = key;
        self.measure_cache_vals[idx] = val;
        self.measure_cache_valid[idx] = true;
    }

    pub fn deinit(self: *TextEngine) void {
        for (0..self.fallback_count) |i| {
            _ = c.FT_Done_Face(self.fallback_faces[i]);
        }
        if (self.face_bold != null) _ = c.FT_Done_Face(self.face_bold);
        _ = c.FT_Done_Face(self.face);
        _ = c.FT_Done_FreeType(self.library);
    }

    fn setSize(self: *TextEngine, size_px: u16) void {
        // Always reset — the cached `current_size` lies if windows.zig (or any
        // other module) has called FT_Set_Pixel_Sizes(self.face, ...) directly
        // since our last setSize. lineMetrics then reads metrics for the wrong
        // size, producing scale-correlated text height drift in the toolbar /
        // any auto-sized box during canvas zoom. FT_Set_Pixel_Sizes is cheap;
        // saving the FFI call isn't worth the silent corruption.
        _ = c.FT_Set_Pixel_Sizes(self.face, 0, size_px);
        self.current_size = size_px;
    }

    /// Get the advance width of a single Unicode codepoint.
    /// Single source of truth for per-glyph horizontal advance.
    /// Routes through framework/gpu/text.zig — the painter's FreeType atlas.
    fn cpAdvance(_: *TextEngine, codepoint: u32, size_px: u16) f32 {
        return gpu_text.getCharAdvance(codepoint, size_px);
    }

    /// How far this glyph's ink sticks out past its advance, on the right.
    /// Always 0 for chars with right-side bearing >= 0; positive only for
    /// glyphs whose ink overshoots their pen box. Add this for the LAST
    /// glyph in a line so layout reports the visible right-edge instead of
    /// the pen-end (otherwise auto-sized boxes paint with the last glyph
    /// touching or crossing the right border).
    fn cpRightOverhang(_: *TextEngine, codepoint: u32, size_px: u16) f32 {
        return gpu_text.getCharRightOverhang(codepoint, size_px);
    }

    fn drawLineWrapped(self: *TextEngine, text: []const u8, x: f32, y: f32, size_px: u16, max_width: f32, color: layout.Color, text_align: layout.TextAlign, letter_spacing: f32, line_height_override: f32, max_lines: u16) void {
        if (max_width <= 0) {
            self.drawText(text, x, y, size_px, color);
            return;
        }

        const lm = self.lineMetrics(size_px);
        const line_h: f32 = if (line_height_override > 0) line_height_override else lm.height;
        const wrap = self.wordWrap(text, size_px, max_width, letter_spacing);
        const count = if (max_lines > 0 and wrap.count > max_lines) max_lines else wrap.count;

        for (0..count) |li| {
            const line = text[wrap.line_starts[li]..wrap.line_ends[li]];
            var line_x = x;
            if (text_align != .left) {
                const line_w = self.measureLineWidth(line, size_px, letter_spacing);
                line_x = if (text_align == .center) x + (max_width - line_w) / 2.0 else x + max_width - line_w;
            }
            gpu_text.drawTextLine(line, line_x, y + line_h * @as(f32, @floatFromInt(li)), size_px, @as(f32, @floatFromInt(color.r)) / 255.0, @as(f32, @floatFromInt(color.g)) / 255.0, @as(f32, @floatFromInt(color.b)) / 255.0, @as(f32, @floatFromInt(color.a)) / 255.0);
        }
    }

    pub fn drawText(_: *TextEngine, text: []const u8, x: f32, y: f32, size_px: u16, color: layout.Color) void {
        gpu_text.drawTextLine(text, x, y, size_px, @as(f32, @floatFromInt(color.r)) / 255.0, @as(f32, @floatFromInt(color.g)) / 255.0, @as(f32, @floatFromInt(color.b)) / 255.0, @as(f32, @floatFromInt(color.a)) / 255.0);
    }

    /// Canonical wrap-and-paint that takes RGBA float colors and returns the
    /// total drawn height. Replaces the old gpu_text.drawTextWrapped char-loop;
    /// uses the same wordWrap algorithm as the measurement path so layout and
    /// paint can never disagree on line breaks.
    pub fn drawTextWrappedRGBA(self: *TextEngine, text: []const u8, x: f32, y: f32, size_px: u16, max_width: f32, cr: f32, cg: f32, cb: f32, ca: f32, max_lines: u16, letter_spacing: f32, line_height_override: f32) f32 {
        const lm = self.lineMetrics(size_px);
        const line_h: f32 = if (line_height_override > 0) line_height_override else lm.height;
        if (max_width <= 0) {
            gpu_text.drawTextLine(text, x, y, size_px, cr, cg, cb, ca);
            return line_h;
        }
        const wrap = self.wordWrap(text, size_px, max_width, letter_spacing);
        const count = if (max_lines > 0 and wrap.count > max_lines) max_lines else wrap.count;
        for (0..count) |li| {
            const line = text[wrap.line_starts[li]..wrap.line_ends[li]];
            gpu_text.drawTextLine(line, x, y + line_h * @as(f32, @floatFromInt(li)), size_px, cr, cg, cb, ca);
        }
        return line_h * @as(f32, @floatFromInt(count));
    }

    pub fn drawTextTruncated(self: *TextEngine, text: []const u8, x: f32, y: f32, size_px: u16, max_width: f32, color: layout.Color, letter_spacing: f32) void {
        const full_w = self.measureLineWidth(text, size_px, letter_spacing);
        if (full_w <= max_width) return self.drawText(text, x, y, size_px, color);
        const trunc = self.findTruncationPoint(text, size_px, max_width, letter_spacing);
        if (trunc == 0) return self.drawText("...", x, y, size_px, color);
        self.drawText(text[0..trunc], x, y, size_px, color);
        const prefix_w = self.measureLineWidth(text[0..trunc], size_px, letter_spacing);
        self.drawText("...", x + prefix_w, y, size_px, color);
    }

    pub fn drawTextWrapped(self: *TextEngine, text: []const u8, x: f32, y: f32, size_px: u16, max_width: f32, color: layout.Color) void {
        self.drawLineWrapped(text, x, y, size_px, max_width, color, .left, 0, 0, 0);
    }

    pub fn drawTextWrappedFull(self: *TextEngine, text: []const u8, x: f32, y: f32, size_px: u16, max_width: f32, color: layout.Color, text_align: layout.TextAlign, letter_spacing: f32, line_height_override: f32, max_lines: u16) void {
        self.drawLineWrapped(text, x, y, size_px, max_width, color, text_align, letter_spacing, line_height_override, max_lines);
    }

    pub fn drawTextWrappedAligned(self: *TextEngine, text: []const u8, x: f32, y: f32, size_px: u16, max_width: f32, color: layout.Color, text_align: layout.TextAlign) void {
        self.drawLineWrapped(text, x, y, size_px, max_width, color, text_align, 0, 0, 0);
    }

    pub fn drawColorSpans(self: *TextEngine, spans: []const ColorSpan, x: f32, y: f32, size_px: u16) void {
        var cx = x;
        for (spans) |span| {
            self.drawText(span.text, cx, y, size_px, span.color);
            cx += self.measureLineWidth(span.text, size_px, 0);
        }
    }

    /// Get font-level line metrics for the current size.
    pub fn lineMetrics(self: *TextEngine, size_px: u16) struct { ascent: f32, height: f32 } {
        self.setSize(size_px);
        const metrics = self.face.*.size.*.metrics;
        const ascent: f32 = @as(f32, @floatFromInt(metrics.ascender)) / 64.0;
        // Use FreeType's full line height (ascent + descent + line gap) to match
        // gpu.zig's line spacing. Using ascent + descent alone clips descenders
        // by 1-2px because the line gap accounts for glyph overshoot.
        const height: f32 = @as(f32, @floatFromInt(metrics.height)) / 64.0;
        return .{ .ascent = ascent, .height = height };
    }

    // ── Word wrapping ───────────────────────────────────────────────────

    const MAX_WRAP_LINES = 256;

    const WrapResult = struct {
        line_starts: [MAX_WRAP_LINES]usize = undefined,
        line_ends: [MAX_WRAP_LINES]usize = undefined,
        count: usize = 0,

        fn addLine(self: *WrapResult, start: usize, end: usize) void {
            if (self.count < MAX_WRAP_LINES) {
                self.line_starts[self.count] = start;
                self.line_ends[self.count] = end;
                self.count += 1;
            }
        }
    };

    /// Compute word-wrap line breaks for text within max_width.
    /// Words are delimited by spaces. Newlines force a break.
    /// Words wider than max_width get their own line (no mid-word break).
    /// Iterates by UTF-8 codepoints so multi-byte characters stay intact.
    fn wordWrap(self: *TextEngine, text: []const u8, size_px: u16, max_width: f32, letter_spacing: f32) WrapResult {
        var result = WrapResult{};

        if (text.len == 0) {
            result.addLine(0, 0);
            return result;
        }

        self.setSize(size_px);
        const space_w = self.cpAdvance(' ', size_px);

        var line_start: usize = 0;
        var line_width: f32 = 0;
        var last_word_end: usize = 0;
        var i: usize = 0;

        while (i < text.len) {
            // Handle newline — explicit line break
            if (text[i] == '\n') {
                const end = if (last_word_end > line_start) last_word_end else i;
                result.addLine(line_start, end);
                i += 1;
                line_start = i;
                last_word_end = i;
                line_width = 0;
                continue;
            }

            // Skip spaces
            if (text[i] == ' ') {
                i += 1;
                continue;
            }

            // Found start of a word — measure the whole word (UTF-8 aware)
            const word_start = i;
            var word_width: f32 = 0;
            var word_chars: usize = 0;
            while (i < text.len and text[i] != ' ' and text[i] != '\n') {
                const sentinel_len = inlineGlyphSentinelLen(text, i);
                if (sentinel_len > 0) {
                    if (word_chars > 0) word_width += letter_spacing;
                    word_width += @floatFromInt(size_px);
                    word_chars += 1;
                    i += sentinel_len;
                    continue;
                }
                const ch = decodeUtf8(text[i..]);
                if (word_chars > 0) word_width += letter_spacing;
                word_width += self.cpAdvance(ch.codepoint, size_px);
                word_chars += 1;
                i += ch.len;
            }
            const word_end = i;

            // Would adding this word overflow the line?
            // Sub-pixel tolerance: flex layout produces float widths that
            // accumulate ~0.001-0.5px drift between the measure pass that
            // sized the box and the paint pass that re-runs wordWrap inside
            // it. Without slack, text measured to fit at width=145.000 wraps
            // when the box ends up at 144.9997. The overflow is invisible
            // (no glyph paints past max_width — it's just the pen position
            // accumulator), so we tolerate up to half a pixel before wrapping.
            const WRAP_EPSILON: f32 = 0.5;
            const need_space = (line_width > 0);
            const separator_w = if (need_space) space_w + letter_spacing * 2 else @as(f32, 0);
            const with_word = line_width + separator_w + word_width;

            // Char-fallback only triggers when the word genuinely doesn't
            // fit — overflow of >= ~one character. Sub-pixel drift between
            // the layout pass that sized the parent and the paint pass that
            // re-runs wordWrap inside it routinely produces 0.1–2px overflow
            // on words that visually fit fine; splitting those at char level
            // creates ugly single-char orphans (e.g. "enter" → "ente" + "r").
            const CHAR_SPLIT_MIN_OVERFLOW: f32 = @as(f32, @floatFromInt(size_px)) * 0.6;
            if (max_width > 0 and word_width > max_width + CHAR_SPLIT_MIN_OVERFLOW) {
                // Single word too wide for the line — fall back to char-level
                // wrap (mirrors framework/gpu/text.zig:drawSelectionRects so
                // the selection rect and the painted text agree).
                if (need_space) {
                    result.addLine(line_start, last_word_end);
                    line_start = word_start;
                    line_width = 0;
                }
                var seg_start: usize = word_start;
                var seg_width: f32 = 0;
                var seg_chars: usize = 0;
                var j: usize = word_start;
                while (j < word_end) {
                    var ch_w: f32 = 0;
                    var ch_len: usize = 0;
                    const sl = inlineGlyphSentinelLen(text, j);
                    if (sl > 0) {
                        ch_w = @floatFromInt(size_px);
                        ch_len = sl;
                    } else {
                        const ch = decodeUtf8(text[j..]);
                        ch_w = self.cpAdvance(ch.codepoint, size_px);
                        ch_len = ch.len;
                    }
                    const ls: f32 = if (seg_chars > 0) letter_spacing else 0;
                    if (seg_chars > 0 and seg_width + ls + ch_w > max_width + WRAP_EPSILON) {
                        result.addLine(seg_start, j);
                        seg_start = j;
                        seg_width = ch_w;
                        seg_chars = 1;
                    } else {
                        seg_width += ls + ch_w;
                        seg_chars += 1;
                    }
                    j += ch_len;
                }
                line_start = seg_start;
                line_width = seg_width;
                last_word_end = word_end;
            } else if (need_space and with_word > max_width + WRAP_EPSILON) {
                // Wrap: emit current line, start new line at this word
                result.addLine(line_start, last_word_end);
                line_start = word_start;
                line_width = word_width;
                last_word_end = word_end;
            } else {
                line_width = with_word;
                last_word_end = word_end;
            }
        }

        // Emit final line
        if (line_start <= text.len) {
            const end = if (last_word_end > line_start) last_word_end else text.len;
            result.addLine(line_start, end);
        }

        if (result.count == 0) {
            result.addLine(0, text.len);
        }

        return result;
    }

    // ── Measurement ─────────────────────────────────────────────────────

    /// Measure a line's visible width, accounting for letter spacing AND
    /// the last glyph's right-side ink overhang. Reporting pure pen-end
    /// (sum of advances) under-measures any string ending in a glyph whose
    /// ink overshoots its advance (e.g. 'r' in some fonts), which is what
    /// auto-sizes a chip too narrow and lets paint touch its right border.
    fn measureLineWidth(self: *TextEngine, text: []const u8, size_px: u16, letter_spacing: f32) f32 {
        var width: f32 = 0;
        var char_count: usize = 0;
        var last_overhang: f32 = 0;
        var i: usize = 0;
        while (i < text.len) {
            // Inline glyph sentinel — occupies fontSize×fontSize square
            const sentinel_len = inlineGlyphSentinelLen(text, i);
            if (sentinel_len > 0) {
                width += @floatFromInt(size_px);
                char_count += 1;
                last_overhang = 0;
                i += sentinel_len;
                continue;
            }
            const ch = decodeUtf8(text[i..]);
            width += self.cpAdvance(ch.codepoint, size_px);
            last_overhang = self.cpRightOverhang(ch.codepoint, size_px);
            char_count += 1;
            i += ch.len;
        }
        // Add letter spacing between characters (not after the last)
        if (letter_spacing != 0 and char_count > 1) {
            width += letter_spacing * @as(f32, @floatFromInt(char_count - 1));
        }
        return width + last_overhang;
    }

    /// Measure a string's width and height at the given font size.
    /// Height uses the font's line metrics (consistent per font size),
    /// not per-glyph ink bounds (which vary by character and cause overlap).
    pub fn measureText(self: *TextEngine, text: []const u8, size_px: u16) layout.TextMetrics {
        return self.measureTextEx(text, size_px, 0, 0, 0);
    }

    /// Measure text with extended parameters: letter spacing, line height override, max lines.
    /// Bold-awareness: caller must set gpu_text bold via gpu_text.setBold(...) ahead of
    /// time — the per-glyph advances flow through the gpu atlas which honours that flag.
    pub fn measureTextEx(self: *TextEngine, text: []const u8, size_px: u16, letter_spacing: f32, line_height_override: f32, _: u16) layout.TextMetrics {
        const lm = self.lineMetrics(size_px);
        const effective_lh: f32 = if (line_height_override > 0) line_height_override else lm.height;

        const width = self.measureLineWidth(text, size_px, letter_spacing);

        return .{
            .width = width,
            .height = effective_lh,
            .ascent = lm.ascent,
        };
    }

    /// Measure text with word wrapping within max_width.
    /// Returns the widest wrapped line's width and total wrapped height.
    /// If max_width <= 0, falls back to unwrapped measureText.
    pub fn measureTextWrapped(self: *TextEngine, text: []const u8, size_px: u16, max_width: f32) layout.TextMetrics {
        return self.measureTextWrappedEx(text, size_px, max_width, 0, 0, 0, false, false);
    }

    /// Measure text with wrapping + extended params. Uses measurement cache.
    /// `bold` participates in the cache key so bold/regular widths don't collide;
    /// the actual width data comes from gpu_text's atlas which the caller must
    /// switch via gpu_text.setBold(bold) before invoking this.
    pub fn measureTextWrappedEx(self: *TextEngine, text: []const u8, size_px: u16, max_width: f32, letter_spacing: f32, line_height_override: f32, max_lines: u16, no_wrap: bool, bold: bool) layout.TextMetrics {
        // noWrap: force single-line measurement regardless of max_width
        if (max_width <= 0 or no_wrap) {
            const m = self.measureTextEx(text, size_px, letter_spacing, line_height_override, max_lines);
            if (no_wrap and max_width > 0) {
                // Clamp width to max_width but keep single-line height
                return .{ .width = @min(m.width, max_width), .height = m.height, .ascent = m.ascent };
            }
            return m;
        }

        // Check measurement cache
        const cache_key = MeasureCacheKey{
            .text_ptr = @intFromPtr(text.ptr),
            .text_len = text.len,
            .size_px = size_px,
            .max_width_i = @intFromFloat(max_width * 10),
            .letter_spacing_i = @intFromFloat(letter_spacing * 10),
            .line_height_i = @intFromFloat(line_height_override * 10),
            .max_lines = max_lines,
            .bold = bold,
        };
        if (self.measureCacheLookup(cache_key)) |cached| {
            return cached;
        }

        const lm = self.lineMetrics(size_px);
        const effective_lh: f32 = if (line_height_override > 0) line_height_override else lm.height;

        const wrap = self.wordWrap(text, size_px, max_width, letter_spacing);

        // Clamp line count
        var line_count = wrap.count;
        if (max_lines > 0 and line_count > max_lines) {
            line_count = max_lines;
        }

        // Find the widest line
        var widest: f32 = 0;
        for (0..line_count) |li| {
            const line = text[wrap.line_starts[li]..wrap.line_ends[li]];
            const lw = self.measureLineWidth(line, size_px, letter_spacing);
            if (lw > widest) widest = lw;
        }

        const result = layout.TextMetrics{
            .width = @min(widest, max_width),
            .height = effective_lh * @as(f32, @floatFromInt(line_count)),
            .ascent = lm.ascent,
        };
        self.measureCacheStore(cache_key, result);
        return result;
    }

    /// Measure the min-content width of text (width of the longest word).
    /// Used by layout for CSS min-width: auto floor in flex items.
    pub fn measureMinContentWidth(self: *TextEngine, text: []const u8, size_px: u16, letter_spacing: f32) f32 {
        var max_word_w: f32 = 0;
        var i: usize = 0;

        while (i < text.len) {
            // Skip whitespace
            while (i < text.len and (text[i] == ' ' or text[i] == '\n')) : (i += 1) {}
            if (i >= text.len) break;

            // Measure word
            var word_w: f32 = 0;
            var char_count: usize = 0;
            while (i < text.len and text[i] != ' ' and text[i] != '\n') {
                const sentinel_len = inlineGlyphSentinelLen(text, i);
                if (sentinel_len > 0) {
                    word_w += @floatFromInt(size_px);
                    char_count += 1;
                    i += sentinel_len;
                    continue;
                }
                const ch = decodeUtf8(text[i..]);
                word_w += self.cpAdvance(ch.codepoint, size_px);
                char_count += 1;
                i += ch.len;
            }
            if (letter_spacing != 0 and char_count > 1) {
                word_w += letter_spacing * @as(f32, @floatFromInt(char_count - 1));
            }
            if (word_w > max_word_w) max_word_w = word_w;
        }

        return max_word_w;
    }

    // ── Truncation ────────────────────────────────────────────────────────

    /// Find the byte offset where text should be truncated to fit within
    /// max_width minus the width of "...". Returns text.len if it fits.
    fn findTruncationPoint(self: *TextEngine, text: []const u8, size_px: u16, max_width: f32, letter_spacing: f32) usize {
        const ellipsis = "...";
        const ellipsis_w = self.measureLineWidth(ellipsis, size_px, letter_spacing);
        const avail = max_width - ellipsis_w;
        if (avail <= 0) return 0;

        // Linear scan (UTF-8 aware) — accumulate width until overflow
        var pen: f32 = 0;
        var last_ok: usize = 0;
        var i: usize = 0;
        var char_count: usize = 0;
        while (i < text.len) {
            const sentinel_len = inlineGlyphSentinelLen(text, i);
            if (sentinel_len > 0) {
                var adv: f32 = @floatFromInt(size_px);
                if (char_count > 0) adv += letter_spacing;
                if (pen + adv > avail) break;
                pen += adv;
                i += sentinel_len;
                char_count += 1;
                last_ok = i;
                continue;
            }
            const ch = decodeUtf8(text[i..]);
            var adv: f32 = self.cpAdvance(ch.codepoint, size_px);
            if (char_count > 0) adv += letter_spacing;
            if (pen + adv > avail) break;
            pen += adv;
            i += ch.len;
            char_count += 1;
            last_ok = i;
        }
        return last_ok;
    }

    // ── Text Selection ──────────────────────────────────────────────────

    /// Map a local (x, y) coordinate (relative to text origin) to a byte
    /// index in the text. Accounts for word wrapping, UTF-8, and alignment.
    /// Returns the byte index closest to the click position.
    pub fn hitTestWrapped(self: *TextEngine, text: []const u8, local_x: f32, local_y: f32, size_px: u16, max_width: f32) usize {
        return self.hitTestWrappedAlignedStyledLH(text, local_x, local_y, size_px, max_width, .left, 0, 0);
    }

    pub fn hitTestWrappedAligned(self: *TextEngine, text: []const u8, local_x: f32, local_y: f32, size_px: u16, max_width: f32, text_align: layout.TextAlign) usize {
        return self.hitTestWrappedAlignedStyledLH(text, local_x, local_y, size_px, max_width, text_align, 0, 0);
    }

    /// Hit-test with an explicit line-height override. When the caller has
    /// set a non-default lineHeight on the node (e.g. sweatshop passes
    /// `lineHeight: 17` for a 13px font), paint and hit-test MUST use the
    /// same line pitch or drag selection drifts — a ~7px font metric
    /// divided into 17px-spaced lines puts the resolved line 2.4× below the
    /// actual click. Pass 0 to keep font-metric line height.
    pub fn hitTestWrappedAlignedLH(self: *TextEngine, text: []const u8, local_x: f32, local_y: f32, size_px: u16, max_width: f32, text_align: layout.TextAlign, line_height_override: f32) usize {
        return self.hitTestWrappedAlignedStyledLH(text, local_x, local_y, size_px, max_width, text_align, 0, line_height_override);
    }

    /// Styled hit-test variant used by editable text. `letter_spacing` must
    /// match the painter: drawTextLine advances by it after every rendered
    /// glyph, so caret hit-testing must make the same step or drift farther
    /// behind with every character.
    pub fn hitTestWrappedAlignedStyledLH(self: *TextEngine, text: []const u8, local_x: f32, local_y: f32, size_px: u16, max_width: f32, text_align: layout.TextAlign, letter_spacing: f32, line_height_override: f32) usize {
        if (text.len == 0) return 0;

        const lm = self.lineMetrics(size_px);
        const effective_lh: f32 = if (line_height_override > 0) line_height_override else lm.height;
        const wrap = if (max_width > 0)
            self.wordWrap(text, size_px, max_width, letter_spacing)
        else blk: {
            var w = WrapResult{};
            w.addLine(0, text.len);
            break :blk w;
        };

        // Determine which wrapped line was clicked
        var line_idx: usize = 0;
        if (effective_lh > 0) {
            const li = @as(usize, @intFromFloat(@max(0, local_y) / effective_lh));
            line_idx = @min(li, if (wrap.count > 0) wrap.count - 1 else 0);
        }

        // Hit test within that line
        const line_start = wrap.line_starts[line_idx];
        const line_end = wrap.line_ends[line_idx];
        const line = text[line_start..line_end];

        // Compute alignment offset for this line
        var align_offset: f32 = 0;
        if (text_align != .left and max_width > 0) {
            const line_w = self.measureLineWidth(line, size_px, letter_spacing);
            if (text_align == .center) {
                align_offset = (max_width - line_w) / 2.0;
            } else {
                align_offset = max_width - line_w;
            }
        }

        // Adjust click x by alignment offset
        const adjusted_x = local_x - align_offset;

        var pen_x: f32 = 0;
        var i: usize = 0;

        while (i < line.len) {
            const sentinel_len = inlineGlyphSentinelLen(line, i);
            const adv: f32 = if (sentinel_len > 0)
                @floatFromInt(size_px)
            else
                self.cpAdvance(decodeUtf8(line[i..]).codepoint, size_px);

            // If click is before the midpoint of this char, select before it
            if (pen_x + adv / 2.0 > adjusted_x) {
                return line_start + i;
            }

            pen_x += adv + letter_spacing;
            i += if (sentinel_len > 0) sentinel_len else decodeUtf8(line[i..]).len;
        }

        // Past end of line — return end
        return line_end;
    }

    /// Get the x offset of a byte index within the text, on its wrapped line.
    /// Returns {x_offset, line_y} relative to text origin.
    pub fn byteToPos(self: *TextEngine, text: []const u8, byte_idx: usize, size_px: u16, max_width: f32) struct { x: f32, y: f32 } {
        return self.byteToPosStyledLH(text, byte_idx, size_px, max_width, 0, 0);
    }

    /// Variant accepting an explicit line-height override. Callers with a
    /// non-default lineHeight style (e.g. TextEditor: 18px for a 13px font)
    /// MUST pass it here, or the returned y will be placed at the font's
    /// natural metric height instead of the stride the paint path uses —
    /// cursor caret drifts up off its line.
    pub fn byteToPosLH(self: *TextEngine, text: []const u8, byte_idx: usize, size_px: u16, max_width: f32, line_height_override: f32) struct { x: f32, y: f32 } {
        return self.byteToPosStyledLH(text, byte_idx, size_px, max_width, 0, line_height_override);
    }

    /// Styled byte-position variant for editable text. The font family and
    /// weight come from gpu_text's active text scope; letter spacing is an
    /// explicit argument because it also participates in wrapping.
    pub fn byteToPosStyledLH(self: *TextEngine, text: []const u8, byte_idx: usize, size_px: u16, max_width: f32, letter_spacing: f32, line_height_override: f32) struct { x: f32, y: f32 } {
        if (text.len == 0) return .{ .x = 0, .y = 0 };

        const lm = self.lineMetrics(size_px);
        const effective_lh: f32 = if (line_height_override > 0) line_height_override else lm.height;
        const wrap = if (max_width > 0)
            self.wordWrap(text, size_px, max_width, letter_spacing)
        else blk: {
            var w = WrapResult{};
            w.addLine(0, text.len);
            break :blk w;
        };

        // Find which line contains this byte index
        var line_idx: usize = 0;
        for (0..wrap.count) |li| {
            if (byte_idx >= wrap.line_starts[li] and byte_idx <= wrap.line_ends[li]) {
                line_idx = li;
                break;
            }
            // If past this line, keep going
            if (li + 1 < wrap.count and byte_idx >= wrap.line_starts[li + 1]) {
                continue;
            }
            line_idx = li;
            break;
        }

        // Measure x within the line up to byte_idx
        const line_start = wrap.line_starts[line_idx];
        var line_end = wrap.line_ends[line_idx];
        // wordWrap() trims trailing spaces from visual line ends so normal text
        // measurement does not grow from invisible whitespace. Caret placement
        // still needs those bytes: after typing a space, the cursor should move
        // immediately, not wait until the next non-space character appears.
        if (byte_idx > line_end) {
            const next_start = if (line_idx + 1 < wrap.count) wrap.line_starts[line_idx + 1] else text.len + 1;
            if (byte_idx < next_start) line_end = @min(byte_idx, text.len);
        }
        const target = if (byte_idx > line_start) @min(byte_idx, line_end) - line_start else 0;
        const line = text[line_start..line_end];

        var pen_x: f32 = 0;
        var i: usize = 0;
        while (i < line.len and i < target) {
            const sentinel_len = inlineGlyphSentinelLen(line, i);
            if (sentinel_len > 0) {
                pen_x += @as(f32, @floatFromInt(size_px)) + letter_spacing;
                i += sentinel_len;
                continue;
            }
            const ch = decodeUtf8(line[i..]);
            pen_x += self.cpAdvance(ch.codepoint, size_px) + letter_spacing;
            i += ch.len;
        }

        return .{
            .x = pen_x,
            .y = effective_lh * @as(f32, @floatFromInt(line_idx)),
        };
    }

    /// Find word boundaries around a byte index. Words are runs of non-space chars.
    /// Returns {start, end} byte indices.
    pub fn wordBoundsAt(text: []const u8, byte_idx: usize) struct { start: usize, end: usize } {
        if (text.len == 0) return .{ .start = 0, .end = 0 };
        const idx = @min(byte_idx, text.len -| 1);

        // Scan backward to word start
        var start: usize = idx;
        while (start > 0 and text[start] != ' ' and text[start] != '\n') {
            // Don't split UTF-8 sequences — only break at ASCII boundaries
            if (text[start] >= 0x80 and start > 0 and text[start - 1] >= 0x80) {
                start -= 1;
            } else if (text[start] != ' ' and text[start] != '\n') {
                start -= 1;
            } else {
                break;
            }
        }
        if (start < text.len and (text[start] == ' ' or text[start] == '\n')) start += 1;

        // Scan forward to word end
        var end: usize = idx;
        while (end < text.len and text[end] != ' ' and text[end] != '\n') {
            end += 1;
        }

        return .{ .start = start, .end = end };
    }
};
