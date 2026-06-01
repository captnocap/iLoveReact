import { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Text } from '@reactjit/primitives';
import { readFile } from '@reactjit/hooks/fs';
import {
  useWorkspace,
  parseEnvelope,
  sessionPathFor,
  lastPointerPath,
  type SessionEnvelope,
} from '@reactjit/workspace';
import type { GameState } from '../hmsc/design';
import { emptyEditorWorld } from './editorWorld';
import { IsoPreview, type IsoView } from './IsoPreview';
import { QuadSplit } from './QuadSplit';
import { PaintCanvas, type Tool, type Layer } from './PaintCanvas';
import { PropertiesPanel, type Focus } from './PropertiesPanel';
import { RightPanel, type TabId } from './RightPanel';
import { resolvePlaceable, type Placement, type PlaceCat } from './placements';
import { buildObjectWorld } from './objectPreview';
import { TILE_UNITS } from './heightData';
import type { TileKind } from '../hmsc/design';

// hmsc-int laid out as a 2x2 pane grid (QuadSplit) with a resizable cross divider:
//
//   ┌──────────┬──────────┐
//   │  (open)  │  (open)   │   top row — reserved for later
//   ├──────────┼──────────┤
//   │  canvas  │  preview  │   bottom row — 2D paint canvas + live iso-3D
//   └──────────┴──────────┘
//
// The editor's VIEW state (divider fractions, preview yaw, active tool + tile) is
// persisted via the workspace layer (runtime/workspace — the cutout "disk = truth"
// pattern). Hot reloads re-mount the cart and reset every useState, so without this
// the divider would snap back to center on every edit; the workspace autosaves the
// view to cart/hmsc-int/sessions/ and restores it on mount. We ALSO seed the
// initial state synchronously from that file so the divider never flashes to
// center for a frame before the restore lands.

const CART = 'hmsc-int';
const VERSION = 1;
const MIN_FRAC = 0.06; // never collapse a pane fully — keep a grabbable sliver

// The persisted editor view. The authored world will join this payload once
// authoring lands; for now it is the UI state that hot reload would otherwise eat.
interface ViewPayload {
  fx: number;
  fy: number;
  yaw: number;
  tool: Tool;
  tile: TileKind;
  layer: Layer;
  tab: TabId;
  notes: string;
  showGrid: boolean;
}

function clampFrac(f: number): number {
  return Math.max(MIN_FRAC, Math.min(1 - MIN_FRAC, f));
}

// Synchronous read of the last-saved view, used to seed initial state so there is
// no center→saved flash on mount. Mirrors useWorkspace's restore path; the hook
// still runs its own restore (same values) plus autosave/undo on top.
function readInitialView(): Partial<ViewPayload> {
  try {
    const stem = readFile(lastPointerPath(CART))?.trim();
    if (!stem) return {};
    const text = readFile(sessionPathFor(CART, stem));
    if (!text) return {};
    const env = parseEnvelope<ViewPayload>(text, { cartName: CART, version: VERSION });
    return env?.payload ?? {};
  } catch {
    return {};
  }
}

// A labeled empty pane so each quadrant is visible/identifiable while we build out.
function Pane(props: { label: string; children?: React.ReactNode }) {
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b1320', position: 'relative' }}>
      {props.children}
      <Text fontSize={9} color="#3a4a63" style={{ fontFamily: 'monospace', position: 'absolute', left: 8, top: 6 }}>{props.label}</Text>
    </Box>
  );
}

export default function HmscWorldEditorCart() {
  const [world] = useState<GameState>(emptyEditorWorld);

  // Seed view state from disk once (lazy initializer → runs only on mount).
  const [initial] = useState(readInitialView);
  const [fx, setFx] = useState(() => initial.fx ?? 0.5);
  const [fy, setFy] = useState(() => initial.fy ?? 0.5);
  const [yaw, setYaw] = useState(() => initial.yaw ?? 45);
  const [tool, setTool] = useState<Tool>(() => initial.tool ?? 'pointer');
  const [tile, setTile] = useState<TileKind>(() => initial.tile ?? 'sidewalk');
  const [layer, setLayer] = useState<Layer>(() => initial.layer ?? 'paint');
  const [tab, setTab] = useState<TabId>(() => initial.tab ?? 'objects');
  const [notes, setNotes] = useState<string>(() => initial.notes ?? '');
  const [showGrid, setShowGrid] = useState<boolean>(() => initial.showGrid ?? true);

  // Persist the view. Autosave (debounced) fires whenever any deps slice changes;
  // restore-on-mount reapplies the same values the synchronous seed already set.
  const buildPayload = useCallback((): ViewPayload => ({ fx, fy, yaw, tool, tile, layer, tab, notes, showGrid }), [fx, fy, yaw, tool, tile, layer, tab, notes, showGrid]);
  const applyPayload = useCallback((env: SessionEnvelope<ViewPayload>) => {
    const p = env.payload;
    if (typeof p.fx === 'number') setFx(p.fx);
    if (typeof p.fy === 'number') setFy(p.fy);
    if (typeof p.yaw === 'number') setYaw(p.yaw);
    if (p.tool) setTool(p.tool);
    if (p.tile) setTile(p.tile);
    if (p.layer) setLayer(p.layer);
    if (p.tab) setTab(p.tab);
    if (typeof p.notes === 'string') setNotes(p.notes);
    if (typeof p.showGrid === 'boolean') setShowGrid(p.showGrid);
  }, []);
  const ws = useWorkspace<ViewPayload>({ cartName: CART, version: VERSION, buildPayload, applyPayload, deps: [fx, fy, yaw, tool, tile, layer, tab, notes, showGrid] });

  // Divider drags arrive as per-event fraction deltas; accumulate + clamp here.
  const onResize = useCallback((axis: 'col' | 'row', d: number) => {
    if (axis === 'col') setFx((f) => clampFrac(f + d));
    else setFy((f) => clampFrac(f + d));
  }, []);
  const resetLayout = useCallback(() => { setFx(0.5); setFy(0.5); }, []);
  const clearNotes = useCallback(() => setNotes(''), []);

  // ── Object placements (the 'place' layer) ───────────────────────────────────
  const placeSeq = useRef(0);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selPlaceId, setSelPlaceId] = useState<string | null>(null);

  // The model viewer's + drops the selected kind at the origin, selects it, and
  // switches the painter to the place layer ("brings the view into this layer").
  const placeObject = useCallback((cat: PlaceCat, kind: string) => {
    placeSeq.current += 1;
    const id = `pl_${placeSeq.current}`;
    const base = resolvePlaceable(cat, kind);
    setPlacements((ps) => [...ps, { id, cat, kind, ...base, gx: 0, gy: 0, rotation: 0, locked: false }]);
    setSelPlaceId(id);
    setLayer('place');
  }, []);
  const movePlacement = useCallback((id: string, gx: number, gy: number) => setPlacements((ps) => ps.map((p) => (p.id === id ? { ...p, gx, gy } : p))), []);
  const updatePlacement = useCallback((id: string, patch: Partial<Placement>) => setPlacements((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p))), []);
  const removePlacement = useCallback((id: string) => { setPlacements((ps) => ps.filter((p) => p.id !== id)); setSelPlaceId((s) => (s === id ? null : s)); }, []);
  const clonePlacement = useCallback((id: string) => {
    placeSeq.current += 1;
    const nid = `pl_${placeSeq.current}`;
    setPlacements((ps) => {
      const src = ps.find((p) => p.id === id);
      return src ? [...ps, { ...src, id: nid, gx: src.gx + TILE_UNITS, gy: src.gy + TILE_UNITS, locked: false }] : ps;
    });
    setSelPlaceId(nid);
  }, []);
  const place = useMemo(() => ({
    items: placements, selId: selPlaceId, onSelect: setSelPlaceId,
    onMove: movePlacement, onUpdate: updatePlacement, onClone: clonePlacement, onDelete: removePlacement,
  }), [placements, selPlaceId, movePlacement, updatePlacement, clonePlacement, removePlacement]);

  // The top-left "in focus" panel. On the place layer it shows the SELECTED
  // placement's object (built into a one-object world so the panel resolves it);
  // otherwise it falls back to the active paint tile so it is always live.
  const selPlacement = placements.find((p) => p.id === selPlaceId) ?? null;
  const placeFocus = useMemo(
    () => (layer === 'place' && selPlacement ? buildObjectWorld(selPlacement.cat, selPlacement.kind) : null),
    [layer, selPlacement?.cat, selPlacement?.kind],
  );
  const shownFocus: Focus = placeFocus?.focus ?? { kind: 'tile', tile };
  const focusWorld = placeFocus?.world ?? world;

  // The preview frames the origin; an empty world has nothing to fit to yet.
  const isoView: IsoView = useMemo(() => ({
    centerX: 0,
    centerZ: 0,
    yawDegrees: yaw,
    distMeters: 120,
  }), [yaw]);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#080d16' }}>
      <QuadSplit
        fx={fx}
        fy={fy}
        onResize={onResize}
        topLeft={<PropertiesPanel focus={shownFocus} world={focusWorld} />}
        topRight={
          <RightPanel
            tab={tab}
            onTab={setTab}
            notes={notes}
            onNotes={setNotes}
            showGrid={showGrid}
            onShowGrid={setShowGrid}
            onResetLayout={resetLayout}
            onClearNotes={clearNotes}
            lastSavedAt={ws.lastSavedAt}
            onPlace={placeObject}
          />
        }
        bottomLeft={<PaintCanvas tool={tool} onTool={setTool} tile={tile} onTile={setTile} layer={layer} onLayer={setLayer} place={place} showGrid={showGrid} />}
        bottomRight={
          <Pane label="preview">
            <IsoPreview state={world} view={isoView} />
            {/* The preview's own orbit controls. */}
            <Box style={{ position: 'absolute', left: 8, top: 8, flexDirection: 'row', gap: 4 }}>
              <Pressable onPress={() => setYaw((y) => y - 45)} style={{ width: 28, height: 24, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b1424cc', borderWidth: 1, borderColor: '#334155' }}>
                <Text fontSize={12} color="#cbd5e1">↺</Text>
              </Pressable>
              <Pressable onPress={() => setYaw((y) => y + 45)} style={{ width: 28, height: 24, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b1424cc', borderWidth: 1, borderColor: '#334155' }}>
                <Text fontSize={12} color="#cbd5e1">↻</Text>
              </Pressable>
            </Box>
            <Text fontSize={9} color="#475569" style={{ fontFamily: 'monospace', position: 'absolute', right: 8, top: 8 }}>{`yaw ${yaw % 360}°`}</Text>
          </Pane>
        }
      />
    </Box>
  );
}
