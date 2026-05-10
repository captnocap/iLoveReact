# V8 fetch pipeline

This is the end-to-end path for outbound HTTP/fetch work in the V8 runtime.
The short version for `fetch()`:

```text
cart calls installFetchShim() or installBrowserShims()
  -> globalThis.fetch(url, init)
  -> runtime/hooks/http.ts requestAsync(...)
  -> runtime/ffi.ts subscribe("http:<reqId>")
  -> globalThis.__http_request_async(JSON, reqId)
  -> framework/v8_bindings_sdk.zig dispatchHttpRequest(...)
  -> framework/net/http.zig libcurl worker pool
  -> v8_app.zig per-frame tickDrain()
  -> __ffiEmit("http:<reqId>", responseJson)
  -> setTimeout(0) listener dispatch
  -> Promise resolves with a fetch-shaped response object
```

The important rule: V8 does not provide browser `fetch` by default. The shim is
installed by JS code and rides over Reactjit host functions. There is no DOM,
no browser networking stack, no `Request`/`Response` classes, no CORS layer, and
no cookie jar.

## Source map

- `runtime/hooks/http.ts` is the JS HTTP API: sync request, async request,
  streaming request, file download, `fetch` shim, and `EventSource` shim.
- `runtime/hooks/index.ts` exports `http` and installs fetch through
  `installBrowserShims()`.
- `runtime/ffi.ts` owns `callHost`, `callHostJson`, `subscribe`, and
  `globalThis.__ffiEmit`.
- `runtime/hooks/useConnection.ts` uses `__http_stream_open` for persistent
  HTTP/SSE body streams.
- `runtime/hooks/browser_page.ts` is a separate page-fetch helper over
  `__browser_page_*`, not the normal fetch shim.
- `framework/v8_bindings_sdk.zig` registers V8 HTTP host functions, translates
  JSON request specs into Zig request structs, stores request ids, and emits
  responses back into JS.
- `framework/net/http.zig` is the async HTTP/HTTPS libcurl worker pool.
- `framework/net/ring_buffer.zig` is the fixed-capacity mutex ring used between
  worker threads and the main thread.
- `v8_app.zig` calls every binding module's `tickDrain()` once per frame.
- `docs/v8/v8_bindings_sdk.md` maps the broader SDK binding module that also
  contains these HTTP functions.

## Public JS API

The direct typed API is exported as `http`:

```ts
import { http } from '@reactjit/runtime/hooks';

const sync = http.get('https://example.com');
const asyncResp = await http.getAsync('https://example.com');
const posted = await http.postAsync(url, JSON.stringify(body), {
  'Content-Type': 'application/json',
});
```

The request shape:

```ts
interface HttpRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  via?: TransportHandle;
}

interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  error?: string;
}
```

`via` is part of the TypeScript surface, and `fetch(url, { via })` passes it
through to the JSON request. The current V8/Zig HTTP binding does not parse or
honor it. Proxying for this pipeline is currently through curl/libcurl proxy
environment variables, not Reactjit transport handles.

## Installing fetch

`globalThis.fetch` is not installed automatically by `runtime/index.tsx`.
Carts opt in:

```ts
import { installBrowserShims } from '@reactjit/runtime/hooks';

installBrowserShims();
```

`installBrowserShims()` installs:

```text
globalThis.fetch       -> runtime/hooks/http.ts installFetchShim()
globalThis.EventSource -> runtime/hooks/http.ts installEventSourceShim()
globalThis.localStorage
globalThis.WebSocket
viewport resize bridge
```

For fetch only:

```ts
import { http } from '@reactjit/runtime/hooks';

http.installFetchShim();
```

The shim shape is intentionally small:

```ts
const r = await fetch(url, init);

r.ok;          // status in 200..299
r.status;      // numeric status
r.statusText;  // always ''
r.headers.get(name);
await r.text();
await r.json();
await r.blob();        // throws
await r.arrayBuffer(); // throws
```

Supported `init` fields are `method`, `headers`, `body`, and `via`.

## Host functions

`framework/v8_bindings_sdk.zig` registers these network functions:

| Function | Used by | Meaning |
| --- | --- | --- |
| `__fetch(url)` | Legacy direct body fetch | Blocking `curl -sL --compressed`, returns body string only. |
| `__http_request_sync(specJson)` | `http.request`, `http.get`, `http.post` | Blocking request, returns JSON response string. |
| `__http_request_async(specJson, reqId)` | `http.requestAsync`, fetch shim | Queue async request and later emit `http:<reqId>`. |
| `__http_stream_open(specJson, reqId)` | `http.requestStream`, `useConnection({kind:'http'|'sse'})`, `EventSource` shim | Queue streaming request and later emit chunks/end. |
| `__http_stream_close(reqId)` | stream handles | Free the pending request-id mapping. Does not abort curl. |
| `__http_download_to_file(specJson, destPath, reqId)` | `http.download` | Stream response bytes directly to a file. |
| `__browser_page_sync(specJson)` | `browserPage.fetchPageAsync` | Separate page-fetch sync path. |
| `__browser_page_async(specJson, reqId)` | `browserPage.fetchPageAsync` fallback | Separate page-fetch async path. |

`v8_app.zig` calls `v8_bindings_sdk.registerSdk({})` during V8 app init, so
these functions are registered in the V8 global object.

## Sync HTTP path

`http.request(req)` serializes the request and calls:

```text
callHostJson('__http_request_sync', fallback, JSON.stringify(req))
```

The V8 host handler:

```text
hostHttpRequestSync
  -> parse JSON with parseHttpReq
  -> httpSyncViaCurl(req)
  -> return response JSON string
```

`httpSyncViaCurl` shells out to the `curl` CLI:

```text
curl -sSi -X <METHOD> --max-time <seconds> [-H key:value...] [--data-binary body] <url>
```

Then it parses stdout into:

```json
{"status":200,"headers":{},"body":"..."}
```

Sync details:

- It blocks the JS/frame thread while curl runs.
- It captures up to 8MB of stdout.
- `timeoutMs` is converted to whole seconds and clamped to at least one second.
- Headers are parsed from curl's response header block.
- Header keys are emitted as curl returned them; the JS fetch shim is not built
  on this path.
- It is best for small dev/script calls where blocking is acceptable.

## Async fetch path

`requestAsync(req)` creates a request id, subscribes to the matching FFI
channel, then calls the V8 host:

```text
reqId = "req" + seq
subscribe("http:<reqId>", handler)
__http_request_async(JSON.stringify(req), reqId)
```

`installFetchShim()` is a wrapper over `requestAsync`:

```text
fetch(url, init)
  -> requestAsync({ method, url, headers, body, via })
  -> response object with ok/status/text/json
```

The V8 host handler:

```text
dispatchHttpRequest(info, stream=false)
  -> net_http.init() once
  -> parseHttpReq(specJson)
  -> id = hashReqId(reqId)
  -> g_http_pending[id] = { rid: reqId, stream: false }
  -> build net_http.RequestOpts
  -> net_http.request(id, opts)
```

`parseHttpReq` reads `method`, `url`, `headers`, `body`, and `timeoutMs`.
For the async path, `timeoutMs` is currently parsed but not passed down into
`framework/net/http.zig`; libcurl uses its fixed 30-second timeout for
non-download requests.

The `net_http.request(...)` boolean return is ignored. If the native request
queue is full, JS still remains subscribed and the promise can hang because no
error event is emitted.

## Native async worker

`framework/net/http.zig` owns the libcurl worker pool.

Limits:

| Limit | Value |
| --- | --- |
| Workers | `4` |
| Request queue depth | `16` |
| Response queue depth | `16` |
| URL length | `2048` bytes |
| Headers | `16` |
| Header key/value length | `512` bytes each |
| Request body | `16KB` |
| Non-stream response body | `64KB` |
| Stream chunk body | `64KB` per chunk |
| Error string | `256` bytes |

Flow:

```text
net_http.init()
  -> curl_global_init
  -> spawn 4 worker threads

net_http.request(id, opts)
  -> copy request into fixed Request struct
  -> resolve proxy from opts.proxy or environment
  -> push into request_queue

workerMain()
  -> pop request
  -> curl_easy_perform
  -> push Response records into response_queue

net_http.poll(out)
  -> main thread drains response_queue
```

The ring buffer is mutex-protected, fixed-size, and non-allocating. It is not
lock-free; contention is kept small by the per-frame poll model.

Async libcurl behavior:

- Supports `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, and `HEAD`.
- Follows redirects with `CURLOPT_FOLLOWLOCATION` and `CURLOPT_MAXREDIRS = 10`.
- Uses a 30-second timeout for normal requests.
- Disables timeout for `download_to` requests.
- Resolves proxy from `HTTPS_PROXY`/`https_proxy`, `HTTP_PROXY`/`http_proxy`,
  `ALL_PROXY`/`all_proxy`, with `NO_PROXY=*` disabling proxy use.
- Does not currently return response headers to JS. `buildHttpRespJson` emits
  `"headers": {}` for async responses.
- Non-stream response truncation is tracked natively but not included in the
  JSON emitted to JS today.

## Per-frame drain

`v8_app.zig` calls each binding module's `tickDrain()` once per frame after
`__jsTick`.

For HTTP, `v8_bindings_sdk.tickDrain()`:

```text
net_http.poll(&buf[0..8])
for each Response:
  pending = g_http_pending[resp.id]

  if download:
    progress -> __ffiEmit("http-download-progress:<rid>", body)
    complete -> __ffiEmit("http-download-end:<rid>", {"status":N})
    err      -> __ffiEmit("http-download-end:<rid>", {"error":"..."})

  else if not stream:
    remove pending mapping
    payload = {"status":N,"headers":{},"body":"...", "error"?}
    __ffiEmit("http:<rid>", payload)

  else stream:
    chunk    -> __ffiEmit("http-stream:<rid>", chunkBody)
    complete -> __ffiEmit("http-stream-end:<rid>", {"status":N})
    err      -> __ffiEmit("http-stream-end:<rid>", {"error":"..."})
```

`emitChannelPayload(...)` calls back into JS with:

```text
v8rt.callGlobal2Str("__ffiEmit", channel, payload)
```

`runtime/ffi.ts` defines `__ffiEmit` as:

```text
setTimeout(() => dispatchListeners(channel, payload), 0)
```

That means Zig-origin events emitted during one frame are delivered through the
JS timer queue on a following `__jsTick`, avoiding React setState reentrancy
while the host is draining native events.

## Streaming HTTP and SSE

`http.requestStream(req, callbacks)` is lower-level than fetch:

```text
rid = "s" + seq
subscribe("http-stream:<rid>", onChunk)
subscribe("http-stream-end:<rid>", onComplete/onError)
__http_stream_open(JSON.stringify(req), rid)
```

`useConnection({ kind: 'http' })` uses the same host function with a stable
connection id:

```text
rid = "c" + id
__http_stream_open(reqJson, rid)
onChunk(data)
onComplete({status})
```

`useConnection({ kind: 'sse' })` and `installEventSourceShim()` layer a small
Server-Sent Events parser over streaming chunks:

```text
Accept: text/event-stream
Cache-Control: no-cache
split chunks into SSE lines
event/data/id/retry fields
dispatch message or named event
```

Close semantics:

- `requestStream(...).close()`, `EventSource.close()`, and connection cleanup
  call `__http_stream_close(rid)`.
- Current cancellation only removes the request-id mapping. It does not abort an
  in-flight `curl_easy_perform`; late chunks/end records are dropped because the
  mapping is gone.

## Download-to-file

`http.download({ url, destPath, headers, onProgress })` is for large or binary
payloads that should not cross the V8 string boundary:

```text
subscribe("http-download-progress:<rid>", progress)
subscribe("http-download-end:<rid>", done)
__http_download_to_file(specJson, destPath, rid)
```

Native behavior:

- Opens `destPath` with C `fopen(..., "wb")` in the worker.
- libcurl write callback `fwrite`s bytes directly to the file.
- Progress emits at roughly 10 Hz as `{"d": bytesDownloaded, "t": totalBytes}`.
- Progress events are best-effort and may be dropped when the response queue is
  full.
- The normal 30-second timeout is disabled for downloads.
- Completion resolves only for 2xx status; the JS wrapper rejects for non-2xx
  status or an error payload.

## Browser page fetch

`runtime/hooks/browser_page.ts` is a different pipeline:

```text
fetchPageAsync(url)
  -> try __browser_page_sync(JSON.stringify({url}))
  -> if sync unavailable/null:
       subscribe("browser-page:<reqId>")
       __browser_page_async(JSON.stringify({url}), reqId)
```

The Zig side uses `framework/net/http.zig` (the same module as generic HTTP).
Browser page fetch is a GET request that captures final URL and content type
from the response headers. It shares the same worker pool and `tickDrain()`
loop as all other HTTP requests.

Use this when a cart wants page-like HTML/text content metadata. Use
`http.getAsync` or `fetch` for normal API calls.

## Legacy `__fetch`

V8 still registers a legacy host function:

```text
__fetch(url)
  -> curl -sL --max-time 10 --compressed
     -H "User-Agent: Mozilla/5.0 ..."
  -> returns body string only
```

This is not the modern fetch shim. It is blocking, has a 2MB output cap, does
not return status/headers, and is mostly compatibility substrate. In V8,
`globalThis.fetch` is installed by `runtime/hooks/http.ts`, not by
`framework/v8_bindings_sdk.zig`.

The QJS runtime has an older boot-time `globalThis.fetch = function(url) {
return __fetch(url); }` snippet, but QJS is the legacy runtime and is not the
V8 fetch path documented here.

## Common usage

API request:

```ts
import { http } from '@reactjit/runtime/hooks';

const res = await http.getAsync('https://api.anthropic.com/v1/models', {
  Authorization: `Bearer ${token}`,
  'anthropic-version': '2023-06-01',
});

if (res.status >= 200 && res.status < 300) {
  const data = JSON.parse(res.body);
}
```

Copy-pasted browser-style fetch:

```ts
import { installBrowserShims } from '@reactjit/runtime/hooks';

installBrowserShims();

const r = await fetch('https://example.com/data.json');
const data = await r.json();
```

Streaming text:

```ts
import { http } from '@reactjit/runtime/hooks';

const handle = http.requestStream(
  { method: 'GET', url },
  {
    onChunk: (s) => appendText(s),
    onComplete: ({ status }) => setDone(status),
    onError: (msg) => setError(msg),
  },
);
```

Large download:

```ts
import { http } from '@reactjit/runtime/hooks';

await http.download({
  url,
  destPath: '/tmp/model.gguf',
  onProgress: ({ bytes, total }) => setProgress(bytes, total),
});
```

## Sharp edges

- `fetch` is opt-in. Use `installFetchShim()` or `installBrowserShims()`.
- The fetch shim is minimal: no `Request`, no real `Response`, no `FormData`,
  no cookies, no CORS, no `blob()`, and no `arrayBuffer()`.
- Async response headers are currently always `{}`.
- `headers.get(name)` in the fetch shim lowercases the lookup key, but async
  responses have no headers anyway.
- `via` is accepted by TypeScript but not honored by the V8 HTTP binding.
- Async `timeoutMs` is parsed but not applied to libcurl requests.
- Async non-stream bodies are capped at 64KB natively, and truncation is not
  surfaced in the JSON response today.
- Request bodies are capped at 16KB in the async worker.
- Native request/response queues are only 16 entries deep. Queue-full failures
  are not reported back to JS in the V8 async dispatch path.
- Stream close removes listeners/mapping but does not abort the worker request.
- Download progress is best-effort and can be dropped.
- Sync `http.request` blocks the frame and shells out to the `curl` executable.
- Legacy `__fetch` is blocking and body-only; prefer the `http` module or fetch
  shim for new code.
