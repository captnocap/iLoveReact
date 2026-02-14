--[[
  tree.lua -- Retained element tree + command interpreter

  This is the "DOM equivalent" for react-love. The React reconciler on the JS
  side sends mutation commands (CREATE, APPEND, UPDATE, REMOVE, etc.) and this
  module applies them to build and maintain an in-memory tree of UI nodes.

  The layout engine and painter operate on this tree.
]]

local Images = nil    -- Injected at init time via Tree.init()
local Videos = nil    -- Injected at init time via Tree.init()
local Animate = nil   -- Injected at init time via Tree.init()

local Tree = {}

-- ============================================================================
-- State
-- ============================================================================

local nodes = {}          -- id -> node
local rootChildren = {}   -- ordered list of top-level children
local treeDirty = true

-- ============================================================================
-- Internal helpers
-- ============================================================================

--- Recursively remove a node and all its descendants from the nodes table.
local function cleanup(id)
  local n = nodes[id]
  if n then
    -- Unload image if this is an Image node
    if Images and n.type == "Image" and n.props and n.props.src then
      Images.unload(n.props.src)
    end

    -- Unload video if this is a Video node
    if Videos and n.type == "Video" and n.props and n.props.src then
      Videos.untrackNode(id)
      Videos.unload(n.props.src)
    end

    -- Clean up active transitions/animations
    if Animate then
      Animate.onNodeRemoved(id)
    end

    -- Recursively cleanup children
    for _, c in ipairs(n.children) do
      cleanup(c.id)
    end
    nodes[id] = nil
  end
end

-- ============================================================================
-- Public API
-- ============================================================================

--- Initialize tree state with target-specific dependencies.
--- Call once at startup.
--- @param config table|nil  { images = ImagesModule } (images may be nil for targets without image support)
function Tree.init(config)
  config = config or {}
  Images = config.images
  Videos = config.videos
  Animate = config.animate
  nodes = {}
  rootChildren = {}
  treeDirty = true
end

--- Apply an array of mutation commands from the React reconciler.
--- Each command is a table with an `op` field and associated data.
function Tree.applyCommands(commands)
  for _, cmd in ipairs(commands) do
    local op = cmd.op

    if op == "CREATE" then
      local props = cmd.props or {}
      nodes[cmd.id] = {
        id = cmd.id,
        type = cmd.type,
        props = props,
        style = props.style or {},
        hasHandlers = cmd.hasHandlers or false,
        children = {},
        parent = nil,
        computed = nil,
        -- Debug info from React component (for inspector)
        debugName = cmd.debugName,
        debugSource = cmd.debugSource,
      }
      -- Pre-load image and establish ref count
      if Images and cmd.type == "Image" and props.src then
        Images.load(props.src)
      end
      -- Pre-load video and establish ref count (may trigger transcoding)
      if Videos and cmd.type == "Video" and props.src then
        Videos.load(props.src)
        Videos.trackNode(cmd.id, props.src)
      end
      treeDirty = true

    elseif op == "CREATE_TEXT" then
      local textVal = cmd.text
      nodes[cmd.id] = {
        id = cmd.id,
        type = "__TEXT__",
        text = textVal,
        style = {},
        children = {},
        parent = nil,
        computed = nil,
      }
      treeDirty = true

    elseif op == "APPEND" then
      local parent = nodes[cmd.parentId]
      local child = nodes[cmd.childId]
      if parent and child then
        child.parent = parent
        parent.children[#parent.children + 1] = child
        treeDirty = true
      end

    elseif op == "APPEND_TO_ROOT" then
      local child = nodes[cmd.childId]
      if child then
        rootChildren[#rootChildren + 1] = child
        treeDirty = true
      end

    elseif op == "UPDATE" then
      local node = nodes[cmd.id]
      if node and cmd.props then
        -- Handle image src changes: unload old, load new
        if Images and node.type == "Image" and cmd.props.src and cmd.props.src ~= node.props.src then
          if node.props.src then Images.unload(node.props.src) end
          Images.load(cmd.props.src)
        end

        -- Handle video src changes: unload old, load new
        if Videos and node.type == "Video" and cmd.props.src and cmd.props.src ~= node.props.src then
          if node.props.src then Videos.unload(node.props.src) end
          Videos.load(cmd.props.src)
          Videos.updateTrackedNode(cmd.id, cmd.props.src)
        end

        -- Apply changed props (partial diff)
        for k, v in pairs(cmd.props) do
          if k == "style" then
            -- In-place merge style properties (v is a partial style diff)
            if type(v) == "table" then
              if not node.props.style then node.props.style = {} end
              if not node.style then node.style = {} end

              -- Snapshot old values before merge (needed for transitions)
              local oldValues = nil
              if Animate and node.style.transition then
                oldValues = {}
                for sk in pairs(v) do
                  oldValues[sk] = node.style[sk]
                end
              end

              -- Apply the style diff
              for sk, sv in pairs(v) do
                node.style[sk] = sv
                node.props.style[sk] = sv
              end

              -- Set up keyframe animation if the animation prop changed
              if Animate and v.animation then
                Animate.setupAnimation(node, v.animation)
              end

              -- Let animate module process transitions for changed properties
              if Animate and oldValues then
                Animate.processStyleUpdate(node, oldValues, v)
              end
            end
          else
            node.props[k] = v
          end
        end

        -- Handle removed style keys
        if cmd.removeStyleKeys then
          for _, sk in ipairs(cmd.removeStyleKeys) do
            if node.style then node.style[sk] = nil end
            if node.props.style then node.props.style[sk] = nil end
          end
        end

        -- Handle removed non-style keys
        if cmd.removeKeys then
          for _, k in ipairs(cmd.removeKeys) do
            node.props[k] = nil
          end
        end

        -- Update hasHandlers flag
        if cmd.hasHandlers ~= nil then
          node.hasHandlers = cmd.hasHandlers
        end

        treeDirty = true
      end

    elseif op == "UPDATE_TEXT" then
      local node = nodes[cmd.id]
      if node then
        node.text = cmd.text
        treeDirty = true
      end

    elseif op == "REMOVE" then
      local parent = nodes[cmd.parentId]
      if parent then
        for i, c in ipairs(parent.children) do
          if c.id == cmd.childId then
            table.remove(parent.children, i)
            break
          end
        end
      end
      cleanup(cmd.childId)
      treeDirty = true

    elseif op == "REMOVE_FROM_ROOT" then
      for i, c in ipairs(rootChildren) do
        if c.id == cmd.childId then
          table.remove(rootChildren, i)
          break
        end
      end
      cleanup(cmd.childId)
      treeDirty = true

    elseif op == "INSERT_BEFORE" then
      local parent = nodes[cmd.parentId]
      local child = nodes[cmd.childId]
      if parent and child then
        child.parent = parent
        for i, c in ipairs(parent.children) do
          if c.id == cmd.beforeId then
            table.insert(parent.children, i, child)
            treeDirty = true
            break
          end
        end
      end

    elseif op == "INSERT_BEFORE_ROOT" then
      local child = nodes[cmd.childId]
      if child then
        for i, c in ipairs(rootChildren) do
          if c.id == cmd.beforeId then
            table.insert(rootChildren, i, child)
            treeDirty = true
            break
          end
        end
      end

    elseif op == "SCROLL_UPDATE" then
      local node = nodes[cmd.id]
      if node then
        Tree.setScroll(cmd.id, cmd.scrollX or 0, cmd.scrollY or 0)
      end
    end
  end
end

--- Return the root node of the tree.
--- If there is exactly one root child, return it directly.
--- Otherwise wrap rootChildren in a synthetic full-size View.
function Tree.getTree()
  if #rootChildren == 0 then return nil end
  if #rootChildren == 1 then return rootChildren[1] end
  return {
    id = 0,
    type = "View",
    style = { width = "100%", height = "100%" },
    children = rootChildren,
    props = {},
    computed = nil,
  }
end

--- Return the raw nodes table (id -> node).
function Tree.getNodes()
  return nodes
end

--- Return true if the tree has been mutated since the last clearDirty().
function Tree.isDirty()
  return treeDirty
end

--- Clear the dirty flag. Call after layout has been recomputed.
function Tree.clearDirty()
  treeDirty = false
end

--- Force the tree to be marked dirty (e.g. on window resize).
function Tree.markDirty()
  treeDirty = true
end

--- Set the scroll position for a node.
--- Clamps to valid range based on content dimensions.
--- @param nodeId number|string The node ID
--- @param scrollX number Desired horizontal scroll position
--- @param scrollY number Desired vertical scroll position
function Tree.setScroll(nodeId, scrollX, scrollY)
  local node = nodes[nodeId]
  if not node then return end

  -- Initialize scrollState if needed
  if not node.scrollState then
    node.scrollState = { scrollX = 0, scrollY = 0, contentW = 0, contentH = 0 }
  end

  local ss = node.scrollState
  local c = node.computed

  -- Clamp scroll positions
  local maxScrollX = 0
  local maxScrollY = 0
  if c then
    maxScrollX = math.max(0, (ss.contentW or 0) - c.w)
    maxScrollY = math.max(0, (ss.contentH or 0) - c.h)
  end

  ss.scrollX = math.max(0, math.min(scrollX or 0, maxScrollX))
  ss.scrollY = math.max(0, math.min(scrollY or 0, maxScrollY))
end

return Tree
