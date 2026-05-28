# AGENTS.md - scape3d

`cart/scape3d` is the real game cart. Treat nearby demo carts and older `scape`
history as reference material, not as the product target.

Read these before changing game code:

1. Root `AGENTS.md` for runtime and repo discipline.
2. `GAME_RULE_OF_THUMB.md` for the game-building rule.
3. `TONE.md` for the creative register.
4. `PROGRESS.md` for current engine/game facts and handoff notes.
5. `design.ts` for the mechanical contract.

## Prime Rule

Build readable systemic trouble, not isolated demos.

A change belongs here when it creates or sharpens a reusable game noun, rule, or
signal that can participate in multiple systems: high state, heat, money, NPCs,
phone/internet, evidence, inventory, terrain, doors, interiors, items, or world
objects. One small honest loop that survives contact with the rest of the game is
worth more than a flashy standalone feature.

## Code Shape

- Keep `index.tsx` a composition root. Game logic belongs in `state/`, `systems/`,
  `world/`, `render3d/`, `registries/`, `thingymajiggers/`, or `ui/`.
- Prefer existing module homes and contracts over new categories.
- Do not add browser APIs. This cart runs on the ReactJIT primitives and host
  functions from the root docs.
- Do not add Lua or a second scripting path for dynamism. Use TypeScript data,
  Zig tagged unions, or maps as appropriate to the layer.
- Names must carry the information needed at their scope. If a future reader must
  remember what `tmp`, `v2`, `manager`, or `4` means, rename or extract it.

## Naming Bias

The game should read through its names. A domain name that is specific and a
little memorable is better than a generic name that could belong anywhere.

- No magic numbers. Name the reason for the value, not the value itself.
- No version-number identifiers. Name the real distinction.
- Avoid `Manager`, `Handler`, `Helper`, `Util`, `Service`, `Controller`, and
  `Processor`.
- Do not type-encode names. The type system already knows the type.
- Keep category prefixes coherent when a concept crosses files: `HIGH_`, `HEAT_`,
  `ITEM_`, `NPC_`, `PLAYER_`, `WORLD_` are useful when they prevent samey names.
- Comments explain historical context, external constraints, or consequences.
  They are not substitutes for names.

