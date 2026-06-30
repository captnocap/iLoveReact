// modelview — pick (or drop) a .glb/.obj, view it. Crisp, butter-smooth, native.
//
// The whole point of this cart is what it DOESN'T do: it never ships geometry across
// the JS bridge and never re-renders to move the camera. The chosen file is parsed
// ENTIRELY in the host (framework/world/mesh_import.zig via __mesh_load_file), uploaded
// to the GPU once, and handed back as a short intern key. The <Scene3D.Mesh hostKey>
// node carries only that key — the host redraws the resident mesh every frame. The
// camera is the host's orbit camera (<Scene3D.Camera orbit>): drag and wheel feed raw
// deltas straight to gpu/3d.zig (__model_orbit_drag/zoom), which repaints WITHOUT a
// React render. So no matter how heavy the model, orbiting stays smooth — React does
// exactly one render per file load and nothing per frame.
//
// A file is chosen with the native OS picker (the shared runtime pickFile — the same
// zenity dialog the Studio import uses), or by dropping it on the window.
//
// Verify headless: `./tools/rjit shot modelview` renders the empty prompt; open a real
// model under `./tools/rjit dev modelview`, or `RJIT_MODEL=path ./tools/rjit shot
// modelview` to render one headlessly.
import { useState, useRef, useEffect } from 'react';
import { Box, Col, Row, Text, Pressable, Scene3D } from '@reactjit/runtime/primitives';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { pickFile } from '@reactjit/runtime/hooks/pickFile';
import { useModifiers } from '@reactjit/runtime/hooks/useModifiers';
import { callHost } from '@reactjit/runtime/ffi';

const host = globalThis as any;

type Loaded = { key: string; count: number; radius: number; name: string };

/** Parse a dropped file in the host and get back its intern key + stats. Returns null
 *  if the door is missing (non-V8 host) or the file failed to parse. */
function loadModelFile(path: string): Loaded | null {
  const fn = host.__mesh_load_file;
  if (typeof fn !== 'function') return null;
  const json = fn(path);
  if (typeof json !== 'string' || json.length === 0) return null;
  try {
    const o = JSON.parse(json);
    if (!o || typeof o.key !== 'string') return null;
    const name = path.split('/').pop() || path;
    return { key: o.key, count: o.count | 0, radius: o.radius || 1, name };
  } catch {
    return null;
  }
}

const orbitDrag = (dx: number, dy: number) => host.__model_orbit_drag?.(dx, dy);
const orbitZoom = (delta: number) => host.__model_orbit_zoom?.(delta);

export default function ModelView() {
  const [model, setModel] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wire, setWire] = useState(false);

  // Drag state lives in refs, NOT useState: orbiting must not trigger a React render
  // (the host repaints itself off __model_orbit_drag). A re-render per mouse-move is
  // exactly the choppiness this design exists to avoid.
  const draggingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  // W toggles wireframe — the standard mesh-editor reflex.
  useModifiers({ w: () => setWire((v) => !v), W: () => setWire((v) => !v) });

  // One load path for every source (picker, drop, CLI): validate the extension, hand
  // the path to the host parser, and surface a clean error if it can't be read.
  const applyPath = (path: string) => {
    // .gltf is intentionally NOT accepted: it's JSON with an external .bin, while the
    // host parser reads the self-contained binary .glb container.
    const ext = path.toLowerCase();
    if (!(ext.endsWith('.glb') || ext.endsWith('.obj'))) {
      setError('Unsupported file — pick a .glb or .obj');
      return;
    }
    const loaded = loadModelFile(path);
    if (loaded) {
      setModel(loaded);
      setError(null);
    } else {
      setError(`Could not load ${path.split('/').pop()}`);
    }
  };

  // Open the native OS file picker (zenity, via the shared runtime pickFile). Async —
  // the dialog runs in a subprocess and resolves with the chosen path, or null on
  // cancel. This is the primary way in; drag-drop below is a bonus.
  const chooseModel = async () => {
    const path = await pickFile({
      title: 'Open a 3D model',
      filters: [
        { name: '3D models', patterns: ['*.glb', '*.obj'] },
        { name: 'All files', patterns: ['*'] },
      ],
    });
    if (path) applyPath(path);
  };

  // Open-from-CLI: `RJIT_MODEL=path/to/file.glb ./zig-out/bin/modelview` loads a model
  // at boot (no picker needed). Also the headless self-shot path —
  // `RJIT_MODEL=... ./tools/rjit shot modelview` renders the loaded model.
  useEffect(() => {
    const path = callHost<string | null>('__env_get', null, 'RJIT_MODEL');
    if (path) applyPath(path);
    // RJIT_WIRE=1 boots in wireframe mode — the headless self-shot path for it.
    if (callHost<string | null>('__env_get', null, 'RJIT_WIRE')) setWire(true);
    // RJIT_ZOOM=N dollies the camera in N notches at boot — the headless way to prove
    // the wireframe stays locked to the surface when you get in close.
    const zoom = Number(callHost<string | null>('__env_get', null, 'RJIT_ZOOM') ?? 0);
    for (let i = 0; i < zoom; i += 1) orbitZoom(1);
  }, []);

  useFileDrop(applyPath);

  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#0b0d12' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0b0d12" showAxes={false} wireframe={wire}>
        {/* The host owns this camera: position comes from orbit state seeded by the
            load door and driven by the overlay's drag/wheel — never from props here. */}
        <Scene3D.Camera orbit fov={50} />
        {/* A clean object-viewer wants no distance fade. */}
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#6b7488" intensity={1.0} />
        <Scene3D.DirectionalLight direction={[-0.5, -0.9, -0.4]} color="#ffffff" intensity={1.7} />
        {model && <Scene3D.Mesh hostKey={model.key} material="#c2c8d2" />}
      </Scene3D>

      {/* Invisible full-window input layer: orbits on drag, dollies on wheel. It feeds
          host doors directly and keeps NO React state, so a drag never re-renders. */}
      <Pressable
        onMouseDown={(p: any) => {
          draggingRef.current = true;
          lastRef.current = { x: p?.x ?? 0, y: p?.y ?? 0 };
        }}
        onMouseMove={(p: any) => {
          if (!draggingRef.current || !lastRef.current) return;
          const x = p?.x ?? 0;
          const y = p?.y ?? 0;
          orbitDrag(x - lastRef.current.x, y - lastRef.current.y);
          lastRef.current = { x, y };
        }}
        onMouseUp={() => {
          draggingRef.current = false;
          lastRef.current = null;
        }}
        onMouseLeave={() => {
          draggingRef.current = false;
          lastRef.current = null;
        }}
        onScroll={(e: any) => orbitZoom(e?.deltaY ?? 0)}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.001)' }}
      />

      {/* Title strip — only changes on load, so this render is the one-and-only. */}
      <Row
        style={{
          position: 'absolute', left: 0, top: 0, right: 0, height: 34,
          alignItems: 'center', paddingLeft: 14, paddingRight: 14,
          backgroundColor: 'rgba(12,14,20,0.72)', borderBottomWidth: 1, borderColor: '#1d2330',
        }}
      >
        <Text style={{ color: '#e8edf6', fontSize: 13, fontWeight: 600 }}>
          {model ? model.name : 'Model Viewer'}
        </Text>
        {model && (
          <Text style={{ color: '#7d899c', fontSize: 12, marginLeft: 12 }}>
            {`${(model.count / 3).toLocaleString()} tris · drag to orbit · scroll to zoom`}
          </Text>
        )}
        <Box style={{ flexGrow: 1 }} />
        {model && (
          <Pressable
            onPress={() => setWire((w) => !w)}
            tooltip="Toggle wireframe (W)"
            style={{
              marginRight: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
              backgroundColor: wire ? '#2a466e' : '#16233aee', borderWidth: 1, borderColor: wire ? '#5a86c0' : '#2c4a6a',
            }}
          >
            <Text style={{ color: wire ? '#eaf2ff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Wireframe</Text>
          </Pressable>
        )}
        <Pressable
          onPress={chooseModel}
          style={{
            paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
            backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a',
          }}
        >
          <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Open…</Text>
        </Pressable>
      </Row>

      {/* Center prompt until something is loaded. */}
      {!model && (
        <Col style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#9aa6ba', fontSize: 22, fontWeight: 600 }}>Open a model to view</Text>
          <Text style={{ color: '#5d6878', fontSize: 14, marginTop: 8 }}>.glb · .obj — parsed and rendered entirely in the host</Text>
          <Pressable
            onPress={chooseModel}
            style={{
              marginTop: 22, paddingLeft: 22, paddingRight: 22, paddingTop: 11, paddingBottom: 11, borderRadius: 8,
              backgroundColor: '#1d3a5fee', borderWidth: 1, borderColor: '#3a5f8a',
            }}
          >
            <Text style={{ color: '#e6f0fb', fontSize: 15, fontWeight: 600 }}>Choose a model…</Text>
          </Pressable>
          <Text style={{ color: '#465162', fontSize: 12, marginTop: 14 }}>…or drop a file anywhere</Text>
          {error && <Text style={{ color: '#e2706a', fontSize: 13, marginTop: 16 }}>{error}</Text>}
        </Col>
      )}
    </Box>
  );
}
