# Co-visibility map — SECTION G, the focus panel (round 11)

The focus panel is one region that wears a different width per pane. This is
the slice of the co-visibility matrix that round 11 audited: for each pane, what
the region measures, whether the user can change it, and what the body actually
has to lay out inside.

`bodyWidth = outer − 1px border − 40px pane rail`.
`innerWidth = bodyWidth − 2 × 10px gutter`.

| pane (`activePane`) | outer | body | inner | user-resizable | what it lays out |
|---|---|---|---|---|---|
| default / object focus | 326 | 285 | 265 | no | read rows: label + one value |
| `paint` (MODEL · PAINT) | 480 | 439 | 419 | **drag**, 420…1600 | UV atlas workspace |
| `paint` focused (UV WORKSPACE) | 960 | 919 | 899 | **drag**, 420…1600 | dense-mesh UV authoring |
| `stats` (MODEL · STATS) | **480** | **439** | **419** | **drag**, 420…1600 | control grid: label + 1–2 select controls + reset |
| `rig` with a character rig | 720 | 679 | 659 | no | two-column bind diagnostic |
| `rig` without one | 326 | 285 | 265 | no | read rows |
| `names` | 326 | 285 | 265 | no | semantic role rows |
| `recovery` compact | 420 | 379 | 359 | no (preset toggle) | blob explorer |
| `recovery` wide | 720 | 679 | 659 | no (preset toggle) | blob explorer |

Bold = changed by round 11 (req_4772). Before it, `stats` fell through to the
326 default with every other non-workspace pane.

## Why STATS could not live at 326

A `CellRow` spends fixed geometry before any content: `paddingLeft/Right 12`
(24), the `HW_FormLabel` column (82), the always-reserved `ResetCol` (18), and
two 8px gaps. At 326 outer that leaves **123px** for the row's controls. The
audio-event row puts TWO select controls in there — an authored clip name and a
layering mode — so each got ~60px while a real clip is called
`speaker squawk`.

At 480 the same row has **277px** of control span, and the clip control takes
two of the three flex shares because it is the only half that can be long.
At the 420 drag minimum it still has 217px.

## The gesture

`inspector/focusPanelResize.ts` owns the left-edge drag for the whole panel.
Widths are keyed (`uvPanel` / `uvFocus` / `stats`) so dragging one shape never
moves another, and every key clamps against the same `REGIONS.focusPanel`
policy — a pane cannot mint a private minimum by owning its own gesture. The
authored width lives as long as the session, exactly as the UV width always
has; it is not written to `sessionStore`.

## Standing check for future rounds

Open MODEL · STATS on a model with a blueprint and at least one audio event.
No string may paint over the control beside it, and the left edge must drag
between 420 and 1600 while leaving the stage at least 560px.
