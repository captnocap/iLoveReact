--[[
  Minimal proof-of-concept: libmpv OpenGL rendering into a Love2D Canvas.
  v5 — Isolated FBO approach: mpv renders to its own FBO, then we blit to canvas
]]

local ffi = require("ffi")

ffi.cdef[[
  // --- SDL2 (Love2D already linked it) ---
  void *SDL_GL_GetProcAddress(const char *proc);

  // --- dlopen ---
  void *dlopen(const char *filename, int flags);

  // --- mpv client API ---
  typedef struct mpv_handle mpv_handle;
  typedef struct mpv_render_context mpv_render_context;

  mpv_handle *mpv_create(void);
  int mpv_initialize(mpv_handle *ctx);
  int mpv_set_option_string(mpv_handle *ctx, const char *name, const char *data);
  int mpv_command(mpv_handle *ctx, const char **args);
  void mpv_terminate_destroy(mpv_handle *ctx);
  const char *mpv_error_string(int error);

  // --- mpv render API ---
  typedef struct mpv_render_param {
    int type;
    void *data;
  } mpv_render_param;

  typedef struct mpv_opengl_init_params {
    void *(*get_proc_address)(void *ctx, const char *name);
    void *get_proc_address_ctx;
  } mpv_opengl_init_params;

  typedef struct mpv_opengl_fbo {
    int fbo;
    int w;
    int h;
    int internal_format;
  } mpv_opengl_fbo;

  int mpv_render_context_create(mpv_render_context **res, mpv_handle *mpv, mpv_render_param *params);
  int mpv_render_context_render(mpv_render_context *ctx, mpv_render_param *params);
  uint64_t mpv_render_context_update(mpv_render_context *ctx);
  void mpv_render_context_free(mpv_render_context *ctx);
  void mpv_render_context_report_swap(mpv_render_context *ctx);

  // --- GL ---
  typedef int GLint;
  typedef unsigned int GLuint;
  typedef unsigned int GLenum;
  typedef int GLsizei;
  typedef unsigned char GLboolean;

  void glGetIntegerv(GLenum pname, GLint *params);
  void glGenFramebuffers(GLsizei n, GLuint *framebuffers);
  void glDeleteFramebuffers(GLsizei n, const GLuint *framebuffers);
  void glBindFramebuffer(GLenum target, GLuint framebuffer);
  void glFramebufferTexture2D(GLenum target, GLenum attachment, GLenum textarget, GLuint texture, GLint level);
  GLenum glCheckFramebufferStatus(GLenum target);

  void glGenTextures(GLsizei n, GLuint *textures);
  void glDeleteTextures(GLsizei n, const GLuint *textures);
  void glBindTexture(GLenum target, GLuint texture);
  void glTexImage2D(GLenum target, GLint level, GLint internalformat, GLsizei width, GLsizei height, GLint border, GLenum format, GLenum type, const void *pixels);
  void glTexParameteri(GLenum target, GLenum pname, GLint param);

  void glBlitFramebuffer(GLint srcX0, GLint srcY0, GLint srcX1, GLint srcY1,
                          GLint dstX0, GLint dstY0, GLint dstX1, GLint dstY1,
                          unsigned int mask, GLenum filter);

  GLenum glGetError(void);

  void glUseProgram(GLuint program);
  void glBindVertexArray(GLuint array);
  void glBindBuffer(GLenum target, GLuint buffer);
  void glActiveTexture(GLenum texture);
  void glEnable(GLenum cap);
  void glDisable(GLenum cap);
  void glBlendFunc(GLenum sfactor, GLenum dfactor);
  void glViewport(GLint x, GLint y, GLsizei width, GLsizei height);
  void glScissor(GLint x, GLint y, GLsizei width, GLsizei height);
]]

-- GL constants
local GL_FRAMEBUFFER          = 0x8D40
local GL_READ_FRAMEBUFFER     = 0x8CA8
local GL_DRAW_FRAMEBUFFER     = 0x8CA9
local GL_FRAMEBUFFER_BINDING  = 0x8CA6
local GL_COLOR_ATTACHMENT0    = 0x8CE0
local GL_FRAMEBUFFER_COMPLETE = 0x8CD5
local GL_TEXTURE_2D           = 0x0DE1
local GL_RGBA8                = 0x8058
local GL_RGBA                 = 0x1908
local GL_UNSIGNED_BYTE        = 0x1401
local GL_TEXTURE_MIN_FILTER   = 0x2801
local GL_TEXTURE_MAG_FILTER   = 0x2800
local GL_LINEAR               = 0x2601
local GL_COLOR_BUFFER_BIT     = 0x00004000
local GL_NEAREST              = 0x2600

local MPV_RENDER_PARAM_API_TYPE           = 1
local MPV_RENDER_PARAM_OPENGL_INIT_PARAMS = 2
local MPV_RENDER_PARAM_OPENGL_FBO        = 3
local MPV_RENDER_PARAM_FLIP_Y            = 4
local MPV_RENDER_UPDATE_FRAME             = 1

-- Load libmpv with RTLD_DEEPBIND to isolate lua 5.2 symbols from LuaJIT
local RTLD_LAZY     = 0x00001
local RTLD_DEEPBIND = 0x00008
ffi.C.dlopen("libmpv.so.2", bit.bor(RTLD_LAZY, RTLD_DEEPBIND))
local mpv = ffi.load("mpv")

local function log(msg)
  io.write("[mpv-poc] " .. msg .. "\n")
  io.flush()
end

-- GL proc address callback via Love2D's own SDL2
local callCount = 0
local get_proc_address_cb = ffi.cast(
  "void *(*)(void *, const char *)",
  function(_, name)
    callCount = callCount + 1
    local addr = ffi.C.SDL_GL_GetProcAddress(name)
    if callCount <= 10 then
      local nameStr = ffi.string(name)
      io.write("  [gl] " .. nameStr .. " => " .. tostring(addr) .. "\n")
      io.flush()
    end
    return addr
  end
)

-- State
local canvas           -- Love2D canvas (for drawing)
local canvasFboId      -- Love2D canvas's FBO ID
local mpvFbo           -- our private FBO for mpv
local mpvTexture       -- texture attached to our FBO
local mpvHandle_c
local renderCtx
local videoW, videoH = 960, 540
local status = "initializing..."
local frameCount = 0

local function check(err, label)
  if err < 0 then
    status = label .. ": " .. ffi.string(mpv.mpv_error_string(err))
    log("ERROR: " .. status)
    return false
  end
  return true
end

local function createPrivateFBO(w, h)
  -- Create texture
  local tex = ffi.new("GLuint[1]")
  ffi.C.glGenTextures(1, tex)
  ffi.C.glBindTexture(GL_TEXTURE_2D, tex[0])
  ffi.C.glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, nil)
  ffi.C.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
  ffi.C.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
  ffi.C.glBindTexture(GL_TEXTURE_2D, 0)

  -- Create FBO and attach texture
  local fb = ffi.new("GLuint[1]")
  ffi.C.glGenFramebuffers(1, fb)
  ffi.C.glBindFramebuffer(GL_FRAMEBUFFER, fb[0])
  ffi.C.glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex[0], 0)

  local fbStatus = ffi.C.glCheckFramebufferStatus(GL_FRAMEBUFFER)
  ffi.C.glBindFramebuffer(GL_FRAMEBUFFER, 0)

  if fbStatus ~= GL_FRAMEBUFFER_COMPLETE then
    log("ERROR: Private FBO incomplete, status=" .. string.format("0x%04X", fbStatus))
    return nil, nil
  end

  log("Private FBO created: fbo=" .. fb[0] .. " tex=" .. tex[0])
  return fb[0], tex[0]
end

function love.load()
  local videoPath = nil
  for _, ext in ipairs({"mp4", "mkv", "webm", "avi", "mov", "ogv"}) do
    local path = love.filesystem.getSource() .. "/test." .. ext
    local f = io.open(path, "r")
    if f then f:close(); videoPath = path; break end
  end

  if not videoPath then
    status = "No test video found! Place test.mp4 next to main.lua"
    log(status); return
  end
  log("Video: " .. videoPath)

  -- 1. Create Love2D canvas for final display
  canvas = love.graphics.newCanvas(videoW, videoH)

  -- Get its FBO ID
  love.graphics.setCanvas(canvas)
  local fboPtr = ffi.new("GLint[1]")
  ffi.C.glGetIntegerv(GL_FRAMEBUFFER_BINDING, fboPtr)
  canvasFboId = fboPtr[0]
  love.graphics.setCanvas()
  log("Canvas FBO ID: " .. canvasFboId)

  -- 2. Create our PRIVATE FBO for mpv (isolated from Love2D)
  mpvFbo, mpvTexture = createPrivateFBO(videoW, videoH)
  if not mpvFbo then status = "Failed to create private FBO"; return end

  -- 3. Create mpv instance
  mpvHandle_c = mpv.mpv_create()
  if mpvHandle_c == nil then status = "mpv_create NULL"; log(status); return end
  log("mpv_create OK")

  mpv.mpv_set_option_string(mpvHandle_c, "vo", "libmpv")
  mpv.mpv_set_option_string(mpvHandle_c, "hwdec", "no")
  mpv.mpv_set_option_string(mpvHandle_c, "ao", "null")
  mpv.mpv_set_option_string(mpvHandle_c, "load-scripts", "no")
  mpv.mpv_set_option_string(mpvHandle_c, "ytdl", "no")
  mpv.mpv_set_option_string(mpvHandle_c, "osd-level", "0")
  mpv.mpv_set_option_string(mpvHandle_c, "sub", "no")
  mpv.mpv_set_option_string(mpvHandle_c, "terminal", "yes")
  mpv.mpv_set_option_string(mpvHandle_c, "msg-level", "all=warn")
  mpv.mpv_set_option_string(mpvHandle_c, "pause", "no")

  if not check(mpv.mpv_initialize(mpvHandle_c), "mpv_initialize") then return end
  log("mpv_initialize OK")

  -- 4. Create OpenGL render context
  local glInit = ffi.new("mpv_opengl_init_params")
  glInit.get_proc_address = get_proc_address_cb
  glInit.get_proc_address_ctx = nil

  local apiType = ffi.new("char[7]", "opengl")

  local createParams = ffi.new("mpv_render_param[3]")
  createParams[0].type = MPV_RENDER_PARAM_API_TYPE
  createParams[0].data = ffi.cast("void*", apiType)
  createParams[1].type = MPV_RENDER_PARAM_OPENGL_INIT_PARAMS
  createParams[1].data = ffi.cast("void*", glInit)
  createParams[2].type = 0
  createParams[2].data = nil

  log("Creating render context...")
  local ctxPtr = ffi.new("mpv_render_context*[1]")
  if not check(mpv.mpv_render_context_create(ctxPtr, mpvHandle_c, createParams), "render_context_create") then
    return
  end
  renderCtx = ctxPtr[0]
  log("Render context created! (callback called " .. callCount .. " times)")

  -- 5. Load video
  local cmd = ffi.new("const char*[4]")
  cmd[0] = ffi.cast("const char*", "loadfile")
  cmd[1] = ffi.cast("const char*", videoPath)
  cmd[2] = ffi.cast("const char*", "replace")
  cmd[3] = nil
  if not check(mpv.mpv_command(mpvHandle_c, cmd), "loadfile") then return end

  status = "playing"
  log("Video loaded — status: " .. status)
end

function love.draw()
  if not renderCtx then
    love.graphics.setColor(1, 0.3, 0.3)
    love.graphics.printf(status, 20, 20, love.graphics.getWidth() - 40)
    love.graphics.setColor(1, 1, 1)
    return
  end

  -- Step 1: Check if mpv has a new frame
  local flags = mpv.mpv_render_context_update(renderCtx)

  if bit.band(flags, MPV_RENDER_UPDATE_FRAME) ~= 0 then
    -- Save ALL GL state that mpv might touch
    local savedFbo          = ffi.new("GLint[1]")
    local savedProgram      = ffi.new("GLint[1]")
    local savedVao          = ffi.new("GLint[1]")
    local savedVbo          = ffi.new("GLint[1]")
    local savedEbo          = ffi.new("GLint[1]")
    local savedActiveTex    = ffi.new("GLint[1]")
    local savedTex2D        = ffi.new("GLint[1]")
    local savedViewport     = ffi.new("GLint[4]")
    local savedScissorBox   = ffi.new("GLint[4]")
    local savedBlendSrc     = ffi.new("GLint[1]")
    local savedBlendDst     = ffi.new("GLint[1]")
    local savedBlendEnabled = ffi.new("GLint[1]")  -- actually GLboolean but int works
    local savedScissorOn    = ffi.new("GLint[1]")
    local savedDepthOn      = ffi.new("GLint[1]")
    local savedStencilOn    = ffi.new("GLint[1]")
    local savedCullOn       = ffi.new("GLint[1]")

    ffi.C.glGetIntegerv(GL_FRAMEBUFFER_BINDING, savedFbo)
    ffi.C.glGetIntegerv(0x8B8D, savedProgram)      -- GL_CURRENT_PROGRAM
    ffi.C.glGetIntegerv(0x85B5, savedVao)           -- GL_VERTEX_ARRAY_BINDING
    ffi.C.glGetIntegerv(0x8894, savedVbo)           -- GL_ARRAY_BUFFER_BINDING
    ffi.C.glGetIntegerv(0x8895, savedEbo)           -- GL_ELEMENT_ARRAY_BUFFER_BINDING
    ffi.C.glGetIntegerv(0x84E0, savedActiveTex)     -- GL_ACTIVE_TEXTURE
    ffi.C.glGetIntegerv(0x8069, savedTex2D)         -- GL_TEXTURE_BINDING_2D
    ffi.C.glGetIntegerv(0x0BA2, savedViewport)      -- GL_VIEWPORT
    ffi.C.glGetIntegerv(0x0C10, savedScissorBox)    -- GL_SCISSOR_BOX
    ffi.C.glGetIntegerv(0x0BE1, savedBlendSrc)      -- GL_BLEND_SRC
    ffi.C.glGetIntegerv(0x0BE0, savedBlendDst)      -- GL_BLEND_DST
    ffi.C.glGetIntegerv(0x0BE2, savedBlendEnabled)  -- GL_BLEND (isEnabled)
    ffi.C.glGetIntegerv(0x0C11, savedScissorOn)     -- GL_SCISSOR_TEST
    ffi.C.glGetIntegerv(0x0B71, savedDepthOn)       -- GL_DEPTH_TEST
    ffi.C.glGetIntegerv(0x0B90, savedStencilOn)     -- GL_STENCIL_TEST
    ffi.C.glGetIntegerv(0x0B44, savedCullOn)        -- GL_CULL_FACE

    -- mpv renders to our PRIVATE FBO
    local fbo = ffi.new("mpv_opengl_fbo")
    fbo.fbo = mpvFbo
    fbo.w = videoW
    fbo.h = videoH
    fbo.internal_format = 0

    local flip = ffi.new("int[1]", 0)  -- Love2D flips canvases on draw, so no flip here

    local renderParams = ffi.new("mpv_render_param[3]")
    renderParams[0].type = MPV_RENDER_PARAM_OPENGL_FBO
    renderParams[0].data = ffi.cast("void*", fbo)
    renderParams[1].type = MPV_RENDER_PARAM_FLIP_Y
    renderParams[1].data = ffi.cast("void*", flip)
    renderParams[2].type = 0
    renderParams[2].data = nil

    mpv.mpv_render_context_render(renderCtx, renderParams)
    mpv.mpv_render_context_report_swap(renderCtx)

    -- Blit from private FBO → Love2D canvas FBO
    ffi.C.glBindFramebuffer(GL_READ_FRAMEBUFFER, mpvFbo)
    ffi.C.glBindFramebuffer(GL_DRAW_FRAMEBUFFER, canvasFboId)
    ffi.C.glBlitFramebuffer(
      0, 0, videoW, videoH,
      0, 0, videoW, videoH,
      GL_COLOR_BUFFER_BIT,
      GL_NEAREST
    )

    -- Restore ALL saved GL state
    ffi.C.glBindFramebuffer(GL_FRAMEBUFFER, savedFbo[0])
    ffi.C.glUseProgram(savedProgram[0])
    ffi.C.glBindVertexArray(savedVao[0])
    ffi.C.glBindBuffer(0x8892, savedVbo[0])     -- GL_ARRAY_BUFFER
    ffi.C.glBindBuffer(0x8893, savedEbo[0])     -- GL_ELEMENT_ARRAY_BUFFER
    ffi.C.glActiveTexture(savedActiveTex[0])
    ffi.C.glBindTexture(GL_TEXTURE_2D, savedTex2D[0])
    ffi.C.glViewport(savedViewport[0], savedViewport[1], savedViewport[2], savedViewport[3])
    ffi.C.glScissor(savedScissorBox[0], savedScissorBox[1], savedScissorBox[2], savedScissorBox[3])
    ffi.C.glBlendFunc(savedBlendSrc[0], savedBlendDst[0])

    -- Restore enable/disable states
    if savedBlendEnabled[0] ~= 0 then ffi.C.glEnable(0x0BE2) else ffi.C.glDisable(0x0BE2) end
    if savedScissorOn[0] ~= 0 then ffi.C.glEnable(0x0C11) else ffi.C.glDisable(0x0C11) end
    if savedDepthOn[0] ~= 0 then ffi.C.glEnable(0x0B71) else ffi.C.glDisable(0x0B71) end
    if savedStencilOn[0] ~= 0 then ffi.C.glEnable(0x0B90) else ffi.C.glDisable(0x0B90) end
    if savedCullOn[0] ~= 0 then ffi.C.glEnable(0x0B44) else ffi.C.glDisable(0x0B44) end

    frameCount = frameCount + 1
  end

  -- Normal Love2D drawing — state is fully restored
  love.graphics.setColor(1, 1, 1)
  love.graphics.draw(canvas, 0, 0)

  -- GL state contamination test
  love.graphics.setColor(0, 0.8, 0.3, 0.9)
  love.graphics.rectangle("fill", videoW - 220, 10, 210, 80, 8, 8)

  love.graphics.setColor(1, 1, 1)
  love.graphics.print("Love2D draws OK!", videoW - 210, 20)
  love.graphics.print("FBO: " .. tostring(canvasFboId) .. " (mpv: " .. tostring(mpvFbo) .. ")", videoW - 210, 40)
  love.graphics.print("Status: " .. status .. " frames: " .. frameCount, videoW - 210, 60)

  love.graphics.setColor(1, 0.9, 0.2, 0.7)
  love.graphics.circle("fill", 60, videoH - 60, 40)

  love.graphics.setColor(1, 1, 1)
  love.graphics.print("FPS: " .. love.timer.getFPS(), 10, 10)
end

function love.keypressed(key)
  if key == "escape" or key == "q" then love.event.quit() end
end

function love.quit()
  if renderCtx then mpv.mpv_render_context_free(renderCtx); renderCtx = nil end
  if mpvHandle_c then mpv.mpv_terminate_destroy(mpvHandle_c); mpvHandle_c = nil end

  -- Clean up our private FBO/texture
  if mpvFbo then
    local fb = ffi.new("GLuint[1]", mpvFbo)
    ffi.C.glDeleteFramebuffers(1, fb)
  end
  if mpvTexture then
    local tex = ffi.new("GLuint[1]", mpvTexture)
    ffi.C.glDeleteTextures(1, tex)
  end

  get_proc_address_cb = nil
end
