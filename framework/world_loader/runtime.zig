//! Retained compiled-world ownership and its narrow method surface.
//!
//! Runtime owns state only. Construction, frame coordination, simulation, interaction,
//! and live-edit reconciliation are delegated to focused operation modules.

const std = @import("std");
const layout = @import("../layout.zig");
const constructor = @import("../world/constructor.zig");
const foliage = @import("../world/foliage.zig");
const flora_geometry = @import("../world/flora_geometry.zig");
const live_mesh_doors = @import("../world/live_mesh_doors.zig");
const streaming = @import("../world/streaming.zig");
const Node = layout.Node;
const m_config = @import("config.zig");
const m_state = @import("state.zig");
const m_instances = @import("instances.zig");
const m_physics = @import("physics.zig");
const m_streaming_support = @import("streaming_support.zig");
const m_live_inputs = @import("live_inputs.zig");
const m_foliage_preview = @import("foliage_preview.zig");

const WIN_W = m_config.WIN_W;
const WIN_H = m_config.WIN_H;
const INSTANCE_STRIDE = m_config.INSTANCE_STRIDE;
const MAX_PAINT_SLOTS = m_config.MAX_PAINT_SLOTS;
const PlayerState = m_state.PlayerState;
const NpcRuntime = m_state.NpcRuntime;
const InteractState = m_state.InteractState;
const CameraState = m_state.CameraState;
const PhysicsColliders = m_state.PhysicsColliders;
const PropBody = m_state.PropBody;
const ElevatorCar = m_state.ElevatorCar;
const DoorState = m_state.DoorState;
const CookedDoor = m_state.CookedDoor;
const ShapeBatches = m_instances.ShapeBatches;
const MaterialBatch = m_instances.MaterialBatch;
const MeshIsland = m_physics.MeshIsland;
const SpatialGrid = m_physics.SpatialGrid;
const STREAM_DETAIL_RADIUS_METERS = m_streaming_support.STREAM_DETAIL_RADIUS_METERS;
const StreamProto = m_streaming_support.StreamProto;
const BakedRange = m_streaming_support.BakedRange;
const BakedMeshPos = m_streaming_support.BakedMeshPos;
const ErasedRow = m_streaming_support.ErasedRow;
const setPhysicsConfig = m_live_inputs.setPhysicsConfig;
const applyPendingLive = m_live_inputs.applyPendingLive;
const applyLiveColliders = m_live_inputs.applyLiveColliders;
const FoliageSnapSlot = m_foliage_preview.FoliageSnapSlot;
const FoliageRowSet = m_foliage_preview.FoliageRowSet;
const FoliageMailbox = m_foliage_preview.FoliageMailbox;

pub const Runtime = struct {
    allocator: std.mem.Allocator,
    node_id: u32 = 0,
    scene: constructor.Scene,
    fallback: ?[]f32 = null,
    insts: []const f32 = &.{},
    inst_count: u32 = 0,
    stride: usize = INSTANCE_STRIDE,
    piece_count: u32 = 0,
    physics_colliders: PhysicsColliders = undefined,
    has_physics_colliders: bool = false,
    // The CAMERA spring-arm always steps against the FULL baked authored wall/roof
    // colliders, never the per-frame windowed/instance-derived physics set. On a
    // huge map (spatial windowing ON) the physics set is re-derived from render
    // instances and capped (MAX_ORIENTED=256), which silently DROPS yawed building
    // walls near the player — the camera then buries inside a building it can't see.
    // Keeping a dedicated unclamped baked buffer for the camera means "see myself
    // against the building" works at any world scale (req_0407/0420). Null on a
    // pre-lump bake (no baked_colliders) — the camera falls back to physics_colliders.
    camera_colliders: ?PhysicsColliders = null,
    // Spatial collider windowing: enabled only when the full collider set overflows
    // MAX_RECTS (a huge --massive map), so normal maps keep their static full set.
    windowed: bool = false,
    grid: ?SpatialGrid = null,
    cube: [36 * 8]f32 = undefined,
    // Flat sticker quads, one per thin axis (req_3028) — 12 verts vs the cube's 36.
    sticker_quad_x: [12 * 8]f32 = undefined,
    sticker_quad_y: [12 * 8]f32 = undefined,
    sticker_quad_z: [12 * 8]f32 = undefined,
    cube_open_run_min: [30 * 8]f32 = undefined,
    cube_open_run_max: [30 * 8]f32 = undefined,
    cube_open_run_both: [24 * 8]f32 = undefined,
    ramp_slab: [36 * 8]f32 = undefined,
    cylinder8: [8 * 12 * 8]f32 = undefined,
    cylinder16: [16 * 12 * 8]f32 = undefined,
    sphere: [12 * 8 * 6 * 8]f32 = undefined,
    brush_decal: [32 * 3 * 8]f32 = undefined,
    brush_rings: [(32 * 3 * 6 + 12) * 8]f32 = undefined,
    brush_handles: [(32 * 2 * 6 + 32 * 3 + 4 * 6) * 8]f32 = undefined,
    brush_cone: [32 * 3 * 8]f32 = undefined,
    brush_dome: [32 * 6 * 6 * 8]f32 = undefined,
    gable_prism: [24 * 8]f32 = undefined,
    corner_miter_prism: [12 * 8]f32 = undefined,
    corner_miter_mirror_prism: [12 * 8]f32 = undefined,
    grass_blade: [36 * 8]f32 = undefined,
    flower_head: [36 * 8]f32 = undefined,
    bush_clump: [60 * 8]f32 = undefined,
    frond_card: [144 * 8]f32 = undefined,
    palm_trunk: [1680 * 8]f32 = undefined,
    wrapped_meshes: [foliage.WRAPPED_SPECIES_COUNT]flora_geometry.WrappedMesh = undefined,
    shape_batches: ShapeBatches = undefined,
    has_shape_batches: bool = false,
    // Per-material textured batches (geometry built at construct; the shaders are
    // run into textures lazily by ensureMaterials at first render, once gpu is up).
    material_batches: []MaterialBatch = &.{},
    materials_ready: bool = false,
    player_geom_keys: std.ArrayList([]u8) = .empty,
    mesh_prop_vertex_buffers: std.ArrayList([]f32) = .empty,
    // LIVESKIN per-slot (req_2025): the live mesh-ref draw runs EVERY frame, so its per-slot
    // geom keys ("{meshKey}:base" / ":slot-N", the SAME keys the baked slotted draw interns)
    // are built ONCE and cached here, keyed by (meshHash<<32 | slotCode), never re-allocPrinted
    // per frame. Freed at teardown.
    live_slot_keys: std.AutoHashMapUnmanaged(u64, []u8) = .empty,
    // Per cooked/imported mesh: its connected-component collision islands (req_1624),
    // computed once and shared by the static + windowed collider builds.
    mesh_prop_islands: []const []MeshIsland = &.{},
    kid_list: std.ArrayList(Node) = .empty,
    root: Node = .{},
    player_first_child: usize = 0,
    /// Live NPC figures (req_0935) — built from scene.npc_spawns, rendered with
    /// the player figure's machinery. Their node child-strings are owned by
    /// player_geom_keys (the shared owned-key bag, freed at teardown).
    npcs: std.ArrayList(NpcRuntime) = .empty,
    player: PlayerState = undefined,
    camera: CameraState = undefined,
    /// Prop interaction (PROPUSE req_0624) — driven by scene.interactables.
    interact: InteractState = .{},
    /// Kickable prop bodies (KICKPROP req_0625): the first MAX_ENTITIES of
    /// scene.dynamic_props, stepped through the host entity section.
    bodies: []PropBody = &.{},
    /// First kid index of the dynamic prop part nodes (laid out prop-by-prop
    /// in scene.dynamic_props order; updateDynamicPropNodes walks them).
    dyn_first_child: usize = 0,
    /// Live elevator cars (req_0652): parallel to the first
    /// physics_colliders.car_count ELEVATORS-lump shafts; stepElevators
    /// advances them and re-aims their live rects + render nodes.
    cars: []ElevatorCar = &.{},
    /// First kid index of the elevator car nodes (one box per car).
    car_first_child: usize = 0,
    /// Live doors (DOORS-0611): parallel to the first
    /// physics_colliders.door_count DOORS-lump records; the E toggle flips
    /// state, rect blocking, and the panel node together.
    doors_state: []DoorState = &.{},
    /// First kid index of the door panel nodes (one box per door).
    door_first_child: usize = 0,
    /// Live cooked doors (req_1864): parallel to physics_colliders.cooked_door
    /// rects; the leaf is a mesh-prop slot node (custom art), not a box. The E
    /// toggle parks the rect + drops the node together. Owned slice.
    cooked_doors: []CookedDoor = &.{},
    /// Door machines sourced from editor-live mesh refs (req_2895/req_2896).
    /// Resident MESH_PROPS owns the same leaf-slot metadata as a baked door;
    /// these parallel slices preserve transient state across live-ref rebuilds.
    live_cooked_doors: []CookedDoor = &.{},
    live_cooked_door_states: []live_mesh_doors.State = &.{},
    live_cooked_door_by_identity: std.AutoHashMapUnmanaged(u64, usize) = .empty,
    /// Live LED tickers (req_0893 #3): one MUTABLE instances node per ticker,
    /// whose lit-LED instance data we rebuild each frame as the scroll offset
    /// advances (the elevator-car live-node pattern, instanced). Buffers are
    /// owned, sized for the max lit dots ((windowCols+1)*rows).
    ticker_first_child: usize = 0,
    ticker_buffers: [][]f32 = &.{},
    /// Live editor-placed overlay (LIVEHOST req_1798): ONE mutable box-instance node in
    /// the stable prefix whose buffer applyPendingLive refreshes from the per-node pending
    /// rows the editor pushes. null until build() reserves it. live_buf is owned; live_gen
    /// tracks the last pending generation copied so a still view never re-uploads.
    live_kid: ?usize = null,
    live_buf: []f32 = &.{},
    live_gen: u64 = 0,
    /// Live physics-globals override (GLOBALS req_2770): the editor's Globals →
    /// Physics panel pushes the 13-float PHYSICS_CONFIG tuning through
    /// setPhysicsConfig and the NEXT step reads it — the baked lump value stays
    /// untouched so clearing the override reverts to the shipped feel.
    physics_override: ?constructor.PhysicsConfig = null,
    physics_override_gen: u64 = 0,
    /// Live-piece COLLIDERS (req_2792: "I can walk through every wall"): the
    /// live overlay is draw-only, so applyLiveColliders rebuilds the physics
    /// step buffer as BASE (the build-time rects/oriented, with their in-place
    /// door/car state) + LIVE (rects derived from the live rows, floors-first)
    /// whenever the overlay generation moves. These are the base section counts
    /// captured at build(); the gen tracks the last overlay folded in.
    base_rect_count: usize = 0,
    base_oriented_count: usize = 0,
    live_collider_gen: u64 = 0,
    /// Live MESH-prop colliders (req_2832: "i walk right through it") — the last
    /// live-mesh generation folded into the physics buffer, tracked separately so
    /// either overlay moving triggers the one shared rebuild.
    live_mesh_collider_gen: u64 = 0,
    /// Resident metadata can change while placement refs stay identical (for
    /// example re-exporting a wall as Door Wall), so it also invalidates the
    /// live collider/door compilation boundary.
    live_resident_collider_gen: u64 = 0,
    live_collider_warned: bool = false,
    // Live editor-placed MESH props (LIVEMESH req_1812): a just-placed imported/cooked
    // mesh prop renders instantly by REFERENCING an already-resident mesh (the user's
    // "once one X exists, the next is a reference to it" — instanced rendering). The
    // editor pushes (meshKeyHash, x,y,z,yaw) per placement; applyLiveMeshProps appends a
    // mesh-prop draw node per ref each frame, resolving the hash to a loaded mesh. No bake.
    mesh_by_hash: std.AutoHashMapUnmanaged(u32, usize) = .empty,
    mesh_hash_built: bool = false,
    // FULLRES req_1909/1911/1912: the editor's "fat & loaded" residency. The /editor route
    // pushes the WHOLE cooked-asset catalog (a MESH_PROPS lump, meshes only) so every compiled
    // asset is resident the instant you enter the route — placing/moving/skinning a prop made
    // seconds ago in Studio needs NO world rebake. These live alongside the baked scene meshes;
    // meshForHash resolves a live ref against baked first, then this resident set. Decoded once
    // per pushed generation (applyResidentMeshes), owned, freed on replace/unmount.
    resident: ?constructor.MeshProps = null,
    resident_by_hash: std.AutoHashMapUnmanaged(u32, usize) = .empty,
    applied_resident_gen: u64 = 0,
    // Live editor face-skins (LIVESKIN req_1843): a procedural skin the editor pushes is
    // materialized once into a "live-mat:<hash>" tile; this maps its hash → that owned key
    // string (presence = already materialized). A live mesh ref carrying mat_hash wears it.
    live_mat_keys: std.AutoHashMapUnmanaged(u32, []u8) = .empty,
    // RESKIN req_1845: a re-skinned EXISTING prop renders live with its new skin, but its
    // STALE baked copy must hide or the two z-fight. Each baked mesh-prop instance's node
    // range is keyed by world position; a live ref coincident with it hides that range for
    // the frame. hidden_baked tracks what we hid so the next frame restores it first.
    baked_by_pos: std.AutoHashMapUnmanaged(u64, BakedRange) = .empty,
    hidden_baked: std.ArrayListUnmanaged(BakedRange) = .empty,
    // DIRTYRECT req_1891/1892: erase the baked geometry a moved/deleted piece left
    // behind WITHOUT a rebake (the editor pushes the old-footprint rects). baked_mesh_list
    // is every baked mesh-prop's world pos + node range (so a rect can hide the ones inside
    // it — the move twin of the position-keyed RESKIN hide). erased_rows remembers each
    // collapsed BOX row's original scale so a changed rect set restores it first; the box
    // batches re-upload in place via the node version. applied_erase_gen tracks the last
    // pushed rect generation so the GPU re-upload happens once per edit, not per frame.
    baked_mesh_list: std.ArrayListUnmanaged(BakedMeshPos) = .empty,
    erased_rows: std.ArrayListUnmanaged(ErasedRow) = .empty,
    applied_erase_gen: u64 = 0,
    // DIRTYRECT (streaming): bumped when a stream family's rows are collapsed; refreshStreamNodes
    // stamps it as each streamed static node's instance version so the edited families re-upload.
    stream_erase_gen: u32 = 0,
    // WALLHIDE req_2053: the editor build pane's "disable walls" toggle. When ON, every WALL_SENTINEL
    // row collapses (scale→0) so you can see/edit a building's interior; toggling OFF restores them.
    // wall_collapsed_rows remembers each collapsed row's original scale (twin of erased_rows). The
    // *_gen counters re-run the collapse only when the toggle flips OR an erase pass restored a row
    // a wall pass had hidden (so the two never fight). The GPU cost (re-upload) is paid once per flip.
    hide_walls: bool = false,
    wall_collapsed_rows: std.ArrayListUnmanaged(ErasedRow) = .empty,
    applied_wall_gen: u64 = 0,
    wall_seen_erase_gen: u64 = 0,
    // LIVEBLDSKIN req_1849: per-frame instance rows for live procedurally-skinned building-
    // piece faces (textured cubes outset to cover the baked face-slab). Pre-sized each frame
    // so the node slices into it stay stable while kid_list grows.
    skin_box_buf: std.ArrayListUnmanaged(f32) = .empty,
    // Node count of the permanent (non-streaming, non-live-mesh) prefix — captured in
    // build(). The non-streaming path truncates back to here before re-appending the live
    // mesh nodes each frame (streaming truncates to stream_tail_start in refreshStreamNodes).
    perm_node_count: usize = 0,
    ticker_seconds: f32 = 0,
    // SPINPROP req_3128: the live spinning-prop clock. appendLiveMeshRef draws a
    // ref carrying spin_deg_per_sec at yaw + rate×seconds — the live tail is
    // rebuilt every frame anyway, so spin is pure arithmetic at append time.
    live_spin_seconds: f32 = 0,
    // Ambient road traffic (req_2056): three MUTABLE instance nodes (box / cyl16 /
    // sphere — vehicle parts bucket by shape), their row buffers rebuilt each
    // frame by stepTraffic as every vehicle advances along its baked route.
    traffic_first_child: usize = 0,
    traffic_box_buf: []f32 = &.{},
    traffic_cyl_buf: []f32 = &.{},
    traffic_sphere_buf: []f32 = &.{},
    traffic_seconds: f32 = 0,
    // [traffic-paths req_2072] a debug ribbon along every baked route centerline,
    // toggled by the P key (or RJIT_TRAFFICPATHS=1 at boot) so the actual path over
    // the road is visible. One static box node; toggling sets its instance_count.
    traffic_path_node: usize = 0,
    traffic_path_buf: []f32 = &.{},
    traffic_path_count: u32 = 0,
    traffic_paths_on: bool = false,
    prev_paths_key_down: bool = false,
    last_ns: i64 = 0,
    frame: u32 = 0,
    // Content streaming (engaged when the world outgrows the detail radius):
    // per-frame draw-node tail rebuilt from the streaming world's ranges.
    stream: ?streaming.World = null,
    stream_protos: std.ArrayList(StreamProto) = .empty,
    stream_radius: f32 = STREAM_DETAIL_RADIUS_METERS,
    stream_tail_start: usize = 0,
    stream_draw_count: usize = 0,
    stream_logged: bool = false,
    stream_drop_warned: bool = false,
    last_aspect: f32 = @as(f32, WIN_W) / @as(f32, WIN_H),
    // MAPPAINT req_2473: the live-painted terrain mirror. paint_kids_first is a
    // MAX_PAINT_SLOTS run of reserved nodes in the stable prefix (one per painted
    // chunk); each used slot owns a 121×121 downsampled floor buffer + a versioned
    // "~hf~paint-…" geom key, re-baked only when the chunk's height channel is
    // dirty (the once-per-frame coalescing the JS painter did with usePaintedField,
    // now host-side). paint_beam_kid is the translucent brush-beam column. The
    // last_* rect is the pane placement renderEmbedded saw — the screen→ray
    // mapping paintPointer needs.
    paint_kids_first: ?usize = null,
    paint_beam_kid: ?usize = null,
    /// req_2924: committed rail and the current road/rail ghost are native
    /// cube-instance ribbons. Committed rows rebuild only when path recipes or
    /// terrain move; preview rows only when the snapped hover/draft changes.
    transport_committed_kid: ?usize = null,
    transport_preview_kid: ?usize = null,
    transport_committed_rows: std.ArrayListUnmanaged(f32) = .empty,
    transport_preview_rows: std.ArrayListUnmanaged(f32) = .empty,
    transport_committed_revision: u64 = 0,
    transport_draft_revision: u64 = 0,
    transport_preview_active: bool = false,
    /// Whole map-engine snapshot last reconciled into the retained paint slots.
    /// Chunk dirty bits cover brush edits; this identity covers reset/load.
    paint_map_revision: u64 = 0,
    paint_slot_used: [MAX_PAINT_SLOTS]bool = @splat(false),
    paint_slot_chunk: [MAX_PAINT_SLOTS][2]i32 = @splat(.{ 0, 0 }),
    paint_slot_ver: [MAX_PAINT_SLOTS]u32 = @splat(0),
    paint_slot_key: [MAX_PAINT_SLOTS]?[]u8 = @splat(null),
    paint_slot_floor: [MAX_PAINT_SLOTS]?[]f32 = @splat(null),
    /// owned per-slot ground-formula D stream (tile channel), re-encoded on a
    /// dirty tiles channel — the 3d.zig ground pipeline re-reads it every frame
    paint_slot_ground: [MAX_PAINT_SLOTS]?[]f32 = @splat(null),
    /// the water channel's mirror (chunkFloor.ts floorToWaterBody port): per-slot
    /// shore-culled depths + surface heights feeding a second "~water~" node
    /// live-foliage preview (req_2497/req_2875): ground flora, palm parts, and
    /// every whole wrapped tree/shrub species regenerated from
    /// the painted flora lanes whenever flora or terrain height changes —
    /// painting a tree paints a TREE, live. Buffers start at the family's
    /// ROW_CAP and DOUBLE when full (req_2843: elastic — the machine is the
    /// only wall); the renderer re-retains a grown family's fresh pointer.
    paint_foliage_kids_first: ?usize = null,
    /// req_2864: the regen runs on a WORKER thread (the pose_mailbox pattern,
    /// req_2845) — a moving brush must never spend frame time growing plants
    /// (240fps → 10fps measured). The main thread snapshots painted-chunk data
    /// (flora lanes + render floor) and submits; the worker grows rows +
    /// per-chunk segments (req_2859) into the row set the renderer is NOT
    /// displaying; poll swaps the finished set in. Strictly serial: one job in
    /// flight, stroke bursts coalesce through `foliage_want`.
    foliage_worker: ?std.Thread = null,
    foliage_box: FoliageMailbox = .{},
    foliage_sets: [2]FoliageRowSet = .{ .{}, .{} },
    foliage_display: u8 = 0,
    foliage_snap: FoliageSnapSlot = .{},
    foliage_want: bool = false,
    foliage_want_log: bool = false,
    paint_foliage_ver: u32 = 0,
    /// req_2838: preview-budget attention tracking. The regen spends the row
    /// budget NEAREST-FIRST from the anchor (brush hover, else camera look).
    /// When any family clipped, the preview FOLLOWS the author — a fresh regen
    /// fires once the anchor drifts half a chunk, re-spending the budget
    /// around the new spot so the place being painted is always dressed.
    paint_foliage_clipped: bool = false,
    paint_foliage_anchor: [2]f32 = .{ 0, 0 },
    paint_water_kids_first: ?usize = null,
    paint_slot_water_ver: [MAX_PAINT_SLOTS]u32 = @splat(0),
    paint_slot_water_key: [MAX_PAINT_SLOTS]?[]u8 = @splat(null),
    paint_slot_depths: [MAX_PAINT_SLOTS]?[]f32 = @splat(null),
    paint_slot_surface: [MAX_PAINT_SLOTS]?[]f32 = @splat(null),
    paint_drop_warned: bool = false,
    paint_hover: ?[3]f32 = null,
    paint_stroking: bool = false,
    paint_last_x: f32 = 0,
    paint_last_y: f32 = 0,
    paint_last_w: f32 = 0,
    paint_last_h: f32 = 0,

    pub fn create(allocator: std.mem.Allocator, path: []const u8, store_dir: []const u8, node_id: u32) !*Runtime {
        const self = try allocator.create(Runtime);
        errdefer allocator.destroy(self);
        try self.initInPlace(allocator, path, store_dir, node_id);
        return self;
    }

    pub fn destroy(self: *Runtime) void {
        const allocator = self.allocator;
        self.deinit();
        allocator.destroy(self);
    }

    const runtime_lifecycle = @import("runtime_lifecycle.zig");
    pub const initInPlace = runtime_lifecycle.initInPlace;
    const ensureMaterials = runtime_lifecycle.ensureMaterials;
    pub const deinit = runtime_lifecycle.deinit;

    const runtime_live_scene = @import("runtime_live_scene.zig");
    const meshPropTexKey = runtime_live_scene.meshPropTexKey;
    const appendMeshPropNode = runtime_live_scene.appendMeshPropNode;
    const ensureMeshHashMap = runtime_live_scene.ensureMeshHashMap;
    const meshForHash = runtime_live_scene.meshForHash;
    const liveSlotKey = runtime_live_scene.liveSlotKey;
    const liveCookedDoorIndex = runtime_live_scene.liveCookedDoorIndex;
    const appendLiveMeshRef = runtime_live_scene.appendLiveMeshRef;
    const applyResidentMeshes = runtime_live_scene.applyResidentMeshes;
    const ensureLiveMaterials = runtime_live_scene.ensureLiveMaterials;
    const setBakedRangeVisible = runtime_live_scene.setBakedRangeVisible;
    const rowScaleBase = runtime_live_scene.rowScaleBase;
    const pointInAnyEraseRect = runtime_live_scene.pointInAnyEraseRect;
    const collapseRowsInRects = runtime_live_scene.collapseRowsInRects;
    const applyDirtyErase = runtime_live_scene.applyDirtyErase;
    const collapseWallRows = runtime_live_scene.collapseWallRows;
    const applyWallHide = runtime_live_scene.applyWallHide;
    const appendLiveSkinBoxes = runtime_live_scene.appendLiveSkinBoxes;
    const applyLiveMeshProps = runtime_live_scene.applyLiveMeshProps;

    const scene_build = @import("scene_build.zig");
    const build = scene_build.build;

    const runtime_stream = @import("runtime_stream.zig");
    const setupStreaming = runtime_stream.setupStreaming;
    const refreshNpcNodes = runtime_stream.refreshNpcNodes;
    const refreshStreamNodes = runtime_stream.refreshStreamNodes;
    const pollStandaloneEvents = runtime_stream.pollStandaloneEvents;
    pub const mouseLook = runtime_stream.mouseLook;
    pub const setAiming = runtime_stream.setAiming;
    const emitRowCollider = runtime_stream.emitRowCollider;
    const emitWindowRing = runtime_stream.emitWindowRing;
    const emitMeshPropColliders = runtime_stream.emitMeshPropColliders;
    const rebuildWindow = runtime_stream.rebuildWindow;
    const cameraColliderSet = runtime_stream.cameraColliderSet;
    pub const stepNow = runtime_stream.stepNow;

    const runtime_dynamics = @import("runtime_dynamics.zig");
    const updateDynamicPropNodes = runtime_dynamics.updateDynamicPropNodes;
    const stepTickers = runtime_dynamics.stepTickers;
    const stepTraffic = runtime_dynamics.stepTraffic;
    const stepElevators = runtime_dynamics.stepElevators;
    const toggleDoor = runtime_dynamics.toggleDoor;
    const toggleCookedDoor = runtime_dynamics.toggleCookedDoor;
    const toggleLiveCookedDoor = runtime_dynamics.toggleLiveCookedDoor;
    const applyCookedDoorPose = runtime_dynamics.applyCookedDoorPose;
    const stepCookedDoor = runtime_dynamics.stepCookedDoor;
    const stepCookedDoors = runtime_dynamics.stepCookedDoors;

    const runtime_interaction = @import("runtime_interaction.zig");
    const interactReachBlockedExceptRect = runtime_interaction.interactReachBlockedExceptRect;
    const interactReachBlocked = runtime_interaction.interactReachBlocked;
    const cookedDoorReachBlocked = runtime_interaction.cookedDoorReachBlocked;
    const stepInteract = runtime_interaction.stepInteract;
    const drawHud = runtime_interaction.drawHud;

    pub fn sceneNodeForFrame(self: *Runtime) *Node {
        self.stepNow();
        return &self.root;
    }

    pub fn statusAlloc(self: *const Runtime, allocator: std.mem.Allocator) ![]u8 {
        if (self.stream) |*w| {
            return std.fmt.allocPrint(
                allocator,
                "loaded {d} instances ({d} pieces), {d} player mesh groups; streaming {d}x{d} grid ({d} occupied), lod {d} rows, {d} draws",
                .{ self.inst_count, self.piece_count, self.scene.player_model.len, w.cols, w.rows, w.stats.occupied_chunks, w.stats.lod_rows, self.stream_draw_count },
            );
        }
        return std.fmt.allocPrint(
            allocator,
            "loaded {d} instances ({d} pieces), {d} player mesh groups",
            .{ self.inst_count, self.piece_count, self.scene.player_model.len },
        );
    }
};
