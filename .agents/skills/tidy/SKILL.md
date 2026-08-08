---
name: tidy
description: "RETIRED — repo hygiene now lives in the publish-guard skill (`tools/rjit repo`). Kept so /tidy still resolves and redirects instead of running a procedure for a stack that no longer exists."
---

# tidy — RETIRED, use `publish-guard`

This skill described the **Smith era**. It called `tsz/` "the ACTIVE STACK", told you to move
docs into `tsz/docs/`, to give each loose `.tsz` its own directory under `tsz/carts/`, and to
maintain a second `.gitignore` at `tsz/.gitignore`. Every one of those instructions now
points into a frozen tree that is no longer published: `tsz/` and `love2d/` live in
`archive/tsz.zip` and `archive/love2d.zip`, and `archive/` itself is untracked (req_4085).

Following it would reorganize a corpse, and its HARD RULES ("NEVER touch `archive/` or
`love2d/`") now contradict the work that archived them.

## What to use instead

**Repo hygiene / what belongs on GitHub → the `publish-guard` skill.**

```bash
tools/rjit repo                 # survey. Changes nothing.
tools/rjit repo --candidates    # untracked+unignored — one `git add -A` from publication
tools/rjit repo archive <tree>  # zip → archive/, verify, untrack, ignore
tools/rjit repo unpublish <path># untrack + ignore
```

The declared manifest of what publishes is `cli/dev/publishable.ts`.

**Deleting build output from disk → `rjit clean`** (surveys first, deletes only declared
artifacts, spares anything a running dev host holds). Classifier: `cli/dev/deletable.ts`.

**Where current code belongs** is in `CLAUDE.md`, not here: `framework/` (Zig systems),
`runtime/` (JS layer), `renderer/` (reconciler), `cart/` (apps — `cart/editor` + its `/play`
route is the active surface, V32), `docs/` (knowledge layer), `cli/` (rjit source).

The old procedure is in git history if anyone ever needs to see what the Smith-era layout
was supposed to look like.
