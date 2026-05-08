//! framework/luajit_worker.zig — feature-gated dispatcher for the
//! off-thread LuaJIT worker.
//!
//! When -Dhas-lua-worker=true (passed by scripts/ship for carts whose
//! source triggers the `lua-worker` feature in
//! sdk/dependency-registry.json), this re-exports
//! framework/luajit_worker_real.zig (the real zluajit-backed
//! implementation). Otherwise it re-exports framework/luajit_worker_stub.zig,
//! whose exports return zero / "not running" and libluajit isn't linked.
//!
//! The conditional `@import` ensures the unselected file isn't compiled,
//! so luajit_worker_real.zig's `@import("zluajit")` only runs when the
//! library is actually being linked. engine.zig force-references the
//! resulting export fns so the linker keeps them whichever side wins.

const build_options = @import("build_options");

const HAS_LUA_WORKER = if (@hasDecl(build_options, "has_lua_worker"))
    build_options.has_lua_worker
else
    false;

const impl = if (HAS_LUA_WORKER)
    @import("luajit_worker_real.zig")
else
    @import("luajit_worker_stub.zig");

pub const logTelemetry = impl.logTelemetry;
