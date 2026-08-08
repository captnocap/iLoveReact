//! framework/vcs/lore.zig — Zig binding for liblore, the Lore VCS C API.
//!
//! Lore (github.com/EpicGames/lore) versions the game's models. This module is the ONLY
//! place that talks to liblore; everything above it works in Zig types.
//!
//! Why this is a Zig system and not a JS one: CLAUDE.md's rule is that a capability lives
//! where the data lives. The authoritative mesh state is the live native session in
//! framework/gpu — never the JS side, and never the on-disk file. A snapshot has to read
//! that session directly, so the VCS binding sits next to it.
//!
//! ## Types come from the header, never from here
//!
//! Every struct layout and enum value is taken from the vendored `deps/lore/include/lore.h`
//! via @cImport, the same way framework/assistant takes llama.cpp's. This is not a style
//! preference. A first pass at this file hand-wrote the externs and got three things wrong
//! in a way that compiled cleanly and would have failed at runtime:
//!
//!   * `lore_error_event_data_t` was assumed to be `{ tag, message }`; it is actually
//!     `{ uint32_t error_type; lore_string_t error_inner; }`, so the message would have
//!     been read from the wrong offset.
//!   * `lore_file_stage_args_t` was assumed to take one string; it takes a string ARRAY
//!     plus a `case_change` field that did not exist in the hand-written version.
//!   * The event tag constants were invented. They are auto-numbered from a ~200-entry
//!     enum and none of the guesses lined up.
//!
//! Lore is pre-1.0 and says outright that "interfaces, on-disk formats, and APIs may change
//! between releases". A hand-maintained mirror of its ABI would rot silently on the next
//! bump; @cImport turns that same change into a compile error.
//!
//! ## The C API's shape
//!
//! Every call takes `lore_global_args_t` (repository path, identity, offline flag) plus a
//! per-call args struct, and reports results by invoking an event CALLBACK — there are no
//! return values beyond an int32 status. So each wrapper here:
//!
//!   1. builds a collector on the stack,
//!   2. passes its address as the u64 `user_context`,
//!   3. lets a `callconv(.c)` trampoline copy matching events into it.
//!
//! The vendored header is explicit that callbacks run on a liblore worker thread, not the
//! calling thread. The non-`_async` entry points used here block until their COMPLETE/END
//! stream has finished, so a stack collector still outlives every callback. Do NOT reuse
//! the pattern with the `_async` variants: those return before events arrive, so both the
//! collector and every argument/string it references must move to owned heap storage.
//!
//! Strings handed BACK by an event point into liblore-owned memory valid only for the
//! duration of that callback, so every collector copies what it keeps.

const std = @import("std");
const log = @import("../diag/log.zig");

pub const c = @cImport({
    @cInclude("lore.h");
});

// ── string helpers ───────────────────────────────────────────────────────────────────

/// `lore_string_t` is (ptr, len) and is NOT null-terminated, so Zig slices map onto it
/// exactly — nothing here allocates just to add a sentinel.
pub fn str(slice: []const u8) c.lore_string_t {
    return .{ .string = slice.ptr, .length = slice.len };
}

pub const empty_str: c.lore_string_t = .{ .string = null, .length = 0 };

/// Borrowed view of a string owned by liblore. Only valid inside the callback that got it.
pub fn strSlice(s: c.lore_string_t) []const u8 {
    const ptr = s.string orelse return &.{};
    return ptr[0..s.length];
}

// ── globals ──────────────────────────────────────────────────────────────────────────

/// Build the per-call globals every liblore entry point needs.
///
/// `offline` is 1 deliberately. Staging and committing are local operations in Lore, and
/// the panic-snapshot path must not be blockable by something outside this process — a
/// server that is down is exactly when you most need the snapshot to work. Pushing is a
/// separate, later step that is allowed to fail.
///
/// The checkout path must be absolute. Lore's verbs do not resolve a relative repository
/// path and a relative working directory consistently: repository operations use the former
/// while file operations use the latter. Supplying one canonical absolute checkout path for
/// both fields gives every verb the same root and prevents accidental `path/path` resolution.
pub fn globals(repository_path: []const u8, identity: []const u8) error{RepositoryPathNotAbsolute}!c.lore_global_args_t {
    if (!std.fs.path.isAbsolute(repository_path)) return error.RepositoryPathNotAbsolute;
    var g = std.mem.zeroes(c.lore_global_args_t);
    g.repository_path = str(repository_path);
    g.working_directory = str(repository_path);
    g.identity = identity_or_empty(identity);
    g.offline = 1;
    return g;
}

fn identity_or_empty(identity: []const u8) c.lore_string_t {
    return if (identity.len == 0) empty_str else str(identity);
}

// ── error collection ─────────────────────────────────────────────────────────────────

/// Records whether an error event arrived and keeps the FIRST error message, which is the
/// one that explains the failure — later events are usually knock-on noise.
pub const StatusCollector = struct {
    failed: bool = false,
    error_event_seen: bool = false,
    error_type: u32 = 0,
    complete_seen: bool = false,
    end_seen: bool = false,
    complete_status: i32 = 0,
    complete_error_code: i32 = 0,
    message_len: usize = 0,
    message_buf: [512]u8 = undefined,

    pub fn message(self: *const StatusCollector) []const u8 {
        return self.message_buf[0..self.message_len];
    }

    pub fn callback(self: *StatusCollector) c.lore_event_callback_config_t {
        return .{ .user_context = @intFromPtr(self), .func = trampoline };
    }

    pub fn finish(self: *const StatusCollector, return_status: i32) Error!void {
        if (return_status != 0 or self.failed or self.complete_status != 0)
            return error.LoreCallFailed;
        if (!self.complete_seen or !self.end_seen) return error.LoreIncomplete;
    }

    fn captureMessage(self: *StatusCollector, text: []const u8) void {
        if (self.message_len != 0) return;
        const take = @min(text.len, self.message_buf.len);
        @memcpy(self.message_buf[0..take], text[0..take]);
        self.message_len = take;
    }

    fn trampoline(event: [*c]const c.lore_event_t, user_context: u64) callconv(.c) void {
        const self: *StatusCollector = @ptrFromInt(user_context);
        const ev = event orelse return;
        self.observe(ev);
    }

    fn observe(self: *StatusCollector, ev: *const c.lore_event_t) void {
        switch (ev.*.tag) {
            c.LORE_EVENT_ERROR => {
                // Lore documents ERROR as a non-fatal diagnostic event. The operation's
                // actual success contract is the direct return plus COMPLETE.status; an
                // ERROR event alone must not turn a successful history/search into failure.
                self.error_event_seen = true;
                // Field names come from the header's union member, so a rename upstream is
                // a compile error rather than a wrong read.
                const payload = ev.*.unnamed_0.@"error";
                self.error_type = payload.error_type;
                self.captureMessage(strSlice(payload.error_inner));
            },
            c.LORE_EVENT_COMPLETE => {
                const payload = ev.*.unnamed_0.complete;
                self.complete_seen = true;
                self.complete_status = payload.status;
                self.complete_error_code = payload.@"error".error_code;
                if (payload.status != 0) self.failed = true;
                self.captureMessage(strSlice(payload.@"error".message));
            },
            c.LORE_EVENT_END => self.end_seen = true,
            else => {},
        }
    }
};

// ── public surface ───────────────────────────────────────────────────────────────────

pub const Error = error{ LoreCallFailed, LoreIncomplete, LoreUnavailable, MissingResult, RepositoryPathNotAbsolute, UnsupportedMetadataType } || std.mem.Allocator.Error;

pub const Hash = [32]u8;
pub const Identifier = [16]u8;

pub const Address = struct {
    hash: Hash,
    context: Identifier,
};

pub const MetadataFormat = enum {
    binary,
    numeric,
    string,

    fn toC(self: MetadataFormat) c.lore_metadata_type_t {
        return switch (self) {
            .binary => c.LORE_METADATA_TYPE_BINARY,
            .numeric => c.LORE_METADATA_TYPE_NUMERIC,
            .string => c.LORE_METADATA_TYPE_STRING,
        };
    }
};

/// The C setters take every value as bytes plus a separate format tag. The header does not
/// specify the byte encoding for numeric writes, so this binding deliberately keeps values
/// opaque and does not invent one.
pub const MetadataWrite = struct {
    key: []const u8,
    value: []const u8,
    format: MetadataFormat,
};

pub const MetadataValue = union(enum) {
    address: Address,
    boolean: bool,
    binary: []u8,
    context: Identifier,
    hash: Hash,
    numeric: u64,
    string: []u8,

    pub fn deinit(self: *MetadataValue, allocator: std.mem.Allocator) void {
        switch (self.*) {
            .binary => |bytes| allocator.free(bytes),
            .string => |text| allocator.free(text),
            else => {},
        }
        self.* = .{ .numeric = 0 };
    }
};

pub const MetadataEntry = struct {
    key: []u8,
    value: MetadataValue,

    pub fn deinit(self: *MetadataEntry, allocator: std.mem.Allocator) void {
        allocator.free(self.key);
        self.value.deinit(allocator);
        self.* = undefined;
    }
};

fn hashValue(value: c.lore_hash_t) Hash {
    return value.data;
}

fn repositoryId(value: c.lore_repository_id_t) Identifier {
    return value.data;
}

fn branchId(value: c.lore_branch_id_t) Identifier {
    return value.data;
}

fn addressValue(value: c.lore_address_t) Address {
    return .{ .hash = hashValue(value.hash), .context = value.context.data };
}

fn stringArray(values: []const c.lore_string_t) c.lore_string_array_t {
    return .{ .ptr = if (values.len == 0) null else values.ptr, .count = values.len };
}

fn metadataFormatArray(values: []const c.lore_metadata_type_t) c.lore_metadata_type_array_t {
    return .{ .ptr = if (values.len == 0) null else values.ptr, .count = values.len };
}

fn uint32Array(values: []const u32) c.lore_uint32_array_t {
    return .{ .ptr = if (values.len == 0) null else values.ptr, .count = values.len };
}

fn makeStrings(allocator: std.mem.Allocator, values: []const []const u8) Error![]c.lore_string_t {
    const out = try allocator.alloc(c.lore_string_t, values.len);
    for (values, out) |value, *item| item.* = str(value);
    return out;
}

fn finishCall(operation: []const u8, status: *const StatusCollector, return_status: i32) Error!void {
    status.finish(return_status) catch |err| {
        log.print("[lore] {s} failed return={} complete={} error={} message='{s}'\n", .{
            operation,
            return_status,
            status.complete_status,
            status.complete_error_code,
            status.message(),
        });
        return err;
    };
}

fn copyMetadataValue(allocator: std.mem.Allocator, value: c.lore_metadata_t) Error!MetadataValue {
    return switch (value.tag) {
        c.LORE_METADATA_ADDRESS => .{ .address = addressValue(value.unnamed_0.address) },
        c.LORE_METADATA_BOOLEAN => .{ .boolean = value.unnamed_0.boolean != 0 },
        c.LORE_METADATA_BINARY => blk: {
            const binary = value.unnamed_0.binary;
            const ptr: [*]const u8 = @ptrCast(binary.payload orelse break :blk .{ .binary = try allocator.alloc(u8, 0) });
            break :blk .{ .binary = try allocator.dupe(u8, ptr[0..binary.length]) };
        },
        c.LORE_METADATA_CONTEXT => .{ .context = value.unnamed_0.context.data },
        c.LORE_METADATA_HASH => .{ .hash = hashValue(value.unnamed_0.hash) },
        c.LORE_METADATA_NUMERIC => .{ .numeric = value.unnamed_0.numeric },
        c.LORE_METADATA_STRING => .{ .string = try allocator.dupe(u8, strSlice(value.unnamed_0.string)) },
        else => error.UnsupportedMetadataType,
    };
}

fn copyMetadataEntry(allocator: std.mem.Allocator, payload: c.lore_metadata_event_data_t) Error!MetadataEntry {
    const key = try allocator.dupe(u8, strSlice(payload.key));
    errdefer allocator.free(key);
    return .{ .key = key, .value = try copyMetadataValue(allocator, payload.value) };
}

fn deinitMetadataEntries(allocator: std.mem.Allocator, entries: []MetadataEntry) void {
    for (entries) |*entry| entry.deinit(allocator);
    allocator.free(entries);
}

pub const MetadataList = struct {
    entries: []MetadataEntry,

    pub fn deinit(self: *MetadataList, allocator: std.mem.Allocator) void {
        deinitMetadataEntries(allocator, self.entries);
        self.* = undefined;
    }
};

const MetadataCollector = struct {
    allocator: std.mem.Allocator,
    status: StatusCollector = .{},
    entries: std.ArrayList(MetadataEntry) = .empty,
    copy_error: ?Error = null,

    fn callback(self: *MetadataCollector) c.lore_event_callback_config_t {
        return .{ .user_context = @intFromPtr(self), .func = trampoline };
    }

    fn deinit(self: *MetadataCollector) void {
        for (self.entries.items) |*entry| entry.deinit(self.allocator);
        self.entries.deinit(self.allocator);
    }

    fn trampoline(event: [*c]const c.lore_event_t, user_context: u64) callconv(.c) void {
        const self: *MetadataCollector = @ptrFromInt(user_context);
        const ev = event orelse return;
        self.status.observe(ev);
        if (ev.*.tag != c.LORE_EVENT_METADATA or self.copy_error != null) return;
        var entry = copyMetadataEntry(self.allocator, ev.*.unnamed_0.metadata) catch |err| {
            self.copy_error = err;
            return;
        };
        self.entries.append(self.allocator, entry) catch |err| {
            entry.deinit(self.allocator);
            self.copy_error = err;
        };
    }

    fn finish(self: *MetadataCollector, operation: []const u8, return_status: i32) Error!MetadataList {
        try finishCall(operation, &self.status, return_status);
        if (self.copy_error) |err| return err;
        return .{ .entries = try self.entries.toOwnedSlice(self.allocator) };
    }
};

const EncodedMetadataWrites = struct {
    keys: []c.lore_string_t,
    values: []c.lore_string_t,
    formats: []c.lore_metadata_type_t,

    fn init(allocator: std.mem.Allocator, writes: []const MetadataWrite) Error!EncodedMetadataWrites {
        const keys = try allocator.alloc(c.lore_string_t, writes.len);
        errdefer allocator.free(keys);
        const values = try allocator.alloc(c.lore_string_t, writes.len);
        errdefer allocator.free(values);
        const formats = try allocator.alloc(c.lore_metadata_type_t, writes.len);
        errdefer allocator.free(formats);
        for (writes, keys, values, formats) |write, *key, *value, *format| {
            key.* = str(write.key);
            value.* = str(write.value);
            format.* = write.format.toC();
        }
        return .{ .keys = keys, .values = values, .formats = formats };
    }

    fn deinit(self: *EncodedMetadataWrites, allocator: std.mem.Allocator) void {
        allocator.free(self.keys);
        allocator.free(self.values);
        allocator.free(self.formats);
        self.* = undefined;
    }
};

pub const FileAction = enum(u32) {
    keep = 0,
    add = 1,
    delete = 2,
    move = 3,
    copy = 4,
    _,
};

pub const NodeType = enum(u32) {
    directory = 0,
    file = 1,
    link = 2,
    _,
};

fn fileAction(value: c.lore_file_action_t) FileAction {
    return @enumFromInt(@as(u32, @intCast(value)));
}

fn nodeType(value: c.lore_node_type_t) NodeType {
    return @enumFromInt(@as(u32, @intCast(value)));
}

pub const RepositoryInfo = struct {
    remote_url: []u8,
    id: Identifier,
    name: []u8,
    description: []u8,
    default_branch: Identifier,
    default_branch_name: []u8,
    creator: []u8,
    created_unix: u64,

    pub fn deinit(self: *RepositoryInfo, allocator: std.mem.Allocator) void {
        allocator.free(self.remote_url);
        allocator.free(self.name);
        allocator.free(self.description);
        allocator.free(self.default_branch_name);
        allocator.free(self.creator);
        self.* = undefined;
    }
};

fn copyRepositoryInfo(allocator: std.mem.Allocator, payload: c.lore_repository_data_event_data_t) Error!RepositoryInfo {
    const remote_url = try allocator.dupe(u8, strSlice(payload.remote_url));
    errdefer allocator.free(remote_url);
    const name = try allocator.dupe(u8, strSlice(payload.name));
    errdefer allocator.free(name);
    const description = try allocator.dupe(u8, strSlice(payload.description));
    errdefer allocator.free(description);
    const default_branch_name = try allocator.dupe(u8, strSlice(payload.default_branch_name));
    errdefer allocator.free(default_branch_name);
    const creator = try allocator.dupe(u8, strSlice(payload.creator));
    errdefer allocator.free(creator);
    return .{
        .remote_url = remote_url,
        .id = repositoryId(payload.id),
        .name = name,
        .description = description,
        .default_branch = branchId(payload.default_branch),
        .default_branch_name = default_branch_name,
        .creator = creator,
        .created_unix = payload.created,
    };
}

const RepositoryInfoCollector = struct {
    allocator: std.mem.Allocator,
    status: StatusCollector = .{},
    value: ?RepositoryInfo = null,
    copy_error: ?Error = null,

    fn callback(self: *RepositoryInfoCollector) c.lore_event_callback_config_t {
        return .{ .user_context = @intFromPtr(self), .func = trampoline };
    }

    fn deinit(self: *RepositoryInfoCollector) void {
        if (self.value) |*value| value.deinit(self.allocator);
    }

    fn trampoline(event: [*c]const c.lore_event_t, user_context: u64) callconv(.c) void {
        const self: *RepositoryInfoCollector = @ptrFromInt(user_context);
        const ev = event orelse return;
        self.status.observe(ev);
        if (ev.*.tag != c.LORE_EVENT_REPOSITORY_DATA or self.value != null or self.copy_error != null) return;
        self.value = copyRepositoryInfo(self.allocator, ev.*.unnamed_0.repository_data) catch |err| {
            self.copy_error = err;
            return;
        };
    }
};

/// Lore has no repository-open handle: `globals.repository_path` is the handle. This call
/// validates that door and returns the copied repository descriptor event.
pub fn repositoryInfo(allocator: std.mem.Allocator, repository_path: []const u8, identity: []const u8) Error!RepositoryInfo {
    if (!available()) return error.LoreUnavailable;
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_repository_info_args_t);
    args.repository_url = empty_str;
    var collector = RepositoryInfoCollector{ .allocator = allocator };
    defer collector.deinit();
    const return_status = c.lore_repository_info(&g, &args, collector.callback());
    try finishCall("repository info", &collector.status, return_status);
    if (collector.copy_error) |err| return err;
    const value = collector.value orelse return error.MissingResult;
    collector.value = null;
    return value;
}

pub const FileInfo = struct {
    path: []u8,
    context: Identifier,
    hash: Hash,
    is_file: bool,
    is_dir: bool,
    modified: bool,
    deleted: bool,
    added: bool,
    conflict: bool,
    mode: u16,
    size: u64,
    local_size: u64,
    local_hash: Hash,
    filter_size: u64,

    pub fn deinit(self: *FileInfo, allocator: std.mem.Allocator) void {
        allocator.free(self.path);
        self.* = undefined;
    }
};

pub const FileInfoList = struct {
    entries: []FileInfo,

    pub fn deinit(self: *FileInfoList, allocator: std.mem.Allocator) void {
        for (self.entries) |*entry| entry.deinit(allocator);
        allocator.free(self.entries);
        self.* = undefined;
    }
};

const FileInfoCollector = struct {
    allocator: std.mem.Allocator,
    status: StatusCollector = .{},
    entries: std.ArrayList(FileInfo) = .empty,
    copy_error: ?Error = null,

    fn callback(self: *FileInfoCollector) c.lore_event_callback_config_t {
        return .{ .user_context = @intFromPtr(self), .func = trampoline };
    }

    fn deinit(self: *FileInfoCollector) void {
        for (self.entries.items) |*entry| entry.deinit(self.allocator);
        self.entries.deinit(self.allocator);
    }

    fn trampoline(event: [*c]const c.lore_event_t, user_context: u64) callconv(.c) void {
        const self: *FileInfoCollector = @ptrFromInt(user_context);
        const ev = event orelse return;
        self.status.observe(ev);
        if (ev.*.tag != c.LORE_EVENT_FILE_INFO or self.copy_error != null) return;
        const payload = ev.*.unnamed_0.file_info;
        const path = self.allocator.dupe(u8, strSlice(payload.path)) catch |err| {
            self.copy_error = err;
            return;
        };
        const entry: FileInfo = .{
            .path = path,
            .context = payload.context.data,
            .hash = hashValue(payload.hash),
            .is_file = payload.is_file != 0,
            .is_dir = payload.is_dir != 0,
            .modified = payload.flag_modified != 0,
            .deleted = payload.flag_deleted != 0,
            .added = payload.flag_added != 0,
            .conflict = payload.flag_conflict != 0,
            .mode = payload.mode,
            .size = payload.size,
            .local_size = payload.local_size,
            .local_hash = hashValue(payload.local_hash),
            .filter_size = payload.filter_size,
        };
        self.entries.append(self.allocator, entry) catch |err| {
            self.allocator.free(path);
            self.copy_error = err;
        };
    }
};

/// A file path is likewise Lore's file handle; FILE_INFO is the non-mutating open/read.
pub fn fileInfo(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    paths: []const []const u8,
    revision: []const u8,
) Error!FileInfoList {
    if (!available()) return error.LoreUnavailable;
    const c_paths = try makeStrings(allocator, paths);
    defer allocator.free(c_paths);
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_file_info_args_t);
    args.paths = stringArray(c_paths);
    args.revision = if (revision.len == 0) empty_str else str(revision);
    var collector = FileInfoCollector{ .allocator = allocator };
    defer collector.deinit();
    const return_status = c.lore_file_info(&g, &args, collector.callback());
    try finishCall("file info", &collector.status, return_status);
    if (collector.copy_error) |err| return err;
    const entries = try collector.entries.toOwnedSlice(allocator);
    return .{ .entries = entries };
}

pub const StatusRevision = struct {
    repository: Identifier,
    branch: Identifier,
    branch_name: []u8,
    revision: Hash,
    revision_number: u64,
    staged_revision: Hash,
    merged_revision: Hash,
    merged_parent_branch_revision: Hash,
    local_revision: Hash,
    local_revision_number: u64,
    remote_revision: Hash,
    remote_revision_number: u64,
    local_ahead: bool,
    remote_ahead: bool,
    remote_available: bool,
    remote_authorized: bool,
    remote_branch_exists: bool,

    pub fn deinit(self: *StatusRevision, allocator: std.mem.Allocator) void {
        allocator.free(self.branch_name);
        self.* = undefined;
    }
};

pub const StatusFile = struct {
    path: []u8,
    from_path: []u8,
    size: u64,
    action: FileAction,
    node_type: NodeType,
    staged: bool,
    merged: bool,
    conflict: bool,
    conflict_unresolved: bool,
    conflict_automerged: bool,
    conflict_mine: bool,
    conflict_theirs: bool,
    dirty: bool,

    pub fn deinit(self: *StatusFile, allocator: std.mem.Allocator) void {
        allocator.free(self.path);
        allocator.free(self.from_path);
        self.* = undefined;
    }
};

pub const TreeCount = struct { directories: u64, files: u64 };
pub const StatusSummary = struct { adds: u64, deletes: u64, modifies: u64, moves: u64, copies: u64 };

pub const RepositoryStatus = struct {
    revision: ?StatusRevision,
    files: []StatusFile,
    count: ?TreeCount,
    summary: ?StatusSummary,

    pub fn deinit(self: *RepositoryStatus, allocator: std.mem.Allocator) void {
        if (self.revision) |*revision| revision.deinit(allocator);
        for (self.files) |*file| file.deinit(allocator);
        allocator.free(self.files);
        self.* = undefined;
    }
};

pub const RepositoryStatusOptions = struct {
    staged: bool = true,
    scan: bool = false,
    check_dirty: bool = false,
    reset: bool = false,
    sync_point: bool = false,
    revision_only: bool = false,
    count: bool = true,
    paths: []const []const u8 = &.{},
};

const RepositoryStatusCollector = struct {
    allocator: std.mem.Allocator,
    status: StatusCollector = .{},
    revision: ?StatusRevision = null,
    files: std.ArrayList(StatusFile) = .empty,
    count: ?TreeCount = null,
    summary: ?StatusSummary = null,
    copy_error: ?Error = null,

    fn callback(self: *RepositoryStatusCollector) c.lore_event_callback_config_t {
        return .{ .user_context = @intFromPtr(self), .func = trampoline };
    }

    fn deinit(self: *RepositoryStatusCollector) void {
        if (self.revision) |*revision| revision.deinit(self.allocator);
        for (self.files.items) |*file| file.deinit(self.allocator);
        self.files.deinit(self.allocator);
    }

    fn trampoline(event: [*c]const c.lore_event_t, user_context: u64) callconv(.c) void {
        const self: *RepositoryStatusCollector = @ptrFromInt(user_context);
        const ev = event orelse return;
        self.status.observe(ev);
        if (self.copy_error != null) return;
        switch (ev.*.tag) {
            c.LORE_EVENT_REPOSITORY_STATUS_REVISION => {
                if (self.revision != null) return;
                const payload = ev.*.unnamed_0.repository_status_revision;
                const branch_name = self.allocator.dupe(u8, strSlice(payload.branch_name)) catch |err| {
                    self.copy_error = err;
                    return;
                };
                self.revision = .{
                    .repository = repositoryId(payload.repository),
                    .branch = branchId(payload.branch),
                    .branch_name = branch_name,
                    .revision = hashValue(payload.revision),
                    .revision_number = payload.revision_number,
                    .staged_revision = hashValue(payload.revision_staged),
                    .merged_revision = hashValue(payload.revision_merged),
                    .merged_parent_branch_revision = hashValue(payload.revision_merged_parent_branch),
                    .local_revision = hashValue(payload.revision_local),
                    .local_revision_number = payload.revision_local_number,
                    .remote_revision = hashValue(payload.revision_remote),
                    .remote_revision_number = payload.revision_remote_number,
                    .local_ahead = payload.is_local_ahead != 0,
                    .remote_ahead = payload.is_remote_ahead != 0,
                    .remote_available = payload.remote_available != 0,
                    .remote_authorized = payload.remote_authorized != 0,
                    .remote_branch_exists = payload.remote_branch_exist != 0,
                };
            },
            c.LORE_EVENT_REPOSITORY_STATUS_FILE => {
                const payload = ev.*.unnamed_0.repository_status_file;
                const path = self.allocator.dupe(u8, strSlice(payload.path)) catch |err| {
                    self.copy_error = err;
                    return;
                };
                const from_path = self.allocator.dupe(u8, strSlice(payload.from_path)) catch |err| {
                    self.allocator.free(path);
                    self.copy_error = err;
                    return;
                };
                const file: StatusFile = .{
                    .path = path,
                    .from_path = from_path,
                    .size = payload.size,
                    .action = fileAction(payload.action),
                    .node_type = nodeType(payload.type),
                    .staged = payload.flag_staged != 0,
                    .merged = payload.flag_merged != 0,
                    .conflict = payload.flag_conflict != 0,
                    .conflict_unresolved = payload.flag_conflict_unresolved != 0,
                    .conflict_automerged = payload.flag_conflict_automerged != 0,
                    .conflict_mine = payload.flag_conflict_mine != 0,
                    .conflict_theirs = payload.flag_conflict_theirs != 0,
                    .dirty = payload.flag_dirty != 0,
                };
                self.files.append(self.allocator, file) catch |err| {
                    self.allocator.free(path);
                    self.allocator.free(from_path);
                    self.copy_error = err;
                };
            },
            c.LORE_EVENT_REPOSITORY_STATUS_COUNT => {
                const payload = ev.*.unnamed_0.repository_status_count;
                self.count = .{ .directories = payload.directories, .files = payload.files };
            },
            c.LORE_EVENT_REPOSITORY_STATUS_SUMMARY => {
                const payload = ev.*.unnamed_0.repository_status_summary;
                self.summary = .{
                    .adds = payload.adds,
                    .deletes = payload.deletes,
                    .modifies = payload.modifies,
                    .moves = payload.moves,
                    .copies = payload.copies,
                };
            },
            else => {},
        }
    }
};

pub fn repositoryStatus(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    options: RepositoryStatusOptions,
) Error!RepositoryStatus {
    if (!available()) return error.LoreUnavailable;
    const c_paths = try makeStrings(allocator, options.paths);
    defer allocator.free(c_paths);
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_repository_status_args_t);
    args.staged = @intFromBool(options.staged);
    args.scan = @intFromBool(options.scan);
    args.check_dirty = @intFromBool(options.check_dirty);
    args.reset = @intFromBool(options.reset);
    args.sync_point = @intFromBool(options.sync_point);
    args.revision_only = @intFromBool(options.revision_only);
    args.count = @intFromBool(options.count);
    args.paths = stringArray(c_paths);
    var collector = RepositoryStatusCollector{ .allocator = allocator };
    defer collector.deinit();
    const return_status = c.lore_repository_status(&g, &args, collector.callback());
    try finishCall("repository status", &collector.status, return_status);
    if (collector.copy_error) |err| return err;
    const files = try collector.files.toOwnedSlice(allocator);
    const result: RepositoryStatus = .{
        .revision = collector.revision,
        .files = files,
        .count = collector.count,
        .summary = collector.summary,
    };
    collector.revision = null;
    return result;
}

pub const StageCounts = struct {
    directory_modify: u64 = 0,
    directory_add: u64 = 0,
    directory_delete: u64 = 0,
    directory_move: u64 = 0,
    file_modify: u64 = 0,
    file_add: u64 = 0,
    file_delete: u64 = 0,
    file_move: u64 = 0,
    total: u64 = 0,
};

fn stageCounts(value: c.lore_file_stage_count_data_t) StageCounts {
    return .{
        .directory_modify = value.directory_modify_count,
        .directory_add = value.directory_add_count,
        .directory_delete = value.directory_delete_count,
        .directory_move = value.directory_move_count,
        .file_modify = value.file_modify_count,
        .file_add = value.file_add_count,
        .file_delete = value.file_delete_count,
        .file_move = value.file_move_count,
        .total = value.total_count,
    };
}

pub const StageRevision = struct { repository: Identifier, revision: Hash };

pub const StageFile = struct {
    from_path: []u8,
    path: []u8,
    action: FileAction,

    pub fn deinit(self: *StageFile, allocator: std.mem.Allocator) void {
        allocator.free(self.from_path);
        allocator.free(self.path);
        self.* = undefined;
    }
};

pub const FileStageResult = struct {
    requested_path_count: usize,
    counts: StageCounts,
    revision: ?StageRevision,
    files: []StageFile,

    pub fn deinit(self: *FileStageResult, allocator: std.mem.Allocator) void {
        for (self.files) |*file| file.deinit(allocator);
        allocator.free(self.files);
        self.* = undefined;
    }
};

pub const CaseChange = enum(u32) {
    reject = 0,
    keep_filesystem = 1,
    rename_repository = 2,
};

pub const FileStageOptions = struct {
    case_change: CaseChange = .reject,
    scan: bool = false,
};

const FileStageCollector = struct {
    allocator: std.mem.Allocator,
    status: StatusCollector = .{},
    requested_path_count: usize = 0,
    counts: StageCounts = .{},
    revision: ?StageRevision = null,
    files: std.ArrayList(StageFile) = .empty,
    copy_error: ?Error = null,

    fn callback(self: *FileStageCollector) c.lore_event_callback_config_t {
        return .{ .user_context = @intFromPtr(self), .func = trampoline };
    }

    fn deinit(self: *FileStageCollector) void {
        for (self.files.items) |*file| file.deinit(self.allocator);
        self.files.deinit(self.allocator);
    }

    fn trampoline(event: [*c]const c.lore_event_t, user_context: u64) callconv(.c) void {
        const self: *FileStageCollector = @ptrFromInt(user_context);
        const ev = event orelse return;
        self.status.observe(ev);
        if (self.copy_error != null) return;
        switch (ev.*.tag) {
            c.LORE_EVENT_FILE_STAGE_BEGIN => self.requested_path_count = ev.*.unnamed_0.file_stage_begin.path_count,
            c.LORE_EVENT_FILE_STAGE_PROGRESS => self.counts = stageCounts(ev.*.unnamed_0.file_stage_progress.count),
            c.LORE_EVENT_FILE_STAGE_END => self.counts = stageCounts(ev.*.unnamed_0.file_stage_end.count),
            c.LORE_EVENT_FILE_STAGE_REVISION => {
                const payload = ev.*.unnamed_0.file_stage_revision;
                self.revision = .{
                    .repository = repositoryId(payload.repository),
                    .revision = hashValue(payload.revision),
                };
            },
            c.LORE_EVENT_FILE_STAGE_FILE => {
                const payload = ev.*.unnamed_0.file_stage_file;
                const from_path = self.allocator.dupe(u8, strSlice(payload.from_path)) catch |err| {
                    self.copy_error = err;
                    return;
                };
                const path = self.allocator.dupe(u8, strSlice(payload.path)) catch |err| {
                    self.allocator.free(from_path);
                    self.copy_error = err;
                    return;
                };
                self.files.append(self.allocator, .{
                    .from_path = from_path,
                    .path = path,
                    .action = fileAction(payload.action),
                }) catch |err| {
                    self.allocator.free(from_path);
                    self.allocator.free(path);
                    self.copy_error = err;
                };
            },
            else => {},
        }
    }
};

pub fn fileStage(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    paths: []const []const u8,
    options: FileStageOptions,
) Error!FileStageResult {
    if (!available()) return error.LoreUnavailable;
    const c_paths = try makeStrings(allocator, paths);
    defer allocator.free(c_paths);
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_file_stage_args_t);
    args.paths = stringArray(c_paths);
    args.case_change = @intFromEnum(options.case_change);
    args.scan = @intFromBool(options.scan);
    var collector = FileStageCollector{ .allocator = allocator };
    defer collector.deinit();
    const return_status = c.lore_file_stage(&g, &args, collector.callback());
    try finishCall("file stage", &collector.status, return_status);
    if (collector.copy_error) |err| return err;
    const files = try collector.files.toOwnedSlice(allocator);
    return .{
        .requested_path_count = collector.requested_path_count,
        .counts = collector.counts,
        .revision = collector.revision,
        .files = files,
    };
}

pub const FileDumpResult = struct {
    address: Address,
    flags: u32,
    payload_size: u32,
    content_size: u64,
    match_made: bool,
};

const FileDumpCollector = struct {
    status: StatusCollector = .{},
    value: ?FileDumpResult = null,

    fn callback(self: *FileDumpCollector) c.lore_event_callback_config_t {
        return .{ .user_context = @intFromPtr(self), .func = trampoline };
    }

    fn trampoline(event: [*c]const c.lore_event_t, user_context: u64) callconv(.c) void {
        const self: *FileDumpCollector = @ptrFromInt(user_context);
        const ev = event orelse return;
        self.status.observe(ev);
        if (ev.*.tag != c.LORE_EVENT_FILE_DUMP) return;
        const payload = ev.*.unnamed_0.file_dump;
        self.value = .{
            .address = addressValue(payload.address),
            .flags = payload.flags,
            .payload_size = payload.size_payload,
            .content_size = payload.size_content,
            .match_made = payload.match_made != 0,
        };
    }
};

/// Despite the generated prose calling this "binary content", v0.8.6's exact event has no
/// byte pointer: it returns address/flags/sizes/match only. Callers must not treat this as
/// preview bytes. `lore_file_write(path, revision, output)` is the available materializer.
pub fn fileDump(repository_path: []const u8, identity: []const u8, path: []const u8, address: []const u8) Error!FileDumpResult {
    if (!available()) return error.LoreUnavailable;
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_file_dump_args_t);
    args.address = if (address.len == 0) empty_str else str(address);
    args.path = if (path.len == 0) empty_str else str(path);
    var collector = FileDumpCollector{};
    const return_status = c.lore_file_dump(&g, &args, collector.callback());
    try finishCall("file dump", &collector.status, return_status);
    return collector.value orelse error.MissingResult;
}

pub const FileHistoryEntry = struct {
    path: []u8,
    repository: Identifier,
    revision: Hash,
    revision_number: u64,
    parents: [2]Hash,
    address: Address,
    size: u64,
    action: FileAction,

    pub fn deinit(self: *FileHistoryEntry, allocator: std.mem.Allocator) void {
        allocator.free(self.path);
        self.* = undefined;
    }
};

pub const FileHistory = struct {
    entries: []FileHistoryEntry,

    pub fn deinit(self: *FileHistory, allocator: std.mem.Allocator) void {
        for (self.entries) |*entry| entry.deinit(allocator);
        allocator.free(self.entries);
        self.* = undefined;
    }
};

pub const FileHistoryOptions = struct {
    revision: []const u8 = "",
    branch: []const u8 = "",
    length: u32 = 0,
    depth: u32 = 0,
};

const FileHistoryCollector = struct {
    allocator: std.mem.Allocator,
    status: StatusCollector = .{},
    entries: std.ArrayList(FileHistoryEntry) = .empty,
    copy_error: ?Error = null,

    fn callback(self: *FileHistoryCollector) c.lore_event_callback_config_t {
        return .{ .user_context = @intFromPtr(self), .func = trampoline };
    }

    fn deinit(self: *FileHistoryCollector) void {
        for (self.entries.items) |*entry| entry.deinit(self.allocator);
        self.entries.deinit(self.allocator);
    }

    fn trampoline(event: [*c]const c.lore_event_t, user_context: u64) callconv(.c) void {
        const self: *FileHistoryCollector = @ptrFromInt(user_context);
        const ev = event orelse return;
        self.status.observe(ev);
        if (ev.*.tag != c.LORE_EVENT_FILE_HISTORY or self.copy_error != null) return;
        const payload = ev.*.unnamed_0.file_history;
        const path = self.allocator.dupe(u8, strSlice(payload.path)) catch |err| {
            self.copy_error = err;
            return;
        };
        self.entries.append(self.allocator, .{
            .path = path,
            .repository = repositoryId(payload.repository),
            .revision = hashValue(payload.revision),
            .revision_number = payload.revision_number,
            .parents = .{ hashValue(payload.parent[0]), hashValue(payload.parent[1]) },
            .address = addressValue(payload.address),
            .size = payload.size,
            .action = fileAction(payload.action),
        }) catch |err| {
            self.allocator.free(path);
            self.copy_error = err;
        };
    }
};

/// Returns only revisions in which `path` changed. `depth` bounds the initial history
/// search while `length` bounds the number of matching file revisions returned.
pub fn fileHistory(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    path: []const u8,
    options: FileHistoryOptions,
) Error!FileHistory {
    if (!available()) return error.LoreUnavailable;
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_file_history_args_t);
    args.path = str(path);
    args.revision = if (options.revision.len == 0) empty_str else str(options.revision);
    args.branch = if (options.branch.len == 0) empty_str else str(options.branch);
    args.length = options.length;
    args.depth = options.depth;
    var collector = FileHistoryCollector{ .allocator = allocator };
    defer collector.deinit();
    const return_status = c.lore_file_history(&g, &args, collector.callback());
    try finishCall("file history", &collector.status, return_status);
    if (collector.copy_error) |err| return err;
    return .{ .entries = try collector.entries.toOwnedSlice(allocator) };
}

pub const FileWriteResult = struct {
    written_path: []u8,

    pub fn deinit(self: *FileWriteResult, allocator: std.mem.Allocator) void {
        allocator.free(self.written_path);
        self.* = undefined;
    }
};

pub const FileWriteOptions = struct {
    /// Historical payloads may have been evicted from the checkout's local immutable store.
    /// Leave false for normal preview/restore so Lore may fetch them; set true for a strict
    /// local-only materialization attempt.
    offline: bool = false,
};

const FileWriteCollector = struct {
    allocator: std.mem.Allocator,
    status: StatusCollector = .{},
    written_path: ?[]u8 = null,
    copy_error: ?Error = null,

    fn callback(self: *FileWriteCollector) c.lore_event_callback_config_t {
        return .{ .user_context = @intFromPtr(self), .func = trampoline };
    }

    fn deinit(self: *FileWriteCollector) void {
        if (self.written_path) |path| self.allocator.free(path);
    }

    fn trampoline(event: [*c]const c.lore_event_t, user_context: u64) callconv(.c) void {
        const self: *FileWriteCollector = @ptrFromInt(user_context);
        const ev = event orelse return;
        self.status.observe(ev);
        if (ev.*.tag != c.LORE_EVENT_FILE_WRITE or self.copy_error != null or self.written_path != null) return;
        self.written_path = self.allocator.dupe(u8, strSlice(ev.*.unnamed_0.file_write.path)) catch |err| {
            self.copy_error = err;
            return;
        };
    }
};

/// Materialize historical content to `output`. A non-empty `address` takes precedence;
/// otherwise Lore resolves `path` at `revision`. This, not `fileDump`, supplies preview or
/// explicit restore bytes. The caller owns choosing an isolated destination path.
pub fn fileWrite(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    path: []const u8,
    revision: []const u8,
    address: []const u8,
    output: []const u8,
    options: FileWriteOptions,
) Error!FileWriteResult {
    if (!available()) return error.LoreUnavailable;
    var g = try globals(repository_path, identity);
    g.offline = @intFromBool(options.offline);
    var args = std.mem.zeroes(c.lore_file_write_args_t);
    args.address = if (address.len == 0) empty_str else str(address);
    args.path = if (path.len == 0) empty_str else str(path);
    args.revision = if (revision.len == 0) empty_str else str(revision);
    args.output = str(output);
    var collector = FileWriteCollector{ .allocator = allocator };
    defer collector.deinit();
    const return_status = c.lore_file_write(&g, &args, collector.callback());
    try finishCall("file write", &collector.status, return_status);
    if (collector.copy_error) |err| return err;
    const written_path = collector.written_path orelse return error.MissingResult;
    collector.written_path = null;
    return .{ .written_path = written_path };
}

pub const CommitCounts = struct {
    directories: u64 = 0,
    directory_total: u64 = 0,
    files: u64 = 0,
    file_total: u64 = 0,
    directory_deletes: u64 = 0,
    file_modifies: u64 = 0,
    file_deletes: u64 = 0,
    bytes_transferred: u64 = 0,
    bytes_total: u64 = 0,
    discovery_complete: bool = false,
};

fn commitCounts(value: c.lore_revision_commit_count_data_t) CommitCounts {
    return .{
        .directories = value.directory_count,
        .directory_total = value.directory_total,
        .files = value.file_count,
        .file_total = value.file_total,
        .directory_deletes = value.directory_delete_count,
        .file_modifies = value.file_modify_count,
        .file_deletes = value.file_delete_count,
        .bytes_transferred = value.bytes_transferred,
        .bytes_total = value.bytes_total,
        .discovery_complete = value.discovery_complete != 0,
    };
}

pub const CommitRevision = struct {
    repository: Identifier,
    branch: Identifier,
    revision: Hash,
    revision_number: u64,
    parent: Hash,
    other_parent: Hash,
};

fn commitRevision(value: c.lore_revision_commit_revision_event_data_t) CommitRevision {
    return .{
        .repository = repositoryId(value.repository),
        .branch = branchId(value.branch),
        .revision = hashValue(value.revision),
        .revision_number = value.revision_number,
        .parent = hashValue(value.parent),
        .other_parent = hashValue(value.parent_other),
    };
}

pub const RevisionCommitResult = struct {
    counts: CommitCounts,
    revision: CommitRevision,
    metadata: []MetadataEntry,

    pub fn deinit(self: *RevisionCommitResult, allocator: std.mem.Allocator) void {
        deinitMetadataEntries(allocator, self.metadata);
        self.* = undefined;
    }
};

const RevisionCommitCollector = struct {
    allocator: std.mem.Allocator,
    status: StatusCollector = .{},
    counts: CommitCounts = .{},
    revision: ?CommitRevision = null,
    metadata: std.ArrayList(MetadataEntry) = .empty,
    copy_error: ?Error = null,

    fn callback(self: *RevisionCommitCollector) c.lore_event_callback_config_t {
        return .{ .user_context = @intFromPtr(self), .func = trampoline };
    }

    fn deinit(self: *RevisionCommitCollector) void {
        for (self.metadata.items) |*entry| entry.deinit(self.allocator);
        self.metadata.deinit(self.allocator);
    }

    fn trampoline(event: [*c]const c.lore_event_t, user_context: u64) callconv(.c) void {
        const self: *RevisionCommitCollector = @ptrFromInt(user_context);
        const ev = event orelse return;
        self.status.observe(ev);
        if (self.copy_error != null) return;
        switch (ev.*.tag) {
            c.LORE_EVENT_REVISION_COMMIT_PROGRESS => self.counts = commitCounts(ev.*.unnamed_0.revision_commit_progress.count),
            c.LORE_EVENT_REVISION_COMMIT_END => self.counts = commitCounts(ev.*.unnamed_0.revision_commit_end.count),
            c.LORE_EVENT_REVISION_COMMIT_REVISION => self.revision = commitRevision(ev.*.unnamed_0.revision_commit_revision),
            c.LORE_EVENT_METADATA => {
                var entry = copyMetadataEntry(self.allocator, ev.*.unnamed_0.metadata) catch |err| {
                    self.copy_error = err;
                    return;
                };
                self.metadata.append(self.allocator, entry) catch |err| {
                    entry.deinit(self.allocator);
                    self.copy_error = err;
                };
            },
            else => {},
        }
    }
};

pub fn revisionCommit(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    message: []const u8,
    stats: bool,
) Error!RevisionCommitResult {
    if (!available()) return error.LoreUnavailable;
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_revision_commit_args_t);
    args.message = str(message);
    args.stats = @intFromBool(stats);
    var collector = RevisionCommitCollector{ .allocator = allocator };
    defer collector.deinit();
    const return_status = c.lore_revision_commit(&g, &args, collector.callback());
    try finishCall("revision commit", &collector.status, return_status);
    if (collector.copy_error) |err| return err;
    const revision = collector.revision orelse return error.MissingResult;
    const metadata = try collector.metadata.toOwnedSlice(allocator);
    return .{ .counts = collector.counts, .revision = revision, .metadata = metadata };
}

pub const RevisionHistoryHeader = struct {
    repository: Identifier,
    branch: Identifier,
};

pub const RevisionHistoryEntry = struct {
    revision: Hash,
    revision_number: u64,
    parents: [2]Hash,
};

pub const RevisionHistory = struct {
    header: ?RevisionHistoryHeader,
    entries: []RevisionHistoryEntry,

    pub fn deinit(self: *RevisionHistory, allocator: std.mem.Allocator) void {
        allocator.free(self.entries);
        self.* = undefined;
    }
};

pub const RevisionHistoryOptions = struct {
    revision: []const u8 = "",
    branch: []const u8 = "",
    before_unix: u64 = 0,
    length: u32 = 0,
    only_branch: bool = false,
};

const RevisionHistoryCollector = struct {
    allocator: std.mem.Allocator,
    status: StatusCollector = .{},
    header: ?RevisionHistoryHeader = null,
    entries: std.ArrayList(RevisionHistoryEntry) = .empty,
    copy_error: ?Error = null,

    fn callback(self: *RevisionHistoryCollector) c.lore_event_callback_config_t {
        return .{ .user_context = @intFromPtr(self), .func = trampoline };
    }

    fn deinit(self: *RevisionHistoryCollector) void {
        self.entries.deinit(self.allocator);
    }

    fn trampoline(event: [*c]const c.lore_event_t, user_context: u64) callconv(.c) void {
        const self: *RevisionHistoryCollector = @ptrFromInt(user_context);
        const ev = event orelse return;
        self.status.observe(ev);
        if (self.copy_error != null) return;
        switch (ev.*.tag) {
            c.LORE_EVENT_REVISION_HISTORY => {
                const payload = ev.*.unnamed_0.revision_history;
                self.header = .{ .repository = repositoryId(payload.repository), .branch = branchId(payload.branch) };
            },
            c.LORE_EVENT_REVISION_HISTORY_ENTRY => {
                const payload = ev.*.unnamed_0.revision_history_entry;
                self.entries.append(self.allocator, .{
                    .revision = hashValue(payload.revision),
                    .revision_number = payload.revision_number,
                    .parents = .{ hashValue(payload.parent[0]), hashValue(payload.parent[1]) },
                }) catch |err| {
                    self.copy_error = err;
                };
            },
            else => {},
        }
    }
};

/// v0.8.6 history entries expose hashes, ordinal numbers and parents only. They carry no
/// timestamp or message, so UI-facing time/label must be persisted explicitly as metadata.
pub fn revisionHistory(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    options: RevisionHistoryOptions,
) Error!RevisionHistory {
    if (!available()) return error.LoreUnavailable;
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_revision_history_args_t);
    args.revision = if (options.revision.len == 0) empty_str else str(options.revision);
    args.branch = if (options.branch.len == 0) empty_str else str(options.branch);
    args.date = options.before_unix;
    args.length = options.length;
    args.only_branch = @intFromBool(options.only_branch);
    var collector = RevisionHistoryCollector{ .allocator = allocator };
    defer collector.deinit();
    const return_status = c.lore_revision_history(&g, &args, collector.callback());
    try finishCall("revision history", &collector.status, return_status);
    if (collector.copy_error) |err| return err;
    const entries = try collector.entries.toOwnedSlice(allocator);
    return .{ .header = collector.header, .entries = entries };
}

fn takeFirstMetadata(allocator: std.mem.Allocator, list: *MetadataList) ?MetadataEntry {
    if (list.entries.len == 0) {
        allocator.free(list.entries);
        list.* = undefined;
        return null;
    }
    const first = list.entries[0];
    for (list.entries[1..]) |*entry| entry.deinit(allocator);
    allocator.free(list.entries);
    list.* = undefined;
    return first;
}

pub fn revisionMetadataGet(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    key: []const u8,
    revision: []const u8,
) Error!?MetadataEntry {
    if (!available()) return error.LoreUnavailable;
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_revision_metadata_get_args_t);
    args.key = str(key);
    args.revision = if (revision.len == 0) empty_str else str(revision);
    var collector = MetadataCollector{ .allocator = allocator };
    defer collector.deinit();
    const return_status = c.lore_revision_metadata_get(&g, &args, collector.callback());
    var list = try collector.finish("revision metadata get", return_status);
    return takeFirstMetadata(allocator, &list);
}

pub fn revisionMetadataList(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    revision: []const u8,
) Error!MetadataList {
    if (!available()) return error.LoreUnavailable;
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_revision_metadata_list_args_t);
    args.revision = if (revision.len == 0) empty_str else str(revision);
    var collector = MetadataCollector{ .allocator = allocator };
    defer collector.deinit();
    const return_status = c.lore_revision_metadata_list(&g, &args, collector.callback());
    return collector.finish("revision metadata list", return_status);
}

/// Set metadata on the CURRENT revision. v0.8.6 exposes no revision selector here, so an
/// old revision cannot be mutated. Pin state must be a current Lore-tracked registry keyed
/// by immutable revision hashes, not a `pin=true` mutation on the historical revision.
pub fn revisionMetadataSet(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    writes: []const MetadataWrite,
) Error!void {
    if (!available()) return error.LoreUnavailable;
    var encoded = try EncodedMetadataWrites.init(allocator, writes);
    defer encoded.deinit(allocator);
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_revision_metadata_set_args_t);
    args.keys = stringArray(encoded.keys);
    args.values = stringArray(encoded.values);
    args.formats = metadataFormatArray(encoded.formats);
    var status = StatusCollector{};
    const return_status = c.lore_revision_metadata_set(&g, &args, status.callback());
    try finishCall("revision metadata set", &status, return_status);
}

pub fn fileMetadataGet(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    path: []const u8,
    key: []const u8,
    revision: []const u8,
) Error!?MetadataEntry {
    if (!available()) return error.LoreUnavailable;
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_file_metadata_get_args_t);
    args.revision = if (revision.len == 0) empty_str else str(revision);
    args.path = str(path);
    args.key = str(key);
    var collector = MetadataCollector{ .allocator = allocator };
    defer collector.deinit();
    const return_status = c.lore_file_metadata_get(&g, &args, collector.callback());
    var list = try collector.finish("file metadata get", return_status);
    return takeFirstMetadata(allocator, &list);
}

pub fn fileMetadataList(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    path: []const u8,
    revision: []const u8,
) Error!MetadataList {
    if (!available()) return error.LoreUnavailable;
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_file_metadata_list_args_t);
    args.path = str(path);
    args.revision = if (revision.len == 0) empty_str else str(revision);
    var collector = MetadataCollector{ .allocator = allocator };
    defer collector.deinit();
    const return_status = c.lore_file_metadata_list(&g, &args, collector.callback());
    return collector.finish("file metadata list", return_status);
}

/// Set metadata on one file in the current staged/current state. The C API supports many
/// paths in one call; this narrow wrapper intentionally makes the per-path entry grouping
/// unambiguous at the host boundary.
pub fn fileMetadataSet(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    path: []const u8,
    writes: []const MetadataWrite,
) Error!void {
    if (!available()) return error.LoreUnavailable;
    var encoded = try EncodedMetadataWrites.init(allocator, writes);
    defer encoded.deinit(allocator);
    const c_paths = [_]c.lore_string_t{str(path)};
    const entry_counts = [_]u32{@intCast(writes.len)};
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_file_metadata_set_args_t);
    args.paths = stringArray(&c_paths);
    args.keys = stringArray(encoded.keys);
    args.values = stringArray(encoded.values);
    args.formats = metadataFormatArray(encoded.formats);
    args.entries = uint32Array(&entry_counts);
    var status = StatusCollector{};
    const return_status = c.lore_file_metadata_set(&g, &args, status.callback());
    try finishCall("file metadata set", &status, return_status);
}

pub const RestoreFile = struct {
    path: []u8,
    action: FileAction,
    size: u64,
    is_file: bool,
    is_directory: bool,
    is_module: bool,

    pub fn deinit(self: *RestoreFile, allocator: std.mem.Allocator) void {
        allocator.free(self.path);
        self.* = undefined;
    }
};

pub const RestoreRevision = struct {
    revision: Hash,
    revision_number: u64,
};

pub const RestoreFragments = struct {
    expected: u64 = 0,
    completed: u64 = 0,
    total: u64 = 0,
    transferred: u64 = 0,
};

pub const RevisionRestoreResult = struct {
    expected_files: usize,
    processed_files: usize,
    files: []RestoreFile,
    fragments: RestoreFragments,
    restored_revision: ?RestoreRevision,
    expected_sync_changes: usize,
    applied_sync_changes: usize,
    commit_counts: CommitCounts,
    committed_revision: ?CommitRevision,
    metadata: []MetadataEntry,

    pub fn deinit(self: *RevisionRestoreResult, allocator: std.mem.Allocator) void {
        for (self.files) |*file| file.deinit(allocator);
        allocator.free(self.files);
        deinitMetadataEntries(allocator, self.metadata);
        self.* = undefined;
    }
};

const RevisionRestoreCollector = struct {
    allocator: std.mem.Allocator,
    status: StatusCollector = .{},
    expected_files: usize = 0,
    processed_files: usize = 0,
    files: std.ArrayList(RestoreFile) = .empty,
    fragments: RestoreFragments = .{},
    restored_revision: ?RestoreRevision = null,
    expected_sync_changes: usize = 0,
    applied_sync_changes: usize = 0,
    commit_counts: CommitCounts = .{},
    committed_revision: ?CommitRevision = null,
    metadata: std.ArrayList(MetadataEntry) = .empty,
    copy_error: ?Error = null,

    fn callback(self: *RevisionRestoreCollector) c.lore_event_callback_config_t {
        return .{ .user_context = @intFromPtr(self), .func = trampoline };
    }

    fn deinit(self: *RevisionRestoreCollector) void {
        for (self.files.items) |*file| file.deinit(self.allocator);
        self.files.deinit(self.allocator);
        for (self.metadata.items) |*entry| entry.deinit(self.allocator);
        self.metadata.deinit(self.allocator);
    }

    fn trampoline(event: [*c]const c.lore_event_t, user_context: u64) callconv(.c) void {
        const self: *RevisionRestoreCollector = @ptrFromInt(user_context);
        const ev = event orelse return;
        self.status.observe(ev);
        if (self.copy_error != null) return;
        switch (ev.*.tag) {
            c.LORE_EVENT_REVISION_RESTORE_FILE_BEGIN => self.expected_files = ev.*.unnamed_0.revision_restore_file_begin.count,
            c.LORE_EVENT_REVISION_RESTORE_FILE => {
                const payload = ev.*.unnamed_0.revision_restore_file;
                const path = self.allocator.dupe(u8, strSlice(payload.path)) catch |err| {
                    self.copy_error = err;
                    return;
                };
                self.files.append(self.allocator, .{
                    .path = path,
                    .action = fileAction(payload.action),
                    .size = payload.size,
                    .is_file = payload.is_file != 0,
                    .is_directory = payload.is_directory != 0,
                    .is_module = payload.is_module != 0,
                }) catch |err| {
                    self.allocator.free(path);
                    self.copy_error = err;
                };
            },
            c.LORE_EVENT_REVISION_RESTORE_FILE_END => self.processed_files = ev.*.unnamed_0.revision_restore_file_end.count,
            c.LORE_EVENT_REVISION_RESTORE_FRAGMENT_BEGIN => self.fragments.expected = ev.*.unnamed_0.revision_restore_fragment_begin.fragments,
            c.LORE_EVENT_REVISION_RESTORE_FRAGMENT_PROGRESS => {
                const payload = ev.*.unnamed_0.revision_restore_fragment_progress;
                self.fragments.completed = payload.complete;
                self.fragments.total = payload.count;
            },
            c.LORE_EVENT_REVISION_RESTORE_FRAGMENT_END => self.fragments.transferred = ev.*.unnamed_0.revision_restore_fragment_end.fragments,
            c.LORE_EVENT_REVISION_RESTORE_REVISION => {
                const payload = ev.*.unnamed_0.revision_restore_revision;
                self.restored_revision = .{
                    .revision = hashValue(payload.revision),
                    .revision_number = payload.revision_number,
                };
            },
            c.LORE_EVENT_REVISION_RESTORE_SYNC_BEGIN => self.expected_sync_changes = ev.*.unnamed_0.revision_restore_sync_begin.count,
            c.LORE_EVENT_REVISION_RESTORE_SYNC_END => self.applied_sync_changes = ev.*.unnamed_0.revision_restore_sync_end.count,
            c.LORE_EVENT_REVISION_COMMIT_PROGRESS => self.commit_counts = commitCounts(ev.*.unnamed_0.revision_commit_progress.count),
            c.LORE_EVENT_REVISION_COMMIT_END => self.commit_counts = commitCounts(ev.*.unnamed_0.revision_commit_end.count),
            c.LORE_EVENT_REVISION_COMMIT_REVISION => self.committed_revision = commitRevision(ev.*.unnamed_0.revision_commit_revision),
            c.LORE_EVENT_METADATA => {
                var entry = copyMetadataEntry(self.allocator, ev.*.unnamed_0.metadata) catch |err| {
                    self.copy_error = err;
                    return;
                };
                self.metadata.append(self.allocator, entry) catch |err| {
                    entry.deinit(self.allocator);
                    self.copy_error = err;
                };
            },
            else => {},
        }
    }
};

/// Restore the current branch to Lore's previously synced revision and auto-commit it with
/// `message`. v0.8.6 exposes NO target revision argument on this operation. Use `fileWrite`
/// for non-destructive arbitrary-revision preview/materialization; never pretend this call
/// can select a historical revision.
pub fn revisionRestore(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    message: []const u8,
) Error!RevisionRestoreResult {
    if (!available()) return error.LoreUnavailable;
    var g = try globals(repository_path, identity);
    var args = std.mem.zeroes(c.lore_revision_restore_args_t);
    args.message = str(message);
    var collector = RevisionRestoreCollector{ .allocator = allocator };
    defer collector.deinit();
    const return_status = c.lore_revision_restore(&g, &args, collector.callback());
    try finishCall("revision restore", &collector.status, return_status);
    if (collector.copy_error) |err| return err;
    const files = try collector.files.toOwnedSlice(allocator);
    errdefer {
        for (files) |*file| file.deinit(allocator);
        allocator.free(files);
    }
    const metadata = try collector.metadata.toOwnedSlice(allocator);
    return .{
        .expected_files = collector.expected_files,
        .processed_files = collector.processed_files,
        .files = files,
        .fragments = collector.fragments,
        .restored_revision = collector.restored_revision,
        .expected_sync_changes = collector.expected_sync_changes,
        .applied_sync_changes = collector.applied_sync_changes,
        .commit_counts = collector.commit_counts,
        .committed_revision = collector.committed_revision,
        .metadata = metadata,
    };
}

pub const BranchPushHeader = struct {
    remote: []u8,
    repository: Identifier,
    branch: Identifier,
    branch_name: []u8,
    remote_revision: Hash,
    local_revision: Hash,
    remote_history: u64,
    local_history: u64,
    already_pushed: bool,
    is_default: bool,
    is_link: bool,
    is_layer: bool,

    pub fn deinit(self: *BranchPushHeader, allocator: std.mem.Allocator) void {
        allocator.free(self.remote);
        allocator.free(self.branch_name);
        self.* = undefined;
    }
};

pub const BranchPushFragments = struct {
    expected: u64 = 0,
    completed: u64 = 0,
    total: u64 = 0,
    bytes_transferred: u64 = 0,
    bytes_total: u64 = 0,
};

pub const BranchPushRevisionUpdate = struct {
    old_revision: Hash,
    new_revision: Hash,
    new_revision_number: u64,
};

pub const BranchPushEnd = struct {
    old_remote_revision: Hash,
    new_remote_revision: Hash,
    new_remote_revision_number: u64,
    message: []u8,
    fast_forward_merged: bool,

    pub fn deinit(self: *BranchPushEnd, allocator: std.mem.Allocator) void {
        allocator.free(self.message);
        self.* = undefined;
    }
};

pub const BranchPushResult = struct {
    header: ?BranchPushHeader,
    parent_rewrites: u64,
    fragments: BranchPushFragments,
    branch_created: bool,
    created_remote_revision: ?Hash,
    revision_updates: []BranchPushRevisionUpdate,
    final: ?BranchPushEnd,

    pub fn deinit(self: *BranchPushResult, allocator: std.mem.Allocator) void {
        if (self.header) |*header| header.deinit(allocator);
        allocator.free(self.revision_updates);
        if (self.final) |*final| final.deinit(allocator);
        self.* = undefined;
    }
};

pub const BranchPushOptions = struct {
    branch: []const u8 = "",
    fast_forward_merge: bool = false,
};

const BranchPushCollector = struct {
    allocator: std.mem.Allocator,
    status: StatusCollector = .{},
    header: ?BranchPushHeader = null,
    parent_rewrites: u64 = 0,
    fragments: BranchPushFragments = .{},
    branch_created: bool = false,
    created_remote_revision: ?Hash = null,
    revision_updates: std.ArrayList(BranchPushRevisionUpdate) = .empty,
    final: ?BranchPushEnd = null,
    copy_error: ?Error = null,

    fn callback(self: *BranchPushCollector) c.lore_event_callback_config_t {
        return .{ .user_context = @intFromPtr(self), .func = trampoline };
    }

    fn deinit(self: *BranchPushCollector) void {
        if (self.header) |*header| header.deinit(self.allocator);
        self.revision_updates.deinit(self.allocator);
        if (self.final) |*final| final.deinit(self.allocator);
    }

    fn copyHeader(self: *BranchPushCollector, payload: c.lore_branch_push_event_data_t) Error!BranchPushHeader {
        const remote = try self.allocator.dupe(u8, strSlice(payload.remote));
        errdefer self.allocator.free(remote);
        const branch_name = try self.allocator.dupe(u8, strSlice(payload.branch_name));
        return .{
            .remote = remote,
            .repository = repositoryId(payload.repository),
            .branch = branchId(payload.branch),
            .branch_name = branch_name,
            .remote_revision = hashValue(payload.remote_revision),
            .local_revision = hashValue(payload.local_revision),
            .remote_history = payload.remote_history,
            .local_history = payload.local_history,
            .already_pushed = payload.flag_already_pushed != 0,
            .is_default = payload.flag_default != 0,
            .is_link = payload.flag_link != 0,
            .is_layer = payload.flag_layer != 0,
        };
    }

    fn trampoline(event: [*c]const c.lore_event_t, user_context: u64) callconv(.c) void {
        const self: *BranchPushCollector = @ptrFromInt(user_context);
        const ev = event orelse return;
        self.status.observe(ev);
        if (self.copy_error != null) return;
        switch (ev.*.tag) {
            c.LORE_EVENT_BRANCH_PUSH => {
                if (self.header != null) return;
                self.header = self.copyHeader(ev.*.unnamed_0.branch_push) catch |err| {
                    self.copy_error = err;
                    return;
                };
            },
            c.LORE_EVENT_BRANCH_PUSH_REVISION_UPDATE_END => self.parent_rewrites += 1,
            c.LORE_EVENT_BRANCH_PUSH_FRAGMENT_BEGIN => {
                const payload = ev.*.unnamed_0.branch_push_fragment_begin;
                self.fragments.expected = payload.fragments;
                self.fragments.bytes_total = payload.bytes_total;
            },
            c.LORE_EVENT_BRANCH_PUSH_FRAGMENT_PROGRESS => {
                const payload = ev.*.unnamed_0.branch_push_fragment_progress;
                self.fragments.completed = payload.complete;
                self.fragments.total = payload.count;
                self.fragments.bytes_transferred = payload.bytes_transferred;
                self.fragments.bytes_total = payload.bytes_total;
            },
            c.LORE_EVENT_BRANCH_PUSH_FRAGMENT_END => {
                const payload = ev.*.unnamed_0.branch_push_fragment_end;
                self.fragments.completed = payload.fragments;
                self.fragments.bytes_transferred = payload.bytes_transferred;
            },
            c.LORE_EVENT_BRANCH_PUSH_BRANCH_CREATE_END => {
                self.branch_created = true;
                self.created_remote_revision = hashValue(ev.*.unnamed_0.branch_push_branch_create_end.remote_revision);
            },
            c.LORE_EVENT_BRANCH_PUSH_REVISION_PUSH_UPDATE => {
                const payload = ev.*.unnamed_0.branch_push_revision_push_update;
                self.revision_updates.append(self.allocator, .{
                    .old_revision = hashValue(payload.old_revision),
                    .new_revision = hashValue(payload.new_revision),
                    .new_revision_number = payload.new_revision_number,
                }) catch |err| {
                    self.copy_error = err;
                };
            },
            c.LORE_EVENT_BRANCH_PUSH_REVISION_PUSH_END => {
                if (self.final) |*final| {
                    final.deinit(self.allocator);
                    self.final = null;
                }
                const payload = ev.*.unnamed_0.branch_push_revision_push_end;
                const message = self.allocator.dupe(u8, strSlice(payload.message)) catch |err| {
                    self.copy_error = err;
                    return;
                };
                self.final = .{
                    .old_remote_revision = hashValue(payload.old_remote_revision),
                    .new_remote_revision = hashValue(payload.new_remote_revision),
                    .new_remote_revision_number = payload.new_remote_revision_number,
                    .message = message,
                    .fast_forward_merged = payload.fast_forward_merged != 0,
                };
            },
            else => {},
        }
    }
};

/// Explicit network operation for the normal-save path. All snapshot/stage/commit wrappers
/// remain `offline=1`; this is the only wrapper here that clears it and may contact Lore's
/// server. A failed push never invalidates the already durable local commit.
pub fn branchPush(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    identity: []const u8,
    options: BranchPushOptions,
) Error!BranchPushResult {
    if (!available()) return error.LoreUnavailable;
    var g = try globals(repository_path, identity);
    g.offline = 0;
    var args = std.mem.zeroes(c.lore_branch_push_args_t);
    args.branch = if (options.branch.len == 0) empty_str else str(options.branch);
    args.fast_forward_merge = @intFromBool(options.fast_forward_merge);
    var collector = BranchPushCollector{ .allocator = allocator };
    defer collector.deinit();
    const return_status = c.lore_branch_push(&g, &args, collector.callback());
    try finishCall("branch push", &collector.status, return_status);
    if (collector.copy_error) |err| return err;
    const revision_updates = try collector.revision_updates.toOwnedSlice(allocator);
    const result: BranchPushResult = .{
        .header = collector.header,
        .parent_rewrites = collector.parent_rewrites,
        .fragments = collector.fragments,
        .branch_created = collector.branch_created,
        .created_remote_revision = collector.created_remote_revision,
        .revision_updates = revision_updates,
        .final = collector.final,
    };
    collector.header = null;
    collector.final = null;
    return result;
}

/// liblore's own version string, e.g. "0.8.6+373". Also the cheapest proof that the
/// library actually loaded — if this is empty, nothing else here will work.
///
/// Note this is the one call that does NOT return a `lore_string_t`: the header declares
/// `const char *lore_version(void)`, NUL-terminated and owned by the library. Verified
/// against the real signature after an earlier version of this file assumed otherwise.
pub fn version() []const u8 {
    const ptr = c.lore_version() orelse return &.{};
    return std.mem.span(ptr);
}

/// Release liblore's global state. Safe to call once at host shutdown.
pub fn shutdown() void {
    c.lore_shutdown();
}

/// Is liblore present and callable? Callers must degrade rather than crash when Lore is
/// missing — a version-control outage must never take the editor down with it.
pub fn available() bool {
    if (version().len == 0) {
        log.print("[lore] liblore returned an empty version — treating as unavailable\n", .{});
        return false;
    }
    return true;
}
