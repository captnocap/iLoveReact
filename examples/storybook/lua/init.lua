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
local errors     = require("lua.errors")      -- error overlay (always loaded, self-contained)
local inspector  = require("lua.inspector")   -- debug inspector (F12 toggle, self-contained)
local console    = require("lua.console")     -- interactive eval console (` toggle, self-contained)
local screenshot = nil                        -- screenshot.lua (loaded on demand)
local inspectorEnabled = true                 -- can be disabled via config.inspector = false

local animate  = nil   -- animate.lua module (Lua-side transitions/animations)
local images   = nil   -- images.lua module (image cache)
local focus    = require("lua.focus")         -- focus manager for Lua-owned inputs
local texteditor = nil                        -- texteditor.lua (loaded on demand)

local mode     = nil   -- "web", "native", or "canvas"
local basePath = nil   -- directory containing these modules
local initConfig = nil -- stashed config from init() for reload()

-- Interaction style overlay tracking (hoverStyle / activeStyle)
-- Maps nodeId -> { [propKey] = baseValue } for properties overridden by interaction
local interactionBase = {}

-- HMR state
local hmrFrameCounter = 0
local hmrLastMtime    = nil
local hmrHasLoaded    = false

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

-- ============================================================================
-- Interaction style overlay (hoverStyle / activeStyle)
-- ============================================================================

--- Apply or remove hoverStyle/activeStyle overlays on a node based on current
--- hover and pressed state. Uses the transition system for smooth animations
--- when the node has a `transition` config in its style.
--- This runs entirely in Lua for 0-frame latency feedback.
local function applyInteractionStyle(node)
  if not node or not node.props then return end

  local hoverStyle = node.props.hoverStyle
  local activeStyle = node.props.activeStyle
  if not hoverStyle and not activeStyle then return end

  local isHovered = events and events.getHoveredNode() == node
  local isPressed = events and events.getPressedNode() == node

  -- Get or create base style tracking for this node
  if not interactionBase[node.id] then
    interactionBase[node.id] = {}
  end
  local base = interactionBase[node.id]

  -- Collect all overridable keys from both hover and active styles
  local allKeys = {}
  if hoverStyle then for k in pairs(hoverStyle) do allKeys[k] = true end end
  if activeStyle then for k in pairs(activeStyle) do allKeys[k] = true end end

  local oldValues = {}
  local newValues = {}
  local anyChange = false

  for k in pairs(allKeys) do
    -- Save base value if not already saved (use sentinel for nil)
    if base[k] == nil then
      if node.style[k] == nil then
        base[k] = "__NIL__"
      else
        base[k] = node.style[k]
      end
    end

    -- Compute target: active > hover > base (priority order)
    local target
    if isPressed and activeStyle and activeStyle[k] ~= nil then
      target = activeStyle[k]
    elseif isHovered and hoverStyle and hoverStyle[k] ~= nil then
      target = hoverStyle[k]
    else
      target = base[k]
      if target == "__NIL__" then target = nil end
    end

    local current = node.style[k]
    if current ~= target then
      oldValues[k] = current
      newValues[k] = target
      node.style[k] = target
      anyChange = true
    end
  end

  -- Clean up base tracking if no longer hovered or pressed
  if not isHovered and not isPressed then
    interactionBase[node.id] = nil
  end

  -- Trigger transitions if configured
  if anyChange and animate and node.style.transition then
    animate.processStyleUpdate(node, oldValues, newValues)
  end

  -- Mark tree dirty if anything changed (layout or visual)
  if anyChange and tree then
    tree.markDirty()
  end
end

-- ============================================================================
-- HMR helpers
-- ============================================================================

--- Serialize a Lua value to a JavaScript source literal string.
--- Handles strings, numbers, booleans, nil, and nested tables.
local function luaTableToJSLiteral(val)
  local t = type(val)
  if t == "string" then
    -- Escape backslashes, quotes, and newlines
    local escaped = val:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r")
    return '"' .. escaped .. '"'
  elseif t == "number" then
    return tostring(val)
  elseif t == "boolean" then
    return val and "true" or "false"
  elseif t == "nil" then
    return "null"
  elseif t == "table" then
    if val[1] ~= nil then
      -- Array
      local parts = {}
      for i, v in ipairs(val) do parts[i] = luaTableToJSLiteral(v) end
      return "[" .. table.concat(parts, ",") .. "]"
    else
      -- Object
      local parts = {}
      for k, v in pairs(val) do
        parts[#parts + 1] = '"' .. tostring(k) .. '":' .. luaTableToJSLiteral(v)
      end
      return "{" .. table.concat(parts, ",") .. "}"
    end
  end
  return "null"
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

  -- Inspector/console can be disabled for production builds
  inspectorEnabled = config.inspector ~= false

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

    measure = require("lua.measure")
    images  = require("lua.images")
    animate = require("lua.animate")

    tree    = require("lua.tree")
    tree.init({ images = images, animate = animate })

    animate.init({ tree = tree })

    layout  = require("lua.layout")
    layout.init({ measure = measure })

    painter = require("lua.painter")
    painter.init({ measure = measure, images = images })

    events  = require("lua.events")
    events.setTreeModule(tree)

    texteditor = require("lua.texteditor")
    texteditor.init({ measure = measure })

    print("[react-love] Initialized in CANVAS mode (Module.FS bridge + native rendering)")

  else
    -- Native mode: use QuickJS bridge + retained tree + layout + painter.
    initConfig = {
      libpath = config.libpath or "lib/libquickjs",
      bundlePath = config.bundlePath or "bundle.js",
    }

    local BridgeQJS = require("lua.bridge_quickjs")
    bridge = BridgeQJS.new(initConfig.libpath)

    measure = require("lua.measure")
    images  = require("lua.images")
    animate = require("lua.animate")

    tree    = require("lua.tree")
    tree.init({ images = images, animate = animate })

    animate.init({ tree = tree })

    layout  = require("lua.layout")
    layout.init({ measure = measure })

    painter = require("lua.painter")
    painter.init({ measure = measure, images = images })

    events  = require("lua.events")
    events.setTreeModule(tree)

    texteditor = require("lua.texteditor")
    texteditor.init({ measure = measure })

    -- Load the bundled React app into QuickJS
    local bundleJS = love.filesystem.read(initConfig.bundlePath)
    if not bundleJS then
      error("[react-love] " .. initConfig.bundlePath .. " not found -- run `npm run build` first")
    end

    -- Tell the bundle to defer root.render() so JS_Eval returns immediately.
    -- React's synchronous LegacyRoot render would otherwise block inside JS_Eval.
    bridge:eval("globalThis.__deferMount = true;", "<pre-bundle>")

    print("[react-love] Evaluating bundle (" .. #bundleJS .. " bytes)...")
    bridge:eval(bundleJS, initConfig.bundlePath)
    print("[react-love] Bundle loaded OK")

    -- Don't mount yet — that happens in the first update() call so the
    -- Love2D event loop is running and we can tick timers between frames.
    ReactLove._needsMount = true

    print("[react-love] Initialized in NATIVE mode (QuickJS bridge)")
  end

  -- Wire up console + inspector (only in rendering modes with inspector enabled)
  if isRendering() and inspectorEnabled then
    console.init({ bridge = bridge, tree = tree, inspector = inspector })
    inspector.setConsole(console)
  end

  -- Screenshot mode (env var trigger, works in native and canvas modes)
  if os.getenv("ILOVEREACT_SCREENSHOT") == "1" then
    screenshot = require("lua.screenshot")
    screenshot.init({
      outputPath = os.getenv("ILOVEREACT_SCREENSHOT_OUTPUT") or "screenshot.png",
    })
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

    -- 3. Tick Lua-side transitions and animations (before layout)
    if animate then animate.tick(dt) end

    -- 4. Relayout if tree changed
    if tree.isDirty() then
      local root = tree.getTree()
      if root then
        if inspectorEnabled and inspector.isEnabled() then inspector.beginLayout() end
        layout.layout(root)
        if inspectorEnabled and inspector.isEnabled() then inspector.endLayout() end
      end
      tree.clearDirty()
    end

    -- Update TextEditor blink timer if one has focus (canvas mode)
    local canvasFocusedNode = focus.get()
    if canvasFocusedNode and canvasFocusedNode.type == "TextEditor" then
      texteditor.update(canvasFocusedNode, dt)
    end

    if inspectorEnabled then inspector.update(dt) end
    if inspectorEnabled then console.update(dt) end
    if screenshot then screenshot.update() end

    -- 5. Flush bridge outbox (events back to JS)
    bridge.flush()
    return
  end

  -- Native mode -----------------------------------------------------------

  -- HMR: poll bundle.js mtime every ~1 second for changes
  hmrFrameCounter = hmrFrameCounter + 1
  if hmrFrameCounter % 60 == 0 and initConfig then
    local info = love.filesystem.getInfo(initConfig.bundlePath)
    if info and info.modtime then
      if hmrLastMtime == nil then
        hmrLastMtime = info.modtime
      elseif info.modtime ~= hmrLastMtime then
        hmrLastMtime = info.modtime
        if hmrHasLoaded then
          ReactLove.reload()
          return
        end
      end
      hmrHasLoaded = true
    end
  end

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
    errors.push({
      source = "bridge",
      message = tostring(err),
      context = "event dispatch (_pollAndDispatchEvents)",
    })
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

  -- 5. Tick Lua-side transitions and animations (before layout)
  if animate then animate.tick(dt) end

  -- 6. Relayout if tree changed
  if tree.isDirty() then
    local root = tree.getTree()
    if root then
      if inspectorEnabled and inspector.isEnabled() then inspector.beginLayout() end
      layout.layout(root)
      if inspectorEnabled and inspector.isEnabled() then inspector.endLayout() end
    end
    tree.clearDirty()
  end

  -- Update TextEditor blink timer if one has focus
  local focusedNode = focus.get()
  if focusedNode and focusedNode.type == "TextEditor" then
    texteditor.update(focusedNode, dt)
  end

  if inspectorEnabled then inspector.update(dt) end
  if inspectorEnabled then console.update(dt) end
  if screenshot then screenshot.update() end
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
    if inspectorEnabled and inspector.isEnabled() then inspector.beginPaint() end
    local ok, paintErr = pcall(painter.paint, root)
    if inspectorEnabled and inspector.isEnabled() then inspector.endPaint() end
    if not ok then
      errors.push({
        source = "lua",
        message = tostring(paintErr),
        context = "painter.paint",
      })
    end
  end

  -- Inspector overlay (after paint, before errors)
  if inspectorEnabled then inspector.draw(root) end

  -- Error overlay renders on top of everything, using raw Love2D calls
  errors.draw()

  -- Screenshot capture (last thing in draw — captures the final framebuffer)
  if screenshot then screenshot.captureIfReady() end
end

--- Call from love.mousepressed(x, y, button).
--- Hit-tests the tree and dispatches a click event to JS.
--- Also starts tracking for potential drag operations.
function ReactLove.mousepressed(x, y, button)
  -- Error overlay gets first crack at mouse events
  if errors.mousepressed(x, y, button) then return end
  if inspectorEnabled and inspector.mousepressed(x, y, button) then return end

  if not isRendering() then return end

  local root = tree.getTree()
  if not root then return end

  local hit = events.hitTest(root, x, y)

  -- Handle TextEditor focus transitions
  local focusedNode = focus.get()
  if focusedNode and focusedNode.type == "TextEditor" then
    if hit ~= focusedNode then
      -- Clicking away from a focused TextEditor: blur it
      local value = texteditor.blur(focusedNode)
      focus.clear()
      pushEvent({
        type = "texteditor:blur",
        payload = {
          type = "texteditor:blur",
          targetId = focusedNode.id,
          value = value,
        }
      })
    end
  end

  if hit then
    if hit.type == "TextEditor" then
      -- Clicked a TextEditor: handle internally
      if texteditor.handleMousePressed(hit, x, y, button) then
        if not focus.isFocused(hit) then
          focus.set(hit)
          pushEvent({
            type = "texteditor:focus",
            payload = {
              type = "texteditor:focus",
              targetId = hit.id,
              value = texteditor.getValue(hit),
            }
          })
        end
      end
    else
      -- Normal node: standard drag + click handling
      events.startDrag(hit.id, x, y)
      local bubblePath = events.buildBubblePath(hit)
      pushEvent(events.createEvent("click", hit.id, x, y, button, bubblePath))

      -- Apply active (pressed) interaction style (0-frame latency)
      events.setPressedNode(hit)
      applyInteractionStyle(hit)
    end
  end
end

--- Call from love.mousereleased(x, y, button).
--- Ends any active drag operation and dispatches release event.
function ReactLove.mousereleased(x, y, button)
  if not isRendering() then return end

  -- TextEditor drag selection release
  local focusedNode = focus.get()
  if focusedNode and focusedNode.type == "TextEditor" then
    texteditor.handleMouseReleased(focusedNode)
  end

  local root = tree.getTree()
  if not root then return end

  -- End drag if active
  local dragEndEvent = events.endDrag(x, y)
  if dragEndEvent then
    pushEvent(dragEndEvent)
  end

  -- Clear pressed (active) state and revert active style (0-frame latency)
  local prevPressed = events.getPressedNode()
  events.clearPressedNode()
  if prevPressed then
    applyInteractionStyle(prevPressed)
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
  if inspectorEnabled then inspector.mousemoved(x, y) end
  if not isRendering() then return end

  -- TextEditor drag selection
  local focusedNode = focus.get()
  if focusedNode and focusedNode.type == "TextEditor" then
    if texteditor.handleMouseMoved(focusedNode, x, y) then
      return  -- TextEditor consumed the mouse move
    end
  end

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
  local prevHovered = events.getHoveredNode()
  local hoverEvents = events.updateHover(root, x, y)
  for _, evt in ipairs(hoverEvents) do
    pushEvent(evt)
  end

  -- Apply interaction style overlays for hover state changes (0-frame latency)
  local currHovered = events.getHoveredNode()
  if prevHovered ~= currHovered then
    if prevHovered then applyInteractionStyle(prevHovered) end
    if currHovered then applyInteractionStyle(currHovered) end
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
  if inspectorEnabled and inspector.keypressed(key) then return end
  if not isRendering() then return end

  -- Route to focused TextEditor if any
  local focusedNode = focus.get()
  if focusedNode and focusedNode.type == "TextEditor" then
    local result = texteditor.handleKeyPressed(focusedNode, key, scancode, isrepeat)
    if result == "blur" then
      local value = texteditor.blur(focusedNode)
      focus.clear()
      pushEvent({
        type = "texteditor:blur",
        payload = {
          type = "texteditor:blur",
          targetId = focusedNode.id,
          value = value,
        }
      })
    elseif result == "submit" then
      local value = texteditor.getValue(focusedNode)
      pushEvent({
        type = "texteditor:submit",
        payload = {
          type = "texteditor:submit",
          targetId = focusedNode.id,
          value = value,
        }
      })
    end
    return  -- consumed by TextEditor, do NOT broadcast to bridge
  end

  if not bridge then return end
  pushEvent(events.createKeyEvent("keydown", key, scancode, isrepeat))
end

--- Call from love.keyreleased(key, scancode).
--- Dispatches a global keyup event to all JS keyboard listeners.
function ReactLove.keyreleased(key, scancode)
  if not isRendering() then return end

  -- Suppress keyup when TextEditor has focus
  local focusedNode = focus.get()
  if focusedNode and focusedNode.type == "TextEditor" then
    return
  end

  if not bridge then return end
  pushEvent(events.createKeyEvent("keyup", key, scancode, false))
end

--- Call from love.textinput(text).
--- Dispatches a text input event (handles unicode, IME, etc.).
function ReactLove.textinput(text)
  -- Inspector/console captures text input when active
  if inspectorEnabled and inspector.textinput(text) then return end
  if not isRendering() then return end

  -- Route to focused TextEditor if any
  local focusedNode = focus.get()
  if focusedNode and focusedNode.type == "TextEditor" then
    texteditor.handleTextInput(focusedNode, text)
    return  -- consumed, no bridge traffic
  end

  if not bridge then return end
  pushEvent(events.createTextInputEvent(text))
end

--- Call from love.wheelmoved(x, y).
--- If the wheel event hits a scroll container, update its scroll position
--- directly in Lua for immediate visual response AND send the event to JS.
--- The scroll speed multiplier converts Love2D wheel units to pixels.
function ReactLove.wheelmoved(x, y)
  if inspectorEnabled and inspector.wheelmoved(x, y) then return end
  if not isRendering() then return end

  local root = tree.getTree()
  if not root then return end

  -- Get current mouse position
  local mx, my = love.mouse.getPosition()
  local hit = events.hitTest(root, mx, my)
  if not hit then return end

  -- TextEditor handles its own scroll entirely in Lua
  if hit.type == "TextEditor" then
    texteditor.handleWheel(hit, x, y)
    return  -- no bridge traffic
  end

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

--- Hot-reload the JS bundle without restarting Love2D.
--- Destroys the QuickJS context, clears all Lua-side state, recreates
--- the bridge with the new bundle, and restores dev state if available.
function ReactLove.reload()
  if mode ~= "native" or not bridge or not initConfig then
    print("[react-love] reload() only works in native mode")
    return
  end

  io.write("[react-love] Hot reload starting...\n"); io.flush()

  -- 1. Read dev state from JS before teardown (pcall'd — safe if missing)
  local devStateCache = nil
  local sok, sval = pcall(function() return bridge:callGlobalReturn("__getDevState") end)
  if sok and sval then
    devStateCache = sval
  end

  -- 2. Teardown
  bridge:destroy()
  if images then images.clearCache() end
  if animate then animate.clear() end
  tree.init({ images = images, animate = animate })
  if animate then animate.init({ tree = tree }) end
  events.clearHover()
  events.clearPressedNode()
  interactionBase = {}
  focus.clear()
  pcall(function() events.endDrag(0, 0) end)
  measure.clearCache()

  -- 3. Recreate bridge
  local BridgeQJS = require("lua.bridge_quickjs")
  bridge = BridgeQJS.new(initConfig.libpath)

  -- 4. Re-read bundle from disk
  local bundleJS = love.filesystem.read(initConfig.bundlePath)
  if not bundleJS then
    errors.push({
      source = "lua",
      message = initConfig.bundlePath .. " not found during reload",
      context = "ReactLove.reload",
    })
    return
  end

  -- 5. Set up deferred mount + inject cached dev state
  bridge:eval("globalThis.__deferMount = true;", "<pre-bundle>")
  if devStateCache then
    local jsLiteral = luaTableToJSLiteral(devStateCache)
    bridge:eval("globalThis.__devState = " .. jsLiteral .. ";", "<hmr-state>")
  end

  -- 6. Evaluate new bundle
  local eok, eerr = pcall(function()
    bridge:eval(bundleJS, initConfig.bundlePath)
  end)
  if not eok then
    errors.push({
      source = "js",
      message = tostring(eerr),
      context = "ReactLove.reload (bundle eval)",
    })
    return
  end

  -- 7. Update console refs (bridge was recreated)
  if inspectorEnabled then
    console.updateRefs({ bridge = bridge, tree = tree })
  end

  -- 8. Trigger mount on next update
  ReactLove._needsMount = true
  ReactLove._loggedCommands = nil
  ReactLove._loggedDraw = nil

  io.write("[react-love] Hot reload complete (" .. #bundleJS .. " bytes)\n"); io.flush()
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
