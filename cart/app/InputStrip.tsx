// Persistent supervisor-input strip — pinned to the bottom of the app
// chrome once onboarding completes. Visually a CommandComposer (gallery
// shape: optional attachment chips up top, prompt area + send action in
// the middle, shortcut hints in the footer). The static
// prompt segments are swapped for a live <TextInput> so the surface is
// actually editable; the rest of the composer is the gallery's
// components/styling verbatim.
//
// Submit parses @-tokens against `tokens.ts` and fires `app:navigate` on
// the IFTTT bus for each route token. Non-routing text is forwarded to
// the assistant chat path from the same `submit()` path.

import { useState, useRef } from 'react';
import { TextEditor } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { useBreakpoint } from '@reactjit/runtime/theme';
import { useRoute } from '@reactjit/runtime/router';
import { busEmit } from '@reactjit/runtime/hooks/useIFTTT';
import { CommandComposerHeader } from './gallery/components/command-composer/CommandComposerHeader';
import { CommandComposerFooter } from './gallery/components/command-composer/CommandComposerFooter';
import { CommandComposerChip } from './gallery/components/command-composer/CommandComposerChip';
import type {
  CommandComposer,
  CommandComposerChip as CommandComposerChipData,
} from './gallery/data/command-composer';
import { resolveTokens, TokenMatch } from './tokens';
import { askAssistant } from './chat/store';
import { setPendingIntent } from './plan/state';
import { useInputClaim, getInputClaim } from './shell';

const LEFT_SHORTCUTS = [
  { id: 'tag-file', key: '@', label: 'tag file' },
  { id: 'variable', key: '{}', label: 'variable' },
  { id: 'command', key: '/', label: 'command' },
];
const EXECUTE_SHORTCUT = {
  id: 'execute', key: '⌘', secondaryKey: 'enter', joiner: '+', label: 'execute',
};

function tokenToChip(m: TokenMatch): CommandComposerChipData {
  return {
    id: `chip:${m.raw}`,
    prefix: '@',
    label: m.token.label,
    tone: 'accent',
  };
}

export function InputStrip() {
  const bp = useBreakpoint();
  const claim = useInputClaim();
  const route = useRoute();
  // At `sm` the composer drops its optional attachment header and shortcut
  // footer. The required surface is the prompt input + send rail;
  // everything else tucks away.
  const compact = bp === 'sm';
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  draftRef.current = draft;

  const matches = resolveTokens(draft);

  const handleChange = (next: string) => {
    setDraft(next);
    // First non-empty keystroke from cold home auto-navigates to /chat.
    // The route flip is what surfaces the rail (rail visibility is
    // derived from `path !== '/' || hasChat` in ShellBody) and the
    // chat-as-activity full view; the user's text is preserved here
    // and submits to chat from whichever slot the InputStrip ends up
    // in once the morph settles.
    if (next.length > 0 && route.path === '/') {
      busEmit('app:navigate', '/chat');
    }
  };

  const submit = () => {
    const text = draftRef.current.trim();
    if (!text) return;
    // A claim from an activity wins over chat — the InputStrip is
    // currently the activity's input surface and typing should go
    // there. The activity is responsible for releasing the claim
    // (Escape / blur / explicit close) when it's done.
    const held = getInputClaim();
    if (held) {
      void Promise.resolve(held.onSubmit(text)).catch(() => {});
      setDraft('');
      draftRef.current = '';
      return;
    }
    // Slash commands. `/plan [intent...]` enters the planning surface
    // with the remainder of the line as the seed objective; the
    // /plan page consumes it on mount via plan/state.ts.
    if (text === '/plan' || text.startsWith('/plan ')) {
      const seed = text.slice('/plan'.length).trim();
      setPendingIntent(seed);
      busEmit('app:navigate', '/sweatshop/plan');
      setDraft('');
      draftRef.current = '';
      return;
    }
    const tokens = resolveTokens(text);
    for (const m of tokens) {
      if (m.token.type === 'route') busEmit('app:navigate', m.token.path);
    }
    // Fire the chat — fire-and-forget so the input clears immediately.
    // The provider tracks the user/asst turn pair through to streamed
    // resolution; errors land on the asst turn body and don't bubble
    // here. See cart/app/chat/AssistantChatProvider.tsx.
    void askAssistant(text).catch(() => {
      /* asst turn carries the [error] string */
    });
    setDraft('');
    draftRef.current = '';
  };

  const placeholder = claim?.placeholder ?? 'Ask, or @-mention a place to open…';

  const attachments: CommandComposerChipData[] = [];
  const hasAttachments = attachments.length > 0;

  // Build a CommandComposer row for the gallery's Header / Footer to
  // consume. The middle section is composed manually below so we can
  // host a live <TextInput>; `prompt` here is a no-op slot.
  const row: CommandComposer = {
    id: 'app-input-strip',
    attachLabel: 'ATTACHED',
    attachments,
    prompt: [],
    branch: { id: 'branch', label: '', tone: 'success' },
    leftShortcuts: LEFT_SHORTCUTS,
    executeShortcut: EXECUTE_SHORTCUT,
    modeGlyph: '',
    sendLabel: claim?.sendLabel ?? 'SEND',
  };

  return (
    <S.CommandComposerFrame style={compact || hasAttachments ? {} : { minHeight: 166 }}>
      {compact ? null : <CommandComposerHeader row={row} />}

      <S.CommandComposerMain>
        <S.CommandComposerPromptRows>
          {matches.length > 0 ? (
            <S.CommandComposerPromptFlow>
              {matches.map((m) => (
                <CommandComposerChip key={m.raw} chip={tokenToChip(m)} />
              ))}
            </S.CommandComposerPromptFlow>
          ) : null}
          <S.CommandComposerPromptFlow>
            <TextEditor
              value={draft}
              onChangeText={handleChange}
              onSubmit={submit}
              placeholder={placeholder}
              style={{
                width: '100%',
                minHeight: 24,
                fontSize: 14,
                color: 'theme:ink',
                backgroundColor: 'transparent',
                borderWidth: 0,
              }}
            />
          </S.CommandComposerPromptFlow>
        </S.CommandComposerPromptRows>

        <S.CommandComposerActionRow style={{ justifyContent: 'flex-end' }}>
          <S.CommandComposerShortcutGroup>
            <S.CommandComposerSend onPress={submit}>
              <S.CommandComposerActionText>{row.sendLabel}</S.CommandComposerActionText>
            </S.CommandComposerSend>
          </S.CommandComposerShortcutGroup>
        </S.CommandComposerActionRow>
      </S.CommandComposerMain>

      {compact ? null : <CommandComposerFooter row={row} />}
    </S.CommandComposerFrame>
  );
}
