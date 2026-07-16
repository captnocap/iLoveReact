# Editor UI sections — the prompting vocabulary (A–H)

Active surface: `cart/editor/`. Last verified: 2026-07-16.
USER ASK req_2970 ("i am sick and tired of trying to point out a specific area
of the ui that i want something to land in ... we are going to recategorize
everything by a section number so prompting can turn into 'add that to
section C'").

## In one sentence

Every persistent block of the editor UI carries a section LETTER (A–H, reading
order: top strip → left-to-right through the body → bottom strip), declared in
`cart/editor/shell/regions.ts` (`SECTIONS`) and stamped `SECTION <X>` at the
top of each owning component — so an ask names a letter instead of describing
geometry.

## The section map

```
┌──────────────────── A window chrome (37) ──────────────────────┐
│  B   │        C        │  D  [action bar 36]       │           │
│ rail │ content browser │  E     viewport (flexes)  │  G focus  │
│ (48) │   (350 ⇄ 680)   │                           │  panel    │
│      │                 │  F  [stage tabs]          │  (326)    │
└──────────────────── H status bar (31) ─────────────────────────┘
```

| §  | Name            | Owner file                  | What lives there |
|----|-----------------|-----------------------------|------------------|
| A  | Window Chrome   | `shell/Chrome.tsx`          | "Shitty Games" brand · File/Edit/View/Build menu bar · Compile · Editor/Play toggle · window controls |
| B  | Left Rail       | `shell/LeftRail.tsx`        | the vertical domain icon stack (Eye, Grid, Box, Actor, Data, Pipeline) |
| C  | Content Browser | `library/LibraryPanel.tsx`  | the asset dock (req_3135): search · Favorites/Recent · content tree · count footer · selected-asset detail card; expand toggle attaches the thumbnail-grid column (tucked 350 ⇄ expanded 680, both fixed constants) |
| D  | Action Bar      | `stage/ToolOptions.tsx`     | THE toolbar (req_2552): mesh tools, snap, floor ▼/▲, view modes, the paint segment (`shell/PaintToolbar.tsx`), the map-paint bar (`stage/MapPaintBar.tsx`) |
| E  | Stage           | `stage/Stage.tsx`           | the flexing center viewport — world / model / playtest / animation / material-focus surfaces + in-viewport docks (`BuildBar`, `MapPaintDock`) |
| F  | Stage Tabs      | `stage/StageTabs.tsx`       | the open-document tab strip at the bottom edge of the stage |
| G  | Focus Panel     | `inspector/Inspector.tsx`   | the right panel (inspector / layers / grid / mission / routes panes) + its 40px pane-switch rail |
| H  | Status Bar      | `shell/BuildDock.tsx`       | build dock: undo/redo · build journal · eventbus · perf · memory · status line · coords |

## The rules

- **A section is a block in the UI flow**, not a pixel shape — the Left Rail
  (tall and thin) is as much a section as the chrome strip. The user's words:
  "the slice has nothing to do with its width in pixels and has to do with how
  the ui flows."
- **Exactly eight.** New persistent UI must land INSIDE an existing section
  (or be ruled a new section by the user — never invented by a worker).
- **Floating layers are NOT sections.** Dialogs, popovers, dropdown menus,
  context menus, and in-viewport docks belong to the section that spawns them
  (the map texture picker is C-adjacent but owned by D's map-paint mode; the
  model context menu is E's).
- **Sections wrap the fixed-region contract, they don't replace it** — each
  SECTIONS entry points at its `REGIONS` key (req_2627), which still owns the
  pixel constants content lays out against.
- `grep -rn "SECTION D" cart/editor/` lands on the owning component.

## Mechanism (where the letters live)

- `cart/editor/shell/regions.ts` — `SECTIONS` const (letter → region key,
  name, owner file, contents) + the lettered ASCII map. The ONE source of
  truth; everything else is a stamp pointing here.
- Each owner file opens with a `// SECTION <X> — <Name> (see
  shell/regions.ts SECTIONS)` header comment.
