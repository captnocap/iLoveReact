# HMSC - Command-First Scaffold

HMSC means Hitman Shitcity.

The first product surface is a console that can mutate every meaningful part of
the game state. That gives development the same power shape as a classic engine
console or an ultimate mod menu: commands are the stable interface, while UI,
tools, and hotloops call into the same path.

## Architecture

```
cart/hmsc/
  index.tsx              composition root
  design.ts              JSON game-state contract
  state/gameState.ts     create/load/save/revive GameState
  commands/              parser + command registry
  world/grid.ts          grid storage helpers over continuous movement
  ui/Console.tsx         command terminal
  ui/MapCanvas.tsx       internal map on Canvas
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
