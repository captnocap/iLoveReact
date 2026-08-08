// cli/main.ts - rjit <subcommand> [args] dispatcher.

import { err } from './host/log.ts';
import * as autotest from './commands/autotest.ts';
import * as bakeGeometry from './commands/bake-geometry.ts';
import * as bakeGeometryAuto from './commands/bake-geometry-auto.ts';
import * as bakeIcons from './commands/bake-icons.ts';
import * as cartManifestField from './commands/cart-manifest-field.ts';
import * as cartBundle from './commands/cart-bundle.ts';
import * as classify from './commands/classify.ts';
import * as clean from './commands/clean.ts';
import * as orphans from './commands/orphans.ts';
import * as stop from './commands/stop.ts';
import * as codegenBindings from './commands/codegen-bindings.ts';
import * as dev from './commands/dev.ts';
import * as firecrackerBuild from './commands/firecracker-build.ts';
import * as game from './commands/game.ts';
import * as gdev from './commands/gdev.ts';
import * as help from './commands/help.ts';
import * as init from './commands/init.ts';
import * as lab from './commands/lab.ts';
import * as metafileGate from './commands/metafile-gate.ts';
import * as pack from './commands/pack.ts';
import * as packSdk from './commands/pack-sdk.ts';
import * as play from './commands/play.ts';
import * as pushBundle from './commands/push-bundle.ts';
import * as repo from './commands/repo.ts';
import * as ship from './commands/ship.ts';
import * as shipTui from './commands/ship-tui.ts';
import * as shot from './commands/shot.ts';
import * as tui from './commands/tui.ts';
import * as watchAndPush from './commands/watch-and-push.ts';

interface Command {
  run: (argv: string[]) => Promise<number>;
}

const COMMANDS: Record<string, Command> = {
  'autotest': autotest,
  'bake-geometry': bakeGeometry,
  'bake-geometry-auto': bakeGeometryAuto,
  'bake-icons': bakeIcons,
  'cart-bundle': cartBundle,
  'cart-manifest-field': cartManifestField,
  'classify': classify,
  'clean': clean,
  'orphans': orphans,
  'codegen-bindings': codegenBindings,
  'dev': dev,
  'firecracker-build': firecrackerBuild,
  'game': game,
  'gdev': gdev,
  'help': help,
  'init': init,
  'lab': lab,
  'metafile-gate': metafileGate,
  'pack': pack,
  'pack-sdk': packSdk,
  'play': play,
  'push-bundle': pushBundle,
  'repo': repo,
  'ship': ship,
  'ship-tui': shipTui,
  'shot': shot,
  'stop': stop,
  'tui': tui,
  'watch-and-push': watchAndPush,
};

async function main(): Promise<number> {
  const subcommand = process.argv[1];
  if (!subcommand) {
    help.printTopLevel();
    return 0;
  }

  const command = COMMANDS[subcommand];
  if (!command) {
    err(`rjit: unknown subcommand: ${subcommand}`);
    err('try: rjit help');
    return 1;
  }

  return command.run(process.argv.slice(2));
}

main().then(__exit, (error: Error) => {
  err(`rjit: ${error.message}`);
  __exit(1);
});
