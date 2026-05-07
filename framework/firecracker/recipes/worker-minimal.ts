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
  ],

  npmGlobal: [
    '@anthropic-ai/claude-code',
  ],

  steps: [
    // Reserve the future worker uid; creds get bind-mounted at boot.
    { run: 'useradd -m -s /bin/bash -u 1000 worker' },
    { run: 'install -d -m 700 -o worker -g worker /home/worker/.claude' },
  ],

  output: {
    kind: 'ext4',
    path: 'images/worker-minimal.ext4',
    sizeMb: 1024,
  },
};

export default recipe;
