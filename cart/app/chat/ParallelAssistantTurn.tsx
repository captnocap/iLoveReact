import { useMemo, useState } from 'react';
import { Box, Pressable, Text, TextInput } from '@reactjit/runtime/primitives';
import type { AssistantTurn, ParallelCandidate } from './types';
import { selectParallelCandidate } from './store';
import { AssistantSurface } from './AssistantSurface';

type ModelOption = { id: string; label: string };

function statusFor(c: ParallelCandidate): string {
  if (c.selected) return 'CHOICE';
  if (c.pending) return 'GENERATING';
  if (c.error) return 'ERROR';
  return 'READY';
}

function ModelLaneControl({
  candidate,
  laneIndex,
  modelOptions,
  onSelectModel,
  onRemove,
  canRemove,
}: {
  candidate: ParallelCandidate;
  laneIndex: number;
  modelOptions: ModelOption[];
  onSelectModel: (laneIndex: number, modelId: string) => void;
  onRemove: (laneIndex: number) => void;
  canRemove: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? modelOptions.filter((m) => `${m.label} ${m.id}`.toLowerCase().includes(q))
      : modelOptions;
    return rows.slice(0, 8);
  }, [modelOptions, query]);

  return (
    <Box style={{
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 220,
      minWidth: 180,
      borderLeftWidth: 1,
      borderColor: 'theme:border',
      paddingLeft: 10,
      paddingRight: 10,
      paddingTop: 8,
      paddingBottom: open ? 10 : 8,
      gap: 7,
      backgroundColor: open ? 'theme:bg' : 'theme:bg1',
    }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={() => setOpen((v) => !v)} style={{ flexGrow: 1, minWidth: 0, gap: 1 }}>
          <Text size={11} bold color="theme:ink">{candidate.modelLabel}</Text>
          <Text size={9} color="theme:inkDimmer">LANE {laneIndex + 1}</Text>
        </Pressable>
        <Pressable
          onPress={() => { if (canRemove) onRemove(laneIndex); }}
          style={{
            width: 24,
            height: 22,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: 'theme:border',
            backgroundColor: 'theme:bg2',
            opacity: canRemove ? 1 : 0.45,
          }}
        >
          <Text size={10} bold color="theme:ink">-</Text>
        </Pressable>
      </Box>

      {open ? (
        <Box style={{ gap: 5 }}>
          <TextInput
            value={query}
            onChangeText={(v: string) => setQuery(v)}
            placeholder="search models"
            style={{
              height: 28,
              borderWidth: 1,
              borderColor: 'theme:border',
              backgroundColor: 'theme:bg2',
              color: 'theme:ink',
              paddingLeft: 8,
              paddingRight: 8,
              fontSize: 12,
            }}
          />
          <Box style={{ gap: 2 }}>
            {filtered.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => {
                  onSelectModel(laneIndex, m.id);
                  setOpen(false);
                  setQuery('');
                }}
                style={{
                  minHeight: 22,
                  justifyContent: 'center',
                  paddingLeft: 8,
                  paddingRight: 8,
                  borderLeftWidth: m.id === candidate.modelId ? 2 : 1,
                  borderColor: m.id === candidate.modelId ? 'theme:accentHot' : 'theme:border',
                  backgroundColor: m.id === candidate.modelId ? 'theme:bg2' : 'theme:bg',
                }}
              >
                <Text size={10} color="theme:ink">{m.label}</Text>
              </Pressable>
            ))}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

function CandidatePanel({
  turnId,
  candidate,
  laneIndex,
  canPick,
}: {
  turnId: string;
  candidate: ParallelCandidate;
  laneIndex: number;
  canPick: boolean;
}) {
  const selected = canPick && !!candidate.selected;
  const disabled = candidate.pending || !!candidate.error || (!candidate.body && !candidate.surface);
  return (
    <Box style={{
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 220,
      minWidth: 180,
      minHeight: 104,
      borderLeftWidth: 1,
      borderTopWidth: selected ? 2 : 0,
      borderColor: selected ? 'theme:accentHot' : 'theme:border',
      backgroundColor: selected ? 'theme:bg2' : 'theme:bg',
      padding: 12,
      gap: 8,
      overflow: 'hidden',
    }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Box style={{ minWidth: 0, flexGrow: 1, gap: 2 }}>
          <Text size={11} bold color="theme:ink">{candidate.modelLabel}</Text>
          <Text size={9} color={candidate.error ? 'theme:flag' : 'theme:inkDimmer'}>{statusFor(candidate)}</Text>
        </Box>
        {canPick ? (
          <Pressable
            onPress={() => { if (!disabled) selectParallelCandidate(turnId, candidate.id); }}
            style={{
              width: 72,
              height: 24,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? 'theme:accentHot' : 'theme:bg2',
              borderWidth: 1,
              borderColor: selected ? 'theme:accentHot' : 'theme:border',
              opacity: disabled ? 0.45 : 1,
            }}
          >
            <Text size={10} bold color="theme:ink">{selected ? 'PICKED' : 'PICK'}</Text>
          </Pressable>
        ) : null}
      </Box>

      <Box style={{ height: 1, backgroundColor: 'theme:border' }} />

      <Box style={{ flexGrow: 1, minHeight: 0, gap: 8 }}>
        {candidate.error ? (
          <Text size={12} color="theme:flag">{candidate.error}</Text>
        ) : candidate.surface ? (
          <AssistantSurface surface={candidate.surface} showCommand={false} />
        ) : candidate.body ? (
          <Text size={12} color="theme:ink">{candidate.body}</Text>
        ) : (
          <Text size={12} color="theme:inkDimmer">
            {candidate.pending ? 'Waiting for model output...' : 'No output yet.'}
          </Text>
        )}
      </Box>
    </Box>
  );
}

export function ParallelAssistantTurn({
  turn,
  compact = false,
}: {
  turn: Extract<AssistantTurn, { author: 'parallel' }>;
  compact?: boolean;
}) {
  if (compact) {
    const picked = turn.candidates.find((c) => c.selected) || (turn.candidates.length === 1 ? turn.candidates[0] : null);
    return (
      <Box style={{ gap: 8 }}>
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text size={9} bold color="theme:inkDim">PARALLEL</Text>
          <Text size={9} color="theme:inkDimmer">{turn.candidates.length} LANES</Text>
          {picked ? <Text size={9} color="theme:inkDimmer">{picked.modelLabel}</Text> : null}
        </Box>
        {picked ? (
          picked.error ? (
            <Text size={12} color="theme:flag">{picked.error}</Text>
          ) : picked.body ? (
            <Text size={12} color="theme:ink">{picked.body}</Text>
          ) : (
            <Text size={12} color="theme:inkDimmer">{picked.pending ? 'Waiting for model output...' : 'No output yet.'}</Text>
          )
        ) : (
          <Text size={12} color="theme:inkDimmer">Open chat to choose between {turn.candidates.length} model responses.</Text>
        )}
      </Box>
    );
  }

  return (
    <Box style={{ flexDirection: 'row', alignItems: 'stretch', minHeight: 104 }}>
      {turn.candidates.map((candidate, idx) => (
        <CandidatePanel
          key={candidate.id}
          turnId={turn.id}
          candidate={candidate}
          laneIndex={idx}
          canPick={turn.candidates.length > 1}
        />
      ))}
    </Box>
  );
}

export function ParallelLaneControls({
  candidates,
  modelOptions,
  onSelectModel,
  onRemove,
}: {
  candidates: ParallelCandidate[];
  modelOptions: ModelOption[];
  onSelectModel: (laneIndex: number, modelId: string) => void;
  onRemove: (laneIndex: number) => void;
}) {
  return (
    <Box style={{
      flexDirection: 'row',
      alignItems: 'stretch',
      borderBottomWidth: 1,
      borderColor: 'theme:border',
      backgroundColor: 'theme:bg1',
    }}>
      {candidates.map((candidate, idx) => (
        <ModelLaneControl
          key={candidate.id}
          candidate={candidate}
          laneIndex={idx}
          modelOptions={modelOptions}
          onSelectModel={onSelectModel}
          onRemove={onRemove}
          canRemove={candidates.length > 1}
        />
      ))}
    </Box>
  );
}
