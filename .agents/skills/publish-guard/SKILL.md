---
name: publish-guard
description: "Decide and enforce what belongs on GitHub — audit tracked files against the declared publish manifest, then archive or unpublish artifacts, one-off probes, 3D models, captures and frozen eras. Use when the user says 'what should go on github', 'clean up the repo', 'someone committed a bunch of artifacts', 'repo is bloated', 'why is the clone so big', '/publish-guard', or when a commit is about to add generated output, binaries, models or images."
---

# Publish Guard — what is and isn't relevant to GitHub

Somebody always commits artifacts. The repo hit **586MB across 15,561 tracked files** that
way, including 86MB of 3D model JSON that a HARD RULE had forbidden the entire time. Your
job is to keep the published repo to source, and to do it without deleting anybody's work.

**The capability already exists. Use it — do not hand-roll an audit, and do not
hand-edit `.gitignore` to fix a specific file.**

```bash
tools/rjit repo                 # survey. Changes NOTHING. Start here, every time.
tools/rjit repo --candidates    # also: untracked+unignored — one `git add -A` from publication
```

The truth lives in **`cli/dev/publishable.ts`** — an ALLOWLIST of the trees this project
publishes, each with what it is and why a clone needs it. Anything tracked that no rule
covers is reported as `unknown` and gets a decision, never a default.

## Why an allowlist

`.gitignore` is a blocklist: every line is the scar of one incident where an artifact
already reached a commit. It can only describe junk that has been published once, so it is
permanently one incident behind. It grew to 429 lines that way and 120 of them were dead.

The allowlist decides publication once, positively, and forces new junk to announce itself.
`.gitignore` still exists — git needs it — but it is now downstream of the decision.

## The loop

1. **Survey.** `tools/rjit repo`. Read every finding. Each prints what it IS and what would
   replace it.
2. **Classify anything reported `unknown`.** This is the only real thinking in the loop:
   - It is genuinely needed to build or understand the repo → **add a rule to
     `PUBLISH_RULES`** in `cli/dev/publishable.ts` with `kind: 'source'` and a `what:` that
     says why. That is how something becomes publishable. There is no other way.
   - It is not → pick a verb below.
3. **Act, with the verbs — never by hand:**
   ```bash
   tools/rjit repo archive <tree>          # zip → archive/<tree>.zip, verify, untrack, ignore
   tools/rjit repo archive <tree> --drop   # ...and remove the tree once the zip covers it
   tools/rjit repo unpublish <path>        # untrack + ignore, no zip
   ```
   `archive` is for a **frozen era** you may want to read again (whole stacks, previous
   eras). `unpublish` is for anything regenerable, already backed up, or local-only
   (captures, models, bake output, prebuilt blobs).

   **`archive/` holds zips, not directories.** Add `--drop` to reclaim the disk. It removes
   the tree only after proving the zip contains every file and symlink currently on disk —
   not "a zip exists", not "`zip -T` passed", both of which a valid archive of the *wrong
   content* satisfies. An existing zip is reused but re-checked, so a stale archive can
   never authorise a delete.
4. **Rebuild the CLI if you edited `cli/`** — `tools/rjit.js` is generated:
   ```bash
   tools/esbuild cli/main.ts --bundle --outfile=tools/rjit.js --format=iife --platform=neutral --target=es2022
   ```
5. **Commit** `.gitignore` together with the removals, and say what moved and why.

## Deleting: only one verb can, and only against a proof

Everything except `--drop` is non-destructive. The only git command run against a tree is
`git rm --cached`, so the bytes stay on disk and a wrong call costs a `git checkout -- <path>`,
never a file.

`--drop` is the single exception, and it earns it by proving the archive first: every file
and symlink on disk must appear in the zip, or it refuses and removes nothing. Reusing an
existing zip re-runs that proof against current disk contents.

**Never hand-write `rm -rf` against a repo tree.** A freestyle `rm -rf` over a listing that
read like build output destroyed an authored world map (req_4083) — the scope was authorised,
the mistake was deleting a listing instead of inspecting its contents. That is exactly what
the coverage proof replaces. For build output, use `rjit clean` (declared artifacts only).

When someone asks "what would actually go missing?", answer it concretely rather than
hedging — a verified zip loses nothing, so the real question is what still READS the path.
Check that (see below), then act.

## Respect the refusals

The verbs decline four cases. Each refusal is information, not an obstacle:

| refusal | what to do |
|---|---|
| `declared source` | It belongs in a clone. If that is wrong, change its rule first — deliberately. |
| `undeclared` | Add a rule. An unknown path never gets a default in either direction. |
| `BLOCKED` | **Provide before you ban.** Build the named capability, then unpublish. |
| destination inside source | The tree is already an archive location — use `unpublish`. |

`BLOCKED` is the one that matters. `tools/v8cli` (55MB), `tools/esbuild` (11MB),
`tools/rjit.js` and `framework/gpu/icon_atlas.zig` are all generated, and all four stay
published because **nothing fetches or bakes them** — untracking would break a fresh clone.
That is 66MB waiting on `scripts/fetch-v8cli.sh` and a bake step, alongside the existing
`fetch-zig.sh` / `fetch-v8-prebuilt.sh`. Banning them without that is how you turn a big
clone into a broken one.

## Verify, don't eyeball

Two mechanical checks, both cheap. Use them; a publish sweep is too broad to trust by eye.

- **Did a `.gitignore` edit change behavior?** The set of untracked-and-unignored paths must
  be identical before and after:
  ```bash
  git ls-files --others --exclude-standard | sort > /tmp/before.txt
  # ...edit...
  git ls-files --others --exclude-standard | sort | diff /tmp/before.txt -
  ```
- **Would a fresh clone still build?** Untracking is invisible locally, so a local build
  proves nothing. Grep published source for live reads into what you unpublished, and
  separate real paths from doc comments:
  ```bash
  grep -rn --include='*.zig' --include='*.ts' -F 'love2d/' build.zig framework/ cli/ scripts/
  ```
  Provenance comments (`//! ported from love2d/lua/privacy.lua`) are fine and worth keeping.
  A live `addLibraryPath` or `fsExists` path is not — repoint it or guard it.

## Traps that have already bitten

- **Repo-wide rules filed inside a scoped block.** `*.so`, `*.so.*` and `*.dylib` sat inside
  the old love2d section while applying to the whole tree. Pruning by block would have
  unignored every shared library. Read what you delete.
- **`zip -r` follows symlinks.** Archiving love2d wrote 4751 entries for 1882 files, tripled
  52MB into 144MB, and lost all 11 symlinks. The verb uses `-y`; if you ever pack by hand,
  do too — and diff the entry list against `git ls-tree` before untracking.
- **Untracking does not shrink `.git`.** History still holds the blobs (1.9GB here), so
  GitHub still serves them. Only a history rewrite drops them — **never do that on `main`**
  with parallel sessions running. Report it as an option and let the user decide.
- **A trailing slash in `.gitignore` means directory-only.** It silently fails to match a
  single file. The verb checks the filesystem; do the same if you write a rule by hand.
- **Artifact-shaped files inside published trees.** A per-tree allowlist waves these
  through, so `ARTIFACT_SHAPES` catches them by extension and naming. It found 10 tracked
  `_old` breadcrumbs and 2 unreferenced PNGs nobody had noticed. If you add a new artifact
  *kind*, add a shape.

## Deleting source is not yours to do

`_old` breadcrumbs, unreferenced images and abandoned probes get **reported**, not removed.
Untracking a source file and deleting it are different decisions with different costs; the
second one is the user's. Report them plainly with sizes and let them rule.
