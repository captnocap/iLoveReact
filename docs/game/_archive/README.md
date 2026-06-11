# docs/game/_archive — retired per-cart audit docs (DEMOLITION-0610)

USER RULED 2026-06-10 (req_0610/req_0611): every floating standalone lab/demo
cart named by a per-cart `.md` in docs/game/ was deleted from `cart/` — "its
all junk / old … we have ported in the capability from them, now its just
causing trauma." Git history is the archive for the cart CODE; this directory
is the archive for their audit docs + typed index records, retired in the same
commit (the maintenance contract in reverse: a deleted cart cannot keep a live
index record — the oracle must not serve dead records as live capability).

- `*.md` — the per-cart English audits, frozen as written.
- `records/*.ts` — the typed DocIndex records. Their relative `../types`
  imports are intentionally broken here: nothing compiles this tier. They are
  reference text now, not code.

The captured capabilities live on in `cart/hmsc-int/` (see each doc's capture
notes: editors/cutout/CAPTURE.md, game/animation/CAPTURE.md, etc.). Do not
resurrect anything from here without a user ruling.
