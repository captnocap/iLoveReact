--[[
  videos.lua -- Video loading, caching, lifecycle, and FFmpeg transcoding

  Manages Love2D video resources with automatic format conversion:
    - Loads .ogv (Theora) files directly via love.graphics.newVideo()
    - Transcodes non-.ogv files (mp4, mkv, webm, etc.) via FFmpeg in a love.thread
    - Caches transcoded files in the Love2D save directory
    - Ref-counted lifecycle like images.lua
    - Probes duration via ffprobe during transcoding

  Status lifecycle per src:
    nil → "transcoding" → "ready" | "error"
    (or nil → "ready" for .ogv files that load directly)
]]

local Videos = {}

-- ============================================================================
-- State
-- ============================================================================

local videoCache = {}       -- src -> love Video object
local videoRefCounts = {}   -- src -> number
local videoStatus = {}      -- src -> "ready" | "transcoding" | "error"
local videoErrors = {}      -- src -> error message string
local videoDurations = {}   -- src -> duration in seconds (from ffprobe)
local transcodingJobs = {}  -- src -> { thread, statusChannel, outputPath, originalSrc }

-- Playback tracking for event emission
local trackedNodes = {}     -- nodeId -> { src, lastTime, wasPlaying }
local TIME_UPDATE_INTERVAL = 0.25  -- seconds between onTimeUpdate events
local lastTimeUpdateEmit = {} -- nodeId -> last emitted time

local CACHE_DIR = "__video_cache"
local OGV_EXTENSIONS = { [".ogv"] = true, [".ogg"] = true }

-- ============================================================================
-- Helpers
-- ============================================================================

--- Get file extension (lowercase).
local function getExtension(path)
  return (path:match("%.([^%.]+)$") or ""):lower()
end

--- Check if a path is already in Theora format.
local function isTheora(path)
  local ext = "." .. getExtension(path)
  return OGV_EXTENSIONS[ext] or false
end

--- Simple hash of a string for cache filenames.
--- Uses a basic djb2 hash to avoid collisions without requiring crypto libs.
local function hashString(s)
  local hash = 5381
  for i = 1, #s do
    hash = ((hash * 33) + s:byte(i)) % 0xFFFFFFFF
  end
  return string.format("%08x", hash)
end

--- Get the cache path for a transcoded video.
local function getCachePath(src)
  local hash = hashString(src)
  local basename = src:match("([^/\\]+)$") or "video"
  local name = basename:match("(.+)%.[^%.]+$") or basename
  return CACHE_DIR .. "/" .. hash .. "_" .. name .. ".ogv"
end

--- Ensure the cache directory exists in the Love2D save directory.
local function ensureCacheDir()
  local info = love.filesystem.getInfo(CACHE_DIR)
  if not info then
    love.filesystem.createDirectory(CACHE_DIR)
  end
end

-- ============================================================================
-- FFmpeg transcoding thread
-- ============================================================================

-- Thread code: runs FFmpeg to transcode a video file to Theora/OGV.
-- Communicates via love.thread channels.
local TRANSCODE_THREAD_CODE = [[
require("love.timer")
local channelName = ...
local statusChannel = love.thread.getChannel(channelName)

-- Read job from channel
local job = statusChannel:demand()
if not job or type(job) ~= "table" then
  statusChannel:push({ status = "error", message = "Invalid job" })
  return
end

local inputPath = job.inputPath
local outputPath = job.outputPath

-- Resolve the real filesystem path for the input
-- love.filesystem paths need to be resolved to real OS paths for FFmpeg
local realInput = inputPath
local saveDir = love.filesystem.getSaveDirectory()

-- Try the source directory first (where the .love or project lives)
local sourceDir = love.filesystem.getSource()
local tryPaths = {
  inputPath,                              -- absolute path
  sourceDir .. "/" .. inputPath,           -- relative to source
  saveDir .. "/" .. inputPath,             -- relative to save dir
}

local resolvedInput = nil
for _, p in ipairs(tryPaths) do
  local f = io.open(p, "r")
  if f then
    f:close()
    resolvedInput = p
    break
  end
end

if not resolvedInput then
  statusChannel:push({ status = "error", message = "Input file not found: " .. inputPath })
  return
end

-- Resolve output to save directory (writable)
local realOutput = saveDir .. "/" .. outputPath

-- Ensure output directory exists
local outDir = realOutput:match("(.+)/[^/]+$")
if outDir then
  os.execute('mkdir -p "' .. outDir .. '"')
end

-- Probe duration via ffprobe (best-effort)
local duration = nil
local probeCmd = string.format(
  'ffprobe -v quiet -show_entries format=duration -of csv=p=0 "%s" 2>/dev/null',
  resolvedInput
)
local probeHandle = io.popen(probeCmd)
if probeHandle then
  local probeResult = probeHandle:read("*a")
  probeHandle:close()
  if probeResult then
    duration = tonumber(probeResult:match("([%d%.]+)"))
  end
end

-- Run FFmpeg transcoding
statusChannel:push({ status = "transcoding", duration = duration })

local cmd = string.format(
  'ffmpeg -y -i "%s" -c:v libtheora -q:v 7 -c:a libvorbis -q:a 4 "%s" 2>&1',
  resolvedInput, realOutput
)
local handle = io.popen(cmd)
if not handle then
  statusChannel:push({ status = "error", message = "Failed to start FFmpeg" })
  return
end

local output = handle:read("*a")
local success = handle:close()

if success then
  statusChannel:push({ status = "done", outputPath = outputPath, duration = duration })
else
  -- Check if FFmpeg is installed
  local checkHandle = io.popen("which ffmpeg 2>/dev/null")
  local ffmpegPath = checkHandle and checkHandle:read("*a") or ""
  if checkHandle then checkHandle:close() end

  if ffmpegPath == "" then
    statusChannel:push({ status = "error", message = "FFmpeg not installed. Install it to play non-.ogv video files." })
  else
    statusChannel:push({ status = "error", message = "FFmpeg transcoding failed: " .. (output or "unknown error") })
  end
end
]]

-- ============================================================================
-- Public API
-- ============================================================================

--- Return a cached video object, loading it on first access if ready.
--- Does NOT modify reference counts -- safe to call every frame from the painter.
function Videos.get(src)
  if not src or src == "" then return nil end
  return videoCache[src]
end

--- Get the playback status of a video source.
--- @return "ready" | "transcoding" | "error" | nil
function Videos.getStatus(src)
  if not src or src == "" then return nil end
  return videoStatus[src]
end

--- Get the error message for a failed video.
function Videos.getError(src)
  return videoErrors[src]
end

--- Get the probed duration of a video (may be nil if unknown).
function Videos.getDuration(src)
  return videoDurations[src]
end

--- Load a video and increment its reference count.
--- For .ogv files, loads immediately. For other formats, starts async transcoding.
function Videos.load(src)
  if not src or src == "" then return nil end

  -- Already loaded or loading
  if videoStatus[src] then
    videoRefCounts[src] = (videoRefCounts[src] or 0) + 1
    return videoCache[src]
  end

  videoRefCounts[src] = (videoRefCounts[src] or 0) + 1

  if isTheora(src) then
    -- Direct load
    local success, videoOrErr = pcall(love.graphics.newVideo, src)
    if success then
      videoCache[src] = videoOrErr
      videoStatus[src] = "ready"
      return videoOrErr
    else
      print("[videos] Failed to load video '" .. src .. "': " .. tostring(videoOrErr))
      videoStatus[src] = "error"
      videoErrors[src] = tostring(videoOrErr)
      return nil
    end
  else
    -- Needs transcoding — check cache first
    local cachePath = getCachePath(src)
    local cacheInfo = love.filesystem.getInfo(cachePath)

    if cacheInfo then
      -- Cached .ogv exists, load it
      local success, videoOrErr = pcall(love.graphics.newVideo, cachePath)
      if success then
        videoCache[src] = videoOrErr
        videoStatus[src] = "ready"
        return videoOrErr
      else
        -- Cache corrupted, re-transcode
        love.filesystem.remove(cachePath)
      end
    end

    -- Start async transcoding
    ensureCacheDir()
    videoStatus[src] = "transcoding"

    local channelName = "video_transcode_" .. hashString(src)
    local statusChannel = love.thread.getChannel(channelName)

    local thread = love.thread.newThread(TRANSCODE_THREAD_CODE)
    transcodingJobs[src] = {
      thread = thread,
      statusChannel = statusChannel,
      outputPath = cachePath,
      originalSrc = src,
      channelName = channelName,
    }

    -- Send job info to thread
    statusChannel:push({
      inputPath = src,
      outputPath = cachePath,
    })

    thread:start(channelName)
    return nil
  end
end

--- Decrement the reference count for a video and unload it if no longer needed.
function Videos.unload(src)
  if not src or not videoRefCounts[src] then return end

  videoRefCounts[src] = videoRefCounts[src] - 1

  if videoRefCounts[src] <= 0 then
    if videoCache[src] then
      -- Pause before releasing
      if videoCache[src]:isPlaying() then
        videoCache[src]:pause()
      end
      videoCache[src]:release()
      videoCache[src] = nil
    end
    videoRefCounts[src] = nil
    videoStatus[src] = nil
    videoErrors[src] = nil

    -- Cancel transcoding job if in progress
    if transcodingJobs[src] then
      transcodingJobs[src] = nil
    end
  end
end

--- Get the intrinsic dimensions of a video.
function Videos.getDimensions(src)
  local video = videoCache[src]
  if video then
    return video:getWidth(), video:getHeight()
  end
  return nil, nil
end

--- Poll active transcoding jobs. Call once per frame from init.lua.
--- Returns a list of events: { { src, status, message? } }
function Videos.poll()
  local events = {}

  for src, job in pairs(transcodingJobs) do
    local msg = job.statusChannel:pop()
    while msg do
      if type(msg) == "table" then
        if msg.status == "transcoding" then
          -- Got duration from ffprobe
          if msg.duration then
            videoDurations[src] = msg.duration
          end

        elseif msg.status == "done" then
          -- Transcoding complete — load the video
          local success, videoOrErr = pcall(love.graphics.newVideo, msg.outputPath)
          if success then
            videoCache[src] = videoOrErr
            videoStatus[src] = "ready"
            if msg.duration then
              videoDurations[src] = msg.duration
            end
            events[#events + 1] = { src = src, status = "ready" }
          else
            videoStatus[src] = "error"
            videoErrors[src] = "Failed to load transcoded video: " .. tostring(videoOrErr)
            events[#events + 1] = { src = src, status = "error", message = videoErrors[src] }
          end
          transcodingJobs[src] = nil

        elseif msg.status == "error" then
          videoStatus[src] = "error"
          videoErrors[src] = msg.message or "Unknown transcoding error"
          events[#events + 1] = { src = src, status = "error", message = videoErrors[src] }
          transcodingJobs[src] = nil
        end
      end
      msg = job.statusChannel:pop()
    end

    -- Check if thread errored out without sending a message
    if transcodingJobs[src] and job.thread:isRunning() == false then
      local threadErr = job.thread:getError()
      if threadErr then
        videoStatus[src] = "error"
        videoErrors[src] = "Transcoding thread error: " .. tostring(threadErr)
        events[#events + 1] = { src = src, status = "error", message = videoErrors[src] }
        transcodingJobs[src] = nil
      end
    end
  end

  return events
end

--- Clear all cached videos. Useful for cleanup or testing.
function Videos.clearCache()
  for src, video in pairs(videoCache) do
    if video then
      if video:isPlaying() then video:pause() end
      video:release()
    end
  end
  videoCache = {}
  videoRefCounts = {}
  videoStatus = {}
  videoErrors = {}
  videoDurations = {}
  transcodingJobs = {}
  trackedNodes = {}
  lastTimeUpdateEmit = {}
end

--- Register a Video node for playback event tracking.
--- Called from tree.lua on CREATE of Video nodes.
function Videos.trackNode(nodeId, src)
  trackedNodes[nodeId] = { src = src, wasPlaying = false, lastTime = 0 }
  lastTimeUpdateEmit[nodeId] = 0
end

--- Unregister a Video node from playback tracking.
function Videos.untrackNode(nodeId)
  trackedNodes[nodeId] = nil
  lastTimeUpdateEmit[nodeId] = nil
end

--- Update the src for a tracked node (on prop change).
function Videos.updateTrackedNode(nodeId, newSrc)
  if trackedNodes[nodeId] then
    trackedNodes[nodeId].src = newSrc
    trackedNodes[nodeId].wasPlaying = false
    trackedNodes[nodeId].lastTime = 0
    lastTimeUpdateEmit[nodeId] = 0
  end
end

--- Poll playback state of all tracked video nodes.
--- Returns a list of events: { { nodeId, type, currentTime?, duration? } }
function Videos.pollPlayback()
  local events = {}
  local now = love.timer.getTime()

  for nodeId, info in pairs(trackedNodes) do
    local video = videoCache[info.src]
    if video then
      local isPlaying = video:isPlaying()
      local currentTime = video:tell()
      local duration = videoDurations[info.src]

      -- Detect play/pause state changes
      if isPlaying and not info.wasPlaying then
        events[#events + 1] = { nodeId = nodeId, type = "onPlay" }
      elseif not isPlaying and info.wasPlaying then
        events[#events + 1] = { nodeId = nodeId, type = "onPause" }
        -- Detect end of video (stopped playing, near end)
        if currentTime > 0 and (not duration or currentTime >= duration - 0.1) then
          events[#events + 1] = { nodeId = nodeId, type = "onEnded" }
        end
      end

      -- Periodic time update
      if isPlaying then
        local lastEmit = lastTimeUpdateEmit[nodeId] or 0
        if now - lastEmit >= TIME_UPDATE_INTERVAL then
          events[#events + 1] = {
            nodeId = nodeId,
            type = "onTimeUpdate",
            currentTime = currentTime,
            duration = duration,
          }
          lastTimeUpdateEmit[nodeId] = now
        end
      end

      info.wasPlaying = isPlaying
      info.lastTime = currentTime
    end
  end

  return events
end

return Videos
