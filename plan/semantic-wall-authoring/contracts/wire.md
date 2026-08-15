# Architecture Host Wire Contract

## Encoding rules

The architecture host boundary is a bounded little-endian binary protocol. JavaScript
constructs and decodes bytes; native code owns validation, mutation, topology, and
compilation. No JSON, pointers, DCEL indices, renderer handles, or allocator-owned
native slices cross this boundary.

Protocol constants:

```text
magic                    = 0x57414a52  // little-endian u32 for ASCII bytes RJAW
packetVersion            = 1
headerBytes              = 40
sectionDirectoryBytes    = 24 per entry
sectionAlignment         = 8
maximumPacketBytes       = 67_108_864
maximumSections          = 64
maximumStringBytes       = 4_194_304
maximumStringCount       = 262_144
maximumCatalogEntries    = 65_536
maximumVertices          = 1_048_576
maximumEdges             = 1_048_576
maximumOpenings          = 1_048_576
maximumAnchors           = 1_048_576
maximumOutputRows        = 8_388_608
```

All reserved fields and alignment padding are zero. Encoders reject nonzero reserved
input. Counts and byte offsets are unsigned; authored structural scalar payloads are
signed integers in `u`.

## Packet header

Every request and response begins with this exact 40-byte header:

```text
offset  bytes  field
0       4      magic u32
4       2      packetVersion u16
6       2      packetKind u16
8       4      totalByteLength u32
12      4      sourceRevision u32
16      2      familyTag u16
18      2      targetTag u16
20      4      sectionCount u32
24      4      sectionDirectoryOffset u32
28      4      stringTableOffset u32
32      4      stringTableByteLength u32
36      4      reserved u32 = 0
```

`totalByteLength` is the exact packet size. A packet shorter or longer than that value
is rejected. `sourceRevision` is zero only for operations without source state.

## Packet, family, and target tags

```text
PacketKind
  1  catalogValidateRequest       2  catalogValidateResult
  3  catalogInstallRequest        4  catalogInstallResult
  5  catalogQueryRequest          6  catalogQueryResult
  7  sourceValidateRequest        8  sourceValidateResult
  9  mutateRequest               10  mutateResult
 11  compileRequest              12  compileResult
 13  raycastRequest              14  raycastResult
 15  openingSlotsRequest         16  openingSlotsResult
 17  RETIRED (was migrateV4Request)   18  RETIRED (was migrateV4Result)
 19  scaleMetadataRequest        20  scaleMetadataResult
 21  catalogReadbackRequest      22  catalogReadbackResult

FamilyTag
  0 none  1 wall  2 floor  3 verticalLink  4 roof

FamilyTag is a PACKET-HEADER value only. Semantic rows — the catalog entry
family byte (entry offset 32) and the catalog query family byte (query offset
0) — carry the native entry enum instead: 0 wall, 1 floor, 2 verticalLink,
3 roof, with no `none`. Mixing the two shifted every installed wall row into
`floor` on the first live TS→native install (req_4470); both codecs pin the
entry enum for row bytes and FamilyTag for headers.

TargetTag
  0 none  1 topology  2 render  3 collision  4 cover  5 materials
  6 doorsPortals  7 navigation  8 rooms  9 visibility  10 audio
 11 pickProxies  12 diagnostics
```

A packet kind fixes whether family/target tags may be zero, singular, or `all` via
sections. A known packet carrying an incompatible tag is rejected.

## Section directory

Each section directory row is exactly 24 bytes:

```text
offset  bytes  field
0       2      sectionTag u16
2       2      sectionVersion u16
4       4      itemCount u32
8       4      byteOffset u32
12      4      byteLength u32
16      4      elementStride u32 (0 for variable-width)
20      4      reserved u32 = 0
```

Rows are sorted by `(sectionTag, sectionVersion)`. Section payload offsets are
8-byte-aligned, non-overlapping, at or after the directory end, and wholly before the
string table. Known section versions validate their exact stride/count/length law.
Unknown section tags are skipped using `byteOffset + byteLength`; unknown versions of
a required known section reject the packet. Duplicate required sections reject.

Section tags are allocated by payload family:

```text
1 sourceHeader       2 vertices          3 edges             4 openings
5 anchors            6 command           7 patchOperations   8 remaps
9 faceLineage       10 affectedBounds   11 dirtyTargets     12 diagnostics
20 catalogEntries   21 catalogTags      22 catalogMasks     23 catalogQuery
30 renderBands      31 colliderBands    32 materialBindings 33 doors
34 portals          35 gameplayBands    36 roomFaces        37 pickProxies
38 targetHashes     40 ray              41 rayHit            42 openingSlots
60 rejection        61 scaleMetadata

50/51 are RETIRED (were legacyModules/migrationMap). Retired numeric values stay
reserved forever and are never reallocated (v4 wall migration deleted, req_4462).
```

## String table

Every string field in a known row is represented by:

```text
stringOffset u32
stringByteLength u32
```

Offsets are relative to `stringTableOffset`. Strings are UTF-8 without terminators,
must lie wholly within the table, and must decode without replacement characters.
Equal strings may share a range. Canonical encoders deduplicate exact UTF-8 bytes and
order first occurrence by canonical section/row/field traversal. Empty strings use
offset zero and length zero. No semantic behavior parses string contents.

## Result and rejection envelope

Every result contains exactly one of:

- its packet-kind-specific success sections; or
- one `rejection` section and no success sections.

The rejection section contains:

```text
code u16
stage u16
subjectCount u32
subjectStringPairsOffset u32
expectedRevision u32
actualRevision u32
detailStringOffset u32
detailStringByteLength u32
```

Rejection codes are stable numeric protocol values. The initial set includes
`short_packet`, `bad_magic`, `unsupported_packet_version`, `length_mismatch`,
`trailing_bytes`, `count_limit`, `offset_out_of_range`, `section_overlap`,
`unknown_required_section_version`, `invalid_utf8`, `invalid_tag`,
`invalid_source`, `invalid_catalog`, `unknown_catalog_id`, `stale_source_revision`,
`mutation_rejected`, `compile_rejected`, and `raycast_rejected`. Code 19 is
RETIRED (was `migration_rejected`) and stays reserved.

If the header itself cannot be trusted, the host throws a bounded capability error
instead of attempting to encode a rejection packet with attacker-controlled values.

## Decode order and failure law

The decoder performs these checks in order:

1. input length is at least `headerBytes`;
2. magic equals `magic`;
3. packet version equals `packetVersion`;
4. declared length is within `maximumPacketBytes` and equals input length;
5. packet/family/target tags are compatible;
6. section count and string table are within limits;
7. directory arithmetic is checked for overflow;
8. section ranges are aligned, ordered, disjoint, and in bounds;
9. known section shapes/counts/strides are valid;
10. every string pair is in bounds and valid UTF-8;
11. semantic DTO validation runs.

Short packets, trailing bytes, unknown packet versions, arithmetic overflow, excessive
counts, invalid offsets, overlaps, malformed strings, and missing required sections
all reject before semantic code runs. Decoders never truncate, clamp, infer a missing
section, round a structural scalar, or accept a valid prefix with trailing bytes.

## Ownership

The caller owns request bytes through the host call. Native decoders allocate owned
semantic values, destroy them after the operation, encode one owned result buffer,
and transfer only a copied JavaScript `Uint8Array`. Every allocator-owned decoded or
compiled structure exposes a `deinit` path. No result references request memory.

## Required proofs

1. Encode/decode/encode is byte-identical for every golden packet.
2. A measured catalog entry, empty source, source with two openings, every command,
   every rejection, query, raycast, and opening-slot packet has a golden byte array.
3. Each maximum accepts exactly its limit and rejects limit plus one without
   allocation proportional to the rejected count.
4. Unknown optional sections skip by bounded length; unknown versions of required
   sections reject.
5. Short, long/trailing, future-version, overlapping, and invalid-string packets fail
   with their exact rejection code and never enter architecture semantics.
