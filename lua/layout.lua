--[[
  layout.lua -- Flexbox layout engine

  Computes {x, y, w, h} for every node in the retained tree.
  Supports:
    - Absolute units, percentages, vw/vh
    - flexDirection row/column
    - flexWrap: nowrap (default), wrap
    - flexGrow, flexBasis
    - justifyContent: start, center, end, space-between, space-around, space-evenly
    - alignItems: stretch (default), start, center, end
    - alignSelf: auto, start, center, end, stretch (per-child override)
    - padding (all sides + per-side)
    - margin (all sides + per-side)
    - gap (applies between items on a line AND between lines when wrapping)
    - display: flex (default), none (skip node entirely)
    - minWidth / maxWidth / minHeight / maxHeight clamping
    - Intrinsic text measurement for Text/__TEXT__ nodes
    - Padding-aware text wrapping (inner width used as constraint)
    - Re-measurement of text height after flex distribution
    - Nested Text node content resolution
    - Custom font family inheritance for text measurement
    - lineHeight, letterSpacing, numberOfLines text properties
]]

local Measure = nil  -- Injected at init time via Layout.init()

local Layout = {}

--- Initialize the layout engine with target-specific dependencies.
--- Must be called before any layout operations.
--- @param config table  { measure = MeasureModule }
function Layout.init(config)
  config = config or {}
  Measure = config.measure
end

-- ============================================================================
-- Unit resolution
-- ============================================================================

--- Resolve a style value to a pixel number.
--- Handles: plain number, "50%", "10vw", "5vh", bare numeric strings.
--- Returns nil when value is nil or unparseable.
function Layout.resolveUnit(value, parentSize)
  if value == nil then return nil end
  if type(value) == "number" then return value end
  if type(value) ~= "string" then return nil end

  local num, unit = value:match("^([%d%.]+)(.*)$")
  num = tonumber(num)
  if not num then return nil end

  if unit == "%" then
    return (num / 100) * (parentSize or 0)
  elseif unit == "vw" then
    return (num / 100) * love.graphics.getWidth()
  elseif unit == "vh" then
    return (num / 100) * love.graphics.getHeight()
  end

  -- bare number or unknown unit -- treat as pixels
  return num
end

-- ============================================================================
-- Text content resolution
-- ============================================================================

--- Recursively collect text content from a node and its descendants.
--- Handles nested Text nodes (e.g. <Text>Hello <Text>World</Text></Text>)
--- by concatenating all text from __TEXT__ and nested Text children.
local function collectTextContent(node)
  if node.type == "__TEXT__" then
    return node.text or ""
  end

  local children = node.children or {}
  if #children > 0 then
    local parts = {}
    for _, child in ipairs(children) do
      if child.type == "__TEXT__" and child.text then
        parts[#parts + 1] = child.text
      elseif child.type == "Text" then
        local nested = collectTextContent(child)
        if nested and nested ~= "" then
          parts[#parts + 1] = nested
        end
      end
    end
    if #parts > 0 then
      return table.concat(parts)
    end
  end

  return nil
end

--- Resolve the text content for a node, matching painter.lua's logic.
--- For __TEXT__ nodes, returns node.text.
--- For Text nodes, concatenates __TEXT__ and nested Text children.
--- Returns nil for non-text nodes.
local function resolveTextContent(node)
  if node.type == "__TEXT__" then
    return node.text or ""
  end

  if node.type == "Text" then
    -- Try collecting from children first (handles nested Text nodes)
    local collected = collectTextContent(node)
    if collected then return collected end

    -- Fall back to props.children (direct string content)
    local text = node.text or (node.props and node.props.children) or nil
    if type(text) == "table" then text = table.concat(text) end
    if text then return tostring(text) end
  end

  return nil
end

--- Get the fontSize for a text node, checking the node's own style
--- and walking up to parent Text node if this is a __TEXT__ child.
local function resolveFontSize(node)
  local s = node.style or {}
  if s.fontSize then return s.fontSize end

  -- __TEXT__ nodes inherit fontSize from their parent Text node
  if node.type == "__TEXT__" and node.parent then
    local ps = node.parent.style or {}
    if ps.fontSize then return ps.fontSize end
  end

  return 14  -- default
end

--- Get the fontWeight for a text node, checking the node's own style
--- and walking up to parent Text node if this is a __TEXT__ child.
--- Returns nil when not set.
local function resolveFontWeight(node)
  local s = node.style or {}
  if s.fontWeight then return s.fontWeight end

  if node.type == "__TEXT__" and node.parent then
    local ps = node.parent.style or {}
    if ps.fontWeight then return ps.fontWeight end
  end

  return nil
end

--- Get the fontFamily for a text node, checking the node's own style
--- and walking up to parent Text node if this is a __TEXT__ child.
--- Returns nil for default font.
local function resolveFontFamily(node)
  local s = node.style or {}
  if s.fontFamily then return s.fontFamily end

  -- __TEXT__ nodes inherit fontFamily from their parent Text node
  if node.type == "__TEXT__" and node.parent then
    local ps = node.parent.style or {}
    if ps.fontFamily then return ps.fontFamily end
  end

  return nil
end

--- Get the lineHeight for a text node, checking the node's own style
--- and walking up to parent Text node if this is a __TEXT__ child.
--- Returns nil to use font's natural line height.
local function resolveLineHeight(node)
  local s = node.style or {}
  if s.lineHeight then return s.lineHeight end

  if node.type == "__TEXT__" and node.parent then
    local ps = node.parent.style or {}
    if ps.lineHeight then return ps.lineHeight end
  end

  return nil
end

--- Get the letterSpacing for a text node, checking the node's own style
--- and walking up to parent Text node if this is a __TEXT__ child.
--- Returns nil when not set.
local function resolveLetterSpacing(node)
  local s = node.style or {}
  if s.letterSpacing then return s.letterSpacing end

  if node.type == "__TEXT__" and node.parent then
    local ps = node.parent.style or {}
    if ps.letterSpacing then return ps.letterSpacing end
  end

  return nil
end

--- Get the numberOfLines for a text node, checking node props
--- and walking up to parent Text node if this is a __TEXT__ child.
--- Returns nil when not set.
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
-- Intrinsic text measurement
-- ============================================================================

--- Measure a text node's intrinsic size given an available width constraint.
--- Returns measuredW, measuredH or nil, nil if the node is not a text node.
local function measureTextNode(node, availW)
  local text = resolveTextContent(node)
  if not text then return nil, nil end

  local fontSize = resolveFontSize(node)
  local fontFamily = resolveFontFamily(node)
  local fontWeight = resolveFontWeight(node)
  local lineHeight = resolveLineHeight(node)
  local letterSpacing = resolveLetterSpacing(node)
  local numberOfLines = resolveNumberOfLines(node)

  local result = Measure.measureText(text, fontSize, availW, fontFamily, lineHeight, letterSpacing, numberOfLines, fontWeight)
  return result.width, result.height
end

-- ============================================================================
-- Size clamping
-- ============================================================================

--- Clamp a dimension value using min/max constraints.
--- Returns the clamped value.
local function clampDim(value, minVal, maxVal)
  if minVal and value < minVal then value = minVal end
  if maxVal and value > maxVal then value = maxVal end
  return value
end

-- ============================================================================
-- Cross-axis alignment helper
-- ============================================================================

--- Determine the effective cross-axis alignment for a child.
--- Uses child's alignSelf if set (and not "auto"), else falls back to
--- the parent's alignItems value.
local function effectiveAlign(parentAlign, childStyle)
  local selfAlign = childStyle and childStyle.alignSelf
  if selfAlign and selfAlign ~= "auto" then
    return selfAlign
  end
  return parentAlign
end

-- ============================================================================
-- Intrinsic size estimation (auto-sizing)
-- ============================================================================

--- Estimate intrinsic (content-based) size of a container.
--- Recursively measures children bottom-up, then adds padding/gaps.
--- Used for auto-sizing containers when no explicit dimensions are set.
---
--- @param node table  The node to measure
--- @param isRow boolean  true = measure width, false = measure height
--- @param pw number|nil  Parent width (for percentage resolution)
--- @param ph number|nil  Parent height (for percentage resolution)
--- @return number  Estimated size in pixels
local function estimateIntrinsicMain(node, isRow, pw, ph)
  local s = node.style or {}
  local ru = Layout.resolveUnit

  -- 1. Calculate padding along the measurement axis
  local pad = ru(s.padding, isRow and pw or ph) or 0
  local padStart = isRow and (ru(s.paddingLeft, pw) or pad)
                          or (ru(s.paddingTop, ph) or pad)
  local padEnd = isRow and (ru(s.paddingRight, pw) or pad)
                        or (ru(s.paddingBottom, ph) or pad)
  local padMain = padStart + padEnd

  -- 2. Text nodes: measure with font metrics
  local isTextNode = (node.type == "Text" or node.type == "__TEXT__")
  if isTextNode then
    local text = resolveTextContent(node)
    if text and text ~= "" then
      local fontSize = resolveFontSize(node)
      local fontFamily = resolveFontFamily(node)
      local fontWeight = resolveFontWeight(node)
      local lineHeight = resolveLineHeight(node)
      local letterSpacing = resolveLetterSpacing(node)
      local numberOfLines = resolveNumberOfLines(node)

      -- Measure with no width constraint (natural width)
      local result = Measure.measureText(text, fontSize, nil, fontFamily,
                                        lineHeight, letterSpacing, numberOfLines, fontWeight)
      return (isRow and result.width or result.height) + padMain
    end
    return padMain  -- Empty text
  end

  -- 3. Container nodes: recursively estimate from children
  local children = node.children or {}
  if #children == 0 then
    return padMain  -- Empty container
  end

  local gap = ru(s.gap, isRow and pw or ph) or 0
  local direction = s.flexDirection or "column"
  local containerIsRow = (direction == "row")

  -- 4. Sum (main axis) or max (cross axis) children
  if (isRow and containerIsRow) or (not isRow and not containerIsRow) then
    -- Main axis: sum children + gaps
    local sum = 0
    for _, child in ipairs(children) do
      local cs = child.style or {}
      local explicitMain = isRow and ru(cs.width, pw) or ru(cs.height, ph)

      if explicitMain then
        sum = sum + explicitMain
      else
        -- Recursive: measure child's intrinsic size
        sum = sum + estimateIntrinsicMain(child, isRow, pw, ph)
      end
    end
    local totalGaps = math.max(0, #children - 1) * gap
    return padMain + sum + totalGaps
  else
    -- Cross axis: take max of children
    local max = 0
    for _, child in ipairs(children) do
      local size = estimateIntrinsicMain(child, isRow, pw, ph)
      if size > max then max = size end
    end
    return padMain + max
  end
end

-- ============================================================================
-- Recursive layout
-- ============================================================================

--- Lay out a single node and all of its descendants.
--- px, py  = parent's content origin (top-left)
--- pw, ph  = available width and height from parent
function Layout.layoutNode(node, px, py, pw, ph)
  if not node then return end
  local s = node.style or {}

  -- ==================================================================
  -- display:none -- skip this node entirely, give it zero-size computed rect.
  -- Its children are NOT laid out.
  -- ==================================================================
  if s.display == "none" then
    node.computed = { x = px, y = py, w = 0, h = 0 }
    return
  end

  local ru = Layout.resolveUnit

  -- Resolve min/max constraints
  local minW = ru(s.minWidth, pw)
  local maxW = ru(s.maxWidth, pw)
  local minH = ru(s.minHeight, ph)
  local maxH = ru(s.maxHeight, ph)

  -- Own dimensions
  local explicitW = ru(s.width, pw)
  local explicitH = ru(s.height, ph)

  local w, h

  -- Width resolution with auto-sizing
  if explicitW then
    w = explicitW
  elseif pw then
    w = pw  -- Use parent's available width
  else
    -- No explicit width and no parent width: auto-size from content
    w = estimateIntrinsicMain(node, true, pw, ph)
  end

  -- Height resolution - use existing deferred auto-height behavior
  -- (computed later after laying out children, lines 864-890)
  h = explicitH

  -- aspectRatio: compute missing dimension from the other
  local ar = s.aspectRatio
  if ar and ar > 0 then
    if explicitW and not h then
      h = explicitW / ar
    elseif h and not explicitW then
      w = h * ar
    end
  end

  -- Flex-adjusted width: if parent's flex algorithm (grow/shrink) assigned
  -- a different main-axis size, use it instead of explicitW so the child
  -- respects the flex distribution.
  if node._flexW then
    w = node._flexW
    node._flexW = nil
  end

  -- Flex-stretch: if parent assigned a cross-axis dimension, use it
  -- so innerH is correct for children and auto-sizing doesn't override it.
  if h == nil and node._stretchH then
    h = node._stretchH
  end
  node._stretchH = nil

  -- Resolve padding early so text measurement can use inner width.
  -- We use the outer width for percentage-based padding resolution.
  local pad  = ru(s.padding, w) or 0
  local padL = ru(s.paddingLeft, w)   or pad
  local padR = ru(s.paddingRight, w)  or pad
  local padT = ru(s.paddingTop, h)    or pad
  local padB = ru(s.paddingBottom, h) or pad

  -- For text nodes without explicit dimensions, measure intrinsic size.
  -- Use inner width (after padding) as the wrap constraint so the text
  -- wraps correctly inside the padding box.
  local isTextNode = (node.type == "Text" or node.type == "__TEXT__")
  if isTextNode then
    if not explicitW or not explicitH then
      -- The wrap constraint is the inner width (outer minus padding)
      local outerConstraint = explicitW or pw or 0

      -- When maxWidth is set and no explicit width, clamp the constraint
      if not explicitW and maxW then
        outerConstraint = math.min(outerConstraint, maxW)
      end

      local constrainW = outerConstraint - padL - padR
      if constrainW < 0 then constrainW = 0 end

      local mw, mh = measureTextNode(node, constrainW)
      if mw and mh then
        if not explicitW then
          -- Node width = measured text width + padding
          w = mw + padL + padR
        end
        if not explicitH then
          -- Node height = measured text height + padding
          h = mh + padT + padB
        end
      end
    end
  end

  -- Apply min/max width clamping.
  -- If clamping width changes a text node's width, re-measure height.
  local wBefore = w
  w = clampDim(w, minW, maxW)
  if isTextNode and w ~= wBefore and not explicitH then
    local innerConstraint = w - padL - padR
    if innerConstraint < 0 then innerConstraint = 0 end
    local _, mh = measureTextNode(node, innerConstraint)
    if mh then
      h = mh + padT + padB
    end
  end

  -- Apply min/max height clamping
  if h then
    h = clampDim(h, minH, maxH)
  end

  -- Margin (all four sides)
  local mar  = ru(s.margin, pw) or 0
  local marL = ru(s.marginLeft, pw)  or mar
  local marR = ru(s.marginRight, pw) or mar
  local marT = ru(s.marginTop, ph)   or mar
  local marB = ru(s.marginBottom, ph) or mar

  local x = px + marL
  local y = py + marT
  local innerW = w - padL - padR
  local innerH = (h or 9999) - padT - padB

  -- Flex properties
  local isRow   = s.flexDirection == "row"
  local gap     = ru(s.gap, isRow and innerW or innerH) or 0
  local justify = s.justifyContent or "start"
  local align   = s.alignItems or "stretch"
  local wrap    = s.flexWrap == "wrap"

  local mainSize  = isRow and innerW or innerH

  -- ====================================================================
  -- Filter visible children and measure them
  -- ====================================================================
  local allChildren = node.children or {}
  local visibleIndices = {}  -- list of indices into allChildren for visible kids
  local childInfos = {}      -- keyed by index in allChildren

  for i, child in ipairs(allChildren) do
    local cs = child.style or {}

    -- display:none children are completely skipped from layout
    if cs.display == "none" then
      child.computed = { x = 0, y = 0, w = 0, h = 0 }
    else
      visibleIndices[#visibleIndices + 1] = i

      local cw   = ru(cs.width, innerW)
      local ch   = ru(cs.height, innerH)
      local grow   = cs.flexGrow or 0
      local shrink = cs.flexShrink

      -- Resolve child min/max constraints
      local cMinW = ru(cs.minWidth, innerW)
      local cMaxW = ru(cs.maxWidth, innerW)
      local cMinH = ru(cs.minHeight, innerH)
      local cMaxH = ru(cs.maxHeight, innerH)

      -- Resolve child padding for text measurement
      local childIsText = (child.type == "Text" or child.type == "__TEXT__")
      local cpad  = ru(cs.padding, innerW) or 0
      local cpadL = ru(cs.paddingLeft, innerW)  or cpad
      local cpadR = ru(cs.paddingRight, innerW) or cpad
      local cpadT = ru(cs.paddingTop, innerH)   or cpad
      local cpadB = ru(cs.paddingBottom, innerH) or cpad

      -- For text children without explicit dimensions, measure intrinsic size
      if childIsText and (not cw or not ch) then
        local outerConstraint = cw or innerW

        -- When maxWidth is set and no explicit width, clamp the constraint
        if not cw and cMaxW then
          outerConstraint = math.min(outerConstraint, cMaxW)
        end

        local constrainW = outerConstraint - cpadL - cpadR
        if constrainW < 0 then constrainW = 0 end

        local mw, mh = measureTextNode(child, constrainW)
        if mw and mh then
          if not cw then cw = mw + cpadL + cpadR end
          if not ch then ch = mh + cpadT + cpadB end
        end
      end

      -- Apply min/max width clamping to child.
      -- If clamping width changes a text node's width, re-measure height.
      if cw then
        local cwBefore = cw
        cw = clampDim(cw, cMinW, cMaxW)
        if childIsText and cw ~= cwBefore and not ru(cs.height, innerH) then
          local constrainW = cw - cpadL - cpadR
          if constrainW < 0 then constrainW = 0 end
          local _, mh = measureTextNode(child, constrainW)
          if mh then
            ch = mh + cpadT + cpadB
          end
        end
      end

      -- Apply min/max height clamping to child
      if ch then
        ch = clampDim(ch, cMinH, cMaxH)
      end

      -- Resolve child margins
      local cmar  = ru(cs.margin, isRow and innerW or innerH) or 0
      local cmarL = ru(cs.marginLeft, innerW)  or cmar
      local cmarR = ru(cs.marginRight, innerW) or cmar
      local cmarT = ru(cs.marginTop, innerH)   or cmar
      local cmarB = ru(cs.marginBottom, innerH) or cmar

      -- Main-axis margins
      local mainMarginStart, mainMarginEnd
      if isRow then
        mainMarginStart = cmarL
        mainMarginEnd   = cmarR
      else
        mainMarginStart = cmarT
        mainMarginEnd   = cmarB
      end

      -- Determine basis: flexBasis takes priority over width/height
      local basis
      local fbRaw = cs.flexBasis
      if fbRaw ~= nil and fbRaw ~= "auto" then
        local mainParentSize = isRow and innerW or innerH
        basis = ru(fbRaw, mainParentSize) or 0
      else
        -- "auto" or not set: fall back to width/height
        basis = isRow and (cw or 0) or (ch or 0)
      end

      -- aspectRatio: compute missing dimension from the other
      local ar = cs.aspectRatio
      if ar and ar > 0 then
        if cw and not ch then
          ch = cw / ar
        elseif ch and not cw then
          cw = ch * ar
        end
      end

      childInfos[i] = {
        w = cw, h = ch, grow = grow, shrink = shrink, basis = basis,
        marL = cmarL, marR = cmarR, marT = cmarT, marB = cmarB,
        mainMarginStart = mainMarginStart, mainMarginEnd = mainMarginEnd,
        isText = childIsText,
        explicitH = ru(cs.height, innerH),
        padL = cpadL, padR = cpadR, padT = cpadT, padB = cpadB,
        minW = cMinW, maxW = cMaxW, minH = cMinH, maxH = cMaxH,
      }
    end
  end

  local numVisible = #visibleIndices

  -- ====================================================================
  -- Split children into flex lines
  -- ====================================================================
  -- Each line is a list of indices into allChildren (visible only).
  -- When flexWrap is "nowrap" (default), all visible children go on one line.

  local lines = {}

  if not wrap or numVisible == 0 then
    -- Single line (nowrap): all visible children on one line
    local line = {}
    for _, idx in ipairs(visibleIndices) do
      line[#line + 1] = idx
    end
    lines[1] = line
  else
    -- Wrap mode: split children into lines based on available main-axis space
    local currentLine = {}
    local lineMain = 0  -- accumulated main-axis usage on current line

    for _, idx in ipairs(visibleIndices) do
      local ci = childInfos[idx]
      local itemMain = ci.basis + ci.mainMarginStart + ci.mainMarginEnd

      -- Add gap if this isn't the first item on the line
      local gapBefore = (#currentLine > 0) and gap or 0

      if #currentLine > 0 and (lineMain + gapBefore + itemMain) > mainSize then
        -- This item overflows -- start a new line
        lines[#lines + 1] = currentLine
        currentLine = { idx }
        lineMain = itemMain
      else
        currentLine[#currentLine + 1] = idx
        lineMain = lineMain + gapBefore + itemMain
      end
    end

    -- Don't forget the last line
    if #currentLine > 0 then
      lines[#lines + 1] = currentLine
    end
  end

  -- ====================================================================
  -- Process each flex line: distribute, re-measure, justify, position
  -- ====================================================================
  local crossCursor = 0  -- tracks position along the cross axis across lines
  local contentMainEnd = 0   -- furthest main-axis extent (for auto-sizing)
  local contentCrossEnd = 0  -- furthest cross-axis extent (for auto-sizing)

  for lineIdx, line in ipairs(lines) do
    local lineCount = #line

    -- ----------------------------------------------------------------
    -- Flex-grow / flex-shrink distribution within this line
    -- ----------------------------------------------------------------
    local lineTotalBasis = 0
    local lineTotalFlex = 0
    local lineTotalMarginMain = 0

    for _, idx in ipairs(line) do
      local ci = childInfos[idx]
      lineTotalMarginMain = lineTotalMarginMain + ci.mainMarginStart + ci.mainMarginEnd
      lineTotalBasis = lineTotalBasis + ci.basis
      if ci.grow > 0 then
        lineTotalFlex = lineTotalFlex + ci.grow
      end
    end

    local lineGaps = math.max(0, lineCount - 1) * gap
    local lineAvail = mainSize - lineTotalBasis - lineGaps - lineTotalMarginMain

    if lineAvail > 0 and lineTotalFlex > 0 then
      -- Positive free space: distribute to flex-grow items
      for _, idx in ipairs(line) do
        local ci = childInfos[idx]
        if ci.grow > 0 then
          ci.basis = ci.basis + (ci.grow / lineTotalFlex) * lineAvail
        end
      end
    elseif lineAvail < 0 then
      -- Negative free space: shrink items proportional to flexShrink * basis
      -- Default flexShrink is 1 (CSS spec) unless explicitly set to 0
      local totalShrinkScaled = 0
      for _, idx in ipairs(line) do
        local ci = childInfos[idx]
        local sh = ci.shrink
        if sh == nil then sh = 1 end  -- CSS default
        totalShrinkScaled = totalShrinkScaled + sh * ci.basis
      end
      if totalShrinkScaled > 0 then
        local overflow = -lineAvail
        for _, idx in ipairs(line) do
          local ci = childInfos[idx]
          local sh = ci.shrink
          if sh == nil then sh = 1 end
          local shrinkAmount = (sh * ci.basis / totalShrinkScaled) * overflow
          ci.basis = math.max(0, ci.basis - shrinkAmount)
        end
      end
    end

    -- ----------------------------------------------------------------
    -- Re-measure text nodes after flex distribution
    -- ----------------------------------------------------------------
    -- Flex grow may have changed a text node's width. If the node has no
    -- explicit height, re-measure with the new width so the wrapped height
    -- is correct.
    for _, idx in ipairs(line) do
      local child = allChildren[idx]
      local ci = childInfos[idx]
      if ci.isText and ci.grow > 0 and not ci.explicitH then
        local finalW
        if isRow then
          finalW = ci.basis
        else
          finalW = ci.w or innerW
        end

        -- Apply min/max clamping to the final width
        finalW = clampDim(finalW, ci.minW, ci.maxW)

        local prevW = ci.w or 0
        if math.abs(finalW - prevW) > 0.5 then
          local constrainW = finalW - ci.padL - ci.padR
          if constrainW < 0 then constrainW = 0 end
          local _, mh = measureTextNode(child, constrainW)
          if mh then
            local newH = mh + ci.padT + ci.padB
            newH = clampDim(newH, ci.minH, ci.maxH)
            ci.h = newH
            ci.w = finalW
            -- In column layout, update the basis to reflect new height
            if not isRow then
              ci.basis = newH
            end
          end
        end
      end
    end

    -- ----------------------------------------------------------------
    -- Compute the cross-axis size for this line
    -- (maximum cross-axis extent of all children on this line)
    -- ----------------------------------------------------------------
    local lineCrossSize = 0
    for _, idx in ipairs(line) do
      local ci = childInfos[idx]
      local childCross
      if isRow then
        childCross = (ci.h or 0) + ci.marT + ci.marB
      else
        childCross = (ci.w or 0) + ci.marL + ci.marR
      end
      if childCross > lineCrossSize then
        lineCrossSize = childCross
      end
    end

    -- For single-line (nowrap), the line cross size is the full cross-axis
    -- available space, so that alignItems stretch/center/end work relative
    -- to the container, not just the tallest child.
    -- Only when the cross-axis has a definite size (not the 9999 fallback).
    if not wrap then
      local fullCross
      if isRow and h then
        -- Row: cross-axis is height; only use if h is definite (not auto)
        fullCross = innerH
      elseif not isRow then
        -- Column: cross-axis is width; always definite (falls back to pw)
        fullCross = innerW
      end
      if fullCross and fullCross > lineCrossSize then
        lineCrossSize = fullCross
      end
    end

    -- ----------------------------------------------------------------
    -- JustifyContent: compute main-axis offset and extra gap for this line
    -- ----------------------------------------------------------------
    local lineUsedMain = 0
    for _, idx in ipairs(line) do
      local ci = childInfos[idx]
      lineUsedMain = lineUsedMain + ci.basis + ci.mainMarginStart + ci.mainMarginEnd
    end
    local lineFreeMain = mainSize - lineUsedMain - lineGaps
    local lineMainOff, lineExtraGap = 0, 0

    -- Only apply justifyContent distribution when the main axis has a
    -- definite size. For auto-sized containers (h == nil in column layout,
    -- or explicitW == nil in row layout), centering/spacing is meaningless
    -- because the container will shrink-wrap to its content. Without this
    -- guard, the 9999 auto-height fallback produces enormous offsets that
    -- push content off-screen.
    local hasDefiniteMainAxis = isRow or (explicitH ~= nil)

    if hasDefiniteMainAxis then
      if justify == "center" then
        lineMainOff = lineFreeMain / 2
      elseif justify == "end" then
        lineMainOff = lineFreeMain
      elseif justify == "space-between" and lineCount > 1 then
        lineExtraGap = lineFreeMain / (lineCount - 1)
      elseif justify == "space-around" and lineCount > 0 then
        lineExtraGap = lineFreeMain / lineCount
        lineMainOff = lineExtraGap / 2
      elseif justify == "space-evenly" and lineCount > 0 then
        lineExtraGap = lineFreeMain / (lineCount + 1)
        lineMainOff = lineExtraGap
      end
    end

    -- ----------------------------------------------------------------
    -- Position children on this line
    -- ----------------------------------------------------------------
    local cursor = lineMainOff

    for _, idx in ipairs(line) do
      local child = allChildren[idx]
      local ci = childInfos[idx]
      local cs = child.style or {}
      local cx, cy, cw_final, ch_final

      -- Determine effective alignment for this child (alignSelf or parent alignItems)
      local childAlign = effectiveAlign(align, cs)

      -- Advance cursor past the child's leading main-axis margin
      cursor = cursor + ci.mainMarginStart

      if isRow then
        cx = x + padL + cursor
        cw_final = ci.basis
        ch_final = ci.h or lineCrossSize

        -- Apply min/max clamping to final dimensions
        cw_final = clampDim(cw_final, ci.minW, ci.maxW)
        ch_final = clampDim(ch_final, ci.minH, ci.maxH)

        -- Cross-axis margins reduce the available space for alignment
        local crossAvail = lineCrossSize - ci.marT - ci.marB

        if childAlign == "center" then
          cy = y + padT + crossCursor + ci.marT + (crossAvail - ch_final) / 2
        elseif childAlign == "end" then
          cy = y + padT + crossCursor + ci.marT + crossAvail - ch_final
        elseif childAlign == "stretch" then
          cy = y + padT + crossCursor + ci.marT
          if ci.explicitH == nil then
            ch_final = clampDim(crossAvail, ci.minH, ci.maxH)
          end
        else  -- "start" or default
          cy = y + padT + crossCursor + ci.marT
        end
      else
        cy = y + padT + cursor
        ch_final = ci.basis
        cw_final = ci.w or lineCrossSize

        -- Apply min/max clamping to final dimensions
        cw_final = clampDim(cw_final, ci.minW, ci.maxW)
        ch_final = clampDim(ch_final, ci.minH, ci.maxH)

        -- Cross-axis margins reduce the available space for alignment
        local crossAvail = lineCrossSize - ci.marL - ci.marR

        if childAlign == "center" then
          cx = x + padL + crossCursor + ci.marL + (crossAvail - cw_final) / 2
        elseif childAlign == "end" then
          cx = x + padL + crossCursor + ci.marL + crossAvail - cw_final
        elseif childAlign == "stretch" then
          cx = x + padL + crossCursor + ci.marL
          cw_final = clampDim(crossAvail, ci.minW, ci.maxW)
        else  -- "start" or default
          cx = x + padL + crossCursor + ci.marL
        end
      end

      -- Signal flex-adjusted main-axis size to child so its layoutNode
      -- uses the flex-distributed size instead of its own explicit dimension.
      -- Row: flex adjusts width; Column: flex adjusts height.
      if isRow then
        local explicitChildW = ru(cs.width, innerW)
        if explicitChildW and cw_final ~= explicitChildW then
          child._flexW = cw_final
        end
      else
        local explicitChildH = ru(cs.height, innerH)
        if explicitChildH and ch_final ~= explicitChildH then
          child._stretchH = ch_final
        end
      end

      -- Signal parent-determined height to child so its layoutNode uses it
      -- instead of auto-sizing (which would give 0 for scroll containers, etc.)
      -- Covers: row cross-axis stretch, column main-axis flex-grow
      if ci.explicitH == nil then
        if isRow and childAlign == "stretch" then
          child._stretchH = ch_final
        elseif not isRow and ci.grow > 0 then
          child._stretchH = ch_final
        end
      end

      child.computed = { x = cx, y = cy, w = cw_final, h = ch_final }
      Layout.layoutNode(child, cx, cy, cw_final, ch_final)

      -- Use actual computed size after layout (handles auto-sized containers
      -- whose basis was 0 because content size wasn't known pre-layout)
      local actualMainSize
      if isRow then
        actualMainSize = child.computed and child.computed.w or ci.basis
      else
        actualMainSize = child.computed and child.computed.h or ci.basis
      end

      -- Advance cursor past the child's content + trailing margin + gap
      cursor = cursor + actualMainSize + ci.mainMarginEnd + gap + lineExtraGap

      -- Track content extents for auto-sizing
      if isRow then
        local mainEnd = (cx - x) + (child.computed and child.computed.w or cw_final) + ci.marR
        local crossEnd = crossCursor + (child.computed and child.computed.h or ch_final) + ci.marT + ci.marB
        if mainEnd > contentMainEnd then contentMainEnd = mainEnd end
        if crossEnd > contentCrossEnd then contentCrossEnd = crossEnd end
      else
        local mainEnd = (cy - y) + (child.computed and child.computed.h or ch_final) + ci.marB
        local crossEnd = crossCursor + (child.computed and child.computed.w or cw_final) + ci.marL + ci.marR
        if mainEnd > contentMainEnd then contentMainEnd = mainEnd end
        if crossEnd > contentCrossEnd then contentCrossEnd = crossEnd end
      end
    end

    -- Advance cross cursor past this line + inter-line gap
    crossCursor = crossCursor + lineCrossSize
    if lineIdx < #lines then
      crossCursor = crossCursor + gap
    end
  end

  -- ====================================================================
  -- Auto-height: shrink to content
  -- ====================================================================
  -- For scroll containers with no explicit height, do NOT auto-size to
  -- content (that defeats scrolling). Default to 0 so the container must
  -- get its height from an explicit value or flex-grow.
  local isScrollContainer = s.overflow == "scroll"

  if h == nil then
    if isScrollContainer then
      -- Scroll containers without explicit height default to 0.
      -- They need an explicit height or flex-grow to have visible area.
      h = 0
    elseif isRow then
      -- Row direction: main axis is horizontal, cross axis is vertical.
      -- Auto height = total cross-axis extent (sum of line heights + gaps).
      h = crossCursor + padT + padB
    else
      -- Column direction: main axis is vertical.
      -- Auto height = furthest main-axis child end.
      h = contentMainEnd + padT + padB
    end
  end

  -- Final min/max height clamping for auto-height
  h = clampDim(h, minH, maxH)

  node.computed = { x = x, y = y, w = w, h = h }

  -- ====================================================================
  -- Scroll state: track content dimensions for scroll containers
  -- ====================================================================
  if isScrollContainer then
    -- Compute total content dimensions (bounding box of all children)
    local contentW, contentH
    if isRow then
      contentW = contentMainEnd + padL + padR
      contentH = contentCrossEnd + padT + padB
    else
      contentW = contentCrossEnd + padL + padR
      contentH = contentMainEnd + padT + padB
    end

    -- Preserve existing scroll position, or initialize from style props
    local prevState = node.scrollState
    local scrollX = prevState and prevState.scrollX or (s.scrollX or 0)
    local scrollY = prevState and prevState.scrollY or (s.scrollY or 0)

    -- If style has explicit scroll values, use those (controlled mode)
    if s.scrollX then scrollX = s.scrollX end
    if s.scrollY then scrollY = s.scrollY end

    -- Clamp scroll positions
    local maxScrollX = math.max(0, contentW - w)
    local maxScrollY = math.max(0, contentH - h)
    scrollX = math.max(0, math.min(scrollX, maxScrollX))
    scrollY = math.max(0, math.min(scrollY, maxScrollY))

    node.scrollState = {
      scrollX = scrollX,
      scrollY = scrollY,
      contentW = contentW,
      contentH = contentH,
    }
  end
end

-- ============================================================================
-- Convenience entry point
-- ============================================================================

--- Lay out the entire tree starting from the root node.
--- x, y default to 0; w, h default to the window dimensions.
---
--- Smart default: the root node fills the viewport when it has no
--- explicit width or height.  This eliminates the requirement to write
--- `width: '100%', height: '100%'` on the outermost container.
function Layout.layout(node, x, y, w, h)
  x = x or 0
  y = y or 0
  w = w or love.graphics.getWidth()
  h = h or love.graphics.getHeight()

  -- Root auto-fill: if the root has no explicit dimensions, tell
  -- layoutNode to use the viewport size via the same signals that the
  -- flex algorithm uses for parent-determined sizing.
  local s = node.style or {}
  if not s.width  then node._flexW    = w end
  if not s.height then node._stretchH = h end

  Layout.layoutNode(node, x, y, w, h)
end

return Layout
