//! Policy gate between a detected development bundle change and VM teardown.
//! The watcher reports facts here; application settings decide when that fact
//! becomes a reload. Nothing in this module knows about React or editor state.

pub const Policy = enum(u8) {
    automatic = 0,
    ask = 1,
    off = 2,
};

pub const Controller = struct {
    policy: Policy = .automatic,
    held_change: bool = false,
    reload_pending: bool = false,

    pub fn setPolicy(self: *Controller, raw: u8) bool {
        const next: Policy = switch (raw) {
            0 => .automatic,
            1 => .ask,
            2 => .off,
            else => return false,
        };
        self.policy = next;
        if (next == .automatic and self.held_change) {
            self.held_change = false;
            self.reload_pending = true;
        }
        return true;
    }

    pub fn onBundleChanged(self: *Controller) void {
        if (self.policy == .automatic) self.reload_pending = true else self.held_change = true;
    }

    pub fn waitingForApproval(self: *const Controller) bool {
        return self.policy == .ask and self.held_change;
    }

    pub fn applyHeld(self: *Controller) bool {
        if (!self.held_change) return false;
        self.held_change = false;
        self.reload_pending = true;
        return true;
    }

    pub fn takeReload(self: *Controller) bool {
        if (!self.reload_pending) return false;
        self.reload_pending = false;
        return true;
    }
};
