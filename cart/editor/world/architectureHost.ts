// Bounded semantic architecture host protocol.
//
// This module is the sole editor-side owner of RJAW bytes. Native owns catalog
// validation, topology, mutation, compilation, and picking; editor consumers
// exchange typed DTOs and never observe native pointers or derived topology.

import {
  compileArchitecturePacket,
  enumerateArchitectureOpeningSlotsPacket,
  installArchitectureCatalogPacket,
  mutateArchitecturePacket,
  queryArchitectureCatalogPacket,
  raycastArchitecturePacket,
  readArchitectureScalePacket,
  readMeasuredArchitectureCatalogPacket,
  validateArchitectureCatalogPacket,
  validateArchitectureSourcePacket,
  type ArchitecturePacket,
} from '@reactjit/runtime/game/build';
import { bytesText, textBytes } from '@reactjit/runtime/workspace/lumps';

export const ARCHITECTURE_WIRE = Object.freeze({
  magic: 0x57414a52,
  packetVersion: 1,
  headerBytes: 40,
  sectionDirectoryBytes: 24,
  sectionAlignment: 8,
  maximumPacketBytes: 67_108_864,
  maximumSections: 64,
  maximumStringBytes: 4_194_304,
  maximumStringCount: 262_144,
  maximumCatalogEntries: 65_536,
  maximumVertices: 1_048_576,
  maximumEdges: 1_048_576,
  maximumOpenings: 1_048_576,
  maximumAnchors: 1_048_576,
  maximumOutputRows: 8_388_608,
});

export const PACKET_KIND = Object.freeze({
  catalogValidateRequest: 1, catalogValidateResult: 2,
  catalogInstallRequest: 3, catalogInstallResult: 4,
  catalogQueryRequest: 5, catalogQueryResult: 6,
  sourceValidateRequest: 7, sourceValidateResult: 8,
  mutateRequest: 9, mutateResult: 10,
  compileRequest: 11, compileResult: 12,
  raycastRequest: 13, raycastResult: 14,
  openingSlotsRequest: 15, openingSlotsResult: 16,
  // 17/18 were migrateV4Request/Result — retired with the v4 wall-migration
  // lane (req_4462); the values stay reserved and are never reallocated.
  scaleMetadataRequest: 19, scaleMetadataResult: 20,
  catalogReadbackRequest: 21, catalogReadbackResult: 22,
} as const);

export const SECTION_TAG = Object.freeze({
  sourceHeader: 1, vertices: 2, edges: 3, openings: 4, anchors: 5,
  command: 6, patchOperations: 7, remaps: 8, faceLineage: 9,
  affectedBounds: 10, dirtyTargets: 11, diagnostics: 12,
  catalogEntries: 20, catalogTags: 21, catalogMasks: 22, catalogQuery: 23,
  renderBands: 30, colliderBands: 31, materialBindings: 32, doors: 33,
  portals: 34, gameplayBands: 35, roomFaces: 36, pickProxies: 37,
  targetHashes: 38, ray: 40, rayHit: 41, openingSlots: 42,
  // 50/51 were legacyModules/migrationMap — retired with the v4 wall-migration
  // lane (req_4462); the values stay reserved and are never reallocated.
  rejection: 60, scaleMetadata: 61,
} as const);

export const REJECTION_CODE = Object.freeze({
  short_packet: 1,
  bad_magic: 2,
  unsupported_packet_version: 3,
  length_mismatch: 4,
  trailing_bytes: 5,
  count_limit: 6,
  offset_out_of_range: 7,
  section_overlap: 8,
  unknown_required_section_version: 9,
  invalid_utf8: 10,
  invalid_tag: 11,
  invalid_source: 12,
  invalid_catalog: 13,
  unknown_catalog_id: 14,
  stale_source_revision: 15,
  mutation_rejected: 16,
  compile_rejected: 17,
  raycast_rejected: 18,
  // 19 was migration_rejected — retired with the v4 wall-migration lane
  // (req_4462); the value stays reserved and is never reallocated.
} as const);

const REJECTION_NAME = Object.freeze(Object.fromEntries(
  Object.entries(REJECTION_CODE).map(([name, code]) => [code, name]),
) as Readonly<Record<number, keyof typeof REJECTION_CODE>>);

const FAMILY_TAG = Object.freeze({ none: 0, wall: 1, floor: 2, verticalLink: 3, roof: 4 } as const);
const ROLE_TAG = Object.freeze({ style: 0, opening: 1, trim: 2, cap: 3, rail: 4, doorLeaf: 5 } as const);
const ROLE_NAME = Object.freeze(['style', 'opening', 'trim', 'cap', 'rail', 'doorLeaf'] as const);
const PROFILE_TAG = Object.freeze({ full: 0, half: 1 } as const);
const SIDE_TAG = Object.freeze({ a: 0, b: 1 } as const);
const HINGE_TAG = Object.freeze({ start: 0, end: 1, none: 2 } as const);
const OPENING_KIND_TAG = Object.freeze({
  door: 0, window: 1, doubleWindow: 2, brokenWindow: 3,
  garageDoor: 4, slidingDoor: 5, arch: 6,
} as const);
const OPENING_KIND_NAME = Object.freeze([
  'door', 'window', 'doubleWindow', 'brokenWindow', 'garageDoor', 'slidingDoor', 'arch',
] as const);
const VERTICAL_LINK_TAG = Object.freeze({ stair: 0, ramp: 1, elevator: 2 } as const);
const ROOF_PROFILE_TAG = Object.freeze({ flat: 0, shed: 1, gable: 2, hip: 3, pyramid: 4 } as const);
const PORTAL_TAG = Object.freeze({ none: 0, walk: 1, vehicle: 2 } as const);
const SLAB_JOIN_TAG = Object.freeze({ onTop: 0, atEdge: 1 } as const);

const STRIDE = Object.freeze({
  sourceHeader: 8, vertex: 24, edge: 72, opening: 40, anchor: 40,
  catalogEntry: 176, catalogTag: 16, catalogMask: 16, catalogQuery: 32,
  command: 160, affectedBounds: 28, dirtyTarget: 4,
  ray: 56, rayHit: 88, openingSlot: 8, scaleMetadata: 32,
});

type PacketKind = typeof PACKET_KIND[keyof typeof PACKET_KIND];
type SectionTag = typeof SECTION_TAG[keyof typeof SECTION_TAG];
type FamilyTag = typeof FAMILY_TAG[keyof typeof FAMILY_TAG];

type SectionInput = {
  tag: SectionTag;
  itemCount: number;
  stride: number;
  bytes: Uint8Array;
};

export type DecodedArchitectureSection = SectionInput & { version: number };
export type DecodedArchitecturePacket = {
  kind: number;
  sourceRevision: number;
  family: number;
  target: number;
  sections: ReadonlyMap<number, DecodedArchitectureSection>;
  stringTable: Uint8Array;
};

export class ArchitectureCapabilityError extends Error {
  constructor(operation: string) {
    super(`semantic architecture host capability '${operation}' is unavailable or returned no bounded packet`);
    this.name = 'ArchitectureCapabilityError';
  }
}

export class ArchitecturePacketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchitecturePacketError';
  }
}

export class ArchitectureHostRejection extends Error {
  readonly code: keyof typeof REJECTION_CODE;
  readonly codeValue: number;
  readonly stage: number;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(input: {
    code: number;
    stage: number;
    expectedRevision: number;
    actualRevision: number;
    detail: string;
  }) {
    const code = REJECTION_NAME[input.code] ?? 'invalid_tag';
    super(input.detail || `architecture host rejected with ${code}`);
    this.name = 'ArchitectureHostRejection';
    this.code = code;
    this.codeValue = input.code;
    this.stage = input.stage;
    this.expectedRevision = input.expectedRevision;
    this.actualRevision = input.actualRevision;
  }
}

function fail(message: string): never { throw new ArchitecturePacketError(message); }
function assertUInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) fail(`${label} is not a u32`);
  return value;
}
function assertInt32(value: number, label: string): number {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) fail(`${label} is not an i32`);
  return value;
}
function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
function checkedEnd(offset: number, length: number, label: string): number {
  const end = offset + length;
  if (!Number.isSafeInteger(end) || offset < 0 || length < 0) fail(`${label} overflows`);
  return end;
}

class StringTableBuilder {
  private readonly offsets = new Map<string, { offset: number; length: number }>();
  private readonly chunks: Uint8Array[] = [];
  private byteLength = 0;

  add(value: string): { offset: number; length: number } {
    if (value.length === 0) return { offset: 0, length: 0 };
    const existing = this.offsets.get(value);
    if (existing) return existing;
    if (this.offsets.size === ARCHITECTURE_WIRE.maximumStringCount) fail('string count exceeds RJAW maximum');
    const bytes = textBytes(value);
    if (this.byteLength + bytes.length > ARCHITECTURE_WIRE.maximumStringBytes) fail('string table exceeds RJAW maximum');
    const reference = { offset: this.byteLength, length: bytes.length };
    this.offsets.set(value, reference);
    this.chunks.push(bytes);
    this.byteLength += bytes.length;
    return reference;
  }

  finish(): Uint8Array {
    const bytes = new Uint8Array(this.byteLength);
    let offset = 0;
    for (const chunk of this.chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }
}

function putString(view: DataView, offset: number, table: StringTableBuilder, value: string): void {
  const reference = table.add(value);
  view.setUint32(offset, reference.offset, true);
  view.setUint32(offset + 4, reference.length, true);
}

function readString(packet: DecodedArchitecturePacket, bytes: Uint8Array, offset: number): string {
  if (offset + 8 > bytes.length) return fail('string reference row is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stringOffset = view.getUint32(offset, true);
  const stringLength = view.getUint32(offset + 4, true);
  if (stringLength === 0) {
    if (stringOffset !== 0) return fail('empty string has a nonzero offset');
    return '';
  }
  const end = checkedEnd(stringOffset, stringLength, 'string reference');
  if (end > packet.stringTable.length) return fail('string reference exceeds the RJAW string table');
  const source = packet.stringTable.subarray(stringOffset, end);
  let value: string;
  try { value = bytesText(source); } catch { return fail('string reference is not valid UTF-8'); }
  const encoded = textBytes(value);
  if (encoded.length !== source.length || encoded.some((byte, index) => byte !== source[index])) {
    return fail('string reference is not canonical UTF-8');
  }
  return value;
}

function encodePacket(input: {
  kind: PacketKind;
  sourceRevision?: number;
  family?: FamilyTag;
  target?: number;
  sections?: readonly SectionInput[];
  stringTable?: Uint8Array;
}): Uint8Array {
  const sections = [...(input.sections ?? [])].sort((left, right) => left.tag - right.tag);
  if (sections.length > ARCHITECTURE_WIRE.maximumSections) fail('section count exceeds RJAW maximum');
  for (let index = 1; index < sections.length; index += 1) {
    if (sections[index - 1]!.tag === sections[index]!.tag) fail(`duplicate section ${sections[index]!.tag}`);
  }
  const stringTable = input.stringTable ?? new Uint8Array();
  if (stringTable.length > ARCHITECTURE_WIRE.maximumStringBytes) fail('string table exceeds RJAW maximum');
  let cursor = ARCHITECTURE_WIRE.headerBytes + sections.length * ARCHITECTURE_WIRE.sectionDirectoryBytes;
  const offsets: number[] = [];
  for (const section of sections) {
    assertUInt(section.itemCount, 'section itemCount');
    assertUInt(section.stride, 'section stride');
    if (section.stride !== 0 && section.itemCount * section.stride !== section.bytes.length) {
      fail(`section ${section.tag} stride/count mismatch`);
    }
    cursor = align(cursor, ARCHITECTURE_WIRE.sectionAlignment);
    offsets.push(cursor);
    cursor = checkedEnd(cursor, section.bytes.length, 'section payload');
  }
  const stringOffset = align(cursor, ARCHITECTURE_WIRE.sectionAlignment);
  const total = checkedEnd(stringOffset, stringTable.length, 'packet');
  if (total > ARCHITECTURE_WIRE.maximumPacketBytes) fail('packet exceeds RJAW maximum');
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, ARCHITECTURE_WIRE.magic, true);
  view.setUint16(4, ARCHITECTURE_WIRE.packetVersion, true);
  view.setUint16(6, input.kind, true);
  view.setUint32(8, total, true);
  view.setUint32(12, assertUInt(input.sourceRevision ?? 0, 'source revision'), true);
  view.setUint16(16, input.family ?? FAMILY_TAG.none, true);
  view.setUint16(18, input.target ?? 0, true);
  view.setUint32(20, sections.length, true);
  view.setUint32(24, ARCHITECTURE_WIRE.headerBytes, true);
  view.setUint32(28, stringOffset, true);
  view.setUint32(32, stringTable.length, true);
  sections.forEach((section, index) => {
    const directory = ARCHITECTURE_WIRE.headerBytes + index * ARCHITECTURE_WIRE.sectionDirectoryBytes;
    view.setUint16(directory, section.tag, true);
    view.setUint16(directory + 2, 1, true);
    view.setUint32(directory + 4, section.itemCount, true);
    view.setUint32(directory + 8, offsets[index]!, true);
    view.setUint32(directory + 12, section.bytes.length, true);
    view.setUint32(directory + 16, section.stride, true);
    bytes.set(section.bytes, offsets[index]!);
  });
  bytes.set(stringTable, stringOffset);
  return bytes;
}

export function decodeArchitecturePacket(bytes: Uint8Array): DecodedArchitecturePacket {
  if (!(bytes instanceof Uint8Array)) return fail('RJAW result is not a Uint8Array');
  if (bytes.length < ARCHITECTURE_WIRE.headerBytes) return fail('RJAW packet is shorter than its fixed header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== ARCHITECTURE_WIRE.magic) return fail('RJAW magic mismatch');
  if (view.getUint16(4, true) !== ARCHITECTURE_WIRE.packetVersion) return fail('RJAW packet version mismatch');
  const declaredLength = view.getUint32(8, true);
  if (declaredLength !== bytes.length) return fail('RJAW declared length does not equal the result length');
  if (declaredLength > ARCHITECTURE_WIRE.maximumPacketBytes) return fail('RJAW packet exceeds its maximum');
  if (view.getUint32(36, true) !== 0) return fail('RJAW header reserved field is nonzero');
  const sectionCount = view.getUint32(20, true);
  if (sectionCount > ARCHITECTURE_WIRE.maximumSections) return fail('RJAW section count exceeds its maximum');
  const directoryOffset = view.getUint32(24, true);
  const directoryEnd = checkedEnd(directoryOffset, sectionCount * ARCHITECTURE_WIRE.sectionDirectoryBytes, 'directory');
  const stringOffset = view.getUint32(28, true);
  const stringLength = view.getUint32(32, true);
  if (directoryOffset < ARCHITECTURE_WIRE.headerBytes || directoryEnd > bytes.length) return fail('RJAW directory is out of range');
  if (stringLength > ARCHITECTURE_WIRE.maximumStringBytes || stringOffset < directoryEnd || stringOffset + stringLength !== bytes.length) {
    return fail('RJAW string table is out of range');
  }
  const sections = new Map<number, DecodedArchitectureSection>();
  let previousTag = -1;
  let previousEnd = directoryEnd;
  for (let index = 0; index < sectionCount; index += 1) {
    const row = directoryOffset + index * ARCHITECTURE_WIRE.sectionDirectoryBytes;
    const tag = view.getUint16(row, true);
    const version = view.getUint16(row + 2, true);
    const itemCount = view.getUint32(row + 4, true);
    const byteOffset = view.getUint32(row + 8, true);
    const byteLength = view.getUint32(row + 12, true);
    const stride = view.getUint32(row + 16, true);
    if (view.getUint32(row + 20, true) !== 0) return fail('RJAW section reserved field is nonzero');
    if (tag <= previousTag || sections.has(tag)) return fail('RJAW sections are not strictly tag ordered');
    if (version !== 1) return fail(`RJAW section ${tag} has unsupported version ${version}`);
    if (byteOffset % ARCHITECTURE_WIRE.sectionAlignment !== 0) return fail(`RJAW section ${tag} is misaligned`);
    const byteEnd = checkedEnd(byteOffset, byteLength, `section ${tag}`);
    if (byteOffset < previousEnd || byteEnd > stringOffset) return fail(`RJAW section ${tag} overlaps or is out of range`);
    if (stride !== 0 && itemCount * stride !== byteLength) return fail(`RJAW section ${tag} stride/count mismatch`);
    for (let padding = previousEnd; padding < byteOffset; padding += 1) {
      if (bytes[padding] !== 0) return fail('RJAW alignment padding is nonzero');
    }
    const sectionBytes = bytes.slice(byteOffset, byteEnd);
    sections.set(tag, { tag: tag as SectionTag, version, itemCount, stride, bytes: sectionBytes });
    previousTag = tag;
    previousEnd = byteEnd;
  }
  for (let padding = previousEnd; padding < stringOffset; padding += 1) {
    if (bytes[padding] !== 0) return fail('RJAW trailing alignment padding is nonzero');
  }
  return {
    kind: view.getUint16(6, true),
    sourceRevision: view.getUint32(12, true),
    family: view.getUint16(16, true),
    target: view.getUint16(18, true),
    sections,
    stringTable: bytes.slice(stringOffset),
  };
}

function requireSection(packet: DecodedArchitecturePacket, tag: SectionTag, stride: number, count?: number): DecodedArchitectureSection {
  const section = packet.sections.get(tag) ?? fail(`RJAW result is missing required section ${tag}`);
  if (section.stride !== stride) return fail(`RJAW section ${tag} has stride ${section.stride}, expected ${stride}`);
  if (count !== undefined && section.itemCount !== count) return fail(`RJAW section ${tag} has count ${section.itemCount}, expected ${count}`);
  return section;
}

function requireResult(bytes: ArchitecturePacket | null, operation: string, expectedKind: number): DecodedArchitecturePacket {
  if (bytes == null) throw new ArchitectureCapabilityError(operation);
  const packet = decodeArchitecturePacket(bytes);
  if (packet.kind !== expectedKind) return fail(`${operation} returned packet kind ${packet.kind}, expected ${expectedKind}`);
  const rejection = packet.sections.get(SECTION_TAG.rejection);
  if (rejection) {
    if (packet.sections.size !== 1 || rejection.itemCount !== 1 || rejection.stride !== 32) {
      return fail(`${operation} returned a malformed rejection envelope`);
    }
    const view = new DataView(rejection.bytes.buffer, rejection.bytes.byteOffset, rejection.bytes.byteLength);
    throw new ArchitectureHostRejection({
      code: view.getUint16(0, true),
      stage: view.getUint16(2, true),
      expectedRevision: view.getUint32(12, true),
      actualRevision: view.getUint32(16, true),
      detail: readString(packet, rejection.bytes, 20),
    });
  }
  return packet;
}

export type ArchitectureFamily = 'wall' | 'floor' | 'verticalLink' | 'roof';
export type ArchitectureKitRole = 'style' | 'opening' | 'trim' | 'cap' | 'rail' | 'doorLeaf';
export type WallProfile = 'full' | 'half';
export type WallSide = 'a' | 'b';
export type WallHinge = 'start' | 'end' | 'none';
export type WallOpeningKind = keyof typeof OPENING_KIND_TAG;
export type SlabJoin = 'onTop' | 'atEdge';
export type PortalClass = keyof typeof PORTAL_TAG;
export type WallCell = { columnU: number; rowU: number };

export type ArchitectureKitMeasurement = {
  sourceBoundsU: { minXU: number; minYU: number; minZU: number; maxXU: number; maxYU: number; maxZU: number };
  mountBoundsU?: { minU: number; minV: number; maxU: number; maxV: number };
  footprint?: { minColumn: number; minRow: number; maxColumnExclusive: number; maxRowExclusive: number };
  occupiedMask?: readonly WallCell[];
  clearanceMask: readonly WallCell[];
  pivotU: { xU: number; yU: number; zU: number };
};

export type ArchitectureCatalogEntry = {
  catalogId: string;
  contentHash: string;
  packageId: string;
  label: string;
  family: ArchitectureFamily;
  role: ArchitectureKitRole;
  semanticKind?: string;
  categoryPath: readonly string[];
  themeTags: readonly string[];
  gameplayTags: readonly string[];
  measurement: ArchitectureKitMeasurement;
  wallStyleDefaults?: { heightU: number; thicknessU: number; profile: WallProfile };
  wallOpeningCompatibility?: {
    permittedProfiles: readonly WallProfile[];
    minimumThicknessU: number;
    portalClass: PortalClass;
  };
  assetRefs: {
    meshContentHash: string;
    materialContentHashes: readonly string[];
    animationContentHash?: string;
  };
};

export type ArchitectureCatalogQuery = {
  family: ArchitectureFamily;
  role?: ArchitectureKitRole;
  semanticKind?: string;
  requiredThemeTags?: readonly string[];
  requiredGameplayTags?: readonly string[];
  maximumWidthU?: number;
  maximumHeightU?: number;
  wallProfile?: WallProfile;
  wallThicknessU?: number;
};

const CATALOG_FLAG = Object.freeze({ mount: 1, footprint: 2, style: 4, compatibility: 8, animation: 16 });
const CATALOG_TAG_KIND = Object.freeze({ category: 1, theme: 2, gameplay: 3, materialHash: 4 });
const CATALOG_MASK_KIND = Object.freeze({ occupied: 1, clearance: 2, profile: 3, thickness: 4 });

// Semantic rows (catalog entries, catalog queries) carry the native
// `types.ArchitectureFamily` byte — 0-based with NO `none` (wall=0, floor=1,
// verticalLink=2, roof=3). Only the packet HEADER uses FAMILY_TAG (none=0,
// wall=1). Mixing the two shifted every installed wall row into `floor` on the
// first real host install (req_4470); never reuse FAMILY_TAG for row bytes.
const CATALOG_FAMILY_TAG = Object.freeze({ wall: 0, floor: 1, verticalLink: 2, roof: 3 } as const);
const CATALOG_FAMILY_NAME = Object.freeze(['wall', 'floor', 'verticalLink', 'roof'] as const);

function familyTag(family: ArchitectureFamily): number { return CATALOG_FAMILY_TAG[family]; }
function familyName(tag: number): ArchitectureFamily {
  const name = CATALOG_FAMILY_NAME[tag];
  if (!name) return fail(`invalid architecture family tag ${tag}`);
  return name;
}
function roleName(tag: number): ArchitectureKitRole {
  return ROLE_NAME[tag] ?? fail(`invalid architecture role tag ${tag}`);
}

function semanticTags(family: ArchitectureFamily, value?: string): [number, number] {
  if (value === undefined) return [0, 0];
  if (family === 'wall') {
    const tag = OPENING_KIND_TAG[value as WallOpeningKind];
    if (tag === undefined) return fail(`unknown wall opening semantic kind '${value}'`);
    return [1, tag];
  }
  if (family === 'verticalLink') {
    const tag = VERTICAL_LINK_TAG[value as keyof typeof VERTICAL_LINK_TAG];
    if (tag === undefined) return fail(`unknown vertical-link semantic kind '${value}'`);
    return [2, tag];
  }
  if (family === 'roof') {
    const tag = ROOF_PROFILE_TAG[value as keyof typeof ROOF_PROFILE_TAG];
    if (tag === undefined) return fail(`unknown roof semantic kind '${value}'`);
    return [3, tag];
  }
  return fail('floor catalog rows cannot carry a semanticKind in RJAW v1');
}

function semanticName(tag: number, value: number): string | undefined {
  if (tag === 0 && value === 0) return undefined;
  if (tag === 1) return OPENING_KIND_NAME[value] ?? fail(`invalid opening kind tag ${value}`);
  if (tag === 2) return (['stair', 'ramp', 'elevator'] as const)[value] ?? fail(`invalid vertical-link kind tag ${value}`);
  if (tag === 3) return (['flat', 'shed', 'gable', 'hip', 'pyramid'] as const)[value] ?? fail(`invalid roof profile tag ${value}`);
  return fail(`invalid semantic kind tag ${tag}`);
}

function encodeCatalogEntries(kind: PacketKind, entries: readonly ArchitectureCatalogEntry[]): Uint8Array {
  if (entries.length > ARCHITECTURE_WIRE.maximumCatalogEntries) return fail('catalog entry count exceeds RJAW maximum');
  const strings = new StringTableBuilder();
  const entryBytes = new Uint8Array(entries.length * STRIDE.catalogEntry);
  const entryView = new DataView(entryBytes.buffer);
  type StringRow = [number, number, string];
  type MaskRow = [number, number, number, number];
  const tagRows: StringRow[] = [];
  const maskRows: MaskRow[] = [];
  entries.forEach((entry, index) => {
    const offset = index * STRIDE.catalogEntry;
    putString(entryView, offset, strings, entry.catalogId);
    putString(entryView, offset + 8, strings, entry.contentHash);
    putString(entryView, offset + 16, strings, entry.packageId);
    putString(entryView, offset + 24, strings, entry.label);
    entryView.setUint8(offset + 32, familyTag(entry.family));
    entryView.setUint8(offset + 33, ROLE_TAG[entry.role]);
    const semantic = semanticTags(entry.family, entry.semanticKind);
    entryView.setUint8(offset + 34, semantic[0]);
    entryView.setUint8(offset + 35, semantic[1]);
    let flags = 0;
    if (entry.measurement.mountBoundsU) flags |= CATALOG_FLAG.mount;
    if (entry.measurement.footprint) flags |= CATALOG_FLAG.footprint;
    if (entry.wallStyleDefaults) flags |= CATALOG_FLAG.style;
    if (entry.wallOpeningCompatibility) flags |= CATALOG_FLAG.compatibility;
    if (entry.assetRefs.animationContentHash !== undefined) flags |= CATALOG_FLAG.animation;
    entryView.setUint32(offset + 36, flags, true);
    const bounds = entry.measurement.sourceBoundsU;
    [bounds.minXU, bounds.minYU, bounds.minZU, bounds.maxXU, bounds.maxYU, bounds.maxZU]
      .forEach((value, valueIndex) => entryView.setFloat64(offset + 40 + valueIndex * 8, value, true));
    const mount = entry.measurement.mountBoundsU;
    if (mount) [mount.minU, mount.minV, mount.maxU, mount.maxV]
      .forEach((value, valueIndex) => entryView.setFloat64(offset + 88 + valueIndex * 8, value, true));
    const footprint = entry.measurement.footprint;
    if (footprint) {
      entryView.setInt32(offset + 120, assertInt32(footprint.minColumn, 'footprint.minColumn'), true);
      entryView.setInt32(offset + 124, assertInt32(footprint.minRow, 'footprint.minRow'), true);
      entryView.setInt32(offset + 128, assertInt32(footprint.maxColumnExclusive, 'footprint.maxColumnExclusive'), true);
      entryView.setInt32(offset + 132, assertInt32(footprint.maxRowExclusive, 'footprint.maxRowExclusive'), true);
    }
    entryView.setInt32(offset + 136, assertInt32(entry.measurement.pivotU.xU, 'pivot.xU'), true);
    entryView.setInt32(offset + 140, assertInt32(entry.measurement.pivotU.yU, 'pivot.yU'), true);
    entryView.setInt32(offset + 144, assertInt32(entry.measurement.pivotU.zU, 'pivot.zU'), true);
    if (entry.wallStyleDefaults) {
      entryView.setInt32(offset + 148, assertInt32(entry.wallStyleDefaults.heightU, 'style.heightU'), true);
      entryView.setInt32(offset + 152, assertInt32(entry.wallStyleDefaults.thicknessU, 'style.thicknessU'), true);
      entryView.setUint8(offset + 156, PROFILE_TAG[entry.wallStyleDefaults.profile]);
    }
    if (entry.wallOpeningCompatibility) entryView.setUint8(offset + 157, PORTAL_TAG[entry.wallOpeningCompatibility.portalClass]);
    putString(entryView, offset + 160, strings, entry.assetRefs.meshContentHash);
    if (entry.assetRefs.animationContentHash !== undefined) {
      putString(entryView, offset + 168, strings, entry.assetRefs.animationContentHash);
    }
    entry.categoryPath.forEach(value => tagRows.push([index, CATALOG_TAG_KIND.category, value]));
    entry.themeTags.forEach(value => tagRows.push([index, CATALOG_TAG_KIND.theme, value]));
    entry.gameplayTags.forEach(value => tagRows.push([index, CATALOG_TAG_KIND.gameplay, value]));
    entry.assetRefs.materialContentHashes.forEach(value => tagRows.push([index, CATALOG_TAG_KIND.materialHash, value]));
    (entry.measurement.occupiedMask ?? []).forEach(cell => maskRows.push([index, CATALOG_MASK_KIND.occupied, cell.columnU, cell.rowU]));
    entry.measurement.clearanceMask.forEach(cell => maskRows.push([index, CATALOG_MASK_KIND.clearance, cell.columnU, cell.rowU]));
    entry.wallOpeningCompatibility?.permittedProfiles.forEach(profile => maskRows.push([index, CATALOG_MASK_KIND.profile, PROFILE_TAG[profile], 0]));
    if (entry.wallOpeningCompatibility) maskRows.push([index, CATALOG_MASK_KIND.thickness, entry.wallOpeningCompatibility.minimumThicknessU, 0]);
  });
  const tagBytes = new Uint8Array(tagRows.length * STRIDE.catalogTag);
  const tagView = new DataView(tagBytes.buffer);
  tagRows.forEach(([entry, rowKind, value], index) => {
    const offset = index * STRIDE.catalogTag;
    tagView.setUint32(offset, entry, true);
    tagView.setUint16(offset + 4, rowKind, true);
    putString(tagView, offset + 8, strings, value);
  });
  const maskBytes = new Uint8Array(maskRows.length * STRIDE.catalogMask);
  const maskView = new DataView(maskBytes.buffer);
  maskRows.forEach(([entry, rowKind, first, second], index) => {
    const offset = index * STRIDE.catalogMask;
    maskView.setUint32(offset, entry, true);
    maskView.setUint16(offset + 4, rowKind, true);
    maskView.setInt32(offset + 8, assertInt32(first, 'catalog mask first'), true);
    maskView.setInt32(offset + 12, assertInt32(second, 'catalog mask second'), true);
  });
  return encodePacket({
    kind,
    sections: [
      { tag: SECTION_TAG.catalogEntries, itemCount: entries.length, stride: STRIDE.catalogEntry, bytes: entryBytes },
      { tag: SECTION_TAG.catalogTags, itemCount: tagRows.length, stride: STRIDE.catalogTag, bytes: tagBytes },
      { tag: SECTION_TAG.catalogMasks, itemCount: maskRows.length, stride: STRIDE.catalogMask, bytes: maskBytes },
    ],
    stringTable: strings.finish(),
  });
}

function decodeCatalogEntries(packet: DecodedArchitecturePacket): ArchitectureCatalogEntry[] {
  const entrySection = requireSection(packet, SECTION_TAG.catalogEntries, STRIDE.catalogEntry);
  const tags = packet.sections.get(SECTION_TAG.catalogTags);
  const masks = packet.sections.get(SECTION_TAG.catalogMasks);
  if (tags && tags.stride !== STRIDE.catalogTag) return fail('catalog tag stride mismatch');
  if (masks && masks.stride !== STRIDE.catalogMask) return fail('catalog mask stride mismatch');
  const entries: ArchitectureCatalogEntry[] = [];
  const view = new DataView(entrySection.bytes.buffer, entrySection.bytes.byteOffset, entrySection.bytes.byteLength);
  for (let index = 0; index < entrySection.itemCount; index += 1) {
    const offset = index * STRIDE.catalogEntry;
    const flags = view.getUint32(offset + 36, true);
    const family = familyName(view.getUint8(offset + 32));
    const mountBoundsU = flags & CATALOG_FLAG.mount ? {
      minU: view.getFloat64(offset + 88, true), minV: view.getFloat64(offset + 96, true),
      maxU: view.getFloat64(offset + 104, true), maxV: view.getFloat64(offset + 112, true),
    } : undefined;
    const footprint = flags & CATALOG_FLAG.footprint ? {
      minColumn: view.getInt32(offset + 120, true), minRow: view.getInt32(offset + 124, true),
      maxColumnExclusive: view.getInt32(offset + 128, true), maxRowExclusive: view.getInt32(offset + 132, true),
    } : undefined;
    entries.push({
      catalogId: readString(packet, entrySection.bytes, offset),
      contentHash: readString(packet, entrySection.bytes, offset + 8),
      packageId: readString(packet, entrySection.bytes, offset + 16),
      label: readString(packet, entrySection.bytes, offset + 24),
      family,
      role: roleName(view.getUint8(offset + 33)),
      semanticKind: semanticName(view.getUint8(offset + 34), view.getUint8(offset + 35)),
      categoryPath: [], themeTags: [], gameplayTags: [],
      measurement: {
        sourceBoundsU: {
          minXU: view.getFloat64(offset + 40, true), minYU: view.getFloat64(offset + 48, true),
          minZU: view.getFloat64(offset + 56, true), maxXU: view.getFloat64(offset + 64, true),
          maxYU: view.getFloat64(offset + 72, true), maxZU: view.getFloat64(offset + 80, true),
        },
        mountBoundsU,
        footprint,
        occupiedMask: [], clearanceMask: [],
        pivotU: {
          xU: view.getInt32(offset + 136, true), yU: view.getInt32(offset + 140, true),
          zU: view.getInt32(offset + 144, true),
        },
      },
      wallStyleDefaults: flags & CATALOG_FLAG.style ? {
        heightU: view.getInt32(offset + 148, true),
        thicknessU: view.getInt32(offset + 152, true),
        profile: (['full', 'half'] as const)[view.getUint8(offset + 156)] ?? fail('invalid wall profile tag'),
      } : undefined,
      wallOpeningCompatibility: flags & CATALOG_FLAG.compatibility ? {
        permittedProfiles: [], minimumThicknessU: 0,
        portalClass: (['none', 'walk', 'vehicle'] as const)[view.getUint8(offset + 157)] ?? fail('invalid portal tag'),
      } : undefined,
      assetRefs: {
        meshContentHash: readString(packet, entrySection.bytes, offset + 160),
        materialContentHashes: [],
        animationContentHash: flags & CATALOG_FLAG.animation ? readString(packet, entrySection.bytes, offset + 168) : undefined,
      },
    });
  }
  if (tags) {
    const tagView = new DataView(tags.bytes.buffer, tags.bytes.byteOffset, tags.bytes.byteLength);
    for (let index = 0; index < tags.itemCount; index += 1) {
      const offset = index * STRIDE.catalogTag;
      const entry = entries[tagView.getUint32(offset, true)] ?? fail('catalog tag references a missing entry');
      const value = readString(packet, tags.bytes, offset + 8);
      switch (tagView.getUint16(offset + 4, true)) {
        case CATALOG_TAG_KIND.category: (entry.categoryPath as string[]).push(value); break;
        case CATALOG_TAG_KIND.theme: (entry.themeTags as string[]).push(value); break;
        case CATALOG_TAG_KIND.gameplay: (entry.gameplayTags as string[]).push(value); break;
        case CATALOG_TAG_KIND.materialHash: (entry.assetRefs.materialContentHashes as string[]).push(value); break;
        default: return fail('catalog tag has an invalid kind');
      }
    }
  }
  if (masks) {
    const maskView = new DataView(masks.bytes.buffer, masks.bytes.byteOffset, masks.bytes.byteLength);
    for (let index = 0; index < masks.itemCount; index += 1) {
      const offset = index * STRIDE.catalogMask;
      const entry = entries[maskView.getUint32(offset, true)] ?? fail('catalog mask references a missing entry');
      const first = maskView.getInt32(offset + 8, true);
      const second = maskView.getInt32(offset + 12, true);
      switch (maskView.getUint16(offset + 4, true)) {
        case CATALOG_MASK_KIND.occupied: (entry.measurement.occupiedMask as WallCell[]).push({ columnU: first, rowU: second }); break;
        case CATALOG_MASK_KIND.clearance: (entry.measurement.clearanceMask as WallCell[]).push({ columnU: first, rowU: second }); break;
        case CATALOG_MASK_KIND.profile: {
          const profile = (['full', 'half'] as const)[first] ?? fail('catalog mask has invalid wall profile');
          if (!entry.wallOpeningCompatibility) return fail('profile mask targets a non-opening entry');
          (entry.wallOpeningCompatibility.permittedProfiles as WallProfile[]).push(profile);
          break;
        }
        case CATALOG_MASK_KIND.thickness:
          if (!entry.wallOpeningCompatibility) return fail('thickness mask targets a non-opening entry');
          (entry.wallOpeningCompatibility as { minimumThicknessU: number }).minimumThicknessU = first;
          break;
        default: return fail('catalog mask has an invalid kind');
      }
    }
  }
  return entries;
}

function encodeCatalogQuery(query: ArchitectureCatalogQuery): Uint8Array {
  const strings = new StringTableBuilder();
  const row = new Uint8Array(STRIDE.catalogQuery);
  const view = new DataView(row.buffer);
  view.setUint8(0, familyTag(query.family));
  if (query.role !== undefined) { view.setUint8(1, 1); view.setUint8(2, ROLE_TAG[query.role]); }
  const semantic = semanticTags(query.family, query.semanticKind);
  view.setUint8(3, semantic[0]); view.setUint8(4, semantic[1]);
  if (query.maximumWidthU !== undefined) { view.setUint8(5, 1); view.setInt32(12, assertInt32(query.maximumWidthU, 'maximumWidthU'), true); }
  if (query.maximumHeightU !== undefined) { view.setUint8(6, 1); view.setInt32(16, assertInt32(query.maximumHeightU, 'maximumHeightU'), true); }
  if (query.wallProfile !== undefined) { view.setUint8(7, 1); view.setUint8(8, PROFILE_TAG[query.wallProfile]); }
  if (query.wallThicknessU !== undefined) { view.setUint8(9, 1); view.setInt32(20, assertInt32(query.wallThicknessU, 'wallThicknessU'), true); }
  const tagRows = [
    ...(query.requiredThemeTags ?? []).map(value => [CATALOG_TAG_KIND.theme, value] as const),
    ...(query.requiredGameplayTags ?? []).map(value => [CATALOG_TAG_KIND.gameplay, value] as const),
  ];
  const tagBytes = new Uint8Array(tagRows.length * STRIDE.catalogTag);
  const tagView = new DataView(tagBytes.buffer);
  tagRows.forEach(([kind, value], index) => {
    const offset = index * STRIDE.catalogTag;
    tagView.setUint16(offset + 4, kind, true);
    putString(tagView, offset + 8, strings, value);
  });
  return encodePacket({
    kind: PACKET_KIND.catalogQueryRequest,
    sections: [
      { tag: SECTION_TAG.catalogQuery, itemCount: 1, stride: STRIDE.catalogQuery, bytes: row },
      { tag: SECTION_TAG.catalogTags, itemCount: tagRows.length, stride: STRIDE.catalogTag, bytes: tagBytes },
    ],
    stringTable: strings.finish(),
  });
}

function decodeCatalogQueryResult(packet: DecodedArchitecturePacket): number[] {
  const section = requireSection(packet, SECTION_TAG.catalogQuery, 4);
  const view = new DataView(section.bytes.buffer, section.bytes.byteOffset, section.bytes.byteLength);
  return Array.from({ length: section.itemCount }, (_, index) => view.getUint32(index * 4, true));
}

export type WallSupport =
  | { kind: 'absolute'; baseYU: number }
  | { kind: 'slab'; slabId: string; join: SlabJoin };

export type WallOpening = {
  id: string;
  kind: WallOpeningKind;
  kitId: string;
  columnU: number;
  rowU: number;
  facingSide: WallSide;
  hinge: WallHinge;
};

export type WallVertex = { id: string; floor: number; xU: number; zU: number };
export type WallEdge = {
  id: string;
  startVertexId: string;
  endVertexId: string;
  support: WallSupport;
  heightU: number;
  thicknessU: number;
  profile: WallProfile;
  styleId: string;
  sideA: { materialId: string };
  sideB: { materialId: string };
  openings: readonly WallOpening[];
};
export type WallAnchor = {
  id: string;
  edgeId: string;
  side: WallSide;
  columnU: number;
  rowU: number;
  targetPieceId: string;
};
export type ArchitectureSource = {
  version: 1;
  revision: number;
  walls: { vertices: readonly WallVertex[]; edges: readonly WallEdge[]; anchors: readonly WallAnchor[] };
};

function appendSourceSections(source: ArchitectureSource, strings: StringTableBuilder): SectionInput[] {
  const header = new Uint8Array(STRIDE.sourceHeader);
  const headerView = new DataView(header.buffer);
  headerView.setUint16(0, source.version, true);
  headerView.setUint32(4, assertUInt(source.revision, 'source revision'), true);
  const vertices = new Uint8Array(source.walls.vertices.length * STRIDE.vertex);
  const vertexView = new DataView(vertices.buffer);
  source.walls.vertices.forEach((vertex, index) => {
    const offset = index * STRIDE.vertex;
    putString(vertexView, offset, strings, vertex.id);
    vertexView.setInt32(offset + 8, assertInt32(vertex.floor, 'vertex.floor'), true);
    vertexView.setInt32(offset + 12, assertInt32(vertex.xU, 'vertex.xU'), true);
    vertexView.setInt32(offset + 16, assertInt32(vertex.zU, 'vertex.zU'), true);
  });
  const edges = new Uint8Array(source.walls.edges.length * STRIDE.edge);
  const edgeView = new DataView(edges.buffer);
  const openingCount = source.walls.edges.reduce((count, edge) => count + edge.openings.length, 0);
  if (openingCount > ARCHITECTURE_WIRE.maximumOpenings) return fail('opening count exceeds RJAW maximum');
  const openings = new Uint8Array(openingCount * STRIDE.opening);
  const openingView = new DataView(openings.buffer);
  let openingIndex = 0;
  source.walls.edges.forEach((edge, index) => {
    const offset = index * STRIDE.edge;
    putString(edgeView, offset, strings, edge.id);
    putString(edgeView, offset + 8, strings, edge.startVertexId);
    putString(edgeView, offset + 16, strings, edge.endVertexId);
    if (edge.support.kind === 'absolute') {
      edgeView.setUint8(offset + 24, 0);
      edgeView.setInt32(offset + 28, assertInt32(edge.support.baseYU, 'support.baseYU'), true);
    } else {
      edgeView.setUint8(offset + 24, 1);
      edgeView.setUint8(offset + 26, SLAB_JOIN_TAG[edge.support.join]);
      putString(edgeView, offset + 40, strings, edge.support.slabId);
    }
    edgeView.setUint8(offset + 25, PROFILE_TAG[edge.profile]);
    edgeView.setInt32(offset + 32, assertInt32(edge.heightU, 'edge.heightU'), true);
    edgeView.setInt32(offset + 36, assertInt32(edge.thicknessU, 'edge.thicknessU'), true);
    putString(edgeView, offset + 48, strings, edge.styleId);
    putString(edgeView, offset + 56, strings, edge.sideA.materialId);
    putString(edgeView, offset + 64, strings, edge.sideB.materialId);
    edge.openings.forEach(opening => {
      const openingOffset = openingIndex * STRIDE.opening;
      putString(openingView, openingOffset, strings, edge.id);
      putString(openingView, openingOffset + 8, strings, opening.id);
      putString(openingView, openingOffset + 16, strings, opening.kitId);
      openingView.setUint8(openingOffset + 24, OPENING_KIND_TAG[opening.kind]);
      openingView.setUint8(openingOffset + 25, SIDE_TAG[opening.facingSide]);
      openingView.setUint8(openingOffset + 26, HINGE_TAG[opening.hinge]);
      openingView.setInt32(openingOffset + 28, assertInt32(opening.columnU, 'opening.columnU'), true);
      openingView.setInt32(openingOffset + 32, assertInt32(opening.rowU, 'opening.rowU'), true);
      openingIndex += 1;
    });
  });
  const anchors = new Uint8Array(source.walls.anchors.length * STRIDE.anchor);
  const anchorView = new DataView(anchors.buffer);
  source.walls.anchors.forEach((anchor, index) => {
    const offset = index * STRIDE.anchor;
    putString(anchorView, offset, strings, anchor.id);
    putString(anchorView, offset + 8, strings, anchor.edgeId);
    putString(anchorView, offset + 16, strings, anchor.targetPieceId);
    anchorView.setUint8(offset + 24, SIDE_TAG[anchor.side]);
    anchorView.setInt32(offset + 28, assertInt32(anchor.columnU, 'anchor.columnU'), true);
    anchorView.setInt32(offset + 32, assertInt32(anchor.rowU, 'anchor.rowU'), true);
  });
  return [
    { tag: SECTION_TAG.sourceHeader, itemCount: 1, stride: STRIDE.sourceHeader, bytes: header },
    { tag: SECTION_TAG.vertices, itemCount: source.walls.vertices.length, stride: STRIDE.vertex, bytes: vertices },
    { tag: SECTION_TAG.edges, itemCount: source.walls.edges.length, stride: STRIDE.edge, bytes: edges },
    { tag: SECTION_TAG.openings, itemCount: openingCount, stride: STRIDE.opening, bytes: openings },
    { tag: SECTION_TAG.anchors, itemCount: source.walls.anchors.length, stride: STRIDE.anchor, bytes: anchors },
  ];
}

function encodeSourceRequest(kind: PacketKind, source: ArchitectureSource, extraSections: readonly SectionInput[] = [], strings = new StringTableBuilder()): Uint8Array {
  const sections = appendSourceSections(source, strings);
  sections.push(...extraSections);
  return encodePacket({ kind, sourceRevision: source.revision, family: FAMILY_TAG.wall, sections, stringTable: strings.finish() });
}

function decodeSource(packet: DecodedArchitecturePacket): ArchitectureSource {
  const header = requireSection(packet, SECTION_TAG.sourceHeader, STRIDE.sourceHeader, 1);
  const headerView = new DataView(header.bytes.buffer, header.bytes.byteOffset, header.bytes.byteLength);
  const version = headerView.getUint16(0, true);
  if (version !== 1 || headerView.getUint16(2, true) !== 0) return fail('source header is not canonical v1');
  const revision = headerView.getUint32(4, true);
  if (revision !== packet.sourceRevision) return fail('source header revision differs from packet revision');
  const vertexSection = packet.sections.get(SECTION_TAG.vertices);
  const edgeSection = packet.sections.get(SECTION_TAG.edges);
  const openingSection = packet.sections.get(SECTION_TAG.openings);
  const anchorSection = packet.sections.get(SECTION_TAG.anchors);
  if (vertexSection && vertexSection.stride !== STRIDE.vertex) return fail('vertex stride mismatch');
  if (edgeSection && edgeSection.stride !== STRIDE.edge) return fail('edge stride mismatch');
  if (openingSection && openingSection.stride !== STRIDE.opening) return fail('opening stride mismatch');
  if (anchorSection && anchorSection.stride !== STRIDE.anchor) return fail('anchor stride mismatch');
  const vertices: WallVertex[] = [];
  if (vertexSection) {
    const view = new DataView(vertexSection.bytes.buffer, vertexSection.bytes.byteOffset, vertexSection.bytes.byteLength);
    for (let index = 0; index < vertexSection.itemCount; index += 1) {
      const offset = index * STRIDE.vertex;
      vertices.push({
        id: readString(packet, vertexSection.bytes, offset), floor: view.getInt32(offset + 8, true),
        xU: view.getInt32(offset + 12, true), zU: view.getInt32(offset + 16, true),
      });
    }
  }
  const edges: WallEdge[] = [];
  const edgeById = new Map<string, WallEdge>();
  if (edgeSection) {
    const view = new DataView(edgeSection.bytes.buffer, edgeSection.bytes.byteOffset, edgeSection.bytes.byteLength);
    for (let index = 0; index < edgeSection.itemCount; index += 1) {
      const offset = index * STRIDE.edge;
      const supportKind = view.getUint8(offset + 24);
      const support: WallSupport = supportKind === 0
        ? { kind: 'absolute', baseYU: view.getInt32(offset + 28, true) }
        : supportKind === 1
          ? { kind: 'slab', slabId: readString(packet, edgeSection.bytes, offset + 40), join: (['onTop', 'atEdge'] as const)[view.getUint8(offset + 26)] ?? fail('invalid slab join') }
          : fail('invalid wall support tag');
      const id = readString(packet, edgeSection.bytes, offset);
      const edge: WallEdge = {
        id, startVertexId: readString(packet, edgeSection.bytes, offset + 8),
        endVertexId: readString(packet, edgeSection.bytes, offset + 16), support,
        heightU: view.getInt32(offset + 32, true), thicknessU: view.getInt32(offset + 36, true),
        profile: (['full', 'half'] as const)[view.getUint8(offset + 25)] ?? fail('invalid wall profile'),
        styleId: readString(packet, edgeSection.bytes, offset + 48),
        sideA: { materialId: readString(packet, edgeSection.bytes, offset + 56) },
        sideB: { materialId: readString(packet, edgeSection.bytes, offset + 64) },
        openings: [],
      };
      if (edgeById.has(id)) return fail(`duplicate edge '${id}' in source result`);
      edgeById.set(id, edge); edges.push(edge);
    }
  }
  if (openingSection) {
    const view = new DataView(openingSection.bytes.buffer, openingSection.bytes.byteOffset, openingSection.bytes.byteLength);
    for (let index = 0; index < openingSection.itemCount; index += 1) {
      const offset = index * STRIDE.opening;
      const edge = edgeById.get(readString(packet, openingSection.bytes, offset)) ?? fail('opening references a missing edge');
      (edge.openings as WallOpening[]).push({
        id: readString(packet, openingSection.bytes, offset + 8),
        kitId: readString(packet, openingSection.bytes, offset + 16),
        kind: OPENING_KIND_NAME[view.getUint8(offset + 24)] ?? fail('invalid opening kind'),
        facingSide: (['a', 'b'] as const)[view.getUint8(offset + 25)] ?? fail('invalid opening side'),
        hinge: (['start', 'end', 'none'] as const)[view.getUint8(offset + 26)] ?? fail('invalid opening hinge'),
        columnU: view.getInt32(offset + 28, true), rowU: view.getInt32(offset + 32, true),
      });
    }
  }
  const anchors: WallAnchor[] = [];
  if (anchorSection) {
    const view = new DataView(anchorSection.bytes.buffer, anchorSection.bytes.byteOffset, anchorSection.bytes.byteLength);
    for (let index = 0; index < anchorSection.itemCount; index += 1) {
      const offset = index * STRIDE.anchor;
      anchors.push({
        id: readString(packet, anchorSection.bytes, offset), edgeId: readString(packet, anchorSection.bytes, offset + 8),
        targetPieceId: readString(packet, anchorSection.bytes, offset + 16),
        side: (['a', 'b'] as const)[view.getUint8(offset + 24)] ?? fail('invalid anchor side'),
        columnU: view.getInt32(offset + 28, true), rowU: view.getInt32(offset + 32, true),
      });
    }
  }
  return { version: 1, revision, walls: { vertices, edges, anchors } };
}

export type RecordFamily = 'vertex' | 'edge' | 'opening' | 'anchor';
export type ArchitecturePatchOperation =
  | { kind: 'insert'; family: RecordFamily; id: string; after: Uint8Array }
  | { kind: 'replace'; family: RecordFamily; id: string; before: Uint8Array; after: Uint8Array }
  | { kind: 'remove'; family: RecordFamily; id: string; before: Uint8Array };
export type ArchitecturePatch = { expectedRevision: number; resultRevision: number; operations: readonly ArchitecturePatchOperation[] };

type ConfigureOpeningInput = Omit<WallOpening, 'id'> & { openingId: string };
export type ArchitectureCommand = { commandId: string; expectedRevision: number } & (
  | { kind: 'drawWall'; floor: number; start: { xU: number; zU: number }; end: { xU: number; zU: number }; startMagnetVertexId?: string; endMagnetVertexId?: string; support: WallSupport; heightU: number; thicknessU: number; profile: WallProfile; styleId: string; sideAMaterialId: string; sideBMaterialId: string }
  | { kind: 'deleteEdge'; edgeId: string }
  | { kind: 'deleteVertex'; vertexId: string }
  | { kind: 'setEdgeDimensions'; edgeId: string; support: WallSupport; heightU: number; thicknessU: number }
  | { kind: 'setProfile'; edgeId: string; profile: WallProfile }
  | { kind: 'setStyle'; edgeId: string; styleId: string }
  | { kind: 'setSideFinish'; edgeId: string; side: WallSide; materialId: string }
  | { kind: 'insertOpening'; edgeId: string; opening: ConfigureOpeningInput }
  | { kind: 'moveOpening'; openingId: string; columnU: number; rowU: number }
  | { kind: 'deleteOpening'; openingId: string }
  | ({ kind: 'configureOpening' } & ConfigureOpeningInput)
  | { kind: 'attachAnchor'; edgeId: string; side: WallSide; columnU: number; rowU: number; targetPieceId: string }
  | { kind: 'detachAnchor'; anchorId: string }
  | { kind: 'stampPrefab'; canonicalPrefabBytes: Uint8Array }
  | { kind: 'applyPatch'; patch: ArchitecturePatch }
);

const COMMAND_TAG = Object.freeze({
  drawWall: 1, deleteEdge: 2, deleteVertex: 3, setEdgeDimensions: 4, setProfile: 5,
  setStyle: 6, setSideFinish: 7, insertOpening: 8, moveOpening: 9, deleteOpening: 10,
  configureOpening: 11, attachAnchor: 12, detachAnchor: 13, stampPrefab: 14, applyPatch: 15,
} as const);
const RECORD_FAMILY_TAG = Object.freeze({ vertex: 0, edge: 1, opening: 2, anchor: 3 } as const);
const PATCH_KIND_TAG = Object.freeze({ insert: 0, replace: 1, remove: 2 } as const);

function putSupport(view: DataView, row: number, strings: StringTableBuilder, support: WallSupport, slabStringOffset: number, baseNumberOffset: number): void {
  if (support.kind === 'absolute') {
    view.setUint32(row + 128, 0, true);
    view.setFloat64(row + baseNumberOffset, support.baseYU, true);
  } else {
    view.setUint32(row + 128, 1, true);
    view.setUint32(row + 132, SLAB_JOIN_TAG[support.join], true);
    putString(view, row + slabStringOffset, strings, support.slabId);
  }
}

function putConfigureOpening(view: DataView, row: number, strings: StringTableBuilder, firstStringOffset: number, opening: ConfigureOpeningInput): void {
  putString(view, row + firstStringOffset, strings, opening.openingId);
  putString(view, row + firstStringOffset + 8, strings, opening.kitId);
  view.setFloat64(row + 64, opening.columnU, true);
  view.setFloat64(row + 72, opening.rowU, true);
  view.setUint32(row + 128, OPENING_KIND_TAG[opening.kind], true);
  view.setUint32(row + 132, SIDE_TAG[opening.facingSide], true);
  view.setUint32(row + 136, HINGE_TAG[opening.hinge], true);
}

function encodePatch(patch: ArchitecturePatch, strings: StringTableBuilder): Uint8Array {
  const rowEnd = 16 + patch.operations.length * 32;
  const chunks: Uint8Array[] = [];
  let blobLength = 0;
  const bytes = new Uint8Array(rowEnd + patch.operations.reduce((sum, operation) => {
    if (operation.kind === 'insert') return sum + operation.after.length;
    if (operation.kind === 'remove') return sum + operation.before.length;
    return sum + operation.before.length + operation.after.length;
  }, 0));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, assertUInt(patch.expectedRevision, 'patch.expectedRevision'), true);
  view.setUint32(8, assertUInt(patch.resultRevision, 'patch.resultRevision'), true);
  view.setUint32(12, patch.operations.length, true);
  patch.operations.forEach((operation, index) => {
    const offset = 16 + index * 32;
    view.setUint8(offset, PATCH_KIND_TAG[operation.kind]);
    view.setUint8(offset + 1, RECORD_FAMILY_TAG[operation.family]);
    putString(view, offset + 4, strings, operation.id);
    const before = operation.kind === 'insert' ? null : operation.before;
    const after = operation.kind === 'remove' ? null : operation.after;
    if (before) { view.setUint32(offset + 12, rowEnd + blobLength, true); view.setUint32(offset + 16, before.length, true); chunks.push(before); blobLength += before.length; }
    if (after) { view.setUint32(offset + 20, rowEnd + blobLength, true); view.setUint32(offset + 24, after.length, true); chunks.push(after); blobLength += after.length; }
  });
  let cursor = rowEnd;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
  return bytes;
}

function encodeCommand(command: ArchitectureCommand, strings: StringTableBuilder): SectionInput[] {
  const row = new Uint8Array(STRIDE.command);
  const view = new DataView(row.buffer);
  view.setUint16(0, COMMAND_TAG[command.kind], true);
  view.setUint32(4, assertUInt(command.expectedRevision, 'command.expectedRevision'), true);
  putString(view, 8, strings, command.commandId);
  let binary: SectionInput | undefined;
  switch (command.kind) {
    case 'drawWall':
      if (command.startMagnetVertexId) putString(view, 16, strings, command.startMagnetVertexId);
      if (command.endMagnetVertexId) putString(view, 24, strings, command.endMagnetVertexId);
      putSupport(view, 0, strings, command.support, 32, 96);
      putString(view, 40, strings, command.styleId); putString(view, 48, strings, command.sideAMaterialId); putString(view, 56, strings, command.sideBMaterialId);
      view.setFloat64(64, command.start.xU, true); view.setFloat64(72, command.start.zU, true);
      view.setFloat64(80, command.end.xU, true); view.setFloat64(88, command.end.zU, true);
      view.setFloat64(104, command.heightU, true); view.setFloat64(112, command.thicknessU, true);
      view.setUint32(136, PROFILE_TAG[command.profile], true); view.setInt32(140, assertInt32(command.floor, 'draw.floor'), true);
      break;
    case 'deleteEdge': putString(view, 16, strings, command.edgeId); break;
    case 'deleteVertex': putString(view, 16, strings, command.vertexId); break;
    case 'setEdgeDimensions':
      putString(view, 16, strings, command.edgeId); putSupport(view, 0, strings, command.support, 24, 64);
      view.setFloat64(72, command.heightU, true); view.setFloat64(80, command.thicknessU, true); break;
    case 'setProfile': putString(view, 16, strings, command.edgeId); view.setUint32(128, PROFILE_TAG[command.profile], true); break;
    case 'setStyle': putString(view, 16, strings, command.edgeId); putString(view, 24, strings, command.styleId); break;
    case 'setSideFinish': putString(view, 16, strings, command.edgeId); putString(view, 24, strings, command.materialId); view.setUint32(128, SIDE_TAG[command.side], true); break;
    case 'insertOpening': putString(view, 16, strings, command.edgeId); putConfigureOpening(view, 0, strings, 24, command.opening); break;
    case 'moveOpening': putString(view, 16, strings, command.openingId); view.setFloat64(64, command.columnU, true); view.setFloat64(72, command.rowU, true); break;
    case 'deleteOpening': putString(view, 16, strings, command.openingId); break;
    case 'configureOpening': putConfigureOpening(view, 0, strings, 16, command); break;
    case 'attachAnchor':
      putString(view, 16, strings, command.edgeId); putString(view, 24, strings, command.targetPieceId);
      view.setFloat64(64, command.columnU, true); view.setFloat64(72, command.rowU, true); view.setUint32(128, SIDE_TAG[command.side], true); break;
    case 'detachAnchor': putString(view, 16, strings, command.anchorId); break;
    case 'stampPrefab': binary = { tag: SECTION_TAG.patchOperations, itemCount: 1, stride: 0, bytes: command.canonicalPrefabBytes.slice() }; break;
    case 'applyPatch': {
      const bytes = encodePatch(command.patch, strings);
      binary = { tag: SECTION_TAG.patchOperations, itemCount: command.patch.operations.length, stride: 0, bytes };
      break;
    }
  }
  return [{ tag: SECTION_TAG.command, itemCount: 1, stride: STRIDE.command, bytes: row }, ...(binary ? [binary] : [])];
}

export type AffectedBounds = { floor: number; minXU: number; minYU: number; minZU: number; maxXUExclusive: number; maxYUExclusive: number; maxZUExclusive: number };
export type DirtyTarget = 'topology' | 'render' | 'collision' | 'cover' | 'materials' | 'doorsPortals' | 'navigation' | 'rooms' | 'visibility' | 'audio' | 'pickProxies';
const DIRTY_TARGET_TAG = Object.freeze({ topology: 0, render: 1, collision: 2, cover: 3, materials: 4, doorsPortals: 5, navigation: 6, rooms: 7, visibility: 8, audio: 9, pickProxies: 10 } as const);
const DIRTY_TARGET_NAME = Object.freeze(Object.keys(DIRTY_TARGET_TAG) as DirtyTarget[]);

function encodeBounds(values: readonly AffectedBounds[]): SectionInput {
  const bytes = new Uint8Array(values.length * STRIDE.affectedBounds);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => {
    const offset = index * STRIDE.affectedBounds;
    [value.floor, value.minXU, value.minYU, value.minZU, value.maxXUExclusive, value.maxYUExclusive, value.maxZUExclusive]
      .forEach((component, componentIndex) => view.setInt32(offset + componentIndex * 4, assertInt32(component, 'affected bound'), true));
  });
  return { tag: SECTION_TAG.affectedBounds, itemCount: values.length, stride: STRIDE.affectedBounds, bytes };
}

function encodeTargets(values: readonly DirtyTarget[]): SectionInput {
  const bytes = new Uint8Array(values.length * STRIDE.dirtyTarget);
  values.forEach((value, index) => { bytes[index * STRIDE.dirtyTarget] = DIRTY_TARGET_TAG[value]; });
  return { tag: SECTION_TAG.dirtyTargets, itemCount: values.length, stride: STRIDE.dirtyTarget, bytes };
}

export type MutationReceipt = {
  commandId: string;
  sourceRevisionBefore: number;
  sourceRevisionAfter: number;
  sourceHashBefore: string;
  sourceHashAfter: string;
  affectedBounds: AffectedBounds[];
  dirtyTargets: DirtyTarget[];
  forwardPatchBytes: Uint8Array;
};
export type ArchitectureMutation = { source: ArchitectureSource; receipt: MutationReceipt };
export type ArchitectureRay = { originMeters: readonly [number, number, number]; direction: readonly [number, number, number]; maximumDistanceMeters: number };
export type ArchitectureRayHit = null | { kind: 'wallFace' | 'openingFrame'; edgeId: string; openingId?: string; side: WallSide; columnU: number; rowU: number; distanceMeters: number; pointMeters: [number, number, number]; normal: [number, number, number] };
export type ArchitectureScaleMetadata = { unitsPerMeter: number; subdivisions: { x: number; y: number; z: number }; tileMeters: number; sourceVersion: number; packetVersion: number };

function decodeMutation(packet: DecodedArchitecturePacket): ArchitectureMutation {
  const source = decodeSource(packet);
  const receipt = requireSection(packet, SECTION_TAG.command, 40, 1);
  const view = new DataView(receipt.bytes.buffer, receipt.bytes.byteOffset, receipt.bytes.byteLength);
  const boundsSection = packet.sections.get(SECTION_TAG.affectedBounds);
  const targetSection = packet.sections.get(SECTION_TAG.dirtyTargets);
  const affectedBounds: AffectedBounds[] = [];
  if (boundsSection) {
    if (boundsSection.stride !== STRIDE.affectedBounds) return fail('mutation affected-bounds stride mismatch');
    const boundsView = new DataView(boundsSection.bytes.buffer, boundsSection.bytes.byteOffset, boundsSection.bytes.byteLength);
    for (let index = 0; index < boundsSection.itemCount; index += 1) {
      const offset = index * STRIDE.affectedBounds;
      affectedBounds.push({ floor: boundsView.getInt32(offset, true), minXU: boundsView.getInt32(offset + 4, true), minYU: boundsView.getInt32(offset + 8, true), minZU: boundsView.getInt32(offset + 12, true), maxXUExclusive: boundsView.getInt32(offset + 16, true), maxYUExclusive: boundsView.getInt32(offset + 20, true), maxZUExclusive: boundsView.getInt32(offset + 24, true) });
    }
  }
  const dirtyTargets: DirtyTarget[] = [];
  if (targetSection) {
    if (targetSection.stride !== STRIDE.dirtyTarget) return fail('mutation dirty-target stride mismatch');
    for (let index = 0; index < targetSection.itemCount; index += 1) dirtyTargets.push(DIRTY_TARGET_NAME[targetSection.bytes[index * STRIDE.dirtyTarget]!] ?? fail('invalid dirty target'));
  }
  return { source, receipt: {
    commandId: readString(packet, receipt.bytes, 0), sourceRevisionBefore: view.getUint32(8, true), sourceRevisionAfter: view.getUint32(12, true),
    sourceHashBefore: readString(packet, receipt.bytes, 16), sourceHashAfter: readString(packet, receipt.bytes, 24),
    affectedBounds, dirtyTargets, forwardPatchBytes: packet.sections.get(SECTION_TAG.patchOperations)?.bytes.slice() ?? fail('mutation result is missing its forward patch'),
  } };
}

function emptyRequest(kind: PacketKind): Uint8Array { return encodePacket({ kind }); }

export const architectureHost = Object.freeze({
  validateCatalog(entries: readonly ArchitectureCatalogEntry[]): void {
    requireResult(validateArchitectureCatalogPacket(encodeCatalogEntries(PACKET_KIND.catalogValidateRequest, entries)), 'catalog validate', PACKET_KIND.catalogValidateResult);
  },
  installCatalog(entries: readonly ArchitectureCatalogEntry[]): void {
    requireResult(installArchitectureCatalogPacket(encodeCatalogEntries(PACKET_KIND.catalogInstallRequest, entries)), 'catalog install', PACKET_KIND.catalogInstallResult);
  },
  queryCatalog(query: ArchitectureCatalogQuery): number[] {
    return decodeCatalogQueryResult(requireResult(queryArchitectureCatalogPacket(encodeCatalogQuery(query)), 'catalog query', PACKET_KIND.catalogQueryResult));
  },
  readCatalog(): ArchitectureCatalogEntry[] {
    return decodeCatalogEntries(requireResult(readMeasuredArchitectureCatalogPacket(emptyRequest(PACKET_KIND.catalogReadbackRequest)), 'catalog readback', PACKET_KIND.catalogReadbackResult));
  },
  validateSource(source: ArchitectureSource): void {
    requireResult(validateArchitectureSourcePacket(encodeSourceRequest(PACKET_KIND.sourceValidateRequest, source)), 'source validate', PACKET_KIND.sourceValidateResult);
  },
  mutate(source: ArchitectureSource, command: ArchitectureCommand): ArchitectureMutation {
    const strings = new StringTableBuilder();
    const sections = appendSourceSections(source, strings);
    sections.push(...encodeCommand(command, strings));
    const request = encodePacket({ kind: PACKET_KIND.mutateRequest, sourceRevision: source.revision, family: FAMILY_TAG.wall, sections, stringTable: strings.finish() });
    return decodeMutation(requireResult(mutateArchitecturePacket(request), 'mutate', PACKET_KIND.mutateResult));
  },
  compile(source: ArchitectureSource, options: { affectedBounds?: readonly AffectedBounds[]; targets?: readonly DirtyTarget[] } = {}): Uint8Array {
    const strings = new StringTableBuilder();
    const sections = appendSourceSections(source, strings);
    if (options.affectedBounds?.length) sections.push(encodeBounds(options.affectedBounds));
    if (options.targets?.length) sections.push(encodeTargets(options.targets));
    const request = encodePacket({ kind: PACKET_KIND.compileRequest, sourceRevision: source.revision, family: FAMILY_TAG.wall, sections, stringTable: strings.finish() });
    const result = requireResult(compileArchitecturePacket(request), 'compile', PACKET_KIND.compileResult);
    const bundle = result.sections.get(SECTION_TAG.renderBands) ?? fail('compile result is missing its canonical bundle');
    if (bundle.itemCount !== 1 || bundle.stride !== 0) return fail('compile result bundle section shape mismatch');
    return bundle.bytes.slice();
  },
  raycast(source: ArchitectureSource, ray: ArchitectureRay): ArchitectureRayHit {
    const strings = new StringTableBuilder();
    const row = new Uint8Array(STRIDE.ray);
    const view = new DataView(row.buffer);
    [...ray.originMeters, ...ray.direction, ray.maximumDistanceMeters].forEach((value, index) => view.setFloat64(index * 8, value, true));
    const sections = appendSourceSections(source, strings);
    sections.push({ tag: SECTION_TAG.ray, itemCount: 1, stride: STRIDE.ray, bytes: row });
    const request = encodePacket({ kind: PACKET_KIND.raycastRequest, sourceRevision: source.revision, family: FAMILY_TAG.wall, sections, stringTable: strings.finish() });
    const result = requireResult(raycastArchitecturePacket(request), 'raycast', PACKET_KIND.raycastResult);
    const hit = requireSection(result, SECTION_TAG.rayHit, STRIDE.rayHit, 1);
    const hitView = new DataView(hit.bytes.buffer, hit.bytes.byteOffset, hit.bytes.byteLength);
    if (hitView.getUint8(0) === 0) return null;
    if (hitView.getUint8(0) !== 1) return fail('ray result has an invalid hit flag');
    return {
      kind: (['wallFace', 'openingFrame'] as const)[hitView.getUint8(1)] ?? fail('ray result has an invalid kind'),
      edgeId: readString(result, hit.bytes, 12),
      openingId: readString(result, hit.bytes, 20) || undefined,
      side: (['a', 'b'] as const)[hitView.getUint8(2)] ?? fail('ray result has an invalid side'),
      columnU: hitView.getInt32(4, true), rowU: hitView.getInt32(8, true), distanceMeters: hitView.getFloat64(32, true),
      pointMeters: [hitView.getFloat64(40, true), hitView.getFloat64(48, true), hitView.getFloat64(56, true)],
      normal: [hitView.getFloat64(64, true), hitView.getFloat64(72, true), hitView.getFloat64(80, true)],
    };
  },
  openingSlots(source: ArchitectureSource, edgeId: string, catalogId: string): WallCell[] {
    const strings = new StringTableBuilder();
    const sections = appendSourceSections(source, strings);
    const row = new Uint8Array(16);
    const view = new DataView(row.buffer);
    putString(view, 0, strings, edgeId); putString(view, 8, strings, catalogId);
    sections.push({ tag: SECTION_TAG.openingSlots, itemCount: 1, stride: 16, bytes: row });
    const request = encodePacket({ kind: PACKET_KIND.openingSlotsRequest, sourceRevision: source.revision, family: FAMILY_TAG.wall, sections, stringTable: strings.finish() });
    const result = requireResult(enumerateArchitectureOpeningSlotsPacket(request), 'opening slots', PACKET_KIND.openingSlotsResult);
    const slots = requireSection(result, SECTION_TAG.openingSlots, STRIDE.openingSlot);
    const slotsView = new DataView(slots.bytes.buffer, slots.bytes.byteOffset, slots.bytes.byteLength);
    return Array.from({ length: slots.itemCount }, (_, index) => ({ columnU: slotsView.getInt32(index * 8, true), rowU: slotsView.getInt32(index * 8 + 4, true) }));
  },
  scaleMetadata(): ArchitectureScaleMetadata {
    const result = requireResult(readArchitectureScalePacket(emptyRequest(PACKET_KIND.scaleMetadataRequest)), 'scale metadata', PACKET_KIND.scaleMetadataResult);
    const section = requireSection(result, SECTION_TAG.scaleMetadata, STRIDE.scaleMetadata, 1);
    const view = new DataView(section.bytes.buffer, section.bytes.byteOffset, section.bytes.byteLength);
    return { unitsPerMeter: view.getInt32(0, true), subdivisions: { x: view.getInt32(4, true), y: view.getInt32(8, true), z: view.getInt32(12, true) }, tileMeters: view.getFloat64(16, true), sourceVersion: view.getUint16(24, true), packetVersion: view.getUint16(26, true) };
  },
});

export const architectureHostTesting = Object.freeze({
  encodePacket,
  encodeCatalogEntries,
  encodeCatalogQuery,
  encodeSourceRequest,
  requireResult,
});
