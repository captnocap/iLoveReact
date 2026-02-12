--[[
  storage.lua — File-based CRUD storage for iLoveReact

  Provides RPC handlers for get/set/delete/list operations on
  Love2D's save directory. Supports JSON, Markdown (frontmatter + body),
  and plain text (key:value) formats.

  Data is stored in: save/<collection>/<id>.<ext>

  This module registers handlers with the RPC system in init.lua.
  It does NOT depend on bridge_fs or bridge_quickjs directly.
]]

local ok_json, json = pcall(require, "json")
if not ok_json then ok_json, json = pcall(require, "lib.json") end
if not ok_json then json = nil end

local Storage = {}

-- ── Format parsers ──────────────────────────────────────

--- Parse YAML-style frontmatter from markdown files
local function parseMarkdown(content)
  local frontmatter, body = content:match("^%-%-%-%s*\n(.-)%-%-%-%s*\n(.*)$")
  if not frontmatter then
    return { content = content }
  end

  local data = { content = body }
  for line in frontmatter:gmatch("[^\n]+") do
    local key, value = line:match("^(%S+):%s*(.+)$")
    if key then
      -- Try JSON parse for arrays/objects
      if json and (value:sub(1,1) == "[" or value:sub(1,1) == "{") then
        local ok, parsed = pcall(json.decode, value)
        if ok then
          data[key] = parsed
        else
          data[key] = value
        end
      elseif value == "true" then
        data[key] = true
      elseif value == "false" then
        data[key] = false
      elseif value == "null" or value == "~" then
        data[key] = nil
      elseif tonumber(value) then
        data[key] = tonumber(value)
      else
        -- Strip quotes
        local unquoted = value:match('^"(.*)"$') or value:match("^'(.*)'$")
        data[key] = unquoted or value
      end
    end
  end
  return data
end

--- Serialize data to markdown with frontmatter
local function serializeMarkdown(data)
  local lines = {}
  local body = data.content or ""

  -- Sort keys for deterministic output
  local keys = {}
  for key in pairs(data) do
    if key ~= "content" then
      keys[#keys + 1] = key
    end
  end
  table.sort(keys)

  for _, key in ipairs(keys) do
    local value = data[key]
    if type(value) == "table" and json then
      lines[#lines + 1] = key .. ": " .. json.encode(value)
    else
      lines[#lines + 1] = key .. ": " .. tostring(value)
    end
  end

  if #lines == 0 then return body end
  return "---\n" .. table.concat(lines, "\n") .. "\n---\n\n" .. body
end

--- Parse plain text key:value format
local function parseText(content)
  local data = {}
  local hasKeyValue = false

  for line in content:gmatch("[^\n]+") do
    local key, value = line:match("^(%w+):%s*(.+)$")
    if key then
      data[key] = value
      hasKeyValue = true
    end
  end

  if not hasKeyValue then
    return { content = content }
  end
  return data
end

--- Serialize data to plain text key:value format
local function serializeText(data)
  local lines = {}
  local keys = {}
  for key in pairs(data) do keys[#keys + 1] = key end
  table.sort(keys)

  for _, key in ipairs(keys) do
    lines[#lines + 1] = key .. ": " .. tostring(data[key])
  end
  return table.concat(lines, "\n")
end

-- ── Format helpers ──────────────────────────────────────

local function getExtension(format)
  if format == "markdown" then return ".md" end
  if format == "text" then return ".txt" end
  return ".json"
end

local function detectFormat(filename)
  if filename:match("%.md$") then return "markdown" end
  if filename:match("%.txt$") then return "text" end
  return "json"
end

local function parseContent(content, format)
  if format == "markdown" then return parseMarkdown(content) end
  if format == "text" then return parseText(content) end
  if json then return json.decode(content) end
  error("JSON parser not available")
end

local function serializeContent(data, format)
  if format == "markdown" then return serializeMarkdown(data) end
  if format == "text" then return serializeText(data) end
  if json then return json.encode(data) end
  error("JSON parser not available")
end

-- ── RPC handlers ────────────────────────────────────────

function Storage.get(args)
  local format = args.format or "json"
  local ext = getExtension(format)
  local path = "save/" .. args.collection .. "/" .. args.id .. ext

  local content = love.filesystem.read(path)
  if not content then return nil end

  local ok, data = pcall(parseContent, content, format)
  if not ok then
    print("[storage] Failed to parse " .. path .. ": " .. tostring(data))
    return nil
  end

  data.id = args.id
  return data
end

function Storage.set(args)
  local format = args.format or "json"
  local ext = getExtension(format)
  local dir = "save/" .. args.collection
  local path = dir .. "/" .. args.id .. ext

  love.filesystem.createDirectory(dir)

  local data = args.data
  local ok, content = pcall(serializeContent, data, format)
  if not ok then
    return { error = "Failed to serialize: " .. tostring(content) }
  end

  local success, err = love.filesystem.write(path, content)
  if not success then
    return { error = "Failed to write: " .. tostring(err) }
  end

  return true
end

function Storage.delete(args)
  -- Try all known extensions
  for _, ext in ipairs({ ".json", ".md", ".txt" }) do
    local path = "save/" .. args.collection .. "/" .. args.id .. ext
    if love.filesystem.getInfo(path) then
      return love.filesystem.remove(path)
    end
  end
  return false
end

function Storage.list(args)
  local dir = "save/" .. args.collection

  -- Create directory if it doesn't exist
  if not love.filesystem.getInfo(dir) then
    return {}
  end

  local files = love.filesystem.getDirectoryItems(dir)
  local results = {}

  for _, file in ipairs(files) do
    local format = detectFormat(file)
    local id = file:match("^(.+)%.[^.]+$")
    if id then
      local content = love.filesystem.read(dir .. "/" .. file)
      if content then
        local ok, data = pcall(parseContent, content, format)
        if ok then
          data.id = id
          results[#results + 1] = data
        else
          print("[storage] Skipping corrupt file " .. dir .. "/" .. file)
        end
      end
    end
  end

  return results
end

-- ── RPC handler registry ────────────────────────────────

--- Returns the RPC handler table for registration in init.lua
function Storage.getHandlers()
  return {
    ["storage:get"]    = Storage.get,
    ["storage:set"]    = Storage.set,
    ["storage:delete"] = Storage.delete,
    ["storage:list"]   = Storage.list,
  }
end

return Storage
