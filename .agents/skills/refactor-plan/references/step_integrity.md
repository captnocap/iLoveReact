# Step Integrity Rule

The difference between a plan that executes in 2 hours and one that drifts for days is whether steps require judgment.

## Real Step vs Task-Shaped Row

A **real step** tells the worker exactly:
- What to open (file path, line range)
- What to read or verify (exact symbol, exact string, exact condition)
- What to change (exact edit, exact insertion point)
- Where to place the result (exact file, exact location)
- What to verify after (reopen file, confirm exact line)
- Where to record the result (exact report file, exact field name)

A **task-shaped row** tells the worker what to accomplish and leaves the how to inference:
- "Compare a004 to emitStateManifest()"
- "Check whether a005 matches dynamic text update emission"
- "Add the missing import somewhere in a003"
- "Fix any drift you find"
- "Make sure it works"

Task-shaped rows are not steps. They are hidden judgment. They cause drift.

## The Expansion Rule

Any step containing these words must be expanded before execution:

| Danger word | Why it's dangerous |
|---|---|
| `compare` | Compare what? By what standard? Record where? |
| `verify whether` | What constitutes verified? What if it's false? |
| `decide whether` | A step that requires a decision is two steps minimum |
| `as needed` | Who decides what's needed? The worker shouldn't. |
| `correct branch` | Which branch? What makes it correct? |
| `equivalent` | Equivalent by what measure? |
| `match exactly` | Match what to what? What's the source of truth? |
| `patch it` | Patch what? Where? With what? |
| `if appropriate` | Who decides appropriate? |
| `ensure` | Ensure how? By what mechanism? |
| `clean up` | Clean up what specifically? |

If you catch yourself writing any of these, stop and expand into concrete sub-steps.

## The Boolean Gate Rule

Any step that says `confirm`, `verify`, `check`, `if needed`, `or verify`, `if missing`, `if exists` is a **boolean gate**.

The worker must:
1. Evaluate the boolean condition
2. Write the result (`true` or `false`) to the relevant report or control board file
3. If `true`: execute the follow-up action in the step
4. If `false`: record as a no-op or skip in the same file
5. After any action: reopen the changed file and confirm the exact line is present

A boolean gate is never vague. The step must name:
- The exact condition being tested
- The exact file and field where the result is written
- The exact action for true
- The exact action for false (even if it's "write skip")

## The Middle Layer Rule

A step cannot stop at input/output parity:
- source pattern in
- output bytes out

The semantic middle must also be named:
- What was recognized (node type, pattern, construct)
- What facts were recorded (state slots, handlers, maps, bridges)
- Which downstream consumers expect those facts

Any step that says "compare legacy output to new output" is under-specified if it doesn't say what semantic facts that slice is preserving.

## Examples

### Bad (task-shaped):

```
142. Compare a001 banner output to legacy emitPreamble banner
```

### Good (real step):

```
142. Open smith/emit_atoms/preamble/a001_banner.js line 8-22.
143. Open smith/emit/preamble.js line 14-31.
144. Copy the string returned by a001._emit() into reports/sections/preamble_status.md field `a001_output`.
145. Copy the string returned by emitBanner() into reports/sections/preamble_status.md field `legacy_banner_output`.
146. Diff the two strings. Write `a001_banner_parity: true|false` to control_board.md.
147. If false: write the exact diff (first differing line, expected vs actual) to reports/sections/preamble_status.md field `a001_banner_drift`.
```

### Bad (hidden judgment):

```
215. Fix any handler drift found in step 214.
```

### Good (no judgment):

```
215. If `handler_parity` is false in control_board.md: open the drift report at reports/sections/handlers_effects_status.md.
216. Read field `first_drift_location` — it names a file and line.
217. Open that file at that line.
218. The expected string is in field `expected_output`. The actual string is in field `actual_output`.
219. Edit the actual file to produce the expected string.
220. Reopen the file. Confirm the line matches `expected_output`.
221. Write `handler_drift_fixed: true` to control_board.md.
```
