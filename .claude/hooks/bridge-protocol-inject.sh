#!/bin/bash
# bridge-protocol-inject.sh — injects the bridge protocol directive as
# UserPromptSubmit additionalContext, but ONLY when the bridge has just
# written a fresh marker file announcing "this next prompt is mine."
#
# The marker is written by cart/claude_openai_bridge_tui.tsx right
# before it writePty's the user prompt. If you (the human) type in the
# TUI directly, no marker exists and this hook is a no-op — your prompts
# stay clean of MCP-respond directives, no cross-talk.
#
# One-shot consumption: the marker is deleted after the first hook fire
# so a stale marker can't pollute the next prompt.

set +e

# Identify which session we are. The headless pool runs ONE claude per
# chat thread and writes a per-sid marker (active-turn-<sid>.json) so each
# concurrent claude picks up only ITS OWN turn's directive. Fall back to
# the shared marker for attached/claudewrap single-session mode.
INPUT=$(cat)
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // ""' 2>/dev/null)

MARKER=/tmp/reactjit-bridge/active-turn.json
if [ -n "$SID" ] && [ -f "/tmp/reactjit-bridge/active-turn-$SID.json" ]; then
  MARKER="/tmp/reactjit-bridge/active-turn-$SID.json"
fi
[ -f "$MARKER" ] || exit 0

WRITTEN_MS=$(jq -r '.written_at_ms // 0' "$MARKER" 2>/dev/null)
NOW_MS=$(($(date +%s%N) / 1000000))
AGE_MS=$((NOW_MS - WRITTEN_MS))

# Stale markers (>30s) get cleaned up but don't fire — they belonged to
# a bridge request that has since timed out or been abandoned.
if [ "$AGE_MS" -gt 30000 ]; then
  rm -f "$MARKER"
  exit 0
fi

# Prefer the pre-composed directive_text (includes tool defs when the
# request had tools). Fall back to composing inline from chat_id+turn_id+
# end_marker for backward-compat with older bridge builds that don't
# write directive_text.
DIRECTIVE=$(jq -r '.directive_text // ""' "$MARKER" 2>/dev/null)
if [ -z "$DIRECTIVE" ]; then
  CHAT_ID=$(jq -r '.chat_id // ""' "$MARKER" 2>/dev/null)
  TURN_ID=$(jq -r '.turn_id // ""' "$MARKER" 2>/dev/null)
  END_MARKER=$(jq -r '.end_marker // ""' "$MARKER" 2>/dev/null)
  if [ -n "$CHAT_ID" ] && [ -n "$TURN_ID" ] && [ -n "$END_MARKER" ]; then
    DIRECTIVE="(Bridge protocol — this turn: chat_id=\"$CHAT_ID\" turn_id=\"$TURN_ID\". Deliver your final answer by calling the bridge.respond MCP tool with chat_id=\"$CHAT_ID\", turn_id=\"$TURN_ID\", text=<your answer>. After your final respond call, your only further output must be EXACTLY: $END_MARKER — nothing else.)"
  fi
fi

# Consume — one bridge request, one injection.
rm -f "$MARKER"

[ -z "$DIRECTIVE" ] && exit 0

jq -n --arg ctx "$DIRECTIVE" \
  '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$ctx}}'
