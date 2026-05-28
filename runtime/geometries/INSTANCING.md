# GPU instanced draw (task 7, second half)

The ship-once-per-key dedup (commit `1f92252ec`) realized the **bridge-cost flyweight**:
one vertex payload per unique key crosses V8→Zig, regardless of instance count. That
took 500-coconut bridge cost from O(N·verts) to O(verts).

What's still per-N: the **draw call** itself. `drawScene` still calls `drawMesh` once
per child; each issues `setVertexBuffer` + `setBindGroup` + `pass.draw(vert_count, 1, …)`.
For a scene with N coconuts of the same shape + texture, that's N draw calls + N per-mesh
uniform writes. The win this design closes: collapse to **1 instanced draw call** per
unique (`geom_key`, texture) group, with per-instance transform + color riding in a
per-instance vertex buffer.

## Why deferred (and what unblocks it)

This is a real GPU pipeline rewrite — shader, pipeline state, bind group layout, and
`drawScene` all move. The failure mode is **silent visual corruption** (wrong matrix
math, wrong attribute layout, wrong bind-group binding → ships clean, renders wrong)
and I can't eyeball the result without a display. Mismatching WGSL std140 alignment
or per-instance attribute offsets by 4 bytes will compile and ship a binary that
draws garbage. The right way to land this is a session with the user able to run
each verification step.

**Unblocks when:** the dev host (`./scripts/dev`) is up and a 3D cart is loaded so
the migration can be eyeballed step-by-step.

## Design (concrete enough to land)

### Shader contract change (`framework/gpu/shaders.zig` `scene3d_wgsl`)

Split today's per-mesh `SceneUniforms` into:

- **scene-wide uniforms** (set ONCE per frame, no dynamic offset): `vp`,
  `light_dir`, `specular_power`, `light_color`, `ambient_color`, `camera_pos`,
  `fog_color`, `fog_near`, `fog_far`. The current `mvp` and `model` go away;
  `mvp = vp * inst.model` is computed in the vertex shader.
- **per-instance vertex attributes** (`step_mode = .instance`, vertex buffer 1):
  `model: mat4x4f` (4 vec4 attrs at locations 3–6) + `color: vec4f` (location 7).
  80 bytes per instance.

```wgsl
@group(0) @binding(0) var<uniform> S: SceneUniforms;   // scene-wide (no dyn offset)
@group(1) @binding(0) var diffuse_tex: texture_2d<f32>;
@group(1) @binding(1) var diffuse_smp: sampler;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  // per-instance (step=instance)
  @location(3) model_c0: vec4f,
  @location(4) model_c1: vec4f,
  @location(5) model_c2: vec4f,
  @location(6) model_c3: vec4f,
  @location(7) inst_color: vec4f,
}

@vertex fn vs_main(in: VertexInput) -> VertexOutput {
  let model = mat4x4f(in.model_c0, in.model_c1, in.model_c2, in.model_c3);
  let world = model * vec4f(in.position, 1.0);
  // ...mvp = S.vp * world, world_normal = (model * vec4(normal,0)).xyz, etc.
  // pass inst_color through to fragment for the existing u.color use.
}
```

### Pipeline state (`3d.zig` `init`)

- Drop `has_dynamic_offset = 1` from the scene uniform bind group entry; resize the
  uniform buffer to one `SceneUniforms` (no `MAX_DRAW_UNIFORMS × UNIFORM_STRIDE`).
- Add a second vertex buffer to the pipeline's `vertex.buffers` with:
  - `array_stride = 80`, `step_mode = .instance`
  - 5 attributes: 4 `float32x4` for model columns (locations 3–6, offsets 0/16/32/48)
    + 1 `float32x4` for color (location 7, offset 64).
- New `g_instance_buf: ?*wgpu.Buffer` sized `MAX_INSTANCES * 80` (e.g. 8192 × 80 = 640 KB).

### `drawScene` rewrite

Replace the per-child `drawMesh(...)` loop with:

```
1. Set scene bind group (scene uniforms) ONCE — no per-mesh writes.
2. Build groups: for each mesh child, compute (geom_key, texture_signature).
   - geom_key is direct from spec.
   - texture_signature: tex_key if set, else hash(tex_w, tex_h, tex_rgba), else "default".
3. For each group:
   a. Look up the retained geometry slice for geom_key (lookupGeometry).
      Skip group if missing (legacy/no-verts edge cases).
   b. Resolve the texture bind group (existing logic).
   c. Build per-instance bytes: for each child in the group, write a 80-byte record
      (model matrix as 4 vec4, color as vec4) into g_instance_buf at the group's
      cumulative byte offset.
   d. queue.writeBuffer(g_instance_buf, group_offset, ..., group_bytes).
   e. setVertexBuffer(0, g_retained_vbuf, geo_offset, geo_bytes).
   f. setVertexBuffer(1, g_instance_buf, group_offset, group_bytes).
   g. setBindGroup(1, texture_bind_group).
   h. pass.draw(geo_count, group.instance_count, 0, 0).
```

The MeshSpec / buildMeshSpec stays the same; only the per-mesh draw is replaced
with per-group instanced draw.

`drawMesh` either inlines into drawScene's per-group block or stays as a private
helper that draws a single-instance group (legacy fallback).

### Verification gate

Ship-clean is necessary but not sufficient. Before merging, eyeball:

1. **skybox_demo** — ground box + N spheres + N cylinders + N city boxes. Watch for
   wrong-positioned, wrong-colored, or invisible meshes (instance attribute or
   matrix bug). Eyes should be on the sphere-on-ground row.
2. **geometry_demo** — hand shapes (Pyramid/Octa/Prism) must render solid and at
   their correct positions; RandomBlob's reroll button still produces visibly
   different shapes each press.
3. **billboard_demo** — registry + textureKey path; the live screen and the FX
   shader should both still paint onto their rocking boxes.
4. **camera_lab** (the camera session's demo) — the character mesh: head sphere,
   neck cylinder, hat cone, eye boxes, nose cone must all render solid in their
   correct relative positions.

Any of those failing in a way that wasn't there before this change = stop, diff
the shader and the per-instance attribute layout (8-byte mistakes are typical).

## Compatibility with what's already done

The retained intern cache and ship-once-per-key dedup don't change shape:
`lookupGeometry(key)` returns the same `(offset, count)` slice the instanced draw
needs. The build-time bake seed (`_baked.generated.ts`) is also a producer for the
same cache. All three (runtime intern, dedup, bake) keep working — instancing just
changes how draws are issued, not how geometry is registered.
