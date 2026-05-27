#!/bin/bash
# weekly-reminder.sh — persistent reminder bus for Claude sessions.
#
# Unlike session-ping's message bus (which expires entries after 5 min),
# reminders here live until Claude explicitly snoozes them. Cron drops
# reminder files; this hook injects them as additionalContext on every
# UserPromptSubmit; Claude calls `weekly-reminder.sh snooze <name>` when
# the work is done, removing the file until cron drops it again.
#
# Usage:
#   # As a hook (stdin = Claude hook JSON):
#   weekly-reminder.sh
#
#   # Drop a reminder (from cron):
#   weekly-reminder.sh drop <name> <message>
#
#   # Snooze a reminder (from Claude):
#   weekly-reminder.sh snooze <name>
#
#   # List active reminders:
#   weekly-reminder.sh list

set +e

REMINDERS_DIR="/run/user/$(id -u)/claude-sessions/reactjit/reminders"
mkdir -p "$REMINDERS_DIR"

ACTION="${1:-hook}"

case "$ACTION" in
  drop)
    NAME="${2:-}"
    MSG="${3:-}"
    if [ -z "$NAME" ] || [ -z "$MSG" ]; then
      echo "Usage: weekly-reminder.sh drop <name> <message>" >&2
      exit 1
    fi
    NOW=$(date +%s)
    jq -n --arg name "$NAME" --arg msg "$MSG" --argjson time "$NOW" \
      '{name:$name, msg:$msg, time:$time}' \
      > "$REMINDERS_DIR/$NAME.json"
    echo "Reminder '$NAME' dropped."
    exit 0
    ;;

  snooze)
    NAME="${2:-}"
    if [ -z "$NAME" ]; then
      echo "Usage: weekly-reminder.sh snooze <name>" >&2
      exit 1
    fi
    rm -f "$REMINDERS_DIR/$NAME.json"
    echo "Reminder '$NAME' snoozed."
    exit 0
    ;;

  list)
    for f in "$REMINDERS_DIR"/*.json; do
      [ -f "$f" ] || continue
      jq -r '"\(.name)\t\(.time | strftime("%Y-%m-%d %H:%M"))\t\(.msg)"' "$f" 2>/dev/null
    done
    exit 0
    ;;

  hook)
    # Read stdin (Claude hook JSON), but we only need to know the event type.
    INPUT=$(cat)
    HOOK=$(echo "$INPUT" | jq -r '.hook_event_name // ""' 2>/dev/null)

    # Collect active reminders
    REMINDERS=""
    NOW=$(date +%s)
    for f in "$REMINDERS_DIR"/*.json; do
      [ -f "$f" ] || continue
      INFO=$(jq -r '{name:.name, msg:.msg, time:.time}' "$f" 2>/dev/null) || continue
      R_NAME=$(echo "$INFO" | jq -r '.name')
      R_MSG=$(echo "$INFO" | jq -r '.msg')
      R_TIME=$(echo "$INFO" | jq -r '.time')
      AGE_DAYS=$(( (NOW - R_TIME) / 86400 ))
      REMINDERS="${REMINDERS}
- [reminder: $R_NAME, dropped ${AGE_DAYS}d ago]
  $R_MSG
  Snooze when done: bash \"\$CLAUDE_PROJECT_DIR\"/.claude/hooks/weekly-reminder.sh snooze $R_NAME"
    done

    [ -z "$REMINDERS" ] && exit 0

    CTX="[PENDING REMINDERS]${REMINDERS}"

    case "$HOOK" in
      UserPromptSubmit|SessionStart)
        jq -n --arg ctx "$CTX" --arg ev "$HOOK" \
          '{hookSpecificOutput:{hookEventName:$ev, additionalContext:$ctx}}'
        ;;
      *)
        exit 0
        ;;
    esac
    ;;

  *)
    echo "Usage: weekly-reminder.sh [drop|snooze|list|hook]" >&2
    exit 1
    ;;
esac
