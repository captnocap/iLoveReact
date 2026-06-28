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

        {/* A few uprights to catch the light from the side. */}
        <Pillar x={-4} z={-2} h={4} />
        <Pillar x={4} z={-2} h={4} />
        <Pillar x={0} z={3} h={2.5} />

        {/* Warm bulb over the floor → round pool of light. */}
        <Scene3D.PointLight position={[-4, 4, 3]} color="#ffb55a" intensity={3.0} range={14} />

        {/* Cool spotlight aimed down at an angle → a cone splash. */}
        <Scene3D.SpotLight position={[5, 8, 4]} direction={[-0.5, -1, -0.4]} color="#5ab0ff" intensity={4.0} cone={28} range={22} />
      </Scene3D>
    </Box>
  );
}
