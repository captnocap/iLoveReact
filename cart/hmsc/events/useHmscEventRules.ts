import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';
import type { GameState, HmscGameEvent, StoryValue } from '../design';
import { recordAndPublishGameEvent } from './gameEvents';

type SetGameState = (updater: (current: GameState) => GameState) => void;

function setStoryFlag(state: GameState, key: string, value: StoryValue): GameState {
  if (state.story.flags[key] === value) return state;
  return {
    ...state,
    story: {
      ...state.story,
      flags: {
        ...state.story.flags,
        [key]: value,
      },
    },
  };
}

export function useHmscEventRules(setGameState: SetGameState): void {
  useIFTTT('hmsc:event:lab.entered', (event: HmscGameEvent) => {
    const labName = event.subject?.kind === 'lab' ? event.subject.id : null;
    if (!labName) return;
    setGameState((current) => {
      const flagKey = `lab.${labName}.visited`;
      const flaggedState = setStoryFlag(current, flagKey, true);
      if (flaggedState === current) return current;
      return recordAndPublishGameEvent(flaggedState, {
        type: 'story.flag.set',
        source: 'story.rules',
        actor: { kind: 'story', id: 'hmsc.story.rules' },
        subject: { kind: 'lab', id: labName },
        parentId: event.id,
        tags: ['story'],
        payload: {
          flag: flagKey,
          value: true,
          reason: 'lab.entered',
        },
      }).state;
    });
  });

  useIFTTT('hmsc:event:world.trigger.entered', (event: HmscGameEvent) => {
    const label = typeof event.payload.label === 'string' ? event.payload.label : null;
    if (!label) return;
    setGameState((current) => {
      const flagKey = `trigger.${event.subject?.id ?? 'unknown'}.seen`;
      const flaggedState = setStoryFlag(current, flagKey, true);
      if (flaggedState === current) return current;
      return recordAndPublishGameEvent(flaggedState, {
        type: 'story.flag.set',
        source: 'story.rules',
        actor: { kind: 'story', id: 'hmsc.story.rules' },
        ...(event.subject ? { subject: event.subject } : {}),
        parentId: event.id,
        tags: ['story'],
        payload: {
          flag: flagKey,
          value: true,
          reason: 'world.trigger.entered',
          label,
        },
      }).state;
    });
  });
}
