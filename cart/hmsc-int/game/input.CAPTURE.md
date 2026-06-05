# Capture note — game/input.ts (V7, capture wave 2026-06-04)

Key/pointer TRANSPORT only, completed to the ruled surface. V7: WASD-becomes-
velocity lives in the HOST — the one movement integrator is
`framework/game/movement.zig` (`integrateHorizontal`, called inside
`framework/game/physics.zig`'s step). JS keysRef is input transport only,
never the integrator. Nothing in this door takes a dt, owns a velocity, or
advances a position; the TRANSPORT-ONLY test pins it (stateless, |intent| ≤ 1,
no integrator vocabulary on the door).

## Sources (read, never moved/copied/imported)

| piece | old file | what it contained |
|---|---|---|
| the keysRef transport | `cart/hmsc/state/usePlayerDrive.ts` | busOn `__keydown`/`__keyup` → boolean map; `__shift` tracked from the FLAG, not key names |
| the control contract | `cart/hmsc/input/controlContract.ts` | action ids → inputs/label/playerIntent/availability — carried as the `INPUT_BINDINGS` table (P2) |
| the pointer rig | `cart/hmsc/gameplay/HmscGameplayRig.tsx` | `__mouse_delta` relative-mode look, `__mouse_capture`, `getMouseX/Y`, `getMouseRightDown` right-hold aim |
| the typing gate | `cart/hmsc-int/PaintCanvas.tsx` | `__tel_input.focused_id ≥ 0` → keys don't drive movement while typing; `system:blur` clears held keys |
| the wire vocabulary | `runtime/hooks/useIFTTT.ts` (live platform code) | `decodeKey` (mod<<32 \| sym, framework/key_pack.zig): space = `'space'`, modifiers = flags with useless raw names; `system:cursor:move` {x,y,dx,dy} |
| the direction formula | `framework/game/movement.zig` (`wasdDirection`) | the canonical camera-relative keys→direction math `moveIntent` twins (see ambiguity 1) |

## Verification

- `game/input.test.ts`: **15/15** P4 meaning-tests green under v8cli — held/release/
  dispose/blur-clear key transport, the bindings table (wire-true names, no
  arrows), `actionDown` (modifier-as-flag, the camera_lab hazard pinned),
  `moveAxes` axis packaging, `moveIntent` sign convention + diagonal
  normalization against the movement.zig spelling, the TRANSPORT-ONLY V7 fence,
  pointer honesty (availability naming, zero fallbacks, capture transport
  report), the cursor bus relay, the typing gate, the sealed door.
- `rjit game verify`: green (run after this capture; see commit).
- Metafile gate: `cart/hmsc-int/game/input.ts` added as a trigger on the
  `telemetry` registry entry — `isTextEditing` reads `__tel_input`, so a cart
  importing only the input door still compiles the binding in. The pointer fns
  (`getMouse*`, `__mouse_*`) are core bindings, registered unconditionally.

## Shape decisions

- **Bindings are data (P2)**: `INPUT_BINDINGS` carries hmsc's controlContract
  vocabulary (14 actions, implemented/reserved flags); `actionDown`/`moveAxes`
  walk the table instead of hardcoding keys. Reserved actions ship as data with
  no consumers — the contract names them so nobody re-invents the vocabulary.
- **`moveIntent` ships direction, not movement**: movement.zig's own header
  says the cart "ships a direction vector … down the packed physics input
  buffer once per frame", and the committed `GAME_PHYSICS.stepPhysics` wire
  takes already-rotated `intentX/intentZ` — so producing the direction vector
  is the transport's job. It is stateless math (no dt/speed/velocity).
- **Modifiers via flags**: run = `shiftKey`, never a key name — Shift arrives
  as `sdl:1073742049` (full SDLK_LSHIFT since key_pack.zig; was the truncated
  `sdl:225`) with a TRUE flag. The camera_lab hazard, honored in
  the table shape (`modifier:` is a separate field from `keys:`).
- **Blur clears held keys**: SDL never delivers the keyup after focus loss; a
  held snapshot would stick forever. The PaintCanvas blur-clear, now in
  `createKeyState` itself.
- **The honesty rule carried from telemetry.ts**: `availability()` names every
  missing pointer/typing-gate fn; reads fall back to zeros/false; 
  `setPointerCapture` returns whether the wire existed.

## Deliberately NOT carried

- **Any integrator** — `integrate(keys, yaw, speed, dt)` from input_bench's
  keys.ts is V7-banned in JS; `usePlayerDrive`'s inline intent×speed×dt
  position math stays in the reference. The host owns it.
- **The `isKeyDown` scancode poll** (usePlayerDrive's `hostScancodeDown`) —
  bus events carry everything the transport needs; the camera_lab "input split
  by intent" pattern (bus for keys) is the captured idiom. Scancode polling
  was usePlayerDrive belt-and-suspenders for the same Shift the flag carries.
- **React hooks** — the door stays react-free so it bundles/tests under
  v8cli; pointer capture lifecycle (capture-on-focus etc.) is rig/chrome work.
- **Click/tap routing** — Pressable pointer events on primitives remain the
  UI-side path (hit-testing is the framework's); this door carries only the
  game-loop-facing wire (deltas, buttons, capture).

## Ambiguities surfaced (not guessed)

1. **`moveIntent` is a deliberate JS twin of `movement.zig wasdDirection`.**
   The canonical formula is host-side but has NO V8 binding, and the committed
   physics wire takes the already-rotated intent — so the cart must rotate.
   One twin, in the transport door, fidelity-pinned by tests (sign convention
   + normalization), documented to retire if a binding ever ships. The
   alternative (every consumer re-rolls sin/cos) is the "three mirrored
   copies" hazard at scale.
2. **CLOSED (2026-06-04)** — ~~Arrow/function/nav keys are DEAD on the
   `__keydown` wire~~: engine.zig packed `sym & 0xFFFF`, truncating 0x4000xxxx
   SDLK codes into printable collisions (LEFT arrived as `'p'`, UP `'r'`,
   RIGHT `'o'`, DOWN `'q'`, F1 `':'`). Fixed exactly as proposed: the packing
   is now `mod<<32 | sym` (< 2^48, exact in the f64 crossing the V8 bridge),
   owned by `framework/key_pack.zig` and shared by engine.zig (producer),
   `ifttt/ifttt.zig` and `useIFTTT.ts decodeKey` (decoders; JS decodes with
   arithmetic div/mod, never 32-bit bitwise). `SDL_KEY_NAMES` arrow/fn/nav
   entries are live — arrows arrive as `'left'`/`'right'`/`'up'`/`'down'`;
   standalone modifiers keep useless names (now full-width, e.g. Shift
   `sdl:1073742049`, was `sdl:225`) with TRUE flags, and no consumer matched
   the truncated spellings (combat_lab's full-width SHIFT_KEYS match came
   ALIVE with the fix). Pinned by `zig build test-key-pack` (P4, 5 tests:
   arrows distinct from printables, modifier isolation, f64 exactness,
   printables byte-identical to the old packing). The bindings table stays
   WASD-only because the CONTRACT is WASD — no longer because the wire eats
   arrows.
3. **The typing gate rides a telemetry binding** (`__tel_input`) — input
   gating crosses doors at the wire level. Honest when absent, and the
   registry trigger compiles it in, but the coupling should be known.
4. **`primaryAimedAction` vs `primaryLightAction`** both ride pointer-left and
   are disambiguated by aim state — a CONSUMER decision (the contract says
   "while aiming"/"while not aiming"); the table carries both rows verbatim.
