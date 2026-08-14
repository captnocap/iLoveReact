// editor/home/HomeSurface.tsx — the boot surface (req_4435).
//
// What a cold start USED to do: open an arbitrary map called "untitled",
// auto-focus a material nobody picked, describe a build piece nobody armed, and
// offer no route back to yesterday's work. This is the route back.
//
// Three operational blocks and two decorative lines, in that order of size:
//   CONTINUE — the durable session record (data/sessionStore.ts): which map,
//              which tabs, which floor, which camera. One button puts it back.
//   RECENT   — every named map document with its real name and last-modified,
//              newest first, straight from listMapDocuments().
//   NEW      — name it and go.
// The masthead quote and the footer joke are the only non-operational copy on
// the surface, and they are deliberately one line each. Milestone launches get
// confetti (home/confetti.ts) — the app is allowed to notice you came back.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Effect } from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import type { MapDocumentSummary } from '../data/mapDocuments';
import type { EditorSession } from '../data/sessionStore';
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

function formatChunks(count: number | null): string {
  return count === null ? '—' : `${count} chunk${count === 1 ? '' : 's'}`;
}

export default function HomeSurface(props: {
  /** The resumable session, or null on a first run / after a cleared record. */
  session: EditorSession | null;
  /** Every named map document, newest first (listMapDocuments order). */
  maps: readonly MapDocumentSummary[];
  /** Which launch this is — drives both the rotating lines and the milestone. */
  launch: number;
  /** The map the editor is currently holding open behind this tab. */
  currentStem: string;
  onContinue: () => void;
  onOpenMap: (stem: string) => void;
  onNewMap: (name: string) => void;
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
  useEffect(() => {
    if (!celebration) return;
    burstSeedRef.current = Math.random();
    burstStartRef.current = Date.now();
    let live = true;
    const step = () => {
      if (!live) return;
      const elapsed = (Date.now() - burstStartRef.current) / BURST_MS;
      if (elapsed >= 1) { setProgress(0); return; }
      setProgress(elapsed);
      setTimeout(step, BURST_TICK_MS);
    };
    step();
    return () => { live = false; };
  }, [celebration]);

  const throwConfetti = () => {
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

  const bursting = progress > 0;
  const particles = particlesFor(celebration?.intensity ?? 0.45);
  const session = props.session;

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
        <C.HW_HomeQuote>{`“${quote.text}”`}</C.HW_HomeQuote>
        <C.HW_HomeQuoteWho>{`— ${quote.who}`}</C.HW_HomeQuoteWho>
      </C.HW_HomeMasthead>

      <C.HW_HomeColumns>
        {/* CONTINUE — only what the session record can genuinely restore. */}
        <C.HW_HomeCard>
          <C.HW_HomeCardHead>
            <Icon name="History" size={13} color={accentFor(session ? 'primary' : 'textFaint')} />
            <C.HW_HomeCardTitle>CONTINUE</C.HW_HomeCardTitle>
          </C.HW_HomeCardHead>
          {session ? (
            <>
              <C.HW_HomeResumeName>{session.mapName}</C.HW_HomeResumeName>
              <C.HW_HomeResumeMeta>
                {resumeSummary(session.documents.length, session.floorIndex, session.camera !== null)}
              </C.HW_HomeResumeMeta>
              <C.HW_HomeResumeMeta>{`last worked on ${relativeAge(session.savedMs, Date.now())}`}</C.HW_HomeResumeMeta>
              <C.HW_Spacer />
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
          </C.HW_HomeCardHead>
          <C.HW_HomeNameInput value={newName} onChange={setNewName} placeholder="map name" />
          <C.HW_HomeResumeMeta>Blank terrain, no pieces. Rename it any time.</C.HW_HomeResumeMeta>
          <C.HW_Spacer />
          <C.HW_HomeVerb
            onPress={() => props.onNewMap(newName.trim() || 'untitled')}
            tooltip="Create a clean map document and open it"
          >
            <Icon name="Plus" size={12} color={accentFor('textSecondary')} />
            <C.HW_HomeVerbText>Create map</C.HW_HomeVerbText>
          </C.HW_HomeVerb>
        </C.HW_HomeCard>
      </C.HW_HomeColumns>

      {/* RECENT — the real list, real names, real timestamps. */}
      <C.HW_HomeSectionHead>
        <C.HW_HomeCardTitle>RECENT MAPS</C.HW_HomeCardTitle>
        <C.HW_Spacer />
        <C.HW_HomeLaunch>{`${props.maps.length} saved`}</C.HW_HomeLaunch>
      </C.HW_HomeSectionHead>
      <C.HW_HomeMapList showScrollbar>
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
      </C.HW_HomeMapList>

      <C.HW_HomeFooter>
        <C.HW_HomeJoke>{joke}</C.HW_HomeJoke>
        <C.HW_Spacer />
        <C.HW_HomeDice onPress={() => { setReroll((n) => n + 1); if (Math.random() < 0.2) throwConfetti(); }} tooltip="Another one">
          <Icon name="Dices" size={13} color={accentFor('textDim')} />
        </C.HW_HomeDice>
      </C.HW_HomeFooter>
    </C.HW_Home>
  );
}
