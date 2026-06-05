# Capture note — game/chrome/ (CHROME, 2026-06-05)

The lab chrome kit and lab environment, rewritten fresh under
`cart/hmsc-int/game/chrome/`. Old carts are behavior references only: no moves,
imports, or copied implementations.

## Sources read in dispatch/addendum order

| source | what it contained | captured as |
|---|---|---|
| `cart/carve_lab.tsx` | dark left/top overlay panel; grid choice chips; `Knob` label/minus/value/plus row; carved-scene studio lights; thin-box ground | `Panel`, `Chip`, `Knob`, `CHROME_KNOB_PRESETS['carve.*']`, `studio` environment |
| `cart/physics_lab.tsx` | top panel band; active/inactive buttons; compact `Meter` label/value blocks; wrapping telemetry row; skybox + ambient/directional + two point lights; grid/floor slab | `Chip` button behavior, `Meter`, `resolvePanelLayout`, `arena` environment |
| `cart/skybox_demo.tsx` | analytic sky model from `hour/weather/gloom`; day keyframes; sun arc; synced ambient/directional light; thin-box ground; skybox caveats | `LAB_SKY_TUNING`, `buildLabSky`, `day-cycle` environment |
| `cart/hmsc/render3d/sky.ts` | HMSC sky names (`midnight/dawn/noon/dusk`, `clear/hazy/cloudy/storm`); clamped inputs; adjusted ambient/light intensities; host-contrast softening; background-color fallback note | named-hour/weather tables, clamped sky resolver, HMSC preset names |
| `cart/planet_run/index.tsx` | night skybox, fog disabled, ambient/directional/point light rig, HUD pills | `night` environment, `hudPill` layout tokens |

Out-of-scope carts explicitly ignored per addendum: `audio_controls_test`,
`pocket_operator`, `ai_edit_loop_lab`, and `testing_carts`.

## Captured kit inventory

- **Data tables**: `CHROME_TOKENS`, `CHROME_LAYOUT`, `CHROME_KNOB_PRESETS`,
  `LAB_SKY_TUNING`, `LAB_ENVIRONMENT_PRESETS`.
- **Components**: `Chip`, `Knob`, `Meter`, `MeterRow`, `Panel`,
  `LabEnvironment`.
- **Pure behavior surfaces**: `resolveKnobValue`, `formatKnobValue`,
  `resolveMeter`, `resolvePanelLayout`, `buildLabSky`,
  `resolveLabEnvironment`, `mixHex`.
- **Environment presets**: `studio`, `arena`, `day-cycle`, `hmsc-clear`,
  `hmsc-hazy`, `hmsc-cloudy`, `hmsc-storm`, `night`.

## Deliberately not carried

- **Per-cart ingest/gameplay logic** from `carve_lab`, `physics_lab`,
  `skybox_demo`, and `planet_run`: file drops, physics stepping, game loops,
  planet math, props, coins, and model catalogs belong to their own systems or
  labs, not shared chrome.
- **Photographic/HDRI cubemap, reflections, volumetric clouds**: `skybox_demo`
  documents these as unsupported by the host skybox path.
- **A separate `Btn` component name**: `Chip` is the shared pressable choice
  surface; physics/skybox buttons collapse into that one kit component.
- **Per-lab-named environment APIs**: presets are generic scene-dressing modes
  (`studio`, `arena`, `day-cycle`, `night`, HMSC weather), not imports from or
  special cases for old carts.
- **Host sky background fallback**: `hmsc/render3d/sky.ts` notes a near-black
  host skybox behavior and exports `hmscSkyBackgroundColor`. This capture keeps
  the skybox/lights resolver because the ground-floor task is explicitly the
  lab environment fragment; the fallback remains surfaced below.

## Ambiguities surfaced

1. **Host skybox quality vs fallback**: `hmsc/render3d/sky.ts` says the HMSC
   cart currently paints a flat background because the host skybox renders
   near-black with a horizon line. The lab-environment contract still exposes
   `<Scene3D.Skybox>` because `skybox_demo` and the dispatch name skybox/lights.
   If the flat background is the new canonical HMSC game path, that should be
   ruled separately.
2. **Preset taxonomy**: the capture carries generic presets plus HMSC weather
   names. The exact editor/tuning UI for choosing presets is not settled here.
3. **Panel placement**: references use both top bars and absolute overlay
   panels. This capture centralizes dimensions/layout math, but does not impose
   a route-level placement policy on labs.
4. **Ground material ownership**: environment presets include the thin-box
   ground because all references use scene dressing/floor slabs. Tile/material
   ownership for real game worlds remains with the texture/static-surface and
   world-render captures.

## Verification

- `game/chrome/chrome.test.ts` pins knob clamping, meter mapping, panel layout
  math, sky normalization, and environment preset resolution under `tools/v8cli`.
- `game/index.test.ts` registers `GAME_CHROME` as live and asserts the exported
  interface.
