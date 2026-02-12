--[[
  inspector.lua -- Visual debug overlay for react-love

  Self-contained module using raw Love2D drawing calls (like errors.lua).
  Does not touch the React tree/layout/painter pipeline. Zero impact when
  disabled (one boolean check per frame per hook).

  Usage:
    local inspector = require("lua.inspector")
    -- In love.keypressed:  if inspector.keypressed(key) then return end
    -- In love.mousepressed: if inspector.mousepressed(x, y, btn) then return end
    -- In love.mousemoved:   inspector.mousemoved(x, y)
    -- In love.update:       inspector.update(dt)
    -- In love.draw (after paint): inspector.draw(root)

  Controls:
    F12   -- Toggle inspector on/off
    Tab   -- Toggle tree panel sidebar
    `     -- Toggle console (requires console.lua)
]]

local ZIndex = require("lua.zindex")
local console = nil  -- lazy-loaded to avoid circular deps

local Inspector = {}

-- ============================================================================
-- State
-- ============================================================================

local state = {
  enabled    = false,
  treePanel  = false,     -- sidebar visible?
  hoveredNode = nil,       -- node under cursor (deep hit test)
  selectedNode = nil,      -- clicked/locked node for detail panel
  mouseX     = 0,
  mouseY     = 0,
  -- Performance
  fps        = 0,
  fpsTimer   = 0,
  fpsFrames  = 0,
  layoutMs   = 0,
  paintMs    = 0,
  nodeCount  = 0,
  nodeCountDirty = true,  -- recalc on next draw
  -- Hit test cache
  lastHitX   = -1,
  lastHitY   = -1,
  -- Layout/paint timing
  layoutStart = 0,
  paintStart  = 0,
  -- Tree panel scroll
  treeScrollY = 0,
  -- Detail panel scroll
  detailScrollY = 0,
  -- Collapsed nodes in tree panel (id -> true)
  collapsed  = {},
  -- Cached tree node positions for click detection
  treeNodePositions = {},  -- array of { node, y, lineH }
}

-- ============================================================================
-- Colors (RGBA 0-1)
-- ============================================================================

local MARGIN_COLOR  = { 0.961, 0.620, 0.043, 0.25 }  -- #f59e0b
local PADDING_COLOR = { 0.133, 0.773, 0.369, 0.25 }   -- #22c55e
local CONTENT_COLOR = { 0.235, 0.522, 0.969, 0.25 }   -- #3b82f6
local BORDER_COLOR  = { 0.961, 0.620, 0.043, 0.8 }    -- outline

local TOOLTIP_BG    = { 0.07, 0.07, 0.12, 0.92 }
local TOOLTIP_BORDER = { 0.25, 0.25, 0.35, 0.8 }
local TOOLTIP_TEXT   = { 0.88, 0.90, 0.94, 1 }
local TOOLTIP_DIM    = { 0.55, 0.58, 0.65, 1 }
local TOOLTIP_ACCENT = { 0.38, 0.65, 0.98, 1 }

local TREE_BG       = { 0.05, 0.05, 0.10, 0.88 }
local TREE_HOVER    = { 0.20, 0.25, 0.40, 0.5 }
local TREE_SELECT   = { 0.25, 0.35, 0.55, 0.6 }
local TREE_TEXT     = { 0.78, 0.80, 0.84, 1 }
local TREE_DIM      = { 0.45, 0.48, 0.55, 1 }
local TREE_ACCENT   = { 0.38, 0.65, 0.98, 1 }

local PERF_BG       = { 0.05, 0.05, 0.10, 0.8 }
local PERF_TEXT     = { 0.78, 0.80, 0.84, 1 }
local PERF_GOOD     = { 0.30, 0.80, 0.40, 1 }
local PERF_WARN     = { 0.95, 0.75, 0.20, 1 }

local DETAIL_BG     = { 0.05, 0.05, 0.10, 0.92 }

local TREE_WIDTH = 280
local DETAIL_WIDTH = 300

-- Cached fonts (created lazily on first draw, avoids allocation per frame)
local fontSmall = nil   -- 11px, used by tooltip/tree/detail/perf
local function getFont()
  if not fontSmall then fontSmall = love.graphics.newFont(11) end
  return fontSmall
end

-- ============================================================================
-- Deep hit test (returns ANY node under cursor, not just hasHandlers)
-- ============================================================================

local function deepHitTest(node, mx, my)
  if not node or not node.computed then return nil end
  local s = node.style or {}
  local c = node.computed

  if s.display == "none" then return nil end

  if mx < c.x or mx > c.x + c.w or my < c.y or my > c.y + c.h then
    return nil
  end

  -- Adjust for scroll containers
  local childMx, childMy = mx, my
  if s.overflow == "scroll" and node.scrollState then
    childMx = mx + (node.scrollState.scrollX or 0)
    childMy = my + (node.scrollState.scrollY or 0)
  end

  -- Walk children in reverse paint order (topmost first)
  local children = node.children or {}
  local paintOrder = ZIndex.getSortedChildren(children)
  for i = #paintOrder, 1, -1 do
    local hit = deepHitTest(paintOrder[i], childMx, childMy)
    if hit then return hit end
  end

  -- Return this node (no hasHandlers check)
  return node
end

-- ============================================================================
-- Node counting
-- ============================================================================

local function countNodes(node)
  if not node then return 0 end
  local count = 1
  for _, child in ipairs(node.children or {}) do
    count = count + countNodes(child)
  end
  return count
end

-- ============================================================================
-- Style helpers
-- ============================================================================

local function getMargins(s)
  local mt = s.marginTop or s.margin or 0
  local mr = s.marginRight or s.margin or 0
  local mb = s.marginBottom or s.margin or 0
  local ml = s.marginLeft or s.margin or 0
  return mt, mr, mb, ml
end

local function getPadding(s)
  local pt = s.paddingTop or s.padding or 0
  local pr = s.paddingRight or s.padding or 0
  local pb = s.paddingBottom or s.padding or 0
  local pl = s.paddingLeft or s.padding or 0
  return pt, pr, pb, pl
end

local function getBorderWidths(s)
  local bt = s.borderTopWidth or s.borderWidth or 0
  local br = s.borderRightWidth or s.borderWidth or 0
  local bb = s.borderBottomWidth or s.borderWidth or 0
  local bl = s.borderLeftWidth or s.borderWidth or 0
  return bt, br, bb, bl
end

-- Format a value for display (truncate long strings)
local function fmtVal(v)
  if type(v) == "string" then
    if #v > 24 then return '"' .. v:sub(1, 21) .. '..."' end
    return '"' .. v .. '"'
  elseif type(v) == "number" then
    if v == math.floor(v) then return tostring(v) end
    return string.format("%.1f", v)
  elseif type(v) == "boolean" then
    return tostring(v)
  elseif type(v) == "table" then
    return "{...}"
  end
  return tostring(v)
end

-- ============================================================================
-- Public API: Timing wrappers
-- ============================================================================

function Inspector.isEnabled()
  return state.enabled
end

function Inspector.beginLayout()
  if not state.enabled then return end
  state.layoutStart = love.timer.getTime()
  state.nodeCountDirty = true  -- tree changed, recount after layout
end

function Inspector.endLayout()
  if not state.enabled then return end
  state.layoutMs = (love.timer.getTime() - state.layoutStart) * 1000
  -- Invalidate hit test cache since node positions may have changed
  state.lastHitX = -1
  state.lastHitY = -1
end

function Inspector.beginPaint()
  if not state.enabled then return end
  state.paintStart = love.timer.getTime()
end

function Inspector.endPaint()
  if not state.enabled then return end
  state.paintMs = (love.timer.getTime() - state.paintStart) * 1000
end

--- Mark node count as stale (call after tree mutations)
function Inspector.markDirty()
  state.nodeCountDirty = true
end

--- Return performance data (used by console :perf command)
function Inspector.getPerfData()
  return {
    fps = state.fps,
    layoutMs = state.layoutMs,
    paintMs = state.paintMs,
    nodeCount = state.nodeCount,
  }
end

-- ============================================================================
-- Public API: Update
-- ============================================================================

function Inspector.update(dt)
  if not state.enabled then return end

  -- FPS counter (sampled every 0.5s)
  state.fpsFrames = state.fpsFrames + 1
  state.fpsTimer = state.fpsTimer + dt
  if state.fpsTimer >= 0.5 then
    state.fps = math.floor(state.fpsFrames / state.fpsTimer + 0.5)
    state.fpsFrames = 0
    state.fpsTimer = 0
  end
end

-- ============================================================================
-- Public API: Input handling
-- ============================================================================

--- Handle keypress. Returns true if consumed.
function Inspector.keypressed(key)
  if key == "f12" then
    state.enabled = not state.enabled
    if not state.enabled then
      state.hoveredNode = nil
      state.selectedNode = nil
      state.treePanel = false
      -- Close console when inspector closes
      if console and console.isVisible() then
        console.hide()
      end
    end
    return true
  end

  if not state.enabled then return false end

  -- Console toggle (backtick)
  if key == "`" then
    if console then
      console.toggle()
    end
    return true
  end

  -- Route to console first when it's open
  if console and console.isVisible() then
    return console.keypressed(key)
  end

  if key == "tab" then
    state.treePanel = not state.treePanel
    state.treeScrollY = 0
    return true
  end

  -- Escape clears selection
  if key == "escape" then
    if state.selectedNode then
      state.selectedNode = nil
      state.detailScrollY = 0
      return true
    end
  end

  return false
end

--- Handle text input. Returns true if consumed.
function Inspector.textinput(text)
  if not state.enabled then return false end

  -- Route to console
  if console and console.isVisible() then
    return console.textinput(text)
  end

  return false
end

--- Handle mouse press. Returns true if consumed.
function Inspector.mousepressed(x, y, button)
  if not state.enabled then return false end

  -- Console gets priority
  if console and console.isVisible() then
    -- Check if click is in console area
    local screenH = love.graphics.getHeight()
    local consoleH = math.max(200, math.floor(screenH * 0.4))
    local consoleY = screenH - consoleH
    if y >= consoleY then
      return true  -- consumed by console
    end
  end

  -- Detail panel click (right side)
  if state.selectedNode then
    local screenW = love.graphics.getWidth()
    if x > screenW - DETAIL_WIDTH then
      return true  -- consumed by detail panel
    end
  end

  -- Tree panel click: select node or toggle collapse
  if state.treePanel and x < TREE_WIDTH then
    -- Find which node was clicked using cached positions
    for _, entry in ipairs(state.treeNodePositions) do
      if y >= entry.y and y < entry.y + entry.lineH then
        -- Check if click is on the collapse indicator (the ">" / "v" zone)
        local hasChildren = entry.node.children and #entry.node.children > 0
        local collapseX = 8 + (entry.depth or 0) * 12 - 10
        if hasChildren and x >= collapseX - 4 and x <= collapseX + 12 then
          -- Toggle collapse
          local nid = entry.node.id
          state.collapsed[nid] = not state.collapsed[nid]
        else
          -- Select / deselect node
          if state.selectedNode == entry.node then
            state.selectedNode = nil
            state.detailScrollY = 0
          else
            state.selectedNode = entry.node
            state.detailScrollY = 0
          end
        end
        return true
      end
    end
    return true  -- consumed by tree panel even if no node hit
  end

  -- Clicking in viewport: select hovered node
  if state.hoveredNode then
    if state.selectedNode == state.hoveredNode then
      state.selectedNode = nil
      state.detailScrollY = 0
    else
      state.selectedNode = state.hoveredNode
      state.detailScrollY = 0
      state.scrollToSelected = true  -- tree panel will auto-scroll on next draw
    end
    return true
  end

  return false
end

--- Handle mouse movement (does not consume — hover tracking always runs).
function Inspector.mousemoved(x, y)
  state.mouseX = x
  state.mouseY = y
end

--- Handle mouse wheel (scroll tree panel or detail panel).
function Inspector.wheelmoved(x, y)
  if not state.enabled then return false end

  -- Console scroll
  if console and console.isVisible() then
    return console.wheelmoved(x, y)
  end

  -- Detail panel scroll
  if state.selectedNode then
    local screenW = love.graphics.getWidth()
    if state.mouseX > screenW - DETAIL_WIDTH then
      state.detailScrollY = state.detailScrollY - y * 20
      if state.detailScrollY < 0 then state.detailScrollY = 0 end
      return true
    end
  end

  if state.treePanel and state.mouseX < TREE_WIDTH then
    state.treeScrollY = state.treeScrollY - y * 20
    if state.treeScrollY < 0 then state.treeScrollY = 0 end
    return true
  end

  return false
end

-- ============================================================================
-- Console integration
-- ============================================================================

--- Set the console module reference (called from init.lua after console is loaded)
function Inspector.setConsole(consoleModule)
  console = consoleModule
end

-- ============================================================================
-- Public API: Draw
-- ============================================================================

function Inspector.draw(root)
  if not state.enabled then return end
  if not root then return end

  local ok, drawErr = pcall(function()
    -- Update hovered node via deep hit test (skip if mouse hasn't moved)
    if state.mouseX ~= state.lastHitX or state.mouseY ~= state.lastHitY then
      state.hoveredNode = deepHitTest(root, state.mouseX, state.mouseY)
      state.lastHitX = state.mouseX
      state.lastHitY = state.mouseY
    end

    -- Recount nodes only when tree has changed
    if state.nodeCountDirty then
      state.nodeCount = countNodes(root)
      state.nodeCountDirty = false
    end

    -- Save graphics state
    love.graphics.push("all")
    love.graphics.origin()
    love.graphics.setScissor()

    -- 1. Draw hover overlay (show selected node highlight if one is locked)
    drawHoverOverlay()

    -- 2. Draw selected node highlight
    drawSelectedOverlay()

    -- 3. Draw tooltip (only when no node is selected, to reduce clutter)
    if not state.selectedNode then
      drawTooltip()
    end

    -- 4. Draw tree panel
    if state.treePanel then
      drawTreePanel(root)

      -- Override hoveredNode when mouse is over tree panel rows
      if state.mouseX < TREE_WIDTH then
        state.hoveredNode = nil
        for _, entry in ipairs(state.treeNodePositions) do
          if state.mouseY >= entry.y and state.mouseY < entry.y + entry.lineH then
            state.hoveredNode = entry.node
            break
          end
        end
      end
    end

    -- 5. Draw detail panel (when node is selected)
    if state.selectedNode then
      drawDetailPanel()
    end

    -- 6. Draw performance bar (always on top)
    drawPerfBar()

    -- Restore graphics state
    love.graphics.pop()
  end)

  if not ok then
    pcall(function()
      io.write("[inspector] Draw error: " .. tostring(drawErr) .. "\n")
      io.flush()
    end)
  end

  -- Draw console on top of inspector (but before errors)
  if console then
    console.draw()
  end
end

-- ============================================================================
-- Drawing: Hover overlay
-- ============================================================================

function drawHoverOverlay()
  local node = state.hoveredNode
  if not node or not node.computed then return end
  -- Don't draw hover overlay if this node is already selected
  if node == state.selectedNode then return end

  local s = node.style or {}
  local c = node.computed

  local mt, mr, mb, ml = getMargins(s)
  local pt, pr, pb, pl = getPadding(s)
  local bt, br, bb, bl = getBorderWidths(s)

  -- Margin area (orange)
  if mt > 0 or mr > 0 or mb > 0 or ml > 0 then
    love.graphics.setColor(MARGIN_COLOR)
    -- Top margin
    if mt > 0 then love.graphics.rectangle("fill", c.x - ml, c.y - mt, c.w + ml + mr, mt) end
    -- Bottom margin
    if mb > 0 then love.graphics.rectangle("fill", c.x - ml, c.y + c.h, c.w + ml + mr, mb) end
    -- Left margin
    if ml > 0 then love.graphics.rectangle("fill", c.x - ml, c.y, ml, c.h) end
    -- Right margin
    if mr > 0 then love.graphics.rectangle("fill", c.x + c.w, c.y, mr, c.h) end
  end

  -- Padding area (green) — the area between border and content
  local innerX = c.x + bl
  local innerY = c.y + bt
  local innerW = c.w - bl - br
  local innerH = c.h - bt - bb

  if pt > 0 or pr > 0 or pb > 0 or pl > 0 then
    love.graphics.setColor(PADDING_COLOR)
    -- Top padding
    if pt > 0 then love.graphics.rectangle("fill", innerX, innerY, innerW, pt) end
    -- Bottom padding
    if pb > 0 then love.graphics.rectangle("fill", innerX, innerY + innerH - pb, innerW, pb) end
    -- Left padding
    if pl > 0 then love.graphics.rectangle("fill", innerX, innerY + pt, pl, innerH - pt - pb) end
    -- Right padding
    if pr > 0 then love.graphics.rectangle("fill", innerX + innerW - pr, innerY + pt, pr, innerH - pt - pb) end
  end

  -- Content area (blue)
  local contentX = innerX + pl
  local contentY = innerY + pt
  local contentW = math.max(0, innerW - pl - pr)
  local contentH = math.max(0, innerH - pt - pb)
  love.graphics.setColor(CONTENT_COLOR)
  love.graphics.rectangle("fill", contentX, contentY, contentW, contentH)

  -- Border outline
  love.graphics.setColor(BORDER_COLOR)
  love.graphics.setLineWidth(1)
  love.graphics.rectangle("line", c.x, c.y, c.w, c.h)
end

-- ============================================================================
-- Drawing: Selected node overlay (brighter/thicker outline)
-- ============================================================================

function drawSelectedOverlay()
  local node = state.selectedNode
  if not node or not node.computed then return end

  local c = node.computed

  -- Solid bright outline for selected node
  love.graphics.setColor(TOOLTIP_ACCENT[1], TOOLTIP_ACCENT[2], TOOLTIP_ACCENT[3], 0.8)
  love.graphics.setLineWidth(2)
  love.graphics.rectangle("line", c.x, c.y, c.w, c.h)

  -- Light fill
  love.graphics.setColor(TOOLTIP_ACCENT[1], TOOLTIP_ACCENT[2], TOOLTIP_ACCENT[3], 0.08)
  love.graphics.rectangle("fill", c.x, c.y, c.w, c.h)
end

-- ============================================================================
-- Drawing: Tooltip
-- ============================================================================

function drawTooltip()
  local node = state.hoveredNode
  if not node or not node.computed then return end

  local s = node.style or {}
  local c = node.computed

  -- Build tooltip lines
  local lines = {}
  local accents = {} -- indices that should use accent color

  -- Node type + id
  local header = (node.type or "?")
  if node.id then header = header .. "  #" .. tostring(node.id) end
  lines[#lines + 1] = header
  accents[1] = true

  -- Computed dimensions
  lines[#lines + 1] = string.format("x:%d  y:%d  w:%d  h:%d",
    math.floor(c.x), math.floor(c.y), math.floor(c.w), math.floor(c.h))

  -- Non-default style properties
  local skipProps = { display = true }
  local styleCount = 0
  if s then
    for k, v in pairs(s) do
      if not skipProps[k] and v ~= nil and v ~= "" then
        if styleCount < 8 then  -- limit tooltip size
          lines[#lines + 1] = k .. ": " .. fmtVal(v)
          styleCount = styleCount + 1
        end
      end
    end
    if styleCount >= 8 then
      lines[#lines + 1] = "... +" .. (styleCount - 8) .. " more"
    end
  end

  -- Text content
  if node.props and node.props.text then
    local text = node.props.text
    if #text > 30 then text = text:sub(1, 27) .. "..." end
    lines[#lines + 1] = 'text: "' .. text .. '"'
  end

  -- Measure tooltip size
  local font = getFont()
  local lineH = font:getHeight() + 2
  local pad = 8
  local maxW = 0
  for _, line in ipairs(lines) do
    local w = font:getWidth(line)
    if w > maxW then maxW = w end
  end
  local tooltipW = maxW + pad * 2
  local tooltipH = #lines * lineH + pad * 2

  -- Position: near cursor, flip at screen edges
  local screenW = love.graphics.getWidth()
  local screenH = love.graphics.getHeight()
  local tx = state.mouseX + 16
  local ty = state.mouseY + 16

  if tx + tooltipW > screenW - 8 then tx = state.mouseX - tooltipW - 8 end
  if ty + tooltipH > screenH - 8 then ty = state.mouseY - tooltipH - 8 end
  if tx < 4 then tx = 4 end
  if ty < 4 then ty = 4 end

  -- Draw tooltip background
  love.graphics.setColor(TOOLTIP_BG)
  love.graphics.rectangle("fill", tx, ty, tooltipW, tooltipH, 4, 4)
  love.graphics.setColor(TOOLTIP_BORDER)
  love.graphics.setLineWidth(1)
  love.graphics.rectangle("line", tx, ty, tooltipW, tooltipH, 4, 4)

  -- Draw text
  love.graphics.setFont(font)
  local textY = ty + pad
  for i, line in ipairs(lines) do
    if accents[i] then
      love.graphics.setColor(TOOLTIP_ACCENT)
    elseif i == 2 then
      love.graphics.setColor(TOOLTIP_DIM)
    else
      love.graphics.setColor(TOOLTIP_TEXT)
    end
    love.graphics.print(line, tx + pad, textY)
    textY = textY + lineH
  end
end

-- ============================================================================
-- Drawing: Tree panel sidebar
-- ============================================================================

function drawTreePanel(root)
  local screenH = love.graphics.getHeight()
  local font = getFont()
  local lineH = font:getHeight() + 4
  local pad = 8

  -- Reset position cache
  state.treeNodePositions = {}

  -- Background
  love.graphics.setColor(TREE_BG)
  love.graphics.rectangle("fill", 0, 0, TREE_WIDTH, screenH)

  -- Border
  love.graphics.setColor(TOOLTIP_BORDER)
  love.graphics.rectangle("fill", TREE_WIDTH - 1, 0, 1, screenH)

  -- Title
  love.graphics.setFont(font)
  love.graphics.setColor(TOOLTIP_ACCENT)
  love.graphics.print("Node Tree (F12 off / Tab close)", pad, pad)

  -- Scissor to tree area
  local treeY = pad + lineH + 4
  love.graphics.setScissor(0, treeY, TREE_WIDTH, screenH - treeY)

  -- Walk tree and draw lines
  local drawY = treeY - state.treeScrollY
  drawTreeNode(root, 0, drawY, font, lineH, pad, treeY, screenH)

  -- Auto-scroll to selected node (after positions are cached)
  if state.scrollToSelected and state.selectedNode then
    for _, entry in ipairs(state.treeNodePositions) do
      if entry.node == state.selectedNode then
        -- entry.y is the drawn position (includes current scroll offset)
        -- Convert to absolute position in the tree content
        local absY = entry.y + state.treeScrollY - treeY
        local visibleH = screenH - treeY
        if entry.y < treeY or entry.y + lineH > screenH then
          -- Node is outside visible area — scroll to center it
          state.treeScrollY = math.max(0, absY - visibleH / 2)
        end
        break
      end
    end
    state.scrollToSelected = false
  end

  love.graphics.setScissor()
end

-- Recursive tree node drawing — returns the next Y position
function drawTreeNode(node, depth, y, font, lineH, pad, clipTop, clipBottom)
  if not node then return y end

  local visible = y + lineH > clipTop and y < clipBottom
  local c = node.computed

  -- Cache position for click detection (depth needed for collapse indicator hit zone)
  state.treeNodePositions[#state.treeNodePositions + 1] = {
    node = node,
    y = y,
    lineH = lineH,
    depth = depth,
  }

  if visible then
    -- Highlight selected node
    if node == state.selectedNode then
      love.graphics.setColor(TREE_SELECT)
      love.graphics.rectangle("fill", 0, y, TREE_WIDTH, lineH)
    elseif node == state.hoveredNode then
      love.graphics.setColor(TREE_HOVER)
      love.graphics.rectangle("fill", 0, y, TREE_WIDTH, lineH)
    end

    -- Indentation
    local indent = pad + depth * 12
    local maxTextW = TREE_WIDTH - indent - pad

    -- Build label: type (w x h)
    local label = node.type or "?"
    if c then
      label = label .. string.format("  %dx%d", math.floor(c.w), math.floor(c.h))
    end

    -- Collapse indicator
    local hasChildren = node.children and #node.children > 0
    if hasChildren then
      local isCollapsed = state.collapsed[node.id]
      love.graphics.setColor(TREE_DIM)
      love.graphics.print(isCollapsed and ">" or "v", indent - 10, y + 1)
    end

    -- Type name in accent if selected, normal otherwise
    love.graphics.setFont(font)
    if node == state.selectedNode then
      love.graphics.setColor(TOOLTIP_ACCENT)
    elseif node == state.hoveredNode then
      love.graphics.setColor(TOOLTIP_ACCENT)
    else
      love.graphics.setColor(TREE_TEXT)
    end
    love.graphics.print(label, indent, y + 1)
  end

  y = y + lineH

  -- Draw children (unless collapsed)
  if not state.collapsed[node.id] then
    for _, child in ipairs(node.children or {}) do
      y = drawTreeNode(child, depth + 1, y, font, lineH, pad, clipTop, clipBottom)
    end
  end

  return y
end

-- ============================================================================
-- Drawing: Detail panel (right side, shows full props/style of selected node)
-- ============================================================================

function drawDetailPanel()
  local node = state.selectedNode
  if not node then return end

  local screenW = love.graphics.getWidth()
  local screenH = love.graphics.getHeight()
  local panelX = screenW - DETAIL_WIDTH
  local font = getFont()
  local lineH = font:getHeight() + 2
  local pad = 10

  -- Background
  love.graphics.setColor(DETAIL_BG)
  love.graphics.rectangle("fill", panelX, 0, DETAIL_WIDTH, screenH)

  -- Border
  love.graphics.setColor(TOOLTIP_BORDER)
  love.graphics.rectangle("fill", panelX, 0, 1, screenH)

  -- Scissor to panel
  love.graphics.setScissor(panelX, 0, DETAIL_WIDTH, screenH)
  love.graphics.setFont(font)

  local x = panelX + pad
  local y = pad - state.detailScrollY

  -- Header
  local header = (node.type or "?") .. "  #" .. tostring(node.id or "?")
  love.graphics.setColor(TOOLTIP_ACCENT)
  love.graphics.print(header, x, y)
  y = y + lineH + 4

  -- Computed layout
  local c = node.computed
  if c then
    love.graphics.setColor(TREE_DIM)
    love.graphics.print("-- layout --", x, y)
    y = y + lineH
    love.graphics.setColor(TOOLTIP_TEXT)
    love.graphics.print(string.format("x: %d", math.floor(c.x)), x, y); y = y + lineH
    love.graphics.print(string.format("y: %d", math.floor(c.y)), x, y); y = y + lineH
    love.graphics.print(string.format("w: %d", math.floor(c.w)), x, y); y = y + lineH
    love.graphics.print(string.format("h: %d", math.floor(c.h)), x, y); y = y + lineH
    y = y + 4
  end

  -- Props (excluding style)
  if node.props then
    local hasProps = false
    for k, v in pairs(node.props) do
      if k ~= "style" then
        if not hasProps then
          love.graphics.setColor(TREE_DIM)
          love.graphics.print("-- props --", x, y)
          y = y + lineH
          hasProps = true
        end
        love.graphics.setColor(TOOLTIP_TEXT)
        local val = fmtVal(v)
        love.graphics.print(k .. ": " .. val, x, y)
        y = y + lineH
      end
    end
    if hasProps then y = y + 4 end
  end

  -- Style (full dump, no truncation)
  local s = node.style
  if s then
    local hasStyle = false
    for k, v in pairs(s) do
      if v ~= nil and v ~= "" then
        if not hasStyle then
          love.graphics.setColor(TREE_DIM)
          love.graphics.print("-- style --", x, y)
          y = y + lineH
          hasStyle = true
        end
        love.graphics.setColor(TOOLTIP_TEXT)
        love.graphics.print(k .. ": " .. fmtVal(v), x, y)
        y = y + lineH
      end
    end
    if hasStyle then y = y + 4 end
  end

  -- Children summary
  local nc = node.children and #node.children or 0
  if nc > 0 then
    love.graphics.setColor(TREE_DIM)
    love.graphics.print("-- children: " .. nc .. " --", x, y)
    y = y + lineH
    for i, child in ipairs(node.children) do
      if i > 20 then
        love.graphics.setColor(TREE_DIM)
        love.graphics.print("... +" .. (nc - 20) .. " more", x, y)
        y = y + lineH
        break
      end
      local cc = child.computed
      local dims = cc and string.format("%dx%d", math.floor(cc.w), math.floor(cc.h)) or "?"
      love.graphics.setColor(TOOLTIP_TEXT)
      love.graphics.print(string.format("[%d] %s #%s  %s", i, child.type or "?", tostring(child.id), dims), x, y)
      y = y + lineH
    end
  end

  -- Handlers
  if node.hasHandlers then
    y = y + 4
    love.graphics.setColor(PERF_GOOD)
    love.graphics.print("has event handlers", x, y)
    y = y + lineH
  end

  -- Hint
  y = y + 8
  love.graphics.setColor(TREE_DIM)
  love.graphics.print("Esc to deselect", x, y)

  love.graphics.setScissor()
end

-- ============================================================================
-- Drawing: Performance bar
-- ============================================================================

function drawPerfBar()
  local font = getFont()
  local screenW = love.graphics.getWidth()
  local pad = 6
  local lineH = font:getHeight() + 2

  -- Build perf text
  local fpsColor = state.fps >= 55 and PERF_GOOD or PERF_WARN
  local items = {
    { label = "FPS", value = tostring(state.fps), color = fpsColor },
    { label = "Layout", value = string.format("%.1fms", state.layoutMs), color = PERF_TEXT },
    { label = "Paint", value = string.format("%.1fms", state.paintMs), color = PERF_TEXT },
    { label = "Nodes", value = tostring(state.nodeCount), color = PERF_TEXT },
  }

  -- Measure width
  love.graphics.setFont(font)
  local totalW = pad
  for _, item in ipairs(items) do
    totalW = totalW + font:getWidth(item.label .. ": " .. item.value) + pad * 2
  end

  local barH = lineH + pad * 2
  local barX = screenW - totalW - pad
  local barY = pad

  -- Offset if tree panel is visible
  if state.treePanel then
    barX = math.max(TREE_WIDTH + pad, barX)
  end

  -- Offset if detail panel is visible
  if state.selectedNode then
    barX = math.min(barX, screenW - DETAIL_WIDTH - totalW - pad)
  end

  -- Background
  love.graphics.setColor(PERF_BG)
  love.graphics.rectangle("fill", barX, barY, totalW, barH, 4, 4)

  -- Text
  local textX = barX + pad
  local textY = barY + pad
  for i, item in ipairs(items) do
    love.graphics.setColor(TREE_DIM)
    love.graphics.print(item.label .. ": ", textX, textY)
    textX = textX + font:getWidth(item.label .. ": ")
    love.graphics.setColor(item.color)
    love.graphics.print(item.value, textX, textY)
    textX = textX + font:getWidth(item.value) + pad * 2
  end
end

return Inspector
