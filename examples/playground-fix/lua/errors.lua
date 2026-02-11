--[[
  errors.lua -- Error collection + visual overlay

  Stores a rolling buffer of recent errors and renders a red overlay
  on top of everything using raw Love2D calls (NOT through the react
  tree/layout/painter pipeline). This means it works even if those
  systems are broken.

  Usage:
    local errors = require("lua.errors")
    errors.push({ source = "js", message = "not a function", stack = "...", context = "event dispatch" })
    -- In love.draw():
    errors.draw()
    -- In love.mousepressed():
    errors.mousepressed(x, y)
]]

local Errors = {}

-- Rolling buffer of recent errors (max 20)
local buffer = {}
local MAX_ERRORS = 20

-- Current error index being displayed (1-based, 0 = none/dismissed)
local currentIndex = 0

-- Whether overlay is visible
local visible = false

-- Overlay height as fraction of screen
local OVERLAY_HEIGHT_FRAC = 0.4
local MIN_OVERLAY_HEIGHT = 200
local MAX_STACK_LINES = 6

-- Colors (RGBA 0-1)
local BG_COLOR      = { 0.86, 0.15, 0.15, 0.92 }  -- #dc2626
local TEXT_COLOR     = { 0.996, 0.949, 0.949, 1 }   -- #fef2f2
local SECONDARY     = { 0.988, 0.647, 0.647, 1 }    -- #fca5a5
local DIM_COLOR     = { 0.988, 0.647, 0.647, 0.7 }  -- #fca5a5 dimmed
local SHADOW_COLOR  = { 0, 0, 0, 0.4 }

--- Push a new error into the buffer and show the overlay.
--- @param err table { source, message, stack, context }
function Errors.push(err)
  local entry = {
    timestamp = os.date("%H:%M:%S"),
    source = err.source or "unknown",
    message = err.message or "unknown error",
    stack = err.stack or "",
    context = err.context or "",
  }

  -- Add to buffer (rolling)
  buffer[#buffer + 1] = entry
  if #buffer > MAX_ERRORS then
    table.remove(buffer, 1)
  end

  -- Show the latest error
  currentIndex = #buffer
  visible = true

  -- Print structured output to terminal
  Errors._printToTerminal(entry)
end

--- Print a structured error to the terminal.
function Errors._printToTerminal(entry)
  local ok, _ = pcall(function()
    io.write("\n")
    io.write("[react-love ERROR] " .. entry.timestamp .. " | " .. entry.context .. "\n")
    io.write("  " .. entry.source .. ": " .. entry.message .. "\n")
    if entry.stack and entry.stack ~= "" then
      io.write("  Stack:\n")
      local lineCount = 0
      for line in entry.stack:gmatch("[^\n]+") do
        io.write("    " .. line .. "\n")
        lineCount = lineCount + 1
        if lineCount >= 10 then
          io.write("    ... (truncated)\n")
          break
        end
      end
    end
    io.write("\n")
    io.flush()
  end)
end

--- Draw the error overlay on top of everything.
--- Call at the end of love.draw().
function Errors.draw()
  if not visible or currentIndex < 1 or currentIndex > #buffer then
    return
  end

  -- All rendering in pcall so the error system never crashes
  local ok, drawErr = pcall(function()
    local entry = buffer[currentIndex]
    if not entry then return end

    local screenW = love.graphics.getWidth()
    local screenH = love.graphics.getHeight()
    local overlayH = math.max(MIN_OVERLAY_HEIGHT, math.floor(screenH * OVERLAY_HEIGHT_FRAC))
    local overlayY = screenH - overlayH

    -- Save graphics state
    love.graphics.push("all")

    -- Reset any transforms/scissors/stencils
    love.graphics.origin()
    love.graphics.setScissor()

    -- Shadow behind overlay
    love.graphics.setColor(SHADOW_COLOR)
    love.graphics.rectangle("fill", 0, overlayY - 4, screenW, overlayH + 4)

    -- Background
    love.graphics.setColor(BG_COLOR)
    love.graphics.rectangle("fill", 0, overlayY, screenW, overlayH)

    -- Top accent line
    love.graphics.setColor(TEXT_COLOR[1], TEXT_COLOR[2], TEXT_COLOR[3], 0.3)
    love.graphics.rectangle("fill", 0, overlayY, screenW, 2)

    -- Content area
    local pad = 16
    local x = pad
    local y = overlayY + pad

    -- Use default font at reasonable size
    local titleFont = love.graphics.newFont(14)
    local bodyFont = love.graphics.newFont(12)
    local stackFont = love.graphics.newFont(11)

    -- Header line: ERROR  ·  context  timestamp
    love.graphics.setFont(titleFont)
    love.graphics.setColor(TEXT_COLOR)
    local header = "ERROR"
    if entry.context and entry.context ~= "" then
      header = header .. "  --  " .. entry.context
    end
    love.graphics.print(header, x, y)

    -- Timestamp on right
    love.graphics.setColor(DIM_COLOR)
    local tsW = titleFont:getWidth(entry.timestamp)
    love.graphics.print(entry.timestamp, screenW - pad - tsW, y)

    y = y + titleFont:getHeight() + 12

    -- Error message
    love.graphics.setFont(bodyFont)
    love.graphics.setColor(TEXT_COLOR)
    local msgPrefix = entry.source ~= "unknown" and (entry.source .. ": ") or ""
    local msg = msgPrefix .. entry.message

    -- Word-wrap the message within the available width
    local maxTextW = screenW - pad * 2
    local wrappedW, wrappedLines = bodyFont:getWrap(msg, maxTextW)
    for _, line in ipairs(wrappedLines) do
      love.graphics.print(line, x, y)
      y = y + bodyFont:getHeight()
    end

    y = y + 8

    -- Stack trace
    if entry.stack and entry.stack ~= "" then
      love.graphics.setFont(stackFont)
      love.graphics.setColor(SECONDARY)

      local lineCount = 0
      for line in entry.stack:gmatch("[^\n]+") do
        if lineCount >= MAX_STACK_LINES then
          love.graphics.setColor(DIM_COLOR)
          love.graphics.print("  ... (" .. (select(2, entry.stack:gsub("\n", "")) + 1 - MAX_STACK_LINES) .. " more frames)", x, y)
          break
        end

        -- Don't overflow the overlay
        if y + stackFont:getHeight() > screenH - pad - 20 then
          love.graphics.setColor(DIM_COLOR)
          love.graphics.print("  ... (truncated)", x, y)
          break
        end

        love.graphics.print("  " .. line, x, y)
        y = y + stackFont:getHeight()
        lineCount = lineCount + 1
      end
    end

    -- Footer: error count + dismiss hint
    love.graphics.setFont(stackFont)
    love.graphics.setColor(DIM_COLOR)
    local footer = ""
    if #buffer > 1 then
      footer = "[" .. currentIndex .. " of " .. #buffer .. " errors]"
    end
    love.graphics.print(footer, x, screenH - pad - stackFont:getHeight())

    local dismiss = "click to dismiss"
    local dismissW = stackFont:getWidth(dismiss)
    love.graphics.print(dismiss, screenW - pad - dismissW, screenH - pad - stackFont:getHeight())

    -- Restore graphics state
    love.graphics.pop()
  end)

  if not ok then
    -- Last resort: try to print that the error overlay itself failed
    pcall(function()
      io.write("[react-love] Error overlay draw failed: " .. tostring(drawErr) .. "\n")
      io.flush()
    end)
  end
end

--- Handle mouse press for dismissing the overlay.
--- Call from love.mousepressed(x, y, button).
--- Returns true if the click was consumed by the overlay.
function Errors.mousepressed(x, y, button)
  if not visible or currentIndex < 1 then
    return false
  end

  local screenH = love.graphics.getHeight()
  local overlayH = math.max(MIN_OVERLAY_HEIGHT, math.floor(screenH * OVERLAY_HEIGHT_FRAC))
  local overlayY = screenH - overlayH

  -- Check if click is within the overlay
  if y >= overlayY then
    -- Cycle through errors if there are multiple, or dismiss if on last one
    if currentIndex < #buffer then
      currentIndex = currentIndex + 1
    else
      visible = false
      currentIndex = 0
    end
    return true  -- consumed
  end

  return false
end

--- Get the current error count.
function Errors.count()
  return #buffer
end

--- Check if the overlay is currently visible.
function Errors.isVisible()
  return visible
end

--- Clear all errors and hide the overlay.
function Errors.clear()
  buffer = {}
  currentIndex = 0
  visible = false
end

return Errors
