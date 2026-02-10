/*
 * qjs_ffi_shim.c
 *
 * 1. Exports real symbols for QuickJS inline functions (LuaJIT FFI
 *    can only call symbols exported from shared libraries).
 *
 * 2. Provides C trampolines for host functions (__hostFlush, etc.).
 *    LuaJIT can't create callbacks that return structs by value,
 *    so these C functions handle JSValue returns while delegating
 *    the actual work to Lua callbacks that use pointer-based signatures.
 */

/* Prevent the header from defining these as static inline */
#define JS_ToCString    JS_ToCString_inline
#define JS_NewString    JS_NewString_inline
#define JS_NewBool      JS_NewBool_inline
#define JS_NewInt32     JS_NewInt32_inline
#define JS_NewFloat64   JS_NewFloat64_inline
#define JS_IsException  JS_IsException_inline
#define JS_IsUndefined  JS_IsUndefined_inline
#define JS_NewCFunction JS_NewCFunction_inline
#define JS_AtomToCString JS_AtomToCString_inline
#include "quickjs.h"
#include <string.h>

/* Undo the renames */
#undef JS_ToCString
#undef JS_NewString
#undef JS_NewBool
#undef JS_NewInt32
#undef JS_NewFloat64
#undef JS_IsException
#undef JS_IsUndefined
#undef JS_NewCFunction
#undef JS_AtomToCString

/* ======================================================================
 * Part 1: Inline function wrappers
 * ====================================================================== */

__attribute__((visibility("default")))
const char *JS_ToCString(JSContext *ctx, JSValue val)
{
    return JS_ToCString_inline(ctx, val);
}

__attribute__((visibility("default")))
JSValue JS_NewString(JSContext *ctx, const char *str)
{
    return JS_NewString_inline(ctx, str);
}

__attribute__((visibility("default")))
JSValue JS_NewBool(JSContext *ctx, int val)
{
    return JS_NewBool_inline(ctx, val);
}

__attribute__((visibility("default")))
JSValue JS_NewInt32(JSContext *ctx, int32_t val)
{
    return JS_NewInt32_inline(ctx, val);
}

__attribute__((visibility("default")))
JSValue JS_NewFloat64(JSContext *ctx, double val)
{
    return JS_NewFloat64_inline(ctx, val);
}

__attribute__((visibility("default")))
int JS_IsException(JSValue val)
{
    return JS_IsException_inline(val) ? 1 : 0;
}

__attribute__((visibility("default")))
int JS_IsUndefined(JSValue val)
{
    return JS_IsUndefined_inline(val) ? 1 : 0;
}

__attribute__((visibility("default")))
JSValue JS_NewCFunction(JSContext *ctx, JSCFunction *func,
                         const char *name, int length)
{
    return JS_NewCFunction_inline(ctx, func, name, length);
}

__attribute__((visibility("default")))
const char *JS_AtomToCString(JSContext *ctx, JSAtom atom)
{
    return JS_AtomToCString_inline(ctx, atom);
}

/* ======================================================================
 * Part 2: C trampolines for host functions
 *
 * LuaJIT cannot create FFI callbacks that return structs by value.
 * These C trampolines act as JSCFunctions (returning JSValue) but
 * delegate to Lua callbacks that use pointer-based signatures:
 *
 *   typedef void (*HostCallback)(JSContext *ctx, int argc,
 *                                JSValue *argv, JSValue *ret);
 *
 * Lua sets the return value by writing to *ret. The trampoline
 * returns the value to QuickJS.
 * ====================================================================== */

typedef void (*HostCallback)(JSContext *ctx, int argc,
                             JSValue *argv, JSValue *ret);

static HostCallback host_flush_cb    = NULL;
static HostCallback host_events_cb   = NULL;
static HostCallback host_log_cb      = NULL;
static HostCallback host_measure_cb  = NULL;
static HostCallback host_report_error_cb = NULL;

static JSValue trampoline_flush(JSContext *ctx, JSValue this_val,
                                int argc, JSValue *argv)
{
    JSValue ret = JS_UNDEFINED;
    if (host_flush_cb) host_flush_cb(ctx, argc, argv, &ret);
    return ret;
}

static JSValue trampoline_events(JSContext *ctx, JSValue this_val,
                                 int argc, JSValue *argv)
{
    JSValue ret = JS_UNDEFINED;
    if (host_events_cb) host_events_cb(ctx, argc, argv, &ret);
    return ret;
}

static JSValue trampoline_log(JSContext *ctx, JSValue this_val,
                              int argc, JSValue *argv)
{
    JSValue ret = JS_UNDEFINED;
    if (host_log_cb) host_log_cb(ctx, argc, argv, &ret);
    return ret;
}

static JSValue trampoline_measure(JSContext *ctx, JSValue this_val,
                                  int argc, JSValue *argv)
{
    JSValue ret = JS_UNDEFINED;
    if (host_measure_cb) host_measure_cb(ctx, argc, argv, &ret);
    return ret;
}

static JSValue trampoline_report_error(JSContext *ctx, JSValue this_val,
                                       int argc, JSValue *argv)
{
    JSValue ret = JS_UNDEFINED;
    if (host_report_error_cb) host_report_error_cb(ctx, argc, argv, &ret);
    return ret;
}

/* Lua calls these to set the callback handlers */

__attribute__((visibility("default")))
void qjs_set_host_flush(HostCallback cb) { host_flush_cb = cb; }

__attribute__((visibility("default")))
void qjs_set_host_events(HostCallback cb) { host_events_cb = cb; }

__attribute__((visibility("default")))
void qjs_set_host_log(HostCallback cb) { host_log_cb = cb; }

__attribute__((visibility("default")))
void qjs_set_host_measure(HostCallback cb) { host_measure_cb = cb; }

__attribute__((visibility("default")))
void qjs_set_host_report_error(HostCallback cb) { host_report_error_cb = cb; }

/* Register all host functions as JS globals.
 * Call after setting the callbacks. */

__attribute__((visibility("default")))
void qjs_register_host_functions(JSContext *ctx)
{
    JSValue global = JS_GetGlobalObject(ctx);

    JS_SetPropertyStr(ctx, global, "__hostFlush",
        JS_NewCFunction_inline(ctx, trampoline_flush, "__hostFlush", 1));

    JS_SetPropertyStr(ctx, global, "__hostGetEvents",
        JS_NewCFunction_inline(ctx, trampoline_events, "__hostGetEvents", 0));

    JS_SetPropertyStr(ctx, global, "__hostLog",
        JS_NewCFunction_inline(ctx, trampoline_log, "__hostLog", 1));

    JS_SetPropertyStr(ctx, global, "__hostMeasureText",
        JS_NewCFunction_inline(ctx, trampoline_measure, "__hostMeasureText", 1));

    JS_SetPropertyStr(ctx, global, "__hostReportError",
        JS_NewCFunction_inline(ctx, trampoline_report_error, "__hostReportError", 1));

    JS_FreeValue(ctx, global);
}
