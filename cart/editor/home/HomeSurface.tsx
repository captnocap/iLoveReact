// editor/home/HomeSurface.tsx — the hub (req_4435 boot surface, req_4464 hub).
//
// It started as a resume board and it was mostly a void: a Continue card, a New
// card, one map row, and eight hundred vertical pixels of nothing. Meanwhile
// the Asset Explorer three panels away was sitting on nineteen real recents
// with real thumbnails. Home reports nothing the app does not already know, so
// the fix was not to invent filler — it was to show what was already there.
//
// Home is now the DESTINATION PICKER as well as the boot frame. The chrome's
// workspace switcher sends you here whenever a destination needs a subject it
// does not have (shell/destinations.ts), scoped to that subject — so "go to the
// model studio" with nothing open lands on a grid of your models rather than
// doing nothing at all.
//
//   masthead   brand · launch · quote, and confetti on a milestone
//   resume     Continue where you left off / New map
//   library    filter chips + a thumbnail grid of recents or favorites
//   footer     one joke
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Effect } from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import type { MapDocumentSummary } from '../data/mapDocuments';
import type { EditorSession } from '../data/sessionStore';
import type { Asset, HomeFilter, ModelPackage } from '../data/types';
import { librarySearchHitKey, type LibrarySearchHit } from '../data/librarySearch';
import AssetPreview from '../library/AssetPreview';
import ModelThumbnail from '../library/ModelThumbnail';
import {
  BURST_MS,
  BURST_TICK_MS,
  CONFETTI_SHADER,
  confettiData,
  particlesFor,
} from './confetti';
import {
  JOKES,
  QUOTES,
  absoluteStamp,
  celebrationFor,
  pick,
  relativeAge,
  resumeSummary,
} from './homeContent';

/** The filter chips, in strip order. Each one is also a destination subject —
 *  pressing Model in the chrome with nothing open selects the same chip. */
const FILTERS: readonly { id: HomeFilter; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: 'LayoutGrid' },
  { id: 'model', label: 'Models', icon: 'Boxes' },
  { id: 'material', label: 'Materials', icon: 'FlaskConical' },
  { id: 'map', label: 'Maps', icon: 'Globe2' },
];

/** The badge on a card — the same vocabulary the Asset Explorer's rows use, so
 *  an item reads the same wherever you meet it. */
function assetBadge(asset: Asset): string {
  if (asset.tab === 'Skins') return 'MATERIAL';
  if (asset.tab === 'Build') return 'BUILD';
  return 'PROP';
}

function modelBadge(model: ModelPackage): string {
  const placeable = model.placeable?.as;
  if (placeable === 'character') return 'CHARACTER';
  if (placeable === 'flora') return 'FLORA';
  if (placeable === 'prop') return 'PROP';
  if (placeable === 'build-piece') return 'BUILD';
  return 'MODEL';
}

function formatChunks(count: number | null): string {
  return count === null ? '—' : `${count} chunk${count === 1 ? '' : 's'}`;
}

export default function HomeSurface(props: {
  /** The resumable session, or null on a first run / after a cleared record. */
  session: EditorSession | null;
  /** Every named map document, newest first (listMapDocuments order). */
  maps: readonly MapDocumentSummary[];
  /** Mixed model+material history, newest first, and the pinned set. Both come
   *  straight from the Asset Explorer's own collections — Home reports what the
   *  library already knows rather than keeping a second list. */
  recents: readonly LibrarySearchHit[];
  favorites: readonly LibrarySearchHit[];
  /** Which launch this is — drives both the rotating lines and the milestone. */
  launch: number;
  /** The map the editor is currently holding open behind this tab. */
  currentStem: string;
  filter: HomeFilter;
  showFavorites: boolean;
  onFilter: (filter: HomeFilter) => void;
  onShowFavorites: (on: boolean) => void;
  onContinue: () => void;
  onOpenMap: (stem: string) => void;
  onNewMap: (name: string) => void;
  onOpenModel: (model: ModelPackage) => void;
  onOpenMaterial: (asset: Asset) => void;
}) {
  // The lines rotate per launch, so the surface is different when you come back
  // but stable while you sit on it. The dice offsets that pick.
  const [reroll, setReroll] = useState(0);
  const [newName, setNewName] = useState('');
  const quote = pick(QUOTES, props.launch + reroll);
  const joke = pick(JOKES, props.launch * 3 + reroll);

  // Celebration is decided ONCE per mount: re-deciding on every render would
  // re-roll the surprise odds every keystroke and confetti would never stop.
  const celebration = useMemo(
    () => celebrationFor(props.launch, Math.random()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.launch],
  );

  // Burst progress, driven by setTimeout — this runtime has no rAF.
  const [progress, setProgress] = useState(0);
  const burstStartRef = useRef(0);
  const burstSeedRef = useRef(0);
  const runBurst = () => {
    burstSeedRef.current = Math.random();
    burstStartRef.current = Date.now();
    const step = () => {
      const elapsed = (Date.now() - burstStartRef.current) / BURST_MS;
      if (elapsed >= 1) { setProgress(0); return; }
      setProgress(elapsed);
      setTimeout(step, BURST_TICK_MS);
    };
    step();
  };
  useEffect(() => {
    if (!celebration) return;
    runBurst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebration]);

  const bursting = progress > 0;
  const particles = particlesFor(celebration?.intensity ?? 0.45);
  const session = props.session;

  // The grid's contents. Maps are their own family (they are documents, not
  // library items), so the 'map' filter swaps the source rather than filtering
  // the same list — and 'all' shows library items, because a map is one row you
  // already have above and not a thumbnail worth repeating.
  const source = props.showFavorites ? props.favorites : props.recents;
  const libraryItems = useMemo(() => source.filter((hit) => {
    if (props.filter === 'model') return hit.kind === 'model';
    if (props.filter === 'material') return hit.kind === 'asset';
    return props.filter !== 'map';
  }), [source, props.filter]);
  const showingMaps = props.filter === 'map';
  const count = showingMaps ? props.maps.length : libraryItems.length;

  return (
    <C.HW_Home>
      <C.HW_HomeMasthead>
        {bursting ? (
          <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
            <Effect
              shader={CONFETTI_SHADER}
              data={confettiData(progress, particles, burstSeedRef.current)}
              style={{ width: '100%', height: '100%' }}
            />
          </Box>
        ) : null}
        <C.HW_HomeBrandRow>
          <Icon name="Boxes" size={18} color={accentFor('primary')} />
          <C.HW_HomeBrand>SHITTY GAMES · EDITOR</C.HW_HomeBrand>
          <C.HW_HomeQuoteInline>{`“${quote.text}” — ${quote.who}`}</C.HW_HomeQuoteInline>
          <C.HW_Spacer />
          {celebration ? (
            <C.HW_HomeMilestone>
              <Icon name="PartyPopper" size={11} color={accentFor('warning')} />
              <C.HW_HomeMilestoneText>{celebration.label}</C.HW_HomeMilestoneText>
            </C.HW_HomeMilestone>
          ) : (
            <C.HW_HomeLaunch>{`launch #${props.launch}`}</C.HW_HomeLaunch>
          )}
        </C.HW_HomeBrandRow>
      </C.HW_HomeMasthead>

      <C.HW_HomeColumns>
        {/* CONTINUE — only what the session record can genuinely restore. */}
        <C.HW_HomeCard>
          <C.HW_HomeCardHead>
            <Icon name="History" size={13} color={accentFor(session ? 'primary' : 'textFaint')} />
            <C.HW_HomeCardTitle>CONTINUE</C.HW_HomeCardTitle>
            <C.HW_Spacer />
            {session ? <C.HW_HomeResumeMeta>{relativeAge(session.savedMs, Date.now())}</C.HW_HomeResumeMeta> : null}
          </C.HW_HomeCardHead>
          {session ? (
            <>
              <C.HW_HomeResumeRow>
                <C.HW_HomeResumeName>{session.mapName}</C.HW_HomeResumeName>
                <C.HW_Spacer />
                <C.HW_HomeResumeMeta>
                  {resumeSummary(session.documents.length, session.floorIndex, session.camera !== null)}
                </C.HW_HomeResumeMeta>
              </C.HW_HomeResumeRow>
              <C.HW_HomePrimaryVerb
                onPress={props.onContinue}
                tooltip={`Reopen ${session.mapName} with its tabs, floor and camera`}
              >
                <Icon name="Play" size={12} color={accentFor('segActiveText')} />
                <C.HW_HomePrimaryVerbText>Continue where you left off</C.HW_HomePrimaryVerbText>
              </C.HW_HomePrimaryVerb>
            </>
          ) : (
            <C.HW_HomeResumeMeta>No saved session yet — open a map and it records itself.</C.HW_HomeResumeMeta>
          )}
        </C.HW_HomeCard>

        {/* NEW — a name and a button. */}
        <C.HW_HomeCard>
          <C.HW_HomeCardHead>
            <Icon name="FilePlus2" size={13} color={accentFor('primary')} />
            <C.HW_HomeCardTitle>NEW MAP</C.HW_HomeCardTitle>
            <C.HW_Spacer />
            <C.HW_HomeResumeMeta>blank terrain, no pieces</C.HW_HomeResumeMeta>
          </C.HW_HomeCardHead>
          <C.HW_HomeNameInput value={newName} onChange={setNewName} placeholder="map name" />
          <C.HW_HomeVerb
            onPress={() => props.onNewMap(newName.trim() || 'untitled')}
            tooltip="Create a clean map document and open it"
          >
            <Icon name="Plus" size={12} color={accentFor('textSecondary')} />
            <C.HW_HomeVerbText>Create map</C.HW_HomeVerbText>
          </C.HW_HomeVerb>
        </C.HW_HomeCard>
      </C.HW_HomeColumns>

      {/* LIBRARY — the recents and favorites the Asset Explorer already has,
          with the thumbnails they already staged. */}
      <C.HW_HomeSectionHead>
        {FILTERS.map((entry) => {
          const on = props.filter === entry.id;
          const Chip = on ? C.HW_HomeChipOn : C.HW_HomeChip;
          const Label = on ? C.HW_HomeChipTextOn : C.HW_HomeChipText;
          return (
            <Chip key={entry.id} onPress={() => props.onFilter(entry.id)} tooltip={`Show ${entry.label.toLowerCase()}`}>
              <Icon name={entry.icon} size={11} color={accentFor(on ? 'segActiveText' : 'textDim')} />
              <Label>{entry.label}</Label>
            </Chip>
          );
        })}
        {showingMaps ? null : (
          <C.HW_HomeChipDivider />
        )}
        {showingMaps ? null : (() => {
          const Chip = props.showFavorites ? C.HW_HomeChipOn : C.HW_HomeChip;
          const Label = props.showFavorites ? C.HW_HomeChipTextOn : C.HW_HomeChipText;
          return (
            <Chip
              onPress={() => props.onShowFavorites(!props.showFavorites)}
              tooltip={props.showFavorites ? 'Show recent instead' : 'Show pinned favorites instead'}
            >
              <Icon name="Star" size={11} color={accentFor(props.showFavorites ? 'segActiveText' : 'warning')} />
              <Label>Favorites</Label>
            </Chip>
          );
        })()}
        <C.HW_Spacer />
        <C.HW_HomeLaunch>{`${count} item${count === 1 ? '' : 's'}`}</C.HW_HomeLaunch>
      </C.HW_HomeSectionHead>

      <C.HW_HomeGridScroll showScrollbar>
        {showingMaps ? (
          <C.HW_HomeMapColumn>
            {props.maps.length === 0 ? (
              <C.HW_HomeResumeMeta>No map documents on disk yet.</C.HW_HomeResumeMeta>
            ) : props.maps.map((map) => {
              const open = map.stem === props.currentStem;
              const Row = open ? C.HW_HomeMapRowOn : C.HW_HomeMapRow;
              return (
                <Row
                  key={map.stem}
                  onPress={() => props.onOpenMap(map.stem)}
                  tooltip={`${map.name} — ${map.stem}${open ? ' (already open)' : ''}`}
                >
                  <Icon name={open ? 'MapPinned' : 'Map'} size={13} color={accentFor(open ? 'primary' : 'textDim')} />
                  <C.HW_HomeMapName>{map.name}</C.HW_HomeMapName>
                  <C.HW_Spacer />
                  <C.HW_HomeMapFact>{formatChunks(map.chunkCount)}</C.HW_HomeMapFact>
                  <C.HW_HomeMapStamp>{absoluteStamp(map.modifiedMs)}</C.HW_HomeMapStamp>
                </Row>
              );
            })}
          </C.HW_HomeMapColumn>
        ) : libraryItems.length === 0 ? (
          <C.HW_HomeEmpty>
            <Icon name={props.showFavorites ? 'Star' : 'History'} size={18} color={accentFor('textFaint')} />
            <C.HW_HomeEmptyLine>
              {props.showFavorites
                ? 'Nothing pinned yet — press the star on a model or material to keep it here.'
                : 'Nothing opened yet — pick something in the Asset Explorer and it lands here.'}
            </C.HW_HomeEmptyLine>
          </C.HW_HomeEmpty>
        ) : (
          <C.HW_HomeGrid>
            {libraryItems.map((hit) => {
              const key = librarySearchHitKey(hit);
              if (hit.kind === 'model') {
                const model = hit.model;
                return (
                  <C.HW_HomeTile
                    key={key}
                    onPress={() => props.onOpenModel(model)}
                    tooltip={`Open ${model.name} in the model studio`}
                  >
                    <C.HW_HomeTileArt style={{ backgroundColor: model.thumbnail ? undefined : model.color }}>
                      {/* A model with no STAGED shot shows a glyph rather than a
                          flat colour field — a blank swatch reads as broken,
                          and the honest fact is "nobody has framed this yet". */}
                      {model.thumbnail
                        ? <ModelThumbnail model={model} />
                        : <Icon name="Box" size={22} color={accentFor('textFaint')} />}
                    </C.HW_HomeTileArt>
                    <C.HW_HomeTileText>
                      <C.HW_HomeTileName>{model.name}</C.HW_HomeTileName>
                      <C.HW_HomeTileBadge>{modelBadge(model)}</C.HW_HomeTileBadge>
                    </C.HW_HomeTileText>
                  </C.HW_HomeTile>
                );
              }
              const asset = hit.asset;
              return (
                <C.HW_HomeTile
                  key={key}
                  onPress={() => props.onOpenMaterial(asset)}
                  tooltip={`Open ${asset.name} in the Material Lab`}
                >
                  <C.HW_HomeTileArt>
                    <AssetPreview asset={asset} />
                  </C.HW_HomeTileArt>
                  <C.HW_HomeTileText>
                    <C.HW_HomeTileName>{asset.name}</C.HW_HomeTileName>
                    <C.HW_HomeTileBadge>{assetBadge(asset)}</C.HW_HomeTileBadge>
                  </C.HW_HomeTileText>
                </C.HW_HomeTile>
              );
            })}
          </C.HW_HomeGrid>
        )}
      </C.HW_HomeGridScroll>

      <C.HW_HomeFooter>
        <C.HW_HomeJoke>{joke}</C.HW_HomeJoke>
        <C.HW_Spacer />
        <C.HW_HomeDice onPress={() => { setReroll((n) => n + 1); if (Math.random() < 0.2) runBurst(); }} tooltip="Another one">
          <Icon name="Dices" size={13} color={accentFor('textDim')} />
        </C.HW_HomeDice>
      </C.HW_HomeFooter>
    </C.HW_Home>
  );
}
