# Localstore, SQLite, And DuckDB Pipeline (V8 Runtime)

The V8 persistence stack has three different surfaces that are easy to conflate:

- `localstore`: the main persistent key/value store used by V8 hooks.
- `sqlite`: a raw SQLite handle/query API exposed to JS when the binding is
  registered.
- `DuckDB`: vendored dependency files and app metadata references, but no active
  V8 hook or host binding today.

The important practical rule: use namespaced localstore for app state and small
JSON records. Use raw SQLite only when the runtime build has the SQL host
binding registered. Do not assume DuckDB is callable from cart JS yet.

## Public API

### Namespaced Localstore

Import the low-level helpers:

```ts
import { localstore } from '@reactjit/runtime/hooks';

localstore.nsSet('settings', 'theme', JSON.stringify({ mode: 'dark' }));

if (localstore.nsHas('settings', 'theme')) {
  const raw = localstore.nsGet('settings', 'theme');
  const theme = JSON.parse(raw);
}
```

Direct namespaced helper surface:

```ts
function nsGet(namespace: string, key: string): string;
function nsHas(namespace: string, key: string): boolean;
function nsSet(namespace: string, key: string, value: string): void;
function nsDelete(namespace: string, key: string): void;
function nsClear(namespace?: string): void;
function nsKeys(namespace: string): string[];
```

The React state hook wraps the same namespaced host functions:

```ts
import { useLocalStore } from '@reactjit/runtime/hooks/useLocalStore';

const [theme, setTheme] = useLocalStore('prefs', 'theme', 'dark');
setTheme('light');
```

`useLocalStore` JSON-serializes values. Keep values JSON-safe.

### CRUD Over Localstore

`useCRUD` stores JSON records in namespaced localstore:

```ts
import { useCRUD } from '@reactjit/runtime/hooks';

const todos = useCRUD('todos', TodoSchema, { namespace: 'app' });
const id = await todos.create({ title: 'ship docs', done: false });
const row = await todos.get(id);
```

Storage shape:

```text
namespace: options.namespace ?? "crud"
key:       `${collection}:${id}`
value:     JSON string
```

Filtering, sorting, pagination, and migrations are implemented in JS by reading
keys from localstore and parsing records.

### Legacy Single-Namespace Store

`runtime/hooks/localstore.ts` also exposes browser-like helpers:

```ts
function get(key: string): string | null;
function set(key: string, value: string): void;
function remove(key: string): void;
function clear(): void;
function keys(): string[];
function getJson<T>(key: string, fallback: T): T;
function setJson(key: string, value: any): void;
function installLocalStorageShim(): void;
```

These call legacy globals:

```text
__store_get(key)
__store_set(key, value)
__store_remove(key)
__store_clear()
__store_keys_json()
```

In the current V8 tree these legacy globals are registered by
`framework/v8_bindings_telemetry.zig`, not by core. Prefer the namespaced
`__localstore*` surface unless you specifically need this compatibility layer.

### SQLite Hook

`runtime/hooks/sqlite.ts` provides a synchronous raw SQL wrapper:

```ts
import { sqlite } from '@reactjit/runtime/hooks';

const db = sqlite.Db.open('app.db');
db.exec('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT)');
db.exec('INSERT INTO items (name) VALUES (?)', ['alpha']);
const rows = db.query<{ id: number; name: string }>(
  'SELECT id, name FROM items ORDER BY id LIMIT ?',
  [20],
);
db.close();
```

Hook surface:

```ts
type DbHandle = number;

function open(path: string): DbHandle; // 0 on failure
function close(handle: DbHandle): void;
function exec(handle: DbHandle, sql: string, params?: any[]): boolean;
function query<T = Record<string, any>>(handle: DbHandle, sql: string, params?: any[]): T[];
function lastRowId(handle: DbHandle): number;
function changes(handle: DbHandle): number;
```

The hook calls:

```text
__sql_open(path) -> handle
__sql_close(handle)
__sql_exec(handle, JSON.stringify({ sql, params })) -> boolean
__sql_query_json(handle, JSON.stringify({ sql, params })) -> JSON row array
__sql_last_rowid(handle) -> number
__sql_changes(handle) -> number
```

Current V8 caveat: these `__sql_*` globals are implemented in
`framework/v8_bindings_telemetry.zig`. A cart must have the native SQLite build
flag and the telemetry binding registered, or the hook falls back to `0`,
`false`, or `[]`.

### One-Shot `__db_query`

There is also a low-level one-shot query global:

```text
__db_query(path, sql) -> pipe-delimited text rows
```

Despite the generic name, this is SQLite-backed in the current V8 runtime. It
opens the SQLite database at `path`, runs `sql`, serializes text columns as
`value|value\n`, closes the database, and returns an empty string on failure.

This is a legacy/debug utility, not the DuckDB API.

## Binding Registration

### Core Localstore

`v8_app.zig` always registers the `core` ingredient:

```zig
.{ .name = "core", .required = true, .reg_fn = "registerCore", .mod = v8_bindings_core },
```

`framework/v8_bindings_core.zig` registers the namespaced localstore globals:

```text
__localstoreGet(namespace, key)
__localstoreHas(namespace, key)
__localstoreSet(namespace, key, value)
__localstoreDelete(namespace, key)
__localstoreClear(namespace?)
__localstoreKeysJson(namespace)
```

These functions are present as host globals in V8 because core is always
registered. They still need the underlying `framework/localstore.zig` substrate
to initialize successfully before they can persist data.

### Localstore Substrate Init

`v8_app.zig:appInit` initializes the filesystem substrate and then localstore:

```zig
fs_mod.init("reactjit") catch |e| std.log.warn("fs init failed: {}", .{e});
localstore.init() catch |e| std.log.warn("localstore init failed: {}", .{e});
```

Shutdown runs:

```zig
localstore.deinit();
fs_mod.deinit();
```

### SQLite Feature Gate

`framework/sqlite.zig` is a dispatcher:

- `-Dhas-sqlite=true`: re-export `framework/sqlite_real.zig`.
- `-Dhas-sqlite=false`: re-export `framework/sqlite_stub.zig`.

`build.zig` links `sqlite3` only when `has-sqlite` is true. The dependency
registry requests that build option when the bundle includes:

```text
runtime/hooks/sqlite.ts
runtime/hooks/localstore.ts
runtime/hooks/useLocalStore.ts
cart/sweatshop/lib/storage/*
```

If SQLite is not linked, `framework/sqlite_stub.zig` returns errors/null/zero.
That means localstore initialization fails and the localstore host functions
degrade to empty reads and no-op writes.

### Telemetry SQL Registration

The raw SQLite JS globals and legacy `__store_*` globals are registered by the
telemetry ingredient:

```text
__store_get
__store_set
__store_remove
__store_clear
__store_keys_json

__sql_open
__sql_close
__sql_exec
__sql_query_json
__sql_changes
__sql_last_rowid

__db_query
```

`v8_app.zig` source-gates telemetry by the `__tel_` prefix and the
`has-telemetry` build option. This is separate from `has-sqlite`.

## End-to-End Flow: Namespaced Localstore

### 1. JS calls a namespaced helper

`runtime/hooks/localstore.ts` uses `runtime/ffi.ts`:

```ts
export function nsSet(namespace: string, key: string, value: string): void {
  callHost<void>('__localstoreSet', undefined as any, namespace, key, value);
}
```

`callHost` checks whether the global exists and catches host exceptions. Missing
hosts return the provided fallback.

`useLocalStore` calls the globals directly. On first render it checks `has`,
parses JSON when present, and otherwise seeds the store with the initial value.
Setter calls update React state and enqueue a localstore write.

### 2. Core binding converts V8 arguments

`framework/v8_bindings_core.zig` receives V8 callback arguments, copies strings
with `argToStringAlloc`, and calls `framework/localstore.zig`.

Return behavior:

- `__localstoreGet`: string value or `""`.
- `__localstoreHas`: `1` or `0`.
- `__localstoreSet`: no return value.
- `__localstoreDelete`: no return value.
- `__localstoreClear`: no return value.
- `__localstoreKeysJson`: JSON string array or `"[]"`.

Because `__localstoreGet` returns `""` both for missing values and empty stored
strings, callers that need to distinguish those states must call
`__localstoreHas` first.

### 3. Localstore reads through the write cache first

`framework/localstore.zig` stores data in SQLite but writes asynchronously. To
make read-after-write work before the writer thread flushes, it keeps a
write-through memory cache.

`get(namespace, key, buf)` first checks `getRemembered`. If a pending or recent
write for the same namespace/key exists, it copies that cached value into `buf`
and returns immediately.

If no remembered write exists, it locks the database mutex and runs:

```sql
SELECT value FROM store WHERE namespace = ? AND key = ?
```

Missing keys return `null`.

### 4. Localstore writes enqueue jobs

`set(namespace, key, value)` validates fixed limits and calls `enqueueSet`.

Limits:

```text
MAX_KEY       = 256
MAX_VALUE     = 8192
WRITE_QUEUE   = 1024 jobs
```

`enqueueSet`:

1. Stores or updates the latest value in `write_cache`.
2. Coalesces an existing queued write for the same namespace/key when possible.
3. Drops the oldest queued job if the fixed queue is full.
4. Signals the writer thread.

The UI thread does not block on SQLite disk I/O for normal writes.

### 5. Writer thread persists to SQLite

`writerMain` pops jobs and writes each one under `db_mutex`:

```sql
INSERT OR REPLACE INTO store (namespace, key, value, updated_at)
VALUES (?, ?, ?, ?)
```

`updated_at` is `std.Io.Clock.now(.real, io).toSeconds()`.

The schema is created during `localstore.init()`:

```sql
CREATE TABLE IF NOT EXISTS store (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, key)
)
```

The database path is:

```text
<framework/fs data dir>/localstore.db
```

For the V8 app init path, `fs_mod.init("reactjit")` selects the app data root.

### 6. Delete, keys, and clear are synchronous

Unlike set, these operations execute directly under `db_mutex`:

```sql
DELETE FROM store WHERE namespace = ? AND key = ?
SELECT key FROM store WHERE namespace = ? ORDER BY key
DELETE FROM store WHERE namespace = ?
DELETE FROM store
```

`keys` returns at most `MAX_KEYS` entries, currently `256`.

## End-to-End Flow: Legacy Store

The legacy single-key helpers in `runtime/hooks/localstore.ts` call `__store_*`.
`framework/v8_bindings_telemetry.zig` maps those onto localstore namespace
`"app"`:

```zig
const LS_NS: []const u8 = "app";
```

Flow:

```text
localstore.get(key)
  -> __store_get(key)
  -> localstore.get("app", key, buf)
  -> SQLite table store(namespace="app", key)
```

`installLocalStorageShim()` installs a browser-like `globalThis.localStorage`
object over this legacy surface. In current V8, that shim depends on telemetry's
`__store_*` functions being registered.

## End-to-End Flow: Raw SQLite

### 1. JS opens a handle

```ts
const handle = sqlite.open('app.db');
```

`__sql_open` opens the database through `framework/sqlite.zig`, heap-allocates a
`sqlite.Database`, stores it in an `AutoHashMap(u32, *Database)`, and returns a
monotonic numeric handle. Handle `0` means failure.

### 2. SQLite real implementation opens the file

`framework/sqlite_real.zig` wraps libsqlite3. `Database.open(path)`:

1. Null-terminates the path on the stack.
2. Calls `sqlite3_open`.
3. Sets `sqlite3_busy_timeout(db, 0)`.
4. Best-effort enables WAL mode:
   `PRAGMA journal_mode=WAL`.
5. Best-effort enables foreign keys:
   `PRAGMA foreign_keys=ON`.

The zero busy timeout is deliberate: host functions run on the UI thread, so a
locked database should fail quickly instead of stalling the app.

### 3. Exec and query pass JSON request envelopes

`runtime/hooks/sqlite.ts` serializes statements as:

```ts
JSON.stringify({ sql, params })
```

The V8 binding parses the JSON and binds params by JSON value type:

```text
null          -> sqlite3_bind_null
boolean       -> sqlite3_bind_int(0 or 1)
integer       -> sqlite3_bind_int64
float         -> sqlite3_bind_double
number_string -> sqlite3_bind_text
string        -> sqlite3_bind_text
array/object  -> sqlite3_bind_null
```

`exec` prepares the statement, binds params, steps once, finalizes, and returns
`true` on success.

`query` prepares the statement, binds params, steps all rows, and returns one JSON
string containing an array of objects keyed by column name.

Column conversion:

```text
NULL    -> null
INTEGER -> number
FLOAT   -> number
TEXT    -> string
BLOB    -> null
```

The binding serializes at most 64 columns per row.

### 4. JS parses query JSON

`runtime/ffi.ts:callHostJson` calls the host function, then `JSON.parse`s the
returned string. Bad JSON or a missing host returns the fallback `[]`.

Large result sets are serialized into one string on the host side and parsed in
one shot in JS. UI code should use `LIMIT`, pagination, or application-level
chunking for visible lists.

### 5. Close releases the handle

`sqlite.close(handle)` calls `__sql_close`. The binding removes the handle from
the map, closes the SQLite connection, and destroys the heap allocation.

There is no automatic JS finalizer. Long-lived code should close handles
explicitly.

## DuckDB Status

DuckDB is not part of the active V8 host API today.

What exists:

- Vendored files under `deps/duckdb/`, including headers and a static library.
- App/data comments and old settings UI references to DuckDB paths.
- Domain data shapes that mention DuckDB as an intended or external storage
  target.

What does not exist:

- No `runtime/hooks/duckdb.ts`.
- No `framework/duckdb.zig`.
- No `v8_bindings_duckdb.zig`.
- No `__duckdb_*` globals.
- No `has-duckdb` build option or dependency-registry feature.

`__db_query` is not DuckDB. It is a SQLite one-shot query helper.

## Limits And Caveats

- Localstore values are text. Hooks encode structured values with JSON.
- Localstore `MAX_VALUE` is `8192` bytes at the storage layer.
- Core `__localstoreGet` uses a 64 KB read buffer, but storage writes are still
  capped by `MAX_VALUE`.
- Localstore keys and namespaces are capped at `256` bytes.
- `keys(namespace)` returns at most `256` keys.
- Normal localstore writes are queued and coalesced. Delete and clear do not
  remove matching entries from `write_cache`, so a read immediately after delete
  can observe a remembered value until overwritten or process restart.
- If the write queue fills, the oldest pending write is dropped rather than
  blocking the UI thread.
- Raw SQLite host calls are synchronous and run on the UI thread.
- Raw SQLite blobs currently serialize as `null`.
- Raw SQLite arrays and objects passed as params bind as `NULL`.
- `__sql_*` registration is currently tied to the telemetry binding, while
  `has-sqlite` only controls whether the real SQLite implementation is linked.
- DuckDB is not callable from V8 JS in the current tree.

## Source Map

- `runtime/hooks/localstore.ts`: localstore wrappers, typed JSON helpers,
  localStorage shim.
- `runtime/hooks/useLocalStore.ts`: React state hook over namespaced localstore.
- `runtime/hooks/useCRUD.ts`: CRUD/query/migration layer over namespaced
  localstore.
- `runtime/hooks/sqlite.ts`: raw SQLite JS wrapper.
- `runtime/ffi.ts`: `callHost`, `callHostJson`, and host availability helpers.
- `framework/localstore.zig`: SQLite-backed key/value store, write queue, schema.
- `framework/sqlite.zig`: feature-gated SQLite dispatcher.
- `framework/sqlite_real.zig`: libsqlite3 wrapper.
- `framework/sqlite_stub.zig`: disabled SQLite stub.
- `framework/v8_bindings_core.zig`: namespaced `__localstore*` V8 globals.
- `framework/v8_bindings_telemetry.zig`: legacy `__store_*`, raw `__sql_*`, and
  one-shot `__db_query` globals.
- `v8_app.zig`: ingredient registration and localstore init/deinit.
- `build.zig`: `has-sqlite` link flag and build options.
- `sdk/dependency-registry.json`: source triggers for `has-sqlite` and telemetry.
- `deps/duckdb/`: vendored DuckDB files, currently not exposed to V8 JS.
