--[[
  iLoveReact Storybook — packaged main.lua

  Self-contained entry point for the fused storybook binary.
  lua/ modules live inside the .love zip, libquickjs.so lives
  in lib/ alongside the binary.
]]

local ReactLove = require("lua.init")

function love.load()
  love.graphics.setBackgroundColor(0.04, 0.04, 0.06)
  ReactLove.init({
    mode = "native",
    bundlePath = "bundle.js",
    libpath = "lib/libquickjs",
  })
end

function love.update(dt)
  ReactLove.update(dt)
end

function love.draw()
  ReactLove.draw()
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

function love.quit()
  ReactLove.quit()
end
