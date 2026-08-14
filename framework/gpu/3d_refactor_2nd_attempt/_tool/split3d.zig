//! split3d.zig — deterministic, verbatim splitter for framework/gpu/3d.zig (req_4375).
//!
//! This tool is the refactor: the split files are GENERATED from 3d.zig by byte
//! slicing, never hand-copied, so the decl bodies are verbatim by construction.
//! The only bytes ever inserted are:
//!   - "pub "  before top-level decls that weren't pub (cross-file visibility)
//!   - "z3d."  before identifier references to moved top-level decls in part files
//! Nothing is deleted, reordered inside a decl, or rewritten.
//!
//! Layout produced:
//!   - part files: replicated import header (paths adjusted one dir deeper) +
//!     their assigned decls, cross-refs qualified through the orchestrator.
//!   - 3d.zig (the orchestrator/root): original doc header + import header +
//!     ALL top-level `var` state (so @This() reflection over the g_* globals in
//!     the DocState park/restore trio keeps working) + pinned decls + pub alias
//!     per moved decl.
//!
//! Modes:
//!   zig run split3d.zig -- inventory <src>
//!   zig run split3d.zig -- emit <src> <manifest> <outdir>
//!
//! Manifest grammar (line oriented, # comments):
//!   header_end_line <n>       top-level decls starting at line <= n are the
//!                             shared import header, replicated into every file
//!   file <name.zig> <line>    decls from <line> (until next file entry) go there
//!   pin <start> <end>         decls whose first line falls in [start,end] go to root

const std = @import("std");
const Ast = std.zig.Ast;

const Insertion = struct { offset: usize, text: []const u8 };

const Decl = struct {
    node: Ast.Node.Index,
    name: ?[]const u8, // null for comptime/test blocks
    kind: Kind,
    is_pub: bool,
    first_tok_off: usize, // offset of the decl's first real token ("pub " insert point)
    piece_start: usize, // partitioned verbatim range [piece_start, piece_end)
    piece_end: usize,
    line_start: usize, // 1-based line of the first token
    target: usize = 0, // index into files list; ROOT_TARGET = root

    const Kind = enum { variable, constant, function, comptime_block, other };
};

const ROOT_TARGET: usize = std.math.maxInt(usize);

const ManifestFile = struct { name: []const u8, start_line: usize };

const Manifest = struct {
    header_end_line: usize,
    files: std.ArrayList(ManifestFile),
    pins: std.ArrayList([2]usize),
};

const Scope = struct { start: usize, end: usize, names: std.StringHashMap(void) };

pub fn main(init: std.process.Init) !void {
    const gpa = init.arena.allocator(); // tool is one-shot; arena frees on exit
    const io = init.io;

    var args = std.process.Args.Iterator.init(init.minimal.args);
    _ = args.next(); // argv0
    const mode = args.next() orelse fail("usage: split3d inventory|emit <src> [manifest outdir]", .{});
    const src_path = args.next() orelse fail("missing <src>", .{});

    const source = try std.Io.Dir.cwd().readFileAllocOptions(io, src_path, gpa, .unlimited, .of(u8), 0);

    var ast = try Ast.parse(gpa, source, .zig);
    if (ast.errors.len != 0) fail("source has parse errors — refusing to split", .{});

    // ── line table ──
    var line_starts: std.ArrayList(usize) = .empty;
    try line_starts.append(gpa, 0);
    for (source, 0..) |c, i| if (c == '\n') try line_starts.append(gpa, i + 1);
    const lineOf = struct {
        fn f(starts: []const usize, off: usize) usize {
            var lo: usize = 0;
            var hi: usize = starts.len;
            while (lo + 1 < hi) {
                const mid = (lo + hi) / 2;
                if (starts[mid] <= off) lo = mid else hi = mid;
            }
            return lo + 1; // 1-based
        }
    }.f;

    // ── collect top-level decls in source order ──
    var decls: std.ArrayList(Decl) = .empty;
    for (ast.rootDecls()) |n| {
        const first_tok = ast.firstToken(n);
        const last_tok = ast.lastToken(n);
        const start_off = ast.tokenStart(first_tok);
        var end_off = ast.tokenStart(last_tok) + ast.tokenSlice(last_tok).len;
        // extend through end of line (trailing same-line comment stays attached)
        while (end_off < source.len and source[end_off] != '\n') end_off += 1;
        if (end_off < source.len) end_off += 1;

        var d: Decl = .{
            .node = n,
            .name = null,
            .kind = .other,
            .is_pub = false,
            .first_tok_off = start_off,
            .piece_start = 0,
            .piece_end = end_off,
            .line_start = lineOf(line_starts.items, start_off),
        };
        switch (ast.nodeTag(n)) {
            .simple_var_decl, .global_var_decl, .local_var_decl, .aligned_var_decl => {
                const vd = ast.fullVarDecl(n).?;
                d.name = ast.tokenSlice(vd.ast.mut_token + 1);
                d.kind = if (std.mem.eql(u8, ast.tokenSlice(vd.ast.mut_token), "var")) .variable else .constant;
                d.is_pub = vd.visib_token != null;
            },
            .fn_decl => {
                const proto = ast.nodeData(n).node_and_node[0];
                var buf: [1]Ast.Node.Index = undefined;
                const fp = ast.fullFnProto(&buf, proto).?;
                d.name = ast.tokenSlice(fp.name_token.?);
                d.kind = .function;
                d.is_pub = fp.visib_token != null;
            },
            .@"comptime" => d.kind = .comptime_block,
            else => fail("unhandled top-level decl tag {s} at line {d}", .{ @tagName(ast.nodeTag(n)), d.line_start }),
        }
        try decls.append(gpa, d);
    }

    if (std.mem.eql(u8, mode, "inventory")) {
        var out_buf: [4096]u8 = undefined;
        var stdout = std.Io.File.stdout().writer(io, &out_buf);
        const w = &stdout.interface;
        for (decls.items) |d| {
            const end_line = lineOf(line_starts.items, d.piece_end -| 1);
            try w.print("{d}\t{d}\t{s}\t{s}\t{s}\n", .{
                d.line_start,                  end_line,
                @tagName(d.kind),              if (d.is_pub) "pub" else "-",
                d.name orelse "(anon)",
            });
        }
        try w.flush();
        return;
    }
    if (!std.mem.eql(u8, mode, "emit")) fail("unknown mode {s}", .{mode});
    const manifest_path = args.next() orelse fail("missing <manifest>", .{});
    const out_dir_path = args.next() orelse fail("missing <outdir>", .{});

    // ── manifest ──
    var manifest: Manifest = .{ .header_end_line = 0, .files = .empty, .pins = .empty };
    {
        const mtext = try std.Io.Dir.cwd().readFileAlloc(io, manifest_path, gpa, .unlimited);
        var lines = std.mem.tokenizeScalar(u8, mtext, '\n');
        while (lines.next()) |raw| {
            const line = std.mem.trim(u8, raw, " \t\r");
            if (line.len == 0 or line[0] == '#') continue;
            var parts = std.mem.tokenizeScalar(u8, line, ' ');
            const verb = parts.next().?;
            if (std.mem.eql(u8, verb, "header_end_line")) {
                manifest.header_end_line = try std.fmt.parseInt(usize, parts.next().?, 10);
            } else if (std.mem.eql(u8, verb, "file")) {
                const name = parts.next().?;
                const start = try std.fmt.parseInt(usize, parts.next().?, 10);
                try manifest.files.append(gpa, .{ .name = name, .start_line = start });
            } else if (std.mem.eql(u8, verb, "pin")) {
                const a = try std.fmt.parseInt(usize, parts.next().?, 10);
                const b = try std.fmt.parseInt(usize, parts.next().?, 10);
                try manifest.pins.append(gpa, .{ a, b });
            } else fail("bad manifest verb: {s}", .{verb});
        }
    }
    if (manifest.header_end_line == 0 or manifest.files.items.len == 0)
        fail("manifest needs header_end_line and at least one file", .{});

    // ── split header from body; partition body bytes among decls ──
    var header_count: usize = 0;
    for (decls.items) |d| {
        if (d.line_start <= manifest.header_end_line) header_count += 1 else break;
    }
    if (header_count == 0) fail("no header decls found", .{});
    const header_first_off = decls.items[0].first_tok_off; // skips the //! doc block
    const header_end_off = decls.items[header_count - 1].piece_end;
    const doc_block = source[0..header_first_off]; // //! comment lines
    const header_block = source[header_first_off..header_end_off];

    const body = decls.items[header_count..];
    {
        var prev_end = header_end_off;
        for (body) |*d| {
            d.piece_start = prev_end;
            prev_end = d.piece_end;
        }
        if (prev_end != source.len) fail("partition does not reach EOF ({d} != {d})", .{ prev_end, source.len });
    }

    // ── assign targets ──
    for (body) |*d| {
        d.target = blk: {
            if (d.kind == .variable) break :blk ROOT_TARGET;
            for (manifest.pins.items) |p| {
                if (d.line_start >= p[0] and d.line_start <= p[1]) break :blk ROOT_TARGET;
            }
            var chosen: ?usize = null;
            for (manifest.files.items, 0..) |f, i| {
                if (f.start_line <= d.line_start) chosen = i;
            }
            break :blk chosen orelse fail("decl at line {d} precedes every manifest file range", .{d.line_start});
        };
    }

    // ── moved-name set (names needing z3d. qualification in parts) ──
    var moved: std.StringHashMap(void) = .init(gpa);
    for (body) |d| if (d.name) |nm| try moved.put(nm, {});

    // ── insertion list ("pub " / "z3d.") filled below ──
    var insertions: std.ArrayList(Insertion) = .empty;

    // ── skip-token set: definition-site name tokens anywhere in the file ──
    var skip_tokens: std.AutoHashMap(Ast.TokenIndex, void) = .init(gpa);
    var container_scopes: std.ArrayList(Scope) = .empty;
    {
        var i: u32 = 0;
        while (i < ast.nodes.len) : (i += 1) {
            const n: Ast.Node.Index = @enumFromInt(i);
            if (n == .root) continue;
            switch (ast.nodeTag(n)) {
                .simple_var_decl, .global_var_decl, .local_var_decl, .aligned_var_decl => {
                    const vd = ast.fullVarDecl(n).?;
                    try skip_tokens.put(vd.ast.mut_token + 1, {});
                },
                .fn_proto, .fn_proto_multi, .fn_proto_one, .fn_proto_simple => {
                    var buf: [1]Ast.Node.Index = undefined;
                    const fp = ast.fullFnProto(&buf, n).?;
                    if (fp.name_token) |t| try skip_tokens.put(t, {});
                },
                .container_field_init, .container_field_align, .container_field => {
                    const cf = ast.fullContainerField(n).?;
                    try skip_tokens.put(cf.ast.main_token, {});
                },
                .error_set_decl => {
                    var t = ast.firstToken(n);
                    const last = ast.lastToken(n);
                    while (t <= last) : (t += 1) {
                        if (ast.tokenTag(t) == .identifier) try skip_tokens.put(t, {});
                    }
                },
                .container_decl,        .container_decl_trailing,
                .container_decl_two,    .container_decl_two_trailing,
                .container_decl_arg,    .container_decl_arg_trailing,
                .tagged_union,          .tagged_union_trailing,
                .tagged_union_two,      .tagged_union_two_trailing,
                .tagged_union_enum_tag, .tagged_union_enum_tag_trailing,
                => {
                    var buf: [2]Ast.Node.Index = undefined;
                    const cd = ast.fullContainerDecl(&buf, n).?;
                    var scope: Scope = .{
                        .start = ast.tokenStart(ast.firstToken(n)),
                        .end = ast.tokenStart(ast.lastToken(n)),
                        .names = .init(gpa),
                    };
                    for (cd.ast.members) |m| {
                        switch (ast.nodeTag(m)) {
                            .simple_var_decl, .global_var_decl, .local_var_decl, .aligned_var_decl => {
                                const vd = ast.fullVarDecl(m).?;
                                try scope.names.put(ast.tokenSlice(vd.ast.mut_token + 1), {});
                                // container members must be pub once callers live in other files
                                if (vd.visib_token == null)
                                    try insertions.append(gpa, .{ .offset = ast.tokenStart(ast.firstToken(m)), .text = "pub " });
                            },
                            .fn_decl => {
                                const proto = ast.nodeData(m).node_and_node[0];
                                var fbuf: [1]Ast.Node.Index = undefined;
                                const fp = ast.fullFnProto(&fbuf, proto).?;
                                if (fp.name_token) |t| try scope.names.put(ast.tokenSlice(t), {});
                                if (fp.visib_token == null)
                                    try insertions.append(gpa, .{ .offset = ast.tokenStart(ast.firstToken(m)), .text = "pub " });
                            },
                            else => {},
                        }
                    }
                    if (scope.names.count() == 0) scope.names.deinit() else try container_scopes.append(gpa, scope);
                },
                else => {},
            }
        }
    }
    // labels: `name: {` / `name: while|for|switch|inline` and `break :name` / `continue :name`
    {
        const ntok: u32 = @intCast(ast.tokens.len);
        var t: u32 = 0;
        while (t + 2 < ntok) : (t += 1) {
            if (ast.tokenTag(t) == .identifier and ast.tokenTag(t + 1) == .colon) {
                switch (ast.tokenTag(t + 2)) {
                    .l_brace, .keyword_while, .keyword_for, .keyword_switch, .keyword_inline => try skip_tokens.put(t, {}),
                    else => {},
                }
            }
            if ((ast.tokenTag(t) == .keyword_break or ast.tokenTag(t) == .keyword_continue) and
                ast.tokenTag(t + 1) == .colon and ast.tokenTag(t + 2) == .identifier)
                try skip_tokens.put(t + 2, {});
        }
    }

    // ── plan insertions per decl ──
    // "pub " for non-pub top-level decls (root + parts alike);
    // "z3d." for moved-name references, in part-targeted decls only.
    for (body) |d| {
        if (!d.is_pub and d.kind != .comptime_block)
            try insertions.append(gpa, .{ .offset = d.first_tok_off, .text = "pub " });
        if (d.target == ROOT_TARGET) continue; // root refs stay bare
        const first_tok = ast.firstToken(d.node);
        const last_tok = ast.lastToken(d.node);
        var t = first_tok;
        while (t <= last_tok) : (t += 1) {
            if (ast.tokenTag(t) != .identifier) continue;
            const slice = ast.tokenSlice(t);
            if (!moved.contains(slice)) continue;
            if (skip_tokens.contains(t)) continue;
            if (t > 0 and ast.tokenTag(t - 1) == .period) continue;
            const off = ast.tokenStart(t);
            var shadowed = false;
            for (container_scopes.items) |sc| {
                if (off > sc.start and off < sc.end and sc.names.contains(slice)) {
                    shadowed = true;
                    break;
                }
            }
            if (shadowed) continue;
            try insertions.append(gpa, .{ .offset = off, .text = "z3d." });
        }
    }
    std.mem.sort(Insertion, insertions.items, {}, struct {
        fn lt(_: void, a: Insertion, b: Insertion) bool {
            return a.offset < b.offset;
        }
    }.lt);

    // ── adjusted header: sibling imports gain "../", parent imports gain another "../" ──
    var adj_header: std.ArrayList(u8) = .empty;
    {
        var rest = header_block;
        while (std.mem.indexOf(u8, rest, "@import(\"")) |at| {
            const pre = rest[0 .. at + "@import(\"".len];
            try adj_header.appendSlice(gpa, pre);
            rest = rest[pre.len..];
            const close = std.mem.indexOfScalar(u8, rest, '"').?;
            const path = rest[0..close];
            if (std.mem.endsWith(u8, path, ".zig")) {
                try adj_header.appendSlice(gpa, "../");
                try adj_header.appendSlice(gpa, path);
            } else {
                try adj_header.appendSlice(gpa, path); // module import: std, wgpu, build_options…
            }
            rest = rest[close..];
        }
        try adj_header.appendSlice(gpa, rest);
    }

    // ── emit ──
    const out_dir = try std.Io.Dir.cwd().createDirPathOpen(io, out_dir_path, .{});
    var emitted_bytes: usize = 0;

    const applyPiece = struct {
        fn f(alloc: std.mem.Allocator, out: *std.ArrayList(u8), src: []const u8, ins: []const Insertion, from: usize, to: usize) !void {
            var cursor = from;
            for (ins) |in| {
                if (in.offset < from or in.offset >= to) continue;
                try out.appendSlice(alloc, src[cursor..in.offset]);
                try out.appendSlice(alloc, in.text);
                cursor = in.offset;
            }
            try out.appendSlice(alloc, src[cursor..to]);
        }
    }.f;

    var rep_w: std.Io.Writer.Allocating = .init(gpa);

    for (manifest.files.items, 0..) |f, fi| {
        var out: std.ArrayList(u8) = .empty;
        try out.appendSlice(gpa, "//! ");
        try out.appendSlice(gpa, f.name);
        try out.appendSlice(gpa, " — split verbatim from framework/gpu/3d.zig (req_4375).\n//! Generated by _tool/split3d.zig — edit 3d.zig's successor here, regenerate only from the manifest.\n//! Cross-file references are qualified through the orchestrator (`z3d`).\n\n");
        try out.appendSlice(gpa, adj_header.items);
        try out.appendSlice(gpa, "\nconst z3d = @import(\"3d.zig\");\n");
        var count: usize = 0;
        for (body) |d| {
            if (d.target != fi) continue;
            try applyPiece(gpa, &out, source, insertions.items, d.piece_start, d.piece_end);
            emitted_bytes += d.piece_end - d.piece_start;
            count += 1;
        }
        if (count == 0) fail("manifest file {s} received no decls", .{f.name});
        try out_dir.writeFile(io, .{ .sub_path = f.name, .data = out.items });
        try rep_w.writer.print("{s}: {d} decls\n", .{ f.name, count });
    }

    // root/orchestrator
    {
        var out: std.ArrayList(u8) = .empty;
        try out.appendSlice(gpa, doc_block);
        try out.appendSlice(gpa, "//!\n//! Orchestrator of the verbatim split (req_4375): owns every top-level `var`\n//! (module state — including the DocState @This() reflection set) and re-exports\n//! each part's decls under the original names. Generated by _tool/split3d.zig.\n\n");
        try out.appendSlice(gpa, adj_header.items);
        try out.appendSlice(gpa, "\n");
        var pinned_count: usize = 0;
        for (body) |d| {
            if (d.target != ROOT_TARGET) continue;
            try applyPiece(gpa, &out, source, insertions.items, d.piece_start, d.piece_end);
            emitted_bytes += d.piece_end - d.piece_start;
            pinned_count += 1;
        }
        try out.appendSlice(gpa, "\n// ── re-exports: every moved decl under its original name ──\n");
        var alias_count: usize = 0;
        for (body) |d| {
            if (d.target == ROOT_TARGET or d.name == null) continue;
            const fname = manifest.files.items[d.target].name;
            try out.appendSlice(gpa, "pub const ");
            try out.appendSlice(gpa, d.name.?);
            try out.appendSlice(gpa, " = @import(\"");
            try out.appendSlice(gpa, fname);
            try out.appendSlice(gpa, "\").");
            try out.appendSlice(gpa, d.name.?);
            try out.appendSlice(gpa, ";\n");
            alias_count += 1;
        }
        try out.appendSlice(gpa, "\n// Force analysis of every part so their comptime layout assertions keep firing\n// exactly as they did when the file was one unit.\ncomptime {\n");
        for (manifest.files.items) |f| {
            try out.appendSlice(gpa, "    _ = @import(\"");
            try out.appendSlice(gpa, f.name);
            try out.appendSlice(gpa, "\");\n");
        }
        try out.appendSlice(gpa, "}\n");
        try out_dir.writeFile(io, .{ .sub_path = "3d.zig", .data = out.items });
        try rep_w.writer.print("3d.zig (root): {d} pinned decls (vars + pins), {d} aliases\n", .{ pinned_count, alias_count });
    }

    // ── accounting: every body byte emitted exactly once ──
    const body_bytes = source.len - header_end_off;
    if (emitted_bytes != body_bytes)
        fail("accounting FAILED: emitted {d} body bytes, source has {d}", .{ emitted_bytes, body_bytes });
    try rep_w.writer.print("accounting OK: {d} body bytes emitted exactly once across {d} decls; {d} insertions\n", .{ emitted_bytes, body.len, insertions.items.len });

    var out_buf: [4096]u8 = undefined;
    var stdout = std.Io.File.stdout().writer(io, &out_buf);
    try stdout.interface.writeAll(rep_w.written());
    try stdout.interface.flush();
}

fn fail(comptime fmt: []const u8, args: anytype) noreturn {
    std.debug.print("split3d: " ++ fmt ++ "\n", args);
    std.process.exit(1);
}
