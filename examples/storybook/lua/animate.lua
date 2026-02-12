--[[
  animate.lua -- Lua-side transition and animation engine

  Follows the TextEditor "Lua-owns-interaction" pattern: JS declares targets
  via style props, Lua interpolates autonomously. Zero per-frame bridge traffic
  for active animations.

  Architecture:
    - JS sends `transition` config as part of the style (e.g., transition = {
        backgroundColor = { duration = 300, easing = "easeInOut" } })
    - tree.lua detects style changes on UPDATE and calls Animate.processStyleUpdate()
    - For transitioned properties, Animate stores {from, to, startTime, ...} and
      writes the interpolated value to node.style each frame
    - Painter reads node.style as normal -- no painter changes needed
    - Visual-only properties (opacity, colors, transform) skip re-layout
    - Layout-affecting properties (width, height, padding, margin) mark tree dirty

  Supports:
    - CSS transition: per-property duration, easing, delay
    - Easing: linear, easeIn, easeOut, easeInOut, bezier, bounce, elastic
    - Color interpolation: hex strings lerped in RGBA space
    - Transform interpolation: per-component lerp (translate, rotate, scale)
    - Percentage string interpolation: "50%" -> "75%"
    - Keyframe animations: placeholder for Phase B
]]

local Animate = {}

-- ============================================================================
-- State
-- ============================================================================

local activeNodes = {}   -- nodeId -> node (nodes with running transitions/animations)
local treeRef = nil      -- reference to tree module for markDirty()

-- ============================================================================
-- Init
-- ============================================================================

--- Initialize the animation module.
--- @param config table|nil  { tree = TreeModule }
function Animate.init(config)
  config = config or {}
  treeRef = config.tree
  activeNodes = {}
end

-- ============================================================================
-- Easing functions (ported from packages/shared/src/animation.ts)
-- ============================================================================

local easing = {}

easing.linear = function(t) return t end

easing.easeIn = function(t) return t * t end

easing.easeOut = function(t) return t * (2 - t) end

easing.easeInOut = function(t)
  if t < 0.5 then return 2 * t * t end
  return -1 + (4 - 2 * t) * t
end

-- Cubic bezier helpers
local function cubicBezier(t, p1, p2)
  local mt = 1 - t
  return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t
end

local function cubicBezierDerivative(t, p1, p2)
  local mt = 1 - t
  return 3 * mt * mt * p1 + 6 * mt * t * (p2 - p1) + 3 * t * t * (1 - p2)
end

--- Create a cubic bezier easing function.
--- @param x1 number Control point 1 X
--- @param y1 number Control point 1 Y
--- @param x2 number Control point 2 X
--- @param y2 number Control point 2 Y
--- @return function Easing function
function easing.bezier(x1, y1, x2, y2)
  return function(t)
    if t <= 0 then return 0 end
    if t >= 1 then return 1 end
    -- Newton-Raphson: solve for u where bezierX(u) = t
    local u = t
    for _ = 1, 8 do
      local xEst = cubicBezier(u, x1, x2) - t
      if math.abs(xEst) < 1e-6 then break end
      local dx = cubicBezierDerivative(u, x1, x2)
      if math.abs(dx) < 1e-6 then break end
      u = u - xEst / dx
    end
    u = math.max(0, math.min(1, u))
    return cubicBezier(u, y1, y2)
  end
end

easing.bounce = function(t)
  if t < 1 / 2.75 then
    return 7.5625 * t * t
  elseif t < 2 / 2.75 then
    local t2 = t - 1.5 / 2.75
    return 7.5625 * t2 * t2 + 0.75
  elseif t < 2.5 / 2.75 then
    local t2 = t - 2.25 / 2.75
    return 7.5625 * t2 * t2 + 0.9375
  else
    local t2 = t - 2.625 / 2.75
    return 7.5625 * t2 * t2 + 0.984375
  end
end

--- Create an elastic easing function.
--- @param bounciness number|nil Bounciness factor (default 1)
--- @return function Easing function
function easing.elastic(bounciness)
  bounciness = bounciness or 1
  local p = 0.3 / math.max(bounciness, 0.001)
  return function(t)
    if t <= 0 then return 0 end
    if t >= 1 then return 1 end
    return math.pow(2, -10 * t) * math.sin(((t - p / 4) * (2 * math.pi)) / p) + 1
  end
end

--- Resolve an easing specifier to a function.
--- Accepts: string name, function, or table { type="bezier", [1]=x1, [2]=y1, ... }
--- @param e any Easing specifier
--- @return function
local function resolveEasing(e)
  if type(e) == "function" then return e end
  if type(e) == "string" then
    -- Handle "elastic" with default bounciness
    if e == "elastic" then return easing.elastic(1) end
    return easing[e] or easing.easeInOut
  end
  if type(e) == "table" then
    -- Bezier: { type = "bezier", x1, y1, x2, y2 } or just { x1, y1, x2, y2 }
    if e.type == "bezier" or (#e == 4 and type(e[1]) == "number") then
      return easing.bezier(e[1] or e.x1 or 0, e[2] or e.y1 or 0,
                           e[3] or e.x2 or 1, e[4] or e.y2 or 1)
    end
    -- Elastic with custom bounciness: { type = "elastic", bounciness = 2 }
    if e.type == "elastic" then
      return easing.elastic(e.bounciness or 1)
    end
  end
  return easing.easeInOut
end

-- ============================================================================
-- Color parsing and interpolation
-- ============================================================================

--- Parse a color value to RGBA components (0-1 range).
--- Accepts hex strings ("#rrggbb", "#rrggbbaa"), "transparent", or {r,g,b,a} tables.
--- @param c any Color value
--- @return number|nil r, number|nil g, number|nil b, number|nil a
local function parseColor(c)
  if type(c) == "table" then
    return c[1] or 0, c[2] or 0, c[3] or 0, c[4] or 1
  end
  if type(c) ~= "string" then return nil end
  if c == "transparent" then return 0, 0, 0, 0 end
  local r, g, b, a = c:match("#(%x%x)(%x%x)(%x%x)(%x?%x?)")
  if r then
    local alpha = 1
    if a and a ~= "" then alpha = tonumber(a, 16) / 255 end
    return tonumber(r, 16) / 255, tonumber(g, 16) / 255, tonumber(b, 16) / 255, alpha
  end
  return nil
end

--- Convert RGBA components (0-1) to a hex color string.
--- @param r number Red 0-1
--- @param g number Green 0-1
--- @param b number Blue 0-1
--- @param a number Alpha 0-1
--- @return string Hex color string
local function colorToHex(r, g, b, a)
  local ri = math.floor(r * 255 + 0.5)
  local gi = math.floor(g * 255 + 0.5)
  local bi = math.floor(b * 255 + 0.5)
  if a ~= nil and a < 0.999 then
    local ai = math.floor(a * 255 + 0.5)
    return string.format("#%02x%02x%02x%02x", ri, gi, bi, ai)
  end
  return string.format("#%02x%02x%02x", ri, gi, bi)
end

-- ============================================================================
-- Value interpolation
-- ============================================================================

--- Linearly interpolate between two numbers.
local function lerp(a, b, t)
  return a + (b - a) * t
end

--- Properties that require color interpolation.
local colorProps = {
  backgroundColor = true,
  borderColor = true,
  borderTopColor = true,
  borderRightColor = true,
  borderBottomColor = true,
  borderLeftColor = true,
  shadowColor = true,
  color = true,
}

--- Properties that are visual-only and do NOT affect layout.
--- Transitions on these skip tree.markDirty() for performance.
local visualOnlyProps = {
  opacity = true,
  backgroundColor = true,
  borderColor = true,
  borderTopColor = true,
  borderRightColor = true,
  borderBottomColor = true,
  borderLeftColor = true,
  shadowColor = true,
  shadowOffsetX = true,
  shadowOffsetY = true,
  shadowBlur = true,
  color = true,
  transform = true,
  zIndex = true,
  backgroundGradient = true,
}

--- Interpolate a transform object component by component.
--- @param from table|nil Source transform
--- @param to table|nil Target transform
--- @param t number Progress 0-1
--- @return table Interpolated transform
local function lerpTransform(from, to, t)
  if not from and not to then return nil end
  from = from or {}
  to = to or {}
  local result = {}

  local keys = { "translateX", "translateY", "rotate", "scaleX", "scaleY", "originX", "originY" }
  for _, key in ipairs(keys) do
    local fv = from[key]
    local tv = to[key]
    if fv ~= nil or tv ~= nil then
      -- Defaults: scale=1, origin=0.5, everything else=0
      local defaultVal = 0
      if key == "scaleX" or key == "scaleY" then defaultVal = 1
      elseif key == "originX" or key == "originY" then defaultVal = 0.5
      end
      fv = fv or defaultVal
      tv = tv or defaultVal
      result[key] = lerp(fv, tv, t)
    end
  end

  return result
end

--- Interpolate a single style value based on its property name.
--- Handles numbers, colors, transforms, and percentage strings.
--- @param from any Source value
--- @param to any Target value
--- @param t number Progress 0-1
--- @param propName string The style property name
--- @return any Interpolated value
local function interpolateValue(from, to, t, propName)
  -- Color interpolation
  if colorProps[propName] then
    local r1, g1, b1, a1 = parseColor(from)
    local r2, g2, b2, a2 = parseColor(to)
    if r1 and r2 then
      return colorToHex(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t), lerp(a1, a2, t))
    end
    -- Cannot interpolate, snap at midpoint
    if t < 0.5 then return from else return to end
  end

  -- Transform interpolation
  if propName == "transform" then
    return lerpTransform(from, to, t)
  end

  -- Numeric interpolation
  if type(from) == "number" and type(to) == "number" then
    return lerp(from, to, t)
  end

  -- Percentage string interpolation ("50%" -> "75%")
  if type(from) == "string" and type(to) == "string" then
    local fNum = tonumber(from:match("^([%d%.]+)%%$"))
    local tNum = tonumber(to:match("^([%d%.]+)%%$"))
    if fNum and tNum then
      return string.format("%.1f%%", lerp(fNum, tNum, t))
    end
  end

  -- Cannot interpolate, snap at midpoint
  if t < 0.5 then return from else return to end
end

-- ============================================================================
-- Transition processing
-- ============================================================================

--- Process a style update on a node, setting up transitions for properties
--- that have a transition config.
---
--- Called by tree.lua AFTER the style diff has been applied to node.style.
--- For transitioned properties, this function writes the "from" value back
--- to node.style (so the visual doesn't jump) and sets up the interpolation
--- state. animate.tick() will update node.style each frame.
---
--- @param node table The tree node
--- @param oldValues table Map of propName -> previous value (before this UPDATE)
--- @param newValues table Map of propName -> new value (the style diff from JS)
function Animate.processStyleUpdate(node, oldValues, newValues)
  local transConfig = node.style and node.style.transition
  if not transConfig then return end

  for propName, newValue in pairs(newValues) do
    -- Skip config properties themselves
    if propName ~= "transition" and propName ~= "animation" then
      local oldValue = oldValues[propName]

      -- Only transition if value actually changed and we have a previous value
      if oldValue ~= nil and oldValue ~= newValue then
        -- Check for per-property or "all" config
        local config = transConfig[propName] or transConfig.all
        if config and type(config) == "table" then
          -- Set up transition state
          if not node.transitionState then node.transitionState = {} end

          -- If a transition is already running, start from its current interpolated value
          local existing = node.transitionState[propName]
          local fromValue = oldValue
          if existing and existing.current ~= nil then
            fromValue = existing.current
          end

          node.transitionState[propName] = {
            from = fromValue,
            to = newValue,
            startTime = love.timer.getTime(),
            duration = (config.duration or 300) / 1000,  -- ms -> seconds
            easing = config.easing or "easeInOut",
            delay = (config.delay or 0) / 1000,          -- ms -> seconds
            current = fromValue,
          }

          -- Write back the from value so the visual doesn't jump
          node.style[propName] = fromValue

          -- Register this node as active
          activeNodes[node.id] = node
        end
      end
    end
  end
end

--- Called when a node is removed from the tree.
--- Cleans up any active transitions/animations.
--- @param nodeId number|string The node ID being removed
function Animate.onNodeRemoved(nodeId)
  activeNodes[nodeId] = nil
end

-- ============================================================================
-- Per-frame tick
-- ============================================================================

--- Update all active transitions and animations.
--- Call once per frame from init.lua, AFTER tree.applyCommands and BEFORE layout.
--- @param dt number Delta time in seconds (from love.update)
--- @return boolean True if any animations are still active
function Animate.tick(dt)
  local now = love.timer.getTime()
  local toRemove = {}
  local needsLayout = false

  for nodeId, node in pairs(activeNodes) do
    local allDone = true

    -- ── Process transitions ──
    if node.transitionState then
      for propName, ts in pairs(node.transitionState) do
        local elapsed = now - ts.startTime

        if elapsed < ts.delay then
          -- Still in delay period
          allDone = false
        else
          local activeElapsed = elapsed - ts.delay
          local progress = 1
          if ts.duration > 0 then
            progress = math.min(activeElapsed / ts.duration, 1)
          end

          local easingFn = resolveEasing(ts.easing)
          local easedProgress = easingFn(progress)
          local value = interpolateValue(ts.from, ts.to, easedProgress, propName)

          ts.current = value
          node.style[propName] = value

          if progress >= 1 then
            -- Transition complete: snap to final value and clean up
            node.style[propName] = ts.to
            node.transitionState[propName] = nil
          else
            allDone = false
          end

          -- Layout-affecting properties need tree relayout
          if not visualOnlyProps[propName] then
            needsLayout = true
          end
        end
      end

      -- Clean up empty transitionState table
      if allDone then
        local hasAny = false
        for _ in pairs(node.transitionState) do hasAny = true; break end
        if not hasAny then node.transitionState = nil end
      end
    end

    -- ── Process keyframe animations (Phase B placeholder) ──
    if node.animationState then
      local as = node.animationState
      if as.playState ~= "paused" then
        local elapsed = now - as.startTime

        if elapsed < (as.delay or 0) then
          allDone = false
        else
          local activeElapsed = elapsed - (as.delay or 0)
          local iterationProgress = 0
          if as.duration > 0 then
            iterationProgress = activeElapsed / as.duration
          end

          -- Handle iterations
          local currentIteration = math.floor(iterationProgress)
          local withinIteration = iterationProgress - currentIteration

          -- Check completion
          local iterations = as.iterations or 1
          local isComplete = iterations > 0 and currentIteration >= iterations
          if isComplete then
            withinIteration = 1
            currentIteration = iterations - 1
          end

          -- Apply direction
          local direction = as.direction or "normal"
          local progress = withinIteration
          if direction == "reverse" then
            progress = 1 - progress
          elseif direction == "alternate" then
            if currentIteration % 2 == 1 then progress = 1 - progress end
          elseif direction == "alternate-reverse" then
            if currentIteration % 2 == 0 then progress = 1 - progress end
          end

          -- Apply easing
          local easingFn = resolveEasing(as.easing)
          local easedProgress = easingFn(progress)

          -- Interpolate keyframe values
          local keyframes = as.keyframes
          if keyframes then
            -- Find bounding keyframe stops
            local stops = as.sortedStops
            if not stops then
              stops = {}
              for pct in pairs(keyframes) do
                stops[#stops + 1] = tonumber(pct) or 0
              end
              table.sort(stops)
              as.sortedStops = stops
            end

            local scaledProgress = easedProgress * 100
            local lowerIdx, upperIdx = 1, #stops
            for i = 1, #stops - 1 do
              if scaledProgress >= stops[i] and scaledProgress <= stops[i + 1] then
                lowerIdx = i
                upperIdx = i + 1
                break
              end
            end

            local lowerPct = stops[lowerIdx]
            local upperPct = stops[upperIdx]
            local segmentT = 0
            if upperPct ~= lowerPct then
              segmentT = (scaledProgress - lowerPct) / (upperPct - lowerPct)
            end

            local lowerFrame = keyframes[tostring(lowerPct)] or keyframes[lowerPct]
            local upperFrame = keyframes[tostring(upperPct)] or keyframes[upperPct]

            if lowerFrame and upperFrame then
              -- Collect all animated property names
              local animProps = {}
              for k in pairs(lowerFrame) do animProps[k] = true end
              for k in pairs(upperFrame) do animProps[k] = true end

              -- Interpolate each property
              if not as.currentValues then as.currentValues = {} end
              for propName in pairs(animProps) do
                local fv = lowerFrame[propName]
                local tv = upperFrame[propName]
                if fv ~= nil and tv ~= nil then
                  local value = interpolateValue(fv, tv, segmentT, propName)
                  as.currentValues[propName] = value
                  node.style[propName] = value
                  if not visualOnlyProps[propName] then
                    needsLayout = true
                  end
                end
              end
            end
          end

          if isComplete then
            -- Apply fill mode
            local fillMode = as.fillMode or "none"
            if fillMode == "none" then
              -- Restore original style values
              if as.originalValues then
                for propName, val in pairs(as.originalValues) do
                  node.style[propName] = val
                end
              end
              node.animationState = nil
            elseif fillMode == "forwards" or fillMode == "both" then
              -- Keep final values (already applied)
              node.animationState = nil
            else
              node.animationState = nil
            end
          else
            allDone = false
          end
        end
      else
        -- Paused: keep node active but don't progress
        allDone = false
      end
    end

    if allDone then
      toRemove[#toRemove + 1] = nodeId
    end
  end

  -- Remove completed nodes from active set
  for _, nodeId in ipairs(toRemove) do
    activeNodes[nodeId] = nil
  end

  -- Mark tree dirty if layout-affecting properties changed
  if needsLayout and treeRef then
    treeRef.markDirty()
  end

  return next(activeNodes) ~= nil
end

-- ============================================================================
-- Animation setup (for keyframe animations via style.animation prop)
-- ============================================================================

--- Set up a keyframe animation on a node from its style.animation config.
--- Called by tree.lua when the animation prop is first set or changes.
--- @param node table The tree node
--- @param animConfig table The animation config from style.animation
function Animate.setupAnimation(node, animConfig)
  if not animConfig or not animConfig.keyframes then return end

  -- Snapshot original values for fillMode: "none" restore
  local originalValues = {}
  for _, frame in pairs(animConfig.keyframes) do
    if type(frame) == "table" then
      for propName in pairs(frame) do
        if originalValues[propName] == nil then
          originalValues[propName] = node.style[propName]
        end
      end
    end
  end

  node.animationState = {
    keyframes = animConfig.keyframes,
    duration = (animConfig.duration or 300) / 1000,    -- ms -> seconds
    easing = animConfig.easing or "linear",
    iterations = animConfig.iterations or 1,           -- -1 = infinite
    direction = animConfig.direction or "normal",
    fillMode = animConfig.fillMode or "none",
    delay = (animConfig.delay or 0) / 1000,            -- ms -> seconds
    startTime = love.timer.getTime(),
    playState = animConfig.playState or "running",
    originalValues = originalValues,
    currentValues = {},
    sortedStops = nil,                                 -- computed lazily
  }

  activeNodes[node.id] = node
end

-- ============================================================================
-- Utility
-- ============================================================================

--- Check if any animations or transitions are currently active.
--- @return boolean
function Animate.hasActiveAnimations()
  return next(activeNodes) ~= nil
end

--- Clear all active animations and transitions.
--- Call on hot reload or tree reset.
function Animate.clear()
  activeNodes = {}
end

--- Expose easing functions for external use.
Animate.easing = easing

--- Expose interpolation for external use (e.g., hover style merging).
Animate.interpolateValue = interpolateValue

--- Expose color utilities for external use.
Animate.parseColor = parseColor
Animate.colorToHex = colorToHex
Animate.lerp = lerp

return Animate
