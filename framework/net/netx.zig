//! netx: the std.net subset Zig 0.16 deleted, lifted verbatim from 0.15.2's
//! lib/std/net.zig for the exempt readiness layer (door b,
//! docs/ZIG_016_MIGRATION.md §6). Address/Ip4/Ip6, AddressList +
//! getAddressList (libc getaddrinfo path), tcpConnectToHost/Address, and the
//! fd-wrapper Stream — with posix routed through sysx so error discrimination
//! stays byte-identical to 0.15. Do NOT migrate call sites to std.Io.net.
const std = @import("std");
const builtin = @import("builtin");
const sysx = @import("sysx.zig");
const posix = sysx;
const net = @This();
const mem = std.mem;
const fmt = std.fmt;
const io = std.io;
const math = std.math;
const ascii = std.ascii;
const Allocator = std.mem.Allocator;
const File = std.Io.File;
const assert = std.debug.assert;
const native_os = builtin.os.tag;
const Io = std.Io;
const ArrayList = std.ArrayList;
const native_endian = builtin.target.cpu.arch.endian();
pub const IPParseError = error{
    Overflow,
    InvalidEnd,
    InvalidCharacter,
    Incomplete,
};
pub const IPv4ParseError = IPParseError || error{NonCanonical};
pub const IPv6ParseError = IPParseError || error{InvalidIpv4Mapping};
pub const IPv6InterfaceError = sysx.SocketError || error{ NameTooLong, Unexpected };
const has_unix_sockets = switch (native_os) {
    .windows => builtin.os.version_range.windows.isAtLeast(.win10_rs4) orelse false,
    else => true,
};
const windows = std.os.windows;

// ---- everything below is lifted 0.15.2 std.net source ----
const GetAddressListError = Allocator.Error || File.OpenError || File.ReadError || posix.SocketError || posix.BindError || posix.SetSockOptError || error{
    TemporaryNameServerFailure,
    NameServerFailure,
    AddressFamilyNotSupported,
    UnknownHostName,
    ServiceUnavailable,
    Unexpected,

    HostLacksNetworkAddresses,

    InvalidCharacter,
    InvalidEnd,
    NonCanonical,
    Overflow,
    Incomplete,
    InvalidIpv4Mapping,
    InvalidIPAddressFormat,

    InterfaceNotFound,
    FileSystem,
    ResolveConfParseFailed,
};
pub const TcpConnectToHostError = GetAddressListError || TcpConnectToAddressError;
pub const TcpConnectToAddressError = posix.SocketError || posix.ConnectError;

pub const Address = extern union {
    any: posix.sockaddr,
    in: Ip4Address,
    in6: Ip6Address,
    un: if (has_unix_sockets) posix.sockaddr.un else void,

    /// Parse an IP address which may include a port. For IPv4, this is just written `address:port`.
    /// For IPv6, RFC 3986 defines this as an "IP literal", and the port is differentiated from the
    /// address by surrounding the address part in brackets '[addr]:port'. Even if the port is not
    /// given, the brackets are mandatory.
    pub fn parseIpAndPort(str: []const u8) error{ InvalidAddress, InvalidPort }!Address {
        if (str.len == 0) return error.InvalidAddress;
        if (str[0] == '[') {
            const addr_end = std.mem.indexOfScalar(u8, str, ']') orelse
                return error.InvalidAddress;
            const addr_str = str[1..addr_end];
            const port: u16 = p: {
                if (addr_end == str.len - 1) break :p 0;
                if (str[addr_end + 1] != ':') return error.InvalidAddress;
                break :p parsePort(str[addr_end + 2 ..]) orelse return error.InvalidPort;
            };
            return parseIp6(addr_str, port) catch error.InvalidAddress;
        } else {
            if (std.mem.indexOfScalar(u8, str, ':')) |idx| {
                // hold off on `error.InvalidPort` since `error.InvalidAddress` might make more sense
                const port: ?u16 = parsePort(str[idx + 1 ..]);
                const addr = parseIp4(str[0..idx], port orelse 0) catch return error.InvalidAddress;
                if (port == null) return error.InvalidPort;
                return addr;
            } else {
                return parseIp4(str, 0) catch error.InvalidAddress;
            }
        }
    }
    fn parsePort(str: []const u8) ?u16 {
        var p: u16 = 0;
        for (str) |c| switch (c) {
            '0'...'9' => {
                const shifted = std.math.mul(u16, p, 10) catch return null;
                p = std.math.add(u16, shifted, c - '0') catch return null;
            },
            else => return null,
        };
        if (p == 0) return null;
        return p;
    }

    /// Parse the given IP address string into an Address value.
    /// It is recommended to use `resolveIp` instead, to handle
    /// IPv6 link-local unix addresses.
    pub fn parseIp(name: []const u8, port: u16) !Address {
        if (parseIp4(name, port)) |ip4| return ip4 else |err| switch (err) {
            error.Overflow,
            error.InvalidEnd,
            error.InvalidCharacter,
            error.Incomplete,
            error.NonCanonical,
            => {},
        }

        if (parseIp6(name, port)) |ip6| return ip6 else |err| switch (err) {
            error.Overflow,
            error.InvalidEnd,
            error.InvalidCharacter,
            error.Incomplete,
            error.InvalidIpv4Mapping,
            => {},
        }

        return error.InvalidIPAddressFormat;
    }

    pub fn resolveIp(name: []const u8, port: u16) !Address {
        if (parseIp4(name, port)) |ip4| return ip4 else |err| switch (err) {
            error.Overflow,
            error.InvalidEnd,
            error.InvalidCharacter,
            error.Incomplete,
            error.NonCanonical,
            => {},
        }

        if (resolveIp6(name, port)) |ip6| return ip6 else |err| switch (err) {
            error.Overflow,
            error.InvalidEnd,
            error.InvalidCharacter,
            error.Incomplete,
            error.InvalidIpv4Mapping,
            => {},
            else => return err,
        }

        return error.InvalidIPAddressFormat;
    }

    pub fn parseExpectingFamily(name: []const u8, family: posix.sa_family_t, port: u16) !Address {
        switch (family) {
            posix.AF.INET => return parseIp4(name, port),
            posix.AF.INET6 => return parseIp6(name, port),
            posix.AF.UNSPEC => return parseIp(name, port),
            else => unreachable,
        }
    }

    pub fn parseIp6(buf: []const u8, port: u16) IPv6ParseError!Address {
        return .{ .in6 = try Ip6Address.parse(buf, port) };
    }

    pub fn resolveIp6(buf: []const u8, port: u16) IPv6ParseError!Address {
        return .{ .in6 = try Ip6Address.resolve(buf, port) };
    }

    pub fn parseIp4(buf: []const u8, port: u16) IPv4ParseError!Address {
        return .{ .in = try Ip4Address.parse(buf, port) };
    }

    pub fn initIp4(addr: [4]u8, port: u16) Address {
        return .{ .in = Ip4Address.init(addr, port) };
    }

    pub fn initIp6(addr: [16]u8, port: u16, flowinfo: u32, scope_id: u32) Address {
        return .{ .in6 = Ip6Address.init(addr, port, flowinfo, scope_id) };
    }

    pub fn initUnix(path: []const u8) !Address {
        var sock_addr = posix.sockaddr.un{
            .family = posix.AF.UNIX,
            .path = undefined,
        };

        // Add 1 to ensure a terminating 0 is present in the path array for maximum portability.
        if (path.len + 1 > sock_addr.path.len) return error.NameTooLong;

        @memset(&sock_addr.path, 0);
        @memcpy(sock_addr.path[0..path.len], path);

        return .{ .un = sock_addr };
    }

    /// Returns the port in native endian.
    /// Asserts that the address is ip4 or ip6.
    pub fn getPort(self: Address) u16 {
        return switch (self.any.family) {
            posix.AF.INET => self.in.getPort(),
            posix.AF.INET6 => self.in6.getPort(),
            else => unreachable,
        };
    }

    /// `port` is native-endian.
    /// Asserts that the address is ip4 or ip6.
    pub fn setPort(self: *Address, port: u16) void {
        switch (self.any.family) {
            posix.AF.INET => self.in.setPort(port),
            posix.AF.INET6 => self.in6.setPort(port),
            else => unreachable,
        }
    }

    /// Asserts that `addr` is an IP address.
    /// This function will read past the end of the pointer, with a size depending
    /// on the address family.
    pub fn initPosix(addr: *align(4) const posix.sockaddr) Address {
        switch (addr.family) {
            posix.AF.INET => return Address{ .in = Ip4Address{ .sa = @as(*const posix.sockaddr.in, @ptrCast(addr)).* } },
            posix.AF.INET6 => return Address{ .in6 = Ip6Address{ .sa = @as(*const posix.sockaddr.in6, @ptrCast(addr)).* } },
            else => unreachable,
        }
    }

    pub fn format(self: Address, w: *Io.Writer) Io.Writer.Error!void {
        switch (self.any.family) {
            posix.AF.INET => try self.in.format(w),
            posix.AF.INET6 => try self.in6.format(w),
            posix.AF.UNIX => {
                if (!has_unix_sockets) unreachable;
                try w.writeAll(std.mem.sliceTo(&self.un.path, 0));
            },
            else => unreachable,
        }
    }

    pub fn eql(a: Address, b: Address) bool {
        const a_bytes = @as([*]const u8, @ptrCast(&a.any))[0..a.getOsSockLen()];
        const b_bytes = @as([*]const u8, @ptrCast(&b.any))[0..b.getOsSockLen()];
        return mem.eql(u8, a_bytes, b_bytes);
    }

    pub fn getOsSockLen(self: Address) posix.socklen_t {
        switch (self.any.family) {
            posix.AF.INET => return self.in.getOsSockLen(),
            posix.AF.INET6 => return self.in6.getOsSockLen(),
            posix.AF.UNIX => {
                if (!has_unix_sockets) {
                    unreachable;
                }

                // Using the full length of the structure here is more portable than returning
                // the number of bytes actually used by the currently stored path.
                // This also is correct regardless if we are passing a socket address to the kernel
                // (e.g. in bind, connect, sendto) since we ensure the path is 0 terminated in
                // initUnix() or if we are receiving a socket address from the kernel and must
                // provide the full buffer size (e.g. getsockname, getpeername, recvfrom, accept).
                //
                // To access the path, std.mem.sliceTo(&address.un.path, 0) should be used.
                return @as(posix.socklen_t, @intCast(@sizeOf(posix.sockaddr.un)));
            },

            else => unreachable,
        }
    }

    pub const ListenError = posix.SocketError || posix.BindError || posix.ListenError ||
        posix.SetSockOptError || posix.GetSockNameError;

    pub const ListenOptions = struct {
        /// How many connections the kernel will accept on the application's behalf.
        /// If more than this many connections pool in the kernel, clients will start
        /// seeing "Connection refused".
        kernel_backlog: u31 = 128,
        /// Sets SO_REUSEADDR and SO_REUSEPORT on POSIX.
        /// Sets SO_REUSEADDR on Windows, which is roughly equivalent.
        reuse_address: bool = false,
        /// Sets O_NONBLOCK.
        force_nonblocking: bool = false,
    };

};

pub const Ip4Address = extern struct {
    sa: posix.sockaddr.in,

    pub fn parse(buf: []const u8, port: u16) IPv4ParseError!Ip4Address {
        var result: Ip4Address = .{
            .sa = .{
                .port = mem.nativeToBig(u16, port),
                .addr = undefined,
            },
        };
        const out_ptr = mem.asBytes(&result.sa.addr);

        var x: u8 = 0;
        var index: u8 = 0;
        var saw_any_digits = false;
        var has_zero_prefix = false;
        for (buf) |c| {
            if (c == '.') {
                if (!saw_any_digits) {
                    return error.InvalidCharacter;
                }
                if (index == 3) {
                    return error.InvalidEnd;
                }
                out_ptr[index] = x;
                index += 1;
                x = 0;
                saw_any_digits = false;
                has_zero_prefix = false;
            } else if (c >= '0' and c <= '9') {
                if (c == '0' and !saw_any_digits) {
                    has_zero_prefix = true;
                } else if (has_zero_prefix) {
                    return error.NonCanonical;
                }
                saw_any_digits = true;
                x = try std.math.mul(u8, x, 10);
                x = try std.math.add(u8, x, c - '0');
            } else {
                return error.InvalidCharacter;
            }
        }
        if (index == 3 and saw_any_digits) {
            out_ptr[index] = x;
            return result;
        }

        return error.Incomplete;
    }

    pub fn resolveIp(name: []const u8, port: u16) !Ip4Address {
        if (parse(name, port)) |ip4| return ip4 else |err| switch (err) {
            error.Overflow,
            error.InvalidEnd,
            error.InvalidCharacter,
            error.Incomplete,
            error.NonCanonical,
            => {},
        }
        return error.InvalidIPAddressFormat;
    }

    pub fn init(addr: [4]u8, port: u16) Ip4Address {
        return Ip4Address{
            .sa = posix.sockaddr.in{
                .port = mem.nativeToBig(u16, port),
                .addr = @as(*align(1) const u32, @ptrCast(&addr)).*,
            },
        };
    }

    /// Returns the port in native endian.
    /// Asserts that the address is ip4 or ip6.
    pub fn getPort(self: Ip4Address) u16 {
        return mem.bigToNative(u16, self.sa.port);
    }

    /// `port` is native-endian.
    /// Asserts that the address is ip4 or ip6.
    pub fn setPort(self: *Ip4Address, port: u16) void {
        self.sa.port = mem.nativeToBig(u16, port);
    }

    pub fn format(self: Ip4Address, w: *Io.Writer) Io.Writer.Error!void {
        const bytes: *const [4]u8 = @ptrCast(&self.sa.addr);
        try w.print("{d}.{d}.{d}.{d}:{d}", .{ bytes[0], bytes[1], bytes[2], bytes[3], self.getPort() });
    }

    pub fn getOsSockLen(self: Ip4Address) posix.socklen_t {
        _ = self;
        return @sizeOf(posix.sockaddr.in);
    }
};

pub const Ip6Address = extern struct {
    sa: posix.sockaddr.in6,

    /// Parse a given IPv6 address string into an Address.
    /// Assumes the Scope ID of the address is fully numeric.
    /// For non-numeric addresses, see `resolveIp6`.
    pub fn parse(buf: []const u8, port: u16) IPv6ParseError!Ip6Address {
        var result = Ip6Address{
            .sa = posix.sockaddr.in6{
                .scope_id = 0,
                .port = mem.nativeToBig(u16, port),
                .flowinfo = 0,
                .addr = undefined,
            },
        };
        var ip_slice: *[16]u8 = result.sa.addr[0..];

        var tail: [16]u8 = undefined;

        var x: u16 = 0;
        var saw_any_digits = false;
        var index: u8 = 0;
        var scope_id = false;
        var abbrv = false;
        for (buf, 0..) |c, i| {
            if (scope_id) {
                if (c >= '0' and c <= '9') {
                    const digit = c - '0';
                    {
                        const ov = @mulWithOverflow(result.sa.scope_id, 10);
                        if (ov[1] != 0) return error.Overflow;
                        result.sa.scope_id = ov[0];
                    }
                    {
                        const ov = @addWithOverflow(result.sa.scope_id, digit);
                        if (ov[1] != 0) return error.Overflow;
                        result.sa.scope_id = ov[0];
                    }
                } else {
                    return error.InvalidCharacter;
                }
            } else if (c == ':') {
                if (!saw_any_digits) {
                    if (abbrv) return error.InvalidCharacter; // ':::'
                    if (i != 0) abbrv = true;
                    @memset(ip_slice[index..], 0);
                    ip_slice = tail[0..];
                    index = 0;
                    continue;
                }
                if (index == 14) {
                    return error.InvalidEnd;
                }
                ip_slice[index] = @as(u8, @truncate(x >> 8));
                index += 1;
                ip_slice[index] = @as(u8, @truncate(x));
                index += 1;

                x = 0;
                saw_any_digits = false;
            } else if (c == '%') {
                if (!saw_any_digits) {
                    return error.InvalidCharacter;
                }
                scope_id = true;
                saw_any_digits = false;
            } else if (c == '.') {
                if (!abbrv or ip_slice[0] != 0xff or ip_slice[1] != 0xff) {
                    // must start with '::ffff:'
                    return error.InvalidIpv4Mapping;
                }
                const start_index = mem.lastIndexOfScalar(u8, buf[0..i], ':').? + 1;
                const addr = (Ip4Address.parse(buf[start_index..], 0) catch {
                    return error.InvalidIpv4Mapping;
                }).sa.addr;
                ip_slice = result.sa.addr[0..];
                ip_slice[10] = 0xff;
                ip_slice[11] = 0xff;

                const ptr = mem.sliceAsBytes(@as(*const [1]u32, &addr)[0..]);

                ip_slice[12] = ptr[0];
                ip_slice[13] = ptr[1];
                ip_slice[14] = ptr[2];
                ip_slice[15] = ptr[3];
                return result;
            } else {
                const digit = try std.fmt.charToDigit(c, 16);
                {
                    const ov = @mulWithOverflow(x, 16);
                    if (ov[1] != 0) return error.Overflow;
                    x = ov[0];
                }
                {
                    const ov = @addWithOverflow(x, digit);
                    if (ov[1] != 0) return error.Overflow;
                    x = ov[0];
                }
                saw_any_digits = true;
            }
        }

        if (!saw_any_digits and !abbrv) {
            return error.Incomplete;
        }
        if (!abbrv and index < 14) {
            return error.Incomplete;
        }

        if (index == 14) {
            ip_slice[14] = @as(u8, @truncate(x >> 8));
            ip_slice[15] = @as(u8, @truncate(x));
            return result;
        } else {
            ip_slice[index] = @as(u8, @truncate(x >> 8));
            index += 1;
            ip_slice[index] = @as(u8, @truncate(x));
            index += 1;
            @memcpy(result.sa.addr[16 - index ..][0..index], ip_slice[0..index]);
            return result;
        }
    }

    pub fn resolve(buf: []const u8, port: u16) IPv6ParseError!Ip6Address {
        // TODO: Unify the implementations of resolveIp6 and parseIp6.
        var result = Ip6Address{
            .sa = posix.sockaddr.in6{
                .scope_id = 0,
                .port = mem.nativeToBig(u16, port),
                .flowinfo = 0,
                .addr = undefined,
            },
        };
        var ip_slice: *[16]u8 = result.sa.addr[0..];

        var tail: [16]u8 = undefined;

        var x: u16 = 0;
        var saw_any_digits = false;
        var index: u8 = 0;
        var abbrv = false;

        var scope_id = false;
        var scope_id_value: [posix.IFNAMESIZE - 1]u8 = undefined;
        var scope_id_index: usize = 0;

        for (buf, 0..) |c, i| {
            if (scope_id) {
                // Handling of percent-encoding should be for an URI library.
                if ((c >= '0' and c <= '9') or
                    (c >= 'A' and c <= 'Z') or
                    (c >= 'a' and c <= 'z') or
                    (c == '-') or (c == '.') or (c == '_') or (c == '~'))
                {
                    if (scope_id_index >= scope_id_value.len) {
                        return error.Overflow;
                    }

                    scope_id_value[scope_id_index] = c;
                    scope_id_index += 1;
                } else {
                    return error.InvalidCharacter;
                }
            } else if (c == ':') {
                if (!saw_any_digits) {
                    if (abbrv) return error.InvalidCharacter; // ':::'
                    if (i != 0) abbrv = true;
                    @memset(ip_slice[index..], 0);
                    ip_slice = tail[0..];
                    index = 0;
                    continue;
                }
                if (index == 14) {
                    return error.InvalidEnd;
                }
                ip_slice[index] = @as(u8, @truncate(x >> 8));
                index += 1;
                ip_slice[index] = @as(u8, @truncate(x));
                index += 1;

                x = 0;
                saw_any_digits = false;
            } else if (c == '%') {
                if (!saw_any_digits) {
                    return error.InvalidCharacter;
                }
                scope_id = true;
                saw_any_digits = false;
            } else if (c == '.') {
                if (!abbrv or ip_slice[0] != 0xff or ip_slice[1] != 0xff) {
                    // must start with '::ffff:'
                    return error.InvalidIpv4Mapping;
                }
                const start_index = mem.lastIndexOfScalar(u8, buf[0..i], ':').? + 1;
                const addr = (Ip4Address.parse(buf[start_index..], 0) catch {
                    return error.InvalidIpv4Mapping;
                }).sa.addr;
                ip_slice = result.sa.addr[0..];
                ip_slice[10] = 0xff;
                ip_slice[11] = 0xff;

                const ptr = mem.sliceAsBytes(@as(*const [1]u32, &addr)[0..]);

                ip_slice[12] = ptr[0];
                ip_slice[13] = ptr[1];
                ip_slice[14] = ptr[2];
                ip_slice[15] = ptr[3];
                return result;
            } else {
                const digit = try std.fmt.charToDigit(c, 16);
                {
                    const ov = @mulWithOverflow(x, 16);
                    if (ov[1] != 0) return error.Overflow;
                    x = ov[0];
                }
                {
                    const ov = @addWithOverflow(x, digit);
                    if (ov[1] != 0) return error.Overflow;
                    x = ov[0];
                }
                saw_any_digits = true;
            }
        }

        if (!saw_any_digits and !abbrv) {
            return error.Incomplete;
        }

        if (scope_id and scope_id_index == 0) {
            return error.Incomplete;
        }

        var resolved_scope_id: u32 = 0;
        if (scope_id_index > 0) {
            const scope_id_str = scope_id_value[0..scope_id_index];
            resolved_scope_id = std.fmt.parseInt(u32, scope_id_str, 10) catch |err| blk: {
                if (err != error.InvalidCharacter) return err;
                break :blk try if_nametoindex(scope_id_str);
            };
        }

        result.sa.scope_id = resolved_scope_id;

        if (index == 14) {
            ip_slice[14] = @as(u8, @truncate(x >> 8));
            ip_slice[15] = @as(u8, @truncate(x));
            return result;
        } else {
            ip_slice[index] = @as(u8, @truncate(x >> 8));
            index += 1;
            ip_slice[index] = @as(u8, @truncate(x));
            index += 1;
            @memcpy(result.sa.addr[16 - index ..][0..index], ip_slice[0..index]);
            return result;
        }
    }

    pub fn init(addr: [16]u8, port: u16, flowinfo: u32, scope_id: u32) Ip6Address {
        return Ip6Address{
            .sa = posix.sockaddr.in6{
                .addr = addr,
                .port = mem.nativeToBig(u16, port),
                .flowinfo = flowinfo,
                .scope_id = scope_id,
            },
        };
    }

    /// Returns the port in native endian.
    /// Asserts that the address is ip4 or ip6.
    pub fn getPort(self: Ip6Address) u16 {
        return mem.bigToNative(u16, self.sa.port);
    }

    /// `port` is native-endian.
    /// Asserts that the address is ip4 or ip6.
    pub fn setPort(self: *Ip6Address, port: u16) void {
        self.sa.port = mem.nativeToBig(u16, port);
    }

    pub fn format(self: Ip6Address, w: *Io.Writer) Io.Writer.Error!void {
        const port = mem.bigToNative(u16, self.sa.port);
        if (mem.eql(u8, self.sa.addr[0..12], &[_]u8{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff })) {
            try w.print("[::ffff:{d}.{d}.{d}.{d}]:{d}", .{
                self.sa.addr[12],
                self.sa.addr[13],
                self.sa.addr[14],
                self.sa.addr[15],
                port,
            });
            return;
        }
        const big_endian_parts = @as(*align(1) const [8]u16, @ptrCast(&self.sa.addr));
        const native_endian_parts = switch (native_endian) {
            .big => big_endian_parts.*,
            .little => blk: {
                var buf: [8]u16 = undefined;
                for (big_endian_parts, 0..) |part, i| {
                    buf[i] = mem.bigToNative(u16, part);
                }
                break :blk buf;
            },
        };

        // Find the longest zero run
        var longest_start: usize = 8;
        var longest_len: usize = 0;
        var current_start: usize = 0;
        var current_len: usize = 0;

        for (native_endian_parts, 0..) |part, i| {
            if (part == 0) {
                if (current_len == 0) {
                    current_start = i;
                }
                current_len += 1;
                if (current_len > longest_len) {
                    longest_start = current_start;
                    longest_len = current_len;
                }
            } else {
                current_len = 0;
            }
        }

        // Only compress if the longest zero run is 2 or more
        if (longest_len < 2) {
            longest_start = 8;
            longest_len = 0;
        }

        try w.writeAll("[");
        var i: usize = 0;
        var abbrv = false;
        while (i < native_endian_parts.len) : (i += 1) {
            if (i == longest_start) {
                // Emit "::" for the longest zero run
                if (!abbrv) {
                    try w.writeAll(if (i == 0) "::" else ":");
                    abbrv = true;
                }
                i += longest_len - 1; // Skip the compressed range
                continue;
            }
            if (abbrv) {
                abbrv = false;
            }
            try w.print("{x}", .{native_endian_parts[i]});
            if (i != native_endian_parts.len - 1) {
                try w.writeAll(":");
            }
        }
        try w.print("]:{}", .{port});
    }

    pub fn getOsSockLen(self: Ip6Address) posix.socklen_t {
        _ = self;
        return @sizeOf(posix.sockaddr.in6);
    }
};

pub const AddressList = struct {
    arena: std.heap.ArenaAllocator,
    addrs: []Address,
    canon_name: ?[]u8,

    pub fn deinit(self: *AddressList) void {
        // Here we copy the arena allocator into stack memory, because
        // otherwise it would destroy itself while it was still working.
        var arena = self.arena;
        arena.deinit();
        // self is destroyed
    }
};

pub fn tcpConnectToHost(allocator: Allocator, name: []const u8, port: u16) TcpConnectToHostError!Stream {
    const list = try getAddressList(allocator, name, port);
    defer list.deinit();

    if (list.addrs.len == 0) return error.UnknownHostName;

    for (list.addrs) |addr| {
        return tcpConnectToAddress(addr) catch |err| switch (err) {
            error.ConnectionRefused => {
                continue;
            },
            else => return err,
        };
    }
    return posix.ConnectError.ConnectionRefused;
}

pub fn tcpConnectToAddress(address: Address) TcpConnectToAddressError!Stream {
    const nonblock = 0;
    const sock_flags = posix.SOCK.STREAM | nonblock |
        (if (native_os == .windows) 0 else posix.SOCK.CLOEXEC);
    const sockfd = try posix.socket(address.any.family, sock_flags, posix.IPPROTO.TCP);
    errdefer Stream.close(.{ .handle = sockfd });

    try posix.connect(sockfd, &address.any, address.getOsSockLen());

    return Stream{ .handle = sockfd };
}

pub fn getAddressList(gpa: Allocator, name: []const u8, port: u16) GetAddressListError!*AddressList {
    const result = blk: {
        var arena = std.heap.ArenaAllocator.init(gpa);
        errdefer arena.deinit();

        const result = try arena.allocator().create(AddressList);
        result.* = AddressList{
            .arena = arena,
            .addrs = undefined,
            .canon_name = null,
        };
        break :blk result;
    };
    const arena = result.arena.allocator();
    errdefer result.deinit();

    if (native_os == .windows) {
        const name_c = try gpa.dupeZ(u8, name);
        defer gpa.free(name_c);

        const port_c = try std.fmt.allocPrintSentinel(gpa, "{d}", .{port}, 0);
        defer gpa.free(port_c);

        const ws2_32 = windows.ws2_32;
        const hints: posix.addrinfo = .{
            .flags = .{ .NUMERICSERV = true },
            .family = posix.AF.UNSPEC,
            .socktype = posix.SOCK.STREAM,
            .protocol = posix.IPPROTO.TCP,
            .canonname = null,
            .addr = null,
            .addrlen = 0,
            .next = null,
        };
        var res: ?*posix.addrinfo = null;
        var first = true;
        while (true) {
            const rc = ws2_32.getaddrinfo(name_c.ptr, port_c.ptr, &hints, &res);
            switch (@as(windows.ws2_32.WinsockError, @enumFromInt(@as(u16, @intCast(rc))))) {
                @as(windows.ws2_32.WinsockError, @enumFromInt(0)) => break,
                .WSATRY_AGAIN => return error.TemporaryNameServerFailure,
                .WSANO_RECOVERY => return error.NameServerFailure,
                .WSAEAFNOSUPPORT => return error.AddressFamilyNotSupported,
                .WSA_NOT_ENOUGH_MEMORY => return error.OutOfMemory,
                .WSAHOST_NOT_FOUND => return error.UnknownHostName,
                .WSATYPE_NOT_FOUND => return error.ServiceUnavailable,
                .WSAEINVAL => unreachable,
                .WSAESOCKTNOSUPPORT => unreachable,
                .WSANOTINITIALISED => {
                    if (!first) return error.Unexpected;
                    first = false;
                    try windows.callWSAStartup();
                    continue;
                },
                else => |err| return windows.unexpectedWSAError(err),
            }
        }
        defer ws2_32.freeaddrinfo(res);

        const addr_count = blk: {
            var count: usize = 0;
            var it = res;
            while (it) |info| : (it = info.next) {
                if (info.addr != null) {
                    count += 1;
                }
            }
            break :blk count;
        };
        result.addrs = try arena.alloc(Address, addr_count);

        var it = res;
        var i: usize = 0;
        while (it) |info| : (it = info.next) {
            const addr = info.addr orelse continue;
            result.addrs[i] = Address.initPosix(@alignCast(addr));

            if (info.canonname) |n| {
                if (result.canon_name == null) {
                    result.canon_name = try arena.dupe(u8, mem.sliceTo(n, 0));
                }
            }
            i += 1;
        }

        return result;
    }

    if (builtin.link_libc) {
        const name_c = try gpa.dupeZ(u8, name);
        defer gpa.free(name_c);

        const port_c = try std.fmt.allocPrintSentinel(gpa, "{d}", .{port}, 0);
        defer gpa.free(port_c);

        const hints: posix.addrinfo = .{
            .flags = .{ .NUMERICSERV = true },
            .family = posix.AF.UNSPEC,
            .socktype = posix.SOCK.STREAM,
            .protocol = posix.IPPROTO.TCP,
            .canonname = null,
            .addr = null,
            .addrlen = 0,
            .next = null,
        };
        var res: ?*posix.addrinfo = null;
        switch (posix.system.getaddrinfo(name_c.ptr, port_c.ptr, &hints, &res)) {
            @as(posix.system.EAI, @enumFromInt(0)) => {},
            .ADDRFAMILY => return error.HostLacksNetworkAddresses,
            .AGAIN => return error.TemporaryNameServerFailure,
            .BADFLAGS => unreachable, // Invalid hints
            .FAIL => return error.NameServerFailure,
            .FAMILY => return error.AddressFamilyNotSupported,
            .MEMORY => return error.OutOfMemory,
            .NODATA => return error.HostLacksNetworkAddresses,
            .NONAME => return error.UnknownHostName,
            .SERVICE => return error.ServiceUnavailable,
            .SOCKTYPE => unreachable, // Invalid socket type requested in hints
            .SYSTEM => switch (posix.errno(-1)) {
                else => |e| return posix.unexpectedErrno(e),
            },
            else => unreachable,
        }
        defer if (res) |some| posix.system.freeaddrinfo(some);

        const addr_count = blk: {
            var count: usize = 0;
            var it = res;
            while (it) |info| : (it = info.next) {
                if (info.addr != null) {
                    count += 1;
                }
            }
            break :blk count;
        };
        result.addrs = try arena.alloc(Address, addr_count);

        var it = res;
        var i: usize = 0;
        while (it) |info| : (it = info.next) {
            const addr = info.addr orelse continue;
            result.addrs[i] = Address.initPosix(@alignCast(addr));

            if (info.canonname) |n| {
                if (result.canon_name == null) {
                    result.canon_name = try arena.dupe(u8, mem.sliceTo(n, 0));
                }
            }
            i += 1;
        }

        return result;
    }

    // (0.15 linux non-libc resolver branch removed — netx requires libc,
    //  which every binary in this repo links; getaddrinfo path above is taken.)
    @compileError("std.net.getAddressList unimplemented for this OS");
}

pub const Stream = struct {
    /// Underlying platform-defined type which may or may not be
    /// interchangeable with a file system file descriptor.
    handle: Handle,

    pub const Handle = switch (native_os) {
        .windows => windows.ws2_32.SOCKET,
        else => posix.fd_t,
    };

    pub fn close(s: Stream) void {
        switch (native_os) {
            .windows => windows.closesocket(s.handle) catch unreachable,
            else => posix.close(s.handle),
        }
    }

    pub const ReadError = posix.ReadError || error{
        SocketNotBound,
        MessageTooBig,
        NetworkSubsystemFailed,
        ConnectionResetByPeer,
        SocketNotConnected,
    };

    pub const WriteError = posix.SendMsgError || error{
        ConnectionResetByPeer,
        SocketNotBound,
        MessageTooBig,
        NetworkSubsystemFailed,
        SystemResources,
        SocketNotConnected,
        Unexpected,
    };

    pub const Reader = switch (native_os) {
        .windows => struct {
            /// Use `interface` for portable code.
            interface_state: Io.Reader,
            /// Use `getStream` for portable code.
            net_stream: Stream,
            /// Use `getError` for portable code.
            error_state: ?Error,

            pub const Error = ReadError;

            pub fn getStream(r: *const Reader) Stream {
                return r.net_stream;
            }

            pub fn getError(r: *const Reader) ?Error {
                return r.error_state;
            }

            pub fn interface(r: *Reader) *Io.Reader {
                return &r.interface_state;
            }

            pub fn init(net_stream: Stream, buffer: []u8) Reader {
                return .{
                    .interface_state = .{
                        .vtable = &.{
                            .stream = stream,
                            .readVec = readVec,
                        },
                        .buffer = buffer,
                        .seek = 0,
                        .end = 0,
                    },
                    .net_stream = net_stream,
                    .error_state = null,
                };
            }

            fn stream(io_r: *Io.Reader, io_w: *Io.Writer, limit: Io.Limit) Io.Reader.StreamError!usize {
                const dest = limit.slice(try io_w.writableSliceGreedy(1));
                var bufs: [1][]u8 = .{dest};
                const n = try readVec(io_r, &bufs);
                io_w.advance(n);
                return n;
            }

            fn readVec(io_r: *std.Io.Reader, data: [][]u8) Io.Reader.Error!usize {
                const r: *Reader = @alignCast(@fieldParentPtr("interface_state", io_r));
                var iovecs: [max_buffers_len]windows.ws2_32.WSABUF = undefined;
                const bufs_n, const data_size = try io_r.writableVectorWsa(&iovecs, data);
                const bufs = iovecs[0..bufs_n];
                assert(bufs[0].len != 0);
                const n = streamBufs(r, bufs) catch |err| {
                    r.error_state = err;
                    return error.ReadFailed;
                };
                if (n == 0) return error.EndOfStream;
                if (n > data_size) {
                    io_r.end += n - data_size;
                    return data_size;
                }
                return n;
            }

            fn handleRecvError(winsock_error: windows.ws2_32.WinsockError) Error!void {
                switch (winsock_error) {
                    .WSAECONNRESET => return error.ConnectionResetByPeer,
                    .WSAEFAULT => unreachable, // a pointer is not completely contained in user address space.
                    .WSAEINPROGRESS, .WSAEINTR => unreachable, // deprecated and removed in WSA 2.2
                    .WSAEINVAL => return error.SocketNotBound,
                    .WSAEMSGSIZE => return error.MessageTooBig,
                    .WSAENETDOWN => return error.NetworkSubsystemFailed,
                    .WSAENETRESET => return error.ConnectionResetByPeer,
                    .WSAENOTCONN => return error.SocketNotConnected,
                    .WSAEWOULDBLOCK => return error.WouldBlock,
                    .WSANOTINITIALISED => unreachable, // WSAStartup must be called before this function
                    .WSA_IO_PENDING => unreachable,
                    .WSA_OPERATION_ABORTED => unreachable, // not using overlapped I/O
                    else => |err| return windows.unexpectedWSAError(err),
                }
            }

            fn streamBufs(r: *Reader, bufs: []windows.ws2_32.WSABUF) Error!u32 {
                var flags: u32 = 0;
                var overlapped: windows.OVERLAPPED = std.mem.zeroes(windows.OVERLAPPED);

                var n: u32 = undefined;
                if (windows.ws2_32.WSARecv(
                    r.net_stream.handle,
                    bufs.ptr,
                    @intCast(bufs.len),
                    &n,
                    &flags,
                    &overlapped,
                    null,
                ) == windows.ws2_32.SOCKET_ERROR) switch (windows.ws2_32.WSAGetLastError()) {
                    .WSA_IO_PENDING => {
                        var result_flags: u32 = undefined;
                        if (windows.ws2_32.WSAGetOverlappedResult(
                            r.net_stream.handle,
                            &overlapped,
                            &n,
                            windows.TRUE,
                            &result_flags,
                        ) == windows.FALSE) try handleRecvError(windows.ws2_32.WSAGetLastError());
                    },
                    else => |winsock_error| try handleRecvError(winsock_error),
                };

                return n;
            }
        },
        else => struct {
            /// Use `getStream`, `interface`, and `getError` for portable code.
            file_reader: File.Reader,

            pub const Error = ReadError;

            pub fn interface(r: *Reader) *Io.Reader {
                return &r.file_reader.interface;
            }

            pub fn init(net_stream: Stream, buffer: []u8) Reader {
                return .{
                    .file_reader = .{
                        .interface = File.Reader.initInterface(buffer),
                        .file = .{ .handle = net_stream.handle },
                        .mode = .streaming,
                        .seek_err = error.Unseekable,
                        .size_err = error.Streaming,
                    },
                };
            }

            pub fn getStream(r: *const Reader) Stream {
                return .{ .handle = r.file_reader.file.handle };
            }

            pub fn getError(r: *const Reader) ?Error {
                return r.file_reader.err;
            }
        },
    };

    pub const Writer = switch (native_os) {
        .windows => struct {
            /// This field is present on all systems.
            interface: Io.Writer,
            /// Use `getStream` for cross-platform support.
            stream: Stream,
            /// This field is present on all systems.
            err: ?Error = null,

            pub const Error = WriteError;

            pub fn init(stream: Stream, buffer: []u8) Writer {
                return .{
                    .stream = stream,
                    .interface = .{
                        .vtable = &.{ .drain = drain },
                        .buffer = buffer,
                    },
                };
            }

            pub fn getStream(w: *const Writer) Stream {
                return w.stream;
            }

            fn addWsaBuf(v: []windows.ws2_32.WSABUF, i: *u32, bytes: []const u8) void {
                const cap = std.math.maxInt(u32);
                var remaining = bytes;
                while (remaining.len > cap) {
                    if (v.len - i.* == 0) return;
                    v[i.*] = .{ .buf = @constCast(remaining.ptr), .len = cap };
                    i.* += 1;
                    remaining = remaining[cap..];
                } else {
                    @branchHint(.likely);
                    if (v.len - i.* == 0) return;
                    v[i.*] = .{ .buf = @constCast(remaining.ptr), .len = @intCast(remaining.len) };
                    i.* += 1;
                }
            }

            fn drain(io_w: *Io.Writer, data: []const []const u8, splat: usize) Io.Writer.Error!usize {
                const w: *Writer = @alignCast(@fieldParentPtr("interface", io_w));
                const buffered = io_w.buffered();
                comptime assert(native_os == .windows);
                var iovecs: [max_buffers_len]windows.ws2_32.WSABUF = undefined;
                var len: u32 = 0;
                addWsaBuf(&iovecs, &len, buffered);
                for (data[0 .. data.len - 1]) |bytes| addWsaBuf(&iovecs, &len, bytes);
                const pattern = data[data.len - 1];
                if (iovecs.len - len != 0) switch (splat) {
                    0 => {},
                    1 => addWsaBuf(&iovecs, &len, pattern),
                    else => switch (pattern.len) {
                        0 => {},
                        1 => {
                            const splat_buffer_candidate = io_w.buffer[io_w.end..];
                            var backup_buffer: [64]u8 = undefined;
                            const splat_buffer = if (splat_buffer_candidate.len >= backup_buffer.len)
                                splat_buffer_candidate
                            else
                                &backup_buffer;
                            const memset_len = @min(splat_buffer.len, splat);
                            const buf = splat_buffer[0..memset_len];
                            @memset(buf, pattern[0]);
                            addWsaBuf(&iovecs, &len, buf);
                            var remaining_splat = splat - buf.len;
                            while (remaining_splat > splat_buffer.len and len < iovecs.len) {
                                addWsaBuf(&iovecs, &len, splat_buffer);
                                remaining_splat -= splat_buffer.len;
                            }
                            addWsaBuf(&iovecs, &len, splat_buffer[0..remaining_splat]);
                        },
                        else => for (0..@min(splat, iovecs.len - len)) |_| {
                            addWsaBuf(&iovecs, &len, pattern);
                        },
                    },
                };
                const n = sendBufs(w.stream.handle, iovecs[0..len]) catch |err| {
                    w.err = err;
                    return error.WriteFailed;
                };
                return io_w.consume(n);
            }

            fn handleSendError(winsock_error: windows.ws2_32.WinsockError) Error!void {
                switch (winsock_error) {
                    .WSAECONNABORTED => return error.ConnectionResetByPeer,
                    .WSAECONNRESET => return error.ConnectionResetByPeer,
                    .WSAEFAULT => unreachable, // a pointer is not completely contained in user address space.
                    .WSAEINPROGRESS, .WSAEINTR => unreachable, // deprecated and removed in WSA 2.2
                    .WSAEINVAL => return error.SocketNotBound,
                    .WSAEMSGSIZE => return error.MessageTooBig,
                    .WSAENETDOWN => return error.NetworkSubsystemFailed,
                    .WSAENETRESET => return error.ConnectionResetByPeer,
                    .WSAENOBUFS => return error.SystemResources,
                    .WSAENOTCONN => return error.SocketNotConnected,
                    .WSAENOTSOCK => unreachable, // not a socket
                    .WSAEOPNOTSUPP => unreachable, // only for message-oriented sockets
                    .WSAESHUTDOWN => unreachable, // cannot send on a socket after write shutdown
                    .WSAEWOULDBLOCK => return error.WouldBlock,
                    .WSANOTINITIALISED => unreachable, // WSAStartup must be called before this function
                    .WSA_IO_PENDING => unreachable,
                    .WSA_OPERATION_ABORTED => unreachable, // not using overlapped I/O
                    else => |err| return windows.unexpectedWSAError(err),
                }
            }

            fn sendBufs(handle: Stream.Handle, bufs: []windows.ws2_32.WSABUF) Error!u32 {
                var n: u32 = undefined;
                var overlapped: windows.OVERLAPPED = std.mem.zeroes(windows.OVERLAPPED);
                if (windows.ws2_32.WSASend(
                    handle,
                    bufs.ptr,
                    @intCast(bufs.len),
                    &n,
                    0,
                    &overlapped,
                    null,
                ) == windows.ws2_32.SOCKET_ERROR) switch (windows.ws2_32.WSAGetLastError()) {
                    .WSA_IO_PENDING => {
                        var result_flags: u32 = undefined;
                        if (windows.ws2_32.WSAGetOverlappedResult(
                            handle,
                            &overlapped,
                            &n,
                            windows.TRUE,
                            &result_flags,
                        ) == windows.FALSE) try handleSendError(windows.ws2_32.WSAGetLastError());
                    },
                    else => |winsock_error| try handleSendError(winsock_error),
                };

                return n;
            }
        },
        else => struct {
            /// This field is present on all systems.
            interface: Io.Writer,

            err: ?Error = null,
            file_writer: File.Writer,

            pub const Error = WriteError;

            pub fn init(stream: Stream, buffer: []u8) Writer {
                return .{
                    .interface = .{
                        .vtable = &.{
                            .drain = drain,
                            .sendFile = sendFile,
                        },
                        .buffer = buffer,
                    },
                    .file_writer = .initStreaming(.{ .handle = stream.handle }, &.{}),
                };
            }

            pub fn getStream(w: *const Writer) Stream {
                return .{ .handle = w.file_writer.file.handle };
            }

            fn addBuf(v: []posix.iovec_const, i: *@FieldType(posix.msghdr_const, "iovlen"), bytes: []const u8) void {
                // OS checks ptr addr before length so zero length vectors must be omitted.
                if (bytes.len == 0) return;
                if (v.len - i.* == 0) return;
                v[i.*] = .{ .base = bytes.ptr, .len = bytes.len };
                i.* += 1;
            }

            fn drain(io_w: *Io.Writer, data: []const []const u8, splat: usize) Io.Writer.Error!usize {
                const w: *Writer = @alignCast(@fieldParentPtr("interface", io_w));
                const buffered = io_w.buffered();
                var iovecs: [max_buffers_len]posix.iovec_const = undefined;
                var msg: posix.msghdr_const = .{
                    .name = null,
                    .namelen = 0,
                    .iov = &iovecs,
                    .iovlen = 0,
                    .control = null,
                    .controllen = 0,
                    .flags = 0,
                };
                addBuf(&iovecs, &msg.iovlen, buffered);
                for (data[0 .. data.len - 1]) |bytes| addBuf(&iovecs, &msg.iovlen, bytes);
                const pattern = data[data.len - 1];
                if (iovecs.len - msg.iovlen != 0) switch (splat) {
                    0 => {},
                    1 => addBuf(&iovecs, &msg.iovlen, pattern),
                    else => switch (pattern.len) {
                        0 => {},
                        1 => {
                            const splat_buffer_candidate = io_w.buffer[io_w.end..];
                            var backup_buffer: [64]u8 = undefined;
                            const splat_buffer = if (splat_buffer_candidate.len >= backup_buffer.len)
                                splat_buffer_candidate
                            else
                                &backup_buffer;
                            const memset_len = @min(splat_buffer.len, splat);
                            const buf = splat_buffer[0..memset_len];
                            @memset(buf, pattern[0]);
                            addBuf(&iovecs, &msg.iovlen, buf);
                            var remaining_splat = splat - buf.len;
                            while (remaining_splat > splat_buffer.len and iovecs.len - msg.iovlen != 0) {
                                assert(buf.len == splat_buffer.len);
                                addBuf(&iovecs, &msg.iovlen, splat_buffer);
                                remaining_splat -= splat_buffer.len;
                            }
                            addBuf(&iovecs, &msg.iovlen, splat_buffer[0..remaining_splat]);
                        },
                        else => for (0..@min(splat, iovecs.len - msg.iovlen)) |_| {
                            addBuf(&iovecs, &msg.iovlen, pattern);
                        },
                    },
                };
                const flags = posix.MSG.NOSIGNAL;
                return io_w.consume(posix.sendmsg(w.file_writer.file.handle, &msg, flags) catch |err| {
                    w.err = err;
                    return error.WriteFailed;
                });
            }

            fn sendFile(io_w: *Io.Writer, file_reader: *File.Reader, limit: Io.Limit) Io.Writer.FileError!usize {
                const w: *Writer = @alignCast(@fieldParentPtr("interface", io_w));
                const n = try w.file_writer.interface.sendFileHeader(io_w.buffered(), file_reader, limit);
                return io_w.consume(n);
            }
        },
    };

    pub fn reader(stream: Stream, buffer: []u8) Reader {
        return .init(stream, buffer);
    }

    pub fn writer(stream: Stream, buffer: []u8) Writer {
        return .init(stream, buffer);
    }

    const max_buffers_len = 8;

    /// Deprecated in favor of `Reader`.
    pub fn read(self: Stream, buffer: []u8) ReadError!usize {
        if (native_os == .windows) {
            return windows.ReadFile(self.handle, buffer, null);
        }

        return posix.read(self.handle, buffer);
    }

    /// Deprecated in favor of `Reader`.
    pub fn readv(s: Stream, iovecs: []const posix.iovec) ReadError!usize {
        if (native_os == .windows) {
            if (iovecs.len == 0) return 0;
            const first = iovecs[0];
            return windows.ReadFile(s.handle, first.base[0..first.len], null);
        }

        return posix.readv(s.handle, iovecs);
    }

    /// Deprecated in favor of `Reader`.
    pub fn readAtLeast(s: Stream, buffer: []u8, len: usize) ReadError!usize {
        assert(len <= buffer.len);
        var index: usize = 0;
        while (index < len) {
            const amt = try s.read(buffer[index..]);
            if (amt == 0) break;
            index += amt;
        }
        return index;
    }

    /// Deprecated in favor of `Writer`.
    pub fn write(self: Stream, buffer: []const u8) WriteError!usize {
        var stream_writer = self.writer(&.{});
        return stream_writer.interface.writeVec(&.{buffer}) catch return stream_writer.err.?;
    }

    /// Deprecated in favor of `Writer`.
    pub fn writeAll(self: Stream, bytes: []const u8) WriteError!void {
        var index: usize = 0;
        while (index < bytes.len) {
            index += try self.write(bytes[index..]);
        }
    }

    /// Deprecated in favor of `Writer`.
    pub fn writev(self: Stream, iovecs: []const posix.iovec_const) WriteError!usize {
        return @errorCast(posix.writev(self.handle, iovecs));
    }

    /// Deprecated in favor of `Writer`.
    pub fn writevAll(self: Stream, iovecs: []posix.iovec_const) WriteError!void {
        if (iovecs.len == 0) return;

        var i: usize = 0;
        while (true) {
            var amt = try self.writev(iovecs[i..]);
            while (amt >= iovecs[i].len) {
                amt -= iovecs[i].len;
                i += 1;
                if (i >= iovecs.len) return;
            }
            iovecs[i].base += amt;
            iovecs[i].len -= amt;
        }
    }
};

fn if_nametoindex(name: []const u8) IPv6InterfaceError!u32 {
    if (native_os == .linux) {
        var ifr: posix.ifreq = undefined;
        const sockfd = try posix.socket(posix.AF.UNIX, posix.SOCK.DGRAM | posix.SOCK.CLOEXEC, 0);
        defer Stream.close(.{ .handle = sockfd });

        @memcpy(ifr.ifrn.name[0..name.len], name);
        ifr.ifrn.name[name.len] = 0;

        // TODO investigate if this needs to be integrated with evented I/O.
        try posix.ioctl_SIOCGIFINDEX(sockfd, &ifr);

        return @bitCast(ifr.ifru.ivalue);
    }

    if (native_os.isDarwin()) {
        if (name.len >= posix.IFNAMESIZE)
            return error.NameTooLong;

        var if_name: [posix.IFNAMESIZE:0]u8 = undefined;
        @memcpy(if_name[0..name.len], name);
        if_name[name.len] = 0;
        const if_slice = if_name[0..name.len :0];
        const index = std.c.if_nametoindex(if_slice);
        if (index == 0)
            return error.InterfaceNotFound;
        return @as(u32, @bitCast(index));
    }

    if (native_os == .windows) {
        if (name.len >= posix.IFNAMESIZE)
            return error.NameTooLong;

        var interface_name: [posix.IFNAMESIZE:0]u8 = undefined;
        @memcpy(interface_name[0..name.len], name);
        interface_name[name.len] = 0;
        const index = std.os.windows.ws2_32.if_nametoindex(@as([*:0]const u8, &interface_name));
        if (index == 0)
            return error.InterfaceNotFound;
        return index;
    }

    @compileError("std.net.if_nametoindex unimplemented for this OS");
}
