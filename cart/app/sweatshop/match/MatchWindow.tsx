// MatchWindow — the "ranked match" surface that opens when the user
// hits Lock In on the planning canvas.
//
// Shell mirrors the main app: persistent right-rail chat + InputStrip,
// chrome at the top, content area swaps between phases:
//
//   loading → champ-select boot screen with worker portraits, stat
//             panels, top progress bar.
//   in-game → grid of GenericChatCard panels (one per worker).
//
// The right rail carries AssistantChat (shape='side') over an
// InputStrip — same components the main app uses, so the user can
// actually talk to the supervisor from inside the match. Chat session
// state is module-singleton, so the conversation here is the same
// thread as the one in the main window.

import { useState } from 'react';
import { Box, Col, Row, Pressable, ScrollView, Text, Window } from '@reactjit/runtime/primitives';
import { Router, Route, Link, useNavigate, useRoute } from '@reactjit/runtime/router';
import { Avatar } from '@reactjit/runtime/avatar';
import { BlockFace3D } from '../../gallery/components/block-faces/BlockFace3D';
import { GenericChatCard } from '../../gallery/components/generic-chat-card/GenericChatCard';
import { AssistantChat } from '../../chat/AssistantChat';
import { InputStrip } from '../../InputStrip';
import { SAMPLE_CHAMPIONS, type ChampionWorker } from './match-data';

type Phase = 'loading' | 'in-game';

export interface MatchWindowProps {
  runId: string;
  onClose: () => void;
}

const CHAT_RAIL_WIDTH = 380;

export function MatchWindow({ runId, onClose }: MatchWindowProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  // Synthetic boot progress for V0 — climbs to 100% over time and
  // reflects the "VMs booting / repos cloning" stages we'll wire to
  // real session lifecycle events later.
  const [progress, setProgress] = useState(0);
  const champions = SAMPLE_CHAMPIONS;

  return (
    <Window
      title={`Match ${runId}`}
      width={1480}
      height={940}
      onClose={onClose}
    >
      <Row style={{ width: '100%', height: '100%', backgroundColor: 'theme:bg0' }}>
        {/* Content column (everything except the chat rail) */}
        <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}>
          {/* Top chrome — same height as the main app's chrome strip,
              minus the route nav. Carries run id + close/surrender. */}
          <Row style={{
            paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10,
            gap: 12, alignItems: 'center',
            borderBottomWidth: 1, borderBottomColor: 'theme:rule',
            backgroundColor: 'theme:bg1',
          }}>
            <Text size={14} color="theme:ink" bold>Match</Text>
            <Text size={11} color="theme:inkDim">{runId}</Text>
            <Box style={{ flexGrow: 1 }} />
            <Text size={10} color="theme:inkDim">
              {phase === 'loading' ? 'BOOT' : 'IN-GAME'}
            </Text>
            {phase === 'in-game' && (
              <Pressable onPress={onClose} style={{
                paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4,
                borderRadius: 4,
                borderWidth: 1, borderColor: 'theme:warn',
                backgroundColor: 'theme:bg2',
              }}>
                <Text size={11} color="theme:warn">Surrender</Text>
              </Pressable>
            )}
            <Pressable onPress={onClose} style={{
              paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4,
              borderRadius: 4,
              borderWidth: 1, borderColor: 'theme:rule',
              backgroundColor: 'theme:bg2',
            }}>
              <Text size={11} color="theme:inkDim">Close ✕</Text>
            </Pressable>
          </Row>

          {/* Body */}
          <Box style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
            {phase === 'loading' ? (
              <LoadingPhase
                champions={champions}
                progress={progress}
                onAdvanceProgress={() => setProgress((p) => Math.min(1, p + 0.25))}
                onStart={() => setPhase('in-game')}
              />
            ) : (
              <InGamePhase champions={champions} />
            )}
          </Box>

          {/* Router probe — sanity-check that nesting a Router inside a
              Window mounts and Routes match. Mounted unconditionally so
              we can see it across phases. NB: the host's router history
              is process-wide (one __routerInit / __routerCurrentPath
              set), so navigations here also move the main window —
              that's the thing we're checking. */}
          <Box style={{
            flexShrink: 0,
            borderTopWidth: 1, borderTopColor: 'theme:rule',
            backgroundColor: 'theme:bg2',
          }}>
            <Router local initialPath="/match" hotKey="match-window">
              <RouterProbe />
            </Router>
          </Box>
        </Col>

        {/* Chat rail — full app shell minus route nav: chrome strip,
            AssistantChat (live transcript, same module-singleton store
            as the main app), and the InputStrip docked at the bottom
            so the user can actually talk to the supervisor. */}
        <Col style={{
          flexBasis: CHAT_RAIL_WIDTH,
          flexShrink: 0,
          width: CHAT_RAIL_WIDTH,
          borderLeftWidth: 1, borderLeftColor: 'theme:rule',
          backgroundColor: 'theme:bg1',
          minHeight: 0,
        }}>
          <Row style={{
            paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10,
            borderBottomWidth: 1, borderBottomColor: 'theme:rule',
            backgroundColor: 'theme:bg2',
            alignItems: 'center', gap: 8,
          }}>
            <Box style={{
              width: 8, height: 8, borderRadius: 4,
              backgroundColor: 'theme:accent',
            }} />
            <Text size={12} color="theme:ink" bold>Supervisor</Text>
            <Box style={{ flexGrow: 1 }} />
            <Text size={10} color="theme:inkDim">LIVE</Text>
          </Row>
          {/* Live transcript — fills the rail above the input dock. */}
          <Box style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, overflow: 'hidden' }}>
            <AssistantChat shape="side" />
          </Box>
          {/* Input dock — same composer as the main app's bottom-strip
              variant. Submitting fires askAssistant() which pushes into
              the shared chat store, so transcripts stay in sync across
              this window and the main one. */}
          <Box style={{
            flexShrink: 0,
            borderTopWidth: 1, borderTopColor: 'theme:rule',
            backgroundColor: 'theme:bg1',
            padding: 8,
          }}>
            <InputStrip />
          </Box>
        </Col>
      </Row>
    </Window>
  );
}

// ── Router probe ────────────────────────────────────────────────
//
// Three Routes under the match-window Router. Click a Link to switch
// between them and watch the active panel swap. The current path is
// printed top-right so you can see whether navigating here also moves
// the main window's router (it shares the same host history).

function RouterProbe() {
  const ctx = useRoute();
  const nav = useNavigate();
  return (
    <Col style={{ padding: 10, gap: 8 }}>
      <Row style={{ alignItems: 'center', gap: 8 }}>
        <Text size={10} color="theme:inkDim" bold>ROUTER PROBE</Text>
        <Box style={{ flexGrow: 1 }} />
        <Text size={10} color="theme:inkDim">path:&nbsp;</Text>
        <Text size={10} color="theme:accent" bold>{ctx.path}</Text>
      </Row>
      <Row style={{ gap: 6 }}>
        <ProbeLink to="/match"          label="boot"    active={ctx.path === '/match'} />
        <ProbeLink to="/match/dossier"  label="dossier" active={ctx.path === '/match/dossier'} />
        <ProbeLink to="/match/timeline" label="timeline" active={ctx.path === '/match/timeline'} />
        <Box style={{ flexGrow: 1 }} />
        <Pressable onPress={() => nav.push('/somewhere/else')} style={{
          paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3,
          borderRadius: 4,
          borderWidth: 1, borderColor: 'theme:warn',
          backgroundColor: 'theme:bg1',
        }}>
          <Text size={10} color="theme:warn">push /somewhere/else</Text>
        </Pressable>
      </Row>
      <Box style={{
        padding: 8,
        borderWidth: 1, borderColor: 'theme:rule',
        borderRadius: 6,
        backgroundColor: 'theme:bg1',
        minHeight: 28,
      }}>
        <Route path="/match">
          <Text size={11} color="theme:ink">matched /match — boot view (default)</Text>
        </Route>
        <Route path="/match/dossier">
          <Text size={11} color="theme:ink">matched /match/dossier — pretend champion dossier here</Text>
        </Route>
        <Route path="/match/timeline">
          <Text size={11} color="theme:ink">matched /match/timeline — pretend run timeline here</Text>
        </Route>
        <Route fallback>
          <Text size={11} color="theme:warn">fallback — no route registered for "{ctx.path}"</Text>
        </Route>
      </Box>
    </Col>
  );
}

function ProbeLink({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link to={to} style={{
      paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: active ? 'theme:accent' : 'theme:rule',
      backgroundColor: active ? 'theme:bg2' : 'theme:bg1',
    }}>
      <Text size={10} color={active ? 'theme:accent' : 'theme:inkDim'} bold>{label}</Text>
    </Link>
  );
}

// ── Loading phase ────────────────────────────────────────────────

function LoadingPhase(props: {
  champions: ChampionWorker[];
  progress: number;
  onAdvanceProgress: () => void;
  onStart: () => void;
}) {
  const { champions, progress, onAdvanceProgress, onStart } = props;
  const ready = progress >= 1;

  return (
    <Col style={{ flexGrow: 1, minHeight: 0, padding: 24, gap: 20 }}>
      {/* Progress strip */}
      <Col style={{ gap: 8 }}>
        <Row style={{ alignItems: 'baseline', gap: 12 }}>
          <Text size={16} color="theme:ink" bold>Boot</Text>
          <Text size={11} color="theme:inkDim">
            {ready ? 'all systems ready' : 'booting workers, cloning repos, attaching vsock…'}
          </Text>
          <Box style={{ flexGrow: 1 }} />
          <Text size={11} color="theme:inkDim">{Math.round(progress * 100)}%</Text>
        </Row>
        <ProgressBar value={progress} />
      </Col>

      {/* Champion grid */}
      <ScrollView style={{ flexGrow: 1, minHeight: 0 }}>
        <Row style={{ flexWrap: 'wrap', gap: 16, justifyContent: 'flex-start', paddingBottom: 16 }}>
          {champions.map((c) => (
            <ChampionCard key={c.id} champion={c} />
          ))}
        </Row>
      </ScrollView>

      {/* Footer actions */}
      <Row style={{ gap: 12, justifyContent: 'flex-end' }}>
        {!ready && (
          <Pressable onPress={onAdvanceProgress} style={{
            paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6,
            borderRadius: 6,
            borderWidth: 1, borderColor: 'theme:rule',
            backgroundColor: 'theme:bg2',
          }}>
            <Text size={11} color="theme:inkDim">tick boot</Text>
          </Pressable>
        )}
        <Pressable onPress={onStart} style={{
          paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8,
          borderRadius: 6,
          borderWidth: 1, borderColor: ready ? 'theme:accent' : 'theme:rule',
          backgroundColor: ready ? 'theme:bg2' : 'transparent',
          opacity: ready ? 1 : 0.5,
        }}>
          <Text size={12} color={ready ? 'theme:accent' : 'theme:inkDim'} bold>
            Start match ↵
          </Text>
        </Pressable>
      </Row>
    </Col>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <Box style={{
      width: '100%',
      height: 6,
      borderRadius: 3,
      backgroundColor: 'theme:bg2',
      overflow: 'hidden',
    }}>
      <Box style={{
        width: `${pct * 100}%`,
        height: '100%',
        backgroundColor: 'theme:accent',
      }} />
    </Box>
  );
}

const PORTRAIT_H = 180;
// Avatar's `avatar` prop is required (avatar.parts.map crashes on undefined).
// We don't want a body mesh on champion portraits — just the BlockFace3D
// child rendering on a sphere — so pass an empty parts list.
const EMPTY_AVATAR: any = { id: 'champion-portrait', parts: [] };

function ChampionCard({ champion }: { champion: ChampionWorker }) {
  return (
    <Col style={{
      width: 240,
      flexShrink: 0,
      gap: 8,
      padding: 12,
      borderRadius: 8,
      borderWidth: 1, borderColor: 'theme:rule',
      backgroundColor: 'theme:bg1',
    }}>
      <Avatar
        avatar={EMPTY_AVATAR}
        style={{ width: '100%', height: PORTRAIT_H, borderRadius: 6 }}
        backgroundColor="#1a1f2b"
        cameraPosition={[0, 1.55, 1.5]}
        cameraTarget={[0, 1.55, 0]}
        cameraFov={48}
      >
        <BlockFace3D
          center={[0, 1.55, 0]}
          radius={0.42}
          archetype={champion.archetype}
          seed={champion.seed}
        />
      </Avatar>
      <Col style={{ gap: 2 }}>
        <Text size={14} color="theme:ink" bold>{champion.name}</Text>
        <Text size={10} color="theme:inkDim">{champion.role}</Text>
      </Col>
      <Row style={{ gap: 6, flexWrap: 'wrap' }}>
        <ChampionPill label={champion.model} />
        <ChampionPill label={champion.connection} />
      </Row>
      <Col style={{ gap: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'theme:rule' }}>
        <StatRow label="runs"      value={String(champion.stats.runs)} />
        <StatRow label="win rate"  value={champion.stats.winRate} />
        <StatRow label="avg time"  value={champion.stats.avgMs} />
        <StatRow label="top tools" value={champion.stats.topTools.join(' · ')} />
      </Col>
    </Col>
  );
}

function ChampionPill({ label }: { label: string }) {
  return (
    <Box style={{
      paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2,
      borderRadius: 4,
      borderWidth: 1, borderColor: 'theme:rule',
      backgroundColor: 'theme:bg2',
    }}>
      <Text size={9} color="theme:inkDim">{label}</Text>
    </Box>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ alignItems: 'baseline', gap: 8 }}>
      <Text size={9} color="theme:inkDimmer" style={{ width: 64 }}>{label}</Text>
      <Text size={10} color="theme:ink">{value}</Text>
    </Row>
  );
}

// ── In-game phase ────────────────────────────────────────────────
//
// Render GenericChatCard at its native width (CHAT_CARD.width = 506)
// in a wrap row. No fixed-pixel wrapper — the card's intrinsic shape
// is what makes its sub-pieces (header, telemetry, transcript) line
// up; clipping it with overflow:hidden was the bug from last pass.

function InGamePhase({ champions }: { champions: ChampionWorker[] }) {
  return (
    <ScrollView style={{ flexGrow: 1, minHeight: 0, padding: 16 }}>
      <Row style={{ flexWrap: 'wrap', gap: 20, paddingBottom: 16, alignItems: 'flex-start' }}>
        {champions.map((c) => (
          <Box key={c.id} style={{ flexShrink: 0 }}>
            <GenericChatCard
              header={{
                title: c.name,
                pathology: c.role.toUpperCase(),
                achievement: '',
                trust: 'B',
                note: c.model,
                mode: 'live',
              }}
            />
          </Box>
        ))}
      </Row>
    </ScrollView>
  );
}
