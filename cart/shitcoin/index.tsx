// shitcoin — entry point. Mount the Desktop directly; the Browser
// lives inside it and owns its own nested Router. No outer
// AppShell / Router / sim subscriptions at this layer.
//
// Previous (pre-strip) entry point is preserved as index_old.tsx for
// reference until the new shape stabilizes.

import { ThemeProvider } from '../../runtime/classifier';
import { APP_COLORS, APP_STYLES } from './theme';
import { Desktop } from './components';
// Side-effect imports — register IFTTT sources/actions + define the
// achievement set. Importing here ensures esbuild bundles them and the
// bus is wired by the time React mounts.
import './ifttt_sim';
import './achievements';

export default function App() {
  return (
    <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}>
      <Desktop />
    </ThemeProvider>
  );
}
