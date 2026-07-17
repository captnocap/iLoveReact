//! framework/embed.zig — local embedding + retrieval backed by libllama_ffi
//! and pgvector. Lifted (mostly verbatim) from
//! experiments/embed-bench/src/main.zig so the cart-side `useEmbed` /
//! `embed.ts` hooks talk to exactly the same code path that the
//! ingest/query benchmark used.
//!
//! Public surface (consumed by v8_bindings_embed.zig):
//!
//!   Embedder.init(modelPath)            load .gguf into VRAM
//!   Embedder.deinit()                   free model + context
//!   Embedder.nDim                       embedding dimension
//!   Embedder.embedText(allocator, text) -> ![]f32   single, normalized
//!   Embedder.embedBatch(allocator, []const []const u8) -> ![][]f32
//!
//!   Reranker.init(modelPath)
//!   Reranker.deinit()
//!   Reranker.score(allocator, query, doc) -> !f32
//!
//!   Store.open(allocator, modelSlug, dim) -> !Store
//!   Store.close()
//!   Store.upsert(...)
//!   Store.searchTopNFiltered(allocator, vec, n, sourceTypeFilter) -> ![]SearchHit
//!   Store.buildPartialHnsw(sourceType)
//!
//! Linked at build time against tsz/zig-out/lib/libllama_ffi.so. The cart
//! binary ships with `-rpath $ORIGIN`; scripts/ship copies the .so next to
//! the executable so it's self-contained.

const std = @import("std");
const host_io = @import("../host_io.zig");
const log = @import("../diag/log.zig");
const pg = @import("pg");
const fpg = @import("../storage/pg.zig");

// ── llama.cpp ABI ───────────────────────────────────────────────────────
// Hand-rolled extern bindings. Layouts must match the .so we link against
// (currently the build at tsz/zig-out/lib/libllama_ffi.so). Mirrors what
// experiments/embed-bench uses, which we've validated against real models.

const c = struct {
    pub const llama_model = opaque {};
    pub const llama_context = opaque {};
    pub const llama_vocab = opaque {};
    pub const llama_memory = opaque {};
    pub const llama_token = i32;
    pub const llama_pos = i32;
    pub const llama_seq_id = i32;

    pub const llama_model_params = extern struct {
        devices: ?*anyopaque,
        tensor_buft_overrides: ?*const anyopaque,
        n_gpu_layers: i32,
        split_mode: i32,
        main_gpu: i32,
        tensor_split: ?*const f32,
        progress_callback: ?*const anyopaque,
        progress_callback_user_data: ?*anyopaque,
        kv_overrides: ?*const anyopaque,
        vocab_only: bool,
        use_mmap: bool,
        use_direct_io: bool,
        use_mlock: bool,
        check_tensors: bool,
        use_extra_bufts: bool,
        no_host: bool,
        no_alloc: bool,
    };

    pub const llama_context_params = extern struct {
        n_ctx: u32,
        n_batch: u32,
        n_ubatch: u32,
        n_seq_max: u32,
        n_threads: i32,
        n_threads_batch: i32,
        rope_scaling_type: i32,
        pooling_type: i32,
        attention_type: i32,
        flash_attn_type: i32,
        rope_freq_base: f32,
        rope_freq_scale: f32,
        yarn_ext_factor: f32,
        yarn_attn_factor: f32,
        yarn_beta_fast: f32,
        yarn_beta_slow: f32,
        yarn_orig_ctx: u32,
        defrag_thold: f32,
        cb_eval: ?*anyopaque,
        cb_eval_user_data: ?*anyopaque,
        type_k: i32,
        type_v: i32,
        abort_callback: ?*anyopaque,
        abort_callback_data: ?*anyopaque,
        embeddings: bool,
        offload_kqv: bool,
        no_perf: bool,
        op_offload: bool,
        swa_full: bool,
        kv_unified: bool,
        samplers: ?*anyopaque,
        n_samplers: usize,
    };

    pub const llama_batch = extern struct {
        n_tokens: i32,
        token: [*c]llama_token,
        embd: [*c]f32,
        pos: [*c]llama_pos,
        n_seq_id: [*c]i32,
        seq_id: [*c][*c]llama_seq_id,
        logits: [*c]i8,
    };

    pub extern "c" fn llama_backend_init() void;
    pub extern "c" fn llama_backend_free() void;
    pub extern "c" fn llama_model_default_params() llama_model_params;
    pub extern "c" fn llama_context_default_params() llama_context_params;
    pub extern "c" fn llama_model_load_from_file(path: [*c]const u8, params: llama_model_params) ?*llama_model;
    pub extern "c" fn llama_model_free(model: ?*llama_model) void;
    pub extern "c" fn llama_model_get_vocab(model: ?*const llama_model) ?*const llama_vocab;
    pub extern "c" fn llama_model_n_embd(model: ?*const llama_model) i32;
    pub extern "c" fn llama_init_from_model(model: ?*llama_model, params: llama_context_params) ?*llama_context;
    pub extern "c" fn llama_free(ctx: ?*llama_context) void;
    pub extern "c" fn llama_n_ctx(ctx: ?*const llama_context) u32;
    pub extern "c" fn llama_get_memory(ctx: ?*llama_context) ?*llama_memory;
    pub extern "c" fn llama_memory_clear(mem: ?*llama_memory, data: bool) void;
    pub extern "c" fn llama_tokenize(
        vocab: ?*const llama_vocab,
        text: [*c]const u8,
        text_len: i32,
        tokens: [*c]llama_token,
        n_tokens_max: i32,
        add_special: bool,
        parse_special: bool,
    ) i32;
    pub extern "c" fn llama_batch_init(n_tokens: i32, embd: i32, n_seq_max: i32) llama_batch;
    pub extern "c" fn llama_batch_free(batch: llama_batch) void;
    pub extern "c" fn llama_decode(ctx: ?*llama_context, batch: llama_batch) i32;
    pub extern "c" fn llama_synchronize(ctx: ?*llama_context) void;
    pub extern "c" fn llama_get_embeddings(ctx: ?*llama_context) [*c]f32;
    pub extern "c" fn llama_get_embeddings_seq(ctx: ?*llama_context, seq_id: llama_seq_id) [*c]f32;
    pub extern "c" fn llama_get_logits_ith(ctx: ?*llama_context, i: i32) [*c]f32;
};

// ── memory probe (debug) ────────────────────────────────────────────────
//
// `[embed-mem]` lines log process VmRSS + AMD GPU VRAM at every decode
// boundary. With `embed_log_mem` set true the output looks like:
//
//   [embed-mem] decode#23 ctx=0x... tokens=4123 rss=1234MiB vram=8765MiB
//
// VmRSS comes from /proc/self/status. VRAM is read from the first AMD
// drm card that exposes mem_info_vram_used (returns -1 on systems
// without the sysfs node). Both reads are best-effort; a missing file
// just shows up as -1.

pub var embed_log_mem: bool = true;

fn readProcVmRssKb() i64 {
    const file = std.fs.openFileAbsolute("/proc/self/status", .{}) catch return -1;
    defer file.close();
    var buf: [4096]u8 = undefined;
    const n = file.read(&buf) catch return -1;
    const text = buf[0..n];
    const tag = "VmRSS:";
    const at = std.mem.indexOf(u8, text, tag) orelse return -1;
    var i = at + tag.len;
    while (i < text.len and (text[i] == ' ' or text[i] == '\t')) : (i += 1) {}
    var j = i;
    while (j < text.len and text[j] >= '0' and text[j] <= '9') : (j += 1) {}
    return std.fmt.parseInt(i64, text[i..j], 10) catch -1;
}

fn readAmdGpuVramUsedKb() i64 {
    // Iterate /sys/class/drm/cardN/device/mem_info_vram_used for the first
    // file that opens. Card numbering isn't stable across boots so we
    // probe a small range.
    var card: u32 = 0;
    while (card < 8) : (card += 1) {
        var pbuf: [128]u8 = undefined;
        const path = std.fmt.bufPrint(&pbuf, "/sys/class/drm/card{d}/device/mem_info_vram_used", .{card}) catch return -1;
        const file = std.fs.openFileAbsolute(path, .{}) catch continue;
        defer file.close();
        var buf: [64]u8 = undefined;
        const n = file.read(&buf) catch return -1;
        var len = n;
        while (len > 0 and (buf[len - 1] == '\n' or buf[len - 1] == ' ')) len -= 1;
        const bytes = std.fmt.parseInt(i64, buf[0..len], 10) catch return -1;
        return @divFloor(bytes, 1024);
    }
    return -1;
}

/// Log a `[embed-mem]` line tagged with `phase`. Cheap; both reads are
/// ~2 syscalls. Caller passes the chunk index and token count for context.
pub fn logMem(phase: []const u8, chunk_idx: usize, n_tokens: usize) void {
    if (!embed_log_mem) return;
    const rss_kb = readProcVmRssKb();
    const vram_kb = readAmdGpuVramUsedKb();
    const rss_mib = if (rss_kb < 0) -1 else @divFloor(rss_kb, 1024);
    const vram_mib = if (vram_kb < 0) -1 else @divFloor(vram_kb, 1024);
    log.print("[embed-mem] {s} chunk={d} tokens={d} rss={d}MiB vram={d}MiB\n", .{ phase, chunk_idx, n_tokens, rss_mib, vram_mib });
}

// ── helpers ─────────────────────────────────────────────────────────────

pub fn shaHex(input: []const u8) [64]u8 {
    var hash: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(input, &hash, .{});
    var hex: [64]u8 = undefined;
    const alphabet = "0123456789abcdef";
    for (hash, 0..) |b, i| {
        hex[i * 2] = alphabet[b >> 4];
        hex[i * 2 + 1] = alphabet[b & 0xf];
    }
    return hex;
}

pub fn sanitizeUtf8(allocator: std.mem.Allocator, s: []const u8) ![]u8 {
    var out = std.array_list.Managed(u8).init(allocator);
    errdefer out.deinit();
    var i: usize = 0;
    while (i < s.len) {
        const len = std.unicode.utf8ByteSequenceLength(s[i]) catch {
            try out.append('?');
            i += 1;
            continue;
        };
        if (i + len > s.len) {
            try out.append('?');
            i += 1;
            continue;
        }
        const slice = s[i .. i + len];
        _ = std.unicode.utf8Decode(slice) catch {
            try out.append('?');
            i += 1;
            continue;
        };
        try out.appendSlice(slice);
        i += len;
    }
    return out.toOwnedSlice();
}

pub fn sqlEscape(allocator: std.mem.Allocator, s: []const u8) ![]u8 {
    var out = std.array_list.Managed(u8).init(allocator);
    errdefer out.deinit();
    for (s) |b| {
        if (b == '\'') {
            try out.appendSlice("''");
        } else {
            try out.append(b);
        }
    }
    return out.toOwnedSlice();
}

pub fn sanitizeTableSuffix(allocator: std.mem.Allocator, slug: []const u8) ![]u8 {
    var out = std.array_list.Managed(u8).init(allocator);
    errdefer out.deinit();
    for (slug) |b| {
        const lower = if (b >= 'A' and b <= 'Z') b + 32 else b;
        if ((lower >= 'a' and lower <= 'z') or (lower >= '0' and lower <= '9') or lower == '_') {
            try out.append(lower);
        } else {
            try out.append('_');
        }
    }
    return out.toOwnedSlice();
}

// ── Embedder (one process-wide model + one context) ────────────────────

pub const Embedder = struct {
    model: ?*c.llama_model,
    ctx: ?*c.llama_context,
    vocab: ?*const c.llama_vocab,
    n_embd: usize,
    n_ctx: u32,

    pub fn init(model_path: []const u8) !Embedder {
        c.llama_backend_init();

        var mparams = c.llama_model_default_params();
        mparams.n_gpu_layers = 999;

        const model_path_z = try std.heap.c_allocator.dupeZ(u8, model_path);
        defer std.heap.c_allocator.free(model_path_z);

        const model = c.llama_model_load_from_file(model_path_z.ptr, mparams);
        if (model == null) return error.FailedToLoadModel;

        const vocab = c.llama_model_get_vocab(model);
        const n_embd = c.llama_model_n_embd(model);

        var cparams = c.llama_context_default_params();
        cparams.n_ctx = 8192;
        cparams.n_batch = 8192;
        cparams.n_ubatch = 256;
        cparams.embeddings = true;
        cparams.pooling_type = 0;
        cparams.no_perf = true;
        cparams.n_seq_max = 16;
        cparams.kv_unified = true;

        const ctx = c.llama_init_from_model(model, cparams);
        if (ctx == null) {
            c.llama_model_free(model);
            return error.FailedToInitContext;
        }

        return .{
            .model = model,
            .ctx = ctx,
            .vocab = vocab,
            .n_embd = @intCast(n_embd),
            .n_ctx = cparams.n_ctx,
        };
    }

    pub fn deinit(self: *Embedder) void {
        if (self.ctx) |x| c.llama_free(x);
        if (self.model) |m| c.llama_model_free(m);
        // Note: llama_backend_free is process-global. We leave it alone so a
        // cart that loads a second model doesn't deinitialize the backend
        // out from under the first.
    }

    /// Embed a single text. Caller owns the returned slice.
    pub fn embedText(self: *Embedder, allocator: std.mem.Allocator, text: []const u8) ![]f32 {
        const probe_len = -c.llama_tokenize(self.vocab, text.ptr, @intCast(text.len), null, 0, true, true);
        if (probe_len <= 0) return error.TokenizeProbeFailed;

        const max_tokens: usize = @min(@as(usize, @abs(probe_len)), @as(usize, @intCast(self.n_ctx)));
        const tokens = try allocator.alloc(c.llama_token, max_tokens);
        defer allocator.free(tokens);

        const tk = c.llama_tokenize(self.vocab, text.ptr, @intCast(text.len), tokens.ptr, @intCast(tokens.len), true, true);
        if (tk < 0) return error.TokenizeFailed;
        const n_tokens: usize = @intCast(tk);

        const mem = c.llama_get_memory(self.ctx);
        if (mem != null) c.llama_memory_clear(mem, true);

        var batch = c.llama_batch_init(@intCast(n_tokens), 0, 1);
        defer c.llama_batch_free(batch);

        var i: usize = 0;
        while (i < n_tokens) : (i += 1) {
            batch.token[i] = tokens[i];
            batch.pos[i] = @intCast(i);
            batch.n_seq_id[i] = 1;
            batch.seq_id[i][0] = 0;
            batch.logits[i] = if (i == n_tokens - 1) 1 else 0;
        }
        batch.n_tokens = @intCast(n_tokens);

        const dr = c.llama_decode(self.ctx, batch);
        if (dr != 0) return error.DecodeFailed;
        // Block until the GPU is done. Without this, multiple in-flight
        // decodes pile up pinned host-visible scratch (the AMD Vulkan
        // driver doesn't reclaim those until the command stream
        // flushes), and after ~20 decodes the host-visible heap hits
        // its budget and the next pinned alloc fails.
        c.llama_synchronize(self.ctx);

        var raw = c.llama_get_embeddings_seq(self.ctx, 0);
        if (raw == null) raw = c.llama_get_embeddings(self.ctx);
        if (raw == null) return error.NoEmbeddingsReturned;

        const out = try allocator.alloc(f32, self.n_embd);
        var sumsq: f64 = 0.0;
        var k: usize = 0;
        while (k < self.n_embd) : (k += 1) {
            const v = raw[k];
            out[k] = v;
            sumsq += @as(f64, v) * @as(f64, v);
        }
        const norm = @sqrt(sumsq);
        if (norm > 0.0) {
            const inv: f32 = @floatCast(1.0 / norm);
            k = 0;
            while (k < self.n_embd) : (k += 1) out[k] *= inv;
        }
        return out;
    }

    /// Batched embed: pack N sequences into one llama_decode dispatch.
    pub fn embedBatch(self: *Embedder, allocator: std.mem.Allocator, texts: []const []const u8) ![][]f32 {
        if (texts.len == 0) return try allocator.alloc([]f32, 0);
        if (texts.len == 1) {
            const out = try allocator.alloc([]f32, 1);
            out[0] = try self.embedText(allocator, texts[0]);
            return out;
        }

        const per_seq_cap: usize = (@as(usize, @intCast(self.n_ctx)) - 8) / texts.len;
        if (per_seq_cap < 8) return error.BatchTooLarge;

        var seq_tokens = try allocator.alloc([]c.llama_token, texts.len);
        defer {
            for (seq_tokens) |t| allocator.free(t);
            allocator.free(seq_tokens);
        }
        for (seq_tokens) |*s| s.* = &.{};

        var total_tokens: usize = 0;
        for (texts, 0..) |text, i| {
            const probe_len = -c.llama_tokenize(self.vocab, text.ptr, @intCast(text.len), null, 0, true, true);
            if (probe_len <= 0) continue;
            const want: usize = @min(@as(usize, @abs(probe_len)), per_seq_cap);
            const buf = try allocator.alloc(c.llama_token, want);
            const tk = c.llama_tokenize(self.vocab, text.ptr, @intCast(text.len), buf.ptr, @intCast(want), true, true);
            if (tk <= 0) {
                allocator.free(buf);
                continue;
            }
            seq_tokens[i] = buf[0..@intCast(tk)];
            total_tokens += seq_tokens[i].len;
        }

        if (total_tokens == 0) {
            const out = try allocator.alloc([]f32, texts.len);
            for (out) |*v| {
                const z = try allocator.alloc(f32, self.n_embd);
                @memset(z, 0);
                v.* = z;
            }
            return out;
        }

        const mem = c.llama_get_memory(self.ctx);
        if (mem != null) c.llama_memory_clear(mem, true);

        var batch = c.llama_batch_init(@intCast(total_tokens), 0, @intCast(texts.len));
        defer c.llama_batch_free(batch);

        var tok_idx: usize = 0;
        for (seq_tokens, 0..) |toks, seq_idx| {
            for (toks, 0..) |tok, pos_in_seq| {
                batch.token[tok_idx] = tok;
                batch.pos[tok_idx] = @intCast(pos_in_seq);
                batch.n_seq_id[tok_idx] = 1;
                batch.seq_id[tok_idx][0] = @intCast(seq_idx);
                batch.logits[tok_idx] = if (pos_in_seq == toks.len - 1) 1 else 0;
                tok_idx += 1;
            }
        }
        batch.n_tokens = @intCast(total_tokens);

        const dr = c.llama_decode(self.ctx, batch);
        if (dr != 0) return error.DecodeFailed;
        // Block until the GPU is done. Without this, multiple in-flight
        // decodes pile up pinned host-visible scratch (the AMD Vulkan
        // driver doesn't reclaim those until the command stream
        // flushes), and after ~20 decodes the host-visible heap hits
        // its budget and the next pinned alloc fails.
        c.llama_synchronize(self.ctx);

        var out = try allocator.alloc([]f32, texts.len);
        errdefer {
            for (out) |v| allocator.free(v);
            allocator.free(out);
        }

        for (0..texts.len) |seq_idx| {
            const v = try allocator.alloc(f32, self.n_embd);
            const raw = c.llama_get_embeddings_seq(self.ctx, @intCast(seq_idx));
            if (raw == null or seq_tokens[seq_idx].len == 0) {
                @memset(v, 0);
                out[seq_idx] = v;
                continue;
            }
            var sumsq: f64 = 0.0;
            for (0..self.n_embd) |k| {
                const x = raw[k];
                v[k] = x;
                sumsq += @as(f64, x) * @as(f64, x);
            }
            const norm = @sqrt(sumsq);
            if (norm > 0.0) {
                const inv: f32 = @floatCast(1.0 / norm);
                for (v) |*x| x.* *= inv;
            }
            out[seq_idx] = v;
        }
        return out;
    }
};

// ── Reranker (cross-encoder) ────────────────────────────────────────────

fn tokenizeOne(vocab: ?*const c.llama_vocab, text: []const u8) !c.llama_token {
    var buf: [4]c.llama_token = undefined;
    const tk = c.llama_tokenize(vocab, text.ptr, @intCast(text.len), &buf[0], buf.len, false, false);
    if (tk <= 0) return error.TokenizeFailed;
    return buf[0];
}

pub const Reranker = struct {
    model: ?*c.llama_model,
    ctx: ?*c.llama_context,
    vocab: ?*const c.llama_vocab,
    n_ctx: usize,
    yes_token: c.llama_token,
    no_token: c.llama_token,

    pub fn init(model_path: []const u8) !Reranker {
        c.llama_backend_init();

        var mparams = c.llama_model_default_params();
        mparams.n_gpu_layers = 999;

        const model_path_z = try std.heap.c_allocator.dupeZ(u8, model_path);
        defer std.heap.c_allocator.free(model_path_z);

        const model = c.llama_model_load_from_file(model_path_z.ptr, mparams);
        if (model == null) return error.FailedToLoadModel;

        const vocab = c.llama_model_get_vocab(model);

        var cparams = c.llama_context_default_params();
        cparams.n_ctx = 8192;
        cparams.n_batch = 8192;
        cparams.n_ubatch = 256;
        cparams.embeddings = false;
        cparams.no_perf = true;

        const ctx = c.llama_init_from_model(model, cparams);
        if (ctx == null) {
            c.llama_model_free(model);
            return error.FailedToInitContext;
        }

        const yes_token = try tokenizeOne(vocab, "yes");
        const no_token = try tokenizeOne(vocab, "no");

        return .{
            .model = model,
            .ctx = ctx,
            .vocab = vocab,
            .n_ctx = 8192,
            .yes_token = yes_token,
            .no_token = no_token,
        };
    }

    pub fn deinit(self: *Reranker) void {
        if (self.ctx) |ctx| c.llama_free(ctx);
        if (self.model) |model| c.llama_model_free(model);
    }

    pub fn score(self: *Reranker, allocator: std.mem.Allocator, query: []const u8, document: []const u8) !f32 {
        const doc_max: usize = 6000;
        const query_max: usize = 500;
        const doc_use = if (document.len > doc_max) document[0..doc_max] else document;
        const query_use = if (query.len > query_max) query[0..query_max] else query;

        const instruction = "Given a search query, retrieve relevant chunks that answer the query.";
        const prompt = try std.fmt.allocPrint(
            allocator,
            "<|im_start|>system\n" ++
                "Judge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be \"yes\" or \"no\".<|im_end|>\n" ++
                "<|im_start|>user\n" ++
                "<Instruct>: {s}\n<Query>: {s}\n<Document>: {s}<|im_end|>\n" ++
                "<|im_start|>assistant\n<think>\n\n</think>\n\n",
            .{ instruction, query_use, doc_use },
        );
        defer allocator.free(prompt);

        const probe_len = -c.llama_tokenize(self.vocab, prompt.ptr, @intCast(prompt.len), null, 0, true, true);
        if (probe_len <= 0) return error.TokenizeProbeFailed;

        const max_tokens: usize = @min(@as(usize, @abs(probe_len)), self.n_ctx);
        const tokens = try allocator.alloc(c.llama_token, max_tokens);
        defer allocator.free(tokens);

        const tk = c.llama_tokenize(self.vocab, prompt.ptr, @intCast(prompt.len), tokens.ptr, @intCast(tokens.len), true, true);
        if (tk < 0) return error.TokenizeFailed;
        const n_tokens: usize = @intCast(tk);

        const mem = c.llama_get_memory(self.ctx);
        if (mem != null) c.llama_memory_clear(mem, true);

        var batch = c.llama_batch_init(@intCast(n_tokens), 0, 1);
        defer c.llama_batch_free(batch);

        var i: usize = 0;
        while (i < n_tokens) : (i += 1) {
            batch.token[i] = tokens[i];
            batch.pos[i] = @intCast(i);
            batch.n_seq_id[i] = 1;
            batch.seq_id[i][0] = 0;
            batch.logits[i] = if (i == n_tokens - 1) 1 else 0;
        }
        batch.n_tokens = @intCast(n_tokens);

        const dr = c.llama_decode(self.ctx, batch);
        if (dr != 0) return error.DecodeFailed;
        // Block until the GPU is done. Without this, multiple in-flight
        // decodes pile up pinned host-visible scratch (the AMD Vulkan
        // driver doesn't reclaim those until the command stream
        // flushes), and after ~20 decodes the host-visible heap hits
        // its budget and the next pinned alloc fails.
        c.llama_synchronize(self.ctx);

        const logits = c.llama_get_logits_ith(self.ctx, -1);
        if (logits == null) return error.NoLogits;

        const yes_logit = logits[@as(usize, @intCast(self.yes_token))];
        const no_logit = logits[@as(usize, @intCast(self.no_token))];

        const max_l = @max(yes_logit, no_logit);
        const e_yes = @exp(yes_logit - max_l);
        const e_no = @exp(no_logit - max_l);
        return e_yes / (e_yes + e_no);
    }
};

// ── pgvector store ──────────────────────────────────────────────────────

pub const SearchHit = struct {
    id: []u8,
    source_id: []u8,
    chunk_index: i32,
    text_preview: []u8,
    display_text: []u8,
    dense_score: f64,
};

pub fn freeHits(allocator: std.mem.Allocator, hits: []SearchHit) void {
    for (hits) |*h| {
        allocator.free(h.id);
        allocator.free(h.source_id);
        allocator.free(h.text_preview);
        allocator.free(h.display_text);
    }
    allocator.free(hits);
}

pub const Store = struct {
    pool: *pg.Pool,
    allocator: std.mem.Allocator,
    dim: usize,
    /// Per-model table name like "chunks_qwen3_embedding_0_6b_q8_0". Owned.
    table: []u8,

    /// Opens the canonical table for `model_slug` against the framework's
    /// shared default pool (framework/pg.zig). `dim` is the model's n_embd;
    /// the table is created if it doesn't exist, with the standard schema
    /// (id PK, source_type, source_id, chunk_index, display_text,
    /// text_preview, metadata_json, model, embedded_at, text_sha, vector).
    pub fn open(allocator: std.mem.Allocator, model_slug: []const u8, dim: usize) !Store {
        const pool = fpg.defaultPool() orelse return error.PoolUnavailable;

        const suffix = try sanitizeTableSuffix(allocator, model_slug);
        defer allocator.free(suffix);
        const table = try std.fmt.allocPrint(allocator, "chunks_{s}", .{suffix});
        errdefer allocator.free(table);

        if (dim > 0) {
            const create_sql = try std.fmt.allocPrint(
                allocator,
                \\CREATE TABLE IF NOT EXISTS {s} (
                \\  id            TEXT PRIMARY KEY,
                \\  source_type   TEXT NOT NULL,
                \\  source_id     TEXT NOT NULL,
                \\  chunk_index   INTEGER NOT NULL,
                \\  display_text  TEXT NOT NULL,
                \\  text_preview  TEXT,
                \\  metadata_json TEXT,
                \\  model         TEXT NOT NULL,
                \\  embedded_at   TIMESTAMP NOT NULL,
                \\  text_sha      TEXT NOT NULL,
                \\  vector        vector({d}) NOT NULL
                \\);
            ,
                .{ table, dim },
            );
            defer allocator.free(create_sql);
            _ = try pool.exec(create_sql, .{});

            const idx_sql = try std.fmt.allocPrint(
                allocator,
                "CREATE INDEX IF NOT EXISTS {s}_source_idx ON {s}(source_type, source_id);",
                .{ table, table },
            );
            defer allocator.free(idx_sql);
            _ = try pool.exec(idx_sql, .{});
        }

        return .{ .allocator = allocator, .pool = pool, .dim = dim, .table = table };
    }

    pub fn close(self: *Store) void {
        self.allocator.free(self.table);
        // pool is shared/owned by framework/pg.zig — do NOT deinit.
    }

    /// Best-effort top-level HNSW for the whole table. Idempotent; safe to
    /// call repeatedly. Use buildPartialHnsw for source-type-filtered
    /// queries — pgvector 0.5.1 needs a partial index per filter slice.
    pub fn buildHnsw(self: *Store) !void {
        const sql = try std.fmt.allocPrint(
            self.allocator,
            "CREATE INDEX IF NOT EXISTS {s}_hnsw_idx ON {s} USING hnsw (vector vector_cosine_ops);",
            .{ self.table, self.table },
        );
        defer self.allocator.free(sql);
        _ = self.pool.exec(sql, .{}) catch |e| {
            log.print("hnsw build: {s} (continuing)\n", .{@errorName(e)});
            return;
        };
    }

    pub fn buildPartialHnsw(self: *Store, source_type: []const u8) !void {
        const st_e = try sqlEscape(self.allocator, source_type);
        defer self.allocator.free(st_e);
        const sql = try std.fmt.allocPrint(
            self.allocator,
            "CREATE INDEX IF NOT EXISTS {s}_{s}_hnsw ON {s} USING hnsw (vector vector_cosine_ops) WHERE source_type = '{s}';",
            .{ self.table, st_e, self.table, st_e },
        );
        defer self.allocator.free(sql);
        _ = self.pool.exec(sql, .{}) catch |e| {
            log.print("partial hnsw build: {s} (continuing)\n", .{@errorName(e)});
            return;
        };
    }

    pub fn upsert(
        self: *Store,
        id: []const u8,
        source_type: []const u8,
        source_id: []const u8,
        chunk_index: i32,
        display_text: []const u8,
        text_preview: []const u8,
        metadata_json: []const u8,
        model: []const u8,
        text_sha: []const u8,
        vector: []const f32,
    ) !void {
        var arr_buf = std.array_list.Managed(u8).init(self.allocator);
        defer arr_buf.deinit();
        try arr_buf.appendSlice("[");
        for (vector, 0..) |v, i| {
            if (i > 0) try arr_buf.append(',');
            try arr_buf.writer().print("{d}", .{v});
        }
        try arr_buf.appendSlice("]");

        const dt_clean = try sanitizeUtf8(self.allocator, display_text);
        defer self.allocator.free(dt_clean);
        const tp_clean = try sanitizeUtf8(self.allocator, text_preview);
        defer self.allocator.free(tp_clean);
        const mj_clean = try sanitizeUtf8(self.allocator, metadata_json);
        defer self.allocator.free(mj_clean);

        const id_e = try sqlEscape(self.allocator, id);
        defer self.allocator.free(id_e);
        const st_e = try sqlEscape(self.allocator, source_type);
        defer self.allocator.free(st_e);
        const sid_e = try sqlEscape(self.allocator, source_id);
        defer self.allocator.free(sid_e);
        const dt_e = try sqlEscape(self.allocator, dt_clean);
        defer self.allocator.free(dt_e);
        const tp_e = try sqlEscape(self.allocator, tp_clean);
        defer self.allocator.free(tp_e);
        const mj_e = try sqlEscape(self.allocator, mj_clean);
        defer self.allocator.free(mj_e);
        const m_e = try sqlEscape(self.allocator, model);
        defer self.allocator.free(m_e);
        const sha_e = try sqlEscape(self.allocator, text_sha);
        defer self.allocator.free(sha_e);

        const sql = try std.fmt.allocPrint(
            self.allocator,
            \\INSERT INTO {s}
            \\(id, source_type, source_id, chunk_index, display_text, text_preview, metadata_json, model, embedded_at, text_sha, vector)
            \\VALUES ('{s}', '{s}', '{s}', {d}, '{s}', '{s}', '{s}', '{s}', now(), '{s}', '{s}'::vector)
            \\ON CONFLICT (id) DO UPDATE SET
            \\  display_text = excluded.display_text,
            \\  text_preview = excluded.text_preview,
            \\  metadata_json = excluded.metadata_json,
            \\  embedded_at = now(),
            \\  text_sha = excluded.text_sha,
            \\  vector = excluded.vector;
        ,
            .{ self.table, id_e, st_e, sid_e, chunk_index, dt_e, tp_e, mj_e, m_e, sha_e, arr_buf.items },
        );
        defer self.allocator.free(sql);

        _ = try self.pool.exec(sql, .{});
    }

    pub fn searchTopNFiltered(
        self: *Store,
        allocator: std.mem.Allocator,
        vector: []const f32,
        n: usize,
        source_type_filter: []const u8,
    ) ![]SearchHit {
        var arr_buf = std.array_list.Managed(u8).init(self.allocator);
        defer arr_buf.deinit();
        try arr_buf.appendSlice("[");
        for (vector, 0..) |v, i| {
            if (i > 0) try arr_buf.append(',');
            try arr_buf.writer().print("{d}", .{v});
        }
        try arr_buf.appendSlice("]");

        const where_clause: []const u8 = if (source_type_filter.len > 0)
            try std.fmt.allocPrint(self.allocator, "WHERE source_type = '{s}'", .{source_type_filter})
        else
            try self.allocator.dupe(u8, "");
        defer self.allocator.free(where_clause);

        const sql = try std.fmt.allocPrint(
            self.allocator,
            \\SELECT id, source_id, chunk_index, text_preview, display_text,
            \\       CAST(1.0 - (vector <=> '{s}'::vector) AS DOUBLE PRECISION) AS score
            \\FROM {s}
            \\{s}
            \\ORDER BY vector <=> '{s}'::vector
            \\LIMIT {d};
        ,
            .{ arr_buf.items, self.table, where_clause, arr_buf.items, n },
        );
        defer self.allocator.free(sql);

        var result = try self.pool.query(sql, .{});
        defer result.deinit();

        var hits = std.array_list.Managed(SearchHit).init(allocator);
        errdefer {
            for (hits.items) |*h| {
                allocator.free(h.id);
                allocator.free(h.source_id);
                allocator.free(h.text_preview);
                allocator.free(h.display_text);
            }
            hits.deinit();
        }

        while (try result.next()) |row| {
            const id_s = try row.get([]const u8, 0);
            const sid_s = try row.get([]const u8, 1);
            const ci = try row.get(i32, 2);
            const tp_s = try row.get([]const u8, 3);
            const dt_s = try row.get([]const u8, 4);
            const sc = try row.get(f64, 5);
            try hits.append(.{
                .id = try allocator.dupe(u8, id_s),
                .source_id = try allocator.dupe(u8, sid_s),
                .chunk_index = ci,
                .text_preview = try allocator.dupe(u8, tp_s),
                .display_text = try allocator.dupe(u8, dt_s),
                .dense_score = sc,
            });
        }
        return hits.toOwnedSlice();
    }
};

// ── multi-worker ingest pool ────────────────────────────────────────────
//
// SharedModel + WorkerCtx are the bench's pattern lifted in: load model
// weights into VRAM ONCE, give each worker thread its own llama_context
// (private KV cache + decode state), share the immutable weights across
// all workers. WorkerCtx.embed/embedBatch are identical to Embedder's
// methods of the same name — same code, just decoupled from the
// single-context lifecycle.

pub const SharedModel = struct {
    model: ?*c.llama_model,
    vocab: ?*const c.llama_vocab,
    n_embd: usize,

    pub fn init(model_path: []const u8) !SharedModel {
        c.llama_backend_init();

        var mparams = c.llama_model_default_params();
        mparams.n_gpu_layers = 999;

        const model_path_z = try std.heap.c_allocator.dupeZ(u8, model_path);
        defer std.heap.c_allocator.free(model_path_z);

        const model = c.llama_model_load_from_file(model_path_z.ptr, mparams);
        if (model == null) return error.FailedToLoadModel;

        const vocab = c.llama_model_get_vocab(model);
        const n_embd = c.llama_model_n_embd(model);

        return .{
            .model = model,
            .vocab = vocab,
            .n_embd = @intCast(n_embd),
        };
    }

    pub fn deinit(self: *SharedModel) void {
        if (self.model) |m| c.llama_model_free(m);
    }

    pub fn newWorker(self: *const SharedModel, n_ctx: u32) !WorkerCtx {
        var cparams = c.llama_context_default_params();
        cparams.n_ctx = n_ctx;
        cparams.n_batch = n_ctx;
        // Mirror framework/local_ai_runtime.zig (the proven in-process llama
        // shape that runs 27B alongside wgpu). The compute buffer is sized
        // for `n_ubatch × n_seq_max` in the worst case — `n_seq_max=16` blew
        // it up to 1.3 GB per ctx, which the bench could afford as a CLI
        // binary but the cart cannot. Single-sequence is what the chat path
        // uses and it coexists fine with wgpu.
        cparams.n_ubatch = 256;
        cparams.embeddings = true;
        cparams.pooling_type = 0;
        cparams.no_perf = true;

        const ctx = c.llama_init_from_model(self.model, cparams);
        if (ctx == null) return error.FailedToInitContext;
        return .{
            .vocab = self.vocab,
            .ctx = ctx,
            .n_embd = self.n_embd,
            .n_ctx = n_ctx,
        };
    }
};

pub const WorkerCtx = struct {
    vocab: ?*const c.llama_vocab,
    ctx: ?*c.llama_context,
    n_embd: usize,
    n_ctx: u32,

    pub fn deinit(self: *WorkerCtx) void {
        if (self.ctx) |x| c.llama_free(x);
    }

    pub fn embedText(self: *WorkerCtx, allocator: std.mem.Allocator, text: []const u8) ![]f32 {
        const probe_len = -c.llama_tokenize(self.vocab, text.ptr, @intCast(text.len), null, 0, true, true);
        if (probe_len <= 0) return error.TokenizeProbeFailed;

        // Cap chunks at 4096 tokens. Even with pooling=NONE, llama.cpp's
        // override marks every input token's logits flag, so the output
        // buffer scales as `n_tokens × n_embd × 4 bytes`. At ~7500 tokens
        // that buffer (~30 MB) crosses AMD's per-buffer host-visible
        // ceiling and decode fails. 4096 keeps it ~16 MB — well under
        // the threshold we observed succeed at 6144.
        const safe_token_cap: usize = 4096;
        const max_tokens: usize = @min(@as(usize, @abs(probe_len)), @min(@as(usize, @intCast(self.n_ctx)), safe_token_cap));
        const tokens = try allocator.alloc(c.llama_token, max_tokens);
        defer allocator.free(tokens);

        const tk = c.llama_tokenize(self.vocab, text.ptr, @intCast(text.len), tokens.ptr, @intCast(tokens.len), true, true);
        if (tk < 0) return error.TokenizeFailed;
        const n_tokens: usize = @intCast(tk);

        logMem("inner-pre-clear", 0, n_tokens);
        const mem = c.llama_get_memory(self.ctx);
        if (mem != null) c.llama_memory_clear(mem, true);
        logMem("inner-post-clear", 0, n_tokens);

        var batch = c.llama_batch_init(@intCast(n_tokens), 0, 1);
        defer c.llama_batch_free(batch);
        var i: usize = 0;
        while (i < n_tokens) : (i += 1) {
            batch.token[i] = tokens[i];
            batch.pos[i] = @intCast(i);
            batch.n_seq_id[i] = 1;
            batch.seq_id[i][0] = 0;
            batch.logits[i] = if (i == n_tokens - 1) 1 else 0;
        }
        batch.n_tokens = @intCast(n_tokens);
        logMem("inner-pre-decode", 0, n_tokens);

        const dr = c.llama_decode(self.ctx, batch);
        if (dr != 0) {
            logMem("inner-decode-err", 0, n_tokens);
            return error.DecodeFailed;
        }
        logMem("inner-post-decode", 0, n_tokens);
        // Block until the GPU is done. Without this, multiple in-flight
        // decodes pile up pinned host-visible scratch (the AMD Vulkan
        // driver doesn't reclaim those until the command stream
        // flushes), and after ~20 decodes the host-visible heap hits
        // its budget and the next pinned alloc fails.
        c.llama_synchronize(self.ctx);
        logMem("inner-post-sync", 0, n_tokens);

        var raw = c.llama_get_embeddings_seq(self.ctx, 0);
        if (raw == null) raw = c.llama_get_embeddings(self.ctx);
        if (raw == null) return error.NoEmbeddingsReturned;

        const out = try allocator.alloc(f32, self.n_embd);
        var sumsq: f64 = 0.0;
        var k: usize = 0;
        while (k < self.n_embd) : (k += 1) {
            const v = raw[k];
            out[k] = v;
            sumsq += @as(f64, v) * @as(f64, v);
        }
        const norm = @sqrt(sumsq);
        if (norm > 0.0) {
            const inv: f32 = @floatCast(1.0 / norm);
            k = 0;
            while (k < self.n_embd) : (k += 1) out[k] *= inv;
        }
        return out;
    }

    pub fn embedBatch(self: *WorkerCtx, allocator: std.mem.Allocator, texts: []const []const u8) ![][]f32 {
        if (texts.len == 0) return try allocator.alloc([]f32, 0);
        if (texts.len == 1) {
            const out = try allocator.alloc([]f32, 1);
            out[0] = try self.embedText(allocator, texts[0]);
            return out;
        }
        const per_seq_cap: usize = (@as(usize, @intCast(self.n_ctx)) - 8) / texts.len;
        if (per_seq_cap < 8) return error.BatchTooLarge;

        var seq_tokens = try allocator.alloc([]c.llama_token, texts.len);
        defer {
            for (seq_tokens) |t| allocator.free(t);
            allocator.free(seq_tokens);
        }
        for (seq_tokens) |*s| s.* = &.{};

        var total_tokens: usize = 0;
        for (texts, 0..) |text, i| {
            const probe_len = -c.llama_tokenize(self.vocab, text.ptr, @intCast(text.len), null, 0, true, true);
            if (probe_len <= 0) continue;
            const want: usize = @min(@as(usize, @abs(probe_len)), per_seq_cap);
            const buf = try allocator.alloc(c.llama_token, want);
            const tk = c.llama_tokenize(self.vocab, text.ptr, @intCast(text.len), buf.ptr, @intCast(want), true, true);
            if (tk <= 0) {
                allocator.free(buf);
                continue;
            }
            seq_tokens[i] = buf[0..@intCast(tk)];
            total_tokens += seq_tokens[i].len;
        }

        if (total_tokens == 0) {
            const out = try allocator.alloc([]f32, texts.len);
            for (out) |*v| {
                const z = try allocator.alloc(f32, self.n_embd);
                @memset(z, 0);
                v.* = z;
            }
            return out;
        }

        const mem = c.llama_get_memory(self.ctx);
        if (mem != null) c.llama_memory_clear(mem, true);

        var batch = c.llama_batch_init(@intCast(total_tokens), 0, @intCast(texts.len));
        defer c.llama_batch_free(batch);

        var tok_idx: usize = 0;
        for (seq_tokens, 0..) |toks, seq_idx| {
            for (toks, 0..) |tok, pos_in_seq| {
                batch.token[tok_idx] = tok;
                batch.pos[tok_idx] = @intCast(pos_in_seq);
                batch.n_seq_id[tok_idx] = 1;
                batch.seq_id[tok_idx][0] = @intCast(seq_idx);
                batch.logits[tok_idx] = if (pos_in_seq == toks.len - 1) 1 else 0;
                tok_idx += 1;
            }
        }
        batch.n_tokens = @intCast(total_tokens);

        const dr = c.llama_decode(self.ctx, batch);
        if (dr != 0) return error.DecodeFailed;
        // Block until the GPU is done. Without this, multiple in-flight
        // decodes pile up pinned host-visible scratch (the AMD Vulkan
        // driver doesn't reclaim those until the command stream
        // flushes), and after ~20 decodes the host-visible heap hits
        // its budget and the next pinned alloc fails.
        c.llama_synchronize(self.ctx);

        var out = try allocator.alloc([]f32, texts.len);
        errdefer {
            for (out) |v| allocator.free(v);
            allocator.free(out);
        }
        for (0..texts.len) |seq_idx| {
            const v = try allocator.alloc(f32, self.n_embd);
            const raw = c.llama_get_embeddings_seq(self.ctx, @intCast(seq_idx));
            if (raw == null or seq_tokens[seq_idx].len == 0) {
                @memset(v, 0);
                out[seq_idx] = v;
                continue;
            }
            var sumsq: f64 = 0.0;
            for (0..self.n_embd) |k| {
                const x = raw[k];
                v[k] = x;
                sumsq += @as(f64, x) * @as(f64, x);
            }
            const norm = @sqrt(sumsq);
            if (norm > 0.0) {
                const inv: f32 = @floatCast(1.0 / norm);
                for (v) |*x| x.* *= inv;
            }
            out[seq_idx] = v;
        }
        return out;
    }
};

// ── walker ──────────────────────────────────────────────────────────────

const code_extensions = [_][]const u8{
    ".ts",   ".tsx",  ".js",   ".jsx", ".mjs",  ".cjs",
    ".zig",  ".lua",  ".py",   ".rs",  ".go",   ".c",
    ".cpp",  ".cc",   ".h",    ".hpp", ".json", ".jsonl",
    ".md",   ".yml",  ".yaml", ".sh",  ".bash", ".css",
    ".html", ".toml",
};

// Default skip list — applies to every ingest. Project-specific
// exclusions (e.g. "archive/" in a particular repo) belong in the
// user's EmbedSource.excludes, NOT here.
const code_skip_dirs = [_][]const u8{
    "node_modules", "zig-out", "zig-cache", "dist", "target", "build", "vendor",
};

fn shouldSkipPath(rel_path: []const u8, user_excludes: []const []const u8) bool {
    // User-provided excludes match against the full relative path — this
    // lets callers use either bare segment names ("archive") or path
    // prefixes ("cart/app/bundle.js") with the same field.
    for (user_excludes) |ex| {
        if (ex.len == 0) continue;
        if (std.mem.indexOf(u8, rel_path, ex) != null) return true;
    }
    var seg_iter = std.mem.tokenizeScalar(u8, rel_path, '/');
    while (seg_iter.next()) |seg| {
        if (seg.len > 0 and seg[0] == '.') return true;
        for (code_skip_dirs) |skip| {
            if (std.mem.eql(u8, seg, skip)) return true;
        }
    }
    return false;
}

fn isEmbeddableExt(basename: []const u8) bool {
    for (code_extensions) |ext| {
        if (std.mem.endsWith(u8, basename, ext)) return true;
    }
    return false;
}

fn detectLang(path: []const u8) []const u8 {
    if (std.mem.endsWith(u8, path, ".tsx")) return "tsx";
    if (std.mem.endsWith(u8, path, ".ts")) return "typescript";
    if (std.mem.endsWith(u8, path, ".jsx")) return "jsx";
    if (std.mem.endsWith(u8, path, ".js")) return "javascript";
    if (std.mem.endsWith(u8, path, ".zig")) return "zig";
    if (std.mem.endsWith(u8, path, ".lua")) return "lua";
    if (std.mem.endsWith(u8, path, ".py")) return "python";
    if (std.mem.endsWith(u8, path, ".md")) return "markdown";
    if (std.mem.endsWith(u8, path, ".jsonl")) return "jsonl";
    return "text";
}

/// Recursive walker. Returns absolute paths of embeddable files under `root`,
/// sorted. Caller owns the slice and each path.
pub fn findFiles(
    allocator: std.mem.Allocator,
    root: []const u8,
    user_excludes: []const []const u8,
) ![][]u8 {
    var out = std.array_list.Managed([]u8).init(allocator);
    errdefer {
        for (out.items) |p| allocator.free(p);
        out.deinit();
    }

    var dir = try std.fs.openDirAbsolute(root, .{ .iterate = true });
    defer dir.close();
    var walker = try dir.walk(allocator);
    defer walker.deinit();
    while (try walker.next()) |entry| {
        if (entry.kind != .file) continue;
        if (shouldSkipPath(entry.path, user_excludes)) continue;
        if (!isEmbeddableExt(entry.basename)) continue;
        const full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ root, entry.path });
        try out.append(full);
    }
    std.mem.sort([]u8, out.items, {}, struct {
        fn lt(_: void, a: []u8, b: []u8) bool {
            return std.mem.lessThan(u8, a, b);
        }
    }.lt);
    return out.toOwnedSlice();
}

// ── chat-log + memory parsing (lifted from embed-bench) ────────────────

const tool_truncate_chars: usize = 400;
const window_size: usize = 4;
const window_overlap: usize = 2;

/// One semantic event extracted from a chat-log JSONL line.
/// timestamp/role/body are owned by the parsing arena.
const FlatEvent = struct {
    timestamp: []u8,
    role: []u8, // "user" | "assistant" | "thinking" | "tool_call" | "tool_result"
    body: []u8,
    is_tool_result_truncated: bool,
};

fn freeEvent(allocator: std.mem.Allocator, e: *FlatEvent) void {
    allocator.free(e.timestamp);
    allocator.free(e.role);
    allocator.free(e.body);
}

fn pushEvent(
    allocator: std.mem.Allocator,
    out: *std.array_list.Managed(FlatEvent),
    ts: []const u8,
    role: []const u8,
    body: []const u8,
    truncated_marker: bool,
) !void {
    const ts_owned = try allocator.dupe(u8, ts);
    errdefer allocator.free(ts_owned);
    const role_owned = try allocator.dupe(u8, role);
    errdefer allocator.free(role_owned);
    const body_owned = if (truncated_marker)
        try std.fmt.allocPrint(allocator, "[tool result: {d} chars truncated]", .{body.len})
    else if (body.len > 8000)
        try std.fmt.allocPrint(allocator, "{s} … [+{d} chars]", .{ body[0..7900], body.len - 7900 })
    else
        try allocator.dupe(u8, body);
    try out.append(.{
        .timestamp = ts_owned,
        .role = role_owned,
        .body = body_owned,
        .is_tool_result_truncated = truncated_marker,
    });
}

/// Parses one .jsonl into a flat ordered list of FlatEvent.
/// Used for ~/.claude/projects/<slug>/*.jsonl + ~/.claude-overflow same shape.
fn parseClaudeJsonl(allocator: std.mem.Allocator, path: []const u8) !std.array_list.Managed(FlatEvent) {
    var out = std.array_list.Managed(FlatEvent).init(allocator);
    errdefer {
        for (out.items) |*e| freeEvent(allocator, e);
        out.deinit();
    }

    const file = try std.fs.openFileAbsolute(path, .{});
    defer file.close();
    const stat = try file.stat();
    if (stat.size > 200 * 1024 * 1024) return error.FileTooLarge;
    const data = try file.readToEndAlloc(allocator, @intCast(stat.size));
    defer allocator.free(data);

    var line_iter = std.mem.tokenizeScalar(u8, data, '\n');
    while (line_iter.next()) |line| {
        if (line.len == 0 or line[0] != '{') continue;
        appendClaudeLine(allocator, &out, line) catch continue;
    }
    return out;
}

fn appendClaudeLine(
    allocator: std.mem.Allocator,
    out: *std.array_list.Managed(FlatEvent),
    line: []const u8,
) !void {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, line, .{}) catch return;
    defer parsed.deinit();

    const root = parsed.value;
    if (root != .object) return;
    const obj = root.object;

    const ts_v = obj.get("timestamp") orelse std.json.Value{ .null = {} };
    const ts: []const u8 = switch (ts_v) {
        .string => |s| s,
        else => "",
    };

    const ttype_v = obj.get("type") orelse return;
    if (ttype_v != .string) return;
    const ttype = ttype_v.string;

    if (std.mem.eql(u8, ttype, "user")) {
        const msg_v = obj.get("message") orelse return;
        if (msg_v != .object) return;
        const content_v = msg_v.object.get("content") orelse return;
        switch (content_v) {
            .string => |s| try pushEvent(allocator, out, ts, "user", s, false),
            .array => |arr| {
                for (arr.items) |blk_v| {
                    if (blk_v != .object) continue;
                    const blk = blk_v.object;
                    const blk_type_v = blk.get("type") orelse continue;
                    if (blk_type_v != .string) continue;
                    const blk_type = blk_type_v.string;
                    if (std.mem.eql(u8, blk_type, "tool_result")) {
                        const cv = blk.get("content") orelse continue;
                        const txt = switch (cv) {
                            .string => |s| s,
                            .array => |inner| blk: {
                                if (inner.items.len == 0) break :blk "";
                                const first = inner.items[0];
                                if (first == .object) {
                                    const t = first.object.get("text") orelse break :blk "";
                                    break :blk if (t == .string) t.string else "";
                                }
                                break :blk "";
                            },
                            else => "",
                        };
                        const trunc = txt.len > tool_truncate_chars;
                        try pushEvent(allocator, out, ts, "tool_result", txt, trunc);
                    } else if (std.mem.eql(u8, blk_type, "text")) {
                        const txtv = blk.get("text") orelse continue;
                        if (txtv != .string) continue;
                        try pushEvent(allocator, out, ts, "user", txtv.string, false);
                    }
                }
            },
            else => {},
        }
    } else if (std.mem.eql(u8, ttype, "assistant")) {
        const msg_v = obj.get("message") orelse return;
        if (msg_v != .object) return;
        const content_v = msg_v.object.get("content") orelse return;
        if (content_v != .array) return;
        for (content_v.array.items) |blk_v| {
            if (blk_v != .object) continue;
            const blk = blk_v.object;
            const blk_type_v = blk.get("type") orelse continue;
            if (blk_type_v != .string) continue;
            const blk_type = blk_type_v.string;
            if (std.mem.eql(u8, blk_type, "text")) {
                const tv = blk.get("text") orelse continue;
                if (tv != .string) continue;
                try pushEvent(allocator, out, ts, "assistant", tv.string, false);
            } else if (std.mem.eql(u8, blk_type, "thinking")) {
                const tv = blk.get("thinking") orelse continue;
                if (tv != .string) continue;
                try pushEvent(allocator, out, ts, "thinking", tv.string, false);
            } else if (std.mem.eql(u8, blk_type, "tool_use")) {
                const name_v = blk.get("name") orelse continue;
                if (name_v != .string) continue;
                var input_summary: []const u8 = "";
                if (blk.get("input")) |iv| {
                    if (iv == .object) {
                        var it = iv.object.iterator();
                        while (it.next()) |entry| {
                            if (entry.value_ptr.* == .string) {
                                input_summary = entry.value_ptr.*.string;
                                break;
                            }
                        }
                    }
                }
                const body = try std.fmt.allocPrint(
                    allocator,
                    "{s} {s}",
                    .{ name_v.string, if (input_summary.len > 80) input_summary[0..80] else input_summary },
                );
                defer allocator.free(body);
                try pushEvent(allocator, out, ts, "tool_call", body, false);
            }
        }
    }
    // type=system is metadata (SystemInit); skipped on purpose.
}

/// Codex CLI sessions: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
fn parseCodexJsonl(allocator: std.mem.Allocator, path: []const u8) !std.array_list.Managed(FlatEvent) {
    var out = std.array_list.Managed(FlatEvent).init(allocator);
    errdefer {
        for (out.items) |*e| freeEvent(allocator, e);
        out.deinit();
    }
    const file = try std.fs.openFileAbsolute(path, .{});
    defer file.close();
    const stat = try file.stat();
    if (stat.size > 200 * 1024 * 1024) return error.FileTooLarge;
    const data = try file.readToEndAlloc(allocator, @intCast(stat.size));
    defer allocator.free(data);
    var line_iter = std.mem.tokenizeScalar(u8, data, '\n');
    while (line_iter.next()) |line| {
        if (line.len == 0 or line[0] != '{') continue;
        appendCodexLine(allocator, &out, line) catch continue;
    }
    return out;
}

fn appendCodexLine(
    allocator: std.mem.Allocator,
    out: *std.array_list.Managed(FlatEvent),
    line: []const u8,
) !void {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, line, .{}) catch return;
    defer parsed.deinit();
    const root = parsed.value;
    if (root != .object) return;
    const obj = root.object;
    const ttype_v = obj.get("type") orelse return;
    if (ttype_v != .string) return;
    const ttype = ttype_v.string;

    if (std.mem.eql(u8, ttype, "message")) {
        const role_v = obj.get("role") orelse return;
        if (role_v != .string) return;
        const role_in = role_v.string;
        const role_norm: []const u8 =
            if (std.mem.eql(u8, role_in, "user")) "user" else if (std.mem.eql(u8, role_in, "assistant")) "assistant" else "user";
        const content_v = obj.get("content") orelse return;
        if (content_v != .array) return;
        for (content_v.array.items) |c_v| {
            if (c_v != .object) continue;
            const co = c_v.object;
            const ct_v = co.get("type") orelse continue;
            if (ct_v != .string) continue;
            const ct = ct_v.string;
            if (std.mem.eql(u8, ct, "input_text") or
                std.mem.eql(u8, ct, "output_text") or
                std.mem.eql(u8, ct, "text"))
            {
                const text_v = co.get("text") orelse continue;
                if (text_v != .string) continue;
                try pushEvent(allocator, out, "", role_norm, text_v.string, false);
            }
        }
    } else if (std.mem.eql(u8, ttype, "reasoning")) {
        if (obj.get("content")) |content_v| {
            if (content_v == .array) {
                for (content_v.array.items) |c_v| {
                    if (c_v != .object) continue;
                    const co = c_v.object;
                    if (co.get("text")) |t_v| {
                        if (t_v == .string) try pushEvent(allocator, out, "", "thinking", t_v.string, false);
                    }
                    if (co.get("summary")) |s_v| {
                        if (s_v == .string) try pushEvent(allocator, out, "", "thinking", s_v.string, false);
                    }
                }
            }
        }
        if (obj.get("summary")) |s_v| {
            if (s_v == .string) try pushEvent(allocator, out, "", "thinking", s_v.string, false);
        }
    } else if (std.mem.eql(u8, ttype, "function_call")) {
        const name = if (obj.get("name")) |n| (if (n == .string) n.string else "") else "";
        const args = if (obj.get("arguments")) |a| (if (a == .string) a.string else "") else "";
        const args_clip = if (args.len > 80) args[0..80] else args;
        const body = try std.fmt.allocPrint(allocator, "{s} {s}", .{ name, args_clip });
        defer allocator.free(body);
        try pushEvent(allocator, out, "", "tool_call", body, false);
    } else if (std.mem.eql(u8, ttype, "function_call_output")) {
        const text: []const u8 = blk: {
            if (obj.get("output")) |o_v| {
                switch (o_v) {
                    .string => |s| break :blk s,
                    .object => |o| {
                        if (o.get("text")) |t_v| if (t_v == .string) break :blk t_v.string;
                        if (o.get("content")) |c_v| if (c_v == .string) break :blk c_v.string;
                    },
                    else => {},
                }
            }
            break :blk "";
        };
        const trunc = text.len > tool_truncate_chars;
        try pushEvent(allocator, out, "", "tool_result", text, trunc);
    }
}

/// Kimi CLI sessions: ~/.kimi/sessions/<account>/<session>/context.jsonl
fn parseKimiContextJsonl(allocator: std.mem.Allocator, path: []const u8) !std.array_list.Managed(FlatEvent) {
    var out = std.array_list.Managed(FlatEvent).init(allocator);
    errdefer {
        for (out.items) |*e| freeEvent(allocator, e);
        out.deinit();
    }
    const file = try std.fs.openFileAbsolute(path, .{});
    defer file.close();
    const stat = try file.stat();
    if (stat.size > 200 * 1024 * 1024) return error.FileTooLarge;
    const data = try file.readToEndAlloc(allocator, @intCast(stat.size));
    defer allocator.free(data);
    var line_iter = std.mem.tokenizeScalar(u8, data, '\n');
    while (line_iter.next()) |line| {
        if (line.len == 0 or line[0] != '{') continue;
        appendKimiLine(allocator, &out, line) catch continue;
    }
    return out;
}

fn appendKimiLine(
    allocator: std.mem.Allocator,
    out: *std.array_list.Managed(FlatEvent),
    line: []const u8,
) !void {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, line, .{}) catch return;
    defer parsed.deinit();
    const root = parsed.value;
    if (root != .object) return;
    const obj = root.object;
    const role_v = obj.get("role") orelse return;
    if (role_v != .string) return;
    const role_in = role_v.string;
    if (role_in.len > 0 and role_in[0] == '_') return;
    const role_norm: []const u8 =
        if (std.mem.eql(u8, role_in, "user")) "user" else if (std.mem.eql(u8, role_in, "assistant")) "assistant" else if (std.mem.eql(u8, role_in, "tool")) "tool_result" else "user";

    if (obj.get("content")) |content_v| {
        switch (content_v) {
            .array => |arr| for (arr.items) |c_v| {
                if (c_v != .object) continue;
                const co = c_v.object;
                const ct_v = co.get("type") orelse continue;
                if (ct_v != .string) continue;
                const ct = ct_v.string;
                if (std.mem.eql(u8, ct, "text")) {
                    const t_v = co.get("text") orelse continue;
                    if (t_v != .string) continue;
                    const trunc = std.mem.eql(u8, role_norm, "tool_result") and t_v.string.len > tool_truncate_chars;
                    try pushEvent(allocator, out, "", role_norm, t_v.string, trunc);
                } else if (std.mem.eql(u8, ct, "think")) {
                    const t_v = co.get("think") orelse continue;
                    if (t_v != .string) continue;
                    try pushEvent(allocator, out, "", "thinking", t_v.string, false);
                }
            },
            .string => |s| try pushEvent(allocator, out, "", role_norm, s, false),
            else => {},
        }
    }

    if (std.mem.eql(u8, role_norm, "assistant")) {
        if (obj.get("tool_calls")) |tcs_v| {
            if (tcs_v == .array) {
                for (tcs_v.array.items) |tc_v| {
                    if (tc_v != .object) continue;
                    const tc = tc_v.object;
                    if (tc.get("function")) |fn_v| {
                        if (fn_v != .object) continue;
                        const fn_obj = fn_v.object;
                        const name = if (fn_obj.get("name")) |n| (if (n == .string) n.string else "") else "";
                        const args = if (fn_obj.get("arguments")) |a| (if (a == .string) a.string else "") else "";
                        const args_clip = if (args.len > 80) args[0..80] else args;
                        const body = try std.fmt.allocPrint(allocator, "{s} {s}", .{ name, args_clip });
                        defer allocator.free(body);
                        try pushEvent(allocator, out, "", "tool_call", body, false);
                    }
                }
            }
        }
    }
}

/// One pre-windowed chunk ready to embed.
const Chunk = struct {
    session_id: []const u8,
    chunk_index: usize,
    first_ts: []const u8,
    last_ts: []const u8,
    role_sequence: []const u8,
    tool_calls: []const u8,
    display_text: []u8,
    text_preview: []u8,
};

fn buildChunk(
    allocator: std.mem.Allocator,
    session_id: []const u8,
    chunk_index: usize,
    events: []const FlatEvent,
) !Chunk {
    var display = std.array_list.Managed(u8).init(allocator);
    errdefer display.deinit();
    var roles = std.array_list.Managed(u8).init(allocator);
    errdefer roles.deinit();
    var tools = std.array_list.Managed(u8).init(allocator);
    errdefer tools.deinit();

    for (events, 0..) |e, i| {
        if (i > 0) try roles.append(',');
        try roles.appendSlice(e.role);
        try display.writer().print("[{s} {s}] {s}\n", .{ e.timestamp, e.role, e.body });
        if (std.mem.eql(u8, e.role, "tool_call")) {
            const sp = std.mem.indexOfScalar(u8, e.body, ' ') orelse e.body.len;
            if (tools.items.len > 0) try tools.append(',');
            try tools.appendSlice(e.body[0..sp]);
        }
    }

    const display_owned = try display.toOwnedSlice();
    const preview_len: usize = @min(160, display_owned.len);
    const preview = try allocator.dupe(u8, display_owned[0..preview_len]);

    return .{
        .session_id = session_id,
        .chunk_index = chunk_index,
        .first_ts = if (events.len > 0) events[0].timestamp else "",
        .last_ts = if (events.len > 0) events[events.len - 1].timestamp else "",
        .role_sequence = try roles.toOwnedSlice(),
        .tool_calls = try tools.toOwnedSlice(),
        .display_text = display_owned,
        .text_preview = preview,
    };
}

fn freeChunk(allocator: std.mem.Allocator, ch: *Chunk) void {
    allocator.free(ch.role_sequence);
    allocator.free(ch.tool_calls);
    allocator.free(ch.display_text);
    allocator.free(ch.text_preview);
}

fn windowEvents(
    allocator: std.mem.Allocator,
    session_id: []const u8,
    events: []const FlatEvent,
    chunk_size: usize,
) !std.array_list.Managed(Chunk) {
    var out = std.array_list.Managed(Chunk).init(allocator);
    errdefer {
        for (out.items) |*ch| freeChunk(allocator, ch);
        out.deinit();
    }
    if (events.len == 0) return out;

    // chunk_size = 0 → fall back to the file-scope default. Overlap is
    // scaled to half the window for any user override so a 6-event
    // window pairs with a 3-event slide, etc.
    const w_size: usize = if (chunk_size > 0) chunk_size else window_size;
    const w_overlap: usize = if (chunk_size > 0)
        @max(@as(usize, 1), w_size / 2)
    else
        window_overlap;

    var idx: usize = 0;
    var chunk_index: usize = 0;
    while (idx < events.len) {
        const end = @min(idx + w_size, events.len);
        const ch = try buildChunk(allocator, session_id, chunk_index, events[idx..end]);
        try out.append(ch);
        chunk_index += 1;
        if (end == events.len) break;
        idx += w_size - w_overlap;
    }
    return out;
}

// ── per-source walkers ──────────────────────────────────────────────────

/// Walks <base>/projects/<slug>/*.jsonl.
pub fn findClaudeJsonls(allocator: std.mem.Allocator, base_dir: []const u8) ![][]u8 {
    var out = std.array_list.Managed([]u8).init(allocator);
    errdefer {
        for (out.items) |p| allocator.free(p);
        out.deinit();
    }
    const projects_dir = try std.fmt.allocPrint(allocator, "{s}/projects", .{base_dir});
    defer allocator.free(projects_dir);

    var pdir = std.fs.openDirAbsolute(projects_dir, .{ .iterate = true }) catch return out.toOwnedSlice();
    defer pdir.close();
    var pit = pdir.iterate();
    while (try pit.next()) |proj_entry| {
        if (proj_entry.kind != .directory) continue;
        const proj_path = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ projects_dir, proj_entry.name });
        defer allocator.free(proj_path);

        var jdir = std.fs.openDirAbsolute(proj_path, .{ .iterate = true }) catch continue;
        defer jdir.close();
        var jit = jdir.iterate();
        while (try jit.next()) |je| {
            if (je.kind != .file) continue;
            if (!std.mem.endsWith(u8, je.name, ".jsonl")) continue;
            const full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ proj_path, je.name });
            try out.append(full);
        }
    }
    sortStrings(out.items);
    return out.toOwnedSlice();
}

pub fn findCodexJsonls(allocator: std.mem.Allocator, base: []const u8) ![][]u8 {
    const root = try std.fmt.allocPrint(allocator, "{s}/sessions", .{base});
    defer allocator.free(root);
    var out = std.array_list.Managed([]u8).init(allocator);
    errdefer {
        for (out.items) |p| allocator.free(p);
        out.deinit();
    }
    var dir = std.fs.openDirAbsolute(root, .{ .iterate = true }) catch return out.toOwnedSlice();
    defer dir.close();
    var walker = try dir.walk(allocator);
    defer walker.deinit();
    while (try walker.next()) |entry| {
        if (entry.kind != .file) continue;
        if (!std.mem.endsWith(u8, entry.basename, ".jsonl")) continue;
        const full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ root, entry.path });
        try out.append(full);
    }
    sortStrings(out.items);
    return out.toOwnedSlice();
}

pub fn findKimiContexts(allocator: std.mem.Allocator, base: []const u8) ![][]u8 {
    const root = try std.fmt.allocPrint(allocator, "{s}/sessions", .{base});
    defer allocator.free(root);
    var out = std.array_list.Managed([]u8).init(allocator);
    errdefer {
        for (out.items) |p| allocator.free(p);
        out.deinit();
    }
    var dir = std.fs.openDirAbsolute(root, .{ .iterate = true }) catch return out.toOwnedSlice();
    defer dir.close();
    var walker = try dir.walk(allocator);
    defer walker.deinit();
    while (try walker.next()) |entry| {
        if (entry.kind != .file) continue;
        if (!std.mem.eql(u8, entry.basename, "context.jsonl")) continue;
        const full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ root, entry.path });
        try out.append(full);
    }
    sortStrings(out.items);
    return out.toOwnedSlice();
}

/// Walks ~/.claude*/projects/<slug>/memory/*.md across the two accounts.
pub fn findMemoryMarkdowns(allocator: std.mem.Allocator, home: []const u8) ![][]u8 {
    var out = std.array_list.Managed([]u8).init(allocator);
    errdefer {
        for (out.items) |p| allocator.free(p);
        out.deinit();
    }
    const accounts = [_][]const u8{ ".claude", ".claude-overflow" };
    for (accounts) |account| {
        const projects_dir = try std.fmt.allocPrint(allocator, "{s}/{s}/projects", .{ home, account });
        defer allocator.free(projects_dir);

        var pdir = std.fs.openDirAbsolute(projects_dir, .{ .iterate = true }) catch continue;
        defer pdir.close();
        var pit = pdir.iterate();
        while (try pit.next()) |proj_e| {
            if (proj_e.kind != .directory) continue;
            const memdir_path = try std.fmt.allocPrint(allocator, "{s}/{s}/memory", .{ projects_dir, proj_e.name });
            defer allocator.free(memdir_path);

            var mdir = std.fs.openDirAbsolute(memdir_path, .{ .iterate = true }) catch continue;
            defer mdir.close();
            var mit = mdir.iterate();
            while (try mit.next()) |me| {
                if (me.kind != .file) continue;
                if (!std.mem.endsWith(u8, me.name, ".md")) continue;
                const full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ memdir_path, me.name });
                try out.append(full);
            }
        }
    }
    sortStrings(out.items);
    return out.toOwnedSlice();
}

fn sortStrings(items: [][]u8) void {
    std.mem.sort([]u8, items, {}, struct {
        fn lt(_: void, a: []u8, b: []u8) bool {
            return std.mem.lessThan(u8, a, b);
        }
    }.lt);
}

// ── thread-pool ingest ──────────────────────────────────────────────────

/// What kind of corpus a job's path belongs to. Picks the parser + the
/// chunk shape + the canonical source_type label that lands in pgvector.
/// Canonical content kinds. Each one controls (1) the walker, (2) the
/// chunker, and (3) the `source_type` column value (which the partial
/// HNSW indexes are built on).
///
/// `conversation_history` and `knowledge` are STRUCTURED kinds: the
/// caller supplies a Mapping that says which JSON key paths correspond
/// to canonical fields (role, content, timestamp, title, …). The Zig
/// side has no vendor-specific parsers anymore — the caller declares
/// the shape via the mapping. Settings → Embed ships UI presets for
/// Claude/Codex/Kimi JSONL exports that pre-fill the mapping.
///
/// `code` and `documentation` are RAW kinds: the walker collects files,
/// the chunker windows the file's text. No mapping needed.
pub const CanonicalKind = enum {
    code,
    documentation,
    conversation_history,
    knowledge,

    pub fn fromStr(s: []const u8) ?CanonicalKind {
        if (std.mem.eql(u8, s, "code")) return .code;
        if (std.mem.eql(u8, s, "documentation")) return .documentation;
        if (std.mem.eql(u8, s, "conversation-history")) return .conversation_history;
        if (std.mem.eql(u8, s, "conversation_history")) return .conversation_history;
        if (std.mem.eql(u8, s, "knowledge")) return .knowledge;
        // Legacy aliases from the pre-canonical-kinds era. These let an
        // old EmbedSource row survive the rename without manual edits;
        // cart-side listSources() also migrates rows on read.
        if (std.mem.eql(u8, s, "claude")) return .conversation_history;
        if (std.mem.eql(u8, s, "claude-overflow")) return .conversation_history;
        if (std.mem.eql(u8, s, "codex")) return .conversation_history;
        if (std.mem.eql(u8, s, "kimi")) return .conversation_history;
        if (std.mem.eql(u8, s, "memory")) return .documentation;
        return null;
    }

    pub fn label(self: CanonicalKind) []const u8 {
        return switch (self) {
            .code => "code",
            .documentation => "documentation",
            .conversation_history => "conversation-history",
            .knowledge => "knowledge",
        };
    }

    /// What lands in chunks.<table>.source_type. The dense+rerank pipeline
    /// already builds a partial HNSW index per source_type.
    pub fn canonicalSourceType(self: CanonicalKind) []const u8 {
        return switch (self) {
            .code => "code-chunk",
            .documentation => "document-chunk",
            .conversation_history => "chat-log-chunk",
            .knowledge => "knowledge-chunk",
        };
    }

    pub fn isStructured(self: CanonicalKind) bool {
        return switch (self) {
            .conversation_history, .knowledge => true,
            .code, .documentation => false,
        };
    }
};

// Back-compat alias so callers outside this file (and the host binding
// layer) keep compiling while we migrate. Drop once everything points
// at CanonicalKind directly.
pub const SourceKind = CanonicalKind;

/// User-declared mapping from JSON key-paths in the source to canonical
/// content fields. All paths are dot-separated (`message.content`,
/// `payload.body.text`). Empty string means "field not present in this
/// source." Borrowed slices — owner keeps them alive for the session.
pub const Mapping = struct {
    // conversation-history fields
    role: []const u8 = "",
    content: []const u8 = "",
    timestamp: []const u8 = "",
    session_id: []const u8 = "",
    // knowledge fields
    title: []const u8 = "",
    source_uri: []const u8 = "",

    /// Parse from a JSON object. Unknown keys are ignored; missing keys
    /// stay as empty strings. The returned struct borrows from `json`'s
    /// arena — caller keeps `parsed` alive for the mapping's lifetime.
    pub fn fromJsonValue(value: std.json.Value) Mapping {
        if (value != .object) return .{};
        const o = value.object;
        return .{
            .role = stringOr(o, "role", ""),
            .content = stringOr(o, "content", ""),
            .timestamp = stringOr(o, "timestamp", ""),
            .session_id = stringOr(o, "session_id", ""),
            .title = stringOr(o, "title", ""),
            .source_uri = stringOr(o, "source_uri", ""),
        };
    }

    fn stringOr(o: std.json.ObjectMap, key: []const u8, dflt: []const u8) []const u8 {
        const v = o.get(key) orelse return dflt;
        return if (v == .string) v.string else dflt;
    }
};

/// Walk a dotted path into a parsed JSON value. Returns null if any
/// segment is missing or the path leaves a non-object intermediate.
/// Empty path returns the root.
pub fn getJsonPath(root: std.json.Value, path: []const u8) ?std.json.Value {
    if (path.len == 0) return root;
    var cur = root;
    var it = std.mem.tokenizeScalar(u8, path, '.');
    while (it.next()) |seg| {
        if (cur != .object) return null;
        cur = cur.object.get(seg) orelse return null;
    }
    return cur;
}

/// Coerce a JSON value to retrieval text. The whole point of this
/// helper is to flatten the "content might be a string OR a list of
/// typed blocks" mess every chat provider has settled into. The user's
/// mapping only points at the *path*; this function figures out how to
/// turn whatever lives there into searchable text. Caller owns the
/// returned slice.
// Error set declared explicitly: extractText ↔ concatBlocksToText is
// mutually recursive, and Zig can't resolve inferred error sets across
// a cycle. Every allocator call funnels into Allocator.Error, so that's
// all this needs to declare.
pub fn extractText(allocator: std.mem.Allocator, value: std.json.Value) std.mem.Allocator.Error![]u8 {
    return switch (value) {
        .string => |s| try allocator.dupe(u8, s),
        .integer => |n| try std.fmt.allocPrint(allocator, "{d}", .{n}),
        .float => |f| try std.fmt.allocPrint(allocator, "{d}", .{f}),
        .bool => |b| try allocator.dupe(u8, if (b) "true" else "false"),
        .null => try allocator.dupe(u8, ""),
        .array => |arr| try concatBlocksToText(allocator, arr),
        .object => |obj| try pickObjectText(allocator, obj),
        .number_string => |s| try allocator.dupe(u8, s),
    };
}

// Array-of-blocks → concatenated text. Handles:
//   - Plain strings: ["a", "b"] → "a\nb"
//   - Anthropic block shape: [{type:"text", text:"..."}, {type:"tool_use", name:"...", input:{...}}, {type:"tool_result", content:"..."}]
//   - Generic objects: pulls .text / .content / .body recursively
fn concatBlocksToText(allocator: std.mem.Allocator, arr: std.json.Array) std.mem.Allocator.Error![]u8 {
    var buf = std.array_list.Managed(u8).init(allocator);
    defer buf.deinit();
    for (arr.items, 0..) |item, i| {
        if (i > 0) try buf.append('\n');
        const piece = try extractText(allocator, item);
        defer allocator.free(piece);
        try buf.appendSlice(piece);
    }
    return buf.toOwnedSlice();
}

// Object → pick the best "this is text" field. Looks for text, content,
// body, value in that order. Anthropic `tool_use` blocks get
// "<tool_name> <input-summary>" so the search index still has the call
// signature; plain "type"-only metadata blocks get an empty string.
fn pickObjectText(allocator: std.mem.Allocator, obj: std.json.ObjectMap) std.mem.Allocator.Error![]u8 {
    // Anthropic tool_use surface — render as a one-liner.
    if (obj.get("type")) |t| {
        if (t == .string and std.mem.eql(u8, t.string, "tool_use")) {
            const name = if (obj.get("name")) |n| (if (n == .string) n.string else "") else "";
            const input_summary: []const u8 = blk: {
                const iv = obj.get("input") orelse break :blk "";
                if (iv != .object) break :blk "";
                var it = iv.object.iterator();
                while (it.next()) |entry| {
                    if (entry.value_ptr.* == .string) break :blk entry.value_ptr.*.string;
                }
                break :blk "";
            };
            const truncated = if (input_summary.len > 80) input_summary[0..80] else input_summary;
            return std.fmt.allocPrint(allocator, "[tool_use {s}] {s}", .{ name, truncated });
        }
    }
    // Conventional text-bearing keys, in priority order.
    inline for ([_][]const u8{ "text", "content", "body", "value" }) |key| {
        if (obj.get(key)) |v| return extractText(allocator, v);
    }
    return allocator.dupe(u8, "");
}

/// Walk the first N JSONL lines of `path`, accumulate every key path
/// observed plus up to `max_samples_per_key` sample values per path.
/// Returns a JSON string the cart can parse to drive the mapping UI's
/// dropdowns. Output shape:
///
///   { "sampleCount": N,
///     "keys": [ { "path": "message.role",
///                 "samples": ["user","assistant"],
///                 "occurrences": 50 }, ... ] }
///
/// Only the first `max_keys` paths are kept (LRU-style: insertion order,
/// later sightings just bump occurrences). Caller owns the returned
/// slice. Empty string on read failure.
pub fn probeStructuredKeys(
    allocator: std.mem.Allocator,
    path: []const u8,
    sample_lines: usize,
    max_keys: usize,
    max_samples_per_key: usize,
) ![]u8 {
    const file = std.fs.openFileAbsolute(path, .{}) catch return allocator.dupe(u8, "");
    defer file.close();
    const stat = file.stat() catch return allocator.dupe(u8, "");
    if (stat.size == 0) return allocator.dupe(u8, "{\"sampleCount\":0,\"keys\":[]}");
    const cap: usize = @min(@as(usize, @intCast(stat.size)), 16 * 1024 * 1024);
    const data = try file.readToEndAlloc(allocator, cap);
    defer allocator.free(data);

    var key_paths = std.array_list.Managed([]u8).init(allocator);
    defer {
        for (key_paths.items) |p| allocator.free(p);
        key_paths.deinit();
    }
    var samples = std.array_list.Managed(std.array_list.Managed([]u8)).init(allocator);
    defer {
        for (samples.items) |*l| {
            for (l.items) |s| allocator.free(s);
            l.deinit();
        }
        samples.deinit();
    }
    var occurrences = std.array_list.Managed(usize).init(allocator);
    defer occurrences.deinit();

    var n_lines: usize = 0;
    var line_iter = std.mem.tokenizeScalar(u8, data, '\n');
    while (line_iter.next()) |line| {
        if (n_lines >= sample_lines) break;
        if (line.len == 0 or line[0] != '{') continue;
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, line, .{}) catch continue;
        defer parsed.deinit();
        try walkAccumulate(
            allocator,
            parsed.value,
            "",
            &key_paths,
            &samples,
            &occurrences,
            max_keys,
            max_samples_per_key,
        );
        n_lines += 1;
    }

    // Emit JSON. Hand-rolled because we don't have a Value built — just
    // parallel slices. Escape strings with our existing sqlEscape-style
    // helper. Keep this compact: no pretty-printing.
    var out = std.array_list.Managed(u8).init(allocator);
    errdefer out.deinit();
    try out.writer().print("{{\"sampleCount\":{d},\"keys\":[", .{n_lines});
    for (key_paths.items, 0..) |p, i| {
        if (i > 0) try out.append(',');
        try out.appendSlice("{\"path\":");
        try appendJsonString(&out, p);
        try out.writer().print(",\"occurrences\":{d},\"samples\":[", .{occurrences.items[i]});
        const sl = samples.items[i].items;
        for (sl, 0..) |s, j| {
            if (j > 0) try out.append(',');
            try appendJsonString(&out, s);
        }
        try out.appendSlice("]}");
    }
    try out.appendSlice("]}");
    return out.toOwnedSlice();
}

fn appendJsonString(out: *std.array_list.Managed(u8), s: []const u8) !void {
    try out.append('"');
    for (s) |b| {
        switch (b) {
            '"' => try out.appendSlice("\\\""),
            '\\' => try out.appendSlice("\\\\"),
            '\n' => try out.appendSlice("\\n"),
            '\r' => try out.appendSlice("\\r"),
            '\t' => try out.appendSlice("\\t"),
            0...0x1f => {
                var hex_buf: [6]u8 = undefined;
                _ = std.fmt.bufPrint(&hex_buf, "\\u{x:0>4}", .{b}) catch unreachable;
                try out.appendSlice(&hex_buf);
            },
            else => try out.append(b),
        }
    }
    try out.append('"');
}

fn walkAccumulate(
    allocator: std.mem.Allocator,
    value: std.json.Value,
    prefix: []const u8,
    paths: *std.array_list.Managed([]u8),
    samples: *std.array_list.Managed(std.array_list.Managed([]u8)),
    occurrences: *std.array_list.Managed(usize),
    max_keys: usize,
    max_samples_per_key: usize,
) !void {
    switch (value) {
        .object => |obj| {
            var it = obj.iterator();
            while (it.next()) |entry| {
                const child = if (prefix.len == 0)
                    try allocator.dupe(u8, entry.key_ptr.*)
                else
                    try std.fmt.allocPrint(allocator, "{s}.{s}", .{ prefix, entry.key_ptr.* });
                defer allocator.free(child);
                try walkAccumulate(allocator, entry.value_ptr.*, child, paths, samples, occurrences, max_keys, max_samples_per_key);
            }
        },
        else => {
            // Leaf — record the path + a sample value.
            const sample_text = try extractText(allocator, value);
            defer allocator.free(sample_text);
            const idx = findOrAddPath(allocator, paths, samples, occurrences, prefix, max_keys) catch return;
            occurrences.items[idx] += 1;
            if (samples.items[idx].items.len < max_samples_per_key) {
                const dup = try allocator.dupe(u8, sample_text[0..@min(sample_text.len, 200)]);
                // Skip duplicates so the samples are actually informative.
                var seen = false;
                for (samples.items[idx].items) |existing| {
                    if (std.mem.eql(u8, existing, dup)) { seen = true; break; }
                }
                if (seen) {
                    allocator.free(dup);
                } else {
                    try samples.items[idx].append(dup);
                }
            }
        },
    }
}

fn findOrAddPath(
    allocator: std.mem.Allocator,
    paths: *std.array_list.Managed([]u8),
    samples: *std.array_list.Managed(std.array_list.Managed([]u8)),
    occurrences: *std.array_list.Managed(usize),
    path: []const u8,
    max_keys: usize,
) !usize {
    for (paths.items, 0..) |p, i| {
        if (std.mem.eql(u8, p, path)) return i;
    }
    if (paths.items.len >= max_keys) return error.OutOfKeys;
    const owned = try allocator.dupe(u8, path);
    try paths.append(owned);
    try samples.append(std.array_list.Managed([]u8).init(allocator));
    try occurrences.append(0);
    return paths.items.len - 1;
}

const code_window_lines: usize = 200;
const code_overlap_lines: usize = 50;
const max_file_bytes: usize = 2 * 1024 * 1024;

/// Atomic counters shared between every worker thread + the JS poll path.
pub const Counters = struct {
    files_done: std.atomic.Value(usize) = .init(0),
    chunks_done: std.atomic.Value(usize) = .init(0),
    embed_ns: std.atomic.Value(u64) = .init(0),
    files_total: usize = 0, // set once at start, read-only thereafter
};

const Job = struct {
    kind: SourceKind = .code,
    /// Absolute path. Owned by the queue's allocator.
    path: []u8,
    /// Root the path is relative to. For .code this is the repo root. For
    /// .claude/.claude_overflow this is `~/.claude` etc. For .memory this
    /// is `$HOME` (the walker emits absolute paths anyway). Owned.
    repo_root: []u8,

    fn deinit(self: *Job, allocator: std.mem.Allocator) void {
        allocator.free(self.path);
        allocator.free(self.repo_root);
    }
};

const JobQueue = struct {
    mutex: std.Thread.Mutex = .{},
    cond: std.Thread.Condition = .{},
    jobs: std.array_list.Managed(Job),
    closed: bool = false,
    allocator: std.mem.Allocator,

    fn init(allocator: std.mem.Allocator) JobQueue {
        return .{
            .jobs = std.array_list.Managed(Job).init(allocator),
            .allocator = allocator,
        };
    }

    fn deinit(self: *JobQueue) void {
        for (self.jobs.items) |*j| j.deinit(self.allocator);
        self.jobs.deinit();
    }

    fn push(self: *JobQueue, job: Job) !void {
        self.mutex.lock();
        defer self.mutex.unlock();
        try self.jobs.append(job);
        self.cond.signal();
    }

    fn pop(self: *JobQueue) ?Job {
        self.mutex.lock();
        defer self.mutex.unlock();
        while (self.jobs.items.len == 0) {
            if (self.closed) return null;
            self.cond.wait(&self.mutex);
        }
        return self.jobs.orderedRemove(0);
    }

    fn close(self: *JobQueue) void {
        self.mutex.lock();
        defer self.mutex.unlock();
        self.closed = true;
        self.cond.broadcast();
    }
};

/// Live snapshot of an ingest session's progress. Cheap to call (atomic
/// loads + a single mutex acquire for `current_file`).
pub const ProgressSnapshot = struct {
    files_total: usize,
    files_done: usize,
    chunks_done: usize,
    embed_ms_sum: u64,
    /// 0-terminated copy of the most recent file a worker started. Useful
    /// for "now ingesting … X" UX. Empty when the session just started.
    current_file: [256]u8,
    current_len: usize,
    done: bool,
    cancelled: bool,
    error_text_len: usize,
    error_text: [256]u8,
};

/// One running ingest. Owns its own JobQueue, worker threads, model
/// reference (borrowed — caller keeps it alive for the session's lifetime),
/// and Store handle (also borrowed).
pub const IngestSession = struct {
    allocator: std.mem.Allocator,
    queue: JobQueue,
    counters: Counters,
    threads: []std.Thread,
    cancel_flag: std.atomic.Value(bool),
    done_flag: std.atomic.Value(bool),
    cur_mutex: std.Thread.Mutex,
    cur_buf: [256]u8,
    cur_len: usize,
    err_buf: [256]u8,
    err_len: usize,
    source_type: []u8,
    model_id: []u8,
    n_workers: usize,
    /// User-supplied excludes — owned dupes, freed in deinit. Empty
    /// slice = no user excludes (framework defaults still apply).
    user_excludes: [][]u8,
    /// Per-source chunk-window override. 0 = use the file-scope
    /// const default for the kind (`code_window_lines` for code,
    /// `window_size` for chat-log).
    chunk_size: usize,
    /// Owned copy of the mapping-source JSON. Lives for the session's
    /// lifetime; the parsed Mapping struct below borrows into this
    /// buffer via std.json.parseFromSlice into mapping_arena.
    mapping_json: []u8,
    /// Arena that owns the parsed mapping. Lives for the session.
    mapping_parsed: ?std.json.Parsed(std.json.Value),
    /// Field paths extracted from mapping_parsed. Empty fields = "this
    /// canonical column has no source path mapped." Borrows from
    /// mapping_parsed's arena — do not free the slices directly.
    mapping: Mapping,

    /// `shared` and `store` outlive the session; they're borrowed.
    /// `root_path` is the directory the walker is rooted at. For raw
    /// kinds (code, documentation) this is the recursive root the
    /// walker descends. For structured kinds (conversation_history,
    /// knowledge) this is the directory containing .json/.jsonl files.
    /// `mapping_json` is an object with optional `role`, `content`,
    /// `timestamp`, `session_id`, `title`, `source_uri` keys whose
    /// values are dot-paths into each JSON record. Empty / "{}" is
    /// fine for raw kinds.
    pub fn start(
        allocator: std.mem.Allocator,
        shared: *SharedModel,
        store: *Store,
        root_path: []const u8,
        kind: SourceKind,
        model_id: []const u8,
        n_workers: usize,
        user_excludes: []const []const u8,
        chunk_size: usize,
        mapping_json: []const u8,
    ) !*IngestSession {
        const session = try allocator.create(IngestSession);
        errdefer allocator.destroy(session);
        // Dupe the excludes so callers can free their source strings.
        var ex_owned = try allocator.alloc([]u8, user_excludes.len);
        var ex_filled: usize = 0;
        errdefer {
            for (ex_owned[0..ex_filled]) |s| allocator.free(s);
            allocator.free(ex_owned);
        }
        for (user_excludes) |s| {
            ex_owned[ex_filled] = try allocator.dupe(u8, s);
            ex_filled += 1;
        }
        // Stash the mapping JSON and parse it once. The parsed
        // std.json.Parsed owns its arena; we keep it on the session so
        // the borrowed strings inside `mapping` stay alive for every
        // worker. Empty / malformed JSON degrades to an all-empty
        // Mapping — raw kinds (code, documentation) don't need it
        // anyway.
        const mj_dup = try allocator.dupe(u8, mapping_json);
        var mapping_parsed: ?std.json.Parsed(std.json.Value) = null;
        var mapping_struct: Mapping = .{};
        if (mj_dup.len > 0) {
            if (std.json.parseFromSlice(std.json.Value, allocator, mj_dup, .{})) |p| {
                mapping_parsed = p;
                mapping_struct = Mapping.fromJsonValue(p.value);
            } else |_| {
                // bad JSON — leave mapping empty
            }
        }
        session.* = .{
            .allocator = allocator,
            .queue = JobQueue.init(allocator),
            .counters = .{},
            .threads = &.{},
            .cancel_flag = .init(false),
            .done_flag = .init(false),
            .cur_mutex = .{},
            .cur_buf = undefined,
            .cur_len = 0,
            .err_buf = undefined,
            .err_len = 0,
            .source_type = try allocator.dupe(u8, kind.canonicalSourceType()),
            .model_id = try allocator.dupe(u8, model_id),
            .n_workers = n_workers,
            .user_excludes = ex_owned,
            .chunk_size = chunk_size,
            .mapping_json = mj_dup,
            .mapping_parsed = mapping_parsed,
            .mapping = mapping_struct,
        };
        errdefer {
            allocator.free(session.source_type);
            allocator.free(session.model_id);
            for (session.user_excludes) |s| allocator.free(s);
            allocator.free(session.user_excludes);
            allocator.free(session.mapping_json);
            if (session.mapping_parsed) |*p| p.deinit();
            session.queue.deinit();
        }

        // Per-kind walker. Synchronous so we have an accurate files_total
        // before any worker starts. The raw kinds (code, documentation)
        // walk for embeddable text files; the structured kinds walk for
        // .json/.jsonl files. User excludes apply to all of them.
        const ex_const: [][]const u8 = blk: {
            const tmp = try allocator.alloc([]const u8, ex_owned.len);
            for (ex_owned, 0..) |s, i| tmp[i] = s;
            break :blk tmp;
        };
        defer allocator.free(ex_const);
        const files = switch (kind) {
            .code, .documentation => try findFiles(allocator, root_path, ex_const),
            .conversation_history, .knowledge => try findStructuredFiles(allocator, root_path, ex_const),
        };
        defer {
            for (files) |p| allocator.free(p);
            allocator.free(files);
        }
        const root_dup = try allocator.dupe(u8, root_path);
        defer allocator.free(root_dup);
        for (files) |p| {
            try session.queue.push(.{
                .kind = kind,
                .path = try allocator.dupe(u8, p),
                .repo_root = try allocator.dupe(u8, root_dup),
            });
        }
        session.counters.files_total = files.len;
        session.queue.close();

        // Spawn the worker pool. After spawn the threads own their own
        // WorkerCtx (private KV cache). We also spawn a "joiner" thread that
        // waits for all workers and flips done_flag. The session pointer is
        // shared by reference — its lifetime must exceed all threads.
        session.threads = try allocator.alloc(std.Thread, n_workers);
        errdefer allocator.free(session.threads);

        const ctx_vec = try allocator.alloc(*WorkerArg, n_workers);
        defer allocator.free(ctx_vec);

        for (0..n_workers) |i| {
            const arg = try allocator.create(WorkerArg);
            arg.* = .{
                .session = session,
                .shared = shared,
                .store = store,
                .worker_id = i,
            };
            ctx_vec[i] = arg;
            session.threads[i] = try std.Thread.spawn(.{}, workerEntry, .{arg});
        }

        // Joiner: separate thread that joins all workers, frees worker args,
        // and flips done_flag. Detached — the OS reaps it when the function
        // returns. Worker args are owned by the joiner.
        const joiner_arg = try allocator.create(JoinerArg);
        joiner_arg.* = .{ .session = session };
        const joiner = try std.Thread.spawn(.{}, joinerEntry, .{joiner_arg});
        joiner.detach();

        return session;
    }

    pub fn cancel(self: *IngestSession) void {
        self.cancel_flag.store(true, .seq_cst);
        self.queue.close();
    }

    pub fn snapshot(self: *IngestSession) ProgressSnapshot {
        var snap: ProgressSnapshot = .{
            .files_total = self.counters.files_total,
            .files_done = self.counters.files_done.load(.monotonic),
            .chunks_done = self.counters.chunks_done.load(.monotonic),
            .embed_ms_sum = self.counters.embed_ns.load(.monotonic) / std.time.ns_per_ms,
            .current_file = undefined,
            .current_len = 0,
            .done = self.done_flag.load(.monotonic),
            .cancelled = self.cancel_flag.load(.monotonic),
            .error_text_len = 0,
            .error_text = undefined,
        };
        self.cur_mutex.lock();
        defer self.cur_mutex.unlock();
        @memcpy(snap.current_file[0..self.cur_len], self.cur_buf[0..self.cur_len]);
        snap.current_len = self.cur_len;
        @memcpy(snap.error_text[0..self.err_len], self.err_buf[0..self.err_len]);
        snap.error_text_len = self.err_len;
        return snap;
    }

    pub fn deinit(self: *IngestSession) void {
        // Caller is responsible for not deinit'ing while threads are still
        // running. Use cancel() + poll snapshot.done before deinit if
        // there's a chance of overlap.
        self.queue.deinit();
        self.allocator.free(self.threads);
        self.allocator.free(self.source_type);
        self.allocator.free(self.model_id);
        for (self.user_excludes) |s| self.allocator.free(s);
        self.allocator.free(self.user_excludes);
        self.allocator.free(self.mapping_json);
        if (self.mapping_parsed) |*p| p.deinit();
        self.allocator.destroy(self);
    }

    fn setCurrent(self: *IngestSession, path: []const u8) void {
        const len = @min(path.len, self.cur_buf.len);
        self.cur_mutex.lock();
        defer self.cur_mutex.unlock();
        @memcpy(self.cur_buf[0..len], path[0..len]);
        self.cur_len = len;
    }

    fn setError(self: *IngestSession, text: []const u8) void {
        const len = @min(text.len, self.err_buf.len);
        self.cur_mutex.lock();
        defer self.cur_mutex.unlock();
        @memcpy(self.err_buf[0..len], text[0..len]);
        self.err_len = len;
    }
};

const WorkerArg = struct {
    session: *IngestSession,
    shared: *SharedModel,
    store: *Store,
    worker_id: usize,
};

const JoinerArg = struct {
    session: *IngestSession,
};

fn workerEntry(arg: *WorkerArg) void {
    defer std.heap.c_allocator.destroy(arg);

    var ctx = arg.shared.newWorker(8192) catch |e| {
        var buf: [128]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "worker {d} init failed: {s}", .{ arg.worker_id, @errorName(e) }) catch "worker init failed";
        arg.session.setError(msg);
        return;
    };
    defer ctx.deinit();

    const arena_state = std.heap.c_allocator;
    var arena = std.heap.ArenaAllocator.init(arena_state);
    defer arena.deinit();
    const a = arena.allocator();

    while (arg.session.queue.pop()) |job_in| {
        if (arg.session.cancel_flag.load(.monotonic)) {
            var j = job_in;
            j.deinit(arg.session.allocator);
            continue;
        }
        var job = job_in;
        defer job.deinit(arg.session.allocator);

        // Per-job arena reset keeps memory bounded across thousands of files.
        _ = arena.reset(.retain_capacity);

        // Update "currently processing" UX hint.
        const rel = relTo(job.path, job.repo_root);
        arg.session.setCurrent(rel);

        processJob(a, &ctx, arg.store, &job, arg.session) catch |e| {
            var buf: [256]u8 = undefined;
            const msg = std.fmt.bufPrint(&buf, "{s}: {s}", .{ rel, @errorName(e) }) catch "file failed";
            arg.session.setError(msg);
        };
        _ = arg.session.counters.files_done.fetchAdd(1, .monotonic);
    }
}

fn joinerEntry(arg: *JoinerArg) void {
    defer std.heap.c_allocator.destroy(arg);
    for (arg.session.threads) |t| t.join();
    arg.session.done_flag.store(true, .seq_cst);
}

fn relTo(path: []const u8, root: []const u8) []const u8 {
    if (path.len > root.len + 1 and std.mem.startsWith(u8, path, root) and path[root.len] == '/') {
        return path[root.len + 1 ..];
    }
    return path;
}

fn processJob(
    allocator: std.mem.Allocator,
    ctx: *WorkerCtx,
    store: *Store,
    job: *const Job,
    session: *IngestSession,
) !void {
    return switch (job.kind) {
        // Documentation aliases to the code chunker (line-window). A
        // paragraph-aware chunker is a future improvement; for v1 a
        // 200-line window over a .md file is good enough — the
        // embedding model doesn't care about prose vs code boundaries
        // as much as we do.
        .code, .documentation => processCode(allocator, ctx, store, job, session),
        .conversation_history => processConversationMapped(allocator, ctx, store, job, session),
        .knowledge => processKnowledgeMapped(allocator, ctx, store, job, session),
    };
}

fn processCode(
    allocator: std.mem.Allocator,
    ctx: *WorkerCtx,
    store: *Store,
    job: *const Job,
    session: *IngestSession,
) !void {
    const rel = relTo(job.path, job.repo_root);
    const lang = detectLang(rel);

    const file = std.fs.openFileAbsolute(job.path, .{}) catch return;
    defer file.close();
    const stat = file.stat() catch return;
    if (stat.size == 0) return;
    if (stat.size > max_file_bytes) return;
    const content = file.readToEndAlloc(allocator, @intCast(stat.size)) catch return;

    var lines = std.array_list.Managed([]const u8).init(allocator);
    defer lines.deinit();
    var line_iter = std.mem.splitScalar(u8, content, '\n');
    while (line_iter.next()) |line| try lines.append(line);
    if (lines.items.len == 0) return;

    const source_id = try std.fmt.allocPrint(allocator, "code/{s}", .{rel});

    // Each chunk is byte-capped + UTF-8-sanitised so the tokenizer sees
    // clean, bounded input.
    const chunk_byte_cap: usize = 32 * 1024;
    // chunk_size = 0 → fall back to the file-scope default. Overlap is
    // scaled to a quarter of the window so tiny windows don't gap-out
    // and big ones don't burn cycles on redundant context.
    const window_lines: usize = if (session.chunk_size > 0) session.chunk_size else code_window_lines;
    const overlap_lines: usize = if (session.chunk_size > 0)
        @max(@as(usize, 1), window_lines / 4)
    else
        code_overlap_lines;
    var chunk_bodies = std.array_list.Managed([]u8).init(allocator);
    defer chunk_bodies.deinit();
    {
        var i: usize = 0;
        while (i < lines.items.len) {
            const end = @min(i + window_lines, lines.items.len);
            var body = std.array_list.Managed(u8).init(allocator);
            defer body.deinit();
            try body.writer().print("// File: {s}\n// Lang: {s}\n// Lines: {d}-{d}\n\n", .{ rel, lang, i + 1, end });
            for (lines.items[i..end], 0..) |line, j| {
                if (j > 0) try body.append('\n');
                try body.appendSlice(line);
                if (body.items.len > chunk_byte_cap) break;
            }
            const truncated = body.items[0..@min(body.items.len, chunk_byte_cap)];
            const cleaned = try sanitizeUtf8(allocator, truncated);
            try chunk_bodies.append(cleaned);
            if (end == lines.items.len) break;
            i += window_lines - overlap_lines;
        }
    }

    for (chunk_bodies.items, 0..) |body, ci| {
        if (session.cancel_flag.load(.monotonic)) return;
        const t0 = host_io.nanoTimestamp();
        const vec = ctx.embedText(allocator, body) catch continue;
        const t1 = host_io.nanoTimestamp();
        _ = session.counters.embed_ns.fetchAdd(@intCast(t1 - t0), .monotonic);

        const id_input = try std.fmt.allocPrint(allocator, "{s}#{d}#{s}", .{ source_id, ci, session.model_id });
        const id_hex = shaHex(id_input);
        const id = id_hex[0..40];
        const sha_full = shaHex(body);
        const text_sha = sha_full[0..40];
        const preview_len: usize = @min(160, body.len);
        const meta = try std.fmt.allocPrint(
            allocator,
            "{{\"path\":\"{s}\",\"lang\":\"{s}\"}}",
            .{ rel, lang },
        );
        store.upsert(
            id,
            session.source_type,
            source_id,
            @intCast(ci),
            body,
            body[0..preview_len],
            meta,
            session.model_id,
            text_sha,
            vec,
        ) catch {};
        _ = session.counters.chunks_done.fetchAdd(1, .monotonic);
    }
}

/// Recursive walker that collects every `.jsonl` and `.json` file under
/// `root`. Used by the structured kinds (conversation_history, knowledge)
/// — no vendor-specific subdirectory shapes assumed. Same exclude
/// semantics as `findFiles`. Caller owns the returned slice and paths.
pub fn findStructuredFiles(
    allocator: std.mem.Allocator,
    root: []const u8,
    user_excludes: []const []const u8,
) ![][]u8 {
    var out = std.array_list.Managed([]u8).init(allocator);
    errdefer {
        for (out.items) |p| allocator.free(p);
        out.deinit();
    }
    var dir = try std.fs.openDirAbsolute(root, .{ .iterate = true });
    defer dir.close();
    var walker = try dir.walk(allocator);
    defer walker.deinit();
    while (try walker.next()) |entry| {
        if (entry.kind != .file) continue;
        if (shouldSkipPath(entry.path, user_excludes)) continue;
        const lower = entry.basename;
        if (!std.mem.endsWith(u8, lower, ".jsonl") and !std.mem.endsWith(u8, lower, ".json"))
            continue;
        const full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ root, entry.path });
        try out.append(full);
    }
    std.mem.sort([]u8, out.items, {}, struct {
        fn lt(_: void, a: []u8, b: []u8) bool { return std.mem.lessThan(u8, a, b); }
    }.lt);
    return out.toOwnedSlice();
}

/// Conversation-history ingest, mapping-driven. The user supplied a
/// Mapping (role/content/timestamp/session_id paths) on the session.
/// We read the file (.jsonl or .json array), apply the mapping per
/// record to build FlatEvents, window them, embed each window.
///
/// This replaces the per-vendor parsers (parseClaudeJsonl etc.) — same
/// FlatEvent → windowEvents → store.upsert pipeline, but with a
/// user-declared mapping instead of hardcoded field paths. Settings →
/// Embed presets pre-fill the mapping for known formats.
fn processConversationMapped(
    allocator: std.mem.Allocator,
    ctx: *WorkerCtx,
    store: *Store,
    job: *const Job,
    session: *IngestSession,
) !void {
    if (session.mapping.content.len == 0) return; // nothing to extract

    const basename = std.fs.path.basename(job.path);
    const session_id = try std.fmt.allocPrint(allocator, "conversation-history/{s}", .{basename});
    defer allocator.free(session_id);

    const file = std.fs.openFileAbsolute(job.path, .{}) catch return;
    defer file.close();
    const stat = file.stat() catch return;
    if (stat.size == 0) return;
    if (stat.size > 200 * 1024 * 1024) return;
    const data = file.readToEndAlloc(allocator, @intCast(stat.size)) catch return;
    defer allocator.free(data);

    // Build event list by walking the file as records. JSONL is the
    // common path (one record per line); fall through to a single-array
    // root for plain .json. We don't try to handle nested-object roots
    // — those need a different mapping shape we haven't designed yet.
    var events = std.array_list.Managed(FlatEvent).init(allocator);
    defer {
        for (events.items) |*e| freeEvent(allocator, e);
        events.deinit();
    }

    if (std.mem.endsWith(u8, basename, ".jsonl")) {
        var line_iter = std.mem.tokenizeScalar(u8, data, '\n');
        while (line_iter.next()) |line| {
            if (line.len == 0 or line[0] != '{') continue;
            appendMappedConversation(allocator, &events, line, session.mapping) catch continue;
        }
    } else {
        // .json — expect a top-level array of records.
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, data, .{}) catch return;
        defer parsed.deinit();
        if (parsed.value != .array) return;
        for (parsed.value.array.items) |item| {
            // appendMappedConversation expects a fresh parse — we re-stringify
            // each item and feed it back through. Simpler than threading an
            // already-parsed Value through; .json arrays are rare in practice.
            const item_str = std.json.Stringify.valueAlloc(allocator, item, .{}) catch continue;
            defer allocator.free(item_str);
            appendMappedConversation(allocator, &events, item_str, session.mapping) catch continue;
        }
    }
    if (events.items.len == 0) return;

    var chunks = try windowEvents(allocator, session_id, events.items, session.chunk_size);
    defer {
        for (chunks.items) |*ch| freeChunk(allocator, ch);
        chunks.deinit();
    }

    for (chunks.items) |ch| {
        if (session.cancel_flag.load(.monotonic)) return;
        const cleaned = try sanitizeUtf8(allocator, ch.display_text);
        defer allocator.free(cleaned);
        const cap: usize = 32 * 1024;
        const body = if (cleaned.len > cap) cleaned[0..cap] else cleaned;

        const t0 = host_io.nanoTimestamp();
        const vec = ctx.embedText(allocator, body) catch continue;
        _ = session.counters.embed_ns.fetchAdd(@intCast(host_io.nanoTimestamp() - t0), .monotonic);

        const id_input = try std.fmt.allocPrint(allocator, "{s}#{d}#{s}", .{ session_id, ch.chunk_index, session.model_id });
        defer allocator.free(id_input);
        const id_hex = shaHex(id_input);
        const id = id_hex[0..40];
        const sha_full = shaHex(body);
        const text_sha = sha_full[0..40];
        const preview_len: usize = @min(160, body.len);
        const meta = try std.fmt.allocPrint(
            allocator,
            "{{\"file\":\"{s}\",\"role_sequence\":\"{s}\",\"first_ts\":\"{s}\",\"last_ts\":\"{s}\"}}",
            .{ basename, ch.role_sequence, ch.first_ts, ch.last_ts },
        );
        defer allocator.free(meta);
        store.upsert(
            id,
            session.source_type,
            session_id,
            @intCast(ch.chunk_index),
            body,
            body[0..preview_len],
            meta,
            session.model_id,
            text_sha,
            vec,
        ) catch {};
        _ = session.counters.chunks_done.fetchAdd(1, .monotonic);
    }
}

fn appendMappedConversation(
    allocator: std.mem.Allocator,
    out: *std.array_list.Managed(FlatEvent),
    line: []const u8,
    mapping: Mapping,
) !void {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, line, .{}) catch return;
    defer parsed.deinit();
    const root = parsed.value;

    const content_v = getJsonPath(root, mapping.content) orelse return;
    const content_text = try extractText(allocator, content_v);
    defer allocator.free(content_text);
    if (content_text.len == 0) return;

    const role: []const u8 = if (mapping.role.len > 0) blk: {
        const v = getJsonPath(root, mapping.role) orelse break :blk "user";
        if (v == .string) break :blk v.string;
        break :blk "user";
    } else "user";

    const ts: []const u8 = if (mapping.timestamp.len > 0) blk: {
        const v = getJsonPath(root, mapping.timestamp) orelse break :blk "";
        if (v == .string) break :blk v.string;
        break :blk "";
    } else "";

    try pushEvent(allocator, out, ts, role, content_text, false);
}

/// Knowledge ingest. One record = one chunk (no windowing). Used for
/// atomic facts: each row in the JSONL is a self-contained piece of
/// knowledge with optional title + source_uri metadata. Embeds the
/// concatenation of `# {title}\n\n{content}` (title omitted if unmapped).
fn processKnowledgeMapped(
    allocator: std.mem.Allocator,
    ctx: *WorkerCtx,
    store: *Store,
    job: *const Job,
    session: *IngestSession,
) !void {
    if (session.mapping.content.len == 0) return;

    const basename = std.fs.path.basename(job.path);
    const file = std.fs.openFileAbsolute(job.path, .{}) catch return;
    defer file.close();
    const stat = file.stat() catch return;
    if (stat.size == 0) return;
    if (stat.size > 200 * 1024 * 1024) return;
    const data = file.readToEndAlloc(allocator, @intCast(stat.size)) catch return;
    defer allocator.free(data);

    var record_index: usize = 0;
    if (std.mem.endsWith(u8, basename, ".jsonl")) {
        var line_iter = std.mem.tokenizeScalar(u8, data, '\n');
        while (line_iter.next()) |line| {
            if (line.len == 0 or line[0] != '{') continue;
            if (session.cancel_flag.load(.monotonic)) return;
            embedKnowledgeRecord(allocator, ctx, store, session, basename, line, record_index) catch {};
            record_index += 1;
        }
    } else {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, data, .{}) catch return;
        defer parsed.deinit();
        if (parsed.value != .array) return;
        for (parsed.value.array.items) |item| {
            if (session.cancel_flag.load(.monotonic)) return;
            const item_str = std.json.Stringify.valueAlloc(allocator, item, .{}) catch continue;
            defer allocator.free(item_str);
            embedKnowledgeRecord(allocator, ctx, store, session, basename, item_str, record_index) catch {};
            record_index += 1;
        }
    }
}

fn embedKnowledgeRecord(
    allocator: std.mem.Allocator,
    ctx: *WorkerCtx,
    store: *Store,
    session: *IngestSession,
    file_basename: []const u8,
    line: []const u8,
    record_index: usize,
) !void {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, line, .{}) catch return;
    defer parsed.deinit();
    const root = parsed.value;

    const content_v = getJsonPath(root, session.mapping.content) orelse return;
    const content_text = try extractText(allocator, content_v);
    defer allocator.free(content_text);
    if (content_text.len == 0) return;

    const title: []const u8 = if (session.mapping.title.len > 0) blk: {
        const v = getJsonPath(root, session.mapping.title) orelse break :blk "";
        if (v == .string) break :blk v.string;
        break :blk "";
    } else "";
    const source_uri: []const u8 = if (session.mapping.source_uri.len > 0) blk: {
        const v = getJsonPath(root, session.mapping.source_uri) orelse break :blk "";
        if (v == .string) break :blk v.string;
        break :blk "";
    } else "";

    const display_text = if (title.len > 0)
        try std.fmt.allocPrint(allocator, "# {s}\n\n{s}", .{ title, content_text })
    else
        try allocator.dupe(u8, content_text);
    defer allocator.free(display_text);

    const cleaned = try sanitizeUtf8(allocator, display_text);
    defer allocator.free(cleaned);
    const cap: usize = 32 * 1024;
    const body = if (cleaned.len > cap) cleaned[0..cap] else cleaned;
    const preview_len: usize = @min(160, body.len);

    const source_id = try std.fmt.allocPrint(allocator, "knowledge/{s}#{d}", .{ file_basename, record_index });
    defer allocator.free(source_id);
    const id_input = try std.fmt.allocPrint(allocator, "{s}#{s}", .{ source_id, session.model_id });
    defer allocator.free(id_input);
    const id_hex = shaHex(id_input);
    const id = id_hex[0..40];
    const sha_full = shaHex(body);
    const text_sha = sha_full[0..40];

    const meta_title = if (title.len > 0) title else "";
    const meta_uri = if (source_uri.len > 0) source_uri else "";
    const meta = try std.fmt.allocPrint(
        allocator,
        "{{\"file\":\"{s}\",\"title\":\"{s}\",\"source_uri\":\"{s}\"}}",
        .{ file_basename, meta_title, meta_uri },
    );
    defer allocator.free(meta);

    const t0 = host_io.nanoTimestamp();
    const vec = ctx.embedText(allocator, body) catch return;
    _ = session.counters.embed_ns.fetchAdd(@intCast(host_io.nanoTimestamp() - t0), .monotonic);

    try store.upsert(
        id,
        session.source_type,
        source_id,
        @intCast(record_index),
        body,
        body[0..preview_len],
        meta,
        session.model_id,
        text_sha,
        vec,
    );
    _ = session.counters.chunks_done.fetchAdd(1, .monotonic);
}
