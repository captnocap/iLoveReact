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
import { Box, Col, Row, Text, Pressable, Slider, Scene3D } from '@reactjit/runtime/primitives';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { pickFile } from '@reactjit/runtime/hooks/pickFile';
import { useModifiers, currentModifiers } from '@reactjit/runtime/hooks/useModifiers';
import { callHost } from '@reactjit/runtime/ffi';
import {
  loadLedger, putEntry, recordImport, exportCredits, pendingCount,
  AttributionPanel, AttributionStatusBadge, type Attribution, type Ledger,
} from '@reactjit/runtime/attribution';

const host = globalThis as any;

type Loaded = { key: string; count: number; radius: number; name: string };

/** sha256 of the file bytes (host door) — keys attribution to the content. */
const fileSha = (path: string): string => {
  const s = host.__file_sha256?.(path);
  return typeof s === 'string' ? s : '';
};

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
// Pan the orbit PIVOT in the screen plane (the Focus tool), and recentre it on the
// point under the cursor (double-click) — so a far corner of a big model becomes the
// centre of rotation without camera gymnastics. Both feed the host; no React render.
const orbitPan = (dx: number, dy: number) => host.__model_orbit_pan?.(dx, dy);
const focusAt = (x: number, y: number): boolean => host.__model_focus_at?.(x, y) === 1;

// ── Host-native mesh selection (the editor surface) ──────────────────────────────
// Mode: 0 = view/orbit, 1 = vertex, 2 = edge, 3 = face. Selection state lives in the
// host (welded topology + sets); the cart only sets the mode and forwards clicks.
type SelInfo = { mode: number; verts: number; edges: number; sel: number };
const meshSetMode = (m: number) => host.__mesh_edit_mode?.(m);
const meshPick = (x: number, y: number, additive: boolean): number =>
  (host.__mesh_edit_pick?.(x, y, additive ? 1 : 0) as number) ?? -1;
const meshClearSel = () => host.__mesh_edit_clear?.();
// Snapshot before an instant press-pick; revert if the press turns into an orbit-drag.
const meshSnapshot = () => host.__mesh_edit_snapshot?.();
const meshRevert = () => host.__mesh_edit_revert?.();
const readSelInfo = (): SelInfo | null => {
  try {
    const j = host.__mesh_edit_counts?.();
    return typeof j === 'string' && j ? (JSON.parse(j) as SelInfo) : null;
  } catch {
    return null;
  }
};
const SEL_MODES = ['Object', 'Vertex', 'Edge', 'Face'];
// Re-decimate the model to clustering resolution `grid` (8..256, higher = more detail)
// and return the new {key,count}, or null. The host re-meshes from the retained full-res
// source — nothing but the key + count crosses the bridge.
function setModelQuality(grid: number): { key: string; count: number } | null {
  const json = host.__model_set_quality?.(grid);
  if (typeof json !== 'string' || !json) return null;
  try {
    const o = JSON.parse(json);
    return typeof o?.key === 'string' ? { key: o.key, count: o.count | 0 } : null;
  } catch {
    return null;
  }
}
// Slider position 0..1 → clustering grid. Squared so the low end (coarse "just the
// shape") gets fine control, which is where the game LoD lives. Quantized to a fixed
// set of levels so scrubbing the slider can't intern an unbounded number of distinct
// meshes into the retained GPU buffer — revisiting a level reuses its resident mesh.
const QUALITY_STEPS = 20;
const qualityToGrid = (q: number) => {
  const snapped = Math.round(q * QUALITY_STEPS) / QUALITY_STEPS;
  return Math.round(8 + snapped * snapped * 248);
};
// Paint the face under viewport pixel (x,y) — the host raycasts the resident mesh and
// colours exactly the face hit. No verts or UVs cross the bridge.
const paintAt = (x: number, y: number, rgb: RGB) => host.__model_paint_at?.(x, y, rgb[0], rgb[1], rgb[2]) === 1;

type RGB = [number, number, number];
// A small fixed palette — this is for colouring faces, not a full art package.
const PALETTE: RGB[] = [
  [222, 70, 64], [238, 142, 48], [240, 206, 74], [112, 196, 96],
  [66, 158, 226], [126, 112, 222], [226, 120, 196], [244, 244, 248],
  [126, 134, 150], [26, 28, 36],
];
const rgbCss = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;

export default function ModelView() {
  const [model, setModel] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wire, setWire] = useState(false);
  const [paintMode, setPaintMode] = useState(false);
  const [focusMode, setFocusMode] = useState(false); // Focus tool: drag pans the pivot
  const [selMode, setSelMode] = useState(0); // 0 view · 1 vertex · 2 edge · 3 face
  const [selInfo, setSelInfo] = useState<SelInfo>({ mode: 0, verts: 0, edges: 0, sel: 0 });
  const [color, setColor] = useState<RGB>(PALETTE[0]);
  const [quality, setQuality] = useState(1); // slider 0..1; 1 = full detail on load
  // Attribution: the shared ledger + the current model's entry + the panel toggle.
  const [ledger, setLedger] = useState<Ledger>(() => loadLedger());
  const [attribution, setAttribution] = useState<Attribution | null>(null);
  const [attrOpen, setAttrOpen] = useState(false);

  // Record (or fetch) the attribution for a just-loaded file, keyed by its content sha.
  const recordAttribution = (path: string) => {
    const sha = fileSha(path);
    if (!sha) { setAttribution(null); return; }
    const next = { ...ledger };
    const entry = recordImport(sha, path, next);
    setLedger(next);
    setAttribution(entry);
    if (entry.status === 'pending') setAttrOpen(true); // surface the obligation immediately
  };

  const saveAttribution = (patch: Pick<Attribution, 'title' | 'author' | 'source' | 'license'>) => {
    if (!attribution) return;
    const next = { ...ledger };
    const saved = putEntry(next, { ...attribution, ...patch });
    setLedger(next);
    setAttribution(saved);
  };

  const doExportCredits = () => {
    const r = exportCredits(ledger);
    setError(r.ok
      ? (r.pending > 0 ? `Credits exported — ⚠ ${r.pending} asset(s) still need attribution` : 'Credits exported ✓')
      : 'Could not write credits file');
  };

  // Apply a new quality (slider 0..1): re-decimate in the host and swap the resident
  // mesh. Repainting resets (the topology changed) — quality is a pre-paint step.
  const applyQuality = (q: number) => {
    setQuality(q);
    const r = setModelQuality(qualityToGrid(q));
    if (r) {
      setModel((m) => (m ? { ...m, key: r.key, count: r.count } : m));
      setSelInfo({ mode: selMode, verts: 0, edges: 0, sel: 0 }); // host re-meshed → selection cleared
    }
  };

  // Drag state lives in refs, NOT useState: orbiting/painting must not trigger a React
  // render (the host repaints itself off the doors). A re-render per mouse-move is
  // exactly the choppiness this design exists to avoid.
  const draggingRef = useRef(false);
  const paintingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  // Double-click detection lives in JS (the host input layer has no dblclick event):
  // two quick clicks on the same spot recentre the orbit focus there.
  const lastClickRef = useRef<{ t: number; x: number; y: number } | null>(null);
  // Click-vs-drag for select modes: a press that doesn't move past a few px is a pick;
  // a moving press orbits (you rotate the view while selecting). Down pos is the pick pos.
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);

  // Switch tool: selecting a mesh mode (or going back to view) is the active tool, so it
  // turns off Paint/Focus, and pushes the mode to the host. Mode 0 = plain view/orbit.
  const chooseSelMode = (m: number) => {
    setSelMode(m);
    setPaintMode(false);
    setFocusMode(false);
    if (m === 1 || m === 2) setWire(true); // show topology where you're clicking verts/edges
    meshSetMode(m);
    setSelInfo(readSelInfo() ?? { mode: m, verts: 0, edges: 0, sel: 0 });
  };
  // Paint and Focus are tools too — turning one on drops the mesh-select mode back to view
  // so only one tool owns the drag at a time.
  const togglePaint = () => setPaintMode((v) => { const nv = !v; if (nv) { setFocusMode(false); setSelMode(0); meshSetMode(0); } return nv; });
  const toggleFocus = () => setFocusMode((v) => { const nv = !v; if (nv) { setPaintMode(false); setSelMode(0); meshSetMode(0); } return nv; });

  // W = wireframe, P = paint, F = focus, 1/2/3 = vertex/edge/face, Esc = clear/back to view.
  useModifiers({
    w: () => setWire((v) => !v), W: () => setWire((v) => !v),
    p: togglePaint, P: togglePaint,
    f: toggleFocus, F: toggleFocus,
    '1': () => chooseSelMode(1), '2': () => chooseSelMode(2), '3': () => chooseSelMode(3),
    Escape: () => { if (selMode !== 0) { meshClearSel(); setSelInfo(readSelInfo() ?? selInfo); } },
  });

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
      setQuality(1); // a fresh model loads full-res
      setSelInfo({ mode: selMode, verts: 0, edges: 0, sel: 0 }); // new mesh → selection cleared
      recordAttribution(path); // account for where this asset came from
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
    // RJIT_PAINT=1 paints every face by index in a rainbow — the headless proof that
    // painting is per-face and independent (no congruent-face fusion). Each face shows
    // its OWN colour, which is exactly the bug the old UV-atlas dedup couldn't avoid.
    if (callHost<string | null>('__env_get', null, 'RJIT_PAINT')) {
      setPaintMode(true);
      const n = Number(host.__model_face_count?.() ?? 0);
      for (let f = 0; f < n; f += 1) {
        const c = PALETTE[f % PALETTE.length];
        host.__model_paint_face?.(f, c[0], c[1], c[2]);
      }
    }
    // RJIT_PAINTONE=1 paints exactly ONE face bright red — the proof that a single-face
    // change shows immediately (the content-hash texture cache used to drop it).
    if (callHost<string | null>('__env_get', null, 'RJIT_PAINTONE')) {
      setPaintMode(true);
      host.__model_paint_face?.(40, 230, 40, 40);
    }
    // RJIT_ATTRIB_EXPORT=1 writes CREDITS.md from the current ledger at boot — the
    // headless proof the credits export works (and reports pending obligations).
    if (callHost<string | null>('__env_get', null, 'RJIT_ATTRIB_EXPORT')) doExportCredits();
    // RJIT_QUALITY=grid re-decimates at boot — the headless proof the quality knob works.
    const q = Number(callHost<string | null>('__env_get', null, 'RJIT_QUALITY') ?? 0);
    if (q > 0) {
      const r = setModelQuality(q);
      if (r) setModel((m) => (m ? { ...m, key: r.key, count: r.count } : m));
    }
    // RJIT_QUALITYSTRESS=1 scrubs 30 distinct quality levels (>16 stash slots) then
    // settles — proof the stash no longer overflows and the model still draws (req_2137).
    if (callHost<string | null>('__env_get', null, 'RJIT_QUALITYSTRESS')) {
      let last: { key: string; count: number } | null = null;
      for (let g = 10; g < 40; g += 1) last = setModelQuality(g) ?? last;
      if (last) setModel((m) => (m ? { ...m, key: last!.key, count: last!.count } : m));
    }
    // RJIT_SELECTFACE=N selects face N (face mode) at boot — the headless proof that
    // selection HIGHLIGHTS show. Index select needs no camera, so it works pre-render.
    const sf = callHost<string | null>('__env_get', null, 'RJIT_SELECTFACE');
    if (sf != null) {
      host.__mesh_edit_select_face?.(Number(sf) || 0, 0);
      setSelMode(3);
      setSelInfo(readSelInfo() ?? { mode: 3, verts: 0, edges: 0, sel: 1 });
    }
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
        {/* White material: all colour comes from the host's per-face paint atlas
            (default grey until painted), so painted colours render true. */}
        {model && <Scene3D.Mesh hostKey={model.key} material="#ffffff" />}
      </Scene3D>

      {/* Invisible full-window input layer: orbits on drag, dollies on wheel. It feeds
          host doors directly and keeps NO React state, so a drag never re-renders. */}
      <Pressable
        onMouseDown={(p: any) => {
          const x = p?.x ?? 0;
          const y = p?.y ?? 0;
          if (paintMode) {
            // Click fills one face; holding + dragging paints the faces under the stroke.
            paintingRef.current = true;
            paintAt(x, y, color);
            return;
          }
          // Mesh select mode: pick on PRESS for paint-like immediacy. Snapshot first so a
          // press that becomes an orbit-drag can revert the pick (see onMouseMove). No
          // setState here — the highlight is a host repaint, instant and React-free.
          if (selMode !== 0 && !focusMode) {
            meshSnapshot();
            meshPick(x, y, currentModifiers().shift);
            downRef.current = { x, y };
            movedRef.current = false;
            draggingRef.current = true;
            lastRef.current = { x, y };
            return;
          }
          // View / Focus: double-click (same spot, fast) recentres the orbit pivot on the
          // point hit — the no-gymnastics way to put the focus on a far corner.
          const now = Date.now();
          const last = lastClickRef.current;
          if (last && now - last.t < 320 && Math.abs(x - last.x) < 6 && Math.abs(y - last.y) < 6) {
            focusAt(x, y);
            lastClickRef.current = null;
            draggingRef.current = false;
            return;
          }
          lastClickRef.current = { t: now, x, y };
          draggingRef.current = true;
          lastRef.current = { x, y };
        }}
        onMouseMove={(p: any) => {
          const x = p?.x ?? 0;
          const y = p?.y ?? 0;
          if (paintMode) {
            if (paintingRef.current) paintAt(x, y, color);
            return;
          }
          if (!draggingRef.current || !lastRef.current) return;
          // In select mode a press that travels past a few px is really an orbit: revert the
          // instant press-pick (once) so rotating the view doesn't change the selection.
          if (selMode !== 0 && !focusMode && downRef.current && !movedRef.current) {
            if (Math.abs(x - downRef.current.x) > 4 || Math.abs(y - downRef.current.y) > 4) {
              movedRef.current = true;
              meshRevert();
            }
          }
          // Focus tool pans the pivot; otherwise the drag orbits (even while selecting).
          if (focusMode) orbitPan(x - lastRef.current.x, y - lastRef.current.y);
          else orbitDrag(x - lastRef.current.x, y - lastRef.current.y);
          lastRef.current = { x, y };
        }}
        onMouseUp={() => {
          // The pick already happened on press; if it stayed a click (no drag), refresh the
          // count HUD now (one render, off the hot path — the highlight was already instant).
          if (selMode !== 0 && !focusMode && draggingRef.current && !movedRef.current) {
            setSelInfo(readSelInfo() ?? selInfo);
          }
          draggingRef.current = false;
          paintingRef.current = false;
          lastRef.current = null;
          downRef.current = null;
        }}
        onMouseLeave={() => {
          draggingRef.current = false;
          paintingRef.current = false;
          lastRef.current = null;
          downRef.current = null;
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
            {paintMode
              ? `${(model.count / 3).toLocaleString()} tris · click a face to fill · drag to paint`
              : focusMode
                ? `${(model.count / 3).toLocaleString()} tris · drag to pan focus · double-click to recenter`
                : selMode !== 0
                  ? `${SEL_MODES[selMode]} · ${selInfo.sel} selected · click to select · shift-click adds · drag to orbit`
                  : `${(model.count / 3).toLocaleString()} tris · drag to orbit · scroll to zoom · double-click to recenter`}
          </Text>
        )}
        <Box style={{ flexGrow: 1 }} />
        {model && attribution && (
          <Pressable
            onPress={() => setAttrOpen((v) => !v)}
            tooltip="Attribution & credits"
            style={{ marginRight: 8, flexDirection: 'row', alignItems: 'center' }}
          >
            <AttributionStatusBadge status={attribution.status} />
          </Pressable>
        )}
        {model && (
          <Pressable
            onPress={togglePaint}
            tooltip="Toggle paint mode (P)"
            style={{
              marginRight: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
              backgroundColor: paintMode ? '#2a466e' : '#16233aee', borderWidth: 1, borderColor: paintMode ? '#5a86c0' : '#2c4a6a',
            }}
          >
            <Text style={{ color: paintMode ? '#eaf2ff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Paint</Text>
          </Pressable>
        )}
        {model && (
          <Pressable
            onPress={toggleFocus}
            tooltip="Focus tool (F) — drag to move the pivot; double-click the model to recenter"
            style={{
              marginRight: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
              backgroundColor: focusMode ? '#2a466e' : '#16233aee', borderWidth: 1, borderColor: focusMode ? '#5a86c0' : '#2c4a6a',
            }}
          >
            <Text style={{ color: focusMode ? '#eaf2ff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Focus</Text>
          </Pressable>
        )}
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

      {/* Palette strip — appears under the title bar in paint mode. Click a swatch to
          set the active colour; it's drawn over the input overlay so clicks land here. */}
      {model && paintMode && (
        <Row
          style={{
            position: 'absolute', left: 0, top: 34, right: 0, height: 40,
            alignItems: 'center', paddingLeft: 12, paddingRight: 12,
            backgroundColor: 'rgba(12,14,20,0.82)', borderBottomWidth: 1, borderColor: '#1d2330',
          }}
        >
          {PALETTE.map((c, i) => {
            const active = c[0] === color[0] && c[1] === color[1] && c[2] === color[2];
            return (
              <Pressable
                key={i}
                onPress={() => setColor(c)}
                style={{
                  width: 24, height: 24, borderRadius: 5, marginRight: 8,
                  backgroundColor: rgbCss(c),
                  borderWidth: active ? 2 : 1,
                  borderColor: active ? '#ffffff' : '#00000055',
                }}
              />
            );
          })}
        </Row>
      )}

      {/* Mode toolbar — Object / Vertex / Edge / Face. The host-native selection modes;
          picking happens against the resident mesh with the exact render camera. Shares the
          under-title row with the paint palette (they're mutually-exclusive tools). */}
      {model && !paintMode && (
        <Row
          style={{
            position: 'absolute', left: 0, top: 34, right: 0, height: 40,
            alignItems: 'center', paddingLeft: 12, paddingRight: 12, gap: 6,
            backgroundColor: 'rgba(12,14,20,0.82)', borderBottomWidth: 1, borderColor: '#1d2330',
          }}
        >
          {SEL_MODES.map((label, m) => {
            const active = selMode === m && !focusMode;
            return (
              <Pressable
                key={label}
                onPress={() => chooseSelMode(m)}
                tooltip={m === 0 ? 'View / orbit' : `${label} select (${m})`}
                style={{
                  paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                  backgroundColor: active ? '#2a466e' : '#16233aee',
                  borderWidth: 1, borderColor: active ? '#5a86c0' : '#2c4a6a',
                }}
              >
                <Text style={{ color: active ? '#eaf2ff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>{label}</Text>
              </Pressable>
            );
          })}
          {selMode !== 0 && (
            <>
              <Box style={{ flexGrow: 1 }} />
              <Text style={{ color: '#7d899c', fontSize: 12, fontFamily: 'monospace' }}>
                {`${selInfo.sel} sel · ${selMode === 1 ? `${selInfo.verts} verts` : selMode === 2 ? `${selInfo.edges} edges` : `${(model.count / 3).toLocaleString()} faces`}`}
              </Text>
              <Pressable
                onPress={() => { meshClearSel(); setSelInfo(readSelInfo() ?? selInfo); }}
                tooltip="Clear selection (Esc)"
                style={{ marginLeft: 8, paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
              >
                <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Clear</Text>
              </Pressable>
            </>
          )}
        </Row>
      )}

      {/* Quality strip — live decimation. Drag to trade detail for triangles; the host
          re-meshes from the retained full-res source. Lower end is "just the shape" for
          the game (and the basis for baked LoD by render distance). */}
      {model && (
        <Row
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: 46,
            alignItems: 'center', paddingLeft: 14, paddingRight: 16,
            backgroundColor: 'rgba(12,14,20,0.82)', borderTopWidth: 1, borderColor: '#1d2330',
          }}
        >
          <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 600, marginRight: 12 }}>Quality</Text>
          <Box style={{ flexGrow: 1, marginRight: 14 }}>
            <Slider
              value={quality}
              min={0}
              max={1}
              onChange={(v: number) => applyQuality(v)}
              onCommit={(v: number) => applyQuality(v)}
              style={{ height: 24 }}
            />
          </Box>
          <Text style={{ color: '#7d899c', fontSize: 12, fontFamily: 'monospace' }}>
            {`${(model.count / 3).toLocaleString()} tris`}
          </Text>
        </Row>
      )}

      {/* Attribution panel — the shared editor (same one the Studio will use). Keyed by
          the entry id so switching models re-seeds the fields. */}
      {attrOpen && attribution && (
        <AttributionPanel
          key={attribution.id}
          entry={attribution}
          onSave={saveAttribution}
          onExport={doExportCredits}
          onClose={() => setAttrOpen(false)}
        />
      )}

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
