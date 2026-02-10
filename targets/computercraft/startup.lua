--[[
  startup.lua — ComputerCraft client for iLoveReact

  Place this file as "startup.lua" on a ComputerCraft computer.
  Edit the HOST and PORT below to match your server.

  The host machine runs React + layout and sends flat draw commands
  over WebSocket. This script just receives and draws them.
]]

local HOST = "ws://localhost:8080"

local function connect()
  print("Connecting to " .. HOST .. "...")
  local ws, err = http.websocket(HOST)
  if not ws then
    print("Connection failed: " .. tostring(err))
    return nil
  end
  print("Connected!")
  return ws
end

local function draw(cmds)
  -- Clear screen with black background
  term.setBackgroundColor(colors.black)
  term.clear()

  for _, cmd in ipairs(cmds) do
    -- Draw background fill
    if cmd.bg and cmd.w and cmd.h then
      paintutils.drawFilledBox(
        cmd.x,
        cmd.y,
        cmd.x + cmd.w - 1,
        cmd.y + cmd.h - 1,
        cmd.bg
      )
    end

    -- Draw text
    if cmd.text then
      term.setCursorPos(cmd.x, cmd.y)
      if cmd.fg then term.setTextColor(cmd.fg) end
      if cmd.bg then term.setBackgroundColor(cmd.bg) end
      term.write(cmd.text)
    end
  end
end

-- Main loop with auto-reconnect
while true do
  local ws = connect()
  if ws then
    while true do
      local msg = ws.receive()
      if not msg then
        print("Disconnected. Reconnecting...")
        ws.close()
        break
      end
      local ok, cmds = pcall(textutils.unserializeJSON, msg)
      if ok and cmds then
        draw(cmds)
      end
    end
  end
  sleep(2)
end
