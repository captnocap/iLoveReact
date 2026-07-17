//! sysx: the 12 syscall wrappers Zig 0.16 deleted from std.posix, lifted
//! verbatim from Zig 0.15.2's lib/std/posix.zig so the hand-rolled
//! nonblocking socket layer (net/, pty_remote, dev_ipc, render_surfaces_vm,
//! v8_bindings_cli) keeps byte-identical error discrimination
//! (error.WouldBlock et al). Door (b) of docs/ZIG_016_MIGRATION.md §6:
//! this layer stays on raw readiness-loop syscalls by ruling — do NOT
//! migrate it onto std.Io.net; revisit only if async Io earns it.
//!
//! Bodies are unmodified 0.15.2 std source (MIT); only this header and the
//! alias block below are ours. Surviving std.posix symbols (types,
//! constants, poll/read/recv-side helpers) are re-exported by alias so call
//! sites can uniformly reference sysx.*.
const std = @import("std");
const builtin = @import("builtin");
const posix = std.posix;
const windows = std.os.windows;
const wasi = std.os.wasi;
const native_os = builtin.os.tag;
const system = posix.system;
const mem = std.mem;
const math = std.math;
const maxInt = std.math.maxInt;
const assert = std.debug.assert;
const unexpectedErrno = posix.unexpectedErrno;
pub const UnexpectedError = posix.UnexpectedError;
pub const E = posix.E;
pub const fd_t = posix.fd_t;
pub const socket_t = posix.socket_t;
pub const socklen_t = posix.socklen_t;
pub const sockaddr = posix.sockaddr;
pub const pollfd = posix.pollfd;
pub const AF = posix.AF;
pub const SOCK = posix.SOCK;
pub const SOL = posix.SOL;
pub const SO = posix.SO;
pub const POLL = posix.POLL;
pub const IPPROTO = posix.IPPROTO;
pub const TCP = posix.TCP;
pub const F = posix.F;
pub const PATH_MAX = posix.PATH_MAX;
pub const iovec_const = posix.iovec_const;
pub const FD_CLOEXEC = posix.FD_CLOEXEC;
pub const O = posix.O;
pub const AT = posix.AT;
pub const pid_t = posix.pid_t;
pub const termios = posix.termios;
pub const Sigaction = posix.Sigaction;
pub const SIG = posix.SIG;
pub const V = posix.V;
// surviving 0.16 functions, re-exported so exempt files reference sysx.* uniformly
pub const poll = posix.poll;
pub const read = posix.read;
pub const kill = posix.kill;
pub const raise = posix.raise;
pub const setsockopt = posix.setsockopt;
pub const sigaction = posix.sigaction;
pub const sigemptyset = posix.sigemptyset;
pub const tcgetattr = posix.tcgetattr;
pub const tcsetattr = posix.tcsetattr;

/// 0.16 deleted std.posix.getenv; libc is always linked here.
pub fn getenv(name: []const u8) ?[]const u8 {
    var it: usize = 0;
    while (std.c.environ[it]) |entry_ptr| : (it += 1) {
        const entry = std.mem.span(entry_ptr);
        const eq = std.mem.indexOfScalar(u8, entry, '=') orelse continue;
        if (std.mem.eql(u8, entry[0..eq], name)) return entry[eq + 1 ..];
    }
    return null;
}
const use_libc = builtin.link_libc or switch (native_os) {
    .windows, .wasi => true,
    else => false,
};

// ---- everything below this line is lifted 0.15.2 std.posix source ----
pub const SocketError = error{
    /// Permission to create a socket of the specified type and/or
    /// pro‐tocol is denied.
    AccessDenied,

    /// The implementation does not support the specified address family.
    AddressFamilyNotSupported,

    /// Unknown protocol, or protocol family not available.
    ProtocolFamilyNotAvailable,

    /// The per-process limit on the number of open file descriptors has been reached.
    ProcessFdQuotaExceeded,

    /// The system-wide limit on the total number of open files has been reached.
    SystemFdQuotaExceeded,

    /// Insufficient memory is available. The socket cannot be created until sufficient
    /// resources are freed.
    SystemResources,

    /// The protocol type or the specified protocol is not supported within this domain.
    ProtocolNotSupported,

    /// The socket type is not supported by the protocol.
    SocketTypeNotSupported,
} || UnexpectedError;

pub fn socket(domain: u32, socket_type: u32, protocol: u32) SocketError!socket_t {
    if (native_os == .windows) {
        // These flags are not actually part of the Windows API, instead they are converted here for compatibility
        const filtered_sock_type = socket_type & ~@as(u32, SOCK.NONBLOCK | SOCK.CLOEXEC);
        var flags: u32 = windows.ws2_32.WSA_FLAG_OVERLAPPED;
        if ((socket_type & SOCK.CLOEXEC) != 0) flags |= windows.ws2_32.WSA_FLAG_NO_HANDLE_INHERIT;

        const rc = try windows.WSASocketW(
            @bitCast(domain),
            @bitCast(filtered_sock_type),
            @bitCast(protocol),
            null,
            0,
            flags,
        );
        errdefer windows.closesocket(rc) catch unreachable;
        if ((socket_type & SOCK.NONBLOCK) != 0) {
            var mode: c_ulong = 1; // nonblocking
            if (windows.ws2_32.SOCKET_ERROR == windows.ws2_32.ioctlsocket(rc, windows.ws2_32.FIONBIO, &mode)) {
                switch (windows.ws2_32.WSAGetLastError()) {
                    // have not identified any error codes that should be handled yet
                    else => unreachable,
                }
            }
        }
        return rc;
    }

    const have_sock_flags = !builtin.target.os.tag.isDarwin() and native_os != .haiku;
    const filtered_sock_type = if (!have_sock_flags)
        socket_type & ~@as(u32, SOCK.NONBLOCK | SOCK.CLOEXEC)
    else
        socket_type;
    const rc = system.socket(domain, filtered_sock_type, protocol);
    switch (errno(rc)) {
        .SUCCESS => {
            const fd: fd_t = @intCast(rc);
            errdefer close(fd);
            if (!have_sock_flags) {
                try setSockFlags(fd, socket_type);
            }
            return fd;
        },
        .ACCES => return error.AccessDenied,
        .AFNOSUPPORT => return error.AddressFamilyNotSupported,
        .INVAL => return error.ProtocolFamilyNotAvailable,
        .MFILE => return error.ProcessFdQuotaExceeded,
        .NFILE => return error.SystemFdQuotaExceeded,
        .NOBUFS => return error.SystemResources,
        .NOMEM => return error.SystemResources,
        .PROTONOSUPPORT => return error.ProtocolNotSupported,
        .PROTOTYPE => return error.SocketTypeNotSupported,
        else => |err| return unexpectedErrno(err),
    }
}

pub const BindError = error{
    /// The address is protected, and the user is not the superuser.
    /// For UNIX domain sockets: Search permission is denied on  a  component
    /// of  the  path  prefix.
    AccessDenied,

    /// The given address is already in use, or in the case of Internet domain sockets,
    /// The  port number was specified as zero in the socket
    /// address structure, but, upon attempting to bind to  an  ephemeral  port,  it  was
    /// determined  that  all  port  numbers in the ephemeral port range are currently in
    /// use.  See the discussion of /proc/sys/net/ipv4/ip_local_port_range ip(7).
    AddressInUse,

    /// A nonexistent interface was requested or the requested address was not local.
    AddressNotAvailable,

    /// The address is not valid for the address family of socket.
    AddressFamilyNotSupported,

    /// Too many symbolic links were encountered in resolving addr.
    SymLinkLoop,

    /// addr is too long.
    NameTooLong,

    /// A component in the directory prefix of the socket pathname does not exist.
    FileNotFound,

    /// Insufficient kernel memory was available.
    SystemResources,

    /// A component of the path prefix is not a directory.
    NotDir,

    /// The socket inode would reside on a read-only filesystem.
    ReadOnlyFileSystem,

    /// The network subsystem has failed.
    NetworkSubsystemFailed,

    FileDescriptorNotASocket,

    AlreadyBound,
} || UnexpectedError;

pub fn bind(sock: socket_t, addr: *const sockaddr, len: socklen_t) BindError!void {
    if (native_os == .windows) {
        const rc = windows.bind(sock, addr, len);
        if (rc == windows.ws2_32.SOCKET_ERROR) {
            switch (windows.ws2_32.WSAGetLastError()) {
                .WSANOTINITIALISED => unreachable, // not initialized WSA
                .WSAEACCES => return error.AccessDenied,
                .WSAEADDRINUSE => return error.AddressInUse,
                .WSAEADDRNOTAVAIL => return error.AddressNotAvailable,
                .WSAENOTSOCK => return error.FileDescriptorNotASocket,
                .WSAEFAULT => unreachable, // invalid pointers
                .WSAEINVAL => return error.AlreadyBound,
                .WSAENOBUFS => return error.SystemResources,
                .WSAENETDOWN => return error.NetworkSubsystemFailed,
                else => |err| return windows.unexpectedWSAError(err),
            }
            unreachable;
        }
        return;
    } else {
        const rc = system.bind(sock, addr, len);
        switch (errno(rc)) {
            .SUCCESS => return,
            .ACCES, .PERM => return error.AccessDenied,
            .ADDRINUSE => return error.AddressInUse,
            .BADF => unreachable, // always a race condition if this error is returned
            .INVAL => unreachable, // invalid parameters
            .NOTSOCK => unreachable, // invalid `sockfd`
            .AFNOSUPPORT => return error.AddressFamilyNotSupported,
            .ADDRNOTAVAIL => return error.AddressNotAvailable,
            .FAULT => unreachable, // invalid `addr` pointer
            .LOOP => return error.SymLinkLoop,
            .NAMETOOLONG => return error.NameTooLong,
            .NOENT => return error.FileNotFound,
            .NOMEM => return error.SystemResources,
            .NOTDIR => return error.NotDir,
            .ROFS => return error.ReadOnlyFileSystem,
            else => |err| return unexpectedErrno(err),
        }
    }
    unreachable;
}

pub const ConnectError = error{
    /// For UNIX domain sockets, which are identified by pathname: Write permission is denied on  the  socket
    /// file,  or  search  permission  is  denied  for  one of the directories in the path prefix.
    /// or
    /// The user tried to connect to a broadcast address without having the socket broadcast flag enabled  or
    /// the connection request failed because of a local firewall rule.
    AccessDenied,

    /// See AccessDenied
    PermissionDenied,

    /// Local address is already in use.
    AddressInUse,

    /// (Internet  domain  sockets)  The  socket  referred  to  by sockfd had not previously been bound to an
    /// address and, upon attempting to bind it to an ephemeral port, it was determined that all port numbers
    /// in    the    ephemeral    port    range    are   currently   in   use.    See   the   discussion   of
    /// /proc/sys/net/ipv4/ip_local_port_range in ip(7).
    AddressNotAvailable,

    /// The passed address didn't have the correct address family in its sa_family field.
    AddressFamilyNotSupported,

    /// Insufficient entries in the routing cache.
    SystemResources,

    /// A connect() on a stream socket found no one listening on the remote address.
    ConnectionRefused,

    /// Network is unreachable.
    NetworkUnreachable,

    /// Timeout  while  attempting  connection.   The server may be too busy to accept new connections.  Note
    /// that for IP sockets the timeout may be very long when syncookies are enabled on the server.
    ConnectionTimedOut,

    /// This error occurs when no global event loop is configured,
    /// and connecting to the socket would block.
    WouldBlock,

    /// The given path for the unix socket does not exist.
    FileNotFound,

    /// Connection was reset by peer before connect could complete.
    ConnectionResetByPeer,

    /// Socket is non-blocking and already has a pending connection in progress.
    ConnectionPending,
} || UnexpectedError;

pub fn connect(sock: socket_t, sock_addr: *const sockaddr, len: socklen_t) ConnectError!void {
    if (native_os == .windows) {
        const rc = windows.ws2_32.connect(sock, sock_addr, @intCast(len));
        if (rc == 0) return;
        switch (windows.ws2_32.WSAGetLastError()) {
            .WSAEADDRINUSE => return error.AddressInUse,
            .WSAEADDRNOTAVAIL => return error.AddressNotAvailable,
            .WSAECONNREFUSED => return error.ConnectionRefused,
            .WSAECONNRESET => return error.ConnectionResetByPeer,
            .WSAETIMEDOUT => return error.ConnectionTimedOut,
            .WSAEHOSTUNREACH, // TODO: should we return NetworkUnreachable in this case as well?
            .WSAENETUNREACH,
            => return error.NetworkUnreachable,
            .WSAEFAULT => unreachable,
            .WSAEINVAL => unreachable,
            .WSAEISCONN => unreachable,
            .WSAENOTSOCK => unreachable,
            .WSAEWOULDBLOCK => return error.WouldBlock,
            .WSAEACCES => unreachable,
            .WSAENOBUFS => return error.SystemResources,
            .WSAEAFNOSUPPORT => return error.AddressFamilyNotSupported,
            else => |err| return windows.unexpectedWSAError(err),
        }
        return;
    }

    while (true) {
        switch (errno(system.connect(sock, sock_addr, len))) {
            .SUCCESS => return,
            .ACCES => return error.AccessDenied,
            .PERM => return error.PermissionDenied,
            .ADDRINUSE => return error.AddressInUse,
            .ADDRNOTAVAIL => return error.AddressNotAvailable,
            .AFNOSUPPORT => return error.AddressFamilyNotSupported,
            .AGAIN, .INPROGRESS => return error.WouldBlock,
            .ALREADY => return error.ConnectionPending,
            .BADF => unreachable, // sockfd is not a valid open file descriptor.
            .CONNREFUSED => return error.ConnectionRefused,
            .CONNRESET => return error.ConnectionResetByPeer,
            .FAULT => unreachable, // The socket structure address is outside the user's address space.
            .INTR => continue,
            .ISCONN => unreachable, // The socket is already connected.
            .HOSTUNREACH => return error.NetworkUnreachable,
            .NETUNREACH => return error.NetworkUnreachable,
            .NOTSOCK => unreachable, // The file descriptor sockfd does not refer to a socket.
            .PROTOTYPE => unreachable, // The socket type does not support the requested communications protocol.
            .TIMEDOUT => return error.ConnectionTimedOut,
            .NOENT => return error.FileNotFound, // Returned when socket is AF.UNIX and the given path does not exist.
            .CONNABORTED => unreachable, // Tried to reuse socket that previously received error.ConnectionRefused.
            else => |err| return unexpectedErrno(err),
        }
    }
}

pub const AcceptError = error{
    ConnectionAborted,

    /// The file descriptor sockfd does not refer to a socket.
    FileDescriptorNotASocket,

    /// The per-process limit on the number of open file descriptors has been reached.
    ProcessFdQuotaExceeded,

    /// The system-wide limit on the total number of open files has been reached.
    SystemFdQuotaExceeded,

    /// Not enough free memory.  This often means that the memory allocation  is  limited
    /// by the socket buffer limits, not by the system memory.
    SystemResources,

    /// Socket is not listening for new connections.
    SocketNotListening,

    ProtocolFailure,

    /// Firewall rules forbid connection.
    BlockedByFirewall,

    /// This error occurs when no global event loop is configured,
    /// and accepting from the socket would block.
    WouldBlock,

    /// An incoming connection was indicated, but was subsequently terminated by the
    /// remote peer prior to accepting the call.
    ConnectionResetByPeer,

    /// The network subsystem has failed.
    NetworkSubsystemFailed,

    /// The referenced socket is not a type that supports connection-oriented service.
    OperationNotSupported,
} || UnexpectedError;

pub fn accept(
    /// This argument is a socket that has been created with `socket`, bound to a local address
    /// with `bind`, and is listening for connections after a `listen`.
    sock: socket_t,
    /// This argument is a pointer to a sockaddr structure.  This structure is filled in with  the
    /// address  of  the  peer  socket, as known to the communications layer.  The exact format of the
    /// address returned addr is determined by the socket's address  family  (see  `socket`  and  the
    /// respective  protocol  man  pages).
    addr: ?*sockaddr,
    /// This argument is a value-result argument: the caller must initialize it to contain  the
    /// size (in bytes) of the structure pointed to by addr; on return it will contain the actual size
    /// of the peer address.
    ///
    /// The returned address is truncated if the buffer provided is too small; in this  case,  `addr_size`
    /// will return a value greater than was supplied to the call.
    addr_size: ?*socklen_t,
    /// The following values can be bitwise ORed in flags to obtain different behavior:
    /// * `SOCK.NONBLOCK` - Set the `NONBLOCK` file status flag on the open file description (see `open`)
    ///   referred  to by the new file descriptor.  Using this flag saves extra calls to `fcntl` to achieve
    ///   the same result.
    /// * `SOCK.CLOEXEC`  - Set the close-on-exec (`FD_CLOEXEC`) flag on the new file descriptor.   See  the
    ///   description  of the `CLOEXEC` flag in `open` for reasons why this may be useful.
    flags: u32,
) AcceptError!socket_t {
    const have_accept4 = !(builtin.target.os.tag.isDarwin() or native_os == .windows or native_os == .haiku);
    assert(0 == (flags & ~@as(u32, SOCK.NONBLOCK | SOCK.CLOEXEC))); // Unsupported flag(s)

    const accepted_sock: socket_t = while (true) {
        const rc = if (have_accept4)
            system.accept4(sock, addr, addr_size, flags)
        else if (native_os == .windows)
            windows.accept(sock, addr, addr_size)
        else
            system.accept(sock, addr, addr_size);

        if (native_os == .windows) {
            if (rc == windows.ws2_32.INVALID_SOCKET) {
                switch (windows.ws2_32.WSAGetLastError()) {
                    .WSANOTINITIALISED => unreachable, // not initialized WSA
                    .WSAECONNRESET => return error.ConnectionResetByPeer,
                    .WSAEFAULT => unreachable,
                    .WSAENOTSOCK => return error.FileDescriptorNotASocket,
                    .WSAEINVAL => return error.SocketNotListening,
                    .WSAEMFILE => return error.ProcessFdQuotaExceeded,
                    .WSAENETDOWN => return error.NetworkSubsystemFailed,
                    .WSAENOBUFS => return error.FileDescriptorNotASocket,
                    .WSAEOPNOTSUPP => return error.OperationNotSupported,
                    .WSAEWOULDBLOCK => return error.WouldBlock,
                    else => |err| return windows.unexpectedWSAError(err),
                }
            } else {
                break rc;
            }
        } else {
            switch (errno(rc)) {
                .SUCCESS => break @intCast(rc),
                .INTR => continue,
                .AGAIN => return error.WouldBlock,
                .BADF => unreachable, // always a race condition
                .CONNABORTED => return error.ConnectionAborted,
                .FAULT => unreachable,
                .INVAL => return error.SocketNotListening,
                .NOTSOCK => unreachable,
                .MFILE => return error.ProcessFdQuotaExceeded,
                .NFILE => return error.SystemFdQuotaExceeded,
                .NOBUFS => return error.SystemResources,
                .NOMEM => return error.SystemResources,
                .OPNOTSUPP => unreachable,
                .PROTO => return error.ProtocolFailure,
                .PERM => return error.BlockedByFirewall,
                else => |err| return unexpectedErrno(err),
            }
        }
    };

    errdefer switch (native_os) {
        .windows => windows.closesocket(accepted_sock) catch unreachable,
        else => close(accepted_sock),
    };
    if (!have_accept4) {
        try setSockFlags(accepted_sock, flags);
    }
    return accepted_sock;
}

pub const ListenError = error{
    /// Another socket is already listening on the same port.
    /// For Internet domain sockets, the  socket referred to by sockfd had not previously
    /// been bound to an address and, upon attempting to bind it to an ephemeral port, it
    /// was determined that all port numbers in the ephemeral port range are currently in
    /// use.  See the discussion of /proc/sys/net/ipv4/ip_local_port_range in ip(7).
    AddressInUse,

    /// The file descriptor sockfd does not refer to a socket.
    FileDescriptorNotASocket,

    /// The socket is not of a type that supports the listen() operation.
    OperationNotSupported,

    /// The network subsystem has failed.
    NetworkSubsystemFailed,

    /// Ran out of system resources
    /// On Windows it can either run out of socket descriptors or buffer space
    SystemResources,

    /// Already connected
    AlreadyConnected,

    /// Socket has not been bound yet
    SocketNotBound,
} || UnexpectedError;

pub fn listen(sock: socket_t, backlog: u31) ListenError!void {
    if (native_os == .windows) {
        const rc = windows.listen(sock, backlog);
        if (rc == windows.ws2_32.SOCKET_ERROR) {
            switch (windows.ws2_32.WSAGetLastError()) {
                .WSANOTINITIALISED => unreachable, // not initialized WSA
                .WSAENETDOWN => return error.NetworkSubsystemFailed,
                .WSAEADDRINUSE => return error.AddressInUse,
                .WSAEISCONN => return error.AlreadyConnected,
                .WSAEINVAL => return error.SocketNotBound,
                .WSAEMFILE, .WSAENOBUFS => return error.SystemResources,
                .WSAENOTSOCK => return error.FileDescriptorNotASocket,
                .WSAEOPNOTSUPP => return error.OperationNotSupported,
                .WSAEINPROGRESS => unreachable,
                else => |err| return windows.unexpectedWSAError(err),
            }
        }
        return;
    } else {
        const rc = system.listen(sock, backlog);
        switch (errno(rc)) {
            .SUCCESS => return,
            .ADDRINUSE => return error.AddressInUse,
            .BADF => unreachable,
            .NOTSOCK => return error.FileDescriptorNotASocket,
            .OPNOTSUPP => return error.OperationNotSupported,
            else => |err| return unexpectedErrno(err),
        }
    }
}

pub const SendError = error{
    /// (For UNIX domain sockets, which are identified by pathname) Write permission is  denied
    /// on  the destination socket file, or search permission is denied for one of the
    /// directories the path prefix.  (See path_resolution(7).)
    /// (For UDP sockets) An attempt was made to send to a network/broadcast address as  though
    /// it was a unicast address.
    AccessDenied,

    /// The socket is marked nonblocking and the requested operation would block, and
    /// there is no global event loop configured.
    /// It's also possible to get this error under the following condition:
    /// (Internet  domain datagram sockets) The socket referred to by sockfd had not previously
    /// been bound to an address and, upon attempting to bind it to an ephemeral port,  it  was
    /// determined that all port numbers in the ephemeral port range are currently in use.  See
    /// the discussion of /proc/sys/net/ipv4/ip_local_port_range in ip(7).
    WouldBlock,

    /// Another Fast Open is already in progress.
    FastOpenAlreadyInProgress,

    /// Connection reset by peer.
    ConnectionResetByPeer,

    /// The  socket  type requires that message be sent atomically, and the size of the message
    /// to be sent made this impossible. The message is not transmitted.
    MessageTooBig,

    /// The output queue for a network interface was full.  This generally indicates  that  the
    /// interface  has  stopped sending, but may be caused by transient congestion.  (Normally,
    /// this does not occur in Linux.  Packets are just silently dropped when  a  device  queue
    /// overflows.)
    /// This is also caused when there is not enough kernel memory available.
    SystemResources,

    /// The  local  end  has been shut down on a connection oriented socket.  In this case, the
    /// process will also receive a SIGPIPE unless MSG.NOSIGNAL is set.
    BrokenPipe,

    FileDescriptorNotASocket,

    /// Network is unreachable.
    NetworkUnreachable,

    /// The local network interface used to reach the destination is down.
    NetworkSubsystemFailed,

    /// The destination address is not listening.
    ConnectionRefused,
} || UnexpectedError;

pub fn send(
    /// The file descriptor of the sending socket.
    sockfd: socket_t,
    buf: []const u8,
    flags: u32,
) SendError!usize {
    return sendto(sockfd, buf, flags, null, 0) catch |err| switch (err) {
        error.AddressFamilyNotSupported => unreachable,
        error.SymLinkLoop => unreachable,
        error.NameTooLong => unreachable,
        error.FileNotFound => unreachable,
        error.NotDir => unreachable,
        error.NetworkUnreachable => unreachable,
        error.AddressNotAvailable => unreachable,
        error.SocketNotConnected => unreachable,
        error.UnreachableAddress => unreachable,
        else => |e| return e,
    };
}

pub const RecvFromError = error{
    /// The socket is marked nonblocking and the requested operation would block, and
    /// there is no global event loop configured.
    WouldBlock,

    /// A remote host refused to allow the network connection, typically because it is not
    /// running the requested service.
    ConnectionRefused,

    /// Could not allocate kernel memory.
    SystemResources,

    ConnectionResetByPeer,
    ConnectionTimedOut,

    /// The socket has not been bound.
    SocketNotBound,

    /// The UDP message was too big for the buffer and part of it has been discarded
    MessageTooBig,

    /// The network subsystem has failed.
    NetworkSubsystemFailed,

    /// The socket is not connected (connection-oriented sockets only).
    SocketNotConnected,
} || UnexpectedError;

pub fn recv(sock: socket_t, buf: []u8, flags: u32) RecvFromError!usize {
    return recvfrom(sock, buf, flags, null, null);
}

pub const WriteError = error{
    DiskQuota,
    FileTooBig,
    InputOutput,
    NoSpaceLeft,
    DeviceBusy,
    InvalidArgument,

    /// File descriptor does not hold the required rights to write to it.
    AccessDenied,
    PermissionDenied,
    BrokenPipe,
    SystemResources,
    OperationAborted,
    NotOpenForWriting,

    /// The process cannot access the file because another process has locked
    /// a portion of the file. Windows-only.
    LockViolation,

    /// This error occurs when no global event loop is configured,
    /// and reading from the file descriptor would block.
    WouldBlock,

    /// Connection reset by peer.
    ConnectionResetByPeer,

    /// This error occurs in Linux if the process being written to
    /// no longer exists.
    ProcessNotFound,
    /// This error occurs when a device gets disconnected before or mid-flush
    /// while it's being written to - errno(6): No such device or address.
    NoDevice,

    /// The socket type requires that message be sent atomically, and the size of the message
    /// to be sent made this impossible. The message is not transmitted.
    MessageTooBig,
} || UnexpectedError;

pub fn write(fd: fd_t, bytes: []const u8) WriteError!usize {
    if (bytes.len == 0) return 0;
    if (native_os == .windows) {
        return windows.WriteFile(fd, bytes, null);
    }

    if (native_os == .wasi and !builtin.link_libc) {
        const ciovs = [_]iovec_const{iovec_const{
            .base = bytes.ptr,
            .len = bytes.len,
        }};
        var nwritten: usize = undefined;
        switch (wasi.fd_write(fd, &ciovs, ciovs.len, &nwritten)) {
            .SUCCESS => return nwritten,
            .INTR => unreachable,
            .INVAL => unreachable,
            .FAULT => unreachable,
            .AGAIN => unreachable,
            .BADF => return error.NotOpenForWriting, // can be a race condition.
            .DESTADDRREQ => unreachable, // `connect` was never called.
            .DQUOT => return error.DiskQuota,
            .FBIG => return error.FileTooBig,
            .IO => return error.InputOutput,
            .NOSPC => return error.NoSpaceLeft,
            .PERM => return error.PermissionDenied,
            .PIPE => return error.BrokenPipe,
            .NOTCAPABLE => return error.AccessDenied,
            else => |err| return unexpectedErrno(err),
        }
    }

    const max_count = switch (native_os) {
        .linux => 0x7ffff000,
        .macos, .ios, .watchos, .tvos, .visionos => maxInt(i32),
        else => maxInt(isize),
    };
    while (true) {
        const rc = system.write(fd, bytes.ptr, @min(bytes.len, max_count));
        switch (errno(rc)) {
            .SUCCESS => return @intCast(rc),
            .INTR => continue,
            .INVAL => return error.InvalidArgument,
            .FAULT => unreachable,
            .SRCH => return error.ProcessNotFound,
            .AGAIN => return error.WouldBlock,
            .BADF => return error.NotOpenForWriting, // can be a race condition.
            .DESTADDRREQ => unreachable, // `connect` was never called.
            .DQUOT => return error.DiskQuota,
            .FBIG => return error.FileTooBig,
            .IO => return error.InputOutput,
            .NOSPC => return error.NoSpaceLeft,
            .ACCES => return error.AccessDenied,
            .PERM => return error.PermissionDenied,
            .PIPE => return error.BrokenPipe,
            .CONNRESET => return error.ConnectionResetByPeer,
            .BUSY => return error.DeviceBusy,
            .NXIO => return error.NoDevice,
            .MSGSIZE => return error.MessageTooBig,
            else => |err| return unexpectedErrno(err),
        }
    }
}

pub fn close(fd: fd_t) void {
    if (native_os == .windows) {
        return windows.CloseHandle(fd);
    }
    if (native_os == .wasi and !builtin.link_libc) {
        _ = std.os.wasi.fd_close(fd);
        return;
    }
    switch (errno(system.close(fd))) {
        .BADF => unreachable, // Always a race condition.
        .INTR => return, // This is still a success. See https://github.com/ziglang/zig/issues/2425
        else => return,
    }
}

pub const FcntlError = error{
    PermissionDenied,
    FileBusy,
    ProcessFdQuotaExceeded,
    Locked,
    DeadLock,
    LockedRegionLimitExceeded,
} || UnexpectedError;

pub fn fcntl(fd: fd_t, cmd: i32, arg: usize) FcntlError!usize {
    while (true) {
        const rc = system.fcntl(fd, cmd, arg);
        switch (errno(rc)) {
            .SUCCESS => return @intCast(rc),
            .INTR => continue,
            .AGAIN, .ACCES => return error.Locked,
            .BADF => unreachable,
            .BUSY => return error.FileBusy,
            .INVAL => unreachable, // invalid parameters
            .PERM => return error.PermissionDenied,
            .MFILE => return error.ProcessFdQuotaExceeded,
            .NOTDIR => unreachable, // invalid parameter
            .DEADLK => return error.DeadLock,
            .NOLCK => return error.LockedRegionLimitExceeded,
            else => |err| return unexpectedErrno(err),
        }
    }
}

pub const GetSockNameError = error{
    /// Insufficient resources were available in the system to perform the operation.
    SystemResources,

    /// The network subsystem has failed.
    NetworkSubsystemFailed,

    /// Socket hasn't been bound yet
    SocketNotBound,

    FileDescriptorNotASocket,
} || UnexpectedError;

pub fn getsockname(sock: socket_t, addr: *sockaddr, addrlen: *socklen_t) GetSockNameError!void {
    if (native_os == .windows) {
        const rc = windows.getsockname(sock, addr, addrlen);
        if (rc == windows.ws2_32.SOCKET_ERROR) {
            switch (windows.ws2_32.WSAGetLastError()) {
                .WSANOTINITIALISED => unreachable,
                .WSAENETDOWN => return error.NetworkSubsystemFailed,
                .WSAEFAULT => unreachable, // addr or addrlen have invalid pointers or addrlen points to an incorrect value
                .WSAENOTSOCK => return error.FileDescriptorNotASocket,
                .WSAEINVAL => return error.SocketNotBound,
                else => |err| return windows.unexpectedWSAError(err),
            }
        }
        return;
    } else {
        const rc = system.getsockname(sock, addr, addrlen);
        switch (errno(rc)) {
            .SUCCESS => return,
            else => |err| return unexpectedErrno(err),

            .BADF => unreachable, // always a race condition
            .FAULT => unreachable,
            .INVAL => unreachable, // invalid parameters
            .NOTSOCK => return error.FileDescriptorNotASocket,
            .NOBUFS => return error.SystemResources,
        }
    }
}

pub const UnlinkError = error{
    FileNotFound,

    /// In WASI, this error may occur when the file descriptor does
    /// not hold the required rights to unlink a resource by path relative to it.
    AccessDenied,
    PermissionDenied,
    FileBusy,
    FileSystem,
    IsDir,
    SymLinkLoop,
    NameTooLong,
    NotDir,
    SystemResources,
    ReadOnlyFileSystem,

    /// WASI-only; file paths must be valid UTF-8.
    InvalidUtf8,

    /// Windows-only; file paths provided by the user must be valid WTF-8.
    /// https://simonsapin.github.io/wtf-8/
    InvalidWtf8,

    /// On Windows, file paths cannot contain these characters:
    /// '/', '*', '?', '"', '<', '>', '|'
    BadPathName,

    /// On Windows, `\\server` or `\\server\share` was not found.
    NetworkNotFound,
} || UnexpectedError;

pub fn unlink(file_path: []const u8) UnlinkError!void {
    const file_path_c = try toPosixPath(file_path);
    return unlinkZ(&file_path_c);
}

pub fn errno(rc: anytype) E {
    if (use_libc) {
        return if (rc == -1) @enumFromInt(std.c._errno().*) else .SUCCESS;
    }
    const signed: isize = @bitCast(rc);
    const int = if (signed > -4096 and signed < 0) -signed else 0;
    return @enumFromInt(int);
}

pub fn unlinkZ(file_path: [*:0]const u8) UnlinkError!void {
    switch (errno(system.unlink(file_path))) {
        .SUCCESS => return,
        .ACCES => return error.AccessDenied,
        .PERM => return error.PermissionDenied,
        .BUSY => return error.FileBusy,
        .FAULT => unreachable,
        .INVAL => unreachable,
        .IO => return error.FileSystem,
        .ISDIR => return error.IsDir,
        .LOOP => return error.SymLinkLoop,
        .NAMETOOLONG => return error.NameTooLong,
        .NOENT => return error.FileNotFound,
        .NOTDIR => return error.NotDir,
        .NOMEM => return error.SystemResources,
        .ROFS => return error.ReadOnlyFileSystem,
        .ILSEQ => |err| if (native_os == .wasi)
            return error.InvalidUtf8
        else
            return unexpectedErrno(err),
        else => |err| return unexpectedErrno(err),
    }
}

pub fn toPosixPath(file_path: []const u8) error{NameTooLong}![PATH_MAX - 1:0]u8 {
    if (std.debug.runtime_safety) assert(mem.indexOfScalar(u8, file_path, 0) == null);
    var path_with_null: [PATH_MAX - 1:0]u8 = undefined;
    // >= rather than > to make room for the null byte
    if (file_path.len >= PATH_MAX) return error.NameTooLong;
    @memcpy(path_with_null[0..file_path.len], file_path);
    path_with_null[file_path.len] = 0;
    return path_with_null;
}


fn setSockFlags(sock: socket_t, flags: u32) !void {
    if ((flags & SOCK.CLOEXEC) != 0) {
        if (native_os == .windows) {
            // TODO: Find out if this is supported for sockets
        } else {
            var fd_flags = fcntl(sock, F.GETFD, 0) catch |err| switch (err) {
                error.FileBusy => unreachable,
                error.Locked => unreachable,
                error.PermissionDenied => unreachable,
                error.DeadLock => unreachable,
                error.LockedRegionLimitExceeded => unreachable,
                else => |e| return e,
            };
            fd_flags |= FD_CLOEXEC;
            _ = fcntl(sock, F.SETFD, fd_flags) catch |err| switch (err) {
                error.FileBusy => unreachable,
                error.Locked => unreachable,
                error.PermissionDenied => unreachable,
                error.DeadLock => unreachable,
                error.LockedRegionLimitExceeded => unreachable,
                else => |e| return e,
            };
        }
    }
    if ((flags & SOCK.NONBLOCK) != 0) {
        if (native_os == .windows) {
            var mode: c_ulong = 1;
            if (windows.ws2_32.ioctlsocket(sock, windows.ws2_32.FIONBIO, &mode) == windows.ws2_32.SOCKET_ERROR) {
                switch (windows.ws2_32.WSAGetLastError()) {
                    .WSANOTINITIALISED => unreachable,
                    .WSAENETDOWN => return error.NetworkSubsystemFailed,
                    .WSAENOTSOCK => return error.FileDescriptorNotASocket,
                    // TODO: handle more errors
                    else => |err| return windows.unexpectedWSAError(err),
                }
            }
        } else {
            var fl_flags = fcntl(sock, F.GETFL, 0) catch |err| switch (err) {
                error.FileBusy => unreachable,
                error.Locked => unreachable,
                error.PermissionDenied => unreachable,
                error.DeadLock => unreachable,
                error.LockedRegionLimitExceeded => unreachable,
                else => |e| return e,
            };
            fl_flags |= 1 << @bitOffsetOf(O, "NONBLOCK");
            _ = fcntl(sock, F.SETFL, fl_flags) catch |err| switch (err) {
                error.FileBusy => unreachable,
                error.Locked => unreachable,
                error.PermissionDenied => unreachable,
                error.DeadLock => unreachable,
                error.LockedRegionLimitExceeded => unreachable,
                else => |e| return e,
            };
        }
    }
}

pub const SendToError = SendMsgError || error{
    /// The destination address is not reachable by the bound address.
    UnreachableAddress,
    /// The destination address is not listening.
    ConnectionRefused,
};

pub fn sendto(
    /// The file descriptor of the sending socket.
    sockfd: socket_t,
    /// Message to send.
    buf: []const u8,
    flags: u32,
    dest_addr: ?*const sockaddr,
    addrlen: socklen_t,
) SendToError!usize {
    if (native_os == .windows) {
        switch (windows.sendto(sockfd, buf.ptr, buf.len, flags, dest_addr, addrlen)) {
            windows.ws2_32.SOCKET_ERROR => switch (windows.ws2_32.WSAGetLastError()) {
                .WSAEACCES => return error.AccessDenied,
                .WSAEADDRNOTAVAIL => return error.AddressNotAvailable,
                .WSAECONNRESET => return error.ConnectionResetByPeer,
                .WSAEMSGSIZE => return error.MessageTooBig,
                .WSAENOBUFS => return error.SystemResources,
                .WSAENOTSOCK => return error.FileDescriptorNotASocket,
                .WSAEAFNOSUPPORT => return error.AddressFamilyNotSupported,
                .WSAEDESTADDRREQ => unreachable, // A destination address is required.
                .WSAEFAULT => unreachable, // The lpBuffers, lpTo, lpOverlapped, lpNumberOfBytesSent, or lpCompletionRoutine parameters are not part of the user address space, or the lpTo parameter is too small.
                .WSAEHOSTUNREACH => return error.NetworkUnreachable,
                // TODO: WSAEINPROGRESS, WSAEINTR
                .WSAEINVAL => unreachable,
                .WSAENETDOWN => return error.NetworkSubsystemFailed,
                .WSAENETRESET => return error.ConnectionResetByPeer,
                .WSAENETUNREACH => return error.NetworkUnreachable,
                .WSAENOTCONN => return error.SocketNotConnected,
                .WSAESHUTDOWN => unreachable, // The socket has been shut down; it is not possible to WSASendTo on a socket after shutdown has been invoked with how set to SD_SEND or SD_BOTH.
                .WSAEWOULDBLOCK => return error.WouldBlock,
                .WSANOTINITIALISED => unreachable, // A successful WSAStartup call must occur before using this function.
                else => |err| return windows.unexpectedWSAError(err),
            },
            else => |rc| return @intCast(rc),
        }
    }
    while (true) {
        const rc = system.sendto(sockfd, buf.ptr, buf.len, flags, dest_addr, addrlen);
        switch (errno(rc)) {
            .SUCCESS => return @intCast(rc),

            .ACCES => return error.AccessDenied,
            .AGAIN => return error.WouldBlock,
            .ALREADY => return error.FastOpenAlreadyInProgress,
            .BADF => unreachable, // always a race condition
            .CONNREFUSED => return error.ConnectionRefused,
            .CONNRESET => return error.ConnectionResetByPeer,
            .DESTADDRREQ => unreachable, // The socket is not connection-mode, and no peer address is set.
            .FAULT => unreachable, // An invalid user space address was specified for an argument.
            .INTR => continue,
            .INVAL => return error.UnreachableAddress,
            .ISCONN => unreachable, // connection-mode socket was connected already but a recipient was specified
            .MSGSIZE => return error.MessageTooBig,
            .NOBUFS => return error.SystemResources,
            .NOMEM => return error.SystemResources,
            .NOTSOCK => unreachable, // The file descriptor sockfd does not refer to a socket.
            .OPNOTSUPP => unreachable, // Some bit in the flags argument is inappropriate for the socket type.
            .PIPE => return error.BrokenPipe,
            .AFNOSUPPORT => return error.AddressFamilyNotSupported,
            .LOOP => return error.SymLinkLoop,
            .NAMETOOLONG => return error.NameTooLong,
            .NOENT => return error.FileNotFound,
            .NOTDIR => return error.NotDir,
            .HOSTUNREACH => return error.NetworkUnreachable,
            .NETUNREACH => return error.NetworkUnreachable,
            .NOTCONN => return error.SocketNotConnected,
            .NETDOWN => return error.NetworkSubsystemFailed,
            else => |err| return unexpectedErrno(err),
        }
    }
}

pub fn recvfrom(
    sockfd: socket_t,
    buf: []u8,
    flags: u32,
    src_addr: ?*sockaddr,
    addrlen: ?*socklen_t,
) RecvFromError!usize {
    while (true) {
        const rc = system.recvfrom(sockfd, buf.ptr, buf.len, flags, src_addr, addrlen);
        if (native_os == .windows) {
            if (rc == windows.ws2_32.SOCKET_ERROR) {
                switch (windows.ws2_32.WSAGetLastError()) {
                    .WSANOTINITIALISED => unreachable,
                    .WSAECONNRESET => return error.ConnectionResetByPeer,
                    .WSAEINVAL => return error.SocketNotBound,
                    .WSAEMSGSIZE => return error.MessageTooBig,
                    .WSAENETDOWN => return error.NetworkSubsystemFailed,
                    .WSAENOTCONN => return error.SocketNotConnected,
                    .WSAEWOULDBLOCK => return error.WouldBlock,
                    .WSAETIMEDOUT => return error.ConnectionTimedOut,
                    // TODO: handle more errors
                    else => |err| return windows.unexpectedWSAError(err),
                }
            } else {
                return @intCast(rc);
            }
        } else {
            switch (errno(rc)) {
                .SUCCESS => return @intCast(rc),
                .BADF => unreachable, // always a race condition
                .FAULT => unreachable,
                .INVAL => unreachable,
                .NOTCONN => return error.SocketNotConnected,
                .NOTSOCK => unreachable,
                .INTR => continue,
                .AGAIN => return error.WouldBlock,
                .NOMEM => return error.SystemResources,
                .CONNREFUSED => return error.ConnectionRefused,
                .CONNRESET => return error.ConnectionResetByPeer,
                .TIMEDOUT => return error.ConnectionTimedOut,
                else => |err| return unexpectedErrno(err),
            }
        }
    }
}


pub const SendMsgError = SendError || error{
    /// The passed address didn't have the correct address family in its sa_family field.
    AddressFamilyNotSupported,

    /// Returned when socket is AF.UNIX and the given path has a symlink loop.
    SymLinkLoop,

    /// Returned when socket is AF.UNIX and the given path length exceeds `max_path_bytes` bytes.
    NameTooLong,

    /// Returned when socket is AF.UNIX and the given path does not point to an existing file.
    FileNotFound,
    NotDir,

    /// The socket is not connected (connection-oriented sockets only).
    SocketNotConnected,
    AddressNotAvailable,
};
