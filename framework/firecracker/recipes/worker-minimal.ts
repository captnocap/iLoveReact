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
  ],

  npmGlobal: [
    '@anthropic-ai/claude-code',
  ],

  steps: [
    // Reserve the future worker uid; creds get spliced in by the launcher.
    { run: 'useradd -m -s /bin/bash -u 1000 worker' },
    { run: 'install -d -m 700 -o worker -g worker /home/worker/.claude' },

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

    // claude-wrap — runs as socat's EXEC child. Sets the inner pty’s
    // size from $COLUMNS/$LINES (exported by /init from /root/.termsize),
    // then execs claude. Without this the pty defaults to 80x24 and
    // claude’s redraws clip / leave stale ANSI behind (e.g. the /
    // command menu sticking around after backspace).
    {
      writeFile: {
        path: '/usr/local/bin/claude-wrap',
        mode: 0o755,
        content:
          '#!/bin/sh\n' +
          'if [ -n "$COLUMNS" ] && [ -n "$LINES" ]; then\n' +
          '  stty cols "$COLUMNS" rows "$LINES" 2>/dev/null\n' +
          'fi\n' +
          '# Prefer the inner TUI wrapper if staged — it runs claude inside\n' +
          '# our own vterm so the output crossing vsock is flat character cells\n' +
          '# instead of Ink\\u2019s complex cursor-query / alt-screen ANSI.\n' +
          'if [ -x /root/claude-inner ]; then\n' +
          '  exec /root/claude-inner\n' +
          'fi\n' +
          'exec /usr/local/bin/claude\n',
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
            UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit UserPromptSubmit' }] }],
            Notification:     [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit Notification' }] }],
            Stop:             [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit Stop' }] }],
            SubagentStart:    [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit SubagentStart' }] }],
            SubagentStop:     [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit SubagentStop' }] }],
            PreCompact:       [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit PreCompact' }] }],
            SessionStart:     [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit SessionStart' }] }],
            SessionEnd:       [{ hooks: [{ type: 'command', command: '/usr/local/bin/ifttt-emit SessionEnd' }] }],
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
          '/bin/mount -t tmpfs tmpfs /run;  echo "[init] tmpfs /run=$?"\n' +
          '/bin/mount -t tmpfs tmpfs /tmp;  echo "[init] tmpfs /tmp=$?"\n' +
          '/bin/mount -t tmpfs tmpfs /root; echo "[init] tmpfs /root=$?"\n' +
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
