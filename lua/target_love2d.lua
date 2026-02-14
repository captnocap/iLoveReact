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
    - videos: Video loading, caching, and FFmpeg transcoding (optional, may be nil)
        videos.get(src) -> video or nil
        videos.load(src)
        videos.unload(src)
        videos.getDimensions(src) -> width, height
        videos.getStatus(src) -> "ready" | "transcoding" | "error" | nil
        videos.poll() -> events table
        videos.clearCache()
    - painter: Rendering backend
        painter.init(config)  -- receives { measure, images, videos }
        painter.paint(rootNode)
]]

local Target = {}

Target.name = "love2d"
Target.measure = require("lua.measure")
Target.images = require("lua.images")
Target.videos = require("lua.videos")
Target.painter = require("lua.painter")

return Target
