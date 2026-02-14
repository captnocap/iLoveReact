--[[
  textselection.lua -- Text selection and clipboard copy for Text nodes

  Manages a global selection state (only one text selection active at a time).
  Text nodes are selectable by default unless style.userSelect == "none".

  Flow:
    1. mousepressed on a Text node → start(node, line, col)
    2. mousemoved while dragging   → update(line, col)
    3. mousereleased               → finalize() (extract text, clear if zero-length)
    4. Ctrl+C / Cmd+C              → copyToClipboard()
    5. Click outside text           → clear()

  Requires: measure.lua (injected via init)
]]

local TextSelection = {}

local Measure = nil
local Events  = nil

function TextSelection.init(config)
  config = config or {}
  Measure = config.measure
  Events  = config.events
end

-- ============================================================================
-- Global selection state (singleton — only one selection at a time)
-- ============================================================================

local selection = nil
-- {
--   node       = <node>,       -- the Text node being selected
--   startLine  = number,       -- line where drag started (1-based)
--   startCol   = number,       -- col where drag started (0-based, chars before cursor)
--   endLine    = number,       -- line where drag currently is
--   endCol     = number,       -- col where drag currently is
--   isDragging = boolean,      -- true while mouse button is held
--   text       = string|nil,   -- extracted text after finalize()
--   lines      = table,        -- cached wrapped lines for the node
-- }

-- ============================================================================
-- Helpers
-- ============================================================================

--- Check if a node allows text selection.
--- Default is selectable (true) unless userSelect == "none".
function TextSelection.isSelectable(node)
  if not node then return false end
  if node.type ~= "Text" and node.type ~= "__TEXT__" then return false end
  local s = node.style or {}
  if s.userSelect == "none" then return false end
  -- Check parent for __TEXT__ nodes
  if node.type == "__TEXT__" and node.parent then
    local ps = node.parent.style or {}
    if ps.userSelect == "none" then return false end
  end
  return true
end

--- Resolve the font for a text node (mirrors painter.lua logic).
local function getFont(node)
  local s = node.style or {}
  local fontSize = s.fontSize or 14
  local fontFamily = s.fontFamily
  local fontWeight = s.fontWeight

  -- __TEXT__ inherits from parent
  if node.type == "__TEXT__" and node.parent then
    local ps = node.parent.style or {}
    if not s.fontSize and ps.fontSize then fontSize = ps.fontSize end
    if not fontFamily then fontFamily = ps.fontFamily end
    if not fontWeight then fontWeight = ps.fontWeight end
  end

  return Measure.getFont(fontSize, fontFamily, fontWeight), fontSize
end

--- Resolve style properties for a text node.
local function resolveTextStyle(node)
  local s = node.style or {}
  local fontSize = s.fontSize or 14
  local fontFamily = s.fontFamily
  local fontWeight = s.fontWeight
  local lineHeight = s.lineHeight
  local letterSpacing = s.letterSpacing or 0

  if node.type == "__TEXT__" and node.parent then
    local ps = node.parent.style or {}
    if not s.fontSize and ps.fontSize then fontSize = ps.fontSize end
    if not fontFamily then fontFamily = ps.fontFamily end
    if not fontWeight then fontWeight = ps.fontWeight end
    if not lineHeight then lineHeight = ps.lineHeight end
    if not s.letterSpacing and ps.letterSpacing then letterSpacing = ps.letterSpacing end
  end

  return fontSize, fontFamily, fontWeight, lineHeight, letterSpacing
end

--- Resolve text content from a node (same as layout.lua's resolveTextContent).
local function resolveTextContent(node)
  if node.type == "__TEXT__" then
    return node.text or ""
  end
  if node.type == "Text" then
    -- Check children first
    if node.children then
      local parts = {}
      for _, child in ipairs(node.children) do
        if child.type == "__TEXT__" then
          parts[#parts + 1] = child.text or ""
        elseif child.type == "Text" then
          parts[#parts + 1] = resolveTextContent(child)
        end
      end
      if #parts > 0 then return table.concat(parts) end
    end
    -- Fall back to props
    local text = node.text or (node.props and node.props.children) or ""
    if type(text) == "table" then text = table.concat(text) end
    return tostring(text)
  end
  return ""
end

--- Get wrapped lines for a text node (mirrors painter.lua's getVisibleLines).
local function getWrappedLines(node)
  local fontSize, fontFamily, fontWeight, lineHeight, letterSpacing = resolveTextStyle(node)
  local font = Measure.getFont(fontSize, fontFamily, fontWeight)
  local c = node.computed
  if not c then return {}, font, fontSize, lineHeight, letterSpacing end

  local text = resolveTextContent(node)
  if text == "" then return { "" }, font, fontSize, lineHeight, letterSpacing end

  -- Normalize line endings
  text = text:gsub("\r\n", "\n"):gsub("\r", "\n")

  local maxWidth = c.w
  if maxWidth and maxWidth > 0 then
    local wrapConstraint = maxWidth
    if letterSpacing and letterSpacing ~= 0 then
      local avgCharW = font:getWidth("M")
      if avgCharW > 0 then
        local ratio = avgCharW / (avgCharW + letterSpacing)
        wrapConstraint = maxWidth * ratio
      end
    end
    local _, lines = font:getWrap(text, wrapConstraint)
    if #lines == 0 then lines = { "" } end
    return lines, font, fontSize, lineHeight, letterSpacing
  end

  return { text }, font, fontSize, lineHeight, letterSpacing
end

--- Map screen coordinates (mx, my) to (line, col) within a Text node.
--- Returns 1-based line, 0-based col (chars before cursor position).
function TextSelection.screenToPos(node, mx, my)
  if not node or not node.computed then return 1, 0 end

  local c = node.computed
  local lines, font, fontSize, lineHeight, letterSpacing = getWrappedLines(node)
  local effectiveLineH = lineHeight or font:getHeight()

  -- Account for scroll ancestors
  local sx, sy = mx, my
  if Events and Events.screenToContent then
    sx, sy = Events.screenToContent(node, mx, my)
  end

  -- Vertical: which line?
  local relY = sy - c.y
  local line = math.floor(relY / effectiveLineH) + 1
  line = math.max(1, math.min(line, #lines))

  -- Horizontal: which byte offset? (iterate by UTF-8 codepoint boundaries)
  -- Returns byte-based col so downstream sub() calls stay valid.
  local relX = sx - c.x
  local lineText = lines[line] or ""
  local col = 0  -- byte offset of the cursor position
  local bytePos = 1
  local len = #lineText

  while bytePos <= len do
    -- Determine codepoint length from lead byte
    local b = lineText:byte(bytePos)
    local cpLen = (b < 0x80 and 1) or (b < 0xE0 and 2) or (b < 0xF0 and 3) or 4
    local endByte = math.min(bytePos + cpLen - 1, len)

    local substr = lineText:sub(1, endByte)
    local w = Measure.getWidthWithSpacing(font, substr, letterSpacing)
    if w > relX then
      local prevSubstr = lineText:sub(1, bytePos - 1)
      local prevW = (bytePos > 1) and Measure.getWidthWithSpacing(font, prevSubstr, letterSpacing) or 0
      col = (relX - prevW < w - relX) and (bytePos - 1) or endByte
      break
    end
    col = endByte

    bytePos = endByte + 1
  end

  return line, col
end

-- ============================================================================
-- Selection API
-- ============================================================================

--- Begin selection on a Text node at (line, col).
function TextSelection.start(node, line, col)
  if not TextSelection.isSelectable(node) then return end
  local lines = getWrappedLines(node)
  selection = {
    node = node,
    startLine = line,
    startCol = col,
    endLine = line,
    endCol = col,
    isDragging = true,
    text = nil,
    lines = lines,
  }
end

--- Update the end position during drag.
function TextSelection.update(line, col)
  if not selection or not selection.isDragging then return end
  selection.endLine = line
  selection.endCol = col
end

--- Extract text from wrapped lines between (startLine, startCol) and (endLine, endCol).
local function extractText(lines, startLine, startCol, endLine, endCol)
  -- Normalize direction (ensure start <= end)
  if startLine > endLine or (startLine == endLine and startCol > endCol) then
    startLine, startCol, endLine, endCol = endLine, endCol, startLine, startCol
  end

  if startLine == endLine then
    local lineText = lines[startLine] or ""
    return lineText:sub(startCol + 1, endCol)
  end

  local parts = {}
  -- First line: from startCol to end
  local firstLine = lines[startLine] or ""
  parts[#parts + 1] = firstLine:sub(startCol + 1)

  -- Middle lines: full content
  for i = startLine + 1, endLine - 1 do
    parts[#parts + 1] = lines[i] or ""
  end

  -- Last line: from start to endCol
  local lastLine = lines[endLine] or ""
  parts[#parts + 1] = lastLine:sub(1, endCol)

  return table.concat(parts, "\n")
end

--- Finalize selection after mouse release. Extracts text, clears if zero-length.
function TextSelection.finalize()
  if not selection then return end
  selection.isDragging = false

  -- Re-fetch lines in case they changed
  selection.lines = getWrappedLines(selection.node)

  local text = extractText(
    selection.lines,
    selection.startLine, selection.startCol,
    selection.endLine, selection.endCol
  )

  if #text == 0 then
    selection = nil  -- Zero-length selection, clear
  else
    selection.text = text
  end
end

--- Clear the current selection.
function TextSelection.clear()
  selection = nil
end

--- Get the current selection state (or nil).
function TextSelection.get()
  return selection
end

--- Copy selected text to system clipboard.
--- Returns true if text was copied, false otherwise.
function TextSelection.copyToClipboard()
  if selection and selection.text then
    love.system.setClipboardText(selection.text)
    return true
  end
  return false
end

-- ============================================================================
-- Rendering helpers (called by painter.lua)
-- ============================================================================

--- Draw selection highlight rectangles for the given node.
--- Call this BEFORE drawing the text so text renders on top.
function TextSelection.drawHighlight(node)
  if not selection or selection.node ~= node then return end

  local c = node.computed
  if not c then return end

  local lines, font, fontSize, lineHeight, letterSpacing = getWrappedLines(node)
  local effectiveLineH = lineHeight or font:getHeight()

  -- Normalize selection range (ensure start <= end)
  local startLine, startCol, endLine, endCol
  if selection.startLine < selection.endLine or
     (selection.startLine == selection.endLine and selection.startCol <= selection.endCol) then
    startLine, startCol = selection.startLine, selection.startCol
    endLine, endCol = selection.endLine, selection.endCol
  else
    startLine, startCol = selection.endLine, selection.endCol
    endLine, endCol = selection.startLine, selection.startCol
  end

  -- Draw highlight rectangles
  love.graphics.setColor(0.22, 0.35, 0.55, 0.55)  -- Match TextEditor selection color

  for i = startLine, endLine do
    if i < 1 or i > #lines then goto continue end

    local lineText = lines[i] or ""
    local x0 = c.x
    local y0 = c.y + (i - 1) * effectiveLineH

    -- Calculate start and end x positions for this line
    local sx, ex

    if i == startLine then
      if startCol > 0 then
        sx = Measure.getWidthWithSpacing(font, lineText:sub(1, startCol), letterSpacing)
      else
        sx = 0
      end
    else
      sx = 0
    end

    if i == endLine then
      if endCol > 0 then
        ex = Measure.getWidthWithSpacing(font, lineText:sub(1, endCol), letterSpacing)
      else
        ex = 0
      end
    else
      ex = Measure.getWidthWithSpacing(font, lineText, letterSpacing)
    end

    -- Draw highlight rectangle
    if ex > sx then
      love.graphics.rectangle("fill", x0 + sx, y0, ex - sx, effectiveLineH)
    end

    ::continue::
  end
end

return TextSelection
