// cart/editor/shell/regions.ts — the FIXED-REGION LAYOUT CONTRACT (req_2627).
//
// The editor window breaks into primitively-named regions. Ordinary open-region
// dimensions are constants and the center viewport takes the remainder. The UV
// authoring shape of section G is the deliberate exception: its left edge may be
// dragged between bounds declared here, while its rail remains fixed. Sections C
// and G may still remove their panel BODY and return that width to the viewport.
//
// Region map (the user's vocabulary), top to bottom / left to right:
//
//   ┌──────────────────── A window chrome (37) ──────────────────────┐
//   │  B   │        C        │  D  [action bar 36]       │           │
//   │ rail │ content browser │  E     viewport (flexes)  │ body│rail │
//   │ (48) │   (0/350/680)   │                           │0/285│40  │
//   │      │                 │  F  [stage tabs]          │           │
//   └──────────────────── H status bar (31) ─────────────────────────┘
//
// Content rules that hang off this contract: no whole-panel scrolling (nested
// scrolls inside bounded sub-areas instead), paged assets over long scroll,
// and content must justify its use of the fixed space.
//
// ── SECTIONS (req_2970) — the prompting vocabulary ──────────────────────────
// Every persistent block of the editor UI carries a section LETTER so an ask
// can say "add that to section C" instead of describing geometry. A section is
// a block in the UI flow (its pixel shape is irrelevant); there are exactly
// eight, lettered in reading order — top strip, then left → right through the
// body, then bottom. Floating layers (dialogs, popovers, context menus,
// in-viewport docks) are NOT sections — they belong to the section that spawns
// them. Each owning component is stamped `SECTION <X>` at its top; grep for
// that to land in the right file.
export const SECTIONS = {
  A: { region: 'chrome', name: 'Window Chrome', file: 'shell/Chrome.tsx', contains: 'Shitty Games brand · menu bar · active map · Editor/Play toggle · window controls' },
  B: { region: 'leftRail', name: 'Left Rail', file: 'shell/LeftRail.tsx', contains: 'contextual input buttons: one Asset Explorer plus Paint while painting; active-button repeat collapses/reopens C' },
  C: { region: 'contentBrowser', name: 'Left Panel', file: 'library/LibraryPanel.tsx + shell/PaintSidePanel.tsx', contains: 'one replaceable slot: asset browser (0/350/680) or unified Paint tools + layers + brush + ink (0/350)' },
  D: { region: 'actionBar', name: 'Action Bar', file: 'stage/ToolOptions.tsx', contains: 'THE compact mesh/world toolbar; paint sub-tools, safety, and resolution live persistently in C' },
  E: { region: 'viewport', name: 'Stage', file: 'stage/Stage.tsx', contains: 'the flexing center surface (world / model / playtest / animation / material focus) + its in-viewport docks (BuildBar, MapPaintDock)' },
  F: { region: 'viewport', name: 'Stage Tabs', file: 'stage/StageTabs.tsx', contains: 'the open-document tab strip at the bottom edge of the stage' },
  G: { region: 'focusPanel', name: 'Focus Panel', file: 'inspector/Inspector.tsx', contains: 'contextual focus body + persistent 40px rail; model view exposes Model / Paint / Rig, active-button repeat collapses/reopens the body' },
  H: { region: 'statusBar', name: 'Status Bar', file: 'shell/BuildDock.tsx', contains: 'build dock: undo/redo · build journal · eventbus · perf · memory · status line · coords' },
} as const;

export type SectionLetter = keyof typeof SECTIONS;

/** All region borders are the theme's thin border (theme:borderThin = 1px). */
const BORDER = 1;

/** The standard horizontal gutter panel bodies put between their border and content. */
const PANEL_GUTTER = 10;

// ── Region outer dimensions (the fixed numbers) ────────────────────────────
const CHROME_HEIGHT = 37; // window chrome: brand + menu bar + active map + route toggle (HW_Chrome)
const ACTION_BAR_HEIGHT = 36; // action bar: THE toolbar row above the stage (HW_ToolOptions)
const LEFT_RAIL_WIDTH = 48; // domain rail on the far left edge (HW_LeftRail)
const CONTENT_BROWSER_WIDTH = 350; // content browser, left panel (HW_SidePanel)
// When present, the content browser has TWO fixed states (req_3135): the tucked
// micro dock (350) and expanded tree + thumbnail grid (680). Its collapsed state
// omits the body entirely; the separate 48px rail remains.
const CONTENT_BROWSER_WIDTH_EXPANDED = 680; // content browser, expanded (HW_SidePanelWide)
const CONTENT_BROWSER_TREE_WIDTH = 218; // expanded mode: the fixed tree column (HW_LibTreeCol)
// THE FOCUS PANEL HAS ONE WIDTH (req_4774). Every pane wears it, every pane can
// drag it, and switching panes never changes it — the width belongs to the
// PANEL, not to whichever pane happens to be open. The seven per-pane widths
// that used to live here (326 prop inspector, 420/720 blob presets, 480 stats,
// 480/960 atlas, 720 character rig) are DELETED, not renamed: they were the
// cause of the churn, and keeping any of them as a "default" reintroduces it
// the moment a pane opens.
//
// 480 is the shared default because it is the narrowest width at which the
// densest row shape in the panel — label + two select controls + the reserved
// reset column — still reads inline. Narrower is legal and usable; see
// ROW_STACK_BELOW_WIDTH.
const FOCUS_PANEL_WIDTH = 480;
const FOCUS_RAIL_WIDTH = 40; // the pane-switch icon rail INSIDE the focus panel (HW_RightRail)
const FOCUS_PANEL_COLLAPSED_WIDTH = FOCUS_RAIL_WIDTH;
// The drag floor is the rail plus the WIDEST minimum any pane declares — today
// the Blob Explorer's 320px data column (BLOB_EXPLORER_UI.minimumDataWidth),
// which `BlobExplorerSurface.test.ts` holds this number against. Below it the
// panel is not narrow, it is broken, so the drag stops here and the collapse
// button (rail only) is how you get the rest of the space back.
const FOCUS_PANEL_RESIZE_MIN_WIDTH = 364;
const FOCUS_PANEL_RESIZE_MAX_WIDTH = 1600; // prevents the panel from consuming ultra-wide windows
const FOCUS_PANEL_MIN_OUTSIDE_WIDTH = 560; // stage + surrounding rails retained while dragging
const FOCUS_PANEL_RESIZE_HANDLE_WIDTH = 9; // full-height pointer-capture strip on the panel's left edge
const FOCUS_PANEL_RESIZE_STEP = 4; // layout updates in stable, visible increments
const FOCUS_PANEL_RESIZE_PREVIEW_INTERVAL_MS = 4; // fallback when the host has no animation-frame scheduler
const STATUS_BAR_HEIGHT = 31; // status bar: the bottom build dock (HW_BuildDock)

export const REGIONS = {
  /** WINDOW CHROME — the top strip. Menu bar, active map, Editor/Play toggle. */
  chrome: { height: CHROME_HEIGHT },

  /** ACTION BAR — the tool row (ToolOptions) pinned under the chrome, above the stage. */
  actionBar: { height: ACTION_BAR_HEIGHT },

  /** LEFT RAIL — contextual input-pane buttons on the window's left edge. */
  leftRail: { width: LEFT_RAIL_WIDTH },

  /**
   * CONTENT BROWSER — the left panel (tree, search, asset grids, model gallery).
   * innerWidth is what content actually gets: outer minus the right border and
   * the standard 10px gutters. Import THIS, don't re-derive it from state.
   */
  contentBrowser: {
    width: CONTENT_BROWSER_WIDTH,
    expandedWidth: CONTENT_BROWSER_WIDTH_EXPANDED,
    treeWidth: CONTENT_BROWSER_TREE_WIDTH,
    gutter: PANEL_GUTTER,
    innerWidth: CONTENT_BROWSER_WIDTH - BORDER - PANEL_GUTTER * 2, // 329
    // Expanded grid column's usable width: expanded outer minus the panel's right
    // border, the tree column + its divider, and the standard gutters.
    gridInnerWidth: CONTENT_BROWSER_WIDTH_EXPANDED - BORDER - CONTENT_BROWSER_TREE_WIDTH - BORDER - PANEL_GUTTER * 2, // 440
  },

  /** VIEWPORT — the center stage. The ONE region that flexes; no fixed number. */
  viewport: { flexes: true },

  /**
   * FOCUS PANEL — the open right body plus its persistent contextual rail.
   * bodyWidth = outer minus its left border and the pane-switch rail;
   * innerWidth = bodyWidth minus the inspector body's 10px gutters — the
   * constant every focus-panel card/section lays out against.
   */
  focusPanel: {
    /** The shared default. One width for every pane; the user's drag replaces it. */
    width: FOCUS_PANEL_WIDTH,
    collapsedWidth: FOCUS_PANEL_COLLAPSED_WIDTH,
    railWidth: FOCUS_RAIL_WIDTH,
    resizeMinWidth: FOCUS_PANEL_RESIZE_MIN_WIDTH,
    resizeMaxWidth: FOCUS_PANEL_RESIZE_MAX_WIDTH,
    minimumOutsideWidth: FOCUS_PANEL_MIN_OUTSIDE_WIDTH,
    resizeHandleWidth: FOCUS_PANEL_RESIZE_HANDLE_WIDTH,
    resizeStep: FOCUS_PANEL_RESIZE_STEP,
    resizePreviewIntervalMs: FOCUS_PANEL_RESIZE_PREVIEW_INTERVAL_MS,
    gutter: PANEL_GUTTER,
    bodyWidth: FOCUS_PANEL_WIDTH - BORDER - FOCUS_RAIL_WIDTH, // 439 at the default
    innerWidth: FOCUS_PANEL_WIDTH - BORDER - FOCUS_RAIL_WIDTH - PANEL_GUTTER * 2, // 419 at the default
    /** Body width for ANY panel width — panes lay out against the live width,
     *  never against the default, because the user can drag it. */
    bodyWidthAt: (panelWidth: number) => panelWidth - BORDER - FOCUS_RAIL_WIDTH,
    innerWidthAt: (panelWidth: number) => panelWidth - BORDER - FOCUS_RAIL_WIDTH - PANEL_GUTTER * 2,
  },

  /** STATUS BAR — the bottom strip (the build dock: undo/redo, coords, perf). */
  statusBar: { height: STATUS_BAR_HEIGHT },

  /**
   * THE SHARED CONTROL GRID (req_2626 II) — panel rows sit on fixed columns:
   * a fixed label column, values/controls flexing to ONE right edge, fixed
   * stepper/value/reset columns, one baseline per row. Rows RESERVE space
   * ("we are not bartering for UI space"); labels never wrap.
   */
  grid: {
    /** fixed label column for form/read rows (HW_FormLabel). */
    labelWidth: 82,
    /** The gap every panel row puts between its columns (HW_ReadRow/CellRow). */
    columnGap: 8,
    /** Horizontal padding a panel row puts inside the inspector body. */
    rowPaddingX: 12,
    /**
     * The narrowest a select / value control can be and still READ — an audio
     * clip called "speaker squawk" is 14 mono glyphs at 11px plus the control's
     * 15px of padding. Below this a control is a box with an ellipsis in it,
     * which is why ROW_STACK_BELOW_WIDTH exists rather than letting rows keep
     * shrinking (req_4774).
     */
    controlMinWidth: 110,
    /** square − / + stepper button (HW_OvBtn). */
    stepBtn: 20,
    /** numeric value cell between steppers (HW_OvVal). */
    valueWidth: 40,
    /** trailing reset-rider column — ALWAYS reserved, set or not (HW_OvReset/Idle). */
    endBtn: 18,
    /** minimum read-row height, one baseline (HW_ReadRow). */
    rowHeight: 21,
    /** a section's action row: fixed height, verbs on the row (HW_VerbRow). */
    verbRowHeight: 24,
    /** button height inside a verb row (HW_VerbPrimary/HW_VerbFixed). */
    verbHeight: 22,
    /** fixed-width secondary verb column at the right edge (HW_VerbFixed). */
    verbColWidth: 56,
  },
} as const;
