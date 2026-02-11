--[[
  Neofetch — packaged main.lua

  Self-contained entry point for the dist binary.
  lua/ modules live inside the .love zip, libquickjs.so lives
  in lib/ alongside the binary.
]]

local ReactLove = require("lua.init")

-- ── System info gathering ──────────────────────────────────

local function exec(cmd)
  local h = io.popen(cmd)
  if not h then return nil end
  local out = h:read("*l")
  h:close()
  return out
end

local function readFile(path)
  local f = io.open(path)
  if not f then return nil end
  local content = f:read("*a")
  f:close()
  return content
end

local function formatUptime(seconds)
  local days  = math.floor(seconds / 86400)
  local hours = math.floor((seconds % 86400) / 3600)
  local mins  = math.floor((seconds % 3600) / 60)
  local parts = {}
  if days  > 0 then parts[#parts+1] = days  .. (days  == 1 and " day"  or " days")  end
  if hours > 0 then parts[#parts+1] = hours .. (hours == 1 and " hour" or " hours") end
  if mins  > 0 then parts[#parts+1] = mins  .. (mins  == 1 and " min"  or " mins")  end
  if #parts == 0 then return "< 1 min" end
  return table.concat(parts, ", ")
end

local function formatKB(kb)
  local gib = kb / (1024 * 1024)
  if gib >= 1 then return string.format("%.1f GiB", gib) end
  return string.format("%.0f MiB", kb / 1024)
end

local function gatherInfo()
  local info = {}

  info.user     = os.getenv("USER") or os.getenv("USERNAME") or "unknown"
  info.hostname = exec("hostname") or "unknown"

  local release = readFile("/etc/os-release")
  if release then
    info.os = release:match('PRETTY_NAME="(.-)"') or "Linux"
  else
    info.os = "Unknown OS"
  end

  info.kernel = exec("uname -r") or "unknown"

  local proc = readFile("/proc/uptime")
  if proc then
    local secs = tonumber(proc:match("^(%S+)")) or 0
    info.uptime = formatUptime(secs)
  else
    info.uptime = "unknown"
  end

  local sh = os.getenv("SHELL") or "unknown"
  info.shell = sh:match("([^/]+)$") or sh

  local cpuinfo = readFile("/proc/cpuinfo")
  if cpuinfo then
    local model = cpuinfo:match("model name%s*:%s*(.-)\n") or "unknown"
    model = model:gsub("%s+", " "):gsub("%(R%)", ""):gsub("%(TM%)", "")
    local cores = 0
    for _ in cpuinfo:gmatch("processor%s*:") do cores = cores + 1 end
    info.cpu = model .. " (" .. cores .. " cores)"
  else
    info.cpu = "unknown"
  end

  local meminfo = readFile("/proc/meminfo")
  if meminfo then
    local total     = tonumber(meminfo:match("MemTotal:%s*(%d+)")) or 0
    local available = tonumber(meminfo:match("MemAvailable:%s*(%d+)")) or 0
    info.memory = formatKB(total - available) .. " / " .. formatKB(total)
  else
    info.memory = "unknown"
  end

  info.arch = exec("uname -m") or "unknown"

  return info
end

-- ── Love2D lifecycle ──────────────────────────────────────

local sysInfo = {}
local refreshTimer = 0

-- Resolve lib/ path from the real filesystem (next to game.love, not inside it).
-- arg[1] is the .love file path when launched as: love.bin game.love
local function resolveLibPath()
  if arg and arg[1] then
    local dir = arg[1]:match("(.+)/[^/]+$")
    if dir then return dir .. "/lib/libquickjs" end
  end
  return "lib/libquickjs"
end

function love.load()
  love.graphics.setBackgroundColor(0.04, 0.04, 0.06)
  ReactLove.init({
    mode = "native",
    bundlePath = "bundle.js",
    libpath = resolveLibPath(),
  })
  sysInfo = gatherInfo()
end

function love.update(dt)
  local bridge = ReactLove.getBridge()
  if bridge then
    for k, v in pairs(sysInfo) do
      bridge:pushEvent({ type = "state:sys." .. k, payload = v })
    end
    bridge:pushEvent({ type = "state:sys.fps", payload = love.timer.getFPS() })
  end

  refreshTimer = refreshTimer + dt
  if refreshTimer >= 30 then
    refreshTimer = 0
    sysInfo = gatherInfo()
  end

  ReactLove.update(dt)
end

function love.draw()
  ReactLove.draw()
end

function love.resize(w, h)
  ReactLove.resize(w, h)
end

function love.keypressed(key, scancode, isrepeat)
  if key == "escape" then love.event.quit() end
  ReactLove.keypressed(key, scancode, isrepeat)
end

function love.keyreleased(key, scancode)
  ReactLove.keyreleased(key, scancode)
end

function love.textinput(text)
  ReactLove.textinput(text)
end

function love.mousepressed(x, y, button)
  ReactLove.mousepressed(x, y, button)
end

function love.mousereleased(x, y, button)
  ReactLove.mousereleased(x, y, button)
end

function love.mousemoved(x, y, dx, dy)
  ReactLove.mousemoved(x, y)
end

function love.wheelmoved(x, y)
  ReactLove.wheelmoved(x, y)
end

function love.quit()
  ReactLove.quit()
end
