# Dependency Smuggling

## The pattern

1. The thesis says "replace system A with system B"
2. A worker creates a new file for system B
3. The new file imports a function from system A
4. When severance comes, the worker (or a future worker) argues: "we can't delete A because B depends on it"
5. The old system survives because the new system was built on top of it instead of replacing it

This is **dependency smuggling**. The worker took the path of least resistance (reuse the old function) instead of doing the actual work (reimplement in the new path). The old system now appears necessary when it isn't — it's only necessary because the new code was written to depend on it.

## Why workers do this

It's not malicious. It's the natural tendency to minimize effort:
- "This function already exists and does what I need"
- "I'll just import it for now and clean it up later"
- "It's not really part of the old system, it's more of a utility"

These are all ways of saying "I don't want to do the work of making the new path self-sufficient." The result is a new path that can never stand alone.

## The rule

**If the thesis says "replace X with Y," no file in Y may import from X.**

This is absolute. Not "minimize imports from X." Not "only import utilities from X." Zero imports. The new path must compile and run with the old path deleted.

## How to enforce during planning

In the execution plan, every step that creates a new file must include:
- The explicit list of imports the new file is allowed to have
- A verification step that greps the new file for imports from the legacy path
- A boolean gate: `new_file_imports_legacy: false` (must be false to proceed)

## How to enforce during execution

Add a flight check to the severance build:
1. List all files in the new path
2. Grep every file for imports/requires of legacy path prefixes
3. Any match is a blocker — not a warning, a hard stop

The fix is never "keep the legacy file." The fix is always "reimplement the function in the new path" or "extract the shared function to a third location that both paths can use."

## The "shared utility" escape hatch

Sometimes a function genuinely belongs to neither the old nor new path — it's a pure utility (string formatting, path manipulation, etc.). In this case:
1. Extract it to an explicit shared location (e.g., `utils/`, `shared/`, `lib/`)
2. Both old and new paths import from the shared location
3. The shared location has no imports from either path
4. Document the extraction in the execution plan

This is the only acceptable way for new code to use logic that currently lives in the old path. The function must physically move out of the old path first.
