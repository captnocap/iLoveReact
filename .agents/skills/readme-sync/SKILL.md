---
name: readme-sync
description: Sync README.md with the actual codebase state by diffing commits since last update
---

# README Sync

Update README.md to reflect the current state of the codebase.

## Process

1. Find when README.md was last modified:
   ```
   git log -1 --format="%H %ci" -- README.md
   ```

2. Get all commits since that point:
   ```
   git log --oneline <last-readme-commit>..HEAD
   ```

3. Get the actual diff of what changed:
   ```
   git diff <last-readme-commit>..HEAD --stat
   ```

4. Read the current README.md

5. For each section of the README, verify it against the actual codebase:
   - **Build commands**: Check `tsz/CLAUDE.md` and `tsz/build.zig` for current build targets
   - **Compiler stats**: Count lines with `wc -l tsz/compiler/*.zig`
   - **Framework modules**: List with `ls tsz/framework/*.zig`
   - **Primitives**: Check `tsz/compiler/surfaces.zig` for current surface list
   - **Carts**: List with `ls tsz/carts/`
   - **Conformance scores**: Run `cd tsz && ./scripts/conformance-report` for full status, and `./scripts/conformance-report --verified` for verified-only results. Include both in the README — total pass rate and verified pass rate.
   - **Performance**: Check recent benchmark commits
   - **File extensions**: Check `tsz/compiler/cli.zig` for current taxonomy
   - **Script runtimes**: Check for lscript/lua support in compiler

6. Update sections that are stale. Do NOT rewrite sections that are still accurate. Preserve the design philosophy section and any prose that doesn't reference specific code/numbers.

7. Commit the README update:
   ```
   git add README.md && git commit -m "docs: sync README with codebase state"
   ```

## Rules

- Only update facts that have changed. Don't rewrite prose style.
- If a feature was removed, remove it from the README.
- If a feature was added, add it to the README.
- If numbers changed (line counts, test scores, module counts), update them.
- If commands changed (build targets, CLI flags), update them.
- Keep the Design Philosophy section intact — only update it if the user explicitly asks.
- Never add emojis.
- Keep the same markdown structure and heading hierarchy.
