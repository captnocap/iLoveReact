//! Whole-frame pump for subprocess-backed render sources.
//!
//! A raw RGBA camera frame is several megabytes, while a Linux pipe read may
//! complete with only a few kilobytes. Polling one completed read from the
//! frame thread therefore cannot keep up with a live source. This owner keeps
//! the blocking exact-frame read in a cancelable native-Io task and exposes a
//! pointer-swap boundary to the renderer: no frame bytes are copied or waited
//! on by the frame thread.

const std = @import("std");

const READ_BUFFER_BYTES: usize = 64 * 1024;

pub const Outcome = enum(u8) {
    running,
    end_of_stream,
    read_failed,
};

pub const FramePump = struct {
    state: *State,

    const State = struct {
        io: std.Io,
        allocator: std.mem.Allocator,
        file: std.Io.File,
        frame_size: usize,
        tasks: std.Io.Group = .init,
        mutex: std.Io.Mutex = .init,
        write_buf: []u8,
        ready_buf: []u8,
        ready_valid: bool = false,
        outcome: std.atomic.Value(Outcome) = .init(.running),

        fn readLoop(state: *State) std.Io.Cancelable!void {
            var read_backing: [READ_BUFFER_BYTES]u8 = undefined;
            var file_reader = state.file.readerStreaming(state.io, &read_backing);

            while (true) {
                file_reader.interface.readSliceAll(state.write_buf) catch |err| switch (err) {
                    error.EndOfStream => {
                        state.outcome.store(.end_of_stream, .release);
                        return;
                    },
                    else => {
                        state.outcome.store(.read_failed, .release);
                        return;
                    },
                };

                state.mutex.lockUncancelable(state.io);
                std.mem.swap([]u8, &state.write_buf, &state.ready_buf);
                state.ready_valid = true;
                state.mutex.unlock(state.io);
            }
        }
    };

    pub fn init(
        io: std.Io,
        allocator: std.mem.Allocator,
        file: std.Io.File,
        frame_size: usize,
    ) !FramePump {
        if (frame_size == 0) return error.InvalidFrameSize;

        const state = try allocator.create(State);
        errdefer allocator.destroy(state);
        const write_buf = try allocator.alloc(u8, frame_size);
        errdefer allocator.free(write_buf);
        const ready_buf = try allocator.alloc(u8, frame_size);
        errdefer allocator.free(ready_buf);

        state.* = .{
            .io = io,
            .allocator = allocator,
            .file = file,
            .frame_size = frame_size,
            .write_buf = write_buf,
            .ready_buf = ready_buf,
        };
        try state.tasks.concurrent(io, State.readLoop, .{state});
        return .{ .state = state };
    }

    /// Takes the newest complete frame, if one exists, and gives the pump the
    /// caller's old same-sized buffer to recycle. Ownership swaps only when a
    /// non-null slice is returned.
    pub fn takeLatest(self: *FramePump, io: std.Io, recycle: []u8) ?[]u8 {
        const state = self.state;
        std.debug.assert(recycle.len == state.frame_size);

        state.mutex.lockUncancelable(io);
        defer state.mutex.unlock(io);
        if (!state.ready_valid) return null;

        const fresh = state.ready_buf;
        state.ready_buf = recycle;
        state.ready_valid = false;
        return fresh;
    }

    pub fn outcome(self: *const FramePump) Outcome {
        return self.state.outcome.load(.acquire);
    }

    pub fn deinit(self: *FramePump, io: std.Io) void {
        const state = self.state;
        state.tasks.cancel(io);
        // The owning std.process.Child closes its piped handles during wait;
        // closing here would make that cleanup double-close the descriptor.
        state.allocator.free(state.write_buf);
        state.allocator.free(state.ready_buf);
        const allocator = state.allocator;
        allocator.destroy(state);
        self.* = undefined;
    }
};
