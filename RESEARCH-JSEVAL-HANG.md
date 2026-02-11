# Research: JS_Eval Hang When Evaluating React 18 Bundle in QuickJS-ng

## Executive Summary

**Root cause:** The hang is NOT caused by `JS_Eval` failing to return. `JS_Eval` itself does return. The hang is caused by React 18's scheduler calling `setTimeout(performWorkUntilDeadline, 0)` as part of `root.render()`, and this polyfilled `setTimeout` stores the callback in a JS-side `_timers` array that **never gets ticked during the initial eval**. However, the real issue is that React's legacy sync rendering path (`flushSyncCallbacksOnlyInLegacyMode`) executes the entire render **synchronously inline** during `updateContainer`, and the subsequent `ensureRootIsScheduled` call kicks off the scheduler's `scheduleCallback -> requestHostCallback -> schedulePerformWorkUntilDeadline -> setTimeout(performWorkUntilDeadline, 0)` chain. Because the polyfilled `setTimeout` is a no-op queue (callbacks are only fired when `__tickTimers()` is called from Lua), this part works fine for deferral. **The actual problem is that the IIFE's `console.log` at line 21513 fires (confirming the IIFE completes), but a sentinel appended AFTER `})();` never executes** -- this means `JS_Eval` itself is hanging, not the IIFE.

After deep analysis, the true root cause is: **`js_std_init_handlers` + the polyfilled `setTimeout` create a situation where the QuickJS `os` module's timer infrastructure conflicts with the JS-side timer polyfill, OR the Promise microtask queue creates an infinite draining loop during eval.**

---

## Finding 1: JS_Eval Does NOT Drain the Promise/Microtask Queue

### Code Path Analysis

`JS_Eval` (quickjs.c:36495) is a thin wrapper:

```c
// quickjs.c:36495-36505
JSValue JS_Eval(JSContext *ctx, const char *input, size_t input_len,
                const char *filename, int eval_flags)
{
    JSEvalOptions options = {
        .version = JS_EVAL_OPTIONS_VERSION,
        .filename = filename,
        .line_num = 1,
        .eval_flags = eval_flags
    };
    return JS_EvalThis2(ctx, ctx->global_obj, input, input_len, &options);
}
```

`JS_EvalThis2` (quickjs.c:36470) calls `JS_EvalInternal` (quickjs.c:36422), which delegates to `__JS_EvalInternal` (quickjs.c:36305).

For a global eval (non-module, non-async), the critical path is:

```c
// quickjs.c:36408-36410
if (flags & JS_EVAL_FLAG_COMPILE_ONLY) {
    ret_val = fun_obj;
} else {
    ret_val = JS_EvalFunctionInternal(ctx, fun_obj, this_obj, var_refs, sf);
}
return ret_val;
```

`JS_EvalFunctionInternal` (quickjs.c:36264) for bytecode simply does:

```c
// quickjs.c:36272-36274
if (tag == JS_TAG_FUNCTION_BYTECODE) {
    fun_obj = js_closure(ctx, fun_obj, var_refs, sf);
    ret_val = JS_CallFree(ctx, fun_obj, this_obj, 0, NULL);
}
```

**`JS_CallFree` just calls the function and frees it. There is NO microtask/job queue draining anywhere in this path.** The job queue is only drained by explicit calls to `JS_ExecutePendingJob` (quickjs.c:2123), which must be called by the embedder (e.g., `js_std_loop` or the Lua bridge's `Bridge:tick()`).

**Key insight:** Promise `.then()` callbacks and `queueMicrotask` callbacks are enqueued via `JS_EnqueueJob` (quickjs.c:2094) into `rt->job_list`, but they are NOT automatically executed. They sit in the queue until the embedder calls `JS_ExecutePendingJob`.

### The Job Queue API

```c
// quickjs.c:2094-2113
int JS_EnqueueJob(JSContext *ctx, JSJobFunc *job_func,
                  int argc, JSValueConst *argv)
{
    // ... adds to rt->job_list (linked list) ...
    list_add_tail(&e->link, &rt->job_list);
    return 0;
}

// quickjs.c:2123-2150
int JS_ExecutePendingJob(JSRuntime *rt, JSContext **pctx)
{
    if (list_empty(&rt->job_list)) {
        *pctx = NULL;
        return 0;  // no job pending
    }
    // executes ONE job, returns 1 on success, -1 on exception
    e = list_entry(rt->job_list.next, JSJobEntry, link);
    list_del(&e->link);
    res = e->job_func(e->ctx, e->argc, vc(e->argv));
    // ...
}
```

**Conclusion: `JS_Eval` does NOT drain the job queue. This rules out infinite Promise chains as the cause of the hang within `JS_Eval` itself.**

---

## Finding 2: js_std_init_handlers and js_std_add_helpers

### js_std_init_handlers (quickjs-libc.c:4532)

```c
void js_std_init_handlers(JSRuntime *rt)
{
    JSThreadState *ts;
    ts = js_mallocz_rt(rt, sizeof(*ts));
    // ...
    init_list_head(&ts->os_rw_handlers);
    init_list_head(&ts->os_signal_handlers);
    init_list_head(&ts->os_timers);
    init_list_head(&ts->port_list);
    init_list_head(&ts->rejected_promise_list);
    ts->next_timer_id = 1;
    js_set_thread_state(rt, ts);
    JS_AddRuntimeFinalizer(rt, js_std_finalize, ts);
}
```

This initializes the `JSThreadState` structure with empty handler lists. It does NOT install any event loop, setTimeout global, or polling mechanism. It sets `can_js_os_poll = false` (default zero from `js_mallocz_rt`).

**However**, this is a prerequisite for the `os` module. The `os` module's `js_os_init` (quickjs-libc.c:4387) sets `ts->can_js_os_poll = true` (line 4392), which enables the blocking poll loop in `js_std_loop` and `js_os_poll`.

### js_std_add_helpers (quickjs-libc.c:4497)

```c
void js_std_add_helpers(JSContext *ctx, int argc, char **argv)
{
    JSValue global_obj, console, args;
    global_obj = JS_GetGlobalObject(ctx);
    console = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, console, "log",
                      JS_NewCFunction(ctx, js_print, "log", 1));
    JS_SetPropertyStr(ctx, global_obj, "console", console);
    // ... adds scriptArgs, print ...
}
```

This ONLY adds `console.log`, `console` object, `print`, and `scriptArgs`. **It does NOT add `setTimeout`, `setInterval`, or any event loop.** Those are only available through `import * as os from 'os'` (the `os` module).

**Conclusion: Neither function installs an event loop or blocking mechanism. They are safe to call. The `os` module is NOT loaded by the Lua bridge, so `can_js_os_poll` remains `false`.**

### Important note about js_std_loop

The standard `js_std_loop` (quickjs-libc.c:4706) is an infinite loop that drains jobs and polls for I/O:

```c
int js_std_loop(JSContext *ctx)
{
    for(;;) {
        for(;;) {
            err = JS_ExecutePendingJob(JS_GetRuntime(ctx), &ctx1);
            if (err <= 0) {
                if (err < 0) goto done;
                break;
            }
        }
        js_std_promise_rejection_check(ctx);
        if (!ts->can_js_os_poll || js_os_poll(ctx))
            break;
    }
}
```

Since `can_js_os_poll` is `false` (the `os` module is never loaded), calling `js_std_loop` would drain pending jobs once and then `break` immediately. **The Lua bridge does NOT call `js_std_loop` -- it manually calls `JS_ExecutePendingJob` in `Bridge:tick()`.**

---

## Finding 3: React 18 Scheduler Behavior in the Bundle

### Scheduler Initialization (bundle.js lines 2303-2319)

The React scheduler's `schedulePerformWorkUntilDeadline` is configured by feature detection:

```javascript
// bundle.js:2303-2319
var schedulePerformWorkUntilDeadline;
if (typeof localSetImmediate === "function") {
    schedulePerformWorkUntilDeadline = function() {
        localSetImmediate(performWorkUntilDeadline);  // Path 1: setImmediate
    };
} else if (typeof MessageChannel !== "undefined") {
    var channel = new MessageChannel();
    var port = channel.port2;
    channel.port1.onmessage = performWorkUntilDeadline;
    schedulePerformWorkUntilDeadline = function() {
        port.postMessage(null);                        // Path 2: MessageChannel
    };
} else {
    schedulePerformWorkUntilDeadline = function() {
        localSetTimeout(performWorkUntilDeadline, 0);  // Path 3: setTimeout fallback
    };
}
```

In QuickJS-ng:
- `setImmediate` is NOT defined -> Path 1 skipped
- `MessageChannel` is NOT defined -> Path 2 skipped
- `setTimeout` IS defined (via the polyfill) -> **Path 3 is used**

Where `localSetTimeout` is captured at bundle.js:2027:
```javascript
var localSetTimeout = typeof setTimeout === "function" ? setTimeout : null;
```

### The Scheduling Chain

When `root.render()` is called (bundle.js:21510-21512):

1. `updateContainer` (line 17107) calls `scheduleUpdateOnFiber` (line 14843)
2. `scheduleUpdateOnFiber` calls `ensureRootIsScheduled` (line 14873)
3. Since this is `LegacyRoot` (tag=0, line 3527) and `SyncLane`:
   - `scheduleLegacySyncCallback(performSyncWorkOnRoot.bind(null, root2))` (line 14928)
   - Since `supportsMicrotasks` is `undefined`/falsy (not in hostConfig):
     - Falls to `else` branch (line 14942): `scheduleCallback$1(ImmediatePriority, flushSyncCallbacks)` (line 14943)
4. `scheduleCallback$1` calls `scheduleCallback` (= `unstable_scheduleCallback`, line 2179)
5. `unstable_scheduleCallback` pushes a task and calls `requestHostCallback(flushWork)` (line 2236)
6. `requestHostCallback` calls `schedulePerformWorkUntilDeadline()` (line 2324)
7. `schedulePerformWorkUntilDeadline` calls `localSetTimeout(performWorkUntilDeadline, 0)` (line 2317)

Then back in `scheduleUpdateOnFiber`, because this is `SyncLane`, `LegacyRoot`, and `executionContext === NoContext`:
- `flushSyncCallbacksOnlyInLegacyMode()` is called (line 14877)
- This calls `flushSyncCallbacks()` which **synchronously executes `performSyncWorkOnRoot`** (lines 4582-4611)

**This means the entire React render tree is built synchronously during `root.render()`.** The `setTimeout(performWorkUntilDeadline, 0)` from step 7 is a deferred cleanup/continuation that sits in the polyfill's `_timers` array.

### The performWorkUntilDeadline Loop (bundle.js:2283-2302)

```javascript
var performWorkUntilDeadline = function() {
    if (scheduledHostCallback !== null) {
        var hasMoreWork = true;
        try {
            hasMoreWork = scheduledHostCallback(hasTimeRemaining, currentTime);
        } finally {
            if (hasMoreWork) {
                schedulePerformWorkUntilDeadline();  // RE-SCHEDULES ITSELF
            } else {
                isMessageLoopRunning = false;
                scheduledHostCallback = null;
            }
        }
    }
};
```

**If `hasMoreWork` is true, it calls `schedulePerformWorkUntilDeadline()` again, which calls `setTimeout(performWorkUntilDeadline, 0)` again.** This creates a recurring timer chain. In a browser, this is fine because `setTimeout` yields to the event loop. In QuickJS with the polyfill, each `setTimeout` just pushes to `_timers[]` which only fires when `__tickTimers()` is called from Lua.

### Effects During Commit Phase

After the sync render completes, React runs effects. `scheduleCallback$1(NormalPriority, ...)` is called in several places:

- `flushPassiveEffects` path (bundle.js:15674): `scheduleCallback$1(NormalPriority, function() { flushPassiveEffects(); ... })`
- Root callback scheduling (bundle.js:15807): `scheduleCallback$1(NormalPriority, function() { ... })`

Each of these calls `requestHostCallback -> schedulePerformWorkUntilDeadline -> setTimeout(performWorkUntilDeadline, 0)`.

---

## Finding 4: Revised Root Cause Analysis

Given that:
1. `JS_Eval` does NOT drain the microtask queue
2. `js_std_init_handlers` does NOT install an event loop
3. The sync render path executes fully inline
4. `console.log` at line 21513 fires (the IIFE body completes)
5. A sentinel AFTER `})();` does NOT execute

**The problem is that `JS_Eval` is being called on the entire file which includes `})();` followed by license comments (lines 21514-21560). The return value of the IIFE is being computed, but something in the IIFE's execution is preventing `JS_Eval` from returning.**

### Revised hypothesis: The synchronous render itself is the problem

When `root.render()` triggers `flushSyncCallbacksOnlyInLegacyMode()`, this synchronously calls `performSyncWorkOnRoot`, which calls `workLoopSync` (line 15463):

```javascript
// bundle.js:15482
function workLoopSync() {
    while (workInProgress !== null) {
        performUnitOfWork(workInProgress);
    }
}
```

This loop processes the entire React component tree. For a complex storybook with many components, this could involve:
- Creating many fiber nodes
- Running all component functions
- Building the full virtual tree
- Committing mutations (calling `emit()` for each CREATE/APPEND operation)

If any component or effect triggers another synchronous render cycle, or if the tree is deeply recursive, this could take a very long time or even infinite-loop in pathological cases.

### Alternative hypothesis: Promise chain during render

React 18's reconciler uses `scheduleMicrotask` in the sync lane path when `supportsMicrotasks` is true. In this bundle, `supportsMicrotasks` comes from `$$$hostConfig.supportsMicrotasks` (line 2962). Looking at the hostConfig (lines 18539-18711), **`supportsMicrotasks` is NOT set**, so it's `undefined`/falsy.

This means React falls back to `scheduleCallback$1(ImmediatePriority, flushSyncCallbacks)` (line 14943) instead of using microtasks. This path calls `unstable_scheduleCallback` which calls `requestHostCallback(flushWork)`.

**But `requestHostCallback` then calls `schedulePerformWorkUntilDeadline()` which calls `setTimeout(performWorkUntilDeadline, 0)`.** If the polyfilled `setTimeout` is not actually deferring but somehow executing synchronously (e.g., if `__tickTimers` is called during the render), this could create an infinite synchronous loop.

### Most likely root cause: The polyfilled setTimeout executes callbacks synchronously

Looking at the polyfill in bridge_quickjs.lua (lines 401-437):

```javascript
globalThis.setTimeout = function(fn, ms) {
    const id = ++_timerId;
    _timers.push({ id, fn, at: Date.now() + (ms || 0) });
    return id;
};
```

And the tick function:
```javascript
globalThis.__tickTimers = function() {
    const now = Date.now();
    const ready = _timers.filter(t => t.at <= now);
    for (const t of ready) {
        t.fn();
        if (!t.interval) {
            const idx = _timers.indexOf(t);
            if (idx !== -1) _timers.splice(idx, 1);
        }
    }
};
```

The `setTimeout` polyfill with `ms=0` sets `at: Date.now() + 0`, meaning the timer is immediately ready. If `__tickTimers()` is called from anywhere during the React render, it would fire `performWorkUntilDeadline`, which would call `flushWork -> workLoop`, and if `workLoop` returns `hasMoreWork=true`, it would call `schedulePerformWorkUntilDeadline()` again, pushing another timer that's immediately ready...

**However**, `__tickTimers` is only called from `Bridge:tick()` in Lua (line 580), which is NOT called during `JS_Eval`. So this shouldn't be the issue.

### ACTUAL Root Cause: queueMicrotask override creates a setTimeout(fn, 0) that is never drained

Wait -- re-reading the polyfill more carefully:

```javascript
// bridge_quickjs.lua lines 442-444
globalThis.queueMicrotask = function(fn) {
    globalThis.setTimeout(fn, 0);
};
```

This redirects `queueMicrotask` to `setTimeout`, but the native `queueMicrotask` in QuickJS (quickjs.c:39141) uses `JS_EnqueueJob` which puts callbacks in the job queue. **The polyfill overrides the native `queueMicrotask` to use `setTimeout` instead.**

But QuickJS already has a native `queueMicrotask` (quickjs.c:53683):
```c
JS_CFUNC_DEF("queueMicrotask", 1, js_global_queueMicrotask),
```

The polyfill override at bridge_quickjs.lua:442 replaces this native implementation. Since Promise `.then()` uses `JS_EnqueueJob` directly (NOT `queueMicrotask`), Promise microtasks still go into the QuickJS job queue regardless of the `queueMicrotask` polyfill.

### THE ACTUAL SMOKING GUN

Looking at the flow again carefully:

1. `root.render()` calls `ensureRootIsScheduled`
2. `ensureRootIsScheduled` (since SyncLane + LegacyRoot + !supportsMicrotasks) calls:
   - `scheduleLegacySyncCallback(performSyncWorkOnRoot.bind(null, root2))` -- pushes to `syncQueue`
   - `scheduleCallback$1(ImmediatePriority, flushSyncCallbacks)` -- this schedules via the Scheduler
3. The Scheduler's `unstable_scheduleCallback` (line 2231-2237) pushes to `taskQueue` and calls `requestHostCallback(flushWork)`
4. `requestHostCallback` calls `schedulePerformWorkUntilDeadline()` -> `setTimeout(performWorkUntilDeadline, 0)`
5. Back in `scheduleUpdateOnFiber`, `flushSyncCallbacksOnlyInLegacyMode()` runs synchronously:
   - Calls `flushSyncCallbacks()` which runs `performSyncWorkOnRoot` synchronously
   - The render completes, mutations are committed
6. Now `performSyncWorkOnRoot` calls `ensureRootIsScheduled` again at the end of its execution
7. This may schedule MORE Scheduler tasks

The IIFE code at line 21513 (`console.log(...)`) fires AFTER `root.render()` returns, confirming the synchronous render completed.

**If `JS_Eval` returns after the IIFE but the sentinel AFTER `})();` doesn't run, the issue could be in the Lua layer** -- perhaps `JS_Eval` returns a value that looks like an exception, or there's a segfault/crash after the eval returns.

### Re-examining the evidence

The user says:
- "The React bundle's IIFE runs to completion (console.log fires)"
- "A `__hostLog('SENTINEL')` appended AFTER the IIFE's `})();` never executes"

This means the user is appending `__hostLog('SENTINEL')` to the source code AFTER `})();`. The JS code would look like:

```javascript
var ReactLoveStorybook = (() => {
    // ... 21000+ lines ...
    console.log("[react-love] Native storybook mounted ...");
})();
__hostLog('SENTINEL');
```

The fact that the console.log inside the IIFE fires but `__hostLog('SENTINEL')` after it does NOT fire means **execution hangs or crashes between the end of the IIFE and the next statement**.

The IIFE returns the value of its last expression. Looking at the IIFE's structure (line 1: `var ReactLoveStorybook = (() => {`), the arrow function's body uses curly braces, so the return value is `undefined` unless there's an explicit `return`. The assignment `var ReactLoveStorybook = (...)();` would set the variable to `undefined`.

**But the critical observation is: `root.render()` at line 21510-21512 returns `undefined` (the `render` method returns nothing). After that, `console.log(...)` runs at line 21513. Then the IIFE closes at line 21514 with `})();`. The IIFE's implicit return is `undefined`.**

So the IIFE executes fully. The hang must be between `})();` and the next statement. This could be:

1. **A pending Promise reaction that QuickJS drains between top-level statements** -- but we showed `JS_Eval` does NOT drain the queue
2. **A segfault or memory corruption** from the large number of FFI calls during the render
3. **The `JS_Eval` of the license comment block** (lines 21515-21560 are multi-line comments) causing a parser issue

Actually wait -- looking more carefully, the bundle ends with:
```
})();
/*! Bundled license information: ... */
```

If the sentinel is appended AFTER the entire file including the comment, this should be fine. But if there's a null byte or encoding issue in the license comments...

### Actually -- rechecking the Lua eval call

```lua
-- bridge_quickjs.lua:555-571
function Bridge:eval(code, filename)
    filename = filename or "<eval>"
    local val = self.qjs.JS_Eval(
        self.ctx, code, #code, filename, JS_EVAL_TYPE_GLOBAL
    )
    -- JS_Eval should return here...
```

The user says JS_Eval never returns. The console.log fires because it's a side effect during the IIFE's execution (which happens inside JS_Eval). JS_Eval is supposed to return AFTER all code has executed.

**NEW THEORY:** The polyfilled `setTimeout` with `delay=0` stores callbacks with `at: Date.now()`. During the React render, MANY `setTimeout(fn, 0)` calls are made. These all go into `_timers[]`. But `_timers` is a JS variable -- no problem, they just sit there.

The issue might be that the **QuickJS interpreter is running the IIFE which takes a very long time due to the 956KB of code**, and the LuaJIT FFI call blocks until it returns. If the synchronous React render inside the IIFE takes a very long time (building hundreds of fiber nodes, calling many component functions), it could appear to hang.

### Final determination

After thorough analysis, the most likely causes are:

**Cause A (Most Likely): The synchronous render is extremely slow or infinite-looping**

During `flushSyncCallbacks` -> `performSyncWorkOnRoot` -> `workLoopSync`, React processes the entire component tree. If any component triggers a state update during render (e.g., via `useSyncExternalStore`, or a `setState` in render), this could cause `ensureRootIsScheduled` to be called again, leading to an infinite render loop within the synchronous `flushSyncCallbacks` call.

Look at `flushSyncCallbacks` (line 4582):
```javascript
for (; i < queue.length; i++) {
    var callback = queue[i];
    do {
        callback = callback(isSync);
    } while (callback !== null);
}
```

If `callback` (which is `performSyncWorkOnRoot`) returns itself or another function, this `do/while` loop runs forever.

**Cause B: Promise chain creates microtask storm when `JS_ExecutePendingJob` is never called**

Although `JS_Eval` doesn't drain the queue, Promise reactions pile up. If some code in the bundle does `await` or uses Promise chains that expect to resolve during the eval, the code after the `await` would never execute (it's queued as a job but never drained). This wouldn't cause a hang though -- it would just leave unfinished promises.

---

## Finding 5: JS_EVAL_FLAG_ASYNC

### What it does (quickjs.c:36374-36377)

```c
if (m != NULL || (flags & JS_EVAL_FLAG_ASYNC)) {
    fd->in_function_body = true;
    fd->func_kind = JS_FUNC_ASYNC;
}
```

`JS_EVAL_FLAG_ASYNC` (defined in quickjs.h:464 as `(1 << 7)`, value 128) wraps the entire eval in an async function. This means:

1. The eval code is treated as the body of an `async function`
2. The return value is a **Promise** (not the direct result)
3. Any `await` expressions in the eval code would work at the top level
4. The Promise won't resolve until all awaited values resolve

**This would NOT help with the hang.** In fact, it would make things worse because:
- The eval would return a Promise immediately
- But the Promise's resolution depends on draining the job queue
- The caller would need to use `js_std_await` (quickjs-libc.c:4769) to wait for it, which internally calls `JS_ExecutePendingJob` in a loop
- The Lua bridge doesn't call `js_std_await`

---

## Finding 6: Recommended Solutions

### Solution 1: Split eval and render (Recommended)

Don't call `root.render()` inside the IIFE that's passed to `JS_Eval`. Instead:

1. Eval the bundle (defines `ReactLoveStorybook` and all modules)
2. Return control to Lua
3. Call `root.render()` separately via a second `JS_Eval` or by calling a JS function
4. Tick the Lua event loop (`Bridge:tick()`) each frame to drain promises and timers

This way the heavy synchronous render happens in a controlled context where you can interleave timer ticks.

### Solution 2: Disable synchronous rendering (use concurrent mode)

Change the `createContainer` call from using `LegacyRoot` (tag 0) to `ConcurrentRoot` (tag 1):

```javascript
// In the host config / createRoot function (bundle.js:18926)
const fiberRoot = reconciler.createContainer(
    containerInfo,
    1,        // tag: ConcurrentRoot instead of 0 (LegacyRoot)
    // ...
);
```

In concurrent mode, React uses `scheduleCallback` with normal priority instead of synchronous `flushSyncCallbacks`. This means the render work is deferred to `setTimeout` callbacks, which only execute when `__tickTimers()` is called from Lua. This gives control back to the Lua event loop between work chunks.

### Solution 3: Add `supportsMicrotasks: true` with a controlled microtask implementation

Add to the hostConfig:

```javascript
supportsMicrotasks: true,
scheduleMicrotask: queueMicrotask,  // or a custom implementation
```

When `supportsMicrotasks` is truthy (bundle.js:14932), React uses `scheduleMicrotask` for sync lane flushing instead of `scheduleCallback$1(ImmediatePriority, flushSyncCallbacks)`. This avoids the Scheduler's `requestHostCallback` -> `setTimeout` chain for the initial sync work.

However, this only helps if `queueMicrotask` is properly redirected to the timer queue.

### Solution 4: Pre-patch the Scheduler before the bundle runs

Before evaluating the React bundle, eval a script that stubs `MessageChannel` and `setImmediate` to ensure the scheduler uses the controlled `setTimeout` path, AND patches the scheduler's `shouldYieldToHost` to always return `true` after a time limit:

```javascript
// Force scheduler to yield frequently
globalThis.__REACT_SCHEDULER_FORCE_YIELD = true;
```

However, this requires modifying the bundle or injecting code before it runs.

### Solution 5: Use `js_std_loop_once` from C

QuickJS-ng provides `js_std_loop_once` (quickjs-libc.c:4733) which drains all pending jobs, runs at most one expired timer, and returns the next timer delay. This could be called from Lua via FFI each frame instead of the manual `JS_ExecutePendingJob` + `__tickTimers` approach:

```c
int js_std_loop_once(JSContext *ctx)
{
    // Drains ALL pending microtasks
    for(;;) {
        err = JS_ExecutePendingJob(rt, &ctx1);
        if (err < 0) return -2;
        if (err == 0) break;
    }
    // Runs at most one expired timer
    if (js_os_run_timers(rt, ctx, ts, &min_delay) < 0)
        return -2;
    // Returns: 0 = more work, >0 = next timer ms, -1 = idle
}
```

**But this requires the `os` module to be loaded** (for `js_os_run_timers` to have timers to run). If you're using a JS-side timer polyfill, this won't help with the timers.

---

## Summary of Key Line References

| File | Line(s) | What |
|------|---------|------|
| quickjs.c | 36495-36505 | `JS_Eval` - thin wrapper, no queue draining |
| quickjs.c | 36264-36294 | `JS_EvalFunctionInternal` - calls function, returns result |
| quickjs.c | 2123-2150 | `JS_ExecutePendingJob` - drains ONE job from queue |
| quickjs.c | 2094-2113 | `JS_EnqueueJob` - adds to job list (used by Promise, queueMicrotask) |
| quickjs.c | 39141-39148 | Native `queueMicrotask` implementation (uses JS_EnqueueJob) |
| quickjs.c | 36374-36377 | `JS_EVAL_FLAG_ASYNC` makes eval async (returns Promise) |
| quickjs-libc.c | 4532-4563 | `js_std_init_handlers` - inits thread state, NO event loop |
| quickjs-libc.c | 4497-4523 | `js_std_add_helpers` - adds console.log only, NO setTimeout |
| quickjs-libc.c | 4706-4731 | `js_std_loop` - event loop (NOT called by Lua bridge) |
| quickjs-libc.c | 4733-4764 | `js_std_loop_once` - single iteration event loop |
| quickjs-libc.c | 2393-2421 | `js_os_setTimeout` - only available in `os` module, NOT global |
| quickjs-libc.c | 4392 | `can_js_os_poll = true` - only set when `os` module loads |
| bundle.js | 2303-2319 | Scheduler selects `setTimeout` fallback (no MessageChannel) |
| bundle.js | 2283-2302 | `performWorkUntilDeadline` - re-schedules itself if hasMoreWork |
| bundle.js | 2320-2326 | `requestHostCallback` - triggers scheduler loop |
| bundle.js | 14843-14880 | `scheduleUpdateOnFiber` - entry point from `root.render()` |
| bundle.js | 14894-14969 | `ensureRootIsScheduled` - LegacyRoot + SyncLane path |
| bundle.js | 14932-14944 | `supportsMicrotasks` branch (false -> uses scheduleCallback) |
| bundle.js | 4577-4611 | `flushSyncCallbacks` - synchronous render loop |
| bundle.js | 15482-15488 | `workLoopSync` - processes all fibers synchronously |
| bundle.js | 18539-18711 | hostConfig - `supportsMicrotasks` NOT set |
| bundle.js | 18926-18943 | `createContainer` with tag=0 (LegacyRoot) |
| bundle.js | 21508-21514 | Bundle entry: `root.render()` then console.log |
| bridge_quickjs.lua | 370-382 | Runtime creation, `js_std_init_handlers` call |
| bridge_quickjs.lua | 393-445 | Polyfills: setTimeout, queueMicrotask override |
| bridge_quickjs.lua | 555-571 | `Bridge:eval` - calls JS_Eval |
| bridge_quickjs.lua | 574-581 | `Bridge:tick` - drains jobs + ticks timers |

---

## Debugging Recommendations

1. **Add timing around `JS_Eval`** in the Lua bridge to confirm it truly never returns (vs. takes very long)

2. **Try evaluating the bundle WITHOUT `root.render()`** -- modify the bundle so the IIFE defines everything but doesn't call render. If JS_Eval returns, the hang is in the synchronous render.

3. **Add a counter to `workLoopSync`** to detect infinite render loops:
   ```javascript
   function workLoopSync() {
       let count = 0;
       while (workInProgress !== null) {
           if (++count > 100000) { console.log('INFINITE RENDER LOOP'); break; }
           performUnitOfWork(workInProgress);
       }
   }
   ```

4. **Check if `flushSyncCallbacks`' do/while loop is infinite** by adding logging to `performSyncWorkOnRoot` to see if it returns a continuation function.

5. **Try switching to ConcurrentRoot** (tag=1 in createContainer) to avoid the synchronous `flushSyncCallbacks` path entirely.
