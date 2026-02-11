# Research: `__hostFlush` Receives 0 Commands

## Summary

**Root Cause: `JS_IsArray` calling convention mismatch.** The Lua FFI declares
`JS_IsArray(JSContext *ctx, JSValue val)` but the actual quickjs-ng function
signature is `bool JS_IsArray(JSValue val)` -- no context parameter. This causes
the array check to always fail, so the commands array is deserialized as a
plain object with string keys ("0", "1", "2", ...), and Lua's `#` operator
returns 0 for such tables.

---

## Investigation 1: hostConfig.ts -- Is the array empty when flushed?

**File:** `/home/siah/creative/react-love/packages/native/src/hostConfig.ts`

**Finding: The JS side is correct. The array is NOT empty.**

The flow is:

1. `createInstance` (line 274) calls `emit()` with a `CREATE` command (line 280-286).
2. `appendInitialChild` (line 303) calls `emit()` with an `APPEND` command (line 305).
3. `appendChildToContainer` (line 319) calls `emit()` with `APPEND_TO_ROOT` (line 320).
4. `resetAfterCommit` (line 451) calls `flushToHost()` (line 452).

`flushToHost()` (line 102-107):
```ts
export function flushToHost(): void {
  if (pendingCommands.length === 0) return;          // line 103: early-out if empty
  const coalesced = coalesceCommands(pendingCommands); // line 104
  globalThis.__hostFlush(coalesced);                   // line 105: sends the array
  pendingCommands.length = 0;                          // line 106: clears after send
}
```

- Line 103 returns early if the array is empty, so `__hostFlush` is only called
  when there are commands.
- Line 105 passes `coalesced` directly -- a JavaScript `Array` of command objects.
  It is NOT serialized to JSON. The comment on line 7 says "serialized as JSON" but
  the actual code passes the raw array. This is correct for the direct FFI approach.
- The `coalesceCommands` function (line 66-100) only merges UPDATE commands; it
  never drops CREATE/APPEND/APPEND_TO_ROOT commands.

**Verdict:** The JS side correctly calls `__hostFlush` with a non-empty array of
command objects during initial render.

---

## Investigation 2: `jsValueToLua` and TAG_FLOAT64

**File:** `/home/siah/creative/react-love/lua/bridge_quickjs.lua` (lines 114-121, 140-225)

**Finding: The tag auto-detection works correctly, but is not the root cause.**

Tag defaults (line 114-121):
```lua
local TAG_INT       = 0
local TAG_BOOL      = 1
local TAG_NULL      = 2
local TAG_UNDEFINED = 3
local TAG_FLOAT64   = 7    -- old quickjs default
local TAG_OBJECT    = -1
local TAG_STRING    = -7
```

The `validateTags()` function (line 293-331) runs at init time and auto-detects
the correct tags by creating known values and reading their `.tag` field. The
quickjs-ng header (quickjs.h line 160-181) defines:
```c
JS_TAG_SHORT_BIG_INT = 7,
JS_TAG_FLOAT64       = 8,
```

So `TAG_FLOAT64` gets updated from 7 to 8 at runtime. The debug output confirms:
`STRING=-7 INT=0 BOOL=1 NULL=2 FLOAT64=8 OBJECT=-1`.

The `jsValueToLua` function (line 140) correctly uses the updated constants for
tag dispatch. The tag auto-detection handles the quickjs-ng change properly.

**Verdict:** Tag detection is not the issue. FLOAT64=8 is detected and used correctly.

---

## Investigation 3: C trampoline `argv` passing -- THE ROOT CAUSE IS HERE (partially)

**File:** `/home/siah/creative/react-love/quickjs/qjs_ffi_shim.c` (lines 118-124)

**Finding: The C trampoline correctly passes `argv` to the Lua callback.**

The trampoline (line 118-124):
```c
static JSValue trampoline_flush(JSContext *ctx, JSValue this_val,
                                int argc, JSValue *argv)
{
    JSValue ret = JS_UNDEFINED;
    if (host_flush_cb) host_flush_cb(ctx, argc, argv, &ret);
    return ret;
}
```

The `JSCFunction` signature (quickjs.h line 466) in this build is:
```c
typedef JSValue JSCFunction(JSContext *ctx, JSValueConst this_val,
                            int argc, JSValueConst *argv);
```

Since `JSValueConst` is `#define`d to `JSValue` (quickjs.h line 184) in
non-`JS_CHECK_JSVALUE` builds, the trampoline signature matches exactly.

The trampoline correctly:
- Receives `this_val` by value (16 bytes, passed in registers on x86-64)
- Receives `argc` and `argv` in the correct positions
- Passes `ctx`, `argc`, `argv`, and `&ret` to the Lua callback
- Does NOT pass `this_val` to Lua (intentional -- not needed)

**Verdict:** The trampoline itself is correct. `argv` arrives at the Lua callback
correctly. The problem is what the Lua callback does with `argv[0]`.

---

## Investigation 4: `JS_IsArray` signature mismatch -- THE ACTUAL ROOT CAUSE

**File:** `/home/siah/creative/react-love/lua/bridge_quickjs.lua` (line 75)
**File:** `/home/siah/creative/react-love/quickjs/quickjs.h` (line 947)

**Finding: CRITICAL BUG. The Lua FFI declares `JS_IsArray` with a wrong signature.**

Lua FFI cdef (line 75):
```lua
int JS_IsArray(JSContext *ctx, JSValue val);
```

Actual C function (quickjs.h line 947):
```c
JS_EXTERN bool JS_IsArray(JSValueConst val);   // NO ctx parameter!
```

This is a **calling convention mismatch**. On x86-64 System V ABI:

When Lua calls `qjs.JS_IsArray(ctx, val)`:
- `rdi` = ctx pointer (8 bytes)
- `rsi` = val.u (first 8 bytes of JSValue struct)
- `rdx` = val.tag (second 8 bytes of JSValue struct)

But `JS_IsArray(JSValue val)` expects:
- `rdi` = val.u
- `rsi` = val.tag

So `JS_IsArray` receives:
- `val.u` = the context pointer (nonsense)
- `val.tag` = the real val.u field (e.g., an object pointer)

Inside `JS_IsArray` (quickjs.c line 14306-14311):
```c
bool JS_IsArray(JSValueConst val) {
    if (JS_VALUE_GET_TAG(val) == JS_TAG_OBJECT) {  // checks val.tag
        JSObject *p = JS_VALUE_GET_OBJ(val);
        return p->class_id == JS_CLASS_ARRAY;
    }
    return false;
}
```

It checks `JS_VALUE_GET_TAG(val)` which reads `val.tag`. But due to the shift,
`val.tag` now contains what was `val.u` -- the object pointer -- which will never
equal `JS_TAG_OBJECT` (-1). **So `JS_IsArray` always returns false.**

### Consequence: Array treated as object with string keys

When `JS_IsArray` returns false, `jsValueToLua` (line 187-217) falls into the
object enumeration branch:

```lua
-- Object: enumerate own properties
local ptab = ffi.new("JSPropertyEnum*[1]")
local plen = ffi.new("uint32_t[1]")
local flags = JS_GPN_STRING_MASK + JS_GPN_ENUM_ONLY  -- 1 + 16 = 17

if qjs.JS_GetOwnPropertyNames(ctx, ptab, plen, val, flags) ~= 0 then
  return {}
end

local obj = {}
local count = tonumber(plen[0])
for i = 0, count - 1 do
  local prop = ptab[0][i]
  local keyCstr = qjs.JS_AtomToCString(ctx, prop.atom)
  if keyCstr ~= nil then
    local key = ffi.string(keyCstr)            -- "0", "1", "2", "length"
    obj[key] = jsValueToLua(ctx, qjs, propVal, depth + 1)
  end
end
return obj
```

For a JS array `[cmd1, cmd2, cmd3]`, `JS_GetOwnPropertyNames` returns:
- `"0"`, `"1"`, `"2"`, `"length"`

This builds a Lua table: `{["0"] = cmd1, ["1"] = cmd2, ["2"] = cmd3, ["length"] = 3}`

### Why `#commands == 0`

Lua's `#` operator returns the length of the array part of a table -- it counts
consecutive integer keys starting from 1. A table with string keys `"0"`, `"1"`,
`"2"` has **no integer keys**, so `#table == 0`.

The debug print on line 471:
```lua
print("[DEBUG] __hostFlush got " .. #commands .. " commands")
```

Reports "0 commands" because the table has string keys, not integer keys.

The `ipairs` loop on line 472 also iterates zero times:
```lua
for _, cmd in ipairs(commands) do
  selfRef.commandBuffer[#selfRef.commandBuffer + 1] = cmd
end
```

**Verdict:** This is the root cause. Fix the Lua FFI declaration to match the
actual signature: `bool JS_IsArray(JSValue val);` (no ctx parameter).

---

## Investigation 5: Does `jsValueToLua` handle arrays correctly with FLOAT64=8?

**Finding: Yes, IF `JS_IsArray` worked correctly.**

The array handling code (lines 172-186):
```lua
if qjs.JS_IsArray(ctx, val) ~= 0 then
  local lengthVal = qjs.JS_GetPropertyStr(ctx, val, "length")
  local len = 0
  if qjs.JS_ToInt32(ctx, _int32_buf, lengthVal) == 0 then
    len = tonumber(_int32_buf[0])
  end
  qjs.JS_FreeValue(ctx, lengthVal)

  local arr = {}
  for i = 0, len - 1 do
    local elem = qjs.JS_GetPropertyUint32(ctx, val, i)
    arr[i + 1] = jsValueToLua(ctx, qjs, elem, depth + 1)  -- 1-indexed!
    qjs.JS_FreeValue(ctx, elem)
  end
  return arr
end
```

This code is correct:
- Reads `.length` property as int32 (the length of an array is always an integer,
  not a float64, so TAG_FLOAT64=8 vs 7 is irrelevant here)
- Iterates 0..len-1 using `JS_GetPropertyUint32` (correct for array access)
- Stores elements at `i + 1` (correct Lua 1-indexing)
- Recursively converts each element

The FLOAT64=8 tag would matter if array elements contained float64 values, but
the tag auto-detection ensures `TAG_FLOAT64` is updated to 8. No issue here.

**Verdict:** Array handling logic is correct; it just never executes because
`JS_IsArray` always returns false.

---

## The Fix

In `/home/siah/creative/react-love/lua/bridge_quickjs.lua`, line 75, change:

```lua
-- BEFORE (wrong: has extra JSContext* parameter)
int JS_IsArray(JSContext *ctx, JSValue val);

-- AFTER (correct: matches quickjs-ng's actual signature)
bool JS_IsArray(JSValue val);
```

And update the call site at line 172:

```lua
-- BEFORE
if qjs.JS_IsArray(ctx, val) ~= 0 then

-- AFTER (bool returns 0 or 1 in C, but LuaJIT treats bool correctly)
if qjs.JS_IsArray(val) ~= 0 then
```

Note: LuaJIT maps C `bool` to a Lua boolean via FFI, so you may need to use:
```lua
if qjs.JS_IsArray(val) then
```
instead of comparing with `~= 0`. Test both approaches.

---

## Additional Note: JSValue struct layout

The Lua FFI declares (line 38):
```lua
typedef struct { int64_t u; int64_t tag; } JSValue;
```

The actual C struct (quickjs.h lines 310-320, non-NAN-boxing 64-bit):
```c
typedef union JSValueUnion {
    int32_t int32;
    double float64;
    void *ptr;
    int32_t short_big_int;
} JSValueUnion;

typedef struct JSValue {
    JSValueUnion u;  // 8 bytes (union, largest member is double/ptr)
    int64_t tag;     // 8 bytes
} JSValue;
```

Both are 16 bytes with `tag` at offset 8. The `int64_t u` in Lua overlays the
union correctly for the purpose of reading `.tag` and passing the struct to C
functions. The actual `u` field value is only interpreted by C code, so this
is fine. The tag field is at the correct offset in both declarations.

The system is a 64-bit Linux build (`INTPTR_MAX == INT64_MAX`), so `JS_NAN_BOXING`
is NOT defined, confirming the non-NAN-boxing struct layout is used.
