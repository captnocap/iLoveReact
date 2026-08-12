# Spec-authoring rules for W3/W4/W6–W9/OF (driver checklist, not shipped to codex)

Every spec is SELF-CONTAINED (codex has zero conversation context) and follows the
shape proven by SPEC-W1/W2/W5:

1. One-paragraph context: which work/ files, what the wave does. Never assume repo
   knowledge.
2. **Absolute constraints block**, always including: C-no-whole-file-read (grep+sed
   only, 275k-token warning) · C-byte-identical-outside-targets · C-comment-carry
   law · C-pub-surface-frozen · C-refusal-strings-frozen (B2 waves) ·
   C-LF-endings · C-no-usingnamespace/ArenaAllocator · wave-specific never-touch
   list (journal fns, jalloc def, banners, resetForReload, transparent pipeline).
3. Numbered requirements, each mechanically checkable, each quoting the EXACT
   signature/pattern to grep for (pull from DECOMPOSITION_MAP — never line numbers).
4. The SKIP protocol verbatim: absent/ambiguous/deviating ⇒ SKIP + REPORT.md reason;
   "Skipping is success; guessing is failure."
5. REPORT.md requirement + the gate mandate: "Run `bash ./verify.sh`. Do not finish
   until it exits 0."

Every verify-<W>.sh: quiet one-line checks — ast-check all work files · wave's
structural assertions (helpers exist once & private, converted-pattern counts,
deleted-pattern zero-counts) · pub-surface diff vs ref · banner count 18 · no
banned constructs · jalloc def intact (3d.zig waves) · LF · REPORT.md exists.
Anything not expressible as a check ⇒ the requirement is too vague; rewrite it.

Spend the marginal effort on the KEEP list and verification, not the change list.
Grade with grade-wave.sh + private-probes.sh; never trust the REPORT.md.
