//! Stable process-local ABI shared by the cold dev host and replaceable native modules.
//!
//! The ABI deliberately contains only extern-layout scalars, opaque pointers, and C
//! callbacks. Zig implementation types never cross a dynamic-library boundary.

const std = @import("std");

pub const ABI_VERSION: u32 = 13;
pub const SNAPSHOT_ENVELOPE_VERSION: u32 = 1;
pub const BUILD_HASH_BYTES: usize = 32;
pub const MAX_SNAPSHOT_BYTES: usize = 512 * 1024 * 1024;

pub const ModuleKind = enum(u32) {
    scene3d = 1,
    game = 2,
};

pub const ModuleStatus = enum(u32) {
    ok = 0,
    rejected = 1,
    restart_required = 2,
};

pub const ReloadResult = enum(u32) {
    candidate_rejected = 0,
    restart_required = 1,
    committed = 2,
};

pub const InputResult = enum(u32) {
    unconsumed = 0,
    consumed = 1,
};

/// The cold host classifies the game-file path before crossing into the Game
/// library. Zig error-set identities are compilation-image local, so a module
/// must never infer "missing" from an I/O error created by another image.
const game_source = @import("game_source.zig");
pub const GameSourceStatus = game_source.Status;
pub const classifyGameSource = game_source.classify;

pub const ModuleHeaderV1 = extern struct {
    abi_version: u32 = ABI_VERSION,
    struct_size: u32,
    module_kind: ModuleKind,
    flags: u32 = 0,
    build_hash: [BUILD_HASH_BYTES]u8,
    abi_hash: [BUILD_HASH_BYTES]u8,
    dependency_hash: [BUILD_HASH_BYTES]u8,
};

pub const SnapshotEnvelopeV1 = extern struct {
    envelope_version: u32 = SNAPSHOT_ENVELOPE_VERSION,
    module_kind: ModuleKind,
    schema_version: u32,
    reserved: u32 = 0,
    payload_len: u64,
    checksum: u64,
};

pub const SnapshotSinkV1 = extern struct {
    context: ?*anyopaque,
    write: *const fn (context: ?*anyopaque, bytes: [*]const u8, len: usize) callconv(.c) bool,

    pub fn append(self: *const SnapshotSinkV1, bytes: []const u8) bool {
        return self.write(self.context, bytes.ptr, bytes.len);
    }
};

pub const SceneCallCodeV1 = enum(u32) {
    ok = 0,
    invalid_request = 1,
    wrong_model = 2,
    no_resident_session = 3,
    object_ids_unpublished = 4,
    stale_generation = 5,
    released_capability = 6,
    lease_refused = 7,
    module_unavailable = 8,
    internal_error = 9,
    analysis_pending = 10,
};

pub const SceneCallStatusV1 = extern struct {
    code: SceneCallCodeV1 = .internal_error,
    flags: u32 = 0,
    current_generation: u64 = 0,
    receipt_id: u64 = 0,
};

pub const SceneJsonCallV1 = *const fn (
    request: [*]const u8,
    request_len: usize,
    sink: *const SnapshotSinkV1,
    status: *SceneCallStatusV1,
) callconv(.c) bool;

pub const SceneBytesJsonCallV1 = *const fn (
    request: [*]const u8,
    request_len: usize,
    bytes: [*]const u8,
    bytes_len: usize,
    sink: *const SnapshotSinkV1,
    status: *SceneCallStatusV1,
) callconv(.c) bool;

pub const RecoveryDegradationChannelV1 = enum(u32) {
    none = 0,
    object_ids = 1,
    range_membership = 2,
    face_groups = 3,
    materials = 4,
    semantic_membership = 5,
    semantic_table = 6,
    logical_topology = 7,
};

pub const RecoveryDegradationSlotV1 = extern struct {
    channel: RecoveryDegradationChannelV1 = .none,
    action_bits: u32 = 0,
    reason_bits: u64 = 0,
    affected_count: u64 = 0,
};

pub const RecoverySnapshotMetaV1 = extern struct {
    schema_version: u32 = 1,
    rjmd_version: u32 = 0,
    generation: u64 = 0,
    byte_len: u64 = 0,
    triangle_count: u64 = 0,
    authored_face_count: u64 = 0,
    part_count: u32 = 0,
    logical_vertex_count: u32 = 0,
    sha256: [32]u8 = [_]u8{0} ** 32,
    model_id_hash: [32]u8 = [_]u8{0} ** 32,
    session_token_hash: [32]u8 = [_]u8{0} ** 32,
    object_namespace_hash: [32]u8 = [_]u8{0} ** 32,
    identity_quality: u32 = 0,
    degradation_count: u32 = 0,
    degradations: [7]RecoveryDegradationSlotV1 = [_]RecoveryDegradationSlotV1{.{}} ** 7,
};

pub const SceneEncodeCurrentV1 = *const fn (
    model_id: [*]const u8,
    model_id_len: usize,
    session_token: [*]const u8,
    session_token_len: usize,
    expected_generation: u64,
    sink: *const SnapshotSinkV1,
    meta: *RecoverySnapshotMetaV1,
    status: *SceneCallStatusV1,
) callconv(.c) bool;

/// Fixed-layout receipt for the allocation-free adoption commit point.  This
/// never travels through JSON or a growable snapshot sink: the coordinator has
/// already reserved its public reply and only needs an exact, retryable native
/// state transition.
pub const SceneAdoptionFinalizeReceiptV1 = extern struct {
    schema_version: u32 = 1,
    finalized: u32 = 0,
    already_finalized: u32 = 0,
    released: u32 = 0,
    already_released: u32 = 0,
};

pub const SceneFinalizeAdoptionV1 = *const fn (
    lease_receipt_id: u64,
    adoption_receipt_id: u64,
    target_sha256: [*]const u8,
    target_sha256_len: usize,
    receipt: *SceneAdoptionFinalizeReceiptV1,
    status: *SceneCallStatusV1,
) callconv(.c) bool;

pub const RegisterHostFn = *const fn (name: [*:0]const u8, callback: ?*const anyopaque) callconv(.c) bool;
pub const HostContextFromIsolate = *const fn (isolate: ?*anyopaque) callconv(.c) ?*anyopaque;
pub const EvalToString = *const fn (source: [*]const u8, source_len: usize, out: [*]u8, out_len: usize) callconv(.c) usize;
pub const MarkDirty = *const fn () callconv(.c) void;
pub const EmitEvent = *const fn (name: [*:0]const u8, detail: [*]const u8, detail_len: usize) callconv(.c) void;
pub const GpuDrain = *const fn () callconv(.c) bool;
pub const HostTreeGetNode = *const fn (node_id: u32) callconv(.c) ?*anyopaque;
pub const HostTreeGetIds = *const fn (node_id: u32, out_len: *usize) callconv(.c) ?[*]const u32;
pub const HostTreeCopyIds = *const fn (node_id: u32, out: [*]u32, capacity: usize) callconv(.c) usize;
pub const HostTreeCopyNodes = *const fn (node_id: u32, out: [*]u8, capacity: usize, stride: usize) callconv(.c) usize;
pub const GpuDrawText = *const fn (text: [*]const u8, text_len: usize, x: f32, y: f32, size_px: u16, red: f32, green: f32, blue: f32, alpha: f32) callconv(.c) void;
pub const GpuMeasureText = *const fn (text: [*]const u8, text_len: usize, size_px: u16) callconv(.c) f32;
pub const GpuDrawRect = *const fn (x: f32, y: f32, width: f32, height: f32, red: f32, green: f32, blue: f32, alpha: f32, radius: f32, border_width: f32, border_red: f32, border_green: f32, border_blue: f32, border_alpha: f32) callconv(.c) void;
/// Screen-space Studio chrome joins the core frame queues so the cold renderer
/// uploads and flushes the exact primitives projected by replaceable Scene3D.
pub const GpuDrawCapsule = *const fn (p0x: f32, p0y: f32, p1x: f32, p1y: f32, red: f32, green: f32, blue: f32, alpha: f32, stroke_width: f32) callconv(.c) void;
pub const GpuDrawTri = *const fn (ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32, red: f32, green: f32, blue: f32, alpha: f32) callconv(.c) void;
pub const GpuPushScissor = *const fn (x: f32, y: f32, width: f32, height: f32) callconv(.c) void;
pub const GpuReadbackTexture = *const fn (texture: ?*anyopaque, width: u32, height: u32, swap_red_blue: bool, out_len: *usize) callconv(.c) ?[*]u8;
pub const GpuCreateImageBindGroup = *const fn (texture_view: ?*anyopaque, sampler: ?*anyopaque) callconv(.c) ?*anyopaque;
pub const GpuQueueImageQuadNoFlip = *const fn (x: f32, y: f32, width: f32, height: f32, opacity: f32, bind_group: ?*anyopaque) callconv(.c) void;
pub const GpuStaticSurfaceBindGroup = *const fn (key: [*]const u8, key_len: usize) callconv(.c) ?*anyopaque;
pub const GpuMaterializeShader = *const fn (key: [*]const u8, key_len: usize, wgsl: [*]const u8, wgsl_len: usize, data: ?[*]const f32, data_len: usize, size: u32) callconv(.c) bool;
pub const GpuMaterializePixels = *const fn (key: [*]const u8, key_len: usize, rgba: [*]const u8, rgba_len: usize, width: u32, height: u32) callconv(.c) bool;
pub const WorldWindowOpen = *const fn (io: ?*const anyopaque, environ: ?*const anyopaque, game_file: [*]const u8, game_file_len: usize, store_dir: [*]const u8, store_dir_len: usize, width: u32, height: u32) callconv(.c) ModuleStatus;
pub const WorldWindowStatus = *const fn (out: [*]u8, out_len: usize) callconv(.c) usize;
pub const WorldWindowClose = *const fn (io: ?*const anyopaque) callconv(.c) void;

pub const CoreApiV1 = extern struct {
    abi_version: u32 = ABI_VERSION,
    struct_size: u32 = @sizeOf(CoreApiV1),
    node_size: u32,
    reserved: u32 = 0,
    register_host_fn: RegisterHostFn,
    host_context_from_isolate: HostContextFromIsolate,
    eval_to_string: EvalToString,
    mark_dirty: MarkDirty,
    emit_event: EmitEvent,
    gpu_drain: GpuDrain,
    host_tree_get_node: HostTreeGetNode,
    host_tree_children: HostTreeGetIds,
    host_tree_root_children: HostTreeGetIds,
    host_tree_copy_children: HostTreeCopyIds,
    host_tree_copy_root_children: HostTreeCopyIds,
    host_tree_copy_child_nodes: HostTreeCopyNodes,
    gpu_instance: ?*anyopaque,
    gpu_adapter: ?*anyopaque,
    gpu_device: ?*anyopaque,
    gpu_queue: ?*anyopaque,
    gpu_max_buffer_size: u64,
    gpu_draw_text: GpuDrawText,
    gpu_measure_text: GpuMeasureText,
    gpu_draw_rect: GpuDrawRect,
    gpu_draw_capsule: GpuDrawCapsule,
    gpu_draw_tri: GpuDrawTri,
    gpu_push_scissor: GpuPushScissor,
    gpu_pop_scissor: VoidFn,
    gpu_readback_texture: GpuReadbackTexture,
    gpu_create_image_bind_group: GpuCreateImageBindGroup,
    gpu_queue_image_quad_no_flip: GpuQueueImageQuadNoFlip,
    gpu_static_surface_bind_group: GpuStaticSurfaceBindGroup,
    gpu_materialize_shader: GpuMaterializeShader,
    gpu_materialize_pixels: GpuMaterializePixels,
    scene3d_api: ?*const anyopaque,
    world_window_open: WorldWindowOpen,
    world_window_status: WorldWindowStatus,
    world_window_close: WorldWindowClose,
};

pub const PrepareFn = *const fn (core: *const CoreApiV1) callconv(.c) ModuleStatus;
pub const RegisterBindingsFn = *const fn (host: ?*anyopaque) callconv(.c) void;
pub const QuiesceFn = *const fn (timeout_ms: u32) callconv(.c) ModuleStatus;
pub const SnapshotFn = *const fn (sink: *const SnapshotSinkV1) callconv(.c) ModuleStatus;
pub const RestoreFn = *const fn (bytes: [*]const u8, len: usize) callconv(.c) ModuleStatus;
pub const ActivateFn = *const fn () callconv(.c) ModuleStatus;
pub const DeactivateFn = *const fn () callconv(.c) void;
pub const ReleaseFn = *const fn () callconv(.c) void;

pub const ModuleLifecycleV1 = extern struct {
    prepare: PrepareFn,
    register_bindings: RegisterBindingsFn,
    quiesce: QuiesceFn,
    snapshot: SnapshotFn,
    restore: RestoreFn,
    activate: ActivateFn,
    deactivate: DeactivateFn,
    release: ReleaseFn,
};

/// `io` points at a `std.Io` value owned by the caller for the duration of the
/// call. `environ` points at the process environment map. Both are opaque here
/// so no standard-library layout becomes part of the stable descriptor.
pub const RenderSceneFn = *const fn (io: ?*const anyopaque, environ: ?*const anyopaque, node: ?*anyopaque, x: f32, y: f32, width: f32, height: f32, opacity: f32) callconv(.c) bool;
pub const RenderWorldFn = *const fn (io: ?*const anyopaque, environ: ?*const anyopaque, node: ?*anyopaque, x: f32, y: f32, width: f32, height: f32, opacity: f32, source_status: GameSourceStatus) callconv(.c) bool;
pub const RenderDetachedFn = *const fn (io: ?*const anyopaque, environ: ?*const anyopaque, target_handle: *u64, node: ?*anyopaque, width: f32, height: f32) callconv(.c) ?*anyopaque;
pub const ReleaseDetachedFn = *const fn (target_handle: *u64) callconv(.c) void;
pub const UpdateFn = *const fn (dt_seconds: f32) callconv(.c) void;
pub const VoidFn = *const fn () callconv(.c) void;
pub const FlushPendingFn = *const fn (io: ?*const anyopaque, environ: ?*const anyopaque) callconv(.c) void;
pub const BoolFn = *const fn () callconv(.c) bool;
pub const U8Fn = *const fn () callconv(.c) u8;
pub const I32Fn = *const fn () callconv(.c) i32;
pub const F32x2Fn = *const fn (a: f32, b: f32) callconv(.c) void;
pub const F32x2BoolFn = *const fn (a: f32, b: f32) callconv(.c) bool;
pub const F32x2I32Fn = *const fn (a: f32, b: f32) callconv(.c) i32;
pub const F32x4BoolI32Fn = *const fn (a: f32, b: f32, c: f32, d: f32, flag: bool) callconv(.c) i32;

pub const CharacterRigCommitV1 = extern struct {
    valid: bool,
    _padding: [3]u8 = .{ 0, 0, 0 },
    bone_index: u32,
    pos: [3]f32,
    rot: [4]f32,
    scale: [3]f32,
};

/// Per-frame Scene3D draw counters (TRI / DC / instances in the editor's status
/// bar). The modular core has no scene3d globals of its own — the drawing
/// happens inside the loaded library — so these must cross the boundary like
/// every other scene3d read. Field-for-field the same shape as `gpu/3d.zig`'s
/// `TelemetryStats`.
pub const Scene3dTelemetryV1 = extern struct {
    scene_count: u32 = 0,
    mesh_children: u32 = 0,
    meshes_collected: u32 = 0,
    meshes_dropped: u32 = 0,
    instances: u32 = 0,
    staged_dynamic: u32 = 0,
    draw_calls: u32 = 0,
    _padding: u32 = 0,
    triangles: u64 = 0,
    draw_us: u64 = 0,
};

/// Scene3D's slice of the memory popover — the flattened union of `gpu/3d.zig`'s
/// `GpuMemoryStats` + `StaticInstanceMemoryStats` + the two byte readers, for the
/// same reason `Scene3dTelemetryV1` exists.
pub const Scene3dMemoryV1 = extern struct {
    retained_geometry_bytes: u64 = 0,
    host_stash_bytes: u64 = 0,
    core_buffer_capacity_bytes: u64 = 0,
    render_target_bytes: u64 = 0,
    diffuse_texture_bytes: u64 = 0,
    static_standard_used_bytes: u64 = 0,
    static_standard_capacity_bytes: u64 = 0,
    static_slim_used_bytes: u64 = 0,
    static_slim_capacity_bytes: u64 = 0,
};

pub const Scene3dApiV1 = extern struct {
    header: ModuleHeaderV1,
    lifecycle: ModuleLifecycleV1,
    render: RenderSceneFn,
    render_detached: RenderDetachedFn,
    release_detached: ReleaseDetachedFn,
    update: UpdateFn,
    flush_pending: FlushPendingFn,
    frame_cleanup: VoidFn,
    reset_for_reload: VoidFn,
    deinit_scene: VoidFn,
    texture_bind_group_layout: *const fn () callconv(.c) ?*anyopaque,
    diffuse_sampler: *const fn () callconv(.c) ?*anyopaque,
    uv_sampling_uniform: *const fn (finite_atlas: bool) callconv(.c) ?*anyopaque,
    mesh_edit_capturing: BoolFn,
    mesh_edit_focus_tool: BoolFn,
    mesh_edit_mode: U8Fn,
    orbit_drag: F32x2Fn,
    orbit_pan: F32x2Fn,
    orbit_zoom: *const fn (delta: f32) callconv(.c) void,
    orbit_navigation_enabled: BoolFn,
    orbit_navigation_set: *const fn (enabled: bool) callconv(.c) bool,
    orbit_navigation_key: *const fn (sym: i32, down: bool, shift: bool, ctrl: bool) callconv(.c) bool,
    focus_at: F32x2BoolFn,
    mesh_pick: *const fn (x: f32, y: f32, additive: bool) callconv(.c) i32,
    mesh_out_of_scope_part_at: F32x2I32Fn,
    mesh_box: F32x4BoolI32Fn,
    mesh_select_all: I32Fn,
    mesh_snapshot: VoidFn,
    mesh_revert: VoidFn,
    mesh_gizmo_hit: F32x2I32Fn,
    mesh_gizmo_begin: VoidFn,
    mesh_gizmo_grab_at: *const fn (x: f32, y: f32, code: i32) callconv(.c) void,
    mesh_gizmo_drag: *const fn (axis: i32, dx: f32, dy: f32, fine: bool, freeform: bool, vertex_snap: bool) callconv(.c) bool,
    mesh_gizmo_finish: BoolFn,
    backdrop_gizmo_hit: F32x2I32Fn,
    backdrop_gizmo_begin: *const fn (code: i32) callconv(.c) void,
    backdrop_gizmo_drag: *const fn (dx: f32, dy: f32, fine: bool, freeform: bool) callconv(.c) bool,
    backdrop_gizmo_finish: VoidFn,
    loop_cut_active: BoolFn,
    loop_cut_handle_hit: F32x2BoolFn,
    loop_cut_handle_drag: *const fn (dx: f32, dy: f32, snap: bool) callconv(.c) bool,
    compass_hit: F32x2I32Fn,
    compass_snap: *const fn (code: i32) callconv(.c) bool,
    draw_editor_overlay: F32x2Fn,
    mesh_set_marquee: *const fn (x0: f32, y0: f32, x1: f32, y1: f32) callconv(.c) void,
    mesh_clear_marquee: VoidFn,
    character_rig_active: BoolFn,
    character_rig_gizmo_hit: F32x2I32Fn,
    character_rig_gizmo_begin: *const fn (code: i32) callconv(.c) bool,
    character_rig_gizmo_drag: *const fn (dx: f32, dy: f32, fine: bool) callconv(.c) bool,
    character_rig_gizmo_end: *const fn () callconv(.c) CharacterRigCommitV1,
    telemetry_stats: *const fn (out: *Scene3dTelemetryV1) callconv(.c) void,
    memory_stats: *const fn (out: *Scene3dMemoryV1) callconv(.c) void,
    session_publish_object_ids: SceneJsonCallV1,
    session_identity: SceneJsonCallV1,
    document_encode_current: SceneEncodeCurrentV1,
    face_table: SceneJsonCallV1,
    /// Drains one completed asynchronous face analysis. A successful call
    /// with status `analysis_pending` and no bytes means no completion is
    /// currently available; `false` remains reserved for transport failure.
    face_analysis_ready: SceneJsonCallV1,
    face_diff: SceneBytesJsonCallV1,
    face_select: SceneJsonCallV1,
    face_seek: SceneJsonCallV1,
    preview_open: SceneBytesJsonCallV1,
    preview_select: SceneJsonCallV1,
    preview_release: SceneJsonCallV1,
    capture_recovery: SceneEncodeCurrentV1,
    lease_acquire: SceneJsonCallV1,
    lease_release: SceneJsonCallV1,
    field_candidate: SceneJsonCallV1,
    document_adopt: SceneBytesJsonCallV1,
    document_rollback: SceneJsonCallV1,
    document_finalize: SceneFinalizeAdoptionV1,
    // req_4271 ctrl-gestures (appended — struct_size gates compatibility):
    // the edge-path pick behind ctrl+click, and the cheap selection-count probe
    // the engine reads before claiming a ctrl+right-click for extrude-to-cursor.
    mesh_path_pick: *const fn (x: f32, y: f32, additive: bool) callconv(.c) i32,
    mesh_selection_count: *const fn () callconv(.c) u32,
};

/// Capture's strict saved-character target must live in the same Game module
/// that renders the WorldLoader. These fixed-layout rows carry only the
/// canonical rig view and complete local-quaternion frames across that module
/// boundary; allocator-owned Zig slices and tagged unions never cross it.
pub const CAPTURE_TARGET_MAX_BONES: usize = 255;
pub const CAPTURE_TARGET_BONE_ID_BYTES: usize = 128;

pub const CaptureConstraintKindV1 = enum(u32) {
    unconstrained = 0,
    fixed = 1,
    hinge_x = 2,
    ball = 3,
};

pub const CaptureTargetBoneIdV1 = extern struct {
    len: u32 = 0,
    bytes: [CAPTURE_TARGET_BONE_ID_BYTES]u8 = @splat(0),
};

pub const CaptureTargetBoneV1 = extern struct {
    parent_index: i32 = -1,
    constraint_kind: CaptureConstraintKindV1 = .unconstrained,
    bind_translation: [3]f32 = @splat(0),
    bind_rotation: [4]f32 = .{ 0, 0, 0, 1 },
    /// hinge: [min,max]; ball: swing-x, swing-z, twist-y min/max pairs.
    constraint_values: [6]f32 = @splat(0),
};

pub const CaptureTargetRigV1 = extern struct {
    bone_count: u32 = 0,
    bone_ids: [CAPTURE_TARGET_MAX_BONES]CaptureTargetBoneIdV1 =
        @splat(CaptureTargetBoneIdV1{}),
    bones: [CAPTURE_TARGET_MAX_BONES]CaptureTargetBoneV1 =
        @splat(CaptureTargetBoneV1{}),
};

pub const CapturePoseV1 = extern struct {
    bone_count: u32 = 0,
    frame_id: u64 = 0,
    root_translation: [3]f32 = @splat(0),
    local_quaternions: [CAPTURE_TARGET_MAX_BONES][4]f32 =
        @splat(.{ 0, 0, 0, 1 }),
};

pub const CaptureLoadTargetFn = *const fn (
    io: ?*const anyopaque,
    environ: ?*const anyopaque,
    node_id: u32,
    owner: [*]const u8,
    owner_len: usize,
    geometry_path: [*]const u8,
    geometry_path_len: usize,
    skin_path: [*]const u8,
    skin_path_len: usize,
    skeleton_json: [*]const u8,
    skeleton_json_len: usize,
    out: *CaptureTargetRigV1,
) callconv(.c) ModuleStatus;

pub const CaptureTargetOwnerFn = *const fn (
    node_id: u32,
    owner: [*]const u8,
    owner_len: usize,
) callconv(.c) ModuleStatus;

pub const CaptureSetDriveFn = *const fn (
    node_id: u32,
    owner: [*]const u8,
    owner_len: usize,
    enabled: bool,
) callconv(.c) ModuleStatus;

pub const CapturePublishPoseFn = *const fn (
    node_id: u32,
    owner: [*]const u8,
    owner_len: usize,
    pose: *const CapturePoseV1,
) callconv(.c) ModuleStatus;

pub const GameApiV1 = extern struct {
    header: ModuleHeaderV1,
    lifecycle: ModuleLifecycleV1,
    render_world: RenderWorldFn,
    mount_world: *const fn (io: ?*const anyopaque, environ: ?*const anyopaque, node_id: u32, game_file: [*]const u8, game_file_len: usize, store_dir: [*]const u8, store_dir_len: usize, source_status: GameSourceStatus) callconv(.c) ModuleStatus,
    unmount_world: *const fn (io: ?*const anyopaque, node_id: u32) callconv(.c) void,
    status_world: *const fn (node_id: u32, out: [*]u8, out_len: usize) callconv(.c) usize,
    capture_load_target: CaptureLoadTargetFn,
    capture_activate_target: CaptureTargetOwnerFn,
    capture_publish_pose: CapturePublishPoseFn,
    capture_clear_pose: CaptureTargetOwnerFn,
    capture_set_drive: CaptureSetDriveFn,
    capture_close_target: CaptureTargetOwnerFn,
    paint_armed: *const fn (node_id: u32) callconv(.c) bool,
    any_paint_armed: BoolFn,
    // Draw Wall overlay (req_4520): engine.zig's motion branch keeps frames
    // coming while any viewport's wall tool is armed.
    any_wall_tool_armed: BoolFn,
    paint_pointer: *const fn (io: ?*const anyopaque, node_id: u32, phase: u32, x: f32, y: f32) callconv(.c) void,
    mouse_look: *const fn (node_id: u32, dx: f32, dy: f32) callconv(.c) void,
    authoring_camera_drag: *const fn (node_id: u32, dx: f32, dy: f32, pan: bool) callconv(.c) bool,
    authoring_camera_dolly: *const fn (node_id: u32, wheel_delta: f32) callconv(.c) bool,
    set_aiming: *const fn (node_id: u32, aiming: bool) callconv(.c) void,
    external_camera: *const fn (node_id: u32) callconv(.c) bool,
    render_detached_world: RenderDetachedFn,
    draw_world_hud: *const fn (node_id: u32, width: f32, height: f32) callconv(.c) void,
    camera_bind_node: *const fn (node_id: u32) callconv(.c) void,
    camera_unbind_node: *const fn (node_id: u32) callconv(.c) void,
    camera_step_node: *const fn (node_id: u32, now_ms: u32, out: [*]f32, out_len: usize) callconv(.c) bool,
    camera_write_node: *const fn (node: ?*anyopaque, values: [*]const f32, values_len: usize) callconv(.c) void,
};

pub fn zeroHash() [BUILD_HASH_BYTES]u8 {
    return [_]u8{0} ** BUILD_HASH_BYTES;
}

pub fn headerValid(header: *const ModuleHeaderV1, expected_kind: ModuleKind, expected_size: usize, expected_dependency: [BUILD_HASH_BYTES]u8) bool {
    return header.abi_version == ABI_VERSION and
        header.module_kind == expected_kind and
        header.struct_size == expected_size and
        std.mem.eql(u8, &header.dependency_hash, &expected_dependency);
}

comptime {
    if (@offsetOf(Scene3dApiV1, "header") != 0) @compileError("Scene3dApiV1 header must be first");
    if (@offsetOf(GameApiV1, "header") != 0) @compileError("GameApiV1 header must be first");
    if (@offsetOf(Scene3dApiV1, "lifecycle") != @sizeOf(ModuleHeaderV1)) @compileError("Scene3dApiV1 lifecycle prefix drift");
    if (@offsetOf(GameApiV1, "lifecycle") != @sizeOf(ModuleHeaderV1)) @compileError("GameApiV1 lifecycle prefix drift");
    if (@alignOf(ModuleHeaderV1) > @alignOf(usize)) @compileError("module header alignment exceeds native pointer alignment");
    if (@sizeOf(SnapshotEnvelopeV1) != 32) @compileError("snapshot envelope wire size drift");
    if (@sizeOf(SceneCallStatusV1) != 24) @compileError("SceneCallStatusV1 wire size drift");
    if (@offsetOf(SceneCallStatusV1, "flags") != 4 or
        @offsetOf(SceneCallStatusV1, "current_generation") != 8 or
        @offsetOf(SceneCallStatusV1, "receipt_id") != 16)
        @compileError("SceneCallStatusV1 field offset drift");
}
