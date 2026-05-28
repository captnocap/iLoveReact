# HSMC - Blank Game Shell

HSMC means Hitman Shitcity.

Build the game with:

```sh
./scripts/ship hsmc
```

The game cart deliberately renders a blank play surface with a console drop
down. Internal map tooling is a separate cart:

```sh
./scripts/ship hsmc-int
```

The first product surface is still the console. It can mutate every meaningful
part of the game state, giving development the same power shape as a classic
engine console or an ultimate mod menu: commands are the stable interface, while
UI, tools, and hotloops call into the same path.

## Architecture

```
cart/hsmc/
  index.tsx              composition root
  design.ts              JSON game-state contract
  state/gameState.ts     create/load/save/revive GameState
  commands/              parser + command registry
  world/grid.ts          grid storage helpers over continuous movement
  ui/Console.tsx         command terminal

cart/hsmc-int/
  index.tsx              internal map tooling shell
  MapCanvas.tsx          blank map surface until map authoring exists
```

## State Model

The whole game state is one JSON object. The cart stores it through host storage
and mirrors it into hot state after every command. Autosave runs on a timer.

World construction is grid-locked: cell keys, chunk keys, placed cells. Player
and spawned entities move in continuous coordinates on top of the grid.

## Starter Commands

- `help`
- `state [path]`
- `save`
- `load`
- `reset`
- `teleport <x> <z> [y]`
- `scene <step>`
- `set <path> <value>`
- `speed <walk|run> <value>`
- `spawn <kind> [x] [z] [y]`
- `despawn <entityId>`
- `place <kind> <x> <z> [y]`
- `remove <x> <z> [y]`
