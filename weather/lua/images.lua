--[[
  images.lua -- Image loading, caching, and lifecycle management

  Manages Love2D image resources:
    - Loads images via love.graphics.newImage(path)
    - Caches loaded images by src path to avoid redundant loads
    - Handles loading errors gracefully
    - Supports image unloading to prevent memory leaks
]]

local Images = {}

-- ============================================================================
-- Image cache
-- ============================================================================

local imageCache = {}
local imageRefCounts = {}

--- Return a cached image, loading it on first access.
--- Does NOT modify reference counts -- safe to call every frame from the painter.
function Images.get(src)
  if not src or src == "" then return nil end
  if imageCache[src] then return imageCache[src] end

  -- First access: load and cache (ref count starts at 0; tree ops manage it)
  local success, imageOrErr = pcall(love.graphics.newImage, src)
  if success then
    imageCache[src] = imageOrErr
    imageRefCounts[src] = imageRefCounts[src] or 0
    return imageOrErr
  else
    print("Warning: Failed to load image '" .. src .. "': " .. tostring(imageOrErr))
    return nil
  end
end

--- Load an image and increment its reference count.
--- Call once per Image node that uses this src (e.g. on tree CREATE).
function Images.load(src)
  local image = Images.get(src)
  if image then
    imageRefCounts[src] = (imageRefCounts[src] or 0) + 1
  end
  return image
end

--- Decrement the reference count for an image and unload it if no longer needed.
--- Call this when an Image node is removed from the tree.
function Images.unload(src)
  if not src or not imageRefCounts[src] then
    return
  end

  imageRefCounts[src] = imageRefCounts[src] - 1

  if imageRefCounts[src] <= 0 then
    if imageCache[src] then
      imageCache[src]:release()
      imageCache[src] = nil
    end
    imageRefCounts[src] = nil
  end
end

--- Get the intrinsic dimensions of an image (width and height in pixels).
--- Returns width, height if the image is loaded, or nil, nil otherwise.
function Images.getDimensions(src)
  local image = imageCache[src]
  if image then
    return image:getWidth(), image:getHeight()
  end
  return nil, nil
end

--- Clear all cached images. Useful for cleanup or testing.
function Images.clearCache()
  for src, image in pairs(imageCache) do
    if image then
      image:release()
    end
  end
  imageCache = {}
  imageRefCounts = {}
end

return Images
