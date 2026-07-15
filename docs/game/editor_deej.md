# Editor deej faders (physical brush controls)

Active surface: `cart/editor/` paint contexts. Last verified: 2026-07-15.
USER ASK req_3085.

## In one sentence

A homemade deej fader board (Arduino printing `|`-separated 10-bit values
over USB serial) drives the live brush while painting — fader 1 = brush
size, fader 2 = flow — and because the host only speaks when a fader
PHYSICALLY moves, the on-screen sliders stay fully authoritative whenever
the board is idle, unplugged, or was never built.

## Why it exists

The user's ask (req_3085): "i have this 5 slider deej homemade thing and im
wondering how, if at all, could we map it to something like brush sizes
inside of the editor... because it is not a digital dial and is physical, i
would have to behave in a way where it can fall back to not being enforced
through the interface obviously."

The fallback IS the design. Physical faders can't be motorized, so the
board and the UI will always disagree at rest; the only sane contract is
one-way, movement-only: a fader writes its value only when it crosses the
ADC jitter threshold against the last value it emitted. The first line
after a connect is adopted silently as the baseline, so plugging the board
in never yanks the brush to wherever the faders happen to rest.

## Mechanism (host fn vs JS, file:line)

- `framework/deej.zig` — the host system. Plain POSIX serial (no ALSA, no
  MIDI, no native libs): opens the port read-only non-blocking, raw 8N1 at
  9600 (the stock deej sketch rate; start() accepts overrides), drains
  complete lines on poll(), queues a move event per fader whose raw delta
  beats `JITTER_RAW` (4/1023) vs the last EMITTED value — slow creep
  accumulates, endpoint touches (0/1023) always land. Port resolution:
  explicit start() arg > `RJIT_DEEJ_PORT` env > autodetect scan of
  /dev/ttyACM0-3 then /dev/ttyUSB0-3 (tcgetattr doubles as the is-a-tty
  probe). Unplug = read error → disconnected → rescan ~1s until it's back.
  Six unit tests pin the parser (baseline, jitter, creep, endpoints,
  garbage/partial lines, no-device degrade): `zig test framework/deej.zig`.
- `framework/v8_bindings_deej.zig` — `__deej_start(port?, baud?)`,
  `__deej_stop`, `__deej_is_available`, `__deej_poll`, `__deej_state_json`
  (connected/port/count/values), `__deej_next_event_json`
  ({slider, value 0..1}). Ingredient `deej` in `framework/v8_ingredients.zig`
  (grep prefix `__deej_`), gated by `-Dhas-deej` (build.zig), flipped
  source-driven by importing `runtime/hooks/useDeej.ts`
  (sdk/dependency-registry.json trigger — same door pattern as usePaintable).
- `runtime/hooks/useDeej.ts` — the public cart surface: `useDeej()` →
  {available, connected, port, values, subscribe}. Module-level 33ms drain
  timer + `subscribeDeej(fn)` for register-once consumers.
- `cart/editor/shell/AppFrame.tsx` — the editor mapping. `useDeej()` +
  one `subscribeDeej` registration into `deejApplyRef` (~line 1078); the
  ref is re-pointed each render next to `setActivePaintBrush` (~line 4505)
  where the active paint context is known: fader 0 → brush.size (same
  1..128 range as the PaintToolbar slider), fader 1 → brush.flow
  (0.02..1). Gated on `paintUiActive` — outside a paint surface the board
  is inert. Both facade paint and model paint get it for free because the
  mapping goes through `setActivePaintBrush`.

## Fallback / degrade matrix

- Capability not compiled (cart never imports useDeej): `hasHost` false,
  hook reports available:false. Zero cost.
- Compiled, no board: start() succeeds (capability live), connected:false,
  zero events, reopen scan ~1s in the 33ms drain. UI untouched.
- Board present, faders at rest: baseline adopted silently, zero events.
- Board yanked mid-session: read error → disconnected → auto-reconnect
  when replugged, new silent baseline.

## Verified

- `zig test framework/deej.zig` — 6/6.
- Live pty harness (fake board printing 5-fader lines at 100Hz, one fader
  wiggling): connected:true, 101 move events from fader 0, ZERO events
  from the four idle faders, state JSON exact.
- `rjit shot editor` PASS both with no device and with a fake board on
  `RJIT_DEEJ_PORT` (degrade + connect paths, no crash).
- `SHIP_RUN_PACKAGE=0 rjit ship editor` — `-Dhas-deej=true` flips on from
  the AppFrame import alone; label check passes.

## Open / next

- Faders 3-5 are unmapped. Candidates when the user asks: brush hardness,
  scatter, sticker stamp scale, world-paint density.
- Permissions: reading /dev/ttyACM* needs the user in the `dialout` group
  (`sudo usermod -aG dialout $USER`, relogin) or a udev rule.
- If the deej desktop volume app is running it consumes the same serial
  stream (serial is single-consumer — two readers steal bytes from each
  other); run one or the other.
