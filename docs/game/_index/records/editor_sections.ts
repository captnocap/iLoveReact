import type { DocIndex } from '../types';

export const editor_sections: DocIndex = {
  name: 'editor_sections',
  file: 'editor_sections.md',
  cart: 'cart/editor/shell/regions.ts',
  purpose: ['ui'],
  summary:
    'The prompting vocabulary (req_2970/req_3270): every persistent block of the editor UI carries a section LETTER A–H — A chrome, B contextual left rail, C left input panel (asset browser or persistent paint Tool Options / Ink), D compact action bar, E stage, F stage tabs, G focus panel, H status bar — declared in shell/regions.ts SECTIONS and stamped `SECTION <X>` at the top of each owning component. Exactly eight; floating layers (dialogs, dropdowns, context menus, in-viewport docks) are not sections.',
  interfaces: [
    {
      name: 'SECTIONS (shell/regions.ts)',
      purpose: ['ui'],
      kind: 'utility',
      sourceFile: 'cart/editor/shell/regions.ts',
      description:
        'The letter → {region, name, file, contains} map, one entry per section, plus the lettered ASCII layout diagram. Wraps the req_2627 fixed-region contract (each entry points at its REGIONS key, which still owns the pixel constants). The ONE source of truth for section letters; the per-file `SECTION <X>` header comments are stamps pointing here.',
      consumers: ['cart/editor/shell/Chrome.tsx', 'cart/editor/shell/LeftRail.tsx', 'cart/editor/library/LibraryPanel.tsx', 'cart/editor/shell/PaintSidePanel.tsx', 'cart/editor/stage/ToolOptions.tsx', 'cart/editor/stage/Stage.tsx', 'cart/editor/stage/StageTabs.tsx', 'cart/editor/inspector/Inspector.tsx', 'cart/editor/shell/BuildDock.tsx'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'name UI areas by section letter, never by geometry',
      purpose: ['ui'],
      description:
        'When an ask places UI ("add that to section D"), resolve the letter through SECTIONS and build inside that owner file/region. New persistent UI lands INSIDE an existing section; only the user can rule a new section into existence. grep "SECTION <X>" to land on the owner.',
      examples: ['editor_sections'],
      status: 'resolved',
    },
  ],
  hazards: [
    {
      name: 'section letters must not drift from the rendered layout',
      purpose: ['ui'],
      description:
        'The letters are load-bearing prompting vocabulary. Moving/adding/removing a persistent region in AppFrame/Workspace/Stage without updating SECTIONS (and the stamps + editor_sections.md) silently re-points every future "section X" ask at the wrong block.',
      evidence: ['cart/editor/shell/regions.ts'],
      severity: 'medium',
    },
  ],
};
