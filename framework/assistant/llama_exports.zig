//! Force-export llama.cpp symbols for LuaJIT ffi.C access.
//! The linker drops unreferenced symbols from static archives.
//! This file references each symbol we need, preventing dead-code elimination.

const std = @import("std");

// Opaque C types
const llama_model = opaque {};
const llama_context = opaque {};
const llama_sampler = opaque {};
const llama_vocab = opaque {};
const llama_memory = opaque {};

// C struct forward declarations (we only need pointers)
const llama_model_params = extern struct { _pad: [256]u8 = undefined };
const llama_context_params = extern struct { _pad: [256]u8 = undefined };
const llama_sampler_chain_params = extern struct { no_perf: bool };
const llama_batch = extern struct {
    n_tokens: i32,
    token: ?*i32,
    embd: ?*f32,
    pos: ?*i32,
    n_seq_id: ?*i32,
    seq_id: ?*?*i32,
    logits: ?*i8,
};
const llama_chat_message = extern struct {
    role: [*:0]const u8,
    content: [*:0]const u8,
};

// Declare all the extern functions we need
extern "c" fn llama_backend_init() void;
extern "c" fn llama_model_default_params() llama_model_params;
extern "c" fn llama_context_default_params() llama_context_params;
extern "c" fn llama_sampler_chain_default_params() llama_sampler_chain_params;
extern "c" fn llama_model_load_from_file(path: [*:0]const u8, params: llama_model_params) ?*llama_model;
extern "c" fn llama_model_free(model: *llama_model) void;
extern "c" fn llama_model_get_vocab(model: *const llama_model) *const llama_vocab;
extern "c" fn llama_model_chat_template(model: *const llama_model, name: ?[*:0]const u8) ?[*:0]const u8;
extern "c" fn llama_vocab_is_eog(vocab: *const llama_vocab, token: i32) bool;
extern "c" fn llama_init_from_model(model: *llama_model, params: llama_context_params) ?*llama_context;
extern "c" fn llama_free(ctx: *llama_context) void;
extern "c" fn llama_n_ctx(ctx: *const llama_context) u32;
extern "c" fn llama_tokenize(vocab: *const llama_vocab, text: [*]const u8, text_len: i32, tokens: ?*i32, n_max: i32, add_special: bool, parse_special: bool) i32;
extern "c" fn llama_token_to_piece(vocab: *const llama_vocab, token: i32, buf: [*]u8, length: i32, lstrip: i32, special: bool) i32;
extern "c" fn llama_chat_apply_template(tmpl: ?[*:0]const u8, chat: [*]const llama_chat_message, n_msg: usize, add_ass: bool, buf: ?[*]u8, length: i32) i32;
extern "c" fn llama_batch_get_one(tokens: *i32, n_tokens: i32) llama_batch;
extern "c" fn llama_decode(ctx: *llama_context, batch: llama_batch) i32;
extern "c" fn llama_sampler_chain_init(params: llama_sampler_chain_params) ?*llama_sampler;
extern "c" fn llama_sampler_chain_add(chain: *llama_sampler, smpl: *llama_sampler) void;
extern "c" fn llama_sampler_free(smpl: *llama_sampler) void;
extern "c" fn llama_sampler_init_top_k(k: i32) ?*llama_sampler;
extern "c" fn llama_sampler_init_top_p(p: f32, min_keep: usize) ?*llama_sampler;
extern "c" fn llama_sampler_init_min_p(p: f32, min_keep: usize) ?*llama_sampler;
extern "c" fn llama_sampler_init_temp(t: f32) ?*llama_sampler;
extern "c" fn llama_sampler_init_penalties(n: i32, repeat: f32, freq: f32, present: f32) ?*llama_sampler;
extern "c" fn llama_sampler_init_dist(seed: u32) ?*llama_sampler;
extern "c" fn llama_sampler_sample(smpl: *llama_sampler, ctx: *llama_context, idx: i32) i32;
extern "c" fn llama_get_memory(ctx: *llama_context) ?*llama_memory;
extern "c" fn llama_memory_clear(mem: *llama_memory, data: bool) void;

/// Called from core.zig or engine.zig to force the linker to retain all symbols.
/// The export keyword + noinline prevents dead code elimination.
pub export fn __llama_force_exports() callconv(.c) usize {
    // Take address of each function — this forces the linker to keep them.
    // The volatile read prevents the optimizer from removing this.
    var sum: usize = 0;
    const fns = [_]*const anyopaque{
        @ptrCast(&llama_backend_init),
        @ptrCast(&llama_model_default_params),
        @ptrCast(&llama_context_default_params),
        @ptrCast(&llama_sampler_chain_default_params),
        @ptrCast(&llama_model_load_from_file),
        @ptrCast(&llama_model_free),
        @ptrCast(&llama_model_get_vocab),
        @ptrCast(&llama_model_chat_template),
        @ptrCast(&llama_vocab_is_eog),
        @ptrCast(&llama_init_from_model),
        @ptrCast(&llama_free),
        @ptrCast(&llama_n_ctx),
        @ptrCast(&llama_tokenize),
        @ptrCast(&llama_token_to_piece),
        @ptrCast(&llama_chat_apply_template),
        @ptrCast(&llama_batch_get_one),
        @ptrCast(&llama_decode),
        @ptrCast(&llama_sampler_chain_init),
        @ptrCast(&llama_sampler_chain_add),
        @ptrCast(&llama_sampler_free),
        @ptrCast(&llama_sampler_init_top_k),
        @ptrCast(&llama_sampler_init_top_p),
        @ptrCast(&llama_sampler_init_min_p),
        @ptrCast(&llama_sampler_init_temp),
        @ptrCast(&llama_sampler_init_penalties),
        @ptrCast(&llama_sampler_init_dist),
        @ptrCast(&llama_sampler_sample),
        @ptrCast(&llama_get_memory),
        @ptrCast(&llama_memory_clear),
    };
    for (fns) |f| {
        sum +%= @intFromPtr(f);
    }
    return sum;
}
