--[[
  painter.lua -- Love2D draw calls for the retained element tree

  Walks the tree produced by tree.lua (after layout.lua has computed positions)
  and issues Love2D graphics calls to render each node.

  Supports:
    - View/box: backgroundColor, borderRadius, borderWidth, borderColor, opacity
    - Text/__TEXT__: color, textAlign, fontSize (with font cache), opacity
    - Custom font families via fontFamily (path to .ttf/.otf)
    - Text truncation with ellipsis (textOverflow, numberOfLines)
    - lineHeight override (manual line-by-line rendering when set)
    - letterSpacing (character-by-character rendering -- known to be expensive)
    - Image: actual image rendering with scaling, opacity, and borderRadius
    - Video: Theora video playback with objectFit, play/pause/loop/volume control
    - Opacity propagation: nested opacity values multiply down the tree
    - overflow:hidden with borderRadius > 0: stencil-based clipping with nesting support
    - overflow:hidden with borderRadius = 0: scissor-based rectangular clipping
    - zIndex: explicit stacking order for children (paint-order only, no layout effect)
    - overflow:scroll: scrollable containers with scissor clipping and scroll transform
    - Box shadows: drop shadow with blur simulation
    - Gradients: linear gradient backgrounds (horizontal, vertical, diagonal)
    - Transforms: translate, rotate, scale with transform origin
]]

local Measure = nil  -- Injected at init time via Painter.init()
local Images = nil   -- Injected at init time via Painter.init()
local Videos = nil   -- Injected at init time via Painter.init()
local ZIndex = require("lua.zindex")
local TextEditorModule = nil  -- Lazy-loaded to avoid circular deps
local CodeBlockModule = nil   -- Lazy-loaded to avoid circular deps
local TextSelectionModule = nil  -- Lazy-loaded to avoid circular deps

local Painter = {}

-- Set during Painter.init() from the injected measure module
local getFont = nil

--- Initialize the painter with target-specific dependencies.
--- Must be called before any paint operations.
--- @param config table  { measure = MeasureModule, images = ImagesModule }
function Painter.init(config)
  config = config or {}
  Measure = config.measure
  Images = config.images
  Videos = config.videos
  getFont = Measure.getFont
end

-- ============================================================================
-- Color helpers
-- ============================================================================

--- Set the active Love2D drawing color.
--- Accepts hex strings ("#ff00ff", "#ff00ff80") or number arrays ({r, g, b, a}).
function Painter.setColor(c)
  if not c then return end
  if type(c) == "string" then
    if c == "transparent" then
      love.graphics.setColor(0, 0, 0, 0)
      return
    end
    local r, g, b, a = c:match("#(%x%x)(%x%x)(%x%x)(%x?%x?)")
    if r then
      local alpha = 1
      if a and a ~= "" then alpha = tonumber(a, 16) / 255 end
      love.graphics.setColor(
        tonumber(r, 16) / 255,
        tonumber(g, 16) / 255,
        tonumber(b, 16) / 255,
        alpha
      )
    end
  elseif type(c) == "table" then
    love.graphics.setColor(c[1] or 0, c[2] or 0, c[3] or 0, c[4] or 1)
  end
end

--- Apply opacity multiplier to the current drawing color.
--- Call this after setColor to apply inherited/effective opacity.
--- @param opacity number between 0 and 1
function Painter.applyOpacity(opacity)
  if opacity >= 1 then return end
  local r, g, b, a = love.graphics.getColor()
  love.graphics.setColor(r, g, b, a * opacity)
end

-- ============================================================================
-- Text truncation helpers
-- ============================================================================

local ELLIPSIS = "..."

--- Truncate a single line of text so that the text + ellipsis fits within maxWidth.
--- Uses a binary search over character positions for efficiency.
--- @param font    love.Font  The font used for width measurement.
--- @param text    string     The full text to truncate.
--- @param maxWidth number    The maximum pixel width available.
--- @param letterSpacing number|nil  Extra space between characters (included in width calc).
--- @return string  The truncated text ending with "..." (or original if it fits).
function Painter.truncateWithEllipsis(font, text, maxWidth, letterSpacing)
  local textWidth = Measure.getWidthWithSpacing(font, text, letterSpacing)
  if textWidth <= maxWidth then
    return text
  end

  local ellipsisW = Measure.getWidthWithSpacing(font, ELLIPSIS, letterSpacing)
  local available = maxWidth - ellipsisW
  if available <= 0 then
    return ELLIPSIS
  end

  -- Binary search for the longest prefix that fits within `available`
  local lo, hi = 0, #text
  while lo < hi do
    local mid = math.floor((lo + hi + 1) / 2)
    local prefix = text:sub(1, mid)
    local pw = Measure.getWidthWithSpacing(font, prefix, letterSpacing)
    if pw <= available then
      lo = mid
    else
      hi = mid - 1
    end
  end

  if lo == 0 then
    return ELLIPSIS
  end

  return text:sub(1, lo) .. ELLIPSIS
end

--- Apply numberOfLines truncation to text that will be rendered within maxWidth.
--- Returns the (possibly truncated) list of wrapped lines.
--- @param font          love.Font  The font used for wrapping/measurement.
--- @param text          string     The full text content.
--- @param maxWidth      number     The wrapping width constraint.
--- @param numberOfLines number|nil Max number of visible lines.
--- @param textOverflow  string|nil "ellipsis" to add "..." on the last truncated line.
--- @param letterSpacing number|nil Extra space between characters.
--- @return table  Array of line strings ready to render.
function Painter.getVisibleLines(font, text, maxWidth, numberOfLines, textOverflow, letterSpacing)
  -- Normalize line endings (Windows \r\n → \n)
  text = text:gsub("\r\n", "\n"):gsub("\r", "\n")
  -- When letterSpacing is set, reduce the wrap width to approximate wider characters
  local wrapConstraint = maxWidth
  if letterSpacing and letterSpacing ~= 0 then
    local avgCharW = font:getWidth("M")
    if avgCharW > 0 then
      local ratio = avgCharW / (avgCharW + letterSpacing)
      wrapConstraint = maxWidth * ratio
    end
  end

  local _, lines = font:getWrap(text, wrapConstraint)
  if #lines == 0 then
    lines = { "" }
  end

  -- If no line limit or text fits, return all lines
  if not numberOfLines or numberOfLines <= 0 or #lines <= numberOfLines then
    return lines
  end

  -- Truncate to numberOfLines
  local visible = {}
  for i = 1, numberOfLines do
    visible[i] = lines[i]
  end

  -- If ellipsis mode, truncate the last visible line with "..."
  if textOverflow == "ellipsis" and numberOfLines > 0 then
    local lastLine = visible[numberOfLines]
    visible[numberOfLines] = Painter.truncateWithEllipsis(font, lastLine, maxWidth, letterSpacing)
  end

  return visible
end

-- ============================================================================
-- Text rendering helpers
-- ============================================================================

--- Render a single line of text with letter spacing by drawing each character
--- individually. This is expensive and should only be used when letterSpacing ~= 0.
--- NOTE: Character-by-character rendering has a known performance cost. Only
--- activated when letterSpacing is explicitly set to a non-zero value.
--- @param font          love.Font
--- @param text          string
--- @param x             number      Draw X origin.
--- @param y             number      Draw Y origin.
--- @param letterSpacing number      Extra pixels between characters.
--- @param align         string      "left", "center", or "right".
--- @param maxWidth      number      Available width for alignment.
local function drawLineWithSpacing(font, text, x, y, letterSpacing, align, maxWidth)
  if text == "" then return end

  local totalW = Measure.getWidthWithSpacing(font, text, letterSpacing)

  -- Calculate starting X based on alignment
  local startX = x
  if align == "center" then
    startX = x + (maxWidth - totalW) / 2
  elseif align == "right" then
    startX = x + maxWidth - totalW
  end

  local cx = startX
  for i = 1, #text do
    local ch = text:sub(i, i)
    love.graphics.print(ch, cx, y)
    cx = cx + font:getWidth(ch) + letterSpacing
  end
end

--- Render a single line of text without letter spacing.
--- Uses love.graphics.printf for alignment support.
--- @param font     love.Font
--- @param text     string
--- @param x        number
--- @param y        number
--- @param align    string   "left", "center", or "right"
--- @param maxWidth number
local function drawLineNormal(font, text, x, y, align, maxWidth)
  love.graphics.printf(text, x, y, maxWidth, align)
end

-- ============================================================================
-- Resolve text style properties (inheriting from parent Text for __TEXT__)
-- ============================================================================

--- Resolve fontFamily, inheriting from parent Text node for __TEXT__ children.
local function resolveFontFamily(node)
  local s = node.style or {}
  if s.fontFamily then return s.fontFamily end
  if node.type == "__TEXT__" and node.parent then
    local ps = node.parent.style or {}
    if ps.fontFamily then return ps.fontFamily end
  end
  return nil
end

--- Resolve lineHeight, inheriting from parent Text node for __TEXT__ children.
local function resolveLineHeight(node)
  local s = node.style or {}
  if s.lineHeight then return s.lineHeight end
  if node.type == "__TEXT__" and node.parent then
    local ps = node.parent.style or {}
    if ps.lineHeight then return ps.lineHeight end
  end
  return nil
end

--- Resolve letterSpacing, inheriting from parent Text node for __TEXT__ children.
local function resolveLetterSpacing(node)
  local s = node.style or {}
  if s.letterSpacing then return s.letterSpacing end
  if node.type == "__TEXT__" and node.parent then
    local ps = node.parent.style or {}
    if ps.letterSpacing then return ps.letterSpacing end
  end
  return nil
end

--- Resolve textOverflow, inheriting from parent Text node for __TEXT__ children.
local function resolveTextOverflow(node)
  local s = node.style or {}
  if s.textOverflow then return s.textOverflow end
  if node.type == "__TEXT__" and node.parent then
    local ps = node.parent.style or {}
    if ps.textOverflow then return ps.textOverflow end
  end
  return nil
end

--- Resolve numberOfLines, inheriting from parent Text node for __TEXT__ children.
local function resolveNumberOfLines(node)
  local p = node.props or {}
  if p.numberOfLines then return p.numberOfLines end
  if node.type == "__TEXT__" and node.parent then
    local pp = node.parent.props or {}
    if pp.numberOfLines then return pp.numberOfLines end
  end
  return nil
end

-- ============================================================================
-- Box shadow helper
-- ============================================================================

--- Draw a box shadow by rendering multiple slightly larger rectangles
--- with progressively fading opacity to simulate blur.
--- @param x number Left edge of the box
--- @param y number Top edge of the box
--- @param w number Width of the box
--- @param h number Height of the box
--- @param borderRadius number Border radius for rounded corners
--- @param shadowColor table Shadow color
--- @param offsetX number Horizontal shadow offset
--- @param offsetY number Vertical shadow offset
--- @param blur number Blur radius (approximate)
--- @param effectiveOpacity number Combined opacity from parent chain
local function drawBoxShadow(x, y, w, h, borderRadius, shadowColor, offsetX, offsetY, blur, effectiveOpacity)
  if not shadowColor or blur <= 0 then return end

  -- Cap blur steps for performance
  local blurSteps = math.ceil(blur)
  if blurSteps > 10 then blurSteps = 10 end
  if blurSteps < 1 then blurSteps = 1 end

  -- Parse shadow color and apply effective opacity
  Painter.setColor(shadowColor)
  local r, g, b, a = love.graphics.getColor()
  local baseAlpha = a * effectiveOpacity

  -- Draw multiple rectangles from outermost to innermost, fading out
  for i = blurSteps, 1, -1 do
    local expand = i
    local alpha = (baseAlpha / blurSteps) * (blurSteps - i + 1)
    love.graphics.setColor(r, g, b, alpha)

    local sx = x + offsetX - expand
    local sy = y + offsetY - expand
    local sw = w + expand * 2
    local sh = h + expand * 2
    local sr = borderRadius + expand

    love.graphics.rectangle("fill", sx, sy, sw, sh, sr, sr)
  end
end

-- ============================================================================
-- Gradient background helper
-- ============================================================================

--- Draw a gradient background using Love2D's mesh API.
--- @param x number Left edge
--- @param y number Top edge
--- @param w number Width
--- @param h number Height
--- @param direction string 'horizontal', 'vertical', or 'diagonal'
--- @param color1 table Start color
--- @param color2 table End color
--- @param effectiveOpacity number Combined opacity from parent chain
local function drawGradient(x, y, w, h, direction, color1, color2, effectiveOpacity)
  -- Parse colors
  Painter.setColor(color1)
  local r1, g1, b1, a1 = love.graphics.getColor()
  a1 = a1 * effectiveOpacity

  Painter.setColor(color2)
  local r2, g2, b2, a2 = love.graphics.getColor()
  a2 = a2 * effectiveOpacity

  -- Create gradient vertices based on direction
  local vertices
  if direction == "horizontal" then
    vertices = {
      {x, y, 0, 0, r1, g1, b1, a1},       -- top-left
      {x + w, y, 1, 0, r2, g2, b2, a2},   -- top-right
      {x + w, y + h, 1, 1, r2, g2, b2, a2}, -- bottom-right
      {x, y + h, 0, 1, r1, g1, b1, a1},   -- bottom-left
    }
  elseif direction == "diagonal" then
    vertices = {
      {x, y, 0, 0, r1, g1, b1, a1},       -- top-left
      {x + w, y, 0.5, 0, r1 * 0.5 + r2 * 0.5, g1 * 0.5 + g2 * 0.5, b1 * 0.5 + b2 * 0.5, (a1 + a2) * 0.5},
      {x + w, y + h, 1, 1, r2, g2, b2, a2}, -- bottom-right
      {x, y + h, 0.5, 1, r1 * 0.5 + r2 * 0.5, g1 * 0.5 + g2 * 0.5, b1 * 0.5 + b2 * 0.5, (a1 + a2) * 0.5},
    }
  else  -- vertical (default)
    vertices = {
      {x, y, 0, 0, r1, g1, b1, a1},       -- top-left
      {x + w, y, 1, 0, r1, g1, b1, a1},   -- top-right
      {x + w, y + h, 1, 1, r2, g2, b2, a2}, -- bottom-right
      {x, y + h, 0, 1, r2, g2, b2, a2},   -- bottom-left
    }
  end

  -- Create and draw mesh
  local mesh = love.graphics.newMesh(vertices, "fan", "static")
  love.graphics.setColor(1, 1, 1, 1)  -- Reset to white so mesh colors show correctly
  love.graphics.draw(mesh)
end

-- ============================================================================
-- Per-corner border radius helper
-- ============================================================================

--- Draw a filled or stroked rectangle with per-corner border radii.
--- Uses arc segments for each corner and polygon fill for the body.
--- Falls back to love.graphics.rectangle() when all radii are equal.
--- @param mode string "fill" or "line"
--- @param x number Left edge
--- @param y number Top edge
--- @param w number Width
--- @param h number Height
--- @param tl number Top-left radius
--- @param tr number Top-right radius
--- @param bl number Bottom-left radius
--- @param br number Bottom-right radius
local function drawRoundedRect(mode, x, y, w, h, tl, tr, bl, br)
  -- Clamp radii to half the shortest dimension
  local maxR = math.min(w, h) / 2
  tl = math.min(tl, maxR)
  tr = math.min(tr, maxR)
  bl = math.min(bl, maxR)
  br = math.min(br, maxR)

  -- If all corners are the same, use Love2D's built-in (faster)
  if tl == tr and tr == bl and bl == br then
    love.graphics.rectangle(mode, x, y, w, h, tl, tl)
    return
  end

  -- Build polygon vertices: top-left arc, top-right arc, bottom-right arc, bottom-left arc
  local segments = 8  -- arc segments per corner
  local vertices = {}
  local function addArc(cx, cy, r, startAngle, endAngle)
    if r <= 0 then
      vertices[#vertices + 1] = cx
      vertices[#vertices + 1] = cy
      return
    end
    for i = 0, segments do
      local angle = startAngle + (endAngle - startAngle) * (i / segments)
      vertices[#vertices + 1] = cx + math.cos(angle) * r
      vertices[#vertices + 1] = cy + math.sin(angle) * r
    end
  end

  -- Top-left corner (arc from pi to 3pi/2)
  addArc(x + tl, y + tl, tl, math.pi, math.pi * 1.5)
  -- Top-right corner (arc from 3pi/2 to 2pi)
  addArc(x + w - tr, y + tr, tr, math.pi * 1.5, math.pi * 2)
  -- Bottom-right corner (arc from 0 to pi/2)
  addArc(x + w - br, y + h - br, br, 0, math.pi * 0.5)
  -- Bottom-left corner (arc from pi/2 to pi)
  addArc(x + bl, y + h - bl, bl, math.pi * 0.5, math.pi)

  if mode == "fill" then
    love.graphics.polygon("fill", vertices)
  else
    love.graphics.polygon("line", vertices)
  end
end

--- Resolve per-corner border radii from style properties.
--- Returns tl, tr, bl, br (top-left, top-right, bottom-left, bottom-right).
--- Per-corner properties override the uniform borderRadius.
--- @param s table The node's style table
--- @return number, number, number, number
local function resolveCornerRadii(s)
  local uniform = s.borderRadius or 0
  local tl = s.borderTopLeftRadius or uniform
  local tr = s.borderTopRightRadius or uniform
  local bl = s.borderBottomLeftRadius or uniform
  local br = s.borderBottomRightRadius or uniform
  return tl, tr, bl, br
end

--- Check if a node has non-uniform per-corner border radii.
local function hasPerCornerRadius(s)
  return s.borderTopLeftRadius or s.borderTopRightRadius
      or s.borderBottomLeftRadius or s.borderBottomRightRadius
end

-- ============================================================================
-- Transform helper
-- ============================================================================

--- Apply Love2D transform stack operations for a node's transform property.
--- Returns true if a transform was applied (caller must pop after painting).
--- NOTE: Transforms are visual only and do not affect layout positions or hit testing.
--- This matches CSS behavior but means rotated/scaled elements will still use their
--- original layout rectangles for pointer events.
--- @param transform table The transform style property
--- @param c table The computed rect {x, y, w, h}
--- @return boolean Whether a transform was applied
local function applyTransform(transform, c)
  if not transform then return false end

  -- Check if any transform is actually set
  local hasTransform = transform.translateX or transform.translateY or
                       transform.rotate or transform.scaleX or transform.scaleY or
                       transform.skewX or transform.skewY
  if not hasTransform then return false end

  love.graphics.push()

  -- Compute transform origin (default center)
  local originX = transform.originX or 0.5
  local originY = transform.originY or 0.5
  local ox = c.x + originX * c.w
  local oy = c.y + originY * c.h

  -- Move to transform origin
  love.graphics.translate(ox, oy)

  -- Apply rotation
  if transform.rotate then
    love.graphics.rotate(math.rad(transform.rotate))
  end

  -- Apply scale
  if transform.scaleX or transform.scaleY then
    love.graphics.scale(transform.scaleX or 1, transform.scaleY or 1)
  end

  -- Apply skew (shear)
  if transform.skewX or transform.skewY then
    local kx = transform.skewX and math.tan(math.rad(transform.skewX)) or 0
    local ky = transform.skewY and math.tan(math.rad(transform.skewY)) or 0
    love.graphics.shear(kx, ky)
  end

  -- Move back from origin
  love.graphics.translate(-ox, -oy)

  -- Apply additional translation
  if transform.translateX or transform.translateY then
    love.graphics.translate(transform.translateX or 0, transform.translateY or 0)
  end

  return true
end

-- ============================================================================
-- Node painter (recursive)
-- ============================================================================

--- Paint a single node and recurse into its children.
--- @param node table The node to paint
--- @param inheritedOpacity number Accumulated opacity from parent chain (default 1)
--- @param stencilDepth number Current stencil nesting depth (default 0)
function Painter.paintNode(node, inheritedOpacity, stencilDepth)
  if not node or not node.computed then return end

  inheritedOpacity = inheritedOpacity or 1
  stencilDepth = stencilDepth or 0

  local c = node.computed
  local s = node.style or {}

  -- display:none -- skip this node and all its children entirely
  if s.display == "none" then return end

  -- visibility:hidden -- layout occupies space but skip painting (children still paint)
  local isHidden = s.visibility == "hidden"

  -- Calculate effective opacity for this node
  local nodeOpacity = s.opacity or 1
  local effectiveOpacity = nodeOpacity * inheritedOpacity

  -- Early exit optimization: skip rendering entirely if fully transparent
  if effectiveOpacity <= 0 then return end

  -- Apply transform (affects this node and all children)
  local didTransform = applyTransform(s.transform, c)

  -- Resolve border radii (per-corner or uniform)
  local tl, tr, bl, br = resolveCornerRadii(s)
  local borderRadius = s.borderRadius or 0
  local hasRoundedCorners = tl > 0 or tr > 0 or bl > 0 or br > 0
  local isPerCorner = hasPerCornerRadius(s)
  local isScroll = s.overflow == "scroll"
  local needsClipping = s.overflow == "hidden" or isScroll
  local useStencil = needsClipping and hasRoundedCorners
  local useScissor = needsClipping and not hasRoundedCorners

  -- Apply stencil clipping for rounded corners
  if useStencil then
    local stencilValue = stencilDepth + 1
    love.graphics.stencil(function()
      if isPerCorner then
        drawRoundedRect("fill", c.x, c.y, c.w, c.h, tl, tr, bl, br)
      else
        love.graphics.rectangle("fill", c.x, c.y, c.w, c.h, borderRadius, borderRadius)
      end
    end, "replace", stencilValue)
    love.graphics.setStencilTest("greater", stencilDepth)
    stencilDepth = stencilValue
  elseif useScissor then
    -- Scissor clipping for rectangular overflow:hidden or scroll
    love.graphics.setScissor(c.x, c.y, c.w, c.h)
  end

  if not isHidden and (node.type == "View" or node.type == "box") then
    -- Draw box shadow BEFORE background (so it appears behind)
    if s.shadowColor and s.shadowBlur and s.shadowBlur > 0 then
      local offsetX = s.shadowOffsetX or 0
      local offsetY = s.shadowOffsetY or 0
      drawBoxShadow(c.x, c.y, c.w, c.h, borderRadius, s.shadowColor, offsetX, offsetY, s.shadowBlur, effectiveOpacity)
    end

    -- Background: gradient takes precedence over solid color
    if s.backgroundGradient then
      local grad = s.backgroundGradient
      -- Apply borderRadius clipping if needed (stencil for rounded gradients)
      if hasRoundedCorners then
        local gradStencilValue = stencilDepth + 1
        love.graphics.stencil(function()
          if isPerCorner then
            drawRoundedRect("fill", c.x, c.y, c.w, c.h, tl, tr, bl, br)
          else
            love.graphics.rectangle("fill", c.x, c.y, c.w, c.h, borderRadius, borderRadius)
          end
        end, "replace", gradStencilValue)
        love.graphics.setStencilTest("greater", stencilDepth)

        drawGradient(c.x, c.y, c.w, c.h, grad.direction, grad.colors[1], grad.colors[2], effectiveOpacity)

        -- Restore stencil test
        if stencilDepth > 0 then
          love.graphics.setStencilTest("greater", stencilDepth - 1)
        else
          love.graphics.setStencilTest()
        end
      else
        drawGradient(c.x, c.y, c.w, c.h, grad.direction, grad.colors[1], grad.colors[2], effectiveOpacity)
      end
    elseif s.backgroundColor and s.backgroundColor ~= "transparent" then
      -- Solid background fill
      Painter.setColor(s.backgroundColor)
      Painter.applyOpacity(effectiveOpacity)
      if isPerCorner then
        drawRoundedRect("fill", c.x, c.y, c.w, c.h, tl, tr, bl, br)
      else
        love.graphics.rectangle("fill", c.x, c.y, c.w, c.h, borderRadius, borderRadius)
      end
    end

    -- Border stroke
    local bwT = s.borderTopWidth or s.borderWidth or 0
    local bwR = s.borderRightWidth or s.borderWidth or 0
    local bwB = s.borderBottomWidth or s.borderWidth or 0
    local bwL = s.borderLeftWidth or s.borderWidth or 0
    local hasUniformBorder = s.borderWidth and s.borderWidth > 0
        and not s.borderTopWidth and not s.borderRightWidth
        and not s.borderBottomWidth and not s.borderLeftWidth
    local hasPerSideBorder = (bwT > 0 or bwR > 0 or bwB > 0 or bwL > 0) and not hasUniformBorder

    if hasUniformBorder then
      -- Fast path: uniform border via rectangle stroke
      Painter.setColor(s.borderColor or { 0.5, 0.5, 0.5, 1 })
      Painter.applyOpacity(effectiveOpacity)
      love.graphics.setLineWidth(s.borderWidth)
      if isPerCorner then
        drawRoundedRect("line", c.x, c.y, c.w, c.h, tl, tr, bl, br)
      else
        love.graphics.rectangle("line", c.x, c.y, c.w, c.h, borderRadius, borderRadius)
      end
    elseif hasPerSideBorder then
      -- Per-side borders: draw individual lines with per-side colors
      local defaultColor = s.borderColor or { 0.5, 0.5, 0.5, 1 }
      if bwT > 0 then
        Painter.setColor(s.borderTopColor or defaultColor)
        Painter.applyOpacity(effectiveOpacity)
        love.graphics.setLineWidth(bwT)
        love.graphics.line(c.x, c.y + bwT/2, c.x + c.w, c.y + bwT/2)
      end
      if bwB > 0 then
        Painter.setColor(s.borderBottomColor or defaultColor)
        Painter.applyOpacity(effectiveOpacity)
        love.graphics.setLineWidth(bwB)
        love.graphics.line(c.x, c.y + c.h - bwB/2, c.x + c.w, c.y + c.h - bwB/2)
      end
      if bwL > 0 then
        Painter.setColor(s.borderLeftColor or defaultColor)
        Painter.applyOpacity(effectiveOpacity)
        love.graphics.setLineWidth(bwL)
        love.graphics.line(c.x + bwL/2, c.y, c.x + bwL/2, c.y + c.h)
      end
      if bwR > 0 then
        Painter.setColor(s.borderRightColor or defaultColor)
        Painter.applyOpacity(effectiveOpacity)
        love.graphics.setLineWidth(bwR)
        love.graphics.line(c.x + c.w - bwR/2, c.y, c.x + c.w - bwR/2, c.y + c.h)
      end
    end

    -- Outline (drawn outside the border box)
    if s.outlineWidth and s.outlineWidth > 0 then
      local outlineOffset = s.outlineOffset or 0
      local ox = c.x - s.outlineWidth - outlineOffset
      local oy = c.y - s.outlineWidth - outlineOffset
      local ow = c.w + (s.outlineWidth + outlineOffset) * 2
      local oh = c.h + (s.outlineWidth + outlineOffset) * 2
      Painter.setColor(s.outlineColor or { 1, 1, 1, 1 })
      Painter.applyOpacity(effectiveOpacity)
      love.graphics.setLineWidth(s.outlineWidth)
      if isPerCorner then
        local orad = s.outlineWidth + outlineOffset
        drawRoundedRect("line", ox, oy, ow, oh, tl + orad, tr + orad, bl + orad, br + orad)
      else
        local or_ = borderRadius > 0 and (borderRadius + s.outlineWidth + outlineOffset) or 0
        love.graphics.rectangle("line", ox, oy, ow, oh, or_, or_)
      end
    end

  elseif not isHidden and (node.type == "Text" or node.type == "__TEXT__") then
    -- Draw text selection highlight BEFORE text (so text renders on top)
    if not TextSelectionModule then
      local ok, mod = pcall(require, "lua.textselection")
      if ok then TextSelectionModule = mod end
    end
    if TextSelectionModule then
      TextSelectionModule.drawHighlight(node)
    end

    -- Resolve text style properties (with inheritance for __TEXT__ children)
    local fontSize = s.fontSize or 14
    local fontFamily = resolveFontFamily(node)
    local fontWeight = s.fontWeight
    local lineHeight = resolveLineHeight(node)
    local letterSpacing = resolveLetterSpacing(node)
    local textOverflow = resolveTextOverflow(node)
    local numberOfLines = resolveNumberOfLines(node)
    local textDecorationLine = s.textDecorationLine

    -- If this is a __TEXT__ child, inherit from parent Text node
    if node.type == "__TEXT__" and node.parent then
      local ps = node.parent.style or {}
      if not s.fontSize and ps.fontSize then fontSize = ps.fontSize end
      if not fontWeight then fontWeight = ps.fontWeight end
      if not textDecorationLine then textDecorationLine = ps.textDecorationLine end
    end

    local font, isBold = getFont(fontSize, fontFamily, fontWeight)
    love.graphics.setFont(font)

    -- Resolve text content (needed for both shadow and main draw)
    local text = node.text or (node.props and node.props.children) or ""
    if type(text) == "table" then text = table.concat(text) end
    text = tostring(text)

    local align = s.textAlign or "left"
    local hasCustomLineHeight = lineHeight and lineHeight ~= font:getHeight()
    local hasLetterSpacing = letterSpacing and letterSpacing ~= 0

    -- Determine rendering strategy:
    -- 1. If numberOfLines is set or textOverflow is "ellipsis", we need line control
    -- 2. If lineHeight is custom, we must render line-by-line
    -- 3. If letterSpacing is set, we must render character-by-character
    -- 4. Otherwise, use love.graphics.printf (fastest path)
    local needsLineControl = numberOfLines or textOverflow == "ellipsis"
    local needsManualRendering = hasCustomLineHeight or hasLetterSpacing or needsLineControl

    -- Text shadow: draw text first with offset and shadow color
    local shadowColor = s.textShadowColor
    if not shadowColor and node.type == "__TEXT__" and node.parent then
      shadowColor = (node.parent.style or {}).textShadowColor
    end
    if shadowColor then
      local sox = s.textShadowOffsetX or 0
      local soy = s.textShadowOffsetY or 0
      if not sox and node.type == "__TEXT__" and node.parent then
        sox = (node.parent.style or {}).textShadowOffsetX or 0
      end
      if not soy and node.type == "__TEXT__" and node.parent then
        soy = (node.parent.style or {}).textShadowOffsetY or 0
      end

      Painter.setColor(shadowColor)
      Painter.applyOpacity(effectiveOpacity)

      if not needsManualRendering then
        love.graphics.printf(text, c.x + sox, c.y + soy, c.w, align)
        if isBold then
          love.graphics.printf(text, c.x + sox + 0.8, c.y + soy, c.w, align)
        end
      else
        local effectiveLineH = lineHeight or font:getHeight()
        if textOverflow == "ellipsis" and not numberOfLines then
          local truncated = Painter.truncateWithEllipsis(font, text, c.w, letterSpacing)
          if hasLetterSpacing then
            drawLineWithSpacing(font, truncated, c.x + sox, c.y + soy, letterSpacing, align, c.w)
          else
            drawLineNormal(font, truncated, c.x + sox, c.y + soy, align, c.w)
          end
        else
          local lines = Painter.getVisibleLines(font, text, c.w, numberOfLines, textOverflow, letterSpacing)
          for i, line in ipairs(lines) do
            local ly = c.y + (i - 1) * effectiveLineH + soy
            if hasLetterSpacing then
              drawLineWithSpacing(font, line, c.x + sox, ly, letterSpacing, align, c.w)
            else
              drawLineNormal(font, line, c.x + sox, ly, align, c.w)
            end
          end
        end
      end
    end

    -- Text color with opacity (inherit from parent Text for __TEXT__ children)
    local textColor = s.color
    if not textColor and node.type == "__TEXT__" and node.parent then
      textColor = (node.parent.style or {}).color
    end
    Painter.setColor(textColor or { 1, 1, 1, 1 })
    Painter.applyOpacity(effectiveOpacity)

    if not needsManualRendering then
      -- Fast path: standard Love2D text rendering
      love.graphics.printf(text, c.x, c.y, c.w, align)
      -- Bold simulation: draw again offset by 1px (faux-bold)
      if isBold then
        love.graphics.printf(text, c.x + 0.8, c.y, c.w, align)
      end
    else
      -- Manual rendering path: get wrapped/truncated lines, draw each
      local effectiveLineH = lineHeight or font:getHeight()

      -- Single-line ellipsis (textOverflow = "ellipsis", no numberOfLines)
      if textOverflow == "ellipsis" and not numberOfLines then
        local truncated = Painter.truncateWithEllipsis(font, text, c.w, letterSpacing)
        if hasLetterSpacing then
          drawLineWithSpacing(font, truncated, c.x, c.y, letterSpacing, align, c.w)
          if isBold then drawLineWithSpacing(font, truncated, c.x + 0.8, c.y, letterSpacing, align, c.w) end
        else
          drawLineNormal(font, truncated, c.x, c.y, align, c.w)
          if isBold then drawLineNormal(font, truncated, c.x + 0.8, c.y, align, c.w) end
        end
      else
        -- Multi-line path: get visible lines (possibly truncated)
        local lines = Painter.getVisibleLines(font, text, c.w, numberOfLines, textOverflow, letterSpacing)

        for i, line in ipairs(lines) do
          local ly = c.y + (i - 1) * effectiveLineH
          if hasLetterSpacing then
            drawLineWithSpacing(font, line, c.x, ly, letterSpacing, align, c.w)
            if isBold then drawLineWithSpacing(font, line, c.x + 0.8, ly, letterSpacing, align, c.w) end
          else
            drawLineNormal(font, line, c.x, ly, align, c.w)
            if isBold then drawLineNormal(font, line, c.x + 0.8, ly, align, c.w) end
          end
        end
      end
    end

    -- Text decoration (underline, line-through)
    if textDecorationLine and textDecorationLine ~= "none" then
      local fontH = font:getHeight()
      local textW = c.w -- full width for decoration line
      if textDecorationLine == "underline" then
        local baselineY = c.y + fontH - font:getDescent()
        love.graphics.setLineWidth(1)
        love.graphics.line(c.x, baselineY, c.x + textW, baselineY)
      elseif textDecorationLine == "line-through" then
        local midY = c.y + fontH * 0.45
        love.graphics.setLineWidth(1)
        love.graphics.line(c.x, midY, c.x + textW, midY)
      end
    end

  elseif not isHidden and node.type == "Image" then
    local src = node.props and node.props.src
    if src then
      local image = Images.get(src)
      if image then
        local objectFit = s.objectFit or "fill"

        local imgW = image:getWidth()
        local imgH = image:getHeight()
        local scaleX, scaleY, drawX, drawY, drawW, drawH

        -- Calculate scaling and positioning based on objectFit mode
        if objectFit == "contain" then
          -- Scale to fit inside bounds while maintaining aspect ratio
          local scale = math.min(c.w / imgW, c.h / imgH)
          scaleX = scale
          scaleY = scale
          drawW = imgW * scale
          drawH = imgH * scale
          drawX = c.x + (c.w - drawW) / 2
          drawY = c.y + (c.h - drawH) / 2

        elseif objectFit == "cover" then
          -- Scale to cover bounds while maintaining aspect ratio
          local scale = math.max(c.w / imgW, c.h / imgH)
          scaleX = scale
          scaleY = scale
          drawW = imgW * scale
          drawH = imgH * scale
          drawX = c.x + (c.w - drawW) / 2
          drawY = c.y + (c.h - drawH) / 2

        elseif objectFit == "none" then
          -- No scaling, center the image
          scaleX = 1
          scaleY = 1
          drawW = imgW
          drawH = imgH
          drawX = c.x + (c.w - imgW) / 2
          drawY = c.y + (c.h - imgH) / 2

        else
          -- "fill" (default): stretch to fill bounds
          scaleX = c.w / imgW
          scaleY = c.h / imgH
          drawX = c.x
          drawY = c.y
          drawW = c.w
          drawH = c.h
        end

        -- Apply borderRadius clipping if needed (and not already in a stencil clip)
        local imageStencil = borderRadius > 0
        if imageStencil then
          local stencilValue = stencilDepth + 1
          love.graphics.stencil(function()
            love.graphics.rectangle("fill", c.x, c.y, c.w, c.h, borderRadius, borderRadius)
          end, "replace", stencilValue)
          love.graphics.setStencilTest("greater", stencilDepth)
        end

        -- Draw the image with effective opacity (inherited * node)
        love.graphics.setColor(1, 1, 1, effectiveOpacity)
        love.graphics.draw(image, drawX, drawY, 0, scaleX, scaleY)

        -- Restore stencil test to parent level
        if imageStencil then
          if stencilDepth > 0 then
            love.graphics.setStencilTest("greater", stencilDepth - 1)
          else
            love.graphics.setStencilTest()
          end
        end
      else
        -- Fallback: draw a placeholder rectangle if image failed to load
        love.graphics.setColor(0.5, 0.5, 0.5, 0.3 * effectiveOpacity)
        love.graphics.rectangle("fill", c.x, c.y, c.w, c.h)
        love.graphics.setColor(1, 0, 0, 0.8 * effectiveOpacity)
        love.graphics.rectangle("line", c.x, c.y, c.w, c.h)
      end
    end

  elseif not isHidden and node.type == "Video" and Videos then
    local src = node.props and node.props.src
    if src then
      local status = Videos.getStatus(src)

      if status == "ready" then
        local canvas = Videos.get(src)
        if canvas then
          -- Control playback via mpv property API
          Videos.setPaused(src, node.props.paused)
          Videos.setMuted(src, node.props.muted)
          Videos.setVolume(src, node.props.volume or 1)
          Videos.setLoop(src, node.props.loop)

          -- Calculate scaling using same objectFit logic as Image
          local objectFit = s.objectFit or "fill"
          local vidW, vidH = Videos.getDimensions(src)
          if not vidW then vidW, vidH = canvas:getWidth(), canvas:getHeight() end
          local scaleX, scaleY, drawX, drawY, drawW, drawH

          if objectFit == "contain" then
            local scale = math.min(c.w / vidW, c.h / vidH)
            scaleX = scale
            scaleY = scale
            drawW = vidW * scale
            drawH = vidH * scale
            drawX = c.x + (c.w - drawW) / 2
            drawY = c.y + (c.h - drawH) / 2
          elseif objectFit == "cover" then
            local scale = math.max(c.w / vidW, c.h / vidH)
            scaleX = scale
            scaleY = scale
            drawW = vidW * scale
            drawH = vidH * scale
            drawX = c.x + (c.w - drawW) / 2
            drawY = c.y + (c.h - drawH) / 2
          elseif objectFit == "none" then
            scaleX = 1
            scaleY = 1
            drawW = vidW
            drawH = vidH
            drawX = c.x + (c.w - vidW) / 2
            drawY = c.y + (c.h - vidH) / 2
          else
            -- "fill" (default)
            scaleX = c.w / vidW
            scaleY = c.h / vidH
            drawX = c.x
            drawY = c.y
            drawW = c.w
            drawH = c.h
          end

          -- Apply borderRadius clipping if needed
          local videoStencil = borderRadius > 0
          if videoStencil then
            local stencilValue = stencilDepth + 1
            love.graphics.stencil(function()
              love.graphics.rectangle("fill", c.x, c.y, c.w, c.h, borderRadius, borderRadius)
            end, "replace", stencilValue)
            love.graphics.setStencilTest("greater", stencilDepth)
          end

          -- Draw the video frame (Canvas is drawable just like Video)
          love.graphics.setColor(1, 1, 1, effectiveOpacity)
          love.graphics.draw(canvas, drawX, drawY, 0, scaleX, scaleY)

          -- Restore stencil
          if videoStencil then
            if stencilDepth > 0 then
              love.graphics.setStencilTest("greater", stencilDepth - 1)
            else
              love.graphics.setStencilTest()
            end
          end
        end

      else
        -- Loading / error / no video: neutral dark surface with film icon
        love.graphics.setColor(0.10, 0.11, 0.14, effectiveOpacity)
        love.graphics.rectangle("fill", c.x, c.y, c.w, c.h, borderRadius, borderRadius)
        love.graphics.setColor(0.20, 0.22, 0.28, 0.5 * effectiveOpacity)
        love.graphics.rectangle("line", c.x, c.y, c.w, c.h, borderRadius, borderRadius)

        -- Play triangle icon in center
        local iconSize = math.min(c.w, c.h) * 0.15
        if iconSize > 6 then
          local cx = c.x + c.w / 2
          local cy = c.y + c.h / 2
          love.graphics.setColor(0.30, 0.33, 0.40, 0.5 * effectiveOpacity)
          love.graphics.polygon("fill",
            cx - iconSize * 0.4, cy - iconSize * 0.5,
            cx - iconSize * 0.4, cy + iconSize * 0.5,
            cx + iconSize * 0.5, cy)
        end
      end
    end

  elseif not isHidden and node.type == "TextEditor" then
    -- Lua-owned text editor: delegate rendering entirely to texteditor.lua
    if not TextEditorModule then
      TextEditorModule = require("lua.texteditor")
    end
    TextEditorModule.draw(node, effectiveOpacity)

  elseif not isHidden and node.type == "CodeBlock" then
    -- Lua-owned code block: delegate rendering entirely to codeblock.lua
    if not CodeBlockModule then
      CodeBlockModule = require("lua.codeblock")
    end
    local c = node.computed
    if c and c.w > 0 and c.h > 0 then
      CodeBlockModule.render(node, c, effectiveOpacity)
    end
  end

  -- Determine paint order: sort children by zIndex (stable, ascending)
  local children = node.children or {}
  local paintOrder = ZIndex.getSortedChildren(children)

  -- Apply scroll transform if this is a scroll container
  local scrollX, scrollY = 0, 0
  if isScroll and node.scrollState then
    scrollX = node.scrollState.scrollX or 0
    scrollY = node.scrollState.scrollY or 0
  end

  if isScroll and (scrollX ~= 0 or scrollY ~= 0) then
    love.graphics.push()
    love.graphics.translate(-scrollX, -scrollY)
  end

  -- Paint children with propagated opacity and stencil depth
  for _, child in ipairs(paintOrder) do
    Painter.paintNode(child, effectiveOpacity, stencilDepth)
  end

  -- Restore scroll transform
  if isScroll and (scrollX ~= 0 or scrollY ~= 0) then
    love.graphics.pop()
  end

  -- Draw scrollbar indicators for scroll containers
  if isScroll and node.scrollState then
    Painter.drawScrollbars(node, effectiveOpacity)
  end

  -- Restore clipping state
  if useStencil then
    -- Restore stencil test to parent level or clear it
    if stencilDepth > 1 then
      love.graphics.setStencilTest("greater", stencilDepth - 1)
    else
      love.graphics.setStencilTest()
    end
  elseif useScissor then
    love.graphics.setScissor()
  end

  -- Restore transform state
  if didTransform then
    love.graphics.pop()
  end
end

-- ============================================================================
-- Scrollbar rendering
-- ============================================================================

--- Draw scrollbar indicators for a scroll container.
--- Only shown when content actually overflows the viewport.
--- @param node table The scroll container node
--- @param opacity number Effective opacity to apply
function Painter.drawScrollbars(node, opacity)
  local c = node.computed
  local ss = node.scrollState
  if not c or not ss then return end

  local viewportW = c.w
  local viewportH = c.h
  local contentW = ss.contentW or viewportW
  local contentH = ss.contentH or viewportH
  local scrollX = ss.scrollX or 0
  local scrollY = ss.scrollY or 0

  local barThickness = 4
  local barRadius = 2
  local barColor = { 1, 1, 1, 0.3 * opacity }

  -- Vertical scrollbar (right edge)
  if contentH > viewportH then
    local trackH = viewportH
    local thumbH = math.max(20, (viewportH / contentH) * trackH)
    local maxScroll = contentH - viewportH
    local thumbY = c.y + (scrollY / maxScroll) * (trackH - thumbH)
    local thumbX = c.x + viewportW - barThickness - 1

    love.graphics.setColor(barColor)
    love.graphics.rectangle("fill", thumbX, thumbY, barThickness, thumbH, barRadius, barRadius)
  end

  -- Horizontal scrollbar (bottom edge)
  if contentW > viewportW then
    local trackW = viewportW
    local thumbW = math.max(20, (viewportW / contentW) * trackW)
    local maxScroll = contentW - viewportW
    local thumbX = c.x + (scrollX / maxScroll) * (trackW - thumbW)
    local thumbY = c.y + viewportH - barThickness - 1

    love.graphics.setColor(barColor)
    love.graphics.rectangle("fill", thumbX, thumbY, thumbW, barThickness, barRadius, barRadius)
  end
end

-- ============================================================================
-- Public entry point
-- ============================================================================

--- Paint the entire tree. Resets color to white after painting.
function Painter.paint(node)
  if not node then return end
  Painter.paintNode(node)
  love.graphics.setColor(1, 1, 1, 1)
end

return Painter
