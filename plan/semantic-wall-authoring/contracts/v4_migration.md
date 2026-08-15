# World v4 Fixed-Wall Migration Contract — RETIRED

**This contract is dead. Do not implement it.**

On 2026-08-14 the user ruled (req_4462, verbatim): "there is literally fuck all
reason to keep any compatability of those. delete them all and were both in a
better place." Clarified in the same exchange: no existing v4 save carries wall
content worth preserving — "i never asked for anything to be preserved because i
was not happy with any of it to begin with."

The entire v4 wall-migration lane was deleted the same day:

- `framework/game/wall_migration.zig` (RJLM decoder, alias table, compatibility
  catalog) — deleted;
- `building_architecture.migrateLegacyWallModules` and the LegacyWallMigration
  types — deleted;
- wire packet kinds 17/18, section tags 50/51, and rejection code 19 — retired;
  the numeric values stay reserved forever and are never reallocated;
- `__game_build_arch_migrate_v4`, `migrateArchitectureV4Packet`, and
  `architectureHost.migrateV4` — deleted;
- `cart/editor/world/wallMigration.ts` and its fixtures — deleted.

The replacement behavior lives in `cart/editor/data/worldStore.ts`: a pre-v5
world save loads as in-memory v5 with empty architecture; legacy wall-kind
pieces are dropped at load (counted in a diagnostic), every other piece is
preserved, and the file bytes are never touched until the normal v5 save path
writes forward.
