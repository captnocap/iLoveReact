// sdf_roundtrip_lab — Stage 0 of the SDF-skeleton decision spike (USER ASK req_2604).
//
// THE DECISION SURFACE. Bake a model through a signed-distance field and back with
//   tools/v8cli scripts/sdf-roundtrip.js <model> --grid 64,128,256 --name <name>
// then flip between the ORIGINAL and each resolution's re-mesh — ONE at a time —
// under the host's own orbit camera. If the field can't hold the model's character,
// path A (surface-is-the-field, animate bones only) is dead and we commit to path B
// (keep the mesh, SDF only drives smooth skin weights). If it holds, A is live.
//
// WHY ONE AT A TIME: arbitrary imported meshes render through the host's resident
// `hostKey` path — the single-model drop-to-view viewer (framework/gpu/3d.zig). It
// shows ONE model under a native orbit camera auto-framed by __mesh_load_file, and
// ignores a declarative <Scene3D.Camera position>. So we load the selected variant
// and let the host frame it; the buttons swap which one is resident.
//
// Headless self-capture (SELFSHOT — never desktop capture):
//   ./tools/rjit shot sdf_roundtrip_lab --out /tmp/rt.png            (original)
//   ./tools/rjit shot sdf_roundtrip_lab --route /v/128 --out ...     (a bake; see routes)
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/runtime/primitives';
import { busOn } from '@reactjit/hooks/useIFTTT';

const NAME = 'girl';
const DIR = 'cart/editor/data/models/roundtrip/' + NAME;
const VARIANTS = [
  { label: 'original', path: DIR + '/' + NAME + '_original.obj' },
  { label: '64³', path: DIR + '/' + NAME + '_64.obj' },
  { label: '128³', path: DIR + '/' + NAME + '_128.obj' },
  { label: '256³', path: DIR + '/' + NAME + '_256.obj' },
  // bake-high-then-decimate: 256³ (93k) collapsed to 64³'s budget (6.7k) — same tri
  // count as raw 64³, but should carry detail the raw grid never sampled.
  { label: '256→6.7k', path: 'cart/editor/data/models/roundtrip/girl_d256/girl_d256_256.obj' },
];

type Loaded = { key: string; count: number; radius: number };
const host = globalThis as any;

export default function SdfRoundtripLab() {
  const [sel, setSel] = useState(4); // default to the decimated variant for headless verification; flip freely live
  const draggingRef = useRef(false);

  // Load ONLY the selected variant into the host, seeding its orbit framing.
  const cur = useMemo<Loaded | null>(() => {
    const fn = host.__mesh_load_file;
    if (typeof fn !== 'function') return null;
    const json = fn(VARIANTS[sel].path);
    if (typeof json !== 'string' || json.length === 0) return null;
    try {
      const o = JSON.parse(json);
      return o && typeof o.key === 'string' ? { key: o.key, count: o.count | 0, radius: o.radius || 1 } : null;
    } catch { return null; }
  }, [sel]);

  // drag → host orbit; wheel → host zoom (the resident viewer owns the camera)
  useEffect(() => busOn('system:cursor:move', (e: any) => {
    if (!draggingRef.current) return;
    host.__model_orbit_drag?.(Number(e?.dx ?? 0), Number(e?.dy ?? 0));
  }), []);

  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#0b0e14' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0b0e14" showAxes={false}>
        {/* host drop-to-view orbit camera: auto-frames the model __mesh_load_file seeded */}
        <Scene3D.Camera orbit />
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.85} />
        <Scene3D.DirectionalLight direction={[0.3, 0.7, 1.0]} color="#ffffff" intensity={1.0} />
        <Scene3D.DirectionalLight direction={[-0.6, 0.4, -0.8]} color="#cfe0ff" intensity={0.55} />
        <Scene3D.DirectionalLight direction={[0.2, -0.6, 0.5]} color="#ffffff" intensity={0.4} />
        {cur ? <Scene3D.Mesh hostKey={cur.key} material="#e8e2d8" /> : null}
      </Scene3D>

      {/* drag-to-orbit / wheel-zoom input layer */}
      <Pressable
        onMouseDown={() => { draggingRef.current = true; }}
        onMouseUp={() => { draggingRef.current = false; }}
        onScroll={(p: any) => host.__model_orbit_zoom?.(Number(p?.deltaY ?? 0))}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000000' }}
      />

      {/* variant selector — load one at a time */}
      <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, height: 36, flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 12, backgroundColor: '#0d1119dd' }}>
        <Text fontSize={11} color="#e2e8f0" style={{ fontFamily: 'monospace', fontWeight: 700 }}>{`SDF round-trip — ${NAME}`}</Text>
        <Box style={{ width: 14 }} />
        {VARIANTS.map((v, i) => (
          <Pressable key={v.label} onPress={() => setSel(i)}
            style={{ marginRight: 6, paddingLeft: 11, paddingRight: 11, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: i === sel ? '#38bdf8' : '#2b3444', backgroundColor: i === sel ? '#0e3550' : '#161c28' }}>
            <Text fontSize={11} color={i === sel ? '#bae6fd' : '#9aa7bd'} style={{ fontFamily: 'monospace' }}>{v.label}</Text>
          </Pressable>
        ))}
      </Box>

      <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace', position: 'absolute', right: 12, top: 46 }}>
        {cur ? `${(cur.count / 3 | 0).toLocaleString()} tris · r=${cur.radius.toFixed(2)}` : 'not loaded'}
      </Text>
      <Text fontSize={9} color="#46566f" style={{ fontFamily: 'monospace', position: 'absolute', left: 12, bottom: 8 }}>
        drag orbit · scroll zoom · flip variants to A/B the field round-trip
      </Text>
    </Box>
  );
}
