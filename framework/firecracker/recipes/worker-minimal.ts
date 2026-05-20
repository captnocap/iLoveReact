import type { VmImage } from '../recipe';

// Smallest viable worker: Ubuntu noble + node + claude-code.
// No editor, no compilers, no debug tools. Just enough to run claude-code
// against a mounted worktree.

const recipe: VmImage = {
  id: 'worker-minimal',
  base: 'noble',
  arch: 'amd64',

  apt: [
    'ca-certificates',
    'curl',
    'git',
    'nodejs',
    'npm',
    'openssh-client',
    // util-linux: mount/umount/setsid for the /init script.
    'util-linux',
    // mount: provides /sbin/mount.* helpers.
    'mount',
    // procps: handy in-VM (ps/top etc).
    'procps',
    // iproute2: `ip` cmd for eth0 bring-up in /init.
    'iproute2',
    // socat: pty allocator + userspace byte translator. Used in /init
    // to bridge /dev/ttyS0 ↔ claude with NL→CR translation that ttyS0’s
    // line discipline can’t do (because claude’s setRawMode clears it).
    'socat',
    // libvterm0: shared library used by the claude-inner TUI wrapper
    // (staged on the cred drive). Without it the wrapper hard-fails with
    // "error while loading shared libraries: libvterm.so.0".
    'libvterm0',
    // python3-pyinotify: used by cred-staged sync daemon to watch
    // /workspace for filesystem changes inside the VM and forward
    // them to the host coordinator.
    'python3-pyinotify',
  ],

  npmGlobal: [
    '@anthropic-ai/claude-code',
  ],

  steps: [
    // Reserve the future worker uid; creds get spliced in by the launcher.
    { run: 'useradd -m -s /bin/bash -u 1000 worker' },
    { run: 'install -d -m 700 -o worker -g worker /home/worker/.claude' },

    // Empty mount point for the per-session workspace tmpfs (mounted
    // by /init). Without this dir baked into the ro rootfs, /init's
    // `mount -t tmpfs tmpfs /workspace` fails because the mount point
    // doesn't exist, and sync-guest's mkdir crashes with EROFS.
    { run: 'mkdir -p /workspace && chmod 755 /workspace' },

    // Bake DNS into the rootfs since /etc is on the ro fs at runtime.
    // Cloudflare + Google, both reliable for api.anthropic.com lookups.
    {
      writeFile: {
        path: '/etc/resolv.conf',
        mode: 0o644,
        content: 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n',
      },
    },

    // ifttt-emit — claude hook callback. Each Claude Code lifecycle
    // event (PreToolUse, PostToolUse, UserPromptSubmit, Notification,
    // Stop, SessionStart, …) is wired in settings.json to call this
    // script with the event name as $1 and the hook JSON payload on
    // stdin. We wrap it in an envelope and ship to the host listener
    // at 172.16.0.1:9099 via socat (TCP, no tty involvement).
    //
    // Best-effort: || true so a missing/slow host doesn't block the
    // hook (claude waits for hooks to return). Timeout caps blocking.
    {
      writeFile: {
        path: '/usr/local/bin/ifttt-emit',
        mode: 0o755,
        content:
          '#!/bin/sh\n' +
          'event=${1:-unknown}\n' +
          'ts=$(date +%s%3N)\n' +
          'payload=$(cat)\n' +
          '# Envelope: {event, ts (ms), payload (raw hook JSON)}. We trust\n' +
          '# the payload to be JSON — claude\\u2019s hook spec mandates it.\n' +
          'line="{\\"event\\":\\"$event\\",\\"ts\\":$ts,\\"payload\\":${payload:-null}}"\n' +
          'printf "%s\\n" "$line" \\\n' +
          '  | timeout 2 /usr/bin/socat - TCP:172.16.0.1:9099 2>/dev/null \\\n' +
          '  || true\n',
      },
    },

    // bridge-directive — UserPromptSubmit hook script. The host
    // claudewrap cart's /v1/chat/completions endpoint sets per-turn
    // chat_id/turn_id/endMarker + tool list on its active refs, then
    // pastes the user prompt into the vterm. UserPromptSubmit fires
    // here BEFORE claude processes the prompt; we curl the bridge's
    // /directive endpoint which returns:
    //
    //   {"hookSpecificOutput": {
    //      "hookEventName": "UserPromptSubmit",
    //      "additionalContext": "(Bridge protocol — chat_id=…)"
    //    }}
    //
    // Claude reads our stdout, treats additionalContext as injected
    // system context, and now knows to call bridge.respond /
    // bridge.call_tool against the registered MCP server. The
    // directive never appears in the user-visible message body.
    //
    // No active request → bridge returns `{}` → no-op (claude just
    // processes the user prompt normally). Timeout/network failure →
    // `{}` printed locally so claude never blocks.
    {
      writeFile: {
        path: '/usr/local/bin/bridge-directive.sh',
        mode: 0o755,
        content:
          '#!/bin/sh\n' +
          'cat >/dev/null  # drain stdin (the hook payload — we don\\u2019t need it)\n' +
          'curl -s --max-time 2 http://172.16.0.1:7781/directive 2>/dev/null \\\n' +
          '  || echo "{}"\n',
      },
    },

    // claude-wrap — runs as socat's EXEC child. Sets the inner pty’s
    // size from $COLUMNS/$LINES (exported by /init from /root/.termsize),
    // then execs claude. Without this the pty defaults to 80x24 and
    // claude’s redraws clip / leave stale ANSI behind (e.g. the /
    // command menu sticking around after backspace).
    //
    // Also records its tty path in /run/inner-tty so claude-control.py
    // (running in parallel, listening on vsock 5001) can apply live
    // TIOCSWINSZ updates when the host PTY resizes.
    {
      writeFile: {
        path: '/usr/local/bin/claude-wrap',
        mode: 0o755,
        content:
          '#!/bin/sh\n' +
          'if [ -n "$COLUMNS" ] && [ -n "$LINES" ]; then\n' +
          '  stty cols "$COLUMNS" rows "$LINES" 2>/dev/null\n' +
          'fi\n' +
          '# Record the inner pty path for the live-resize listener.\n' +
          'tty > /run/inner-tty 2>/dev/null || true\n' +
          '# Wait for the workspace sync daemon to finish the initial\n' +
          '# extraction, then cd in so claude starts with the synced host\n' +
          '# project as its working directory instead of empty /root. Cap\n' +
          '# the wait at 15s — if the sync daemon isn\\u2019t up by then\n' +
          '# we fall through and claude runs against /root the legacy way.\n' +
          'i=0\n' +
          'while [ "$i" -lt 150 ] && [ ! -f /run/workspace-ready ]; do\n' +
          '  i=$((i+1))\n' +
          '  sleep 0.1\n' +
          'done\n' +
          'if [ -d /workspace ] && [ -f /run/workspace-ready ]; then\n' +
          '  cd /workspace\n' +
          '  echo "[claude-wrap] cwd=/workspace (synced)"\n' +
          'else\n' +
          '  echo "[claude-wrap] no /workspace — running in /root"\n' +
          'fi\n' +
          '# Prefer the inner TUI wrapper if staged — it runs claude inside\n' +
          '# our own vterm so the output crossing vsock is flat character cells\n' +
          '# instead of Ink\\u2019s complex cursor-query / alt-screen ANSI.\n' +
          'if [ -x /root/claude-inner ]; then\n' +
          '  exec /root/claude-inner\n' +
          'fi\n' +
          '# --mcp-config wires the host-side claudewrap bridge MCP server\n' +
          '# at http://172.16.0.1:7781/mcp into this claude session so it can\n' +
          '# call bridge.respond / bridge.call_tool for /v1/chat/completions\n' +
          '# requests. The config file is baked into the rootfs at build time\n' +
          '# (see the /etc/claude-mcp-config.json writeFile step below).\n' +
          '# --dangerously-skip-permissions trips Claude Code\\u2019s\n' +
          '# root check, so we pre-approve the two bridge MCP tools in\n' +
          '# settings.json (permissions.allow) instead. Other tool\n' +
          '# gating stays under the live IFTTT recipes on the host.\n' +
          'MCP_CFG=/etc/claude-mcp-config.json\n' +
          'if [ -f "$MCP_CFG" ]; then\n' +
          '  exec /usr/local/bin/claude --mcp-config "$MCP_CFG"\n' +
          'fi\n' +
          'exec /usr/local/bin/claude\n',
      },
    },

    // claude-control.py — live-resize listener. Sits on vsock 5001
    // accepting RESIZE messages from the host (vsock-bridge ships one
    // every SIGWINCH). Applies the new size to the inner pty whose
    // path claude-wrap recorded in /run/inner-tty. The kernel's
    // TIOCSWINSZ ioctl sends SIGWINCH to the pty's foreground process
    // group, which is what triggers claude's full redraw at the new
    // geometry.
    //
    // No /run/inner-tty file → silently no-op. claude-wrap writes it
    // before exec'ing claude, so the listener can apply early resizes
    // received before the first message lands.
    {
      writeFile: {
        path: '/usr/local/bin/claude-control.py',
        mode: 0o755,
        content:
          '#!/usr/bin/env python3\n' +
          '"""VM-side live-resize listener on vsock 5001."""\n' +
          'import fcntl, os, socket, struct, sys, termios\n' +
          '\n' +
          'AF_VSOCK = 40\n' +
          'VMADDR_CID_ANY = 0xffffffff\n' +
          'VSOCK_PORT = 5001\n' +
          'TTY_FILE = "/run/inner-tty"\n' +
          '\n' +
          'def apply_resize(rows, cols):\n' +
          '    try:\n' +
          '        with open(TTY_FILE) as f:\n' +
          '            tty_path = f.read().strip()\n' +
          '    except FileNotFoundError:\n' +
          '        return\n' +
          '    if not tty_path:\n' +
          '        return\n' +
          '    try:\n' +
          '        fd = os.open(tty_path, os.O_RDWR | os.O_NOCTTY)\n' +
          '    except OSError:\n' +
          '        return\n' +
          '    try:\n' +
          '        ws = struct.pack("HHHH", rows, cols, 0, 0)\n' +
          '        fcntl.ioctl(fd, termios.TIOCSWINSZ, ws)\n' +
          '    except OSError:\n' +
          '        pass\n' +
          '    finally:\n' +
          '        os.close(fd)\n' +
          '\n' +
          'def main():\n' +
          '    s = socket.socket(AF_VSOCK, socket.SOCK_STREAM)\n' +
          '    s.bind((VMADDR_CID_ANY, VSOCK_PORT))\n' +
          '    s.listen(4)\n' +
          '    sys.stderr.write("[claude-control] listening on vsock {}\\n".format(VSOCK_PORT))\n' +
          '    while True:\n' +
          '        try:\n' +
          '            client, _ = s.accept()\n' +
          '        except OSError:\n' +
          '            continue\n' +
          '        try:\n' +
          '            buf = b""\n' +
          '            while True:\n' +
          '                chunk = client.recv(256)\n' +
          '                if not chunk:\n' +
          '                    break\n' +
          '                buf += chunk\n' +
          '                while b"\\n" in buf:\n' +
          '                    line, buf = buf.split(b"\\n", 1)\n' +
          '                    parts = line.decode("ascii", "replace").strip().split()\n' +
          '                    if len(parts) == 3 and parts[0] == "RESIZE":\n' +
          '                        try:\n' +
          '                            apply_resize(int(parts[1]), int(parts[2]))\n' +
          '                        except ValueError:\n' +
          '                            pass\n' +
          '        except OSError:\n' +
          '            pass\n' +
          '        finally:\n' +
          '            try: client.close()\n' +
          '            except OSError: pass\n' +
          '\n' +
          'if __name__ == "__main__":\n' +
          '    main()\n',
      },
    },

    // Default Claude Code hooks settings. Copied into /root/.claude/
    // by /init at boot (after any cred-seed from /dev/vdb). Picks the
    // load-bearing lifecycle events; pathology-style triggers (stuck
    // spinners, repeated retries) come from PTY scraping in the
    // wrapper, not from hooks.
    {
      writeFile: {
        path: '/etc/claude-hooks-settings.json',
        mode: 0o644,
        content: JSON.stringify({
          hooks: {
            PreToolUse:       [{ matcher: '*', hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit PreToolUse' }] }],
            PostToolUse:      [{ matcher: '*', hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit PostToolUse' }] }],
            UserPromptSubmit: [
              { hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit UserPromptSubmit' }] },
              // bridge-directive: pulls per-turn directive (chat_id/
              // turn_id/endMarker/tools) from the host bridge and
              // outputs it as hookSpecificOutput.additionalContext.
              // No-ops when no active /v1/chat/completions request is
              // in flight.
              { hooks: [{ type: 'command', command: '/usr/local/bin/bridge-directive.sh' }] },
            ],
            Notification:     [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit Notification' }] }],
            Stop:             [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit Stop' }] }],
            SubagentStart:    [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit SubagentStart' }] }],
            SubagentStop:     [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit SubagentStop' }] }],
            PreCompact:       [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit PreCompact' }] }],
            SessionStart:     [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit SessionStart' }] }],
            SessionEnd:       [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit SessionEnd' }] }],
          },
          // Pre-approve the bridge MCP server's tools so claude can
          // call them without a permission prompt — the bridge IS the
          // trusted caller from the API side. Other tools (Write/
          // Edit/Bash/etc.) still prompt unless an IFTTT recipe on
          // the host pre-answers them.
          //
          // The format follows Claude Code's settings.json allow
          // pattern: `mcp__<server>__<tool>` where <server> matches
          // the key under mcpServers (here "bridge").
          permissions: {
            allow: [
              'mcp__bridge__respond',
              'mcp__bridge__call_tool',
            ],
          },
        }, null, 2) + '\n',
      },
    },

    // Bridge MCP config — read by claude via `--mcp-config <path>`
    // (see /usr/local/bin/claude-wrap above). 172.16.0.1 is the host
    // side of the tap interface (/init below assigns 172.16.0.2/30
    // to the guest with default route via .1). Port 7781 is the
    // claudewrap cart's BridgeHost useHost port.
    //
    // When the bridge POSTs to /v1/chat/completions it pastes a
    // directive into claude (chat_id/turn_id/endMarker + tool list).
    // Claude then calls bridge.respond / bridge.call_tool against
    // this HTTP MCP server, and the bridge resolves the pending
    // request from those calls instead of falling back to transcript
    // scraping.
    {
      writeFile: {
        path: '/etc/claude-mcp-config.json',
        mode: 0o644,
        content: JSON.stringify({
          mcpServers: {
            bridge: {
              type: 'http',
              url: 'http://172.16.0.1:7781/mcp',
            },
          },
        }, null, 2) + '\n',
      },
    },

    // PID 1 init script. No systemd — we just need: mount essential
    // filesystems, bring eth0 up, drop to claude on ttyS0, and let
    // `panic=1 reboot=k` shut the VM down when claude exits.
    //
    // Credentials: the launcher writes /root/.claude (and optionally
    // /run/assignment.json) into the rootfs via debugfs before boot.
    {
      writeFile: {
        path: '/init',
        mode: 0o755,
        content:
          '#!/bin/sh\n' +
          'echo "[init] start"\n' +
          '/bin/mount -t proc   proc   /proc 2>/dev/null;  echo "[init] proc=$?"\n' +
          '/bin/mount -t sysfs  sysfs  /sys  2>/dev/null;  echo "[init] sysfs=$?"\n' +
          '# devtmpfs is auto-mounted by the kernel; we just need /dev/pts.\n' +
          'mkdir -p /dev/pts\n' +
          '/bin/mount -t devpts devpts /dev/pts 2>/dev/null; echo "[init] devpts=$?"\n' +
          '# tmpfs overlays so the ro rootfs doesn\\u2019t trap writes from\n' +
          '# claude\\u2019s first-run state, npm cache, /run/prompt, /tmp.\n' +
          '/bin/mount -t tmpfs tmpfs /run;       echo "[init] tmpfs /run=$?"\n' +
          '/bin/mount -t tmpfs tmpfs /tmp;       echo "[init] tmpfs /tmp=$?"\n' +
          '/bin/mount -t tmpfs tmpfs /root;      echo "[init] tmpfs /root=$?"\n' +
          '# /workspace: writable mount for the synced host project,\n' +
          '# populated by /root/claudewrap-sync-guest.py from the host.\n' +
          '/bin/mount -t tmpfs tmpfs /workspace; echo "[init] tmpfs /workspace=$?"\n' +
          '# Seed /root from /dev/vdb (raw tar of host\\u2019s .claude creds).\n' +
          '# Launcher attaches the drive only when creds are available, so a\n' +
          '# missing /dev/vdb is fine — claude just shows its login flow.\n' +
          'if [ -e /dev/vdb ]; then\n' +
          '  tar -xf /dev/vdb -C /root 2>/dev/null; echo "[init] cred seed=$?"\n' +
          'else\n' +
          '  echo "[init] no /dev/vdb — running without creds"\n' +
          'fi\n' +
          '# Install hook settings on top of whatever the cred-seed brought\n' +
          '# (or as the only settings if no creds). Hooks emit one line per\n' +
          '# claude lifecycle event to the host listener at 172.16.0.1:9099.\n' +
          'mkdir -p /root/.claude\n' +
          'cp /etc/claude-hooks-settings.json /root/.claude/settings.json;  echo "[init] hooks settings=$?"\n' +
          '# Bring eth0 up: single virtio-net, kernel-named eth0 (no udev).\n' +
          '# Static config matches what the launcher set on the host side\n' +
          '# of tap0 (host 172.16.0.1/30, guest 172.16.0.2/30, NAT MASQ).\n' +
          'ip link set eth0 up;                                    echo "[init] eth0 up=$?"\n' +
          'ip addr add 172.16.0.2/30 dev eth0;                     echo "[init] eth0 addr=$?"\n' +
          'ip route add default via 172.16.0.1;                    echo "[init] default route=$?"\n' +
          'export PATH=/usr/local/bin:/usr/bin:/bin\n' +
          'export HOME=/root\n' +
          'export TERM=xterm-256color\n' +
          'cd /root\n' +
          '# Pick up the outer terminal size the launcher captured before\n' +
          '# boot. Apply to /dev/ttyS0 (so kernel + claude agree on size)\n' +
          '# and forward to socat\\u2019s inner pty. Fallback 80x24 if no\n' +
          '# .termsize was staged.\n' +
          'ROWS=24; COLS=80\n' +
          '[ -f /root/.termsize ] && . /root/.termsize\n' +
          'stty -F /dev/ttyS0 rows "$ROWS" cols "$COLS" 2>/dev/null\n' +
          'export COLUMNS="$COLS" LINES="$ROWS"\n' +
          'echo "[init] term size: ${COLS}x${ROWS}"\n' +
          '# Bridge vsock ↔ claude. The host connects to guest port 5000\n' +
          '# via the Firecracker vsock UDS, giving a clean byte stream with\n' +
          '# no serial-console UART in the path. The old STDIO+inlcr path\n' +
          '# mangled escape sequences through ttyS0\\u2019s line discipline.\n' +
          '#   - vsock side: transparent byte pipe, no translation needed.\n' +
          '#   - exec side: pty + setsid + ctty so claude gets a real,\n' +
          '#     fresh controlling terminal (Ink/Node requires isatty=true).\n' +
          '#     /usr/local/bin/claude-wrap reads $COLUMNS/$LINES and\n' +
          '#     stty\\u2019s the inner pty before exec\\u2019ing claude.\n' +
          '# When claude exits, socat exits, kernel panics (panic=1),\n' +
          '# vsock drops, host bridge returns, cleanup fires.\n' +
          '# Launch the live-resize listener in the background. It accepts\n' +
          '# vsock 5001 connections from the host\\u2019s vsock-bridge and\n' +
          '# applies TIOCSWINSZ to /run/inner-tty whenever the host PTY\n' +
          '# resizes. claude inside the inner pty gets SIGWINCH and redraws\n' +
          '# at the new geometry, instead of being stuck at boot-time size.\n' +
          '/usr/local/bin/claude-control.py &\n' +
          'echo "[init] live-resize listener pid=$!"\n' +
          '# Generic extension point for cred-staged daemons. Anything\n' +
          '# the launcher tars into /root/init-hook.sh runs in the\n' +
          '# background just before socat takes over PID 1. Lets us\n' +
          '# iterate on sync daemons / future plumbing without\n' +
          '# rebuilding the rootfs every time.\n' +
          'if [ -x /root/init-hook.sh ]; then\n' +
          '  /root/init-hook.sh &\n' +
          '  echo "[init] init-hook pid=$!"\n' +
          'fi\n' +
          'echo "[init] listening on vsock port 5000"\n' +
          'exec /usr/bin/socat \\\n' +
          '  VSOCK-LISTEN:5000,reuseaddr \\\n' +
          '  "EXEC:/usr/local/bin/claude-wrap,pty,setsid,ctty,stderr,raw,echo=0"\n',
      },
    },
  ],

  output: {
    kind: 'ext4',
    path: 'images/worker-minimal.ext4',
    sizeMb: 1024,
  },
};

export default recipe;
