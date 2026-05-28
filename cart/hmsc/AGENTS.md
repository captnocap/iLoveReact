# AGENTS.md - HMSC

HMSC is the new game cart for Hitman Shitcity. This cart starts from the command
surface, not from spectacle.

Read before changing code:

1. Root `AGENTS.md` for runtime and repo discipline.
2. `README.md` for this cart's architecture.
3. `design.ts` for the serializable game-state contract.

## Prime Rule

Every game mutation is a command.

The console is not a debug afterthought. It is the first-class surface for
building, testing, and later modding the game: teleport, spawn, place, remove,
set player values, jump scene steps, save, load, and inspect state. UI buttons
can call commands later; they should not create a second mutation path.

## State Rule

The game lives in one JSON-serializable `GameState`. Hot reload and autosave are
the same idea: persist the current state, reload code, revive state, keep working.

Grid cells store construction. Continuous coordinates store movement.

- Grid: chunks, tiles, authored placement, serialization, console addresses.
- Continuous: player position, entity position, smooth locomotion.
