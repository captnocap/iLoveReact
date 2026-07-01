// editor — the Shitty Games shell. ONE cart, TWO routes: /editor (the authoring
// workspace) and /play (run the compiled world). One system.
//
// Entry only: ThemeProvider + Router + the persistent shell. AppFrame is the shell
// for BOTH routes — it mounts once directly under the Router (not swapped by a
// <Route>), so the top chrome and its Editor/Play toggle persist across the switch
// and the authoring state survives the round trip. AppFrame reads the route and
// swaps its own body: editor panels on /editor, the host-native compiled loader
// (PlayRoute) on /play.
import { ThemeProvider } from '../../runtime/classifier';
import { Router } from '../../runtime/router';
import { EDITOR_COLORS, EDITOR_STYLES } from './theme';
import AppFrame from './shell/AppFrame';

export default function App() {
  return (
    <ThemeProvider colors={EDITOR_COLORS} styles={EDITOR_STYLES}>
      <Router initialPath="/editor">
        <AppFrame />
      </Router>
    </ThemeProvider>
  );
}
