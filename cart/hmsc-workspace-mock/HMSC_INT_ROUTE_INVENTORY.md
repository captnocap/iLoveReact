# HMSC-INT Route Inventory

Generated: 2026-06-30

Purpose: paper-trail the current `cart/hmsc-int` route surface before the new editor workspace absorbs and consolidates capabilities. This inventory separates mounted URL routes from route-like memory keys, session ids, and retired paths.

## Source Of Truth

- Router root: `cart/hmsc-int/index.tsx`
- Persistent chrome destinations: `cart/hmsc-int/shell/chrome.tsx`
- Workbench source registry: `cart/hmsc-int/editors/workbench/sources.ts`
- Labs registry: `cart/hmsc-int/labs/index.ts`

There is only one actual React router mount in `hmsc-int`: `Router hotKey="hmsc-int:route" initialPath="/"` in `index.tsx`.

## Target Route Contract

User direction, 2026-06-30:

- The future editor has two top-level routes only: `/editor` and `/play`.
- `/editor` is the unified workspace for world authoring, asset authoring, material work, imported files, searchable declarations, editor settings, event/history review, request/build history, and every native tool surface.
- `/play` is the runtime/preview route: the game loop, compiled/baked data validation, live feel checks, and anything that proves the authored data behaves correctly.
- Code-authored modeling UI is going away as a product shape. The useful capability stays: declaring items, searchable props, metadata, material/shader authoring, asset configuration, generation workflows, and editor tools all become one native Zig tooling system.
- Tooling should not remain split by legacy React route boundaries. Old routes and workbench sources are capability inventories, not final navigation.
- Missing capability should extend native tooling/engine systems, not create another route-specific authoring silo.
- Every feature that enters `/editor` or `/play` must include built-in timing
  recordings and debug signals. Instrumentation is first-class and permanent:
  no one-off debug tooling, no temporary log passes, and no waiting through
  rebuilds just to rediscover where a system is slow or broken.
- All debug/log output must flow through a shared diagnostics registry. That
  registry feeds settings-menu toggles and a z-indexed in-app raw console with a
  copyable feed. Stdout/file logs can exist as sinks, but the editor cannot rely
  on them as the primary way to inspect debug output.
- The raw console must be able to record diagnostic captures and attach them to
  ongoing bug/build threads tied to incrementing build versions, preserving the
  channels, filters, time range, build id, request id, and workspace context.
- Bug/build threads must support user-authored semantic names and aliases, so a
  future recurrence can be found by a memorable name and attached back to the
  same ongoing history even across sessions.

## Active Routes

| Path | Current surface | Source | Consolidation read |
| --- | --- | --- | --- |
| `/` | Dashboard / lightweight home. Boots fast and opens before the heavy editor panes. | `DashboardRoute` via conditional render in `index.tsx`; component in `shell/DashboardRoute.tsx` | Fold into `/editor` as startup/home state without loading heavy world systems before the window opens. |
| `/editor` | Main world editor: 2D paint map, 3D build map, right rail, catalog rail, properties, compile toggles. | Conditional `EditorLayout` render in `index.tsx` | Becomes the only authoring route. All workbench/tooling/lab-authoring capabilities should resolve into this workspace. |
| `/labs` | Lab collection with persistent selected lab state. | `<Route path="/labs">` in `index.tsx`; component in `shell/LabsRoute.tsx` | Remove as a top-level product route. Keep lab capability as a developer/tooling mode inside `/editor` if still useful. |
| `/workbench` | Four-gutter workbench that multiplexes most old asset/settings tools through registered sources. | `<Route path="/workbench">` in `index.tsx`; component in `shell/WorkbenchRoute.tsx`; frame in `shell/Workbench.tsx` | Absorb into `/editor` as capability panels, file/menu entries, focused tool modes, and bottom-dock popovers. |
| `/assist3d` | Assistant-authored 3D surface. | `<Route path="/assist3d">` in `index.tsx`; component in `assist3d/Assist3DRoute.tsx` | Absorb into `/editor` as an assistant/tooling context. |
| `/compiled` | Native compiled-world preview. | `<Route path="/compiled">` in `index.tsx`; component in `CompiledWorld.tsx` | Becomes `/play`, or a `/play` popout/preview surface. |

## Chrome Destinations

The chrome shows seven buttons, but they resolve to six URL paths:

| Chrome button | URL | Notes |
| --- | --- | --- |
| Dashboard | `/` | Brand/home button also points here. |
| Editor | `/editor` | Heavy editor panes gated behind this path. |
| Labs | `/labs` | Lab registry route. |
| Assets | `/workbench` | Opens the workbench on the last/asset-family source. |
| Settings | `/workbench` | Opens the same route, but first requests the `settings` source. |
| Assist3D | `/assist3d` | Assistant route. |
| Compiled world | `/compiled` | Native preview route. |

`/workbench` reports an active family back to chrome:

- `assets`: all authoring sources except settings/logs/requests
- `settings`: `settings`, `logs`, and `requests`

## Workbench Sources

These are not URL routes. They are source ids inside `/workbench`.

| Source id | Kicker | Family | Current role |
| --- | --- | --- | --- |
| `character` | `CHARACTERS` | assets | Character mesh/sculpt/paint context. Old `/characters` route is dead. |
| `garment` | `CLOTHING` | assets | Clothing authority and variant grid. |
| `animation` | `ANIMATION` | assets | Rig/posing/animation commands. |
| `paint` | `PAINT` | assets | Agnostic painting surface. Old `/cutout` route is dead. |
| `model` | `STUDIO` | assets | Blockbench-class part-mesh editor / studio viewport. |
| `item` | `ITEMS` | assets | Item source plus voxel sculpt mode. Old `/items` and `/voxels` routes are dead. |
| `vehicle` | `VEHICLES` | assets | Vehicle source. Old `/vehicles` route is dead. |
| `materials` | `MATERIALS` | assets | Material/shader library, texture/compose/materialize. Old `/textures` and `/compose` routes are dead. |
| `building` | `BUILDINGS` | assets | Prefab building skins, per-piece/per-face material overrides, structure edits. |
| `settings` | `SETTINGS` | settings | Settings domains and tunable rigs. Old `/settings` route is dead. |
| `logs` | `LOGS` | settings | Churn tail and session event bus. Old `/log` route is dead. |
| `requests` | `REQUESTS` | settings | Request ledger board. Should be redesigned into build-number/history dock concept. |
| `story` | `STORYLINE` | assets | Storyline authoring board over missions/story gates. |

## Labs

The active `/labs` registry currently contains:

| Lab | Notes file |
| --- | --- |
| `vehicle-handling` | `cart/hmsc-int/labs/vehicle-handling.notes.md` |
| `player-stats` | `cart/hmsc-int/labs/player-stats.notes.md` |
| `combat-arena` | `cart/hmsc-int/labs/combat-arena.notes.md` |
| `explosives` | `cart/hmsc-int/labs/explosives.notes.md` |

## Hidden Or Debug Paths

| Path | Status | Notes |
| --- | --- | --- |
| `/__rebuild-notify` | Hidden/debug trigger | Not a mounted route. `NotificationOverlayHost` checks `route.path === '/__rebuild-notify'` to simulate the rebuild notice. |

## Route-Like Keys That Are Not Active Routes

These appear in code as twig keys, session ids, camera ids, tests, old comments, or compatibility names. They should not be counted as mounted routes in the new editor plan.

| Key/path | Current meaning |
| --- | --- |
| `/characters` | Workbench character store/stage twig/session compatibility. Old route is dead. |
| `/vehicles` | Vehicle twig/session compatibility and tests. Old route is dead. |
| `/cutout` | Cutout/model-paint tunable and inspector twig compatibility. Old route is dead. |
| `/textures` | Materials store legacy key. Old route is dead. |
| `/compose` | Materials/compose legacy key. Old route is dead. |
| `/settings` | Settings session/tunable legacy key. Old route is dead. |
| `/log` | Old churn/log route referenced in comments/tests. Dead in favor of workbench `logs`. |
| `/items` | Dead in favor of workbench `item`. |
| `/voxels` | Dead in favor of workbench `item` voxel sculpt mode. |
| `/build` | Session/test/twig key, not a mounted route. Build/editor work now lives under `/editor`. |
| `/test` | React embodied play view was cut; `/compiled` is the play/preview target. |
| `/objects-tab` | Internal twig key for `ObjectsTab`, not a route. |
| `/iso-build` | Legacy menu-position twig key in `CatalogRail`, not a route. |
| `/studio` | Studio model internal route key, not a mounted URL route. |
| `/model` | Studio viewport/tunable key, not a mounted URL route. |
| `/garment` | Clothing stage/store twig key, not a mounted URL route. |
| `/animation` | Camera route id used by animation stage, not a mounted URL route. |
| `/workbench/items` | Item/voxel stage/store twig and session key under the workbench, not a separate route. |
| `/workbench/materials` | Materials store twig key under the workbench, not a separate route. |
| `/workbench/story` | Story store twig key under the workbench, not a separate route. |

## Initial Consolidation Notes

- Treat `/editor` as the authoring workspace nucleus and `/play` as the runtime validation route.
- Treat `/workbench` as a capability registry, not as the final UX shape. Its source ids are valuable because they name existing capability domains.
- Keep all capabilities reachable by text from the top file/menu system. Icons can mirror and accelerate, but should not be the source of truth.
- Preserve relevant route memory, but move it to context-aware workspace memory. The user should not lose selected material/tool/menu state when switching focus.
- Separate navigation from persistence keys. Many old paths are valuable as migration keys, but they should not become new visible routes by accident.
- The request system should leave the full-route workbench board and become part of the bottom dock/build-number/history architecture.
- Labs should remain accessible for development, but should not shape the production editor layout unless a lab graduates into a capability.
- Code-authored modeling routes should not survive as UI shape. The capability underneath should be rebuilt as native Zig editor tooling that can be invoked from `/editor`.
