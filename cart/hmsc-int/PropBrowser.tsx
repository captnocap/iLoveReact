// PropBrowser — the prop menu's PICTURE grid (req_1895). Replaces the unscannable
// wall of ~100 identical text pills. Shares the rail's grid/framing vocabulary
// (railThumbGrid) with the BUILD browser, so props and pieces look + page the same.
//
// Performance contract (the whole reason this is shaped the way it is): this
// reconciler has no list virtualization, and a live Scene3D per tile is the heavy
// path. So we NEVER mount the whole catalog — useFittedGrid bounds the visible set
// to the page that FILLS the rail (no scroll, req_1917), search/tags narrow it, and
// each tile is framed from its own bounds (req_1898) so it reads like a product shot.

import { useMemo, useState } from 'react';
import { Box, Pressable, Scene3D, Text, TextInput } from '@reactjit/primitives';
import { GAME_BUILD } from './game';
import { isPropKind, propKindDefinition, type PropKind } from './game/kinds/props';
import { searchProps, type PropEntry } from './game/kinds/propTags';
import { useFavorites, toggleFavorite } from './game/kinds/propFavorites';
import { propVisualBounds } from './compile/propRecipes/footprint';
import { buildObjectWorld } from './objectPreview';
import { ModelScene } from './ModelViewer';
import { useCookedAssets } from './editors/model/cookedAssets';
import { RailPager, useFittedGrid, solveThumbOrbit, solveThumbOrbitForBounds, thumbCellH } from './railThumbGrid';

const TILE_W = 92;
const TILE_H = 84;

/** catalog id ('prop.foo' or 'foo') → the bare prop kind buildObjectWorld wants. */
function propKindOf(id: string): string {
  return id.startsWith('prop.') ? id.slice('prop.'.length) : id;
}

// Auto-frame from the prop's OWN measured extent — one fixed camera framed a phone
// booth and a bus the same, so most props were a speck (req_1898). Prefer the REAL
// visual AABB (propVisualBounds — every part, rotation baked in); declared kind dims
// are the fallback ONLY for imported/cooked meshes with no recipe parts to measure
// (req_1901). Pure + memoizable per kind.
function solveThumbCamera(kind: string) {
  const aabb = propVisualBounds(kind as PropKind);
  if (aabb) return solveThumbOrbitForBounds(aabb);
  const def = propKindDefinition(kind as Parameters<typeof propKindDefinition>[0]);
  const h = Math.max(0.3, def.heightMeters);
  const w = Math.max(0.3, def.footprintWidthMeters ?? def.footprintRadiusMeters * 2);
  const d = Math.max(0.3, def.footprintDepthMeters ?? def.footprintRadiusMeters * 2);
  return solveThumbOrbit(0, h * 0.5, 0, w, h, d);
}

// One picture tile: a one-prop Scene3D framed by the prop's own bounds, with a
// favorite star. The world build + camera solve are memoized per kind, so paging
// back / re-searching is free. A STATIC (non-native) camera — twelve native cameras
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

type StreamItem = { e: PropEntry } | { divider: true };

export function PropBrowser(props: { armedId: string | null; onArm: (id: string) => void }) {
  // re-render when a cooked ('studio') prop is installed.
  useCookedAssets();
  const [query, setQuery] = useState('');

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

  // The whole page at once — no scroll container (req_1917). perPage is sized to
  // the measured area, so every page fills the grid and the pager stays pinned.
  const grid = useFittedGrid({ total: stream.length, tileW: TILE_W, cellH: thumbCellH(TILE_H) });
  const pageItems = stream.slice(grid.start, grid.end);

  return (
    <Box style={{ width: '100%', flexGrow: 1, flexDirection: 'column', gap: 6, minHeight: 0 }}>
      <TextInput
        text={query}
        placeholder="search props or a tag…"
        onChangeText={(t: string) => { setQuery(t); grid.setPage(0); }}
        style={{ backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: q ? '#38bdf8' : '#27364a', borderRadius: 3, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }}
      />
      {/* count only while searching — the placeholder already says what to type,
          so no idle hint string (req_1929: it was noise + wasted render). */}
      {q ? (
        <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>
          {`${matches.length} match${matches.length === 1 ? '' : 'es'}${related.length ? ` · ${related.length} related` : ''}`}
        </Text>
      ) : null}
      <Box style={grid.containerStyle} onLayout={(rect: any) => grid.onLayout(rect)}>
        <Box style={grid.rowStyle}>
          {pageItems.map((it, i) => (
            'divider' in it ? (
              <Box key={`div-${grid.cur}-${i}`} style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 2, paddingBottom: 2 }}>
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
      <RailPager pageCount={grid.pageCount} cur={grid.cur} setPage={grid.setPage} />
    </Box>
  );
}
