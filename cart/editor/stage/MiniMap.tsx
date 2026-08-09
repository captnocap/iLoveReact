import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Boxxx, Canvas, Pressable, Text } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import {
  mapChunkList,
  mapPathSnapshot,
  subscribeMapTerrainChanges,
  type MapPathSnapshot,
} from '../../../runtime/game/map';
import type { PlacedPiece } from '../world/pieces';
import type { WorldView } from '../world/worldViews';
import { WORLD_VIEW_SLOT_COUNT } from '../data/keymap';
import { COASTAL_CITY_TUNING } from '../data/coastalCity';
import {
  CITY_MAP_TUNING,
  cityMapBounds,
  cityMapChunkPath,
  cityMapPathBatches,
  cityMapSiteRects,
  coastalCityMapGeography,
  coastalSeedFromPieces,
  type CityMapChunkTopology,
  type CityMapPathBatch,
} from './cityMapModel';

const MAP_VIEW = {
  fitPaddingPx: 92,
  minimumFitZoom: 0.05,
  snapshotRetryMs: 32,
  snapshotRetryLimit: 120,
  cameraMarkerRadiusM: 24,
  cameraHeadingLengthM: 58,
  // Saved-view pins (req_4168). Sized in WORLD metres like every other mark here,
  // so a pin keeps its footprint on the ground as the overview zooms.
  viewPinRadiusM: 34,
  viewPinLabelWidthM: 240,
  viewPinLabelHeightM: 40,
  viewPinLabelFontM: 22,
  districtLabelWidthM: 300,
  districtLabelHeightM: 46,
  districtLabelFontM: 25,
  chunkStrokeM: 1.5,
  palette: {
    water: '#17394d',
    waterEdge: '#4d92a8',
    land: '#23352a',
    landEdge: '#55705b',
    beach: '#8e835b',
    chunk: '#91b39b',
    roadCasing: '#111817',
    highway: '#d9a44e',
    major: '#ddd5b8',
    local: '#9da99b',
    lightRail: '#55d7cb',
    railway: '#c36d58',
    camera: '#43d7e8',
    cameraHeading: '#e8fbff',
    viewPin: '#e8c15a',
    viewPinEdge: '#fff3d0',
  },
  districtFill: {
    downtown: '#d0a34b',
    industrial: '#af7354',
    mixed: '#588ba0',
    residential: '#5b8c64',
    beachfront: '#8f7eb0',
  },
  protectedFill: {
    beach: '#a7955b',
    wetland: '#3c7468',
    mountain: '#64765c',
    forest: '#2f6847',
    reserve: '#587c55',
  },
  siteFill: {
    downtownCore: '#e7bd62aa',
    harborIndustrial: '#c77b5aaa',
    mainStreetBusiness: '#d8c690aa',
    mixedUse: '#72a7bbaa',
    residential: '#79a978aa',
    beachfront: '#aa96c6aa',
    transitOriented: '#65c7bbaa',
  } as Record<string, string>,
} as const;

type LoadState = 'loading' | 'ready' | 'host-stale';
type ViewRect = { x: number; y: number; width: number; height: number };

function batchColor(batch: CityMapPathBatch): string {
  if (batch.tier === 'highway') return MAP_VIEW.palette.highway;
  if (batch.tier === 'major') return MAP_VIEW.palette.major;
  if (batch.tier === 'local') return MAP_VIEW.palette.local;
  if (batch.tier === 'lightRail') return MAP_VIEW.palette.lightRail;
  return MAP_VIEW.palette.railway;
}

function cameraRingD(x: number, z: number, radius: number): string {
  const points: string[] = [];
  const samples = 20;
  for (let index = 0; index < samples; index += 1) {
    const angle = (index / samples) * Math.PI * 2;
    const px = x + Math.cos(angle) * radius;
    const pz = z + Math.sin(angle) * radius;
    points.push(`${index === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${pz.toFixed(2)}`);
  }
  return `${points.join(' ')} Z`;
}

function cameraHeadingD(x: number, z: number, yawDegrees: number): string {
  const angle = ((yawDegrees + 180) * Math.PI) / 180;
  const tipX = x + Math.sin(angle) * MAP_VIEW.cameraHeadingLengthM;
  const tipZ = z + Math.cos(angle) * MAP_VIEW.cameraHeadingLengthM;
  return `M ${x.toFixed(2)} ${z.toFixed(2)} L ${tipX.toFixed(2)} ${tipZ.toFixed(2)}`;
}

export default function MiniMap(props: {
  pieces: readonly PlacedPiece[];
  camera: { x: number; z: number; yawDegrees: number };
  /** Saved camera views (req_4168) — the overview is where you reach for them on a
   *  3 km map, so each pin is a labelled, clickable jump. */
  views: readonly WorldView[];
  onRecallView: (id: string) => void;
  onCenter: (x: number, z: number) => void;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<MapPathSnapshot | null>(null);
  const [topology, setTopology] = useState<CityMapChunkTopology>({ maxCol: 0, maxRow: 0, chunks: [] });
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [rect, setRect] = useState<ViewRect>({ x: 0, y: 0, width: 1, height: 1 });

  const refresh = useCallback((): boolean => {
    const nextSnapshot = mapPathSnapshot();
    const nextTopology = mapChunkList();
    if (nextSnapshot) setSnapshot(nextSnapshot);
    setTopology(nextTopology);
    const ready = nextSnapshot !== null && nextTopology.chunks.length > 0;
    if (ready) setLoadState('ready');
    return ready;
  }, []);

  useEffect(() => {
    const host: any = globalThis as any;
    if (typeof host.__map_path_snapshot !== 'function') {
      setLoadState('host-stale');
      return;
    }
    if (refresh()) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (refresh() || tries >= MAP_VIEW.snapshotRetryLimit) {
        clearInterval(timer);
        if (tries >= MAP_VIEW.snapshotRetryLimit) setLoadState('ready');
      }
    }, MAP_VIEW.snapshotRetryMs);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => subscribeMapTerrainChanges(() => { refresh(); }), [refresh]);

  const seed = useMemo(() => coastalSeedFromPieces(props.pieces), [props.pieces]);
  const geography = useMemo(() => seed === null ? null : coastalCityMapGeography(seed), [seed]);
  const preferredBounds = useMemo(() => seed === null ? null : ({
    minX: COASTAL_CITY_TUNING.world.minX,
    minZ: COASTAL_CITY_TUNING.world.minZ,
    maxX: COASTAL_CITY_TUNING.world.maxX,
    maxZ: COASTAL_CITY_TUNING.world.maxZ,
  }), [seed]);
  const bounds = useMemo(
    () => cityMapBounds(topology, snapshot, props.pieces, preferredBounds),
    [topology, snapshot, props.pieces, preferredBounds],
  );
  const batches = useMemo(() => cityMapPathBatches(snapshot), [snapshot]);
  const chunkD = useMemo(() => cityMapChunkPath(topology), [topology]);
  const siteRects = useMemo(() => cityMapSiteRects(props.pieces, bounds), [props.pieces, bounds]);
  const siteBoxes = useMemo(() => siteRects.map((site) => ({
    x: site.x,
    y: site.y,
    w: site.w,
    h: site.h,
    radius: 1,
    borderW: 0.8,
    bg: MAP_VIEW.siteFill[site.intendedUse] ?? '#b5c0b58c',
    border: '#e4eee1aa',
  })), [siteRects]);

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const fitZoom = Math.max(
    MAP_VIEW.minimumFitZoom,
    Math.min(
      Math.max(1, rect.width - MAP_VIEW.fitPaddingPx * 2) / bounds.widthM,
      Math.max(1, rect.height - MAP_VIEW.fitPaddingPx * 2) / bounds.depthM,
    ),
  );
  const pathCount = snapshot?.paths.length ?? 0;
  const roadCount = snapshot?.paths.filter((path) => path.kind === 'road').length ?? 0;
  const railCount = pathCount - roadCount;

  const centerFromMap = useCallback((event: any) => {
    const host: any = globalThis as any;
    if (typeof host.__canvas_screen_to_graph !== 'function') return;
    const x = Number(event?.x);
    const y = Number(event?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const point = host.__canvas_screen_to_graph(x, y, rect.x + rect.width / 2, rect.y + rect.height / 2, 0);
    const gx = Number(point?.gx);
    const gz = Number(point?.gy);
    if (Number.isFinite(gx) && Number.isFinite(gz)) props.onCenter(gx, gz);
  }, [props.onCenter, rect]);

  return (
    <Box
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: MAP_VIEW.palette.water }}
      onLayout={(layout: any) => {
        const next = layout?.layout ?? layout ?? {};
        const width = Math.max(1, Number(next.width ?? 1));
        const height = Math.max(1, Number(next.height ?? 1));
        const x = Number(next.x ?? 0);
        const y = Number(next.y ?? 0);
        setRect((previous) => previous.x === x && previous.y === y && previous.width === width && previous.height === height
          ? previous
          : { x, y, width, height });
      }}
    >
      <Canvas
        style={{ width: '100%', height: '100%', backgroundColor: MAP_VIEW.palette.water }}
        viewX={centerX}
        viewY={centerZ}
        viewZoom={fitZoom}
        selectNodes={false}
        onRightClick={centerFromMap}
      >
        <Canvas.Path
          d={`M ${bounds.minX} ${bounds.minZ} L ${bounds.maxX} ${bounds.minZ} L ${bounds.maxX} ${bounds.maxZ} L ${bounds.minX} ${bounds.maxZ} Z`}
          fill={MAP_VIEW.palette.land}
          stroke={MAP_VIEW.palette.landEdge}
          strokeWidth={3}
        />

        {geography ? (
          <>
            {geography.districts.map((district) => (
              <Canvas.Path key={`district-${district.id}`} d={district.d} fill={MAP_VIEW.districtFill[district.kind]} fillOpacity={0.17} stroke={MAP_VIEW.districtFill[district.kind]} strokeOpacity={0.42} strokeWidth={3} />
            ))}
            {geography.protectedAreas.map((area) => (
              <Canvas.Path key={`protected-${area.id}`} d={area.d} fill={MAP_VIEW.protectedFill[area.kind]} fillOpacity={0.34} stroke={MAP_VIEW.protectedFill[area.kind]} strokeOpacity={0.55} strokeWidth={4} />
            ))}
            <Canvas.Path d={geography.beachD} fill={MAP_VIEW.palette.beach} fillOpacity={0.66} stroke="none" />
            <Canvas.Path d={geography.seaD} fill={MAP_VIEW.palette.water} stroke={MAP_VIEW.palette.waterEdge} strokeWidth={4} />
            <Canvas.Path d={geography.riverD} fill={MAP_VIEW.palette.water} stroke={MAP_VIEW.palette.waterEdge} strokeWidth={4} />
          </>
        ) : null}

        {siteBoxes.length ? (
          <Canvas.Node gx={centerX} gy={centerZ} gw={bounds.widthM} gh={bounds.depthM}>
            <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
              <Boxxx boxes={siteBoxes} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} />
            </Box>
          </Canvas.Node>
        ) : null}

        {chunkD ? <Canvas.Path d={chunkD} fill="none" stroke={MAP_VIEW.palette.chunk} strokeOpacity={0.2} strokeWidth={MAP_VIEW.chunkStrokeM} /> : null}
        {batches.map((batch) => (
          <Canvas.Path key={`outer-${batch.key}`} d={batch.d} fill="none" stroke={MAP_VIEW.palette.roadCasing} strokeWidth={batch.outerWidthM} />
        ))}
        {batches.map((batch) => (
          <Canvas.Path key={`inner-${batch.key}`} d={batch.d} fill="none" stroke={batchColor(batch)} strokeWidth={batch.innerWidthM} />
        ))}

        {geography?.districts.map((district) => (
          <Canvas.Node key={`label-${district.id}`} gx={district.x} gy={district.z} gw={MAP_VIEW.districtLabelWidthM} gh={MAP_VIEW.districtLabelHeightM}>
            <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b1211b8', borderWidth: 2, borderColor: MAP_VIEW.districtFill[district.kind], borderRadius: 8 }}>
              <Text fontSize={MAP_VIEW.districtLabelFontM} color="#eff7ee" style={{ fontWeight: '700' }}>{district.name}</Text>
            </Box>
          </Canvas.Node>
        ))}

        {props.views.map((view) => (
          <Canvas.Path
            key={`view-pin-${view.id}`}
            d={cameraRingD(view.centerX, view.centerZ, MAP_VIEW.viewPinRadiusM)}
            fill={MAP_VIEW.palette.viewPin}
            fillOpacity={0.3}
            stroke={MAP_VIEW.palette.viewPinEdge}
            strokeWidth={6}
          />
        ))}
        {props.views.map((view, index) => (
          <Canvas.Node
            key={`view-label-${view.id}`}
            gx={view.centerX}
            gy={view.centerZ - MAP_VIEW.viewPinLabelHeightM}
            gw={MAP_VIEW.viewPinLabelWidthM}
            gh={MAP_VIEW.viewPinLabelHeightM}
          >
            <Pressable onPress={() => props.onRecallView(view.id)} tooltip={`Jump to ${view.name}`} style={{ width: '100%', height: '100%' }}>
              <Box style={{ width: '100%', height: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#0b1211c8', borderWidth: 2, borderColor: MAP_VIEW.palette.viewPin, borderRadius: 8 }}>
                {/* The 1..9 jump key, so the map teaches the shortcut it belongs to (req_4172). */}
                {index < WORLD_VIEW_SLOT_COUNT ? (
                  <Text fontSize={MAP_VIEW.viewPinLabelFontM} color={MAP_VIEW.palette.viewPin} style={{ fontWeight: '800' }}>{String(index + 1)}</Text>
                ) : null}
                <Text fontSize={MAP_VIEW.viewPinLabelFontM} color="#fff3d0" style={{ fontWeight: '700' }}>{view.name}</Text>
              </Box>
            </Pressable>
          </Canvas.Node>
        ))}

        <Canvas.Path d={cameraHeadingD(props.camera.x, props.camera.z, props.camera.yawDegrees)} fill="none" stroke={MAP_VIEW.palette.cameraHeading} strokeWidth={8} />
        <Canvas.Path d={cameraRingD(props.camera.x, props.camera.z, MAP_VIEW.cameraMarkerRadiusM)} fill={MAP_VIEW.palette.camera} fillOpacity={0.35} stroke={MAP_VIEW.palette.cameraHeading} strokeWidth={7} />

        <Canvas.Clamp>
          <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
            <Box style={{ position: 'absolute', left: 14, top: 14, minWidth: 310, paddingLeft: 12, paddingRight: 12, paddingTop: 9, paddingBottom: 9, gap: 4, backgroundColor: '#091111ee', borderWidth: 1, borderColor: '#4d6d65', borderRadius: 7 }}>
              <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Icon name="Map" size={14} color="#55d7cb" />
                <Text fontSize={12} color="#f2f7f4" style={{ fontWeight: '800' }}>LINKED CITY MAP</Text>
                <Box style={{ flexGrow: 1 }} />
                <Text fontSize={9} color="#78d7cc">LIVE</Text>
              </Box>
              <Text fontSize={10} color="#a7b8b1">{roadCount} roads · {railCount} rail paths · {topology.chunks.length} chunks · {siteBoxes.length} building sites</Text>
              {loadState === 'loading' ? <Text fontSize={9} color="#d9a44e">reading native transport recipes…</Text> : null}
              {loadState === 'host-stale' ? <Text fontSize={9} color="#f08b75">dev host is stale — rebuild the editor binary for the map snapshot door</Text> : null}
            </Box>

            <Pressable onPress={props.onClose} style={{ position: 'absolute', right: 14, top: 14 }}>
              <Box style={{ height: 34, paddingLeft: 11, paddingRight: 11, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#091111ee', borderWidth: 1, borderColor: '#55d7cb', borderRadius: 7 }}>
                <Icon name="Box" size={13} color="#55d7cb" />
                <Text fontSize={10} color="#e7f7f4" style={{ fontWeight: '700' }}>3D VIEW · M</Text>
              </Box>
            </Pressable>

            <Box style={{ position: 'absolute', left: 14, bottom: 14, paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, backgroundColor: '#091111dd', borderWidth: 1, borderColor: '#384f49', borderRadius: 6 }}>
              <Text fontSize={9} color="#b9c8c2">DRAG pan · WHEEL zoom · RIGHT-CLICK move 3D camera · cyan marker = current view · gold pin = saved view</Text>
            </Box>

            <Box style={{ position: 'absolute', right: 14, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, backgroundColor: '#091111dd', borderWidth: 1, borderColor: '#384f49', borderRadius: 6 }}>
              <Text fontSize={9} color={MAP_VIEW.palette.highway}>HIGHWAY</Text>
              <Text fontSize={9} color={MAP_VIEW.palette.major}>STREET</Text>
              <Text fontSize={9} color={MAP_VIEW.palette.lightRail}>LRT</Text>
              <Text fontSize={9} color={MAP_VIEW.palette.railway}>RAIL</Text>
            </Box>
          </Box>
        </Canvas.Clamp>
      </Canvas>
    </Box>
  );
}
