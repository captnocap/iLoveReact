import React from 'react';
import { Route, Router, useNavigate } from '../../runtime/router';
import { ThemeProvider } from '../../runtime/classifier';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';
import { ensureDirectories } from './fs';
import DashboardPage from './pages/Dashboard';
import PromptsPage from './pages/Prompts';
import GeneratePage from './pages/Generate';
import QueuePage from './pages/Queue';
import ResultsPage from './pages/Results';
import SettingsPage from './pages/Settings';

function Shell() {
  const nav = useNavigate();

  React.useEffect(() => {
    ensureDirectories();
  }, []);

  const NavItem = ({ path, label }: { path: string; label: string }) => (
    <C.AppNavItem onPress={() => nav.push(path)}>
      <C.AppNavText>{label}</C.AppNavText>
    </C.AppNavItem>
  );

  return (
    <C.AppRoot>
      <C.AppShell>
        <C.AppHeader>
          <C.AppTitleBlock>
            <C.AppKicker>IMAGE GEN</C.AppKicker>
            <C.AppTitle>Image Gen</C.AppTitle>
            <C.AppSubtle>Nano-GPT image generation queue + telemetry.</C.AppSubtle>
          </C.AppTitleBlock>
          <C.AppNav>
            <NavItem path="/" label="Dashboard" />
            <NavItem path="/prompts" label="Prompts" />
            <NavItem path="/generate" label="Generate" />
            <NavItem path="/queue" label="Queue" />
            <NavItem path="/results" label="Results" />
            <NavItem path="/settings" label="Settings" />
          </C.AppNav>
        </C.AppHeader>

        <Route path="/"><DashboardPage /></Route>
        <Route path="/prompts"><PromptsPage /></Route>
        <Route path="/generate"><GeneratePage /></Route>
        <Route path="/queue"><QueuePage /></Route>
        <Route path="/results"><ResultsPage /></Route>
        <Route path="/settings"><SettingsPage /></Route>
        <Route fallback>
          <C.AppPanel><C.AppPanelTitle>Not found</C.AppPanelTitle></C.AppPanel>
        </Route>
      </C.AppShell>
    </C.AppRoot>
  );
}

export default function App() {
  return (
    <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}>
      <Router initialPath="/">
        <Shell />
      </Router>
    </ThemeProvider>
  );
}
