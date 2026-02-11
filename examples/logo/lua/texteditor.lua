--[[
  texteditor.lua -- Lua-owned document-style text editor

  This is the first "Lua-owned interaction" primitive. All editing state
  (lines, cursor, selection, scrolling) lives entirely in Lua. The JS/TS
  side only hears about boundary events: focus, blur, submit.

  State is stored on node.editorState (similar to node.scrollState for
  scroll containers).

  Requires: measure.lua for font resolution (injected via TextEditor.init)
]]

local Measure = nil
local Focus   = require("lua.focus")

local TextEditor = {}

-- ============================================================================
-- Default colors (dark editor theme)
-- ============================================================================

local colors = {
  bg         = { 0.12, 0.12, 0.14, 1 },
  gutter     = { 0.15, 0.15, 0.17, 1 },
  gutterText = { 0.45, 0.45, 0.50, 1 },
  lineNum    = { 0.55, 0.55, 0.62, 1 },
  text       = { 0.85, 0.87, 0.90, 1 },
  cursor     = { 0.90, 0.90, 0.95, 1 },
  selection  = { 0.22, 0.35, 0.55, 0.55 },
  activeLine = { 0.16, 0.16, 0.19, 1 },
  scrollbar  = { 0.30, 0.30, 0.35, 0.6 },
  placeholder= { 0.45, 0.45, 0.50, 1 },
}

-- ============================================================================
-- Init
-- ============================================================================

function TextEditor.init(config)
  config = config or {}
  Measure = config.measure
end

-- ============================================================================
-- State management
-- ============================================================================

--- Parse a string into an array of lines.
local function textToLines(text)
  if not text or text == "" then return { "" } end
  local lines = {}
  for line in (text .. "\n"):gmatch("([^\n]*)\n") do
    lines[#lines + 1] = line
  end
  if #lines == 0 then lines[1] = "" end
  return lines
end

--- Join lines back into a single string.
local function linesToText(lines)
  return table.concat(lines, "\n")
end

--- Initialize or reset editor state on a node.
function TextEditor.initState(node)
  local props = node.props or {}
  local initialText = props.initialValue or props.value or ""
  node.editorState = {
    lines = textToLines(initialText),
    cursorLine = 1,
    cursorCol = 0,
    scrollY = 0,
    scrollX = 0,
    selectStart = nil,
    selectEnd = nil,
    blinkTimer = 0,
    blinkOn = true,
    isDragging = false,
    lastValue = initialText,  -- track for controlled value changes
  }
end

--- Ensure editorState exists on the node.
local function ensureState(node)
  if not node.editorState then
    TextEditor.initState(node)
  end
  return node.editorState
end

--- Get the font for this editor node.
local function getFont(node)
  if not Measure then return love.graphics.getFont() end
  local s = node.style or {}
  local fontSize = s.fontSize or 14
  local fontFamily = s.fontFamily or nil
  local fontWeight = s.fontWeight or nil
  return Measure.getFont(fontSize, fontFamily, fontWeight)
end

--- Get line height for this editor.
local function getLineHeight(node)
  local font = getFont(node)
  return math.floor(font:getHeight() * 1.55)
end

--- Whether line numbers are shown.
local function showLineNumbers(node)
  local props = node.props or {}
  if props.lineNumbers == false then return false end
  return true -- default on
end

--- Whether the editor is read-only.
local function isReadOnly(node)
  local props = node.props or {}
  return props.readOnly == true
end

-- ============================================================================
-- Editor state helpers (operate on editorState)
-- ============================================================================

local function lineCount(es)
  return #es.lines
end

local function currentLine(es)
  return es.lines[es.cursorLine] or ""
end

local function clampCursor(es)
  es.cursorLine = math.max(1, math.min(es.cursorLine, lineCount(es)))
  es.cursorCol = math.max(0, math.min(es.cursorCol, #currentLine(es)))
end

local function resetBlink(es)
  es.blinkTimer = 0
  es.blinkOn = true
end

local function clearSelection(es)
  es.selectStart = nil
  es.selectEnd = nil
end

local function hasSelection(es)
  return es.selectStart ~= nil and es.selectEnd ~= nil
end

local function selectionOrdered(es)
  if not hasSelection(es) then return nil, nil end
  local s, e = es.selectStart, es.selectEnd
  if s[1] > e[1] or (s[1] == e[1] and s[2] > e[2]) then
    return e, s
  end
  return s, e
end

local function getSelectedText(es)
  local s, e = selectionOrdered(es)
  if not s then return "" end
  if s[1] == e[1] then
    return es.lines[s[1]]:sub(s[2] + 1, e[2])
  end
  local parts = { es.lines[s[1]]:sub(s[2] + 1) }
  for i = s[1] + 1, e[1] - 1 do
    parts[#parts + 1] = es.lines[i]
  end
  parts[#parts + 1] = es.lines[e[1]]:sub(1, e[2])
  return table.concat(parts, "\n")
end

local function deleteSelection(es)
  local s, e = selectionOrdered(es)
  if not s then return end
  local before = es.lines[s[1]]:sub(1, s[2])
  local after = es.lines[e[1]]:sub(e[2] + 1)
  es.lines[s[1]] = before .. after
  for _ = s[1] + 1, e[1] do
    table.remove(es.lines, s[1] + 1)
  end
  es.cursorLine = s[1]
  es.cursorCol = s[2]
  clearSelection(es)
end

local function startOrExtendSelection(es)
  if not es.selectStart then
    es.selectStart = { es.cursorLine, es.cursorCol }
  end
end

local function updateSelectionEnd(es)
  es.selectEnd = { es.cursorLine, es.cursorCol }
end

--- Compute visible area metrics relative to node's computed rect.
local function visibleArea(node, es)
  local c = node.computed or { x = 0, y = 0, w = 400, h = 300 }
  local lh = getLineHeight(node)
  local gutterW = showLineNumbers(node) and 50 or 0
  local padding = 8
  local textAreaX = c.x + gutterW
  local textAreaY = c.y
  local textAreaW = c.w - gutterW
  local textAreaH = c.h
  local firstLine = math.floor(es.scrollY / lh) + 1
  local visLines = math.ceil(textAreaH / lh) + 1
  return {
    firstLine = firstLine,
    visLines = visLines,
    textAreaX = textAreaX,
    textAreaY = textAreaY,
    textAreaW = textAreaW,
    textAreaH = textAreaH,
    gutterW = gutterW,
    padding = padding,
    lineHeight = lh,
    nodeX = c.x,
    nodeY = c.y,
    nodeW = c.w,
    nodeH = c.h,
  }
end

local function ensureCursorVisible(node, es)
  local va = visibleArea(node, es)
  local font = getFont(node)
  local cursorY = (es.cursorLine - 1) * va.lineHeight

  if cursorY < es.scrollY then
    es.scrollY = cursorY
  elseif cursorY + va.lineHeight > es.scrollY + va.textAreaH then
    es.scrollY = cursorY + va.lineHeight - va.textAreaH
  end

  local cursorX = font:getWidth(currentLine(es):sub(1, es.cursorCol))
  local textW = va.textAreaW - va.padding * 2
  if cursorX - es.scrollX > textW - 20 then
    es.scrollX = cursorX - textW + 40
  elseif cursorX - es.scrollX < 0 then
    es.scrollX = math.max(0, cursorX - 20)
  end
end

--- Convert screen coordinates to line/col within the editor.
local function screenToPos(node, es, mx, my)
  local va = visibleArea(node, es)
  local font = getFont(node)

  local line = math.floor((my - va.textAreaY + es.scrollY) / va.lineHeight) + 1
  line = math.max(1, math.min(line, lineCount(es)))

  local textX = mx - va.textAreaX - va.padding + es.scrollX
  local col = 0
  local lineStr = es.lines[line] or ""
  for i = 1, #lineStr do
    local w = font:getWidth(lineStr:sub(1, i))
    if w > textX then
      local prevW = font:getWidth(lineStr:sub(1, i - 1))
      col = (textX - prevW < w - textX) and (i - 1) or i
      break
    end
    col = i
  end
  return line, col
end

-- ============================================================================
-- Public API: get value
-- ============================================================================

function TextEditor.getValue(node)
  local es = ensureState(node)
  return linesToText(es.lines)
end

-- ============================================================================
-- Public API: update (call each frame for blink timer)
-- ============================================================================

function TextEditor.update(node, dt)
  local es = ensureState(node)
  if not Focus.isFocused(node) then return end
  es.blinkTimer = es.blinkTimer + dt
  if es.blinkTimer >= 0.53 then
    es.blinkTimer = es.blinkTimer - 0.53
    es.blinkOn = not es.blinkOn
  end
end

-- ============================================================================
-- Public API: check for controlled value changes from JS
-- ============================================================================

function TextEditor.syncValue(node)
  local es = ensureState(node)
  local props = node.props or {}
  if props.value ~= nil and props.value ~= es.lastValue then
    es.lines = textToLines(props.value)
    es.lastValue = props.value
    clampCursor(es)
  end
end

-- ============================================================================
-- Public API: blur
-- ============================================================================

function TextEditor.blur(node)
  local es = ensureState(node)
  es.blinkOn = false
  es.isDragging = false
  clearSelection(es)
  return linesToText(es.lines)
end

-- ============================================================================
-- Input handlers
-- ============================================================================

function TextEditor.handleKeyPressed(node, key, scancode, isRepeat)
  local es = ensureState(node)
  if isReadOnly(node) and key ~= "escape" then
    -- Allow escape in read-only mode (for blur), block everything else
    if key ~= "escape" then return false end
  end

  local ctrl = love.keyboard.isDown("lctrl", "rctrl")
  local shift = love.keyboard.isDown("lshift", "rshift")

  -- Ctrl combos
  if ctrl then
    if key == "a" then
      es.selectStart = { 1, 0 }
      es.cursorLine = lineCount(es)
      es.cursorCol = #es.lines[lineCount(es)]
      es.selectEnd = { es.cursorLine, es.cursorCol }
      resetBlink(es)
      return true
    elseif key == "c" then
      if hasSelection(es) then
        love.system.setClipboardText(getSelectedText(es))
      end
      return true
    elseif key == "x" then
      if not isReadOnly(node) and hasSelection(es) then
        love.system.setClipboardText(getSelectedText(es))
        deleteSelection(es)
        resetBlink(es)
      end
      return true
    elseif key == "v" then
      if isReadOnly(node) then return true end
      local text = love.system.getClipboardText() or ""
      if text ~= "" then
        if hasSelection(es) then deleteSelection(es) end
        local before = currentLine(es):sub(1, es.cursorCol)
        local after = currentLine(es):sub(es.cursorCol + 1)
        local pasteLines = {}
        for line in (text .. "\n"):gmatch("([^\n]*)\n") do
          pasteLines[#pasteLines + 1] = line
        end
        if #pasteLines == 1 then
          es.lines[es.cursorLine] = before .. pasteLines[1] .. after
          es.cursorCol = #before + #pasteLines[1]
        else
          es.lines[es.cursorLine] = before .. pasteLines[1]
          for i = 2, #pasteLines - 1 do
            table.insert(es.lines, es.cursorLine + i - 1, pasteLines[i])
          end
          local lastIdx = es.cursorLine + #pasteLines - 1
          table.insert(es.lines, lastIdx, pasteLines[#pasteLines] .. after)
          es.cursorLine = lastIdx
          es.cursorCol = #pasteLines[#pasteLines]
        end
        clearSelection(es)
        resetBlink(es)
        ensureCursorVisible(node, es)
      end
      return true
    elseif key == "return" then
      -- Ctrl+Enter = submit
      return "submit"
    end
  end

  -- Escape = blur
  if key == "escape" then
    return "blur"
  end

  -- Movement
  if key == "left" then
    if shift then startOrExtendSelection(es) end
    if not shift and hasSelection(es) then
      local s = selectionOrdered(es)
      es.cursorLine, es.cursorCol = s[1], s[2]
      clearSelection(es)
    elseif es.cursorCol > 0 then
      es.cursorCol = es.cursorCol - 1
    elseif es.cursorLine > 1 then
      es.cursorLine = es.cursorLine - 1
      es.cursorCol = #currentLine(es)
    end
    if shift then updateSelectionEnd(es) end
    clampCursor(es); resetBlink(es); ensureCursorVisible(node, es)
    return true
  elseif key == "right" then
    if shift then startOrExtendSelection(es) end
    if not shift and hasSelection(es) then
      local _, e = selectionOrdered(es)
      es.cursorLine, es.cursorCol = e[1], e[2]
      clearSelection(es)
    elseif es.cursorCol < #currentLine(es) then
      es.cursorCol = es.cursorCol + 1
    elseif es.cursorLine < lineCount(es) then
      es.cursorLine = es.cursorLine + 1
      es.cursorCol = 0
    end
    if shift then updateSelectionEnd(es) end
    clampCursor(es); resetBlink(es); ensureCursorVisible(node, es)
    return true
  elseif key == "up" then
    if shift then startOrExtendSelection(es) end
    if not shift then clearSelection(es) end
    if es.cursorLine > 1 then
      es.cursorLine = es.cursorLine - 1
    end
    if shift then updateSelectionEnd(es) end
    clampCursor(es); resetBlink(es); ensureCursorVisible(node, es)
    return true
  elseif key == "down" then
    if shift then startOrExtendSelection(es) end
    if not shift then clearSelection(es) end
    if es.cursorLine < lineCount(es) then
      es.cursorLine = es.cursorLine + 1
    end
    if shift then updateSelectionEnd(es) end
    clampCursor(es); resetBlink(es); ensureCursorVisible(node, es)
    return true
  elseif key == "home" then
    if shift then startOrExtendSelection(es) end
    if not shift then clearSelection(es) end
    es.cursorCol = 0
    if shift then updateSelectionEnd(es) end
    resetBlink(es); ensureCursorVisible(node, es)
    return true
  elseif key == "end" then
    if shift then startOrExtendSelection(es) end
    if not shift then clearSelection(es) end
    es.cursorCol = #currentLine(es)
    if shift then updateSelectionEnd(es) end
    resetBlink(es); ensureCursorVisible(node, es)
    return true
  elseif key == "pageup" then
    if shift then startOrExtendSelection(es) end
    if not shift then clearSelection(es) end
    local va = visibleArea(node, es)
    es.cursorLine = math.max(1, es.cursorLine - va.visLines)
    if shift then updateSelectionEnd(es) end
    clampCursor(es); resetBlink(es); ensureCursorVisible(node, es)
    return true
  elseif key == "pagedown" then
    if shift then startOrExtendSelection(es) end
    if not shift then clearSelection(es) end
    local va = visibleArea(node, es)
    es.cursorLine = math.min(lineCount(es), es.cursorLine + va.visLines)
    if shift then updateSelectionEnd(es) end
    clampCursor(es); resetBlink(es); ensureCursorVisible(node, es)
    return true
  end

  -- Editing keys
  if isReadOnly(node) then return true end

  if key == "backspace" then
    if hasSelection(es) then
      deleteSelection(es)
    elseif es.cursorCol > 0 then
      local line = currentLine(es)
      es.lines[es.cursorLine] = line:sub(1, es.cursorCol - 1) .. line:sub(es.cursorCol + 1)
      es.cursorCol = es.cursorCol - 1
    elseif es.cursorLine > 1 then
      local prev = es.lines[es.cursorLine - 1]
      es.cursorCol = #prev
      es.lines[es.cursorLine - 1] = prev .. currentLine(es)
      table.remove(es.lines, es.cursorLine)
      es.cursorLine = es.cursorLine - 1
    end
    resetBlink(es); ensureCursorVisible(node, es)
    return true
  elseif key == "delete" then
    if hasSelection(es) then
      deleteSelection(es)
    elseif es.cursorCol < #currentLine(es) then
      local line = currentLine(es)
      es.lines[es.cursorLine] = line:sub(1, es.cursorCol) .. line:sub(es.cursorCol + 2)
    elseif es.cursorLine < lineCount(es) then
      es.lines[es.cursorLine] = currentLine(es) .. es.lines[es.cursorLine + 1]
      table.remove(es.lines, es.cursorLine + 1)
    end
    resetBlink(es); ensureCursorVisible(node, es)
    return true
  elseif key == "return" then
    if hasSelection(es) then deleteSelection(es) end
    local line = currentLine(es)
    local before = line:sub(1, es.cursorCol)
    local after = line:sub(es.cursorCol + 1)
    local indent = before:match("^(%s*)") or ""
    es.lines[es.cursorLine] = before
    table.insert(es.lines, es.cursorLine + 1, indent .. after)
    es.cursorLine = es.cursorLine + 1
    es.cursorCol = #indent
    resetBlink(es); ensureCursorVisible(node, es)
    return true
  elseif key == "tab" then
    if hasSelection(es) then deleteSelection(es) end
    local line = currentLine(es)
    local spaces = "    "
    es.lines[es.cursorLine] = line:sub(1, es.cursorCol) .. spaces .. line:sub(es.cursorCol + 1)
    es.cursorCol = es.cursorCol + #spaces
    resetBlink(es); ensureCursorVisible(node, es)
    return true
  end

  return true  -- consume all keys while focused
end

function TextEditor.handleTextInput(node, text)
  if isReadOnly(node) then return end
  local es = ensureState(node)
  if love.keyboard.isDown("lctrl", "rctrl") then return end
  if hasSelection(es) then deleteSelection(es) end
  local line = currentLine(es)
  es.lines[es.cursorLine] = line:sub(1, es.cursorCol) .. text .. line:sub(es.cursorCol + 1)
  es.cursorCol = es.cursorCol + #text
  resetBlink(es)
  ensureCursorVisible(node, es)
end

function TextEditor.handleMousePressed(node, mx, my, button)
  if button ~= 1 then return false end
  local es = ensureState(node)
  local va = visibleArea(node, es)

  -- Check if click is within the editor bounds
  if mx < va.nodeX or mx > va.nodeX + va.nodeW or
     my < va.nodeY or my > va.nodeY + va.nodeH then
    return false
  end

  local line, col = screenToPos(node, es, mx, my)
  es.cursorLine = line
  es.cursorCol = col
  clampCursor(es)
  resetBlink(es)

  if love.keyboard.isDown("lshift", "rshift") then
    if not es.selectStart then
      es.selectStart = { line, col }
    end
    updateSelectionEnd(es)
  else
    clearSelection(es)
    es.selectStart = { es.cursorLine, es.cursorCol }
    es.isDragging = true
  end

  return true
end

function TextEditor.handleMouseMoved(node, mx, my)
  local es = ensureState(node)
  if not es.isDragging then return false end

  local line, col = screenToPos(node, es, mx, my)
  es.cursorLine = line
  es.cursorCol = col
  clampCursor(es)
  es.selectEnd = { es.cursorLine, es.cursorCol }
  resetBlink(es)
  return true
end

function TextEditor.handleMouseReleased(node)
  local es = ensureState(node)
  if not es.isDragging then return false end
  es.isDragging = false
  if hasSelection(es) then
    local s, e = selectionOrdered(es)
    if s[1] == e[1] and s[2] == e[2] then
      clearSelection(es)
    end
  end
  return true
end

function TextEditor.handleWheel(node, dx, dy)
  local es = ensureState(node)
  local va = visibleArea(node, es)
  es.scrollY = es.scrollY - dy * va.lineHeight * 3
  local maxScroll = math.max(0, lineCount(es) * va.lineHeight - va.textAreaH + va.lineHeight)
  es.scrollY = math.max(0, math.min(es.scrollY, maxScroll))
  return true
end

-- ============================================================================
-- Drawing
-- ============================================================================

local function setColorWithOpacity(c, opacity)
  love.graphics.setColor(c[1], c[2], c[3], (c[4] or 1) * opacity)
end

function TextEditor.draw(node, effectiveOpacity)
  local es = ensureState(node)
  local c = node.computed
  if not c then return end

  effectiveOpacity = effectiveOpacity or 1
  local font = getFont(node)
  local isFocused = Focus.isFocused(node)
  local va = visibleArea(node, es)
  local lh = va.lineHeight

  -- Sync controlled value
  TextEditor.syncValue(node)

  love.graphics.setFont(font)

  -- Background
  local bgColor = colors.bg
  local s = node.style or {}
  if s.backgroundColor then
    -- Use node's background color if set
    if type(s.backgroundColor) == "table" then
      bgColor = s.backgroundColor
    end
  end
  setColorWithOpacity(bgColor, effectiveOpacity)
  local br = s.borderRadius or 0
  love.graphics.rectangle("fill", c.x, c.y, c.w, c.h, br, br)

  -- Scissor to node bounds
  love.graphics.setScissor(c.x, c.y, c.w, c.h)

  -- Gutter
  if va.gutterW > 0 then
    setColorWithOpacity(colors.gutter, effectiveOpacity)
    love.graphics.rectangle("fill", c.x, c.y, va.gutterW, c.h)
  end

  local lastLine = math.min(va.firstLine + va.visLines, lineCount(es))

  for i = va.firstLine, lastLine do
    local y = va.textAreaY + (i - 1) * lh - es.scrollY
    local lineStr = es.lines[i] or ""

    -- Active line highlight
    if isFocused and i == es.cursorLine then
      setColorWithOpacity(colors.activeLine, effectiveOpacity)
      love.graphics.rectangle("fill", va.textAreaX, y, va.textAreaW, lh)
    end

    -- Selection highlight
    if isFocused and hasSelection(es) then
      local selS, selE = selectionOrdered(es)
      if i >= selS[1] and i <= selE[1] then
        local sx, ex
        if i == selS[1] then
          sx = font:getWidth(lineStr:sub(1, selS[2]))
        else
          sx = 0
        end
        if i == selE[1] then
          ex = font:getWidth(lineStr:sub(1, selE[2]))
        else
          ex = font:getWidth(lineStr) + font:getWidth("m")
        end
        setColorWithOpacity(colors.selection, effectiveOpacity)
        love.graphics.rectangle("fill",
          va.textAreaX + va.padding + sx - es.scrollX, y,
          ex - sx, lh)
      end
    end

    -- Line numbers
    if va.gutterW > 0 then
      local numColor = (isFocused and i == es.cursorLine) and colors.lineNum or colors.gutterText
      setColorWithOpacity(numColor, effectiveOpacity)
      love.graphics.printf(tostring(i), c.x + 4, y + (lh - font:getHeight()) / 2,
        va.gutterW - 12, "right")
    end

    -- Text (clip to text area, not gutter)
    love.graphics.setScissor(va.textAreaX, c.y, va.textAreaW, c.h)

    -- Resolve text color from style or default
    local textColor = colors.text
    if s.color and type(s.color) == "table" then
      textColor = s.color
    end
    setColorWithOpacity(textColor, effectiveOpacity)
    love.graphics.print(lineStr,
      va.textAreaX + va.padding - es.scrollX,
      y + (lh - font:getHeight()) / 2)

    -- Restore full-node scissor
    love.graphics.setScissor(c.x, c.y, c.w, c.h)
  end

  -- Placeholder
  if lineCount(es) == 1 and es.lines[1] == "" and not isFocused then
    local props = node.props or {}
    local ph = props.placeholder
    if ph and ph ~= "" then
      setColorWithOpacity(colors.placeholder, effectiveOpacity)
      love.graphics.print(ph,
        va.textAreaX + va.padding,
        va.textAreaY + (lh - font:getHeight()) / 2)
    end
  end

  -- Cursor
  if isFocused and es.blinkOn then
    local cy = va.textAreaY + (es.cursorLine - 1) * lh - es.scrollY
    local cx = va.textAreaX + va.padding +
      font:getWidth(currentLine(es):sub(1, es.cursorCol)) - es.scrollX
    love.graphics.setScissor(va.textAreaX, c.y, va.textAreaW, c.h)
    setColorWithOpacity(colors.cursor, effectiveOpacity)
    love.graphics.rectangle("fill", cx, cy + 3, 2, lh - 6)
    love.graphics.setScissor(c.x, c.y, c.w, c.h)
  end

  -- Scrollbar
  local totalContentH = lineCount(es) * lh
  if totalContentH > va.textAreaH then
    local ratio = va.textAreaH / totalContentH
    local barH = math.max(20, va.textAreaH * ratio)
    local barY = c.y + (es.scrollY / totalContentH) * (va.textAreaH - barH)
    setColorWithOpacity(colors.scrollbar, effectiveOpacity)
    love.graphics.rectangle("fill", c.x + c.w - 6, barY, 4, barH, 2, 2)
  end

  -- Border when focused
  if isFocused then
    love.graphics.setColor(0.27, 0.53, 0.85, 0.8 * effectiveOpacity)
    love.graphics.setLineWidth(1.5)
    love.graphics.rectangle("line", c.x, c.y, c.w, c.h, br, br)
  end

  love.graphics.setScissor()
end

return TextEditor
