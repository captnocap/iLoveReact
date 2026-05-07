# App

Living index of every file under `cart/app/` — what each one is, how it's wired, and what's still pending. Format is per-file: a status word (Stub / WIP / Complete) + a checklist. "Complete" means *complete for what it is meant to do today*, not "feature-complete forever". Line numbers are best-effort and drift quickly; treat them as hints, not contracts.

The app is a router-driven cart with a **three-state shell** — see **Animation principles → Input-strip shell morph (GOLDEN)** for the canonical description. Top window chrome (titlebar + nav + window controls) plus a persistent supervisor `<InputStrip>` that morphs between two slots (full-width bottom bar / docked side panel) based on `(routeMode, inputFocal)`. Routes currently register at `/`, `/settings`, `/settings/customize`, `/activity/sweatshop`, `/composer`, `/character`, and `/gallery`; each declares or derives `mode: 'full' | 'side'` metadata. An `OnboardingProvider` wraps the route tree.

Two parallel state mechanisms drive the shell:
- **IFTTT bus** (`app:navigate`) — input-strip token submissions fire here so every future input tier (@-token catalog, router model, supervisor session) hits the same handler the router subscribes to. Bus events are for *intents* that other components might want to observe.
- **Module-level stores** — `cart/app/shell.tsx` (`useInputFocal()` / `setInputFocal()`) and the runtime variant store. Activities call these directly when the state is genuinely shared across components, not an event.

**All theme-touching styling lives in `cart/app/gallery/components.cls.ts`** — every surface in cart/app is a classifier (`<S.AppChrome>`, `<S.AppHello>`, gallery menu atoms, etc.). There is no `theme.js` shim; if you find yourself reaching for `tokenColor` or hex literals, add a classifier in `components.cls.ts` instead. Active/inactive variants are separate classifiers (e.g. `AppNavLink` / `AppNavLinkActive`); the JSX picks one. Dynamic per-render values (animation opacity, slide marginTop, fixed home-menu stage size) flow as inline `style={{...}}` overrides — `mergeUserProps` in `runtime/classifier.tsx` merges user style over the classifier's resolved style.

**Runtime theme reassignment is token-level, not component-level.** `/settings/customize` edits color token overrides for the active component-gallery theme. The override layer lives in `cart/app/gallery/gallery-theme.ts`: it reads/writes the JSON map at localstore key `component-gallery-theme-token-overrides`, applies overrides after flattening the active theme's token categories, then calls `setTokens(...)` so all `theme:NAME` classifier references update during runtime. This is the only sanctioned place for user-entered color strings; component code still uses `theme:` tokens and classifiers.

---

## Animation principles

Three transition shapes, picked by the *origin* of the element being animated. Validated 2026-05-01 across two labs: `cart/input_lab/` (tween / spring / fade on the persistent `<InputStrip>` moving between focal / side / docked layouts) and `cart/list_lab/` (list building, box wipe, border trace, SVG path trace).

- **Tween** — for elements **already rendered in view** moving to a new placement. `easeInOutCubic` lerp on position + size. Reads as "the same thing went over there." Use for: layout reflow, mode switches, the InputStrip migrating between focal / side / docked, anything where identity continuity matters.
- **Spring** — for elements **newly entering view**. `easeOutBack` overshoot. Reads as "this just arrived." Use for: notifications sliding in, popovers opening, a card mounting for the first time. Do NOT use for elements that were already on screen — the overshoot makes a moving element look unstable.
- **Fade** — for **nested / transitionary** content. Cross-dissolve, no translate. Reads as "the surface changed underneath you." Use for: startup splash → app, route content swaps inside a stable shell, body changes inside a card whose chrome stays put.

Rule of thumb when in doubt: was the element on screen one frame ago? Tween. Did it just appear from nowhere? Spring. Is it the *contents* of a container that itself isn't moving? Fade.

### List building (validated in `cart/list_lab/` "list" scene)

- **Adding items** — each new item SPRINGS in: opacity 0→1 + small `translateY` offset eased by `easeOutBack`. Stagger by index when adding multiple at once (default 60ms between items) so a batch reads as a *ripple*, not a pop. Per-item entry duration ~380ms.
- **Reordering** — items already on screen TWEEN to their new y. Snapshot each item's last rendered y on every render keyed by id; on the next render, if the target y differs, animate from the snapshot (FLIP-style). Same `easeInOutCubic` as everything else. Duration ~400ms.
- **Removing items** — opacity + scale shrink (`easeOutCubic`, 240ms), then GC the row from state. No spring on exit. Removing items must NOT shift the surviving items abruptly — the reorder tween handles the gap-close smoothly.
- **Layout strategy** — render items into an `overflow: hidden` container with `position: absolute` per row, computing each row's target `top` from its index in the alive set. Reorder tweening only works when items have stable ids that aren't reused across mount/unmount.

### Drawing an element outwards

Pick the technique by the *shape* of the thing being revealed:

- **Card / box borders (preferred — adopt this everywhere it fits)** — animated dashed border via `borderDashOn` / `borderDashOff` / `borderDashWidth` (any Box accepts these — `framework/border_dash.zig` walks a flattened rounded-rect perimeter). Two modes:
  - **One-shot border trace** — animate `borderDashOn` from 0 to the rect's perimeter and `borderDashOff` from perimeter to 0; a single dash extends around the corners. **Use this as the hover effect for list items, menu rows, and any pressable surface** — the trace fires on pointer-enter and reverses on leave. Cheap, doesn't re-render the element body, and reads as "this thing is now selectable."
  - **Continuous marching flow** — static dash pattern + `borderFlowSpeed: <px/sec>` (negative reverses). **Use this for activity / attention-grabbing states** — a card processing in the background, an unread item, a primary CTA waiting for input. This is the GenericCardShell pattern (`cart/app/gallery/components/generic-card/GenericCardShell.tsx`).
  - Both demoed in `cart/list_lab/` "border" scene.
- **SVG paths** (icons, signatures, diagrams, charts) — reactive `d` recomputation. Compute the path's total arc length, then per frame emit a `d` string truncated to `t * arcLength` and let `<Graph.Path d={...}>` re-render. Mount `<Graph>` with `originTopLeft` so coordinates anchor at the container's top-left rather than centered. Demoed in `cart/list_lab/` "trace" scene. The framework has `svg_path.zig:drawStrokePartial` implemented but not yet wired to a JS prop — when a `drawProgress: 0..1` prop lands on `<Canvas.Path>` / `<Graph.Path>` this collapses to a single-prop API.
- **Continuous stroke flow on a path** — `flowSpeed: <px/sec>` on `<Canvas.Path>`. Glow pulses slide along the stroke. Use for "this path is alive / signaling," not for one-shot reveals.
- **Block elements via width+height wipe** — `overflow: hidden` container animating from 0×0 to full size with the inner content laid out at full size from the start. Demoed in `cart/list_lab/` "wipe" scene but **avoid for now** — feels heavier than it looks on paper, and the border trace covers most of the cases this would have been used for. Revisit if a real need surfaces.

Picking between these: if the surface has a border, prefer the border-dash trace — cheaper and reads better than wiping the whole body. If it's a vector graphic, use the SVG path trace. `flowSpeed` and `borderFlowSpeed` continuous flows are for *state*, not entry — use them once the element has finished revealing.

### Slot-stable menu transition

When swapping the *content* of a fixed list (menu A → menu B), don't tear down the rows and rebuild — keep the slot positions stable and animate the *text inside each slot*. Per slot, erase the old label left-to-right while the new label scans in from the same direction; render a hybrid string per frame where character indices to the left of the scan head come from the new label and indices to the right come from the old. Stagger by row index so the wipe cascades top-to-bottom as a wave. Use `theme:fontMono` for the labels — proportional fonts make the row jiggle as letters with different widths flow through.

Count differences are handled at the trailing edge: if the new menu has more rows, the extras enter via the standard list-entry spring; if fewer, the trailing rows exit via the standard list shrink-and-fade. The middle (slots present in both menus) does the text-scan in lockstep. Mid-transition reversals snapshot each slot's currently-visible hybrid string as the new `from`. Demoed in `cart/list_lab/` "menu" scene.

### Input-strip shell morph (GOLDEN — `cart/app/index.tsx`, commits 3bad2f07d → present)

Three resolved shell states. The persistent `<InputStrip>` morphs between them via three coordinated tweens + a variant flip that swaps the input's React placement at the right moment.

| state | description | sideMorph | inputMorph | bottomMorph | input slot | variant |
|-------|-------------|-----------|------------|-------------|-----------|---------|
| **A** home | route=full | 0 | 0 | 0 | BottomInputBar | null |
| **B** activity-docked | route=side, focal=false | 1 | 1 | 1 | SideMenuInput | 'side' |
| **C** activity-focal | route=side, focal=true  | 1 | 0 | 0 | BottomInputBar | null |

**Two driver axes** — both feed `deriveHeadingTo(routeMode, focal)`:
- **Route** declares `mode: 'full' | 'side'` per entry in the `ROUTES` table. Same-mode navigations (e.g., between two activity routes) keep `headingTo` constant — the morph effect doesn't fire, only the page-area content swaps.
- **Focus** is a global flag in `cart/app/shell.tsx` (`useInputFocal()` / `setInputFocal()`). Activities call `setInputFocal(true)` to take the input into focal mode; `setInputFocal(false)` to release. Focal state PERSISTS across route changes — only the activity that took focus knows when it's done. Going home and back to the same activity preserves the focal state.

**Three independent morphs**, each a snapshot RAF tween that survives mid-flight reversals:
- `inputMorph` — paddingRight on `AppBottomInputBar`, shrinks/grows the input within the full-width bar.
- `sideMorph` — width on `AppSideMenuInput` (absolute overlay, left edge), grows/shrinks the docked panel.
- `bottomMorph` — paddingBottom on the routes wrapper, drives the smooth page-extends-down / page-retracts step.

**Pivoting on variant** — the useEffect on `[headingTo]` looks at whether the variant needs to flip and which direction:
- **TO PANEL** (variant `null` → `'side'`): morph "shrink" first (`inputMorph` + `sideMorph` in parallel), then variant flip on input completion, then `bottomMorph`. Input is visibly the dominant animation; sequencing matters because the user expects to see the input shrink before the page extends.
- **TO BAR** (variant `'side'` → `null`): variant flip + ALL morphs in PARALLEL. No sequencing — sequencing the bottom morph first (page retract) before the input expand introduced a perceived 600ms delay before the input animated, because the page-retract step is too subtle to register. BottomInputBar's `theme:bg` covers the bottom strip while the page content retracts behind it, so they overlap cleanly.
- **No variant change** (A↔C, where the input stays in the bar but the side panel grows/shrinks): just animate whichever morphs differ. `startTween` is a no-op when from===to.

**Single source of truth:** `APP_BOTTOM_BAR_H` is exported from `cart/app/gallery/components.cls.ts`. The `AppBottomInputBar` classifier owns its own `height: APP_BOTTOM_BAR_H`; the cart imports the same constant for routes' paddingBottom calc. Never inline a height fallback in cart code — the regression that bites is that the input strip's natural height changes (added/removed chip rows, etc.), the cart's local fallback drifts out of sync, and the page reflow stops aligning.

**Architectural invariant — useRoute placement.** Hooks that subscribe to `<Router>` (and the variant store, and the focal store) MUST run inside `<Router>`'s subtree. App is split into a thin shell (mounts `TooltipRoot > OnboardingProvider > Router > NavigationBus > ShellBody`) and `<ShellBody>` (everything route-aware). If you collapse them back into one component the route changes won't trigger re-renders and the morph will look like it never fires — only the page-area content will swap.

**Layout invariants** (do not break, in order of how badly each one bites if you do):
- Both slots are `position: absolute` inside a `position: relative` page area. SideMenuInput must NOT be a flex sibling — if it pushes BottomInputBar via flex, the `paddingRight = inputMorph * (vw - SIDE_W)` formula leaks `sideMorph` into the calc and the input collapses to 0 width by end of phase 1.
- `AppBottomInputBar`'s height comes from the classifier, not from the cart. The framework's layout engine treats absolute boxes without explicit dimensions as 0-tall.
- BottomInputBar leaves the React tree (outer conditional `{isSide ? null : (...)}`) on variant flip. Don't try to animate its height collapse instead — it covers SideMenuInput's input from the top down as it shrinks (the "rollout from the top" regression).
- Inside the conditional, `display: 'flex'` is set explicitly. The framework treated `display: undefined` as `display: none`, leaving the bar invisible.
- `App` outer Box and `AppSideMenuInput` carry `backgroundColor: 'theme:bg'`. `AppBottomInputBar` is overridden to `theme:transparent` in the inline style — the bar is a HUD overlay over per-page bg, not a colored band of its own. See **Animation principles → HUD / iframe split** below for why.

**Named regressions** to grep for if anyone breaks this:
- "input invisible in full mode"
- "input shrinks to 0 then resets"
- "rollout from the top"
- "color split / mismatch"
- "morph never fires on route change" → check that ShellBody is INSIDE `<Router>`, not its parent.
- "B→C feels like a 1s delay before the input animates" → the TO BAR branch must be parallel; sequencing puts the visible animation behind the subtle one.

If you hit any of those, `git log --grep GOLDEN` finds the canonical reference.

---

### HUD / iframe split (`cart/app/index.tsx` + `cart/app/shell.tsx`, 2026-05-02)

The shell is a HUD wrapping an iframe — not a shell with side panels and a bar. The HUD owns chrome (top), the assistant rail (left), and the input bar (bottom); the iframe is the page content slot. The bar is `theme:transparent`, sitting over whatever the page paints beneath it. This is what kept multi-bg pages (most visibly `/settings`) from flashing a `theme:bg` strip across their content during the full→side morph.

**Mental model:**

```
[ HUD chrome (top) ]
[ HUD rail (left, sideWidth)        | iframe (page) ]
[ HUD bar (bottom, transparent overlay over the iframe) ]
```

The bar is *transparent*. The page bg is what shows where the bar's input doesn't reach (right side during phase 1 of shrink, the whole strip the rest of the time). The bar's only visible element is the InputStrip itself.

**Page contract:**

- Each page paints its bg edge-to-edge (full height of the iframe slot — the routes wrapper has no `paddingBottom`).
- Each page consumes `useHudInsets()` from `cart/app/shell.tsx` and applies `insets.bottom` as **internal** padding on its content layout (NOT on its bg layer). The bg fills the area; only content moves up to clear the bar.
- The shell publishes the insets each render tick via `setHudInsets(bottom, left)`. Today only `bottom` is non-zero — the rail is opaque chrome and the routes wrapper still applies `paddingLeft: sideWidth` directly. If a future feature needs page-side awareness of the rail width, plumb it through `insets.left` and pages can opt in.

**Sub-nav promotion (Phase B):**

Routes that previously held an in-page sub-nav now lift that sub-nav into the HUD. Settings currently exposes User / Customize / Providers / Models / Actions / Data / Privacy / About. The sub-nav stacks at the top of the same column as the assistant rail — settings nav above, AssistantChat in the middle (`flexGrow:1`), InputStrip pinned to the bottom — so the left side of the screen reads as one continuous chrome instead of "assistant + adjacent column."

Active section is a shell-level store: `useSettingsSection()` in `cart/app/shell.tsx` (mirrors the `useInputFocal` pattern). The page reads it; the HUD-rendered `<SettingsNav />` reads + writes it.

The pattern is reusable. To promote another route's sub-nav:
1. Add a `useFooSection()` store to `shell.tsx` (copy `useSettingsSection`).
2. Refactor the page to read `active` from the store, drop the in-page nav column.
3. Export a self-contained `<FooNav />` component from the page module.
4. In `ShellBody`, render `{isFoo ? <FooNav /> : null}` inside `S.AppSideMenuInput` before the chat.

**Named regressions** for HUD / iframe split:
- "bar bg flashes during morph" — the bar's classifier `theme:bg` is leaking. The override `backgroundColor: 'theme:transparent'` must stay in the bar's inline style (`index.tsx`).
- "page content gets covered by the bar" — page didn't apply `paddingBottom: useHudInsets().bottom` on its content layout. Add it; don't put it on the bg layer.
- "two-color split where assistant rail meets sub-nav" — the sub-nav was rendered as a separate slot instead of inside `S.AppSideMenuInput`. Stack it inside the rail at the top.

---

## Routes & screens

### App shell — `index.tsx` — WIP

CHECKLIST:
- Purpose: Cart entry. Boots the gallery theme, mounts the providers (`TooltipRoot > OnboardingProvider > Router > NavigationBus > ShellBody`), and houses the three-state shell machinery in `ShellBody`. Registers the `/`, `/settings`, `/settings/customize`, `/activity/sweatshop`, `/composer`, `/character`, and `/gallery` routes. The `ROUTES` table carries `mode: 'full' | 'side'` per top-level entry; settings descendants derive side mode via `route.path.startsWith('/settings')`. `ShellBody` derives `headingTo` from `(routeMode, inputFocal)` and runs the morph machinery on changes (see **Animation principles → Input-strip shell morph (GOLDEN)** for the full description). `NavigationBus` (no DOM output) subscribes to `app:navigate` on the IFTTT bus and converts emitted paths into `nav.push(...)` calls so every input tier fires the same event the router subscribes to.
- isRoute: FALSE
- Route: N/A (registers `/`, `/settings`, `/settings/customize`, `/activity/sweatshop`, `/composer`, `/character`, `/gallery` inside the `<Router>`; ROUTES table also carries the `mode` axis the shell reads)
- hasDatashape: FALSE
- Datashape: consumes `onboarding/state.jsx` (`useOnboarding`); subscribes to the IFTTT bus event `app:navigate` (payload = path string) via `NavigationBus`; reads route via `useRoute()` and focal via `useInputFocal()` from `cart/app/shell.tsx`; reads variant via `useActiveVariant()` from `runtime/theme.tsx` (variant is the lagging render state — which slot hosts the input — flipped at the right moment in the morph)
- exposedDatashapes: `onb.step`, `onb.totalSteps`, `onb.setStep`, `onb.complete`, `onb.loading`, `onb.tourStatus`, `onb.acceptTour`, `onb.declineTour`
- Hooks: `useOnboarding`, `useNavigate`, `useRoute`, `useActiveVariant`, `useInputFocal`, `useRef`, `useState`, `useEffect`, `useAnimationTimeline` (inside `TourBanner`), `useIFTTT` (inside `NavigationBus`)
- Conditions:
  - `onboardingActive = !onb.loading && !onb.complete` swaps step cubes for route nav links on the right side of the chrome
  - `showTour = !onboardingActive && onb.tourStatus === 'pending'` — drops the tour banner into the right cluster (BEFORE the nav row, after the brand) once Step5 has called `markComplete()`. Banner unmounts on accept / decline.
  - `ConditionalInputStrip` renders only when `!onb.loading && onb.complete` — bottom supervisor strip stays hidden during onboarding.
  - **Shell state derivation** — settings paths are forced to side mode (`route.path.startsWith('/settings') ? 'side' : ...`), otherwise `routeMode = ROUTES.find(r => r.path === route.path)?.mode ?? 'full'`; then `headingTo = deriveHeadingTo(routeMode, focal)` returning `'home' | 'activity-docked' | 'activity-focal'`. The `useEffect([headingTo])` dispatches morphs via the `TARGETS` table; same-mode route navigations don't change `headingTo`, so the effect doesn't fire and only the page-area content swaps.
  - **Variant flip pivot** — TO PANEL (`null → 'side'`): morph "shrink" first (input + side parallel), variant flip on input completion, then bottom morph. TO BAR (`'side' → null`): variant flip + ALL morphs in PARALLEL. No-variant-change (A↔C): just animate whichever morphs differ.
  - `NavigationBus` subscribes once at mount; `useIFTTT('app:navigate', cb)` validates the payload is a string starting with `/` before calling `nav.push(payload)`.
- Components: `TooltipRoot`, `OnboardingProvider`, `Router`, `NavigationBus`, `ShellBody`, `Route`, `IndexPage`, `SettingsPage`, `SweatshopPage`, `ComposerPage`, `CharacterPage`, `GalleryPage`, `Chrome`, `NavLink`, `StepCubes`, `TourBanner`, `ConditionalInputStrip`, `InputStrip`, `AssistantChat`
- Atoms: `Box`, `Pressable`, `Text`, `S.AppBottomInputBar`, `S.AppSideMenuInput`, plus all the legacy chrome atoms (`S.AppChrome`, `S.AppChromeBrandRow`, etc. — see commit `3bad2f07d` for the slot classifiers' contract)
- isUsingTheme: TRUE — every surface goes through a classifier in `components.cls.ts`
- hasIcons: TRUE
- Icons: `Home`, `Settings`, `LayoutGrid`, `User2`, `Minimize`, `Maximize`, `X`
- hasAnimation: TRUE — three RAF-driven snapshot tweens (`inputMorph` / `sideMorph` / `bottomMorph`) coordinate with the variant flip per the GOLDEN section. Tour banner uses its own animation timeline (separate machinery).
- Animations: see **Animation principles → Input-strip shell morph (GOLDEN)**. Tour banner: mounts at `markComplete()`, holds invisible until `TOUR_BANNER_FADE_DELAY_MS = 1400ms`, then fades in over `TOUR_BANNER_FADE_MS = 500ms`.
- TODO:
  - Real triggers are wired: `@sweatshop` token (`tokens.ts`) routes to the activity via `app:navigate`; the chat header glyph (`↗`/`↘` in `AssistantChat`) drives B↔C focal flips; sweatshop's worker tiles call `setInputFocal(true)`. The temporary debug overlay (`SWEATSHOP →` / `FOCUS / UNFOCUS` at top:60, left:60) was removed once those triggers existed. Home tile clicks → activity routes are still TBD (see Planned work → Side menu + activity host).
  - Once a real tour is wired, `acceptTour()` should arm the overlay; today it just hides the banner.
  - Decide whether `ConditionalInputStrip` should render in onboarding's later steps. Today it's all-or-nothing on `complete`.
- PROBLEMS:
  - **Shell vertical budget shared with the bar.** `APP_BOTTOM_BAR_H` (in `cart/app/gallery/components.cls.ts`) is the height of the input bar AND drives the routes wrapper's `paddingBottom` in states A and C. The strip's natural `minHeight: 206` (`CommandComposerFrame`, in the same file) is the lower bound; `APP_BOTTOM_BAR_H = 226` is a small over-allocation that the classifier's `justifyContent: 'flex-end'` absorbs. They're related but not the same number — change them together.
  - **Architectural invariant: `<ShellBody>` MUST be inside `<Router>`.** `useRoute()` reads RouterContext; if a hook in App's body (App is the Router's parent) calls it, route changes don't trigger re-renders and the morph never fires. Splitting App into thin App + ShellBody is the fix; don't collapse it back. (See GOLDEN regression "morph never fires on route change".)

---

### Input strip — `InputStrip.tsx` — WIP

CHECKLIST:
- Purpose: The supervisor's persistent input surface — pinned to the bottom of the shell once onboarding completes. Visually a `CommandComposer` (gallery shape: routing/attached header up top, prompt area + action rail in the middle, branch chip + shortcut hints in the footer); the static `CommandComposerPromptLine` segments are swapped for a live `<TextInput>` so the surface is editable. Submit parses `@`-tokens against `tokens.ts` and fires `app:navigate` on the IFTTT bus per route token; anything else is dropped today (router-model and supervisor-session wiring lands in follow-up commits and plug into the same `submit()` path).
- isRoute: FALSE
- Route: —
- hasDatashape: FALSE
- Datashape: emits `app:navigate` events on the IFTTT bus (consumed by `index.tsx`'s `NavigationBus`); reads `useRoute().path` for the live branch chip; consumes `tokens.ts` (`resolveTokens`, `TokenMatch`, `Token`)
- exposedDatashapes: —
- Hooks: `useState`, `useRef`, `useRoute`
- Conditions:
  - Token preview row renders only when `resolveTokens(draft).length > 0` — chip strip sits above the live `<TextInput>` inside the same `<S.CommandComposerPromptRows>` container
  - `submit()` is a no-op on empty/whitespace input (`text.trim().length === 0`)
  - Per-keystroke `resolveTokens(draft)` drives the chip preview; on submit the token list is recomputed off the trimmed `draftRef.current` so the chips and the dispatched events agree even with mid-string edits
  - Submit fires one `busEmit('app:navigate', token.path)` per matched route token, in source order; `NavigationBus`'s subscriber (in `index.tsx`) is the single subscriber that converts each emit into a `nav.push(...)`
- Components: `CommandComposerHeader`, `CommandComposerFooter`, `CommandComposerChip` (all from `cart/app/gallery/components/command-composer/`), `TextInput`
- Atoms: `S.CommandComposerFrame`, `S.CommandComposerMain`, `S.CommandComposerPromptRows`, `S.CommandComposerPromptFlow`, `S.CommandComposerActionRow`, `S.CommandComposerShortcutGroup`, `S.CommandComposerIconButton`, `S.CommandComposerIconText`, `S.CommandComposerSend`, `S.CommandComposerActionText`
- isUsingTheme: TRUE — every surface is a gallery classifier; the embedded `<TextInput>` overrides only with `theme:` tokens (transparent background, `theme:ink` color, no hex literals)
- hasIcons: TRUE (via `CommandComposerChip` — the gallery component handles `iconForChip` based on chip prefix; `⌁` → `GitBranch` for the live branch chip, no icon for `@`-prefixed token chips)
- Icons: routed through `CommandComposerChip` based on chip prefix (`⌁` → `GitBranch`, `▣` / `☰` for file-shaped chips when those land)
- hasAnimation: FALSE
- Animations: —
- TODO:
  - Wire the router-model tier: parallel HTTP request from `submit()`, parse one-line response (`GOTO <path>` / `OPEN <app>` / `NONE`), fire `app:navigate` from the same code path. Read connection from `Settings.routerConnectionId` once that field exists.
  - Wire the supervisor session: long-lived Claude session via the cockpit poll-loop pattern (`__claude_init` / `__claude_send` / `__claude_poll`). Render the chat thread inside the route slot, not the strip itself.
  - Swap the static `ROUTE_CHIP` (label `tier-1 only`) for the live model name once a `Settings.routerConnectionId` (or supervisor connection) is wired. Same for `TARGET_CHIP` once "currently focused app" is a concept.
  - Token chips for resolved `@`-mentions currently sit on a separate row above the live input; explore inline replacement once the renderer can host mixed text + chip segments inside one `<TextInput>` analogue.
  - Add an `app:open` IFTTT subscriber and emit shape for app-typed tokens once cartridges mount inline (tokens.ts already has the union slot reserved).
- PROBLEMS:
  - The `LEFT_SHORTCUTS` (`@ tag file`, `{} variable`, `/ command`) advertise capabilities only the `@` shortcut delivers today. Either ship the other two or drop them from the static envelope.
  - `ROUTE_CHIP` (`@tier-1 only`) and `TARGET_CHIP` (`+nav`) are static placeholders. Until they're wired to live state they over-promise — the user sees a `+nav` target chip but no app actually owns "nav" as a target.
  - Send button and Icon button (`S.CommandComposerSend`, `S.CommandComposerIconButton`) inherit the gallery classifier's hover/press affordance; the icon-button currently has no `onPress` (mode toggle is a future feature) so it visually invites a click that does nothing. Either wire it or strip the affordance.

---

### Token registry — `tokens.ts` — WIP

CHECKLIST:
- Purpose: Source of truth for the cart's `@`-token catalog — the zero-latency tier of the dispatch hierarchy. Each `@<name>` token resolves to a route (today) or, eventually, an app/command/file/variable. `resolveTokens(text)` runs the regex `/@([A-Za-z][A-Za-z0-9_-]*)/g` against the input, looks up each match in the catalog, and returns `TokenMatch[]` with `{raw, start, end, token}` so a future renderer could highlight inline if it wanted to. Today only `InputStrip` consumes the result.
- isRoute: FALSE
- Route: —
- hasDatashape: FALSE (catalog is a hand-maintained `Record<string, Token>`, not a persisted gallery row — yet)
- Datashape: produces `TokenMatch` records (`{ raw, start, end, token: { type: 'route'; path; label } }`); the `Token` union has `RouteToken` only today, with an `{ type: 'app'; id; label }` variant reserved in a comment for when cartridges mount inline
- exposedDatashapes: `Token`, `RouteToken`, `TokenMatch`, `TOKENS` (catalog), `resolveTokens(text)`
- Hooks: —
- Conditions:
  - Lookup is case-insensitive — `@Home`, `@home`, `@HOME` all resolve to the same entry via `m[1].toLowerCase()`
  - Unknown tokens are silently dropped from the result (no error surface — the user sees the raw `@unknown` text in the input but no chip in the preview)
  - Regex anchors on a name-start letter (`[A-Za-z]`), so prose with embedded `@` (email addresses, mid-word `@`s) still matches when followed by a name; v1 leaves it permissive — refine the boundary if false positives show up
  - `TOKEN_RE.lastIndex = 0` reset every call — the `g` flag's stateful index would otherwise leak across calls and skip matches
- Components: —
- Atoms: —
- isUsingTheme: FALSE
- hasIcons: FALSE
- Icons: —
- hasAnimation: FALSE
- Animations: —
- TODO:
  - `@sweatshop` / `@composer` / `@gallery` / `@chatbot` wait for token-catalog cleanup. `/composer` and `/gallery` are real routes now; the token catalog has not caught up.
  - Add the `{ type: 'app'; id: string }` variant when cartridges are mountable — `InputStrip.submit()` will branch on `token.type` to fire either `app:navigate` (route) or `app:open` (app).
  - Lift the catalog to a persisted gallery row when third-party cartridges can register their own tokens at install time. Until then, cart code is the authority.
- LANDED: `@home`, `@settings`, `@character` point at live routes. `@about` is now stale because the `/about` route was removed from `index.tsx`; remove or retarget it when the token catalog is cleaned up. Add `@composer` and `@gallery` next.
- PROBLEMS:
  - Catalog can drift from the actual route list. If a token's `path` no longer matches a registered route, `nav.push(path)` silently lands on an empty Route slot. Add a build-time check against the routes registered in `index.tsx` once the route catalog is extracted to a shared constant.
  - `@-token` names share namespace across types (route / app / command). When the catalog grows, collision becomes a real concern — first-match-wins or explicit prefixes (`@route:home` vs `@app:sweatshop`) are the next decisions.

---

### Index page — `page.tsx` — WIP

CHECKLIST:
- Purpose: `/` route. Three-way gate: while `onb.complete` is false → `<Onboarding>`; on the first render after `markComplete()` (`!onb.homeEntryPlayed`) → `<HomeEntry>` which carries Step5's exit final frame ("Welcome aboard." + spinner) and dissolves it into the staggered home surface (greeting → goal card → shell-free gallery tile menu → profile facts); otherwise → `<HomeStatic>` direct. Both Home variants render through a shared `<HomeBody>` that takes phase opacities — `HomeEntry` drives them off `useAnimationTimeline`, `HomeStatic` passes `1` for everything.
- isRoute: TRUE
- Route: `/`
- hasDatashape: FALSE (consumes the onboarding-provider surface)
- Datashape: reads `onboarding/state.jsx` (`name`, `goal`, `configPath`, `traits`) + `onboarding/traits.js` (`TRAITS_BY_ID` for the accommodations chip-list)
- exposedDatashapes: `onb.loading`, `onb.complete`, `onb.step`, `onb.shouldPlayFirstStartAnimation`, `onb.markFirstStartAnimationPlayed`, `onb.homeEntryPlayed`, `onb.markHomeEntryPlayed`, `onb.name`, `onb.goal`, `onb.configPath`, `onb.traits`
- Hooks: `useOnboarding`, `useAnimationTimeline` (inside `HomeEntry`), `useEffect`, `useRef`
- Conditions:
  - `if (onb.loading) return null;`
  - `if (!onb.complete) return <Onboarding ...>;`
  - `if (!onb.homeEntryPlayed) return <HomeEntry />;`
  - else `return <HomeStatic />;`
  - `HomeEntry` schedules `markHomeEntryPlayed()` at `ENTRY_DONE_MS = T_PROFILE_END + 80 = 3280 ms` so the next render flips to `<HomeStatic />` cleanly.
  - Goal card body branches on `hasGoal = goal.trim().length > 0` — shows the goal statement when present, falls back to a "you can set one anytime" line when not. The `User.onboarding.status === 'skipped'` branch isn't wired here yet (open thread).
  - Home launcher uses `MenuGridSquareContent` from the component gallery, not `MenuGridSquare`, so the app gets the C1 tile menu body without the gallery demo chrome (`MenuTileShell`, id/title/kind header, outer bordered specimen frame).
  - Because the gallery shell previously provided the stage height, the app wraps `MenuGridSquareContent` in an explicit `720 x 360` stage (`maxWidth: '100%'`) so flex rows have a stable height and tile text does not collapse.
- Components: `Onboarding`, `HomeEntry`, `HomeStatic`, `HomeBody`, `MenuGridSquareContent`, `ProfileFact`, `SnakeSpinner`
- Atoms: `Box`, `S.Page`, `S.Card`, `S.Title`, `S.Body`, `S.Caption`, `S.AppStepFrame`, `S.AppStepCenter`, `S.AppStepBottomRight`, `S.AppGreet`, gallery menu atoms (`S.MenuGridBox`, `S.MenuGridRow`, `S.MenuGridTile` / `S.MenuGridTileActive`, `S.MenuNum`, `S.MenuLabel`, `S.MenuLabelStrong`, `S.MenuHint`)
- isUsingTheme: TRUE (via classifiers)
- hasIcons: FALSE
- Icons: —
- hasAnimation: TRUE (HomeEntry only — HomeStatic is a no-animation render)
- Animations (HomeEntry, single shared `useAnimationTimeline`):
  - Carryover "Welcome aboard." + spinner hold 0→500 ms (picks up where Step5's exit left off)
  - Carryover fade-out 500→1400 ms (`fadeOut`)
  - Greet fade-in 1400→1950 ms (24 px slide)
  - Goal card fade-in 1950→2300 ms
  - Home tile menu fade-in follows the old three-tile stagger envelope: tile opacities are averaged for the menu stage while the stage slide is keyed off tile 1.
  - Tile phase 1 2300→2650 ms
  - Tile phase 2 2550→2820 ms (overlap by ~100 ms for staggered feel)
  - Tile phase 3 2720→2990 ms
  - Profile fact row fade-in 2990→3200 ms
  - `markHomeEntryPlayed()` at 3280 ms
- TODO:
  - Wire home menu click handlers when the cartridge ABI lands in cart/app. Today the tile menu is a launcher-shaped visual surface only; hover/active state works, but no item routes or opens a cartridge yet.
  - Add the `User.onboarding.status === 'skipped'` runtime branch so skipped users see a degraded surface and can resume / restart onboarding inline. The plumbing is half-there (state.jsx persists `'skipped'`); IndexPage just doesn't read it yet.
  - Resolve `~` → `$HOME` in the `Config path` profile fact (currently shows the raw string).
  - Persist a "last-active cartridge" pointer once menu tiles can route/open, so reopening the app lands on the user's last surface instead of always the selector.
- PROBLEMS: none known.

---

### Settings page — `settings/page.tsx` — WIP

CHECKLIST:
- Purpose: `/settings` route family. Mode `'side'` — `/settings` and `/settings/customize` enter HUD state B (assistant rail visible). The page is single-column `theme:bg1` content; the section sub-nav (User / Customize / Providers / Models / Actions / Data / Privacy / About) is rendered by the shell at the top of the assistant rail (see **Animation principles → HUD / iframe split** for the pattern). Data-backed sections read/write the gallery data graph through `useCRUD` against the `app` namespace (User, Settings, Privacy, Connection, Model rows). Customize reads the active component-gallery theme and writes token color overrides through `cart/app/gallery/gallery-theme.ts`.
- isRoute: TRUE
- Route: `/settings`, `/settings/customize`
- hasDatashape: TRUE (consumes/writes User, Settings, Privacy, Connection, Model via `useCRUD`; Customize consumes/writes gallery theme token overrides)
- Datashape: User (`user_local`), Settings (`settings_default`), Privacy (`privacy_default`), Connection rows scoped by `settingsId === SETTINGS_ID`, Model rows; Customize override map `Record<runtimeTokenName, colorString>` persisted at localstore key `component-gallery-theme-token-overrides`.
- exposedDatashapes: `SettingsNav` (named export — rendered by `index.tsx`'s ShellBody at the top of the assistant rail), `SettingsPage` (default export — single-column content)
- Hooks: `useSettingsSection` (shell-level active-section store), `useHudInsets` (page applies `insets.bottom` to its scroll content's `paddingBottom`), `useRoute` (sets Customize active when path is `/settings/customize`), `useNavigate` (SettingsNav pushes `/settings/customize` for Customize, `/settings` for the rest), `useCRUD` (one per row type), `useState`, `useEffect`
- Conditions:
  - Active section comes from `useSettingsSection()` (shell-level store) — page reads, `SettingsNav` reads + writes via `setActive`
  - `/settings/customize` forces `settingsSection = 'customize'` on mount/path change
  - SettingsNav path behavior is intentionally shallow: Customize gets a real child route, all other sections stay on `/settings` and are selected by the shell store
  - Each section dispatches off `active === '<id>'` for its render
- Components: `SettingsNav` (HUD rail entry), `UserRoute`, `CustomizeRoute`, `ProvidersRoute`, `ModelsRoute`, `ActionsRoute`, `DataRoute`, `PrivacyRoute`, `AboutRoute`
- Atoms: `Box`, `Pressable`, `ScrollView`, `S.Caption`, `S.Title`, `S.Body`, `S.NavPill`, `S.NavPillActive`
- isUsingTheme: TRUE — page wrapper paints `theme:bg1` edge-to-edge into the iframe slot; nav paints `theme:bg` (matches the rail above)
- hasIcons: FALSE (route nav icon comes from `index.tsx`, not the page body)
- Icons: —
- hasAnimation: FALSE
- Animations: —
- TODO: see open threads — real probes for API / Local providers; UX for default provider/model selection per connection; richer Customize controls once numeric style-token reassignment is in scope.
- PROBLEMS: Settings child routes are only partially path-addressable today. `/settings/customize` is real because it needs a shareable Customize path; User/Providers/Models/Actions/Data/Privacy/About still use `/settings` plus the shell-local section store.

### Settings customize route — `settings/routes/customize.tsx` — WIP

CHECKLIST:
- Purpose: Theme reassigner for component-gallery color tokens. Lists editable string color tokens from the active gallery theme's merged token categories, shows the runtime token name (`bg`, `accentHot`, `paperRule`, etc.), displays the base value, and lets the user assign an override that applies immediately.
- isRoute: FALSE (mounted inside `SettingsPage`; addressable through `/settings/customize` selecting the settings section)
- Route: `/settings/customize` via `SettingsPage`
- hasDatashape: TRUE
- Datashape: `GalleryThemeTokenOverrides = Record<string, string>` stored under localstore key `component-gallery-theme-token-overrides`
- exposedDatashapes: none; consumes `useGalleryTheme()` from `cart/app/gallery/gallery-theme.ts`
- Hooks: `useMemo`, `useGalleryTheme`
- Conditions:
  - Only string values that look like colors are editable (`#`, rgb/rgba, hsl/hsla, or `transparent`)
  - `fontMono` and `fontSans` are intentionally excluded even though they are string tokens
  - Empty override text deletes the override; the field then shows the base value as placeholder and the runtime falls back to the active theme
  - `Clear` removes the whole override map and re-pushes the active theme
- Components: `Section`, `Field`, `Input`, local `TokenRow`, local `Swatch`
- Atoms: `Box`, `S.Card`, `S.Body`, `S.Caption`, `S.ButtonOutline`, `S.ButtonOutlineLabel`
- isUsingTheme: TRUE — UI chrome uses `theme:` tokens; the swatch `backgroundColor` is the user/base token value being inspected
- hasIcons: FALSE
- Icons: —
- hasAnimation: FALSE
- Animations: —
- TODO:
  - Add validation feedback for malformed color strings. Today invalid strings are persisted and passed through to runtime token resolution.
  - Add numeric style-token reassignment if users need spacing/radius/type controls.
  - Add category grouping once the token list grows beyond one screen.
- PROBLEMS: Color override persistence uses the legacy single-key `__store_get` / `__store_set` localstore surface inside `gallery-theme.ts`, matching active gallery theme persistence. It is not a `useCRUD` row, so it will not show up in settings data export until a theme-preferences row lands.

---

### Sweatshop activity — `sweatshop/page.tsx` — WIP

CHECKLIST:
- Purpose: The "open scene" — a canvas substrate where every cart's logic composes. A FlowEditor surface plus a three-tier palette (capability / domain / rules). Capability nodes are pulled live from the IFTTT registry (`listIfttSources()` / `listIfttActions()` — every registered source/action prefix becomes a draggable node). Domain nodes come from the gallery shape catalog. Rule stamps are a curated starter library that will eventually read from the `rule` table. The seed scene shows a Goal node pulled from the persisted onboarding row plus a starter trigger → action chain.
- isRoute: TRUE (mounted at `/activity/sweatshop` in `index.tsx`'s `ROUTES` table; declared `mode: 'side'`)
- Route: `/activity/sweatshop`
- hasDatashape: FALSE (the canvas state is local to the FlowEditor; persistence to a `composition` row is queued)
- Datashape: reads `Goal` via `useLatestGoal()`; reads `User` via `useUser()`. Writes nothing yet.
- exposedDatashapes: —
- Hooks: `useState` (canvas nodes/edges), `useLatestGoal`, `useUser`. Imports `'@reactjit/runtime/hooks/ifttt-supervisor'` for side-effect registration of the `event:` / `rule:` / `verb:` / `worker:` / `run:` sources and the 13 supervisor action runners.
- Conditions: —
- Components: `FlowEditor`, `PaletteSidebar`, `Box`, `Col`, `Row`, `Text`
- Atoms: `S.*` classifiers from `@reactjit/core`
- isUsingTheme: TRUE
- hasIcons: FALSE
- Icons: —
- hasAnimation: FALSE
- Animations: —
- TODO:
  - **Compile-from-graph** — walk FlowEditor nodes + edges and emit a list of `{ trigger, action }` pairs that bind through `useIFTTT` (or imperatively via `resolveTrigger(spec).subscribe(...)` + `dispatchAction(...)`). Spec strings are reconstructable from palette node types + port wiring. Tear down on unmount or graph edit.
  - **Boot the engine on mount** — call `installVmBridges()` + `installClaimEngine()` + `installMechanicalWires()` + `bindRules()` (all from `cart/app/db`) so VM event mirroring, claim ledger / verify-loop, DB-backed action persistence, and `rule`-table-driven bindings come alive while the cartridge is active.
  - Persist canvas state to a `composition` row so reloads + cross-cartridge identity continuity work.
- PROBLEMS:
  - **The canvas does not yet bind anything live.** Editing the graph today is purely visual — no `useIFTTT` calls happen as a result of node/edge changes. Capability palette renders 100% of registered sources/actions, but wiring two of them does not light a rule. The compile step + the four `installX()` calls above are the gap. See the IFTTT/supervisor substrate entry below for what's already wired at the lower layers.

---

### Composer page — `composer/page.tsx` — WIP

CHECKLIST:
- Purpose: `/composer` route. First in-app pass of the UI authoring canvas described in `docs/11-composer.md`: a Figma-style page canvas where the canonical state is an editable `SNode` tree, not generated DOM or opaque screenshots. The route lives inside the app shell in side mode, with a left atom library rail, center `Canvas`, right inspector/layers column, and bottom code drawer. The canvas output is intentionally composer-native primitives (`Page`, `Box`, `Text`, `Pressable`, `GalleryAtom`) so the emitted JSX is visible and selectable.
- isRoute: TRUE
- Route: `/composer` (`mode: 'side'` in `index.tsx`)
- hasDatashape: TRUE (local composer draft shape, not `useCRUD`)
- Datashape:
  - `ComposerDoc` stored through the host store at `composer:draft:default`; index metadata stored at `composer:drafts`
  - `ComposerDoc.pages: SNode[]`, `selection: string[]`, `viewport: { x, y, zoom }`
  - `SNode` fields: `kind`, `name`, `galleryId`, `shapeId`, `text`, `bg`, `color`, `width`, `height`, `padding`, `gap`, `flexDirection`, `alignH`, `alignV`, `x`, `y`, `children`
  - `PaletteAtom` derived from primitives plus `cart/app/gallery/stories` sections, grouped through `gallery/taxonomy.ts`
- exposedDatashapes: none public yet; all state is page-local and persisted as one draft record
- Hooks: `useState`, `useEffect`, `useMemo`, `useRef`, `useIFTTT`
- Conditions:
  - `loadDoc()` restores the saved draft; invalid/missing drafts fall back to one blank page.
  - `saveDoc()` autosaves the normalized draft after edits (500ms debounce).
  - `normalizeDoc()` guarantees unique ids, removes invalid selection ids, and upgrades old empty `GalleryAtom` records into editable child templates.
  - Blank page creation is intentionally blank: no starter text/box scaffold is inserted.
  - New pages use `nextPagePosition()` so frames spread horizontally on the canvas instead of stacking on top of each other.
  - Pages render as `Canvas.Node`; native drag handles move the page and `onMove` persists `x/y` back into the draft.
  - The bottom-center actionbar is mounted inside `Canvas.Clamp`, so it stays fixed to the viewport instead of panning with the canvas.
  - Only the base tools stay on the actionbar: select, pan, draw, box, text, button, copy, paste, duplicate, delete, group, ungroup, page.
  - The full atom/gallery catalog is tucked into the left rail menu (`ALL`, `PRIM`, `SHAPE`, `UI`, `HIDE/OPEN`) instead of crowding the toolbar.
  - The canvas content does **not** inherit cockpit classifiers. Authored `Box`/`Text`/`Pressable` styles are stored as node values (`bg`, `color`, spacing, dimensions) so a composed app does not have to undo the composer shell's theme.
  - Selecting a row or canvas primitive normally sets a single selection. Multi-selection is deliberate, currently from `Ctrl/Cmd+A` scoped to the active page's children.
  - The layers panel lists pages and nested children through the existing gallery `LayerRow` atom, so each row gets `LayerThumbnail`, `LayerVisibilityToggle`, `LayerLockToggle`, `StripBadge`, opacity/fill badges, and selected-state chrome. Active rows expose inline `UP`, `DN`, `OUT`, `IN`, `DEL` controls; duplicate/copy controls live only on the actionbar.
  - Page rows are selectable and deletable; the editor no longer forces a permanent default 320px page/layer to remain.
  - `removeNodes()` deletes the whole current selection; `groupSelection()` groups siblings under a new Box; `ungroupSelection()` lifts a selected group's children back to the parent.
  - Clipboard copy writes `reactjit/composer-nodes` JSON to the host clipboard when available and keeps an in-memory fallback. Paste inserts pages as pages, non-pages into the selected container/parent.
  - Keyboard handling is scoped away from focused inputs: `Ctrl/Cmd+A` select scoped layers, `Delete/Backspace` delete, `Esc` clear selection, `Ctrl/Cmd+C/V/D` copy/paste/duplicate, `Ctrl/Cmd+G` group, `Ctrl/Cmd+Shift+G` ungroup, `Alt+Up/Down` reorder, `Alt+Left/Right` outdent/indent.
  - The inspector keeps direct composer geometry/content controls, then embeds the gallery `LayerPropertiesPanel` for compositing controls (`LayerBlendModeControl`, `LayerOpacityControls`, mask range, thumbnail, badges). `StepSlider` drives spacing presets.
  - The bottom code drawer emits only the selected element and its nested subtree via `emitNode()`, not the entire document, and renders each TSX line through the gallery `SyntaxHighlighter`.
  - `FieldInput` tracks `onFocus/onBlur` so keyboard shortcuts do not fire while editing properties.
  - A local `ComposerBoundary` catches render failures inside the composer and shows a contained composer error surface.
- Components: `ComposerPage`, `ComposerBoundary`, `LayerTree`, `FieldInput`, `ColorSwatchRow`, `ActionBarButton`, `ActionBarDivider`, `RailTab`, `LayerRowButton`, `AlignButton`, `PropertyLabel`, `MiniPresetButton`, `LayerPropertiesPanel`, `LayerRow`, `StepSlider`, `SyntaxHighlighter`
- Atoms: `Canvas`, `Canvas.Clamp`, `Canvas.Node`, `Box`, `Pressable`, `ScrollView`, `Text`, `TextInput`, `LayerToolButton`, `LayerThumbnail`, `LayerLockToggle`, `LayerVisibilityToggle`, `LayerBlendModeControl`, `LayerOpacityControls`, `StripBadge`
- isUsingTheme: TRUE for composer chrome/inspector/layers via `S.*` classifiers and `theme:` tokens. Authored canvas content intentionally uses stored explicit style values so it stays app-agnostic.
- hasIcons: TRUE
- Icons: `MousePointer`, `Hand`, `PenLine`, `Square`, `Type`, `MousePointerClick`, `Copy`, `ClipboardPaste`, `BoxSelect`, `Trash2`, `Group`, `Ungroup`, `MonitorCheck`
- hasAnimation: FALSE
- Animations: —
- TODO:
  - Tool modes are visually present, but `pan` and `draw` are not fully wired as modal canvas behaviors yet.
  - Gallery atoms currently decompose into composer-native editable templates by heuristic (chart/control/card/fallback), not by parsing the real gallery component source. This is deliberate for editability, but it is not a perfect inverse of every gallery story.
  - Code drawer is still one-way selected-subtree emit. JSX→SNode parse-back from `docs/11-composer.md` is not landed in this pass.
  - Drag-to-reparent, resize handles for child nodes, border/radius/shadow/animation/conditional/repeat bindings, and shape binding are still deferred.
  - Draft management is one default draft plus an index record; no multi-draft picker/restore UI yet.
  - Selection still depends on nested `Pressable` event behavior. If hit-testing bubbles unexpectedly, keep selection changes in one explicit path and avoid additive selection outside keyboard shortcuts.
- PROBLEMS:
  - The atom templates solve the "sticker" problem by making nested primitives editable, but they are generic approximations. A real component-to-editable-tree compiler is a separate project.
  - The active layer controls are tiny and text-based (`UP`, `DN`, `OUT`, `IN`, `DEL`). They work, but will need icon/button polish once behavior stabilizes.

---

### Gallery route — `gallery/index.tsx` — WIP

CHECKLIST:
- Purpose: `/gallery` route. Mounts the component gallery inside the app shell so the catalog is reachable from the main nav while the composer consumes the same registry as its atom source.
- isRoute: TRUE
- Route: `/gallery` (`mode: 'side'` in `index.tsx`)
- hasDatashape: TRUE (gallery stories/data/theme registry, owned by the gallery package)
- Datashape: `storySections`, gallery data shapes, active gallery theme state
- exposedDatashapes: none from app shell; gallery owns its own registry/surface
- Hooks: gallery-owned
- Conditions: Route is side-mode so it enters the HUD/assistant rail layout like settings, character, and composer.
- Components: `GalleryPage`
- Atoms: gallery-owned
- isUsingTheme: TRUE
- hasIcons: TRUE (nav only)
- Icons: `LayoutGrid` in app chrome
- hasAnimation: gallery-owned
- Animations: gallery-owned
- TODO: Add `@gallery` token and decide whether the gallery should expose a compact picker mode for the composer instead of only the full route.
- PROBLEMS: none known at the app-shell level.

---

### Character creator page — `character/page.tsx` — WIP

CHECKLIST:
- Purpose: `/character` route. Non-linear character workbench for sculpting the assistant's identity, voice, purpose, behavior, knowledge weighting, and light-fiction posture. The page is intentionally not a wizard: the user can jump directly between folder tabs (`Identity`, `Purpose`, `Voice Lab`, `Behavior`, `Knowledge`, `Fiction`) and edit one thing without walking through the whole surface. The center column presents a folder-tab document; the right rail is a persistent global readout with avatar preview, quick stats, voice meters, and manifest charts. See `cart/app/docs/character/README.md` for the design corpus and `cart/app/recipes/character-creator.tsx` for the runtime composition.
- isRoute: TRUE (registered in `index.tsx`'s `ROUTES` table at `mode: 'side'`)
- Route: `/character`
- hasDatashape: TRUE
- Datashape: reads/writes `CharacterRow` via `useCharacter()` from `cart/app/character/state.tsx` (one `useCRUD('character', …, { namespace: 'app' })`); reads catalog (`ARCHETYPES`, `DIALS`, `QUIRKS`, `STANCES`, `INITIATIVES`, `CORRECTIONS`, `BOUNDARY_RULES`, `TASK_DOMAINS`, `RELATIONSHIP_REGISTERS`, `USER_STATES`, `STAKE_PROFILES`, `KNOWLEDGE_SPECIALIZATIONS`, `DEFAULT_AVATAR`) from `cart/app/character/catalog.ts`
- exposedDatashapes: `CharacterRow` (persisted shape: id, assistantId, settingsId, userId, status/visibility, name, displayName, bio, mask contract, archetypeId, dialValues, quirkIds, stance enums, boundaryRuleIds, task domains, relationship registers, user states, stake profile, knowledge weights, instruction buckets, negative mode, roleplay identity fields, custom properties, optional identity-continuity fields, version, timestamps)
- Hooks: `useCharacter` (cart provider); `useState`; `useRef` (live-state reads inside `<TextInput>` `onChangeText` to avoid stale closures, per the Pressable-stale-closure rule); `useAnimationTimeline`; `useGradientWave`; `useScramble`
- Conditions:
  - `c.loading` shows a single "Loading character…" line until the bootstrap useEffect resolves.
  - Folder tabs are direct navigation, not step progression. Every tab can be entered independently and every section writes through the same provider.
  - Selecting an archetype seeds dial values + quirkIds + stance/initiative/correction in one patch. Once any dial is touched afterward, the `archetypeId` pointer is mostly a starting-point label.
  - `MoreOptionsButton` appears on archetypes, quirks, stance, and boundaries. It invokes the assistant through `askAssistant(promptForMoreOptions(kind))` so the model can generate fresh options without committing them to the static catalog.
  - Archetype tiles are distributed through 25% column wrappers inside a max-width lane, avoiding a hard-coded tile width that leaves large side gaps.
  - Voice dials have two render layers: featured `MeterSlider` readouts for the active few, and fixed non-wrapping 11-cell axis rows for the full bipolar matrix. The row math is explicit so theme changes do not push right-side labels/value readouts into another layout planet.
  - Optional identity substrate fields are inert unless filled: relationship projection, continuity seeds, identity guardrails, recovery style, fallback deflections, deliberation/availability/delivery pattern.
  - The right rail is global and non-scrollable: avatar/BlockFaces identity card, compact stats grid, `AxisReadout` voice card, and manifest charts stay visible on every tab.
  - The center document wrapper uses content height (`flexGrow: 0`) so the page does not create a huge empty tail below the current tab's content.
- Components: `CharacterPage`, `SaveBar`, `CharacterCard`, `IdentitySection`, `PurposeSection`, `VoiceLabSection`, `BehaviorSection`, `KnowledgeSection`, `FictionSection`, `ArchetypeSection`, `DialsSection`, `QuirksSection`, `StanceTriadSection`, `BoundariesSection`, `RelationshipProjectionSection`, `ContinuitySeedSection`, `IdentityIntegritySection`, `DeliveryPatternSection`, `RoleplayIdentitySection`, `CustomPropertiesSection`, `AvatarPreview`, `VoiceRailCard`, `ManifestChartsCard`, `MoreOptionsButton`, plus shared `Pill`, `Segmented`, and discrete-axis primitives co-located in the file
- Atoms: `Box`, `Col`, `Row`, `Text`, `Pressable`, `TextInput`, `ScrollView` (runtime primitives); `<Avatar>` from `@reactjit/runtime/avatar`; runtime `Tooltip`; gallery atoms `AxisReadout`, `MeterSlider`, `BlockFaces`, `PopulationPyramid`, `Venn`; animated-text hooks `useGradientWave`, `useScramble`
- isUsingTheme: TRUE — uses app theme tokens/classifiers for page surfaces, paper/document colors, tab text, rail panels, and accent colors. Preview backdrop swatches remain fixed local colors because they are avatar options, not app chrome.
- hasIcons: FALSE — pills + segmented buttons only; no icons inside the page (the `User2` icon for the route nav lives in `index.tsx`).
- Icons: —
- hasAnimation: TRUE
- Animations: page fade/stagger through `useAnimationTimeline`; animated manifest text in the rail through `useGradientWave` and `useScramble`; avatar preview and gallery atoms own their internal motion/visual state.
- TODO:
  - Wire `system:character:saved` IFTTT emit on Save. The recipe declares the event hook; the cart side just needs `busEmit('system:character:saved', { characterId })` in `state.tsx:save()`.
  - Multi-character/persona picker and active-character pointer (`Assistant.activeCharacterId`).
  - Compatibility/recompute view: honest read on how the current character and user manifest will work together.
  - Personality drift detection: repeated user corrections should offer to adjust the character settings instead of staying case-by-case forever.
  - Replace the static preview mannequin with a real avatar/profile-image pipeline and voice-thumbnail capture.
  - Promote long optional identity fields to richer multi-line editors if the runtime text-area affordance stabilizes for this surface.
- PROBLEMS:
  - Single-character only today — `CHARACTER_ID = 'char_default'` is hardcoded in `state.tsx`. Multi-character + active-pointer (`Assistant.activeCharacterId`) lands when the picker UI ships.
  - Optional identity fields are currently single-line inputs even when the semantic value is essay-like.
  - Catalog data is duplicated between `cart/app/character/catalog.ts` and `cart/app/gallery/data/{character-archetype,personality-dial,character-quirk,constraint}.ts`. Will collapse once a shared package boundary exists; mirrored by hand for now.

---

### Manifest page — `manifest/page.tsx` — Stub

CHECKLIST:
- Purpose: `/manifest` route. Personality Survey + manifest viewer. Surfaces the assistant's evolving read of the user (`UserManifest` from `cart/app/gallery/data/user-manifest.ts`), shows pending quiz cards (chat-loom intent trees rendered inline via `runtime/intent/render.RenderIntent`), shows the digest of high-confidence dimensions, surfaces friction alerts from the active `CharacterCompatibility` row, and runs the anomaly-detection re-check inline when a contradiction lands. Organic progress framing per PRD §5 ("still getting to know you" / "practically finishing each other's sentences") — no percentage bars.
- isRoute: TRUE (planned)
- Route: `/manifest`
- hasDatashape: TRUE
- Datashape: reads/writes `UserManifest`, `QuizSession`, `CharacterCompatibility`; emits `system:quiz:rendered` / `system:quiz:answered` (chat-loom round-trip); subscribes to `manifest:updated`, `manifest:anomaly-detected`
- exposedDatashapes: `UserManifest`, `ManifestDimensionDef`, `QuizSession`, `CharacterCompatibility`
- Hooks: `useCRUD`, `useIFTTT`; planned `useActiveManifest()`
- Conditions:
  - Quiz feed renders only the most recent unanswered `QuizSession` per visit (debounce); answered sessions roll into the digest.
  - Anomaly re-check banner mounts only when `manifest:anomaly-detected` fires AND the contradicted dimension was already at confidence > 0.6.
  - Friction alerts list mounts only when the active CharacterCompatibility row carries non-empty `frictionAlerts[]`.
- Components: `ManifestDigest`, `QuizCard`, `AnomalyRecheckBanner`, `FrictionAlertList`, `RecommendedAdjustmentRow`, `RenderIntent` (from runtime)
- Atoms: `generic-card`, `preset-card`, `intent-surface` (the quiz body), `progress` / `circular-progress` (organic), `news-feed-post` (digest entries), `tooltip-frame` (per-dimension confidence hints)
- isUsingTheme: TRUE (classifiers only)
- hasIcons: TRUE
- Icons: `Sparkles` (digest), `Refresh` (recheck), `AlertTriangle` (friction), `ChevronRight`
- hasAnimation: TRUE — quiz card Spring entry, list-reorder Tween on confidence updates, border-trace on submit success, Fade between digest tabs
- Animations: see app.md Animation principles. No new primitive.
- TODO:
  - Build `cart/app/manifest/state.tsx` provider.
  - Wire the quiz author turn (calls the model with `comp_quiz_author`); wire the infer turn on submit; persist QuizSession lifecycle.
  - Implement the compatibility recomputer pure function (planned at `cart/app/character/lib/compute-compatibility.ts`).
  - Implement the unlock table (planned at `cart/app/character/lib/unlock-table.ts`); subscribe to `system:manifest:dimension-confident`.
- PROBLEMS:
  - Same as Character page — data shapes ship; page is a stub. Stories render the shapes in the gallery; `/manifest` route is a placeholder until the provider + page mount.

---

## Onboarding

The 5-step onboarding seeds **declared** user traits into `User.preferences.accommodations[]` (Step 3 multi-select chips wired through `cart/app/onboarding/traits.js`). The **inferred** counterpart — what the assistant figures out about the user over time through quizzes and conversational moments — lives on `UserManifest` (`cart/app/gallery/data/user-manifest.ts`) and is built post-onboarding by the Personality Survey at `/manifest`. The two coexist and never fold; see [`cart/app/docs/character/03-manifest-as-evolving-read.md`](docs/character/03-manifest-as-evolving-read.md).

### Onboarding step router — `onboarding/Onboarding.jsx` — Complete

CHECKLIST:
- Purpose: Routes by `step` to the right onboarding screen. Step 0 → `<FirstStep>`, step 1 → `<Step2>`, step 2 → `<Step3>`, step 3 → `<Step4>`, step 4 → `<Step5>`. An out-of-range card renders for any step index outside `[0, TOTAL_STEPS-1]`.
- isRoute: FALSE (mounted inside `IndexPage` which owns the `/` route)
- Route: —
- hasDatashape: FALSE
- Datashape: receives props from page.jsx (sourced from `onboarding/state.jsx`)
- exposedDatashapes: `step`, `animate`, `onAnimationDone` (props)
- Hooks: —
- Conditions: `step === 0` → FirstStep; `step === 1` → Step2; `step === 2` → Step3; `step === 3` → Step4; `step === 4` → Step5; else out-of-range card
- Components: `FirstStep`, `Step2`, `Step3`, `Step4`, `Step5`
- Atoms: `Box`, `S.Page`, `S.Card`, `S.Caption`, `S.Title`, `S.Body`
- isUsingTheme: TRUE (via classifiers)
- hasIcons: FALSE
- Icons: —
- hasAnimation: FALSE (step components own their own animations)
- Animations: —
- TODO: nothing pending here
- PROBLEMS: none

---

### Step 0 — Hello / name capture — `onboarding/FirstStep.jsx` — Complete

CHECKLIST:
- Purpose: Onboarding step 0. Plays a staggered "Hello" → "what is your name?" → text input entry, then reveals Skip + Next in the bottom-right. On click, runs an exit transition (buttons fade out, spinner fades in, center text fades out, "Nice to meet you {name}" fades in centered) and advances to Step2 with a best-effort ordered write (`setName` first, then `setStep(1)`).
- isRoute: FALSE
- Route: —
- hasDatashape: FALSE
- Datashape: writes to `onboarding/state.jsx` setters on dispatch (`setName`, `setStep`, `markSkipped`)
- exposedDatashapes: `onb.step`, `onb.setName`, `onb.setStep`, `onb.markSkipped`
- Hooks: `useState`, `useRef`, `useEffect`, `useAnimationTimeline`, `useOnboarding`
- Conditions: `animate` gate folds entry progress to 1 when false; name-coercion typeguard; `hasName` gates Skip/Next; exit dispatch `useEffect` only arms when both `exiting` and `exitStartT` are set; `setName` is bounded via `Promise.race(setName(), 400ms)` so a slow disk write can't stall the step transition; the dispatch branches `exiting === 'skip'` → `onb.markSkipped()` (terminal `complete=true`, status `'skipped'`) vs `exiting === 'next'` → `onb.setStep(advanceTo)`.
- Components: `SnakeSpinner` (line 295), `S.Button`, `S.ButtonLabel`, `S.ButtonOutline`, `S.ButtonOutlineLabel`
- Atoms: `Box`, `Col`, `Row`, `Text`, `TextInput`
- isUsingTheme: TRUE — every surface goes through a classifier in `components.cls.ts` (`AppHello`, `AppQuestion`, `AppNameInput`, `AppGreet`, `AppStepFrame`, `AppStepCenterCol`, `AppStepCenter`, `AppStepBottomRight`, `AppStepBottomRightRow`, `AppStepDimmable`)
- hasIcons: FALSE
- Icons: —
- hasAnimation: TRUE
- Animations:
  - Entry timeline (`useAnimationTimeline`):
    - Hello fade-in 80→580 ms (line 198, range constants line 13)
    - Question fade-in 780→1280 ms (line 208, line 14)
    - Input fade-in 1480→1980 ms (line 229, line 15)
    - Buttons fade-in 1980→2480 ms (line 269, line 16)
    - Column "shift up" between phases via `colShift` (lines 149–153, 190)
  - Exit timeline (same timeline clock, relative to `exitStartT`; 1900 ms total):
    - Buttons fade-out 0→342 ms
    - Spinner fade-in 190→608 ms
    - Center text fade-out 380→912 ms
    - Greet fade-in 1045→1482 ms
    - Dispatch `setStep(1)` at 1900 ms after exit starts
- TODO: nothing pending here. Skipped-mode dispatch is wired; animation re-arm is suppressed via the User-row-existence proxy in state.jsx bootstrap.
- PROBLEMS: none known.

---

### Step 1 — Provider selection — `onboarding/Step2.jsx` — WIP

CHECKLIST:
- Purpose: Onboarding step 1. Carries over the FirstStep exit-final frame (greet + spinner) when name is persisted, eases everything out, fades in "This application requires a connection to a provider", slides it up, staggers in 3 provider tiles. Click a tile → that tile gains the active border + an inline form expands below the row. Each form has a Probe button that gates on any-input-non-empty. When the probe succeeds (and a model is picked, for API/Local) the screen-level Next button fades in bottom-right. Click Next → exit transition (menu/form fade out, spinner fades in bottom-right, "Thanks for that" fades in centered) → `setStep(2)` advances to Step3. Bottom-left "Take me back!" returns to step 0.
- isRoute: FALSE
- Route: —
- hasDatashape: FALSE
- Datashape: reads/writes `onboarding/state.jsx` (`name`, `providerKind`, `commitConnection`)
- exposedDatashapes: `onb.name`, `onb.setProviderKind`, `onb.commitConnection`, `onb.setStep`
- Hooks: `useAnimationTimeline`, `useOnboarding`, `useState`, `useRef`, `useEffect`, `processHook.execAsync`
- Conditions:
  - `hasGreet = persistedName.length > 0` drives the carryover branch and the timeline `skip` flag
  - greet/spinner conditional render gated on `greetOp > 0.001`
  - `pickProvider` early-return when same tile reclicked; fades the form in only on first selection
  - `pickProvider` resets `lockedIn=false` on tile switch so the new form re-arms it from scratch
  - inline form rendered only when `selected` is non-null
  - `hasAnyInput` gates each Probe button
  - `lockedIn` lifted out of the forms (each form's `useEffect` calls `setLockedIn(...)` based on its internal probe + chosen-model state) → gates the Next button render
  - `commitPayload` lifted out of the forms in lockstep with `lockedIn` — each form bubbles `{ kind, endpoint?, apiKey?, model?, home?, path? }` so step root can hand it to `onb.commitConnection(payload)` at `onNext` (fires the actual Connection-row write + Settings.defaultConnectionId/defaultModelId patch in the background while the exit transition plays). Cleared on tile switch and form unmount.
  - `exitStartT != null` gates the exit visuals + blocks Take-me-back / pickProvider mid-transition; `setTimeout(..., EXIT_TOTAL_MS)` dispatches `onb.setStep(2)`
- Components: `ProviderTile`, `FormShell`, `LabeledInput`, `ProbeButton`, `ProbeResult`, `ModelList`, `ApiKeyForm`, `ClaudeForm`, `LocalForm`, `SnakeSpinner`, `S.Button`, `S.ButtonLabel`, `S.ButtonOutline`, `S.ButtonOutlineLabel`
- Atoms: `Box`, `Col`, `Row`, `Pressable`, `Text`, `TextInput`
- isUsingTheme: TRUE — every surface goes through a classifier in `components.cls.ts` (`AppPromptText`, `AppGreet`, `AppProviderRow`, `AppProviderTile` / `AppProviderTileActive`, `AppProviderTileTitle` / `AppProviderTileTitleActive`, `AppProviderTileSubtitle`, `AppFormShell`, `AppFormFieldCol`, `AppFormButtonRow`, `AppFormLabel`, `AppFormInput` / `AppFormInputMono`, `AppProbeResult`, `AppProbeOk` / `AppProbeFail`, `AppProbeMessage`, `AppModelListLabel`, `AppModelListBox`, `AppModelChoice` / `AppModelChoiceActive`, `AppModelChoiceText` / `AppModelChoiceTextActive`)
- hasIcons: FALSE
- Icons: —
- hasAnimation: TRUE
- Animations (single shared `useAnimationTimeline`):
  - Entry timeline:
    - Carryover greet hold + fade 500→1400 ms
    - Carryover spinner fade 500→1400 ms
    - Main message fade-in 1400→1950 ms
    - Main message slide up 1950→2450 ms (80 px)
    - Tile 1 fade-in 2450→2750 ms
    - Tile 2 fade-in 2670→2970 ms
    - Tile 3 fade-in 2890→3190 ms
    - Inline form fade-in: starts at first tile click, 400 ms long
    - Next button fade-in: starts at the moment `lockedIn` flips true, 350 ms long (`NEXT_FADE_MS`)
    - Direct-nav fast-forward via `skip + skipOffsetMs = 1400 ms`
  - Exit timeline (relative to click; 1900 ms total):
    - Menu / form / Next / Take-me-back fade out 0→380 ms
    - Spinner fades in 190→665 ms (bottom-right)
    - "Thanks for that" fades in 570→1235 ms (centered)
    - Dispatch `setStep(2)` at 1900 ms
- TODO:
  - Replace stubbed model list in `ApiKeyForm.probe` with a real `http.getAsync` to `${endpoint}/models`.
  - Settings UI for adding additional Connections (so a user with multiple Claude installs can register the second one without re-running onboarding) — `Settings has-many Connections` is already in the gallery shape, just no editor.
- PROBLEMS:
  - API-key probe still returns a canned model list; local probe does live HTTP probing (`/models`, `/v1/models`, `/api/tags`) and parses model IDs. Until the API probe is real, `Settings.defaultModelId` ends up holding whichever stubbed name the user picks.
  - The Claude probe relies on `claude` being on `$PATH` of the cart's process — no fallback if it isn't.
  - **Runtime plumbing landed.** The `home` field captures which Claude install to use; `commitConnection` writes it to `Connection.credentialRef.locator`; the SDK now honors it via `claude_sdk.SessionOptions.config_dir` → `CLAUDE_CONFIG_DIR=<dir>` injected into the spawned subprocess's env (`framework/claude_sdk/session.zig`). `__claude_init` accepts an optional 4th arg (`config_dir`) — JS callers that want to pin a specific install pass the locator there. Existing 1–3 arg callers continue to inherit the parent's env (default behavior unchanged).

---

### Step 2 — Trait survey — `onboarding/Step3.jsx` — Complete

CHECKLIST:
- Purpose: Onboarding step 2. Carries over the Step2 exit-final frame ("Thanks for that" + spinner) when `providerKind` is set, eases everything out, fades in "Let's get to know you a bit more", slides it up, fades in a flat shuffled grid of personality / hobby / preference traits as toggleable chips. Bottom-right shows "I'd rather not say" — once any trait is selected, the same button label flips to "Next" (and the styling switches from outline to filled). Bottom-left "Take me back!" returns to step 1. Click the forward button → exit transition fades the interface out, fades in a spinner bottom-right and a centered branching message ("We get it, onboardings suck." if no traits, "Somehow we already knew that about you…" if any), then dispatches `setStep(3)`.
- isRoute: FALSE
- Route: —
- hasDatashape: FALSE
- Datashape: reads/writes `onboarding/state.jsx` (`providerKind`, `traits`)
- exposedDatashapes: `onb.providerKind` (carryover gate), `onb.traits`, `onb.setTraits`, `onb.setStep`
- Hooks: `useAnimationTimeline`, `useOnboarding`, `useState`, `useRef`, `useEffect`
- Conditions:
  - `hasThanks = !!onb.providerKind` drives the carryover branch and the timeline `skip` flag
  - thanks/spinner conditional render gated on `thanksOp > 0.001`
  - `hasSelection = traits.length > 0` flips the bottom-right button between "I'd rather not say" (outline) and "Next" (filled accent)
  - active-trait-chip styling: `traits.includes(t.id)` toggles accent fill / inverted ink
  - `exitStartT != null` gates the exit visuals + blocks toggleTrait / takeMeBack / forward mid-transition; `exitMessage` captured at click time picks the branching copy; a `setTimeout(..., EXIT_TOTAL_MS)` dispatches `onb.setStep(3)`
- Components: `SnakeSpinner`, `S.Button`, `S.ButtonLabel`, `S.ButtonOutline`, `S.ButtonOutlineLabel`
- Atoms: `Box`, `Col`, `Row`, `Pressable`, `Text`
- isUsingTheme: TRUE — every surface goes through a classifier in `components.cls.ts` (`AppPromptText`, `AppGreet`, `AppExitMessage`, `AppTraitGrid`, `AppTraitChip` / `AppTraitChipActive`, `AppTraitChipText` / `AppTraitChipTextActive`, `AppStepFrame`, `AppStepCenter`, `AppStepCenterCol`, `AppStepBottomLeft`, `AppStepBottomRight`, `AppStepDimmable`)
- hasIcons: FALSE
- Icons: —
- hasAnimation: TRUE
- Animations (single shared `useAnimationTimeline`):
  - Entry timeline:
    - Carryover thanks hold + fade 500→1400 ms
    - Carryover spinner fade 500→1400 ms
    - Main message fade-in 1400→1950 ms
    - Main message slide up 1950→2450 ms (60 px)
    - Trait grid fade-in 2450→3050 ms (single block, not staggered per chip)
    - Bottom buttons fade-in 3050→3450 ms
    - Direct-nav fast-forward via `skip + skipOffsetMs = 1400 ms` when `providerKind` is null
  - Exit timeline (relative to forward click; 1900 ms total):
    - Menu / trait-grid / buttons fade out 0→380 ms (via `menuOpacityMul = 1 - exitMenuOut` cascading on the centered Col)
    - Spinner fades in 190→665 ms (bottom-right, separate render gated on `exitStartT != null`)
    - Branching message fades in 570→1235 ms (centered): `EXIT_MSG_NO_SELECTION` "We get it, onboardings suck." vs `EXIT_MSG_HAS_SELECTION` "Somehow we already knew that about you…" — picked at click time and stored in `exitMessage` state so it's stable across the transition
    - Dispatch `setStep(3)` at 1900 ms
- TODO:
  - The chip catalog now lives in `cart/app/onboarding/traits.js` (extracted so `state.jsx` can map ids→accommodation notes without a circular import). When the survey grows past hand-curation, swap to a persisted catalog row in the gallery data graph.
- PROBLEMS:
  - Toggling traits fires an async `userStore.update(USER_ID, ...)` per click. Rapid taps theoretically race read-modify-write — the `useCRUD` write path is `get → merge → set`, and two writes back-to-back can clobber each other if the second reads before the first persists. Hasn't been observed in practice; watch for it if a user mass-toggles. Possible mitigations: debounce `setTraits`, or batch into a single in-flight write with a follow-up.

---

### Step 3 — Config path — `onboarding/Step4.jsx` — WIP

CHECKLIST:
- Purpose: Onboarding step 3. Carries over Step3's exit-final frame (the branching "We get it…" / "Somehow we already knew…" message + bottom-right spinner) when `providerKind` is set, eases everything out, fades in "Where would you like to store your config files?", slides it up, fades in a `TextInput` whose placeholder is `~/.app/config`. Bottom-right shows "Use default" (outline) until any character is typed — then the same anchor swaps to "Next" (filled accent). "Use default" commits the placeholder string `~/.app/config`; "Next" commits the trimmed input. Bottom-left "Take me back!" returns to step 2. Click forward → exit transition fades the interface out, fades in spinner bottom-right + centered "Got it." bridge message, then dispatches `setStep(4)`.
- isRoute: FALSE
- Route: —
- hasDatashape: FALSE
- Datashape: reads/writes `onboarding/state.jsx` (`providerKind`, `traits`, `configPath`)
- exposedDatashapes: `onb.providerKind` (carryover gate), `onb.traits` (carryover message picker), `onb.configPath`, `onb.setConfigPath`, `onb.setStep`
- Hooks: `useAnimationTimeline`, `useOnboarding`, `useState`, `useRef`, `useEffect`
- Conditions:
  - `hasCarry = !!onb.providerKind` drives the carryover branch and the timeline `skip` flag
  - `traits.length > 0` picks `CARRY_MSG_HAS_SELECTION` else `CARRY_MSG_NO_SELECTION` — keeps the Step3→Step4 message visually continuous
  - carry message + spinner conditional render gated on `carryOp > 0.001`
  - `hasInput = trimmedPath.length > 0` flips the bottom-right between "Use default" (outline) and "Next" (filled accent)
  - forward commits `DEFAULT_CONFIG_PATH = '~/.app/config'` when `hasInput` is false, else the trimmed live value (read off `pathRef.current` to dodge stale closures)
  - `exitStartT != null` gates the exit visuals + blocks forward / takeMeBack mid-transition; `setTimeout(..., EXIT_TOTAL_MS)` dispatches `onb.setStep(4)`
- Components: `SnakeSpinner`, `S.Button`, `S.ButtonLabel`, `S.ButtonOutline`, `S.ButtonOutlineLabel`
- Atoms: `Box`, `TextInput`
- isUsingTheme: TRUE — every surface goes through a classifier in `components.cls.ts` (`AppPromptText`, `AppGreet`, `AppExitMessage`, `AppNameInput` (reused for the path field), `AppStepFrame`, `AppStepCenter`, `AppStepCenterCol`, `AppStepBottomLeft`, `AppStepBottomRight`, `AppStepDimmable`)
- hasIcons: FALSE
- Icons: —
- hasAnimation: TRUE
- Animations (single shared `useAnimationTimeline`):
  - Entry timeline:
    - Carryover Step3 message hold + fade 500→1400 ms
    - Carryover spinner fade 500→1400 ms
    - Main prompt fade-in 1400→1950 ms
    - Main prompt slide up 1950→2450 ms (60 px)
    - Path input fade-in 2450→3050 ms
    - Bottom buttons fade-in 3050→3450 ms
    - Direct-nav fast-forward via `skip + skipOffsetMs = 1400 ms` when `providerKind` is null
  - Exit timeline (relative to forward click; 1900 ms total):
    - Menu / input / buttons fade out 0→380 ms (via `menuOpacityMul = 1 - exitMenuOut` cascading on the centered Col + the corner anchors)
    - Spinner fades in 190→665 ms (bottom-right, separate render gated on `exitStartT != null`)
    - "Got it." bridge message fades in 570→1235 ms (centered, `AppGreet`)
    - Dispatch `setStep(4)` at 1900 ms
- TODO:
  - Validate / normalize the path (resolve `~` to `$HOME`, ensure absolute) at homepage read-time. Today the raw string survives untouched into `User.configPath`.
  - Optionally surface a "directory exists / will be created" hint under the input.
- PROBLEMS: none known.

---

### Step 4 — First goal — `onboarding/Step5.jsx` — Complete

CHECKLIST:
- Purpose: Onboarding step 4 (the last step). Carries over Step4's "Got it." + spinner when a `configPath` is set, eases everything out, fades in "What is your first goal?" with the word **goal** rendered as a tooltip-bearing hyperlink (accent color + underline; hover surfaces a popover descriptor of what a goal is). Below the prompt is a wide `TextInput` for the open-ended goal. Bottom-left "Take me back!" returns to step 3. The bottom-right cluster ("I don't know" outline + "Finish" filled) is hidden until the user types their first character — at that moment both fade in together over `FORWARD_FADE_MS`. Either button starts the exit (Finish commits `goal = trimmedGoal`; "I don't know" commits an empty goal). Exit fades the interface out, fades in a spinner bottom-right + centered "Welcome aboard." bridge, then calls `onb.markComplete()` so `IndexPage` swaps over to the home placeholder.
- isRoute: FALSE
- Route: —
- hasDatashape: FALSE
- Datashape: reads/writes `onboarding/state.jsx` (`configPath`, `goal`, `complete`)
- exposedDatashapes: `onb.configPath` (carryover gate), `onb.goal`, `onb.setGoal`, `onb.markComplete`, `onb.setStep`
- Hooks: `useAnimationTimeline`, `useOnboarding`, `useState`, `useRef`, `useEffect`
- Conditions:
  - `hasCarry = configPath.length > 0` drives the carryover branch and the timeline `skip` flag
  - bridge message + spinner conditional render gated on `bridgeOp > 0.001`
  - `hasInput = trimmedGoal.length > 0` arms the forward cluster: an effect captures `forwardAtT = tl.tRef.current` on the rising edge and resets to `null` if the input goes empty again, so the Row genuinely re-fades when the user clears + retypes
  - finish path requires a non-empty goal; "I don't know" path explicitly persists `''` so downstream code can distinguish "user said nothing" from "user is mid-type"
  - `exitStartT != null` gates the exit visuals + blocks finish / dontKnow / takeMeBack mid-transition; `setTimeout(..., EXIT_TOTAL_MS)` calls `onb.markComplete()` (no `setStep` — `complete=true` is the terminal state)
  - `<Tooltip>` wraps the `goal` link with `side='top'`, `delayMs={200}`, copy in `GOAL_TOOLTIP`
- Components: `Tooltip` (`runtime/tooltip/Tooltip`), `SnakeSpinner`, `S.Button`, `S.ButtonLabel`, `S.ButtonOutline`, `S.ButtonOutlineLabel`
- Atoms: `Box`, `TextInput`
- isUsingTheme: TRUE — every surface goes through a classifier in `components.cls.ts` (`AppPromptText`, `AppPromptRow`, `AppPromptLink`, `AppPromptLinkText`, `AppGreet`, `AppNameInput` (reused for the goal field), `AppStepFrame`, `AppStepCenter`, `AppStepCenterCol`, `AppStepBottomLeft`, `AppStepBottomRight`, `AppStepBottomRightRow`, `AppStepDimmable`)
- hasIcons: FALSE
- Icons: —
- hasAnimation: TRUE
- Animations (single shared `useAnimationTimeline`):
  - Entry timeline:
    - Carryover bridge ("Got it.") hold + fade 500→1400 ms
    - Carryover spinner fade 500→1400 ms
    - Main prompt + hyperlink fade-in 1400→1950 ms
    - Main prompt slide up 1950→2450 ms (60 px)
    - Goal input fade-in 2450→3050 ms
    - "Take me back!" fade-in 2450→3050 ms (paired with the input phase)
    - Forward cluster ("I don't know" + "Finish") fade-in: starts at the moment `hasInput` first goes true, 350 ms long
    - Direct-nav fast-forward via `skip + skipOffsetMs = 1400 ms` when `configPath` is empty
  - Exit timeline (relative to finish/dontKnow click; 1900 ms total):
    - Menu / input / buttons fade out 0→380 ms (via `menuOpacityMul = 1 - exitMenuOut`)
    - Spinner fades in 190→665 ms (bottom-right)
    - "Welcome aboard." bridge fades in 570→1235 ms (centered, `AppGreet`)
    - Dispatch `markComplete()` at 1900 ms
- TODO:
  - Move popover copy into a content file (i18n + edit-without-cart-rebuild) once one exists. Today it lives inline in `Step5.jsx` (`GOAL_TOOLTIP`).
  - Optional: secondary tooltip / micro-help on the input itself if the goal vocabulary needs more handholding.
- PROBLEMS: none known.

---

## State, library, manifest

### Onboarding state provider — `onboarding/state.jsx` — WIP

**Persistence is live.** State.jsx now writes to the gallery data graph through `useCRUD` (namespace `app`). The captured fields don't sit on `User.onboarding` as a blob — each one lands in its proper home: `name → User.displayName`, `traits → User.preferences.accommodations[]` (catalog notes from `traits.js`), `configPath → User.configPath`, `goal → Goal row`, provider pick + form values → a `Connection` row + `Settings.defaultConnectionId/defaultModelId`. `User.onboarding` keeps just the meta (status / step / timestamps / tourStatus). On bootstrap the provider follows User → Settings → Connection to recover `providerKind`, and lists Goals (workspaceId='ws_local', originActor='user') for goal text. Set `SEED_COMPLETED_USER = true` at the top of state.jsx to short-circuit a fresh boot straight into the homepage for dev iteration.

The previous in-memory shape lives at `state_old.jsx` as a breadcrumb; safe to delete after the next homepage pass lands.

CHECKLIST:
- Purpose: React context provider holding the onboarding record. In-memory `useState` slots act as the optimistic cache; setters write through to per-collection `useCRUD` instances. Single namespace `app` so a localstore wipe clears everything cleanly.
- isRoute: FALSE
- Route: —
- hasDatashape: TRUE (multi-collection)
- Datashape:
  - **User** (`cart/app/gallery/data/user.ts`) — id `user_local`, holds `displayName`, `bio`, `configPath`, `preferences.accommodations[]`, `onboarding.{status,step,startedAt,completedAt,skippedAt,tourStatus}`
  - **Settings** (`settings.ts`) — id `settings_default`, holds `defaultConnectionId` + `defaultModelId` once `commitConnection` runs
  - **Privacy** (`privacy.ts`) — id `privacy_default`, seeded with sane defaults on first user creation
  - **Workspace** (`workspace.ts`) — id `ws_local`, `rootPath` from `__cwd` host fn, parent of every Goal row
  - **Connection** (`connection.ts`) — id auto-generated, kind/credentialRef derived from the Step2 form (api/claude/local pick + endpoint heuristic)
  - **Goal** (`goal.ts`) — id auto-generated, written at Step5 finish with `originActor='user'`, `userTurnText`/`statement` set from the typed text, `scopeDuration='long-term'`, `status='open'`
  - session-only (not persisted): `animationPlayedThisSession`, `homeEntryPlayed`
- exposedDatashapes: `step`, `totalSteps`, `complete`, `loading`, `setStep`, `markComplete`, `markSkipped`, `shouldPlayFirstStartAnimation`, `markFirstStartAnimationPlayed`, `homeEntryPlayed`, `markHomeEntryPlayed`, `tourStatus`, `acceptTour`, `declineTour`, `name`, `setName`, `providerKind`, `setProviderKind`, `commitConnection`, `traits`, `setTraits`, `configPath`, `setConfigPath`, `goal`, `setGoal`
- Hooks: `useCRUD` ×6, `useState`, `useEffect`, `createContext`, `useContext`, `useRef`
- Conditions:
  - Bootstrap effect on mount: `userStore.get('user_local')` → if null and `SEED_COMPLETED_USER` is true, seed a fully-onboarded record; if null otherwise, hold defaults and let the first setter create the user via `ensureUser`. If non-null, hydrate every slot (displayName, accommodations→traits, configPath, onboarding.{step,status,tourStatus}) and chase the User→Settings→Connection chain to recover `providerKind`, then list latest Goal for `goal`.
  - `loading=true` until bootstrap resolves (or fails); `page.jsx`'s `if (onb.loading) return null;` becomes load-bearing again
  - `setStep` clamps to `[0, TOTAL_STEPS-1]`, flips `animationPlayedThisSession` on forward advance, and patches `User.onboarding.step`
  - `setName` / `setConfigPath` / `setTraits` patch their respective User fields; setters return promises so FirstStep's `Promise.race(setName, 400ms)` ordering still holds
  - `setProviderKind` is in-memory only — the Connection row is created at Step2's `onNext` via `commitConnection({kind, endpoint?, apiKey?, model?, home?, path?})` so re-trying tiles doesn't churn rows
  - `commitConnection` reuses an existing Connection row when the kind matches; deletes + recreates on kind mismatch; updates `Settings.defaultConnectionId` + `defaultModelId` to point at it
  - `setGoal('')` is "I don't know" path — no Goal row is written; `setGoal(<text>)` updates the most recent user-origin Goal for `ws_local`, or creates one if missing (idempotent across edits)
  - `markComplete` writes `User.onboarding.status='completed'` + `completedAt` + flips `tourStatus: null→'pending'`
  - `markSkipped` writes `User.onboarding.status='skipped'` + `skippedAt`, leaves `tourStatus=null` (skipped users don't get a tour offer)
  - `acceptTour` / `declineTour` patch `User.onboarding.tourStatus`
  - `shouldPlayFirstStartAnimation` derived gate: `!complete && step === 0 && !animationPlayedThisSession`
- Components: `Ctx.Provider`
- Atoms: —
- isUsingTheme: FALSE
- hasIcons: FALSE
- Icons: —
- hasAnimation: FALSE
- Animations: —
- TODO:
  - Resolve `~` in `configPath` to `$HOME` at read-time when the homepage actually consumes it; today the raw string survives untouched
  - Replace canned model lists in `ApiKeyForm.probe` with a real HTTP call so `commitConnection` doesn't write a placeholder model id
  - When the homepage adds a "skipped mode" branch, stop hiding the tour banner via `tourStatus=null` and instead skip the offer purely via the `User.onboarding.status === 'skipped'` check
- PROBLEMS:
  - Schemas in `cart/app/gallery/data/*.ts` are JSON Schema documents, not runtime parsers — `useCRUD`'s `Schema<T>` contract is satisfied with identity passthrough today. Validation is the writer's responsibility. Lift to ajv-backed parsers when drift becomes a problem.
  - Bootstrap reads four to five collections in sequence (User, Settings, Connection, Goal list, plus Workspace/Privacy on first-create). Cold-boot adds a few ms before the loading flag flips; tolerable for now but worth re-examining if it ever feels sluggish.

---

### Shell stores — `shell.tsx` — Complete

CHECKLIST:
- Purpose: Module-level subscribe stores that the shell publishes and other parts of the cart consume. All follow the same `React.useSyncExternalStore` pattern (mirrors `runtime/theme.tsx`'s variant store).
  - **`inputFocal: boolean`** — `useInputFocal()` / `setInputFocal()` / `getInputFocal()`. Activities call `setInputFocal(true)` to take the persistent `<InputStrip>` into focal mode (state C in the GOLDEN shell state machine); `setInputFocal(false)` to release (state B). State PERSISTS across route changes — only the activity that took focus knows when it's done with it.
  - **`hudInsets: { bottom, left }`** — `useHudInsets()` / `setHudInsets(bottom, left)`. The shell publishes the animated bar reservation (and side rail width if/when pages opt in) each render tick from `ShellBody` (see **Animation principles → HUD / iframe split**). Pages consume `useHudInsets()` to apply matching internal padding so their bg paints edge-to-edge while their content stays clear of the HUD overlays.
  - **`settingsSection: string`** — `useSettingsSection()` / `setSettingsSection()` / `getSettingsSection()`. The active /settings sub-section (`user`, `customize`, `providers`, `models`, `actions`, `data`, `privacy`, `about`). The shell-rendered `<SettingsNav />` (top of the assistant rail) and the `<SettingsPage />` content body both subscribe; promoting the sub-nav to the HUD means active section can't live as page-local state anymore. `/settings/customize` also writes this store on mount so the URL and active rail state agree.
- isRoute: FALSE
- Route: —
- hasDatashape: FALSE (each store is a plain JS value at module scope)
- Datashape: —
- exposedDatashapes: `useInputFocal(): [boolean, (v: boolean) => void]`, `setInputFocal(v: boolean)`, `getInputFocal(): boolean`, `useHudInsets(): { bottom: number; left: number }`, `setHudInsets(bottom: number, left: number)`, `useSettingsSection(): [string, (v: string) => void]`, `setSettingsSection(v: string)`, `getSettingsSection(): string`
- Hooks: `React.useSyncExternalStore` internally for each store
- Conditions: each setter is a no-op when the new value equals the current value (avoids re-notifying subscribers)
- Components: —
- Atoms: —
- isUsingTheme: FALSE
- hasIcons: FALSE
- Icons: —
- hasAnimation: FALSE (the HUD insets store is *driven by* the GOLDEN morph in `index.tsx`, but it's a publishing channel, not an animator)
- Animations: —
- TODO: persist `inputFocal` and `settingsSection` alongside the rest of `User.shell` (planned `useCRUD` slot) so reload doesn't drop them. See **Planned work → Side menu + activity host (remaining work)** for the full plan.
- PROBLEMS: module-level state doesn't survive Zig hot-reload; tolerable today since onboarding-complete users land in state A on reload anyway, but rebuilds during an activity drop the user out of focal mid-task.

---

### Trait catalog — `onboarding/traits.js` — Complete

CHECKLIST:
- Purpose: Single source of truth for the Step3 chip catalog. Each entry is `{ id, label, note }` — `label` is the chip text the user clicks, `note` is the worker-facing accommodation hint that lands in `User.preferences.accommodations[]` on lock-in. Also exports the helpers `traitsToAccommodations(ids)` and `accommodationsToTraits(accommodations)` that state.jsx uses to round-trip selections through disk. Extracted so Step3 (chip render) and state.jsx (id → accommodation row mapping) can both import without a circular dep.
- isRoute: FALSE
- Route: —
- hasDatashape: TRUE (companion to `User.preferences.accommodations[]` in `cart/app/gallery/data/user.ts`)
- Datashape: produces `UserAccommodation` rows (`{ id: 'acc_<traitId>', label, note }`) — round-trippable via the `acc_` prefix scheme.
- exposedDatashapes: `TRAITS` (the chip array), `TRAITS_BY_ID` (lookup map), `traitsToAccommodations(ids)`, `accommodationsToTraits(accommodations)`
- Hooks: —
- Conditions: `accommodationsToTraits` drops entries whose `id` doesn't begin with `acc_` or whose underlying trait id isn't in the catalog — older saves where the catalog has changed degrade silently rather than crashing hydration.
- Components: —
- Atoms: —
- isUsingTheme: FALSE
- hasIcons: FALSE
- Icons: —
- hasAnimation: FALSE
- Animations: —
- TODO: when the survey grows past hand-curation, lift the catalog to a persisted gallery row (`accommodation-catalog.ts`?) so users / future profiles can extend it without code changes.
- PROBLEMS: none.

---

### Animation timeline hook — `anim.js` — Complete

CHECKLIST:
- Purpose: Shared `useAnimationTimeline({ skip?, skipOffsetMs? })` hook. One frame-driven master clock per consumer with `range(a, b, easing?)` + `fadeOut(a, b, easing?)` helpers. The `skip` + `skipOffsetMs` pair fast-forwards the timeline so a screen can reuse the same phase constants whether or not a carryover stage is needed. Returns `tRef` to dodge the renderer's stale-closure trap on click handlers.
- isRoute: FALSE
- Route: —
- hasDatashape: FALSE
- Datashape: —
- exposedDatashapes: hook return = `{ t, elapsed, tRef, range, fadeOut }`
- Hooks: `useState`, `useEffect`, `useRef` (internally, lines 50–71)
- Conditions: `skip + skipOffsetMs` gate (lines 39–40, 64, 73)
- Components: —
- Atoms: —
- isUsingTheme: FALSE
- hasIcons: FALSE
- Icons: —
- hasAnimation: TRUE — this IS the animation primitive; consumers compose ranges off it
- Animations: provides the timeline; doesn't render anything itself
- TODO: optional spring variant for organic motion; opt-in pause-on-blur
- PROBLEMS: each consumer spawns its own frame loop. Multiple sibling animations can't share a single loop without manually lifting the timeline.

---

### Cart manifest — `cart.json` — Complete

CHECKLIST:
- Purpose: Cart metadata read by `scripts/ship` and `scripts/dev`. Sets the window dimensions and enables `customChrome: true` so the cart owns its own titlebar (rendered by `index.tsx` `Chrome`).
- isRoute: FALSE
- Route: —
- hasDatashape: FALSE
- Datashape: —
- exposedDatashapes: `name`, `description`, `customChrome`, `width`, `height`
- Hooks: —
- Conditions: —
- Components: —
- Atoms: —
- isUsingTheme: FALSE
- hasIcons: FALSE
- Icons: —
- hasAnimation: FALSE
- Animations: —
- TODO: add an icon path once we have one
- PROBLEMS: none

---

### Character provider — `character/state.tsx` — WIP

CHECKLIST:
- Purpose: In-memory optimistic cache + `useCRUD` write-through for the single Character row. Mirrors `cart/app/onboarding/state.jsx` shape: one collection (`character`) in the `app` namespace, hydrate on mount, every setter calls `patch()` which mirrors to the in-memory cache and the localstore. Provides `<CharacterProvider>` and `useCharacter()` to the Character workbench. The Manifest / QuizSession / CharacterCompatibility collections are deferred until the manifest page surfaces.
- isRoute: FALSE
- Route: —
- hasDatashape: TRUE
- Datashape: reads/writes `CharacterRow` (typed locally; mirrors `cart/app/gallery/data/character.ts` shape but stays cart-side until a shared types package exists). Stable id `char_default`; assistantId `assistant_default`; settingsId `settings_default`; userId `user_local`. Current row includes core identity, explicit assistant-mask authority, archetype/dial tuning, quirks, stance/initiative/correction, boundaries, task domains, relationship registers, user states, stakes, knowledge weights, instruction buckets (`do` / `prefer` / `avoid` / `never`), negative mode, roleplay identity, custom key/value properties, and optional identity-continuity fields. Gallery shape also declares `CharacterPromptSnapshot`, the compiled prompt-facing JSON block that should feed `src_character_snapshot`.
- exposedDatashapes: `CharacterRow` plus `CharacterContextValue` (the setter surface)
- Hooks: `useCRUD('character', passthrough, { namespace: 'app' })`; `useState`, `useEffect` for bootstrap; `useContext` via `useCharacter()`
- Conditions:
  - Bootstrap on mount: read `char_default` from store; if present, hydrate cache with `{ ...defaultCharacterRow(), ...existing, dialValues: dv, knowledgeWeights: kw }` so rows written before new fields/dials/weights were added still work; if absent, defaults stand and first setter call seeds the row.
  - `setArchetype` is a *batch* patch — overwrites dialValues + quirkIds + stance/initiative/correction in one update. After the patch, the archetypeId pointer survives but is cosmetic.
  - `setDialValue` clamps to `[0, 1]`.
  - `toggleQuirk`, `toggleBoundaryRule`, `toggleTaskDomain`, `toggleRelationshipRegister`, and `toggleUserState` are membership flips; stance/initiative/correction/stakes and roleplay identity fields are direct value setters.
  - `setKnowledgeWeight(domainId, value)` clamps to `[0, 1]`.
  - Optional identity-continuity setters are direct string patches: `setUserIdentityToCharacter`, `setRelationshipType`, `setRelationshipContext`, `setContinuitySeed`, `setGhostHistorySeed`, `setIdentityGuardrails`, `setIdentityRecoveryStyle`, `setFallbackDeflections`, `setDeliberationProfile`, `setAvailabilityProfile`, `setDeliveryPattern`.
  - `save()` bumps `version` and write-throughs but does NOT yet emit `system:character:saved` on the IFTTT bus (TODO).
- Components: `CharacterProvider`
- Atoms: —
- isUsingTheme: FALSE
- hasIcons: FALSE
- Icons: —
- hasAnimation: FALSE
- Animations: —
- TODO:
  - Wire `busEmit('system:character:saved', { characterId })` in `save()` — the recipe at `cart/app/recipes/character-creator.tsx` declares the event hook; the shell subscriber lands when the theme-swap path is wired.
  - Add provider variants for `userManifest` / `quizSession` / `characterCompatibility` once `/manifest` is scoped.
  - Decide grain question (open thread): does Character switch with the active Settings profile, or is it User-grain with per-profile visibility?
- PROBLEMS:
  - Single-row only — `CHARACTER_ID = 'char_default'` is hardcoded. Multi-character + active-pointer (`Assistant.activeCharacterId`) lands when the picker UI ships.
  - Local types duplicate the gallery shape's structure (intentionally, to avoid cart→cart imports). Will collapse to one source of truth when a shared types package exists.

---

### Character catalog — `character/catalog.ts` — Complete

CHECKLIST:
- Purpose: Co-located reference data the Character page reads: 12 archetypes (with `defaultDialValues`/`defaultQuirkIds`/default stance/initiative/correction), 38 bipolar dials, 8 quirks, the relationship-stance / initiative-profile / correction-style enum option lists, 5 sample boundary-rule labels, 38 task domains, 13 relationship registers, 14 user-state chips, 4 stake profiles, 10 knowledge specializations, and the `DEFAULT_AVATAR` `AvatarData` for the preview pane. Mirrors the gallery shapes (`cart/app/gallery/data/{character-archetype, personality-dial, character-quirk, constraint, avatar}.ts`) by hand; will converge on a shared package later.
- isRoute: FALSE
- Route: —
- hasDatashape: FALSE (this is *catalog* data — the shape it mirrors is in the gallery)
- Datashape: produces `Archetype[]`, `Dial[]`, `Quirk[]`, stance/initiative/correction option lists, `BoundaryRule[]`, `CatalogOption[]` groups, `KnowledgeSpecialization[]`, `DEFAULT_AVATAR: AvatarData`. Plus `defaultDialValues()` helper that derives a fresh `Record<dialId, number>` from the catalog defaults.
- exposedDatashapes: `Archetype`, `Dial`, `Quirk`, `BoundaryRule`, `CatalogOption`, `KnowledgeSpecialization`, `RelationshipStance`, `InitiativeProfile`, `CorrectionStyle`, `ArchetypeId`
- Hooks: —
- Conditions: dial value defaults are baked at module scope; `defaultDialValues()` returns a fresh shallow copy each call so callers can mutate.
- Components: —
- Atoms: —
- isUsingTheme: FALSE
- hasIcons: FALSE
- Icons: —
- hasAnimation: FALSE
- Animations: —
- TODO:
  - Collapse to a single source of truth once a shared types/data package exists between cart and gallery.
  - Keep assistant-generated "more" results runtime-only until there is a reviewed/user-owned extension table for catalog additions.
- PROBLEMS:
  - Hand-mirrored data drifts if the gallery's catalog grows. Today only the form consumes this; if other carts start reading the gallery shapes directly the duplication becomes a real pain.

---

### Assistant / Supervisor / Worker / Character data split — `gallery/data/{assistant,supervisor,worker,character}.ts` — WIP

CHECKLIST:
- Purpose: Four distinct runtime identities. `Assistant` is the durable long-term user-facing identity; `Character` is an Assistant-only presentation mask; `Supervisor` is the fixed task-local spec enforcer/orchestrator; `Worker` is the runtime executor owned by Supervisor. References connect the tables for querying; they do not imply the rows can become each other.
- isRoute: FALSE
- Route: —
- hasDatashape: TRUE
- Datashape:
  - `Assistant`: long-term identity, user/settings references, activeCharacterId, defaultSupervisorId, manifest/goal memory policy, and authority flags that explicitly say it does not supervise workers and cannot become Supervisor/Worker.
  - `Character`: assistantId-backed mask for Assistant only. Includes voice/personality/negative traits and compiled `CharacterPromptSnapshot`.
  - `Supervisor`: assistantId-backed fixed task-local orchestrator. Keeps 15-30 minute task context policy, spec-enforcement authority, and `fixedCrew[]` slots.
  - `Worker`: supervisorId-backed executor. Has `crewMode` (`fixed` / `spawned`) and `crewSlotId` for the fixed crew experiment. Worker has no Character reference.
- exposedDatashapes: `Assistant`, `Supervisor`, `Worker`, `Character`, `CharacterPromptSnapshot`
- Hooks: consumed through `useCRUD` when mounted by app surfaces; gallery stories expose static schemas/mock data
- Conditions:
  - `Character.assistantId -> Assistant.id`; Character never references Supervisor or Worker.
  - `Supervisor.assistantId -> Assistant.id`; Supervisor can receive assistant briefings but cannot override Assistant and cannot become Assistant.
  - `Worker.supervisorId -> Supervisor.id`; Worker receives assignment/spec slices, not Assistant character or Supervisor identity.
  - `Supervisor.fixedCrew[].workerId -> Worker.id` supports the stable crew experiment without collapsing Worker into Supervisor.
- Components: —
- Atoms: —
- isUsingTheme: FALSE
- hasIcons: FALSE
- Icons: —
- hasAnimation: FALSE
- Animations: —
- TODO:
  - Add `SupervisionSession` once task-local session state needs its own persisted lifecycle separate from the fixed Supervisor identity.
  - Decide whether fixed crew is the default or an optional mode after the first orchestration prototype.
- PROBLEMS:
  - `Worker` still carries `parentWorkerId` / `childWorkerIds` for worker-to-worker delegation; those fields are no longer the Supervisor chain and should be used sparingly.

---

### IFTTT / supervisor substrate — `runtime/hooks/*`, `cart/app/db/*` — WIP

CHECKLIST:
- Purpose: The reactive substrate that everything in cart/app composes onto. A bus (subscribe/emit + wildcard subscribeAll), a registry of trigger sources and action runners with longest-prefix-match resolution, a set of stateful aggregation primitives (`count:` / `firsthit:` / `repeat:` / `registerGate`), a host↔guest transport (`vsock` with three-tier selection: production AF_VSOCK Zig binding when present, in-process LocalPair simulator otherwise, NullTransport as last resort), and a row-driven engine layer (`vm-bridges` auto-attaches per running `worker-session.vmid`, `claim-engine` runs claim detection + verify-gate per running session, `mechanical-wires` persists supervisor actions to DB, `rule-binder` binds `rule` rows as live `useIFTTT` calls). All exhaustively documented in `docs/v8/useIFTTT.md`.
- isRoute: FALSE
- Route: —
- hasDatashape: TRUE (substrate produces lifecycle channels + consumes row writes)
- Datashape:
  - **Sources** (every `registerIfttSource` prefix): `mount`, `click`, `key:*`, `key:up:*`, `timer:every:*`, `timer:once:*`, `state:*`, `proc:line:*` / `proc:ram:*` / `proc:cpu:*` / `proc:idle:*`, `fs:changed:*` / `fs:created:*` / `fs:deleted:*` / `fs:any:*`, `select:cleared` / `select:any` / `select:nonempty` / `select:long:*` / `clipboard:copy`, `match:*::*`, `count:*::*:*`, `firsthit:*::*`, `repeat:*::*:*`, `vm:*`, `turn:tool-count`, kind-filtered `event:*` / `rule:*.fired` / `verb:*.<status>` / `worker:*.<lifecycle>` / `run:*.<status>` (with `.*` suffix wildcard). Plus the raw bus channels: `event:append`, `rule:fired`, `verb:lifecycle`, `worker:lifecycle`, `run:lifecycle`, `session:lifecycle`, `claim:lifecycle`, all `system:*`, `turn:start` / `turn:end` / `turn:tool-use`.
  - **Actions** (every `registerIfttAction` prefix): `state:set:*` / `state:toggle:*`, `send:*`, `log:*`, `clipboard:*`, `proc:spawn:*` / `proc:kill:*` / `proc:write:*`, supervisor verbs `halt-run` (+ `halt-run:<reason>`) / `flag-pathology:*` / `invoke-verb:*` / `fire-rule:*` / `kick-to-supervisor` / `notify-user:*` / `inject-message:*` / `spawn-worker:*` / `modify-assembly:*` / `set-variable:*` / `commit-state` / `mark-status:*` / `queue-job:*`. All thirteen supervisor verbs emit their normalized `supervisor:<kind>` bus event for the writer side to persist.
  - **Programmatic API**: `useIFTTT(trigger, action) → IFTTTResult`, `busOn` / `busEmit`, `getSharedState` / `setSharedState`, `dispatchClaudeEvent`, `registerIfttSource` / `registerIfttAction` / `setIfttFallback` / `resolveTrigger` / `dispatchAction` / `listIfttSources` / `listIfttActions`, `compileTrigger` / `isComposable` / `substituteAction`, `registerGate({ after, suspect, requires, key?, onFire })`, `similarity(a, b)`, `currentTurn()`, `openVsock` / `mirrorChannel` / `mirrorChannels` / `mirrorPrefix` / `namespaceMirror` / `namespaceForward`, `attachVm` / `detachVm` / `listAttachedVms`, `installVmBridges` / `uninstallVmBridges` / `listVmBridgeRefs`, `installClaimEngine` / `uninstallClaimEngine` / `attachClaimDetector` / `listOpenClaims` / `resolveClaim`.
- exposedDatashapes: `Claim`, `WorkerSession.vmid` (added 2026-05-06).
- Hooks: `useIFTTT` is a React hook; everything else is plain functions. The bus is a module-singleton on top of `runtime/ffi.ts`.
- Conditions:
  - The Zig vsock binding contract is at `framework/v8_bindings_vsock.zig` but **not yet registered in `build.zig`** — `vsock.ts` falls through to `LocalPair` for in-process testing. Activating production AF_VSOCK is one TODO block + one registration call.
  - `useIFTTT` plain function triggers depend on render cadence; refs don't trigger re-renders. Composable function leaves are polled every 50ms regardless.
  - `mirrorChannel` has a re-entrancy guard so a same-channel double-mirror doesn't infinite-loop. Production patterns use asymmetric `namespaceMirror` + `namespaceForward` which can't loop.
  - The claim ledger's `injectTemplate` writes back to the agent through `supervisor:inject-message` → worker shell cart's stdin pipe. The vmid on the action's namespace prefix routes to the right VM.
- Components: —
- Atoms: —
- isUsingTheme: FALSE
- hasIcons: FALSE
- Icons: —
- hasAnimation: FALSE
- Animations: —
- TODO:
  - **Land the Zig vsock binding** (`framework/v8_bindings_vsock.zig` AF_VSOCK + AF_UNIX flavors, register in `build.zig`). Until then VM↔host mirroring works only in-process via LocalPair.
  - **Wire `installVmBridges()` / `installClaimEngine()` / `installMechanicalWires()` / `bindRules()` into the shell mount path** — currently each cartridge has to install them by hand. Sweatshop hasn't yet (see Sweatshop entry above).
  - **Pathology dictionary auto-binder** — for each active `Pathology` row, register a `match:vm:<vmid>:event:append::<spec>` per running session. Adding a banned phrase becomes a row insert. ~80 lines next to `claim-engine.ts`.
  - **Plan / TODO ledgers** — same shape as claim-engine for the verify-loop V6/V7/V8 catalog scenarios.
  - **Subagent inheritance walk** in claim-engine for V16.
  - **Claim-shape semantic similarity** — `repeat:semantic:*` source backed by an embedding model when the substring Jaccard isn't enough.
- PROBLEMS:
  - State persistence: `state:*` shared state is module-local in-memory. Survives within a session, not across process restart.
  - Cross-process pair (real two reactjit instances over Unix sockets) is not yet implemented; LocalPair only pairs within a single JS process.
- Files:
  - **Bus**: `runtime/ffi.ts` (`subscribe` / `subscribeAll` / `emit`)
  - **Registry**: `runtime/hooks/ifttt-registry.ts`
  - **Hook surface**: `runtime/hooks/useIFTTT.ts` (React hook + built-in triggers/actions + Claude hook fanout)
  - **Composables**: `runtime/hooks/ifttt-compose.ts` (`{all, any, seq, debounce, throttle, cooldown, once}`)
  - **Source primitives**: `runtime/hooks/ifttt-match.ts`, `ifttt-count.ts`, `ifttt-firsthit.ts`, `ifttt-repeat.ts`, `ifttt-gate.ts`, `system_selection.ts`, `process.ts` (proc:*), `useFileWatch.ts` (fs:*), `turn-tracker.ts`
  - **Supervisor channels + actions**: `runtime/hooks/ifttt-supervisor.ts`
  - **VM boundary**: `runtime/hooks/vsock.ts`, `runtime/hooks/ifttt-vm.ts`, `framework/firecracker/vm-runtime/cart.tsx` (in-VM worker shell), `framework/firecracker/lib/with-worker-runtime.ts` (recipe helper), `framework/v8_bindings_vsock.zig` (Zig contract — stub)
  - **Engines (cart-side)**: `cart/app/db/buses.ts` (row→channel mapping), `cart/app/db/vm-bridges.ts` (auto-attach), `cart/app/db/claim-engine.ts` (claim detector + verify-gate), `cart/app/db/mechanical-wires.ts` (action runners), `cart/app/db/rule-binder.ts` (`rule` rows → live bindings)
  - **Entities**: `cart/app/gallery/data/core/claim.ts`, `pathology.ts`, `pathology-detection.ts`, `worker-session.ts` (with vmid), plus the rest of the supervisor-sweatshop bucket
  - **Docs**: `docs/v8/useIFTTT.md` (canonical, code↔doc audited 2026-05-07)
  - **Tests**: `scripts/event-loop-smoke` (33-assertion v8cli smoke), `cart/event_loop_autotest.tsx` (real-cart autotest, 14 assertions including React lifecycle / function triggers / composables)

---

## Planned work

The sections below are *forward-looking* plans, not file entries. They live here so the architecture and the work-not-yet-done are in one place; the per-file index above stays a clean per-file map.

### Sweatshop canvas → live bindings

Drag-to-edit canvas already renders palette nodes from the live IFTTT registry. The remaining work to make wiring a node light a real rule:

1. **Compile-from-graph** — `cart/app/sweatshop/canvas/compile.ts`. Walk `FlowNode[]` + `FlowEdge[]` and emit `{ trigger, action }` pairs. Spec strings come from palette node types + port wiring. Returns a teardown function.
2. **Mount-time engine boot** — in `sweatshop/page.tsx` (or a `useSweatshop()` provider), call `installVmBridges()`, `installClaimEngine()`, `installMechanicalWires()`, `bindRules()` on mount; reverse on unmount.
3. **Live re-bind** — when the graph edits, re-run compile + tear down old bindings + apply new ones. Diff to keep stable subscriptions where the graph didn't change.
4. **Persistence** — write the canvas state to a `composition` row through `useCRUD` so reloads survive, and publish `composition.<id>.updated` through buses so other cartridges can react.

After (1)+(2), a user dragging `match:event:append::pkill` and connecting it to `flag-pathology:pat_session_kill_pattern` produces a live binding that fires on pattern hit. After (3), edits are reactive. After (4), the canvas state is a real entity in the DB layer alongside `goal`, `character`, `pathology`.

### Character creator follow-up scope

The Character page is live now; this section tracks the parts that remain follow-up rather than describing the already-shipped surface.

- **Save event.** `save()` still needs to emit `system:character:saved` so the shell can apply the character-creator recipe's event hook.
- **Multiple personas.** Add an active-character pointer and a picker so different cartridges/contexts can use different assistants.
- **Compatibility view.** Use the active character plus UserManifest to produce an honest "how we will work together" readout and suggested adjustments.
- **Personality drift detection.** Repeated corrections like "shorter" or "push back more" should offer to change the Character row.
- **User-owned catalog extension.** Assistant-generated "more" options are currently transient chat output; persisting them needs a reviewed extension table or explicit user save path.
- **Avatar/profile pipeline.** Replace the v1 mannequin/default avatar with a real generated or assembled assistant embodiment.
- **Richer optional identity editors.** Relationship projection, continuity, guardrails, deflections, and delivery patterns are optional and persisted, but currently edited through compact single-line fields.

### Personality Survey page

Same shape — data ships today, page is next. Scope:

- **Manifest digest panel.** High-confidence dimensions surfaced as small cards (`generic-card` shape with `news-feed-post` density). Confidence visualized through organic affordances (saturated-vs-faded, "still getting to know you" copy) — no percentage bars per PRD §5.
- **Quiz feed.** When the engine has a fresh `QuizSession`, a card mounts here with the chat-loom intent tree rendered inline via `runtime/intent/render.RenderIntent`. Submitting fires `system:quiz:answered`; the cart runs the infer turn and the manifest updates.
- **"Still getting to know you" status row.** One-line organic-metaphor strip indicating how complete the read is (e.g. "We've talked through 6 of 9 lenses on you" — never a percent).
- **Anomaly recheck banner.** When `manifest:anomaly-detected` fires, a one-line nudge offers a re-check quiz on that specific dimension.
- **Friction panel.** When the active `CharacterCompatibility` row carries non-empty `frictionAlerts[]`, a side panel surfaces them with the recommended adjustments. Tapping an adjustment applies it to the active Character.
- **Privacy controls.** Per-dimension visibility (visible / anonymized / hidden) per the manifest privacy thread (see open threads).

Quiz LLM round-trip uses the `comp_quiz_author` + `comp_quiz_infer` compositions declared by [`cart/app/recipes/personality-quiz-engine.tsx`](recipes/personality-quiz-engine.tsx).

### Side menu + activity host (remaining work on the GOLDEN shell)

The three-state shell (A / B / C) and the input morph machinery shipped in commits `3bad2f07d` → `6aa1cd24c`. See **Animation principles → Input-strip shell morph (GOLDEN)** for the canonical description; this section is the punch list of what's left.

**What's done** (don't re-plan these — see GOLDEN):
- Three-state shell with the `headingTo` derivation, the `TARGETS` table, the variant-flip pivot, and the six transitions (A↔B, A↔C, B↔C).
- Route trigger via `mode: 'full' | 'side'` on each `ROUTES` entry; `nav.push` is the entry point.
- Focus trigger via `cart/app/shell.tsx` (`useInputFocal()` / `setInputFocal()`); state persists across route changes.
- Activity host (basic): activity routes render in the same routes Box as the rest; layout reflows around the slots via `paddingLeft: sideWidth, paddingBottom`. `cart/app/sweatshop/page.tsx` is the worked example.

**Side menu content.** `AppSideMenuInput` is empty above the docked input today (state B) and entirely empty in state C. Needs:
- A nav list (Home / Files / Memory / Settings shape from `cart/input_lab/`).
- A chat-history list, visible in C (the assistant's conversation history) and possibly in B (collapsed). Entries clickable → focal-back into a stored thread.
- Decide: app-wide nav vs. per-activity nav, or both stacked. Activity-specific items would require an activity registry (see below).

**Real triggers, not the debug toggles.** The top-left "SWEATSHOP →" / "FOCUS / UNFOCUS" buttons in `cart/app/index.tsx` are placeholders. Real triggers:
- **`@-token` for activities** — add an `activity` token type to `tokens.ts`; `InputStrip.submit()` fires `app:openActivity` (a new bus event) which `NavigationBus` (or a sibling) translates into `nav.push('/activity/<id>')`.
- **Grid-tile click on the home page** — the home menu's items already include "Sweatshop" etc.; wire each tile to `nav.push('/activity/<id>')`.
- **Activity-internal focus triggers** — already handled by `setInputFocal(true)` calls inside the activity (sweatshop's worker tiles do this). Pattern: any pressable that opens a chat thread.

**Activity registry / manifest.** Today an "activity" is just a route component. Future shape probably needs:
- A registered set somewhere (so the side menu can list them) — `cart/app/activities.ts` or similar, mapping id → `{ component, label, icon, defaultFocal? }`.
- Lifecycle hooks: `onOpen`, `onClose`, `onResize`, optional `onMessage` (for routing chat input to the active activity).
- Title source for `ActivityChrome` (a future titlebar component).

**Persistence.** `inputFocal` lives in a module-level store and resets on Zig hot-reload. Wire into `cart/app/onboarding/state.jsx`'s `useCRUD` namespace as `User.shell.{focal: boolean, lastActivityId?: string}` so reload restores both axes.

**Top-chrome reconciliation.** Today's `Chrome` carries brand + nav + window controls. In states B/C the side menu would normally replace the chrome's nav row; chrome reduces to brand + window controls. Decide whether the brand stays at the top or moves into the side menu's header.

**Routing inside activities.** `/`, `/settings`, `/composer`, `/character`, and `/gallery` are page-sized routes. In activity mode they currently still render at the page level — should some instead live inside the `ActivityHost`? Likely yes for tool-shaped routes (`/composer`, `/gallery`, maybe `/settings`); `/` stays as the home anchor.

**Open problems** (still open):
- **InputStrip sizing in the 360w side dock.** `CommandComposerFrame` has `minHeight: 206`, `CommandComposerMain` has asymmetric `paddingLeft: 32, paddingRight: 24`. At 360w the strip looks chunky and the asymmetric padding is visible. `useBreakpoint` is window-scoped (not container-scoped), so the `sm` variant won't fire from a dock. Cheapest fix: a `compact` prop the shell sets explicitly when docked.
- **`useBreakpoint` is window-scoped.** Same root cause; container-query-shaped hook is the real fix.
- **Onboarding gate.** During onboarding the shell should stay in state A — activity triggers must no-op until `onb.complete`. Wire when activity triggers ship.
- **Hot-reload state preservation.** `useHotState` + `framework/hotstate.zig` are wired but state resets on Zig reload. Until that's fixed, every Zig rebuild collapses to A and clears `inputFocal`.

---

### Deferred clarification flow

The current shape of `onboarding-first-impression` (see `cart/app/recipes/onboarding-first-impression.tsx`) is a **synchronous** 2-turn flow that would block the user at the end of Step 5 while the model asks 3 clarifying questions, waits for answers, then writes the profile. That's friction on the most fragile boundary in the app — the moment the user finally crosses out of onboarding. The plan is to **defer the clarifying turn** so onboarding completes immediately and the clarification surfaces opportunistically once the user is settled.

### Planned shape — Deferred clarification — Stub

CHECKLIST:
- Purpose: After Step 5 finishes, the user transitions into the home menu as today (no extra wait). Once they're settled in `HomeStatic`, at the next quiet moment — defined as *the model finished its current response AND the user hasn't typed for N seconds* — a small notification slides in from the side with copy like "Care to clarify?". Two responses: **No** dismisses and triggers a one-shot V1-style raw write of `first_impression.md` from the onboarding signal alone (no questions, no waiting). **Yes** expands the notification into an inline quick-respond surface — but we don't author that surface ourselves: the recipe's turn-1 fragment already asks the model to emit the questions as a chat-loom `<Form>` tree (see `cart/chat-loom.tsx`), so the cart parses the response with `runtime/intent/parser.parseIntent` and renders it directly via `runtime/intent/render.RenderIntent`. Each user gets a tailored questionnaire — labels, placeholders, even the framing `<Title>` — generated by the model rather than hardcoded by us. On submit, the chat-loom `<Submit reply>` template (`"A1: {q1}\nA2: {q2}\nA3: {q3}"`) interpolates the answers into the user-turn message of turn 2, which fires the write. Either path produces the same `first_impression.md` artifact; the path differs only in how much signal it carries.
- isRoute: FALSE (lives inside the home shell, not a route)
- Route: —
- hasDatashape: TBD — likely a `clarification` substate in `User.onboarding` carrying `{ status: 'pending' | 'dismissed' | 'answered' | 'skipped', firedAt?, answeredAt?, answers?: string[] }`. Lock in alongside the onboarding lock-in pass (see Open threads).
- Datashape: reads `OnboardingProvider` (name / traits / goal / configPath / providerKind) at fire time; writes the chosen-path artifact to `<configPath>/first_impression.md`.
- exposedDatashapes: `clarificationStatus`, `markClarificationFired`, `markClarificationDismissed`, `markClarificationAnswered(answers[])`
- Hooks: `useOnboarding`, `useIFTTT('system:claude:idle', ...)`, `useIFTTT('user:settled', ...)` or equivalent activity gate, a small dedicated animation timeline for the slide-in/expand notification
- Conditions:
  - **Fire gate:** `onb.complete && onb.homeEntryPlayed && clarificationStatus === null && claudeIsIdle && userIdleFor >= QUIET_MS` — all four must hold simultaneously. Default `QUIET_MS = ~6000` (long enough that we're not interrupting), tuned later.
  - **Dismiss path:** No → spawn the writing model with the V1 fragment + onboarding signal alone (no question turn). Persist `clarificationStatus = 'dismissed'` so we don't refire.
  - **Expand path:** Yes → expand the notification into the quick-respond surface, fire turn 1 of the recipe (3 clarifying questions), wait for the user's answers, fire turn 2 (write). Persist `clarificationStatus = 'answered'`.
  - **Skipped onboarding path:** if `user.onboarding.status === 'skipped'`, the recipe never fires (no signal to clarify against). Persist `clarificationStatus = 'skipped'`.
  - **Conflict / upset path:** if the user's submitted answers (or any later message that triggers a recipe-driven write) read as upset / conflict-shaped — by tone heuristic in v1, by a small classifier later — fire `comp_concern_structurer` from the recipe as a SEPARATE upstream Claude turn first. Prepend its output to the writing turn's user-message, then fire the writer. The structurer is the recipe's default enhancer for upset-shaped input; reproducible across three probes (first-impression / external-upset / profile-recovery). Do NOT use the alternative quantifier shape — it reproducibly cools the prose and narrows the scope of correction.
  - **Re-arming:** the notification fires at most once per onboarding completion. After dismiss/answered, it does not return on subsequent boots.
- Components: `ClarifyNotification` (the slide-in chrome card), `RenderIntent` from `runtime/intent/render` (renders the model's chat-loom tree as the expanded body — no custom Q&A surface to author), reuse `S.Button` / `S.ButtonOutline` for the Yes/No actions on the unexpanded card, reuse `SnakeSpinner` while the writing turn runs
- Atoms: `Box` for the notification chrome; the inner form is whatever the model emitted, rendered through `RenderIntent` (`<Form>` / `<Field>` / `<Submit>` already handled by `runtime/intent/render`). Cart-side classifiers TBD for the OUTER chrome only — likely `AppClarifyCard`, `AppClarifyCardExpanded`, `AppClarifyActions` (Yes/No row), `AppClarifyChrome` (the wrapping border / shadow that frames the rendered chat-loom body). No per-field classifiers — those live in `runtime/intent/render`.
- isUsingTheme: TRUE for the chrome (classifiers in `components.cls.ts`); the inner chat-loom render currently has its own inline styling — see PROBLEMS below.
- hasIcons: TBD — probably a small bell / sparkle in the notification chrome
- Icons: —
- hasAnimation: TRUE
- Animations:
  - Slide-in (notification appears): ~400 ms ease-out, from off-screen-right to the corner
  - Expand (Yes click): the card height + width grow to fit the rendered chat-loom tree, ~500 ms; the parsed `<RenderIntent>` content fades in 200 ms after the size change starts
  - Collapse on dismiss (No click): card slides back out as the raw V1 write fires in the background; spinner momentarily replaces the card body if the write is slow
  - Collapse on answered (chat-loom `<Submit>` clicked): card shows a one-line "saved" beat (~700 ms), then slides out — the writing turn (turn 2) fires concurrently, fed the interpolated `"A1: ... / A2: ... / A3: ..."` reply string
  - Re-fire suppression: the notification never animates in again once `clarificationStatus !== null`
- TODO:
  - Define the activity gate (`system:claude:idle` event, plus a userActivity ref or a `useIdle(QUIET_MS)` hook against keystrokes / mouse / scroll). Likely needs a new tiny hook: `useQuietWindow(quietMs, deps)` returning a boolean.
  - Wire the recipe two ways from the cart-side gate: the existing `onboarding-first-impression.tsx` recipe owns the prompt fragments and source kind; the cart-side gate decides whether to fire turn 1 (chat-loom Form turn) or skip directly to a raw write. **The chat-loom shape on turn 1 is already wired into the recipe's CLARIFY_INSTRUCTION** — the cart side only needs to call `parseIntent(text)` on the model's response and hand the resulting nodes to `<RenderIntent onAction={onSubmit}>`.
  - Decide the writing path for the **dismiss** branch: either reuse the same recipe with a third "raw" prompt fragment (cleanest), or fire `system_prompt_only(write_after_clarify)` with no answers and let the model handle it. Cleanest is to add a `frag_onboarding_write_raw` to the recipe — same shape, no "given the answers" framing — and select via the prompt composition's first-match.
  - Persist `clarificationStatus` alongside the rest of the onboarding record in `User.onboarding`, in the same lock-in pass that restores `useCRUD`.
  - Decide notification copy ("Care to clarify?" was the user's phrasing — likely keeps it, but worth A/B'ing once we have telemetry).
  - Wire `comp_concern_structurer` into the upset path. The composition is already in the recipe stamp (`frag_concern_structurer` + `comp_concern_structurer`). Cart side: spawn a separate single-turn `claude_runner` session against that composition's system prompt, hand it the user's last message as the user-turn, capture the structured-concerns table, prepend to the writing turn's user-message, then fire the writer.
  - Decide the upset-detection heuristic. v1 can be cheap and blunt — token-based (presence of "??", ALL CAPS bursts, "this is exactly what I was worried about", explicit profanity) plus a length floor. v2 could be a small classifier turn against a frozen prompt. Don't over-engineer this; false positives on the structurer just cost an extra short turn (~$0.03) and never make the output worse — false negatives mean the writer doesn't get the structured-concerns prepend.
  - Theme-bridge for the embedded chat-loom render. Today `runtime/intent/render` (and `cart/chat-loom.tsx`) carry hardcoded hex literals (`#0b1020`, `#1e293b`, `#f1f5f9`, …). Inside the cart/app shell that's a `no-color-drift` violation. Either route the intent renderer through `cart/app/gallery/components.cls.ts` classifiers (preferred), or wrap the rendered tree in an override that swaps the inline backgroundColor/color/borderColor to `theme:NAME` tokens. Do this as part of the deferred-clarify pass; don't expand the surface area of inline hex first.
- PROBLEMS:
  - **Cross-cuts the lock-in pass.** The activity gate is meaningless without persistence, because every reload would refire the notification. Land this *after* the onboarding lock-in.
  - **Activity-gate definition is the hard part.** "User has settled" is not a bright line — typing-quiet-for-N-seconds is the cheap version, but a user reading something on screen looks identical to an idle user. First version stays cheap; consider scroll/mouse signals later if false-fires are common.
  - **Notification interrupts.** Even a soft slide-in is an interrupt. If the user is mid-thought when it appears, dismissing feels worse than not seeing it. The QUIET_MS default needs to be generous; a click anywhere outside the notification while it's animating in could pre-emptively defer it (re-arm 30s out).
  - **Recipe changes are minimal but real.** Adding `frag_onboarding_write_raw` to the recipe stamp + a third source on the prompt composition's first-match list is a small change; do it as part of this work, not as part of the recipe authoring.
  - **chat-loom render carries inline hex.** Pulling `RenderIntent` into cart/app inherits chat-loom's hardcoded color palette — incompatible with the cart's classifier-only theming rule. See the theme-bridge TODO above; this is the gating concern, not an afterthought.
  - **Model compliance with chat-loom tagset.** The recipe's CLARIFY_INSTRUCTION asks for a strict subset of tags. If the model emits markdown / prose / extra tags, `parseIntent` may degrade to the unparseable fallback (chat-loom shows yellow `[unparseable]` text in that case). Need a graceful fallback in the notification path: if parsing fails, drop back to either a plain three-input form rendered by the cart, or just fire the dismiss path automatically.
  - **Notification rendering location depends on shell state.** The slide-in needs to work across all three shell states from the GOLDEN section (A: home, B: activity-docked, C: activity-focal). In A the notification has the whole right edge of the page. In B it would slide over `AppSideMenuInput` (left rail) — probably wrong; better to anchor to the right edge of the page area. In C the input bar covers the bottom strip; notification should sit above it (anchor `bottom: APP_BOTTOM_BAR_H + 16`). Decide one anchoring scheme that adapts; coupling to the GOLDEN morph values keeps it from drifting.

---

### Persistent assistant chat (full ↔ side fluid surface) — Stub

The supervisor chat lives **above** the InputStrip and is present in every window. It has two visible shapes — `full` (page-area panel; concept image #2) and `side` (docked rail above the side input; concept image #1) — and the same conversation continues across the swap. The chat is one logical surface that re-parents between two slots; the InputStrip already migrates between the same two slots via the GOLDEN morph (A bar / B docked / C bar-with-side-rail), so the chat rides the same axes.

**This is the natural fill for the "chat-history list" half of the side menu mentioned in `Side menu + activity host → Side menu content`** — that bullet stops being aspirational once this lands.

**Driver axes (already exist — reuse, don't duplicate):**
- `headingTo` from `index.tsx` (`'home' | 'activity-docked' | 'activity-focal'`) — derived from `(routeMode, inputFocal)`.
- The chat shape is `'side'` whenever `headingTo === 'activity-docked'`, `'full'` whenever `headingTo === 'activity-focal'`, and **hidden** when `headingTo === 'home'` (home page stays clean — chat reappears the moment any activity is entered, and persists across activity navigations).
- The morph is **the InputStrip's morph**, not a second one. The chat panel pins to the top of `AppSideMenuInput` in side mode and to the activity content area in full mode; both already exist as positioned slots, so the chat just renders into whichever is active.

**Identity continuity.** The chat is a single React subtree with a stable key, NOT two trees that swap. Re-parenting between full and side slots is what carries the scroll position, the streaming token buffer, and any open surface-card local state across the morph. This is the same pattern the InputStrip already uses (the input element itself stays mounted; only its slot wrapper flips). For the chat: turns animate via the existing **list building** rules from Animation principles (spring-in for new turns, FLIP-tween for reorder, opacity+scale shrink for removal). The morph itself is a fade — the *contents* of a container that itself isn't moving.

**Composition (existing classifiers / atoms — reuse first):**

The footer of the chat panel ("ROUTING ▸ [TIER-1 ONLY] + NAV   ATTACHED ▸" + tag-shortcut row + composer) is the InputStrip surface as it stands today — `S.CommandComposerFrame` / `S.CommandComposerTopbar` / `S.CommandComposerFooter` / `S.CommandComposerPromptRows` / `S.CommandComposerActionRow` / `S.CommandComposerShortcutGroup` / `S.CommandComposerSend` / `S.CommandComposerKeycap` / `S.CommandComposerChip{,Accent,Success}` / `S.CommandComposerPromptText` / `S.CommandComposerActionText` / `S.CommandComposerIconText` / `S.CommandComposerIconButton` are **already wired in `InputStrip.tsx` and morph between slots via the GOLDEN machinery**. The chat's footer is literally that same `<InputStrip>` — it does not get a second composer.

The transcript above the composer (turns + surface-cards) is what's net-new. Surface-card chrome is a near-perfect fit for the gallery's `GenericCardShell` (continuous-flow border-dash already used as the "this card is alive" affordance per Animation principles → Drawing an element outwards → Card / box borders → Continuous marching flow). That keeps the read-only/audit/fleet cards visually consistent with the rest of the cart without inventing card chrome.

The "01 ASSISTANT" / "DOCKED" header pill is shaped like the `S.AppNavLink` / `S.AppNavLinkActive` family — same border, same accent dot, same monospace caption — so the active/inactive variant pattern from the route nav is reusable here.

The lift / surface tags (`SURFACE`, `READ-ONLY`, `LIFT`, `IDLE` / `TOOL` / `STUCK` / `RAT`) and the timestamp captions (`asst 14:03:03`, `you 14:03:30`) are token-shaped in spirit and could reuse `S.CommandComposerChip` / `S.CommandComposerChipAccent` / `S.CommandComposerChipSuccess` / `S.CommandComposerMetaText` directly — same font / size / accent / chip border as the InputStrip already establishes. Re-skinning these as new classifiers risks color drift; the chip family is intentionally right.

The `$ swarm audit --readers 3 --depth full` command preview that surfaces only in full mode is the gallery's `code-block` component (or a `S.CommandComposer*Mono` riff) — terminal-shaped, mono, theme-tinted. Pick `code-block` first; only fall back to a new mono classifier if the existing one carries chrome we don't want.

**New classifiers needed (`cart/app/gallery/components.cls.ts` — do NOT inline):**

Only what isn't covered by the above. Naming follows the `App<Surface>` convention already used by every other cart/app surface:

- `AppChatPanel` — outer frame around the whole chat (header + transcript + footer-slot). `position: relative`, theme:bg, theme:rule border, identical in side/full save for width.
- `AppChatPanelHeader`, `AppChatPanelHeaderRow`, `AppChatPanelHeaderTitle`, `AppChatPanelHeaderState` (the `DOCKED` chip), `AppChatPanelHeaderToggle` (the expand/collapse glyph button).
- `AppChatPanelSubline` (the small `PERSISTENT · 14 TURNS · DRAG ANY SURFACE TO CART` caption — visible only in side mode per concept image).
- `AppChatTranscript` — scrolling container; `flexGrow: 1`, `overflow: 'hidden'`, gap from theme.
- `AppChatTurn`, `AppChatTurnHeaderRow`, `AppChatTurnAuthor` (asst / you variant), `AppChatTurnTime` (caption), `AppChatTurnLiftAffordance` (the `▸ LIFT` tail caption — full-mode only).
- `AppChatTurnBody` — the prose Text classifier; `theme:ink`, `theme:typeBase`, line-height from theme.
- `AppChatYouTurn` — the framed user-message row (concept shows a thin left-border + caret prefix). Variant of `AppChatTurn` rather than a separate atom.
- `AppChatSurfaceSlot` — wrapper for embedded surface-cards inside a turn; passes the dashed-border affordance via `GenericCardShell`'s existing props. The slot only handles spacing.
- `AppChatStatusPill` / `AppChatStatusPillHot` / `AppChatStatusPillOk` / `AppChatStatusPillWarn` — pill styling for `IDLE` / `TOOL` / `STUCK` / `RAT`. **Try `S.CommandComposerChip{,Accent,Success,Warn}` first** — if those are already the right size/inset, skip these new classifiers entirely.
- `AppChatTagRow` — the `# TAG FILE  {} VARIABLE  /  COMMAND` strip that sits below the composer in full mode. (`InputStrip` already advertises this in its left-shortcuts; if that surface is the same row, no new classifier — wire it.)

**Datashape (TBD — sketch, not lock-in):**
- `AssistantThread` — id, turns, model id, started/last-touched timestamps, optional anchored-activity id (so a thread can be "the sweatshop conversation").
- `AssistantTurn` — `{ id, threadId, author: 'asst' | 'user', timestamp, body, surfaces?: ChatSurface[] }`. `body` is plain prose; surfaces are structured renders.
- `ChatSurface` — discriminated union: `{ kind: 'audit' | 'fleet' | ... , props }`. Surfaces are the inline-form / card embeds the assistant emits — `IntentSurface` from `cart/app/gallery/components/intent-surface/` is the existing primitive for this and should be the renderer of choice (matches the deferred-clarify section's stance — emit chat-loom-shaped trees, parse via `runtime/intent/parser`, render via `runtime/intent/render`).
- Persistence: `useCRUD` row(s) under namespace `app`, sibling to the onboarding row. Same pattern as `Goal`. Single canonical `AssistantThread` per cart instance (the "supervisor session"); switching activities does NOT spawn new threads — the same conversation continues.

**Datashape decision: ONE thread or MANY?** Concept image text says "PERSISTENT · 14 TURNS" — a single rolling supervisor thread. v1 ships one. Multi-thread (per-activity / per-worker scoping) is a follow-up; the side-menu's "chat-history list" bullet implies it eventually, but v1 is one thread visible across all windows.

**Driving the model.** Today the `useLocalChat` hook (recently landed, see Recently landed) plus the `claude_runner` framework path are the two generation surfaces. The supervisor chat picks one based on `Settings.defaultConnectionId` (Claude SDK route → claude_runner; local route → useLocalChat). Wire this through a thin `useAssistantChat()` hook that mirrors `useLocalChat`'s phase / streaming surface but routes by connection. **Do not couple the chat UI to either backend directly** — the hook is the seam.

**Triggers / submit path.**
- The InputStrip's `submit()` already parses `@`-tokens (route / app / command). For the assistant chat, anything that ISN'T a token-only input becomes a turn (`assistant:turn` IFTTT event with the typed text, model id, attachments). The supervisor session subscribes once and pushes a turn into the active `AssistantThread`.
- Token-only input still routes (existing behavior); mixed input ("@sweatshop check the fleet") fires both — navigate AND seed the next assistant turn with the original text. Decide order: navigate first (chat surface needs to mount its target slot), seed second.
- Surface-card actions (`run audit`, `kill frank-04`, `inspect`) are parsed-intent actions emitted by `IntentSurface` — wired to `onAction` callbacks per the `intent-surface` EXTENDING.md contract. Each action becomes a new user-turn (effectively the user clicking "yes do that").

**Conditions / state machine:**
- `chatShape = headingTo === 'home' ? 'hidden' : (headingTo === 'activity-docked' ? 'side' : 'full')`.
- `chatShape === 'hidden'` → return `null` from the chat panel; the home surface owns the page.
- `chatShape === 'side'` → render inside `AppSideMenuInput`, ABOVE the docked InputStrip. Header shows `DOCKED` pill + collapse glyph; subline visible.
- `chatShape === 'full'` → render in the activity content area, ABOVE the bottom InputStrip. Header shows expand-glyph (no `DOCKED` pill, no subline); LIFT affordances visible on each turn.
- Identity-continuity invariant: the chat root mounts ONCE inside the shell and re-parents via the same slot dance the InputStrip uses — see GOLDEN section for the slot pattern. Do NOT mount a second copy in the side rail vs the activity content; that breaks the streaming buffer mid-morph.

**Animation tie-in (use existing principles, no new machinery):**
- Turn add → Animation principles → List building → Adding items (spring, 380ms, 60ms stagger if batched).
- Turn remove → List building → Removing items (opacity+scale, 240ms).
- Reorder (e.g. surface card lifts to top on `▸ LIFT` click) → List building → Reordering (FLIP tween).
- Mode swap (full ↔ side) → fade on the panel chrome only; transcript content keeps its identity. The InputStrip's GOLDEN morph already handles the geometry; the chat panel just rides whichever slot is winning.
- Surface-card "alive" state → continuous border-dash flow per Animation principles → Card / box borders → Continuous marching flow.

**Open problems (anticipated, not yet hit):**
- **Composer ownership.** InputStrip is shared by `home` (no chat) and `activity-*` (chat present). When the chat exists, the composer's submit must dual-fire (navigate token + seed assistant turn); when it doesn't, only the navigate path runs. Today `InputStrip.submit()` only does the navigate path. Add a subscriber-shaped seam (`assistant:available` flag or a new IFTTT event) so the chat can opt in without `InputStrip` knowing about chat.
- **Persistence size.** `AssistantThread` rows can grow large (tokens × turns); `useCRUD` writes the whole row on each turn. v1 is fine because turn counts are small; consider a turn-append append-only log if a thread gets past ~200 turns and writes start showing up in the morph budget.
- **Side-mode panel sizing in 360w.** Same root cause as the InputStrip 360w note (`useBreakpoint` is window-scoped, not container-scoped). The chat panel will need a `compact` prop the shell sets explicitly when docked, mirroring the InputStrip fix.
- **Theme purity for surface-card content.** `IntentSurface` / `intent-surface/*.tsx` MUST be classifier-routed — no hex literals — for the same reason the deferred-clarify section flags. Audit before adopting.
- **No-color-drift trap.** The status pills (`IDLE` / `TOOL` / `STUCK` / `RAT`) tempt hardcoded color values per state. Resist — extend `theme:` tokens (`theme:ok` / `theme:warn` / `theme:flag` already exist; if a fifth state is needed, add a token, do NOT inline a hex).
- **Onboarding gate.** During onboarding the chat must NOT render — the shell is in state A regardless. Same `!onb.complete` short-circuit the InputStrip already uses.

**Scope split (what ships in this pass vs follows):**
- **In scope (v1):** the visual surface and its full ↔ side morph, with mock turns from a fixture. No real model wiring, no persistence. Surface-cards rendered via `IntentSurface` with hand-authored fixtures. Goal: prove the morph and identity-continuity work with the GOLDEN shell.
- **Follow-up:** wire `useAssistantChat()` (Claude or local based on connection), persistence via `useCRUD`, surface-card actions through `IntentSurface.onAction`, the `assistant:available` seam in `InputStrip`. Each is an independent commit that doesn't reshape the surface.

**Files (proposed; nothing has landed yet):**
- `cart/app/chat/AssistantChat.tsx` — the chat panel root component. Reads `headingTo`, picks `chatShape`, mounts header + transcript + (no composer — InputStrip owns that).
- `cart/app/chat/AssistantTurn.tsx` — one turn render. Picks `AppChatTurn` vs `AppChatYouTurn`. Hosts `AssistantSurface` slots.
- `cart/app/chat/AssistantSurface.tsx` — surface-card wrapper around `IntentSurface` / `GenericCardShell`. Owns the lift / read-only chrome.
- `cart/app/chat/useAssistantChat.ts` — connection-router hook (follow-up commit).
- `cart/app/chat/fixtures.ts` — v1 mock turns to drive the visual.
- `cart/app/gallery/components.cls.ts` — new `AppChat*` classifiers per the list above.

---

## Open threads (cross-file)

These need a coordinated touch — not localized to a single file.

- **Real probes for API-key + Local providers** — both `ApiKeyForm` and `LocalForm` return canned model lists. Wire `runtime/hooks/http.ts` for HTTP-shaped endpoints; keep the `.gguf`-on-disk path as a single-entry list until we have a probe that reads gguf header metadata. Until this lands, the model id `commitConnection` writes to `Settings.defaultModelId` is whatever `chosen` happened to be from the canned list.
- **Tour overlay** — `Chrome.TourBanner` calls `onb.acceptTour()` on Yes, but there is no actual tour overlay yet. When the tour is built, `acceptTour()` should additionally arm the overlay; the banner unmount is already handled by the `tourStatus !== 'pending'` flip. Decline path is fully wired (just hides). `tourStatus` now persists so a declined tour stays declined across reloads.
- **Skipped-mode runtime branch** — when `User.onboarding.status === 'skipped'`, the app should run in a degraded mode. State.jsx persists the status correctly today, but IndexPage still treats `complete=true` as one homogenous render path. Add a third branch (alongside onboarding / completed-home) that prompts inline for missing onboarded data when skipped users hit features that need it.
- **Deferred clarification flow re-arm** — see the deferred-clarify section above. Now that persistence is live, a `clarification` substate on `User.onboarding` (or a sibling field) is a clean place to land `{status, firedAt, answers}` so the notification doesn't refire across reloads.
- **Goal popover copy** — Step5's tooltip text lives inline in `Step5.jsx` (`GOAL_TOOLTIP`). Move to a content / i18n layer once one exists; today there's no other natural home for it.
- **Local chat path verification** — RESOLVED via the subprocess pivot. The link-time `extern "c"` rewrite hit a different wall (struct-ABI mismatch with whichever llama.cpp the linked .so was built against, plus the wgpu/Vulkan VkInstance fight reappeared once the cart actually got far enough to load tensors). Replaced with an out-of-process inference worker — see "Local chat: subprocess pivot" in Recently landed. The recipe at `cart/app/recipes/gemma-line-gate-for-claude-edits.{md,ts}` is still aspirational; rewriting it against the subprocess path is the next concrete step.
- **Avatar + voice-thumbnail pipeline (Character)** — `Character.avatarRef` and `Character.voiceThumbnailRef` are opaque locators. Three viable paths (local-file upload, external URL, generated-from-prompt); the data shape is stable across all three so the pick can be deferred. UI uses placeholders until one lands. See `cart/app/docs/character/99-open-questions.md`.
- **Character grain across profiles** — Character is Assistant-grain via `Assistant.activeCharacterId`; Settings may still scope visibility/profile defaults. Open whether a character should be visible across profiles or per-profile. Leaning: User-owned (already true via `character.userId`), per-profile *exposed* via a `Settings.sharedCharacterIds[]` opt-in. Deferred until multi-profile lands.
- **Manifest privacy tier** — PRD §6 calls for per-dimension visibility ('visible' / 'anonymized' / 'hidden' / 'deletable'). Sketch: extend `Privacy` (`cart/app/gallery/data/privacy.ts`) with a `manifest` namespace mirroring the `tools` / `filesystem` shape; `src_user-manifest-snapshot` reads the tier and skips hidden dimensions. Deferred to a Privacy revision; data shapes here don't depend on the answer.
- **Token registry cleanup** — `@composer` and `@gallery` should be added now that both routes are registered. `@about` should be removed or retargeted because `/about` no longer exists. `@manifest` still waits for a real route. `@character` already points at a live route.

### Recently landed

A short rolling log so cross-file work doesn't keep getting re-planned. Trim entries older than the last few weeks.

- **Composer route + canvas authoring first pass** (2026-05-04) — moved the `docs/11-composer.md` plan into a real app route at `/composer` and registered it in the shell (`mode: 'side'`). Also registered `/gallery` as a side-mode route and removed the stale `/about` route from `index.tsx`. Main pieces:
  - **Canvas substrate** — `composer/page.tsx` owns `ComposerDoc` + `SNode` state, persists one default draft through `__store_get/__store_set`, autosaves with a debounce, and normalizes ids/selection on every edit. Pages are `Canvas.Node`s with persisted `x/y/width/height`; new pages are blank and placed beside existing pages instead of stacked on top of each other.
  - **Canvas clamp toolbar** — replaced the top toolbar with a bottom-center actionbar inside `Canvas.Clamp`. It uses the gallery layer-control button atom (`LayerToolButton`) plus runtime icons for select/pan/draw, Box/Text/Button creation, copy/paste/duplicate/delete, group/ungroup, and page creation.
  - **Atom library rail** — moved the full primitive/gallery atom catalog off the toolbar into the left rail. Rail tabs are `ALL`, `PRIM`, `SHAPE`, `UI`, and `HIDE/OPEN`; the visible menu has search/filter and adds atoms to the current selection target.
  - **Canvas content style isolation** — composer chrome uses app/gallery classifiers and `theme:` tokens, but authored canvas content is persisted as explicit node style values. Dropped Box/Text/Pressable content does not inherit cockpit chrome styling; gallery-source atoms are treated as editable composer templates.
  - **Layers panel behavior** — layers live in the right inspector under properties with fixed space, render all pages and nested children, and expose `UP`, `DN`, `OUT`, `IN`, `DEL` inline on the active row. Removed duplicate layer-control buttons above the tree. Page rows can be selected/deleted; no permanent default layer/page is forced to survive.
  - **Selection repairs** — click selection is single-selection by default; accidental additive multi-selection was removed. `Ctrl/Cmd+A` is the intentional multi-select path and is scoped to the active page's children (or the page itself if empty). `Esc` clears focus/selection. Nested child nodes remain reachable because parent gallery atoms with children render as containers, not opaque pressable previews.
  - **Editing operations** — added copy/paste/duplicate/delete/group/ungroup and sibling reorder/outdent/indent. Clipboard writes/reads `reactjit/composer-nodes` JSON through the host clipboard when present, with an in-memory fallback.
  - **Keyboard handling** — `useIFTTT` bindings: `Ctrl/Cmd+A`, `Delete`, `Backspace`, `Esc`, `Ctrl/Cmd+C/V/D`, `Ctrl/Cmd+G`, `Ctrl/Cmd+Shift+G`, `Alt+Up/Down`, `Alt+Left/Right`. Inputs set an `inputFocused` flag so shortcuts do not fire while typing.
  - **Inspector polish** — properties panel gained stable field widths, page size presets, canvas-position fields for pages, spacing controls, background/text color swatches plus hex fields, row/column layout buttons, and a 3x3 alignment grid. The layers count now reports the real selection length.
  - **Existing gallery atoms wired into composer** — the layer tree now renders through `LayerRow` (`LayerThumbnail`, lock/visibility toggles, `StripBadge`, opacity/fill badges); the inspector embeds `LayerPropertiesPanel` (`LayerBlendModeControl`, `LayerOpacityControls`, mask range, thumbnail/badge deck); spacing presets use `StepSlider`; the code drawer renders through `SyntaxHighlighter`.
  - **Selected-subtree code drawer** — bottom code drawer now emits only the selected element and whatever is nested inside it via `emitNode()`, instead of dumping the whole document, and highlights the generated TSX line-by-line.
  - **Gallery atom decomposition** — removed the story-render preview path that made gallery atoms behave like stickers. Dropped atoms now expand into editable child templates (charts → bars, controls → track/knob/value, cards/panels/rows → text/lines/action, shapes → mock field/action). Existing saved empty `GalleryAtom`s normalize into editable children and old short default heights are expanded to avoid clipping.
  - **Crash containment** — fixed `FieldInput`'s missing `onFocus/onBlur` prop destructuring (`onFocus is not defined`) and wrapped the composer tree in `ComposerBoundary` so future render errors show a contained route-level failure instead of tearing down the app.
  - **Validation** — `BUNDLE_FROM_HARNESS=1 CART_ROOT="$PWD" tools/v8cli scripts/cart-bundle.js "$PWD/cart/app/index.tsx" --out "$PWD/bundle-app.js"` passes. The only warning is the pre-existing duplicate `prompt` key in `cart/app/gallery/taxonomy.ts`.
  - **Still open** — pan/draw are visible tool modes but not full modal canvas behaviors yet; gallery atom decomposition is heuristic rather than a true component-source inverse parser; code drawer is one-way emit with no parse-back; child resize handles, drag-to-reparent, shape binding, repeat/conditional, border/radius/shadow/animation, and a multi-draft picker remain future passes.
- **Onboarding "lock-in" pass** (2026-04-29) — `state.jsx` writes through `useCRUD` (namespace `app`) into the gallery data graph: User (`user_local`), Settings (`settings_default`), Privacy (`privacy_default`), Workspace (`ws_local`), plus per-completion Connection + Goal rows. `User.onboarding.{status, step, startedAt, completedAt, skippedAt, tourStatus}` all persist.
- **Three-state shell + input morph** (commits `3bad2f07d` → `6aa1cd24c`, 2026-05-01) — A/B/C state machine, route+focal driver axes, smoke-and-mirrors variant flip, GOLDEN regression list. Canonical reference: **Animation principles → Input-strip shell morph (GOLDEN)**. `git log --grep GOLDEN`.
- **HUD / iframe split + settings sub-nav promotion** (commits `25910df18` (Phase A) → `0e49af62f` (Phase B), 2026-05-02) — fixed the `/settings` morph-flash regression. Phase A: bar bg → `theme:transparent`, routes wrapper drops `paddingBottom`, pages own internal `paddingBottom` via the new `useHudInsets()` store in `cart/app/shell.tsx`. Phase B: `SettingsNav` lifts out of the page tree and renders inside `S.AppSideMenuInput` at the top of the assistant rail, reading active section from a new `useSettingsSection()` shell store. Canonical reference: **Animation principles → HUD / iframe split**. Covers `cart/app/{index.tsx,shell.tsx,page.tsx,about/page.jsx,settings/page.jsx,sweatshop/page.tsx}`.
- **Settings Customize + runtime theme token overrides** (2026-05-03) — added `/settings/customize` and the Customize settings section. `settings/routes/customize.tsx` edits component-gallery color token overrides; `cart/app/gallery/gallery-theme.ts` persists them at `component-gallery-theme-token-overrides` and applies them after the active gallery theme's flattened token categories are pushed into `runtime/theme.tsx`. This keeps app components classifier-only while allowing user-entered runtime colors.
- **Local chat: subprocess pivot — full GPU inference inside cart/app** (commits `ea3e1654d` → `d2b1a3981`, 2026-05-02) — the in-process llama.cpp link-time path (entry just below) hit two compounding walls: (a) struct-ABI mismatch with whichever upstream commit our prebuilt `libllama_ffi.so` was built against — `llama_model_default_params()`'s 72-byte return struct shape was drifting under us, leaving garbage in `progress_callback` that triggered a `cancelled model load` mid-offload; (b) once we got past the struct issue, the original wgpu/Vulkan `VkInstance` fight was still there and killed the offload at the buffer-allocation boundary anyway. Pivoted to running inference in a separate process so each side gets its own `VkInstance` (see `framework/ffi/llm_worker.cpp`). Pieces:
  - `framework/ffi/llm_worker.cpp` — small C++ subprocess that loads a `.gguf` on Vulkan, talks to the cart over a line-delimited LOAD/CHAT/READY/TOK/DONE/ERR protocol on stdin/stdout. Sniffs the model's embedded Jinja chat template for known markers (gemma / chatml / llama2 / phi3) since llama.cpp's `apply_template` doesn't render full Jinja.
  - `framework/ffi/llama_headers/` — vendored `llama.h` + `ggml*.h` + `gguf.h` from llama.cpp upstream. Knows gemma4, qwen3.6, every current arch.
  - `framework/local_ai_runtime.zig` — rewritten (old version preserved as `_old.zig`). Public API (`Session`, `SessionOptions`, `SubmitOptions`, `EventKind`, `OwnedEvent`) is identical so `framework/v8_bindings_sdk.zig`, `framework/qjs_runtime.zig`, and `useLocalChat` need zero changes. Worker spawn sets `LD_LIBRARY_PATH=<exe_dir>/lib + dev fallback` so the bundled libs resolve.
  - `framework/v8_bindings_sdk.zig` — pre-existing field-name mismatch fixed: hook reads `evt.kind` / `evt.text`; binding was setting `"type"` / `"result"`. Was masked while the in-process load failed silently; surfaced once events actually flowed.
  - `runtime/hooks/useLocalChat.ts` — model swap now tears down + respawns; empty model is inert (lets `useAssistantChat` always call this hook unconditionally).
  - `cart/app/chat/useAssistantChat.ts` — routes to `useLocalChat` when the active `Connection.kind === 'local-runtime'`. The `.gguf` path comes from `Connection.credentialRef.locator` (LocalForm already captures the typed path there). Both hooks always called per rules-of-hooks; the inactive one short-circuits.
  - `scripts/ship` — when `WANT_SDK` is on (which `useLocalChat` triggers), copies `rjit-llm-worker` + `libllama.so` + `libggml{,-base,-cpu,-vulkan}.so` from `deps/llama.cpp-fresh/build/bin` into the cart payload. Self-extracting wrapper unpacks them next to `app.bin` and the cart's other libs. No external runtime install required.
  - `cart/llm_lab/` — minimal test cart for the subprocess path. Pick Gemma 4 E4B or Qwen 3.6 27B, hit Ask, watch tokens stream into the OUTPUT panel.
  - `deps/llama.cpp-fresh/` — fresh upstream clone (gitignored), built locally via cmake with `-DGGML_VULKAN=ON -DBUILD_SHARED_LIBS=ON`. Knows current archs the older copies in `love2d/llama.cpp` and `deps/llama.cpp.zig` predate.
  - `sdk/dependency-registry.json` — `useLocalChat` trigger moved from the `embed` gate to the `sdk` gate (chat path no longer needs `libllama_ffi.so` linked at build).
  - Confirmed end-to-end on AMD Radeon RX 7900 XTX: 43/43 layers offloaded to GPU via Vulkan, tokens stream back through pipes to the cart UI without fighting wgpu's `VkInstance`. Switching models in `cart/llm_lab` tears down + respawns cleanly.
  - The existing Step2 'I have local models' tile already commits as `kind='local-runtime'` (state.jsx remap at line 470), so onboarding flows that pick a `.gguf` path now drive the cart/app `AssistantChat` through this subprocess by default — no UI change needed.
  - Open: the in-process path entry below is now historical context, not a live target. Replace mention of `framework/llama_exports.zig` in the gemma recipe with the subprocess wire protocol once the recipe is rewritten.
- **Local chat hook (`useLocalChat`) + manifest-gate cart + extern-link refactor** (2026-05-02) — net-new generation path through the framework's Vulkan llama runtime, alongside the existing embedding path. Pieces:
  - `runtime/hooks/useLocalChat.ts` — wraps `__localai_init` / `_send` / `_poll` / `_close` with React state. Exposes `phase` (`init` / `loading` / `loaded` / `generating` / `idle` / `failed`), a `pulse` heartbeat counter, `lastStatus`, and `streaming` (assistant tokens accumulated mid-`ask`). Defaults `persistAcrossUnmount: true` so dev hot-reload doesn't tear down the session and cancel the model load. New 4th arg to `__localai_init` plumbs `n_ctx` through (Zig-side `hostLocalAiInit` in `framework/v8_bindings_sdk.zig`).
  - `cart/manifest_gate/{index.tsx,cart.json}` — Round-2 of the line-manifest benchmark. Reads `experiments/manifest_check/target.py` + `manifest.md` via `runtime/hooks/fs`, walks claims sequentially, asks Gemma-4 for a `TRUE`/`FALSE` verdict per line, writes the preamble to `experiments/manifest_check/results/round2_preamble.txt`. UI: pulsing heartbeat dot, phase label, live token-stream panel, active-row highlight in the verdicts list. Triggers `has-embed=true` at ship time via the `useLocalChat` import (registered in `sdk/dependency-registry.json` as a second trigger of the existing `embed` gate).
  - `cart/app/recipes/gemma-line-gate-for-claude-edits.{md,ts}` — recipe file pair documenting the two-round benchmark (Claude SDK casual review, then local Gemma-4 TRUE/FALSE preamble feeding back into Claude). Uses `useLocalChat` and references `framework/local_ai_runtime.zig` + `framework/llama_exports.zig` as the bake-in path.
  - `framework/local_ai_runtime.zig` — dropped `std.DynLib` + the dlopen candidate-path search. Replaced `Fn*` typedefs with `extern "c"` declarations at module scope (link-time bound against `libllama_ffi.so`, same .so already linked by `framework/embed.zig`). `LlamaApi` struct kept as a thin wrapper of function pointers defaulting to `&llama_foo` so the 33 `api.foo(...)` call sites are unchanged. Reason: a second runtime dlopen of the same llama.cpp build re-initialized `ggml-vulkan` on a worker thread, contending with the renderer's already-active `VkInstance` and cancelling the model load mid-offload (matches the clippy pattern that originally went to LuaJIT FFI for the same reason). The link-time path shares one `VkInstance` across embed + chat.
  - `build.zig` — when `has-embed=true`, prefers root `zig-out/lib/libllama_ffi.so` over `tsz/zig-out/lib/...` so a newer .so dropped at the root wins (current setup symlinks LMS Vulkan 2.14.0 there for gemma-4 architecture support, which the Apr-18 frozen tsz build pre-dates). Adds `$ORIGIN/../lib` rpath so the binary at `zig-out/bin/` resolves the .so at runtime without `LD_LIBRARY_PATH`.
  - Open: end-to-end gemma-4 run still needs to be observed completing (see Open threads above).
