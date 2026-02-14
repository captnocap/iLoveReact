--[[
  events.lua -- Hit testing and event dispatch

  Provides hit testing against the retained element tree (walks children in
  reverse paint order so the topmost node wins) and tracks hovered-node state
  for pointer enter/leave events.

  Paint order accounts for zIndex (sorted ascending, so reverse iteration
  checks highest zIndex first) and scroll containers (mouse coordinates are
  adjusted by the scroll offset when entering a scrollable node).
]]

local ZIndex = require("lua.zindex")

local Events = {}

local treeModule = nil

function Events.setTreeModule(tree)
  treeModule = tree
end

-- ============================================================================
-- State
-- ============================================================================

local hoveredNode = nil
local pressedNode = nil

local dragState = {
  active = false,
  targetId = nil,     -- the node where drag started
  startX = 0,
  startY = 0,
  lastX = 0,
  lastY = 0,
  thresholdCrossed = false,  -- whether we've moved enough to start dragging
}

local DRAG_THRESHOLD = 5  -- pixels of movement needed to trigger drag

-- ============================================================================
-- Hit testing
-- ============================================================================

--- Walk the tree to find the topmost node under (mx, my) that has event
--- handlers registered on the JS side (node.hasHandlers == true).
--- Uses reverse paint order (highest zIndex first) and adjusts coordinates
--- for scroll containers.
--- Returns the hit node or nil.
function Events.hitTest(node, mx, my)
  if not node or not node.computed then return nil end
  local s = node.style or {}
  local c = node.computed

  -- display:none nodes are not hittable
  if s.display == "none" then return nil end

  -- Point outside this node's bounding box (in screen space)
  if mx < c.x or mx > c.x + c.w or my < c.y or my > c.y + c.h then
    return nil
  end

  -- If this is a scroll container, adjust mouse coordinates by scroll offset
  -- so that children (which are laid out in content space) match screen hits
  local childMx, childMy = mx, my
  local isScroll = s.overflow == "scroll"
  if isScroll and node.scrollState then
    childMx = mx + (node.scrollState.scrollX or 0)
    childMy = my + (node.scrollState.scrollY or 0)
  end

  -- Get children in paint order (sorted by zIndex), then iterate in reverse
  -- so that the topmost (highest zIndex / last-painted) is checked first
  local children = node.children or {}
  local paintOrder = ZIndex.getSortedChildren(children)
  for i = #paintOrder, 1, -1 do
    local hit = Events.hitTest(paintOrder[i], childMx, childMy)
    if hit then return hit end
  end

  -- Return this node if it has JS event handlers
  if node.hasHandlers then return node end
  -- Nodes with hoverStyle/activeStyle are hittable for Lua-side interaction
  if node.props and (node.props.hoverStyle or node.props.activeStyle) then return node end
  -- Also return scroll containers so wheel events can scroll them
  -- even when no JS handler is attached
  if isScroll then return node end
  -- Lua-owned interactive nodes are always hittable
  if node.type == "TextEditor" then return node end
  if node.type == "CodeBlock" then return node end
  if node.type == "Video" then return node end
  return nil
end

--- Hit test specifically for Text nodes (used by text selection).
--- Only returns Text/__TEXT__ nodes, ignoring interactive ancestors.
--- This is separate from hitTest so that Pressable clicks aren't intercepted.
function Events.textHitTest(node, mx, my)
  if not node or not node.computed then return nil end
  local s = node.style or {}
  local c = node.computed

  if s.display == "none" then return nil end
  if mx < c.x or mx > c.x + c.w or my < c.y or my > c.y + c.h then
    return nil
  end

  local childMx, childMy = mx, my
  local isScroll = s.overflow == "scroll"
  if isScroll and node.scrollState then
    childMx = mx + (node.scrollState.scrollX or 0)
    childMy = my + (node.scrollState.scrollY or 0)
  end

  -- Check children first (deepest text node wins)
  local children = node.children or {}
  local paintOrder = ZIndex.getSortedChildren(children)
  for i = #paintOrder, 1, -1 do
    local hit = Events.textHitTest(paintOrder[i], childMx, childMy)
    if hit then return hit end
  end

  -- Return this node only if it's a Text node and selectable
  if node.type == "Text" and s.userSelect ~= "none" then
    return node
  end
  if node.type == "__TEXT__" then
    local ps = (node.parent and node.parent.style) or {}
    if s.userSelect ~= "none" and ps.userSelect ~= "none" then
      return node
    end
  end

  return nil
end

--- Convert screen coordinates to content-space coordinates for a node.
--- Walks up the parent chain accumulating scroll offsets.
function Events.screenToContent(node, sx, sy)
  local cx, cy = sx, sy
  local current = node.parent
  while current do
    local cs = current.style or {}
    if cs.overflow == "scroll" and current.scrollState then
      cx = cx + (current.scrollState.scrollX or 0)
      cy = cy + (current.scrollState.scrollY or 0)
    end
    current = current.parent
  end
  return cx, cy
end

--- Build the bubble path from a hit node up to the root.
--- Returns array of node IDs where hasHandlers == true,
--- starting with the target and walking up via parent pointers.
function Events.buildBubblePath(node)
  local path = {}
  local current = node
  while current do
    if current.hasHandlers then
      path[#path + 1] = current.id
    end
    current = current.parent
  end
  return path
end

--- Find the nearest scroll container ancestor that contains the point (mx, my).
--- Walks up from a hit node checking if any ancestor is a scroll container.
--- Returns the scroll container node or nil.
function Events.findScrollContainer(node, mx, my)
  if not node then return nil end

  local current = node
  while current do
    local s = current.style or {}
    if s.overflow == "scroll" and current.scrollState then
      return current
    end
    current = current.parent
  end

  return nil
end

-- ============================================================================
-- Event creation
-- ============================================================================

--- Build a structured event table suitable for sending to the JS bridge.
--- Format matches BridgeEvent: { type: string, payload: any }
function Events.createEvent(eventType, targetId, x, y, button, bubblePath)
  return {
    type = eventType,
    payload = {
      type = eventType,
      targetId = targetId,
      x = x,
      y = y,
      button = button,
      bubblePath = bubblePath,
    }
  }
end

--- Build a keyboard event for keydown/keyup.
--- Format matches BridgeEvent: { type: string, payload: any }
function Events.createKeyEvent(eventType, key, scancode, isRepeat)
  return {
    type = eventType,
    payload = {
      type = eventType,
      key = key,
      scancode = scancode,
      isRepeat = isRepeat or false,
    }
  }
end

--- Build a text input event.
--- Format matches BridgeEvent: { type: string, payload: any }
function Events.createTextInputEvent(text)
  return {
    type = "textinput",
    payload = {
      type = "textinput",
      text = text,
    }
  }
end

--- Build a wheel event for scroll input.
--- Format matches BridgeEvent: { type: string, payload: any }
function Events.createWheelEvent(targetId, x, y, dx, dy, bubblePath)
  return {
    type = "wheel",
    payload = {
      type = "wheel",
      targetId = targetId,
      x = x,
      y = y,
      deltaX = dx,
      deltaY = dy,
      bubblePath = bubblePath,
    }
  }
end

--- Build a touch event for touch input.
--- Format matches BridgeEvent: { type: string, payload: any }
function Events.createTouchEvent(eventType, targetId, touchId, x, y, dx, dy, pressure, bubblePath)
  return {
    type = eventType,
    payload = {
      type = eventType,
      targetId = targetId,
      touchId = touchId,
      x = x,
      y = y,
      dx = dx,
      dy = dy,
      pressure = pressure,
      bubblePath = bubblePath,
    }
  }
end

--- Build a gamepad button event for gamepad button press/release.
--- Format matches BridgeEvent: { type: string, payload: any }
function Events.createGamepadButtonEvent(eventType, button, joystickId)
  return {
    type = eventType,
    payload = {
      type = eventType,
      gamepadButton = button,
      joystickId = joystickId,
    }
  }
end

--- Build a gamepad axis event for gamepad stick/trigger movement.
--- Format matches BridgeEvent: { type: string, payload: any }
function Events.createGamepadAxisEvent(axis, value, joystickId)
  return {
    type = "gamepadaxis",
    payload = {
      type = "gamepadaxis",
      axis = axis,
      axisValue = value,
      joystickId = joystickId,
    }
  }
end

--- Build a drag event for drag interactions.
--- Format matches BridgeEvent: { type: string, payload: any }
function Events.createDragEvent(eventType, targetId, x, y, deltaX, deltaY, startX, startY)
  local bubblePath = nil
  if treeModule then
    local nodes = treeModule.getNodes()
    local node = nodes[targetId]
    if node then
      bubblePath = Events.buildBubblePath(node)
    end
  end
  return {
    type = eventType,
    payload = {
      type = eventType,
      targetId = targetId,
      x = x,
      y = y,
      deltaX = deltaX,  -- delta from LAST position
      deltaY = deltaY,
      startX = startX,  -- where drag began
      startY = startY,
      totalDeltaX = x - startX,  -- total delta from start
      totalDeltaY = y - startY,
      bubblePath = bubblePath,
    }
  }
end

-- ============================================================================
-- Pointer enter / leave tracking
-- ============================================================================

--- Update hover tracking. Call from love.mousemoved.
--- Returns a list of events to dispatch (may be empty, or contain
--- a pointerLeave and/or pointerEnter event).
function Events.updateHover(tree, mx, my)
  local hit = Events.hitTest(tree, mx, my)
  local eventsOut = {}

  if hit ~= hoveredNode then
    if hoveredNode then
      eventsOut[#eventsOut + 1] = Events.createEvent(
        "pointerLeave", hoveredNode.id, mx, my, nil
      )
    end
    if hit then
      eventsOut[#eventsOut + 1] = Events.createEvent(
        "pointerEnter", hit.id, mx, my, nil
      )
    end
    hoveredNode = hit
  end

  return eventsOut
end

--- Return the currently hovered node (or nil).
function Events.getHoveredNode()
  return hoveredNode
end

--- Reset hover state (e.g. on tree rebuild).
function Events.clearHover()
  hoveredNode = nil
end

-- ============================================================================
-- Pressed (active) node tracking
-- ============================================================================

--- Set the currently pressed node.
--- Called from mousepressed when a node is hit.
function Events.setPressedNode(node)
  pressedNode = node
end

--- Return the currently pressed node (or nil).
function Events.getPressedNode()
  return pressedNode
end

--- Clear pressed node state.
--- Called from mousereleased.
function Events.clearPressedNode()
  pressedNode = nil
end

-- ============================================================================
-- Drag tracking
-- ============================================================================

--- Start tracking a potential drag operation.
--- Called from mousepressed when a node is hit.
function Events.startDrag(targetId, x, y)
  dragState.active = true
  dragState.targetId = targetId
  dragState.startX = x
  dragState.startY = y
  dragState.lastX = x
  dragState.lastY = y
  dragState.thresholdCrossed = false
end

--- Update drag tracking during mouse movement.
--- Returns a drag event if the threshold has been crossed, nil otherwise.
--- Also returns a dragstart event on the first movement past threshold.
function Events.updateDrag(x, y)
  if not dragState.active then return nil end

  local dx = x - dragState.lastX
  local dy = y - dragState.lastY
  local eventsOut = {}

  -- Check if we've crossed the drag threshold
  if not dragState.thresholdCrossed then
    local totalDx = x - dragState.startX
    local totalDy = y - dragState.startY
    local distance = math.sqrt(totalDx * totalDx + totalDy * totalDy)

    if distance >= DRAG_THRESHOLD then
      dragState.thresholdCrossed = true

      -- Fire dragstart event
      eventsOut[#eventsOut + 1] = Events.createDragEvent(
        "dragstart",
        dragState.targetId,
        x,
        y,
        dx,
        dy,
        dragState.startX,
        dragState.startY
      )

      -- Immediately fire drag event with current position
      eventsOut[#eventsOut + 1] = Events.createDragEvent(
        "drag",
        dragState.targetId,
        x,
        y,
        dx,
        dy,
        dragState.startX,
        dragState.startY
      )

      dragState.lastX = x
      dragState.lastY = y
    end
  else
    -- Threshold already crossed, continue firing drag events
    eventsOut[#eventsOut + 1] = Events.createDragEvent(
      "drag",
      dragState.targetId,
      x,
      y,
      dx,
      dy,
      dragState.startX,
      dragState.startY
    )

    dragState.lastX = x
    dragState.lastY = y
  end

  return eventsOut
end

--- End drag tracking.
--- Returns a dragend event if the threshold was crossed, nil otherwise.
function Events.endDrag(x, y)
  if not dragState.active then return nil end

  local event = nil
  if dragState.thresholdCrossed then
    local dx = x - dragState.lastX
    local dy = y - dragState.lastY

    event = Events.createDragEvent(
      "dragend",
      dragState.targetId,
      x,
      y,
      dx,
      dy,
      dragState.startX,
      dragState.startY
    )
  end

  -- Reset drag state
  dragState.active = false
  dragState.targetId = nil
  dragState.thresholdCrossed = false

  return event
end

--- Cancel an active drag without emitting any events.
--- Used when text selection takes over from a normal drag.
function Events.cancelDrag()
  dragState.active = false
  dragState.targetId = nil
  dragState.thresholdCrossed = false
end

--- Check if a drag is currently active.
function Events.isDragging()
  return dragState.active
end

--- Check if the drag threshold has been crossed.
function Events.isDragThresholdCrossed()
  return dragState.thresholdCrossed
end

return Events
