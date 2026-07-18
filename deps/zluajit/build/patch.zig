//! Small unified-diff patcher used while building LuaJIT's DynASM source.
//!
//! This file is both a build helper module and a standalone executable. The
//! executable is a normal Zig 0.16 root: process arguments and all file I/O
//! come from `std.process.Init` and are passed explicitly.

const std = @import("std");

const Allocator = std.mem.Allocator;
const File = std.Io.File;

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    const allocator = init.arena.allocator();
    const args = try init.minimal.args.toSlice(allocator);
    if (args.len != 4) return error.WrongNumberOfArguments;

    const source = try readPathAlloc(io, allocator, args[1]);
    const patch = try readPathAlloc(io, allocator, args[2]);
    const patched = try applyUnifiedDiff(allocator, source, patch);

    const output = try createPath(io, args[3]);
    defer output.close(io);
    try output.writeStreamingAll(io, patched);
}

fn openPath(io: std.Io, path: []const u8) !File {
    if (std.fs.path.isAbsolute(path)) {
        return std.Io.Dir.openFileAbsolute(io, path, .{});
    }
    return std.Io.Dir.cwd().openFile(io, path, .{});
}

fn createPath(io: std.Io, path: []const u8) !File {
    if (std.fs.path.isAbsolute(path)) {
        return std.Io.Dir.createFileAbsolute(io, path, .{ .truncate = true });
    }
    return std.Io.Dir.cwd().createFile(io, path, .{ .truncate = true });
}

fn readPathAlloc(io: std.Io, allocator: Allocator, path: []const u8) ![]u8 {
    var file = try openPath(io, path);
    defer file.close(io);

    var reader = file.reader(io, &.{});
    return reader.interface.allocRemaining(allocator, .unlimited) catch |err| switch (err) {
        error.ReadFailed => return reader.err orelse error.Unexpected,
        error.OutOfMemory, error.StreamTooLong => |e| return e,
    };
}

fn splitLines(allocator: Allocator, bytes: []const u8) ![]const []const u8 {
    var result: std.ArrayList([]const u8) = .empty;
    var start: usize = 0;
    while (std.mem.indexOfScalarPos(u8, bytes, start, '\n')) |end| {
        try result.append(allocator, bytes[start..end]);
        start = end + 1;
    }
    if (start < bytes.len) try result.append(allocator, bytes[start..]);
    return result.toOwnedSlice(allocator);
}

fn sourceStart(header: []const u8) !usize {
    if (!std.mem.startsWith(u8, header, "@@ -")) return error.InvalidPatch;
    const range_start = 4;
    const range_end = std.mem.indexOfScalarPos(u8, header, range_start, ' ') orelse
        return error.InvalidPatch;
    const range = header[range_start..range_end];
    const number = if (std.mem.indexOfScalar(u8, range, ',')) |comma|
        range[0..comma]
    else
        range;
    return std.fmt.parseInt(usize, number, 10) catch return error.InvalidPatch;
}

fn writeLine(writer: *std.Io.Writer, line: []const u8) !void {
    try writer.writeAll(line);
    try writer.writeByte('\n');
}

fn applyUnifiedDiff(allocator: Allocator, source: []const u8, patch: []const u8) ![]const u8 {
    const source_lines = try splitLines(allocator, source);
    defer allocator.free(source_lines);
    const patch_lines = try splitLines(allocator, patch);
    defer allocator.free(patch_lines);

    var output = std.Io.Writer.Allocating.init(allocator);
    errdefer output.deinit();
    const writer = &output.writer;
    var source_index: usize = 0;
    var patch_index: usize = 0;
    var saw_hunk = false;

    while (patch_index < patch_lines.len) {
        const header = patch_lines[patch_index];
        if (!std.mem.startsWith(u8, header, "@@")) {
            patch_index += 1;
            continue;
        }
        saw_hunk = true;

        const first_source_line = try sourceStart(header);
        const hunk_source_index = if (first_source_line == 0) 0 else first_source_line - 1;
        if (hunk_source_index < source_index or hunk_source_index > source_lines.len) {
            return error.InvalidPatch;
        }
        while (source_index < hunk_source_index) : (source_index += 1) {
            try writeLine(writer, source_lines[source_index]);
        }

        patch_index += 1;
        while (patch_index < patch_lines.len) : (patch_index += 1) {
            const diff_line = patch_lines[patch_index];
            if (std.mem.startsWith(u8, diff_line, "@@")) break;
            if (diff_line.len == 0) return error.InvalidPatch;

            const expected = diff_line[1..];
            switch (diff_line[0]) {
                ' ' => {
                    if (source_index >= source_lines.len or
                        !std.mem.eql(u8, source_lines[source_index], expected))
                    {
                        return error.PatchMismatch;
                    }
                    try writeLine(writer, source_lines[source_index]);
                    source_index += 1;
                },
                '-' => {
                    if (source_index >= source_lines.len or
                        !std.mem.eql(u8, source_lines[source_index], expected))
                    {
                        return error.PatchMismatch;
                    }
                    source_index += 1;
                },
                '+' => try writeLine(writer, expected),
                '\\' => {}, // Unified diff's "no newline" marker.
                else => return error.InvalidPatch,
            }
        }
    }

    if (!saw_hunk) return error.NoChunkData;
    while (source_index < source_lines.len) : (source_index += 1) {
        try writeLine(writer, source_lines[source_index]);
    }
    return try output.toOwnedSlice();
}

test "applies a unified diff through the native writer" {
    const source =
        \\one
        \\two
        \\three
        \\
    ;
    const patch =
        \\--- a/example
        \\+++ b/example
        \\@@ -1,3 +1,3 @@
        \\ one
        \\-two
        \\+second
        \\ three
        \\
    ;
    const expected =
        \\one
        \\second
        \\three
        \\
    ;
    const actual = try applyUnifiedDiff(std.testing.allocator, source, patch);
    defer std.testing.allocator.free(actual);
    try std.testing.expectEqualStrings(expected, actual);
}

// Build graph integration.

const Build = std.Build;
const Step = std.Build.Step;

const PatchFile = struct {
    run: *Step.Run,
    output: Build.LazyPath,
};

pub fn applyPatchToFile(
    b: *Build,
    target: Build.ResolvedTarget,
    file: Build.LazyPath,
    patch_file: Build.LazyPath,
    output_file: []const u8,
) PatchFile {
    const patch = b.addExecutable(.{
        .name = "patch",
        .root_module = b.createModule(.{
            .root_source_file = b.path("build/patch.zig"),
            .target = target,
        }),
    });

    const patch_run = b.addRunArtifact(patch);
    patch_run.addFileArg(file);
    patch_run.addFileArg(patch_file);

    return .{
        .run = patch_run,
        .output = patch_run.addOutputFileArg(output_file),
    };
}
