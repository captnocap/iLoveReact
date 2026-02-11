--[[
  screenshot.lua -- Headless screenshot capture for react-love

  Triggered via environment variable ILOVEREACT_SCREENSHOT=1.
  Waits a few frames for layout to settle, captures a screenshot
  using love.graphics.captureScreenshot(), prints the output path,
  and quits.

  Usage (in init.lua):
    local screenshot = require("lua.screenshot")
    screenshot.init({ outputPath = os.getenv("ILOVEREACT_SCREENSHOT_OUTPUT") or "screenshot.png" })
    -- In update: screenshot.update()
    -- In draw:   screenshot.captureIfReady()
]]

local Screenshot = {}

-- ============================================================================
-- State
-- ============================================================================

local state = {
  enabled    = false,
  outputPath = "screenshot.png",
  frameCount = 0,
  captured   = false,
  -- Wait 3 frames: tree mutations, layout pass, first paint, second paint
  -- for stencils/scissor state to settle
  waitFrames = 3,
}

-- ============================================================================
-- Public API
-- ============================================================================

--- Initialize screenshot mode.
--- @param config table { outputPath = string }
function Screenshot.init(config)
  config = config or {}
  state.enabled = true
  state.outputPath = config.outputPath or "screenshot.png"
  state.frameCount = 0
  state.captured = false
  io.write("[screenshot] Mode enabled, output: " .. state.outputPath .. "\n"); io.flush()
end

--- Call from love.update(). Increments frame counter.
function Screenshot.update()
  if not state.enabled or state.captured then return end
  state.frameCount = state.frameCount + 1
end

--- Call at the END of love.draw(). Captures screenshot on the target frame.
--- love.graphics.captureScreenshot() captures at the end of the current draw.
function Screenshot.captureIfReady()
  if not state.enabled or state.captured then return end
  if state.frameCount < state.waitFrames then return end

  state.captured = true
  io.write("[screenshot] Capturing frame " .. state.frameCount .. "...\n"); io.flush()

  -- captureScreenshot receives a callback or filename.
  -- With a filename, Love2D saves to the save directory.
  -- With a callback, we get the ImageData and can save wherever we want.
  love.graphics.captureScreenshot(function(imageData)
    local fileData = imageData:encode("png")
    -- Write to absolute path using Lua io (not Love2D filesystem)
    local f = io.open(state.outputPath, "wb")
    if f then
      f:write(fileData:getString())
      f:close()
      io.write("SCREENSHOT_SAVED:" .. state.outputPath .. "\n"); io.flush()
    else
      io.write("[screenshot] ERROR: Could not write to " .. state.outputPath .. "\n"); io.flush()
    end
    love.event.quit(0)
  end)
end

--- Check if screenshot mode is enabled.
function Screenshot.isEnabled()
  return state.enabled
end

return Screenshot
