// composer — code-driven music composition cart in the EarSketch idiom.
//
// Workspace-style cart: stateless view over an on-disk SessionEnvelope
// from runtime/workspace/. User types in the code editor; Ctrl+S
// compiles the source against the audio framework and starts playback.
// Library holds project-scoped sample WAVs whose ids become global
// bindings inside the compile sandbox.
//
// File map:
//   domain.ts            — shared types + DEFAULT_SOURCE + id sanitizer
//   session.ts           — CART_NAME, VERSION, paths bound to them
//   compiler.ts          — text → live audio dispatch (the sandbox)
//   highlight.ts         — tokenizer feeding TextEditor.colorRows
//   api-cheatsheet.ts    — reference data for the docked CheatSheet rail
//   state.ts             — useComposerState() wraps useWorkspace
//   theme.ts             — colors + sizes
//   components/          — pure UI (TopBar, LibraryRail, CodeEditor,
//                          TimelineBar, StatusBar, CheatSheet)
//   sessions/<stem>.session.json + sessions/_last.txt  — autosave
//   samples/<stem>/<id>.wav                            — sidecar WAVs

import { Col, Row, Box } from '@reactjit/runtime/primitives';
import { TooltipRoot } from '@reactjit/runtime/tooltip/Tooltip';
import { useComposerState } from './state';
import { COLORS } from './theme';
import { TopBar } from './components/TopBar';
import { LibraryRail } from './components/LibraryRail';
import { CodeEditor } from './components/CodeEditor';
import { TimelineBar } from './components/TimelineBar';
import { StatusBar } from './components/StatusBar';
import { CheatSheet } from './components/CheatSheet';

export default function ComposerApp() {
  const s = useComposerState();
  return (
    <TooltipRoot>
      <Col style={{ width: '100%', height: '100%', backgroundColor: COLORS.bg, position: 'relative' }}>
        <TopBar s={s} />
        <Row style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
          <LibraryRail s={s} />
          <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
            <Box style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
              <CodeEditor s={s} />
            </Box>
            <TimelineBar s={s} />
          </Col>
          <CheatSheet
            open={s.isCheatSheetOpen}
            onClose={s.closeCheatSheet}
            onInsertExample={s.insertSnippet}
          />
        </Row>
        <StatusBar s={s} />
      </Col>
    </TooltipRoot>
  );
}
