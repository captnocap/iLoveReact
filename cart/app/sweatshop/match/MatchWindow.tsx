// MatchWindow — the "ranked match" surface that opens when the user
// hits Lock In on the planning canvas. Two phases for V0:
//
//   loading → champ-select-style boot screen with worker portraits
//             (BlockFace3D inside an Avatar 3D scene), a stat panel,
//             and a top progress bar. Hit "Start match" to advance.
//   in-game → grid of GenericChatCard panels (one per worker) plus a
//             side rail with the existing AssistantChat surface (will
//             later carry the supervisor role).
//
// For V0 the worker roster is synthetic (match-data.ts). Wiring real
// Worker / WorkerSession rows from CompositionRun lands when the
// lock-in flow populates them.

import { useState } from 'react';
import { Box, Col, Row, Pressable, ScrollView, Text, Window } from '@reactjit/runtime/primitives';
import { Avatar } from '@reactjit/runtime/avatar';
import { BlockFace3D } from '../../gallery/components/block-faces/BlockFace3D';
import { GenericChatCard } from '../../gallery/components/generic-chat-card/GenericChatCard';
import { AssistantChat } from '../../chat/AssistantChat';
import { SAMPLE_CHAMPIONS, type ChampionWorker } from './match-data';

type Phase = 'loading' | 'in-game';

export interface MatchWindowProps {
  runId: string;
  onClose: () => void;
}

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
      width={1400}
      height={900}
      onClose={onClose}
    >
      <Col style={{ width: '100%', height: '100%', backgroundColor: 'theme:bg0' }}>
        {phase === 'loading' ? (
          <LoadingPhase
            runId={runId}
            champions={champions}
            progress={progress}
            onAdvanceProgress={() => setProgress((p) => Math.min(1, p + 0.25))}
            onStart={() => setPhase('in-game')}
          />
        ) : (
          <InGamePhase champions={champions} onSurrender={onClose} />
        )}
      </Col>
    </Window>
  );
}

// ── Loading phase ────────────────────────────────────────────────

function LoadingPhase(props: {
  runId: string;
  champions: ChampionWorker[];
  progress: number;
  onAdvanceProgress: () => void;
  onStart: () => void;
}) {
  const { runId, champions, progress, onAdvanceProgress, onStart } = props;
  const ready = progress >= 1;

  return (
    <Col style={{ flexGrow: 1, padding: 24, gap: 20 }}>
      {/* Header with run id + progress */}
      <Col style={{ gap: 8 }}>
        <Row style={{ alignItems: 'baseline', gap: 12 }}>
          <Text size={20} color="theme:ink" bold>Match loading</Text>
          <Text size={11} color="theme:inkDim">{runId}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text size={11} color="theme:inkDim">
            {ready ? 'all systems ready' : 'booting workers, cloning repos, attaching vsock…'}
          </Text>
        </Row>
        <ProgressBar value={progress} />
      </Col>

      {/* Champion grid */}
      <ScrollView style={{ flexGrow: 1, minHeight: 0 }}>
        <Row style={{ flexWrap: 'wrap', gap: 16, justifyContent: 'flex-start' }}>
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
            <Text size={11} color="theme:inkDim">tick boot ({Math.round(progress * 100)}%)</Text>
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
// Avatar's `avatar` prop is required (`avatar.parts.map` crashes if
// undefined). For champion portraits we don't want the body mesh —
// just BlockFace3D children — so pass an empty parts list.
const EMPTY_AVATAR: any = { id: 'champion-portrait', parts: [] };

function ChampionCard({ champion }: { champion: ChampionWorker }) {
  return (
    <Col style={{
      width: 260,
      gap: 8,
      padding: 12,
      borderRadius: 8,
      borderWidth: 1, borderColor: 'theme:rule',
      backgroundColor: 'theme:bg1',
    }}>
      {/* 3D portrait — sphere + textured BlockFace inside an empty
          Scene3D wrapper. Avatar requires avatar.parts; we pass an
          empty list so the wrapper renders only the BlockFace child. */}
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
      {/* Name + role */}
      <Col style={{ gap: 2 }}>
        <Text size={14} color="theme:ink" bold>{champion.name}</Text>
        <Text size={10} color="theme:inkDim">{champion.role}</Text>
      </Col>
      {/* Model + connection */}
      <Row style={{ gap: 6, flexWrap: 'wrap' }}>
        <ChampionPill label={champion.model} />
        <ChampionPill label={champion.connection} />
      </Row>
      {/* Stat panel */}
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

function InGamePhase({ champions, onSurrender }: { champions: ChampionWorker[]; onSurrender: () => void }) {
  return (
    <Row style={{ flexGrow: 1, minHeight: 0 }}>
      {/* Worker grid (left, flex 3) */}
      <Col style={{ flexGrow: 3, flexBasis: 0, minWidth: 0, minHeight: 0 }}>
        <Row style={{
          paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10,
          borderBottomWidth: 1, borderBottomColor: 'theme:rule',
          backgroundColor: 'theme:bg1',
          alignItems: 'center', gap: 12,
        }}>
          <Text size={14} color="theme:ink" bold>Workers</Text>
          <Text size={10} color="theme:inkDim">{champions.length} active</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable onPress={onSurrender} style={{
            paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4,
            borderRadius: 4,
            borderWidth: 1, borderColor: 'theme:warn',
            backgroundColor: 'theme:bg2',
          }}>
            <Text size={11} color="theme:warn">Surrender</Text>
          </Pressable>
        </Row>
        <ScrollView style={{ flexGrow: 1, minHeight: 0, padding: 12 }}>
          <Row style={{ flexWrap: 'wrap', gap: 12 }}>
            {champions.map((c) => (
              <Box key={c.id} style={{ width: 480, height: 360 }}>
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
      </Col>

      {/* Supervisor chat side rail (right, flex 1) */}
      <Col style={{
        flexGrow: 1, flexBasis: 0, minWidth: 320,
        borderLeftWidth: 1, borderLeftColor: 'theme:rule',
        backgroundColor: 'theme:bg1',
      }}>
        <Row style={{
          paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10,
          borderBottomWidth: 1, borderBottomColor: 'theme:rule',
          backgroundColor: 'theme:bg2',
          alignItems: 'center',
        }}>
          <Text size={12} color="theme:ink" bold>Supervisor</Text>
        </Row>
        <Box style={{ flexGrow: 1, minHeight: 0 }}>
          <AssistantChat shape="activity" />
        </Box>
      </Col>
    </Row>
  );
}
