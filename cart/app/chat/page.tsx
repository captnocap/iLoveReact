// /chat route — full-shape live chat as the activity page.
//
// This route overrides the shell InputStrip's ask handler while mounted:
// one user message fans out to the selected model lanes, and the
// user's picked lane becomes the canonical assistant turn for the next
// fan-out round.

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseIntent, type Node } from '@reactjit/runtime/intent/parser';
import { Box } from '@reactjit/runtime/primitives';
import { useHudInsets } from '../shell';
import { useCRUD } from '../db';
import { AssistantChat } from './AssistantChat';
import { useAssistantChat } from './useAssistantChat';
import {
  appendTurn,
  getTurns,
  nextTurnId,
  pushAsker,
  setTurnPending,
  updateParallelCandidate,
} from './store';
import type { AssistantTurn, ChatSurface, ParallelCandidate } from './types';

const NS = 'app';
const SETTINGS_ID = 'settings_default';
const passthrough: any = { parse: (v: unknown) => v };

type ModelRow = {
  id: string;
  remoteId: string;
  displayName?: string;
  modality?: string;
  favorite?: boolean;
};

type LaneHandle = {
  ask: ReturnType<typeof useAssistantChat>['ask'];
  phase: string;
  error: string | null;
};

function nowHHMMSS(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function hasIntentTags(nodes: Node[]): boolean {
  return nodes.some((n) => n.kind !== 'text');
}

function modelLabel(m: ModelRow | undefined, fallback: string): string {
  if (!m) return fallback || 'Model';
  return m.displayName || m.remoteId || m.id;
}

function canonicalTranscript(turns: AssistantTurn[]): string {
  const lines: string[] = [];
  for (const turn of turns) {
    if (turn.author === 'user') {
      lines.push(`User: ${turn.body}`);
    } else if (turn.author === 'asst') {
      if (turn.body) lines.push(`Assistant: ${turn.body}`);
    } else {
      const picked = turn.candidates.find((c) => c.selected);
      if (picked && picked.body) lines.push(`Assistant (${picked.modelLabel}): ${picked.body}`);
    }
  }
  return lines.join('\n\n');
}

function lastParallelNeedsChoice(turns: AssistantTurn[]): boolean {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.author !== 'parallel') continue;
    if (turn.candidates.some((c) => c.selected)) return false;
    return turn.candidates.some((c) => !c.pending);
  }
  return false;
}

function promptFor(modelName: string, history: string, text: string): string {
  const transcript = history ? `${history}\n\nUser: ${text}` : `User: ${text}`;
  return `You are one candidate assistant response in a parallel model comparison UI.

Rules:
- Respond directly to the latest user message.
- Use only the canonical transcript below as conversation context.
- Do not refer to unchosen alternate model outputs.
- Do not mention that you are in a comparison unless the user asks.

Candidate model label: ${modelName}

Canonical transcript:
${transcript}`;
}

function ParallelLaneWorker({
  laneId,
  modelId,
  onUpdate,
}: {
  laneId: string;
  modelId: string;
  onUpdate: (laneId: string, handle: LaneHandle | null) => void;
}) {
  const chat = useAssistantChat({ modelId });
  useEffect(() => {
    onUpdate(laneId, {
      ask: chat.ask,
      phase: chat.phase,
      error: chat.error,
    });
    return () => onUpdate(laneId, null);
  }, [laneId, chat.ask, chat.phase, chat.error]);
  return null;
}

export default function ChatPage() {
  const insets = useHudInsets();
  const modelStore = useCRUD<ModelRow>('model', passthrough, { namespace: NS });
  const settingsStore = useCRUD<any>('settings', passthrough, { namespace: NS });
  const { data: allModels } = modelStore.useListQuery({});
  const { data: settings } = settingsStore.useQuery(SETTINGS_ID);
  const modelOptions = useMemo(() => {
    const rows = (allModels || []).filter((m) => !m.modality || m.modality === 'text');
    return [...rows].sort((a, b) => {
      const fav = Number(!!b.favorite) - Number(!!a.favorite);
      if (fav !== 0) return fav;
      return modelLabel(a, a.id).localeCompare(modelLabel(b, b.id));
    });
  }, [allModels]);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const laneCount = Math.max(1, selectedModelIds.length || 1);
  const [roundEpoch, setRoundEpoch] = useState(0);
  const handlesRef = useRef<Record<string, LaneHandle>>({});
  const selectedRef = useRef<string[]>(selectedModelIds);
  const modelsRef = useRef<ModelRow[]>(modelOptions);

  useEffect(() => { selectedRef.current = selectedModelIds; }, [selectedModelIds]);
  useEffect(() => { modelsRef.current = modelOptions; }, [modelOptions]);

  useEffect(() => {
    if (modelOptions.length === 0) return;
    setSelectedModelIds((prev) => {
      const fallback = settings?.actionDefaults?.assistant || modelOptions[0].id;
      const source = prev.length > 0 ? prev : [fallback];
      const next: string[] = [];
      for (let i = 0; i < source.length; i += 1) {
        const cur = source[i];
        next[i] = cur && modelOptions.some((m) => m.id === cur)
          ? cur
          : (i === 0 && modelOptions.some((m) => m.id === fallback) ? fallback : modelOptions[i % modelOptions.length].id);
      }
      return next;
    });
  }, [modelOptions, settings?.actionDefaults?.assistant]);

  const onLaneUpdate = (laneId: string, handle: LaneHandle | null) => {
    if (handle) handlesRef.current = { ...handlesRef.current, [laneId]: handle };
    else {
      const next = { ...handlesRef.current };
      delete next[laneId];
      handlesRef.current = next;
    }
  };

  const parallelAskRef = useRef<(text: string) => Promise<string>>(async () => '');
  parallelAskRef.current = async (text: string): Promise<string> => {
    const before = getTurns();
    if (lastParallelNeedsChoice(before)) {
      const asstId = nextTurnId('a');
      appendTurn({
        id: asstId,
        author: 'asst',
        timestamp: nowHHMMSS(),
        body: 'Pick one of the previous model outputs before sending the next message.',
      });
      setTurnPending(asstId, false);
      return '';
    }

    const activeIds = selectedRef.current.slice(0, laneCount).filter(Boolean);
    if (activeIds.length === 0) {
      const asstId = nextTurnId('a');
      appendTurn({
        id: asstId,
        author: 'asst',
        timestamp: nowHHMMSS(),
        body: 'No text models are available yet. Add or fetch models in Settings, then return to /chat.',
      });
      return '';
    }

    const ts = nowHHMMSS();
    const userId = nextTurnId('u');
    const parallelId = nextTurnId('p');
    const models = modelsRef.current;
    const candidates: ParallelCandidate[] = activeIds.map((modelId, idx) => {
      const m = models.find((row) => row.id === modelId);
      return {
        id: `${parallelId}_c${idx}`,
        modelId,
        modelLabel: modelLabel(m, modelId),
        body: '',
        pending: true,
      };
    });

    appendTurn({ id: userId, author: 'user', timestamp: ts, body: text });
    appendTurn({ id: parallelId, author: 'parallel', timestamp: ts, userBody: text, candidates });

    const history = canonicalTranscript(before);
    const outputs = await Promise.all(candidates.map(async (candidate, idx) => {
      const laneId = `lane_${idx}`;
      const lane = handlesRef.current[laneId];
      if (!lane) {
        const msg = 'Model worker is still starting.';
        updateParallelCandidate(parallelId, candidate.id, { pending: false, error: msg });
        return `[${candidate.modelLabel}] ${msg}`;
      }
      if (lane.error) {
        updateParallelCandidate(parallelId, candidate.id, { pending: false, error: lane.error });
        return `[${candidate.modelLabel}] ${lane.error}`;
      }
      let finalText = '';
      try {
        finalText = await lane.ask(promptFor(candidate.modelLabel, history, text), {
          onPart: (partial) => updateParallelCandidate(parallelId, candidate.id, { body: partial }),
        });
        const patch: Partial<ParallelCandidate> = { body: finalText || '', pending: false };
        if (finalText) {
          try {
            const nodes = parseIntent(finalText);
            if (hasIntentTags(nodes)) {
              patch.surface = { kind: 'intent', nodes } as ChatSurface;
            }
          } catch {}
        }
        updateParallelCandidate(parallelId, candidate.id, patch);
        return `[${candidate.modelLabel}] ${finalText}`;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        updateParallelCandidate(parallelId, candidate.id, { pending: false, error: msg });
        return `[${candidate.modelLabel}] ${msg}`;
      }
    }));

    setRoundEpoch((n) => n + 1);
    return outputs.join('\n\n');
  };

  useEffect(() => {
    return pushAsker((text) => parallelAskRef.current(text), 10);
  }, []);

  const laneIds = selectedModelIds.slice(0, laneCount);
  const modelChoices = modelOptions.map((m) => ({ id: m.id, label: modelLabel(m, m.id) }));
  const previewCandidates: ParallelCandidate[] = laneIds.map((modelId, idx) => {
    const m = modelOptions.find((row) => row.id === modelId);
    return {
      id: `preview_${idx}`,
      modelId,
      modelLabel: modelLabel(m, modelId),
      body: '',
    };
  });
  const addLane = () => {
    if (modelOptions.length === 0) return;
    setSelectedModelIds((prev) => {
      const nextModel = modelOptions[prev.length % modelOptions.length];
      return [...prev, nextModel.id];
    });
  };
  const removeLane = (laneIndex: number) => {
    setSelectedModelIds((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, idx) => idx !== laneIndex);
    });
  };
  const selectLaneModel = (laneIndex: number, modelId: string) => {
    setSelectedModelIds((prev) => {
      const next = [...prev];
      next[laneIndex] = modelId;
      return next;
    });
  };

  return (
    <Box style={{
      width: '100%',
      flexGrow: 1,
      flexDirection: 'column',
      paddingTop: 24,
      paddingLeft: 24,
      paddingRight: 24,
      // The shell publishes the bottom InputStrip's reserved height
      // here — apply it as our own paddingBottom so the chat panel
      // doesn't extend behind the strip.
      paddingBottom: 16 + insets.bottom,
    }}>
      {laneIds.map((modelId, idx) => modelId ? (
        <ParallelLaneWorker
          key={`${roundEpoch}:${idx}:${modelId}`}
          laneId={`lane_${idx}`}
          modelId={modelId}
          onUpdate={onLaneUpdate}
        />
      ) : null)}
      <AssistantChat
        shape="activity"
        parallel={{
          laneCount,
          lanes: previewCandidates,
          modelOptions: modelChoices,
          onAddLane: addLane,
          onRemoveLane: removeLane,
          onSelectLaneModel: selectLaneModel,
        }}
      />
    </Box>
  );
}
