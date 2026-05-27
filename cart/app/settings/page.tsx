// settings/page.tsx — multi-section settings shell.
//
// Routes (in nav order):
//   user       — identity, preferences, accommodations
//   customize  — runtime theme token reassignment
//   providers  — credentials only (api keys, urls, local model folder)
//   models     — unified registry across all providers + modalities
//   actions    — role → model bindings (assistant, embed, title-gen, …)
//   data       — sqlite/pg engine selection + probe
//   privacy    — proxy, allowlist, filesystem allowlist
//   about      — onboarding state, version, reset
//
// Each route file owns its own form. The shell loads the four shared
// rows once, passes them down via context, and dispatches.
//
// SettingsNav is exported because the parent shell (cart/app/index.tsx)
// renders it as a HUD rail next to the assistant chat — same shape as
// before, only the item set changed.

import { createContext, useContext, useEffect, useState } from 'react';
import { Box, ScrollView } from '@reactjit/runtime/primitives';
import { useNavigate, useRoute } from '@reactjit/runtime/router';
import { classifiers as S } from '@reactjit/core';
import { setSettingsSection, useHudInsets, useSettingsSection } from '../shell';

import {
  USER_ID, SETTINGS_ID, PRIVACY_ID,
  useUserStore, useSettingsStore, usePrivacyStore, useConnectionStore, useModelStore,
} from './shared';

import UserRoute      from './routes/user';
import CustomizeRoute from './routes/customize';
import ProvidersRoute from './routes/providers';
import ModelsRoute    from './routes/models';
import ActionsRoute   from './routes/actions';
import DataRoute      from './routes/data';
import EmbedRoute     from './routes/embed';
import PrivacyRoute   from './routes/privacy';
import AboutRoute     from './routes/about';
import TestsRoute     from './routes/tests';

export const NAV_ITEMS = [
  { id: 'user',      label: 'User' },
  { id: 'customize', label: 'Customize' },
  { id: 'providers', label: 'Providers' },
  { id: 'models',    label: 'Models' },
  { id: 'actions',   label: 'Actions' },
  { id: 'data',      label: 'Data' },
  { id: 'embed',     label: 'Embed' },
  { id: 'privacy',   label: 'Privacy' },
  { id: 'about',     label: 'About' },
  { id: 'tests',     label: 'Tests' },
];

export type SettingsCtx = {
  user: any | null;
  settings: any | null;
  privacy: any | null;
  connections: any[];
  models: any[];
  userStore: ReturnType<typeof useUserStore>;
  settingsStore: ReturnType<typeof useSettingsStore>;
  privacyStore: ReturnType<typeof usePrivacyStore>;
  connectionStore: ReturnType<typeof useConnectionStore>;
  modelStore: ReturnType<typeof useModelStore>;
  reload: () => void;
};

const Ctx = createContext<SettingsCtx | null>(null);
export function useSettingsCtx(): SettingsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettingsCtx outside provider');
  return v;
}

export default function SettingsPage() {
  const insets = useHudInsets();
  const userStore       = useUserStore();
  const settingsStore   = useSettingsStore();
  const privacyStore    = usePrivacyStore();
  const connectionStore = useConnectionStore();
  const modelStore      = useModelStore();

  const [active] = useSettingsSection();
  const route = useRoute();
  const [user, setUser]               = useState<any | null>(null);
  const [settings, setSettings]       = useState<any | null>(null);
  const [privacy, setPrivacy]         = useState<any | null>(null);
  const [connections, setConnections] = useState<any[]>([]);
  const [models, setModels]           = useState<any[]>([]);
  const [reloadKey, setReloadKey]     = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const u = await userStore.get(USER_ID).catch(() => null);
      const s = await settingsStore.get(SETTINGS_ID).catch(() => null);
      const p = await privacyStore.get(PRIVACY_ID).catch(() => null);
      const allConns  = await connectionStore.list().catch(() => []);
      const allModels = await modelStore.list().catch(() => []);
      if (cancelled) return;
      setUser(u || null);
      setSettings(s || null);
      setPrivacy(p || null);
      setConnections((allConns || []).filter((c: any) => c?.settingsId === SETTINGS_ID));
      setModels(allModels || []);
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  useEffect(() => {
    if (route.path === '/settings/customize') {
      setSettingsSection('customize');
    }
  }, [route.path]);

  const ctx: SettingsCtx = {
    user, settings, privacy, connections, models,
    userStore, settingsStore, privacyStore, connectionStore, modelStore,
    reload,
  };

  return (
    <Ctx.Provider value={ctx}>
      <Box style={{
        flexGrow: 1, flexDirection: 'column',
        backgroundColor: 'theme:bg1',
        height: '100%', width: '100%', minWidth: 0,
      }}>
        <ScrollView showScrollbar style={{ width: '100%', height: '100%' }}>
          <Box style={{
            flexDirection: 'column',
            paddingTop: 32, paddingBottom: 64 + insets.bottom,
            paddingLeft: 32, paddingRight: 32,
            minWidth: 0, overflow: 'hidden',
          }}>
            <Box style={{
              width: '100%',
              minWidth: 0, overflow: 'hidden',
              flexDirection: 'column', gap: 20,
            }}>
              {active === 'user'      && <UserRoute />}
              {active === 'customize' && <CustomizeRoute />}
              {active === 'providers' && <ProvidersRoute />}
              {active === 'models'    && <ModelsRoute />}
              {active === 'actions'   && <ActionsRoute />}
              {active === 'data'      && <DataRoute />}
              {active === 'embed'     && <EmbedRoute />}
              {active === 'privacy'   && <PrivacyRoute />}
              {active === 'about'     && <AboutRoute />}
              {active === 'tests'     && <TestsRoute />}
            </Box>
          </Box>
        </ScrollView>
      </Box>
    </Ctx.Provider>
  );
}

export function SettingsNav({ maxHeight }: { maxHeight?: number }) {
  const [active, setActive] = useSettingsSection();
  const navigate = useNavigate();
  return (
    <Box style={{
      width: '100%',
      maxHeight,
      flexShrink: 0,
      overflow: 'hidden',
      flexDirection: 'column',
      borderBottomWidth: 1, borderBottomColor: 'theme:rule',
      backgroundColor: 'theme:bg',
      paddingTop: 16, paddingBottom: 12,
      paddingLeft: 12, paddingRight: 12,
      gap: 2,
    }}>
      <Box style={{ paddingLeft: 8, paddingRight: 8, paddingBottom: 12 }}>
        <S.Caption>App</S.Caption>
        <S.Title>Settings</S.Title>
      </Box>
      {NAV_ITEMS.map((item) => {
        const isActive = item.id === active;
        const Pill = isActive ? S.NavPillActive : S.NavPill;
        const onPress = () => {
          setActive(item.id);
          navigate.push(item.id === 'customize' ? '/settings/customize' : '/settings');
        };
        return (
          <Pill key={item.id} onPress={onPress}>
            <S.Body>{item.label}</S.Body>
          </Pill>
        );
      })}
    </Box>
  );
}
