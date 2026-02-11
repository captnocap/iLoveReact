--[[
  zindex.lua -- Shared zIndex sorting for paint order and hit testing

  Provides a stable sort of children by zIndex. Children without a zIndex
  default to 0. Children with the same zIndex preserve their tree order.

  Used by painter.lua (paint in sorted order) and events.lua (hit test in
  reverse sorted order).
]]

local ZIndex = {}

-- ============================================================================
-- Stable sort (insertion sort preserves order of equal elements)
-- ============================================================================

--- Sort an array in-place using a stable insertion sort.
--- comparator(a, b) should return true if a should come before b.
local function stableSort(arr, comparator)
  for i = 2, #arr do
    local val = arr[i]
    local j = i - 1
    while j >= 1 and comparator(val, arr[j]) do
      arr[j + 1] = arr[j]
      j = j - 1
    end
    arr[j + 1] = val
  end
end

-- ============================================================================
-- Public API
-- ============================================================================

--- Get the paint-ordered list of children for a node.
--- Returns the original children table if no sorting is needed (all zIndex 0),
--- or a new sorted copy if any child has a non-zero zIndex.
--- Children with the same zIndex keep their tree order (stable sort).
--- @param children table Array of child nodes
--- @return table Array of children in paint order (low zIndex first)
function ZIndex.getSortedChildren(children)
  if not children or #children == 0 then return children end

  -- Check if any child has a non-zero zIndex (optimization: skip sort when unnecessary)
  local needsSort = false
  for _, child in ipairs(children) do
    local cs = child.style or {}
    if cs.zIndex and cs.zIndex ~= 0 then
      needsSort = true
      break
    end
  end

  if not needsSort then return children end

  -- Create a shallow copy to avoid mutating the tree's children order
  local sorted = {}
  for i, child in ipairs(children) do
    sorted[i] = child
  end

  stableSort(sorted, function(a, b)
    local za = (a.style and a.style.zIndex) or 0
    local zb = (b.style and b.style.zIndex) or 0
    return za < zb
  end)

  return sorted
end

return ZIndex
