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
import { Box, Pressable, Scene3D, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { GAME_BUILD } from './game';
import { PROP_CATEGORY_NAMES, isPropKind, propCategory, type PropCategory } from './game/kinds/props';
import { buildObjectWorld } from './objectPreview';
import { ModelScene } from './ModelViewer';
import { useCookedAssets } from './editors/model/cookedAssets';

const PROP_PAGE = 12;
const TILE_W = 82;
const TILE_H = 66;

/** catalog id ('prop.foo' or 'foo') → the bare prop kind buildObjectWorld wants. */
function propKindOf(id: string): string {
  return id.startsWith('prop.') ? id.slice('prop.'.length) : id;
}

// One picture tile: a one-prop Scene3D baked to a cached quad by kind. The world
// build is memoized per kind, and StaticSurface caches the render — so re-showing
// the same prop (paging back, re-search) costs nothing.
function PropThumb(props: { id: string; label: string; active: boolean; onPick: () => void }) {
  const kind = propKindOf(props.id);
  const prop = useMemo(() => {
    try { return buildObjectWorld('prop', kind).prop ?? null; } catch { return null; }
  }, [kind]);
  return (
    <Pressable onPress={props.onPick} hoverable tooltip={props.label}>
      <Box style={{ width: TILE_W, gap: 2, alignItems: 'center' }}>
        <Box style={{ width: TILE_W, height: TILE_H, borderRadius: 5, borderWidth: props.active ? 2 : 1, borderColor: props.active ? '#7dd3fc' : '#3a4f6b', backgroundColor: '#0e1622', overflow: 'hidden' }}>
          {prop ? (
            // Live Scene3D per tile (StaticSurface is a 2D-paint cache and bakes a 3D
            // scene BLANK — req_1896). Bounded to a page so the live-render count stays
            // small; if even a bounded page janks, the next step is offline-baked PNGs.
            <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0e1622" showGrid={false} showAxes={false}>
              <Scene3D.Camera nativeCamera position={[3.6, 3.0, 3.6]} target={[0, 0.7, 0]} fov={30} />
              <ModelScene prop={prop} />
            </Scene3D>
          ) : null}
        </Box>
        <Text fontSize={8} color={props.active ? '#7dd3fc' : '#a8b6c8'} numberOfLines={1} style={{ fontFamily: 'monospace', width: TILE_W, textAlign: 'center' }}>{props.label}</Text>
      </Box>
    </Pressable>
  );
}

function chipStyle(on: boolean) {
  return { paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 4, backgroundColor: on ? '#0e7490' : '#142031' };
}

export function PropBrowser(props: { armedId: string | null; onArm: (id: string) => void }) {
  // re-render when a cooked ('studio') prop is installed.
  useCookedAssets();
  const [query, setQuery] = useState('');
  const [shelf, setShelf] = useState<PropCategory>(() => PROP_CATEGORY_NAMES[0] ?? 'street');
  const [page, setPage] = useState(0);

  // Every prop in the catalog (cooked included) — the flat set search narrows.
  const allProps = useMemo(
    () => GAME_BUILD.catalog.byKind('prop').filter((e) => isPropKind(propKindOf(e.id))),
    // cooked props join the catalog on install; useCookedAssets() above re-runs us.
    [],
  );

  const q = query.trim().toLowerCase();
  const entries = useMemo(() => {
    if (q) return allProps.filter((e) => e.label.toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
    return allProps.filter((e) => propCategory(propKindOf(e.id)) === shelf);
  }, [q, shelf, allProps]);

  const pageCount = Math.max(1, Math.ceil(entries.length / PROP_PAGE));
  const cur = Math.min(page, pageCount - 1);
  const pageItems = entries.slice(cur * PROP_PAGE, cur * PROP_PAGE + PROP_PAGE);

  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'column', gap: 6, minHeight: 0 }}>
      <TextInput
        text={query}
        placeholder="search every prop…"
        onChangeText={(t: string) => { setQuery(t); setPage(0); }}
        style={{ backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: q ? '#38bdf8' : '#27364a', borderRadius: 3, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }}
      />
      {q ? (
        <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>{`${entries.length} match${entries.length === 1 ? '' : 'es'} across every category`}</Text>
      ) : (
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
          {PROP_CATEGORY_NAMES.map((cat) => (
            <Pressable key={cat} onPress={() => { setShelf(cat); setPage(0); }}>
              <Box style={chipStyle(cat === shelf)}>
                <Text fontSize={9} color={cat === shelf ? '#ecfeff' : '#8aa0b8'} style={{ fontFamily: 'monospace' }}>{cat}</Text>
              </Box>
            </Pressable>
          ))}
        </Box>
      )}
      {/* the bounded page of picture tiles — scrolls WITHIN its area so the pager
          below stays pinned (req_1896: it was floating mid-grid when the rows
          overflowed a plain flexGrow box). */}
      <ScrollView style={{ flexGrow: 1, minHeight: 0 }}>
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignContent: 'flex-start' }}>
          {pageItems.map((e) => (
            <PropThumb key={e.id} id={e.id} label={e.label} active={props.armedId === e.id} onPick={() => props.onArm(e.id)} />
          ))}
          {pageItems.length === 0 ? (
            <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace', paddingTop: 6 }}>{q ? 'no prop by that name' : 'nothing in this category'}</Text>
          ) : null}
        </Box>
      </ScrollView>
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
