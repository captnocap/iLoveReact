--[[
  measure.lua -- Text measurement and shared font cache

  Provides a shared font cache (used by both measure and painter) and
  functions to measure text dimensions using Love2D's font APIs.

  Supports:
    - Unconstrained measurement (natural width + single-line height)
    - Width-constrained measurement (wraps text, returns wrapped height)
    - Custom font loading via fontFamily (path to .ttf/.otf file)
    - lineHeight override (pixels, replaces font:getHeight() for line spacing)
    - letterSpacing (pixels, extra space between characters)
    - numberOfLines clamping (limits measured height to N lines)
    - Measurement result caching keyed by all relevant parameters
]]

local Measure = {}

-- ============================================================================
-- Shared font cache
-- ============================================================================

local fontCache = {}

--- Return a Love2D Font for the given size and optional font family,
--- creating one if needed.
--- This is the single source of truth for font objects -- painter.lua
--- should call this instead of maintaining its own cache.
--- @param size number         Font size in pixels (default 14)
--- @param fontFamily string|nil  Path to a .ttf/.otf font file, or nil for default
--- @return love.Font
function Measure.getFont(size, fontFamily, fontWeight)
  size = math.floor(size or 14)
  local isBold = fontWeight == "bold" or (type(fontWeight) == "number" and fontWeight >= 700)
  local key
  if fontFamily then
    key = fontFamily .. (isBold and "\1bold\0" or "\0") .. size
  else
    key = (isBold and "bold\0" or "") .. size
  end

  if not fontCache[key] then
    if fontFamily then
      -- Attempt to load custom font; fall back to default on failure
      local ok, font = pcall(love.graphics.newFont, fontFamily, size)
      if ok and font then
        fontCache[key] = font
      else
        print("[measure] WARNING: failed to load font '" .. tostring(fontFamily)
              .. "', falling back to default font at size " .. size)
        fontCache[key] = love.graphics.newFont(size)
      end
    else
      fontCache[key] = love.graphics.newFont(size)
    end
  end
  return fontCache[key], isBold
end

-- ============================================================================
-- Measurement cache
-- ============================================================================

local measureCache = {}
local CACHE_MAX = 512

--- Build a cache key from measurement parameters.
local function cacheKey(text, fontSize, maxWidth, fontFamily, lineHeight, letterSpacing, numberOfLines, fontWeight)
  -- Use -1 as sentinel for nil values
  local mw = maxWidth or -1
  local ff = fontFamily or ""
  local lh = lineHeight or -1
  local ls = letterSpacing or 0
  local nl = numberOfLines or -1
  local fw = fontWeight or ""
  return text .. "\0" .. fontSize .. "\0" .. mw .. "\0" .. ff .. "\0" .. lh .. "\0" .. ls .. "\0" .. nl .. "\0" .. fw
end

--- Evict the entire measurement cache.
--- Call when fonts change or on major state reset.
function Measure.clearCache()
  measureCache = {}
end

-- ============================================================================
-- Letter-spacing width calculation
-- ============================================================================

--- Calculate the width of a string accounting for letter spacing.
--- When letterSpacing is 0 or nil, returns font:getWidth(text) directly.
--- @param font love.Font
--- @param text string
--- @param letterSpacing number|nil  Extra pixels between characters
--- @return number
function Measure.getWidthWithSpacing(font, text, letterSpacing)
  if not letterSpacing or letterSpacing == 0 then
    return font:getWidth(text)
  end
  local len = #text
  if len == 0 then return 0 end
  -- Total width = natural width + (charCount - 1) * letterSpacing
  return font:getWidth(text) + (len - 1) * letterSpacing
end

-- ============================================================================
-- Core measurement
-- ============================================================================

--- Measure a text string and return { width, height }.
---
--- @param text          string      The text content to measure.
--- @param fontSize      number      Font size in pixels (default 14).
--- @param maxWidth      number|nil  Maximum width constraint for wrapping.
---                                  nil means unconstrained (single line).
--- @param fontFamily    string|nil  Path to a custom font file, or nil for default.
--- @param lineHeight    number|nil  Custom line height in pixels, or nil to use font height.
--- @param letterSpacing number|nil  Extra space between characters in pixels.
--- @param numberOfLines number|nil  Maximum number of lines; height is clamped if set.
--- @return table  { width = number, height = number }
function Measure.measureText(text, fontSize, maxWidth, fontFamily, lineHeight, letterSpacing, numberOfLines, fontWeight)
  fontSize = fontSize or 14
  text = tostring(text or "")

  if text == "" then
    return { width = 0, height = 0 }
  end

  -- Check cache
  local key = cacheKey(text, fontSize, maxWidth, fontFamily, lineHeight, letterSpacing, numberOfLines, fontWeight)
  local cached = measureCache[key]
  if cached then
    return cached
  end

  local font = Measure.getFont(fontSize, fontFamily, fontWeight)
  local effectiveLineH = lineHeight or font:getHeight()
  local result

  if maxWidth and maxWidth > 0 then
    -- Width-constrained: use getWrap to determine wrapped lines.
    -- When letterSpacing is set, the effective available width per line
    -- is narrower because characters are wider, but Love2D's getWrap
    -- does not know about letterSpacing. We compensate by reducing
    -- the wrap width proportionally. This is an approximation.
    local wrapConstraint = maxWidth
    if letterSpacing and letterSpacing ~= 0 then
      -- Estimate: average character width + letterSpacing vs average character width
      -- Use a ratio to shrink the wrap width so getWrap wraps earlier.
      local avgCharW = font:getWidth("M")  -- rough per-char width
      if avgCharW > 0 then
        local ratio = avgCharW / (avgCharW + letterSpacing)
        wrapConstraint = maxWidth * ratio
      end
    end

    local wrapWidth, lines = font:getWrap(text, wrapConstraint)
    local numLines = #lines
    if numLines == 0 then numLines = 1 end

    -- Clamp to numberOfLines if specified
    if numberOfLines and numberOfLines > 0 and numLines > numberOfLines then
      numLines = numberOfLines
    end

    -- Calculate the actual widest line width with letter spacing
    local actualWidth = wrapWidth
    if letterSpacing and letterSpacing ~= 0 then
      actualWidth = 0
      local linesToMeasure = numberOfLines and math.min(#lines, numberOfLines) or #lines
      for i = 1, linesToMeasure do
        local lw = Measure.getWidthWithSpacing(font, lines[i], letterSpacing)
        if lw > actualWidth then actualWidth = lw end
      end
    end

    result = {
      width  = math.min(actualWidth, maxWidth),
      height = numLines * effectiveLineH,
    }
  else
    -- Unconstrained: single logical line
    local w = Measure.getWidthWithSpacing(font, text, letterSpacing)

    -- Even unconstrained, numberOfLines = 1 means single line height
    local numLines = 1
    if numberOfLines and numberOfLines > 0 then
      numLines = math.min(1, numberOfLines)
    end

    result = {
      width  = w,
      height = numLines * effectiveLineH,
    }
  end

  -- Store in cache (simple eviction: clear all when full)
  if next(measureCache) ~= nil then
    local count = 0
    for _ in pairs(measureCache) do
      count = count + 1
      if count >= CACHE_MAX then
        measureCache = {}
        break
      end
    end
  end
  measureCache[key] = result

  return result
end

return Measure
