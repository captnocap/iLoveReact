//! framework/luajit_worker_stub.zig — empty implementation for carts that
//! don't link luajit. Selected by framework/luajit_worker.zig when
//! build_options.has_lua_worker is false.
//!
//! Every export fn is here so the linker resolves the same symbol set
//! regardless of mode; the stubs return zero / "not running" for all
//! counter and message ops, and logTelemetry is a no-op.

const std = @import("std");

export fn lua_worker_start() callconv(.c) c_long {
    return 0;
}

export fn lua_worker_stop() callconv(.c) c_long {
    return 0;
}

export fn lua_worker_send(count: c_long) callconv(.c) c_long {
    _ = count;
    return 0;
}

export fn lua_worker_recv_count() callconv(.c) c_long {
    return 0;
}

export fn lua_worker_bridge_n() callconv(.c) c_long {
    return 0;
}

export fn lua_worker_set_n(n: c_long) callconv(.c) c_long {
    return n;
}

export fn lua_worker_elapsed_us() callconv(.c) c_long {
    return 0;
}

export fn lua_worker_send_msg(msg: [*c]const u8, len: c_long) callconv(.c) c_long {
    _ = msg;
    _ = len;
    return 0;
}

export fn lua_worker_recv_msg(buf: [*c]u8, buf_len: c_long) callconv(.c) c_long {
    _ = buf;
    _ = buf_len;
    return 0;
}

export fn lua_worker_eval(code: [*c]const u8, len: c_long) callconv(.c) c_long {
    _ = code;
    _ = len;
    return 0;
}

pub fn logTelemetry() void {}
