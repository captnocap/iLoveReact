---
name: tidy
description: "Audit and organize the repository directory structure. Move loose files to proper homes, clean build artifacts, consolidate scattered docs. Use when user says '/tidy', 'clean up', 'organize dirs', 'get the house in order'."
---

# Tidy — Get the House in Order

You are the janitor. The parents are coming home and the repo is a mess. Your job is to audit the directory structure, identify things that are out of place, move them where they belong, and report what you did.

## Modes

Parse the user's intent:

- **`/tidy`** or **`/tidy audit`** — Scan and report what's wrong. Don't move anything yet. Show a table of what you'd do.
- **`/tidy fix`** — Run the audit, then execute all moves. Commit after each logical group.
- **`/tidy fix <area>`** — Fix only one area (e.g., `/tidy fix root`, `/tidy fix carts`, `/tidy fix docs`)

If no mode is given, default to `audit`.

---

## HARD RULES

1. **NEVER touch `archive/` or `love2d/`.** They are frozen. Read-only. Period.
2. **NEVER delete source code.** Move it. If something looks like dead code, move it to `compiler/dead/` or `archive/`, don't rm it.
3. **NEVER move files that are referenced by `build.zig`.** Before moving any `.zig` file, grep `build.zig` for its path. If referenced, update the reference OR leave it alone.
4. **NEVER move files mid-session if another session is actively building.** Check for `.zig-cache/tmp` activity first.
5. **Commit before AND after moves.** Always. A failed move without a commit means lost work.
6. **Update imports/references.** If you move a file that's `@import`ed or `#include`d, update every reference. Grep first, move second.

---

## The Canonical Structure

This is what the repo SHOULD look like. Everything that doesn't fit this shape is out of place.

```
reactjit/
  README.md                    # Repo overview
  CLAUDE.md                    # Claude instructions
  .gitignore / .gitattributes  # Git config
  build.zig / build.zig.zon    # Root build (Love2D native deps)

  archive/                     # FROZEN — old compiler iterations
  love2d/                      # FROZEN — Lua reference stack
  os/                          # CartridgeOS + Exodia (future)
  game/                        # Dead Internet Game
  deps/                        # External dependencies (git submodules, vendored libs)
  bin/                         # Frozen reference binaries

  tsz/                         # === ACTIVE STACK ===
    build.zig / build.zig.zon  # Zig build config
    CLAUDE.md                  # Stack-specific instructions
    .gitignore

    compiler/                  # Forge (Zig) + Smith (JS)
      forge.zig                # Zig kernel
      smith/                   # Smith JS compiler modules
      dist/                    # Bundled smith output
      dead/                    # Deprecated compiler code (graveyard)

    framework/                 # Runtime engine (layout, GPU, events, state, text)
      ffi/                     # FFI bridges
      gpu/                     # GPU/rendering
      lua/                     # Lua integration
      net/                     # Networking
      test/                    # Framework tests

    carts/                     # Apps built with the framework
      conformance/             # Conformance test suite
      storybook/               # Component catalog / homepage
      <app-name>/              # Each app in its own directory (NO loose files)

    docs/                      # ALL documentation lives here
      primitives/              # Primitive API docs
      systems/                 # System architecture docs
      plans/                   # Implementation plans (moved from tsz/plans/)
      research/                # Research notes (moved from tsz/research/)
      screenshots/             # Visual references (moved from tsz/screenshots/)

    scripts/                   # Build and utility scripts
    experiments/               # Experimental code, benchmarks, bleeding edge
    web/                       # Web/WASM target
    stb/                       # stb single-header C libs (vendored)
```

### What does NOT belong anywhere in the tree:

| Thing | Why | Action |
|-------|-----|--------|
| `*.gen.o` files in repo root | Build artifacts | Delete or gitignore |
| `.tar.gz` files in repo root | Vendored archives | Move to `deps/` or gitignore |
| Loose `.md` docs in repo root (not README/CLAUDE) | Scattered documentation | Move to `tsz/docs/` |
| Loose `.tsz` files in `carts/` | Orphan test files | Move into `carts/<name>/` subdirectory |
| `conformance.db` in `tsz/` root | Database artifact | Move to `carts/conformance/` or gitignore |
| `something.md` (111KB mystery file) | Unnamed dump | Audit contents, rename or archive |
| `.prettierrc` in `tsz/` root | JS config in Zig project | Move to `compiler/` if still needed |
| `node_modules/` in repo root | Legacy JS deps | Gitignore (already should be) |

---

## Audit Procedure

Run these checks in order. For each, report findings in a table.

### 1. Root-Level Audit

```bash
# Find files that don't belong in repo root
find /home/siah/creative/reactjit/ -maxdepth 1 -type f \
  ! -name "README.md" \
  ! -name "CLAUDE.md" \
  ! -name ".gitignore" \
  ! -name ".gitattributes" \
  ! -name "build.zig" \
  ! -name "build.zig.zon" \
  ! -name "*.lock" \
  ! -name "package.json" \
  | sort
```

For each file found, classify:
- **build artifact** → delete or gitignore
- **documentation** → move to `tsz/docs/`
- **vendored dep** → move to `deps/`
- **config** → evaluate if still needed

### 2. tsz/ Root Audit

```bash
# Directories that should be consolidated
ls -d /home/siah/creative/reactjit/tsz/*/

# Loose files
find /home/siah/creative/reactjit/tsz/ -maxdepth 1 -type f \
  ! -name "build.zig" \
  ! -name "build.zig.zon" \
  ! -name "CLAUDE.md" \
  ! -name ".gitignore" \
  ! -name ".prettierrc" \
  | sort
```

Check these specific problem areas:
- `tsz/plans/` → should be `tsz/docs/plans/`
- `tsz/research/` → should be `tsz/docs/research/`
- `tsz/screenshots/` → should be `tsz/docs/screenshots/`
- `tsz/conformance.db` → should be in `carts/conformance/` or gitignored

### 3. Carts Loose File Audit

```bash
# Loose .tsz files not in subdirectories
find /home/siah/creative/reactjit/tsz/carts/ -maxdepth 1 -type f -name "*.tsz"
```

Each loose `.tsz` should get its own directory under `carts/`. Naming convention:
- `test_foo.tsz` → `carts/test-foo/test_foo.tsz` (or merge into `carts/conformance/` if it's a conformance test)
- `ifttt_lab.tsz` → `carts/ifttt-lab/ifttt_lab.tsz`

### 4. Compiler Dead Code Audit

```bash
# What's in the graveyard?
find /home/siah/creative/reactjit/tsz/compiler/dead/ -type f | sort
```

Report what's there. Don't move it — it's already in the right place (dead/).

### 5. Build Reference Check

Before moving ANY `.zig` file, verify it's not referenced:

```bash
# Check if a file is referenced in build.zig
grep -r "filename" /home/siah/creative/reactjit/tsz/build.zig
```

### 6. Gitignore Audit

```bash
cat /home/siah/creative/reactjit/.gitignore
cat /home/siah/creative/reactjit/tsz/.gitignore
```

Ensure these patterns exist:
- `*.gen.o`
- `*.tar.gz` (unless intentionally tracked)
- `conformance.db`
- `zig-out/`
- `.zig-cache/`
- `.zig-global-cache/`
- `node_modules/`
- `/tmp/tsz-gen/` (forge output)

---

## Fix Procedure

Execute fixes in this order. Commit after each group.

### Group 1: Gitignore fixes
Update `.gitignore` to cover build artifacts. Commit: `chore: update .gitignore for build artifacts`

### Group 2: Delete build artifacts
Remove files that should never be tracked (`*.gen.o`, etc.). Commit: `chore: remove tracked build artifacts`

### Group 3: Consolidate docs under tsz/docs/
```bash
# Move plans, research, screenshots under docs/
git mv tsz/plans tsz/docs/plans       # if plans/ exists and isn't already there
git mv tsz/research tsz/docs/research # if research/ exists
git mv tsz/screenshots tsz/docs/screenshots  # if screenshots/ exists
```
Commit: `refactor: consolidate docs, plans, research, screenshots under tsz/docs/`

### Group 4: Move root-level docs to tsz/docs/
```bash
# Only move docs that are tsz-specific
# Leave README.md and CLAUDE.md at root
git mv AGENTS.md tsz/docs/
git mv DIAGRAMS.md tsz/docs/
# etc — evaluate each file
```
Commit: `refactor: move loose root docs into tsz/docs/`

### Group 5: Organize loose carts
```bash
# For each loose .tsz in carts/:
mkdir -p tsz/carts/<name>
git mv tsz/carts/<file>.tsz tsz/carts/<name>/
```
Commit: `refactor: move loose cart files into proper directories`

### Group 6: Clean up tsz/ root
Move `conformance.db` and any other loose artifacts. Commit: `chore: clean up tsz/ root`

---

## Reporting

After audit or fix, output a summary table:

```
## Tidy Report — <date>

| Area | Issues Found | Fixed | Notes |
|------|-------------|-------|-------|
| Repo root | N loose files | Y/N | ... |
| tsz/ root | N misplaced items | Y/N | ... |
| carts/ | N loose files | Y/N | ... |
| docs/ | N scattered locations | Y/N | ... |
| .gitignore | N missing patterns | Y/N | ... |

### Moves Performed
- `old/path` → `new/path` (reason)
- ...

### Still Needs Attention
- Items you couldn't move (build references, unclear ownership)
```

---

## Edge Cases

- **File referenced in build.zig**: Don't move it. Report it as "pinned by build system" and note what would need to change.
- **File referenced by other files**: Grep for the filename across the repo. If referenced, update references after moving.
- **Large binary files**: Don't `git mv` huge files without warning — it bloats git history. Consider `.gitignore` + manual delete instead.
- **Parallel session active**: If another session is running (check session awareness hooks), be extra careful with moves. Prefer audit-only mode.
- **Ambiguous ownership**: If a file could go in multiple places, ask the user.
