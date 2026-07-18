import type { VmImage } from '../recipe';

// Full developer worker — what an agent needs to do real work in this repo.
//
// Toolchain: nvm + latest LTS node, luajit, zig (host's pinned 0.16.0),
// git, ssh, build-essential. Plus claude-code via npm; codex/kimi/etc go in
// the same npm-global slot when needed.
//
// nvm is installed system-wide at /usr/local/nvm and sourced via
// /etc/profile.d/nvm.sh, so login shells (worker user, root) get it for free.

const recipe: VmImage = {
  id: 'worker-dev',
  base: 'noble',
  arch: 'amd64',

  apt: [
    'ca-certificates',
    'curl',
    'git',
    'openssh-client',
    'unzip',
    'xz-utils',
    'build-essential',
    'luajit',
    'libluajit-5.1-dev',
    // util-linux brings `reboot`, `mount`, etc. minbase strips them.
    'util-linux',
  ],

  steps: [
    // -- worker user ----------------------------------------------------
    { run: 'useradd -m -s /bin/bash -u 1000 worker' },
    { run: 'install -d -m 700 -o worker -g worker /home/worker/.claude' },

    // -- nvm at /usr/local/nvm ------------------------------------------
    { run: 'mkdir -p /usr/local/nvm' },
    {
      writeFile: {
        path: '/etc/profile.d/nvm.sh',
        content:
          'export NVM_DIR=/usr/local/nvm\n' +
          '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"\n' +
          '[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"\n',
        mode: 0o755,
      },
    },
    {
      run:
        'NVM_DIR=/usr/local/nvm PROFILE=/dev/null bash -c ' +
        '"curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"',
    },

    // -- latest LTS node + npm globals ----------------------------------
    { run: 'bash -lc "nvm install --lts && nvm alias default lts/*"' },
    {
      run:
        'bash -lc "npm install -g ' +
        '@anthropic-ai/claude-code"',
    },

    // -- zig 0.16.0 (host's pinned copy) --------------------------------
    { copyFromHost: { src: 'tools/zig/zig', dest: '/usr/local/bin/zig' } },
    { copyFromHost: { src: 'tools/zig/lib', dest: '/usr/local/lib/zig' } },
    { run: 'chmod 755 /usr/local/bin/zig' },
    // zig finds its stdlib via `<exe>/../lib/zig`; we put it at
    // /usr/local/lib/zig and add a compat symlink so both layouts resolve.
    { run: 'mkdir -p /usr/local/lib && ln -snf /usr/local/lib/zig /usr/local/zig-lib' },

    // -- esbuild + v8cli (framework build deps) -------------------------
    { copyFromHost: { src: 'tools/esbuild', dest: '/usr/local/bin/esbuild' } },
    { copyFromHost: { src: 'tools/v8cli', dest: '/usr/local/bin/v8cli' } },
    { run: 'chmod 755 /usr/local/bin/esbuild /usr/local/bin/v8cli' },

    // -- ownership pass --------------------------------------------------
    { run: 'chown -R worker:worker /home/worker' },
  ],

  output: {
    kind: 'ext4',
    path: 'images/worker-dev.ext4',
    sizeMb: 4096,
  },
};

export default recipe;
