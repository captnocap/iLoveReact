# Inspector QoL Enhancements

Tracked improvements for the Love2D inspector (`lua/inspector.lua`) and console (`lua/console.lua`).

## Bugs / Low-Hanging Fruit

- [ ] **Tree collapse is drawn but never toggleable** — Collapse indicators (">" / "v") render and `state.collapsed` is tracked, but the tree panel click handler only selects nodes — never toggles collapse.
- [ ] **Font objects allocated every frame** — `love.graphics.newFont()` called in `drawTooltip()`, `drawTreePanel()`, `drawDetailPanel()`, and `drawPerfBar()` — four allocations per draw call. Cache at module level.
- [ ] **`countNodes()` walks entire tree every frame** — O(n) per frame for a display-only counter in the perf bar. Cache and invalidate on tree changes.
- [ ] **`deepHitTest()` runs every frame even if mouse hasn't moved** — Skip when mouseX/mouseY unchanged since last frame.

## High Impact

- [ ] **Scroll tree panel to selected node** — Click a node in the viewport and the tree panel doesn't scroll to reveal it. Use cached `treeNodePositions` to compute Y offset.
- [ ] **Hover-from-tree highlights node in viewport** — Hovering a row in the tree panel should set `state.hoveredNode` so the box model overlay appears on the corresponding node.
- [ ] **Keyboard navigation in tree panel** — Arrow keys for up/down/collapse/expand. Currently mouse-only.
- [ ] **Parent navigation from detail panel** — No "go to parent" action when inspecting a deep node. Keybind or clickable link.
- [ ] **Ancestor breadcrumb path** — Detail panel shows `Box #42` but not `Root > Container > Row > Box #42`.

## Medium Impact

- [ ] **Runtime layout warnings** — Flag live issues: zero-size boxes, children overflowing parents, Text without fontSize, flexGrow without parent dimensions. Warning badges on tree nodes or `:warnings` console command.
- [ ] **Flex debug info in detail panel** — Show resolved flexGrow, flexShrink, flexBasis, overflow state, flex container vs flex item.
- [ ] **Memory in perf bar** — `collectgarbage("count")` for Lua memory, optionally JS heap.
- [ ] **Console `:style` autocomplete for property names** — After `:style <id> `, Tab suggests valid style properties.
- [ ] **`:diff` after style changes** — Show layout before/after summary when `:style` triggers relayout.
- [ ] **Persist console history** — Save/restore via `love.filesystem` on init/close.

## Nice to Have

- [ ] **Distance measurement tool** — Ruler mode to measure pixel distances between two points or node edges.
- [ ] **Frame stepping** — Pause rendering and step frame-by-frame for animation debugging.
- [ ] **Search/filter in tree panel** — Quick-filter textbox to narrow tree by type name.
- [ ] **`:snapshot` command** — Serialize full tree + styles to JSON for offline analysis or bug reports.
- [ ] **Surface `useDebug` data in inspector UI** — Show `globalThis.__debug` entries in the detail panel instead of requiring manual console eval.
