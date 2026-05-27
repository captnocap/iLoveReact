# Weekly memory + README audit

Walk the memory index at `/home/siah/.claude/projects/-home-siah-creative-reactjit/memory/MEMORY.md`.
For each entry it points at, open the file and verify:

1. **Paths it names still exist.** If a memory says "see `runtime/hooks/useBrowse.ts`",
   confirm the file is actually there. Stale path → update or delete.
2. **Features it claims still work the way described.** Spot-check claims against current
   code. Don't trust the memory; trust what you read on disk now.
3. **Dates aren't catastrophically stale.** Anything older than ~3 months that describes
   active work-in-progress is suspect — either still true (note it) or done (remove).
4. **Index is tight.** `MEMORY.md` should stay under ~200 lines. If it's bloating, look for
   memories to merge or retire.

Then check `README.md` (project root, if present) for drift against the actual codebase shape —
primitives list, ship path, directory map. Update what's wrong, don't add new sections.

When done — even if you found nothing to change — snooze the reminder so it doesn't keep
firing on every prompt:

```bash
bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/weekly-reminder.sh snooze memory-audit
```

If you skip the audit (busy, mid-task), leave the reminder alone — it'll keep nagging until
you handle it or the next cron fires.
