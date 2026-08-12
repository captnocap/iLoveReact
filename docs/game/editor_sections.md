# Editor UI sections — the prompting vocabulary (A–H)

Active surface: `cart/editor/`. Last verified: 2026-08-11.
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
│ rail │   left panel    │  E     viewport (flexes)  │ body│rail │
│ (48) │  (0/350/680)    │                           │0/285│40  │
│      │                 │  F  [stage tabs]          │           │
└──────────────────── H status bar (31) ─────────────────────────┘
```

| §  | Name            | Owner file                  | What lives there |
|----|-----------------|-----------------------------|------------------|
| A  | Window Chrome   | `shell/Chrome.tsx`          | "Shitty Games" brand · File/Edit/View/Build menu bar · Compile · Editor/Play toggle · window controls |
| B  | Left Rail       | `shell/LeftRail.tsx`        | contextual input buttons: source libraries while browsing, Tool Options + Ink while painting; pressing the active button again collapses/reopens C |
| C  | Left Panel      | `library/LibraryPanel.tsx` + `shell/PaintSidePanel.tsx` | the contextual input dock: asset browser (collapsed 0 / tucked 350 / expanded 680), or persistent paint Tool Options / Ink (collapsed 0 / open 350) |
| D  | Action Bar      | `stage/ToolOptions.tsx`     | compact mesh/world/paint tool selection and resolution; detailed brush and ink controls live persistently in C |
| E  | Stage           | `stage/Stage.tsx`           | the flexing center viewport — world / model / playtest / animation / material-focus surfaces + in-viewport docks (`BuildBar`, `MapPaintDock`) |
| F  | Stage Tabs      | `stage/StageTabs.tsx`       | the open-document tab strip at the bottom edge of the stage |
| G  | Focus Panel     | `inspector/Inspector.tsx`   | contextual focus body + persistent 40px rail; model view exposes Model / Paint / Rig, and pressing the active button again collapses/reopens the body |
| H  | Status Bar      | `shell/BuildDock.tsx`       | build dock: undo/redo · build journal · eventbus · perf · memory · status line · coords |

## Model-stage measurement view furniture

Section E's model viewport owns two independent, default-off View toggles:

- **Measurements Overlay** measures the active native subject in strict order:
  selected vertices/edges/faces, focused outliner scope, then the complete model. It
  projects the subject's exact axis-aligned bounds, X/Y/Z leader lines, and labels in
  both metres and Studio units (`16 u = 1 m`). Bounds are computed from the welded
  logical topology in `framework/gpu/mesh_edit.zig`; React declares only visibility.
- **Player Scale Reference** restores the optional native 0–3 m ruler, 1 m mark,
  1.65 m collider mark, ~2.04 m visual-head mark, and mannequin. It is no longer
  persistent stage furniture and a cold Studio start always begins with it off.

Both commands live in the View menu and the model context menu's View group. Their
explicit state survives a hot reload through the existing mesh-tool twig, but neither
overlay is model data, save data, or export data.

## The rules

- **A section is a block in the UI flow**, not a pixel shape — the Left Rail
  (tall and thin) is as much a section as the chrome strip. The user's words:
  "the slice has nothing to do with its width in pixels and has to do with how
  the ui flows."
- **Exactly eight.** New persistent UI must land INSIDE an existing section
  (or be ruled a new section by the user — never invented by a worker).
- **Floating layers are NOT sections.** Dialogs, dropdown menus,
  context menus, and in-viewport docks belong to the section that spawns them
  (the map texture picker is C-adjacent but owned by D's map-paint mode; the
  model context menu is E's). Paint Brush and Ink are no longer floating
  layers: while painting they are persistent C renderers (req_3270).
- **Sections wrap the fixed-region contract, they don't replace it** — each
  SECTIONS entry points at its `REGIONS` key (req_2627), which still owns the
  pixel constants content lays out against. C and G can omit their body while
  their rail remains; each open width is still a declared constant.
- `grep -rn "SECTION D" cart/editor/` lands on the owning component.

## Mechanism (where the letters live)

- `cart/editor/shell/regions.ts` — `SECTIONS` const (letter → region key,
  name, owner file, contents) + the lettered ASCII map. The ONE source of
  truth; everything else is a stamp pointing here.
- Each owner file opens with a `// SECTION <X> — <Name> (see
  shell/regions.ts SECTIONS)` header comment.
