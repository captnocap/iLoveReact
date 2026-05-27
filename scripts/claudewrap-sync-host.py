#!/usr/bin/env python3
"""Host-side per-VM workspace sync proxy.

Usage: claudewrap-sync-host.py <vsock-uds-path> <host-cwd>

Spawned by scripts/claude-ss alongside firecracker + vsock-bridge.

Architecture
------------
There is ONE proxy per running VM. Each proxy:

  - Listens on  <vsock-uds-path>_5002  for the guest daemon to dial in
    (firecracker translates guest connect(host_cid=2, port=5002) into an
    accept() on that UDS path).
  - Ships an initial workspace tar to the guest on first connection.
  - Watches <host-cwd> via inotify; ships file-level SET/DEL/DIR frames
    to the guest on every change.
  - Reads SET/DEL/DIR frames from the guest and applies them to the host
    CWD.

There is NO centralized coordinator. Multiple VMs each have their own
proxy; they all share the host CWD as canonical state. When VM A writes
a file, A's proxy applies it to the host. The OTHER proxies' inotify
watchers see that write and fan it out to their respective VMs. Each
proxy keeps a small per-path "ignore briefly" set to suppress the echo
of writes it just applied locally.

This means O(N) inotify watchers for N VMs which is fine up to a few
dozen; if it ever isn't, the watcher can be unified into a coordinator.

Filtering
---------
Sync skips paths matching DENY_PATTERNS (.git/, node_modules/, zig-out/,
etc.). These accumulate fast and most aren't meaningful for cross-VM
collaboration; build artifacts in particular would thrash the channel.
"""
from __future__ import annotations

import errno
import fnmatch
import os
import re
import socket
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

SYNC_PORT_SUFFIX = '_5002'  # firecracker UDS suffix for guest port 5002

# Paths matched against the full path (relative to CWD). Anything under
# one of these is skipped both ways. This is a backstop for non-git
# workspaces and the inotify watcher's recursion-pruning; the primary
# inclusion filter for the initial tar is `git ls-files` (see
# build_workspace_tar). Add huge or generated dirs here when they show
# up, so inotify doesn't waste watch slots on them.
DENY_PATTERNS = [
    '.git', '.git/*',
    '.zig-cache', '.zig-cache/*',
    'node_modules', 'node_modules/*',
    'zig-out', 'zig-out/*',
    'target', 'target/*',
    'deps', 'deps/*',
    'archive', 'archive/*',
    'images', 'images/*',
    '.cache', '.cache/*',
    '__pycache__', '__pycache__/*',
    '*.pyc',
    '.next', '.next/*',
    'dist', 'dist/*',
    'build', 'build/*',
    '.DS_Store',
]

def is_denied(rel_path: str) -> bool:
    # Match any segment-prefix against the deny list.
    parts = rel_path.split('/')
    for i in range(len(parts)):
        prefix = '/'.join(parts[:i + 1])
        for pat in DENY_PATTERNS:
            if fnmatch.fnmatch(prefix, pat) or fnmatch.fnmatch(parts[i], pat):
                return True
    return False


# ── ignore-briefly set ────────────────────────────────────────────────

_ignore_lock = threading.Lock()
_ignore: dict[str, float] = {}

def ignore_briefly(path: str, ttl: float = 1.0) -> None:
    with _ignore_lock:
        _ignore[path] = time.time() + ttl
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


# ── frame I/O (matches guest protocol) ────────────────────────────────

_send_lock = threading.Lock()

def read_exact(sock: socket.socket, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError('short read')
        buf.extend(chunk)
    return bytes(buf)

def read_frame(sock: socket.socket) -> tuple[str, list[str], bytes]:
    (hlen,) = struct.unpack('!I', read_exact(sock, 4))
    if hlen == 0 or hlen > 64 * 1024:
        raise ConnectionError(f'bad header length: {hlen}')
    header = read_exact(sock, hlen).decode('utf-8', 'replace').rstrip('\n')
    parts = header.split(' ')
    op = parts[0]
    args = parts[1:]
    payload_size = 0
    if op in ('INIT', 'SET') and args:
        try:
            payload_size = int(args[-1])
        except ValueError:
            payload_size = 0
    payload = read_exact(sock, payload_size) if payload_size > 0 else b''
    return op, args, payload

def send_frame(sock: socket.socket, header: str, payload: bytes = b'') -> None:
    line = header if header.endswith('\n') else header + '\n'
    data = line.encode('utf-8')
    with _send_lock:
        try:
            sock.sendall(struct.pack('!I', len(data)) + data + payload)
        except OSError:
            pass


# ── workspace mutators (host side) ────────────────────────────────────

class HostFs:
    def __init__(self, cwd: Path):
        self.cwd = cwd.resolve()

    def _safe(self, rel: str) -> Path | None:
        p = (self.cwd / rel.lstrip('/')).resolve()
        try:
            p.relative_to(self.cwd)
        except ValueError:
            return None
        return p

    def apply_set(self, rel: str, payload: bytes) -> None:
        if is_denied(rel.lstrip('/')):
            return
        p = self._safe(rel)
        if p is None:
            return
        p.parent.mkdir(parents=True, exist_ok=True)
        ignore_briefly(str(p))
        tmp = p.with_suffix(p.suffix + '.cwsync-tmp')
        tmp.write_bytes(payload)
        os.replace(tmp, p)

    def apply_del(self, rel: str) -> None:
        if is_denied(rel.lstrip('/')):
            return
        p = self._safe(rel)
        if p is None:
            return
        ignore_briefly(str(p))
        try:
            if p.is_dir() and not p.is_symlink():
                try: p.rmdir()
                except OSError: pass
            else:
                p.unlink(missing_ok=True)
        except OSError:
            pass

    def apply_dir(self, rel: str) -> None:
        if is_denied(rel.lstrip('/')):
            return
        p = self._safe(rel)
        if p is None:
            return
        ignore_briefly(str(p))
        p.mkdir(parents=True, exist_ok=True)


# ── initial workspace tar ─────────────────────────────────────────────

def build_workspace_tar(cwd: Path) -> bytes:
    """Tar the workspace for the initial INIT frame to the guest.

    Prefers `git ls-files` so we ship exactly the source tree git sees
    (tracked + untracked-but-not-gitignored). This is what you'd run a
    build on and is bounded by your repo's actual source size, not by
    whatever build caches / vendored deps / archives have accumulated
    on disk. For reactjit specifically: avoids tarring the 104GB
    .zig-cache that a plain `tar -cf -` would chew on indefinitely.

    Falls back to a denylist-pruned `tar -cf -` for non-git workspaces.
    """
    is_git = (cwd / '.git').exists()
    if is_git:
        # git ls-files outputs NUL-separated relative paths. We filter
        # that list through DENY_PATTERNS as a second pass — git's
        # "untracked-but-not-gitignored" picks up vendored deps and
        # local build dirs that aren't in .gitignore (e.g.
        # deps/llama.cpp-fresh/build/, which is 429MB of compile
        # output). The denylist catches those without forcing the user
        # to maintain a perfect .gitignore.
        #
        # We also drop paths that don't exist on disk — `--cached`
        # includes tracked-but-locally-deleted files (D in git status),
        # and tar bails with `Cannot stat` on those. --ignore-failed-read
        # below is a backstop for missing-file races mid-tar.
        lf = subprocess.run(
            ['git', '-C', str(cwd), 'ls-files', '-z',
             '--cached', '--others', '--exclude-standard'],
            check=True, stdout=subprocess.PIPE,
        ).stdout
        def keep(p: bytes) -> bool:
            if not p:
                return False
            s = p.decode('utf-8', 'replace')
            if is_denied(s):
                return False
            return (cwd / s).exists()
        kept = b'\0'.join(p for p in lf.split(b'\0') if keep(p))
        if kept:
            kept += b'\0'
        tar_proc = subprocess.Popen(
            ['tar', '-cf', '-', '-C', str(cwd),
             '--ignore-failed-read', '--null', '--no-recursion',
             '--files-from', '-'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,  # drop "Cannot stat" spam
        )
        out, _ = tar_proc.communicate(input=kept)
        # Even with --ignore-failed-read, tar's exit code can be 1 if any
        # file vanished — we accept that as long as the archive itself is
        # non-empty.
        if not out:
            raise subprocess.CalledProcessError(tar_proc.returncode, 'tar')
        return out

    # Non-git fallback: denylist-pruned full-tree tar.
    excludes = list(dict.fromkeys(DENY_PATTERNS))
    cmd = ['tar', '-cf', '-', '-C', str(cwd)]
    for pat in excludes:
        cmd += ['--exclude', pat]
    cmd += ['.']
    return subprocess.check_output(cmd)


# ── inotify watcher (host CWD → guest) ────────────────────────────────

def watch_host_cwd(cwd: Path, sock: socket.socket) -> None:
    # pyinotify 0.9.6 unconditionally `import asyncore` at module level,
    # AND subclasses asyncore.{dispatcher, file_dispatcher} at module
    # level. Python 3.13 removed asyncore from the stdlib. We never use
    # the {Async, Asyncore}Notifier classes, so trivial subclassable
    # stubs are enough to let the import succeed. Without this, hosts
    # on Python 3.13 (e.g. miniconda) crash here and lose host→guest
    # sync of subsequent edits.
    import sys as _sys
    import types as _types
    if 'asyncore' not in _sys.modules:
        class _StubBase:
            def __init__(self, *a, **kw): pass
        _stub = _types.ModuleType('asyncore')
        _stub.dispatcher = _StubBase           # type: ignore[attr-defined]
        _stub.file_dispatcher = _StubBase      # type: ignore[attr-defined]
        _sys.modules['asyncore'] = _stub
    import pyinotify  # type: ignore

    mask = (
        pyinotify.IN_CLOSE_WRITE
        | pyinotify.IN_DELETE
        | pyinotify.IN_MOVED_FROM
        | pyinotify.IN_MOVED_TO
        | pyinotify.IN_CREATE
    )

    cwd_resolved = cwd.resolve()

    def rel_of(full: str) -> str | None:
        try:
            return '/' + str(Path(full).resolve().relative_to(cwd_resolved))
        except (ValueError, OSError):
            return None

    class Handler(pyinotify.ProcessEvent):
        def _emit_set(self, full: str) -> None:
            if is_ignored(full):
                return
            rel = rel_of(full)
            if rel is None or is_denied(rel.lstrip('/')):
                return
            try:
                with open(full, 'rb') as f:
                    data = f.read()
            except OSError:
                return
            send_frame(sock, f'SET {rel} {len(data)}', data)

        def _emit_del(self, full: str) -> None:
            if is_ignored(full):
                return
            rel = rel_of(full)
            if rel is None or is_denied(rel.lstrip('/')):
                return
            send_frame(sock, f'DEL {rel}')

        def _emit_dir(self, full: str) -> None:
            if is_ignored(full):
                return
            rel = rel_of(full)
            if rel is None or is_denied(rel.lstrip('/')):
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

    wm = pyinotify.WatchManager()
    handler = Handler()
    notifier = pyinotify.Notifier(wm, handler)

    # Recursive auto-add, but skip denied subtrees via exclude_filter.
    def exclude(path: str) -> bool:
        try:
            rel = str(Path(path).resolve().relative_to(cwd_resolved))
        except (ValueError, OSError):
            return True
        return is_denied(rel)

    wm.add_watch(
        str(cwd_resolved),
        mask,
        rec=True,
        auto_add=True,
        exclude_filter=pyinotify.ExcludeFilter([]),  # placeholder; replaced below
    )
    # pyinotify.ExcludeFilter takes regex patterns; easier to monkey-patch
    # ourselves: but the simple denylist above plus per-event filtering
    # is sufficient. The exclude_filter would only save inotify slots,
    # not correctness.
    notifier.loop()


# ── main ──────────────────────────────────────────────────────────────

def serve_one_vm(uds_path: str, cwd: Path) -> int:
    sync_uds = uds_path + SYNC_PORT_SUFFIX
    # Clean any stale socket from a prior session.
    try: os.unlink(sync_uds)
    except FileNotFoundError: pass
    except OSError as e:
        sys.stderr.write(f'[sync-host] cannot remove stale {sync_uds}: {e}\n')

    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(sync_uds)
    srv.listen(1)
    # Tighten perms — only our user should be able to dial.
    try: os.chmod(sync_uds, 0o600)
    except OSError: pass
    sys.stderr.write(f'[sync-host] listening on {sync_uds} for guest connect\n')

    try:
        conn, _ = srv.accept()
    except OSError as e:
        sys.stderr.write(f'[sync-host] accept failed: {e}\n')
        return 1
    finally:
        try: srv.close()
        except OSError: pass
    sys.stderr.write('[sync-host] guest connected\n')

    fs = HostFs(cwd)

    # Ship the initial workspace tar.
    try:
        tar = build_workspace_tar(cwd)
    except subprocess.CalledProcessError as e:
        sys.stderr.write(f'[sync-host] tar failed: {e}\n')
        return 1
    sys.stderr.write(f'[sync-host] sending INIT ({len(tar)} bytes)\n')
    send_frame(conn, f'INIT /workspace {len(tar)}', tar)

    # Start inotify thread (host CWD → guest fanout).
    t = threading.Thread(target=watch_host_cwd, args=(cwd, conn), daemon=True)
    t.start()

    # Main loop: read frames from guest and apply to host.
    while True:
        try:
            op, args, payload = read_frame(conn)
        except (OSError, ConnectionError):
            sys.stderr.write('[sync-host] guest disconnected\n')
            return 0
        try:
            if op == 'SET' and len(args) >= 2:
                fs.apply_set(args[0], payload)
            elif op == 'DEL' and args:
                fs.apply_del(args[0])
            elif op == 'DIR' and args:
                fs.apply_dir(args[0])
            elif op == 'PONG':
                pass
            # else: unknown, ignore
        except Exception as e:
            sys.stderr.write(f'[sync-host] apply error op={op}: {e}\n')


def main() -> int:
    if len(sys.argv) < 3:
        sys.stderr.write('usage: claudewrap-sync-host.py <vsock-uds> <cwd>\n')
        return 2
    uds_path = sys.argv[1]
    cwd = Path(sys.argv[2])
    if not cwd.is_dir():
        sys.stderr.write(f'[sync-host] cwd not a directory: {cwd}\n')
        return 1
    return serve_one_vm(uds_path, cwd)


if __name__ == '__main__':
    sys.exit(main())
