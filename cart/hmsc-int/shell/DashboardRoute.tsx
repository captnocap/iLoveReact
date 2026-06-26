// shell/DashboardRoute.tsx — the / landing surface (req_1872/1875). NOT the
// editor: a light, selected-map readout that paints in one frame while the map
// warms in the background. The heavy editor (the quad panes + the native world
// load) lives on /editor now; this screen mounts nothing 3D.
//
// FREEZE LAW (req_1872): every number on this route is derived from the selected
// map props already streamed into the shell. No global store walks here: those
// belong on a library/workbench surface, not a page headed by a map name.

import { useMemo } from 'react';
import { Box, Text, Pressable } from '@reactjit/primitives';
import { accentFor } from '../studio.cls';
import { reportMapFootprint, type FootprintLike } from '../mapReport';
import { reportPlacementCensus } from '../placementStats';
import type { ChunkFloor } from '../chunkFloor';

// ── tiny formatters (no ICU — the embedded V8 may lack toLocaleString) ──────────
function commas(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function area(m2: number): string {
  return m2 >= 1_000_000 ? `${(m2 / 1_000_000).toFixed(2)} km²` : `${commas(m2)} m²`;
}
function dur(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

const PANEL_BG = '#0c1422';
const PANEL_BORDER = '#1c2940';

function Kicker(props: { children: React.ReactNode }) {
  return (
    <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 2 }}>
      {props.children}
    </Text>
  );
}

// One big figure with its label — the encouraging unit of the screen.
function Figure(props: { value: string; label: string; accent?: string }) {
  return (
    <Box style={{ flexDirection: 'column', gap: 2, minWidth: 96 }}>
      <Text fontSize={28} color={props.accent ?? accentFor('text')} style={{ fontFamily: 'monospace', fontWeight: 800 }}>
        {props.value}
      </Text>
      <Text fontSize={10} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace', letterSpacing: 1 }}>
        {props.label}
      </Text>
    </Box>
  );
}

function Panel(props: { title: string; children: React.ReactNode }) {
  return (
    <Box style={{ flexGrow: 1, flexBasis: 320, flexDirection: 'column', gap: 16, padding: 20, backgroundColor: PANEL_BG, borderWidth: 1, borderColor: PANEL_BORDER, borderRadius: 12 }}>
      <Kicker>{props.title}</Kicker>
      {props.children}
    </Box>
  );
}

export function DashboardRoute(props: {
  mapName: string;
  floors: ChunkFloor[];
  footprints: FootprintLike[];
  placedLabels: string[];
  onOpenEditor: () => void;
  onCompiled: () => void;
}) {
  // Map footprint + most-placed — cheap, reactive to what streams in as the
  // workspace restores.
  const map = useMemo(
    () => reportMapFootprint({ chunks: props.floors, footprints: props.footprints }),
    [props.floors, props.footprints],
  );
  const placed = useMemo(() => reportPlacementCensus(props.placedLabels), [props.placedLabels]);

  const hasWorld = map.chunks > 0;
  const builtArea = Math.min(map.assetAreaM2, map.groundAreaM2);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#070c14', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      <Box style={{ width: '100%', maxWidth: 860, flexDirection: 'column', gap: 22 }}>

        {/* Greeting + the way in */}
        <Box style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <Box style={{ flexDirection: 'column', gap: 4 }}>
            <Kicker>WELCOME BACK TO</Kicker>
            <Text fontSize={34} color={accentFor('text')} style={{ fontWeight: 800 }}>{props.mapName || 'your world'}</Text>
          </Box>
          <Pressable
            onPress={props.onOpenEditor}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 18, paddingRight: 18, paddingTop: 12, paddingBottom: 12, borderRadius: 10, backgroundColor: '#0c2a20', borderWidth: 1, borderColor: '#34d399' }}
          >
            <Text fontSize={14} color="#6ee7b7" style={{ fontFamily: 'monospace', fontWeight: 800, letterSpacing: 1 }}>OPEN EDITOR  →</Text>
          </Pressable>
        </Box>

        {/* The two readouts */}
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>

          <Panel title="MAP · AUTHORED DATA">
            <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24 }}>
              <Figure value={commas(map.chunks)} label="CHUNKS" accent="#7dd3fc" />
              <Figure value={commas(placed.total)} label="PLACED" accent="#a5b4fc" />
              <Figure value={commas(placed.unique)} label="KINDS" accent="#c4b5fd" />
            </Box>
            <Text fontSize={11} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace' }}>
              selected map only · {hasWorld ? `${area(map.groundAreaM2)} painted ground` : 'no painted ground yet'}
            </Text>
          </Panel>

          <Panel title="WORLD · SIZE & SPACE">
            {hasWorld ? (
              <Box style={{ flexDirection: 'column', gap: 14 }}>
                <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24 }}>
                  <Figure value={`${commas(map.widthMeters)}×${commas(map.depthMeters)}`} label="METERS (W×D)" accent="#fcd34d" />
                  <Figure value={dur(map.walkSecondsAcross)} label="TO WALK ACROSS" accent="#fdba74" />
                </Box>
                {map.landmark ? (
                  <Text fontSize={13} color={accentFor('text')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                    ≈ {map.landmark.ratio < 10 ? map.landmark.ratio.toFixed(2) : commas(map.landmark.ratio)}× {map.landmark.name}
                  </Text>
                ) : null}
                <Text fontSize={11} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace' }}>
                  {area(map.extentAreaM2)} bounding box · {(map.paintedFraction * 100).toFixed(1)}% painted
                </Text>
              </Box>
            ) : (
              <Text fontSize={12} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace' }}>
                paint some ground and your world will grow here.
              </Text>
            )}
          </Panel>

          <Panel title="GROUND · COVERAGE">
            {hasWorld ? (
              <Box style={{ flexDirection: 'column', gap: 14 }}>
                <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24 }}>
                  <Figure value={area(builtArea)} label="BUILT FOOTPRINT" accent="#f0abfc" />
                  <Figure value={area(map.openAreaM2)} label="OPEN GROUND" accent="#67e8f9" />
                </Box>
                <Box style={{ flexDirection: 'column', gap: 6 }}>
                  <Box style={{ height: 10, borderRadius: 5, backgroundColor: '#13203a', overflow: 'hidden', flexDirection: 'row' }}>
                    <Box style={{ width: `${Math.round(map.coverageFraction * 100)}%`, height: '100%', backgroundColor: '#34d399' }} />
                  </Box>
                  <Text fontSize={11} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace' }}>
                    {(map.coverageFraction * 100).toFixed(1)}% built · {commas(map.assetCount)} footprint{map.assetCount === 1 ? '' : 's'} counted
                  </Text>
                </Box>
              </Box>
            ) : (
              <Text fontSize={12} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace' }}>
                paint some ground before coverage has meaning.
              </Text>
            )}
          </Panel>

          <Panel title="MOST PLACED">
            {placed.total > 0 ? (
              <Box style={{ flexDirection: 'column', gap: 8 }}>
                {placed.top.map((r, i) => (
                  <Box key={r.label} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <Text fontSize={13} color={accentFor(i === 0 ? 'text' : 'textSecondary')} style={{ fontFamily: 'monospace', fontWeight: i === 0 ? 700 : 400 }}>
                      {i + 1}. {r.label}
                    </Text>
                    <Text fontSize={13} color="#34d399" style={{ fontFamily: 'monospace', fontWeight: 700 }}>×{commas(r.count)}</Text>
                  </Box>
                ))}
                <Text fontSize={11} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace' }}>
                  {commas(placed.total)} placed · {commas(placed.unique)} kinds
                </Text>
              </Box>
            ) : (
              <Text fontSize={12} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace' }}>
                place props and buildings to see your favourites.
              </Text>
            )}
          </Panel>
        </Box>

        {/* Quiet footer link */}
        <Box style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={props.onCompiled} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderRadius: 8, borderWidth: 1, borderColor: PANEL_BORDER, backgroundColor: PANEL_BG }}>
            <Text fontSize={11} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>▶ PLAY COMPILED</Text>
          </Pressable>
        </Box>
      </Box>
    </Box>
  );
}
