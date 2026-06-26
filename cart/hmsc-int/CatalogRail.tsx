// CatalogRail — the editor rail's catalog menu: a top-level SECTION toggle
// (BUILD ⟷ PROPS) over the build-piece tabs (floor/wall/ramp/roof/stairs/
// elevator/pillar + prefabs + tower + water) and the picture browsers. Its OWN
// file (req_1967): it used to live inside IsoAuthor.tsx and be exported from
// there, which is the grab-bag pattern that let a second build pane diverge.
//
// BUILD is the structural toolbar; PROPS is the picture browser. The section
// toggle is the FIRST choice (req_1906) — props are a different activity, not one
// more tab jammed into the building row.

import { memo, useMemo } from 'react';
import { renderTick } from './editors/build/editLatency';
import { Box, Pressable, Text } from '@reactjit/primitives';
import { GAME_BUILD } from './game';
import type { BuildPieceKind, BuildPrefabDef } from './game';
import { useRouteTwigState } from './editors/twigs';
import { WATER_BODY_PRESETS, WATER_BODY_PRESET_IDS } from './game/kinds/waterBodies';
import type { Armed } from './buildArmed';
import { PropBrowser } from './PropBrowser';
import { PieceBrowser } from './PieceBrowser';
import { CategoryIcon } from './CategoryIcon';

// The twig route the rail's section + tab persist under (TWIGSWEEP-0610). Kept as
// '/iso-build' verbatim so a user's saved menu position carries over.
const ISO_ROUTE = '/iso-build';
const PALETTE_KINDS: BuildPieceKind[] = ['floor', 'wall', 'ramp', 'roof', 'stairs', 'elevator', 'pillar', 'prop'];

type RailTab = BuildPieceKind | 'prefabs' | 'water';
type RailSection = 'build' | 'props';
// Build tools only — `prop` is no longer a tab here; it's the other SECTION. Water
// rides with BUILD for now (environmental world-building, not a prop).
const BUILD_TABS: RailTab[] = [...PALETTE_KINDS.filter((k) => k !== 'prop'), 'prefabs', 'water'];

export const CatalogRail = memo(function CatalogRail(props: { armed: Armed; prefabs: readonly BuildPrefabDef[]; onArm: (a: NonNullable<Armed>) => void }) {
  renderTick('CatalogRail'); // req_1968 diag
  // TWIGS (req_0643 "annoying have it reset"): the rail's section + build tab are
  // route twig state, so a hot reload restores the menu where you left it.
  const [section, setSection] = useRouteTwigState<RailSection>(ISO_ROUTE, 'railSection', 'build');
  const [tabRaw, setTab] = useRouteTwigState<RailTab>(ISO_ROUTE, 'railTab', 'wall');
  // Coerce a stale 'prop' tab (saved before the decouple) onto a real build tab so
  // the old twig can't leave the build section with nothing selected.
  const tab: RailTab = tabRaw === 'prop' ? 'wall' : tabRaw;
  // 'prefabs' lists the named compositions (the FULL list the cart passes, built-in
  // + user-captured stream prefabs); every other tab lists that kind's catalog
  // pieces. Both feed the SAME rail, fed by the SAME GAME_BUILD.
  const entries = useMemo<{ id: string; label: string }[]>(
    () => {
      if (tab === 'prefabs') return props.prefabs.map((d) => ({ id: d.id, label: d.label }));
      if (tab === 'water') return WATER_BODY_PRESET_IDS.map((id) => ({ id, label: WATER_BODY_PRESETS[id].label }));
      return GAME_BUILD.catalog.byKind(tab);
    },
    [tab, props.prefabs],
  );
  const armKind: 'piece' | 'prefab' | 'water' = tab === 'prefabs' ? 'prefab' : tab === 'water' ? 'water' : 'piece';
  const armedId = props.armed && props.armed.kind !== 'tower' ? props.armed.id : null;
  const towerArmed = props.armed?.kind === 'tower';
  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'column', backgroundColor: '#0b1220fa', borderRadius: 6, borderWidth: 1, borderColor: '#1e3a5f', padding: 8, gap: 6 }}>
      {/* SECTION toggle — the first, top-level choice (req_1906 decouple). Two
          distinct activities, not two more pills in a shared row. */}
      <Box style={{ flexDirection: 'row', gap: 4 }}>
        {(['build', 'props'] as RailSection[]).map((s) => (
          <Pressable key={s} onPress={() => setSection(s)} style={{ flexGrow: 1 }}>
            <Box style={{ flexGrow: 1, alignItems: 'center', paddingTop: 6, paddingBottom: 6, borderRadius: 5, borderWidth: 1, borderColor: s === section ? '#7dd3fc' : '#23354f', backgroundColor: s === section ? '#13315c' : '#0f1a2c' }}>
              <Text fontSize={11} color={s === section ? '#eaf4ff' : '#7e93ab'} style={{ fontFamily: 'monospace', fontWeight: 700 }}>{s === 'build' ? 'BUILD' : 'PROPS'}</Text>
            </Box>
          </Pressable>
        ))}
      </Box>
      {section === 'props' ? (
        // PROPS section: the PICTURE browser (req_1895) — search across every
        // category + paged thumbnails.
        <PropBrowser armedId={armedId} onArm={(id) => props.onArm({ kind: 'piece', id })} />
      ) : (
        <>
          <Text fontSize={10} color="#7dd3fc" style={{ fontFamily: 'monospace', fontWeight: 700 }}>
            {`${tab === 'prefabs' ? 'PREFABS' : tab === 'water' ? 'WATER' : 'PIECES'} · ${tab} (${entries.length})`}
          </Text>
          {/* The category choices as baked-SDF wireframe ICONS, not text pills
              (req_1925). The word rides the hover tooltip so the glyphs stay
              learnable without being labelled. */}
          <Box style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
            {BUILD_TABS.map((k) => (
              <Pressable key={k} onPress={() => setTab(k)} hoverable tooltip={k}>
                <Box style={{ width: 34, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: k === tab ? '#2563eb' : (k === 'prefabs' ? '#3b2a5e' : '#1e293b') }}>
                  <CategoryIcon cat={k} size={22} color={k === tab ? '#eaf4ff' : '#9fb2c8'} />
                </Box>
              </Pressable>
            ))}
            {/* the TOWER tool (req_0478) — not a catalog kind, a whole-shell drag
                tool. Same icon treatment; the gold background marks it special. */}
            <Pressable onPress={() => props.onArm({ kind: 'tower' })} hoverable tooltip="tower">
              <Box style={{ width: 34, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: towerArmed ? '#1d4ed8' : '#4a3a12' }}>
                <CategoryIcon cat="tower" size={22} color={towerArmed ? '#ffffff' : '#f0d9a8'} />
              </Box>
            </Pressable>
          </Box>
          {/* The build entries as a FRAMED PICTURE GRID (req_1918) — PieceBrowser
              pages to fill the rail (no scroll) and renders each piece/prefab/water
              entry as a real thumbnail via the shared railThumbGrid vocabulary. */}
          <PieceBrowser
            entries={entries}
            armKind={armKind}
            armedId={armedId}
            prefabs={props.prefabs}
            onArm={(id) => props.onArm({ kind: armKind, id })}
          />
        </>
      )}
    </Box>
  );
});
