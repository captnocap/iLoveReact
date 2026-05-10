//! framework/frame_telemetry.zig — per-frame timing counters previously
//! housed in qjs_runtime.zig despite having nothing to do with QuickJS.
//! Moved out as part of the QJS eviction (archive/qjs-stack/README.md).
//!
//! Writers: framework/engine.zig (frame loop updates these each tick).
//! Readers: framework/v8_bindings_telemetry.zig, framework/dev_ipc.zig.

pub var telemetry_fps: u32 = 0;
pub var telemetry_layout_us: i64 = 0;
pub var telemetry_paint_us: i64 = 0;
pub var telemetry_tick_us: i64 = 0;
pub var telemetry_gpu_us: i64 = 0;
pub var telemetry_bridge_calls: u32 = 0;
pub var bridge_calls_this_second: u32 = 0;
