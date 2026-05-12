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
          '# Bridge /dev/ttyS0 ↔ claude through socat with:\n' +
          '#   - stdio side: raw mode, no echo, no socat-side line\n' +
          '#     processing; \"inlcr\" tells SOCAT (user-space, not termios)\n' +
          '#     to translate NL→CR on input. This is the actual fix:\n' +
          '#     bytes arrive at /dev/ttyS0 as LF because firecracker (or\n' +
          '#     the host kitty PTY) does CR→LF upstream, and termios\n' +
          '#     options on the guest can\\u2019t undo it once claude\\u2019s Ink\n' +
          '#     calls cfmakeraw on its own stdin.\n' +
          '#   - exec side: pty + setsid + ctty so claude gets a real,\n' +
          '#     fresh controlling terminal (Ink/Node requires isatty=true).\n' +
          '# When claude exits, socat exits, kernel panics (panic=1), \n' +
          '# firecracker exits, your kitty shell returns.\n' +
          'exec /usr/bin/socat \\\n' +
          '  STDIO,rawer,inlcr \\\n' +
          '  "EXEC:/usr/local/bin/claude,pty,setsid,ctty,stderr,raw,echo=0"\n',
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
