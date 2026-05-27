// Browser — tab strip + per-tab nested Router. Each tab holds its own
// in-memory history via `<Router local>`; switching tabs hides
// inactive ones with a zero-height wrapper so their Router state
// (path, back/forward stack) survives.
//
// There are no sites yet. The viewport is a blank canvas — future
// commits will add `<Route path="...">` children inside `BrowserTab`
// to render diegetic 2021-era dapp pages.

import { useState, useCallback, useEffect, memo } from 'react';
import { Box, Text } from '@reactjit/runtime/primitives';
import { classifiers as C } from '../../../../runtime/classifier';
import { Router, Route, useRoute, useNavigate } from '../../../../runtime/router';
import { SkinProvider } from '../shared/SkinProvider';
import type { SkinKey } from '../shared/skins';
import { DevPage } from './pages/DevPage';
import './Browser.cls';

export interface BrowserProps {
  /** Initial path for the first tab. */
  initialPath?: string;
  /** Chrome-style skin: 'chrome' | 'brave' | 'firefox'. */
  skin?: SkinKey;
}

type TabHandle = {
  /** Stable identity, used as React key + path-map key. */
  uid: number;
  /** Initial path passed to the tab's local Router. Subsequent
   *  navigation happens inside the Router and is reported back via
   *  PathReporter so the tab strip stays in sync. */
  initialPath: string;
};

let _tabUid = 1;
function makeTab(initialPath: string): TabHandle {
  return { uid: _tabUid++, initialPath };
}

function BrowserImpl({ initialPath = '/dev', skin = 'chrome' }: BrowserProps) {
  const [tabs, setTabs] = useState<TabHandle[]>(() => [makeTab(initialPath)]);
  const [activeIdx, setActiveIdx] = useState(0);
  // Each tab reports its current path here so the tab strip + URL bar
  // can render outside the tab's Router subtree.
  const [tabPaths, setTabPaths] = useState<Record<number, string>>({ });

  const openTab = useCallback(() => {
    const t = makeTab(initialPath);
    setTabs((prev) => {
      setActiveIdx(prev.length);
      return [...prev, t];
    });
  }, [initialPath]);

  const closeTab = useCallback((idx: number) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev; // never close the last tab
      const out = prev.slice();
      const removed = out.splice(idx, 1)[0];
      if (removed) {
        setTabPaths((m) => {
          const next = { ...m };
          delete next[removed.uid];
          return next;
        });
      }
      const newActive = Math.min(activeIdx, out.length - 1);
      setActiveIdx(newActive);
      return out;
    });
  }, [activeIdx]);

  const switchTab = useCallback((idx: number) => {
    setActiveIdx(idx);
  }, []);

  const reportPath = useCallback((uid: number, path: string) => {
    setTabPaths((m) => (m[uid] === path ? m : { ...m, [uid]: path }));
  }, []);

  return (
    <SkinProvider skin={skin}>
      <C.BrowserRoot>
        <C.BrowserTabStrip>
          {tabs.map((t, i) => {
            const isActive = i === activeIdx;
            const TabCls = isActive ? C.BrowserTabActive : C.BrowserTab;
            const TitleCls = isActive ? C.BrowserTabTitleActive : C.BrowserTabTitle;
            const label = tabPaths[t.uid] ?? t.initialPath;
            return (
              <TabCls key={t.uid} onPress={() => switchTab(i)}>
                <TitleCls>{label}</TitleCls>
                <C.BrowserTabClose onPress={() => closeTab(i)}>
                  <C.BrowserTabCloseText>×</C.BrowserTabCloseText>
                </C.BrowserTabClose>
              </TabCls>
            );
          })}
          <C.BrowserNewTabBtn onPress={openTab}>
            <C.BrowserNewTabBtnText>+</C.BrowserNewTabBtnText>
          </C.BrowserNewTabBtn>
        </C.BrowserTabStrip>

        {/* All tabs are mounted at once so their Router history
            survives tab switching. Inactive ones collapse to height:0. */}
        {tabs.map((t, i) => (
          <Box
            key={t.uid}
            style={i === activeIdx
              ? { flexGrow: 1, flexBasis: 0, flexDirection: 'column' }
              : { height: 0, overflow: 'hidden' }}
          >
            <Router local initialPath={t.initialPath}>
              <BrowserTab uid={t.uid} reportPath={reportPath} />
            </Router>
          </Box>
        ))}
      </C.BrowserRoot>
    </SkinProvider>
  );
}

// Memo-wrap the Browser so re-renders of the parent (Desktop on every
// pixel of window drag) don't propagate into the per-tab Routers + the
// huge DevPage tree. Props are stable across drags (initialPath/skin),
// so the memo skips the whole subtree.
export const Browser = memo(BrowserImpl);

interface BrowserTabProps {
  uid: number;
  reportPath: (uid: number, path: string) => void;
}

function BrowserTab({ uid, reportPath }: BrowserTabProps) {
  const { path } = useRoute();
  const nav = useNavigate();
  const [draft, setDraft] = useState(path);

  // Keep the URL bar in sync with the Router's path when it changes via
  // back/forward or programmatic navigation. The user's in-progress
  // typing wins over external changes only while the input is focused —
  // we don't track focus yet, so simple sync.
  useEffect(() => {
    setDraft(path);
  }, [path]);

  // Broadcast path changes to the parent so the tab strip can label.
  useEffect(() => {
    reportPath(uid, path);
  }, [uid, path, reportPath]);

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    nav.push(trimmed.startsWith('/') ? trimmed : '/' + trimmed);
  };

  return (
    <Box style={{ flexGrow: 1, flexBasis: 0, flexDirection: 'column' }}>
      <C.BrowserToolbar>
        <C.BrowserNavBtn onPress={() => nav.back()}>
          <C.BrowserNavBtnText>←</C.BrowserNavBtnText>
        </C.BrowserNavBtn>
        <C.BrowserNavBtn onPress={() => nav.forward()}>
          <C.BrowserNavBtnText>→</C.BrowserNavBtnText>
        </C.BrowserNavBtn>
        <C.BrowserNavBtn onPress={() => nav.replace(path)}>
          <C.BrowserNavBtnText>↻</C.BrowserNavBtnText>
        </C.BrowserNavBtn>
        <C.BrowserUrlBar
          value={draft}
          onChangeText={(v: string) => setDraft(v)}
          onSubmitEditing={submit}
        />
        <C.BrowserNavBtn onPress={submit}>
          <C.BrowserNavBtnText>Go</C.BrowserNavBtnText>
        </C.BrowserNavBtn>
      </C.BrowserToolbar>

      <C.BrowserViewport>
        <C.BrowserViewportInner>
          {/* Sites are <Route>s inside the per-tab local Router.
              /dev is the dev-reference page; everything else falls
              through to the "no page" placeholder for now. */}
          <Route path="/dev"><DevPage /></Route>
          <Route fallback>
            <Box style={{ flexDirection: 'column', alignItems: 'center', gap: 6, paddingTop: 60 }}>
              <Text style={{ fontSize: 18, color: '#888', fontWeight: 'bold' }}>{path}</Text>
              <Text style={{ fontSize: 12, color: '#555' }}>No page here yet — try /dev.</Text>
            </Box>
          </Route>
        </C.BrowserViewportInner>
      </C.BrowserViewport>
    </Box>
  );
}
