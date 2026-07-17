//! Local AI runtime — background llama.cpp-backed inference service.
//!
//! Goals:
//!   - keep inference fully off the UI/render thread
//!   - expose a simple submit/poll session surface for QJS/Lua bridges
//!   - avoid a hard link-time dependency on llama symbols by dlopen'ing
//!     `libllama_ffi` on demand
//!
//! This initial version is chat-oriented and intentionally narrow:
//!   - one long-lived model/context per session
//!   - background thread handles all prompt formatting + decode work
//!   - main thread only submits text and polls events
//!   - designed so future task kinds (embed, summarize_file, rag_answer)
//!     can reuse the same queue/session infrastructure

const std = @import("std");
const host_io = @import("../host_io.zig");
const RingBuffer = @import("../net/ring_buffer.zig").RingBuffer;

// Authoritative llama.cpp types via @cImport — struct layouts come straight
// from llama.h, no hand-translation drift. We only use these for type
// definitions; symbols are dlsym'd at runtime from lmstudio's libllama.so.
const c = @cImport({
    @cInclude("llama.h");
});

const llama_model = c.struct_llama_model;
const llama_context = c.struct_llama_context;
const llama_sampler = c.struct_llama_sampler;
const llama_vocab = c.struct_llama_vocab;
const llama_memory = c.llama_memory_t;
const llama_pos = c.llama_pos;
const llama_token = c.llama_token;
const llama_seq_id = c.llama_seq_id;

// Padded wrappers around the cImported params structs. lmstudio's
// libllama.so was built against a llama.cpp newer than (or patched
// from) the llama.h we have on hand — its actual struct is bigger.
// We pass `base + pad` so that whatever extra fields lmstudio reads
// land in the zero-pad region instead of stack garbage. Without this
// pad, lmstudio's progress_callback offset would land in uninit
// stack and ~always be non-null → "cancelled model load".
const llama_model_params = extern struct {
    base: c.struct_llama_model_params,
    _pad: [256]u8 = [_]u8{0} ** 256,
};
const llama_context_params = extern struct {
    base: c.struct_llama_context_params,
    _pad: [256]u8 = [_]u8{0} ** 256,
};
const llama_sampler_chain_params = c.struct_llama_sampler_chain_params;
const llama_batch = c.struct_llama_batch;
const llama_chat_message = c.struct_llama_chat_message;

// llama.cpp is loaded at runtime via dlopen from one of LM Studio's
// pre-built backend bundles (~/.lmstudio/extensions/backends/<dir>/).
// Default pick is ROCm (HIP runtime) so there is no Vulkan code in the
// loaded .so — that structurally avoids the ggml-vulkan vs wgpu
// VkInstance fight that killed the previous link-time path. Override
// with the env var RJIT_LLM_BACKEND=cuda12|rocm|vulkan|cpu, or override
// the entire dir with RJIT_LLM_BACKEND_DIR=/abs/path.
//
// Hot-path performance is the same as link-time once loaded — every call
// goes through a fn-pointer in the LlamaApi struct, no per-call dlsym.
extern "c" fn setenv(name: [*:0]const u8, value: [*:0]const u8, overwrite: c_int) c_int;
extern "c" fn getenv(name: [*:0]const u8) ?[*:0]const u8;
extern "c" fn dlopen(filename: ?[*:0]const u8, flags: c_int) ?*anyopaque;
extern "c" fn dlerror() ?[*:0]const u8;
const RTLD_NOW: c_int = 2;
const RTLD_GLOBAL: c_int = 0x100;

const lmstudio_backends_root = "/home/siah/.lmstudio/extensions/backends";
const rocm_vendor_dir = lmstudio_backends_root ++ "/vendor/linux-llama-rocm-vendor-v3";
const cuda_vendor_dir = lmstudio_backends_root ++ "/vendor/linux-llama-cuda-vendor-v3";

const BackendKind = enum { rocm, cuda12, vulkan, cpu };

fn pickBackendDirAlloc(allocator: std.mem.Allocator) ![:0]u8 {
    if (getenv("RJIT_LLM_BACKEND_DIR")) |dir| {
        return try allocator.dupeZ(u8, std.mem.span(dir));
    }
    const want: BackendKind = blk: {
        if (getenv("RJIT_LLM_BACKEND")) |v| {
            const s = std.mem.span(v);
            if (std.mem.eql(u8, s, "rocm")) break :blk .rocm;
            if (std.mem.eql(u8, s, "cuda12")) break :blk .cuda12;
            if (std.mem.eql(u8, s, "cuda")) break :blk .cuda12;
            if (std.mem.eql(u8, s, "vulkan")) break :blk .vulkan;
            if (std.mem.eql(u8, s, "cpu")) break :blk .cpu;
        }
        break :blk .rocm;
    };
    const prefix = switch (want) {
        .rocm => "llama.cpp-linux-x86_64-amd-rocm-avx2-",
        .cuda12 => "llama.cpp-linux-x86_64-nvidia-cuda12-avx2-",
        .vulkan => "llama.cpp-linux-x86_64-vulkan-avx2-",
        .cpu => "llama.cpp-linux-x86_64-avx2-",
    };
    var dir = try std.fs.openDirAbsolute(lmstudio_backends_root, .{ .iterate = true });
    defer dir.close();
    var it = dir.iterate();
    var best: ?[]u8 = null;
    errdefer if (best) |b| allocator.free(b);
    while (try it.next()) |entry| {
        if (entry.kind != .directory) continue;
        if (!std.mem.startsWith(u8, entry.name, prefix)) continue;
        if (best) |prev| {
            if (std.mem.order(u8, entry.name, prev) == .gt) {
                allocator.free(prev);
                best = try allocator.dupe(u8, entry.name);
            }
        } else {
            best = try allocator.dupe(u8, entry.name);
        }
    }
    const name = best orelse return error.NoLmStudioBackend;
    defer allocator.free(name);
    return try std.fmt.allocPrintSentinel(allocator, "{s}/{s}", .{ lmstudio_backends_root, name }, 0);
}

fn vendorDirFor(backend_dir: []const u8) ?[]const u8 {
    if (std.mem.indexOf(u8, backend_dir, "rocm") != null) return rocm_vendor_dir;
    if (std.mem.indexOf(u8, backend_dir, "cuda") != null) return cuda_vendor_dir;
    return null;
}

// Preload every .so in `dir` with RTLD_NOW | RTLD_GLOBAL so the recursive
// resolver inside dlopen("libllama.so") finds the SONAMEs already
// resident — no LD_LIBRARY_PATH dance required, immune to glibc's mid-
// process LD_LIBRARY_PATH caching quirks. We deliberately skip libllama.so
// itself; that one gets a separate dlopen with RTLD_LOCAL so its symbols
// don't collide with framework/embed.zig's link-time libllama_ffi.
fn preloadDir(allocator: std.mem.Allocator, dir_path: []const u8) !void {
    var dir = std.fs.openDirAbsolute(dir_path, .{ .iterate = true }) catch |err| {
        std.log.warn("[localai] preload: openDir {s}: {s}", .{ dir_path, @errorName(err) });
        return;
    };
    defer dir.close();
    var it = dir.iterate();
    while (try it.next()) |entry| {
        if (entry.kind != .file and entry.kind != .sym_link) continue;
        if (std.mem.indexOf(u8, entry.name, ".so") == null) continue;
        if (std.mem.eql(u8, entry.name, "libllama.so")) continue;
        const full = try std.fmt.allocPrintSentinel(allocator, "{s}/{s}", .{ dir_path, entry.name }, 0);
        defer allocator.free(full);
        if (dlopen(full.ptr, RTLD_NOW | RTLD_GLOBAL) == null) {
            const err_msg = if (dlerror()) |e| std.mem.span(e) else "unknown";
            std.log.warn("[localai] preload {s}: {s}", .{ entry.name, err_msg });
        }
    }
}

pub const SessionOptions = struct {
    cwd: ?[]const u8 = null,
    model_path: []const u8,
    session_id: ?[]const u8 = null,
    system_prompt: ?[]const u8 = null,
    n_ctx: u32 = 2048,
    n_batch: u32 = 512,
    n_ubatch: u32 = 256,
    n_threads: i32 = 4,
    n_threads_batch: i32 = 4,
    n_gpu_layers: i32 = 99,
    max_history_messages: usize = 24,
    verbose: bool = true,
};

pub const TaskKind = enum {
    chat,
};

pub const SubmitOptions = struct {
    text: []const u8,
    task: TaskKind = .chat,
    system_prompt: ?[]const u8 = null,
    max_tokens: u32 = 256,
};

pub const EventKind = enum {
    system,
    assistant_part,
    status,
    result,
};

pub const OwnedEvent = struct {
    allocator: std.mem.Allocator = undefined,
    kind: EventKind,
    text: ?[]u8 = null,
    model: ?[]u8 = null,
    session_id: ?[]u8 = null,
    part_type: ?[]const u8 = null,
    is_error: bool = false,

    pub fn deinit(self: *OwnedEvent) void {
        if (self.text) |value| self.allocator.free(value);
        if (self.model) |value| self.allocator.free(value);
        if (self.session_id) |value| self.allocator.free(value);
    }
};

const Request = struct {
    text: []u8,
    task: TaskKind,
    system_prompt: ?[]u8,
    max_tokens: u32,

    fn deinit(self: *Request, allocator: std.mem.Allocator) void {
        allocator.free(self.text);
        if (self.system_prompt) |value| allocator.free(value);
    }
};

const HistoryRole = enum {
    system,
    user,
    assistant,
};

const HistoryMessage = struct {
    role: HistoryRole,
    content: []u8,

    fn deinit(self: *HistoryMessage, allocator: std.mem.Allocator) void {
        allocator.free(self.content);
    }
};

// dlopen-loaded llama.cpp from one of LM Studio's pre-built backend
// bundles. Loaded once per Session at .load(); fn pointers are dlsym'd
// up-front so hot-path calls are pointer-deref + ABI call only — same
// cost as link-time. RTLD_LOCAL keeps these symbols private so they
// can't collide with framework/embed.zig's link-time libllama_ffi
// symbols (which are a different llama.cpp build, on Vulkan).
const LlamaApi = struct {
    handle: std.DynLib,
    backend_init: *const fn () callconv(.c) void,
    model_default_params: *const fn () callconv(.c) llama_model_params,
    context_default_params: *const fn () callconv(.c) llama_context_params,
    sampler_chain_default_params: *const fn () callconv(.c) llama_sampler_chain_params,
    model_load_from_file: *const fn (path: [*:0]const u8, params: llama_model_params) callconv(.c) ?*llama_model,
    model_free: *const fn (model: *llama_model) callconv(.c) void,
    model_get_vocab: *const fn (model: *const llama_model) callconv(.c) *const llama_vocab,
    model_chat_template: *const fn (model: *const llama_model, name: ?[*:0]const u8) callconv(.c) ?[*:0]const u8,
    vocab_is_eog: *const fn (vocab: *const llama_vocab, token: llama_token) callconv(.c) bool,
    init_from_model: *const fn (model: *llama_model, params: llama_context_params) callconv(.c) ?*llama_context,
    free_context: *const fn (ctx: *llama_context) callconv(.c) void,
    tokenize: *const fn (vocab: *const llama_vocab, text: [*]const u8, text_len: i32, tokens: ?*llama_token, n_max: i32, add_special: bool, parse_special: bool) callconv(.c) i32,
    token_to_piece: *const fn (vocab: *const llama_vocab, token: llama_token, buf: [*]u8, length: i32, lstrip: i32, special: bool) callconv(.c) i32,
    chat_apply_template: *const fn (tmpl: ?[*:0]const u8, chat: [*]const llama_chat_message, n_msg: usize, add_ass: bool, buf: ?[*]u8, length: i32) callconv(.c) i32,
    batch_get_one: *const fn (tokens: *llama_token, n_tokens: i32) callconv(.c) llama_batch,
    decode: *const fn (ctx: *llama_context, batch: llama_batch) callconv(.c) i32,
    sampler_chain_init: *const fn (params: llama_sampler_chain_params) callconv(.c) ?*llama_sampler,
    sampler_chain_add: *const fn (chain: *llama_sampler, smpl: *llama_sampler) callconv(.c) void,
    sampler_free: *const fn (smpl: *llama_sampler) callconv(.c) void,
    sampler_init_top_k: *const fn (k: i32) callconv(.c) ?*llama_sampler,
    sampler_init_top_p: *const fn (p: f32, min_keep: usize) callconv(.c) ?*llama_sampler,
    sampler_init_min_p: *const fn (p: f32, min_keep: usize) callconv(.c) ?*llama_sampler,
    sampler_init_temp: *const fn (t: f32) callconv(.c) ?*llama_sampler,
    sampler_init_penalties: *const fn (n: i32, repeat: f32, freq: f32, present: f32) callconv(.c) ?*llama_sampler,
    sampler_init_dist: *const fn (seed: u32) callconv(.c) ?*llama_sampler,
    sampler_sample: *const fn (smpl: *llama_sampler, ctx: *llama_context, idx: i32) callconv(.c) llama_token,
    get_memory: *const fn (ctx: *llama_context) callconv(.c) ?*llama_memory,
    memory_clear: *const fn (mem: *llama_memory, data: bool) callconv(.c) void,
    backend_dir: [:0]u8,
    allocator: std.mem.Allocator,

    fn load(allocator: std.mem.Allocator, _: ?[]const u8) !LlamaApi {
        const backend_dir = try pickBackendDirAlloc(allocator);
        errdefer allocator.free(backend_dir);

        std.log.info("[localai] dlopen backend: {s}", .{backend_dir});

        // Preload vendor (HIP/CUDA runtime) first, then the backend's own
        // ggml siblings, both with RTLD_GLOBAL. Recursive resolver inside
        // the libllama.so dlopen finds the SONAMEs already loaded and
        // skips the disk search entirely.
        if (vendorDirFor(backend_dir)) |vdir| {
            try preloadDir(allocator, vdir);
        }
        try preloadDir(allocator, backend_dir);

        const libllama_path = try std.fmt.allocPrintSentinel(allocator, "{s}/libllama.so", .{backend_dir}, 0);
        defer allocator.free(libllama_path);

        var handle = std.DynLib.open(libllama_path) catch |err| {
            const dlerr = if (dlerror()) |e| std.mem.span(e) else "(no dlerror)";
            std.log.err("[localai] dlopen {s} failed: {s} — dlerror: {s}", .{ libllama_path, @errorName(err), dlerr });
            return error.LlamaOpenFailed;
        };
        errdefer handle.close();

        return LlamaApi{
            .handle = handle,
            .allocator = allocator,
            .backend_dir = backend_dir,
            .backend_init = handle.lookup(*const fn () callconv(.c) void, "llama_backend_init") orelse return error.SymMissing,
            .model_default_params = handle.lookup(*const fn () callconv(.c) llama_model_params, "llama_model_default_params") orelse return error.SymMissing,
            .context_default_params = handle.lookup(*const fn () callconv(.c) llama_context_params, "llama_context_default_params") orelse return error.SymMissing,
            .sampler_chain_default_params = handle.lookup(*const fn () callconv(.c) llama_sampler_chain_params, "llama_sampler_chain_default_params") orelse return error.SymMissing,
            .model_load_from_file = handle.lookup(*const fn (path: [*:0]const u8, params: llama_model_params) callconv(.c) ?*llama_model, "llama_model_load_from_file") orelse return error.SymMissing,
            .model_free = handle.lookup(*const fn (model: *llama_model) callconv(.c) void, "llama_model_free") orelse return error.SymMissing,
            .model_get_vocab = handle.lookup(*const fn (model: *const llama_model) callconv(.c) *const llama_vocab, "llama_model_get_vocab") orelse return error.SymMissing,
            .model_chat_template = handle.lookup(*const fn (model: *const llama_model, name: ?[*:0]const u8) callconv(.c) ?[*:0]const u8, "llama_model_chat_template") orelse return error.SymMissing,
            .vocab_is_eog = handle.lookup(*const fn (vocab: *const llama_vocab, token: llama_token) callconv(.c) bool, "llama_vocab_is_eog") orelse return error.SymMissing,
            .init_from_model = handle.lookup(*const fn (model: *llama_model, params: llama_context_params) callconv(.c) ?*llama_context, "llama_init_from_model") orelse return error.SymMissing,
            .free_context = handle.lookup(*const fn (ctx: *llama_context) callconv(.c) void, "llama_free") orelse return error.SymMissing,
            .tokenize = handle.lookup(*const fn (vocab: *const llama_vocab, text: [*]const u8, text_len: i32, tokens: ?*llama_token, n_max: i32, add_special: bool, parse_special: bool) callconv(.c) i32, "llama_tokenize") orelse return error.SymMissing,
            .token_to_piece = handle.lookup(*const fn (vocab: *const llama_vocab, token: llama_token, buf: [*]u8, length: i32, lstrip: i32, special: bool) callconv(.c) i32, "llama_token_to_piece") orelse return error.SymMissing,
            .chat_apply_template = handle.lookup(*const fn (tmpl: ?[*:0]const u8, chat: [*]const llama_chat_message, n_msg: usize, add_ass: bool, buf: ?[*]u8, length: i32) callconv(.c) i32, "llama_chat_apply_template") orelse return error.SymMissing,
            .batch_get_one = handle.lookup(*const fn (tokens: *llama_token, n_tokens: i32) callconv(.c) llama_batch, "llama_batch_get_one") orelse return error.SymMissing,
            .decode = handle.lookup(*const fn (ctx: *llama_context, batch: llama_batch) callconv(.c) i32, "llama_decode") orelse return error.SymMissing,
            .sampler_chain_init = handle.lookup(*const fn (params: llama_sampler_chain_params) callconv(.c) ?*llama_sampler, "llama_sampler_chain_init") orelse return error.SymMissing,
            .sampler_chain_add = handle.lookup(*const fn (chain: *llama_sampler, smpl: *llama_sampler) callconv(.c) void, "llama_sampler_chain_add") orelse return error.SymMissing,
            .sampler_free = handle.lookup(*const fn (smpl: *llama_sampler) callconv(.c) void, "llama_sampler_free") orelse return error.SymMissing,
            .sampler_init_top_k = handle.lookup(*const fn (k: i32) callconv(.c) ?*llama_sampler, "llama_sampler_init_top_k") orelse return error.SymMissing,
            .sampler_init_top_p = handle.lookup(*const fn (p: f32, min_keep: usize) callconv(.c) ?*llama_sampler, "llama_sampler_init_top_p") orelse return error.SymMissing,
            .sampler_init_min_p = handle.lookup(*const fn (p: f32, min_keep: usize) callconv(.c) ?*llama_sampler, "llama_sampler_init_min_p") orelse return error.SymMissing,
            .sampler_init_temp = handle.lookup(*const fn (t: f32) callconv(.c) ?*llama_sampler, "llama_sampler_init_temp") orelse return error.SymMissing,
            .sampler_init_penalties = handle.lookup(*const fn (n: i32, repeat: f32, freq: f32, present: f32) callconv(.c) ?*llama_sampler, "llama_sampler_init_penalties") orelse return error.SymMissing,
            .sampler_init_dist = handle.lookup(*const fn (seed: u32) callconv(.c) ?*llama_sampler, "llama_sampler_init_dist") orelse return error.SymMissing,
            .sampler_sample = handle.lookup(*const fn (smpl: *llama_sampler, ctx: *llama_context, idx: i32) callconv(.c) llama_token, "llama_sampler_sample") orelse return error.SymMissing,
            .get_memory = handle.lookup(*const fn (ctx: *llama_context) callconv(.c) ?*llama_memory, "llama_get_memory") orelse return error.SymMissing,
            .memory_clear = handle.lookup(*const fn (mem: *llama_memory, data: bool) callconv(.c) void, "llama_memory_clear") orelse return error.SymMissing,
        };
    }

    fn close(self: *LlamaApi) void {
        self.handle.close();
        self.allocator.free(self.backend_dir);
    }
};

const WorkerState = struct {
    allocator: std.mem.Allocator,
    options: SessionOptions,
    api: ?LlamaApi = null,
    resolved_model_path: ?[]u8 = null,
    model: ?*llama_model = null,
    ctx: ?*llama_context = null,
    vocab: ?*const llama_vocab = null,
    chat_template: ?[:0]u8 = null,
    history: std.ArrayList(HistoryMessage),

    fn init(allocator: std.mem.Allocator, options: SessionOptions) WorkerState {
        return .{
            .allocator = allocator,
            .options = options,
            .history = .{},
        };
    }

    fn deinit(self: *WorkerState) void {
        for (self.history.items) |*item| item.deinit(self.allocator);
        self.history.deinit(self.allocator);
        if (self.chat_template) |value| self.allocator.free(value);
        if (self.ctx) |ctx| {
            if (self.api) |api| api.free_context(ctx);
        }
        if (self.model) |model| {
            if (self.api) |api| api.model_free(model);
        }
        if (self.resolved_model_path) |value| self.allocator.free(value);
        if (self.api) |*api| api.close();
    }

    fn load(self: *WorkerState) !void {
        var api = try LlamaApi.load(self.allocator, self.options.cwd);
        errdefer api.close();

        self.resolved_model_path = try resolveModelPathAlloc(self.allocator, self.options.cwd, self.options.model_path);
        errdefer {
            if (self.resolved_model_path) |value| self.allocator.free(value);
            self.resolved_model_path = null;
        }

        api.backend_init();

        const model_path_z = try self.allocator.dupeZ(u8, self.resolved_model_path.?);
        defer self.allocator.free(model_path_z);

        // Build mparams from scratch instead of calling default_params().
        // Returning a 72-byte struct by value through a dlsym'd fn pointer
        // was leaving garbage in progress_callback (which then "returned
        // false" mid-load → cancelled model load). Zero-init + explicit
        // sets matches what default_params would have written for a
        // generic GPU-offload chat session, with all callbacks NULL.
        var mparams: llama_model_params = std.mem.zeroes(llama_model_params);
        mparams.base.n_gpu_layers = self.options.n_gpu_layers;
        mparams.base.use_mmap = true;
        mparams.base.use_extra_bufts = true;

        const model = api.model_load_from_file(model_path_z, mparams) orelse return error.ModelLoadFailed;
        errdefer api.model_free(model);

        const vocab = api.model_get_vocab(model);

        if (api.model_chat_template(model, null)) |tmpl| {
            self.chat_template = try self.allocator.dupeZ(u8, std.mem.span(tmpl));
        }

        // Same zero-init + pad strategy as mparams. We DO need a few
        // non-zero defaults (n_seq_max=1, type_k/type_v=GGML_TYPE_F16=1)
        // because llama.cpp's default_params sets non-zero values for
        // these and a zero-init context can fail to allocate KV cache.
        var cparams: llama_context_params = std.mem.zeroes(llama_context_params);
        cparams.base.n_ctx = self.options.n_ctx;
        cparams.base.n_batch = self.options.n_batch;
        cparams.base.n_ubatch = self.options.n_ubatch;
        cparams.base.n_seq_max = 1;
        cparams.base.n_threads = self.options.n_threads;
        cparams.base.n_threads_batch = self.options.n_threads_batch;
        cparams.base.type_k = 1; // GGML_TYPE_F16
        cparams.base.type_v = 1; // GGML_TYPE_F16
        cparams.base.no_perf = true;
        cparams.base.offload_kqv = true;
        cparams.base.op_offload = true;

        const ctx = api.init_from_model(model, cparams) orelse return error.ContextInitFailed;

        self.api = api;
        self.model = model;
        self.ctx = ctx;
        self.vocab = vocab;

        if (self.options.system_prompt) |value| {
            try self.history.append(self.allocator, .{
                .role = .system,
                .content = try self.allocator.dupe(u8, value),
            });
        }
    }

    fn generateReply(self: *WorkerState, session: *Session, req: *const Request) !void {
        const api = &(self.api orelse return error.NotReady);
        const ctx = self.ctx orelse return error.NotReady;
        const vocab = self.vocab orelse return error.NotReady;

        try self.history.append(self.allocator, .{
            .role = .user,
            .content = try self.allocator.dupe(u8, req.text),
        });
        errdefer {
            if (self.history.pop()) |last_value| {
                var last = last_value;
                last.deinit(self.allocator);
            }
        }

        trimHistory(self);

        const formatted = try self.buildPromptText();
        defer self.allocator.free(formatted);

        if (api.get_memory(ctx)) |mem| api.memory_clear(mem, true);

        const n_probe = api.tokenize(vocab, formatted.ptr, @intCast(formatted.len), null, 0, true, true);
        if (n_probe == 0) return error.TokenizeFailed;
        const token_count: i32 = if (n_probe < 0) -n_probe else n_probe;
        const tokens = try self.allocator.alloc(llama_token, @intCast(token_count));
        defer self.allocator.free(tokens);

        const tokenized = api.tokenize(vocab, formatted.ptr, @intCast(formatted.len), @ptrCast(tokens.ptr), token_count, true, true);
        if (tokenized < 0) return error.TokenizeFailed;

        var batch = api.batch_get_one(@ptrCast(tokens.ptr), tokenized);
        const prefill_rc = api.decode(ctx, batch);
        if (prefill_rc != 0) return error.PrefillFailed;

        var sampler_params = api.sampler_chain_default_params();
        sampler_params.no_perf = true;
        const sampler = api.sampler_chain_init(sampler_params) orelse return error.SamplerInitFailed;
        defer api.sampler_free(sampler);

        api.sampler_chain_add(sampler, api.sampler_init_top_k(40) orelse return error.SamplerInitFailed);
        api.sampler_chain_add(sampler, api.sampler_init_top_p(0.9, 1) orelse return error.SamplerInitFailed);
        api.sampler_chain_add(sampler, api.sampler_init_min_p(0.05, 1) orelse return error.SamplerInitFailed);
        api.sampler_chain_add(sampler, api.sampler_init_temp(0.7) orelse return error.SamplerInitFailed);
        api.sampler_chain_add(sampler, api.sampler_init_penalties(64, 1.1, 0, 0) orelse return error.SamplerInitFailed);
        api.sampler_chain_add(sampler, api.sampler_init_dist(@intCast(@mod(host_io.milliTimestamp(), std.math.maxInt(u32)))) orelse return error.SamplerInitFailed);

        var out: std.ArrayList(u8) = .empty;
        defer out.deinit(self.allocator);

        var generated: u32 = 0;
        while (!session.should_stop.load(.seq_cst) and generated < req.max_tokens) : (generated += 1) {
            var token_id = api.sampler_sample(sampler, ctx, -1);
            if (api.vocab_is_eog(vocab, token_id)) break;

            var piece_buf: [512]u8 = undefined;
            const piece_len = api.token_to_piece(vocab, token_id, &piece_buf, piece_buf.len, 0, false);
            if (piece_len < 0) return error.PieceDecodeFailed;
            if (piece_len > 0) {
                const piece = piece_buf[0..@intCast(piece_len)];
                try out.appendSlice(self.allocator, piece);
                try session.pushAssistantPart(piece);
            }

            batch = api.batch_get_one(&token_id, 1);
            const decode_rc = api.decode(ctx, batch);
            if (decode_rc != 0) return error.DecodeFailed;
        }

        if (session.should_stop.load(.seq_cst)) return;

        const reply = try out.toOwnedSlice(self.allocator);
        errdefer self.allocator.free(reply);
        try self.history.append(self.allocator, .{
            .role = .assistant,
            .content = reply,
        });
        trimHistory(self);
    }

    fn buildPromptText(self: *WorkerState) ![]u8 {
        if (self.chat_template) |tmpl| {
            const n = self.history.items.len;
            const c_msgs = try self.allocator.alloc(llama_chat_message, n);
            defer self.allocator.free(c_msgs);

            const role_z = try self.allocator.alloc([:0]u8, n);
            defer self.allocator.free(role_z);
            const content_z = try self.allocator.alloc([:0]u8, n);
            defer {
                for (content_z) |value| self.allocator.free(value);
            }

            for (self.history.items, 0..) |msg, i| {
                role_z[i] = try self.allocator.dupeZ(u8, roleName(msg.role));
                content_z[i] = try self.allocator.dupeZ(u8, msg.content);
                c_msgs[i] = .{
                    .role = role_z[i].ptr,
                    .content = content_z[i].ptr,
                };
            }

            const api = &(self.api orelse return error.NotReady);
            const needed = api.chat_apply_template(tmpl.ptr, c_msgs.ptr, n, true, null, 0);
            if (needed < 0) return error.TemplateFailed;

            const buf = try self.allocator.alloc(u8, @intCast(needed + 1));
            errdefer self.allocator.free(buf);

            const written = api.chat_apply_template(tmpl.ptr, c_msgs.ptr, n, true, buf.ptr, needed + 1);
            if (written < 0) return error.TemplateFailed;
            return buf[0..@intCast(written)];
        }

        var buf: std.ArrayList(u8) = .empty;
        defer buf.deinit(self.allocator);

        for (self.history.items) |msg| {
            try buf.writer(self.allocator).print("{s}: {s}\n", .{ roleName(msg.role), msg.content });
        }
        try buf.appendSlice(self.allocator, "assistant: ");
        return try buf.toOwnedSlice(self.allocator);
    }
};

pub const Session = struct {
    allocator: std.mem.Allocator,
    options: SessionOptions,
    requests: RingBuffer(Request, 32) = .{},
    events: RingBuffer(OwnedEvent, 1024) = .{},
    worker: ?std.Thread = null,
    should_stop: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    pub fn create(allocator: std.mem.Allocator, options: SessionOptions) !*Session {
        const session = try allocator.create(Session);
        errdefer allocator.destroy(session);

        session.* = .{
            .allocator = allocator,
            .options = .{
                .cwd = if (options.cwd) |value| try allocator.dupe(u8, value) else null,
                .model_path = try allocator.dupe(u8, options.model_path),
                .session_id = if (options.session_id) |value| try allocator.dupe(u8, value) else null,
                .system_prompt = if (options.system_prompt) |value| try allocator.dupe(u8, value) else null,
                .n_ctx = options.n_ctx,
                .n_batch = options.n_batch,
                .n_ubatch = options.n_ubatch,
                .n_threads = options.n_threads,
                .n_threads_batch = options.n_threads_batch,
                .n_gpu_layers = options.n_gpu_layers,
                .max_history_messages = options.max_history_messages,
                .verbose = options.verbose,
            },
        };
        errdefer session.deinitInternal();

        session.worker = try std.Thread.spawn(.{ .stack_size = 4 * 1024 * 1024 }, workerMain, .{session});
        return session;
    }

    pub fn destroy(self: *Session) void {
        self.close();
        self.deinitInternal();
        self.allocator.destroy(self);
    }

    pub fn close(self: *Session) void {
        self.should_stop.store(true, .seq_cst);
        if (self.worker) |thread| {
            thread.join();
            self.worker = null;
        }
    }

    pub fn submit(self: *Session, options: SubmitOptions) !void {
        if (self.should_stop.load(.seq_cst)) return error.SessionClosed;

        var req = Request{
            .text = try self.allocator.dupe(u8, options.text),
            .task = options.task,
            .system_prompt = if (options.system_prompt) |value| try self.allocator.dupe(u8, value) else null,
            .max_tokens = options.max_tokens,
        };
        errdefer req.deinit(self.allocator);

        if (!self.requests.push(req)) return error.QueueFull;
    }

    pub fn poll(self: *Session) ?OwnedEvent {
        return self.events.pop();
    }

    fn pushAssistantPart(self: *Session, text: []const u8) !void {
        try self.pushEvent(.{
            .kind = .assistant_part,
            .text = try self.allocator.dupe(u8, text),
            .part_type = "text",
        });
    }

    fn pushSystem(self: *Session, model: []const u8, session_id: []const u8) !void {
        try self.pushEvent(.{
            .kind = .system,
            .model = try self.allocator.dupe(u8, model),
            .session_id = try self.allocator.dupe(u8, session_id),
        });
    }

    fn pushStatus(self: *Session, text: []const u8, is_error: bool) !void {
        try self.pushEvent(.{
            .kind = .status,
            .text = try self.allocator.dupe(u8, text),
            .is_error = is_error,
        });
    }

    fn pushResult(self: *Session, text: ?[]const u8, is_error: bool) !void {
        try self.pushEvent(.{
            .kind = .result,
            .text = if (text) |value| try self.allocator.dupe(u8, value) else null,
            .is_error = is_error,
        });
    }

    fn pushEvent(self: *Session, event: OwnedEvent) !void {
        var owned = event;
        owned.allocator = self.allocator;
        if (!self.events.push(owned)) {
            owned.deinit();
            return error.QueueFull;
        }
    }

    fn deinitInternal(self: *Session) void {
        if (self.options.cwd) |value| self.allocator.free(value);
        self.allocator.free(self.options.model_path);
        if (self.options.session_id) |value| self.allocator.free(value);
        if (self.options.system_prompt) |value| self.allocator.free(value);

        while (self.requests.pop()) |req| {
            var owned = req;
            owned.deinit(self.allocator);
        }
        while (self.events.pop()) |evt| {
            var owned = evt;
            owned.deinit();
        }
    }
};

fn workerMain(session: *Session) void {
    var state = WorkerState.init(session.allocator, session.options);
    defer state.deinit();

    session.pushStatus("loading local model...", false) catch {};
    state.load() catch |err| {
        const text = std.fmt.allocPrint(session.allocator, "local init failed: {s}", .{@errorName(err)}) catch null;
        defer if (text) |value| session.allocator.free(value);
        if (text) |value| {
            session.pushStatus(value, true) catch {};
            session.pushResult(value, true) catch {};
        }
        return;
    };

    const model_label = basenameFromPath(state.resolved_model_path.?);
    const session_id = if (session.options.session_id) |value|
        session.allocator.dupe(u8, value) catch null
    else
        std.fmt.allocPrint(session.allocator, "local:{s}", .{model_label}) catch null;
    defer if (session_id) |value| session.allocator.free(value);
    if (session_id) |value| {
        session.pushSystem(state.resolved_model_path.?, value) catch {};
    }
    session.pushStatus("local model ready", false) catch {};

    while (!session.should_stop.load(.seq_cst)) {
        if (session.requests.pop()) |req| {
            var owned = req;
            defer owned.deinit(session.allocator);

            if (owned.system_prompt) |override| {
                setSystemPrompt(&state, override) catch {};
            }

            state.generateReply(session, &owned) catch |err| {
                const text = std.fmt.allocPrint(session.allocator, "local generation failed: {s}", .{@errorName(err)}) catch null;
                defer if (text) |value| session.allocator.free(value);
                if (text) |value| {
                    session.pushStatus(value, true) catch {};
                    session.pushResult(value, true) catch {};
                }
                continue;
            };

            if (!session.should_stop.load(.seq_cst)) {
                session.pushResult(null, false) catch {};
            }
        } else {
            std.Thread.sleep(1 * std.time.ns_per_ms);
        }
    }
}

fn setSystemPrompt(state: *WorkerState, text: []const u8) !void {
    if (state.history.items.len > 0 and state.history.items[0].role == .system) {
        var old = state.history.items[0];
        old.deinit(state.allocator);
        state.history.items[0] = .{
            .role = .system,
            .content = try state.allocator.dupe(u8, text),
        };
        return;
    }

    try state.history.insert(state.allocator, 0, .{
        .role = .system,
        .content = try state.allocator.dupe(u8, text),
    });
}

fn trimHistory(state: *WorkerState) void {
    while (state.history.items.len > state.options.max_history_messages) {
        const remove_idx: usize = if (state.history.items.len > 0 and state.history.items[0].role == .system) 1 else 0;
        if (remove_idx >= state.history.items.len) break;
        var msg = state.history.orderedRemove(remove_idx);
        msg.deinit(state.allocator);
    }
}

fn roleName(role: HistoryRole) []const u8 {
    return switch (role) {
        .system => "system",
        .user => "user",
        .assistant => "assistant",
    };
}

fn basenameFromPath(path: []const u8) []const u8 {
    return std.fs.path.basename(path);
}

fn resolveModelPathAlloc(allocator: std.mem.Allocator, cwd: ?[]const u8, model_path: []const u8) ![]u8 {
    if (std.fs.path.isAbsolute(model_path)) return allocator.dupe(u8, model_path);
    if (cwd) |value| return std.fs.path.join(allocator, &.{ value, model_path });
    return allocator.dupe(u8, model_path);
}

test "basenameFromPath keeps tail segment" {
    try std.testing.expectEqualStrings("qwen.gguf", basenameFromPath("/tmp/models/qwen.gguf"));
}

test "resolveModelPathAlloc joins cwd when relative" {
    const allocator = std.testing.allocator;
    const joined = try resolveModelPathAlloc(allocator, "/tmp/project", "models/qwen.gguf");
    defer allocator.free(joined);
    try std.testing.expectEqualStrings("/tmp/project/models/qwen.gguf", joined);
}
