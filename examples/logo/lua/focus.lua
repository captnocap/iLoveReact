--[[
  focus.lua -- Minimal focus manager for Lua-owned interactive primitives

  Tracks which node (if any) currently "owns" keyboard input.
  When a node has focus, keyboard and textinput events are routed to its
  handler instead of being broadcast to the JS bridge.

  This enables the "dead until alive" pattern: Lua owns the interaction
  while focused, TypeScript only hears about boundary events (focus, blur,
  submit).
]]

local Focus = {}

-- The currently focused node (or nil)
local focusedNode = nil

--- Set focus to a node. Returns the previously focused node (or nil).
--- @param node table The node to focus
--- @return table|nil The previously focused node
function Focus.set(node)
  local prev = focusedNode
  focusedNode = node
  return prev
end

--- Clear focus. Returns the previously focused node (or nil).
--- @return table|nil The previously focused node
function Focus.clear()
  local prev = focusedNode
  focusedNode = nil
  return prev
end

--- Get the currently focused node (or nil).
--- @return table|nil
function Focus.get()
  return focusedNode
end

--- Check if a specific node has focus.
--- @param node table
--- @return boolean
function Focus.isFocused(node)
  return focusedNode ~= nil and focusedNode == node
end

return Focus
