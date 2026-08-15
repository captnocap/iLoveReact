//! Bounded sectioned host wire for semantic architecture.
//!
//! JavaScript and native exchange only little-endian bytes. No pointers,
//! allocator-backed slices, derived topology indices, or renderer handles cross
//! this boundary. Semantic row codecs are layered over this envelope.

const std = @import("std");
const architecture = @import("building_architecture");

const types = architecture.types;
const catalog = architecture.catalog;

pub const magic: u32 = 0x57414a52;
pub const packet_version: u16 = 1;
pub const header_bytes: u32 = 40;
pub const section_directory_bytes: u32 = 24;
pub const section_alignment: u32 = 8;

pub const Limits = struct {
    pub const maximum_packet_bytes: u32 = 67_108_864;
    pub const maximum_sections: u32 = 64;
    pub const maximum_string_bytes: u32 = 4_194_304;
    pub const maximum_string_count: u32 = 262_144;
    pub const maximum_catalog_entries: u32 = 65_536;
    pub const maximum_vertices: u32 = 1_048_576;
    pub const maximum_edges: u32 = 1_048_576;
    pub const maximum_openings: u32 = 1_048_576;
    pub const maximum_anchors: u32 = 1_048_576;
    pub const maximum_output_rows: u32 = 8_388_608;
};

pub const PacketKind = enum(u16) {
    catalog_validate_request = 1,
    catalog_validate_result = 2,
    catalog_install_request = 3,
    catalog_install_result = 4,
    catalog_query_request = 5,
    catalog_query_result = 6,
    source_validate_request = 7,
    source_validate_result = 8,
    mutate_request = 9,
    mutate_result = 10,
    compile_request = 11,
    compile_result = 12,
    raycast_request = 13,
    raycast_result = 14,
    opening_slots_request = 15,
    opening_slots_result = 16,
    // 17/18 were migrate_v4_request/result — retired with the v4 wall-migration
    // lane (req_4462); the values stay reserved and are never reallocated.
    scale_metadata_request = 19,
    scale_metadata_result = 20,
    catalog_readback_request = 21,
    catalog_readback_result = 22,
};

pub const FamilyTag = enum(u16) {
    none = 0,
    wall = 1,
    floor = 2,
    vertical_link = 3,
    roof = 4,
};

pub const TargetTag = enum(u16) {
    none = 0,
    topology = 1,
    render = 2,
    collision = 3,
    cover = 4,
    materials = 5,
    doors_portals = 6,
    navigation = 7,
    rooms = 8,
    visibility = 9,
    audio = 10,
    pick_proxies = 11,
    diagnostics = 12,
};

pub const SectionTag = enum(u16) {
    source_header = 1,
    vertices = 2,
    edges = 3,
    openings = 4,
    anchors = 5,
    command = 6,
    patch_operations = 7,
    remaps = 8,
    face_lineage = 9,
    affected_bounds = 10,
    dirty_targets = 11,
    diagnostics = 12,
    catalog_entries = 20,
    catalog_tags = 21,
    catalog_masks = 22,
    catalog_query = 23,
    render_bands = 30,
    collider_bands = 31,
    material_bindings = 32,
    doors = 33,
    portals = 34,
    gameplay_bands = 35,
    room_faces = 36,
    pick_proxies = 37,
    target_hashes = 38,
    ray = 40,
    ray_hit = 41,
    opening_slots = 42,
    // 50/51 were legacy_modules/migration_map — retired with the v4 wall-migration
    // lane (req_4462); the values stay reserved and are never reallocated.
    rejection = 60,
    scale_metadata = 61,
};

pub const RejectionCode = enum(u16) {
    short_packet = 1,
    bad_magic = 2,
    unsupported_packet_version = 3,
    length_mismatch = 4,
    trailing_bytes = 5,
    count_limit = 6,
    offset_out_of_range = 7,
    section_overlap = 8,
    unknown_required_section_version = 9,
    invalid_utf8 = 10,
    invalid_tag = 11,
    invalid_source = 12,
    invalid_catalog = 13,
    unknown_catalog_id = 14,
    stale_source_revision = 15,
    mutation_rejected = 16,
    compile_rejected = 17,
    raycast_rejected = 18,
    // 19 was migration_rejected — retired with the v4 wall-migration lane
    // (req_4462); the value stays reserved and is never reallocated.
};

pub const CommandTag = enum(u16) {
    draw_wall = 1,
    delete_edge = 2,
    delete_vertex = 3,
    set_edge_dimensions = 4,
    set_profile = 5,
    set_style = 6,
    set_side_finish = 7,
    insert_opening = 8,
    move_opening = 9,
    delete_opening = 10,
    configure_opening = 11,
    attach_anchor = 12,
    detach_anchor = 13,
    stamp_prefab = 14,
    apply_patch = 15,
};

pub const MutationRejectionTag = enum(u16) {
    invalid_source = 1,
    invalid_catalog = 2,
    unknown_catalog_id = 3,
    stale_source_revision = 4,
    duplicate_command_id = 5,
    structural_value_not_integer = 6,
    zero_length_edge = 7,
    short_edge = 8,
    off_lattice_intersection = 9,
    collinear_overlap = 10,
    opening_out_of_bounds = 11,
    opening_occupied_collision = 12,
    opening_clearance_collision = 13,
    opening_incompatible_profile = 14,
    opening_incompatible_thickness = 15,
    opening_incompatible_height = 16,
    split_intersects_surface_child = 17,
    topology_degenerate = 18,
    limit_exceeded = 19,
};

pub const Header = struct {
    kind: PacketKind,
    source_revision: u32,
    family: FamilyTag,
    target: TargetTag,
};

pub const Section = struct {
    tag: SectionTag,
    version: u16,
    item_count: u32,
    element_stride: u32,
    bytes: []u8,

    pub fn deinit(self: *Section, allocator: std.mem.Allocator) void {
        if (self.bytes.len != 0) allocator.free(self.bytes);
        self.* = undefined;
    }
};

/// Generic decoded envelope. Semantic request/result helpers consume these owned
/// section bytes after the structural decoder has proved all bounds and tags.
pub const Packet = struct {
    header: Header,
    sections: []Section,
    string_table: []u8,

    pub fn deinit(self: *Packet, allocator: std.mem.Allocator) void {
        for (self.sections) |*section| section.deinit(allocator);
        if (self.sections.len != 0) allocator.free(self.sections);
        if (self.string_table.len != 0) allocator.free(self.string_table);
        self.* = undefined;
    }

    pub fn findSection(self: *const Packet, tag: SectionTag) ?*const Section {
        for (self.sections) |*section| if (section.tag == tag) return section;
        return null;
    }
};

pub const WireError = std.mem.Allocator.Error || error{
    short_packet,
    bad_magic,
    unsupported_packet_version,
    length_mismatch,
    trailing_bytes,
    count_limit,
    offset_out_of_range,
    section_overlap,
    unknown_required_section_version,
    invalid_utf8,
    invalid_tag,
    invalid_section_shape,
    duplicate_section,
    nonzero_reserved,
    missing_required_section,
    invalid_string_reference,
    semantic_decode_failed,
};

pub const source_header_stride: u32 = 8;
pub const vertex_stride: u32 = 24;
pub const edge_stride: u32 = 72;
pub const opening_stride: u32 = 40;
pub const anchor_stride: u32 = 40;
pub const catalog_entry_stride: u32 = 176;
pub const catalog_tag_stride: u32 = 16;
pub const catalog_mask_stride: u32 = 16;
pub const catalog_query_stride: u32 = 32;
pub const command_stride: u32 = 160;
pub const affected_bounds_stride: u32 = 28;
pub const dirty_target_stride: u32 = 4;
pub const ray_stride: u32 = 56;
pub const ray_hit_stride: u32 = 88;
pub const opening_slot_stride: u32 = 8;
pub const scale_metadata_stride: u32 = 32;

pub fn encode(allocator: std.mem.Allocator, packet: *const Packet) WireError![]u8 {
    try validateHeaderTags(packet.header);
    if (packet.sections.len > Limits.maximum_sections) return error.count_limit;
    if (packet.string_table.len > Limits.maximum_string_bytes) return error.count_limit;
    if (!std.unicode.utf8ValidateSlice(packet.string_table)) return error.invalid_utf8;

    const order = try allocator.alloc(usize, packet.sections.len);
    defer freeSlice(usize, allocator, order);
    for (order, 0..) |*index, value| index.* = value;
    std.mem.sort(usize, order, packet.sections, sectionIndexLessThan);
    const offsets = try allocator.alloc(u32, packet.sections.len);
    defer freeSlice(u32, allocator, offsets);

    var cursor = try checkedAddU32(header_bytes, try checkedMulU32(@intCast(packet.sections.len), section_directory_bytes));
    var previous_tag: ?SectionTag = null;
    for (order) |source_index| {
        const section = packet.sections[source_index];
        if (previous_tag == section.tag) return error.duplicate_section;
        previous_tag = section.tag;
        try validateSectionShape(section.tag, section.version, section.item_count, section.element_stride, section.bytes.len);
        cursor = try alignForward(cursor, section_alignment);
        offsets[source_index] = cursor;
        cursor = try checkedAddU32(cursor, @intCast(section.bytes.len));
    }
    const string_table_offset = try alignForward(cursor, section_alignment);
    const total_length = try checkedAddU32(string_table_offset, @intCast(packet.string_table.len));
    if (total_length > Limits.maximum_packet_bytes) return error.count_limit;

    const bytes = try allocator.alloc(u8, total_length);
    errdefer allocator.free(bytes);
    @memset(bytes, 0);
    writeInt(u32, bytes, 0, magic);
    writeInt(u16, bytes, 4, packet_version);
    writeInt(u16, bytes, 6, @intFromEnum(packet.header.kind));
    writeInt(u32, bytes, 8, total_length);
    writeInt(u32, bytes, 12, packet.header.source_revision);
    writeInt(u16, bytes, 16, @intFromEnum(packet.header.family));
    writeInt(u16, bytes, 18, @intFromEnum(packet.header.target));
    writeInt(u32, bytes, 20, @intCast(packet.sections.len));
    writeInt(u32, bytes, 24, header_bytes);
    writeInt(u32, bytes, 28, string_table_offset);
    writeInt(u32, bytes, 32, @intCast(packet.string_table.len));
    for (order, 0..) |source_index, directory_index| {
        const section = packet.sections[source_index];
        const directory_offset: usize = header_bytes + directory_index * section_directory_bytes;
        writeInt(u16, bytes, directory_offset, @intFromEnum(section.tag));
        writeInt(u16, bytes, directory_offset + 2, section.version);
        writeInt(u32, bytes, directory_offset + 4, section.item_count);
        writeInt(u32, bytes, directory_offset + 8, offsets[source_index]);
        writeInt(u32, bytes, directory_offset + 12, @intCast(section.bytes.len));
        writeInt(u32, bytes, directory_offset + 16, section.element_stride);
        const payload_offset: usize = offsets[source_index];
        @memcpy(bytes[payload_offset .. payload_offset + section.bytes.len], section.bytes);
    }
    @memcpy(bytes[string_table_offset .. string_table_offset + packet.string_table.len], packet.string_table);
    return bytes;
}

pub fn decode(allocator: std.mem.Allocator, bytes: []const u8) WireError!Packet {
    if (bytes.len < header_bytes) return error.short_packet;
    if (readInt(u32, bytes, 0) != magic) return error.bad_magic;
    if (readInt(u16, bytes, 4) != packet_version) return error.unsupported_packet_version;
    const declared_length = readInt(u32, bytes, 8);
    if (declared_length > Limits.maximum_packet_bytes) return error.count_limit;
    if (bytes.len > declared_length) return error.trailing_bytes;
    if (bytes.len < declared_length) return error.length_mismatch;

    const kind = std.enums.fromInt(PacketKind, readInt(u16, bytes, 6)) orelse return error.invalid_tag;
    const family = std.enums.fromInt(FamilyTag, readInt(u16, bytes, 16)) orelse return error.invalid_tag;
    const target = std.enums.fromInt(TargetTag, readInt(u16, bytes, 18)) orelse return error.invalid_tag;
    const header = Header{
        .kind = kind,
        .source_revision = readInt(u32, bytes, 12),
        .family = family,
        .target = target,
    };
    try validateHeaderTags(header);
    if (readInt(u32, bytes, 36) != 0) return error.nonzero_reserved;

    const section_count = readInt(u32, bytes, 20);
    if (section_count > Limits.maximum_sections) return error.count_limit;
    const string_table_length = readInt(u32, bytes, 32);
    if (string_table_length > Limits.maximum_string_bytes) return error.count_limit;
    const directory_offset = readInt(u32, bytes, 24);
    const directory_bytes = try checkedMulU32(section_count, section_directory_bytes);
    const directory_end = try checkedAddU32(directory_offset, directory_bytes);
    if (directory_offset < header_bytes or directory_end > declared_length) return error.offset_out_of_range;
    const string_table_offset = readInt(u32, bytes, 28);
    const string_table_end = try checkedAddU32(string_table_offset, string_table_length);
    if (string_table_offset < directory_end or string_table_end != declared_length) return error.offset_out_of_range;

    const raw_sections = try allocator.alloc(RawSection, section_count);
    defer freeSlice(RawSection, allocator, raw_sections);
    var previous_tag: ?u16 = null;
    var previous_version: u16 = 0;
    var previous_end = directory_end;
    var known_count: usize = 0;
    for (raw_sections, 0..) |*raw, index| {
        const row_offset: usize = directory_offset + index * section_directory_bytes;
        raw.* = .{
            .tag = readInt(u16, bytes, row_offset),
            .version = readInt(u16, bytes, row_offset + 2),
            .item_count = readInt(u32, bytes, row_offset + 4),
            .byte_offset = readInt(u32, bytes, row_offset + 8),
            .byte_length = readInt(u32, bytes, row_offset + 12),
            .element_stride = readInt(u32, bytes, row_offset + 16),
        };
        if (readInt(u32, bytes, row_offset + 20) != 0) return error.nonzero_reserved;
        if (previous_tag) |tag| {
            if (raw.tag < tag or (raw.tag == tag and raw.version < previous_version)) return error.invalid_section_shape;
            if (raw.tag == tag) return error.duplicate_section;
        }
        previous_tag = raw.tag;
        previous_version = raw.version;
        if (raw.byte_offset % section_alignment != 0) return error.offset_out_of_range;
        const payload_end = try checkedAddU32(raw.byte_offset, raw.byte_length);
        if (raw.byte_offset < directory_end or payload_end > string_table_offset) return error.offset_out_of_range;
        if (raw.byte_offset < previous_end) return error.section_overlap;
        if (!allZero(bytes[previous_end..raw.byte_offset])) return error.nonzero_reserved;
        previous_end = payload_end;
        if (std.enums.fromInt(SectionTag, raw.tag)) |tag| {
            try validateSectionShape(tag, raw.version, raw.item_count, raw.element_stride, raw.byte_length);
            known_count += 1;
        }
    }
    if (!allZero(bytes[previous_end..string_table_offset])) return error.nonzero_reserved;
    const string_table_source = bytes[string_table_offset..string_table_end];
    if (!std.unicode.utf8ValidateSlice(string_table_source)) return error.invalid_utf8;

    const sections = try allocator.alloc(Section, known_count);
    var initialized: usize = 0;
    errdefer {
        for (sections[0..initialized]) |*section| section.deinit(allocator);
        freeSlice(Section, allocator, sections);
    }
    for (raw_sections) |raw| {
        const tag = std.enums.fromInt(SectionTag, raw.tag) orelse continue;
        const payload = bytes[raw.byte_offset .. raw.byte_offset + raw.byte_length];
        sections[initialized] = .{
            .tag = tag,
            .version = raw.version,
            .item_count = raw.item_count,
            .element_stride = raw.element_stride,
            .bytes = try allocator.dupe(u8, payload),
        };
        initialized += 1;
    }
    const string_table = try allocator.dupe(u8, string_table_source);
    return .{ .header = header, .sections = sections, .string_table = string_table };
}

const StringReference = struct {
    offset: u32,
    length: u32,
};

const StringTableBuilder = struct {
    allocator: std.mem.Allocator,
    bytes: std.ArrayList(u8) = .empty,
    references: std.StringHashMap(StringReference),
    count: u32 = 0,

    fn init(allocator: std.mem.Allocator) StringTableBuilder {
        return .{ .allocator = allocator, .references = std.StringHashMap(StringReference).init(allocator) };
    }

    fn deinit(self: *StringTableBuilder) void {
        self.bytes.deinit(self.allocator);
        self.references.deinit();
        self.* = undefined;
    }

    fn add(self: *StringTableBuilder, value: []const u8) WireError!StringReference {
        if (value.len == 0) return .{ .offset = 0, .length = 0 };
        if (!std.unicode.utf8ValidateSlice(value)) return error.invalid_utf8;
        if (self.references.get(value)) |reference| return reference;
        if (self.count == Limits.maximum_string_count) return error.count_limit;
        const offset: u32 = @intCast(self.bytes.items.len);
        const length: u32 = @intCast(value.len);
        const end = try checkedAddU32(offset, length);
        if (end > Limits.maximum_string_bytes) return error.count_limit;
        try self.bytes.appendSlice(self.allocator, value);
        try self.references.put(value, .{ .offset = offset, .length = length });
        self.count += 1;
        return .{ .offset = offset, .length = length };
    }

    fn take(self: *StringTableBuilder) std.mem.Allocator.Error![]u8 {
        return self.bytes.toOwnedSlice(self.allocator);
    }
};

const PacketBuilder = struct {
    allocator: std.mem.Allocator,
    header: Header,
    sections: std.ArrayList(Section) = .empty,
    strings: StringTableBuilder,

    fn init(allocator: std.mem.Allocator, header: Header) PacketBuilder {
        return .{ .allocator = allocator, .header = header, .strings = StringTableBuilder.init(allocator) };
    }

    fn deinit(self: *PacketBuilder) void {
        for (self.sections.items) |*section| section.deinit(self.allocator);
        self.sections.deinit(self.allocator);
        self.strings.deinit();
        self.* = undefined;
    }

    fn addSection(
        self: *PacketBuilder,
        tag: SectionTag,
        item_count: usize,
        stride: u32,
        bytes: []u8,
    ) WireError!void {
        if (item_count > sectionItemLimit(tag)) return error.count_limit;
        errdefer if (bytes.len != 0) self.allocator.free(bytes);
        try self.sections.append(self.allocator, .{
            .tag = tag,
            .version = 1,
            .item_count = @intCast(item_count),
            .element_stride = stride,
            .bytes = bytes,
        });
    }

    fn finish(self: *PacketBuilder) WireError!Packet {
        const sections = try self.sections.toOwnedSlice(self.allocator);
        errdefer {
            for (sections) |*section| section.deinit(self.allocator);
            freeSlice(Section, self.allocator, sections);
        }
        const string_table = try self.strings.take();
        return .{ .header = self.header, .sections = sections, .string_table = string_table };
    }
};

fn putStringReference(row: []u8, offset: usize, reference: StringReference) void {
    writeInt(u32, row, offset, reference.offset);
    writeInt(u32, row, offset + 4, reference.length);
}

fn readStringReference(packet: *const Packet, row: []const u8, offset: usize) WireError![]const u8 {
    if (offset + 8 > row.len) return error.invalid_section_shape;
    const string_offset = readInt(u32, row, offset);
    const string_length = readInt(u32, row, offset + 4);
    if (string_length == 0) {
        if (string_offset != 0) return error.invalid_string_reference;
        return "";
    }
    const end = checkedAddU32(string_offset, string_length) catch return error.invalid_string_reference;
    if (end > packet.string_table.len) return error.invalid_string_reference;
    const value = packet.string_table[string_offset..end];
    if (!std.unicode.utf8ValidateSlice(value)) return error.invalid_utf8;
    return value;
}

fn ownedStringReference(
    allocator: std.mem.Allocator,
    packet: *const Packet,
    row: []const u8,
    offset: usize,
) WireError![]u8 {
    return allocator.dupe(u8, try readStringReference(packet, row, offset));
}

fn requireSection(packet: *const Packet, tag: SectionTag, count: ?u32, stride: u32) WireError!*const Section {
    const section = packet.findSection(tag) orelse return error.missing_required_section;
    if (count) |expected| if (section.item_count != expected) return error.invalid_section_shape;
    if (section.element_stride != stride) return error.invalid_section_shape;
    return section;
}

fn optionalFixedSection(packet: *const Packet, tag: SectionTag, stride: u32) WireError!?*const Section {
    const section = packet.findSection(tag) orelse return null;
    if (section.element_stride != stride) return error.invalid_section_shape;
    return section;
}

fn packetBytes(allocator: std.mem.Allocator, packet: *const Packet) WireError![]u8 {
    return encode(allocator, packet);
}

pub fn encodeSourcePacket(
    allocator: std.mem.Allocator,
    kind: PacketKind,
    source: *const types.ArchitectureSource,
) WireError![]u8 {
    var builder = PacketBuilder.init(allocator, .{
        .kind = kind,
        .source_revision = source.revision,
        .family = .wall,
        .target = .none,
    });
    defer builder.deinit();
    try appendSourceSections(&builder, source);
    var packet = try builder.finish();
    defer packet.deinit(allocator);
    return packetBytes(allocator, &packet);
}

fn appendSourceSections(builder: *PacketBuilder, source: *const types.ArchitectureSource) WireError!void {
    const source_row = try builder.allocator.alloc(u8, source_header_stride);
    @memset(source_row, 0);
    writeInt(u16, source_row, 0, source.version);
    writeInt(u32, source_row, 4, source.revision);
    try builder.addSection(.source_header, 1, source_header_stride, source_row);

    const vertex_bytes = try builder.allocator.alloc(u8, source.walls.vertices.len * vertex_stride);
    @memset(vertex_bytes, 0);
    for (source.walls.vertices, 0..) |vertex, index| {
        const row = vertex_bytes[index * vertex_stride ..][0..vertex_stride];
        putStringReference(row, 0, try builder.strings.add(vertex.id));
        writeInt(i32, row, 8, vertex.floor);
        writeInt(types.Unit, row, 12, vertex.x_u);
        writeInt(types.Unit, row, 16, vertex.z_u);
    }
    try builder.addSection(.vertices, source.walls.vertices.len, vertex_stride, vertex_bytes);

    const edge_bytes = try builder.allocator.alloc(u8, source.walls.edges.len * edge_stride);
    @memset(edge_bytes, 0);
    var opening_count: usize = 0;
    for (source.walls.edges) |edge| opening_count = std.math.add(usize, opening_count, edge.openings.len) catch return error.count_limit;
    if (opening_count > Limits.maximum_openings) return error.count_limit;
    const opening_bytes = try builder.allocator.alloc(u8, opening_count * opening_stride);
    errdefer freeSlice(u8, builder.allocator, opening_bytes);
    @memset(opening_bytes, 0);
    var opening_index: usize = 0;
    for (source.walls.edges, 0..) |edge, index| {
        const row = edge_bytes[index * edge_stride ..][0..edge_stride];
        putStringReference(row, 0, try builder.strings.add(edge.id));
        putStringReference(row, 8, try builder.strings.add(edge.start_vertex_id));
        putStringReference(row, 16, try builder.strings.add(edge.end_vertex_id));
        switch (edge.support) {
            .absolute => |support| {
                row[24] = 0;
                writeInt(types.Unit, row, 28, support.base_y_u);
            },
            .slab => |support| {
                row[24] = 1;
                row[26] = @intFromEnum(support.join);
                putStringReference(row, 40, try builder.strings.add(support.slab_id));
            },
        }
        row[25] = @intFromEnum(edge.profile);
        writeInt(types.Unit, row, 32, edge.height_u);
        writeInt(types.Unit, row, 36, edge.thickness_u);
        putStringReference(row, 48, try builder.strings.add(edge.style_id));
        putStringReference(row, 56, try builder.strings.add(edge.side_a.material_id));
        putStringReference(row, 64, try builder.strings.add(edge.side_b.material_id));
        for (edge.openings) |opening| {
            const opening_row = opening_bytes[opening_index * opening_stride ..][0..opening_stride];
            putStringReference(opening_row, 0, try builder.strings.add(edge.id));
            putStringReference(opening_row, 8, try builder.strings.add(opening.id));
            putStringReference(opening_row, 16, try builder.strings.add(opening.kit_id));
            opening_row[24] = @intFromEnum(opening.kind);
            opening_row[25] = @intFromEnum(opening.facing_side);
            opening_row[26] = @intFromEnum(opening.hinge);
            writeInt(types.Unit, opening_row, 28, opening.column_u);
            writeInt(types.Unit, opening_row, 32, opening.row_u);
            opening_index += 1;
        }
    }
    try builder.addSection(.edges, source.walls.edges.len, edge_stride, edge_bytes);
    try builder.addSection(.openings, opening_count, opening_stride, opening_bytes);

    const anchor_bytes = try builder.allocator.alloc(u8, source.walls.anchors.len * anchor_stride);
    @memset(anchor_bytes, 0);
    for (source.walls.anchors, 0..) |anchor, index| {
        const row = anchor_bytes[index * anchor_stride ..][0..anchor_stride];
        putStringReference(row, 0, try builder.strings.add(anchor.id));
        putStringReference(row, 8, try builder.strings.add(anchor.edge_id));
        putStringReference(row, 16, try builder.strings.add(anchor.target_piece_id));
        row[24] = @intFromEnum(anchor.side);
        writeInt(types.Unit, row, 28, anchor.column_u);
        writeInt(types.Unit, row, 32, anchor.row_u);
    }
    try builder.addSection(.anchors, source.walls.anchors.len, anchor_stride, anchor_bytes);
}

pub fn decodeSource(allocator: std.mem.Allocator, packet: *const Packet) WireError!types.ArchitectureSource {
    const source_section = try requireSection(packet, .source_header, 1, source_header_stride);
    const source_row = source_section.bytes[0..source_header_stride];
    if (readInt(u16, source_row, 2) != 0) return error.nonzero_reserved;
    const version = readInt(u16, source_row, 0);
    const revision = readInt(u32, source_row, 4);
    if (packet.header.source_revision != revision) return error.semantic_decode_failed;

    const vertices_section = try optionalFixedSection(packet, .vertices, vertex_stride);
    const edges_section = try optionalFixedSection(packet, .edges, edge_stride);
    const openings_section = try optionalFixedSection(packet, .openings, opening_stride);
    const anchors_section = try optionalFixedSection(packet, .anchors, anchor_stride);
    const vertices = try allocator.alloc(types.WallVertex, if (vertices_section) |value| value.item_count else 0);
    var initialized_vertices: usize = 0;
    errdefer {
        for (vertices[0..initialized_vertices]) |*vertex| vertex.deinit(allocator);
        freeSlice(types.WallVertex, allocator, vertices);
    }
    if (vertices_section) |section| for (0..section.item_count) |index| {
        const row = section.bytes[index * vertex_stride ..][0..vertex_stride];
        const id = try ownedStringReference(allocator, packet, row, 0);
        errdefer freeSlice(u8, allocator, id);
        vertices[index] = .{
            .id = id,
            .floor = readInt(i32, row, 8),
            .x_u = readInt(types.Unit, row, 12),
            .z_u = readInt(types.Unit, row, 16),
        };
        initialized_vertices += 1;
    };

    const edges = try allocator.alloc(types.WallEdge, if (edges_section) |value| value.item_count else 0);
    var initialized_edges: usize = 0;
    errdefer {
        for (edges[0..initialized_edges]) |*edge| edge.deinit(allocator);
        freeSlice(types.WallEdge, allocator, edges);
    }
    var edge_indices = std.StringHashMap(usize).init(allocator);
    defer edge_indices.deinit();
    if (edges_section) |section| for (0..section.item_count) |index| {
        const row = section.bytes[index * edge_stride ..][0..edge_stride];
        const id = try ownedStringReference(allocator, packet, row, 0);
        errdefer freeSlice(u8, allocator, id);
        const start_vertex_id = try ownedStringReference(allocator, packet, row, 8);
        errdefer freeSlice(u8, allocator, start_vertex_id);
        const end_vertex_id = try ownedStringReference(allocator, packet, row, 16);
        errdefer freeSlice(u8, allocator, end_vertex_id);
        const support: types.WallSupport = switch (row[24]) {
            0 => .{ .absolute = .{ .base_y_u = readInt(types.Unit, row, 28) } },
            1 => .{ .slab = .{
                .slab_id = try ownedStringReference(allocator, packet, row, 40),
                .join = std.enums.fromInt(types.SlabJoin, row[26]) orelse return error.semantic_decode_failed,
            } },
            else => return error.semantic_decode_failed,
        };
        errdefer {
            var owned_support = support;
            owned_support.deinit(allocator);
        }
        const style_id = try ownedStringReference(allocator, packet, row, 48);
        errdefer freeSlice(u8, allocator, style_id);
        const side_a = try ownedStringReference(allocator, packet, row, 56);
        errdefer freeSlice(u8, allocator, side_a);
        const side_b = try ownedStringReference(allocator, packet, row, 64);
        errdefer freeSlice(u8, allocator, side_b);
        edges[index] = .{
            .id = id,
            .start_vertex_id = start_vertex_id,
            .end_vertex_id = end_vertex_id,
            .support = support,
            .height_u = readInt(types.Unit, row, 32),
            .thickness_u = readInt(types.Unit, row, 36),
            .profile = std.enums.fromInt(types.WallProfile, row[25]) orelse return error.semantic_decode_failed,
            .style_id = style_id,
            .side_a = .{ .material_id = side_a },
            .side_b = .{ .material_id = side_b },
            .openings = &.{},
        };
        initialized_edges += 1;
        const entry = try edge_indices.getOrPut(edges[index].id);
        if (entry.found_existing) return error.semantic_decode_failed;
        entry.value_ptr.* = index;
    };

    const opening_counts = try allocator.alloc(usize, edges.len);
    defer freeSlice(usize, allocator, opening_counts);
    @memset(opening_counts, 0);
    if (openings_section) |section| for (0..section.item_count) |index| {
        const row = section.bytes[index * opening_stride ..][0..opening_stride];
        const edge_id = try readStringReference(packet, row, 0);
        const edge_index = edge_indices.get(edge_id) orelse return error.semantic_decode_failed;
        opening_counts[edge_index] = std.math.add(usize, opening_counts[edge_index], 1) catch return error.count_limit;
    };
    for (edges, 0..) |*edge, index| {
        edge.openings = try allocator.alloc(types.WallOpening, opening_counts[index]);
        for (edge.openings) |*opening| opening.* = .{
            .id = &.{},
            .kind = .door,
            .kit_id = &.{},
            .column_u = 0,
            .row_u = 0,
            .facing_side = .a,
            .hinge = .none,
        };
    }
    const opening_filled = try allocator.alloc(usize, edges.len);
    defer freeSlice(usize, allocator, opening_filled);
    @memset(opening_filled, 0);
    if (openings_section) |section| for (0..section.item_count) |index| {
        const row = section.bytes[index * opening_stride ..][0..opening_stride];
        const edge_index = edge_indices.get(try readStringReference(packet, row, 0)) orelse return error.semantic_decode_failed;
        const opening_index = opening_filled[edge_index];
        const id = try ownedStringReference(allocator, packet, row, 8);
        errdefer freeSlice(u8, allocator, id);
        const kit_id = try ownedStringReference(allocator, packet, row, 16);
        errdefer freeSlice(u8, allocator, kit_id);
        edges[edge_index].openings[opening_index] = .{
            .id = id,
            .kind = std.enums.fromInt(types.WallOpeningKind, row[24]) orelse return error.semantic_decode_failed,
            .kit_id = kit_id,
            .column_u = readInt(types.Unit, row, 28),
            .row_u = readInt(types.Unit, row, 32),
            .facing_side = std.enums.fromInt(types.WallSide, row[25]) orelse return error.semantic_decode_failed,
            .hinge = std.enums.fromInt(types.WallHinge, row[26]) orelse return error.semantic_decode_failed,
        };
        opening_filled[edge_index] += 1;
    };

    const anchors = try allocator.alloc(types.WallAnchor, if (anchors_section) |value| value.item_count else 0);
    var initialized_anchors: usize = 0;
    errdefer {
        for (anchors[0..initialized_anchors]) |*anchor| anchor.deinit(allocator);
        freeSlice(types.WallAnchor, allocator, anchors);
    }
    if (anchors_section) |section| for (0..section.item_count) |index| {
        const row = section.bytes[index * anchor_stride ..][0..anchor_stride];
        const id = try ownedStringReference(allocator, packet, row, 0);
        errdefer freeSlice(u8, allocator, id);
        const edge_id = try ownedStringReference(allocator, packet, row, 8);
        errdefer freeSlice(u8, allocator, edge_id);
        const target_piece_id = try ownedStringReference(allocator, packet, row, 16);
        errdefer freeSlice(u8, allocator, target_piece_id);
        anchors[index] = .{
            .id = id,
            .edge_id = edge_id,
            .side = std.enums.fromInt(types.WallSide, row[24]) orelse return error.semantic_decode_failed,
            .column_u = readInt(types.Unit, row, 28),
            .row_u = readInt(types.Unit, row, 32),
            .target_piece_id = target_piece_id,
        };
        initialized_anchors += 1;
    };
    return .{
        .version = version,
        .revision = revision,
        .walls = .{ .vertices = vertices, .edges = edges, .anchors = anchors },
    };
}

const CatalogEntryFlags = struct {
    const mount_bounds: u32 = 1 << 0;
    const footprint: u32 = 1 << 1;
    const wall_style: u32 = 1 << 2;
    const wall_compatibility: u32 = 1 << 3;
    const animation_hash: u32 = 1 << 4;
    const known: u32 = mount_bounds | footprint | wall_style | wall_compatibility | animation_hash;
};

const CatalogTagKind = enum(u16) {
    category_path = 1,
    theme = 2,
    gameplay = 3,
    material_hash = 4,
};

const CatalogMaskKind = enum(u16) {
    occupied = 1,
    clearance = 2,
    permitted_profile = 3,
    permitted_thickness = 4,
};

fn encodeSemanticKind(value: ?types.SemanticKind) [2]u8 {
    if (value) |semantic| return switch (semantic) {
        .wall_opening => |kind| .{ 1, @intFromEnum(kind) },
        .vertical_link => |kind| .{ 2, @intFromEnum(kind) },
        .roof_profile => |kind| .{ 3, @intFromEnum(kind) },
    };
    return .{ 0, 0 };
}

fn decodeSemanticKind(tag: u8, value: u8) WireError!?types.SemanticKind {
    return switch (tag) {
        0 => if (value == 0) null else error.semantic_decode_failed,
        1 => .{ .wall_opening = std.enums.fromInt(types.WallOpeningKind, value) orelse return error.semantic_decode_failed },
        2 => .{ .vertical_link = std.enums.fromInt(types.VerticalLinkKind, value) orelse return error.semantic_decode_failed },
        3 => .{ .roof_profile = std.enums.fromInt(types.RoofProfile, value) orelse return error.semantic_decode_failed },
        else => error.semantic_decode_failed,
    };
}

pub fn encodeCatalogPacket(
    allocator: std.mem.Allocator,
    kind: PacketKind,
    entries: []const catalog.CatalogEntry,
) WireError![]u8 {
    var builder = PacketBuilder.init(allocator, .{
        .kind = kind,
        .source_revision = 0,
        .family = .none,
        .target = .none,
    });
    defer builder.deinit();
    try appendCatalogSections(&builder, entries);
    var packet = try builder.finish();
    defer packet.deinit(allocator);
    return packetBytes(allocator, &packet);
}

fn appendCatalogSections(builder: *PacketBuilder, entries: []const catalog.CatalogEntry) WireError!void {
    if (entries.len > Limits.maximum_catalog_entries) return error.count_limit;
    const entry_bytes = try builder.allocator.alloc(u8, entries.len * catalog_entry_stride);
    @memset(entry_bytes, 0);
    var tag_count: usize = 0;
    var mask_count: usize = 0;
    for (entries) |entry| {
        tag_count = std.math.add(usize, tag_count, entry.category_path.len + entry.theme_tags.len +
            entry.gameplay_tags.len + entry.asset_refs.material_content_hashes.len) catch return error.count_limit;
        mask_count = std.math.add(usize, mask_count, entry.measurement.occupied_mask.len + entry.measurement.clearance_mask.len) catch return error.count_limit;
        if (entry.wall_opening_compatibility) |compatibility| {
            mask_count = std.math.add(usize, mask_count, compatibility.permitted_profiles.len + compatibility.permitted_thickness_u.len) catch return error.count_limit;
        }
    }
    if (tag_count > Limits.maximum_output_rows or mask_count > Limits.maximum_output_rows) return error.count_limit;
    const tag_bytes = try builder.allocator.alloc(u8, tag_count * catalog_tag_stride);
    errdefer freeSlice(u8, builder.allocator, tag_bytes);
    @memset(tag_bytes, 0);
    const mask_bytes = try builder.allocator.alloc(u8, mask_count * catalog_mask_stride);
    errdefer freeSlice(u8, builder.allocator, mask_bytes);
    @memset(mask_bytes, 0);

    var tag_index: usize = 0;
    var mask_index: usize = 0;
    for (entries, 0..) |entry, entry_index| {
        const row = entry_bytes[entry_index * catalog_entry_stride ..][0..catalog_entry_stride];
        putStringReference(row, 0, try builder.strings.add(entry.catalog_id));
        putStringReference(row, 8, try builder.strings.add(entry.content_hash));
        putStringReference(row, 16, try builder.strings.add(entry.package_id));
        putStringReference(row, 24, try builder.strings.add(entry.label));
        row[32] = @intFromEnum(entry.family);
        row[33] = @intFromEnum(entry.role);
        const semantic = encodeSemanticKind(entry.semantic_kind);
        row[34] = semantic[0];
        row[35] = semantic[1];
        var flags: u32 = 0;
        if (entry.measurement.mount_bounds_u != null) flags |= CatalogEntryFlags.mount_bounds;
        if (entry.measurement.footprint != null) flags |= CatalogEntryFlags.footprint;
        if (entry.wall_style_defaults != null) flags |= CatalogEntryFlags.wall_style;
        if (entry.wall_opening_compatibility != null) flags |= CatalogEntryFlags.wall_compatibility;
        if (entry.asset_refs.animation_content_hash != null) flags |= CatalogEntryFlags.animation_hash;
        writeInt(u32, row, 36, flags);
        const bounds = entry.measurement.source_bounds_u;
        const source_values = [_]f64{ bounds.min_x_u, bounds.min_y_u, bounds.min_z_u, bounds.max_x_u, bounds.max_y_u, bounds.max_z_u };
        for (source_values, 0..) |value, value_index| writeFloat(f64, row, 40 + value_index * 8, value);
        if (entry.measurement.mount_bounds_u) |mount| {
            const mount_values = [_]f64{ mount.min_u, mount.min_v, mount.max_u, mount.max_v };
            for (mount_values, 0..) |value, value_index| writeFloat(f64, row, 88 + value_index * 8, value);
        }
        if (entry.measurement.footprint) |footprint| {
            writeInt(types.Unit, row, 120, footprint.min_column);
            writeInt(types.Unit, row, 124, footprint.min_row);
            writeInt(types.Unit, row, 128, footprint.max_column_exclusive);
            writeInt(types.Unit, row, 132, footprint.max_row_exclusive);
        }
        writeInt(types.Unit, row, 136, entry.measurement.pivot_u.x_u);
        writeInt(types.Unit, row, 140, entry.measurement.pivot_u.y_u);
        writeInt(types.Unit, row, 144, entry.measurement.pivot_u.z_u);
        if (entry.wall_style_defaults) |style| {
            writeInt(types.Unit, row, 148, style.height_u);
            writeInt(types.Unit, row, 152, style.thickness_u);
            row[156] = @intFromEnum(style.profile);
        }
        if (entry.wall_opening_compatibility) |compatibility| row[157] = @intFromEnum(compatibility.portal_class);
        putStringReference(row, 160, try builder.strings.add(entry.asset_refs.mesh_content_hash));
        if (entry.asset_refs.animation_content_hash) |hash| putStringReference(row, 168, try builder.strings.add(hash));

        try appendCatalogStringRows(builder, tag_bytes, &tag_index, entry_index, .category_path, entry.category_path);
        try appendCatalogStringRows(builder, tag_bytes, &tag_index, entry_index, .theme, entry.theme_tags);
        try appendCatalogStringRows(builder, tag_bytes, &tag_index, entry_index, .gameplay, entry.gameplay_tags);
        try appendCatalogStringRows(builder, tag_bytes, &tag_index, entry_index, .material_hash, entry.asset_refs.material_content_hashes);
        for (entry.measurement.occupied_mask) |cell| appendCatalogMaskRow(mask_bytes, &mask_index, entry_index, .occupied, cell.column_u, cell.row_u);
        for (entry.measurement.clearance_mask) |cell| appendCatalogMaskRow(mask_bytes, &mask_index, entry_index, .clearance, cell.column_u, cell.row_u);
        if (entry.wall_opening_compatibility) |compatibility| {
            for (compatibility.permitted_profiles) |profile| appendCatalogMaskRow(mask_bytes, &mask_index, entry_index, .permitted_profile, @intFromEnum(profile), 0);
            for (compatibility.permitted_thickness_u) |thickness| appendCatalogMaskRow(mask_bytes, &mask_index, entry_index, .permitted_thickness, thickness, 0);
        }
    }
    try builder.addSection(.catalog_entries, entries.len, catalog_entry_stride, entry_bytes);
    try builder.addSection(.catalog_tags, tag_count, catalog_tag_stride, tag_bytes);
    try builder.addSection(.catalog_masks, mask_count, catalog_mask_stride, mask_bytes);
}

fn appendCatalogStringRows(
    builder: *PacketBuilder,
    bytes: []u8,
    next_index: *usize,
    entry_index: usize,
    kind: CatalogTagKind,
    values: []const []const u8,
) WireError!void {
    for (values) |value| {
        const row = bytes[next_index.* * catalog_tag_stride ..][0..catalog_tag_stride];
        writeInt(u32, row, 0, @intCast(entry_index));
        writeInt(u16, row, 4, @intFromEnum(kind));
        putStringReference(row, 8, try builder.strings.add(value));
        next_index.* += 1;
    }
}

fn appendCatalogMaskRow(
    bytes: []u8,
    next_index: *usize,
    entry_index: usize,
    kind: CatalogMaskKind,
    first: anytype,
    second: anytype,
) void {
    const row = bytes[next_index.* * catalog_mask_stride ..][0..catalog_mask_stride];
    writeInt(u32, row, 0, @intCast(entry_index));
    writeInt(u16, row, 4, @intFromEnum(kind));
    writeInt(i32, row, 8, @intCast(first));
    writeInt(i32, row, 12, @intCast(second));
    next_index.* += 1;
}

pub fn decodeCatalog(allocator: std.mem.Allocator, packet: *const Packet) WireError!catalog.Catalog {
    const entries_section = try requireSection(packet, .catalog_entries, null, catalog_entry_stride);
    const tags_section = try optionalFixedSection(packet, .catalog_tags, catalog_tag_stride);
    const masks_section = try optionalFixedSection(packet, .catalog_masks, catalog_mask_stride);
    const entry_count: usize = entries_section.item_count;
    const tag_counts = try allocator.alloc([4]usize, entry_count);
    defer freeSlice([4]usize, allocator, tag_counts);
    @memset(tag_counts, .{ 0, 0, 0, 0 });
    const mask_counts = try allocator.alloc([4]usize, entry_count);
    defer freeSlice([4]usize, allocator, mask_counts);
    @memset(mask_counts, .{ 0, 0, 0, 0 });
    if (tags_section) |section| for (0..section.item_count) |index| {
        const row = section.bytes[index * catalog_tag_stride ..][0..catalog_tag_stride];
        const entry_index = readInt(u32, row, 0);
        if (entry_index >= entry_count) return error.semantic_decode_failed;
        const kind = std.enums.fromInt(CatalogTagKind, readInt(u16, row, 4)) orelse return error.semantic_decode_failed;
        tag_counts[entry_index][@intFromEnum(kind) - 1] += 1;
        _ = try readStringReference(packet, row, 8);
    };
    if (masks_section) |section| for (0..section.item_count) |index| {
        const row = section.bytes[index * catalog_mask_stride ..][0..catalog_mask_stride];
        const entry_index = readInt(u32, row, 0);
        if (entry_index >= entry_count) return error.semantic_decode_failed;
        const kind = std.enums.fromInt(CatalogMaskKind, readInt(u16, row, 4)) orelse return error.semantic_decode_failed;
        mask_counts[entry_index][@intFromEnum(kind) - 1] += 1;
    };

    const entries = try allocator.alloc(catalog.CatalogEntry, entry_count);
    var initialized_entries: usize = 0;
    errdefer {
        for (entries[0..initialized_entries]) |*entry| entry.deinit(allocator);
        freeSlice(catalog.CatalogEntry, allocator, entries);
    }
    for (0..entry_count) |index| {
        const row = entries_section.bytes[index * catalog_entry_stride ..][0..catalog_entry_stride];
        const flags = readInt(u32, row, 36);
        if (flags & ~CatalogEntryFlags.known != 0) return error.semantic_decode_failed;
        if (flags & CatalogEntryFlags.wall_compatibility == 0 and
            (mask_counts[index][2] != 0 or mask_counts[index][3] != 0))
        {
            return error.semantic_decode_failed;
        }
        const catalog_id = try ownedStringReference(allocator, packet, row, 0);
        errdefer freeSlice(u8, allocator, catalog_id);
        const content_hash = try ownedStringReference(allocator, packet, row, 8);
        errdefer freeSlice(u8, allocator, content_hash);
        const package_id = try ownedStringReference(allocator, packet, row, 16);
        errdefer freeSlice(u8, allocator, package_id);
        const label = try ownedStringReference(allocator, packet, row, 24);
        errdefer freeSlice(u8, allocator, label);
        const category_path = try allocator.alloc([]u8, tag_counts[index][0]);
        errdefer freeSlice([]u8, allocator, category_path);
        @memset(category_path, &.{});
        const theme_tags = try allocator.alloc([]u8, tag_counts[index][1]);
        errdefer freeSlice([]u8, allocator, theme_tags);
        @memset(theme_tags, &.{});
        const gameplay_tags = try allocator.alloc([]u8, tag_counts[index][2]);
        errdefer freeSlice([]u8, allocator, gameplay_tags);
        @memset(gameplay_tags, &.{});
        const material_hashes = try allocator.alloc([]u8, tag_counts[index][3]);
        errdefer freeSlice([]u8, allocator, material_hashes);
        @memset(material_hashes, &.{});
        const occupied = try allocator.alloc(types.WallCell, mask_counts[index][0]);
        errdefer freeSlice(types.WallCell, allocator, occupied);
        const clearance = try allocator.alloc(types.WallCell, mask_counts[index][1]);
        errdefer freeSlice(types.WallCell, allocator, clearance);
        const profiles = try allocator.alloc(types.WallProfile, mask_counts[index][2]);
        errdefer freeSlice(types.WallProfile, allocator, profiles);
        const thicknesses = try allocator.alloc(types.Unit, mask_counts[index][3]);
        errdefer freeSlice(types.Unit, allocator, thicknesses);
        const mesh_hash = try ownedStringReference(allocator, packet, row, 160);
        errdefer freeSlice(u8, allocator, mesh_hash);
        const animation_hash = if (flags & CatalogEntryFlags.animation_hash != 0)
            try ownedStringReference(allocator, packet, row, 168)
        else
            null;
        errdefer if (animation_hash) |value| freeSlice(u8, allocator, value);
        entries[index] = .{
            .catalog_id = catalog_id,
            .content_hash = content_hash,
            .package_id = package_id,
            .label = label,
            .family = std.enums.fromInt(types.ArchitectureFamily, row[32]) orelse return error.semantic_decode_failed,
            .role = std.enums.fromInt(types.ArchitectureKitRole, row[33]) orelse return error.semantic_decode_failed,
            .semantic_kind = try decodeSemanticKind(row[34], row[35]),
            .category_path = category_path,
            .theme_tags = theme_tags,
            .gameplay_tags = gameplay_tags,
            .measurement = .{
                .source_bounds_u = .{
                    .min_x_u = readFloat(f64, row, 40),
                    .min_y_u = readFloat(f64, row, 48),
                    .min_z_u = readFloat(f64, row, 56),
                    .max_x_u = readFloat(f64, row, 64),
                    .max_y_u = readFloat(f64, row, 72),
                    .max_z_u = readFloat(f64, row, 80),
                },
                .mount_bounds_u = if (flags & CatalogEntryFlags.mount_bounds != 0) .{
                    .min_u = readFloat(f64, row, 88),
                    .min_v = readFloat(f64, row, 96),
                    .max_u = readFloat(f64, row, 104),
                    .max_v = readFloat(f64, row, 112),
                } else null,
                .footprint = if (flags & CatalogEntryFlags.footprint != 0) .{
                    .min_column = readInt(types.Unit, row, 120),
                    .min_row = readInt(types.Unit, row, 124),
                    .max_column_exclusive = readInt(types.Unit, row, 128),
                    .max_row_exclusive = readInt(types.Unit, row, 132),
                } else null,
                .occupied_mask = occupied,
                .clearance_mask = clearance,
                .pivot_u = .{
                    .x_u = readInt(types.Unit, row, 136),
                    .y_u = readInt(types.Unit, row, 140),
                    .z_u = readInt(types.Unit, row, 144),
                },
            },
            .wall_style_defaults = if (flags & CatalogEntryFlags.wall_style != 0) .{
                .height_u = readInt(types.Unit, row, 148),
                .thickness_u = readInt(types.Unit, row, 152),
                .profile = std.enums.fromInt(types.WallProfile, row[156]) orelse return error.semantic_decode_failed,
            } else null,
            .wall_opening_compatibility = if (flags & CatalogEntryFlags.wall_compatibility != 0) .{
                .permitted_profiles = profiles,
                .permitted_thickness_u = thicknesses,
                .portal_class = std.enums.fromInt(types.PortalClass, row[157]) orelse return error.semantic_decode_failed,
            } else null,
            .asset_refs = .{
                .mesh_content_hash = mesh_hash,
                .material_content_hashes = material_hashes,
                .animation_content_hash = animation_hash,
            },
        };
        initialized_entries += 1;
    }

    const tag_filled = try allocator.alloc([4]usize, entry_count);
    defer freeSlice([4]usize, allocator, tag_filled);
    @memset(tag_filled, .{ 0, 0, 0, 0 });
    if (tags_section) |section| for (0..section.item_count) |index| {
        const row = section.bytes[index * catalog_tag_stride ..][0..catalog_tag_stride];
        const entry_index = readInt(u32, row, 0);
        const kind = std.enums.fromInt(CatalogTagKind, readInt(u16, row, 4)).?;
        const kind_index = @intFromEnum(kind) - 1;
        const destination: *[][]u8 = switch (kind) {
            .category_path => &entries[entry_index].category_path,
            .theme => &entries[entry_index].theme_tags,
            .gameplay => &entries[entry_index].gameplay_tags,
            .material_hash => &entries[entry_index].asset_refs.material_content_hashes,
        };
        destination.*[tag_filled[entry_index][kind_index]] = try ownedStringReference(allocator, packet, row, 8);
        tag_filled[entry_index][kind_index] += 1;
    };
    const mask_filled = try allocator.alloc([4]usize, entry_count);
    defer freeSlice([4]usize, allocator, mask_filled);
    @memset(mask_filled, .{ 0, 0, 0, 0 });
    if (masks_section) |section| for (0..section.item_count) |index| {
        const row = section.bytes[index * catalog_mask_stride ..][0..catalog_mask_stride];
        const entry_index = readInt(u32, row, 0);
        const kind = std.enums.fromInt(CatalogMaskKind, readInt(u16, row, 4)).?;
        const kind_index = @intFromEnum(kind) - 1;
        const destination_index = mask_filled[entry_index][kind_index];
        switch (kind) {
            .occupied => entries[entry_index].measurement.occupied_mask[destination_index] = .{
                .column_u = readInt(types.Unit, row, 8), .row_u = readInt(types.Unit, row, 12),
            },
            .clearance => entries[entry_index].measurement.clearance_mask[destination_index] = .{
                .column_u = readInt(types.Unit, row, 8), .row_u = readInt(types.Unit, row, 12),
            },
            .permitted_profile => entries[entry_index].wall_opening_compatibility.?.permitted_profiles[destination_index] =
                std.enums.fromInt(types.WallProfile, @as(u8, @intCast(readInt(i32, row, 8)))) orelse return error.semantic_decode_failed,
            .permitted_thickness => entries[entry_index].wall_opening_compatibility.?.permitted_thickness_u[destination_index] = readInt(types.Unit, row, 8),
        }
        mask_filled[entry_index][kind_index] += 1;
    };
    return .{ .entries = entries };
}

pub fn encodeCatalogQueryPacket(
    allocator: std.mem.Allocator,
    query: catalog.CatalogQuery,
) WireError![]u8 {
    var builder = PacketBuilder.init(allocator, .{
        .kind = .catalog_query_request,
        .source_revision = 0,
        .family = .none,
        .target = .none,
    });
    defer builder.deinit();
    const row = try builder.allocator.alloc(u8, catalog_query_stride);
    @memset(row, 0);
    row[0] = @intFromEnum(query.family);
    if (query.role) |value| { row[1] = 1; row[2] = @intFromEnum(value); }
    const semantic = encodeSemanticKind(query.semantic_kind);
    row[3] = semantic[0];
    row[4] = semantic[1];
    if (query.maximum_width_u) |value| { row[5] = 1; writeInt(types.Unit, row, 12, value); }
    if (query.maximum_height_u) |value| { row[6] = 1; writeInt(types.Unit, row, 16, value); }
    if (query.wall_profile) |value| { row[7] = 1; row[8] = @intFromEnum(value); }
    if (query.wall_thickness_u) |value| { row[9] = 1; writeInt(types.Unit, row, 20, value); }
    try builder.addSection(.catalog_query, 1, catalog_query_stride, row);
    const tag_count = query.required_theme_tags.len + query.required_gameplay_tags.len;
    const tag_bytes = try builder.allocator.alloc(u8, tag_count * catalog_tag_stride);
    @memset(tag_bytes, 0);
    var next: usize = 0;
    try appendCatalogStringRows(&builder, tag_bytes, &next, 0, .theme, query.required_theme_tags);
    try appendCatalogStringRows(&builder, tag_bytes, &next, 0, .gameplay, query.required_gameplay_tags);
    try builder.addSection(.catalog_tags, tag_count, catalog_tag_stride, tag_bytes);
    var packet = try builder.finish();
    defer packet.deinit(allocator);
    return packetBytes(allocator, &packet);
}

pub const OwnedCatalogQuery = struct {
    value: catalog.CatalogQuery,
    theme_tags: [][]u8,
    gameplay_tags: [][]u8,

    pub fn deinit(self: *OwnedCatalogQuery, allocator: std.mem.Allocator) void {
        freeOwnedStringList(allocator, self.theme_tags);
        freeOwnedStringList(allocator, self.gameplay_tags);
        self.* = undefined;
    }
};

pub fn decodeCatalogQuery(allocator: std.mem.Allocator, packet: *const Packet) WireError!OwnedCatalogQuery {
    const section = try requireSection(packet, .catalog_query, 1, catalog_query_stride);
    const row = section.bytes[0..catalog_query_stride];
    const tags = try optionalFixedSection(packet, .catalog_tags, catalog_tag_stride);
    var theme_count: usize = 0;
    var gameplay_count: usize = 0;
    if (tags) |tag_section| for (0..tag_section.item_count) |index| {
        const tag_row = tag_section.bytes[index * catalog_tag_stride ..][0..catalog_tag_stride];
        if (readInt(u32, tag_row, 0) != 0) return error.semantic_decode_failed;
        switch (std.enums.fromInt(CatalogTagKind, readInt(u16, tag_row, 4)) orelse return error.semantic_decode_failed) {
            .theme => theme_count += 1,
            .gameplay => gameplay_count += 1,
            else => return error.semantic_decode_failed,
        }
        _ = try readStringReference(packet, tag_row, 8);
    };
    const theme_tags = try allocator.alloc([]u8, theme_count);
    var initialized_theme: usize = 0;
    errdefer {
        for (theme_tags[0..initialized_theme]) |value| freeSlice(u8, allocator, value);
        freeSlice([]u8, allocator, theme_tags);
    }
    const gameplay_tags = try allocator.alloc([]u8, gameplay_count);
    var initialized_gameplay: usize = 0;
    errdefer {
        for (gameplay_tags[0..initialized_gameplay]) |value| freeSlice(u8, allocator, value);
        freeSlice([]u8, allocator, gameplay_tags);
    }
    if (tags) |tag_section| for (0..tag_section.item_count) |index| {
        const tag_row = tag_section.bytes[index * catalog_tag_stride ..][0..catalog_tag_stride];
        switch (std.enums.fromInt(CatalogTagKind, readInt(u16, tag_row, 4)).?) {
            .theme => { theme_tags[initialized_theme] = try ownedStringReference(allocator, packet, tag_row, 8); initialized_theme += 1; },
            .gameplay => { gameplay_tags[initialized_gameplay] = try ownedStringReference(allocator, packet, tag_row, 8); initialized_gameplay += 1; },
            else => unreachable,
        }
    };
    return .{
        .value = .{
            .family = std.enums.fromInt(types.ArchitectureFamily, row[0]) orelse return error.semantic_decode_failed,
            .role = if (row[1] == 1) std.enums.fromInt(types.ArchitectureKitRole, row[2]) orelse return error.semantic_decode_failed else if (row[1] == 0) null else return error.semantic_decode_failed,
            .semantic_kind = try decodeSemanticKind(row[3], row[4]),
            .required_theme_tags = theme_tags,
            .required_gameplay_tags = gameplay_tags,
            .maximum_width_u = if (row[5] == 1) readInt(types.Unit, row, 12) else if (row[5] == 0) null else return error.semantic_decode_failed,
            .maximum_height_u = if (row[6] == 1) readInt(types.Unit, row, 16) else if (row[6] == 0) null else return error.semantic_decode_failed,
            .wall_profile = if (row[7] == 1) std.enums.fromInt(types.WallProfile, row[8]) orelse return error.semantic_decode_failed else if (row[7] == 0) null else return error.semantic_decode_failed,
            .wall_thickness_u = if (row[9] == 1) readInt(types.Unit, row, 20) else if (row[9] == 0) null else return error.semantic_decode_failed,
        },
        .theme_tags = theme_tags,
        .gameplay_tags = gameplay_tags,
    };
}

fn freeOwnedStringList(allocator: std.mem.Allocator, values: [][]u8) void {
    for (values) |value| freeSlice(u8, allocator, value);
    freeSlice([]u8, allocator, values);
}

pub const OwnedCommand = struct {
    command: architecture.ArchitectureCommand,
    command_id: []u8,
    strings: [6][]u8,
    binary: []u8 = &.{},
    patch: ?*types.ArchitecturePatch = null,

    pub fn deinit(self: *OwnedCommand, allocator: std.mem.Allocator) void {
        freeSlice(u8, allocator, self.command_id);
        for (self.strings) |value| freeSlice(u8, allocator, value);
        freeSlice(u8, allocator, self.binary);
        if (self.patch) |value| {
            value.deinit(allocator);
            allocator.destroy(value);
        }
        self.* = undefined;
    }
};

pub fn encodeMutationRequest(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    command: architecture.ArchitectureCommand,
) WireError![]u8 {
    var builder = PacketBuilder.init(allocator, .{
        .kind = .mutate_request,
        .source_revision = source.revision,
        .family = .wall,
        .target = .none,
    });
    defer builder.deinit();
    try appendSourceSections(&builder, source);
    try appendCommandSection(&builder, command);
    var packet = try builder.finish();
    defer packet.deinit(allocator);
    return packetBytes(allocator, &packet);
}

fn appendCommandSection(builder: *PacketBuilder, command: architecture.ArchitectureCommand) WireError!void {
    const row = try builder.allocator.alloc(u8, command_stride);
    @memset(row, 0);
    writeInt(u32, row, 4, command.expected_revision);
    putStringReference(row, 8, try builder.strings.add(command.command_id));
    switch (command.operation) {
        .draw_wall => |value| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.draw_wall));
            if (value.start_magnet_vertex_id) |id| putStringReference(row, 16, try builder.strings.add(id));
            if (value.end_magnet_vertex_id) |id| putStringReference(row, 24, try builder.strings.add(id));
            switch (value.support) {
                .absolute => |support| { writeInt(u32, row, 128, 0); writeFloat(f64, row, 96, support.base_y_u); },
                .slab => |support| {
                    writeInt(u32, row, 128, 1);
                    writeInt(u32, row, 132, @intFromEnum(support.join));
                    putStringReference(row, 32, try builder.strings.add(support.slab_id));
                },
            }
            putStringReference(row, 40, try builder.strings.add(value.style_id));
            putStringReference(row, 48, try builder.strings.add(value.side_a_material_id));
            putStringReference(row, 56, try builder.strings.add(value.side_b_material_id));
            writeFloat(f64, row, 64, value.start.x_u);
            writeFloat(f64, row, 72, value.start.z_u);
            writeFloat(f64, row, 80, value.end.x_u);
            writeFloat(f64, row, 88, value.end.z_u);
            writeFloat(f64, row, 104, value.height_u);
            writeFloat(f64, row, 112, value.thickness_u);
            writeInt(u32, row, 136, @intFromEnum(value.profile));
            writeInt(i32, row, 140, value.floor);
        },
        .delete_edge => |value| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.delete_edge));
            putStringReference(row, 16, try builder.strings.add(value.edge_id));
        },
        .delete_vertex => |value| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.delete_vertex));
            putStringReference(row, 16, try builder.strings.add(value.vertex_id));
        },
        .set_edge_dimensions => |value| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.set_edge_dimensions));
            putStringReference(row, 16, try builder.strings.add(value.edge_id));
            switch (value.support) {
                .absolute => |support| { writeInt(u32, row, 128, 0); writeFloat(f64, row, 64, support.base_y_u); },
                .slab => |support| {
                    writeInt(u32, row, 128, 1);
                    writeInt(u32, row, 132, @intFromEnum(support.join));
                    putStringReference(row, 24, try builder.strings.add(support.slab_id));
                },
            }
            writeFloat(f64, row, 72, value.height_u);
            writeFloat(f64, row, 80, value.thickness_u);
        },
        .set_profile => |value| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.set_profile));
            putStringReference(row, 16, try builder.strings.add(value.edge_id));
            writeInt(u32, row, 128, @intFromEnum(value.profile));
        },
        .set_style => |value| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.set_style));
            putStringReference(row, 16, try builder.strings.add(value.edge_id));
            putStringReference(row, 24, try builder.strings.add(value.style_id));
        },
        .set_side_finish => |value| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.set_side_finish));
            putStringReference(row, 16, try builder.strings.add(value.edge_id));
            putStringReference(row, 24, try builder.strings.add(value.material_id));
            writeInt(u32, row, 128, @intFromEnum(value.side));
        },
        .insert_opening => |value| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.insert_opening));
            putStringReference(row, 16, try builder.strings.add(value.edge_id));
            try encodeConfigureOpening(builder, row, 24, value.opening);
        },
        .move_opening => |value| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.move_opening));
            putStringReference(row, 16, try builder.strings.add(value.opening_id));
            writeFloat(f64, row, 64, value.column_u);
            writeFloat(f64, row, 72, value.row_u);
        },
        .delete_opening => |value| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.delete_opening));
            putStringReference(row, 16, try builder.strings.add(value.opening_id));
        },
        .configure_opening => |value| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.configure_opening));
            try encodeConfigureOpening(builder, row, 16, value);
        },
        .attach_anchor => |value| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.attach_anchor));
            putStringReference(row, 16, try builder.strings.add(value.edge_id));
            putStringReference(row, 24, try builder.strings.add(value.target_piece_id));
            writeFloat(f64, row, 64, value.column_u);
            writeFloat(f64, row, 72, value.row_u);
            writeInt(u32, row, 128, @intFromEnum(value.side));
        },
        .detach_anchor => |value| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.detach_anchor));
            putStringReference(row, 16, try builder.strings.add(value.anchor_id));
        },
        .stamp_prefab => |value| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.stamp_prefab));
            const bytes = try builder.allocator.dupe(u8, value.canonical_prefab_bytes);
            try builder.addSection(.patch_operations, 1, 0, bytes);
        },
        .apply_patch => |patch| {
            writeInt(u16, row, 0, @intFromEnum(CommandTag.apply_patch));
            try appendPatchSection(builder, patch);
        },
    }
    try builder.addSection(.command, 1, command_stride, row);
}

fn encodeConfigureOpening(
    builder: *PacketBuilder,
    row: []u8,
    first_string_offset: usize,
    value: anytype,
) WireError!void {
    putStringReference(row, first_string_offset, try builder.strings.add(value.opening_id));
    putStringReference(row, first_string_offset + 8, try builder.strings.add(value.kit_id));
    writeFloat(f64, row, 64, value.column_u);
    writeFloat(f64, row, 72, value.row_u);
    writeInt(u32, row, 128, @intFromEnum(value.kind));
    writeInt(u32, row, 132, @intFromEnum(value.facing_side));
    writeInt(u32, row, 136, @intFromEnum(value.hinge));
}

fn appendPatchSection(builder: *PacketBuilder, patch: *const types.ArchitecturePatch) WireError!void {
    const row_bytes = std.math.mul(usize, patch.operations.len, 32) catch return error.count_limit;
    var bytes: std.ArrayList(u8) = .empty;
    defer bytes.deinit(builder.allocator);
    try bytes.resize(builder.allocator, 16 + row_bytes);
    @memset(bytes.items, 0);
    writeInt(u32, bytes.items, 0, 1);
    writeInt(u32, bytes.items, 4, patch.expected_revision);
    writeInt(u32, bytes.items, 8, patch.result_revision);
    writeInt(u32, bytes.items, 12, @intCast(patch.operations.len));
    for (patch.operations, 0..) |operation, index| {
        const row_offset = 16 + index * 32;
        var row = bytes.items[row_offset..][0..32];
        const snapshot = switch (operation) {
            .insert => |value| blk: {
                row[0] = @intFromEnum(types.PatchOperationKind.insert);
                break :blk .{ value.family, value.id, @as([]const u8, ""), @as([]const u8, value.canonical_bytes) };
            },
            .replace => |value| blk: {
                row[0] = @intFromEnum(types.PatchOperationKind.replace);
                break :blk .{ value.family, value.id, @as([]const u8, value.before_canonical_bytes), @as([]const u8, value.after_canonical_bytes) };
            },
            .remove => |value| blk: {
                row[0] = @intFromEnum(types.PatchOperationKind.remove);
                break :blk .{ value.family, value.id, @as([]const u8, value.canonical_bytes), @as([]const u8, "") };
            },
        };
        row[1] = @intFromEnum(snapshot[0]);
        putStringReference(row, 4, try builder.strings.add(snapshot[1]));
        if (snapshot[2].len != 0) {
            writeInt(u32, row, 12, @intCast(bytes.items.len));
            writeInt(u32, row, 16, @intCast(snapshot[2].len));
            try bytes.appendSlice(builder.allocator, snapshot[2]);
            row = bytes.items[row_offset..][0..32];
        }
        if (snapshot[3].len != 0) {
            writeInt(u32, row, 20, @intCast(bytes.items.len));
            writeInt(u32, row, 24, @intCast(snapshot[3].len));
            try bytes.appendSlice(builder.allocator, snapshot[3]);
        }
    }
    try builder.addSection(.patch_operations, patch.operations.len, 0, try bytes.toOwnedSlice(builder.allocator));
}

pub fn decodeCommand(allocator: std.mem.Allocator, packet: *const Packet) WireError!OwnedCommand {
    const section = try requireSection(packet, .command, 1, command_stride);
    const row = section.bytes[0..command_stride];
    const tag = std.enums.fromInt(CommandTag, readInt(u16, row, 0)) orelse return error.semantic_decode_failed;
    const command_id = try ownedStringReference(allocator, packet, row, 8);
    errdefer freeSlice(u8, allocator, command_id);
    var strings: [6][]u8 = undefined;
    var initialized_strings: usize = 0;
    errdefer for (strings[0..initialized_strings]) |value| freeSlice(u8, allocator, value);
    for (0..strings.len) |index| {
        strings[index] = try ownedStringReference(allocator, packet, row, 16 + index * 8);
        initialized_strings += 1;
    }
    var binary: []u8 = &.{};
    errdefer freeSlice(u8, allocator, binary);
    var patch: ?*types.ArchitecturePatch = null;
    errdefer if (patch) |value| {
        value.deinit(allocator);
        allocator.destroy(value);
    };
    const operation: architecture.ArchitectureOperation = switch (tag) {
        .draw_wall => .{ .draw_wall = .{
            .floor = readInt(i32, row, 140),
            .start = .{ .x_u = readFloat(f64, row, 64), .z_u = readFloat(f64, row, 72) },
            .end = .{ .x_u = readFloat(f64, row, 80), .z_u = readFloat(f64, row, 88) },
            .start_magnet_vertex_id = if (strings[0].len == 0) null else strings[0],
            .end_magnet_vertex_id = if (strings[1].len == 0) null else strings[1],
            .support = try decodeCommandSupport(row, strings[2], 96),
            .height_u = readFloat(f64, row, 104),
            .thickness_u = readFloat(f64, row, 112),
            .profile = enumFromU32(types.WallProfile, row, 136) orelse return error.semantic_decode_failed,
            .style_id = strings[3],
            .side_a_material_id = strings[4],
            .side_b_material_id = strings[5],
        } },
        .delete_edge => .{ .delete_edge = .{ .edge_id = strings[0] } },
        .delete_vertex => .{ .delete_vertex = .{ .vertex_id = strings[0] } },
        .set_edge_dimensions => .{ .set_edge_dimensions = .{
            .edge_id = strings[0],
            .support = try decodeCommandSupport(row, strings[1], 64),
            .height_u = readFloat(f64, row, 72),
            .thickness_u = readFloat(f64, row, 80),
        } },
        .set_profile => .{ .set_profile = .{
            .edge_id = strings[0],
            .profile = enumFromU32(types.WallProfile, row, 128) orelse return error.semantic_decode_failed,
        } },
        .set_style => .{ .set_style = .{ .edge_id = strings[0], .style_id = strings[1] } },
        .set_side_finish => .{ .set_side_finish = .{
            .edge_id = strings[0],
            .side = enumFromU32(types.WallSide, row, 128) orelse return error.semantic_decode_failed,
            .material_id = strings[1],
        } },
        .insert_opening => .{ .insert_opening = .{
            .edge_id = strings[0],
            .opening = try decodeConfigureOpening(row, strings[1], strings[2]),
        } },
        .move_opening => .{ .move_opening = .{
            .opening_id = strings[0],
            .column_u = readFloat(f64, row, 64),
            .row_u = readFloat(f64, row, 72),
        } },
        .delete_opening => .{ .delete_opening = .{ .opening_id = strings[0] } },
        .configure_opening => .{ .configure_opening = try decodeConfigureOpening(row, strings[0], strings[1]) },
        .attach_anchor => .{ .attach_anchor = .{
            .edge_id = strings[0],
            .side = enumFromU32(types.WallSide, row, 128) orelse return error.semantic_decode_failed,
            .column_u = readFloat(f64, row, 64),
            .row_u = readFloat(f64, row, 72),
            .target_piece_id = strings[1],
        } },
        .detach_anchor => .{ .detach_anchor = .{ .anchor_id = strings[0] } },
        .stamp_prefab => prefab: {
            const payload = packet.findSection(.patch_operations) orelse return error.missing_required_section;
            binary = try allocator.dupe(u8, payload.bytes);
            break :prefab .{ .stamp_prefab = .{ .canonical_prefab_bytes = binary } };
        },
        .apply_patch => apply: {
            patch = try decodePatchSection(allocator, packet);
            break :apply .{ .apply_patch = patch.? };
        },
    };
    return .{
        .command = .{ .command_id = command_id, .expected_revision = readInt(u32, row, 4), .operation = operation },
        .command_id = command_id,
        .strings = strings,
        .binary = binary,
        .patch = patch,
    };
}

fn decodeCommandSupport(
    row: []const u8,
    slab_id: []const u8,
    base_offset: usize,
) WireError!architecture.ArchitectureCommandSupport {
    return switch (readInt(u32, row, 128)) {
        0 => .{ .absolute = .{ .base_y_u = readFloat(f64, row, base_offset) } },
        1 => .{ .slab = .{
            .slab_id = slab_id,
            .join = enumFromU32(types.SlabJoin, row, 132) orelse return error.semantic_decode_failed,
        } },
        else => error.semantic_decode_failed,
    };
}

fn decodeConfigureOpening(
    row: []const u8,
    opening_id: []const u8,
    kit_id: []const u8,
) WireError!architecture.ArchitectureConfigureOpening {
    return .{
        .opening_id = opening_id,
        .kind = enumFromU32(types.WallOpeningKind, row, 128) orelse return error.semantic_decode_failed,
        .kit_id = kit_id,
        .column_u = readFloat(f64, row, 64),
        .row_u = readFloat(f64, row, 72),
        .facing_side = enumFromU32(types.WallSide, row, 132) orelse return error.semantic_decode_failed,
        .hinge = enumFromU32(types.WallHinge, row, 136) orelse return error.semantic_decode_failed,
    };
}

fn enumFromU32(comptime T: type, row: []const u8, offset: usize) ?T {
    const raw = readInt(u32, row, offset);
    if (raw > std.math.maxInt(std.meta.Tag(T))) return null;
    return std.enums.fromInt(T, @as(std.meta.Tag(T), @intCast(raw)));
}

fn decodePatchSection(allocator: std.mem.Allocator, packet: *const Packet) WireError!*types.ArchitecturePatch {
    const section = packet.findSection(.patch_operations) orelse return error.missing_required_section;
    const bytes = section.bytes;
    if (bytes.len < 16 or readInt(u32, bytes, 0) != 1) return error.invalid_section_shape;
    const operation_count = readInt(u32, bytes, 12);
    if (operation_count > types.Limits.maximum_patch_operations or section.item_count != operation_count) return error.count_limit;
    const rows_bytes = std.math.mul(usize, operation_count, 32) catch return error.count_limit;
    const rows_end = std.math.add(usize, 16, rows_bytes) catch return error.count_limit;
    if (rows_end > bytes.len) return error.invalid_section_shape;
    const patch = try allocator.create(types.ArchitecturePatch);
    errdefer allocator.destroy(patch);
    const operations = try allocator.alloc(types.PatchOperation, operation_count);
    var initialized: usize = 0;
    errdefer {
        for (operations[0..initialized]) |*operation| operation.deinit(allocator);
        freeSlice(types.PatchOperation, allocator, operations);
    }
    while (initialized < operations.len) : (initialized += 1) {
        const row = bytes[16 + initialized * 32 ..][0..32];
        const kind = std.enums.fromInt(types.PatchOperationKind, row[0]) orelse return error.semantic_decode_failed;
        const family = std.enums.fromInt(types.RecordFamily, row[1]) orelse return error.semantic_decode_failed;
        const id = try ownedStringReference(allocator, packet, row, 4);
        errdefer freeSlice(u8, allocator, id);
        const before_source = try patchBlob(bytes, row, 12, rows_end);
        const after_source = try patchBlob(bytes, row, 20, rows_end);
        operations[initialized] = switch (kind) {
            .insert => insert: {
                if (before_source.len != 0 or after_source.len == 0) return error.semantic_decode_failed;
                const canonical = try allocator.dupe(u8, after_source);
                break :insert .{ .insert = .{ .family = family, .id = id, .canonical_bytes = canonical } };
            },
            .replace => replace: {
                if (before_source.len == 0 or after_source.len == 0) return error.semantic_decode_failed;
                const before = try allocator.dupe(u8, before_source);
                errdefer freeSlice(u8, allocator, before);
                const after = try allocator.dupe(u8, after_source);
                break :replace .{ .replace = .{
                    .family = family,
                    .id = id,
                    .before_canonical_bytes = before,
                    .after_canonical_bytes = after,
                } };
            },
            .remove => remove: {
                if (before_source.len == 0 or after_source.len != 0) return error.semantic_decode_failed;
                const canonical = try allocator.dupe(u8, before_source);
                break :remove .{ .remove = .{ .family = family, .id = id, .canonical_bytes = canonical } };
            },
        };
    }
    patch.* = .{
        .expected_revision = readInt(u32, bytes, 4),
        .result_revision = readInt(u32, bytes, 8),
        .operations = operations,
    };
    return patch;
}

fn patchBlob(bytes: []const u8, row: []const u8, offset: usize, minimum_offset: usize) WireError![]const u8 {
    const byte_offset = readInt(u32, row, offset);
    const byte_length = readInt(u32, row, offset + 4);
    if (byte_length == 0) {
        if (byte_offset != 0) return error.semantic_decode_failed;
        return "";
    }
    const end = std.math.add(u32, byte_offset, byte_length) catch return error.count_limit;
    if (byte_offset < minimum_offset or end > bytes.len) return error.semantic_decode_failed;
    return bytes[byte_offset..end];
}

fn encodeEmptyResult(
    allocator: std.mem.Allocator,
    kind: PacketKind,
    family: FamilyTag,
    source_revision: u32,
) WireError![]u8 {
    var packet = Packet{
        .header = .{ .kind = kind, .source_revision = source_revision, .family = family, .target = .none },
        .sections = &.{},
        .string_table = &.{},
    };
    return encode(allocator, &packet);
}

fn encodeRejection(
    allocator: std.mem.Allocator,
    kind: PacketKind,
    family: FamilyTag,
    source_revision: u32,
    code: RejectionCode,
    stage: u16,
    expected_revision: u32,
    actual_revision: u32,
    detail: []const u8,
) WireError![]u8 {
    var builder = PacketBuilder.init(allocator, .{
        .kind = kind,
        .source_revision = source_revision,
        .family = family,
        .target = .none,
    });
    defer builder.deinit();
    const row = try allocator.alloc(u8, 32);
    @memset(row, 0);
    writeInt(u16, row, 0, @intFromEnum(code));
    writeInt(u16, row, 2, stage);
    writeInt(u32, row, 12, expected_revision);
    writeInt(u32, row, 16, actual_revision);
    putStringReference(row, 20, try builder.strings.add(detail));
    try builder.addSection(.rejection, 1, 32, row);
    var packet = try builder.finish();
    defer packet.deinit(allocator);
    return encode(allocator, &packet);
}

fn encodeCatalogQueryResult(
    allocator: std.mem.Allocator,
    indices: []const usize,
) WireError![]u8 {
    var builder = PacketBuilder.init(allocator, .{
        .kind = .catalog_query_result,
        .source_revision = 0,
        .family = .none,
        .target = .none,
    });
    defer builder.deinit();
    const bytes = try allocator.alloc(u8, indices.len * @sizeOf(u32));
    for (indices, 0..) |value, index| writeInt(u32, bytes, index * 4, @intCast(value));
    try builder.addSection(.catalog_query, indices.len, 4, bytes);
    var packet = try builder.finish();
    defer packet.deinit(allocator);
    return encode(allocator, &packet);
}

fn decodeRay(packet: *const Packet) WireError!architecture.RaycastRequest {
    const section = try requireSection(packet, .ray, 1, ray_stride);
    const row = section.bytes[0..ray_stride];
    return .{
        .origin_meters = .{ readFloat(f64, row, 0), readFloat(f64, row, 8), readFloat(f64, row, 16) },
        .direction = .{ readFloat(f64, row, 24), readFloat(f64, row, 32), readFloat(f64, row, 40) },
        .maximum_distance_meters = readFloat(f64, row, 48),
    };
}

fn encodeRayResult(
    allocator: std.mem.Allocator,
    source_revision: u32,
    result: *const architecture.RaycastResult,
) WireError![]u8 {
    var builder = PacketBuilder.init(allocator, .{
        .kind = .raycast_result,
        .source_revision = source_revision,
        .family = .wall,
        .target = .none,
    });
    defer builder.deinit();
    const row = try allocator.alloc(u8, ray_hit_stride);
    @memset(row, 0);
    if (result.hit) |hit| {
        row[0] = 1;
        row[1] = @intFromEnum(hit.kind);
        row[2] = @intFromEnum(hit.side);
        writeInt(types.Unit, row, 4, hit.column_u);
        writeInt(types.Unit, row, 8, hit.row_u);
        putStringReference(row, 12, try builder.strings.add(hit.edge_id));
        if (hit.opening_id) |id| putStringReference(row, 20, try builder.strings.add(id));
        writeFloat(f64, row, 32, hit.distance_meters);
        for (hit.point_meters, 0..) |value, index| writeFloat(f64, row, 40 + index * 8, value);
        for (hit.normal, 0..) |value, index| writeFloat(f64, row, 64 + index * 8, value);
    }
    try builder.addSection(.ray_hit, 1, ray_hit_stride, row);
    var packet = try builder.finish();
    defer packet.deinit(allocator);
    return encode(allocator, &packet);
}

const OpeningSlotsRequestRow = struct {
    edge_id: []const u8,
    catalog_id: []const u8,
};

fn decodeOpeningSlotsRequest(packet: *const Packet) WireError!OpeningSlotsRequestRow {
    const section = try requireSection(packet, .opening_slots, 1, 16);
    const row = section.bytes[0..16];
    return .{
        .edge_id = try readStringReference(packet, row, 0),
        .catalog_id = try readStringReference(packet, row, 8),
    };
}

fn encodeOpeningSlotsResult(
    allocator: std.mem.Allocator,
    source_revision: u32,
    slots: *const architecture.OpeningSlots,
) WireError![]u8 {
    var builder = PacketBuilder.init(allocator, .{
        .kind = .opening_slots_result,
        .source_revision = source_revision,
        .family = .wall,
        .target = .none,
    });
    defer builder.deinit();
    const rows = try allocator.alloc(u8, slots.values.len * opening_slot_stride);
    for (slots.values, 0..) |slot, index| {
        const row = rows[index * opening_slot_stride ..][0..opening_slot_stride];
        writeInt(types.Unit, row, 0, slot.column_u);
        writeInt(types.Unit, row, 4, slot.row_u);
    }
    try builder.addSection(.opening_slots, slots.values.len, opening_slot_stride, rows);
    var packet = try builder.finish();
    defer packet.deinit(allocator);
    return encode(allocator, &packet);
}

const OwnedCompileRequest = struct {
    bounds: []types.AffectedBounds,
    targets: []types.DirtyTarget,

    fn deinit(self: *OwnedCompileRequest, allocator: std.mem.Allocator) void {
        freeSlice(types.AffectedBounds, allocator, self.bounds);
        freeSlice(types.DirtyTarget, allocator, self.targets);
        self.* = undefined;
    }
};

fn decodeCompileRequest(allocator: std.mem.Allocator, packet: *const Packet) WireError!OwnedCompileRequest {
    const bounds_section = try optionalFixedSection(packet, .affected_bounds, affected_bounds_stride);
    const target_section = try optionalFixedSection(packet, .dirty_targets, dirty_target_stride);
    const bounds = try allocator.alloc(types.AffectedBounds, if (bounds_section) |value| value.item_count else 0);
    errdefer freeSlice(types.AffectedBounds, allocator, bounds);
    if (bounds_section) |section| for (0..section.item_count) |index| {
        const row = section.bytes[index * affected_bounds_stride ..][0..affected_bounds_stride];
        bounds[index] = .{
            .floor = readInt(i32, row, 0),
            .min_x_u = readInt(types.Unit, row, 4),
            .min_y_u = readInt(types.Unit, row, 8),
            .min_z_u = readInt(types.Unit, row, 12),
            .max_x_u_exclusive = readInt(types.Unit, row, 16),
            .max_y_u_exclusive = readInt(types.Unit, row, 20),
            .max_z_u_exclusive = readInt(types.Unit, row, 24),
        };
    };
    const targets = try allocator.alloc(types.DirtyTarget, if (target_section) |value| value.item_count else 0);
    errdefer freeSlice(types.DirtyTarget, allocator, targets);
    if (target_section) |section| for (0..section.item_count) |index| {
        const row = section.bytes[index * dirty_target_stride ..][0..dirty_target_stride];
        targets[index] = std.enums.fromInt(types.DirtyTarget, row[0]) orelse return error.semantic_decode_failed;
        if (row[1] != 0 or row[2] != 0 or row[3] != 0) return error.nonzero_reserved;
    };
    return .{ .bounds = bounds, .targets = targets };
}

fn encodeCompileResult(
    allocator: std.mem.Allocator,
    bundle: *const architecture.ArchitectureCompileBundle,
) WireError![]u8 {
    var builder = PacketBuilder.init(allocator, .{
        .kind = .compile_result,
        .source_revision = bundle.source_revision,
        .family = .wall,
        .target = .none,
    });
    defer builder.deinit();
    const bytes = try allocator.dupe(u8, bundle.canonical_bytes);
    try builder.addSection(.render_bands, 1, 0, bytes);
    var packet = try builder.finish();
    defer packet.deinit(allocator);
    return encode(allocator, &packet);
}

fn encodeScaleMetadataResult(allocator: std.mem.Allocator) WireError![]u8 {
    var builder = PacketBuilder.init(allocator, .{
        .kind = .scale_metadata_result,
        .source_revision = 0,
        .family = .none,
        .target = .none,
    });
    defer builder.deinit();
    const row = try allocator.alloc(u8, scale_metadata_stride);
    @memset(row, 0);
    writeInt(i32, row, 0, architecture.units_per_meter);
    writeInt(i32, row, 4, architecture.units_per_meter);
    writeInt(i32, row, 8, architecture.units_per_meter);
    writeInt(i32, row, 12, architecture.units_per_meter);
    writeFloat(f64, row, 16, 1.0);
    writeInt(u16, row, 24, architecture.source_version);
    writeInt(u16, row, 26, packet_version);
    try builder.addSection(.scale_metadata, 1, scale_metadata_stride, row);
    var packet = try builder.finish();
    defer packet.deinit(allocator);
    return encode(allocator, &packet);
}

fn encodeMutationSuccess(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    receipt: *const types.MutationReceipt,
) WireError![]u8 {
    var builder = PacketBuilder.init(allocator, .{
        .kind = .mutate_result,
        .source_revision = source.revision,
        .family = .wall,
        .target = .none,
    });
    defer builder.deinit();
    try appendSourceSections(&builder, source);
    const receipt_row = try allocator.alloc(u8, 40);
    @memset(receipt_row, 0);
    putStringReference(receipt_row, 0, try builder.strings.add(receipt.command_id));
    writeInt(u32, receipt_row, 8, receipt.source_revision_before);
    writeInt(u32, receipt_row, 12, receipt.source_revision_after);
    putStringReference(receipt_row, 16, try builder.strings.add(receipt.source_hash_before));
    putStringReference(receipt_row, 24, try builder.strings.add(receipt.source_hash_after));
    try builder.addSection(.command, 1, 40, receipt_row);
    try appendPatchSection(&builder, &receipt.forward_patch);
    const bounds = try allocator.alloc(u8, receipt.affected_bounds.len * affected_bounds_stride);
    for (receipt.affected_bounds, 0..) |value, index| {
        const row = bounds[index * affected_bounds_stride ..][0..affected_bounds_stride];
        writeInt(i32, row, 0, value.floor);
        writeInt(types.Unit, row, 4, value.min_x_u);
        writeInt(types.Unit, row, 8, value.min_y_u);
        writeInt(types.Unit, row, 12, value.min_z_u);
        writeInt(types.Unit, row, 16, value.max_x_u_exclusive);
        writeInt(types.Unit, row, 20, value.max_y_u_exclusive);
        writeInt(types.Unit, row, 24, value.max_z_u_exclusive);
    }
    try builder.addSection(.affected_bounds, receipt.affected_bounds.len, affected_bounds_stride, bounds);
    const targets = try allocator.alloc(u8, receipt.dirty_targets.len * dirty_target_stride);
    @memset(targets, 0);
    for (receipt.dirty_targets, 0..) |value, index| targets[index * dirty_target_stride] = @intFromEnum(value);
    try builder.addSection(.dirty_targets, receipt.dirty_targets.len, dirty_target_stride, targets);
    var packet = try builder.finish();
    defer packet.deinit(allocator);
    return encode(allocator, &packet);
}

fn mutationRejectionStage(code: types.ArchitectureRejectionCode) u16 {
    return @intFromEnum(code) + 1;
}

pub const Service = struct {
    installed_catalog: ?catalog.Catalog = null,

    pub fn deinit(self: *Service, allocator: std.mem.Allocator) void {
        if (self.installed_catalog) |*value| value.deinit(allocator);
        self.* = undefined;
    }

    pub fn handle(self: *Service, allocator: std.mem.Allocator, request_bytes: []const u8) WireError![]u8 {
        var packet = try decode(allocator, request_bytes);
        defer packet.deinit(allocator);
        return switch (packet.header.kind) {
            .catalog_validate_request => self.catalogValidate(allocator, &packet),
            .catalog_install_request => self.catalogInstall(allocator, &packet),
            .catalog_query_request => self.catalogQuery(allocator, &packet),
            .catalog_readback_request => self.catalogReadback(allocator),
            .source_validate_request => self.sourceValidate(allocator, &packet),
            .mutate_request => self.mutate(allocator, &packet),
            .compile_request => self.compileSource(allocator, &packet),
            .raycast_request => self.raycastSource(allocator, &packet),
            .opening_slots_request => self.openingSlots(allocator, &packet),
            .scale_metadata_request => encodeScaleMetadataResult(allocator),
            else => error.invalid_tag,
        };
    }

    fn entries(self: *const Service) ?[]const catalog.CatalogEntry {
        return if (self.installed_catalog) |value| value.entries else null;
    }

    fn catalogValidate(self: *Service, allocator: std.mem.Allocator, packet: *const Packet) WireError![]u8 {
        _ = self;
        var decoded_catalog = decodeCatalog(allocator, packet) catch |err|
            return encodeRejection(allocator, .catalog_validate_result, .none, 0, .invalid_catalog, 0, 0, 0, @errorName(err));
        defer decoded_catalog.deinit(allocator);
        architecture.validateCatalog(allocator, decoded_catalog.entries) catch |err|
            return encodeRejection(allocator, .catalog_validate_result, .none, 0, .invalid_catalog, 0, 0, 0, @errorName(err));
        return encodeEmptyResult(allocator, .catalog_validate_result, .none, 0);
    }

    fn catalogInstall(self: *Service, allocator: std.mem.Allocator, packet: *const Packet) WireError![]u8 {
        var decoded_catalog = decodeCatalog(allocator, packet) catch |err|
            return encodeRejection(allocator, .catalog_install_result, .none, 0, .invalid_catalog, 0, 0, 0, @errorName(err));
        architecture.validateCatalog(allocator, decoded_catalog.entries) catch |err| {
            decoded_catalog.deinit(allocator);
            return encodeRejection(allocator, .catalog_install_result, .none, 0, .invalid_catalog, 0, 0, 0, @errorName(err));
        };
        if (self.installed_catalog) |*previous| previous.deinit(allocator);
        self.installed_catalog = decoded_catalog;
        return encodeEmptyResult(allocator, .catalog_install_result, .none, 0);
    }

    fn catalogQuery(self: *Service, allocator: std.mem.Allocator, packet: *const Packet) WireError![]u8 {
        const installed_entries = self.entries() orelse return encodeRejection(allocator, .catalog_query_result, .none, 0, .invalid_catalog, 0, 0, 0, "no architecture catalog is installed");
        var query = decodeCatalogQuery(allocator, packet) catch |err|
            return encodeRejection(allocator, .catalog_query_result, .none, 0, .invalid_catalog, 0, 0, 0, @errorName(err));
        defer query.deinit(allocator);
        var result = architecture.queryCatalog(allocator, installed_entries, query.value) catch |err|
            return encodeRejection(allocator, .catalog_query_result, .none, 0, .invalid_catalog, 0, 0, 0, @errorName(err));
        defer result.deinit(allocator);
        return encodeCatalogQueryResult(allocator, result.entry_indices);
    }

    fn catalogReadback(self: *Service, allocator: std.mem.Allocator) WireError![]u8 {
        const installed_entries = self.entries() orelse return encodeRejection(allocator, .catalog_readback_result, .none, 0, .invalid_catalog, 0, 0, 0, "no architecture catalog is installed");
        return encodeCatalogPacket(allocator, .catalog_readback_result, installed_entries);
    }

    fn sourceValidate(self: *Service, allocator: std.mem.Allocator, packet: *const Packet) WireError![]u8 {
        const installed_entries = self.entries() orelse return encodeRejection(allocator, .source_validate_result, .wall, packet.header.source_revision, .invalid_catalog, 0, 0, 0, "no architecture catalog is installed");
        var source = decodeSource(allocator, packet) catch |err|
            return encodeRejection(allocator, .source_validate_result, .wall, packet.header.source_revision, .invalid_source, 0, 0, 0, @errorName(err));
        defer source.deinit(allocator);
        architecture.validateSource(allocator, &source, installed_entries) catch |err|
            return encodeRejection(allocator, .source_validate_result, .wall, source.revision, .invalid_source, 0, 0, source.revision, @errorName(err));
        return encodeEmptyResult(allocator, .source_validate_result, .wall, source.revision);
    }

    fn mutate(self: *Service, allocator: std.mem.Allocator, packet: *const Packet) WireError![]u8 {
        const installed_entries = self.entries() orelse return encodeRejection(allocator, .mutate_result, .wall, packet.header.source_revision, .invalid_catalog, 0, 0, 0, "no architecture catalog is installed");
        var source = decodeSource(allocator, packet) catch |err|
            return encodeRejection(allocator, .mutate_result, .wall, packet.header.source_revision, .invalid_source, 0, 0, 0, @errorName(err));
        defer source.deinit(allocator);
        var command = decodeCommand(allocator, packet) catch |err|
            return encodeRejection(allocator, .mutate_result, .wall, source.revision, .mutation_rejected, 0, 0, source.revision, @errorName(err));
        defer command.deinit(allocator);
        var result = architecture.applyCommand(allocator, &source, installed_entries, command.command) catch |err|
            return encodeRejection(allocator, .mutate_result, .wall, source.revision, .mutation_rejected, 0, command.command.expected_revision, source.revision, @errorName(err));
        defer result.deinit(allocator);
        return switch (result) {
            .receipt => |*receipt| encodeMutationSuccess(allocator, &source, receipt),
            .rejection => |*rejection| encodeRejection(
                allocator,
                .mutate_result,
                .wall,
                source.revision,
                .mutation_rejected,
                mutationRejectionStage(rejection.code),
                rejection.expected_revision,
                rejection.actual_revision,
                rejection.detail,
            ),
        };
    }

    fn compileSource(self: *Service, allocator: std.mem.Allocator, packet: *const Packet) WireError![]u8 {
        const installed_entries = self.entries() orelse return encodeRejection(allocator, .compile_result, .wall, packet.header.source_revision, .invalid_catalog, 0, 0, 0, "no architecture catalog is installed");
        var source = decodeSource(allocator, packet) catch |err|
            return encodeRejection(allocator, .compile_result, .wall, packet.header.source_revision, .invalid_source, 0, 0, 0, @errorName(err));
        defer source.deinit(allocator);
        var request = decodeCompileRequest(allocator, packet) catch |err|
            return encodeRejection(allocator, .compile_result, .wall, source.revision, .compile_rejected, 0, 0, source.revision, @errorName(err));
        defer request.deinit(allocator);
        var bundle = architecture.compile(allocator, &source, installed_entries, .{ .affected_bounds = request.bounds, .targets = request.targets }) catch |err|
            return encodeRejection(allocator, .compile_result, .wall, source.revision, .compile_rejected, 0, 0, source.revision, @errorName(err));
        defer bundle.deinit(allocator);
        return encodeCompileResult(allocator, &bundle);
    }

    fn raycastSource(self: *Service, allocator: std.mem.Allocator, packet: *const Packet) WireError![]u8 {
        const installed_entries = self.entries() orelse return encodeRejection(allocator, .raycast_result, .wall, packet.header.source_revision, .invalid_catalog, 0, 0, 0, "no architecture catalog is installed");
        var source = decodeSource(allocator, packet) catch |err|
            return encodeRejection(allocator, .raycast_result, .wall, packet.header.source_revision, .invalid_source, 0, 0, 0, @errorName(err));
        defer source.deinit(allocator);
        const request = decodeRay(packet) catch |err|
            return encodeRejection(allocator, .raycast_result, .wall, source.revision, .raycast_rejected, 0, 0, source.revision, @errorName(err));
        var result = architecture.raycast(allocator, &source, installed_entries, request) catch |err|
            return encodeRejection(allocator, .raycast_result, .wall, source.revision, .raycast_rejected, 0, 0, source.revision, @errorName(err));
        defer result.deinit(allocator);
        return encodeRayResult(allocator, source.revision, &result);
    }

    fn openingSlots(self: *Service, allocator: std.mem.Allocator, packet: *const Packet) WireError![]u8 {
        const installed_entries = self.entries() orelse return encodeRejection(allocator, .opening_slots_result, .wall, packet.header.source_revision, .invalid_catalog, 0, 0, 0, "no architecture catalog is installed");
        var source = decodeSource(allocator, packet) catch |err|
            return encodeRejection(allocator, .opening_slots_result, .wall, packet.header.source_revision, .invalid_source, 0, 0, 0, @errorName(err));
        defer source.deinit(allocator);
        const request = decodeOpeningSlotsRequest(packet) catch |err|
            return encodeRejection(allocator, .opening_slots_result, .wall, source.revision, .mutation_rejected, 0, 0, source.revision, @errorName(err));
        var result = architecture.openingSlots(allocator, &source, installed_entries, .{ .edge_id = request.edge_id, .catalog_id = request.catalog_id }) catch |err|
            return encodeRejection(allocator, .opening_slots_result, .wall, source.revision, .mutation_rejected, 0, 0, source.revision, @errorName(err));
        defer result.deinit(allocator);
        return encodeOpeningSlotsResult(allocator, source.revision, &result);
    }

};

const RawSection = struct {
    tag: u16,
    version: u16,
    item_count: u32,
    byte_offset: u32,
    byte_length: u32,
    element_stride: u32,
};

fn validateHeaderTags(header: Header) WireError!void {
    const is_scale = header.kind == .scale_metadata_request or header.kind == .scale_metadata_result;
    if (is_scale and (header.family != .none or header.target != .none)) return error.invalid_tag;
    const is_compile = header.kind == .compile_request or header.kind == .compile_result;
    if (!is_compile and header.target != .none) return error.invalid_tag;
    const is_wall_operation = switch (header.kind) {
        .source_validate_request,
        .source_validate_result,
        .mutate_request,
        .mutate_result,
        .compile_request,
        .compile_result,
        .raycast_request,
        .raycast_result,
        .opening_slots_request,
        .opening_slots_result,
        => true,
        else => false,
    };
    if (is_wall_operation and header.family != .wall) return error.invalid_tag;
}

fn validateSectionShape(
    tag: SectionTag,
    version: u16,
    item_count: u32,
    stride: u32,
    byte_length: usize,
) WireError!void {
    if (version != 1) return error.unknown_required_section_version;
    if (item_count > sectionItemLimit(tag)) return error.count_limit;
    if (stride == 0) return;
    const expected = std.math.mul(u64, item_count, stride) catch return error.count_limit;
    if (expected != byte_length) return error.invalid_section_shape;
}

fn sectionItemLimit(tag: SectionTag) u32 {
    return switch (tag) {
        .catalog_entries => Limits.maximum_catalog_entries,
        .vertices => Limits.maximum_vertices,
        .edges => Limits.maximum_edges,
        .openings => Limits.maximum_openings,
        .anchors => Limits.maximum_anchors,
        else => Limits.maximum_output_rows,
    };
}

fn sectionIndexLessThan(sections: []const Section, left: usize, right: usize) bool {
    const left_section = sections[left];
    const right_section = sections[right];
    if (left_section.tag != right_section.tag) return @intFromEnum(left_section.tag) < @intFromEnum(right_section.tag);
    return left_section.version < right_section.version;
}

fn alignForward(value: u32, alignment: u32) WireError!u32 {
    const remainder = value % alignment;
    if (remainder == 0) return value;
    return checkedAddU32(value, alignment - remainder);
}

fn checkedAddU32(left: u32, right: u32) WireError!u32 {
    return std.math.add(u32, left, right) catch error.offset_out_of_range;
}

fn checkedMulU32(left: u32, right: u32) WireError!u32 {
    return std.math.mul(u32, left, right) catch error.offset_out_of_range;
}

fn writeInt(comptime T: type, bytes: []u8, offset: usize, value: T) void {
    std.mem.writeInt(T, bytes[offset..][0..@sizeOf(T)], value, .little);
}

fn readInt(comptime T: type, bytes: []const u8, offset: usize) T {
    return std.mem.readInt(T, bytes[offset..][0..@sizeOf(T)], .little);
}

fn writeFloat(comptime T: type, bytes: []u8, offset: usize, value: T) void {
    const Bits = std.meta.Int(.unsigned, @bitSizeOf(T));
    writeInt(Bits, bytes, offset, @bitCast(value));
}

fn readFloat(comptime T: type, bytes: []const u8, offset: usize) T {
    const Bits = std.meta.Int(.unsigned, @bitSizeOf(T));
    return @bitCast(readInt(Bits, bytes, offset));
}

fn allZero(bytes: []const u8) bool {
    for (bytes) |byte| if (byte != 0) return false;
    return true;
}

fn freeSlice(comptime T: type, allocator: std.mem.Allocator, values: []T) void {
    if (values.len != 0) allocator.free(values);
}
