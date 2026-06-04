# WO-3 — Constitution consistency fixes (from the proofread session)

Mechanical fixes to docs/game/DECISIONS.md + STRUCTURE.md. Mirror any DECISIONS
change into `_index/decisions.ts` (maintenance contract). Do not alter the
user's ANSWER-slot prose — it is evidence of intent.

1. Import rules contradict on data/: "labs → game only" vs "data → imported by
   everyone"; also game/ arrow omits data/ but P2 rule requires it. FIX: data
   flows through game/'s door (labs never touch data/ directly); add data/ to
   game/'s arrow.
2. V18 says the gate signal is importing `cart/game/` — path doesn't exist.
   FIX: `cart/hmsc-int/game/` (the @game alias) everywhere.
3. "STANDARD GAME_* names" defined twice with different contents (V17 short
   list vs STRUCTURE's full door). FIX: STRUCTURE's door is canonical; V17
   cites it instead of enumerating.
4. V17-LIFECYCLE ("rewrite after ENTIRE corpus captured") vs build-order step 6
   ("first lab rebuilt" in Milestone 0). FIX: carve out step 6 explicitly as
   the contract-proof exception.
5. Tier C note still says Bullet dormant-vs-delete is open; R1 ruled it (KEEP).
   FIX: cite R1.
6. V14 says "useGameLoop: in" but V8/R3 don't rule the hook. FIX: V14 reads
   "loop (minimal API, pending R3)".
7. The Effect/StaticSurface texture system is in V14 but has no STRUCTURE home.
   FIX: state in what-does-NOT-move: stays platform-side in runtime/, game/
   consumes it.
8. Resolution refs use 4 spellings (resolution #6 / R6 / R1 / R3) against a
   section titled "Open items — RESOLVED" numbered 1–7. FIX: retitle
   "Resolutions (R1–R7)".
9. Verdict ordering: V13/V15/V14 appear after V20; V16 forward-references V13.
   FIX: add one line atop VERDICTS: "numbered by question; V16+ are appended
   rulings."
10. V2 lists ragdoll.ts in THE stack; V1 says implementation not kept. FIX:
    one cross-ref in V2 — "ragdoll.ts per V1: behavior reference only".
11. Tier C table: 3-column header, 4-cell rows. FIX: add | Status | header and
    fill blanks with "accepted" (Tier C is accepted-by-default).
12. Extraction map table split by a blank line before the hmsc commands row.
    FIX: delete the blank line.
13. Stale questionnaire blanks ruled elsewhere: Q1's "If D:" blank → "→ R1";
    Q3c "i think so?" → "→ R7".

Also (one sentence each): clarify R1's "client" = the consuming system per
use-case; index.tsx mounts shell, shell owns routes; V20's "one total undo
chain" = global sequence number across streams (or tuple of stream positions);
STRUCTURE's "(ruled)" tags = citations of DECISIONS verdicts, only the shape is
proposed. NOTE: the ~45/min tick question from the proofread is already
resolved by V8-CLARIFIED (reconciliation cadence) — do not re-touch.
