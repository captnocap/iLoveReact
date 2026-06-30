// editor — the Shitty Games shell. ONE cart, TWO routes: /editor (the authoring
// workspace) and /play (run the compiled world). One system.
//
// Entry only: ThemeProvider + Router + the route switch. /editor renders the full
// workspace (AppFrame, composed from one-component-per-file regions); /play mounts
// the host-native compiled loader. RouteToggle floats the Editor/Play switch.
import { ThemeProvider } from '../../runtime/classifier';
import { Router, Route } from '../../runtime/router';
import { EDITOR_COLORS, EDITOR_STYLES } from './theme';
import AppFrame from './shell/AppFrame';
import PlayRoute from './PlayRoute';
import RouteToggle from './RouteToggle';

export default function App() {
  return (
    <ThemeProvider colors={EDITOR_COLORS} styles={EDITOR_STYLES}>
      <Router initialPath="/editor">
        <Route path="/editor">{() => <AppFrame />}</Route>
        <Route path="/play">{() => <PlayRoute />}</Route>
        <Route path="/">{() => <AppFrame />}</Route>
        <RouteToggle />
      </Router>
    </ThemeProvider>
  );
}
