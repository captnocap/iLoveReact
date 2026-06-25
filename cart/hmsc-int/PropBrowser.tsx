// PropBrowser — the prop/piece menu's prop browser (req_1895). Replaces the
// unscannable wall of ~100 identical text pills with a PICTURE grid.
//
// Performance contract (the whole reason this is shaped the way it is): this
// reconciler has no list virtualization, and a live Scene3D per tile is the
// heavy path (the 683MB world-render problem). So we NEVER mount the whole
// catalog:
//   • BOUND the visible set — a page of PROP_PAGE tiles, prev/next. Search and
//     category narrow it; you never see hundreds at once, so there's nothing to
//     virtualize.
//   • BAKE each tile ONCE — every thumbnail is a one-prop Scene3D wrapped in a
//     StaticSurface keyed by the prop kind, so its paint collapses to a cached
//     texture quad after warmup and survives paging away + back (Road.tsx /
//     PropertiesPanel use the same staticKey cache).
//   • SEARCH is flat across the ENTIRE catalog (every category), and the hits
//     render right here — no page-hunting to find what you typed.
//
// A disk-cached thumbnail (render once, cache the PNG cross-session) is the next
// step if the in-process StaticSurface cache proves it out.

import { useMemo, useState } from 'react';
import { Box, Pressable, Scene3D, Text, TextInput } from '@reactjit/primitives';
import { GAME_BUILD, GAME_CAMERA } from './game';
import { isPropKind, propKindDefinition, type PropKind } from './game/kinds/props';
import { searchProps, type PropEntry } from './game/kinds/propTags';
import { useFavorites, toggleFavorite } from './game/kinds/propFavorites';
import { propVisualBounds } from './compile/propRecipes/footprint';
import { buildObjectWorld } from './objectPreview';
import { ModelScene } from './ModelViewer';
import { useCookedAssets } from './editors/model/cookedAssets';

const TILE_W = 92;
const TILE_H = 84;
// A page is sized to EXACTLY fill the grid area — never a scroll container (the
// user: "i dont want to have to scroll down just to see one more row"). We measure
// the grid, fit whole columns/rows of these cells, and page by what fits. GRID_GAP
// matches the row/column gap; CELL_H is the tile + its 2px gap + the label line, so
// floor()'d rows never spill past the pager.
const GRID_GAP = 6;
const CELL_H = TILE_H + 2 + 12;

// Thumbnail framing constants. A snug 3/4 orbit at a narrow FOV reads a model
// like a product shot — the prop fills the tile instead of floating tiny in it.
const THUMB_FOV = 30;
const THUMB_YAW = 35;
const THUMB_PITCH = 24;
const THUMB_MARGIN = 1.18; // pull back ~18% past the exact fit so nothing crops.

/** catalog id ('prop.foo' or 'foo') → the bare prop kind buildObjectWorld wants. */
function propKindOf(id: string): string {
  return id.startsWith('prop.') ? id.slice('prop.'.length) : id;
}

// Auto-frame the camera from the prop's OWN measured extent (the whole reason the
// old tiles were unrecognizable: a single fixed camera framed a phone booth and a
// bus the same, so most props were a speck). We take the prop's REAL visual AABB
// (propVisualBounds — every part, rotation baked in), centre on its true middle,
// and back off by radius / tan(fov/2) so the model fills the tile no matter how
// tall, wide, or off-anchor it is. Declared kind dims are the fallback ONLY for
// imported/cooked meshes that have no recipe parts to measure (req_1901: small
// props read worst when framed from declared dims that miss the real geometry).
// Pure + memoizable per kind.
function solveThumbCamera(kind: string) {
  const aabb = propVisualBounds(kind as PropKind);
  let cx = 0, cy: number, cz = 0, radius: number;
  if (aabb) {
    cx = (aabb.minX + aabb.maxX) / 2;
    cy = (aabb.minY + aabb.maxY) / 2;
    cz = (aabb.minZ + aabb.maxZ) / 2;
    const w = Math.max(0.3, aabb.maxX - aabb.minX);
    const h = Math.max(0.3, aabb.maxY - aabb.minY);
    const d = Math.max(0.3, aabb.maxZ - aabb.minZ);
    radius = 0.5 * Math.sqrt(w * w + d * d + h * h);
  } else {
    const def = propKindDefinition(kind as Parameters<typeof propKindDefinition>[0]);
    const h = Math.max(0.3, def.heightMeters);
    const w = Math.max(0.3, def.footprintWidthMeters ?? def.footprintRadiusMeters * 2);
    const d = Math.max(0.3, def.footprintDepthMeters ?? def.footprintRadiusMeters * 2);
    cy = h * 0.5;
    radius = 0.5 * Math.sqrt(w * w + d * d + h * h);
  }
  const dist = (radius / Math.tan((THUMB_FOV / 2) * (Math.PI / 180))) * THUMB_MARGIN;
  return GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
    target: [cx, cy, cz], yaw: THUMB_YAW, pitch: THUMB_PITCH, dist, zoom: 1, fov: THUMB_FOV,
  });
}

// One picture tile: a one-prop Scene3D framed by the prop's own bounds. The world
// build + camera solve are memoized per kind, so re-showing the same prop (paging
// back, re-search) is free. A STATIC (non-native) camera — twelve native cameras
// would each fight for the one host orbit controller; these are still product shots.
function PropThumb(props: { id: string; label: string; active: boolean; fav: boolean; onPick: () => void; onToggleFav: () => void }) {
  const kind = propKindOf(props.id);
  const view = useMemo(() => {
    try {
      const prop = buildObjectWorld('prop', kind).prop ?? null;
      return prop ? { prop, cam: solveThumbCamera(kind) } : null;
    } catch { return null; }
  }, [kind]);
  // Sibling Pressables (image picks, star toggles) — NOT nested, so the star never
  // arms the prop and vice-versa.
  return (
    <Box style={{ width: TILE_W, gap: 2, alignItems: 'center' }}>
      <Pressable onPress={props.onPick} hoverable tooltip={props.label}>
        <Box style={{ width: TILE_W, height: TILE_H, borderRadius: 5, borderWidth: props.active ? 2 : 1, borderColor: props.active ? '#7dd3fc' : '#3a4f6b', backgroundColor: '#0e1622', overflow: 'hidden' }}>
          {view ? (
            // Live Scene3D per tile (StaticSurface is a 2D-paint cache and bakes a 3D
            // scene BLANK — req_1896). Bounded to a page so the live-render count stays
            // small; if even a bounded page janks, the next step is offline-baked PNGs.
            <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0e1622" showGrid={false} showAxes={false}>
              <Scene3D.Camera position={view.cam.pos} target={view.cam.target} fov={view.cam.fov} />
              <ModelScene prop={view.prop} />
            </Scene3D>
          ) : null}
        </Box>
      </Pressable>
      <Box style={{ width: TILE_W, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
        <Pressable onPress={props.onToggleFav} hoverable tooltip={props.fav ? 'unfavorite' : 'favorite'}>
          <Text fontSize={10} color={props.fav ? '#fbbf24' : '#48566b'} style={{ fontFamily: 'monospace' }}>{props.fav ? '★' : '☆'}</Text>
        </Pressable>
        <Text fontSize={8} color={props.active ? '#7dd3fc' : '#a8b6c8'} numberOfLines={1} style={{ fontFamily: 'monospace', flexShrink: 1, textAlign: 'center' }}>{props.label}</Text>
      </Box>
    </Box>
  );
}

function chipStyle(on: boolean) {
  return { paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 4, backgroundColor: on ? '#0e7490' : '#142031' };
}

type StreamItem = { e: PropEntry } | { divider: true };

export function PropBrowser(props: { armedId: string | null; onArm: (id: string) => void }) {
  // re-render when a cooked ('studio') prop is installed.
  useCookedAssets();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  // Every prop in the catalog (cooked included). NO categories — props carry TAGS
  // now (req_1913) and search IS the navigation: type a name or a tag and the
  // tag-aware ranker surfaces direct hits plus tag-related items.
  const allProps = useMemo<PropEntry[]>(
    () => GAME_BUILD.catalog.byKind('prop').filter((e) => isPropKind(propKindOf(e.id))),
    // cooked props join the catalog on install; useCookedAssets() above re-runs us.
    [],
  );

  const favorites = useFavorites();
  const q = query.trim();
  const { matches, related } = useMemo(() => searchProps(q, allProps, favorites), [q, allProps, favorites]);

  // One paged stream: direct matches, then (when searching) a 'related' divider
  // and the tag-related items. Empty query = the whole catalog, still paged. The
  // divider occupies one full-width slot so it breaks the thumbnail row cleanly.
  const stream = useMemo<StreamItem[]>(() => {
    if (!q) return allProps.map((e) => ({ e }));
    const out: StreamItem[] = matches.map((e) => ({ e }));
    if (related.length) { out.push({ divider: true }); for (const e of related) out.push({ e }); }
    return out;
  }, [q, allProps, matches, related]);

  // Measure the grid and size a page to the whole columns × rows that fit — so
  // every page shows in full, no scrolling for a stray last row.
  const [grid, setGrid] = useState({ w: 0, h: 0 });
  const cols = Math.max(1, Math.floor((grid.w + GRID_GAP) / (TILE_W + GRID_GAP)));
  const rows = Math.max(1, Math.floor((grid.h + GRID_GAP) / (CELL_H + GRID_GAP)));
  const perPage = Math.max(1, cols * rows);

  const pageCount = Math.max(1, Math.ceil(stream.length / perPage));
  const cur = Math.min(page, pageCount - 1);
  const pageItems = stream.slice(cur * perPage, cur * perPage + perPage);

  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'column', gap: 6, minHeight: 0 }}>
      <TextInput
        text={query}
        placeholder="search props or a tag…"
        onChangeText={(t: string) => { setQuery(t); setPage(0); }}
        style={{ backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: q ? '#38bdf8' : '#27364a', borderRadius: 3, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }}
      />
      <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>
        {q
          ? `${matches.length} match${matches.length === 1 ? '' : 'es'}${related.length ? ` · ${related.length} related` : ''}`
          : `${allProps.length} props · type a name or tag (seating, neon, plant…)`}
      </Text>
      {/* The whole page at once — NO scroll container (req_1917). perPage is sized
          to the measured area, so every page fills the grid and the pager below
          stays pinned without anything spilling. overflow hidden is a safety net
          for the rare divider row. */}
      <Box
        onLayout={(rect: any) => setGrid((g) => (g.w === rect.w && g.h === rect.h ? g : { w: rect.w, h: rect.h }))}
        style={{ flexGrow: 1, minHeight: 0, overflow: 'hidden' }}
      >
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP, alignContent: 'flex-start' }}>
          {pageItems.map((it, i) => (
            'divider' in it ? (
              <Box key={`div-${cur}-${i}`} style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 2, paddingBottom: 2 }}>
                <Box style={{ flexGrow: 1, height: 1, backgroundColor: '#23354f' }} />
                <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>related</Text>
                <Box style={{ flexGrow: 1, height: 1, backgroundColor: '#23354f' }} />
              </Box>
            ) : (
              <PropThumb key={it.e.id} id={it.e.id} label={it.e.label} active={props.armedId === it.e.id} fav={favorites.has(it.e.id)} onPick={() => props.onArm(it.e.id)} onToggleFav={() => toggleFavorite(it.e.id)} />
            )
          ))}
          {stream.length === 0 ? (
            <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace', paddingTop: 6 }}>{`no prop or tag matches “${q}”`}</Text>
          ) : null}
        </Box>
      </Box>
      {pageCount > 1 ? (
        <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2 }}>
          <Pressable onPress={() => setPage((p) => Math.max(0, p - 1))}>
            <Box style={chipStyle(false)}><Text fontSize={9} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>‹ prev</Text></Box>
          </Pressable>
          <Text fontSize={9} color="#8aa0b8" style={{ fontFamily: 'monospace' }}>{`${cur + 1} / ${pageCount}`}</Text>
          <Pressable onPress={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>
            <Box style={chipStyle(false)}><Text fontSize={9} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>next ›</Text></Box>
          </Pressable>
        </Box>
      ) : null}
    </Box>
  );
}
