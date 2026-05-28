// cli/commands/tui.ts - compatibility alias for dev --tui.

import * as dev from './dev.ts';

export async function run(argv: string[]): Promise<number> {
  return dev.run([...argv, '--tui']);
}
