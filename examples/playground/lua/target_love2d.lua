--[[
  target_love2d.lua -- Love2D target implementation

  Bundles all Love2D-specific modules (painter, measure, images) into a single
  target module. This is the default target and serves as the reference
  implementation for future targets.

  A target module must provide:
    - measure: Text measurement and font cache
        measure.measureText(text, fontSize, maxWidth, fontFamily, lineHeight, letterSpacing, numberOfLines, fontWeight) -> { width, height }
        measure.getFont(size, fontFamily, fontWeight) -> font, isBold
        measure.getWidthWithSpacing(font, text, letterSpacing) -> number
        measure.clearCache()
    - images: Image loading and lifecycle (optional, may be nil)
        images.get(src) -> image or nil
        images.load(src)
        images.unload(src)
        images.getDimensions(src) -> width, height
        images.clearCache()
    - painter: Rendering backend
        painter.init(config)  -- receives { measure, images }
        painter.paint(rootNode)
]]

local Target = {}

Target.name = "love2d"
Target.measure = require("lua.measure")
Target.images = require("lua.images")
Target.painter = require("lua.painter")

return Target
