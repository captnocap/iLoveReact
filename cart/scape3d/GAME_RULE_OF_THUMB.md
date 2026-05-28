# Scape3D - Game Rule Of Thumb

## The Rule

Make every addition a readable piece of the same trouble machine.

This game is not a pile of demos anymore. It is a systemic crime-life sandbox
where small actions become large because the world is unstable: the high lies to
you, witnesses remember, money pressures decisions, the phone keeps screaming,
NPCs react, interiors hide things, and consequences stay funny, grimy, and
pathetic.

Before building a feature, ask:

- What game noun does this introduce or sharpen?
- Which existing systems can feel it?
- What pressure, lie, cost, or consequence does it create?
- Can it be tested as a tiny loop without becoming throwaway demo code?
- Will its names still make sense when read cold next month?

If the answer is mostly "it looks cool in isolation," stop and route it through a
real system.

## The Product Bias

Prefer:

- Small loops that touch multiple systems.
- Reusable entities, actions, registries, and state signals.
- Consequences that survive after the animation ends.
- Boring errands made huge by high, heat, money, or paranoia.
- Names that make the gameplay idea obvious at the call site.

Resist:

- One-off spectacle with no state behind it.
- UI that explains a mechanic instead of letting the mechanic show up in play.
- Generic framework categories that hide the game noun.
- Parallel demo implementations beside the real one.
- Clean neon with no grime, risk, or joke underneath.

## Readable Code Is Part Of The Game Design

Names are the memory layer for humans and future agents. A name should carry the
information needed at the place it is read.

Short names are fine in tiny scopes or math (`x`, `z`, `dt`, `i`). Broad names,
exported names, registry keys, action ids, and tuning constants need to explain
their role in the game.

Bad names make systems look unrelated. Good names make the game legible:

```ts
const MAX = 6;
const HIGH_WOBBLE = 0.35;
const thing = target.cache;
function process(data) {}
```

Better:

```ts
const MAX_WANTED_STARS = 6;
const HIGH_CAMERA_SWAY_INTENSITY = 0.35;
const floorboardStash = target.cache;
function resolveWitnessedGunshot(gunshot) {}
```

The value shows what the value is. The name should explain why the value exists.

## Module Law

Put code where the domain says it belongs:

- `world/` is pure world math, baked entities, terrain, pathing, and picking.
- `systems/` is game logic that can be tested without rendering.
- `state/` owns runtime state and mutators.
- `registries/` owns authored catalogs.
- `thingymajiggers/` owns placed world-object modules.
- `render3d/` turns game state and baked world data into meshes.
- `ui/` is screen-space interface, not world simulation.
- `index.tsx` composes; it does not become the game.

When a concept does not fit, define the noun first. Do not hide uncertainty behind
`Manager`, `Helper`, `Util`, or `V2`.

