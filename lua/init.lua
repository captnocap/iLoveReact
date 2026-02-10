--[[
  init.lua -- Main integration module for react-love

  This is the entry point that a Love2D game requires:

    local ReactLove = require("lua")

  It auto-detects whether we are running in the browser (love.js / WASM with
  Module.FS transport) or natively (embedded QuickJS), and wires up the
  appropriate bridge, tree, layout, painter, and events modules.
]]

local ReactLove = {}

-- ============================================================================
-- Submodule references (populated in init)
-- ============================================================================

local bridge   = nil   -- bridge_fs or bridge_quickjs instance
local tree     = nil   -- tree.lua module
local layout   = nil   -- layout.lua module
local painter  = nil   -- painter.lua module
local events   = nil   -- events.lua module
local measure  = nil   -- measure.lua module (text measurement + font cache)

local mode     = nil   -- "web", "native", or "canvas"
local basePath = nil   -- directory containing these modules

-- Helper: does the current mode run the rendering pipeline?
local function isRendering()
  return mode == "native" or mode == "canvas"
end

-- ============================================================================
-- Mode detection
-- ============================================================================

--- Detect whether we are running in the browser (love.js) or natively.
--- In web mode, the presence of a /__bridge_namespace file signals Module.FS.
local function detectMode(config)
  if config and config.mode and config.mode ~= "auto" then
    return config.mode
  end

  -- Check for the Module.FS sentinel file
  local ns = (config and config.namespace) or "default"
  local sentinelPath = "__bridge_" .. ns .. "_ready"
  if love.filesystem.getInfo("/__bridge_namespace")
    or love.filesystem.getInfo(sentinelPath) then
    return "web"
  end

  return "native"
end

-- ============================================================================
-- Resolve require paths
-- ============================================================================

--- Figure out where our sibling modules live so requires work regardless
--- of how the user has set up their project.
local function resolveBasePath()
  -- The init.lua file is loaded via require("lua") or require("lua.init").
  -- We need the directory portion so we can require siblings.
  local info = debug.getinfo(1, "S")
  local source = info and info.source or ""
  -- Strip the leading @ that Lua adds to file-based sources
  source = source:gsub("^@", "")
  local dir = source:match("^(.*[/\\])") or ""
  return dir
end

-- ============================================================================
-- Public API
-- ============================================================================

--- Push an event to the bridge (handles mode differences).
--- In native mode bridge:pushEvent() is used; in canvas mode bridge.emit() is used.
local function pushEvent(evt)
  if mode == "native" then
    bridge:pushEvent(evt)
  elseif mode == "canvas" then
    bridge.emit(evt.type, evt)
  end
end

--- Initialize react-love.
--- config fields:
---   mode       : "auto" | "web" | "native" | "canvas"  (default "auto")
---   bundlePath : path to the JS bundle       (default "bundle.js")
---   namespace  : bridge namespace string     (default "default")
---   libpath    : path to libquickjs shared library (default "lib/libquickjs")
function ReactLove.init(config)
  config = config or {}
  basePath = resolveBasePath()

  mode = detectMode(config)
  local ns = config.namespace or "default"

  if mode == "web" then
    -- Web mode: use Module.FS bridge.
    -- In web mode the DOM/browser handles rendering; Lua only bridges data.
    bridge = require("lua.bridge_fs")
    bridge.init(ns)
    print("[react-love] Initialized in WEB mode (Module.FS bridge)")

  elseif mode == "canvas" then
    -- Canvas mode: FS bridge + native rendering pipeline.
    -- React runs in the browser, reconciler commands come via /__reconciler_in.json,
    -- and Lua handles tree/layout/painter. Events go back via bridge_fs outbox.
    bridge = require("lua.bridge_fs")
    bridge.init(ns)

    tree    = require("lua.tree")
    measure = require("lua.measure")
    layout  = require("lua.layout")
    painter = require("lua.painter")
    events  = require("lua.events")

    events.setTreeModule(tree)
    tree.init()

    print("[react-love] Initialized in CANVAS mode (Module.FS bridge + native rendering)")

  else
    -- Native mode: use QuickJS bridge + retained tree + layout + painter.
    local BridgeQJS = require("lua.bridge_quickjs")
    bridge = BridgeQJS.new(config.libpath or "lib/libquickjs")

    tree    = require("lua.tree")
    measure = require("lua.measure")
    layout  = require("lua.layout")
    painter = require("lua.painter")
    events  = require("lua.events")

    events.setTreeModule(tree)
    tree.init()

    -- Load the bundled React app into QuickJS
    local bundlePath = config.bundlePath or "bundle.js"
    local bundleJS = love.filesystem.read(bundlePath)
    if not bundleJS then
      error("[react-love] " .. bundlePath .. " not found -- run `npm run build` first")
    end

    -- Tell the bundle to defer root.render() so JS_Eval returns immediately.
    -- React's synchronous LegacyRoot render would otherwise block inside JS_Eval.
    bridge:eval("globalThis.__deferMount = true;", "<pre-bundle>")

    print("[react-love] Evaluating bundle (" .. #bundleJS .. " bytes)...")
    bridge:eval(bundleJS, bundlePath)
    print("[react-love] Bundle loaded OK")

    -- Don't mount yet — that happens in the first update() call so the
    -- Love2D event loop is running and we can tick timers between frames.
    ReactLove._needsMount = true

    print("[react-love] Initialized in NATIVE mode (QuickJS bridge)")
  end
end

--- Call once per frame from love.update(dt).
--- Ticks the bridge, drains mutation commands, and relayouts the tree.
function ReactLove.update(dt)
  if mode == "web" then
    -- Web mode: poll the Module.FS inbox and flush the outbox
    bridge.poll()
    bridge.flush()
    return
  end

  if mode == "canvas" then
    -- Canvas mode: FS bridge + native rendering pipeline ----------------

    -- 1. Poll the standard bridge inbox for user/state commands
    bridge.poll()

    -- 2. Poll the dedicated reconciler command inbox (/__reconciler_in.json)
    local reconPath = "__reconciler_in.json"
    if love.filesystem.getInfo(reconPath) then
      local raw = love.filesystem.read(reconPath)
      love.filesystem.remove(reconPath)
      if raw and raw ~= "" then
        local json = require("lib.json")
        local ok, commands = pcall(json.decode, raw)
        if ok and type(commands) == "table" then
          tree.applyCommands(commands)
        end
      end
    end

    -- 3. Relayout if tree changed
    if tree.isDirty() then
      local root = tree.getTree()
      if root then
        layout.layout(root)
      end
      tree.clearDirty()
    end

    -- 4. Flush bridge outbox (events back to JS)
    bridge.flush()
    return
  end

  -- Native mode -----------------------------------------------------------

  -- Deferred mount: trigger root.render() on the first update so the
  -- Love2D event loop is already running. Uses callGlobal (JS_Call)
  -- instead of eval because JS_Eval hangs after complex React renders.
  if ReactLove._needsMount then
    ReactLove._needsMount = nil
    io.write("[react-love] Triggering deferred mount...\n"); io.flush()
    bridge:callGlobal("__mount")
    io.write("[react-love] Mount call returned\n"); io.flush()
    -- Tick immediately to drain any scheduled microtasks/timers
    bridge:tick()
  end

  -- 1. Tick JS timers + microtasks
  bridge:tick()

  -- 2. Tell JS to process any pending input events
  local ok, err = pcall(function() bridge:callGlobal("_pollAndDispatchEvents") end)
  if not ok then
    io.write("[react-love] Event dispatch error: " .. tostring(err) .. "\n"); io.flush()
  end

  -- 3. Tick again (event handlers may have triggered state updates)
  bridge:tick()

  -- 4. Drain mutation commands from JS and apply to retained tree
  local commands = bridge:drainCommands()
  if #commands > 0 then
    if not ReactLove._loggedCommands then
      ReactLove._loggedCommands = true
      io.write("[react-love] First batch: " .. #commands .. " commands\n"); io.flush()
    end
    tree.applyCommands(commands)
  end

  -- 5. Relayout if tree changed
  if tree.isDirty() then
    local root = tree.getTree()
    if root then
      layout.layout(root)
    end
    tree.clearDirty()
  end
end

--- Call once per frame from love.draw().
--- Paints the retained UI tree (native and canvas modes).
function ReactLove.draw()
  if not isRendering() then return end

  local root = tree.getTree()
  if root then
    if not ReactLove._loggedDraw then
      ReactLove._loggedDraw = true
      local c = root.computed
      local w = c and c.w or "nil"
      local h = c and c.h or "nil"
      local nc = root.children and #root.children or 0
      io.write("[react-love] draw: root " .. w .. "x" .. h .. " children=" .. nc .. "\n"); io.flush()
      if root.children then
        for i = 1, math.min(3, #root.children) do
          local ch = root.children[i]
          local cc = ch.computed
          local cw = cc and cc.w or "nil"
          local chh = cc and cc.h or "nil"
          local bg = ch.style and ch.style.backgroundColor or "nil"
          io.write("  child[" .. i .. "] type=" .. tostring(ch.type) .. " " .. tostring(cw) .. "x" .. tostring(chh) .. " bg=" .. tostring(bg) .. "\n"); io.flush()
        end
      end
    end
    painter.paint(root)
  end
end

--- Call from love.mousepressed(x, y, button).
--- Hit-tests the tree and dispatches a click event to JS.
--- Also starts tracking for potential drag operations.
function ReactLove.mousepressed(x, y, button)
  if not isRendering() then return end

  local root = tree.getTree()
  if not root then return end

  local hit = events.hitTest(root, x, y)
  if hit then
    -- Always start drag tracking on any clicked node
    -- JS side will decide if it has drag handlers
    events.startDrag(hit.id, x, y)

    -- Fire click event with bubblePath
    local bubblePath = events.buildBubblePath(hit)
    pushEvent(events.createEvent("click", hit.id, x, y, button, bubblePath))
  end
end

--- Call from love.mousereleased(x, y, button).
--- Ends any active drag operation and dispatches release event.
function ReactLove.mousereleased(x, y, button)
  if not isRendering() then return end

  local root = tree.getTree()
  if not root then return end

  -- End drag if active
  local dragEndEvent = events.endDrag(x, y)
  if dragEndEvent then
    pushEvent(dragEndEvent)
  end

  -- Dispatch normal release event with bubblePath
  local hit = events.hitTest(root, x, y)
  if hit then
    local bubblePath = events.buildBubblePath(hit)
    pushEvent(events.createEvent("release", hit.id, x, y, button, bubblePath))
  end
end

--- Call from love.mousemoved(x, y, dx, dy).
--- Tracks pointer enter/leave and dispatches hover events.
--- Also updates drag state if a drag is active.
function ReactLove.mousemoved(x, y)
  if not isRendering() then return end

  local root = tree.getTree()
  if not root then return end

  -- Update drag if active
  if events.isDragging() then
    local dragEvents = events.updateDrag(x, y)
    if dragEvents then
      for _, evt in ipairs(dragEvents) do
        pushEvent(evt)
      end
    end

    -- Don't update hover while dragging (unless threshold not crossed)
    if events.isDragThresholdCrossed() then
      return
    end
  end

  -- Normal hover tracking when not dragging
  local hoverEvents = events.updateHover(root, x, y)
  for _, evt in ipairs(hoverEvents) do
    pushEvent(evt)
  end
end

--- Call from love.resize(w, h).
--- Marks the tree dirty so layout is recomputed next frame.
function ReactLove.resize(w, h)
  if not isRendering() then return end
  if measure then
    measure.clearCache()
  end
  if tree then
    tree.markDirty()
  end
end

--- Call from love.keypressed(key, scancode, isrepeat).
--- Dispatches a global keydown event to all JS keyboard listeners.
function ReactLove.keypressed(key, scancode, isrepeat)
  if not isRendering() then return end
  if not bridge then return end

  pushEvent(events.createKeyEvent("keydown", key, scancode, isrepeat))
end

--- Call from love.keyreleased(key, scancode).
--- Dispatches a global keyup event to all JS keyboard listeners.
function ReactLove.keyreleased(key, scancode)
  if not isRendering() then return end
  if not bridge then return end

  pushEvent(events.createKeyEvent("keyup", key, scancode, false))
end

--- Call from love.textinput(text).
--- Dispatches a text input event (handles unicode, IME, etc.).
function ReactLove.textinput(text)
  if not isRendering() then return end
  if not bridge then return end

  pushEvent(events.createTextInputEvent(text))
end

--- Call from love.wheelmoved(x, y).
--- If the wheel event hits a scroll container, update its scroll position
--- directly in Lua for immediate visual response AND send the event to JS.
--- The scroll speed multiplier converts Love2D wheel units to pixels.
function ReactLove.wheelmoved(x, y)
  if not isRendering() then return end

  local root = tree.getTree()
  if not root then return end

  -- Get current mouse position
  local mx, my = love.mouse.getPosition()
  local hit = events.hitTest(root, mx, my)
  if not hit then return end

  -- Check if the hit node or any ancestor is a scroll container
  local scrollContainer = events.findScrollContainer(hit, mx, my)
  if scrollContainer and scrollContainer.scrollState then
    -- Update scroll position directly in Lua for immediate response
    local ss = scrollContainer.scrollState
    local scrollSpeed = 40  -- pixels per wheel tick
    local newScrollX = (ss.scrollX or 0) - x * scrollSpeed
    local newScrollY = (ss.scrollY or 0) - y * scrollSpeed

    tree.setScroll(scrollContainer.id, newScrollX, newScrollY)
  end

  -- Always send the wheel event to JS regardless of scroll handling
  local bubblePath = events.buildBubblePath(hit)
  pushEvent(events.createWheelEvent(hit.id, mx, my, x, y, bubblePath))
end

--- Call from love.touchpressed(id, x, y, dx, dy, pressure).
--- Dispatches a touchstart event to the node under the touch point.
function ReactLove.touchpressed(id, x, y, dx, dy, pressure)
  if not isRendering() then return end

  local root = tree.getTree()
  if not root then return end

  local hit = events.hitTest(root, x, y)
  if hit then
    local bubblePath = events.buildBubblePath(hit)
    pushEvent(events.createTouchEvent("touchstart", hit.id, id, x, y, dx, dy, pressure, bubblePath))
  end
end

--- Call from love.touchreleased(id, x, y, dx, dy, pressure).
--- Dispatches a touchend event to the node under the touch point.
function ReactLove.touchreleased(id, x, y, dx, dy, pressure)
  if not isRendering() then return end

  local root = tree.getTree()
  if not root then return end

  local hit = events.hitTest(root, x, y)
  if hit then
    local bubblePath = events.buildBubblePath(hit)
    pushEvent(events.createTouchEvent("touchend", hit.id, id, x, y, dx, dy, pressure, bubblePath))
  end
end

--- Call from love.touchmoved(id, x, y, dx, dy, pressure).
--- Dispatches a touchmove event (broadcast globally, finger may have moved off element).
function ReactLove.touchmoved(id, x, y, dx, dy, pressure)
  if not isRendering() then return end
  if not bridge then return end

  pushEvent(events.createTouchEvent("touchmove", nil, id, x, y, dx, dy, pressure))
end

--- Call from love.gamepadpressed(joystick, button).
--- Dispatches a global gamepad button press event.
function ReactLove.gamepadpressed(joystick, button)
  if not isRendering() then return end
  if not bridge then return end

  local joystickId = joystick:getID()
  pushEvent(events.createGamepadButtonEvent("gamepadpressed", button, joystickId))
end

--- Call from love.gamepadreleased(joystick, button).
--- Dispatches a global gamepad button release event.
function ReactLove.gamepadreleased(joystick, button)
  if not isRendering() then return end
  if not bridge then return end

  local joystickId = joystick:getID()
  pushEvent(events.createGamepadButtonEvent("gamepadreleased", button, joystickId))
end

--- Call from love.gamepadaxis(joystick, axis, value).
--- Dispatches a global gamepad axis movement event.
function ReactLove.gamepadaxis(joystick, axis, value)
  if not isRendering() then return end
  if not bridge then return end

  local joystickId = joystick:getID()
  pushEvent(events.createGamepadAxisEvent(axis, value, joystickId))
end

--- Call from love.quit().
--- Cleans up the bridge and releases resources.
function ReactLove.quit()
  if mode == "native" and bridge then
    bridge:destroy()
  end
  -- canvas mode uses bridge_fs which has no destroy method
  bridge = nil
end

--- Return the active bridge instance.
--- Useful for game code that needs to push custom events or call bridge APIs.
function ReactLove.getBridge()
  return bridge
end

--- Return the current mode ("web", "native", or "canvas").
function ReactLove.getMode()
  return mode
end

--- Return the tree module (native/canvas mode only).
function ReactLove.getTree()
  return tree
end

--- Return the measure module (native/canvas mode only).
--- Useful for game code that needs to measure text outside the layout pass.
function ReactLove.getMeasure()
  return measure
end

--- Set the scroll position for a node programmatically.
--- @param nodeId number|string The node ID of the scroll container
--- @param scrollX number Desired horizontal scroll position in pixels
--- @param scrollY number Desired vertical scroll position in pixels
function ReactLove.setScroll(nodeId, scrollX, scrollY)
  if not isRendering() then return end
  if not tree then return end
  tree.setScroll(nodeId, scrollX or 0, scrollY or 0)
end

return ReactLove
