// light_demo — the first placed lights (req_2032). A deliberately DIM scene (low
// ambient, no sun) so the only real illumination is two placed lights:
//   • a warm omni PointLight (a "bulb") hovering over the floor → a round pool
//   • a cool SpotLight (the user's pyramid) aimed down at an angle → a cone splash
// Both are colored; this proves the framework light path end to end. `rjit shot
// light_demo` renders it headless. Next phases: author these in Studio + bake to
// the compiled world.
import { Box, Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';

function Pillar(props: { x: number; z: number; h: number }) {
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: 1.2, height: props.h, depth: 1.2 }}
      material="#cfcfcf"
      position={[props.x, props.h / 2, props.z]}
    />
  );
}

export default function LightDemo() {
  return (
    <Box style={{ width: '100%', height: '100%' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#05060a" showAxes={false}>
        <Scene3D.Camera position={[0, 11, 18]} target={[0, 1, 0]} fov={56} far={2000} />
        <Scene3D.Fog enabled={false} />
        {/* Dim fill so the scene isn't black, but the placed lights dominate. */}
        <Scene3D.AmbientLight color="#222633" intensity={1.0} />

        {/* Floor */}
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 40, height: 1, depth: 40 }} material="#9a9aa2" position={[0, -0.5, 0]} />

        {/* One upright standing in the spotlight's path → it throws a long shadow
            across the lit floor toward the camera/left. */}
        <Pillar x={2} z={0} h={5} />
        <Pillar x={-5} z={-3} h={3} />

        {/* Warm bulb over the floor (left) → round pool, no shadow caster of note. */}
        <Scene3D.PointLight position={[-5, 4, 4]} color="#ffb55a" intensity={2.6} range={13} />

        {/* Cool spotlight from the right, raking low across the floor so the center
            pillar casts a clear shadow. This spot owns the shadow map (castsShadow
            defaults on). */}
        <Scene3D.SpotLight position={[9, 7, 1]} direction={[-1, -0.7, -0.15]} color="#cfe2ff" intensity={4.5} cone={34} range={26} />
      </Scene3D>
    </Box>
  );
}
