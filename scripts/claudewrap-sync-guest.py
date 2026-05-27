#!/usr/bin/env python3
"""VM-side workspace sync daemon for claudewrap.

Pairs with scripts/claudewrap-sync-host.py running on the host.

Wire protocol (length-prefixed binary frames over vsock):

  Each frame:
    4 bytes  network-order length L of header_line
    L bytes  ASCII header_line, newline-terminated, e.g.
             "SET /path/to/file 1234\n"
             "DEL /path/to/file\n"
             "DIR /path/to/dir\n"
             "INIT /workspace 1048576\n"
             "PING\n"
    M bytes  optional binary payload (size derived from header; 0 if none)

Operations
----------
INIT <dest> <size>   host → guest: initial workspace tarball, untar at dest
SET  <path> <size>   either direction: file content replacement
DEL  <path>          either direction: file deletion
DIR  <path>          either direction: directory creation (no payload)
PING / PONG          either direction: liveness; PONG echoes PING

The daemon connects to host vsock CID=2, port=5002, blocks until INIT lands,
then runs two pumps:

  - inotify thread: watches /workspace for writes/deletes/renames, ships SET/
    DEL frames to the host. An "ignore set" suppresses inotify echoes from
    frames we *just* applied locally.
  - socket reader: reads frames from the host, applies SET/DEL/DIR, marking
    each affected path in the ignore set briefly.

This script is staged at boot via the cred drive (/root/) rather than baked
into the rootfs, so we can iterate without rebuilding the image.
"""
from __future__ import annotations

import errno
import os
import socket
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

# vsock constants — Linux defines AF_VSOCK=40 but it's not in socket.py
# on older Pythons. CID 2 = host on firecracker.
AF_VSOCK = 40
HOST_CID = 2
SYNC_PORT = 5002

WORKSPACE = Path('/workspace')

# Paths we just wrote locally because the host told us to. Each entry has
# an expiry timestamp; the inotify handler clears expired entries and
# skips emit for matched paths. Sized so a burst of incoming writes
# can't flood the set.
_ignore_lock = threading.Lock()
_ignore: dict[str, float] = {}

def ignore_briefly(path: str, ttl: float = 1.0) -> None:
    with _ignore_lock:
        _ignore[path] = time.time() + ttl
        # Garbage-collect stale entries occasionally
        if len(_ignore) > 1024:
            now = time.time()
            for k in list(_ignore.keys()):
                if _ignore[k] < now:
                    del _ignore[k]

def is_ignored(path: str) -> bool:
    with _ignore_lock:
        exp = _ignore.get(path)
        if exp is None:
            return False
        if exp < time.time():
            del _ignore[path]
            return False
        return True


# ── Frame I/O ─────────────────────────────────────────────────────────

def read_exact(sock: socket.socket, n: int) -> bytes:
    """Read exactly n bytes from sock or raise ConnectionError."""
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError('short read')
        buf.extend(chunk)
    return bytes(buf)

def read_frame(sock: socket.socket) -> tuple[str, list[str], bytes]:
    """Return (op, args, payload). Header is ASCII line; payload size from header."""
    (hlen,) = struct.unpack('!I', read_exact(sock, 4))
    if hlen == 0 or hlen > 64 * 1024:
        raise ConnectionError(f'bad header length: {hlen}')
    header = read_exact(sock, hlen).decode('utf-8', 'replace').rstrip('\n')
    parts = header.split(' ')
    op = parts[0]
    args = parts[1:]
    # Some ops carry payload sized by the last arg; others don't.
    payload_size = 0
    if op in ('INIT', 'SET') and args:
        try:
            payload_size = int(args[-1])
        except ValueError:
            payload_size = 0
    payload = read_exact(sock, payload_size) if payload_size > 0 else b''
    return op, args, payload

_send_lock = threading.Lock()

def send_frame(sock: socket.socket, header: str, payload: bytes = b'') -> None:
    line = header
    if not line.endswith('\n'):
        line += '\n'
    data = line.encode('utf-8')
    with _send_lock:
        try:
            sock.sendall(struct.pack('!I', len(data)) + data + payload)
        except OSError:
            pass


# ── Workspace mutators ────────────────────────────────────────────────

def safe_path(rel: str) -> Path | None:
    """Resolve a /workspace-relative path; reject anything escaping the root."""
    p = (WORKSPACE / rel.lstrip('/')).resolve()
    try:
        p.relative_to(WORKSPACE.resolve())
    except ValueError:
        return None
    return p

def apply_set(rel: str, payload: bytes) -> None:
    p = safe_path(rel)
    if p is None:
        return
    p.parent.mkdir(parents=True, exist_ok=True)
    ignore_briefly(str(p))
    # Atomic-ish write: tmp + rename so a reader never sees a half-written file.
    tmp = p.with_suffix(p.suffix + '.cwsync-tmp')
    tmp.write_bytes(payload)
    os.replace(tmp, p)

def apply_del(rel: str) -> None:
    p = safe_path(rel)
    if p is None:
        return
    ignore_briefly(str(p))
    try:
        if p.is_dir() and not p.is_symlink():
            # Only delete if empty; otherwise the host's view diverges and
            # we want to know about it.
            try:
                p.rmdir()
            except OSError:
                pass
        else:
            p.unlink(missing_ok=True)
    except OSError:
        pass

def apply_dir(rel: str) -> None:
    p = safe_path(rel)
    if p is None:
        return
    ignore_briefly(str(p))
    p.mkdir(parents=True, exist_ok=True)

WORKSPACE_READY = Path('/run/workspace-ready')

def apply_init(dest_rel: str, payload: bytes) -> None:
    """Extract the initial workspace tar into /workspace, then write the
    /run/workspace-ready sentinel so claude-wrap unblocks and cd's in."""
    dest = WORKSPACE
    dest.mkdir(parents=True, exist_ok=True)
    # Stream the tar through `tar -xf -` for speed and POSIX-correct
    # extraction (handles permissions, symlinks, etc.). Using subprocess
    # rather than tarfile module because the latter is much slower on
    # large trees and we want this to be snappy at boot.
    proc = subprocess.Popen(
        ['tar', '-xf', '-', '-C', str(dest)],
        stdin=subprocess.PIPE,
    )
    rc = -1
    try:
        if proc.stdin:
            proc.stdin.write(payload)
            proc.stdin.close()
        rc = proc.wait(timeout=60)
    except Exception:
        try: proc.kill()
        except OSError: pass
    # Sentinel: claude-wrap polls this before exec'ing claude so the
    # session starts with /workspace fully populated, not mid-extraction.
    if rc == 0:
        try:
            WORKSPACE_READY.parent.mkdir(parents=True, exist_ok=True)
            WORKSPACE_READY.touch()
        except OSError as e:
            sys.stderr.write(f'[sync-guest] could not write sentinel: {e}\n')


# ── inotify watcher ───────────────────────────────────────────────────

def watch_workspace(sock: socket.socket) -> None:
    """Run pyinotify on /workspace, ship changes back to the host."""
    import pyinotify  # type: ignore

    mask = (
        pyinotify.IN_CLOSE_WRITE
        | pyinotify.IN_DELETE
        | pyinotify.IN_MOVED_FROM
        | pyinotify.IN_MOVED_TO
        | pyinotify.IN_CREATE
    )

    class Handler(pyinotify.ProcessEvent):
        def _emit_set(self, full: str) -> None:
            if is_ignored(full):
                return
            try:
                with open(full, 'rb') as f:
                    data = f.read()
            except OSError:
                return
            rel = '/' + str(Path(full).relative_to(WORKSPACE))
            send_frame(sock, f'SET {rel} {len(data)}', data)

        def _emit_del(self, full: str) -> None:
            if is_ignored(full):
                return
            try:
                rel = '/' + str(Path(full).relative_to(WORKSPACE))
            except ValueError:
                return
            send_frame(sock, f'DEL {rel}')

        def _emit_dir(self, full: str) -> None:
            if is_ignored(full):
                return
            try:
                rel = '/' + str(Path(full).relative_to(WORKSPACE))
            except ValueError:
                return
            send_frame(sock, f'DIR {rel}')

        def process_IN_CLOSE_WRITE(self, event):  # noqa: N802
            if not event.dir:
                self._emit_set(event.pathname)

        def process_IN_DELETE(self, event):  # noqa: N802
            self._emit_del(event.pathname)

        def process_IN_MOVED_FROM(self, event):  # noqa: N802
            self._emit_del(event.pathname)

        def process_IN_MOVED_TO(self, event):  # noqa: N802
            if event.dir:
                self._emit_dir(event.pathname)
            else:
                self._emit_set(event.pathname)

        def process_IN_CREATE(self, event):  # noqa: N802
            if event.dir:
                self._emit_dir(event.pathname)
            # File creates are picked up by the subsequent IN_CLOSE_WRITE
            # — emitting on bare create would ship empty content.

    wm = pyinotify.WatchManager()
    handler = Handler()
    notifier = pyinotify.Notifier(wm, handler)
    wm.add_watch(str(WORKSPACE), mask, rec=True, auto_add=True)
    notifier.loop()


# ── Main loop ─────────────────────────────────────────────────────────

def connect_with_retry(deadline_s: float = 30) -> socket.socket:
    """Loop on connect() until the host coordinator accepts or we time out.

    ECONNRESET (104) is included as retryable: when the guest dials a
    vsock port faster than the host has bound the UDS, firecracker
    returns RST to the guest rather than ECONNREFUSED. Treating it as
    fatal would kill the daemon on the first racey attempt.
    """
    retryable = {
        errno.ECONNREFUSED,
        errno.ECONNRESET,
        errno.ENODEV,
        errno.EHOSTUNREACH,
        errno.EAGAIN,
    }
    deadline = time.time() + deadline_s
    delay = 0.2
    while time.time() < deadline:
        try:
            s = socket.socket(AF_VSOCK, socket.SOCK_STREAM)
            s.connect((HOST_CID, SYNC_PORT))
            return s
        except OSError as e:
            if e.errno not in retryable:
                raise
            time.sleep(delay)
            delay = min(delay * 1.5, 2.0)
    raise TimeoutError('sync host did not accept within deadline')

def main() -> int:
    sys.stderr.write('[sync-guest] connecting to host vsock 2:5002\n')
    try:
        sock = connect_with_retry()
    except (OSError, TimeoutError) as e:
        sys.stderr.write(f'[sync-guest] connect failed: {e}; exiting\n')
        return 1
    sys.stderr.write('[sync-guest] connected\n')

    # First frame from host: INIT with the workspace tarball. We block on
    # this so the inotify watcher doesn't start firing on a half-populated
    # tree.
    try:
        op, args, payload = read_frame(sock)
    except (OSError, ConnectionError) as e:
        sys.stderr.write(f'[sync-guest] init read failed: {e}\n')
        return 1
    if op != 'INIT':
        sys.stderr.write(f'[sync-guest] expected INIT, got {op}; bailing\n')
        return 1
    dest = args[0] if args else '/workspace'
    sys.stderr.write(f'[sync-guest] applying initial workspace ({len(payload)} bytes)\n')
    apply_init(dest, payload)
    sys.stderr.write('[sync-guest] workspace ready\n')

    # Start the inotify thread now that the workspace is populated.
    t = threading.Thread(target=watch_workspace, args=(sock,), daemon=True)
    t.start()

    # Main thread: read frames from the host and apply them.
    while True:
        try:
            op, args, payload = read_frame(sock)
        except (OSError, ConnectionError):
            sys.stderr.write('[sync-guest] host disconnected; exiting\n')
            return 0
        try:
            if op == 'SET' and len(args) >= 2:
                apply_set(args[0], payload)
            elif op == 'DEL' and args:
                apply_del(args[0])
            elif op == 'DIR' and args:
                apply_dir(args[0])
            elif op == 'PING':
                send_frame(sock, 'PONG')
            # else: unknown op, ignore
        except Exception as e:
            sys.stderr.write(f'[sync-guest] apply error op={op}: {e}\n')

if __name__ == '__main__':
    sys.exit(main())
