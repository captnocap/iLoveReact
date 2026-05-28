// cli/commands/ship-tui.ts - compatibility alias for ship --tui.

import * as ship from './ship.ts';

export async function run(argv: string[]): Promise<number> {
  return ship.run([...argv, '--tui']);
}
