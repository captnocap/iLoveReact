# RLE_FORMAT — the frozen mapfile + row-RLE binary contract

**Status:** FROZEN (PLATMOD spine, keystone step 1). This is the byte-level
contract between the editor-bake lane (TypeScript writer) and the stateless Zig
loader (Zig reader). Both sides MUST agree here with zero drift. If you change a
field, you change the version and you update *both* sides and this note in the
same commit.

- **Source of truth (writer):** `runtime/workspace/lumps.ts`, `runtime/workspace/rle.ts`
- **Source of truth (reader):** `framework/world/mapfile.zig`
- **Round-trip proof:** `framework/testing/unit/world_mapfile.zig`
  (run: `zig build test-world-mapfile`; also folded into `tools/rjit game verify`)

Everything below is **little-endian**. All multi-byte integers are LE. Reserved
fields are written as zero and ignored on read.

---

## 1. Container — the RJMP lump bundle

A mapfile is a BSP-like lump container: a fixed header, a fixed-width directory,
and 16-byte-aligned lump payloads. A reader filters to the lump types it knows;
unknown directory entries stay in the directory and are skipped by typed callers.

### 1.1 Header — 16 bytes, at offset 0

| Offset | Size | Field        | Value                              |
|-------:|-----:|--------------|------------------------------------|
| 0      | u32  | `magic`      | `0x504D4A52` = `"RJMP"` (LE bytes `52 4A 4D 50`) |
| 4      | u16  | `version`    | `0` (current `LUMP_FORMAT_VERSION`) |
| 6      | u16  | `alignment`  | `16` (`LUMP_ALIGNMENT`)            |
| 8      | u32  | `lumpCount`  | number of directory entries        |
| 12     | u32  | `dirOffset`  | byte offset of the directory; currently always `16` (= `HEADER_BYTES`) |

`HEADER_BYTES = 16`. A reader rejects the file on `magic` mismatch (`BadMagic`)
or on any `version` it does not implement (`UnsupportedVersion`).

### 1.2 Directory — `lumpCount` × 24 bytes, starting at `dirOffset`

`DIRECTORY_ENTRY_BYTES = 24`.

| Offset | Size | Field           | Notes                                            |
|-------:|-----:|-----------------|--------------------------------------------------|
| +0     | u32  | `type`          | lump type id (see §2)                            |
| +4     | u16  | `encoding`      | encoding id (see §3): 0 raw, 1 rle8, 2 rle16, 3 text |
| +6     | u16  | `reserved`      | `0`                                              |
| +8     | u32  | `offset`        | byte offset of this lump's payload in the file   |
| +12    | u32  | `length`        | stored payload length in bytes                   |
| +16    | u32  | `decodedLength` | hint: decoded byte length (writer currently sets `= length`; readers MUST NOT depend on it for correctness) |
| +20    | u32  | `reserved`      | `0`                                              |

The directory end (`dirOffset + lumpCount * 24`) must lie within the file
(`DirectoryOutOfBounds` otherwise). Each entry's `offset + length` must lie
within the file (`LumpOutOfBounds` otherwise).

### 1.3 Payloads & alignment

After the directory, each lump payload starts on a 16-byte boundary. The writer
aligns `HEADER_BYTES + directoryBytes` up to 16 for the first payload, then
aligns each subsequent payload offset up to 16. Padding bytes between payloads
are zero. Payloads appear in the file in directory order.

### 1.4 Forward/backward tolerance

- **Unknown lump types:** a typed reader passing a known-type filter keeps only
  the entries it recognises and silently skips the rest. The directory still
  lists every entry, so a generic reader (no filter) returns all of them.
- **Reserved fields** are zero today; readers ignore them so future use is
  non-breaking within a version.
- **`decodedLength`** is advisory metadata, never load-bearing.

---

## 2. Lump types (`MAP_LUMP` / `mapfile.LumpType`)

| Id | Name             | Typical encoding | Carries                                   |
|---:|------------------|------------------|-------------------------------------------|
| 1  | `STRINGS`        | text             | string table (e.g. tile/material names)   |
| 2  | `TILES`          | rle8 / rle16     | per-cell tile index grid                  |
| 3  | `HEIGHTS`        | rle8 / rle16     | per-cell quantized height grid (see §5)   |
| 4  | `ZONES`          | rle8 / rle16     | per-cell zone index grid                  |
| 5  | `PLACEMENTS`     | text / raw       | placed-object references                  |
| 6  | `ENTITIES`       | text / raw       | dynamic-entity seeds                      |
| 7  | `INSTANCES`      | raw              | packed 3D instance buffer (the rendered world) |
| 8  | `ENVIRONMENT`    | raw              | scene render environment (lighting/sky/camera) |
| 9  | `PLAYER_MODEL`   | raw              | baked player mesh groups                  |
| 10 | `PLAYER_ANIMATION` | raw            | baked player transform clips              |
| 11 | `HEIGHTFIELDS`   | raw              | regular-grid terrain heightfields         |
| 12 | `MATERIALS`      | raw              | face-material recipes (WGSL + data, decal docs) |
| 13 | `MATERIAL_REFS`  | raw              | per-instance-row material reference       |
| 14 | `COLLIDERS`      | raw              | authored physics solids (+ ramp fields)   |
| 15 | `PHYSICS_CONFIG` | raw              | player physics tuning + walk/run speeds   |
| 16 | `INTERACTABLES`  | raw              | prop interaction layer: seat/container archetypes + instance refs (PROPUSE req_0624) |

Type ids are an open numeric space; new types append without disturbing readers
that don't know them (§1.4).

### 2.1 Game-file (top-level) lump types (`GAME_LUMP` / `gamefile.LumpId`)

A *game file* (§7) is a top-level RJMP container carrying the three RLE streams
plus the asset vocabulary. Its id space is INDEPENDENT of the map sub-lump
space — map sub-lumps appear only *inside* the nested map stream's own RJMP
container, so a reader always knows which table applies. (Historically the
top-level ids started at 16 to also stay numerically disjoint; the map space
reached 16 with `INTERACTABLES`, so disjointness no longer holds — container
context, not the number, is what disambiguates.)

| Id | Name             | Encoding | Carries                                          |
|---:|------------------|----------|--------------------------------------------------|
| 16 | `STREAM_LOGIC`   | raw      | game-logic stream (§7.2)                          |
| 17 | `STREAM_MAP`     | raw      | game-map stream (§7.2); its data is a nested RJMP map container of §2 lumps |
| 18 | `STREAM_SKINS`   | raw      | items/skins (custom-asset) stream (§7.2)          |
| 19 | `ASSET_MANIFEST` | raw      | content-addressed dependency manifest (§7.3)      |
| 20 | `ASSET_BLOB`     | raw      | one installable asset payload (§7.4); repeated    |

---

## 3. Encodings (`LUMP_ENCODING` / `mapfile.Encoding`)

| Id | Name    | Payload shape                                            |
|---:|---------|---------------------------------------------------------|
| 0  | `raw`   | opaque bytes, consumed verbatim                         |
| 1  | `rle8`  | binary row-RLE grid stream, 1-byte values (see §4)      |
| 2  | `rle16` | binary row-RLE grid stream, 2-byte values (see §4)      |
| 3  | `text`  | UTF-8 bytes                                             |

An unknown encoding id is a hard error on read (`UnknownEncoding`).

---

## 4. Binary row-RLE grid stream (the codec)

This is the packed wire shape produced by `encodeBinaryRleGrid(grid, bits)` and
consumed by `decodeBinaryRleGrid` (TS) / `mapfile.decodeRle8` / `mapfile.decodeRle16`
(Zig). It decodes straight into a typed `width × height` buffer of optional
cells — no parser, no eval.

### 4.1 Stream header — 12 bytes

| Offset | Size | Field       |
|-------:|-----:|-------------|
| 0      | u32  | `width`     |
| 4      | u32  | `height`    |
| 8      | u32  | `pairCount` |

### 4.2 Run pairs — `pairCount` entries

Each pair is `(count, value)`:

- **rle8:** `count` u16, `value` u8 → **3 bytes/pair**
- **rle16:** `count` u16, `value` u16 → **4 bytes/pair**

So the payload is exactly `12 + pairCount * (bits == 8 ? 3 : 4)` bytes. A reader
checks this against the lump length (`RleTruncated` otherwise; `RleTooSmall` if
under 12).

### 4.3 Value encoding — the null sentinel

The stored `value` is biased by one so that absent cells are representable:

- `value == 0`  → **null** (cell absent / transparent / out-of-grid)
- `value >= 1`  → cell value `value - 1`

Therefore the maximum representable cell value is **254** for rle8 and **65534**
for rle16. The TS writer raises `rle8/rle16 value out of range` if a cell exceeds
that.

### 4.4 Runs and layout

- `count` is capped at `0xFFFF`; a longer run is split into multiple pairs.
- The writer breaks runs at **row boundaries** (it emits exactly `width` cells per
  row, never letting a run straddle two rows).
- The reader fills a flat row-major buffer (`index = y * width + x`) sequentially
  across all pairs. Because the writer emits exactly `width` cells per row, the
  linear fill reconstructs rows exactly.
- **Decode tolerance:** the reader stops writing once the `width * height` buffer
  is full (extra pairs are harmless), and any cells never reached remain `null`
  (short streams pad with null).

### 4.5 Decoded buffer type

The Zig reader returns:

```zig
pub const RleGrid = struct { width: u32, height: u32, values: []?u16 };
```

`values.len == width * height`, row-major, `null` == absent cell. (The TS
`decodeBinaryRleGrid` returns the row-RLE `RleGrid` of `rle.ts`; both denote the
same grid — see §6 for the JSON-side row-RLE shape, which is editor-internal and
NOT the wire format.)

---

## 5. Heightfield quantization (HEIGHTS producer)

`quantizeHeightfield(heights, w, h)` maps `f64` heights into the `u16` grid that
becomes a HEIGHTS lump:

```
base  = min(heights)
span  = max(heights) - base
scale = span == 0 ? 1 : span / 0xFFFF
value[i] = clamp(round((heights[i] - base) / scale), 0, 0xFFFF)
height[i] = base + value[i] * scale     // dequantize
```

`base` and `scale` are `f64` metadata that travel **alongside** the lump (their
in-file transport is the editor-bake lane's concern, gated after this keystone);
the lump payload itself is just the §4 grid of quantized `u16` values.

---

## 6. NOT the wire format — the editor-internal row-RLE JSON

`rle.ts` also defines a JSON-friendly row-RLE shape used inside the editor
(`RleEntry = number | null | [count, value]`, rows of entries, `RleGrid`/
`EncodedMatrix`). This is the in-memory / on-disk-as-JSON representation the
editor edits. It is **transcoded** into the §4 binary stream by
`encodeBinaryRleGrid` before it goes into a mapfile. The binary stream in §4 —
not the JSON — is the frozen platform wire contract. Do not ship the JSON shape
to the Zig loader.

---

## 7. The game file — three streams + a content-addressed asset vocabulary

**Status:** FROZEN (PLATMOD spine step 2). A *game is DATA* (V28/§2 of
PLATMOD_PLAN): an asset vocabulary plus an RLE tape composing those assets BY
REFERENCE. A **game file** is the on-disk realization: one top-level RJMP
container (§1) carrying the three streams and the vocabulary.

- **Writer:** `runtime/workspace/gamefile.ts` (+ `sha256.ts`)
- **Reader + content store:** `framework/world/gamefile.zig`
- **Round-trip proof:** `framework/testing/unit/world_gamefile.zig`
  (run: `zig build test-world-gamefile`; folded into `tools/rjit game verify`)

This step builds the **reader and the dependency gate only** — there is no
constructor yet (PLATMOD §4.4, gated on this).

### 7.1 Container layout

A game file's top-level RJMP directory contains, in order:

1. `STREAM_LOGIC` (16) — the game-logic stream
2. `STREAM_MAP` (17) — the game-map stream
3. `STREAM_SKINS` (18) — the items/skins stream
4. `ASSET_MANIFEST` (19) — the dependency manifest
5. `ASSET_BLOB` (20) × N — one per vocabulary asset, in manifest order

### 7.2 Stream payload (`STREAM_LOGIC` / `STREAM_MAP` / `STREAM_SKINS`)

Each stream lump's payload is:

| Offset | Size            | Field      | Notes                                   |
|-------:|-----------------|------------|-----------------------------------------|
| 0      | u32             | `refCount` | number of asset keys this stream uses   |
| 4      | u32 × `refCount`| `refs`     | asset keys referenced (resolve via §7.3)|
| 4+4R   | u32             | `dataLen`  | byte length of the stream body          |
| 8+4R   | `dataLen` bytes | `data`     | the stream's own payload                |

`R = refCount`. The `data` body is stream-specific: for `STREAM_MAP` it is a
**nested RJMP map container** (§1) of the §2 map lumps (TILES/HEIGHTS/ZONES/…);
for `STREAM_LOGIC` and `STREAM_SKINS` it is the stream's own encoded bytes
(text/raw/RLE as that stream defines). The reader treats `data` as opaque bytes
plus the `refs` dependency list.

### 7.3 Asset manifest (`ASSET_MANIFEST`)

The dependency manifest — the list of vocabulary assets the game requires, each
content-addressed. Payload:

| Offset | Size             | Field   |
|-------:|------------------|---------|
| 0      | u32              | `count` |
| 4      | `count` × 44 B   | entries |

Each 44-byte entry:

| Offset | Size      | Field      | Notes                                   |
|-------:|-----------|------------|-----------------------------------------|
| +0     | u32       | `key`      | stable id the streams reference (§7.2)  |
| +4     | u16       | `kind`     | asset-kind tag (building/texture/model/skin…) |
| +6     | u16       | `reserved` | `0`                                     |
| +8     | u32       | `length`   | asset payload byte length               |
| +12    | 32 bytes  | `hash`     | **SHA-256** of the asset payload — the content address |

### 7.4 Asset blob (`ASSET_BLOB`)

One per asset. Payload:

| Offset | Size      | Field         | Notes                              |
|-------:|-----------|---------------|------------------------------------|
| 0      | 32 bytes  | `claimedHash` | SHA-256 the writer claims          |
| 32     | remaining | `payload`     | the asset bytes                    |

### 7.5 The content store + the load-time dependency gate

The hash is **SHA-256** (FIPS 180-4), identical on both sides — the TS writer
uses `runtime/workspace/sha256.ts` (host-independent: it runs under `v8cli`
where the gated `__priv_sha256` door may be absent); the Zig reader uses
`std.crypto.hash.sha2.Sha256`. The cross-language round-trip test asserts the two
agree.

`gamefile.installAndValidate(dir)` runs the gate **before** any construction:

1. **Verify + install each blob.** Compute `sha256(payload)`. If it differs from
   `claimedHash` → **`BadAssetHash`** (the hash IS the corruption check). Else
   atomically install the payload into the content store: write `dir/.tmp.<hex>`,
   `fsync`, then `rename` to `dir/<hex>` where `<hex>` is the lowercase hex of
   the hash. The rename makes the install all-or-nothing.
2. **Confirm every required asset landed.** Each manifest `hash` must be in the
   installed set → else **`MissingAsset`**.
3. **Resolve every reference.** Each stream `ref` key must have a manifest entry
   → else **`MissingReference`**.

Both negative paths fail loudly and are covered by the round-trip test
(`BadAssetHash`, `MissingReference`). The manifest is the dependency manifest:
nothing is constructed until it validates. Content addressing means identical
assets dedupe to one store file regardless of how many games reference them.
