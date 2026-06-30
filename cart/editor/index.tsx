// editor — the Shitty Games shell. ONE cart, TWO routes: /editor (author) and
// /play (run the compiled world). One system: edit a game, jump to /play, and
// (eventually) host a server friends join.
//
// This file is the entry only: the Router + the chrome strip + the route switch.
// Real surfaces live in their own files (EditorRoute, PlayRoute, …) and grow into
// components — never a god-file. Styling is classifier-only (./editor.cls).
import { ThemeProvider } from '../../runtime/classifier';
import { Router, Route, useNavigate, useRoute } from '../../runtime/router';
import { EDITOR_COLORS, EDITOR_STYLES } from './theme';
import { C } from './editor.cls';
import EditorRoute from './EditorRoute';
import PlayRoute from './PlayRoute';

function Tab({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const Box = on ? C.ED_TabOn : C.ED_Tab;
  const Txt = on ? C.ED_TabTextOn : C.ED_TabText;
  return (
    <Box onPress={onPress}>
      <Txt>{label}</Txt>
    </Box>
  );
}

function Chrome() {
  const nav = useNavigate();
  const { path } = useRoute();
  const onPlay = path === '/play';
  return (
    <C.ED_Chrome>
      <C.ED_Brand>
        <C.ED_BrandText>SHITTY GAMES</C.ED_BrandText>
      </C.ED_Brand>
      <Tab label="Editor" on={!onPlay} onPress={() => nav.push('/editor')} />
      <Tab label="Play" on={onPlay} onPress={() => nav.push('/play')} />
      <C.ED_Spacer />
    </C.ED_Chrome>
  );
}

export default function App() {
  return (
    <ThemeProvider colors={EDITOR_COLORS} styles={EDITOR_STYLES}>
      <Router initialPath="/editor">
        <C.ED_App>
          <Chrome />
          <C.ED_Stage>
            <Route path="/editor">{() => <EditorRoute />}</Route>
            <Route path="/play">{() => <PlayRoute />}</Route>
            <Route path="/">{() => <EditorRoute />}</Route>
          </C.ED_Stage>
        </C.ED_App>
      </Router>
    </ThemeProvider>
  );
}
