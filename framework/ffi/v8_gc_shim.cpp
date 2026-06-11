// Real V8 GC wall-time, measured at V8's own boundary — not inferred.
//
// Same mangled-symbol trick as v8_stack_shim.cpp: the prebuilt libc_v8.a does
// NOT expose the zig-v8 binding wrappers for AddGCPrologueCallback /
// AddGCEpilogueCallback, and we don't have V8 headers checked in. But the two
// V8 methods ARE defined symbols in the prebuilt (verified with `nm`), so we
// declare their mangled names and call them directly. C++ Itanium ABI is stable
// on Linux/macOS x86_64.
//
// Why this exists: the spikewatch classifier used to lump "outside every render
// phase" into a single guess — "GC / NATIVE — could be V8 GC, vsync wait, or
// native bridge." We own the whole stack; we should KNOW which fired, not offer
// multiple choice. This shim hangs a prologue/epilogue pair on the isolate and
// accumulates the REAL pause wall-time per frame, plus the GC type, so the
// report can name "V8 GC 11.3ms (mark-sweep)" definitively.
//
// Provides (extern "C", consumed by framework/v8_runtime.zig):
//   void     rjit_v8_gc_install(void* isolate)  — register the callbacks once
//   uint64_t rjit_v8_gc_take_ns(void)           — GC ns since last call; resets
//   uint32_t rjit_v8_gc_take_count(void)        — GC invocations since last; resets
//   int      rjit_v8_gc_last_type(void)         — last GCType bitmask seen

#include <stdint.h>
#include <time.h>

namespace v8 {
class Isolate;
}

// The V8 callback shape is void(Isolate*, GCType, GCCallbackFlags). GCType and
// GCCallbackFlags are plain C++ enums (int-sized), so int matches the ABI. We
// declare our callback with int params and the mangled extern with a matching
// function-pointer type — extern "C" on the literal mangled name means the
// compiler emits a call to exactly that symbol with no re-mangling.
typedef void (*RjitGcCallback)(v8::Isolate*, int /*GCType*/, int /*GCCallbackFlags*/);

// v8::Isolate::AddGCPrologueCallback(void(*)(Isolate*,GCType,GCCallbackFlags), GCType)
extern "C" void _ZN2v87Isolate21AddGCPrologueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEES2_(
    v8::Isolate*, RjitGcCallback, int);
// v8::Isolate::AddGCEpilogueCallback(void(*)(Isolate*,GCType,GCCallbackFlags), GCType)
extern "C" void _ZN2v87Isolate21AddGCEpilogueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEES2_(
    v8::Isolate*, RjitGcCallback, int);

// GCType bitmask (V8): kGCTypeScavenge=1, kGCTypeMinorMarkSweep=2,
// kGCTypeMarkSweepCompact=4, kGCTypeIncrementalMarking=8,
// kGCTypeProcessWeakCallbacks=16. kGCTypeAll = all of the above.
static const int kRjitGCTypeAll = 1 | 2 | 4 | 8 | 16;

// Single-threaded state: V8 runs on the engine's main thread and the GC
// prologue/epilogue fire synchronously on that same thread, so plain globals are
// safe (no atomics needed).
static uint64_t g_gc_accum_ns = 0; // summed pause time since the last take
static uint64_t g_gc_start_ns = 0; // prologue timestamp of the in-flight GC
static uint32_t g_gc_count = 0;    // GC invocations (prologue/epilogue pairs) since take
static int g_gc_last_type = 0;     // GCType of the most recent GC

static uint64_t now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}

static void rjit_gc_prologue(v8::Isolate*, int type, int /*flags*/) {
    g_gc_last_type = type;
    g_gc_start_ns = now_ns();
}

static void rjit_gc_epilogue(v8::Isolate*, int type, int /*flags*/) {
    g_gc_last_type = type;
    // Prologue/epilogue are paired per GC invocation on the main thread (each
    // incremental-marking step gets its own pair too), so accumulating per pair
    // sums the real pause wall-time. If a prologue was somehow missed, skip.
    if (g_gc_start_ns != 0) {
        const uint64_t end = now_ns();
        if (end > g_gc_start_ns) g_gc_accum_ns += (end - g_gc_start_ns);
        g_gc_start_ns = 0;
    }
    // One completed pair == one GC invocation. The count is the disambiguator:
    // "GC 0ns ×3" (fired, tiny) is NOT "GC 0ns ×0" (binding dead / never fired).
    g_gc_count += 1;
}

extern "C" void rjit_v8_gc_install(v8::Isolate* iso) {
    _ZN2v87Isolate21AddGCPrologueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEES2_(
        iso, rjit_gc_prologue, kRjitGCTypeAll);
    _ZN2v87Isolate21AddGCEpilogueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEES2_(
        iso, rjit_gc_epilogue, kRjitGCTypeAll);
}

// GC NANOSECONDS since the last call (resets). Nanoseconds, not microseconds: a
// sub-µs scavenge floored to integer µs reads as a misleading "0us" — exactly
// the value-ambiguity we are removing. JS formats with decimals.
extern "C" uint64_t rjit_v8_gc_take_ns(void) {
    const uint64_t ns = g_gc_accum_ns;
    g_gc_accum_ns = 0;
    return ns;
}

// GC invocation count since the last call (resets). Lets the report distinguish
// "fired N times, tiny" from "fired 0 times, binding dead."
extern "C" uint32_t rjit_v8_gc_take_count(void) {
    const uint32_t n = g_gc_count;
    g_gc_count = 0;
    return n;
}

extern "C" int rjit_v8_gc_last_type(void) {
    return g_gc_last_type;
}
