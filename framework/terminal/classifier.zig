//! Semantic classifier — token-level classification for terminal output.
//!
//! Classifies each row of terminal text into semantic tokens and provides
//! per-token colors for rendering. Replaces raw ANSI colors with
//! semantically meaningful colors that survive reclassification.
//!
//! State is per-pipe (each Terminal session keeps its own mode + cache + dirty
//! flag in its own `Classifier` instance, looked up by session name). All the
//! pattern-matching helpers below are pure functions on text bytes — only the
//! storage and the public API surface know about sessions.
//!
//! Two built-in modes:
//!   basic      — 7 tokens, works for any shell (default)
//!   claude_code — 25+ tokens for the Claude Code CLI

const std = @import("std");
const Color = @import("../layout.zig").Color;
const vterm_mod = @import("vterm.zig");

// ── Token vocabulary ────────────────────────────────────────────────

pub const Token = enum(u8) {
    // Basic classifier tokens (shell-generic)
    output,
    command,
    @"error",
    success,
    heading,
    separator,
    progress,
    // Claude Code conversation tokens
    user_prompt,
    user_text,
    assistant_text,
    thinking,
    thought_complete,
    tool,
    result,
    diff,
    // Claude Code chrome tokens
    banner,
    status_bar,
    box_drawing,
    input_border,
    input_zone,
    // Claude Code interactive tokens
    permission,
    menu_title,
    menu_option,
    menu_desc,
    hint,
    // Claude Code task tokens
    task_done,
    task_active,
    task_open,
    task_summary,
    // Fallback
    text,

    pub const count = @typeInfo(Token).@"enum".fields.len;
};

// ── Token → Color mapping ───────────────────────────────────────────

const rgb = Color.rgb;

pub fn tokenColor(token: Token) Color {
    return switch (token) {
        .output => rgb(226, 232, 240), // #e2e8f0
        .command => rgb(96, 165, 250), // #60a5fa
        .@"error" => rgb(248, 113, 113), // #f87171
        .success => rgb(74, 222, 128), // #4ade80
        .heading => rgb(226, 232, 240), // #e2e8f0
        .separator => rgb(51, 65, 81), // #334155
        .progress => rgb(249, 115, 22), // #f97316
        .user_prompt => rgb(96, 165, 250), // #60a5fa
        .user_text => rgb(226, 232, 240), // #e2e8f0
        .assistant_text => rgb(226, 232, 240), // #e2e8f0
        .thinking => rgb(167, 139, 250), // #a78bfa
        .thought_complete => rgb(148, 163, 184), // #94a3b8
        .tool => rgb(234, 179, 8), // #eab308
        .result => rgb(148, 163, 184), // #94a3b8
        .diff => rgb(74, 222, 128), // #4ade80
        .banner => rgb(148, 163, 184), // #94a3b8
        .status_bar => rgb(100, 116, 139), // #64748b
        .box_drawing => rgb(51, 65, 81), // #334155
        .input_border => rgb(51, 65, 81), // #334155
        .input_zone => rgb(226, 232, 240), // #e2e8f0
        .permission => rgb(249, 115, 22), // #f97316
        .menu_title => rgb(226, 232, 240), // #e2e8f0
        .menu_option => rgb(226, 232, 240), // #e2e8f0
        .menu_desc => rgb(148, 163, 184), // #94a3b8
        .hint => rgb(148, 163, 184), // #94a3b8
        .task_done => rgb(74, 222, 128), // #4ade80
        .task_active => rgb(249, 115, 22), // #f97316
        .task_open => rgb(148, 163, 184), // #94a3b8
        .task_summary => rgb(96, 165, 250), // #60a5fa
        .text => rgb(226, 232, 240), // #e2e8f0
    };
}

// ── Classifier mode ─────────────────────────────────────────────────

pub const Mode = enum { none, basic, claude_code, json };

// ── Per-pipe classifier state ───────────────────────────────────────

const MAX_ROWS: u16 = 256;

pub const Classifier = struct {
    row_cache: [MAX_ROWS]Token = [_]Token{.output} ** MAX_ROWS,
    dirty: bool = true,
    mode: Mode = .none,

    pub fn classifyAndCache(self: *Classifier, row: u16, text: []const u8, total_rows: u16) void {
        if (row >= MAX_ROWS) return;
        const prev: Token = if (row > 0) self.row_cache[row - 1] else .output;
        if (self.mode == .none or self.mode == .json) {
            self.row_cache[row] = .output;
            return;
        }
        var kind = switch (self.mode) {
            .none, .json => unreachable,
            .basic => classifyBasic(text, row, total_rows),
            .claude_code => classifyClaude(text, row, total_rows),
        };
        kind = refineAdjacency(kind, prev, text);
        self.row_cache[row] = kind;
    }
};

// ── Registry: one Classifier per session ────────────────────────────

const g_alloc = std.heap.c_allocator;
var g_classifiers: ?std.StringHashMap(*Classifier) = null;

fn ensureMap() *std.StringHashMap(*Classifier) {
    if (g_classifiers == null) {
        g_classifiers = std.StringHashMap(*Classifier).init(g_alloc);
    }
    return &g_classifiers.?;
}

/// Look up or create the classifier for `name`. Always succeeds (allocation
/// failure returns null but the call sites treat null defensively).
pub fn getOrCreate(name: []const u8) ?*Classifier {
    const map = ensureMap();
    if (map.get(name)) |c| return c;
    const c = g_alloc.create(Classifier) catch return null;
    c.* = .{};
    // Dupe the key separately so the classifier owns it.
    const key = g_alloc.dupe(u8, name) catch {
        g_alloc.destroy(c);
        return null;
    };
    map.put(key, c) catch {
        g_alloc.free(key);
        g_alloc.destroy(c);
        return null;
    };
    return c;
}

pub fn get(name: []const u8) ?*Classifier {
    if (g_classifiers == null) return null;
    return g_classifiers.?.get(name);
}

pub fn closeClassifier(name: []const u8) bool {
    if (g_classifiers == null) return false;
    const entry = g_classifiers.?.fetchRemove(name) orelse return false;
    g_alloc.free(entry.key);
    g_alloc.destroy(entry.value);
    return true;
}

// ── Public API — name-keyed ─────────────────────────────────────────

pub fn getModeByName(name: []const u8) Mode {
    if (get(name)) |c| return c.mode;
    return .none;
}

pub fn setModeByName(name: []const u8, mode: Mode) void {
    const c = getOrCreate(name) orelse return;
    if (mode != c.mode) {
        c.mode = mode;
        c.dirty = true;
    }
}

pub fn setRowTokenByName(name: []const u8, row: u16, token: Token) void {
    const c = getOrCreate(name) orelse return;
    if (row >= MAX_ROWS) return;
    c.row_cache[row] = token;
}

pub fn markDirtyByName(name: []const u8) void {
    const c = getOrCreate(name) orelse return;
    c.dirty = true;
}

pub fn isDirtyByName(name: []const u8) bool {
    if (get(name)) |c| return c.dirty;
    return false;
}

pub fn clearDirtyByName(name: []const u8) void {
    if (get(name)) |c| c.dirty = false;
}

pub fn getRowTokenByName(name: []const u8, row: u16) Token {
    if (get(name)) |c| {
        if (row >= MAX_ROWS) return .output;
        return c.row_cache[row];
    }
    return .output;
}

pub fn classifyAndCacheByName(name: []const u8, row: u16, text: []const u8, total_rows: u16) void {
    const c = getOrCreate(name) orelse return;
    c.classifyAndCache(row, text, total_rows);
}

pub fn isTurnStartByName(name: []const u8, kind: Token) bool {
    const mode = getModeByName(name);
    return switch (mode) {
        .none, .json => false,
        .basic => kind == .command,
        .claude_code => kind == .user_prompt,
    };
}

/// Map a token name string to the Token enum. Returns .output for unknown names.
pub fn tokenFromName(text: []const u8) Token {
    const fields = @typeInfo(Token).@"enum".fields;
    inline for (fields) |f| {
        if (std.mem.eql(u8, text, f.name)) return @enumFromInt(f.value);
    }
    return .output;
}

// ── Default-session helpers (legacy single-Terminal API) ────────────

pub fn getMode() Mode {
    return getModeByName(vterm_mod.DEFAULT_SESSION);
}

pub fn setMode(mode: Mode) void {
    setModeByName(vterm_mod.DEFAULT_SESSION, mode);
}

pub fn setRowToken(row: u16, token: Token) void {
    setRowTokenByName(vterm_mod.DEFAULT_SESSION, row, token);
}

pub fn markDirty() void {
    markDirtyByName(vterm_mod.DEFAULT_SESSION);
}

pub fn isDirty() bool {
    return isDirtyByName(vterm_mod.DEFAULT_SESSION);
}

pub fn clearDirty() void {
    clearDirtyByName(vterm_mod.DEFAULT_SESSION);
}

pub fn getRowToken(row: u16) Token {
    return getRowTokenByName(vterm_mod.DEFAULT_SESSION, row);
}

pub fn classifyAndCache(row: u16, text: []const u8, total_rows: u16) void {
    classifyAndCacheByName(vterm_mod.DEFAULT_SESSION, row, text, total_rows);
}

pub fn isTurnStart(kind: Token) bool {
    return isTurnStartByName(vterm_mod.DEFAULT_SESSION, kind);
}

// ── Legacy Idx wrappers ─────────────────────────────────────────────
//
// Remapped to "idx-<n>" pipe names, matching vterm.zig. The engine has
// been updated to call ByName directly; these stubs remain for any
// transitional caller still passing an integer.

var idx_name_buf: [vterm_mod.MAX_TERMINALS][8]u8 = undefined;

fn nameForIdx(idx: u8) []const u8 {
    const i = @min(idx, vterm_mod.MAX_TERMINALS - 1);
    const written = std.fmt.bufPrint(&idx_name_buf[i], "idx-{d}", .{i}) catch {
        idx_name_buf[i][0] = '0';
        return idx_name_buf[i][0..1];
    };
    return written;
}

pub fn getModeIdx(idx: u8) Mode {
    return getModeByName(nameForIdx(idx));
}
pub fn setModeIdx(idx: u8, mode: Mode) void {
    setModeByName(nameForIdx(idx), mode);
}
pub fn markDirtyIdx(idx: u8) void {
    markDirtyByName(nameForIdx(idx));
}
pub fn isDirtyIdx(idx: u8) bool {
    return isDirtyByName(nameForIdx(idx));
}
pub fn clearDirtyIdx(idx: u8) void {
    clearDirtyByName(nameForIdx(idx));
}
pub fn getRowTokenIdx(idx: u8, row: u16) Token {
    return getRowTokenByName(nameForIdx(idx), row);
}
pub fn classifyAndCacheIdx(idx: u8, row: u16, text: []const u8, total_rows: u16) void {
    classifyAndCacheByName(nameForIdx(idx), row, text, total_rows);
}
pub fn isTurnStartIdx(idx: u8, kind: Token) bool {
    return isTurnStartByName(nameForIdx(idx), kind);
}

// ── Basic classifier (port of classifiers/basic.lua) ────────────────

fn classifyBasic(text: []const u8, row: u16, total: u16) Token {
    _ = total;
    const stripped = std.mem.trim(u8, text, " \t");
    if (stripped.len == 0) return .output;

    // Separator: lines of ─ = - ~ * _
    if (isSepLine(stripped)) return .separator;

    // Error patterns
    if (startsCI(text, "error") or startsCI(text, "Error")) return .@"error";
    if (startsCI(text, "failed") or startsCI(text, "Failed")) return .@"error";
    if (startsTrimmed(text, "FAIL")) return .@"error";
    if (startsTrimmed(text, "panic:") or startsTrimmed(text, "fatal:")) return .@"error";
    if (contains(text, "\xe2\x9c\x97") or contains(text, "\xe2\x9c\x98")) return .@"error";

    // Success patterns
    if (startsCI(text, "done") or startsCI(text, "Done")) return .success;
    if (startsTrimmed(text, "OK") or startsTrimmed(text, "PASS")) return .success;
    if (startsCI(text, "success") or startsCI(text, "Success")) return .success;
    if (contains(text, "\xe2\x9c\x93") or contains(text, "\xe2\x9c\x94")) return .success;

    // Progress: contains percentage or ETA
    if (containsDigitPercent(text)) return .progress;
    if (contains(text, "ETA") or contains(text, "eta")) return .progress;

    // Command: shell prompt $ or > prefix
    if (matchPrompt(text)) return .command;

    // Heading: short capitalized lines
    if (row <= 3 and startsTrimmed(text, "# ")) return .heading;
    if (stripped.len < 60 and isUpperLine(stripped)) return .heading;

    return .output;
}

// ── Claude Code classifier (port of classifiers/claude_code.lua) ────

fn classifyClaude(text: []const u8, row: u16, total: u16) Token {
    const stripped = std.mem.trim(u8, text, " \t");
    if (stripped.len == 0) return .output;

    // Permission prompt
    if (contains(text, "Do you want to ") and contains(text, "?")) return .permission;

    // Numbered menu options
    if (matchNumberedOption(stripped)) return .menu_option;

    // Banner / version
    if (contains(text, "Claude Code v")) return .banner;
    if (row <= 5 and contains(text, "Claude Code")) return .banner;
    if (row <= 5 and (contains(text, "Opus ") or contains(text, "Sonnet ") or contains(text, "Haiku "))) return .banner;
    if (row <= 5 and contains(text, "~/")) return .banner;

    // Interactive menu elements
    if (contains(text, "to adjust") or contains(text, "\xe2\x86\x90 \xe2\x86\x92")) return .hint;
    if (contains(text, "Enter to confirm")) return .hint;

    // Status bar
    if (containsTokenCount(text)) return .status_bar;
    if (contains(text, "for shortcuts") or contains(text, "esc to interrupt")) return .status_bar;

    // Input area (bottom of terminal)
    if (row >= total -| 8) {
        if (contains(stripped, "\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80")) return .input_border;
        if (std.mem.eql(u8, stripped, "\xe2\x9d\xaf") or std.mem.eql(u8, stripped, ">")) return .input_zone;
        if (contains(text, "\xe2\x9d\xaf")) return .input_zone;
        if (text.len >= 2 and text[0] == '>' and text[1] == ' ') return .input_zone;
    }

    // User prompt: ❯ or > NOT at bottom
    if (contains(text, "\xe2\x9d\xaf") and !contains(text, "Imagining")) return .user_prompt;
    if (text.len >= 2 and text[0] == '>' and text[1] == ' ') return .user_prompt;

    // Thought complete: ✻
    if (contains(text, "\xe2\x9c\xbb")) return .thought_complete;

    // Task tokens
    if (contains(text, "\xe2\x9c\x94")) return .task_done;
    if (contains(text, "\xe2\x97\xbb")) return .task_open;
    if (contains(text, "\xe2\x80\xa6") and contains(text, "tokens")) return .task_active;
    if (matchTaskSummary(text)) return .task_summary;

    // Thinking
    if (contains(text, "Imagining") or contains(text, "Thinking")) return .thinking;

    // Plan mode
    if (contains(text, "Entered plan mode") or contains(text, "Exited plan mode")) return .banner;

    // Tool use: ● func() or • func()
    if (matchToolUse(text)) return .tool;

    // Diff lines
    if (text.len > 0 and (text[0] == '+' or text[0] == '-')) return .diff;

    // Result bracket: ⎿
    if (contains(text, "\xe2\x8e\xbf")) return .result;

    // Box drawing: ┌│└╭╰──
    if (isBoxDrawing(stripped)) return .box_drawing;

    // Error
    if (startsTrimmed(text, "Error:") or startsTrimmed(text, "error:")) return .@"error";

    return .text;
}

// ── Adjacency refinement ────────────────────────────────────────────

fn refineAdjacency(kind: Token, prev: Token, text: []const u8) Token {
    // text/output after user_prompt = user_text (multi-line input)
    if ((kind == .text or kind == .output) and (prev == .user_prompt or prev == .user_text)) {
        return .user_text;
    }
    // text after assistant-attributed tokens = assistant_text
    if ((kind == .text or kind == .output) and isAssistantPrev(prev)) {
        return .assistant_text;
    }
    // text after menu_option = menu_desc
    if ((kind == .text or kind == .output) and prev == .menu_option) {
        return .menu_desc;
    }
    // Footer hints
    if ((kind == .text or kind == .output) and
        (contains(text, "Enter to select") or contains(text, "Arrow keys") or
        contains(text, "Esc to cancel") or contains(text, "Type to search")))
    {
        return .hint;
    }
    return kind;
}

fn isAssistantPrev(prev: Token) bool {
    return prev == .tool or prev == .thinking or prev == .thought_complete or
        prev == .result or prev == .assistant_text or prev == .task_done or
        prev == .task_open or prev == .task_summary or prev == .task_active or
        prev == .diff;
}

// ── Pattern matching helpers ────────────────────────────────────────

fn contains(text: []const u8, needle: []const u8) bool {
    return std.mem.indexOf(u8, text, needle) != null;
}

fn startsTrimmed(text: []const u8, prefix: []const u8) bool {
    const trimmed = std.mem.trimStart(u8, text, " \t");
    return std.mem.startsWith(u8, trimmed, prefix);
}

fn startsCI(text: []const u8, prefix: []const u8) bool {
    const trimmed = std.mem.trimStart(u8, text, " \t");
    if (trimmed.len < prefix.len) return false;
    return std.mem.startsWith(u8, trimmed, prefix);
}

fn isSepLine(s: []const u8) bool {
    if (s.len < 3) return false;
    for (s) |ch| {
        if (ch != '-' and ch != '=' and ch != '~' and ch != '*' and ch != '_' and
            ch != 0xe2 and ch != 0x94 and ch != 0x80 and ch != 0x95 and
            ch != 0x8c and ch != 0x8d and ch != 0x84 and ch != 0x85 and
            ch != 0x88 and ch != 0x89 and ch != 0xad)
            return false;
    }
    return true;
}

fn matchPrompt(text: []const u8) bool {
    const t = std.mem.trimStart(u8, text, " \t");
    // $ command or > command
    if (t.len >= 2 and (t[0] == '$' or t[0] == '>') and t[1] == ' ') return true;
    // # command (root prompt)
    if (t.len >= 2 and t[0] == '#' and t[1] == ' ') return true;
    // user@host:~$
    if (contains(t, "@") and contains(t, "$")) return true;
    return false;
}

fn matchNumberedOption(s: []const u8) bool {
    var t = std.mem.trimStart(u8, s, " \t>");
    if (t.len < 3) return false;
    // Skip UTF-8 cursor indicators: ❯ (\xe2\x9d\xaf) and › (\xe2\x80\xba)
    const cursors = [_][]const u8{ "\xe2\x9d\xaf", "\xe2\x80\xba" };
    for (cursors) |cur| {
        if (std.mem.startsWith(u8, t, cur)) {
            t = std.mem.trimStart(u8, t[cur.len..], " ");
            break;
        }
    }
    if (t.len < 3) return false;
    // Check for digit followed by . and space
    if (t[0] >= '0' and t[0] <= '9') {
        var i: usize = 1;
        while (i < t.len and t[i] >= '0' and t[i] <= '9') i += 1;
        if (i < t.len and t[i] == '.' and i + 1 < t.len and t[i + 1] == ' ') return true;
    }
    return false;
}

fn matchToolUse(text: []const u8) bool {
    // ● func( or • func( or ◆ func(
    const bullets = [_][]const u8{ "\xe2\x97\x8f", "\xe2\x80\xa2", "\xe2\x97\x86" };
    for (bullets) |bullet| {
        if (std.mem.indexOf(u8, text, bullet)) |pos| {
            const after = text[pos + bullet.len ..];
            if (contains(after, "(")) return true;
        }
    }
    return false;
}

fn matchTaskSummary(text: []const u8) bool {
    // N task(s) (
    return containsDigitPercent(text) == false and contains(text, "task") and contains(text, "(");
}

fn isBoxDrawing(s: []const u8) bool {
    const markers = [_][]const u8{
        "\xe2\x94\x8c", "\xe2\x95\xad", "\xe2\x94\x82",
        "\xe2\x94\x94", "\xe2\x95\xb0", "\xe2\x94\x80\xe2\x94\x80",
        "\xe2\x95\x8c\xe2\x95\x8c",
    };
    for (markers) |m| {
        if (contains(s, m)) return true;
    }
    return false;
}

fn containsDigitPercent(text: []const u8) bool {
    // Check for N% pattern
    var i: usize = 0;
    while (i < text.len) : (i += 1) {
        if (text[i] >= '0' and text[i] <= '9') {
            var j = i + 1;
            while (j < text.len and text[j] >= '0' and text[j] <= '9') j += 1;
            if (j < text.len and text[j] == '%') return true;
        }
    }
    return false;
}

fn containsTokenCount(text: []const u8) bool {
    return contains(text, "tokens") and containsDigit(text);
}

fn containsDigit(text: []const u8) bool {
    for (text) |ch| {
        if (ch >= '0' and ch <= '9') return true;
    }
    return false;
}

fn isUpperLine(s: []const u8) bool {
    if (s.len == 0) return false;
    var has_alpha = false;
    for (s) |ch| {
        if (ch >= 'A' and ch <= 'Z') { has_alpha = true; continue; }
        if (ch == ' ' or ch == '-' or ch == '_' or ch == ':') continue;
        return false; // lowercase or other chars
    }
    return has_alpha;
}
