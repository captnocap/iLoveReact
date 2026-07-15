# Editor pen/mouse device awareness (Wacom tablet)

Active surface: `cart/editor/` (all surfaces). Last verified: 2026-07-15.
USER ASK req_3089.

## In one sentence

The host knows whether the mouse or the tablet pen is driving the cursor
(SDL3 tags pen-synthesized mouse events with `SDL_PEN_MOUSEID`), fires a
`system:pointerDevice` signal on the change edge, feeds real pen pressure
into every pointer event — and the editor uses it GIMP-style: each device
remembers the last tool it activated, so flipping from pen to mouse (or
back) restores that device's tool without a manual toggle.

## Why it exists

The user's ask (req_3089): "in gimp, it seems to clearly know when i am
using my mouse vs using my pen … i would likely never paint with a mouse,
but i also would likely never pull vertexes with a pen. like maybe its
possible to toggle between one to the other based on what is controlling
the mouse focus."

GIMP does this via per-device input events (XInput2/Wayland tablet
protocol through GDK) plus a per-device context: every event names its
source device, and a device change swaps in that device's saved tool. Our
SDL3 host gets the same raw fact for free — pen events are first-class
(`SDL_EVENT_PEN_*`), and SDL synthesizes normal mouse events from the pen
with `which == SDL_PEN_MOUSEID` — so the whole existing mouse pipeline
keeps working unchanged and one classification point records who is
speaking.

## Mechanism (host fn vs JS, file:line)

- `framework/state/mouse_state.zig` — `g_pointer_device`
  (enum mouse=0/pen=1), `g_pen_pressure` (0..1), and
  `updatePointerDevice(dev) → changed?` (the edge detector).
- `framework/engine.zig` — `notePointerDevice(which)` (defined next to the
  coalesced-drag globals) classifies `event.{motion,button}.which` at the
  top of the MOUSE_MOTION / MOUSE_BUTTON_DOWN / MOUSE_BUTTON_UP cases.
  New switch cases: `SDL_EVENT_PEN_PROXIMITY_IN` pre-switches to pen while
  the stylus merely hovers into tablet range (the tool is already right
  before first contact); `SDL_EVENT_PEN_DOWN/UP` also assert pen and zero
  the pressure on lift; `SDL_EVENT_PEN_AXIS` tracks the live
  `SDL_PEN_AXIS_PRESSURE` value. Pen → mouse event synthesis is SDL's
  default (`SDL_HINT_PEN_MOUSE_EVENTS` = "1"), so no pipeline changes.
- `framework/ifttt/system_signals.zig` — `notifyPointerDevice(dev)` evals
  `__ifttt_onSystemPointerDevice(dev)`; engine calls it on the change edge
  only.
- `framework/v8_bindings_core.zig` — host fns `getPointerDevice()` (0|1)
  and `getPenPressure()` (0..1), registered beside the getMouse* family.
- `runtime/index.tsx` `getPointerPayload` — every onMouseDown/Move/Up
  (and their onPointer* aliases) payload now carries
  `pointerType: 'pen' | 'mouse'` and, for the pen, REAL pressure (mouse
  keeps the old binary button-state pressure) — the web PointerEvent
  contract. `runtime/hooks/useBrushStroke.ts` already passed `e.pressure`
  into the stroke engine's `pressureRadius` curve
  (`runtime/paint/stroke.ts`), so brush dabs get true Wacom pressure with
  zero paint-kit changes.
- `runtime/hooks/useIFTTT.ts` — `__ifttt_onSystemPointerDevice` emits bus
  event `system:pointerDevice` `{ device: 'pen'|'mouse', at }`.
- `runtime/hooks/usePointerDevice.ts` — the public one-line cart surface:
  `usePointerDevice()` (re-renders on flip) + `getPointerDevice()`
  (instant read). Exported from `runtime/hooks/index.ts`.
- `cart/editor/shell/AppFrame.tsx` — the GIMP behavior. `runCommand`
  stamps `state.deviceTools[scope][device]` whenever a TOOL command
  (`command.tool`, scope world|model) is activated by a real source; a
  `busOn('system:pointerDevice')` subscription (next to `runCommandRef`)
  replays the incoming device's remembered tool for the surface in view
  with source `'device'`. `lastToolByScopeRef` dedupes so an unchanged
  tool never re-fires (re-dispatching toggle-style mesh tools would exit
  them); removed-command slots are guarded by `commandById`.
  `deviceTools` lives on `EditorState` (`data/types.ts`,
  `data/initialState.ts`) so it rides the existing persistView hot twig —
  per-device tools survive dev reloads, reset on cold start.

## Behavior contract

- Slots start empty; nothing auto-switches until a device has actually
  picked a tool (exactly GIMP: device configs populate as you use them).
- Setting a tool always writes the CURRENT device's slot — "unless I set
  it with my mouse" works because the mouse activation overwrites the
  mouse slot, never the pen's.
- Scope-keyed (world vs model) so a model-scope mesh tool can never fire
  on the world surface; material/playtest/animation surfaces are inert.
- Pen proximity (hover, no touch) already flips the device — by the time
  the stylus lands, its tool is active.

## Open / next

- Needs a framework rebuild to go live (`framework/` + bindings changed);
  hot reload alone won't carry it.
- Pen eraser end (`event.ptouch.eraser`) is not yet a distinct device
  slot — GIMP treats it as a third device; we currently fold it into pen.
- Tilt axes (`SDL_PEN_AXIS_XTILT/YTILT`) are available whenever a brush
  wants them; only pressure is tracked today.
