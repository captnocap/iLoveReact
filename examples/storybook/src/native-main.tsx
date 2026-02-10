/**
 * Native storybook entry point.
 *
 * Bundled as IIFE, evaluated by QuickJS inside Love2D.
 * Renders a story browser + selected story using the native
 * react-reconciler → Lua tree/layout/painter pipeline.
 *
 * Navigation: click story names, or use Up/Down + Enter keys.
 */

import React, { useState, useCallback } from 'react';
import { NativeBridge } from '../../../packages/native/src/NativeBridge';
import { createRoot } from '../../../packages/native/src/NativeRenderer';
import { BridgeProvider, RendererProvider } from '../../../packages/shared/src/context';
import { Box, Text, Pressable } from '../../../packages/shared/src';
import { stories, type StoryDef } from './stories';

// ── HMR state sync ───────────────────────────────────────

let currentActiveIdx = 0;

// Expose state getter for HMR — Lua calls this before teardown
(globalThis as any).__getDevState = () => ({ activeIdx: currentActiveIdx });

// ── Story browser (sidebar + viewer) ─────────────────────

function groupByCategory(list: StoryDef[]): Map<string, StoryDef[]> {
  const map = new Map<string, StoryDef[]>();
  for (const s of list) {
    if (!map.has(s.category)) map.set(s.category, []);
    map.get(s.category)!.push(s);
  }
  return map;
}

function Storybook() {
  const initialIdx = (globalThis as any).__devState?.activeIdx ?? 0;
  const [activeIdx, setActiveIdx] = useState(initialIdx);
  currentActiveIdx = activeIdx; // sync for __getDevState
  const groups = groupByCategory(stories);
  const active = stories[activeIdx];
  const StoryComp = active?.component;

  const handleKeyDown = useCallback((e: any) => {
    const key = e.key || e.scancode;
    if (key === 'down' || key === 'j') {
      setActiveIdx(i => Math.min(i + 1, stories.length - 1));
    } else if (key === 'up' || key === 'k') {
      setActiveIdx(i => Math.max(i - 1, 0));
    }
  }, []);

  return (
    <Box style={{ flexDirection: 'row', width: '100%', height: '100%' }} onKeyDown={handleKeyDown}>
      {/* Sidebar */}
      <Box style={{
        width: 180,
        backgroundColor: '#0c0c14',
        borderWidth: 1,
        borderColor: '#1e293b',
        padding: 0,
        overflow: 'scroll',
      }}>
        {/* Header */}
        <Box style={{ paddingTop: 14, paddingLeft: 12, paddingRight: 12, paddingBottom: 5 }}>
          <Text style={{ color: '#475569', fontSize: 10, fontWeight: 'bold' }}>REACT-LOVE</Text>
        </Box>
        <Box style={{ height: 1, backgroundColor: '#1e293b' }} />

        {/* Story list */}
        {Array.from(groups.entries()).map(([category, list]) => (
          <Box key={category}>
            <Box style={{ paddingLeft: 12, paddingTop: 8, paddingBottom: 2 }}>
              <Text style={{ color: '#334155', fontSize: 9 }}>{category.toUpperCase()}</Text>
            </Box>
            {list.map(s => {
              const idx = stories.indexOf(s);
              const isActive = idx === activeIdx;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setActiveIdx(idx)}
                  style={{
                    paddingLeft: 16,
                    paddingRight: 8,
                    paddingTop: 4,
                    paddingBottom: 4,
                    backgroundColor: isActive ? '#1e293b' : 'transparent',
                  }}
                >
                  <Text style={{
                    color: isActive ? '#e2e8f0' : '#64748b',
                    fontSize: 11,
                  }}>
                    {s.title}
                  </Text>
                </Pressable>
              );
            })}
          </Box>
        ))}
      </Box>

      {/* Content */}
      <Box style={{ flexGrow: 1, backgroundColor: '#08080f' }}>
        {/* Header bar */}
        <Box style={{
          padding: 8,
          paddingLeft: 12,
          borderWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}>
          <Text style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 'bold' }}>
            {active?.title}
          </Text>
          <Text style={{ color: '#334155', fontSize: 9 }}>
            {active?.category}
          </Text>
        </Box>

        {/* Story content */}
        <Box style={{ flexGrow: 1, overflow: 'scroll' }}>
          {StoryComp && <StoryComp key={active.id} />}
        </Box>
      </Box>
    </Box>
  );
}

// ── Bootstrap ─────────────────────────────────────────────

const bridge = new NativeBridge();
const root = createRoot();

// When __deferMount is true (set by Lua before eval), store the mount function
// globally so Lua can trigger it after JS_Eval returns. This avoids React's
// synchronous LegacyRoot render blocking the entire JS_Eval call.
(globalThis as any).__mount = () => {
  root.render(
    <BridgeProvider bridge={bridge}>
      <RendererProvider mode="native">
        <Storybook />
      </RendererProvider>
    </BridgeProvider>
  );
  console.log('[react-love] Native storybook mounted (' + stories.length + ' stories)');
};

if (!(globalThis as any).__deferMount) {
  (globalThis as any).__mount();
}
