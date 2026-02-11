--[[
  Bridge: Love2D <-> React communication layer (Module.FS transport)

  love.js compiles Love2D to WASM with Emscripten. Both Lua and JS
  share Module.FS -- an in-memory filesystem. No js.global:eval(),
  no custom Emscripten exports, no recompilation.

  Protocol:
    Love2D -> React:  writes __bridge_out.json, JS polls via requestAnimationFrame
    React -> Love2D:  writes __bridge_in.json, Lua polls via love.update

  Both sides batch messages and flush once per frame.
  One write, one read, per tick, per direction. Negligible overhead.
]]

local Bridge = {}

local json = require("lib.json")

-- ============================================================================
-- State
-- ============================================================================

local outbox = {}              -- queued events for React
local commandHandlers = {}     -- React -> Love2D command handlers
local rpcHandlers = {}         -- RPC method handlers
local throttleTimers = {}
local initialized = false
local namespace = "default"    -- for multi-instance support

local INBOX_PATH  = "__bridge_in.json"
local OUTBOX_PATH = "__bridge_out.json"

-- ============================================================================
-- Init
-- ============================================================================

function Bridge.init(ns)
  namespace = ns or "default"

  -- Namespace the file paths for multi-instance support
  if namespace ~= "default" then
    INBOX_PATH  = "__bridge_" .. namespace .. "_in.json"
    OUTBOX_PATH = "__bridge_" .. namespace .. "_out.json"
  end

  -- Clean up any stale files from previous session
  if love.filesystem.getInfo(INBOX_PATH) then
    love.filesystem.remove(INBOX_PATH)
  end
  if love.filesystem.getInfo(OUTBOX_PATH) then
    love.filesystem.remove(OUTBOX_PATH)
  end

  initialized = true

  -- Signal ready by writing a ready file React can check
  love.filesystem.write("__bridge_" .. namespace .. "_ready", "1")

  print("[Bridge] Initialized -- namespace: " .. namespace .. " | transport: Module.FS")
end

function Bridge.getNamespace()
  return namespace
end

-- ============================================================================
-- React -> Love2D: Poll inbox
-- Call once per frame in love.update
-- ============================================================================

function Bridge.poll()
  if not initialized then return end

  if not love.filesystem.getInfo(INBOX_PATH) then return end

  local raw = love.filesystem.read(INBOX_PATH)
  love.filesystem.remove(INBOX_PATH)

  if not raw or raw == "" then return end

  local ok, commands = pcall(json.decode, raw)
  if not ok or not commands then
    print("[Bridge] Failed to decode inbox: " .. tostring(commands))
    return
  end

  for _, cmd in ipairs(commands) do
    if cmd.type == "rpc:call" then
      Bridge._handleRPC(cmd.payload)
    elseif commandHandlers[cmd.type] then
      local success, err = pcall(commandHandlers[cmd.type], cmd.payload)
      if not success then
        print("[Bridge] Handler error '" .. cmd.type .. "': " .. tostring(err))
      end
    end
  end
end

--- Register a command handler
function Bridge.on(commandType, handler)
  commandHandlers[commandType] = handler
end

function Bridge.off(commandType)
  commandHandlers[commandType] = nil
end

-- ============================================================================
-- Love2D -> React: Queue and flush outbox
-- Call Bridge.flush() once per frame, after all emits
-- ============================================================================

--- Queue an event for React. Batched, not sent immediately.
function Bridge.emit(eventType, payload)
  outbox[#outbox + 1] = { type = eventType, payload = payload }
end

--- Throttled emit -- deduplicates by type within the interval.
function Bridge.emitThrottled(eventType, payload, interval)
  local now = love.timer.getTime()
  if (now - (throttleTimers[eventType] or 0)) >= interval then
    throttleTimers[eventType] = now
    Bridge.emit(eventType, payload)
  end
end

--- Write all queued events to the outbox file. Call once per frame.
function Bridge.flush()
  if not initialized or #outbox == 0 then return end

  local ok, encoded = pcall(json.encode, outbox)
  if ok then
    love.filesystem.write(OUTBOX_PATH, encoded)
  else
    print("[Bridge] Failed to encode outbox: " .. tostring(encoded))
  end
  outbox = {}
end

-- ============================================================================
-- RPC: Request/Response
-- ============================================================================

function Bridge.rpc(method, handler)
  rpcHandlers[method] = handler
end

function Bridge._handleRPC(payload)
  if not payload or not payload.method or not payload.id then return end

  local handler = rpcHandlers[payload.method]
  if not handler then
    Bridge.emit("rpc:" .. payload.id, { error = "Unknown method: " .. payload.method })
    return
  end

  local ok, result = pcall(handler, payload.args)
  if ok then
    Bridge.emit("rpc:" .. payload.id, { result = result })
  else
    Bridge.emit("rpc:" .. payload.id, { error = tostring(result) })
  end
end

-- ============================================================================
-- Overlay helpers
-- ============================================================================

function Bridge.worldToOverlay(worldX, worldY, camera)
  local screenX, screenY
  if camera and camera.worldToScreen then
    screenX, screenY = camera:worldToScreen(worldX, worldY)
  else
    screenX, screenY = worldX, worldY
  end
  local lw, lh = love.graphics.getDimensions()
  return { nx = screenX / lw, ny = screenY / lh, px = screenX, py = screenY }
end

function Bridge.emitOverlays(overlays)
  Bridge.emitThrottled("overlays", overlays, 1/30)
end

function Bridge.emitCanvasInfo()
  local w, h = love.graphics.getDimensions()
  Bridge.emit("canvas:info", {
    logicalWidth = w,
    logicalHeight = h,
    dpiScale = love.window.getDPIScale(),
    namespace = namespace,
  })
end

return Bridge
